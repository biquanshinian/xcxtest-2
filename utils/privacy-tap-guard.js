/**
 * 隐私弹窗同意后的点穿守卫：原生 video 会吃到同意按钮同一坐标的残余点击。
 */
const PRIVACY_TAP_GUARD_MS = 800
const PRIVACY_MODAL_HIDE_DELAY_MS = 360

function isPrivacyTapGuarded(app, now) {
  if (!app) return false
  if (app.globalData && app.globalData.privacyModalVisible) return true
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
