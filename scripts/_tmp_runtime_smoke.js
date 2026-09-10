// 运行时冒烟：真实 require 页面 JS 与分包 lazy 模块，验证：
// 1) Page 配置可构造、委托占位方法存在
// 2) require.async 委托 → attachTo → 方法真实执行（走真实 lazy 模块及其 utils 依赖）
// 3) sectionevent 分发器还原事件并调用目标方法
const path = require('path')

// ── wx / 小程序全局 mock ──
const storage = {}
global.wx = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
  setStorage: (o) => { storage[o.key] = o.data; o.success && o.success() },
  getStorage: (o) => { o.key in storage ? (o.success && o.success({ data: storage[o.key] })) : (o.fail && o.fail()) },
  showToast: () => {},
  showModal: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  navigateTo: () => {},
  switchTab: () => {},
  setClipboardData: (o) => { global.__clip = o.data; o.success && o.success() },
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => {} }), exec: () => {} }) }),
  getDeviceInfo: () => ({ platform: 'ios' }),
  getWindowInfo: () => ({ statusBarHeight: 44, screenWidth: 390, screenHeight: 844, safeArea: { bottom: 810 } }),
  getAppBaseInfo: () => ({ SDKVersion: '3.0.0', theme: 'dark' }),
  getSystemInfoSync: () => ({ platform: 'ios', statusBarHeight: 44, screenWidth: 390, screenHeight: 844, SDKVersion: '3.0.0' }),
  getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, height: 32, left: 280, right: 370, width: 90 }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  getNetworkType: (o) => o && o.success && o.success({ networkType: 'wifi' }),
  cloud: {
    callFunction: () => Promise.resolve({ result: {} }),
    database: () => ({ collection: () => ({ where() { return this }, orderBy() { return this }, skip() { return this }, limit() { return this }, get: () => Promise.resolve({ data: [] }), doc: () => ({ get: () => Promise.resolve({ data: null }) }) }) })
  },
  env: { USER_DATA_PATH: '/tmp' },
  canIUse: () => false,
  nextTick: (fn) => setTimeout(fn, 0),
  requirePrivacyAuthorize: (o) => o.success && o.success()
}
global.getApp = () => ({ globalData: {}, getUiShellLayout: () => ({ statusBarHeight: 44, navPlaceholderHeight: 88, tabBarReservedHeight: 100 }), checkProgressDot: () => {}, checkNewsDot: () => {}, checkProfileDot: () => {} })
global.getCurrentPages = () => []

let pageConfig = null
global.Page = (cfg) => { pageConfig = cfg }
global.Component = (cfg) => { global.__lastComponent = cfg }
global.App = () => {}

// require.async shim：真实 require 目标模块（模拟分包异步加载成功）
const Module = require('module')
const origRequire = Module.prototype.require
Module.prototype.require = function (p) {
  const mod = origRequire.call(this, p)
  return mod
}
require.async = null // 页面里用的是 require.async —— 小程序注入；node 下需给每个模块补
// 通过全局钩子：在编译上下文给 require 补 async
const fs = require('fs')
const vm = require('vm')
function loadPageModule(file) {
  const code = fs.readFileSync(file, 'utf8')
  const dirname = path.dirname(path.resolve(file))
  const req = (p) => {
    if (p.startsWith('.')) return require(path.resolve(dirname, p))
    return require(p)
  }
  req.async = (p) => Promise.resolve(require(path.resolve(dirname, p)))
  const module_ = { exports: {} }
  const fn = new vm.Script('(function(require, module, exports, __dirname, __filename){' + code + '\n})').runInThisContext()
  fn(req, module_, module_.exports, dirname, file)
  return module_.exports
}

