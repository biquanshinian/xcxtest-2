/**
 * SPACE_NOTICES_FEATURE — 只读 syncSpaceDevsData 已写入的 space_devs_cache
 * 不再单独请求 LL2（免费档 15 次/小时，与现有同步共用配额）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { slimFromCacheRow, resolvePadCoords, isStarshipLaunch } = require('./pad-coords.js')

const SPACE_DEVS_CACHE = 'space_devs_cache'
const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}

const PREVIOUS_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}

function sortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

async function readLaunchResultsFromCache(urlPath, baseParams) {
  const sortedParams = sortedParamsString(baseParams)
  const cacheCollection = db.collection(SPACE_DEVS_CACHE)
  let cacheKey = null
  let doc = null

  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = `api_cache_${urlPath}_${sortedParams}${sfx}`
    const d = await cacheCollection.doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      cacheKey = key
      doc = d
      break
    }
  }

  // 精确 key 未命中：正则回退最新一条（兼容参数微调）
  if (!doc || !doc.data || !doc.data.data) {
    const escaped = urlPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fallbackDocs = await cacheCollection
      .where({ _id: db.RegExp({ regexp: `api_cache_${escaped}`, options: 'i' }) })
      .limit(5)
      .get()
      .catch(() => ({ data: [] }))
    const rows = fallbackDocs.data || []
    // 优先带 slim_v6 的
    rows.sort((a, b) => {
      const as = String(a._id || '').includes('_slim_v6') ? 0 : 1
      const bs = String(b._id || '').includes('_slim_v6') ? 0 : 1
      return as - bs
    })
    if (rows.length) {
      doc = rows[0]
      cacheKey = doc._id
    }
  }

  if (!doc || !doc.data || !doc.data.data) return []

  const apiData = doc.data.data
  let allResults = []
  const isBatched =
    !!(apiData.isBatched || apiData.isBatch) ||
    (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)

  if (isBatched && cacheKey) {
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await cacheCollection.doc(batchKey).get().catch(() => null)
      const batchData = batchDoc && batchDoc.data && batchDoc.data.data
      if (!batchData || !Array.isArray(batchData.results)) break
      allResults = allResults.concat(batchData.results)
      batchIdx++
    }
  }
  if (!allResults.length && Array.isArray(apiData.results)) {
    allResults = apiData.results
  }
  return allResults
}

/**
 * 全量发射（即将 + 历史），用于给站点 entry 匹配发射身份
 * @param {{ starshipOnly?: boolean }} [opts]
 * @returns {Promise<{ launches: object[], source: string, upcomingCount: number, previousCount: number, starshipCount: number }>}
 */
async function loadLaunchesFromCache(opts) {
  const [upcoming, previous] = await Promise.all([
    readLaunchResultsFromCache('/launches/upcoming/', UPCOMING_PARAMS),
    readLaunchResultsFromCache('/launches/previous/', PREVIOUS_PARAMS)
  ])
  const map = new Map()
  upcoming.forEach((r) => {
    const s = slimFromCacheRow(r, opts)
    if (s) map.set(s.ll2Id, s)
  })
  previous.forEach((r) => {
    const s = slimFromCacheRow(r, opts)
    if (s && !map.has(s.ll2Id)) map.set(s.ll2Id, s)
  })
  const launches = [...map.values()]
  return {
    launches,
    source: 'space_devs_cache',
    upcomingCount: upcoming.length,
    previousCount: previous.length,
    starshipCount: launches.filter((l) => l.isStarship).length
  }
}

/** 兼容旧调用：只要星舰 */
function loadStarshipLaunchesFromCache() {
  return loadLaunchesFromCache({ starshipOnly: true })
}

module.exports = {
  loadLaunchesFromCache,
  loadStarshipLaunchesFromCache,
  resolvePadCoords,
  isStarshipLaunch
}
