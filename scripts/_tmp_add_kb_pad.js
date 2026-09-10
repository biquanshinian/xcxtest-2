/**
 * 键盘垫高改造：
 * 1. 给观礼分包 5 个输入页面的所有 <input>/<textarea> 补
 *    bindkeyboardheightchange="onInputKeyboardHeightChange" bindblur="onInputBlur"
 * 2. 在每页 </scroll-view> 前插入 {{keyboardHeight}}px 垫块
 *    （防 iOS 页面末尾输入框聚焦时越界滚动「顶穿」）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'subpackages', 'watch-party')
const FILES = ['merchant.wxml', 'gacha.wxml', 'watch-party.wxml', 'merchant-edit.wxml', 'merchant-apply.wxml']
const BIND = 'bindkeyboardheightchange="onInputKeyboardHeightChange" bindblur="onInputBlur"'
const PAD = '    <view class="kb-pad" style="height: {{keyboardHeight}}px;"></view>\n'

for (const f of FILES) {
  const p = path.join(ROOT, f)
  let src = fs.readFileSync(p, 'utf8')
  let binds = 0
  src = src.replace(/<(input|textarea)\b([\s\S]*?)\/>/g, (m, tag, attrs) => {
    if (/bindkeyboardheightchange=/.test(attrs)) return m
    binds++
    return '<' + tag + attrs.replace(/\s*$/, ' ') + BIND + ' />'
  })
  fs.writeFileSync(p, src, 'utf8')
  const scrolls = (src.match(/<\/scroll-view>/g) || []).length
  console.log(`${f}: 加绑定 ${binds} 个输入组件（页面含 ${scrolls} 个 scroll-view，垫块手动插入主滚动容器）`)
}
