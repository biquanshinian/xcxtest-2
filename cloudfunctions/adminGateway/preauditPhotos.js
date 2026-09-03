/**
 * 预审资料照片：写入 COS，并按项目记在库里。
 * 只允许 preaudit/ 前缀，公开接口按 IP 限流。
 */
const PHOTO_SLOTS = {
  photo_before: true,
  photo_during: true,
  photo_after: true,
  photo_accept: true
}
const COLLECTION = 'preaudit_projects'
const MAX_BASE64_CHARS = 5500000
const MAX_PER_SLOT = 80
const MAX_PROJECT_PHOTOS = 400
const HOUR_LIMIT = 240
const DAY_LIMIT = 800
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const RATE_COLLECTION = 'security_rate_limits'

function isMissingCollection(err) {
  const s = String((err && (err.errMsg || err.message || err.code)) || err || '')
  return /502005|collection not exists|Db or Table not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(s)
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let _collectionReady = false
let _creatingCollection = null

async function ensureCollection(db) {
  if (_collectionReady) return
  if (!_creatingCollection) {
    _creatingCollection = Promise.all([
      db.createCollection(COLLECTION).catch(() => {}),
      db.createCollection(RATE_COLLECTION).catch(() => {})
    ]).finally(() => { _creatingCollection = null })
  }
  await _creatingCollection
  _collectionReady = true
}

async function writeDb(db, fn) {
  await ensureCollection(db)
  let last = null
  for (let i = 0; i < 5; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isMissingCollection(e)) throw e
      _collectionReady = false
      await ensureCollection(db)
      await waitMs(250 * (i + 1))
    }
  }
  throw last
}

function dbErrorMessage(err) {
  if (isMissingCollection(err)) return '云端项目库还没建好，已自动补建，请再点一次未存上'
  return (err && (err.message || err.errMsg)) || '没存上云端'
}

function stripDataUrl(raw) {
  const s = String(raw || '').trim()
  const i = s.indexOf('base64,')
  return i >= 0 ? s.slice(i + 7) : s.replace(/\s+/g, '')
}

function safeId(value, fallback) {
  const s = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
  return s || fallback
}

function safeYear(value) {
  const y = String(value || '').replace(/\D/g, '').slice(0, 4)
  const n = Number(y)
  if (n >= 1990 && n <= 2100) return String(n)
  return String(new Date().getFullYear())
}

function safeText(value, max) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max || 80)
}

function emptyPhotos() {
  return {
    photo_before: [],
    photo_during: [],
    photo_after: [],
    photo_accept: []
  }
}

function isAllowedSlot(slot) {
  const id = String(slot || '')
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return false
  if (Object.prototype.hasOwnProperty.call(Object.prototype, id)) return false
  return true
}

function normalizePhotoList(list) {
  return (Array.isArray(list) ? list : []).filter((row) => row && row.id && row.key && row.url).map((row) => ({
    id: row.id,
    key: row.key,
    url: row.url,
    name: row.name || '',
    caption: safeText(row.caption, 40),
    createdAt: row.createdAt
  })).slice(0, MAX_PER_SLOT)
}

function normalizePhotos(raw) {
  const next = emptyPhotos()
  Object.keys(raw || {}).forEach((slot) => {
    if (!isAllowedSlot(slot)) return
    next[slot] = normalizePhotoList(raw[slot])
  })
  return next
}

function countPhotos(photos) {
  return Object.keys(photos || {}).reduce((n, slot) => n + ((photos[slot] && photos[slot].length) || 0), 0)
}

