/**
 * SPACE_NOTICES_FEATURE — 划线精度审计
 * node scripts/_tmp_audit_space_notices_draw.js
 */
const { parseAreasFromRawText, parseLinesFromRawText, simplifyRing, dmsTokenToDeg } = require('../cloudfunctions/spaceNotices/parse-areas.js')
const { E2700_RAW } = require('../cloudfunctions/spaceNotices/seed-demo.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildPadMarker,
  resolveEffectivePad,
  fitCenter,
  hitNoticeAt
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log('  OK ', name)
  } else {
    failed += 1
    console.log('  FAIL', name, detail ? '— ' + detail : '')
  }
}

console.log('\n=== DRAW PRECISION ===')

check('2338S', Math.abs(dmsTokenToDeg('2338S') + 23.633333) < 0.01)
check('07500E', Math.abs(dmsTokenToDeg('07500E') - 75) < 0.01)
check('255700N', Math.abs(dmsTokenToDeg('255700N') - 25.95) < 0.01)
check('0954800W', Math.abs(dmsTokenToDeg('0954800W') + 95.8) < 0.01)

const e2700 = parseAreasFromRawText(E2700_RAW)
check('E2700 单环', e2700.length === 1, 'rings=' + e2700.length)
check('E2700 顶点数', e2700[0] && e2700[0].length >= 18, 'pts=' + (e2700[0] && e2700[0].length))
check('E2700 首点 075E', !!(e2700[0] && Math.abs(e2700[0][0][0] - 75) < 0.05))
check('E2700 闭合', !!(e2700[0] && e2700[0][0][0] === e2700[0][e2700[0].length - 1][0]))
check(
  'E2700 不吃 Q 行中心',
  !(e2700[0] && Math.abs(e2700[0][0][0] - 92.98) < 0.2),
  JSON.stringify(e2700[0] && e2700[0][0])
)

const AHA_RAW =
  'STARSHIP ASCENT FLT 13 AHA A2 WI AN AREA DEFINED AS 255700N0954800W TO 254800N0944800W TO 254300N0941400W TO 253200N0925800W TO 243400N0910100W TO 243000N0910200W TO 243000N0930000W TO POINT OF ORIGIN SFC-UNL 2607212245-2607220051'
const aha = parseAreasFromRawText(AHA_RAW)
check('AHA 单环', aha.length === 1, 'rings=' + aha.length)
check('AHA 首点西经', !!(aha[0] && aha[0][0][0] < -95 && aha[0][0][0] > -96))

const two = parseLinesFromRawText('HAZARDOUS OPERATIONS 243000N0910000W 240000N0900000W')
check('两点成线不成面', parseAreasFromRawText('HAZARDOUS OPERATIONS 243000N0910000W 240000N0900000W').length === 0)
check('两点线段', !!(two[0] && two[0].length === 2 && Math.abs(two[0][0][0] + 91) < 0.02))

const multi = parseAreasFromRawText(
  'AREA A: 2338S 07500E, 2251S 07826E, 2139S 08258E TO BEGINNING\n' +
    'AREA B: 1613S 10020E, 1517S 10438E, 1631S 10942E TO BEGINNING'
)
check('双区拆成两环', multi.length === 2, 'rings=' + multi.length)
check('双区 A 在 75E', !!(multi[0] && Math.abs(multi[0][0][0] - 75) < 0.05))
check('双区 B 在 100E', !!(multi[1] && Math.abs(multi[1][0][0] - 100.333) < 0.05))
check(
  '双区没有被连成一块',
  !(multi.length === 1 && multi[0] && multi[0].length >= 6)
)

const dms = parseAreasFromRawText(
  'N38°30\'12" E100°15\'18" N38°20\'00" E101°00\'00" N37°50\'00" E101°00\'00" N38°00\'00" E100°15\'18"'
)
check('度分秒符号成环', !!(dms[0] && dms[0].length >= 4), 'pts=' + (dms[0] && dms[0].length))
check('度分秒经度', !!(dms[0] && Math.abs(dms[0][0][0] - 100.255) < 0.01), JSON.stringify(dms[0] && dms[0][0]))

