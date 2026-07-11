/**
 * getLaunchStats — LL2 官方数据源发射统计
 *
 * action:
 *   getGlobalStats      — 全球统计（按国家/机构/火箭聚合，兼容旧客户端）
 *   getGlobalSummary    — 全球汇总（total/success/failure，优先缓存，1–3 次 LL2）
 *   getGlobalBreakdown  — 全球明细（按国家/机构/火箭，优先 space_devs_cache）
 *   getMissionStats     — 任务详情火箭/机构/年内序号（用户路径 readOnly 只读 DB）
 *   getSummary          — 首页摘要（globalThisYear / spacexThisYear）
 *   refreshCurrentYear  — 定时器入口：全球统计 + 即将发射任务统计 预热落库
 *   prewarmMissionStats — 手动预热即将发射任务统计（读 launch_data，写 mission_ 与 count_ 缓存）
 *
 * 架构约定：LL2 只在定时任务/运维路径请求；小程序用户路径一律 readOnly 只读云数据库。
 *
 * 年份语义：UTC 自然年，以 LL2 字段 net 为准（net__gte / net__lt），
 * 与 syncLaunchStats 一致；不使用 window_start 做年界。
 *
 * LL2 速率限制：
 * - 仅尊重 LL2 真实 HTTP 429；不在云数据库维护额外「小时配额账本」
 * - 30 分钟结果缓存（CACHE_TTL_MS）减少重复请求
 * - 触达 LL2 429 时优先返回最长 24 小时内的陈旧缓存（STALE_CACHE_MAX_AGE_MS）
 * - 单次云函数调用内 MAX_API_CALLS_PER_RUN 防止翻页失控（非 LL2 官方限额）
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const LAUNCH_LIBRARY_API = 'https://ll.thespacedevs.com/2.3.0'
const SPACEX_LSP_ID = 121
const PAGE_LIMIT = 100
const MAX_PAGES = 20
const CACHE_COL = 'launch_stats_cache'
const CACHE_TTL_MS = 30 * 60 * 1000
const STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** 往年（非当前年）数据不再变化，长期缓存 30 天，避免重复打 LL2 配额 */
const PAST_YEAR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 往年「已算全（非 partial）」的缓存标记为 final：数据已固定，永久有效，读时忽略 TTL */
const FINAL_CACHE_MAX_AGE_MS = 3650 * 24 * 60 * 60 * 1000
/**
 * 缓存 schema 版本：升级该值即可一刀切作废所有旧文档（含 final）。
 * v2：修复「旧文档无 partial 字段被误判完整」「截断 summary 被固化 final」。
 * 部署前写入的脏文档没有 schemaVersion，会被 readCache 视为失效并重算。
 */
const CACHE_SCHEMA_VERSION = 2
/** 单次云函数调用内最多发出的 LL2 请求数（防翻页失控，与 LL2 官方小时限额无关） */
const MAX_API_CALLS_PER_RUN = 12
/** 统计页年份选择器下限（与 buildYearOptions minYear 对齐） */
const STATS_MIN_YEAR = 1957
/** 每轮定时预热最多处理的即将发射任务数（按 windowStart 升序，最近的优先） */
const MISSION_PREWARM_MAX = 20
/** 定时预热时 mission 缓存视为足够新的窗口（与 6h 定时器对齐，略小留余量） */
const MISSION_PREWARM_FRESH_MS = 4 * 60 * 60 * 1000

const ISO3_TO_ALPHA2 = {
  USA: 'US', US: 'US', CHN: 'CN', CN: 'CN', PRC: 'CN',
  RUS: 'RU', RU: 'RU', JPN: 'JP', JP: 'JP', IND: 'IN', IN: 'IN',
  KOR: 'KR', KR: 'KR', PRK: 'KP', KP: 'KP', FRA: 'FR', FR: 'FR',
  GBR: 'GB', UK: 'GB', GB: 'GB', DEU: 'DE', DE: 'DE', ITA: 'IT', IT: 'IT',
  ESA: 'EU', EU: 'EU', NZL: 'NZ', NZ: 'NZ', AUS: 'AU', AU: 'AU',
  CAN: 'CA', CA: 'CA', ISR: 'IL', IL: 'IL', IRN: 'IR', BRA: 'BR',
  UAE: 'AE', ARE: 'AE', SAU: 'SA', MEX: 'MX', KAZ: 'KZ'
}

const COUNTRY_DISPLAY = {
  USA: '美国', US: '美国', CHN: '中国', CN: '中国', PRC: '中国',
  RUS: '俄罗斯', RU: '俄罗斯', JPN: '日本', JP: '日本', IND: '印度', IN: '印度',
  KOR: '韩国', KR: '韩国', PRK: '朝鲜', KP: '朝鲜', FRA: '法国', FR: '法国',
  GBR: '英国', UK: '英国', GB: '英国', DEU: '德国', DE: '德国', ITA: '意大利', IT: '意大利',
  ESA: '欧空局', EU: '欧洲', NZL: '新西兰', NZ: '新西兰', AUS: '澳大利亚', AU: '澳大利亚',
  CAN: '加拿大', CA: '加拿大', ISR: '以色列', IL: '以色列', IRN: '伊朗', BRA: '巴西',
  UAE: '阿联酋', ARE: '阿联酋', SAU: '沙特', MEX: '墨西哥', KAZ: '哈萨克斯坦'
}

let _runApiCalls = 0

function resetRunApiBudget() {
  _runApiCalls = 0
}

async function fetchAPI(url) {
  if (_runApiCalls >= MAX_API_CALLS_PER_RUN) {
    const err = new Error(`单次云函数 LL2 请求已达上限（${MAX_API_CALLS_PER_RUN} 次）`)
    err.code = 'LL2_RUN_BUDGET'
    throw err
  }
  const data = await fetchAPIRaw(url)
  _runApiCalls += 1
  return data
}

function fetchAPIRaw(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const urlObj = new URL(url)
    const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; SpaceSync/1.0)',
      'Accept': 'application/json'
    }
    if (token) headers.Authorization = `Token ${token}`

    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 15000
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        const status = res.statusCode || 0
        if (status === 429) {
          let detail = ''
          try { detail = String((JSON.parse(data) || {}).detail || '') } catch (e2) {}
          console.warn('[stats] LL2 返回 429 throttled:', detail || data.slice(0, 120))
          const err = new Error('LL2 接口限流（429）' + (detail ? `: ${detail}` : ''))
          err.code = 'LL2_RATE_LIMIT'
          reject(err)
          return
        }
        if (status < 200 || status >= 300) {
          console.warn(`[stats] LL2 HTTP ${status}:`, data.slice(0, 120))
          reject(new Error(`LL2 HTTP ${status}`))
          return
        }
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

function buildYearRange(year) {
  const y = Number(year)
  return {
    year: y,
    yearStartIso: `${y}-01-01T00:00:00Z`,
    yearEndIso: `${y + 1}-01-01T00:00:00Z`,
    yearParams: {
      net__gte: `${y}-01-01T00:00:00Z`,
      net__lt: `${y + 1}-01-01T00:00:00Z`
    }
  }
}

function buildQueryString(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
}

/** 当前 UTC 自然年；仅当前年可信任 space_devs_cache 快速路径 */
function isCurrentYear(year) {
  return Number(year) === new Date().getUTCFullYear()
}

/** 往年（严格小于当前 UTC 年）：数据已固定，可标记 final 永久缓存 */
function isPastYear(year) {
  return Number(year) < new Date().getUTCFullYear()
}

/**
 * 明细缓存是否「已拉全」：不信任存储的 partial 字段（旧文档可能缺失），
 * 用 _launches.length 与 apiCount 实时比对重算完整性。
 * apiCount 缺失（count 端点失败/未知）时**视为不完整**，不得据此标 final，
 * 以便下次重算自愈（避免限流时把截断数据永久固化）。
 */
function isBreakdownComplete(payload) {
  if (!payload || !Array.isArray(payload._launches)) return false
  const apiCount = payload.apiCount
  if (!Number.isFinite(apiCount)) return false
  return payload._launches.length >= apiCount
}

/** 仅 LL2 真实 429；单次调用预算耗尽（LL2_RUN_BUDGET）不算限流 */
function isRateLimitError(err) {
  return !!(err && err.code === 'LL2_RATE_LIMIT')
}

function isRunBudgetError(err) {
  return !!(err && err.code === 'LL2_RUN_BUDGET')
}

/** 读年度明细缓存（允许陈旧，供零 LL2 组装；不受 30min 鲜缓存 TTL 限制） */
async function readYearLaunchesFromDb(year) {
  const doc = await readCache(`global_${year}`, { allowStale: true })
  if (!doc || !doc.payload || !Array.isArray(doc.payload._launches) || !doc.payload._launches.length) {
    return null
  }
  return {
    launches: doc.payload._launches,
    partial: !isBreakdownComplete(doc.payload),
    stale: !!doc.stale
  }
}

async function fetchPreviousLaunchCount(extraParams = {}) {
  const params = { limit: 1, mode: 'detailed', format: 'json', ...extraParams }
  const url = `${LAUNCH_LIBRARY_API}/launches/previous/?${buildQueryString(params)}`
  try {
    const res = await fetchAPI(url)
    const raw = res && res.count
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw !== '' ? Number(raw) : NaN)
    return Number.isFinite(n) ? n : null
  } catch (e) {
    if (isRateLimitError(e)) throw e
    if (isRunBudgetError(e)) return null
    console.warn('[stats] count 端点失败（按未知处理，不标 final）:', e && (e.message || e))
    return null
  }
}

/** 维度 count 缓存 TTL：型号/发射商的累计与年内计数变化缓慢，6 小时内跨任务复用 */
const DIM_COUNT_TTL_MS = 6 * 60 * 60 * 1000
/** count=0 短 TTL：首飞预热写入 0 后，避免 6h 内发射成功仍读到脏 0 */
const DIM_COUNT_ZERO_TTL_MS = 10 * 60 * 1000

function dimCountDocId(parts) {
  // encodeURIComponent 保证中文/特殊字符也能得到确定且不冲突的 docId（% 转为 x）
  const slug = parts
    .map((p) => encodeURIComponent(String(p).trim().toLowerCase()).replace(/%/g, 'x'))
    .join('_')
  return `count_${slug}`.slice(0, 120)
}

/**
 * 带 DB 缓存的 count：同一型号/发射商的 count 跨任务共享（如多枚 Falcon 9 任务
 * 只打一次 LL2），大幅降低详情页对小时配额的消耗。
 * 限流或 count 失败时回退陈旧缓存值（哪怕较旧），尽量不让详情页空数。
 * count===0 视为 soft-miss（短 TTL 或直接重拉），避免首飞成功后长时间卡在 0。
 */
async function fetchPreviousLaunchCountCached(docId, params, options = {}) {
  const skipWrite = !!options.skipWrite
  const noReadCache = !!options.noReadCache
  if (!noReadCache) {
    const cached = await readCache(docId, { maxAgeMs: DIM_COUNT_TTL_MS })
    if (cached && cached.payload && Number.isFinite(cached.payload.count)) {
      const n = cached.payload.count
      // 非 0：正常命中
      if (n !== 0) return n
      // 0：仅短窗内信任，超时则重拉（首飞成功后尽快对齐徽章）
      const age = cached.updatedAtMs != null ? (Date.now() - cached.updatedAtMs) : Infinity
      if (age < DIM_COUNT_ZERO_TTL_MS) return 0
    }
  }
  try {
    const n = await fetchPreviousLaunchCount(params)
    if (Number.isFinite(n)) {
      if (!skipWrite) await writeCache(docId, { count: n })
      return n
    }
  } catch (e) {
    if (!isRateLimitError(e) && !isRunBudgetError(e)) throw e
    const stale = await readCache(docId, { allowStale: true })
    if (stale && stale.payload && Number.isFinite(stale.payload.count)) return stale.payload.count
    throw e
  }
  const stale = await readCache(docId, { allowStale: true })
  if (stale && stale.payload && Number.isFinite(stale.payload.count)) return stale.payload.count
  return null
}

/** 任务是否已发生（net 已过）：用于「含本次」统计口径 */
function isMissionAlreadyLaunched(mission) {
  const t = mission && mission.launchTime ? new Date(mission.launchTime).getTime() : NaN
  return Number.isFinite(t) && t <= Date.now()
}

/** 已发生任务的 net__lte（含本次），与 resolveYearOrdinal / 徽章 attempt_count 对齐 */
function missionInclusiveNetLte(mission) {
  if (!isMissionAlreadyLaunched(mission)) return null
  return toLl2NetIso(mission.launchTime)
}

