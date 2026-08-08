/* 全量 UI 焕新审计：JS 语法 / WXSS 配平 / WXML 标签配对 / 未定义 var / 遗留类与色值 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', 'dist', '.git', 'miniprogram_npm', 'admin-web', 'cloudfunctions', 'terminals', '.cursor'])
function walk(d, exts, out) {
  for (const f of fs.readdirSync(d)) {
    if (SKIP.has(f)) continue
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => f.endsWith(e))) out.push(p)
  }
  return out
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
let problems = 0
const warn = (...a) => { problems++; console.log('[!]', ...a) }

/* ---- 1. 本轮改动的 JS 语法检查（git 变更 + 关键文件） ---- */
const changed = execSync('git status --porcelain', { encoding: 'utf8' })
  .split('\n').map((l) => l.slice(3).trim().replace(/\\/g, '/')).filter(Boolean)
const jsChanged = changed.filter((f) => f.endsWith('.js') && !f.startsWith('scripts/') && !f.startsWith('admin-web') && !f.startsWith('cloudfunctions') && fs.existsSync(f))
const jsKey = ['pages/monitor/monitor.js', 'subpackages/monitor-pages/utils/monitor-weather.js', 'subpackages/monitor-pages/agency-detail.js', 'custom-tab-bar/index.js', 'utils/layout.js', 'utils/agency-favorites.js', 'pages/search/search.js']
const jsAll = [...new Set([...jsChanged, ...jsKey])].filter((f) => fs.existsSync(f))
for (const f of jsAll) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }) } catch (e) { warn('JS 语法错误:', f, String(e.stderr || e.message).split('\n')[0]) }
}
console.log('JS checked:', jsAll.length)

/* ---- 2. 全部 WXSS 花括号配平 ---- */
const wxss = walk(ROOT, ['.wxss'], [])
for (const p of wxss) {
  const s = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const o = (s.match(/{/g) || []).length, c = (s.match(/}/g) || []).length
  if (o !== c) warn('WXSS 括号不配平:', rel(p), o, c)
}
console.log('WXSS checked:', wxss.length)

/* ---- 3. 全部 WXML 标签配对（逐标签栈匹配） ---- */
const VOID = new Set(['input', 'import', 'include'])
const wxml = walk(ROOT, ['.wxml'], [])
for (const p of wxml) {
  const src = fs.readFileSync(p, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<wxs\b[\s\S]*?<\/wxs>/g, '') // 内联 wxs 代码块整体剔除（内容是 JS，不能按标签解析）
    .replace(/<wxs\b[^>]*\/>/g, '')
  const re = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  const stack = []
  let m, bad = ''
  while ((m = re.exec(src))) {
    const tag = m[1], whole = m[0]
    if (whole.startsWith('</')) {
      if (!stack.length || stack[stack.length - 1] !== tag) { bad = `闭合 </${tag}> 与栈顶 ${stack[stack.length - 1] || '空'} 不匹配`; break }
      stack.pop()
    } else if (!whole.endsWith('/>') && !VOID.has(tag)) {
      stack.push(tag)
    }
  }
  if (!bad && stack.length) bad = `未闭合: ${stack.slice(-3).join(',')}`
  if (bad) warn('WXML 配对:', rel(p), bad)
}
console.log('WXML checked:', wxml.length)

/* ---- 4. 无兜底且未定义的 CSS 变量 ---- */
const tokenSrc = fs.readFileSync('styles/tokens.wxss', 'utf8')
const defined = new Set((tokenSrc.match(/--[\w-]+(?=\s*:)/g) || []))
for (const p of wxss) {
  const s = fs.readFileSync(p, 'utf8')
  const local = new Set((s.match(/--[\w-]+(?=\s*:)/g) || []))
  const re = /var\(\s*(--[\w-]+)\s*\)/g
  let m
  const seen = new Set()
  while ((m = re.exec(s))) {
    const v = m[1]
    if (!defined.has(v) && !local.has(v) && !seen.has(v)) { seen.add(v); warn('var 无兜底且 tokens 未定义:', rel(p), v) }
  }
}

/* ---- 5. 遗留旧类名 / 旧色值 ---- */
const legacyClass = ['fav-star', 'starbase-wx-time', 'starbase-weather-row--main', 'starbase-weather-row--sub', 'starbase-weather-place', 'starbase-wx-wind"']
for (const p of [...wxml, ...wxss]) {
  const s = fs.readFileSync(p, 'utf8')
  for (const c of legacyClass) if (s.includes(c)) warn('遗留旧类:', rel(p), c)
}
// 搜索页专项：旧类型色不应回流
const searchCss = fs.readFileSync('pages/search/search.wxss', 'utf8')
for (const c of ['FFD60A', 'BF5AF2', 'FF9F0A']) if (searchCss.includes(c)) warn('搜索页遗留旧色:', c)

/* ---- 6. 弹窗磨砂专项：--bg-glass-popup 使用处必须带兜底（组件可能脱离页面根） ---- */
for (const p of wxss) {
  const s = fs.readFileSync(p, 'utf8')
  const re = /var\(\s*--bg-glass-popup\s*\)/g
  if (re.test(s)) warn('bg-glass-popup 缺兜底:', rel(p))
}

/* ---- 7. 天气字段专项：timeShort 兜底链 ---- */
const mw = fs.readFileSync('subpackages/monitor-pages/utils/monitor-weather.js', 'utf8')
if (!mw.includes('timeShort')) warn('monitor-weather.js 缺 timeShort')
const mx = fs.readFileSync('pages/monitor/monitor.wxml', 'utf8')
if (!/timeShort \? /.test(mx)) warn('monitor.wxml timeShort 未做空值兜底')

/* ---- 8. app.json 可解析 + tabBar 页面存在 ---- */
try {
  const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
  for (const t of (app.tabBar && app.tabBar.list) || []) {
    if (!fs.existsSync(t.pagePath + '.wxml')) warn('tabBar 页面缺失:', t.pagePath)
  }
  for (const pg of app.pages || []) if (!fs.existsSync(pg + '.wxml')) warn('主包页面缺失:', pg)
} catch (e) { warn('app.json 解析失败:', e.message) }

console.log(problems ? `\n共 ${problems} 个问题` : '\n全部通过 ✔')
