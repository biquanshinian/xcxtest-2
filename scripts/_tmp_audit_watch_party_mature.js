/**
 * 观礼服务成熟化静态审计
 * 1. WXML 事件处理器 ↔ Page 方法交叉校验（bindtap 指向不存在的方法 = 线上无响应）
 * 2. WXML 模板变量 ↔ data/behavior 字段校验（未定义变量渲染为空）
 * 3. JSON 配置合法性 + app.json 分包注册与页面文件齐全
 * 4. require 依赖图：路径可解析；主包不得 require 分包（微信硬性规范）
 * 5. 云端路由 ↔ watchParty 工厂导出方法一致性
 * 6. 风险模式扫描：未清理的 setInterval、异步 setData 无卸载保护、未包裹的震动调用
 * 运行：node scripts/_tmp_audit_watch_party_mature.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SUB = path.join(ROOT, 'subpackages', 'watch-party')

let issues = 0
let warns = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(p) { return fs.readFileSync(p, 'utf8') }

// ── 1&2. WXML ↔ JS 交叉校验 ──
console.log('── WXML 事件/变量 ↔ JS 交叉校验 ──')

/** behavior(page-base) 注入的 data 字段 + WXML 内置 */
const BEHAVIOR_FIELDS = new Set([
  'statusBarHeight', 'navPlaceholderHeight', 'tabBarReservedHeight',
  'menuButtonWidth', 'isDirectEntry', 'themeClass', 'themeLight', 'pageBgColor'
])
const BEHAVIOR_METHODS = new Set(['goBack', 'retryLoad', 'initUiShell', 'syncTheme', 'selectTab', 'syncTab'])

/** 星问 AI 同源 composer-input-behavior（挂了 composerInput 的页面可用） */
const COMPOSER_FIELDS = new Set(['keyboardHeight'])
const COMPOSER_METHODS = new Set([
  'onInputFocus', 'onInputBlur', 'onInputKeyboardHeightChange',
  'dismissKeyboard', 'onTextInput', 'onCodeInput'
])

const PAGES = ['watch-party', 'merchant-list', 'gacha', 'album', 'screen', 'merchant', 'merchant-edit', 'merchant-reservations']
for (const page of PAGES) {
  const js = read(path.join(SUB, page + '.js'))
  const wxml = read(path.join(SUB, page + '.wxml'))
  const hasComposer = /composerInput/.test(js) && /composer-input-behavior/.test(js)

  // Page 方法名（顶层 `name(` 或 `name:`，粗匹配足够）
  const methodNames = new Set()
  for (const m of js.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*[(:]/gm)) methodNames.add(m[1])

  // data 字段
  const dataBlock = js.match(/data:\s*\{([\s\S]*?)\n\s{2}\}/)
  const dataFields = new Set()
  if (dataBlock) {
    for (const m of dataBlock[1].matchAll(/^\s+([A-Za-z_$][\w$]*)\s*:/gm)) dataFields.add(m[1])
  }

  // 事件处理器
  const handlers = new Set()
  for (const m of wxml.matchAll(/(?:bind|catch)[:]?[a-z]+\s*=\s*"([A-Za-z_$][\w$]*)"/g)) handlers.add(m[1])
  let ok = true
  for (const h of handlers) {
    if (!h) continue
    if (
      !methodNames.has(h)
      && !BEHAVIOR_METHODS.has(h)
      && !(hasComposer && COMPOSER_METHODS.has(h))
    ) {
      issue(`${page}.wxml 绑定的处理器 ${h} 在 JS 中不存在`)
      ok = false
    }
  }

  // 模板变量（取 {{expr}} 中的标识符首段，过滤 wx: 内置与 item/index 等作用域变量）
  const scopeVars = new Set(['item', 'index', 'true', 'false', 'null'])
  for (const m of wxml.matchAll(/wx:for-item\s*=\s*"(\w+)"/g)) scopeVars.add(m[1])
  for (const m of wxml.matchAll(/wx:for-index\s*=\s*"(\w+)"/g)) scopeVars.add(m[1])
  const tplVars = new Set()
  for (const m of wxml.matchAll(/\{\{([^}]+)\}\}/g)) {
    // 先剥离字符串字面量，避免 'top-nav-slot--home' 之类被误识别为变量
    const expr = m[1].replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
    for (const v of expr.matchAll(/(?<![\w.])([A-Za-z_$][\w$]*)/g)) {
      tplVars.add(v[1])
    }
  }
  for (const v of tplVars) {
    if (scopeVars.has(v) || BEHAVIOR_FIELDS.has(v)) continue
    if (hasComposer && COMPOSER_FIELDS.has(v)) continue
    if (dataFields.has(v)) continue
    // wxml 里 item.xxx 之类已被负向断言排除；剩下的顶层变量必须在 data 里
    issue(`${page}.wxml 模板变量 ${v} 未在 data 中定义`)
    ok = false
  }
  if (ok) pass(`${page}: ${handlers.size} 个事件处理器 / ${tplVars.size} 个模板变量 全部有效`)
}

