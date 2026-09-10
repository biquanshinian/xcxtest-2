/**
 * 星舰硬件设施 / 型号进展详情「分享给好友 / 朋友圈」缩略图
 * NSF 镜像图是 cloud://，微信 imageUrl 只吃 https / 本地路径，直接塞 fileID 会落到默认链接图标。
 * 朋友圈远程缩略图也不稳吃 webp / imageMogr2，先给可拉取的 https 兜底，再 getImageInfo 落到本地。
 */
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../../utils/agency-logo-overrides.js')
const { proxiedImageUrl, isOwnCdnUrl } = require('../../../utils/ll2-image.js')

const HARDWARE_SHARE_SAFE_FALLBACK = SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL

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

/** 可直接当作 imageUrl 的远程地址；cloud:// / webp 原链返回空，避免朋友圈裂图 */
function toShareableHttps(url) {
  const s = String(url || '').trim()
  if (!s || s.indexOf('cloud://') === 0) return ''
  if (!/^https?:\/\//i.test(s)) return ''
  const stripped = isOwnCdnUrl(s) ? stripShareProcess(s) : (proxiedImageUrl(s) || stripShareProcess(s))
  if (!stripped || isWebpPath(stripped)) return ''
  return stripped
}

/** getImageInfo 可用：cloud://、本地、自有 CDN、Worker 代理外链 */
function toDownloadableShareSrc(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (isLocalSharePath(s) || s.indexOf('cloud://') === 0) return s
  if (!/^https?:\/\//i.test(s)) return ''
  if (isOwnCdnUrl(s)) return s
  return proxiedImageUrl(s) || s
}

/**
 * 分享弹窗立刻能用的图：本地路径 > 安全 https > SpaceX logo
 * @param {{ rawImage?: string, displayImage?: string }} [opts]
 */
function pickHardwareShareImageUrl(opts) {
  const display = String((opts && opts.displayImage) || '').trim()
  const raw = String((opts && opts.rawImage) || '').trim()
  if (isLocalSharePath(display)) return display
  if (isLocalSharePath(raw)) return raw
  return toShareableHttps(raw) || toShareableHttps(display) || HARDWARE_SHARE_SAFE_FALLBACK
}

/**
 * 预下载源：优先真实头图（含 cloud://），落地成本地路径后再替换 shareImage
 * @param {{ rawImage?: string, displayImage?: string }} [opts]
 */
function pickHardwareShareSourceForDownload(opts) {
  const raw = String((opts && opts.rawImage) || '').trim()
  const display = String((opts && opts.displayImage) || '').trim()
  if (raw.indexOf('cloud://') === 0) return raw
  if (display.indexOf('cloud://') === 0) return display
  if (isLocalSharePath(display)) return display
  if (isLocalSharePath(raw)) return raw
  return toDownloadableShareSrc(raw) || toDownloadableShareSrc(display) || pickHardwareShareImageUrl(opts)
}

module.exports = {
  HARDWARE_SHARE_SAFE_FALLBACK,
  isLocalSharePath,
  toShareableHttps,
  toDownloadableShareSrc,
  pickHardwareShareImageUrl,
  pickHardwareShareSourceForDownload
}
