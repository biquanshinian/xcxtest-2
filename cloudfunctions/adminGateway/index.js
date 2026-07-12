const cloud = require('wx-server-sdk')
const crypto = require('crypto')

// COS SDK / bcryptjs 体积大，顶层同步 require 会拖慢冷启动数秒；
// 竞猜等高频用户请求用不到它们，改为使用处懒加载 + 模块级缓存
let _bcryptMod = null
function getBcrypt() {
  if (!_bcryptMod) _bcryptMod = require('bcryptjs')
  return _bcryptMod
}
let _cosMod = null
function getCOSSdk() {
  if (!_cosMod) _cosMod = require('cos-nodejs-sdk-v5')
  return _cosMod
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

function createCOSClient() {
  const COS = getCOSSdk()
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

const COLLECTIONS = {
  USERS: 'admin_users',
  EVENTS: 'news_events',
  ARTICLES: 'news_articles',
  LOGS: 'operation_logs',
  STARSHIP: 'starshipStatus',
  ROAD_CLOSURE: 'road_closure_notice',
  SPACEX_STATS: 'spacex_launch_stats',
  CAROUSEL: 'carousel_config',
  MEDIA_ASSETS: 'media_assets',
  MEDIA_FEED: 'media_feed',
  SHOP_FEED: 'shop_feed',
  LIVE_CONFIG: 'live_config',
  CHANNELS_LIVE_CONFIG: 'channels_live_config',
  STARSHIP_SPLASH: 'starship_splash_config',
  CHECKLIST_HISTORY: 'starship_checklist_history',
  STARSHIP_EVENT_UPDATES: 'starship_event_updates',
  GLOBAL_CONFIG: 'global_config',
  ANNOUNCEMENTS: 'system_announcements',
  PUSH_HISTORY: 'push_history',
  LAUNCH_SUBSCRIPTIONS: 'launch_subscriptions',
  LAUNCH_VOTES: 'launch_votes',
  DEMO_MODE: 'demo_mode',
  LUNAR_WISHES: 'lunar_wishes',
  LUNAR_WISHES_STATS: 'lunar_wishes_stats',
  MILESTONE_REWARDS: 'milestone_rewards',
  MILESTONE_CLAIMS: 'milestone_claims',
  KNOWLEDGE_CARDS: 'knowledge_cards',
    ANNUAL_REPORT_CONFIG: 'annual_report_config',
    ANNUAL_REPORT_SNAPSHOTS: 'annual_report_snapshots'
}

/** 新环境可能没有对应集合：云函数首轮请求时尝试创建，已存在则忽略错误（与 membership 云函数同源策略） */
let _adminGatewayCollectionsEnsured = false

/** 管理端未列入 COLLECTIONS 但会用到的集合（快照/同步/缓存等） */
const ADMIN_GATEWAY_EXTRA_COLLECTIONS = [
  'space_devs_cache',
  'tweet_accounts',
  'launch_stats',
  'booster_genealogy',
  'user_profile',
  'launch_data',
  'live_status_cache',
  'telemetry_cache',
  'launch_vote_records',
  'nextspaceflight_starship_cache',
  'user_membership',
  'membership_orders',
  'security_rate_limits',
  'security_captchas',
  'oa_auto_alert_users',
  'oa_push_ledger',
  'bilibili_topic_keywords',
  'bilibili_topic_blacklist',
  'bilibili_publish_queue'
]

function ensureAdminGatewayCollectionsOnce() {
  if (_adminGatewayCollectionsEnsured) return
  _adminGatewayCollectionsEnsured = true
  // 错峰 5 秒再发起：50+ 个并行 createCollection 会在冷启动瞬间挤占实例的
  // 数据库连接配额，把首个用户请求（通常是首页竞猜查询）的查询排到队尾。
  // 生产环境集合早已存在，该检查纯属新环境兜底，延后执行无副作用。
  setTimeout(() => {
    const criticalCollections = [...new Set([
      ...Object.values(COLLECTIONS),
      ...ADMIN_GATEWAY_EXTRA_COLLECTIONS
    ])]
    Promise.all(
      criticalCollections.map((name) => db.createCollection(name).catch(() => {}))
    ).catch(() => {})
  }, 5000)
}

const GATEWAY_CACHE_COLLECTION = 'security_gateway_cache'
const PROFILE_FEED_CACHE_VERSION_KEY = 'profile_feed_version'

function ok(data = null, message = 'ok') {
  return { code: 0, message, data }
}

function fail(code, message, data = null) {
  return { code, message, data }
}

function now() {
  return Date.now()
}

/** 与 profileFeedGateway / sync 一致，避免后台改库后小程序仍命中旧列表缓存 */
async function bumpProfileFeedCacheVersion() {
  const ts = now()
  try {
    await db.collection(GATEWAY_CACHE_COLLECTION).doc(PROFILE_FEED_CACHE_VERSION_KEY).update({
      data: {
        value: _.inc(1),
        updatedAt: ts
      }
    })
  } catch (e) {
    try {
      await db.collection(GATEWAY_CACHE_COLLECTION).doc(PROFILE_FEED_CACHE_VERSION_KEY).set({
        data: {
          value: 1,
          updatedAt: ts,
          expireAt: ts + 3650 * 24 * 60 * 60 * 1000
        }
      })
    } catch (e2) {}
  }
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex')
}

const TOKEN_SECRET = (function resolveTokenSecret() {
  const v = process.env.TOKEN_SECRET || ''
  if (!v || v.length < 32) {
    // 启动即失败，避免使用弱默认密钥导致任意 token 伪造
    throw new Error('[adminGateway] TOKEN_SECRET environment variable is required and must be at least 32 chars')
  }
  return v
})()

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

const LOGIN_RATE_COLLECTION = 'security_rate_limits'
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000
const LOGIN_FAIL_THRESHOLD = 6
const LOGIN_LOCK_MS = 30 * 60 * 1000

const CAPTCHA_COLLECTION = 'security_captchas'
const CAPTCHA_TTL_MS = 5 * 60 * 1000
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCaptchaText(len = 4) {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += CAPTCHA_CHARS[crypto.randomInt(0, CAPTCHA_CHARS.length)]
  }
  return s
}

function escapeXml(s) {
  return String(s).replace(/[<>&'\"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  })[c])
}

function renderCaptchaSvg(text) {
  const width = 140
  const height = 44
  const colors = ['#6366F1', '#8B5CF6', '#A855F7', '#EC4899', '#F59E0B', '#22D3EE']
  const pick = () => colors[crypto.randomInt(0, colors.length)]
  const rnd = (min, max) => Math.floor(min + Math.random() * (max - min))

  const lines = []
  for (let i = 0; i < 4; i++) {
    lines.push(`<path d="M${rnd(0, width)} ${rnd(0, height)} Q ${rnd(0, width)} ${rnd(0, height)} ${rnd(0, width)} ${rnd(0, height)}" stroke="${pick()}" stroke-width="1" fill="none" opacity="0.55"/>`)
  }
  const dots = []
  for (let i = 0; i < 24; i++) {
    dots.push(`<circle cx="${rnd(0, width)}" cy="${rnd(0, height)}" r="${rnd(1, 2)}" fill="${pick()}" opacity="0.6"/>`)
  }
  const chars = text.split('').map((ch, i) => {
    const x = 16 + i * ((width - 32) / Math.max(1, text.length - 1))
    const y = 30 + rnd(-3, 4)
    const rot = rnd(-22, 22)
    return `<text x="${x}" y="${y}" font-family="Verdana, Arial, sans-serif" font-size="26" font-weight="700" fill="${pick()}" transform="rotate(${rot} ${x} ${y})">${escapeXml(ch)}</text>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f1226"/>
  ${lines.join('')}
  ${dots.join('')}
  ${chars.join('')}
</svg>`
}

async function issueCaptcha() {
  const text = randomCaptchaText(4)
  const id = crypto.randomBytes(16).toString('hex')
  const ts = now()
  try {
    await db.collection(CAPTCHA_COLLECTION).doc(id).set({
      data: {
        text: text.toUpperCase(),
        createdAt: ts,
        expireAt: ts + CAPTCHA_TTL_MS,
        used: false
      }
    })
  } catch (e) {
    return fail(5000, '验证码生成失败')
  }
  const svg = renderCaptchaSvg(text)
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
  return ok({ captchaId: id, svg: dataUrl, expireAt: ts + CAPTCHA_TTL_MS })
}

async function consumeCaptcha(captchaId, captchaCode) {
  if (!captchaId || !captchaCode) return false
  try {
    const res = await db.collection(CAPTCHA_COLLECTION).doc(captchaId).get()
    const rec = res?.data
    if (!rec || rec.used) return false
    if (Number(rec.expireAt || 0) < now()) return false
    const expected = String(rec.text || '').toUpperCase()
    const got = String(captchaCode || '').trim().toUpperCase()
    const match = expected === got
    try {
      await db.collection(CAPTCHA_COLLECTION).doc(captchaId).update({
        data: { used: true, consumedAt: now() }
      })
    } catch (e) {}
    return match
  } catch (e) {
    return false
  }
}

function buildLoginRateKey(scope, value) {
  return `login:${scope}:${sha256(String(value || '').toLowerCase()).slice(0, 32)}`
}

async function getLoginRateRecord(key) {
  try {
    const res = await db.collection(LOGIN_RATE_COLLECTION).doc(key).get()
    return res?.data || null
  } catch (e) {
    return null
  }
}

async function setLoginRateRecord(key, data) {
  const payload = { ...data, updatedAt: now() }
  try {
    await db.collection(LOGIN_RATE_COLLECTION).doc(key).update({ data: payload })
  } catch (e) {
    try {
      await db.collection(LOGIN_RATE_COLLECTION).doc(key).set({ data: payload })
    } catch (e2) {}
  }
}

async function clearLoginRateRecord(key) {
  try {
    await db.collection(LOGIN_RATE_COLLECTION).doc(key).update({
      data: { failCount: 0, firstFailAt: 0, lockedUntil: 0, updatedAt: now() }
    })
  } catch (e) {}
}

async function checkLoginLocked(keys) {
  const ts = now()
  for (const key of keys) {
    const rec = await getLoginRateRecord(key)
    if (rec && Number(rec.lockedUntil || 0) > ts) {
      return Math.ceil((Number(rec.lockedUntil) - ts) / 1000)
    }
  }
  return 0
}

async function recordLoginFailure(keys) {
  const ts = now()
  for (const key of keys) {
    const rec = (await getLoginRateRecord(key)) || {}
    const firstFailAt = Number(rec.firstFailAt || 0)
    const inWindow = firstFailAt && ts - firstFailAt < LOGIN_FAIL_WINDOW_MS
    const failCount = (inWindow ? Number(rec.failCount || 0) : 0) + 1
    const next = {
      failCount,
      firstFailAt: inWindow ? firstFailAt : ts,
      lockedUntil: failCount >= LOGIN_FAIL_THRESHOLD ? ts + LOGIN_LOCK_MS : 0
    }
    await setLoginRateRecord(key, next)
  }
}

async function recordLoginSuccess(keys) {
  await Promise.all(keys.map((key) => clearLoginRateRecord(key)))
}

function pickClientIp(headers = {}) {
  const raw = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-IP'] || ''
  return String(raw).split(',')[0].trim() || 'unknown'
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const content = { ...payload, iat: now(), exp: now() + TOKEN_TTL_MS }
  const body = Buffer.from(JSON.stringify(content)).toString('base64url')
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

function parseToken(token) {
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    const [header, body, signature] = parts
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${body}`).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!data || !data.exp || data.exp < now()) return null
    return data
  } catch (e) {
    return null
  }
}

async function requireAuth(headers = {}) {
  const authHeader = headers.Authorization || headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const parsed = parseToken(token)
  if (!parsed || !parsed.id) return null

  const userRes = await db.collection(COLLECTIONS.USERS).doc(parsed.id).get().catch(() => null)
  const user = userRes?.data || null
  if (!user || user.status !== 'active') return null

  const tokenVersion = Number(user.tokenVersion || 0)
  if (Number(parsed.tokenVersion || 0) !== tokenVersion) return null

  const pwdUpdatedAt = Number(user.pwdUpdatedAt || 0)
  if (Number(parsed.pwdUpdatedAt || 0) !== pwdUpdatedAt) return null

  return {
    id: user._id,
    username: user.username,
    role: user.role || 'viewer',
    permissions: user.permissions || [],
    tokenVersion,
    pwdUpdatedAt
  }
}

function roleRank(role) {
  const map = { viewer: 1, reviewer: 2, editor: 3, super_admin: 4 }
  return map[role] || 0
}

function mustRole(user, minRole) {
  return roleRank(user?.role) >= roleRank(minRole)
}

const PERMISSION_MODULES = {
  dashboard: '仪表盘',
  news_events: 'Events管理',
  news_articles: 'Articles管理',
  road_closure: '封路通知',
  spacex_stats: 'SpaceX发射统计',
  starship_status: '星舰状态',
  starship_progress: '星舰建设进度',
  starship_events: '事件更新追踪',
  inspiration_feed: '灵感流照片集',
  shop_feed: '小店数据',
  carousel: '轮播图管理',
  splash_screen: '开屏动画',
  cos_storage: 'COS云存储',
  users: '用户权限',
  logs: '操作日志',
  push_notify: '推送通知管理',
  launch_data: '发射数据管理',
  tweet_monitor: '推文同步监控',
  statistics: '数据统计分析',
  live_mgmt: '直播管理',
  cloud_functions: '云函数管理',
  global_config: '全局配置中心',
  announcements: '系统公告',
  data_export: '数据导出',
  lunar_wishes: '月愿计划管理',
  milestone_rewards: '里程碑彩蛋管理',
  knowledge_cards: '知识卡管理'
}

function hasPermission(user, mod) {
  if (!user) return false
  if (user.role === 'super_admin') return true
  const perms = user.permissions || []
  return perms.includes(mod)
}

function checkPerm(user, mod) {
  if (!hasPermission(user, mod)) return fail(4030, '无权限访问该模块')
  return null
}

const { AsyncClient, LogItem, LogGroup, Content, PutLogsRequest } = require('tencentcloud-cls-sdk-js')

let _clsClient = null
function getClsClient() {
  if (_clsClient) return _clsClient
  const topicId = process.env.CLS_TOPIC_ID
  const secretId = process.env.CLS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID
  const secretKey = process.env.CLS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY
  if (!topicId || !secretId || !secretKey) return null
  try {
    _clsClient = new AsyncClient({
      endpoint: process.env.CLS_ENDPOINT || 'ap-guangzhou.cls.tencentcs.com',
      sourceIp: '0.0.0.0',
      secretId,
      secretKey,
      retry_times: 1
    })
  } catch (e) {
    console.error('[CLS] client init failed:', e.message)
    return null
  }
  return _clsClient
}

async function writeOpLog({ user, module, action, targetId = '', before = null, after = null, detail = null }) {
  const logData = {
    operatorId: user?.id || 'unknown',
    operatorName: user?.username || 'unknown',
    module,
    action,
    targetId,
    before,
    after,
    detail,
    createdAt: now()
  }

  // 1) 写数据库集合 operation_logs（前端表格读这里，强保证）
  try {
    await db.collection(COLLECTIONS.LOGS).add({
      data: { ...logData, _isDeleted: false }
    })
  } catch (e) {
    console.error('[opLog] db write error:', e.message || e)
  }

  // 2) 同时写 CLS（保留高级检索能力，best-effort，不 await）
  try {
    const clsClient = getClsClient()
    if (clsClient) {
      writeLogToCLS(clsClient, logData).catch((e) => console.error('[CLS] write error:', e.message || e))
    }
  } catch (e) {
    console.error('[CLS] init error:', e.message || e)
  }
}

async function writeLogToCLS(client, logData) {
  const logItem = new LogItem()
  logItem.setTime(Math.floor(Date.now() / 1000))
  for (const [k, v] of Object.entries(logData)) {
    logItem.pushBack(new Content(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')))
  }

  const logGroup = new LogGroup()
  logGroup.addLogs(logItem)

  const request = new PutLogsRequest(process.env.CLS_TOPIC_ID, logGroup)

  try {
    const data = await client.PutLogs(request)
    return data
  } catch (e) {
    console.error('[CLS] upload failed:', e.message || e)
    throw e
  }
}

function pick(obj = {}, keys = []) {
  const out = {}
  keys.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  })
  return out
}

async function verifyPassword(user, plain) {
  const password = String(plain || '')
  if (!user || !password) return false

  if (user.passwordHash && /^\$2[aby]\$/.test(user.passwordHash)) {
    return getBcrypt().compareSync(password, user.passwordHash)
  }

  if (user.passwordHash && user.passwordHash === sha256(password)) {
    const newHash = getBcrypt().hashSync(password, 10)
    await db.collection(COLLECTIONS.USERS).doc(user._id).update({
      data: { passwordHash: newHash, pwdUpdatedAt: now(), updatedAt: now() }
    })
    return true
  }

  return false
}

async function login(body, ctx = {}) {
  const username = (body?.username || '').trim()
  const password = String(body?.password || '')
  const captchaId = String(body?.captchaId || '')
  const captchaCode = String(body?.captchaCode || '')
  const clientIp = ctx.clientIp || 'unknown'

  if (!username || !password) return fail(4001, '用户名或密码不能为空')
  if (!captchaId || !captchaCode) return fail(4003, '请输入验证码')

  const captchaOk = await consumeCaptcha(captchaId, captchaCode)
  if (!captchaOk) {
    return fail(4004, '验证码错误或已过期')
  }

  const rateKeys = [
    buildLoginRateKey('ip', clientIp),
    buildLoginRateKey('user', username)
  ]

  const lockedFor = await checkLoginLocked(rateKeys)
  if (lockedFor > 0) {
    await writeOpLog({
      user: { id: 'anonymous', username },
      module: 'auth',
      action: 'login_blocked',
      targetId: username,
      detail: { reason: 'rate_limited', clientIp, retryAfterSec: lockedFor }
    }).catch(() => {})
    return fail(4029, `登录尝试过多，请 ${Math.ceil(lockedFor / 60)} 分钟后再试`)
  }

  const userRes = await db.collection(COLLECTIONS.USERS).where({ username, status: 'active' }).limit(1).get()
  const user = userRes.data?.[0]

  const pass = await verifyPassword(user, password)
  if (!user || !pass) {
    await recordLoginFailure(rateKeys)
    await writeOpLog({
      user: { id: user?._id || 'anonymous', username },
      module: 'auth',
      action: 'login_failed',
      targetId: username,
      detail: { reason: user ? 'bad_password' : 'unknown_user', clientIp }
    }).catch(() => {})
    return fail(4002, '用户名或密码错误')
  }

  const tokenVersion = Number(user.tokenVersion || 0)
  const pwdUpdatedAt = Number(user.pwdUpdatedAt || 0)
  const token = createToken({
    id: user._id,
    username: user.username,
    role: user.role || 'viewer',
    tokenVersion,
    pwdUpdatedAt
  })

  await db.collection(COLLECTIONS.USERS).doc(user._id).update({
    data: { lastLoginAt: now(), updatedAt: now() }
  })

  await recordLoginSuccess(rateKeys)
  await writeOpLog({
    user: { id: user._id, username: user.username },
    module: 'auth',
    action: 'login_success',
    targetId: user._id,
    detail: { clientIp }
  }).catch(() => {})

  return ok({ token, user: { id: user._id, username: user.username, role: user.role || 'viewer', permissions: user.permissions || [] } })
}

async function safeCount(collection) {
  try {
    const res = await db.collection(collection).count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

async function getDashboardOverview() {
  const [events, articles, carousel, mediaFeed, shopFeed, mediaAssets, spaceDevsCache, roadClosure, starshipEventUpdates, recentEvents, logs, cosFileCount, splashConfig] = await Promise.all([
    safeCount(COLLECTIONS.EVENTS),
    safeCount(COLLECTIONS.ARTICLES),
    (async () => { try { const r = await db.collection(COLLECTIONS.MEDIA_ASSETS).where({ key: db.RegExp({ regexp: '^首页轮播图/', options: 'i' }) }).count(); return r.total || 0 } catch (e) { return 0 } })(),
    safeCount(COLLECTIONS.MEDIA_FEED),
    safeCount(COLLECTIONS.SHOP_FEED),
    safeCount(COLLECTIONS.MEDIA_ASSETS),
    safeCount('space_devs_cache'),
    safeCount(COLLECTIONS.ROAD_CLOSURE),
    safeCount(COLLECTIONS.STARSHIP_EVENT_UPDATES),
    (async () => { try { return await db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES).orderBy('publishedAt', 'desc').limit(5).get() } catch (e) { return { data: [] } } })(),
    (async () => { try { return await db.collection(COLLECTIONS.LOGS).orderBy('createdAt', 'desc').limit(10).get() } catch (e) { return { data: [] } } })(),
    (async () => {
      try {
        const cos = createCOSClient()
        const data = await new Promise((resolve, reject) => {
          cos.getBucket({ Bucket: COS_BUCKET, Region: COS_REGION, MaxKeys: 1000, Delimiter: '' }, (err, d) => err ? resolve({ Contents: [] }) : resolve(d))
        })
        const count = (data.Contents || []).filter(c => c.Key && !c.Key.endsWith('/')).length
        return data.IsTruncated ? count + '+' : count
      } catch (e) { return 0 }
    })(),
    (async () => {
      try {
        const r = await db.collection(COLLECTIONS.STARSHIP_SPLASH).limit(1).get()
        const doc = r.data && r.data[0] ? r.data[0] : null
        return doc ? { enabled: !!doc.enabled, countdownSeconds: doc.countdownSeconds || 5 } : { enabled: false, countdownSeconds: 0 }
      } catch (e) { return { enabled: false, countdownSeconds: 0 } }
    })()
  ])

  return ok({
    contentStats: {
      events,
      articles,
      carousel,
      mediaFeed,
      shopFeed,
      mediaAssets,
      spaceDevsCache,
      roadClosure,
      starshipEventUpdates,
      cosFileCount,
      splashEnabled: splashConfig.enabled,
      splashCountdown: splashConfig.countdownSeconds
    },
    recentEvents: recentEvents.data || [],
    recentLogs: logs.data || []
  })
}

async function listNews(collection, query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const keyword = (query.keyword || '').trim()
  const published = query.published

  let where = {}
  if (published === 'true') where.published = true
  if (published === 'false') where.published = false

  let dbQuery = db.collection(collection).where(where)
  if (keyword) {
    dbQuery = db.collection(collection).where(
      _.or([
        { title: db.RegExp({ regexp: keyword, options: 'i' }) },
        { summary: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])
    )
  }

  const [countRes, listRes] = await Promise.all([
    dbQuery.count(),
    dbQuery.orderBy('publishedAt', 'desc').orderBy('updatedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  ])

  return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
}

async function createNews(collection, body, user) {
  const payload = {
    title: body.title || '',
    summary: body.summary || '',
    date: body.date || body.publishedAt || '',
    publishedAt: body.publishedAt || body.date || '',
    image: body.image || '',
    url: body.url || '',
    published: !!body.published,
    weight: Number(body.weight || 0),
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.username,
    updatedBy: user.username
  }
  if (collection === COLLECTIONS.ARTICLES) {
    payload.newsSite = body.newsSite || ''
    payload.author = body.author || ''
    payload.content = body.content || ''
    const imgs = Array.isArray(body.images) ? body.images.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 5) : []
    payload.images = imgs
    if (!payload.image && imgs.length) payload.image = imgs[0]
  }
  if (payload.published && !payload.publishedAt) {
    payload.publishedAt = now()
    if (!payload.date) payload.date = new Date(payload.publishedAt).toISOString()
  }

  const res = await db.collection(collection).add({ data: payload })
  await writeOpLog({ user, module: collection, action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function updateNews(collection, id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(collection).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const keys = ['title', 'summary', 'date', 'publishedAt', 'image', 'url', 'published', 'weight']
  if (collection === COLLECTIONS.ARTICLES) keys.push('newsSite', 'author', 'content', 'images')
  const patch = pick(body, keys)
  patch.updatedAt = now()
  patch.updatedBy = user.username

  if (collection === COLLECTIONS.ARTICLES && Object.prototype.hasOwnProperty.call(patch, 'images')) {
    patch.images = Array.isArray(patch.images)
      ? patch.images.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 5)
      : []
    if ((!patch.image || patch.image === '') && patch.images.length) patch.image = patch.images[0]
  }

  const willPublish = Object.prototype.hasOwnProperty.call(patch, 'published')
    ? patch.published === true
    : before.published === true
  if (willPublish) {
    const nextPa = (patch.publishedAt != null && patch.publishedAt !== '')
      ? patch.publishedAt
      : (before.publishedAt || before.date || patch.date || '')
    if (!nextPa) {
      patch.publishedAt = now()
      if (!patch.date && !before.date) patch.date = new Date(patch.publishedAt).toISOString()
    }
  }

  await ref.update({ data: patch })
  await writeOpLog({ user, module: collection, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function deleteNews(collection, id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(collection).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: collection, action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

async function listStarshipEvents(query = {}) {
  const col = COLLECTIONS.STARSHIP_EVENT_UPDATES
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const status = (query.status || '').trim()
  const biliStatus = (query.bilibiliSyncStatus || '').trim()

  let where = {}
  if (status) where.status = status
  if (biliStatus && biliStatus !== 'idle') {
    where.bilibiliSyncStatus = biliStatus
  }

  const dbQuery = db.collection(col).where(where)
  const [countRes, listRes] = await Promise.all([
    dbQuery.count(),
    dbQuery.orderBy('publishedAt', 'desc').orderBy('updatedAt', 'desc')
      .skip((page - 1) * pageSize).limit(pageSize).get()
  ])

  let list = listRes.data || []
  let total = countRes.total
  if (biliStatus === 'idle') {
    list = list.filter((row) => {
      const st = row.bilibiliSyncStatus
      return !st || st === 'idle'
    })
    // 粗略：idle 筛选在当前页过滤；精确分页成本高，后台够用
    total = list.length
  }

  return ok({ list, total, page, pageSize })
}

async function triggerBilibiliEnqueue(from) {
  try {
    const res = await cloud.callFunction({
      name: 'publishBilibiliFromEvents',
      data: { from, action: 'auto_enqueue' }
    })
    const payload = (res && res.result) || res || {}
    console.log('[triggerBilibiliEnqueue]', from, JSON.stringify(payload))
    return payload
  } catch (e) {
    console.warn('[triggerBilibiliEnqueue] failed', from, e.message || e)
    return { ok: false, error: e.message || String(e) }
  }
}

async function createStarshipEvent(body, user) {
  const col = COLLECTIONS.STARSHIP_EVENT_UPDATES
  const isPublished = body.status === 'published'
  let mediaList = Array.isArray(body.mediaList) ? body.mediaList : []
  try {
    mediaList = await ensureEventMediaListPreviews(mediaList)
  } catch (e) {
    console.warn('[Admin] ensure event video preview on create failed:', e.message || e)
  }
  const payload = {
    title: body.title || '',
    content: body.content || '',
    mediaList,
    liveRoomId: body.liveRoomId || '',
    livePlatform: body.livePlatform || '',
    liveCover: body.liveCover || '',
    status: isPublished ? 'published' : 'draft',
    author: user.username,
    publishedAt: isPublished ? now() : 0,
    createdAt: now(),
    updatedAt: now(),
    bilibiliSyncStatus: 'idle'
  }

  const res = await db.collection(col).add({ data: payload })
  await writeOpLog({ user, module: col, action: 'create', targetId: res._id, after: payload })
  let bilibiliEnqueue = null
  if (isPublished) {
    bilibiliEnqueue = await triggerBilibiliEnqueue('event_create')
  }
  return ok({ id: res._id, bilibiliEnqueue })
}

async function updateStarshipEvent(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const col = COLLECTIONS.STARSHIP_EVENT_UPDATES
  const ref = db.collection(col).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = pick(body, ['title', 'content', 'mediaList', 'status', 'liveRoomId', 'livePlatform', 'liveCover'])
  patch.updatedAt = now()
  patch.updatedBy = user.username

  if (patch.status === 'published' && before.status !== 'published') {
    patch.publishedAt = now()
  }

  if (Array.isArray(patch.mediaList)) {
    try {
      patch.mediaList = await ensureEventMediaListPreviews(patch.mediaList)
    } catch (e) {
      console.warn('[Admin] ensure event video preview on update failed:', e.message || e)
    }
  }

  await ref.update({ data: patch })
  await writeOpLog({ user, module: col, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  const becamePublished = patch.status === 'published' && before.status !== 'published'
  let bilibiliEnqueue = null
  // 仅「首次发布」触发入队，避免每次编辑已发布事件都扫库
  if (becamePublished) {
    bilibiliEnqueue = await triggerBilibiliEnqueue('event_update')
  }
  return ok({ bilibiliEnqueue })
}

function eventMediaCosKeyFromUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (!url.startsWith(COS_BASE_URL)) return ''
  try {
    return decodeURI(url.slice(COS_BASE_URL.length).split('?')[0])
  } catch (e) {
    return ''
  }
}

function eventMediaPreviewKey(sourceKey) {
  const parts = String(sourceKey || '').split('/')
  const file = parts.pop() || `video_${Date.now()}.mp4`
  const folder = parts.join('/')
  const name = file.replace(/\.(mp4|mov|webm)$/i, '') + '_fast.mp4'
  return folder ? `${folder}/preview/${name}` : `preview/${name}`
}

function eventMediaEscapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function eventMediaHeadExists(cos, key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) => resolve(!err))
  })
}

function submitEventMediaPreviewJob(cos, inputKey, outputKey) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Tag>Transcode</Tag>
  <Input><Object>${eventMediaEscapeXml(inputKey)}</Object></Input>
  <Operation>
    <Transcode>
      <Container><Format>mp4</Format></Container>
      <Video>
        <Codec>H.264</Codec>
        <Profile>main</Profile>
        <Bitrate>800</Bitrate>
        <Width>720</Width>
        <Fps>24</Fps>
        <Preset>medium</Preset>
      </Video>
      <Audio>
        <Codec>aac</Codec>
        <Bitrate>64</Bitrate>
        <Channels>2</Channels>
        <Samplerate>44100</Samplerate>
      </Audio>
      <TransConfig>
        <AdjDarMethod>scale</AdjDarMethod>
        <IsCheckReso>false</IsCheckReso>
        <ResoAdjMethod>1</ResoAdjMethod>
      </TransConfig>
    </Transcode>
    <Output>
      <Region>${COS_REGION}</Region>
      <Bucket>${COS_BUCKET}</Bucket>
      <Object>${eventMediaEscapeXml(outputKey)}</Object>
    </Output>
  </Operation>
  <CallBackFormat>JSON</CallBackFormat>
</Request>`

  return new Promise((resolve, reject) => {
    cos.request({
      Method: 'POST',
      Url: `https://${COS_BUCKET}.ci.${COS_REGION}.myqcloud.com/jobs`,
      Headers: { 'Content-Type': 'application/xml' },
      Body: body
    }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

/** 管理后台保存事件时：为 COS 视频补 thumbnail + previewUrl */
async function ensureEventMediaListPreviews(mediaList) {
  const list = Array.isArray(mediaList) ? mediaList : []
  if (!list.length) return list
  const cos = createCOSClient()
  const out = []
  for (const m of list) {
    if (!m || m.type !== 'video' || m.isLongVideo) {
      out.push(m)
      continue
    }
    const url = m.url || ''
    const key = eventMediaCosKeyFromUrl(url)
    if (!key || !/\.(mp4|mov|webm)$/i.test(key)) {
      out.push(m)
      continue
    }
    const next = { ...m }
    if (!next.thumbnailUrl) {
      next.thumbnailUrl = `${COS_BASE_URL.replace(/\/$/, '')}/${encodeURI(key)}?ci-process=snapshot&time=1&format=jpg&width=640&height=0`
    }
    if (next.previewUrl && String(next.previewUrl).trim()) {
      out.push(next)
      continue
    }
    const previewKey = eventMediaPreviewKey(key)
    const previewUrl = `${COS_BASE_URL.replace(/\/$/, '')}/${encodeURI(previewKey)}`
    try {
      if (await eventMediaHeadExists(cos, previewKey)) {
        next.previewUrl = previewUrl
      } else {
        await submitEventMediaPreviewJob(cos, key, previewKey)
        next.previewUrl = previewUrl
        console.log('[Admin] event video preview job:', key, '->', previewKey)
      }
    } catch (e) {
      console.warn('[Admin] event video preview failed:', e.message || e)
      next.previewUrl = url
    }
    out.push(next)
  }
  return out
}

async function deleteEventCOSFiles(mediaList) {
  const cos = createCOSClient()
  let removed = 0
  for (const media of (mediaList || [])) {
    for (const field of ['url', 'thumbnailUrl', 'previewUrl']) {
      const val = media[field] || ''
      if (val.startsWith(COS_BASE_URL)) {
        const key = decodeURI(val.slice(COS_BASE_URL.length).split('?')[0])
        try {
          await new Promise((resolve, reject) => {
            cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err, data) => err ? reject(err) : resolve(data))
          })
          removed++
        } catch (e) {
          console.warn(`[Admin] COS 删除失败 ${key}: ${e.message}`)
        }
      }
    }
  }
  return removed
}

async function deleteStarshipEvent(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const col = COLLECTIONS.STARSHIP_EVENT_UPDATES
  const ref = db.collection(col).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await deleteEventCOSFiles(before.mediaList)
  await ref.remove()
  await writeOpLog({ user, module: col, action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

// ========== 关于我们配置 ==========
async function getAboutConfig() {
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).where({ _id: 'main' }).limit(1).get()
    const data = res.data && res.data[0]
    return ok({ aboutText: (data && data.aboutText) || '', aboutWechat: (data && data.aboutWechat) || '' })
  } catch (e) {
    return ok({ aboutText: '', aboutWechat: '' })
  }
}

async function updateAboutConfig(body, user) {
  const { aboutText, aboutWechat } = body || {}
  const data = { aboutText: aboutText || '', aboutWechat: aboutWechat || '', updatedAt: now() }
  try {
    await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(ABOUT_CONFIG_ID).set({ data })
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }
  return ok(data)
}

// ── 太空简报开关 ──
const BRIEFING_CONFIG_ID = 'briefing_config'

// ── 视频号直播自定义封面（监控页 channels-live-panel） ──
const CHANNELS_LIVE_COVER_DOC_ID = 'cover_config'

const CHANNELS_LIVE_COVER_DEFAULT = {
  enabled: false,
  coverType: 'default',
  mediaUrl: '',
  previewUrl: '',
  posterUrl: '',
  previewStatus: '',
  previewJobAt: 0,
  previewError: '',
  title: '',
  linkMode: 'auto',
  showLiveBadge: true
}

const DB_SYSTEM_FIELDS = ['_id', '_openid']

function stripDbSystemFields(obj) {
  if (!obj || typeof obj !== 'object') return {}
  const out = { ...obj }
  DB_SYSTEM_FIELDS.forEach((k) => { delete out[k] })
  return out
}

function detectChannelsLiveCoverType(mediaUrl, coverType) {
  if (['default', 'image', 'video'].includes(coverType)) {
    if (coverType !== 'default') return coverType
  }
  const url = String(mediaUrl || '').trim()
  if (!url) return 'default'
  if (/\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(url)) return 'video'
  if (/\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(url)) return 'image'
  return coverType === 'default' ? 'image' : (coverType || 'image')
}

function liveCoverPreviewKey(sourceKey) {
  const base = String(sourceKey || '').split('/').pop() || `live_cover_${Date.now()}.mp4`
  const name = base.replace(/\.(mp4|mov|webm|m4v)$/i, '') + '_fast.mp4'
  return `直播观看/preview/${name}`
}

function normalizeChannelsLiveCover(raw) {
  const body = stripDbSystemFields((raw && typeof raw === 'object') ? raw : {})
  const mediaUrl = String(body.mediaUrl || '').trim()
  const coverType = detectChannelsLiveCoverType(mediaUrl, body.coverType)
  const linkMode = ['auto', 'custom', 'official'].includes(body.linkMode) ? body.linkMode : 'auto'
  return {
    enabled: !!body.enabled,
    coverType,
    mediaUrl,
    previewUrl: String(body.previewUrl || '').trim(),
    posterUrl: String(body.posterUrl || '').trim(),
    previewStatus: String(body.previewStatus || '').trim(),
    previewJobAt: Number(body.previewJobAt || 0) || 0,
    previewError: String(body.previewError || '').trim(),
    title: String(body.title || '').trim(),
    linkMode,
    showLiveBadge: body.showLiveBadge !== false,
    updatedAt: body.updatedAt || '',
    updatedBy: body.updatedBy || ''
  }
}

/** 直播观看封面视频：万象转码预览 + 首帧封面（复用开屏转码参数） */
async function ensureChannelsLiveCoverPreview(doc) {
  const normalized = normalizeChannelsLiveCover(doc)
  if (normalized.coverType !== 'video' || !normalized.mediaUrl) {
    return {
      ...normalized,
      previewUrl: '',
      previewStatus: '',
      previewError: '',
      previewJobAt: 0
    }
  }

  const sourceKey = splashCosKeyFromUrl(normalized.mediaUrl)
  if (!sourceKey) return normalized

  const cos = createCOSClient()
  const next = { ...normalized }
  const nowTs = now()
  if (!next.posterUrl) next.posterUrl = splashPosterUrl(sourceKey)

  const previewKey = liveCoverPreviewKey(sourceKey)
  const previewUrl = splashPublicUrl(previewKey)
  const previewExists = await splashHeadExists(cos, previewKey)
  if (previewExists) {
    next.previewUrl = previewUrl
    next.previewStatus = 'ready'
    next.previewError = ''
  } else {
    next.previewUrl = previewUrl
    const lastJob = Number(next.previewJobAt || 0)
    if (!lastJob || nowTs - lastJob > 10 * 60 * 1000) {
      try {
        await submitSplashPreviewJob(cos, sourceKey, previewKey)
        next.previewJobAt = nowTs
        next.previewStatus = 'processing'
        console.log('[channels-live-cover] preview job submitted:', sourceKey, '->', previewKey)
      } catch (e) {
        next.previewStatus = 'failed'
        next.previewError = String(e.message || e).slice(0, 200)
        next.previewUrl = ''
        console.warn('[channels-live-cover] preview job failed:', e.message || e)
      }
    } else if (!next.previewStatus) {
      next.previewStatus = 'processing'
    }
  }

  try {
    const ref = db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_COVER_DOC_ID)
    await ref.update({
      data: {
        previewUrl: next.previewUrl,
        posterUrl: next.posterUrl,
        previewStatus: next.previewStatus,
        previewJobAt: next.previewJobAt,
        previewError: next.previewError,
        updatedAt: nowTs
      }
    })
  } catch (e) {
    console.warn('[channels-live-cover] patch preview fields failed:', e.message || e)
  }
  return next
}

async function getChannelsLiveCoverConfig() {
  try {
    const res = await db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_COVER_DOC_ID).get()
    if (res && res.data) {
      let data = normalizeChannelsLiveCover({ ...CHANNELS_LIVE_COVER_DEFAULT, ...res.data })
      if (data.coverType === 'video' && data.mediaUrl) {
        try {
          data = await ensureChannelsLiveCoverPreview(data)
        } catch (e) {
          console.warn('[channels-live-cover] ensure on GET failed:', e.message || e)
        }
      }
      return ok(data)
    }
  } catch (e) {}
  return ok({ ...CHANNELS_LIVE_COVER_DEFAULT })
}

async function updateChannelsLiveCoverConfig(body, user) {
  const incoming = normalizeChannelsLiveCover(body)
  if (incoming.enabled && incoming.coverType !== 'default' && !incoming.mediaUrl) {
    return fail(4000, '启用自定义封面时请填写或上传 mediaUrl')
  }

  let prevMediaUrl = ''
  let prevPreview = {}
  try {
    const existing = await db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_COVER_DOC_ID).get()
    if (existing && existing.data) {
      prevMediaUrl = String(existing.data.mediaUrl || '').trim()
      prevPreview = {
        previewUrl: existing.data.previewUrl || '',
        posterUrl: existing.data.posterUrl || '',
        previewStatus: existing.data.previewStatus || '',
        previewJobAt: existing.data.previewJobAt || 0,
        previewError: existing.data.previewError || ''
      }
    }
  } catch (e) {}

  const mediaChanged = incoming.mediaUrl !== prevMediaUrl
  let data = {
    ...incoming,
    updatedAt: now(),
    updatedBy: (user && (user.username || user.account)) || ''
  }
  if (incoming.coverType === 'video' && incoming.mediaUrl) {
    if (!mediaChanged) {
      data.previewUrl = data.previewUrl || prevPreview.previewUrl || ''
      data.posterUrl = data.posterUrl || prevPreview.posterUrl || ''
      data.previewStatus = data.previewStatus || prevPreview.previewStatus || ''
      data.previewJobAt = data.previewJobAt || prevPreview.previewJobAt || 0
      data.previewError = data.previewError || prevPreview.previewError || ''
    } else {
      data.previewUrl = ''
      data.previewStatus = 'pending'
      data.previewJobAt = 0
      data.previewError = ''
      // 换源后旧海报/旧预览一律作废，由 ensure 重新截帧
      data.posterUrl = ''
    }
  } else {
    data.previewUrl = ''
    data.previewStatus = ''
    data.previewJobAt = 0
    data.previewError = ''
  }

  try {
    const ref = db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_COVER_DOC_ID)
    const existing = await ref.get().catch(() => null)
    if (existing && existing.data) {
      await ref.update({ data })
    } else {
      await ref.set({ data })
    }
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }

  if (data.coverType === 'video' && data.mediaUrl) {
    try {
      data = await ensureChannelsLiveCoverPreview(data)
    } catch (e) {
      console.warn('[channels-live-cover] ensure on PUT failed:', e.message || e)
    }
  }

  await writeOpLog({
    user,
    module: 'live_mgmt',
    action: 'channels_live_cover',
    targetId: CHANNELS_LIVE_COVER_DOC_ID,
    after: data
  })
  return ok(data)
}

// ── 自己未开播时：推荐第三方视频号主页引导（方案二） ──
const CHANNELS_LIVE_FALLBACK_DOC_ID = 'fallback_guide'

const CHANNELS_LIVE_FALLBACK_DEFAULT = {
  enabled: false,
  title: '推荐观看',
  nickname: '',
  qrUrl: '',
  tip: '扫码前往视频号主页，可预约或观看直播'
}

function normalizeChannelsLiveFallbackGuide(raw) {
  const body = stripDbSystemFields((raw && typeof raw === 'object') ? raw : {})
  return {
    enabled: !!body.enabled,
    title: String(body.title || CHANNELS_LIVE_FALLBACK_DEFAULT.title).trim() || CHANNELS_LIVE_FALLBACK_DEFAULT.title,
    nickname: String(body.nickname || '').trim(),
    qrUrl: String(body.qrUrl || '').trim(),
    tip: String(body.tip || CHANNELS_LIVE_FALLBACK_DEFAULT.tip).trim() || CHANNELS_LIVE_FALLBACK_DEFAULT.tip,
    updatedAt: body.updatedAt || '',
    updatedBy: body.updatedBy || ''
  }
}

function pickChannelsLiveFallbackDoc(res) {
  if (!res) return null
  let doc = res.data
  if (Array.isArray(doc)) doc = doc[0]
  if (!doc || typeof doc !== 'object') return null
  return doc
}

async function getChannelsLiveFallbackGuide() {
  try {
    const res = await db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_FALLBACK_DOC_ID).get()
    const doc = pickChannelsLiveFallbackDoc(res)
    if (doc) {
      // 不要用带旧二维码的 DEFAULT 覆盖云端空字段；只补齐缺省文案
      const merged = {
        title: CHANNELS_LIVE_FALLBACK_DEFAULT.title,
        tip: CHANNELS_LIVE_FALLBACK_DEFAULT.tip,
        ...doc
      }
      return ok(normalizeChannelsLiveFallbackGuide(merged))
    }
  } catch (e) {
    console.warn('[channels-live-fallback] GET failed:', e && e.message ? e.message : e)
  }
  return ok({ ...CHANNELS_LIVE_FALLBACK_DEFAULT })
}

async function updateChannelsLiveFallbackGuide(body, user) {
  const incoming = normalizeChannelsLiveFallbackGuide(body)
  if (incoming.enabled && !incoming.nickname) {
    return fail(4000, '启用推荐引导时请填写视频号名称')
  }
  if (incoming.enabled && !incoming.qrUrl) {
    return fail(4000, '启用推荐引导时请上传或填写视频号主页二维码')
  }
  const data = {
    enabled: !!incoming.enabled,
    title: incoming.title,
    nickname: incoming.nickname,
    qrUrl: incoming.qrUrl,
    tip: incoming.tip,
    updatedAt: now(),
    updatedBy: (user && (user.username || user.account)) || ''
  }
  try {
    const ref = db.collection(COLLECTIONS.CHANNELS_LIVE_CONFIG).doc(CHANNELS_LIVE_FALLBACK_DOC_ID)
    // 一律 set 整单覆盖，避免 update 合并残留旧 qrUrl
    await ref.set({ data })
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }
  await writeOpLog({
    user,
    module: 'live_mgmt',
    action: 'channels_live_fallback_guide',
    targetId: CHANNELS_LIVE_FALLBACK_DOC_ID,
    after: data
  })
  return ok(data)
}

// ── 太空轨道数据中心系统配置 ──
const ORBITAL_CONFIG_ID = 'orbital_data_center_config'

const ORBITAL_DEFAULT = {
  // 监控页卡片配置
  card: {
    enabled: true,
    badge: 'FUTURE TECH · BETA',
    version: 'v0.1.0',
    titleEn: 'Orbital Data Center System',
    titleCn: '太空轨道数据中心系统',
    desc: '超前部署 · 应对 SpaceX 下一代轨道战略',
    bgImage: '',
    ctaText: '进入指挥控制台',
    metrics: {
      activeNodes: '128',
      bandwidth: '4.8 Tbps',
      uptime: '99.97%'
    }
  },
  // 详情页配置
  detail: {
    /** 详情页全屏背景视频（mp4 HTTPS 地址，空则用小程序内置默认素材） */
    bgVideo: '',
    hudTitle: 'SYS-ODC // CONSOLE',
    hudSub: 'v0.1.0 · UNCLASSIFIED',
    statusText: 'ONLINE',
    tickerLines: [
      '> SYS_INIT // 接入 SpaceX Starlink V2 镜像网关',
      '> CHANNEL_LOCK // 已锁定 K-band 下行链路',
      '> ENCRYPTION // AES-256-GCM // 0xA47F...',
      '> AUTHORITY // FCC-2026 / ITU-R S.1428',
      '> NEXT_PASS // 00:14:32 OVER STARBASE TX',
      '> READY // 等待指令'
    ],
    coreMetrics: [
      { label: 'ACTIVE NODES', value: '128',   unit: 'satellites', percent: 78,    trend: 'up',   delta: '+12' },
      { label: 'BANDWIDTH',    value: '4.8',   unit: 'Tbps',       percent: 64,    trend: 'up',   delta: '+0.6' },
      { label: 'PACKET LOSS',  value: '0.012', unit: '%',          percent: 8,     trend: 'down', delta: '-0.004' },
      { label: 'SYS UPTIME',   value: '99.97', unit: '%',          percent: 99.97, trend: 'flat', delta: '0.00' },
      { label: 'GROUND LINK',  value: '36',    unit: 'stations',   percent: 72,    trend: 'up',   delta: '+2' },
      { label: 'POWER DRAW',   value: '1.42',  unit: 'MW',         percent: 56,    trend: 'flat', delta: '~' }
    ],
    nodeList: [
      { code: 'STARLINK-V2 #4421', type: 'LEO RELAY',      orbit: '550 km · 53°',  uplink: '92.4 Gbps', latency: '18 ms', status: 'online',  statusText: 'NOMINAL' },
      { code: 'STARSHIELD-K07',    type: 'GOV PAYLOAD',    orbit: '600 km · 70°',  uplink: '46.1 Gbps', latency: '21 ms', status: 'online',  statusText: 'CLASSIFIED LINK' },
      { code: 'GATEWAY GW-LA-12',  type: 'GROUND ANCHOR',  orbit: 'CA / 33.94°N',  uplink: '1.2 Tbps',  latency: '3 ms',  status: 'online',  statusText: 'GROUND-PRIME' },
      { code: 'STARLINK-V2 #5067', type: 'LEO RELAY',      orbit: '550 km · 53°',  uplink: '88.0 Gbps', latency: '17 ms', status: 'warn',    statusText: 'PARTIAL OUTAGE' },
      { code: 'INTERSAT-LASER 7',  type: 'INTER-SAT XLINK',orbit: '550 km · 97°',  uplink: '120 Gbps',  latency: '4 ms',  status: 'online',  statusText: 'OPTICAL LOCKED' },
      { code: 'NODE OFFLINE-244',  type: 'LEO RELAY',      orbit: '—',             uplink: '—',         latency: '—',     status: 'offline', statusText: 'DEORBIT QUEUE' }
    ],
    missionList: [
      { title: 'Phase 0 · 系统启动',          date: '2026 Q1', status: 'done',     statusText: 'COMPLETED',   desc: '完成 ODC 控制台原型与遥测协议草案。' },
      { title: 'Phase I · 全球地面网格接入',   date: '2026 Q2', status: 'active',   statusText: 'IN PROGRESS', desc: '对接全球 36 处 Starlink 网关地面站，建立第一批镜像节点。' },
      { title: 'Phase II · Starshield 数据合规', date: '2026 Q3', status: 'pending',  statusText: 'QUEUED',      desc: '部署可信执行环境（TEE），承载政府订阅业务的隔离数据流。' },
      { title: 'Phase III · 千万节点级聚合',   date: '2027',    status: 'pending',  statusText: 'PLANNED',     desc: '迎接 V3 Starlink 与 Starship 月度发射后激增的节点规模。' },
      { title: 'Phase IV · 月地中继扩展',      date: '2028',    status: 'forecast', statusText: 'FORECAST',    desc: '与 Artemis 计划及 Lunar Gateway 对接，迈出地月通信骨干网第一步。' }
    ],
    briefLines: [
      '本系统为「火星探索日志」对未来轨道经济与星链巨型星座下一代基础设施的预研产物。',
      '在 SpaceX 完成 V2 Starlink 全球部署、Starship 月度高频发射、以及 Starshield 国防订阅服务正式上线后，地面侧需要建立专门的轨道数据中心来对接、调度、聚合千万节点级别的实时遥测。',
      '// ODC 是这一愿景的早期蓝图。'
    ]
  }
}

async function getOrbitalConfig() {
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(ORBITAL_CONFIG_ID).get().catch(() => null)
    if (res && res.data) {
      const row = res.data
      return ok({
        ...ORBITAL_DEFAULT,
        ...row,
        card: {
          ...ORBITAL_DEFAULT.card,
          ...(row.card || {}),
          metrics: { ...ORBITAL_DEFAULT.card.metrics, ...((row.card && row.card.metrics) || {}) }
        },
        detail: { ...ORBITAL_DEFAULT.detail, ...(row.detail || {}) }
      })
    }
  } catch (e) {}
  return ok(ORBITAL_DEFAULT)
}

async function updateOrbitalConfig(body, user) {
  const incoming = (body && typeof body === 'object') ? body : {}
  const data = {
    card: { ...ORBITAL_DEFAULT.card, ...(incoming.card || {}), metrics: { ...ORBITAL_DEFAULT.card.metrics, ...((incoming.card && incoming.card.metrics) || {}) } },
    detail: {
      ...ORBITAL_DEFAULT.detail,
      ...(incoming.detail || {}),
      tickerLines:  Array.isArray(incoming.detail && incoming.detail.tickerLines)  ? incoming.detail.tickerLines  : ORBITAL_DEFAULT.detail.tickerLines,
      coreMetrics:  Array.isArray(incoming.detail && incoming.detail.coreMetrics)  ? incoming.detail.coreMetrics  : ORBITAL_DEFAULT.detail.coreMetrics,
      nodeList:     Array.isArray(incoming.detail && incoming.detail.nodeList)     ? incoming.detail.nodeList     : ORBITAL_DEFAULT.detail.nodeList,
      missionList:  Array.isArray(incoming.detail && incoming.detail.missionList)  ? incoming.detail.missionList  : ORBITAL_DEFAULT.detail.missionList,
      briefLines:   Array.isArray(incoming.detail && incoming.detail.briefLines)   ? incoming.detail.briefLines   : ORBITAL_DEFAULT.detail.briefLines
    },
    updatedAt: now(),
    updatedBy: (user && (user.username || user.account)) || ''
  }
  try {
    const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(ORBITAL_CONFIG_ID)
    const existing = await ref.get().catch(() => null)
    if (existing && existing.data) {
      await ref.update({ data })
    } else {
      await db.collection(COLLECTIONS.GLOBAL_CONFIG).add({ data: { _id: ORBITAL_CONFIG_ID, ...data } })
    }
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }
  return ok(data)
}

async function getBriefingConfig() {
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(BRIEFING_CONFIG_ID).get()
    const data = res.data || {}
    return ok({
      briefingEnabled: data.briefingEnabled !== false,
      updatedAt: data.updatedAt || ''
    })
  } catch (e) {
    return ok({ briefingEnabled: true, updatedAt: '' })
  }
}

async function updateBriefingConfig(body, user) {
  const enabled = body && body.briefingEnabled !== undefined ? !!body.briefingEnabled : true
  const data = { briefingEnabled: enabled, updatedAt: now() }
  try {
    const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(BRIEFING_CONFIG_ID)
    const existing = await ref.get().catch(() => null)
    if (existing && existing.data) {
      await ref.update({ data })
    } else {
      await db.collection(COLLECTIONS.GLOBAL_CONFIG).add({ data: { _id: BRIEFING_CONFIG_ID, ...data } })
    }
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }
  return ok(data)
}

// ── 新闻「航天事件」后台手写稿总开关（小程序读 global_config.news_manual_config） ──
const NEWS_MANUAL_CONFIG_ID = 'news_manual_config'

async function getNewsManualConfig() {
  let enabled = false
  let updatedAt = ''
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(NEWS_MANUAL_CONFIG_ID).get()
    const data = res.data || {}
    if (data.enabled === true) enabled = true
    updatedAt = data.updatedAt || ''
  } catch (e) {}

  try {
    const mainRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc('main').get()
    const md = mainRes.data || {}
    if (md.newsManualArticlesEnabled === true) enabled = true
    if (md.updatedAt && (!updatedAt || md.updatedAt > updatedAt)) updatedAt = md.updatedAt || updatedAt
  } catch (e) {}

  return ok({
    enabled,
    updatedAt
  })
}

async function updateNewsManualConfig(body, user) {
  const enabled = !!(body && body.enabled)
  const data = { enabled, updatedAt: now(), updatedBy: user.username }
  try {
    const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(NEWS_MANUAL_CONFIG_ID)
    const existing = await ref.get().catch(() => null)
    if (existing && existing.data) {
      await ref.update({ data })
    } else {
      await ref.set({ data })
    }
  } catch (e) {
    return fail(5000, '保存失败: ' + e.message)
  }
  // 许多环境中小程序仅允许读 global_config 的 main；把开关镜像到 main，避免客户端读不到独立文档导致永远不合并手写稿
  try {
    await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc('main').update({
      data: {
        newsManualArticlesEnabled: enabled,
        updatedAt: now()
      }
    })
  } catch (e) {
    console.warn('[news_manual_config] 同步到 main 失败（可能尚无 main 文档）:', e.message || e)
  }
  await writeOpLog({
    user,
    module: COLLECTIONS.GLOBAL_CONFIG,
    action: 'news_manual_config',
    targetId: NEWS_MANUAL_CONFIG_ID,
    after: data
  })
  return ok(data)
}

async function getRoadClosure() {
  const allRes = await db.collection(COLLECTIONS.ROAD_CLOSURE).orderBy('updatedAt', 'desc').limit(50).get()
  const list = allRes.data || []
  const manual = list.find(d => d._id === 'current') || null
  const autoSynced = list.filter(d => d._id !== 'current')
  return ok({ manual, autoSynced, all: list })
}

async function updateRoadClosure(body, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.ROAD_CLOSURE).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  const patch = {
    source: 'manual',
    isActive: !!body.isActive,
    message: body.message || '',
    timeRange: body.timeRange || '',
    priority: Number(body.priority || 0),
    startAt: Number(body.startAt || 0),
    endAt: Number(body.endAt || 0),
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.ROAD_CLOSURE, action: 'upsert', targetId: id, before, after: patch })
  return ok(true)
}

