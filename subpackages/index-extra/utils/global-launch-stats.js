/**
 * 全球发射统计展示层
 * 数据源：getLaunchStats 云函数 → LL2 /launches/previous/ + net__gte / net__lt（UTC 自然年）
 */

const {
  fetchGlobalSummaryFromCloud,
  fetchGlobalBreakdownFromCloud,
  fetchLaunchSummaryFromCloud,
  readPersistSnapshot,
  readLaunchSummarySnapshotTotal
} = require('../../../utils/launch-stats-cloud.js')
const {
  mergeGlobalLaunchStatsParts,
  homeSummaryToGlobalPayload,
  pickAlignedSummary
} = require('./global-launch-stats-merge.js')
const { getAgencies } = require('../../../utils/api-monitor-data.js')
const { getLaunchStatsFromDB, readCardGlobalTotalSync } = require('../../../utils/api-app-services.js')
const { logoUrlFromAgencyRecord } = require('../../../utils/upcoming-agency-logo-enrich.js')
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../../utils/agency-logo-overrides.js')
const { resolveAgencyLogoForDisplay } = require('../../../utils/agency-logo-cache.js')
const { resolveAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')
const { getRocketImage } = require('../../../utils/util.js')
const { pickLocalized, zhField } = require('../../../utils/locale.js')
const { resolveAgencyDisplayZh } = require('../../../utils/launch-card-i18n.js')
const { translateRocketName } = require('../../../utils/rocket-name-i18n.js')

/** ISO 3166-1 alpha-3 → alpha-2（用于国旗 emoji） */
const ISO3_TO_ALPHA2 = {
  USA: 'US', US: 'US',
  CHN: 'CN', CN: 'CN', PRC: 'CN',
  RUS: 'RU', RU: 'RU',
  JPN: 'JP', JP: 'JP',
  IND: 'IN', IN: 'IN',
  KOR: 'KR', KR: 'KR',
  PRK: 'KP', KP: 'KP',
  FRA: 'FR', FR: 'FR',
  GBR: 'GB', UK: 'GB', GB: 'GB',
  DEU: 'DE', DE: 'DE',
  ITA: 'IT', IT: 'IT',
  ESA: 'EU', EU: 'EU',
  NZL: 'NZ', NZ: 'NZ',
  AUS: 'AU', AU: 'AU',
  CAN: 'CA', CA: 'CA',
  ISR: 'IL', IL: 'IL',
  IRN: 'IR', IR: 'IR',
  BRA: 'BR', BR: 'BR',
  UAE: 'AE', ARE: 'AE',
  SAU: 'SA', SA: 'SA',
  MEX: 'MX', MX: 'MX',
  KAZ: 'KZ', KZ: 'KZ'
}

const COUNTRY_DISPLAY = {
  USA: '美国', US: '美国',
  CHN: '中国', CN: '中国', PRC: '中国',
  RUS: '俄罗斯', RU: '俄罗斯',
  JPN: '日本', JP: '日本',
  IND: '印度', IN: '印度',
  KOR: '韩国', KR: '韩国', PRK: '朝鲜', KP: '朝鲜',
  FRA: '法国', FR: '法国',
  GBR: '英国', UK: '英国', GB: '英国',
  DEU: '德国', DE: '德国',
  ITA: '意大利', IT: '意大利',
  ESA: '欧空局', EU: '欧洲',
  NZL: '新西兰', NZ: '新西兰',
  AUS: '澳大利亚', AU: '澳大利亚',
  CAN: '加拿大', CA: '加拿大',
  ISR: '以色列', IL: '以色列',
  IRN: '伊朗', BRA: '巴西',
  UAE: '阿联酋', ARE: '阿联酋',
  SAU: '沙特', MEX: '墨西哥',
  KAZ: '哈萨克斯坦'
}

const DISPLAY_TO_CODE = {}
Object.keys(COUNTRY_DISPLAY).forEach((code) => {
  const name = COUNTRY_DISPLAY[code]
  if (!DISPLAY_TO_CODE[name]) DISPLAY_TO_CODE[name] = code
})

const ALL_COUNTRY_KEY = '_all'

function countryCodeToFlagEmoji(code) {
  const raw = String(code || '').trim().toUpperCase()
  if (!raw) return '🏳️'
  const alpha2 = ISO3_TO_ALPHA2[raw] || (raw.length === 2 ? raw : '')
  if (!alpha2 || alpha2.length !== 2) return '🏳️'
  return String.fromCodePoint(...[...alpha2].map((c) => 127397 + c.charCodeAt(0)))
}

function getCountryKeyFromMission(mission) {
  const display = String((mission && mission.countryDisplay) || '').trim()
  return display || '未知'
}

function getCountryFlagFromMission(mission) {
  const display = getCountryKeyFromMission(mission)
  const code = DISPLAY_TO_CODE[display]
  return countryCodeToFlagEmoji(code)
}

function getLaunchYearUtc(launchTime) {
  if (!launchTime) return null
  const t = new Date(launchTime).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t).getUTCFullYear()
}

