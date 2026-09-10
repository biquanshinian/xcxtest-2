/**
 * 档案指数 / 3D / 航警 / 嵌套标签：实体名可点进图鉴。
 * node --test test/entity-route-links.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

test('档案指数机构名进发射商详情', () => {
  const js = read('subpackages/monitor-pages/rocket-score.js')
  const wxml = read('subpackages/monitor-pages/rocket-score.wxml')
  assert.match(js, /onTapManufacturer/)
  assert.match(js, /manufacturerAbbrev/)
  assert.match(js, /openEncyclopediaAgency/)
  assert.match(wxml, /catchtap="onTapManufacturer"/)
})

test('3D 展陈档案名有 configId 才进型号详情', () => {
  const js = read('subpackages/rocket-3d/viewer.js')
  const wxml = read('subpackages/rocket-3d/viewer.wxml')
  assert.match(js, /onTapExhibitTitle/)
  assert.match(js, /ROUTES\.ROCKET_MODEL_DETAIL/)
  assert.match(js, /_resolveExhibitConfigId/)
  assert.match(js, /configId: seriesModel \? '' : \(matchedId \|\| that\.data\.configId/)
  assert.match(wxml, /catchtap="onTapExhibitTitle"/)
  assert.match(wxml, /configId && !exhibit\.series \? 'r3d-exhibit-title--link'/)
  const wxss = read('subpackages/rocket-3d/viewer.wxss')
  assert.match(wxss, /\.r3d-exhibit-title\s*\{[^}]*pointer-events:\s*auto/)
  assert.doesNotMatch(js, /monitor-pages/)
})

test('空间航警火箭名芯片不改整卡进地图', () => {
  const js = read('subpackages/monitor-pages/space-notices/entry-list.js')
  const wxml = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
  assert.match(js, /onTapRocketName/)
  assert.doesNotMatch(js, /matchRocketConfigByName/)
  assert.match(js, /openRocketModelDetail/)
  const fn = js.slice(js.indexOf('async onTapRocketName'))
  assert.match(fn, /gateCheck\('booster_genealogy'/)
  assert.doesNotMatch(fn, /getRocketConfigMeta/)
  assert.match(fn, /cleanConfigId\(ds\.configId\)/)
  assert.match(wxml, /bindtap="openMap"/)
  assert.match(wxml, /catchtap="onTapRocketName"/)
  assert.match(wxml, /item\.rocketClickable/)
})

test('嵌套标签 catchtap，整卡主跳转仍在', () => {
  const geneWxml = read('subpackages/monitor-pages/booster-genealogy.wxml')
  const geneJs = read('subpackages/monitor-pages/booster-genealogy.js')
  assert.match(geneWxml, /bindtap="onModelCardTap"/)
  assert.match(geneWxml, /catchtap="onTapModelManufacturer"/)
  assert.match(geneJs, /onTapModelManufacturer/)
  assert.match(geneJs, /openEncyclopediaAgency/)

  const galWxml = read('subpackages/monitor-pages/components/monitor-galleries/index.wxml')
  const galJs = read('subpackages/monitor-pages/utils/monitor-galleries.js')
  const monitor = read('pages/monitor/monitor.js')
  assert.match(galWxml, /bindtap="emitOnBoosterCardTap"/)
  assert.match(galWxml, /catchtap="emitOnBoosterFamilyTap"/)
  assert.match(galWxml, /emitOnBoosterManufacturerTap/)
  assert.match(galJs, /onBoosterFamilyTap/)
  assert.match(galJs, /openRocketModelDetail/)
  assert.match(galJs, /onBoosterManufacturerTap/)
  assert.match(monitor, /onBoosterFamilyTap/)
  assert.match(monitor, /onBoosterManufacturerTap/)

  const stationWxml = read('subpackages/monitor-pages/station-detail.wxml')
  const stationJs = read('subpackages/monitor-pages/station-detail.js')
  assert.match(stationWxml, /bindtap="onShipTap"/)
  assert.match(stationWxml, /catchtap="onShipAgencyTap"/)
  assert.match(stationJs, /onShipAgencyTap/)
  assert.match(stationJs, /ensureShareImageHttpUrl/)
  assert.match(stationJs, /pickRocketModelShareImageUrl/)

  const chatWxml = read('subpackages/shared/components/ai-chat/index.wxml')
  const chatJs = read('subpackages/shared/components/ai-chat/index.js')
  const rich = read('subpackages/shared/utils/ai-chat-rich.js')
  assert.match(chatWxml, /bindtap="onMissionCardTap"/)
  assert.match(chatWxml, /catchtap="onLaunchRowAgencyTap"/)
  assert.match(chatJs, /onLaunchRowAgencyTap/)
  assert.match(rich, /launchAgencyId/)
  assert.match(rich, /launchAgencyAbbrev/)

  const compareWxml = read('subpackages/monitor-pages/rocket-compare.wxml')
  const compareJs = read('subpackages/monitor-pages/rocket-compare.js')
  assert.match(compareWxml, /bindtap="onTogglePick"/)
  assert.match(compareWxml, /catchtap="onTapPickerManufacturer"/)
  assert.match(compareJs, /onTapPickerManufacturer/)
})
