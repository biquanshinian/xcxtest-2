/**
 * 微信搜索收录：wx.setPageInfo（title / description / imageUrl / path）
 * 仅在数据齐全且 imageUrl 为 https 业务域名时调用。
 */
const { resolveMediaUrl } = require('../../../utils/image-config.js')

const DEFAULT_SHARE_KEY = 'images/share/default.jpg'
const TITLE_MAX = 64
const DESC_MAX = 120

function truncateText(text, maxLength) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  if (!maxLength || raw.length <= maxLength) return raw
  return `${raw.slice(0, Math.max(0, maxLength - 1))}…`
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveSearchImageUrl(url, fallbackKey) {
  const raw = String(url || '').trim()
  if (raw && /^https:\/\//i.test(raw)) return raw
  if (raw && /^http:\/\//i.test(raw)) {
    return `https://${raw.replace(/^https?:\/\//i, '')}`
  }
  if (raw && !/^wxfile:\/\//i.test(raw) && !/^http:\/\/tmp/i.test(raw)) {
    const resolved = resolveMediaUrl(raw, '')
    if (resolved && /^https:\/\//i.test(resolved)) return resolved
  }
  const fallback = resolveMediaUrl(fallbackKey || DEFAULT_SHARE_KEY, '')
  return fallback && /^https:\/\//i.test(fallback) ? fallback : ''
}

/**
 * @param {{ title?: string, description?: string, imageUrl?: string, path?: string, fallbackImageKey?: string }} opts
 * @returns {boolean}
 */
function applyPageSearchInfo(opts) {
  if (!opts || typeof wx.setPageInfo !== 'function') return false

  const title = truncateText(opts.title, TITLE_MAX)
  const description = truncateText(opts.description, DESC_MAX)
  const imageUrl = resolveSearchImageUrl(opts.imageUrl, opts.fallbackImageKey)

  if (!title || !description || !imageUrl) return false

  const payload = { title, description, imageUrl }
  if (opts.path) payload.path = String(opts.path)

  try {
    wx.setPageInfo(payload)
    return true
  } catch (_) {
    return false
  }
}

function buildNewsDetailSearchMeta(item, detailType, shareImage) {
  if (!item || !item.title) return null
  const type = detailType === 'article' ? 'article' : 'event'
  const description = type === 'article'
    ? (item.summary || stripHtml(item.content))
    : (item.description || '')
  const imageUrl = type === 'article'
    ? (item.heroImageUrl || item.image || shareImage)
    : (item.image || shareImage)

  return {
    title: item.title,
    description: description || item.title,
    imageUrl,
    path: `/subpackages/news-extra/detail?id=${item.id}&type=${type}`
  }
}

function buildMissionDetailSearchMeta(mission, detailType, shareImage) {
  if (!mission) return null
  const missionName = String(mission.missionName || mission.name || '').trim()
  if (!missionName) return null

  const mf = mission.missionFull && typeof mission.missionFull === 'object' ? mission.missionFull : null
  const description = (mf && mf.description)
    || mission.missionDetails
    || mission.description
    || mission.rocketInfo
    || [mission.rocketName, mission.launchSite, mission.statusBadgeText].filter(Boolean).join(' · ')
    || missionName

  const type = detailType === 'completed' ? 'completed' : 'upcoming'
  return {
    title: missionName,
    description,
    imageUrl: mission.rocketImage || shareImage,
    path: `/pages/mission-detail/mission-detail?id=${encodeURIComponent(mission.id)}&type=${type}`
  }
}

module.exports = {
  applyPageSearchInfo,
  buildNewsDetailSearchMeta,
  buildMissionDetailSearchMeta,
  stripHtml,
  truncateText
}
