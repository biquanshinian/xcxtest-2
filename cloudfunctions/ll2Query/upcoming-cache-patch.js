/**
 * resolve / 到点轮询命中 LL2 后，把最新 NET/window/status 就地 patch 进
 * space_devs_cache 的 upcoming 列表缓存（与 syncSpaceDevsData/launch-net-hourly.js
 * 的 patchResultsInPlace 同一套字段与终态保护规则，缓存键必须保持一致）。
 *
 * 动机：小时探针每小时 :30 才跑一次，改期落在空窗内时全体用户要等最多
 * 一小时才能看到新时间。resolve 拿到的是同样权威的 LL2 直接读数，顺手修
 * 缓存可把全局空窗缩到「第一个活跃用户触发 resolve」的时刻。
 *
 * 并发：resolve 是用户触发的多写者（小时探针是定时器单写者）。流程为
 * 先无锁预检（缓存无该 id 或字段一致 → 0 写退出），有变化才抢 30s TTL
 * 事务锁，锁内重读缓存再 patch，避免用预检快照覆盖别人刚写的数据。
 * 抢不到锁直接跳过——改期是低频事件，小时探针每小时会兜底修正。
 *
 * 只更新缓存中已存在的任务，不插入。
 * 终态（Success 等）会从 upcoming 剔除——hide_recent 后 LL2 upcoming 不再返回该 id，
 * 若只改 status 不剔除，客户端会长期看到旧 Go「就绪」。
 */

const SPACE_DEVS_CACHE = 'space_devs_cache'
const LOCK_COL = 'launch_timeline_cache'
const LOCK_DOC = '_upcoming_patch_lock'
const LOCK_TTL_MS = 30 * 1000

/** 与 syncLaunches / launch-net-hourly / 前端 getCacheKey 一致的 upcoming slim key 参数 */
const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const UPCOMING_PATH = '/launches/upcoming/'
const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

/** 与 ll2Query.fetchLaunchStatuses / CORE_LAUNCH_LIST 对齐的保底 TTL（毫秒） */
const CORE_LIST_TTL_MS = 48 * 60 * 60 * 1000

/** LL2 终态：Success / Failure / Partial Failure / Payload Deployed */
const TERMINAL_STATUS_IDS = { 3: true, 4: true, 7: true, 9: true }

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
  return `api_cache_${UPCOMING_PATH}_${sortedParamsString(UPCOMING_PARAMS)}${suffix}`
}

function isTerminalStatus(status) {
  const id = status && status.id != null ? Number(status.id) : 0
  return !!TERMINAL_STATUS_IDS[id]
}

function statusEqual(a, b) {
  const aid = a && a.id != null ? Number(a.id) : null
  const bid = b && b.id != null ? Number(b.id) : null
  if (aid != null && bid != null && aid === bid) return true
  const aa = String((a && a.abbrev) || '')
  const ba = String((b && b.abbrev) || '')
  if (aa && ba && aa === ba) return true
  const an = String((a && a.name) || '')
  const bn = String((b && b.name) || '')
  return !!(an && bn && an === bn)
}

function netFieldsChanged(cached, live) {
  if (!cached || !live) return true
  if (String(cached.net || '') !== String(live.net || '')) return true
  if (String(cached.window_start || '') !== String(live.window_start || '')) return true
  if (String(cached.window_end || '') !== String(live.window_end || '')) return true
  if (!statusEqual(cached.status, live.status)) return true
  return false
}

function slimStatusFromLive(live) {
  if (!live || !live.status) return null
  return {
    id: live.status.id,
    name: live.status.name || '',
    abbrev: live.status.abbrev || ''
  }
}

function applyNetPatch(target, live) {
  target.net = live.net || target.net || ''
  target.window_start = live.window_start || target.window_start || ''
  target.window_end = live.window_end || target.window_end || ''
  const st = slimStatusFromLive(live)
  if (!st) return
  // 终态不可被 Go/飞行中等非终态覆盖（LL2 短暂回退或探针乱序时防污染）
  if (isTerminalStatus(target.status) && !isTerminalStatus(st)) return
  target.status = st
}

