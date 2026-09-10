/**
 * node --test test/ip-reference-ready.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const ready = require('../utils/ip-reference-ready.js')

test('网关只有两个 IP 时，从媒体映射补上赛博皮卡', () => {
  ready.ingest({
    ipScaleRefs: {
      astro: { url: 'https://x/astro.glb', highestPoint: 1.88, enabled: true },
      musk: { url: 'https://x/musk.glb', highestPoint: 1.88, enabled: true }
    },
    mediaMap: {
      'models/reference/musk.glb': 'https://x/musk.glb',
      'models/reference/cyber-pickup.glb': 'https://x/truck.glb',
      'models/rockets/falcon-9.glb': 'https://x/f9.glb'
    }
  })
  const list = ready.listEnabled()
  assert.deepEqual(list.map((item) => item.slug), ['musk', 'astro', 'cyber-pickup'])
  assert.equal(list[2].url, 'https://x/truck.glb')
  assert.equal(list[2].highestPoint, 1.794)
  assert.deepEqual(ready.listMissing(), [])
})

test('sameSlugSet 认名单变化', () => {
  assert.equal(ready.sameSlugSet([{ slug: 'musk' }, { slug: 'astro' }], [{ slug: 'astro' }, { slug: 'musk' }]), true)
  assert.equal(
    ready.sameSlugSet([{ slug: 'musk' }, { slug: 'astro' }], [{ slug: 'musk' }, { slug: 'astro' }, { slug: 'cyber-pickup' }]),
    false
  )
})

test('listEnabled 顺序 musk → astro → cyber-pickup，只收已启用', () => {
  ready.ingest({
    ipScaleRefs: {
      astro: { url: 'https://x/astro.glb', highestPoint: 1.88, enabled: true },
      musk: { url: 'https://x/musk.glb', highestPoint: 1.88, enabled: true },
      'cyber-pickup': { url: 'https://x/truck.glb', highestPoint: 1.794, lengthM: 5.683, widthM: 2.032, enabled: true },
      other: { url: 'https://x/no.glb', highestPoint: 1.88, enabled: true }
    }
  })
  const list = ready.listEnabled()
  assert.deepEqual(list.map((item) => item.slug), ['musk', 'astro', 'cyber-pickup'])
  assert.equal(list[0].highestPoint, 1.88)
  assert.equal(list[2].lengthM, 5.683)
  assert.equal(list[2].widthM, 2.032)
})

test('extractFromMediaMap 只认 models/reference', () => {
  const out = ready.extractFromMediaMap(
    {
      'models/reference/musk.glb': 'https://x/musk.glb',
      'models/rockets/falcon-9.glb': 'https://x/f9.glb'
    },
    { musk: { highestPoint: 2.05 } }
  )
  assert.equal(out.musk.highestPoint, 2.05)
  assert.equal(out.astro, undefined)
})

test('extractFromMediaMap 认赛博皮卡并带长宽', () => {
  const out = ready.extractFromMediaMap(
    {
      'models/reference/cyber-pickup.glb': 'https://x/truck.glb'
    },
    { 'cyber-pickup': { highestPoint: 1.794, lengthM: 5.683, widthM: 2.032 } }
  )
  assert.equal(out['cyber-pickup'].highestPoint, 1.794)
  assert.equal(out['cyber-pickup'].lengthM, 5.683)
  assert.equal(out['cyber-pickup'].widthM, 2.032)
})
