/** SPACE_NOTICES_FEATURE — 本地解析器冒烟（含 E2700 DDMM 空格坐标） */
const { parseAreasFromRawText, parseLinesFromRawText, dmsTokenToDeg } = require('../cloudfunctions/spaceNotices/parse-areas.js')
const { DEMO_NOTICES, E2700_RAW } = require('../cloudfunctions/spaceNotices/seed-demo.js')

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exit(1)
  }
}

// 紧凑 DDMMSS
const compactRaw =
  '255700N0954800W TO 254800N0944800W TO 254300N0941400W TO 253200N0925800W TO 243400N0910100W TO 243000N0910200W TO 243000N0930000W TO POINT OF ORIGIN'
const compact = parseAreasFromRawText(compactRaw)
assert(compact.length === 1 && compact[0].length >= 7, 'compact ring')

// E2700 空格 DDMM（参考站 Text → Map）
assert(Math.abs(dmsTokenToDeg('2338S') - -23.633333) < 0.01, '2338S')
assert(Math.abs(dmsTokenToDeg('07500E') - 75) < 0.01, '07500E')
assert(Math.abs(dmsTokenToDeg('10020E') - 100.333333) < 0.02, '10020E')

const e2700 = parseAreasFromRawText(E2700_RAW)
assert(e2700.length === 1 && e2700[0].length >= 18, 'e2700 pts=' + (e2700[0] && e2700[0].length))
// 首点约 2338S 07500E → lon=75, lat≈-23.63
assert(Math.abs(e2700[0][0][0] - 75) < 0.05, 'e2700 lon0')
assert(Math.abs(e2700[0][0][1] - -23.633) < 0.05, 'e2700 lat0')

const seeded = DEMO_NOTICES.find((n) => n.noticeKey === 'notam-YMMM-E2700/26')
assert(seeded && seeded.areas && seeded.areas[0] && seeded.areas[0].length >= 18, 'seed E2700 auto areas')

// 两点不成面 → 线段
const lineRaw = 'HAZARDOUS OPERATIONS 243000N0910000W 240000N0900000W'
assert(parseAreasFromRawText(lineRaw).length === 0, 'two-point not area')
const lines = parseLinesFromRawText(lineRaw)
assert(lines.length === 1 && lines[0].length === 2, 'two-point line')
assert(Math.abs(lines[0][0][0] + 91) < 0.02, 'line lon0')

// 带连字符 DMS（中国航警常见）
const hyphen = parseAreasFromRawText(
  '38-30-00N 100-15-00E 38-20-00N 101-00-00E 37-50-00N 101-00-00E 38-00-00N 100-15-00E'
)
assert(hyphen.length === 1 && hyphen[0].length >= 4, 'hyphen ring')
assert(Math.abs(hyphen[0][0][0] - 100.25) < 0.02, 'hyphen lon0')
assert(Math.abs(hyphen[0][0][1] - 38.5) < 0.02, 'hyphen lat0')

const dec = parseAreasFromRawText('38.5N 100.25E 38.2N 101.0E 37.8N 101.0E 38.0N 100.25E')
assert(dec.length === 1 && Math.abs(dec[0][0][0] - 100.25) < 0.02, 'decimal lon0')

const multi = parseAreasFromRawText(
  'AREA A: 2338S 07500E, 2251S 07826E, 2139S 08258E TO BEGINNING\n' +
    'AREA B: 1613S 10020E, 1517S 10438E, 1631S 10942E TO BEGINNING'
)
assert(multi.length === 2, 'multi rings=' + multi.length)
assert(Math.abs(multi[0][0][0] - 75) < 0.05, 'multi A lon')
assert(Math.abs(multi[1][0][0] - 100.333) < 0.05, 'multi B lon')

const glued = parseAreasFromRawText('N383012E1001518 N382000E1010000 N375000E1010000 N380000E1001518')
assert(glued.length === 1 && Math.abs(glued[0][0][0] - 100.255) < 0.02, 'glued hemi-first')

console.log('OK compact=', compact[0].length, 'e2700=', e2700[0].length, 'seeded=', seeded.areas[0].length, 'hyphen=', hyphen[0].length, 'decimal=', dec[0].length, 'multi=', multi.length)
