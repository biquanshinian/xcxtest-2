/**
 * 商家微信好友二维码联系 — 静态冒烟
 * 运行：node scripts/_tmp_smoke_merchant_wechat_contact.js
 *
 * 覆盖：入驻/资料/场次上传二维码 → 云端 contactWechatQr → 顾客页弹层长按识别
 * 约束：小程序不能直接跳转加好友，合规路径是展示二维码 + show-menu-by-longpress。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
let failed = 0

function ok(cond, msg) {
  if (cond) console.log('OK', msg)
  else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const cloud = read('cloudfunctions/adminGateway/watchParty.js')
const wpJs = read('subpackages/watch-party/watch-party.js')
const wpWxml = read('subpackages/watch-party/watch-party.wxml')
const merchantJs = read('subpackages/watch-party/merchant.js')
const merchantWxml = read('subpackages/watch-party/merchant.wxml')
const applyJs = read('subpackages/watch-party/merchant-apply.js')
const applyWxml = read('subpackages/watch-party/merchant-apply.wxml')
const editJs = read('subpackages/watch-party/merchant-edit.js')
const editWxml = read('subpackages/watch-party/merchant-edit.wxml')
const adminVue = read('admin-web/src/views/WatchPartyMerchantsPage.vue')

// ── 云端 ──
ok(cloud.includes('function sanitizeContactWechatQr'), '云端 sanitizeContactWechatQr')
ok(cloud.includes('out.contactWechatQr = sanitizeContactWechatQr'), '场次 body 含 contactWechatQr')
ok(cloud.includes('contactWechatQr: sanitizeContactWechatQr(doc.contactWechatQr)'), '公开视图透出 contactWechatQr')
ok(cloud.includes('const wechatQr = sanitizeContactWechatQr'), '入驻申请读 wechatQr')
ok(cloud.includes('contactWechatQr: wechatQr'), '入驻创建商家写入 contactWechatQr')
ok(cloud.includes('const contactWechatQr = sanitizeContactWechatQr(body.contactWechatQr)'), '资料更新读 contactWechatQr')
ok(cloud.includes('sessionPatch.contactWechatQr = contactWechatQr'), '资料改码同步名下场次')
ok(cloud.includes('if (!data.contactWechatQr) data.contactWechatQr'), '新建场次商家资料兜底')
ok(cloud.includes('async function enrichPublicContact'), '公开接口 enrichPublicContact')
ok(cloud.includes('view.contactWechatQr = sanitizeContactWechatQr(m.contactWechatQr)'), 'enrich 回落商家二维码')
ok(!cloud.includes('sanitizeWechatId'), '已移除手动微信号 sanitizeWechatId')
ok(!/contactWechat(?!Qr)/.test(cloud.replace(/contactWechatQr/g, '')), '云端无残留 contactWechat 文本字段')

// ── 顾客页 ──
ok(wpJs.includes('contactWechatQr'), '顾客页读 contactWechatQr')
ok(wpJs.includes('_showContactWechatQr'), '顾客页弹层展示二维码')
ok(wpJs.includes("itemList: ['微信联系（扫码添加）'"), '双渠道 ActionSheet')
ok(wpWxml.includes('contactQrVisible'), 'wxml 联系二维码弹层')
ok(wpWxml.includes('show-menu-by-longpress'), '弹层图片支持长按识别')
ok(wpWxml.includes('onUploadCoopWechatQr'), '合作申请可上传好友码')
ok(!wpWxml.includes('data-path="coopForm.wechat"'), '合作申请已移除微信号文本框')
ok(!wpJs.includes('_copyMerchantWechat'), '已移除复制微信号路径')
ok(!/onContactMerchant[\s\S]{0,800}setClipboardData/.test(wpJs), '联系商家路径不再走剪贴板')

{
  const m = wpJs.match(/_buildContactUi\(session\) \{([\s\S]*?)\n  \},/)
  ok(!!m, '可抽取 _buildContactUi')
  if (m) {
    const fn = vm.runInNewContext(`(function(session) { ${m[1]} })`)
    const both = fn({ contactPhone: '13800138000', contactWechatQr: 'cloud://x/qr.png' })
    ok(both.hasContact && both.contactBtnText === '联系', '双渠道：按钮「联系」')
    ok(/扫码/.test(both.contactHint), '双渠道：副文案含扫码')
    const onlyQr = fn({ contactWechatQr: 'cloud://x/qr.png' })
    ok(onlyQr.hasContact && onlyQr.contactBtnText === '加微信', '仅二维码：按钮「加微信」')
    const onlyPhone = fn({ contactPhone: '13800138000' })
    ok(onlyPhone.hasContact && onlyPhone.contactBtnText === '拨打', '仅电话：按钮「拨打」')
    const none = fn({})
    ok(!none.hasContact, '都无：隐藏入口')
  }
}

// ── 商家端表单 ──
ok(merchantWxml.includes('onUploadProfileWechatQr'), '商家资料上传好友码')
ok(merchantWxml.includes('profileForm.contactWechatQr'), '商家资料绑定 contactWechatQr')
ok(!merchantWxml.includes('data-path="profileForm.contactWechat"'), '商家资料已移除微信号输入')
ok(merchantWxml.includes('onUploadCoopWechatQr'), '商家中心合作申请上传好友码')
ok(applyWxml.includes('onUploadWechatQr'), '入驻页上传好友码')
ok(applyJs.includes('wechatQr:'), '入驻提交 wechatQr')
ok(!applyWxml.includes('data-path="form.wechat"'), '入驻页已移除微信号输入')
ok(editWxml.includes('onUploadContactWechatQr'), '场次编辑上传好友码')
ok(editJs.includes('contactWechatQr:'), '场次保存 contactWechatQr')
ok(!editWxml.includes('data-path="form.contactWechat"'), '场次编辑已移除微信号输入')

// ── admin ──
ok(adminVue.includes('form.contactWechatQr'), '后台表单 contactWechatQr')
ok(adminVue.includes('row.contactWechatQr'), '后台列表展示二维码')
ok(!adminVue.includes('form.contactWechat ='), '后台已不用文本微信号')

console.log(failed ? `\n${failed} failed` : '\nall green: merchant wechat qr contact smoke passed')
process.exit(failed ? 1 : 0)
