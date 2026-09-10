/**
 * 首页悬浮菜单胶囊：实色底 + 运行时不抛 JS
 * 运行：node scripts/_tmp_audit_nasa_float_capsules.js
 * 脚本自身吞掉未捕获异常，只以 [FAIL] 计数退出。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let fail = 0
let okN = 0

function ok(m) { okN++; console.log('  [ok]', m) }
function bad(m) { fail++; console.log('  [FAIL]', m) }

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/') }

function exists(relPath) {
  try { return fs.existsSync(path.join(ROOT, relPath)) } catch (e) { return false }
}

function read(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n')
  } catch (e) {
    return null
  }
}

function stripComments(src, kind) {
  if (!src) return ''
  if (kind === 'wxss' || kind === 'js') return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (kind === 'wxml') return src.replace(/<!--[\s\S]*?-->/g, '')
  return src
}

function braceBalance(src) {
  const s = String(src || '').replace(/\/\*[\s\S]*?\*\//g, '')
  return (s.match(/{/g) || []).length - (s.match(/}/g) || []).length
}

function has(src, pattern, flags) {
  try {
    return new RegExp(pattern, flags || '').test(src || '')
  } catch (e) {
    return false
  }
}

function checkSyntax(relPath) {
  const abs = path.join(ROOT, relPath)
  if (!exists(relPath)) { bad('缺文件 ' + relPath); return }
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' })
    ok('语法 ' + relPath)
  } catch (e) {
    const msg = e && e.stderr ? String(e.stderr).split('\n')[0] : (e && e.message) || 'check failed'
    bad('语法 ' + relPath + ': ' + msg)
  }
}

function resolveRequire(fromRel, spec) {
  if (!spec || spec[0] !== '.') return true
  const fromDir = path.dirname(path.join(ROOT, fromRel))
  let target = path.resolve(fromDir, spec)
  if (!/\.(js|json)$/.test(target)) target += '.js'
  return fs.existsSync(target)
}

function main() {
  const files = {
    js: 'subpackages/shared/components/nasa-float/index.js',
    wxml: 'subpackages/shared/components/nasa-float/index.wxml',
    wxss: 'subpackages/shared/components/nasa-float/index.wxss',
    json: 'subpackages/shared/components/nasa-float/index.json',
    scroll: 'utils/nasa-float-scroll.js',
    tokens: 'styles/tokens.wxss',
    appWxss: 'app.wxss',
    routes: 'utils/routes.js'
  }

  console.log('== 文件 ==')
  Object.keys(files).forEach((k) => {
    exists(files[k]) ? ok(files[k]) : bad('缺 ' + files[k])
  })

  console.log('== JS 语法（不执行）==')
  ;[
    files.js,
    files.scroll,
    'pages/index/index.js',
    'pages/monitor/monitor.js',
    'pages/progress/progress.js',
    'pages/news/news.js',
    'pages/profile/profile.js',
    'pages/collect/collect.js'
  ].forEach(checkSyntax)

  const js = read(files.js) || ''
  const wxml = read(files.wxml) || ''
  const wxss = read(files.wxss) || ''
  const json = read(files.json) || ''
  const tokens = read(files.tokens) || ''
  const appWxss = read(files.appWxss) || ''
  const routes = read(files.routes) || ''
  const scroll = read(files.scroll) || ''

  console.log('== require 路径 ==')
  const reqSpecs = []
  stripComments(js, 'js').replace(/require\(\s*['"]([^'"]+)['"]\s*\)/g, (_, spec) => {
    reqSpecs.push(spec)
    return _
  })
  if (!reqSpecs.length) bad('nasa-float 无 require')
  reqSpecs.forEach((spec) => {
    if (spec[0] !== '.') { ok('绝对/包名 ' + spec); return }
    resolveRequire(files.js, spec) ? ok('require ' + spec) : bad('断链 ' + spec)
  })
  const lazyReq = js.match(/require\('(\.\.\/\.\.\/\.\.\/\.\.\/utils\/config\.js)'\)/)
  if (lazyReq) {
    resolveRequire(files.js, lazyReq[1]) ? ok('lazy require config.js') : bad('lazy require config.js 断链')
  } else {
    ok('lunar 云函数 config 为运行时 require（有则校验）')
  }

  console.log('== JSON / WXML 事件 ==')
  try {
    const parsed = JSON.parse(json)
    parsed && parsed.component ? ok('index.json component: true') : bad('index.json 非组件')
  } catch (e) {
    bad('index.json 无法解析: ' + (e && e.message))
  }

  const wxmlHandlers = []
  stripComments(wxml, 'wxml').replace(/\b(?:bind|catch):?(\w+)=["'](\w+)["']/g, (_, _ev, name) => {
    wxmlHandlers.push(name)
    return _
  })
  const uniqueHandlers = Array.from(new Set(wxmlHandlers))
  uniqueHandlers.forEach((name) => {
    const re = new RegExp('\\b' + name + '\\s*\\(')
    js.match(re) ? ok('handler ' + name) : bad('WXML 绑定 ' + name + ' 在 JS 中不存在')
  })
  ;['onMaskTap', 'onMenuTap', 'onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel'].forEach((name) => {
    uniqueHandlers.indexOf(name) >= 0 ? ok('WXML 有 ' + name) : bad('WXML 缺 ' + name)
  })

  console.log('== 胶囊实色（不被视频底玻璃化）==')
  const itemBlock = (stripComments(wxss, 'wxss').match(/\.float-menu-item\s*\{[\s\S]*?\n\}/) || [''])[0]
  if (!itemBlock) bad('找不到 .float-menu-item 块')
  else {
    has(itemBlock, 'var\\(--color-bg-card') ? bad('胶囊仍用 --color-bg-card（会被 tab-bg-video-host 打成玻璃）') : ok('胶囊不用 --color-bg-card')
    has(itemBlock, 'background:\\s*var\\(--color-bg') ? ok('胶囊 background 用 --color-bg') : bad('胶囊未用 --color-bg 实色')
    has(itemBlock, 'var\\(--color-bg,\\s*#') ? ok('--color-bg 有色值兜底') : bad('--color-bg 缺兜底')
    has(stripComments(wxss, 'wxss'), 'linear-gradient\\s*\\(\\s*var\\(\\s*--[\\w-]+\\s*,\\s*rgba\\(')
      ? bad('WXSS 有 linear-gradient(var(--x, rgba()))，真机可能按逗号拆参')
      : ok('无 linear-gradient + rgba 兜底逗号陷阱')
  }
  has(appWxss, 'tab-bg-video-host[\\s\\S]{0,280}--color-bg\\s*:')
    ? bad('tab-bg-video-host 改写了 --color-bg，胶囊又会变透明')
    : ok('tab-bg-video-host 未改写 --color-bg')
  has(appWxss, '--color-bg-card:\\s*rgba\\(0,\\s*0,\\s*0,\\s*0\\.28\\)')
    ? ok('视频底仍只玻璃化 --color-bg-card（卡片层）')
    : bad('未找到视频底 --color-bg-card 玻璃覆盖，回归风险')
  has(tokens, '--color-bg:\\s*#0B0C0E') && has(tokens, '--color-bg:\\s*#F4F5F7')
    ? ok('tokens 深浅 --color-bg 均为实色')
    : bad('tokens --color-bg 深浅实色缺失')

  console.log('== WXSS / WXML 结构 ==')
  braceBalance(wxss) === 0 ? ok('wxss 花括号配平') : bad('wxss 花括号不配平: ' + braceBalance(wxss))
  const wxssNoComment = stripComments(wxss, 'wxss')
  ;['--color-bg', '--color-border-glass', '--color-brand-soft'].forEach((v) => {
    const re = new RegExp('var\\(\\s*' + v.replace(/-/g, '\\-') + '\\s*\\)')
    const inItem = re.test(itemBlock || '')
    const inMenuWxss = re.test(wxssNoComment)
    if (inItem) bad(v + ' 胶囊使用处缺兜底')
    else if (inMenuWxss && v === '--color-border-glass') bad(v + ' 使用处缺兜底')
    else ok(v + ' 无无兜底用法')
  })

  const srcWxml = stripComments(wxml, 'wxml').replace(/<wxs\b[\s\S]*?<\/wxs>/g, '')
  const VOID = { input: 1, import: 1, include: 1, image: 0 }
  const stack = []
  let wxmlBad = ''
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let tm
  while ((tm = tagRe.exec(srcWxml))) {
    const tag = tm[1]
    const whole = tm[0]
    if (whole.indexOf('</') === 0) {
      if (!stack.length || stack[stack.length - 1] !== tag) {
        wxmlBad = '闭合 </' + tag + '> 与栈顶 ' + (stack[stack.length - 1] || '空') + ' 不匹配'
        break
      }
      stack.pop()
    } else if (whole.slice(-2) !== '/>' && !VOID[tag]) {
      stack.push(tag)
    }
  }
  if (!wxmlBad && stack.length) wxmlBad = '未闭合: ' + stack.join(',')
  wxmlBad ? bad('WXML ' + wxmlBad) : ok('WXML 标签配对')

  console.log('== 菜单资源 / 路由 ==')
  const images = [
    '/subpackages/shared/images/icons/nasa-logo.png',
    '/subpackages/shared/images/icons/moon-crescent.svg',
    '/subpackages/shared/images/icons/ic-telescope.svg',
    '/subpackages/shared/images/icons/ic-exoplanet.svg',
    '/images/tabbar/home-fab.svg'
  ]
  images.forEach((p) => {
    exists(p.replace(/^\//, '')) ? ok(p) : bad('缺图 ' + p)
  })
  const routeKeys = ['NASA_DATA', 'LUNAR_WISHES', 'ASTRO_CALENDAR', 'EXOPLANET', 'AI_CHAT']
  routeKeys.forEach((k) => {
    const m = routes.match(new RegExp(k + ':\\s*[\'"]([^\'"]+)[\'"]'))
    if (!m) { bad('routes 缺 ' + k); return }
    const page = m[1].replace(/^\//, '')
    exists(page + '.js') || exists(page + '.wxml')
      ? ok(k + ' → ' + m[1])
      : bad(k + ' 目标页不存在 ' + m[1])
  })
  ;['nasa', 'lunar', 'astro', 'exoplanet', 'aichat'].forEach((k) => {
    js.indexOf("key === '" + k + "'") >= 0 || js.indexOf('key === "' + k + '"') >= 0
      ? ok('onMenuTap 分支 ' + k)
      : bad('onMenuTap 缺分支 ' + k)
  })

  console.log('== 挂载页 ==')
  const hosts = [
    'pages/index/index',
    'pages/monitor/monitor',
    'pages/progress/progress',
    'pages/news/news',
    'pages/profile/profile',
    'pages/collect/collect'
  ]
  hosts.forEach((p) => {
    const j = read(p + '.json') || ''
    const x = read(p + '.wxml') || ''
    const jsSrc = read(p + '.js') || ''
    has(j, 'nasa-float') ? ok(p + '.json 注册') : bad(p + '.json 未注册 nasa-float')
    has(x, 'id="nasaFloat"') ? ok(p + '.wxml #nasaFloat') : bad(p + '.wxml 缺 #nasaFloat')
    if (p === 'pages/collect/collect') {
      ok(p + ' 非 Tab，可不 pulse')
      return
    }
    has(jsSrc, 'pulseNasaFloatOnScroll') ? ok(p + ' 滚动收起') : bad(p + ' 未接 pulseNasaFloatOnScroll')
  })
  has(scroll, 'pulseScrollHide') && has(scroll, "selectComponent\\('#nasaFloat'\\)")
    ? ok('nasa-float-scroll 容错调用')
    : bad('nasa-float-scroll 缺失')

  console.log('== 运行时不抛 JS ==')
  has(js, 'e && e\\.touches && e\\.touches\\[0\\]') ? ok('touch 空数组保护') : bad('touch 未保护空 touches')
  has(js, '_startX == null') ? ok('move 前确认 startX') : bad('touchmove 可能用未初始化 startX')
  has(js, 'if \\(this\\._detached\\) return') ? ok('卸载后不再 setData') : bad('缺 _detached 短路')
  has(js, '\\.catch\\(\\(\\) => \\{\\}\\)') ? ok('Promise.all 有 catch') : bad('菜单开关 Promise 可能未捕获')
  has(js, 'dataset && e\\.currentTarget\\.dataset\\.key') ? ok('onMenuTap key 空值保护') : bad('onMenuTap 未保护 dataset.key')
  has(js, 'if \\(this\\._detached \\|\\| !key\\) return') ? ok('_setDot 拒绝空 key / 已卸载') : bad('_setDot 未保护')
  has(js, 'catch\\s*\\{') ? bad('无参 catch { 旧 JSCore 会语法错误') : ok('无无参 catch')
  has(js, '\\(\\?<[=!]') ? bad('正则后行断言，iOS 会语法错误') : ok('无正则后行断言')
  has(js, '\\.\\?') ? bad('可选链 ?. 旧基础库可能语法错误') : ok('无可选链')
  has(js, '\\?\\?') ? bad('空值合并 ?? 旧基础库可能语法错误') : ok('无空值合并')
  has(js, 'wx\\.vibrateShort[\\s\\S]{0,80}catch') || has(js, 'try\\s*\\{[\\s\\S]{0,80}wx\\.vibrateShort')
    ? ok('vibrateShort 有 try')
    : bad('vibrateShort 无 try')

  console.log('\n' + (fail ? ('共 ' + fail + ' 个问题，通过 ' + okN) : ('全部通过 ✔  ' + okN + ' 项')))
  return fail
}

let code = 1
try {
  code = main() ? 1 : 0
} catch (e) {
  console.log('  [FAIL] 审计脚本自身异常: ' + ((e && e.message) || e))
  code = 1
}
process.exit(code)
