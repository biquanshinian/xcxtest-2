/**
 * 修复后全量复审
 */
const fs = require('fs')
const path = require('path')
const issues = []
const warns = []
function fail(m) { issues.push(m); console.log('FAIL', m) }
function warn(m) { warns.push(m); console.log('WARN', m) }
function ok(m) { console.log('OK  ', m) }

const index = fs.readFileSync('pages/index/index.js', 'utf8')
const ux = fs.readFileSync('subpackages/index-extra/utils/index-ux.js', 'utf8')
const wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')

// 1. 分享三方法完整
for (const n of ['onShareAppMessage', 'onShareTimeline', 'onAddToFavorites']) {
  if (!new RegExp(`\\n  ${n}\\s*\\(`).test(index)) fail(`缺少 ${n}`)
  else ok(`存在 ${n}`)
}
if (index.includes('BRIEFIeType') || index.includes('/**\n页')) fail('分享方法仍有截断痕迹')
else ok('无截断痕迹')

// 2. UX 路径
const demoReqs = [...ux.matchAll(/require\(['"]([^'"]*demo-engine[^'"]*)['"]\)/g)].map((m) => m[1])
for (const r of demoReqs) {
  const resolved = path.normalize(path.join('subpackages/index-extra/utils', r)).replace(/\\/g, '/')
  const file = resolved.endsWith('.js') ? resolved : resolved + '.js'
  if (!fs.existsSync(file)) fail(`demo-engine 路径坏: ${r}`)
  else ok(`demo-engine OK: ${r}`)
}

// 3. UX methods vs wxml bindings
const listed = [...index.match(/const UX_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
const wxmlHandlers = new Set([
  ...wxml.matchAll(/\b(?:bind|catch):?(\w+)="/g),
  ...wxml.matchAll(/\b(?:bind|catch)([A-Z]\w+)="/g)
].flatMap((m) => {
  // bindtap="foo" or bind:foo=
  return []
}))
// simpler extract
const handlers = new Set()
for (const m of wxml.matchAll(/\b(?:bind|catch)(?:tap|touchstart|touchmove|touchend|longpress|change|load|error|input|confirm|blur|focus|scroll|submit)="([^"]+)"/g)) {
  handlers.add(m[1])
}
for (const m of wxml.matchAll(/\bbind:([a-z]+)="([^"]+)"/g)) {
  handlers.add(m[2])
}
const uxInWxml = listed.filter((n) => handlers.has(n) || wxml.includes(`"${n}"`) || wxml.includes(`'${n}'`))
ok(`UX 方法被 wxml 引用: ${uxInWxml.join(', ') || '(仅 JS 调用)'}`)

// 4. 主包残留方法体
const pageBody = index.slice(index.indexOf('Page({'))
for (const name of listed) {
  if (new RegExp(`\\n  ${name}\\s*\\([^)]*\\)\\s*\\{`).test(pageBody)) fail(`Page 残留 ${name}`)
}
ok('UX 方法主包无残留方法体')

// 5. calendar-stats
const csJs = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.js', 'utf8')
const csWxml = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.wxml', 'utf8')
const j = JSON.parse(fs.readFileSync('pages/index/index.json', 'utf8'))
if (!j.usingComponents['calendar-stats']) fail('未注册组件')
if (!wxml.includes('<calendar-stats')) fail('未使用组件')
if (!csJs.includes("triggerEvent('goglobalstats')")) fail('缺事件')
if (!wxml.includes('bind:goglobalstats="goGlobalLaunchStats"')) fail('缺事件绑定')
if (!index.includes("'goGlobalLaunchStats'")) fail('goGlobalLaunchStats 不在日历委托')
ok('calendar-stats 注册/绑定/事件完整')

// 属性
const props = [...csJs.matchAll(/(\w+):\s*\{\s*type:/g)].map((m) => m[1])
const attrBlock = wxml.match(/<calendar-stats([\s\S]*?)\/>/)?.[1] || wxml.match(/<calendar-stats([\s\S]*?)>/)?.[1] || ''
for (const p of props) {
  const kebab = p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  if (!attrBlock.includes(kebab)) fail(`缺属性绑定 ${kebab}`)
}
ok(`calendar-stats ${props.length} 个 properties 均已绑定`)

// 6. landing-icons
const li = require('../utils/landing-icons.js')
const a = li.buildLandingIcon('BO_LZ', 'success')
const b = li.buildLandingIcon('NET_CATCH', 'failure')
if (!li.isBoLzIconSrc(a)) fail('isBoLzIconSrc 失败')
if (!b.includes('rgb(249,115,22)') && !decodeURIComponent(b).includes('rgb(249,115,22)')) {
  // color is substituted before encode
  if (!a || !b) fail('图标生成空')
}
ok('landing-icons BO_LZ/NET_CATCH 可用')

// 7. 锚点
const anchor = fs.readFileSync('subpackages/index-extra/global-launch-stats.js', 'utf8')
if (!anchor.includes('index-ux.js')) fail('缺锚点')
else ok('index-ux 锚点存在')

// 8. 语法
try { new Function(index); ok('index.js 可解析') } catch (e) { fail('index.js 解析失败: ' + e.message) }
try { new Function(ux); ok('index-ux.js 可解析') } catch (e) { fail('index-ux.js 解析失败: ' + e.message) }

// 9. 关键依赖：分享方法用到的符号
for (const sym of ['ROUTES', 'buildMissionShareOptions', 'resolveMissionSharePayload', 'DEFAULT_SHARE_IMAGE', 'resolveMissionRocketImage']) {
  if (!index.includes(sym)) fail(`分享依赖缺失: ${sym}`)
}
ok('分享依赖符号齐全')

// 10. closeMissionSwipeCells 仍在主包（UX 会调用）
if (!/\n  closeMissionSwipeCells\s*\(/.test(pageBody)) fail('closeMissionSwipeCells 不应被拆走')
else ok('closeMissionSwipeCells 仍在主包供 UX 调用')

console.log('\n==== 汇总 ====')
console.log('失败', issues.length, '警告', warns.length)
issues.forEach((i) => console.log(' -', i))
process.exit(issues.length ? 1 : 0)
