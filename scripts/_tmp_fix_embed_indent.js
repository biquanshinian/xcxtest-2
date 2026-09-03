/** 把批量追加时落到下一行的 always-embed 属性并回上一行（纯格式，无逻辑变化） */
const fs = require('fs')
const path = require('path')
const files = [
  'subpackages/watch-party/merchant-edit.wxml',
  'subpackages/watch-party/merchant.wxml',
  'subpackages/watch-party/watch-party.wxml',
  'subpackages/watch-party/gacha.wxml'
]
files.forEach((rel) => {
  const p = path.join(__dirname, '..', rel)
  let s = fs.readFileSync(p, 'utf8')
  const before = s
  s = s.replace(/\r?\n[ \t]*always-embed="\{\{true\}\}" \/>/g, ' always-embed="{{true}}" />')
  if (s !== before) {
    fs.writeFileSync(p, s)
    console.log(rel, '缩进已归位')
  } else {
    console.log(rel, '无需处理')
  }
})
