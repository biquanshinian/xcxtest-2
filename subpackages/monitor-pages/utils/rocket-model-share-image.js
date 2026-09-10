/**
 * 火箭对比 / 档案指数「分享给好友 / 朋友圈」缩略图
 * 卡片主图常是 imageMogr2 webp 或 LL2 外链，微信 imageUrl 直接用会落到默认链接图标。
 * 先给可拉取的 https（配置图 jpg / Worker 代理 / SpaceX logo），再 getImageInfo 落到本地。
 */
const { getRocketImage, isDefaultRocketSrc } = require('../../../utils/util.js')
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../../utils/agency-logo-overrides.js')
const { proxiedImageUrl, isOwnCdnUrl } = require('../../../utils/ll2-image.js')

const ROCKET_MODEL_SHARE_SAFE_FALLBACK = SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL

function isLocalSharePath(url) {
  const s = String(url || '')
  if (!s) return false
  if (s.indexOf('wxfile://') === 0) return true
  if (/^http:\/\/(tmp|usr)\b/i.test(s)) return true
  if (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH && s.indexOf(wx.env.USER_DATA_PATH) === 0) {
    return true
  }
  return false
}

function stripShareProcess(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/ci-process=snapshot/i.test(s)) return s
  if (/\/image\?url=/i.test(s)) return s
  const bare = s.split('#')[0].split('?')[0]
  return bare || s
}

function isWebpPath(url) {
  const bare = String(url || '').split('#')[0].split('?')[0]
  return /\.webp$/i.test(bare)
}

function toShareableHttps(url) {
  const s = String(url || '').trim()
  if (!s || s.indexOf('cloud://') === 0 || isDefaultRocketSrc(s)) return ''
  if (!/^https?:\/\//i.test(s)) return ''
  const stripped = isOwnCdnUrl(s) ? stripShareProcess(s) : (proxiedImageUrl(s) || stripShareProcess(s))
  if (!stripped || isWebpPath(stripped) || isDefaultRocketSrc(stripped)) return ''
  return stripped
}

function toDownloadableShareSrc(url) {
  const s = String(url || '').trim()
  if (!s || isDefaultRocketSrc(s)) return ''
  if (isLocalSharePath(s) || s.indexOf('cloud://') === 0) return s
  if (!/^https?:\/\//i.test(s)) return ''
  if (/\/image\?url=/i.test(s)) return s
  if (isOwnCdnUrl(s)) return stripShareProcess(s) || s
  return proxiedImageUrl(s) || s
}

function listFallbacks(opts) {
  const list = []
  const extra = Array.isArray(opts && opts.fallbacks) ? opts.fallbacks : []
  extra.forEach((u) => {
    const s = String(u || '').trim()
    if (s && list.indexOf(s) < 0) list.push(s)
  })
  return list
}

function pickRocketConfigShareFallback(rocketName) {
  const name = String(rocketName || '').trim()
  if (!name) return ROCKET_MODEL_SHARE_SAFE_FALLBACK
  try {
    const img = String(getRocketImage(name) || '').trim()
    if (!img || isDefaultRocketSrc(img)) return ROCKET_MODEL_SHARE_SAFE_FALLBACK
    if (isLocalSharePath(img)) return img
    return toShareableHttps(img) || ROCKET_MODEL_SHARE_SAFE_FALLBACK
  } catch (e) {
    return ROCKET_MODEL_SHARE_SAFE_FALLBACK
  }
}

/**
 * 分享弹窗立刻能用的图：本地路径 > 安全 https > 配置图库 > SpaceX logo
 * @param {{ rawImage?: string, displayImage?: string, fallbacks?: string[], rocketName?: string }} [opts]
 */
function pickRocketModelShareImageUrl(opts) {
  const display = String((opts && opts.displayImage) || '').trim()
  const raw = String((opts && opts.rawImage) || '').trim()
  if (isLocalSharePath(display) && !isDefaultRocketSrc(display)) return display
  if (isLocalSharePath(raw) && !isDefaultRocketSrc(raw)) return raw
  const https = toShareableHttps(raw) || toShareableHttps(display)
  if (https) return https
  const fallbacks = listFallbacks(opts)
  for (let i = 0; i < fallbacks.length; i++) {
    const hit = toShareableHttps(fallbacks[i])
    if (hit) return hit
  }
  return pickRocketConfigShareFallback(opts && opts.rocketName)
}

/**
 * 预下载源：优先真实头图（含 cloud:// / 外链代理），落地成本地后再替换 shareImage
 * @param {{ rawImage?: string, displayImage?: string, fallbacks?: string[], rocketName?: string }} [opts]
 */
function pickRocketModelShareSourceForDownload(opts) {
  const raw = String((opts && opts.rawImage) || '').trim()
  const display = String((opts && opts.displayImage) || '').trim()
  const fallbacks = listFallbacks(opts)
  const ordered = [raw, display].concat(fallbacks)
  for (let i = 0; i < ordered.length; i++) {
    const s = String(ordered[i] || '').trim()
    if (s.indexOf('cloud://') === 0) return s
  }
  if (isLocalSharePath(display) && !isDefaultRocketSrc(display)) return display
  if (isLocalSharePath(raw) && !isDefaultRocketSrc(raw)) return raw
  for (let i = 0; i < ordered.length; i++) {
    const hit = toDownloadableShareSrc(ordered[i])
    if (hit) return hit
  }
  const name = String((opts && opts.rocketName) || '').trim()
  if (name) {
    try {
      const img = String(getRocketImage(name) || '').trim()
      const dl = toDownloadableShareSrc(img)
      if (dl) return dl
    } catch (e) {}
  }
  return pickRocketModelShareImageUrl(opts)
}

function rocketShareOptsFromModel(model) {
  const m = model && typeof model === 'object' ? model : {}
  const fallbacks = Array.isArray(m.imageFallbacks) ? m.imageFallbacks : []
  return {
    displayImage: m.imageUrl || m.thumbnailUrl || '',
    rawImage: fallbacks[0] || m.imageUrl || m.thumbnailUrl || '',
    fallbacks: fallbacks,
    rocketName: m.fullNameEn || m.nameEn || m.fullName || m.name || ''
  }
}

module.exports = {
  ROCKET_MODEL_SHARE_SAFE_FALLBACK,
  isLocalSharePath,
  toShareableHttps,
  toDownloadableShareSrc,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
}
