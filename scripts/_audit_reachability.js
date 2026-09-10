// 一次性审计：从主包入口做传递可达性分析，找出主包内不可达（仅分包使用/无人使用）的文件
const fs = require('fs')
const path = require('path')

const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const subRoots = (appJson.subPackages || []).map((s) => s.root.replace(/\/$/, ''))
const isSubFile = (f) => subRoots.some((r) => f === r || f.startsWith(r + '/'))

// ---- 收集主包代码文件 ----
const SKIP = new Set(['node_modules', '.git', '.cursor', 'cloudfunctions', 'workers', 'scripts', 'test', 'docs', '_error_report_extract', 'admin-web', 'agent-config', 'terminals', 'cloudflare-worker'])
const allFiles = []
;(function walk(d, rel) {
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n)
    const r = (rel ? rel + '/' + n : n).replace(/\\/g, '/')
    if (fs.statSync(full).isDirectory()) {
      if (!rel && SKIP.has(n)) continue
    walk(full, r)
    } else allFiles.push(r)
  }
})(process.cwd(), '')
const mainCodeFiles = allFiles.filter((f) => !isSubFile(f) && /\.(js|json|wxml|wxss|wxs)$/.test(f))

// ---- 依赖提取 ----
function depsOf(f) {
  const out = new Set()
  const dir = path.dirname(f)
  const norm = (p) => {
    let abs = p.startsWith('/') ? p.slice(1) : path.join(dir, p).replace(/\\/g, '/')
    return abs
  }
  const tryAdd = (p, exts) => {
    for (const e of exts) {
      const cand = p.endsWith(e) ? p : p + e
      if (fs.existsSync(cand)) { out.add(cand); return true }
    }
    return false
  }
  const src = fs.readFileSync(f, 'utf8')
  if (f.endsWith('.js') || f.endsWith('.wxs')) {
    let m
    const re = /require(?:\.async)?\(\s*'([^']+)'\s*\)/g
    while ((m = re.exec(src))) {
      if (m[1].startsWith('.') || m[1].startsWith('/')) tryAdd(norm(m[1]), ['.js', ''])
    }
    // 字符串路径常量（PKG 常量等）
    const cre = /'((?:\.\.\/|\.\/|\/)[\w\-./]+\.(?:js|png|jpg|svg|wxs))'/g
    while ((m = cre.exec(src))) tryAdd(norm(m[1]), [''])
  } else if (f.endsWith('.json')) {
    try {
      const j = JSON.parse(src)
      for (const c of Object.values(j.usingComponents || {})) {
        if (c.startsWith('plugin://')) continue
        const base = norm(c)
        for (const e of ['.js', '.json', '.wxml', '.wxss']) tryAdd(base + e, [''])
      }
    } catch (e) {}
  } else if (f.endsWith('.wxml')) {
    let m
    const re = /(?:src|url)="([^"{}]+)"/g
    while ((m = re.exec(src))) {
      if (m[1].startsWith('.') || m[1].startsWith('/')) tryAdd(norm(m[1]), ['', '.wxml'])
    }
    const ire = /<(?:import|include)\s+src="([^"]+)"/g
    while ((m = ire.exec(src))) tryAdd(norm(m[1]), ['', '.wxml'])
    const wre = /<wxs\s+[^>]*src="([^"]+)"/g
    while ((m = wre.exec(src))) tryAdd(norm(m[1]), ['', '.wxs'])
  } else if (f.endsWith('.wxss')) {
    let m
    const re = /@import\s+['"]([^'"]+)['"]/g
    while ((m = re.exec(src))) tryAdd(norm(m[1]), ['', '.wxss'])
    const ure = /url\(['"]?([^'")]+)['"]?\)/g
    while ((m = ure.exec(src))) {
      if (m[1].startsWith('.') || m[1].startsWith('/')) tryAdd(norm(m[1]), [''])
    }
  }
  return out
}

// ---- 入口集合：app.* + 主包页面 + tabbar + sitemap ----
const seeds = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'project.config.json']
for (const p of appJson.pages) {
  for (const e of ['.js', '.json', '.wxml', '.wxss']) {
    if (fs.existsSync(p + e)) seeds.push(p + e)
  }
}
;['custom-tab-bar/index.js', 'custom-tab-bar/index.json', 'custom-tab-bar/index.wxml', 'custom-tab-bar/index.wxss'].forEach((f) => { if (fs.existsSync(f)) seeds.push(f) })

// ---- BFS（只在主包内扩散；进入分包文件就不再继续，但主包->分包引用不影响主包保留判定）----
const reachable = new Set()
const queue = [...seeds]
while (queue.length) {
  const f = queue.pop()
  if (reachable.has(f)) continue
  reachable.add(f)
  if (isSubFile(f)) continue // 分包内部依赖不影响主包判定
  if (!/\.(js|json|wxml|wxss|wxs)$/.test(f)) continue
  if (!fs.existsSync(f)) continue
  for (const d of depsOf(f)) queue.push(d)
}

// ---- 主包代码文件中不可达的 ----
console.log('== 主包不可达代码文件（按体积降序）==')
const un = mainCodeFiles.filter((f) => !reachable.has(f) && f !== 'project.private.config.json' && f !== 'app.miniapp.json' && !f.startsWith('i18n/'))
let tot = 0
un.map((f) => [f, fs.statSync(f).size / 1024]).sort((a, b) => b[1] - a[1]).forEach(([f, kb]) => {
  tot += kb
  console.log(' ', kb.toFixed(1) + 'KB', f)
})
console.log('合计:', tot.toFixed(1) + 'KB', '(' + un.length + ' 个)')
