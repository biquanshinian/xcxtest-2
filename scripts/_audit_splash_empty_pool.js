/**
 * 审计：开屏媒体池清空后禁止本地旧片继续播
 * 目标：全绿灯
 *
 * node scripts/_audit_splash_empty_pool.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (extra ? ' → ' + extra : ''))
  }
}

const replay = read('subpackages/index-extra/utils/splash-replay.js')
const prefetch = read('subpackages/index-extra/utils/splash-prefetch.js')
const splash = read('subpackages/index-extra/utils/index-splash.js')

check('replay 导出权威池判断', /function cloudSplashPoolIsAuthoritative/.test(replay))
check('replay 导出空池/不可播判断', /function isSplashCloudPoolCleared/.test(replay) && /function isSplashCloudPoolUnusable/.test(replay))
check('selectSplashMediaPool 权威池不回落缓存', /cloudSplashPoolIsAuthoritative\(cfg\)\) return cloudItems/.test(replay))
check('prefetch 不再把空池合并进旧 mediaItems', !/cfg\.mediaItems\.length \? cfg\.mediaItems : prev\.mediaItems/.test(prefetch))
check('prefetch 显式空/无可用条目写空数组', /poolCleared \? \[\] : explicitPool \? cfg\.mediaItems/.test(prefetch))
check('normalizeItems 显式 mediaItems 不回落 mediaUrl', /显式 mediaItems（含空数组）是权威池/.test(prefetch))
check('persist 清空时擦掉 mediaUrl/playUrl', /next\.mediaUrl = ''/.test(prefetch) && /next\.playUrl = ''/.test(prefetch))
check('persist 清空时删除本地落盘', /function pruneSplashSavedFiles/.test(prefetch) && /pruneSplashSavedFiles\(prev\.localPaths/.test(prefetch))
check('applyCloudCfg 空池取消预选片', /function clearPrefetchPick/.test(prefetch) && /clearPrefetchPick\(state\)/.test(prefetch))
check('落盘不复活已清空的缓存', /function splashCacheAllowsLocalFileWrite/.test(prefetch))
check('页面空池走 _dismissSplashAfterCloudCleared', /_dismissSplashAfterCloudCleared/.test(splash))
check('关屏看 _splashUiActive 不依赖 setData 刷盘', /_splashUiActive \|\| this\.data\.splashVisible/.test(splash))
check('等待期间二次确认云端空池', /latestCfg && isSplashCloudPoolUnusable\(latestCfg/.test(splash))
check('迟到云端空池关正在播的开屏', /lateCfg && isSplashCloudPoolUnusable\(lateCfg/.test(splash))
check('无云端时不把本地旧池写回 storage', /canPersistShownPool/.test(splash) && /云端未到时不要把本地旧池再写回/.test(splash))
check('saveTemp 拒绝写入空池', /Array\.isArray\(cur\.mediaItems\) && !cur\.mediaItems\.length\) return/.test(splash))
check('关闭开屏前丢掉延迟落盘', /this\._splashDeferredCache = null/.test(splash))

const {
  selectSplashMediaPool,
  isSplashCloudPoolCleared,
  isSplashCloudPoolUnusable,
  cloudSplashPoolIsAuthoritative
} = require('../subpackages/index-extra/utils/splash-replay.js')

const cached = [{ id: 'old', mediaUrl: 'https://old' }]
check(
  '行为：云端 mediaItems:[] 冷启动不回落',
  selectSplashMediaPool({
    replay: false,
    cloudItems: [],
    cachedItems: cached,
    cacheHasPool: true,
    cfg: { mediaItems: [] }
  }).length === 0
)
check(
  '行为：无云端仍可离线回落',
  selectSplashMediaPool({
    replay: false,
    cloudItems: [],
    cachedItems: cached,
    cacheHasPool: true,
    cfg: null
  })[0] && selectSplashMediaPool({
    replay: false,
    cloudItems: [],
    cachedItems: cached,
    cacheHasPool: true,
    cfg: null
  })[0].id === 'old'
)
check(
  '行为：热启动空池不回落',
  selectSplashMediaPool({
    replay: true,
    cloudItems: [],
    cachedItems: cached,
    cacheHasPool: true,
    cfg: { mediaItems: [] }
  }).length === 0
)
check('行为：权威空数组', cloudSplashPoolIsAuthoritative({ mediaItems: [] }) === true)
check('行为：无字段非权威', cloudSplashPoolIsAuthoritative({ enabled: true }) === false)
check('行为：cleared 空数组', isSplashCloudPoolCleared({ mediaItems: [] }) === true)
check('行为：unusable 坏条目', isSplashCloudPoolUnusable({ mediaItems: [{ id: 'x' }] }, []) === true)
check('行为：unusable 有效条目', isSplashCloudPoolUnusable({ mediaItems: [{ id: 'x' }] }, [{ id: 'x' }]) === false)
check('行为：关掉开屏即 unusable', isSplashCloudPoolUnusable({ enabled: false }, [{ id: 'x' }]) === true)

if (fail) {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(1)
}
console.log(`\n${pass} passed, ${fail} failed`)
console.log('ALL GREEN')
process.exit(0)
