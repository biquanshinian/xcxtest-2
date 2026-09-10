const fs = require('fs')
const p = require('path').join(__dirname, '../subpackages/watch-party/merchant-edit.wxml')
let s = fs.readFileSync(p, 'utf8')
s = s.replace(/\s+hold-keyboard/g, '')
s = s.replace(
  '<scroll-view class="page-scroll" scroll-y enhanced show-scrollbar="{{false}}">',
  '<scroll-view class="page-scroll" scroll-y show-scrollbar="{{false}}" binddragstart="onFormDragStart" bindtouchmove="onFormTouchMove">'
)
fs.writeFileSync(p, s)
console.log('hold-keyboard left', (s.match(/hold-keyboard/g) || []).length)
console.log('binddragstart', s.includes('binddragstart'))
console.log('enhanced on page-scroll', /page-scroll"[^>]*enhanced/.test(s))