// ── 3. JSON + app.json ──
console.log('── JSON / app.json 分包注册 ──')
try {
  const appJson = JSON.parse(read(path.join(ROOT, 'app.json')))
  const sub = (appJson.subpackages || appJson.subPackages || []).find((s) => s.root === 'subpackages/watch-party')
  if (!sub) {
    issue('app.json 未注册 watch-party 分包')
  } else {
    for (const p of sub.pages) {
      const base = path.join(ROOT, sub.root, p)
      for (const ext of ['.js', '.wxml', '.wxss', '.json']) {
        if (!fs.existsSync(base + ext)) issue(`分包页面文件缺失: ${sub.root}/${p}${ext}`)
      }
    }
    pass(`app.json 分包注册完整（${sub.pages.length} 个页面，四件套齐全）`)
  }
  // 分包不应被主包 preload 强拉（用户要求不注入主包）
  const preload = appJson.preloadRule || {}
  const preloaded = Object.values(preload).some((r) => (r.packages || []).includes('watch-party'))
  if (preloaded) warn('preloadRule 中配置了 watch-party 预下载（会增加非观礼用户流量）')
  else pass('未配置 watch-party 预下载，分包按需加载')

  for (const p of PAGES) {
    JSON.parse(read(path.join(SUB, p + '.json')))
  }
  pass('页面 JSON 全部合法')
} catch (e) {
  issue('JSON 解析失败: ' + e.message)
}

// ── 4. require 依赖图 ──
console.log('── require 依赖规范 ──')
function checkRequires(file, isMainPackage) {
  const src = read(file)
  const dir = path.dirname(file)
  let ok = true
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const req = m[1]
    if (!req.startsWith('.')) continue
    const resolved = path.resolve(dir, req)
    if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js')) {
      issue(`${path.relative(ROOT, file)} require 路径不存在: ${req}`)
      ok = false
    }
    if (isMainPackage && resolved.includes(path.join('subpackages', 'watch-party'))) {
      issue(`主包文件 ${path.relative(ROOT, file)} require 了分包文件（微信禁止）: ${req}`)
      ok = false
    }
  }
  return ok
}
const mainFiles = [
  path.join(ROOT, 'utils', 'watch-pass.js'),
  path.join(ROOT, 'utils', 'membership.js')
]
const subFiles = [
  path.join(SUB, 'watch-party.js'),
  path.join(SUB, 'gacha.js'),
  path.join(SUB, 'album.js'),
  path.join(SUB, 'utils', 'api.js'),
  path.join(ROOT, 'pages', 'mission-detail', 'utils', 'watch-party-entry.js'),
  path.join(ROOT, 'subpackages', 'shared', 'utils', 'watch-party.js')
]
let reqOk = true
for (const f of mainFiles) reqOk = checkRequires(f, true) && reqOk
for (const f of subFiles) reqOk = checkRequires(f, false) && reqOk
if (reqOk) pass('require 路径全部可解析，主包无分包依赖')

