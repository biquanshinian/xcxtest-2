function parseTime(iso) {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 根据窗口开始 / T-0 / 窗口结束时间计算横条进度与节点状态
 */
function computeLaunchTimelineProgress(mission, options = {}) {
  const now = options.now != null ? options.now : Date.now()
  const isCompleted = options.isCompleted === true

  const w = parseTime(mission && mission.windowStart)
  const l = parseTime(mission && mission.launchTime)
  const e = parseTime(mission && mission.windowEnd)

  let start = w
  let end = e
  let liftoff = l

  if (!Number.isFinite(start) && Number.isFinite(liftoff)) {
    start = liftoff - 2 * 3600 * 1000
  }
  if (!Number.isFinite(end) && Number.isFinite(liftoff)) {
    end = liftoff + 2 * 3600 * 1000
  }
  if (!Number.isFinite(liftoff) && Number.isFinite(start) && Number.isFinite(end)) {
    liftoff = start + (end - start) / 2
  }

  const range = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0
  const liftoffPercent = range > 0
    ? clamp(((liftoff - start) / range) * 100, 8, 92)
    : 50

  let progressPercent = 0
  let activeStep = 'start'
  let startState = 'pending'
  let liftoffState = 'pending'
  let endState = 'pending'
  let inWindow = false
  let statusText = '等待窗口开启'

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      progressPercent: isCompleted ? 100 : 0,
      liftoffPercent,
      activeStep: isCompleted ? 'complete' : 'start',
      startState: isCompleted ? 'done' : 'pending',
      liftoffState: isCompleted ? 'done' : 'pending',
      endState: isCompleted ? 'done' : 'pending',
      inWindow: false,
      statusText: isCompleted ? '任务已完成' : '时间待公布',
      animate: false
    }
  }

  if (isCompleted || now >= end) {
    progressPercent = 100
    activeStep = 'complete'
    startState = 'done'
    liftoffState = 'done'
    endState = 'done'
    inWindow = false
    statusText = isCompleted ? '任务已完成' : '窗口已结束'
  } else if (now < start) {
    progressPercent = 0
    activeStep = 'start'
    startState = 'active'
    statusText = '等待窗口开启'
  } else if (now < liftoff) {
    progressPercent = range > 0 ? clamp(((now - start) / range) * 100, 0, liftoffPercent) : 0
    activeStep = 'liftoff'
    startState = 'done'
    liftoffState = 'active'
    inWindow = true
    statusText = '窗口已开启'
  } else {
    progressPercent = range > 0 ? clamp(((now - start) / range) * 100, liftoffPercent, 100) : liftoffPercent
    activeStep = 'end'
    startState = 'done'
    liftoffState = 'done'
    endState = 'active'
    inWindow = true
    statusText = '等待窗口关闭'
  }

  return {
    progressPercent: Math.round(progressPercent * 10) / 10,
    liftoffPercent: Math.round(liftoffPercent * 10) / 10,
    activeStep,
    startState,
    liftoffState,
    endState,
    inWindow,
    statusText,
    animate: inWindow && !isCompleted
  }
}

module.exports = {
  computeLaunchTimelineProgress
}
