/**
 * 地图卫星底图 + 实底叠层卡片审计（无微信运行时）
 * node scripts/_tmp_audit_map_satellite.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PAGES = [
  'subpackages/monitor-pages/launch-site-map',
  'subpackages/monitor-pages/launch-site-detail',
  'subpackages/monitor-pages/orbit-map',
  'subpackages/monitor-pages/pass-map',
  'subpackages/monitor-pages/space-notices/notice-map',
  'subpackages/progress-extra/starbase-map',
  'subpackages/progress-extra/road-closure-map',
  'pages/nasa-data/eonet-map'
]
const PREVIEW_MAPS = [
  'pages/mission-detail/mission-detail.wxml',
  'subpackages/monitor-pages/station-detail.wxml',
  'subpackages/progress-extra/road-closure-detail.wxml'
]
const COMMONS = [
  'subpackages/monitor-pages/utils/map-page-common.js',
  'subpackages/progress-extra/utils/map-page-common.js',
  'pages/nasa-data/utils/map-page-common.js'
]
const EXTRA_JS = [
  'subpackages/monitor-pages/station-detail.js',
  'pages/mission-detail/mission-detail.js',
  'subpackages/progress-extra/road-closure-detail.js'
]

let failed = 0
function ok(name, cond, detail) {
  if (cond) console.log('  GREEN', name)
  else {
    failed++
    console.log('  RED  ', name, detail || '')
  }
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

console.log('=== JS 语法 ===')
const jsFiles = [
  ...COMMONS,
  ...PAGES.map((p) => p + '.js'),
  ...EXTRA_JS
]
for (const f of jsFiles) {
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs)) {
    ok('exists ' + f, false, 'missing')
    continue
  }
  try {
    execSync(`node --check "${abs}"`, { stdio: 'pipe' })
    ok('syntax ' + f, true)
  } catch (e) {
    ok('syntax ' + f, false, String(e.stderr || e.message).split('\n')[0])
  }
}

console.log('=== setMapSatelliteFromTap 运行时 ===')
const { setMapSatelliteFromTap, createMapBaseState } = require(path.join(ROOT, COMMONS[0]))
function fakePage(enableSatellite) {
  const page = {
    data: { enableSatellite, mapSetting: { enableSatellite } },
    setData(patch) {
      Object.assign(page.data, patch)
    }
  }
  return page
}
function tap(mapMode) {
  return { currentTarget: { dataset: { mapMode } } }
}
{
  const p = fakePage(true)
  setMapSatelliteFromTap(p, tap('standard'))
  ok('切到平面', p.data.enableSatellite === false && p.data.mapSetting.enableSatellite === false)
}
{
  const p = fakePage(false)
  setMapSatelliteFromTap(p, tap('satellite'))
  ok('切到卫星', p.data.enableSatellite === true && p.data.mapSetting.enableSatellite === true)
}
{
  const p = fakePage(false)
  setMapSatelliteFromTap(p, tap(''))
  ok('空 mode 回落卫星', p.data.enableSatellite === true)
}
{
  const p = fakePage(true)
  setMapSatelliteFromTap(p, { currentTarget: { dataset: { type: 'standard' } } })
  ok('兼容 data-type', p.data.enableSatellite === false)
}
ok('缺 page 不抛', (() => {
  try {
    setMapSatelliteFromTap(null, tap('satellite'))
    setMapSatelliteFromTap({}, tap('satellite'))
    return true
  } catch (e) {
    return false
  }
})())
{
  const state = createMapBaseState()
  ok('createMapBaseState 默认卫星', state.enableSatellite === true && state.mapSetting.enableSatellite === true)
}

console.log('=== 三副本 helper 一致 ===')
const commonSrc = COMMONS.map(read)
commonSrc.forEach((s, i) => {
  ok('common#' + i + ' enableSatellite 默认 true', /enableSatellite:\s*true/.test(s))
  ok('common#' + i + ' 导出 setMapSatelliteFromTap', /setMapSatelliteFromTap/.test(s) && /module\.exports[\s\S]*setMapSatelliteFromTap/.test(s))
  ok('common#' + i + ' mode !== standard', /mode !== 'standard'/.test(s))
  ok('common#' + i + ' 震动反馈', /vibrateShort/.test(s))
  ok('common#' + i + ' 同步 mapSetting', /mapSetting:\s*\{\s*enableSatellite/.test(s))
})
ok('三副本 helper 函数体一致', commonSrc.every((s) => {
  const fn = s.match(/function setMapSatelliteFromTap[\s\S]*?\n\}/)
  return fn && fn[0] === commonSrc[0].match(/function setMapSatelliteFromTap[\s\S]*?\n\}/)[0]
}))

console.log('=== 全屏地图页接线 ===')
for (const page of PAGES) {
  const js = read(page + '.js')
  const wxml = read(page + '.wxml')
  const label = page.split('/').pop()

  ok(label + ' map 绑定 enable-satellite', /enable-satellite="\{\{enableSatellite\}\}"/.test(wxml))
  ok(label + ' map 绑定 setting', /setting="\{\{mapSetting\}\}"/.test(wxml))
  ok(label + ' 无 layer-style', !/layer-style/.test(wxml))
  ok(label + ' 工具栏有卫星/平面', /map-action-type-row/.test(wxml) && /data-map-mode="satellite"/.test(wxml) && /data-map-mode="standard"/.test(wxml))
  ok(label + ' bindtap setMapSatellite', /bindtap="setMapSatellite"/.test(wxml))
  ok(label + ' 实现 setMapSatellite', /setMapSatellite\s*\(e\)\s*\{/.test(js) && /setMapSatelliteFromTap\(\s*this\s*,\s*e\s*\)/.test(js))
  ok(label + ' 引入 setMapSatelliteFromTap', /setMapSatelliteFromTap/.test(js))

  const hasData = /enableSatellite\s*:/.test(js) || /createMapBaseState\s*\(/.test(js)
  ok(label + ' data 有 enableSatellite', hasData)
  ok(label + ' data 有 mapSetting', /mapSetting\s*:/.test(js) || /createMapBaseState\s*\(/.test(js))

  const methodHits = [...js.matchAll(/^\s{2}setMapSatellite\s*\(/gm)]
  ok(label + ' setMapSatellite 不重复', methodHits.length === 1, 'count=' + methodHits.length)

  const openMap = (wxml.match(/<map[\s\S]*?>/g) || []).join('\n')
  ok(label + ' 无写死 enable-satellite=true', !/enable-satellite="true"/.test(openMap))
}

console.log('=== 预览地图默认卫星 ===')
for (const f of PREVIEW_MAPS) {
  const wxml = read(f)
  const js = read(f.replace(/\.wxml$/, '.js'))
  ok(path.basename(f) + ' enable-satellite=true', /enable-satellite="true"/.test(wxml))
  ok(path.basename(f) + ' setting 卫星', /setting="\{\{mapSetting\}\}"/.test(wxml))
  ok(path.basename(f) + ' 无 layer-style', !/layer-style/.test(wxml))
  ok(path.basename(f.replace(/\.wxml$/, '.js')) + ' mapSetting', /mapSetting:\s*\{\s*enableSatellite:\s*true/.test(js))
}

console.log('=== 叠层卡片实底 ===')
const appWxss = read('app.wxss')
ok('app.wxss map-page glass-card 实底', /\.map-page \.glass-card[\s\S]{0,180}--color-bg-card/.test(appWxss.replace(/\s+/g, ' ')))
ok('app.wxss 去掉 map-action-btn blur', /\.map-page \.map-action-btn[\s\S]{0,400}backdrop-filter:\s*none/.test(appWxss.replace(/\s+/g, ' ')))
ok('app.wxss 有 type-row', /\.map-page \.map-action-type-row/.test(appWxss))
ok('app.wxss active 在 base 之后', (() => {
  const iBase = appWxss.indexOf('.map-page .map-action-btn {')
  const iActive = appWxss.indexOf('.map-page .map-action-btn.map-action-btn--active')
  return iBase >= 0 && iActive > iBase
})())
ok('app.wxss 有 active 态', /\.map-page \.map-action-btn\.map-action-btn--active/.test(appWxss))

const mapWxss = [
  'subpackages/monitor-pages/orbit-map.wxss',
  'subpackages/monitor-pages/launch-site-map.wxss',
  'subpackages/monitor-pages/launch-site-detail.wxss',
  'subpackages/monitor-pages/pass-map.wxss',
  'subpackages/monitor-pages/space-notices/notice-map.wxss',
  'subpackages/progress-extra/starbase-map.wxss',
  'subpackages/progress-extra/road-closure-map.wxss',
  'pages/nasa-data/eonet-map.wxss'
]
for (const f of mapWxss) {
  const s = read(f)
  const glass = s.match(/\.glass-card\s*\{[^}]+\}/)
  ok(path.basename(f) + ' glass-card 实底', !!(glass && /--color-bg-card/.test(glass[0]) && !/backdrop-filter/.test(glass[0])), glass && glass[0].slice(0, 80))
}

console.log('=== WXML 事件处理器存在 ===')
for (const page of PAGES) {
  const js = read(page + '.js')
  const wxml = read(page + '.wxml')
  const methods = new Set()
  for (const m of js.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*[(:]/gm)) methods.add(m[1])
  methods.add('goBack')
  methods.add('retryLoad')
  const missing = []
  for (const m of wxml.matchAll(/(?:bind|catch)[:]?[a-zA-Z]+\s*=\s*"([A-Za-z_$][\w$]*)"/g)) {
    if (!methods.has(m[1])) missing.push(m[1])
  }
  ok(page.split('/').pop() + ' 事件闭环', missing.length === 0, missing.join(','))
}

if (failed) {
  console.log('\nRESULT: RED (' + failed + ')')
  process.exit(1)
}
console.log('\nRESULT: ALL GREEN')
