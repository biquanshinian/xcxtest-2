/**
 * node --test test/request-latency-guards.test.js
 * 接口耗时小步改：源码守门，防止冷启动再打慢路径。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('客户端不再调用 syncRocketCosIndex', () => {
  const img = read('utils/image-config.js')
  assert.doesNotMatch(img, /maybeInvokeRocketCosSync/)
  assert.doesNotMatch(img, /syncRocketCosIndex/)
  const cloud = read('cloudfunctions/syncRocketCosIndex/index.js')
  assert.match(cloud, /小程序端不再调用/)
})

test('媒体映射本地命中不立即 revalidate', () => {
  const img = read('utils/image-config.js')
  const loadFn = img.slice(img.indexOf('async function loadCloudMediaMap'))
  const hitReturn = loadFn.indexOf('if (cloudMapLoaded && !force)')
  const hitBlock = loadFn.slice(hitReturn, loadFn.indexOf('if (loadCloudMediaMapInFlight'))
  assert.match(hitBlock, /return runtimeCloudMediaMap/)
  assert.doesNotMatch(hitBlock, /revalidateCloudMediaMap/)
  const ttlHit = loadFn.slice(loadFn.indexOf('MEDIA_MAP_CACHE_TTL'), loadFn.indexOf('fetchMediaMapViaCloudFunction'))
  assert.doesNotMatch(ttlHit, /revalidateCloudMediaMap/)
})

test('会员本地命中不在启动预热里 callFunction', () => {
  const app = read('app.js')
  assert.match(app, /hasFreshMembershipState\(\)/)
  assert.match(app, /if \(!membership\.hasFreshMembershipState\(\)\)/)
  const membership = read('utils/membership.js')
  assert.match(membership, /timeout:\s*4000/)
  const isProSync = membership.slice(membership.indexOf('function isProSync'), membership.indexOf('function _wxLogin'))
  assert.doesNotMatch(isProSync, /getMembershipState\(\)/)
  const index = read('pages/index/index.js')
  assert.match(index, /hasFreshMembershipState\(\)/)
})

test('getCacheFromCloud 超时不再立刻打 8s', () => {
  const api = read('utils/api-request.js')
  const fn = api.slice(api.indexOf('async function getCacheFromCloud'), api.indexOf('if (!result.data)'))
  assert.doesNotMatch(fn, /Math\.max\(timeout,\s*8000\)/)
  assert.match(fn, /isDocMissError\(firstError\)/)
})

test('首页首屏不再 80ms 打 ll2Query snapshot', () => {
  const index = read('pages/index/index.js')
  assert.doesNotMatch(index, /later\(80,\s*\(\)\s*=>/)
  assert.doesNotMatch(index, /fetchLaunchStatusSnapshot\(snapshotIds\)/)
})

test('新闻红点网关失败不串行读库', () => {
  const app = read('app.js')
  const fn = app.slice(app.indexOf('_fetchNewsManualLatestUpdatedAtFromCloud'), app.indexOf('fetchNewsManualLatestUpdatedMs'))
  assert.match(fn, /finish\(undefined\)/)
  assert.doesNotMatch(fn, /\.catch\(\(\)\s*=>\s*tryDbOrderByUpdated\(\)\)/)
})
