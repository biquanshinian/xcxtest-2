/**
 * 会员状态管理模块
 * 管理用户的订阅状态、一次性购买记录、权限校验
 */

// 会员类型
const MEMBER_TYPE = {
  FREE: 'free',
  PRO: 'pro'
}

// 订阅计划（保留 PLANS 供 UI 展示价格；下单时按 planId 映射到 vpayProductId）
// 道具模式下「一笔订单只能买一个道具」，折扣价单独建一个道具 SKU
const PLANS = {
  MONTHLY: { id: 'monthly', name: '月卡', price: 390, days: 30, vpayProductId: 'vp_sub_monthly' },
  YEARLY: { id: 'yearly', name: '年卡', price: 3990, days: 365, vpayProductId: 'vp_sub_yearly' },
  PERMANENT: { id: 'permanent', name: '永久', price: 16800, days: 36500, vpayProductId: 'vp_sub_permanent' },
  YEARLY_DISCOUNT: { id: 'yearly_discount', name: '年卡(6折)', price: 2390, days: 365, vpayProductId: 'vp_sub_year_dc' },
  PERMANENT_DISCOUNT: { id: 'permanent_discount', name: '永久(5折)', price: 8400, days: 36500, vpayProductId: 'vp_sub_perm_dc' }
}

// 一次性购买项目（id 是会员状态里 purchases 数组的 id；vpayProductId 是虚拟支付道具 ID）
const PRODUCTS = {
  STARLINK_AR: { id: 'starlink_ar', name: '星链AR观测', price: 690, vpayProductId: 'vp_starlink_ar' },
  ARTEMIS_TELEMETRY: { id: 'artemis_telemetry', name: 'Artemis 遥测面板', price: 390, vpayProductId: 'vp_artemis_telemetry' },
  STARLINK_PRO: { id: 'starlink_pro', name: '星链高级追踪', price: 390, vpayProductId: 'vp_starlink_pro' },
  STARSHIP_FLIGHT_CHECKLIST: {
    id: 'starship_flight_checklist',
    name: '星舰飞行检查清单',
    price: 390,
    vpayProductId: 'vp_starship_chk'
  }
}

// 订阅 planId → 虚拟支付 vpayProductId 映射
function _planIdToVPayProductId(planId) {
  const list = [PLANS.MONTHLY, PLANS.YEARLY, PLANS.PERMANENT, PLANS.YEARLY_DISCOUNT, PLANS.PERMANENT_DISCOUNT]
  const hit = list.find(p => p.id === planId)
  return hit ? hit.vpayProductId : ''
}

// 一次性产品 productId → 虚拟支付 vpayProductId 映射
function _productIdToVPayProductId(productId) {
  const list = [PRODUCTS.STARLINK_AR, PRODUCTS.ARTEMIS_TELEMETRY, PRODUCTS.STARLINK_PRO, PRODUCTS.STARSHIP_FLIGHT_CHECKLIST]
  const hit = list.find(p => p.id === productId)
  return hit ? hit.vpayProductId : ''
}

// 会员图标 URL
const MEMBER_ICONS = {
  FREE: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/通行证图标/1778744099426_3r7x1v.png',
  PRO: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/通行证图标/1778744106480_5ngzmf.png'
}

// 免费用户每日限制
const FREE_LIMITS = {
  AI_CHAT: 3,
  AI_IMAGE: 1
}

// 本地缓存 key
const CACHE_KEY = '_membership_state'
const CACHE_TTL = 10 * 60 * 1000 // 10 分钟

const storageCache = require('./storage-sync-cache.js')

// 内存缓存
let _memState = null
let _memStateTs = 0
// in-flight 去重：避免预热与门控同时各发一次云函数
let _memStateInflight = null
// 请求序号：forceRefresh 会并行新起请求，旧请求完成时不得覆盖新请求的状态 / 清掉新请求的 in-flight 引用
let _memStateReqSeq = 0

/**
 * 获取当前会员状态（优先内存 → 本地缓存 → 云端查询）
 */
