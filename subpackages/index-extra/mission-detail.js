function buildRedirectQuery(options) {
  const safe = options && typeof options === 'object' ? options : {}
  const parts = []
  if (safe.id != null && String(safe.id).trim() !== '') {
    parts.push('id=' + encodeURIComponent(String(safe.id).trim()))
  }
  if (safe.type) {
    parts.push('type=' + encodeURIComponent(String(safe.type)))
  }
  if (safe.fromSearch === '1' || safe.fromSearch === 1 || safe.fromSearch === true) {
    parts.push('fromSearch=1')
  }
  return parts.join('&')
}

Page({
  onLoad(options) {
    const query = buildRedirectQuery(options)
    const url = '/pages/mission-detail/mission-detail' + (query ? '?' + query : '')
    wx.redirectTo({ url })
  }
})
