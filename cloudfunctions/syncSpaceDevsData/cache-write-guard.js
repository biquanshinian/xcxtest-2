/**
 * space_devs_cache 列表落库加固：
 * - 分片写齐并回读校验后才切换主文档
 * - upcoming 分片健康检查 / count 自愈 / 缺片时触发 syncLaunches
 *
 * 客户端规则：主文档 isBatched + 全部分片成功，且合并条数 >= count，否则整页 cache_miss。
 * 写侧校验用严格相等，避免重复行 / 旧分片混入被 >= 放行。
 */

const SPACE_DEVS_CACHE = 'space_devs_cache'

const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}

const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

function sortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

function upcomingCacheKey(suffix) {
  return `api_cache_/launches/upcoming/_${sortedParamsString(UPCOMING_PARAMS)}${suffix || ''}`
}

function isSlimLaunchListKey(cacheKey) {
  const id = String(cacheKey || '')
  return (
    (id.indexOf('api_cache_/launches/upcoming/') === 0 ||
      id.indexOf('api_cache_/launches/previous/') === 0) &&
    /_slim_v\d+$/.test(id)
  )
}

/** 列表缓存不需要嵌套 updates（已拆到 launch_timeline_cache）；去掉可显著降低体积、优先单文档 */
function stripUpdatesFromListPayload(apiData) {
  if (!apiData || !Array.isArray(apiData.results) || !apiData.results.length) return apiData
  let changed = false
  const results = apiData.results.map((row) => {
    if (!row || typeof row !== 'object' || row.updates == null) return row
    changed = true
    const copy = { ...row }
    delete copy.updates
    return copy
  })
  return changed ? { ...apiData, results } : apiData
}

