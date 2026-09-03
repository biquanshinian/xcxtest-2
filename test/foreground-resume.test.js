/**
 * node --test test/foreground-resume.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  STATUS_REVALIDATE_MS,
  STATUS_PROBE_MIN_GAP_MS,
  LIST_REVALIDATE_MS,
  VOTE_REVALIDATE_MS,
  FEATURE_REVALIDATE_MS,
  markAppHidden,
  markAppShown,
  consumePageForegroundResume,
  shouldRevalidate,
  isNearLaunchWindow,
  planIndexForegroundRevalidate
} = require('../utils/foreground-resume.js')

test('冷启动 App.onShow：没有 hide 则 resumeMs=0，仍推进 seq', () => {
  const app = {}
  assert.equal(markAppShown(app, 1000), 0)
  assert.equal(app._backgroundResumeMs, 0)
  assert.equal(app._foregroundSeq, 1)
})

test('真切后台再回来：resumeMs 等于挂起时长', () => {
  const app = {}
  markAppHidden(app, 1000)
  assert.equal(markAppShown(app, 1000 + 45 * 1000), 45 * 1000)
  assert.equal(app._appHiddenAt, undefined)
  assert.equal(app._foregroundSeq, 1)
})

test('非法 hiddenAt 不当成超长挂起', () => {
  const app = { _appHiddenAt: 'nope' }
  assert.equal(markAppShown(app, 999999), 0)
})

test('首页先消费后切 Tab：新闻页仍能拿到同一轮 resumeMs', () => {
  const app = {}
  markAppHidden(app, 0)
  markAppShown(app, LIST_REVALIDATE_MS + 10)
  const index = {}
  const news = {}
  const first = consumePageForegroundResume(index, app)
  const tabAgain = consumePageForegroundResume(index, app)
  const newsFirst = consumePageForegroundResume(news, app)
  assert.equal(first.isNewForeground, true)
  assert.ok(first.resumeMs >= LIST_REVALIDATE_MS)
  assert.equal(tabAgain.resumeMs, 0)
  assert.equal(tabAgain.isNewForeground, false)
  assert.equal(newsFirst.resumeMs, first.resumeMs)
  assert.equal(newsFirst.isNewForeground, true)
})

test('切 Tab 不走 App.onShow：seq 不变则 resumeMs=0', () => {
  const app = { _foregroundSeq: 2, _backgroundResumeMs: 999999 }
  const page = { _lastForegroundSeq: 2 }
  const out = consumePageForegroundResume(page, app)
  assert.equal(out.resumeMs, 0)
  assert.equal(out.isNewForeground, false)
})

test('shouldRevalidate 门槛', () => {
  assert.equal(shouldRevalidate(STATUS_REVALIDATE_MS - 1, STATUS_REVALIDATE_MS), false)
  assert.equal(shouldRevalidate(STATUS_REVALIDATE_MS, STATUS_REVALIDATE_MS), true)
  assert.equal(shouldRevalidate(LIST_REVALIDATE_MS, LIST_REVALIDATE_MS), true)
  assert.equal(shouldRevalidate(0, STATUS_REVALIDATE_MS), false)
})

test('缺 app / 缺 page 不抛', () => {
  assert.equal(markAppShown(null, 1), 0)
  markAppHidden(null, 1)
  const out = consumePageForegroundResume(null, null)
  assert.equal(out.resumeMs, 0)
  assert.equal(out.isNewForeground, false)
})

test('isNearLaunchWindow：过期或 30 分钟内', () => {
  assert.equal(isNearLaunchWindow(null), false)
  assert.equal(isNearLaunchWindow({ isExpired: true, total: 0 }), true)
  assert.equal(isNearLaunchWindow({ isExpired: false, total: 10 * 60 * 1000 }), true)
  assert.equal(isNearLaunchWindow({ isExpired: false, total: 2 * 60 * 60 * 1000 }), false)
  assert.equal(isNearLaunchWindow({ isExpired: false, days: 0, hours: 0, minutes: 12, total: NaN }), true)
})

function assertNoStorm(plan) {
  assert.equal(plan.forceListCloud, false)
  assert.equal(plan.liveStatusProbe && plan.resolveCurrentLite, false)
}

test('计划：切 Tab / 短挂后台全关', () => {
  const a = planIndexForegroundRevalidate({ resumeMs: 0, hasLaunchId: true, nearWindow: true })
  const b = planIndexForegroundRevalidate({
    resumeMs: STATUS_REVALIDATE_MS - 1,
    hasLaunchId: true,
    nearWindow: true,
    pastNetHeadCount: 2
  })
  assert.deepEqual(a, planIndexForegroundRevalidate({ resumeMs: 0 }))
  assert.equal(b.quietSettle, false)
  assert.equal(b.liveStatusProbe, false)
  assert.equal(b.resolveCurrentLite, false)
  assert.equal(b.listSwr, false)
  assertNoStorm(a)
  assertNoStorm(b)
})

test('计划：远窗 45s 只走轻量 resolve，不打 live / 不强清探云节流', () => {
  const plan = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    hasLaunchId: true,
    countdownExpired: false,
    launchStatusPolling: false,
    nearWindow: false,
    pastNetHeadCount: 0,
    msSinceLastLiteProbe: STATUS_PROBE_MIN_GAP_MS
  })
  assert.equal(plan.resolveCurrentLite, true)
  assert.equal(plan.liveStatusProbe, false)
  assert.equal(plan.listSwr, false)
  assert.equal(plan.quietSettle, false)
  assertNoStorm(plan)
})

test('计划：远窗轻量探针 60s 内去重', () => {
  const plan = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    hasLaunchId: true,
    nearWindow: false,
    msSinceLastLiteProbe: STATUS_PROBE_MIN_GAP_MS - 1
  })
  assert.equal(plan.resolveCurrentLite, false)
  assert.equal(plan.liveStatusProbe, false)
})

test('计划：近窗未过点走完整实况探针，已过点交给 expire 流程', () => {
  const near = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    hasLaunchId: true,
    countdownExpired: false,
    nearWindow: true
  })
  const expired = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    hasLaunchId: true,
    countdownExpired: true,
    nearWindow: true,
    launchStatusPolling: false
  })
  assert.equal(near.liveStatusProbe, true)
  assert.equal(near.resolveCurrentLite, false)
  assert.equal(expired.liveStatusProbe, false)
  assert.equal(expired.resolveCurrentLite, false)
  assertNoStorm(near)
  assertNoStorm(expired)
})

test('计划：轮询中不叠探针', () => {
  const plan = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    hasLaunchId: true,
    nearWindow: true,
    launchStatusPolling: true
  })
  assert.equal(plan.liveStatusProbe, false)
  assert.equal(plan.resolveCurrentLite, false)
})

test('计划：≥2min 列表 SWR 但永不 forceListCloud；≥5min 才动开关/票数', () => {
  const twoMin = planIndexForegroundRevalidate({
    resumeMs: LIST_REVALIDATE_MS,
    hasLaunchId: true,
    nearWindow: false
  })
  const fiveMin = planIndexForegroundRevalidate({
    resumeMs: FEATURE_REVALIDATE_MS,
    hasLaunchId: true,
    nearWindow: false
  })
  assert.equal(twoMin.listSwr, true)
  assert.equal(twoMin.fetchFeatureFlags, false)
  assert.equal(twoMin.skipVoteCache, false)
  assert.equal(fiveMin.listSwr, true)
  assert.equal(fiveMin.fetchFeatureFlags, true)
  assert.equal(fiveMin.skipVoteCache, VOTE_REVALIDATE_MS === FEATURE_REVALIDATE_MS)
  assertNoStorm(twoMin)
  assertNoStorm(fiveMin)
})

test('计划：有过点头部才 quietSettle', () => {
  const plan = planIndexForegroundRevalidate({
    resumeMs: 45 * 1000,
    pastNetHeadCount: 2,
    hasLaunchId: true,
    countdownExpired: true
  })
  assert.equal(plan.quietSettle, true)
})
