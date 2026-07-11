/**
 * 列举 COS 桶「火箭配置图/」下图片，同步到云数据库 media_assets。
 * - key 与 COS 对象 Key 一致（经 normalize），url 为公开访问地址
 * - sourceTag = cos-rocket-sync 的记录与 COS 对齐；删除桶中已不存在的同步项
 * - sourceTag = manual 的记录不修改、不删除
 *
 * 触发：定时器（在云开发控制台配置）或小程序 loadCloudMediaMap 节流调用
 */
const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'media_assets'
const PREFIX = '火箭配置图/'
const SOURCE_TAG = 'cos-rocket-sync'
const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

function normalizeKey(key) {
  if (!key || typeof key !== 'string') return ''
  return key
    .replace(/[\u00A0\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ')
    .replace(/／/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
}

function createCOSClient() {
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

function publicUrlForCosKey(key) {
  const k = normalizeKey(key)
  if (!k) return ''
  return `${COS_BASE_URL.replace(/\/$/, '')}/${encodeURI(k)}`
}

function isImageObjectKey(key) {
  return /\.(jpe?g|png|webp|gif)$/i.test(key)
}

async function listRocketImageObjectsFromCos() {
  const cos = createCOSClient()
  const out = []
  let marker = ''

  while (true) {
    const resp = await new Promise((resolve, reject) => {
      cos.getBucket(
        {
          Bucket: COS_BUCKET,
          Region: COS_REGION,
          Prefix: PREFIX,
          Marker: marker,
          MaxKeys: 1000
        },
        (err, data) => (err ? reject(err) : resolve(data || {}))
      )
    })

    const contents = Array.isArray(resp.Contents) ? resp.Contents : []
    const dirPrefix = PREFIX.endsWith('/') ? PREFIX.slice(0, -1) : PREFIX

    for (const obj of contents) {
      const rawKey = obj.Key || ''
      const key = normalizeKey(rawKey)
      if (!key.startsWith(`${dirPrefix}/`)) continue

      const size = Number(obj.Size || 0)
      if (!isImageObjectKey(key)) continue
      if (size <= 0) continue

      out.push({
        key,
        url: publicUrlForCosKey(key)
      })
    }

    const isTruncated = String(resp.IsTruncated || 'false') === 'true'
    if (!isTruncated) break
    marker = resp.NextMarker || (contents.length ? contents[contents.length - 1].Key : '')
    if (!marker) break
  }

  return out
}

async function loadAllRocketConfigMediaDocs() {
  const all = []
  const batch = 100
  let skip = 0

  while (true) {
    const res = await db
      .collection(COLLECTION)
      .where({
        key: db.RegExp({
          regexp: '^火箭配置图/',
          options: ''
        })
      })
      .field({ _id: true, key: true, url: true, sourceTag: true, enabled: true })
      .skip(skip)
      .limit(batch)
      .get()

    const rows = res.data || []
    all.push(...rows)
    if (rows.length < batch) break
    skip += batch
    if (skip > 8000) break
  }

  return all
}

async function promisePool(items, concurrency, iterator) {
  if (!items.length) return
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      await iterator(items[i], i)
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
}

async function upsertAndPrune(cosFiles) {
  const cosByNorm = new Map()
  for (const f of cosFiles) {
    const nk = normalizeKey(f.key)
    if (nk) cosByNorm.set(nk, f)
  }

  const docs = await loadAllRocketConfigMediaDocs()
  const byNorm = new Map()
  for (const d of docs) {
    const nk = normalizeKey(d.key)
    if (nk) byNorm.set(nk, d)
  }

  let added = 0
  let updated = 0
  let removed = 0
  let skippedManual = 0

  const toAdd = []
  const toUpdate = []
  const toRemove = []

  for (const [nk, cosRow] of cosByNorm) {
    const existing = byNorm.get(nk)
    if (!existing) {
      toAdd.push({ nk, cosRow })
      continue
    }

    if (existing.sourceTag === 'manual') {
      skippedManual += 1
      continue
    }

    const needUpdate =
      existing.url !== cosRow.url ||
      existing.enabled === false ||
      existing.sourceTag !== SOURCE_TAG

    if (needUpdate) {
      toUpdate.push({ _id: existing._id, cosRow })
    }
  }

  for (const d of docs) {
    if (d.sourceTag !== SOURCE_TAG) continue
    const nk = normalizeKey(d.key)
    if (!cosByNorm.has(nk)) {
      toRemove.push(d._id)
    }
  }

  await promisePool(toAdd, 10, async ({ nk, cosRow }) => {
    await db.collection(COLLECTION).add({
      data: {
        key: nk,
        url: cosRow.url,
        enabled: true,
        sourceTag: SOURCE_TAG,
        cosSyncedAt: Date.now()
      }
    })
    added += 1
  })

  await promisePool(toUpdate, 10, async ({ _id, cosRow }) => {
    await db.collection(COLLECTION).doc(_id).update({
      data: {
        url: cosRow.url,
        enabled: true,
        sourceTag: SOURCE_TAG,
        cosSyncedAt: Date.now()
      }
    })
    updated += 1
  })

  await promisePool(toRemove, 10, async (_id) => {
    await db.collection(COLLECTION).doc(_id).remove()
    removed += 1
  })

  return { added, updated, removed, skippedManual, totalCos: cosFiles.length }
}

exports.main = async (event) => {
  const from = (event && event.from) || 'invoke'
  const startTime = Date.now()
  console.log('[syncRocketCosIndex] start, from:', from)
  try {
    const cosFiles = await listRocketImageObjectsFromCos()
    const stats = await upsertAndPrune(cosFiles)
    console.log('[syncRocketCosIndex] done,', JSON.stringify(stats), (Date.now() - startTime) + 'ms')
    return {
      ok: true,
      from,
      ...stats,
      elapsed: Date.now() - startTime
    }
  } catch (e) {
    console.error('[syncRocketCosIndex]', e)
    return {
      ok: false,
      from,
      error: e.message || String(e)
    }
  }
}
