/**
 * 首页「即将发射」胶囊 logo：与监控页发射商图鉴同一条链路。
 * 权威来源 = getAgencies() 缓存里的 agency.logo（云端 syncImageMirror 后多为 COS LL2镜像），
 * 再经 overrideAgencyLogoUrl（SpaceX → 发射商logo/ 固定图）。
 *
 * 列表 slimLaunch 会裁掉 LSP.logo，非 SpaceX 不能等 400 家目录才出图：
 * 先读本地按 id 缓存 / 已落盘的机构目录，缺的再按当前列表并行拉详情。
 */

const { getAgencies, getAgencyDetail } = require('./api-monitor-data.js')
const {
  overrideAgencyLogoUrl,
  applyLaunchAgencyLogoOverridesToMission,
  applyLaunchAgencyLogoOverridesToMissions
} = require('./agency-logo-overrides.js')

const LOGO_BY_ID_KEY = '_agency_logo_by_id'
const AGENCY_LIST_CACHE_KEYS = ['_agencies_f0_l400_o0_s_t', '_agencies_f1_l50_o0_s_t']

/** 可回收发射商（权重最高）。key = LL2 agency id */
const RECOVERY_AGENCY_WEIGHT = {
  '121': 120, // SpaceX
  '147': 120, // Rocket Lab
  '141': 120, // Blue Origin
  '259': 120 // LandSpace 蓝箭
}

/** 知名发射商（次高）。未列入的仍会按当前列表补，只是排后面 */
const FAMOUS_AGENCY_WEIGHT = {
  '88': 70, // CASC
  '124': 60, // ULA
  '115': 55, // Arianespace
  '44': 50, // NASA
  '27': 45, // ESA
  '63': 45, // Roscosmos
  '31': 45, // ISRO
  '37': 45 // JAXA
}

const RECOVERY_NAME_RE =
  /spacex|rocket\s*lab|火箭实验室|blue\s*origin|蓝色起源|landspace|蓝箭|i-?space|星际荣耀|space\s*pioneer|天兵|deep\s*blue|深蓝航天|stoke|relativity|朱雀|new\s*glenn|neutron/i
const FAMOUS_NAME_RE =
  /casc|中国航天科技|航天科技集团|united\s*launch|ula|arianespace|阿丽亚娜|\bnasa\b|\besa\b|jaxa|isro|roscosmos|northrop|firefly|萤火虫|galactic\s*energy|星河动力|cas\s*space|中科宇航|orienspace|东方空间|mitsubishi|三菱|expace|快舟/i

const HIGH_WAVE_CAP = 20

function agencyNameHaystack(mission) {
  if (!mission || typeof mission !== 'object') return ''
  return [
    mission.launchAgency,
    mission.launchAgencyAbbrev,
    mission.launchAgencyEn,
    mission.agencyName
  ]
    .map((s) => String(s || ''))
    .join(' ')
}

/**
 * 单条任务上的发射商 logo 拉取权重。
 * 可回收（名录 / 本任务可回收）> 知名发射商 > 即将发射条数。
 */
function scoreAgencyLogoPriority(mission, opts) {
  if (!mission || typeof mission !== 'object') return 0
  let score = 0
  const id = mission.launchAgencyId != null ? String(mission.launchAgencyId).trim() : ''
  if (id && RECOVERY_AGENCY_WEIGHT[id]) score += RECOVERY_AGENCY_WEIGHT[id]
  else if (id && FAMOUS_AGENCY_WEIGHT[id]) score += FAMOUS_AGENCY_WEIGHT[id]

  const hay = agencyNameHaystack(mission)
  if (RECOVERY_NAME_RE.test(hay)) score += 100
  else if (FAMOUS_NAME_RE.test(hay)) score += 50

  if (mission.isRecoverableThisMission) score += 100
  const booster = mission.boosterInfo
  if (booster && (booster.configReusable || booster.inferredRecovery)) score += 80

  const priorityId = opts && opts.priorityLaunchId != null ? String(opts.priorityLaunchId).trim() : ''
  if (priorityId && mission.id != null && String(mission.id) === priorityId) score += 200

  return score
}

