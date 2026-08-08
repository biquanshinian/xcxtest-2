/** SPACE_NOTICES_FEATURE — 本地解析器冒烟（含 E2700 DDMM 空格坐标） */
const { parseAreasFromRawText, dmsTokenToDeg } = require('../cloudfunctions/spaceNotices/parse-areas.js')
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

console.log('OK compact=', compact[0].length, 'e2700=', e2700[0].length, 'seeded=', seeded.areas[0].length)
