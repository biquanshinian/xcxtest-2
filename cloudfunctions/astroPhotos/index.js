/**
 * 航天摄影（影像）UGC
 * actions: getPresign | submit | listPublic | getDetail | listMine | deleteMine | editMine | admin
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION = 'astro_photos'
const ADMIN_USERS_COLLECTION = 'admin_users'
const GLOBAL_CONFIG_COLLECTION = 'global_config'

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
const COS_PREFIX = '航天摄影'

const MAX_PHOTOS = 8
const MAX_BYTES = 30 * 1024 * 1024
const MAX_EDGE = 3840
const MAX_AUTHOR = 40
const MAX_LOCATION = 80
const MAX_DEVICE = 60
const MAX_INTRO = 2000
const MAX_OWNER_EDITS = 1
const PAGE_SIZE = 20
const RATE_LIMIT_MS = 30 * 1000
const DAILY_SUBMIT_LIMIT = 5
const PRESIGN_EXPIRES = 900
const UPLOAD_PASSWORD = 'zghtzp'
const ALLOWED_EXT = { jpg: true, jpeg: true, png: true, webp: true, heic: true }

function checkUploadPassword(event) {
  const pwd = String((event && (event.password || event.uploadPassword)) || '').trim()
  if (!pwd) return { ok: false, code: 400, message: '请填写投稿密码' }
  if (pwd !== UPLOAD_PASSWORD) return { ok: false, code: 403, message: '投稿密码错误' }
  return { ok: true }
}

let _cosMod = null
function getCOSSdk() {
  if (!_cosMod) _cosMod = require('cos-nodejs-sdk-v5')
  return _cosMod
}

function createCOSClient() {
  const COS = getCOSSdk()
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

function now() {
  return Date.now()
}

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
  const hasModule = Array.isArray(user.permissions) && user.permissions.includes('astro_photos')
  if (!isSuper && !hasModule) return null
  return { id: user._id, username: user.username, role: user.role || 'viewer' }
}

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
  if (s === 'pass' || s === 'risky' || s === 'review' || s === 'error') return s
  return ''
}

async function msgSecCheckV2({ openid, content, scene, nickname, title }) {
  const text = String(content || '').trim()
  if (!text) {
    return { suggest: 'pass', label: 100, errcode: 0, errmsg: 'empty' }
  }
  if (!openid) {
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
    return {
      suggest: 'error',
      label: 0,
      errcode: (e && e.errCode) || -1,
      errmsg: (e && (e.errMsg || e.message)) || 'msgSecCheck exception'
    }
  }
}

async function checkTextFields({ openid, authorName, location, deviceModel, intro }) {
  const checks = {}
  const authorCheck = await msgSecCheckV2({
    openid,
    content: authorName,
    scene: 1,
    nickname: authorName,
    title: '航天摄影作者'
  })
  checks.authorName = authorCheck
  if (authorCheck.suggest === 'risky') {
    return { decision: 'reject', checks, reason: 'authorName' }
  }

  if (location) {
    const locCheck = await msgSecCheckV2({
      openid,
      content: location,
      scene: 1,
      nickname: authorName,
      title: '航天摄影地点'
    })
    checks.location = locCheck
    if (locCheck.suggest === 'risky') {
      return { decision: 'reject', checks, reason: 'location' }
    }
  }

  if (deviceModel) {
    const deviceCheck = await msgSecCheckV2({
      openid,
      content: deviceModel,
      scene: 1,
      nickname: authorName,
      title: '航天摄影设备'
    })
    checks.deviceModel = deviceCheck
    if (deviceCheck.suggest === 'risky') {
      return { decision: 'reject', checks, reason: 'deviceModel' }
    }
  }

  if (intro) {
    const introCheck = await msgSecCheckV2({
      openid,
      content: intro,
      scene: 3,
      nickname: authorName,
      title: '航天摄影简介'
    })
    checks.intro = introCheck
    if (introCheck.suggest === 'risky') {
      return { decision: 'reject', checks, reason: 'intro' }
    }
  }

  // UGC 一律进人工待审；risky 已在上方拦截
  return { decision: 'pending', checks }
}

function normalizeExt(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  if (e === 'jpeg') return 'jpg'
  return e
}

function buildCosUrl(key) {
  return `${COS_BASE_URL}${encodeURI(String(key || '').replace(/^\/+/, ''))}`
}

function userPrefix(openid) {
  return `${COS_PREFIX}/${openid}/`
}

function isOwnedKey(openid, key) {
  const k = String(key || '').replace(/^\/+/, '')
  return k.startsWith(userPrefix(openid))
}

function isOwnedUrl(openid, url) {
  const u = String(url || '').trim()
  if (!u.startsWith(COS_BASE_URL)) return false
  try {
    const path = decodeURIComponent(u.slice(COS_BASE_URL.length))
    return isOwnedKey(openid, path)
  } catch (e) {
    return false
  }
}

function dayStartMs(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ── 降耗：实例内短缓存（多实例各自独立；跨实例靠 listEpoch）──
const FLAG_CACHE_TTL_MS = 90 * 1000
const LIST_CACHE_TTL_MS = 45 * 1000
const EPOCH_CACHE_TTL_MS = 5 * 1000
let _flagCache = { at: 0, value: false }
let _epochCache = { at: 0, value: 0, latestAt: 0 }
let _listPublicCache = { at: 0, key: '', data: null }

function bustListPublicCache() {
  _listPublicCache = { at: 0, key: '', data: null }
}

async function isFeatureEnabled() {
  const now = Date.now()
  if (_flagCache.at && now - _flagCache.at < FLAG_CACHE_TTL_MS) {
    return _flagCache.value
  }
  try {
    const res = await db.collection(GLOBAL_CONFIG_COLLECTION).doc('main').get()
    const cfg = (res && res.data) || {}
    const value = cfg.enableAstroPhotos === true
    _flagCache = { at: now, value }
    const epoch = Number(cfg.astroPhotosListEpoch) || 0
    const latestAt = Number(cfg.astroPhotosLatestAt) || 0
    _epochCache = { at: now, value: epoch, latestAt }
    return value
  } catch (e) {
    // failClosed：读失败一律视为关闭，避免旧 true 粘住导致过审关不掉
    _flagCache = { at: now, value: false }
    return false
  }
}

/** 列表缓存世代 + 最新上墙时间（供导航红点）；多实例最多约 5s 感知 */
async function getListMeta() {
  const now = Date.now()
  if (_epochCache.at && now - _epochCache.at < EPOCH_CACHE_TTL_MS) {
    return { epoch: _epochCache.value || 0, latestAt: _epochCache.latestAt || 0 }
  }
  try {
    const res = await db.collection(GLOBAL_CONFIG_COLLECTION).doc('main').get()
    const cfg = (res && res.data) || {}
    const epoch = Number(cfg.astroPhotosListEpoch) || 0
    const latestAt = Number(cfg.astroPhotosLatestAt) || 0
    _epochCache = { at: now, value: epoch, latestAt }
    if (!_flagCache.at || now - _flagCache.at >= FLAG_CACHE_TTL_MS) {
      _flagCache = { at: now, value: cfg.enableAstroPhotos === true }
    }
    return { epoch, latestAt }
  } catch (e) {
    if (_epochCache.at) {
      return { epoch: _epochCache.value || 0, latestAt: _epochCache.latestAt || 0 }
    }
    return { epoch: 0, latestAt: 0 }
  }
}

