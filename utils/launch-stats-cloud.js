/**
 * 发射统计云函数客户端：统一走 getLaunchStats + LL2 官方 net 年界
 */

const GLOBAL_STATS_CACHE_KEY = '_launch_global_stats_cloud'
const GLOBAL_SUMMARY_CACHE_KEY = '_launch_global_summary_cloud'
const GLOBAL_BREAKDOWN_CACHE_KEY = '_launch_global_breakdown_cloud'
// v2：此前会把本地化后的中文型号名当查询名发上去，云端拿不到计数；换 key 让旧的空结果失效
const MISSION_STATS_CACHE_KEY = '_launch_mission_stats_cloud_v2'
const CACHE_TTL_MS = 30 * 60 * 1000
const STALE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** 当前年本地 persist 窗口放宽到 24h（仍 SWR 后台刷新），改善二次打开秒显 */
const CURRENT_YEAR_PERSIST_TTL_MS = 24 * 60 * 60 * 1000
/** 往年数据不变：本地 persist 长缓存 30 天，视为新鲜、不提示陈旧 */
const PAST_YEAR_PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = '_launch_stats_persist_'
const CLOUD_RETRY_DELAY_MS = 800
const CLOUD_MAX_RETRIES = 2
/** 过期 persist 仍可作为空屏兜底，最长保留 180 天 */
const EMERGENCY_PERSIST_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000
const CLOUD_CALL_TIMEOUT_MS = 20000

const _mem = Object.create(null)
const _pending = Object.create(null)

function isTimeoutError(msg) {
  return /504003|timed out|time.?out|TIME_LIMIT|FUNCTIONS_TIME_LIMIT|^timeout$/i.test(String(msg || ''))
}

function isRetryableCloudError(msg) {
  const text = String(msg || '')
  // notReady 立刻连打没用（后台还没写出）；交给页面延迟自动重试
  if (/STATS_NOT_READY|生成中/i.test(text)) return false
  return isTimeoutError(text)
    || /network|网络|fail to connect|ECONN|ERR_NETWORK/i.test(text)
    || /502|503|504003/i.test(text)
}

function formatCloudError(err) {
  const msg = (err && (err.message || err.errMsg)) ? String(err.message || err.errMsg) : String(err || '')
  if (isTimeoutError(msg)) return '统计加载超时，请稍后重试'
  // notReady：后台尚未预生成该统计（只读模式不打 LL2），显示“生成中”占位而非“繁忙”错误
  if (/STATS_NOT_READY|生成中/i.test(msg)) return '统计数据生成中，请稍后重试'
  if (/LL2|rate.?limit|配额|rateLimited/i.test(msg)) return '数据源请求繁忙，请稍后再试'
  if (/network|网络|fail to connect|ERR_NETWORK/i.test(msg)) return '网络异常，请检查后重试'
  const cleaned = msg.replace(/^cloud\.callFunction:fail\s*/i, '').trim()
  return cleaned || '加载失败'
}

function _readMem(key) {
  const hit = _mem[key]
  if (!hit) return null
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    delete _mem[key]
    return null
  }
  return hit.data
}

function _writeMem(key, data) {
  _mem[key] = { ts: Date.now(), data }
}

/** 从 persist key 提取 4 位年份（如 ..._cloud_2025__all → 2025）；取不到返回 null */
function _yearFromKey(key) {
  const m = String(key || '').match(/_(\d{4})(?:_|$)/)
  return m ? Number(m[1]) : null
}

function _readPersist(key, options = {}) {
  const allowExpired = !!(options && options.allowExpired)
  try {
    const hit = wx.getStorageSync(STORAGE_PREFIX + key)
    if (!hit || !hit.data || !hit.ts) return null
    const age = Date.now() - hit.ts
    const year = _yearFromKey(key)
    const isPast = year != null && year < new Date().getUTCFullYear()
    const maxAge = isPast ? PAST_YEAR_PERSIST_TTL_MS : CURRENT_YEAR_PERSIST_TTL_MS
    if (age > maxAge) {
      if (!allowExpired || age > EMERGENCY_PERSIST_MAX_AGE_MS) return null
      return { data: hit.data, stale: true, expired: true }
    }
    return {
      data: hit.data,
      // 往年数据不变：视为新鲜不提示陈旧；当前年超过 30min 标记 stale 触发后台刷新提示
      stale: isPast ? false : age > CACHE_TTL_MS
    }
  } catch (e) {
    return null
  }
}

