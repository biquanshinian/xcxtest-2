/**
 * 弱网 upcoming 分批残缺 →「一千多天后」任务：回归审计
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
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

const apiReq = fs.readFileSync(path.join(ROOT, 'utils/api-request.js'), 'utf8')
check('batch 失败返回 {ok:false}', /ok:\s*false/.test(apiReq) && /anyFailed/.test(apiReq))
check('任一 batch 失败整次 null', /if\s*\(\s*anyFailed\s*\)\s*\{\s*return null/.test(apiReq))
check('条数少于主文档 count 则 null', /mergedResults\.length\s*<\s*expectedCount/.test(apiReq))
check('hollow 超时且已有部分 → null', /超时\|timeout/.test(apiReq) && /mergedResults\.length\s*>\s*0/.test(apiReq))
check('不再把 batch 失败静默成 [] 成功', !/catch\s*\(\s*batchError\s*\)\s*\{\s*return\s*\[\]\s*\}/.test(apiReq))
check('upcoming 首片前缀通知倒计时', /_emitCloudListPrefix/.test(apiReq) && /onCloudListPrefix/.test(apiReq))
check('前缀不写入残缺本地缓存', /tryResolvePrefix/.test(apiReq) && !/setCache\([^)]*prefix/.test(apiReq))

const legacy = fs.readFileSync(path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/_legacy.js'), 'utf8')
check('slimLaunch 保留 net_precision', /net_precision/.test(legacy) && /slimLaunch/.test(legacy))
const slimBlock = legacy.slice(legacy.indexOf('function slimLaunch'), legacy.indexOf('// === END slimLaunch'))
check('slimLaunch return 含 net_precision 字段', /net_precision,/.test(slimBlock) || /net_precision:/.test(slimBlock))

const pg = fs.readFileSync(path.join(ROOT, 'cloudfunctions/publicGateway/index.js'), 'utf8')
check('publicGateway slimLaunch 含 net_precision', /net_precision/.test(pg))

const indexJs = fs.readFileSync(path.join(ROOT, 'pages/index/index.js'), 'utf8')
const staleIdx = indexJs.indexOf('_onLaunchListCacheStale(info) {')
const staleFn = staleIdx >= 0 ? indexJs.slice(staleIdx, staleIdx + 6000) : ''
check('stale upcoming 刷新倒计时面板', /applyInitialUpcomingLaunchState/.test(staleFn))
check('倒计时冷启动快显', /_paintCountdownFromBootCache/.test(indexJs) && /_hydrateCountdownBootFromStorage/.test(indexJs))
const loadInitIdx = indexJs.indexOf('async loadInitialData(')
const loadInitFn = loadInitIdx >= 0 ? indexJs.slice(loadInitIdx, loadInitIdx + 9000) : ''
check('倒计时首屏不等 launch_status', /applyInitialUpcomingLaunchState/.test(loadInitFn) && !/STATUS_SNAPSHOT_FIRST_PAINT_BUDGET_MS/.test(loadInitFn))
check('倒计时首屏不等媒体映射预算', /_paintCountdownFromBootCache/.test(loadInitFn) && !/LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS/.test(loadInitFn))
check('倒计时云端等开屏起播门闩', /_waitSplashGateForCountdown/.test(loadInitFn) && /_releaseSplashCountdownGate/.test(indexJs))
check('开屏门闩覆盖冷启动决策窗', /SPLASH_COUNTDOWN_GATE_MAX_MS/.test(fs.readFileSync(path.join(ROOT, 'pages/index/utils/index-splash-home-defer.js'), 'utf8')))
check('空面板不吃满门闩（按是否已快显取预算）', /resolveSplashGateWaitMs/.test(loadInitFn))
const bootJs = fs.readFileSync(path.join(ROOT, 'pages/index/utils/index-countdown-boot.js'), 'utf8')
const paintIdx = bootJs.indexOf('async _paintCountdownFromBootCache(')
// 去掉行注释再比位置，否则注释里的 await 会误判
const paintFn = (paintIdx >= 0 ? bootJs.slice(paintIdx, paintIdx + 1400) : '').replace(/\/\/[^\n]*/g, '')
check(
  '快显同步源优先（命中不 await 异步 storage）',
  paintFn.indexOf('_resolveCountdownBootList') >= 0 &&
    paintFn.indexOf('_resolveCountdownBootList') < paintFn.indexOf('await')
)
check('引导快照跨天存活', /COUNTDOWN_BOOT_TTL_MS = 72/.test(bootJs))
check('引导快照 storage 只读一次', /hydrateCountdownBootToApp\(\)\.then/.test(bootJs))
check('开屏期不擦已画倒计时', /shouldKeepCountdownOnEmptyApply/.test(indexJs))
check('开屏 finally 不误放行门闩', /_splashUiActive/.test(fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')))
check('关屏分两阶段提交列表/网络', /_flushSplashDeferredListOnly/.test(indexJs) && /_flushSplashDeferredNetwork/.test(indexJs))

const splash = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
check('开屏弱网清超远快显卡片', /MAX_SPLASH_HORIZON_MS/.test(splash) && /_clearSplashMissionCard\(true\)/.test(splash))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
