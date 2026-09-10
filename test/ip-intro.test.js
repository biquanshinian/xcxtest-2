/**
 * node --test test/ip-intro.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getIpIntro,
  joinIntroLines,
  typeIntroAt,
  nextTypeDelay,
  expandHitRect,
  padModelHitRect,
  pickHitSlug,
  clampBubblePos,
  touchCssPoint
} = require('../subpackages/rocket-3d/ip-intro.js')

test('宇航员叫星问，马斯克是身高参照', () => {
  const astro = getIpIntro('astro')
  const musk = getIpIntro('musk')
  assert.equal(astro.name, '星问')
  assert.equal(astro.title, '向导')
  assert.ok(astro.lines[0].indexOf('星问') >= 0)
  assert.ok(astro.lines[1].indexOf('向导') >= 0)
  assert.equal(musk.name, '马斯克')
  assert.ok(musk.lines[1].indexOf('一米八八') >= 0)
  const truck = getIpIntro('cyber-pickup')
  assert.equal(truck.name, '赛博皮卡')
  assert.equal(truck.title, '车辆参照')
  assert.ok(truck.lines[1].indexOf('5.683') >= 0)
  assert.equal(getIpIntro('nope'), null)
})

test('打字按字推进，句号停顿更长', () => {
  const full = joinIntroLines(getIpIntro('musk'))
  const mid = typeIntroAt(full, 3)
  assert.equal(mid.typed, full.slice(0, 3))
  assert.equal(mid.done, false)
  assert.equal(typeIntroAt(full, 9999).done, true)
  assert.ok(nextTypeDelay('。') > nextTypeDelay('马'))
  assert.ok(nextTypeDelay('\n') > nextTypeDelay('克'))
})

test('小人热区会放大，重叠时点更小的', () => {
  const hits = [
    { slug: 'musk', left: 100, top: 100, right: 220, bottom: 260 },
    { slug: 'astro', left: 140, top: 120, right: 180, bottom: 200 }
  ]
  assert.equal(pickHitSlug(hits, 160, 160), 'astro')
  assert.equal(pickHitSlug(hits, 10, 10), '')
  const tiny = expandHitRect({ left: 10, top: 10, right: 12, bottom: 14 }, 56, 88, 0)
  assert.ok(tiny.right - tiny.left >= 56)
  assert.ok(tiny.bottom - tiny.top >= 88)
})

test('触发盒跟模型投影走，不套固定宽高', () => {
  const truck = padModelHitRect({ left: 100, top: 200, right: 200, bottom: 220 })
  const person = padModelHitRect({ left: 100, top: 100, right: 120, bottom: 200 })
  assert.ok(truck.right - truck.left > truck.bottom - truck.top, '车盒应保持横宽')
  assert.ok(person.bottom - person.top > person.right - person.left, '人盒应保持竖高')
  assert.ok(truck.bottom - truck.top < 50, '车高不应被拉成小人竖条')
  const hits = [
    { slug: 'musk', left: 160, top: 200, right: 190, bottom: 250 },
    { slug: 'cyber-pickup', left: 120, top: 220, right: 230, bottom: 255 }
  ]
  assert.equal(pickHitSlug(hits, 175, 225), 'musk')
  assert.equal(pickHitSlug(hits, 130, 238), 'cyber-pickup')
  const tinyTruck = [{ slug: 'cyber-pickup', left: 100, top: 100, right: 108, bottom: 106 }]
  assert.equal(pickHitSlug(tinyTruck, 104, 103), 'cyber-pickup')
  assert.equal(pickHitSlug(tinyTruck, 10, 10), '')
})

test('气泡不会画出屏幕，触摸点认 canvas x/y', () => {
  const pos = clampBubblePos(-40, -20, 375, 700, 240, 128)
  assert.equal(pos.x, 12)
  assert.equal(pos.y, 12)
  const p = touchCssPoint({ changedTouches: [{ x: 12, y: 40 }] })
  assert.deepEqual(p, { x: 12, y: 40 })
  assert.equal(touchCssPoint({}), null)
})

test('头出画时气泡不更新，可见时钉在头上不夹到屏幕边', () => {
  const { layoutHeadLockOverlay } = require('../subpackages/rocket-3d/ip-chat-3d.js')
  assert.equal(layoutHeadLockOverlay({ headX: 40, headY: 8, visible: false }, 375, 700, 'musk').visible, false)
  assert.equal(layoutHeadLockOverlay(null, 375, 700, 'musk').visible, false)
  const mid = layoutHeadLockOverlay({ headX: 180, headY: 320, visible: true }, 375, 700, 'musk')
  assert.equal(mid.visible, true)
  assert.ok(Math.abs(mid.x + mid.w / 2 - 180) <= 1)
  assert.ok(mid.y + mid.h <= 320)
})