function _evictOldPersist() {
  try {
    const info = (wx.getStorageInfoSync && wx.getStorageInfoSync()) || {}
    const keys = Array.isArray(info.keys) ? info.keys : []
    const persistKeys = keys.filter((k) => String(k).indexOf(STORAGE_PREFIX) === 0)
    const rows = persistKeys.map((k) => {
      let ts = 0
      try {
        const hit = wx.getStorageSync(k)
        ts = (hit && hit.ts) || 0
      } catch (e) {}
      return { k, ts }
    }).sort((a, b) => a.ts - b.ts)
    const toRemove = Math.max(2, Math.ceil(rows.length * 0.2))
    rows.slice(0, toRemove).forEach((row) => {
      try { wx.removeStorageSync(row.k) } catch (e) {}
    })
  } catch (e) {}
}

function _writePersist(key, data) {
  try {
    wx.setStorageSync(STORAGE_PREFIX + key, { ts: Date.now(), data })
  } catch (e) {
    _evictOldPersist()
    try {
      wx.setStorageSync(STORAGE_PREFIX + key, { ts: Date.now(), data })
    } catch (e2) {}
  }
}

function callLaunchStatsCloud(payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云开发未初始化'))
  }
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'getLaunchStats',
      data: payload,
      timeout: CLOUD_CALL_TIMEOUT_MS,
      success: (res) => {
        const result = res && res.result
        if (result && result.success) resolve(result)
        // 只读模式下后台尚未预生成：用专用标记，让 formatCloudError 显示“生成中”占位
        else if (result && result.notReady) reject(new Error('STATS_NOT_READY'))
        else reject(new Error((result && result.error) || '统计云函数返回失败'))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '云函数调用失败'))
    })
  })
}

async function callLaunchStatsCloudWithRetry(payload) {
  let lastErr = null
  for (let attempt = 0; attempt <= CLOUD_MAX_RETRIES; attempt += 1) {
    try {
      return await callLaunchStatsCloud(payload)
    } catch (e) {
      lastErr = e
      const msg = (e && e.message) ? String(e.message) : ''
      if (!isRetryableCloudError(msg) || attempt >= CLOUD_MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, CLOUD_RETRY_DELAY_MS * (attempt + 1)))
    }
  }
  throw lastErr || new Error('云函数调用失败')
}

/**
 * @param {boolean} forceRefresh 透传云端强刷（会打 LL2，仅限重试/后台任务）
 * @param {boolean} skipLocalCache 仅跳过客户端内存/persist 缓存，云端仍走只读缓存
 *（下拉刷新用：用户刷新绝不触发 LL2，节奏由云函数分配）
 */
async function fetchWithCache(cacheKey, payload, forceRefresh, skipLocalCache) {
  if (!forceRefresh && !skipLocalCache) {
    const cached = _readMem(cacheKey)
    if (cached) return cached
    if (_pending[cacheKey]) return _pending[cacheKey]

    // 冷启动内存 miss 时先看本地持久缓存：未过期且不 stale（往年数据/30min 内的当前年数据）直接秒回，
    // 不打云函数；stale 的仍走云端刷新（catch 里已有 persist 兜底）
    const persist = _readPersist(cacheKey)
    if (persist && persist.data && !persist.stale) {
      _writeMem(cacheKey, persist.data)
      return persist.data
    }
  }

  _pending[cacheKey] = callLaunchStatsCloudWithRetry(payload)
    .then((data) => {
      _writeMem(cacheKey, data)
      // 仅有年度总数的半成品不落盘，避免 30min 内把 0 成功/0 失败当成完整统计
      const incompleteMission = String(cacheKey).indexOf(MISSION_STATS_CACHE_KEY) === 0
        && data && data.rocketTotal == null && data.rocketYear == null
      if (data && !data.summaryPartial && !incompleteMission) _writePersist(cacheKey, data)
      return data
    })
    .catch((err) => {
      const persist = _readPersist(cacheKey) || _readPersist(cacheKey, { allowExpired: true })
      if (persist && persist.data) {
        const fallback = {
          ...persist.data,
          fromCache: true,
          staleCache: true,
          clientStaleFallback: true
        }
        _writeMem(cacheKey, fallback)
        return fallback
      }
      const friendly = new Error(formatCloudError(err))
      friendly.cause = err
      throw friendly
    })
    .finally(() => {
      delete _pending[cacheKey]
    })

  return _pending[cacheKey]
}

