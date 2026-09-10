// 模拟打包：应用 packOptions.ignore 后统计主包体积构成
const fs = require('fs')
const path = require('path')

const cfg = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const subRoots = (appJson.subPackages || []).map((s) => s.root.replace(/\/$/, ''))

const globs = cfg.packOptions.ignore.map((r) => r.value.replace(/^\//, ''))
function globToRe(g) {
  let s = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp('^' + s + '$')
}
const res = globs.map(globToRe)
// folder 类型规则
const folderRules = cfg.packOptions.ignore.filter((r) => r.type === 'folder').map((r) => r.value.replace(/^\//, ''))
const ignored = (f) => res.some((re) => re.test(f)) || folderRules.some((d) => f === d || f.startsWith(d + '/'))

// 打包器还会自动排除的
const AUTO_SKIP = /(^|\/)(node_modules|\.git|\.github|\.cursor|\.vscode|\.idea)(\/|$)|(^|\/)\./

const files = []
;(function walk(d, rel) {
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n)
    const r = (rel ? rel + '/' + n : n).replace(/\\/g, '/')
    let st
    try { st = fs.statSync(full) } catch (e) { continue }
    if (st.isDirectory()) {
      if (AUTO_SKIP.test(r + '/')) continue
      if (ignored(r) || folderRules.some((x) => x === r)) continue
      walk(full, r)
    } else {
      if (AUTO_SKIP.test(r)) continue
      if (ignored(r)) continue
      files.push([r, st.size])
    }
  }
})(process.cwd(), '')

const isSub = (f) => subRoots.some((r) => f === r || f.startsWith(r + '/'))
const main = files.filter(([f]) => !isSub(f))

// 按顶层目录汇总
const byDir = {}
let total = 0
for (const [f, s] of main) {
  const top = f.includes('/') ? f.split('/')[0] : '(root)'
  byDir[top] = (byDir[top] || 0) + s
  total += s
}
console.log('== 主包体积构成（应用 ignore 后，磁盘源码口径）==')
Object.entries(byDir).sort((a, b) => b[1] - a[1]).forEach(([d, s]) => console.log(' ', (s / 1024).toFixed(1) + 'KB', d))
console.log('主包合计:', (total / 1024).toFixed(1) + 'KB =', (total / 1024 / 1024).toFixed(3) + 'MB')
console.log()
console.log('== 主包 Top 30 文件 ==')
main.sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([f, s]) => console.log(' ', (s / 1024).toFixed(1) + 'KB', f))

// 非代码资源文件统计
const codeRe = /\.(js|json|wxml|wxss|wxs)$/
const assets = main.filter(([f]) => !codeRe.test(f))
const assetTotal = assets.reduce((a, [, s]) => a + s, 0)
console.log()
console.log('== 主包资源文件（非代码）合计:', (assetTotal / 1024).toFixed(1) + 'KB ==')
assets.sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([f, s]) => console.log(' ', (s / 1024).toFixed(1) + 'KB', f))
