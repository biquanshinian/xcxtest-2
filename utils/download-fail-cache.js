/**
 * wx.downloadFile 永久失败 URL 黑名单（404/403/410），避免首屏重复请求坏链
 */
const BLACKLIST_KEY = '_download_url_blacklist'
const MAX_ENTRIES = 200

let _mem = null
let _loaded = false

function _load() {
  if (_loaded) return _mem || {}
  _loaded = true
  try {
    _mem = wx.getStorageSync(BLACKLIST_KEY) || {}
  } catch (e) {
    _mem = {}
  }
  return _mem
}

function _save() {
  try {
    wx.setStorageSync(BLACKLIST_KEY, _mem || {})
  } catch (e) {}
}

function normalizeDownloadUrl(url) {
  return typeof url === 'string' ? url.trim() : ''
}

function isDownloadBlacklisted(url) {
  const u = normalizeDownloadUrl(url)
  if (!u) return false
  return !!_load()[u]
}

/** @param {number} statusCode */
function markDownloadFailed(url, statusCode) {
  const u = normalizeDownloadUrl(url)
  if (!u) return
  const code = Number(statusCode) || 0
  if (code !== 404 && code !== 403 && code !== 410) return

  const bl = _load()
  bl[u] = { statusCode: code, ts: Date.now() }
  const keys = Object.keys(bl)
  if (keys.length > MAX_ENTRIES) {
    keys.sort(function (a, b) {
      return (bl[a].ts || 0) - (bl[b].ts || 0)
    })
    for (let i = 0; i < keys.length - MAX_ENTRIES; i++) {
      delete bl[keys[i]]
    }
  }
  _save()
}

module.exports = {
  normalizeDownloadUrl,
  isDownloadBlacklisted,
  markDownloadFailed
}