function readPersistSnapshot(cacheKey, options) {
  return _readPersist(cacheKey, options)
}

async function fetchGlobalLaunchStatsFromCloud(options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear()
  const countryKey = String(options.countryKey || '_all')
  const forceRefresh = !!(options && options.forceRefresh)
  const cacheKey = `${GLOBAL_STATS_CACHE_KEY}_${year}_${countryKey}`

  return fetchWithCache(cacheKey, {
    action: 'getGlobalStats',
    year,
    countryKey,
    forceRefresh,
    readOnly: true
  }, forceRefresh)
}

async function fetchGlobalSummaryFromCloud(options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear()
  const countryKey = String(options.countryKey || '_all')
  const forceRefresh = !!(options && options.forceRefresh)
  const skipLocalCache = !!(options && options.skipLocalCache)
  const cacheKey = `${GLOBAL_SUMMARY_CACHE_KEY}_${year}_${countryKey}`

  return fetchWithCache(cacheKey, {
    action: 'getGlobalSummary',
    year,
    countryKey,
    forceRefresh,
    readOnly: true
  }, forceRefresh, skipLocalCache)
}

async function fetchGlobalBreakdownFromCloud(options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear()
  const countryKey = String(options.countryKey || '_all')
  const forceRefresh = !!(options && options.forceRefresh)
  const skipLocalCache = !!(options && options.skipLocalCache)
  const cacheKey = `${GLOBAL_BREAKDOWN_CACHE_KEY}_${year}_${countryKey}`

  return fetchWithCache(cacheKey, {
    action: 'getGlobalBreakdown',
    year,
    countryKey,
    forceRefresh,
    readOnly: true
  }, forceRefresh, skipLocalCache)
}

const SUMMARY_STATS_CACHE_KEY = '_launch_summary_stats_cloud'

async function fetchLaunchSummaryFromCloud(options = {}) {
  const year = Number(options.year) || new Date().getUTCFullYear()
  const forceRefresh = !!(options && options.forceRefresh)
  const cacheKey = `${SUMMARY_STATS_CACHE_KEY}_${year}`

  const skipLocalCache = !!(options && options.skipLocalCache)
  return fetchWithCache(cacheKey, {
    action: 'getSummary',
    year,
    forceRefresh,
    readOnly: true
  }, forceRefresh, skipLocalCache)
}

/**
 * 首页卡片那份年度总数的本地快照（零请求）。
 * 统计详情页拿它做头部对齐，保证两处展示的永远是同一个数。
 */
function readLaunchSummarySnapshotTotal(year) {
  const key = `${SUMMARY_STATS_CACHE_KEY}_${Number(year) || new Date().getUTCFullYear()}`
  const hit = _readPersist(key) || _readPersist(key, { allowExpired: true })
  const total = hit && hit.data ? Number(hit.data.globalThisYear) : NaN
  return Number.isFinite(total) && total > 0 ? total : null
}

/**
 * 统计查询用的火箭型号名：必须是 LL2 的 configuration.name（英文），
 * 中文名/「未知火箭」都过滤掉——页面上的 mission.rocketName 已被本地化成中文，
 * 直接发上去会让云端精确过滤和维度缓存全部落空，累计/本年就成了「—」。
 */