async function assertRateLimit(db, crypto, clientIp, now) {
  const ip = String(clientIp || 'unknown').slice(0, 64)
  const id = 'preaudit_photo_' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)
  const ts = now()
  let data = null
  try {
    const snap = await db.collection(RATE_COLLECTION).doc(id).get()
    data = snap && snap.data
  } catch (e) {
    data = null
  }
  let hourStart = Number(data && data.hourStart) || ts
  let dayStart = Number(data && data.dayStart) || ts
  let hourCount = Number(data && data.hourCount) || 0
  let dayCount = Number(data && data.dayCount) || 0
  if (ts - hourStart > HOUR_MS) {
    hourStart = ts
    hourCount = 0
  }
  if (ts - dayStart > DAY_MS) {
    dayStart = ts
    dayCount = 0
  }
  if (hourCount >= HOUR_LIMIT) return { ok: false, message: '传照片太勤了，过一会儿再试' }
  if (dayCount >= DAY_LIMIT) return { ok: false, message: '今天传照片次数用完了' }
  try {
    await db.collection(RATE_COLLECTION).doc(id).set({
      data: {
        kind: 'preaudit_photo',
        hourStart,
        hourCount: hourCount + 1,
        dayStart,
        dayCount: dayCount + 1,
        updatedAt: ts
      }
    })
  } catch (e) { /* 限流表失败不挡保存 */ }
  return { ok: true }
}

async function readProject(db, id) {
  try {
    const snap = await db.collection(COLLECTION).doc(id).get()
    return (snap && snap.data) || null
  } catch (e) {
    return null
  }
}

function safeMoney(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  return isFinite(n) ? n : ''
}

function normalizePhotoMeta(raw) {
  const next = {}
  Object.keys(emptyPhotos()).forEach((slot) => {
    const row = (raw && raw[slot]) || {}
    next[slot] = {
      date: safeText(row.date, 16),
      peopleCount: slot === 'photo_accept' ? safeText(row.peopleCount, 8) : '',
      committeeCount: slot === 'photo_accept' ? safeText(row.committeeCount, 8) : '',
      hasSupervisor: slot === 'photo_accept' ? !!row.hasSupervisor : false,
      peopleNote: slot === 'photo_accept' ? safeText(row.peopleNote, 80) : ''
    }
  })
  return next
}

function ownerIdOf(user) {
  return String((user && (user.id || user._id)) || '').trim()
}

function canAccessProject(row, user) {
  const owner = String((row && row.ownerUserId) || '').trim()
  if (!owner) return true
  return ownerIdOf(user) === owner
}

function ownerPatch(prev, user) {
  if (prev && prev.ownerUserId) return {}
  const id = ownerIdOf(user)
  if (!id) return {}
  return {
    ownerUserId: id,
    ownerUsername: safeText(user && user.username, 40)
  }
}

function slimPeople(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((row) => ({
    name: safeText(row && row.name, 20),
    role: row && row.role === 'supervisor' ? 'supervisor' : (row && row.role === 'village' ? 'village' : '')
  }))
}