function getMembershipState(forceRefresh) {
  // 内存缓存
  if (!forceRefresh && _memState && (Date.now() - _memStateTs < CACHE_TTL)) {
    return Promise.resolve(_memState)
  }

  // 本地缓存
  if (!forceRefresh) {
    var cachedEntry = storageCache.readSync(CACHE_KEY, null)
    if (cachedEntry && cachedEntry.ts && (Date.now() - cachedEntry.ts < CACHE_TTL)) {
      _memState = cachedEntry.data
      _memStateTs = cachedEntry.ts
      return Promise.resolve(cachedEntry.data)
    }
  }

  // 复用 in-flight 请求
  if (_memStateInflight && !forceRefresh) {
    return _memStateInflight
  }

  // 云端查询
  var reqId = ++_memStateReqSeq
  var promise = wx.cloud.callFunction({
    name: 'membership',
    data: { action: 'getState' }
  }).then(function (res) {
    var state = (res && res.result && res.result.data) || _getDefaultState()
    // 仅最新一次请求可写入缓存（防止支付后 forceRefresh 结果被更早的旧请求覆盖回 Free）
    if (reqId === _memStateReqSeq) {
      _memState = state
      _memStateTs = Date.now()
      try {
        var payload = { data: state, ts: Date.now() }
        storageCache.persistAsync(CACHE_KEY, payload)
      } catch (e) {}
    }
    return state
  }).catch(function () {
    // 网络失败时返回未过期的本地缓存，否则默认状态（不返回可能已过期的 Pro 态）
    if (_memState && (Date.now() - _memStateTs < CACHE_TTL)) return _memState
    return _getDefaultState()
  }).then(function (state) {
    if (_memStateInflight === promise) _memStateInflight = null
    return state
  }, function (err) {
    if (_memStateInflight === promise) _memStateInflight = null
    throw err
  })

  _memStateInflight = promise
  return promise
}

/**
 * 判断是否为 Pro 会员（未过期）
 */
function isPro(state) {
  if (!state) return false
  if (state.type !== MEMBER_TYPE.PRO) return false
  if (!state.expireAt) return false
  return new Date(state.expireAt).getTime() > Date.now()
}

/**
 * 判断是否已购买某个一次性产品
 */
function hasPurchased(state, productId) {
  if (!state || !state.purchases) return false
  return state.purchases.indexOf(productId) !== -1
}

/**
 * 检查 AI 聊天今日剩余次数
 */
function getAiChatRemaining(state) {
  if (isPro(state)) return -1 // -1 表示无限
  var today = _todayStr()
  var used = (state && state.aiChatUsed && state.aiChatUsed[today]) || 0
  return Math.max(0, FREE_LIMITS.AI_CHAT - used)
}

/**
 * 检查 AI 图片识别今日剩余次数
 */
function getAiImageRemaining(state) {
  if (isPro(state)) return -1
  var today = _todayStr()
  var used = (state && state.aiImageUsed && state.aiImageUsed[today]) || 0
  return Math.max(0, FREE_LIMITS.AI_IMAGE - used)
}

/**
 * 记录一次 AI 使用（本地 + 云端）
 * @param {'aiChat'|'aiImage'} usageType
 */
async function _recordUsage(usageType) {
  var field = usageType === 'aiImage' ? 'aiImageUsed' : 'aiChatUsed'
  var today = _todayStr()
  var appliedLocal = false
  if (_memState) {
    if (!_memState[field]) _memState[field] = {}
    _memState[field][today] = (_memState[field][today] || 0) + 1
    appliedLocal = true
    try { storageCache.persistAsync(CACHE_KEY, { data: _memState, ts: Date.now() }) } catch (e) {}
  }
  try {
    await wx.cloud.callFunction({
      name: 'membership',
      data: { action: 'recordUsage', usageType: usageType }
    })
  } catch (e) {
    // 云端记录失败则回滚本地乐观计数，保持与云端对账一致
    if (appliedLocal && _memState && _memState[field] && _memState[field][today] > 0) {
      _memState[field][today] -= 1
      try { storageCache.persistAsync(CACHE_KEY, { data: _memState, ts: Date.now() }) } catch (e2) {}
    }
  }
}

