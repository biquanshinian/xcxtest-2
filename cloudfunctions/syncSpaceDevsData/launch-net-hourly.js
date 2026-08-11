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
 *   - 探针结果里若出现终态(3/4/7/9)：写入 recent_settled + 就地修正/插入 previous 缓存
 *     （0 额外 LL2；插入时优先复用 upcoming slim 完整行，避免历史列表空窗）
 *   - 飞行中(6) 同样写入 recent_settled + previous stub（供倒计时跨会话 settle，
 *     并堵住 hide_recent_previous 后 upcoming/previous 双边空窗）；合并时终态不可被飞行中降级
 *   - live status 缓存按 id merge 写入，避免被到点查询覆盖掉探针 30 条
 *
 * 不替代 syncLaunches：新任务入库、图片/助推器等仍靠 6h detailed。
 */
const { db, LAUNCH_LIBRARY_API, fetchAPI, cloud } = require('./shared.js')
const { enrichLaunchNetRecovery } = require('./ll2-net-recovery-enrich.js')
const { createLaunchStatusStore } = require('./launch-status-store.js')
const {
  pruneStaleUpcomingResults: projectUpcomingWithoutSettled,
  collectTerminalFromCachedUpcoming: collectCachedTerminalBeforePrune,
  stubFromTerminalEntry,
  attachLaunchStubsToTerminalEntries
} = require('./launch-net-state.js')
const {
  shouldRejectNetAdvance,
  sortResultsByNetAsc: sortResultsByNetPolicy,
  mergeLiveRowNetHysteresis
} = require('./net-patch-policy.js')
const launchStatusStore = createLaunchStatusStore(db)
let _launchStatusStoreEnsured = false

async function ensureLaunchStatusStore() {
  if (_launchStatusStoreEnsured) return
  _launchStatusStoreEnsured = true
  try { await db.createCollection('launch_status') } catch (e) {}
  try {
    const legacy = await db.collection(LIVE_STATUS_CACHE_COL).doc('_recent_settled').get()
    // migratedAtMs 标记：迁移只需成功一次，避免每次冷启动都对全部行重放 upsert 读写
    if (legacy && legacy.data && !legacy.data.migratedAtMs) {
      const rows = Array.isArray(legacy.data.data) ? legacy.data.data : []
      if (rows.length) await launchStatusStore.upsertMany(rows, { source: 'migration' })
      await db.collection(LIVE_STATUS_CACHE_COL).doc('_recent_settled').update({
        data: { migratedAtMs: Date.now() }
      }).catch(() => {})
    }
  } catch (e) {}
}

const SPACE_DEVS_CACHE = 'space_devs_cache'
const LAUNCH_DATA_COLLECTION = 'launch_data'
const LIVE_STATUS_CACHE_COL = 'launch_timeline_cache'
const LIVE_STATUS_CACHE_DOC = '_live_status_cache'

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
const INFLIGHT_STATUS_ID = 6

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

function isInflightStatus(status) {
  const id = status && status.id != null ? Number(status.id) : 0
  return id === INFLIGHT_STATUS_ID
}

/** 可落历史 / 可写 previous：终态或飞行中 */
function isSettledStatus(status) {
  return isTerminalStatus(status) || isInflightStatus(status)
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

/**
 * upcoming 已 prune 后，用 launch_status 近窗终态判断是否仍需在全量同窗跑探针，
 * 否则刚成功任务可能既不在 upcoming、又赶不上 :00 全量，:30 也被跳过。
 * 回溯用 6h，覆盖「成功 → 下个整点全量小时」的最长间隔。
 */
async function hasRecentTerminalSettlement(nowMs) {
  const now = nowMs || Date.now()
  const behindMs = 6 * 60 * 60 * 1000
  try {
    const rows = await launchStatusStore.getRecent(20)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row || !isTerminalStatus(row.status)) continue
      const netMs = row.net ? new Date(row.net).getTime() : 0
      const obsMs = Number(row.observedAtMs || row.settledAtMs) || 0
      if (Number.isFinite(netMs) && netMs >= now - behindMs && netMs <= now) return true
      if (obsMs >= now - behindMs) return true
    }
  } catch (e) {}
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
  // 与 syncLaunches / ll2Query 共用 NET 迟滞语义
  const liveRow = {
    ...live,
    status: slimStatusFromLive(live) || live.status
  }
  const merged = mergeLiveRowNetHysteresis(target, liveRow)
  if (!merged) return
  target.net = merged.net || target.net || ''
  target.window_start = merged.window_start || target.window_start || ''
  target.window_end = merged.window_end || target.window_end || ''
  if (merged.status) target.status = merged.status
}

/**
 * live status 行合并：已有终态不被非终态覆盖；拒绝可疑 NET 前移污染共享缓存。
 */
