/**
 * 火箭观礼服务（文昌观礼点）
 *
 * 公开接口（小程序端，openid 鉴别用户）：
 *   - 观礼场次查询 / 免费预约登记 / 取消预约
 *   - 现场扫码解锁抽奖资格（scene 码，按渠道统计）
 *   - 现场奖品抽奖（商家自配奖品，按剩余库存加权）
 *   - 我的奖品 / 分享加抽
 *   - 大屏页只读数据
 *
 * 管理接口（perm: watch_party）：
 *   - 全局开关（终止合作一键关停，公开接口全部下线，仅保留用户奖品查看）
 *   - 合作商家（观礼点）CRUD：入驻/暂停/终止，场次挂靠商家，商家非 active 即整体下线
 *   - 商家会员计费（试行默认关）：merchantMembershipBillingEnabled 一键开收费；
 *     未缴费商家宽限至下月 1 号后自动终止；运营可续费 1 月/1 季/1 年（系统算截止日期）
 *   - 同行推荐成功：推荐人赠 1 个月商家会员（原价 188 元/月）
 *   - 按商家授权「扫码赠通行证」（passGrantEnabled，默认关）：与商家场次开关双开才发证
 *   - 场次总览 / 预约名单与核销 / 发放记录 / 数据统计（奖品由商家小程序配置，后台只读）
 *   - 现场物料小程序码生成（wxacode.getUnlimited，scene: wp:<场次码>:<渠道>）
 *
 * 集合：
 *   watch_party_config       全局配置（单文档 _id=global：enabled / closedNotice / 商家会员收费开关）
 *   watch_party_merchants    合作商家（观礼点），status: active/paused/terminated；membershipExpireAt 会员截止
 *   watch_party_merchant_leads 同行商家合作申请（观礼页提交，带推荐商家归属，后台审核一键入驻）
 *   watch_party_sessions     场次（含 prizeDrawEnabled / prizes；code 为短码）
 *   watch_party_reservations 预约记录
 *   souvenir_cards           旧纪念卡卡池（抽奖已不再使用，管理入口已下线）
 *   souvenir_draws           奖品发放记录
 *   souvenir_draw_quota      每人每场次·每任务周期抽奖资格（_id = sessionId_cycleId_openid）
 *
 * 任务周期（一商家一码）：
 *   - 短码/物料码随场次永久复用；商家点「开启下一场」归档 stats 到 cycleHistory 并开新周期
 *   - 热路径 stats / successUnlockedAt / 任务字段 = 仅当前周期
 */

const SESSIONS = 'watch_party_sessions'
const RESERVATIONS = 'watch_party_reservations'
const CARDS = 'souvenir_cards'
const DRAWS = 'souvenir_draws'
const QUOTA = 'souvenir_draw_quota'
const MERCHANTS = 'watch_party_merchants'
const CONFIG = 'watch_party_config'
const LEADS = 'watch_party_merchant_leads'
/** 任务显示名（商家自定义中文名，_id = missionId；仅该任务下最早入驻的商家可改） */
const MISSION_NAMES = 'watch_party_mission_names'
const GLOBAL_CONFIG_ID = 'global'

/** 预约防刷：openid 24h 全站创建上限；同场次取消后再约冷却 */
const RESERVE_OPENID_24H_MAX = 5
const RESERVE_OPENID_24H_MS = 24 * 60 * 60 * 1000
const RESERVE_CANCEL_COOLDOWN_MS = 60 * 1000
/** 预约自动截止：发射前 30 分钟停止新预约（商家备场/核对名单窗口）；发射时间待定的场次不自动截止 */
const RESERVE_CLOSE_BEFORE_MS = 30 * 60 * 1000
/** IP / 设备短窗：容器内存粗限流（零 DB，挡脚本连打；跨实例靠 openid 日限兜底） */
const RESERVE_IP_WINDOW_MS = 60 * 1000
const RESERVE_IP_MAX = 30
const RESERVE_DEVICE_WINDOW_MS = 60 * 1000
const RESERVE_DEVICE_MAX = 20
const RESERVE_RATE_MEM_MAX = 400

const MERCHANT_STATUSES = ['active', 'paused', 'terminated']
/** 商家会员原价（元/月）；推荐成功赠 1 个月；后台续费按月/季/年叠加截止日期 */
const MERCHANT_MEMBERSHIP_PRICE_YUAN = 188
const MERCHANT_MEMBERSHIP_RENEW_MONTHS = { month: 1, quarter: 3, year: 12 }
const MERCHANT_MEMBERSHIP_PAY_NOTICE = '请联系运营人员缴费开通商家会员（' + MERCHANT_MEMBERSHIP_PRICE_YUAN + '元/月）'
/** 容器内配置/商家缓存 TTL（发射现场高并发时省读；后台改开关后其他容器最多延迟 30s 生效） */
const GATE_CACHE_TTL = 30 * 1000

/** 商家固定编号：后台生成、运营复制发给入驻商家，商家在小程序端凭编号绑定身份（字符集去 0/O/1/I/L 易混淆） */
const MERCHANT_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MERCHANT_CODE_LEN = 8
/** 每个商家最多绑定的员工微信数 */
const MERCHANT_STAFF_MAX = 10
/** 商家自建场次短码字符集（scene 用，小写） */
const SESSION_CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'

/** 场次科普配置图（商家手机相册上传）：数量与单条地址长度上限 */
const SCIENCE_IMAGES_MAX = 10
/** 现场奖品：每场最多条数 */
const PRIZES_MAX = 20
/** 现场照片（顾客页展示）：每场最多张数 */
const SITE_PHOTOS_MAX = 8
/** 微信群二维码：每场最多张数 */
const WECHAT_QRS_MAX = 2
/** 每位商家最多可同时持有的场次数（同月多次发射各建一场） */
const MERCHANT_SESSIONS_MAX = 10

/** 商家可选服务套餐（固定目录，多选） */
const SESSION_SERVICE_CATALOG = [
  { id: 'viewing', label: '发射观礼' },
  { id: 'viewing_factory', label: '发射观礼+火箭工厂参观' },
  { id: 'viewing_factory_stay', label: '发射观礼+火箭工厂参观+住宿' },
  { id: 'charter', label: '包车服务' }
]
const SESSION_SERVICE_IDS = SESSION_SERVICE_CATALOG.map((s) => s.id)

// ── LL2 即将发射缓存（与 apiProxy/agent-actions、syncSpaceDevsData 同一套落库约定） ──
const SPACE_DEVS_COL = 'space_devs_cache'
const LL2_UPCOMING_PATH = '/launches/upcoming/'
const LL2_UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const LL2_PREVIOUS_PATH = '/launches/previous/'
const LL2_PREVIOUS_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}
const LL2_SLIM_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

/** 旧纪念卡稀有度（仅兼容历史发放记录展示） */
const RARITIES = ['N', 'R', 'SR', 'SSR']

/** 观礼通行证：现场扫码临时免除会员门控（默认关闭；开启后默认 12h，最高 48h） */
const PASS_DEFAULT_HOURS = 12
const PASS_MAX_HOURS = 48
/** 有发射时间的场次，仅发射前后 48h 内发证（物料码照片外泄时缩小滥用窗口） */
const PASS_GRANT_WINDOW_MS = 48 * 3600 * 1000
/** 旧场次无 currentCycleId 时的兼容周期 id */
const LEGACY_CYCLE_ID = 'c0'
/** 归档周期历史条数上限（超出丢弃最旧） */
const CYCLE_HISTORY_MAX = 50

// ── 小程序码 HTTP 直连（管理后台链路专用） ─────────────────────────────
// 管理后台经「HTTP 访问服务」调用本函数，链路上没有小程序上下文，微信不下发
// wxCloudApiToken，cloud.openapi 云调用必报 -501007 Invalid wxCloudApiToken。
// 此时走官方 HTTP API：环境变量凭证换 stable_token 再调 getwxacodeunlimit。
// stable_token 普通模式不刷新已有 token，不会顶掉 sendLaunchReminder/membership 缓存的 token。

const https = require('https')

const DEFAULT_MP_APPID = 'wxf98b58309019771b'

/** 凭证解析：兼容 sendLaunchReminder（APPID+SECRET / MP_CREDENTIALS / wx键名JSON）与 membership（WX_APPSECRET）的既有约定 */
function pickMpCredentials() {
  for (const k of ['MP_CREDENTIALS', 'WX_MINI_CREDENTIALS']) {
    const raw = String(process.env[k] || '').trim()
    if (!raw) continue
    try {
      const o = JSON.parse(raw)
      const appid = String(o.appid || o.APPID || o.appId || '').trim()
      const secret = String(o.secret || o.SECRET || o.appSecret || o.app_secret || '').trim()
      if (appid && secret) return { appid, secret }
      const wxEntries = Object.entries(o).filter((ent) => /^wx[0-9a-f]{16}$/i.test(ent[0]))
      if (wxEntries.length === 1 && String(wxEntries[0][1] || '').trim().length >= 16) {
        return { appid: wxEntries[0][0], secret: String(wxEntries[0][1]).trim() }
      }
    } catch (e) {}
  }
  const appid = String(
    process.env.APPID || process.env.WX_APPID || process.env.MINIPROGRAM_APPID ||
    process.env.WECHAT_APPID || process.env.WECHAT_MP_APPID || ''
  ).trim() || DEFAULT_MP_APPID
  const secret = String(
    process.env.SECRET || process.env.WX_SECRET || process.env.WX_APPSECRET ||
    process.env.MINIPROGRAM_SECRET || process.env.APP_SECRET || process.env.WECHAT_SECRET || ''
  ).trim()
  if (secret) return { appid, secret }
  // 腾讯云 JSON 合并环境变量：键名即 AppID、值即 Secret
  const wxKeys = Object.keys(process.env).filter(
    (k) => /^wx[0-9a-f]{16}$/i.test(k) && String(process.env[k] || '').trim().length >= 16
  )
  if (wxKeys.length === 1) return { appid: wxKeys[0], secret: String(process.env[wxKeys[0]]).trim() }
  return null
}

