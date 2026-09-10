/**
 * 主包薄壳：分享图逻辑已下沉 subpackages/shared/utils/event-share-image.js
 * 同步 API 在模块预热后可用；未预热时回退中性默认图。
 */
const EVENT_SHARE_PKG = '../subpackages/shared/utils/event-share-image.js'
const FALLBACK =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/' + encodeURI('火箭配置图/default.jpg')
const AVATAR_COS_BASE = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/'

function thinShareHttps(url) {
  if (!url || typeof url !== 'string') return ''
  const t = url.trim()
  if (!t) return ''
  if (t.indexOf('cloud://') === 0 || t.indexOf('wxfile://') === 0) return ''
  if (!/^https:\/\//i.test(t) && !/^http:\/\//i.test(t)) return ''
  const httpsUrl = /^http:\/\//i.test(t) ? 'https://' + t.slice(7) : t
  if (/ci-process=snapshot/i.test(httpsUrl)) return httpsUrl
  return httpsUrl.split('#')[0].split('?')[0] || httpsUrl
}

function thinPickMediaShareHttps(item, preferMediaIndex) {
  const list = item && Array.isArray(item.mediaList) ? item.mediaList : []
  function fromMedia(m) {
    if (!m || typeof m !== 'object') return ''
    const raw = String(m.url || m.originalUrl || '').split('?')[0]
    const looksVideo = m.type === 'video' || /\.(mp4|mov|m4v|webm|mkv|avi|flv)$/i.test(raw)
    if (looksVideo) {
      return thinShareHttps(m.thumbnailRemoteUrl || m.thumbnailUrl || '')
    }
    return thinShareHttps(m.remoteUrl || m.url || '')
  }
  const idx = Number(preferMediaIndex)
  if (Number.isFinite(idx) && idx >= 0 && idx < list.length) {
    const preferred = fromMedia(list[idx])
    if (preferred) return preferred
  }
  for (let i = 0; i < list.length; i++) {
    const picked = fromMedia(list[i])
    if (picked) return picked
  }
  return ''
}

function avatarUrlFromSource(source) {
  const s = String(source || '').trim()
  if (!s || !/^[A-Za-z0-9_]+$/.test(s)) return ''
  return AVATAR_COS_BASE + s + '.jpg'
}

let _mod = null
let _modPromise = null

function warmEventShareImage() {
  if (!_modPromise) {
    try {
      if (typeof require.async !== 'function') {
        _modPromise = Promise.resolve(null)
      } else {
        _modPromise = require.async(EVENT_SHARE_PKG).then(function (m) {
          _mod = m
          return m
        }).catch(function () {
          return null
        })
      }
    } catch (e) {
      _modPromise = Promise.resolve(null)
    }
  }
  return _modPromise
}

function pickEventShareImageUrl(item, opts) {
  if (_mod) return _mod.pickEventShareImageUrl(item, opts)
  warmEventShareImage()
  const media = thinPickMediaShareHttps(item, opts && opts.preferMediaIndex)
  if (media) return media
  const avatar = avatarUrlFromSource(item && item.source)
  if (avatar) return avatar
  const remote = item && item.authorAvatarRemote ? String(item.authorAvatarRemote).trim() : ''
  if (/^https:\/\//i.test(remote)) return remote.split('?')[0]
  return FALLBACK
}

function resolveTweetAccountAvatarUrl(source) {
  if (_mod) return _mod.resolveTweetAccountAvatarUrl(source)
  warmEventShareImage()
  return avatarUrlFromSource(source)
}

function resolveEventAuthorAvatarUrl(item) {
  if (_mod) return _mod.resolveEventAuthorAvatarUrl(item)
  warmEventShareImage()
  return avatarUrlFromSource(item && item.source)
}

function getNeutralDefaultShareImage() {
  if (_mod) return _mod.getNeutralDefaultShareImage()
  warmEventShareImage()
  return FALLBACK
}

module.exports = {
  pickEventShareImageUrl,
  resolveTweetAccountAvatarUrl,
  resolveEventAuthorAvatarUrl,
  getNeutralDefaultShareImage,
  DEFAULT_EVENT_SHARE_IMAGE: FALLBACK,
  warmEventShareImage
}
