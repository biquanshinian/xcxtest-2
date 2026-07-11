/**
 * syncSpaceDevsData 共享工具模块
 * 从 3781 行单体 index.js 中提取的公共函数
 */
const cloud = require('wx-server-sdk')
const { enrichApiDataForTranslation } = require('./ll2-translate-enrich.js')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 生产 LL2：https://ll.thespacedevs.com/2.3.0/（FAQ：upcoming 可用 hide_recent_previous 减少「刚打完仍占位」条目）
const LAUNCH_LIBRARY_API = 'https://ll.thespacedevs.com/2.3.0'
const PAYLOAD_API_BASE = 'https://ll.thespacedevs.com/2.3.0'
const SPACEFLIGHT_NEWS_API = 'https://api.spaceflightnewsapi.net/v4'
const CACHE_DURATION = 6.5 * 60 * 60 * 1000

/** 轻量小时用量计数（写 launch_timeline_cache/_ll2_usage_hourly），便于监控匿名档是否触顶 */
const LL2_USAGE_DOC = '_ll2_usage_hourly'
let _ll2UsageBucket = ''
let _ll2UsageCount = 0
let _ll2UsageFlushAt = 0

function ll2HourBucket(nowMs) {
  const d = new Date(nowMs || Date.now())
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  return `${y}${m}${day}T${h}`
}

function isLl2TokenConfigured() {
  const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
  return !!(token && token !== 'FILL_ME')
}

function noteLl2Request(source) {
  try {
    const now = Date.now()
    const bucket = ll2HourBucket(now)
    if (_ll2UsageBucket !== bucket) {
      _ll2UsageBucket = bucket
      _ll2UsageCount = 0
    }
    _ll2UsageCount += 1
    // 节流写库：每 5 次或距上次 ≥60s
    if (_ll2UsageCount % 5 !== 0 && now - _ll2UsageFlushAt < 60 * 1000) return
    _ll2UsageFlushAt = now
    const authed = isLl2TokenConfigured()
    db.collection('launch_timeline_cache').doc(LL2_USAGE_DOC).set({
      data: {
        hourUtc: bucket,
        count: _ll2UsageCount,
        authed,
        source: source || 'syncSpaceDevsData',
        updatedAtMs: now
      }
    }).catch(() => {})
    if (!authed && _ll2UsageCount >= 12) {
      console.warn('[LL2] anonymous hour usage high:', _ll2UsageCount, 'bucket=', bucket, '— configure LL2_API_TOKEN')
    }
  } catch (e) {}
}

async function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; SpaceSync/1.0)',
      'Accept': 'application/json'
    }
    if (token && token !== 'FILL_ME') headers['Authorization'] = `Token ${token}`

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 30000
    }

    const req = client.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          if (/thespacedevs\.com$/i.test(urlObj.hostname)) noteLl2Request('syncSpaceDevsData')
          resolve(JSON.parse(data))
        }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

async function saveToCloudDB(cacheKey, apiData, retryCount) {
  if (retryCount === undefined) retryCount = 0
  const MAX_RETRIES = 3
  const collection = db.collection('space_devs_cache')

  const record = {
    cacheKey,
    data: apiData,
    updatedAt: db.serverDate(),
    updatedAtMs: Date.now(),
    expiresAt: new Date(Date.now() + CACHE_DURATION)
  }

  const dataStr = JSON.stringify(apiData)
  const sizeKB = Math.ceil(dataStr.length / 1024)

  try {
    if (sizeKB > 800) {
      const results = apiData.results || []
      const batchSize = Math.ceil(results.length / Math.ceil(sizeKB / 600))
      const batches = []
      for (let i = 0; i < results.length; i += batchSize) {
        batches.push(results.slice(i, i + batchSize))
      }
      for (let i = 0; i < batches.length; i++) {
        const batchKey = cacheKey + '_batch_' + i
        const batchRecord = {
          cacheKey: batchKey,
          parentKey: cacheKey,
          batchIndex: i,
          totalBatches: batches.length,
          data: { results: batches[i], count: apiData.count || results.length },
          updatedAt: db.serverDate(),
          updatedAtMs: Date.now(),
          expiresAt: new Date(Date.now() + CACHE_DURATION)
        }
        await upsertDoc(collection, batchKey, batchRecord)
      }
      const metaRecord = {
        cacheKey,
        isBatched: true,
        totalBatches: batches.length,
        totalCount: apiData.count || results.length,
        updatedAt: db.serverDate(),
        updatedAtMs: Date.now(),
        expiresAt: new Date(Date.now() + CACHE_DURATION)
      }
      await upsertDoc(collection, cacheKey, metaRecord)
    } else {
      await upsertDoc(collection, cacheKey, record)
    }
  } catch (e) {
    if (retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
      return saveToCloudDB(cacheKey, apiData, retryCount + 1)
    }
    throw e
  }
}

