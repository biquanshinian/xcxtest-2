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

test('任务详情切页不等 2.5s 媒体映射', () => {
  const src = read('pages/mission-detail/mission-detail.js')
  const onLoad = src.slice(src.indexOf('async onLoad(options)'), src.indexOf('async loadMissionDetail'))
  assert.match(onLoad, /isCloudMediaMapReady\(\)/)
  assert.match(onLoad, /MEDIA_MAP_SWITCH_PAINT_BUDGET_MS/)
  assert.doesNotMatch(onLoad, /setTimeout\(r,\s*2500\)/)
  assert.match(src, /MEDIA_MAP_SWITCH_PAINT_BUDGET_MS = 120/)
})

test('任务详情 / 探索分包不塞进首页 preloadRule，改为首帧后或意图预下载', () => {
  const app = JSON.parse(read('app.json'))
  const indexRule = app.preloadRule && app.preloadRule['pages/index/index']
  assert.equal(indexRule.network, 'wifi')
  assert.ok(!indexRule.packages.includes('mission-detail'))
  const monitorRule = app.preloadRule && app.preloadRule['pages/monitor/monitor']
  assert.equal(monitorRule.network, 'wifi')
  assert.ok(!monitorRule.packages.includes('nasa-data'))
  const profileRule = app.preloadRule && app.preloadRule['pages/profile/profile']
  assert.ok(!profileRule.packages.includes('collect'))
  const index = read('pages/index/index.js')
  assert.match(index, /preloadSubpackages\(\['mission-detail'\]\)/)
  assert.match(read('pages/monitor/monitor.js'), /preloadSubpackages\(\['nasa-data'\]\)/)
  assert.match(read('pages/profile/profile.js'), /preloadSubpackages\(\['collect'\]\)/)
  const float = read('subpackages/shared/components/nasa-float/index.js')
  assert.match(float, /_preloadExplorePackages/)
  assert.match(float, /nasa-data/)
  assert.match(read('utils/preload-subpackages.js'), /function preloadSubpackages/)
})

test('月愿页配置已缓存时立刻开页，音频不抢首屏', () => {
  const src = read('pages/collect/collect.js')
  assert.match(src, /getCachedMainConfig\(\)/)
  const boot = src.slice(src.indexOf('_bootLunarPage()'), src.indexOf('onUnload()'))
  assert.match(boot, /nextTick/)
  assert.match(boot, /createInnerAudioContext/)
  assert.ok(boot.indexOf('_restoreOrCheckWish') < boot.indexOf('createInnerAudioContext'))
})
