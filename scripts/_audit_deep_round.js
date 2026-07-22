/**
 * 深度审计：不只看“有没有方法名”，要验证
 * 1) Page 方法体是否被截断/注释吞掉
 * 2) 委托列表与分包实现一一对应且可 attach
 * 3) wxml 引用的 handler 在 Page/委托中真实存在
 * 4) require 相对路径从文件位置可解析
 * 5) 组件 properties / triggerEvent / bind 一致
 * 6) 同步返回值被异步委托包裹的风险
 */
const fs = require('fs')
const path = require('path')

const issues = []
const warns = []
function fail(m) { issues.push(m) }
function warn(m) { warns.push(m) }

function read(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }

function extractPageMethods(src) {
  const start = src.indexOf('Page({')
  if (start < 0) return {}
  const body = src.slice(start)
  // match method definitions at 2-space indent inside Page
  const re = /\n  ((?:async\s+)?[a-zA-Z_][\w]*)\s*\(([^)]*)\)\s*\{/g
  const methods = {}
  let m
  while ((m = re.exec(body))) {
    const name = m[1].replace(/^async\s+/, '')
    const absStart = start + m.index + 1
    // brace match
    let i = body.indexOf('{', m.index)
    let depth = 0
    let end = i
    for (; end < body.length; end++) {
      const c = body[end]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) { end++; break }
      } else if (c === '"' || c === "'" || c === '`') {
        const q = c
        end++
        while (end < body.length) {
          if (body[end] === '\\') { end += 2; continue }
          if (body[end] === q) break
          end++
        }
      } else if (c === '/' && body[end + 1] === '/') {
        while (end < body.length && body[end] !== '\n') end++
      } else if (c === '/' && body[end + 1] === '*') {
        end += 2
        while (end < body.length - 1 && !(body[end] === '*' && body[end + 1] === '/')) end++
        end++
      }
    }
    const code = body.slice(m.index + 1, end)
    methods[name] = { code, len: code.length, params: m[2] }
  }
  return methods
}

function extractDelegateLists(src) {
  const lists = {}
  const re = /const ([A-Z_]+)_METHODS = \[([\s\S]*?)\]/g
  let m
  while ((m = re.exec(src))) {
    lists[m[1]] = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  }
  return lists
}

function resolveRequire(fromFile, reqPath) {
  if (!reqPath.startsWith('.')) return { ok: true, skipped: true }
  let p = path.normalize(path.join(path.dirname(fromFile), reqPath)).replace(/\\/g, '/')
  if (!p.endsWith('.js') && !fs.existsSync(p)) p += '.js'
  return { ok: fs.existsSync(p), path: p }
}

console.log('======== 1. index.js 结构完整性 ========')
const index = read('pages/index/index.js')
try { new Function(index); console.log('parse OK') } catch (e) { fail('index.js 无法解析: ' + e.message) }

const pageMethods = extractPageMethods(index)
const critical = ['onLoad', 'onShow', 'onHide', 'onUnload', 'onShareAppMessage', 'onShareTimeline', 'onAddToFavorites', 'loadInitialData', 'updateCountdown', 'viewMissionDetail', 'closeMissionSwipeCells']
for (const n of critical) {
  if (!pageMethods[n]) fail(`关键方法缺失: ${n}`)
  else if (pageMethods[n].len < 30 && n !== 'onAddToFavorites') warn(`关键方法异常短: ${n} (${pageMethods[n].len}B)`)
  else console.log('  method', n, pageMethods[n].len + 'B')
}

