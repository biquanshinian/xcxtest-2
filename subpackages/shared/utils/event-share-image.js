/**
 * 事件更新「分享给好友 / 朋友圈」卡片缩略图
 * imageUrl 若为空或非法，微信会用当前页截图，易把分享弹窗截进去，故须尽量返回可拉取的 HTTPS 图。
 *
 * 优先级：事件图片 / 视频封面（mediaList 顺序，可指定下标）→ 无媒体才用博主头像 → 中性默认图
 * 朋友圈卡片不稳吃 webp / imageMogr2，分享图保持 jpg/png 原链。
 * 注意：enrich 后 url/thumbnailUrl/authorAvatar 可能是 wxfile://，须优先读 remote* 字段。
 */
const { isVideoUrl, videoSnapshotUrl, toCdnUrl } = require('../../../utils/cos-url.js')

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
  // 万象截帧本身就是 jpg，query 必须保留
  if (/ci-process=snapshot/i.test(httpsUrl)) return httpsUrl
  // 朋友圈缩略图对 webp / imageMogr2 经常裂成默认链接图标
  const bare = String(httpsUrl).split('#')[0].split('?')[0]
  return bare || httpsUrl
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

function pickFromMediaItem(m) {
  if (!m || typeof m !== 'object') return ''
  if (m.type === 'image') {
    return pickHttpsFromCandidates(m.remoteUrl, m.url)
  }
  if (m.type === 'video') {
    let snapshot = ''
    const videoRemote = m.originalUrl || m.url || ''
    if (videoRemote && isVideoUrl(videoRemote)) {
      try {
        snapshot = videoSnapshotUrl(videoRemote, 1) || ''
      } catch (e) {
        snapshot = ''
      }
    }
    return pickHttpsFromCandidates(m.thumbnailRemoteUrl, m.thumbnailUrl, snapshot)
  }
  if (isVideoUrl(m.url || m.originalUrl || '')) {
    return pickFromMediaItem(Object.assign({}, m, { type: 'video' }))
  }
  return pickHttpsFromCandidates(m.remoteUrl, m.url, m.thumbnailRemoteUrl, m.thumbnailUrl)
}

function pickEventMediaShareImageUrl(safe, preferMediaIndex) {
  const list = Array.isArray(safe.mediaList) ? safe.mediaList : []
  const idx = Number(preferMediaIndex)
  if (Number.isFinite(idx) && idx >= 0 && idx < list.length) {
    const preferred = pickFromMediaItem(list[idx])
    if (preferred) return preferred
  }
  for (let i = 0; i < list.length; i++) {
    const picked = pickFromMediaItem(list[i])
    if (picked) return picked
  }
  const extras = [].concat(safe.imageOriginalUrls || [], safe.imageUrls || [])
  for (let i = 0; i < extras.length; i++) {
    const picked = pickHttpsFromCandidates(extras[i])
    if (picked) return picked
  }
  return ''
}

function pickEventAvatarShareImageUrl(safe) {
  return pickHttpsFromCandidates(
    resolveEventAuthorAvatarUrl(safe),
    safe.authorAvatarRemote,
    safe.authorAvatar,
    resolveTweetAccountAvatarUrl(safe.source)
  )
}

/**
 * @param {Object|null|undefined} item - enrich 后的 starship_event_updates 项
 * @param {{ preferMediaIndex?: number }} [opts] 播放页分享指定媒体下标（视频封面）
 * @returns {string} 始终非空（否则微信截图会带上弹窗等 UI）
 */
function pickEventShareImageUrl(item, opts) {
  const safe = item && typeof item === 'object' ? item : null
  if (!safe) return getNeutralDefaultShareImage()

  const mediaPicked = pickEventMediaShareImageUrl(safe, opts && opts.preferMediaIndex)
  if (mediaPicked) return mediaPicked

  const avatarPicked = pickEventAvatarShareImageUrl(safe)
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
