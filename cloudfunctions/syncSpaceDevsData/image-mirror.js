/**
 * LL2 图片 COS 镜像模块
 *
 * 背景：LL2 图片实际托管在 DigitalOcean Spaces，国内直连极差，首次进入的用户
 * 只能靠 Worker 代理 + 本地缓存兜底。本模块把这些外网图镜像到自有 COS 桶
 * （mars-1397421562 广州），并把各缓存文档里的 URL 原地替换为 COS URL，
 * 客户端零改动直接从 COS 加载。
 *
 * 机制（复用助推器图片转存 uploadBoosterImageToCOS 的成熟模式）：
 *   - 下载：Worker /image?url= 代理优先（LL2 图床从云函数直连不通），直连兜底
 *   - 上传：putObject 到 COS「LL2镜像/」目录，key = md5(源URL) + 扩展名
 *   - 映射表：space_devs_cache 文档 _image_mirror_map
 *       { map: { md5: { cosUrl, source, ts } | { source, failedAt, proxyTried } } }
 *     失败负缓存 24h 内不重试
 *   - 扫描/回写：深度遍历目标缓存文档收集外网 URL，镜像后把文档里的
 *     字符串值原地替换成 COS URL（只替换整串精确匹配，不碰其它字段）
 */

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const COS = require('cos-nodejs-sdk-v5')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
const COS_FOLDER = 'LL2镜像'

const MIRROR_MAP_DOC_ID = '_image_mirror_map'
const CACHE_COLLECTION = 'space_devs_cache'
const FAIL_RETRY_INTERVAL = 24 * 60 * 60 * 1000

// LL2 图床从腾讯云函数直连不通，走 Cloudflare Worker 通用图片代理（24h 边缘缓存）
const IMG_PROXY_BASE = String(process.env.SPACEX_PROXY_URL || 'https://api.marsx.com.cn').trim().replace(/\/$/, '')

/** 判定是否为需要镜像的 LL2 外网图片 URL（只认 LL2/DO 图床，避免误镜像第三方链接） */
function isMirrorableUrl(value) {
  if (typeof value !== 'string') return false
  const s = value.trim()
  if (!/^https?:\/\//i.test(s)) return false
  if (/\s/.test(s)) return false
  let host = ''
  try { host = new URL(s).hostname.toLowerCase() } catch (e) { return false }
  return host.endsWith('.digitaloceanspaces.com') ||
    host.endsWith('thespacedevs.com') ||
    host.indexOf('spacelaunchnow') !== -1
}

function urlKey(url) {
  return crypto.createHash('md5').update(String(url)).digest('hex')
}

function extFromUrl(url) {
  const m = String(url).toLowerCase().match(/\.(png|jpe?g|webp|gif)(\?|$)/)
  if (!m) return '.jpg'
  return m[1] === 'jpeg' ? '.jpg' : '.' + m[1]
}

function contentTypeFromExt(ext) {
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

// ── 下载 / 上传 ──

function httpsGetBuffer(url, timeout) {
  timeout = timeout || 15000
  return new Promise(function (resolve, reject) {
    const https = require('https')
    const http = require('http')
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CloudFunction/1.0)' },
      timeout: timeout
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetBuffer(res.headers.location, timeout).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      const chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end', function () { resolve(Buffer.concat(chunks)) })
    })
    req.on('error', reject)
    req.on('timeout', function () { req.destroy(); reject(new Error('Buffer download timeout')) })
  })
}

function createCOSClient() {
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

/** 单张镜像：下载（代理优先）→ 校验 → putObject，成功返回 COS URL，失败返回 '' */
async function mirrorImageToCOS(imageUrl) {
  if (!imageUrl) return ''
  try {
    const cos = createCOSClient()
    let buffer = null
    try {
      buffer = await httpsGetBuffer(IMG_PROXY_BASE + '/image?url=' + encodeURIComponent(imageUrl), 15000)
    } catch (e) { buffer = null }
    if (!buffer || buffer.length < 1000) {
      try {
        buffer = await httpsGetBuffer(imageUrl, 15000)
      } catch (e) { buffer = null }
    }
    if (!buffer || buffer.length < 1000) return '' // 太小可能是错误页
    if (buffer.length > 5 * 1024 * 1024) return '' // 超过 5MB 跳过

    const ext = extFromUrl(imageUrl)
    const key = COS_FOLDER + '/' + urlKey(imageUrl) + ext

    await Promise.race([
      new Promise(function (resolve, reject) {
        cos.putObject({
          Bucket: COS_BUCKET,
          Region: COS_REGION,
          Key: key,
          Body: buffer,
          ContentType: contentTypeFromExt(ext)
        }, function (err, data) { err ? reject(err) : resolve(data) })
      }),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('COS 上传超时')) }, 30000) })
    ])

    return COS_BASE_URL + encodeURI(key)
  } catch (e) {
    return ''
  }
}

