/**
 * 分包本地副本（源：utils/video-cache.js，主包已不引用，随 event-video 迁入分包）。
 * 若修改逻辑，请同步更新各分包内同名副本。
 */
/**
 * 短视频（压缩预览片）本地缓存：首页轮播 / 事件流复用
 *
 * 策略与 icon-cache 的图片缓存一致：
 * - 命中返回本地 wxfile 路径，本次会话零流量
 * - 未命中先返回远程 URL 流式播放；仅 Wi-Fi 下延后后台落盘，避免蜂窝下「流式 + 整文件」双计费
 * - 仅缓存压缩预览片（1~5MB 量级）；原片（可达 50MB）不进缓存
 */
const { runDownload } = require('../../../utils/download-pool.js')
const { toCdnUrl, isVideoUrl } = require('../../../utils/cos-url.js')
const { isDownloadBlacklisted, markDownloadFailed } = require('../../../utils/download-fail-cache.js')

const VIDEO_CACHE_DIR = `${wx.env.USER_DATA_PATH}/video_cache`
const VIDEO_INDEX_KEY = '_video_cache_index'
const MAX_VIDEO_ENTRIES = 10
// 延后下载：让首次流式播放先跑，避免播放与落盘下载抢同一条带宽
const VIDEO_BG_DOWNLOAD_DELAY_MS = 8000

let _videoIndex = null
let _videoDownloading = {}
let _videoUrlMemo = Object.create(null)

function _ensureDir() {
  try {
    wx.getFileSystemManager().accessSync(VIDEO_CACHE_DIR)
  } catch (e) {
    try {
      wx.getFileSystemManager().mkdirSync(VIDEO_CACHE_DIR, true)
    } catch (err) {}
  }
}

function _getIndex() {
  if (_videoIndex) return _videoIndex
  try {
    _videoIndex = wx.getStorageSync(VIDEO_INDEX_KEY) || {}
  } catch (e) {
    _videoIndex = {}
  }
  return _videoIndex
}

function _saveIndex() {
  try {
    wx.setStorage({ key: VIDEO_INDEX_KEY, data: _videoIndex, fail: function () {} })
  } catch (e) {}
}

function _touchLruKey(index, key) {
  const v = index[key]
  if (v === undefined) return
  delete index[key]
  index[key] = v
}

function _evictOverflow(index) {
  const keys = Object.keys(index)
  if (keys.length <= MAX_VIDEO_ENTRIES) return
  const fs = wx.getFileSystemManager()
  const removeCount = keys.length - MAX_VIDEO_ENTRIES
  for (let i = 0; i < removeCount; i++) {
    const k = keys[i]
    const p = index[k]
    delete index[k]
    if (p && typeof p === 'string') {
      try { fs.unlink({ filePath: p, fail: function () {} }) } catch (e) {}
    }
  }
}

function _hashString(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

function _urlToFileName(url) {
  const m = String(url).split('?')[0].match(/\.(mp4|mov|m4v|webm)$/i)
  const ext = m ? m[1].toLowerCase() : 'mp4'
  return `video_${_hashString(String(url))}.${ext}`
}

function _isCacheableVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return false
  return isVideoUrl(u)
}

/**
 * 仅 Wi-Fi 下后台落盘：蜂窝网络跳过，避免同片「流式播放 + 整文件下载」双计费
 * @returns {Promise<boolean>}
 */
function _isWifiNetwork() {
  return new Promise(function (resolve) {
    try {
      wx.getNetworkType({
        success: function (res) {
          resolve(String((res && res.networkType) || '').toLowerCase() === 'wifi')
        },
        fail: function () { resolve(false) }
      })
    } catch (e) {
      resolve(false)
    }
  })
}

/**
 * 获取视频本地缓存：命中返回 wxfile 路径，未命中返回远程 URL 并（仅 Wi-Fi）后台落盘
 * @param {string} url 压缩预览片 URL（不要传原片）
 * @returns {string}
 */
function getCachedVideo(url) {
  if (!_isCacheableVideoUrl(url)) return url
  url = toCdnUrl(String(url).trim())

  const memo = _videoUrlMemo[url]
  if (memo) return memo

  const index = _getIndex()
  const cached = index[url]
  if (cached) {
    try {
      wx.getFileSystemManager().accessSync(cached)
      _touchLruKey(index, url)
      _videoUrlMemo[url] = cached
      return cached
    } catch (e) {
      delete index[url]
      _saveIndex()
    }
  }

  _downloadVideoInBackground(url)
  return url
}

function _downloadVideoInBackground(url) {
  if (_videoDownloading[url] || isDownloadBlacklisted(url)) return
  _videoDownloading[url] = true

  const finish = function () {
    delete _videoDownloading[url]
  }

  setTimeout(function () {
    _isWifiNetwork().then(function (isWifi) {
      if (!isWifi) {
        finish()
        return
      }
      _startVideoDownload(url, finish)
    })
  }, VIDEO_BG_DOWNLOAD_DELAY_MS)
}

function _startVideoDownload(url, finish) {
  _ensureDir()
  const localPath = `${VIDEO_CACHE_DIR}/${_urlToFileName(url)}`

  runDownload(function () {
    return new Promise(function (resolve, reject) {
      wx.downloadFile({
        url: url,
        filePath: localPath,
        success: function (res) {
          if (res.statusCode === 200) resolve(res)
          else reject(Object.assign(new Error('download ' + res.statusCode), { statusCode: res.statusCode }))
        },
        fail: function (err) { reject(err) }
      })
    })
  })
    .then(function () {
      const index = _getIndex()
      index[url] = localPath
      _evictOverflow(index)
      _saveIndex()
      _videoUrlMemo[url] = localPath
    })
    .catch(function (err) {
      markDownloadFailed(url, err && err.statusCode)
    })
    .then(function () { finish() }, function () { finish() })
}

function clearVideoCache() {
  try {
    const fs = wx.getFileSystemManager()
    const files = fs.readdirSync(VIDEO_CACHE_DIR)
    files.forEach(function (f) {
      try { fs.unlinkSync(`${VIDEO_CACHE_DIR}/${f}`) } catch (e) {}
    })
  } catch (e) {}
  _videoIndex = {}
  _videoUrlMemo = Object.create(null)
  _saveIndex()
}

module.exports = {
  getCachedVideo,
  clearVideoCache
}
