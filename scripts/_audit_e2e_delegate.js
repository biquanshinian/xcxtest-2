// 一次性端到端测试：桩环境加载真实 pages/index/index.js，
// 验证 Page 对象完整性 + 委托 → require.async → attachTo → 真方法调用 全链路
const path = require('path')

// ---- 小程序环境桩 ----
const storage = new Map()
global.wx = new Proxy({}, {
  get: (t, prop) => {
    if (prop === 'getStorageSync') return (k) => (storage.has(k) ? storage.get(k) : '')
    if (prop === 'setStorageSync') return (k, v) => storage.set(k, v)
    if (prop === 'getSystemInfoSync') return () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44, platform: 'devtools', SDKVersion: '3.0.0' })
    if (prop === 'getAccountInfoSync') return () => ({ miniProgram: { envVersion: 'develop', appId: 'stub' } })
    if (prop === 'getMenuButtonBoundingClientRect') return () => ({ top: 48, bottom: 80, left: 300, right: 380, width: 80, height: 32 })
    if (prop === 'getAppBaseInfo') return () => ({ SDKVersion: '3.0.0', theme: 'dark' })
    if (prop === 'getWindowInfo') return () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44, pixelRatio: 3, safeArea: { top: 47, bottom: 810 } })
    if (prop === 'getDeviceInfo') return () => ({ platform: 'devtools', brand: 'stub' })
    if (prop === 'cloud') return new Proxy({}, { get: () => () => ({}) })
    if (prop === 'env') return { USER_DATA_PATH: '/tmp' }
    if (prop === 'canIUse') return () => false
    if (prop === 'onAppShow' || prop === 'onAppHide' || prop === 'onError') return () => {}
    return (...args) => ({})
  }
})
global.getApp = () => ({ globalData: {}, getUiShellLayout: null })
global.getCurrentPages = () => []
global.App = () => {}
global.Component = () => {}
global.Behavior = (o) => o

let capturedPage = null
global.Page = (obj) => { capturedPage = obj }

// require.async 桩：按调用方文件相对路径解析（模拟微信分包异步化）
const Module = require('module')
const origResolve = Module.prototype.require
require.async = null // 会在每个模块内单独注入? 不行——小程序里 require.async 是每模块注入的。
// 全局补丁：给所有模块的 require 挂 async
const origReq = Module.prototype.require
Module.prototype.require = function (id) {
  const result = origReq.apply(this, arguments)
  return result
}
// 简化：在 global 上放一个 require.async 实现不可行（require 是模块局部的）。
// 改用 Module.wrap 钩子：给每个模块的 require 注入 async 方法。
const origWrap = Module.wrap
Module.wrap = function (script) {
  const inject = 'if (typeof require !== "undefined" && !require.async) { require.async = (p) => { try { return Promise.resolve(require(p)) } catch (e) { return Promise.reject(e) } } }\n'
  return origWrap(inject + script)
}

// ---- 加载真实页面文件 ----
const pageFile = path.resolve('pages/index/index.js')
try {
  require(pageFile)
} catch (e) {
  console.log('[页面加载失败]', e.message)
  console.log(e.stack.split('\n').slice(0, 6).join('\n'))
  process.exit(1)
}
console.log('页面加载: OK')
if (!capturedPage) { console.log('[Page 未捕获]'); process.exit(1) }

const LIVE_METHODS = ['_scrubKnownSettleableCountdown', '_refilterUpcomingAgainstSettled',
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

// 1) Page 对象上 31 个委托齐全
let miss = 0
for (const n of LIVE_METHODS) {
  if (typeof capturedPage[n] !== 'function') { console.log('[委托缺失]', n); miss++ }
}
console.log('委托齐全:', miss === 0 ? 'OK (31/31)' : miss + ' 个缺失')

// 2) data 完整性：能求值且为对象
console.log('data 键数:', Object.keys(capturedPage.data).length)

// 3) 端到端：构造伪 page 实例，调用一个委托，验证 attachTo 后真方法被调用
const pageInst = Object.create(capturedPage)
pageInst.data = JSON.parse(JSON.stringify(capturedPage.data))
pageInst.setData = function (patch, cb) {
  // 支持微信路径式键：'a.b.c' / 'list[0].x'
  for (const [k, v] of Object.entries(patch)) {
    const segs = k.split(/[.[\]]/).filter(Boolean)
    let o = this.data
    for (let i = 0; i < segs.length - 1; i++) {
      const key = /^\d+$/.test(segs[i]) ? Number(segs[i]) : segs[i]
      if (o[key] == null) o[key] = /^\d+$/.test(segs[i + 1]) ? [] : {}
      o = o[key]
    }
    const last = segs[segs.length - 1]
    o[/^\d+$/.test(last) ? Number(last) : last] = v
  }
  if (cb) cb()
}
pageInst.selectComponent = () => null
pageInst.createSelectorQuery = () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) })

;(async () => {
  // openRoadClosureDetail：纯导航方法，桩下无副作用
  try {
    await pageInst.openRoadClosureDetail()
    console.log('委托调用 openRoadClosureDetail: OK, attach 标记:', pageInst.__liveSettleAttached === true)
  } catch (e) {
    console.log('[委托调用失败]', e.message)
  }
  // attach 后方法应为真实实现（非委托包装）
  const real = pageInst.openRoadClosureDetail
  console.log('attach 后已替换为真方法:', real !== capturedPage.openRoadClosureDetail)
  // 再调一个带数据流的：_applyLiveStatusPanel（写 launchData 状态字段）
  try {
    pageInst.data.launchData = { id: '99', statusTextZh: '', statusCategory: '' }
    await pageInst._applyLiveStatusPanel('99', '发射成功', 'success')
    const ld = pageInst.data.launchData
    console.log('_applyLiveStatusPanel 数据回写:', ld.statusTextZh === '发射成功' && ld.statusCategory === 'success' ? 'OK' : JSON.stringify(ld))
  } catch (e) {
    console.log('[_applyLiveStatusPanel 失败]', e.message)
  }
  // 4) 其余 5 个分包模块的委托也全部可达
  const allDelegated = []
  const src = require('fs').readFileSync(pageFile, 'utf8')
  let m
  const re = /_METHODS\s*=\s*\[([\s\S]*?)\]/g
  while ((m = re.exec(src))) {
    let s2
    const strRe = /'([^']+)'/g
    while ((s2 = strRe.exec(m[1]))) allDelegated.push(s2[1])
  }
  let bad = 0
  for (const n of allDelegated) {
    if (typeof capturedPage[n] !== 'function') { console.log('[委托缺失]', n); bad++ }
  }
  console.log('全部委托名单 (' + allDelegated.length + ' 个) 可达:', bad === 0 ? 'OK' : bad + ' 个缺失')
})()
