/**
 * SPACE_NOTICES_FEATURE — Flight 13 演示通告
 *
 * 自动成图：优先用 rawText → parseAreasFromRawText 生成 areas（与 Space Notices「Text」页同源逻辑）
 * E2700/26 即参考站印度洋溅落红区。
 * 跨洋黄线：与 space-notices.com 同源（Ship 40 / Flight 13 轨迹，抽稀后约 280 点）。
 */

const { parseAreasFromRawText } = require('./parse-areas.js')
const FLIGHT13_TRAJ_PACK = require('./flight13-trajectory.json')

const FLIGHT13_LL2_ID = 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2'
/** 条目主键为站点 slug；站点不暴露 LL2 id，LL2 只做尽力匹配 */
const FLIGHT13_ENTRY_KEY = 'launch-starship-flight-13'

/** 与网站 Trajectory 同源：[lon, lat]，颜色 #ffcc00 */
const FLIGHT13_CORRIDOR_CENTERLINE = Array.isArray(FLIGHT13_TRAJ_PACK.coordinates)
  ? FLIGHT13_TRAJ_PACK.coordinates
  : []
const FLIGHT13_TRAJECTORY_COLOR = FLIGHT13_TRAJ_PACK.color || '#ffcc00'
const FLIGHT13_TRAJECTORY_VERSION = Number(FLIGHT13_TRAJ_PACK.version || 1)

/** 中心线南北各偏移约 1.6° 形成长条走廊 polygon */
const FLIGHT13_CORRIDOR_RING = [
  [-97.16, 27.59],
  [-94.5, 27.0],
  [-90.0, 25.8],
  [-84.0, 23.6],
  [-75.0, 20.1],
  [-60.0, 13.6],
  [-40.0, 5.6],
  [-20.0, -2.4],
  [0.0, -10.4],
  [20.0, -16.4],
  [40.0, -20.4],
  [55.0, -23.4],
  [70.0, -26.4],
  [85.0, -28.9],
  [95.0, -29.9],
  [95.0, -33.1],
  [85.0, -32.1],
  [70.0, -29.6],
  [55.0, -26.6],
  [40.0, -23.6],
  [20.0, -19.6],
  [0.0, -13.6],
  [-20.0, -5.6],
  [-40.0, 2.4],
  [-60.0, 10.4],
  [-75.0, 16.9],
  [-84.0, 20.4],
  [-90.0, 22.6],
  [-94.5, 23.8],
  [-97.16, 24.39],
  [-97.16, 27.59]
]

/** 参考站 E2700/26 — Stage 2 再入/溅落危险区（FAA NOTAM 原文） */
const E2700_RAW =
  'E2700/26 NOTAMN\n' +
  'Q) YMMM/QRDCA/IV/BO/W/000/999/2139S09259E999\n' +
  'A) YMMM\n' +
  'B) 2607232334 C) 2607300259\n' +
  'D) DAILY 2334-0259\n' +
  'E) TEMPO DANGER AREA ACT\n' +
  'ROCKET LAUNCH WILL TAKE PLACE FLW RECEIVED FM GOVERNMENT OF UNITED STATES OF AMERICA: ' +
  'HAZARDOUS OPS WILL BE CONDUCTED FOR ATMOSPHERIC RE-ENTRY AND SPLASHDOWN OF SPACEX STARSHIP FLT-13 STAGE 2 ' +
  'WI THE FOLLOWING AREAS: 2338S 07500E, 2251S 07826E, 2139S 08258E, 2018S 08740E, 1911S 09104E, ' +
  '1739S 09500E, 1613S 10020E, 1517S 10438E, 1631S 10942E, 1714S 11000E, 1819S 10708E, 1820S 10257E, ' +
  '1946S 09912E, 2101S 09456E, 2236S 08930E, 2401S 08324E, 2447S 07930E, 2530S 07500E TO BEGINNING.\n' +
  'F) SFC G) UNL'

