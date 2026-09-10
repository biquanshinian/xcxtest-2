// 校验 4 个 wxml 里 textarea 上没有残留裸 type= 属性（排除 confirm-type / data-*）
const fs = require('fs')
const files = ['merchant.wxml', 'gacha.wxml', 'watch-party.wxml', 'merchant-edit.wxml']
let bad = 0
for (const f of files) {
  const s = fs.readFileSync('subpackages/watch-party/' + f, 'utf8')
  const m = s.match(/[\s"](type)="[^"]*"/g) || []
  const real = m.filter((x) => !/confirm-type|data-type/.test(x))
  console.log(f + ': 裸type属性=' + real.length + (real.length ? ' ' + JSON.stringify(real) : ''))
  bad += real.length
}
process.exit(bad ? 1 : 0)