function preferLiveStatusRow(incoming, existing) {
  if (!existing) return incoming
  if (!incoming) return existing
  if (isTerminalStatus(existing.status) && !isTerminalStatus(incoming.status)) return existing
  if (shouldRejectNetAdvance(
    { net: existing.net, window_start: existing.windowStart, status: existing.status },
    { net: incoming.net, window_start: incoming.windowStart, status: incoming.status }
  )) {
    // 与 mergeLiveRowNetHysteresis 一致：拒写时整包保留 net/window/status
    return {
      ...incoming,
      net: existing.net,
      windowStart: existing.windowStart,
      windowEnd: existing.windowEnd,
      status: existing.status || incoming.status
    }
  }
  return incoming
}

/** 权威终态可剔除；另可用 launch_status 终态剔除 hide_recent 后残留的旧 Go。 */
function pruneStaleUpcomingResults(results, liveById, extraTerminalIds) {
  return projectUpcomingWithoutSettled(results, liveById, extraTerminalIds)
}

/**
 * 缓存里过点、且本轮探针未带回的 id → 查 launch_status，终态则加入可剔除集合。
 * 覆盖：Success 后 hide_recent 立刻离表，探针再也看不到，旧 Go 会永久卡在 upcoming。
 */
async function collectTerminalIdsFromStatusStore(cachedResults, liveById, nowMs) {
  const ids = []
  const seen = new Set()
  const now = Number(nowMs) || Date.now()
  const rows = Array.isArray(cachedResults) ? cachedResults : []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.id == null) continue
    const id = String(row.id)
    if (seen.has(id) || (liveById && liveById.has(id))) continue
    if (isTerminalStatus(row.status)) continue
    const netMs = row.net ? new Date(row.net).getTime() : NaN
    if (!Number.isFinite(netMs) || netMs > now) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= 40) break
  }
  if (!ids.length) return new Set()
  try {
    await ensureLaunchStatusStore()
    const stored = await launchStatusStore.getByIds(ids)
    const out = new Set()
    for (let i = 0; i < (stored || []).length; i++) {
      const s = stored[i]
      if (s && s.id && isTerminalStatus(s.status)) out.add(String(s.id))
    }
    return out
  } catch (e) {
    return new Set()
  }
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
  // 优先主文档 batchKeys（含 generation 分片）；否则才扫经典 _batch_N
  const declaredKeys =
    Array.isArray(payload.batchKeys) && payload.batchKeys.length
      ? payload.batchKeys.slice()
      : null

  if (declaredKeys) {
    for (let i = 0; i < declaredKeys.length; i++) {
      const batchKey = declaredKeys[i]
      const batchDoc = await col.doc(batchKey).get().catch(() => null)
      const batchWrapper = batchDoc && batchDoc.data
      const batchPayload = batchWrapper && batchWrapper.data
      if (!batchPayload || !Array.isArray(batchPayload.results)) {
        // 声明分片缺失：不能静默跳过，否则小时写回会按残缺子集改 count
        return {
          batched: true,
          results: [],
          batches: null,
          broken: true,
          missingKey: batchKey
        }
      }
      batches.push({
        batchKey,
        wrapper: batchWrapper,
        payload: batchPayload,
        results: batchPayload.results.slice()
      })
    }
  } else {
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
 * 待定（TBD/Hold/TBC）排序降权，避免占倒计时队首；不改展示用 net。
 */
function sortResultsByNetAsc(results) {
  return sortResultsByNetPolicy(results)
}

/** 已有缓存顺序若与降权排序不一致（例如历史短 NET 污染），即使本轮无字段变更也要重写 */
function needsUncertainSortRepair(results) {
  if (!Array.isArray(results) || results.length < 2) return false
  const ranked = results.slice()
  sortResultsByNetAsc(ranked)
  for (let i = 0; i < ranked.length; i++) {
    const a = results[i] && results[i].id != null ? String(results[i].id) : ''
    const b = ranked[i] && ranked[i].id != null ? String(ranked[i].id) : ''
    if (a !== b) return true
  }
  return false
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
    const id = fresh[i].id
    byId.set(id, preferLiveStatusRow(fresh[i], byId.get(id)))
  }
  // 探针序优先（按 NET），其余按原顺序追加；同 id 取 prefer 后的行
  const rows = []
  const seen = new Set()
  for (let i = 0; i < fresh.length; i++) {
    const id = fresh[i].id
    rows.push(byId.get(id) || fresh[i])
    seen.add(id)
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
 * 从探针结果提取终态行（Success/Failure/Partial/Deployed），供 recent_settled / previous patch。
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

/** 飞行中(6) → recent_settled + previous stub（倒计时跨会话；堵住 hide_recent 空窗） */
function collectInflightFromLive(liveRows) {
  const out = []
  if (!Array.isArray(liveRows)) return out
  const now = Date.now()
  for (let i = 0; i < liveRows.length; i++) {
    const r = liveRows[i]
    if (!r || r.id == null || !isInflightStatus(r.status)) continue
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
      source: 'launch_net_hourly_inflight'
    })
  }
  return out
}

