/**
 * syncTLE — 统一 TLE 同步云函数
 * 合并原 syncStarlinkTLE + syncStationTLE，通过 event.action 区分
 *
 * action: 'starlink' | 'station' | 'all'（默认 'all'）
 * 触发器：每 6 小时
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 16 })

// ── 共享 HTTP 工具 ──
function httpGet(url, timeout) {
  if (timeout === undefined) timeout = 30000
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TLE-Sync/1.0)', 'Accept': '*/*' },
      timeout,
      agent: keepAliveAgent
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode))
        res.resume()
        return
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ══════════════════════════════════════════════
//  Station TLE（ISS + CSS，单条记录）
// ══════════════════════════════════════════════
const STATION_COLLECTION = 'station_tle'
const STATION_RECORD_ID = 'latest'
const STATION_WORKER_URL = 'https://spacex-proxy.huyuzetongxue.workers.dev/station-tle'
const CELESTRAK_STATIONS = [
  { noradId: '25544', stationName: 'ISS' },
  { noradId: '48274', stationName: 'CSS' }
]

function parseSingleTLE(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim())
  if (lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ')) {
    return { name: lines[0], line1: lines[1], line2: lines[2] }
  }
  return null
}

async function syncStation() {
  const tag = '[syncTLE:station]'
  const startTime = Date.now()
  console.log(tag, 'Start')
  const errors = []

  // CelesTrak 直连优先（实测腾讯云环境可达；workers.dev 通常超时）
  try {
    const tle = {}
    for (const src of CELESTRAK_STATIONS) {
      try {
        const url = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=' + src.noradId + '&FORMAT=TLE'
        const raw = await httpGet(url, 20000)
        const parsed = parseSingleTLE(raw)
        if (parsed) tle[src.noradId] = parsed
      } catch (e) {
        console.warn(tag, src.stationName, '失败:', e.message)
      }
    }
    if (!Object.keys(tle).length) throw new Error('CelesTrak 所有站点均失败')
    const stationCount = Object.keys(tle).filter(k => tle[k]).length
    await upsertStationRecord({ tle, source: 'CelesTrak-direct', fetchedAt: Date.now(), updatedAt: db.serverDate(), updatedAtMs: Date.now(), stationCount })
    console.log(tag, '完成:', stationCount, '个站点, CelesTrak,', (Date.now() - startTime) + 'ms')
    return { ok: true, stations: stationCount, source: 'CelesTrak-direct', elapsed: Date.now() - startTime }
  } catch (e) {
    errors.push('CelesTrak: ' + e.message)
  }

  // Worker 兜底
  try {
    const text = await httpGet(STATION_WORKER_URL, 20000)
    const json = JSON.parse(text)
    if (json.code !== 0 || !json.tle) throw new Error('Worker 返回异常')
    const tle = json.tle
    if (!tle['25544'] && !tle['48274']) throw new Error('TLE 数据为空')
    const stationCount = Object.keys(tle).filter(k => tle[k]).length
    await upsertStationRecord({ tle, source: 'Worker', fetchedAt: json.ts || Date.now(), updatedAt: db.serverDate(), updatedAtMs: Date.now(), stationCount })
    console.log(tag, '完成:', stationCount, '个站点, Worker,', (Date.now() - startTime) + 'ms')
    return { ok: true, stations: stationCount, source: 'Worker', elapsed: Date.now() - startTime }
  } catch (e) {
    console.warn(tag, 'Worker 失败:', e.message)
    errors.push('Worker: ' + e.message)
  }

  console.error(tag, '所有源均失败:', errors.join(' | '))
  return { ok: false, error: 'All sources failed', details: errors }
}

async function upsertStationRecord(record) {
  const collection = db.collection(STATION_COLLECTION)
  const { data } = await collection.where({ recordId: STATION_RECORD_ID }).limit(1).get()
  if (data.length > 0) {
    await collection.doc(data[0]._id).update({ data: record })
  } else {
    await collection.add({ data: { recordId: STATION_RECORD_ID, ...record } })
  }
}

// ══════════════════════════════════════════════
//  Starlink TLE（9800+ 颗卫星，分片存储）
// ══════════════════════════════════════════════
const STARLINK_COLLECTION = 'starlink_tle'
const MIN_TRUSTED_COUNT = 2000
const SATS_PER_SHARD = 3500

// 依次尝试：直连 CelesTrak（实测腾讯云环境可达，gp.php 主端点 + supplemental 备端点）→
// Worker 缓存兜底（workers.dev 在腾讯云环境通常超时，仅作最后防线，超时给短）
const STARLINK_SOURCES = [
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', type: 'raw', timeout: 90000 },
  { url: 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle', type: 'raw', timeout: 90000 },
  { url: 'https://spacex-proxy.huyuzetongxue.workers.dev/starlink-tle-mini', type: 'mini', timeout: 30000 }
]

function parseTLELines(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim())
  const sats = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1] && lines[i + 1].startsWith('1 ') && lines[i + 2] && lines[i + 2].startsWith('2 ')) {
      const noradId = lines[i + 1].substring(2, 7).trim()
      sats.push({ id: noradId, n: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] })
    }
  }
  return sats
}

