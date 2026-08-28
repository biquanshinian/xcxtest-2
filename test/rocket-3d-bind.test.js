/**
 * node --test test/rocket-3d-bind.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { ingestMediaMap } = require('../utils/rocket-3d-ready.js')
const {
  alignDedicatedRocket3d,
  pickAlignedSlug,
  pickExhibitConfig,
  buildRocket3dNavUrl
} = require('../subpackages/monitor-pages/utils/rocket-3d-bind.js')

const COS = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/'

function seedDedicated(slugs) {
  const map = {}
  slugs.forEach((slug) => {
    map['models/rockets/' + slug + '.glb'] = COS + slug + '.glb'
  })
  ingestMediaMap(map)
}

test('pickAlignedSlug：近邻型号选名称里更贴的那个', () => {
  assert.equal(
    pickAlignedSlug(['falcon-9', 'falcon-heavy'], ['Falcon Heavy', '猎鹰重型']),
    'falcon-heavy'
  )
  assert.equal(
    pickAlignedSlug(['long-march-5', 'long-march-5b'], ['Long March 5B', '长征五号乙']),
    'long-march-5b'
  )
  assert.equal(pickAlignedSlug(['falcon-9'], ['Falcon 9']), 'falcon-9')
})

test('族谱对齐：猎鹰 9 / 重型各绑各的，不串位', () => {
  seedDedicated(['falcon-9', 'falcon-heavy'])
  try {
    const f9 = alignDedicatedRocket3d({
      fullNameEn: 'Falcon 9 Block 5',
      nameEn: 'Falcon 9',
      fullName: '猎鹰9号 Block 5',
      name: '猎鹰9号'
    })
    assert.equal(f9.aligned, true)
    assert.equal(f9.slug, 'falcon-9')
    assert.match(f9.url, /falcon-9\.glb/)

    const fh = alignDedicatedRocket3d({
      fullNameEn: 'Falcon Heavy',
      nameEn: 'Falcon Heavy',
      fullName: '猎鹰重型',
      name: '猎鹰重型'
    })
    assert.equal(fh.aligned, true)
    assert.equal(fh.slug, 'falcon-heavy')
    assert.match(fh.url, /falcon-heavy\.glb/)
    assert.notEqual(f9.url, fh.url)
  } finally {
    ingestMediaMap({})
  }
})

test('族谱对齐：长五 / 长五 B 各绑专用模型', () => {
  seedDedicated(['long-march-5', 'long-march-5b', 'long-march-series'])
  try {
    const cz5 = alignDedicatedRocket3d({
      fullNameEn: 'Long March 5',
      nameEn: 'Long March 5',
      fullName: '长征五号'
    })
    assert.equal(cz5.slug, 'long-march-5')
    const cz5b = alignDedicatedRocket3d({
      fullNameEn: 'Long March 5B',
      nameEn: 'Long March 5B',
      fullName: '长征五号乙'
    })
    assert.equal(cz5b.slug, 'long-march-5b')
  } finally {
    ingestMediaMap({})
  }
})

test('族谱对齐：只有全系列底模时不出入口，避免串到展板', () => {
  seedDedicated(['long-march-series'])
  try {
    const cz8 = alignDedicatedRocket3d({
      fullNameEn: 'Long March 8A',
      nameEn: 'Long March 8A',
      fullName: '长征八号甲'
    })
    assert.equal(cz8.aligned, false)
    assert.equal(cz8.url, '')
    assert.equal(cz8.slug, '')
  } finally {
    ingestMediaMap({})
  }
})

test('族谱对齐：官方英文优先，别名不能把猎鹰9串到重型', () => {
  seedDedicated(['falcon-9', 'falcon-heavy'])
  try {
    const f9 = alignDedicatedRocket3d({
      fullNameEn: 'Falcon 9 Block 5',
      nameEn: 'Falcon 9',
      alias: 'Falcon Heavy'
    })
    assert.equal(f9.aligned, true)
    assert.equal(f9.slug, 'falcon-9')
    assert.match(f9.url, /falcon-9\.glb/)
  } finally {
    ingestMediaMap({})
  }
})

test('族谱对齐：空输入不抛错、不对齐', () => {
  assert.doesNotThrow(() => alignDedicatedRocket3d(null))
  assert.equal(alignDedicatedRocket3d(null).aligned, false)
  assert.equal(alignDedicatedRocket3d({}).aligned, false)
})

test('族谱对齐：本型号无专用 GLB 时不借用近邻', () => {
  seedDedicated(['falcon-9', 'starship'])
  try {
    const fh = alignDedicatedRocket3d({
      fullNameEn: 'Falcon Heavy',
      nameEn: 'Falcon Heavy'
    })
    assert.equal(fh.aligned, false)
    const electron = alignDedicatedRocket3d({
      fullNameEn: 'Electron',
      nameEn: 'Electron'
    })
    assert.equal(electron.aligned, false)
  } finally {
    ingestMediaMap({})
  }
})

test('族谱对齐：星舰 / Super Heavy 共用 starship 专用模，不落到别的箭', () => {
  seedDedicated(['starship', 'falcon-9'])
  try {
    const ship = alignDedicatedRocket3d({
      fullNameEn: 'Starship',
      nameEn: 'Starship',
      fullName: '星舰'
    })
    assert.equal(ship.slug, 'starship')
    const booster = alignDedicatedRocket3d({
      fullNameEn: 'Super Heavy',
      nameEn: 'Super Heavy',
      fullName: '超重助推器'
    })
    assert.equal(booster.slug, 'starship')
  } finally {
    ingestMediaMap({})
  }
})

test('pickExhibitConfig：只保留展陈规格，丢掉无关字段', () => {
  const picked = pickExhibitConfig({
    id: 11,
    name: 'Starship',
    length: 124.4,
    launch_mass: 5250,
    wiki_url: 'https://example.com',
    rawDump: { huge: true }
  })
  assert.equal(picked.id, 11)
  assert.equal(picked.length, 124.4)
  assert.equal(picked.wiki_url, undefined)
  assert.equal(picked.rawDump, undefined)
  assert.equal(pickExhibitConfig(null), null)
})

test('buildRocket3dNavUrl：带上 pinned slug，避免展陈页按名字重解析串位', () => {
  const url = buildRocket3dNavUrl(
    { aligned: true, slug: 'falcon-heavy', url: COS + 'falcon-heavy.glb', label: '猎鹰重型' },
    { rocketName: '猎鹰重型', rocketNameEn: 'Falcon Heavy', configId: 136 }
  )
  assert.match(url, /slug=falcon-heavy/)
  assert.match(url, /modelUrl=/)
  assert.match(url, /falcon-heavy\.glb/)
  assert.match(url, /configId=136/)
  assert.doesNotMatch(url, /falcon-9/)
})