async function main() {
  let fails = 0
  const bad = (m) => { fails++; console.log('[FAIL] ' + m) }
  const ok = (m) => console.log('[ok] ' + m)

  // ══ profile ══
  loadPageModule('pages/profile/profile.js')
  const p = Object.create(pageConfig)
  p.data = JSON.parse(JSON.stringify(pageConfig.data))
  p.__setDataLog = []
  p.setData = function (patch) { this.__setDataLog.push(patch); Object.assign(this.data, patch) }
  p.getTabBar = () => null

  // 1) 委托：onCopyOaName（lazy 方法，走 require.async → attachTo → 真执行 wx.setClipboardData）
  global.__clip = ''
  await p.onCopyOaName()
  global.__clip === '火星探索日志' ? ok('profile 委托链路：onCopyOaName 真实执行（剪贴板=' + global.__clip + '）') : bad('onCopyOaName 未生效: ' + global.__clip)
  p.__profileLazyAttached ? ok('profile-lazy attachTo 完成，方法已覆盖占位') : bad('attachTo 未设置标记')

  // 2) sectionevent 分发：oa 开关（edetail.value 还原为 e.detail.value）
  const before = p.data.oaAlertLoading
  await p.onProfileSectionEvent({ detail: { name: 'onOaAlertSwitch', dataset: {}, edetail: { value: false } } })
  ok('sectionevent 分发 onOaAlertSwitch 无异常（loading 恢复=' + p.data.oaAlertLoading + '，之前=' + before + '）')

  // 3) 分发器白名单拦截
  const r = p.onProfileSectionEvent({ detail: { name: 'loadMyPrizes', dataset: {}, edetail: {} } })
  r === undefined ? ok('白名单拦截非交互方法（loadMyPrizes 不经组件通道）') : bad('白名单未拦截')

  // 4) 年鉴跳转（lazy goYearReview 用 ROUTES.YEAR_REVIEW）
  let navUrl = ''
  global.wx.navigateTo = (o) => { navUrl = o.url }
  await p.goYearReview()
  navUrl.includes('year') || navUrl.length > 0 ? ok('goYearReview 跳转 url=' + navUrl) : bad('goYearReview 未跳转')

  // ══ progress ══
  loadPageModule('pages/progress/progress.js')
  const g = Object.create(pageConfig)
  g.data = JSON.parse(JSON.stringify(pageConfig.data))
  g.setData = function (patch) { Object.assign(this.data, patch) }
  g.getTabBar = () => null

  // 5) LL2 折叠区委托（showLaunchLibraryUpdates=false 时应清空并复位 loading）
  g.data.showLaunchLibraryUpdates = false
  await g.loadLl2LaunchUpdates()
  g.__progressLazyAttached ? ok('progress-lazy attachTo 完成') : bad('progress attachTo 未完成')
  g.data.ll2LaunchUpdatesLoading === false && Array.isArray(g.data.ll2LaunchUpdates) ? ok('loadLl2LaunchUpdates 委托执行（disabled 分支）') : bad('loadLl2LaunchUpdates 状态异常')

  // 6) 事件列表加载（云库 mock 返回空 → loading 复位、noMore 正确）
  g.data.showLaunchLibraryUpdates = true
  await g.loadEventUpdates(true, '')
  g.data.eventUpdatesLoading === false ? ok('loadEventUpdates 委托执行，loading 复位') : bad('loadEventUpdates loading 未复位')

  // 7) formatEventTime 附着后同步可用（供 _enrichEventItem / LL2 使用）
  typeof g.formatEventTime === 'function' && g.formatEventTime(1700000000000).includes('-') ? ok('formatEventTime 附着后同步返回: ' + g.formatEventTime(1700000000000)) : bad('formatEventTime 异常')

  // 8) 分享（保留在主包，必须同步返回）
  const share = g.onShareAppMessage({})
  share && share.path === '/pages/progress/progress' ? ok('onShareAppMessage 同步返回默认分享') : bad('onShareAppMessage 异常: ' + JSON.stringify(share))
  const tl = g.onShareTimeline()
  tl && tl.title ? ok('onShareTimeline 同步返回: ' + tl.title.slice(0, 30)) : bad('onShareTimeline 异常')

  // 9) 事件分享构造（依赖 findEventUpdateItem + buildEventUpdateShareOptions 主包同步链）
  g.data.eventUpdates = [{ _id: 'e1', title: '测试事件', mediaList: [] }]
  const s2 = g.onShareAppMessage({ from: 'button', target: { dataset: { shareType: 'eventUpdateItem', id: 'e1' } } })
  s2 && s2.path.includes('e1') ? ok('事件卡分享路径正确: ' + s2.path) : bad('事件卡分享异常: ' + JSON.stringify(s2))

  console.log(fails ? ('\n共 ' + fails + ' 项失败') : '\n运行时冒烟全部通过')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1) })
