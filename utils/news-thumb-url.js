/**
 * 资讯列表缩略图 URL 优化（外链 CDN / WordPress Photon / 自有 COS）
 *
 * 注意：小程序逻辑层没有 URL 全局对象，这里必须用字符串/正则解析，
 * 否则转换会静默失败、真机直接加载原图（曾导致列表加载 8MB 级原图）。
 */
const { optimizeImageUrl, isImageUrl } = require('./cos-url.js')
const { getSystemInfo } = require('./system.js')

const COS_ORIGIN_PATTERN = /^https?:\/\/mars-1397421562\.cos\.ap-guangzhou\.myqcloud\.com\//
const WP_PHOTON_HOST = /^i\d+\.wp\.com$|^c\d+\.wp\.com$|^s\d+\.wp\.com$/i
const WP_CONTENT_PATH = /\/wp-content\/uploads\//i

/** 列表卡片配图 CSS 宽度：750 - scroll(30*2) - card(30*2) = 630rpx */
const LIST_IMAGE_WIDTH_RPX = 630

function getNewsListThumbTargetWidthPx(windowWidth) {
  const winW = Number(windowWidth) || 375
  let dpr = 2
  try {
    dpr = Number(getSystemInfo().pixelRatio) || 2
  } catch (_) {}
  const cssPx = LIST_IMAGE_WIDTH_RPX * (winW / 750)
  return Math.min(960, Math.max(320, Math.ceil(cssPx * dpr)))
}

function isWpPhotonHost(hostname) {
  return WP_PHOTON_HOST.test(String(hostname || ''))
}

/** 轻量 http(s) URL 解析：{ protocol, host, path, query }，非法返回 null */
function parseHttpUrl(url) {
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(String(url || '').trim())
  if (!m) return null
  return {
    protocol: m[1].toLowerCase(),
    host: m[2],
    path: m[3] || '/',
    query: m[4] || ''
  }
}

/** 覆盖写入 w=宽度；移除 resize/fit；无 quality 时补 quality=85 */
function setQueryWidth(url, widthPx) {
  const w = Math.max(1, Math.round(Number(widthPx) || 640))
  const parsed = parseHttpUrl(url)
  if (!parsed) {
    const base = String(url || '').split('#')[0].split('?')[0]
    return `${base}?w=${w}&quality=85`
  }
  const kept = []
  let hasQuality = false
  if (parsed.query) {
    const parts = parsed.query.split('&')
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue
      const key = part.split('=')[0].toLowerCase()
      if (key === 'w' || key === 'resize' || key === 'fit') continue
      if (key === 'quality') hasQuality = true
      kept.push(part)
    }
  }
  kept.push(`w=${w}`)
  if (!hasQuality) kept.push('quality=85')
  return `${parsed.protocol}://${parsed.host}${parsed.path}?${kept.join('&')}`
}

function toWpPhotonUrl(url, widthPx) {
  const parsed = parseHttpUrl(url)
  if (!parsed) return url
  if (isWpPhotonHost(parsed.host)) {
    return setQueryWidth(url, widthPx)
  }
  if (WP_CONTENT_PATH.test(parsed.path)) {
    // Photon 代理：丢弃原 query，仅保留路径
    return setQueryWidth(`https://i0.wp.com/${parsed.host}${parsed.path}`, widthPx)
  }
  return url
}

/**
 * 列表缩略图 URL：按实际渲染宽度（含 DPR）请求合适尺寸，详情/分享仍用原图。
 * @param {string} url
 * @param {number} displayWidthPx - 物理像素目标宽度，默认 640
 */
function optimizeNewsThumbUrl(url, displayWidthPx) {
  if (!url || typeof url !== 'string') return url || ''
  const s = url.trim()
  if (!s || !/^https?:\/\//i.test(s)) return s
  if (!isImageUrl(s)) return s

  const targetW = Math.max(240, Math.round(Number(displayWidthPx) || 640))

  if (COS_ORIGIN_PATTERN.test(s)) {
    return optimizeImageUrl(s, 'thumb')
  }

  const parsed = parseHttpUrl(s)
  if (parsed && isWpPhotonHost(parsed.host)) {
    return setQueryWidth(s, targetW)
  }

  const photon = toWpPhotonUrl(s, targetW)
  if (photon !== s) return photon

  return s
}

/**
 * 详情页头图：仅对 WP 系外链（Photon 主机或含 /wp-content/uploads/ 路径）
 * 按屏幕物理宽度（上限 1080px）加 Photon 宽度参数；COS 及其它外链原样返回。
 */
function optimizeNewsHeroUrl(url) {
  if (!url || typeof url !== 'string') return url || ''
  const s = url.trim()
  if (!s || !/^https?:\/\//i.test(s)) return s
  if (!isImageUrl(s)) return s
  if (COS_ORIGIN_PATTERN.test(s)) return s

  const parsed = parseHttpUrl(s)
  if (!parsed) return s
  const isWpLink = isWpPhotonHost(parsed.host) || WP_CONTENT_PATH.test(parsed.path)
  if (!isWpLink) return s

  let winW = 375
  let dpr = 2
  try {
    const info = getSystemInfo()
    winW = Number(info.windowWidth) || 375
    dpr = Number(info.pixelRatio) || 2
  } catch (_) {}
  const targetW = Math.min(1080, Math.max(480, Math.ceil(winW * dpr)))

  if (isWpPhotonHost(parsed.host)) return setQueryWidth(s, targetW)
  return toWpPhotonUrl(s, targetW)
}

module.exports = {
  getNewsListThumbTargetWidthPx,
  optimizeNewsThumbUrl,
  optimizeNewsHeroUrl
}