// ── 映射表 ──

async function loadMirrorMap() {
  try {
    const res = await db.collection(CACHE_COLLECTION).doc(MIRROR_MAP_DOC_ID).get()
    return (res.data && res.data.map) || {}
  } catch (e) {
    return {}
  }
}

async function saveMirrorMap(map) {
  await db.collection(CACHE_COLLECTION).doc(MIRROR_MAP_DOC_ID).set({
    data: { map: map, updatedAt: Date.now() }
  })
}

/** 查表：已镜像返回 COS URL，否则返回原 URL */
function applyMirror(url, map) {
  if (!url || !map) return url
  const entry = map[urlKey(url)]
  return entry && entry.cosUrl ? entry.cosUrl : url
}

// ── 深度遍历：收集 / 替换 ──

/** 深度遍历对象，收集所有可镜像的外网图片 URL（去重由调用方 Set 完成） */
function collectUrls(node, out) {
  if (node == null) return
  if (typeof node === 'string') {
    if (isMirrorableUrl(node)) out.add(node.trim())
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) collectUrls(node[i], out)
    return
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) collectUrls(node[k], out)
  }
}

/**
 * 深度替换：把已镜像的 URL 字符串原地换成 COS URL（返回是否有改动）。
 * 只替换「整个字符串值精确等于源 URL」的情况，不做子串替换。
 */
function replaceUrls(node, map, stats) {
  if (node == null) return
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i]
      if (typeof v === 'string') {
        const next = isMirrorableUrl(v) ? applyMirror(v.trim(), map) : v
        if (next !== v) { node[i] = next; stats.replaced++ }
      } else {
        replaceUrls(v, map, stats)
      }
    }
    return
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (typeof v === 'string') {
        const next = isMirrorableUrl(v) ? applyMirror(v.trim(), map) : v
        if (next !== v) { node[k] = next; stats.replaced++ }
      } else {
        replaceUrls(v, map, stats)
      }
    }
  }
}

// ── 扫描目标文档 ──

