/**
 * COS 图标 / 火箭配置图 本地缓存模块
 * 远程资源首次加载后下载到本地文件，后续直接使用本地路径（减流量、GIF 可循环播）
 */

const { runDownload } = require('./download-pool.js')
const { optimizeImageUrl, toCdnUrl } = require('./cos-url.js')
const { isDownloadBlacklisted, markDownloadFailed } = require('./download-fail-cache.js')

const CACHE_DIR = `${wx.env.USER_DATA_PATH}/icon_cache`
const INDEX_KEY = '_icon_cache_index'

/** 火箭配置图单独目录，避免与通用图标清理策略互相影响 */
const ROCKET_CACHE_DIR = `${wx.env.USER_DATA_PATH}/rocket_config_cache`
const ROCKET_INDEX_KEY = '_rocket_config_cache_index'
/** 火箭配置 COS 路径（URL 编码片段），decode 失败时用其判断 */
const ROCKET_CONFIG_ENC = '%E7%81%AB%E7%AE%AD%E9%85%8D%E7%BD%AE%E5%9B%BE'
/** 历史遗留：早期版本曾按火箭名持久化本地路径，会导致后台换 GIF 后客户端永远不更新；
 *  保留 key 名以便冷启动一次性清理掉旧用户的存量 storage。 */
const LEGACY_ROCKET_NAME_INDEX_KEY = '_rocket_config_name_index'

let _index = null
let _downloading = {}

let _rocketIndex = null
let _rocketDownloading = {}
/** URL → 本地 wxfile 路径的内存缓存，避免重复 storage / accessSync */
let _rocketUrlMemo = Object.create(null)
let _legacyRocketIndexCleaned = false

/** 冷启动时延后清理历史遗留 key，避免 require 模块顶层触发 sync API */
function _cleanLegacyRocketNameIndexOnce() {
  if (_legacyRocketIndexCleaned) return
  _legacyRocketIndexCleaned = true
  setTimeout(function () {
    try { wx.removeStorage({ key: LEGACY_ROCKET_NAME_INDEX_KEY, fail: function () {} }) } catch (e) {}
  }, 0)
}

function _ensureDir() {
  try {
    wx.getFileSystemManager().accessSync(CACHE_DIR)
  } catch (e) {
    try {
      wx.getFileSystemManager().mkdirSync(CACHE_DIR, true)
    } catch (err) {}
  }
}

/** 索引条目上限：超出后按插入顺序淘汰最旧条目并删除对应本地文件，防止索引/磁盘只增不减 */
const MAX_ICON_ENTRIES = 300
const MAX_ROCKET_ENTRIES = 100

/** 命中时把 key 重新插入到对象末尾（JS 对象保持插入序），实现近似 LRU */
function _touchLruKey(index, key) {
  const v = index[key]
  if (v === undefined) return
  delete index[key]
  index[key] = v
}

/** 超上限时淘汰最旧条目并异步删除本地文件 */
function _evictOverflow(index, maxEntries) {
  const keys = Object.keys(index)
  if (keys.length <= maxEntries) return false
  const fs = wx.getFileSystemManager()
  const removeCount = keys.length - maxEntries
  for (let i = 0; i < removeCount; i++) {
    const k = keys[i]
    const p = index[k]
    delete index[k]
    if (p && typeof p === 'string') {
      try { fs.unlink({ filePath: p, fail: function () {} }) } catch (e) {}
    }
  }
  return true
}

function _getIndex() {
  _cleanLegacyRocketNameIndexOnce()
  if (_index) return _index
  try {
    _index = wx.getStorageSync(INDEX_KEY) || {}
  } catch (e) {
    _index = {}
  }
  return _index
}

function _saveIndex() {
  try {
    // 内存 _index 即时生效，磁盘落盘异步即可
    wx.setStorage({ key: INDEX_KEY, data: _index, fail: function () {} })
  } catch (e) {}
}

function _urlToFileName(url) {
  const hash = url.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_')
  return hash
}

