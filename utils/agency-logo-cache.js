/**
 * 发射商 Logo：远程 URL 首次展示成功后落盘到本地，下次优先读缓存（与 icon-cache 策略一致）
 */

const { runDownload } = require('./download-pool.js')
const { toCdnUrl, optimizeImageUrl, isCosOriginUrl } = require('./cos-url.js')
const { isDownloadBlacklisted, markDownloadFailed } = require('./download-fail-cache.js')

/**
 * COS 静图 logo 统一用 thumb 压缩版展示/下载：logo 展示尺寸极小（几十 rpx），
 * 原图动辄数百 KB～数 MB，是重复出现的下行浪费；非 COS 域名（LL2 等）原样返回
 */
function _optimizedLogoUrl(raw) {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return u
  if (/imageMogr2|ci-process=/i.test(u)) return toCdnUrl(u)
  if (isCosOriginUrl(u) && !/\.gif(\?|[&#]|$)/i.test(u)) return optimizeImageUrl(u, 'thumb')
  return toCdnUrl(u)
}

const CACHE_DIR = `${wx.env.USER_DATA_PATH}/agency_logo_cache`
const INDEX_KEY = '_agency_logo_cache_index'

let _index = null
/** @type {Record<string, Array<(p: string|null) => void>>} */
let _queues = {}

function _ensureDir() {
  try {
    wx.getFileSystemManager().accessSync(CACHE_DIR)
  } catch (e) {
    try {
      wx.getFileSystemManager().mkdirSync(CACHE_DIR, true)
    } catch (err) {}
  }
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

function _extFromUrl(url) {
  const m = String(url).match(/\.(gif|jpe?g|png|webp|svg)(\?|$)/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img'
}

function _localPathForUrl(url) {
  return `${CACHE_DIR}/agency_${_hashString(url)}.${_extFromUrl(url)}`
}

function _getIndex() {
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
    // 内存 _index 即时生效，磁盘落盘异步即可，避免主线程同步写 storage
    wx.setStorage({ key: INDEX_KEY, data: _index, fail: function () {} })
  } catch (e) {}
}

/** 索引条目上限：超出后按插入顺序淘汰最旧条目并删除本地文件（近似 LRU，命中时 key 会被移到末尾） */
const MAX_ENTRIES = 200

function _touchLruKey(key) {
  const index = _getIndex()
  const v = index[key]
  if (v === undefined) return
  delete index[key]
  index[key] = v
}

function _evictOverflow() {
  const index = _getIndex()
  const keys = Object.keys(index)
  if (keys.length <= MAX_ENTRIES) return
  const fs = wx.getFileSystemManager()
  const removeCount = keys.length - MAX_ENTRIES
  for (let i = 0; i < removeCount; i++) {
    const k = keys[i]
    const p = index[k]
    delete index[k]
    if (p && typeof p === 'string') {
      try { fs.unlink({ filePath: p, fail: function () {} }) } catch (e) {}
    }
  }
}

function isRemoteAgencyLogoUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
}

/**
 * 同步：已缓存且文件存在则返回本地路径
 */
function getCachedAgencyLogoPath(url) {
  if (!isRemoteAgencyLogoUrl(url)) return ''
  const u = url.trim()
  const index = _getIndex()
  const p = index[u]
  if (!p) return ''
  try {
    wx.getFileSystemManager().accessSync(p)
    _touchLruKey(u)
    return p
  } catch (e) {
    delete index[u]
    _saveIndex()
    return ''
  }
}

/** 展示用：命中缓存则本地路径，否则压缩版 URL（与落盘下载共用同一 URL，避免双份下行） */
function resolveAgencyLogoForDisplay(url) {
  if (!url || typeof url !== 'string') return url
  const trimmed = _optimizedLogoUrl(url)
  if (!isRemoteAgencyLogoUrl(trimmed)) return trimmed
  const local = getCachedAgencyLogoPath(trimmed)
  return local || trimmed
}

function _flushQueue(remoteUrl, localPath) {
  const q = _queues[remoteUrl] || []
  delete _queues[remoteUrl]
  for (let i = 0; i < q.length; i++) {
    try {
      q[i](localPath)
    } catch (e) {}
  }
}

/**
 * 远程图在界面加载成功后调用：写入 USER_DATA_PATH，并索引 URL → 本地路径
 * @param {string} remoteUrl
 * @param {(localPath: string|null) => void} [onDone]
 */
function persistAgencyLogoAfterRemoteLoad(remoteUrl, onDone) {
  const u = typeof remoteUrl === 'string' ? _optimizedLogoUrl(remoteUrl) : ''
  const cb = typeof onDone === 'function' ? onDone : function () {}

  if (!isRemoteAgencyLogoUrl(u)) {
    cb(null)
    return
  }

  const existing = getCachedAgencyLogoPath(u)
  if (existing) {
    cb(existing)
    return
  }

  if (isDownloadBlacklisted(u)) {
    cb(null)
    return
  }

  if (!_queues[u]) _queues[u] = []
  _queues[u].push(cb)
  if (_queues[u].length > 1) return

  _ensureDir()
  const localPath = _localPathForUrl(u)

  runDownload(function () {
    return new Promise(function (resolve, reject) {
      wx.downloadFile({
        url: u,
        filePath: localPath,
        success(res) {
          if (res.statusCode === 200) {
            const index = _getIndex()
            index[u] = localPath
            _evictOverflow()
            _saveIndex()
            _flushQueue(u, localPath)
            resolve(res)
          } else {
            markDownloadFailed(u, res.statusCode)
            _flushQueue(u, null)
            reject(Object.assign(new Error('download ' + res.statusCode), { statusCode: res.statusCode }))
          }
        },
        fail(err) {
          _flushQueue(u, null)
          reject(err)
        }
      })
    })
  }).catch(function () {
    _flushQueue(u, null)
  })
}

module.exports = {
  isRemoteAgencyLogoUrl,
  getCachedAgencyLogoPath,
  resolveAgencyLogoForDisplay,
  persistAgencyLogoAfterRemoteLoad
}