/**
 * 记录一次 AI 聊天使用
 */
async function recordAiChatUse() {
  return _recordUsage('aiChat')
}

/**
 * 记录一次 AI 图片识别使用
 */
async function recordAiImageUse() {
  return _recordUsage('aiImage')
}

/**
 * 同步获取 Pro 状态（命中缓存即返回，不命中则触发后台刷新）
 */
function isProSync() {
  const cached = _readStateFromCache()
  if (cached) return isPro(cached)
  getMembershipState().catch(function () {})
  return false
}

/**
 * 通用：调用 wx.requestVirtualPayment 走道具直购流程
 * 返回 { success, cancelled, error }
 */
function _wxLogin() {
  return new Promise(function (resolve) {
    wx.login({
      success: function (res) { resolve((res && res.code) || '') },
      fail: function () { resolve('') }
    })
  })
}

// iOS 端暂未接入 IAP，前端拦截避免下单报错；同时 gateCheck 走免费放行
// 优先 wx.getDeviceInfo（基础库 2.20.1+，非废弃 API），回退 getSystemInfoSync
function isIOS() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const d = wx.getDeviceInfo()
      if (d && d.platform) return d.platform === 'ios'
    }
  } catch (e) {}
  try {
    const sys = wx.getSystemInfoSync()
    return !!(sys && sys.platform === 'ios')
  } catch (e) {
    return false
  }
}

async function _purchaseByVPayProductId(vpayProductId) {
  if (!vpayProductId) {
    return { success: false, error: '配置缺失' }
  }
  if (isIOS()) {
    wx.showModal({
      title: 'iOS暂不支持付费',
      content:
        '由于苹果对虚拟商品收取30%平台税，本小程序未在iOS端开通付费。\n\n' +
        '你可以这样省30%：\n' +
        '① 用Windows/Mac电脑微信扫码登录\n' +
        '② 在电脑微信里打开「火星探索日志」\n' +
        '③ 选择套餐完成支付\n\n' +
        '同账号PRO权益自动同步到iOS端。',
      confirmText: '我知道了',
      showCancel: false
    })
    return { success: false, error: 'ios_not_supported' }
  }
  if (typeof wx.requestVirtualPayment !== 'function') {
    return { success: false, error: '当前版本不支持虚拟支付，请升级微信' }
  }

  const code = await _wxLogin()
  if (!code) return { success: false, error: '获取登录态失败' }

  let res
  try {
    res = await wx.cloud.callFunction({
      name: 'membership',
      data: { action: 'createVPayOrder', vpayProductId: vpayProductId, code: code }
    })
  } catch (e) {
    return { success: false, error: '下单失败，请稍后再试' }
  }
  const result = (res && res.result) || {}
  if (!result.signData || !result.paySig || !result.signature) {
    return { success: false, error: result.error || '下单失败' }
  }

  const outTradeNo = result.outTradeNo

  // 调起虚拟支付
  return new Promise(function (resolve) {
    wx.requestVirtualPayment({
      mode: 'short_series_goods',
      signData: result.signData,
      paySig: result.paySig,
      signature: result.signature,
      success: async function () {
        // success 是弱确认，强制以后端查单为准
        try {
          await wx.cloud.callFunction({
            name: 'membership',
            data: { action: 'queryVPayOrder', outTradeNo: outTradeNo }
          })
        } catch (e) {}
        await getMembershipState(true)
        resolve({ success: true, outTradeNo: outTradeNo })
      },
      fail: function (e) {
        const msg = (e && e.errMsg) || ''
        if (msg.indexOf('cancel') !== -1) {
          return resolve({ success: false, cancelled: true })
        }
        resolve({ success: false, error: msg || '支付失败' })
      }
    })
  })
}

/**
 * 发起订阅购买（虚拟支付道具直购）
 */
async function purchaseSubscription(planId) {
  const vpayProductId = _planIdToVPayProductId(planId)
  if (!vpayProductId) return { success: false, error: '无效的订阅计划' }
  return _purchaseByVPayProductId(vpayProductId)
}

