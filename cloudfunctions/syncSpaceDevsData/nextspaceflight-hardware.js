/**
 * Next Spaceflight 星舰硬件设施同步：
 * 解析 /starship/ 页 RSC 内联负载中的 starshipData.vehicles + tests，
 * 派生筛选分类、附加中文翻译、镜像图片到云存储，写入云集合 nextspaceflight_hardware_cache。
 *
 * 集合文档结构：
 *   vehicles  — { list: [...], updatedAtMs, error, parserMeta }
 *   tests     — { list: [...], updatedAtMs }
 *   image_map — { map: { [vehicleId]: { srcUrl, fileID } }, updatedAtMs }
 */
const https = require('https')
const crypto = require('crypto')
const { URL } = require('url')

const { NSF_STARSHIP_PAGE, fetchUrlText } = require('./nextspaceflight-starship.js')
const {
  STATUS_ZH,
  TYPE_ZH,
  CATEGORY_ZH,
  translateVehicleNotes,
  translateTestName,
  translateLocation
} = require('./nsf-hardware-i18n.js')

const COLLECTION = 'nextspaceflight_hardware_cache'
const IMAGE_MIRROR_BUDGET_MS = 120 * 1000
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20 * 1000
/** 定时触发的最小同步间隔：硬件数据变化低频，节流到每 6 小时抓一次（手动触发可 force 跳过） */
const MIN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
/** 每次镜像最多下载的新图片数（正常增量每轮 0~2 张；防止异常场景批量拉取） */
const MAX_IMAGE_DOWNLOADS_PER_RUN = 20

// ── 解析 ──

/** 从 __next_f.push 的字符串负载中解码出包含指定标记的完整明文 */
function decodePayloadContaining(html, needle) {
  const pushRe = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g
  let m
  while ((m = pushRe.exec(html)) !== null) {
    if (m[1].indexOf(needle) < 0) continue
    try {
      return JSON.parse('"' + m[1] + '"')
    } catch (e) {
      continue
    }
  }
  return null
}

/** 明文 JSON 中标准括号平衡扫描解析数组 */
function parseArrayAt(text, openBracketIdx) {
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = openBracketIdx; i < text.length; i++) {
    const c = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (inStr) {
      if (c === '\\') escape = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const arr = JSON.parse(text.slice(openBracketIdx, i + 1))
        return Array.isArray(arr) ? arr : null
      }
    }
  }
  return null
}

function extractKeyedArray(text, key) {
  const marker = '"' + key + '":['
  const pos = text.indexOf(marker)
  if (pos < 0) return null
  return parseArrayAt(text, pos + marker.length - 1)
}

/**
 * 解析页面 HTML 中的 vehicles 与 tests；失败抛错（含 strategy 信息）
 */
