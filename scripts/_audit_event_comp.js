// event-updates 组件化一致性审计
const fs = require('fs')
let fail = 0
const ok = (m) => console.log('[ok]', m)
const bad = (m) => { fail++; console.log('[FAIL]', m) }

const cw = fs.readFileSync('subpackages/progress-extra/components/event-updates/index.wxml', 'utf8')
const cj = fs.readFileSync('subpackages/progress-extra/components/event-updates/index.js', 'utf8')
const css = fs.readFileSync('subpackages/progress-extra/components/event-updates/index.wxss', 'utf8')
const pw = fs.readFileSync('pages/progress/progress.wxml', 'utf8')
const pj = fs.readFileSync('pages/progress/progress.js', 'utf8')
const pcss = fs.readFileSync('pages/progress/progress.wxss', 'utf8')
const pjson = JSON.parse(fs.readFileSync('pages/progress/progress.json', 'utf8'))
const lazy = fs.readFileSync('subpackages/progress-extra/utils/progress-lazy.js', 'utf8')

// 1. 组件 wxml 的 handler 都有对应方法
const handlers = [...new Set([...cw.matchAll(/(?:bind|catch)[a-z:]*="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))]
const missing = handlers.filter((h) => !cj.includes(h + '(e)') && !cj.includes(h + '()'))
missing.length ? bad('组件 handler 缺失: ' + missing.join(',')) : ok('组件 wxml handler 全部有实现 (' + handlers.length + ' 个)')

// 2. 组件 wxml 引用的数据字段都有 property（剔除 wx:for item/index 局部变量与字符串字面量）
let exprText = [...cw.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].replace(/'[^']*'/g, '')).join(' ')
// 去掉属性访问（.foo）后再提取根标识符
exprText = exprText.replace(/\.[A-Za-z_$][\w$]*/g, '')
const refs = [...new Set([...exprText.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))]
const locals = ['item', 'index', 'media', 'mIdx', 'true', 'false', 'null', 'length']
const props = [...cj.matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*\{/gm)].map((m) => m[1])
const unknown = refs.filter((r) => locals.indexOf(r) < 0 && props.indexOf(r) < 0)
unknown.length ? bad('组件引用无 property: ' + unknown.join(',')) : ok('组件数据引用全部有 property 支撑 (' + props.length + ' 个)')

// 3. 页面组件标签属性与 property 对齐（kebab→camel）
const tag = pw.match(/<event-updates[\s\S]*?\/>/)
if (!tag) bad('页面缺少 <event-updates> 标签')
else {
  const attrs = [...tag[0].matchAll(/\s([a-z][a-z0-9-]*)="/g)].map((m) => m[1]).filter((a) => a !== 'id' && !a.startsWith('bind'))
  const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
  const extra = attrs.filter((a) => props.indexOf(camel(a)) < 0)
  extra.length ? bad('页面传入未知属性: ' + extra.join(',')) : ok('页面标签属性与组件 property 对齐 (' + attrs.length + ' 个)')
  // 4. 属性绑定的 data 字段在页面 data/setData 中存在
  const bound = [...tag[0].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  const missData = bound.filter((d) => !new RegExp(d + '\\s*[:\\]]').test(pj) && !lazy.includes(d))
  missData.length ? bad('页面 data 缺字段: ' + missData.join(',')) : ok('组件入参在页面 data/lazy 中都有来源 (' + bound.length + ' 个)')
}

// 5. sectionevent 白名单方法在页面可调（本页定义或 PROGRESS_LAZY_METHODS 委托）
const wl = pj.match(/PROGRESS_SECTION_EVENT_METHODS = \[([\s\S]*?)\]/)
const wlNames = [...wl[1].matchAll(/'([\w$]+)'/g)].map((m) => m[1])
const lazyNames = [...pj.match(/PROGRESS_LAZY_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'([\w$]+)'/g)].map((m) => m[1])
const unreachable = wlNames.filter((n) => lazyNames.indexOf(n) < 0 && !new RegExp('^  ' + n + '\\(', 'm').test(pj))
unreachable.length ? bad('白名单方法不可达: ' + unreachable.join(',')) : ok('sectionevent 白名单 ' + wlNames.length + ' 个方法全部可达')

// 6. 组件 emit 名与白名单一致
const emits = [...cj.matchAll(/_emit\('([\w$]+)'/g)].map((m) => m[1])
const emitsNotWl = emits.filter((n) => wlNames.indexOf(n) < 0)
emitsNotWl.length ? bad('组件 emit 不在白名单: ' + emitsNotWl.join(',')) : ok('组件 emit 与白名单一致 (' + emits.length + ' 个)')

// 7. 页面 wxml 不再残留事件区 class；组件 wxss keyframes 自洽
;['event-update-item', 'tweet-stats-scroll', 'event-media-list'].forEach((c) => {
  pw.includes(c) ? bad('页面 wxml 残留: ' + c) : null
})
ok('页面 wxml 无事件区残留')
const defs = (css.match(/@keyframes\s+([\w-]+)/g) || []).map((x) => x.replace('@keyframes', '').trim())
const uses = new Set()
;(css.match(/animation[^;:]*:\s*[^;]+;/g) || []).forEach((x) => {
  x.split(':').slice(1).join(':').split(',').forEach((p) => p.trim().split(/\s+/).forEach((t) => {
    if (/^[a-zA-Z][\w-]*$/.test(t) && !/^(ease|linear|infinite|both|forwards|backwards|alternate|normal|running|paused|none|reverse|steps|cubic-bezier)$/.test(t) && !/^ease-/.test(t)) uses.add(t)
  }))
})
const missAnim = [...uses].filter((u) => defs.indexOf(u) < 0)
missAnim.length ? bad('组件缺 keyframes: ' + missAnim.join(',')) : ok('组件 keyframes 自洽')

// 8. json 注册 + placeholder
pjson.usingComponents['event-updates'] && pjson.componentPlaceholder['event-updates'] ? ok('json 注册与 placeholder 就绪') : bad('json 配置缺失')

// 9. wxml 标签平衡（组件与页面）
function balance(src, name) {
  const open = (src.match(/<view\b/g) || []).length
  const close = (src.match(/<\/view>/g) || []).length
  const selfClose = (src.match(/<view\b[^>]*\/>/g) || []).length
  open - selfClose === close ? ok(name + ' view 标签平衡 (' + open + '/' + close + ')') : bad(name + ' view 标签不平衡: 开 ' + open + ' 自闭 ' + selfClose + ' 关 ' + close)
}
balance(cw, '组件 wxml')
balance(pw, '页面 wxml')

// 10. 页面 wxss 无事件区残留
;['.event-update', '.event-live', '.event-media', '.wx-native-dots'].forEach((c) => {
  pcss.includes(c) ? bad('页面 wxss 残留: ' + c) : null
})
ok('页面 wxss 无事件区残留')

console.log(fail ? '共 ' + fail + ' 项失败' : '\n全部通过')
process.exit(fail ? 1 : 0)
