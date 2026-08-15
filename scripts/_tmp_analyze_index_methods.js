const fs = require('fs')
const s = fs.readFileSync('pages/index/index.js', 'utf8')
console.log('index.js', (s.length / 1024).toFixed(1))
const re = /^  ([a-zA-Z_][\w]*)\s*\(/gm
let m
const starts = []
while ((m = re.exec(s))) starts.push({ name: m[1], at: m.index })
starts.push({ name: 'EOF', at: s.length })
const sizes = starts.slice(0, -1).map((x, i) => ({
  name: x.name,
  kb: (starts[i + 1].at - x.at) / 1024
}))
sizes.sort((a, b) => b.kb - a.kb)
console.log(sizes.slice(0, 30).map((x) => x.kb.toFixed(1) + ' ' + x.name).join('\n'))

// count stub comments for interaction
const stub = (s.match(/→ index-interaction attachTo/g) || []).length
console.log('interaction stubs', stub)