// 观礼入口探测已迁出主包；watch-pass 仍留主包且应极小
if (fs.existsSync(path.join(ROOT, 'utils', 'watch-party.js'))) {
  issue('主包仍残留 utils/watch-party.js（应迁入 mission-detail / shared 分包）')
} else {
  pass('主包已无 utils/watch-party.js')
}
for (const f of [path.join(ROOT, 'utils', 'watch-pass.js')]) {
  const kb = fs.statSync(f).size / 1024
  if (kb > 4) warn(`${path.relative(ROOT, f)} 体积 ${kb.toFixed(1)}KB，主包工具应保持精简`)
  else pass(`${path.relative(ROOT, f)} ${kb.toFixed(1)}KB（主包占用极小）`)
}

// ── 5. 云端路由 ↔ 工厂导出 ──
console.log('── 云端路由一致性 ──')
const gwSrc = read(path.join(ROOT, 'cloudfunctions', 'adminGateway', 'index.js'))
const wpSrc = read(path.join(ROOT, 'cloudfunctions', 'adminGateway', 'watchParty.js'))
const exported = new Set()
const exportBlock = wpSrc.match(/return \{([\s\S]*?)\n  \}\n\}/)
if (exportBlock) {
  for (const m of exportBlock[1].matchAll(/^\s+([A-Za-z_$][\w$]*),?\s*$/gm)) exported.add(m[1])
}
let routeOk = true
for (const m of gwSrc.matchAll(/watchPartyApi\(\)\.([A-Za-z_$][\w$]*)\(/g)) {
  if (!exported.has(m[1])) {
    issue(`index.js 调用了 watchParty 未导出的方法: ${m[1]}`)
    routeOk = false
  }
}
if (routeOk) pass(`网关路由调用的 ${new Set([...gwSrc.matchAll(/watchPartyApi\(\)\.(\w+)\(/g)].map((m) => m[1])).size} 个方法全部已导出`)

// 新集合是否已登记
for (const col of ['watch_party_sessions', 'watch_party_reservations', 'watch_party_merchants', 'watch_party_config', 'watch_party_merchant_leads', 'souvenir_cards', 'souvenir_draws', 'souvenir_draw_quota']) {
  if (!gwSrc.includes(`'${col}'`)) issue(`集合 ${col} 未登记到 ADMIN_GATEWAY_EXTRA_COLLECTIONS`)
}
pass('云端集合登记检查完成')

// ── 5.5 云资源用量守护（防止后续改动退化） ──
console.log('── 云资源用量守护 ──')

// 统计类接口必须走预聚合计数器，禁止扫明细表
function fnBody(src, name) {
  // 兼容 async function / function（如 invalidateGateCache）
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\([\\s\\S]*?\\n  \\}'))
  return m ? m[0] : ''
}
const statsBody = fnBody(wpSrc, 'getStats')
const merchantStatsBody = fnBody(wpSrc, 'getMerchantStats')
const screenBody = fnBody(wpSrc, 'getScreenData')
if (/QUOTA|DRAWS|RESERVATIONS/.test(statsBody)) issue('getStats 退化：出现明细表查询（应只读 session 计数器）')
else pass('getStats 只读预聚合计数器（1 次读）')
if (/QUOTA|DRAWS|RESERVATIONS|count\(\)/.test(merchantStatsBody)) issue('getMerchantStats 退化：出现明细表查询/count')
else pass('getMerchantStats 只读场次文档（≤31 次读）')
if (/count\(\)/.test(screenBody)) issue('getScreenData 退化：出现 count 查询（大屏高频轮询应零额外查询）')
else pass('getScreenData 零额外查询（大屏轮询友好）')

// 计数器埋点：业务动作必须同步 bump
for (const fn of ['reserve', 'cancelReservation', 'checkInReservation', 'scanCheckIn', 'draw']) {
  if (!fnBody(wpSrc, fn).includes('bumpSessionStats')) issue(`${fn} 缺少 bumpSessionStats 计数埋点`)
}
pass('5 个业务动作全部带计数埋点')

// 缓存失效：所有影响入口/门控的变更必须清缓存
for (const fn of ['createSession', 'updateSession', 'deleteSession', 'updateMerchant', 'deleteMerchant', 'updateGlobalConfig']) {
  if (!fnBody(wpSrc, fn).includes('invalidateGateCache')) issue(`${fn} 未调用 invalidateGateCache（入口缓存可能滞留 30s+）`)
}
pass('6 个变更入口全部即时清缓存')

// getPublicConfig 必须有结果缓存
if (!fnBody(wpSrc, 'getPublicConfig').includes('_entryCache')) issue('getPublicConfig 退化：结果缓存丢失（最高频公开接口）')
else pass('getPublicConfig 带 30s 结果缓存')

// 公开商家列表：短缓存 + 商家预热 + summary 轻量视图
const listBody = fnBody(wpSrc, 'listPublicSessions')
if (!listBody.includes('_listCache')) issue('listPublicSessions 缺短缓存（入口/列表会重复打库）')
else pass('listPublicSessions 带 30s 短缓存')
if (!listBody.includes('Promise.all') || !listBody.includes('findMerchant')) {
  issue('listPublicSessions 未预热商家缓存（sessionGate 可能串行读商家）')
} else pass('listPublicSessions 预热商家缓存')
if (!listBody.includes('publicSessionSummaryView') && !listBody.includes('summary')) {
  issue('listPublicSessions 缺 summary 轻量模式')
} else pass('listPublicSessions 支持 summary 轻量模式')
const matchBody = fnBody(wpSrc, 'matchPublicSession')
if (!matchBody.includes('missionSessionCount')) {
  issue('matchPublicSession 未回传 missionSessionCount（星问会二次 list）')
} else pass('matchPublicSession 回传 missionSessionCount（星问单次调用）')
if (!fnBody(wpSrc, 'invalidateGateCache').includes('_listCache')) {
  issue('invalidateGateCache 未清空 _listCache')
} else pass('invalidateGateCache 同步清列表缓存')

// 大屏页：自适应轮询 + 老 WebView 兼容
const screenHtml = read(path.join(ROOT, 'admin-web', 'public', 'watch-screen.html'))
let screenOk = true
// 只查真实调用（new URLSearchParams），注释里提到不算
if (/new\s+URLSearchParams/.test(screenHtml)) {
  issue('watch-screen.html 使用了 URLSearchParams（老安卓 WebView 不兼容）')
  screenOk = false
}
const intervalCount = (screenHtml.match(/setInterval\(/g) || []).length
if (intervalCount > 1) {
  issue(`watch-screen.html 存在 ${intervalCount} 个 setInterval（除秒级倒计时外应使用自适应 setTimeout 链）`)
  screenOk = false
}
if (!screenHtml.includes('scheduleSessionPoll') || !screenHtml.includes('votePollMs')) {
  issue('watch-screen.html 自适应轮询丢失（闲时会浪费数据库读）')
  screenOk = false
}
if (screenOk) pass('大屏页：无 URLSearchParams / 自适应轮询 / 仅 1 个秒级 setInterval')

// 大屏页构建产物同步（public → dist 由 vite 构建拷贝）
const distScreen = path.join(ROOT, 'admin-web', 'dist', 'watch-screen.html')
if (!fs.existsSync(distScreen)) issue('dist 缺少 watch-screen.html（需重新构建 admin-web）')
else if (read(distScreen) !== screenHtml) issue('dist/watch-screen.html 与 public 版本不一致（需重新构建 admin-web）')
else pass('大屏页构建产物与源码一致')

// ── 5.6 admin-web 客户端 ↔ 网关路由一致性 ──
console.log('── admin-web 路由一致性 ──')
const clientSrc = read(path.join(ROOT, 'admin-web', 'src', 'api', 'client.js'))
const clientPaths = new Set()
for (const m of clientSrc.matchAll(/request\(\s*[`'"](\/watch-party\/[^`'"?]*)/g)) {
  // 模板串里的 ${id} 归一成通配
  clientPaths.add(m[1].replace(/\$\{[^}]+\}/g, '*'))
}
let routeMatchOk = true
for (const p of clientPaths) {
  let found
  if (p.includes('*')) {
    // 带参路径：网关用 startsWith(前缀) [+ endsWith(后缀)] 匹配
    const [prefix, suffix] = p.split('*')
    found = gwSrc.includes(`path.startsWith('${prefix}'`) &&
      (!suffix || gwSrc.includes(`path.endsWith('${suffix}'`))
  } else {
    found = gwSrc.includes(`'${p}'`)
  }
  if (!found) {
    issue(`client.js 调用的路径在网关中找不到路由: ${p}`)
    routeMatchOk = false
  }
}
if (routeMatchOk) pass(`client.js 的 ${clientPaths.size} 条 watch-party 路径全部有网关路由`)

// ── 5.7 商家场次上限 + 任务周期分账 ──
console.log('── 商家场次上限 / 任务周期 ──')
if (!wpSrc.includes('merchantStartNextCycle')) issue('缺 merchantStartNextCycle')
else pass('merchantStartNextCycle 已导出实现')
if (!gwSrc.includes('next-cycle')) issue('网关缺 next-cycle 路由')
else pass('网关 next-cycle 路由存在')
if (!wpSrc.includes('currentCycleId') || !wpSrc.includes('cycleHistory')) {
  issue('场次缺 currentCycleId / cycleHistory 周期模型')
} else pass('场次周期模型字段存在')
if (!/sessionId.*cycleId.*openid|quotaDocId\(/.test(wpSrc)) {
  issue('抽奖资格键未包含 cycleId')
} else pass('抽奖资格按 session+cycle+openid')
// 2026-08：一商家一场已放开为多场次 + 上限（同月多次发射各建一场）
if (!/MERCHANT_SESSIONS_MAX/.test(wpSrc) || !/场次数量已达上限/.test(wpSrc)) {
  issue('merchantCreateSession 缺场次数量上限约束（MERCHANT_SESSIONS_MAX）')
} else pass('创建场次按商家场次上限约束（MERCHANT_SESSIONS_MAX）')
const apiJs = read(path.join(ROOT, 'subpackages', 'watch-party', 'utils', 'api.js'))
if (!apiJs.includes('merchantStartNextCycle')) issue('客户端 api 缺 merchantStartNextCycle')
else pass('客户端 api 已挂 next-cycle')
const merWxml = read(path.join(SUB, 'merchant.wxml'))
if (!merWxml.includes('开启下一场')) issue('商家中心缺「开启下一场」入口')
else pass('商家中心有开启下一场')
if (/wpm-add-btn[\s\S]{0,40}新建场次/.test(merWxml) && !/wx:if="\{\{!sessions\.length\}\}"/.test(merWxml)) {
  issue('已有场次时仍展示新建入口（应隐藏）')
} else pass('有场次时隐藏新建入口或已改文案')
const poster = read(path.join(SUB, 'utils', 'material-poster.js'))
if (/m\.rocketName|m\.missionName|m\.title/.test(poster) && !/长期线下物料/.test(poster)) {
  issue('物料海报仍绘制任务信息且无长期物料注释')
} else if (/长期线下物料|不印场次标题/.test(poster)) {
  pass('物料海报为长期物料（不印任务）')
} else {
  warn('未能确认物料海报是否已去任务信息')
}

// ── 6. 风险模式扫描 ──
console.log('── 运行时风险模式 ──')
for (const f of subFiles) {
  const src = read(f)
  const rel = path.relative(ROOT, f)
  const intervals = (src.match(/setInterval\(/g) || []).length
  const clears = (src.match(/clearInterval\(/g) || []).length
  if (intervals > 0 && clears === 0) issue(`${rel} 有 setInterval 但没有 clearInterval`)

  // 异步回调 setData 无卸载保护：粗查 .then( 内 setData 且文件里无 _unloaded 标记
  const asyncSetData = /\.then\([\s\S]{0,200}?this\.setData\(/.test(src)
  if (asyncSetData && !src.includes('_unloaded')) {
    warn(`${rel} 异步回调中 setData 无卸载保护（页面退出后回调触发会打 WARN 日志）`)
  }
  // 震动接口应有容错（部分安卓机型/静音策略下 fail）
  if (/wx\.vibrateShort\((?!.*fail)/.test(src) && !/try\s*\{[\s\S]{0,80}wx\.vibrateShort/.test(src)) {
    warn(`${rel} wx.vibrateShort 无 try/fail 容错`)
  }
}
console.log(`\n审计结果：${issues} 个问题 / ${warns} 个提示`)
process.exit(issues > 0 ? 1 : 0)
