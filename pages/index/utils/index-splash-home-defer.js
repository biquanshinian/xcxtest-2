/**
 * 首页倒计时 × 开屏：延后提交 / 门闩 / 关屏后任务队列。
 * 纯函数，供页面与单测共用，避免开屏期抢带宽、关屏瞬间请求风暴。
 */

const SPLASH_COUNTDOWN_GATE_MAX_MS = 4200
// 本地一张倒计时都没画出来时的门闩上限：开屏决策链（网探 180 + 配置 800 + Pro 确认 1500
// + 预拉 400 + 起播延迟 500）最坏能堆到 3.4s，用户面对的是一张空倒计时卡。
// 这种情况下宁可让 ~20KB 的列表请求和开屏预览片抢一点带宽，也不能让首屏空着。
const SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS = 900
const AFTER_SPLASH_STAGGER_MS = 80
const AFTER_SPLASH_QUEUE_MAX = 6
const AFTER_SPLASH_JOB_ORDER = ['quietSettle', 'agencyEnrich', 'homeBackground', 'staleUpcoming', 'loadError']

/** 倒计时云端首拉可以等开屏多久：已有本地快显才让满档，空面板只给小预算 */
function resolveSplashGateWaitMs(hasPaintedCountdown) {
  return hasPaintedCountdown ? SPLASH_COUNTDOWN_GATE_MAX_MS : SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS
}

function isSplashBlockingHomeWork(pageLike) {
  if (!pageLike) return false
  if (pageLike._splashUiActive) return true
  const data = pageLike.data || {}
  return !!(data.splashVisible || data.splashFading)
}

function shouldKeepCountdownOnEmptyApply(pageLike, panelMission) {
  if (panelMission) return false
  const launchData = pageLike && pageLike.data && pageLike.data.launchData
  const hasCountdown = !!(launchData && launchData.id)
  return hasCountdown && isSplashBlockingHomeWork(pageLike)
}

function isLaunchStateGenerationCurrent(current, generation) {
  if (generation == null || generation === '') return true
  return generation === current
}

function pushAfterSplashQueue(queue, fn, max) {
  const list = Array.isArray(queue) ? queue.slice() : []
  const cap = max > 0 ? max : AFTER_SPLASH_QUEUE_MAX
  if (typeof fn !== 'function') return list
  if (list.length >= cap) {
    list[list.length - 1] = fn
    return list
  }
  list.push(fn)
  return list
}

function collectAfterSplashJobs(slotted, queue, order) {
  const jobs = []
  const map = slotted && typeof slotted === 'object' ? slotted : {}
  const keys = Array.isArray(order) && order.length ? order : AFTER_SPLASH_JOB_ORDER
  for (let i = 0; i < keys.length; i++) {
    const fn = map[keys[i]]
    if (typeof fn === 'function') jobs.push(fn)
  }
  const extra = Array.isArray(queue) ? queue : []
  for (let j = 0; j < extra.length; j++) {
    if (typeof extra[j] === 'function') jobs.push(extra[j])
  }
  return jobs
}

module.exports = {
  SPLASH_COUNTDOWN_GATE_MAX_MS,
  SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS,
  resolveSplashGateWaitMs,
  AFTER_SPLASH_STAGGER_MS,
  AFTER_SPLASH_QUEUE_MAX,
  AFTER_SPLASH_JOB_ORDER,
  isSplashBlockingHomeWork,
  shouldKeepCountdownOnEmptyApply,
  isLaunchStateGenerationCurrent,
  pushAfterSplashQueue,
  collectAfterSplashJobs
}
