/**
 * 今日推文账号统计：进展页胶囊与事件详情筛选条共用。
 * 10 分钟内存缓存 + inflight 去重，避免进度 Tab / 详情页各打一次云函数。
 */
const { resolveTweetAccountAvatarUrl } = require('../../../utils/event-share-image.js')

const TTL_MS = 10 * 60 * 1000
let memCache = null
let inflight = null

function safeResolveTweetAccountAvatarUrl(screenName) {
  try {
    return resolveTweetAccountAvatarUrl(screenName) || ''
  } catch (e) {
    return ''
  }
}

function mapTodayTweetAccountStats(result) {
  const payload = result && typeof result === 'object' ? result : {}
  if (!payload.success) return null
  const total = typeof payload.total === 'number' ? payload.total : 0
  const raw = Array.isArray(payload.tweetStats) ? payload.tweetStats : []
  const stats = raw.map((item) => {
    const screenName = item && item.screenName ? String(item.screenName) : ''
    return {
      screenName,
      label: (item && item.label) || screenName,
      avatarUrl: (item && item.avatarUrl) || safeResolveTweetAccountAvatarUrl(screenName),
      todayCount: item && typeof item.todayCount === 'number' ? item.todayCount : 0
    }
  }).filter((item) => !!item.screenName)
  return { total, stats }
}

function peekTodayTweetAccountStatsCache(now) {
  const ts = typeof now === 'number' ? now : Date.now()
  if (memCache && ts - memCache.at < TTL_MS) return memCache
  return null
}

function rememberTodayTweetAccountStats(mapped, now) {
  memCache = {
    at: typeof now === 'number' ? now : Date.now(),
    total: mapped.total || 0,
    stats: Array.isArray(mapped.stats) ? mapped.stats : []
  }
  return memCache
}

function resetTodayTweetAccountStatsCacheForTest() {
  memCache = null
  inflight = null
}

function resolveTweetAccountChip(list, dataset) {
  const ds = dataset && typeof dataset === 'object' ? dataset : {}
  const arr = Array.isArray(list) ? list : []
  let item = ds.index !== undefined && ds.index !== '' ? arr[ds.index] : null
  if (!item && ds.index !== undefined && ds.index !== '') {
    const n = parseInt(ds.index, 10)
    if (!isNaN(n)) item = arr[n]
  }
  const screenName = (item && item.screenName) || ds.source || ''
  const label = (item && item.label) || ds.label || ''
  return {
    screenName: String(screenName || ''),
    label: String(label || ''),
    item: item || null
  }
}

function fetchTodayTweetAccountStats(opts) {
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now()
  const hit = peekTodayTweetAccountStatsCache(now)
  if (hit) return Promise.resolve(hit)
  const cloud = typeof wx !== 'undefined' ? wx.cloud : null
  if (!cloud || typeof cloud.callFunction !== 'function') {
    return Promise.resolve(null)
  }
  if (inflight) return inflight
  inflight = cloud.callFunction({
    name: 'userDataGateway',
    data: { action: 'getTodayTweetStats' }
  }).then((res) => {
    const mapped = mapTodayTweetAccountStats(res && res.result)
    if (!mapped) return peekTodayTweetAccountStatsCache(now) || null
    return rememberTodayTweetAccountStats(mapped, Date.now())
  }).catch(() => null).then((value) => {
    inflight = null
    return value
  })
  return inflight
}

module.exports = {
  TTL_MS,
  mapTodayTweetAccountStats,
  peekTodayTweetAccountStatsCache,
  rememberTodayTweetAccountStats,
  resetTodayTweetAccountStatsCacheForTest,
  resolveTweetAccountChip,
  fetchTodayTweetAccountStats
}
