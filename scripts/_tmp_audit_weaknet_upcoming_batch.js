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

const splash = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
check('开屏弱网清超远快显卡片', /MAX_SPLASH_HORIZON_MS/.test(splash) && /_clearSplashMissionCard\(true\)/.test(splash))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
