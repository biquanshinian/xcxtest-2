/**
 * 本轮改动端到端审计
 */
const fs = require('fs')
const path = require('path')
const issues = []
const ok = []

function fail(msg) { issues.push(msg); console.log('FAIL', msg) }
function pass(msg) { ok.push(msg); console.log('OK  ', msg) }

// ── 1. index-ux 方法完整性 ──
const ux = fs.readFileSync('subpackages/index-extra/utils/index-ux.js', 'utf8')
const index = fs.readFileSync('pages/index/index.js', 'utf8')
const uxMethodsMatch = index.match(/const UX_METHODS = \[([\s\S]*?)\]/)
const listed = [...uxMethodsMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
for (const name of listed) {
  if (!new RegExp(`\\b${name}\\s*\\(`).test(ux)) fail(`UX_METHODS 有 ${name} 但 index-ux.js 无实现`)
  else if (new RegExp(`^\\s{2}${name}\\s*\\(`, 'm').test(index.replace(/^[\s\S]*?Page\(\{/, ''))) {
    // after Page({ might still have method if not extracted - check Page body for real method not just string
  }
}
// check no duplicate real methods left in Page (excluding UX_METHODS array strings)
const pageBody = index.slice(index.indexOf('Page({'))
for (const name of listed) {
  const re = new RegExp(`\\n  ${name}\\s*\\([^)]*\\)\\s*\\{`)
  if (re.test(pageBody)) fail(`index.js Page 仍残留方法体: ${name}`)
}
pass(`UX 委托方法 ${listed.length} 个均在分包实现、主包无残留方法体`)

// ── 2. demo-engine 路径 ──
const demoRequires = [...ux.matchAll(/require\(['"]([^'"]*demo-engine[^'"]*)['"]\)/g)].map((m) => m[1])
const uxDir = 'subpackages/index-extra/utils'
for (const r of demoRequires) {
  const resolved = path.normalize(path.join(uxDir, r)).replace(/\\/g, '/')
  const exists = fs.existsSync(resolved + (resolved.endsWith('.js') ? '' : '.js')) || fs.existsSync(resolved)
  if (!exists) fail(`index-ux demo-engine 路径错误: require('${r}') → ${resolved}`)
  else pass(`demo-engine 路径可读: ${r}`)
}

// ── 3. 锚点 ──
const anchor = fs.readFileSync('subpackages/index-extra/global-launch-stats.js', 'utf8')
if (!anchor.includes("require('./utils/index-ux.js')")) fail('缺少 index-ux 打包锚点')
else pass('index-ux 打包锚点存在')

// ── 4. 同步返回值风险：委托方法被当作同步使用 ──
// 模式：const x = this.method( 或 return this.method( 或 if (this.method(
const syncRisk = []
for (const name of listed) {
  const re = new RegExp(`(?:const|let|var|return|if\\s*\\(|&&|\\|\\||\\?)\\s*(?:this\\.)?${name}\\s*\\(`, 'g')
  // also: something = this.name(
  const re2 = new RegExp(`=\\s*this\\.${name}\\s*\\(`, 'g')
  let m
  const body = index
  while ((m = re.exec(body))) {
    // skip the UX_METHODS list and delegate definition
    const ctx = body.slice(Math.max(0, m.index - 80), m.index + 40)
    if (ctx.includes('UX_METHODS') || ctx.includes('delegateUx')) continue
    syncRisk.push({ name, ctx: ctx.replace(/\s+/g, ' ').slice(0, 100) })
  }
  while ((m = re2.exec(body))) {
    syncRisk.push({ name, ctx: body.slice(m.index, m.index + 60).replace(/\s+/g, ' ') })
  }
}
if (syncRisk.length) {
  syncRisk.forEach((r) => fail(`可能的同步返回值依赖: ${r.name} @ ${r.ctx}`))
} else {
  pass('UX 委托调用均为语句式（无同步返回值依赖）')
}

// ── 5. calendar-stats 组件一致性 ──
const csJs = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.js', 'utf8')
const csWxml = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.wxml', 'utf8')
const csWxss = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.wxss', 'utf8')
const indexWxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
const indexJson = JSON.parse(fs.readFileSync('pages/index/index.json', 'utf8'))

if (!indexJson.usingComponents['calendar-stats']) fail('index.json 未注册 calendar-stats')
else pass('index.json 已注册 calendar-stats')
if (!indexJson.componentPlaceholder['calendar-stats']) fail('缺少 calendar-stats placeholder')
else pass('calendar-stats placeholder=view')

if (!indexWxml.includes('<calendar-stats')) fail('index.wxml 未使用 calendar-stats')
else pass('index.wxml 使用 calendar-stats')

// properties vs wxml attrs
const props = [...csJs.matchAll(/(\w+):\s*\{\s*type:/g)].map((m) => m[1])
// kebab in wxml
const attrs = [...indexWxml.matchAll(/<(calendar-stats)([^>]*)>/g)][0]
const attrBlock = attrs ? attrs[2] : ''
const bound = [...attrBlock.matchAll(/([\w-]+)="/g)].map((m) => m[1]).filter((a) => a !== 'bind' && !a.startsWith('bind:'))
function toCamel(k) {
  return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
for (const a of bound) {
  if (a.startsWith('bind')) continue
  const camel = toCamel(a)
  if (!props.includes(camel)) fail(`wxml 属性 ${a} 无对应 properties.${camel}`)
}
for (const p of props) {
  const kebab = p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  if (!attrBlock.includes(kebab) && !attrBlock.includes(p)) fail(`properties.${p} 未在 wxml 绑定`)
}
pass(`calendar-stats properties↔wxml 对齐 (${props.length})`)

// events
if (!csJs.includes("triggerEvent('goglobalstats')")) fail('缺 goglobalstats 事件')
if (!attrBlock.includes('bind:goglobalstats') && !indexWxml.includes('bind:goglobalstats')) fail('页面未绑定 goglobalstats')
else pass('goglobalstats 事件链路完整')

// goGlobalLaunchStats in calendar delegates
if (!index.includes("'goGlobalLaunchStats'") && !index.includes('"goGlobalLaunchStats"')) fail('goGlobalLaunchStats 不在日历委托')
else pass('goGlobalLaunchStats 在日历委托列表')

// wxss sanity
if (csWxss.includes('\\n')) fail('calendar-stats.wxss 含字面量 \\n')
else pass('calendar-stats.wxss 换行正常')
if (!csWxss.includes('.calendar-stats-section')) fail('wxss 缺主样式')
else pass('calendar-stats.wxss 含主样式')

// page should not still have old stats blocks
if (indexWxml.includes('stats-highlight-card') && !csWxml.includes('stats-highlight-card')) {
  // page might still reference - check
}
if (indexWxml.match(/class="calendar-stats-section"/)) fail('index.wxml 仍有内联 calendar-stats-section')
else pass('页面已移除内联统计区块')

// day missions still on page (uses template)
if (!indexWxml.includes('calendar-day-missions')) fail('日任务列表丢失')
else pass('日任务列表仍在页面（依赖 missionCard 模板）')

// ── 6. landing-icons ──
const li = require('../utils/landing-icons.js')
const bolz = li.buildLandingIcon('BO_LZ', 'neutral')
const net = li.buildLandingIcon('NET_CATCH', 'success')
if (!bolz || !bolz.startsWith('data:image/svg')) fail('BO_LZ 生成失败')
else if (!li.isBoLzIconSrc(bolz)) fail('isBoLzIconSrc 认不出新 BO_LZ')
else pass('BO_LZ dataURI + isBoLzIconSrc OK')
if (!net || !net.includes('h20v2')) fail('NET_CATCH 精简模板异常')
else pass('NET_CATCH dataURI OK')

// TEMPLATES syntax
try {
  require('../utils/landing-icons.js')
  pass('landing-icons 可 require')
} catch (e) {
  fail('landing-icons require 失败: ' + e.message)
}

// ── 7. index.wxss 完整性 ──
const wxss = fs.readFileSync('pages/index/index.wxss', 'utf8')
if (wxss.includes('\\n.countdown') || /\\n\/\*/.test(wxss)) fail('index.wxss 仍有字面量 \\n 损坏')
else pass('index.wxss 无字面量 \\n 损坏')
if (!wxss.includes('倒计时卡片底部操作栏')) fail('index.wxss 丢失倒计时操作栏样式')
else pass('倒计时操作栏样式仍在')
if (!wxss.includes('calendar-day-missions')) fail('日任务样式丢失')
else pass('日任务样式仍在页面')
if (wxss.includes('日历内全球发射数据')) fail('全球统计样式应已迁出')
else pass('全球统计样式已迁出主包')

// keyframes in component
const calWxss = fs.readFileSync('subpackages/index-extra/components/launch-calendar/index.wxss', 'utf8')
if (!calWxss.includes('@keyframes starshipTextBlink')) fail('日历组件缺 starshipTextBlink keyframes')
else pass('日历组件含 starship keyframes')

console.log('\n==== 汇总 ====')
console.log('通过', ok.length, '失败', issues.length)
if (issues.length) {
  console.log('失败项:')
  issues.forEach((i) => console.log(' -', i))
  process.exit(1)
}
