/**
 * node --test test/search-rocket-model.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildSearchResults,
  getRocketModelSearchDocument,
  collectRocketModelsFromMissions,
  collectRocketModelsFromConfigs,
  mergeRocketModels
} = require('../pages/search/index-search-engine.js')

const ROOT = path.join(__dirname, '..')

test('任务列表能抽出型号，且 config 目录优先去重', () => {
  const fromMissions = collectRocketModelsFromMissions([
    { rocketName: 'Falcon 9', rocketNameEn: 'Falcon 9', rocketConfigId: 164, launchAgency: 'SpaceX' },
    { rocketName: 'Falcon 9', rocketConfigId: 164, launchAgency: 'SpaceX' }
  ], [])
  assert.equal(fromMissions.length, 1)
  assert.equal(String(fromMissions[0].configId), '164')
  assert.equal(collectRocketModelsFromMissions([{ rocketName: '未知火箭' }], []).length, 0)
  assert.equal(collectRocketModelsFromMissions([{ rocketName: 'Falcon 9', rocketNameEn: 'Falcon 9' }], []).length, 0)

  const fromConfigs = collectRocketModelsFromConfigs({
    164: { id: 164, name: 'Falcon 9', nameZh: '猎鹰 9', manufacturerName: 'SpaceX' }
  })
  const merged = mergeRocketModels(fromConfigs, fromMissions)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].name, '猎鹰 9')
})

test('搜索分组含火箭型号，点击字段带 configId', () => {
  const payload = buildSearchResults({
    queryInfo: { normalizedQuery: 'falcon9', tokens: ['falcon9'], expandedTerms: ['falcon 9', 'falcon9'] },
    upcomingMissions: [],
    completedMissions: [],
    agencies: [],
    rocketModels: [{
      configId: '164',
      name: '猎鹰 9',
      nameEn: 'Falcon 9',
      manufacturer: 'SpaceX',
      manufacturerAbbrev: 'SpX'
    }]
  })
  const group = payload.groups.find((g) => g.key === 'rocket_model')
  assert.ok(group, '应有火箭型号分组')
  assert.equal(group.items[0]._type, 'rocket_model')
  assert.equal(String(group.items[0].configId), '164')
  assert.equal(group.items[0]._searchHint, '火箭型号')
  assert.match(group.items[0]._wxkey, /^rocket_model_/)
})

test('型号搜索文档可被中文名命中', () => {
  const doc = getRocketModelSearchDocument({
    configId: '164',
    name: '猎鹰 9',
    nameEn: 'Falcon 9',
    manufacturer: 'SpaceX'
  })
  assert.equal(doc.type, 'rocket_model')
  assert.match(doc.fields.missionName, /猎鹰/)
})

test('搜索页不 afterGate 预拉目录，点击才门控进型号详情', () => {
  const page = fs.readFileSync(path.join(ROOT, 'pages/search/search.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/search/search.wxml'), 'utf8')
  assert.match(page, /_loadRocketModelsForSearch/)
  assert.match(page, /getRocketConfigMeta\(\)/)
  assert.doesNotMatch(page, /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)[\s\S]{0,80}_loadRocketModelsForSearch/)
  assert.match(page, /type === 'rocket_model'/)
  assert.match(page, /gateCheck\('booster_genealogy'/)
  assert.match(page, /ROUTES\.ROCKET_MODEL_DETAIL/)
  assert.doesNotMatch(page, /matchRocketConfigByName/)
  assert.doesNotMatch(page, /rocket-score|openRocketScore|buildScoreView/)
  assert.doesNotMatch(page, /index-extra/)
  assert.match(wxml, /data-type="\{\{result\._type\}\}"/)
  assert.match(wxml, /data-config-id="\{\{result\.configId\}\}"/)
})
