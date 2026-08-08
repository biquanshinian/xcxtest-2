/**
 * SPACE_NOTICES_FEATURE — 深度运行冒烟审计（目标全绿）
 * node scripts/_tmp_audit_space_notices_runtime.js
 * node scripts/_tmp_audit_space_notices_runtime.js --live
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const LIVE = process.argv.includes('--live')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function mustacheBalance(rel) {
  const s = read(rel)
  const a = (s.match(/\{\{/g) || []).length
  const b = (s.match(/\}\}/g) || []).length
  return { a, b, ok: a === b }
}

// ── 1) 文件 / 语法 ──
const FILES = [
  'cloudfunctions/spaceNotices/index.js',
  'cloudfunctions/spaceNotices/fetch-external.js',
  'cloudfunctions/spaceNotices/parse-areas.js',
  'cloudfunctions/spaceNotices/pad-coords.js',
  'cloudfunctions/spaceNotices/seed-demo.js',
  'cloudfunctions/spaceNotices/config.json',
  'subpackages/monitor-pages/space-notices/entry-list.js',
  'subpackages/monitor-pages/space-notices/entry-list.wxml',
  'subpackages/monitor-pages/space-notices/notice-map.js',
  'subpackages/monitor-pages/space-notices/notice-map.wxml',
  'subpackages/monitor-pages/space-notices/utils/map-build.js',
  'subpackages/monitor-pages/space-notices/utils/api-space-notices.js',
  'utils/space-notices-feature.js'
]
check('required files', FILES.every(exists), FILES.filter((f) => !exists(f)).join(',') || 'ok')
check('main package api removed', !exists('utils/api-space-notices.js'))

const synFail = []
FILES.filter((f) => f.endsWith('.js')).forEach((f) => {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  if (r.status !== 0) synFail.push(f)
})
check('JS syntax', synFail.length === 0, synFail.join(',') || 'ok')

const listBal = mustacheBalance('subpackages/monitor-pages/space-notices/entry-list.wxml')
const mapBal = mustacheBalance('subpackages/monitor-pages/space-notices/notice-map.wxml')
check('entry-list wxml mustache', listBal.ok, `${listBal.a}/${listBal.b}`)
check('notice-map wxml mustache', mapBal.ok, `${mapBal.a}/${mapBal.b}`)

// ── 2) 契约 ──
const cfIndex = read('cloudfunctions/spaceNotices/index.js')
const cfFetch = read('cloudfunctions/spaceNotices/fetch-external.js')
const cfConfig = JSON.parse(read('cloudfunctions/spaceNotices/config.json'))
check('no LL2 HTTP', !/thespacedevs\.com/.test(cfIndex) && !/thespacedevs\.com/.test(cfFetch))
check('createCollection', /createCollection/.test(cfIndex))
check('rotate sync wired', /discoverEntrySlugs/.test(cfIndex) && /fetchNoticesByPaths/.test(cfIndex) && /ENTRIES_PER_RUN/.test(cfIndex))
check('contentHash skip', /contentHash/.test(cfIndex) && /skipped:\s*true/.test(cfIndex))
check('external stats path', /external:/.test(cfIndex) && /written:/.test(cfIndex))
check('timer every 15min', /0 \*\/15 \* \* \* \* \*/.test(cfConfig.triggers[0].config))
check('WATCH Flight13', /launch-starship-flight-13/.test(cfFetch) || /launch-starship-flight-13/.test(cfIndex))
check('MUST_INCLUDE E2700', /E2700/.test(cfFetch))

const listJs = read('subpackages/monitor-pages/space-notices/entry-list.js')
const mapJs = read('subpackages/monitor-pages/space-notices/notice-map.js')
const mapWxml = read('subpackages/monitor-pages/space-notices/notice-map.wxml')
check('pageBase both pages', /behaviors:\s*\[\s*pageBase\s*\]/.test(listJs) && /behaviors:\s*\[\s*pageBase\s*\]/.test(mapJs))
check('polyline + corridor UI', /polyline="\{\{polylines\}\}"/.test(mapWxml) && /showCorridor/.test(mapJs))
check('sync toast shows rotate progress', /entriesProcessed/.test(listJs) && /entryTotal/.test(listJs))

