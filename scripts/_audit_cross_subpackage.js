/**
 * 跨分包引用审计（分享/直达冷启动黑屏根因）
 *
 * 微信分包规则：分包 A 不能同步引用分包 B 的资源。
 * 从 Tab 页进入时 preloadRule 会把 shared 等分包预下载，所以「App 内点进去」一切正常；
 * 但分享卡片 / 朋友圈单页（scene 1154）直达分包页时只会下载该页所在分包，
 * 被引用的另一个分包不存在 → 模块加载抛错 → Page 未注册 → 整页黑屏。
 *
 * 检查项：
 *   1. JS 同步 require 跨分包            → 致命（黑屏）
 *   2. JSON usingComponents 跨分包       → 需 componentPlaceholder（分包异步化）兜底，否则致命
 *   3. WXSS @import 跨分包               → 样式丢失
 *   4. WXML wxs/import/include src 跨分包 → 编译失败
 *
 * require.async 跨分包是官方支持的（分包异步化），不报错。
 */
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const SUB_ROOTS = (appJson.subPackages || []).map((s) => String(s.root).replace(/\/+$/, ''))
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'cloudfunctions', 'workers', 'scripts',
  'admin-web', 'test', 'docs', 'terminals', '.cursor', 'miniprogram_npm'
])

/** 返回文件所属分包 root，主包返回 null */
function subRootOf(rel) {
  for (const r of SUB_ROOTS) {
    if (rel === r || rel.startsWith(r + '/')) return r
  }
  return null
}

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    if (!rel && SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const r = (rel ? rel + '/' + name : name).replace(/\\/g, '/')
    let st
    try { st = fs.statSync(full) } catch (_) { continue }
    if (st.isDirectory()) walk(full, r, out)
    else out.push(r)
  }
  return out
}

const ALL = walk(ROOT, '', [])

/** 把 require/import 说明符解析成仓库相对路径 */
function resolveSpec(fromRel, spec, exts) {
  if (!spec || /^(plugin|plugin-private):/.test(spec)) return null
  let target
  if (spec.startsWith('/')) target = spec.slice(1)
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  else return null // npm 包
  const candidates = [target]
  for (const e of exts) {
    if (!target.endsWith(e)) candidates.push(target + e)
    candidates.push(target + '/index' + e)
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(ROOT, c))) return c
  }
  return target // 不存在也返回，交给断链检查
}

const findings = []
function report(level, kind, from, spec, to, note) {
  findings.push({ level, kind, from, spec, to, note })
}

// ── 1. JS 同步 require 跨分包 ────────────────────────────────
const JS_FILES = ALL.filter((f) => f.endsWith('.js'))
for (const f of JS_FILES) {
  const fromSub = subRootOf(f)
  if (!fromSub) continue // 主包引用分包是另一类问题，分包能引用主包
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const re = /require(\.async)?\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const m of src.matchAll(re)) {
    const isAsync = !!m[1]
    const spec = m[2]
    const to = resolveSpec(f, spec, ['.js'])
    if (!to) continue
    const toSub = subRootOf(to)
    if (toSub && toSub !== fromSub) {
      if (isAsync) report('info', 'js-require-async', f, spec, to, '分包异步化，OK')
      else report('fatal', 'js-require-sync', f, spec, to, `${fromSub} → ${toSub} 同步引用，直达冷启动黑屏`)
    }
  }
}

// ── 2. JSON usingComponents 跨分包 ──────────────────────────
const JSON_FILES = ALL.filter((f) => f.endsWith('.json') && !f.startsWith('cloudfunctions/'))
for (const f of JSON_FILES) {
  const fromSub = subRootOf(f)
  if (!fromSub) continue
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) } catch (_) { continue }
  const comps = cfg.usingComponents
  if (!comps || typeof comps !== 'object') continue
  const ph = cfg.componentPlaceholder || {}
  for (const [name, p] of Object.entries(comps)) {
    const to = resolveSpec(f, String(p), ['.json'])
    if (!to) continue
    const toSub = subRootOf(to)
    if (toSub && toSub !== fromSub) {
      if (ph[name]) report('info', 'component-cross', f, name + ' → ' + p, to, '有 componentPlaceholder，OK')
      else report('fatal', 'component-cross-no-placeholder', f, name + ' → ' + p, to, `${fromSub} → ${toSub} 缺 componentPlaceholder`)
    }
  }
}

// ── 3. WXSS @import 跨分包 ──────────────────────────────────
for (const f of ALL.filter((x) => x.endsWith('.wxss'))) {
  const fromSub = subRootOf(f)
  if (!fromSub) continue
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  const re = /@import\s+['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    const to = resolveSpec(f, m[1], ['.wxss'])
    if (!to) continue
    const toSub = subRootOf(to)
    if (toSub && toSub !== fromSub) report('fatal', 'wxss-import-cross', f, m[1], to, `${fromSub} → ${toSub}`)
  }
}

// ── 4. WXML wxs / import / include 跨分包 ───────────────────
for (const f of ALL.filter((x) => x.endsWith('.wxml'))) {
  const fromSub = subRootOf(f)
  if (!fromSub) continue
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  const re = /<(?:wxs|import|include)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    const to = resolveSpec(f, m[1], ['.wxs', '.wxml'])
    if (!to) continue
    const toSub = subRootOf(to)
    if (toSub && toSub !== fromSub) report('fatal', 'wxml-src-cross', f, m[1], to, `${fromSub} → ${toSub}`)
  }
}

// ── 输出 ────────────────────────────────────────────────────
const fatal = findings.filter((x) => x.level === 'fatal')
const info = findings.filter((x) => x.level === 'info')

console.log('分包 root:', SUB_ROOTS.length, '个')
console.log('扫描文件:', ALL.length, '个\n')

if (fatal.length) {
  console.log('🔴 致命：跨分包同步引用（分享/直达冷启动黑屏）')
  const byFile = {}
  fatal.forEach((x) => { (byFile[x.from] = byFile[x.from] || []).push(x) })
  Object.keys(byFile).sort().forEach((f) => {
    console.log('\n  ' + f)
    byFile[f].forEach((x) => console.log(`    [${x.kind}] ${x.spec}\n        → ${x.to}   (${x.note})`))
  })
} else {
  console.log('🟢 无跨分包同步引用')
}

console.log('\n🟡 跨分包异步引用（合规，仅记录）:', info.length, '处')
const infoByKind = {}
info.forEach((x) => { infoByKind[x.kind] = (infoByKind[x.kind] || 0) + 1 })
Object.entries(infoByKind).forEach(([k, v]) => console.log('   ', k, v))

console.log('\n══ 结论 ══')
console.log(fatal.length ? `${fatal.length} 处致命跨分包同步引用` : '全部通过')
process.exit(fatal.length ? 1 : 0)
