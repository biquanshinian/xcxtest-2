/**
 * 审计：删除类操作全部有二次确认，且文案说明影响、语气友好（含宽心提示）
 * 检查方式：提取各删除函数体，断言其中调用了 _confirmRemove / showModal，
 * 并抽查关键文案要素（「保存后生效」「不受影响」「再想想」等）。
 * 运行：node scripts/_tmp_audit_delete_confirm.js
 */
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`, extra || '') }
}

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
}

/** 提取 `name(...) { ... }` 方法体（按大括号配平；注意参数可能含解构 `{`，须从签名结束处定位函数体） */
function methodBody(src, name) {
  const re = new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`)
  const idx = src.search(re)
  if (idx < 0) return ''
  const sig = src.slice(idx).match(re)[0]
  let i = idx + sig.length - 1
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(i, j + 1)
    }
  }
  return ''
}

console.log('── merchant-edit.js：编辑页 6 处移除全部走 _confirmRemove ──')
const edit = read('subpackages/watch-party/merchant-edit.js')
;['onRemoveParking', 'onRemoveImage', 'onRemoveSitePhoto', 'onRemoveSiteVideo', 'onRemovePrize', 'onRemoveWechatQr'].forEach((fn) => {
  const body = methodBody(edit, fn)
  assert(`${fn} 有二次确认`, body.includes('_confirmRemove'), body.slice(0, 80))
})
const helper = methodBody(edit, '_confirmRemove')
assert('确认框有「再想想」取消按钮', helper.includes('再想想'))
assert('确认框卸载保护', helper.includes('_unloaded'))
assert('空白停车点直接删不打扰', methodBody(edit, 'onRemoveParking').includes('isBlank'))
assert('空白奖品行直接删不打扰', methodBody(edit, 'onRemovePrize').includes('isBlank'))
assert('奖品文案：已抽中不受影响', edit.includes('已经抽中它的顾客不受影响'))
assert('编辑页文案说明「保存后生效」', (edit.match(/保存后生效/g) || []).length >= 6)

console.log('── merchant.js：头像移除 + 删除场次 ──')
const merchant = read('subpackages/watch-party/merchant.js')
assert('移除头像走确认', methodBody(merchant, 'onAvatarTap').includes('_confirmRemoveAvatar'))
const avatarConfirm = methodBody(merchant, '_confirmRemoveAvatar')
assert('头像确认文案含宽心提示', avatarConfirm.includes('随时可以再上传'))
const delSession = methodBody(merchant, 'onDeleteSession')
assert('删除场次有确认框', delSession.includes('showModal'))
assert('文案说明资料会一并清理', delSession.includes('一并清理'))
assert('文案说明记录保留不受影响', delSession.includes('不受影响'))
assert('取消按钮「再想想」', delSession.includes('再想想'))

console.log('── watch-party.js：顾客取消预约 ──')
const wp = read('subpackages/watch-party/watch-party.js')
const cancel = methodBody(wp, 'onCancelReserve')
assert('取消预约有确认框', cancel.includes('showModal'))
assert('文案说明名额释放 + 可重新预约', cancel.includes('重新预约'))

console.log(failed ? `\n${failed} 项未通过 / ${passed + failed}` : `\n全部通过（${passed} 项）`)
process.exit(failed ? 1 : 0)
