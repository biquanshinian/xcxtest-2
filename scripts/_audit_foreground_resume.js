/**
 * 审计：回前台静默对齐 + 防网络风暴
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

function sliceFn(src, startRe, len) {
  const m = src.match(startRe)
  if (!m) return ''
  return src.slice(m.index, m.index + len)
}

const util = read('utils/foreground-resume.js')
const indexPage = read('pages/index/index.js')
const liveSettle = read('subpackages/index-extra/utils/index-live-settle.js')
const newsPage = read('pages/news/news.js')
const progressPage = read('pages/progress/progress.js')
const monitorPage = read('pages/monitor/monitor.js')
const detailPage = read('pages/mission-detail/mission-detail.js')
const appJs = read('app.js')
const apiRequest = read('utils/api-request.js')

const silentFn = sliceFn(indexPage, /_silentRevalidateOnForeground\s*\(\s*resumeMs\s*\)\s*\{/, 2800)
const liveFn = sliceFn(liveSettle, /async _checkLiveLaunchStatus\s*\(\s*currentId,\s*options\s*\)\s*\{/, 4000)
const planFn = sliceFn(util, /function planIndexForegroundRevalidate\s*\(/, 1800)

assert('App.onHide 打 hiddenAt', /markAppHidden\(\s*this/.test(appJs))
assert('App.onShow 记 resumeMs', /markAppShown\(\s*this/.test(appJs))
assert('首页消费 resume seq', /takeForegroundResume\(\s*this\s*\)/.test(indexPage))
assert('资讯消费 resume seq', /takeForegroundResume\(\s*this\s*\)/.test(newsPage))
assert('进展消费 resume seq', /takeForegroundResume\(\s*this\s*\)/.test(progressPage))
assert('监控消费 resume seq', /takeForegroundResume\(\s*this\s*\)/.test(monitorPage))
assert('详情消费 resume seq', /takeForegroundResume\(\s*this\s*\)/.test(detailPage))

assert('计划函数存在', /function planIndexForegroundRevalidate\s*\(/.test(util))
assert('forceListCloud 默认 false', /forceListCloud:\s*false/.test(util))
assert('计划永不打开 forceListCloud', !/plan\.forceListCloud\s*=\s*true/.test(planFn))
assert('远窗轻量与近窗完整互斥注释/逻辑', /resolveCurrentLite/.test(planFn) && /liveStatusProbe/.test(planFn))
assert('过点不叠完整探针', /countdownExpired/.test(planFn))
assert('轻量探针 60s 去重', /STATUS_PROBE_MIN_GAP_MS/.test(planFn))

assert('首页走计划函数', /planIndexForegroundRevalidate\s*\(/.test(silentFn))
assert('回前台不清列表探云节流', !/forceLaunchListCloudBgCheck\s*\(/.test(silentFn))
assert('列表只 invalidate 快照再 fetch', /invalidateListSnapshots\s*\(/.test(silentFn) && /fetchMissionList\s*\(/.test(silentFn))
assert('远窗 lite 探针', /lite:\s*true/.test(silentFn))
assert('近窗完整探针仍保留', /plan\.liveStatusProbe/.test(silentFn))
assert('开关走 TTL 而非 force', /fetchMainConfig\s*\(\s*\)/.test(silentFn) && !/fetchMainConfig\s*\(\s*true\s*\)/.test(silentFn))
assert('下拉刷新仍可强制探云', /forceLaunchListCloudBgCheck\s*\(/.test(indexPage))

assert('实况探针支持 lite', /async _checkLiveLaunchStatus\s*\(\s*currentId,\s*options\s*\)/.test(liveSettle))
assert('lite 在 live 列表前返回', /if\s*\(\s*lite\s*\)\s*\{[\s\S]*_launchStatusPolling\s*=\s*false[\s\S]*return/.test(liveFn))
assert('lite 返回点在 fetchLiveLaunchStatuses 之前', (() => {
  const liteAt = liveFn.search(/if\s*\(\s*lite\s*\)/)
  const liveAt = liveFn.search(/fetchLiveLaunchStatuses\s*\(/)
  return liteAt >= 0 && liveAt >= 0 && liteAt < liveAt
})())

assert('免费用户禁静默周期探云仍在', /canUsePaidCloudSync/.test(apiRequest) && /LAUNCH_LIST_BG_CHECK_INTERVAL/.test(apiRequest))

assert('资讯 ≥2min 才静默刷新', /LIST_REVALIDATE_MS/.test(newsPage) && /_silentRefreshFirstPage/.test(newsPage))
assert('进展 ≥2min 才静默刷新', /LIST_REVALIDATE_MS/.test(progressPage) && /loadEventUpdates\(true/.test(progressPage))
assert('进展早报筛选不叠无筛选刷新', /_briefingFilterAppliedThisShow/.test(progressPage))
assert('监控 ≥2min 才静默刷新', /LIST_REVALIDATE_MS/.test(monitorPage) && /_silentRevalidateOnForeground/.test(monitorPage))
assert('详情 60s 去重', /STATUS_PROBE_MIN_GAP_MS/.test(detailPage) && /_lastScheduleProbeAt/.test(detailPage))
assert('详情终态不探', /detailType === 'completed'/.test(detailPage))

console.log(failed ? `\nRESULT: ${failed} FAIL` : '\nRESULT: ALL GREEN')
process.exit(failed ? 1 : 0)
