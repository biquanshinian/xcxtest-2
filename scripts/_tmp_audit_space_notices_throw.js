/**
 * SPACE_NOTICES_FEATURE — 脏数据执行不抛
 * node scripts/_tmp_audit_space_notices_throw.js
 */
global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: () => null,
  setStorageSync: () => {},
  getStorage: ({ fail }) => fail && fail(),
  setStorage: ({ complete }) => complete && complete(),
  getFileSystemManager: () => ({
    access: () => {},
    accessSync: () => {
      throw new Error('no file')
    },
    readdirSync: () => []
  })
}

const mb = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')
const cn = require('../subpackages/monitor-pages/space-notices/utils/china-notices.js')
const ccn = require('../cloudfunctions/spaceNotices/china-notices.js')
const disc = require('../cloudfunctions/spaceNotices/discover-china-firs.js')
const {
  decorateNotice,
  decorateSpaceNoticeEntry,
  spaceNoticeDisplayTitle,
  sortNotices,
  buildStats,
  toNoticeListRow,
  toNoticeCard
} = require('../subpackages/monitor-pages/space-notices/utils/notice-format.js')

const junk = [
  null,
  undefined,
  {},
  { areas: null },
  { areas: [null, 'x', []] },
  { noticeKey: 'a', areas: [[[NaN, NaN]]] },
  { noticeKey: 'b', centerline: [1] },
  { type: 1, areas: [[[100, 38], [101, 38], [101, 39]]] }
]

let n = 0
let failed = 0
function run(name, fn) {
  try {
    fn()
    n += 1
  } catch (e) {
    failed += 1
    console.error('THROW', name, e && e.message)
  }
}

junk.forEach((j, i) => {
  run('poly ' + i, () => mb.buildPolygonsFromNotices([j], { NOTAM: true }, { preview: true }))
  run('line ' + i, () => mb.buildPolylinesFromNotices([j], { NOTAM: true }, { preview: true }))
  run('hit ' + i, () => mb.hitNoticeAt([j], 38, 100))
  run('fit ' + i, () => mb.fitNotice(j))
  run('marker ' + i, () => mb.buildNoticeMarker(j, 'x'))
  run('hasGeo ' + i, () => mb.hasGeometry(j))
  run('china ' + i, () => cn.filterChinaNotices([j]))
  run('cchina ' + i, () => ccn.filterChinaNotices([j]))
  run('dec ' + i, () => decorateNotice(j, mb.hasGeometry))
})

