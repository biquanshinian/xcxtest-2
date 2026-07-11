/**
 * 发射统计云函数客户端：统一走 getLaunchStats + LL2 官方 net 年界
 */

const GLOBAL_STATS_CACHE_KEY = '_launch_global_stats_cloud'
const GLOBAL_SUMMARY_CACHE_KEY = '_launch_global_summary_cloud'
const GLOBAL_BREAKDOWN_CACHE_KEY = '_launch_global_breakdown_cloud'
const MISSION_STATS_CACHE_KEY = '_launch_mission_stats_cloud'
const CACHE_TTL_MS = 30 * 60 * 1000
const STALE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** 当前年本地 persist 窗口放宽到 24h（仍 SWR 后台刷新），改善二次打开秒显 */
const CURRENT_YEAR_PERSIST_TTL_MS = 24 * 60 * 60 * 1000
/** 往年数据不变：本地 persist 长缓存 30 天，视为新鲜、不提示陈旧 */
const PAST_YEAR_PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = '_launch_stats_persist_'
const CLOUD_RETRY_DELAY_MS = 600
const CLOUD_MAX_RETRIES = 1

const _mem = Object.create(null)
const _pending = Object.create(null)

function isTimeoutError(msg) {
  return /504003|timed out|time.?out|TIME_LIMIT|FUNCTIONS_TIME_LIMIT|^timeout$/i.test(String(msg || ''))
}

function formatCloudError(err) {
  const msg = (err && (err.message || err.errMsg)) ? String(err.message || err.errMsg) : String(err || '')
  if (isTimeoutError(msg)) return '统计加载超时，请稍后重试'
  // notReady：后台尚未预生成该统计（只读模式不打 LL2），显示“生成中”占位而非“繁忙”错误
  if (/STATS_NOT_READY|生成中/i.test(msg)) return '统计数据生成中，请稍后重试'
  if (/LL2|rate.?limit|配额|rateLimited/i.test(msg)) return '数据源请求繁忙，请稍后再试'
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

function _readPersist(key) {
  try {
    const hit = wx.getStorageSync(STORAGE_PREFIX + key)
    if (!hit || !hit.data || !hit.ts) return null
    const age = Date.now() - hit.ts
    const year = _yearFromKey(key)
    const isPast = year != null && year < new Date().getUTCFullYear()
    const maxAge = isPast ? PAST_YEAR_PERSIST_TTL_MS : CURRENT_YEAR_PERSIST_TTL_MS
    if (age > maxAge) return null
    return {
      data: hit.data,
      // 往年数据不变：视为新鲜不提示陈旧；当前年超过 30min 标记 stale 触发后台刷新提示
      stale: isPast ? false : age > CACHE_TTL_MS
    }
  } catch (e) {
    return null
  }
}

function _writePersist(key, data) {
  try {
    wx.setStorageSync(STORAGE_PREFIX + key, { ts: Date.now(), data })
  } catch (e) {}
}

function callLaunchStatsCloud(payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云开发未初始化'))
  }
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'getLaunchStats',
      data: payload,
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
      if (!isTimeoutError(msg) || attempt >= CLOUD_MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, CLOUD_RETRY_DELAY_MS))
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
      _writePersist(cacheKey, data)
      return data
    })
    .catch((err) => {
      const persist = _readPersist(cacheKey)
      if (persist && persist.data) {
        return {
          ...persist.data,
          fromCache: true,
          staleCache: true,
          clientStaleFallback: true
        }
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

function readPersistSnapshot(cacheKey) {
  return _readPersist(cacheKey)
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

  return fetchWithCache(cacheKey, {
    action: 'getSummary',
    year,
    forceRefresh,
    readOnly: true
  }, forceRefresh)
}

async function fetchMissionLaunchStatsFromCloud(mission, options = {}) {
  if (!mission || typeof mission !== 'object') {
    return Promise.reject(new Error('缺少任务信息'))
  }
  const missionId = String(mission.id || '').trim()
  const cacheKey = `${MISSION_STATS_CACHE_KEY}_${missionId || mission.rocketName || 'unknown'}_${mission.launchTime || ''}`
  const forceRefresh = !!(options && options.forceRefresh)

  const data = await fetchWithCache(cacheKey, {
    action: 'getMissionStats',
    mission: {
      id: mission.id,
      rocketName: mission.rocketName,
      rocketConfiguration: mission.rocketConfiguration || null,
      launchAgency: mission.launchAgency,
      launchAgencyId: mission.launchAgencyId,
      launchAgencyAbbrev: mission.launchAgencyAbbrev,
      launchTime: mission.launchTime,
      agencyLaunchAttemptCount: mission.agencyLaunchAttemptCount != null
        ? mission.agencyLaunchAttemptCount
        : mission.agency_launch_attempt_count,
      agencyLaunchAttemptCountYear: mission.agencyLaunchAttemptCountYear != null
        ? mission.agencyLaunchAttemptCountYear
        : mission.agency_launch_attempt_count_year
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

  const needTotal = (data.providerTotal == null || data.providerTotal === '') && Number.isFinite(totalHint) && totalHint > 0
  const needYear = (data.providerYear == null || data.providerYear === '') && Number.isFinite(yearHint) && yearHint > 0
  if (!needTotal && !needYear) return data
  const out = { ...data }
  if (needTotal) out.providerTotal = totalHint
  if (needYear) out.providerYear = yearHint
  return out
}

module.exports = {
  formatCloudError,
  readPersistSnapshot,
  fetchGlobalLaunchStatsFromCloud,
  fetchGlobalSummaryFromCloud,
  fetchGlobalBreakdownFromCloud,
  fetchLaunchSummaryFromCloud,
  fetchMissionLaunchStatsFromCloud
}
