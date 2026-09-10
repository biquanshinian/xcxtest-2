const fs = require('fs')
const path = require('path')

const root = 'c:/Users/huyuz/Desktop/gh_4f8034b031c3_51'
function walk(d, a = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, a)
    else a.push(p)
  }
  return a
}

const files = walk(root)
const maps = files.filter((f) => /\.map$/i.test(f))
const nonMaps = files.filter((f) => !/\.map$/i.test(f))
let bytes = 0
for (const m of maps) bytes += fs.statSync(m).size

console.log('total files', files.length)
console.log('map files', maps.length)
console.log('non-map files', nonMaps.length)
console.log('map size MB', (bytes / 1024 / 1024).toFixed(2))
if (nonMaps.length) {
  console.log('non-map samples:')
  nonMaps.slice(0, 20).forEach((f) => console.log(' ', f.slice(root.length)))
}

const sig = "storeCustomStyle: 'width:100%;min-height:260rpx;'"
const hits = []
for (const m of maps) {
  const t = fs.readFileSync(m, 'utf8')
  if (t.includes(sig) || t.includes('width:100%;min-height:260rpx')) {
    hits.push(m.slice(root.length))
  }
}
console.log('maps containing bad CSS custom-style signature:', hits.length)
hits.forEach((h) => console.log(' ', h))
