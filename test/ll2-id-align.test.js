/**
 * LL2 有 id 时禁止名称回落
 * node --test test/ll2-id-align.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

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
  }
}

const { launchMatchesAgencyFilter } = require('../cloudfunctions/getLaunchStats/launch-match.js')
const { matchLaunchAgency } = require('../subpackages/monitor-pages/utils/agency-launch-cards.js')
const { resolveFavoriteUrl } = require('../utils/favorites.js')
const {
  collectRocketModelsFromMissions,
  mergeRocketModels
} = require('../pages/search/index-search-engine.js')
const { buildCurrentLaunchPanelState } = require('../utils/index-launch-state.js')
const { slimMissionForCountdownBoot } = require('../pages/index/utils/index-countdown-boot.js')
const { methods: settledMergeMethods } = require('../pages/index/utils/index-settled-merge.js')
const { buildSpecCard } = require('../subpackages/shared/utils/ai-chat-rich.js')

function launch(id, name) {
  return { launch_service_provider: { id, name } }
}

test('年内机构计数：有 launchAgencyId 不按名称误算 CALT 进 CASC', () => {
  const mission = { launchAgency: 'CASC', launchAgencyId: 88 }
  assert.equal(launchMatchesAgencyFilter(launch(88, 'CASC'), mission), true)
  assert.equal(launchMatchesAgencyFilter(launch(17, 'CASC'), mission), false)
  assert.equal(launchMatchesAgencyFilter(launch(17, 'CALT'), mission), false)
  assert.equal(launchMatchesAgencyFilter(launch(88, 'China Aerospace Science and Technology Corporation'), mission), true)
})

test('年内机构计数：无 id 才按名称兜底', () => {
  const mission = { launchAgency: 'SpaceX' }
  assert.equal(launchMatchesAgencyFilter(launch(121, 'SpaceX'), mission), true)
  assert.equal(launchMatchesAgencyFilter(launch(147, 'Rocket Lab'), mission), false)
})

test('图鉴任务列表：有机构 id 不再用缩写兜底', () => {
  assert.equal(matchLaunchAgency({ launchAgencyId: 88, launchAgencyAbbrev: 'CASC' }, { id: 88, abbrev: 'CASC' }), true)
  assert.equal(matchLaunchAgency({ launchAgencyId: 17, launchAgencyAbbrev: 'CASC' }, { id: 88, abbrev: 'CASC' }), false)
  assert.equal(matchLaunchAgency({ launchAgencyAbbrev: 'CASC' }, { id: 88, abbrev: 'CASC' }), false)
  assert.equal(matchLaunchAgency({ launchAgencyAbbrev: 'CASC' }, { abbrev: 'CASC' }), true)
})

test('收藏助推器打开时带上 extra.ll2Id', () => {
  const url = resolveFavoriteUrl({
    type: 'booster',
    id: 'B1062',
    extra: { ll2Id: '4018' }
  })
  assert.match(url, /serial=B1062/)
  assert.match(url, /ll2Id=4018/)
  const old = resolveFavoriteUrl({ type: 'booster', id: 'B1062' })
  assert.match(old, /serial=B1062/)
  assert.doesNotMatch(old, /ll2Id=/)
})

test('搜索型号：任务没有构型 id 不进型号结果', () => {
  assert.equal(collectRocketModelsFromMissions([{ rocketName: 'Falcon 9', rocketNameEn: 'Falcon 9' }], []).length, 0)
  assert.equal(mergeRocketModels([{ name: 'Falcon 9', nameEn: 'Falcon 9' }], []).length, 0)
  const kept = collectRocketModelsFromMissions([{ rocketName: 'Falcon 9', rocketConfigId: 164 }], [])
  assert.equal(kept.length, 1)
  assert.equal(String(kept[0].configId), '164')
})

test('首页面板：列表 padLocationId / 构型 id 传到 launchData', () => {
  const state = buildCurrentLaunchPanelState({
    mission: {
      id: 'x',
      padLocationId: 12,
      launchAgencyId: 121,
      rocketConfigId: 164,
      launchSite: 'Cape Canaveral'
    },
    formatDate: () => '',
    getStatusTextZh: () => '计划中'
  })
  assert.equal(state.launchData.padLocationId, 12)
  assert.equal(state.launchData.launchAgencyId, 121)
  assert.equal(String(state.launchData.rocketConfigId), '164')
})

test('倒计时引导快照：保留构型 id、发射场 location id、发射商 id', () => {
  const slim = slimMissionForCountdownBoot({
    id: 'x',
    launchAgencyId: 121,
    rocketConfigId: 164,
    padLocationId: 12,
    padDetail: { locationId: 99 }
  })
  assert.equal(slim.launchAgencyId, 121)
  assert.equal(slim.rocketConfigId, 164)
  assert.equal(slim.padLocationId, 12)
})

test('详情合并：id 不走占位文案判断，数字 id 不会被丢掉', () => {
  const out = settledMergeMethods._pickDetailDisplayFields({
    launchAgencyId: 121,
    rocketConfigId: 164,
    padLocationId: 12,
    rocketName: '-'
  })
  assert.equal(out.launchAgencyId, 121)
  assert.equal(out.rocketConfigId, 164)
  assert.equal(out.padLocationId, 12)
  assert.equal(out.rocketName, undefined)
  const empty = settledMergeMethods._pickDetailDisplayFields({
    launchAgencyId: '',
    rocketConfigId: '  ',
    padLocationId: null
  })
  assert.equal(empty.launchAgencyId, undefined)
  assert.equal(empty.rocketConfigId, undefined)
  assert.equal(empty.padLocationId, undefined)
})

test('星问助推器参数卡保留 targetLl2Id', () => {
  const card = buildSpecCard({
    specKind: 'booster',
    targetId: 'B1062',
    targetLl2Id: 4018,
    title: 'B1062'
  })
  assert.equal(card.targetId, 'B1062')
  assert.equal(card.targetLl2Id, '4018')
  const old = buildSpecCard({ specKind: 'booster', targetId: 'B1062', title: 'B1062' })
  assert.equal(old.targetLl2Id, '')
})