/**
 * 发起一次性购买（虚拟支付道具直购）
 */
async function purchaseProduct(productId) {
  const vpayProductId = _productIdToVPayProductId(productId)
  if (!vpayProductId) return { success: false, error: '无效的产品' }
  return _purchaseByVPayProductId(vpayProductId)
}

/**
 * 清除本地缓存（登出时调用）
 */
function clearCache() {
  _memState = null
  _memStateTs = 0
  _memStateInflight = null
  _membershipEnabled = null
  _membershipEnabledTs = 0
  _membershipEnabledInflight = null
  storageCache.invalidate(CACHE_KEY)
  storageCache.invalidate(SWITCH_CACHE_KEY)
  try { wx.removeStorage({ key: CACHE_KEY, fail: function () {} }) } catch (e) {}
  try { wx.removeStorage({ key: SWITCH_CACHE_KEY, fail: function () {} }) } catch (e) {}
}

/**
 * 同步读取「会员开关」缓存（内存 → 本地缓存），未命中返回 null
 */
function _readEnabledFromCache() {
  if (_membershipEnabled !== null && (Date.now() - _membershipEnabledTs < SWITCH_TTL)) {
    return _membershipEnabled
  }
  try {
    var cached = storageCache.readMemOrSync(SWITCH_CACHE_KEY, null)
    if (cached && cached.ts && (Date.now() - cached.ts < SWITCH_TTL)) {
      _membershipEnabled = cached.value
      _membershipEnabledTs = cached.ts
      return cached.value
    }
  } catch (e) {}
  return null
}

/**
 * 同步读取「会员状态」缓存（内存 → 本地缓存），未命中返回 null
 */
function _readStateFromCache() {
  if (_memState && (Date.now() - _memStateTs < CACHE_TTL)) {
    return _memState
  }
  var cachedEntry = storageCache.readSync(CACHE_KEY, null)
  if (cachedEntry && cachedEntry.ts && (Date.now() - cachedEntry.ts < CACHE_TTL)) {
    _memState = cachedEntry.data
    _memStateTs = cachedEntry.ts
    return cachedEntry.data
  }
  return null
}

function warmMembershipStateSync() {
  return _readStateFromCache()
}

function warmMembershipStateAsync() {
  if (_memState && (Date.now() - _memStateTs < CACHE_TTL)) {
    return Promise.resolve(_memState)
  }
  if (storageCache.isLoaded(CACHE_KEY)) {
    return Promise.resolve(_readStateFromCache() || _getDefaultState())
  }
  return storageCache.warmAsync(CACHE_KEY, null).then(function (entry) {
    if (entry && entry.ts && entry.data && (Date.now() - entry.ts < CACHE_TTL)) {
      _memState = entry.data
      _memStateTs = entry.ts
      return entry.data
    }
    return _memState || _getDefaultState()
  })
}

/**
 * 显示购买引导弹窗；选「看广告」且看完则返回 true（临时放行）
 */
function _showPurchaseDialog(productId, productName) {
  var adUnlock = require('./ad-unlock.js')
  var priceText = ''
  var productKeys = Object.keys(PRODUCTS)
  for (var i = 0; i < productKeys.length; i++) {
    if (PRODUCTS[productKeys[i]].id === productId) {
      priceText = (PRODUCTS[productKeys[i]].price / 100).toFixed(1)
      break
    }
  }

  var itemList = priceText
    ? [
        '开通星际通行证（全部解锁）',
        '永久购买' + (productName || '') + '（¥' + priceText + '）',
        '看广告免费体验10分钟'
      ]
    : [
        '开通星际通行证（全部解锁）',
        '看广告免费体验10分钟'
      ]

  return new Promise(function (resolve) {
    wx.showActionSheet({
      alertText: (productName || '高级功能') + '\n此功能需要解锁后使用',
      itemList: itemList,
      success: function (res) {
        var idx = res.tapIndex
        if (priceText) {
          if (idx === 0) {
            wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
            resolve(false)
            return
          }
          if (idx === 1) {
            wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership?buy=' + productId })
            resolve(false)
            return
          }
          if (idx === 2) {
            adUnlock.showRewardedAdForUnlock(productId).then(resolve)
            return
          }
        } else {
          if (idx === 0) {
            wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
            resolve(false)
            return
          }
          if (idx === 1) {
            adUnlock.showRewardedAdForUnlock(productId).then(resolve)
            return
          }
        }
        resolve(false)
      },
      fail: function () { resolve(false) }
    })
  })
}