/**
 * 已发射任务若 rocketTotal/Year 仍为 0，视为预热脏缓存（首飞成功后未刷新）。
 * 用于 readOnly 命中与预热跳过判断。
 */
function isMissionStatsStaleAfterLaunch(payload, mission) {
  if (!payload || !isMissionAlreadyLaunched(mission)) return false
  const rocketName = resolveMissionRocketName(mission)
  if (rocketName && payload.rocketTotal === 0) return true
  if (rocketName && payload.rocketYear === 0) {
    const y = new Date(mission.launchTime).getUTCFullYear()
    if (Number(payload.year) === y || y === new Date().getUTCFullYear()) return true
  }
  return false
}

async function removeCache(docId) {
  try {
    await db.collection(CACHE_COL).doc(docId).remove()
    return true
  } catch (e) {
    return false
  }
}

function toLl2NetIso(launchTime) {
  const t = new Date(launchTime).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString()
}

/** 用 count(net__lte) 替代全年分页，单次 LL2 请求即可得到年内序号 */
async function resolveYearOrdinal(mission, yearParams) {
  const missionId = String((mission && mission.id) || '').trim()
  const launchTime = mission && mission.launchTime

  // 待发任务（net 在未来）：previous 端点不含自身及排在其前的待发，序号会偏小；
  // 不展示预估序号（详情页显示「—」），避免误导且零额外 LL2。
  if (launchTime) {
    const t = new Date(launchTime).getTime()
    if (Number.isFinite(t) && t > Date.now()) return null
  }

  if (launchTime) {
    const netLte = toLl2NetIso(launchTime)
    if (netLte) {
      const count = await fetchPreviousLaunchCount({ ...yearParams, net__lte: netLte })
      if (count != null && count > 0) return count
    }
  }

  if (missionId) {
    try {
      const batch = await fetchPreviousLaunches({ ...yearParams, limit: 100 })
      const idx = batch.findIndex((l) => String(l.id) === missionId)
      if (idx >= 0) return idx + 1
    } catch (e) {
      if (isRateLimitError(e)) throw e
    }
  }

  return null
}

async function tryStalePayload(cacheKey, startTime, extra = {}) {
  const stale = await readCache(cacheKey, { allowStale: true })
  if (!stale || !stale.payload) return null
  return {
    success: true,
    fromCache: true,
    staleCache: true,
    ...extra,
    ...stale.payload,
    elapsed: Date.now() - startTime
  }
}

