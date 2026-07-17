/**
 * 会员服务云函数（虚拟支付版）
 *
 * action:
 *   - getOpenid              获取当前用户 openid
 *   - getState               获取当前用户会员状态
 *   - recordUsage            记录 AI 使用次数（aiChat / aiImage）
 *   - createVPayOrder        创建虚拟支付订单（道具模式 short_series_goods），返回 signData/paySig/signature
 *   - queryVPayOrder         主动查单兜底（前端 success 后调用）
 *   - vpayRefund             人工退款（仅 admin 可调）
 *   - claimInvite            邀请核销：被邀人上报 inviter，满 15 人自动发 30 天月卡
 *   - getInviteState         邀请页状态：有效邀请数 / 已发月卡数 / 最近记录
 *
 * 同时作为虚拟支付消息推送回调入口（事件类型：xpay_goods_deliver_notify / xpay_refund_notify）
 *
 * 已废弃（保留接口返回错误，过渡期）：
 *   - createOrder            旧普通微信支付下单
 *   - payCallback            旧普通微信支付回调（已被消息推送回调取代）
 */

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ENV_ID = 'cloud1-9gdqgdt5bfaa20fb'

const db = cloud.database()
const _ = db.command
const COLLECTION = 'user_membership'
const ORDER_COLLECTION = 'membership_orders'
const GLOBAL_CONFIG_DOC = 'global_config'
const PRO_WHITELIST_FAR_EXPIRE = '2099-12-31T23:59:59.000Z'

// 虚拟支付配置
// - offerId / env：优先读 global_config.main.vpayConfig（管理后台可改），缺省回退环境变量
// - AppKey 仍只来自环境变量（不入库，避免泄露）：VPAY_APPKEY_PROD / VPAY_APPKEY_SANDBOX
const VPAY_OFFER_ID = process.env.VPAY_OFFERID || '1450535433'
const VPAY_APPKEY_PROD = process.env.VPAY_APPKEY_PROD || ''
const VPAY_APPKEY_SANDBOX = process.env.VPAY_APPKEY_SANDBOX || ''
const VPAY_ENV = Number(process.env.VPAY_ENV || 0) === 1 ? 1 : 0
const ADMIN_OPENIDS = String(process.env.VPAY_ADMIN_OPENIDS || '')
  .split(/[\s,;]+/)
  .map(s => s.trim())
  .filter(Boolean)

// 调用来源校验：SOURCE 链末位为 wx_client 说明是小程序端直接 callFunction；
// 微信服务端消息推送 / 云函数间调用（如 adminGateway → membership）末位不会是 wx_client。
// 用于防止客户端伪造支付回调与 fromAdminGateway 越权。
function isServerSideInvocation() {
  try {
    const ctx = cloud.getWXContext() || {}
    const chain = String(ctx.SOURCE || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!chain.length) return false
    const last = chain[chain.length - 1]
    return last !== 'wx_client' && last !== 'wx_devtools'
  } catch (e) {
    return false
  }
}

let _proWhitelistCache = { set: null, ts: 0 }
const PRO_WHITELIST_CACHE_MS = 30000

async function getProWhitelistSet() {
  const now = Date.now()
  if (_proWhitelistCache.set && (now - _proWhitelistCache.ts) < PRO_WHITELIST_CACHE_MS) {
    return _proWhitelistCache.set
  }
  const set = new Set()
  try {
    const res = await db.collection(GLOBAL_CONFIG_DOC).doc('main').get()
    const arr = (res.data && res.data.proWhitelistOpenids) || []
    if (Array.isArray(arr)) {
      for (const id of arr) {
        const s = String(id || '').trim()
        if (s) set.add(s)
      }
    }
  } catch (e) {}
  _proWhitelistCache = { set, ts: now }
  return set
}

// 虚拟支付商品 SKU 表（必须与小程序「虚拟支付」商户后台已发布的道具 productId 完全一致）
// 道具模式下「一笔订单只能购买一个道具」，所以折扣价单独建一个道具 SKU
const VPAY_PRODUCTS = {
  vp_sub_monthly: { kind: 'subscription', planId: 'monthly', name: '星际通行证 - 月卡', goodsPrice: 390, days: 30 },
  vp_sub_yearly: { kind: 'subscription', planId: 'yearly', name: '星际通行证 - 年卡', goodsPrice: 3990, days: 365 },
  vp_sub_year_dc: { kind: 'subscription', planId: 'yearly_discount', name: '星际通行证-年卡6折', goodsPrice: 2390, days: 365 },
  vp_sub_permanent: { kind: 'subscription', planId: 'permanent', name: '星际通行证 - 永久', goodsPrice: 16800, days: 36500 },
  vp_sub_perm_dc: { kind: 'subscription', planId: 'permanent_discount', name: '星际通行证-永久5折', goodsPrice: 8400, days: 36500 },
  vp_starlink_ar: { kind: 'product', productId: 'starlink_ar', name: '星链 AR 观测', goodsPrice: 690 },
  vp_artemis_telemetry: { kind: 'product', productId: 'artemis_telemetry', name: 'Artemis 遥测面板', goodsPrice: 390 },
  vp_starlink_pro: { kind: 'product', productId: 'starlink_pro', name: '星链高级追踪', goodsPrice: 390 },
  vp_starship_chk: { kind: 'product', productId: 'starship_flight_checklist', name: '星舰飞行检查清单', goodsPrice: 390 }
}

// ── 动态价格 / 虚拟支付配置读取（30s 内存缓存） ──
let _priceCache = { map: null, ts: 0 }
let _vpayCfgCache = { value: null, ts: 0 }
const PRICE_CACHE_MS = 30000

async function _loadPriceMap() {
  try {
    const res = await db.collection(GLOBAL_CONFIG_DOC).doc('main').get()
    return (res.data && res.data.vpaySkuPrices) || {}
  } catch (e) {
    return {}
  }
}

async function getEffectivePriceMap() {
  const now = Date.now()
  if (!_priceCache.map || (now - _priceCache.ts) > PRICE_CACHE_MS) {
    _priceCache = { map: await _loadPriceMap(), ts: now }
  }
  return _priceCache.map || {}
}

async function _loadVPayConfigFromDb() {
  try {
    const res = await db.collection(GLOBAL_CONFIG_DOC).doc('main').get()
    return (res.data && res.data.vpayConfig) || null
  } catch (e) {
    return null
  }
}