/**
 * 缓存 upcoming 里已是终态、但本轮探针未带回的行（任务已离开 upcoming 前 30）。
 * 用缓存上的 status（可能刚被本轮 patch）写入 recent_settled，仍 0 额外 LL2。
 */
function collectTerminalFromCachedUpcoming(cachedResults, liveById, alreadyIds) {
  return collectCachedTerminalBeforePrune(cachedResults, liveById, alreadyIds)
}

/**
 * 合并写入 recent_settled（按 id 去重；终态不可被飞行中降级；最多 RECENT_SETTLED_MAX 条）。
 * 前端历史列表只消费终态角标；倒计时可读飞行中做跨会话 settle。
 */
async function mergeRecentSettled(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return { written: false, count: 0 }
  }
  try {
    const written = await launchStatusStore.upsertMany(entries, { source: 'hourly_probe' })
    return { written: true, count: written.length, added: entries.length, store: 'launch_status' }
  } catch (e) {
    console.warn('[launch-net-hourly] launch_status write fail:', e.message || e)
    return { written: false, count: 0, error: e.message || String(e) }
  }
}

/** 探针见飞行中/终态 → 触发开屏关联任务下架（失败不影响探针主路径） */
async function triggerSplashMissionPrune(reason) {
  try {
    const splashRes = await cloud.callFunction({
      name: 'adminGateway',
      data: {
        scheduleAction: 'prune_mission_splash',
        pruneSource: 'launch-net-hourly',
        pruneReason: String(reason || 'probe').slice(0, 80)
      }
    })
    return (splashRes && splashRes.result) || { ok: true }
  } catch (e) {
    console.warn('[launch-net-hourly] splash mission prune fail:', e.message || e)
    return { skipped: true, error: e.message || String(e) }
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
  const declaredKeys =
    Array.isArray(payload.batchKeys) && payload.batchKeys.length
      ? payload.batchKeys.slice()
      : null

  if (declaredKeys) {
    for (let i = 0; i < declaredKeys.length; i++) {
      const batchKey = declaredKeys[i]
      const batchDoc = await col.doc(batchKey).get().catch(() => null)
      const batchWrapper = batchDoc && batchDoc.data
      const batchPayload = batchWrapper && batchWrapper.data
      if (!batchPayload || !Array.isArray(batchPayload.results)) {
        // previous 允许占位空批，便于终态 stub 插入首片
        batches.push({
          batchKey,
          wrapper: {
            timestamp: Date.now(),
            expireAt: Date.now() + CORE_LIST_TTL_MS,
            data: { results: [], count: 0 }
          },
          payload: { results: [], count: 0 },
          results: []
        })
        continue
      }
      batches.push({
        batchKey,
        wrapper: batchWrapper,
        payload: batchPayload,
        results: batchPayload.results.slice()
      })
    }
  } else {
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
  }
  const results = batches.reduce((all, b) => all.concat(b.results), [])
  return { batched: true, results, batches }
}

/**
 * 用 settled status 就地修正 previous 缓存中已有条目（不插入新任务，0 额外 LL2）。
 * 终态不可被飞行中/Go 降级。
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
    // 已是终态则禁止降级为飞行中/非终态
    if (isTerminalStatus(row.status) && !isTerminalStatus(term.status)) continue
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
 * 将终态/飞行中同步进 previous slim 缓存（有则改 status，无则插入首批头部）。
 * 必须在 upcoming prune / hide_recent 后仍能落库，否则任务两边都空。
 */
async function syncTerminalIntoPreviousCache(terminalEntries) {
  if (!Array.isArray(terminalEntries) || !terminalEntries.length) {
    return { patched: 0, inserted: 0, docsWritten: 0, skipped: 'empty' }
  }

  const terminalById = new Map()
  for (let i = 0; i < terminalEntries.length; i++) {
    const e = terminalEntries[i]
    if (e && e.id && isSettledStatus(e.status)) terminalById.set(String(e.id), e)
  }
  if (!terminalById.size) {
    return { patched: 0, inserted: 0, docsWritten: 0, skipped: 'no_terminal' }
  }

  const cached = await loadPreviousCacheDoc()
  if (!cached) return { patched: 0, inserted: 0, docsWritten: 0, skipped: 'previous_cache_miss' }

  const loaded = await loadAllPreviousResults(cached.cacheKey, cached.payload)
  // 分批主文档在、批次全丢：重建空首片（优先沿用已声明 batchKeys[0]）
  if (loaded.batched && (!loaded.batches || !loaded.batches.length)) {
    const batchKey =
      (Array.isArray(cached.payload.batchKeys) && cached.payload.batchKeys[0]) ||
      `${cached.cacheKey}_batch_0`
    loaded.batches = [
      {
        batchKey,
        wrapper: {
          timestamp: Date.now(),
          expireAt: Date.now() + CORE_LIST_TTL_MS,
          data: { results: [], count: 0 }
        },
        payload: { results: [], count: 0 },
        results: []
      }
    ]
    loaded.results = []
    cached.payload = {
      ...cached.payload,
      isBatched: true,
      totalBatches: 1,
      batchKeys: [batchKey],
      results: [],
      count: Number(cached.payload.count) || 0
    }
    cached.wrapper = { ...cached.wrapper, data: cached.payload }
  }
  // 整包空 results[] 允许插入；只有结构不可用才跳过
  if (!loaded.batched && !Array.isArray(loaded.results)) {
    return { patched: 0, inserted: 0, docsWritten: 0, skipped: 'previous_cache_empty', cacheKey: cached.cacheKey }
  }
  if (!loaded.batched) loaded.results = loaded.results || []

  let patched = 0
  let inserted = 0
  let docsWritten = 0
  const foundIds = new Set()
  for (let i = 0; i < loaded.results.length; i++) {
    const row = loaded.results[i]
    if (row && row.id != null && terminalById.has(String(row.id))) {
      foundIds.add(String(row.id))
    }
  }

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
    const missing = []
    terminalById.forEach((term, id) => {
      if (!foundIds.has(id)) missing.push(term)
    })
    if (missing.length && loaded.batches[0]) {
      const existingIds = new Set(
        (loaded.batches[0].results || [])
          .map((r) => (r && r.id != null ? String(r.id) : ''))
          .filter(Boolean)
      )
      const stubs = missing
        .map(stubFromTerminalEntry)
        .filter((s) => s && s.id && !existingIds.has(String(s.id)))
        .sort((a, b) => {
          const am = a.net ? new Date(a.net).getTime() : 0
          const bm = b.net ? new Date(b.net).getTime() : 0
          return bm - am
        })
      if (stubs.length) {
        const batch0 = loaded.batches[0]
        batch0.results = stubs.concat(batch0.results || [])
        batch0.payload.results = batch0.results
        if (typeof batch0.payload.count === 'number') {
          batch0.payload.count = Number(batch0.payload.count) + stubs.length
        }
        await writeCacheWrapper(batch0.batchKey, {
          ...batch0.wrapper,
          data: batch0.payload
        })
        docsWritten++
        inserted = stubs.length
        loaded.results = stubs.concat(loaded.results)
      }
    }
    if (patched || inserted) {
      // 主文档 count 供分页/诊断；插入发生在 batch0 时同步抬一下，避免 hasMore 误判
      if (inserted && cached.payload && typeof cached.payload.count === 'number') {
        cached.payload.count = Number(cached.payload.count) + inserted
        cached.wrapper = { ...cached.wrapper, data: cached.payload }
      }
      await writeCacheWrapper(cached.cacheKey, cached.wrapper)
      docsWritten++
    }
  } else {
    patched = patchPreviousStatusInPlace(loaded.results, terminalById)
    const missing = []
    terminalById.forEach((term, id) => {
      if (!foundIds.has(id)) missing.push(term)
    })
    if (missing.length) {
      const existingIds = new Set(
        (loaded.results || [])
          .map((r) => (r && r.id != null ? String(r.id) : ''))
          .filter(Boolean)
      )
      const stubs = missing
        .map(stubFromTerminalEntry)
        .filter((s) => s && s.id && !existingIds.has(String(s.id)))
        .sort((a, b) => {
          const am = a.net ? new Date(a.net).getTime() : 0
          const bm = b.net ? new Date(b.net).getTime() : 0
          return bm - am
        })
      if (stubs.length) {
        loaded.results = stubs.concat(loaded.results)
        inserted = stubs.length
      }
    }
    if (patched || inserted) {
      const nextPayload = { ...cached.payload, results: loaded.results }
      if (inserted && typeof nextPayload.count === 'number') {
        nextPayload.count = Number(nextPayload.count) + inserted
      }
      await writeCacheWrapper(cached.cacheKey, {
        ...cached.wrapper,
        data: nextPayload
      })
      docsWritten++
    }
  }

  return { patched, inserted, docsWritten, cacheKey: cached.cacheKey }
}