/**
 * @param {{ touchLatest?: boolean, latestAt?: number }} [opts]
 * touchLatest：有内容上墙时更新 astroPhotosLatestAt，驱动小程序「航天摄影」红点
 */
async function bumpListEpoch(opts) {
  const ts = Date.now()
  const data = { astroPhotosListEpoch: ts }
  if (opts && opts.touchLatest) {
    data.astroPhotosLatestAt = Number(opts.latestAt) || ts
  }
  try {
    // 只用 update，避免 set 整份 main 冲掉其它全局开关
    await db.collection(GLOBAL_CONFIG_COLLECTION).doc('main').update({ data })
  } catch (e) {
    console.warn('[AstroPhotos] bumpListEpoch failed:', e && (e.message || e))
  }
  _epochCache = { at: 0, value: 0, latestAt: 0 }
  bustListPublicCache()
}

async function getPresign(event, openid) {
  if (!openid) return { code: 401, message: '请先登录后再上传' }
  const enabled = await isFeatureEnabled()
  if (!enabled) return { code: 403, message: '航天摄影投稿暂未开放' }
  const pwdCheck = checkUploadPassword(event)
  if (!pwdCheck.ok) return { code: pwdCheck.code, message: pwdCheck.message }

  const ext = normalizeExt(event.ext || event.extension || 'jpg')
  if (!ALLOWED_EXT[ext] && !ALLOWED_EXT[ext === 'jpg' ? 'jpeg' : ext]) {
    return { code: 400, message: '仅支持 jpg/png/webp/heic 图片' }
  }
  const size = Number(event.size || 0)
  if (size > 0 && size > MAX_BYTES) {
    return { code: 400, message: '单张照片不能超过 30MB' }
  }
  const width = Number(event.width || 0)
  const height = Number(event.height || 0)
  if ((width > 0 || height > 0) && Math.max(width, height) > MAX_EDGE) {
    return { code: 400, message: '照片最长边不能超过 4K（3840）' }
  }

  const safeExt = ALLOWED_EXT[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
  const rand = crypto.randomBytes(4).toString('hex')
  const key = `${userPrefix(openid)}${now()}_${rand}.${safeExt}`

  // 小程序端用 wx.uploadFile + PostObject（避免大文件 ArrayBuffer PUT 受限）
  // 文档：https://cloud.tencent.com/document/product/436/14690
  const secretId = process.env.TENCENTCLOUD_SECRETID || ''
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || ''
  const securityToken = process.env.TENCENTCLOUD_SESSIONTOKEN || ''
  if (!secretId || !secretKey) {
    return { code: 500, message: '存储凭证未配置' }
  }

  const startTime = Math.floor(Date.now() / 1000)
  const expireAt = startTime + PRESIGN_EXPIRES
  const keyTime = `${startTime};${expireAt}`
  const expiration = new Date(expireAt * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z')
  const conditions = [
    { bucket: COS_BUCKET },
    ['eq', '$key', key],
    ['content-length-range', 1, MAX_BYTES],
    { 'q-sign-algorithm': 'sha1' },
    { 'q-ak': secretId },
    { 'q-sign-time': keyTime }
  ]
  if (securityToken) {
    conditions.push({ 'x-cos-security-token': securityToken })
  }
  // PostObject 签名：SignKey=HMAC(SecretKey,KeyTime)；StringToSign=SHA1(Policy文本)；Signature=HMAC(SignKey,StringToSign)
  conditions.push({ success_action_status: '200' })
  const policyObj = { expiration, conditions }
  const policyText = JSON.stringify(policyObj)
  const policy = Buffer.from(policyText).toString('base64')
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex')
  const stringToSign = crypto.createHash('sha1').update(policyText).digest('hex')
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex')

  const formData = {
    key,
    policy,
    success_action_status: '200',
    'q-sign-algorithm': 'sha1',
    'q-ak': secretId,
    'q-key-time': keyTime,
    'q-signature': signature
  }
  if (securityToken) {
    formData['x-cos-security-token'] = securityToken
  }

  const host = `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com`
  return {
    code: 0,
    data: {
      uploadUrl: `https://${host}`,
      cosUrl: buildCosUrl(key),
      key,
      expiresIn: PRESIGN_EXPIRES,
      formData
    }
  }
}

function extractCosKeyFromUrl(url) {
  const u = String(url || '').trim()
  if (!u.startsWith(COS_BASE_URL)) return ''
  try {
    return decodeURIComponent(u.slice(COS_BASE_URL.length)).replace(/^\/+/, '')
  } catch (e) {
    return ''
  }
}

function isCloudFileId(fileID) {
  return /^cloud:\/\//i.test(String(fileID || '').trim())
}

function normalizePhotoMeta(raw) {
  if (!raw || typeof raw !== 'object') return null
  const width = Math.max(0, Math.round(Number(raw.width) || 0))
  const height = Math.max(0, Math.round(Number(raw.height) || 0))
  if (!(width > 0 && height > 0)) return null
  if (Math.max(width, height) > MAX_EDGE) return null
  const size = Math.max(0, Number(raw.size) || 0)
  if (size > MAX_BYTES) return null
  const fileID = String(raw.fileID || '').trim()
  if (!isCloudFileId(fileID)) return null
  const ext = normalizeExt(raw.ext || 'jpg')
  const safeExt = ALLOWED_EXT[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
  const aspectRatio = width / height
  return {
    fileID,
    width,
    height,
    size,
    ext: safeExt,
    aspectRatio: Math.max(0.2, Math.min(5, Number(raw.aspectRatio) || aspectRatio || 1))
  }
}

/** 密码投稿仅在文本安检明确通过时自动上墙；review/error 进待审 */
function textSecAllowsAutoApprove(sec) {
  if (!sec || sec.decision === 'reject') return false
  const checks = sec.checks || {}
  for (const key of Object.keys(checks)) {
    const suggest = normalizeSecSuggest(checks[key] && checks[key].suggest)
    if (suggest === 'risky' || suggest === 'review' || suggest === 'error') return false
  }
  return true
}

function putObjectToCos(key, body, contentType) {
  const cos = createCOSClient()
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

/** 云存储临时 fileID → COS（避免小程序直传 COS 签名/域名问题） */
async function transferCloudFileToCos(openid, meta) {
  if (!meta || !meta.fileID) throw new Error('缺少云文件')
  const dl = await cloud.downloadFile({ fileID: meta.fileID })
  const buf = dl && dl.fileContent
  if (!buf || !buf.length) throw new Error('下载临时文件失败')
  if (buf.length > MAX_BYTES) throw new Error('单张照片不能超过 30MB')

  const rand = crypto.randomBytes(4).toString('hex')
  const key = `${userPrefix(openid)}${now()}_${rand}.${meta.ext || 'jpg'}`
  const contentType = meta.ext === 'png'
    ? 'image/png'
    : (meta.ext === 'webp' ? 'image/webp' : 'image/jpeg')
  await putObjectToCos(key, buf, contentType)

  try {
    await cloud.deleteFile({ fileList: [meta.fileID] })
  } catch (e) {}

  return {
    url: buildCosUrl(key),
    cosKey: key,
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.aspectRatio
  }
}

async function submit(event, openid) {
  if (!openid) return { code: 401, message: '请先登录后再投稿' }
  const enabled = await isFeatureEnabled()
  if (!enabled) return { code: 403, message: '航天摄影投稿暂未开放' }
  const pwdCheck = checkUploadPassword(event)
  if (!pwdCheck.ok) return { code: pwdCheck.code, message: pwdCheck.message }

  const authorName = String(event.authorName || '').trim().slice(0, MAX_AUTHOR)
  if (!authorName) return { code: 400, message: '请填写作者名字' }
  const location = String(event.location || '').trim().slice(0, MAX_LOCATION)
  const deviceModel = String(event.deviceModel || event.device || '').trim().slice(0, MAX_DEVICE)
  const intro = String(event.intro || '').trim().slice(0, MAX_INTRO)
  const shotAtRaw = event.shotAt
  let shotAt = ''
  if (typeof shotAtRaw === 'number' && shotAtRaw > 0) {
    shotAt = new Date(shotAtRaw).toISOString().slice(0, 10)
  } else {
    shotAt = String(shotAtRaw || '').trim().slice(0, 32)
  }

  const rawPhotos = Array.isArray(event.photos) ? event.photos : []
  if (!rawPhotos.length) return { code: 400, message: '请至少上传 1 张照片' }
  if (rawPhotos.length > MAX_PHOTOS) return { code: 400, message: `最多支持 ${MAX_PHOTOS} 张照片` }

  const metas = []
  for (const p of rawPhotos) {
    const meta = normalizePhotoMeta(p)
    if (!meta || !meta.fileID) {
      return { code: 400, message: '照片信息不合法或尺寸超限（最长边 4K）' }
    }
    metas.push(meta)
  }

  const ts = now()
  try {
    const recent = await db.collection(COLLECTION)
      .where({ _openid: openid, createdAt: _.gt(ts - RATE_LIMIT_MS) })
      .count()
    if (recent.total > 0) {
      return { code: 429, message: '操作过于频繁，请稍后再试' }
    }
  } catch (e) {}

  try {
    const dayStart = dayStartMs(ts)
    const daily = await db.collection(COLLECTION)
      .where({ _openid: openid, createdAt: _.gte(dayStart) })
      .count()
    if (daily.total >= DAILY_SUBMIT_LIMIT) {
      return { code: 429, message: `每日最多投稿 ${DAILY_SUBMIT_LIMIT} 条` }
    }
  } catch (e) {}

  const sec = await checkTextFields({ openid, authorName, location, deviceModel, intro })
  if (sec.decision === 'reject') {
    return {
      code: 403,
      message: '内容包含敏感信息，请修改后重新提交',
      data: { reason: sec.reason }
    }
  }

  const photos = []
  try {
    for (const meta of metas) {
      photos.push(await transferCloudFileToCos(openid, meta))
    }
  } catch (e) {
    console.error('[AstroPhotos] transfer COS failed:', e && (e.message || e))
    // 半途失败：清理已转存 COS + 仍留在云存储的临时文件
    try {
      await deleteCosKeys(photos.map((p) => p && p.cosKey).filter(Boolean))
    } catch (cleanErr) {}
    try {
      const left = metas.map((m) => m.fileID).filter(Boolean)
      if (left.length) await cloud.deleteFile({ fileList: left.slice(0, MAX_PHOTOS) })
    } catch (cleanErr) {}
    return { code: 500, message: (e && e.message) || '图片转存失败，请重试' }
  }

  const cover = photos[0]
  // 持密码 + 文本安检通过 → 直接上墙；安检异常/需复审 → 待审
  // _openid 记录上传者，供本人删除鉴权
  const autoApprove = textSecAllowsAutoApprove(sec)
  const status = autoApprove ? 'approved' : 'pending'
  const doc = {
    _openid: openid,
    authorName,
    location,
    deviceModel,
    shotAt,
    intro,
    photos,
    coverUrl: cover.url,
    coverAspectRatio: cover.aspectRatio,
    photoCount: photos.length,
    status,
    secText: {
      decision: sec.decision,
      checks: sec.checks,
      checkedAt: ts,
      autoApprove
    },
    secMedia: null,
    editCount: 0,
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: autoApprove ? ts : null,
    reviewedBy: autoApprove ? 'password_gate' : ''
  }

  const res = await db.collection(COLLECTION).add({ data: doc })
  await bumpListEpoch(status === 'approved' ? { touchLatest: true, latestAt: ts } : undefined)

  try {
    await runMediaCheck(res._id, openid, photos)
  } catch (e) {
    console.warn('[AstroPhotos] mediaCheck failed:', e && (e.message || e))
  }

  return {
    code: 0,
    message: autoApprove ? '发布成功' : '已提交审核，通过后将展示',
    data: { _id: res._id, status, createdAt: ts, editCount: 0, canEdit: true }
  }
}

async function runMediaCheck(docId, openid, photos) {
  if (!cloud.openapi || !cloud.openapi.security || !cloud.openapi.security.mediaCheckAsync) {
    return
  }
  const results = []
  for (const p of (photos || []).slice(0, MAX_PHOTOS)) {
    try {
      const res = await cloud.openapi.security.mediaCheckAsync({
        media_url: p.url,
        media_type: 2,
        version: 2,
        scene: 1,
        openid
      })
      results.push({
        url: p.url,
        errcode: res && res.errcode,
        trace_id: res && (res.trace_id || res.traceId)
      })
    } catch (e) {
      results.push({ url: p.url, error: (e && (e.message || e.errMsg)) || 'mediaCheck exception' })
    }
  }
  await db.collection(COLLECTION).doc(docId).update({
    data: {
      secMedia: { submittedAt: now(), results },
      updatedAt: now()
    }
  }).catch(() => {})
}

function resolvePhotoCount(doc) {
  if (!doc) return 0
  // 区分「缺字段」与「真 0」：有显式非负 photoCount 时优先生效
  if (doc.photoCount != null && doc.photoCount !== '') {
    const n = Math.max(0, Number(doc.photoCount) || 0)
    return Math.min(MAX_PHOTOS, n)
  }
  if (Array.isArray(doc.photos)) return Math.min(MAX_PHOTOS, doc.photos.length)
  return 0
}

/** 旧稿无 photoCount：补读 photos 长度并异步回填，避免列表角标恒 0 */
async function ensurePhotoCounts(docs) {
  const list = Array.isArray(docs) ? docs : []
  const need = list.filter((d) => d && d._id && (d.photoCount == null || d.photoCount === ''))
  if (!need.length) return list
  await Promise.all(need.slice(0, 20).map(async (doc) => {
    try {
      const full = await db.collection(COLLECTION).doc(doc._id)
        .field({ photos: true, photoCount: true })
        .get()
      const data = full && full.data
      const n = resolvePhotoCount(data || doc)
      doc.photoCount = n
      if (data && (data.photoCount == null || data.photoCount === '') && n >= 0) {
        db.collection(COLLECTION).doc(doc._id).update({
          data: { photoCount: n, updatedAt: now() }
        }).catch(() => {})
      }
    } catch (e) {
      if (Array.isArray(doc.photos)) doc.photoCount = doc.photos.length
    }
  }))
  return list
}

function publicItem(doc, opts = {}) {
  if (!doc) return null
  const editCount = Math.max(0, Number(doc.editCount) || 0)
  const isOwner = !!opts.isOwner
  const includePhotos = opts.includePhotos !== false
  const photos = includePhotos && Array.isArray(doc.photos) ? doc.photos : []
  return {
    id: doc._id,
    authorName: doc.authorName || '',
    location: doc.location || '',
    deviceModel: doc.deviceModel || '',
    shotAt: doc.shotAt || '',
    intro: includePhotos ? (doc.intro || '') : '',
    photos,
    photoCount: resolvePhotoCount(doc),
    coverUrl: doc.coverUrl || '',
    coverAspectRatio: doc.coverAspectRatio || 1,
    status: doc.status,
    createdAt: doc.createdAt || 0,
    updatedAt: doc.updatedAt || 0,
    editCount,
    isOwner,
    canEdit: isOwner && editCount < MAX_OWNER_EDITS
  }
}

function normalizeKeepPhoto(raw, openid, allowedKeySet) {
  if (!raw || typeof raw !== 'object') return null
  const url = String(raw.url || '').trim()
  let cosKey = String(raw.cosKey || '').trim().replace(/^\/+/, '')
  if (!cosKey) cosKey = extractCosKeyFromUrl(url)
  if (!cosKey) return null
  if (!allowedKeySet.has(cosKey) && !isOwnedKey(openid, cosKey)) return null
  const width = Math.max(0, Math.round(Number(raw.width) || 0))
  const height = Math.max(0, Math.round(Number(raw.height) || 0))
  const aspectRatio = width > 0 && height > 0
    ? width / height
    : (Number(raw.aspectRatio) || 1)
  return {
    keep: true,
    url: url.startsWith(COS_BASE_URL) ? url : buildCosUrl(cosKey),
    cosKey,
    width: width || 1,
    height: height || 1,
    aspectRatio: Math.max(0.2, Math.min(5, aspectRatio || 1))
  }
}

/** 本人重新编辑：全文案/图序/增删图，终身仅 1 次 */
async function editMine(event, openid) {
  if (!openid) return { code: 401, message: '请先登录后再编辑' }
  const enabled = await isFeatureEnabled()
  if (!enabled) return { code: 403, message: '航天摄影投稿暂未开放' }
  const pwdCheck = checkUploadPassword(event)
  if (!pwdCheck.ok) return { code: pwdCheck.code, message: pwdCheck.message }

  const photoId = String(event.photoId || event.id || '').trim()
  if (!photoId) return { code: 400, message: '缺少 id' }

  let doc = null
  try {
    const res = await db.collection(COLLECTION).doc(photoId).get()
    doc = res && res.data
  } catch (e) {
    return { code: 404, message: '内容不存在' }
  }
  if (!doc) return { code: 404, message: '内容不存在' }
  if (doc._openid !== openid) {
    return { code: 403, message: '只能编辑自己的投稿' }
  }
  const prevEditCount = Math.max(0, Number(doc.editCount) || 0)
  if (prevEditCount >= MAX_OWNER_EDITS) {
    return { code: 403, message: '每条投稿仅可重新编辑一次' }
  }

  const authorName = String(event.authorName || '').trim().slice(0, MAX_AUTHOR)
  if (!authorName) return { code: 400, message: '请填写作者名字' }
  const location = String(event.location || '').trim().slice(0, MAX_LOCATION)
  const deviceModel = String(event.deviceModel || event.device || '').trim().slice(0, MAX_DEVICE)
  const intro = String(event.intro || '').trim().slice(0, MAX_INTRO)
  const shotAtRaw = event.shotAt
  let shotAt = ''
  if (typeof shotAtRaw === 'number' && shotAtRaw > 0) {
    shotAt = new Date(shotAtRaw).toISOString().slice(0, 10)
  } else {
    shotAt = String(shotAtRaw || '').trim().slice(0, 32)
  }

  const rawPhotos = Array.isArray(event.photos) ? event.photos : []
  if (!rawPhotos.length) return { code: 400, message: '请至少保留 1 张照片' }
  if (rawPhotos.length > MAX_PHOTOS) return { code: 400, message: `最多支持 ${MAX_PHOTOS} 张照片` }

  const oldKeys = collectPhotoCosKeys(doc)
  const allowedKeySet = {}
  for (const k of oldKeys) allowedKeySet[k] = true
  const allowedSet = {
    has(k) { return !!allowedKeySet[String(k || '')] }
  }

  const plan = []
  for (const p of rawPhotos) {
    if (p && isCloudFileId(p.fileID)) {
      const meta = normalizePhotoMeta(p)
      if (!meta) return { code: 400, message: '新照片信息不合法或尺寸超限（最长边 4K）' }
      plan.push({ type: 'new', meta })
      continue
    }
    const keep = normalizeKeepPhoto(p, openid, allowedSet)
    if (!keep) return { code: 400, message: '照片信息不合法，请重新选择' }
    plan.push({ type: 'keep', photo: keep })
  }

  const sec = await checkTextFields({ openid, authorName, location, deviceModel, intro })
  if (sec.decision === 'reject') {
    return {
      code: 403,
      message: '内容包含敏感信息，请修改后重新提交',
      data: { reason: sec.reason }
    }
  }

  const photos = []
  const newTransferred = []
  try {
    for (const step of plan) {
      if (step.type === 'keep') {
        photos.push({
          url: step.photo.url,
          cosKey: step.photo.cosKey,
          width: step.photo.width,
          height: step.photo.height,
          aspectRatio: step.photo.aspectRatio
        })
      } else {
        const transferred = await transferCloudFileToCos(openid, step.meta)
        photos.push(transferred)
        newTransferred.push(transferred)
      }
    }
  } catch (e) {
    console.error('[AstroPhotos] edit transfer COS failed:', e && (e.message || e))
    try {
      await deleteCosKeys(newTransferred.map((p) => p && p.cosKey).filter(Boolean))
    } catch (cleanErr) {}
    try {
      const left = plan
        .filter((s) => s.type === 'new')
        .map((s) => s.meta && s.meta.fileID)
        .filter(Boolean)
      if (left.length) await cloud.deleteFile({ fileList: left.slice(0, MAX_PHOTOS) })
    } catch (cleanErr) {}
    return { code: 500, message: (e && e.message) || '图片转存失败，请重试' }
  }

  const keepKeySet = {}
  for (const p of photos) {
    if (p && p.cosKey) keepKeySet[p.cosKey] = true
  }
  const removedKeys = oldKeys.filter((k) => !keepKeySet[k])

  const ts = now()
  const autoApprove = textSecAllowsAutoApprove(sec)
  // 与 submit 对齐：密码+文本安检通过 → approved（含曾被拒稿）
  const prevStatus = doc.status
  let status = doc.status
  if (autoApprove) {
    status = 'approved'
  } else {
    status = 'pending'
  }

  const cover = photos[0]
  const patch = {
    authorName,
    location,
    deviceModel,
    shotAt,
    intro,
    photos,
    coverUrl: cover.url,
    coverAspectRatio: cover.aspectRatio,
    photoCount: photos.length,
    status,
    editedAt: ts,
    secText: {
      decision: sec.decision,
      checks: sec.checks,
      checkedAt: ts,
      autoApprove,
      fromEdit: true
    },
    updatedAt: ts,
    reviewedAt: autoApprove ? ts : (doc.reviewedAt || null),
    reviewedBy: autoApprove ? 'password_gate_edit' : (doc.reviewedBy || '')
  }

  // 事务写入 editCount，避免并发请求各编辑一次
  let nextEditCount = prevEditCount + 1
  try {
    if (typeof db.runTransaction === 'function') {
      nextEditCount = await db.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTION).doc(photoId)
        let cur = null
        try {
          const got = await ref.get()
          cur = got && got.data
        } catch (e) {}
        if (!cur || cur._openid !== openid) {
          const err = new Error('NOT_FOUND')
          err.code = 'NOT_FOUND'
          throw err
        }
        const ec = Math.max(0, Number(cur.editCount) || 0)
        if (ec >= MAX_OWNER_EDITS) {
          const err = new Error('EDIT_USED')
          err.code = 'EDIT_USED'
          throw err
        }
        const n = ec + 1
        await ref.update({ data: Object.assign({}, patch, { editCount: n }) })
        return n
      })
    } else {
      const latestRes = await db.collection(COLLECTION).doc(photoId).get().catch(() => null)
      const latest = latestRes && latestRes.data
      const ec = Math.max(0, Number(latest && latest.editCount) || 0)
      if (!latest || latest._openid !== openid) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })
      }
      if (ec >= MAX_OWNER_EDITS) {
        throw Object.assign(new Error('EDIT_USED'), { code: 'EDIT_USED' })
      }
      nextEditCount = ec + 1
      await db.collection(COLLECTION).doc(photoId).update({
        data: Object.assign({}, patch, { editCount: nextEditCount })
      })
    }
  } catch (e) {
    try {
      await deleteCosKeys(newTransferred.map((p) => p && p.cosKey).filter(Boolean))
    } catch (cleanErr) {}
    if (e && e.code === 'EDIT_USED') {
      return { code: 403, message: '每条投稿仅可重新编辑一次' }
    }
    if (e && e.code === 'NOT_FOUND') {
      return { code: 404, message: '内容不存在' }
    }
    console.error('[AstroPhotos] editMine write failed:', e && (e.message || e))
    return { code: 500, message: (e && e.message) || '保存失败，请重试' }
  }

  // 仅「首次上墙」抬红点水位；已上墙再编辑只 bust 列表缓存
  await bumpListEpoch(
    status === 'approved' && prevStatus !== 'approved'
      ? { touchLatest: true }
      : undefined
  )

  if (removedKeys.length) {
    await deleteCosKeys(removedKeys)
  }

  try {
    const freshOnly = newTransferred.length ? newTransferred : photos
    await runMediaCheck(photoId, openid, freshOnly)
  } catch (e) {
    console.warn('[AstroPhotos] edit mediaCheck failed:', e && (e.message || e))
  }

  return {
    code: 0,
    message: autoApprove ? '编辑成功' : '已提交审核，通过后将展示',
    data: {
      _id: photoId,
      status,
      editCount: nextEditCount,
      canEdit: nextEditCount < MAX_OWNER_EDITS,
      createdAt: doc.createdAt || ts
    }
  }
}