function isInYearUtc(launchTime, year) {
  const y = getLaunchYearUtc(launchTime)
  return y != null && y === Number(year)
}

/** LL2 status：3 成功，4 部分失败，5 失败；其余计入尝试但不分成功/失败 */
function classifyMissionOutcome(mission) {
  if (!mission) return { success: false, failure: false }
  if (mission.success === true) return { success: true, failure: false }
  if (mission.isFailure === true) return { success: false, failure: true }
  if (mission.isPartialFailure === true) return { success: false, failure: true }
  const cat = String(mission.statusCategory || '').toLowerCase()
  if (cat === 'success') return { success: true, failure: false }
  if (cat === 'failure' || cat === 'partial') return { success: false, failure: true }
  return { success: false, failure: false }
}

function getAgencyKeyFromMission(mission) {
  const name = String((mission && mission.launchAgency) || '').trim()
  const abbr = String((mission && mission.launchAgencyAbbrev) || '').trim()
  return name || abbr || '未知机构'
}

function getAgencyIdFromMission(mission) {
  const id = mission && mission.launchAgencyId
  return id != null && String(id).trim() !== '' ? String(id).trim() : ''
}

function getRocketKeyFromMission(mission) {
  return String((mission && mission.rocketName) || '').trim() || '未知型号'
}

function getConfigIdFromMission(mission) {
  const id = mission && (mission.rocketConfigId != null ? mission.rocketConfigId : mission.configId)
  return id != null && String(id).trim() !== '' ? String(id).trim() : ''
}

function tallyId(prev, field, id) {
  if (!id) return
  prev[field] = prev[field] || {}
  prev[field][id] = (prev[field][id] || 0) + 1
}

function pickMajorityId(counts) {
  const map = counts && typeof counts === 'object' ? counts : null
  if (!map) return ''
  let best = ''
  let n = 0
  Object.keys(map).forEach((id) => {
    const c = Number(map[id]) || 0
    if (c > n) {
      n = c
      best = id
    }
  })
  return best
}

function filterMissions(missions, year, countryKey) {
  const list = Array.isArray(missions) ? missions : []
  const y = Number(year)
  return list.filter((m) => {
    if (!isInYearUtc(m && m.launchTime, y)) return false
    if (!countryKey || countryKey === ALL_COUNTRY_KEY) return true
    return getCountryKeyFromMission(m) === countryKey
  })
}

function bumpBucket(map, key, meta, mission) {
  const prev = map.get(key) || {
    key,
    name: meta.name || key,
    flag: meta.flag || '',
    success: 0,
    failure: 0,
    total: 0,
    successPct: 0,
    failurePct: 0
  }
  const outcome = classifyMissionOutcome(mission)
  prev.total += 1
  if (outcome.success) prev.success += 1
  if (outcome.failure) prev.failure += 1
  if (meta && meta.agencyId) tallyId(prev, '_agencyIds', meta.agencyId)
  if (meta && meta.configId) tallyId(prev, '_configIds', meta.configId)
  map.set(key, prev)
}

