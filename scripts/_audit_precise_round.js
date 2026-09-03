/**
 * 精确审计本轮改动（修正 async 误报），并对关键执行路径做静态追踪
 */
const fs = require('fs')
const path = require('path')
const issues = []
const notes = []
function fail(m) { issues.push(m); console.log('FAIL', m) }
function note(m) { notes.push(m); console.log('NOTE', m) }
function ok(m) { console.log('OK  ', m) }

function read(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }

function hasMethod(src, name) {
  // name() {  OR  async name() {  OR  name: function  OR  name: async function
  return new RegExp(
    `(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{|` +
    `(?:^|\\n)\\s*${name}\\s*:\\s*(?:async\\s+)?function\\b`,
    'm'
  ).test(src)
}

function methodBody(src, name) {
  const re = new RegExp(`(?:^|\\n)(  (?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{)`)
  const m = src.match(re)
  if (!m) return null
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        i++
      }
    }
  }
  return null
}

const index = read('pages/index/index.js')
const ux = read('subpackages/index-extra/utils/index-ux.js')
const wxml = read('pages/index/index.wxml')

console.log('===== A. 本轮 UX 分包 =====')
const uxList = [...index.match(/const UX_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1])
for (const name of uxList) {
  if (!hasMethod(ux, name)) fail(`index-ux 缺 ${name}`)
  if (hasMethod(index.slice(index.indexOf('Page({')), name) && new RegExp(`\\n  (?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`).test(index.slice(index.indexOf('Page({')))) {
    fail(`主包 Page 仍有 ${name} 方法体（会盖住委托？或冲突）`)
  }
}
ok(`UX ${uxList.length} 方法分包齐全、主包无方法体`)

// demo-engine paths
;[...ux.matchAll(/require\(['"]([^'"]+)['"]\)/g)].forEach((m) => {
  const r = m[1]
  if (!r.startsWith('.')) return
  let p = path.normalize(path.join('subpackages/index-extra/utils', r)).replace(/\\/g, '/')
  if (!p.endsWith('.js')) p += '.js'
  if (!fs.existsSync(p)) fail(`require 失败 ${r} -> ${p}`)
})
ok('index-ux 全部相对 require 可解析')

// 跨模块调用：UX 调主包方法
const crossCalls = ['closeMissionSwipeCells']
for (const c of crossCalls) {
  if (!hasMethod(index, c)) fail(`UX 依赖的主包方法缺失: ${c}`)
}
ok('UX→主包 closeMissionSwipeCells 存在')

console.log('\n===== B. 分享三件套（上轮截断重灾区） =====')
for (const n of ['onShareAppMessage', 'onShareTimeline', 'onAddToFavorites']) {
  const body = methodBody(index, n)
  if (!body) fail(`无 ${n}`)
  else {
    ok(`${n} ${body.length}B`)
    if (n === 'onShareAppMessage') {
      if (!body.includes("shareType === 'briefing'")) fail('缺 briefing')
      if (!body.includes("shareType === 'roadClosure'")) fail('缺 roadClosure')
      if (!body.includes("shareType === 'mission'")) fail('缺 mission')
      if (!body.includes('pendingShareMission')) fail('缺 pending 兜底')
      if (!body.includes('buildMissionShareOptions')) fail('缺 buildMissionShareOptions')
      if (body.includes('BRIEFIeType')) fail('仍有截断')
    }
  }
}

console.log('\n===== C. 关键 async 方法体积（防截断） =====')
const criticalAsync = ['loadInitialData', 'loadMoreMissions', 'fetchMissionList', 'switchMissionType', 'onCountdownReminderTap']
for (const n of criticalAsync) {
  const body = methodBody(index, n)
  if (!body) {
    // may be delegated
    const lists = [...index.matchAll(/const ([A-Z_]+)_METHODS = \[([\s\S]*?)\]/g)]
    let delegated = false
    for (const L of lists) {
      if (L[2].includes(`'${n}'`) || L[2].includes(`"${n}"`)) delegated = true
    }
    if (delegated) ok(`${n} 在委托列表`)
    else note(`${n} 未找到（可能已改名）`)
  } else {
    if (body.length < 100) fail(`${n} 异常短 ${body.length}B`)
    else ok(`${n} ${body.length}B`)
  }
}

console.log('\n===== D. 既有委托分包实现（async 兼容） =====')
const pkgs = {
  LIVE_SETTLE: 'subpackages/index-extra/utils/index-live-settle.js',
  CAROUSEL: 'subpackages/index-extra/utils/index-carousel.js',
  SPLASH: 'subpackages/index-extra/utils/index-splash.js',
  VOTE: 'subpackages/index-extra/utils/index-vote.js',
  SAVE_IMAGE: 'subpackages/index-extra/utils/index-save-image.js',
  CALENDAR: 'subpackages/index-extra/utils/index-calendar-page.js',
  UX: 'subpackages/index-extra/utils/index-ux.js'
}
for (const [key, file] of Object.entries(pkgs)) {
  const listMatch = index.match(new RegExp(`const ${key}_METHODS = \\[([\\s\\S]*?)\\]`))
  if (!listMatch) { fail(`无 ${key}_METHODS`); continue }
  const names = [...listMatch[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1])
  const src = read(file)
  const missing = names.filter((n) => !hasMethod(src, n))
  if (missing.length) fail(`${key} 缺: ${missing.join(',')}`)
  else ok(`${key} ${names.length}/${names.length}`)
}

