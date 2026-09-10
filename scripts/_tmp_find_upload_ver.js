const fs = require('fs')
const path = require('path')
const files = [
  'C:\\Users\\huyuz\\AppData\\Local\\微信开发者工具\\User Data\\7688c56cc354c78cdae20cfaa2781e38\\WeappLocalData\\localstorage_b0f4109a3f102cf2700334322fa3c4c5.json',
  'C:\\Users\\huyuz\\AppData\\Local\\微信开发者工具\\User Data\\270d7310f77e162f7f0cb30ab692180c\\WeappLocalData\\localstorage_b0f4109a3f102cf2700334322fa3c4b5.json'
]
function extractAround(t, needle, pad) {
  const i = t.indexOf(needle)
  if (i < 0) return null
  return t.slice(Math.max(0, i - pad), Math.min(t.length, i + needle.length + pad))
}
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log('missing', f)
    continue
  }
  const t = fs.readFileSync(f, 'utf8')
  console.log('====', f, t.length)
  for (const n of ['lastUpload', 'uploadVersion', 'userVersion', 'versionName', 'uploadInfo', 'lastVersion', 'xcxtest-2']) {
    const snip = extractAround(t, n, 180)
    if (snip) console.log('---', n, '\n', snip, '\n')
  }
}
const logDir = 'C:\\Users\\huyuz\\AppData\\Local\\微信开发者工具\\User Data\\7688c56cc354c78cdae20cfaa2781e38\\WeappLog\\logs'
const names = fs.readdirSync(logDir).filter((n) => n.endsWith('.log')).sort().reverse().slice(0, 25)
for (const n of names) {
  const p = path.join(logDir, n)
  const st = fs.statSync(p)
  if (st.size > 3 * 1024 * 1024) continue
  const t = fs.readFileSync(p, 'utf8')
  if (!/upload|上传|versionName|userVersion/i.test(t)) continue
  const lines = t.split(/\r?\n/).filter((l) => /upload|上传|versionName|userVersion|版本/i.test(l)).slice(0, 12)
  console.log('LOG', n, lines)
}
