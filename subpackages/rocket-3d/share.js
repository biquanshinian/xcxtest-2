/**
 * 火箭 3D 页分享：path 只带型号名，由打开方再解析 COS。
 * 不把 modelUrl / poster 写进 path，避免超过微信 1024 字限制。
 */
function firstNonEmpty(list) {
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || '').trim()
    if (s) return s
  }
  return ''
}

function buildRocket3dShareQuery(input) {
  var src = input && typeof input === 'object' ? input : {}
  var q = []
  var name = String(src.rocketName || '').trim()
  var nameEn = String(src.rocketNameEn || '').trim()
  if (name) q.push('name=' + encodeURIComponent(name))
  if (nameEn) q.push('nameEn=' + encodeURIComponent(nameEn))
  return q.join('&')
}

function buildRocket3dSharePath(input) {
  var query = buildRocket3dShareQuery(input)
  return '/subpackages/rocket-3d/viewer' + (query ? '?' + query : '')
}

function buildRocket3dShareOptions(input, mode) {
  var src = input && typeof input === 'object' ? input : {}
  var name = firstNonEmpty([src.rocketName, src.rocketNameEn]) || '火箭'
  var title = name + ' 3D 模型 | 火星探索日志'
  var poster = String(src.poster || '').trim()
  var imageUrl = /^https:\/\//i.test(poster) ? poster : ''
  if (mode === 'timeline') {
    var timeline = { title: title, query: buildRocket3dShareQuery(src) }
    if (imageUrl) timeline.imageUrl = imageUrl
    return timeline
  }
  var appMsg = { title: title, path: buildRocket3dSharePath(src) }
  if (imageUrl) appMsg.imageUrl = imageUrl
  return appMsg
}

module.exports = {
  buildRocket3dShareQuery,
  buildRocket3dSharePath,
  buildRocket3dShareOptions
}