/** previous 补写回溯窗：与前端瘦卡占位一致，覆盖「错过首窗 / prune 后写库失败」 */
const PREVIOUS_BACKFILL_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * 探针 list / upcoming 已看不到终态时，用 launch_status 近窗终态/飞行中补写 previous。
 * 0 额外 LL2；idempotent（已在 previous 则只 patch / 跳过插入）。
 */
async function backfillPreviousFromRecentLaunchStatus(nowMs, alreadySyncedIds) {
  const now = nowMs || Date.now()
  const skip = alreadySyncedIds instanceof Set ? alreadySyncedIds : new Set()
  let rows
  try {
    rows = await launchStatusStore.getRecent(40)
  } catch (e) {
    return { patched: 0, inserted: 0, skipped: 'launch_status_read_fail', error: e.message || String(e) }
  }
  const entries = []
  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i]
    if (!row || row.id == null || !isSettledStatus(row.status)) continue
    const id = String(row.id)
    if (skip.has(id)) continue
    const netMs = row.net ? new Date(row.net).getTime() : NaN
    const obsMs = Number(row.observedAtMs || row.settledAtMs) || 0
    // 有 net 必须以 NET 近 48h 为准，禁止仅靠 observedAt 把旧终态捞回 previous 头部
    if (Number.isFinite(netMs)) {
      if (netMs < now - PREVIOUS_BACKFILL_MAX_AGE_MS || netMs > now + 60 * 60 * 1000) continue
    } else if (!(obsMs >= now - PREVIOUS_BACKFILL_MAX_AGE_MS)) {
      continue
    }
    entries.push({
      id,
      name: typeof row.name === 'string' ? row.name : '',
      status: {
        id: row.status.id,
        name: (row.status && row.status.name) || '',
        abbrev: (row.status && row.status.abbrev) || ''
      },
      net: row.net || '',
      windowStart: row.windowStart || '',
      windowEnd: row.windowEnd || '',
      settledAtMs: obsMs || now,
      source: 'launch_status_previous_backfill'
    })
  }
  if (!entries.length) {
    return { patched: 0, inserted: 0, skipped: 'no_backfill_candidates' }
  }
  return syncTerminalIntoPreviousCache(entries)
}

