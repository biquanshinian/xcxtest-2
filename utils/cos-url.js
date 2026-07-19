/**
 * COS URL 优化工具
 * - CDN 域名替换（config.inspirationCOS.cdnBaseUrl 配置后自动生效）
 * - imageMogr2 图片压缩（缩放 + WebP + 质量控制）
 * - 视频截图 URL 生成
 *
 * HTTP/2 说明（微信「网络性能」检测项）：
 * - COS 默认桶域名 *.cos.*.myqcloud.com 通常仅 HTTP/1.1，profiler 会报「未开启 HTTP/2」
 * - 需在腾讯云 CDN 绑定自定义加速域名并在控制台开启 HTTP/2，再将 cdnBaseUrl 填入 config.js
 * - 客户端只能切换请求域名；HTTP/2 能力由 CDN 服务端提供，无法仅靠小程序代码开启
 */
const config = require('./config.js')

const COS_ORIGIN_PATTERN = /^https?:\/\/mars-1397421562\.cos\.ap-guangzhou\.myqcloud\.com\//

const PRESETS = {
  // 相对显示尺寸整体下调：thumb 覆盖列表/卡片/logo，medium 覆盖轮播/开屏/头图；
  // 960w 对主流机 400rpx 高轮播视觉无损，体积再降约 25~35%
  thumb:  { width: 480,  quality: 70, format: 'webp' },
  medium: { width: 960,  quality: 80, format: 'webp' },
  full:   null
}

function getCdnBase() {
  const cos = config.inspirationCOS || {}
  return cos.cdnBaseUrl || cos.baseUrl || 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
}

function toCdnUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (!COS_ORIGIN_PATTERN.test(url)) return url
  return url.replace(COS_ORIGIN_PATTERN, getCdnBase())
}

/** 对外统一入口：任意 COS 直链 → CDN 域名（未配置 cdnBaseUrl 时原样返回） */
function resolveCosHttpsUrl(url) {
  return toCdnUrl(url)
}

function isCosOriginUrl(url) {
  return !!(url && typeof url === 'string' && COS_ORIGIN_PATTERN.test(url))
}

function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const pure = url.split('?')[0].toLowerCase()
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(pure)
}

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const pure = url.split('?')[0].toLowerCase()
  return /\.(mp4|mov|m4v|webm|mkv|avi|flv)$/.test(pure)
}

/**
 * 云存储 fileID / 本地临时路径不能拼 imageMogr2（加 query 会导致 <image> 加载失败）
 */
function isCloudOrLocalFileUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim()
  return /^cloud:\/\//i.test(u) || /^wxfile:\/\//i.test(u)
}

/**
 * 展示用图：HTTPS COS 走压缩；cloud:// / wxfile:// 原样返回
 * @param {string} url
 * @param {'thumb'|'medium'|'full'} [preset='medium']
 */
function displayImageUrl(url, preset) {
  if (!url || typeof url !== 'string') return url
  if (isCloudOrLocalFileUrl(url)) return url.trim()
  return optimizeImageUrl(url, preset)
}

/**
 * 优化图片 URL：CDN 替换 + imageMogr2 压缩
 * @param {string} url - 原始 COS/CDN 图片 URL
 * @param {string} preset - 'thumb' | 'medium' | 'full'（默认 'medium'）
 */
function optimizeImageUrl(url, preset) {
  if (!url || typeof url !== 'string') return url
  // cloud:// / wxfile:// 加 query 会失效，必须原样返回（NSF 硬件镜像常用 fileID）
  if (isCloudOrLocalFileUrl(url)) return url.trim()
  if (url.includes('ci-process=')) return toCdnUrl(url)

  const cdnUrl = toCdnUrl(url)

  const p = PRESETS[preset || 'medium']
  if (!p) return cdnUrl
  if (!isImageUrl(cdnUrl)) return cdnUrl

  const sep = cdnUrl.includes('?') ? '&' : '?'
  return `${cdnUrl}${sep}imageMogr2/thumbnail/${p.width}x/format/${p.format}/quality/${p.quality}`
}

/**
 * 生成视频截图 URL（使用 CDN 域名，CDN 会缓存 CI 处理结果）
 */
function videoSnapshotUrl(url, second) {
  if (!url || typeof url !== 'string') return url
  const cdnUrl = toCdnUrl(url.split('?')[0])
  const t = Number(second) > 0 ? Number(second) : 1
  // 只限宽不限高：CI 按源视频比例等比出图，竖版推文视频和横版发射集锦都不变形；
  // 480 宽足够手机卡片，避免按源分辨率截帧过大
  return `${cdnUrl}?ci-process=snapshot&time=${t}&format=jpg&width=480`
}

/**
 * 轮播视频封面：优先已有缩略图，否则万象截第 1 秒
 */
function carouselVideoPosterUrl(videoUrl, thumbnailUrl) {
  const thumb = thumbnailUrl && typeof thumbnailUrl === 'string' ? thumbnailUrl.trim() : ''
  if (thumb) {
    if (thumb.includes('ci-process=')) return toCdnUrl(thumb)
    return optimizeImageUrl(thumb, 'medium')
  }
  if (!videoUrl || !isVideoUrl(videoUrl)) return ''
  return videoSnapshotUrl(videoUrl, 1)
}

/**
 * 批量优化媒体项中的所有 URL 字段
 * @param {Object} item - media_feed 数据项
 * @param {string} imagePreset - 图片预设 'thumb' | 'medium' | 'full'
 */
function optimizeMediaItem(item, imagePreset) {
  if (!item) return item
  const preset = imagePreset || 'thumb'

  const result = Object.assign({}, item)

  if (result.fileID) {
    result.fileID = result.type === 'video'
      ? toCdnUrl(result.fileID)
      : optimizeImageUrl(result.fileID, preset)
  }

  if (result.coverFileID) {
    result.coverFileID = optimizeImageUrl(result.coverFileID, preset)
  }

  if (Array.isArray(result.previewImages)) {
    result.previewImages = result.previewImages.map(function (u) {
      return optimizeImageUrl(u, preset)
    })
  }

  if (result.androidThumb) {
    result.androidThumb = optimizeImageUrl(result.androidThumb, 'thumb')
  }

  return result
}

module.exports = {
  getCdnBase,
  toCdnUrl,
  resolveCosHttpsUrl,
  isCosOriginUrl,
  isCloudOrLocalFileUrl,
  displayImageUrl,
  optimizeImageUrl,
  videoSnapshotUrl,
  carouselVideoPosterUrl,
  optimizeMediaItem,
  isImageUrl,
  isVideoUrl
}