async function listPublic(event) {
  const enabled = await isFeatureEnabled()
  if (!enabled) {
    return { code: 0, data: { list: [], total: 0, hasMore: false, enabled: false, latestAt: 0 } }
  }

  const page = Math.max(0, Number(event.page) || 0)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || PAGE_SIZE))
  const meta = await getListMeta()
  const epoch = meta.epoch || 0
  const cacheKey = `${page}_${pageSize}_${epoch}`
  const nowMs = Date.now()
  // 仅缓存首页：刷 Tab / 静默刷新最频繁；epoch 变则跨实例失效
  if (
    page === 0 &&
    _listPublicCache.data &&
    _listPublicCache.key === cacheKey &&
    nowMs - _listPublicCache.at < LIST_CACHE_TTL_MS
  ) {
    return { code: 0, data: _listPublicCache.data }
  }

  const where = { status: 'approved' }
  // 降耗：不再 count；hasMore 用「本页是否满页」推断
  const res = await db.collection(COLLECTION)
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .field({
      _id: true,
      authorName: true,
      location: true,
      deviceModel: true,
      coverUrl: true,
      coverAspectRatio: true,
      photoCount: true,
      createdAt: true
    })
    .get()

  const rawDocs = await ensurePhotoCounts(res.data || [])
  const list = rawDocs.map((doc) => publicItem(doc, { includePhotos: false }))
  const hasMore = list.length >= pageSize
  const headCreated = list[0] && list[0].createdAt ? Number(list[0].createdAt) || 0 : 0
  const latestAt = Math.max(Number(meta.latestAt) || 0, headCreated)
  const data = {
    list,
    total: list.length,
    hasMore,
    enabled: true,
    latestAt
  }
  if (page === 0) {
    _listPublicCache = { at: nowMs, key: cacheKey, data }
  }
  return { code: 0, data }
}