async function syncRoadClosureFromAPI(user) {
  try {
    // 跨云函数调用默认超时仅数秒，抓取 starbase.gov 需 10–30s，必须显式放宽
    const syncRes = await cloud.callFunction({
      name: 'syncSpaceDevsData',
      data: { action: 'syncRoadClosure' },
      config: { timeout: 60000 }
    })
    const payload = (syncRes && syncRes.result) || {}
    const roadResult = payload.roadClosure || payload
    try {
      await writeOpLog({
        user,
        module: COLLECTIONS.ROAD_CLOSURE,
        action: 'api_sync',
        targetId: 'syncRoadClosure',
        after: roadResult
      })
    } catch (logErr) {
      console.error('[road-closure] opLog failed:', logErr.message || logErr)
    }
    if (roadResult && roadResult.success === false) {
      return fail(5002, roadResult.message || '封路同步未完成', { result: roadResult })
    }
    return ok({ task: 'syncRoadClosure', result: roadResult })
  } catch (e) {
    const msg = e.message || String(e)
    const isTimeout = /timeout|timed out|TIMEOUT|ESOCKETTIMEDOUT|超时/i.test(msg)
    return fail(
      5001,
      isTimeout
        ? '同步超时：下游云函数未在时限内返回。请确认 adminGateway 与 syncSpaceDevsData 已部署且控制台超时 ≥60 秒，然后重试。'
        : '同步封路数据失败',
      {
        error: msg,
        hint: isTimeout
          ? 'ESOCKETTIMEDOUT 多为 syncSpaceDevsData 执行过慢或云函数超时配置不足（默认 20 秒）。手动同步已优先走 STARBASE_FETCH_PROXY 并跳过 SpaceDevs。'
          : undefined
      }
    )
  }
}

async function deleteRoadClosureItem(id, user) {
  if (!id || id === 'current') return fail(4001, '不可删除手动配置项，请使用编辑关闭')
  const ref = db.collection(COLLECTIONS.ROAD_CLOSURE).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')
  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.ROAD_CLOSURE, action: 'delete', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

// ===== SpaceX 发射统计 CRUD =====
async function getSpaceXStats() {
  const allRes = await db.collection(COLLECTIONS.SPACEX_STATS).orderBy('updatedAt', 'desc').limit(50).get()
  const list = allRes.data || []
  const manual = list.find(d => d._id === 'current') || null
  const autoSynced = list.filter(d => d._id !== 'current')
  return ok({ manual, autoSynced, all: list })
}

async function updateSpaceXStats(body, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.SPACEX_STATS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  const patch = {
    source: 'manual',
    isActive: !!body.isActive,
    totalLaunches: Number(body.totalLaunches || 0),
    totalLandings: Number(body.totalLandings || 0),
    totalReflights: Number(body.totalReflights || 0),
    message: body.message || '',
    priority: Number(body.priority || 0),
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.SPACEX_STATS, action: 'upsert', targetId: id, before, after: patch })
  return ok(true)
}

async function syncSpaceXStatsFromAPI(user) {
  try {
    const syncRes = await cloud.callFunction({ name: 'syncSpaceDevsData', data: { action: 'syncSpaceXStats' } })
    await writeOpLog({ user, module: COLLECTIONS.SPACEX_STATS, action: 'api_sync', targetId: 'syncSpaceXStats', after: syncRes.result || null })
    return ok({ task: 'syncSpaceXStats', result: syncRes.result || null })
  } catch (e) {
    return fail(5001, '同步SpaceX统计失败', { error: e.message || String(e) })
  }
}

async function syncAgenciesFromAPI(user) {
  try {
    const syncRes = await cloud.callFunction({ name: 'syncSpaceDevsData', data: { action: 'syncAgencies' } })
    await writeOpLog({ user, module: 'space_devs_cache', action: 'api_sync', targetId: 'syncAgencies', after: syncRes.result || null })
    return ok({ task: 'syncAgencies', result: syncRes.result || null })
  } catch (e) {
    return fail(5001, '同步发射商数据失败', { error: e.message || String(e) })
  }
}

async function deleteSpaceXStatsItem(id, user) {
  if (!id || id === 'current') return fail(4001, '不可删除手动配置项，请使用编辑关闭')
  const ref = db.collection(COLLECTIONS.SPACEX_STATS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')
  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.SPACEX_STATS, action: 'delete', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

/** NSF 抓取清单：合并快照与后台覆盖（管理端表格） */
function mergeNsfAdminRows(statuses, itemOverrides) {
  const ovRoot = itemOverrides && typeof itemOverrides === 'object' ? itemOverrides : {}
  const list = Array.isArray(statuses) ? statuses : []
  return list
    .map((raw, i) => {
      if (!raw || typeof raw !== 'object') return null
      const id = String(raw.id != null ? raw.id : `nsf_${i}`)
      const titleEn = String(raw.titleEn || raw.title || '').trim()
      const titleZhMachine = String(raw.titleZh || '').trim()
      const titleZhAuto = titleZhMachine || titleEn
      const ov = ovRoot[id] || {}
      const ovZh = typeof ov.titleZh === 'string' ? ov.titleZh.trim() : ''
      const titleZh = ovZh || titleZhAuto
      const doneWeb = raw.doneWeb !== undefined ? !!raw.doneWeb : !!raw.done
      let manualMode = 'follow'
      if (ov.manualDone === true) manualMode = 'force_true'
      else if (ov.manualDone === false) manualMode = 'force_false'
      const detailUrl = typeof raw.detailUrl === 'string' ? raw.detailUrl.trim() : ''
      const category = typeof raw.category === 'string' ? raw.category.trim() : ''
      if (!titleEn && !titleZhAuto) return null
      return {
        id,
        titleEn,
        titleZhAuto,
        titleZh,
        doneWeb,
        manualMode,
        detailUrl,
        category
      }
    })
    .filter(Boolean)
}

async function getNsfChecklistAdmin(user) {
  const deny = checkPerm(user, 'starship_status')
  if (deny) return deny

  let latest = {}
  try {
    const r = await db.collection('nextspaceflight_starship_cache').doc('latest').get()
    latest = r.data || {}
  } catch (e) {
    latest = {}
  }

  let adminDoc = {}
  try {
    const r = await db.collection('nextspaceflight_starship_cache').doc('admin_overrides').get()
    adminDoc = r.data || {}
  } catch (e) {
    adminDoc = {}
  }

  const statuses = Array.isArray(latest.statuses) ? latest.statuses : []
  const itemOverrides =
    adminDoc.itemOverrides && typeof adminDoc.itemOverrides === 'object' ? adminDoc.itemOverrides : {}

  const items = mergeNsfAdminRows(statuses, itemOverrides)

  return ok({
    sourceLastFetch: typeof latest.sourceLastFetch === 'string' ? latest.sourceLastFetch : '',
    updatedAtMs: typeof latest.updatedAtMs === 'number' ? latest.updatedAtMs : 0,
    fetchError: typeof latest.error === 'string' ? latest.error : '',
    parserMeta: latest.parserMeta && typeof latest.parserMeta === 'object' ? latest.parserMeta : null,
    overridesUpdatedAtMs: typeof adminDoc.updatedAtMs === 'number' ? adminDoc.updatedAtMs : 0,
    overridesUpdatedBy: typeof adminDoc.updatedBy === 'string' ? adminDoc.updatedBy : '',
    items
  })
}

async function updateNsfChecklistOverrides(body, user) {
  const deny = checkPerm(user, 'starship_status')
  if (deny) return deny

  const rows = Array.isArray(body.items) ? body.items : []
  const itemOverrides = {}

  for (const row of rows) {
    const id = String(row.id || '').trim()
    if (!id) continue
    const titleZhAuto = String(row.titleZhAuto || '').trim()
    const titleZh = String(row.titleZh || '').trim()
    const manualMode =
      row.manualMode === 'force_true' || row.manualMode === 'force_false' ? row.manualMode : 'follow'

    const o = {}
    if (titleZh && titleZh !== titleZhAuto) {
      o.titleZh = titleZh
    }
    if (manualMode === 'force_true') o.manualDone = true
    else if (manualMode === 'force_false') o.manualDone = false

    if (Object.keys(o).length) itemOverrides[id] = o
  }

  await db.collection('nextspaceflight_starship_cache').doc('admin_overrides').set({
    data: {
      itemOverrides,
      updatedAtMs: now(),
      updatedBy: user.username || ''
    }
  })

  await writeOpLog({
    user,
    module: 'nextspaceflight_starship_cache',
    action: 'update_nsf_overrides',
    targetId: 'admin_overrides',
    after: { keys: Object.keys(itemOverrides).length }
  })

  return ok({ saved: true })
}

async function getStarshipStatus() {
  const res = await db.collection(COLLECTIONS.STARSHIP).where({ _id: 'current' }).limit(1).get()
  return ok(res.data?.[0] || null)
}

async function updateStarshipStatus(body, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.STARSHIP).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  function normalizeFlightReadinessChecklist(raw, prevList = []) {
    const prev = Array.isArray(prevList) ? prevList : []
    if (raw === undefined || raw === null) return prev
    if (!Array.isArray(raw)) return prev
    return raw.map((item, i) => ({
      id: String(item.id || `fr_${i}`),
      title: String(item.title || '').trim(),
      done: !!item.done,
      detailUrl: typeof item.detailUrl === 'string' ? item.detailUrl.trim() : '',
      category: typeof item.category === 'string' ? item.category.trim() : ''
    })).filter((row) => row.title)
  }

  function normalizeNode(node = {}, prev = {}) {
    const newImage = node.image || prev.image || ''
    const imageChanged = node.image && node.image !== prev.image
    const nd = node.detail || {}
    const pd = prev.detail || {}
    const newHeroImage = nd.heroImage || pd.heroImage || ''
    const heroChanged = nd.heroImage && nd.heroImage !== pd.heroImage

    return {
      id: node.id || prev.id || '',
      name: node.name || prev.name || '',
      status: node.status || prev.status || 'ACTIVE',
      progress: Number(node.progress || 0),
      image: newImage,
      images: Array.isArray(node.images) ? node.images : (prev.images || []),
      previewImages: Array.isArray(node.previewImages) ? node.previewImages : (prev.previewImages || []),
      thumbnailMediaKey: imageChanged ? '' : (node.thumbnailMediaKey || prev.thumbnailMediaKey || ''),
      thumbnailFallback: imageChanged ? '' : (node.thumbnailFallback || prev.thumbnailFallback || ''),
      detail: {
        title: nd.title || pd.title || '',
        subtitle: nd.subtitle || pd.subtitle || '',
        statusText: nd.statusText || pd.statusText || '',
        summary: nd.summary || pd.summary || '',
        heroImage: newHeroImage,
        heroMediaKey: heroChanged ? '' : (nd.heroMediaKey || pd.heroMediaKey || ''),
        heroFallback: heroChanged ? '' : (nd.heroFallback || pd.heroFallback || ''),
        showChecklist: typeof nd.showChecklist === 'boolean' ? nd.showChecklist : (pd.showChecklist || false),
        checklist: Array.isArray(nd.checklist) ? nd.checklist : (pd.checklist || [])
      }
    }
  }

  function normalizeLl2LaunchTracking(body = {}, before = {}) {
    const prevId = typeof before.ll2TrackedLaunchId === 'string' ? before.ll2TrackedLaunchId.trim() : ''
    const prevShow = before.showLaunchLibraryUpdates !== false
    const rawId = body.ll2TrackedLaunchId
    const id = rawId === undefined || rawId === null
      ? prevId
      : String(rawId || '').trim()
    const show = typeof body.showLaunchLibraryUpdates === 'boolean'
      ? body.showLaunchLibraryUpdates
      : prevShow
    return { ll2TrackedLaunchId: id, showLaunchLibraryUpdates: show }
  }

  const patch = {
    booster: normalizeNode(body.booster, before?.booster),
    ship: normalizeNode(body.ship, before?.ship),
    flightReadinessChecklist: normalizeFlightReadinessChecklist(
      body.flightReadinessChecklist,
      before?.flightReadinessChecklist || []
    ),
    ...normalizeLl2LaunchTracking(body, before || {}),
    // NSF 自动跟进开关（默认开启）；set 全量覆盖，需显式保留云函数写入的 nsfAuto 元信息
    nsfAutoSync: typeof body.nsfAutoSync === 'boolean' ? body.nsfAutoSync : (before?.nsfAutoSync !== false),
    ...(before?.nsfAuto ? { nsfAuto: before.nsfAuto } : {}),
    updatedAt: now(),
    updatedBy: user.username
  }

  if (before) {
    const archiveItems = []
    for (const type of ['booster', 'ship']) {
      const oldList = before[type]?.detail?.checklist || []
      const newList = patch[type]?.detail?.checklist || []
      const changed = JSON.stringify(oldList) !== JSON.stringify(newList)
      if (changed && oldList.length > 0) {
        archiveItems.push({
          type,
          vehicleId: before[type]?.id || type,
          checklist: oldList,
          statusText: before[type]?.detail?.statusText || '',
          archivedAt: now(),
          archivedBy: user.username
        })
      }
    }
    for (const item of archiveItems) {
      await db.collection(COLLECTIONS.CHECKLIST_HISTORY).add({ data: item }).catch(() => {})
    }
  }

  await ref.set({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.STARSHIP, action: 'upsert', targetId: id, before, after: patch })
  return ok(true)
}

async function listChecklistHistory(query = {}) {
  const type = query.type || ''
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const where = type ? { type } : {}

  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.CHECKLIST_HISTORY).where(where).count(),
    db.collection(COLLECTIONS.CHECKLIST_HISTORY).where(where)
      .orderBy('archivedAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ])

  return ok({
    total: countRes.total || 0,
    page,
    pageSize,
    list: listRes.data || []
  })
}

async function deleteChecklistHistory(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.CHECKLIST_HISTORY).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '记录不存在')
  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.CHECKLIST_HISTORY, action: 'delete', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

async function getChecklistHistoryById(id) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.CHECKLIST_HISTORY).doc(id)
  const res = await ref.get().catch(() => null)
  if (!res?.data) return fail(4040, '记录不存在')
  return ok(res.data)
}

const SPLASH_MEDIA_MAX = 10

async function getStarshipSplashConfig() {
  const res = await db.collection(COLLECTIONS.STARSHIP_SPLASH).where({ _id: 'current' }).limit(1).get()
  let doc = res.data?.[0] || null
  if (!doc) return ok(null)
  doc = normalizeSplashDoc(doc)
  try {
    doc = await ensureSplashMediaItems(doc)
  } catch (e) {
    console.warn('[splash] ensure mediaItems on GET failed:', e.message || e)
  }
  return ok(doc)
}

