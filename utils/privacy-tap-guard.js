/**
 * 首页遮罩点穿守卫：隐私弹窗 / 改期弹窗关闭后，原生 swiper 会吃到同一坐标的残余点击。
 */
const PRIVACY_TAP_GUARD_MS = 800
const PRIVACY_MODAL_HIDE_DELAY_MS = 360

function isPrivacyTapGuarded(app, now) {
  if (!app) return false
  const gd = app.globalData || {}
  if (gd.privacyModalVisible || gd.netChangeModalVisible) return true
  const until = Number(app._privacyTapGuardUntil) || 0
  return until > (now != null ? now : Date.now())
}

function nextPrivacyTapGuardUntil(now, ms) {
  const t = now != null ? now : Date.now()
  const span = ms > 0 ? ms : PRIVACY_TAP_GUARD_MS
  return t + span
}

module.exports = {
  PRIVACY_TAP_GUARD_MS,
  PRIVACY_MODAL_HIDE_DELAY_MS,
  isPrivacyTapGuarded,
  nextPrivacyTapGuardUntil
}
