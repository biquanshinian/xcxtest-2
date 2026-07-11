const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')

const WISHES_COLLECTION = 'lunar_wishes'
const STATS_COLLECTION = 'lunar_wishes_stats'
const LIKE_LOG_COLLECTION = 'lunar_wishes_likes'
const ADMIN_USERS_COLLECTION = 'admin_users'
const MAX_WISH_LENGTH = 200
const MAX_NAME_LENGTH = 20
const WISHES_PER_PAGE = 20
const RATE_LIMIT_MS = 30000

/** 与 adminGateway 一致的 JWT 校验（HS256 / base64url），fail-closed：未配置 TOKEN_SECRET 即拒绝 */
function parseAdminToken(token) {
  const secret = process.env.TOKEN_SECRET || ''
  if (!secret || secret.length < 32) return null
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    const [header, body, signature] = parts
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!data || !data.exp || data.exp < Date.now()) return null
    return data
  } catch (e) {
    return null
  }
}

/** 校验后台管理员身份：token → admin_users（active）。返回 user 或 null */
async function resolveAdminUser(event) {
  const headers = event.headers || {}
  const authHeader = headers.Authorization || headers.authorization || ''
  const token = String(event.token || authHeader.replace(/^Bearer\s+/i, '')).trim()
  if (!token) return null
  const parsed = parseAdminToken(token)
  if (!parsed || !parsed.id) return null
  const userRes = await db.collection(ADMIN_USERS_COLLECTION).doc(parsed.id).get().catch(() => null)
  const user = (userRes && userRes.data) || null
  if (!user || user.status !== 'active') return null
  if (Number(parsed.tokenVersion || 0) !== Number(user.tokenVersion || 0)) return null
  const isSuper = user.role === 'super_admin'
  const hasModule = Array.isArray(user.permissions) && user.permissions.includes('lunar_wishes')
  if (!isSuper && !hasModule) return null
  return { id: user._id, username: user.username, role: user.role || 'viewer' }
}

/**
 * 生成6位唯一登机牌编号: LW-XXXXXX
 */
function generateBoardingPassId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `LW-${code}`
}

/**
 * 微信公众平台内容安全 API（msg_sec_check v2）
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html
 *
 * scene：1 资料；2 评论；3 论坛；4 社交日志
 * suggest：pass 通过；risky 拦截；review 需人工复审
 * label：100 正常；10001 广告；20001 时政；20002 色情；20003 辱骂；
 *        20006 违法犯罪；20008 欺诈；20012 低俗；20013 版权；21000 其他
 *
 * 返回：{ suggest: 'pass'|'risky'|'review'|'error', label, errcode, errmsg }
 */
const SEC_LABEL_TEXT = {
  100: '正常',
  10001: '广告',
  20001: '时政',
  20002: '色情',
  20003: '辱骂',
  20006: '违法犯罪',
  20008: '欺诈',
  20012: '低俗',
  20013: '版权',
  21000: '其他'
}

function normalizeSecSuggest(suggest) {
  const s = String(suggest || '').toLowerCase()
  if (s === 'pass' || s === 'risky' || s === 'review') return s
  return ''
}

async function msgSecCheckV2({ openid, content, scene, nickname, title }) {
  const text = String(content || '').trim()
  if (!text) {
    return { suggest: 'pass', label: 100, errcode: 0, errmsg: 'empty' }
  }
  if (!openid) {
    // openid 为 v2 必填；缺失时无法调用，交由上层按「待审」处理，避免误放行
    return { suggest: 'error', label: 0, errcode: -1, errmsg: 'missing openid' }
  }

  try {
    const payload = {
      version: 2,
      scene: Number(scene) || 3,
      openid,
      content: text.slice(0, 2500)
    }
    if (nickname) payload.nickname = String(nickname).slice(0, 30)
    if (title) payload.title = String(title).slice(0, 100)

    const res = await cloud.openapi.security.msgSecCheck(payload)
    const errcode = res && res.errcode != null ? Number(res.errcode) : 0
    if (errcode !== 0) {
      console.warn('[LunarWishes] msgSecCheck errcode:', errcode, res && res.errmsg)
      return {
        suggest: 'error',
        label: 0,
        errcode,
        errmsg: (res && res.errmsg) || 'msgSecCheck failed'
      }
    }

    const result = (res && res.result) || {}
    const detail0 = Array.isArray(res && res.detail) && res.detail.length ? res.detail[0] : null
    const suggest = normalizeSecSuggest(result.suggest)
      || normalizeSecSuggest(detail0 && detail0.suggest)
      || 'pass'
    const label = result.label != null
      ? Number(result.label)
      : (detail0 && detail0.label != null ? Number(detail0.label) : 100)

    return {
      suggest,
      label,
      errcode: 0,
      errmsg: 'ok',
      labelText: SEC_LABEL_TEXT[label] || String(label)
    }
  } catch (e) {
    console.warn('[LunarWishes] msgSecCheck exception:', e && (e.errMsg || e.message || e))
    return {
      suggest: 'error',
      label: 0,
      errcode: (e && e.errCode) || -1,
      errmsg: (e && (e.errMsg || e.message)) || 'msgSecCheck exception'
    }
  }
}