async function fetchPreviousLaunches(extraParams = {}) {
  const all = []
  let offset = 0
  let pages = 0

  while (pages < MAX_PAGES && _runApiCalls < MAX_API_CALLS_PER_RUN) {
    const params = {
      limit: PAGE_LIMIT,
      offset,
      ordering: 'net',
      mode: 'detailed',
      format: 'json',
      ...extraParams
    }
    const url = `${LAUNCH_LIBRARY_API}/launches/previous/?${buildQueryString(params)}`
    let res = null
    try {
      res = await fetchAPI(url)
    } catch (e) {
      if (isRateLimitError(e)) throw e
      res = null
    }
    const batch = (res && Array.isArray(res.results)) ? res.results : []
    if (!batch.length) break
    all.push(...batch)
    pages += 1
    if (!res.next) break
    offset += batch.length
  }

  const seen = new Set()
  return all.filter((launch) => {
    const id = launch && launch.id != null ? String(launch.id) : ''
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function countryCodeToFlagEmoji(code) {
  const raw = String(code || '').trim().toUpperCase()
  if (!raw) return '🏳️'
  const alpha2 = ISO3_TO_ALPHA2[raw] || (raw.length === 2 ? raw : '')
  if (!alpha2 || alpha2.length !== 2) return '🏳️'
  return String.fromCodePoint(...[...alpha2].map((c) => 127397 + c.charCodeAt(0)))
}

/**
 * 从 Country 对象/字符串中取国家码。
 * LL2 2.3.0 将原先字符串 country_code 改为嵌套 Country 对象
 * （含 alpha_2_code / alpha_3_code）；这里兼容三种形态：
 *   - 字符串（旧 country_code / slim 写入）
 *   - Country 对象（2.3.0：{ alpha_2_code, alpha_3_code }）
 *   - Country 数组（2.3.0 Agency.country 为数组）
 */
function pickCountryCode(src) {
  if (!src) return ''
  if (typeof src === 'string') return src.trim().toUpperCase()
  if (Array.isArray(src)) {
    for (const item of src) {
      const c = pickCountryCode(item)
      if (c) return c
    }
    return ''
  }
  if (typeof src === 'object') {
    const a2 = src.alpha_2_code || src.alpha2 || ''
    const a3 = src.alpha_3_code || src.alpha3 || ''
    const code = String(a2 || a3 || src.code || '').trim().toUpperCase()
    if (code && code !== '??' && code !== '???') return code
  }
  return ''
}

/**
 * 提取发射所属国家码，按优先级兼容 2.3.0 嵌套 Country 与旧版扁平 country_code：
 *   1. pad.country（2.3.0 Pad.country）
 *   2. pad.location.country（2.3.0 Location.country）
 *   3. pad.location.country_code（旧版扁平 / slim 写入）
 *   4. launch_service_provider.country（2.3.0 Agency.country 数组）
 *   5. launch_service_provider.country_code（旧版扁平）
 */
function extractCountryCode(launch) {
  const pad = launch && launch.pad
  const loc = pad && pad.location
  let code = ''
  if (pad) code = pickCountryCode(pad.country)
  if (!code && pad && pad.country_code) code = pickCountryCode(pad.country_code)
  if (!code && loc) code = pickCountryCode(loc.country)
  if (!code && loc && loc.country_code) code = pickCountryCode(loc.country_code)
  const lsp = launch && launch.launch_service_provider
  if (!code && lsp) code = pickCountryCode(lsp.country)
  if (!code && lsp && lsp.country_code) code = pickCountryCode(lsp.country_code)
  return code
}

function getCountryDisplayFromLaunch(launch) {
  const code = extractCountryCode(launch)
  return COUNTRY_DISPLAY[code] || code || '未知'
}

function classifyOutcome(launch) {
  const status = launch && launch.status
  const id = status && status.id
  // LL2 官方 config/launch_statuses：3=成功，4=失败，7=部分失败，
  // 5=On Hold（不是失败），1/2/6/8/9=进行中或待定（既不计成功也不计失败）
  if (id === 3) return { success: true, failure: false }
  if (id === 4 || id === 7) return { success: false, failure: true }
  if (id === 5) return { success: false, failure: false }
  const cat = String((status && status.name) || '').toLowerCase()
  if (cat.includes('partial')) return { success: false, failure: true }
  if (cat.includes('fail')) return { success: false, failure: true }
  if (cat.includes('success')) return { success: true, failure: false }
  return { success: false, failure: false }
}

function getAgencyName(launch) {
  const lsp = launch && launch.launch_service_provider
  return (lsp && (lsp.name || lsp.abbrev)) || '未知机构'
}

function getRocketName(launch) {
  const cfg = launch && launch.rocket && launch.rocket.configuration
  if (!cfg) return '未知型号'
  // 与任务详情统计对齐：统一使用 configuration.name（如 Falcon 9）做聚合 key，
  // 避免 full_name（如 Falcon 9 Block 5）导致全球统计 vs 详情页数据不一致。
  const name = String(cfg.name || '').trim()
  if (name) return name
  return String(cfg.full_name || '').trim() || '未知型号'
}

/** 与 LL2 count 过滤 rocket__configuration__name 对齐（Falcon 9 Block 5 → Falcon 9） */
function rocketFilterNameFromSlimLaunch(launch) {
  const cfg = launch && launch.rocket && launch.rocket.configuration
  if (!cfg) return ''
  const name = String(cfg.name || '').trim()
  if (name) return name
  const full = String(cfg.full_name || '').trim()
  if (!full) return ''
  const blockIdx = full.indexOf(' Block')
  if (blockIdx > 0) return full.slice(0, blockIdx).trim()
  return full
}

function launchMatchesRocketFilter(launch, rocketName) {
  const target = String(rocketName || '').trim()
  if (!target) return false
  const filterName = rocketFilterNameFromSlimLaunch(launch)
  if (!filterName) return false
  if (filterName.toLowerCase() === target.toLowerCase()) return true
  const full = String((launch && launch.rocket && launch.rocket.configuration && launch.rocket.configuration.full_name) || '').trim()
  return full.toLowerCase().startsWith(target.toLowerCase())
}

function launchMatchesAgencyFilter(launch, mission) {
  const agencyName = getAgencyName(launch)
  const targetName = String((mission && mission.launchAgency) || (mission && mission.launchAgencyAbbrev) || '').trim()
  if (targetName && agencyName.toLowerCase() === targetName.toLowerCase()) return true
  const lsp = launch && launch.launch_service_provider
  const targetId = mission && mission.launchAgencyId != null && mission.launchAgencyId !== ''
    ? Number(mission.launchAgencyId) : null
  if (targetId != null && lsp && Number(lsp.id) === targetId) return true
  return false
}

/**
 * 把 LL2 launch 对象压成 slim 投影：只保留聚合所需字段，约 150 字节/条。
 * 解决 detailed 全量对象（~44KB/条）整存超过 CloudBase 1MB 文档上限、
 * 导致缓存写入静默失败、final 永不命中、每次重新全量翻页的 30s 根因。
 * slim 形状刻意复用现有访问器（classifyOutcome / extractCountryCode /
 * getAgencyName / getRocketName），保证聚合逻辑零改动、数字不变。
 */
function toSlimLaunch(launch) {
  const status = launch && launch.status
  const lsp = launch && launch.launch_service_provider
  const cfg = launch && launch.rocket && launch.rocket.configuration
  return {
    id: launch && launch.id,
    status: { id: status && status.id, name: (status && status.name) || '' },
    pad: { country_code: extractCountryCode(launch) },
    launch_service_provider: {
      id: lsp && lsp.id != null ? lsp.id : null,
      name: (lsp && (lsp.name || lsp.abbrev)) || ''
    },
    rocket: {
      configuration: {
        name: (cfg && cfg.name) || '',
        full_name: (cfg && (cfg.full_name || cfg.name)) || ''
      }
    }
  }
}

function bumpBucket(map, key, meta, launch) {
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
  const outcome = classifyOutcome(launch)
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

function aggregateLaunches(launches) {
  const byCountry = new Map()
  const byAgency = new Map()
  const byRocket = new Map()
  let success = 0
  let failure = 0

  launches.forEach((launch) => {
    const countryKey = getCountryDisplayFromLaunch(launch)
    bumpBucket(byCountry, countryKey, {
      name: countryKey,
      flag: countryCodeToFlagEmoji(extractCountryCode(launch))
    }, launch)

    const agencyKey = getAgencyName(launch)
    bumpBucket(byAgency, agencyKey, { name: agencyKey, flag: '' }, launch)

    const rocketKey = getRocketName(launch)
    bumpBucket(byRocket, rocketKey, { name: rocketKey, flag: '' }, launch)

    const o = classifyOutcome(launch)
    if (o.success) success += 1
    if (o.failure) failure += 1
  })

  return {
    total: launches.length,
    success,
    failure,
    byCountry: finalizeBuckets(byCountry),
    byAgency: finalizeBuckets(byAgency),
    byRocket: finalizeBuckets(byRocket)
  }
}

function buildCountryOptions(launches) {
  const bucket = new Map()
  launches.forEach((launch) => {
    const key = getCountryDisplayFromLaunch(launch)
    const prev = bucket.get(key) || { key, label: key, flag: countryCodeToFlagEmoji(
      extractCountryCode(launch)
    ), count: 0 }
    prev.count += 1
    bucket.set(key, prev)
  })
  const countries = Array.from(bucket.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return String(a.label).localeCompare(String(b.label), 'zh')
  })
  return [
    { key: '_all', label: '全部国家', flag: '🌍', count: launches.length },
    ...countries
  ]
}

async function readCache(docId, options = {}) {
  const allowStale = !!options.allowStale
  const freshTtlMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : CACHE_TTL_MS
  const maxAgeMs = allowStale ? Math.max(STALE_CACHE_MAX_AGE_MS, freshTtlMs) : freshTtlMs
  try {
    const res = await db.collection(CACHE_COL).doc(docId).get()
    const doc = res && res.data
    if (!doc || !doc.payload) return null
    const schemaOk = doc.schemaVersion === CACHE_SCHEMA_VERSION
    // 正常（非兜底）读取：schema 不匹配的旧脏文档一律失效，强制用新逻辑实时重算。
    // 兜底读取（allowStale）：即使 schema 不匹配也返回旧数据，避免重算失败时空屏。
    if (!schemaOk && !allowStale) return null
    // final 仅在 schema 匹配时享受“忽略 TTL 永久新鲜”；旧 schema 的 final 不再永久命中
    const isFinal = !!(doc.final || (doc.payload && doc.payload.final))
    const age = doc.updatedAtMs ? (Date.now() - doc.updatedAtMs) : Infinity
    if (isFinal && schemaOk) {
      return { payload: doc.payload, stale: false, updatedAtMs: doc.updatedAtMs, final: true, schemaMismatch: false }
    }
    if (doc.updatedAtMs && age < maxAgeMs) {
      return {
        payload: doc.payload,
        stale: allowStale && (age >= freshTtlMs || !schemaOk),
        schemaMismatch: !schemaOk,
        updatedAtMs: doc.updatedAtMs
      }
    }
  } catch (e) {}
  return null
}

async function writeCache(docId, payload, options = {}) {
  const final = !!options.final
  try {
    await db.collection(CACHE_COL).doc(docId).set({
      data: {
        payload: final ? { ...payload, final: true } : payload,
        final,
        schemaVersion: CACHE_SCHEMA_VERSION,
        updatedAtMs: Date.now(),
        updatedAt: db.serverDate()
      }
    })
  } catch (e) {
    console.error('[stats] writeCache 失败 docId=' + docId + ' final=' + final + ':', e && (e.message || e))
  }
}

function filterLaunchesByCountry(launches, countryKey) {
  const list = Array.isArray(launches) ? launches : []
  if (!countryKey || countryKey === '_all') return list
  return list.filter((launch) => getCountryDisplayFromLaunch(launch) === countryKey)
}

async function fetchPreviousLaunchesPage(extraParams = {}, offset = 0) {
  const params = {
    limit: PAGE_LIMIT,
    offset,
    ordering: 'net',
    mode: 'normal',
    format: 'json',
    ...extraParams
  }
  const url = `${LAUNCH_LIBRARY_API}/launches/previous/?${buildQueryString(params)}`
  const res = await fetchAPI(url)
  const batch = (res && Array.isArray(res.results)) ? res.results : []
  return { batch, count: (res && typeof res.count === 'number') ? res.count : null, hasNext: !!res.next }
}

async function fetchPreviousLaunchesOptimized(extraParams = {}) {
  let firstBatch = []
  let totalCount = null

  try {
    const [count, firstPage] = await Promise.all([
      fetchPreviousLaunchCount(extraParams),
      fetchPreviousLaunchesPage(extraParams, 0).catch(() => ({ batch: [], count: null, hasNext: false }))
    ])
    totalCount = count
    firstBatch = firstPage.batch || []
  } catch (e) {
    if (isRateLimitError(e)) throw e
    firstBatch = (await fetchPreviousLaunchesPage(extraParams, 0)).batch
  }

  const all = [...firstBatch]
  let offset = firstBatch.length
  const targetTotal = totalCount != null ? totalCount : null

  if (targetTotal != null && firstBatch.length >= PAGE_LIMIT && all.length < targetTotal) {
    // 已知总数：一次性并行拉取剩余页（受单次配额预算约束），避免串行逐页等待。
    const remaining = targetTotal - all.length
    const pagesNeeded = Math.ceil(remaining / PAGE_LIMIT)
    const budget = Math.max(0, MAX_API_CALLS_PER_RUN - _runApiCalls)
    const pagesToFetch = Math.min(pagesNeeded, budget)
    const jobs = []
    for (let i = 0; i < pagesToFetch; i += 1) {
      jobs.push(fetchPreviousLaunchesPage(extraParams, offset + i * PAGE_LIMIT)
        .catch(() => ({ batch: [], count: null, hasNext: false })))
    }
    const pages = await Promise.all(jobs)
    pages.forEach((p) => { if (p && p.batch && p.batch.length) all.push(...p.batch) })
  } else {
    const maxPagesAfterFirst = Math.max(0, MAX_API_CALLS_PER_RUN - _runApiCalls)
    for (let page = 1; page < maxPagesAfterFirst; page += 1) {
      if (targetTotal != null && all.length >= targetTotal) break
      const { batch } = await fetchPreviousLaunchesPage(extraParams, offset)
      if (!batch.length) break
      all.push(...batch)
      offset += batch.length
      if (batch.length < PAGE_LIMIT) break
    }
  }

  const seen = new Set()
  return {
    launches: all.filter((launch) => {
      const id = launch && launch.id != null ? String(launch.id) : ''
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    }),
    apiCount: totalCount,
    partial: targetTotal != null && all.length < targetTotal
  }
}

async function resolveGlobalYearLaunches(year, forceRefresh) {
  const cacheKey = `global_${year}`
  const currentYear = isCurrentYear(year)
  // 往年数据不再变化：命中长缓存（30 天）即可；当前年用 30 分钟短缓存
  const cacheMaxAgeMs = currentYear ? CACHE_TTL_MS : PAST_YEAR_CACHE_TTL_MS

  if (!forceRefresh) {
    const cached = await readCache(cacheKey, { maxAgeMs: cacheMaxAgeMs })
    // 不信任存储的 partial 字段（旧文档可能缺失），用 isBreakdownComplete 重算完整性。
    // 当前年容忍不完整（靠 TTL 刷新、受预算限制）；往年必须完整才复用，否则重算补全。
    const hasLaunches = cached && cached.payload && Array.isArray(cached.payload._launches)
    const complete = hasLaunches && isBreakdownComplete(cached.payload)
    const usable = hasLaunches && (currentYear || complete)
    if (usable) {
      return {
        launches: cached.payload._launches,
        apiCount: cached.payload.apiCount,
        fromCache: true,
        staleCache: false,
        partial: !complete,
        source: cached.payload.source || 'launch_stats_cache'
      }
    }
  }

  const { yearParams } = buildYearRange(year)

  // LL2 直连：不再读取 syncSpaceDevsData 写入的 slim space_devs_cache（字段被裁剪，
  // 是国家/数量长期不准的根因）。所有年份一律从 LL2 /launches/previous/ 按 net 年界
  // 直接分页拉取 mode=detailed 原始对象并聚合；launch_stats_cache 仅作速度层缓存。
  try {
    const fetched = await fetchPreviousLaunchesOptimized(yearParams)
    // 往年且确实拉全才标 final：要求 apiCount 来自成功的 count 端点（Number.isFinite）
    // 且 _launches.length >= apiCount。count 失败时 fetched.apiCount=null → 不完整 → 不标 final。
    const fetchedComplete = !fetched.partial && isBreakdownComplete({
      _launches: fetched.launches, apiCount: fetched.apiCount
    })
    const markFinal = isPastYear(year) && fetchedComplete
    // 只缓存 slim 投影（~150B/条），避免 detailed/normal 全量对象整存超过 1MB 文档上限
    const slimLaunches = fetched.launches.map(toSlimLaunch)
    await writeCache(cacheKey, {
      // 保留真实 apiCount（count 失败时为 null）：不伪造成 launches.length，
      // 否则读时会自我确认完整、永久无法自愈（H2）。
      apiCount: Number.isFinite(fetched.apiCount) ? fetched.apiCount : null,
      _launches: slimLaunches,
      countryOptions: buildCountryOptions(fetched.launches),
      filters: yearParams,
      source: 'll2_previous_net',
      partial: !!fetched.partial
    }, { final: markFinal })
    return {
      launches: fetched.launches,
      apiCount: fetched.apiCount,
      fromCache: false,
      staleCache: false,
      partial: !!fetched.partial,
      source: 'll2_previous_net'
    }
  } catch (e) {
    const stale = await readCache(cacheKey, { allowStale: true })
    if (stale && stale.payload && Array.isArray(stale.payload._launches)) {
      // 兜底复用旧明细（含 schema 不匹配）防空屏，但用实时完整性重算 partial，
      // 使 getGlobalBreakdownAction 的 exactCounts 回填能纠正头部数字。
      return {
        launches: stale.payload._launches,
        apiCount: stale.payload.apiCount,
        fromCache: true,
        staleCache: true,
        partial: !isBreakdownComplete(stale.payload),
        source: stale.payload.source || 'launch_stats_cache'
      }
    }
    throw e
  }
}

function buildScopedGlobalResponse(year, countryKey, launches, apiCount, meta = {}) {
  const scopedLaunches = filterLaunchesByCountry(launches, countryKey)
  const aggregated = aggregateLaunches(scopedLaunches)
  const countryOptions = buildCountryOptions(launches)
  const useApiTotal = countryKey === '_all' && apiCount != null
  // _all 头部数字一律以 LL2 精确 count 为准（exactCounts），避免翻页被截断/限流时
  // success/failure 漏统计导致 success+failure<total（往年尤其明显）。
  const exact = (countryKey === '_all' && meta.exactCounts) ? meta.exactCounts : null
  const summaryTotal = exact && exact.total != null ? exact.total : (useApiTotal ? apiCount : aggregated.total)
  const summarySuccess = exact && exact.success != null ? exact.success : aggregated.success
  const summaryFailure = exact && exact.failure != null ? exact.failure : aggregated.failure

  return {
    success: true,
    year,
    countryKey,
    source: meta.source || 'll2_previous_net',
    apiCount: summaryTotal,
    summary: {
      total: summaryTotal,
      success: summarySuccess,
      failure: summaryFailure
    },
    byCountry: aggregated.byCountry,
    byAgency: aggregated.byAgency,
    byRocket: aggregated.byRocket,
    countryOptions,
    launchCountListed: scopedLaunches.length,
    filters: buildYearRange(year).yearParams,
    fromCache: !!meta.fromCache,
    staleCache: !!meta.staleCache,
    partial: !!meta.partial,
    ...meta.extra
  }
}

async function getGlobalStatsAction(event) {
  return getGlobalBreakdownAction(event)
}

async function fetchSummaryCountsFast(yearParams) {
  // 注：本函数用 LL2 count 端点（limit=1 只取 count 字段）按「年×状态」轻量计数，
  // 是年度统计的实时数据源。后续若需人工校验/兜底，可对照 Wikipedia 年度发射页
  // （如 en.wikipedia.org/wiki/2025_in_spaceflight）核对总数——此处不实现抓取，
  // 仅作为未来兜底校验的占位说明（避免引入脆弱的页面解析）。
  // TODO(fallback): 可选地引入 Wikipedia 年度总数做一致性告警，但不作为数据源。
  // LL2 官方过滤器为 status__ids（复数，可逗号多值）。此前误用 status__id（单数），
  // LL2 会忽略未知参数并返回全量 count，导致 success=total、failure=2×total（138/276 即此 bug）。
  // 失败 = 4(Launch Failure) + 7(Partial Failure)；5 是 On Hold 不计失败。
  const jobs = [
    fetchPreviousLaunchCount(yearParams).then((n) => ({ key: 'total', value: n })),
    fetchPreviousLaunchCount({ ...yearParams, status__ids: 3 }).then((n) => ({ key: 'success', value: n })),
    fetchPreviousLaunchCount({ ...yearParams, status__ids: '4,7' }).then((n) => ({ key: 'failure', value: n }))
  ]
  const out = { total: null, success: null, failure: null }
  const results = await Promise.all(jobs)
  results.forEach((item) => {
    if (!item || item.value == null) return
    if (item.key === 'total') out.total = item.value
    if (item.key === 'success') out.success = item.value
    if (item.key === 'failure') out.failure = item.value
  })
  // 一致性兜底：success/failure 不应超过 total
  if (out.total != null) {
    if (out.success != null && out.success > out.total) out.success = out.total
    if (out.failure != null) {
      const maxFail = out.total - (out.success != null ? out.success : 0)
      if (out.failure > maxFail) out.failure = Math.max(0, maxFail)
    }
  }
  return out
}

async function readGlobalYearLaunchesCachedOnly(year, forceRefresh) {
  const cacheKey = `global_${year}`
  if (forceRefresh) return null
  const cacheMaxAgeMs = isCurrentYear(year) ? CACHE_TTL_MS : PAST_YEAR_CACHE_TTL_MS

  const cached = await readCache(cacheKey, { maxAgeMs: cacheMaxAgeMs })
  if (cached && cached.payload && Array.isArray(cached.payload._launches)) {
    const complete = isBreakdownComplete(cached.payload)
    // 当前年容忍不完整；往年必须完整才复用（重算 partial，不信任存储字段）
    if (isCurrentYear(year) || complete) {
      return {
        launches: cached.payload._launches,
        apiCount: cached.payload.apiCount,
        fromCache: true,
        staleCache: false,
        partial: !complete,
        source: cached.payload.source || 'launch_stats_cache'
      }
    }
  }

  const stale = await readCache(cacheKey, { allowStale: true })
  // schema 不匹配的旧脏明细不在这里复用（否则会用截断数据短路掉精确 count 路径）；
  // 它仅作为后续“实时算也失败”时的最终空屏兜底，由上层 summary 的 staleSummary 处理。
  if (stale && stale.payload && Array.isArray(stale.payload._launches) && !stale.schemaMismatch) {
    return {
      launches: stale.payload._launches,
      apiCount: stale.payload.apiCount,
      fromCache: true,
      staleCache: true,
      partial: !isBreakdownComplete(stale.payload),
      source: stale.payload.source || 'launch_stats_cache'
    }
  }

  return null
}

async function getGlobalSummaryAction(event) {
  const startTime = Date.now()
  const year = Number(event.year) || new Date().getUTCFullYear()
  const countryKey = String(event.countryKey || '_all').trim()
  const forceRefresh = !!event.forceRefresh
  // readOnly：用户请求路径，只读 DB 缓存，命中不到也绝不打 LL2（由定时任务/运维脚本预生成）
  const readOnly = !!event.readOnly
  const cacheKey = `global_summary_${year}_${countryKey}`

  if (!forceRefresh) {
    const cached = await readCache(cacheKey)
    if (cached && cached.payload && cached.payload.summary) {
      return {
        success: true,
        fromCache: true,
        staleCache: false,
        year,
        countryKey,
        ...cached.payload,
        elapsed: Date.now() - startTime
      }
    }
  }

  const finishFromLaunches = async (resolved) => {
    const scoped = buildScopedGlobalResponse(
      year,
      countryKey,
      resolved.launches,
      resolved.apiCount,
      {
        source: resolved.source,
        fromCache: resolved.fromCache,
        staleCache: resolved.staleCache,
        partial: resolved.partial
      }
    )
    const payload = {
      summary: scoped.summary,
      summaryPartial: false,
      source: scoped.source,
      partial: scoped.partial
    }
    if (countryKey === '_all' && !resolved.staleCache) {
      // 标 final 前必须确认完整：往年 + 非 partial + summary 自洽(success+failure<=total)。
      // 杜绝把基于截断数据的错误 summary 永久固化。
      const s = scoped.summary || {}
      const selfConsistent = s.total != null
        && (s.success || 0) + (s.failure || 0) <= s.total
      const canFinal = isPastYear(year) && !scoped.partial && selfConsistent
      await writeCache(cacheKey, payload, { final: canFinal })
    }
    return {
      success: true,
      fromCache: resolved.fromCache,
      staleCache: resolved.staleCache,
      year,
      countryKey,
      ...payload,
      elapsed: Date.now() - startTime
    }
  }

  try {
    const cachedYear = await readGlobalYearLaunchesCachedOnly(year, forceRefresh)
    if (cachedYear && cachedYear.launches.length) {
      return finishFromLaunches(cachedYear)
    }

    if (!readOnly && countryKey === '_all') {
      const { yearParams } = buildYearRange(year)
      const counts = await fetchSummaryCountsFast(yearParams)
      if (counts.total != null) {
        const summaryComplete = counts.success != null && counts.failure != null
        const payload = {
          summary: {
            total: counts.total,
            success: counts.success != null ? counts.success : 0,
            failure: counts.failure != null ? counts.failure : 0
          },
          summaryPartial: counts.success == null && counts.failure == null,
          source: 'll2_previous_net'
        }
        // 往年且 count 三项齐全：精确且不可变，标记 final 永久缓存
        await writeCache(cacheKey, payload, { final: isPastYear(year) && summaryComplete })
        return {
          success: true,
          fromCache: false,
          staleCache: false,
          year,
          countryKey,
          ...payload,
          elapsed: Date.now() - startTime
        }
      }
    }
  } catch (e) {
    if (!isRateLimitError(e)) throw e
  }

  const staleSummary = await readCache(cacheKey, { allowStale: true })
  if (staleSummary && staleSummary.payload && staleSummary.payload.summary) {
    return {
      success: true,
      fromCache: true,
      staleCache: true,
      year,
      countryKey,
      ...staleSummary.payload,
      elapsed: Date.now() - startTime
    }
  }

  const staleYear = await readGlobalYearLaunchesCachedOnly(year, false)
  if (staleYear && staleYear.launches.length) {
    return finishFromLaunches(staleYear)
  }

  return {
    success: false,
    error: readOnly ? '统计数据生成中，请稍后再试' : '暂无可用统计数据',
    // readOnly 下未命中不是限流，而是“后台尚未预生成”，前端据此显示占位而非繁忙错误
    notReady: readOnly,
    rateLimited: !readOnly,
    elapsed: Date.now() - startTime
  }
}

async function getGlobalBreakdownAction(event) {
  const startTime = Date.now()
  const year = Number(event.year) || new Date().getUTCFullYear()
  const countryKey = String(event.countryKey || '_all').trim()
  const forceRefresh = !!event.forceRefresh
  // readOnly：用户请求路径，只读 DB 年度明细缓存（_all 命中后按国家过滤聚合，无需 LL2）；
  // DB 没有该年度明细时返回 notReady，由定时任务/运维脚本预生成，绝不在用户请求里打 LL2。
  const readOnly = !!event.readOnly

  try {
    const resolved = readOnly
      ? await readGlobalYearLaunchesCachedOnly(year, forceRefresh)
      : await resolveGlobalYearLaunches(year, forceRefresh)
    if (readOnly && (!resolved || !Array.isArray(resolved.launches) || !resolved.launches.length)) {
      return {
        success: false,
        error: '统计数据生成中，请稍后再试',
        notReady: true,
        year,
        countryKey,
        elapsed: Date.now() - startTime
      }
    }
    // 明细被截断（partial）且为全部国家时，用 count-only 端点补一份精确头部，
    // 避免往年（条数多、易被预算/配额截断）出现 success+failure<total 的错误数字。
    // readOnly 不补 exactCounts（那会打 LL2）；头部数字由 _all 明细聚合或 final 缓存保证。
    let exactCounts = null
    if (!readOnly && countryKey === '_all' && resolved.partial) {
      try {
        exactCounts = await fetchSummaryCountsFast(buildYearRange(year).yearParams)
      } catch (e) {
        if (!isRateLimitError(e)) throw e
      }
    }
    const response = buildScopedGlobalResponse(
      year,
      countryKey,
      resolved.launches,
      resolved.apiCount,
      {
        source: resolved.source,
        fromCache: resolved.fromCache,
        staleCache: resolved.staleCache,
        partial: resolved.partial,
        exactCounts
      }
    )
    return {
      ...response,
      elapsed: Date.now() - startTime
    }
  } catch (e) {
    const stale = await readCache(`global_${year}`, { allowStale: true })
    if (stale && stale.payload && Array.isArray(stale.payload._launches)) {
      const response = buildScopedGlobalResponse(
        year,
        countryKey,
        stale.payload._launches,
        stale.payload.apiCount,
        {
          source: stale.payload.source || 'launch_stats_cache',
          fromCache: true,
          staleCache: true,
          partial: !isBreakdownComplete(stale.payload)
        }
      )
      return { ...response, elapsed: Date.now() - startTime }
    }
    if (e && e.code === 'LL2_RATE_LIMIT') {
      return {
        success: false,
        error: e.message,
        rateLimited: true,
        elapsed: Date.now() - startTime
      }
    }
    throw e
  }
}

function normalizeText(v) {
  return String(v || '').trim().toLowerCase()
}

function buildRocketFilterParams(rocketName) {
  const name = String(rocketName || '').trim()
  if (!name || name === '未知火箭') return null
  // rocketName 来自 configuration.name（如「Falcon 9」），而非 full_name（「Falcon 9 Block 5」）。
  // LL2 的 rocket__configuration__full_name 为精确匹配，传 name 永远匹配不到 → count=0。
  // 必须用 rocket__configuration__name 才能匹配（实测 Falcon 9：name→649、full_name→0）。
  return { rocket__configuration__name: name }
}

/** 从 mission 对象解析 LL2 火箭型号名（兼容详情页 rocketConfiguration 快照） */
function resolveMissionRocketName(mission) {
  if (!mission) return ''
  let name = String(mission.rocketName || '').trim()
  if ((!name || name === '未知火箭') && mission.rocketConfiguration) {
    const cfg = mission.rocketConfiguration
    name = String((cfg && (cfg.name || cfg.full_name)) || '').trim()
  }
  return name === '未知火箭' ? '' : name
}

function buildAgencyFilterParams(mission) {
  if (!mission) return null
  if (mission.launchAgencyId != null && mission.launchAgencyId !== '') {
    return { lsp__id: Number(mission.launchAgencyId) }
  }
  const name = String(mission.launchAgency || mission.launchAgencyAbbrev || '').trim()
  if (!name) return null
  return { lsp__name: name }
}

/**
 * SpaceX 年内发射数：优先 lsp__id，退化 lsp__name。
 * @param {Object} yearParams net 年界过滤
 * @param {number|null} knownGlobal 调用方已算好的全球总数（复用可省一次 LL2 调用/预算）
 * 全球总数较大而 SpaceX 计数为 0 几乎不可能（历年占比约一半），视为查询异常跳过；
 * 全部变体失败返回 null，由调用方回捞旧缓存兜底——绝不能把「未知」当成 0。
 */
async function fetchSpacexCountWithFallback(yearParams, knownGlobal) {
  const global = knownGlobal != null ? knownGlobal : await fetchPreviousLaunchCount(yearParams)
  const variants = [
    { lsp__id: SPACEX_LSP_ID, ...yearParams },
    { lsp__name: 'SpaceX', ...yearParams }
  ]
  for (const params of variants) {
    const count = await fetchPreviousLaunchCount(params)
    if (count == null) continue
    if (count === 0 && global != null && global >= 10) continue
    if (global == null || count <= global) return count
  }
  return null
}

async function getSummaryAction(event) {
  const startTime = Date.now()
  const year = Number(event.year) || new Date().getUTCFullYear()
  const forceRefresh = !!event.forceRefresh
  const readOnly = !!event.readOnly
  const cacheKey = `summary_${year}`

  if (!forceRefresh) {
    const cached = await readCache(cacheKey)
    if (cached && isHomeSummaryPayloadValid(cached.payload, year)) {
      return { success: true, fromCache: true, staleCache: false, ...cached.payload, elapsed: Date.now() - startTime }
    }
  }

  // readOnly：只读 DB（含陈旧兜底），不打 LL2；未命中返回 notReady 由定时任务预生成
  if (readOnly) {
    const stale = await readCache(cacheKey, { allowStale: true })
    if (stale && isHomeSummaryPayloadValid(stale.payload, year)) {
      return { success: true, fromCache: true, staleCache: true, ...stale.payload, elapsed: Date.now() - startTime }
    }
    return { success: false, error: '统计数据生成中，请稍后再试', notReady: true, year, elapsed: Date.now() - startTime }
  }

  const { yearParams } = buildYearRange(year)
  let globalThisYear = null
  let spacexThisYear = null

  try {
    // 与 getGlobalSummary 同源：fetchSummaryCountsFast 的 total，避免单 count 失败被写成 0
    const counts = await fetchSummaryCountsFast(yearParams)
    globalThisYear = counts.total
    spacexThisYear = await fetchSpacexCountWithFallback(yearParams, globalThisYear)
  } catch (e) {
    const staleHit = await tryStalePayload(cacheKey, startTime, {
      rateLimited: !!(e && e.code === 'LL2_RATE_LIMIT')
    })
    if (staleHit && isHomeSummaryPayloadValid(staleHit, year)) return staleHit
    if (e && e.code === 'LL2_RATE_LIMIT') {
      return {
        success: false,
        error: e.message,
        rateLimited: true,
        elapsed: Date.now() - startTime
      }
    }
    throw e
  }

  if (globalThisYear == null) {
    const staleHit = await tryStalePayload(cacheKey, startTime, {})
    if (staleHit && isHomeSummaryPayloadValid(staleHit, year)) return staleHit
    return {
      success: false,
      error: '统计数据生成中，请稍后再试',
      notReady: true,
      year,
      elapsed: Date.now() - startTime
    }
  }

  // SpaceX 计数失败（限流/预算耗尽/查询异常）时回捞旧缓存值，绝不把「未知」固化成 0
  if (spacexThisYear == null) {
    const prev = await readCache(cacheKey, { allowStale: true })
    const prevVal = prev && prev.payload ? Number(prev.payload.spacexThisYear) : NaN
    if (Number.isFinite(prevVal) && prevVal > 0) spacexThisYear = prevVal
  }

  const payload = {
    year,
    globalThisYear,
    // 仍未知则写 null：前端对 null 隐藏该行，避免展示错误的 0
    spacexThisYear: spacexThisYear != null ? spacexThisYear : null,
    source: 'll2_previous_net',
    filters: yearParams,
    updatedAt: new Date().toISOString()
  }

  await writeCache(cacheKey, payload)

  return { success: true, fromCache: false, staleCache: false, ...payload, elapsed: Date.now() - startTime }
}

async function getMissionStatsAction(event) {
  const startTime = Date.now()
  const mission = event.mission || event
  const missionId = String((mission && mission.id) || '').trim()
  const launchTime = mission && mission.launchTime
  const year = launchTime
    ? new Date(launchTime).getUTCFullYear()
    : (Number(event.year) || new Date().getUTCFullYear())
  const { yearParams } = buildYearRange(year)
  const forceRefresh = !!event.forceRefresh
  const readOnly = !!event.readOnly
  const cacheKey = `mission_${missionId || String(mission.rocketName || 'unknown')}_${launchTime || year}`

  if (!forceRefresh) {
    const cached = await readCache(cacheKey)
    if (cached && isMissionPayloadValid(cached.payload) && !isMissionStatsStaleAfterLaunch(cached.payload, mission)) {
      const filled = applyAgencyAttemptHints({ ...cached.payload }, mission)
      if (filled.providerTotal !== cached.payload.providerTotal
        || filled.providerYear !== cached.payload.providerYear) {
        await writeCache(cacheKey, filled)
      }
      return { success: true, fromCache: true, staleCache: false, ...filled, elapsed: Date.now() - startTime }
    }
  }

  // readOnly（用户路径）：纯只读 DB，绝不打 LL2。统计由定时器（refreshCurrentYear →
  // prewarmUpcomingMissionStats）预生成落库；这里依次尝试：
  // 1) mission 级缓存（鲜/陈旧均可）；
  // 2) 维度 count 缓存零 LL2 组装（应对 net 变更导致 mission 缓存 key 漂移，
  //    或前端 launchTime 格式与预热侧不一致——同型号/同发射商照样能出数）；
  // 3) 都没有 → notReady 占位，等下一轮定时预热。
  if (readOnly) {
    const cachedStale = await readCache(cacheKey, { allowStale: true })
    if (cachedStale && isMissionPayloadValid(cachedStale.payload)
      && !isMissionStatsStaleAfterLaunch(cachedStale.payload, mission)) {
      // 完整则直接返回；不完整（累计/序号缺失）时用零 LL2 组装补缺并回写
      if (isMissionPayloadComplete(cachedStale.payload, mission)) {
        const filled = applyAgencyAttemptHints({ ...cachedStale.payload }, mission)
        return { success: true, fromCache: true, staleCache: !!cachedStale.stale, ...filled, elapsed: Date.now() - startTime }
      }
      const assembled = await assembleMissionStatsZeroLlm(mission, year, startTime)
      if (assembled) {
        const merged = applyAgencyAttemptHints(
          mergeMissionPayloads(cachedStale.payload, assembled.payload),
          mission
        )
        if (!isMissionStatsStaleAfterLaunch(merged, mission)) {
          await writeCache(cacheKey, merged)
          return { success: true, fromCache: true, staleCache: !!cachedStale.stale, ...merged, elapsed: Date.now() - startTime }
        }
      }
      const fallback = applyAgencyAttemptHints({ ...cachedStale.payload }, mission)
      if (fallback.providerTotal !== cachedStale.payload.providerTotal
        || fallback.providerYear !== cachedStale.payload.providerYear) {
        await writeCache(cacheKey, fallback)
      }
      return { success: true, fromCache: true, staleCache: !!cachedStale.stale, ...fallback, elapsed: Date.now() - startTime }
    }
    const assembled = await assembleMissionStatsZeroLlm(mission, year, startTime)
    if (assembled && !isMissionStatsStaleAfterLaunch(assembled.payload, mission)) {
      applyAgencyAttemptHints(assembled.payload, mission)
      await writeCache(cacheKey, assembled.payload)
      return { ...assembled.response, ...assembled.payload }
    }
    // 已发射但仍组装出 0：仍返回组装结果（至少有发射商等字段），并标 stale 促预热重算
    if (assembled) {
      applyAgencyAttemptHints(assembled.payload, mission)
      await writeCache(cacheKey, assembled.payload)
      return { ...assembled.response, ...assembled.payload, staleCache: true }
    }
    return { success: false, error: '统计数据生成中，请稍后再试', notReady: true, year, elapsed: Date.now() - startTime }
  }

  return await recomputeMissionStats(mission, year, yearParams, cacheKey, startTime, false)
}

/** 首页/日历 summary_<year> 缓存是否可用（排除旧 bug 把 null 写成 0 的脏文档） */
function isHomeSummaryPayloadValid(payload, year) {
  if (!payload || payload.globalThisYear == null) return false
  const n = Number(payload.globalThisYear)
  if (!Number.isFinite(n)) return false
  // 近年 previous 发射数不可能长期为 0（旧版 count 失败时误写 0）
  if (n === 0 && Number(year) >= new Date().getUTCFullYear() - 1) return false
  return true
}

/** mission 缓存 payload 是否为「有效统计」（区别于空壳/标记文档）：至少含一项计数或序号 */
function isMissionPayloadValid(payload) {
  if (!payload) return false
  return payload.rocketTotal != null || payload.providerTotal != null
    || payload.rocketYear != null || payload.providerYear != null
    || payload.yearOrdinal != null
}

/** payload 是否「完整」：应有的累计字段都已填上（年内字段由 valid 保证），用于预热跳过判断 */
function isMissionPayloadComplete(payload, mission) {
  if (!isMissionPayloadValid(payload)) return false
  const needRocket = !!resolveMissionRocketName(mission)
  const needAgency = !!(mission && ((mission.launchAgencyId != null && mission.launchAgencyId !== '') || String(mission.launchAgency || '').trim()))
  if (needRocket && payload.rocketTotal == null) return false
  if (needAgency && payload.providerTotal == null) return false
  if (payload.yearOrdinal == null) return false
  return true
}

/** 两份 mission payload 合并：a 优先，缺失字段用 b 补 */
function mergeMissionPayloads(a, b) {
  const out = { ...(b || {}), ...(a || {}) }
  const numFields = ['rocketTotal', 'rocketYear', 'providerTotal', 'providerYear', 'yearOrdinal']
  numFields.forEach((k) => {
    if (out[k] == null && b && b[k] != null) out[k] = b[k]
    if (out[k] == null && a && a[k] != null) out[k] = a[k]
  })
  return out
}

/**
 * 用详情页徽章同源的 agency_launch_attempt_count 回填发射商累计/本年空缺。
 * 仅在字段为 null 时写入，不覆盖已有 dim/LL2 结果。
 */
function applyAgencyAttemptHints(target, mission) {
  if (!target || !mission) return target
  const totalHint = Number(mission.agencyLaunchAttemptCount)
  const yearHint = Number(mission.agencyLaunchAttemptCountYear)
  if (target.providerTotal == null && Number.isFinite(totalHint) && totalHint > 0) {
    target.providerTotal = totalHint
  }
  if (target.providerYear == null && Number.isFinite(yearHint) && yearHint > 0) {
    target.providerYear = yearHint
  }
  return target
}

/** 年内已发射总数（零 LL2）：summary_<year> 优先，global_summary_<year>__all 兜底 */
async function readYearToDateTotal(year) {
  const home = await readCache(`summary_${year}`, { allowStale: true })
  if (home && isHomeSummaryPayloadValid(home.payload, year)) {
    return Number(home.payload.globalThisYear)
  }
  const gs = await readCache(`global_summary_${year}__all`, { allowStale: true })
  const total = gs && gs.payload && gs.payload.summary ? Number(gs.payload.summary.total) : NaN
  return Number.isFinite(total) && total > 0 ? total : null
}

/**
 * 待发任务「年内第几次」零 LL2 推算：年内已发射总数 + 该任务在待发队列（同年、按 net 升序）
 * 中的位置 + 1。基于 space_devs_cache upcoming 列表，与详情页展示语义一致（预计序号）。
 */
async function computeUpcomingYearOrdinal(mission, year) {
  const launchTime = mission && mission.launchTime
  if (!launchTime || !isCurrentYear(year)) return null
  const t = new Date(launchTime).getTime()
  if (!Number.isFinite(t) || new Date(t).getUTCFullYear() !== Number(year)) return null

  const ytd = await readYearToDateTotal(year)
  if (ytd == null) return null

  const upcoming = await readUpcomingLaunchesFromSpaceDevsCache()
  if (!upcoming.length) return null
  const sameYear = upcoming
    .map((l) => ({ id: String(l.id), net: l.net || l.window_start || '' }))
    .filter((x) => {
      if (!x.net) return false
      const tt = new Date(x.net).getTime()
      return Number.isFinite(tt) && new Date(tt).getUTCFullYear() === Number(year)
    })
    .sort((a, b) => new Date(a.net).getTime() - new Date(b.net).getTime())
  const idx = sameYear.findIndex((x) => x.id === String(mission.id))
  if (idx < 0) return null
  return ytd + idx + 1
}

async function readDimCountValue(docId) {
  const doc = await readCache(docId, { allowStale: true })
  return (doc && doc.payload && Number.isFinite(doc.payload.count)) ? doc.payload.count : null
}

/** 发射商维度缓存 key 候选：id 优先，再按名称（breakdown 种子可能只有 name） */
function agencyDimKeyCandidates(agencyParams, mission) {
  const keys = []
  if (agencyParams && agencyParams.lsp__id != null) keys.push(`lsp-${agencyParams.lsp__id}`)
  const name = String((agencyParams && agencyParams.lsp__name) || (mission && mission.launchAgency) || (mission && mission.launchAgencyAbbrev) || '').trim()
  if (name) keys.push(name)
  return [...new Set(keys)]
}

/**
 * 从已落库的 global_<year> 年度明细聚合年内计数，写入 count_* 维度缓存（零 LL2）。
 * refreshCurrentYear / prewarmMissionStats 在尝试 LL2 之前调用，配额用尽时详情页仍可出年内数据。
 */
async function seedDimCountsFromYearBreakdown(year) {
  const resolved = await readYearLaunchesFromDb(year)
  if (!resolved || !Array.isArray(resolved.launches) || !resolved.launches.length) {
    return { ok: false, reason: 'no_breakdown', year }
  }
  const rocketYear = new Map()
  const agencyYear = new Map()
  resolved.launches.forEach((launch) => {
    const rKey = rocketFilterNameFromSlimLaunch(launch)
    if (rKey) rocketYear.set(rKey, (rocketYear.get(rKey) || 0) + 1)
    const lsp = launch && launch.launch_service_provider
    const aKey = (lsp && lsp.id != null) ? `lsp-${lsp.id}` : getAgencyName(launch)
    if (aKey && aKey !== '未知机构') agencyYear.set(aKey, (agencyYear.get(aKey) || 0) + 1)
    const aName = getAgencyName(launch)
    if (aName && aName !== '未知机构') agencyYear.set(aName, (agencyYear.get(aName) || 0) + 1)
  })
  let written = 0
  for (const [name, count] of rocketYear) {
    await writeCache(dimCountDocId(['rocket', name, String(year)]), { count })
    written += 1
  }
  for (const [key, count] of agencyYear) {
    await writeCache(dimCountDocId(['agency', key, String(year)]), { count })
    written += 1
  }
  return { ok: true, year, written, rockets: rocketYear.size, agencies: agencyYear.size, partial: !!resolved.partial, stale: !!resolved.stale }
}

/** 直接从 global_<year> 明细为单个 mission 算年内计数（零 LL2） */
async function computeMissionCountsFromBreakdown(mission, year) {
  const resolved = await readYearLaunchesFromDb(year)
  if (!resolved || !Array.isArray(resolved.launches)) {
    return { rocketYear: null, providerYear: null, yearOrdinal: null }
  }
  const rocketName = resolveMissionRocketName(mission)
  let rocketYear = 0
  let providerYear = 0
  resolved.launches.forEach((launch) => {
    if (rocketName && launchMatchesRocketFilter(launch, rocketName)) rocketYear += 1
    if (launchMatchesAgencyFilter(launch, mission)) providerYear += 1
  })
  // 历史任务「年内第几次」：明细按 net 升序拉取并原序存储，数组下标 + 1 即年内序号
  const missionId = String((mission && mission.id) || '').trim()
  let yearOrdinal = null
  if (missionId) {
    const idx = resolved.launches.findIndex((l) => String((l && l.id) || '') === missionId)
    if (idx >= 0) yearOrdinal = idx + 1
  }
  return {
    rocketYear: rocketName ? rocketYear : null,
    providerYear: (mission.launchAgency || mission.launchAgencyId) ? providerYear : null,
    yearOrdinal
  }
}

/**
 * 用户路径零 LL2 组装：维度 count 缓存 + global_<year> 明细兜底合并。
 * 累计次数字段（rocketTotal/providerTotal）由预热阶段 LL2 落库的 count_*_all 提供；
 * 年内字段与「年内第几次」可纯 DB 推算。
 */
async function assembleMissionStatsZeroLlm(mission, year, startTime, options = {}) {
  const rocketName = resolveMissionRocketName(mission)
  const rocketParams = buildRocketFilterParams(rocketName)
  const agencyParams = buildAgencyFilterParams(mission)

  const counts = { rocketTotal: null, rocketYear: null, providerTotal: null, providerYear: null }
  if (rocketParams) {
    counts.rocketTotal = await readDimCountValue(dimCountDocId(['rocket', rocketName, 'all']))
    counts.rocketYear = await readDimCountValue(dimCountDocId(['rocket', rocketName, String(year)]))
  }
  if (agencyParams) {
    const agencyKeys = agencyDimKeyCandidates(agencyParams, mission)
    for (const key of agencyKeys) {
      if (counts.providerTotal == null) {
        counts.providerTotal = await readDimCountValue(dimCountDocId(['agency', key, 'all']))
      }
      if (counts.providerYear == null) {
        counts.providerYear = await readDimCountValue(dimCountDocId(['agency', key, String(year)]))
      }
    }
  }

  const fromBreakdown = await computeMissionCountsFromBreakdown(mission, year)
  // 明细含本次时优先采用更大的年内计数（纠正 dim 预热脏 0）
  if (fromBreakdown.rocketYear != null) {
    if (counts.rocketYear == null || counts.rocketYear < fromBreakdown.rocketYear) {
      const delta = fromBreakdown.rocketYear - (counts.rocketYear || 0)
      counts.rocketYear = fromBreakdown.rocketYear
      if (isMissionAlreadyLaunched(mission) && Number.isFinite(counts.rocketTotal) && delta > 0) {
        counts.rocketTotal += delta
      }
    }
  }
  if (fromBreakdown.providerYear != null) {
    if (counts.providerYear == null || counts.providerYear < fromBreakdown.providerYear) {
      const delta = fromBreakdown.providerYear - (counts.providerYear || 0)
      counts.providerYear = fromBreakdown.providerYear
      if (isMissionAlreadyLaunched(mission) && Number.isFinite(counts.providerTotal) && delta > 0) {
        counts.providerTotal += delta
      }
    }
  }
  // 已发射首飞：累计仍为 0 时至少抬到年内（或 1），与徽章「含本次」对齐
  if (isMissionAlreadyLaunched(mission)) {
    if (rocketParams && counts.rocketTotal === 0) {
      counts.rocketTotal = Math.max(1, counts.rocketYear || 0)
    }
    if (rocketParams && counts.rocketYear === 0 && fromBreakdown.rocketYear == null) {
      counts.rocketYear = 1
      if (counts.rocketTotal == null || counts.rocketTotal < 1) counts.rocketTotal = 1
    }
  }

  // 徽章同源 attempt count：回填发射商累计/本年（年度种子不写 *_all 时的主路径）
  applyAgencyAttemptHints(counts, mission)

  // 「年内第几次」三级取数：
  // 1) 历史任务：年度明细（net 升序）中的下标 + 1（最准确）
  // 2) 待发任务：预热侧 hint（年内已发数 + 待发队列位置）
  // 3) 用户路径待发任务：实时推算
  let yearOrdinal = fromBreakdown.yearOrdinal != null ? fromBreakdown.yearOrdinal : null
  if (yearOrdinal == null && Number.isFinite(options.yearOrdinalHint)) {
    yearOrdinal = options.yearOrdinalHint
  }
  if (yearOrdinal == null) {
    try {
      yearOrdinal = await computeUpcomingYearOrdinal(mission, year)
    } catch (e) {
      yearOrdinal = null
    }
  }

  const payload = {
    year,
    rocketLabel: rocketName || String(mission.rocketName || '').trim(),
    providerLabel: String(mission.launchAgency || mission.launchAgencyAbbrev || '').trim(),
    rocketTotal: counts.rocketTotal,
    rocketYear: counts.rocketYear,
    providerTotal: counts.providerTotal,
    providerYear: counts.providerYear,
    yearOrdinal,
    source: 'breakdown_dim_cache',
    filters: buildYearRange(year).yearParams
  }
  if (!isMissionPayloadValid(payload)) return null
  return {
    payload,
    response: { success: true, fromCache: true, staleCache: false, ...payload, elapsed: Date.now() - startTime }
  }
}

/**
 * 型号统计重算（打 LL2 count 端点）：count 正确性沿用 rocket__configuration__name（Falcon 9=649）。
 * graceful=true（readOnly 自预热）：限流/失败时返回 notReady 占位，不报错；
 * graceful=false（后台/forceRefresh）：保持原 rateLimited 错误语义。
 */
async function recomputeMissionStats(mission, year, yearParams, cacheKey, startTime, graceful) {
  const rocketName = resolveMissionRocketName(mission)
  const rocketParams = buildRocketFilterParams(rocketName)
  const agencyParams = buildAgencyFilterParams(mission)
  const netLte = missionInclusiveNetLte(mission)
  const inclusive = !!netLte
  // 含本次的 count 只写入 mission_ 缓存，禁止写回共享 count_*_all（避免污染其它任务）
  const dimWriteOpts = inclusive ? { skipWrite: true, noReadCache: true } : {}

  const countJobs = []
  if (rocketParams) {
    const rocketAllParams = inclusive ? { ...rocketParams, net__lte: netLte } : rocketParams
    const rocketYearParams = inclusive
      ? { ...rocketParams, ...yearParams, net__lte: netLte }
      : { ...rocketParams, ...yearParams }
    countJobs.push(fetchPreviousLaunchCountCached(dimCountDocId(['rocket', rocketName, 'all']), rocketAllParams, dimWriteOpts)
      .then((n) => ({ key: 'rocketTotal', value: n })))
    countJobs.push(fetchPreviousLaunchCountCached(dimCountDocId(['rocket', rocketName, String(year)]), rocketYearParams, dimWriteOpts)
      .then((n) => ({ key: 'rocketYear', value: n })))
  }
  if (agencyParams) {
    const agencyKey = agencyParams.lsp__id != null ? `lsp-${agencyParams.lsp__id}` : String(agencyParams.lsp__name || '')
    const agencyAllParams = inclusive ? { ...agencyParams, net__lte: netLte } : agencyParams
    const agencyYearParams = inclusive
      ? { ...agencyParams, ...yearParams, net__lte: netLte }
      : { ...agencyParams, ...yearParams }
    countJobs.push(fetchPreviousLaunchCountCached(dimCountDocId(['agency', agencyKey, 'all']), agencyAllParams, dimWriteOpts)
      .then((n) => ({ key: 'providerTotal', value: n })))
    countJobs.push(fetchPreviousLaunchCountCached(dimCountDocId(['agency', agencyKey, String(year)]), agencyYearParams, dimWriteOpts)
      .then((n) => ({ key: 'providerYear', value: n })))
  }

  if (!countJobs.length) {
    const errMsg = '缺少可用的火箭型号或发射商信息'
    if (graceful) {
      return { success: false, error: errMsg, notReady: true, year, elapsed: Date.now() - startTime }
    }
    return { success: false, error: errMsg, elapsed: Date.now() - startTime }
  }

  const counts = {
    rocketTotal: null,
    rocketYear: null,
    providerTotal: null,
    providerYear: null
  }
  let yearOrdinal = null
  let partialDueToRateLimit = false

  try {
    // 单个 count 失败不拖垮整批：能拿到几项算几项
    let rateLimitErr = null
    let runBudgetErr = null
    const countResults = await Promise.all(countJobs.map((job) => job.catch((e) => {
      if (isRateLimitError(e)) { rateLimitErr = e; return null }
      if (isRunBudgetError(e)) { runBudgetErr = e; return null }
      throw e
    })))
    countResults.forEach((item) => {
      if (item && item.key) counts[item.key] = item.value
    })
    const anyCount = Object.keys(counts).some((k) => Number.isFinite(counts[k]))
    if (!anyCount && rateLimitErr) throw rateLimitErr
    if (!anyCount && runBudgetErr) {
      return { success: false, error: runBudgetErr.message, runBudget: true, elapsed: Date.now() - startTime }
    }
    partialDueToRateLimit = !!(rateLimitErr || runBudgetErr)
    // 序号是锦上添花：限流时跳过（显示「—」），不要拖垮已拿到的 count
    if (!rateLimitErr) {
      try {
        yearOrdinal = await resolveYearOrdinal(mission, yearParams)
      } catch (eOrd) {
        if (!isRateLimitError(eOrd)) throw eOrd
        console.warn('[stats] yearOrdinal 限流，跳过序号:', eOrd.message)
      }
    }
  } catch (e) {
    console.warn('[stats] mission 统计重算失败:', (e && e.code) || '', e && (e.message || e))
    const staleHit = await tryStalePayload(cacheKey, startTime, {
      rateLimited: !!(e && e.code === 'LL2_RATE_LIMIT')
    })
    if (staleHit) return staleHit
    // graceful（用户自预热）：限流/失败统一降级为 notReady 占位，绝不抛异常
    if (graceful) {
      return { success: false, error: '统计数据生成中，请稍后再试', notReady: true, year, elapsed: Date.now() - startTime }
    }
    if (e && e.code === 'LL2_RATE_LIMIT') {
      return {
        success: false,
        error: e.message,
        rateLimited: true,
        elapsed: Date.now() - startTime
      }
    }
    if (e && e.code === 'LL2_RUN_BUDGET') {
      return {
        success: false,
        error: e.message,
        runBudget: true,
        elapsed: Date.now() - startTime
      }
    }
    throw e
  }

  const payload = {
    year,
    rocketLabel: rocketName || String(mission.rocketName || '').trim(),
    providerLabel: String(mission.launchAgency || mission.launchAgencyAbbrev || '').trim(),
    rocketTotal: counts.rocketTotal,
    rocketYear: counts.rocketYear,
    providerTotal: counts.providerTotal,
    providerYear: counts.providerYear,
    yearOrdinal,
    source: inclusive ? 'll2_previous_net_lte_inclusive' : 'll2_previous_net',
    filters: yearParams
  }

  if (!isMissionPayloadValid(payload)) {
    if (graceful) {
      return { success: false, error: '统计数据生成中，请稍后再试', notReady: true, year, elapsed: Date.now() - startTime }
    }
    return { success: false, error: '暂无可用统计数据', elapsed: Date.now() - startTime }
  }

  // 部分限流的不完整结果只返回不落库，待配额恢复后下次访问补全
  if (!partialDueToRateLimit) {
    await writeCache(cacheKey, payload)
  }

  return { success: true, fromCache: false, staleCache: false, ...payload, elapsed: Date.now() - startTime }
}

/**
 * 刷新当前年（2026）统计缓存：由定时触发器调用，把 count-only 精确口径与
 * 明细聚合都强制重算并写入云数据库，让客户端始终秒读最新缓存。
 * 仅 _all 维度；每次最多 ~4 次 LL2 请求（summary 3 + breakdown count/页）。
 */
async function refreshCurrentYearAction(event) {
  const startTime = Date.now()
  const year = Number(event && event.year) || new Date().getUTCFullYear()
  const result = { success: true, year, refreshed: {}, elapsed: 0 }

  // 各步骤独立 reset 单次调用预算，避免 summary+breakdown 共用翻页上限导致 homeSummary 写不进库。
  resetRunApiBudget()
  try {
    const homeSummary = await getSummaryAction({ action: 'getSummary', year, forceRefresh: true })
    result.refreshed.homeSummary = {
      ok: !!(homeSummary && homeSummary.success),
      globalThisYear: homeSummary ? homeSummary.globalThisYear : null,
      rateLimited: !!(homeSummary && homeSummary.rateLimited)
    }
  } catch (e) {
    result.refreshed.homeSummary = { ok: false, error: e.message || String(e) }
  }

  resetRunApiBudget()
  try {
    const summary = await getGlobalSummaryAction({ action: 'getGlobalSummary', year, countryKey: '_all', forceRefresh: true })
    result.refreshed.summary = {
      ok: !!(summary && summary.success),
      total: summary && summary.summary ? summary.summary.total : null,
      rateLimited: !!(summary && summary.rateLimited)
    }
  } catch (e) {
    result.refreshed.summary = { ok: false, error: e.message || String(e) }
  }

  resetRunApiBudget()
  try {
    const breakdown = await getGlobalBreakdownAction({ action: 'getGlobalBreakdown', year, countryKey: '_all', forceRefresh: true })
    result.refreshed.breakdown = {
      ok: !!(breakdown && breakdown.success),
      total: breakdown && breakdown.summary ? breakdown.summary.total : null,
      partial: !!(breakdown && breakdown.partial),
      rateLimited: !!(breakdown && breakdown.rateLimited)
    }
  } catch (e) {
    result.refreshed.breakdown = { ok: false, error: e.message || String(e) }
  }

  // 预热即将发射任务的型号/发射商统计（详情页用户路径只读这些缓存，绝不打 LL2）。
  // 放在往年预热之前：这是用户直接可见的数据，优先保配额。
  try {
    result.refreshed.missionStats = await prewarmUpcomingMissionStats()
  } catch (e) {
    result.refreshed.missionStats = { ok: false, error: e.message || String(e) }
  }

  resetRunApiBudget()
  // 预热一个尚未 final 的往年 breakdown（每轮最多一个，避免打满 LL2 配额）。
  try {
    const prewarmed = await prewarmOnePastYear(year)
    if (prewarmed) result.refreshed.prewarmPastYear = prewarmed
  } catch (e) {
    result.refreshed.prewarmPastYear = { ok: false, error: e.message || String(e) }
  }

  result.elapsed = Date.now() - startTime
  return result
}

const SPACE_DEVS_CACHE_COL = 'space_devs_cache'
const UPCOMING_CACHE_PATH = '/launches/upcoming/'
const UPCOMING_CACHE_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const UPCOMING_CACHE_SUFFIXES = ['_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

function sortedCacheParamsString(params) {
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k]
    return acc
  }, {})
  return JSON.stringify(sorted)
}

/** 从 space_devs_cache 读 upcoming 列表（syncLaunches 定时落库，含完整 rocket/lsp 字段） */
async function readUpcomingLaunchesFromSpaceDevsCache() {
  const sortedParams = sortedCacheParamsString(UPCOMING_CACHE_PARAMS)
  let cacheKey = null
  let doc = null
  for (const sfx of UPCOMING_CACHE_SUFFIXES) {
    const key = `api_cache_${UPCOMING_CACHE_PATH}_${sortedParams}${sfx}`
    const d = await db.collection(SPACE_DEVS_CACHE_COL).doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      cacheKey = key
      doc = d
      break
    }
  }
  if (!doc || !doc.data || !doc.data.data) return []

  const apiData = doc.data.data
  let allResults = []
  const isBatched = !!(apiData.isBatched || apiData.isBatch)
    || (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)
  if (isBatched) {
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await db.collection(SPACE_DEVS_CACHE_COL).doc(batchKey).get().catch(() => null)
      const batchData = batchDoc && batchDoc.data && batchDoc.data.data
      if (!batchData || !Array.isArray(batchData.results)) break
      allResults = allResults.concat(batchData.results)
      batchIdx++
    }
  }
  if (!allResults.length && Array.isArray(apiData.results)) allResults = apiData.results
  return allResults
}