function resolveMissionRocketQueryName(mission) {
  if (!mission || typeof mission !== 'object') return ''
  const pack = mission._langPack || null
  const cfg = mission.rocketConfiguration || null
  const candidates = [
    pack && pack.rocketNameEn,
    cfg && cfg.name,
    cfg && cfg.full_name,
    mission.rocketName
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    const s = String(candidates[i] || '').trim()
    if (!s || s === '未知火箭') continue
    if (/[\u4e00-\u9fff]/.test(s)) continue
    return s
  }
  // 全是中文时仍原样上报，交给云端按 mission.id 回查权威英文名
  for (let i = 0; i < candidates.length; i += 1) {
    const s = String(candidates[i] || '').trim()
    if (s && s !== '未知火箭') return s
  }
  return ''
}

async function fetchMissionLaunchStatsFromCloud(mission, options = {}) {
  if (!mission || typeof mission !== 'object') {
    return Promise.reject(new Error('缺少任务信息'))
  }
  const missionId = String(mission.id || '').trim()
  const cacheKey = `${MISSION_STATS_CACHE_KEY}_${missionId || mission.rocketName || 'unknown'}_${mission.launchTime || ''}`
  const forceRefresh = !!(options && options.forceRefresh)

  const pack = mission._langPack || null
  const rocketNameEn = resolveMissionRocketQueryName(mission)
  const agencyEn =
    (pack && pack.launchAgencyEn) ||
    mission.launchAgencyAbbrev ||
    mission.launchAgency ||
    ''

  const data = await fetchWithCache(cacheKey, {
    action: 'getMissionStats',
    mission: {
      id: mission.id,
      rocketName: rocketNameEn,
      rocketConfiguration: mission.rocketConfiguration || null,
      launchAgency: agencyEn,
      launchAgencyId: mission.launchAgencyId,
      launchAgencyAbbrev: mission.launchAgencyAbbrev,
      launchTime: mission.launchTime,
      agencyLaunchAttemptCount: mission.agencyLaunchAttemptCount != null
        ? mission.agencyLaunchAttemptCount
        : mission.agency_launch_attempt_count,
      agencyLaunchAttemptCountYear: mission.agencyLaunchAttemptCountYear != null
        ? mission.agencyLaunchAttemptCountYear
        : mission.agency_launch_attempt_count_year,
      rocketLaunchAttemptCount: mission.rocketLaunchAttemptCount != null
        ? mission.rocketLaunchAttemptCount
        : (mission.rocketConfiguration && mission.rocketConfiguration.total_launch_count)
    },
    forceRefresh,
    // 用户路径只读云数据库（统计由定时器 prewarmUpcomingMissionStats 预生成），绝不打 LL2
    readOnly: true
  }, forceRefresh)

  // 本地 persist/内存常缓存缺 providerTotal 的旧结果；用徽章同源 attempt 就地回填并写回，避免一直显示 —
  const filled = applyMissionAgencyHintsLocal(data, mission)
  if (filled !== data) {
    _writeMem(cacheKey, filled)
    _writePersist(cacheKey, filled)
  }
  return filled
}

