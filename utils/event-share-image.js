/**
 * 事件更新「分享给好友」卡片缩略图
 * imageUrl 若为空或非法，微信会用当前页截图，易把分享弹窗截进去，故须尽量返回可拉取的 HTTPS 图。
 */
const { isVideoUrl, videoSnapshotUrl, optimizeImageUrl } = require('./cos-url.js')

const DEFAULT_EVENT_SHARE_IMAGE =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg'

function normalizeShareHttps(url) {
  if (!url || typeof url !== 'string') return ''
  const t = url.trim()
  if (!t) return ''
  if (t.indexOf('cloud://') === 0 || t.indexOf('wxfile://') === 0) return ''
  if (/^https:\/\//i.test(t)) return t
  if (/^http:\/\//i.test(t)) return 'https://' + t.slice(7)
  return ''
}

function maybeOptimizeForShare(httpsUrl) {
  if (!httpsUrl) return ''
  try {
    const o = optimizeImageUrl(httpsUrl, 'medium')
    return o || httpsUrl
  } catch (e) {
    return httpsUrl
  }
}

/**
 * @param {Object|null|undefined} item - enrich 后的 starship_event_updates 项
 * @returns {string} 始终非空（否则微信截图会带上弹窗等 UI）
 */
function pickEventShareImageUrl(item) {
  const safe = item && typeof item === 'object' ? item : null
  if (!safe) return DEFAULT_EVENT_SHARE_IMAGE

  if (Array.isArray(safe.mediaList)) {
    for (let i = 0; i < safe.mediaList.length; i++) {
      const m = safe.mediaList[i]
      if (!m || m.type !== 'image' || !m.url) continue
      const u = normalizeShareHttps(m.url)
      if (u) return maybeOptimizeForShare(u)
    }
    for (let i = 0; i < safe.mediaList.length; i++) {
      const m = safe.mediaList[i]
      if (!m || m.type !== 'video') continue
      let thumb = (m.thumbnailUrl && String(m.thumbnailUrl)) || ''
      if (!thumb && m.url && isVideoUrl(m.url)) thumb = videoSnapshotUrl(m.url, 1)
      const u = normalizeShareHttps(thumb)
      if (u) return maybeOptimizeForShare(u)
    }
  }

  const av = normalizeShareHttps(safe.authorAvatar || '')
  if (av) return maybeOptimizeForShare(av)

  return DEFAULT_EVENT_SHARE_IMAGE
}

module.exports = {
  pickEventShareImageUrl,
  DEFAULT_EVENT_SHARE_IMAGE
}
