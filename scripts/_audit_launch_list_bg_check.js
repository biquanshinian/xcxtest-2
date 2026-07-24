/**
 * 审计：发射列表后台探云 15min + 下拉强制探云 + stale 按 kind 去抖
 * 目标：全绿灯
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = 0
function assert(name, cond) {
  if (cond) {
    console.log('PASS', name)
  } else {
    failed++
    console.log('FAIL', name)
  }
}

const apiRequest = read('utils/api-request.js')
const indexPage = read('pages/index/index.js')
const launchList = read('utils/api-launch-list.js')

assert(
  'interval=15min',
  /LAUNCH_LIST_BG_CHECK_INTERVAL\s*=\s*15\s*\*\s*60\s*\*\s*1000/.test(apiRequest)
)
assert(
  'no leftover 3min list interval',
  !/LAUNCH_LIST_BG_CHECK_INTERVAL\s*=\s*3\s*\*\s*60\s*\*\s*1000/.test(apiRequest)
)
assert('forceLaunchListCloudBgCheck defined', /function forceLaunchListCloudBgCheck\s*\(/.test(apiRequest))
assert(
  'force exported',
  /module\.exports\s*=\s*\{[\s\S]*forceLaunchListCloudBgCheck/.test(apiRequest)
)
assert(
  'force clears launch-list throttle keys',
  /function forceLaunchListCloudBgCheck[\s\S]*isLaunchListCacheKey\(key\)\s*\)\s*delete cloudCacheBgCheckAt/.test(
    apiRequest
  )
)
assert(
  '_bgCheckIntervalFor uses launch list interval',
  /isLaunchListCacheKey\(cacheKey\)[\s\S]*return LAUNCH_LIST_BG_CHECK_INTERVAL/.test(apiRequest)
)
assert(
  'stale path still invalidates list snapshots',
  /_fireStaleUpdate[\s\S]*invalidateListSnapshots/.test(apiRequest)
)

assert('index imports forceLaunchListCloudBgCheck', /forceLaunchListCloudBgCheck/.test(indexPage))
assert('index imports invalidateListSnapshots', /invalidateListSnapshots/.test(indexPage))
assert(
  'pull upcoming uses forceRefresh',
  /loadInitialData\(\s*\{\s*suppressLoading:\s*true,\s*forceRefresh:\s*true\s*\}\s*\)/.test(indexPage)
)
assert(
  'forceRefresh clears snapshot+throttle',
  /if\s*\(\s*forceRefresh\s*\)\s*\{[\s\S]*invalidateListSnapshots\(\)[\s\S]*forceLaunchListCloudBgCheck\(\)/.test(
    indexPage
  )
)
assert(
  'completed pull forces cloud',
  /missionType === 'completed'[\s\S]*invalidateListSnapshots\(\)[\s\S]*forceLaunchListCloudBgCheck\(\)/.test(
    indexPage
  )
)
assert('onLaunchListStale subscribed onLoad', /onLaunchListStale\s*\(/.test(indexPage))
assert(
  'stale debounce is per-kind',
  /_launchListStaleAtByKind/.test(indexPage) && /_launchListStaleGenByKind/.test(indexPage)
)
assert(
  'stale debounce no longer global-only',
  !/if\s*\(\s*this\._launchListStaleAt\s*&&\s*now\s*-\s*this\._launchListStaleAt\s*<\s*1500\s*\)\s*return/.test(
    indexPage
  )
)

assert('invalidateListSnapshots exported', /invalidateListSnapshots/.test(launchList))
assert(
  'list snapshot TTL still short-lived',
  /LIST_SNAPSHOT_TTL\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(launchList)
)

console.log(failed ? `\nRESULT: ${failed} FAIL` : '\nRESULT: ALL GREEN')
process.exit(failed ? 1 : 0)
