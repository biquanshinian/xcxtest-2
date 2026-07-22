// 一次性综合审计：index.js 拆分后全链路
const fs = require('fs')
const path = require('path')

const PAGE = 'pages/index/index.js'
const MODS = [
  'subpackages/index-extra/utils/index-calendar-page.js',
  'subpackages/index-extra/utils/index-vote.js',
  'subpackages/index-extra/utils/index-save-image.js',
  'subpackages/index-extra/utils/index-carousel.js',
  'subpackages/index-extra/utils/index-splash.js',
  'subpackages/index-extra/utils/index-live-settle.js'
]

const main = fs.readFileSync(PAGE, 'utf8')

function pageMethods(src) {
  const set = new Set()
  let m
  const re = /^  (?:async )?([a-zA-Z_$][\w$]*)\((?:[^)]*)\)\s*\{/gm
  while ((m = re.exec(src))) set.add(m[1])
  return set
}
function thisCalls(src) {
  const set = new Set()
  let m
  const re = /this\.([a-zA-Z_$][\w$]*)\(/g
  while ((m = re.exec(src))) set.add(m[1])
  return set
}
const BUILTIN = new Set(['setData', 'triggerEvent', 'createSelectorQuery', 'createIntersectionObserver', 'animate', 'selectComponent', 'getOpenerEventChannel', 'getTabBar', 'groupSetData'])

const mainMethods = pageMethods(main)
const delegated = new Set()
let dm
const delRe = /_METHODS\s*=\s*\[([\s\S]*?)\]/g
while ((dm = delRe.exec(main))) {
  let s2
  const strRe = /'([^']+)'/g
  while ((s2 = strRe.exec(dm[1]))) delegated.add(s2[1])
}

console.log('== A) 委托/实现冲突 与 this 调用落点 ==')
let issues = 0
const allModMethods = new Set()
for (const mf of MODS) {
  const mod = fs.readFileSync(mf, 'utf8')
  const modMethods = pageMethods(mod)
  modMethods.forEach((n) => allModMethods.add(n))
  for (const n of modMethods) {
    if (mainMethods.has(n) && n !== 'scheduleUpcomingAgencyChipsOverflowHint' && n !== 'updateUpcomingAgencyChipsOverflowHint') {
      console.log('  [冲突]', n, '@', path.basename(mf)); issues++
    }
  }
  for (const n of thisCalls(mod)) {
    if (!modMethods.has(n) && !mainMethods.has(n) && !delegated.has(n) && !BUILTIN.has(n) && !allModMethods.has(n)) {
      console.log('  [缺失] 模块调用无落点:', n, '@', path.basename(mf)); issues++
    }
  }
}
for (const n of delegated) {
  if (!allModMethods.has(n)) { console.log('  [缺失] 委托名单无实现:', n); issues++ }
}
for (const n of thisCalls(main)) {
  if (!mainMethods.has(n) && !delegated.has(n) && !BUILTIN.has(n)) {
    console.log('  [缺失] 主包调用无落点:', n); issues++
  }
}
if (!issues) console.log('  OK')

console.log('== B) 主包对委托方法的同步返回值依赖 ==')
issues = 0
const mainLines = main.split('\n')
for (const name of delegated) {
  const esc = name.replace(/\$/g, '\\$')
  const patterns = [
    new RegExp('(?:const|let|var)\\s+[\\w{},\\s]+=\\s*this\\.' + esc + '\\('),
    new RegExp('(?:if|while)\\s*\\(\\s*!?this\\.' + esc + '\\('),
    new RegExp('this\\.' + esc + '\\([^)]*\\)\\s*\\.(?!then|catch|finally)'),
    new RegExp('[+\\-*/<>=?:]\\s*this\\.' + esc + '\\(')
  ]
  mainLines.forEach((line, i) => {
    if (line.includes('await this.' + name + '(')) return
    if (new RegExp("'" + esc + "'").test(line)) return // 名单声明行
    for (const p of patterns) {
      if (p.test(line)) { console.log('  [同步!!] L' + (i + 1), name, '|', line.trim().slice(0, 110)); issues++; break }
    }
  })
}
if (!issues) console.log('  OK')

console.log('== C) 分包模块加载冒烟 ==')
global.wx = new Proxy({}, { get: () => () => ({}) })
global.getApp = () => ({ globalData: {} })
global.getCurrentPages = () => []
global.Page = () => {}
global.Component = () => {}
// require.async stub（channels-live 跨分包懒加载在模块顶层不执行，仅保险）
require.async = (p) => Promise.resolve(require(p))
for (const m of MODS) {
  try {
    delete require.cache[require.resolve(path.resolve(m))]
    const mod = require(path.resolve(m))
    const n = mod.methods ? Object.keys(mod.methods).length : '(attachTo式)'
    console.log('  OK', path.basename(m), '| methods:', n)
  } catch (e) {
    console.log('  [失败]', m, '=>', e.message)
  }
}

console.log('== D) wxml 事件绑定落点 ==')
const wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
const handlers = new Set()
let hm
const hre = /(?:bind|catch|mut-bind|capture-bind|capture-catch)[:]?[a-zA-Z]+="([a-zA-Z_$][\w$]*)"/g
while ((hm = hre.exec(wxml))) handlers.add(hm[1])
issues = 0
for (const h of handlers) {
  if (!mainMethods.has(h) && !delegated.has(h)) { console.log('  [缺失]', h); issues++ }
}
if (!issues) console.log('  OK (' + handlers.size + ' handlers)')

console.log('== E) 新模块 setData 键在主包 data 中的初始值 ==')
const liveSettle = fs.readFileSync('subpackages/index-extra/utils/index-live-settle.js', 'utf8')
const dataM = main.match(/\n  data:\s*\{([\s\S]*?)\n  \},/)
const dataKeys = new Set()
let km
const kre = /^\s{4}(?:'([^']+)'|([a-zA-Z_$][\w$]*))\s*:/gm
while ((km = kre.exec(dataM[1]))) dataKeys.add((km[1] || km[2]).split(/[.[]/)[0])
const sdKeys = new Set()
let sm
const sre = /setData\(\s*\{([\s\S]*?)\}\s*[,)]/g
while ((sm = sre.exec(liveSettle))) {
  let mm
  const k2 = /^\s*(?:'([^']+)'|([a-zA-Z_$][\w$]*))\s*:/gm
  while ((mm = k2.exec(sm[1]))) sdKeys.add((mm[1] || mm[2]).split(/[.[]/)[0])
}
const missing = [...sdKeys].filter((k) => !dataKeys.has(k))
console.log(missing.length ? '  [data未初始化] ' + missing.join(', ') : '  OK')

console.log('== F) 主包中已移除 31 个方法且模块恰好 31 个 ==')
const LIVE = main.match(/LIVE_SETTLE_METHODS\s*=\s*\[([\s\S]*?)\]/)
const names = []
let nm
const nre = /'([^']+)'/g
while ((nm = nre.exec(LIVE[1]))) names.push(nm[1])
let bad = 0
for (const n of names) {
  if (mainMethods.has(n)) { console.log('  [仍在主包]', n); bad++ }
}
const lsMethods = pageMethods(liveSettle)
for (const n of names) {
  if (!lsMethods.has(n)) { console.log('  [模块缺失]', n); bad++ }
}
console.log(bad ? '' : '  OK (' + names.length + ' 个)')
