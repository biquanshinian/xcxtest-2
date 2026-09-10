// 统计观礼分包各 wxml 的输入组件分布 + 动态区(wx:for)内 textarea 检查
const fs = require('fs')
const path = require('path')
const DIR = path.join(__dirname, '..', 'subpackages', 'watch-party')
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.wxml'))) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')
  const tas = src.match(/<textarea\b[\s\S]*?\/>/g) || []
  const singles = tas.filter((t) => /data-single="1"/.test(t)).length
  const multis = tas.length - singles
  const inputs = (src.match(/<input\b/g) || []).length
  // 动态行 textarea：id 含 {{index}} 即在 wx:for 内
  const dynTa = tas.filter((t) => /\{\{index\}\}/.test((t.match(/id="([^"]*)"/) || [])[1] || '')).length
  if (tas.length || inputs) {
    console.log(`${f}: 单行ta=${singles} 多行ta=${multis} input=${inputs}${dynTa ? ' ⚠️动态区textarea=' + dynTa : ''}`)
  }
}