console.log('\n===== E. calendar-stats 执行链 =====')
const csJs = read('subpackages/index-extra/components/calendar-stats/index.js')
const csWxml = read('subpackages/index-extra/components/calendar-stats/index.wxml')
const j = JSON.parse(read('pages/index/index.json'))
if (!j.usingComponents['calendar-stats']) fail('未注册')
if (!wxml.includes('<calendar-stats')) fail('未使用')
if (!/styleIsolation:\s*['"]apply-shared['"]/.test(csJs)) fail('无 apply-shared')
if (!csJs.includes("triggerEvent('goglobalstats')")) fail('无 triggerEvent')
if (!wxml.includes('bind:goglobalstats="goGlobalLaunchStats"')) fail('页面未绑事件')
// goGlobalLaunchStats must be in CALENDAR_METHODS
if (!index.match(/CALENDAR_METHODS[\s\S]*goGlobalLaunchStats/)) fail('goGlobalLaunchStats 不在日历委托')
// 选中日期时统计应隐藏
if (!csWxml.includes('!expandedDateKey')) fail('展开日期时统计未隐藏')
// 日任务仍用模板
if (!wxml.includes('calendar-day-missions') || !wxml.includes('missionCard')) fail('日任务/模板丢失')
ok('calendar-stats 链路完整')

// 顺序：stats 组件与 day-missions —— 展开日期时 stats 内部全藏，day-missions 显示
ok('日任务保留在页面（依赖 page-level template）')

console.log('\n===== F. landing-icons =====')
const li = require('../utils/landing-icons.js')
const bolz = li.buildLandingIcon('BO_LZ', 'success')
const net = li.buildLandingIcon('NET_CATCH', 'failure')
if (!bolz || !li.isBoLzIconSrc(bolz)) fail('BO_LZ/detector')
if (!net) fail('NET_CATCH')
// encodeURI 后颜色
if (!bolz.includes('rgb(34,197,94)') && !bolz.includes('rgb%2834')) {
  // encodeURI keeps rgb() mostly
  if (!bolz.includes('34,197,94') && !bolz.includes('34%2C197%2C94')) note('success 色编码形式需留意: ' + bolz.slice(0, 120))
}
ok('landing-icons 核心路径 OK')

console.log('\n===== G. 运行时冒烟 attachTo + 分享依赖 =====')
global.wx = global.wx || {
  showToast() {}, navigateTo() {}, getImageInfo() {}, vibrateShort() {},
  env: { USER_DATA_PATH: '/tmp' }
}
global.getApp = () => ({ globalData: {}, _privacyPromptedThisSession: false })
delete require.cache[require.resolve('../subpackages/index-extra/utils/index-ux.js')]
const uxMod = require('../subpackages/index-extra/utils/index-ux.js')
const page = {
  data: { missionSwipeOpenWxkey: '1', shareSheetVisible: true, shareImage: '', announcementDialogVisible: true },
  setData(d) { Object.assign(this.data, d) },
  closeMissionSwipeCells() { this._c = true },
  selectComponent() { return null }
}
uxMod.attachTo(page)
page.closeAnnouncementBanner()
page.closeAnnouncementDetail()
page.onShareSheetClose()
page.ensureShareImageHttpUrl('wxfile://x')
page.openAISearch()
if (page.data.announcementBanner !== null) fail('banner')
if (page.data.announcementDialogVisible !== false) fail('dialog')
if (!page._c) fail('swipe')
if (page.data.shareImage !== 'wxfile://x') fail('shareImage')
ok('attachTo 冒烟通过')

// 分享符号
for (const s of ['ROUTES', 'buildMissionShareOptions', 'resolveMissionSharePayload', 'DEFAULT_SHARE_IMAGE', 'resolveMissionRocketImage']) {
  if (!index.includes(s)) fail('缺符号 ' + s)
}
ok('分享符号齐全')

console.log('\n===== H. 锚点 + preload =====')
const anchor = read('subpackages/index-extra/global-launch-stats.js')
if (!anchor.includes('index-ux.js')) fail('缺 index-ux 锚点')
const app = JSON.parse(read('app.json'))
const pre = app.preloadRule || {}
const indexPre = pre['pages/index/index'] || (pre.pages && pre.pages['pages/index/index'])
// structure: { "pages/index/index": { packages: ["index-extra"] } }
let hasPreload = false
for (const [k, v] of Object.entries(pre)) {
  if (k.includes('index') && v && Array.isArray(v.packages) && v.packages.some(p => p.includes('index-extra') || p === 'index-extra')) {
    hasPreload = true
  }
}
if (!hasPreload) note('preloadRule 未明确包含 index-extra（或命名不同）')
else ok('preloadRule 含 index-extra')
ok('锚点 OK')

console.log('\n===== I. wxml 中 UX/组件相关绑定抽检 =====')
const mustBind = [
  ['openAISearch', '搜索'],
  ['closeAnnouncementBanner', '关公告条'],
  ['closeAnnouncementDetail', '关公告弹窗'],
  ['onMissionLongPress', '长按'],
  ['onShareSheetClose', '关分享'],
  ['onBriefingClosed', '简报关闭'],
  ['onDemoRemoteStart', '演示'],
]
for (const [h, label] of mustBind) {
  if (!wxml.includes(`"${h}"`) && !wxml.includes(`'${h}'`)) fail(`wxml 无 ${label}(${h})`)
}
ok('关键 wxml 绑定存在')

console.log('\n======== 汇总 ========')
console.log('失败', issues.length)
issues.forEach(i => console.log('  ✗', i))
console.log('备注', notes.length)
notes.forEach(i => console.log('  ·', i))
process.exit(issues.length ? 1 : 0)