function missionFieldsFromLaunch(launch) {
  if (!launch || launch.id == null) return null
  const cfg = launch.rocket && launch.rocket.configuration
  const lsp = launch.launch_service_provider || launch.lsp
  const rocketConfigName = String((cfg && cfg.name) || '').trim()
  const launchAgency = String((lsp && lsp.name) || '').trim()
  const launchAgencyId = lsp && lsp.id != null ? lsp.id : ''
  const launchTime = launch.net || launch.window_start || launch.window_end || ''
  if (!rocketConfigName && !launchAgency && launchAgencyId === '') return null
  return {
    id: String(launch.id),
    rocketName: rocketConfigName,
    launchAgency,
    launchAgencyId,
    launchTime
  }
}

/**
 * 即将发射任务统计预热：优先读 space_devs_cache upcoming（字段完整），
 * launch_data 仅作兜底；逐个重算型号/发射商统计并写 mission_* 与 count_* 缓存。
 * 用户路径（详情页 readOnly）只读这些预生成结果，LL2 请求全部收敛到本定时任务。
 */
async function prewarmUpcomingMissionStats() {
  const out = {
    ok: true,
    total: 0,
    warmed: 0,
    skipped: 0,
    skippedNoFields: 0,
    skippedFresh: 0,
    errors: 0,
    rateLimited: false,
    source: 'space_devs_cache'
  }

  let rows = []
  const upcoming = await readUpcomingLaunchesFromSpaceDevsCache()
  if (upcoming.length) {
    rows = upcoming
      .map(missionFieldsFromLaunch)
      .filter(Boolean)
      .sort((a, b) => {
        const ta = new Date(a.launchTime).getTime()
        const tb = new Date(b.launchTime).getTime()
        return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity)
      })
      .slice(0, MISSION_PREWARM_MAX)
  }

  // space_devs_cache 未命中时兜底 launch_data（需 syncLaunchData 已写入 rocketConfigName）
  if (!rows.length) {
    out.source = 'launch_data'
    try {
      const res = await db.collection('launch_data')
        .orderBy('windowStart', 'asc')
        .limit(MISSION_PREWARM_MAX)
        .get()
      rows = (res && res.data) || []
    } catch (e) {
      return { ok: false, error: 'launch_data 读取失败: ' + (e && (e.message || e)) }
    }
  }
  out.total = rows.length
  const prewarmYear = new Date().getUTCFullYear()
  out.seeded = await seedDimCountsFromYearBreakdown(prewarmYear)

  // 「年内第几次」hint：年内已发射总数 + 待发队列位置（rows 已按 net 升序）
  const ordinalHints = new Map()
  const ytd = await readYearToDateTotal(prewarmYear)
  if (ytd != null) {
    let pos = 0
    for (const r of rows) {
      const t = r.launchTime ? new Date(r.launchTime).getTime() : NaN
      if (!Number.isFinite(t) || new Date(t).getUTCFullYear() !== prewarmYear) continue
      pos += 1
      ordinalHints.set(String(r.id || r._id || ''), ytd + pos)
    }
  }

  // LL2 一旦真 429 就停止后续 LL2 补全（零 LL2 写库继续）
  let ll2Stop = false

  for (const row of rows) {
    const missionId = String(row.id || row._id || '').trim()
    if (!missionId) { out.skipped += 1; continue }

    const rocketConfigName = String(row.rocketName || row.rocketConfigName || '').trim()
    const launchAgency = String(row.launchAgency || '').trim()
    const launchAgencyId = row.launchAgencyId != null && row.launchAgencyId !== '' ? row.launchAgencyId : ''
    if (!rocketConfigName && !launchAgency && !launchAgencyId) {
      out.skipped += 1
      out.skippedNoFields += 1
      continue
    }
    const launchTime = row.launchTime || ''
    const year = launchTime ? new Date(launchTime).getUTCFullYear() : new Date().getUTCFullYear()
    const mission = {
      id: missionId,
      rocketName: rocketConfigName,
      launchAgency,
      launchAgencyId,
      launchTime
    }
    const cacheKey = `mission_${missionId}_${launchTime || year}`

    // 仅当缓存「完整」（含累计与序号）且年内计数与最新 dim count 一致才跳过
    // 已发射但仍 rocketTotal/Year=0 的脏缓存强制重算
    const fresh = await readCache(cacheKey, { maxAgeMs: MISSION_PREWARM_FRESH_MS })
    if (fresh && isMissionPayloadComplete(fresh.payload, mission)
      && !isMissionStatsStaleAfterLaunch(fresh.payload, mission)) {
      // 比对 dim count：如果 rocketYear / providerYear 已过时（新发射后 dim 值变化），不跳过
      let dimStale = false
      if (rocketConfigName) {
        const latestRocketYear = await readDimCountValue(dimCountDocId(['rocket', rocketConfigName, String(year)]))
        if (latestRocketYear != null && fresh.payload.rocketYear != null && latestRocketYear !== fresh.payload.rocketYear) {
          dimStale = true
        }
      }
      if (!dimStale && (launchAgencyId || launchAgency)) {
        const aParams = buildAgencyFilterParams(mission)
        if (aParams) {
          const aKey = aParams.lsp__id != null ? `lsp-${aParams.lsp__id}` : String(aParams.lsp__name || '')
          const latestProviderYear = await readDimCountValue(dimCountDocId(['agency', aKey, String(year)]))
          if (latestProviderYear != null && fresh.payload.providerYear != null
            && latestProviderYear !== fresh.payload.providerYear) {
            dimStale = true
          }
        }
      }
      if (!dimStale) {
        out.skipped += 1
        out.skippedFresh += 1
        continue
      }
    }

    // 1) 零 LL2 基础数据：年内计数 + 年内序号（hint 来自待发队列位置）
    const zeroLlm = await assembleMissionStatsZeroLlm(mission, year, Date.now(), {
      yearOrdinalHint: ordinalHints.get(missionId)
    })
    let payload = zeroLlm ? { ...zeroLlm.payload } : null
    if (payload && fresh && isMissionPayloadValid(fresh.payload)) {
      payload = mergeMissionPayloads(payload, fresh.payload)
    }

    // 2) LL2 补全累计次数（count_*_all 跨任务共享：20 个任务通常只需几次请求）
    // 已发射且 total/year 为 0 时也强制重拉（含本次 net__lte）
    const launched = isMissionAlreadyLaunched(mission)
    const notInclusiveYet = !payload || payload.source !== 'll2_previous_net_lte_inclusive'
    const needRocketTotal = !payload || payload.rocketTotal == null
      || (launched && (payload.rocketTotal === 0 || notInclusiveYet))
    const needRocketYear = !payload || payload.rocketYear == null
      || (launched && (payload.rocketYear === 0 || notInclusiveYet))
    const needProviderTotal = !payload || payload.providerTotal == null
      || (launched && notInclusiveYet)
    const needProviderYear = !payload || payload.providerYear == null
      || (launched && notInclusiveYet)
    if (!ll2Stop && (needRocketTotal || needRocketYear || needProviderTotal || needProviderYear)) {
      resetRunApiBudget()
      try {
        const netLte = missionInclusiveNetLte(mission)
        const inclusive = !!netLte
        const dimOpts = inclusive ? { skipWrite: true, noReadCache: true } : {}
        if (!payload) {
          payload = {
            year,
            rocketLabel: rocketConfigName,
            providerLabel: launchAgency,
            rocketTotal: null,
            rocketYear: null,
            providerTotal: null,
            providerYear: null,
            yearOrdinal: ordinalHints.get(missionId) != null ? ordinalHints.get(missionId) : null,
            source: inclusive ? 'll2_previous_net_lte_inclusive' : 'll2_previous_net'
          }
        }
        if (inclusive) payload.source = 'll2_previous_net_lte_inclusive'
        const rParams = buildRocketFilterParams(rocketConfigName)
        if (rParams && (needRocketTotal || needRocketYear)) {
          if (needRocketTotal) {
            const p = inclusive ? { ...rParams, net__lte: netLte } : rParams
            const v = await fetchPreviousLaunchCountCached(dimCountDocId(['rocket', rocketConfigName, 'all']), p, dimOpts)
            if (Number.isFinite(v)) payload.rocketTotal = v
          }
          if (needRocketYear) {
            const { yearParams: yp } = buildYearRange(year)
            const p = inclusive ? { ...rParams, ...yp, net__lte: netLte } : { ...rParams, ...yp }
            const v = await fetchPreviousLaunchCountCached(dimCountDocId(['rocket', rocketConfigName, String(year)]), p, dimOpts)
            if (Number.isFinite(v)) payload.rocketYear = v
          }
        }
        const aParams = buildAgencyFilterParams(mission)
        if (aParams && (needProviderTotal || needProviderYear)) {
          const aKey = aParams.lsp__id != null ? `lsp-${aParams.lsp__id}` : String(aParams.lsp__name || '')
          if (needProviderTotal) {
            const p = inclusive ? { ...aParams, net__lte: netLte } : aParams
            const v = await fetchPreviousLaunchCountCached(dimCountDocId(['agency', aKey, 'all']), p, dimOpts)
            if (Number.isFinite(v)) payload.providerTotal = v
          }
          if (needProviderYear) {
            const { yearParams: yp } = buildYearRange(year)
            const p = inclusive ? { ...aParams, ...yp, net__lte: netLte } : { ...aParams, ...yp }
            const v = await fetchPreviousLaunchCountCached(dimCountDocId(['agency', aKey, String(year)]), p, dimOpts)
            if (Number.isFinite(v)) payload.providerYear = v
          }
        }
      } catch (e) {
        if (isRateLimitError(e)) {
          out.ll2Throttled = true
          out.rateLimited = true
          ll2Stop = true
        } else if (!isRunBudgetError(e)) {
          console.warn('[stats] 累计 count 补全失败:', missionId, e && (e.message || e))
        }
      }
    }

    if (payload && isMissionPayloadValid(payload)) {
      await writeCache(cacheKey, payload)
      out.warmed += 1
      if (isMissionPayloadComplete(payload, mission)) out.warmedComplete = (out.warmedComplete || 0) + 1
      else out.warmedPartial = (out.warmedPartial || 0) + 1
      continue
    }

    // 3) 零 LL2 完全组装不出来（如 breakdown 缺失）→ 老路径全量重算
    if (ll2Stop) { out.skipped += 1; continue }
    resetRunApiBudget()
    try {
      const { yearParams } = buildYearRange(year)
      const r = await recomputeMissionStats(mission, year, yearParams, cacheKey, Date.now(), false)
      if (r && r.success) out.warmed += 1
      else if (r && r.rateLimited) { out.rateLimited = true; out.ll2Throttled = true; ll2Stop = true }
      else if (r && r.runBudget) { out.runBudgetHit = (out.runBudgetHit || 0) + 1 }
      else out.errors += 1
    } catch (e) {
      if (isRateLimitError(e)) { out.rateLimited = true; out.ll2Throttled = true; ll2Stop = true; continue }
      if (isRunBudgetError(e)) { out.runBudgetHit = (out.runBudgetHit || 0) + 1; continue }
      out.errors += 1
      console.warn('[stats] mission 预热失败:', missionId, e && (e.message || e))
    }
  }
  return out
}

