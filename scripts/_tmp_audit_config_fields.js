/**
 * 审计：utils/config.js 恢复自 HEAD 后，全代码库引用的 config 顶层字段是否都存在。
 * 运行：node scripts/_tmp_audit_config_fields.js
 */
const fs = require('fs')
const path = require('path')

const cfg = require('../utils/config.js')
const topKeys = new Set(Object.keys(cfg))
const used = new Map()
const roots = ['pages', 'subpackages', 'utils', 'components', 'custom-tab-bar', 'app.js']
const requireRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\((['"])[^'"]*config(?:\.js)?\2\)/g

function scanFile(p) {
  if (!/\.js$/.test(p)) return
  const src = fs.readFileSync(p, 'utf8')
  requireRe.lastIndex = 0
  let m
  const aliases = []
  while ((m = requireRe.exec(src))) {
    // 只认 utils/config.js（含相对路径 ../utils/config.js、./config.js in utils/）
    if (/utils[\\/]config|\.\/config/.test(m[0])) aliases.push(m[1])
  }
  for (const alias of aliases) {
    const re = new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)', 'g')
    let mm
    while ((mm = re.exec(src))) {
      const k = mm[1]
      if (!used.has(k)) used.set(k, new Set())
      used.get(k).add(p)
    }
  }
}

function walk(p) {
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f === 'node_modules' || f.startsWith('.')) continue
      walk(path.join(p, f))
    }
    return
  }
  scanFile(p)
}

const base = path.join(__dirname, '..')
for (const r of roots) {
  const full = path.join(base, r)
  if (fs.existsSync(full)) walk(full)
}

let missing = 0
for (const [k, files] of used) {
  if (!topKeys.has(k)) {
    missing++
    console.log('MISSING:', k, '<-', Array.from(files).slice(0, 3).join(', '))
  }
}
console.log(missing
  ? `${missing} 个字段缺失（共 ${used.size} 个字段被引用）`
  : `所有被引用的 config 顶层字段都存在（共 ${used.size} 个字段被引用）`)
process.exit(missing ? 1 : 0)