function finalizeBuckets(map) {
  const rows = Array.from(map.values())
  rows.forEach((row) => {
    const denom = row.total > 0 ? row.total : 1
    row.successPct = Math.round((row.success / denom) * 100)
    row.failurePct = Math.round((row.failure / denom) * 100)
    row.successFailText = `${row.success}成功 / ${row.failure}失败`
    const agencyId = pickMajorityId(row._agencyIds)
    const configId = pickMajorityId(row._configIds)
    if (agencyId) row.agencyId = agencyId
    if (configId) row.configId = configId
    delete row._agencyIds
    delete row._configIds
  })
  return rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return String(a.name).localeCompare(String(b.name), 'zh')
  })
}

function aggregateLaunchStats(missions) {
  const list = Array.isArray(missions) ? missions : []
  const byCountry = new Map()
  const byAgency = new Map()
  const byRocket = new Map()

  list.forEach((m) => {
    const countryKey = getCountryKeyFromMission(m)
    bumpBucket(byCountry, countryKey, {
      name: countryKey,
      flag: getCountryFlagFromMission(m)
    }, m)

    const agencyKey = getAgencyKeyFromMission(m)
    bumpBucket(byAgency, agencyKey, { name: agencyKey, flag: '', agencyId: getAgencyIdFromMission(m) }, m)

    const rocketKey = getRocketKeyFromMission(m)
    bumpBucket(byRocket, rocketKey, { name: rocketKey, flag: '', configId: getConfigIdFromMission(m) }, m)
  })

  const total = list.length
  let success = 0
  let failure = 0
  list.forEach((m) => {
    const o = classifyMissionOutcome(m)
    if (o.success) success += 1
    if (o.failure) failure += 1
  })

  return {
    total,
    success,
    failure,
    byCountry: finalizeBuckets(byCountry),
    byAgency: finalizeBuckets(byAgency),
    byRocket: finalizeBuckets(byRocket)
  }
}

function buildYearOptions(currentYear, minYear = 1957) {
  const end = Number(currentYear) || new Date().getUTCFullYear()
  const start = Math.min(end, Math.max(1957, Number(minYear) || 1957))
  const years = []
  for (let y = end; y >= start; y--) years.push(y)
  return years
}

function buildCountryOptions(missions, year) {
  const list = filterMissions(missions, year, ALL_COUNTRY_KEY)
  const bucket = new Map()
  list.forEach((m) => {
    const key = getCountryKeyFromMission(m)
    const prev = bucket.get(key) || { key, label: key, flag: getCountryFlagFromMission(m), count: 0 }
    prev.count += 1
    bucket.set(key, prev)
  })
  const countries = Array.from(bucket.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return String(a.label).localeCompare(String(b.label), 'zh')
  })
  return [
    { key: ALL_COUNTRY_KEY, label: '全部国家', flag: '🌍', count: list.length },
    ...countries
  ]
}

/**
 * 首页卡片那个年度总数（本地缓存，零请求）。
 * 卡片优先 getSummary，notReady 才回捞 launch_stats；这里把两份本地痕迹都取上，
 * 详情页头部据此对齐，卡片显示什么详情页就不会比它小。
 */
function readHomeCardTotalSync(year) {
  const candidates = [readCardGlobalTotalSync(year), readLaunchSummarySnapshotTotal(year)]
    .filter((n) => Number.isFinite(n) && n > 0)
  return candidates.length ? Math.max.apply(null, candidates) : null
}

