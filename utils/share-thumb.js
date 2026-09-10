/**
 * 分享缩略图：微信 imageUrl 只吃 https / 本地路径，webp、imageMogr2、外链直连朋友圈常裂成默认图标。
 * 页面先 set 可拉取 https，再 getImageInfo 落到本地。
 */
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('./agency-logo-overrides.js')
const { proxiedImageUrl, isOwnCdnUrl } = require('./ll2-image.js')

const SHARE_THUMB_FALLBACK = SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL

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

function isDefaultPlaceholder(url) {
  const s = String(url || '')
  return /火箭配置图\/default\.jpg/i.test(s) || /\/default\.jpg(\?|#|$)/i.test(s)
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
  if (!s || s.indexOf('cloud://') === 0 || isDefaultPlaceholder(s)) return ''
  if (!/^https?:\/\//i.test(s)) return ''
  const stripped = isOwnCdnUrl(s) ? stripShareProcess(s) : (proxiedImageUrl(s) || stripShareProcess(s))
  if (!stripped || isWebpPath(stripped) || isDefaultPlaceholder(stripped)) return ''
  return stripped
}

function toDownloadableShareSrc(url) {
  const s = String(url || '').trim()
  if (!s || isDefaultPlaceholder(s)) return ''
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

function pickShareImageUrl(opts) {
  const display = String((opts && opts.displayImage) || '').trim()
  const raw = String((opts && opts.rawImage) || '').trim()
  const fallback = String((opts && opts.safeFallback) || SHARE_THUMB_FALLBACK)
  if (isLocalSharePath(display) && !isDefaultPlaceholder(display)) return display
  if (isLocalSharePath(raw) && !isDefaultPlaceholder(raw)) return raw
  const https = toShareableHttps(raw) || toShareableHttps(display)
  if (https) return https
  const fallbacks = listFallbacks(opts)
  for (let i = 0; i < fallbacks.length; i++) {
    const hit = toShareableHttps(fallbacks[i])
    if (hit) return hit
  }
  return fallback
}

function pickShareDownloadSrc(opts) {
  const raw = String((opts && opts.rawImage) || '').trim()
  const display = String((opts && opts.displayImage) || '').trim()
  const fallbacks = listFallbacks(opts)
  const ordered = [raw, display].concat(fallbacks)
  for (let i = 0; i < ordered.length; i++) {
    const s = String(ordered[i] || '').trim()
    if (s.indexOf('cloud://') === 0) return s
  }
  if (isLocalSharePath(display) && !isDefaultPlaceholder(display)) return display
  if (isLocalSharePath(raw) && !isDefaultPlaceholder(raw)) return raw
  for (let i = 0; i < ordered.length; i++) {
    const hit = toDownloadableShareSrc(ordered[i])
    if (hit) return hit
  }
  return pickShareImageUrl(opts)
}

function shareOptsFromCard(card) {
  const c = card && typeof card === 'object' ? card : {}
  const fallbacks = Array.isArray(c.imageFallbacks) ? c.imageFallbacks.slice() : []
  ;[c.logoUrlRaw, c.logoUrl, c.fullImageUrl, c.coverUrl, c.rocketImage, c.imageUrl, c.image].forEach((u) => {
    const s = String(u || '').trim()
    if (s && fallbacks.indexOf(s) < 0) fallbacks.push(s)
  })
  return {
    displayImage: c.imageUrl || c.thumbnailUrl || c.displayImage || c.coverThumb || c.coverUrl || c.logoUrl || c.rocketImage || c.image || '',
    rawImage: c.rawImage || fallbacks[0] || c.imageUrl || c.thumbnailUrl || c.displayImage || c.coverUrl || c.rocketImage || c.image || '',
    fallbacks: fallbacks,
    rocketName: c.fullNameEn || c.nameEn || c.rocketNameEn || c.fullName || c.name || ''
  }
}

/** 把网络图落到 page.data.shareImage 本地路径 */
function ensureShareImageOnPage(page, imageUrl) {
  if (!page || !imageUrl || typeof imageUrl !== 'string') return
  const trimmed = imageUrl.trim()
  if (!trimmed) return
  if (isLocalSharePath(trimmed)) {
    if (page.data && page.data.shareImage !== trimmed) page.setData({ shareImage: trimmed })
    return
  }
  if (page._shareImageSourceUrl === trimmed && page.data && page.data.shareImage && isLocalSharePath(page.data.shareImage)) {
    return
  }
  page._shareImageSourceUrl = trimmed
  wx.getImageInfo({
    src: trimmed,
    success(res) {
      if (res && res.path && page._shareImageSourceUrl === trimmed) {
        page.setData({ shareImage: res.path })
      }
    },
    fail() {
      if (page._shareImageSourceUrl === trimmed) page._shareImageSourceUrl = ''
    }
  })
}

function syncPageShareImage(page, opts) {
  const url = pickShareImageUrl(opts)
  if (!page) return url
  if (!page.data || page.data.shareImage !== url) page.setData({ shareImage: url })
  ensureShareImageOnPage(page, pickShareDownloadSrc(opts))
  return url
}

function pageShareImage(page, opts) {
  const current = page && page.data && page.data.shareImage
  return current || pickShareImageUrl(opts || {})
}

/** 无头图页面：先落到 SpaceX logo，再预下载成本地路径 */
function bootPageShareThumb(page) {
  if (!page) return SHARE_THUMB_FALLBACK
  if (!page.data || !page.data.shareImage) page.setData({ shareImage: SHARE_THUMB_FALLBACK })
  ensureShareImageOnPage(page, SHARE_THUMB_FALLBACK)
  return SHARE_THUMB_FALLBACK
}

module.exports = {
  SHARE_THUMB_FALLBACK,
  isLocalSharePath,
  pickShareImageUrl,
  pickShareDownloadSrc,
  shareOptsFromCard,
  ensureShareImageOnPage,
  syncPageShareImage,
  pageShareImage,
  bootPageShareThumb
}
