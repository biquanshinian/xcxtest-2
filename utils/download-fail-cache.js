/**
 * wx.downloadFile 失败 URL 抑制：
 * - 永久黑名单：404/403/410（写 storage）
 * - 软退避：超时/网络失败等短时内存抑制，避免弱网刷错误率
 */
const BLACKLIST_KEY = '_download_url_blacklist'
const MAX_ENTRIES = 200
/** 瞬时失败软退避（仅内存，冷启动清空） */
const SOFT_FAIL_TTL_MS = 15 * 60 * 1000
const MAX_SOFT_ENTRIES = 300

let _mem = null
let _loaded = false
/** @type {Record<string, number>} url → expireAt */
let _softFailUntil = Object.create(null)

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

function isDownloadSoftFailed(url) {
  const u = normalizeDownloadUrl(url)
  if (!u) return false
  const until = _softFailUntil[u]
  if (!until) return false
  if (Date.now() >= until) {
    delete _softFailUntil[u]
    return false
  }
  return true
}

/** 永久黑名单或软退避期间，跳过 downloadFile */
function shouldSkipDownload(url) {
  return isDownloadBlacklisted(url) || isDownloadSoftFailed(url)
}

/** @param {number} statusCode */
function markDownloadFailed(url, statusCode) {
  const u = normalizeDownloadUrl(url)
  if (!u) return
  const code = Number(statusCode) || 0
  if (code !== 404 && code !== 403 && code !== 410) {
    // 非永久错误：短时软退避（含 statusCode=0 的网络失败）
    markDownloadSoftFailed(u)
    return
  }

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
  delete _softFailUntil[u]
}

function markDownloadSoftFailed(url) {
  const u = normalizeDownloadUrl(url)
  if (!u) return
  _softFailUntil[u] = Date.now() + SOFT_FAIL_TTL_MS
  const keys = Object.keys(_softFailUntil)
  if (keys.length > MAX_SOFT_ENTRIES) {
    keys.sort(function (a, b) {
      return (_softFailUntil[a] || 0) - (_softFailUntil[b] || 0)
    })
    for (let i = 0; i < keys.length - MAX_SOFT_ENTRIES; i++) {
      delete _softFailUntil[keys[i]]
    }
  }
}

module.exports = {
  normalizeDownloadUrl,
  isDownloadBlacklisted,
  isDownloadSoftFailed,
  shouldSkipDownload,
  markDownloadFailed,
  markDownloadSoftFailed
}
