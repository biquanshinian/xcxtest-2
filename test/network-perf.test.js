/**
 * We分析网络性能：失败接口降级 / 慢请求缓存
 * 运行：node --test test/network-perf.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('Worker cache.put 失败不挡响应', () => {
  const files = [
    'cloudflare-worker/spacex-proxy.js',
    'cloudflare-worker/roman-tracker.js'
  ]
  files.forEach((rel) => {
    const lines = read(rel).split(/\r?\n/)
    const unguarded = lines.filter((l) => /await cache\.put/.test(l) && !/try \{/.test(l))
    assert.equal(unguarded.length, 0, rel + ' → ' + unguarded.join(' | '))
  })
})

test('Worker /image 走边缘缓存，不再每次回源', () => {
  const src = read('cloudflare-worker/spacex-proxy.js')
  const start = src.indexOf("url.pathname === '/image'")
  assert.ok(start >= 0)
  const block = src.slice(start, start + 1800)
  assert.match(block, /caches\.default/)
  assert.match(block, /cache\.match/)
  assert.match(block, /cache\.put/)
  assert.match(block, /max-age=86400/)
})

test('天气优先 Worker /starbase/weather，缓存拉长到 30 分钟', () => {
  const weather = read('subpackages/monitor-pages/utils/monitor-weather.js')
  assert.match(weather, /\/starbase\/weather/)
  assert.match(weather, /FRESH_MS = 30 \* 60 \* 1000/)
  assert.match(weather, /CACHE_MS = 30 \* 60 \* 1000/)
  assert.match(weather, /_payloadFromWorkerWeather/)
  assert.match(weather, /OPEN_METEO_URL/)
})

test('空间站 TLE 失败时回落内存旧数据', () => {
  const src = read('subpackages/monitor-pages/utils/tle-fetch.js')
  assert.match(src, /if \(!force && _mem\) return _mem/)
})

test('Artemis 遥测失败回落旧快照，不再打 /artemis-horizons', () => {
  const src = read('subpackages/monitor-pages/utils/artemis-arow.js')
  assert.match(src, /_artemis_briefing_last/)
  const start = src.indexOf('async function fetchBriefing')
  const end = src.indexOf('module.exports')
  assert.ok(start >= 0 && end > start)
  const fn = src.slice(start, end)
  assert.match(fn, /readStaleBriefing/)
  assert.doesNotMatch(fn, /fetchFromHorizons|artemis-horizons/)
  assert.doesNotMatch(src, /function fetchFromHorizons/)
})
