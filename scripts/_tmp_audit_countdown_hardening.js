/**
 * 首页倒计时加固改动的运行时验证（桩环境加载真实 pages/index/index.js）。
 *
 * 覆盖本轮改动：
 *  A. 校时：offset 生效后 getCountdown / 状态机同口径（不出现「还在倒数但已判过点」）
 *  B. POST_WINDOW 让位：过窗未决任务不再永久占住主面板，且被顶下去的那条仍会被慢探
 *  C. 无 NET / 低精度 NET：面板显式「待定」，不残留上一条任务的数字
 *  D. 跳秒不播错帧动画；秒未变不产生 setData
 *  E. 后台不打 LL2（_countdownPageHidden 守卫）
 */
const path = require('path')

// ---- 小程序环境桩 ----
const storage = new Map()
let requestCount = 0
global.wx = new Proxy(
  {},
  {
    get: (t, prop) => {
      if (prop === 'getStorageSync') return (k) => (storage.has(k) ? storage.get(k) : '')
      if (prop === 'setStorageSync') return (k, v) => storage.set(k, v)
      if (prop === 'getSystemInfoSync')
        return () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44, platform: 'devtools', SDKVersion: '3.0.0' })
      if (prop === 'getAccountInfoSync') return () => ({ miniProgram: { envVersion: 'develop', appId: 'stub' } })
      if (prop === 'getMenuButtonBoundingClientRect')
        return () => ({ top: 48, bottom: 80, left: 300, right: 380, width: 80, height: 32 })
      if (prop === 'getAppBaseInfo') return () => ({ SDKVersion: '3.0.0', theme: 'dark' })
      if (prop === 'getWindowInfo')
        return () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44, pixelRatio: 3, safeArea: { top: 47, bottom: 810 } })
      if (prop === 'getDeviceInfo') return () => ({ platform: 'devtools', brand: 'stub' })
      if (prop === 'cloud') return new Proxy({}, { get: () => () => ({}) })
      if (prop === 'env') return { USER_DATA_PATH: '/tmp' }
      if (prop === 'canIUse') return () => false
      if (prop === 'request')
        return (opt) => {
          requestCount += 1
          if (opt && opt.fail) opt.fail(new Error('stub: no network'))
        }
      if (prop === 'onAppShow' || prop === 'onAppHide' || prop === 'onError') return () => {}
      return () => ({})
    }
  }
)
global.getApp = () => ({ globalData: {}, getUiShellLayout: null })
global.getCurrentPages = () => []
global.App = () => {}
global.Component = () => {}
global.Behavior = (o) => o

let capturedPage = null
global.Page = (obj) => {
  capturedPage = obj
}

const Module = require('module')
const origWrap = Module.wrap
Module.wrap = function (script) {
  const inject =
    'if (typeof require !== "undefined" && !require.async) { require.async = (p) => { try { return Promise.resolve(require(p)) } catch (e) { return Promise.reject(e) } } }\n'
  return origWrap(inject + script)
}

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (extra ? '  → ' + extra : ''))
  }
}

require(path.resolve('pages/index/index.js'))
if (!capturedPage) {
  console.log('[Page 未捕获]')
  process.exit(1)
}

const clock = require('../utils/server-clock.js')
const { getCountdown } = require('../utils/util.js')
const windowMachine = require('../utils/countdown-window-machine.js')
const { resolveCountdownPrecision, buildCountdownTickState } = require('../utils/index-launch-state.js')
const liveSettle = require('../subpackages/index-extra/utils/index-live-settle.js')

// ---------- A. 校时同口径 ----------
console.log('\n===== A. 校时（offset）=====')
clock._resetForTest()
// 相对当前时间构造，脚本不会随日期推移而失效
const T0 = Date.now()
// 设备时钟比真实时间快 10 分钟 → 服务端时间比本地早 10 分钟 → offset 为 -10min
clock.noteServerTimeSample(Date.now() - 10 * 60 * 1000, Date.now(), Date.now())
check('offset 采用为负（设备时钟偏快）', clock.getClockOffsetMs() < -9 * 60 * 1000)

// NET 设在「本地时钟已过、真实时间还差 5 分钟」的位置
const netIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
const cd = getCountdown(netIso)
check('getCountdown 用校准时钟：仍在倒数而非过期', cd.isExpired === false, JSON.stringify(cd))
const phase = windowMachine.derivePhase({ launchTime: netIso, statusId: 1 }, null)
check(
  '状态机同口径：仍是 PRE_WINDOW（不会一边倒数一边判过点）',
  phase === windowMachine.PHASE.PRE_WINDOW,
  phase
)
clock._resetForTest()

