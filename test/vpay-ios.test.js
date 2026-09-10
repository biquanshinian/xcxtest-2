const test = require('node:test')
const assert = require('node:assert/strict')
const {
  compareVersion,
  normalizePayPlatform,
  isApplePayPlatform,
  parseIOSVersion,
  checkIOSPayReady,
  stripWxApiFailPrefix,
  friendlyVPayError
} = require('../utils/vpay-ios.js')
const {
  isApplePayOrder,
  pickIosRefundQueryFields,
  decideIosRefundQuery,
  buildIosRefundQueryResponse,
  resolveVPayEnvForPlatform,
  rejectDeveloperRefundForApplePay
} = require('../cloudfunctions/membership/ios-refund-query.js')

test('compareVersion 按位比较', () => {
  assert.equal(compareVersion('8.0.68', '8.0.68'), 0)
  assert.equal(compareVersion('8.0.69', '8.0.68'), 1)
  assert.equal(compareVersion('8.0.67', '8.0.68'), -1)
  assert.equal(compareVersion('8.0.68.1', '8.0.68'), 1)
  assert.equal(compareVersion('15', '15.0'), 0)
  assert.equal(compareVersion('14.8', '15'), -1)
})

test('normalizePayPlatform 只接受已知平台', () => {
  assert.equal(normalizePayPlatform('iOS'), 'ios')
  assert.equal(normalizePayPlatform('android'), 'android')
  assert.equal(normalizePayPlatform('harmonyos'), 'ohos')
  assert.equal(normalizePayPlatform('iphone'), '')
  assert.equal(isApplePayPlatform('ios'), true)
  assert.equal(isApplePayPlatform('android'), false)
})

test('parseIOSVersion 从 system 字段取出版本', () => {
  assert.equal(parseIOSVersion('iOS 16.6.1'), '16.6.1')
  assert.equal(parseIOSVersion('iOS 15.0'), '15.0')
  assert.equal(parseIOSVersion('Android 14'), '')
})

test('非 iOS 不拦支付', () => {
  assert.equal(checkIOSPayReady({ platform: 'android' }).ok, true)
  assert.equal(checkIOSPayReady({ platform: 'windows' }).ok, true)
})

test('iOS 微信过低或系统过低时拦截', () => {
  const tooOldWechat = checkIOSPayReady({
    platform: 'ios',
    wechatVersion: '8.0.67',
    system: 'iOS 16.0',
    canUseVirtualPayment: true
  })
  assert.equal(tooOldWechat.ok, false)
  assert.equal(tooOldWechat.error, 'wechat_too_old')

  const tooOldIos = checkIOSPayReady({
    platform: 'ios',
    wechatVersion: '8.0.68',
    system: 'iOS 14.8',
    canUseVirtualPayment: true
  })
  assert.equal(tooOldIos.ok, false)
  assert.equal(tooOldIos.error, 'ios_too_old')
})

test('iOS 满足微信 8.0.68 与系统 15 时放行', () => {
  const ready = checkIOSPayReady({
    platform: 'ios',
    wechatVersion: '8.0.68',
    system: 'iOS 15.0',
    sdkVersion: '3.5.0',
    canUseVirtualPayment: true
  })
  assert.equal(ready.ok, true)
})

test('iOS 版本读不到时不误拦', () => {
  const ready = checkIOSPayReady({ platform: 'ios', canUseVirtualPayment: true })
  assert.equal(ready.ok, true)
})

test('isApplePayOrder 认 payChannel 与 platform', () => {
  assert.equal(isApplePayOrder({ payChannel: 'apple' }), true)
  assert.equal(isApplePayOrder({ platform: 'ios' }), true)
  assert.equal(isApplePayOrder({ payChannel: 'wechat', platform: 'android' }), false)
  assert.equal(isApplePayOrder(null), false)
})

