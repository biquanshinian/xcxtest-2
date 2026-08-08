// 列出 JS 文件顶层声明块及其字节大小
const fs = require('fs')
const file = process.argv[2]
const min = Number(process.argv[3] || 800)
const s = fs.readFileSync(file, 'utf8')
const lines = s.split('\n')
let cur = null
const items = []
let depth = 0
lines.forEach((l, idx) => {
  if (depth === 0) {
    const m = l.match(/^(const|let|var|function|async function)\s+(\S+)/)
    if (m) {
      if (cur) { cur.end = idx; items.push(cur) }
      cur = { name: m[2].slice(0, 60), start: idx }
    }
    if (/^Page\(/.test(l)) {
      if (cur) { cur.end = idx; items.push(cur); cur = null }
      items.push({ name: 'Page({...})', start: idx, end: lines.length })
    }
  }
  const opens = (l.match(/[{(\[]/g) || []).length
  const closes = (l.match(/[})\]]/g) || []).length
  depth += opens - closes
})
if (cur && cur.end === undefined) { cur.end = lines.length; items.push(cur) }
items.forEach((it) => {
  const size = lines.slice(it.start, it.end).join('\n').length
  if (size > min) console.log(String(size).padStart(7) + 'B  行' + (it.start + 1) + '  ' + it.name)
})
