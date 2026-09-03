const fs = require('fs')
const path = require('path')
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const subRoots = (appJson.subPackages || []).map((s) => s.root.replace(/\/$/, ''))
const isSub = (f) => subRoots.some((r) => f === r || f.startsWith(r + '/'))
const SKIP = new Set(['node_modules', '.git', 'cloudfunctions', 'workers', 'scripts', 'admin-web', 'test', 'docs'])
const all = []
;(function walk(d, rel) {
  for (const n of fs.readdirSync(d)) {
    if (!rel && SKIP.has(n)) continue
    const full = path.join(d, n)
    const r = (rel ? rel + '/' + n : n).replace(/\\/g, '/')
    if (fs.statSync(full).isDirectory()) walk(full, r)
    else if (r.endsWith('.js')) all.push(r)
  }
})(process.cwd(), '')

const utils = all.filter((f) => f.startsWith('utils/') && f.endsWith('.js'))
function whoRequires(target) {
  const base = path.basename(target, '.js')
  const hits = []
  for (const f of all) {
    if (f === target) continue
    const s = fs.readFileSync(f, 'utf8')
    const rr = /require(?:\.async)?\(\s*['"]([^'"]+)['"]/g
    let m
    while ((m = rr.exec(s))) {
      const p = m[1]
      if (p === target || p.endsWith('/' + base) || p.endsWith('/' + base + '.js') || p === './' + base || p === './' + base + '.js') {
        hits.push(f)
      }
    }
  }
  return [...new Set(hits)]
}

const out = []
for (const u of utils) {
  const size = fs.statSync(u).size
  if (size < 3000) continue
  const refs = whoRequires(u)
  const main = refs.filter((r) => !isSub(r))
  const sub = refs.filter((r) => isSub(r))
  if (main.length === 0 && sub.length > 0) {
    out.push({ kb: size / 1024, u, n: sub.length, sample: sub.slice(0, 4) })
  }
}
out.sort((a, b) => b.kb - a.kb)
console.log('仅分包引用的 utils（主包无 require）:')
out.forEach((x) => console.log(x.kb.toFixed(1) + 'KB', x.u, 'sub=' + x.n, x.sample.join(' | ')))
console.log('count', out.length)
