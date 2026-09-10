/**
 * IP 窗展开反馈：中度震动 + 科技开窗音。
 * 只给 rocket-3d 用，不放主包。
 */

const OPEN_SRC = '/subpackages/rocket-3d/assets/ip-open.wav'

let _ctx = null

function pulseOpenHaptic() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {}
}

function playOpenSound() {
  try {
    if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return false
    if (!_ctx) {
      _ctx = wx.createInnerAudioContext({ useWebAudioImplement: true })
      _ctx.src = OPEN_SRC
      _ctx.volume = 0.52
      _ctx.obeyMuteSwitch = true
    }
    try {
      _ctx.stop()
    } catch (e) {}
    try {
      if (typeof _ctx.seek === 'function') _ctx.seek(0)
    } catch (e2) {}
    _ctx.play()
    return true
  } catch (e3) {
    return false
  }
}

function playOpen() {
  pulseOpenHaptic()
  playOpenSound()
}

function dispose() {
  if (!_ctx) return
  try {
    _ctx.stop()
  } catch (e) {}
  try {
    _ctx.destroy()
  } catch (e2) {}
  _ctx = null
}

module.exports = {
  OPEN_SRC,
  pulseOpenHaptic,
  playOpenSound,
  playOpen,
  dispose
}
