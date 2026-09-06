const assert = require('assert')
const {
  resolveTweetCardFocusIndex,
  buildTweetCardHapticState
} = require('../subpackages/progress-extra/utils/event-list-haptic.js')

function rect(top, height, index) {
  return { top, height, dataset: { hapticIndex: String(index) } }
}

function testFocusByCardWindow() {
  const scrollViewRect = { top: 0, height: 700 }
  const cards = [rect(88, 240, 0), rect(348, 400, 1), rect(768, 180, 2)]
  // 内容区从 88 起，32% 锚点 ≈ 88 + 612*0.32 ≈ 284，落在第一张 [88, 328]
  assert.strictEqual(resolveTweetCardFocusIndex({
    scrollViewRect,
    cardRects: cards,
    navPlaceholderHeight: 88
  }), 0)
  // 把卡片整体上移，让锚点落到第二张
  const shifted = [rect(-80, 240, 0), rect(180, 400, 1), rect(600, 180, 2)]
  assert.strictEqual(resolveTweetCardFocusIndex({
    scrollViewRect,
    cardRects: shifted,
    navPlaceholderHeight: 88
  }), 1)
  assert.strictEqual(resolveTweetCardFocusIndex({ scrollViewRect, cardRects: [] }), -1)
}

function testHapticOncePerCard() {
  const first = buildTweetCardHapticState({ focusIndex: 0, activeIndex: -1, now: 1000 })
  assert.strictEqual(first.shouldVibrate, false)
  assert.strictEqual(first.nextActiveIndex, 0)

  const same = buildTweetCardHapticState({ focusIndex: 0, activeIndex: 0, now: 1100 })
  assert.strictEqual(same.shouldVibrate, false)

  const next = buildTweetCardHapticState({
    focusIndex: 1,
    activeIndex: 0,
    now: 1300,
    lastVibrateAt: 0
  })
  assert.strictEqual(next.shouldVibrate, true)
  assert.strictEqual(next.nextActiveIndex, 1)

  const back = buildTweetCardHapticState({
    focusIndex: 0,
    activeIndex: 1,
    now: 1600,
    lastVibrateAt: 1300
  })
  assert.strictEqual(back.shouldVibrate, true)
}

testFocusByCardWindow()
testHapticOncePerCard()
console.log('event-list-haptic tests passed')
