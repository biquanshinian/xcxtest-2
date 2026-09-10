/**
 * 批量把 watch-party 子包 wxml 中的单行 <input> 换成单行 <textarea>
 * 背景：iOS 上 input 聚焦切原生层导致漂移（always-embed 无效），
 *       textarea 同层渲染稳定（「观礼介绍」验证）。
 * 变换规则：
 *   - <input ... /> → <textarea ... />
 *   - 删 always-embed（textarea 无此属性）、删 type（textarea 不支持，数字键盘让位于稳定性）
 *   - 无 confirm-type 的补 confirm-type="done"（非 return 值：回车不换行且触发 confirm）
 *   - 追加 show-confirm-bar="{{false}}" disable-default-padding="{{true}}" data-single="1"
 *     （data-single 供 composer-input-behavior 过滤粘贴换行）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'subpackages', 'watch-party')
const FILES = ['merchant.wxml', 'gacha.wxml', 'watch-party.wxml', 'merchant-edit.wxml']

let total = 0
for (const f of FILES) {
  const p = path.join(ROOT, f)
  let src = fs.readFileSync(p, 'utf8')
  let count = 0
  src = src.replace(/<input\b([\s\S]*?)\/>/g, (m, attrs) => {
    count++
    let a = attrs
    a = a.replace(/\s*always-embed="\{\{true\}\}"/g, '')
    a = a.replace(/\s*type="(?:text|number|digit|idcard|safe-password|nickname)"/g, '')
    const extra = []
    if (!/confirm-type="/.test(a)) extra.push('confirm-type="done"')
    extra.push('show-confirm-bar="{{false}}"', 'disable-default-padding="{{true}}"', 'data-single="1"')
    // 统一在结尾追加；保持原有换行缩进风格不动
    a = a.replace(/\s*$/, ' ') + extra.join(' ') + ' '
    return '<textarea' + a + '/>'
  })
  fs.writeFileSync(p, src, 'utf8')
  console.log(`${f}: ${count} 个 input → textarea`)
  total += count
}
console.log(`共转换 ${total} 个（预期 27）`)
