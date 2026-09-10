/**
 * 今日推文账号统计：进展页胶囊与事件详情筛选条共用。
 * 10 分钟内存缓存 + inflight 去重，避免进度 Tab / 详情页各打一次云函数。
 */
const { resolveTweetAccountAvatarUrl } = require('../../../utils/event-share-image.js')
const { normalizeVerifyBadge, verifyBadgeSrc } = require('./x-verify-badge.js')

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

function rememberVerifyBadge(map, key, badge) {
  const name = String(key || '')
  const kind = normalizeVerifyBadge(badge)
  if (!name || kind === 'none') return
  map[name] = kind
  map[name.toLowerCase()] = kind
}

function lookupVerifyBadge(badgeBySource, source) {
  const key = String(source || '')
  if (!key || !badgeBySource || typeof badgeBySource !== 'object') return 'none'
  if (badgeBySource[key]) return normalizeVerifyBadge(badgeBySource[key])
  const lower = key.toLowerCase()
  if (badgeBySource[lower]) return normalizeVerifyBadge(badgeBySource[lower])
  const names = Object.keys(badgeBySource)
  for (let i = 0; i < names.length; i++) {
    if (String(names[i]).toLowerCase() === lower) return normalizeVerifyBadge(badgeBySource[names[i]])
  }
  return 'none'
}

function collectBadgeBySource(payload, stats) {
  const badgeBySource = {}
  const rawMap = payload && payload.badgeBySource && typeof payload.badgeBySource === 'object'
    ? payload.badgeBySource
    : {}
  Object.keys(rawMap).forEach((key) => {
    rememberVerifyBadge(badgeBySource, key, rawMap[key])
  })
  ;(Array.isArray(stats) ? stats : []).forEach((item) => {
    if (!item || !item.screenName) return
    rememberVerifyBadge(badgeBySource, item.screenName, item.verifyBadge)
  })
  return badgeBySource
}

function mapTodayTweetAccountStats(result) {
  const payload = result && typeof result === 'object' ? result : {}
  if (!payload.success) return null
  const total = typeof payload.total === 'number' ? payload.total : 0
  const raw = Array.isArray(payload.tweetStats) ? payload.tweetStats : []
  const stats = raw.map((item) => {
    const screenName = item && item.screenName ? String(item.screenName) : ''
    const verifyBadge = normalizeVerifyBadge(item && item.verifyBadge)
    return {
      screenName,
      label: (item && item.label) || screenName,
      avatarUrl: (item && item.avatarUrl) || safeResolveTweetAccountAvatarUrl(screenName),
      todayCount: item && typeof item.todayCount === 'number' ? item.todayCount : 0,
      verifyBadge,
      verifyBadgeSrc: (item && item.verifyBadgeSrc) || verifyBadgeSrc(verifyBadge)
    }
  }).filter((item) => !!item.screenName)
  return { total, stats, badgeBySource: collectBadgeBySource(payload, stats) }
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
    stats: Array.isArray(mapped.stats) ? mapped.stats : [],
    badgeBySource: (mapped && mapped.badgeBySource) || {}
  }
  return memCache
}

function attachVerifyBadgeToItem(item, badgeBySource) {
  if (!item || typeof item !== 'object') return item
  const fromMap = lookupVerifyBadge(badgeBySource, item.source)
  const verifyBadge = fromMap !== 'none' ? fromMap : normalizeVerifyBadge(item.verifyBadge)
  const src = verifyBadgeSrc(verifyBadge)
  if (item.verifyBadge === verifyBadge && item.verifyBadgeSrc === src) return item
  return Object.assign({}, item, { verifyBadge, verifyBadgeSrc: src })
}

function attachVerifyBadgeToList(list, badgeBySource) {
  if (!Array.isArray(list) || !list.length) return list
  let changed = false
  const next = list.map((it) => {
    const attached = attachVerifyBadgeToItem(it, badgeBySource)
    if (attached !== it) changed = true
    return attached
  })
  return changed ? next : list
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
  fetchTodayTweetAccountStats,
  attachVerifyBadgeToItem,
  attachVerifyBadgeToList
}
