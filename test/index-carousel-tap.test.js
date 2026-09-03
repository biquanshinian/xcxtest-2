/**
 * node --test test/index-carousel-tap.test.js
 */
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveCarouselEventDs } = require('../subpackages/index-extra/utils/carousel-event-ds.js')

const ROOT = path.join(__dirname, '..')

test('resolveCarouselEventDs：组件 triggerEvent 把 inner dataset 放在 e.detail', () => {
  const ds = resolveCarouselEventDs({
    currentTarget: { dataset: {} },
    detail: { index: 2, eventid: 'evt-1' }
  })
  assert.equal(ds.index, 2)
  assert.equal(ds.eventid, 'evt-1')
})

test('resolveCarouselEventDs：页面节点回退 currentTarget.dataset', () => {
  const ds = resolveCarouselEventDs({
    currentTarget: { dataset: { index: 1, url: 'https://cdn.example/a.jpg' } },
    detail: {}
  })
  assert.equal(ds.index, 1)
  assert.equal(ds.url, 'https://cdn.example/a.jpg')
})

test('resolveCarouselEventDs：detail 覆盖 currentTarget（组件事件优先）', () => {
  const ds = resolveCarouselEventDs({
    currentTarget: { dataset: { index: 0 } },
    detail: { index: 3 }
  })
  assert.equal(ds.index, 3)
})

test('resolveCarouselEventDs：空事件不抛', () => {
  assert.deepEqual(resolveCarouselEventDs(null), {})
  assert.deepEqual(resolveCarouselEventDs(undefined), {})
  assert.deepEqual(resolveCarouselEventDs({}), {})
})

test('轮播组件：视频只展示封面，不挂原生 video / cover-view，点击用 bindtap', () => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/components/index-carousel/index.wxml'),
    'utf8'
  )
  assert.match(wxml, /class="carousel-video-poster"/)
  assert.match(wxml, /bindtap="emitVideoTap"/)
  assert.doesNotMatch(wxml, /catchtap="emitVideoTap"/)
  assert.doesNotMatch(wxml, /<video[\s>]/)
  assert.doesNotMatch(wxml, /<cover-view[\s>]/)
  assert.doesNotMatch(wxml, /onCarouselVideoTimeUpdate/)
  assert.match(wxml, /disable-touch="\{\{gestureLocked\}\}"/)
  assert.match(wxml, /image-carousel--locked/)
  assert.match(wxml, /wx:else/)
  assert.match(wxml, /image-carousel-frozen/)
})


test('轮播组件：virtualHost 避免自定义组件包裹节点拦截 swiper 手势', () => {
  const js = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/components/index-carousel/index.js'),
    'utf8'
  )
  assert.match(js, /virtualHost:\s*true/)
  assert.match(js, /gestureLocked/)
  assert.match(js, /frozenSrc/)
})


test('轮播逻辑：不在 swiper 内激活原生 video', () => {
  const js = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/utils/index-carousel.js'),
    'utf8'
  )
  const activate = js.slice(js.indexOf('_activateCarouselVideos'), js.indexOf('_playCurrentVideoIfNeeded'))
  assert.match(activate, /const want = new Set\(\)/)
  assert.doesNotMatch(activate, /autoplayAllowed \? \[cur\]/)
})

test('页面处理函数从 resolveCarouselEventDs 取 index，不再只读 currentTarget.dataset', () => {
  const js = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/utils/index-carousel.js'),
    'utf8'
  )
  const tap = js.slice(js.indexOf('async onCarouselVideoTap'), js.indexOf('onCarouselImageLoad'))
  assert.match(tap, /resolveCarouselEventDs\(e\)/)
  assert.doesNotMatch(tap, /e\.currentTarget\.dataset \|\| \{\}/)
  const caption = js.slice(js.indexOf('onCarouselCaptionTap'), js.indexOf('async onCarouselVideoTap'))
  assert.match(caption, /resolveCarouselEventDs\(e\)/)
})