const glued = parseAreasFromRawText('N383012E1001518 N382000E1010000 N375000E1010000 N380000E1001518')
check('无空格半球在前', !!(glued[0] && glued[0].length >= 4 && Math.abs(glued[0][0][0] - 100.255) < 0.02))

const hyphen = parseAreasFromRawText(
  '38-30-00N 100-15-00E 38-20-00N 101-00-00E 37-50-00N 101-00-00E 38-00-00N 100-15-00E'
)
check('连字符 DMS', !!(hyphen[0] && Math.abs(hyphen[0][0][1] - 38.5) < 0.02))

const pacific = {
  noticeKey: 'pacific',
  type: 'NOTAM',
  areas: [[[170, 10], [175, 12], [-175, 12], [-170, 10], [170, 10]]]
}
const pacPoly = buildPolygonsFromNotices([pacific], { NOTAM: true })
const pacLine = buildPolylinesFromNotices([pacific], { NOTAM: true })
check('日界线环不填穿地球', pacPoly.length === 0, 'poly=' + pacPoly.length)
check('日界线环拆成边界线段', pacLine.length >= 2, 'line=' + pacLine.length)
check(
  '日界线线段不跳 180°',
  pacLine.every((l) => {
    for (let i = 1; i < l.points.length; i++) {
      if (Math.abs(l.points[i].longitude - l.points[i - 1].longitude) > 180) return false
    }
    return true
  })
)

const leftover = {
  noticeKey: 'n-outline',
  type: 'NOTAM',
  areas: [[[-97, 26], [-96, 26], [-96, 25], [-97, 25], [-97, 26]]],
  centerline: [[-97, 26], [-90, 20]]
}
const leftoverLines = buildPolylinesFromNotices([leftover], { NOTAM: true })
check(
  '有面时不叠中心线',
  leftoverLines.length === 1 && leftoverLines[0].points.length >= 4,
  'n=' + leftoverLines.length + ' pts=' + (leftoverLines[0] && leftoverLines[0].points.length)
)

const latFirst = buildPolygonsFromNotices(
  [{ noticeKey: 'swap', type: 'NOTAM', areas: [[[38, 100], [38.2, 101], [37.8, 101], [38, 100]]] }],
  { NOTAM: true }
)
check(
  '[lat,lon] 大经度对调',
  !!(latFirst[0] && Math.abs(latFirst[0].points[0].longitude - 100) < 0.01 && Math.abs(latFirst[0].points[0].latitude - 38) < 0.01),
  JSON.stringify(latFirst[0] && latFirst[0].points[0])
)

const geojson = buildPolygonsFromNotices(
  [{ noticeKey: 'gj', type: 'NOTAM', areas: [[[100, 38], [101, 38.2], [101, 37.8], [100, 38]]] }],
  { NOTAM: true }
)
check(
  'GeoJSON [lon,lat] 不误调',
  !!(geojson[0] && Math.abs(geojson[0].points[0].longitude - 100) < 0.01 && Math.abs(geojson[0].points[0].latitude - 38) < 0.01)
)

const dense = []
for (let i = 0; i <= 40; i++) dense.push([-97 + i * 0.01, 26])
for (let i = 0; i <= 40; i++) dense.push([-96.6, 26 - i * 0.01])
for (let i = 0; i <= 40; i++) dense.push([-96.6 - i * 0.01, 25.6])
for (let i = 0; i <= 40; i++) dense.push([-97, 25.6 + i * 0.01])
dense.push([-97, 26])
const slim = simplifyRing(dense, 20)
check('抽稀后仍闭合', !!(slim.length && slim[0][0] === slim[slim.length - 1][0] && slim[0][1] === slim[slim.length - 1][1]))
check('抽稀保拐点 < 原点数', slim.length < dense.length && slim.length <= 21, 'slim=' + slim.length + ' raw=' + dense.length)
check('抽稀仍覆盖矩形四角', slim.length >= 5, 'slim=' + slim.length)

