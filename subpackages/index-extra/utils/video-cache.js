/**
 * 薄壳：正本在 subpackages/shared/utils/video-cache.js（placeholder 同步锚点）。
 * 模块未就绪时返回远端 URL，语义等同缓存未命中。
 */
const { toCdnUrl } = require('../../../utils/cos-url.js')

function loadVideoCache() {
  if (!loadVideoCache._p) {
    loadVideoCache._p = require.async('../../shared/utils/video-cache.js').then((m) => {
      loadVideoCache._m = m
      return m
    })
  }
  return loadVideoCache._p
}
loadVideoCache()

function getCachedVideo(url) {
  if (loadVideoCache._m) return loadVideoCache._m.getCachedVideo(url)
  const raw = String(url || '').trim()
  return raw ? (toCdnUrl(raw) || raw) : url
}

function clearVideoCache() {
  if (loadVideoCache._m) return loadVideoCache._m.clearVideoCache()
  return loadVideoCache().then((m) => m.clearVideoCache())
}

module.exports = {
  loadVideoCache,
  getCachedVideo,
  clearVideoCache
}