/** 生效中的 offerId / env（管理后台 vpayConfig 优先，否则环境变量） */
async function getEffectiveVPayConfig() {
  const now = Date.now()
  if (!_vpayCfgCache.value || (now - _vpayCfgCache.ts) > PRICE_CACHE_MS) {
    const fromDb = await _loadVPayConfigFromDb()
    let offerId = VPAY_OFFER_ID
    let env = VPAY_ENV
    if (fromDb) {
      const dbOffer = String(fromDb.offerId || '').trim()
      if (dbOffer) offerId = dbOffer
      const dbEnv = Number(fromDb.env)
      if (dbEnv === 0 || dbEnv === 1) env = dbEnv
    }
    env = env === 1 ? 1 : 0
    _vpayCfgCache = { value: { offerId, env }, ts: now }
  }
  return _vpayCfgCache.value
}

function resolveOrderOfferId(order, fallbackOfferId) {
  const fromOrder = order && String(order.offerId || '').trim()
  if (fromOrder) return fromOrder
  const fb = String(fallbackOfferId || '').trim()
  return fb || VPAY_OFFER_ID
}

function resolveOrderVPayEnv(order, fallbackEnv) {
  if (order && order.vpayEnv != null) {
    const n = Number(order.vpayEnv)
    if (n === 0 || n === 1) return n
  }
  const fb = Number(fallbackEnv)
  if (fb === 0 || fb === 1) return fb
  return VPAY_ENV
}

function clearPriceCache() {
  _priceCache = { map: null, ts: 0 }
  _vpayCfgCache = { value: null, ts: 0 }
}

async function getEffectivePrice(vpayProductId) {
  const sku = VPAY_PRODUCTS[vpayProductId]
  if (!sku) return 0
  const map = await getEffectivePriceMap()
  const override = map[vpayProductId]
  if (Number.isInteger(override) && override > 0) return override
  return sku.goodsPrice
}

async function getAllEffectivePrices() {
  const map = await getEffectivePriceMap()
  const result = {}
  for (const id of Object.keys(VPAY_PRODUCTS)) {
    const override = map[id]
    result[id] = (Number.isInteger(override) && override > 0) ? override : VPAY_PRODUCTS[id].goodsPrice
  }
  return result
}

function todayStr() {
  const d = new Date()
  const offset = 8 * 60 * 60 * 1000
  const cn = new Date(d.getTime() + offset)
  return cn.toISOString().slice(0, 10)
}

async function ensureCollection() {
  try { await db.createCollection(COLLECTION) } catch (e) {}
  try { await db.createCollection(ORDER_COLLECTION) } catch (e) {}
}

