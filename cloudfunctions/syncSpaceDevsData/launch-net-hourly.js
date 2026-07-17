/**
 * 小时级 NET 时间基准探针（独立于 6h detailed 全量同步）
 *
 * 设计约束（匿名档 LL2 ≈ 15 次/小时/出口 IP）：
 *   - 固定只打 1 次：GET /launches/upcoming/?mode=list&limit=30&ordering=net
 *   - 不翻页、不拉 detailed、不碰 previous/events/stations（previous 仅就地 patch status，不另打 LL2）
 *   - 与 6h 全量错开：触发器跑在每小时 :30；UTC 整点落在每 6 小时整点窗默认跳过
 *     （全量在 :00 已可能打光当小时额度，:30 再打易 429）
 *     例外：upcoming 缓存显示近窗发射（未来 48h / 过去 2h）时仍跑探针，保证 NET/scrub 及时
 *   - 有变化才 patch 已有 slim_v5 缓存的 net/window/status，并刷新 timestamp
 *     让客户端 2 分钟后台云库比对能吃到新时间；无变化则零写库
 *   - 探针结果里若出现终态(3/4/7/9)：写入 recent_settled + 就地修正 previous 缓存 status
 *     （0 额外 LL2，避免历史列表长期卡在「待发射」）
 *   - live status 缓存按 id merge 写入，避免被到点 5 条查询覆盖掉探针 30 条
 *
 * 不替代 syncLaunches：新任务入库、图片/助推器等仍靠 6h detailed。
 */
const { db, LAUNCH_LIBRARY_API, fetchAPI, cloud } = require('./shared.js')
const { enrichLaunchNetRecovery } = require('./ll2-net-recovery-enrich.js')

const SPACE_DEVS_CACHE = 'space_devs_cache'
const LAUNCH_DATA_COLLECTION = 'launch_data'
const LIVE_STATUS_CACHE_COL = 'launch_timeline_cache'
const LIVE_STATUS_CACHE_DOC = '_live_status_cache'
const RECENT_SETTLED_DOC = '_recent_settled'

/** 与 syncLaunches / launch-data-sync / 前端 getCacheKey 一致的 upcoming slim key 参数 */
const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const UPCOMING_PATH = '/launches/upcoming/'
/** 与 syncLaunches previous 主缓存一致 */
const PREVIOUS_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}
const PREVIOUS_PATH = '/launches/previous/'
const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

/** 探针拉取条数：覆盖首页倒计时 + 近期改期任务，仍只算 1 次 API */
const PROBE_LIMIT = 30

/** 与 ll2Query.fetchLaunchStatuses / CORE_LAUNCH_LIST 对齐的保底 TTL（毫秒） */
const CORE_LIST_TTL_MS = 48 * 60 * 60 * 1000

/** LL2 终态：Success / Failure / Partial Failure / Payload Deployed */
const TERMINAL_STATUS_IDS = { 3: true, 4: true, 7: true, 9: true }

/** recent_settled 最多保留条数 */
const RECENT_SETTLED_MAX = 40

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

function previousCacheKey(suffix) {
  return `api_cache_${PREVIOUS_PATH}_${sortedParamsString(PREVIOUS_PARAMS)}${suffix}`
}

function isTerminalStatus(status) {
  const id = status && status.id != null ? Number(status.id) : 0
  return !!TERMINAL_STATUS_IDS[id]
}

/**
 * 全量 syncSpaceDevsDataTimer 在 UTC 0/6/12/18:00 触发。
 * 同一小时内额度可能已被打光，小时探针默认跳过。
 * 例外：云库 upcoming 缓存显示「未来 48h 内有发射 / 过去 2h 内刚过 NET」时仍跑探针，
 * 保证发射窗口内 NET/scrub 不被整点空窗拖到近 1 小时。
 */
const LAUNCH_WINDOW_AHEAD_MS = 48 * 60 * 60 * 1000
const LAUNCH_WINDOW_BEHIND_MS = 2 * 60 * 60 * 1000

