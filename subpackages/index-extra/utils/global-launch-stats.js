/**
 * 全球发射统计展示层
 * 数据源：getLaunchStats 云函数 → LL2 /launches/previous/ + net__gte / net__lt（UTC 自然年）
 */

const {
  fetchGlobalSummaryFromCloud,
  fetchGlobalBreakdownFromCloud,
  readPersistSnapshot
} = require('../../../utils/launch-stats-cloud.js')
const { getAgencies } = require('../../../utils/api-monitor-data.js')
const { logoUrlFromAgencyRecord } = require('../../../utils/upcoming-agency-logo-enrich.js')
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../../utils/agency-logo-overrides.js')
const { resolveAgencyLogoForDisplay } = require('../../../utils/agency-logo-cache.js')
const { getRocketImage } = require('../../../utils/util.js')
const { translateAgencyName } = require('../../../utils/space-terms-i18n.js')

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

function getRocketKeyFromMission(mission) {
  return String((mission && mission.rocketName) || '').trim() || '未知型号'
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
  map.set(key, prev)
}

function finalizeBuckets(map) {
  const rows = Array.from(map.values())
  rows.forEach((row) => {
    const denom = row.total > 0 ? row.total : 1
    row.successPct = Math.round((row.success / denom) * 100)
    row.failurePct = Math.round((row.failure / denom) * 100)
    row.successFailText = `${row.success}成功 / ${row.failure}失败`
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
    bumpBucket(byAgency, agencyKey, { name: agencyKey, flag: '' }, m)

    const rocketKey = getRocketKeyFromMission(m)
    bumpBucket(byRocket, rocketKey, { name: rocketKey, flag: '' }, m)
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

function readPersistedGlobalStats(year, countryKey) {
  const summaryKey = `_launch_global_summary_cloud_${year}_${countryKey}`
  const breakdownKey = `_launch_global_breakdown_cloud_${year}_${countryKey}`
  const legacyKey = `_launch_global_stats_cloud_${year}_${countryKey}`
  const breakdown = readPersistSnapshot(breakdownKey) || readPersistSnapshot(legacyKey)
  const summary = readPersistSnapshot(summaryKey)
  if (!summary && !breakdown) return null
  const data = breakdown && breakdown.data ? breakdown.data : {}
  const sumData = summary && summary.data ? summary.data : {}
  return {
    summary: (sumData.summary || data.summary || { total: 0, success: 0, failure: 0 }),
    byCountry: data.byCountry || [],
    byAgency: data.byAgency || [],
    byRocket: data.byRocket || [],
    countryOptions: data.countryOptions || [],
    staleCache: !!(summary && summary.stale) || !!(breakdown && breakdown.stale),
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

  const summaryPromise = fetchGlobalSummaryFromCloud({ year, countryKey, forceRefresh, skipLocalCache })
    .then((data) => {
      const mapped = mapCloudPayload(data, { breakdownReady: false })
      if (onSummary) onSummary(mapped)
      return mapped
    })

  const breakdownPromise = fetchGlobalBreakdownFromCloud({ year, countryKey, forceRefresh, skipLocalCache })
    .then((data) => mapCloudPayload(data, { breakdownReady: true }))

  const [summarySettled, breakdownSettled] = await Promise.allSettled([
    summaryPromise,
    breakdownPromise
  ])

  let summaryResult = {
    year,
    summary: { total: 0, success: 0, failure: 0 },
    staleCache: false,
    clientStaleFallback: false,
    summaryPartial: true,
    breakdownReady: false
  }
  let breakdownResult = {
    byCountry: [],
    byAgency: [],
    byRocket: [],
    countryOptions: [],
    breakdownReady: false
  }

  if (summarySettled.status === 'fulfilled') {
    summaryResult = summarySettled.value
  } else {
    const persist = readPersistedGlobalStats(year, countryKey)
    if (persist) {
      summaryResult = mapCloudPayload({
        ...persist,
        clientStaleFallback: true,
        staleCache: true
      }, { breakdownReady: false })
      if (onSummary) onSummary(summaryResult)
    } else {
      throw summarySettled.reason
    }
  }

  if (breakdownSettled.status === 'fulfilled') {
    breakdownResult = breakdownSettled.value
  } else {
    const persist = readPersistedGlobalStats(year, countryKey)
    if (persist && ((persist.byCountry || []).length || (persist.byAgency || []).length)) {
      breakdownResult = mapCloudPayload({
        ...persist,
        clientStaleFallback: true,
        staleCache: true,
        breakdownReady: true
      })
    } else if (summaryResult.summary && summaryResult.summary.total > 0) {
      breakdownResult = {
        ...breakdownResult,
        summary: summaryResult.summary,
        staleCache: summaryResult.staleCache,
        clientStaleFallback: summaryResult.clientStaleFallback,
        loadError: (breakdownSettled.reason && breakdownSettled.reason.message) || '明细加载失败'
      }
    } else {
      throw breakdownSettled.reason
    }
  }

  // 头部数字优先级：明细未截断时用明细 summary（含国家维度一致）；
  // 明细 partial（往年易发）时改用 getGlobalSummary 的 count-only 精确结果，
  // 避免 success+failure<total 的错误数字被显示。
  const breakdownPartial = !!breakdownResult.partial
  const breakdownSummaryUsable = breakdownResult.summary && breakdownResult.summary.total && !breakdownPartial
  const summaryFromCount = summaryResult.summary && summaryResult.summary.total
    ? summaryResult.summary
    : null

  return {
    ...summaryResult,
    ...breakdownResult,
    summary: breakdownSummaryUsable
      ? breakdownResult.summary
      : (summaryFromCount || breakdownResult.summary || summaryResult.summary),
    breakdownReady: !!breakdownResult.breakdownReady
      || (breakdownResult.byCountry || []).length > 0
      || (breakdownResult.byAgency || []).length > 0
  }
}

// ── 机构 logo / 火箭配置图装饰 ──────────────────────────────────────────

/** 行首字母占位（logo/图缺失时显示） */
function firstGlyphOfName(name) {
  const s = String(name || '').trim()
  return s ? s.charAt(0).toUpperCase() : '·'
}

let _agencyLogoMapPromise = null

/**
 * 机构名/缩写（小写）→ logo URL 映射。
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
        const url = logoUrlFromAgencyRecord(a)
        if (!url) continue
        const name = String((a && a.name) || '').trim().toLowerCase()
        const abbrev = String((a && a.abbrev) || '').trim().toLowerCase()
        if (name && !map.has(name)) map.set(name, url)
        if (abbrev && !map.has(abbrev)) map.set(abbrev, url)
      }
      map.set('spacex', SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL)
      return map
    })
    .catch(() => new Map())
  return _agencyLogoMapPromise
}

/**
 * 机构行补 logo：resolveAgencyLogoForDisplay 命中本地磁盘缓存时直接返回 wxfile 路径，
 * 否则返回远程 URL（页面 bindload 后由 persistAgencyLogoAfterRemoteLoad 落盘，下次零流量）。
 */
function decorateAgencyRows(rows, logoMap) {
  return (rows || []).map((row) => {
    const key = String(row.name || '').trim().toLowerCase()
    const remote = logoMap ? (logoMap.get(key) || '') : ''
    return {
      ...row,
      // 展示名走发射商词典（命中则中文）；row.name 保留英文供 logo 匹配
      displayName: translateAgencyName(row.name, row.abbrev) || row.name,
      logo: remote ? resolveAgencyLogoForDisplay(remote) : '',
      logoRemote: remote,
      initial: firstGlyphOfName(row.name)
    }
  })
}

/** 火箭行补配置图：getRocketImage 内置本地磁盘缓存（首次远程展示后后台落盘） */
function decorateRocketRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    image: getRocketImage(row.name) || '',
    initial: firstGlyphOfName(row.name)
  }))
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
  decorateRocketRows
}