/**
 * iOS 用户的付费拦截弹窗 — 可看广告试用；开通引导去其他端购买
 */
function _showIOSPurchaseDialog(productName, productId) {
  var adUnlock = require('./ad-unlock.js')
  return new Promise(function (resolve) {
    wx.showActionSheet({
      alertText:
        (productName || '高级功能') +
        ' · iOS暂不支持订阅\n可看广告试用，或在其他端开通后同账号同步',
      itemList: [
        '看广告免费体验10分钟',
        '了解如何开通（其他端）'
      ],
      success: function (res) {
        if (res.tapIndex === 0) {
          adUnlock.showRewardedAdForUnlock(productId || '_ios_gate').then(resolve)
          return
        }
        if (res.tapIndex === 1) {
          wx.showModal({
            title: '如何开通星际通行证',
            content:
              '由于苹果对虚拟商品收取30%平台税，本小程序未在iOS端开通付费。\n\n' +
              '① 在安卓/鸿蒙/Windows/PC端微信打开「火星探索日志」\n' +
              '② 进入「我的 → 星际通行证」选择套餐\n' +
              '③ 支付后同账号 PRO 权益自动同步回 iOS',
            confirmText: '我知道了',
            showCancel: false,
            success: function () { resolve(false) },
            fail: function () { resolve(false) }
          })
          return
        }
        resolve(false)
      },
      fail: function () { resolve(false) }
    })
  })
}

/**
 * 付费功能门控检查
 * 会员功能关闭时直接放行；开启时检查是否已购买或是 Pro 会员
 * 优化：缓存命中走 fast-path 不显示 loading；缓存 miss 时 700ms 超时 fail-open
 * @returns {boolean} true=允许访问, false=已拦截（弹窗引导购买）
 */
async function gateCheck(productId, productName) {
  var adUnlock = require('./ad-unlock.js')
  // 广告临时解锁（10 分钟）优先于购买引导
  if (adUnlock.isUnlocked(productId)) return true

  // iOS 端：仍走门控，但拦截时弹专属引导（让用户去电脑微信购买，不是直接放行）
  // 注意：PRO 用户（从其他设备买的同账号）应该正常放行，所以这里要先看缓存/查云端
  if (isIOS()) {
    var cachedStateForIOS = _readStateFromCache()
    if (cachedStateForIOS !== null) {
      if (isPro(cachedStateForIOS)) return true
      if (hasPurchased(cachedStateForIOS, productId)) return true
      return _showIOSPurchaseDialog(productName, productId)
    }
    // 缓存 miss：查一次云端，超时 fail-open
    try {
      var raceResultIOS = await new Promise(function (resolve) {
        var settled = false
        var timer = setTimeout(function () {
          if (settled) return
          settled = true
          resolve({ timeout: true })
        }, 700)
        getMembershipState()
          .then(function (s) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({ state: s })
          })
          .catch(function () {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({ error: true })
          })
      })
      if (raceResultIOS.timeout || raceResultIOS.error) return true // fail-open，避免冷启动卡 UI
      var s = raceResultIOS.state
      if (isPro(s)) return true
      if (hasPurchased(s, productId)) return true
      return _showIOSPurchaseDialog(productName, productId)
    } catch (e) {
      return true
    }
  }

  // Fast-path：内存/本地缓存命中时立即决策，避免 loading 闪烁
  var cachedEnabled = _readEnabledFromCache()
  var cachedState = _readStateFromCache()
  if (cachedEnabled !== null && cachedState !== null) {
    if (!cachedEnabled) return true
    if (isPro(cachedState)) return true
    if (hasPurchased(cachedState, productId)) return true
    return _showPurchaseDialog(productId, productName)
  }

  // 缓存 miss：等待云端，但加超时 fail-open，避免冷启动卡 UI
  wx.showLoading({ title: '加载中', mask: true })
  var TIMEOUT_MS = 700
  var enabled
  var state
  try {
    var raceResult = await new Promise(function (resolve) {
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        resolve({ timeout: true })
      }, TIMEOUT_MS)
      Promise.all([isMembershipEnabled(), getMembershipState()])
        .then(function (r) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ enabled: r[0], state: r[1] })
        })
        .catch(function () {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ error: true })
        })
    })
    if (raceResult.timeout || raceResult.error) {
      return true // 超时或异常时 fail-open，与现有兜底语义一致
    }
    enabled = raceResult.enabled
    state = raceResult.state
    if (!enabled) return true
    if (isPro(state)) return true
    if (hasPurchased(state, productId)) return true
  } finally {
    try { wx.hideLoading() } catch (e) {}
  }

  return _showPurchaseDialog(productId, productName)
}

