// 本轮拆分全面审计：profile / progress 两侧的引用完整性、语法、导入齐备性
const fs = require('fs')
const vm = require('vm')
let fail = 0
function bad(msg) { fail++; console.log('  [FAIL] ' + msg) }
function ok(msg) { console.log('  [ok] ' + msg) }

// ── 0) 语法 ──
const files = [
  'pages/profile/profile.js',
  'pages/progress/progress.js',
  'subpackages/profile-extra/utils/profile-lazy.js',
  'subpackages/progress-extra/utils/progress-lazy.js',
  'subpackages/profile-extra/components/profile-sections/index.js'
]
console.log('== 语法检查 ==')
for (const f of files) {
  try { new vm.Script(fs.readFileSync(f, 'utf8')); ok(f) } catch (e) { bad(f + ': ' + e.message) }
}

function methodNames(src) {
  const names = new Set()
  const re = /^  (async )?([A-Za-z_$][\w$]*)\s*\(/gm
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return'])
  let m
  while ((m = re.exec(src))) { if (!keywords.has(m[2])) names.add(m[2]) }
  return names
}
function wxmlHandlers(src) {
  return [...new Set([...src.matchAll(/(?:bind|catch|mut-bind)[:\w-]*?="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))]
}
function importedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*require/g)) {
    m[1].split(',').forEach((x) => names.add(x.split(':').pop().trim()))
  }
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require/g)) names.add(m[1])
  return names
}
// 模块级标识符使用检查：imports + 顶层 const/function 至少被引用一次
function unusedImports(src) {
  const out = []
  for (const name of importedNames(src)) {
    const uses = (src.match(new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length
    if (uses < 2) out.push(name)
  }
  return out
}

// ── 1) profile 侧 ──
console.log('== profile ==')
const pj = fs.readFileSync('pages/profile/profile.js', 'utf8')
const plz = fs.readFileSync('subpackages/profile-extra/utils/profile-lazy.js', 'utf8')
const pw = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
const cw = fs.readFileSync('subpackages/profile-extra/components/profile-sections/index.wxml', 'utf8')
const cj = fs.readFileSync('subpackages/profile-extra/components/profile-sections/index.js', 'utf8')

const pMethods = methodNames(pj)
const pLazyList = [...pj.match(/PROFILE_LAZY_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'([\w$]+)'/g)].map((m) => m[1])
const pSecList = [...pj.match(/SECTION_EVENT_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'([\w$]+)'/g)].map((m) => m[1])
const pLazyMethods = methodNames(plz)

// 1a. 页面 wxml 处理器都可解析
const h1 = wxmlHandlers(pw).filter((h) => !pMethods.has(h) && !pLazyList.includes(h))
h1.length ? bad('profile.wxml 处理器缺失: ' + h1.join(',')) : ok('profile.wxml 处理器 ' + wxmlHandlers(pw).length + ' 个全部可解析')
// 1b. 委托方法都在 lazy 中
const miss1 = pLazyList.filter((n) => !pLazyMethods.has(n))
miss1.length ? bad('profile-lazy 缺失: ' + miss1.join(',')) : ok('PROFILE_LAZY_METHODS ' + pLazyList.length + ' 个全部在 lazy 定义')
// 1c. sectionevent 白名单都可解析（page 或委托）
const miss2 = pSecList.filter((n) => !pMethods.has(n) && !pLazyList.includes(n))
miss2.length ? bad('sectionevent 白名单缺失: ' + miss2.join(',')) : ok('SECTION_EVENT_METHODS ' + pSecList.length + ' 个全部可解析')
// 1d. 组件 wxml emit ↔ 组件 js handler ↔ 白名单
const emits = [...new Set([...cw.matchAll(/\b(emit[A-Za-z]+)/g)].map((m) => m[1]))]
const noH = emits.filter((e) => !cj.includes(e + '('))
noH.length ? bad('组件缺 handler: ' + noH.join(',')) : ok('组件 wxml ' + emits.length + ' 个 emit 均有 handler')
const emittedNames = [...cj.matchAll(/_emit\('(\w+)'/g)].map((m) => m[1])
const notWl = emittedNames.filter((n) => !pSecList.includes(n))
notWl.length ? bad('组件回传未在白名单: ' + notWl.join(',')) : ok('组件回传 name 全部在白名单')
// 1e. this.xxx( 调用闭包
const known1 = new Set([...pMethods, ...pLazyMethods, ...pLazyList, 'setData', 'getTabBar', 'createSelectorQuery', 'triggerEvent', 'selectComponent'])
const badCalls1 = [...new Set([...pj.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))].filter((c) => !known1.has(c))
badCalls1.length ? bad('profile.js 未知 this 调用: ' + badCalls1.join(',')) : ok('profile.js this 调用闭合')
const badCalls2 = [...new Set([...plz.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))].filter((c) => !known1.has(c))
badCalls2.length ? bad('profile-lazy 未知 this 调用: ' + badCalls2.join(',')) : ok('profile-lazy this 调用闭合')
// 1f. 未使用导入
const u1 = unusedImports(pj); u1.length ? bad('profile.js 疑似未用导入: ' + u1.join(',')) : ok('profile.js 导入均被使用')
const u2 = unusedImports(plz); u2.length ? bad('profile-lazy 疑似未用导入: ' + u2.join(',')) : ok('profile-lazy 导入均被使用')
// 1g. 组件 properties 与页面传值一致（kebab 属性 → camel）
const props = [...cj.matchAll(/^    (\w+):\s*\{/gm)].map((m) => m[1])
const tag = pw.match(/<profile-sections([\s\S]*?)\/>/)[1]
const passed = [...tag.matchAll(/(?:^|\s)([\w-]+)="/gm)].map((m) => m[1]).filter((a) => !a.startsWith('bind'))
const toCamel = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase())
const unknownProps = passed.map(toCamel).filter((p) => !props.includes(p))
unknownProps.length ? bad('页面传入组件未知属性: ' + unknownProps.join(',')) : ok('组件属性 ' + passed.length + ' 个全部匹配')
// 1h. 组件 wxml 中的数据引用都有 property 支撑（防止漏传）：先剥掉字符串字面量再提取标识符
const dataRefs = [...new Set([...cw.matchAll(/\{\{([^}]+)\}\}/g)].flatMap((m) => {
  const expr = m[1].replace(/'[^']*'/g, '')
  return [...expr.matchAll(/(?:^|[^.\w$])([a-zA-Z_$][\w$]*)/g)].map((x) => x[1])
}))]
const wxKeywords = new Set(['item', 'index', 'true', 'false', 'null', 'undefined', 'length'])
const unbacked = dataRefs.filter((r) => !wxKeywords.has(r) && !props.includes(r))
unbacked.length ? bad('组件 wxml 引用无 property 支撑: ' + unbacked.join(',')) : ok('组件 wxml 数据引用全部有 property')
// 1i. 页面 json 注册与占位
const pjson = JSON.parse(fs.readFileSync('pages/profile/profile.json', 'utf8'))
pjson.usingComponents['profile-sections'] && pjson.componentPlaceholder['profile-sections'] ? ok('profile.json 注册 + 占位符齐备') : bad('profile.json 组件注册不全')

// ── 2) progress 侧 ──
console.log('== progress ==')
const gj = fs.readFileSync('pages/progress/progress.js', 'utf8')
const glz = fs.readFileSync('subpackages/progress-extra/utils/progress-lazy.js', 'utf8')
const gw = fs.readFileSync('pages/progress/progress.wxml', 'utf8')
const gMethods = methodNames(gj)
const gLazyList = [...gj.match(/PROGRESS_LAZY_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'([\w$]+)'/g)].map((m) => m[1])
const gLazyMethods = methodNames(glz)

const h2 = wxmlHandlers(gw).filter((h) => !gMethods.has(h) && !gLazyList.includes(h))
h2.length ? bad('progress.wxml 处理器缺失: ' + h2.join(',')) : ok('progress.wxml 处理器 ' + wxmlHandlers(gw).length + ' 个全部可解析')
const miss3 = gLazyList.filter((n) => !gLazyMethods.has(n))
miss3.length ? bad('progress-lazy 缺失: ' + miss3.join(',')) : ok('PROGRESS_LAZY_METHODS ' + gLazyList.length + ' 个全部在 lazy 定义')
const known2 = new Set([...gMethods, ...gLazyMethods, ...gLazyList, 'setData', 'getTabBar', 'createSelectorQuery', 'triggerEvent', 'selectComponent', 'getOpenerEventChannel'])
const badCalls3 = [...new Set([...gj.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))].filter((c) => !known2.has(c))
badCalls3.length ? bad('progress.js 未知 this 调用: ' + badCalls3.join(',')) : ok('progress.js this 调用闭合')
const badCalls4 = [...new Set([...glz.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))].filter((c) => !known2.has(c))
badCalls4.length ? bad('progress-lazy 未知 this 调用: ' + badCalls4.join(',')) : ok('progress-lazy this 调用闭合')
const u3 = unusedImports(gj); u3.length ? bad('progress.js 疑似未用导入: ' + u3.join(',')) : ok('progress.js 导入均被使用')
const u4 = unusedImports(glz); u4.length ? bad('progress-lazy 疑似未用导入: ' + u4.join(',')) : ok('progress-lazy 导入均被使用')
// _eventCacheKey 属性仍在页面（lazy 方法经 this. 访问）
gj.includes("_eventCacheKey: '_event_updates_local_cache'") ? ok('_eventCacheKey/_eventCacheTTL 属性保留在页面') : bad('_eventCacheKey 属性丢失')
// stopPropagation 方法保留
const hasStopProp = /stopPropagation\s*\(\s*\)/.test(gj)
hasStopProp ? ok('stopPropagation 方法在页面') : bad('stopPropagation 方法缺失（wxml 有 ' + (gw.match(/stopPropagation/g) || []).length + ' 处引用）')
// lazy 中模块级函数使用的模块级标识符齐备（粗查：formatLl2AutoError / PROGRESS_LIVE_STATUS_DEFER_MS 定义存在）
glz.includes('function formatLl2AutoError') && glz.includes('PROGRESS_LIVE_STATUS_DEFER_MS = 600') ? ok('lazy 模块级依赖齐备') : bad('lazy 模块级依赖缺失')
// 与 profile 相同：页面委托与 lazy 方法名无重复定义
const dupG = [...gLazyMethods].filter((n) => gMethods.has(n))
dupG.length ? bad('页面与 lazy 重复定义: ' + dupG.join(',')) : ok('页面与 lazy 无重复方法定义')
const dupP = [...pLazyMethods].filter((n) => pMethods.has(n))
dupP.length ? bad('profile 页面与 lazy 重复定义: ' + dupP.join(',')) : ok('profile 页面与 lazy 无重复方法定义')

console.log(fail ? ('\n共 ' + fail + ' 项失败') : '\n全部通过')
process.exit(fail ? 1 : 0)