/**
 * 探针写入飞行中/终态后，立刻让对应详情缓存过期。
 * 否则详情仍可能靠 3.5h TTL 吐出发射前 Go，和历史卡「飞行中」分裂。
 */
async function expireLaunchDetailCaches(entries) {
  if (!Array.isArray(entries) || !entries.length) return { expired: 0 }
  const col = db.collection(SPACE_DEVS_CACHE)
  const now = Date.now()
  let expired = 0
  const seen = new Set()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e || !e.id) continue
    const id = String(e.id)
    if (seen.has(id)) continue
    seen.add(id)
    const key = `api_cache_/launches/${id}/_${JSON.stringify({ format: 'json', mode: 'detailed' })}_full_v7`
    try {
      const doc = await col.doc(key).get()
      const wrap = doc && doc.data
      const inner = wrap && wrap.data
      if (!inner || !inner.data) continue
      if (inner.expireAt && Number(inner.expireAt) <= now) continue
      await col.doc(key).set({
        data: {
          ...wrap,
          data: { ...inner, expireAt: now },
          updatedAtMs: now
        }
      })
      expired++
    } catch (e2) {}
  }
  return { expired }
}

/**
 * 本轮探针终态/飞行中写 previous；再从 launch_status 补漏（写库失败或 hide_recent 后空 entries）。
 */