/** 小图标展示用 thumb 版下载，避免拉取 MB 级 COS 原图 */
function _resolveDownloadUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (/\.gif(\?|[&#]|$)/i.test(url)) {
    // GIF 静图缩放会丢动画，改用万象 cgif 抽帧压缩（与 media 缓存链一致）；
    // 404（桶未开 CI）时下载层会自动回退原图
    const cdn = toCdnUrl(url)
    if (/imageMogr2|ci-process=/i.test(cdn)) return cdn
    const sep = cdn.indexOf('?') === -1 ? '?' : '&'
    return cdn + sep + 'imageMogr2/cgif/20'
  }
  return optimizeImageUrl(url, 'thumb')
}

/** 去掉万象/CI 处理参数，404 时回退原图直链 */
function _stripImageProcessParams(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return raw
  const qIdx = raw.indexOf('?')
  if (qIdx === -1) return raw
  const query = raw.slice(qIdx + 1)
  if (!/imageMogr2|ci-process=/i.test(query)) return raw
  return raw.slice(0, qIdx)
}

function _downloadFileOnce(downloadUrl, localPath) {
  return runDownload(function () {
    return new Promise(function (resolve, reject) {
      wx.downloadFile({
        url: downloadUrl,
        filePath: localPath,
        success: function (res) {
          if (res.statusCode === 200) {
            resolve(res)
          } else {
            reject(Object.assign(new Error('download ' + res.statusCode), { statusCode: res.statusCode }))
          }
        },
        fail: reject
      })
    })
  })
}

function _hashString(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function _urlToRocketFileName(url) {
  const m = String(url).match(/\.(gif|jpe?g|png|webp)(\?|$)/i)
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'dat'
  return `rcfg_${_hashString(url)}.${ext}`
}

/**
 * 获取图标的本地缓存路径，如果未缓存则返回原始 URL 并后台下载
 * @param {string} url - COS 图标远程 URL
 * @returns {string} 本地路径或原始 URL
 */
function getCachedIcon(url) {
  if (!url || typeof url !== 'string') return url
  url = toCdnUrl(url)

  const index = _getIndex()
  const cached = index[url]

  if (cached) {
    try {
      wx.getFileSystemManager().accessSync(cached)
      _touchLruKey(index, url)
      return cached
    } catch (e) {
      delete index[url]
      _saveIndex()
    }
  }

  _downloadInBackground(url)
  // 未命中时展示与后台下载相同的 thumb 压缩 URL，避免「原图展示 + 压缩下载」双倍下行
  return _resolveDownloadUrl(url)
}

function _downloadInBackground(url) {
  if (_downloading[url] || isDownloadBlacklisted(url)) return
  _downloading[url] = true

  _ensureDir()
  const fileName = _urlToFileName(url)
  const localPath = `${CACHE_DIR}/${fileName}`
  const downloadUrl = _resolveDownloadUrl(url)

  const finish = function () {
    delete _downloading[url]
  }

  const commitIconEntry = function () {
    const index = _getIndex()
    index[url] = localPath
    _evictOverflow(index, MAX_ICON_ENTRIES)
    _saveIndex()
  }

  _downloadFileOnce(downloadUrl, localPath)
    .then(commitIconEntry)
    .catch(function (err) {
      const code = err && err.statusCode
      if (code === 404 && downloadUrl !== url && !isDownloadBlacklisted(url)) {
        return _downloadFileOnce(url, localPath).then(commitIconEntry).catch(function (err2) {
          markDownloadFailed(url, err2 && err2.statusCode)
          if (downloadUrl !== url) markDownloadFailed(downloadUrl, code)
        })
      }
      markDownloadFailed(downloadUrl, code)
      if (downloadUrl !== url) markDownloadFailed(url, code)
    })
    .catch(function () {})
    .then(function () { finish() }, function () { finish() })
}

/**
 * 批量预缓存图标（页面 onLoad 时调用）
 * @param {string[]} urls - 需要缓存的图标 URL 列表
 */
function preloadIcons(urls) {
  if (!Array.isArray(urls)) return
  urls.forEach(function (url) {
    getCachedIcon(url)
  })
}

/**
 * 仅对 COS「火箭配置图/」目录下的 GIF 追加万象 GIF 帧抽取（不重传对象，需桶已开 CI）。
 * 已有 ?query 则用 &imageMogr2/cgif/20。
 */
function appendRocketGifCgifCi(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw || !/^https?:\/\//i.test(raw)) return raw
  try {
    if (decodeURIComponent(raw).indexOf('火箭配置图') === -1) {
      if (raw.indexOf(ROCKET_CONFIG_ENC) === -1) return raw
    }
  } catch (e) {
    if (raw.indexOf(ROCKET_CONFIG_ENC) === -1) return raw
  }
  if (!/\.gif(\?|[&#]|$)/i.test(raw)) return raw
  if (/imageMogr2/i.test(raw)) return raw
  const sep = raw.indexOf('?') === -1 ? '?' : '&'
  return raw + sep + 'imageMogr2/cgif/20'
}

function _ensureRocketDir() {
  try {
    wx.getFileSystemManager().accessSync(ROCKET_CACHE_DIR)
  } catch (e) {
    try {
      wx.getFileSystemManager().mkdirSync(ROCKET_CACHE_DIR, true)
    } catch (err) {}
  }
}

function _rocketDownloadKey(url) {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  // GIF：万象 cgif 抽帧（原逻辑）；静态图：medium 压缩。
  // 原来静态 jpg/png 直接拉 COS 原图（可达数 MB），是首页最高频的下行大头；
  // 用 medium 而非 thumb 是因为任务详情页头图全宽复用同一份缓存
  if (/\.gif(\?|[&#]|$)/i.test(trimmed)) {
    return toCdnUrl(appendRocketGifCgifCi(trimmed))
  }
  if (/imageMogr2|ci-process=/i.test(trimmed)) return toCdnUrl(trimmed)
  return optimizeImageUrl(trimmed, 'medium')
}

function _getRocketIndex() {
  _cleanLegacyRocketNameIndexOnce()
  if (_rocketIndex) return _rocketIndex
  try {
    _rocketIndex = wx.getStorageSync(ROCKET_INDEX_KEY) || {}
  } catch (e) {
    _rocketIndex = {}
  }
  return _rocketIndex
}

function _saveRocketIndex() {
  try {
    // 内存 _rocketIndex 即时生效，磁盘落盘异步即可
    wx.setStorage({ key: ROCKET_INDEX_KEY, data: _rocketIndex, fail: function () {} })
  } catch (e) {}
}

/**
 * 火箭配置图（COS/CDN HTTPS）：与图标相同策略，命中后走本地 wxfile 路径
 * @param {string} url
 * @returns {string}
 */
function getCachedRocketConfig(url) {
  if (!url || typeof url !== 'string') return url
  if (!/^https?:\/\//i.test(url)) return url

  url = _rocketDownloadKey(url)
  if (!url) return url

  const memo = _rocketUrlMemo[url]
  if (memo) return memo

  const idx = _getRocketIndex()
  const cached = idx[url]

  if (cached) {
    try {
      wx.getFileSystemManager().accessSync(cached)
      _touchLruKey(idx, url)
      _rocketUrlMemo[url] = cached
      return cached
    } catch (e) {
      delete idx[url]
      _saveRocketIndex()
    }
  }

  _downloadRocketInBackground(url)
  return url
}

/** 后台缓存下载延后启动：页面先用 HTTPS URL 渲染，延后可避免 downloadFile 计入「页面打开阶段」 */
const ROCKET_BG_DOWNLOAD_DELAY_MS = 2500

function _downloadRocketInBackground(url) {
  if (_rocketDownloading[url] || isDownloadBlacklisted(url)) return
  _rocketDownloading[url] = true

  const finish = function () {
    delete _rocketDownloading[url]
  }

  setTimeout(function () {
    _isWifiNetwork().then(function (wifi) {
      if (!wifi) {
        finish()
        return
      }
      _startRocketDownload(url, finish)
    })
  }, ROCKET_BG_DOWNLOAD_DELAY_MS)
}

function _startRocketDownload(url, finish) {
  _ensureRocketDir()
  const fileName = _urlToRocketFileName(url)
  const localPath = `${ROCKET_CACHE_DIR}/${fileName}`
  const fallbackUrl = _stripImageProcessParams(url)

  const commitRocketEntry = function () {
    const index = _getRocketIndex()
    index[url] = localPath
    _evictOverflow(index, MAX_ROCKET_ENTRIES)
    _saveRocketIndex()
    _rocketUrlMemo[url] = localPath
  }

  _downloadFileOnce(url, localPath)
    .then(commitRocketEntry)
    .catch(function (err) {
      const code = err && err.statusCode
      if (code === 404 && fallbackUrl && fallbackUrl !== url && !isDownloadBlacklisted(fallbackUrl)) {
        return _downloadFileOnce(fallbackUrl, localPath).then(commitRocketEntry).catch(function (err2) {
          markDownloadFailed(url, code)
          markDownloadFailed(fallbackUrl, err2 && err2.statusCode)
        })
      }
      markDownloadFailed(url, code)
    })
    .catch(function () {})
    .then(function () { finish() }, function () { finish() })
}

function preloadRocketConfigMedia(urls) {
  if (!Array.isArray(urls)) return
  urls.forEach(function (u) {
    if (!u || typeof u !== 'string') return
    const key = _rocketDownloadKey(u)
    if (!key || isDownloadBlacklisted(key)) return
    getCachedRocketConfig(u)
  })
}

/**
 * 清除所有图标缓存
 */
function clearIconCache() {
  try {
    const fs = wx.getFileSystemManager()
    const files = fs.readdirSync(CACHE_DIR)
    files.forEach(function (f) {
      try { fs.unlinkSync(`${CACHE_DIR}/${f}`) } catch (e) {}
    })
  } catch (e) {}
  _index = {}
  _saveIndex()
}

function clearRocketConfigCache() {
  try {
    const fs = wx.getFileSystemManager()
    const files = fs.readdirSync(ROCKET_CACHE_DIR)
    files.forEach(function (f) {
      try { fs.unlinkSync(`${ROCKET_CACHE_DIR}/${f}`) } catch (e) {}
    })
  } catch (e) {}
  _rocketIndex = {}
  _rocketUrlMemo = Object.create(null)
  try {
    wx.setStorageSync(ROCKET_INDEX_KEY, {})
    wx.removeStorageSync(LEGACY_ROCKET_NAME_INDEX_KEY)
  } catch (e) {}
}

// ── 通用远程图片本地缓存（轮播/feed/事件/机构图等，与 icon/rocket 目录分离） ──
const MEDIA_CACHE_DIR = `${wx.env.USER_DATA_PATH}/media_cache`
const MEDIA_INDEX_KEY = '_media_cache_index'
const MAX_MEDIA_ENTRIES = 500
/** 后台落盘延后：与 <image> 首屏拉取错开；仅 Wi-Fi 落盘，避免蜂窝双计费 */
const MEDIA_BG_DOWNLOAD_DELAY_MS = 2500

let _mediaIndex = null
let _mediaDownloading = {}
let _mediaUrlMemo = Object.create(null)

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

function isRemoteCacheableImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return false
  if (/^wxfile:\/\//i.test(u)) return false
  if (/\.(mp4|m3u8|mov|webm)(\?|[&#]|$)/i.test(u)) return false
  return true
}

function _ensureMediaDir() {
  try {
    wx.getFileSystemManager().accessSync(MEDIA_CACHE_DIR)
  } catch (e) {
    try {
      wx.getFileSystemManager().mkdirSync(MEDIA_CACHE_DIR, true)
    } catch (err) {}
  }
}

function _getMediaIndex() {
  if (_mediaIndex) return _mediaIndex
  try {
    _mediaIndex = wx.getStorageSync(MEDIA_INDEX_KEY) || {}
  } catch (e) {
    _mediaIndex = {}
  }
  return _mediaIndex
}

function _saveMediaIndex() {
  try {
    wx.setStorage({ key: MEDIA_INDEX_KEY, data: _mediaIndex, fail: function () {} })
  } catch (e) {}
}

function _mediaDownloadUrl(url, preset) {
  if (!url) return url
  if (preset === 'none') return toCdnUrl(url)
  // GIF 不能走静图 imageMogr2 缩放（会丢动画），改用万象 cgif 帧抽取压缩，
  // 原图动辄数 MB，抽帧后体积可降一个量级；404（桶未开 CI）时下载层会自动回退原图
  if (/\.gif(\?|[&#]|$)/i.test(url)) {
    const cdn = toCdnUrl(url)
    if (/imageMogr2|ci-process=/i.test(cdn)) return cdn
    const sep = cdn.indexOf('?') === -1 ? '?' : '&'
    return cdn + sep + 'imageMogr2/cgif/20'
  }
  return optimizeImageUrl(url, preset || 'thumb')
}

function _urlToMediaFileName(url) {
  const m = String(url).match(/\.(gif|jpe?g|png|webp|svg)(\?|$)/i)
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img'
  return `media_${_hashString(url)}.${ext}`
}

/**
 * 通用 HTTPS 图片本地缓存：命中返回 wxfile 路径，未命中先展示远程 URL 并后台落盘
 * @param {string} url
 * @param {'thumb'|'medium'|'full'|'none'} [preset='thumb'] preset=none 表示 url 已带万象参数不再二次处理
 */
function getCachedMediaImage(url, preset) {
  if (!isRemoteCacheableImageUrl(url)) return url
  url = toCdnUrl(String(url).trim())
  if (!url) return url

  const memo = _mediaUrlMemo[url]
  if (memo) return memo

  const index = _getMediaIndex()
  const cached = index[url]
  if (cached) {
    try {
      wx.getFileSystemManager().accessSync(cached)
      _touchLruKey(index, url)
      _mediaUrlMemo[url] = cached
      return cached
    } catch (e) {
      delete index[url]
      _saveMediaIndex()
    }
  }

  _downloadMediaInBackground(url, preset)
  // 未命中时展示压缩版 URL（与后台下载同一 URL）：
  // 原来展示原图 + 后台下载压缩版是两个不同 URL，产生「原图大流量 + 压缩版」双倍下行；
  // 统一后展示流量降为压缩版体积，且与落盘下载共享 CDN/HTTP 缓存
  return _mediaDownloadUrl(url, preset)
}

function _downloadMediaInBackground(url, preset) {
  if (_mediaDownloading[url] || isDownloadBlacklisted(url)) return
  _mediaDownloading[url] = true

  const finish = function () {
    delete _mediaDownloading[url]
  }

  setTimeout(function () {
    // 蜂窝下只走 <image> 一次远程拉取，不后台 downloadFile 双计费
    _isWifiNetwork().then(function (wifi) {
      if (!wifi) {
        finish()
        return
      }
      _startMediaDownload(url, preset, finish)
    })
  }, MEDIA_BG_DOWNLOAD_DELAY_MS)
}

function _startMediaDownload(url, preset, finish) {
  _ensureMediaDir()
  const fileName = _urlToMediaFileName(url)
  const localPath = `${MEDIA_CACHE_DIR}/${fileName}`
  const downloadUrl = _mediaDownloadUrl(url, preset)
  const fallbackUrl = _stripImageProcessParams(downloadUrl)

  const commitMediaEntry = function () {
    const index = _getMediaIndex()
    index[url] = localPath
    _evictOverflow(index, MAX_MEDIA_ENTRIES)
    _saveMediaIndex()
    _mediaUrlMemo[url] = localPath
  }

  _downloadFileOnce(downloadUrl, localPath)
    .then(commitMediaEntry)
    .catch(function (err) {
      const code = err && err.statusCode
      if (code === 404 && fallbackUrl && fallbackUrl !== downloadUrl && !isDownloadBlacklisted(fallbackUrl)) {
        return _downloadFileOnce(fallbackUrl, localPath).then(commitMediaEntry).catch(function (err2) {
          markDownloadFailed(url, code)
          markDownloadFailed(fallbackUrl, err2 && err2.statusCode)
        })
      }
      markDownloadFailed(downloadUrl, code)
      if (downloadUrl !== url) markDownloadFailed(url, code)
    })
    .catch(function () {})
    .then(function () { finish() }, function () { finish() })
}

function preloadMediaImages(urls, preset) {
  if (!Array.isArray(urls)) return
  urls.forEach(function (u) {
    if (u && isRemoteCacheableImageUrl(u) && !isDownloadBlacklisted(u)) {
      getCachedMediaImage(u, preset)
    }
  })
}

/** 冷启动预载高频静态 COS 图（徽章/头像等），减少首屏重复拉取 */
function preloadStaticMediaUrls() {
  const base = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com'
  const urls = [
    base + '/%E7%AD%BE%E5%88%B0%E5%9B%BE%E6%A0%87/1_1.png',
    base + '/%E7%AD%BE%E5%88%B0%E5%9B%BE%E6%A0%87/2_1.png',
    base + '/%E7%AD%BE%E5%88%B0%E5%9B%BE%E6%A0%87/3_1.png',
    base + '/avatars/SpaceX.jpg',
    base + '/avatars/ElonMusk.jpg',
    base + '/avatars/NASA.jpg'
  ]
  preloadMediaImages(urls, 'thumb')
  preloadIcons(urls)
}

module.exports = {
  getCachedIcon,
  preloadIcons,
  clearIconCache,
  getCachedRocketConfig,
  appendRocketGifCgifCi,
  preloadRocketConfigMedia,
  clearRocketConfigCache,
  isRemoteCacheableImageUrl,
  getCachedMediaImage,
  preloadMediaImages,
  preloadStaticMediaUrls
}