test('pickIosRefundQueryFields 兼容 snake / Pascal 与嵌套', () => {
  assert.equal(pickIosRefundQueryFields({ pay_order_id: 'M1' }).payOrderId, 'M1')
  assert.equal(pickIosRefundQueryFields({ PayOrderId: 'M2' }).payOrderId, 'M2')
  assert.equal(pickIosRefundQueryFields({
    WxaVirtualPayIosRefundQueryNotifyEvent: { pay_order_id: 'M3', provide_status: '1' }
  }).payOrderId, 'M3')
})

test('未发货或找不到订单时建议退款', () => {
  assert.equal(decideIosRefundQuery(null).result_code, 0)
  assert.equal(decideIosRefundQuery({ status: 'pending' }).result_code, 0)
  assert.equal(decideIosRefundQuery({ status: 'paid' }).result_code, 0)
  assert.equal(decideIosRefundQuery({ status: 'refunded', deliveredAt: 'x' }).result_code, 0)
})

test('已发货的数字内容拒绝退款，且应答含必填 evidence', () => {
  const sub = decideIosRefundQuery({
    status: 'paid',
    deliveredAt: '2026-08-01',
    orderType: 'subscription'
  })
  assert.equal(sub.result_code, 1)
  assert.ok(sub.evidence.length > 8)

  const prod = decideIosRefundQuery({
    status: 'paid',
    deliveredAt: '2026-08-01',
    orderType: 'product'
  })
  assert.equal(prod.result_code, 1)

  const body = buildIosRefundQueryResponse(sub)
  assert.equal(body.ErrCode, 0)
  assert.equal(body.ErrMsg, 'success')
  assert.equal(body.IosRefundQueryResponse.result_code, 1)
  assert.ok(body.IosRefundQueryResponse.evidence)
  assert.equal(body.errcode, undefined)
  assert.equal(body.errmsg, undefined)
})

test('iOS 下单强制现网 env=0，安卓跟随配置', () => {
  assert.equal(resolveVPayEnvForPlatform('ios', 1), 0)
  assert.equal(resolveVPayEnvForPlatform('ios', 0), 0)
  assert.equal(resolveVPayEnvForPlatform('android', 1), 1)
  assert.equal(resolveVPayEnvForPlatform('android', 0), 0)
  assert.equal(resolveVPayEnvForPlatform('windows', 1), 1)
  assert.equal(resolveVPayEnvForPlatform('', 1), 1)
})

test('stripWxApiFailPrefix 去掉接口名前缀', () => {
  assert.equal(
    stripWxApiFailPrefix('requestVirtualPayment:fail 暂不支持非中国大陆地区苹果账号支付。'),
    '暂不支持非中国大陆地区苹果账号支付。'
  )
  assert.equal(stripWxApiFailPrefix('暂无法完成支付'), '暂无法完成支付')
})

test('friendlyVPayError 把非大陆 Apple 账户说成人话', () => {
  const mapped = friendlyVPayError({
    errMsg: 'requestVirtualPayment:fail 暂不支持非中国大陆地区苹果账号支付。'
  })
  assert.equal(mapped.title, '需要中国大陆账户')
  assert.equal(mapped.error.indexOf('requestVirtualPayment'), -1)
  assert.ok(mapped.error.indexOf('中国大陆') !== -1)
  assert.ok(mapped.error.indexOf('App Store') !== -1)
})

test('friendlyVPayError 用户取消仍标 cancelled', () => {
  assert.equal(friendlyVPayError({ errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' }).cancelled, true)
})

test('Apple 支付订单禁止开发者主动退款', () => {
  const apple = rejectDeveloperRefundForApplePay({ payChannel: 'apple' })
  assert.ok(apple && apple.error)
  assert.match(apple.error, /App Store/)

  const iosPlat = rejectDeveloperRefundForApplePay({ platform: 'ios' })
  assert.ok(iosPlat && iosPlat.error)

  assert.equal(rejectDeveloperRefundForApplePay({ payChannel: 'wechat', platform: 'android' }), null)
  assert.equal(rejectDeveloperRefundForApplePay(null), null)
})
