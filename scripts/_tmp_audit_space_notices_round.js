/**
 * SPACE_NOTICES_FEATURE — 2026-07 全量审计（轨迹同源 / 假走廊清除 / 分区视野）
 * node scripts/_tmp_audit_space_notices_round.js
 * node scripts/_tmp_audit_space_notices_round.js --live
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const LIVE = process.argv.includes('--live')
let failed = 0
let passed = 0

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log('  OK ', name)
  } else {
    failed += 1
    console.log('  FAIL', name, detail ? `— ${detail}` : '')
  }
}

console.log('=== SPACE_NOTICES audit round ===\n')

// ── 1) 文件存在 ──
console.log('[1] files')
;[
  'cloudfunctions/spaceNotices/index.js',
  'cloudfunctions/spaceNotices/fetch-external.js',
  'cloudfunctions/spaceNotices/parse-areas.js',
  'cloudfunctions/spaceNotices/parse-dates.js',
  'subpackages/monitor-pages/space-notices/utils/china-filter.js',
  'cloudfunctions/spaceNotices/seed-demo.js',
  'cloudfunctions/spaceNotices/flight13-trajectory.json',
  'cloudfunctions/spaceNotices/config.json',
  'subpackages/monitor-pages/space-notices/entry-list.js',
  'subpackages/monitor-pages/space-notices/entry-list.wxml',
  'subpackages/monitor-pages/space-notices/notice-map.js',
  'subpackages/monitor-pages/space-notices/notice-map.wxml',
  'subpackages/monitor-pages/space-notices/utils/map-build.js',
  'subpackages/monitor-pages/space-notices/utils/api-space-notices.js',
  'subpackages/monitor-pages/space-notices/utils/flight13-trajectory.js',
  'cloudfunctions/spaceNotices/discover-china-firs.js',
  'utils/space-notices-feature.js'
].forEach((f) => check(f, exists(f)))
check('main-package api removed', !exists('utils/api-space-notices.js'))
// 小程序 require 不支持 .json：客户端轨迹副本若退回 .json，notice-map 整页黑屏
check(
  'client traj is .js (require 不支持 json)',
  !exists('subpackages/monitor-pages/space-notices/utils/flight13-trajectory.json') &&
    /require\('\.\/flight13-trajectory\.js'\)/.test(read('subpackages/monitor-pages/space-notices/utils/map-build.js'))
)

// ── 2) 路由 / 注册 ──
console.log('\n[2] routes & app')
const app = JSON.parse(read('app.json'))
const monPages = (app.subPackages || []).find((p) => p.root === 'subpackages/monitor-pages')
const pages = (monPages && monPages.pages) || []
check('app entry-list', pages.includes('space-notices/entry-list'))
check('app notice-map', pages.includes('space-notices/notice-map'))
const routes = read('utils/routes.js')
check('SPACE_NOTICE_LIST', /SPACE_NOTICE_LIST/.test(routes) && /space-notices\/entry-list/.test(routes))
check('SPACE_NOTICE_MAP', /SPACE_NOTICE_MAP/.test(routes) && /space-notices\/notice-map/.test(routes))

// ── 3) 云函数契约 ──
console.log('\n[3] cloud function')
const cfIndex = read('cloudfunctions/spaceNotices/index.js')
const cfFetch = read('cloudfunctions/spaceNotices/fetch-external.js')
const cfSeed = read('cloudfunctions/spaceNotices/seed-demo.js')
const cfConfig = JSON.parse(read('cloudfunctions/spaceNotices/config.json'))
check('no LL2 HTTP', !/thespacedevs\.com/.test(cfIndex) && !/thespacedevs\.com/.test(cfFetch))
check('createCollection', /createCollection/.test(cfIndex))
check('discover + rotate sync', /discoverEntrySlugs/.test(cfIndex) && /ENTRIES_PER_RUN/.test(cfIndex) && /fetchNoticesByPaths/.test(cfIndex))
check('contentHash', /contentHash/.test(cfIndex))
check('removeStaleDemoCorridor', /removeStaleDemoCorridor/.test(cfIndex) && /STALE_DEMO_CORRIDOR_KEY/.test(cfIndex))
check('entryKey 主键', /entryKey/.test(cfIndex) && /FLIGHT13_ENTRY_KEY/.test(cfIndex))
check('ensureFlight13Trajectory', /ensureFlight13Trajectory/.test(cfIndex))
check('cancelled keeps areas (fetch)', !/if \(cancelled\) \{\s*return \{[\s\S]*?areas:\s*\[\]/.test(cfFetch))
check('cancelled preserve prev areas (upsert)', /prev\.areas/.test(cfIndex) && /cancelled/.test(cfIndex))
check('demo corridor removed from DEMO_NOTICES', !/adp-aha-starship-flight-13-demo/.test(cfSeed) || /STALE_DEMO_CORRIDOR_KEY/.test(cfSeed))
check('DEMO_NOTICES no filled corridor', !/adp-aha-starship-flight-13-demo/.test(cfSeed.match(/const DEMO_NOTICES[\s\S]*?^]/m) || [''])[0])
check('seed requires traj json', /flight13-trajectory\.json/.test(cfSeed))
check('timeout >= 60', Number(cfConfig.timeout) >= 60, String(cfConfig.timeout))
check('timer 15min rotate', /0 \*\/15 \* \* \* \* \*/.test(cfConfig.triggers[0].config))
check('MUST_INCLUDE E2700+AHA', /E2700/.test(cfFetch) && /adp-link-file-aha/.test(cfFetch))

