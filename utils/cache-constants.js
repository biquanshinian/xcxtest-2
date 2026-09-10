/**
 * 缓存常量 — api-request.js 和 api-cache-clean.js 共享
 */
const CACHE_PREFIX = 'api_cache_'
const CACHE_DURATION = 30 * 60 * 1000 // 30 分钟（毫秒）

// ── 慢变化端点分档 ──
// 空间站/对接事件/远征乘组/发射商这类数据由云函数每 6 小时同步一次，
// 内容本身数月才变，本地缓存与后台探云按 30 分钟节奏刷新纯属浪费库读。
// 命中以下 URL 片段的缓存 key 走慢档 TTL，与服务端同步节奏对齐。
const SLOW_ENDPOINT_PATTERNS = ['/space_stations/', '/docking_events/', '/expeditions/', '/agencies/']
const SLOW_CACHE_DURATION = 6 * 60 * 60 * 1000 // 6 小时 - 慢档本地缓存有效期
const SLOW_STALE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000 // 24 小时 - 慢档过期缓存最大可用时间

/** 缓存 key 内嵌了 API 路径（api_cache_/xxx/_params），据此判断是否慢档端点 */
function isSlowEndpointKey(cacheKey) {
  if (typeof cacheKey !== 'string') return false
  for (let i = 0; i < SLOW_ENDPOINT_PATTERNS.length; i++) {
    if (cacheKey.indexOf(SLOW_ENDPOINT_PATTERNS[i]) !== -1) return true
  }
  return false
}

module.exports = {
  CACHE_PREFIX,
  CACHE_DURATION,
  SLOW_CACHE_DURATION,
  SLOW_STALE_CACHE_MAX_AGE,
  isSlowEndpointKey
}