function splashCosKeyFromUrl(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    const u = new URL(url.trim())
    const host = (u.hostname || '').toLowerCase()
    if (!host.includes('mars-1397421562') && !host.includes('myqcloud.com') && !host.includes('qcloud.com')) {
      return ''
    }
    return decodeURIComponent((u.pathname || '').replace(/^\//, ''))
  } catch (e) {
    return ''
  }
}

function splashPublicUrl(key) {
  if (!key) return ''
  return `${COS_BASE_URL.replace(/\/$/, '')}/${encodeURI(key)}`
}

function splashPosterUrl(cosKeyOrUrl) {
  const key = cosKeyOrUrl.includes('://') ? splashCosKeyFromUrl(cosKeyOrUrl) : cosKeyOrUrl
  if (!key) return ''
  return `${splashPublicUrl(key)}?ci-process=snapshot&time=0.5&format=jpg&width=720&height=1280&scaletype=cover`
}

function splashPreviewKey(sourceKey) {
  const base = String(sourceKey || '').split('/').pop() || `splash_${Date.now()}.mp4`
  const name = base.replace(/\.(mp4|mov|webm)$/i, '') + '_fast.mp4'
  return `开屏动画/preview/${name}`
}

function escapeXmlSplash(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function splashHeadExists(cos, key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) => {
      resolve(!err)
    })
  })
}

/** 开屏专用：720p / 低码率全时长预览，保证冷启动秒开 */
function submitSplashPreviewJob(cos, inputKey, outputKey) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Tag>Transcode</Tag>
  <Input>
    <Object>${escapeXmlSplash(inputKey)}</Object>
  </Input>
  <Operation>
    <Transcode>
      <Container><Format>mp4</Format></Container>
      <Video>
        <Codec>H.264</Codec>
        <Profile>main</Profile>
        <Bitrate>600</Bitrate>
        <Width>720</Width>
        <Fps>24</Fps>
        <Preset>medium</Preset>
      </Video>
      <Audio>
        <Codec>aac</Codec>
        <Bitrate>48</Bitrate>
        <Channels>2</Channels>
        <Samplerate>44100</Samplerate>
      </Audio>
      <TransConfig>
        <AdjDarMethod>scale</AdjDarMethod>
        <IsCheckReso>false</IsCheckReso>
        <ResoAdjMethod>1</ResoAdjMethod>
      </TransConfig>
    </Transcode>
    <Output>
      <Region>${COS_REGION}</Region>
      <Bucket>${COS_BUCKET}</Bucket>
      <Object>${escapeXmlSplash(outputKey)}</Object>
    </Output>
  </Operation>
  <CallBackFormat>JSON</CallBackFormat>
</Request>`

  return new Promise((resolve, reject) => {
    cos.request({
      Method: 'POST',
      Url: `https://${COS_BUCKET}.ci.${COS_REGION}.myqcloud.com/jobs`,
      Headers: { 'Content-Type': 'application/xml' },
      Body: body
    }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function newSplashMediaId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeSplashMediaItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const mediaUrl = String(raw.mediaUrl || raw.url || '').trim()
  if (!mediaUrl) return null
  let mediaType = String(raw.mediaType || raw.type || '').trim()
  if (!mediaType) {
    mediaType = /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(mediaUrl) ? 'video' : 'image'
  }
  return {
    id: String(raw.id || newSplashMediaId()),
    mediaType,
    mediaUrl,
    previewUrl: String(raw.previewUrl || '').trim(),
    posterUrl: String(raw.posterUrl || '').trim(),
    previewStatus: String(raw.previewStatus || '').trim(),
    previewJobAt: Number(raw.previewJobAt || 0) || 0,
    previewError: String(raw.previewError || '').trim()
  }
}

/** 兼容旧单媒体字段 → mediaItems[]，最多 10 条 */
function normalizeSplashDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  let items = []
  if (Array.isArray(doc.mediaItems) && doc.mediaItems.length) {
    items = doc.mediaItems.map(normalizeSplashMediaItem).filter(Boolean)
  } else if (doc.mediaUrl) {
    items = [normalizeSplashMediaItem({
      id: 'legacy',
      mediaType: doc.mediaType || '',
      mediaUrl: doc.mediaUrl,
      previewUrl: doc.previewUrl || '',
      posterUrl: doc.posterUrl || '',
      previewStatus: doc.previewStatus || '',
      previewJobAt: doc.previewJobAt || 0,
      previewError: doc.previewError || ''
    })].filter(Boolean)
  }
  items = items.slice(0, SPLASH_MEDIA_MAX)
  const first = items[0] || null
  return {
    ...doc,
    mediaItems: items,
    mediaType: first ? first.mediaType : (doc.mediaType || ''),
    mediaUrl: first ? first.mediaUrl : (doc.mediaUrl || ''),
    previewUrl: first ? first.previewUrl : (doc.previewUrl || ''),
    posterUrl: first ? first.posterUrl : (doc.posterUrl || ''),
    previewStatus: first ? first.previewStatus : (doc.previewStatus || '')
  }
}

/** 处理单条开屏媒体的封面/压缩预览（不写库） */
async function ensureOneSplashMediaItem(cos, item) {
  if (!item || item.mediaType !== 'video' || !item.mediaUrl) return item
  const sourceKey = splashCosKeyFromUrl(item.mediaUrl)
  if (!sourceKey) return item

  const next = { ...item }
  const nowTs = now()
  if (!next.posterUrl) next.posterUrl = splashPosterUrl(sourceKey)

  const previewKey = splashPreviewKey(sourceKey)
  const previewUrl = splashPublicUrl(previewKey)
  const previewExists = await splashHeadExists(cos, previewKey)
  if (previewExists) {
    next.previewUrl = previewUrl
    next.previewStatus = 'ready'
    next.previewError = ''
  } else {
    next.previewUrl = previewUrl
    const lastJob = Number(next.previewJobAt || 0)
    if (!lastJob || nowTs - lastJob > 10 * 60 * 1000) {
      try {
        await submitSplashPreviewJob(cos, sourceKey, previewKey)
        next.previewJobAt = nowTs
        next.previewStatus = 'processing'
        console.log('[splash] preview job submitted:', sourceKey, '->', previewKey)
      } catch (e) {
        next.previewStatus = 'failed'
        next.previewError = String(e.message || e).slice(0, 200)
        next.previewUrl = ''
        console.warn('[splash] preview job failed:', e.message || e)
      }
    } else if (!next.previewStatus) {
      next.previewStatus = 'processing'
    }
  }
  return next
}

async function ensureSplashMediaItems(doc) {
  const normalized = normalizeSplashDoc(doc)
  const items = Array.isArray(normalized.mediaItems) ? normalized.mediaItems : []
  if (!items.length) return normalized

  const cos = createCOSClient()
  const nextItems = []
  for (const item of items) {
    try {
      nextItems.push(await ensureOneSplashMediaItem(cos, item))
    } catch (e) {
      console.warn('[splash] ensure item failed:', e.message || e)
      nextItems.push(item)
    }
  }

  const first = nextItems[0] || null
  const patch = {
    mediaItems: nextItems,
    mediaType: first ? first.mediaType : '',
    mediaUrl: first ? first.mediaUrl : '',
    previewUrl: first ? first.previewUrl : '',
    posterUrl: first ? first.posterUrl : '',
    previewStatus: first ? first.previewStatus : '',
    previewJobAt: first ? first.previewJobAt : 0,
    updatedAt: now()
  }

  try {
    await db.collection(COLLECTIONS.STARSHIP_SPLASH).doc('current').update({ data: patch })
  } catch (e) {
    console.warn('[splash] patch mediaItems failed:', e.message || e)
  }
  return { ...normalized, ...patch }
}

async function updateStarshipSplashConfig(body, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.STARSHIP_SPLASH).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  let mediaItems = []
  if (Array.isArray(body.mediaItems)) {
    mediaItems = body.mediaItems.map(normalizeSplashMediaItem).filter(Boolean).slice(0, SPLASH_MEDIA_MAX)
  } else if (body.mediaUrl) {
    // 兼容旧单字段提交
    mediaItems = [normalizeSplashMediaItem({
      mediaType: body.mediaType || '',
      mediaUrl: body.mediaUrl,
      previewUrl: body.previewUrl || '',
      posterUrl: body.posterUrl || ''
    })].filter(Boolean)
  }

  // 视频项先补封面
  mediaItems = mediaItems.map((item) => {
    if (item.mediaType === 'video' && item.mediaUrl && !item.posterUrl) {
      const key = splashCosKeyFromUrl(item.mediaUrl)
      if (key) return { ...item, posterUrl: splashPosterUrl(key), previewStatus: item.previewStatus || 'pending' }
    }
    return item
  })

  const first = mediaItems[0] || null
  const patch = {
    enabled: body.enabled !== false,
    title: body.title || '',
    subtitle: body.subtitle || '',
    animationUrl: body.animationUrl || '',
    coverUrl: body.coverUrl || '',
    showSkip: body.showSkip !== false,
    skipText: body.skipText || '跳过',
    mediaItems,
    mediaType: first ? first.mediaType : '',
    mediaUrl: first ? first.mediaUrl : '',
    previewUrl: first ? first.previewUrl : '',
    posterUrl: first ? first.posterUrl : '',
    previewStatus: first ? first.previewStatus : '',
    countdownSeconds: Math.max(1, Math.min(30, Number(body.countdownSeconds) || 5)),
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: patch })

  let after = patch
  try {
    after = await ensureSplashMediaItems({ _id: id, ...patch })
  } catch (e) {
    console.warn('[splash] ensure on save failed:', e.message || e)
  }

  await writeOpLog({ user, module: COLLECTIONS.STARSHIP_SPLASH, action: 'upsert', targetId: id, before, after })
  return ok(after)
}

const CAROUSEL_KEY_PREFIX = '首页轮播图/'

async function getCarouselGlobalEnabled() {
  const res = await db.collection(COLLECTIONS.MEDIA_ASSETS)
    .where({ key: '__carousel_global_config__' })
    .limit(1).get()
  const doc = (res.data || [])[0]
  return ok({
    enabled: doc ? doc.enabled !== false : true,
    imageDuration: doc && doc.imageDuration ? Number(doc.imageDuration) : 5,
    videoDuration: doc && doc.videoDuration ? Number(doc.videoDuration) : 5
  })
}

async function setCarouselGlobalEnabled(body, user) {
  const patch = { updatedAt: now(), updatedBy: user.username }
  if (body.enabled != null) patch.enabled = !!body.enabled
  if (body.imageDuration != null) patch.imageDuration = Math.max(1, Math.min(60, Number(body.imageDuration) || 5))
  if (body.videoDuration != null) patch.videoDuration = Math.max(1, Math.min(60, Number(body.videoDuration) || 5))

  const existing = await db.collection(COLLECTIONS.MEDIA_ASSETS)
    .where({ key: '__carousel_global_config__' }).limit(1).get()
  if (existing.data && existing.data.length > 0) {
    await db.collection(COLLECTIONS.MEDIA_ASSETS).doc(existing.data[0]._id)
      .update({ data: patch })
  } else {
    await db.collection(COLLECTIONS.MEDIA_ASSETS).add({
      data: { key: '__carousel_global_config__', enabled: true, imageDuration: 5, videoDuration: 5, sourceTag: 'config', createdAt: now(), ...patch }
    })
  }
  await writeOpLog({ user, module: 'carousel', action: 'update_global_config', after: patch })
  return ok(true)
}

async function listCarousel() {
  const _ = db.command
  const res = await db.collection(COLLECTIONS.MEDIA_ASSETS)
    .where({ sourceTag: _.in(['carousel', 'auto-carousel']) })
    .limit(200)
    .get()
  const prefix = CAROUSEL_KEY_PREFIX.toLowerCase()
  const list = (res.data || [])
    .filter((row) => row && row.key && String(row.key).toLowerCase().startsWith(prefix))
    .sort((a, b) => {
      const sa = Number(a.sort || 0)
      const sb = Number(b.sort || 0)
      if (sa !== sb) return sa - sb
      return String(a.key || '').localeCompare(String(b.key || ''))
    })
    .slice(0, 50)
  return ok(list)
}

async function syncAutoCarousel() {
  try {
    const result = await cloud.callFunction({ name: 'syncCarouselFromTweets', data: { from: 'admin' } })
    return ok(result.result || result)
  } catch (e) {
    return fail(5000, '同步失败: ' + (e.message || String(e)))
  }
}