async function getDetail(event, openid) {
  const id = String(event.id || event.photoId || '').trim()
  if (!id) return { code: 400, message: '缺少 id' }

  let doc = null
  try {
    const res = await db.collection(COLLECTION).doc(id).get()
    doc = res && res.data
  } catch (e) {
    return { code: 404, message: '内容不存在' }
  }
  if (!doc) return { code: 404, message: '内容不存在' }

  const isOwner = !!(openid && doc._openid === openid)
  if (doc.status !== 'approved' && !isOwner) {
    return { code: 404, message: '内容不存在或未通过审核' }
  }

  if (doc.status === 'approved') {
    const enabled = await isFeatureEnabled()
    if (!enabled && !isOwner) {
      return { code: 403, message: '航天摄影功能暂未开放' }
    }
  }

  return { code: 0, data: publicItem(doc, { isOwner }) }
}

async function listMine(event, openid) {
  if (!openid) return { code: 401, message: '请先登录' }
  const page = Math.max(0, Number(event.page) || 0)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || PAGE_SIZE))
  const where = { _openid: openid }
  // 降耗：我的列表也不 count
  const res = await db.collection(COLLECTION)
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .get()
  const list = (res.data || []).map((doc) => publicItem(doc, { isOwner: true }))
  return {
    code: 0,
    data: {
      list,
      total: list.length,
      hasMore: list.length >= pageSize
    }
  }
}

