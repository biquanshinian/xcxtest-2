const fs = require('fs')
const path = require('path')

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'scripts', 'test', 'admin-web', 'docs', 'cloudfunctions', 'cloudflare-worker'].includes(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (name.endsWith('.js') && !name.includes('.test.')) acc.push(p)
  }
}

function extract(src, start) {
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

function methodBody(src, name) {
  const re = new RegExp('(?:^|\\n)(  (?:async\\s+)?' + name + '\\s*\\([^)]*\\)\\s*\\{)')
  let m = src.match(re)
  if (!m) {
    const re2 = new RegExp('(?:^|\\n)(  ' + name + '\\s*:\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{)')
    m = src.match(re2)
    if (!m) return ''
  }
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  return extract(src, start)
}

const files = []
walk(path.resolve(__dirname, '..'), files)
const rows = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  if (!/onShareAppMessage|onShareTimeline/.test(src)) continue
  const app = methodBody(src, 'onShareAppMessage')
  const tl = methodBody(src, 'onShareTimeline')
  if (!app && !tl) continue
  const hasEnsure = /ensureShareImageHttpUrl/.test(src)
  const appImg = /imageUrl/.test(app)
  const tlImg = !tl || /imageUrl/.test(tl)
  const empty = /imageUrl:\s*''/.test(app + tl)
  const weak = /(item|model|first)\.(imageUrl|image|displayImage|heroImage|thumbnailUrl|cardImage)/.test(app + tl) && !hasEnsure
  const missing = (app && !appImg) || (tl && !tlImg)
  if (missing || empty || weak || !hasEnsure) {
    const snip = ((app + tl).match(/imageUrl:[^\n,]+/) || ['NO imageUrl'])[0]
    rows.push({
      f: path.relative(path.resolve(__dirname, '..'), f).replace(/\\/g, '/'),
      hasEnsure,
      missing,
      empty,
      weak,
      snip: snip.slice(0, 120)
    })
  }
}
rows.sort((a, b) => a.f.localeCompare(b.f))
for (const r of rows) {
  const flags = [
    r.hasEnsure ? 'ENSURE' : 'NOENS',
    r.missing ? 'MISS' : '',
    r.empty ? 'EMPTY' : '',
    r.weak ? 'WEAK' : ''
  ].filter(Boolean).join(' ')
  console.log(flags + '  ' + r.f + '  ::  ' + r.snip)
}
console.log('COUNT', rows.length)