async function createCarousel(body, user) {
  const key = (body.key || '').trim()
  if (!key) return fail(4001, 'key不能为空')
  const fullKey = key.startsWith(CAROUSEL_KEY_PREFIX) ? key : `${CAROUSEL_KEY_PREFIX}${key}`

  const dupRes = await db.collection(COLLECTIONS.MEDIA_ASSETS).where({ key: fullKey }).limit(20).get()
  const dupRows = dupRes.data || []
  const carouselDup = dupRows.find((r) => r && r.sourceTag === 'carousel')
  if (carouselDup) return fail(4003, '该轮播 Key 已存在，请使用编辑而非新建')

  for (const row of dupRows) {
    if (!row || !row._id) continue
    if (row.sourceTag === 'carousel') continue
    try {
      await db.collection(COLLECTIONS.MEDIA_ASSETS).doc(row._id).remove()
      await writeOpLog({ user, module: 'carousel', action: 'delete_duplicate_key', targetId: row._id, before: row, after: null })
    } catch (e) {}
  }

  const payload = {
    key: fullKey,
    url: body.url || '',
    type: body.type === 'video' ? 'video' : 'image',
    sourceTag: 'carousel',
    enabled: body.enabled !== false,
    sort: Number(body.sort || 0),
    createdAt: now(),
    updatedAt: now(),
    updatedBy: user.username
  }

  const res = await db.collection(COLLECTIONS.MEDIA_ASSETS).add({ data: payload })
  await writeOpLog({ user, module: 'carousel', action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function updateCarousel(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_ASSETS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = {}
  if (body.key != null) {
    const k = String(body.key).trim()
    patch.key = k.startsWith(CAROUSEL_KEY_PREFIX) ? k : `${CAROUSEL_KEY_PREFIX}${k}`
  }
  if (body.url != null) patch.url = body.url
  if (body.type != null) patch.type = body.type === 'video' ? 'video' : 'image'
  if (body.enabled != null) patch.enabled = !!body.enabled
  if (body.sort != null) patch.sort = Number(body.sort)
  patch.updatedAt = now()
  patch.updatedBy = user.username
  patch.sourceTag = 'carousel'

  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'carousel', action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function deleteCarousel(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_ASSETS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const keyToClean =
    before.key && String(before.key).toLowerCase().startsWith(String(CAROUSEL_KEY_PREFIX).toLowerCase())
      ? String(before.key)
      : ''

  await ref.remove()
  await writeOpLog({ user, module: 'carousel', action: 'delete', targetId: id, before, after: null })

  if (keyToClean) {
    const remain = await db.collection(COLLECTIONS.MEDIA_ASSETS).where({ key: keyToClean }).limit(20).get()
    for (const row of remain.data || []) {
      if (!row || !row._id || row._id === id) continue
      try {
        await db.collection(COLLECTIONS.MEDIA_ASSETS).doc(row._id).remove()
        await writeOpLog({ user, module: 'carousel', action: 'delete_duplicate_key', targetId: row._id, before: row, after: null })
      } catch (e) {}
    }
  }

  return ok(true)
}

async function listUsers(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const [countRes, listRes] = await Promise.all([
    db.collection(COLLECTIONS.USERS).count(),
    db.collection(COLLECTIONS.USERS)
      .orderBy('updatedAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ])

  const list = (listRes.data || []).map((u) => ({
    _id: u._id,
    username: u.username,
    role: u.role,
    status: u.status,
    permissions: u.permissions || [],
    lastLoginAt: u.lastLoginAt || 0,
    createdAt: u.createdAt || 0,
    updatedAt: u.updatedAt || 0
  }))

  return ok({ list, total: countRes.total, page, pageSize })
}

async function createUser(body, user) {
  const username = (body.username || '').trim()
  const password = String(body.password || '')
  const role = body.role || 'viewer'
  const status = body.status || 'active'

  if (!username || !password) return fail(4001, '用户名和密码不能为空')

  const exists = await db.collection(COLLECTIONS.USERS).where({ username }).limit(1).get()
  if ((exists.data || []).length > 0) return fail(4003, '用户名已存在')

  const permissions = Array.isArray(body.permissions) ? body.permissions.filter(p => PERMISSION_MODULES[p]) : []
  const ts = now()
  const payload = {
    username,
    passwordHash: getBcrypt().hashSync(password, 10),
    role,
    status,
    permissions,
    tokenVersion: 0,
    pwdUpdatedAt: ts,
    lastLoginAt: 0,
    createdAt: ts,
    updatedAt: ts
  }

  const res = await db.collection(COLLECTIONS.USERS).add({ data: payload })
  await writeOpLog({ user, module: COLLECTIONS.USERS, action: 'create', targetId: res._id, after: { username, role, status } })
  return ok({ id: res._id })
}

async function updateUser(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.USERS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '用户不存在')

  const patch = pick(body, ['role', 'status'])
  if (Array.isArray(body.permissions)) {
    patch.permissions = body.permissions.filter(p => PERMISSION_MODULES[p])
  }
  if (body.password) {
    patch.passwordHash = getBcrypt().hashSync(String(body.password), 10)
    patch.pwdUpdatedAt = now()
    patch.tokenVersion = Number(before.tokenVersion || 0) + 1
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status') && body.status === 'disabled') {
    patch.tokenVersion = Number(before.tokenVersion || 0) + 1
  }
  patch.updatedAt = now()

  await ref.update({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.USERS, action: 'update', targetId: id, before: { username: before.username, role: before.role, status: before.status }, after: { username: before.username, ...patch } })
  return ok(true)
}

async function restoreUser(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.USERS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '用户不存在')

  if (before.status !== 'deleted') {
    return fail(4002, '仅支持恢复已软删除用户')
  }

  const patch = {
    status: 'active',
    updatedAt: now(),
    restoredAt: now(),
    restoredBy: user.username
  }

  await ref.update({ data: patch })
  await writeOpLog({
    user,
    module: COLLECTIONS.USERS,
    action: 'restore',
    targetId: id,
    before: { username: before.username, role: before.role, status: before.status },
    after: { username: before.username, role: before.role, ...patch }
  })
  return ok(true)
}

async function deleteUser(id, user, body = {}) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.USERS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '用户不存在')

  if (before.role === 'super_admin') {
    return fail(4031, '不可删除超级管理员账号')
  }
  if (before.username === user.username || before._id === user.id) {
    return fail(4032, '不可删除当前登录账号')
  }

  const softDelete = !!body.softDelete

  if (softDelete) {
    const patch = {
      status: 'deleted',
      tokenVersion: Number(before.tokenVersion || 0) + 1,
      deletedAt: now(),
      deletedBy: user.username,
      updatedAt: now()
    }
    await ref.update({ data: patch })
    await writeOpLog({
      user,
      module: COLLECTIONS.USERS,
      action: 'soft_delete',
      targetId: id,
      before: { username: before.username, role: before.role, status: before.status },
      after: { username: before.username, role: before.role, ...patch }
    })
    return ok({ mode: 'soft' })
  }

  await ref.remove()
  await writeOpLog({
    user,
    module: COLLECTIONS.USERS,
    action: 'delete',
    targetId: id,
    before: { username: before.username, role: before.role, status: before.status },
    after: null
  })
  return ok({ mode: 'hard' })
}

async function listLogs(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
  const moduleName = (query.module || '').trim()
  const operatorName = (query.operatorName || '').trim()
  const action = (query.action || '').trim()
  const targetId = (query.targetId || '').trim()
  const startAt = Number(query.startAt || 0)
  const endAt = Number(query.endAt || 0)

  let where = {}
  if (moduleName) where.module = moduleName
  if (operatorName) where.operatorName = operatorName
  if (action) where.action = action
  if (targetId) where.targetId = targetId
  if (startAt || endAt) {
    if (startAt && endAt) where.createdAt = _.and([_.gte(startAt), _.lte(endAt)])
    else if (startAt) where.createdAt = _.gte(startAt)
    else where.createdAt = _.lte(endAt)
  }

  const queryRef = db.collection(COLLECTIONS.LOGS).where(where)
  const [countRes, listRes] = await Promise.all([
    queryRef.count(),
    queryRef.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  ])

  return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
}

async function getLogsStats() {
  try {
    const col = db.collection(COLLECTIONS.LOGS)
    const nowMs = Date.now()
    const since24h = nowMs - 24 * 60 * 60 * 1000
    const [totalRes, last24Res, sampleRes] = await Promise.all([
      col.count().catch(() => ({ total: 0 })),
      col.where({ createdAt: _.gte(since24h) }).count().catch(() => ({ total: 0 })),
      col.where({ createdAt: _.gte(since24h) }).orderBy('createdAt', 'desc').limit(500).get().catch(() => ({ data: [] }))
    ])
    const counts = {}
    for (const item of (sampleRes.data || [])) {
      const m = (item && item.module) ? String(item.module) : '(unknown)'
      counts[m] = (counts[m] || 0) + 1
    }
    let topModule = ''
    let topCount = 0
    for (const [m, c] of Object.entries(counts)) {
      if (c > topCount) { topModule = m; topCount = c }
    }
    return ok({
      total: totalRes.total || 0,
      last24hCount: last24Res.total || 0,
      last24hTopModule: topModule,
      last24hTopCount: topCount
    })
  } catch (e) {
    return ok({ total: 0, last24hCount: 0, last24hTopModule: '', last24hTopCount: 0 })
  }
}

/** 侧栏角标：按模块返回「待处理」或「自上次查看后的新增」数量（非操作日志条数） */
const MENU_BADGE_MODULES = [
  'starship_event_updates',
  'tweet_sync',
  'launch_subscriptions',
  'launch_votes',
  'lunar_wishes',
  'road_closure_notice',
  'milestone_rewards',
  'announcements'
]

async function safeCountWhere(collection, where) {
  try {
    const res = await db.collection(collection).where(where).count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

async function getMenuBadgeCount(mod, since) {
  const hasBaseline = since > 0

  switch (mod) {
    case 'milestone_rewards':
      return safeCountWhere(COLLECTIONS.MILESTONE_CLAIMS, { status: 'pending' })

    case 'lunar_wishes':
      return safeCountWhere('lunar_wishes', { status: 'pending' })

    case 'launch_subscriptions':
      return safeCountWhere(COLLECTIONS.LAUNCH_SUBSCRIPTIONS, { sent: false })

    case 'tweet_sync':
      if (!hasBaseline) return 0
      return safeCountWhere(COLLECTIONS.STARSHIP_EVENT_UPDATES, { source: 'auto_sync', createdAt: _.gt(since) })

    case 'starship_event_updates':
      if (!hasBaseline) return 0
      return safeCountWhere(COLLECTIONS.STARSHIP_EVENT_UPDATES, { updatedAt: _.gt(since) })

    case 'launch_votes': {
      const unsettled = await safeCountWhere(COLLECTIONS.LAUNCH_VOTES, { enabled: true, result: '' })
      if (!hasBaseline) return unsettled
      const newRecords = await safeCountWhere('launch_vote_records', { createdAt: _.gt(since) })
      return Math.max(unsettled, newRecords)
    }

    case 'road_closure_notice':
      if (!hasBaseline) return 0
      return safeCountWhere(COLLECTIONS.LOGS, { module: COLLECTIONS.ROAD_CLOSURE, createdAt: _.gt(since) })

    case 'announcements':
      if (!hasBaseline) return 0
      return safeCountWhere(COLLECTIONS.ANNOUNCEMENTS, { updatedAt: _.gt(since) })

    default:
      return 0
  }
}

async function getLogsUnreadByModule(query = {}) {
  let lastReadMap = {}
  try {
    if (query && query.lastReadMap) lastReadMap = JSON.parse(query.lastReadMap)
  } catch (e) {}

  const requestedModules = Array.isArray(query.modules)
    ? query.modules
    : (typeof query.modules === 'string' && query.modules
        ? query.modules.split(',').map(s => s.trim()).filter(Boolean)
        : null)
  const modules = requestedModules && requestedModules.length ? requestedModules : MENU_BADGE_MODULES

  const counts = {}
  const latest = {}

  await Promise.all(modules.map(async (mod) => {
    const since = Number(lastReadMap[mod] || 0)
    try {
      counts[mod] = await getMenuBadgeCount(mod, since)
      latest[mod] = since
    } catch (e) {
      counts[mod] = 0
      latest[mod] = since
    }
  }))

  return ok({ counts, latest, modules })
}

async function cleanLogs(body = {}, user) {
  const days = Math.min(365, Math.max(7, Number(body.beforeDays || 60)))
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const col = db.collection(COLLECTIONS.LOGS)
  let removed = 0
  let safety = 0
  try {
    while (safety < 200) {
      safety++
      const batch = await col
        .where({ createdAt: _.lt(cutoff) })
        .limit(50)
        .get()
      const list = batch.data || []
      if (!list.length) break
      for (const doc of list) {
        try {
          await col.doc(doc._id).remove()
          removed++
        } catch (e) {}
      }
      if (list.length < 50) break
    }
    await writeOpLog({ user, module: 'op_logs', action: 'clean', after: { removed, days } }).catch(() => {})
    return ok({ removed, days, message: `已清理 ${removed} 条 ${days} 天前的日志` })
  } catch (e) {
    return fail(5001, '清理失败: ' + (e.message || String(e)))
  }
}

function normalizeBoolValue(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return undefined
}

function buildWhereWithKeyword(baseWhere = {}, keyword = '', fields = []) {
  if (!keyword) return baseWhere
  const orConditions = fields.map((field) => ({ [field]: db.RegExp({ regexp: keyword, options: 'i' }) }))
  if (!orConditions.length) return baseWhere
  if (!Object.keys(baseWhere).length) return _.or(orConditions)
  return _.and([baseWhere, _.or(orConditions)])
}

function encodeCursor(payload = {}) {
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

function decodeCursor(cursor = '') {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64').toString('utf8'))
  } catch (e) {
    return null
  }
}

async function listMediaAssets(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
  const keyword = (query.keyword || '').trim()
  const sourceTag = (query.sourceTag || '').trim()
  const enabled = normalizeBoolValue(query.enabled)
  const keyPrefix = (query.keyPrefix || '').trim()

  let where = {}
  if (sourceTag) where.sourceTag = sourceTag
  if (enabled !== undefined) where.enabled = enabled
  if (keyPrefix) where.key = db.RegExp({ regexp: `^${keyPrefix}`, options: 'i' })

  const whereExpr = buildWhereWithKeyword(where, keyword, ['_id', 'key'])
  const queryRef = db.collection(COLLECTIONS.MEDIA_ASSETS).where(whereExpr)

  const [countRes, listRes] = await Promise.all([
    queryRef.count(),
    queryRef.orderBy('updatedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  ])

  const list = listRes.data || []
  const hasMore = page * pageSize < Number(countRes.total || 0)
  const nextCursor = hasMore ? String(page + 1) : ''

  return ok({ list, total: countRes.total, page, pageSize, nextCursor })
}

async function updateMediaAsset(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_ASSETS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = pick(body, ['enabled', 'key', 'url', 'sourceTag'])
  patch.updatedAt = now()

  await ref.update({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_ASSETS, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function batchUpdateMediaAssets(body = {}, user) {
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(Boolean))] : []
  if (!ids.length) return fail(4001, 'ids不能为空')
  if (ids.length > 200) return fail(4001, '单次批量最多200条')

  const patch = pick(body.patch || {}, ['enabled', 'sourceTag'])
  if (Object.keys(patch).length === 0) return fail(4001, 'patch不能为空')

  patch.updatedAt = now()

  let updated = 0
  let failed = 0
  const errors = []
  for (const id of ids) {
    try {
      await db.collection(COLLECTIONS.MEDIA_ASSETS).doc(id).update({ data: patch })
      updated += 1
    } catch (e) {
      failed += 1
      errors.push({ id, message: e.message || String(e) })
    }
  }

  await writeOpLog({ user, module: COLLECTIONS.MEDIA_ASSETS, action: 'batch_update', targetId: ids.join(','), before: null, after: { ...patch, updated, failed } })
  return ok({ total: ids.length, updated, failed, errors: errors.slice(0, 20) })
}

async function listMediaFeed(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
  const keyword = (query.keyword || '').trim()
  const sourceTag = (query.sourceTag || '').trim()
  const type = (query.type || '').trim()
  const enabled = normalizeBoolValue(query.enabled)
  const auditStatus = (query.auditStatus || '').trim()
  const cursor = decodeCursor(query.cursor || '')

  let where = {}
  if (sourceTag) where.sourceTag = sourceTag
  if (type) where.type = type
  if (enabled !== undefined) where.enabled = enabled
  if (auditStatus) where.auditStatus = auditStatus
  if (cursor?.updatedAt) where.updatedAt = _.lte(Number(cursor.updatedAt))

  const whereExpr = buildWhereWithKeyword(where, keyword, ['_id', 'title', 'desc'])
  const queryRef = db.collection(COLLECTIONS.MEDIA_FEED).where(whereExpr)

  const [countRes, listRes] = await Promise.all([
    queryRef.count(),
    queryRef.orderBy('order', 'asc').orderBy('updatedAt', 'desc').skip(cursor ? 0 : (page - 1) * pageSize).limit(pageSize).get()
  ])

  const list = listRes.data || []
  const last = list[list.length - 1]
  const nextCursor = list.length === pageSize && last ? encodeCursor({ updatedAt: Number(last.updatedAt || 0), id: last._id || '' }) : ''

  return ok({ list, total: countRes.total, page, pageSize, nextCursor })
}

async function updateMediaFeed(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_FEED).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = pick(body, ['title', 'desc', 'enabled', 'order', 'type', 'coverFileID', 'fileID', 'aspectRatio', 'weight', 'previewImages', 'sourceTag', 'auditStatus', 'appid', 'storeAppid', 'productId', 'productID', 'product_id', 'productPromotionLink', 'product_promotion_link', 'mediaId', 'media_id'])
  patch.updatedAt = now()

  await ref.update({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_FEED, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  await bumpProfileFeedCacheVersion()
  return ok(true)
}

async function batchUpdateMediaFeed(body = {}, user) {
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(Boolean))] : []
  if (!ids.length) return fail(4001, 'ids不能为空')
  if (ids.length > 200) return fail(4001, '单次批量最多200条')

  const patch = pick(body.patch || {}, ['enabled', 'type', 'sourceTag', 'auditStatus'])
  if (Object.keys(patch).length === 0) return fail(4001, 'patch不能为空')

  patch.updatedAt = now()

  let updated = 0
  let failed = 0
  const errors = []
  for (const id of ids) {
    try {
      await db.collection(COLLECTIONS.MEDIA_FEED).doc(id).update({ data: patch })
      updated += 1
    } catch (e) {
      failed += 1
      errors.push({ id, message: e.message || String(e) })
    }
  }

  await writeOpLog({ user, module: COLLECTIONS.MEDIA_FEED, action: 'batch_update', targetId: ids.join(','), before: null, after: { ...patch, updated, failed } })
  if (updated > 0) await bumpProfileFeedCacheVersion()
  return ok({ total: ids.length, updated, failed, errors: errors.slice(0, 20) })
}

async function listShopFeed(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
  const keyword = (query.keyword || '').trim()
  const enabled = normalizeBoolValue(query.enabled)

  const where = {}
  if (enabled !== undefined) where.enabled = enabled

  const whereExpr = buildWhereWithKeyword(where, keyword, ['_id', 'title', 'desc', 'productId'])
  const queryRef = db.collection(COLLECTIONS.SHOP_FEED).where(whereExpr)

  const [countRes, listRes] = await Promise.all([
    queryRef.count(),
    queryRef.orderBy('order', 'asc').orderBy('updatedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  ])

  const list = listRes.data || []
  return ok({ list, total: countRes.total, page, pageSize })
}

async function updateShopFeed(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.SHOP_FEED).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = pick(body, ['title', 'desc', 'enabled', 'order', 'aspectRatio', 'coverFileID', 'appid', 'storeAppid', 'productId', 'productID', 'product_id', 'productPromotionLink', 'product_promotion_link', 'mediaId', 'media_id'])
  patch.updatedAt = now()

  await ref.update({ data: patch })
  await writeOpLog({ user, module: COLLECTIONS.SHOP_FEED, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function batchUpdateShopFeed(body = {}, user) {
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(Boolean))] : []
  if (!ids.length) return fail(4001, 'ids不能为空')
  if (ids.length > 200) return fail(4001, '单次批量最多200条')

  const patch = pick(body.patch || {}, ['enabled', 'appid', 'storeAppid'])
  if (Object.keys(patch).length === 0) return fail(4001, 'patch不能为空')

  patch.updatedAt = now()

  let updated = 0
  let failed = 0
  const errors = []
  for (const id of ids) {
    try {
      await db.collection(COLLECTIONS.SHOP_FEED).doc(id).update({ data: patch })
      updated += 1
    } catch (e) {
      failed += 1
      errors.push({ id, message: e.message || String(e) })
    }
  }

  await writeOpLog({ user, module: COLLECTIONS.SHOP_FEED, action: 'batch_update', targetId: ids.join(','), before: null, after: { ...patch, updated, failed } })
  return ok({ total: ids.length, updated, failed, errors: errors.slice(0, 20) })
}

async function cosProxyUpload(body = {}) {
  const key = (body.key || '').trim()
  const base64Data = body.base64Data || ''
  const contentType = body.contentType || 'application/octet-stream'
  if (!key) return fail(4001, 'key不能为空')
  if (!base64Data) return fail(4001, '文件数据不能为空')

  const buffer = Buffer.from(base64Data, 'base64')
  const isVideo = /^video\//.test(String(contentType || ''))
  const MAX_SIZE = isVideo ? 25 * 1024 * 1024 : 6 * 1024 * 1024
  if (buffer.length > MAX_SIZE) {
    return fail(4001, isVideo ? '视频过大(>25MB)，请压缩后重试或使用直传' : '文件过大(>6MB)，请在COS控制台配置CORS后使用直传')
  }

  const cos = createCOSClient()
  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })

  const cosUrl = `${COS_BASE_URL}${encodeURI(key.replace(/^\/+/, ''))}`
  return ok({ cosUrl, key })
}

async function cosPresign(body = {}) {
  const key = (body.key || '').trim()
  if (!key) return fail(4001, 'key不能为空')

  const cos = createCOSClient()
  const uploadUrl = await new Promise((resolve, reject) => {
    cos.getObjectUrl({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Method: 'PUT',
      Sign: true,
      Expires: 900,
      Protocol: 'https:'
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data.Url)
    })
  })

  const cosUrl = `${COS_BASE_URL}${encodeURI(key.replace(/^\/+/, ''))}`
  return ok({ uploadUrl, cosUrl, key })
}

async function cosCreateFolder(body = {}) {
  const folderName = (body.folderName || '').trim().replace(/\//g, '')
  const prefix = (body.prefix || '').trim()
  if (!folderName) return fail(4001, '文件夹名称不能为空')

  const key = `${prefix}${folderName}/`
  const cos = createCOSClient()
  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: ''
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })

  return ok({ key })
}

async function cosListFiles(query = {}) {
  const prefix = (query.prefix || '').trim()
  const delimiter = (query.delimiter || '').trim() || '/'
  const maxKeys = Math.min(1000, Math.max(1, Number(query.maxKeys || 200)))
  const marker = (query.marker || '').trim()

  const cos = createCOSClient()
  const result = await new Promise((resolve, reject) => {
    cos.getBucket({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Prefix: prefix,
      Delimiter: delimiter,
      MaxKeys: maxKeys,
      Marker: marker
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })

  const folders = (result.CommonPrefixes || []).map((item) => ({
    prefix: item.Prefix,
    name: item.Prefix.replace(prefix, '').replace(/\/$/, '')
  }))

  const files = (result.Contents || [])
    .filter((item) => item.Key !== prefix)
    .map((item) => ({
      key: item.Key,
      name: item.Key.replace(prefix, ''),
      size: Number(item.Size || 0),
      lastModified: item.LastModified,
      etag: item.ETag,
      url: `${COS_BASE_URL}${encodeURI(item.Key)}`
    }))

  return ok({
    folders,
    files,
    isTruncated: result.IsTruncated === 'true',
    nextMarker: result.NextMarker || '',
    prefix
  })
}

async function cosDeleteFile(body = {}, user) {
  const key = (body.key || '').trim()
  if (!key) return fail(4001, 'key不能为空')

  const cos = createCOSClient()
  await new Promise((resolve, reject) => {
    cos.deleteObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })

  await writeOpLog({ user, module: 'cos', action: 'delete_file', targetId: key })
  return ok({ key })
}

async function createMediaFeed(body, user) {
  const title = (body.title || '').trim()
  if (!title) return fail(4001, '标题不能为空')

  const ts = now()
  const payload = {
    title,
    desc: body.desc || '',
    type: body.type || 'image',
    fileID: body.fileID || '',
    coverFileID: body.coverFileID || '',
    previewImages: Array.isArray(body.previewImages) ? body.previewImages : [],
    aspectRatio: Number(body.aspectRatio || 1),
    enabled: body.enabled !== false,
    auditStatus: body.auditStatus || 'approved',
    sourceTag: (typeof body.sourceTag === 'string' && body.sourceTag.trim()) ? body.sourceTag.trim() : 'inspiration',
    weight: Number(body.weight || 0),
    order: Number(body.order || 0),
    appid: body.appid || '',
    storeAppid: body.storeAppid || '',
    productId: body.productId || '',
    productPromotionLink: body.productPromotionLink || '',
    mediaId: body.mediaId || '',
    createdAt: ts,
    updatedAt: ts,
    createdBy: user.username,
    updatedBy: user.username
  }

  const res = await db.collection(COLLECTIONS.MEDIA_FEED).add({ data: payload })
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_FEED, action: 'create', targetId: res._id, after: payload })
  await bumpProfileFeedCacheVersion()
  return ok({ id: res._id })
}

async function deleteMediaFeed(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_FEED).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_FEED, action: 'delete', targetId: id, before, after: null })
  await bumpProfileFeedCacheVersion()
  return ok(true)
}

async function createShopFeed(body, user) {
  const ts = now()
  const payload = {
    title: body.title || '',
    desc: body.desc || '',
    order: Number(body.order || 0),
    aspectRatio: Number(body.aspectRatio || 0.94),
    coverFileID: body.coverFileID || '',
    enabled: body.enabled !== false,
    appid: body.appid || '',
    storeAppid: body.storeAppid || '',
    productId: body.productId || '',
    productPromotionLink: body.productPromotionLink || '',
    mediaId: body.mediaId || '',
    createdAt: ts,
    updatedAt: ts,
    createdBy: user.username,
    updatedBy: user.username
  }

  const res = await db.collection(COLLECTIONS.SHOP_FEED).add({ data: payload })
  await writeOpLog({ user, module: COLLECTIONS.SHOP_FEED, action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function deleteShopFeed(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.SHOP_FEED).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.SHOP_FEED, action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

async function createMediaAsset(body, user) {
  const key = (body.key || '').trim()
  if (!key) return fail(4001, 'key不能为空')

  const ts = now()
  const payload = {
    key,
    url: body.url || `${COS_BASE_URL}${encodeURI(key)}`,
    sourceTag: body.sourceTag || 'admin',
    enabled: body.enabled !== false,
    createdAt: ts,
    updatedAt: ts,
    createdBy: user.username
  }

  const res = await db.collection(COLLECTIONS.MEDIA_ASSETS).add({ data: payload })
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_ASSETS, action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function deleteMediaAsset(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MEDIA_ASSETS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: COLLECTIONS.MEDIA_ASSETS, action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

/** 触发 syncRocketCosIndex：COS「火箭配置图/」目录 → media_assets（manual 记录不会被覆盖删除） */
async function syncRocketMediaCosIndex(user) {
  try {
    const res = await cloud.callFunction({
      name: 'syncRocketCosIndex',
      data: { from: 'admin_gateway' }
    })
    const result = (res && res.result) || {}
    await writeOpLog({
      user,
      module: COLLECTIONS.MEDIA_ASSETS,
      action: 'rocket_cos_sync_index',
      targetId: 'syncRocketCosIndex',
      after: result
    }).catch(() => {})
    if (!result.ok) {
      return fail(5001, result.error || '同步未完成')
    }
    return ok(result)
  } catch (e) {
    return fail(5001, `同步失败: ${e.message || String(e)}`)
  }
}

// ========== 推送通知管理 ==========
async function listPushSubscriptions(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  try {
    const col = db.collection(COLLECTIONS.LAUNCH_SUBSCRIPTIONS)
    const [countRes, listRes] = await Promise.all([
      col.count(),
      col.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
  } catch (e) {
    return ok({ list: [], total: 0, page, pageSize })
  }
}

async function listPushHistory(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  try {
    const col = db.collection(COLLECTIONS.PUSH_HISTORY)
    const [countRes, listRes] = await Promise.all([
      col.count(),
      col.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
  } catch (e) {
    return ok({ list: [], total: 0, page, pageSize })
  }
}

async function triggerPushNotification(body, user) {
  try {
    const res = await cloud.callFunction({ name: 'sendLaunchReminder', data: { action: 'manual', ...body } })
    const ts = now()
    await db.collection(COLLECTIONS.PUSH_HISTORY).add({
      data: { type: 'manual', triggeredBy: user.username, payload: body, result: res.result || null, createdAt: ts }
    }).catch(() => {})
    await writeOpLog({ user, module: 'push_notify', action: 'trigger', after: body })
    return ok(res.result || { message: '推送已触发' })
  } catch (e) {
    return fail(5001, '推送触发失败: ' + (e.message || String(e)))
  }
}

// ========== 发射数据管理 ==========
async function listLaunchData(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const keyword = (query.keyword || '').trim().toLowerCase()
  const type = (query.type || '').trim()

  const col = db.collection('space_devs_cache')

  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const buildPrefixRegex = (prefix) => db.RegExp({ regexp: '^' + escapeRegex(prefix), options: 'i' })

  const fetchPrefix = async (prefix) => {
    try {
      const res = await col
        .where({ _id: buildPrefixRegex(prefix) })
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get()
      return res.data || []
    } catch (e) {
      return []
    }
  }

  let prefixes = []
  if (type === 'upcoming') prefixes = ['api_cache_/launches/upcoming/']
  else if (type === 'previous') prefixes = ['api_cache_/launches/previous/']
  else prefixes = ['api_cache_/launches/upcoming/', 'api_cache_/launches/previous/']

  const docsArr = await Promise.all(prefixes.map(fetchPrefix))
  const allDocs = [].concat(...docsArr)

  const merged = new Map()
  for (const doc of allDocs) {
    const data = doc && doc.data
    if (!data) continue
    const results = Array.isArray(data.results)
      ? data.results
      : (Array.isArray(data) ? data : [])
    for (const item of results) {
      if (!item) continue
      const key = String(item.id != null ? item.id : (item._id || ''))
      if (!key) continue
      if (!merged.has(key)) {
        merged.set(key, { item, cacheUpdatedAt: doc.updatedAt || doc.updatedAtMs || null })
      }
    }
  }

  let list = Array.from(merged.values())

  if (keyword) {
    list = list.filter(({ item }) => {
      const name = (item.name || '').toLowerCase()
      const mname = item.mission && item.mission.name ? String(item.mission.name).toLowerCase() : ''
      const sname = item.status && item.status.name ? String(item.status.name).toLowerCase() : ''
      return name.includes(keyword) || mname.includes(keyword) || sname.includes(keyword)
    })
  }

  list.sort((a, b) => {
    const ta = a.item.net ? Date.parse(a.item.net) : 0
    const tb = b.item.net ? Date.parse(b.item.net) : 0
    return tb - ta
  })

  const total = list.length
  const start = (page - 1) * pageSize
  const pageItems = list.slice(start, start + pageSize).map(({ item, cacheUpdatedAt }) => ({
    _id: item.id != null ? String(item.id) : (item._id || ''),
    name: item.name || '',
    mission_name: item.mission && item.mission.name ? item.mission.name : '',
    type: item.mission && item.mission.type
      ? (item.mission.type.name || (typeof item.mission.type === 'string' ? item.mission.type : ''))
      : '',
    status: item.status && item.status.name ? item.status.name : (typeof item.status === 'string' ? item.status : ''),
    net: item.net || null,
    description: item.mission && item.mission.description ? item.mission.description : '',
    updatedAt: cacheUpdatedAt
  }))

  return ok({ list: pageItems, total, page, pageSize })
}

async function getLaunchDataById(id) {
  if (!id) return fail(4001, 'id不能为空')
  try {
    const res = await db.collection('space_devs_cache').doc(id).get()
    return ok(res.data || null)
  } catch (e) {
    return fail(4040, '数据不存在')
  }
}

async function updateLaunchData(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection('space_devs_cache').doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')

  const patch = pick(body, ['name', 'mission_name', 'description', 'status', 'net', 'image', 'translated_name', 'translated_description'])
  patch.updatedAt = now()
  patch.updatedBy = user.username

  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'launch_data', action: 'update', targetId: id, before: beforeRes.data, after: { ...beforeRes.data, ...patch } })
  return ok(true)
}

async function syncLaunchData(user) {
  try {
    cloud.callFunction({ name: 'syncSpaceDevsData', data: { action: 'sync' } }).then(res => {
      writeOpLog({ user, module: 'launch_data', action: 'sync', after: res.result || null }).catch(() => {})
    }).catch(() => {})
    return ok({ message: '发射数据同步已触发' })
  } catch (e) {
    return fail(5001, '触发同步失败: ' + (e.message || String(e)))
  }
}

async function cleanLaunchDataCache(user) {
  const col = db.collection('space_devs_cache')
  const nowTs = Date.now()
  let removed = 0
  let safety = 0
  try {
    while (safety < 200) {
      safety++
      const batch = await col
        .where(_.or([
          { expiresAt: _.lt(new Date(nowTs)) },
          { updatedAtMs: _.lt(nowTs - 7 * 24 * 60 * 60 * 1000) }
        ]))
        .limit(50)
        .get()
      const list = batch.data || []
      if (!list.length) break
      for (const doc of list) {
        try {
          await col.doc(doc._id).remove()
          removed++
        } catch (e) {}
      }
      if (list.length < 50) break
    }
    await writeOpLog({ user, module: 'launch_data', action: 'clean', after: { removed } }).catch(() => {})
    return ok({ removed, message: `已清理 ${removed} 条过期缓存` })
  } catch (e) {
    return fail(5001, '清理失败: ' + (e.message || String(e)))
  }
}

// ========== 推文追踪账号管理 ==========
async function listTweetAccounts() {
  const res = await db.collection('tweet_accounts').orderBy('createdAt', 'asc').limit(50).get()
  return ok(res.data || [])
}

async function addTweetAccount(body = {}) {
  const screenName = (body.screenName || '').trim()
  const label = (body.label || '').trim()
  if (!screenName) return fail(400, 'screenName 不能为空')

  const existing = await db.collection('tweet_accounts').where({ screenName }).limit(1).get()
  if (existing.data && existing.data.length > 0) {
    return fail(409, `账号 @${screenName} 已存在`)
  }

  const now = Date.now()
  const displayLabel = label || screenName
  const doc = {
    screenName,
    label: displayLabel,
    author: `${displayLabel}自动追踪`,
    cosFolder: `${displayLabel.replace(/\s+/g, '')}推文图片`,
    avatarUrl: '',
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
  const res = await db.collection('tweet_accounts').add({ data: doc })
  return ok({ _id: res._id, ...doc })
}

async function deleteTweetAccount(id) {
  if (!id) return fail(400, '缺少账号 ID')
  await db.collection('tweet_accounts').doc(id).remove()
  return ok(null, '已删除')
}

async function toggleTweetAccount(id, body = {}) {
  if (!id) return fail(400, '缺少账号 ID')
  const enabled = !!body.enabled
  await db.collection('tweet_accounts').doc(id).update({
    data: { enabled, updatedAt: Date.now() }
  })
  return ok(null, enabled ? '已启用' : '已禁用')
}

// ========== 推文同步监控 ==========
async function listTweetMonitor(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const source = (query.source || '').trim()

  let where = {}
  if (source) where.source = source

  try {
    const col = db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES).where(where)
    const [countRes, listRes] = await Promise.all([
      col.count(),
      col.orderBy('publishedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
  } catch (e) {
    return ok({ list: [], total: 0, page, pageSize })
  }
}

async function getTweetSyncStatus() {
  try {
    const recent = await db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES)
      .where({ source: 'auto_sync' })
      .orderBy('publishedAt', 'desc').limit(1).get()
    const lastSync = (recent.data || [])[0]
    const totalRes = await db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES).where({ source: 'auto_sync' }).count()
    return ok({
      lastSyncAt: lastSync?.publishedAt || lastSync?.createdAt || 0,
      totalAutoSynced: totalRes.total || 0,
      lastItem: lastSync || null
    })
  } catch (e) {
    return ok({ lastSyncAt: 0, totalAutoSynced: 0, lastItem: null })
  }
}

async function syncTweets(user) {
  try {
    cloud.callFunction({ name: 'syncSpaceXTweets', data: { action: 'sync' } }).then(res => {
      writeOpLog({ user, module: 'tweet_monitor', action: 'sync', after: res.result || null }).catch(() => {})
    }).catch(() => {})
    return ok({ message: 'SpaceX推文同步已触发' })
  } catch (e) {
    return fail(5001, '触发推文同步失败: ' + (e.message || String(e)))
  }
}

// ========== 数据统计分析 ==========
async function getStatisticsOverview() {
  const collections = [
    { key: 'space_devs_cache', label: '发射任务' },
    { key: COLLECTIONS.EVENTS, label: '事件' },
    { key: COLLECTIONS.ARTICLES, label: '文章' },
    { key: COLLECTIONS.MEDIA_ASSETS, label: '媒体素材' },
    { key: COLLECTIONS.MEDIA_FEED, label: '灵感流' },
    { key: COLLECTIONS.SHOP_FEED, label: '小店数据' },
    { key: COLLECTIONS.STARSHIP_EVENT_UPDATES, label: '事件更新' },
    { key: COLLECTIONS.ROAD_CLOSURE, label: '封路通知' },
    { key: COLLECTIONS.SPACEX_STATS, label: 'SpaceX统计' },
    { key: COLLECTIONS.USERS, label: '管理员' },
    { key: COLLECTIONS.LOGS, label: '操作日志' },
    { key: COLLECTIONS.PUSH_HISTORY, label: '推送记录' },
    { key: COLLECTIONS.ANNOUNCEMENTS, label: '系统公告' }
  ]

  const counts = await Promise.all(collections.map(async c => {
    const total = await safeCount(c.key)
    return { key: c.key, label: c.label, total }
  }))

  const recentLogs = await (async () => {
    try {
      const res = await db.collection(COLLECTIONS.LOGS).orderBy('createdAt', 'desc').limit(20).get()
      return res.data || []
    } catch (e) { return [] }
  })()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayMs = todayStart.getTime()

  let todayLogCount = 0
  try {
    const r = await db.collection(COLLECTIONS.LOGS).where({ createdAt: _.gte(todayMs) }).count()
    todayLogCount = r.total || 0
  } catch (e) {}

  return ok({ collections: counts, recentLogs, todayLogCount })
}

// ========== 直播管理 ==========
function extractPublicBiliRoomId(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d{3,})/i)
  if (m) return m[1]
  if (/^\d{3,}$/.test(s)) return s
  return ''
}

function defaultBiliEmbedUrl(roomId) {
  // 官方文档参数：mute（不是 muted）；勿传 autoplay，避免活动播放器 92002
  return `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=${roomId}&mute=1&danmaku=0&logo=0&recommend=0`
}

function normalizePublicBiliRooms(rawRooms, legacy = {}) {
  const list = Array.isArray(rawRooms) ? rawRooms : []
  const rooms = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const roomId =
      extractPublicBiliRoomId(item.roomId || item.room_id) ||
      extractPublicBiliRoomId(item.link) ||
      ''
    if (!roomId) continue
    const link = String(item.link || '').trim() || `https://live.bilibili.com/${roomId}`
    const embedUrl = String(item.embedUrl || item.embed_url || '').trim() || defaultBiliEmbedUrl(roomId)
    rooms.push({
      roomId,
      title: String(item.title || '').trim(),
      link,
      embedUrl
    })
  }
  if (!rooms.length) {
    const roomId =
      extractPublicBiliRoomId(legacy.publicBiliRoomId) ||
      extractPublicBiliRoomId(legacy.roomId) ||
      '390508'
    const link = String(legacy.publicBiliLink || '').trim() || `https://live.bilibili.com/${roomId}`
    rooms.push({
      roomId,
      title: String(legacy.publicBiliTitle || '').trim(),
      link,
      embedUrl: String(legacy.publicBiliEmbedUrl || '').trim() || defaultBiliEmbedUrl(roomId)
    })
  }
  return rooms
}

async function getLiveConfig() {
  try {
    const res = await db.collection(COLLECTIONS.LIVE_CONFIG).where({ _id: 'current' }).limit(1).get()
    const data = res.data?.[0] || { enabled: false }
    const publicBiliRooms = normalizePublicBiliRooms(data.publicBiliRooms, data)
    const first = publicBiliRooms[0] || {}
    return ok({
      enabled: !!data.enabled,
      roomId: data.roomId || '',
      platform: data.platform || '',
      title: data.title || '',
      coverUrl: data.coverUrl || '',
      streamUrl: data.streamUrl || '',
      // 公众网页（marsx 内容站）B 站直播
      publicBiliEnabled: data.publicBiliEnabled !== false,
      publicBiliRooms,
      publicBiliRoomId: first.roomId || data.publicBiliRoomId || data.roomId || '390508',
      publicBiliLink: first.link || data.publicBiliLink || '',
      publicBiliEmbedUrl: first.embedUrl || data.publicBiliEmbedUrl || '',
      publicBiliTitle: first.title || data.publicBiliTitle || '',
      updatedAt: data.updatedAt || null
    })
  } catch (e) {
    return ok({
      enabled: false,
      publicBiliEnabled: true,
      publicBiliRooms: [{ roomId: '390508', title: '', link: 'https://live.bilibili.com/390508', embedUrl: defaultBiliEmbedUrl('390508') }],
      publicBiliRoomId: '390508',
      publicBiliLink: '',
      publicBiliEmbedUrl: '',
      publicBiliTitle: ''
    })
  }
}

async function updateLiveConfig(body, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.LIVE_CONFIG).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || {}

  const pickStr = (key, fallback = '') =>
    body[key] !== undefined ? String(body[key] == null ? '' : body[key]) : String(before[key] || fallback)
  const pickBool = (key, fallback = false) => {
    if (body[key] !== undefined) return !!body[key]
    if (before[key] !== undefined) return !!before[key]
    return fallback
  }

  let publicBiliRooms
  if (body.publicBiliRooms !== undefined) {
    publicBiliRooms = normalizePublicBiliRooms(body.publicBiliRooms, {
      publicBiliRoomId: body.publicBiliRoomId,
      publicBiliLink: body.publicBiliLink,
      publicBiliEmbedUrl: body.publicBiliEmbedUrl,
      publicBiliTitle: body.publicBiliTitle,
      roomId: before.roomId
    })
  } else {
    publicBiliRooms = normalizePublicBiliRooms(before.publicBiliRooms, {
      ...before,
      publicBiliRoomId: body.publicBiliRoomId !== undefined ? body.publicBiliRoomId : before.publicBiliRoomId,
      publicBiliLink: body.publicBiliLink !== undefined ? body.publicBiliLink : before.publicBiliLink,
      publicBiliEmbedUrl: body.publicBiliEmbedUrl !== undefined ? body.publicBiliEmbedUrl : before.publicBiliEmbedUrl,
      publicBiliTitle: body.publicBiliTitle !== undefined ? body.publicBiliTitle : before.publicBiliTitle
    })
  }
  const first = publicBiliRooms[0] || { roomId: '390508', title: '', link: '', embedUrl: '' }

  const patch = {
    enabled: pickBool('enabled', false),
    roomId: pickStr('roomId'),
    platform: pickStr('platform'),
    title: pickStr('title'),
    coverUrl: pickStr('coverUrl'),
    streamUrl: pickStr('streamUrl'),
    publicBiliEnabled: pickBool('publicBiliEnabled', true),
    publicBiliRooms,
    publicBiliRoomId: first.roomId || '390508',
    publicBiliLink: first.link || '',
    publicBiliEmbedUrl: first.embedUrl || '',
    publicBiliTitle: first.title || '',
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: patch })
  await writeOpLog({ user, module: 'live_mgmt', action: 'upsert', targetId: id, before, after: patch })
  return ok(true)
}

// ========== 演示模式 ==========
async function getDemoConfig() {
  try {
    const res = await db.collection(COLLECTIONS.DEMO_MODE).doc('control').get()
    return ok(res.data || { active: false })
  } catch (e) {
    return ok({ active: false, scriptName: 'fullTour', liveOpenid: '', liveAccountOpenids: [] })
  }
}

async function updateDemoConfig(body, user) {
  const docId = 'control'
  const ref = db.collection(COLLECTIONS.DEMO_MODE).doc(docId)

  const patch = {
    active: !!body.active,
    scriptName: body.scriptName || 'fullTour',
    liveOpenid: body.liveOpenid || '',
    liveAccountOpenids: body.liveAccountOpenids || [],
    command: body.active ? 'standby' : 'stop',
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: patch })
  await writeOpLog({ user, module: 'live_mgmt', action: 'demo_config', targetId: docId, after: patch })
  return ok(true)
}

async function sendDemoCommand(body, user) {
  const docId = 'control'
  const ref = db.collection(COLLECTIONS.DEMO_MODE).doc(docId)

  const patch = {
    command: body.command || 'noop',
    scriptName: body.scriptName || '',
    step: typeof body.step === 'number' ? body.step : -1,
    commandAt: now(),
    commandBy: user.username
  }

  // 使用 update 只更新指令字段，不覆盖其他配置
  try {
    await ref.update({ data: patch })
  } catch (e) {
    // 文档不存在时用 set
    await ref.set({ data: { active: true, ...patch } })
  }

  await writeOpLog({ user, module: 'live_mgmt', action: 'demo_command', targetId: docId, after: patch })
  return ok(true)
}

async function getDemoAudioUrls(query) {
  const scriptName = (query && query.scriptName) || 'fullTour'
  const docId = `audio_${scriptName}`
  try {
    const res = await db.collection(COLLECTIONS.DEMO_MODE).doc(docId).get()
    return ok(res.data || { audioUrl: '', audioUrls: [] })
  } catch (e) {
    return ok({ audioUrl: '', audioUrls: [] })
  }
}

async function updateDemoAudioUrls(body, user) {
  const scriptName = body.scriptName || 'fullTour'
  const docId = `audio_${scriptName}`
  const ref = db.collection(COLLECTIONS.DEMO_MODE).doc(docId)

  const record = {
    scriptName,
    audioUrl: body.audioUrl || '',
    audioUrls: body.audioUrls || [],
    updatedAt: now(),
    updatedBy: user.username
  }

  await ref.set({ data: record })
  await writeOpLog({ user, module: 'live_mgmt', action: 'demo_audio', targetId: docId, after: record })
  return ok(true)
}

// ========== 云函数管理 ==========
async function listCloudFunctions() {
  const functions = [
    { name: 'adminGateway', desc: '后台管理网关', type: 'http' },
    { name: 'syncSpaceDevsData', desc: '发射数据同步', type: 'timer' },
    { name: 'syncSpaceXTweets', desc: 'SpaceX推文同步', type: 'timer' },
    { name: 'sendLaunchReminder', desc: '发射提醒推送', type: 'timer' },
    { name: 'publishBilibiliFromEvents', desc: 'B站事件入队（定时+推文同步触发）', type: 'timer' },
    { name: 'getLiveStatus', desc: '直播状态查询', type: 'callable' }
  ]
  return ok(functions)
}

async function triggerCloudFunction(name, user) {
  const allowed = ['syncSpaceDevsData', 'syncSpaceXTweets', 'sendLaunchReminder', 'publishBilibiliFromEvents']
  if (!allowed.includes(name)) return fail(4001, '不允许手动触发该云函数')

  try {
    cloud.callFunction({ name, data: { action: 'manual_trigger' } }).then(res => {
      writeOpLog({ user, module: 'cloud_functions', action: 'trigger', targetId: name, after: res.result || null }).catch(() => {})
    }).catch(() => {})
    return ok({ message: `云函数 ${name} 已触发` })
  } catch (e) {
    return fail(5001, `触发失败: ${e.message || String(e)}`)
  }
}

// ========== 弹窗广告配置 ==========
const POPUP_AD_CONFIG_ID = 'popup_ad_config'

async function getPopupAdConfig() {
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(POPUP_AD_CONFIG_ID).get()
    const config = res.data || {}
    // 如果有选中的商品 ID，查询商品详情一并返回
    let shopItems = []
    if (config.shopItemIds && config.shopItemIds.length > 0) {
      const shopRes = await db.collection(COLLECTIONS.SHOP_FEED)
        .where({ _id: _.in(config.shopItemIds) })
        .limit(50)
        .get()
      shopItems = shopRes.data || []
    }
    return ok({ config, shopItems })
  } catch (e) {
    return ok({ config: { enabled: false, triggerPages: [], dailyLimit: 1, shopItemIds: [], displayMode: 'random', delayMs: 1500 }, shopItems: [] })
  }
}

async function updatePopupAdConfig(body, user) {
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(POPUP_AD_CONFIG_ID)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  const patch = {
    enabled: !!body.enabled,
    triggerPages: Array.isArray(body.triggerPages) ? body.triggerPages.map(Number) : [],
    dailyLimit: Math.max(1, Math.min(10, Number(body.dailyLimit) || 1)),
    shopItemIds: Array.isArray(body.shopItemIds) ? body.shopItemIds : [],
    displayMode: body.displayMode === 'sequential' ? 'sequential' : 'random',
    delayMs: Math.max(500, Math.min(10000, Number(body.delayMs) || 1500)),
    newUserProtectDays: Math.max(0, Math.min(30, Number(body.newUserProtectDays) || 0)),
    updatedAt: now(),
    updatedBy: user.username
  }

  if (before) {
    await ref.update({ data: patch })
  } else {
    await ref.set({ data: { createdAt: now(), ...patch } })
  }
  await writeOpLog({ user, module: 'popup_ad', action: 'update_config', before, after: patch })
  return ok(true)
}

// ========== 全局配置中心 ==========
/**
 * 小程序首页轮播总开关读取的是 media_assets.__carousel_global_config__.enabled，
 * 与全局配置页的 enableCarousel 需保持一致。
 */
async function syncCarouselSwitchFromGlobalConfig(enabled, user) {
  const ts = now()
  const meta = { updatedAt: ts, updatedBy: user.username }
  const existing = await db.collection(COLLECTIONS.MEDIA_ASSETS)
    .where({ key: '__carousel_global_config__' })
    .limit(1).get()
  const on = enabled !== false
  if (existing.data && existing.data.length > 0) {
    await db.collection(COLLECTIONS.MEDIA_ASSETS).doc(existing.data[0]._id).update({
      data: { enabled: on, ...meta }
    })
  } else {
    await db.collection(COLLECTIONS.MEDIA_ASSETS).add({
      data: {
        key: '__carousel_global_config__',
        enabled: on,
        imageDuration: 5,
        videoDuration: 5,
        sourceTag: 'config',
        createdAt: ts,
        ...meta
      }
    })
  }
}

/**
 * 小程序开屏读取 starship_splash_config.current.enabled，
 * 与全局配置页的 enableSplash 需保持一致（仅同步开关，不改变素材等字段）。
 */
async function syncSplashSwitchFromGlobalConfig(enabled, user) {
  const id = 'current'
  const ref = db.collection(COLLECTIONS.STARSHIP_SPLASH).doc(id)
  const splashPatch = {
    enabled: enabled !== false,
    updatedAt: now(),
    updatedBy: user.username
  }
  const beforeSplash = await ref.get().catch(() => null)
  if (beforeSplash?.data) {
    await ref.update({ data: splashPatch })
  } else {
    await ref.set({
      data: {
        title: '',
        subtitle: '',
        animationUrl: '',
        coverUrl: '',
        showSkip: true,
        skipText: '跳过',
        mediaType: '',
        mediaUrl: '',
        countdownSeconds: 5,
        createdAt: now(),
        ...splashPatch
      }
    })
  }
}

async function getGlobalConfig() {
  let main = {}
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).where({ _id: 'main' }).limit(1).get()
    main = { ...(res.data?.[0] || {}) }
  } catch (e) {
    main = {}
  }

  // 与管理后台展示一致：以小程序实际读取的数据源为准（避免历史数据只改了 global_config）
  let enableCarousel = main.enableCarousel !== false
  try {
    const res = await db.collection(COLLECTIONS.MEDIA_ASSETS)
      .where({ key: '__carousel_global_config__' })
      .limit(1).get()
    const doc = (res.data || [])[0]
    if (doc) enableCarousel = doc.enabled !== false
  } catch (e) {}

  let enableSplash = main.enableSplash !== false
  try {
    const res = await db.collection(COLLECTIONS.STARSHIP_SPLASH).where({ _id: 'current' }).limit(1).get()
    const row = res.data?.[0]
    if (row && typeof row.enabled === 'boolean') enableSplash = row.enabled
    else if (row) enableSplash = row.enabled !== false
  } catch (e) {}

  return ok({ ...main, enableCarousel, enableSplash })
}

async function updateGlobalConfig(body, user) {
  const id = 'main'
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null

  const patch = {
    ...body,
    updatedAt: now(),
    updatedBy: user.username
  }
  delete patch._id

  // 必须用 update（字段合并）而不是 set（整文档替换）：
  // main 文档还挂着 proWhitelistOpenids / vpayConfig / newsManualArticlesEnabled 等
  // 不在全局配置表单里的字段，set 会把它们整个抹掉（PRO 白名单"经常掉"的根因）
  if (before) {
    await ref.update({ data: patch })
  } else {
    await ref.set({ data: { ...patch, createdAt: now() } })
  }

  if (Object.prototype.hasOwnProperty.call(body, 'enableCarousel')) {
    await syncCarouselSwitchFromGlobalConfig(body.enableCarousel, user)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'enableSplash')) {
    await syncSplashSwitchFromGlobalConfig(body.enableSplash, user)
  }

  await writeOpLog({ user, module: 'global_config', action: 'upsert', targetId: id, before, after: patch })
  return ok(true)
}

// ========== 年度报告（Year in Review）配置与快照 ==========
const YEAR_REVIEW_DOC_ID = 'current'

function defaultYearReviewConfig() {
  const y = new Date().getFullYear()
  return {
    enabled: false,
    year: y,
    visibleFromYmd: `${y}-12-15`,
    visibleToYmd: `${y + 1}-01-20`,
    title: '我的太空年鉴',
    subtitle: '回顾与你同行的发射与探索',
    introTemplate:
      '在 {{year}} 年，你累计签到 {{checkinDaysInYear}} 天（按云端当前保留的签到日期计算），在时间线留下 {{timelineEventCount}} 条探索印记。',
    outroTemplate: '新的一年，我们继续一起仰望同一片星空。',
    showPlatformStats: false,
    updatedAt: 0,
    updatedBy: ''
  }
}

function parseYmdToStartMsBeijing(ymd) {
  if (!ymd || typeof ymd !== 'string') return 0
  const t = new Date(`${ymd.trim()}T00:00:00+08:00`).getTime()
  return isNaN(t) ? 0 : t
}

function parseYmdToEndMsBeijing(ymd) {
  if (!ymd || typeof ymd !== 'string') return 0
  const t = new Date(`${ymd.trim()}T23:59:59.999+08:00`).getTime()
  return isNaN(t) ? 0 : t
}

function isYearReviewWindowOpen(raw) {
  const cfg = { ...defaultYearReviewConfig(), ...(raw || {}) }
  if (!cfg.enabled) return false
  const from = parseYmdToStartMsBeijing(cfg.visibleFromYmd) || 0
  const to = parseYmdToEndMsBeijing(cfg.visibleToYmd) || Number.MAX_SAFE_INTEGER
  const t = now()
  return t >= from && t <= to
}

async function getYearReviewConfigForAdmin() {
  try {
    const res = await db.collection(COLLECTIONS.ANNUAL_REPORT_CONFIG).doc(YEAR_REVIEW_DOC_ID).get()
    const data = res.data || null
    if (!data) return ok(defaultYearReviewConfig())
    return ok({ ...defaultYearReviewConfig(), ...data })
  } catch (e) {
    return ok(defaultYearReviewConfig())
  }
}

async function updateYearReviewConfigForAdmin(body, user) {
  const ref = db.collection(COLLECTIONS.ANNUAL_REPORT_CONFIG).doc(YEAR_REVIEW_DOC_ID)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  const base = { ...defaultYearReviewConfig(), ...(before || {}) }
  const allowed = [
    'enabled', 'year', 'visibleFromYmd', 'visibleToYmd',
    'title', 'subtitle', 'introTemplate', 'outroTemplate', 'showPlatformStats'
  ]
  const patch = { ...base }
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k]
  }
  patch.year = Math.max(2000, Math.min(2100, Number(patch.year) || new Date().getFullYear()))
  patch.enabled = !!patch.enabled
  patch.showPlatformStats = !!patch.showPlatformStats
  patch.updatedAt = now()
  patch.updatedBy = user.username
  // 合并后的对象可能含数据库返回的 _id，写入会触发「不能更新 _id」
  delete patch._id
  delete patch._openid
  await ref.set({ data: patch })
  await writeOpLog({ user, module: 'year_review', action: 'upsert', targetId: YEAR_REVIEW_DOC_ID, before, after: patch })
  return ok(patch)
}

/** 年度报告快照用：北京时间自然年起止毫秒 */
function beijingYearRangeMs(year) {
  const y = Number(year)
  const start = new Date(`${y}-01-01T00:00:00+08:00`).getTime()
  const end = new Date(`${y}-12-31T23:59:59.999+08:00`).getTime()
  return { start, end }
}

function docTimeMs(val) {
  if (val == null) return 0
  if (typeof val === 'number' && !isNaN(val)) return val
  if (val instanceof Date) return val.getTime()
  if (typeof val.getTime === 'function') return val.getTime()
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6)
  }
  const d = new Date(val)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/**
 * 资讯/事件文档是否落在报告自然年。
 * 后台入库时 publishedAt、date 常为「日期字符串」而非毫秒，与 _.gte(数字) 组合查询会得到 0 条。
 */
function newsRowInReportYear(row, year) {
  const yPrefix = String(year) + '-'
  const isYmdPrefix = (s) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.trim()) && s.trim().indexOf(yPrefix) === 0
  if (isYmdPrefix(row.publishedAt)) return true
  if (isYmdPrefix(row.date)) return true
  const { start, end } = beijingYearRangeMs(year)
  const t1 = docTimeMs(row.publishedAt)
  if (t1 > 0 && t1 >= start && t1 <= end) return true
  const t2 = docTimeMs(row.date)
  if (t2 > 0 && t2 >= start && t2 <= end) return true
  const t3 = docTimeMs(row.createdAt)
  if (t3 > 0 && t3 >= start && t3 <= end) return true
  return false
}