const ePolys = buildPolygonsFromNotices([{ noticeKey: 'e', type: 'NOTAM', areas: e2700 }], { NOTAM: true })
const eLines = buildPolylinesFromNotices([{ noticeKey: 'e', type: 'NOTAM', areas: e2700 }], { NOTAM: true })
check('E2700 可填可描', ePolys.length === 1 && eLines.length === 1)
check(
  '描边顶点数对齐原文',
  eLines[0] && eLines[0].points.length >= 18,
  'pts=' + (eLines[0] && eLines[0].points.length)
)
check(
  '描边首点经度=75',
  !!(eLines[0] && Math.abs(eLines[0].points[0].longitude - 75) < 0.05),
  JSON.stringify(eLines[0] && eLines[0].points[0])
)

const fake = buildPolygonsFromNotices(
  [{
    noticeKey: 'adp-aha-starship-flight-13-demo',
    type: 'ADP_LINK_FILE',
    areas: [[[-97, 26], [95, -31], [95, -28], [-97, 28], [-97, 26]]]
  }],
  { ADP_LINK_FILE: true }
)
check('跨洋假走廊仍跳过', fake.length === 0)

const tapA = {
  noticeKey: 'notam-ZLHW-A3624/26',
  type: 'NOTAM',
  areas: [[[100.2, 38.4], [100.6, 38.4], [100.6, 38.8], [100.2, 38.8], [100.2, 38.4]]]
}
const tapB = {
  noticeKey: 'notam-RPHI-B3622/26',
  type: 'NOTAM',
  areas: [[[121.0, 21.0], [121.4, 21.0], [121.4, 21.4], [121.0, 21.4], [121.0, 21.0]]]
}
check('点选画线区内命中', hitNoticeAt([tapA, tapB], 38.6, 100.4) === 'notam-ZLHW-A3624/26')
check('点选画线区外不误中', hitNoticeAt([tapA, tapB], 34.5, 108) === '')
check('重叠时优先小面', hitNoticeAt([
  { noticeKey: 'big', type: 'NOTAM', areas: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  { noticeKey: 'small', type: 'NOTAM', areas: [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] }
], 5, 5) === 'small')

const junk = [null, undefined, {}, { areas: null }, { areas: [null, 'x', []] }, { noticeKey: 'a', areas: [[[NaN, NaN]]] }]
let threw = ''
try {
  buildPolygonsFromNotices(junk, { NOTAM: true }, { preview: true })
  buildPolylinesFromNotices(junk, { NOTAM: true }, { preview: true })
  hitNoticeAt(junk, 38, 100)
  hitNoticeAt(null, 'x', 'y')
} catch (e) {
  threw = (e && e.message) || String(e)
}
check('脏数据画线不抛', !threw, threw)

const noPad = resolveEffectivePad({ missionName: '中国航警公告', pad: { latitude: null, longitude: null } }, [], [])
check('无发射台不落到 0,0', !noPad || (noPad.latitude !== 0 && noPad.longitude !== 0))
check('空发射台不钉海里', buildPadMarker({ latitude: null, longitude: null }, '中国航警公告').length === 0)
check('零点发射台不钉海里', buildPadMarker({ latitude: 0, longitude: 0 }, '中国航警公告').length === 0)
const padFit = fitCenter({ latitude: null, longitude: null }, [], [], { region: 'pad' })
check('空发射区不居中非洲', !(Math.abs(padFit.latitude) < 2 && Math.abs(padFit.longitude) < 2))

console.log('\n=== result: ' + passed + ' passed, ' + failed + ' failed ===')
process.exit(failed ? 1 : 0)
