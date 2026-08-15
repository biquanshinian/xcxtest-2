/**
 * 商家中心「我也有观礼点位，想合作」卡片 — 静态冒烟
 * 运行：node scripts/_tmp_smoke_merchant_coop_card.js
 *
 * 覆盖：wxml 结构/绑定 ↔ js 处理器 ↔ wxss 类名 ↔ api 路由 ↔ 云端自动入驻链路
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = 0

function ok(cond, msg) {
  if (cond) {
    console.log('OK', msg)
  } else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const wxml = read('subpackages/watch-party/merchant.wxml')
const js = read('subpackages/watch-party/merchant.js')
const wxss = read('subpackages/watch-party/merchant.wxss')
const api = read('subpackages/watch-party/utils/api.js')
const cloud = read('cloudfunctions/adminGateway/watchParty.js')
const gateway = read('cloudfunctions/adminGateway/index.js')

// ── wxml：卡片在未绑定分支内，含标题/展开/表单/提交 ──
const unboundBlock = wxml.split('wx:elif="{{!bound}}"')[1] || ''
const unboundView = unboundBlock.split('<!-- 已绑定')[0] || ''
ok(unboundView.includes('wpm-coop-card'), 'wxml 合作卡在未绑定分支内')
ok(unboundView.includes('我也有观礼点位，想合作'), 'wxml 卡片标题文案')
ok(unboundView.includes('onCoopToggle'), 'wxml 展开/收起绑定')
ok(unboundView.includes('onSubmitCoop'), 'wxml 提交绑定')
ok(unboundView.includes('wx:if="{{coopOpen}}"'), 'wxml 表单按 coopOpen 展开')
;['coopForm.name', 'coopForm.contactName', 'coopForm.phone', 'coopForm.location', 'coopForm.note']
  .forEach((p) => {
    ok(unboundView.includes(`data-path="${p}"`), 'wxml 表单字段 ' + p)
  })
ok(unboundView.includes('onUploadCoopWechatQr'), 'wxml 合作申请可上传微信好友码')
ok(!/data-path="coopForm\.[\w.]+"[^>]*bindinput="(?!onTextInput)/.test(unboundView),
  'wxml 表单输入统一走 onTextInput')
ok((unboundView.match(/data-single="1"/g) || []).length >= 4, 'wxml 单行输入带 data-single')

// ── js：状态 + 校验 + 提交链路 ──
ok(js.includes('coopOpen: false') && js.includes('coopSubmitting: false'), 'js coop 状态字段')
ok(/coopForm:\s*\{ name: '', contactName: '', phone: '', wechatQr: '', location: '', note: '' \}/.test(js),
  'js coopForm 初始结构（含微信好友码）')
ok(js.includes('onCoopToggle()'), 'js onCoopToggle')
ok(js.includes('onSubmitCoop()'), 'js onSubmitCoop')
ok(/^1\\d\{10\}/.test('') || js.includes('/^1\\d{10}$/.test(phone)'), 'js 手机号校验')
ok(js.includes('watchParty.applyMerchantCooperation({'), 'js 调 applyMerchantCooperation')
const submitBody = js.split('onSubmitCoop()')[1].split('onUnbind()')[0]
ok(submitBody.includes('this.loadMe()'), 'js 提交成功后刷新为已绑定视图')
ok(submitBody.includes('入驻成功') && submitBody.includes('merchantCode'), 'js 成功弹窗带商家编号')
ok(submitBody.includes('4002'), 'js 手机号重复等业务拦截弹窗')
ok(!submitBody.includes('refMerchantId'), 'js 商家中心入口不带推荐归属')

// ── wxss：wxml 用到的 coop 类全部有定义 ──
const usedClasses = new Set()
{
  const re = /class="([^"]+)"/g
  let m
  while ((m = re.exec(unboundView))) {
    m[1].split(/\s+/).forEach((c) => {
      if (c.startsWith('wpm-coop')) usedClasses.add(c)
    })
  }
}
usedClasses.forEach((c) => {
  ok(wxss.includes('.' + c), 'wxss 定义 .' + c)
})
ok(wxss.includes('.theme-light .wpm-coop-input'), 'wxss 亮色主题输入字色')

// ── api → 云端路由 → 自动入驻 ──
ok(/function applyMerchantCooperation\(body\)\s*\{\s*return callOnce\('\/watch-party\/merchant-apply', 'POST', body\)/.test(api),
  'api 走 /watch-party/merchant-apply POST')
ok(gateway.includes("path === '/watch-party/merchant-apply' && method === 'POST'"),
  '网关路由注册')
ok(cloud.includes('async function applyMerchantLead'), '云端 applyMerchantLead 存在')
const leadFn = cloud.split('async function applyMerchantLead')[1].split('\n  }\n')[0]
ok(leadFn.includes("status: 'active'"), '云端自动创建 active 商家（免审核）')
ok(leadFn.includes("status: 'approved'"), '云端申请单直接置 approved')
ok(leadFn.includes('staffOpenids: [openid]'), '云端自动绑定申请人微信')
ok(leadFn.includes('autoApproved: true'), '云端返回 autoApproved')
ok(leadFn.includes('genUniqueMerchantCode'), '云端自动发商家编号')

console.log(failed ? `\n${failed} failed` : '\nall green: merchant coop card smoke passed')
process.exit(failed ? 1 : 0)