async function countNewsDocsInReportYear(collectionName, requirePublished, year) {
  let n = 0
  const wherePublished = requirePublished ? { published: true } : {}
  const processRows = (rows) => {
    for (const row of rows) {
      if (requirePublished && row.published !== true) continue
      if (newsRowInReportYear(row, year)) n++
    }
  }

  let skip = 0
  const batch = 200
  const maxScan = 5000
  try {
    while (skip < maxScan) {
      const res = await db
        .collection(collectionName)
        .where(wherePublished)
        .orderBy('updatedAt', 'desc')
        .skip(skip)
        .limit(batch)
        .get()
      const rows = res.data || []
      processRows(rows)
      if (rows.length === 0) break
      skip += rows.length
      if (rows.length < batch) break
    }
    return n
  } catch (e) {
    try {
      const res = await db.collection(collectionName).where(wherePublished).limit(1000).get()
      processRows(res.data || [])
      return n
    } catch (e2) {
      try {
        const res2 = await db.collection(collectionName).limit(800).get()
        processRows(res2.data || [])
        return n
      } catch (e3) {
        return null
      }
    }
  }
}

/** 与 userDataGateway 「已完成发射」缓存合并逻辑一致 */
function collectPreviousLaunchesFromCacheDocs(docs) {
  if (!docs || !docs.length) return []

  function isPreviousRelated(doc) {
    if (!doc) return false
    if (doc._id && String(doc._id).indexOf('/launches/previous/') !== -1) return true
    if (doc.cacheKey && String(doc.cacheKey).indexOf('launches_previous') !== -1) return true
    return false
  }

  function dedupeAppend(merged, seen, arr) {
    if (!Array.isArray(arr)) return
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i]
      const id = l.id || l.slug || ''
      const key = id || ('idx_' + merged.length)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(l)
    }
  }

  const related = docs.filter(isPreviousRelated)
  if (!related.length) return []

  const meta = related.find(d => d.isBatched === true && d.cacheKey && String(d.cacheKey).indexOf('_batch_') === -1)
  if (meta && meta.cacheKey && meta.totalBatches > 0) {
    const merged = []
    const seen = new Set()
    const base = meta.cacheKey
    for (let bi = 0; bi < meta.totalBatches; bi++) {
      const batchKey = base + '_batch_' + bi
      const batchDoc = related.find(x => x.cacheKey === batchKey)
      if (batchDoc && batchDoc.data && Array.isArray(batchDoc.data.results)) {
        dedupeAppend(merged, seen, batchDoc.data.results)
      }
    }
    if (merged.length > 0) return merged
  }

  const whole = related.find(d => d.isBatched !== true && d.data && Array.isArray(d.data.results) && d.data.results.length > 0)
  if (whole) return whole.data.results.slice()

  const fragments = related.filter(d => d.data && Array.isArray(d.data.results) && d.data.results.length > 0 &&
    d.cacheKey && String(d.cacheKey).indexOf('_batch_') !== -1)
  if (fragments.length > 0) {
    fragments.sort((a, b) => {
      const ia = parseInt(String(a.cacheKey).split('_batch_').pop() || '0', 10)
      const ib = parseInt(String(b.cacheKey).split('_batch_').pop() || '0', 10)
      return ia - ib
    })
    const merged = []
    const seen = new Set()
    for (let fi = 0; fi < fragments.length; fi++) {
      dedupeAppend(merged, seen, fragments[fi].data.results)
    }
    if (merged.length > 0) return merged
  }

  return []
}

/** 云库拉平的 space_devs_cache 行（兼容 doc({data:{cacheKey}}) 与根字段 cacheKey） */
function normalizeSpaceDevsCacheRow(row) {
  if (!row) return null
  if (row.cacheKey) return row
  if (row.data && typeof row.data === 'object' && row.data.cacheKey) {
    return { ...row.data, _id: row._id }
  }
  return row
}

function dedupeAppendByArticleId(merged, seen, arr) {
  if (!Array.isArray(arr)) return
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i]
    const id = x && x.id != null ? String(x.id) : ''
    const key = id || 'idx_' + merged.length
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(x)
  }
}

function dedupeAppendByEventId(merged, seen, arr) {
  if (!Array.isArray(arr)) return
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i]
    const id = x && x.id != null ? String(x.id) : ''
    const key = id || 'idx_' + merged.length
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(x)
  }
}

/**
 * 与 collectPreviousLaunchesFromCacheDocs 同源：合并主档 / batch 分片
 * pathNeedle 如 '/articles/' 或 '/events/upcoming/'
 */
function collectApiResultsFromCacheDocRows(rows, pathNeedle, dedupeAppend) {
  const list = (rows || []).map(normalizeSpaceDevsCacheRow).filter(Boolean)
  const related = list.filter((d) => {
    const s = String(d._id || '') + String(d.cacheKey || '')
    return s.indexOf(pathNeedle) !== -1
  })
  if (!related.length) return []

  const meta = related.find(
    (d) => d.isBatched === true && d.cacheKey && String(d.cacheKey).indexOf('_batch_') === -1
  )
  if (meta && meta.cacheKey && meta.totalBatches > 0) {
    const merged = []
    const seen = new Set()
    const base = meta.cacheKey
    for (let bi = 0; bi < meta.totalBatches; bi++) {
      const batchKey = base + '_batch_' + bi
      const batchDoc = related.find((x) => x.cacheKey === batchKey)
      if (batchDoc && batchDoc.data && Array.isArray(batchDoc.data.results)) {
        dedupeAppend(merged, seen, batchDoc.data.results)
      }
    }
    if (merged.length > 0) return merged
  }

  const whole = related.find(
    (d) => d.isBatched !== true && d.data && Array.isArray(d.data.results) && d.data.results.length > 0
  )
  if (whole) return whole.data.results.slice()

  const fragments = related.filter(
    (d) =>
      d.data &&
      Array.isArray(d.data.results) &&
      d.data.results.length > 0 &&
      d.cacheKey &&
      String(d.cacheKey).indexOf('_batch_') !== -1
  )
  if (fragments.length > 0) {
    fragments.sort((a, b) => {
      const ia = parseInt(String(a.cacheKey).split('_batch_').pop() || '0', 10)
      const ib = parseInt(String(b.cacheKey).split('_batch_').pop() || '0', 10)
      return ia - ib
    })
    const merged = []
    const seen = new Set()
    for (let fi = 0; fi < fragments.length; fi++) {
      dedupeAppend(merged, seen, fragments[fi].data.results)
    }
    if (merged.length > 0) return merged
  }

  return []
}

/** Spaceflight 文章 published_at 是否落在报告自然年（北京） */
function apiArticleInReportYear(a, year) {
  if (!a) return false
  const { start, end } = beijingYearRangeMs(year)
  const p = a.published_at
  const t = docTimeMs(p)
  if (t > 0) return t >= start && t <= end
  const yp = String(year) + '-'
  if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.trim()) && p.trim().indexOf(yp) === 0) return true
  return false
}

/** Space Devs 即将发生 event.date 是否落在报告自然年 */
function apiUpcomingEventInReportYear(ev, year) {
  if (!ev) return false
  const { start, end } = beijingYearRangeMs(year)
  const d = ev.date
  const t = docTimeMs(d)
  if (t > 0) return t >= start && t <= end
  const yp = String(year) + '-'
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.trim()) && d.trim().indexOf(yp) === 0) return true
  return false
}

async function fetchRecentSpaceDevsCacheRows() {
  try {
    const res = await db.collection('space_devs_cache').orderBy('updatedAt', 'desc').limit(500).get()
    return res.data || []
  } catch (e) {
    try {
      const res = await db.collection('space_devs_cache').limit(500).get()
      return res.data || []
    } catch (e2) {
      return []
    }
  }
}

function countApiArticlesInYearFromRows(rows, year) {
  const merged = collectApiResultsFromCacheDocRows(rows || [], '/articles/', dedupeAppendByArticleId)
  let n = 0
  const seen = new Set()
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i]
    if (!a || a.id == null) continue
    const key = String(a.id)
    if (seen.has(key)) continue
    if (!apiArticleInReportYear(a, year)) continue
    seen.add(key)
    n++
  }
  return n
}

function countApiUpcomingEventsInYearFromRows(rows, year) {
  const merged = collectApiResultsFromCacheDocRows(
    rows || [],
    '/events/upcoming/',
    dedupeAppendByEventId
  )
  let n = 0
  const seen = new Set()
  for (let i = 0; i < merged.length; i++) {
    const ev = merged[i]
    if (!ev || ev.id == null) continue
    const key = String(ev.id)
    if (seen.has(key)) continue
    if (!apiUpcomingEventInReportYear(ev, year)) continue
    seen.add(key)
    n++
  }
  return n
}

/** SpaceX 星舰体系任务（基于火箭名/任务名关键词，排除典型猎鹰任务） */
function isSpaceXStarshipMission(launch) {
  const providerName = launch.launch_service_provider ? (launch.launch_service_provider.name || '') : ''
  if (providerName !== 'SpaceX') return false
  const cfg = launch.rocket && launch.rocket.configuration
  const rocketName = ((cfg && (cfg.full_name || cfg.name)) || '').trim()
  const missionName = (launch.name || (launch.mission && launch.mission.name) || '').trim()
  const h = (rocketName + ' ' + missionName).toLowerCase()
  if (/\bfalcon\s*9\b|\bfalcon\s*heavy\b|\bdragon\b|crew\s*dragon|cargo\s*dragon|transporter-\d|starlink/i.test(h) &&
    !/starship|super\s*heavy|ship\s*\d+|booster\s*\d+/i.test(h)) {
    return false
  }
  return /starship|super\s*heavy|星舰|超重|integrated\s*flight|ift-|orbital\s*flight|ship\s*\d+|booster\s*\d+|starhopper|super\s*heavy/i.test(h)
}

async function rebuildYearReviewSnapshotAdmin(body, user) {
  const year = Math.max(2000, Math.min(2100, Number(body.year) || new Date().getFullYear()))
  const { start: bjStart, end: bjEnd } = beijingYearRangeMs(year)

  let totalUserProfiles = 0
  try {
    const c = await db.collection('user_profile').count()
    totalUserProfiles = c.total || 0
  } catch (e) {}

  let globalLaunchesInYear = null
  let spacexLaunchesInYear = null
  try {
    const lsRes = await db.collection('launch_stats').doc(`stats_${year}`).get()
    const raw = lsRes && lsRes.data
    const ls = raw && (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw)
    if (ls && typeof ls === 'object') {
      if (ls.globalThisYear != null) globalLaunchesInYear = Number(ls.globalThisYear)
      if (ls.spacexThisYear != null) spacexLaunchesInYear = Number(ls.spacexThisYear)
    }
  } catch (e) {}

  let spacexStarshipMissionsInYear = 0
  try {
    // 分批加载，每批50条，只提取必要字段以减少内存
    let offset = 0
    const batchSize = 50
    let hasMore = true
    while (hasMore) {
      const cacheRes = await db.collection('space_devs_cache').skip(offset).limit(batchSize).get()
      const docs = cacheRes.data || []
      if (docs.length === 0) { hasMore = false; break }
      const launches = collectPreviousLaunchesFromCacheDocs(docs)
      for (const launch of launches) {
        const netTime = launch.net ? new Date(launch.net).getTime() : 0
        if (!netTime || netTime < bjStart || netTime > bjEnd) continue
        if (isSpaceXStarshipMission(launch)) spacexStarshipMissionsInYear++
      }
      offset += batchSize
      if (docs.length < batchSize) hasMore = false
      if (offset >= 200) hasMore = false
    }
  } catch (e) {}

  let cmsArticles = await countNewsDocsInReportYear(COLLECTIONS.ARTICLES, true, year)
  let cmsEvents = await countNewsDocsInReportYear(COLLECTIONS.EVENTS, true, year)
  // 分批获取 space_devs_cache 用于新闻统计
  let newsArticlesInYear = cmsArticles != null ? cmsArticles : 0
  let newsEventsInYear = cmsEvents != null ? cmsEvents : 0
  try {
    let offset = 0
    const batchSize = 50
    let hasMore = true
    let apiArticles = 0
    let apiEvents = 0
    while (hasMore) {
      const res = await db.collection('space_devs_cache').skip(offset).limit(batchSize).get()
      const rows = res.data || []
      if (rows.length === 0) { hasMore = false; break }
      apiArticles += countApiArticlesInYearFromRows(rows, year)
      apiEvents += countApiUpcomingEventsInYearFromRows(rows, year)
      offset += batchSize
      if (rows.length < batchSize) hasMore = false
      if (offset >= 500) hasMore = false
    }
    newsArticlesInYear += apiArticles
    newsEventsInYear += apiEvents
  } catch (e) {}
  if (cmsArticles === null && newsArticlesInYear === 0) newsArticlesInYear = null
  if (cmsEvents === null && newsEventsInYear === 0) newsEventsInYear = null

  let tweetPostsInYear = null
  try {
    const tc = await db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES)
      .where({
        status: 'published',
        publishedAt: _.gte(bjStart).and(_.lte(bjEnd))
      })
      .count()
    tweetPostsInYear = tc.total || 0
  } catch (e) {
    try {
      const alt = await db.collection(COLLECTIONS.STARSHIP_EVENT_UPDATES)
        .where({ publishedAt: _.gte(bjStart).and(_.lte(bjEnd)) })
        .limit(500)
        .get()
      let n = 0
      for (const row of alt.data || []) {
        if ((row.status || '') !== 'published') continue
        const t = docTimeMs(row.publishedAt)
        if (t >= bjStart && t <= bjEnd) n++
      }
      tweetPostsInYear = n
    } catch (e2) {
      tweetPostsInYear = null
    }
  }

  let maxBoosterReuseCount = null
  let maxBoosterSerial = ''
  let maxBoosterRocketModel = ''
  try {
    // 分批加载助推器数据以减少内存
    let offset = 0
    const batchSize = 100
    let hasMore = true
    let best = null
    while (hasMore) {
      const bgRes = await db.collection('booster_genealogy').skip(offset).limit(batchSize).get()
      const rows = bgRes.data || []
      if (rows.length === 0) { hasMore = false; break }
      for (const row of rows) {
        const id = row._id
        if (!id || String(id).startsWith('_')) continue
        const payload = (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) ? row.data : row
        const flights = Number(payload.flights) || 0
        if (!best || flights > best.flights) {
          best = {
            flights,
            serialNumber: String(payload.serialNumber || id || '').trim(),
            rocketFamily: String(payload.rocketFamily || '').trim()
          }
        }
      }
      offset += batchSize
      if (rows.length < batchSize) hasMore = false
      if (offset >= 500) hasMore = false
    }
    if (best && best.flights > 0) {
      maxBoosterReuseCount = best.flights
      maxBoosterSerial = best.serialNumber
      maxBoosterRocketModel = best.rocketFamily || '—'
    }
  } catch (e) {}

  const snapshot = {
    year,
    totalUserProfiles,
    globalLaunchesInYear,
    spacexLaunchesInYear,
    spacexStarshipMissionsInYear,
    newsArticlesInYear,
    newsEventsInYear,
    tweetPostsInYear,
    maxBoosterReuseCount,
    maxBoosterSerial,
    maxBoosterRocketModel,
    generatedAt: now(),
    generatedBy: user.username
  }
  await db.collection(COLLECTIONS.ANNUAL_REPORT_SNAPSHOTS).doc(String(year)).set({ data: snapshot })
  await writeOpLog({ user, module: 'year_review', action: 'rebuild_snapshot', targetId: String(year), after: snapshot })
  return ok(snapshot)
}