/** 上传者本人删除：DB 记录 + COS 对象一并清除 */
async function deleteMine(event, openid) {
  if (!openid) return { code: 401, message: '请先登录' }
  const photoId = String(event.photoId || event.id || '').trim()
  if (!photoId) return { code: 400, message: '缺少 id' }

  let doc = null
  try {
    const res = await db.collection(COLLECTION).doc(photoId).get()
    doc = res && res.data
  } catch (e) {
    return { code: 404, message: '内容不存在' }
  }
  if (!doc) return { code: 404, message: '内容不存在' }
  if (doc._openid !== openid) {
    return { code: 403, message: '只能删除自己的投稿' }
  }

  const keys = collectPhotoCosKeys(doc)
  await db.collection(COLLECTION).doc(photoId).remove()
  await bumpListEpoch()
  await deleteCosKeys(keys)
  return { code: 0, message: '已删除', data: { id: photoId, deletedKeys: keys.length } }
}

function collectPhotoCosKeys(doc) {
  const keys = []
  const seen = {}
  const pushKey = (k) => {
    const key = String(k || '').replace(/^\/+/, '')
    if (!key || !key.startsWith(`${COS_PREFIX}/`) || seen[key]) return
    seen[key] = true
    keys.push(key)
  }
  const photos = Array.isArray(doc && doc.photos) ? doc.photos : []
  for (const p of photos) {
    if (!p) continue
    pushKey(p.cosKey)
    if (!p.cosKey) pushKey(extractCosKeyFromUrl(p.url))
  }
  pushKey(doc && doc.coverUrl ? extractCosKeyFromUrl(doc.coverUrl) : '')
  return keys
}

