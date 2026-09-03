// 把 oa-alert-* 规则从组件 wxss 搬回页面 wxss：
// 页面「外观」卡片复用这些类；组件侧经 styleIsolation: apply-shared 仍可获得页面样式
const fs = require('fs')
const compFile = 'subpackages/profile-extra/components/profile-sections/index.wxss'
const pageFile = 'pages/profile/profile.wxss'

function parseRules(src) {
  const rules = []
  let i = 0
  let buf = ''
  while (i < src.length) {
    const ch = src[i]
    buf += ch
    if (ch === '{') {
      let d = 1
      i++
      while (i < src.length && d > 0) {
        buf += src[i]
        if (src[i] === '{') d++
        else if (src[i] === '}') d--
        i++
      }
      rules.push(buf)
      buf = ''
      continue
    }
    if (ch === ';') { rules.push(buf); buf = '' }
    i++
  }
  if (buf.trim()) rules.push(buf)
  return rules
}

const comp = fs.readFileSync(compFile, 'utf8')
const rules = parseRules(comp)
const back = []
const stay = []
for (const r of rules) {
  const sel = (r.split('{')[0] || '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (sel.includes('.oa-alert')) back.push(r)
  else stay.push(r)
}
fs.writeFileSync(compFile, stay.map((r) => r.trim()).join('\n\n') + '\n')
const page = fs.readFileSync(pageFile, 'utf8')
fs.writeFileSync(pageFile, page + '\n/* ── 服务号提醒卡 / 外观卡共用样式（组件经 apply-shared 复用） ── */\n' + back.map((r) => r.trim()).join('\n\n') + '\n')
console.log('搬回规则数:', back.length)