/** 与卡片同一支函数取数（自带缓存，通常不产生额外请求）；仅当年、全部国家适用 */
async function resolveHomeCardTotal(year) {
  const local = readHomeCardTotalSync(year)
  if (Number(year) !== new Date().getUTCFullYear()) return local
  try {
    const stats = await getLaunchStatsFromDB()
    const n = Number(stats && stats.globalThisYear)
    if (Number.isFinite(n) && n > 0) return Math.max(n, local || 0)
  } catch (e) {}
  return local
}

function readPersistedGlobalStats(year, countryKey, options = {}) {
  const allowExpired = !!(options && options.allowExpired)
  const persistOpts = allowExpired ? { allowExpired: true } : {}
  const summaryKey = `_launch_global_summary_cloud_${year}_${countryKey}`
  const breakdownKey = `_launch_global_breakdown_cloud_${year}_${countryKey}`
  const legacyKey = `_launch_global_stats_cloud_${year}_${countryKey}`
  const breakdown = readPersistSnapshot(breakdownKey, persistOpts) || readPersistSnapshot(legacyKey, persistOpts)
  const summary = readPersistSnapshot(summaryKey, persistOpts)
  if (!summary && !breakdown) return null
  const data = breakdown && breakdown.data ? breakdown.data : {}
  const sumData = summary && summary.data ? summary.data : {}
  // 三份本地快照（汇总/明细/首页卡片）刷新时间不同，按同一套对齐规则取较全的一份，首屏就与卡片一致
  const homeTotal = countryKey === ALL_COUNTRY_KEY ? readHomeCardTotalSync(year) : null
  const localSummary = pickAlignedSummary([
    sumData.summary,
    data.summary,
    homeTotal != null ? { total: homeTotal } : null
  ]) || { total: 0, success: 0, failure: 0 }
  return {
    summary: localSummary,
    summaryPartial: localSummary.total > 0 && !localSummary.success && !localSummary.failure,
    byCountry: data.byCountry || [],
    byAgency: data.byAgency || [],
    byRocket: data.byRocket || [],
    countryOptions: data.countryOptions || [],
    staleCache: !!(summary && summary.stale) || !!(breakdown && breakdown.stale) || !!(summary && summary.expired) || !!(breakdown && breakdown.expired),
    clientStaleFallback: true
  }
}

/**
 * 从云函数拉取全球发射统计（LL2 官方 count + 服务端聚合）
 * @returns {Promise<object>} summary / byCountry / byAgency / byRocket / countryOptions
 */
