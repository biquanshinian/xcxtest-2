/**
 * node --test test/splash-resume-replay.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  splashConfigUpdatedAt,
  shouldReplaySplashOnResume,
  isSplashCloudPoolCleared,
  isSplashCloudPoolUnusable,
  selectSplashMediaPool
} = require('../subpackages/index-extra/utils/splash-replay.js')

test('splashConfigUpdatedAt 只认正数', () => {
  assert.equal(splashConfigUpdatedAt(null), 0)
  assert.equal(splashConfigUpdatedAt({}), 0)
  assert.equal(splashConfigUpdatedAt({ updatedAt: 'nope' }), 0)
  assert.equal(splashConfigUpdatedAt({ updatedAt: 1700000000000 }), 1700000000000)
})

test('冷启动不重播：本进程还没播过', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      needResumeCheck: true,
      shownThisSession: false,
      cloudUpdatedAt: 2,
      lastShownUpdatedAt: 1
    }),
    false
  )
})

test('切 Tab 不重播：没有后台回前台标记', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      needResumeCheck: false,
      shownThisSession: true,
      cloudUpdatedAt: 2,
      lastShownUpdatedAt: 1
    }),
    false
  )
})

test('配置未变不重播', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      needResumeCheck: true,
      shownThisSession: true,
      cloudUpdatedAt: 10,
      lastShownUpdatedAt: 10
    }),
    false
  )
})

test('后台回前台且 updatedAt 更新则重播', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      needResumeCheck: true,
      shownThisSession: true,
      cloudUpdatedAt: 20,
      lastShownUpdatedAt: 10
    }),
    true
  )
})

test('开屏正显示时不叠一层', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      splashVisible: true,
      needResumeCheck: true,
      shownThisSession: true,
      cloudUpdatedAt: 20,
      lastShownUpdatedAt: 10
    }),
    false
  )
})

test('从未记下播过版本时不重播，避免冷启动超时后误播', () => {
  assert.equal(
    shouldReplaySplashOnResume({
      needResumeCheck: true,
      shownThisSession: true,
      cloudUpdatedAt: 20,
      lastShownUpdatedAt: 0
    }),
    false
  )
})

test('热启动重播只用云端池，不回落本地旧片', () => {
  const cloud = [{ id: 'new' }]
  const cached = [{ id: 'old' }]
  assert.deepEqual(
    selectSplashMediaPool({
      replay: true,
      cloudItems: cloud,
      cachedItems: cached,
      cacheHasPool: true,
      cfg: { mediaItems: [] }
    }),
    cloud
  )
  assert.deepEqual(
    selectSplashMediaPool({
      replay: true,
      cloudItems: [],
      cachedItems: cached,
      cacheHasPool: true,
      cfg: { mediaItems: [] }
    }),
    []
  )
})

test('冷启动无云端池时可回落本地', () => {
  const cached = [{ id: 'old' }]
  assert.deepEqual(
    selectSplashMediaPool({
      replay: false,
      cloudItems: [],
      cachedItems: cached,
      cacheHasPool: true,
      cfg: null
    }),
    cached
  )
})

test('冷启动云端空媒体池不回落本地旧片', () => {
  const cached = [{ id: 'old' }]
  assert.deepEqual(
    selectSplashMediaPool({
      replay: false,
      cloudItems: [],
      cachedItems: cached,
      cacheHasPool: true,
      cfg: { mediaItems: [] }
    }),
    []
  )
  assert.equal(isSplashCloudPoolCleared({ mediaItems: [] }), true)
  assert.equal(isSplashCloudPoolCleared({ enabled: false, mediaItems: [{ id: 'x' }] }), true)
  assert.equal(isSplashCloudPoolCleared({ mediaItems: [{ id: 'x' }] }), false)
  assert.equal(isSplashCloudPoolCleared(null), false)
  assert.equal(isSplashCloudPoolUnusable({ mediaItems: [] }, []), true)
  assert.equal(isSplashCloudPoolUnusable({ mediaItems: [{ id: 'broken' }] }, []), true)
  assert.equal(isSplashCloudPoolUnusable({ mediaItems: [{ id: 'x' }] }, [{ id: 'x' }]), false)
  assert.equal(isSplashCloudPoolUnusable({ enabled: true }, [{ id: 'legacy' }]), false)
})

test('冷启动无 mediaItems 字段时仍可回落本地（兼容旧文档）', () => {
  const cached = [{ id: 'old' }]
  assert.deepEqual(
    selectSplashMediaPool({
      replay: false,
      cloudItems: [],
      cachedItems: cached,
      cacheHasPool: true,
      cfg: { enabled: true }
    }),
    cached
  )
})