/**
 * 找最近一个「明细缓存尚未 final（未预热）」的往年，算一次并写 final。
 * 从去年往前扫描到 STATS_MIN_YEAR(1957)，命中第一个未 final 的就预热它（每轮一个）。
 */
async function prewarmOnePastYear(currentYear) {
  const startYear = Number(currentYear) - 1
  for (let y = startYear; y >= STATS_MIN_YEAR; y -= 1) {
    const doc = await readCache(`global_${y}`, { allowStale: true })
    const alreadyFinal = doc && doc.final && doc.payload && isBreakdownComplete(doc.payload)
    if (alreadyFinal) continue
    // 重置单次调用预算，让该往年预热获得完整翻页配额（小时配额仍统一保护 LL2）
    resetRunApiBudget()
    const res = await getGlobalBreakdownAction({ action: 'getGlobalBreakdown', year: y, countryKey: '_all', forceRefresh: true })
    return {
      year: y,
      ok: !!(res && res.success),
      total: res && res.summary ? res.summary.total : null,
      partial: !!(res && res.partial),
      rateLimited: !!(res && res.rateLimited)
    }
  }
  return null
}

/**
 * 清空 launch_stats_cache 中所有任务详情型号/机构统计缓存（docId 以 mission_ 开头）。
 * 用于「型号过滤参数修复」后清掉旧的 count=0 脏缓存，让详情页下次打开按新逻辑重算。
 * 服务端 admin 权限批量删除，绕过小程序端「只能删自有记录」的限制；不消耗 LL2 配额。
 * 实现：分页只取 _id 扫描，收集 mission_ 前缀文档再逐个 remove（_id 正则查询各环境支持
 * 不一，扫描+精确删除最稳）。dryRun=true 时只统计匹配数、不实际删除。
 */
