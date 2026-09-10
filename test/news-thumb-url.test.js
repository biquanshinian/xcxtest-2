/**
 * 航天事件列表卡 / 详情头图同一条 Worker 代理链
 * node --test test/news-thumb-url.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {
  getWindowInfo() { return { windowWidth: 375, pixelRatio: 2 } },
  getDeviceInfo() { return {} },
  getAppBaseInfo() { return {} },
  getSystemInfoSync() { return { windowWidth: 375, pixelRatio: 2 } }
}

const { workerProxyUrl } = require('../utils/config.js')
const {
  resolveNewsListCardImage,
  buildNewsHeroCandidates,
  optimizeNewsThumbUrl
} = require('../subpackages/news-extra/utils/news-thumb-url.js')

const PROXY_BASE = String(workerProxyUrl || '').replace(/\/$/, '') + '/image?url='

function assertWorkerFirst(chainOrCard, rawHint) {
  const first = Array.isArray(chainOrCard) ? chainOrCard[0] : chainOrCard
  assert.ok(first.startsWith(PROXY_BASE), `首项应走 Worker 代理: ${first}`)
  if (rawHint) {
    assert.ok(first.includes(encodeURIComponent(rawHint).slice(0, 24)), `代理应包住原链: ${first}`)
  }
}

test('外链头图（NASA）列表卡首项走 Worker 代理，不直连', () => {
  const raw = 'https://www.nasa.gov/wp-content/uploads/2026/09/moon-base.jpg'
  const { cardImage, imageFallbacks } = resolveNewsListCardImage(raw, 640)
  assertWorkerFirst(cardImage)
  assert.ok(Array.isArray(imageFallbacks) && imageFallbacks.length > 0, '应保留回退链')
  assert.ok(!cardImage.includes('nasa.gov/wp-content'), '卡片 src 不得直连 nasa.gov')
})

test('SpacePolicyOnline 配图同样走代理', () => {
  const raw = 'https://spacepolicyonline.com/wp-content/uploads/2026/09/vision.jpg'
  const { cardImage } = resolveNewsListCardImage(raw, 640)
  assertWorkerFirst(cardImage)
})

test('COS 配图不包 Worker 代理', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/news/cover.jpg'
  const { cardImage, imageFallbacks } = resolveNewsListCardImage(raw, 640)
  assert.ok(cardImage.includes('myqcloud.com') || cardImage.includes('imageMogr2'), `COS 应直出压缩链: ${cardImage}`)
  assert.ok(!cardImage.includes('/image?url='), '自有 CDN 不应再包代理')
  assert.ok(Array.isArray(imageFallbacks))
})

test('详情头图候选链与列表同源：外链首项是 Worker 代理', () => {
  const raw = 'https://www.nasa.gov/wp-content/uploads/2026/09/moon-base.jpg'
  const chain = buildNewsHeroCandidates(raw)
  assert.ok(chain.length >= 2, '至少代理 + 原链')
  assertWorkerFirst(chain)
  assert.ok(chain.some((u) => u === raw || u.includes('i0.wp.com')), '链上应保留 Photon 或原图')
})

test('无 URL 不造假图', () => {
  assert.deepEqual(resolveNewsListCardImage(''), { cardImage: '', imageFallbacks: [] })
  assert.deepEqual(buildNewsHeroCandidates(''), [])
})

test('optimizeNewsThumbUrl 仍只做缩略，不负责代理', () => {
  const raw = 'https://spacepolicyonline.com/wp-content/uploads/2026/09/vision.jpg'
  const thumb = optimizeNewsThumbUrl(raw, 640)
  assert.ok(thumb.includes('i0.wp.com') || thumb === raw, `应 Photon 或原链: ${thumb}`)
  assert.ok(!thumb.includes('/image?url='), '缩略函数本身不包代理')
})