// ========== 系统公告 ==========
async function listAnnouncements(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))

  try {
    const col = db.collection(COLLECTIONS.ANNOUNCEMENTS)
    const [countRes, listRes] = await Promise.all([
      col.count(),
      col.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
  } catch (e) {
    return ok({ list: [], total: 0, page, pageSize })
  }
}

async function createAnnouncement(body, user) {
  const ts = now()
  const payload = {
    title: body.title || '',
    content: body.content || '',
    type: body.type || 'info',
    active: body.active !== false,
    version: body.version || '',
    forceUpdate: !!body.forceUpdate,
    maintenance: !!body.maintenance,
    createdAt: ts,
    updatedAt: ts,
    createdBy: user.username
  }
  const res = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add({ data: payload })
  await writeOpLog({ user, module: 'announcements', action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function updateAnnouncement(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.ANNOUNCEMENTS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '公告不存在')

  const patch = pick(body, ['title', 'content', 'type', 'active', 'version', 'forceUpdate', 'maintenance'])
  patch.updatedAt = now()
  patch.updatedBy = user.username

  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'announcements', action: 'update', targetId: id, before: beforeRes.data, after: { ...beforeRes.data, ...patch } })
  return ok(true)
}

async function deleteAnnouncement(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.ANNOUNCEMENTS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '公告不存在')

  await ref.remove()
  await writeOpLog({ user, module: 'announcements', action: 'delete', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

// ========== 数据导出 ==========
async function exportCollectionData(body, user) {
  const collection = (body.collection || '').trim()
  if (!collection) return fail(4001, 'collection不能为空')

  const validCollections = [
    'space_devs_cache', COLLECTIONS.EVENTS, COLLECTIONS.ARTICLES, COLLECTIONS.MEDIA_ASSETS,
    COLLECTIONS.MEDIA_FEED, COLLECTIONS.SHOP_FEED, COLLECTIONS.STARSHIP_EVENT_UPDATES,
    COLLECTIONS.ROAD_CLOSURE, COLLECTIONS.LOGS,
    COLLECTIONS.PUSH_HISTORY, COLLECTIONS.ANNOUNCEMENTS
  ]
  if (!validCollections.includes(collection)) return fail(4001, '不支持导出该集合')

  const SENSITIVE_FIELDS = ['passwordHash', 'password', 'tokenVersion', 'pwdUpdatedAt']
  function stripSensitive(rows) {
    if (!Array.isArray(rows)) return rows
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      const clone = { ...row }
      SENSITIVE_FIELDS.forEach((f) => { delete clone[f] })
      return clone
    })
  }

  const limit = Math.min(1000, Math.max(1, Number(body.limit || 200)))
  const startAt = Number(body.startAt || 0)
  const endAt = Number(body.endAt || 0)

  let where = {}
  if (startAt || endAt) {
    if (startAt && endAt) where.createdAt = _.and([_.gte(startAt), _.lte(endAt)])
    else if (startAt) where.createdAt = _.gte(startAt)
    else where.createdAt = _.lte(endAt)
  }

  try {
    const res = await db.collection(collection).where(where).orderBy('createdAt', 'desc').limit(limit).get()
    const rows = stripSensitive(res.data || [])
    await writeOpLog({ user, module: 'data_export', action: 'export', targetId: collection, after: { count: rows.length, limit } })
    return ok({ data: rows, collection, count: rows.length })
  } catch (e) {
    return fail(5001, '导出失败: ' + (e.message || String(e)))
  }
}

// ========== 服务号 B 通道：自动发射提醒 opt-in ==========
const OA_AUTO_ALERT_USERS = 'oa_auto_alert_users'

async function findOaAlertUser(openid, unionid) {
  if (unionid) {
    const byUnion = await db.collection(OA_AUTO_ALERT_USERS).where({ unionid }).limit(1).get().catch(() => ({ data: [] }))
    if (byUnion.data && byUnion.data.length) return byUnion.data[0]
  }
  if (openid) {
    const byMp = await db.collection(OA_AUTO_ALERT_USERS).where({ mpOpenid: openid }).limit(1).get().catch(() => ({ data: [] }))
    if (byMp.data && byMp.data.length) return byMp.data[0]
  }
  return null
}

async function enableOaAlert(openid, unionid) {
  if (!openid) return fail(4001, '无法获取用户身份')
  if (!unionid) {
    return fail(4002, '需将小程序绑定微信开放平台后才能使用服务号提醒')
  }

  const nowTs = now()
  const existing = await findOaAlertUser(openid, unionid)
  const patch = {
    mpOpenid: openid,
    unionid,
    enabled: true,
    enabledAt: nowTs,
    updatedAt: nowTs
  }

  if (existing) {
    await db.collection(OA_AUTO_ALERT_USERS).doc(existing._id).update({ data: patch })
    const merged = { ...existing, ...patch }
    return ok({
      enabled: true,
      followed: !!merged.followed,
      ready: !!(merged.followed && merged.oaOpenid),
      oaOpenidBound: !!merged.oaOpenid
    })
  }

  await db.collection(OA_AUTO_ALERT_USERS).add({
    data: {
      oaOpenid: '',
      followed: false,
      createdAt: nowTs,
      ...patch
    }
  })
  return ok({ enabled: true, followed: false, ready: false, oaOpenidBound: false })
}

async function disableOaAlert(openid, unionid) {
  if (!openid) return fail(4001, '无法获取用户身份')
  const existing = await findOaAlertUser(openid, unionid)
  if (!existing) return ok({ enabled: false, followed: false, ready: false })

  await db.collection(OA_AUTO_ALERT_USERS).doc(existing._id).update({
    data: { enabled: false, disabledAt: now(), updatedAt: now() }
  })
  return ok({ enabled: false, followed: !!existing.followed, ready: false })
}

async function getOaAlertStatus(openid, unionid) {
  if (!openid) return fail(4001, '无法获取用户身份')
  const existing = await findOaAlertUser(openid, unionid)
  if (!existing) {
    return ok({
      enabled: false,
      followed: false,
      ready: false,
      hasUnionid: !!unionid,
      message: unionid ? '请先关注服务号并开启提醒' : '需绑定微信开放平台'
    })
  }
  const ready = !!(existing.enabled && existing.followed && existing.oaOpenid)
  return ok({
    enabled: !!existing.enabled,
    followed: !!existing.followed,
    ready,
    hasUnionid: !!unionid,
    oaOpenidBound: !!existing.oaOpenid,
    message: ready
      ? '已就绪，发射前30分钟微信将自动推送'
      : existing.enabled && !existing.followed
        ? '已开启开关，请先关注服务号「火星探索日志」'
        : existing.enabled && !existing.oaOpenid
          ? '已开启开关，等待服务号身份同步（关注后约1分钟生效）'
          : '未开启'
  })
}

// ========== 发射提醒订阅（防重复） ==========
async function subscribeLaunchReminder(body, openid) {
  const { missionId } = body || {}
  if (!missionId) return fail(4001, 'missionId 不能为空')
  if (!openid) return fail(4001, '无法获取用户身份')

  const col = 'launch_subscriptions'
  // 检查是否已有该用户对此任务的未发送订阅
  const existing = await db.collection(col).where({
    _openid: openid,
    missionId: String(missionId),
    sent: false
  }).limit(1).get().catch(() => ({ data: [] }))

  const notifyLeadMinutes =
    typeof body.notifyLeadMinutes === 'number' &&
    body.notifyLeadMinutes > 0 &&
    body.notifyLeadMinutes < 720
      ? Math.round(body.notifyLeadMinutes)
      : 30

  const subPayload = {
    missionName: (body.missionName || '未知任务').substring(0, 20),
    rocketName: (body.rocketName || '未知火箭').substring(0, 20),
    launchTime: body.launchTime || '',
    launchTimeFormatted: body.launchTimeFormatted || '',
    recoveryMethod: (body.recoveryMethod || '一次性').substring(0, 20),
    notifyAt: Number(body.notifyAt) || 0,
    notifyLeadMinutes: notifyLeadMinutes,
    templateId: body.templateId || '',
    // 结果通知：用户同时授权「任务完成提醒」时记 1 次额度
    resultTemplateId: body.resultTemplateId || '',
    resultQuota: body.resultQuota === true || body.resultQuota === 1 ? 1 : 0,
    resultSent: false,
    updatedAt: Date.now()
  }

  if (existing.data && existing.data.length > 0) {
    const docId = existing.data[0]._id
    const prev = existing.data[0] || {}
    // 再次授权结果模板时累加额度（一次性订阅可多次授权）
    if (subPayload.resultQuota > 0) {
      subPayload.resultQuota = Math.min(5, (Number(prev.resultQuota) || 0) + 1)
    } else {
      subPayload.resultQuota = Number(prev.resultQuota) || 0
      subPayload.resultTemplateId = prev.resultTemplateId || subPayload.resultTemplateId
    }
    if (prev.resultSent) subPayload.resultSent = true
    await db.collection(col).doc(docId).update({ data: subPayload })
    return ok({ subscribed: true, duplicate: true, updated: true })
  }

  await db.collection(col).add({
    data: {
      _openid: openid,
      missionId: String(missionId),
      ...subPayload,
      sent: false,
      reminderSent: false,
      resultSent: false,
      createdAt: Date.now()
    }
  })
  return ok({ subscribed: true, duplicate: false })
}

async function checkSubscription(missionId, openid) {
  if (!missionId || !openid) return ok({ subscribed: false })
  const col = 'launch_subscriptions'
  const res = await db.collection(col).where({
    _openid: openid,
    missionId: String(missionId),
    sent: false
  }).limit(1).get().catch(() => ({ data: [] }))
  return ok({ subscribed: !!(res.data && res.data.length > 0) })
}

async function listMySubscriptions(openid) {
  if (!openid) return fail(4001, '无法获取用户身份')
  const col = 'launch_subscriptions'
  try {
    const res = await db.collection(col).where({
      _openid: openid,
      sent: false
    }).orderBy('createdAt', 'desc').limit(50).get()

    const list = (res.data || []).map(d => ({
      missionId: d.missionId,
      missionName: d.missionName || '',
      rocketName: d.rocketName || '',
      launchTime: d.launchTime || '',
      recoveryMethod: d.recoveryMethod || '',
      createdAt: d.createdAt || 0
    }))
    return ok({ list })
  } catch (e) {
    return fail(5001, '查询订阅列表失败')
  }
}

async function cancelSubscription(missionId, openid) {
  if (!missionId || !openid) return fail(4001, '参数不完整')
  const col = 'launch_subscriptions'
  try {
    const res = await db.collection(col).where({
      _openid: openid,
      missionId: String(missionId)
    }).get()

    if (res.data && res.data.length > 0) {
      const ids = res.data.map(d => d._id)
      for (const docId of ids) {
        await db.collection(col).doc(docId).remove()
      }
    }
    return ok({ cancelled: true, count: (res.data || []).length })
  } catch (e) {
    return fail(5001, '取消订阅失败')
  }
}

// ========== 发射竞猜投票 ==========
const VOTE_TIME_TOLERANCE_MS = 30 * 60 * 1000

function normalizeVoteType(t) {
  return String(t || '').trim() === 'outcome' ? 'outcome' : 'ontime'
}

function voteMainDocId(launchId, voteType) {
  const base = String(launchId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return normalizeVoteType(voteType) === 'outcome' ? `vote_outcome_${base}` : `vote_${base}`
}

function voteUserRecordId(launchId, openid, voteType) {
  const raw = normalizeVoteType(voteType) === 'outcome'
    ? `${launchId}_outcome_${openid}`
    : `${launchId}_${openid}`
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** 成败竞猜结算：成功/载荷部署 → success；失败/部分失败/取消等 → failure */
function computeOutcomeResult(statusCategory, statusAbbrev, statusName) {
  const cat = String(statusCategory || '').toLowerCase().trim()
  const text = `${statusAbbrev || ''} ${statusName || ''}`.toLowerCase()
  if (cat === 'success' || cat === 'deployed') return 'success'
  if (cat === 'failure' || cat === 'partial') return 'failure'
  if (/payload\s*deployed|success/.test(text) && !/partial|failure|fail/.test(text)) return 'success'
  if (/partial\s*failure|failure|fail|cancel|scrub|abort/.test(text)) return 'failure'
  return ''
}

/** 成败问题文案：跟全局配置；历史写死的长默认视为未配置 */
function pickOutcomeQuestion(recordQuestion, globalQuestion) {
  const globalQ = String(globalQuestion || '').trim() || '会成功吗？'
  const recordQ = String(recordQuestion || '').trim()
  if (!recordQ) return globalQ
  if (recordQ === '本次发射会成功吗？') return globalQ
  return recordQ
}

async function findLaunchVoteDoc(launchId, voteType) {
  const col = COLLECTIONS.LAUNCH_VOTES
  const vt = normalizeVoteType(voteType)
  const docId = voteMainDocId(launchId, vt)
  try {
    const byId = await db.collection(col).doc(docId).get()
    if (byId && byId.data) {
      if (vt === 'outcome') return { ...byId.data, _id: byId.data._id || docId }
      if (byId.data.voteType !== 'outcome') return { ...byId.data, _id: byId.data._id || docId }
    }
  } catch (e) {}
  try {
    if (vt === 'outcome') {
      const q = await db.collection(col).where({ launchId, voteType: 'outcome' }).limit(1).get()
      return (q.data && q.data[0]) || null
    }
    const q = await db.collection(col).where({ launchId }).limit(10).get()
    const list = (q.data || []).filter((d) => d.voteType !== 'outcome')
    return list[0] || null
  } catch (e) {
    return null
  }
}

function parseVoteTimeMs(t) {
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function voteTimesDiffer(a, b, toleranceMs = VOTE_TIME_TOLERANCE_MS) {
  const am = parseVoteTimeMs(a)
  const bm = parseVoteTimeMs(b)
  if (!am || !bm) return false
  return Math.abs(am - bm) > toleranceMs
}

function getVoteRoundBaseline(vote) {
  const currentRound = vote.currentRound || 1
  const rounds = vote.rounds || []
  const roundInfo = rounds.find(r => r.round === currentRound)
  if (roundInfo && roundInfo.launchTime) return roundInfo.launchTime
  if (vote.lockedLaunchTime) return vote.lockedLaunchTime
  return vote.launchTime || ''
}

function upsertVoteRound(rounds, roundNum, patch) {
  const next = Array.isArray(rounds) ? rounds.slice() : []
  const idx = next.findIndex(r => r.round === roundNum)
  const entry = { round: roundNum, launchTime: '', result: '', settledAt: '', ...(idx >= 0 ? next[idx] : {}), ...patch }
  if (idx >= 0) next[idx] = entry
  else next.push(entry)
  return next
}

function isLaunchTerminalStatus(found) {
  const abbrev = (found && found.status && found.status.abbrev) || ''
  const name = (found && found.status && found.status.name) || ''
  return /success|failure|partial failure|partial|cancel|scrub|abort|hold/i.test(abbrev) ||
    /cancel|scrub|abort/i.test(name)
}

function computeVoteRoundResult(baselineTime, actualTime, statusAbbrev, statusName) {
  if (/cancel|scrub|abort/i.test(statusAbbrev) || /cancel|scrub|abort/i.test(statusName)) {
    return 'ge'
  }
  if (actualTime) {
    const diffMs = Math.abs(parseVoteTimeMs(actualTime) - parseVoteTimeMs(baselineTime))
    return diffMs > VOTE_TIME_TOLERANCE_MS ? 'ge' : 'buge'
  }
  return 'buge'
}

/** 任务改期：以当前轮基准时间判「鸽」，递增轮次并解封 */
function buildPostponeRolloverPatch(vote, latestTime) {
  const currentRound = vote.currentRound || 1
  const baseline = getVoteRoundBaseline(vote)
  const rounds = upsertVoteRound(vote.rounds, currentRound, {
    launchTime: baseline,
    result: 'ge',
    settledAt: now()
  })
  return {
    rounds,
    currentRound: currentRound + 1,
    result: '',
    resultNote: '',
    settledAt: '',
    votingClosed: false,
    lockedLaunchTime: '',
    launchTime: latestTime || vote.launchTime || baseline,
    updatedAt: now()
  }
}

function detectVotePostponement(vote, latestTime, found) {
  const baseline = getVoteRoundBaseline(vote)
  if (!baseline || !latestTime) return false
  if (voteTimesDiffer(baseline, latestTime)) return true
  const baselineMs = parseVoteTimeMs(baseline)
  const latestMs = parseVoteTimeMs(latestTime)
  const nowMs = Date.now()
  if (baselineMs > 0 && nowMs - baselineMs > VOTE_TIME_TOLERANCE_MS && latestMs > nowMs + VOTE_TIME_TOLERANCE_MS) {
    if (!found || !isLaunchTerminalStatus(found)) return true
  }
  return false
}

async function castOutcomeVote(body, openid) {
  const { launchId, choice } = body || {}
  if (!launchId || !['success', 'failure'].includes(choice)) {
    return fail(4001, '参数错误：需要 launchId 和 choice(success/failure)')
  }
  const col = COLLECTIONS.LAUNCH_VOTES
  const voteType = 'outcome'
  const voteRecord = await findLaunchVoteDoc(launchId, voteType)
  const knownLaunchTime = (voteRecord && voteRecord.launchTime) || body.launchTime || ''

  if (voteRecord && voteRecord.enabled === false) {
    return fail(4003, '该场成败竞猜已关闭')
  }
  if (!voteRecord) {
    try {
      const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
      if (gcRes.data && gcRes.data.outcomeEnabled === false) {
        return fail(4003, '成败竞猜未开放')
      }
    } catch (e) {}
  }

  if (voteRecord && voteRecord.result) {
    return fail(4003, '该场成败竞猜已结算，无法再投票')
  }

  if (knownLaunchTime) {
    const lt = new Date(knownLaunchTime).getTime()
    const timeToLaunch = lt - Date.now()
    if (lt > 0 && timeToLaunch >= 0 && timeToLaunch < 30 * 60 * 1000) {
      return fail(4003, '距发射不足30分钟，竞猜已关闭')
    }
  }
  if (voteRecord && voteRecord.votingClosed && !voteRecord.result) {
    return fail(4003, '距发射不足30分钟，竞猜已关闭')
  }

  const voteRecordCol = 'launch_vote_records'
  if (openid) {
    const dupCheck = await db.collection(voteRecordCol).where({
      launchId,
      openid,
      voteType: 'outcome'
    }).limit(1).get().catch(() => ({ data: [] }))
    if (dupCheck.data && dupCheck.data.length > 0) {
      const vr = voteRecord || {}
      return ok({
        ...vr,
        myVote: dupCheck.data[0].choice,
        voteType,
        geCount: Number(vr.failureCount || 0),
        buGeCount: Number(vr.successCount || 0),
        geLabel: vr.failureLabel || '失败',
        bugeLabel: vr.successLabel || '成功',
        failureLabel: vr.failureLabel || '失败',
        successLabel: vr.successLabel || '成功'
      })
    }
  }

  let labels = {
    customQuestion: '会成功吗？',
    successLabel: '成功',
    failureLabel: '失败'
  }
  try {
    const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
    if (gcRes.data) {
      labels.customQuestion = gcRes.data.outcomeQuestion || labels.customQuestion
      labels.successLabel = gcRes.data.successLabel || labels.successLabel
      labels.failureLabel = gcRes.data.failureLabel || labels.failureLabel
    }
  } catch (e) {}

  if (openid) {
    const rid = voteUserRecordId(launchId, openid, voteType)
    try {
      await db.collection(voteRecordCol).add({
        data: {
          _id: rid,
          launchId,
          openid,
          voteType,
          choice,
          round: 1,
          launchTimeAtVote: body.launchTime || knownLaunchTime || '',
          createdAt: now()
        }
      })
    } catch (addErr) {
      const existing = await findLaunchVoteDoc(launchId, voteType)
      const ex = existing || {}
      return ok({
        ...ex,
        myVote: choice,
        voteType,
        geCount: Number(ex.failureCount || 0),
        buGeCount: Number(ex.successCount || 0),
        geLabel: ex.failureLabel || labels.failureLabel,
        bugeLabel: ex.successLabel || labels.successLabel,
        failureLabel: ex.failureLabel || labels.failureLabel,
        successLabel: ex.successLabel || labels.successLabel
      })
    }
  }

  const field = choice === 'success' ? 'successCount' : 'failureCount'
  const mainId = voteMainDocId(launchId, voteType)
  if (!voteRecord) {
    const doc = {
      _id: mainId,
      launchId,
      voteType,
      missionName: body.missionName || '',
      rocketName: body.rocketName || '',
      launchTime: body.launchTime || '',
      successCount: choice === 'success' ? 1 : 0,
      failureCount: choice === 'failure' ? 1 : 0,
      customQuestion: labels.customQuestion,
      successLabel: labels.successLabel,
      failureLabel: labels.failureLabel,
      enabled: true,
      result: '',
      resultNote: '',
      currentRound: 1,
      rounds: [],
      createdAt: now(),
      updatedAt: now()
    }
    try {
      await db.collection(col).add({ data: doc })
      return ok({
        ...doc,
        myVote: choice,
        voteType,
        geCount: Number(doc.failureCount || 0),
        buGeCount: Number(doc.successCount || 0),
        geLabel: doc.failureLabel || labels.failureLabel,
        bugeLabel: doc.successLabel || labels.successLabel
      })
    } catch (createErr) {
      // 并发创建后走自增
    }
  }

  const backfill = {}
  if (voteRecord) {
    if (!voteRecord.missionName && body.missionName) backfill.missionName = body.missionName
    if (!voteRecord.rocketName && body.rocketName) backfill.rocketName = body.rocketName
    if (!voteRecord.launchTime && body.launchTime) backfill.launchTime = body.launchTime
  }
  const targetId = (voteRecord && voteRecord._id) || mainId
  await db.collection(col).doc(targetId).update({
    data: { [field]: db.command.inc(1), updatedAt: now(), voteType, ...backfill }
  }).catch(async () => {
    await db.collection(col).where({ launchId, voteType: 'outcome' }).update({
      data: { [field]: db.command.inc(1), updatedAt: now(), ...backfill }
    })
  })
  const updated = await findLaunchVoteDoc(launchId, voteType)
  const record = updated || {}
  if (!record.successLabel) record.successLabel = labels.successLabel
  if (!record.failureLabel) record.failureLabel = labels.failureLabel
  record.customQuestion = pickOutcomeQuestion(record.customQuestion, labels.customQuestion)
  return ok({
    ...record,
    myVote: choice,
    voteType,
    customQuestion: record.customQuestion,
    geCount: Number(record.failureCount || 0),
    buGeCount: Number(record.successCount || 0),
    geLabel: record.failureLabel || labels.failureLabel,
    bugeLabel: record.successLabel || labels.successLabel
  })
}

async function getOutcomeVoteStats(launchId, openid, query) {
  const q = query || {}
  const currentLaunchTime = q.currentLaunchTime || ''
  const missionStatus = q.missionStatus || ''
  const statusCategory = q.statusCategory || ''
  const statusAbbrev = q.statusAbbrev || ''
  const statusName = q.statusName || ''

  const [myRecord, voteRecord] = await Promise.all([
    openid
      ? db.collection('launch_vote_records').where({ launchId, openid, voteType: 'outcome' }).limit(1).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    findLaunchVoteDoc(launchId, 'outcome')
  ])

  let myVote = ''
  if (myRecord.data && myRecord.data[0]) myVote = myRecord.data[0].choice || ''

  let labels = {
    customQuestion: '会成功吗？',
    successLabel: '成功',
    failureLabel: '失败',
    enabled: false
  }
  try {
    const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
    if (gcRes.data) {
      const gc = gcRes.data
      labels.enabled = gc.outcomeEnabled !== false
      labels.customQuestion = gc.outcomeQuestion || labels.customQuestion
      labels.successLabel = gc.successLabel || labels.successLabel
      labels.failureLabel = gc.failureLabel || labels.failureLabel
    }
  } catch (e) {}

  if (!voteRecord) {
    return ok({
      launchId,
      voteType: 'outcome',
      successCount: 0,
      failureCount: 0,
      geCount: 0,
      buGeCount: 0,
      enabled: labels.enabled,
      votingClosed: false,
      customQuestion: labels.customQuestion,
      successLabel: labels.successLabel,
      failureLabel: labels.failureLabel,
      geLabel: labels.failureLabel,
      bugeLabel: labels.successLabel,
      result: '',
      myVote,
      _fromGlobal: true
    })
  }

  const record = { ...voteRecord, voteType: 'outcome' }
  if (!record.successLabel) record.successLabel = labels.successLabel
  if (!record.failureLabel) record.failureLabel = labels.failureLabel
  // 历史投票文档可能快照了旧默认「本次发射会成功吗？」，展示时跟全局配置
  record.customQuestion = pickOutcomeQuestion(record.customQuestion, labels.customQuestion)

  // 前端兼容：失败映射到左侧 ge 样式，成功映射到右侧 buge 样式
  record.geCount = Number(record.failureCount || 0)
  record.buGeCount = Number(record.successCount || 0)
  record.geLabel = record.failureLabel
  record.bugeLabel = record.successLabel

  const effectiveLaunchTime = currentLaunchTime || record.launchTime || ''
  if (currentLaunchTime && currentLaunchTime !== record.launchTime) {
    try {
      await db.collection(COLLECTIONS.LAUNCH_VOTES).doc(record._id).update({
        data: { launchTime: currentLaunchTime, updatedAt: now() }
      })
      record.launchTime = currentLaunchTime
    } catch (e) {}
  }

  // 自动结算：任务完成或状态已终态
  let autoResult = ''
  if (!record.result) {
    autoResult = computeOutcomeResult(statusCategory, statusAbbrev, statusName)
    if (!autoResult && missionStatus === 'completed') {
      autoResult = computeOutcomeResult(statusCategory || 'failure', statusAbbrev, statusName) || 'failure'
    }
    if (autoResult) {
      try {
        await db.collection(COLLECTIONS.LAUNCH_VOTES).doc(record._id).update({
          data: {
            result: autoResult,
            resultNote: '系统按发射状态自动结算',
            settledAt: now(),
            votingClosed: true,
            updatedAt: now()
          }
        })
        record.result = autoResult
        record.resultNote = '系统按发射状态自动结算'
        record.votingClosed = true
      } catch (e) {}
    }
  }

  let votingClosed = !!record.votingClosed || !!record.result
  let votingClosedReason = record.result ? 'settled' : ''
  if (!votingClosed && effectiveLaunchTime) {
    const lt = parseVoteTimeMs(effectiveLaunchTime)
    if (lt > 0) {
      const timeToLaunch = lt - Date.now()
      if (timeToLaunch >= 0 && timeToLaunch < VOTE_TIME_TOLERANCE_MS) {
        votingClosed = true
        votingClosedReason = 'time'
      }
    }
  }

  return ok({
    ...record,
    enabled: record.enabled !== false,
    votingClosed,
    votingClosedReason,
    myVote,
    voteType: 'outcome',
    geCount: Number(record.failureCount || 0),
    buGeCount: Number(record.successCount || 0),
    geLabel: record.failureLabel || '失败',
    bugeLabel: record.successLabel || '成功'
  })
}

async function castVote(body, openid) {
  if (normalizeVoteType(body && body.voteType) === 'outcome') {
    return castOutcomeVote(body, openid)
  }
  const { launchId, choice } = body || {}
  if (!launchId || !['ge', 'buge'].includes(choice)) return fail(4001, '参数错误：需要 launchId 和 choice(ge/buge)')
  const col = COLLECTIONS.LAUNCH_VOTES

  // 查询该任务的投票主记录（准时竞猜，排除成败）
  let voteRecord = await findLaunchVoteDoc(launchId, 'ontime')
  const currentRound = (voteRecord && voteRecord.currentRound) || 1
  const knownLaunchTime = (voteRecord && voteRecord.launchTime) || body.launchTime || ''

  // 已结算场次禁止投票（含清除过竞猜记录后的重投：结果已出，投票无意义且可刷战绩）
  // 改期重开新轮次时 result 会被清空并 currentRound+1，不受此拦截影响
  if (voteRecord && voteRecord.result) {
    return fail(4003, '该场竞猜已结算，无法再投票')
  }

  // T-30min 校验（仅在发射时间未过时生效；时间已过但未结算说明推迟了，允许投票）
  if (knownLaunchTime) {
    const lt = new Date(knownLaunchTime).getTime()
    const timeToLaunch = lt - Date.now()
    if (lt > 0 && timeToLaunch >= 0 && timeToLaunch < 30 * 60 * 1000) return fail(4003, '距发射不足30分钟，竞猜已关闭')
  }

  // 封盘后因改期解封：旧轮次结算为「鸽」，开启新轮次
  if (voteRecord && voteRecord.votingClosed && !voteRecord.result) {
    const lt = knownLaunchTime ? new Date(knownLaunchTime).getTime() : 0
    const timeToLaunch = lt > 0 ? lt - Date.now() : 0
    if (lt > 0 && (timeToLaunch < 0 || timeToLaunch >= 30 * 60 * 1000)) {
      const patch = buildPostponeRolloverPatch(voteRecord, body.launchTime || knownLaunchTime)
      await db.collection(col).doc(voteRecord._id).update({ data: patch })
      voteRecord = { ...voteRecord, ...patch }
    } else {
      return fail(4003, '距发射不足30分钟，竞猜已关闭')
    }
  }

  // 去重检查：一个用户对同一任务只能投一次（不论轮次）
  const voteRecordCol = 'launch_vote_records'
  if (openid) {
    const dupCheck = await db.collection(voteRecordCol).where({ launchId, openid: openid }).limit(5).get().catch((e) => {
      console.error('[castVote] dupCheck query error:', e.message || String(e))
      return { data: [] }
    })
    const ontimeDup = (dupCheck.data || []).find((r) => r.voteType !== 'outcome')
    if (ontimeDup) {
      const existing = await findLaunchVoteDoc(launchId, 'ontime')
      const record = existing || { geCount: 0, buGeCount: 0 }
      return ok({ ...record, myVote: ontimeDup.choice, voteType: 'ontime' })
    }
  }

  // 读取全局配置标签
  let globalLabels = { geLabel: '鸽', bugeLabel: '不鸽', customQuestion: '' }
  try {
    const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
    if (gcRes.data) {
      globalLabels.geLabel = gcRes.data.geLabel || '鸽'
      globalLabels.bugeLabel = gcRes.data.bugeLabel || '不鸽'
      globalLabels.customQuestion = gcRes.data.customQuestion || ''
    }
  } catch (e) {}

  // 重新读取最新轮次（可能刚被上面的解封逻辑更新）
  let latestRound = currentRound
  if (voteRecord) {
    const freshDoc = await findLaunchVoteDoc(launchId, 'ontime')
    if (freshDoc) latestRound = freshDoc.currentRound || 1
  }

  // 原子去重写入：用确定性 _id 作为并发护栏，写入成功才计数（保证每用户每任务只计一次）
  if (openid) {
    const voteRecordId = voteUserRecordId(launchId, openid, 'ontime')
    try {
      await db.collection(voteRecordCol).add({
        data: {
          _id: voteRecordId,
          launchId,
          openid: openid,
          voteType: 'ontime',
          choice,
          round: latestRound,
          launchTimeAtVote: body.launchTime || knownLaunchTime || '',
          createdAt: now()
        }
      })
    } catch (addErr) {
      // 并发或重复投票：已存在投票记录，直接返回当前统计
      const existing = await findLaunchVoteDoc(launchId, 'ontime')
      const record = existing || { geCount: 0, buGeCount: 0 }
      return ok({ ...record, myVote: choice, voteType: 'ontime' })
    }
  }

  // 查找/创建投票主记录（首建用确定性 _id，避免并发重复建主记录）
  const field = choice === 'ge' ? 'geCount' : 'buGeCount'
  const existing = voteRecord
  if (!existing) {
    const mainId = voteMainDocId(launchId, 'ontime')
    const doc = {
      _id: mainId,
      launchId,
      voteType: 'ontime',
      missionName: body.missionName || '',
      rocketName: body.rocketName || '',
      launchTime: body.launchTime || '',
      geCount: choice === 'ge' ? 1 : 0,
      buGeCount: choice === 'buge' ? 1 : 0,
      customQuestion: globalLabels.customQuestion,
      geLabel: globalLabels.geLabel,
      bugeLabel: globalLabels.bugeLabel,
      enabled: true,
      result: '',
      resultNote: '',
      currentRound: 1,
      rounds: [],
      createdAt: now(),
      updatedAt: now()
    }
    try {
      await db.collection(col).add({ data: doc })
      return ok({ ...doc, geCount: doc.geCount, buGeCount: doc.buGeCount, voteType: 'ontime' })
    } catch (createErr) {
      // 并发下已被另一个请求创建：转为原子自增
    }
  }
  // 原子自增；主记录首建时可能缺任务名/火箭名（如首个投票者未传），后续投票携带时顺带回填
  const mainRec = existing
  const backfill = {}
  if (mainRec) {
    if (!mainRec.missionName && body.missionName) backfill.missionName = body.missionName
    if (!mainRec.rocketName && body.rocketName) backfill.rocketName = body.rocketName
    if (!mainRec.launchTime && body.launchTime) backfill.launchTime = body.launchTime
  }
  if (mainRec && mainRec._id) {
    await db.collection(col).doc(mainRec._id).update({
      data: { [field]: db.command.inc(1), updatedAt: now(), voteType: 'ontime', ...backfill }
    })
  } else {
    await db.collection(col).where({ launchId }).update({
      data: { [field]: db.command.inc(1), updatedAt: now(), ...backfill }
    })
  }
  const updated = await findLaunchVoteDoc(launchId, 'ontime')
  const record = updated || {}
  if (!record.geLabel) record.geLabel = globalLabels.geLabel
  if (!record.bugeLabel) record.bugeLabel = globalLabels.bugeLabel
  if (!record.customQuestion) record.customQuestion = globalLabels.customQuestion
  return ok({ ...record, voteType: 'ontime' })
}

// ========== 竞猜全局配置 ==========
const VOTE_CONFIG_ID = '__vote_global_config__'

async function getVoteStats(launchId, openid, query) {
  if (!launchId) return fail(4001, 'launchId 不能为空')
  const q = query || {}
  if (normalizeVoteType(q.voteType) === 'outcome') {
    return getOutcomeVoteStats(launchId, openid, q)
  }
  // 前端传入的最新发射时间和任务状态
  const currentLaunchTime = q.currentLaunchTime || ''
  const missionStatus = q.missionStatus || '' // 'completed' 表示已完成（历史任务）

  // 「我的投票」与「票数统计」互不依赖，并行查询减少串行等待
  const [myRecordRaw, voteRecord] = await Promise.all([
    openid
      ? db.collection('launch_vote_records').where({ launchId, openid: openid }).limit(5).get().catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    findLaunchVoteDoc(launchId, 'ontime')
  ])

  let myVote = ''
  let myRound = 0
  const myOntime = (myRecordRaw.data || []).find((r) => r.voteType !== 'outcome')
  if (myOntime) {
    myVote = myOntime.choice || ''
    myRound = myOntime.round || 1
  }
  const res = { data: voteRecord ? [voteRecord] : [] }
  if (res.data && res.data.length > 0) {
    const record = res.data[0]
    if (!record.geLabel || !record.bugeLabel) {
      try {
        const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
        const gc = gcRes.data
        if (gc) {
          if (!record.geLabel) record.geLabel = gc.geLabel || '鸽'
          if (!record.bugeLabel) record.bugeLabel = gc.bugeLabel || '不鸽'
          if (!record.customQuestion) record.customQuestion = gc.customQuestion || '会准时吗？'
        }
      } catch (e) {}
    }

    const effectiveLaunchTime = currentLaunchTime || record.launchTime || ''

    // 改期：当前轮按基准时间判「鸽」，开启新轮次（不再静默覆盖 launchTime）
    if (effectiveLaunchTime && detectVotePostponement(record, effectiveLaunchTime, null)) {
      try {
        const patch = buildPostponeRolloverPatch(record, effectiveLaunchTime)
        await db.collection(COLLECTIONS.LAUNCH_VOTES).doc(record._id).update({ data: patch })
        Object.assign(record, patch)
      } catch (e) {}
    } else if (currentLaunchTime && currentLaunchTime !== record.launchTime) {
      try {
        await db.collection(COLLECTIONS.LAUNCH_VOTES).doc(record._id).update({
          data: { launchTime: currentLaunchTime, updatedAt: now() }
        })
        record.launchTime = currentLaunchTime
      } catch (e) {}
    }

    const currentRound = record.currentRound || 1
    const rounds = record.rounds || []
    const currentRoundInfo = rounds.find(r => r.round === currentRound)
    const currentRoundSettled = !!(currentRoundInfo && currentRoundInfo.result)

    // 自动结算：仅对当前未结算轮次，按该轮基准时间 vs 实际发射时间判定
    const settleTimeSource = (currentLaunchTime && String(currentLaunchTime).trim())
      ? currentLaunchTime
      : (record.launchTime || '')
    const settleTimeMs = settleTimeSource ? parseVoteTimeMs(settleTimeSource) : 0
    const baselineTime = getVoteRoundBaseline(record)
    const baselineMs = parseVoteTimeMs(baselineTime)
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000
    const pastEnoughForAutoSettle = baselineMs > 0 && (Date.now() - baselineMs) >= TWO_HOURS_MS
    const clientSaysCompleted = missionStatus === 'completed'
    if ((clientSaysCompleted || pastEnoughForAutoSettle) && !currentRoundSettled && baselineTime) {
      const autoResult = computeVoteRoundResult(baselineTime, settleTimeSource, '', '')
      const updatedRounds = upsertVoteRound(rounds, currentRound, {
        launchTime: baselineTime,
        result: autoResult,
        settledAt: now()
      })
      try {
        await db.collection(COLLECTIONS.LAUNCH_VOTES).doc(record._id).update({
          data: {
            result: autoResult,
            resultNote: '系统自动结算',
            settledAt: now(),
            rounds: updatedRounds,
            votingClosed: true,
            lockedLaunchTime: baselineTime,
            currentLaunchTime: settleTimeSource,
            updatedAt: now()
          }
        })
        record.result = autoResult
        record.resultNote = '系统自动结算'
        record.rounds = updatedRounds
        record.votingClosed = true
        record.lockedLaunchTime = baselineTime
        record.currentLaunchTime = settleTimeSource
      } catch (e) {}
      return ok({
        ...record,
        enabled: true,
        votingClosed: true,
        votingClosedReason: 'settled',
        myVote,
        myRound,
        currentRound,
        voteType: 'ontime'
      })
    }

    // 动态计算 votingClosed 状态（用最新的发射时间）
    let votingClosed = !!record.votingClosed
    const nowMs = Date.now()
    let votingClosedReason = ''
    if (currentRoundSettled) {
      votingClosed = true
      votingClosedReason = 'settled'
    } else if (effectiveLaunchTime) {
      const lt = parseVoteTimeMs(effectiveLaunchTime)
      if (lt > 0) {
        const timeToLaunch = lt - nowMs
        if (timeToLaunch > VOTE_TIME_TOLERANCE_MS) {
          votingClosed = false
        } else if (timeToLaunch < 0 && !record.result) {
          votingClosed = false
        } else if (timeToLaunch >= 0 && timeToLaunch < VOTE_TIME_TOLERANCE_MS) {
          votingClosed = true
          votingClosedReason = 'time'
        }
      }
    }
    return ok({ ...record, enabled: true, votingClosed, votingClosedReason, myVote, myRound, currentRound, voteType: 'ontime' })
  }
  // 无单任务记录，回退全局配置
  try {
    const gcRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
    const gc = gcRes.data
    if (gc && gc.enabled) {
      return ok({ launchId, geCount: 0, buGeCount: 0, enabled: true, votingClosed: false, customQuestion: gc.customQuestion || '会准时吗？', geLabel: gc.geLabel || '鸽', bugeLabel: gc.bugeLabel || '不鸽', _fromGlobal: true, myVote, myRound, currentRound: 1, voteType: 'ontime' })
    }
  } catch (e) {}
  return ok({ launchId, geCount: 0, buGeCount: 0, enabled: false, votingClosed: false, customQuestion: '', geLabel: '鸽', bugeLabel: '不鸽', myVote, myRound, currentRound: 1, voteType: 'ontime' })
}

async function getMyVoteResults(openid) {
  if (!openid) return fail(4010, '未获取到用户身份')
  let records
  try {
    records = await db.collection('launch_vote_records').where({ openid }).limit(100).get()
  } catch (e) {
    records = { data: [] }
  }
  if (!records.data || records.data.length === 0) return ok([])
  records.data.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })

  const choiceMap = {}
  const roundMap = {}
  const typeMap = {}
  records.data.forEach(r => {
    const vt = r.voteType === 'outcome' ? 'outcome' : 'ontime'
    const key = `${r.launchId}::${vt}`
    choiceMap[key] = r.choice
    roundMap[key] = r.round || 1
    typeMap[key] = vt
  })

  // 批量查 launch_votes 获取结算结果
  const results = []
  const uniqueLaunchIds = [...new Set(records.data.map(r => r.launchId))]
  for (let i = 0; i < uniqueLaunchIds.length; i += 20) {
    const batch = uniqueLaunchIds.slice(i, i + 20)
    const res = await db.collection(COLLECTIONS.LAUNCH_VOTES).where({ launchId: db.command.in(batch) }).limit(40).get()
    if (res.data) results.push(...res.data)
  }
  const voteMap = {}
  results.forEach(v => {
    const vt = v.voteType === 'outcome' ? 'outcome' : 'ontime'
    voteMap[`${v.launchId}::${vt}`] = v
  })

  const list = records.data.map(r => {
    let vt = r.voteType === 'outcome' ? 'outcome' : 'ontime'
    let choice = r.choice || ''
    // 用选项值推断题型，避免旧数据缺 voteType 时成败被当成准时
    if (choice === 'success' || choice === 'failure') vt = 'outcome'
    // 成败题下历史误把左右侧存成 ge/buge 时纠正
    if (vt === 'outcome') {
      if (choice === 'buge') choice = 'success'
      else if (choice === 'ge') choice = 'failure'
    }
    const key = `${r.launchId}::${vt}`
    const vote = voteMap[key] || voteMap[`${r.launchId}::${r.voteType === 'outcome' ? 'outcome' : 'ontime'}`] || {}
    const userRound = roundMap[`${r.launchId}::${r.voteType === 'outcome' ? 'outcome' : 'ontime'}`] || roundMap[key] || r.round || 1
    const rounds = vote.rounds || []

    // 按轮次查找该用户对应的结算结果
    let userResult = ''
    let userLaunchTime = vote.launchTime || ''
    let userSettledAt = ''

    const roundInfo = rounds.find(rr => rr.round === userRound)
    if (roundInfo) {
      userResult = roundInfo.result || ''
      userLaunchTime = roundInfo.launchTime || userLaunchTime
      userSettledAt = roundInfo.settledAt || ''
    } else {
      if (r.launchTimeAtVote) userLaunchTime = r.launchTimeAtVote
      if (!rounds.length || userRound >= (vote.currentRound || 1)) {
        userResult = vote.result || ''
        userSettledAt = vote.settledAt || ''
      }
    }

    // 成败结算结果若误为 ge/buge 也纠正
    if (vt === 'outcome') {
      if (userResult === 'buge') userResult = 'success'
      else if (userResult === 'ge') userResult = 'failure'
    }

    const choiceLabel = vt === 'outcome'
      ? (choice === 'success' ? '成功' : choice === 'failure' ? '失败' : choice || '未知')
      : (choice === 'ge' ? '鸽' : choice === 'buge' ? '不鸽' : choice || '未知')

    return {
      launchId: r.launchId,
      voteType: vt,
      voteTypeLabel: vt === 'outcome' ? '成败' : '准时',
      choice,
      choiceLabel,
      round: userRound,
      result: userResult,
      lockedLaunchTime: vote.lockedLaunchTime || '',
      launchTime: userLaunchTime,
      currentLaunchTime: vote.currentLaunchTime || vote.launchTime || '',
      settledAt: userSettledAt,
      missionName: vote.missionName || '',
      rocketName: vote.rocketName || '',
      geCount: vote.geCount || 0,
      buGeCount: vote.buGeCount || 0,
      successCount: vote.successCount || 0,
      failureCount: vote.failureCount || 0
    }
  })
  return ok(list)
}

/** 清除当前用户的全部竞猜记录（只删个人投票记录，不动 launch_votes 聚合/结算数据） */
async function clearMyVoteRecords(openid) {
  if (!openid) return fail(4010, '未获取到用户身份')
  let removed = 0
  try {
    const res = await db.collection('launch_vote_records').where({ openid }).remove()
    removed = (res && res.stats && res.stats.removed) || 0
  } catch (e) {
    return fail(5000, '清除失败，请稍后重试')
  }
  return ok({ removed })
}

async function listLaunchVotes(query = {}) {
  const col = COLLECTIONS.LAUNCH_VOTES
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const skip = (page - 1) * pageSize
  const [countRes, listRes] = await Promise.all([
    db.collection(col).count(),
    db.collection(col).orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get()
  ])
  return ok({ total: countRes.total || 0, page, pageSize, list: listRes.data || [] })
}

async function createLaunchVote(body, user) {
  const col = COLLECTIONS.LAUNCH_VOTES
  const voteType = normalizeVoteType(body.voteType)
  const payload = {
    launchId: body.launchId || '',
    voteType,
    missionName: body.missionName || '',
    rocketName: body.rocketName || '',
    launchTime: body.launchTime || '',
    geCount: Number(body.geCount) || 0,
    buGeCount: Number(body.buGeCount) || 0,
    successCount: Number(body.successCount) || 0,
    failureCount: Number(body.failureCount) || 0,
    customQuestion: body.customQuestion || (voteType === 'outcome' ? '会成功吗？' : '会准时吗？'),
    successLabel: body.successLabel || '成功',
    failureLabel: body.failureLabel || '失败',
    enabled: body.enabled !== false,
    result: body.result || '',
    resultNote: body.resultNote || '',
    currentRound: Number(body.currentRound) || 1,
    rounds: [],
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.username
  }
  if (body.launchId) {
    payload._id = voteMainDocId(body.launchId, voteType)
  }
  const res = await db.collection(col).add({ data: payload })
  await writeOpLog({ user, module: col, action: 'create', targetId: res._id || payload._id, after: payload })
  return ok({ _id: res._id || payload._id, ...payload })
}

async function updateLaunchVote(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const col = COLLECTIONS.LAUNCH_VOTES
  const ref = db.collection(col).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')
  const patch = pick(body, [
    'missionName', 'rocketName', 'launchTime', 'customQuestion', 'enabled', 'result', 'resultNote',
    'geCount', 'buGeCount', 'successCount', 'failureCount', 'currentRound', 'voteType',
    'successLabel', 'failureLabel', 'geLabel', 'bugeLabel'
  ])
  patch.updatedAt = now()
  patch.updatedBy = user.username

  // 结算时：将结果写入当前轮次的 rounds 记录
  if (body.result && body.result !== before.result) {
    const currentRound = body.currentRound || before.currentRound || 1
    const rounds = before.rounds || []
    const existingIdx = rounds.findIndex(r => r.round === currentRound)
    const roundEntry = {
      round: currentRound,
      launchTime: body.launchTime || before.launchTime || '',
      result: body.result,
      settledAt: now()
    }
    if (existingIdx >= 0) {
      rounds[existingIdx] = { ...rounds[existingIdx], ...roundEntry }
    } else {
      rounds.push(roundEntry)
    }
    patch.rounds = rounds
    patch.settledAt = now()
  }

  await ref.update({ data: patch })
  await writeOpLog({ user, module: col, action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function deleteLaunchVote(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const col = COLLECTIONS.LAUNCH_VOTES
  const ref = db.collection(col).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')
  await ref.remove()
  await writeOpLog({ user, module: col, action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

/** 触发 syncSpaceDevsData.rebuildVoteSettle，批量重算历史错误竞猜结算 */
async function rebuildLaunchVoteSettle(body, user) {
  try {
    const syncRes = await cloud.callFunction({
      name: 'syncSpaceDevsData',
      data: {
        action: 'rebuildVoteSettle',
        launchId: body && body.launchId,
        onlyWrong: !!(body && body.onlyWrong),
        dryRun: !!(body && body.dryRun),
        forceHistory: !!(body && body.forceHistory),
        all: !!(body && body.all),
        limit: body && body.limit,
        cursor: body && body.cursor,
        maxSettleLoops: body && body.maxSettleLoops
      },
      config: { timeout: 60000 }
    })
    const payload = (syncRes && syncRes.result) || {}
    await writeOpLog({
      user,
      module: COLLECTIONS.LAUNCH_VOTES,
      action: 'rebuild_settle',
      targetId: (body && body.launchId) || 'batch',
      after: payload.stats || payload
    })
    return ok(payload)
  } catch (e) {
    const msg = e.message || String(e)
    const isTimeout = /timeout|timed out|TIMEOUT|ESOCKETTIMEDOUT|超时/i.test(msg)
    return fail(5001, isTimeout ? '竞猜重算超时，请缩小 limit 或分批调用' : ('竞猜重算失败: ' + msg))
  }
}

async function getVoteConfig() {
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID).get()
    const doc = res.data || {}
    return ok({
      enabled: doc.enabled !== false,
      customQuestion: doc.customQuestion || '会准时吗？',
      geLabel: doc.geLabel || '鸽',
      bugeLabel: doc.bugeLabel || '不鸽',
      outcomeEnabled: doc.outcomeEnabled !== false,
      outcomeQuestion: doc.outcomeQuestion || '会成功吗？',
      successLabel: doc.successLabel || '成功',
      failureLabel: doc.failureLabel || '失败'
    })
  } catch (e) {
    return ok({
      enabled: false,
      customQuestion: '会准时吗？',
      geLabel: '鸽',
      bugeLabel: '不鸽',
      outcomeEnabled: true,
      outcomeQuestion: '会成功吗？',
      successLabel: '成功',
      failureLabel: '失败'
    })
  }
}

async function updateVoteConfig(body, user) {
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(VOTE_CONFIG_ID)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  const patch = {
    enabled: body.enabled !== false,
    customQuestion: body.customQuestion || '会准时吗？',
    geLabel: body.geLabel || '鸽',
    bugeLabel: body.bugeLabel || '不鸽',
    outcomeEnabled: body.outcomeEnabled !== false,
    outcomeQuestion: body.outcomeQuestion || '会成功吗？',
    successLabel: body.successLabel || '成功',
    failureLabel: body.failureLabel || '失败',
    updatedAt: now(),
    updatedBy: user.username
  }
  await ref.set({ data: patch })
  await writeOpLog({ user, module: 'launch_votes', action: 'update_vote_config', targetId: VOTE_CONFIG_ID, before, after: patch })
  return ok(true)
}

// ===== 月愿计划管理 =====
const LUNAR_WISHES_COL = 'lunar_wishes'
const LUNAR_WISHES_STATS_COL = 'lunar_wishes_stats'

async function listLunarWishes(query) {
  const page = Math.max(0, Number(query.page) || 0)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const where = {}
  if (query.status) where.status = query.status
  if (query.search) {
    where[_.or] = [
      { name: db.RegExp({ regexp: query.search, options: 'i' }) },
      { wish: db.RegExp({ regexp: query.search, options: 'i' }) },
      { boardingPassId: db.RegExp({ regexp: query.search, options: 'i' }) }
    ]
  }

  const countRes = await db.collection(LUNAR_WISHES_COL).where(where).count()
  const res = await db.collection(LUNAR_WISHES_COL)
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .get()

  return ok({ list: res.data || [], total: countRes.total, hasMore: (page + 1) * pageSize < countRes.total })
}

async function reviewLunarWish(body, user) {
  const { wishId, status } = body
  if (!wishId) return fail(4001, 'wishId 不能为空')
  if (!['approved', 'rejected', 'pending'].includes(status)) return fail(4001, '无效的状态值')

  const ref = db.collection(LUNAR_WISHES_COL).doc(wishId)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes || !beforeRes.data) return fail(4040, '祝福不存在')

  await ref.update({ data: { status, updatedAt: now() } })
  await writeOpLog({ user, module: 'lunar_wishes', action: 'review', targetId: wishId, before: { status: beforeRes.data.status }, after: { status } })
  return ok(true)
}

async function deleteLunarWish(wishId, user) {
  if (!wishId) return fail(4001, 'wishId 不能为空')

  const ref = db.collection(LUNAR_WISHES_COL).doc(wishId)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes || !beforeRes.data) return fail(4040, '祝福不存在')

  await ref.remove()

  // 更新统计
  try {
    await db.collection(LUNAR_WISHES_STATS_COL).doc('global').update({
      data: { totalWishes: _.inc(-1), updatedAt: now() }
    })
  } catch (e) {}

  await writeOpLog({ user, module: 'lunar_wishes', action: 'delete', targetId: wishId, before: { name: beforeRes.data.name, wish: beforeRes.data.wish } })
  return ok(true)
}

async function exportLunarWishes() {
  const allData = []
  let skip = 0
  const batchSize = 100
  while (true) {
    const res = await db.collection(LUNAR_WISHES_COL)
      .where({ status: 'approved' })
      .orderBy('createdAt', 'asc')
      .skip(skip)
      .limit(batchSize)
      .get()
    if (!res.data || res.data.length === 0) break
    allData.push(...res.data)
    skip += batchSize
    if (res.data.length < batchSize) break
  }
  return ok({ data: allData, total: allData.length })
}

async function getLunarWishesStats() {
  const totalRes = await db.collection(LUNAR_WISHES_COL).count()
  const approvedRes = await db.collection(LUNAR_WISHES_COL).where({ status: 'approved' }).count()
  const pendingRes = await db.collection(LUNAR_WISHES_COL).where({ status: 'pending' }).count()
  const rejectedRes = await db.collection(LUNAR_WISHES_COL).where({ status: 'rejected' }).count()

  // 最近7天每天的提交数
  const sevenDaysAgo = now() - 7 * 24 * 60 * 60 * 1000
  const recentRes = await db.collection(LUNAR_WISHES_COL)
    .where({ createdAt: _.gte(sevenDaysAgo) })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .field({ createdAt: true })
    .get()

  const dailyCounts = {}
  for (const item of (recentRes.data || [])) {
    const day = new Date(item.createdAt).toISOString().slice(0, 10)
    dailyCounts[day] = (dailyCounts[day] || 0) + 1
  }

  return ok({
    total: totalRes.total,
    approved: approvedRes.total,
    pending: pendingRes.total,
    rejected: rejectedRes.total,
    dailyCounts
  })
}

async function batchReviewLunarWishes(body, user) {
  const { wishIds, status } = body
  if (!Array.isArray(wishIds) || !wishIds.length) return fail(4001, '缺少 wishIds')
  if (!['approved', 'rejected'].includes(status)) return fail(4001, '无效的状态值')

  let updated = 0
  for (const id of wishIds.slice(0, 50)) {
    try {
      await db.collection(LUNAR_WISHES_COL).doc(id).update({ data: { status, updatedAt: now() } })
      updated++
    } catch (e) {}
  }

  await writeOpLog({ user, module: 'lunar_wishes', action: 'batch_review', targetId: wishIds.join(',').slice(0, 200), after: { status, count: updated } })
  return ok({ updated })
}

// ========== 里程碑彩蛋管理 ==========
async function listMilestoneRewards(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const type = (query.type || '').trim()

  let where = {}
  if (type) where.type = type

  try {
    const col = db.collection(COLLECTIONS.MILESTONE_REWARDS)
    const countRes = await col.where(where).count()
    const listRes = await col.where(where).skip((page - 1) * pageSize).limit(pageSize).get()
    const list = listRes.data || []
    list.sort((a, b) => {
      const sa = Number(a.sortOrder || 0)
      const sb = Number(b.sortOrder || 0)
      if (sa !== sb) return sa - sb
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
    return ok({ list, total: countRes.total, page, pageSize })
  } catch (e) {
    console.error('[listMilestoneRewards] error:', e.message || e)
    return ok({ list: [], total: 0, page, pageSize })
  }
}

async function createMilestoneReward(body, user) {
  const payload = {
    type: body.type || 'checkin',
    threshold: Number(body.threshold || 0),
    title: body.title || '',
    description: body.description || '',
    prizeImage: body.prizeImage || '',
    eggImage: body.eggImage || '',
    customOptions: Array.isArray(body.customOptions) ? body.customOptions : [],
    customNote: body.customNote || '',
    enabled: body.enabled !== false,
    sortOrder: Number(body.sortOrder || 0),
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.username,
    updatedBy: user.username
  }
  const res = await db.collection(COLLECTIONS.MILESTONE_REWARDS).add({ data: payload })
  await writeOpLog({ user, module: 'milestone_rewards', action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function updateMilestoneReward(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MILESTONE_REWARDS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  const patch = {}
  const fields = ['type', 'threshold', 'title', 'description', 'prizeImage', 'eggImage', 'customOptions', 'customNote', 'enabled', 'sortOrder']
  fields.forEach(f => { if (body[f] !== undefined) patch[f] = body[f] })
  if (patch.threshold !== undefined) patch.threshold = Number(patch.threshold)
  if (patch.sortOrder !== undefined) patch.sortOrder = Number(patch.sortOrder)
  if (patch.customOptions !== undefined) {
    patch.customOptions = Array.isArray(patch.customOptions) ? patch.customOptions : []
  }
  if (patch.customNote !== undefined) patch.customNote = String(patch.customNote || '')
  patch.updatedAt = now()
  patch.updatedBy = user.username

  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'milestone_rewards', action: 'update', targetId: id, before, after: { ...before, ...patch } })
  return ok(true)
}

async function deleteMilestoneReward(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MILESTONE_REWARDS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  const before = beforeRes?.data || null
  if (!before) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: 'milestone_rewards', action: 'delete', targetId: id, before, after: null })
  return ok(true)
}

async function listMilestoneClaims(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const status = (query.status || '').trim()

  let where = {}
  if (status) where.status = status

  const dbQuery = db.collection(COLLECTIONS.MILESTONE_CLAIMS).where(where)
  const [countRes, listRes] = await Promise.all([
    dbQuery.count(),
    dbQuery.skip((page - 1) * pageSize).limit(pageSize).get()
  ])
  const list = listRes.data || []
  list.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
  return ok({ list, total: countRes.total, page, pageSize })
}

async function updateMilestoneClaimStatus(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MILESTONE_CLAIMS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')

  const patch = { status: body.status || 'pending', updatedAt: now(), updatedBy: user.username }
  if (body.trackingNumber) patch.trackingNumber = body.trackingNumber
  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'milestone_rewards', action: 'update_claim', targetId: id, before: beforeRes.data, after: { ...beforeRes.data, ...patch } })
  return ok(true)
}

async function deleteMilestoneClaim(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.MILESTONE_CLAIMS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')
  await ref.remove()
  await writeOpLog({ user, module: 'milestone_rewards', action: 'delete_claim', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

async function getPublicMilestones() {
  const res = await db.collection(COLLECTIONS.MILESTONE_REWARDS)
    .where({ enabled: true })
    .orderBy('sortOrder', 'asc')
    .limit(100)
    .get()
  const list = (res.data || []).map(item => ({
    ...item,
    customOptions: Array.isArray(item.customOptions) ? item.customOptions : [],
    customNote: item.customNote || ''
  }))
  return ok(list)
}

async function submitMilestoneClaim(body, openid) {
  if (!openid) return fail(4010, '未获取到用户身份')
  const { milestoneId, name, phone, address, size, selections } = body
  if (!milestoneId) return fail(4001, '缺少里程碑ID')
  if (!name || !phone || !address) return fail(4001, '请填写完整的收件信息')

  const milestoneRes = await db.collection(COLLECTIONS.MILESTONE_REWARDS).doc(milestoneId).get().catch(() => null)
  if (!milestoneRes?.data) return fail(4040, '里程碑配置不存在')
  const milestone = milestoneRes.data

  const existRes = await db.collection(COLLECTIONS.MILESTONE_CLAIMS)
    .where({ openid, milestoneId })
    .limit(1)
    .get()
  if (existRes.data && existRes.data.length > 0) return fail(4002, '您已领取过该奖品')

  // 兼容旧版 size 字段，转为 selections
  let finalSelections = selections || {}
  if (!selections && size) {
    finalSelections = { '尺码选择': size }
  }

  const customOptions = Array.isArray(milestone.customOptions) ? milestone.customOptions : []
  for (const opt of customOptions) {
    if (opt.required && !finalSelections[opt.label]) {
      return fail(4001, `请选择${opt.label}`)
    }
  }

  await db.collection(COLLECTIONS.MILESTONE_CLAIMS).add({
    data: {
      openid,
      milestoneId,
      type: milestone.type,
      threshold: milestone.threshold,
      prizeTitle: milestone.title,
      prizeDesc: milestone.description,
      name,
      phone,
      address,
      selections: finalSelections,
      size: size || '',
      status: 'pending',
      createdAt: now()
    }
  })
  return ok(true)
}

async function getMyMilestoneClaims(openid) {
  if (!openid) return fail(4010, '未获取到用户身份')
  const res = await db.collection(COLLECTIONS.MILESTONE_CLAIMS)
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  const list = res.data || []
  if (list.length === 0) return ok(list)

  // 关联里程碑配置，补充 prizeImage
  const milestoneIds = [...new Set(list.map(c => c.milestoneId).filter(Boolean))]
  const configMap = {}
  for (let i = 0; i < milestoneIds.length; i += 20) {
    const batch = milestoneIds.slice(i, i + 20)
    const cfgRes = await db.collection(COLLECTIONS.MILESTONE_REWARDS).where({ _id: db.command.in(batch) }).limit(20).get()
    if (cfgRes.data) cfgRes.data.forEach(m => { configMap[m._id] = m })
  }
  list.forEach(item => {
    if (!item.prizeImage && configMap[item.milestoneId]) {
      item.prizeImage = configMap[item.milestoneId].prizeImage || ''
    }
    if (!item.prizeTitle && configMap[item.milestoneId]) {
      item.prizeTitle = configMap[item.milestoneId].title || ''
    }
  })
  return ok(list)
}

// ========== 会员管理 ==========

// 公共：把已支付订单应用到会员状态（与 cloudfunctions/membership/index.js 中的 applyPaidOrder 保持同源逻辑）
async function applyPaidOrderLocal(order) {
  if (!order || !order.openid) return
  const openid = order.openid

  // 确保会员文档存在
  let memberDoc = null
  try {
    const r = await db.collection('user_membership').doc(openid).get()
    memberDoc = r.data
  } catch (e) {
    try {
      await db.collection('user_membership').add({
        data: {
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
      })
      memberDoc = { _id: openid, type: 'free', expireAt: null, purchases: [] }
    } catch (e2) {}
  }

  if (order.orderType === 'subscription' && order.days) {
    const nowDate = new Date()
    const cur = memberDoc && memberDoc.expireAt ? new Date(memberDoc.expireAt) : nowDate
    const baseDate = cur > nowDate ? cur : nowDate
    const newExpire = new Date(baseDate.getTime() + Number(order.days) * 86400000)
    try {
      await db.collection('user_membership').doc(openid).update({
        data: {
          type: 'pro',
          planId: order.planId || '',
          expireAt: newExpire,
          updatedAt: db.serverDate()
        }
      })
    } catch (e) {}
    return { kind: 'subscription', expireAt: newExpire }
  }

  if (order.orderType === 'product' && order.productId) {
    try {
      await db.collection('user_membership').doc(openid).update({
        data: {
          purchases: _.addToSet(order.productId),
          updatedAt: db.serverDate()
        }
      })
    } catch (e) {}
    return { kind: 'product', productId: order.productId }
  }
}

// ── 一次性静默订正（幂等，可安全重复执行）──
// 背景：历史发货链路存在「推送回调 + 客户端查单」竞态，同一笔订阅订单可能被重复发货，
// 导致 expireAt 被多加天数。此函数：
//   1) 给历史已支付/退款中的订单回填 deliveredAt（视为已发货）
//   2) 按「用户实际有效订阅订单」绝对重算 expireAt，偏差超过 48h 才订正（原值留档 expireBeforeRepair）
//   3) 完成后在 global_config.main 打标记，不再重复执行
async function runMembershipRepairOnce() {
  try {
    const r = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc('main').get()
    if (r.data && r.data.membershipExpireRepairAt) return
  } catch (e) {
    // global_config 读不到时不执行订正（无法保证只跑一次的标记可写）
    return
  }

  // 1) 回填 deliveredAt（仅订阅单；产品单的补发是幂等的 addToSet，留给自动修复正常认领）
  try {
    await db.collection('membership_orders')
      .where({ orderType: 'subscription', status: _.in(['paid', 'refund_pending']), deliveredAt: _.exists(false) })
      .update({ data: { deliveredAt: db.serverDate(), deliveredBackfill: true, updatedAt: db.serverDate() } })
  } catch (e) {
    console.error('[membershipRepair] backfill deliveredAt error:', e.message || e)
  }

  // 2) 拉全量订阅订单（分页），按 openid 重算到期时间
  const allOrders = []
  const PAGE = 1000
  let skip = 0
  for (;;) {
    let batch = []
    try {
      const r = await db.collection('membership_orders')
        .where({ orderType: 'subscription' })
        .skip(skip).limit(PAGE).get()
      batch = r.data || []
    } catch (e) {
      console.error('[membershipRepair] fetch orders error:', e.message || e)
      break
    }
    allOrders.push(...batch)
    if (batch.length < PAGE) break
    skip += PAGE
  }

  const tsOf = o => {
    const t = o.paidAt || o.createdAt
    return t ? new Date(t).getTime() : 0
  }
  const byUser = {}
  for (const o of allOrders) {
    // refunded 订单已回滚权益，不参与重算
    if (!o.openid || !o.days) continue
    if (o.status !== 'paid' && o.status !== 'refund_pending') continue
    if (!byUser[o.openid]) byUser[o.openid] = []
    byUser[o.openid].push(o)
  }

  let fixed = 0
  for (const openid of Object.keys(byUser)) {
    const list = byUser[openid].sort((a, b) => tsOf(a) - tsOf(b))
    // 复现叠加规则：base = max(当前到期, 购买时刻)，再加订单天数
    let expireMs = 0
    for (const o of list) {
      const base = Math.max(expireMs, tsOf(o) || Date.now())
      expireMs = base + Number(o.days) * 86400000
    }
    if (!expireMs) continue

    let member = null
    try {
      const r = await db.collection('user_membership').doc(openid).get()
      member = r.data
    } catch (e) { continue }
    const curMs = member && member.expireAt ? new Date(member.expireAt).getTime() : 0
    // 48h 容差：吸收 paidAt 与实际发货时刻的正常偏差，只订正真正异常的数据
    if (Math.abs(curMs - expireMs) <= 48 * 3600 * 1000) continue

    try {
      await db.collection('user_membership').doc(openid).update({
        data: {
          type: 'pro',
          expireAt: new Date(expireMs),
          expireBeforeRepair: (member && member.expireAt) || null,
          expireRepairedAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      fixed++
      console.log('[membershipRepair] fixed:', openid, 'old:', curMs ? new Date(curMs).toISOString() : null, 'new:', new Date(expireMs).toISOString())
    } catch (e) {
      console.error('[membershipRepair] fix member error:', openid, e.message || e)
    }
  }

  // 3) 打完成标记
  try {
    await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc('main').update({
      data: { membershipExpireRepairAt: db.serverDate(), membershipExpireRepairFixed: fixed }
    })
  } catch (e) {
    console.error('[membershipRepair] mark done error:', e.message || e)
  }
  console.log('[membershipRepair] done, fixed count:', fixed)
}

async function listMembershipData() {
  try {
    // 一次性静默订正历史数据（幂等，有完成标记后为空操作）
    try { await runMembershipRepairOnce() } catch (e) {
      console.error('[listMembershipData] repair error:', e.message || e)
    }

    // 获取会员列表：普通用户取最近活跃 1000 条即可，但 PRO 会员必须拉全——
    // user_membership 每个打开过小程序的用户都有一条，总量早超 1000，
    // 只靠 limit(1000) 会漏掉不在该批次里的付费会员（历史上靠误发货副作用补列表，已废除）
    let members = []
    let memberTotal = 0
    try {
      const cntRes = await db.collection('user_membership').count()
      memberTotal = (cntRes && cntRes.total) || 0
    } catch (e) {
      console.error('[listMembershipData] count error:', e.message || e)
    }
    try {
      // 必须 orderBy：无排序时按 _id（openid 随机串）字典序取前 1000，
      // 总量超 1000 后返回的是一批固定用户，新用户永远进不了列表（免费列表看似不更新）
      let mRes
      try {
        mRes = await db.collection('user_membership').orderBy('updatedAt', 'desc').limit(1000).get()
      } catch (e) {
        // updatedAt 无索引等异常时退回旧查询，保证页面可用
        console.error('[listMembershipData] orderBy updatedAt error, fallback:', e.message || e)
        mRes = await db.collection('user_membership').limit(1000).get()
      }
      members = mRes.data || []

      const seen = new Set(members.map(m => m._id))
      const PRO_PAGE = 1000
      // 付费相关用户必须全量：订阅 PRO（type=pro）+ 购买过单品（purchases 非空）
      const fullFetchConditions = [
        { type: 'pro' },
        { 'purchases.0': _.exists(true) }
      ]
      for (const cond of fullFetchConditions) {
        let proSkip = 0
        for (;;) {
          let batch = []
          try {
            const r = await db.collection('user_membership')
              .where(cond)
              .skip(proSkip).limit(PRO_PAGE).get()
            batch = r.data || []
          } catch (e) {
            console.error('[listMembershipData] fetch paying members error:', e.message || e)
            break
          }
          for (const m of batch) {
            if (!seen.has(m._id)) {
              seen.add(m._id)
              members.push(m)
            }
          }
          if (batch.length < PRO_PAGE) break
          proSkip += PRO_PAGE
        }
      }

      members.sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return tb - ta
      })
    } catch (e) {
      console.error('[listMembershipData] members error:', e.message || e)
    }

    // 获取订单列表（最多 1000 条，按 createdAt 降序）
    let orders = []
    try {
      const oRes = await db.collection('membership_orders').limit(1000).get()
      orders = oRes.data || []
      orders.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })
    } catch (e) {
      console.error('[listMembershipData] orders error:', e.message || e)
    }

    // 自动修复：已支付但从未发货（无 deliveredAt）的订单补发。
    // 以订单上的 deliveredAt 原子认领为准（幂等），不再依赖「用户是否 PRO」推断，
    // 避免会员列表分页缺失导致的误判重复发货
    try {
      const undelivered = orders.filter(o => o.status === 'paid' && o.openid && !o.deliveredAt)

      for (const order of undelivered) {
        try {
          const claim = await db.collection('membership_orders')
            .where({ _id: order._id, status: 'paid', deliveredAt: _.exists(false) })
            .update({ data: { deliveredAt: db.serverDate(), deliveredBy: 'admin_autofix', updatedAt: db.serverDate() } })
          if (!claim || !claim.stats || claim.stats.updated !== 1) continue

          await applyPaidOrderLocal(order)
          // 把修复结果回填到列表，保证本次返回的数据是新的
          let fresh
          try {
            const r = await db.collection('user_membership').doc(order.openid).get()
            fresh = r.data
          } catch (e) {}
          if (fresh) {
            const idx = members.findIndex(m => m._id === order.openid)
            if (idx >= 0) members[idx] = fresh
            else members.push(fresh)
          }
        } catch (e) {
          console.error('[listMembershipData] auto-fix one error:', order._id, e.message || e)
        }
      }
    } catch (e) {
      console.error('[listMembershipData] auto-fix error:', e.message || e)
    }

    // 获取开关状态与白名单 + 虚拟支付配置
    let enabled = false
    let proWhitelistOpenids = []
    let vpayConfig = { env: 0, offerId: '1450535433' }
    try {
      const cfgRes = await db.collection(COLLECTIONS.GLOBAL_CONFIG).where({ _id: 'main' }).limit(1).get()
      const cfg = cfgRes.data && cfgRes.data[0]
      enabled = !!(cfg && cfg.enableMembership)
      const raw = cfg && cfg.proWhitelistOpenids
      proWhitelistOpenids = Array.isArray(raw) ? raw.map(s => String(s || '').trim()).filter(Boolean) : []
      if (cfg && cfg.vpayConfig && typeof cfg.vpayConfig === 'object') {
        vpayConfig = {
          env: Number(cfg.vpayConfig.env != null ? cfg.vpayConfig.env : 0),
          offerId: String(cfg.vpayConfig.offerId || '1450535433')
        }
      }
    } catch (e) {
      console.error('[listMembershipData] config error:', e.message || e)
    }

    return ok({ members, orders, enabled, proWhitelistOpenids, vpayConfig, memberTotal })
  } catch (e) {
    return fail(5001, '获取会员数据失败: ' + (e.message || String(e)))
  }
}

async function updateMembershipProWhitelist(body, user) {
  const raw = body.openids != null ? body.openids : body.proWhitelistOpenids
  let list = []
  if (Array.isArray(raw)) {
    list = raw.map(s => String(s || '').trim()).filter(Boolean)
  } else if (typeof raw === 'string') {
    list = raw.split(/[\s,;\n\r]+/).map(s => s.trim()).filter(Boolean)
  }
  const proWhitelistOpenids = [...new Set(list)]
  const id = 'main'
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(id)
  const patch = {
    proWhitelistOpenids,
    updatedAt: now(),
    updatedBy: user.username
  }
  let exists = false
  try {
    const got = await ref.get()
    exists = !!(got && got.data)
  } catch (e) {
    exists = false
  }
  try {
    if (exists) {
      await ref.update({ data: patch })
    } else {
      await ref.set({ data: { ...patch, createdAt: now() } })
    }
  } catch (e) {
    return fail(5001, '保存白名单失败: ' + (e.message || String(e)))
  }
  await writeOpLog({
    user,
    module: 'membership',
    action: 'update_pro_whitelist',
    targetId: id,
    after: { count: proWhitelistOpenids.length }
  })
  return ok({ proWhitelistOpenids })
}

// ── 订单列表分页 + 搜索（按 openid / status / 时间范围） ──
async function listMembershipOrders(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)))
  const where = {}
  if (query.openid) where.openid = String(query.openid).trim()
  if (query.status) where.status = String(query.status).trim()
  if (query.orderType) where.orderType = String(query.orderType).trim()
  const fromMs = query.from ? Number(query.from) : 0
  const toMs = query.to ? Number(query.to) : 0
  if (fromMs && toMs) {
    where.createdAt = _.gte(new Date(fromMs)).and(_.lte(new Date(toMs)))
  } else if (fromMs) {
    where.createdAt = _.gte(new Date(fromMs))
  } else if (toMs) {
    where.createdAt = _.lte(new Date(toMs))
  }

  try {
    let q = db.collection('membership_orders')
    if (Object.keys(where).length) q = q.where(where)
    let total = 0
    try {
      const c = await (Object.keys(where).length ? db.collection('membership_orders').where(where).count() : db.collection('membership_orders').count())
      total = c.total || 0
    } catch (e) {}

    const skip = (page - 1) * pageSize
    let list = []
    try {
      const r = await q.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get()
      list = r.data || []
    } catch (e) {
      // 索引缺失兜底：尝试再做一次 orderBy 查询；失败则按 _id 降序拿前 200 条
      let all = []
      try {
        const r2 = await db.collection('membership_orders').orderBy('createdAt', 'desc').limit(500).get()
        all = r2.data || []
      } catch (e2) {
        try {
          const r3 = await db.collection('membership_orders').orderBy('_id', 'desc').limit(500).get()
          all = r3.data || []
        } catch (e3) {
          const r4 = await db.collection('membership_orders').limit(200).get()
          all = r4.data || []
        }
      }
      all = all.filter(o => {
        if (where.openid && o.openid !== where.openid) return false
        if (where.status && o.status !== where.status) return false
        if (where.orderType && o.orderType !== where.orderType) return false
        const t = o.createdAt ? new Date(o.createdAt).getTime() : 0
        if (fromMs && t < fromMs) return false
        if (toMs && t > toMs) return false
        return true
      })
      all.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })
      total = all.length
      list = all.slice(skip, skip + pageSize)
    }

    return ok({ list, total, page, pageSize })
  } catch (e) {
    return fail(5001, '查询订单失败: ' + (e.message || String(e)))
  }
}

// ── 人工赠送 PRO 会员 ──
async function grantMembershipPro(body, user) {
  const openid = String((body && body.openid) || '').trim()
  if (!openid) return fail(4001, '缺少 openid')
  const days = Number((body && body.days) || 0)
  const permanent = !!(body && body.permanent)
  if (!permanent && (!days || days <= 0)) return fail(4001, '请提供 days 或 permanent')

  const grantDays = permanent ? 36500 : days
  const planId = permanent ? 'permanent' : (days >= 365 ? 'yearly' : (days >= 30 ? 'monthly' : 'custom'))

  // 写一条审计订单流水
  const outTradeNo = 'G' + Date.now() + Math.random().toString(36).slice(2, 8)
  const orderRecord = {
    _id: outTradeNo,
    openid,
    amount: 0,
    description: '人工赠送 - ' + (permanent ? '永久' : (days + ' 天')),
    status: 'paid',
    orderType: 'subscription',
    grantBy: user.username,
    grantReason: String((body && body.reason) || ''),
    planId,
    days: grantDays,
    paidAt: db.serverDate(),
    deliveredAt: db.serverDate(),
    createdAt: db.serverDate()
  }
  try {
    await db.collection('membership_orders').add({ data: orderRecord })
  } catch (e) {
    return fail(5001, '写入订单失败: ' + (e.message || String(e)))
  }

  try {
    await applyPaidOrderLocal(orderRecord)
  } catch (e) {
    return fail(5001, '更新会员状态失败: ' + (e.message || String(e)))
  }

  await writeOpLog({
    user,
    module: 'membership',
    action: 'grant_pro',
    targetId: openid,
    after: { outTradeNo, days: grantDays, planId }
  })
  return ok({ outTradeNo })
}

// ── 重查待发货订单（批量回查 pending / refund_pending：已支付兜底发货、已退款兜底落库、24h 未支付取消） ──
async function recheckPendingOrders(body, user) {
  const limit = Math.min(200, Math.max(1, Number((body && body.limit) || 100)))
  const cancelOlderThanH = Number((body && body.cancelOlderThanH) || 24)

  // 同时拉 pending（待支付）与 refund_pending（退款中），两者都需要重新查微信侧
  let pendings = []
  try {
    const _ = db.command
    const r = await db.collection('membership_orders')
      .where({ status: _.in(['pending', 'refund_pending']) })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    pendings = r.data || []
  } catch (e) {
    return fail(5001, '查询订单失败: ' + (e.message || e))
  }
  if (!pendings.length) return ok({ scanned: 0, paid: 0, refunded: 0, stillPending: 0, cancelled: 0, failed: 0 })

  const summary = { scanned: pendings.length, paid: 0, refunded: 0, stillPending: 0, cancelled: 0, failed: 0, details: [] }
  const cancelCutoff = Date.now() - cancelOlderThanH * 3600 * 1000

  for (const o of pendings) {
    const outTradeNo = o._id
    let invokeRes
    try {
      invokeRes = await cloud.callFunction({
        name: 'membership',
        data: { action: 'queryVPayOrder', outTradeNo, overrideOpenid: o.openid, fromAdminGateway: true }
      })
    } catch (e) {
      summary.failed++
      summary.details.push({ outTradeNo, status: 'invoke_error', error: (e.message || String(e)) })
      continue
    }
    const result = invokeRes && invokeRes.result
    if (!result || result.error) {
      summary.failed++
      summary.details.push({ outTradeNo, status: 'query_error', error: (result && result.error) || 'unknown' })
      continue
    }
    if (result.status === 'paid') {
      summary.paid++
      summary.details.push({ outTradeNo, status: 'paid' })
      continue
    }
    if (result.status === 'refunded') {
      summary.refunded++
      summary.details.push({ outTradeNo, status: 'refunded' })
      continue
    }
    // 仅 pending（待支付）超过 24h 才取消；refund_pending 状态保留，等微信侧后续通知
    if (o.status === 'pending') {
      const created = o.createdAt ? new Date(o.createdAt).getTime() : 0
      if (created > 0 && created < cancelCutoff) {
        try {
          await db.collection('membership_orders').doc(outTradeNo).update({
            data: { status: 'cancelled', cancelReason: 'auto_cancelled_by_recheck', updatedAt: db.serverDate() }
          })
          summary.cancelled++
          summary.details.push({ outTradeNo, status: 'cancelled' })
        } catch (e) {
          summary.failed++
          summary.details.push({ outTradeNo, status: 'cancel_failed', error: (e.message || String(e)) })
        }
      } else {
        summary.stillPending++
        summary.details.push({ outTradeNo, status: 'still_pending' })
      }
    } else {
      // refund_pending 但还没确认到账：保持原状
      summary.stillPending++
      summary.details.push({ outTradeNo, status: 'still_refund_pending' })
    }
  }

  await writeOpLog({
    user,
    module: 'membership',
    action: 'recheck_pending_orders',
    targetId: '',
    detail: {
      scanned: summary.scanned,
      paid: summary.paid,
      refunded: summary.refunded,
      stillPending: summary.stillPending,
      cancelled: summary.cancelled,
      failed: summary.failed
    }
  })
  return ok(summary)
}

// ── 人工退款（调 membership 云函数 vpayRefund） ──
async function refundMembershipOrder(body, user) {
  const outTradeNo = String((body && body.outTradeNo) || '').trim()
  if (!outTradeNo) return fail(4001, '缺少 outTradeNo')
  const refundFee = body && body.refundFee != null ? Number(body.refundFee) : null
  // reason 必须是 0-5 数字字符串（虚拟支付要求 enum）；非法值统一改 '5'（其他原因）
  let reason = String((body && body.reason) || '5').trim()
  if (!/^[0-5]$/.test(reason)) reason = '5'
  const note = String((body && body.note) || '').trim()

  let order
  try {
    const r = await db.collection('membership_orders').doc(outTradeNo).get()
    order = r.data
  } catch (e) {
    return fail(4040, '订单不存在')
  }
  if (!order) return fail(4040, '订单不存在')
  if (order.status !== 'paid') return fail(4002, '仅已支付订单可退款（当前状态：' + order.status + '）')

  // 调用 membership 云函数发起退款
  let invokeRes
  try {
    invokeRes = await cloud.callFunction({
      name: 'membership',
      data: {
        action: 'vpayRefund',
        outTradeNo,
        refundFee: refundFee != null ? refundFee : order.amount,
        reason,
        note,
        fromAdminGateway: true,
        adminUsername: (user && user.username) || '',
        adminId: (user && user.id) || ''
      }
    })
  } catch (e) {
    return fail(5001, '调用退款接口失败: ' + (e.message || String(e)))
  }
  const result = invokeRes && invokeRes.result
  if (!result || result.error) {
    return fail(5001, (result && result.error) || '退款失败')
  }

  // 标记审计
  await writeOpLog({
    user,
    module: 'membership',
    action: 'refund',
    targetId: outTradeNo,
    after: { refundFee: refundFee != null ? refundFee : order.amount, reason, note }
  })
  return ok(result)
}

// ── 导出订单 ──
async function exportMembershipOrders(query = {}) {
  const where = {}
  if (query.openid) where.openid = String(query.openid).trim()
  if (query.status) where.status = String(query.status).trim()
  const fromMs = query.from ? Number(query.from) : 0
  const toMs = query.to ? Number(query.to) : 0
  try {
    let list = []
    try {
      let q = db.collection('membership_orders')
      if (Object.keys(where).length) q = q.where(where)
      const r = await q.limit(1000).get()
      list = r.data || []
    } catch (e) {
      const r = await db.collection('membership_orders').limit(1000).get()
      list = r.data || []
    }
    list = list.filter(o => {
      if (where.openid && o.openid !== where.openid) return false
      if (where.status && o.status !== where.status) return false
      const t = o.createdAt ? new Date(o.createdAt).getTime() : 0
      if (fromMs && t < fromMs) return false
      if (toMs && t > toMs) return false
      return true
    })
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
    return ok({ list, count: list.length })
  } catch (e) {
    return fail(5001, '导出失败: ' + (e.message || String(e)))
  }
}

// ── 更新虚拟支付配置（offerId / env） ──
async function updateVPayConfig(body, user) {
  const env = Number((body && body.env) || 0)
  const offerId = String((body && body.offerId) || '').trim()
  if (env !== 0 && env !== 1) return fail(4001, 'env 只能是 0 或 1')
  const id = 'main'
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(id)
  const patch = {
    vpayConfig: { env, offerId },
    updatedAt: now(),
    updatedBy: user.username
  }
  let exists = false
  try {
    const got = await ref.get()
    exists = !!(got && got.data)
  } catch (e) {}
  try {
    if (exists) await ref.update({ data: patch })
    else await ref.set({ data: { ...patch, createdAt: now() } })
  } catch (e) {
    return fail(5001, '保存配置失败: ' + (e.message || String(e)))
  }
  await writeOpLog({ user, module: 'membership', action: 'update_vpay_config', targetId: id, after: { env, offerId } })
  return ok({ env, offerId })
}

// ── SKU 默认价表（与 cloudfunctions/membership/index.js 中的 VPAY_PRODUCTS 保持同步） ──
const VPAY_SKU_DEFAULTS = {
  vp_sub_monthly: { kind: 'subscription', name: '星际通行证 - 月卡', goodsPrice: 390 },
  vp_sub_yearly: { kind: 'subscription', name: '星际通行证 - 年卡', goodsPrice: 3990 },
  vp_sub_year_dc: { kind: 'subscription', name: '星际通行证-年卡6折', goodsPrice: 2390 },
  vp_sub_permanent: { kind: 'subscription', name: '星际通行证 - 永久', goodsPrice: 16800 },
  vp_sub_perm_dc: { kind: 'subscription', name: '星际通行证-永久5折', goodsPrice: 8400 },
  vp_starlink_ar: { kind: 'product', name: '星链 AR 观测', goodsPrice: 690 },
  vp_artemis_telemetry: { kind: 'product', name: 'Artemis 遥测面板', goodsPrice: 390 },
  vp_starlink_pro: { kind: 'product', name: '星链高级追踪', goodsPrice: 390 },
  vp_starship_chk: { kind: 'product', name: '星舰飞行检查清单', goodsPrice: 390 }
}
const VPAY_SKU_KEYS = Object.keys(VPAY_SKU_DEFAULTS)
const VPAY_PRICE_MIN = 1
const VPAY_PRICE_MAX = 99999900

async function listMembershipSkuPrices() {
  let current = {}
  try {
    const res = await db.collection(COLLECTIONS.GLOBAL_CONFIG).doc('main').get()
    current = (res.data && res.data.vpaySkuPrices) || {}
  } catch (e) {}
  const items = VPAY_SKU_KEYS.map((id) => ({
    id,
    name: VPAY_SKU_DEFAULTS[id].name,
    kind: VPAY_SKU_DEFAULTS[id].kind,
    defaultPrice: VPAY_SKU_DEFAULTS[id].goodsPrice,
    currentPrice: Number.isInteger(current[id]) && current[id] > 0 ? current[id] : VPAY_SKU_DEFAULTS[id].goodsPrice,
    overridden: Number.isInteger(current[id]) && current[id] > 0
  }))
  return ok({ items, defaults: VPAY_SKU_DEFAULTS, current })
}

async function updateMembershipSkuPrices(body, user) {
  const input = body && body.prices
  if (!input || typeof input !== 'object') return fail(4001, '缺少 prices')

  const sanitized = {}
  for (const k of Object.keys(input)) {
    if (VPAY_SKU_KEYS.indexOf(k) === -1) {
      return fail(4001, '未知的商品 ID: ' + k)
    }
    const v = Number(input[k])
    if (!Number.isInteger(v) || v < VPAY_PRICE_MIN || v > VPAY_PRICE_MAX) {
      return fail(4001, '价格非法（' + k + '）：必须为 ' + VPAY_PRICE_MIN + '-' + VPAY_PRICE_MAX + ' 之间的整数（单位：分）')
    }
    sanitized[k] = v
  }

  const id = 'main'
  const ref = db.collection(COLLECTIONS.GLOBAL_CONFIG).doc(id)
  let before = {}
  try {
    const got = await ref.get()
    before = (got.data && got.data.vpaySkuPrices) || {}
  } catch (e) {}

  const merged = { ...before, ...sanitized }
  const patch = {
    vpaySkuPrices: merged,
    updatedAt: now(),
    updatedBy: user.username
  }

  let exists = false
  try {
    const got = await ref.get()
    exists = !!(got && got.data)
  } catch (e) {}
  try {
    if (exists) await ref.update({ data: patch })
    else await ref.set({ data: { ...patch, createdAt: now() } })
  } catch (e) {
    return fail(5001, '保存失败: ' + (e.message || String(e)))
  }

  // 通知 membership 云函数清缓存（容错：失败不阻塞主流程）
  try {
    await cloud.callFunction({ name: 'membership', data: { action: 'clearPriceCache' } })
  } catch (e) {}

  await writeOpLog({
    user,
    module: 'membership',
    action: 'update_sku_prices',
    targetId: id,
    before: { vpaySkuPrices: before },
    after: { vpaySkuPrices: merged, changedKeys: Object.keys(sanitized) }
  })
  return ok({ current: merged })
}

// ══════════════════════════════════════════════════════════════
// 邀请数据统计（invite_records / invite_stats 由 membership 云函数写入）
// invite_records：_id=被邀人 openid，{ inviter, createdAt }，一人一生只计一次
// invite_stats：  _id=邀请人 openid，{ validCount, cardsGranted, createdAt, updatedAt }
// ══════════════════════════════════════════════════════════════
const INVITE_CARD_THRESHOLD = 15
const INVITE_TREND_DAYS = 30

/** 以东八区日期分桶（createdAt 为 serverDate，存储为 UTC） */
function beijingDayKey(dateLike) {
  const t = new Date(dateLike).getTime()
  if (!Number.isFinite(t)) return ''
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 分页拉全一个查询（带上限保护），失败返回已取到的部分 */
async function fetchAllDocs(makeQuery, { pageSize = 1000, maxDocs = 20000 } = {}) {
  const all = []
  let skip = 0
  for (;;) {
    let batch = []
    try {
      const r = await makeQuery().skip(skip).limit(pageSize).get()
      batch = r.data || []
    } catch (e) {
      console.error('[fetchAllDocs]', e.message || e)
      break
    }
    all.push(...batch)
    if (batch.length < pageSize || all.length >= maxDocs) break
    skip += pageSize
  }
  return all
}

async function getInviteStats() {
  try {
    // 总量计数（两个集合可能尚未创建，各自容错）
    let totalInvited = 0
    let totalInviters = 0
    try {
      const c = await db.collection('invite_records').count()
      totalInvited = c.total || 0
    } catch (e) {}
    try {
      const c = await db.collection('invite_stats').count()
      totalInviters = c.total || 0
    } catch (e) {}

    // 邀请人全量统计（用于发卡总数、达标人数、进度分布；量级 = 有邀请行为的用户数，通常远小于记录数）
    const statDocs = await fetchAllDocs(() => db.collection('invite_stats'))
    let cardsGrantedTotal = 0
    let reachedThreshold = 0
    const distribution = { d1_4: 0, d5_9: 0, d10_14: 0, d15plus: 0 }
    for (const s of statDocs) {
      const v = Number(s.validCount) || 0
      const g = Number(s.cardsGranted) || 0
      cardsGrantedTotal += g
      if (g > 0) reachedThreshold++
      if (v >= 15) distribution.d15plus++
      else if (v >= 10) distribution.d10_14++
      else if (v >= 5) distribution.d5_9++
      else if (v >= 1) distribution.d1_4++
    }

    // 近 30 天邀请记录 → 日趋势 + 今日/近7天汇总
    const sinceMs = Date.now() - INVITE_TREND_DAYS * 24 * 3600 * 1000
    const recentRecords = await fetchAllDocs(() =>
      db.collection('invite_records')
        .where({ createdAt: _.gte(new Date(sinceMs)) })
        .field({ createdAt: true })
    )
    const dayMap = {}
    for (const r of recentRecords) {
      const key = beijingDayKey(r.createdAt)
      if (key) dayMap[key] = (dayMap[key] || 0) + 1
    }
    const trend = []
    const todayKey = beijingDayKey(Date.now())
    for (let i = INVITE_TREND_DAYS - 1; i >= 0; i--) {
      const key = beijingDayKey(Date.now() - i * 24 * 3600 * 1000)
      trend.push({ date: key, count: dayMap[key] || 0 })
    }
    const todayCount = dayMap[todayKey] || 0
    let last7Count = 0
    for (let i = 0; i < 7; i++) {
      const key = beijingDayKey(Date.now() - i * 24 * 3600 * 1000)
      last7Count += dayMap[key] || 0
    }

    // 邀请排行榜 Top 50（按有效邀请数降序）
    let leaderboard = []
    try {
      const r = await db.collection('invite_stats').orderBy('validCount', 'desc').limit(50).get()
      leaderboard = (r.data || []).map((s) => ({
        openid: s._id,
        validCount: Number(s.validCount) || 0,
        cardsGranted: Number(s.cardsGranted) || 0,
        toNextCard: INVITE_CARD_THRESHOLD - ((Number(s.validCount) || 0) % INVITE_CARD_THRESHOLD),
        firstInviteAt: s.createdAt || null,
        lastInviteAt: s.updatedAt || null
      }))
    } catch (e) {
      console.error('[getInviteStats] leaderboard error:', e.message || e)
    }

    // 最近月卡发放记录（邀请奖励订单，membership 云函数发卡时写入）
    let rewardOrders = []
    try {
      const r = await db.collection('membership_orders')
        .where({ grantReason: 'invite_reward' })
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      rewardOrders = (r.data || []).map((o) => ({
        orderId: o._id,
        openid: o.openid,
        description: o.description || '',
        days: Number(o.days) || 0,
        createdAt: o.createdAt || null
      }))
    } catch (e) {
      console.error('[getInviteStats] reward orders error:', e.message || e)
    }

    return ok({
      summary: {
        totalInvited,
        totalInviters,
        cardsGrantedTotal,
        reachedThreshold,
        todayCount,
        last7Count,
        last30Count: recentRecords.length,
        threshold: INVITE_CARD_THRESHOLD
      },
      distribution,
      trend,
      leaderboard,
      rewardOrders
    })
  } catch (e) {
    return fail(5001, '获取邀请统计失败: ' + (e.message || String(e)))
  }
}

/** 邀请明细分页列表（可按邀请人 openid 过滤） */
async function listInviteRecords(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)))
  const where = {}
  if (query.inviter) where.inviter = String(query.inviter).trim()

  try {
    let base = db.collection('invite_records')
    if (Object.keys(where).length) base = base.where(where)

    let total = 0
    try {
      const c = await base.count()
      total = c.total || 0
    } catch (e) {}

    let list = []
    try {
      const r = await base.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
      list = r.data || []
    } catch (e) {
      // createdAt 索引缺失兜底：按 _id 排序保证页面可用
      const r2 = await base.orderBy('_id', 'desc').skip((page - 1) * pageSize).limit(pageSize).get().catch(() => null)
      list = (r2 && r2.data) || []
    }

    return ok({
      list: list.map((r) => ({
        invitee: r._id,
        inviter: r.inviter || '',
        createdAt: r.createdAt || null
      })),
      total,
      page,
      pageSize
    })
  } catch (e) {
    return fail(5001, '获取邀请明细失败: ' + (e.message || String(e)))
  }
}