function parseHardwareFromHtml(htmlText) {
  const html = typeof htmlText === 'string' ? htmlText : String(htmlText || '')
  const tried = []

  // 策略 1：定位包含 vehicles 的 push 负载并整体解码（最稳，正确处理 \\uXXXX/\\\" 等转义）
  tried.push('decode_push_payload')
  const decoded = decodePayloadContaining(html, '\\"vehicles\\":[')
  if (decoded) {
    const vehicles = extractKeyedArray(decoded, 'vehicles')
    const tests = extractKeyedArray(decoded, 'tests')
    if (Array.isArray(vehicles) && vehicles.length > 0) {
      return { vehicles, tests: Array.isArray(tests) ? tests : [], strategy: 'decode_push_payload', tried }
    }
  }

  // 策略 2：整页做一次简易反转义后直接扫描（网页结构变化时的兜底）
  tried.push('global_unescape')
  try {
    const flat = html.replace(/\\"/g, '"')
    const vehicles = extractKeyedArray(flat, 'vehicles')
    const tests = extractKeyedArray(flat, 'tests')
    if (Array.isArray(vehicles) && vehicles.length > 0) {
      return { vehicles, tests: Array.isArray(tests) ? tests : [], strategy: 'global_unescape', tried }
    }
  } catch (e) {}

  const err = new Error('hardware_not_found')
  err.triedStrategies = tried
  throw err
}

// ── 归一化 ──

/** 按官网筛选口径派生分类：组合体/助推器/飞船/亚轨道/其他 */
function deriveCategory(row) {
  const name = String(row.name || '').trim()
  const type = String(row.type || '').trim()
  if (type === 'Full Stack') return 'fullstack'
  if (type === 'Structural Test Article') return 'other'
  if (/^Booster\s/i.test(name)) return 'booster'
  if (/^Ship\s/i.test(name)) return 'ship'
  if (/^Starship\s/i.test(name) || /^Starhopper$/i.test(name)) return 'suborbital'
  return 'other'
}

function normalizeVehicles(rawList) {
  return (rawList || [])
    .map((row) => {
      if (!row || typeof row !== 'object' || row.id == null) return null
      const name = String(row.name || '').trim()
      if (!name) return null
      const status = String(row.status || '').trim()
      const type = String(row.type || '').trim()
      const category = deriveCategory(row)
      const notesEn = String(row.notes || '').replace(/\r\n/g, '\n').trim()
      return {
        id: Number(row.id),
        name,
        ordering: typeof row.ordering === 'number' ? row.ordering : 0,
        status,
        statusZh: STATUS_ZH[status] || status,
        type,
        typeZh: TYPE_ZH[type] || type,
        category,
        categoryZh: CATEGORY_ZH[category] || category,
        notesEn,
        notesZh: translateVehicleNotes(name, notesEn),
        imageSource: String(row.image || '').trim(),
        image: '', // 镜像后填充云存储 fileID
        imageMissing: false
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.ordering - a.ordering)
}

function normalizeTests(rawList) {
  return (rawList || [])
    .map((row) => {
      if (!row || typeof row !== 'object' || row.id == null) return null
      const name = String(row.name || '').trim()
      return {
        id: Number(row.id),
        vehicleId: Number(row.starship_vehicle),
        name,
        nameZh: translateTestName(name),
        notesEn: String(row.notes || '').replace(/\r\n/g, '\n').trim(),
        date: String(row.date || ''),
        location: String(row.location || '').trim(),
        locationZh: translateLocation(row.location),
        vidUrl: String(row.vid_url || '').trim(),
        infoUrl: String(row.info_url || '').trim()
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

// ── 图片镜像 ──

function fetchBinary(urlStr, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(urlStr)
    } catch (e) {
      reject(new Error('bad_url'))
      return
    }
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SpaceSync/1.0)',
          Accept: 'image/*,*/*;q=0.8'
        },
        timeout: IMAGE_DOWNLOAD_TIMEOUT_MS
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume()
          const next = new URL(res.headers.location, urlStr).toString()
          fetchBinary(next, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('http_' + res.statusCode))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

function cloudPathForImage(vehicleId, srcUrl) {
  const hash = crypto.createHash('md5').update(String(srcUrl)).digest('hex').slice(0, 8)
  const extMatch = String(srcUrl).match(/\.(webp|jpg|jpeg|png|gif)(?:\?|$)/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : 'webp'
  return `nsf-hardware/v${vehicleId}_${hash}.${ext}`
}

/**
 * 将 vehicles 中的 Google 存储图片镜像到云开发存储。
 * 已镜像且源 URL 未变的直接复用；失败的载具标记 imageMissing。
 * @returns {{ map: object, mirrored: number, reused: number, failed: string[] }}
 */
async function mirrorImages(cloud, vehicles, prevMap, budgetMs) {
  const startTime = Date.now()
  const map = {}
  let mirrored = 0
  let reused = 0
  const failed = []

  for (const v of vehicles) {
    const key = String(v.id)
    const prev = prevMap && prevMap[key]
    if (prev && prev.fileID && prev.srcUrl === v.imageSource) {
      map[key] = prev
      v.image = prev.fileID
      reused++
      continue
    }
    if (!v.imageSource) {
      v.imageMissing = true
      continue
    }
    if (Date.now() - startTime > budgetMs || mirrored >= MAX_IMAGE_DOWNLOADS_PER_RUN) {
      // 预算用尽：保留旧镜像（若有），其余下轮继续
      if (prev && prev.fileID) {
        map[key] = prev
        v.image = prev.fileID
        reused++
      } else {
        v.imageMissing = true
        failed.push(`${v.name}: budget_exhausted`)
      }
      continue
    }
    try {
      const buf = await fetchBinary(v.imageSource)
      if (!buf || buf.length < 100) throw new Error('empty_body')
      const cloudPath = cloudPathForImage(v.id, v.imageSource)
      const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buf })
      if (!uploadRes || !uploadRes.fileID) throw new Error('upload_no_fileid')
      map[key] = { srcUrl: v.imageSource, fileID: uploadRes.fileID }
      v.image = uploadRes.fileID
      mirrored++
    } catch (e) {
      // 下载/上传失败：沿用旧镜像（即使源 URL 已更新，旧图也好过没图）
      if (prev && prev.fileID) {
        map[key] = prev
        v.image = prev.fileID
        reused++
      } else {
        v.imageMissing = true
      }
      failed.push(`${v.name}: ${e.message || 'mirror_failed'}`)
    }
  }

  return { map, mirrored, reused, failed }
}

// ── 星舰组合体进展卡片自动同步 ──

const STARSHIP_STATUS_COLLECTION = 'starshipStatus'

/** 'Ship 40' → 'S40'，'Booster 20' → 'B20' */
function shortVehicleId(name) {
  const m = String(name || '').trim().match(/^(Ship|Booster)\s+(.+)$/i)
  if (!m) return ''
  return (m[1].toLowerCase() === 'ship' ? 'S' : 'B') + m[2].replace(/\s+/g, '').toUpperCase()
}

/** 当前载具 = 该分类下状态 Active 且 ordering 最小（编号最小 = 最近下一次任务） */
function pickCurrentVehicle(vehicles, category) {
  let best = null
  for (const v of vehicles) {
    if (v.category !== category || v.status !== 'Active') continue
    if (!best || v.ordering < best.ordering) best = v
  }
  return best
}

/**
 * 将当前飞船/助推器信息自动写入 starshipStatus/current（组合体进展两张卡片）。
 * 默认数据全自动跟随 NSF 硬件设施；后台手动改数据只是备用（nsfAutoSync=false 切手动模式）。
 * - 文档 nsfAutoSync === false 时完全跳过（后台手动模式）
 * - 载具换代（编号变化）：更新编号/主图，清掉旧载具的图片覆盖字段与标题
 * - 每轮持续对齐：状态、状态文案（statusZh）、简介（notesZh）始终跟随硬件设施数据，
 *   避免卡片/详情页与硬件设施列表脱节
 * - NSF 没有的字段（进度、清单、标题、副标题）仍由后台维护，不触碰
 */
async function updateStarshipStatusCard(db, vehicles) {
  let doc = null
  try {
    const r = await db.collection(STARSHIP_STATUS_COLLECTION).doc('current').get()
    doc = r && r.data ? r.data : null
  } catch (e) {}
  if (!doc) return { skipped: true, reason: 'no_status_doc' }
  if (doc.nsfAutoSync === false) return { skipped: true, reason: 'disabled' }

  const prevAuto = doc.nsfAuto || {}
  const updates = {}
  const changed = []
  const picked = {}
  let pickedDirty = false

  for (const side of ['booster', 'ship']) {
    const cur = pickCurrentVehicle(vehicles, side)
    if (!cur) continue
    const newId = shortVehicleId(cur.name)
    if (!newId) continue

    const node = doc[side] || {}
    const nodeDetail = node.detail || {}
    const prevMeta = prevAuto[side] || {}
    const newStatus = String(cur.status || '').toUpperCase()
    const statusChanged = String(node.status || '').toUpperCase() !== newStatus
    const rotated = String(node.id || '').trim().toUpperCase() !== newId
    // 换代当轮镜像图未就绪时记 imagePending，后续轮次补图
    const imagePending = !rotated && prevMeta.id === newId && prevMeta.imagePending === true

    const meta = { id: newId, name: cur.name, status: cur.status, imagePending: false }
    const patch = {}
    const detailPatch = {}

    if (rotated) {
      patch.id = newId
      if (cur.image) {
        // 换代后旧载具照片已过期：主图切到 NSF 镜像，并清掉后台的图片覆盖字段
        patch.image = cur.image
        patch.images = [cur.image]
        patch.previewImages = []
        patch.thumbnailMediaKey = ''
        patch.thumbnailFallback = ''
        detailPatch.heroMediaKey = ''
        detailPatch.heroFallback = ''
      } else {
        meta.imagePending = true
      }
      // 标题跟随新载具；留空由客户端按编号生成（星舰S41 / 助推器B21）
      detailPatch.title = ''
    } else if (cur.image && (imagePending || (!node.image && !node.thumbnailMediaKey))) {
      // 补图：换代轮次没镜像成功、或卡片本来没图
      patch.image = cur.image
      patch.images = [cur.image]
      if (imagePending) {
        patch.thumbnailMediaKey = ''
        patch.thumbnailFallback = ''
      }
    } else if (imagePending && !cur.image) {
      meta.imagePending = true
    }

    // 状态 / 状态文案 / 简介：每轮持续对齐硬件设施数据（默认自动）
    // NSF 有值且与当前不同就覆盖；后台手动改的值仅在 NSF 缺数据或 nsfAutoSync=false 时生效
    if (statusChanged) patch.status = newStatus
    if (cur.statusZh && nodeDetail.statusText !== cur.statusZh) {
      detailPatch.statusText = cur.statusZh
    }
    if (cur.notesZh && nodeDetail.summary !== cur.notesZh) {
      detailPatch.summary = cur.notesZh
    }

    picked[side] = meta
    if (meta.imagePending !== (prevMeta.imagePending === true) || prevMeta.id !== newId) pickedDirty = true

    if (Object.keys(detailPatch).length > 0) patch.detail = detailPatch
    if (Object.keys(patch).length > 0) {
      updates[side] = patch
      changed.push(rotated ? `${side}:${newId}` : side)
    }
  }

  if (changed.length === 0 && !pickedDirty) return { skipped: true, reason: 'no_change', picked }

  updates.nsfAuto = { ...picked, updatedAtMs: Date.now() }
  await db.collection(STARSHIP_STATUS_COLLECTION).doc('current').update({ data: updates })
  return { updated: changed, picked }
}

// ── 主流程 ──

async function readDocSafe(coll, docId) {
  try {
    const r = await coll.doc(docId).get()
    return r && r.data ? r.data : null
  } catch (e) {
    return null
  }
}

/**
 * 抓取并写入 nextspaceflight_hardware_cache；抓取/解析失败时保留旧数据
 * @param {object} db 云数据库实例
 * @param {object} cloud wx-server-sdk 实例（用于 uploadFile）
 * @param {{ force?: boolean, skipImages?: boolean, imageBudgetMs?: number, minIntervalMs?: number }} [options]
 *   force=true（手动触发）跳过节流；定时触发默认 6 小时内不重复抓取
 */
async function runSyncStarshipHardware(db, cloud, options) {
  const opts = options || {}
  const coll = db.collection(COLLECTION)
  const startTime = Date.now()

  const prevVehiclesDoc = await readDocSafe(coll, 'vehicles')

  // ── 节流：上次成功同步距今不足最小间隔时直接跳过（不发任何外部请求） ──
  if (!opts.force) {
    const minInterval = typeof opts.minIntervalMs === 'number' ? opts.minIntervalMs : MIN_SYNC_INTERVAL_MS
    const lastOkAt = prevVehiclesDoc && !prevVehiclesDoc.error && Array.isArray(prevVehiclesDoc.list) && prevVehiclesDoc.list.length > 0
      ? (prevVehiclesDoc.updatedAtMs || 0)
      : 0
    const sinceLast = Date.now() - lastOkAt
    if (lastOkAt > 0 && sinceLast < minInterval) {
      return {
        success: true,
        skipped: true,
        reason: 'throttled',
        lastSyncAgoMs: sinceLast,
        nextEligibleInMs: minInterval - sinceLast
      }
    }
  }

  const prevImageMapDoc = await readDocSafe(coll, 'image_map')
  const prevMap = (prevImageMapDoc && prevImageMapDoc.map) || {}

  let html
  try {
    html = await fetchUrlText(NSF_STARSHIP_PAGE)
  } catch (e) {
    const err = e.message || 'fetch_failed'
    await coll.doc('vehicles').set({
      data: {
        list: (prevVehiclesDoc && prevVehiclesDoc.list) || [],
        updatedAtMs: Date.now(),
        error: err
      }
    })
    return { success: false, error: err, elapsed: Date.now() - startTime }
  }

  let parsed
  try {
    parsed = parseHardwareFromHtml(html)
  } catch (e) {
    const err = e.message || 'parse_failed'
    await coll.doc('vehicles').set({
      data: {
        list: (prevVehiclesDoc && prevVehiclesDoc.list) || [],
        updatedAtMs: Date.now(),
        error: err,
        parserMeta: { ok: false, triedStrategies: e.triedStrategies || [], parsedAtMs: Date.now() }
      }
    })
    return { success: false, error: err, elapsed: Date.now() - startTime }
  }

  const vehicles = normalizeVehicles(parsed.vehicles)
  const tests = normalizeTests(parsed.tests)

  // 图片镜像（失败不阻塞数据落库）
  let imageStats = { map: prevMap, mirrored: 0, reused: 0, failed: [] }
  if (!opts.skipImages) {
    try {
      imageStats = await mirrorImages(cloud, vehicles, prevMap, opts.imageBudgetMs || IMAGE_MIRROR_BUDGET_MS)
      await coll.doc('image_map').set({
        data: { map: imageStats.map, updatedAtMs: Date.now() }
      })
    } catch (e) {
      imageStats.failed.push('image_map_write: ' + (e.message || ''))
    }
  } else {
    // 跳过镜像时仍沿用旧 fileID
    for (const v of vehicles) {
      const prev = prevMap[String(v.id)]
      if (prev && prev.fileID) v.image = prev.fileID
      else v.imageMissing = true
    }
  }

  await coll.doc('vehicles').set({
    data: {
      list: vehicles,
      updatedAtMs: Date.now(),
      error: '',
      parserMeta: { ok: true, strategy: parsed.strategy, parsedAtMs: Date.now() }
    }
  })
  await coll.doc('tests').set({
    data: { list: tests, updatedAtMs: Date.now() }
  })

  // 组合体进展卡片自动跟进（失败不影响硬件数据落库）
  let statusCard
  try {
    statusCard = await updateStarshipStatusCard(db, vehicles)
  } catch (e) {
    statusCard = { error: e.message || String(e) }
  }

  return {
    success: true,
    vehicleCount: vehicles.length,
    testCount: tests.length,
    statusCard,
    parserStrategy: parsed.strategy,
    imagesMirrored: imageStats.mirrored,
    imagesReused: imageStats.reused,
    imageFailures: imageStats.failed.length > 0 ? imageStats.failed : undefined,
    elapsed: Date.now() - startTime
  }
}

module.exports = {
  COLLECTION,
  runSyncStarshipHardware,
  updateStarshipStatusCard,
  parseHardwareFromHtml,
  normalizeVehicles,
  normalizeTests
}