function normalizeMaterialFile(row, cosUrlFn) {
  const id = safeId(row && row.id, '')
  if (!id) return null
  const key = String((row && (row.key || row.cosKey)) || '').trim()
  const safeKey = key.indexOf('preaudit/') === 0 ? key.slice(0, 240) : ''
  let url = String((row && (row.url || row.path)) || '').trim()
  if (url && !/^https?:\/\//i.test(url)) url = ''
  if (safeKey && typeof cosUrlFn === 'function' && !url) url = cosUrlFn(safeKey)
  if (!safeKey && !url) return null
  const file = {
    id,
    key: safeKey,
    url: url.slice(0, 500),
    name: safeText(row && row.name, 80),
    caption: safeText(row && row.caption, 40),
    createdAt: Number(row && row.createdAt) || 0
  }
  const ocr = safeText(row && row.ocrText, 1500)
  if (ocr) file.ocrText = ocr
  return file
}

function normalizeOneMaterial(raw, cosUrlFn, ocrKeep) {
  const src = raw || {}
  const next = {
    date: safeText(src.date, 16),
    startDate: safeText(src.startDate, 16),
    endDate: safeText(src.endDate, 16),
    extraRangeStart: safeText(src.extraRangeStart, 16),
    extraRangeEnd: safeText(src.extraRangeEnd, 16),
    amount: src.amount === '' || src.amount == null ? '' : safeMoney(src.amount),
    peopleCount: safeText(src.peopleCount, 8),
    committeeCount: safeText(src.committeeCount, 8),
    hasSupervisor: !!src.hasSupervisor,
    peopleNote: safeText(src.peopleNote, 80),
    remark: safeText(src.remark, 80),
    notes: safeText(src.notes, 200),
    pairedPhoto: !!src.pairedPhoto,
    confirmed: !!src.confirmed,
    scanFilled: !!src.scanFilled,
    dateReviewOk: !!src.dateReviewOk,
    dateReviewKey: safeText(src.dateReviewKey, 40),
    contractor: safeText(src.contractor, 40),
    ocrTried: !!src.ocrTried,
    ocrAt: Number(src.ocrAt) || 0,
    ocrText: ocrKeep ? safeText(src.ocrText, 1500) : '',
    people: slimPeople(src.people),
    files: (Array.isArray(src.files) ? src.files : []).map((row) => normalizeMaterialFile(row, cosUrlFn)).filter(Boolean).slice(0, MAX_PER_SLOT)
  }
  const watermark = String(src.watermarkPath || '').trim()
  if (/^https?:\/\//i.test(watermark)) next.watermarkPath = watermark.slice(0, 500)
  return next
}

function normalizeMaterials(raw, cosUrlFn) {
  const next = {}
  Object.keys(raw || {}).forEach((slot) => {
    if (!isAllowedSlot(slot)) return
    next[slot] = normalizeOneMaterial(raw[slot], cosUrlFn, true)
  })
  const keys = Object.keys(next).slice(0, 60)
  const limited = {}
  keys.forEach((slot) => { limited[slot] = next[slot] })
  let packed = JSON.stringify(limited)
  if (packed.length > 180000) {
    keys.forEach((slot) => {
      limited[slot] = normalizeOneMaterial((raw && raw[slot]) || limited[slot], cosUrlFn, false)
      if (limited[slot] && Array.isArray(limited[slot].files)) {
        limited[slot].files = limited[slot].files.map((file) => {
          const copy = Object.assign({}, file)
          delete copy.ocrText
          return copy
        })
      }
    })
  }
  return limited
}

function publicProject(row, cosUrlFn) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || '待认项目',
    orgType: row.orgType || 'village',
    village: row.village || '',
    year: row.year || '',
    contractor: row.contractor || '',
    notes: row.notes || '',
    jointBid: !!row.jointBid,
    partnerVillage: row.partnerVillage || '',
    partnerAmount: row.partnerAmount == null ? '' : row.partnerAmount,
    budgetAmount: row.budgetAmount == null ? '' : row.budgetAmount,
    bidAmount: row.bidAmount == null ? '' : row.bidAmount,
    awardAmount: row.awardAmount == null ? '' : row.awardAmount,
    contractAmount: row.contractAmount == null ? '' : row.contractAmount,
    bidDate: row.bidDate || '',
    awardDate: row.awardDate || '',
    photoMeta: normalizePhotoMeta(row.photoMeta),
    photos: normalizePhotos(row.photos),
    materials: normalizeMaterials(row.materials, cosUrlFn),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function createPreauditPhotosApi({ db, ok, fail, now, crypto, createCOSClient, COS_BUCKET, COS_REGION, COS_BASE_URL }) {
  function cosUrl(key) {
    return String(COS_BASE_URL || '') + encodeURI(String(key || '').replace(/^\/+/, ''))
  }

  function toPublic(row) {
    return publicProject(row, cosUrl)
  }

  function denyWrite(prev, user) {
    if (canAccessProject(prev, user)) return null
    return fail(4030, '这不是你的项目')
  }

  function putObject(key, buffer, contentType) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'image/jpeg'
      }, (err, data) => err ? reject(err) : resolve(data))
    })
  }

  function deleteObject(key) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.deleteObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key
      }, (err, data) => err ? reject(err) : resolve(data))
    })
  }

  function presignPut(key) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: 900,
        Protocol: 'https:'
      }, (err, data) => err ? reject(err) : resolve(data && data.Url))
    })
  }

  function headObject(key) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.headObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key
      }, (err, data) => err ? reject(err) : resolve(data))
    })
  }

  function parsePhotoKey(key) {
    const m = /^preaudit\/(\d{4})\/([a-zA-Z0-9_-]{1,48})\/([a-z][a-z0-9_]{1,39})\/([a-zA-Z0-9_-]{1,48})\.jpg$/.exec(String(key || ''))
    if (!m) return null
    return { year: m[1], projectId: m[2], slot: m[3], fileId: m[4], key: m[0] }
  }

  function keyFromPublicUrl(url) {
    const s = String(url || '').trim()
    const m = /^https?:\/\/mars-1397421562\.cos\.ap-guangzhou\.myqcloud\.com\/(.+)$/i.exec(s)
    if (!m) return ''
    try {
      return decodeURIComponent(m[1].split('?')[0])
    } catch (e) {
      return String(m[1].split('?')[0] || '')
    }
  }

  function getObject(key) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.getObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key
      }, (err, data) => err ? reject(err) : resolve(data && data.Body))
    })
  }

  async function fetchFile(body, ctx) {
    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now)
    if (!limited.ok) return fail(4290, limited.message)
    const parsed = parsePhotoKey(body && body.key) || parsePhotoKey(keyFromPublicUrl(body && body.url))
    if (!parsed) return fail(4000, '只能取预审照片')
    try {
      const buf = await getObject(parsed.key)
      const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || [])
      if (!buffer.length) return fail(4004, '找不到这张照片')
      if (buffer.length > 2 * 1024 * 1024) return fail(4000, '图太大')
      return ok({ key: parsed.key, base64: buffer.toString('base64'), contentType: 'image/jpeg' })
    } catch (e) {
      return fail(4004, '找不到这张照片')
    }
  }

  async function writeProject(id, patch) {
    const prev = await readProject(db, id)
    const ts = now()
    const photosExplicit = !!(patch && Object.prototype.hasOwnProperty.call(patch, 'photos'))
    const metaExplicit = !!(patch && Object.prototype.hasOwnProperty.call(patch, 'photoMeta'))
    const materialsExplicit = !!(patch && Object.prototype.hasOwnProperty.call(patch, 'materials'))
    if (!prev) {
      const next = Object.assign({
        id,
        name: '待认项目',
        orgType: 'village',
        village: '',
        year: safeYear(),
        contractor: '',
        notes: '',
        jointBid: false,
        partnerVillage: '',
        partnerAmount: '',
        budgetAmount: '',
        bidAmount: '',
        awardAmount: '',
        contractAmount: '',
        bidDate: '',
        awardDate: '',
        photoMeta: normalizePhotoMeta(null),
        photos: emptyPhotos(),
        materials: {},
        createdAt: ts
      }, patch || {}, {
        id,
        photos: normalizePhotos(photosExplicit ? patch.photos : emptyPhotos()),
        photoMeta: normalizePhotoMeta(metaExplicit ? patch.photoMeta : null),
        materials: materialsExplicit ? normalizeMaterials(patch.materials, cosUrl) : {},
        updatedAt: ts
      })
      await writeDb(db, () => db.collection(COLLECTION).doc(id).set({ data: next }))
      return next
    }
    const data = {}
    Object.keys(patch || {}).forEach((key) => {
      if (key === 'id' || key === 'photos' || key === 'photoMeta' || key === 'createdAt' || key === 'materials') return
      data[key] = patch[key]
    })
    if (photosExplicit) data.photos = normalizePhotos(patch.photos)
    if (metaExplicit) data.photoMeta = normalizePhotoMeta(patch.photoMeta)
    if (materialsExplicit) data.materials = normalizeMaterials(patch.materials, cosUrl)
    data.updatedAt = ts
    await writeDb(db, () => db.collection(COLLECTION).doc(id).update({ data }))
    const next = Object.assign({}, prev, data, { id })
    if (!photosExplicit) next.photos = normalizePhotos(prev.photos)
    if (!metaExplicit) next.photoMeta = normalizePhotoMeta(prev.photoMeta)
    if (!materialsExplicit) next.materials = prev.materials || {}
    return next
  }

  async function writeSlotPhotos(id, slot, list, meta, user) {
    if (!isAllowedSlot(slot)) throw new Error('这项不能存照片')
    const normalized = normalizePhotoList(list)
    const prev = await readProject(db, id)
    const ts = now()
    if (!prev) {
      const nextPhotos = emptyPhotos()
      nextPhotos[slot] = normalized
      return writeProject(id, Object.assign({}, meta || {}, ownerPatch(null, user), { photos: nextPhotos }))
    }
    if (!canAccessProject(prev, user)) {
      const err = new Error('这不是你的项目')
      err.code = 4030
      throw err
    }
    const claim = ownerPatch(prev, user)
    try {
      await writeDb(db, () => db.collection(COLLECTION).doc(id).update({
        data: Object.assign({
          ['photos.' + slot]: normalized,
          updatedAt: ts
        }, claim)
      }))
      const next = Object.assign({}, prev, claim, { updatedAt: ts })
      next.photos = normalizePhotos(prev.photos)
      next.photos[slot] = normalized
      return next
    } catch (e) {
      if (e && e.code === 4030) throw e
      const nextPhotos = normalizePhotos(prev.photos)
      nextPhotos[slot] = normalized
      return writeProject(id, Object.assign({}, claim, { photos: nextPhotos }))
    }
  }

  async function upsert(body, ctx) {
    const user = ctx && ctx.user
    const id = safeId(body && body.id, '')
    if (!id) return fail(4000, '缺少项目')
    const prev = await readProject(db, id)
    const denied = denyWrite(prev, user)
    if (denied) return denied
    const patch = Object.assign({
      name: safeText(body && body.name, 40) || '待认项目',
      orgType: /^(small|township)$/.test(body && body.orgType) ? body.orgType : 'village',
      village: safeText(body && body.village, 20),
      year: safeYear(body && body.year),
      contractor: safeText(body && body.contractor, 40)
    }, ownerPatch(prev, user))
    if (body && Object.prototype.hasOwnProperty.call(body, 'notes')) patch.notes = safeText(body.notes, 200)
    if (body && Object.prototype.hasOwnProperty.call(body, 'jointBid')) patch.jointBid = !!body.jointBid
    if (body && Object.prototype.hasOwnProperty.call(body, 'partnerVillage')) patch.partnerVillage = safeText(body.partnerVillage, 20)
    if (body && Object.prototype.hasOwnProperty.call(body, 'partnerAmount')) patch.partnerAmount = safeMoney(body.partnerAmount)
    if (body && Object.prototype.hasOwnProperty.call(body, 'budgetAmount')) patch.budgetAmount = safeMoney(body.budgetAmount)
    if (body && Object.prototype.hasOwnProperty.call(body, 'bidAmount')) patch.bidAmount = safeMoney(body.bidAmount)
    if (body && Object.prototype.hasOwnProperty.call(body, 'awardAmount')) patch.awardAmount = safeMoney(body.awardAmount)
    if (body && Object.prototype.hasOwnProperty.call(body, 'contractAmount')) patch.contractAmount = safeMoney(body.contractAmount)
    if (body && Object.prototype.hasOwnProperty.call(body, 'bidDate')) patch.bidDate = safeText(body.bidDate, 16)
    if (body && Object.prototype.hasOwnProperty.call(body, 'awardDate')) patch.awardDate = safeText(body.awardDate, 16)
    if (body && body.photoMeta) patch.photoMeta = body.photoMeta
    if (body && body.materials) patch.materials = body.materials
    try {
      const saved = await writeProject(id, patch)
      return ok(toPublic(saved))
    } catch (e) {
      return fail(5001, dbErrorMessage(e))
    }
  }

  async function sign(body, ctx) {
    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now)
    if (!limited.ok) return fail(4290, limited.message)
    const projectId = safeId(body && body.projectId, '')
    const slot = String((body && body.slot) || '')
    if (!projectId) return fail(4000, '缺少项目')
    if (!isAllowedSlot(slot)) return fail(4000, '这项不能存照片')
    const current = await readProject(db, projectId)
    const denied = denyWrite(current, ctx && ctx.user)
    if (denied) return denied
    const photos = normalizePhotos(current && current.photos)
    const slotList = photos[slot] || []
    const fileId = safeId(body && body.fileId, 'f' + now().toString(36) + crypto.randomBytes(3).toString('hex'))
    const replacing = slotList.some((row) => row && row.id === fileId)
    if (!replacing && slotList.length >= MAX_PER_SLOT) return fail(4000, '这项照片已经满 ' + MAX_PER_SLOT + ' 张')
    if (!replacing && countPhotos(photos) >= MAX_PROJECT_PHOTOS) return fail(4000, '这个项目照片太多了')
    const year = safeYear((current && current.year) || (body && body.year))
    const key = 'preaudit/' + year + '/' + projectId + '/' + slot + '/' + fileId + '.jpg'
    try {
      const uploadUrl = await presignPut(key)
      if (!uploadUrl) return fail(5001, '没拿到云端上传地址')
      return ok({ fileId, key, url: cosUrl(key), uploadUrl })
    } catch (e) {
      return fail(5001, (e && e.message) || '没拿到云端上传地址')
    }
  }

  function writePhotoError(e) {
    if (e && (e.code === 4030 || /不是你的项目/.test(String(e.message || '')))) return fail(4030, '这不是你的项目')
    return fail(5001, dbErrorMessage(e))
  }

  async function confirmDirect(body, parsed, ctx) {
    const user = ctx && ctx.user
    const projectId = parsed.projectId
    const slot = parsed.slot
    const fileId = parsed.fileId
    const key = parsed.key
    if (!isAllowedSlot(slot)) return fail(4000, '这项不能存照片')
    if (body && body.projectId && safeId(body.projectId, '') !== projectId) return fail(4000, '项目对不上')
    if (body && body.fileId && safeId(body.fileId, '') !== fileId) return fail(4000, '照片对不上')
    const current = await readProject(db, projectId)
    const denied = denyWrite(current, user)
    if (denied) return denied
    const photos = normalizePhotos(current && current.photos)
    const slotList = photos[slot] || []
    const replacing = slotList.some((row) => row && row.id === fileId)
    if (!replacing && slotList.length >= MAX_PER_SLOT) return fail(4000, '这项照片已经满 ' + MAX_PER_SLOT + ' 张')
    if (!replacing && countPhotos(photos) >= MAX_PROJECT_PHOTOS) return fail(4000, '这个项目照片太多了')
    let head = null
    try {
      head = await headObject(key)
    } catch (e) {
      return fail(4000, '照片还没传到云端，请再试一次')
    }
    const size = Number((head && (head.headers && (head.headers['content-length'] || head.headers['Content-Length']))) || head.ContentLength || 0)
    if (size > 0 && size < 80) return fail(4000, '图是空的')
    if (size > 2 * 1024 * 1024) return fail(4000, '图太大，请拍近一点再传')
    const file = {
      id: fileId,
      key,
      url: cosUrl(key),
      name: safeText((body && (body.fileName || body.name)), 80) || (fileId + '.jpg'),
      caption: safeText(body && body.caption, 40),
      createdAt: now()
    }
    photos[slot] = slotList.filter((row) => row && row.id !== fileId).concat([file])
    try {
      await ensureCollection(db)
      const saved = await writeSlotPhotos(projectId, slot, photos[slot], current ? null : {
        name: safeText(body && body.name, 40) || '待认项目',
        orgType: /^(small|township)$/.test(body && body.orgType) ? body.orgType : 'village',
        village: safeText(body && body.village, 20),
        year: parsed.year,
        contractor: safeText(body && body.contractor, 40)
      }, user)
      return ok({ file, project: toPublic(saved) })
    } catch (e) {
      return writePhotoError(e)
    }
  }

  async function upload(body, ctx) {
    const user = ctx && ctx.user
    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now)
    if (!limited.ok) return fail(4290, limited.message)

    const parsedKey = parsePhotoKey(body && body.key)
    const imageBase64 = stripDataUrl(body && body.imageBase64)
    if (parsedKey && !imageBase64) return confirmDirect(body, parsedKey, ctx)

    const projectId = safeId(body && body.projectId, '')
    const slot = String((body && body.slot) || '')
    if (!projectId) return fail(4000, '缺少项目')
    if (!isAllowedSlot(slot)) return fail(4000, '这项不能存照片')
    if (!imageBase64) return fail(4000, '没有图')
    if (imageBase64.length > MAX_BASE64_CHARS) return fail(4000, '图太大，请换一张清楚的近照')

    const fileId = safeId(body && body.fileId, 'f' + now().toString(36) + crypto.randomBytes(3).toString('hex'))
    const current = await readProject(db, projectId)
    const denied = denyWrite(current, user)
    if (denied) return denied
    const photos = normalizePhotos(current && current.photos)
    const slotList = photos[slot] || []
    const replacing = slotList.some((row) => row && row.id === fileId)
    if (!replacing && slotList.length >= MAX_PER_SLOT) return fail(4000, '这项照片已经满 ' + MAX_PER_SLOT + ' 张')
    if (!replacing && countPhotos(photos) >= MAX_PROJECT_PHOTOS) return fail(4000, '这个项目照片太多了')
    const year = safeYear((current && current.year) || (body && body.year))
    const key = 'preaudit/' + year + '/' + projectId + '/' + slot + '/' + fileId + '.jpg'
    const buffer = Buffer.from(imageBase64, 'base64')
    if (!buffer.length) return fail(4000, '图是空的')

    try {
      await ensureCollection(db)
      await putObject(key, buffer, 'image/jpeg')
    } catch (e) {
      return fail(5001, (e && e.message) || '照片没存上云端')
    }

    const file = {
      id: fileId,
      key,
      url: cosUrl(key),
      name: safeText((body && (body.fileName || body.name)), 80) || (fileId + '.jpg'),
      caption: safeText(body && body.caption, 40),
      createdAt: now()
    }
    photos[slot] = slotList.filter((row) => row && row.id !== fileId).concat([file])
    try {
      const saved = await writeSlotPhotos(projectId, slot, photos[slot], current ? null : {
        name: safeText(body && body.name, 40) || '待认项目',
        orgType: /^(small|township)$/.test(body && body.orgType) ? body.orgType : 'village',
        village: safeText(body && body.village, 20),
        year,
        contractor: safeText(body && body.contractor, 40)
      }, user)
      return ok({ file, project: toPublic(saved) })
    } catch (e) {
      return writePhotoError(e)
    }
  }

  async function remove(body, ctx) {
    const projectId = safeId(body && body.projectId, '')
    const fileId = safeId(body && body.fileId, '')
    if (!projectId || !fileId) return fail(4000, '缺少项目或照片')
    const current = await readProject(db, projectId)
    if (!current) return fail(4004, '找不到这个项目')
    const denied = denyWrite(current, ctx && ctx.user)
    if (denied) return denied
    const photos = normalizePhotos(current.photos)
    let target = null
    let slotHit = ''
    Object.keys(photos).forEach((slot) => {
      const hit = photos[slot].find((row) => row.id === fileId)
      if (hit) {
        target = hit
        slotHit = slot
        photos[slot] = photos[slot].filter((row) => row.id !== fileId)
      }
    })
    if (!target) return fail(4004, '找不到这张照片')
    if (target.key && String(target.key).indexOf('preaudit/') === 0) {
      for (let i = 0; i < 3; i++) {
        try {
          await deleteObject(target.key)
          break
        } catch (e) {
          if (i === 2) { /* 库记录仍删，避免界面卡住 */ }
        }
      }
    }
    try {
      const saved = await writeSlotPhotos(projectId, slotHit, photos[slotHit], null, ctx && ctx.user)
      return ok(toPublic(saved))
    } catch (e) {
      return writePhotoError(e)
    }
  }

  function listPrefix(prefix) {
    const cos = createCOSClient()
    const keys = []
    function page(marker) {
      return new Promise((resolve, reject) => {
        cos.getBucket({
          Bucket: COS_BUCKET,
          Region: COS_REGION,
          Prefix: prefix,
          Marker: marker || '',
          MaxKeys: 1000
        }, (err, data) => {
          if (err) return reject(err)
          ;(data.Contents || []).forEach((row) => {
            if (row && row.Key && !String(row.Key).endsWith('/')) keys.push(row.Key)
          })
          if (data.IsTruncated) {
            const nextMarker = data.NextMarker || ((data.Contents && data.Contents.length) ? data.Contents[data.Contents.length - 1].Key : '')
            resolve(page(nextMarker))
            return
          }
          resolve(keys)
        })
      })
    }
    return page('')
  }

  function deleteMultiple(keys) {
    if (!keys.length) return Promise.resolve()
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.deleteMultipleObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Objects: keys.map((Key) => ({ Key }))
      }, (err, data) => err ? reject(err) : resolve(data))
    })
  }

  async function purgeKeys(keys) {
    const uniq = []
    const seen = {}
    ;(keys || []).forEach((key) => {
      const k = String(key || '')
      if (!k || k.indexOf('preaudit/') !== 0 || seen[k]) return
      seen[k] = true
      uniq.push(k)
    })
    for (let i = 0; i < uniq.length; i += 100) {
      const batch = uniq.slice(i, i + 100)
      try {
        await deleteMultiple(batch)
      } catch (e) {
        for (let j = 0; j < batch.length; j++) {
          try { await deleteObject(batch[j]) } catch (err) { /* 单张删失败继续 */ }
        }
      }
    }
    return uniq.length
  }

  async function destroy(body, ctx) {
    const projectId = safeId(body && body.id, '')
    if (!projectId) return fail(4000, '缺少项目')
    const current = await readProject(db, projectId)
    if (current) {
      const denied = denyWrite(current, ctx && ctx.user)
      if (denied) return denied
      try {
        await db.collection(COLLECTION).doc(projectId).remove()
      } catch (e) {
        return fail(5001, '云端项目没删掉')
      }
    }
    return ok({ id: projectId, deleted: true })
  }

  async function patchCaption(body, ctx) {
    const projectId = safeId(body && body.projectId, '')
    const fileId = safeId(body && body.fileId, '')
    const caption = safeText(body && body.caption, 40)
    if (!projectId || !fileId) return fail(4000, '缺少项目或照片')
    const current = await readProject(db, projectId)
    if (!current) return fail(4004, '找不到这个项目')
    const denied = denyWrite(current, ctx && ctx.user)
    if (denied) return denied
    const photos = normalizePhotos(current.photos)
    let slotHit = ''
    Object.keys(photos).forEach((slot) => {
      const idx = photos[slot].findIndex((row) => row.id === fileId)
      if (idx < 0) return
      slotHit = slot
      photos[slot][idx] = Object.assign({}, photos[slot][idx], { caption })
    })
    if (!slotHit) return fail(4004, '找不到这张照片')
    try {
      const saved = await writeSlotPhotos(projectId, slotHit, photos[slotHit], null, ctx && ctx.user)
      return ok(toPublic(saved))
    } catch (e) {
      return writePhotoError(e)
    }
  }

  async function getOne(id, ctx) {
    const projectId = safeId(id, '')
    if (!projectId) return fail(4000, '缺少项目')
    const row = await readProject(db, projectId)
    if (!row) return fail(4004, '找不到这个项目')
    if (!canAccessProject(row, ctx && ctx.user)) return fail(4030, '这不是你的项目')
    return ok(toPublic(row))
  }

  async function list(ctx) {
    const user = ctx && ctx.user
    const owner = ownerIdOf(user)
    if (!owner) return ok({ list: [] })
    let rows = []
    try {
      const snap = await db.collection(COLLECTION).where({ ownerUserId: owner }).limit(100).get()
      rows = Array.isArray(snap && snap.data) ? snap.data : []
    } catch (e) {
      try {
        const snap = await db.collection(COLLECTION).limit(100).get()
        const all = Array.isArray(snap && snap.data) ? snap.data : []
        rows = all.filter((row) => row && String(row.ownerUserId || '') === owner)
      } catch (err) {
        rows = []
      }
    }
    rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    return ok({ list: rows.map((row) => toPublic(row)).filter(Boolean) })
  }

  return { upsert, sign, upload, fetchFile, remove, patchCaption, destroy, getOne, list }
}

module.exports = { createPreauditPhotosApi, PHOTO_SLOTS }