function shouldSkipDueToFullSyncHour(nowMs) {
  const h = new Date(nowMs || Date.now()).getUTCHours()
  return h % 6 === 0
}

/** 从 upcoming 缓存结果判断是否处于发射时间敏感窗口（0 LL2） */
function isInLaunchTimeWindow(cachedResults, nowMs) {
  const now = nowMs || Date.now()
  if (!Array.isArray(cachedResults) || !cachedResults.length) return false
  for (let i = 0; i < Math.min(cachedResults.length, 10); i++) {
    const row = cachedResults[i]
    const netMs = row && row.net ? new Date(row.net).getTime() : 0
    if (!netMs || isNaN(netMs)) continue
    if (netMs >= now - LAUNCH_WINDOW_BEHIND_MS && netMs <= now + LAUNCH_WINDOW_AHEAD_MS) return true
  }
  return false
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
  if (st) target.status = st
}

/**
 * 读取 upcoming 主缓存文档（优先 slim_v5），返回 { cacheKey, wrapper, payload }
 * wrapper = 云文档 data 字段（含 timestamp/expireAt/data）
 * payload = API 列表体（results / isBatched …）
 */
async function loadUpcomingCacheDoc() {
  const col = db.collection(SPACE_DEVS_CACHE)
  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = upcomingCacheKey(sfx)
    const doc = await col.doc(key).get().catch(() => null)
    if (doc && doc.data && doc.data.data) {
      return { cacheKey: key, wrapper: doc.data, payload: doc.data.data }
    }
  }
  return null
}

async function loadAllUpcomingResults(cacheKey, payload) {
  const isBatched = !!(payload.isBatched || payload.isBatch) ||
    (Array.isArray(payload.results) && payload.results.length === 0 && Number(payload.count) > 0)

  if (!isBatched) {
    return {
      batched: false,
      results: Array.isArray(payload.results) ? payload.results.slice() : [],
      batches: null
    }
  }

  const col = db.collection(SPACE_DEVS_CACHE)
  const batches = []
  let batchIdx = 0
  while (batchIdx < 40) {
    const batchKey = `${cacheKey}_batch_${batchIdx}`
    const batchDoc = await col.doc(batchKey).get().catch(() => null)
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

/**
 * 按 id 把 live 行 patch 进 results；返回变更明细。
 * 只更新已存在于缓存中的任务，不插入新任务（新任务等 6h detailed）。
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
    if (!netFieldsChanged(row, live)) continue
    const before = {
      net: row.net || '',
      window_start: row.window_start || '',
      window_end: row.window_end || '',
      statusAbbrev: (row.status && row.status.abbrev) || ''
    }
    applyNetPatch(row, live)
    changes.push({
      id,
      name: String(row.name || live.name || ''),
      before,
      after: {
        net: row.net || '',
        window_start: row.window_start || '',
        window_end: row.window_end || '',
        statusAbbrev: (row.status && row.status.abbrev) || ''
      },
      net: row.net || '',
      window_start: row.window_start || '',
      statusName: (row.status && row.status.name) || ''
    })
  }
  return changes
}

/**
 * patch 后按 net 升序重排（缺失/非法 net 的行沉底）。
 * 探针只就地改时间不重排会让大幅改期的任务停留在数组前部，
 * 客户端按缓存顺序渲染时首屏出现上千天倒计时的卡片。
 */
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

async function writeCacheWrapper(docId, wrapper) {
  const now = Date.now()
  const next = {
    ...stripDocMeta(wrapper),
    timestamp: now,
    updatedAt: now,
    expireAt: now + CORE_LIST_TTL_MS
  }
  await db.collection(SPACE_DEVS_CACHE).doc(docId).set({ data: next })
}

/**
 * 顺带刷新 ll2Query 的 live status 共享缓存，供到点轮询复用（不额外打 LL2）。
 * 按 id merge：保留既有行，用本轮探针覆盖同 id，避免被后续 5 条 live 查询冲掉后无法恢复。
 */
async function writeLiveStatusCache(liveRows) {
  if (!Array.isArray(liveRows) || !liveRows.length) return
  const fresh = liveRows.map((r) => ({
    id: String(r.id || ''),
    name: typeof r.name === 'string' ? r.name : '',
    status: r.status
      ? { id: r.status.id, name: r.status.name || '', abbrev: r.status.abbrev || '' }
      : null,
    net: r.net || '',
    windowStart: r.window_start || '',
    windowEnd: r.window_end || ''
  })).filter((r) => r.id)

  let existing = []
  try {
    const cacheRes = await db.collection(LIVE_STATUS_CACHE_COL).doc(LIVE_STATUS_CACHE_DOC).get()
    const cached = cacheRes && cacheRes.data
    if (cached && Array.isArray(cached.data)) existing = cached.data
  } catch (e) {}

  const byId = new Map()
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i]
    if (row && row.id) byId.set(String(row.id), row)
  }
  for (let i = 0; i < fresh.length; i++) {
    byId.set(fresh[i].id, fresh[i])
  }
  // 探针序优先（按 NET），其余按原顺序追加
  const rows = []
  const seen = new Set()
  for (let i = 0; i < fresh.length; i++) {
    rows.push(fresh[i])
    seen.add(fresh[i].id)
  }
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i]
    if (!row || !row.id || seen.has(String(row.id))) continue
    rows.push(row)
    seen.add(String(row.id))
  }
  const capped = rows.slice(0, 40)

  try {
    await db.collection(LIVE_STATUS_CACHE_COL).doc(LIVE_STATUS_CACHE_DOC).set({
      data: { data: capped, updatedAtMs: Date.now() }
    })
  } catch (e) {
    console.warn('[launch-net-hourly] live status cache write fail:', e.message || e)
  }
}

