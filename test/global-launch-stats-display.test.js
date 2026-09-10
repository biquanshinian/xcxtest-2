/**
 * node --test test/global-launch-stats-display.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync() { return '' },
  setStorageSync() {},
  setStorage() {},
  getStorage() {},
  removeStorage() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no file') },
      mkdirSync() {},
      unlink() {},
      unlinkSync() {},
      readdirSync() { return [] }
    }
  },
  getNetworkType(o) { o && o.success && o.success({ networkType: 'wifi' }) },
  downloadFile(o) { o && o.fail && o.fail(new Error('mock')) },
  getImageInfo() {},
  cloud: null
}

const {
  decorateAgencyRows,
  decorateRocketRows,
  isUnknownRankName,
  aggregateLaunchStats
} = require('../subpackages/index-extra/utils/global-launch-stats.js')

const ROOT = path.join(__dirname, '..')

test('机构排行走发射商图鉴同一条汉化，不回落未译英文全称', () => {
  const rows = decorateAgencyRows([
    { key: 'casc', name: 'China Aerospace Science and Technology Corporation', total: 42 },
    { key: 'cas', name: 'CAS Space', total: 5 },
    { key: 'spacex', name: 'SpaceX', total: 106 },
    { key: 'rl', name: 'Rocket Lab', total: 15 }
  ])
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
  assert.equal(byName['China Aerospace Science and Technology Corporation'].displayName, '中国航天科技集团')
  assert.equal(byName['CAS Space'].displayName, '中科宇航')
  assert.equal(byName['SpaceX'].displayName, 'SpaceX')
  assert.equal(byName['Rocket Lab'].displayName, '火箭实验室')
  assert.notEqual(byName['China Aerospace Science and Technology Corporation'].displayName, byName['China Aerospace Science and Technology Corporation'].name)
})

test('机构行补 logo 映射时带上缩写，展示名仍走词典；id 只认聚合行上的 agencyId', () => {
  const map = new Map()
  map.set('china aerospace science and technology corporation', {
    url: 'https://example.com/casc.png',
    id: '88',
    abbrev: 'CASC',
    name: 'China Aerospace Science and Technology Corporation',
    nameZh: ''
  })
  const [row] = decorateAgencyRows([
    { key: 'casc', name: 'China Aerospace Science and Technology Corporation', total: 42 }
  ], map)
  assert.equal(row.displayName, '中国航天科技集团')
  assert.equal(row.agencyId, '')
  assert.equal(row.agencyAbbrev, 'CASC')
  assert.equal(row.clickable, true)
  assert.match(row.logo, /casc\.png/)

  const [withId] = decorateAgencyRows([
    { key: 'casc', name: 'China Aerospace Science and Technology Corporation', total: 42, agencyId: 88 }
  ], map)
  assert.equal(withId.agencyId, '88')
  assert.equal(withId.clickable, true)
})

test('未知机构不可点；火箭名走列表卡同一套汉化', () => {
  assert.equal(isUnknownRankName('未知机构'), true)
  assert.equal(isUnknownRankName('Falcon 9'), false)
  const [unknown] = decorateAgencyRows([{ key: 'x', name: '未知机构', total: 1 }])
  assert.equal(unknown.clickable, false)
  const rockets = decorateRocketRows([
    { key: 'f9', name: 'Falcon 9', total: 90, configId: '164' },
    { key: 'cz2d', name: 'Long March 2D', total: 8, configId: '215' },
    { key: 'unk', name: '未知型号', total: 1 },
    { key: 'f9old', name: 'Falcon 9', total: 3 }
  ])
  assert.equal(rockets[0].displayName, '猎鹰9号')
  assert.match(rockets[1].displayName, /长征/)
  assert.equal(rockets[0].clickable, true)
  assert.equal(rockets[2].clickable, false)
  assert.equal(rockets[3].configId, '')
  assert.equal(rockets[3].clickable, true)
})

test('聚合行带上出现最多的机构/构型 id，不按名称改 key', () => {
  const agg = aggregateLaunchStats([
    { launchTime: '2026-01-02T00:00:00Z', launchAgency: 'CASC', launchAgencyId: 88, rocketName: 'Falcon 9', rocketConfigId: 164, success: true },
    { launchTime: '2026-01-03T00:00:00Z', launchAgency: 'CASC', launchAgencyId: 88, rocketName: 'Falcon 9', rocketConfigId: 164, success: true },
    { launchTime: '2026-01-04T00:00:00Z', launchAgency: 'CASC', launchAgencyId: 88, rocketName: 'Falcon 9', rocketConfigId: 90, success: true }
  ])
  assert.equal(agg.byAgency[0].agencyId, '88')
  assert.equal(agg.byRocket[0].name, 'Falcon 9')
  assert.equal(agg.byRocket[0].configId, '164')
  assert.equal(agg.byRocket[0].total, 3)
})

test('全球发射统计页：机构/型号可点，路由走统一详情，不引入评分逻辑', () => {
  const page = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/global-launch-stats.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/global-launch-stats.wxml'), 'utf8')
  const util = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/global-launch-stats.js'), 'utf8')
  assert.match(util, /resolveAgencyDisplayZh\(row\.name/)
  assert.match(util, /translateRocketName/)
  assert.match(page, /onTapAgencyRank/)
  assert.match(page, /onTapRocketRank/)
  assert.match(page, /ROUTES\.AGENCY_DETAIL/)
  assert.match(page, /openRocketModelDetail/)
  assert.match(page, /pickLatestRocketConfig/)
  assert.match(page, /afterGate:\s*true/)
  assert.match(page, /params\.name = name/)
  assert.match(page, /params\.id = agencyId/)
  assert.doesNotMatch(page, /matchRocketConfigByName/)
  assert.doesNotMatch(util, /matchRocketConfigByName/)
  assert.match(util, /getRocketImage\(row\.name\)/)
  assert.doesNotMatch(util, /resolveRocketImageByConfig/)
  assert.doesNotMatch(page, /rocket-score/)
  assert.doesNotMatch(page, /ROCKET_SCORE/)
  assert.match(wxml, /bindtap="onTapAgencyRank"/)
  assert.match(wxml, /bindtap="onTapRocketRank"/)
  assert.match(wxml, /item\.displayName \|\| item\.name/)
  assert.doesNotMatch(wxml, /exhibit\.title \|\| pickerTitle/)
})
