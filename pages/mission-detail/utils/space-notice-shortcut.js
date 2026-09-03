/**
 * SPACE_NOTICES_FEATURE — 任务详情「发射通告地图」快捷入口
 * 主包内只做轻量 lookup，避免引用分包 api-space-notices。
 */
const { isSpaceNoticesEnabled } = require('../../../utils/space-notices-feature.js')

function lookupSpaceNoticeShortcut(ll2Id) {
  const id = String(ll2Id || '').trim()
  if (!id) return Promise.resolve(null)
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.resolve(null)
  return isSpaceNoticesEnabled()
    .catch(() => false)
    .then((on) => {
      if (!on) return null
      return wx.cloud.callFunction({
        name: 'spaceNotices',
        data: { action: 'lookupEntry', ll2Id: id }
      })
    })
    .then((res) => {
      if (!res) return null
      const r = (res && res.result) || res
      if (!r || r.success === false || !r.hasNotices) return null
      const entryKey = String(r.entryKey || '').trim()
      const hitLl2 = String(r.ll2Id || id).trim()
      if (!entryKey && !hitLl2) return null
      return {
        entryKey,
        ll2Id: hitLl2,
        noticeCount: Number(r.noticeCount) || 0
      }
    })
    .catch(() => null)
}

module.exports = {
  lookupSpaceNoticeShortcut
}