/**
 * 终态任务 → 失效并重算 getLaunchStats mission 缓存（含本次，对齐详情徽章）
 */
async function invalidateMissionStatsForTerminals(terminalEntries, cachedResults) {
  if (!Array.isArray(terminalEntries) || !terminalEntries.length) {
    return { skipped: true, reason: 'empty' }
  }
  const byId = new Map()
  if (Array.isArray(cachedResults)) {
    for (let i = 0; i < cachedResults.length; i++) {
      const r = cachedResults[i]
      if (r && r.id != null) byId.set(String(r.id), r)
    }
  }
  const missions = terminalEntries.map((e) => {
    const cached = byId.get(String(e.id))
    const cfg = cached && cached.rocket && cached.rocket.configuration
    const lsp = cached && cached.launch_service_provider
    return {
      id: String(e.id),
      launchTime: e.net || e.windowStart || (cached && (cached.net || cached.window_start)) || '',
      rocketName: (cfg && (cfg.name || cfg.full_name)) || '',
      launchAgencyId: lsp && lsp.id != null ? lsp.id : null,
      launchAgency: (lsp && (lsp.name || lsp.abbrev)) || ''
    }
  })
  const res = await cloud.callFunction({
    name: 'getLaunchStats',
    data: {
      action: 'invalidateMissionStats',
      recompute: true,
      missions
    }
  })
  return (res && res.result) || { success: false, error: 'empty' }
}

/**
 * 从探针结果提取终态行（Success/Failure/Partial），供 recent_settled / previous patch。
 * hide_recent_previous 未开时，刚成功的任务仍可能短暂出现在 upcoming list 探针里。
 */
function collectTerminalFromLive(liveRows) {
  const out = []
  if (!Array.isArray(liveRows)) return out
  const now = Date.now()
  for (let i = 0; i < liveRows.length; i++) {
    const r = liveRows[i]
    if (!r || r.id == null || !isTerminalStatus(r.status)) continue
    out.push({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : '',
      status: {
        id: r.status.id,
        name: r.status.name || '',
        abbrev: r.status.abbrev || ''
      },
      net: r.net || '',
      windowStart: r.window_start || '',
      windowEnd: r.window_end || '',
      settledAtMs: now,
      source: 'launch_net_hourly'
    })
  }
  return out
}

