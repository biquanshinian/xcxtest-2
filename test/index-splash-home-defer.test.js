/**
 * node --test test/index-splash-home-defer.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SPLASH_COUNTDOWN_GATE_MAX_MS,
  SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS,
  resolveSplashGateWaitMs,
  AFTER_SPLASH_QUEUE_MAX,
  isSplashBlockingHomeWork,
  shouldKeepCountdownOnEmptyApply,
  isLaunchStateGenerationCurrent,
  pushAfterSplashQueue,
  collectAfterSplashJobs
} = require('../pages/index/utils/index-splash-home-defer.js')

test('开屏门闩上限覆盖冷启动决策窗（会员确认+配置+远程片延迟）', () => {
  assert.ok(SPLASH_COUNTDOWN_GATE_MAX_MS >= 4000)
})

test('空面板时门闩预算大幅收窄：宁可抢带宽也不让首屏空着', () => {
  assert.ok(SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS <= 1000)
  assert.ok(SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS < SPLASH_COUNTDOWN_GATE_MAX_MS)
  assert.equal(resolveSplashGateWaitMs(false), SPLASH_COUNTDOWN_GATE_EMPTY_MAX_MS)
  assert.equal(resolveSplashGateWaitMs(true), SPLASH_COUNTDOWN_GATE_MAX_MS)
})

test('isLaunchStateGenerationCurrent：0 不再被当成通配符', () => {
  assert.equal(isLaunchStateGenerationCurrent(1, 0), false)
  assert.equal(isLaunchStateGenerationCurrent(0, 0), true)
  assert.equal(isLaunchStateGenerationCurrent(2, 2), true)
  assert.equal(isLaunchStateGenerationCurrent(2, null), true)
})

test('isSplashBlockingHomeWork：展示中 / 淡出 / 同步标记都算阻断', () => {
  assert.equal(isSplashBlockingHomeWork({ _splashUiActive: true, data: {} }), true)
  assert.equal(isSplashBlockingHomeWork({ data: { splashVisible: true } }), true)
  assert.equal(isSplashBlockingHomeWork({ data: { splashFading: true } }), true)
  assert.equal(isSplashBlockingHomeWork({ data: { splashVisible: false, splashFading: false } }), false)
})

test('shouldKeepCountdownOnEmptyApply：开屏期保留已画倒计时，不空面板', () => {
  const page = {
    _splashUiActive: true,
    data: { splashVisible: true, launchData: { id: 'keep-me' } }
  }
  assert.equal(shouldKeepCountdownOnEmptyApply(page, null), true)
  assert.equal(shouldKeepCountdownOnEmptyApply(page, { id: 'x' }), false)
  assert.equal(
    shouldKeepCountdownOnEmptyApply({ data: { launchData: { id: 'x' } } }, null),
    false
  )
})

test('pushAfterSplashQueue：超限覆盖最后一项，避免关屏任务风暴', () => {
  let q = []
  for (let i = 0; i < AFTER_SPLASH_QUEUE_MAX + 3; i++) {
    const n = i
    q = pushAfterSplashQueue(q, () => n, AFTER_SPLASH_QUEUE_MAX)
  }
  assert.equal(q.length, AFTER_SPLASH_QUEUE_MAX)
  assert.equal(q[q.length - 1](), AFTER_SPLASH_QUEUE_MAX + 2)
})

test('collectAfterSplashJobs：同名 slot 只保留最后一次', () => {
  const jobs = collectAfterSplashJobs(
    {
      agencyEnrich: () => 'old',
      homeBackground: () => 'bg'
    },
    [() => 'q1']
  )
  const latest = collectAfterSplashJobs(
    {
      agencyEnrich: () => 'new',
      homeBackground: () => 'bg'
    },
    [() => 'q1']
  )
  assert.equal(latest[0](), 'new')
  assert.equal(latest[1](), 'bg')
  assert.equal(latest[2](), 'q1')
  assert.equal(jobs.length, 3)
})
