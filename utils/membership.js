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

/** 会员权益插画（与会员页宫格一致；索引 3 为预留） */
const MEMBER_BENEFIT_ICONS = [
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741192678_gsejhy.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741195115_g7z847.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741195886_bbbiph.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741196495_ltn8qz.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741197093_xhd41j.png'
]

/** 「我的」通行证卡权益条：名称 + 图标下标 */
const MEMBER_PASS_BENEFITS = [
  { name: '无限对话', iconIndex: 0 },
  { name: '去除广告', iconIndex: 1 },
  { name: '过境预报', iconIndex: 2 },
  { name: '专属徽章', iconIndex: 4 }
]

// 免费用户每日限制（默认值；运行时以 global_config 会员策略为准）
const FREE_LIMITS = {
  AI_CHAT: 3
}

function _freeAiLimits() {
  try {
    const { getMemberPolicySync } = require('./member-policy.js')
    const p = getMemberPolicySync()
    return {
      AI_CHAT: p.freeAiChatDaily
    }
  } catch (e) {
    return { AI_CHAT: FREE_LIMITS.AI_CHAT }
  }
}

// 本地缓存 key
const CACHE_KEY = '_membership_state'
const CACHE_TTL = 10 * 60 * 1000 // 10 分钟

const storageCache = require('./storage-sync-cache.js')
const vpayIos = require('./vpay-ios.js')

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
    data: { action: 'getState' },
    timeout: 4000
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
function _hasWatchPass() {
  try {
    if (require('./watch-pass.js').isActive()) return true
  } catch (e) {}
  // 入驻商家员工免门控（后台开关）：与观礼通行证同等待遇
  try {
    return !!require('./merchant-staff-bypass.js').isActive()
  } catch (e) {
    return false
  }
}

function getAiChatRemaining(state) {
  if (isPro(state) || _hasWatchPass()) return -1 // -1 表示无限（含观礼通行证）
  var today = _todayStr()
  var used = (state && state.aiChatUsed && state.aiChatUsed[today]) || 0
  var limit = _freeAiLimits().AI_CHAT
  try {
    limit += require('./ai-chat-ad-quota.js').getAiChatAdBonus()
  } catch (e) {}
  return Math.max(0, limit - used)
}

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
 * 同步获取 Pro 状态（命中缓存即返回，不命中则触发后台刷新）
 */
function isProSync() {
  const cached = _readStateFromCache()
  if (cached) return isPro(cached)
  return false
}

function _wxLogin() {
  return new Promise(function (resolve) {
    wx.login({
      success: function (res) { resolve((res && res.code) || '') },
      fail: function () { resolve('') }
    })
  })
}

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

function mapVPayFail(e) {
  const mapped = vpayIos.friendlyVPayError(e)
  if (mapped && mapped.cancelled) {
    return { success: false, cancelled: true }
  }
  return {
    success: false,
    title: (mapped && mapped.title) || '暂无法支付',
    error: (mapped && mapped.error) || '支付未完成，请稍后重试'
  }
}