/**
 * 缓存 upcoming 里已是终态、但本轮探针未带回的行（任务已离开 upcoming 前 30）。
 * 用缓存上的 status（可能刚被本轮 patch）写入 recent_settled，仍 0 额外 LL2。
 */
function collectTerminalFromCachedUpcoming(cachedResults, liveById, alreadyIds) {
  const out = []
  if (!Array.isArray(cachedResults)) return out
  const now = Date.now()
  const seen = alreadyIds instanceof Set ? alreadyIds : new Set()
  for (let i = 0; i < cachedResults.length; i++) {
    const row = cachedResults[i]
    if (!row || row.id == null || !isTerminalStatus(row.status)) continue
    const id = String(row.id)
    if (seen.has(id)) continue
    // 仍在 live 探针里且非终态 → 以 live 为准，不在这里重复
    const live = liveById && liveById.get(id)
    if (live && !isTerminalStatus(live.status)) continue
    out.push({
      id,
      name: typeof row.name === 'string' ? row.name : '',
      status: {
        id: row.status.id,
        name: row.status.name || '',
        abbrev: row.status.abbrev || ''
      },
      net: row.net || '',
      windowStart: row.window_start || '',
      windowEnd: row.window_end || '',
      settledAtMs: now,
      source: 'launch_net_hourly_cache'
    })
  }
  return out
}

/**
 * 合并写入 recent_settled（按 id 去重，新的在前，最多 RECENT_SETTLED_MAX 条）。
 * 前端历史列表加载后可读此文档修正「待发射」角标。
 */
async function mergeRecentSettled(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return { written: false, count: 0 }
  }
  let existing = []
  try {
    const doc = await db.collection(LIVE_STATUS_CACHE_COL).doc(RECENT_SETTLED_DOC).get()
    if (doc && doc.data && Array.isArray(doc.data.data)) existing = doc.data.data
  } catch (e) {}

  const byId = new Map()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e && e.id) byId.set(String(e.id), e)
  }
  for (let i = 0; i < existing.length; i++) {
    const e = existing[i]
    if (!e || !e.id) continue
    const id = String(e.id)
    if (!byId.has(id)) byId.set(id, e)
  }
  const merged = Array.from(byId.values())
    .sort((a, b) => (Number(b.settledAtMs) || 0) - (Number(a.settledAtMs) || 0))
    .slice(0, RECENT_SETTLED_MAX)

  try {
    await db.collection(LIVE_STATUS_CACHE_COL).doc(RECENT_SETTLED_DOC).set({
      data: { data: merged, updatedAtMs: Date.now() }
    })
    return { written: true, count: merged.length, added: entries.length }
  } catch (e) {
    console.warn('[launch-net-hourly] recent_settled write fail:', e.message || e)
    return { written: false, count: 0, error: e.message || String(e) }
  }
}

/**
 * 读取 previous 主缓存（优先 slim_v5）。
 */
async function loadPreviousCacheDoc() {
  const col = db.collection(SPACE_DEVS_CACHE)
  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = previousCacheKey(sfx)
    const doc = await col.doc(key).get().catch(() => null)
    if (doc && doc.data && doc.data.data) {
      return { cacheKey: key, wrapper: doc.data, payload: doc.data.data }
    }
  }
  return null
}