async function syncPreviousAfterProbe(terminalEntries, nowMs) {
  let primary = { patched: 0, inserted: 0, docsWritten: 0 }
  const ids = new Set()
  if (Array.isArray(terminalEntries) && terminalEntries.length) {
    for (let i = 0; i < terminalEntries.length; i++) {
      if (terminalEntries[i] && terminalEntries[i].id) ids.add(String(terminalEntries[i].id))
    }
    try {
      primary = await syncTerminalIntoPreviousCache(terminalEntries)
    } catch (e) {
      primary = { patched: 0, inserted: 0, docsWritten: 0, error: e.message || String(e) }
    }
  }
  let backfill = { skipped: true }
  try {
    // 本轮已成功落库的 id 可跳过；失败/跳过则允许 backfill 用 launch_status 重试
    const skipIds = primary.error || primary.skipped ? new Set() : ids
    backfill = await backfillPreviousFromRecentLaunchStatus(nowMs, skipIds)
  } catch (e) {
    backfill = { patched: 0, inserted: 0, error: e.message || String(e) }
  }
  return { ...primary, backfill }
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
  await ensureLaunchStatusStore()
  const force = !!(options && options.force)

  // 先自愈 upcoming 分片（count 漂移 / 缺片），避免客户端整页「数据暂不可用」
  let cacheHeal = null
  try {
    const { healUpcomingCacheIfNeeded } = require('./cache-write-guard.js')
    cacheHeal = await healUpcomingCacheIfNeeded(db, {
      syncLaunches: async () => {
        const legacy = require('./_legacy.js')
        // 限制 heal 全量同步耗时，避免吃光小时探针剩余执行窗口
        return Promise.race([
          legacy.runModularSyncLaunches(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('heal_sync_timeout')), 50000)
          )
        ])
      }
    })
  } catch (e) {
    cacheHeal = { needed: true, healthy: false, error: e.message || String(e) }
  }

  const upcomingUnhealthy = !!(cacheHeal && cacheHeal.needed && cacheHeal.healthy === false)

  if (!force && shouldSkipDueToFullSyncHour(startTime)) {
    // 全量同窗默认跳过；发射窗口内（读云库 upcoming，0 LL2）仍跑探针，避免 NET/scrub 空窗
    let inWindow = false
    try {
      const cached = await loadUpcomingCacheDoc()
      if (cached) {
        const loaded = await loadAllUpcomingResults(cached.cacheKey, cached.payload)
        inWindow = isInLaunchTimeWindow(loaded && loaded.results, startTime)
      }
      // upcoming 已 prune 掉刚成功任务后，窗口判定会假阴性；用 launch_status 近窗终态兜底
      if (!inWindow) {
        inWindow = await hasRecentTerminalSettlement(startTime)
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
        cacheHeal,
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

  // 0 额外 LL2：终态/飞行中 → recent_settled + previous
  let terminalEntries = collectTerminalFromLive(liveRows)
  const inflightEntries = collectInflightFromLive(liveRows)
  const terminalIds = new Set(terminalEntries.map((e) => e.id))
  const settledForPrevious = () => terminalEntries.concat(inflightEntries)

  // upcoming 自愈失败：仍写 live status / previous，但禁止 prune 写回残缺分片
  if (upcomingUnhealthy) {
    attachLaunchStubsToTerminalEntries(settledForPrevious(), null, liveById)
    const settledRes = await mergeRecentSettled(settledForPrevious())
    const previousPatch = await syncPreviousAfterProbe(settledForPrevious(), startTime)
    let splashMissionPrune = { skipped: true }
    if (terminalEntries.length || inflightEntries.length) {
      splashMissionPrune = await triggerSplashMissionPrune(
        terminalEntries.length ? 'probe_terminal_unhealthy' : 'probe_inflight_unhealthy'
      )
    }
    return {
      success: false,
      error: 'upcoming_cache_unhealthy',
      message: 'upcoming 缓存自愈失败，跳过 upcoming 写回以免扩大损伤',
      probed: liveRows.length,
      patched: 0,
      liveStatusCacheUpdated: true,
      recentSettled: settledRes,
      previousStatusPatch: previousPatch,
      splashMissionPrune,
      cacheHeal,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  const cached = await loadUpcomingCacheDoc()
  if (!cached) {
    attachLaunchStubsToTerminalEntries(settledForPrevious(), null, liveById)
    const settledRes = await mergeRecentSettled(settledForPrevious())
    const previousPatch = await syncPreviousAfterProbe(settledForPrevious(), startTime)
    let detailCacheExpire = { expired: 0 }
    try {
      detailCacheExpire = await expireLaunchDetailCaches(settledForPrevious())
    } catch (e) {
      detailCacheExpire = { expired: 0, error: e.message || String(e) }
    }
    let missionStatsInvalidate = { skipped: true }
    if (terminalEntries.length) {
      try {
        missionStatsInvalidate = await invalidateMissionStatsForTerminals(terminalEntries, [])
      } catch (e) {
        missionStatsInvalidate = { success: false, error: e.message || String(e) }
      }
    }
    let splashMissionPrune = { skipped: true }
    if (terminalEntries.length || inflightEntries.length) {
      splashMissionPrune = await triggerSplashMissionPrune(
        terminalEntries.length ? 'probe_terminal_cache_miss' : 'probe_inflight_cache_miss'
      )
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
      detailCacheExpire,
      missionStatsInvalidate,
      splashMissionPrune,
      cacheHeal,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  const loaded = await loadAllUpcomingResults(cached.cacheKey, cached.payload)
  if (loaded.broken) {
    // 分片破损禁止写回 upcoming，但仍落 launch_status 并触发开屏下架（与其它早退出口对齐）
    attachLaunchStubsToTerminalEntries(settledForPrevious(), null, liveById)
    const settledRes = await mergeRecentSettled(settledForPrevious())
    const previousPatch = await syncPreviousAfterProbe(settledForPrevious(), startTime)
    let splashMissionPrune = { skipped: true }
    if (terminalEntries.length || inflightEntries.length) {
      splashMissionPrune = await triggerSplashMissionPrune(
        terminalEntries.length ? 'probe_terminal_batch_missing' : 'probe_inflight_batch_missing'
      )
    }
    return {
      success: false,
      error: 'upcoming_batch_missing',
      missingKey: loaded.missingKey || '',
      message: 'upcoming 声明分片缺失，跳过写回；等待 syncLaunches 重建',
      cacheKey: cached.cacheKey,
      liveStatusCacheUpdated: true,
      recentSettled: settledRes,
      previousStatusPatch: previousPatch,
      splashMissionPrune,
      cacheHeal,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
  if (!loaded.results.length) {
    attachLaunchStubsToTerminalEntries(settledForPrevious(), null, liveById)
    const settledRes = await mergeRecentSettled(settledForPrevious())
    const previousPatch = await syncPreviousAfterProbe(settledForPrevious(), startTime)
    let detailCacheExpire = { expired: 0 }
    try {
      detailCacheExpire = await expireLaunchDetailCaches(settledForPrevious())
    } catch (e) {
      detailCacheExpire = { expired: 0, error: e.message || String(e) }
    }
    let missionStatsInvalidate = { skipped: true }
    if (terminalEntries.length) {
      try {
        missionStatsInvalidate = await invalidateMissionStatsForTerminals(terminalEntries, [])
      } catch (e) {
        missionStatsInvalidate = { success: false, error: e.message || String(e) }
      }
    }
    let splashMissionPrune = { skipped: true }
    if (terminalEntries.length || inflightEntries.length) {
      splashMissionPrune = await triggerSplashMissionPrune(
        terminalEntries.length ? 'probe_terminal_cache_empty' : 'probe_inflight_cache_empty'
      )
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
      detailCacheExpire,
      missionStatsInvalidate,
      splashMissionPrune,
      cacheHeal,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }

  let changes = []
  let docsWritten = 0
  let netRecoveryPatched = 0
  let upcomingPruned = []

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
    let mergedResults = loaded.batches.reduce((all, b) => all.concat(b.results), [])
    // 必须在 prune 前采集：终态行一旦剔除，本轮就再也无法落入权威状态库 / previous stub。
    const batchedTerminal = collectTerminalFromCachedUpcoming(mergedResults, liveById, terminalIds)
    if (batchedTerminal.length) {
      terminalEntries = terminalEntries.concat(batchedTerminal)
      batchedTerminal.forEach((entry) => terminalIds.add(entry.id))
    }
    attachLaunchStubsToTerminalEntries(terminalEntries, mergedResults, liveById)
    attachLaunchStubsToTerminalEntries(inflightEntries, mergedResults, liveById)
    const statusTerminalIds = await collectTerminalIdsFromStatusStore(mergedResults, liveById, startTime)
    const pruneRes = pruneStaleUpcomingResults(mergedResults, liveById, statusTerminalIds)
    upcomingPruned = pruneRes.pruned
    mergedResults = pruneRes.results
    loaded.results = mergedResults
    const sortRepair = needsUncertainSortRepair(mergedResults)
    if (changes.length || netRecoveryPatched || upcomingPruned.length || sortRepair) {
      // 有变更/剔除/待定队首乱序时跨批整体重排，再压缩空批写回
      sortResultsByNetAsc(mergedResults)
      const { removeOrphanBatchDocs } = require('./cache-write-guard.js')

      // prune 清空：改写为非分片空列表，并清掉孤儿分片（禁止 count:0 + isBatched 空壳）
      if (!mergedResults.length) {
        const prevKeys = Array.isArray(cached.payload.batchKeys)
          ? cached.payload.batchKeys.slice()
          : loaded.batches.map((b) => b.batchKey)
        const nextPayload = {
          ...cached.payload,
          results: [],
          count: 0,
          isBatched: false,
          isBatch: false
        }
        delete nextPayload.batchKeys
        delete nextPayload.totalBatches
        await writeCacheWrapper(cached.cacheKey, {
          ...cached.wrapper,
          data: nextPayload
        })
        docsWritten++
        await removeOrphanBatchDocs(db, cached.cacheKey, [], prevKeys)
      } else {
        // 按原批容量切块，但丢掉空批，避免中间/尾部空分片
        const batchSizes = loaded.batches.map((b) => b.results.length)
        const sizes =
          batchSizes.some((n) => n > 0)
            ? batchSizes
            : loaded.batches.map(() =>
                Math.max(1, Math.ceil(mergedResults.length / Math.max(1, loaded.batches.length)))
              )
        let cursor = 0
        const keptBatches = []
        for (let b = 0; b < loaded.batches.length; b++) {
          const isLast = b === loaded.batches.length - 1
          const slice = isLast
            ? mergedResults.slice(cursor)
            : mergedResults.slice(cursor, cursor + sizes[b])
          cursor += slice.length
          if (!slice.length) continue
          const batch = loaded.batches[b]
          batch.results = slice
          batch.payload = {
            ...batch.payload,
            results: batch.results,
            count: mergedResults.length,
            isBatch: true,
            batchIndex: keptBatches.length
          }
          keptBatches.push(batch)
        }
        // 切块后若因尺寸估算导致漏条，并入最后一批
        if (cursor < mergedResults.length && keptBatches.length) {
          const last = keptBatches[keptBatches.length - 1]
          last.results = last.results.concat(mergedResults.slice(cursor))
          last.payload = {
            ...last.payload,
            results: last.results,
            count: mergedResults.length
          }
        }
        const batchKeys = []
        for (let b = 0; b < keptBatches.length; b++) {
          const batch = keptBatches[b]
          batch.payload.batchIndex = b
          batchKeys.push(batch.batchKey)
          await writeCacheWrapper(batch.batchKey, {
            ...batch.wrapper,
            data: batch.payload
          })
          docsWritten++
        }
        cached.payload = {
          ...cached.payload,
          count: mergedResults.length,
          results: [],
          isBatched: true,
          totalBatches: batchKeys.length,
          batchKeys
        }
        cached.wrapper = { ...cached.wrapper, data: cached.payload }
        await writeCacheWrapper(cached.cacheKey, cached.wrapper)
        docsWritten++
        await removeOrphanBatchDocs(db, cached.cacheKey, batchKeys)
      }
    }
  } else {
    changes = patchResultsInPlace(loaded.results, liveById)
    netRecoveryPatched = enrichResultsNetRecovery(loaded.results)
    const directTerminal = collectTerminalFromCachedUpcoming(loaded.results, liveById, terminalIds)
    if (directTerminal.length) {
      terminalEntries = terminalEntries.concat(directTerminal)
      directTerminal.forEach((entry) => terminalIds.add(entry.id))
    }
    attachLaunchStubsToTerminalEntries(terminalEntries, loaded.results, liveById)
    attachLaunchStubsToTerminalEntries(inflightEntries, loaded.results, liveById)
    const statusTerminalIds = await collectTerminalIdsFromStatusStore(loaded.results, liveById, startTime)
    const pruneRes = pruneStaleUpcomingResults(loaded.results, liveById, statusTerminalIds)
    upcomingPruned = pruneRes.pruned
    loaded.results = pruneRes.results
    const sortRepair = needsUncertainSortRepair(loaded.results)
    if (changes.length || netRecoveryPatched || upcomingPruned.length || sortRepair) {
      sortResultsByNetAsc(loaded.results)
      const { removeOrphanBatchDocs } = require('./cache-write-guard.js')
      const prevKeys = Array.isArray(cached.payload.batchKeys)
        ? cached.payload.batchKeys.slice()
        : []
      const nextPayload = {
        ...cached.payload,
        results: loaded.results,
        count: loaded.results.length,
        isBatched: false,
        isBatch: false
      }
      delete nextPayload.batchKeys
      delete nextPayload.totalBatches
      await writeCacheWrapper(cached.cacheKey, {
        ...cached.wrapper,
        data: nextPayload
      })
      docsWritten++
      if (prevKeys.length) await removeOrphanBatchDocs(db, cached.cacheKey, [], prevKeys)
    }
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

  // changes 补进来的终态可能还没有 stub；upcoming 已 prune，这里用探针 list 兜底
  attachLaunchStubsToTerminalEntries(terminalEntries, null, liveById)
  attachLaunchStubsToTerminalEntries(inflightEntries, null, liveById)

  const settledRes = await mergeRecentSettled(settledForPrevious())
  const previousPatch = await syncPreviousAfterProbe(settledForPrevious(), startTime)
  let detailCacheExpire = { expired: 0 }
  try {
    detailCacheExpire = await expireLaunchDetailCaches(settledForPrevious())
  } catch (e) {
    detailCacheExpire = { expired: 0, error: e.message || String(e) }
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

  // 飞行中/终态：通知开屏动画下架对应关联任务媒体，清空手动池后衔接官网同步
  let splashMissionPrune = { skipped: true }
  if (terminalEntries.length || inflightEntries.length) {
    splashMissionPrune = await triggerSplashMissionPrune(
      terminalEntries.length ? 'probe_terminal' : 'probe_inflight'
    )
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
    upcomingPruned: upcomingPruned.length,
    upcomingPrunedIds: upcomingPruned.slice(0, 20).map((p) => p.id),
    recentSettled: settledRes,
    previousStatusPatch: previousPatch,
    detailCacheExpire,
    missionStatsInvalidate,
    terminalCount: terminalEntries.length,
    splashMissionPrune,
    cacheHeal,
    timestamp: Date.now(),
    elapsed: Date.now() - startTime
  }
}

module.exports = {
  runLaunchNetHourly,
  shouldSkipDueToFullSyncHour,
  isInLaunchTimeWindow,
  pruneStaleUpcomingResults,
  collectTerminalFromCachedUpcoming,
  stubFromTerminalEntry,
  attachLaunchStubsToTerminalEntries,
  syncTerminalIntoPreviousCache,
  backfillPreviousFromRecentLaunchStatus,
  syncPreviousAfterProbe,
  expireLaunchDetailCaches,
  PREVIOUS_BACKFILL_MAX_AGE_MS,
  PROBE_LIMIT
}
