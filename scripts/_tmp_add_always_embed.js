/**
 * 观礼分包 input 漂移修复：给全部 <input> 补 always-embed="{{true}}"
 * 背景：页面为全屏 scroll-view，iOS 键盘顶推后原生输入浮层与 webview 错位
 * （光标/已输入文字漂到别的行）。always-embed 强制同层渲染（基础库 2.10.4+，
 * 需固定高度，均已满足）；Android / 旧库自动忽略该属性。textarea 不适用不处理。
 * 运行：node scripts/_tmp_add_always_embed.js
 */
const fs = require('fs')
const path = require('path')

const files = [
  'subpackages/watch-party/merchant-edit.wxml',
  'subpackages/watch-party/merchant.wxml',
  'subpackages/watch-party/watch-party.wxml',
  'subpackages/watch-party/gacha.wxml'
]

let total = 0
files.forEach((rel) => {
  const p = path.join(__dirname, '..', rel)
  let s = fs.readFileSync(p, 'utf8')
  let count = 0
  s = s.replace(/<input\b([\s\S]*?)\/>/g, (m, attrs) => {
    if (/always-embed/.test(attrs)) return m
    count++
    return '<input' + attrs.replace(/[ \t]*$/, ' ') + 'always-embed="{{true}}" />'
  })
  fs.writeFileSync(p, s)
  total += count
  console.log(rel, '+' + count)
})
console.log('共补充', total, '个 input')
