/**
 * node --test test/index-mission-state.test.js
 * 首页任务卡滚动震动：焦点下标不能被首屏可见卡数量夹死。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getMissionCardListCount,
  buildMissionCardMetricsFromRects,
  resolveMissionCardFocusIndex,
  buildMissionCardHapticState
} = require('../utils/index-mission-state.js')

function makeCardRect(index, top, height = 120) {
  return { top, height, dataset: { hapticIndex: String(index) } }
}

test('getMissionCardListCount：即将发射用展示列表，门控截断', () => {
  assert.equal(
    getMissionCardListCount({
      missionType: 'upcoming',
      displayedUpcomingMissions: [{}, {}, {}, {}, {}],
      missionGateLimit: 0
    }),
    5
  )
  assert.equal(
    getMissionCardListCount({
      missionType: 'upcoming',
      displayedUpcomingMissions: [{}, {}, {}, {}, {}],
      missionGateLimit: 3
    }),
    3
  )
  assert.equal(
    getMissionCardListCount({
      missionType: 'completed',
      completedMissions: [{}, {}]
    }),
    2
  )
  assert.equal(getMissionCardListCount({ missionType: 'calendar' }), 0)
})

test('buildMissionCardMetricsFromRects：首屏只测到 4 张时 cardCount 仍用完整列表', () => {
  const metrics = buildMissionCardMetricsFromRects({
    scrollViewRect: { top: 0 },
    cardRects: [0, 1, 2, 3].map((i) => makeCardRect(i, 400 + i * 140)),
    currentScrollTop: 0,
    fallbackGap: 20,
    listCount: 20
  })
  assert.equal(metrics.cardCount, 20)
  assert.equal(metrics.pitch, 140)
  assert.equal(metrics.firstOffset, 400)
})

test('buildMissionCardMetricsFromRects：中途重测保留首张偏移，不把当前可见卡当成第 0 张', () => {
  const previous = {
    firstOffset: 400,
    pitch: 140,
    cardHeight: 120,
    cardCount: 10
  }
  const metrics = buildMissionCardMetricsFromRects({
    scrollViewRect: { top: 0 },
    cardRects: [8, 9].map((i) => makeCardRect(i, 100 + (i - 8) * 140)),
    currentScrollTop: 1500,
    fallbackGap: 20,
    previousMetrics: previous,
    listCount: 20
  })
  assert.equal(metrics.firstOffset, 400)
  assert.equal(metrics.cardCount, 20)
})

test('buildMissionCardMetricsFromRects：无历史度量时用 hapticIndex 反推首张偏移', () => {
  const metrics = buildMissionCardMetricsFromRects({
    scrollViewRect: { top: 0 },
    cardRects: [8, 9].map((i) => makeCardRect(i, 100 + (i - 8) * 140)),
    currentScrollTop: 1500,
    fallbackGap: 20,
    listCount: 20
  })
  assert.equal(metrics.pitch, 140)
  assert.equal(metrics.firstOffset, 1500 + 100 - 8 * 140)
  assert.equal(metrics.cardCount, 20)
})

test('resolveMissionCardFocusIndex：翻过首屏可见卡后下标继续增长，不被 4 夹死', () => {
  const metrics = buildMissionCardMetricsFromRects({
    scrollViewRect: { top: 0 },
    cardRects: [0, 1, 2, 3].map((i) => makeCardRect(i, 400 + i * 140)),
    currentScrollTop: 0,
    fallbackGap: 20,
    listCount: 20
  })
  const focusOpts = {
    metrics,
    cardCount: 20,
    viewportHeight: 800,
    navPlaceholderHeight: 88
  }
  const first = resolveMissionCardFocusIndex({ ...focusOpts, scrollTop: 0 })
  const later = resolveMissionCardFocusIndex({ ...focusOpts, scrollTop: 1544 })
  assert.equal(first, 0)
  assert.ok(later > 4, 'later focus=' + later)
  assert.ok(later < 20, 'later should stay within list')
})

test('buildMissionCardHapticState：下标变化时触发震动', () => {
  const state = buildMissionCardHapticState({
    focusIndex: 8,
    activeIndex: 7,
    now: 1000,
    lastVibrateAt: 800,
    vibrateIntervalMs: 120
  })
  assert.equal(state.shouldVibrate, true)
  assert.equal(state.nextActiveIndex, 8)
})
