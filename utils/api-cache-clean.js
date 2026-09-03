/**
 * 仅清理 api.js 使用的本地 Storage 缓存键
 * 供 app.js 调用，避免启动时 require 整份 api.js
 */
const {
  CACHE_PREFIX,
  CACHE_DURATION,
  SLOW_STALE_CACHE_MAX_AGE,
  isSlowEndpointKey
} = require('./cache-constants.js')

// 60s 内不重复扫描（启动清理与配额超限触发的清理共用）
let _lastCleanAt = 0
const CLEAN_MIN_INTERVAL = 60 * 1000

/**
 * 单次异步扫描（wx.getStorageInfo），同时处理：
 * 1. 过期的 api_cache_* 缓存
 * 2. 旧 slim schema 版本的列表缓存（_slim / _slim_v2，缺 landing.success 等字段会误用老数据）
 *
 * 全程异步分片，避免启动路径出现 getStorageInfoSync / getStorageSync 阻塞主线程。
 */
function cleanExpiredApiCache() {
  const now = Date.now()
  if (now - _lastCleanAt < CLEAN_MIN_INTERVAL) return
  _lastCleanAt = now

  wx.getStorageInfo({
    success: (info) => {
      const allKeys = (info && info.keys) || []
      const legacyKeys = []
      const cacheKeys = []
      allKeys.forEach((k) => {
        if (!k.startsWith(CACHE_PREFIX)) return
        if (k.endsWith('_slim') || k.endsWith('_slim_v2')) legacyKeys.push(k)
        else cacheKeys.push(k)
      })

      // 旧 slim key 直接删，无需读内容
      legacyKeys.forEach((key) => {
        try { wx.removeStorage({ key, fail: () => {} }) } catch (err) {}
      })

      if (!cacheKeys.length) return
      const scanTs = Date.now()
      const BATCH = 8
      let i = 0
      const step = () => {
        const end = Math.min(i + BATCH, cacheKeys.length)
        for (; i < end; i++) {
          const key = cacheKeys[i]
          wx.getStorage({
            key: key,
            success: (res) => {
              const cacheData = res.data
              // 慢档端点（空间站/对接/远征/机构）保留到 stale 上限再删，
              // 否则启动清理会把 6 小时档缓存按 30 分钟阈值误删
              const maxAge = isSlowEndpointKey(key) ? SLOW_STALE_CACHE_MAX_AGE : CACHE_DURATION
              if (cacheData && scanTs - cacheData.timestamp > maxAge) {
                wx.removeStorage({ key: key, fail: () => {} })
              }
            },
            fail: () => {
              try { wx.removeStorage({ key: key, fail: () => {} }) } catch (err) {}
            }
          })
        }
        if (i < cacheKeys.length) {
          setTimeout(step, 50)
        }
      }
      setTimeout(step, 100)
    },
    fail: () => {}
  })
}

/** 兼容旧调用方：逻辑已并入 cleanExpiredApiCache 的单次扫描 */
function cleanLegacySlimCache() {
  cleanExpiredApiCache()
}

module.exports = {
  cleanExpiredApiCache,
  cleanLegacySlimCache,
  CACHE_PREFIX,
  CACHE_DURATION
}