/**
 * 对月愿提交的姓名 + 心愿做内容安全检测。
 * - 任一字段 risky → 整体拦截
 * - 任一字段 review / 接口异常 → 进入人工待审（不公开上墙）
 * - 全部 pass → 直接通过
 */
async function checkWishSubmission({ openid, name, wish }) {
  // 心愿上墙：论坛场景；姓名作为 nickname 一并送检
  const wishCheck = await msgSecCheckV2({
    openid,
    content: wish,
    scene: 3,
    nickname: name,
    title: '月愿计划'
  })
  if (wishCheck.suggest === 'risky') {
    return { decision: 'reject', checks: { wish: wishCheck }, reason: 'wish' }
  }

  // 姓名单独再检一次（资料场景），避免仅靠 nickname 旁路漏检
  let nameCheck = { suggest: 'pass', label: 100, errcode: 0 }
  if (name && name !== '匿名探索者') {
    nameCheck = await msgSecCheckV2({
      openid,
      content: name,
      scene: 1,
      nickname: name
    })
    if (nameCheck.suggest === 'risky') {
      return { decision: 'reject', checks: { wish: wishCheck, name: nameCheck }, reason: 'name' }
    }
  }

  const needsReview = [wishCheck, nameCheck].some(
    (c) => c.suggest === 'review' || c.suggest === 'error'
  )
  if (needsReview) {
    return { decision: 'pending', checks: { wish: wishCheck, name: nameCheck } }
  }
  return { decision: 'pass', checks: { wish: wishCheck, name: nameCheck } }
}

/**
 * 确保统计文档存在
 */
async function ensureStats() {
  try {
    await db.collection(STATS_COLLECTION).doc('global').get()
  } catch (e) {
    if (e.errCode === -1 || String(e.message).includes('not exist')) {
      await db.collection(STATS_COLLECTION).doc('global').set({
        data: {
          totalWishes: 0,
          totalParticipants: 0,
          countryCounts: {},
          updatedAt: Date.now()
        }
      })
    }
  }
}

// ========== 提交祝福 ==========
async function submitWish(event, openid) {
  const { name, wish, location, language } = event

  if (!wish || typeof wish !== 'string' || wish.trim().length === 0) {
    return { code: 400, message: '祝福内容不能为空' }
  }
  if (wish.trim().length > MAX_WISH_LENGTH) {
    return { code: 400, message: `祝福内容不能超过${MAX_WISH_LENGTH}字` }
  }
  if (!openid) {
    return { code: 401, message: '请先登录后再提交心愿' }
  }
  const safeName = (name || '匿名探索者').trim().slice(0, MAX_NAME_LENGTH)
  const safeWish = wish.trim()

  // 每人仅限一条心愿
  const existing = await db.collection(WISHES_COLLECTION)
    .where({ _openid: openid })
    .count()
  if (existing.total > 0) {
    return { code: 409, message: '每人仅限一份心愿' }
  }

  // 微信内容安全 API（msg_sec_check v2）：risky 拒绝；review/接口异常进待审；pass 直接上墙
  const sec = await checkWishSubmission({ openid, name: safeName, wish: safeWish })
  if (sec.decision === 'reject') {
    return {
      code: 403,
      message: '内容包含敏感信息，请修改后重新提交',
      data: { secLabel: (sec.checks.wish && sec.checks.wish.label) || (sec.checks.name && sec.checks.name.label) || 0 }
    }
  }

  const status = sec.decision === 'pass' ? 'approved' : 'pending'
  const boardingPassId = generateBoardingPassId()
  const now = Date.now()

  const doc = {
    _openid: openid,
    name: safeName,
    wish: safeWish,
    location: (location || '').trim().slice(0, 50),
    language: language || 'zh',
    boardingPassId,
    status,
    likes: 0,
    createdAt: now,
    updatedAt: now,
    // 内容安全审计字段（后台可查）
    secCheck: {
      decision: sec.decision,
      wish: sec.checks.wish || null,
      name: sec.checks.name || null,
      checkedAt: now
    }
  }

  const res = await db.collection(WISHES_COLLECTION).add({ data: doc })

  // 仅「已通过」计入公开统计；待审不进星空墙
  if (status === 'approved') {
    await ensureStats()
    try {
      const statsUpdate = {
        totalWishes: _.inc(1),
        totalParticipants: _.inc(1),
        updatedAt: now
      }
      const country = (location || '').trim().slice(0, 50).replace(/[.\$]/g, '_')
      if (country) {
        statsUpdate[`countryCounts.${country}`] = _.inc(1)
      }
      await db.collection(STATS_COLLECTION).doc('global').update({
        data: statsUpdate
      })
    } catch (e) {
      console.warn('[LunarWishes] 统计更新失败:', e.message || e)
    }
  }

  return {
    code: 0,
    message: status === 'approved' ? '祝福已送出' : '心愿已提交，审核通过后将点亮星空',
    data: {
      _id: res._id,
      boardingPassId,
      name: safeName,
      wish: safeWish,
      status,
      createdAt: now
    }
  }
}