/** 客户端就地回填发射商累计/本年（与 mission-launch-stats 口径一致，供 persist 命中时使用） */
function applyMissionAgencyHintsLocal(data, mission) {
  if (!data || !mission) return data
  let totalHint = mission.agencyLaunchAttemptCount != null
    ? Number(mission.agencyLaunchAttemptCount)
    : (mission.agency_launch_attempt_count != null ? Number(mission.agency_launch_attempt_count) : NaN)
  let yearHint = mission.agencyLaunchAttemptCountYear != null
    ? Number(mission.agencyLaunchAttemptCountYear)
    : (mission.agency_launch_attempt_count_year != null ? Number(mission.agency_launch_attempt_count_year) : NaN)

  if ((!Number.isFinite(totalHint) || !Number.isFinite(yearHint)) && Array.isArray(mission.launchSequenceRows)) {
    const row = mission.launchSequenceRows.find((r) => r && (r.label === '发射商' || r.label === '发射服务商'))
    const line = row && row.line ? String(row.line) : ''
    if (line) {
      if (!Number.isFinite(yearHint)) {
        const ym = line.match(/年内第\s*(\d+)\s*次/)
        if (ym) yearHint = Number(ym[1])
      }
      if (!Number.isFinite(totalHint)) {
        const withoutYear = line.replace(/年内第\s*\d+\s*次/g, '')
        const tm = withoutYear.match(/第\s*(\d+)\s*次/)
        if (tm) totalHint = Number(tm[1])
      }
    }
  }

  const cfg = mission.rocketConfiguration || null
  let rocketTotalHint = mission.rocketLaunchAttemptCount != null
    ? Number(mission.rocketLaunchAttemptCount)
    : (cfg && cfg.total_launch_count != null ? Number(cfg.total_launch_count) : NaN)
  if (Number.isFinite(rocketTotalHint) && rocketTotalHint > 0) {
    const t = mission.launchTime ? new Date(mission.launchTime).getTime() : NaN
    if (Number.isFinite(t) && t > Date.now()) rocketTotalHint += 1
  }

  const needTotal = (data.providerTotal == null || data.providerTotal === '') && Number.isFinite(totalHint) && totalHint > 0
  const needYear = (data.providerYear == null || data.providerYear === '') && Number.isFinite(yearHint) && yearHint > 0
  const needRocketTotal = (data.rocketTotal == null || data.rocketTotal === '')
    && Number.isFinite(rocketTotalHint) && rocketTotalHint > 0
  if (!needTotal && !needYear && !needRocketTotal) return data
  const out = { ...data }
  if (needTotal) out.providerTotal = totalHint
  if (needYear) out.providerYear = yearHint
  if (needRocketTotal) out.rocketTotal = rocketTotalHint
  return out
}

function normalizeRocketFilterKey(name) {
  const n = String(name || '').trim()
  if (!n) return ''
  const blockIdx = n.indexOf(' Block')
  return (blockIdx > 0 ? n.slice(0, blockIdx) : n).trim().toLowerCase()
}

function rocketYearLookupKeys(mission) {
  const pack = (mission && mission._langPack) || null
  const cfg = (mission && mission.rocketConfiguration) || null
  return [
    pack && pack.rocketNameEn,
    cfg && cfg.name,
    cfg && cfg.full_name,
    resolveMissionRocketQueryName(mission)
  ].map(normalizeRocketFilterKey).filter(Boolean)
}

function pickRocketYearFromBreakdown(data, mission) {
  const rows = (data && Array.isArray(data.byRocket)) ? data.byRocket : []
  if (!rows.length) return null
  const keys = new Set(rocketYearLookupKeys(mission))
  if (!keys.size) return null
  const row = rows.find((r) => {
    const name = normalizeRocketFilterKey(r && (r.name || r.key))
    return name && keys.has(name)
  })
  const n = row ? Number(row.total) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const t = mission && mission.launchTime ? new Date(mission.launchTime).getTime() : NaN
  return (Number.isFinite(t) && t > Date.now()) ? n + 1 : n
}

async function resolveRocketYearFromBreakdown(mission) {
  if (!mission) return null
  const year = mission.launchTime
    ? new Date(mission.launchTime).getUTCFullYear()
    : new Date().getUTCFullYear()
  if (!Number.isFinite(year)) return null
  const persist = _readPersist(`${GLOBAL_BREAKDOWN_CACHE_KEY}_${year}__all`, { allowExpired: true })
  const fromPersist = pickRocketYearFromBreakdown(persist && persist.data, mission)
  if (fromPersist != null) return fromPersist
  try {
    const data = await fetchGlobalBreakdownFromCloud({ year })
    return pickRocketYearFromBreakdown(data, mission)
  } catch (e) {
    return null
  }
}

module.exports = {
  formatCloudError,
  isTimeoutError,
  isRetryableCloudError,
  readPersistSnapshot,
  readLaunchSummarySnapshotTotal,
  resolveMissionRocketQueryName,
  pickRocketYearFromBreakdown,
  resolveRocketYearFromBreakdown,
  fetchGlobalLaunchStatsFromCloud,
  fetchGlobalSummaryFromCloud,
  fetchGlobalBreakdownFromCloud,
  fetchLaunchSummaryFromCloud,
  fetchMissionLaunchStatsFromCloud
}