async function deleteCosKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return
  const cos = createCOSClient()
  for (const key of keys.slice(0, MAX_PHOTOS)) {
    const k = String(key || '').replace(/^\/+/, '')
    if (!k.startsWith(`${COS_PREFIX}/`)) continue
    try {
      await new Promise((resolve, reject) => {
        cos.deleteObject({
          Bucket: COS_BUCKET,
          Region: COS_REGION,
          Key: k
        }, (err, data) => (err ? reject(err) : resolve(data)))
      })
    } catch (e) {
      console.warn('[AstroPhotos] delete COS key failed:', k, e && e.message)
    }
  }
}

async function adminAction(event) {
  const adminUser = await resolveAdminUser(event)
  if (!adminUser) return { code: 403, message: '无权限' }

  const adminOp = String(event.adminOp || event.op || '').trim()

  if (adminOp === 'list') {
    const page = Math.max(0, Number(event.page) || 0)
    const pageSize = Math.min(100, Math.max(1, Number(event.pageSize) || 20))
    const where = {}
    if (event.filterStatus || event.status) {
      where.status = event.filterStatus || event.status
    }
    const countRes = await db.collection(COLLECTION).where(where).count()
    const res = await db.collection(COLLECTION)
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
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

  if (adminOp === 'stats') {
    const totalRes = await db.collection(COLLECTION).count()
    const approvedRes = await db.collection(COLLECTION).where({ status: 'approved' }).count()
    const pendingRes = await db.collection(COLLECTION).where({ status: 'pending' }).count()
    const rejectedRes = await db.collection(COLLECTION).where({ status: 'rejected' }).count()
    return {
      code: 0,
      data: {
        total: totalRes.total,
        approved: approvedRes.total,
        pending: pendingRes.total,
        rejected: rejectedRes.total
      }
    }
  }

  if (adminOp === 'review') {
    const photoId = String(event.photoId || event.id || '').trim()
    const status = String(event.status || '').trim()
    if (!photoId) return { code: 400, message: '缺少 photoId' }
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return { code: 400, message: '无效状态' }
    }
    let prevStatus = ''
    try {
      const beforeRes = await db.collection(COLLECTION).doc(photoId).get()
      prevStatus = (beforeRes && beforeRes.data && beforeRes.data.status) || ''
    } catch (e) {}
    await db.collection(COLLECTION).doc(photoId).update({
      data: {
        status,
        updatedAt: now(),
        reviewedAt: now(),
        reviewedBy: adminUser.username || adminUser.id
      }
    })
    await bumpListEpoch(
      status === 'approved' && prevStatus !== 'approved'
        ? { touchLatest: true }
        : undefined
    )
    return { code: 0, message: '审核完成' }
  }

  if (adminOp === 'batchReview') {
    const ids = Array.isArray(event.photoIds) ? event.photoIds : []
    const status = String(event.status || '').trim()
    if (!ids.length) return { code: 400, message: '缺少 photoIds' }
    if (!['approved', 'rejected'].includes(status)) {
      return { code: 400, message: '无效状态' }
    }
    let updated = 0
    for (const id of ids.slice(0, 50)) {
      try {
        await db.collection(COLLECTION).doc(String(id)).update({
          data: {
            status,
            updatedAt: now(),
            reviewedAt: now(),
            reviewedBy: adminUser.username || adminUser.id
          }
        })
        updated++
      } catch (e) {}
    }
    if (updated > 0) {
      await bumpListEpoch(status === 'approved' ? { touchLatest: true } : undefined)
    }
    return { code: 0, data: { updated } }
  }

  if (adminOp === 'delete') {
    const photoId = String(event.photoId || event.id || '').trim()
    if (!photoId) return { code: 400, message: '缺少 photoId' }
    let before = null
    try {
      const beforeRes = await db.collection(COLLECTION).doc(photoId).get()
      before = beforeRes && beforeRes.data
    } catch (e) {}
    if (!before) return { code: 404, message: '记录不存在' }
    const keys = collectPhotoCosKeys(before)
    await db.collection(COLLECTION).doc(photoId).remove()
    await deleteCosKeys(keys)
    await bumpListEpoch()
    return { code: 0, message: '已删除' }
  }

  return { code: 400, message: '未知操作' }
}