// ---------- 构造页面实例 ----------
function makePage(data) {
  const page = Object.create(capturedPage)
  page.data = JSON.parse(JSON.stringify(capturedPage.data || {}))
  Object.assign(page.data, data || {})
  page.setDataCalls = []
  page.setData = function (patch, cb) {
    page.setDataCalls.push(patch)
    // 支持 dotted path 的浅套用，够本脚本断言使用
    Object.keys(patch || {}).forEach((k) => {
      if (k.indexOf('.') < 0) {
        page.data[k] = patch[k]
        return
      }
      const seg = k.split('.')
      let cur = page.data
      for (let i = 0; i < seg.length - 1; i++) {
        if (cur[seg[i]] == null || typeof cur[seg[i]] !== 'object') cur[seg[i]] = {}
        cur = cur[seg[i]]
      }
      cur[seg[seg.length - 1]] = patch[k]
    })
    if (typeof cb === 'function') cb()
  }
  page._launchRecordsById = new Map()
  page._getPageSubscribedIdSet = () => new Set()
  page._isKnownSettleableId = () => false
  page._syncCountdownOverlapSideCard = () => {}
  page.applyLaunchSwitchEffects = () => {}
  page.updateMissionListView = () => {}
  page.applyUpcomingAgencyFilterToPatch = () => {}
  page.scheduleUpcomingAgencyChipsOverflowHint = () => {}
  page._buildMissionCardCountdownTickPatch = () => ({})
  page._buildOverlapSideCardPatch = () => ({})
  liveSettle.attachTo(page)
  return page
}

// ---------- B. POST_WINDOW 让位 ----------
console.log('\n===== B. POST_WINDOW 让位 =====')
// 过窗未决任务（NET 3 小时前、窗口早已关闭、宽限也过），后面跟一条未来任务
const stuck = {
  id: 'stuck',
  missionName: '卡住的任务',
  launchTime: new Date(T0 - 3 * 60 * 60 * 1000).toISOString(),
  windowEnd: new Date(T0 - 2.5 * 60 * 60 * 1000).toISOString(),
  statusId: 1
}
const future = {
  id: 'future',
  missionName: '下一条任务',
  launchTime: new Date(T0 + 6 * 60 * 60 * 1000).toISOString(),
  statusId: 1
}

const p1 = makePage({
  launchData: { ...stuck },
  upcomingMissions: [stuck, future]
})
let quietKicked = []
p1._kickQuietSettlePastNetUpcoming = (list) => {
  quietKicked = (list || []).map((m) => m && m.id)
}
p1._statusRecheckTimer = setTimeout(() => {}, 60000)
p1._launchStatusPolling = true

const released = p1._releasePostWindowCountdownPanel('stuck')
check('过窗未决 → 让位返回 true', released === true)
check('主面板已换成下一条未来任务', String(p1.data.launchData.id) === 'future', String(p1.data.launchData.id))
check('探针锁已释放（不再永久占死）', p1._launchStatusPolling === false)
check('复查定时器已清理', p1._statusRecheckTimer === null)
check('被顶下去的任务同拍转入静默结算', quietKicked.indexOf('stuck') >= 0, JSON.stringify(quietKicked))

// 无未来任务时不能让位（否则面板会空）
const p2 = makePage({ launchData: { ...stuck }, upcomingMissions: [stuck] })
p2._kickQuietSettlePastNetUpcoming = () => {}
check('无未来任务 → 不让位（不空面板）', p2._releasePostWindowCountdownPanel('stuck') === false)
check('面板仍是原任务', String(p2.data.launchData.id) === 'stuck')

// 仍在窗口内（IN_WINDOW）时不让位
const inWindow = {
  id: 'inwin',
  missionName: '窗口内',
  launchTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  windowEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  statusId: 1
}
const p3 = makePage({ launchData: { ...inWindow }, upcomingMissions: [inWindow, future] })
p3._kickQuietSettlePastNetUpcoming = () => {}
check('IN_WINDOW → 不让位（窗口内必须挂住）', p3._releasePostWindowCountdownPanel('inwin') === false)

// 面板已被别人切走时不误伤
const p4 = makePage({ launchData: { ...future }, upcomingMissions: [stuck, future] })
p4._kickQuietSettlePastNetUpcoming = () => {}
check('面板已非目标任务 → 不动作', p4._releasePostWindowCountdownPanel('stuck') === false)

// 静默结算的 per-id 节流
console.log('\n===== B2. 静默结算慢探节流 =====')
const p5 = makePage({ upcomingMissions: [stuck] })
let settleAttempts = 0
p5._quietSettlePastNetMission = () => {
  settleAttempts += 1
  return Promise.resolve()
}
p5._kickQuietSettlePastNetUpcoming([stuck], Date.now())
p5._kickQuietSettlePastNetUpcoming([stuck], Date.now() + 60 * 1000)
p5._kickQuietSettlePastNetUpcoming([stuck], Date.now() + 5 * 60 * 1000)
check('60s 主循环重复 kick 被节流为 1 次探针', settleAttempts === 1, 'attempts=' + settleAttempts)

// ---------- C. 无 NET / 低精度 ----------
console.log('\n===== C. NET 缺失与精度降级 =====')
check('Day 精度 → 不可走时钟倒计时', resolveCountdownPrecision({ netPrecision: 'Day' }).clockCapable === false)
check('Hour 精度 → 可走时钟倒计时', resolveCountdownPrecision({ netPrecision: 'Hour' }).clockCapable === true)
check('精度字段缺失 → 不降级（兼容老缓存）', resolveCountdownPrecision({}).clockCapable === true)