// ========== 获取祝福墙 ==========
async function getWishWall(event) {
  const { page = 0, pageSize = WISHES_PER_PAGE, sort = 'latest' } = event

  const where = { status: 'approved' }
  const orderField = sort === 'hot' ? 'likes' : 'createdAt'

  const countRes = await db.collection(WISHES_COLLECTION).where(where).count()
  const res = await db.collection(WISHES_COLLECTION)
    .where(where)
    .orderBy(orderField, 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .field({ name: true, wish: true, location: true, boardingPassId: true, likes: true, createdAt: true })
    .get()

  return {
    code: 0,
    data: {
      list: res.data || [],
      total: countRes.total,
      hasMore: (page + 1) * pageSize < countRes.total
    }
  }
}

// ========== 获取统计数据 ==========
async function getStats() {
  await ensureStats()
  try {
    const res = await db.collection(STATS_COLLECTION).doc('global').get()
    return { code: 0, data: res.data }
  } catch (e) {
    return { code: 0, data: { totalWishes: 0, totalParticipants: 0 } }
  }
}

// ========== 获取我的祝福 ==========
async function getMyWishes(openid) {
  const res = await db.collection(WISHES_COLLECTION)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  return { code: 0, data: res.data || [] }
}

// ========== 点赞 ==========
async function likeWish(event, openid) {
  const { wishId } = event
  if (!wishId) return { code: 400, message: '缺少参数' }
  if (!openid) return { code: 401, message: '未授权' }

  // 去重 + 限流：同一用户对同一心愿仅能点赞一次，且全局点赞有最小间隔
  const likeId = `${openid}_${wishId}`
  try {
    const dup = await db.collection(LIKE_LOG_COLLECTION).doc(likeId).get()
    if (dup && dup.data) return { code: 409, message: '已点赞过' }
  } catch (e) {}

  const now = Date.now()
  try {
    const recent = await db.collection(LIKE_LOG_COLLECTION)
      .where({ openid, createdAt: _.gt(now - RATE_LIMIT_MS) })
      .count()
    if (recent.total > 0) return { code: 429, message: '操作过于频繁，请稍后再试' }
  } catch (e) {}

  try {
    await db.collection(LIKE_LOG_COLLECTION).doc(likeId).set({
      data: { openid, wishId, createdAt: now }
    })
  } catch (e) {
    return { code: 409, message: '已点赞过' }
  }

  try {
    await db.collection(WISHES_COLLECTION).doc(wishId).update({
      data: { likes: _.inc(1), updatedAt: now }
    })
    return { code: 0, message: '已点赞' }
  } catch (e) {
    try { await db.collection(LIKE_LOG_COLLECTION).doc(likeId).remove() } catch (e2) {}
    console.error('[LunarWishes] 点赞失败:', e.message || e)
    return { code: 500, message: '点赞失败' }
  }
}

// ========== 管理接口：审核/删除 ==========
async function adminAction(event, openid) {
  const { action: adminOp, wishId, status } = event

  // 统一鉴权：与 adminGateway 一致的 admin_users / JWT 体系
  const adminUser = await resolveAdminUser(event)
  if (!adminUser) return { code: 403, message: '无权限' }

  if (adminOp === 'review' && wishId && status) {
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return { code: 400, message: '无效状态' }
    }
    let prev = null
    try {
      const prevRes = await db.collection(WISHES_COLLECTION).doc(wishId).get()
      prev = prevRes && prevRes.data
    } catch (e) {}
    await db.collection(WISHES_COLLECTION).doc(wishId).update({
      data: { status, updatedAt: Date.now() }
    })
    // 待审 → 通过：补计入公开统计
    if (prev && prev.status !== 'approved' && status === 'approved') {
      await ensureStats()
      try {
        const now = Date.now()
        const statsUpdate = {
          totalWishes: _.inc(1),
          totalParticipants: _.inc(1),
          updatedAt: now
        }
        const country = String(prev.location || '').trim().slice(0, 50).replace(/[.\$]/g, '_')
        if (country) statsUpdate[`countryCounts.${country}`] = _.inc(1)
        await db.collection(STATS_COLLECTION).doc('global').update({ data: statsUpdate })
      } catch (e) {
        console.warn('[LunarWishes] 审核通过后统计更新失败:', e.message || e)
      }
    }
    return { code: 0, message: '审核完成' }
  }

  if (adminOp === 'delete' && wishId) {
    await db.collection(WISHES_COLLECTION).doc(wishId).remove()
    return { code: 0, message: '已删除' }
  }

  if (adminOp === 'list') {
    const { page = 0, pageSize = 20, filterStatus } = event
    const where = filterStatus ? { status: filterStatus } : {}
    const countRes = await db.collection(WISHES_COLLECTION).where(where).count()
    const res = await db.collection(WISHES_COLLECTION)
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()
    return { code: 0, data: { list: res.data, total: countRes.total, hasMore: (page + 1) * pageSize < countRes.total } }
  }

  return { code: 400, message: '未知操作' }
}