async function getUserDoc(openid) {
  await ensureCollection()
  try {
    const res = await db.collection(COLLECTION).doc(openid).get()
    return res.data
  } catch (e) {
    const defaultDoc = {
      _id: openid,
      type: 'free',
      expireAt: null,
      purchases: [],
      aiChatUsed: {},
      aiImageUsed: {},
      trialUsed: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    await db.collection(COLLECTION).add({ data: defaultDoc })
    return defaultDoc
  }
}

async function getState(openid) {
  const doc = await getUserDoc(openid)
  let type = doc.type || 'free'
  let expireAt = doc.expireAt || null
  const purchases = doc.purchases || []
  try {
    const wl = await getProWhitelistSet()
    if (openid && wl.has(openid)) {
      type = 'pro'
      const farMs = new Date(PRO_WHITELIST_FAR_EXPIRE).getTime()
      const curMs = expireAt ? new Date(expireAt).getTime() : 0
      expireAt = new Date(Math.max(farMs, curMs)).toISOString()
    }
  } catch (e) {}
  return {
    type,
    expireAt,
    purchases,
    aiChatUsed: doc.aiChatUsed || {},
    aiImageUsed: doc.aiImageUsed || {},
    trialUsed: doc.trialUsed || false
  }
}

async function recordUsage(openid, usageType) {
  const today = todayStr()
  const field = usageType === 'aiImage' ? 'aiImageUsed' : 'aiChatUsed'
  const key = field + '.' + today
  await db.collection(COLLECTION).doc(openid).update({
    data: {
      [key]: _.inc(1),
      updatedAt: db.serverDate()
    }
  })
  return { success: true }
}

// ── 公共：把已支付订单应用到会员状态 ──
// 复用同一函数：membership 云函数的回调链路 + adminGateway 的「自动修复」都走这里
async function applyPaidOrder(order) {
  if (!order || !order.openid) return { applied: false, reason: 'missing openid' }
  const openid = order.openid
  await getUserDoc(openid)

  if (order.orderType === 'subscription' && order.days) {
    const doc = await getUserDoc(openid)
    const now = new Date()
    const currentExpire = doc.expireAt ? new Date(doc.expireAt) : now
    const baseDate = currentExpire > now ? currentExpire : now
    const newExpire = new Date(baseDate.getTime() + Number(order.days) * 86400000)
    await db.collection(COLLECTION).doc(openid).update({
      data: {
        type: 'pro',
        planId: order.planId || '',
        expireAt: newExpire,
        updatedAt: db.serverDate()
      }
    })
    return { applied: true, kind: 'subscription', expireAt: newExpire }
  }

  if (order.orderType === 'product' && order.productId) {
    await db.collection(COLLECTION).doc(openid).update({
      data: {
        purchases: _.addToSet(order.productId),
        updatedAt: db.serverDate()
      }
    })
    return { applied: true, kind: 'product', productId: order.productId }
  }

  return { applied: false, reason: 'unsupported orderType' }
}

// ── 公共：退款时回滚会员状态 ──
async function applyRefundedOrder(order) {
  if (!order || !order.openid) return
  const openid = order.openid
  if (order.orderType === 'product' && order.productId) {
    try {
      await db.collection(COLLECTION).doc(openid).update({
        data: {
          purchases: _.pull(order.productId),
          updatedAt: db.serverDate()
        }
      })
    } catch (e) {
      console.error('[applyRefundedOrder] pull product error:', openid, order.productId, e && (e.message || e))
    }
    return
  }
  if (order.orderType === 'subscription' && order.days) {
    try {
      const doc = await getUserDoc(openid)
      const cur = doc.expireAt ? new Date(doc.expireAt) : null
      if (cur) {
        const rolled = new Date(cur.getTime() - Number(order.days) * 86400000)
        const now = new Date()
        const finalDate = rolled > now ? rolled : null
        await db.collection(COLLECTION).doc(openid).update({
          data: {
            expireAt: finalDate,
            type: finalDate ? 'pro' : 'free',
            updatedAt: db.serverDate()
          }
        })
      }
    } catch (e) {
      console.error('[applyRefundedOrder] rollback subscription error:', openid, e && (e.message || e))
    }
  }
}

// ── 虚拟支付签名 ──
function getAppKey(env) {
  return Number(env) === 1 ? VPAY_APPKEY_SANDBOX : VPAY_APPKEY_PROD
}

function calcPaySig(uri, signData, env) {
  const appkey = getAppKey(env)
  return crypto.createHmac('sha256', appkey).update(uri + '&' + signData).digest('hex')
}

function calcSignature(signData, sessionKey) {
  return crypto.createHmac('sha256', sessionKey).update(signData).digest('hex')
}

// 通过 code 换 session_key（用户态签名需要）
// 双层兜底：1) cloud.openapi 云调用 2) HTTPS 直连官方接口（需要 WX_APPSECRET 环境变量）
const https = require('https')
const WX_APPID = process.env.WX_APPID || 'wxf98b58309019771b'
const WX_APPSECRET = process.env.WX_APPSECRET || ''

const WX_HTTPS_TIMEOUT_MS = 10000

function _httpsGetJson(url) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { timeout: WX_HTTPS_TIMEOUT_MS }, function (res) {
      let data = ''
      res.on('data', function (chunk) { data += chunk })
      res.on('end', function () {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', function () { req.destroy(new Error('wx https timeout')) })
    req.on('error', reject)
  })
}

async function code2SessionKey(code) {
  if (!code) return ''

  // 路径 1：云调用（部分 SDK / 环境组合下可能返回 -64 API not found）
  try {
    if (cloud.openapi && cloud.openapi.auth && typeof cloud.openapi.auth.code2Session === 'function') {
      const res = await cloud.openapi.auth.code2Session({ jsCode: code })
      if (res && res.sessionKey) return res.sessionKey
      console.warn('[code2SessionKey] cloud.openapi empty result:', JSON.stringify(res || {}))
    } else {
      console.warn('[code2SessionKey] cloud.openapi.auth.code2Session not available in SDK')
    }
  } catch (e) {
    console.warn('[code2SessionKey] cloud.openapi error:', e && (e.message || e))
  }

  // 路径 2：HTTPS 直连 jscode2session（需要 WX_APPSECRET 环境变量）
  if (!WX_APPSECRET) {
    console.error('[code2SessionKey] 云调用失败且未配置 WX_APPSECRET 环境变量，无法兜底')
    return ''
  }
  try {
    const url = 'https://api.weixin.qq.com/sns/jscode2session' +
      '?appid=' + encodeURIComponent(WX_APPID) +
      '&secret=' + encodeURIComponent(WX_APPSECRET) +
      '&js_code=' + encodeURIComponent(code) +
      '&grant_type=authorization_code'
    const res = await _httpsGetJson(url)
    if (res && res.session_key) return res.session_key
    console.error('[code2SessionKey] https jscode2session response:', JSON.stringify(res || {}))
  } catch (e) {
    console.error('[code2SessionKey] https error:', e && (e.message || e))
  }
  return ''
}

// access_token 缓存（云函数实例内存中，TTL 7000s）
let _accessTokenCache = { token: '', expireAt: 0 }
async function getAccessToken() {
  const now = Date.now()
  if (_accessTokenCache.token && now < _accessTokenCache.expireAt) {
    return _accessTokenCache.token
  }
  if (!WX_APPSECRET) {
    console.error('[getAccessToken] 未配置 WX_APPSECRET，无法获取 access_token')
    return ''
  }
  try {
    const url = 'https://api.weixin.qq.com/cgi-bin/token' +
      '?grant_type=client_credential' +
      '&appid=' + encodeURIComponent(WX_APPID) +
      '&secret=' + encodeURIComponent(WX_APPSECRET)
    const res = await _httpsGetJson(url)
    if (res && res.access_token) {
      _accessTokenCache = { token: res.access_token, expireAt: now + 7000 * 1000 }
      return res.access_token
    }
    console.error('[getAccessToken] response:', JSON.stringify(res || {}))
  } catch (e) {
    console.error('[getAccessToken] error:', e && (e.message || e))
  }
  return ''
}

function _httpsPostJson(host, path, body) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(body)
    const req = https.request({
      method: 'POST',
      host: host,
      path: path,
      timeout: WX_HTTPS_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, function (res) {
      let buf = ''
      res.on('data', function (chunk) { buf += chunk })
      res.on('end', function () {
        try { resolve(JSON.parse(buf)) } catch (e) { resolve({ raw: buf, _parseError: true }) }
      })
    })
    req.on('timeout', function () { req.destroy(new Error('wx https timeout')) })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// HTTPS 直连查单（道具直购 query_order）
// docs: https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order
async function httpsQueryOrder(openid, outTradeNo, env) {
  const accessToken = await getAccessToken()
  if (!accessToken) return { _error: 'no_access_token' }

  const body = {
    openid: openid,
    env: Number(env) || 0,
    order_id: outTradeNo
  }
  const uri = '/xpay/query_order'
  const post = JSON.stringify(body)
  const appKey = getAppKey(env)
  if (!appKey) return { _error: 'no_app_key' }
  const paySig = crypto.createHmac('sha256', appKey).update(uri + '&' + post).digest('hex')

  const path = uri + '?access_token=' + encodeURIComponent(accessToken) + '&pay_sig=' + paySig
  const res = await _httpsPostJson('api.weixin.qq.com', path, body)
  return res
}

// HTTPS 直连退款（道具直购 refund_order）
// docs: https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_refund_order
// 字段含义：
//   order_id        - 原支付单号（创建订单时的 OutTradeNo）
//   refund_order_id - 本次退款单号（长度 8-32，只允许字母/数字/_/-）
//   left_fee        - 该订单当前剩余可退金额（分），需通过 query_order 查得
//   refund_fee     - 本次退款金额（分），<= left_fee
//   biz_meta       - 商家自定义数据，必填
//   refund_reason  - '0'-'5' 之一
//   req_from       - '1'-'3' 之一（1=人工客服退款）
//   env            - 0=正式 / 1=沙箱
async function httpsRefundOrder(openid, outTradeNo, refundOutTradeNo, refundFee, reason, env) {
  const accessToken = await getAccessToken()
  if (!accessToken) return { _error: 'no_access_token' }

  // refund_reason 必须是 '0'-'5' 之一（微信侧 enum）
  let refundReason = String(reason == null ? '' : reason).trim()
  if (!/^[0-5]$/.test(refundReason)) refundReason = '5'

  // 先查 query_order 拿 left_fee（剩余可退金额）
  const qRes = await httpsQueryOrder(openid, outTradeNo, env)
  console.log('[httpsRefundOrder] query_order:', JSON.stringify(qRes || {}))
  if (!qRes || qRes.errcode !== 0 || !qRes.order) {
    return { _error: 'query_order_failed', detail: qRes }
  }
  const o = qRes.order
  // left_fee 字段名常见为 left_fee；兜底：paid_fee - 已退金额
  let leftFee = Number(o.left_fee != null ? o.left_fee : (Number(o.paid_fee || 0) - Number(o.refund_fee || 0)))
  if (!Number.isFinite(leftFee) || leftFee < 0) leftFee = 0
  const fee = Number(refundFee) || 0
  if (fee <= 0 || fee > leftFee) {
    return { _error: 'invalid_refund_fee', leftFee, refundFee: fee }
  }

  const body = {
    openid: openid,
    env: Number(env) || 0,
    order_id: outTradeNo,
    refund_order_id: refundOutTradeNo,
    left_fee: leftFee,
    refund_fee: fee,
    biz_meta: 'admin_refund',
    refund_reason: refundReason,
    req_from: '1'
  }
  const uri = '/xpay/refund_order'
  const post = JSON.stringify(body)
  const appKey = getAppKey(env)
  if (!appKey) return { _error: 'no_app_key' }
  const paySig = crypto.createHmac('sha256', appKey).update(uri + '&' + post).digest('hex')

  const path = uri + '?access_token=' + encodeURIComponent(accessToken) + '&pay_sig=' + paySig
  const res = await _httpsPostJson('api.weixin.qq.com', path, body)
  return res
}

// ── 创建虚拟支付订单 ──
async function createVPayOrder(openid, vpayProductId, code) {
  const vpayCfg = await getEffectiveVPayConfig()
  const offerId = vpayCfg.offerId
  const vpayEnv = vpayCfg.env
  if (!offerId) {
    return { error: '虚拟支付未配置（offerId）' }
  }
  if (!getAppKey(vpayEnv)) {
    return {
      error: vpayEnv === 1
        ? '虚拟支付未配置（VPAY_APPKEY_SANDBOX）'
        : '虚拟支付未配置（VPAY_APPKEY_PROD）'
    }
  }
  const sku = VPAY_PRODUCTS[vpayProductId]
  if (!sku) return { error: '无效的商品 ID' }

  // 一次性产品防重
  if (sku.kind === 'product') {
    const doc = await getUserDoc(openid)
    if (doc.purchases && doc.purchases.indexOf(sku.productId) !== -1) {
      return { error: '您已购买此功能' }
    }
  }

  const sessionKey = await code2SessionKey(code)
  if (!sessionKey) return { error: '获取登录态失败，请重试' }

  const effectivePrice = await getEffectivePrice(vpayProductId)
  if (!effectivePrice || effectivePrice <= 0) {
    return { error: '商品价格未配置' }
  }

  const outTradeNo = 'M' + Date.now() + Math.random().toString(36).slice(2, 8)

  const orderRecord = {
    _id: outTradeNo,
    openid,
    amount: effectivePrice,
    description: sku.name,
    status: 'pending',
    orderType: sku.kind,
    vpayMode: 'goods',
    vpayProductId,
    offerId,
    vpayEnv,
    createdAt: db.serverDate()
  }
  if (sku.kind === 'subscription') {
    orderRecord.planId = sku.planId
    orderRecord.days = sku.days
  } else {
    orderRecord.productId = sku.productId
  }

  await ensureCollection()
  await db.collection(ORDER_COLLECTION).add({ data: orderRecord })

  const signObj = {
    offerId,
    buyQuantity: 1,
    env: vpayEnv,
    currencyType: 'CNY',
    outTradeNo,
    productId: vpayProductId,
    goodsPrice: effectivePrice,
    attach: sku.kind === 'subscription' ? 'sub:' + sku.planId : 'prod:' + sku.productId
  }
  const signData = JSON.stringify(signObj)

  const paySig = calcPaySig('requestVirtualPayment', signData, vpayEnv)
  const signature = calcSignature(signData, sessionKey)

  return {
    outTradeNo,
    signData,
    paySig,
    signature,
    mode: 'short_series_goods'
  }
}

// ── 主动查单兜底：调用 /xpay/query_order ──
async function queryVPayOrder(callerOpenid, outTradeNo, overrideOpenid, fromAdmin) {
  if (!outTradeNo) return { error: '缺少订单号' }
  let order
  try {
    const res = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
    order = res.data
  } catch (e) {
    return { error: '订单不存在' }
  }
  if (!order) return { error: '订单不存在' }
  // 普通用户只能查自己的订单；管理员经 adminGateway（fromAdmin）链路可带 overrideOpenid 豁免
  if (!fromAdmin) {
    if (!callerOpenid || order.openid !== callerOpenid) return { error: '无权访问' }
  }
  // 下游查微信侧需用订单真实 openid（管理员补单/重查场景）
  const openid = String(order.openid || overrideOpenid || callerOpenid || '')
  if (!openid) return { error: '订单 openid 缺失' }

  // 已是终态直接返回（refund_pending 不算终态，仍需要查微信侧确认是否到账）
  if (order.status === 'paid' || order.status === 'refunded' || order.status === 'failed' || order.status === 'cancelled') {
    return { status: order.status, order }
  }

  const vpayCfg = await getEffectiveVPayConfig()
  const offerId = resolveOrderOfferId(order, vpayCfg.offerId)
  const vpayEnv = resolveOrderVPayEnv(order, vpayCfg.env)

  // 调用官方查单 API（道具直购走 query_order）
  // 路径 1：云调用 cloud.openapi（部分 SDK 环境组合下不可用）
  let remote = null
  let remoteStatus = null
  try {
    if (cloud.openapi && cloud.openapi.midasPayment && cloud.openapi.midasPayment.queryOrder) {
      remote = await cloud.openapi.midasPayment.queryOrder({
        offerId,
        ts: Math.floor(Date.now() / 1000),
        env: vpayEnv,
        outTradeNo,
        userIp: '127.0.0.1'
      })
      remoteStatus = remote && remote.payState
    }
  } catch (e) {
    console.warn('[queryVPayOrder] cloud.openapi error:', e && (e.message || e))
  }

  // 路径 2：HTTPS 直连 /xpay/query_order（道具直购）
  if (remoteStatus == null) {
    try {
      const res = await httpsQueryOrder(openid, outTradeNo, vpayEnv)
      console.log('[queryVPayOrder] https response:', JSON.stringify(res || {}))
      if (res && res.errcode === 0 && res.order) {
        const o = res.order
        // 诊断退款状态用：把跟「是否已退款」相关的字段单独打出来
        console.log('[queryVPayOrder] refund-diag:', JSON.stringify({
          outTradeNo,
          status: o.status,
          paid_fee: o.paid_fee,
          left_fee: o.left_fee,
          refund_fee: o.refund_fee,
          refund_state: o.refund_state,
          refund_status: o.refund_status,
          sett_state: o.sett_state,
          sett_time: o.sett_time,
          local_status: order.status
        }))
        // 道具直购实际返回字段（基于真实日志确认）：
        //   paid_fee   – 实付金额
        //   left_fee   – 剩余可退金额（0 = 已全额退完，**最稳的退款完成信号**）
        //   refund_info.refund_order – 已发起退款单号数组（有内容 = 退款流程已启动）
        //   status     – 观察到的：3=支付完成、4=退款中、5=退款完成
        //   refund_fee – 旧版字段，新版不一定返回，仅做兼容兜底
        const paidFee = Number(o.paid_fee || 0)
        const leftFee = Number(o.left_fee != null ? o.left_fee : paidFee)
        const refundFeeLegacy = Number(o.refund_fee || 0)
        const refundOrders = (o.refund_info && Array.isArray(o.refund_info.refund_order)) ? o.refund_info.refund_order : []
        const hasRefundOrder = refundOrders.length > 0 || refundFeeLegacy > 0

        const paid = (paidFee > 0 && Number(o.paid_time) > 0) || o.status === 3 || o.status === 'PAID' || o.status === 'paid'

        // 「退款已到账」最稳信号：left_fee = 0 且至少发起过一次退款
        const fullyRefunded = (paidFee > 0 && leftFee === 0 && hasRefundOrder)
        // 「部分退款」：剩余 > 0 但 < 实付
        const partRefund = (paidFee > 0 && leftFee > 0 && leftFee < paidFee)
        // 「正在退款中」：发起过退款但 left_fee 还没扣减
        const refundOngoing = (hasRefundOrder && leftFee === paidFee)

        console.log('[queryVPayOrder] refund-diag:', JSON.stringify({
          outTradeNo,
          local_status: order.status,
          status: o.status,
          paid_fee: paidFee,
          left_fee: leftFee,
          has_refund_order: hasRefundOrder,
          fully_refunded: fullyRefunded,
          part_refund: partRefund,
          refund_ongoing: refundOngoing
        }))

        if (fullyRefunded) {
          remoteStatus = 'REFUNDED'
        } else if (partRefund) {
          remoteStatus = 'PART_REFUND'
        } else if (refundOngoing) {
          remoteStatus = 'REFUND_PENDING'
        } else if (paid) {
          // 守门：订单本地已在 refund_pending，但微信侧 left_fee 暂未变化时，绝不回退到 paid
          if (order.status === 'refund_pending') remoteStatus = 'REFUND_PENDING'
          else remoteStatus = 'PAID'
        }
      }
    } catch (e) {
      console.error('[queryVPayOrder] https error:', e && (e.message || e))
    }
  }

  // 业务上：消息推送回调是真正的发货依据；此处仅做状态查询 + 兜底发货 / 兜底退款确认
  if (remoteStatus === 1 || remoteStatus === '1' || remoteStatus === 'PAID') {
    if (order.status !== 'paid') {
      // 原子翻转 pending → paid：与推送回调竞争时只有一方能成功，成功方才发货
      let claimed = false
      try {
        const flip = await db.collection(ORDER_COLLECTION)
          .where({ _id: outTradeNo, status: 'pending' })
          .update({
            data: { status: 'paid', paidAt: db.serverDate(), deliveredAt: db.serverDate(), updatedAt: db.serverDate() }
          })
        claimed = !!(flip && flip.stats && flip.stats.updated === 1)
      } catch (e) {
        console.error('[queryVPayOrder] mark paid error:', outTradeNo, e && (e.message || e))
      }
      if (claimed) {
        try {
          // 重新拉一次最新订单数据再发货，避免 order 对象过旧
          const latest = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
          await applyPaidOrder(latest.data || order)
        } catch (e) {
          console.error('[queryVPayOrder] applyPaidOrder error:', e && (e.message || e))
        }
      }
      return { status: 'paid', order }
    }
  }

  // 微信侧已确认全额退款到账 → 同步本地 refund_pending → refunded，并回收 PRO 权益
  if (remoteStatus === 'REFUNDED' && order.status !== 'refunded') {
    // 原子翻转 → refunded：与退款推送回调竞争时只有一方能成功，成功方才回滚权益
    let claimed = false
    try {
      const flip = await db.collection(ORDER_COLLECTION)
        .where({ _id: outTradeNo, status: _.in(['pending', 'refund_pending']) })
        .update({
          data: { status: 'refunded', refundedAt: db.serverDate(), updatedAt: db.serverDate() }
        })
      claimed = !!(flip && flip.stats && flip.stats.updated === 1)
    } catch (e) {
      console.error('[queryVPayOrder] mark refunded error:', e && (e.message || e))
    }
    // 关键：回收用户 PRO 权益（订阅回滚天数 / 单品 pull purchases）；
    // 订阅单从未发货（无 deliveredAt）时禁止回滚天数；产品单 pull 为幂等空操作，始终允许
    if (claimed) {
      try {
        const latestRes = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
        const latestOrder = (latestRes && latestRes.data) || order
        if (latestOrder.deliveredAt || latestOrder.orderType === 'product') {
          console.log('[queryVPayOrder] applyRefundedOrder for:', outTradeNo, 'orderType:', latestOrder.orderType, 'days:', latestOrder.days, 'productId:', latestOrder.productId)
          await applyRefundedOrder(latestOrder)
          console.log('[queryVPayOrder] applyRefundedOrder OK for:', outTradeNo)
        } else {
          console.log('[queryVPayOrder] skip rollback（订单未发货）:', outTradeNo)
        }
      } catch (e) {
        console.error('[queryVPayOrder] applyRefundedOrder error:', e && (e.message || e))
      }
    }
    return { status: 'refunded', order }
  }

  return { status: order.status || 'pending', order }
}

// ── 退款（管理员触发，调 /xpay/refund_order）──
async function vpayRefund(callerOpenid, outTradeNo, refundFee, reason, fromAdmin) {
  console.log('[vpayRefund] called by:', callerOpenid, 'fromAdmin:', !!fromAdmin, 'whitelist size:', ADMIN_OPENIDS.length, 'list:', JSON.stringify(ADMIN_OPENIDS))
  // adminGateway 已校验后台管理员权限，免白名单；否则要求 caller 在 VPAY_ADMIN_OPENIDS
  if (!fromAdmin) {
    if (!ADMIN_OPENIDS.length || ADMIN_OPENIDS.indexOf(callerOpenid) === -1) {
      console.warn('[vpayRefund] denied: caller not in VPAY_ADMIN_OPENIDS')
      return { error: '无权操作' }
    }
  }
  let order
  try {
    const res = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
    order = res.data
  } catch (e) {
    return { error: '订单不存在' }
  }
  if (!order) return { error: '订单不存在' }
  if (order.status !== 'paid') return { error: '仅已支付订单可退款' }

  const fee = Number(refundFee != null ? refundFee : order.amount)
  if (!fee || fee <= 0) return { error: '退款金额无效' }

  const refundOutTradeNo = 'R' + Date.now() + Math.random().toString(36).slice(2, 8)
  const vpayCfg = await getEffectiveVPayConfig()
  const offerId = resolveOrderOfferId(order, vpayCfg.offerId)
  const vpayEnv = resolveOrderVPayEnv(order, vpayCfg.env)

  let apiRes = null
  let apiSuccess = false

  // 路径 1：云调用 cloud.openapi.midasPayment.refundOrder
  try {
    if (cloud.openapi && cloud.openapi.midasPayment && cloud.openapi.midasPayment.refundOrder) {
      apiRes = await cloud.openapi.midasPayment.refundOrder({
        offerId,
        ts: Math.floor(Date.now() / 1000),
        env: vpayEnv,
        outTradeNo,
        refundOutTradeNo,
        amount: fee,
        userIp: '127.0.0.1',
        reason: reason || '人工退款'
      })
      apiSuccess = !!(apiRes && (apiRes.errCode === 0 || apiRes.errcode === 0))
      console.log('[vpayRefund] cloud.openapi result:', JSON.stringify(apiRes || {}))
    } else {
      console.warn('[vpayRefund] cloud.openapi.midasPayment.refundOrder not available')
    }
  } catch (e) {
    console.warn('[vpayRefund] cloud.openapi error:', e && (e.message || e))
  }

  // 路径 2：HTTPS 直连 /xpay/refund_order（云调用不可用时兜底）
  if (!apiSuccess) {
    try {
      const httpsRes = await httpsRefundOrder(
        order.openid,
        outTradeNo,
        refundOutTradeNo,
        fee,
        reason || '人工退款',
        vpayEnv
      )
      console.log('[vpayRefund] https response:', JSON.stringify(httpsRes || {}))
      if (httpsRes && (httpsRes.errcode === 0 || httpsRes.errCode === 0)) {
        apiRes = httpsRes
        apiSuccess = true
      } else {
        return { error: '退款失败：' + JSON.stringify(httpsRes || {}) }
      }
    } catch (e) {
      console.error('[vpayRefund] https error:', e && (e.message || e))
      return { error: '退款失败：' + (e.message || String(e)) }
    }
  }

  await db.collection(ORDER_COLLECTION).doc(outTradeNo).update({
    data: {
      status: 'refund_pending',
      refundOutTradeNo,
      refundFee: fee,
      refundReason: reason || '',
      refundRequestAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  return { success: true, refundOutTradeNo, apiRes: apiRes || null }
}

// ── 虚拟支付消息推送回调 ──
// 事件类型：xpay_goods_deliver_notify / xpay_coin_pay_notify / xpay_refund_notify
async function vpayMessageCallback(event) {
  const eventType = event.Event || event.event || ''
  // 道具发货（现金购买道具支付成功）
  if (eventType === 'xpay_goods_deliver_notify') {
    const outTradeNo = event.OutTradeNo || (event.GoodsInfo && event.GoodsInfo.OutTradeNo) || ''
    if (!outTradeNo) {
      console.error('[vpayCallback] xpay_goods_deliver_notify missing OutTradeNo, event:', JSON.stringify(event).slice(0, 500))
      return { errcode: 0, errmsg: 'SUCCESS' }
    }
    let order
    try {
      const res = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
      order = res.data
    } catch (e) {
      console.error('[vpayCallback] order not found:', outTradeNo)
      return { errcode: 0, errmsg: 'SUCCESS' }
    }
    if (!order) return { errcode: 0, errmsg: 'SUCCESS' }
    if (order.status === 'paid') return { errcode: 0, errmsg: 'SUCCESS' }

    const vpayCfg = await getEffectiveVPayConfig()
    const offerId = resolveOrderOfferId(order, vpayCfg.offerId)
    const vpayEnv = resolveOrderVPayEnv(order, vpayCfg.env)

    // 发货前向微信侧 query_order 二次确认已支付（防伪造回调）；
    // 查询本身不可用（如未配置 access_token）时信任已验源的推送，不阻塞真实发货
    try {
      const q = await httpsQueryOrder(order.openid, outTradeNo, vpayEnv)
      if (q && q.errcode === 0 && q.order) {
        const o = q.order
        const confirmedPaid = (Number(o.paid_fee || 0) > 0 && Number(o.paid_time) > 0) || o.status === 3
        if (!confirmedPaid) {
          console.error('[vpayCallback] query_order 未确认支付，拒绝发货:', outTradeNo, JSON.stringify(o).slice(0, 300))
          return { errcode: 0, errmsg: 'SUCCESS' }
        }
      }
    } catch (e) {
      console.warn('[vpayCallback] query_order 确认失败（来源已验证，继续发货）:', e && (e.message || e))
    }

    // 原子翻转 pending → paid：推送回调与客户端查单可能并发，
    // 只有条件更新成功（updated === 1）的一方才允许发货，杜绝重复加天数
    let claimed = false
    try {
      const flip = await db.collection(ORDER_COLLECTION)
        .where({ _id: outTradeNo, status: _.in(['pending', 'cancelled']) })
        .update({
          data: {
            status: 'paid',
            paidAt: db.serverDate(),
            deliveredAt: db.serverDate(),
            updatedAt: db.serverDate(),
            wxOrderId: event.WxOrderId || event.OrderId || ''
          }
        })
      claimed = !!(flip && flip.stats && flip.stats.updated === 1)
    } catch (e) {
      console.error('[vpayCallback] flip to paid error:', outTradeNo, e && (e.message || e))
    }

    if (claimed) {
      try { await applyPaidOrder(order) } catch (e) {
        console.error('[vpayCallback] applyPaidOrder error:', e && (e.message || e))
      }
    }

    // 通知微信「已发货完成」（部分场景需要）
    try {
      if (cloud.openapi && cloud.openapi.midasPayment && cloud.openapi.midasPayment.notifyProvideGoods) {
        await cloud.openapi.midasPayment.notifyProvideGoods({
          offerId,
          env: vpayEnv,
          outTradeNo
        })
      }
    } catch (e) {}

    return { errcode: 0, errmsg: 'SUCCESS' }
  }

  // 退款通知
  if (eventType === 'xpay_refund_notify') {
    const outTradeNo = event.MchOrderId || event.OutTradeNo || ''
    const retCode = event.RetCode != null ? Number(event.RetCode) : 0
    if (!outTradeNo) return { errcode: 0, errmsg: 'SUCCESS' }
    let order
    try {
      const res = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get()
      order = res.data
    } catch (e) {
      return { errcode: 0, errmsg: 'SUCCESS' }
    }
    if (!order) return { errcode: 0, errmsg: 'SUCCESS' }
    if (retCode !== 0) {
      try {
        await db.collection(ORDER_COLLECTION).doc(outTradeNo).update({
          data: { status: 'refund_failed', refundError: event.RetMsg || '', updatedAt: db.serverDate() }
        })
      } catch (e) {
        console.error('[vpayCallback] mark refund_failed error:', outTradeNo, e && (e.message || e))
      }
      return { errcode: 0, errmsg: 'SUCCESS' }
    }
    if (order.status === 'refunded') return { errcode: 0, errmsg: 'SUCCESS' }

    // 原子翻转 → refunded：与 queryVPayOrder 的退款确认可能并发，只有成功方回滚权益
    let claimed = false
    try {
      const flip = await db.collection(ORDER_COLLECTION)
        .where({ _id: outTradeNo, status: _.in(['pending', 'paid', 'refund_pending']) })
        .update({
          data: {
            status: 'refunded',
            refundedAt: db.serverDate(),
            updatedAt: db.serverDate(),
            wxRefundId: event.WxRefundId || ''
          }
        })
      claimed = !!(flip && flip.stats && flip.stats.updated === 1)
    } catch (e) {
      console.error('[vpayCallback] mark refunded error:', outTradeNo, e && (e.message || e))
    }

    // 订阅单从未发货（无 deliveredAt）时禁止回滚天数；产品单 pull 为幂等空操作，始终允许
    if (claimed && (order.deliveredAt || order.orderType === 'product')) {
      try { await applyRefundedOrder(order) } catch (e) {
        console.error('[vpayCallback] applyRefundedOrder error:', outTradeNo, e && (e.message || e))
      }
    }
    return { errcode: 0, errmsg: 'SUCCESS' }
  }

  // 代币支付（本项目暂不使用，留兜底）
  if (eventType === 'xpay_coin_pay_notify') {
    return { errcode: 0, errmsg: 'SUCCESS' }
  }

  return { errcode: 0, errmsg: 'SUCCESS' }
}

// ── 订单记录：当前用户订单列表（按创建时间倒序，最多 50 条，仅返回展示所需字段） ──
async function listOrders(openid) {
  if (!openid) return { error: '未登录' }
  try {
    const res = await db.collection(ORDER_COLLECTION)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .field({
        _id: true,
        amount: true,
        description: true,
        status: true,
        orderType: true,
        planId: true,
        days: true,
        productId: true,
        createdAt: true,
        paidAt: true,
        refundedAt: true,
        refundFee: true
      })
      .get()
    return { orders: res.data || [] }
  } catch (e) {
    // 集合不存在（用户从未下过单）等场景按空列表处理
    return { orders: [] }
  }
}

// ── 订单记录：删除单条记录（仅限本人订单；退款处理中的订单禁止删除，避免售后凭证丢失） ──
async function deleteOrder(openid, orderId) {
  if (!openid) return { error: '未登录' }
  if (!orderId) return { error: '缺少订单号' }
  try {
    const res = await db.collection(ORDER_COLLECTION).doc(String(orderId)).get()
    const order = res && res.data
    if (!order || order.openid !== openid) return { error: '订单不存在' }
    // 待支付订单可能仍会被支付回调发货，删除会导致已付款却无法核销；退款中订单是售后凭证
    if (order.status === 'pending') return { error: '待支付订单暂不能删除，可等其自动关闭' }
    if (order.status === 'refund_pending') return { error: '退款处理中的订单暂不能删除' }
    await db.collection(ORDER_COLLECTION).doc(String(orderId)).remove()
    return { success: true }
  } catch (e) {
    return { error: '删除失败，请稍后再试' }
  }
}

// ══════════════ 邀请得月卡 ══════════════
// 规则：好友点开分享（path 带 inviter）即计 1 次有效邀请；每个 openid 一生只能被计一次
// （invite_records 以被邀人 openid 为 _id 天然原子去重）；每满 INVITE_CARD_THRESHOLD（15）人
// 自动给邀请人发 1 张 30 天月卡（applyPaidOrder 时长自动叠加），全程幂等无需人工。
const INVITE_RECORD_COLLECTION = 'invite_records'
const INVITE_STATS_COLLECTION = 'invite_stats'
const INVITE_CARD_THRESHOLD = 15
const INVITE_CARD_DAYS = 30

async function ensureInviteCollections() {
  try { await db.createCollection(INVITE_RECORD_COLLECTION) } catch (e) {}
  try { await db.createCollection(INVITE_STATS_COLLECTION) } catch (e) {}
}

/** openid 形态校验（微信 openid 为 28 位左右的 URL-safe 字符串），防止脏参数入库 */
function isValidOpenidShape(s) {
  return typeof s === 'string' && /^[-_A-Za-z0-9]{16,64}$/.test(s)
}

/** 邀请人计数 +1：先 update inc，文档不存在再 add，add 撞并发冲突后重试 update */
async function incInviteCount(inviter) {
  const col = db.collection(INVITE_STATS_COLLECTION)
  const upd = await col.doc(inviter).update({
    data: { validCount: _.inc(1), updatedAt: db.serverDate() }
  }).catch(() => null)
  if (upd && upd.stats && upd.stats.updated > 0) return
  try {
    await col.add({
      data: {
        _id: inviter,
        validCount: 1,
        cardsGranted: 0,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
  } catch (e) {
    // 并发下另一请求刚创建了文档 → 冲突后重试一次 inc
    await col.doc(inviter).update({
      data: { validCount: _.inc(1), updatedAt: db.serverDate() }
    }).catch(() => null)
  }
}

/**
 * 结算发卡：应发 = floor(validCount / 15) 与 cardsGranted 差额补发。
 * 用「cardsGranted 等于旧值才更新」的条件更新抢占结算权，并发时只有一个请求真正发卡。
 */
async function settleInviteRewards(inviter) {
  const col = db.collection(INVITE_STATS_COLLECTION)
  let statDoc = null
  try {
    const res = await col.doc(inviter).get()
    statDoc = res && res.data
  } catch (e) {}
  if (!statDoc) return

  const validCount = Number(statDoc.validCount) || 0
  const granted = Number(statDoc.cardsGranted) || 0
  const due = Math.floor(validCount / INVITE_CARD_THRESHOLD)
  if (due <= granted) return

  // 抢占：cardsGranted 仍是旧值才允许本请求结算，防并发重复发放
  const claim = await col.where({ _id: inviter, cardsGranted: granted }).update({
    data: { cardsGranted: due, updatedAt: db.serverDate() }
  }).catch(() => null)
  if (!claim || !claim.stats || claim.stats.updated <= 0) return

  // 差额逐张发放：每张一条 I* 审计订单 + applyPaidOrder（到期时间自动叠加）
  for (let i = granted; i < due; i++) {
    const outTradeNo = 'I' + Date.now() + Math.random().toString(36).slice(2, 8)
    const orderRecord = {
      _id: outTradeNo,
      openid: inviter,
      amount: 0,
      description: '邀请奖励 - 邀满 ' + ((i + 1) * INVITE_CARD_THRESHOLD) + ' 位好友赠月卡',
      status: 'paid',
      orderType: 'subscription',
      grantReason: 'invite_reward',
      planId: 'monthly',
      days: INVITE_CARD_DAYS,
      paidAt: db.serverDate(),
      deliveredAt: db.serverDate(),
      createdAt: db.serverDate()
    }
    try {
      await db.collection(ORDER_COLLECTION).add({ data: orderRecord })
      await applyPaidOrder(orderRecord)
    } catch (e) {
      // 单张失败：回滚该张的 cardsGranted 占位，下次 claimInvite/getInviteState 结算时补发
      console.error('[settleInviteRewards] 发卡失败:', inviter, e && (e.message || e))
      await col.doc(inviter).update({
        data: { cardsGranted: _.inc(-1), updatedAt: db.serverDate() }
      }).catch(() => null)
    }
  }
}

/** 被邀端核销：写唯一记录 → 邀请人计数 +1 → 结算发卡 */
async function claimInvite(openid, inviterRaw) {
  if (!openid) return { success: false, reason: 'no_openid' }
  const inviter = String(inviterRaw || '').trim()
  if (!isValidOpenidShape(inviter)) return { success: false, reason: 'bad_inviter' }
  if (inviter === openid) return { success: false, reason: 'self_invite' }

  await ensureInviteCollections()
  try {
    await db.collection(INVITE_RECORD_COLLECTION).add({
      data: { _id: openid, inviter, createdAt: db.serverDate() }
    })
  } catch (e) {
    // _id 冲突 = 该用户此前已被计过（不论邀请人是谁），静默返回
    return { success: false, reason: 'duplicated' }
  }

  await incInviteCount(inviter)
  await settleInviteRewards(inviter)
  return { success: true }
}

/** 邀请页状态：进度 + 最近记录（脱敏，仅返回时间） */
async function getInviteState(openid) {
  if (!openid) return { error: '未登录' }
  await ensureInviteCollections()

  let validCount = 0
  let cardsGranted = 0
  try {
    const res = await db.collection(INVITE_STATS_COLLECTION).doc(openid).get()
    if (res && res.data) {
      validCount = Number(res.data.validCount) || 0
      cardsGranted = Number(res.data.cardsGranted) || 0
    }
  } catch (e) {}

  // 打开邀请页时兜底结算一次（防止 claimInvite 链路上一次发卡失败漏发）
  if (Math.floor(validCount / INVITE_CARD_THRESHOLD) > cardsGranted) {
    await settleInviteRewards(openid)
    try {
      const res = await db.collection(INVITE_STATS_COLLECTION).doc(openid).get()
      if (res && res.data) cardsGranted = Number(res.data.cardsGranted) || 0
    } catch (e) {}
  }

  let records = []
  try {
    const res = await db.collection(INVITE_RECORD_COLLECTION)
      .where({ inviter: openid })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .field({ createdAt: true })
      .get()
    records = (res.data || []).map((r) => ({ createdAt: r.createdAt || null }))
  } catch (e) {}

  return {
    openid,
    validCount,
    cardsGranted,
    threshold: INVITE_CARD_THRESHOLD,
    cardDays: INVITE_CARD_DAYS,
    records
  }
}

// 旧普通微信支付回调入口（保留兼容，但已停用）
async function legacyPayCallback(event) {
  console.warn('[legacyPayCallback] 旧普通微信支付回调已停用，event:', JSON.stringify(event).slice(0, 300))
  return { errcode: 0, errmsg: 'SUCCESS' }
}

// ── 主入口 ──
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action

  // 虚拟支付消息推送回调（仅接受微信服务端推送；小程序端伪造事件直接拒绝）
  if (event.Event && typeof event.Event === 'string' && event.Event.startsWith('xpay_')) {
    if (!isServerSideInvocation()) {
      console.warn('[main] 拦截疑似伪造的 xpay 回调，OPENID:', OPENID, 'Event:', event.Event)
      return { errcode: -1, errmsg: 'FORBIDDEN' }
    }
    return await vpayMessageCallback(event)
  }
  // 旧普通微信支付回调（容错）
  if (event.resultCode !== undefined || event.result_code !== undefined || event.return_code !== undefined) {
    return await legacyPayCallback(event)
  }

  switch (action) {
    case 'getOpenid':
      return { openid: OPENID }
    case 'getState':
      return { data: await getState(OPENID) }
    case 'recordUsage':
      return await recordUsage(OPENID, event.usageType)
    case 'getEffectivePrices':
      return { prices: await getAllEffectivePrices() }
    case 'clearPriceCache':
      // 仅云函数间调用（adminGateway 改价 / 改 offerId·env 后通知）可清缓存
      if (!isServerSideInvocation()) return { error: '无权操作' }
      clearPriceCache()
      return { success: true }
    case 'claimInvite':
      return await claimInvite(OPENID, event.inviter)
    case 'getInviteState':
      return await getInviteState(OPENID)
    case 'createVPayOrder':
      return await createVPayOrder(OPENID, event.vpayProductId, event.code)
    case 'listOrders':
      return await listOrders(OPENID)
    case 'deleteOrder':
      return await deleteOrder(OPENID, event.orderId)
    case 'queryVPayOrder': {
      // fromAdminGateway 仅在云函数间调用链路可信，客户端传入无效
      const fromAdmin = event.fromAdminGateway === true && isServerSideInvocation()
      return await queryVPayOrder(OPENID, event.outTradeNo, event.overrideOpenid, fromAdmin)
    }
    case 'vpayRefund': {
      const fromAdmin = event.fromAdminGateway === true && isServerSideInvocation()
      const caller = fromAdmin ? '__admin_gateway__' : (event.callerOpenid || OPENID)
      console.log('[vpayRefund] case: fromAdmin=', fromAdmin, 'caller=', caller, 'adminUsername=', event.adminUsername || '', 'adminId=', event.adminId || '')
      return await vpayRefund(caller, event.outTradeNo, event.refundFee, event.reason, fromAdmin)
    }
    case 'createOrder':
      return { error: '已停用：请使用虚拟支付（createVPayOrder）' }
    default:
      return { error: '未知操作: ' + action }
  }
}

// 暴露给同环境其他云函数（adminGateway「自动修复」与人工赠送复用）
exports.applyPaidOrder = applyPaidOrder
exports.applyRefundedOrder = applyRefundedOrder
exports.VPAY_PRODUCTS = VPAY_PRODUCTS
