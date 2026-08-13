/**
 * 图鉴中英搜索 / chip 补齐 / 图片兜底（族谱页 + 发射场分布页共用）
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeGalleryQuery,
  joinSearchText,
  matchGalleryQuery,
  filterCardsByKeyword,
  ensureActiveChip,
  isKnownGenealogyFilter,
  isKnownSpacecraftFilter,
  findCardIndexByKey,
  advanceCardImage,
  pickPatchValue,
  sortByFlightsOrRecent
} = require('../subpackages/monitor-pages/utils/gallery-search.js')

test('normalizeGalleryQuery：中文数字与甲乙、去号、去空格', () => {
  assert.equal(normalizeGalleryQuery('长征八号甲'), '长征8a')
  assert.equal(normalizeGalleryQuery('长征 8 号 A'), '长征8a')
  assert.equal(normalizeGalleryQuery('CZ-7A'), 'cz7a')
  assert.equal(normalizeGalleryQuery('Falcon 9'), 'falcon9')
  assert.equal(normalizeGalleryQuery('猎鹰9号'), '猎鹰9')
})

test('matchGalleryQuery：英汉双向命中，不跨字段误拼', () => {
  const rocket = joinSearchText(['猎鹰9号', 'Falcon 9', 'SpaceX', '蓝色起源'])
  assert.equal(matchGalleryQuery(rocket, '猎鹰'), true)
  assert.equal(matchGalleryQuery(rocket, 'Falcon 9'), true)
  assert.equal(matchGalleryQuery(rocket, 'falcon9'), true)
  assert.equal(matchGalleryQuery(rocket, '蓝色起源'), true)
  assert.equal(matchGalleryQuery(rocket, '9s'), false)
})

test('matchGalleryQuery：长征中英与 CZ 代号', () => {
  const cz8 = joinSearchText(['长征八号甲', 'Long March 8A', 'cz8a', 'CZ-8A'])
  assert.equal(matchGalleryQuery(cz8, '长征8号甲'), true)
  assert.equal(matchGalleryQuery(cz8, 'long march 8a'), true)
  assert.equal(matchGalleryQuery(cz8, 'CZ-8A'), true)

  const cz7 = joinSearchText(['长征七号改', 'Long March 7A', 'cz7a', 'CZ-7A'])
  assert.equal(matchGalleryQuery(cz7, '长征7号改'), true)
  assert.equal(matchGalleryQuery(cz7, 'CZ-7A'), true)
})

test('filterCardsByKeyword：型号/厂商/发射场中英都能命中', () => {
  const cards = [
    { searchText: joinSearchText(['猎鹰9号', 'Falcon 9', 'SpaceX']) },
    { searchText: joinSearchText(['新格伦', 'New Glenn', '蓝色起源', 'Blue Origin']) },
    { searchText: joinSearchText(['文昌航天发射场', 'Wenchang Space Launch Site', '中国', 'China', '文昌']) }
  ]
  assert.equal(filterCardsByKeyword(cards, 'falcon').length, 1)
  assert.equal(filterCardsByKeyword(cards, '猎鹰9').length, 1)
  assert.equal(filterCardsByKeyword(cards, '蓝色起源').length, 1)
  assert.equal(filterCardsByKeyword(cards, 'Blue Origin').length, 1)
  assert.equal(filterCardsByKeyword(cards, '文昌').length, 1)
  assert.equal(filterCardsByKeyword(cards, 'Wenchang').length, 1)
  assert.equal(filterCardsByKeyword(cards, '').length, 3)
})

test('ensureActiveChip：分享/点国家标签时补上当前筛选胶囊', () => {
  const chips = [{ id: 'all', label: '全部' }, { id: 'reusable', label: '可复用' }]
  const next = ensureActiveChip(chips, 'mfr:SpaceX', { id: 'mfr:SpaceX', label: 'SpaceX' })
  assert.equal(next.length, 3)
  assert.equal(next[2].id, 'mfr:SpaceX')
  assert.equal(ensureActiveChip(chips, 'reusable').length, 2)
  assert.equal(isKnownGenealogyFilter('reusable'), true)
  assert.equal(isKnownGenealogyFilter('expendable'), true)
  assert.equal(isKnownGenealogyFilter('country:CN'), true)
  assert.equal(isKnownSpacecraftFilter('inuse'), true)
  assert.equal(isKnownSpacecraftFilter('type:Capsule'), true)
  assert.equal(isKnownSpacecraftFilter('agency:NASA'), true)
})

test('advanceCardImage + findCardIndexByKey：按稳定 id 推进兜底链', () => {
  const card = { serial: 'B1067', thumbnailUrl: 'a.jpg', imageUrl: 'a.jpg', imageFallbacks: ['b.jpg', 'c.jpg'] }
  const list = [card]
  assert.equal(findCardIndexByKey(list, 'serial', 'B1067'), 0)
  assert.equal(advanceCardImage(card), true)
  assert.equal(card.thumbnailUrl, 'b.jpg')
  assert.deepEqual(card.imageFallbacks, ['c.jpg'])
})

test('pickPatchValue：允许显式空字符串（清空搜索）', () => {
  assert.equal(pickPatchValue({ keyword: '' }, 'keyword', 'Falcon'), '')
  assert.equal(pickPatchValue({ filter: 'reusable' }, 'keyword', 'Falcon'), 'Falcon')
})

test('sortByFlightsOrRecent：飞行次数与最近飞行都真正换序', () => {
  const rows = [
    { id: 'a', flights: 2, lastFlight: '2020-01-01' },
    { id: 'b', flights: 10, lastFlight: '2019-01-01' },
    { id: 'c', flights: 5, lastFlight: '2024-06-01' }
  ]
  const byFlights = sortByFlightsOrRecent(rows, 'flights', 'flights', 'lastFlight')
  assert.deepEqual(byFlights.map((r) => r.id), ['b', 'c', 'a'])
  const byRecent = sortByFlightsOrRecent(rows, 'recent', 'flights', 'lastFlight')
  assert.deepEqual(byRecent.map((r) => r.id), ['c', 'a', 'b'])
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c'])
})