// ========== 获取当前用户的心愿（单条） ==========
async function getMyWish(openid) {
  const res = await db.collection(WISHES_COLLECTION)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (res.data && res.data.length > 0) {
    return { code: 0, data: res.data[0] }
  }
  return { code: 0, data: null }
}

// ========== 根据 passId 获取登机牌 ==========
async function getByPassId(event) {
  const { passId } = event
  if (!passId) return { code: 400, message: '缺少 passId' }
  const res = await db.collection(WISHES_COLLECTION)
    .where({ boardingPassId: passId, status: 'approved' })
    .limit(1)
    .get()
  if (res.data && res.data.length > 0) {
    return { code: 0, data: res.data[0] }
  }
  return { code: 404, message: '未找到该登机牌' }
}

let _lunarWishesCollectionsEnsured = false
async function ensureLunarWishesCollectionsOnce() {
  if (_lunarWishesCollectionsEnsured) return
  _lunarWishesCollectionsEnsured = true
  try {
    await db.createCollection(WISHES_COLLECTION)
  } catch (e) {}
  try {
    await db.createCollection(STATS_COLLECTION)
  } catch (e) {}
  try {
    await db.createCollection(LIKE_LOG_COLLECTION)
  } catch (e) {}
}

// ========== 主入口 ==========
exports.main = async (event = {}) => {
  await ensureLunarWishesCollectionsOnce()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  // 兼容：小程序 callFunction 的 data、控制台测试、HTTP 触发 body 字符串
  let payload = event
  if (event && typeof event.body === 'string' && event.body) {
    try { payload = { ...event, ...JSON.parse(event.body) } } catch (e) {}
  } else if (event && event.data && typeof event.data === 'object') {
    payload = { ...event, ...event.data }
  }
  const action = String((payload && payload.action) || '').trim()

  try {
    switch (action) {
      case 'submit': return await submitWish(payload, openid)
      case 'wall': return await getWishWall(payload)
      case 'stats': return await getStats()
      case 'myWish': return await getMyWish(openid)
      case 'myWishes': return await getMyWishes(openid)
      case 'getByPassId': return await getByPassId(payload)
      case 'like': return await likeWish(payload, openid)
      case 'admin': return await adminAction(payload, openid)
      case 'ping':
      case 'health':
        return { code: 0, message: 'ok', data: { service: 'lunarWishes', openid: !!openid } }
      default:
        return {
          code: 400,
          message: action
            ? ('未知 action: ' + action)
            : '缺少 action。可用：submit / wall / stats / myWish / like / admin / ping',
          data: { receivedKeys: Object.keys(event || {}) }
        }
    }
  } catch (e) {
    console.error('[LunarWishes] 错误:', e)
    return { code: 500, message: e.message || '服务异常' }
  }
}