let _collectionsEnsured = false
async function ensureCollectionsOnce() {
  if (_collectionsEnsured) return
  _collectionsEnsured = true
  try {
    await db.createCollection(COLLECTION)
  } catch (e) {}
}

exports.main = async (event = {}) => {
  await ensureCollectionsOnce()
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  let payload = event
  if (event && typeof event.body === 'string' && event.body) {
    try { payload = { ...event, ...JSON.parse(event.body) } } catch (e) {}
  } else if (event && event.data && typeof event.data === 'object') {
    payload = { ...event, ...event.data }
  }
  const action = String((payload && payload.action) || '').trim()

  try {
    switch (action) {
      case 'getPresign':
        return await getPresign(payload, openid)
      case 'submit':
        return await submit(payload, openid)
      case 'listPublic':
        return await listPublic(payload)
      case 'getDetail':
        return await getDetail(payload, openid)
      case 'listMine':
        return await listMine(payload, openid)
      case 'deleteMine':
        return await deleteMine(payload, openid)
      case 'editMine':
        return await editMine(payload, openid)
      case 'admin':
        return await adminAction(payload)
      default:
        return { code: 400, message: '未知 action' }
    }
  } catch (e) {
    console.error('[AstroPhotos] error:', e && (e.message || e))
    return { code: 500, message: (e && e.message) || '服务异常' }
  }
}