const NOTAM_07270_RAW =
  'STARSHIP ASCENT FLT 13 AHA A2 WI AN AREA DEFINED AS 255700N0954800W TO 254800N0944800W TO 254300N0941400W TO 253200N0925800W TO 243400N0910100W TO 243000N0910200W TO 243000N0930000W TO POINT OF ORIGIN SFC-UNL 2607212245-2607220051'

const HYDROPAC_2078_RAW =
  'HAZARDOUS OPERATIONS SPACE DEBRIS 243000N0910000W 240000N0900000W 230000N0920000W 243000N0910000W'

function areasFromRaw(raw) {
  return parseAreasFromRawText(raw)
}

/** 已废弃：跨洋粗管状走廊会盖住真实 ADP 多边形，sync 时主动删除 */
const STALE_DEMO_CORRIDOR_KEY = 'adp-aha-starship-flight-13-demo'

const DEMO_NOTICES = [
  {
    noticeKey: 'notam-YMMM-E2700/26',
    type: 'NOTAM',
    name: 'E2700/26',
    reason: 'ATMOSPHERIC RE-ENTRY AND SPLASHDOWN OF SPACEX STARSHIP FLT-13 STAGE 2',
    sourceName: 'US Federal Aviation Administration',
    sourceLink: 'https://space-notices.com/notice/notam-YMMM-E2700/26',
    rawText: E2700_RAW,
    // 关键：areas 由原文解析生成，与参考站 Map 同源
    areas: areasFromRaw(E2700_RAW),
    dates: [
      { start: '2026-07-23T23:34:00.000Z', end: '2026-07-24T02:59:00.000Z' },
      { start: '2026-07-24T23:34:00.000Z', end: '2026-07-25T02:59:00.000Z' },
      { start: '2026-07-25T23:34:00.000Z', end: '2026-07-26T02:59:00.000Z' },
      { start: '2026-07-26T23:34:00.000Z', end: '2026-07-27T02:59:00.000Z' },
      { start: '2026-07-27T23:34:00.000Z', end: '2026-07-28T02:59:00.000Z' },
      { start: '2026-07-28T23:34:00.000Z', end: '2026-07-29T02:59:00.000Z' },
      { start: '2026-07-29T23:34:00.000Z', end: '2026-07-30T02:59:00.000Z' }
    ]
  },
  {
    noticeKey: 'notam-ZHU-07/270-26',
    type: 'NOTAM',
    name: '07/270',
    reason: 'STARSHIP ASCENT FLT 13 AHA A2',
    sourceName: 'US Federal Aviation Administration',
    sourceLink: 'https://notams.aim.faa.gov/notamSearch/createNotamPdf?transactionid=81824656',
    rawText: NOTAM_07270_RAW,
    areas: areasFromRaw(NOTAM_07270_RAW),
    dates: [
      {
        start: '2026-07-21T22:45:00.000Z',
        end: '2026-07-22T00:51:00.000Z'
      }
    ]
  },
  {
    noticeKey: 'nav-warning-HYDROPAC-2078-26',
    type: 'NAVWARNING',
    name: 'HYDROPAC 2078/26',
    reason: 'HAZARDOUS OPERATIONS, SPACE DEBRIS',
    sourceName: 'US National Geospatial-Intelligence Agency',
    sourceLink: 'https://msi.nga.mil/',
    rawText: HYDROPAC_2078_RAW,
    areas: areasFromRaw(HYDROPAC_2078_RAW),
    dates: [
      {
        start: '2026-07-21T22:00:00.000Z',
        end: '2026-07-22T06:00:00.000Z'
      }
    ]
  }
]

module.exports = {
  FLIGHT13_ENTRY_KEY,
  FLIGHT13_LL2_ID,
  FLIGHT13_CORRIDOR_CENTERLINE,
  FLIGHT13_TRAJECTORY_COLOR,
  FLIGHT13_TRAJECTORY_VERSION,
  FLIGHT13_CORRIDOR_RING,
  STALE_DEMO_CORRIDOR_KEY,
  E2700_RAW,
  DEMO_NOTICES
}