function httpPostRaw(url, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = Buffer.from(JSON.stringify(bodyObj))
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: 15000
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: String(res.headers['content-type'] || '')
      }))
    })
    req.on('timeout', () => req.destroy(new Error('请求微信接口超时')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

let _mpTokenCache = { token: '', expireAt: 0 }

async function getMpAccessToken(force) {
  if (!force && _mpTokenCache.token && Date.now() < _mpTokenCache.expireAt - 60 * 1000) {
    return _mpTokenCache.token
  }
  const cred = pickMpCredentials()
  if (!cred) {
    throw new Error(
      '管理后台生成小程序码需配置小程序凭证：在 adminGateway 云函数环境变量中添加 ' +
      'APPID + SECRET（或 MP_CREDENTIALS={"appid":"wx...","secret":"..."}），保存后重新部署生效'
    )
  }
  const res = await httpPostRaw('https://api.weixin.qq.com/cgi-bin/stable_token', {
    grant_type: 'client_credential',
    appid: cred.appid,
    secret: cred.secret
  })
  let data = null
  try { data = JSON.parse(res.buffer.toString('utf8')) } catch (e) {}
  if (!data || !data.access_token) {
    throw new Error('获取小程序 access_token 失败: ' + (data ? JSON.stringify(data) : '微信接口响应异常'))
  }
  const ttlSec = Math.max(60, (Number(data.expires_in) || 7200) - 300)
  _mpTokenCache = { token: data.access_token, expireAt: Date.now() + ttlSec * 1000 }
  return _mpTokenCache.token
}

/** HTTP 直连 getwxacodeunlimit：成功返回图片 buffer，失败抛错（40001/42001 强刷 token 重试一次） */
async function fetchWxacodeViaHttp(params, retried) {
  const token = await getMpAccessToken(!!retried)
  const res = await httpPostRaw(
    'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(token),
    params
  )
  if (res.contentType.indexOf('image') >= 0) {
    return { buffer: res.buffer, contentType: res.contentType }
  }
  let data = null
  try { data = JSON.parse(res.buffer.toString('utf8')) } catch (e) {}
  const errcode = Number(data && data.errcode)
  if (!retried && (errcode === 40001 || errcode === 42001)) {
    return fetchWxacodeViaHttp(params, true)
  }
  throw new Error('getwxacodeunlimit 失败: ' + (data ? JSON.stringify(data) : '微信接口响应异常'))
}

function createWatchPartyApi({ db, _, ok, fail, now, writeOpLog, cloud, checkPerm }) {
  // ── 全局开关 / 商家门控 ──

  let _cfgCache = { at: 0, doc: null }
  /** global_config.main.enableWatchParty 缓存（过审总闸） */
  let _mainFlagCache = { at: 0, on: false }
  const _merchantCache = {}
  /**
   * 入口场次结果缓存：getPublicConfig 是最高频公开接口（每个首页用户都会触发），
   * 原实现每次调用要读 ≤10 个场次文档。缓存 30s 后：每容器每 30s 才扫一次表，
   * 后台任何变更（场次/商家/全局开关）都会即时清缓存（同容器立即生效，跨容器 ≤30s）。
   */
  let _entryCache = { at: 0, has: false, data: null }
  /** 公开列表短缓存：key = missionId|limit|summary */
  let _listCache = Object.create(null)

  async function getGlobalConfigDoc() {
    if (Date.now() - _cfgCache.at < GATE_CACHE_TTL) return _cfgCache.doc
    const res = await db.collection(CONFIG).doc(GLOBAL_CONFIG_ID).get().catch(() => null)
    _cfgCache = { at: Date.now(), doc: (res && res.data) || null }
    return _cfgCache.doc
  }

  /** 商家会员收费是否已开启（试行阶段默认关） */
  async function isMerchantMembershipBillingEnabled() {
    const doc = await getGlobalConfigDoc()
    return !!(doc && doc.merchantMembershipBillingEnabled === true)
  }

  /** 下月 1 日 00:00（云函数环境为东八区）本地时间戳 */
  function nextMonthFirstTs(fromTs) {
    const d = new Date(typeof fromTs === 'number' ? fromTs : now())
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime()
  }

  /** 从基准时间叠加 N 个自然月（按日钳制，避免 1/31+1月溢出到 3 月） */
  function addMonthsTs(baseTs, months) {
    const d = new Date(Math.max(0, Number(baseTs) || 0))
    const day = d.getDate()
    const n = Math.max(0, Number(months) || 0)
    d.setDate(1)
    d.setMonth(d.getMonth() + n)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
    return d.getTime()
  }

  function hasValidMembership(merchant, ts) {
    const t = typeof ts === 'number' ? ts : now()
    return Number((merchant && merchant.membershipExpireAt) || 0) > t
  }

  function isInMembershipGrace(merchant, ts) {
    const t = typeof ts === 'number' ? ts : now()
    return Number((merchant && merchant.membershipGraceUntil) || 0) > t
  }

  function formatMembershipDate(ts) {
    const n = Number(ts) || 0
    if (!n) return ''
    const d = new Date(n)
    if (isNaN(d.getTime())) return ''
    const p = (x) => (x < 10 ? '0' : '') + x
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  }

  function membershipPayNoticeFor(merchant, billingEnabled, ts) {
    if (!billingEnabled || hasValidMembership(merchant, ts)) return ''
    const graceUntil = Number((merchant && merchant.membershipGraceUntil) || 0)
    if (graceUntil > ts) {
      return '商家会员收费已开启，请在 ' + formatMembershipDate(graceUntil)
        + ' 前联系运营人员缴费开通（' + MERCHANT_MEMBERSHIP_PRICE_YUAN
        + '元/月），逾期将自动终止合作'
    }
    return MERCHANT_MEMBERSHIP_PAY_NOTICE
  }

  /**
   * 开启收费时：给尚无有效会员期的合作中/已暂停商家写入「下月 1 日」宽限截止。
   * 已有 membershipExpireAt（含推荐赠送）的不覆盖。
   */
  /** 分页拉取商家；优先 orderBy(createdAt) 保证 skip 稳定，失败则降级无序（商家量通常 <100） */
  async function listMerchantsByStatusPaged(status, skip, limit) {
    const ordered = await db.collection(MERCHANTS)
      .where({ status })
      .orderBy('createdAt', 'asc')
      .skip(skip)
      .limit(limit)
      .get()
      .catch(() => null)
    if (ordered) return ordered.data || []
    const fallback = await db.collection(MERCHANTS)
      .where({ status })
      .skip(skip)
      .limit(limit)
      .get()
      .catch(() => ({ data: [] }))
    return fallback.data || []
  }

  async function seedMembershipGraceForUnpaidMerchants(actor) {
    const ts = now()
    const graceUntil = nextMonthFirstTs(ts)
    let seeded = 0
    for (const status of ['active', 'paused']) {
      let skip = 0
      for (;;) {
        const list = await listMerchantsByStatusPaged(status, skip, 100)
        if (!list.length) break
        for (const m of list) {
          if (hasValidMembership(m, ts)) continue
          const existingGrace = Number(m.membershipGraceUntil || 0)
          if (existingGrace >= graceUntil) continue
          const up = await db.collection(MERCHANTS).doc(m._id).update({
            data: {
              membershipGraceUntil: graceUntil,
              updatedAt: ts,
              updatedBy: (actor && actor.username) || 'system'
            }
          }).catch(() => null)
          if (!up || !up.stats || up.stats.updated < 1) continue
          invalidateGateCache(m._id)
          seeded++
        }
        if (list.length < 100) break
        skip += 100
      }
    }
    return seeded
  }

  /** 推荐成功：给推荐人叠加 1 个月商家会员截止日（从 max(现在, 原截止) 起算） */
  async function grantReferralMembershipReward(referrerMerchantId, meta = {}) {
    if (!referrerMerchantId) return null
    const ref = await findMerchant(referrerMerchantId)
    if (!ref || ref.status === 'terminated') return null
    const ts = now()
    const base = Math.max(ts, Number(ref.membershipExpireAt || 0))
    const membershipExpireAt = addMonthsTs(base, 1)
    const up = await db.collection(MERCHANTS).doc(ref._id).update({
      data: {
        membershipExpireAt,
        membershipGraceUntil: 0,
        referralRewardCount: _.inc(1),
        updatedAt: ts,
        updatedBy: 'referral_reward'
      }
    }).catch((e) => {
      console.error('[watchParty] grantReferralMembershipReward update failed:', e && (e.message || e))
      return null
    })
    // 写入失败不得返回成功，否则入驻侧会标记 referralRewarded 导致奖励永久丢失
    if (!up || !up.stats || up.stats.updated < 1) return null
    invalidateGateCache(ref._id)
    await writeOpLog({
      user: { id: 'system', username: 'referral_reward' },
      module: 'watch_party',
      action: 'referral_membership_reward',
      targetId: ref._id,
      after: {
        membershipExpireAt,
        fromMerchantId: meta.fromMerchantId || '',
        fromMerchantName: meta.fromMerchantName || '',
        months: 1
      }
    }).catch(() => {})
    return { referrerMerchantId: ref._id, membershipExpireAt }
  }

  /**
   * 过审总闸：global_config.main.enableWatchParty
   * failClosed：读失败 / 无 main 文档 → 关闭；字段缺省视为开启（!== false）
   */
  async function isMainWatchPartyEnabled() {
    if (Date.now() - _mainFlagCache.at < GATE_CACHE_TTL) return _mainFlagCache.on
    try {
      const res = await db.collection('global_config').doc('main').get()
      const cfg = (res && res.data) || null
      const on = !!(cfg && cfg._id) && cfg.enableWatchParty !== false
      _mainFlagCache = { at: Date.now(), on }
      return on
    } catch (e) {
      _mainFlagCache = { at: Date.now(), on: false }
      return false
    }
  }

  /**
   * 双闸：① 过审 enableWatchParty ② 观礼运营关停 watch_party_config.enabled
   * 关闭时返回停服文案，开启返回 null
   */
  async function serviceGate() {
    if (!(await isMainWatchPartyEnabled())) {
      return '观礼服务暂未开放，感谢关注'
    }
    const cfg = await getGlobalConfigDoc()
    if (cfg && cfg.enabled === false) {
      return (cfg.closedNotice || '').trim() || '观礼服务暂未开放，感谢关注'
    }
    return null
  }

  async function findMerchant(merchantId) {
    const id = String(merchantId || '').trim()
    if (!id) return null
    const cached = _merchantCache[id]
    if (cached && Date.now() - cached.at < GATE_CACHE_TTL) return cached.doc
    const res = await db.collection(MERCHANTS).doc(id).get().catch(() => null)
    const doc = (res && res.data) || null
    _merchantCache[id] = { at: Date.now(), doc }
    return doc
  }

  /**
   * 场次对外可用性：场次启用 + 挂靠商家（如有）处于 active。
   * 返回错误文案或 null；未挂靠商家的场次（试点期）不受商家门控。
   */
  async function sessionGate(session) {
    if (!session || session.enabled === false) return '观礼场次不存在或已下线'
    if (session.merchantId) {
      const m = await findMerchant(session.merchantId)
      if (!m || m.status !== 'active') return '该观礼点已暂停服务，请关注后续安排'
    }
    return null
  }

  function invalidateGateCache(merchantId) {
    _cfgCache = { at: 0, doc: null }
    _mainFlagCache = { at: 0, on: false }
    _entryCache = { at: 0, has: false, data: null }
    _listCache = Object.create(null)
    _missionNameCache = Object.create(null)
    _missionOwnerCache = Object.create(null)
    if (merchantId) delete _merchantCache[merchantId]
  }

  /** 预约截止时刻（ms）：发射前 30 分钟；发射时间缺失/非法返回 0（不自动截止） */
  function reserveCloseAtOf(doc) {
    const t = doc && doc.launchTime ? Date.parse(doc.launchTime) : NaN
    if (!t || isNaN(t)) return 0
    return t - RESERVE_CLOSE_BEFORE_MS
  }

  /** 列表页轻量视图：不含奖品库存，降低入口探测/列表传输 */
  function publicSessionSummaryView(doc) {
    if (!doc) return null
    return {
      sessionId: doc._id,
      code: doc.code || '',
      title: doc.title || '',
      merchantName: doc.merchantName || '',
      missionId: doc.missionId || '',
      missionName: doc.missionName || '',
      rocketName: doc.rocketName || '',
      rocketNameZh: doc.rocketNameZh || '',
      rocketImageName: doc.rocketImageName || '',
      launchTime: doc.launchTime || '',
      address: doc.address || '',
      padLocationName: doc.padLocationName || '',
      status: doc.status || 'open',
      reserveCloseAt: reserveCloseAtOf(doc),
      services: servicesView(doc.services),
      prizeDrawEnabled: doc.prizeDrawEnabled === true
    }
  }

  /**
   * 预聚合计数器：业务动作发生时在 session 文档上原地 inc，
   * 统计类接口（大屏轮询/后台统计/商家走单）只读 1 个文档，不再扫表 count/get。
   * 漂移容忍：计数仅用于统计展示；容量校验等业务判断仍走精确查询。
   */
  function bumpSessionStats(sessionId, patch) {
    const data = {}
    Object.keys(patch).forEach((k) => { data['stats.' + k] = _.inc(patch[k]) })
    return db.collection(SESSIONS).doc(sessionId).update({ data }).catch(() => {})
  }

  /** 渠道名转安全键名（用作点路径的一段，防注入/非法字符） */
  function channelKey(ch) {
    const key = String(ch || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
    return key || 'site'
  }

  /** 从 session 文档的预聚合计数器读出统计视图 */
  function sessionStatsView(doc) {
    const s = (doc && doc.stats) || {}
    const rarity = s.rarity || {}
    const prizes = publicPrizesView(doc && doc.prizes)
    return {
      reservations: s.reservations || 0,
      checkedIn: s.checkedIn || 0,
      draws: s.draws || 0,
      rarityCount: { N: rarity.N || 0, R: rarity.R || 0, SR: rarity.SR || 0, SSR: rarity.SSR || 0 },
      scanUsers: s.scanUsers || 0,
      channelCount: s.channel || {},
      passGranted: s.passGranted || 0,
      prizeDrawEnabled: !!(doc && doc.prizeDrawEnabled),
      prizes
    }
  }

  function emptySessionStats() {
    return { scanUsers: 0, reservations: 0, checkedIn: 0, draws: 0, passGranted: 0, channel: {}, rarity: {} }
  }

  function newCycleId() {
    return 'c' + Date.now().toString(36) + randomFrom(SESSION_CODE_CHARS, 4)
  }

  /** 当前周期 id；缺省视为 legacy c0（旧场次兼容） */
  function sessionCycleId(doc) {
    const id = String((doc && doc.currentCycleId) || '').trim()
    return id || LEGACY_CYCLE_ID
  }

  function quotaDocId(sessionId, cycleId, openid) {
    return String(sessionId) + '_' + String(cycleId || LEGACY_CYCLE_ID) + '_' + String(openid)
  }

  function legacyQuotaDocId(sessionId, openid) {
    return String(sessionId) + '_' + String(openid)
  }

  /** 深拷贝当前 stats 供归档（含 channel/rarity 对象） */
  function cloneStatsForArchive(doc) {
    const s = (doc && doc.stats) || {}
    return {
      scanUsers: Number(s.scanUsers || 0) || 0,
      reservations: Number(s.reservations || 0) || 0,
      checkedIn: Number(s.checkedIn || 0) || 0,
      draws: Number(s.draws || 0) || 0,
      passGranted: Number(s.passGranted || 0) || 0,
      channel: Object.assign({}, s.channel || {}),
      rarity: Object.assign({}, s.rarity || {})
    }
  }

  function buildCycleSnapshot(doc, endedAt) {
    const cycleId = sessionCycleId(doc)
    return {
      cycleId,
      missionId: doc.missionId || '',
      missionName: doc.missionName || '',
      rocketName: doc.rocketName || '',
      launchTime: doc.launchTime || '',
      title: doc.title || '',
      prizeDrawEnabled: doc.prizeDrawEnabled === true,
      successUnlockedAt: Number(doc.successUnlockedAt || 0) || 0,
      stats: cloneStatsForArchive(doc),
      startedAt: Number(doc.cycleStartedAt || doc.createdAt || 0) || 0,
      endedAt: Number(endedAt || now()) || now()
    }
  }

  function cycleHistoryView(doc, limit) {
    const hist = Array.isArray(doc && doc.cycleHistory) ? doc.cycleHistory : []
    const n = Math.max(1, Number(limit) || 8)
    return hist.slice(-n).reverse().map((c) => {
      const st = (c && c.stats) || {}
      return {
        cycleId: (c && c.cycleId) || '',
        missionId: (c && c.missionId) || '',
        missionName: (c && c.missionName) || '',
        rocketName: (c && c.rocketName) || '',
        launchTime: (c && c.launchTime) || '',
        title: (c && c.title) || '',
        successUnlocked: !!(c && c.successUnlockedAt),
        scanUsers: Number(st.scanUsers || 0) || 0,
        reservations: Number(st.reservations || 0) || 0,
        checkedIn: Number(st.checkedIn || 0) || 0,
        draws: Number(st.draws || 0) || 0,
        startedAt: Number((c && c.startedAt) || 0) || 0,
        endedAt: Number((c && c.endedAt) || 0) || 0
      }
    })
  }

  /** 首次读到无 currentCycleId 的场次时懒补写，避免后续资格键抖动 */
  async function ensureSessionCycleFields(doc) {
    if (!doc || !doc._id) return doc
    if (String(doc.currentCycleId || '').trim()) return doc
    const patch = {
      currentCycleId: LEGACY_CYCLE_ID,
      cycleStartedAt: Number(doc.createdAt || now()) || now(),
      cycleHistory: Array.isArray(doc.cycleHistory) ? doc.cycleHistory : []
    }
    await db.collection(SESSIONS).doc(doc._id).update({ data: patch }).catch(() => {})
    return Object.assign({}, doc, patch)
  }

  /**
   * 解析抽奖资格文档：新键 sessionId_cycleId_openid；
   * 当前为 c0 时兼容旧键 sessionId_openid，并迁到新键（仅迁移一次）。
   */
  async function loadQuotaForCycle(sessionId, cycleId, openid) {
    const cid = String(cycleId || LEGACY_CYCLE_ID).trim() || LEGACY_CYCLE_ID
    const qid = quotaDocId(sessionId, cid, openid)
    let res = await db.collection(QUOTA).doc(qid).get().catch(() => null)
    if (res && res.data) return { quotaId: qid, quota: res.data, migrated: false }

    if (cid === LEGACY_CYCLE_ID) {
      const legacyId = legacyQuotaDocId(sessionId, openid)
      const legacyRes = await db.collection(QUOTA).doc(legacyId).get().catch(() => null)
      const legacy = legacyRes && legacyRes.data
      if (legacy) {
        const migrated = Object.assign({}, legacy, {
          _id: qid,
          cycleId: cid,
          sessionId,
          openid
        })
        try {
          await db.collection(QUOTA).add({
            data: {
              _id: qid,
              openid,
              sessionId,
              cycleId: cid,
              channel: legacy.channel || 'site',
              fromMaterial: legacy.fromMaterial === true,
              total: Number(legacy.total || 0) || 0,
              used: Number(legacy.used || 0) || 0,
              shareBonusAt: Number(legacy.shareBonusAt || 0) || 0,
              passExpiresAt: Number(legacy.passExpiresAt || 0) || 0,
              passGrantedAt: Number(legacy.passGrantedAt || 0) || 0,
              createdAt: Number(legacy.createdAt || now()) || now(),
              migratedFrom: legacyId
            }
          })
          return { quotaId: qid, quota: migrated, migrated: true }
        } catch (e) {
          const again = await db.collection(QUOTA).doc(qid).get().catch(() => null)
          if (again && again.data) return { quotaId: qid, quota: again.data, migrated: true }
          return { quotaId: legacyId, quota: legacy, migrated: false }
        }
      }
    }
    return { quotaId: qid, quota: null, migrated: false }
  }

  async function countMerchantSessions(merchantId) {
    const res = await db.collection(SESSIONS)
      .where({ merchantId: String(merchantId || '') })
      .count()
      .catch(() => ({ total: 0 }))
    return Number(res.total || 0) || 0
  }

  // ── 任务显示名（商家自定义中文名，跨商家共享） ──

  /** 容器内任务显示名缓存：missionId -> { at, doc } */
  let _missionNameCache = Object.create(null)

  async function getMissionNameDoc(missionId) {
    const mid = String(missionId || '').trim()
    if (!mid) return null
    const cached = _missionNameCache[mid]
    if (cached && Date.now() - cached.at < GATE_CACHE_TTL) return cached.doc
    const res = await db.collection(MISSION_NAMES).doc(mid).get().catch(() => null)
    const doc = (res && res.data) || null
    _missionNameCache[mid] = { at: Date.now(), doc }
    return doc
  }

  async function loadMissionDisplayName(missionId) {
    const doc = await getMissionNameDoc(missionId)
    return (doc && String(doc.displayName || '').trim()) || ''
  }

  /** 命名权归属缓存：missionId -> { at, owner }（场次/商家变更会走 invalidateGateCache 清掉） */
  let _missionOwnerCache = Object.create(null)

  /**
   * 任务命名权归属：该 missionId 下有场次的商家中，入驻（createdAt）最早者。
   * 尚无任何场次时返回 ''（视为谁先建场次谁可改）。
   */
  async function resolveMissionNameOwner(missionId) {
    const mid = String(missionId || '').trim()
    if (!mid) return ''
    const cached = _missionOwnerCache[mid]
    if (cached && Date.now() - cached.at < GATE_CACHE_TTL) return cached.owner
    const owner = await resolveMissionNameOwnerUncached(mid)
    _missionOwnerCache[mid] = { at: Date.now(), owner }
    return owner
  }

  async function resolveMissionNameOwnerUncached(mid) {
    const res = await db.collection(SESSIONS)
      .where({ missionId: mid })
      .field({ merchantId: true })
      .limit(50)
      .get()
      .catch(() => ({ data: [] }))
    const merchantIds = []
    const seen = Object.create(null)
    ;(res.data || []).forEach((s) => {
      const id = s && s.merchantId
      if (id && !seen[id]) { seen[id] = 1; merchantIds.push(id) }
    })
    if (!merchantIds.length) return ''
    const merchants = await Promise.all(merchantIds.map((id) => findMerchant(id)))
    let owner = ''
    let earliest = Infinity
    merchants.forEach((m) => {
      if (!m || m.status === 'terminated') return
      const t = Number(m.createdAt || 0) || 0
      if (t < earliest) { earliest = t; owner = m._id }
    })
    return owner
  }

  /** 商家查任务显示名与自己是否可改（编辑场次页选任务后调用） */
  async function merchantGetMissionName(query = {}, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const mid = String(query.missionId || '').trim()
    if (!mid) return fail(4001, '缺少任务ID')
    const [doc, owner] = await Promise.all([
      getMissionNameDoc(mid),
      resolveMissionNameOwner(mid)
    ])
    return ok({
      missionId: mid,
      displayName: (doc && doc.displayName) || '',
      editable: !owner || owner === merchant._id
    })
  }

  /** 商家设置任务显示名（仅该任务下最早入驻的商家可改；空值 = 清除） */
  async function merchantSetMissionDisplayName(body = {}, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (merchant.status !== 'active') return fail(4030, '商家合作已暂停，暂不能修改任务显示名')
    const mid = String(body.missionId || '').trim()
    if (!mid) return fail(4001, '缺少任务ID')
    const displayName = String(body.displayName || '').trim().slice(0, 60)
    const owner = await resolveMissionNameOwner(mid)
    if (owner && owner !== merchant._id) {
      return fail(4030, '任务显示名由该任务下最早入驻的商家维护，您暂无修改权限')
    }
    const data = {
      displayName,
      merchantId: merchant._id,
      merchantName: merchant.name || '',
      updatedAt: now()
    }
    const up = await db.collection(MISSION_NAMES).doc(mid)
      .update({ data })
      .catch(() => null)
    if (!up || !up.stats || up.stats.updated < 1) {
      const added = await db.collection(MISSION_NAMES).add({ data: { _id: mid, ...data } }).catch(() => null)
      if (!added) {
        // 新环境集合尚未创建：建集合后重试一次
        if (typeof db.createCollection === 'function') {
          await db.createCollection(MISSION_NAMES).catch(() => {})
        }
        const retried = await db.collection(MISSION_NAMES).add({ data: { _id: mid, ...data } }).catch(() => null)
        if (!retried) return fail(5000, '任务显示名保存失败，请稍后重试')
      }
    }
    delete _missionNameCache[mid]
    invalidateGateCache()
    await writeOpLog({
      user: merchantOperator(merchant),
      module: 'watch_party',
      action: 'merchant_set_mission_name',
      targetId: mid,
      after: { displayName }
    })
    return ok({ missionId: mid, displayName })
  }

  // ── 工具 ──

  function sanitizeParkingSpots(raw) {
    if (!Array.isArray(raw)) return []
    return raw.slice(0, 10).map((p) => ({
      name: String((p && p.name) || '').slice(0, 40),
      lat: Number((p && p.lat) || 0) || 0,
      lng: Number((p && p.lng) || 0) || 0,
      walkMinutes: Number((p && p.walkMinutes) || 0) || 0,
      note: String((p && p.note) || '').slice(0, 100)
    }))
  }

  function sanitizeSciencePoints(raw) {
    if (!Array.isArray(raw)) return []
    return raw.slice(0, 20).map((s) => String(s || '').slice(0, 200)).filter(Boolean)
  }

  /** 大屏科普配置图：cloud:// 文件ID（商家相册上传）或 https 地址 */
  function sanitizeScienceImages(raw) {
    if (!Array.isArray(raw)) return []
    return raw
      .slice(0, SCIENCE_IMAGES_MAX)
      .map((s) => String(s || '').trim().slice(0, 600))
      .filter((s) => /^(cloud|https):\/\//.test(s))
  }

  function genPrizeId() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  function parsePrizeValueYuan(raw) {
    if (raw == null || raw === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.min(999999, Math.round(n * 100) / 100)
  }

  /** 新建场次：奖品 remaining = stock */
  function sanitizePrizesCreate(raw) {
    if (!Array.isArray(raw)) return []
    return raw.slice(0, PRIZES_MAX).map((p, i) => {
      const name = String((p && p.name) || '').trim().slice(0, 40)
      const image = String((p && p.image) || '').trim().slice(0, 600)
      if (!name || !/^(cloud|https):\/\//.test(image)) return null
      const stock = Math.min(9999, Math.max(1, Number(p.stock) || 1))
      return {
        id: String((p && p.id) || '').trim().slice(0, 40) || genPrizeId(),
        name,
        image,
        stock,
        remaining: stock,
        valueYuan: parsePrizeValueYuan(p && p.valueYuan),
        sort: Number.isFinite(Number(p && p.sort)) ? Number(p.sort) : i
      }
    }).filter(Boolean).sort((a, b) => a.sort - b.sort)
  }

  /**
   * 更新场次：按 id 合并，保留 remaining；stock 不得小于已发放数。
   * issued = stock - remaining（旧值）
   */
  function mergePrizes(incoming, existing) {
    const prevMap = {}
    ;(Array.isArray(existing) ? existing : []).forEach((p) => {
      if (p && p.id) prevMap[String(p.id)] = p
    })
    if (!Array.isArray(incoming)) return Array.isArray(existing) ? existing : []
    const out = []
    incoming.slice(0, PRIZES_MAX).forEach((p, i) => {
      const name = String((p && p.name) || '').trim().slice(0, 40)
      const image = String((p && p.image) || '').trim().slice(0, 600)
      if (!name || !/^(cloud|https):\/\//.test(image)) return
      const id = String((p && p.id) || '').trim().slice(0, 40)
      const prev = id ? prevMap[id] : null
      let stock = Math.min(9999, Math.max(1, Number(p.stock) || 1))
      let remaining
      if (prev) {
        const prevStock = Math.max(1, Number(prev.stock) || 1)
        const prevRem = Math.max(0, Number(prev.remaining != null ? prev.remaining : prevStock) || 0)
        const issued = Math.max(0, prevStock - prevRem)
        if (stock < issued) stock = issued
        remaining = Math.max(0, stock - issued)
      } else {
        remaining = stock
      }
      out.push({
        id: prev ? String(prev.id) : (id || genPrizeId()),
        name,
        image,
        stock,
        remaining,
        valueYuan: parsePrizeValueYuan(p && p.valueYuan),
        sort: Number.isFinite(Number(p && p.sort)) ? Number(p.sort) : i
      })
    })
    return out.sort((a, b) => a.sort - b.sort)
  }

  function publicPrizesView(prizes) {
    return (Array.isArray(prizes) ? prizes : [])
      .slice()
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
      .map((p) => ({
        id: p.id || '',
        name: p.name || '',
        image: p.image || '',
        valueYuan: p.valueYuan == null ? null : Number(p.valueYuan),
        stock: Math.max(0, Number(p.stock) || 0),
        remaining: Math.max(0, Number(p.remaining) || 0),
        sort: Number(p.sort) || 0
      }))
  }

  function sanitizeServices(raw) {
    if (!Array.isArray(raw)) return []
    const seen = {}
    const out = []
    raw.forEach((id) => {
      const key = String(id || '').trim()
      if (!SESSION_SERVICE_IDS.includes(key) || seen[key]) return
      seen[key] = true
      out.push(key)
    })
    return out
  }

  function servicesView(ids) {
    const set = sanitizeServices(ids)
    return SESSION_SERVICE_CATALOG.filter((s) => set.indexOf(s.id) >= 0)
  }

  function sanitizeWechatGroupQr(raw) {
    const s = String(raw || '').trim().slice(0, 600)
    return /^(cloud|https):\/\//.test(s) ? s : ''
  }

  /** 商家「添加好友」二维码：单张 cloud:// 或 https（与群码同源清洗） */
  function sanitizeContactWechatQr(raw) {
    return sanitizeWechatGroupQr(raw)
  }

  /** 微信群二维码列表（最多 2 张，cloud:// 或 https） */
  function sanitizeWechatGroupQrs(raw) {
    if (!Array.isArray(raw)) return []
    return raw
      .map((s) => sanitizeWechatGroupQr(s))
      .filter(Boolean)
      .slice(0, WECHAT_QRS_MAX)
  }

  /** 兼容读：优先数组字段，旧单字段并入 */
  function wechatGroupQrsOf(doc) {
    const arr = sanitizeWechatGroupQrs(doc && doc.wechatGroupQrs)
    if (arr.length) return arr
    const legacy = sanitizeWechatGroupQr(doc && doc.wechatGroupQr)
    return legacy ? [legacy] : []
  }

  /** 现场照片（顾客页展示）：最多 8 张 */
  function sanitizeSitePhotos(raw) {
    if (!Array.isArray(raw)) return []
    return raw
      .slice(0, SITE_PHOTOS_MAX)
      .map((s) => String(s || '').trim().slice(0, 600))
      .filter((s) => /^(cloud|https):\/\//.test(s))
  }

  /** 现场视频 / 视频封面：cloud:// 或 https 单条 */
  function sanitizeCloudMediaUrl(raw) {
    const s = String(raw || '').trim().slice(0, 600)
    return /^(cloud|https):\/\//.test(s) ? s : ''
  }

  /**
   * 车辆预约：现要求填小程序短链（#小程序://…，顾客点击直接跳转）；
   * 旧 https 网址数据保留不报错（顾客端仅对短链展示跳转入口）。
   */
  function sanitizeVehicleBookingUrl(raw) {
    const s = String(raw || '').trim().slice(0, 500)
    if (!s) return ''
    if (/^#小程序:\/\//.test(s)) return s
    if (/^https?:\/\//i.test(s)) return s
    // 允许商家只填域名，前端打开时再补 https
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return 'https://' + s
    return ''
  }

  function normalizeSessionBody(body = {}) {
    const out = {
      code: String(body.code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 10),
      title: String(body.title || '').trim().slice(0, 60),
      merchantId: String(body.merchantId || '').trim(),
      merchantName: String(body.merchantName || '').trim().slice(0, 40),
      missionId: String(body.missionId || '').trim(),
      missionName: String(body.missionName || '').trim().slice(0, 60),
      rocketName: String(body.rocketName || '').trim().slice(0, 40),
      rocketNameZh: String(body.rocketNameZh || '').trim().slice(0, 40),
      launchTime: String(body.launchTime || '').trim(),
      address: String(body.address || '').trim().slice(0, 120),
      lat: Number(body.lat || 0) || 0,
      lng: Number(body.lng || 0) || 0,
      intro: String(body.intro || '').slice(0, 2000),
      notice: String(body.notice || '').slice(0, 2000),
      parkingSpots: sanitizeParkingSpots(body.parkingSpots),
      sciencePoints: sanitizeSciencePoints(body.sciencePoints),
      capacity: Math.max(0, Number(body.capacity || 0) || 0),
      qrCodeUrl: String(body.qrCodeUrl || '').trim(),
      enabled: body.enabled !== false,
      /** open=可预约，closed=停止预约（场次仍可见） */
      status: body.status === 'closed' ? 'closed' : 'open',
      successUnlockedAt: Number(body.successUnlockedAt || 0) || 0,
      /** 观礼通行证：默认关闭；开启后时长 1～48h，缺省 12h */
      passEnabled: body.passEnabled === true || body.passEnabled === 'true' || body.passEnabled === 1,
      passHours: Math.min(
        PASS_MAX_HOURS,
        Math.max(1, Number(body.passHours != null ? body.passHours : PASS_DEFAULT_HOURS) || PASS_DEFAULT_HOURS)
      )
    }
    // 条件字段：调用方未提供时不写入，避免全量保存把商家配置误清空
    if (body.scienceImages !== undefined) out.scienceImages = sanitizeScienceImages(body.scienceImages)
    if (body.prizeDrawEnabled !== undefined) {
      out.prizeDrawEnabled = body.prizeDrawEnabled === true || body.prizeDrawEnabled === 'true' || body.prizeDrawEnabled === 1
    }
    if (body.services !== undefined) out.services = sanitizeServices(body.services)
    if (body.wechatGroupQrs !== undefined) {
      out.wechatGroupQrs = sanitizeWechatGroupQrs(body.wechatGroupQrs)
      out.wechatGroupQr = out.wechatGroupQrs[0] || ''
    } else if (body.wechatGroupQr !== undefined) {
      out.wechatGroupQr = sanitizeWechatGroupQr(body.wechatGroupQr)
      out.wechatGroupQrs = out.wechatGroupQr ? [out.wechatGroupQr] : []
    }
    if (body.vehicleBookingUrl !== undefined) out.vehicleBookingUrl = sanitizeVehicleBookingUrl(body.vehicleBookingUrl)
    if (body.sitePhotos !== undefined) out.sitePhotos = sanitizeSitePhotos(body.sitePhotos)
    if (body.siteVideo !== undefined) out.siteVideo = sanitizeCloudMediaUrl(body.siteVideo)
    if (body.siteVideoPoster !== undefined) out.siteVideoPoster = sanitizeCloudMediaUrl(body.siteVideoPoster)
    /** 自动获取任务时锁定的配置图匹配名：手动改火箭名后配置图不变（展示端优先按它取图） */
    if (body.rocketImageName !== undefined) out.rocketImageName = String(body.rocketImageName || '').trim().slice(0, 40)
    /** 头卡亮点角标（商家自定义，如「近距离观礼 · 距发射工位约1.5km」），空 = 用客户端默认文案 */
    if (body.heroBadge !== undefined) out.heroBadge = String(body.heroBadge || '').trim().slice(0, 30)
    /** 顾客可一键拨打的联系电话（手机或座机，仅数字/+/-） */
    if (body.contactPhone !== undefined) {
      out.contactPhone = String(body.contactPhone || '').trim().replace(/[^\d+-]/g, '').slice(0, 20)
    }
    /** 顾客「微信联系」用的添加好友二维码（长按识别；cloud:// 或 https） */
    if (body.contactWechatQr !== undefined) {
      out.contactWechatQr = sanitizeContactWechatQr(body.contactWechatQr)
    }
    // prizes 由 create/update 路径单独 merge，避免全量保存把 remaining 重置为 stock
    // 大屏讲解跳转元数据（商家选任务时写入）
    if (
      body.agencyId !== undefined || body.agencyName !== undefined || body.agencyAbbrev !== undefined
      || body.rocketConfigId !== undefined || body.padLocationId !== undefined || body.padLocationName !== undefined
    ) {
      out.agencyId = String(body.agencyId || '').trim().slice(0, 32)
      out.agencyName = String(body.agencyName || '').trim().slice(0, 80)
      out.agencyAbbrev = String(body.agencyAbbrev || '').trim().slice(0, 20)
      out.rocketConfigId = String(body.rocketConfigId || '').trim().slice(0, 32)
      out.padLocationId = String(body.padLocationId || '').trim().slice(0, 32)
      out.padLocationName = String(body.padLocationName || '').trim().slice(0, 80)
    }
    return out
  }

  function publicSessionView(doc) {
    if (!doc) return null
    const prizes = publicPrizesView(doc.prizes)
    const prizeRemain = prizes.reduce((s, p) => s + (p.remaining || 0), 0)
    return {
      sessionId: doc._id,
      code: doc.code || '',
      title: doc.title || '',
      merchantName: doc.merchantName || '',
      missionId: doc.missionId || '',
      missionName: doc.missionName || '',
      rocketName: doc.rocketName || '',
      rocketNameZh: doc.rocketNameZh || '',
      rocketImageName: doc.rocketImageName || '',
      agencyId: doc.agencyId || '',
      agencyName: doc.agencyName || '',
      agencyAbbrev: doc.agencyAbbrev || '',
      rocketConfigId: doc.rocketConfigId || '',
      padLocationId: doc.padLocationId || '',
      padLocationName: doc.padLocationName || '',
      launchTime: doc.launchTime || '',
      address: doc.address || '',
      lat: doc.lat || 0,
      lng: doc.lng || 0,
      intro: doc.intro || '',
      notice: doc.notice || '',
      parkingSpots: Array.isArray(doc.parkingSpots) ? doc.parkingSpots : [],
      sciencePoints: Array.isArray(doc.sciencePoints) ? doc.sciencePoints : [],
      sitePhotos: sanitizeSitePhotos(doc.sitePhotos),
      siteVideo: sanitizeCloudMediaUrl(doc.siteVideo),
      siteVideoPoster: sanitizeCloudMediaUrl(doc.siteVideoPoster),
      capacity: doc.capacity || 0,
      status: doc.status || 'open',
      reserveCloseAt: reserveCloseAtOf(doc),
      services: servicesView(doc.services),
      wechatGroupQr: wechatGroupQrsOf(doc)[0] || '',
      wechatGroupQrs: wechatGroupQrsOf(doc),
      vehicleBookingUrl: doc.vehicleBookingUrl || '',
      heroBadge: doc.heroBadge || '',
      contactPhone: doc.contactPhone || '',
      contactWechatQr: sanitizeContactWechatQr(doc.contactWechatQr),
      prizeDrawEnabled: doc.prizeDrawEnabled === true,
      /** 商家已确认发射成功后开放抽奖 */
      successUnlocked: !!doc.successUnlockedAt,
      successUnlockedAt: Number(doc.successUnlockedAt || 0) || 0,
      prizes,
      prizeRemaining: prizeRemain
    }
  }

  /**
   * 顾客页联系方式：场次字段优先；缺省时回落商家入驻资料。
   * 解决「商家资料已传微信二维码，但旧场次只有电话 → 顾客页仍只显示拨打」的断层。
   * findMerchant 有缓存，且 sessionGate 通常已预热，额外开销可忽略。
   */
  async function enrichPublicContact(view, doc) {
    if (!view || !doc || !doc.merchantId) return view
    if (view.contactPhone && view.contactWechatQr) return view
    const m = await findMerchant(doc.merchantId)
    if (!m) return view
    if (!view.contactPhone && m.contactPhone) {
      view.contactPhone = String(m.contactPhone || '').trim().replace(/[^\d+-]/g, '').slice(0, 20)
    }
    if (!view.contactWechatQr && m.contactWechatQr) {
      view.contactWechatQr = sanitizeContactWechatQr(m.contactWechatQr)
    }
    return view
  }

  /** 是否现场物料扫码资格（兼容旧配额：非 app 渠道视为现场） */
  function isMaterialQuota(quota) {
    if (!quota) return false
    if (quota.fromMaterial === true) return true
    if (quota.fromMaterial === false) return false
    return String(quota.channel || '') !== 'app'
  }

  async function findSessionById(sessionId) {
    if (!sessionId) return null
    const res = await db.collection(SESSIONS).doc(String(sessionId)).get().catch(() => null)
    return (res && res.data) || null
  }

  async function findSessionByCode(code) {
    const c = String(code || '').trim().toLowerCase()
    if (!c) return null
    const res = await db.collection(SESSIONS).where({ code: c }).limit(1).get().catch(() => ({ data: [] }))
    return (res.data && res.data[0]) || null
  }

  async function resolveSession({ sessionId, code }) {
    if (sessionId) return findSessionById(sessionId)
    if (code) return findSessionByCode(code)
    return null
  }

  // ── 编号 / 短码生成 ──

  function randomFrom(chars, len) {
    let s = ''
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
  }

  /** 商家固定编号（8 位大写，查重 5 次；极端撞车时追加时间戳尾巴兜底） */
  async function genUniqueMerchantCode() {
    for (let i = 0; i < 5; i++) {
      const code = randomFrom(MERCHANT_CODE_CHARS, MERCHANT_CODE_LEN)
      const dup = await db.collection(MERCHANTS)
        .where({ merchantCode: code })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (!dup.data || dup.data.length === 0) return code
    }
    return randomFrom(MERCHANT_CODE_CHARS, MERCHANT_CODE_LEN - 2) + Date.now().toString(36).slice(-2).toUpperCase()
  }

  /** 商家自建场次短码：m + 5 位随机（≤10 字符，scene 安全） */
  async function genUniqueSessionCode() {
    for (let i = 0; i < 5; i++) {
      const code = 'm' + randomFrom(SESSION_CODE_CHARS, 5)
      if (!(await findSessionByCode(code))) return code
    }
    return ('m' + Date.now().toString(36)).slice(0, 10)
  }

  // ── 云存储文件 → 临时 https 地址（HTML 大屏无法直接显示 cloud:// 文件ID） ──

  async function resolveCloudFileUrls(ids) {
    const cloudIds = (ids || []).filter((id) => /^cloud:\/\//.test(String(id || '')))
    if (!cloudIds.length) return {}
    try {
      const res = await cloud.getTempFileURL({ fileList: cloudIds.slice(0, 50) })
      const map = {}
      ;(res.fileList || []).forEach((f) => {
        if (f && f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL
      })
      return map
    } catch (e) {
      return {}
    }
  }

  // ── 小程序码取码（双路）：配置了凭证走 HTTP 直连，否则云调用（仅小程序触发链路可用） ──

  async function fetchWxacodeBuffer({ scene, page, envVersion, width }) {
    if (pickMpCredentials()) {
      const res = await fetchWxacodeViaHttp({
        scene,
        page,
        check_path: false,
        env_version: envVersion,
        width
      })
      return { buffer: res.buffer, contentType: res.contentType || 'image/jpeg' }
    }
    const res = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page,
      checkPath: false,
      envVersion,
      width
    })
    return { buffer: res && res.buffer, contentType: (res && res.contentType) || 'image/jpeg' }
  }

  /**
   * 商家自建场次：后台自动生成大屏抽卡码（scene 渠道固定 screen），
   * 存云存储文件ID（qrCodeFileId），大屏读取时转临时 https。失败静默（商家可稍后在编辑里重试，或由运营在后台补）。
   */
  async function autoGenerateSessionQrcode(sessionId, code) {
    try {
      const { buffer } = await fetchWxacodeBuffer({
        scene: `wp:${code}:screen`,
        page: 'subpackages/watch-party/gacha',
        envVersion: 'release',
        width: 860
      })
      if (!buffer || !buffer.length) return false
      const up = await cloud.uploadFile({
        cloudPath: `watch_party/qrcode/${code}_${Date.now()}.jpg`,
        fileContent: Buffer.from(buffer)
      })
      if (!up || !up.fileID) return false
      await db.collection(SESSIONS).doc(sessionId).update({ data: { qrCodeFileId: up.fileID } }).catch(() => {})
      return true
    } catch (e) {
      return false
    }
  }

  // ══════════════════ 公开接口（小程序端） ══════════════════

  /**
   * 首页/详情页入口显隐：返回最近一个可对外的场次（无则 data=null）。
   * 全局关停 / 商家非 active 的场次一律不返回 → 入口自动隐藏。
   */
  async function getPublicConfig() {
    if (_entryCache.has && Date.now() - _entryCache.at < GATE_CACHE_TTL) return ok(_entryCache.data)
    let data = null
    if (!(await serviceGate())) {
      const res = await db.collection(SESSIONS)
        .where({ enabled: true })
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get()
        .catch(() => ({ data: [] }))
      for (const doc of (res.data || [])) {
        if (!(await sessionGate(doc))) {
          data = await enrichPublicContact(publicSessionView(doc), doc)
          break
        }
      }
      if (data && data.missionId) {
        data.missionDisplayName = await loadMissionDisplayName(data.missionId)
      }
    }
    _entryCache = { at: Date.now(), has: true, data }
    return ok(data)
  }

  /**
   * 从用户问句里抽发射场/地区线索（文昌/西昌/星舰基地…）
   * 用于星问「观礼」类问题匹配最合适的商家场次。
   */
  function extractWatchPartySiteHints(q) {
    const s = String(q || '')
    const hints = []
    if (/(文昌|海南|wenchang)/i.test(s)) hints.push('文昌', '海南', 'wenchang')
    if (/(西昌|xichang)/i.test(s)) hints.push('西昌', 'xichang')
    if (/(酒泉|东风|jiuquan)/i.test(s)) hints.push('酒泉', '东风', 'jiuquan')
    if (/(太原|taiyuan)/i.test(s)) hints.push('太原', 'taiyuan')
    if (/(卡纳维拉尔|canaveral|kennedy|佛罗里达|florida|spacecoast)/i.test(s)) {
      hints.push('卡纳维拉尔', 'canaveral', 'kennedy', 'florida')
    }
    if (/(星舰|starbase|bocachica|博卡奇卡|得州|texas)/i.test(s)) {
      hints.push('starbase', '星舰', 'boca', 'texas', '得州')
    }
    if (/(范登堡|vandenberg)/i.test(s)) hints.push('范登堡', 'vandenberg')
    return hints
  }

  /** 场次与问句的匹配分：发射场线索优先，其次火箭/任务名，无线索时偏向最近发射场次 */
  function scoreSessionAgainstQuery(doc, qRaw, siteHints) {
    if (!doc) return -1
    const q = String(qRaw || '').toLowerCase()
    const hay = [
      doc.title, doc.merchantName, doc.address, doc.padLocationName,
      doc.rocketName, doc.missionName, doc.agencyName, doc.agencyAbbrev
    ].map((x) => String(x || '').toLowerCase()).join(' ')
    let score = 0
    if (siteHints.length) {
      for (let i = 0; i < siteHints.length; i++) {
        if (hay.indexOf(String(siteHints[i]).toLowerCase()) >= 0) score += 50
      }
      if (score <= 0) return -1 // 用户点名了发射场，但本场次对不上 → 排除
    }
    if (q) {
      const tokens = [doc.rocketName, doc.missionName, doc.merchantName, doc.title]
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x) => x.length >= 2)
      for (let i = 0; i < tokens.length; i++) {
        if (q.indexOf(tokens[i]) >= 0) score += 25
      }
    }
    // 时间接近度：未来发射越近分越高；无发射场线索时这是主排序
    if (doc.launchTime) {
      const t = new Date(doc.launchTime).getTime()
      if (t && !isNaN(t)) {
        const diffH = (t - Date.now()) / 3600000
        if (diffH >= 0 && diffH <= 24 * 60) {
          score += Math.max(1, 40 - Math.floor(diffH / 24))
        } else if (diffH < 0 && diffH > -72) {
          score += 3
        }
      }
    }
    if (!siteHints.length && score <= 0) score = 1 // 无线索时至少保留候选，后面按分取最优
    return score
  }

  /**
   * 星问观礼意图：按问句匹配最合适的可对外场次（文昌问句 → 文昌商家场次；
   * 未点名发射场 → 优先最近即将发射的场次）。全局关停时返回 null。
   */
  async function matchPublicSession(query = {}) {
    if (await serviceGate()) return ok(null)
    const q = String(query.q || '').trim().slice(0, 80)
    const siteHints = extractWatchPartySiteHints(q)
    const res = await db.collection(SESSIONS)
      .where({ enabled: true })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
      .catch(() => ({ data: [] }))
    const rows = res.data || []
    // 先预热商家缓存，避免 sessionGate 串行打 N 次商家读
    const merchantIds = []
    const seenM = Object.create(null)
    for (let i = 0; i < rows.length; i++) {
      const mid = rows[i] && rows[i].merchantId
      if (mid && !seenM[mid]) { seenM[mid] = 1; merchantIds.push(mid) }
    }
    if (merchantIds.length) await Promise.all(merchantIds.map((id) => findMerchant(id)))

    let best = null
    let bestScore = -1
    const passed = []
    for (const doc of rows) {
      if (await sessionGate(doc)) continue
      passed.push(doc)
      const s = scoreSessionAgainstQuery(doc, q, siteHints)
      if (s > bestScore) {
        bestScore = s
        best = doc
      }
    }
    if (!best) return ok(null)
    const view = await enrichPublicContact(publicSessionView(best), best)
    // 同批结果内统计同任务场次数，避免星问再打一次 list 接口
    const mid = String(best.missionId || '').trim()
    view.missionSessionCount = mid
      ? passed.filter((d) => String(d.missionId || '') === mid).length
      : 1
    if (mid) view.missionDisplayName = await loadMissionDisplayName(mid)
    return ok(view)
  }

  /** 场次详情（支持 sessionId 或短码 code 查询） */
  /**
   * 同商家其他在售场次（详情页「本观礼点·更多场次」）：
   * 轻量卡片按发射时间近→远；商家 active 已由主场次 gate 保证，只需 enabled 过滤。
   * 单商家场次上限 10，一次 where 查询即可，无放大风险。
   */
  async function listMerchantOtherSessions(doc) {
    if (!doc || !doc.merchantId) return []
    const res = await db.collection(SESSIONS)
      .where({ merchantId: doc.merchantId, enabled: true, _id: _.neq(doc._id) })
      .limit(MERCHANT_SESSIONS_MAX)
      .get()
      .catch(() => ({ data: [] }))
    const rows = (res.data || []).slice()
    rows.sort((a, b) => {
      const ta = a && a.launchTime ? (Date.parse(a.launchTime) || Infinity) : Infinity
      const tb = b && b.launchTime ? (Date.parse(b.launchTime) || Infinity) : Infinity
      return ta - tb
    })
    const names = await Promise.all(rows.map((d) => (
      d && d.missionId ? loadMissionDisplayName(d.missionId) : Promise.resolve('')
    )))
    return rows.map((d, i) => ({
      sessionId: d._id,
      title: d.title || '',
      missionId: d.missionId || '',
      missionName: d.missionName || '',
      missionDisplayName: names[i] || '',
      rocketName: d.rocketName || '',
      rocketNameZh: d.rocketNameZh || '',
      rocketImageName: d.rocketImageName || '',
      launchTime: d.launchTime || '',
      status: d.status || 'open',
      reserveCloseAt: reserveCloseAtOf(d)
    }))
  }

  async function getPublicSession(query = {}) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const doc = await resolveSession(query)
    const gated = await sessionGate(doc)
    if (gated) return fail(4040, gated)
    const view = await enrichPublicContact(publicSessionView(doc), doc)
    if (view && view.missionId) {
      view.missionDisplayName = await loadMissionDisplayName(view.missionId)
    }
    if (view) {
      view.merchantOtherSessions = await listMerchantOtherSessions(doc)
    }
    return ok(view)
  }

  /**
   * 公开场次列表（C 端选商家）：
   * - 有 missionId：该任务下所有可对外商家场次
   * - 无 missionId：最近可对外场次（我的/冷启动入口）
   * 同任务多商家时必须走此接口，禁止再用 config 单场次顶替。
   */
  async function listPublicSessions(query = {}) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const missionId = String(query.missionId || '').trim()
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 30))
    const summary = query.summary === true || query.summary === '1' || query.summary === 1
    const cacheKey = (missionId || '_') + '|' + limit + '|' + (summary ? '1' : '0')
    const cached = _listCache[cacheKey]
    if (cached && Date.now() - cached.at < GATE_CACHE_TTL) return ok(cached.data)

    // 有 missionId 时不用 orderBy，避免缺复合索引；内存排序即可
    let queryRef = db.collection(SESSIONS).where(
      missionId ? { enabled: true, missionId } : { enabled: true }
    )
    if (!missionId) queryRef = queryRef.orderBy('createdAt', 'desc')
    const res = await queryRef.limit(limit).get().catch(() => ({ data: [] }))
    const rows = (res.data || []).slice()
    rows.sort((a, b) => {
      const ta = Number(a && a.createdAt) || 0
      const tb = Number(b && b.createdAt) || 0
      if (tb !== ta) return tb - ta
      return String((a && a.merchantName) || '').localeCompare(String((b && b.merchantName) || ''), 'zh')
    })

    const merchantIds = []
    const seenM = Object.create(null)
    for (let i = 0; i < rows.length; i++) {
      const mid = rows[i] && rows[i].merchantId
      if (mid && !seenM[mid]) { seenM[mid] = 1; merchantIds.push(mid) }
    }
    if (merchantIds.length) await Promise.all(merchantIds.map((id) => findMerchant(id)))

    const list = []
    for (const doc of rows) {
      if (await sessionGate(doc)) continue
      const view = summary
        ? publicSessionSummaryView(doc)
        : await enrichPublicContact(publicSessionView(doc), doc)
      // 商家头像（圆形展示于选商家卡片）：商家文档已批量预取，这里读缓存零额外查询
      let merchantAvatar = ''
      if (doc.merchantId) {
        const m = await findMerchant(doc.merchantId)
        merchantAvatar = (m && sanitizeCloudMediaUrl(m.avatar)) || ''
      }
      view.merchantAvatar = merchantAvatar
      list.push(view)
    }
    // 同任务下再按商家名稳定排序，便于用户扫读
    if (missionId) {
      list.sort((a, b) => String(a.merchantName || '').localeCompare(String(b.merchantName || ''), 'zh'))
    }
    // 任务显示名（商家自定义中文名）：按 missionId 批量附到条目与头部
    const nameMids = []
    const seenMid = Object.create(null)
    list.forEach((v) => {
      const mid = v && v.missionId
      if (mid && !seenMid[mid]) { seenMid[mid] = 1; nameMids.push(mid) }
    })
    if (nameMids.length) {
      const names = await Promise.all(nameMids.map((mid) => loadMissionDisplayName(mid)))
      const nameMap = Object.create(null)
      nameMids.forEach((mid, i) => { nameMap[mid] = names[i] || '' })
      list.forEach((v) => {
        if (v && v.missionId) v.missionDisplayName = nameMap[v.missionId] || ''
      })
    }
    const head = list[0] || null
    const data = {
      missionId: missionId || (head && head.missionId) || '',
      missionName: (head && head.missionName) || '',
      missionDisplayName: (head && head.missionDisplayName) || '',
      rocketName: (head && head.rocketName) || '',
      count: list.length,
      summary: !!summary,
      list
    }
    _listCache[cacheKey] = { at: Date.now(), data }
    return ok(data)
  }

  /** 容器内短窗计数（不落库） */
  const _reserveRateMem = Object.create(null)
  let _reserveRateMemSize = 0

  function reserveRateMemKey(scope, value) {
    const raw = String(value || 'unknown').trim().toLowerCase().slice(0, 64)
    return scope + ':' + raw
  }

  function pruneReserveRateMem(ts) {
    const keys = Object.keys(_reserveRateMem)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const rec = _reserveRateMem[k]
      if (!rec || rec.windowStart + Math.max(RESERVE_IP_WINDOW_MS, RESERVE_DEVICE_WINDOW_MS) <= ts) {
        delete _reserveRateMem[k]
        _reserveRateMemSize = Math.max(0, _reserveRateMemSize - 1)
      }
    }
    // 仍超上限则整表清空（粗限流可丢状态，省内存）
    if (_reserveRateMemSize >= RESERVE_RATE_MEM_MAX) {
      for (let i = 0; i < keys.length; i++) delete _reserveRateMem[keys[i]]
      _reserveRateMemSize = 0
    }
  }

  /**
   * 固定窗口内存限流，零读零写 DB。
   * @returns {null|{code,message}}
   */
  function hitReserveShortWindowMem(memKey, windowMs, maxHits, tip) {
    const ts = now()
    let mem = _reserveRateMem[memKey]
    if (!mem || mem.windowStart + windowMs <= ts) {
      if (_reserveRateMemSize >= RESERVE_RATE_MEM_MAX) pruneReserveRateMem(ts)
      if (!_reserveRateMem[memKey]) _reserveRateMemSize += 1
      _reserveRateMem[memKey] = { windowStart: ts, count: 1 }
      return null
    }
    if (mem.count >= maxHits) {
      return fail(4002, tip || '预约过于频繁，请稍后再试')
    }
    mem.count += 1
    return null
  }

  /** 免费预约登记（含 openid 日限、取消冷却、IP/设备内存短窗） */
  async function reserve(body = {}, openid, meta = {}) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const sessionId = String(body.sessionId || '').trim()
    const name = String(body.name || '').trim().slice(0, 20)
    const phone = String(body.phone || '').trim()
    const headcount = Math.min(10, Math.max(1, Number(body.headcount || 1) || 1))
    if (!sessionId) return fail(4001, '缺少场次ID')
    if (!name) return fail(4001, '请填写姓名/昵称')
    if (!/^1\d{10}$/.test(phone)) return fail(4001, '请填写正确的手机号')

    // IP / 设备内存短窗：零 DB，挡连打后再走业务读
    const clientIp = String((meta && meta.clientIp) || body.clientIp || '').trim()
    if (clientIp && clientIp !== 'unknown') {
      const ipHit = hitReserveShortWindowMem(
        reserveRateMemKey('ip', clientIp),
        RESERVE_IP_WINDOW_MS,
        RESERVE_IP_MAX,
        '预约过于频繁，请稍后再试'
      )
      if (ipHit) return ipHit
    }
    const deviceKey = String((meta && meta.deviceKey) || body.deviceKey || body.deviceId || '').trim()
    if (deviceKey && deviceKey.length >= 8) {
      const devHit = hitReserveShortWindowMem(
        reserveRateMemKey('dev', deviceKey),
        RESERVE_DEVICE_WINDOW_MS,
        RESERVE_DEVICE_MAX,
        '预约过于频繁，请稍后再试'
      )
      if (devHit) return devHit
    }

    const closed = await serviceGate()
    if (closed) return fail(4030, closed)

    let session = await findSessionById(sessionId)
    const gated = await sessionGate(session)
    if (gated) return fail(4040, gated)
    if (session.status === 'closed') return fail(4002, '该场次已停止预约')
    // 发射前 30 分钟自动截止（云端硬校验，客户端仅做展示）
    const closeAt = reserveCloseAtOf(session)
    if (closeAt > 0 && now() >= closeAt) {
      return fail(4002, '距发射不足 30 分钟，线上预约已截止，可直接到场参与')
    }
    session = await ensureSessionCycleFields(session)
    const cycleId = sessionCycleId(session)

    // 同场次：一次查出重复预约 + 取消冷却（最多 8 条，内存判定）
    // 与 24h 日限并行，省墙钟时间（计费按次，读次数不变）
    const since = now() - RESERVE_OPENID_24H_MS
    const [sessRes, dayRes] = await Promise.all([
      db.collection(RESERVATIONS)
        .where({ openid, sessionId, cycleId })
        .limit(8)
        .field({ status: true, cancelledAt: true })
        .get()
        .catch(() => ({ data: [] })),
      db.collection(RESERVATIONS)
        .where({ openid })
        .orderBy('createdAt', 'desc')
        .limit(RESERVE_OPENID_24H_MAX)
        .field({ createdAt: true })
        .get()
        .catch(() => ({ data: [] }))
    ])

    const sessRows = sessRes.data || []
    let lastCancelAt = 0
    for (let i = 0; i < sessRows.length; i++) {
      const d = sessRows[i]
      if (d.status !== 'cancelled') return fail(4002, '您已预约过该场次')
      const t = Number(d.cancelledAt || 0) || 0
      if (t > lastCancelAt) lastCancelAt = t
    }
    if (lastCancelAt > 0 && now() - lastCancelAt < RESERVE_CANCEL_COOLDOWN_MS) {
      const wait = Math.ceil((RESERVE_CANCEL_COOLDOWN_MS - (now() - lastCancelAt)) / 1000)
      return fail(4002, '取消后请 ' + wait + ' 秒再重新预约')
    }

    const dayRows = dayRes.data || []
    if (dayRows.length >= RESERVE_OPENID_24H_MAX) {
      const oldest = Number((dayRows[dayRows.length - 1] && dayRows[dayRows.length - 1].createdAt) || 0) || 0
      if (oldest >= since) {
        return fail(4002, '24 小时内预约次数已达上限（5 次），请明天再试')
      }
    }

    if (session.capacity > 0) {
      const countRes = await db.collection(RESERVATIONS)
        .where({ sessionId, cycleId, status: _.neq('cancelled') })
        .count()
        .catch(() => ({ total: 0 }))
      if ((countRes.total || 0) >= session.capacity) return fail(4003, '该场次预约名额已满')
    }

    const addRes = await db.collection(RESERVATIONS).add({
      data: {
        openid,
        sessionId,
        cycleId,
        sessionTitle: session.title || '',
        name,
        phone,
        headcount,
        channel: String(body.channel || '').trim().slice(0, 20),
        status: 'pending',
        createdAt: now(),
        checkedInAt: 0
      }
    })
    await bumpSessionStats(sessionId, { reservations: 1 })
    return ok({ reservationId: addRes._id })
  }

  /** 到场核销码：预约ID尾 6 位（展示用，顾客报码 / 商家名单对码，无需扫码设备） */
  function reservationCheckinCode(id) {
    const s = String(id || '').replace(/[^a-zA-Z0-9]/g, '')
    return s.slice(-6).toUpperCase()
  }

  /** 我的预约状态 */
  async function getMyReservation(openid, query = {}) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const sessionId = String(query.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    let session = await findSessionById(sessionId)
    if (session) session = await ensureSessionCycleFields(session)
    const cycleId = session ? sessionCycleId(session) : LEGACY_CYCLE_ID
    let res = await db.collection(RESERVATIONS)
      .where({ openid, sessionId, cycleId, status: _.neq('cancelled') })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    // 兼容旧预约无 cycleId（仅当前周期为 c0 时）
    if ((!res.data || !res.data.length) && cycleId === LEGACY_CYCLE_ID) {
      res = await db.collection(RESERVATIONS)
        .where({ openid, sessionId, status: _.neq('cancelled') })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      const legacy = res.data && res.data[0]
      if (legacy && legacy.cycleId && legacy.cycleId !== LEGACY_CYCLE_ID) {
        res = { data: [] }
      }
    }
    const doc = (res.data && res.data[0]) || null
    return ok(doc ? {
      reservationId: doc._id,
      checkinCode: reservationCheckinCode(doc._id),
      name: doc.name,
      headcount: doc.headcount,
      status: doc.status,
      createdAt: doc.createdAt
    } : null)
  }

  /** 取消预约 */
  async function cancelReservation(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const sessionId = String(body.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    let session = await findSessionById(sessionId)
    if (session) session = await ensureSessionCycleFields(session)
    const cycleId = session ? sessionCycleId(session) : LEGACY_CYCLE_ID
    let res = await db.collection(RESERVATIONS)
      .where({ openid, sessionId, cycleId, status: _.neq('cancelled') })
      .update({ data: { status: 'cancelled', cancelledAt: now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    let cancelled = (res.stats && res.stats.updated) || 0
    if (!cancelled && cycleId === LEGACY_CYCLE_ID) {
      res = await db.collection(RESERVATIONS)
        .where({ openid, sessionId, status: _.neq('cancelled') })
        .update({ data: { status: 'cancelled', cancelledAt: now() } })
        .catch(() => ({ stats: { updated: 0 } }))
      cancelled = (res.stats && res.stats.updated) || 0
    }
    if (cancelled > 0) await bumpSessionStats(sessionId, { reservations: -cancelled })
    return ok(true)
  }

  /**
   * 现场扫码解锁抽奖资格：仅物料码（短码/scene）可发资格；站内 sessionId 跳转不发抽奖次数。
   * 每人每场次·每任务周期基础 1 抽（幂等）。真正抽奖还需商家点亮「发射成功」。
   */
  async function scanCheckIn(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    let session = await resolveSession(body)
    const gated = await sessionGate(session)
    if (gated) return fail(4040, gated)
    session = await ensureSessionCycleFields(session)
    const sessionId = session._id
    const cycleId = sessionCycleId(session)
    const channel = String(body.channel || '').trim().slice(0, 20) || 'site'
    // 仅携带场次短码（物料码 / 手动输码）视为现场扫码；纯 sessionId（站内跳转）不算
    const fromMaterial = !!String(body.code || '').trim()

    const loaded = await loadQuotaForCycle(sessionId, cycleId, openid)
    let quotaId = loaded.quotaId
    let quota = loaded.quota
    let isNewScan = false

    if (fromMaterial) {
      if (!quota) {
        try {
          await db.collection(QUOTA).add({
            data: {
              _id: quotaId,
              openid,
              sessionId,
              cycleId,
              channel,
              fromMaterial: true,
              total: 1,
              used: 0,
              shareBonusAt: 0,
              createdAt: now()
            }
          })
          isNewScan = true
        } catch (e) {
          // 并发重复创建：读回即可
        }
        const re = await db.collection(QUOTA).doc(quotaId).get().catch(() => null)
        quota = (re && re.data) || { total: 1, used: 0, fromMaterial: true, channel, cycleId }
      } else if (quota.fromMaterial !== true && String(quota.channel || '') === 'app') {
        // 曾仅站内进入：现场扫码后升级为物料资格
        await db.collection(QUOTA).doc(quotaId).update({
          data: {
            fromMaterial: true,
            channel,
            cycleId,
            total: Math.max(1, Number(quota.total) || 0)
          }
        }).catch(() => {})
        const re = await db.collection(QUOTA).doc(quotaId).get().catch(() => null)
        quota = (re && re.data) || quota
        if (!isMaterialQuota(quota)) {
          quota = { ...quota, fromMaterial: true, channel }
        }
        isNewScan = true
      }
    } else if (quota && !isMaterialQuota(quota)) {
      // 站内进入且无现场资格：不展示可用次数
      quota = { ...quota, total: quota.total || 0, used: quota.used || 0 }
    }

    // 观礼通行证：仅现场扫码发放（防站内白嫖）。
    // 商家场次双开关：后台按商家授权 passGrantEnabled（默认关）+ 商家场次自行开启，缺一不发证；
    // 无 merchantId 的平台自建场次不受商家授权约束
    let pass = null
    let passNewlyGranted = false
    let passAllowed = session.passEnabled === true
    if (passAllowed && session.merchantId) {
      const passMerchant = await findMerchant(session.merchantId)
      passAllowed = !!(passMerchant && passMerchant.passGrantEnabled === true)
    }
    if (fromMaterial && passAllowed && quota) {
      let inWindow = true
      if (session.launchTime) {
        const t = new Date(session.launchTime).getTime()
        if (t && !isNaN(t)) {
          inWindow = now() >= t - PASS_GRANT_WINDOW_MS && now() <= t + PASS_GRANT_WINDOW_MS
        }
      }
      if (inWindow) {
        let passExpiresAt = Number(quota.passExpiresAt || 0)
        if (!(passExpiresAt > now())) {
          const hours = Math.min(PASS_MAX_HOURS, Math.max(1, Number(session.passHours || PASS_DEFAULT_HOURS) || PASS_DEFAULT_HOURS))
          passExpiresAt = now() + hours * 3600 * 1000
          await db.collection(QUOTA).doc(quotaId)
            .update({ data: { passExpiresAt, passGrantedAt: now() } })
            .catch(() => {})
          passNewlyGranted = true
          quota = { ...quota, passExpiresAt }
        }
        pass = { expiresAt: passExpiresAt }
      }
    }

    // 预聚合计数（现场首扫 / 首次发证才计）
    const bump = {}
    if (isNewScan && fromMaterial) {
      bump.scanUsers = 1
      bump['channel.' + channelKey(channel)] = 1
    }
    if (passNewlyGranted) bump.passGranted = 1
    if (Object.keys(bump).length) await bumpSessionStats(sessionId, bump)

    const materialOk = isMaterialQuota(quota)
    const total = materialOk ? (quota.total || 0) : 0
    const used = materialOk ? (quota.used || 0) : 0
    return ok({
      session: await enrichPublicContact(publicSessionView(session), session),
      fromMaterial: materialOk,
      successUnlocked: !!session.successUnlockedAt,
      total,
      used,
      remaining: Math.max(0, total - used),
      pass
    })
  }

  /** 按剩余库存加权抽取奖品 */
  function pickWeightedPrize(prizes) {
    const pool = (prizes || [])
      .map((p) => ({ prize: p, weight: Math.max(0, Number(p.remaining) || 0) }))
      .filter((p) => p.weight > 0)
    const totalWeight = pool.reduce((s, p) => s + p.weight, 0)
    if (totalWeight <= 0) return null
    let r = Math.random() * totalWeight
    for (const p of pool) {
      r -= p.weight
      if (r <= 0) return p.prize
    }
    return pool[pool.length - 1].prize
  }

  /** 抽一件现场奖品（库存加权；事务防超发） */
  async function draw(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const sessionId = String(body.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    let session = await findSessionById(sessionId)
    const gated = await sessionGate(session)
    if (gated) return fail(4040, gated)
    session = await ensureSessionCycleFields(session)
    if (session.prizeDrawEnabled !== true) return fail(4031, '本场次未开放现场抽奖')
    if (!session.successUnlockedAt) return fail(4032, '请等待商家确认发射成功后再抽奖')

    const cycleId = sessionCycleId(session)
    const loaded = await loadQuotaForCycle(sessionId, cycleId, openid)
    const quotaId = loaded.quotaId
    const quota = loaded.quota
    if (!isMaterialQuota(quota)) return fail(4011, '请先扫描现场物料码解锁抽奖')
    if ((quota.used || 0) >= (quota.total || 0)) return fail(4012, '抽奖次数已用完')

    let drawn = null
    try {
      await db.runTransaction(async (tx) => {
        const sessDoc = await tx.collection(SESSIONS).doc(sessionId).get()
        const sess = sessDoc && sessDoc.data
        if (!sess || sess.prizeDrawEnabled !== true) throw Object.assign(new Error('本场次未开放现场抽奖'), { code: 4031 })
        if (!sess.successUnlockedAt) throw Object.assign(new Error('请等待商家确认发射成功后再抽奖'), { code: 4032 })
        const prizes = Array.isArray(sess.prizes) ? sess.prizes.slice() : []
        const prize = pickWeightedPrize(prizes)
        if (!prize) throw Object.assign(new Error('奖品已抽完'), { code: 4041 })
        const idx = prizes.findIndex((p) => p && p.id === prize.id)
        if (idx < 0 || Number(prizes[idx].remaining || 0) <= 0) {
          throw Object.assign(new Error('奖品已抽完'), { code: 4041 })
        }
        const qDoc = await tx.collection(QUOTA).doc(quotaId).get()
        const q = qDoc && qDoc.data
        if (!isMaterialQuota(q)) throw Object.assign(new Error('请先扫描现场物料码解锁抽奖'), { code: 4011 })
        if ((q.used || 0) >= (q.total || 0)) throw Object.assign(new Error('抽奖次数已用完'), { code: 4012 })

        const rem = Number(prizes[idx].remaining || 0) - 1
        const stock = Math.max(1, Number(prizes[idx].stock) || 1)
        prizes[idx] = { ...prizes[idx], remaining: rem }
        tx.collection(SESSIONS).doc(sessionId).update({ data: { prizes } })
        tx.collection(QUOTA).doc(quotaId).update({ data: { used: _.inc(1) } })

        const serialNo = stock - rem
        const record = {
          openid,
          sessionId,
          cycleId,
          sessionTitle: sess.title || '',
          prizeId: prizes[idx].id,
          name: prizes[idx].name || '',
          image: prizes[idx].image || '',
          valueYuan: prizes[idx].valueYuan == null ? null : Number(prizes[idx].valueYuan),
          serialNo,
          stock,
          source: String(body.source || 'scan').slice(0, 12),
          createdAt: now()
        }
        const addRes = await tx.collection(DRAWS).add({ data: record })
        drawn = {
          drawId: addRes._id,
          prize: {
            prizeId: record.prizeId,
            name: record.name,
            image: record.image,
            valueYuan: record.valueYuan,
            serialNo: record.serialNo,
            stock: record.stock
          },
          remaining: Math.max(0, (q.total || 0) - (q.used || 0) - 1)
        }
      })
    } catch (e) {
      const code = Number(e && e.code) || 5000
      if (code === 4011 || code === 4012 || code === 4031 || code === 4032 || code === 4041) {
        return fail(code, (e && e.message) || '抽奖失败')
      }
      return fail(5000, (e && e.message) || '抽奖失败，请重试')
    }
    if (!drawn) return fail(5000, '抽奖失败，请重试')
    await bumpSessionStats(sessionId, { draws: 1 })
    // 兼容旧前端字段名 card
    return ok({
      drawId: drawn.drawId,
      prize: drawn.prize,
      card: {
        cardId: drawn.prize.prizeId,
        name: drawn.prize.name,
        image: drawn.prize.image,
        rarity: '',
        desc: drawn.prize.valueYuan != null ? `价值约 ¥${drawn.prize.valueYuan}` : '',
        serialNo: drawn.prize.serialNo,
        limitTotal: drawn.prize.stock,
        valueYuan: drawn.prize.valueYuan
      },
      remaining: drawn.remaining
    })
  }

  /** 我的奖品（跨场次；兼容旧纪念卡发放记录） */
  async function getMyCards(openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const res = await db.collection(DRAWS)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get()
      .catch(() => ({ data: [] }))
    const list = (res.data || []).map((d) => ({
      drawId: d._id,
      sessionId: d.sessionId,
      sessionTitle: d.sessionTitle || '',
      prizeId: d.prizeId || d.cardId || '',
      cardId: d.prizeId || d.cardId || '',
      name: d.name || '',
      image: d.image || '',
      valueYuan: d.valueYuan == null ? null : Number(d.valueYuan),
      rarity: d.rarity || '',
      desc: d.desc || (d.valueYuan != null ? `价值约 ¥${d.valueYuan}` : ''),
      serialNo: d.serialNo || 0,
      stock: d.stock || d.limitTotal || 0,
      limitTotal: d.stock || d.limitTotal || 0,
      createdAt: d.createdAt
    }))
    return ok(list)
  }

  /** 分享后加 1 次抽奖（每任务周期一次；须已现场扫码） */
  async function shareBonus(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const sessionId = String(body.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    let session = await findSessionById(sessionId)
    if (!session) return fail(4040, '场次不存在')
    session = await ensureSessionCycleFields(session)
    const cycleId = sessionCycleId(session)
    const loaded = await loadQuotaForCycle(sessionId, cycleId, openid)
    const quotaId = loaded.quotaId
    const q0 = loaded.quota
    if (!isMaterialQuota(q0)) return fail(4011, '请先扫描现场物料码')
    const res = await db.collection(QUOTA)
      .where({ _id: quotaId, shareBonusAt: 0 })
      .update({ data: { shareBonusAt: now(), total: _.inc(1) } })
      .catch(() => ({ stats: { updated: 0 } }))
    const granted = !!(res.stats && res.stats.updated > 0)
    const re = await db.collection(QUOTA).doc(quotaId).get().catch(() => null)
    const quota = (re && re.data) || { total: 0, used: 0 }
    return ok({
      granted,
      total: quota.total || 0,
      used: quota.used || 0,
      remaining: Math.max(0, (quota.total || 0) - (quota.used || 0))
    })
  }

  /** 从 LL2 launch 抽取大屏讲解跳转所需 id */
  function extractExplainFromLaunch(launch) {
    if (!launch) return null
    const cfg = (launch.rocket && launch.rocket.configuration) || {}
    const lsp = launch.launch_service_provider || launch.agency || {}
    const pad = launch.pad || {}
    const loc = pad.location || {}
    return {
      agencyId: lsp.id != null ? String(lsp.id) : '',
      agencyName: String(lsp.name || '').trim(),
      agencyAbbrev: String(lsp.abbrev || '').trim(),
      rocketConfigId: cfg.id != null ? String(cfg.id) : '',
      rocketName: String(cfg.name || cfg.full_name || '').trim(),
      padLocationId: loc.id != null ? String(loc.id) : '',
      padLocationName: String(loc.name || pad.name || '').trim()
    }
  }

  /** 内存缓存：大屏轮询频繁，避免每次扫全量 upcoming 缓存 */
  let _explainCache = { at: 0, byMission: {} }

  async function resolveScreenExplain(session) {
    const base = {
      agencyId: String(session.agencyId || '').trim(),
      agencyName: String(session.agencyName || '').trim(),
      agencyAbbrev: String(session.agencyAbbrev || '').trim(),
      rocketConfigId: String(session.rocketConfigId || '').trim(),
      padLocationId: String(session.padLocationId || '').trim(),
      padLocationName: String(session.padLocationName || '').trim()
    }
    if (base.agencyId && base.rocketConfigId && base.padLocationId) {
      return base
    }
    const mid = String(session.missionId || '').trim()
    if (!mid) return base
    if (Date.now() - _explainCache.at < 10 * 60 * 1000 && _explainCache.byMission[mid]) {
      const cached = _explainCache.byMission[mid]
      return {
        agencyId: base.agencyId || cached.agencyId || '',
        agencyName: base.agencyName || cached.agencyName || '',
        agencyAbbrev: base.agencyAbbrev || cached.agencyAbbrev || '',
        rocketConfigId: base.rocketConfigId || cached.rocketConfigId || '',
        padLocationId: base.padLocationId || cached.padLocationId || '',
        padLocationName: base.padLocationName || cached.padLocationName || ''
      }
    }
    try {
      const { results } = await readLl2UpcomingCache()
      const launch = (results || []).find((l) => l && String(l.id) === mid)
      const meta = extractExplainFromLaunch(launch)
      if (meta) {
        _explainCache.byMission[mid] = meta
        _explainCache.at = Date.now()
        const merged = {
          agencyId: base.agencyId || meta.agencyId,
          agencyName: base.agencyName || meta.agencyName,
          agencyAbbrev: base.agencyAbbrev || meta.agencyAbbrev,
          rocketConfigId: base.rocketConfigId || meta.rocketConfigId,
          padLocationId: base.padLocationId || meta.padLocationId,
          padLocationName: base.padLocationName || meta.padLocationName
        }
        // 静默回填场次，后续轮询不再扫缓存
        db.collection(SESSIONS).doc(session._id).update({
          data: {
            agencyId: merged.agencyId,
            agencyName: merged.agencyName,
            agencyAbbrev: merged.agencyAbbrev,
            rocketConfigId: merged.rocketConfigId,
            padLocationId: merged.padLocationId,
            padLocationName: merged.padLocationName
          }
        }).catch(() => {})
        return merged
      }
    } catch (e) {}
    return base
  }

  /** 大屏页只读数据：场次信息 + 抽卡码 + 竞猜关联 launchId */
  async function getScreenData(query = {}) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const doc = await resolveSession(query)
    const gated = await sessionGate(doc)
    if (gated) return fail(4040, gated)
    const session = doc
    // 大屏轮询高频：直接用 session 上的预聚合计数，零额外查询
    const stats = sessionStatsView(session)
    // 科普配置图 + 自动生成的抽卡码：cloud:// 文件ID 转临时 https（HTML 大屏用；小程序端同样兼容）
    const rawImages = Array.isArray(session.scienceImages) ? session.scienceImages : []
    const rawQr = session.qrCodeUrl || session.qrCodeFileId || ''
    const urlMap = await resolveCloudFileUrls(rawImages.concat(rawQr ? [rawQr] : []))
    const scienceImages = rawImages
      .map((u) => urlMap[u] || u)
      .filter((u) => /^https?:\/\//.test(u))
    const qrResolved = urlMap[rawQr] || (/^https?:\/\//.test(rawQr) ? rawQr : '')
    const explain = await resolveScreenExplain(session)
    const prizes = publicPrizesView(session.prizes)
    const prizeImages = prizes.map((p) => p.image).filter(Boolean)
    const prizeUrlMap = await resolveCloudFileUrls(prizeImages)
    const prizesResolved = prizes.map((p) => ({
      ...p,
      image: prizeUrlMap[p.image] || p.image
    }))
    return ok({
      ...publicSessionView(session),
      ...explain,
      // 大屏副标题优先商家自定义中文任务名（容器内缓存，轮询不放大读量）
      missionDisplayName: await loadMissionDisplayName(session.missionId),
      scienceImages,
      qrCodeUrl: qrResolved,
      drawCount: stats.draws,
      reserveCount: stats.reservations,
      prizeDrawEnabled: session.prizeDrawEnabled === true,
      prizes: prizesResolved
    })
  }

  /**
   * 同行商家合作申请（公开）：观礼页表单或商家「推荐给同行」分享落地页提交。
   * 推荐归属（均服务端反查，防伪造）：refMerchantId（商家分享链接）优先，其次 sessionId 挂靠商家；
   * referrerSource 区分 merchant_share / session。
   * 提交即自动通过：直接创建商家（active + 商家编号）并把申请人微信绑定为员工，无需运营审核。
   * 防滥用：一个微信只允许一个商家；手机号已入驻/已申请不可重复。
   */
  async function applyMerchantLead(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const name = String(body.name || '').trim().slice(0, 40)
    const contactName = String(body.contactName || '').trim().slice(0, 20)
    const phone = String(body.phone || '').trim()
    /** 选填：顾客页「微信联系」长按识别的添加好友二维码 */
    const wechatQr = sanitizeContactWechatQr(body.wechatQr || body.contactWechatQr)
    const location = String(body.location || '').trim().slice(0, 120)
    const note = String(body.note || '').slice(0, 500)
    if (!name) return fail(4001, '请填写商家/观礼点名称')
    if (!contactName) return fail(4001, '请填写联系人姓名')
    if (!/^1\d{10}$/.test(phone)) return fail(4001, '请填写正确的手机号')

    // 一个微信只绑一个商家：已绑定的直接引导去商家中心
    const bound = await findMerchantByStaffOpenid(openid)
    if (bound) {
      return fail(4002, `当前微信已绑定「${bound.name || '商家'}」，请直接进入商家中心管理场次`)
    }
    // 手机号查重：已入驻商家或历史待处理申请
    const dupMerchant = await db.collection(MERCHANTS)
      .where({ contactPhone: phone })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (dupMerchant.data && dupMerchant.data.length > 0) {
      return fail(4002, '该手机号已入驻商家，请用绑定过的微信进入商家中心')
    }
    const dupByPhone = await db.collection(LEADS)
      .where({ phone, status: 'pending' })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (dupByPhone.data && dupByPhone.data.length > 0) {
      return fail(4002, '该手机号已提交过合作申请，请耐心等待联系')
    }

    let referrerMerchantId = ''
    let referrerMerchantName = ''
    /** 推荐来源：merchant_share 商家「推荐给同行」分享 / session 观礼场次页表单 */
    let referrerSource = ''
    // 商家分享链接直达（refMerchantId）：服务端反查商家存在性，名称以库内为准，防链接伪造/篡改
    const refMerchantId = String(body.refMerchantId || '').trim()
    if (refMerchantId) {
      const refMerchant = await findMerchant(refMerchantId)
      if (refMerchant) {
        referrerMerchantId = refMerchant._id || refMerchantId
        referrerMerchantName = refMerchant.name || ''
        referrerSource = 'merchant_share'
      }
    }
    if (!referrerMerchantId && body.sessionId) {
      const session = await findSessionById(String(body.sessionId))
      if (session && session.merchantId) {
        referrerMerchantId = session.merchantId
        referrerMerchantName = session.merchantName || ''
        referrerSource = 'session'
      }
    }

    // 自动入驻：创建商家（active）并绑定申请人微信为员工
    const merchantCode = await genUniqueMerchantCode()
    const ts = now()
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    const membershipGraceUntil = billingEnabled ? nextMonthFirstTs(ts) : 0
    const merchantAdd = await db.collection(MERCHANTS).add({
      data: {
        name,
        contactName,
        contactPhone: phone,
        contactWechatQr: wechatQr,
        address: location,
        lat: 0,
        lng: 0,
        intro: '',
        notice: '',
        parkingSpots: [],
        note: note ? `前端申请自动入驻：${note}` : '前端申请自动入驻',
        status: 'active',
        merchantCode,
        staffOpenids: [openid],
        referrerMerchantId,
        referrerMerchantName,
        referrerSource,
        membershipExpireAt: 0,
        membershipGraceUntil,
        membershipPaid: false,
        referralRewardGranted: false,
        createdAt: ts,
        updatedAt: ts,
        createdBy: 'lead:auto',
        updatedBy: 'lead:auto'
      }
    })

    // 推荐成功：给推荐人赠 1 个月商家会员（原价 188 元/月）
    let referralReward = null
    if (referrerMerchantId) {
      referralReward = await grantReferralMembershipReward(referrerMerchantId, {
        fromMerchantId: merchantAdd._id,
        fromMerchantName: name
      })
      if (referralReward) {
        await db.collection(MERCHANTS).doc(merchantAdd._id).update({
          data: { referralRewardGranted: true, updatedAt: now() }
        }).catch(() => {})
      }
    }

    const addRes = await db.collection(LEADS).add({
      data: {
        openid,
        name,
        contactName,
        phone,
        wechatQr,
        location,
        note,
        referrerMerchantId,
        referrerMerchantName,
        referrerSource,
        /** pending 待跟进 / contacted 已联系 / approved 已入驻 / rejected 已婉拒 */
        status: 'approved',
        adminNote: '前端提交自动入驻',
        merchantId: merchantAdd._id,
        referralRewarded: !!referralReward,
        createdAt: ts,
        updatedAt: ts
      }
    })
    invalidateGateCache()
    await writeOpLog({
      user: { id: 'merchant', username: 'lead:auto' },
      module: 'watch_party',
      action: 'auto_approve_merchant_lead',
      targetId: addRes._id,
      after: { merchantId: merchantAdd._id, name, billingEnabled, membershipGraceUntil }
    })
    return ok({
      leadId: addRes._id,
      merchantId: merchantAdd._id,
      merchantCode,
      bound: true,
      autoApproved: true,
      membershipBillingEnabled: billingEnabled,
      membershipNeedPay: billingEnabled,
      membershipGraceUntil,
      membershipPayNotice: billingEnabled
        ? membershipPayNoticeFor({ membershipExpireAt: 0, membershipGraceUntil }, true, ts)
        : '',
      membershipPriceYuan: MERCHANT_MEMBERSHIP_PRICE_YUAN,
      referralRewarded: !!referralReward
    })
  }

  // ══════════════════ 商家自助接口（小程序端，凭商家编号绑定 openid） ══════════════════
  //
  // 身份模型：运营在后台把「商家编号」发给入驻商家 → 商家在小程序输入编号绑定微信 →
  // 之后可全程在小程序端自建/管理观礼场次（短码与抽卡码自动生成，无需再进后台）。

  function merchantSelfView(doc, opts = {}) {
    const ts = now()
    const billingEnabled = opts.billingEnabled === true
    const membershipExpireAt = Number(doc.membershipExpireAt || 0)
    const membershipGraceUntil = Number(doc.membershipGraceUntil || 0)
    const membershipNeedPay = billingEnabled && !hasValidMembership(doc, ts)
    return {
      merchantId: doc._id,
      merchantCode: doc.merchantCode || '',
      name: doc.name || '',
      avatar: sanitizeCloudMediaUrl(doc.avatar),
      status: doc.status || 'active',
      /** 平台是否已为本商家开通「扫码赠通行证」（后台按商家授权，默认关闭） */
      passGrantEnabled: doc.passGrantEnabled === true,
      contactName: doc.contactName || '',
      contactPhone: doc.contactPhone || '',
      contactWechatQr: sanitizeContactWechatQr(doc.contactWechatQr),
      address: doc.address || '',
      lat: doc.lat || 0,
      lng: doc.lng || 0,
      intro: doc.intro || '',
      notice: doc.notice || '',
      parkingSpots: Array.isArray(doc.parkingSpots) ? doc.parkingSpots : [],
      prizePresets: sanitizePrizePresets(doc.prizePresets),
      membershipExpireAt,
      membershipGraceUntil,
      membershipPaid: doc.membershipPaid === true,
      membershipBillingEnabled: billingEnabled,
      membershipNeedPay,
      membershipExpireText: formatMembershipDate(membershipExpireAt),
      membershipGraceText: formatMembershipDate(membershipGraceUntil),
      membershipPayNotice: membershipPayNoticeFor(doc, billingEnabled, ts),
      membershipPriceYuan: MERCHANT_MEMBERSHIP_PRICE_YUAN,
      referralRewardCount: Number(doc.referralRewardCount || 0) || 0
    }
  }

  /**
   * 商家奖品库（常用奖品模板）：只存 name/image/stock/valueYuan，
   * 不含 id/remaining——导入场次时再生成，避免多场次共用库存状态。
   * 读写共用本清洗（读时兜底旧脏数据）。
   */
  function sanitizePrizePresets(raw) {
    if (!Array.isArray(raw)) return []
    return raw.slice(0, PRIZES_MAX).map((p, i) => {
      const name = String((p && p.name) || '').trim().slice(0, 40)
      const image = String((p && p.image) || '').trim().slice(0, 600)
      if (!name || !/^(cloud|https):\/\//.test(image)) return null
      return {
        name,
        image,
        stock: Math.min(9999, Math.max(1, Number(p.stock) || 1)),
        valueYuan: parsePrizeValueYuan(p && p.valueYuan),
        sort: i
      }
    }).filter(Boolean)
  }

  /** 保存商家奖品库（整份覆盖；传空数组 = 清空） */
  async function merchantSavePrizePresets(body = {}, openid) {
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const raw = Array.isArray(body.prizes) ? body.prizes : []
    const presets = sanitizePrizePresets(raw)
    if (raw.length && !presets.length) {
      return fail(4001, '奖品库保存失败：每件奖品需要名称和已上传的照片')
    }
    await db.collection(MERCHANTS).doc(merchant._id).update({
      data: { prizePresets: presets, updatedAt: now() }
    })
    invalidateGateCache(merchant._id)
    return ok({ prizePresets: presets, count: presets.length })
  }

  /**
   * 商家自助更新入驻资料（名称/联系人/联系电话/微信好友二维码/地址）。
   * 改名会同步名下所有场次的冗余 merchantName（顾客页「观礼点由 xx 提供」）；
   * 微信二维码变更同步名下场次，避免旧场次只剩电话。
   */
  async function merchantUpdateProfile(body = {}, openid) {
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const name = String(body.name || '').trim().slice(0, 40)
    const contactName = String(body.contactName || '').trim().slice(0, 20)
    const contactPhone = String(body.contactPhone || '').trim().replace(/[^\d+-]/g, '').slice(0, 20)
    const contactWechatQr = sanitizeContactWechatQr(body.contactWechatQr)
    const address = String(body.address || '').trim().slice(0, 120)
    if (!name) return fail(4001, '请填写商家/观礼点名称')
    if (contactPhone && contactPhone.replace(/\D/g, '').length < 6) {
      return fail(4001, '联系电话格式不正确')
    }
    if (contactPhone && contactPhone !== (merchant.contactPhone || '')) {
      const dup = await db.collection(MERCHANTS)
        .where({ contactPhone })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (dup.data && dup.data[0] && dup.data[0]._id !== merchant._id) {
        return fail(4002, '该手机号已被其他商家使用')
      }
    }
    await db.collection(MERCHANTS).doc(merchant._id).update({
      data: { name, contactName, contactPhone, contactWechatQr, address, updatedAt: now() }
    })
    const sessionPatch = {}
    if (name !== (merchant.name || '')) sessionPatch.merchantName = name
    if (contactWechatQr !== sanitizeContactWechatQr(merchant.contactWechatQr)) {
      sessionPatch.contactWechatQr = contactWechatQr
    }
    if (Object.keys(sessionPatch).length) {
      sessionPatch.updatedAt = now()
      await db.collection(SESSIONS)
        .where({ merchantId: merchant._id })
        .update({ data: sessionPatch })
        .catch(() => {})
    }
    invalidateGateCache(merchant._id)
    return ok({ name, contactName, contactPhone, contactWechatQr, address })
  }

  /**
   * 商家头像：小程序端先传云存储（≤2M 由端上限制），这里只收 cloud fileID / https。
   * 空值 = 移除头像。改动即清列表缓存，顾客选商家页头像同步更新。
   */
  async function merchantUpdateAvatar(body = {}, openid) {
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const raw = String(body.avatar || '').trim()
    const avatar = sanitizeCloudMediaUrl(raw)
    if (raw && !avatar) return fail(4001, '头像地址不合法，请重新上传')
    const prevAvatar = String(merchant.avatar || '').trim()
    await db.collection(MERCHANTS).doc(merchant._id).update({
      data: { avatar, updatedAt: now() }
    })
    // 换头像/移除头像：旧云存储文件一并删除，不残留
    if (prevAvatar && prevAvatar !== avatar && /^cloud:\/\//i.test(prevAvatar) &&
        cloud && typeof cloud.deleteFile === 'function') {
      await cloud.deleteFile({ fileList: [prevAvatar] }).catch(() => {})
    }
    invalidateGateCache(merchant._id)
    return ok({ avatar })
  }

  /** 商家端场次视图：编辑回填 + 概览统计（scienceImages 保留原始 cloud:// 供小程序显示与再编辑） */
  function merchantSessionView(doc) {
    const stats = sessionStatsView(doc)
    return {
      sessionId: doc._id,
      code: doc.code || '',
      title: doc.title || '',
      missionId: doc.missionId || '',
      missionName: doc.missionName || '',
      rocketName: doc.rocketName || '',
      rocketImageName: doc.rocketImageName || '',
      agencyId: doc.agencyId || '',
      agencyName: doc.agencyName || '',
      agencyAbbrev: doc.agencyAbbrev || '',
      rocketConfigId: doc.rocketConfigId || '',
      padLocationId: doc.padLocationId || '',
      padLocationName: doc.padLocationName || '',
      launchTime: doc.launchTime || '',
      address: doc.address || '',
      lat: doc.lat || 0,
      lng: doc.lng || 0,
      intro: doc.intro || '',
      notice: doc.notice || '',
      parkingSpots: Array.isArray(doc.parkingSpots) ? doc.parkingSpots : [],
      sciencePoints: Array.isArray(doc.sciencePoints) ? doc.sciencePoints : [],
      scienceImages: Array.isArray(doc.scienceImages) ? doc.scienceImages : [],
      sitePhotos: sanitizeSitePhotos(doc.sitePhotos),
      siteVideo: sanitizeCloudMediaUrl(doc.siteVideo),
      siteVideoPoster: sanitizeCloudMediaUrl(doc.siteVideoPoster),
      capacity: doc.capacity || 0,
      status: doc.status || 'open',
      enabled: doc.enabled !== false,
      passEnabled: doc.passEnabled === true,
      passHours: Math.min(PASS_MAX_HOURS, Math.max(1, Number(doc.passHours || PASS_DEFAULT_HOURS) || PASS_DEFAULT_HOURS)),
      services: sanitizeServices(doc.services),
      serviceOptions: SESSION_SERVICE_CATALOG,
      wechatGroupQr: wechatGroupQrsOf(doc)[0] || '',
      wechatGroupQrs: wechatGroupQrsOf(doc),
      vehicleBookingUrl: doc.vehicleBookingUrl || '',
      heroBadge: doc.heroBadge || '',
      contactPhone: doc.contactPhone || '',
      contactWechatQr: sanitizeContactWechatQr(doc.contactWechatQr),
      prizeDrawEnabled: doc.prizeDrawEnabled === true,
      prizes: publicPrizesView(doc.prizes),
      successUnlocked: !!doc.successUnlockedAt,
      successUnlockedAt: Number(doc.successUnlockedAt || 0) || 0,
      qrCodeReady: !!(doc.qrCodeUrl || doc.qrCodeFileId),
      stats: {
        scanUsers: stats.scanUsers,
        reservations: stats.reservations,
        checkedIn: stats.checkedIn,
        draws: stats.draws
      },
      currentCycleId: sessionCycleId(doc),
      cycleStartedAt: Number(doc.cycleStartedAt || doc.createdAt || 0) || 0,
      cycleHistoryCount: Array.isArray(doc.cycleHistory) ? doc.cycleHistory.length : 0,
      cycleHistory: cycleHistoryView(doc, 8),
      createdAt: doc.createdAt || 0
    }
  }

  async function findMerchantByStaffOpenid(openid) {
    const res = await db.collection(MERCHANTS)
      .where({ staffOpenids: openid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    return (res.data && res.data[0]) || null
  }

  /** 商家端鉴权：openid 必须已绑定某个未终止的商家 */
  async function requireMerchant(openid) {
    if (!openid) return { err: fail(4010, '未获取到用户身份') }
    const m = await findMerchantByStaffOpenid(openid)
    if (!m) return { err: fail(4011, '尚未绑定商家，请输入运营发放的商家编号') }
    if (m.status === 'terminated') {
      const unpaid = m.terminatedReason === 'membership_unpaid'
      return {
        err: fail(
          4030,
          unpaid
            ? ('该商家因未缴费已终止合作，' + MERCHANT_MEMBERSHIP_PAY_NOTICE)
            : '该商家已终止合作，如有疑问请联系运营'
        )
      }
    }
    return { merchant: m }
  }

  function merchantOperator(merchant) {
    return { id: 'merchant', username: 'merchant:' + (merchant.merchantCode || merchant._id) }
  }

  /** 凭商家编号绑定当前微信（同一商家可绑多个员工，幂等） */
  async function merchantBind(body = {}, openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!code) return fail(4001, '请输入商家编号')
    // 一个微信只绑一个商家：已绑定则直接返回（换绑先解绑）
    const bound = await findMerchantByStaffOpenid(openid)
    if (bound) {
      if ((bound.merchantCode || '') === code) {
        const billingEnabled = await isMerchantMembershipBillingEnabled()
        return ok({
          ...merchantSelfView(bound, { billingEnabled }),
          gateBypass: await resolveMerchantStaffGateBypass(bound)
        })
      }
      return fail(4002, `当前微信已绑定「${bound.name || '其他商家'}」，如需换绑请先在商家中心解绑`)
    }
    const res = await db.collection(MERCHANTS)
      .where({ merchantCode: code })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const m = res.data && res.data[0]
    if (!m) return fail(4040, '商家编号不存在，请核对运营发放的编号（区分数字与字母）')
    if (m.status === 'terminated') {
      const unpaid = m.terminatedReason === 'membership_unpaid'
      return fail(
        4030,
        unpaid
          ? ('该商家因未缴费已终止合作，无法绑定；' + MERCHANT_MEMBERSHIP_PAY_NOTICE)
          : '该商家已终止合作，无法绑定'
      )
    }
    const staff = Array.isArray(m.staffOpenids) ? m.staffOpenids : []
    if (staff.length >= MERCHANT_STAFF_MAX) return fail(4002, '该商家绑定人数已达上限，请联系运营处理')
    await db.collection(MERCHANTS).doc(m._id).update({
      data: { staffOpenids: _.addToSet(openid), updatedAt: now() }
    })
    invalidateGateCache(m._id)
    await writeOpLog({
      user: merchantOperator(m),
      module: 'watch_party',
      action: 'merchant_bind_staff',
      targetId: m._id
    })
    const fresh = await findMerchantByStaffOpenid(openid)
    const merchant = fresh || m
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    return ok({
      ...merchantSelfView(merchant, { billingEnabled }),
      gateBypass: await resolveMerchantStaffGateBypass(merchant)
    })
  }

  /** 解绑当前微信（不影响商家与场次数据） */
  async function merchantUnbind(openid) {
    if (!openid) return fail(4010, '未获取到用户身份')
    const m = await findMerchantByStaffOpenid(openid)
    if (m) {
      await db.collection(MERCHANTS).doc(m._id).update({
        data: { staffOpenids: _.pull(openid), updatedAt: now() }
      }).catch(() => {})
      invalidateGateCache(m._id)
    }
    return ok({ gateBypass: false })
  }

  /** 商家中心首屏：商家信息 + 名下场次（最近 30 场） */
  async function merchantMe(openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const sessRes = await db.collection(SESSIONS)
      .where({ merchantId: merchant._id })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
      .catch(() => ({ data: [] }))
    const sessions = (sessRes.data || []).map(merchantSessionView)
    // 任务显示名：附中文名 + 当前商家是否有命名权（编辑页据此展示输入框）
    const mids = []
    const seenMid = Object.create(null)
    sessions.forEach((s) => {
      const mid = s && s.missionId
      if (mid && !seenMid[mid]) { seenMid[mid] = 1; mids.push(mid) }
    })
    if (mids.length) {
      const pairs = await Promise.all(mids.map(async (mid) => {
        const [name, owner] = await Promise.all([
          loadMissionDisplayName(mid),
          resolveMissionNameOwner(mid)
        ])
        return { mid, name, editable: !owner || owner === merchant._id }
      }))
      const map = Object.create(null)
      pairs.forEach((p) => { map[p.mid] = p })
      sessions.forEach((s) => {
        const p = s && s.missionId ? map[s.missionId] : null
        if (p) {
          s.missionDisplayName = p.name
          s.missionNameEditable = p.editable
        }
      })
    }
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    return ok({
      merchant: merchantSelfView(merchant, { billingEnabled }),
      sessions,
      gateBypass: await resolveMerchantStaffGateBypass(merchant)
    })
  }

  /** @deprecated 旧纪念卡卡池已下线，保留空接口避免旧客户端报错 */
  async function merchantListCards(openid) {
    const { err } = await requireMerchant(openid)
    if (err) return err
    return ok({ list: [], deprecated: true })
  }

  /** 商家自建场次：短码/归属/抽卡码全自动；支持多场次（同月多次发射各建一场），上限 MERCHANT_SESSIONS_MAX */
  async function merchantCreateSession(body = {}, openid) {
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (merchant.status !== 'active') return fail(4030, '商家合作已暂停，暂不能新建场次，请联系运营')
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const existed = await countMerchantSessions(merchant._id)
    if (existed >= MERCHANT_SESSIONS_MAX) {
      return fail(4002, `场次数量已达上限（${MERCHANT_SESSIONS_MAX} 场），请删除不再使用的场次后再创建`)
    }
    const data = normalizeSessionBody(body)
    if (!data.title) return fail(4001, '请填写场次标题')
    data.code = await genUniqueSessionCode()
    data.merchantId = merchant._id
    data.merchantName = merchant.name || ''
    if (body.prizeDrawEnabled === undefined) data.prizeDrawEnabled = false
    if (body.prizes === undefined) data.prizes = []
    else data.prizes = sanitizePrizesCreate(body.prizes)
    if (data.prizeDrawEnabled && !data.prizes.length) {
      return fail(4001, '开启现场抽奖时请至少添加一件奖品')
    }
    if (body.services === undefined) data.services = []
    if (body.wechatGroupQrs === undefined && body.wechatGroupQr === undefined) {
      data.wechatGroupQr = ''
      data.wechatGroupQrs = []
    }
    if (body.vehicleBookingUrl === undefined) data.vehicleBookingUrl = ''
    if (body.sitePhotos === undefined) data.sitePhotos = []
    if (body.siteVideo === undefined) data.siteVideo = ''
    if (body.siteVideoPoster === undefined) data.siteVideoPoster = ''
    if (body.rocketImageName === undefined) data.rocketImageName = ''
    if (body.heroBadge === undefined) data.heroBadge = ''
    // 商家资料模板兜底（地址/坐标/介绍/须知/停车点/联系电话/微信好友二维码）
    if (!data.contactPhone) data.contactPhone = merchant.contactPhone || ''
    if (!data.contactWechatQr) data.contactWechatQr = sanitizeContactWechatQr(merchant.contactWechatQr)
    if (!data.address) data.address = merchant.address || ''
    if (!data.lat && merchant.lat) data.lat = merchant.lat
    if (!data.lng && merchant.lng) data.lng = merchant.lng
    if (!data.intro) data.intro = merchant.intro || ''
    if (!data.notice) data.notice = merchant.notice || ''
    if (!data.parkingSpots.length && Array.isArray(merchant.parkingSpots)) {
      data.parkingSpots = sanitizeParkingSpots(merchant.parkingSpots)
    }
    const operator = merchantOperator(merchant)
    const cycleId = newCycleId()
    const ts = now()
    const addRes = await db.collection(SESSIONS).add({
      data: {
        ...data,
        currentCycleId: cycleId,
        cycleStartedAt: ts,
        cycleHistory: [],
        stats: emptySessionStats(),
        createdAt: ts,
        updatedAt: ts,
        createdBy: operator.username,
        updatedBy: operator.username
      }
    })
    invalidateGateCache()
    const qrCodeReady = await autoGenerateSessionQrcode(addRes._id, data.code)
    await writeOpLog({
      user: operator,
      module: 'watch_party',
      action: 'merchant_create_session',
      targetId: addRes._id,
      after: data
    })
    return ok({ id: addRes._id, code: data.code, qrCodeReady, currentCycleId: cycleId })
  }

  /** 商家编辑自己的场次（短码/归属不可改；通行证/停车点/奖品可改；不切任务周期） */
  async function merchantUpdateSession(id, body = {}, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (!id) return fail(4001, '缺少场次ID')
    let exist = await findSessionById(id)
    if (!exist || exist.merchantId !== merchant._id) return fail(4040, '场次不存在或不属于当前商家')
    exist = await ensureSessionCycleFields(exist)
    const data = normalizeSessionBody(body)
    if (!data.title) return fail(4001, '请填写场次标题')
    data.code = exist.code
    data.merchantId = merchant._id
    data.merchantName = merchant.name || ''
    data.qrCodeUrl = exist.qrCodeUrl || ''
    // 编辑不切任务周期，也不清发射成功/统计/短码
    data.successUnlockedAt = Number(exist.successUnlockedAt || 0)
    data.currentCycleId = sessionCycleId(exist)
    data.cycleStartedAt = Number(exist.cycleStartedAt || exist.createdAt || 0) || 0
    data.cycleHistory = Array.isArray(exist.cycleHistory) ? exist.cycleHistory : []
    if (body.prizeDrawEnabled !== undefined) {
      data.prizeDrawEnabled = body.prizeDrawEnabled === true || body.prizeDrawEnabled === 'true' || body.prizeDrawEnabled === 1
    } else {
      data.prizeDrawEnabled = exist.prizeDrawEnabled === true
    }
    if (body.prizes !== undefined) {
      data.prizes = mergePrizes(body.prizes, exist.prizes || [])
    } else {
      data.prizes = Array.isArray(exist.prizes) ? exist.prizes : []
    }
    if (data.prizeDrawEnabled && !data.prizes.length) {
      return fail(4001, '开启现场抽奖时请至少添加一件奖品')
    }
    if (body.services === undefined) data.services = sanitizeServices(exist.services)
    if (body.wechatGroupQrs === undefined && body.wechatGroupQr === undefined) {
      data.wechatGroupQrs = wechatGroupQrsOf(exist)
      data.wechatGroupQr = data.wechatGroupQrs[0] || ''
    }
    if (body.vehicleBookingUrl === undefined) data.vehicleBookingUrl = exist.vehicleBookingUrl || ''
    if (body.sitePhotos === undefined) data.sitePhotos = sanitizeSitePhotos(exist.sitePhotos)
    if (body.siteVideo === undefined) data.siteVideo = sanitizeCloudMediaUrl(exist.siteVideo)
    if (body.siteVideoPoster === undefined) data.siteVideoPoster = sanitizeCloudMediaUrl(exist.siteVideoPoster)
    if (body.rocketImageName === undefined) data.rocketImageName = exist.rocketImageName || ''
    const operator = merchantOperator(merchant)
    await db.collection(SESSIONS).doc(id).update({
      data: { ...data, updatedAt: now(), updatedBy: operator.username }
    })
    invalidateGateCache()
    // 早期创建失败/尚无抽奖码的场次：编辑保存时自动补生成
    if (!exist.qrCodeFileId && !exist.qrCodeUrl) {
      await autoGenerateSessionQrcode(id, exist.code)
    }
    await writeOpLog({
      user: operator,
      module: 'watch_party',
      action: 'merchant_update_session',
      targetId: id,
      after: data
    })
    return ok(true)
  }

  /**
   * 商家确认「发射成功」：开放本场现场奖品抽奖（不可撤销，幂等）。
   * 用户仍须先扫现场物料码才有抽奖次数。
   */
  async function merchantUnlockSessionSuccess(id, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (!id) return fail(4001, '缺少场次ID')
    if (merchant.status !== 'active') return fail(4030, '商家合作已暂停，暂不能确认发射成功')
    const exist = await findSessionById(id)
    if (!exist || exist.merchantId !== merchant._id) return fail(4040, '场次不存在或不属于当前商家')
    if (exist.prizeDrawEnabled !== true) {
      return fail(4001, '请先在场次编辑中开启现场奖品抽奖并配置奖品')
    }
    if (exist.successUnlockedAt) {
      return ok({ already: true, successUnlockedAt: exist.successUnlockedAt })
    }
    const at = now()
    const operator = merchantOperator(merchant)
    await db.collection(SESSIONS).doc(id).update({
      data: {
        successUnlockedAt: at,
        updatedAt: at,
        updatedBy: operator.username
      }
    })
    invalidateGateCache()
    await writeOpLog({
      user: operator,
      module: 'watch_party',
      action: 'merchant_unlock_success',
      targetId: id,
      after: { successUnlockedAt: at }
    })
    return ok({ already: false, successUnlockedAt: at })
  }

  /**
   * 开启下一场发射：归档当前周期账本，开新周期（短码/物料码不变）。
   * 用户须再扫码才有新周期抽奖资格；须重新确认发射成功。
   */
  async function merchantStartNextCycle(id, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (!id) return fail(4001, '缺少场次ID')
    if (merchant.status !== 'active') return fail(4030, '商家合作已暂停，暂不能开启下一场')
    let exist = await findSessionById(id)
    if (!exist || exist.merchantId !== merchant._id) return fail(4040, '场次不存在或不属于当前商家')
    exist = await ensureSessionCycleFields(exist)

    const endedAt = now()
    const snapshot = buildCycleSnapshot(exist, endedAt)
    let history = Array.isArray(exist.cycleHistory) ? exist.cycleHistory.slice() : []
    history.push(snapshot)
    if (history.length > CYCLE_HISTORY_MAX) {
      history = history.slice(history.length - CYCLE_HISTORY_MAX)
    }
    const nextCycleId = newCycleId()
    const operator = merchantOperator(merchant)
    await db.collection(SESSIONS).doc(id).update({
      data: {
        cycleHistory: history,
        currentCycleId: nextCycleId,
        cycleStartedAt: endedAt,
        successUnlockedAt: 0,
        stats: emptySessionStats(),
        updatedAt: endedAt,
        updatedBy: operator.username
      }
    })
    invalidateGateCache()
    await writeOpLog({
      user: operator,
      module: 'watch_party',
      action: 'merchant_start_next_cycle',
      targetId: id,
      after: {
        archivedCycleId: snapshot.cycleId,
        currentCycleId: nextCycleId,
        archivedStats: snapshot.stats
      }
    })
    return ok({
      sessionId: id,
      archivedCycleId: snapshot.cycleId,
      currentCycleId: nextCycleId,
      cycleHistoryCount: history.length,
      tip: '本场统计已归档。请编辑下一发任务；用户需再扫物料码；抽奖需重新确认发射成功。物料码不变。'
    })
  }

  /** 商家删除自己的场次（预约与抽卡记录保留） */
  /** 场次文档携带的云存储文件（大屏图/现场照片/视频/群码/物料码），删除场次时清理用 */
  function collectSessionMediaFileIds(doc) {
    const out = []
    const push = (v) => {
      const s = String(v || '').trim()
      if (s && /^cloud:\/\//i.test(s) && out.indexOf(s) < 0) out.push(s)
    }
    if (!doc || typeof doc !== 'object') return out
    ;(Array.isArray(doc.scienceImages) ? doc.scienceImages : []).forEach(push)
    ;(Array.isArray(doc.sitePhotos) ? doc.sitePhotos : []).forEach(push)
    push(doc.siteVideo)
    push(doc.siteVideoPoster)
    push(doc.wechatGroupQr)
    ;(Array.isArray(doc.wechatGroupQrs) ? doc.wechatGroupQrs : []).forEach(push)
    push(doc.qrCodeFileId)
    return out
  }

  /** prizes[].image 单独收集：被中奖记录引用的须保留（顾客卡册/中奖历史还要显示） */
  function collectSessionPrizeImageFileIds(doc) {
    const out = []
    ;(Array.isArray(doc && doc.prizes) ? doc.prizes : []).forEach((p) => {
      const s = String((p && p.image) || '').trim()
      if (s && /^cloud:\/\//i.test(s) && out.indexOf(s) < 0) out.push(s)
    })
    return out
  }

  /**
   * 删除场次后清理其云存储媒体，不残留：
   * - 大屏图/现场照片/现场视频及封面/群码/物料码：直接删；
   * - 奖品图：先查中奖记录（souvenir_draws）引用，被引用的保留，避免用户奖品破图；
   *   引用查询失败或记录超上限未取全时保守保留全部奖品图。
   * 文件删除失败静默（残留可接受，不阻塞业务删除）。
   */
  async function cleanupSessionCloudFiles(doc) {
    try {
      if (!doc || !cloud || typeof cloud.deleteFile !== 'function') return 0
      const files = collectSessionMediaFileIds(doc)
      const prizeImages = collectSessionPrizeImageFileIds(doc)
      if (prizeImages.length) {
        const res = await db.collection(DRAWS)
          .where({ sessionId: doc._id })
          .limit(1000)
          .field({ image: true })
          .get()
          .catch(() => null)
        const rows = res && Array.isArray(res.data) ? res.data : null
        if (rows && rows.length < 1000) {
          const referenced = {}
          rows.forEach((r) => { if (r && r.image) referenced[String(r.image)] = true })
          prizeImages.forEach((img) => { if (!referenced[img]) files.push(img) })
        }
      }
      if (!files.length) return 0
      let n = 0
      for (let i = 0; i < files.length; i += 50) {
        const batch = files.slice(i, i + 50)
        await cloud.deleteFile({ fileList: batch })
          .then(() => { n += batch.length })
          .catch(() => {})
      }
      return n
    } catch (e) {
      return 0
    }
  }

  async function merchantDeleteSession(id, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (!id) return fail(4001, '缺少场次ID')
    const exist = await findSessionById(id)
    if (!exist || exist.merchantId !== merchant._id) return fail(4040, '场次不存在或不属于当前商家')
    await db.collection(SESSIONS).doc(id).remove()
    const cleanedFiles = await cleanupSessionCloudFiles(exist)
    invalidateGateCache()
    await writeOpLog({
      user: merchantOperator(merchant),
      module: 'watch_party',
      action: 'merchant_delete_session',
      targetId: id,
      after: { cleanedFiles }
    })
    return ok(true)
  }

  /**
   * 商家自助下载线下打印物料：返回本场抽卡小程序码临时 URL + 必须印在码上的商家名/用途文案。
   * 客户端据此合成标注海报再存相册，避免裸码打印分不清归属。
   */
  async function merchantGetSessionMaterial(id, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    if (!id) return fail(4001, '缺少场次ID')
    let exist = await findSessionById(id)
    if (!exist || exist.merchantId !== merchant._id) return fail(4040, '场次不存在或不属于当前商家')

    if (!exist.qrCodeFileId && !exist.qrCodeUrl) {
      const code = String(exist.code || '').trim()
      if (!code) return fail(5000, '场次短码缺失，无法生成物料码')
      await autoGenerateSessionQrcode(id, code)
      exist = await findSessionById(id)
      if (!exist) return fail(4040, '场次不存在或不属于当前商家')
    }

    const rawQr = exist.qrCodeUrl || exist.qrCodeFileId || ''
    const urlMap = await resolveCloudFileUrls(rawQr ? [rawQr] : [])
    const qrCodeUrl = urlMap[rawQr] || (/^https?:\/\//.test(String(rawQr)) ? String(rawQr) : '')
    if (!qrCodeUrl) {
      return fail(5000, '抽奖码尚未生成，请稍后在编辑页保存一次后再试')
    }

    return ok({
      merchantName: merchant.name || '',
      merchantCode: merchant.merchantCode || '',
      sessionId: exist._id,
      title: exist.title || '',
      code: exist.code || '',
      rocketName: exist.rocketName || '',
      missionName: exist.missionName || '',
      qrCodeUrl,
      /** 长期线下物料：客户端海报勿印任务/火箭/标题 */
      evergreen: true,
      purposeTitle: '现场观礼物料码',
      purposeLines: [
        exist.prizeDrawEnabled === true ? '扫码抽现场奖品' : '扫码进入观礼活动',
        '免费预约登记与到场核销'
      ],
      usageNote: '本点位长期物料 · 扫码进入当前观礼活动'
    })
  }

  /**
   * 商家查看本场预约名单（简约明细）
   * query: sessionId, status?, page?, pageSize?
   */
  async function merchantListReservations(openid, query = {}) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const sessionId = String(query.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    let session = await findSessionById(sessionId)
    if (!session || session.merchantId !== merchant._id) {
      return fail(4040, '场次不存在或不属于当前商家')
    }

    session = await ensureSessionCycleFields(session)
    const cycleId = sessionCycleId(session)
    const status = String(query.status || '').trim()
    const page = Math.max(1, Number(query.page || 1) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 30) || 30))
    // 默认只看当前任务周期；旧预约无 cycleId 时在 c0 周期一并展示
    const where = { sessionId, cycleId }
    if (status === 'pending' || status === 'checked_in' || status === 'cancelled') {
      where.status = status
    }
    const baseCycle = { sessionId, cycleId }

    const countPending = () => db.collection(RESERVATIONS)
      .where({ ...baseCycle, status: 'pending' }).count().catch(() => ({ total: 0 }))
    const countChecked = () => db.collection(RESERVATIONS)
      .where({ ...baseCycle, status: 'checked_in' }).count().catch(() => ({ total: 0 }))
    const countCancelled = () => db.collection(RESERVATIONS)
      .where({ ...baseCycle, status: 'cancelled' }).count().catch(() => ({ total: 0 }))
    const countFiltered = () => db.collection(RESERVATIONS)
      .where(where).count().catch(() => ({ total: 0 }))

    const [pendingRes, checkedRes, cancelledRes, filteredRes, listRes, peopleRes] = await Promise.all([
      countPending(),
      countChecked(),
      countCancelled(),
      countFiltered(),
      db.collection(RESERVATIONS)
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
        .catch(() => ({ data: [] })),
      // 有效预约人数合计（待到场+已核销），上限扫 200 条足够现场观礼
      db.collection(RESERVATIONS)
        .where({ ...baseCycle, status: _.in(['pending', 'checked_in']) })
        .field({ headcount: true })
        .limit(200)
        .get()
        .catch(() => ({ data: [] }))
    ])

    const pending = Number(pendingRes.total || 0)
    const checkedIn = Number(checkedRes.total || 0)
    const cancelled = Number(cancelledRes.total || 0)
    let people = 0
    ;(peopleRes.data || []).forEach((d) => {
      people += Math.max(1, Number(d.headcount || 1) || 1)
    })

    const list = (listRes.data || []).map((d) => ({
      reservationId: d._id,
      checkinCode: reservationCheckinCode(d._id),
      name: d.name || '',
      phone: d.phone || '',
      headcount: Math.max(1, Number(d.headcount || 1) || 1),
      channel: d.channel || '',
      status: d.status || 'pending',
      createdAt: d.createdAt || 0,
      checkedInAt: d.checkedInAt || 0
    }))

    return ok({
      session: {
        sessionId: session._id,
        title: session.title || '',
        rocketName: session.rocketName || '',
        missionName: session.missionName || '',
        launchTime: session.launchTime || '',
        capacity: Number(session.capacity || 0) || 0,
        status: session.status || 'open'
      },
      summary: {
        pending,
        checkedIn,
        cancelled,
        active: pending + checkedIn,
        people
      },
      list,
      total: Number(filteredRes.total || 0),
      page,
      pageSize
    })
  }

  /** 商家核销预约到场（幂等） */
  async function merchantCheckInReservation(id, openid) {
    const closed = await serviceGate()
    if (closed) return fail(4030, closed)
    const { merchant, err } = await requireMerchant(openid)
    if (err) return err
    const rid = String(id || '').trim()
    if (!rid) return fail(4001, '缺少预约ID')
    const rRes = await db.collection(RESERVATIONS).doc(rid).get().catch(() => null)
    const rDoc = rRes && rRes.data
    if (!rDoc) return fail(4004, '预约不存在')
    const session = await findSessionById(rDoc.sessionId)
    if (!session || session.merchantId !== merchant._id) {
      return fail(4040, '预约不属于当前商家')
    }
    if (rDoc.status === 'cancelled') return fail(4002, '该预约已取消')
    if (rDoc.status === 'checked_in') return ok({ already: true })
    await db.collection(RESERVATIONS).doc(rid).update({
      data: { status: 'checked_in', checkedInAt: now() }
    })
    await bumpSessionStats(rDoc.sessionId, { checkedIn: 1 })
    await writeOpLog({
      user: merchantOperator(merchant),
      module: 'watch_party',
      action: 'merchant_check_in',
      targetId: rid
    })
    return ok({ already: false })
  }

  // ══════════════════ 管理接口（perm: watch_party） ══════════════════

  // ── 全局开关（终止合作一键关停） ──

  /** 入驻商家员工是否免除全站会员门控（须全局开关开 + 商家 active） */
  async function resolveMerchantStaffGateBypass(merchant) {
    if (!merchant || merchant.status !== 'active') return false
    const doc = await getGlobalConfigDoc()
    return !!(doc && doc.merchantStaffGateBypass === true)
  }

  async function getGlobalConfig(user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const doc = await getGlobalConfigDoc()
    return ok({
      enabled: !doc || doc.enabled !== false,
      closedNotice: (doc && doc.closedNotice) || '',
      merchantStaffGateBypass: !!(doc && doc.merchantStaffGateBypass === true),
      /** 商家会员收费开关：关=试行免费；开=新入驻需缴费，未缴费宽限至下月1号后自动终止 */
      merchantMembershipBillingEnabled: !!(doc && doc.merchantMembershipBillingEnabled === true),
      merchantMembershipPriceYuan: MERCHANT_MEMBERSHIP_PRICE_YUAN,
      updatedAt: (doc && doc.updatedAt) || 0,
      updatedBy: (doc && doc.updatedBy) || ''
    })
  }

  async function updateGlobalConfig(body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const prev = (await getGlobalConfigDoc()) || {}
    const boolFrom = (v, fallback) => {
      if (v === undefined) return fallback
      return v === true || v === 'true' || v === 1
    }
    const data = {
      enabled: body.enabled !== undefined ? body.enabled !== false : (prev.enabled !== false),
      closedNotice: body.closedNotice !== undefined
        ? String(body.closedNotice || '').slice(0, 200)
        : String(prev.closedNotice || ''),
      merchantStaffGateBypass: boolFrom(body.merchantStaffGateBypass, !!prev.merchantStaffGateBypass),
      merchantMembershipBillingEnabled: boolFrom(
        body.merchantMembershipBillingEnabled,
        !!prev.merchantMembershipBillingEnabled
      ),
      updatedAt: now(),
      updatedBy: user.username
    }
    const billingJustEnabled = data.merchantMembershipBillingEnabled && !prev.merchantMembershipBillingEnabled
    const up = await db.collection(CONFIG).doc(GLOBAL_CONFIG_ID)
      .update({ data })
      .catch(() => null)
    if (!up || !up.stats || up.stats.updated < 1) {
      await db.collection(CONFIG).add({ data: { _id: GLOBAL_CONFIG_ID, ...data } }).catch(() => {})
    }
    invalidateGateCache()
    let graceSeeded = 0
    if (billingJustEnabled) {
      graceSeeded = await seedMembershipGraceForUnpaidMerchants(user)
    }
    let action = data.enabled ? 'enable_service' : 'disable_service'
    if (billingJustEnabled) action = 'enable_merchant_membership_billing'
    else if (
      body.merchantMembershipBillingEnabled !== undefined
      && !data.merchantMembershipBillingEnabled
      && !!prev.merchantMembershipBillingEnabled
    ) {
      action = 'disable_merchant_membership_billing'
    }
    await writeOpLog({
      user,
      module: 'watch_party',
      action,
      after: { ...data, graceSeeded }
    })
    return ok({ graceSeeded })
  }

  // ── 合作商家（观礼点）：入驻/暂停/终止 ──

  function normalizeMerchantBody(body = {}) {
    return {
      name: String(body.name || '').trim().slice(0, 40),
      contactName: String(body.contactName || '').trim().slice(0, 20),
      contactPhone: String(body.contactPhone || '').trim().slice(0, 20),
      contactWechatQr: sanitizeContactWechatQr(body.contactWechatQr),
      address: String(body.address || '').trim().slice(0, 120),
      lat: Number(body.lat || 0) || 0,
      lng: Number(body.lng || 0) || 0,
      intro: String(body.intro || '').slice(0, 2000),
      notice: String(body.notice || '').slice(0, 2000),
      parkingSpots: sanitizeParkingSpots(body.parkingSpots),
      /** 合作备注：分成方式、协议编号等，仅后台可见 */
      note: String(body.note || '').slice(0, 500),
      status: MERCHANT_STATUSES.includes(body.status) ? body.status : 'active'
    }
  }

  async function listMerchants(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    const countRes = await db.collection(MERCHANTS).count().catch(() => ({ total: 0 }))
    const res = await db.collection(MERCHANTS)
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  async function createMerchant(body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const data = normalizeMerchantBody(body)
    if (!data.name) return fail(4001, '请填写商家/观礼点名称')
    const merchantCode = await genUniqueMerchantCode()
    const ts = now()
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    const membershipGraceUntil = billingEnabled ? nextMonthFirstTs(ts) : 0
    const addRes = await db.collection(MERCHANTS).add({
      data: {
        ...data,
        /** 商家固定编号：运营复制发给商家，商家在小程序端凭它绑定后自助建场次 */
        merchantCode,
        staffOpenids: [],
        membershipExpireAt: 0,
        membershipGraceUntil,
        membershipPaid: false,
        createdAt: ts,
        updatedAt: ts,
        createdBy: user.username,
        updatedBy: user.username
      }
    })
    await writeOpLog({
      user,
      module: 'watch_party',
      action: 'create_merchant',
      targetId: addRes._id,
      after: { ...data, membershipGraceUntil, billingEnabled }
    })
    return ok({ id: addRes._id, merchantCode, membershipGraceUntil, membershipNeedPay: billingEnabled })
  }

  /** 老商家补发编号 / 重新生成编号（regenerate=true 时旧编号作废，已绑定微信保留） */
  async function ensureMerchantCode(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少商家ID')
    const res = await db.collection(MERCHANTS).doc(id).get().catch(() => null)
    const m = res && res.data
    if (!m) return fail(4040, '商家不存在')
    if (m.merchantCode && !(body && body.regenerate)) return ok({ merchantCode: m.merchantCode })
    const merchantCode = await genUniqueMerchantCode()
    await db.collection(MERCHANTS).doc(id).update({
      data: { merchantCode, updatedAt: now(), updatedBy: user.username }
    })
    invalidateGateCache(id)
    await writeOpLog({ user, module: 'watch_party', action: 'gen_merchant_code', targetId: id })
    return ok({ merchantCode })
  }

  async function updateMerchant(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少商家ID')
    const data = normalizeMerchantBody(body)
    if (!data.name) return fail(4001, '请填写商家/观礼点名称')
    const prev = await findMerchant(id)
    if (!prev) return fail(4040, '商家不存在')
    const ts = now()
    const patch = { ...data, updatedAt: ts, updatedBy: user.username }
    // 收费开启后：
    // - 已终止 → 合作中：禁止裸恢复（须走「续费」）
    // - 暂停 → 合作中：若无有效会员/宽限，补写下月1日宽限，避免恢复后立刻被清扫
    // - 本就合作中：只改资料时不改动会员/宽限字段
    if (data.status === 'active' && prev.status !== 'active') {
      const billingOn = await isMerchantMembershipBillingEnabled()
      if (billingOn) {
        const probe = {
          membershipExpireAt: prev.membershipExpireAt,
          membershipGraceUntil: prev.membershipGraceUntil
        }
        if (!hasValidMembership(probe, ts) && !isInMembershipGrace(probe, ts)) {
          if (prev.status === 'terminated') {
            return fail(4002, '该商家无有效会员期，请使用「续费」恢复合作（续费会自动算截止日期）')
          }
          patch.membershipGraceUntil = nextMonthFirstTs(ts)
        }
      }
      if (prev.terminatedReason === 'membership_unpaid') {
        patch.terminatedReason = ''
        patch.terminatedAt = 0
      }
    }
    await db.collection(MERCHANTS).doc(id).update({ data: patch })
    // 改名 + 微信号同步到名下场次（顾客页联系入口读场次字段，缺省另有商家资料回落）
    await db.collection(SESSIONS)
      .where({ merchantId: id })
      .update({
        data: {
          merchantName: data.name,
          contactWechatQr: data.contactWechatQr || '',
          updatedAt: ts
        }
      })
      .catch(() => {})
    invalidateGateCache(id)
    await writeOpLog({ user, module: 'watch_party', action: 'update_merchant', targetId: id, after: patch })
    return ok(true)
  }

  /**
   * 后台按商家授权「扫码赠通行证」（默认关闭）。
   * 双开关：平台授权 + 商家在小程序场次里自行开启，缺一不发证；关闭立即止发（容器缓存最多延迟 30s）。
   */
  async function updateMerchantPassGrant(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少商家ID')
    const res = await db.collection(MERCHANTS).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '商家不存在')
    const enabled = !!(body && (body.enabled === true || body.enabled === 'true' || body.enabled === 1))
    await db.collection(MERCHANTS).doc(id).update({
      data: { passGrantEnabled: enabled, updatedAt: now(), updatedBy: user.username }
    })
    invalidateGateCache(id)
    await writeOpLog({
      user,
      module: 'watch_party',
      action: enabled ? 'enable_merchant_pass_grant' : 'disable_merchant_pass_grant',
      targetId: id
    })
    return ok(true)
  }

  /**
   * 运营确认收款后续费：从 max(现在, 原截止) 叠加 1 月 / 1 季 / 1 年。
   * 因未缴费被终止的商户续费后自动恢复为合作中。
   */
  async function renewMerchantMembership(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少商家ID')
    const plan = String((body && body.plan) || '').trim()
    const months = MERCHANT_MEMBERSHIP_RENEW_MONTHS[plan]
    if (!months) return fail(4001, '请选择续费时长：month（1个月）/ quarter（1季度）/ year（1年）')
    const m = await findMerchant(id)
    if (!m) return fail(4040, '商家不存在')
    const ts = now()
    const base = Math.max(ts, Number(m.membershipExpireAt || 0))
    const membershipExpireAt = addMonthsTs(base, months)
    const patch = {
      membershipExpireAt,
      membershipGraceUntil: 0,
      membershipPaid: true,
      membershipLastRenewPlan: plan,
      membershipLastRenewAt: ts,
      membershipLastRenewMonths: months,
      updatedAt: ts,
      updatedBy: user.username
    }
    if (m.status === 'terminated' && m.terminatedReason === 'membership_unpaid') {
      patch.status = 'active'
      patch.terminatedReason = ''
      patch.terminatedAt = 0
    }
    await db.collection(MERCHANTS).doc(id).update({ data: patch })
    invalidateGateCache(id)
    await writeOpLog({
      user,
      module: 'watch_party',
      action: 'renew_merchant_membership',
      targetId: id,
      after: { plan, months, membershipExpireAt, priceYuan: MERCHANT_MEMBERSHIP_PRICE_YUAN * months }
    })
    return ok({
      membershipExpireAt,
      membershipExpireText: formatMembershipDate(membershipExpireAt),
      plan,
      months,
      priceYuan: MERCHANT_MEMBERSHIP_PRICE_YUAN * months
    })
  }

  /**
   * 收费开启后清扫：无有效会员期且宽限已过的合作中/已暂停商家 → 终止合作。
   * 供定时任务与后台手动触发。
   * 先收集候选再终止：边分页边改 status 会让 skip 错位漏单。
   */
  async function sweepMerchantMemberships(user) {
    if (!user || user.username !== 'cron') {
      const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    }
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    if (!billingEnabled) return ok({ skipped: true, reason: 'billing_off', terminated: 0 })
    const ts = now()
    let terminated = 0
    const actor = (user && user.username) || 'cron'
    const victims = []
    for (const status of ['active', 'paused']) {
      let skip = 0
      for (;;) {
        const list = await listMerchantsByStatusPaged(status, skip, 100)
        if (!list.length) break
        for (const m of list) {
          if (hasValidMembership(m, ts) || isInMembershipGrace(m, ts)) continue
          victims.push(m._id)
        }
        if (list.length < 100) break
        skip += 100
      }
    }
    for (const id of victims) {
      const up = await db.collection(MERCHANTS).doc(id).update({
        data: {
          status: 'terminated',
          terminatedReason: 'membership_unpaid',
          terminatedAt: ts,
          updatedAt: ts,
          updatedBy: actor
        }
      }).catch(() => null)
      if (!up || !up.stats || up.stats.updated < 1) continue
      invalidateGateCache(id)
      terminated++
    }
    if (terminated > 0) {
      await writeOpLog({
        user: user || { id: 'system', username: 'cron' },
        module: 'watch_party',
        action: 'sweep_merchant_memberships',
        after: { terminated }
      }).catch(() => {})
    }
    return ok({ terminated })
  }

  async function deleteMerchant(id, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少商家ID')
    const usedRes = await db.collection(SESSIONS)
      .where({ merchantId: id })
      .count()
      .catch(() => ({ total: 0 }))
    if ((usedRes.total || 0) > 0) {
      return fail(4002, `该商家名下还有 ${usedRes.total} 个场次，请先删除场次或将商家状态改为「终止合作」`)
    }
    const mDoc = await findMerchant(id).catch(() => null)
    await db.collection(MERCHANTS).doc(id).remove()
    // 商家头像云存储文件一并删除，不残留
    const avatar = String((mDoc && mDoc.avatar) || '').trim()
    if (avatar && /^cloud:\/\//i.test(avatar) && cloud && typeof cloud.deleteFile === 'function') {
      await cloud.deleteFile({ fileList: [avatar] }).catch(() => {})
    }
    invalidateGateCache(id)
    await writeOpLog({ user, module: 'watch_party', action: 'delete_merchant', targetId: id })
    return ok(true)
  }

  // ── 同行商家合作申请（推荐入驻漏斗） ──

  async function listMerchantLeads(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const status = String(query.status || '').trim()
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    const where = status ? { status } : null
    const countQ = where ? db.collection(LEADS).where(where) : db.collection(LEADS)
    const countRes = await countQ.count().catch(() => ({ total: 0 }))
    let q = db.collection(LEADS)
    if (where) q = q.where(where)
    const res = await q
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  /** 更新申请状态（已联系/婉拒）与跟进备注 */
  async function updateMerchantLead(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少申请ID')
    const status = ['pending', 'contacted', 'rejected'].includes(body.status) ? body.status : null
    if (!status) return fail(4001, '无效的申请状态')
    await db.collection(LEADS).doc(id).update({
      data: {
        status,
        adminNote: String(body.adminNote || '').slice(0, 500),
        updatedAt: now()
      }
    })
    await writeOpLog({ user, module: 'watch_party', action: 'update_merchant_lead', targetId: id, after: { status } })
    return ok(true)
  }

  /** 申请通过 → 一键创建商家（带推荐归属），申请标记已入驻 */
  async function approveMerchantLead(id, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少申请ID')
    const leadRes = await db.collection(LEADS).doc(id).get().catch(() => null)
    const lead = leadRes && leadRes.data
    if (!lead) return fail(4040, '申请不存在')
    if (lead.status === 'approved') return fail(4002, '该申请已入驻，请勿重复操作')

    const merchantCode = await genUniqueMerchantCode()
    const ts = now()
    const billingEnabled = await isMerchantMembershipBillingEnabled()
    const membershipGraceUntil = billingEnabled ? nextMonthFirstTs(ts) : 0
    const referrerMerchantId = lead.referrerMerchantId || ''
    const addRes = await db.collection(MERCHANTS).add({
      data: {
        name: lead.name || '',
        contactName: lead.contactName || '',
        contactPhone: lead.phone || '',
        contactWechatQr: sanitizeContactWechatQr(lead.wechatQr || lead.contactWechatQr),
        address: lead.location || '',
        lat: 0,
        lng: 0,
        intro: '',
        notice: '',
        parkingSpots: [],
        note: lead.note ? `合作申请转入驻：${lead.note}` : '合作申请转入驻',
        status: 'active',
        merchantCode,
        staffOpenids: [],
        referrerMerchantId,
        referrerMerchantName: lead.referrerMerchantName || '',
        referrerSource: lead.referrerSource || '',
        membershipExpireAt: 0,
        membershipGraceUntil,
        membershipPaid: false,
        referralRewardGranted: false,
        createdAt: ts,
        updatedAt: ts,
        createdBy: user.username,
        updatedBy: user.username
      }
    })
    let referralReward = null
    if (referrerMerchantId && !lead.referralRewarded) {
      referralReward = await grantReferralMembershipReward(referrerMerchantId, {
        fromMerchantId: addRes._id,
        fromMerchantName: lead.name || ''
      })
      if (referralReward) {
        await db.collection(MERCHANTS).doc(addRes._id).update({
          data: { referralRewardGranted: true, updatedAt: now() }
        }).catch(() => {})
      }
    }
    await db.collection(LEADS).doc(id).update({
      data: {
        status: 'approved',
        merchantId: addRes._id,
        referralRewarded: !!referralReward || !!lead.referralRewarded,
        updatedAt: now()
      }
    })
    await writeOpLog({
      user,
      module: 'watch_party',
      action: 'approve_merchant_lead',
      targetId: id,
      after: { merchantId: addRes._id, membershipGraceUntil, referralRewarded: !!referralReward }
    })
    return ok({ merchantId: addRes._id, merchantCode, membershipGraceUntil })
  }

  // ── 场次 ──

  async function listSessions(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
    const merchantId = String(query.merchantId || '').trim()
    const where = merchantId ? { merchantId } : null
    const countQ = where ? db.collection(SESSIONS).where(where) : db.collection(SESSIONS)
    const countRes = await countQ.count().catch(() => ({ total: 0 }))
    let q = db.collection(SESSIONS)
    if (where) q = q.where(where)
    const res = await q
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  /** 场次挂靠商家时校验商家存在并快照名称（避免前端传错） */
  async function attachMerchantSnapshot(data) {
    if (!data.merchantId) {
      data.merchantName = ''
      return null
    }
    const m = await findMerchant(data.merchantId)
    if (!m) return fail(4001, '关联的商家不存在，请刷新后重选')
    data.merchantName = m.name || ''
    return null
  }

  async function createSession(body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const data = normalizeSessionBody(body)
    if (!data.title) return fail(4001, '请填写场次标题')
    if (!data.code) return fail(4001, '请填写场次短码（用于现场小程序码，如 wc01）')
    if (body.prizeDrawEnabled === undefined) data.prizeDrawEnabled = false
    data.prizes = sanitizePrizesCreate(body.prizes)
    if (body.services === undefined) data.services = []
    if (body.wechatGroupQrs === undefined && body.wechatGroupQr === undefined) {
      data.wechatGroupQr = ''
      data.wechatGroupQrs = []
    }
    if (body.vehicleBookingUrl === undefined) data.vehicleBookingUrl = ''
    if (body.sitePhotos === undefined) data.sitePhotos = []
    if (body.siteVideo === undefined) data.siteVideo = ''
    if (body.siteVideoPoster === undefined) data.siteVideoPoster = ''
    if (body.rocketImageName === undefined) data.rocketImageName = ''
    const merchantErr = await attachMerchantSnapshot(data)
    if (merchantErr) return merchantErr
    if (data.merchantId) {
      const existed = await countMerchantSessions(data.merchantId)
      if (existed >= MERCHANT_SESSIONS_MAX) {
        return fail(4002, `该商家场次数量已达上限（${MERCHANT_SESSIONS_MAX} 场），请先删除不用的场次`)
      }
    }
    const dup = await findSessionByCode(data.code)
    if (dup) return fail(4002, `短码 ${data.code} 已被其他场次占用`)
    const cycleId = newCycleId()
    const ts = now()
    const addRes = await db.collection(SESSIONS).add({
      data: {
        ...data,
        currentCycleId: cycleId,
        cycleStartedAt: ts,
        cycleHistory: [],
        /** 预聚合计数器（详见 bumpSessionStats）：统计/大屏/走单均从这里读，避免扫表 */
        stats: emptySessionStats(),
        createdAt: ts,
        updatedAt: ts,
        createdBy: user.username,
        updatedBy: user.username
      }
    })
    invalidateGateCache()
    await writeOpLog({ user, module: 'watch_party', action: 'create_session', targetId: addRes._id, after: data })
    return ok({ id: addRes._id, currentCycleId: cycleId })
  }

  async function updateSession(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少场次ID')
    const exist = await findSessionById(id)
    if (!exist) return fail(4004, '场次不存在')
    const data = normalizeSessionBody(body)
    if (!data.title) return fail(4001, '请填写场次标题')
    if (!data.code) return fail(4001, '请填写场次短码')
    if (body.prizeDrawEnabled !== undefined) {
      data.prizeDrawEnabled = body.prizeDrawEnabled === true || body.prizeDrawEnabled === 'true' || body.prizeDrawEnabled === 1
    } else {
      data.prizeDrawEnabled = exist.prizeDrawEnabled === true
    }
    if (body.prizes !== undefined) {
      data.prizes = mergePrizes(body.prizes, exist.prizes || [])
    } else {
      data.prizes = Array.isArray(exist.prizes) ? exist.prizes : []
    }
    if (body.services === undefined) data.services = sanitizeServices(exist.services)
    if (body.wechatGroupQrs === undefined && body.wechatGroupQr === undefined) {
      data.wechatGroupQrs = wechatGroupQrsOf(exist)
      data.wechatGroupQr = data.wechatGroupQrs[0] || ''
    }
    if (body.vehicleBookingUrl === undefined) data.vehicleBookingUrl = exist.vehicleBookingUrl || ''
    if (body.sitePhotos === undefined) data.sitePhotos = sanitizeSitePhotos(exist.sitePhotos)
    if (body.siteVideo === undefined) data.siteVideo = sanitizeCloudMediaUrl(exist.siteVideo)
    if (body.siteVideoPoster === undefined) data.siteVideoPoster = sanitizeCloudMediaUrl(exist.siteVideoPoster)
    if (body.rocketImageName === undefined) data.rocketImageName = exist.rocketImageName || ''
    const merchantErr = await attachMerchantSnapshot(data)
    if (merchantErr) return merchantErr
    const dup = await findSessionByCode(data.code)
    if (dup && dup._id !== id) return fail(4002, `短码 ${data.code} 已被其他场次占用`)
    await db.collection(SESSIONS).doc(id).update({
      data: { ...data, updatedAt: now(), updatedBy: user.username }
    })
    invalidateGateCache()
    await writeOpLog({ user, module: 'watch_party', action: 'update_session', targetId: id, after: data })
    return ok(true)
  }

  async function deleteSession(id, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少场次ID')
    const exist = await findSessionById(id)
    await db.collection(SESSIONS).doc(id).remove()
    const cleanedFiles = exist ? await cleanupSessionCloudFiles(exist) : 0
    invalidateGateCache()
    await writeOpLog({ user, module: 'watch_party', action: 'delete_session', targetId: id, after: { cleanedFiles } })
    return ok(true)
  }

  async function listReservations(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const sessionId = String(query.sessionId || '').trim()
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    const where = sessionId ? { sessionId } : {}
    if (query.status) where.status = String(query.status)
    const countRes = await db.collection(RESERVATIONS).where(where).count().catch(() => ({ total: 0 }))
    let q = db.collection(RESERVATIONS)
    if (Object.keys(where).length) q = q.where(where)
    const res = await q
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  async function checkInReservation(id, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少预约ID')
    const rRes = await db.collection(RESERVATIONS).doc(id).get().catch(() => null)
    const rDoc = rRes && rRes.data
    if (!rDoc) return fail(4004, '预约不存在')
    // 重复核销幂等：不重复计数
    if (rDoc.status === 'checked_in') return ok(true)
    await db.collection(RESERVATIONS).doc(id).update({
      data: { status: 'checked_in', checkedInAt: now() }
    })
    await bumpSessionStats(rDoc.sessionId, { checkedIn: 1 })
    await writeOpLog({ user, module: 'watch_party', action: 'check_in', targetId: id })
    return ok(true)
  }

  function normalizeCardBody(body = {}) {
    const rarity = RARITIES.includes(body.rarity) ? body.rarity : 'N'
    return {
      cardId: Math.max(0, Number(body.cardId || 0) || 0),
      sessionId: String(body.sessionId || '').trim(),
      name: String(body.name || '').trim().slice(0, 40),
      rarity,
      image: String(body.image || '').trim(),
      desc: String(body.desc || '').slice(0, 500),
      limitTotal: Math.max(0, Number(body.limitTotal || 0) || 0),
      weight: Math.max(0, Number(body.weight || 0) || 0),
      successOnly: !!body.successOnly,
      enabled: body.enabled !== false
    }
  }

  async function listCards(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const sessionId = query.sessionId != null ? String(query.sessionId).trim() : null
    let q = db.collection(CARDS)
    if (sessionId !== null && sessionId !== 'all') q = q.where({ sessionId })
    const countQ = sessionId !== null && sessionId !== 'all'
      ? db.collection(CARDS).where({ sessionId })
      : db.collection(CARDS)
    const countRes = await countQ.count().catch(() => ({ total: 0 }))
    const res = await q.orderBy('cardId', 'asc').limit(200).get().catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  async function createCard(body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const data = normalizeCardBody(body)
    if (!data.name) return fail(4001, '请填写卡片名称')
    const addRes = await db.collection(CARDS).add({
      data: {
        ...data,
        issuedCount: 0,
        createdAt: now(),
        updatedAt: now(),
        createdBy: user.username,
        updatedBy: user.username
      }
    })
    await writeOpLog({ user, module: 'watch_party', action: 'create_card', targetId: addRes._id, after: data })
    return ok({ id: addRes._id })
  }

  async function updateCard(id, body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少卡片ID')
    const data = normalizeCardBody(body)
    if (!data.name) return fail(4001, '请填写卡片名称')
    await db.collection(CARDS).doc(id).update({
      data: { ...data, updatedAt: now(), updatedBy: user.username }
    })
    await writeOpLog({ user, module: 'watch_party', action: 'update_card', targetId: id, after: data })
    return ok(true)
  }

  async function deleteCard(id, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    if (!id) return fail(4001, '缺少卡片ID')
    await db.collection(CARDS).doc(id).remove()
    await writeOpLog({ user, module: 'watch_party', action: 'delete_card', targetId: id })
    return ok(true)
  }

  async function listDraws(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const sessionId = String(query.sessionId || '').trim()
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    const where = sessionId ? { sessionId } : {}
    let q = db.collection(DRAWS)
    if (sessionId) q = q.where(where)
    const countQ = sessionId ? db.collection(DRAWS).where(where) : db.collection(DRAWS)
    const countRes = await countQ.count().catch(() => ({ total: 0 }))
    const res = await q
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    return ok({ list: res.data || [], total: countRes.total || 0 })
  }

  /**
   * 场次统计：预约 / 核销 / 抽卡稀有度分布 / 扫码渠道分布
   * 云资源优化：全部读 session 文档上的预聚合计数器（1 次读），
   * 旧实现要 2 次 count + 拉最多 2000 条明细文档。
   */
  async function getStats(user, query = {}) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const sessionId = String(query.sessionId || '').trim()
    if (!sessionId) return fail(4001, '缺少场次ID')
    let doc = await findSessionById(sessionId)
    if (!doc) return fail(4004, '场次不存在')
    doc = await ensureSessionCycleFields(doc)
    const current = sessionStatsView(doc)
    return ok({
      ...current,
      currentCycleId: sessionCycleId(doc),
      cycleStartedAt: Number(doc.cycleStartedAt || doc.createdAt || 0) || 0,
      missionId: doc.missionId || '',
      missionName: doc.missionName || '',
      rocketName: doc.rocketName || '',
      launchTime: doc.launchTime || '',
      title: doc.title || '',
      cycles: [
        {
          cycleId: sessionCycleId(doc),
          current: true,
          missionId: doc.missionId || '',
          missionName: doc.missionName || '',
          rocketName: doc.rocketName || '',
          launchTime: doc.launchTime || '',
          title: doc.title || '',
          successUnlocked: !!doc.successUnlockedAt,
          scanUsers: current.scanUsers,
          reservations: current.reservations,
          checkedIn: current.checkedIn,
          draws: current.draws,
          passGranted: current.passGranted,
          channelCount: current.channelCount,
          startedAt: Number(doc.cycleStartedAt || doc.createdAt || 0) || 0,
          endedAt: 0
        },
        ...cycleHistoryView(doc, CYCLE_HISTORY_MAX)
      ]
    })
  }

  /**
   * 商家走单统计：跨场次汇总该商家的真实到场数据（谈判/分成依据）。
   * 「一单」以现场扫码为准（每人每场次一条 quota 记录），另附预约/核销/抽卡/通行证与渠道分布。
   */
  async function getMerchantStats(merchantId, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const id = String(merchantId || '').trim()
    if (!id) return fail(4001, '缺少商家ID')
    const mRes = await db.collection(MERCHANTS).doc(id).get().catch(() => null)
    const merchant = (mRes && mRes.data) || null
    if (!merchant) return fail(4004, '商家不存在')

    // 商家名下场次（一个场次 = 一次发射活动），最多统计最近 30 场。
    // 云资源优化：全部读场次文档上的预聚合计数器，整个统计只花 ≤31 次读
    //（旧实现每场次要 3 次 count + 拉最多 1000 条明细，30 场最坏 3 万次读）。
    const sessRes = await db.collection(SESSIONS)
      .where({ merchantId: id })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
      .catch(() => ({ data: [] }))
    const sessions = sessRes.data || []

    const channelCount = {}
    const perSession = []
    const perCycle = []

    sessions.forEach((raw) => {
      const s = raw || {}
      const v = sessionStatsView(s)
      Object.keys(v.channelCount).forEach((ch) => {
        channelCount[ch] = (channelCount[ch] || 0) + v.channelCount[ch]
      })
      const hist = cycleHistoryView(s, CYCLE_HISTORY_MAX)
      hist.forEach((c) => {
        // 历史周期渠道不在热路径 channel 聚合里重复加（归档时已从当时 stats 拷出；走单总量用 cycle 明细）
        perCycle.push({
          sessionId: s._id,
          current: false,
          ...c
        })
      })
      perCycle.push({
        sessionId: s._id,
        cycleId: sessionCycleId(s),
        current: true,
        missionId: s.missionId || '',
        missionName: s.missionName || '',
        rocketName: s.rocketName || '',
        launchTime: s.launchTime || '',
        title: s.title || '',
        successUnlocked: !!s.successUnlockedAt,
        scanUsers: v.scanUsers,
        reservations: v.reservations,
        checkedIn: v.checkedIn,
        draws: v.draws,
        startedAt: Number(s.cycleStartedAt || s.createdAt || 0) || 0,
        endedAt: 0
      })
      // 场次行 = 当前周期 + 历史周期合计（便于总览）
      let sumScan = v.scanUsers
      let sumRes = v.reservations
      let sumChk = v.checkedIn
      let sumDraw = v.draws
      let sumPass = v.passGranted
      hist.forEach((c) => {
        sumScan += c.scanUsers
        sumRes += c.reservations
        sumChk += c.checkedIn
        sumDraw += c.draws
      })
      ;(Array.isArray(s.cycleHistory) ? s.cycleHistory : []).forEach((c) => {
        const st = (c && c.stats) || {}
        sumPass += Number(st.passGranted || 0) || 0
        const ch = st.channel || {}
        Object.keys(ch).forEach((k) => {
          channelCount[k] = (channelCount[k] || 0) + (Number(ch[k]) || 0)
        })
      })
      perSession.push({
        sessionId: s._id,
        title: s.title || '',
        launchTime: s.launchTime || '',
        status: s.status || 'open',
        currentCycleId: sessionCycleId(s),
        cycleHistoryCount: Array.isArray(s.cycleHistory) ? s.cycleHistory.length : 0,
        scanUsers: sumScan,
        reservations: sumRes,
        checkedIn: sumChk,
        draws: sumDraw,
        passGranted: sumPass,
        currentScanUsers: v.scanUsers,
        currentDraws: v.draws
      })
    })

    const totals = { sessions: perSession.length, scanUsers: 0, reservations: 0, checkedIn: 0, draws: 0, passGranted: 0 }
    perSession.forEach((s) => {
      totals.scanUsers += s.scanUsers
      totals.reservations += s.reservations
      totals.checkedIn += s.checkedIn
      totals.draws += s.draws
      totals.passGranted += s.passGranted
    })

    return ok({
      merchant: { merchantId: id, name: merchant.name || '', status: merchant.status || 'active', createdAt: merchant.createdAt || 0 },
      totals,
      channelCount,
      sessions: perSession,
      cycles: perCycle
    })
  }

  /**
   * 现场物料小程序码：scene = wp:<场次码>:<渠道>（≤32 字符）
   * 取码双路：配置了小程序凭证走 HTTP 直连（管理后台链路无 wxCloudApiToken，
   * 云调用必失败）；未配置凭证时回落 cloud.openapi（仅小程序端触发链路可用，
   * 需 config.json openapi 权限 wxacode.getUnlimited）。
   */
  async function generateWxacode(body, user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const code = String(body.code || '').trim().toLowerCase()
    const channel = String(body.channel || 'site').trim().slice(0, 20)
    if (!code) return fail(4001, '缺少场次短码')
    const scene = `wp:${code}:${channel}`
    if (scene.length > 32) return fail(4001, 'scene 超长（短码+渠道合计需 ≤ 28 字符）')
    const page = String(body.page || 'subpackages/watch-party/gacha').replace(/^\//, '')
    const envVersion = String(body.envVersion || 'release')
    const width = Math.min(1280, Math.max(280, Number(body.width || 860)))

    let buffer = null
    let contentType = 'image/jpeg'
    try {
      const res = await fetchWxacodeBuffer({ scene, page, envVersion, width })
      buffer = res.buffer
      contentType = res.contentType || 'image/jpeg'
    } catch (e) {
      let msg = e.errMsg || e.message || String(e)
      if (/wxCloudApiToken/i.test(msg)) {
        msg += '（管理后台链路无法云调用取码，请在 adminGateway 云函数环境变量配置 APPID + SECRET 后重新部署，将自动改走 HTTP 接口）'
      }
      return fail(5001, '生成小程序码失败: ' + msg)
    }
    if (!buffer || !buffer.length) return fail(5001, '生成小程序码失败：无返回数据')
    await writeOpLog({ user, module: 'watch_party', action: 'gen_wxacode', targetId: scene })
    return ok({ scene, base64: Buffer.from(buffer).toString('base64'), contentType })
  }

  // ── 即将发射任务列表（后台「新增场次」自动获取用，读 LL2 同步缓存，零外网请求） ──

  function unwrapLl2CacheDoc(doc) {
    if (!doc || !doc.data) return null
    const wrapper = doc.data
    if (wrapper.data && typeof wrapper.data === 'object') {
      return { wrapper, payload: wrapper.data }
    }
    if (Array.isArray(wrapper.results) || wrapper.isBatched || wrapper.isBatch) {
      return { wrapper, payload: wrapper }
    }
    return null
  }

  /** 批次感知读取 space_devs_cache：优先主文档 batchKeys（含 generation 分片） */
  async function readLl2ListCache(path, params) {
    const sortedParams = JSON.stringify(
      Object.keys(params).sort().reduce((acc, k) => {
        acc[k] = params[k]
        return acc
      }, {})
    )
    const col = db.collection(SPACE_DEVS_COL)
    let cacheKey = null
    let wrapper = null
    let payload = null
    for (const sfx of LL2_SLIM_SUFFIXES) {
      const key = `api_cache_${path}_${sortedParams}${sfx}`
      const d = await col.doc(key).get().catch(() => null)
      const unwrapped = unwrapLl2CacheDoc(d)
      if (unwrapped && unwrapped.payload) {
        cacheKey = key
        wrapper = unwrapped.wrapper
        payload = unwrapped.payload
        break
      }
    }
    if (!payload) {
      try {
        const escaped = String(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const fallbackDocs = await col
          .where({ _id: db.RegExp({ regexp: `api_cache_${escaped}`, options: 'i' }) })
          .limit(8)
          .get()
        const rows = (fallbackDocs && fallbackDocs.data) || []
        rows.sort((a, b) => {
          const as = String(a._id || '').includes('_slim_v6') ? 0 : 1
          const bs = String(b._id || '').includes('_slim_v6') ? 0 : 1
          return as - bs
        })
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const unwrapped = unwrapLl2CacheDoc({ data: row })
          if (!unwrapped || !unwrapped.payload) continue
          cacheKey = row._id
          wrapper = unwrapped.wrapper
          payload = unwrapped.payload
          break
        }
      } catch (e) {}
    }
    if (!payload) return { results: [], updatedAt: 0 }
    const updatedAt = (wrapper && (wrapper.updatedAt || wrapper.timestamp)) || 0
    let allResults = []
    const isBatched = !!(payload.isBatched || payload.isBatch)
      || (Array.isArray(payload.results) && payload.results.length === 0 && Number(payload.count) > 0)
    if (isBatched) {
      const declared = Array.isArray(payload.batchKeys) && payload.batchKeys.length
        ? payload.batchKeys.slice()
        : null
      if (declared) {
        for (let i = 0; i < declared.length; i++) {
          const batchDoc = await col.doc(declared[i]).get().catch(() => null)
          const batchUnwrapped = unwrapLl2CacheDoc(batchDoc)
          const batchPayload = batchUnwrapped && batchUnwrapped.payload
          if (batchPayload && Array.isArray(batchPayload.results)) {
            allResults = allResults.concat(batchPayload.results)
          }
        }
      } else if (cacheKey) {
        let batchIdx = 0
        while (batchIdx < 40) {
          const batchDoc = await col.doc(`${cacheKey}_batch_${batchIdx}`).get().catch(() => null)
          const batchUnwrapped = unwrapLl2CacheDoc(batchDoc)
          const batchPayload = batchUnwrapped && batchUnwrapped.payload
          if (!batchPayload || !Array.isArray(batchPayload.results)) break
          allResults = allResults.concat(batchPayload.results)
          batchIdx++
        }
      }
    }
    if (!allResults.length && Array.isArray(payload.results)) allResults = payload.results
    return { results: allResults, updatedAt }
  }

  async function readLl2UpcomingCache() {
    return readLl2ListCache(LL2_UPCOMING_PATH, LL2_UPCOMING_PARAMS)
  }

  function extractAdminRecovery(launch) {
    const rocket = (launch && launch.rocket) || {}
    let raw = rocket.launcher_stage || (rocket.rocket && rocket.rocket.launcher_stage) || rocket.first_stage
    if (!raw) return { landingType: '', landingLocation: '', recoveryKey: '' }
    const stages = Array.isArray(raw) ? raw : [raw]
    let asds = false
    let rtls = false
    let expended = false
    let landingType = ''
    let landingLocation = ''
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]
      if (!stage || typeof stage !== 'object') continue
      const ld = stage.landing || {}
      const typeObj = ld.type && typeof ld.type === 'object' ? ld.type : null
      const typeStr = String((typeObj && (typeObj.abbrev || typeObj.name)) || stage.landing_type || ld.type || '').toUpperCase()
      const locObj = ld.landing_location && typeof ld.landing_location === 'object' ? ld.landing_location : null
      const locStr = String((locObj && (locObj.abbrev || locObj.name)) || stage.landing_location || '').toUpperCase()
      const desc = String(ld.description || '').toUpperCase()
      const blob = typeStr + ' ' + locStr + ' ' + desc
      if (!landingType && typeStr) landingType = typeStr
      if (!landingLocation && (locObj && (locObj.abbrev || locObj.name))) {
        landingLocation = locObj.abbrev || locObj.name
      }
      if (/ASDS|ASOG|OCISLY|JRTI|DRONE|SHORTFALL|STILL LOVE|INSTRUCTIONS|OCEAN/.test(blob)) asds = true
      if (/RTLS|LZ-|LANDING ZONE|GROUND PAD/.test(blob)) rtls = true
      if (/EXP|EXPEND|DISPOSED/.test(typeStr) || ld.attempt === false) expended = true
    }
    return {
      landingType,
      landingLocation,
      recoveryKey: asds ? 'asds' : (rtls ? 'rtls' : (expended ? 'expended' : ''))
    }
  }

  function mapLaunchToAdminMission(launch) {
    const cfg = (launch.rocket && launch.rocket.configuration) || {}
    const fullName = String(launch.name || '')
    const flightMatch =
      fullName.match(/flight\s*(?:test\s*)?#?\s*(\d+)/i) ||
      fullName.match(/\bift[-\s]?(\d+)/i)
    const recovery = extractAdminRecovery(launch)
    return {
      missionId: String(launch.id),
      name: fullName,
      missionName: (launch.mission && launch.mission.name) || fullName.split('|').pop().trim(),
      rocketName: cfg.name || fullName.split('|')[0].trim(),
      launchTime: launch.net || launch.window_start || '',
      status: (launch.status && (launch.status.name || launch.status.abbrev)) || '',
      pad: (launch.pad && launch.pad.name) || '',
      launchSite: (launch.pad && launch.pad.location && launch.pad.location.name) || '',
      landingType: recovery.landingType,
      landingLocation: recovery.landingLocation,
      recoveryKey: recovery.recoveryKey,
      flightNumber: flightMatch ? Number(flightMatch[1]) || 0 : 0
    }
  }

  /**
   * 即将发射任务核心列表（无权限门）：读 LL2 upcoming 缓存，保持 sync 时的 ordering=net 顺序
   *（与小程序 getUpcomingMissions 同源，勿再按 Date.parse 重排，避免 TBD 占位日打乱顺序）
   */
  async function listUpcomingLaunchesCore(limit = 30) {
    const max = Math.min(100, Math.max(1, Number(limit) || 30))
    const { results, updatedAt } = await readLl2UpcomingCache()
    const nowMs = Date.now()
    const raw = []
    for (const launch of results) {
      if (!launch || launch.id == null) continue
      raw.push(launch)
    }
    const list = []
    for (const launch of raw) {
      const net = launch.net || launch.window_start || ''
      const t = Date.parse(net)
      if (Number.isFinite(t) && t < nowMs - 2 * 3600 * 1000) continue
      list.push(mapLaunchToAdminMission(launch))
      if (list.length >= max) break
    }
    if (list.length) return { list, updatedAt }
    return { list: raw.slice(0, max).map(mapLaunchToAdminMission), updatedAt }
  }

  /**
   * 历史发射任务核心列表：读 LL2 previous 缓存（ordering=-net），与小程序历史列表同源
   */
  async function listPreviousLaunchesCore(limit = 50) {
    const max = Math.min(100, Math.max(1, Number(limit) || 50))
    const { results, updatedAt } = await readLl2ListCache(LL2_PREVIOUS_PATH, LL2_PREVIOUS_PARAMS)
    const list = []
    for (const launch of results) {
      if (!launch || launch.id == null) continue
      list.push(mapLaunchToAdminMission(launch))
      if (list.length >= max) break
    }
    return { list, updatedAt }
  }

  /** 即将发射任务（管理端）：任务id/名称/火箭型号/发射时间，供新增场次一键带入 */
  async function listUpcomingLaunchesAdmin(user) {
    const deny = checkPerm(user, 'watch_party'); if (deny) return deny
    const data = await listUpcomingLaunchesCore(30)
    return ok(data)
  }

  return {
    // 公开
    getPublicConfig,
    matchPublicSession,
    getPublicSession,
    listPublicSessions,
    reserve,
    getMyReservation,
    cancelReservation,
    scanCheckIn,
    draw,
    getMyCards,
    shareBonus,
    getScreenData,
    applyMerchantLead,
    // 商家自助（小程序端，凭商家编号绑定）
    merchantBind,
    merchantUnbind,
    merchantMe,
    merchantUpdateProfile,
    merchantUpdateAvatar,
    merchantSavePrizePresets,
    merchantListCards,
    merchantCreateSession,
    merchantUpdateSession,
    merchantGetMissionName,
    merchantSetMissionDisplayName,
    merchantUnlockSessionSuccess,
    merchantStartNextCycle,
    merchantDeleteSession,
    merchantGetSessionMaterial,
    merchantListReservations,
    merchantCheckInReservation,
    // 管理
    getGlobalConfig,
    updateGlobalConfig,
    listMerchants,
    createMerchant,
    ensureMerchantCode,
    listUpcomingLaunchesAdmin,
    listUpcomingLaunchesCore,
    listPreviousLaunchesCore,
    updateMerchant,
    updateMerchantPassGrant,
    renewMerchantMembership,
    sweepMerchantMemberships,
    deleteMerchant,
    listMerchantLeads,
    updateMerchantLead,
    approveMerchantLead,
    listSessions,
    createSession,
    updateSession,
    deleteSession,
    listReservations,
    checkInReservation,
    listCards,
    createCard,
    updateCard,
    deleteCard,
    listDraws,
    getStats,
    getMerchantStats,
    generateWxacode
  }
}

module.exports = { createWatchPartyApi }