function unwrapDocPayload(doc) {
  if (!doc || !doc.data) return null
  const wrapper = doc.data
  if (wrapper.data && typeof wrapper.data === 'object') return { wrapper, payload: wrapper.data }
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

async function readExistingBatchKeys(db, cacheKey) {
  try {
    const doc = await db.collection(SPACE_DEVS_CACHE).doc(cacheKey).get()
    const unwrapped = unwrapDocPayload(doc)
    const payload = unwrapped && unwrapped.payload
    if (payload && Array.isArray(payload.batchKeys)) return payload.batchKeys.slice()
  } catch (e) {}
  return []
}

/**
 * 删除 keep 集合以外的旧分片。
 * extraCandidates：主文档已被改写（不再带 batchKeys）时，传入改写前的旧 key 列表，避免 generation 分片泄漏。
 */
async function removeOrphanBatchDocs(db, cacheKey, keepKeys, extraCandidates) {
  const keep = new Set(Array.isArray(keepKeys) ? keepKeys : [])
  const col = db.collection(SPACE_DEVS_CACHE)
  const oldKeys = await readExistingBatchKeys(db, cacheKey)
  const candidates = new Set(oldKeys)
  if (Array.isArray(extraCandidates)) {
    for (let i = 0; i < extraCandidates.length; i++) {
      if (extraCandidates[i]) candidates.add(extraCandidates[i])
    }
  }
  for (let i = 0; i < 40; i++) candidates.add(`${cacheKey}_batch_${i}`)
  for (const key of candidates) {
    if (!key || keep.has(key)) continue
    try {
      await col.doc(key).remove()
    } catch (e) {}
  }
}

/**
 * 回读校验分片：全部存在且合并条数 == expectedCount（写侧严格）
 */
async function verifyBatchedCache(db, cacheKey, expectedCount, batchKeys) {
  const keys = Array.isArray(batchKeys) ? batchKeys : []
  if (!keys.length) {
    return { ok: false, reason: 'no_batch_keys', mergedCount: 0, expectedCount, hasGap: false }
  }
  let mergedCount = 0
  const missingKeys = []
  for (let i = 0; i < keys.length; i++) {
    const chunk = await readBatchResults(db, keys[i])
    if (!chunk) {
      missingKeys.push(keys[i])
      continue
    }
    mergedCount += chunk.length
  }
  if (missingKeys.length) {
    return {
      ok: false,
      reason: 'batch_missing',
      missingKey: missingKeys[0],
      missingKeys,
      hasGap: true,
      mergedCount,
      expectedCount,
      presentBatches: keys.length - missingKeys.length
    }
  }
  if (expectedCount === 0 && mergedCount === 0) {
    // 空 upcoming 对首页不可用，不能当健康
    return {
      ok: false,
      reason: 'upcoming_empty',
      mergedCount: 0,
      expectedCount: 0,
      hasGap: false
    }
  }
  if (mergedCount !== expectedCount) {
    return {
      ok: false,
      reason: 'count_mismatch',
      mergedCount,
      expectedCount,
      hasGap: false
    }
  }
  return { ok: true, mergedCount, expectedCount, totalBatches: keys.length, hasGap: false }
}

async function loadUpcomingDoc(db) {
  const col = db.collection(SPACE_DEVS_CACHE)
  for (let i = 0; i < CANDIDATE_SUFFIXES.length; i++) {
    const key = upcomingCacheKey(CANDIDATE_SUFFIXES[i])
    try {
      const doc = await col.doc(key).get()
      const unwrapped = unwrapDocPayload(doc)
      if (unwrapped && unwrapped.payload) {
        return { cacheKey: key, wrapper: unwrapped.wrapper, payload: unwrapped.payload }
      }
    } catch (e) {}
  }
  return null
}

/**
 * 解析 batchKeys：优先主文档；否则按 totalBatches 全量探测（允许空洞，不提前 break 丢尾部）
 */
async function resolveBatchKeysForHealth(db, cacheKey, payload) {
  if (Array.isArray(payload.batchKeys) && payload.batchKeys.length) {
    return {
      batchKeys: payload.batchKeys.slice(),
      scanned: false,
      gaps: []
    }
  }
  const totalBatches = Number(payload.totalBatches) || 0
  const scan = totalBatches > 0 ? Math.min(totalBatches, 40) : 40
  const found = []
  const gaps = []
  let sawAny = false
  let trailingMiss = 0
  for (let i = 0; i < scan; i++) {
    const key = `${cacheKey}_batch_${i}`
    const chunk = await readBatchResults(db, key)
    if (chunk) {
      sawAny = true
      trailingMiss = 0
      found.push(key)
    } else {
      gaps.push(key)
      trailingMiss++
      // 无 totalBatches 时：连续空洞过多视为扫完
      if (!totalBatches && sawAny && trailingMiss >= 2) break
      if (!totalBatches && !sawAny && i >= 2) break
    }
  }
  return { batchKeys: found, scanned: true, gaps }
}

/**
 * 检查 upcoming 主缓存对客户端是否可读
 */
async function inspectUpcomingCacheHealth(db) {
  const loaded = await loadUpcomingDoc(db)
  if (!loaded) {
    return { ok: false, reason: 'upcoming_cache_miss', repairable: 'syncLaunches' }
  }
  const payload = loaded.payload
  const results = Array.isArray(payload.results) ? payload.results : []
  const count = Number(payload.count) || 0
  const hollow =
    !!(payload.isBatched || payload.isBatch) ||
    (results.length === 0 && count > 0)

  if (!hollow) {
    if (!results.length) {
      return {
        ok: false,
        reason: 'upcoming_empty',
        cacheKey: loaded.cacheKey,
        repairable: 'syncLaunches'
      }
    }
    return {
      ok: true,
      reason: 'inline_ok',
      cacheKey: loaded.cacheKey,
      count: results.length,
      batched: false
    }
  }

  const resolved = await resolveBatchKeysForHealth(db, loaded.cacheKey, payload)
  const batchKeys = resolved.batchKeys
  const declaredBatchKeys =
    Array.isArray(payload.batchKeys) && payload.batchKeys.length ? payload.batchKeys.slice() : null

  // 扫描路径：中间空洞或声明批次数对不上 → 一律 sync，禁止用残缺子集做 count_repair
  if (resolved.scanned) {
    const declared = Number(payload.totalBatches) || 0
    const maxFoundIdx = batchKeys.reduce((max, key) => {
      const m = String(key || '').match(/_batch_(\d+)(?:_|$)/)
      if (!m) return max
      return Math.max(max, Number(m[1]))
    }, -1)
    const interiorGap = (resolved.gaps || []).some((key) => {
      const m = String(key || '').match(/_batch_(\d+)(?:_|$)/)
      return !!(m && Number(m[1]) < maxFoundIdx)
    })
    if (interiorGap || (declared > 0 && batchKeys.length < declared)) {
      return {
        ok: false,
        reason: 'batch_gap',
        cacheKey: loaded.cacheKey,
        batchKeys,
        expectedCount: count,
        mergedCount: 0,
        repairable: 'syncLaunches'
      }
    }
  }

  // 主文档声明了 batchKeys：以声明为准做缺片检测
  if (declaredBatchKeys) {
    const verifiedDeclared = await verifyBatchedCache(db, loaded.cacheKey, count, declaredBatchKeys)
    if (verifiedDeclared.hasGap) {
      return {
        ok: false,
        reason: 'batch_missing',
        cacheKey: loaded.cacheKey,
        batchKeys: declaredBatchKeys,
        missingKey: verifiedDeclared.missingKey,
        expectedCount: count,
        mergedCount: verifiedDeclared.mergedCount,
        repairable: 'syncLaunches'
      }
    }
  }

  const keysForVerify = declaredBatchKeys || batchKeys
  const expected = count > 0 ? count : 0
  const verified = await verifyBatchedCache(db, loaded.cacheKey, expected, keysForVerify)
  if (verified.ok) {
    return {
      ok: true,
      reason: 'batched_ok',
      cacheKey: loaded.cacheKey,
      count: verified.mergedCount,
      batched: true,
      totalBatches: keysForVerify.length
    }
  }

  if (verified.reason === 'upcoming_empty') {
    return {
      ok: false,
      reason: 'upcoming_empty',
      cacheKey: loaded.cacheKey,
      batchKeys: keysForVerify,
      repairable: 'syncLaunches'
    }
  }

  // 仅当主文档带完整 batchKeys、全部分片都在、只是 count 漂移时才 count_repair
  // （扫描补齐的 keys 不可信：可能漏掉 generation 分片或中间空洞）
  if (
    declaredBatchKeys &&
    verified.reason === 'count_mismatch' &&
    !verified.hasGap &&
    verified.mergedCount > 0
  ) {
    return {
      ok: false,
      reason: 'count_mismatch',
      cacheKey: loaded.cacheKey,
      expectedCount: verified.expectedCount,
      mergedCount: verified.mergedCount,
      batchKeys: declaredBatchKeys,
      repairable: 'count_repair'
    }
  }

  return {
    ok: false,
    reason: verified.reason || 'batch_broken',
    cacheKey: loaded.cacheKey,
    expectedCount: verified.expectedCount,
    mergedCount: verified.mergedCount,
    missingKey: verified.missingKey,
    batchKeys: keysForVerify,
    repairable: 'syncLaunches'
  }
}

/** 仅修正主文档 count / batchKeys，不打 LL2（调用方须保证无缺片） */
async function repairUpcomingMainCount(db, health) {
  if (!health || !health.cacheKey || !Array.isArray(health.batchKeys) || !health.batchKeys.length) {
    return { repaired: false, reason: 'bad_health' }
  }
  if (health.repairable && health.repairable !== 'count_repair') {
    return { repaired: false, reason: 'not_count_repairable' }
  }
  const mergedCount = Number(health.mergedCount) || 0
  if (mergedCount <= 0) return { repaired: false, reason: 'empty_merge' }

  // 再验一次：有缺片绝对不修 count
  const recheck = await verifyBatchedCache(db, health.cacheKey, mergedCount, health.batchKeys)
  if (!recheck.ok && recheck.reason !== 'count_mismatch') {
    return { repaired: false, reason: recheck.reason || 'recheck_failed' }
  }
  if (recheck.hasGap) return { repaired: false, reason: 'batch_gap' }

  const col = db.collection(SPACE_DEVS_CACHE)
  const doc = await col.doc(health.cacheKey).get().catch(() => null)
  const unwrapped = unwrapDocPayload(doc)
  if (!unwrapped) return { repaired: false, reason: 'main_missing' }

  const now = Date.now()
  const nextPayload = {
    ...unwrapped.payload,
    count: mergedCount,
    results: [],
    isBatched: true,
    totalBatches: health.batchKeys.length,
    batchKeys: health.batchKeys
  }
  const nextWrapper = {
    ...unwrapped.wrapper,
    data: nextPayload,
    updatedAt: now,
    timestamp: unwrapped.wrapper.timestamp || now
  }
  await col.doc(health.cacheKey).set({ data: nextWrapper })

  for (let i = 0; i < health.batchKeys.length; i++) {
    const bKey = health.batchKeys[i]
    try {
      const bDoc = await col.doc(bKey).get()
      const bUnwrapped = unwrapDocPayload(bDoc)
      if (!bUnwrapped) continue
      const bPayload = {
        ...bUnwrapped.payload,
        count: mergedCount
      }
      await col.doc(bKey).set({
        data: {
          ...bUnwrapped.wrapper,
          data: bPayload,
          updatedAt: now
        }
      })
    } catch (e) {}
  }

  return {
    repaired: true,
    cacheKey: health.cacheKey,
    count: mergedCount,
    totalBatches: health.batchKeys.length
  }
}

/**
 * 小时探针入口：先自愈 count；缺片则跑 syncLaunches（仅发射列表）
 */
async function healUpcomingCacheIfNeeded(db, options) {
  const syncLaunches =
    options && typeof options.syncLaunches === 'function' ? options.syncLaunches : null
  const health = await inspectUpcomingCacheHealth(db)
  if (health.ok) {
    return { needed: false, health, healthy: true }
  }

  if (health.repairable === 'count_repair') {
    const repaired = await repairUpcomingMainCount(db, health)
    if (repaired.repaired) {
      const again = await inspectUpcomingCacheHealth(db)
      return {
        needed: true,
        method: 'count_repair',
        repaired,
        healthBefore: health,
        healthAfter: again,
        healthy: !!(again && again.ok)
      }
    }
  }

  if (syncLaunches) {
    try {
      const syncRes = await syncLaunches()
      const again = await inspectUpcomingCacheHealth(db)
      return {
        needed: true,
        method: 'syncLaunches',
        syncRes,
        healthBefore: health,
        healthAfter: again,
        healthy: !!(again && again.ok)
      }
    } catch (e) {
      return {
        needed: true,
        method: 'syncLaunches_failed',
        error: e.message || String(e),
        healthBefore: health,
        healthy: false
      }
    }
  }

  return { needed: true, method: 'none', health, healthy: false }
}

/** 生成一代分片 key，避免原地覆盖造成新旧拼接窗口 */
function makeGenerationBatchKey(cacheKey, batchIndex, writeId) {
  return `${cacheKey}_batch_${batchIndex}_${writeId}`
}

module.exports = {
  SPACE_DEVS_CACHE,
  UPCOMING_PARAMS,
  upcomingCacheKey,
  isSlimLaunchListKey,
  stripUpdatesFromListPayload,
  verifyBatchedCache,
  inspectUpcomingCacheHealth,
  repairUpcomingMainCount,
  healUpcomingCacheIfNeeded,
  removeOrphanBatchDocs,
  readExistingBatchKeys,
  makeGenerationBatchKey
}