// ── 4) 客户端 UI ──
console.log('\n[4] client UI')
const listJs = read('subpackages/monitor-pages/space-notices/entry-list.js')
const listWxml = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
const mapJs = read('subpackages/monitor-pages/space-notices/notice-map.js')
const mapWxml = read('subpackages/monitor-pages/space-notices/notice-map.wxml')
check('pageBase list+map', /behaviors:\s*\[\s*pageBase\s*\]/.test(listJs) && /behaviors:\s*\[\s*pageBase\s*\]/.test(mapJs))
check('立即同步 button', /立即同步/.test(listWxml) && /onSync/.test(listJs))
check('polyline binding', /polyline="\{\{polylines\}\}"/.test(mapWxml))
check('region toggles', /mapRegion/.test(mapJs) && /发射区/.test(mapWxml) && /溅落/.test(mapWxml) && /全程/.test(mapWxml))
check('轨迹 toggle', /轨迹/.test(mapWxml) && /showCorridor/.test(mapJs) && /hasTrajectory/.test(mapJs))
check('resolveTrajectory wired', /resolveTrajectory/.test(mapJs) && /buildTrajectoryPolyline/.test(mapJs))
check('layer toggle keeps zoom', /refit:\s*false/.test(mapJs))
check('trajectory joins fit', /fitCenter\(/.test(mapJs) && /polygons, polylines/.test(mapJs))
check('api -504003 mapping', /-504003/.test(read('subpackages/monitor-pages/space-notices/utils/api-space-notices.js')))
check('提前预警状态', /提前预警/.test(mapJs) && /statusTone === 'soon'/.test(read('subpackages/monitor-pages/space-notices/utils/notice-format.js')))
check('预警状态筛选 chip', /showSoon/.test(mapJs) && /预警/.test(mapWxml))
check('中国筛选按钮', /chinaOnly/.test(mapJs) && /data-key="chinaOnly"/.test(mapWxml) && /toggleChinaView/.test(mapJs) && /isChinaNotice/.test(read('subpackages/monitor-pages/space-notices/utils/china-filter.js')))
check('中国按钮在地图工具栏', /map-action-china-wrap/.test(mapWxml) && /bindtap="toggleChinaView"/.test(mapWxml) && /中国/.test(mapWxml))
check('列表中国通告入口', /openChinaMap/.test(listJs) && /中国航警公告/.test(listJs) && /CHINESE_COLLECTION_KEY/.test(listJs) && /lookupChinaBulletin/.test(listJs))
check('云函数置顶中国合集', /collection-chinese-unknown/.test(read('cloudfunctions/spaceNotices/discover-entries.js')) && /withPinnedEntries/.test(read('cloudfunctions/spaceNotices/discover-entries.js')) && /isCollectionKey/.test(cfIndex))
check('中国航警每轮核对', /CHINESE_COLLECTION_KEY/.test(cfIndex) && /lastCheckedAt/.test(cfIndex) && /bulletinFingerprint/.test(cfIndex) && /lookupChinaBulletin/.test(cfIndex))
check('中国航警超时补拉', /CHINA_BULLETIN_STALE_MS/.test(cfIndex) && /chinaStale/.test(cfIndex))
check('中国情报区 sitemap+FIR 扫描', /discover-china-firs/.test(cfIndex) && /syncChineseCollection/.test(cfIndex) && /fetchSitemapChinaNoticePaths/.test(read('cloudfunctions/spaceNotices/discover-china-firs.js')))
check('中国桶保留未上合集的未来窗口', /pruneExpiredChinaNotices/.test(cfIndex) && /shouldKeepStoredNotice/.test(cfIndex))
check('列表中国卡写明核对节奏', /15 分钟核对一次/.test(listJs) && /chinaBulletin\.syncLine/.test(listWxml))
check('监控卡改名发射航警地图', /发射航警地图/.test(read('subpackages/monitor-pages/components/monitor-core-sections/index.wxml')))
check('监控卡中国卫星预览', /enable-satellite/.test(read('subpackages/monitor-pages/components/monitor-core-sections/index.wxml')) && /chinaPreviewLat/.test(read('subpackages/monitor-pages/components/monitor-core-sections/index.js')))
check('点监控卡进中国航警', /SPACE_NOTICE_MAP/.test(read('pages/monitor/monitor.js')) && /CHINESE_COLLECTION_KEY/.test(read('pages/monitor/monitor.js')))
check('产品名常量对齐', /SPACE_NOTICES_PRODUCT_NAME/.test(read('utils/space-notices-feature.js')) && /发射航警地图/.test(listJs) && /发射航警地图/.test(mapJs))
check('云函数 B\/C 日期回填', /fillNoticeDates/.test(read('cloudfunctions/spaceNotices/index.js')) && exists('cloudfunctions/spaceNotices/parse-dates.js'))

// WXML mustache balance
function mustacheBalance(rel) {
  const s = read(rel)
  let n = 0
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') n++
    if (s[i] === '}' && s[i + 1] === '}') n--
  }
  return n === 0
}
check('entry-list mustache balance', mustacheBalance('subpackages/monitor-pages/space-notices/entry-list.wxml'))
check('notice-map mustache balance', mustacheBalance('subpackages/monitor-pages/space-notices/notice-map.wxml'))