async function upsertDoc(collection, docId, record) {
  try {
    const { data } = await collection.where({ cacheKey: docId }).limit(1).get()
    if (data.length > 0) {
      await collection.doc(data[0]._id).update({ data: record })
    } else {
      await collection.add({ data: record })
    }
  } catch (e) {
    await collection.add({ data: record })
  }
}

async function syncAPIEndpoint(url, params, apiBase, fetchAll, maxPages, maxApiCalls) {
  if (params === undefined) params = {}
  if (fetchAll === undefined) fetchAll = false
  if (maxPages === undefined) maxPages = 5
  if (maxApiCalls === undefined) maxApiCalls = 5

  const cacheKey = url.replace(/\//g, '_').replace(/^_/, '')

  if (fetchAll) {
    return syncAPIEndpointWithPagination(url, params, apiBase, maxPages, 30000, maxApiCalls)
  }

  let fullUrl
  if (url.startsWith('http://') || url.startsWith('https://')) {
    fullUrl = url
  } else {
    const base = apiBase || (url.startsWith('/payloads') || url.startsWith('/payload_flights') ? PAYLOAD_API_BASE : LAUNCH_LIBRARY_API)
    fullUrl = base + url
  }

  if (Object.keys(params).length > 0) {
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&')
    fullUrl += (url.includes('?') ? '&' : '?') + qs
  }

  const apiData = await Promise.race([
    fetchAPI(fullUrl),
    new Promise((_, reject) => setTimeout(() => reject(new Error('API请求超时')), 25000))
  ])

  let enrichedData = apiData
  try {
    enrichedData = await enrichApiDataForTranslation(url, params, apiData, apiBase)
  } catch (translateErr) {
    console.warn('[translate-enrich]', translateErr.message || translateErr)
  }

  await saveToCloudDB(cacheKey, enrichedData)
  return { success: true, cacheKey, count: (apiData.results && apiData.results.length) || 0 }
}

async function syncAPIEndpointWithPagination(url, baseParams, apiBase, maxPages, maxExecutionTime, maxApiCalls) {
  if (baseParams === undefined) baseParams = {}
  if (maxPages === undefined) maxPages = 5
  if (maxExecutionTime === undefined) maxExecutionTime = 30000
  if (maxApiCalls === undefined) maxApiCalls = 5

  const startTime = Date.now()
  const limit = baseParams.limit || 100
  const cacheKey = url.replace(/\//g, '_').replace(/^_/, '')
  const progressKey = 'sync_progress_' + cacheKey

  // 读取上次断点进度
  let savedResults = []
  let offset = baseParams.offset || 0
  try {
    const progressDoc = await db.collection('space_devs_cache').doc(progressKey).get()
    if (progressDoc.data && progressDoc.data.data) {
      const prog = progressDoc.data.data
      // 进度未过期（6 小时内有效）且有已保存的结果
      if (prog.updatedAt && Date.now() - prog.updatedAt < 6 * 60 * 60 * 1000 && prog.completed) {
        // 上次已全部完成，直接跳过
        console.log(`[Pagination] ${url} 上次已全部完成，跳过`)
        return { success: true, cacheKey, totalResults: 0, pages: 0, apiCalls: 0, resumed: false, skipped: true }
      }
      if (prog.updatedAt && Date.now() - prog.updatedAt < 6 * 60 * 60 * 1000 && Array.isArray(prog.results) && prog.results.length > 0) {
        savedResults = prog.results
        offset = prog.nextOffset || savedResults.length
        console.log(`[Pagination] ${url} 从断点恢复: 已有 ${savedResults.length} 条, offset=${offset}`)
      }
    }
  } catch (e) {
    // 进度文档不存在，从头开始
  }

  let allResults = savedResults
  let hasMore = true
  let pageCount = 0
  let apiCallCount = 0

  while (hasMore && pageCount < maxPages && apiCallCount < maxApiCalls) {
    if (Date.now() - startTime > maxExecutionTime) break

    const currentParams = { ...baseParams, limit, offset }
    let fullUrl
    if (url.startsWith('http://') || url.startsWith('https://')) {
      fullUrl = url
    } else {
      const base = apiBase || (url.startsWith('/payloads') || url.startsWith('/payload_flights') ? PAYLOAD_API_BASE : LAUNCH_LIBRARY_API)
      fullUrl = base + url
    }
    if (Object.keys(currentParams).length > 0) {
      const qs = Object.keys(currentParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(currentParams[k])).join('&')
      fullUrl += (url.includes('?') ? '&' : '?') + qs
    }

    if (apiCallCount >= maxApiCalls) break

    try {
      const apiData = await Promise.race([
        fetchAPI(fullUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('API请求超时')), 25000))
      ])
      apiCallCount++

      if (!apiData || !apiData.results || !Array.isArray(apiData.results)) break
      allResults = allResults.concat(apiData.results)
      hasMore = !!(apiData.next && apiData.results.length === limit)
      offset += apiData.results.length
      pageCount++
      if (apiData.results.length < limit) hasMore = false
      if (hasMore) await new Promise(r => setTimeout(r, 200))
    } catch (e) {
      // 429 或超时：保存当前进度，下次继续
      if (allResults.length > 0) {
        try {
          await upsertDoc(db.collection('space_devs_cache'), progressKey, {
            results: allResults,
            nextOffset: offset,
            completed: false,
            updatedAt: Date.now()
          })
          console.log(`[Pagination] ${url} 中断，已保存进度: ${allResults.length} 条, nextOffset=${offset}`)
        } catch (saveErr) {}
        break
      }
      throw e
    }
  }

  // 写入最终缓存
  if (allResults.length > 0) {
    let payload = { results: allResults, count: allResults.length }
    try {
      payload = await enrichApiDataForTranslation(url, baseParams, payload, apiBase)
    } catch (translateErr) {
      console.warn('[translate-enrich]', translateErr.message || translateErr)
    }
    await saveToCloudDB(cacheKey, payload)
  }

  // 标记完成状态或保存中间进度
  const completed = !hasMore || allResults.length === 0
  try {
    if (completed) {
      // 全部完成，标记进度为已完成
      await upsertDoc(db.collection('space_devs_cache'), progressKey, {
        results: [],
        nextOffset: 0,
        completed: true,
        updatedAt: Date.now()
      })
    } else {
      // 未完成（配额/超时），保存断点
      await upsertDoc(db.collection('space_devs_cache'), progressKey, {
        results: allResults,
        nextOffset: offset,
        completed: false,
        updatedAt: Date.now()
      })
      console.log(`[Pagination] ${url} 未完成，保存断点: ${allResults.length} 条, nextOffset=${offset}`)
    }
  } catch (e) {}

  return { success: true, cacheKey, totalResults: allResults.length, pages: pageCount, apiCalls: apiCallCount, resumed: savedResults.length > 0, completed }
}

module.exports = {
  db,
  cloud,
  LAUNCH_LIBRARY_API,
  PAYLOAD_API_BASE,
  SPACEFLIGHT_NEWS_API,
  CACHE_DURATION,
  fetchAPI,
  isLl2TokenConfigured,
  noteLl2Request,
  saveToCloudDB,
  upsertDoc,
  syncAPIEndpoint,
  syncAPIEndpointWithPagination
}