async function _purchaseByVPayProductId(vpayProductId) {
  if (!vpayProductId) {
    return { success: false, error: '配置缺失' }
  }

  const clientInfo = vpayIos.collectPayClientInfo()
  // 设备就是 iOS 时必须上报 ios，避免 platform 异常导致服务端按安卓签沙箱 env（Apple 会报 -15011）
  if (isIOS()) clientInfo.platform = 'ios'
  const iosReady = vpayIos.checkIOSPayReady(clientInfo)
  if (!iosReady.ok) {
    wx.showModal({
      title: '暂无法支付',
      content: iosReady.message,
      showCancel: false
    })
    return { success: false, error: iosReady.error }
  }
  if (!vpayIos.canCallRequestVirtualPayment(clientInfo)) {
    return { success: false, error: '当前版本不支持虚拟支付，请升级微信' }
  }

  const code = await _wxLogin()
  if (!code) return { success: false, error: '获取登录态失败' }

  let res
  try {
    res = await wx.cloud.callFunction({
      name: 'membership',
      data: {
        action: 'createVPayOrder',
        vpayProductId: vpayProductId,
        code: code,
        platform: clientInfo.platform
      }
    })
  } catch (e) {
    return { success: false, error: '下单失败，请稍后再试' }
  }
  const result = (res && res.result) || {}
  if (!result.signData || !result.paySig || !result.signature) {
    return { success: false, error: result.error || '下单失败' }
  }

  const outTradeNo = result.outTradeNo

  // 调起虚拟支付：平台按设备路由，Android/鸿蒙/Windows → 微信支付，iOS → Apple 支付
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
        resolve(mapVPayFail(e))
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

/** 内存/本地 TTL 内有会员态：启动预热不必再 callFunction */
function hasFreshMembershipState() {
  if (_memState && (Date.now() - _memStateTs < CACHE_TTL)) return true
  if (!storageCache.isLoaded(CACHE_KEY)) return false
  var cachedEntry = storageCache.getMem(CACHE_KEY)
  return !!(cachedEntry && cachedEntry.ts && cachedEntry.data && (Date.now() - cachedEntry.ts < CACHE_TTL))
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

async function _showPurchaseDialog(productId, productName, opts) {
  var adUnlock = require('./ad-unlock.js')
  var allowAd = !opts || opts.allowAd !== false
  var adUnlockId = (opts && opts.adUnlockId) || productId
  var meta = _findProductById(productId)
  var priceText = ''
  if (meta) {
    try {
      var cents = await resolveVpayPriceCents(meta.vpayProductId, meta.price)
      if (cents > 0) priceText = formatPriceYuan(cents)
    } catch (e) {
      if (meta.price > 0) priceText = formatPriceYuan(meta.price)
    }
  }

  var itemList = ['开通星际通行证（全部解锁）']
  if (priceText) {
    itemList.push('永久购买' + (productName || meta && meta.name || '') + '（¥' + priceText + '）')
  }
  if (allowAd) {
    itemList.push(adUnlock.getAdUnlockActionLabel(adUnlockId) || '看广告免费体验')
  }

  return new Promise(function (resolve) {
    wx.showActionSheet({
      alertText: (productName || '高级功能') + '\n此功能需要解锁后使用',
      itemList: itemList,
      success: function (res) {
        var idx = res.tapIndex
        if (idx === 0) {
          wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
          resolve(false)
          return
        }
        if (priceText && idx === 1) {
          wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership?buy=' + productId })
          resolve(false)
          return
        }
        if (allowAd && idx === itemList.length - 1) {
          adUnlock.showRewardedAdForUnlock(adUnlockId).then(resolve)
          return
        }
        resolve(false)
      },
      fail: function () { resolve(false) }
    })
  })
}

async function gateCheck(productId, productName, opts) {
  // 观礼通行证（现场扫码签发，限时）：有效期内免除全部功能门控
  try {
    if (require('./watch-pass.js').isActive()) return true
  } catch (e) {}
  // 入驻商家员工：后台开启「免整个门控」后全站放行
  try {
    if (require('./merchant-staff-bypass.js').isActive()) return true
  } catch (e) {}

  var adUnlock = require('./ad-unlock.js')
  var adUnlockId = (opts && opts.adUnlockId) || productId
  var allowAd = !opts || opts.allowAd !== false
  // 广告临时解锁（10 分钟）优先于购买引导
  if (allowAd && adUnlock.isUnlocked(adUnlockId)) return true

  // Fast-path：内存/本地缓存命中时立即决策，避免 loading 闪烁
  var cachedEnabled = _readEnabledFromCache()
  var cachedState = _readStateFromCache()
  if (cachedEnabled !== null && cachedState !== null) {
    if (!cachedEnabled) return true
    if (isPro(cachedState)) return true
    if (hasPurchased(cachedState, productId)) return true
    return _showPurchaseDialog(productId, productName, { adUnlockId: adUnlockId, allowAd: allowAd })
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

  return _showPurchaseDialog(productId, productName, { adUnlockId: adUnlockId, allowAd: allowAd })
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
  // 走 feature-flags 的 global_config/main 共享缓存（5 分钟 + inflight 去重），
  // 与其他全局开关共用同一次读库
  _membershipEnabledInflight = require('./feature-flags.js').fetchMainConfig()
    .then(function (cfg) {
      if (!cfg || !cfg._id) {
        // 读库失败（fetchMainConfig 内部吞错返回 {}）：默认关闭，不写本地缓存
        _membershipEnabled = false
        _membershipEnabledTs = Date.now()
        return false
      }
      var enabled = !!cfg.enableMembership
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

// ── 动态价格（来自后台 vpaySkuPrices；与云函数 PRICE_CACHE_MS=30s 对齐） ──
let _priceMapCache = { map: null, ts: 0 }
const PRICE_MAP_CACHE_MS = 30 * 1000

function clearPriceCache() {
  _priceMapCache = { map: null, ts: 0 }
}

function _findProductById(productId) {
  if (!productId) return null
  var productKeys = Object.keys(PRODUCTS)
  for (var i = 0; i < productKeys.length; i++) {
    var p = PRODUCTS[productKeys[i]]
    if (p && p.id === productId) return p
  }
  return null
}

/** 价格 map 取值：后台覆盖优先，否则本地默认分 */
function resolvePriceFromMap(priceMap, vpayId, fallbackCents) {
  var v = priceMap && priceMap[vpayId]
  if (Number.isInteger(v) && v > 0) return v
  var n = Number(fallbackCents)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 分 → 展示文案（整数元不带小数，否则最多 1 位） */
function formatPriceYuan(cents) {
  var n = Number(cents) || 0
  if (n <= 0) return ''
  if (n % 100 === 0) return String(n / 100)
  return (n / 100).toFixed(1)
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

/** 按虚拟支付道具 ID 取生效价（分） */
async function resolveVpayPriceCents(vpayProductId, fallbackCents) {
  if (!vpayProductId) return Number(fallbackCents) || 0
  const map = await getEffectivePrices()
  return resolvePriceFromMap(map, vpayProductId, fallbackCents)
}

/** 按业务 productId（如 starlink_ar）取生效价（分） */
async function resolveProductPriceCents(productId) {
  const meta = _findProductById(productId)
  if (!meta) return 0
  return resolveVpayPriceCents(meta.vpayProductId, meta.price)
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

function canUsePaidCloudSync() {
  const enabled = _readEnabledFromCache()
  if (enabled === false) return true
  if (isProSync()) return true
  // 观礼通行证有效期内视同 Pro（现场视频预热/播放等不再被门控卡住）
  try {
    if (require('./watch-pass.js').isActive()) return true
  } catch (e) {}
  try {
    if (require('./merchant-staff-bypass.js').isActive()) return true
  } catch (e) {}
  return false
}

function canSaveOriginalVideoSync(productId) {
  const enabled = _readEnabledFromCache()
  if (enabled === false) return true
  if (isProSync()) return true
  const state = _readStateFromCache()
  return !!(state && hasPurchased(state, productId))
}

function canPrefetchVideoSync() {
  if (canUsePaidCloudSync()) return true
  try {
    const { getMemberPolicySync } = require('./member-policy.js')
    return !getMemberPolicySync().forceNonMemberVideoPoster
  } catch (e) {
    return false
  }
}

module.exports = {
  MEMBER_TYPE: MEMBER_TYPE,
  PLANS: PLANS,
  PRODUCTS: PRODUCTS,
  FREE_LIMITS: FREE_LIMITS,
  MEMBER_ICONS: MEMBER_ICONS,
  MEMBER_BENEFIT_ICONS: MEMBER_BENEFIT_ICONS,
  MEMBER_PASS_BENEFITS: MEMBER_PASS_BENEFITS,
  getMembershipState: getMembershipState,
  isPro: isPro,
  isProSync: isProSync,
  canUsePaidCloudSync: canUsePaidCloudSync,
  canPrefetchVideoSync: canPrefetchVideoSync,
  canSaveOriginalVideoSync: canSaveOriginalVideoSync,
  warmMembershipStateSync: warmMembershipStateSync,
  warmMembershipStateAsync: warmMembershipStateAsync,
  hasFreshMembershipState: hasFreshMembershipState,
  hasPurchased: hasPurchased,
  getAiChatRemaining: getAiChatRemaining,
  recordAiChatUse: recordAiChatUse,
  purchaseSubscription: purchaseSubscription,
  purchaseProduct: purchaseProduct,
  clearCache: clearCache,
  isMembershipEnabled: isMembershipEnabled,
  gateCheck: gateCheck,
  getEffectivePrices: getEffectivePrices,
  clearPriceCache: clearPriceCache,
  resolvePriceFromMap: resolvePriceFromMap,
  resolveVpayPriceCents: resolveVpayPriceCents,
  resolveProductPriceCents: resolveProductPriceCents,
  formatPriceYuan: formatPriceYuan,
  listMyOrders: listMyOrders,
  deleteMyOrder: deleteMyOrder
}