async function clearMissionStatsCacheAction(event) {
  const startTime = Date.now()
  const prefix = 'mission_'
  const dryRun = !!(event && event.dryRun)
  const PAGE = 100
  const MAX_DOCS = 20000
  let scanned = 0
  let offset = 0
  const matchedIds = []
  const sampleIds = []

  // 先取集合真实总数（.get() 单页有上限，靠 count 判断是否需要继续翻页 / 是否已扫全）
  let total = null
  try {
    const cnt = await db.collection(CACHE_COL).count()
    total = cnt && Number.isFinite(cnt.total) ? cnt.total : null
  } catch (e) {}

  while (offset < MAX_DOCS) {
    let res = null
    try {
      res = await db.collection(CACHE_COL).field({ _id: true }).skip(offset).limit(PAGE).get()
    } catch (e) {
      return { success: false, error: 'scan 失败: ' + (e && (e.message || e)), total, scanned, matched: matchedIds.length, removed: 0, elapsed: Date.now() - startTime }
    }
    const docs = (res && res.data) || []
    if (!docs.length) break
    scanned += docs.length
    docs.forEach((d) => {
      const id = String((d && d._id) || '')
      if (sampleIds.length < 20) sampleIds.push(id)
      if (id.indexOf(prefix) === 0) matchedIds.push(id)
    })
    // 翻页终止：已知 total 时按 total 判断；否则退化为「不足一页即结束」
    if (total != null) {
      if (scanned >= total || docs.length < PAGE) break
    } else if (docs.length < PAGE) {
      break
    }
    offset += docs.length
  }

  let removed = 0
  const errors = []
  if (!dryRun) {
    for (const id of matchedIds) {
      try {
        await db.collection(CACHE_COL).doc(id).remove()
        removed += 1
      } catch (e) {
        errors.push(id)
      }
    }
  }

  return {
    success: true,
    dryRun,
    collection: CACHE_COL,
    total,
    scanned,
    matched: matchedIds.length,
    removed,
    failed: errors.length,
    failedIds: errors.slice(0, 20),
    // 诊断：当 matched=0 时，sampleIds 可直观看出集合里到底有哪些 docId（确认无 mission_ 文档）
    sampleIds,
    note: matchedIds.length === 0
      ? '云端无 mission_ 文档；详情页旧的型号统计脏值多来自前端本地 Storage（_launch_stats_persist_*），需在小程序端清 Storage。'
      : undefined,
    elapsed: Date.now() - startTime
  }
}