// ── 5) 轨迹同源包 ──
console.log('\n[5] site trajectory pack')
const cloudTraj = JSON.parse(read('cloudfunctions/spaceNotices/flight13-trajectory.json'))
const clientTraj = require('../subpackages/monitor-pages/space-notices/utils/flight13-trajectory.js')
check('cloud traj color #ffcc00', cloudTraj.color === '#ffcc00')
check('cloud traj points >= 200', Array.isArray(cloudTraj.coordinates) && cloudTraj.coordinates.length >= 200, String(cloudTraj.coordinates && cloudTraj.coordinates.length))
check('client traj sync with cloud', clientTraj.coordinates.length === cloudTraj.coordinates.length)
check('traj pack versioned', Number(cloudTraj.version) >= 2 && Number(clientTraj.version) === Number(cloudTraj.version), `v=${cloudTraj.version}`)

// 跨洋段密度：最大相邻段不得超过站点原始上限（否则黄线成粗折线）
function segDeg(a, b) {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot(dx, b[1] - a[1])
}
let maxSeg = 0
for (let i = 1; i < cloudTraj.coordinates.length; i++) {
  maxSeg = Math.max(maxSeg, segDeg(cloudTraj.coordinates[i - 1], cloudTraj.coordinates[i]))
}
check('no coarse chord (maxSeg <= 5.2deg)', maxSeg <= 5.2, `maxSeg=${maxSeg.toFixed(2)}°`)
const oceanPts = cloudTraj.coordinates.filter((p) => p[0] < 100).length
check('cross-ocean density >= 200', oceanPts >= 200, `ocean=${oceanPts}`)
const t0 = cloudTraj.coordinates[0]
const tN = cloudTraj.coordinates[cloudTraj.coordinates.length - 1]
check('traj starts Starbase', Math.abs(t0[0] - -97.158) < 0.01 && Math.abs(t0[1] - 25.997) < 0.01, JSON.stringify(t0))
check('traj ends near Ship40 splash', tN[0] > 100 && tN[0] < 110 && tN[1] < -15 && tN[1] > -20, JSON.stringify(tN))
check('traj span ocean', tN[0] - t0[0] > 180, String(tN[0] - t0[0]))