function rankUpcomingAgenciesForLogo(missions, opts) {
  const list = Array.isArray(missions) ? missions : []
  const bucket = {}
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || m.launchAgencyId == null) continue
    const id = String(m.launchAgencyId).trim()
    if (!id) continue
    if (!bucket[id]) {
      bucket[id] = { id, score: 0, count: 0 }
    }
    bucket[id].count += 1
    const s = scoreAgencyLogoPriority(m, opts)
    if (s > bucket[id].score) bucket[id].score = s
  }
  return Object.keys(bucket)
    .map((id) => {
      const row = bucket[id]
      return { id: row.id, score: row.score + row.count * 4, count: row.count }
    })
    .sort((a, b) => b.score - a.score || b.count - a.count || String(a.id).localeCompare(String(b.id)))
}

function splitLogoFetchWaves(ranked, missingSet) {
  const missing = Array.isArray(ranked) ? ranked.filter((row) => row && missingSet.has(row.id)) : []
  return {
    high: missing.slice(0, HIGH_WAVE_CAP).map((row) => row.id),
    rest: missing.slice(HIGH_WAVE_CAP).map((row) => row.id)
  }
}

function absolutizeAgencyAssetUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/^cloud:\/\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  if (s.startsWith('/')) return `https://ll.thespacedevs.com${s}`
  return s
}

/**
 * 与 agency-data.formatAgency 一致：
 * overrideAgencyLogoUrl(agency, agency.logo.thumbnail_url || agency.logo.image_url)
 */
function logoUrlFromAgencyRecord(agency) {
  if (!agency || typeof agency !== 'object') return ''
  const raw = agency.logo
    ? absolutizeAgencyAssetUrl(agency.logo.thumbnail_url || agency.logo.image_url || '')
    : ''
  const out = overrideAgencyLogoUrl(agency, raw)
  return typeof out === 'string' ? out.trim() : ''
}

let _bulkLogoMapPromise = null
let _bulkLogoMap = null
let _logoById = null
let _seededFromListCache = false

function loadLogoByIdMap() {
  if (_logoById) return _logoById
  try {
    const stored = wx.getStorageSync(LOGO_BY_ID_KEY)
    _logoById = stored && typeof stored === 'object' ? stored : {}
  } catch (e) {
    _logoById = {}
  }
  return _logoById
}

