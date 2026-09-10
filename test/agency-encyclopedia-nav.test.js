/**
 * node --test test/agency-encyclopedia-nav.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildEncyclopediaAgencyParams, pickAgencyId } = require('../subpackages/monitor-pages/utils/booster-nav.js')

const ROOT = path.join(__dirname, '..')

test('入口 agencyId 只回 id，忽略名称和缩写', () => {
  assert.deepEqual(
    buildEncyclopediaAgencyParams({
      agencyId: '88',
      abbrev: 'CALT',
      name: 'China Academy of Launch Vehicle Technology'
    }),
    { id: '88' }
  )
})

test('构型 manufacturer.id 只回 id，不对 CALT 名称改写成 CASC', () => {
  assert.deepEqual(
    buildEncyclopediaAgencyParams({
      id: '17',
      abbrev: 'CALT',
      name: 'China Academy of Launch Vehicle Technology',
      rocketNameEn: 'Long March 5'
    }),
    { id: '17' }
  )
})

test('没有 id 时不按名称/火箭名对号入座', () => {
  assert.equal(
    buildEncyclopediaAgencyParams({
      abbrev: 'CALT',
      name: 'China Academy of Launch Vehicle Technology',
      rocketNameEn: 'Long March 5',
      rocketName: '长征五号'
    }),
    null
  )
  assert.equal(buildEncyclopediaAgencyParams({ abbrev: 'SpX', name: 'SpaceX' }), null)
  assert.equal(buildEncyclopediaAgencyParams({}), null)
  assert.equal(buildEncyclopediaAgencyParams(null), null)
})

test('pickAgencyId 丢掉空值和脏字符串', () => {
  assert.equal(pickAgencyId(88), '88')
  assert.equal(pickAgencyId(' 121 '), '121')
  assert.equal(pickAgencyId(''), '')
  assert.equal(pickAgencyId(null), '')
  assert.equal(pickAgencyId('null'), '')
})

test('图鉴火箭/飞船标签按 LL2 id 列出，不按名称合并', () => {
  const js = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/agency-detail.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/agency-detail.wxml'), 'utf8')
  assert.doesNotMatch(js, /byName\[nameEn\]/)
  assert.doesNotMatch(js, /seen\[entry\.name\]/)
  assert.match(js, /seenLauncherIds/)
  assert.match(js, /spacecraftRawById\[idKey\]/)
  assert.match(wxml, /wx:key="archiveId"/)
  assert.match(wxml, /wx:for="\{\{item\.spacecraftList\}\}" wx:key="id"/)
})
