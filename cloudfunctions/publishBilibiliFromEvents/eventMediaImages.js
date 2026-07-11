/**
 * 与小程序事件配图对齐：只用本事件 mediaList 里的自有 COS 图。
 * 不回退 authorAvatar（避免「推文正文 vs 头像」错配）。
 */

const COS_HOST = 'mars-1397421562.cos.ap-guangzhou.myqcloud.com'

function normalizeHttps(url) {
  if (!url || typeof url !== 'string') return ''
  const t = url.trim()
  if (!t) return ''
  if (/^https:\/\//i.test(t)) return t
  if (/^http:\/\//i.test(t)) return `https://${t.slice(7)}`
  return ''
}

function isOwnCosUrl(url) {
  const u = normalizeHttps(url)
  if (!u) return false
  try {
    const host = new URL(u).hostname.toLowerCase()
    return host === COS_HOST || host.endsWith('.myqcloud.com') && host.includes('1397421562')
  } catch (e) {
    return u.includes(COS_HOST)
  }
}

function isImagePath(url) {
  const path = String(url || '').split('?')[0].toLowerCase()
  return /\.(jpe?g|png|gif|webp|bmp)$/.test(path)
}

function isVideoPath(url) {
  const path = String(url || '').split('?')[0].toLowerCase()
  return /\.(mp4|mov|m4v|webm|mkv)$/.test(path)
}

function isPublishableImageUrl(url) {
  const u = normalizeHttps(url)
  if (!u || !isOwnCosUrl(u)) return false
  if (isImagePath(u)) return true
  // 万象截帧：路径可能是 .mp4，query 含 ci-process=snapshot
  if (/ci-process=snapshot/i.test(u)) return true
  return false
}

function videoSnapshotUrl(videoUrl) {
  const u = normalizeHttps(videoUrl)
  if (!u || !isOwnCosUrl(u) || !isVideoPath(u)) return ''
  const base = u.split('?')[0]
  return `${base}?ci-process=snapshot&time=1&format=jpg&width=720&height=0`
}

/**
 * 从单条 starship_event_updates 提取可发给 B 站的配图 URL（最多 max 张）
 * 顺序与小程序 mediaList 一致：先图，再视频封面/截帧；直播封面仅作无 media 时兜底。
 */
function extractEventImages(event, max = 9) {
  const out = []
  const push = (raw) => {
    const u = normalizeHttps(raw)
    if (!u || !isPublishableImageUrl(u)) return
    if (out.includes(u)) return
    out.push(u)
  }

  const list = Array.isArray(event && event.mediaList) ? event.mediaList : []
  for (const m of list) {
    if (!m || out.length >= max) break
    if (m.type === 'image' && m.url) {
      push(m.url)
      continue
    }
    if (m.type === 'video') {
      if (m.thumbnailUrl) push(m.thumbnailUrl)
      if (out.length < max && m.url) push(videoSnapshotUrl(m.url))
    }
  }

  if (!out.length && event && event.liveCover) {
    push(event.liveCover)
  }

  return out.slice(0, max)
}

function eventHasPublishableImages(event) {
  return extractEventImages(event, 1).length > 0
}

module.exports = {
  extractEventImages,
  eventHasPublishableImages,
  isPublishableImageUrl,
  videoSnapshotUrl,
  COS_HOST
}