/**
 * AI 图片识别次数门控
 * @returns {boolean} true=允许使用, false=已拦截
 */
async function aiImageGateCheck() {
  var adUnlock = require('./ad-unlock.js')
  var AI_AD_PRODUCT = 'ai_image'
  if (adUnlock.isUnlocked(AI_AD_PRODUCT)) return true

  if (isIOS()) {
    // iOS 不开放付费，但 PRO 用户（其他端购买的同账号）应该正常放行
    try {
      var stateForIOS = await getMembershipState()
      if (isPro(stateForIOS)) return true
      var remainingFree = getAiImageRemaining(stateForIOS)
      if (remainingFree !== 0) return true
    } catch (e) {
      return true // 查询异常 fail-open
    }
    return _showIOSPurchaseDialog('AI太空图像识别', AI_AD_PRODUCT)
  }
  try {
    var enabled = await isMembershipEnabled()
    if (!enabled) return true
    var state = await getMembershipState()
    var remaining = getAiImageRemaining(state)
    if (remaining !== 0) return true
  } catch (e) {
    return true
  }

  return new Promise(function (resolve) {
    wx.showActionSheet({
      alertText: '今日识别次数已用完\n免费用户每日 ' + FREE_LIMITS.AI_IMAGE + ' 次',
      itemList: [
        '升级星际通行证（无限使用）',
        '看广告免费体验10分钟'
      ],
      success: function (res) {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
          resolve(false)
          return
        }
        if (res.tapIndex === 1) {
          adUnlock.showRewardedAdForUnlock(AI_AD_PRODUCT).then(resolve)
          return
        }
        resolve(false)
      },
      fail: function () { resolve(false) }
    })
  })
}

// ── 内部工具 ──

function _getDefaultState() {
  return {
    type: MEMBER_TYPE.FREE,
    expireAt: null,
    purchases: [],
    aiChatUsed: {},
    aiImageUsed: {},
    trialUsed: false
  }
}

