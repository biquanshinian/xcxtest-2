/**
 * SPACE_NOTICES_FEATURE — 深度运行审计（本地可跑，目标全绿）
 * node scripts/_tmp_audit_space_notices_deep.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`)
}

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8')
}

function exists(p) {
  return fs.existsSync(path.join(ROOT, p))
}

// ── 1) 文件齐全 ──
const REQUIRED = [
  'utils/space-notices-feature.js',
  'utils/routes.js',
  'cloudfunctions/spaceNotices/index.js',
  'cloudfunctions/spaceNotices/read-ll2-cache.js',
  'cloudfunctions/spaceNotices/pad-coords.js',
  'cloudfunctions/spaceNotices/parse-areas.js',
  'cloudfunctions/spaceNotices/fetch-external.js',
  'cloudfunctions/spaceNotices/seed-demo.js',
  'cloudfunctions/spaceNotices/config.json',
  'cloudfunctions/spaceNotices/package.json',
  'subpackages/monitor-pages/space-notices/entry-list.js',
  'subpackages/monitor-pages/space-notices/entry-list.wxml',
  'subpackages/monitor-pages/space-notices/entry-list.wxss',
  'subpackages/monitor-pages/space-notices/entry-list.json',
  'subpackages/monitor-pages/space-notices/notice-map.js',
  'subpackages/monitor-pages/space-notices/notice-map.wxml',
  'subpackages/monitor-pages/space-notices/notice-map.wxss',
  'subpackages/monitor-pages/space-notices/notice-map.json',
  'subpackages/monitor-pages/space-notices/utils/api-space-notices.js',
  'subpackages/monitor-pages/space-notices/utils/map-build.js'
]
check(
  'required files exist',
  REQUIRED.every(exists),
  REQUIRED.filter((p) => !exists(p)).join(', ') || 'all present'
)
check('main-package api-space-notices.js removed', !exists('utils/api-space-notices.js'))

// ── 2) 语法 ──
const jsTargets = REQUIRED.filter((p) => p.endsWith('.js'))
const synFails = []
for (const f of jsTargets) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  if (r.status !== 0) synFails.push(f)
}
check('JS syntax', synFails.length === 0, synFails.join(', ') || 'ok')

// ── 3) 接线 ──
const appJson = JSON.parse(read('app.json'))
const monPkg = (appJson.subPackages || []).find((p) => /monitor-pages/.test(p.root || ''))
const pages = (monPkg && monPkg.pages) || []
check('app.json registers entry-list', pages.includes('space-notices/entry-list'))
check('app.json registers notice-map', pages.includes('space-notices/notice-map'))

const routes = read('utils/routes.js')
check('routes SPACE_NOTICE_LIST', /SPACE_NOTICE_LIST:\s*'\/subpackages\/monitor-pages\/space-notices\/entry-list'/.test(routes))
check('routes SPACE_NOTICE_MAP', /SPACE_NOTICE_MAP:\s*'\/subpackages\/monitor-pages\/space-notices\/notice-map'/.test(routes))

const monJs = read('pages/monitor/monitor.js')
const monWxml = read('pages/monitor/monitor.wxml')
check('monitor imports feature flag', /space-notices-feature/.test(monJs))
check('monitor has enableSpaceNotices data', /enableSpaceNotices/.test(monJs))
check('monitor openSpaceNotices', /openSpaceNotices/.test(monJs))
check('monitor openSpaceNotices gateCheck', /gateCheck\('space_notices',\s*SPACE_NOTICES_PRODUCT_NAME\)/.test(monJs) && /发射航警地图/.test(read('utils/space-notices-feature.js')))
check('monitor wxml 入口开关', /enableSpaceNotices/.test(monWxml) && /onCoreSectionEvent/.test(monWxml))
const coreWxml = read('subpackages/monitor-pages/components/monitor-core-sections/index.wxml')
check(
  'monitor 板块分享图标',
  /data-share-type="spaceNotices"/.test(coreWxml) && /icon-share--monitor/.test(coreWxml)
)
check('monitor 中国卫星预览', /sn-preview-sat/.test(coreWxml) && /发射航警地图/.test(coreWxml) && /中国航警公告/.test(coreWxml) && !/<map[\s>]/.test(coreWxml))
check('monitor 分享深链到中国航警地图', /type === 'spaceNotices'/.test(monJs) && /SPACE_NOTICE_MAP/.test(monJs) && /CHINESE_COLLECTION_KEY/.test(monJs))
check('monitor 分享带 sst 时间戳', /spaceNotices[\s\S]{0,800}sst=/.test(monJs))

// ── 列表/详情会员门控 ──
const listJsGate = read('subpackages/monitor-pages/space-notices/entry-list.js')
const mapJsGate = read('subpackages/monitor-pages/space-notices/notice-map.js')
const listJsonGate = read('subpackages/monitor-pages/space-notices/entry-list.json')
const mapJsonGate = read('subpackages/monitor-pages/space-notices/notice-map.json')
const listWxmlGate = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
const mapWxmlGate = read('subpackages/monitor-pages/space-notices/notice-map.wxml')
check('列表 checkShareEntryGate', /checkShareEntryGate\(this,\s*options,\s*'space_notices'/.test(listJsGate) || /GATE_PRODUCT_ID/.test(listJsGate) && /checkShareEntryGate/.test(listJsGate))
check('列表 productId space_notices', /space_notices/.test(listJsGate))
check('列表 冷启动 gateCheck', /getCurrentPages/.test(listJsGate) && /gateCheck\(GATE_PRODUCT_ID/.test(listJsGate))
check('列表 withShareStampPath', /withShareStampPath/.test(listJsGate))
check('详情 checkShareEntryGate', /checkShareEntryGate/.test(mapJsGate) && /space_notices/.test(mapJsGate))
check('详情 冷启动 gateCheck', /getCurrentPages/.test(mapJsGate) && /gateCheck\(GATE_PRODUCT_ID/.test(mapJsGate))
check('详情 withShareStampPath', /withShareStampPath/.test(mapJsGate))
check('列表注册 share-gate-countdown', /share-gate-countdown/.test(listJsonGate) && /share-gate-countdown/.test(listWxmlGate))
check('详情注册 share-gate-countdown', /share-gate-countdown/.test(mapJsonGate) && /share-gate-countdown/.test(mapWxmlGate))

// ── 4) 云函数契约 ──
const cfIndex = read('cloudfunctions/spaceNotices/index.js')
const cfCache = read('cloudfunctions/spaceNotices/read-ll2-cache.js')
const cfConfig = read('cloudfunctions/spaceNotices/config.json')
check('createCollection used', /createCollection/.test(cfIndex))
check('no LL2 HTTPS fetch', !/thespacedevs\.com/.test(cfIndex) && !/thespacedevs\.com/.test(cfCache))
check('no LL2_API_TOKEN in config', !/LL2_API_TOKEN/.test(cfConfig))
check('reads space_devs_cache', /space_devs_cache/.test(cfCache))
check('ensureCollections before DB actions', /if \(action !== 'parsePreview'\) await ensureCollections\(\)/.test(cfIndex))
check('ingestRaw secret gated', /SPACE_NOTICES_INGEST_SECRET/.test(cfIndex) && /forbidden/.test(cfIndex))
check('sync throttled', /SYNC_COOLDOWN_MS/.test(cfIndex))
check('getEntry on-demand sync', /entryKeys:\s*\[target\]/.test(cfIndex) && /FLIGHT13_ENTRY_KEY/.test(cfIndex))
check('upsertNotice preserves createdAt', /createdAt:\s*\(prev && prev\.createdAt\)/.test(cfIndex))
const padCoordsSrc = read('cloudfunctions/spaceNotices/pad-coords.js')
check(
  'pad regex tightened',
  /orbital launch pad\\s\*2/i.test(padCoordsSrc) &&
    /slc\[- \]\?4e/i.test(padCoordsSrc) &&
    // 短名 pad 2 已移除，避免把其它场地的 Pad 2 误标到 Starbase
    !/pad\\s\*2\(\?:\\b\|\$\)/i.test(padCoordsSrc)
)
check('read-ll2-cache uses pad-coords', /pad-coords\.js/.test(cfCache))

// ── 5) 客户端 UI 契约 ──
const listJs = read('subpackages/monitor-pages/space-notices/entry-list.js')
const listWxml = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
const listWxss = read('subpackages/monitor-pages/space-notices/entry-list.wxss')
const mapJs = read('subpackages/monitor-pages/space-notices/notice-map.js')
const mapWxml = read('subpackages/monitor-pages/space-notices/notice-map.wxml')
const mapWxss = read('subpackages/monitor-pages/space-notices/notice-map.wxss')

check('entry-list uses pageBase', /behaviors:\s*\[\s*pageBase\s*\]/.test(listJs) && /initUiShell\(\)/.test(listJs))
check('notice-map uses pageBase', /behaviors:\s*\[\s*pageBase\s*\]/.test(mapJs) && /initUiShell\(\)/.test(mapJs))
check('entry-list api from subpackage', /\.\/utils\/api-space-notices/.test(listJs))
check('notice-map api from subpackage', /\.\/utils\/api-space-notices/.test(mapJs))
check('entry-list skeleton', /detail-skeleton/.test(listWxml) && /skeleton-shimmer/.test(listWxml))
check('entry-list list-page + themeClass', /class="list-page \{\{themeClass\}\}"/.test(listWxml))
check('entry-list theme-light overrides', /\.list-page\.theme-light/.test(listWxss) && /\.theme-light \.glass-card/.test(listWxss))
check('notice-map map-page root', /class="map-page[^"]*\{\{themeClass\}\}"/.test(mapWxml))
check('notice-map theme-light overrides', /\.theme-light \.glass-card/.test(mapWxss))
check('notice-map error state UI', /errorText/.test(mapWxml) && /retryLoad/.test(mapWxml))
check('page-meta pageBgColor both pages', /pageBgColor/.test(listWxml) && /pageBgColor/.test(mapWxml))
check('notice-map polyline binding', /polyline="\{\{polylines\}\}"/.test(mapWxml))
check('notice-map corridor toggle', /showCorridor/.test(mapJs) && /轨迹/.test(mapWxml) && /hasTrajectory/.test(mapJs))
check('getEntry ensure demo notices', /ensureDemoNotices/.test(cfIndex) && /DEMO_NOTICES/.test(cfIndex))
check('seed includes E2700 splashdown', /notam-YMMM-E2700\/26/.test(read('cloudfunctions/spaceNotices/seed-demo.js')))
check('fetch-external module exists', exists('cloudfunctions/spaceNotices/fetch-external.js'))
check('sync calls discover+fetchNoticesByPaths', /discoverEntrySlugs/.test(cfIndex) && /fetchNoticesByPaths/.test(cfIndex))
check('upsert uses contentHash', /contentHash/.test(cfIndex))
check('discover-entries module', exists('cloudfunctions/spaceNotices/discover-entries.js'))
check('match-ll2 module', exists('cloudfunctions/spaceNotices/match-ll2.js'))

// ── 6) 解析器 + 地图构建运行时 ──
const { parseAreasFromRawText, dmsCompactToDeg } = require('../cloudfunctions/spaceNotices/parse-areas.js')
const {
  DEMO_NOTICES,
  FLIGHT13_LL2_ID,
  FLIGHT13_CORRIDOR_CENTERLINE
} = require('../cloudfunctions/spaceNotices/seed-demo.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildPadMarker,
  fitCenter
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')

const dms = dmsCompactToDeg('243400N')
check('dmsCompactToDeg lat', dms != null && Math.abs(dms - 24.566666) < 0.01, String(dms))
const dmsLon = dmsCompactToDeg('0910100W')
check('dmsCompactToDeg lon', dmsLon != null && Math.abs(dmsLon - -91.016666) < 0.01, String(dmsLon))

const notamDemo = DEMO_NOTICES.find((n) => n.type === 'NOTAM')
const parsed = parseAreasFromRawText(notamDemo.rawText)
check('parse demo NOTAM ring', parsed.length === 1 && parsed[0].length >= 7, `rings=${parsed.length} pts=${parsed[0] && parsed[0].length}`)

const e2700Demo = DEMO_NOTICES.find((n) => n.noticeKey === 'notam-YMMM-E2700/26')
check(
  'E2700 areas auto-parsed',
  !!(e2700Demo && e2700Demo.areas && e2700Demo.areas[0] && e2700Demo.areas[0].length >= 18 && Math.abs(e2700Demo.areas[0][0][0] - 75) < 0.05),
  `pts=${e2700Demo && e2700Demo.areas && e2700Demo.areas[0] && e2700Demo.areas[0].length}`
)

// 假的跨洋粗走廊已下线：黄线改由 flight13-trajectory.json（站点同源）单独成层
const corridorDemo = DEMO_NOTICES.find((n) => n.noticeKey === 'adp-aha-starship-flight-13-demo')
check('demo corridor retired', !corridorDemo)
const trajPack = JSON.parse(read('cloudfunctions/spaceNotices/flight13-trajectory.json'))
check(
  'centerline export matches site pack',
  FLIGHT13_CORRIDOR_CENTERLINE.length === trajPack.coordinates.length,
  `${FLIGHT13_CORRIDOR_CENTERLINE.length}/${trajPack.coordinates.length}`
)

const polys = buildPolygonsFromNotices(DEMO_NOTICES, {
  NOTAM: true,
  NAVWARNING: true,
  ADP_LINK_FILE: true
})
check('map polygons from demo', polys.length >= 3, `count=${polys.length}`)
check('polygon points shape', polys.every((p) => p.points.length >= 3 && p.points[0].latitude != null))

const {
  buildTrajectoryPolyline
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')
const lines = buildPolylinesFromNotices(DEMO_NOTICES, { ADP_LINK_FILE: true })
check('no fake corridor polyline', lines.length === 0, `n=${lines.length}`)
const trajLine = buildTrajectoryPolyline(FLIGHT13_CORRIDOR_CENTERLINE)
check(
  'trajectory polyline from site pack',
  !!trajLine && trajLine.points.length === FLIGHT13_CORRIDOR_CENTERLINE.length && trajLine.color === '#ffcc00',
  trajLine && `pts=${trajLine.points.length}`
)

const pad = { name: 'Orbital Launch Pad 2', latitude: 25.99677, longitude: -97.15799 }
const markers = buildPadMarker(pad, 'Starship | Flight 13')
check('pad marker', markers.length === 1 && markers[0].latitude === 25.99677)
// 默认 pad 分区：不再被跨洋轨迹拉成世界视野，scale 必须落在 map 合法区间
const center = fitCenter(pad, polys, [trajLine])
check(
  'fitCenter pad region legal scale',
  center.scale >= 3 &&
    center.scale <= 20 &&
    Number.isFinite(center.latitude) &&
    (center.includePoints || []).length >= 1 &&
    Math.abs(center.latitude - pad.latitude) < 0.001,
  `scale=${center.scale} include=${(center.includePoints || []).length} lat=${center.latitude}`
)
const globalCenter = fitCenter(pad, polys, [trajLine], { region: 'global' })
check(
  'fitCenter global spans ocean',
  globalCenter.scale >= 3 && globalCenter.includePoints.length >= 2 &&
    Math.max(...globalCenter.includePoints.map((p) => p.longitude)) > 90,
  `scale=${globalCenter.scale}`
)

const toggledOff = buildPolygonsFromNotices(DEMO_NOTICES, {
  NOTAM: false,
  NAVWARNING: false,
  ADP_LINK_FILE: false
})
check('layer toggle filters', toggledOff.length === 0)
const linesOff = buildPolylinesFromNotices(DEMO_NOTICES, { ADP_LINK_FILE: false })
check('polyline layer toggle', linesOff.length === 0)

// ── 7) pad 坐标解析（生产纯模块 pad-coords.js）──
const {
  resolvePadCoords,
  isStarshipLaunch,
  slimFromCacheRow
} = require('../cloudfunctions/spaceNotices/pad-coords.js')
const p2 = resolvePadCoords({ name: 'Orbital Launch Pad 2', location: { name: 'Starbase' } })
const p1 = resolvePadCoords({ name: 'Orbital Launch Pad 1' })
const pSb = resolvePadCoords({ name: '', location: { name: 'SpaceX Starbase' } })
check('pad2 coords', p2.latitude === 25.99677)
check('pad1 coords', p1.latitude === 25.9962)
check('starbase fallback coords', pSb.latitude === 25.9972)
check('pad2 != pad1', p2.latitude !== p1.latitude)
const p4e = resolvePadCoords({
  name: 'Space Launch Complex 4E',
  location: { name: 'Vandenberg SFB, CA, USA' }
})
check('SLC-4E coords', Math.abs(p4e.latitude - 34.632) < 0.05)
const pWen = resolvePadCoords({ name: 'Commercial LC-1', location: { name: 'Wenchang Space Launch Site' } })
check('Wenchang location coords', Math.abs(pWen.latitude - 19.6145) < 0.05)
const mapBuildSrc = read('subpackages/monitor-pages/space-notices/utils/map-build.js')
check('pad marker 红色钉', /pad-marker-red\.png/.test(mapBuildSrc) && !/station-marker\.png/.test(mapBuildSrc))
check('chip pad 红色', /sn-chip-dot--pad[^}]*#FF3B30/.test(read('subpackages/monitor-pages/space-notices/notice-map.wxss').replace(/\s+/g, '')))
check(
  'isStarshipLaunch filter',
  isStarshipLaunch({ name: 'Starship | Flight 13', rocket: { configuration: { name: 'Starship' } } }) &&
    !isStarshipLaunch({ name: 'Falcon 9', rocket: { configuration: { name: 'Falcon 9' } } })
)
const slimRow = slimFromCacheRow({
  id: 'x1',
  name: 'Starship | Flight 99',
  rocket: { configuration: { name: 'Starship' } },
  pad: { name: 'Orbital Launch Pad 2', location: { name: 'Starbase' } },
  net: '2026-01-01T00:00:00Z'
})
check('slimFromCacheRow fills pad lat', !!(slimRow && slimRow.pad && slimRow.pad.latitude === 25.99677))

// ── 8) 内存模拟 sync/list/get（验证冷库路径逻辑）──
function mockCloudRuntime() {
  const cols = Object.create(null)
  function col(name) {
    if (!cols[name]) cols[name] = Object.create(null)
    return cols[name]
  }
  return {
    createCollection(name) {
      col(name)
      return Promise.resolve()
    },
    collection(name) {
      const store = col(name)
      return {
        doc(id) {
          return {
            get: async () => {
              if (!(id in store)) {
                const err = new Error('document not exists')
                err.errCode = -1
                throw err
              }
              return { data: store[id] }
            },
            set: async ({ data }) => {
              store[id] = { ...(data || {}), _id: id }
              return { _id: id }
            },
            update: async ({ data }) => {
              if (!(id in store)) throw new Error('not exists')
              store[id] = { ...store[id], ...data }
              return {}
            }
          }
        },
        where(q) {
          return {
            limit() {
              return {
                get: async () => {
                  const rows = Object.keys(store)
                    .map((k) => store[k])
                    .filter((d) => {
                      if (!q || !q.ll2Id) return true
                      return d.ll2Id === q.ll2Id
                    })
                  return { data: rows }
                }
              }
            }
          }
        },
        limit() {
          return {
            get: async () => ({ data: Object.keys(store).map((k) => store[k]) })
          }
        }
      }
    },
    _dump: cols
  }
}

async function runMockE2E() {
  const db = mockCloudRuntime()
  const ENTRY = 'space_notice_entry'
  const NOTICE = 'space_notice'
  const F13 = FLIGHT13_LL2_ID

  // ensure
  await db.createCollection(ENTRY)
  await db.createCollection(NOTICE)

  // sync minimal (Flight13 + demos)
  const entry = {
    ll2Id: F13,
    title: 'Starship | Flight 13',
    subtitle: 'Starship',
    net: '2026-07-24T22:45:00Z',
    pad: { name: 'Orbital Launch Pad 2', latitude: 25.99677, longitude: -97.15799 },
    noticeKeys: [],
    createdAt: 1,
    updatedAt: 1
  }
  await db.collection(ENTRY).doc(F13).set({ data: entry })
  const keys = []
  for (const n of DEMO_NOTICES) {
    const docId = n.noticeKey.replace(/[\/\\#]/g, '_')
    await db.collection(NOTICE).doc(docId).set({
      data: {
        noticeKey: n.noticeKey,
        ll2Id: F13,
        type: n.type,
        name: n.name,
        reason: n.reason,
        areas: n.areas,
        dates: n.dates || []
      }
    })
    keys.push(n.noticeKey)
  }
  await db.collection(ENTRY).doc(F13).update({ data: { noticeKeys: keys } })

  const list = await db.collection(ENTRY).limit(100).get()
  const rows = (list.data || []).filter((d) => d && !d._meta)
  check('mock list has Flight13', rows.some((r) => r.ll2Id === F13), `n=${rows.length}`)

  const got = await db.collection(ENTRY).doc(F13).get()
  const notices = await db.collection(NOTICE).where({ ll2Id: F13 }).limit(100).get()
  check('mock getEntry notices', (notices.data || []).length === DEMO_NOTICES.length)
  check('mock entry has pad lat', got.data.pad && got.data.pad.latitude === 25.99677)

  const mapPolys = buildPolygonsFromNotices(notices.data, { NOTAM: true, NAVWARNING: true })
  check('mock end-to-end polygons', mapPolys.length >= 2, `polys=${mapPolys.length}`)
}

// ── 9) 缓存 key 与 syncSpaceDevsData 对齐 ──
function sortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}
const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const PREVIOUS_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}
const upKey = `api_cache_/launches/upcoming/_${sortedParamsString(UPCOMING_PARAMS)}_slim_v6`
const prevKey = `api_cache_/launches/previous/_${sortedParamsString(PREVIOUS_PARAMS)}_slim_v6`
check(
  'upcoming cache key shape',
  upKey.includes('hide_recent_previous') && upKey.includes('_slim_v6'),
  upKey.slice(0, 80) + '…'
)
check(
  'previous cache key shape',
  prevKey.includes('"-net"') && prevKey.includes('_slim_v6'),
  prevKey.slice(0, 80) + '…'
)

const launchSync = read('cloudfunctions/syncSpaceDevsData/_legacy.js')
check(
  'syncLaunches upcoming params match',
  /hide_recent_previous:\s*true/.test(launchSync) &&
    /\/launches\/upcoming\//.test(launchSync) &&
    /mode:\s*'detailed'/.test(launchSync)
)

async function main() {
  await runMockE2E()
  const failed = results.filter((r) => !r.ok)
  console.log('\n======== SUMMARY ========')
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`)
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail || ''))
    process.exit(1)
  }
  console.log('ALL GREEN')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
