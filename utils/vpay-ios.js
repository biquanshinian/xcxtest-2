/**
 * 虚拟支付 iOS 端前置校验（纯函数，便于单测）
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html
 */

function compareVersion(v1, v2) {
  if (typeof v1 !== 'string' || typeof v2 !== 'string') return 0
  const a = v1.split('.')
  const b = v2.split('.')
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const n1 = parseInt(a[i] || '0', 10)
    const n2 = parseInt(b[i] || '0', 10)
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

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

function isApplePayPlatform(platform) {
  return normalizePayPlatform(platform) === 'ios'
}

function parseIOSVersion(system) {
  const m = String(system || '').match(/ios\s*([\d.]+)/i)
  return m ? m[1] : ''
}

function canCallRequestVirtualPayment(info) {
  const sdk = String((info && info.sdkVersion) || '')
  if (sdk && compareVersion(sdk, '2.19.2') >= 0) return true
  try {
    if (typeof wx !== 'undefined') {
      if (typeof wx.canIUse === 'function' && wx.canIUse('requestVirtualPayment')) return true
      if (typeof wx.requestVirtualPayment === 'function') return true
    }
  } catch (e) {}
  return false
}

/**
 * 读取支付所需的设备 / 客户端信息。优先非废弃 API。
 */
function collectPayClientInfo() {
  const info = {
    platform: '',
    system: '',
    wechatVersion: '',
    sdkVersion: '',
    canUseVirtualPayment: false
  }
  try {
    if (typeof wx !== 'undefined' && typeof wx.getDeviceInfo === 'function') {
      const d = wx.getDeviceInfo() || {}
      info.platform = d.platform || ''
      info.system = d.system || ''
    }
  } catch (e) {}
  try {
    if (typeof wx !== 'undefined' && typeof wx.getAppBaseInfo === 'function') {
      const a = wx.getAppBaseInfo() || {}
      info.wechatVersion = a.version || ''
      info.sdkVersion = a.SDKVersion || ''
    }
  } catch (e) {}
  if (!info.platform || !info.system || !info.wechatVersion || !info.sdkVersion) {
    try {
      if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
        const sys = wx.getSystemInfoSync() || {}
        if (!info.platform) info.platform = sys.platform || ''
        if (!info.system) info.system = sys.system || ''
        if (!info.wechatVersion) info.wechatVersion = sys.version || ''
        if (!info.sdkVersion) info.sdkVersion = sys.SDKVersion || ''
      }
    } catch (e) {}
  }
  info.platform = normalizePayPlatform(info.platform) || String(info.platform || '').toLowerCase()
  info.canUseVirtualPayment = canCallRequestVirtualPayment(info)
  return info
}

/**
 * iOS 端 Apple 支付前置条件。非 iOS 一律放行。
 * 版本读不到时不拦截（避免误伤），由微信侧返回明确错误。
 *
 * @param {{ platform?: string, wechatVersion?: string, system?: string, sdkVersion?: string, canUseVirtualPayment?: boolean }} info
 */
function checkIOSPayReady(info) {
  if (!isApplePayPlatform(info && info.platform)) {
    return { ok: true, error: '', message: '' }
  }
  if (info && info.canUseVirtualPayment === false) {
    return {
      ok: false,
      error: 'unsupported',
      message: '当前微信版本不支持虚拟支付，请升级微信后再试'
    }
  }
  const sdk = String((info && info.sdkVersion) || '')
  if (sdk && compareVersion(sdk, '2.19.2') < 0 && info.canUseVirtualPayment !== true) {
    return {
      ok: false,
      error: 'sdk_too_old',
      message: '当前基础库不支持虚拟支付，请升级微信后再试'
    }
  }
  const wechat = String((info && info.wechatVersion) || '')
  if (wechat && compareVersion(wechat, '8.0.68') < 0) {
    return {
      ok: false,
      error: 'wechat_too_old',
      message: 'iOS 虚拟支付需要微信 8.0.68 及以上版本，请先升级微信'
    }
  }
  const iosVer = parseIOSVersion(info && info.system)
  if (iosVer && compareVersion(iosVer, '15') < 0) {
    return {
      ok: false,
      error: 'ios_too_old',
      message: 'iOS 虚拟支付需要系统 iOS 15 及以上，请先升级系统'
    }
  }
  return { ok: true, error: '', message: '' }
}

function stripWxApiFailPrefix(msg) {
  return String(msg || '').replace(/^[a-zA-Z.]+:fail\s*/i, '').trim()
}

/**
 * 将 requestVirtualPayment fail 回调转成用户可读文案，避免把 API 名直接展示出来。
 * @returns {{ cancelled?: boolean, title?: string, error?: string }}
 */
function friendlyVPayError(e) {
  const errCode = e && (e.errCode != null ? e.errCode : e.errno)
  const raw = String((e && (e.errMsg || e.message)) || '')
  const msg = stripWxApiFailPrefix(raw)

  if (errCode === -2 || /cancel/i.test(raw) || msg.indexOf('取消') !== -1) {
    return { cancelled: true }
  }
  if (errCode === -15007) {
    return { title: '暂无法支付', error: '登录已过期，请关闭页面后重试' }
  }
  if (errCode === -15011) {
    return { title: '暂无法支付', error: '当前支付环境暂不可用，请稍后再试' }
  }
  if (errCode === -15010) {
    return { title: '暂无法支付', error: '该套餐暂未开放购买，请稍后再试' }
  }
  if (errCode === -4) {
    return { title: '暂无法支付', error: '支付未通过校验，请稍后再试' }
  }
  if (/非中国大陆|非大陆地区/.test(msg)) {
    return {
      title: '需要中国大陆账户',
      error: '当前 Apple ID 不是中国大陆区账户，暂时无法开通。请在 iPhone 设置中切换到中国大陆 App Store 账户后再试。'
    }
  }
  if (/App Store 暂无法完成充值/.test(msg)) {
    return {
      title: '暂无法支付',
      error: 'App Store 暂时无法完成支付。请确认使用中国大陆 Apple 账户后，稍后再试。'
    }
  }
  return {
    title: '暂无法支付',
    error: msg || '支付未完成，请稍后重试'
  }
}

module.exports = {
  compareVersion,
  normalizePayPlatform,
  isApplePayPlatform,
  parseIOSVersion,
  canCallRequestVirtualPayment,
  collectPayClientInfo,
  checkIOSPayReady,
  stripWxApiFailPrefix,
  friendlyVPayError
}