async function fetchGlobalLaunchStats(options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear()
  const countryKey = options.countryKey || ALL_COUNTRY_KEY
  const forceRefresh = !!(options && options.forceRefresh)
  const skipLocalCache = !!(options && options.skipLocalCache)
  const onSummary = typeof options.onSummary === 'function' ? options.onSummary : null

  const mapCloudPayload = (data, extra = {}) => ({
    year: data.year || year,
    summary: data.summary || { total: 0, success: 0, failure: 0 },
    byCountry: data.byCountry || [],
    byAgency: data.byAgency || [],
    byRocket: data.byRocket || [],
    countryOptions: data.countryOptions || [],
    source: data.source || 'll2_previous_net',
    apiCount: data.apiCount,
    filters: data.filters || null,
    staleCache: !!data.staleCache,
    clientStaleFallback: !!data.clientStaleFallback,
    summaryPartial: !!data.summaryPartial,
    partial: !!data.partial,
    ...extra
  })

  // 汇总先到时也要按卡片口径出数，避免先闪一个偏小的总数再跳
  const localHomeTotal = countryKey === ALL_COUNTRY_KEY ? readHomeCardTotalSync(year) : null
  const alignWithHome = (mapped) => {
    if (localHomeTotal == null) return mapped
    const summary = pickAlignedSummary([mapped.summary, { total: localHomeTotal }])
    if (!summary) return mapped
    return {
      ...mapped,
      summary,
      summaryPartial: summary.total > 0 && !summary.success && !summary.failure
    }
  }

  const summaryPromise = fetchGlobalSummaryFromCloud({ year, countryKey, forceRefresh, skipLocalCache })
    .then((data) => {
      const mapped = alignWithHome(mapCloudPayload(data, { breakdownReady: false }))
      if (onSummary) onSummary(mapped)
      return mapped
    })

  const breakdownPromise = fetchGlobalBreakdownFromCloud({ year, countryKey, forceRefresh, skipLocalCache })
    .then((data) => mapCloudPayload(data, { breakdownReady: true }))

  // 与首页卡片同源的年度总数，用于头部对齐；失败不影响主流程
  const homeTotalPromise = countryKey === ALL_COUNTRY_KEY
    ? resolveHomeCardTotal(year).catch(() => null)
    : Promise.resolve(null)

  const [summarySettled, breakdownSettled] = await Promise.allSettled([
    summaryPromise,
    breakdownPromise
  ])
  const homeTotal = await homeTotalPromise

  const persist = readPersistedGlobalStats(year, countryKey)
    || readPersistedGlobalStats(year, countryKey, { allowExpired: true })
  const allPersist = countryKey !== ALL_COUNTRY_KEY
    ? (readPersistedGlobalStats(year, ALL_COUNTRY_KEY)
      || readPersistedGlobalStats(year, ALL_COUNTRY_KEY, { allowExpired: true }))
    : null

  let merged
  try {
    merged = mergeGlobalLaunchStatsParts({
      year,
      countryKey,
      summarySettled,
      breakdownSettled,
      persist,
      allPersist,
      homeTotal
    })
  } catch (err) {
    if (countryKey === ALL_COUNTRY_KEY) {
      try {
        const home = await fetchLaunchSummaryFromCloud({ year, forceRefresh, skipLocalCache })
        const fallback = homeSummaryToGlobalPayload(home, year)
        if (fallback) return mapCloudPayload(fallback, { breakdownReady: false })
      } catch (e2) {}
    }
    throw err
  }

  if (onSummary && summarySettled.status !== 'fulfilled' && merged.summary) {
    onSummary(mapCloudPayload(merged, { breakdownReady: false }))
  }

  return mapCloudPayload(merged, {
    breakdownReady: !!merged.breakdownReady,
    loadError: merged.loadError || ''
  })
}

// ── 机构 logo / 火箭配置图装饰 ──────────────────────────────────────────

/** 行首字母占位（logo/图缺失时显示） */
function firstGlyphOfName(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0).toUpperCase() : '·'
}

let _agencyLogoMapPromise = null

function putAgencyLookup(map, key, rec) {
  const k = String(key || '').trim().toLowerCase()
  if (!k || !rec) return
  const prev = map.get(k)
  if (!prev) {
    map.set(k, rec)
    return
  }
  if (typeof prev === 'string') {
    map.set(k, {
      url: rec.url || prev,
      id: rec.id || '',
      abbrev: rec.abbrev || '',
      name: rec.name || '',
      nameZh: rec.nameZh || ''
    })
    return
  }
  map.set(k, {
    url: rec.url || prev.url || '',
    id: rec.id || prev.id || '',
    abbrev: rec.abbrev || prev.abbrev || '',
    name: rec.name || prev.name || '',
    nameZh: rec.nameZh || prev.nameZh || ''
  })
}

function readAgencyLookup(logoMap, row) {
  const keys = [
    String((row && row.name) || '').trim().toLowerCase(),
    String((row && row.abbrev) || '').trim().toLowerCase(),
    String((row && row.key) || '').trim().toLowerCase()
  ]
  if (!logoMap || typeof logoMap.get !== 'function') return null
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i]) continue
    const v = logoMap.get(keys[i])
    if (!v) continue
    if (typeof v === 'string') return { url: v, id: '', abbrev: '', name: '', nameZh: '' }
    return v
  }
  return null
}

