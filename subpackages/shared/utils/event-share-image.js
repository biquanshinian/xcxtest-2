/**
 * 事件更新「分享给好友 / 朋友圈」卡片缩略图
 * imageUrl 若为空或非法，微信会用当前页截图，易把分享弹窗截进去，故须尽量返回可拉取的 HTTPS 图。
 *
 * 优先级：事件首图 → 视频封面 → 账号头像（含 source 约定路径）→ 中性默认图
 * 注意：enrich 后 url/thumbnailUrl/authorAvatar 可能是 wxfile://，须优先读 remote* 字段。
 */
const { isVideoUrl, videoSnapshotUrl, optimizeImageUrl, toCdnUrl } = require('../../../utils/cos-url.js')

const AVATAR_COS_BASE = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/'
const FALLBACK_COS_DEFAULT =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/' + encodeURI('火箭配置图/default.jpg')

let _neutralDefaultCache = ''

function normalizeShareHttps(url) {
  if (!url || typeof url !== 'string') return ''
  const t = url.trim()
  if (!t) return ''
  if (t.indexOf('cloud://') === 0 || t.indexOf('wxfile://') === 0) return ''
  if (/^https?:\/\/tmp\//i.test(t)) return ''
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
 * 追踪账号 COS 头像约定：avatars/{screenName}.jpg
 * @param {string} source Twitter screenName
 * @returns {string} HTTPS URL 或空串
 */
function resolveTweetAccountAvatarUrl(source) {
  const s = String(source || '').trim()
  if (!s || !/^[A-Za-z0-9_]+$/.test(s)) return ''
  const raw = AVATAR_COS_BASE + s + '.jpg'
  try {
    return toCdnUrl(raw) || raw
  } catch (e) {
    return raw
  }
}

/**
 * 事件头像防串：authorAvatar 必须落在该 source 的约定路径上，否则按 source 重建。
 * 修复转推把别人头像写进错误账号、或历史脏数据导致 A 号显示 B 头像。
 */
function resolveEventAuthorAvatarUrl(item) {
  const source = item && item.source ? String(item.source).trim() : ''
  const fromSource = resolveTweetAccountAvatarUrl(source)
  let avatar = item && item.authorAvatar ? String(item.authorAvatar).trim() : ''
  if (avatar && source) {
    const pathToken = '/avatars/' + source + '.jpg'
    if (avatar.indexOf(pathToken) === -1) avatar = ''
  }
  // CDN 域名不含 .cos.；只拒绝明显非 COS/CDN 的代理脏链
  if (avatar && avatar.indexOf('/avatars/') === -1 && avatar.indexOf('.cos.') === -1) {
    avatar = ''
  }
  return avatar || fromSource || ''
}

function getNeutralDefaultShareImage() {
  if (_neutralDefaultCache) return _neutralDefaultCache
  try {
    const { resolveMediaUrl } = require('../../../utils/image-config.js')
    const candidates = [
      resolveMediaUrl('images/share/default.jpg', ''),
      resolveMediaUrl('火箭配置图/default.jpg', '')
    ]
    for (let i = 0; i < candidates.length; i++) {
      const n = normalizeShareHttps(candidates[i])
      if (n) {
        _neutralDefaultCache = maybeOptimizeForShare(n) || n
        return _neutralDefaultCache
      }
    }
  } catch (e) {}
  const fb = normalizeShareHttps(toCdnUrl(FALLBACK_COS_DEFAULT) || FALLBACK_COS_DEFAULT)
  _neutralDefaultCache = maybeOptimizeForShare(fb) || fb || FALLBACK_COS_DEFAULT
  return _neutralDefaultCache
}

/** @deprecated 保留导出兼容；已不再指向 SpaceX logo */
const DEFAULT_EVENT_SHARE_IMAGE = getNeutralDefaultShareImage()

function pickHttpsFromCandidates() {
  for (let i = 0; i < arguments.length; i++) {
    const u = normalizeShareHttps(arguments[i])
    if (u) return maybeOptimizeForShare(u)
  }
  return ''
}

/**
 * @param {Object|null|undefined} item - enrich 后的 starship_event_updates 项
 * @returns {string} 始终非空（否则微信截图会带上弹窗等 UI）
 */
function pickEventShareImageUrl(item) {
  const safe = item && typeof item === 'object' ? item : null
  if (!safe) return getNeutralDefaultShareImage()

  if (Array.isArray(safe.mediaList)) {
    for (let i = 0; i < safe.mediaList.length; i++) {
      const m = safe.mediaList[i]
      if (!m || m.type !== 'image') continue
      const picked = pickHttpsFromCandidates(m.remoteUrl, m.url)
      if (picked) return picked
    }
    for (let i = 0; i < safe.mediaList.length; i++) {
      const m = safe.mediaList[i]
      if (!m || m.type !== 'video') continue
      let snapshot = ''
      const videoRemote = m.originalUrl || m.url || ''
      if (videoRemote && isVideoUrl(videoRemote)) {
        try {
          snapshot = videoSnapshotUrl(videoRemote, 1) || ''
        } catch (e) {
          snapshot = ''
        }
      }
      const picked = pickHttpsFromCandidates(m.thumbnailRemoteUrl, m.thumbnailUrl, snapshot)
      if (picked) return picked
    }
  }

  const avatarPicked = pickHttpsFromCandidates(
    resolveEventAuthorAvatarUrl(safe),
    safe.authorAvatarRemote,
    safe.authorAvatar,
    resolveTweetAccountAvatarUrl(safe.source)
  )
  if (avatarPicked) return avatarPicked

  return getNeutralDefaultShareImage()
}

module.exports = {
  pickEventShareImageUrl,
  resolveTweetAccountAvatarUrl,
  resolveEventAuthorAvatarUrl,
  getNeutralDefaultShareImage,
  DEFAULT_EVENT_SHARE_IMAGE
}
