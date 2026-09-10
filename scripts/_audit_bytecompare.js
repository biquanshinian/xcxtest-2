// 一次性审计：模块中 31 个方法体 vs git HEAD 原始实现 逐字对比
const fs = require('fs')
const { execSync } = require('child_process')

const head = execSync('git show HEAD:pages/index/index.js', { maxBuffer: 64 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n')
const mod = fs.readFileSync('subpackages/index-extra/utils/index-live-settle.js', 'utf8')
const main = fs.readFileSync('pages/index/index.js', 'utf8')

// 括号配平提取（跳过字符串/模板/注释的简化版：按行首缩进2的 "}," 收尾会有歧义，改用配平）
function extract(src, name) {
  const re = new RegExp('^  (?:async )?' + name.replace(/\$/g, '\\$') + '\\(', 'm')
  const i = src.search(re)
  if (i < 0) return null
  // 找到签名后的函数体开括号：匹配第一个 ') {'（默认参数中的 {} 不含 ') {'）
  const open = src.indexOf(') {', i)
  if (open < 0) return null
  let d = 0
  let inStr = null
  let prev = ''
  for (let k = open + 2; k < src.length; k++) {
    const c = src[k]
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null
      prev = c === '\\' && prev === '\\' ? '' : c
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; prev = c; continue }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); prev = ''; continue }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; prev = ''; continue }
    if (c === '{') d++
    else if (c === '}') { d--; if (d === 0) return src.slice(i, k + 1) }
    prev = c
  }
  return null
}

const METHODS = ['_scrubKnownSettleableCountdown', '_refilterUpcomingAgainstSettled',
  'refreshLaunchDelayInfo', '_tryLaunchDelayFromUpdatesCache',
  '_kickQuietSettlePastNetUpcoming', '_quietSettlePastNetMission', '_applyQuietPostponedNet',
  '_settleExpiredLaunch', '_refreshUpcomingAfterSettle', '_moveMissionToCompleted', '_applyPostponedNet',
  '_checkLiveLaunchStatus', '_fetchLl2UpdatesCached', '_fetchTerminalFromLl2Updates',
  '_trySettleFromLl2Updates', '_scheduleStatusRecheck', '_applyLiveStatusPanel',
  '_armLiveStatusRecheck', '_settleExpiredLaunchWithBestEffort', '_patchUpcomingListLiveStatuses',
  'refreshCountdownChannelsLive', '_scheduleCountdownChannelsLivePoll',
  'onCountdownLiveAvatarTap', '_openCountdownChannelsLive',
  'loadRoadClosureNotice', 'openRoadClosureDetail', 'loadSpaceXStats',
  'loadAnnouncementBanner', 'openAnnouncementDetail', 'onContactCallback',
  '_refreshRocketImagesFromMediaMap']

let same = 0
for (const n of METHODS) {
  const a = extract(head, n)
  const b = extract(mod, n)
  if (!a) { console.log('[HEAD无此方法]', n); continue }
  if (!b) { console.log('[模块无此方法]', n); continue }
  if (a === b) { same++; continue }
  // 容许尾随空白差异
  const na = a.replace(/[ \t]+$/gm, '')
  const nb = b.replace(/[ \t]+$/gm, '')
  if (na === nb) { same++; continue }
  console.log('[不一致]', n, 'HEAD:', a.length, 'B, 模块:', b.length, 'B')
  // 打印首个差异行
  const la = na.split('\n')
  const lb = nb.split('\n')
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      console.log('  首差异行', i + 1)
      console.log('  HEAD |', (la[i] || '(无)').slice(0, 120))
      console.log('  模块 |', (lb[i] || '(无)').slice(0, 120))
      break
    }
  }
}
console.log('逐字一致:', same + '/' + METHODS.length)

// 主包不应残留这些方法或其注释头
console.log('== 主包残留检查 ==')
let leak = 0
for (const n of METHODS) {
  if (new RegExp('^  (?:async )?' + n.replace(/\$/g, '\\$') + '\\(', 'm').test(main)) {
    console.log('  [主包仍有实现]', n); leak++
  }
}
for (const marker of ['NET 已推后：更新当前任务发射时间', '发射窗内加密复查间隔', '视频号直播（分包懒加载，与详情页同源）']) {
  if (main.includes(marker)) { console.log('  [主包残留注释]', marker); leak++ }
}
if (!leak) console.log('  OK')

// 辅助函数与常量对比
console.log('== 辅助函数/常量一致性 ==')
for (const fn of ['getLiveStatusRecheckDelayMs', 'loadChannelsLiveModule', 'getLiveFinderUserNameFromConfig', 'isSettleableLiveStatusId']) {
  const reF = new RegExp('^function ' + fn + '\\(', 'm')
  console.log(' ', fn, '模块:', reF.test(mod) ? '有' : '无!', '| 主包:', reF.test(main) ? '有(需确认是否必要)' : '无')
}
for (const c of ['LIVE_STATUS_RECHECK_MS', 'LIVE_STATUS_MAX_WAIT_MS', 'LL2_UPDATES_MEM_TTL_MS', 'CHANNELS_LIVE_ENTER_MS', 'ROAD_CLOSURE_REFRESH_TTL', 'SPACEX_STATS_REFRESH_TTL', 'LIVE_STATUS_UNRESOLVED_RECHECK_MS']) {
  const getVal = (src) => { const m = src.match(new RegExp('const ' + c + ' = ([^\\n]+)')); return m ? m[1].trim() : null }
  const hv = getVal(head)
  const mv = getVal(mod)
  console.log(' ', c, 'HEAD:', hv, '| 模块:', mv, hv === mv ? 'OK' : (mv == null ? '(模块未定义)' : '[值不一致!!]'))
}