/**
 * 机构名/缩写（小写）→ { url, id, abbrev, nameZh }。
 * 数据来自 getAgencies（云数据库同步集合，自带本地 Storage 缓存），不打 LL2。
 */
function loadAgencyLogoNameMap() {
  if (_agencyLogoMapPromise) return _agencyLogoMapPromise
  _agencyLogoMapPromise = getAgencies({ featured: false, limit: 400, offset: 0 })
    .then((data) => {
      const map = new Map()
      const results = (data && data.results) || []
      for (let i = 0; i < results.length; i++) {
        const a = results[i]
        const rec = {
          url: logoUrlFromAgencyRecord(a) || '',
          id: a && a.id != null ? String(a.id) : '',
          abbrev: String((a && a.abbrev) || '').trim(),
          name: String((a && a.name) || '').trim(),
          nameZh: zhField(a, 'name') || ''
        }
        if (!rec.url && !rec.id && !rec.name) continue
        putAgencyLookup(map, rec.name, rec)
        putAgencyLookup(map, rec.abbrev, rec)
      }
      putAgencyLookup(map, 'spacex', {
        url: SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL,
        id: '',
        abbrev: 'SpaceX',
        name: 'SpaceX',
        nameZh: ''
      })
      return map
    })
    .catch(() => new Map())
  return _agencyLogoMapPromise
}

function isUnknownRankName(name) {
  const s = String(name || '').trim()
  return !s || s === '未知机构' || s === '未知型号'
}

/**
 * 机构行：展示名走发射商图鉴同一条 resolveAgencyDisplayZh；
 * logo 命中本地磁盘缓存时直接返回 wxfile，否则远程 URL。
 * 有名称即可点：有 agencyId 走 id，没有则详情页按名称解析。
 */
function decorateAgencyRows(rows, logoMap) {
  return (rows || []).map((row) => {
    const rec = readAgencyLookup(logoMap, row)
    const remote = (rec && rec.url) || ''
    const abbrev = (rec && rec.abbrev) || row.abbrev || ''
    const displayName =
      resolveAgencyDisplayZh(row.name, abbrev, (rec && rec.nameZh) || zhField(row, 'name')) ||
      pickLocalized(zhField(row, 'name'), row.name) ||
      row.name
    const agencyId = row && row.agencyId != null && String(row.agencyId).trim() !== ''
      ? String(row.agencyId).trim()
      : ''
    return {
      ...row,
      displayName,
      agencyId: agencyId ? String(agencyId) : '',
      agencyAbbrev: abbrev,
      clickable: !isUnknownRankName(row.name),
      logo: remote ? resolveAgencyLogoForDisplay(remote) : '',
      logoRemote: remote,
      logoBgTone: remote ? resolveAgencyLogoBgTone(remote) : '',
      initial: firstGlyphOfName(displayName || row.name)
    }
  })
}

/** 火箭行补配置图 + 与列表卡同一套型号汉化；有名称即可点，点按后再升到最新款 */
function decorateRocketRows(rows) {
  return (rows || []).map((row) => {
    const displayName = translateRocketName(row.name) || row.name
    const configId = row && row.configId != null && String(row.configId).trim() !== ''
      ? String(row.configId).trim()
      : ''
    return {
      ...row,
      displayName,
      configId,
      clickable: !isUnknownRankName(row.name),
      image: getRocketImage(row.name) || '',
      initial: firstGlyphOfName(displayName || row.name)
    }
  })
}

module.exports = {
  ALL_COUNTRY_KEY,
  countryCodeToFlagEmoji,
  getLaunchYearUtc,
  filterMissions,
  aggregateLaunchStats,
  buildYearOptions,
  buildCountryOptions,
  fetchGlobalLaunchStats,
  readPersistedGlobalStats,
  loadAgencyLogoNameMap,
  decorateAgencyRows,
  decorateRocketRows,
  isUnknownRankName
}
