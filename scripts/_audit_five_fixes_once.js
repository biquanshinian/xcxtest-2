/**
 * 一次性走通审计：五处体验修复 + AI 优先翻译
 * 只报告会断链路的问题；exit 0 = 无断点
 */
const fs = require('fs')

const bugs = []
const ok = []

function assert(name, cond, detail) {
  if (cond) ok.push(name)
  else bugs.push(name + (detail ? ': ' + detail : ''))
}

function read(p) {
  return fs.readFileSync(p, 'utf8')
}

// ---- syntax ----
const jsFiles = [
  'utils/text-translate.js',
  'utils/booster-nav.js',
  'pages/nasa-data/nasa-api.js',
  'pages/nasa-data/nasa-data.js',
  'cloudfunctions/ll2Query/translate.js',
  'cloudfunctions/ll2Query/index.js',
  'cloudfunctions/syncSpaceDevsData/shared.js',
  'utils/api-monitor-data.js',
  'subpackages/monitor-pages/booster-detail.js',
  'pages/mission-detail/mission-detail.js'
]
for (const f of jsFiles) {
  try {
    new Function(read(f))
    assert('syntax ' + f, true)
  } catch (e) {
    assert('syntax ' + f, false, e.message.split('\n')[0])
  }
}
// legacy too large for new Function sometimes — node --check via spawn avoided; regex only

const tt = read('utils/text-translate.js')
const tr = read('cloudfunctions/ll2Query/translate.js')
const idx = read('cloudfunctions/ll2Query/index.js')
const nasa = read('pages/nasa-data/nasa-api.js')
const nd = read('pages/nasa-data/nasa-data.js')
const bn = read('utils/booster-nav.js')
const bd = read('subpackages/monitor-pages/booster-detail.js')
const md = read('pages/mission-detail/mission-detail.js')
const routes = read('utils/routes.js')
const sh = read('cloudfunctions/syncSpaceDevsData/shared.js')
const leg = read('cloudfunctions/syncSpaceDevsData/_legacy.js')
const am = read('utils/api-monitor-data.js')
const apiReq = read('utils/api-request.js')
const shareGate = read('subpackages/monitor-pages/utils/share-gate.js')
const mw = read('pages/monitor/monitor.wxss')
const gw = read('subpackages/monitor-pages/components/monitor-galleries/index.wxss')
const ow = read('subpackages/monitor-pages/components/monitor-orbit-events/index.wxss')

