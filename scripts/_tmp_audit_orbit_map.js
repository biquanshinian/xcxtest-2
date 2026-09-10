/**
 * 空间站轨道追踪审计冒烟（无微信运行时）
 * node scripts/_tmp_audit_orbit_map.js
 */
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = path.join(__dirname, '..')
const orbit = require(path.join(root, 'subpackages/monitor-pages/station-orbit.js'))
const tleFetchPath = path.join(root, 'subpackages/monitor-pages/utils/tle-fetch.js')
const orbitMapJs = fs.readFileSync(path.join(root, 'subpackages/monitor-pages/orbit-map.js'), 'utf8')
const stationDetailJs = fs.readFileSync(path.join(root, 'subpackages/monitor-pages/station-detail.js'), 'utf8')
const orbitWxml = fs.readFileSync(path.join(root, 'subpackages/monitor-pages/orbit-map.wxml'), 'utf8')
const stationWxml = fs.readFileSync(path.join(root, 'subpackages/monitor-pages/station-detail.wxml'), 'utf8')
const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
const markerPng = path.join(root, 'subpackages/monitor-pages/station-marker.png')

let failed = 0
function ok(name, cond, detail) {
  if (cond) console.log('  GREEN', name)
  else {
    failed++
    console.log('  RED  ', name, detail || '')
  }
}

console.log('=== NORAD / TLE helpers ===')
ok('ISS norad', orbit.resolveNoradId(4) === '25544')
ok('Tiangong norad', orbit.resolveNoradId(18) === '48274')
ok('string id 18', orbit.resolveNoradId('18') === '48274')
ok('unknown id null', orbit.resolveNoradId(99) === null)

const full = {
  tle: {
    '25544': { line1: '1 a', line2: '2 b' },
    '48274': { line1: '1 c', line2: '2 d' }
  }
}
const issOnly = {
  tle: {
    '25544': { line1: '1 a', line2: '2 b' },
    '48274': null
  }
}
ok('pick ISS from full', !!orbit.pickStationTle(full, '25544'))
ok('pick CSS from full', !!orbit.pickStationTle(full, '48274'))
ok('reject null CSS', orbit.pickStationTle(issOnly, '48274') === null)
ok('reject missing lines', orbit.pickStationTle({ tle: { '48274': { line1: 'x' } } }, '48274') === null)

console.log('=== assets / theme / wiring ===')
ok('marker png exists', fs.existsSync(markerPng) && fs.statSync(markerPng).size > 100)
ok('orbit-map uses png', orbitMapJs.includes('STATION_MARKER_ICON') && !orbitMapJs.includes('station-marker.svg'))
ok('station-detail uses png', stationDetailJs.includes('STATION_MARKER_ICON') && !stationDetailJs.includes('station-marker.svg'))
ok('orbit page-meta', orbitWxml.includes('page-meta') && orbitWxml.includes('pageBgColor'))
ok('station page-meta', stationWxml.includes('page-meta') && stationWxml.includes('pageBgColor'))
ok('isTiangong in wxml', stationWxml.includes('isTiangong'))
ok('openOrbitMap passes lat', stationDetailJs.includes('&lat=') && stationDetailJs.includes('&lng='))
ok('orbit seed center', orbitMapJs.includes('_seedCentered') && orbitMapJs.includes('centerOnStation()'))
ok('panel-live shared light', appWxss.includes('.map-page.theme-light .panel-live'))
ok('panel-badge green light', appWxss.includes('.map-page.theme-light .panel-badge--green'))
ok('tle-fetch force', fs.readFileSync(tleFetchPath, 'utf8').includes('force'))
ok('center timer cleanup', orbitMapJs.includes('_centerTimer') && orbitMapJs.includes('_pageAlive'))
ok('refresh resets tracking', /refreshOrbitData[\s\S]*stopTracking[\s\S]*loadOrbitData/.test(orbitMapJs))

console.log('=== lat=0 center guard ===')
ok('detail center uses isFinite', stationDetailJs.includes('Number.isFinite(this.data.stationLat)'))

if (failed) {
  console.log('\nRESULT: RED (' + failed + ')')
  process.exit(1)
}
console.log('\nRESULT: ALL GREEN')