function _todayStr() {
  var d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// 会员功能全局开关（从云端 global_config 读取）
let _membershipEnabled = null
let _membershipEnabledTs = 0
let _membershipEnabledInflight = null
const SWITCH_CACHE_KEY = '_membership_enabled'
const SWITCH_TTL = 30 * 60 * 1000 // 30 分钟

/**
 * 检查会员功能是否启用（后台开关）
 */
function isMembershipEnabled() {
  // 内存缓存
  if (_membershipEnabled !== null && (Date.now() - _membershipEnabledTs < SWITCH_TTL)) {
    return Promise.resolve(_membershipEnabled)
  }
  // 本地缓存
  try {
    var cached = storageCache.readMemOrSync(SWITCH_CACHE_KEY, null)
    if (cached && cached.ts && (Date.now() - cached.ts < SWITCH_TTL)) {
      _membershipEnabled = cached.value
      _membershipEnabledTs = cached.ts
      return Promise.resolve(cached.value)
    }
  } catch (e) {}
  // 复用 in-flight 请求
  if (_membershipEnabledInflight) {
    return _membershipEnabledInflight
  }
  // 云端查询
  var db = wx.cloud.database()
  _membershipEnabledInflight = db.collection('global_config').where({ _id: 'main' }).limit(1).get()
    .then(function (res) {
      var cfg = res.data && res.data[0]
      var enabled = !!(cfg && cfg.enableMembership)
      _membershipEnabled = enabled
      _membershipEnabledTs = Date.now()
      try { storageCache.persistAsync(SWITCH_CACHE_KEY, { value: enabled, ts: Date.now() }) } catch (e) {}
      return enabled
    })
    .catch(function () {
      // 查询失败默认关闭
      _membershipEnabled = false
      _membershipEnabledTs = Date.now()
      return false
    })
    .then(function (enabled) {
      _membershipEnabledInflight = null
      return enabled
    }, function (err) {
      _membershipEnabledInflight = null
      throw err
    })
  return _membershipEnabledInflight
}

// ── 动态价格（来自后台 vpaySkuPrices，5 分钟全局缓存） ──
let _priceMapCache = { map: null, ts: 0 }
const PRICE_MAP_CACHE_MS = 5 * 60 * 1000

function clearPriceCache() {
  _priceMapCache = { map: null, ts: 0 }
}

async function getEffectivePrices(forceRefresh) {
  const now = Date.now()
  if (!forceRefresh && _priceMapCache.map && (now - _priceMapCache.ts) < PRICE_MAP_CACHE_MS) {
    return _priceMapCache.map
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'membership',
      data: { action: 'getEffectivePrices' }
    })
    const map = (res && res.result && res.result.prices) || {}
    _priceMapCache = { map: map, ts: now }
    return map
  } catch (e) {
    return _priceMapCache.map || {}
  }
}

/**
 * 拉取当前用户订单记录（订阅 + 一次性购买，按创建时间倒序，最多 50 条）
 */
async function listMyOrders() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'membership',
      data: { action: 'listOrders' }
    })
    const result = (res && res.result) || {}
    if (result.error) return { success: false, error: result.error, orders: [] }
    return { success: true, orders: result.orders || [] }
  } catch (e) {
    return { success: false, error: '网络异常，请稍后再试', orders: [] }
  }
}

/**
 * 删除单条订单记录（仅限本人；退款处理中的订单服务端会拒绝）
 */
async function deleteMyOrder(orderId) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'membership',
      data: { action: 'deleteOrder', orderId: orderId }
    })
    const result = (res && res.result) || {}
    if (result.error) return { success: false, error: result.error }
    return { success: true }
  } catch (e) {
    return { success: false, error: '网络异常，请稍后再试' }
  }
}

module.exports = {
  MEMBER_TYPE: MEMBER_TYPE,
  PLANS: PLANS,
  PRODUCTS: PRODUCTS,
  FREE_LIMITS: FREE_LIMITS,
  MEMBER_ICONS: MEMBER_ICONS,
  getMembershipState: getMembershipState,
  isPro: isPro,
  isProSync: isProSync,
  warmMembershipStateSync: warmMembershipStateSync,
  warmMembershipStateAsync: warmMembershipStateAsync,
  hasPurchased: hasPurchased,
  getAiChatRemaining: getAiChatRemaining,
  getAiImageRemaining: getAiImageRemaining,
  recordAiChatUse: recordAiChatUse,
  recordAiImageUse: recordAiImageUse,
  purchaseSubscription: purchaseSubscription,
  purchaseProduct: purchaseProduct,
  clearCache: clearCache,
  isMembershipEnabled: isMembershipEnabled,
  gateCheck: gateCheck,
  aiImageGateCheck: aiImageGateCheck,
  getEffectivePrices: getEffectivePrices,
  clearPriceCache: clearPriceCache,
  listMyOrders: listMyOrders,
  deleteMyOrder: deleteMyOrder
}