function rememberAgencyLogoById(agencyId, url) {
  const id = agencyId != null ? String(agencyId).trim() : ''
  const u = String(url || '').trim()
  if (!id || !u || !/^https?:\/\//i.test(u)) return
  const map = loadLogoByIdMap()
  if (map[id] === u) {
    if (_bulkLogoMap) _bulkLogoMap.set(id, u)
    return
  }
  map[id] = u
  _logoById = map
  if (_bulkLogoMap) _bulkLogoMap.set(id, u)
  try {
    wx.setStorage({ key: LOGO_BY_ID_KEY, data: map, fail() {} })
  } catch (e) {}
}

function seedMapFromLocalAgencyCaches(map) {
  if (!map) return
  for (let k = 0; k < AGENCY_LIST_CACHE_KEYS.length; k++) {
    let results = null
    try {
      const cached = wx.getStorageSync(AGENCY_LIST_CACHE_KEYS[k])
      results = cached && cached.data && Array.isArray(cached.data.results) ? cached.data.results : null
    } catch (e) {
      results = null
    }
    if (!results) continue
    for (let i = 0; i < results.length; i++) {
      const a = results[i]
      if (!a || a.id == null) continue
      const url = logoUrlFromAgencyRecord(a)
      if (!url) continue
      const id = String(a.id)
      map.set(id, url)
      rememberAgencyLogoById(id, url)
    }
  }
}

function ensureSeededFromListCache() {
  if (_seededFromListCache) return
  _seededFromListCache = true
  seedMapFromLocalAgencyCaches(new Map())
}

function peekAgencyLogoById(agencyId) {
  if (agencyId == null) return ''
  const id = String(agencyId).trim()
  if (!id) return ''
  if (_bulkLogoMap) {
    const fromBulk = _bulkLogoMap.get(id)
    if (fromBulk) return fromBulk
  }
  const stored = loadLogoByIdMap()[id]
  if (stored) return stored
  ensureSeededFromListCache()
  return loadLogoByIdMap()[id] || ''
}

function hydrateMissionAgencyLogo(mission) {
  if (!mission || typeof mission !== 'object') return mission
  const patched = applyLaunchAgencyLogoOverridesToMission(mission) || mission
  if (String(patched.launchAgencyImage || '').trim()) return patched
  const peeked = peekAgencyLogoById(patched.launchAgencyId)
  if (!peeked) return patched
  return { ...patched, launchAgencyImage: peeked }
}

function hydrateMissionsAgencyLogos(missions) {
  const list = Array.isArray(missions) ? missions : []
  if (!list.length) return list
  let changed = false
  const next = list.map((m) => {
    const n = hydrateMissionAgencyLogo(m)
    if (n !== m) changed = true
    return n
  })
  return changed ? next : list
}

function getBulkAgencyLogoMap() {
  if (_bulkLogoMapPromise) return _bulkLogoMapPromise
  _bulkLogoMapPromise = getAgencies({ featured: false, limit: 400, offset: 0 })
    .then((data) => {
      const map = new Map()
      const results = (data && data.results) || []
      for (let i = 0; i < results.length; i++) {
        const a = results[i]
        if (!a || a.id == null) continue
        const url = logoUrlFromAgencyRecord(a)
        if (!url) continue
        const id = String(a.id)
        map.set(id, url)
        rememberAgencyLogoById(id, url)
      }
      _bulkLogoMap = map
      return map
    })
    .catch(() => {
      if (!_bulkLogoMap) _bulkLogoMap = new Map()
      return _bulkLogoMap
    })
  return _bulkLogoMapPromise
}

function peekBulkAgencyLogo(agencyId) {
  return peekAgencyLogoById(agencyId)
}

async function fetchAgencyLogoDetails(idList, map) {
  const ids = Array.isArray(idList) ? idList : []
  if (!ids.length) return
  await Promise.all(
    ids.map(async (idStr) => {
      try {
        const d = await getAgencyDetail(idStr)
        const u = logoUrlFromAgencyRecord(d)
        if (u) {
          map.set(idStr, u)
          rememberAgencyLogoById(idStr, u)
        }
      } catch (e) {}
    })
  )
}

function applyLogoMapToMissions(list, map) {
  let changed = false
  const next = list.map((m) => {
    if (!m || typeof m !== 'object') return m
    const patched = applyLaunchAgencyLogoOverridesToMission(m) || m
    const id = patched.launchAgencyId != null ? String(patched.launchAgencyId).trim() : ''
    const catalog = id ? map.get(id) || '' : ''
    const prev = String(patched.launchAgencyImage || '').trim()
    if (catalog && catalog !== prev) {
      changed = true
      rememberAgencyLogoById(id, catalog)
      return { ...patched, launchAgencyImage: catalog }
    }
    if (patched !== m) {
      changed = true
      return patched
    }
    return m
  })
  return changed ? next : list
}

/**
 * 按权重补 logo：可回收 / 知名先拉详情，其余后台补。
 * 不打 getAgencies(400)。
 * @param {Object[]} missions
 * @param {{ onMore?: Function, priorityLaunchId?: string }} [opts]
 * @returns {Promise<Object[]>}
 */
async function enrichMissionsLaunchAgencyImages(missions, opts) {
  const list = Array.isArray(missions) ? missions : []
  if (!list.length) return list

  const map = new Map()
  if (_bulkLogoMap) {
    _bulkLogoMap.forEach((url, id) => {
      if (url) map.set(id, url)
    })
  }
  seedMapFromLocalAgencyCaches(map)
  const stored = loadLogoByIdMap()
  Object.keys(stored).forEach((id) => {
    if (stored[id] && !map.has(id)) map.set(id, stored[id])
  })

  const ranked = rankUpcomingAgenciesForLogo(list, opts)
  const missingSet = new Set(ranked.map((row) => row.id).filter((id) => !map.has(id)))
  const waves = splitLogoFetchWaves(ranked, missingSet)

  if (waves.high.length) {
    await fetchAgencyLogoDetails(waves.high, map)
  }

  const afterHigh = applyLaunchAgencyLogoOverridesToMissions(applyLogoMapToMissions(list, map))

  if (waves.rest.length) {
    fetchAgencyLogoDetails(waves.rest, map)
      .then(() => {
        const more = applyLaunchAgencyLogoOverridesToMissions(applyLogoMapToMissions(afterHigh, map))
        if (opts && typeof opts.onMore === 'function') opts.onMore(more)
      })
      .catch(() => {})
  }

  return afterHigh
}

/**
 * 开屏倒计时卡：只补这一条。
 * SpaceX 走覆盖图；已有图或本地/目录命中直接返回；缺图再拉单条详情（不挡首屏）。
 */
async function enrichOneMissionAgencyLogo(mission, opts) {
  if (!mission || typeof mission !== 'object') return mission
  let patched = hydrateMissionAgencyLogo(mission)
  if (String(patched.launchAgencyImage || '').trim()) return patched
  const id = patched.launchAgencyId != null ? String(patched.launchAgencyId).trim() : ''
  if (!id) return patched
  const waitMs = Math.max(800, Number(opts && opts.timeoutMs) || 8000)
  try {
    const d = await Promise.race([
      getAgencyDetail(id),
      new Promise((resolve) => setTimeout(() => resolve(null), waitMs))
    ])
    const u = logoUrlFromAgencyRecord(d)
    if (u) {
      rememberAgencyLogoById(id, u)
      return { ...patched, launchAgencyImage: u }
    }
  } catch (e) {}
  return patched
}

function preloadAgencyLogoUrl(url) {
  const u = String(url || '').trim()
  if (!u || !/^https?:\/\//i.test(u)) return
  try {
    wx.getImageInfo({ src: u, fail() {} })
  } catch (e) {}
  try {
    require('./agency-logo-cache.js').persistAgencyLogoAfterRemoteLoad(u)
  } catch (e) {}
}

/**
 * 启动/开屏预热：按权重先下高优先级 logo，不拉 400 家目录。
 * @param {Object[]} missions
 * @param {{ priorityLaunchId?: string, onMore?: Function }} [opts]
 * @returns {Promise<Object[]>}
 */
async function prefetchUpcomingAgencyLogos(missions, opts) {
  const ranked = rankUpcomingAgenciesForLogo(missions, opts)
  const order = {}
  for (let i = 0; i < ranked.length; i++) order[ranked[i].id] = i

  const preloadByWeight = (list) => {
    const rows = (Array.isArray(list) ? list : [])
      .map((m) => ({
        m,
        u: m && String(m.launchAgencyImage || '').trim(),
        rank: m && m.launchAgencyId != null ? order[String(m.launchAgencyId)] : 999
      }))
      .filter((row) => row.u)
      .sort((a, b) => a.rank - b.rank)
    const seen = {}
    for (let i = 0; i < rows.length; i++) {
      if (seen[rows[i].u]) continue
      seen[rows[i].u] = true
      preloadAgencyLogoUrl(rows[i].u)
    }
  }

  const enriched = await enrichMissionsLaunchAgencyImages(missions, {
    priorityLaunchId: opts && opts.priorityLaunchId,
    onMore: (more) => {
      preloadByWeight(more)
      if (opts && typeof opts.onMore === 'function') opts.onMore(more)
    }
  })
  preloadByWeight(enriched)
  return enriched
}

module.exports = {
  enrichMissionsLaunchAgencyImages,
  enrichOneMissionAgencyLogo,
  prefetchUpcomingAgencyLogos,
  hydrateMissionAgencyLogo,
  hydrateMissionsAgencyLogos,
  scoreAgencyLogoPriority,
  rankUpcomingAgenciesForLogo,
  splitLogoFetchWaves,
  logoUrlFromAgencyRecord,
  getBulkAgencyLogoMap,
  peekBulkAgencyLogo,
  peekAgencyLogoById,
  rememberAgencyLogoById
}