async function listKnowledgeCards(query = {}) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
  const keyword = (query.keyword || '').trim()

  let dbQuery
  if (keyword) {
    dbQuery = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).where(
      _.or([
        { fact: db.RegExp({ regexp: keyword, options: 'i' }) },
        { category: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])
    )
  } else {
    dbQuery = db.collection(COLLECTIONS.KNOWLEDGE_CARDS)
  }

  const [countRes, listRes] = await Promise.all([
    dbQuery.count(),
    dbQuery.orderBy('cardId', 'asc').skip((page - 1) * pageSize).limit(pageSize).get()
  ])
  return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
}

async function createKnowledgeCard(body, user) {
  const payload = {
    cardId: Number(body.cardId || 0),
    category: body.category || '',
    fact: body.fact || '',
    source: body.source || '',
    enabled: body.enabled !== false,
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.username,
    updatedBy: user.username
  }
  const res = await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).add({ data: payload })
  await writeOpLog({ user, module: 'knowledge_cards', action: 'create', targetId: res._id, after: payload })
  return ok({ id: res._id })
}

async function updateKnowledgeCard(id, body, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')

  const patch = {}
  const fields = ['cardId', 'category', 'fact', 'source', 'enabled']
  fields.forEach(f => { if (body[f] !== undefined) patch[f] = body[f] })
  if (patch.cardId !== undefined) patch.cardId = Number(patch.cardId)
  patch.updatedAt = now()
  patch.updatedBy = user.username

  await ref.update({ data: patch })
  await writeOpLog({ user, module: 'knowledge_cards', action: 'update', targetId: id, before: beforeRes.data, after: { ...beforeRes.data, ...patch } })
  return ok(true)
}