run('hit empty', () => mb.hitNoticeAt(null, 'x', 'y'))
run('hit inf', () => mb.hitNoticeAt([], Infinity, Infinity))
run('fitCenter china empty', () => mb.fitCenter(null, [], [], { region: 'china' }))
run('fitCenter china junk poly', () =>
  mb.fitCenter(null, [{ points: null }, null, { points: [null, { latitude: 36, longitude: 104 }] }], [], {
    region: 'china'
  })
)
run('buildPad null', () => mb.buildPadMarker(null, 't'))
run('sort null', () => sortNotices(null))
run('sort holes', () => sortNotices([null, { name: 'A', statusTone: 'live' }]))
run('stats empty', () => buildStats([]))
run('stats holes', () => buildStats([null, { typeTone: 'notam', statusTone: 'live' }]))
run('row null', () => toNoticeListRow(decorateNotice(null, mb.hasGeometry)))
run('card empty', () => toNoticeCard(decorateNotice({ noticeKey: 'k', name: 'A' }, mb.hasGeometry)))
run('entry null', () => decorateSpaceNoticeEntry(null))
run('display title null', () => spaceNoticeDisplayTitle(null))
run('display title 读云端 zh', () => {
  const t = spaceNoticeDisplayTitle({
    missionName: 'Flight 13',
    missionNameZh: '第13次飞行',
    rocketName: 'Starship',
    rocketNameZh: '星舰'
  })
  if (t !== '第13次飞行') throw new Error('zh dropped: ' + t)
})
run('display title 无 zh 回落英文', () => {
  const t = spaceNoticeDisplayTitle({ missionName: 'Flight 13', rocketName: 'Starship' })
  if (t !== 'Flight 13') throw new Error('local dict leak: ' + t)
})
run('discover sitemap junk', () => disc.parseSitemapChinaPaths('not xml'))
run('discover html empty', () => disc.parseNoticePathsFromHtml(''))
run('probe empty', () => disc.buildFirProbePaths([], 0))
run('keep no dates', () => disc.noticeStillKeep({}, Date.now()))
run('china view', () => {
  if (cn.CHINA_VIEW.scale < 3 || cn.CHINA_VIEW.latitude < 30 || cn.CHINA_FIT_POINTS.length < 4) throw new Error('view')
  const cards = cn.buildChinaPreviewCards([
    { noticeKey: 'n1', rawText: 'Q) ZLHW/QWELW', name: '兰州航警', type: 'NOTAM' },
    { noticeKey: 'n2', rawText: 'Q) ZSHA/QWELW', name: '上海航警', type: 'NOTAM', areas: [[[121.4, 31.2], [121.6, 31.2], [121.6, 31.4], [121.4, 31.4]]] }
  ], (n) => !!(n && n.areas && n.areas.length), 3)
  if (!cards.length || cards[0].noticeKey !== 'n1' || cards[0].hasGeo) throw new Error('preview cards')
})
run('null pad not Null Island', () => {
  const pad = mb.resolveEffectivePad({ missionName: '中国航警公告' }, [], [])
  if (pad && pad.latitude === 0 && pad.longitude === 0) throw new Error('pad 0,0')
  if (mb.buildPadMarker({ latitude: null, longitude: null }, 'x').length) throw new Error('null marker')
  if (mb.buildPadMarker({ latitude: 0, longitude: 0 }, '中国航警公告').length) throw new Error('zero marker')
  const fit = mb.fitCenter({ latitude: null, longitude: null }, [], [], { region: 'pad' })
  if (Math.abs(fit.latitude) < 1 && Math.abs(fit.longitude) < 1) throw new Error('fit africa')
})
run('fit preview no ctx', () => cn.fitChinaPreviewMap(null, [52, 8, 136, 8]))
run('fit preview junk ctx', () => cn.fitChinaPreviewMap({}, [8, 8, 56, 8]))
run('fit preview bad padding', () => cn.fitChinaPreviewMap({ includePoints: () => {} }, 'x'))
run('fit preview throws inside', () =>
  cn.fitChinaPreviewMap({
    includePoints: () => {
      throw new Error('includePoints')
    }
  }, [52, 8, 136, 8])
)
run('preview cards junk', () => cn.buildChinaPreviewCards(junk, null, 3))
run('preview cards null', () => cn.buildChinaPreviewCards(null, null, 3))
run('core overlay fit path', () => {
  const data = { chinaPreviewCards: cn.buildChinaPreviewCards(junk, mb.hasGeometry, 3) }
  const hasCards = !!(data.chinaPreviewCards && data.chinaPreviewCards.length)
  cn.fitChinaPreviewMap({ includePoints: () => {} }, hasCards ? [52, 8, 136, 8] : [8, 8, 56, 8])
  cn.fitChinaPreviewMap({ includePoints: () => {} }, [8, 8, 56, 8])
})
run('core preview setData payload', () => {
  const notices = cn.filterChinaNotices(junk.concat([
    { noticeKey: 'n1', rawText: 'Q) ZLHW/QWELW', name: '兰州航警', type: 'NOTAM' }
  ]))
  const enabled = { NOTAM: true, TFR: true, NAVWARNING: true, BNM: true, LNM: true, ADP_LINK_FILE: true }
  const chinaPolygons = mb.buildPolygonsFromNotices(notices, enabled, { light: false, preview: true }).slice(0, 40)
  const chinaPolylines = mb.buildPolylinesFromNotices(notices, enabled, { light: false, preview: true }).slice(0, 40)
  const chinaPreviewCards = cn.buildChinaPreviewCards(notices, mb.hasGeometry, 3)
  if (!Array.isArray(chinaPolygons) || !Array.isArray(chinaPolylines) || !Array.isArray(chinaPreviewCards)) {
    throw new Error('payload not arrays')
  }
})
run('preview poly width', () => {
  const p = mb.buildPolygonsFromNotices(
    [{ noticeKey: 'n', type: 'NOTAM', areas: [[[100, 38], [101, 38], [101, 39], [100, 39]]] }],
    { NOTAM: true },
    { preview: true }
  )
  if (!p.length || p[0].strokeWidth !== 3) throw new Error('stroke ' + (p[0] && p[0].strokeWidth))
})

console.log(failed ? 'THROW-SAFETY FAIL ' + failed : 'throw-safety ok ' + n + ' calls')
process.exit(failed ? 1 : 0)