// 检测被注释吞掉的方法名（出现在注释块里但不在方法表）
if (index.includes('BRIEFIeType') || /\/\*\*\s*\n页/.test(index)) fail('仍有历史截断痕迹 BRIEFIeType/页')
if (!/onShareAppMessage\s*\(e\)\s*\{/.test(index)) fail('onShareAppMessage 签名异常')
// 分享方法开头必须有 briefing 分支
if (!pageMethods.onShareAppMessage || !pageMethods.onShareAppMessage.code.includes("shareType === 'briefing'")) {
  fail('onShareAppMessage 缺少 briefing 分支（可能仍被截断）')
} else console.log('  onShareAppMessage briefing 分支 OK')

console.log('\n======== 2. 委托列表 vs 分包实现 ========')
const lists = extractDelegateLists(index)
const pkgMap = {
  UX: 'subpackages/index-extra/utils/index-ux.js',
  LIVE_SETTLE: 'subpackages/index-extra/utils/index-live-settle.js',
  CAROUSEL: 'subpackages/index-extra/utils/index-carousel.js',
  SPLASH: 'subpackages/index-extra/utils/index-splash.js',
  VOTE: 'subpackages/index-extra/utils/index-vote.js',
  SAVE_IMAGE: 'subpackages/index-extra/utils/index-save-image.js',
  CALENDAR: 'subpackages/index-extra/utils/index-calendar-page.js'
}

for (const [key, file] of Object.entries(pkgMap)) {
  if (!lists[key]) { warn(`委托列表缺失 ${key}_METHODS`); continue }
  if (!fs.existsSync(file)) { fail(`分包文件不存在 ${file}`); continue }
  const modSrc = read(file)
  let missing = []
  let residual = []
  for (const name of lists[key]) {
    // implementation in module
    const hasImpl = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\(`).test(modSrc) ||
      new RegExp(`[\\'{,\\s]${name}\\s*[:(]`).test(modSrc)
    // methods object style: name() { or name: function
    const hasMethod = new RegExp(`\\n  ${name}\\s*\\(`).test(modSrc) || new RegExp(`\\n  ${name}\\s*:\\s*(async\\s*)?function`).test(modSrc)
    if (!hasMethod) missing.push(name)
    // residual real method body in Page
    if (pageMethods[name] && pageMethods[name].len > 0) {
      // pageMethods extractor will also pick up nothing if only in spread delegates
      // Delegates are `name: function` via Object.assign from spread of uxDelegates[name]=delegateUx
      // extractPageMethods looks for `name(){` form - delegates are created as functions assigned by name in spread
      // Actually ...uxDelegates spreads as closeAnnouncementBanner: function(){...} which might NOT match `name(){` pattern
      // So residual check: look for `\n  name(` method body that isn't just in string
      if (new RegExp(`\\n  ${name}\\s*\\([^)]*\\)\\s*\\{`).test(index.slice(index.indexOf('Page({')))) {
        residual.push(name)
      }
    }
  }
  if (missing.length) fail(`${key}: 分包缺实现 ${missing.join(',')}`)
  else console.log(`  ${key}: ${lists[key].length} methods OK in ${file}`)
  if (residual.length) fail(`${key}: 主包仍有方法体（与委托冲突） ${residual.join(',')}`)
}

console.log('\n======== 3. 分包 require 路径可解析 ========')
for (const file of Object.values(pkgMap).concat([
  'subpackages/index-extra/components/calendar-stats/index.js',
  'subpackages/index-extra/components/launch-calendar/index.js'
])) {
  if (!fs.existsSync(file)) continue
  const src = read(file)
  const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  for (const r of reqs) {
    const res = resolveRequire(file, r)
    if (!res.skipped && !res.ok) fail(`${file} require('${r}') → ${res.path} 不存在`)
  }
}
console.log('  require 路径扫描完成')

console.log('\n======== 4. 锚点（防止打包过滤） ========')
const anchor = read('subpackages/index-extra/global-launch-stats.js')
for (const f of ['index-ux.js', 'index-live-settle.js', 'index-carousel.js', 'index-splash.js', 'index-vote.js', 'index-save-image.js', 'index-calendar-page.js']) {
  if (!anchor.includes(f)) fail(`锚点缺少 ${f}`)
  else console.log('  anchor', f)
}

console.log('\n======== 5. wxml handler 可达性 ========')
const wxml = read('pages/index/index.wxml')
const handlers = new Set()
for (const m of wxml.matchAll(/\b(?:bind|catch)(?::)?(?:tap|touchstart|touchmove|touchend|longpress|longtap|change|load|error|input|confirm|blur|focus|scroll|submit|ended|timeupdate)?(?:=|:)"([^"]+)"/gi)) {
  handlers.add(m[1])
}
for (const m of wxml.matchAll(/\bbind:([a-zA-Z]+)="([^"]+)"/g)) {
  handlers.add(m[2])
}
// All UX + calendar + known page methods that wxml needs
const allDelegated = new Set(Object.values(lists).flat())
const missingHandlers = []
for (const h of handlers) {
  if (h === 'true' || h === 'false') continue
  // page method via extract OR delegated
  const inPage = !!pageMethods[h] || allDelegated.has(h) || new RegExp(`\\n  ${h}\\s*\\(`).test(index) || index.includes(`'${h}'`) || index.includes(`"${h}"`)
  // also check spread delegates cover it
  const covered = allDelegated.has(h) || !!pageMethods[h] || new RegExp(`\\b${h}\\s*\\(`).test(index)
  if (!covered) missingHandlers.push(h)
}
if (missingHandlers.length) fail('wxml handler 无实现: ' + missingHandlers.join(', '))
else console.log('  wxml handlers 均可到达, count=', handlers.size)

console.log('\n======== 6. 同步返回值风险（委托方法） ========')
// If delegated method is used as: const x = this.foo(  or return this.foo(  or if(this.foo(
for (const name of allDelegated) {
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*this\\.${name}\\s*\\(`),
    new RegExp(`return\\s+this\\.${name}\\s*\\(`),
    new RegExp(`if\\s*\\(\\s*this\\.${name}\\s*\\(`),
    new RegExp(`\\?\\s*this\\.${name}\\s*\\(`),
    new RegExp(`&&\\s*this\\.${name}\\s*\\(`),
  ]
  for (const re of patterns) {
    if (re.test(index)) {
      // exclude the delegate definition itself
      const lines = index.split('\n')
      lines.forEach((line, i) => {
        if (re.test(line) && !line.includes('delegate') && !line.includes('METHODS')) {
          fail(`同步返回值风险: L${i + 1} 使用委托方法 ${name}: ${line.trim().slice(0, 100)}`)
        }
      })
    }
  }
}
console.log('  同步返回值扫描完成')

console.log('\n======== 7. calendar-stats 组件深度 ========')
const csJs = read('subpackages/index-extra/components/calendar-stats/index.js')
const csWxml = read('subpackages/index-extra/components/calendar-stats/index.wxml')
const csWxss = read('subpackages/index-extra/components/calendar-stats/index.wxss')
const indexJson = JSON.parse(read('pages/index/index.json'))
if (!indexJson.usingComponents['calendar-stats']) fail('index.json 未注册')
if (indexJson.componentPlaceholder['calendar-stats'] !== 'view') fail('placeholder 应为 view')
if (!wxml.includes('<calendar-stats')) fail('wxml 未使用')
if (csWxss.includes('\\n')) fail('wxss 含字面 \\n')
if (!csJs.includes("styleIsolation: 'apply-shared'") && !csJs.includes('styleIsolation: "apply-shared"')) {
  warn('calendar-stats 未设 apply-shared，页面 theme-light 样式可能进不了组件')
}
// check apply-shared
if (!/styleIsolation:\s*['"]apply-shared['"]/.test(csJs)) {
  fail('calendar-stats 缺少 styleIsolation: apply-shared（浅色主题会失效）')
} else console.log('  apply-shared OK')

const props = [...csJs.matchAll(/(\w+):\s*\{\s*type:\s*(\w+)/g)].map((m) => ({ name: m[1], type: m[2] }))
const attrMatch = wxml.match(/<calendar-stats\s([\s\S]*?)(?:\/>|>)/)
const attrs = attrMatch ? attrMatch[1] : ''
for (const p of props) {
  const kebab = p.name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  if (!attrs.includes(kebab + '=')) fail(`属性未绑定: ${kebab}`)
}
if (!csWxml.includes('bindtap="goGlobalLaunchStats"') && !csJs.includes("triggerEvent('goglobalstats')")) fail('统计卡片点击链路断')
if (!attrs.includes('bind:goglobalstats="goGlobalLaunchStats"')) fail('页面未接 goglobalstats')
// day missions still present
if (!wxml.includes('calendar-day-missions')) fail('日任务区块丢失')
if (!wxml.includes('template is="missionCard"')) fail('missionCard 模板引用丢失')
console.log('  calendar-stats 组件检查完成, props=', props.length)

console.log('\n======== 8. landing-icons 运行验证 ========')
const li = require('../utils/landing-icons.js')
const cases = [
  ['BO_LZ', 'neutral'],
  ['BO_LZ', 'success'],
  ['BO_LZ', 'failure'],
  ['NET_CATCH', 'neutral'],
  ['NET_CATCH', 'success'],
  ['RTLS', 'neutral'],
  ['ASDS', 'success'],
  ['TOWER_CATCH', 'neutral'],
  ['LANDSPACE', 'neutral'],
  ['SPACECRAFT_LANDING', 'neutral']
]
for (const [t, st] of cases) {
  const icon = li.buildLandingIcon(t, st)
  if (!icon || !icon.startsWith('data:image/svg')) fail(`buildLandingIcon(${t},${st}) 失败`)
}
const bolz = li.buildLandingIcon('BO_LZ', 'neutral')
if (!li.isBoLzIconSrc(bolz)) fail('新 BO_LZ 无法被 isBoLzIconSrc 识别')
// New Glenn path
const fakeLaunch = {
  rocket: { configuration: { name: 'New Glenn', full_name: 'New Glenn' } },
  launch_service_provider: { name: 'Blue Origin' }
}
const ld = { description: 'Landing on LPV-1 Jacklyn' }
const src = li.resolveLandingIconSrc('ASDS', 'neutral', fakeLaunch, { ld, locAbbrev: 'LPV-1', locName: 'Jacklyn' })
if (!src || !li.isBoLzIconSrc(src)) fail('新格伦 LPV1 未走到 BO_LZ 图标')
else console.log('  New Glenn → BO_LZ OK')
const netLaunch = {
  rocket: { configuration: { name: 'Long March 10B', full_name: 'Long March 10B', reusable: true, description: 'arrestor net recovery barge' } }
}
if (!li.inferNetRecoveryFromLaunch(netLaunch)) fail('长十乙网系识别失败')
else console.log('  长十乙网系识别 OK')

console.log('\n======== 9. index.wxss 完整性 ========')
const wxss = read('pages/index/index.wxss')
if (/\\n\/\*/.test(wxss) || wxss.includes('\\n.countdown')) fail('index.wxss 仍有字面 \\n 损坏')
for (const must of ['.countdown-action-row', '.calendar-day-missions', '.vote-box', '.theme-light', '.mission-swipe-cell']) {
  if (!wxss.includes(must)) fail(`wxss 缺少 ${must}`)
}
if (wxss.includes('日历内全球发射数据')) fail('全球统计样式应已迁出但仍在页面')
if (!csWxss.includes('.calendar-stats-section')) fail('组件 wxss 缺主样式')
// keyframes
const calWxss = read('subpackages/index-extra/components/launch-calendar/index.wxss')
if (!calWxss.includes('@keyframes starshipTextBlink')) fail('日历组件缺 keyframes')
console.log('  wxss OK')

console.log('\n======== 10. attachTo 可执行冒烟（stub wx） ========')
global.wx = {
  showToast() {},
  navigateTo() {},
  getImageInfo() {},
  vibrateShort() {},
  env: { USER_DATA_PATH: '/tmp' }
}
global.getApp = () => ({ globalData: {}, _privacyPromptedThisSession: false })
// Clear require cache for modules that may have failed
Object.keys(require.cache).forEach((k) => {
  if (k.includes('index-ux') || k.includes('demo-engine') || k.includes('index-mission-nav')) delete require.cache[k]
})
try {
  const uxMod = require('../subpackages/index-extra/utils/index-ux.js')
  const page = {
    data: {
      missionSwipeOpenWxkey: 'x',
      shareSheetVisible: true,
      shareImage: '',
      pendingShareMission: null
    },
    setData(d, cb) { Object.assign(this.data, d); cb && cb() },
    closeMissionSwipeCells() { this._swipeClosed = true },
    selectComponent() { return null }
  }
  uxMod.attachTo(page)
  if (!page.__uxAttached) fail('attachTo 未置位 __uxAttached')
  page.closeAnnouncementBanner()
  if (page.data.announcementBanner !== null) fail('closeAnnouncementBanner 未清空')
  if (!page._swipeClosed) fail('closeAnnouncementBanner 未调 closeMissionSwipeCells')
  page.closeAnnouncementDetail()
  if (page.data.announcementDialogVisible !== false) fail('closeAnnouncementDetail 失败')
  page.onShareSheetClose()
  if (page.data.shareSheetVisible !== false) fail('onShareSheetClose 失败')
  page.openShop()
  page.ensureShareImageHttpUrl('wxfile://tmp/test.png')
  if (page.data.shareImage !== 'wxfile://tmp/test.png') fail('ensureShareImageHttpUrl 本地路径失败')
  // openAISearch should not throw
  page.openAISearch()
  console.log('  attachTo 冒烟 OK')
} catch (e) {
  fail('attachTo 冒烟失败: ' + e.stack)
}

console.log('\n======== 汇总 ========')
console.log('FAIL', issues.length)
issues.forEach((i) => console.log('  ✗', i))
console.log('WARN', warns.length)
warns.forEach((i) => console.log('  !', i))
process.exit(issues.length ? 1 : 0)
