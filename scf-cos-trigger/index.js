const tcb = require('@cloudbase/node-sdk')

const app = tcb.init({
  env: 'cloud1-9gdqgdt5bfaa20fb'
})

const db = app.database()

const FEED_COLLECTION = 'media_feed'
const CACHE_COLLECTION = 'security_gateway_cache'
const FEED_CACHE_VERSION_KEY = 'profile_feed_version'
const SOURCE_TAG = 'inspiration'
const INSPIRATION_DIR = '灵感流照片集/'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv', 'm3u8'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])

function getFileExt(key) {
  const pure = String(key || '').split('?')[0].toLowerCase()
  const idx = pure.lastIndexOf('.')
  if (idx < 0) return ''
  return pure.slice(idx + 1)
}

function getTypeFromKey(key) {
  const ext = getFileExt(key)
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return ''
}

function getBaseName(key) {
  const fileName = String(key || '').split('/').pop() || ''
  return fileName.replace(/\.[^.]+$/, '') || '灵感内容'
}

function hashString(input) {
  let h = 5381
  const str = String(input || '')
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i)
    h &= 0x7fffffff
  }
  return h.toString(36)
}

function buildDocId(type, storageKey) {
  return `media_feed_${type}_${hashString(storageKey)}`
}

function buildCOSUrl(key) {
  return `${COS_BASE_URL}${encodeURI(String(key || '').replace(/^\/+/, ''))}`
}

function buildVideoSnapshotUrl(key, second) {
  const base = buildCOSUrl(key)
  const t = Number(second) > 0 ? Number(second) : 1
  return `${base}?ci-process=snapshot&time=${t}&format=jpg&width=720&height=1280&scaletype=cover`
}

function parseCOSEvent(event) {
  const record = (event.Records && event.Records[0]) || {}
  const cosObj = (record.cos && record.cos.cosObject) || {}
  const eventInfo = record.event || {}

  let rawKey = cosObj.key || ''
  rawKey = decodeURIComponent(rawKey)
  // COS event key format: /<appid>/<bucket>/<actual-key>
  const keyParts = rawKey.replace(/^\//, '').split('/')
  if (keyParts.length > 2 && /^\d+$/.test(keyParts[0])) {
    rawKey = keyParts.slice(2).join('/')
  } else {
    rawKey = rawKey.replace(/^\/+/, '')
  }

  const eventName = String(eventInfo.eventName || '').toLowerCase()
  const isDelete = eventName.includes('objectremoved') || eventName.includes('delete')

  return {
    key: rawKey,
    size: Number(cosObj.size) || 0,
    eventName,
    isDelete
  }
}

async function bumpFeedCacheVersion() {
  const ts = Date.now()
  try {
    await db.collection(CACHE_COLLECTION).doc(FEED_CACHE_VERSION_KEY).update({
      value: db.command.inc(1),
      updatedAt: ts
    })
  } catch (e) {
    try {
      await db.collection(CACHE_COLLECTION).add({
        _id: FEED_CACHE_VERSION_KEY,
        value: 1,
        updatedAt: ts,
        expireAt: ts + 3650 * 24 * 60 * 60 * 1000
      })
    } catch (e2) {}
  }
}

exports.main_handler = async (event, context) => {
  const parsed = parseCOSEvent(event)
  const storageKey = parsed.key

  if (!storageKey || !storageKey.startsWith(INSPIRATION_DIR)) {
    return { success: true, ignored: true, reason: 'not_inspiration', key: storageKey }
  }

  const type = getTypeFromKey(storageKey)
  if (!type) {
    return { success: true, ignored: true, reason: 'unsupported_type', key: storageKey }
  }

  const docId = buildDocId(type, storageKey)
  const ts = Date.now()

  if (parsed.isDelete) {
    try {
      await db.collection(FEED_COLLECTION).doc(docId).remove()
      await bumpFeedCacheVersion()
      return { success: true, action: 'deleted', key: storageKey, docId }
    } catch (e) {
      return { success: true, action: 'delete_not_found', key: storageKey, docId }
    }
  }

  const fileID = buildCOSUrl(storageKey)
  const title = getBaseName(storageKey)
  const isVideo = type === 'video'

  const videoPreviewImages = isVideo
    ? [1, 3, 5].map((sec) => buildVideoSnapshotUrl(storageKey, sec))
    : []
  const coverFileID = isVideo ? videoPreviewImages[0] : fileID

  let existing = null
  try {
    const res = await db.collection(FEED_COLLECTION).doc(docId).get()
    existing = res.data || null
  } catch (e) {}

  const doc = {
    _id: docId,
    type,
    fileID,
    coverFileID: isVideo ? coverFileID : fileID,
    previewImages: isVideo ? videoPreviewImages : [fileID],
    title: (existing && existing.title) || title,
    desc: (existing && existing.desc) || '来自云存储灵感流照片集',
    aspectRatio: isVideo ? 0.68 : Number((existing && existing.aspectRatio) || 1) || 1,
    enabled: typeof (existing && existing.enabled) === 'boolean' ? existing.enabled : true,
    auditStatus: (existing && existing.auditStatus) || 'approved',
    sourceTag: SOURCE_TAG,
    weight: Number((existing && existing.weight) || 0) || 0,
    order: Number((existing && existing.order) || 0) || 0,
    storageKey,
    size: parsed.size,
    updatedAt: ts,
    createdAt: Number((existing && existing.createdAt) || ts) || ts
  }

  await db.collection(FEED_COLLECTION).doc(docId).set(doc)
  await bumpFeedCacheVersion()

  return {
    success: true,
    action: existing ? 'updated' : 'created',
    key: storageKey,
    docId,
    type
  }
}