/**
 * 终态任务失效 mission_ / 相关 dim count 缓存，促使预热按「含本次」重写。
 * event.missions: [{ id, launchTime?, rocketName?, launchAgencyId?, launchAgency? }]
 */
async function invalidateMissionStatsAction(event) {
  const startTime = Date.now()
  const missions = Array.isArray(event && event.missions) ? event.missions
    : Array.isArray(event && event.missionIds)
      ? event.missionIds.map((id) => (typeof id === 'object' ? id : { id }))
      : []
  let removed = 0
  const tried = []
  for (let i = 0; i < missions.length; i++) {
    const entry = missions[i] || {}
    const id = String(entry.id || '').trim()
    if (!id) continue
    const launchTime = entry.launchTime || entry.net || ''
    const year = launchTime
      ? new Date(launchTime).getUTCFullYear()
      : new Date().getUTCFullYear()
    const candidates = [
      `mission_${id}_${launchTime}`,
      `mission_${id}_${year}`
    ]
    if (launchTime) {
      const iso = toLl2NetIso(launchTime)
      if (iso) candidates.push(`mission_${id}_${iso}`)
    }
    for (let j = 0; j < candidates.length; j++) {
      const key = candidates[j]
      if (!key || tried.indexOf(key) >= 0) continue
      tried.push(key)
      if (await removeCache(key)) removed += 1
    }
    const rocketName = String(entry.rocketName || entry.rocketConfigName || '').trim()
    if (rocketName) {
      const rAll = dimCountDocId(['rocket', rocketName, 'all'])
      const rYear = dimCountDocId(['rocket', rocketName, String(year)])
      if (await removeCache(rAll)) removed += 1
      if (await removeCache(rYear)) removed += 1
    }
    const agencyParams = buildAgencyFilterParams({
      launchAgencyId: entry.launchAgencyId,
      launchAgency: entry.launchAgency || entry.launchAgencyAbbrev
    })
    if (agencyParams) {
      const aKey = agencyParams.lsp__id != null
        ? `lsp-${agencyParams.lsp__id}`
        : String(agencyParams.lsp__name || '')
      if (aKey) {
        if (await removeCache(dimCountDocId(['agency', aKey, 'all']))) removed += 1
        if (await removeCache(dimCountDocId(['agency', aKey, String(year)]))) removed += 1
      }
    }
  }

  let recomputed = 0
  let recomputeErrors = 0
  if (event && event.recompute) {
    for (let i = 0; i < missions.length; i++) {
      const entry = missions[i] || {}
      const id = String(entry.id || '').trim()
      if (!id) continue
      const launchTime = entry.launchTime || entry.net || ''
      const year = launchTime
        ? new Date(launchTime).getUTCFullYear()
        : new Date().getUTCFullYear()
      const mission = {
        id,
        rocketName: entry.rocketName || entry.rocketConfigName || '',
        launchAgency: entry.launchAgency || entry.launchAgencyAbbrev || '',
        launchAgencyId: entry.launchAgencyId,
        launchTime
      }
      const cacheKey = `mission_${id}_${launchTime || year}`
      try {
        resetRunApiBudget()
        const { yearParams } = buildYearRange(year)
        const r = await recomputeMissionStats(mission, year, yearParams, cacheKey, Date.now(), true)
        if (r && r.success) recomputed += 1
        else recomputeErrors += 1
      } catch (e) {
        recomputeErrors += 1
        console.warn('[stats] invalidate recompute 失败:', id, e && (e.message || e))
      }
    }
  }

  return {
    success: true,
    removed,
    recomputed,
    recomputeErrors,
    missionCount: missions.length,
    elapsed: Date.now() - startTime
  }
}

