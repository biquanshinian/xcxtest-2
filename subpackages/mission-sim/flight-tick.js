/**
 * 飞行剖面/指挥室共享渲染节拍：~30fps + 高倍速时引擎子步进，避免「一帧一跳」。
 */
var RENDER_MS = 33
var UI_MS = 100
var DT_MIN = 8
var DT_MAX = 64

/**
 * 墙钟 dt 推进引擎；高 warp 时拆成多段小步进，轨迹插值更密。
 */
function stepSmoothed(mission, realDtMs) {
  if (!mission) return null
  var snap = mission.snapshot()
  if (!snap || snap.phase === 'done') return snap
  // 决策门暂停：单步即可（autoDemo 会在 step 内立刻 GO）
  if (snap.gate && snap.warp === 0) return mission.step(realDtMs)

  var missionDt = (realDtMs / 1000) * (snap.warp || 0) * (snap.rate || 1)
  if (missionDt <= 1.0) return mission.step(realDtMs)

  var sub = Math.min(8, Math.max(2, Math.ceil(missionDt / 0.75)))
  var slice = realDtMs / sub
  for (var i = 0; i < sub; i++) {
    snap = mission.step(slice)
    if (!snap || snap.phase === 'done') break
    // 互动模式遇到新开的门：停在门上，交给 UI
    if (snap.gate && snap.warp === 0) break
  }
  return snap
}

function createRenderLoop(opts) {
  opts = opts || {}
  var onFrame = opts.onFrame
  var timer = null
  var lastWall = 0
  var uiAccum = 0

  function tick() {
    var now = Date.now()
    var dt = now - lastWall
    lastWall = now
    if (dt < DT_MIN) dt = DT_MIN
    if (dt > DT_MAX) dt = DT_MAX
    uiAccum += dt
    var flushUi = uiAccum >= UI_MS
    if (flushUi) uiAccum = 0
    if (typeof onFrame === 'function') onFrame(dt, flushUi)
  }

  return {
    start: function () {
      this.stop()
      lastWall = Date.now()
      uiAccum = UI_MS // 首帧立刻刷一次 UI
      timer = setInterval(tick, RENDER_MS)
    },
    stop: function () {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    /** 强制下次 onFrame 带 flushUi（离散状态变化时用） */
    flushUiSoon: function () {
      uiAccum = UI_MS
    }
  }
}

module.exports = {
  RENDER_MS: RENDER_MS,
  UI_MS: UI_MS,
  stepSmoothed: stepSmoothed,
  createRenderLoop: createRenderLoop
}
