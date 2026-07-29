/**
 * 路由目标审计：代码里出现的站内页面路径必须在 app.json 中声明。
 *
 * 分享 path / navigateTo / redirectTo 指向未声明的页面时，微信会走 onPageNotFound，
 * 从分享卡片冷启动进入尤其容易表现为打不开或被弹回首页。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
process.chdir(ROOT)

const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'))

const declared = new Set()
;(appJson.pages || []).forEach((p) => declared.add('/' + p.replace(/^\//, '')))
;(appJson.subPackages || []).forEach((sp) => {
  const root = String(sp.root).replace(/\/+$/, '')
  ;(sp.pages || []).forEach((p) => declared.add('/' + root + '/' + p.replace(/^\//, '')))
})

// onPageNotFound 里显式声明的旧路径映射，属于有意保留的兼容入口
const legacyAllow = new Set()
{
  const appSrc = fs.readFileSync('app.js', 'utf8')
  const block = appSrc.match(/legacyMap\s*=\s*\{([\s\S]*?)\n\s*\}/)
  if (block) {
    for (const m of block[1].matchAll(/['"]([^'"]+)['"]\s*:/g)) {
      legacyAllow.add('/' + m[1].replace(/^\//, ''))
    }
  }
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'cloudfunctions', 'workers', 'scripts',
  'admin-web', 'test', 'docs', 'terminals', '.cursor', 'miniprogram_npm',
  '_error_report_extract'
])

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    if (!rel && SKIP_DIRS.has(name)) continue
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const r = (rel ? rel + '/' + name : name).replace(/\\/g, '/')
    let st
    try { st = fs.statSync(full) } catch (_e) { continue }
    if (st.isDirectory()) walk(full, r, out)
    else if (/\.(js|wxml|json)$/.test(r)) out.push(r)
  }
  return out
}

const files = walk(ROOT, '', [])
const bad = []
const seen = new Map()

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  for (const m of src.matchAll(/['"](\/(?:pages|subpackages)\/[A-Za-z0-9_\-/]*)(\?[^'"]*)?['"]/g)) {
    const p = m[1].replace(/\/+$/, '')
    // 只校验看起来像完整页面路径的（至少两段）
    if (p.split('/').length < 3) continue
    if (!seen.has(p)) seen.set(p, new Set())
    seen.get(p).add(f)
  }
}

/** 自定义组件的 .json 带 "component": true，据此把组件路径排除在页面校验之外 */
function isCustomComponent(p) {
  const jsonPath = path.join(ROOT, p + '.json')
  if (!fs.existsSync(jsonPath)) return false
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')).component === true
  } catch (_e) {
    return false
  }
}

for (const [p, refs] of seen) {
  if (declared.has(p) || legacyAllow.has(p)) continue
  if (!fs.existsSync(path.join(ROOT, p + '.wxml'))) continue // 图片 / 工具模块路径
  if (isCustomComponent(p)) continue
  bad.push({ p, refs: [...refs] })
}

console.log('app.json 声明页面:', declared.size, '个')
console.log('代码中出现的站内页面路径:', seen.size, '个\n')

if (bad.length) {
  console.log('🔴 引用了未在 app.json 声明的页面：')
  bad.forEach((b) => {
    console.log('  ' + b.p)
    b.refs.slice(0, 6).forEach((r) => console.log('      ← ' + r))
  })
} else {
  console.log('🟢 所有被引用的页面路径均已在 app.json 声明')
}

// 反向：声明了但没有实体文件的页面（打包会报错）
const missingFiles = [...declared].filter((p) => !fs.existsSync(path.join(ROOT, p.slice(1) + '.wxml')))
if (missingFiles.length) {
  console.log('\n🔴 app.json 声明但缺少 .wxml 的页面：')
  missingFiles.forEach((p) => console.log('  ' + p))
} else {
  console.log('🟢 app.json 声明的页面均存在实体文件')
}

const fail = bad.length + missingFiles.length
console.log('\n══ 结论 ══')
console.log(fail ? fail + ' 处路由目标异常' : '全部通过')
process.exit(fail ? 1 : 0)