/** 按 _id 前缀批量取文档（space_devs_cache 的 _id 即缓存 key） */
async function getDocsByIdPrefix(collection, prefix, limit) {
  try {
    const res = await db.collection(collection)
      .where({ _id: db.RegExp({ regexp: '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }) })
      .limit(limit || 100)
      .get()
    return res.data || []
  } catch (e) {
    return []
  }
}

async function getDocById(collection, docId) {
  try {
    const res = await db.collection(collection).doc(docId).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

/**
 * 收集所有待处理目标文档。
 * 返回 [{ collection, docId, payloadField, payload }]：
 *   payloadField 是文档里承载数据的字段名（api_cache_* 为 'data'，apiProxy 为 'result'，
 *   spacex_launch_stats 用 '__root__' 表示整个文档级字段替换）
 */
async function collectTargetDocs() {
  const targets = []

  const pushDoc = (collection, doc) => {
    if (!doc || !doc._id) return
    if (doc._id === MIRROR_MAP_DOC_ID) return
    // saveToCloudDB 写的文档载荷在 data 字段；apiProxy setCache 写在 result 字段
    if (doc.data !== undefined) {
      targets.push({ collection: collection, docId: doc._id, payloadField: 'data', payload: doc.data })
    } else if (doc.result !== undefined) {
      targets.push({ collection: collection, docId: doc._id, payloadField: 'result', payload: doc.result })
    }
  }

  // 1) 机构：分页 / featured / 聚合 / 分批 / 详情文档全覆盖
  const agencyDocs = await getDocsByIdPrefix(CACHE_COLLECTION, 'api_cache_/agencies/', 100)
  for (const d of agencyDocs) pushDoc(CACHE_COLLECTION, d)

  // 2) 飞船图鉴：列表 + 详情
  const scList = await getDocById(CACHE_COLLECTION, 'll2_spacecraft_list_v1')
  if (scList) pushDoc(CACHE_COLLECTION, scList)
  const scDetails = await getDocsByIdPrefix(CACHE_COLLECTION, 'll2_spacecraft_detail_v', 100)
  for (const d of scDetails) pushDoc(CACHE_COLLECTION, d)

  // 3) 发射场列表
  const locList = await getDocById(CACHE_COLLECTION, 'll2_location_list_v2')
  if (locList) pushDoc(CACHE_COLLECTION, locList)

  // 4) 空间站（列表 + 各站详情，raw LL2 结构 image.image_url/thumbnail_url）
  const stationDocs = await getDocsByIdPrefix(CACHE_COLLECTION, 'api_cache_/space_stations/', 60)
  for (const d of stationDocs) pushDoc(CACHE_COLLECTION, d)

  // 5) 轨道事件 + 在轨任务（spacex_launch_stats 单文档，字段级替换）
  const statsDoc = await getDocById('spacex_launch_stats', 'spacex_official_live')
  if (statsDoc) {
    targets.push({
      collection: 'spacex_launch_stats',
      docId: 'spacex_official_live',
      payloadField: '__root__',
      payload: {
        ongoingMissions: statsDoc.ongoingMissions || [],
        upcomingOrbitalEvents: statsDoc.upcomingOrbitalEvents || []
      }
    })
  }

  return targets
}

// ── 主任务 ──

/**
 * 扫描 → 镜像未映射的外网图 → 更新映射表 → 回写缓存文档
 * @param {{ maxUploads?: number, budgetMs?: number }} options
 */
async function runImageMirrorSync(options) {
  const startedAt = Date.now()
  const maxUploads = (options && options.maxUploads) || 40
  const budgetMs = (options && options.budgetMs) || 120000
  const UPLOAD_CONCURRENCY = 5

  const map = await loadMirrorMap()
  const targets = await collectTargetDocs()

  // 收集全部外网 URL
  const urlSet = new Set()
  for (const t of targets) collectUrls(t.payload, urlSet)

  // 过滤出需要镜像的（未映射；失败的 24h 后重试）
  const pending = []
  for (const url of urlSet) {
    if (pending.length >= maxUploads) break
    const entry = map[urlKey(url)]
    if (entry && entry.cosUrl) continue
    if (entry && entry.failedAt && (Date.now() - entry.failedAt < FAIL_RETRY_INTERVAL)) continue
    pending.push(url)
  }

  // 并发镜像（单图 45s 硬超时，总预算用尽即停，剩余下轮续）
  let uploaded = 0
  let failed = 0
  for (let i = 0; i < pending.length; i += UPLOAD_CONCURRENCY) {
    if (Date.now() - startedAt > budgetMs) break
    const chunk = pending.slice(i, i + UPLOAD_CONCURRENCY)
    await Promise.all(chunk.map(async (url) => {
      const cosUrl = await Promise.race([
        mirrorImageToCOS(url),
        new Promise(function (resolve) { setTimeout(function () { resolve('') }, 45000) })
      ])
      if (cosUrl) {
        map[urlKey(url)] = { cosUrl: cosUrl, source: url, ts: Date.now() }
        uploaded++
      } else {
        const prev = map[urlKey(url)]
        if (!prev || !prev.cosUrl) {
          map[urlKey(url)] = { source: url, failedAt: Date.now(), proxyTried: true }
        }
        failed++
      }
    }))
  }

  if (uploaded > 0 || failed > 0) {
    try { await saveMirrorMap(map) } catch (e) {
      console.warn('[imageMirror] 保存映射表失败:', e && (e.message || e))
    }
  }

  // 回写：把已镜像 URL 替换进各缓存文档
  let docsRewritten = 0
  let urlsReplaced = 0
  for (const t of targets) {
    const stats = { replaced: 0 }
    replaceUrls(t.payload, map, stats)
    if (stats.replaced <= 0) continue
    try {
      if (t.payloadField === '__root__') {
        await db.collection(t.collection).doc(t.docId).update({ data: t.payload })
      } else {
        await db.collection(t.collection).doc(t.docId).update({
          data: { [t.payloadField]: t.payload }
        })
      }
      docsRewritten++
      urlsReplaced += stats.replaced
    } catch (e) {
      console.warn('[imageMirror] 回写失败:', t.docId, e && (e.message || e))
    }
  }

  const result = {
    success: true,
    docsScanned: targets.length,
    urlsFound: urlSet.size,
    urlsPendingBefore: pending.length,
    uploaded: uploaded,
    uploadFailed: failed,
    docsRewritten: docsRewritten,
    urlsReplaced: urlsReplaced,
    mappedTotal: Object.keys(map).filter(function (k) { return map[k] && map[k].cosUrl }).length,
    elapsed: Date.now() - startedAt
  }
  console.log('[imageMirror]', JSON.stringify(result))
  return result
}

module.exports = {
  runImageMirrorSync,
  mirrorImageToCOS,
  loadMirrorMap,
  applyMirror,
  isMirrorableUrl,
  urlKey
}
