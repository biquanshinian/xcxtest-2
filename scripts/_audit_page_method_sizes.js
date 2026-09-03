// 通用：列出 Page({}) 内各方法大小（从 methods 名开始到配对大括号结束）
const fs = require('fs')
const file = process.argv[2]
const s = fs.readFileSync(file, 'utf8')
const re = /^  (?:async )?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm
const hits = []
let m
while ((m = re.exec(s))) hits.push({ name: m[1], start: m.index })
for (let i = 0; i < hits.length; i++) {
  // 找配对大括号
  let d = 0, j = s.indexOf('{', hits[i].start)
  let k = j
  for (; k < s.length; k++) {
    if (s[k] === '{') d++
    else if (s[k] === '}') { d--; if (d === 0) break }
  }
  hits[i].size = k - hits[i].start
}
hits.sort((a, b) => b.size - a.size)
console.log('总计', (s.length / 1024).toFixed(1) + 'KB,', hits.length, '个方法')
hits.slice(0, 35).forEach((h) => console.log(String(h.size).padStart(6), h.name))
