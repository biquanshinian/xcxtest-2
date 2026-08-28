/**
 * iOS Apple 支付退款问询（纯函数）
 * 文档：虚拟支付 iOS 端接入 / 云开发虚拟支付回调
 * 事件：xpay_subscribe_ios_refund_query_notify
 */

function normalizePayPlatform(raw) {
  const p = String(raw || '').trim().toLowerCase()
  if (p === 'ios') return 'ios'
  if (p === 'android') return 'android'
  if (p === 'windows') return 'windows'
  if (p === 'mac') return 'mac'
  if (p === 'devtools') return 'devtools'
  if (p === 'ohos' || p === 'harmonyos' || p === 'harmony') return 'ohos'
  return ''
}

const IOS_MIN_PAY_CENTS = 100

function isApplePayOrder(order) {
  if (!order) return false
  if (order.payChannel === 'apple') return true
  return normalizePayPlatform(order.platform) === 'ios'
}

/** Apple 支付不支持沙箱，iOS 下单必须走现网 env=0 */
function resolveVPayEnvForPlatform(platform, configuredEnv) {
  if (normalizePayPlatform(platform) === 'ios') return 0
  return Number(configuredEnv) === 1 ? 1 : 0
}

function rejectDeveloperRefundForApplePay(order) {
  if (!isApplePayOrder(order)) return null
  return {
    error: 'Apple 支付不支持开发者主动退款，请引导用户在 App Store 申请退款'
  }
}

function pickIosRefundQueryFields(event) {
  const nested = event && (event.WxaVirtualPayIosRefundQueryNotifyEvent || event.IosRefundQuery)
  const src = nested || event || {}
  return {
    payOrderId: String(
      src.pay_order_id ||
      src.PayOrderId ||
      src.OutTradeNo ||
      src.out_trade_no ||
      (event && (event.OutTradeNo || event.out_trade_no || event.pay_order_id)) ||
      ''
    ),
    productId: String(src.product_id || src.ProductId || (event && event.product_id) || ''),
    provideStatus: String(src.provide_status || src.ProvideStatus || (event && event.provide_status) || ''),
    channelBill: String(src.channel_bill || src.ChannelBill || (event && event.channel_bill) || ''),
    refundReason: String(src.refund_request_reason || src.RefundRequestReason || (event && event.refund_request_reason) || '')
  }
}

/**
 * Apple 退款问询决策。result_code: 0 建议退款，1 拒绝退款。
 * evidence 必填，用于退款审计。
 */
function decideIosRefundQuery(order) {
  if (!order) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '本地未找到对应支付订单，视为未发货，建议退款'
    }
  }
  const status = String(order.status || '')
  if (status === 'refunded' || status === 'refund_pending') {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '该订单已处于退款流程或已退款完成，建议退款'
    }
  }
  if (status === 'pending' || status === 'cancelled' || status === 'failed' || !order.deliveredAt) {
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '订单尚未完成发货，数字内容未开通，建议退款'
    }
  }
  if (order.orderType === 'subscription') {
    return {
      result_code: 1,
      result_info: '拒绝退款',
      evidence: '数字内容已发货：星际通行证权益已即时开通并生效，购买页已注明购买后权益即时到账'
    }
  }
  return {
    result_code: 1,
    result_info: '拒绝退款',
    evidence: '数字内容已发货：功能已永久解锁到用户账号，购买页已注明购买后即时到账'
  }
}

function buildIosRefundQueryResponse(decision) {
  const resultCode = decision && Number(decision.result_code) === 1 ? 1 : 0
  const evidence = String((decision && decision.evidence) || '已根据发货状态给出退款建议')
  return {
    ErrCode: 0,
    ErrMsg: 'success',
    IosRefundQueryResponse: {
      result_code: resultCode,
      result_info: String((decision && decision.result_info) || (resultCode === 1 ? '拒绝退款' : '建议退款')),
      evidence: evidence
    }
  }
}

module.exports = {
  IOS_MIN_PAY_CENTS,
  normalizePayPlatform,
  isApplePayOrder,
  resolveVPayEnvForPlatform,
  rejectDeveloperRefundForApplePay,
  pickIosRefundQueryFields,
  decideIosRefundQuery,
  buildIosRefundQueryResponse
}
