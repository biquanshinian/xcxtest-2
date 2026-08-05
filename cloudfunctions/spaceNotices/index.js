/**
 * SPACE_NOTICES_FEATURE — 发射通告云函数（可整块删除本目录）
 *
 * actions:
 *   (timer/default) sync   — 轮转增量：抓站点 entry 索引 → 每次处理 ENTRIES_PER_RUN 个 entry 的通告
 *   listEntries            — 条目列表（含即将 / 历史分类）
 *   getEntry               — 单条 + notices（缺数据时按需补拉该 entry）
 *   ingestRaw              — 粘贴原文解析入库 { entryKey|ll2Id, rawText, type?, name?, reason? }
 *   parsePreview           — 仅解析 areas，不写库
 *
 * 数据源：space-notices.com 的 entry（历史 + 即将，含猎鹰9 / 长征 / 星舰等），
 * 每个 entry 自带真实 NOTAM / 航海警告多边形。entry 主键用站点 slug（站点不暴露 LL2 id）；
 * LL2（space_devs_cache）只做尽力匹配，用来补发射台坐标、NET 与任务状态。
 * 不单独请求 LL2（无 token、不占免费 15 次/小时配额）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { parseAreasFromRawText } = require('./parse-areas.js')
const {
  FLIGHT13_ENTRY_KEY,
  FLIGHT13_LL2_ID,
  DEMO_NOTICES,
  STALE_DEMO_CORRIDOR_KEY,
  FLIGHT13_CORRIDOR_CENTERLINE,
  FLIGHT13_TRAJECTORY_COLOR,
  FLIGHT13_TRAJECTORY_VERSION
} = require('./seed-demo.js')
const { loadLaunchesFromCache } = require('./read-ll2-cache.js')
const { resolvePadCoords } = require('./pad-coords.js')
const { extractNoticeLinks, noticeKeyFromPath, fetchNoticesByPaths } = require('./fetch-external.js')
const { discoverEntrySlugs, fetchEntryPage, BASE } = require('./discover-entries.js')
const { matchEntryToLaunch } = require('./match-ll2.js')

const crypto = require('crypto')

const ENTRY_COL = 'space_notice_entry'
const NOTICE_COL = 'space_notice'

const SYNC_META_DOC = '_space_notices_sync_meta'
const SYNC_COOLDOWN_MS = 60 * 1000
/** 单次定时器处理的 entry 数；配合 15 分钟定时器约 1 小时覆盖全部 */
const ENTRIES_PER_RUN = 4
/** 抓取预算，留足余量给 DB 写入（云函数 timeout 90s） */
const DEFAULT_BUDGET_MS = 60000

function nowMs() {
  return Date.now()
}

let _collectionsEnsured = false
async function ensureCollections() {
  if (_collectionsEnsured) return
  _collectionsEnsured = true
  // 云开发不会在首次 get/set 时自动建集合；需 createCollection（已存在则忽略错误）
  for (const name of [ENTRY_COL, NOTICE_COL]) {
    try {
      await db.createCollection(name)
    } catch (e) { /* already exists */ }
  }
}

