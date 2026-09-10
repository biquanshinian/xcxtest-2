/**
 * 列出 Page({...}) 内各方法的字节大小（精确括号配对），用于挑选可挪往分包委托的低频方法。
 * 用法：node scripts/_audit_page_methods.js <page.js> [minBytes]
 */
const fs = require('fs')

const file = process.argv[2]
const minBytes = Number(process.argv[3] || 500)
const s = fs.readFileSync(file, 'utf8')

// 找到 Page({ 的开括号，逐字符扫描顶层方法
const pageIdx = s.search(/Page\(\s*\{/)
if (pageIdx < 0) { console.error('Page({ 未找到'); process.exit(1) }
const open = s.indexOf('{', pageIdx)

const results = []
let i = open + 1
let depth = 1
while (i < s.length && depth > 0) {
  const ch = s[i]
  if (ch === '"' || ch === "'" || ch === '`') {
    const q = ch
    i++
    while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ }
    i++
    continue
  }
  if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
  if (ch === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i) + 2; continue }
  if (ch === '{') { depth++; i++; continue }
  if (ch === '}') { depth--; i++; continue }
  if (depth === 1) {
    // 尝试匹配方法头：name( 或 async name( 或 name: function
    const rest = s.slice(i)
    const m = rest.match(/^(async\s+)?([A-Za-z_$][\w$]*)\s*(\(|:\s*(async\s+)?function)/)
    if (m && !/^(if|for|while|switch|return|catch)$/.test(m[2])) {
      // 找到方法体开括号
      const bodyOpen = s.indexOf('{', i + m[0].length - 1)
      if (bodyOpen > 0) {
        let d = 1
        let j = bodyOpen + 1
        while (j < s.length && d > 0) {
          const c = s[j]
          if (c === '"' || c === "'" || c === '`') {
            const q = c
            j++
            while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++ }
          } else if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++ }
          else if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 1 }
          else if (c === '{') d++
          else if (c === '}') d--
          j++
        }
        results.push({ name: m[2], size: j - i })
        i = j
        continue
      }
    }
  }
  i++
}

results.sort((a, b) => b.size - a.size)
let total = 0
for (const r of results) total += r.size
console.log(file, '| Page 方法数:', results.length, '| 方法总字节:', (total / 1024).toFixed(1) + 'KB', '| 文件:', (s.length / 1024).toFixed(1) + 'KB')
for (const r of results) {
  if (r.size >= minBytes) console.log(String(r.size).padStart(7) + 'B  ' + r.name)
}