let _collectionsEnsured = false
async function ensureCollections() {
  if (_collectionsEnsured) return
  _collectionsEnsured = true
  try { await db.createCollection(CACHE_COL) } catch (e) {}
}

// 定时触发器 / 云函数间调用（syncSpaceDevsData、控制台脚本）判定；
// 客户端直调只允许只读查询 action，防止恶意 forceRefresh / 清缓存刷爆 LL2 配额
/**
 * 是否服务端/运维调用（定时器、云函数互调、云开发控制台「云端测试」）。
 * 仅拦截正式小程序端 wx_client，避免用户刷 forceRefresh / 清缓存。
 * 云端测试与开发者工具多为 wx_devtools，需放行以便手动 prewarm。
 */
function isServerSideInvocation(event) {
  if (event && (event.TriggerName || event.triggerName)) return true
  // 控制台显式标记（可选）：{ "action": "prewarmMissionStats", "__console": true }
  if (event && (event.__console === true || event.__consoleTest === true)) return true
  try {
    const ctx = cloud.getWXContext() || {}
    const chain = String(ctx.SOURCE || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!chain.length) return true
    const last = chain[chain.length - 1]
    // 正式用户端禁止运维 action；devtools / scf / 其它来源放行
    return last !== 'wx_client'
  } catch (e) {
    return true
  }
}

const MAINTENANCE_ACTIONS = new Set([
  'refreshCurrentYear',
  'prewarmMissionStats',
  'clearMissionStatsCache',
  'invalidateMissionStats'
])

exports.main = async (event = {}) => {
  resetRunApiBudget()
  await ensureCollections()
  // 定时触发器无法在 config 里传 event.action，按 TriggerName 分流
  let action = String(event.action || '').trim()
  if (!action) {
    const tn = String(event.TriggerName || event.triggerName || '').trim()
    if (tn === 'refreshCurrentYearStatsTimer') action = 'refreshCurrentYear'
  }
  if (!action) action = 'getGlobalStats'

  const fromServer = isServerSideInvocation(event)
  if (MAINTENANCE_ACTIONS.has(action) && !fromServer) {
    console.warn('[getLaunchStats] 拦截客户端调用运维 action:', action)
    return { success: false, error: 'forbidden: action not allowed from client' }
  }
  // 客户端不允许强制刷新（绕过缓存直打 LL2）
  if (!fromServer && event.forceRefresh) {
    event = { ...event, forceRefresh: false }
  }

  try {
    switch (action) {
      case 'getGlobalStats':
        return await getGlobalStatsAction(event)
      case 'getGlobalSummary':
        return await getGlobalSummaryAction(event)
      case 'getGlobalBreakdown':
        return await getGlobalBreakdownAction(event)
      case 'getMissionStats':
        return await getMissionStatsAction(event)
      case 'getSummary':
        return await getSummaryAction(event)
      case 'refreshCurrentYear':
        return await refreshCurrentYearAction(event)
      case 'prewarmMissionStats':
        // 控制台手动预热即将发射任务统计（部署后立即出数，不必等 6h 定时器）
        return { success: true, ...(await prewarmUpcomingMissionStats()) }
      case 'clearMissionStatsCache':
        return await clearMissionStatsCacheAction(event)
      case 'invalidateMissionStats':
        return await invalidateMissionStatsAction(event)
      default:
        return { success: false, error: `未知 action: ${action}` }
    }
  } catch (e) {
    return { success: false, error: e.message || String(e) }
  }
}