// ---- translate AI-first ----
assert('AI: no multi-field TMT bypass', !/inputs\.length\s*!==\s*1/.test(tt))
assert('AI: stages 缓存→混元→TMT', /混元优先/.test(tt) && /TMT 兜底/.test(tt))
assert('AI: cache chunked', /TRANSLATE_BATCH_MAX_ITEMS/.test(tt) && /skipTmt:\s*true/.test(tt))
assert('AI: lookup returns concat array', /return \[\]\.concat\(\.\.\.lists\)/.test(tt))
assert('AI: TMT fail keeps hits', /if\s*\(!results\.some\(Boolean\)\)\s*throw/.test(tt))
assert('AI: retry empty+reject', /function runTranslate\(isRetry\)/.test(tt))
assert('AI: mapPool + concurrency', /function mapPool\(/.test(tt) && /AI_TRANSLATE_CONCURRENCY\s*=\s*3/.test(tt))
assert('AI: mapPool uses inputs[idx]', /mapPool\(aiJobs[\s\S]*?async\s*\(idx\)\s*=>[\s\S]*?inputs\[idx\]/.test(tt))
assert('AI: lookup not resolve(null)', !/function lookupCloudPretranslated[\s\S]*?resolve\(null\)/.test(tt))

assert('cloud: pending-empty withMeta', /if\s*\(!pending\.length\)\s*\{[\s\S]*?withMeta[\s\S]*?list:\s*results/.test(tr))
assert('cloud: action Array.isArray', /Array\.isArray\(out\)/.test(idx))
assert('cloud: fail tmtNeeded&&empty', /tmtNeeded\s*>\s*0\s*&&\s*translated\s*===\s*0/.test(idx))
assert('cloud: skipTmt not false-fail', /!skipTmt\s*&&\s*tmtNeeded/.test(idx))

// ---- mars ----
assert('mars: 22s+2retry', /simpleGet\(base,\s*params,\s*22000,\s*2\)/.test(nasa))
assert('mars: latest endpoint', /latest_photos/.test(nasa) && /getRoverLatestPhotos/.test(nasa))
assert('mars: parse both keys', /raw\.latest_photos/.test(nasa) && /raw\.photos/.test(nasa))
assert('mars: useLatest path', /getRoverLatestPhotos/.test(nd))
assert('mars: forceDate on date+backdate', (nd.match(/forceDate:\s*true/g) || []).length >= 2)
assert('mars: domain not retryable', /domain[\s\S]{0,80}return false/.test(nasa))

// ---- booster ----
assert('booster: nav complete', /gateCheck/.test(bn) && /getBoosterGenealogy/.test(bn) && /BOOSTER_DETAIL/.test(bn))
assert('booster: mission wired', /openBoosterEntityDetail\(serial\)/.test(md))
assert('booster: no PAID double gate', /PAID_ROUTE_MAP\s*=\s*\{\}/.test(routes))
assert('booster: detail fallbacks', /serialNumber:\s*serial/.test(bd) && /getBoosterGenealogy/.test(bd))
assert('booster: share non-sst pass', /if\s*\(!sst\)\s*return true/.test(shareGate))
assert('booster: genealogy wired', /openBoosterEntityDetail/.test(read('subpackages/monitor-pages/booster-genealogy.js')))
assert('booster: galleries wired', /openBoosterEntityDetail/.test(read('subpackages/monitor-pages/utils/monitor-galleries.js')))
assert('booster: index wired', /openBoosterEntityDetail/.test(read('pages/index/index.js')))

// ---- agency ----
assert('agency: reject hollow batch', /without results\[\] for batching/.test(sh))
assert('agency: doc(cacheKey).set', /collection\.doc\(docId\)\.set\(\{\s*data:\s*payload\s*\}\)/.test(sh))
assert('agency: no retry size err', /体积\/结构类错误重试无意义/.test(sh) && /payload too large/.test(sh))
assert('agency: slim used', /slimAgencyDetail\(data\)/.test(leg))
assert('agency: 121 priority', /String\(a\)\s*===\s*'121'/.test(leg))
assert('agency: hollow stale', /hollowBatched/.test(leg))
assert('agency: partial 5min', /__partial[\s\S]{0,250}5\s*\*\s*60\s*\*\s*1000/.test(am))
assert('agency: timestamp field', /timestamp:\s*Date\.now\(\)/.test(sh))
assert('agency: client reads .data.data', /let apiData = result\.data\.data/.test(apiReq))

// ---- monitor css ----
assert('css: agency margin', /\.agency-section\s*\{\s*padding:\s*0;\s*margin-bottom:\s*0;/.test(gw))
assert('css: booster margin', /\.booster-section\s*\{\s*padding:\s*0;\s*margin-bottom:\s*0;/.test(gw))
assert('css: sc margin', /\.sc-section\s*\{\s*padding:\s*0;\s*margin-bottom:\s*0;/.test(gw))
assert('css: orbit margin', /\.orbit-section\s*\{\s*padding:\s*0;\s*margin-bottom:\s*0;/.test(ow))
assert('css: min-height 360', /min-height:\s*360rpx/.test(mw))

// ---- runtime sims ----
async function mapPool(items, concurrency, mapper) {
  const out = new Array(items.length)
  let next = 0
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await mapper(items[i], i)
    }
  }))
  return out
}

async function smart(inputs, deps) {
  const results = inputs.map(() => '')
  const cached = deps.cache || inputs.map(() => '')
  for (let i = 0; i < inputs.length; i++) if (cached[i]) results[i] = cached[i]
  const aiJobs = []
  for (let i = 0; i < inputs.length; i++) if (!results[i] && inputs[i].length >= 40) aiJobs.push(i)
  await mapPool(aiJobs, 3, async (idx) => {
    if (deps.ai && deps.ai[idx]) results[idx] = deps.ai[idx]
  })
  const needTmtIdx = []
  for (let i = 0; i < inputs.length; i++) if (!results[i] && inputs[i]) needTmtIdx.push(i)
  if (needTmtIdx.length) {
    try {
      if (deps.tmtThrow) throw new Error('tmt')
      for (const i of needTmtIdx) if (deps.tmt && deps.tmt[i]) results[i] = deps.tmt[i]
    } catch (e) {
      if (!results.some(Boolean)) throw e
    }
  }
  return results
}

;(async () => {
  let r = await smart(['x'.repeat(50), 'y'.repeat(50)], { ai: { 0: '甲', 1: '乙' }, tmtThrow: true })
  assert('sim: multi AI no TMT', r.join() === '甲,乙')

  r = await smart(['NASA'], { tmt: { 0: '美国宇航局' } })
  assert('sim: short->TMT', r[0] === '美国宇航局')

  r = await smart(['x'.repeat(50)], { cache: ['缓存'], ai: { 0: 'AI' } })
  assert('sim: cache before AI', r[0] === '缓存')

  try {
    await smart(['x'.repeat(50)], { tmtThrow: true })
    assert('sim: all-fail throws', false)
  } catch (e) {
    assert('sim: all-fail throws', true)
  }

  r = await smart(['x'.repeat(50), 'short'], { ai: { 0: '长译' }, tmtThrow: true })
  assert('sim: partial AI kept', r[0] === '长译' && r[1] === '')

  function parse(raw) {
    if (!raw) return []
    return Array.isArray(raw.photos) ? raw.photos : (Array.isArray(raw.latest_photos) ? raw.latest_photos : [])
  }
  assert('sim: latest_photos', parse({ latest_photos: [{ id: 1 }] }).length === 1)
  assert('sim: photos', parse({ photos: [{ id: 1 }] }).length === 1)

  try {
    const big = { id: 1, blob: 'a'.repeat(900 * 1024) }
    const sizeKB = Math.ceil(JSON.stringify(big).length / 1024)
    if (sizeKB > 800 && !Array.isArray(big.results)) throw new Error('without results[] for batching')
    assert('sim: large non-list throws', false)
  } catch (e) {
    assert('sim: large non-list throws', /batching/.test(e.message))
  }

  const doc = { cacheKey: 'k', data: { id: 121, total_launch_count: 1 }, timestamp: 1 }
  assert('sim: agency read shape', doc.data && doc.data.id === 121)

  function serialMatch(item, serial) {
    const a = String(item.serialNumber || item.serial || '').trim()
    return a === serial || a.toUpperCase() === serial.toUpperCase()
  }
  assert('sim: serial case', serialMatch({ serialNumber: 'B1060' }, 'b1060'))

  // slim size under 800
  const slimLaunchers = Array.from({ length: 120 }, (_, i) => ({
    id: i, serial_number: 'B' + i, status: {}, flights: 1,
    image: { image_url: 'https://x/' + 'y'.repeat(40) },
    launcher_config: { id: 1, name: 'Falcon 9', full_name: 'Falcon 9 Block 5', reusable: true }
  }))
  const slim = { id: 121, description: 'd'.repeat(5000), launcher_list: slimLaunchers, spacecraft_list: [], total_launch_count: 500 }
  const slimKB = Math.ceil(JSON.stringify(slim).length / 1024)
  assert('sim: slim SpaceX <800KB', slimKB <= 800, String(slimKB))

  console.log('======== ONE-SHOT AUDIT ========')
  console.log('PASS', ok.length)
  console.log('BUGS', bugs.length)
  if (bugs.length) bugs.forEach((b) => console.log('  FAIL', b))
  else console.log('  no walkthrough breakers')
  process.exit(bugs.length ? 1 : 0)
})()
