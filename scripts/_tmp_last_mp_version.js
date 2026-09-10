const fs = require('fs')
const path = require('path')
const roots = [
  path.join(process.env.LOCALAPPDATA, '微信开发者工具', 'User Data'),
  path.join(process.env.APPDATA, '微信开发者工具')
]
function walk(d, out, depth) {
  if (!fs.existsSync(d) || depth > 8) return
  let names
  try { names = fs.readdirSync(d) } catch (e) { return }
  for (const name of names) {
    if (name === 'WeappCache' || name === 'WeappPlugin' || name === 'WeappForeignPkgs' || name === 'node_modules') continue
    const p = path.join(d, name)
    let st
    try { st = fs.statSync(p) } catch (e) { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(json|log|txt)$/i.test(name) && st.size < 4 * 1024 * 1024) out.push(p)
  }
}
const files = []
for (const r of roots) walk(r, files, 0)
const needles = ['xcxtest-2', 'wxf98b58309019771b']
const hits = []
for (const f of files) {
  let t
  try { t = fs.readFileSync(f, 'utf8') } catch (e) { continue }
  if (!needles.some((n) => t.indexOf(n) !== -1)) continue
  const versions = []
  const re = /(?:lastUploadVersion|uploadVersion|versionName|lastVersion|currentVersion|userVersion|version)\s*[":=]\s*"?(\d+\.\d+(?:\.\d+)?)"?/g
  let m
  while ((m = re.exec(t))) versions.push(m[1])
  hits.push({ file: f, size: t.length, versions: Array.from(new Set(versions)).slice(0, 20) })
}
console.log(JSON.stringify({ fileCount: files.length, hitCount: hits.length, hits: hits.slice(0, 40) }, null, 2))