async function loadAllPreviousResults(cacheKey, payload) {
  const isBatched = !!(payload.isBatched || payload.isBatch) ||
    (Array.isArray(payload.results) && payload.results.length === 0 && Number(payload.count) > 0)

  if (!isBatched) {
    return {
      batched: false,
      results: Array.isArray(payload.results) ? payload.results.slice() : [],
      batches: null
    }
  }

  const col = db.collection(SPACE_DEVS_CACHE)
  const batches = []
  let batchIdx = 0
  while (batchIdx < 40) {
    const batchKey = `${cacheKey}_batch_${batchIdx}`
    const batchDoc = await col.doc(batchKey).get().catch(() => null)
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

/**
 * 用终态 status 就地修正 previous 缓存中已有条目（不插入新任务，0 额外 LL2）。
 */
function patchPreviousStatusInPlace(results, terminalById) {
  let patched = 0
  if (!Array.isArray(results) || !terminalById || !terminalById.size) return patched
  for (let i = 0; i < results.length; i++) {
    const row = results[i]
    if (!row || row.id == null) continue
    const term = terminalById.get(String(row.id))
    if (!term || !term.status) continue
    const curId = row.status && row.status.id != null ? Number(row.status.id) : 0
    const nextId = Number(term.status.id)
    if (curId === nextId && statusEqual(row.status, term.status)) continue
    row.status = {
      id: term.status.id,
      name: term.status.name || '',
      abbrev: term.status.abbrev || ''
    }
    if (term.net) row.net = term.net
    if (term.windowStart) row.window_start = term.windowStart
    if (term.windowEnd) row.window_end = term.windowEnd
    patched++
  }
  return patched
}

/**
 * 将终态同步进 previous slim 缓存（有则改 status，无则跳过等 6h 全量入库）。
 */
async function syncTerminalIntoPreviousCache(terminalEntries) {
  if (!Array.isArray(terminalEntries) || !terminalEntries.length) {
    return { patched: 0, docsWritten: 0, skipped: 'empty' }
  }
  const terminalById = new Map()
  for (let i = 0; i < terminalEntries.length; i++) {
    const e = terminalEntries[i]
    if (e && e.id) terminalById.set(String(e.id), e)
  }

  const cached = await loadPreviousCacheDoc()
  if (!cached) return { patched: 0, docsWritten: 0, skipped: 'previous_cache_miss' }

  const loaded = await loadAllPreviousResults(cached.cacheKey, cached.payload)
  if (!loaded.results.length) {
    return { patched: 0, docsWritten: 0, skipped: 'previous_cache_empty', cacheKey: cached.cacheKey }
  }

  let patched = 0
  let docsWritten = 0

  if (loaded.batched && loaded.batches) {
    for (let b = 0; b < loaded.batches.length; b++) {
      const batch = loaded.batches[b]
      const n = patchPreviousStatusInPlace(batch.results, terminalById)
      if (!n) continue
      patched += n
      batch.payload.results = batch.results
      await writeCacheWrapper(batch.batchKey, {
        ...batch.wrapper,
        data: batch.payload
      })
      docsWritten++
    }
    if (patched) {
      await writeCacheWrapper(cached.cacheKey, cached.wrapper)
      docsWritten++
    }
  } else {
    patched = patchPreviousStatusInPlace(loaded.results, terminalById)
    if (patched) {
      await writeCacheWrapper(cached.cacheKey, {
        ...cached.wrapper,
        data: { ...cached.payload, results: loaded.results }
      })
      docsWritten++
    }
  }

  return { patched, docsWritten, cacheKey: cached.cacheKey }
}

/** 仅更新已有 launch_data 文档的时间字段，供提醒扫窗；不存在则跳过 */
async function patchLaunchDataNets(changes) {
  let updated = 0
  let skipped = 0
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    const iso = c.net || c.window_start || ''
    if (!c.id || !iso) {
      skipped++
      continue
    }
    const t = new Date(iso).getTime()
    if (!(t > 0)) {
      skipped++
      continue
    }
    try {
      const res = await db.collection(LAUNCH_DATA_COLLECTION).doc(String(c.id)).update({
        data: {
          launchTime: iso,
          windowStart: new Date(iso),
          status: c.statusName || '',
          updatedAt: Date.now(),
          syncedAt: Date.now(),
          source: 'launch_net_hourly'
        }
      })
      const n = res && res.stats && typeof res.stats.updated === 'number' ? res.stats.updated : 0
      if (n > 0) updated++
      else skipped++
    } catch (e) {
      skipped++
    }
  }
  return { updated, skipped }
}

async function fetchUpcomingNetProbe() {
  const qs = [
    'format=json',
    'mode=list',
    'limit=' + encodeURIComponent(String(PROBE_LIMIT)),
    'ordering=' + encodeURIComponent('net')
  ].join('&')
  const url = `${LAUNCH_LIBRARY_API}/launches/upcoming/?${qs}`
  const apiData = await Promise.race([
    fetchAPI(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 NET probe 超时')), 15000))
  ])
  if (!apiData || !Array.isArray(apiData.results)) {
    const detail = apiData && apiData.detail ? String(apiData.detail) : ''
    const err = new Error(detail ? `ll2_throttled: ${detail}` : 'll2_invalid_response')
    if (/throttl|rate.?limit|429/i.test(detail)) err.code = 'LL2_RATE_LIMIT'
    throw err
  }
  return apiData.results
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function runLaunchNetHourly(options) {
  const startTime = Date.now()
  const force = !!(options && options.force)

  if (!force && shouldSkipDueToFullSyncHour(startTime)) {
    // 全量同窗默认跳过；发射窗口内（读云库 upcoming，0 LL2）仍跑探针，避免 NET/scrub 空窗
    let inWindow = false
    try {
      const cached = await loadUpcomingCacheDoc()
      if (cached) {
        const loaded = await loadAllUpcomingResults(cached.cacheKey, cached.payload)
        inWindow = isInLaunchTimeWindow(loaded && loaded.results, startTime)
      }
    } catch (e) {
      inWindow = false
    }
    if (!inWindow) {
      return {
        success: true,
        skipped: true,
        reason: 'full_sync_hour',
        message: 'UTC 0/6/12/18 整点小时与 6h 全量同窗，且无近窗发射，跳过以免抢额度',
        timestamp: Date.now(),
        elapsed: Date.now() - startTime
      }
    }
  }

  let liveRows
  try {
    liveRows = await fetchUpcomingNetProbe()
  } catch (e) {
    return {
      success: false,
      error: e.message || 'probe_failed',
      rateLimited: e.code === 'LL2_RATE_LIMIT' || /throttl|429/i.test(String(e.message || '')),
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  const liveById = new Map()
  for (let i = 0; i < liveRows.length; i++) {
    const r = liveRows[i]
    if (r && r.id != null) liveById.set(String(r.id), r)
  }

  // 探针结果写入 live status 共享缓存（即使下方无 upcoming 缓存可 patch，到点轮询也能受益）
  await writeLiveStatusCache(liveRows)

  // 0 额外 LL2：探针里已是终态的行 → recent_settled + previous status 修正
  let terminalEntries = collectTerminalFromLive(liveRows)
  const terminalIds = new Set(terminalEntries.map((e) => e.id))

  const cached = await loadUpcomingCacheDoc()
  if (!cached) {
    const settledRes = await mergeRecentSettled(terminalEntries)
    let previousPatch = { patched: 0, docsWritten: 0, skipped: 'upcoming_cache_miss' }
    if (terminalEntries.length) {
      try {
        previousPatch = await syncTerminalIntoPreviousCache(terminalEntries)
      } catch (e) {
        previousPatch = { patched: 0, docsWritten: 0, error: e.message || String(e) }
      }
    }
    let missionStatsInvalidate = { skipped: true }
    if (terminalEntries.length) {
      try {
        missionStatsInvalidate = await invalidateMissionStatsForTerminals(terminalEntries, [])
      } catch (e) {
        missionStatsInvalidate = { success: false, error: e.message || String(e) }
      }
    }
    return {
      success: true,
      probed: liveRows.length,
      patched: 0,
      changes: [],
      warning: 'upcoming_cache_miss',
      message: '无 slim upcoming 缓存可 patch，等待下次 6h syncLaunches',
      liveStatusCacheUpdated: true,
      recentSettled: settledRes,
      previousStatusPatch: previousPatch,
      missionStatsInvalidate,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  const loaded = await loadAllUpcomingResults(cached.cacheKey, cached.payload)
  if (!loaded.results.length) {
    const settledRes = await mergeRecentSettled(terminalEntries)
    let previousPatch = { patched: 0, docsWritten: 0, skipped: 'upcoming_cache_empty' }
    if (terminalEntries.length) {
      try {
        previousPatch = await syncTerminalIntoPreviousCache(terminalEntries)
      } catch (e) {
        previousPatch = { patched: 0, docsWritten: 0, error: e.message || String(e) }
      }
    }
    let missionStatsInvalidate = { skipped: true }
    if (terminalEntries.length) {
      try {
        missionStatsInvalidate = await invalidateMissionStatsForTerminals(terminalEntries, [])
      } catch (e) {
        missionStatsInvalidate = { success: false, error: e.message || String(e) }
      }
    }
    return {
      success: true,
      probed: liveRows.length,
      patched: 0,
      changes: [],
      cacheKey: cached.cacheKey,
      warning: 'upcoming_cache_empty',
      liveStatusCacheUpdated: true,
      recentSettled: settledRes,
      previousStatusPatch: previousPatch,
      missionStatsInvalidate,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  let changes = []
  let docsWritten = 0
  let netRecoveryPatched = 0

  // 网系回收：列表缓存里 Ocean/ASDS → NET（0 额外 LL2，小时探针顺带修图标）
  const enrichResultsNetRecovery = (results) => {
    let n = 0
    if (!Array.isArray(results)) return 0
    for (let i = 0; i < results.length; i++) {
      try {
        if (enrichLaunchNetRecovery(results[i])) n++
      } catch (e) {}
    }
    return n
  }

  if (loaded.batched && loaded.batches) {
    for (let b = 0; b < loaded.batches.length; b++) {
      const batch = loaded.batches[b]
      const batchChanges = patchResultsInPlace(batch.results, liveById)
      netRecoveryPatched += enrichResultsNetRecovery(batch.results)
      changes = changes.concat(batchChanges)
    }
    if (changes.length || netRecoveryPatched) {
      // 有变更时跨批整体按 net 升序重排，再按原批大小切块写回全部批文档
      // （改期任务可能需要跨批移动位置，只写脏批无法修正顺序；实际 1~2 批，写放大可忽略）
      const mergedResults = loaded.batches.reduce((all, b) => all.concat(b.results), [])
      sortResultsByNetAsc(mergedResults)
      let cursor = 0
      for (let b = 0; b < loaded.batches.length; b++) {
        const batch = loaded.batches[b]
        const size = batch.results.length
        batch.results = mergedResults.slice(cursor, cursor + size)
        cursor += size
        batch.payload.results = batch.results
        await writeCacheWrapper(batch.batchKey, {
          ...batch.wrapper,
          data: batch.payload
        })
        docsWritten++
      }
      // 刷新主文档 timestamp，让客户端后台比对能感知「云端有更新」
      await writeCacheWrapper(cached.cacheKey, cached.wrapper)
      docsWritten++
    }
  } else {
    changes = patchResultsInPlace(loaded.results, liveById)
    netRecoveryPatched = enrichResultsNetRecovery(loaded.results)
    if (changes.length || netRecoveryPatched) {
      // 写回前按 net 升序重排，避免改期任务停留在数组原位造成客户端列表乱序
      sortResultsByNetAsc(loaded.results)
      const nextPayload = {
        ...cached.payload,
        results: loaded.results
      }
      await writeCacheWrapper(cached.cacheKey, {
        ...cached.wrapper,
        data: nextPayload
      })
      docsWritten++
    }
  }

  // patch 后再扫一遍 upcoming 缓存终态（含本轮刚写成 Success 的）
  const fromCacheTerminal = collectTerminalFromCachedUpcoming(loaded.results, liveById, terminalIds)
  if (fromCacheTerminal.length) {
    terminalEntries = terminalEntries.concat(fromCacheTerminal)
    fromCacheTerminal.forEach((e) => terminalIds.add(e.id))
  }
  // changes 里 status 变为终态的也并入（与上互补）
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    if (!c || !c.id || terminalIds.has(c.id)) continue
    const abbrev = String((c.after && c.after.statusAbbrev) || '').toLowerCase()
    const live = liveById.get(c.id)
    if (live && isTerminalStatus(live.status)) {
      terminalEntries.push({
        id: c.id,
        name: c.name || '',
        status: {
          id: live.status.id,
          name: live.status.name || '',
          abbrev: live.status.abbrev || ''
        },
        net: live.net || c.after.net || '',
        windowStart: live.window_start || '',
        windowEnd: live.window_end || '',
        settledAtMs: Date.now(),
        source: 'launch_net_hourly_change'
      })
      terminalIds.add(c.id)
    } else if (/success|failure|partial/i.test(abbrev)) {
      // 无 live 行时用 abbrev 粗映射（极少见）
      const sid = /partial/i.test(abbrev) ? 7 : (/fail/i.test(abbrev) ? 4 : 3)
      terminalEntries.push({
        id: c.id,
        name: c.name || '',
        status: { id: sid, name: c.after.statusAbbrev || '', abbrev: c.after.statusAbbrev || '' },
        net: (c.after && c.after.net) || '',
        windowStart: '',
        windowEnd: '',
        settledAtMs: Date.now(),
        source: 'launch_net_hourly_change'
      })
      terminalIds.add(c.id)
    }
  }

  const settledRes = await mergeRecentSettled(terminalEntries)
  let previousPatch = { patched: 0, docsWritten: 0 }
  if (terminalEntries.length) {
    try {
      previousPatch = await syncTerminalIntoPreviousCache(terminalEntries)
    } catch (e) {
      previousPatch = { patched: 0, docsWritten: 0, error: e.message || String(e) }
    }
  }

  // 终态任务：失效并重算详情页发射统计缓存（含本次口径，对齐序号徽章）
  let missionStatsInvalidate = { skipped: true }
  if (terminalEntries.length) {
    try {
      missionStatsInvalidate = await invalidateMissionStatsForTerminals(terminalEntries, loaded.results)
    } catch (e) {
      missionStatsInvalidate = { success: false, error: e.message || String(e) }
    }
  }

  let launchDataPatch = { updated: 0, skipped: 0 }
  if (changes.length) {
    try {
      launchDataPatch = await patchLaunchDataNets(changes)
    } catch (e) {
      launchDataPatch = { updated: 0, skipped: 0, error: e.message || String(e) }
    }
  }

  return {
    success: true,
    probed: liveRows.length,
    matchedInCache: loaded.results.filter((r) => r && r.id != null && liveById.has(String(r.id))).length,
    patched: changes.length,
    docsWritten,
    changes: changes.map((c) => ({
      id: c.id,
      name: c.name,
      netBefore: c.before.net,
      netAfter: c.after.net,
      statusBefore: c.before.statusAbbrev,
      statusAfter: c.after.statusAbbrev
    })),
    launchDataPatch,
    cacheKey: cached.cacheKey,
    liveStatusCacheUpdated: true,
    netRecoveryPatched,
    recentSettled: settledRes,
    previousStatusPatch: previousPatch,
    missionStatsInvalidate,
    terminalCount: terminalEntries.length,
    timestamp: Date.now(),
    elapsed: Date.now() - startTime
  }
}

module.exports = {
  runLaunchNetHourly,
  shouldSkipDueToFullSyncHour,
  isInLaunchTimeWindow,
  PROBE_LIMIT
}