async function deleteKnowledgeCard(id, user) {
  if (!id) return fail(4001, 'id不能为空')
  const ref = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(id)
  const beforeRes = await ref.get().catch(() => null)
  if (!beforeRes?.data) return fail(4040, '数据不存在')

  await ref.remove()
  await writeOpLog({ user, module: 'knowledge_cards', action: 'delete', targetId: id, before: beforeRes.data, after: null })
  return ok(true)
}

async function getPublicKnowledgeCards() {
  const allCards = []
  let lastId = ''
  while (true) {
    let q = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).where({ enabled: true }).orderBy('cardId', 'asc').limit(100)
    if (lastId) q = q.where({ _id: _.gt(lastId) })
    const res = await q.get()
    if (!res.data || res.data.length === 0) break
    allCards.push(...res.data)
    lastId = res.data[res.data.length - 1]._id
    if (res.data.length < 100) break
  }
  return ok(allCards)
}

async function batchImportKnowledgeCards(body, user) {
  const cards = body.cards
  if (!Array.isArray(cards) || cards.length === 0) return fail(4001, '无有效卡片数据')
  let imported = 0
  for (const card of cards) {
    await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).add({
      data: {
        cardId: Number(card.id || card.cardId || 0),
        category: card.category || '',
        fact: card.fact || '',
        source: card.source || '',
        enabled: true,
        createdAt: now(),
        updatedAt: now(),
        createdBy: user.username,
        updatedBy: user.username
      }
    })
    imported++
  }
  await writeOpLog({ user, module: 'knowledge_cards', action: 'batch_import', targetId: 'batch', after: { count: imported } })
  return ok({ imported })
}

const { createBilibiliPublishApi } = require('./bilibiliPublish')
let _biliPublishApi = null
function biliPublishApi() {
  if (!_biliPublishApi) {
    _biliPublishApi = createBilibiliPublishApi({ db, _, ok, fail, now, writeOpLog, cloud })
  }
  return _biliPublishApi
}

async function route(event, user) {
  const { path = '', method = 'GET', query = {}, body = {} } = event
  const headers = event.headers || {}

  if (path === '/auth/login' && method === 'POST') {
    return login(body, { clientIp: event._clientIp || 'unknown' })
  }

  if (path === '/auth/captcha' && method === 'GET') {
    return issueCaptcha()
  }

  // ===== B 站发文 Agent（BILI_AGENT_TOKEN，无需管理员 JWT） =====
  if (path.startsWith('/bilibili-agent/')) {
    if (!biliPublishApi().verifyAgentToken(headers)) return fail(4010, 'Agent 未授权')
    if (path === '/bilibili-agent/claim' && method === 'POST') return biliPublishApi().agentClaimJob(body)
    if (path === '/bilibili-agent/complete' && method === 'POST') return biliPublishApi().agentCompleteJob(body)
    if (path === '/bilibili-agent/fail' && method === 'POST') return biliPublishApi().agentFailJob(body)
    return fail(4040, `未知 Agent 路由: ${method} ${path}`)
  }

  // ===== 发射竞猜投票（小程序端，无需管理员权限） =====
  if (path === '/vote' && method === 'POST') return castVote(body, event._openid)
  if (path === '/vote/my-results' && method === 'GET') return getMyVoteResults(event._openid)
  if (path === '/vote/my-results' && method === 'DELETE') return clearMyVoteRecords(event._openid)
  if (path.startsWith('/vote/') && method === 'GET') return getVoteStats(path.split('/').pop(), event._openid, query)
  if (path === '/vote-config' && method === 'GET') return getVoteConfig()

  // ===== 关于我们（小程序端，无需管理员权限） =====
  if (path === '/about-config' && method === 'GET') return getAboutConfig()

  // ===== 太空轨道数据中心（GET 公开供小程序读取） =====
  if (path === '/orbital-config' && method === 'GET') return getOrbitalConfig()

  // ===== 视频号直播封面（GET 公开供小程序读取） =====
  if (path === '/channels-live-config' && method === 'GET') return getChannelsLiveCoverConfig()

  // ===== 推荐视频号引导（GET 公开供小程序读取） =====
  if (path === '/channels-live-fallback-guide' && method === 'GET') return getChannelsLiveFallbackGuide()

  // ===== 太空简报开关（GET 公开供小程序读取；PUT 在鉴权块之后） =====
  if (path === '/briefing-config' && method === 'GET') return getBriefingConfig()

  // ===== 发射提醒订阅（小程序端，无需管理员权限） =====
  if (path === '/subscribe' && method === 'POST') return subscribeLaunchReminder(body, event._openid)
  if (path === '/subscribe' && method === 'GET') return listMySubscriptions(event._openid)
  if (path.startsWith('/subscribe/') && method === 'GET') return checkSubscription(path.split('/').pop(), event._openid)
  if (path.startsWith('/subscribe/') && method === 'DELETE') return cancelSubscription(path.split('/').pop(), event._openid)

  // ===== 服务号 B 通道 opt-in（小程序端，无需管理员权限） =====
  if (path === '/oa-alert/enable' && method === 'POST') return enableOaAlert(event._openid, event._unionid)
  if (path === '/oa-alert/disable' && method === 'POST') return disableOaAlert(event._openid, event._unionid)
  if (path === '/oa-alert/status' && method === 'GET') return getOaAlertStatus(event._openid, event._unionid)

  // ===== 里程碑彩蛋（小程序端，无需管理员权限） =====
  if (path === '/milestones' && method === 'GET') return getPublicMilestones()
  if (path === '/milestone-claim' && method === 'POST') return submitMilestoneClaim(body, event._openid)
  if (path === '/milestone-claim/my' && method === 'GET') return getMyMilestoneClaims(event._openid)

  // ===== 知识卡公开接口（小程序端） =====
  if (path === '/knowledge-cards/public' && method === 'GET') return getPublicKnowledgeCards()

  if (!user) return fail(4010, '未授权或登录已过期')

  if (path === '/dashboard/overview' && method === 'GET') return getDashboardOverview()

  // ===== 太空轨道数据中心（PUT 管理端编辑） =====
  if (path === '/orbital-config' && method === 'PUT') return updateOrbitalConfig(body, user)

  // ===== 太空简报开关（PUT 管理端编辑） =====
  if (path === '/briefing-config' && method === 'PUT') return updateBriefingConfig(body, user)

  if (path === '/news/events' && method === 'GET') return listNews(COLLECTIONS.EVENTS, query)
  if (path === '/news/events' && method === 'POST') return createNews(COLLECTIONS.EVENTS, body, user)
  if (path.startsWith('/news/events/') && method === 'PUT') return updateNews(COLLECTIONS.EVENTS, path.split('/').pop(), body, user)
  if (path.startsWith('/news/events/') && method === 'DELETE') return deleteNews(COLLECTIONS.EVENTS, path.split('/').pop(), user)

  if (path === '/news/articles' && method === 'GET') return listNews(COLLECTIONS.ARTICLES, query)
  if (path === '/news/articles' && method === 'POST') return createNews(COLLECTIONS.ARTICLES, body, user)
  if (path.startsWith('/news/articles/') && method === 'PUT') return updateNews(COLLECTIONS.ARTICLES, path.split('/').pop(), body, user)
  if (path.startsWith('/news/articles/') && method === 'DELETE') return deleteNews(COLLECTIONS.ARTICLES, path.split('/').pop(), user)

  if (path === '/news-manual-config' && method === 'GET') {
    const deny = checkPerm(user, 'news_articles'); if (deny) return deny
    return getNewsManualConfig()
  }
  if (path === '/news-manual-config' && method === 'PUT') {
    const deny = checkPerm(user, 'news_articles'); if (deny) return deny
    return updateNewsManualConfig(body, user)
  }

  if (path === '/road-closure' && method === 'GET') return getRoadClosure()
  if (path === '/road-closure' && method === 'PUT') return updateRoadClosure(body, user)
  if (path === '/road-closure/sync' && method === 'POST') return syncRoadClosureFromAPI(user)
  if (path.startsWith('/road-closure/') && method === 'DELETE') return deleteRoadClosureItem(path.split('/').pop(), user)

  // ===== SpaceX 发射统计 =====
  if (path === '/spacex-stats' && method === 'GET') {
    const deny = checkPerm(user, 'spacex_stats'); if (deny) return deny
    return getSpaceXStats()
  }
  if (path === '/spacex-stats' && method === 'PUT') {
    const deny = checkPerm(user, 'spacex_stats'); if (deny) return deny
    return updateSpaceXStats(body, user)
  }
  if (path === '/spacex-stats/sync' && method === 'POST') {
    const deny = checkPerm(user, 'spacex_stats'); if (deny) return deny
    return syncSpaceXStatsFromAPI(user)
  }
  if (path === '/agencies/sync' && method === 'POST') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return syncAgenciesFromAPI(user)
  }
  if (path.startsWith('/spacex-stats/') && path !== '/spacex-stats/sync' && method === 'DELETE') {
    const deny = checkPerm(user, 'spacex_stats'); if (deny) return deny
    return deleteSpaceXStatsItem(path.split('/').pop(), user)
  }

  if (path === '/starship/nsf-checklist' && method === 'GET') return getNsfChecklistAdmin(user)
  if (path === '/starship/nsf-checklist/overrides' && method === 'PUT') return updateNsfChecklistOverrides(body, user)

  if (path === '/starship/status' && method === 'GET') return getStarshipStatus()
  if (path === '/starship/status' && method === 'PUT') return updateStarshipStatus(body, user)
  if (path === '/starship/splash' && method === 'GET') return getStarshipSplashConfig()
  if (path === '/starship/splash' && method === 'PUT') return updateStarshipSplashConfig(body, user)

  if (path === '/starship/checklist-history' && method === 'GET') return listChecklistHistory(query)
  if (path.startsWith('/starship/checklist-history/') && method === 'GET') return getChecklistHistoryById(path.split('/').pop())
  if (path.startsWith('/starship/checklist-history/') && method === 'DELETE') return deleteChecklistHistory(path.split('/').pop(), user)

  if (path === '/starship-events' && method === 'GET') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return listStarshipEvents(query)
  }
  if (path === '/starship-events' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return createStarshipEvent(body, user)
  }
  if (path.startsWith('/starship-events/') && method === 'PUT') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return updateStarshipEvent(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/starship-events/') && method === 'DELETE') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return deleteStarshipEvent(path.split('/').pop(), user)
  }

  if (path === '/carousel/global-enabled' && method === 'GET') return getCarouselGlobalEnabled()
  if (path === '/carousel/global-enabled' && method === 'PUT') return setCarouselGlobalEnabled(body, user)
  if (path === '/carousel/sync-auto' && method === 'POST') return syncAutoCarousel()
  if (path === '/carousel' && method === 'GET') return listCarousel()
  if (path === '/carousel' && method === 'POST') return createCarousel(body, user)
  if (path.startsWith('/carousel/') && method === 'PUT') return updateCarousel(path.split('/').pop(), body, user)
  if (path.startsWith('/carousel/') && method === 'DELETE') return deleteCarousel(path.split('/').pop(), user)

  if (path === '/users' && method === 'GET') {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    return listUsers(query)
  }
  if (path === '/users' && method === 'POST') {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    return createUser(body, user)
  }
  if (path.startsWith('/users/') && method === 'PUT') {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    return updateUser(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/users/') && method === 'DELETE') {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    return deleteUser(path.split('/').pop(), user, body)
  }
  if (path.startsWith('/users/') && method === 'POST' && path.endsWith('/restore')) {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    const id = path.split('/').slice(-2)[0]
    return restoreUser(id, user)
  }

  if (path === '/logs' && method === 'GET') {
    if (!mustRole(user, 'reviewer')) return fail(4030, '无权限')
    return listLogs(query)
  }
  if (path === '/logs/stats' && method === 'GET') {
    if (!mustRole(user, 'reviewer')) return fail(4030, '无权限')
    return getLogsStats()
  }
  if (path === '/logs/unread-by-module' && method === 'GET') {
    if (!mustRole(user, 'reviewer')) return fail(4030, '无权限')
    return getLogsUnreadByModule(query)
  }
  if (path === '/logs/clean' && method === 'POST') {
    if (!mustRole(user, 'super_admin')) return fail(4030, '无权限')
    return cleanLogs(body, user)
  }

  if (path === '/cos/presign' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return cosPresign(body)
  }
  if (path === '/cos/proxy-upload' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return cosProxyUpload(body)
  }
  if (path === '/cos/list' && method === 'GET') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return cosListFiles(query)
  }
  if (path === '/cos/folder' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return cosCreateFolder(body)
  }
  if (path === '/cos/file' && method === 'DELETE') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return cosDeleteFile(body, user)
  }

  if (path === '/rocket-config/sync-cos-index' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return syncRocketMediaCosIndex(user)
  }

  if (path === '/media-assets' && method === 'GET') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return listMediaAssets(query)
  }
  if (path === '/media-assets' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return createMediaAsset(body, user)
  }
  if (path.startsWith('/media-assets/') && method === 'PUT') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return updateMediaAsset(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/media-assets/') && method === 'DELETE') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return deleteMediaAsset(path.split('/').pop(), user)
  }
  if (path === '/media-assets/batch' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return batchUpdateMediaAssets(body, user)
  }

  if (path === '/media-feed' && method === 'GET') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return listMediaFeed(query)
  }
  if (path === '/media-feed' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return createMediaFeed(body, user)
  }
  if (path.startsWith('/media-feed/') && method === 'PUT') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return updateMediaFeed(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/media-feed/') && method === 'DELETE') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return deleteMediaFeed(path.split('/').pop(), user)
  }
  if (path === '/media-feed/batch' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return batchUpdateMediaFeed(body, user)
  }

  if (path === '/shop-feed' && method === 'GET') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return listShopFeed(query)
  }
  if (path === '/shop-feed' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return createShopFeed(body, user)
  }
  if (path.startsWith('/shop-feed/') && method === 'PUT') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return updateShopFeed(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/shop-feed/') && method === 'DELETE') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return deleteShopFeed(path.split('/').pop(), user)
  }
  if (path === '/shop-feed/batch' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    return batchUpdateShopFeed(body, user)
  }

  // ===== 权限模块列表 =====
  if (path === '/permissions/modules' && method === 'GET') return ok(PERMISSION_MODULES)

  // ===== 推送通知管理 =====
  if (path === '/push/subscriptions' && method === 'GET') {
    const deny = checkPerm(user, 'push_notify'); if (deny) return deny
    return listPushSubscriptions(query)
  }
  if (path === '/push/history' && method === 'GET') {
    const deny = checkPerm(user, 'push_notify'); if (deny) return deny
    return listPushHistory(query)
  }
  if (path === '/push/trigger' && method === 'POST') {
    const deny = checkPerm(user, 'push_notify'); if (deny) return deny
    return triggerPushNotification(body, user)
  }

  // ===== 发射数据管理 =====
  if (path === '/launch-data' && method === 'GET') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return listLaunchData(query)
  }
  if (path.startsWith('/launch-data/') && path !== '/launch-data/sync' && path !== '/launch-data/clean' && method === 'GET') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return getLaunchDataById(path.split('/').pop())
  }
  if (path.startsWith('/launch-data/') && path !== '/launch-data/sync' && path !== '/launch-data/clean' && method === 'PUT') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return updateLaunchData(path.split('/').pop(), body, user)
  }
  if (path === '/launch-data/sync' && method === 'POST') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return syncLaunchData(user)
  }
  if (path === '/launch-data/clean' && method === 'POST') {
    const deny = checkPerm(user, 'launch_data'); if (deny) return deny
    return cleanLaunchDataCache(user)
  }

  // ===== 推文同步监控 =====
  if (path === '/tweet-monitor' && method === 'GET') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    return listTweetMonitor(query)
  }
  if (path === '/tweet-monitor/status' && method === 'GET') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    return getTweetSyncStatus()
  }
  if (path === '/tweet-monitor/sync' && method === 'POST') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    return syncTweets(user)
  }
  if (path === '/tweet-monitor/accounts' && method === 'GET') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    return listTweetAccounts()
  }
  if (path === '/tweet-monitor/accounts' && method === 'POST') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    return addTweetAccount(body)
  }
  if (path.startsWith('/tweet-monitor/accounts/') && method === 'DELETE') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    const id = path.split('/').pop()
    return deleteTweetAccount(id)
  }
  if (path.startsWith('/tweet-monitor/accounts/') && path.endsWith('/toggle') && method === 'PUT') {
    const deny = checkPerm(user, 'tweet_monitor'); if (deny) return deny
    const parts = path.split('/')
    const id = parts[parts.length - 2]
    return toggleTweetAccount(id, body)
  }

  // ===== 数据统计分析 =====
  if (path === '/statistics/overview' && method === 'GET') {
    const deny = checkPerm(user, 'statistics'); if (deny) return deny
    return getStatisticsOverview()
  }

  // ===== 直播管理 =====
  if (path === '/live' && method === 'GET') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return getLiveConfig()
  }
  if (path === '/live' && method === 'PUT') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return updateLiveConfig(body, user)
  }
  if (path === '/channels-live-config' && method === 'PUT') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return updateChannelsLiveCoverConfig(body, user)
  }
  if (path === '/channels-live-fallback-guide' && method === 'PUT') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return updateChannelsLiveFallbackGuide(body, user)
  }

  // ===== 演示模式 =====
  if (path === '/demo-mode' && method === 'GET') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return getDemoConfig()
  }
  if (path === '/demo-mode' && method === 'PUT') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return updateDemoConfig(body, user)
  }
  if (path === '/demo-mode/command' && method === 'POST') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return sendDemoCommand(body, user)
  }
  if (path === '/demo-mode/audio' && method === 'GET') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return getDemoAudioUrls(query)
  }
  if (path === '/demo-mode/audio' && method === 'PUT') {
    const deny = checkPerm(user, 'live_mgmt'); if (deny) return deny
    return updateDemoAudioUrls(body, user)
  }

  // ===== 云函数管理 =====
  if (path === '/cloud-functions' && method === 'GET') {
    const deny = checkPerm(user, 'cloud_functions'); if (deny) return deny
    return listCloudFunctions()
  }
  if (path.startsWith('/cloud-functions/') && path.endsWith('/trigger') && method === 'POST') {
    const deny = checkPerm(user, 'cloud_functions'); if (deny) return deny
    const fnName = path.split('/')[2]
    return triggerCloudFunction(fnName, user)
  }

  // ===== 弹窗广告配置 =====
  if (path === '/popup-ad-config' && method === 'GET') {
    const deny = checkPerm(user, 'shop_feed'); if (deny) return deny
    return getPopupAdConfig()
  }
  if (path === '/popup-ad-config' && method === 'PUT') {
    const deny = checkPerm(user, 'shop_feed'); if (deny) return deny
    return updatePopupAdConfig(body, user)
  }

  // ===== 全局配置中心 =====
  if (path === '/global-config' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return getGlobalConfig()
  }
  if (path === '/global-config' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return updateGlobalConfig(body, user)
  }

  // ===== 年度报告配置 =====
  if (path === '/year-review-config' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return getYearReviewConfigForAdmin()
  }
  if (path === '/year-review-config' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return updateYearReviewConfigForAdmin(body, user)
  }
  if (path === '/year-review-config/rebuild-snapshot' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return rebuildYearReviewSnapshotAdmin(body, user)
  }

  // ===== 系统公告 =====
  if (path === '/announcements' && method === 'GET') {
    const deny = checkPerm(user, 'announcements'); if (deny) return deny
    return listAnnouncements(query)
  }
  if (path === '/announcements' && method === 'POST') {
    const deny = checkPerm(user, 'announcements'); if (deny) return deny
    return createAnnouncement(body, user)
  }
  if (path.startsWith('/announcements/') && method === 'PUT') {
    const deny = checkPerm(user, 'announcements'); if (deny) return deny
    return updateAnnouncement(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/announcements/') && method === 'DELETE') {
    const deny = checkPerm(user, 'announcements'); if (deny) return deny
    return deleteAnnouncement(path.split('/').pop(), user)
  }

  // ===== 数据导出 =====
  if (path === '/data-export' && method === 'POST') {
    const deny = checkPerm(user, 'data_export'); if (deny) return deny
    return exportCollectionData(body, user)
  }

  if (path === '/system/sync' && method === 'POST') {
    try {
      cloud.callFunction({ name: 'syncSpaceDevsData', data: { action: 'sync' } }).then(syncRes => {
        writeOpLog({ user, module: 'system', action: 'manual_sync', targetId: 'syncSpaceDevsData', after: syncRes.result || null }).catch(() => {})
      }).catch(() => {})
      return ok({ task: 'sync', message: '同步任务已触发，后台执行中' })
    } catch (e) {
      return fail(5001, '触发同步失败: ' + (e.message || String(e)))
    }
  }

  if (path === '/system/sync-spacex' && method === 'POST') {
    if (!mustRole(user, 'editor')) return fail(4030, '无权限')
    try {
      cloud.callFunction({ name: 'syncSpaceXTweets', data: { action: 'sync' } }).then(syncRes => {
        writeOpLog({ user, module: 'system', action: 'sync_spacex', targetId: 'syncSpaceXTweets', after: syncRes.result || null }).catch(() => {})
      }).catch(() => {})
      return ok({ task: 'sync_spacex', message: 'SpaceX 推文同步已触发，后台执行中' })
    } catch (e) {
      return fail(5001, '触发 SpaceX 同步失败: ' + (e.message || String(e)))
    }
  }

  if (path === '/system/cache/clean' && method === 'POST') {
    try {
      cloud.callFunction({ name: 'syncSpaceDevsData', data: { action: 'clean' } }).then(cleanRes => {
        writeOpLog({ user, module: 'system', action: 'clean_cache', targetId: 'syncSpaceDevsData', after: cleanRes.result || null }).catch(() => {})
      }).catch(() => {})
      return ok({ task: 'clean', message: '清理任务已触发，后台执行中' })
    } catch (e) {
      return fail(5002, '清理缓存失败: ' + (e.message || String(e)))
    }
  }

  // ===== 月愿计划管理 =====
  if (path === '/lunar-wishes/list' && method === 'GET') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    return listLunarWishes(query)
  }
  if (path === '/lunar-wishes/review' && method === 'POST') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    return reviewLunarWish(body, user)
  }
  if (path === '/lunar-wishes/batch-review' && method === 'POST') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    return batchReviewLunarWishes(body, user)
  }
  if (path === '/lunar-wishes/delete' && method === 'POST') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    const wishId = body.wishId || ''
    return deleteLunarWish(wishId, user)
  }
  if (path === '/lunar-wishes/export' && method === 'GET') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    return exportLunarWishes()
  }
  if (path === '/lunar-wishes/stats' && method === 'GET') {
    const deny = checkPerm(user, 'lunar_wishes'); if (deny) return deny
    return getLunarWishesStats()
  }

  // ===== 竞猜全局配置（后台） =====
  if (path === '/vote-config' && method === 'PUT') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return updateVoteConfig(body, user)
  }

  // ===== 发射竞猜管理（后台） =====
  if (path === '/launch-votes/rebuild-settle' && method === 'POST') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return rebuildLaunchVoteSettle(body, user)
  }
  if (path === '/launch-votes' && method === 'GET') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return listLaunchVotes(query)
  }
  if (path === '/launch-votes' && method === 'POST') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return createLaunchVote(body, user)
  }
  if (path.startsWith('/launch-votes/') && method === 'PUT') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return updateLaunchVote(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/launch-votes/') && method === 'DELETE') {
    const deny = checkPerm(user, 'launch_votes'); if (deny) return deny
    return deleteLaunchVote(path.split('/').pop(), user)
  }

  // ===== 里程碑彩蛋管理（后台） =====
  if (path === '/milestone-rewards' && method === 'GET') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    try { return await listMilestoneRewards(query) } catch (e) { return fail(5001, '里程碑列表加载失败: ' + (e.message || String(e))) }
  }
  if (path === '/milestone-rewards' && method === 'POST') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return createMilestoneReward(body, user)
  }
  if (path.startsWith('/milestone-rewards/') && method === 'PUT') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return updateMilestoneReward(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/milestone-rewards/') && method === 'DELETE') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return deleteMilestoneReward(path.split('/').pop(), user)
  }
  if (path === '/milestone-claims' && method === 'GET') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return listMilestoneClaims(query)
  }
  if (path.startsWith('/milestone-claims/') && method === 'PUT') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return updateMilestoneClaimStatus(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/milestone-claims/') && method === 'DELETE') {
    const deny = checkPerm(user, 'milestone_rewards'); if (deny) return deny
    return deleteMilestoneClaim(path.split('/').pop(), user)
  }

  // ===== 知识卡管理（后台） =====
  if (path === '/knowledge-cards' && method === 'GET') {
    const deny = checkPerm(user, 'knowledge_cards'); if (deny) return deny
    return listKnowledgeCards(query)
  }
  if (path === '/knowledge-cards' && method === 'POST') {
    const deny = checkPerm(user, 'knowledge_cards'); if (deny) return deny
    return createKnowledgeCard(body, user)
  }
  if (path.startsWith('/knowledge-cards/') && path !== '/knowledge-cards/public' && path !== '/knowledge-cards/batch-import' && method === 'PUT') {
    const deny = checkPerm(user, 'knowledge_cards'); if (deny) return deny
    return updateKnowledgeCard(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/knowledge-cards/') && path !== '/knowledge-cards/public' && path !== '/knowledge-cards/batch-import' && method === 'DELETE') {
    const deny = checkPerm(user, 'knowledge_cards'); if (deny) return deny
    return deleteKnowledgeCard(path.split('/').pop(), user)
  }

  // ===== 会员管理 =====
  if (path === '/membership/list' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return listMembershipData()
  }
  if (path === '/membership/pro-whitelist' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return updateMembershipProWhitelist(body, user)
  }
  if (path === '/membership/orders' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return listMembershipOrders(query)
  }
  if (path === '/membership/orders/export' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return exportMembershipOrders(query)
  }
  if (path === '/membership/orders/recheck-pending' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return recheckPendingOrders(body, user)
  }
  if (path === '/membership/grant-pro' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return grantMembershipPro(body, user)
  }
  if (path === '/membership/refund' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return refundMembershipOrder(body, user)
  }
  if (path === '/membership/vpay-config' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return updateVPayConfig(body, user)
  }
  if (path === '/membership/sku-prices' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return listMembershipSkuPrices()
  }
  if (path === '/membership/sku-prices' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return updateMembershipSkuPrices(body, user)
  }

  // ===== 邀请数据统计 =====
  if (path === '/invites/stats' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return getInviteStats()
  }
  if (path === '/invites/records' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return listInviteRecords(query)
  }
  if (path === '/knowledge-cards/batch-import' && method === 'POST') {
    const deny = checkPerm(user, 'knowledge_cards'); if (deny) return deny
    return batchImportKnowledgeCards(body, user)
  }

  // ===== B 站自动发文 =====
  if (path === '/bilibili-auto-publish' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().getBilibiliAutoPublish()
  }
  if (path === '/bilibili-auto-publish' && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().updateBilibiliAutoPublish(body, user)
  }
  if (path === '/bilibili-auto-publish/enqueue' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().enqueueBilibiliNow(user)
  }
  if (path === '/bilibili-topics' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().listTopics(query)
  }
  if (path === '/bilibili-topics' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().createTopic(body, user)
  }
  if (path === '/bilibili-topics/seed' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().seedTopics(user)
  }
  if (path.startsWith('/bilibili-topics/') && path.endsWith('/promote') && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    const id = path.split('/')[2]
    return biliPublishApi().promoteTopic(id, user)
  }
  if (path.startsWith('/bilibili-topics/') && path.endsWith('/reject') && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    const id = path.split('/')[2]
    return biliPublishApi().rejectTopic(id, user)
  }
  if (path.startsWith('/bilibili-topics/') && method === 'PUT') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().updateTopic(path.split('/').pop(), body, user)
  }
  if (path.startsWith('/bilibili-topics/') && method === 'DELETE') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().deleteTopic(path.split('/').pop(), user)
  }
  if (path === '/bilibili-topic-blacklist' && method === 'GET') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().listBlacklist()
  }
  if (path === '/bilibili-topic-blacklist' && method === 'POST') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().addBlacklist(body, user)
  }
  if (path.startsWith('/bilibili-topic-blacklist/') && method === 'DELETE') {
    const deny = checkPerm(user, 'global_config'); if (deny) return deny
    return biliPublishApi().removeBlacklist(path.split('/').pop())
  }

  return fail(4040, `未知路由: ${method} ${path}`)
}

function normalizeEvent(event = {}) {
  let bodyData = event.body
  if (typeof bodyData === 'string') {
    try {
      bodyData = JSON.parse(bodyData)
    } catch (e) {
      bodyData = {}
    }
  }

  const merged = {
    ...event,
    ...(bodyData && typeof bodyData === 'object' ? bodyData : {})
  }

  if (!merged.method && event.httpMethod) merged.method = event.httpMethod
  return merged
}

exports.main = async (event = {}, context) => {
  try {
    ensureAdminGatewayCollectionsOnce()

    // 预热快速路径：app 冷启动时静默调用，仅用于提前完成云函数实例冷启动，不查库
    if (event && event.path === '/ping') {
      return ok({ pong: true, ts: Date.now() })
    }

    // 定时触发器（微信云开发 cron）：event.Type === 'Timer' 或 event.scheduleAction
    if (event && (event.Type === 'Timer' || event.scheduleAction)) {
      const action = event.scheduleAction || 'recheck_pending_orders'
      console.log('[cron] triggered:', action)
      try {
        if (action === 'recheck_pending_orders') {
          const r = await recheckPendingOrders({}, { id: 'system', username: 'cron' })
          console.log('[cron] recheckPendingOrders result:', JSON.stringify(r))
          return r
        }
        return ok({ skipped: true, reason: 'unknown_action' })
      } catch (e) {
        console.error('[cron] error:', e && (e.stack || e.message || e))
        return fail(5000, '定时任务执行失败: ' + (e.message || String(e)))
      }
    }

    const normalized = normalizeEvent(event)
    const wxContext = cloud.getWXContext()
    normalized._openid = wxContext.OPENID || ''
    normalized._unionid = wxContext.UNIONID || ''
    normalized._clientIp = pickClientIp(event.headers || normalized.headers || {})
    normalized.headers = {
      ...(event.headers || {}),
      ...(normalized.headers || {})
    }
    const user = await requireAuth(event.headers || normalized.headers || {})
    const result = await route(normalized, user)
    return result || fail(5000, '路由未返回结果')
  } catch (error) {
    console.error('[adminGateway] main error:', error && error.stack ? error.stack : (error.message || String(error)))
    return fail(5000, error.message || '服务器异常')
  }
}