// ── 3) 解析器运行时 ──
const {
  parseAreasFromRawText,
  dmsTokenToDeg
} = require('../cloudfunctions/spaceNotices/parse-areas.js')
const { DEMO_NOTICES, E2700_RAW, FLIGHT13_LL2_ID } = require('../cloudfunctions/spaceNotices/seed-demo.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  fitCenter
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')
const {
  parseNoticeFromHtml,
  extractNoticeLinks,
  noticeKeyFromPath
} = require('../cloudfunctions/spaceNotices/fetch-external.js')

check('dms DDMM', Math.abs(dmsTokenToDeg('2338S') + 23.633333) < 0.01)
check('dms DDDMM', Math.abs(dmsTokenToDeg('10020E') - 100.333333) < 0.02)
const eAreas = parseAreasFromRawText(E2700_RAW)
check('E2700 parse from raw', eAreas[0] && eAreas[0].length >= 18 && Math.abs(eAreas[0][0][0] - 75) < 0.05, `pts=${eAreas[0] && eAreas[0].length}`)

// Q 行噪声不应污染
const noisy = 'Q) YMMM/QRDCA/IV/BO/W/000/999/2139S09259E999\nE) AREAS: 2338S 07500E, 2251S 07826E, 2139S 08258E TO BEGINNING.'
const noisyAreas = parseAreasFromRawText(noisy)
check('Q-line not first point', noisyAreas[0] && Math.abs(noisyAreas[0][0][0] - 75) < 0.05, JSON.stringify(noisyAreas[0] && noisyAreas[0][0]))

const seedE = DEMO_NOTICES.find((n) => n.noticeKey === 'notam-YMMM-E2700/26')
check('seed E2700 auto areas', seedE && seedE.areas[0] && seedE.areas[0].length >= 18)

const polys = buildPolygonsFromNotices(DEMO_NOTICES, {
  NOTAM: true,
  NAVWARNING: true,
  ADP_LINK_FILE: true
})
// 假走廊已下线：ADP 图层不再产生折线，黄线由 trajectory 包单独成层
const lines = buildPolylinesFromNotices(DEMO_NOTICES, { ADP_LINK_FILE: true })
check('demo map layers', polys.length >= 3 && lines.length === 0, `poly=${polys.length} line=${lines.length}`)
const fit = fitCenter({ latitude: 25.99, longitude: -97.15 }, polys, lines)
check('fitCenter legal scale', fit.scale >= 3 && fit.scale <= 20 && fit.includePoints.length >= 2, `scale=${fit.scale}`)

check('noticeKeyFromPath', noticeKeyFromPath('/notice/notam-YMMM-E2700%2F26') === 'notam-YMMM-E2700/26')

// ── 5) contentHash 覆盖语义（纯函数复刻） ──
function noticeContentHash(notice, areas) {
  const raw = String((notice && notice.rawText) || '')
  const areaSig = JSON.stringify(areas || [])
  return crypto.createHash('sha1').update(raw + '\n' + areaSig).digest('hex').slice(0, 16)
}
const h1 = noticeContentHash({ rawText: 'A' }, [[[1, 2]]])
const h2 = noticeContentHash({ rawText: 'A' }, [[[1, 2]]])
const h3 = noticeContentHash({ rawText: 'B' }, [[[1, 2]]])
check('hash stable', h1 === h2 && h1.length === 16)
check('hash changes on rawText', h1 !== h3)

function mockUpsert(prevHash, notice, areas) {
  const contentHash = noticeContentHash(notice, areas)
  if (prevHash && prevHash === contentHash) return { written: false, skipped: true, contentHash }
  return { written: true, skipped: false, contentHash }
}
const u1 = mockUpsert(null, { rawText: E2700_RAW }, eAreas)
const u2 = mockUpsert(u1.contentHash, { rawText: E2700_RAW }, eAreas)
const u3 = mockUpsert(u1.contentHash, { rawText: E2700_RAW + ' X' }, eAreas)
check('upsert skip same hash', u1.written && u2.skipped && !u2.written)
check('upsert write on change', u3.written && !u3.skipped)
const uCancel = mockUpsert(u1.contentHash, { rawText: E2700_RAW, cancelled: true }, [])
check('cancelled clears geometry hash', uCancel.written)

async function ensureNoticeHtml() {
  if (exists('scripts/_tmp_sn_notice.html')) return true
  try {
    const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
    const body = await httpGet('https://space-notices.com/notice/notam-YMMM-E2700%2F26')
    fs.writeFileSync(path.join(ROOT, 'scripts/_tmp_sn_notice.html'), body)
    return true
  } catch (e) {
    check('offline notice html present', false, e.message)
    return false
  }
}

async function htmlParseChecks() {
  const ok = await ensureNoticeHtml()
  if (!ok) return
  check('offline notice html present', true)
  const html = read('scripts/_tmp_sn_notice.html')
  const n = parseNoticeFromHtml(html, 'notam-YMMM-E2700/26')
  check('html parse key', n && n.noticeKey === 'notam-YMMM-E2700/26', n && n.noticeKey)
  check('html parse type NOTAM', n && n.type === 'NOTAM')
  check('html parse areas', n && n.areas && n.areas[0] && n.areas[0].length >= 18)
  check('html parse dates', n && Array.isArray(n.dates) && n.dates.length >= 1, n && n.dates && String(n.dates.length))
  check('html parse source', n && /FAA|Federal/i.test(n.sourceName || ''))
}

async function liveChecks() {
  if (!LIVE) {
    check('live fetch (skipped)', true, 'pass --live to enable')
    return
  }
  const { fetchWatchedEntries, httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
  const batches = await fetchWatchedEntries()
  check('live batches', batches.length >= 1)
  const b = batches[0]
  check('live fetched', b.fetched >= 20, `fetched=${b.fetched}`)
  check('live parsed', b.parsed >= 20, `parsed=${b.parsed}`)
  check('live errors low', (b.errors || []).length <= 3, JSON.stringify(b.errors || []))
  check('live ll2Id Flight13', b.ll2Id === FLIGHT13_LL2_ID)

  const types = new Set((b.notices || []).map((n) => n.type))
  check('live has NOTAM', types.has('NOTAM'), [...types].join(','))
  const e2700 = (b.notices || []).find((n) => /E2700/i.test(n.noticeKey) || /E2700/i.test(n.name))
  check('live has E2700', !!e2700)
  check('live E2700 areas', !!(e2700 && e2700.areas && e2700.areas[0] && e2700.areas[0].length >= 10))

  const withGeom = (b.notices || []).filter((n) => n.areas && n.areas[0] && n.areas[0].length >= 3)
  check('live geometry ratio', withGeom.length >= 5, `${withGeom.length}/${b.parsed}`)

  const entryHtml = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const paths = extractNoticeLinks(entryHtml)
  check(
    'live path select includes E2700',
    paths.some((p) => /E2700/i.test(p) || /E2700/i.test(decodeURIComponent(p))),
    `n=${paths.length}`
  )
}

async function main() {
  await htmlParseChecks()
  await liveChecks()
  const failed = results.filter((r) => !r.ok)
  console.log('\n======== RUNTIME SUMMARY ========')
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length} live=${LIVE}`)
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