function parseMiniJSON(text) {
  const json = JSON.parse(text)
  // Worker 实际返回 { total, sampled, tle: "<name\nl1\nl2 ...>" }，tle 为拼接文本
  if (json && typeof json.tle === 'string') return parseTLELines(json.tle)
  // 兼容旧数组格式 { data: [...] } / { sats: [...] } / [...]
  const arr = json.data || json.sats || json
  if (!Array.isArray(arr)) throw new Error('mini 格式异常')
  return arr.map(s => ({ id: String(s.id || s.noradId), n: s.name || s.n || '', l1: s.line1 || s.l1, l2: s.line2 || s.l2 }))
}

async function syncStarlink() {
  const tag = '[syncTLE:starlink]'
  const startTime = Date.now()
  console.log(tag, 'Start')

  let sats = null
  let usedSource = ''

  for (const src of STARLINK_SOURCES) {
    try {
      console.log(tag, '尝试源:', src.url.substring(0, 60))
      const text = await httpGet(src.url, src.timeout || 45000)
      const parsed = src.type === 'mini' ? parseMiniJSON(text) : parseTLELines(text)
      if (parsed.length < MIN_TRUSTED_COUNT) throw new Error('数量不足: ' + parsed.length)
      sats = parsed
      usedSource = src.type === 'mini' ? 'Worker-mini' : 'CelesTrak-raw'
      console.log(tag, '获取成功:', parsed.length, '颗, 来源:', usedSource)
      break
    } catch (e) {
      console.warn(tag, src.type, '失败:', e.message)
    }
  }

  if (!sats) {
    console.error(tag, '所有源均失败')
    return { ok: false, error: 'All sources failed' }
  }

  const collection = db.collection(STARLINK_COLLECTION)
  const shardCount = Math.ceil(sats.length / SATS_PER_SHARD)

  for (let i = 0; i < shardCount; i++) {
    const chunk = sats.slice(i * SATS_PER_SHARD, (i + 1) * SATS_PER_SHARD)
    // 前端三个读取方均消费 data 文本字段：name/l1/l2 三行一组、\n 分隔
    const tleText = chunk.map(s => s.n + '\n' + s.l1 + '\n' + s.l2).join('\n')

    const shardData = {
      shardIndex: i,
      data: tleText,
      satCount: chunk.length,
      updatedAt: db.serverDate(),
      updatedAtMs: Date.now()
    }
    if (i === 0) {
      shardData.totalCount = sats.length
      shardData.shardCount = shardCount
      shardData.source = usedSource
      shardData.fetchedAt = Date.now()
    }

    // set() 整体覆盖：文档不存在时自动创建，同时清掉残留的旧 tle map 字段
    await collection.doc('shard_' + i).set({ data: shardData })
    console.log(tag, 'shard', i, '写入完成:', chunk.length, '颗,', Math.round(tleText.length / 1024) + 'KB')
  }

  // 清理多余分片
  const { data: stale } = await collection.where({ shardIndex: db.command.gte(shardCount) }).get()
  for (const doc of stale) {
    await collection.doc(doc._id).remove()
  }
  const { data: legacy } = await collection.where({ shardIndex: db.command.exists(false) }).get()
  for (const doc of legacy) {
    await collection.doc(doc._id).remove()
  }
  // 清理重复分片：历史脚本用 add() 写入的随机 _id 文档与 doc('shard_i') 并存时，
  // 前端 where({shardIndex}).limit(1) 可能命中旧文档，读到冻结数据
  const { data: allShards } = await collection.where({ shardIndex: db.command.gte(0) }).field({ shardIndex: true }).get()
  for (const doc of allShards) {
    if (doc._id !== 'shard_' + doc.shardIndex) {
      await collection.doc(doc._id).remove()
      console.log(tag, '清理重复分片文档:', doc._id, '(shardIndex=' + doc.shardIndex + ')')
    }
  }

  const elapsed = Date.now() - startTime
  console.log(tag, '完成:', sats.length, '颗,', shardCount, '片, 来源:', usedSource, ',', elapsed + 'ms')
  return { ok: true, count: sats.length, shards: shardCount, source: usedSource, elapsed }
}

// ── 入口 ──
exports.main = async (event) => {
  const action = (event && event.action) || 'all'
  const entryStart = Date.now()
  console.log('[syncTLE] action:', action, 'start')

  if (action === 'station') return syncStation()
  if (action === 'starlink') return syncStarlink()

  // all: 并行执行
  const [stationResult, starlinkResult] = await Promise.allSettled([syncStation(), syncStarlink()])
  console.log('[syncTLE] all done,', (Date.now() - entryStart) + 'ms')
  return {
    station: stationResult.status === 'fulfilled' ? stationResult.value : { ok: false, error: stationResult.reason && stationResult.reason.message },
    starlink: starlinkResult.status === 'fulfilled' ? starlinkResult.value : { ok: false, error: starlinkResult.reason && starlinkResult.reason.message }
  }
}
