/**
 * SPACE_NOTICES_FEATURE — 多任务客户端冒烟（entryKey / 轨迹显隐 / 分区视野 / Android callout）
 * node scripts/_tmp_smoke_sn_client.js
 */
const fs = require('fs')
const mapBuild = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')

let pass = 0
let fail = 0
function ok(cond, label, extra) {
  if (cond) {
    pass += 1
    console.log('  PASS ' + label + (extra != null ? ' — ' + extra : ''))
  } else {
    fail += 1
    console.log('  FAIL ' + label + (extra != null ? ' — ' + extra : ''))
  }
}

console.log('\n[1] resolveTrajectory')
ok(mapBuild.resolveTrajectory({ entryKey: 'launch-f9-nrol-95' }) == null, '非星舰无轨迹 → null')
ok(mapBuild.resolveTrajectory({ ll2Id: 'some-other-uuid' }) == null, '其它 ll2Id 无轨迹 → null')
const f13 = mapBuild.resolveTrajectory({ entryKey: 'launch-starship-flight-13' })
ok(Array.isArray(f13) && f13.length >= 200, 'Flight13 entryKey 用本地兜底', f13 && f13.length)
const f13ll2 = mapBuild.resolveTrajectory({ ll2Id: 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2' })
ok(Array.isArray(f13ll2) && f13ll2.length >= 200, 'Flight13 ll2Id 用本地兜底', f13ll2 && f13ll2.length)
ok(
  mapBuild.resolveTrajectory({
    entryKey: 'launch-starship-flight-13',
    trajectory: [[-97, 26], [-90, 20]],
    trajectoryVersion: 1
  }).length >= 200,
  'Flight13 旧版本云轨迹被本地包替换'
)
ok(
  mapBuild.resolveTrajectory({
    entryKey: 'launch-starship-flight-13',
    trajectory: [[-97, 26], [-90, 20], [-80, 10]],
    trajectoryVersion: 99
  }).length === 3,
  'Flight13 新版本云轨迹优先'
)

console.log('\n[2] 非 Starbase 发射区视野')
const capeNotices = [{
  noticeKey: 'notam-cape',
  type: 'NOTAM',
  areas: [[
    [-80.7, 28.3], [-80.4, 28.3], [-80.4, 28.7], [-80.7, 28.7], [-80.7, 28.3]
  ]]
}]
const capePolys = mapBuild.buildPolygonsFromNotices(capeNotices, null, {})
ok(capePolys.length === 1, 'Cape NOTAM 多边形可建', capePolys.length)
const capePad = { latitude: 28.562, longitude: -80.577, name: 'SLC-40' }
const capeFit = mapBuild.fitCenter(capePad, capePolys, [], { region: 'pad' })
ok(capeFit.includePoints.length >= 1, 'Cape 发射区 includePoints 非空', capeFit.includePoints.length)
ok(
  Math.abs(capeFit.latitude - 28.562) < 0.01 && Math.abs(capeFit.longitude - -80.577) < 0.01,
  'Cape 发射区中心钉在红色坐标',
  `${capeFit.latitude},${capeFit.longitude}`
)
ok(capeFit.scale >= 3 && capeFit.scale <= 20, 'Cape scale 合法', capeFit.scale)

const chinaNotices = [{
  noticeKey: 'notam-china',
  type: 'NOTAM',
  areas: [[
    [102.0, 27.8], [102.2, 27.8], [102.2, 28.1], [102.0, 28.1], [102.0, 27.8]
  ]]
}]
const chinaPolys = mapBuild.buildPolygonsFromNotices(chinaNotices, null, {})
const chinaFit = mapBuild.fitCenter(null, chinaPolys, [], { region: 'pad' })
ok(chinaPolys.length === 1, '中国区 NOTAM 多边形可建')
ok(chinaFit.includePoints.length >= 2, '无 pad 时发射区仍有 includePoints', chinaFit.includePoints.length)
ok(Math.abs(chinaFit.longitude - 102.1) < 2, '无 pad 时发射区落到中国附近', String(chinaFit.longitude))

const vandenbergPad = mapBuild.resolveEffectivePad(
  { pad: { name: 'Space Launch Complex 4E', location: { name: 'Vandenberg SFB, CA, USA' } } },
  [],
  []
)
ok(
  vandenbergPad && Math.abs(vandenbergPad.latitude - 34.632) < 0.05,
  'SLC-4E 名称回填红色坐标',
  vandenbergPad && `${vandenbergPad.latitude},${vandenbergPad.longitude}`
)
const starlinkPolys = mapBuild.buildPolygonsFromNotices([{
  noticeKey: 'nav-hydro',
  type: 'NAVWARNING',
  areas: [[[-156.9, -25.3], [-153.4, -26.0], [-157.0, -43.0], [-156.9, -25.3]]]
}], null, {})
ok(starlinkPolys.length === 1, '非星舰通告多边形可建（复用星舰绘制）', starlinkPolys.length)
const slPad = mapBuild.resolveEffectivePad(
  { pad: { name: 'Space Launch Complex 4E', location: { name: 'Vandenberg SFB' } } },
  starlinkPolys,
  []
)
const slFit = mapBuild.fitCenter(slPad, starlinkPolys, [], { region: 'pad' })
ok(Math.abs(slFit.latitude - slPad.latitude) < 0.001, '默认视野中心=红色坐标', slFit.latitude)

console.log('\n[3] marker callout Android 安全色')
const marker = mapBuild.buildPadMarker(
  { latitude: 25.99, longitude: -97.15, name: 'Pad' },
  'Flight 13',
  { light: true }
)
const bg = marker[0] && marker[0].callout && marker[0].callout.bgColor
const color = marker[0] && marker[0].callout && marker[0].callout.color
ok(typeof bg === 'string' && /^#[0-9A-Fa-f]{6}$/.test(bg), '浅色 callout bgColor 为 6 位实色', bg)
ok(typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color), '浅色 callout color 为 6 位实色', color)
ok(!(bg || '').includes('rgba') && !(color || '').includes('rgba'), 'callout 不使用 rgba')
ok(/pad-marker-red\.png/.test(marker[0].iconPath || ''), 'marker 用红色钉', marker[0].iconPath)
ok(!/station-marker/.test(marker[0].iconPath || ''), '不再用绿色 ISS marker')

console.log('\n[4] API getEntry 参数')
const apiSrc = fs.readFileSync('subpackages/monitor-pages/space-notices/utils/api-space-notices.js', 'utf8')
ok(/entryKey/.test(apiSrc) && /ll2Id/.test(apiSrc), 'API 同时支持 entryKey / ll2Id')

const mapJs = fs.readFileSync('subpackages/monitor-pages/space-notices/notice-map.js', 'utf8')
const mapWxml = fs.readFileSync('subpackages/monitor-pages/space-notices/notice-map.wxml', 'utf8')
ok(/hasTrajectory/.test(mapJs) && /wx:if="\{\{hasTrajectory\}\}"/.test(mapWxml), '详情页按 hasTrajectory 显隐轨迹层')

console.log('\n=== CLIENT SMOKE: ' + pass + ' passed, ' + fail + ' failed ===')
process.exit(fail ? 1 : 0)