const p6 = makePage({
  launchData: { id: 'tbd', missionName: '待定任务', launchTime: '' },
  countdown: { days: 9, hours: 9, minutes: 9, seconds: 9, isExpired: false }
})
p6.updateCountdown()
check('无 NET → 打上待定标记', p6.data.countdownTimeUnknown === true)
check('无 NET → 清掉上一条任务的残留数字', p6.data.countdown.days === 0 && p6.data.countdown.hours === 0, JSON.stringify(p6.data.countdown))
check('无 NET → 不误标过期（避免触发 T-0 探针）', p6.data.countdown.isExpired === false)
const callsBefore = p6.setDataCalls.length
p6.updateCountdown()
check('待定态每秒不重复 setData（幂等）', p6.setDataCalls.length === callsBefore)

const p7 = makePage({
  launchData: {
    id: 'coarse',
    missionName: '粗精度任务',
    launchTime: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
    netPrecision: 'Month'
  }
})
p7.updateCountdown()
check('Month 精度 NET → 面板走待定文案，不编造秒级精度', p7.data.countdownTimeUnknown === true)

const p8 = makePage({
  launchData: {
    id: 'exact',
    missionName: '精确任务',
    launchTime: new Date(Date.now() + 3 * 3600 * 1000 + 37 * 1000).toISOString(),
    netPrecision: 'Minute'
  },
  countdownTimeUnknown: true,
  countdownTimeUnknownText: '发射时间待定'
})
p8.updateCountdown()
check('切回精确 NET → 待定标记被撤掉', p8.data.countdownTimeUnknown === false)
check(
  '切回精确 NET → 倒计时恢复真实值',
  Number(p8.data.countdown.hours) > 0,
  JSON.stringify(p8.data.countdown) + ' patches=' + JSON.stringify(p8.setDataCalls)
)

// 切任务时新旧秒位撞上：秒不变但时/分必须更新，否则残留上一条任务的时间
const p8b = makePage({
  launchData: {
    id: 'sameSec',
    missionName: '秒位相同的新任务',
    launchTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString()
  },
  countdown: { days: 0, hours: 1, minutes: 11, seconds: 0, isExpired: false },
  countdownSecondsCurrent: '00'
})
p8b.updateCountdown()
check(
  '秒位未变但时/分已变 → 仍下发（不残留上一条任务时间）',
  Number(p8b.data.countdown.hours) === 5,
  JSON.stringify(p8b.data.countdown)
)

// ---------- D. 秒滚轮 ----------
console.log('\n===== D. 秒滚轮动画 =====')
const tickSkip = buildCountdownTickState({
  countdown: { days: 0, hours: 1, minutes: 2, seconds: 5 },
  prevCountdown: { days: 0, hours: 1, minutes: 2, seconds: 10 },
  currentSecondsText: '10',
  nextSecondsText: '05',
  nextSecondsReel: ['05', '04', '03']
})
check('跳秒 → 不播动画', tickSkip.immediateState.countdownSecondsRolling === false)
check('跳秒 → 无需 settle（省一次 setData）', tickSkip.settleState === null)
const tickStep = buildCountdownTickState({
  countdown: { days: 0, hours: 1, minutes: 2, seconds: 9 },
  prevCountdown: { days: 0, hours: 1, minutes: 2, seconds: 10 },
  currentSecondsText: '10',
  nextSecondsText: '09',
  nextSecondsReel: ['09', '08', '07']
})
check('正常一秒 → 播动画且有 settle', tickStep.immediateState.countdownSecondsRolling === true && !!tickStep.settleState)

// ---------- E. 后台不打 LL2 ----------
console.log('\n===== E. 后台探针守卫 =====')
const p9 = makePage({ launchData: { ...stuck }, upcomingMissions: [stuck, future] })
p9._countdownPageHidden = true
let armedDelay = null
p9._armLiveStatusRecheck = (id, delay) => {
  armedDelay = delay
}
let probed = false
p9._upsertResolvedIntoSettledCache = () => {
  probed = true
}
return Promise.resolve(p9._checkLiveLaunchStatus('stuck')).then(() => {
  check('后台时不发探针', probed === false)
  check('后台时仍续复查节拍', armedDelay != null, String(armedDelay))

  // in-flight 集合在 promise finally 里清理，让宏任务跑完再验节流窗口过期
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    console.log('\n===== B3. 节流窗口到期后重探 =====')
    p5._kickQuietSettlePastNetUpcoming([stuck], Date.now() + 16 * 60 * 1000)
    check('超过 15 分钟后允许再探一次', settleAttempts === 2, 'attempts=' + settleAttempts)

    console.log('\n===== SUMMARY =====')
    console.log('PASS ' + pass + '  FAIL ' + fail)
    console.log(fail === 0 ? 'ALL_GREEN' : 'HAS_FAILURES')
    if (fail > 0) process.exitCode = 1
  })
})
