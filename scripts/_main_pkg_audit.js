// 一次性脚本：按 app.json 分包声明 + project.config.json packOptions.ignore 估算主包体积
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const pc = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
const subRoots = (app.subPackages || []).map((p) => p.root.replace(/\/$/, '') + '/')
const ignores = ((pc.packOptions && pc.packOptions.ignore) || []).map((i) => i.value)

function globToRe(g) {
  let re = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*')
  return new RegExp('^' + re + '$')
}
const ignoreRes = ignores.map(globToRe)

const EXCLUDE_TOP = new Set(['node_modules', '.git', '.cursor', 'cloudfunctions', 'workers', 'scripts', 'test', 'docs', '_error_report_extract', 'admin-web', 'agent-config'])
let total = 0
const byDir = {}
const files = []
function walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const r = rel ? rel + '/' + name : name
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      if (!rel && EXCLUDE_TOP.has(name)) continue
      walk(full, r)
    } else {
      if (subRoots.some((s) => r.startsWith(s))) continue
      if (ignoreRes.some((re) => re.test(r))) continue
      if (/\.(md|map|log|ts)$/.test(name) || name === '.DS_Store' || name === '.eslintrc.js') continue
      total += st.size
      const top = r.includes('/') ? r.slice(0, r.indexOf('/')) : '(root)'
      byDir[top] = (byDir[top] || 0) + st.size
      files.push([r, st.size])
    }
  }
}
walk(root, '')
console.log('主包估算总计:', (total / 1024).toFixed(1), 'KB')
Object.entries(byDir).sort((a, b) => b[1] - a[1]).forEach(([d, s]) => console.log(' ', (s / 1024).toFixed(1).padStart(8), 'KB', d))
console.log('\nTop 15 文件:')
files.sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([f, s]) => console.log(' ', (s / 1024).toFixed(1).padStart(8), 'KB', f))