function docIdOf(key) {
  return String(key).replace(/[\/\\#\s]/g, '_')
}

/** get 出的文档再 set 回去时必须去掉 _id/_openid，否则 TCB 报「不能更新」(-501007) */
function stripDocMeta(doc) {
  if (!doc || typeof doc !== 'object') return {}
  const next = Object.assign({}, doc)
  delete next._id
  delete next._openid
  return next
}

// ───────────────────────── 通告读写 ─────────────────────────

function noticeContentHash(notice, areas) {
  const raw = String((notice && notice.rawText) || '')
  const areaSig = JSON.stringify(areas || [])
  return crypto.createHash('sha1').update(raw + '\n' + areaSig).digest('hex').slice(0, 16)
}

function windowBoundsOf(notices) {
  let startMs = 0
  let endMs = 0
  ;(notices || []).forEach((n) => {
    ;((n && n.dates) || []).forEach((d) => {
      const s = Date.parse(String((d && d.start) || ''))
      const e = Date.parse(String((d && d.end) || ''))
      if (Number.isFinite(s) && (!startMs || s < startMs)) startMs = s
      if (Number.isFinite(e) && e > endMs) endMs = e
    })
  })
  return { startMs, endMs }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.forceWrite] 忽略 hash，强制覆盖
 * @returns {Promise<{ noticeKey: string, written: boolean, skipped: boolean }>}
 */
async function upsertNotice(entryKey, notice, opts) {
  const forceWrite = !!(opts && opts.forceWrite)
  const ll2Id = (opts && opts.ll2Id) || ''
  const noticeKey = String(notice.noticeKey)
  const docId = docIdOf(noticeKey)
  let prev = null
  try {
    const got = await db.collection(NOTICE_COL).doc(docId).get()
    prev = got && got.data
  } catch (e) { /* new */ }
  let areas = Array.isArray(notice.areas) && notice.areas.length
    ? notice.areas
    : parseAreasFromRawText(notice.rawText || '')
  // 外部 cancelled / 偶发空 areas 时不抹掉库内已有精密多边形
  if (!areas.length && prev && Array.isArray(prev.areas) && prev.areas.length) {
    areas = prev.areas
  }
  const contentHash = noticeContentHash(notice, areas)
  // 老库文档只有 ll2Id 没有 entryKey，需强制改写一次完成 schema 升级
  const needsSchemaUpgrade = !!prev && !prev.entryKey
  if (!forceWrite && !needsSchemaUpgrade && prev && prev.contentHash === contentHash &&
      !!prev.cancelled === !!notice.cancelled) {
    return { noticeKey, written: false, skipped: true }
  }
  const data = {
    noticeKey,
    entryKey: String(entryKey),
    ll2Id: String(ll2Id || (prev && prev.ll2Id) || ''),
    type: notice.type || 'NOTAM',
    name: notice.name || noticeKey,
    reason: notice.reason || '',
    sourceName: notice.sourceName || '',
    sourceLink: notice.sourceLink || '',
    rawText: notice.rawText || '',
    areas,
    centerline: Array.isArray(notice.centerline) && notice.centerline.length
      ? notice.centerline
      : (prev && prev.centerline) || [],
    dates: notice.dates || [],
    contentHash,
    cancelled: !!notice.cancelled,
    updatedAt: nowMs(),
    createdAt: (prev && prev.createdAt) || nowMs()
  }
  await db.collection(NOTICE_COL).doc(docId).set({ data })
  return { noticeKey, written: true, skipped: false }
}

async function readNoticesOfEntry(entryKey) {
  const res = await db.collection(NOTICE_COL).where({ entryKey: String(entryKey) }).limit(100).get()
  return (res.data || []).filter((n) => n && n.noticeKey !== STALE_DEMO_CORRIDOR_KEY)
}

// ───────────────────────── 条目读写 ─────────────────────────

async function upsertEntry(entry) {
  const id = docIdOf(entry.entryKey)
  let prev = null
  try {
    const got = await db.collection(ENTRY_COL).doc(id).get()
    prev = got && got.data
  } catch (e) { /* new */ }
  const doc = stripDocMeta(Object.assign({}, prev || {}, entry, {
    updatedAt: nowMs(),
    createdAt: (prev && prev.createdAt) || nowMs()
  }))
  await db.collection(ENTRY_COL).doc(id).set({ data: doc })
  return id
}

/** entry 元信息 + LL2 匹配 + 通告统计 → 条目文档 */
function buildEntryDoc(meta, matched, notices) {
  const bounds = windowBoundsOf(notices)
  const launch = (matched && matched.launch) || null
  const netMs = launch && launch.net ? Date.parse(launch.net) : 0
  const refMs = bounds.endMs || (Number.isFinite(netMs) ? netMs : 0)
  return {
    entryKey: meta.entryKey,
    missionName: meta.missionName || '',
    rocketName: meta.rocketName || (launch ? String(launch.subtitle || '') : ''),
    siteTitle: meta.siteTitle || '',
    description: meta.description || (launch ? String(launch.description || '') : ''),
    siteUrl: `${BASE}/entry/${meta.entryKey}`,
    ll2Id: launch ? launch.ll2Id : '',
    ll2Score: matched ? matched.score : 0,
    net: launch ? launch.net || '' : '',
    pad: launch ? resolvePadCoords(launch.pad || {}) : null,
    statusName: launch ? launch.statusName || '' : '',
    agency: launch ? launch.agency || '' : '',
    orbitName: launch ? launch.orbitName || '' : '',
    isStarship: launch ? !!launch.isStarship : /starship/i.test(meta.entryKey),
    noticeKeys: (notices || []).map((n) => n.noticeKey).filter(Boolean),
    noticeCount: (notices || []).length,
    windowStartMs: bounds.startMs,
    windowEndMs: bounds.endMs,
    // 全部危险区窗口都已过期 → 归入历史发射
    isPast: !!(refMs && refMs < nowMs()),
    syncedAt: nowMs()
  }
}

// ───────────────────────── Flight 13 兜底 ─────────────────────────

async function removeStaleDemoCorridor() {
  if (!STALE_DEMO_CORRIDOR_KEY) return
  try {
    await db.collection(NOTICE_COL).doc(docIdOf(STALE_DEMO_CORRIDOR_KEY)).remove()
  } catch (e) { /* already gone */ }
}

async function ensureFlight13Trajectory() {
  // 与 space-notices.com Trajectory 同源（Ship 40）；站点仅对该次飞行提供轨迹
  const payload = {
    trajectory: FLIGHT13_CORRIDOR_CENTERLINE,
    trajectoryColor: FLIGHT13_TRAJECTORY_COLOR,
    trajectoryVersion: FLIGHT13_TRAJECTORY_VERSION,
    trajectoryNote: 'space-notices.com Ship 40 / Flight 13 trajectory',
    trajectorySource: 'space-notices.com',
    updatedAt: nowMs()
  }
  const id = docIdOf(FLIGHT13_ENTRY_KEY)
  try {
    await db.collection(ENTRY_COL).doc(id).update({ data: payload })
  } catch (e) {
    try {
      await db.collection(ENTRY_COL).doc(id).set({
        data: Object.assign(
          { entryKey: FLIGHT13_ENTRY_KEY, missionName: 'Flight 13', rocketName: 'Starship', createdAt: nowMs() },
          payload
        )
      })
    } catch (e2) { /* ignore */ }
  }
}

/** 冷启动兜底：站点抓取失败时也要有 Flight 13 的溅落区与走廊可画 */
async function ensureDemoNotices() {
  await removeStaleDemoCorridor()
  let linked = 0
  for (const n of DEMO_NOTICES) {
    let exists = false
    try {
      const got = await db.collection(NOTICE_COL).doc(docIdOf(n.noticeKey)).get()
      exists = !!(got && got.data && got.data.entryKey && Array.isArray(got.data.areas) && got.data.areas.length)
    } catch (e) {
      exists = false
    }
    if (!exists) {
      await upsertNotice(FLIGHT13_ENTRY_KEY, n, { forceWrite: true, ll2Id: FLIGHT13_LL2_ID })
      linked += 1
    }
  }
  await ensureFlight13Trajectory()
  // 把演示通告统计回写到 entry，避免列表显示「通告 0」
  try {
    const stored = await readNoticesOfEntry(FLIGHT13_ENTRY_KEY)
    const meta = {
      entryKey: FLIGHT13_ENTRY_KEY,
      missionName: 'Flight 13',
      rocketName: 'Starship',
      siteTitle: 'Flight 13 - Starship',
      siteUrl: `${BASE}/entry/${FLIGHT13_ENTRY_KEY}`,
      ll2Id: FLIGHT13_LL2_ID,
      isStarship: true
    }
    // 尽量带上已有 LL2 匹配信息
    let prev = null
    try {
      const got = await db.collection(ENTRY_COL).doc(docIdOf(FLIGHT13_ENTRY_KEY)).get()
      prev = got && got.data
    } catch (e) { /* ignore */ }
    const matched = prev && prev.ll2Id
      ? {
          launch: {
            ll2Id: prev.ll2Id,
            net: prev.net,
            pad: prev.pad,
            statusName: prev.statusName,
            agency: prev.agency,
            orbitName: prev.orbitName,
            subtitle: prev.rocketName,
            description: prev.description,
            isStarship: true
          },
          score: prev.ll2Score || 0
        }
      : null
    await upsertEntry(Object.assign(
      {},
      buildEntryDoc(meta, matched, stored),
      {
        trajectory: (prev && prev.trajectory) || FLIGHT13_CORRIDOR_CENTERLINE,
        trajectoryColor: (prev && prev.trajectoryColor) || FLIGHT13_TRAJECTORY_COLOR,
        trajectoryVersion: (prev && prev.trajectoryVersion) || FLIGHT13_TRAJECTORY_VERSION
      }
    ))
  } catch (e) { /* ignore */ }
  return linked
}

// ───────────────────────── 同步 ─────────────────────────

async function readSyncMeta() {
  try {
    const got = await db.collection(ENTRY_COL).doc(SYNC_META_DOC).get()
    return (got && got.data) || {}
  } catch (e) {
    return {}
  }
}

async function writeSyncMeta(patch) {
  try {
    await db.collection(ENTRY_COL).doc(SYNC_META_DOC).set({
      data: Object.assign({ _meta: true, updatedAt: nowMs() }, patch)
    })
  } catch (e) { /* ignore */ }
}

/** 老 schema（以 ll2Id 为主键、无 entryKey）的条目文档清理 */
async function dropLegacyEntries() {
  let removed = 0
  try {
    const res = await db.collection(ENTRY_COL).limit(100).get()
    for (const d of res.data || []) {
      if (!d || d._meta) continue
      if (d.entryKey) continue
      try {
        await db.collection(ENTRY_COL).doc(d._id).remove()
        removed += 1
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return removed
}

/**
 * 同步单个 entry：抓页面 → 抓通告 → 落库
 * @returns {Promise<{ entryKey: string, fetched: number, parsed: number, written: number, skipped: number, errors: string[] }>}
 */
async function syncOneEntry(slug, launches, deadline) {
  const errors = []
  let meta = null
  let paths = []
  try {
    const page = await fetchEntryPage(slug)
    meta = page.meta
    paths = extractNoticeLinks(page.html)
  } catch (e) {
    return {
      entryKey: slug,
      fetched: 0,
      parsed: 0,
      written: 0,
      skipped: 0,
      errors: [(e && e.message) || String(e)]
    }
  }

  const matched = matchEntryToLaunch(meta, launches)
  const ll2Id = matched ? matched.launch.ll2Id : ''

  const fetchRes = await fetchNoticesByPaths(paths, { deadline })
  if (fetchRes.errors && fetchRes.errors.length) errors.push(...fetchRes.errors.slice(0, 5))

  let written = 0
  let skipped = 0
  for (const n of fetchRes.notices) {
    try {
      const r = await upsertNotice(slug, n, { ll2Id })
      if (r.written) written += 1
      if (r.skipped) skipped += 1
    } catch (e) {
      errors.push(`${n.noticeKey}: ${(e && e.message) || String(e)}`)
    }
  }

  // 统计以库内为准：本轮预算用尽时也不会把历史通告数抹低
  const stored = await readNoticesOfEntry(slug)
  await upsertEntry(buildEntryDoc(meta, matched, stored))

  return {
    entryKey: slug,
    fetched: paths.length,
    parsed: fetchRes.notices.length,
    written,
    skipped,
    errors: errors.slice(0, 5)
  }
}

/**
 * @param {{ budgetMs?: number, entryKeys?: string[], maxEntries?: number }} [opts]
 * entryKeys 指定时为「按需补拉」；否则按 cursor 轮转推进
 */
async function syncSpaceNotices(opts) {
  const o = opts || {}
  const budgetMs = Math.max(8000, Number(o.budgetMs) || DEFAULT_BUDGET_MS)
  const deadline = nowMs() + budgetMs
  await ensureCollections()

  const prevMeta = await readSyncMeta()
  let slugs = Array.isArray(prevMeta.entrySlugs) ? prevMeta.entrySlugs : []
  const discoverErrors = []
  const onDemand = Array.isArray(o.entryKeys) && o.entryKeys.length

  // 按需补拉时跳过首页抓取，省一次请求
  if (!onDemand || !slugs.length) {
    try {
      const found = await discoverEntrySlugs()
      if (found.length) slugs = found
    } catch (e) {
      discoverErrors.push((e && e.message) || String(e))
    }
  }
  if (!slugs.length) slugs = [FLIGHT13_ENTRY_KEY]

  const { launches, source, upcomingCount, previousCount } = await loadLaunchesFromCache()

  let targets
  let cursor = Number(prevMeta.cursor) || 0
  if (onDemand) {
    targets = o.entryKeys.filter(Boolean).slice(0, 3)
  } else {
    const per = Math.max(1, Math.min(Number(o.maxEntries) || ENTRIES_PER_RUN, slugs.length))
    if (cursor >= slugs.length) cursor = 0
    targets = []
    for (let i = 0; i < per; i++) targets.push(slugs[(cursor + i) % slugs.length])
    cursor = (cursor + per) % slugs.length
  }

  const perEntry = []
  for (const slug of targets) {
    if (nowMs() > deadline) {
      perEntry.push({ entryKey: slug, fetched: 0, parsed: 0, written: 0, skipped: 0, errors: ['budget exceeded'] })
      continue
    }
    perEntry.push(await syncOneEntry(slug, launches, deadline))
  }

  const demoLinked = await ensureDemoNotices()
  const legacyRemoved = await dropLegacyEntries()

  const covered = [...new Set((Array.isArray(prevMeta.coveredKeys) ? prevMeta.coveredKeys : []).concat(targets))]
  await writeSyncMeta({
    entrySlugs: slugs,
    cursor: onDemand ? cursor : cursor,
    coveredKeys: covered.filter((k) => slugs.indexOf(k) >= 0),
    lastSyncAt: nowMs()
  })

  const totals = perEntry.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      parsed: acc.parsed + r.parsed,
      written: acc.written + r.written,
      skipped: acc.skipped + r.skipped
    }),
    { fetched: 0, parsed: 0, written: 0, skipped: 0 }
  )

  return {
    success: true,
    entryTotal: slugs.length,
    entriesProcessed: targets.length,
    covered: covered.filter((k) => slugs.indexOf(k) >= 0).length,
    cursor,
    demoLinked,
    legacyRemoved,
    cache: { source, upcomingCount, previousCount, launchCount: launches.length },
    external: {
      fetched: totals.fetched,
      parsed: totals.parsed,
      written: totals.written,
      skipped: totals.skipped,
      errors: perEntry
        .reduce((acc, r) => acc.concat(r.errors || []), discoverErrors)
        .slice(0, 8)
    },
    perEntry
  }
}

async function syncSpaceNoticesThrottled(opts) {
  const force = !!(opts && opts.force)
  if (!force) {
    const meta = await readSyncMeta()
    const last = Number(meta.lastSyncAt) || 0
    if (last && nowMs() - last < SYNC_COOLDOWN_MS) {
      return { success: true, throttled: true, entriesProcessed: 0 }
    }
  }
  return syncSpaceNotices(opts)
}

// ───────────────────────── 查询 ─────────────────────────

function slimEntryRow(d) {
  return {
    entryKey: d.entryKey,
    ll2Id: d.ll2Id || '',
    missionName: d.missionName || d.entryKey,
    rocketName: d.rocketName || '',
    net: d.net || '',
    windowStartMs: d.windowStartMs || 0,
    windowEndMs: d.windowEndMs || 0,
    isPast: !!d.isPast,
    isStarship: !!d.isStarship,
    statusName: d.statusName || '',
    agency: d.agency || '',
    noticeCount: Number(d.noticeCount || (Array.isArray(d.noticeKeys) ? d.noticeKeys.length : 0)),
    hasTrajectory: Array.isArray(d.trajectory) && d.trajectory.length > 1,
    hasPad: !!(d.pad && d.pad.latitude != null),
    syncedAt: d.syncedAt || 0
  }
}

async function listEntries(event) {
  const limit = Math.min(Number(event.limit) || 40, 60)
  let syncError = ''
  let res = await db.collection(ENTRY_COL).limit(100).get().catch((e) => {
    syncError = (e && e.message) || String(e)
    return { data: [] }
  })
  let rows = (res.data || []).filter((d) => d && !d._meta && d.entryKey)
  // 库空时自动同步一次
  if (!rows.length) {
    try {
      const syncRes = await syncSpaceNoticesThrottled({ force: true })
      if (syncRes && syncRes.success === false) {
        syncError = syncRes.error || syncError || 'sync failed'
      }
      res = await db.collection(ENTRY_COL).limit(100).get()
      rows = (res.data || []).filter((d) => d && !d._meta && d.entryKey)
    } catch (e) {
      syncError = (e && e.message) || String(e)
    }
  }

  const meta = await readSyncMeta()
  const list = rows
    .map(slimEntryRow)
    // 即将发射在前（时间近的靠前），历史发射按时间倒序
    .sort((a, b) => {
      if (a.isPast !== b.isPast) return a.isPast ? 1 : -1
      const ta = a.windowStartMs || Date.parse(a.net) || 0
      const tb = b.windowStartMs || Date.parse(b.net) || 0
      return a.isPast ? tb - ta : ta - tb
    })
    .slice(0, limit)

  if (!list.length) {
    return {
      success: false,
      error: syncError
        ? `暂无数据：${syncError}`
        : '暂无数据：请部署云函数 spaceNotices 后点「同步条目」'
    }
  }
  return {
    success: true,
    results: list,
    progress: {
      total: Number(meta.entrySlugs && meta.entrySlugs.length) || list.length,
      covered: Number(meta.coveredKeys && meta.coveredKeys.length) || list.length,
      lastSyncAt: Number(meta.lastSyncAt) || 0
    }
  }
}

async function findEntryDoc(entryKey, ll2Id) {
  if (entryKey) {
    try {
      const got = await db.collection(ENTRY_COL).doc(docIdOf(entryKey)).get()
      if (got && got.data && !got.data._meta) return got.data
    } catch (e) { /* miss */ }
  }
  if (ll2Id) {
    try {
      const res = await db.collection(ENTRY_COL).where({ ll2Id: String(ll2Id) }).limit(1).get()
      const row = (res.data || []).filter((d) => d && !d._meta)[0]
      if (row) return row
    } catch (e) { /* miss */ }
  }
  return null
}

async function getEntry(event) {
  const entryKey = String(event.entryKey || event.key || '').trim()
  const ll2Id = String(event.ll2Id || '').trim()
  if (!entryKey && !ll2Id) return { success: false, error: 'missing entryKey' }

  let entry = await findEntryDoc(entryKey, ll2Id)
  let notices = entry ? await readNoticesOfEntry(entry.entryKey) : []

  const noticeHasGeom = (n) =>
    Array.isArray(n && n.areas) && n.areas.some((r) => Array.isArray(r) && r.length >= 3)

  /** 通告有原文但 areas 空：与星舰同源 parseAreasFromRawText 即时回填 */
  const hydrateNoticeAreas = (list) =>
    (list || []).map((n) => {
      if (noticeHasGeom(n)) return n
      const raw = n && n.rawText
      if (!raw) return n
      try {
        const areas = parseAreasFromRawText(raw)
        if (areas && areas.length) return Object.assign({}, n, { areas })
      } catch (e) { /* keep */ }
      return n
    })

  notices = hydrateNoticeAreas(notices)

  // 按需补拉：无条目 / 无通告 / 通告既无几何也无原文（脏数据）时同步
  const needSync =
    !entry ||
    !notices.length ||
    (notices.length > 0 && !notices.some(noticeHasGeom) && !notices.some((n) => n && n.rawText))
  if (needSync) {
    const target = (entry && entry.entryKey) || entryKey
    try {
      if (target) await syncSpaceNotices({ entryKeys: [target], budgetMs: 40000 })
      else await syncSpaceNoticesThrottled({ force: true })
      entry = await findEntryDoc(target || entryKey, ll2Id)
      notices = hydrateNoticeAreas(entry ? await readNoticesOfEntry(entry.entryKey) : [])
    } catch (e) { /* 用已有数据继续 */ }
  }
  if (!entry) return { success: false, error: 'not_found' }

  // 发射台坐标：库内可能是 slim 掉 lat/lon 后的裸 name，重新 resolve
  const pad = resolvePadCoords(entry.pad || {})

  // Flight 13：始终用站点同源轨迹（避免库内残留旧抽稀包画成粗折线）
  let trajectory = Array.isArray(entry.trajectory) ? entry.trajectory : []
  let trajectoryColor = entry.trajectoryColor || ''
  let trajectoryVersion = Number(entry.trajectoryVersion || 0)
  if (entry.entryKey === FLIGHT13_ENTRY_KEY) {
    const stale =
      trajectoryVersion < FLIGHT13_TRAJECTORY_VERSION ||
      trajectory.length !== FLIGHT13_CORRIDOR_CENTERLINE.length
    if (stale) {
      trajectory = FLIGHT13_CORRIDOR_CENTERLINE
      trajectoryColor = FLIGHT13_TRAJECTORY_COLOR
      trajectoryVersion = FLIGHT13_TRAJECTORY_VERSION
      try {
        await ensureFlight13Trajectory()
      } catch (e) { /* ignore */ }
    }
  }

  return {
    success: true,
    entry: {
      entryKey: entry.entryKey,
      ll2Id: entry.ll2Id || '',
      missionName: entry.missionName || entry.entryKey,
      rocketName: entry.rocketName || '',
      siteTitle: entry.siteTitle || '',
      description: entry.description || '',
      siteUrl: entry.siteUrl || `${BASE}/entry/${entry.entryKey}`,
      net: entry.net || '',
      pad: pad.latitude != null ? pad : entry.pad || null,
      statusName: entry.statusName || '',
      agency: entry.agency || '',
      orbitName: entry.orbitName || '',
      isStarship: !!entry.isStarship,
      isPast: !!entry.isPast,
      windowStartMs: entry.windowStartMs || 0,
      windowEndMs: entry.windowEndMs || 0,
      noticeKeys: entry.noticeKeys || [],
      trajectory,
      trajectoryColor,
      trajectoryVersion,
      trajectoryNote: entry.trajectoryNote || '',
      syncedAt: entry.syncedAt || 0
    },
    notices: notices.map((n) => ({
      noticeKey: n.noticeKey,
      type: n.type,
      name: n.name,
      reason: n.reason,
      sourceName: n.sourceName,
      sourceLink: n.sourceLink,
      areas: n.areas || [],
      centerline: Array.isArray(n.centerline) ? n.centerline : [],
      dates: n.dates || [],
      rawText: n.rawText || '',
      cancelled: !!n.cancelled
    }))
  }
}

async function ingestRaw(event) {
  // 写接口：必须带环境变量 SPACE_NOTICES_INGEST_SECRET，禁止匿名客户端乱写
  const secret = typeof process.env.SPACE_NOTICES_INGEST_SECRET === 'string'
    ? process.env.SPACE_NOTICES_INGEST_SECRET.trim()
    : ''
  if (!secret || secret === 'FILL_ME' || event.ingestSecret !== secret) {
    return { success: false, error: 'forbidden' }
  }
  const entryKey = String(event.entryKey || event.ll2Id || '').trim()
  const rawText = String(event.rawText || '')
  if (!entryKey || !rawText.trim()) return { success: false, error: 'missing entryKey or rawText' }
  const areas = parseAreasFromRawText(rawText)
  const type = String(event.type || 'NOTAM').toUpperCase()
  const noticeKey = String(event.noticeKey || `${type.toLowerCase()}-manual-${nowMs()}`)
  await upsertNotice(entryKey, {
    noticeKey,
    type,
    name: event.name || noticeKey,
    reason: event.reason || '',
    sourceName: event.sourceName || 'manual',
    sourceLink: event.sourceLink || '',
    rawText,
    areas,
    dates: event.dates || []
  }, { forceWrite: true })
  try {
    const stored = await readNoticesOfEntry(entryKey)
    await db.collection(ENTRY_COL).doc(docIdOf(entryKey)).update({
      data: {
        noticeKeys: stored.map((n) => n.noticeKey),
        noticeCount: stored.length,
        updatedAt: nowMs()
      }
    })
  } catch (e) { /* entry 可能尚未创建 */ }
  return { success: true, noticeKey, areaRings: areas.length, pointCount: areas[0] ? areas[0].length : 0 }
}

async function parsePreview(event) {
  const areas = parseAreasFromRawText(event.rawText || '')
  return { success: true, areas }
}

exports.main = async (event) => {
  const ev = event || {}
  const isTimer = ev.Type === 'Timer' || !!ev.TriggerName
  const action = ev.action || (isTimer ? 'sync' : 'listEntries')
  try {
    if (action !== 'parsePreview') await ensureCollections()
    if (action === 'listEntries') return await listEntries(ev)
    if (action === 'getEntry') return await getEntry(ev)
    if (action === 'ingestRaw') return await ingestRaw(ev)
    if (action === 'parsePreview') return await parsePreview(ev)
    if (action === 'sync') {
      return await syncSpaceNoticesThrottled({
        force: isTimer || !!ev.force,
        budgetMs: Number(ev.budgetMs) || DEFAULT_BUDGET_MS,
        maxEntries: Number(ev.maxEntries) || 0,
        entryKeys: Array.isArray(ev.entryKeys) ? ev.entryKeys : null
      })
    }
    return { success: false, error: 'unknown_action' }
  } catch (err) {
    console.error('[spaceNotices]', action, err)
    return { success: false, error: (err && err.message) || String(err) }
  }
}
