/**
 * 缓存常量 — api.js 和 api-cache-clean.js 共享
 */
const CACHE_PREFIX = 'api_cache_'
const CACHE_DURATION = 30 * 60 * 1000 // 30 分钟（毫秒）

module.exports = {
  CACHE_PREFIX,
  CACHE_DURATION
}
