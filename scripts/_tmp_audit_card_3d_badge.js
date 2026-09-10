/**
 * 本轮审计：任务卡左上角 360 → 3D 图标入口（有模型才显示）
 * 运行：node scripts/_tmp_audit_card_3d_badge.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const issues = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => {
  issues.push(m)
  console.log('  FAIL ' + m)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
}

const CARD_WXML = [
  'pages/index/index.wxml',
  'subpackages/progress-extra/components/mission-list-card/index.wxml'
]
const CARD_WXSS = [
  'pages/index/index.wxss',
  'subpackages/shared/styles/mission-card.wxss',
  'subpackages/progress-extra/styles/mission-card.wxss'
]
const INTEL = [
  'subpackages/progress-extra/utils/event-feed-intel.js',
  'subpackages/shared/utils/event-feed-intel.js'
]

console.log('==== 本轮：任务卡 3D 入口 ====')

console.log('\n[1] 卡片 UI：360 已换 3D，详情头图 360 仍在')
CARD_WXML.forEach((rel) => {
  const src = read(rel)
  if (!/item\.hasRocket3d/.test(src)) fail(rel + ' 未用 hasRocket3d')
  else if (!/mission-card-3d/.test(src)) fail(rel + ' 缺 3D 图标结构')
  else if (!/aria-label="3D 模型"/.test(src)) fail(rel + ' 缺 3D aria-label')
  else if (/hasOrbitPano/.test(src) || /mission-card-pano/.test(src) || /mission-card-pano-360/.test(src)) {
    fail(rel + ' 仍残留 360 角标')
  } else ok(rel + ' 左上角是 3D')
})

const detailWxml = read('pages/mission-detail/mission-detail.wxml')
if (/orbitPanoEnabled/.test(detailWxml) && /hero-pano-360/.test(detailWxml) && /rocket3dEnabled/.test(detailWxml)) {
  ok('详情头图仍保留 360 + 3D')
} else fail('详情头图 360/3D 入口被误改')

const aiWxml = read('subpackages/shared/components/ai-chat/index.wxml')
if (/mission-card-pano|hasOrbitPano|hasRocket3d/.test(aiWxml)) {
  fail('AI 任务卡不该擅自加角标')
} else ok('AI 任务卡未误加角标')

console.log('\n[2] 卡片样式：位置/尺寸对齐原 360 槽')
CARD_WXSS.forEach((rel) => {
  const src = read(rel)
  const block = src.match(/\.mission-card-3d\s*\{[\s\S]*?\n\}/)
  if (!block) {
    fail(rel + ' 缺 .mission-card-3d')
    return
  }
  const css = block[0]
  if (!/left:\s*10rpx/.test(css) || !/top:\s*10rpx/.test(css)) fail(rel + ' 3D 角标位置不是左上 10rpx')
  else if (!/width:\s*52rpx/.test(css) || !/height:\s*52rpx/.test(css)) fail(rel + ' 3D 角标不是 52rpx')
  else if (!/pointer-events:\s*none/.test(css)) fail(rel + ' 角标会抢卡片点击')
  else if (/mission-card-pano-360/.test(src)) fail(rel + ' 仍有 360 样式')
  else if (!/mission-card-3d-cube/.test(src) || !/@keyframes mission-card-3d-flip/.test(src)) {
    fail(rel + ' 缺立方体动画')
  } else ok(rel + ' 槽位与立方体齐全')
})

console.log('\n[3] 打标链路：列表 / 首页 / 日历 / 事件')
const api = read('utils/api-launch-list.js')
const stampCount = (api.match(/hasRocket3d = missionHasRocket3d/g) || []).length
if (stampCount >= 3 && /rocket-3d-list-flag/.test(api)) ok('api-launch-list 三处盖章 hasRocket3d')
else fail('api-launch-list 未在 map/clone/peek 盖章 hasRocket3d')

const indexJs = read('pages/index/index.js')
if (
  /applyRocket3dFlags/.test(indexJs) &&
  /buildRocket3dFlagPatch/.test(indexJs) &&
  /readParkedOrData/.test(indexJs) &&
  /listOf\('calendarAllMissions'\)/.test(indexJs) &&
  /unparkIndexHeavyData[\s\S]{0,180}_restampOrbitPanoFlags/.test(indexJs)
) {
  ok('首页 apply + 停泊感知 restamp + 回 Tab 再盖章')
} else fail('首页 3D 打标/restamp/停泊未齐')

if (
  /applyRocket3dFlags\(payload\.upcomingMissions\)/.test(indexJs) &&
  /applyRocket3dFlags\(payload\.completedMissions\)/.test(indexJs)
) {
  ok('列表就绪时 upcoming/completed 都打 3D 标')
} else fail('applyMissionListsReadyState 漏打 3D 标')

const restampMedia = (indexJs.match(/loadCloudMediaMap[\s\S]{0,280}_restampOrbitPanoFlags/g) || []).length
if (restampMedia >= 2) ok('media map 回灌后会 restamp')
else fail('media map 回灌后未 restamp 3D')

const cal = read('subpackages/index-extra/utils/index-calendar-page.js')
if (/applyRocket3dFlags\(missions\)/.test(cal) && /applyOrbitPanoFlags\(missions\)/.test(cal)) {
  ok('日历快照（含缓存）落库前盖章')
} else fail('applyCalendarMissionSnapshot 未盖 3D 标')

const settle = read('subpackages/index-extra/utils/index-live-settle.js')
if (
  /applyRocket3dFlags\(patch\[key\]\)/.test(settle) &&
  /restampCardFlags/.test(settle) &&
  /setData\(patch, \(\) => \{[\s\S]*restampCardFlags/.test(settle)
) {
  ok('media map 换图前先打标，setData 后再 restamp')
} else fail('_refreshRocketImagesFromMediaMap 可能用旧 hasRocket3d 整表覆盖')

const interaction = read('subpackages/index-extra/utils/index-interaction.js')
if (/applyRocket3dFlags\(patch\[key\]\)/.test(interaction) && /_repairVisibleRocketImages[\s\S]*_restampOrbitPanoFlags/.test(interaction)) {
  ok('可见图修复在 loadCloudMediaMap 后补 3D 标')
} else fail('_repairVisibleRocketImages 换图后未补 3D 标')

INTEL.forEach((rel) => {
  const src = read(rel)
  if (/hasRocket3d:\s*missionHasRocket3d\(launch\)/.test(src) && /rocket-3d-list-flag/.test(src)) {
    ok(rel + ' 关联发射带 hasRocket3d')
  } else fail(rel + ' 未写入 hasRocket3d')
})
if (read(INTEL[0]).includes('hasRocket3d: missionHasRocket3d(launch)') && read(INTEL[1]).includes('hasRocket3d: missionHasRocket3d(launch)')) {
  ok('两份 event-feed-intel 3D 字段对齐')
}

console.log('\n[4] 逻辑：failClosed + 与详情门控一致')
const flag = read('utils/rocket-3d-list-flag.js')
if (/getReadyUrl/.test(flag) && /failClosed/.test(flag) && /_langPack/.test(flag)) {
  ok('列表打标只认已启用 GLB，并吃 _langPack 英文名')
} else fail('rocket-3d-list-flag 门控不完整')

const gate = read('pages/mission-detail/utils/rocket-3d-gate.js')
if (/function hasReadyRocketModel/.test(gate) && /getReadyUrl/.test(gate)) ok('详情门控仍只认 ready GLB')
else fail('详情 3D 门控被改坏')

console.log('\n[5] JS 语法')
;[
  'utils/rocket-3d-list-flag.js',
  'utils/api-launch-list.js',
  'pages/index/index.js',
  'subpackages/index-extra/utils/index-calendar-page.js',
  'subpackages/index-extra/utils/index-live-settle.js',
  'subpackages/index-extra/utils/index-interaction.js',
  'subpackages/progress-extra/utils/event-feed-intel.js',
  'subpackages/shared/utils/event-feed-intel.js',
  'pages/mission-detail/utils/rocket-3d-gate.js'
].forEach((rel) => {
  if (syntaxOk(rel)) ok(rel)
  else fail(rel + ' 语法错误')
})

console.log('\n[6] 单测')
const tests = [
  'test/rocket-3d-list-flag.test.js',
  'test/rocket-3d-audit.test.js',
  'test/rocket-3d-models.test.js',
  'test/orbit-pano-list-flag.test.js',
  'test/mission-list-card.test.js'
]
const t = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', cwd: ROOT })
if (t.status === 0) ok('相关单测全绿')
else fail('相关单测失败\n' + (t.stderr || t.stdout || '').slice(-1600))

console.log('\n==== 汇总 ====')
if (!issues.length) {
  console.log('ALL GREEN')
  process.exit(0)
}
console.log('失败 ' + issues.length)
issues.forEach((m) => console.log(' - ' + m.split('\n')[0]))
process.exit(1)
