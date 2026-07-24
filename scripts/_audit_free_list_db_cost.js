/**
 * 审计 A+D（严格）：免费不预拉 previous + 禁静默周期探云 + 历史管线/竞态
 * 目标：全绿灯
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = 0
function assert(name, cond) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name)
  }
}

const apiRequest = read('utils/api-request.js')
const indexPage = read('pages/index/index.js')
const settledMerge = read('pages/index/utils/index-settled-merge.js')
const membership = read('utils/membership.js')

function sliceFn(src, startRe, len) {
  const m = src.match(startRe)
  if (!m) return ''
  return src.slice(m.index, m.index + len)
}

const bgFn = sliceFn(apiRequest, /function _shouldRunCloudBgCheck\s*\(/, 900)
const ensureFn = sliceFn(indexPage, /async ensureMissionListsReady\s*\(/, 2000)
const switchFn = sliceFn(indexPage, /switchMissionType\s*\(\s*e\s*\)\s*\{/, 3500)
const applyFn = sliceFn(settledMerge, /async _applyRecentSettledToCompletedList\s*\(/, 1800)
const staleFn = sliceFn(indexPage, /_onLaunchListCacheStale\s*\(\s*info\s*\)\s*\{/, 1600)
const loadInitFn = sliceFn(indexPage, /async loadInitialData\s*\(/, 8000)

// ── D: 探云门控 ──
assert('_shouldRunCloudBgCheck defined', /function _shouldRunCloudBgCheck\s*\(/.test(apiRequest))
assert('D: lastBg===0 allows first/force probe', /if\s*\(\s*lastBg\s*===\s*0\s*\)\s*return true/.test(bgFn))
assert('D: free blocks periodic probe', /canUsePaidCloudSync[\s\S]{0,120}return false/.test(bgFn))
assert('D: Phase1 gated', /localExact !== null[\s\S]{0,200}_shouldRunCloudBgCheck\(cacheKey\)/.test(apiRequest))
assert('D: Phase2 mother gated', /motherKey[\s\S]{0,120}_shouldRunCloudBgCheck\(motherKey\)/.test(apiRequest))
assert('D: getCache gated', /function getCache[\s\S]{0,400}_shouldRunCloudBgCheck\(cacheKey\)/.test(apiRequest))
assert('D: membership lazy require', /require\('\.\/membership\.js'\)/.test(bgFn))
assert('D: membership does not require api-request', !/require\(['"]\.\/api-request/.test(membership))

// ── A: 不预拉 ──
assert(
  'A: completed prefetch only if fullCloud',
  /if\s*\(\s*fullCloud\s*\)\s*\{[\s\S]{0,180}?fetchMissionList\(\s*'completed'/.test(loadInitFn)
)
assert(
  'A: resolveMissing treats !ready as missing',
  /type === 'completed' && !this\._completedCloudListReady/.test(indexPage)
)
assert(
  'A: loadMissions requires cloudReady for completed',
  /activeType !== 'completed' \|\| !!this\._completedCloudListReady/.test(indexPage)
)

// ── 历史完整管线 ──
assert(
  'ensure→handleCompletedMissionLoadSuccess',
  /completedIdx[\s\S]{0,200}handleCompletedMissionLoadSuccess\s*\(/.test(ensureFn)
)
assert(
  'ensure does not buildMissionListReadyState(results, missingTypes)',
  !/buildMissionListReadyState\(\s*results\s*,\s*missingTypes\s*\)/.test(ensureFn)
)
assert(
  'handleCompleted marks _completedCloudListReady',
  /handleCompletedMissionLoadSuccess[\s\S]{0,300}_completedCloudListReady\s*=\s*true/.test(settledMerge)
)
assert(
  'ready only set inside handleCompleted (single writer)',
  (settledMerge.match(/_completedCloudListReady\s*=\s*true/g) || []).length === 1 &&
    !/_completedCloudListReady\s*=\s*true/.test(indexPage)
)

// ── MUST-FIX 竞态 ──
assert(
  'switch completed: _apply only when cloud ready',
  /type === 'completed' && this\._completedCloudListReady[\s\S]{0,120}_applyRecentSettledToCompletedList/.test(
    switchFn
  )
)
assert(
  'switch completed: no ungated _apply after loadMissions',
  !/this\.loadMissions\(\)\s*\r?\n\s*if\s*\(\s*type === 'completed'\s*\)\s*\{/.test(switchFn)
)
assert('_apply aborts when generation changes', /_completedStateGeneration[\s\S]{0,80}!== generation/.test(applyFn))
assert('_apply skips when !ready && !force', /!this\._completedCloudListReady && !force/.test(applyFn))

// ── stale / 下拉 ──
assert(
  'stale previous→handleCompleted',
  /type === 'completed'[\s\S]{0,160}handleCompletedMissionLoadSuccess/.test(staleFn)
)
assert('stale uses fetch limit helper', /_getMissionListFetchLimit/.test(staleFn))
assert(
  'completed pull: force+handleCompleted',
  /missionType === 'completed'[\s\S]{0,400}forceLaunchListCloudBgCheck[\s\S]{0,400}handleCompletedMissionLoadSuccess/.test(
    indexPage
  )
)
assert('_getMissionListFetchLimit exists', /_getMissionListFetchLimit\s*\(\s*\)\s*\{/.test(indexPage))

// ── canUsePaidCloudSync 语义 ──
assert('canUsePaidCloudSync: membership off ⇒ true', /enabled === false\) return true/.test(membership))
assert('canUsePaidCloudSync: Pro ⇒ true', /isProSync\(\)\) return true/.test(membership))

console.log(failed ? `\nRESULT: ${failed} FAIL` : '\nRESULT: ALL GREEN')
process.exit(failed ? 1 : 0)
