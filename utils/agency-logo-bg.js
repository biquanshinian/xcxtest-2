/**
 * 发射商透明 Logo 自动底色：
 * 本地落盘后用离屏 canvas 采样 alpha / 主色，按对比度选白底或黑底并持久化。
 * 不透明图（JPG 等）保持空 tone，沿用各页 CSS 默认衬底。
 */

const SAMPLE_SIZE = 32
const ALPHA_OPAQUE = 16
const MIN_TRANSPARENT_RATIO = 0.08
const MIN_OPAQUE_PIXELS = 8
const INDEX_KEY = '_agency_logo_bg_index'
const MAX_ENTRIES = 300

const LOGO_BG_LIGHT = '#ffffff'
const LOGO_BG_DARK = '#111111'

let _index = null
/** @type {Record<string, Array<(tone: string) => void>>} */
let _queues = {}

function _normalizeUrlKey(url) {
  if (typeof url !== 'string' || !url.trim()) return ''
  try {
    const { normalizeAgencyLogoCacheKey } = require('./agency-logo-cache.js')
    return normalizeAgencyLogoCacheKey(url) || url.trim()
  } catch (e) {
    return url.trim()
  }
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
    wx.setStorage({ key: INDEX_KEY, data: _index, fail: function () {} })
  } catch (e) {}
}

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
  const removeCount = keys.length - MAX_ENTRIES
  for (let i = 0; i < removeCount; i++) {
    delete index[keys[i]]
  }
}

function _srgbToLinear(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance(r, g, b) {
  return 0.2126 * _srgbToLinear(r) + 0.7152 * _srgbToLinear(g) + 0.0722 * _srgbToLinear(b)
}

/**
 * 从像素缓冲判定底色 tone（纯函数，可单测）
 * @param {Uint8ClampedArray|number[]|ArrayLike<number>} data RGBA
 * @param {number} width
 * @param {number} height
 * @returns {''|'light'|'dark'}
 */
function pickLogoBgToneFromPixels(data, width, height) {
  const w = width | 0
  const h = height | 0
  if (!data || w <= 0 || h <= 0) return ''
  const expected = w * h * 4
  if (data.length < expected) return ''

  let opaqueCount = 0
  let transparentCount = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0

  for (let i = 0; i < expected; i += 4) {
    const a = data[i + 3]
    if (a < ALPHA_OPAQUE) {
      transparentCount += 1
      continue
    }
    opaqueCount += 1
    sumR += data[i]
    sumG += data[i + 1]
    sumB += data[i + 2]
  }

  const total = opaqueCount + transparentCount
  if (total <= 0 || opaqueCount < MIN_OPAQUE_PIXELS) return ''
  if (transparentCount / total < MIN_TRANSPARENT_RATIO) return ''

  const r = sumR / opaqueCount
  const g = sumG / opaqueCount
  const b = sumB / opaqueCount
  const L = relativeLuminance(r, g, b)
  const contrastWhite = 1.05 / (L + 0.05)
  const contrastBlack = (L + 0.05) / 0.05
  return contrastBlack > contrastWhite ? 'dark' : 'light'
}

/**
 * 同步：已分析过则返回 tone（'' 表示刻意不改底，也会缓存）
 * @param {string} url
 * @returns {''|'light'|'dark'|undefined} undefined = 尚未分析
 */
function getCachedAgencyLogoBgTone(url) {
  const key = _normalizeUrlKey(url)
  if (!key) return undefined
  const index = _getIndex()
  if (!Object.prototype.hasOwnProperty.call(index, key)) return undefined
  _touchLruKey(key)
  const v = index[key]
  return v === 'light' || v === 'dark' || v === '' ? v : undefined
}

/** 同步展示用：有缓存返回 tone，否则 ''（沿用 CSS 默认） */
function resolveAgencyLogoBgTone(url) {
  const cached = getCachedAgencyLogoBgTone(url)
  return cached === 'light' || cached === 'dark' ? cached : ''
}

function _setCachedTone(key, tone) {
  const index = _getIndex()
  index[key] = tone
  _evictOverflow()
  _saveIndex()
}

function _flushQueue(key, tone) {
  const q = _queues[key] || []
  delete _queues[key]
  for (let i = 0; i < q.length; i++) {
    try {
      q[i](tone)
    } catch (e) {}
  }
}

function _analyzeLocalPath(localPath, onTone) {
  const done = typeof onTone === 'function' ? onTone : function () {}
  if (!localPath || typeof localPath !== 'string') {
    done('')
    return
  }
  if (typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') {
    done('')
    return
  }

  let canvas
  try {
    canvas = wx.createOffscreenCanvas({ type: '2d', width: SAMPLE_SIZE, height: SAMPLE_SIZE })
  } catch (e) {
    done('')
    return
  }
  if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.createImage !== 'function') {
    done('')
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    done('')
    return
  }

  const img = canvas.createImage()
  let settled = false
  const finish = function (tone) {
    if (settled) return
    settled = true
    done(tone)
  }

  img.onload = function () {
    try {
      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const tone = pickLogoBgToneFromPixels(imageData.data, SAMPLE_SIZE, SAMPLE_SIZE)
      finish(tone === 'light' || tone === 'dark' ? tone : '')
    } catch (e) {
      finish('')
    }
  }
  img.onerror = function () {
    finish('')
  }
  try {
    img.src = localPath
  } catch (e) {
    finish('')
  }
}