function rowPatchSnapshot(row) {
  return JSON.stringify({
    net: (row && row.net) || '',
    ws: (row && row.window_start) || '',
    we: (row && row.window_end) || '',
    sid: row && row.status && row.status.id != null ? Number(row.status.id) : 0,
    sab: (row && row.status && row.status.abbrev) || ''
  })
}

/**
 * applyNetPatch 后行是否真的会变。与裸 netFieldsChanged 的差异：
 * 缓存已是终态而 live 是 Go 且时间一致时，终态保护让 patch 成为 no-op，
 * 此时必须判为「无变化」——本模块被到点轮询高频触发（最快每 2 分钟一次
 * LL2 命中），按「检测到差异」判定会对同一内容反复抢锁写库。
 */
function wouldChangeRow(row, live) {
  if (!row || !live) return false
  if (!netFieldsChanged(row, live)) return false
  const clone = {
    net: row.net,
    window_start: row.window_start,
    window_end: row.window_end,
    status: row.status
  }
  const before = rowPatchSnapshot(clone)
  applyNetPatch(clone, live)
  return rowPatchSnapshot(clone) !== before
}

/**
 * 只更新缓存中已存在的任务，不插入新任务。
 * 若 live 或 patch 后已是终态：从 upcoming 剔除（hide_recent 后探针看不到该 id，
 * 若不剔除，云缓存会长期残留旧 Go，首页「即将发射」一直显示就绪）。
 * 返回变更明细。
 */
function patchResultsInPlace(results, liveById) {
  const changes = []
  if (!Array.isArray(results) || !liveById) return changes
  for (let i = 0; i < results.length; i++) {
    const row = results[i]
    if (!row || row.id == null) continue
    const id = String(row.id)
    const live = liveById.get(id)
    if (!live) continue
    if (!wouldChangeRow(row, live)) continue
    const before = {
      net: row.net || '',
      statusAbbrev: (row.status && row.status.abbrev) || ''
    }
    applyNetPatch(row, live)
    changes.push({
      id,
      name: String(row.name || live.name || ''),
      netBefore: before.net,
      netAfter: row.net || '',
      statusBefore: before.statusAbbrev,
      statusAfter: (row.status && row.status.abbrev) || ''
    })
  }
  return changes
}

/**
 * 从 upcoming 结果剔除终态行。
 * @param {Array} results
 * @param {Map} [liveById]
 * @param {Set} [extraTerminalIds] launch_status 等旁路终态 id
 */
function pruneTerminalUpcomingResults(results, liveById, extraTerminalIds) {
  const kept = []
  const pruned = []
  const rows = Array.isArray(results) ? results : []
  const extra = extraTerminalIds instanceof Set ? extraTerminalIds : null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.id == null) {
      kept.push(row)
      continue
    }
    const id = String(row.id)
    const live = liveById && liveById.get(id)
    if (live && isTerminalStatus(live.status)) {
      pruned.push({ id, reason: 'live_terminal' })
    } else if (isTerminalStatus(row.status)) {
      pruned.push({ id, reason: 'cache_terminal' })
    } else if (extra && extra.has(id)) {
      pruned.push({ id, reason: 'status_store_terminal' })
    } else {
      kept.push(row)
    }
  }
  return { results: kept, pruned }
}

function wouldPruneTerminalRow(row, liveById, extraTerminalIds) {
  if (!row || row.id == null) return false
  const id = String(row.id)
  const live = liveById && liveById.get(id)
  if (live && isTerminalStatus(live.status)) return true
  if (isTerminalStatus(row.status)) return true
  if (extraTerminalIds instanceof Set && extraTerminalIds.has(id)) return true
  return false
}

/** patch 后按 net 升序重排（缺失/非法 net 的行沉底），改期任务不滞留数组前部 */
function sortResultsByNetAsc(results) {
  if (!Array.isArray(results)) return results
  return results.sort((a, b) => {
    const ta = a && (a.net || a.window_start) ? new Date(a.net || a.window_start).getTime() : NaN
    const tb = b && (b.net || b.window_start) ? new Date(b.net || b.window_start).getTime() : NaN
    const va = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER
    const vb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER
    return va - vb
  })
}

