/**
 * 主包薄壳：分享图逻辑已下沉 subpackages/shared/utils/event-share-image.js
 * 同步 API 在模块预热后可用；未预热时回退中性默认图。
 */
const EVENT_SHARE_PKG = '../subpackages/shared/utils/event-share-image.js'
const FALLBACK =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/' + encodeURI('火箭配置图/default.jpg')

let _mod = null
let _modPromise = null

function warmEventShareImage() {
  if (!_modPromise) {
    _modPromise = require.async(EVENT_SHARE_PKG).then(function (m) {
      _mod = m
      return m
    })
  }
  return _modPromise
}

function pickEventShareImageUrl(item) {
  if (_mod) return _mod.pickEventShareImageUrl(item)
  warmEventShareImage()
  return FALLBACK
}

function resolveTweetAccountAvatarUrl(source) {
  if (_mod) return _mod.resolveTweetAccountAvatarUrl(source)
  warmEventShareImage()
  return ''
}

function getNeutralDefaultShareImage() {
  if (_mod) return _mod.getNeutralDefaultShareImage()
  warmEventShareImage()
  return FALLBACK
}

module.exports = {
  pickEventShareImageUrl,
  resolveTweetAccountAvatarUrl,
  getNeutralDefaultShareImage,
  DEFAULT_EVENT_SHARE_IMAGE: FALLBACK,
  warmEventShareImage
}
