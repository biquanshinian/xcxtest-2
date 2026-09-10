/**
 * node --test cloudfunctions/syncSpaceDevsData/config-meta-catalog.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const catalog = require('./config-meta-catalog.js')

test('构型清单 URL 不带 reusable，页数够翻完全量', () => {
  assert.match(catalog.configListUrl(), /is_placeholder=false/)
  assert.match(catalog.configListUrl(), /mode=detailed/)
  assert.doesNotMatch(catalog.configListUrl(), /reusable=/)
  assert.ok(catalog.CONFIG_LIST_PAGE_LIMIT * catalog.CONFIG_LIST_PAGE_SIZE >= 700)
  assert.ok(catalog.CONFIG_LIST_MIN_COUNT >= 480)
})

test('档案不足才翻全表，够了不因时间到了重拉', () => {
  const now = 1_000_000
  const ttl = 24 * 60 * 60 * 1000
  const partial = {}
  for (let i = 0; i < 300; i++) partial[String(i)] = { id: i }
  assert.equal(catalog.catalogNeedsFullRefresh(partial), true)
  const full = {}
  for (let i = 0; i < 500; i++) full[String(i)] = { id: i }
  assert.equal(catalog.catalogNeedsFullRefresh(full), false)
  assert.equal(catalog.catalogNeedsFullRefresh(full, { fillCatalog: true }), true)
  assert.equal(catalog.shouldFetchExistingConfig({ fetchedAt: now - 1000 }, now, ttl), false)
  assert.equal(catalog.shouldFetchExistingConfig({ fetchedAt: now - ttl - 1 }, now, ttl), true)
  assert.equal(catalog.shouldFetchExistingConfig(null, now, ttl), true)
})

test('构型只有实质字段变了才算更新', () => {
  const a = { id: 1, name: 'Falcon 9', total_launch_count: 400, fetchedAt: 1, nameZh: '猎鹰9号' }
  const same = { id: 1, name: 'Falcon 9', total_launch_count: 400, fetchedAt: 9, nameZh: '猎鹰 9' }
  const bumped = { id: 1, name: 'Falcon 9', total_launch_count: 401, fetchedAt: 9, nameZh: '猎鹰9号' }
  assert.equal(catalog.configRecordChanged(a, same), false)
  assert.equal(catalog.configRecordChanged(a, bumped), true)
  assert.equal(catalog.configRecordChanged(null, bumped), true)
})

test('发射 / 机构列表收集构型 id，不看 reusable', () => {
  assert.deepEqual(catalog.collectConfigIdsFromLaunches([
    { rocket: { configuration: { id: 491, reusable: false } } },
    { rocket: { configuration: { id: 164, reusable: true } } },
    { rocket: { configuration: { id: 491 } } },
    { rocket: {} }
  ]), [491, 164])
  assert.deepEqual(catalog.collectConfigIdsFromAgencies([
    { launcher_list: [{ id: 491, name: 'Spectrum' }, { id: 215, name: 'Long March 5' }] },
    { launcher_list: [{ name: 'no-id' }] }
  ]), [491, 215])
})

test('简介截断避免 _config_meta 超文档上限', () => {
  assert.equal(catalog.truncateConfigDescription('短'), '短')
  assert.equal(catalog.truncateConfigDescription('x'.repeat(800)).length, catalog.CONFIG_DESC_MAX_LEN)
})
