/**
 * upcoming NET 迟滞：syncLaunches 整表覆写前读旧 slim 并按 id merge。
 * 单行语义在 net-patch-policy.mergeLiveRowNetHysteresis（探针 / resolve 共用）。
 */

const {
  sortResultsByNetAsc,
  evaluateNetAdvance,
  mergeLiveRowNetHysteresis
} = require('./net-patch-policy.js')

const {
  SPACE_DEVS_CACHE,
  UPCOMING_PARAMS,
  upcomingCacheKey
} = require('./cache-write-guard.js')

const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

/**
 * @param {Array} previousResults 旧 upcoming slim 行
 * @param {Array} nextResults 本次 live/detailed slim 行
 * @param {number} [nowMs]
 * @returns {{ results: Array, preserved: number, applied: number, reasons: Object }}
 */
function mergeUpcomingResultsWithNetHysteresis(previousResults, nextResults, nowMs) {
  const now = Number(nowMs) || Date.now()
  const oldById = new Map()
  if (Array.isArray(previousResults)) {
    for (let i = 0; i < previousResults.length; i++) {
      const r = previousResults[i]
      if (r && r.id != null) oldById.set(String(r.id), r)
    }
  }

  const reasons = {}
  let preserved = 0
  let applied = 0
  const out = []
  const list = Array.isArray(nextResults) ? nextResults : []

  for (let i = 0; i < list.length; i++) {
    const live = list[i]
    if (!live || live.id == null) {
      out.push(live)
      continue
    }
    const prev = oldById.get(String(live.id))
    if (!prev) {
      out.push(live)
      applied++
      continue
    }
    const decision = evaluateNetAdvance(prev, live, now)
    const merged = mergeLiveRowNetHysteresis(prev, live, now)
    if (decision.reject) {
      preserved++
      const key = decision.reason || 'rejected'
      reasons[key] = (reasons[key] || 0) + 1
    } else {
      applied++
    }
    out.push(merged)
  }

  sortResultsByNetAsc(out, now)
  return { results: out, preserved, applied, reasons }
}

function unwrapDocPayload(doc) {
  if (!doc || !doc.data) return null
  const wrapper = doc.data
  if (wrapper.data && typeof wrapper.data === 'object') {
    return { wrapper, payload: wrapper.data }
  }
  if (Array.isArray(wrapper.results) || wrapper.isBatched || wrapper.isBatch) {
    return { wrapper, payload: wrapper }
  }
  return null
}

async function readBatchResults(db, batchKey) {
  try {
    const doc = await db.collection(SPACE_DEVS_CACHE).doc(batchKey).get()
    const unwrapped = unwrapDocPayload(doc)
    const payload = unwrapped && unwrapped.payload
    if (!payload || !Array.isArray(payload.results)) return null
    return payload.results
  } catch (e) {
    return null
  }
}

/**
 * best-effort 读旧 upcoming：分片缺失不整表放弃，尽量保留已有 id 的 NET。
 */
async function loadUpcomingSlimResultsBestEffort(db) {
  if (!db) return { cacheKey: '', results: [], batched: false }

  const col = db.collection(SPACE_DEVS_CACHE)
  let cacheKey = ''
  let payload = null
  for (let i = 0; i < CANDIDATE_SUFFIXES.length; i++) {
    const key = upcomingCacheKey(CANDIDATE_SUFFIXES[i])
    try {
      const doc = await col.doc(key).get()
      const unwrapped = unwrapDocPayload(doc)
      if (unwrapped && unwrapped.payload) {
        cacheKey = key
        payload = unwrapped.payload
        break
      }
    } catch (e) {}
  }
  if (!payload) return { cacheKey: '', results: [], batched: false }

  const inline = Array.isArray(payload.results) ? payload.results : []
  const hollow =
    !!(payload.isBatched || payload.isBatch) ||
    (inline.length === 0 && Number(payload.count) > 0)

  if (!hollow) {
    return { cacheKey, results: inline.slice(), batched: false }
  }

  const results = []
  const declared =
    Array.isArray(payload.batchKeys) && payload.batchKeys.length
      ? payload.batchKeys.slice()
      : null

  if (declared) {
    for (let i = 0; i < declared.length; i++) {
      const chunk = await readBatchResults(db, declared[i])
      if (Array.isArray(chunk)) {
        for (let j = 0; j < chunk.length; j++) results.push(chunk[j])
      }
    }
  } else {
    let miss = 0
    for (let i = 0; i < 40; i++) {
      const chunk = await readBatchResults(db, `${cacheKey}_batch_${i}`)
      if (!chunk) {
        miss++
        if (miss >= 2) break
        continue
      }
      miss = 0
      for (let j = 0; j < chunk.length; j++) results.push(chunk[j])
    }
  }

  return { cacheKey, results, batched: true }
}

/**
 * syncLaunches 写库前：读旧 slim，按 id 做 NET 迟滞，再排序。
 */
async function applyUpcomingNetHysteresisFromCache(db, nextResults, nowMs) {
  const loaded = await loadUpcomingSlimResultsBestEffort(db)
  if (!loaded.results.length) {
    const sorted = Array.isArray(nextResults) ? nextResults.slice() : []
    sortResultsByNetAsc(sorted, nowMs)
    return {
      results: sorted,
      preserved: 0,
      applied: sorted.length,
      reasons: {},
      hadPrevious: false,
      previousCount: 0,
      cacheKey: loaded.cacheKey || ''
    }
  }
  const merged = mergeUpcomingResultsWithNetHysteresis(loaded.results, nextResults, nowMs)
  return {
    ...merged,
    hadPrevious: true,
    previousCount: loaded.results.length,
    cacheKey: loaded.cacheKey || ''
  }
}

module.exports = {
  UPCOMING_PARAMS,
  mergeLiveRowNetHysteresis,
  mergeUpcomingResultsWithNetHysteresis,
  loadUpcomingSlimResultsBestEffort,
  applyUpcomingNetHysteresisFromCache
}