/** 读出的文档再 set 回去时必须去掉 _id，否则 TCB 报「不能更新_id的值」 */
function stripDocMeta(wrapper) {
  if (!wrapper || typeof wrapper !== 'object') return {}
  const next = { ...wrapper }
  delete next._id
  delete next._openid
  return next
}

function createUpcomingCachePatcher(db) {
  const col = () => db.collection(SPACE_DEVS_CACHE)

  async function writeCacheWrapper(docId, wrapper) {
    const now = Date.now()
    const next = {
      ...stripDocMeta(wrapper),
      timestamp: now,
      updatedAt: now,
      expireAt: now + CORE_LIST_TTL_MS
    }
    await col().doc(docId).set({ data: next })
  }

  async function loadUpcomingCacheDoc() {
    for (const sfx of CANDIDATE_SUFFIXES) {
      const key = upcomingCacheKey(sfx)
      const doc = await col()
        .doc(key)
        .get()
        .catch(() => null)
      if (doc && doc.data && doc.data.data) {
        return { cacheKey: key, wrapper: doc.data, payload: doc.data.data }
      }
    }
    return null
  }

  async function loadAllUpcomingResults(cacheKey, payload) {
    const isBatched =
      !!(payload.isBatched || payload.isBatch) ||
      (Array.isArray(payload.results) && payload.results.length === 0 && Number(payload.count) > 0)

    if (!isBatched) {
      return {
        batched: false,
        results: Array.isArray(payload.results) ? payload.results.slice() : [],
        batches: null
      }
    }

    const batches = []
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await col()
        .doc(batchKey)
        .get()
        .catch(() => null)
      const batchWrapper = batchDoc && batchDoc.data
      const batchPayload = batchWrapper && batchWrapper.data
      if (!batchPayload || !Array.isArray(batchPayload.results)) break
      batches.push({
        batchKey,
        wrapper: batchWrapper,
        payload: batchPayload,
        results: batchPayload.results.slice()
      })
      batchIdx++
    }
    const results = batches.reduce((all, b) => all.concat(b.results), [])
    return { batched: true, results, batches }
  }

  /** 30s TTL 事务锁；拿不到返回 false（调用方直接跳过，等小时探针兜底） */
  async function acquireLock() {
    if (typeof db.runTransaction !== 'function') return true
    try {
      return await db.runTransaction(async (transaction) => {
        const ref = transaction.collection(LOCK_COL).doc(LOCK_DOC)
        let lockedAtMs = 0
        try {
          const result = await ref.get()
          lockedAtMs = Number(result && result.data && result.data.lockedAtMs) || 0
        } catch (e) {}
        if (Date.now() - lockedAtMs < LOCK_TTL_MS) return false
        await ref.set({ data: { lockedAtMs: Date.now() } })
        return true
      })
    } catch (e) {
      return false
    }
  }

  async function releaseLock() {
    try {
      await db.collection(LOCK_COL).doc(LOCK_DOC).set({ data: { lockedAtMs: 0 } })
    } catch (e) {}
  }

  /**
   * @param {Array<object>} liveRows LL2 list 模式原始行（{ id, name, net, window_start, window_end, status }）
   * @returns {Promise<{ patched: number, docsWritten: number, skipped?: string, changes?: Array }>}
   */
  async function patchUpcomingCacheWithLiveRows(liveRows) {
    const rows = (Array.isArray(liveRows) ? liveRows : []).filter(
      (r) => r && r.id != null && (r.net || r.window_start || r.status)
    )
    if (!rows.length) return { patched: 0, docsWritten: 0, skipped: 'empty' }
    const liveById = new Map()
    for (const r of rows) liveById.set(String(r.id), r)

    // 无锁预检：无变化直接退出（绝大多数调用走这条零写路径）
    const preCached = await loadUpcomingCacheDoc()
    if (!preCached) return { patched: 0, docsWritten: 0, skipped: 'cache_miss' }
    const preLoaded = await loadAllUpcomingResults(preCached.cacheKey, preCached.payload)
    if (!preLoaded.results.length) return { patched: 0, docsWritten: 0, skipped: 'cache_empty' }
    const anyChange = preLoaded.results.some((row) => {
      if (!row || row.id == null) return false
      const id = String(row.id)
      if (wouldPruneTerminalRow(row, liveById)) return true
      return liveById.has(id) && wouldChangeRow(row, liveById.get(id))
    })
    if (!anyChange) return { patched: 0, docsWritten: 0, skipped: 'no_change' }

    const locked = await acquireLock()
    if (!locked) return { patched: 0, docsWritten: 0, skipped: 'lock_busy' }

    try {
      // 锁内重读：预检快照可能已被其他写者更新
      const cached = await loadUpcomingCacheDoc()
      if (!cached) return { patched: 0, docsWritten: 0, skipped: 'cache_miss' }
      const loaded = await loadAllUpcomingResults(cached.cacheKey, cached.payload)
      if (!loaded.results.length) return { patched: 0, docsWritten: 0, skipped: 'cache_empty' }

      let docsWritten = 0
      if (loaded.batched && loaded.batches) {
        let changes = []
        let pruned = []
        for (const batch of loaded.batches) {
          changes = changes.concat(patchResultsInPlace(batch.results, liveById))
        }
        let mergedResults = loaded.batches.reduce((all, b) => all.concat(b.results), [])
        const pruneRes = pruneTerminalUpcomingResults(mergedResults, liveById)
        pruned = pruneRes.pruned
        mergedResults = pruneRes.results
        if (!changes.length && !pruned.length) return { patched: 0, docsWritten: 0, skipped: 'no_change' }
        // 改期可能跨批移动：跨批整体按 net 升序重排，再按原批大小切块写回
        sortResultsByNetAsc(mergedResults)
        const batchSizes = loaded.batches.map((b) => b.results.length)
        let cursor = 0
        for (let b = 0; b < loaded.batches.length; b++) {
          const batch = loaded.batches[b]
          const isLast = b === loaded.batches.length - 1
          const slice = isLast ? mergedResults.slice(cursor) : mergedResults.slice(cursor, cursor + batchSizes[b])
          cursor += slice.length
          batch.results = slice
          batch.payload.results = batch.results
          await writeCacheWrapper(batch.batchKey, { ...batch.wrapper, data: batch.payload })
          docsWritten++
        }
        await writeCacheWrapper(cached.cacheKey, cached.wrapper)
        docsWritten++
        return {
          patched: changes.length,
          pruned: pruned.length,
          prunedIds: pruned.map((p) => p.id),
          docsWritten,
          changes,
          cacheKey: cached.cacheKey
        }
      }

      const changes = patchResultsInPlace(loaded.results, liveById)
      const pruneRes = pruneTerminalUpcomingResults(loaded.results, liveById)
      loaded.results = pruneRes.results
      if (!changes.length && !pruneRes.pruned.length) {
        return { patched: 0, docsWritten: 0, skipped: 'no_change' }
      }
      sortResultsByNetAsc(loaded.results)
      await writeCacheWrapper(cached.cacheKey, {
        ...cached.wrapper,
        data: { ...cached.payload, results: loaded.results }
      })
      docsWritten++
      return {
        patched: changes.length,
        pruned: pruneRes.pruned.length,
        prunedIds: pruneRes.pruned.map((p) => p.id),
        docsWritten,
        changes,
        cacheKey: cached.cacheKey
      }
    } finally {
      await releaseLock()
    }
  }

  return { patchUpcomingCacheWithLiveRows }
}

module.exports = {
  createUpcomingCachePatcher,
  netFieldsChanged,
  applyNetPatch,
  patchResultsInPlace,
  pruneTerminalUpcomingResults,
  wouldPruneTerminalRow,
  sortResultsByNetAsc,
  upcomingCacheKey,
  UPCOMING_PARAMS,
  CANDIDATE_SUFFIXES
}