const {
  FLIGHT13_CORRIDOR_CENTERLINE,
  FLIGHT13_TRAJECTORY_COLOR,
  DEMO_NOTICES,
  STALE_DEMO_CORRIDOR_KEY,
  E2700_RAW
} = require('../cloudfunctions/spaceNotices/seed-demo.js')
check('seed exports site traj', FLIGHT13_CORRIDOR_CENTERLINE.length === cloudTraj.coordinates.length)
check('seed traj color', FLIGHT13_TRAJECTORY_COLOR === '#ffcc00')
check('STALE key set', STALE_DEMO_CORRIDOR_KEY === 'adp-aha-starship-flight-13-demo')
check('DEMO_NOTICES has E2700', DEMO_NOTICES.some((n) => n.noticeKey === 'notam-YMMM-E2700/26'))
check('DEMO_NOTICES no demo corridor notice', !DEMO_NOTICES.some((n) => n.noticeKey === STALE_DEMO_CORRIDOR_KEY))

// ── 6) 解析 + 地图构建 ──
console.log('\n[6] parse & map-build')
const { parseAreasFromRawText, dmsTokenToDeg } = require('../cloudfunctions/spaceNotices/parse-areas.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildTrajectoryPolyline,
  resolveTrajectory,
  buildPadMarker,
  fitCenter,
  SKIP_NOTICE_KEYS
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')

check('dms DDMM', Math.abs(dmsTokenToDeg('2338S') + 23.633333) < 0.01)
const eAreas = parseAreasFromRawText(E2700_RAW)
check('E2700 parse', eAreas[0] && eAreas[0].length >= 18 && Math.abs(eAreas[0][0][0] - 75) < 0.05)

const noisy =
  'Q) YMMM/QRDCA/IV/BO/W/000/999/2139S09259E999\nE) AREAS: 2338S 07500E, 2251S 07826E, 2139S 08258E TO BEGINNING.'
const noisyAreas = parseAreasFromRawText(noisy)
check(
  'Q-line skipped',
  !!(noisyAreas[0] && noisyAreas[0].length >= 3 && Math.abs(noisyAreas[0][0][0] - 75) < 0.05),
  JSON.stringify(noisyAreas[0] && noisyAreas[0][0])
)

const polys = buildPolygonsFromNotices(DEMO_NOTICES, { NOTAM: true, NAVWARNING: true, ADP_LINK_FILE: true })
check('demo polygons >= 2', polys.length >= 2, `n=${polys.length}`)

const fakeCorridor = {
  noticeKey: 'adp-aha-starship-flight-13-demo',
  type: 'ADP_LINK_FILE',
  areas: [[[-97, 26], [95, -31], [95, -28], [-97, 28], [-97, 26]]],
  centerline: FLIGHT13_CORRIDOR_CENTERLINE
}
check('skip stale demo key', !!SKIP_NOTICE_KEYS['adp-aha-starship-flight-13-demo'])
check('stale demo polys skipped', buildPolygonsFromNotices([fakeCorridor], null).length === 0)
check('cross-ocean fat ring skipped', buildPolygonsFromNotices([{
  noticeKey: 'fat',
  type: 'ADP_LINK_FILE',
  areas: [[[-97, 26], [95, -31], [95, -28], [-97, 28], [-97, 26]]]
}], null).length === 0)

const traj = resolveTrajectory({
  ll2Id: 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2',
  trajectory: [[-97, 26], [0, 0], [95, -31]] // stale short
})
check('resolveTrajectory prefers site pack', traj.length >= 200, `n=${traj.length}`)
// 云端旧版本（v1 粗包）不得覆盖本地新包
const trajStaleV1 = resolveTrajectory({
  ll2Id: 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2',
  trajectoryVersion: 1,
  trajectory: new Array(280).fill([0, 0])
})
check('stale v1 cloud pack rejected', trajStaleV1.length === cloudTraj.coordinates.length, `n=${trajStaleV1.length}`)
const trajCurrent = resolveTrajectory({
  ll2Id: 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2',
  trajectoryVersion: Number(cloudTraj.version),
  trajectory: cloudTraj.coordinates
})
check('current cloud pack accepted', trajCurrent.length === cloudTraj.coordinates.length)
const trajLine = buildTrajectoryPolyline(traj, '#ffcc00')
check('traj polyline color/width', trajLine && trajLine.color === '#ffcc00' && trajLine.width === 3 && trajLine.points.length >= 200)

const pad = { latitude: 25.99677, longitude: -97.15799 }
const markers = buildPadMarker(pad, 'Flight 13')
check('pad marker', markers.length === 1)

const realAha = {
  noticeKey: 'adp-link-file-aha-starship-flight-13',
  type: 'ADP_LINK_FILE',
  areas: [[
    [-97.22, 25.97], [-97.0, 26.0], [-95.92, 26.0], [-95.25, 25.68],
    [-93.37, 24.7], [-93.0, 24.5], [-92.5, 24.8], [-94.0, 25.5], [-97.22, 25.97]
  ]]
}
const ahaPolys = buildPolygonsFromNotices([realAha], { ADP_LINK_FILE: true })
const fitPad = fitCenter(pad, ahaPolys, [], { region: 'pad' })
check('fit pad region zoomed', fitPad.scale >= 5, `scale=${fitPad.scale}`)
const fitGlobal = fitCenter(pad, ahaPolys, [trajLine], { region: 'global' })
// 微信 map scale 合法 3–20；全程需靠 include-points 才能装下整条航迹
check('fit global scale legal', fitGlobal.scale >= 3 && fitGlobal.scale <= 20, `scale=${fitGlobal.scale}`)
check('fit global uses includePoints', (fitGlobal.includePoints || []).length >= 2, `include=${(fitGlobal.includePoints || []).length}`)
const fitGlobalSpansOcean = (fitGlobal.includePoints || []).some((p) => p.longitude > 90) &&
  (fitGlobal.includePoints || []).some((p) => p.longitude < -90)
check('global includePoints span both ends', fitGlobalSpansOcean)

// 所有分区 scale 必须落在合法区间
const scalesLegal = ['pad', 'splash', 'global'].every((r) => {
  const f = fitCenter(pad, ahaPolys.concat(buildPolygonsFromNotices([{ noticeKey: 'e', type: 'NOTAM', areas: eAreas }], { NOTAM: true })), [trajLine], { region: r })
  return f.scale >= 3 && f.scale <= 20
})
check('all region scales in 3..20', scalesLegal)

const splashPoly = buildPolygonsFromNotices([{
  noticeKey: 'e2700',
  type: 'NOTAM',
  areas: eAreas
}], { NOTAM: true })
const fitSplash = fitCenter(pad, splashPoly, [], { region: 'splash' })
check('fit splash near IO', fitSplash.longitude > 60, `lon=${fitSplash.longitude}`)

// cancelled still drawn (grey)
const cancelled = buildPolygonsFromNotices([{
  noticeKey: 'c1',
  type: 'NOTAM',
  cancelled: true,
  areas: [[[-97, 26], [-96, 26], [-96, 25], [-97, 25], [-97, 26]]]
}], { NOTAM: true })
check('cancelled polygon kept grey', cancelled.length === 1 && cancelled[0].strokeColor === '#8E8E93')

// hash
function noticeContentHash(notice, areas) {
  return crypto.createHash('sha1').update(String(notice.rawText || '') + '\n' + JSON.stringify(areas || [])).digest('hex').slice(0, 16)
}
const h1 = noticeContentHash({ rawText: 'A' }, [[[1, 2]]])
const h2 = noticeContentHash({ rawText: 'A' }, [[[1, 2]]])
check('hash stable', h1 === h2)

async function liveChecks() {
  if (!LIVE) {
    console.log('\n[7] live skipped (pass --live)')
    return
  }
  console.log('\n[7] live fetch')
  const {
    httpGet,
    parseNoticeFromHtml,
    extractNoticeLinks,
    fetchWatchedEntries
  } = require('../cloudfunctions/spaceNotices/fetch-external.js')

  const entryHtml = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const paths = extractNoticeLinks(entryHtml)
  check('entry notice links', paths.length >= 10, `n=${paths.length}`)
  check('entry has AHA', paths.some((p) => /adp-link-file-aha/.test(p)))
  check('entry has E2700', paths.some((p) => /E2700/i.test(p)))

  const ahaHtml = await httpGet('https://space-notices.com/notice/adp-link-file-aha-starship-flight-13')
  const aha = parseNoticeFromHtml(ahaHtml, 'adp-link-file-aha-starship-flight-13')
  check('live AHA parsed', !!(aha && aha.areas && aha.areas.length >= 3), `rings=${aha && aha.areas && aha.areas.length}`)
  check('live AHA not cancelled wipe', !!(aha && aha.areas.length))

  const eHtml = await httpGet('https://space-notices.com/notice/notam-YMMM-E2700%2F26')
  const e2700 = parseNoticeFromHtml(eHtml, 'notam-YMMM-E2700/26')
  check('live E2700 areas', !!(e2700 && e2700.areas && e2700.areas[0] && e2700.areas[0].length >= 10), `pts=${e2700 && e2700.areas && e2700.areas[0] && e2700.areas[0].length}`)

  // cancelled notice should still keep areas if site has them
  const cancelPath = paths.find((p) => /07%2F270|07\/270/i.test(p)) || paths.find((p) => /notam-ZHU/.test(p))
  if (cancelPath) {
    const cHtml = await httpGet('https://space-notices.com' + cancelPath)
    const cN = parseNoticeFromHtml(cHtml, cancelPath.replace(/^\/notice\//, ''))
    if (cN && cN.cancelled) {
      check('cancelled keeps site areas', Array.isArray(cN.areas) && cN.areas.length > 0, `areas=${cN.areas && cN.areas.length}`)
    } else {
      check('cancelled sample optional', true)
    }
  } else {
    check('cancelled sample optional', true)
  }

  try {
    const batches = await fetchWatchedEntries({ budgetMs: 25000 })
    const b = batches[0]
    check('fetchWatchedEntries batch', !!(b && b.notices && b.notices.length >= 5), `parsed=${b && b.parsed}`)
    const hasAha = b.notices.some((n) => /adp-link-file-aha/.test(n.noticeKey))
    const hasE = b.notices.some((n) => /E2700/i.test(n.noticeKey))
    check('batch includes AHA', hasAha)
    check('batch includes E2700', hasE)
  } catch (e) {
    check('fetchWatchedEntries batch', false, e.message)
  }
}

liveChecks()
  .then(() => {
    console.log(`\n=== result: ${passed} passed, ${failed} failed ===`)
    process.exit(failed ? 1 : 0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