/**
 * 本地路径可用时分析并缓存 tone；已缓存则同步回调。
 * @param {string} remoteUrl 与 logo 缓存同一 URL key（建议已 optimize）
 * @param {string} localPath wxfile / USER_DATA_PATH
 * @param {(tone: ''|'light'|'dark') => void} [onDone]
 */
function ensureAgencyLogoBgTone(remoteUrl, localPath, onDone) {
  const key = _normalizeUrlKey(remoteUrl)
  const cb = typeof onDone === 'function' ? onDone : function () {}
  if (!key || !localPath) {
    cb('')
    return
  }

  const cached = getCachedAgencyLogoBgTone(key)
  if (cached !== undefined) {
    cb(cached === 'light' || cached === 'dark' ? cached : '')
    return
  }

  if (!_queues[key]) _queues[key] = []
  _queues[key].push(cb)
  if (_queues[key].length > 1) return

  _analyzeLocalPath(localPath, function (tone) {
    const t = tone === 'light' || tone === 'dark' ? tone : ''
    _setCachedTone(key, t)
    _flushQueue(key, t)
  })
}

/**
 * 若本地 logo 已缓存但尚未分析 tone，后台 ensure（不阻塞）。
 * @param {string} remoteUrl
 * @param {string} [localPathHint] 已知本地路径时可传入，避免再查磁盘索引
 * @param {(tone: string) => void} [onDone]
 */
function ensureAgencyLogoBgToneIfCached(remoteUrl, localPathHint, onDone) {
  const key = _normalizeUrlKey(remoteUrl)
  const cb = typeof onDone === 'function' ? onDone : function () {}
  if (!key) {
    cb('')
    return
  }
  const cached = getCachedAgencyLogoBgTone(key)
  if (cached !== undefined) {
    cb(cached === 'light' || cached === 'dark' ? cached : '')
    return
  }
  let local = typeof localPathHint === 'string' ? localPathHint.trim() : ''
  if (!local) {
    try {
      const { getCachedAgencyLogoPath } = require('./agency-logo-cache.js')
      local = getCachedAgencyLogoPath(key) || ''
    } catch (e) {
      local = ''
    }
  }
  if (!local) {
    cb('')
    return
  }
  ensureAgencyLogoBgTone(key, local, cb)
}

module.exports = {
  LOGO_BG_LIGHT,
  LOGO_BG_DARK,
  pickLogoBgToneFromPixels,
  relativeLuminance,
  getCachedAgencyLogoBgTone,
  resolveAgencyLogoBgTone,
  ensureAgencyLogoBgTone,
  ensureAgencyLogoBgToneIfCached
}
