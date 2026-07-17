/**
 * 定时扫 starship_event_updates → bilibili_publish_queue
 * 总开关：global_config / bilibili_auto_publish
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { resolveTopics, formatTopicsLine } = require('./topicEngine')
const { extractEventImages } = require('./eventMediaImages')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CONFIG_ID = 'bilibili_auto_publish'
const EVENTS_COL = 'starship_event_updates'
const QUEUE_COL = 'bilibili_publish_queue'
const GLOBAL_COL = 'global_config'

const DEFAULT_CONFIG = {
  enabled: false,
  syncFromAt: 0,
  minIntervalSec: 1800,
  intervalJitterSec: 600,
  maxPerHour: 2,
  maxPerDay: 8,
  textOnlyMaxPerDay: 3,
  topicMax: 5,
  skipIfTooSimilar: true,
  similarWindow: 5,
  onRateLimitCooldownMin: 120,
  autoPauseAfterFails: 3,
  aiTopicEnabled: true,
  aiTopicAutopromote: true,
  aiPromoteMinSuggests: 2,
  footer: '—— 火星探索日志',
  alwaysTopics: ['火星探索日志'],
  cooldownUntil: 0,
  consecutiveFails: 0,
  lastPublishAt: 0,
  publishedToday: 0,
  publishedHour: 0,
  dayKey: '',
  hourKey: '',
  lastError: '',
  updatedAt: 0
}

function now() {
  return Date.now()
}

function dayKeyOf(ts = now()) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hourKeyOf(ts = now()) {
  const d = new Date(ts)
  return `${dayKeyOf(ts)}T${String(d.getHours()).padStart(2, '0')}`
}

function refreshQuotaCounters(cfg, ts = now()) {
  const next = { ...cfg }
  const dk = dayKeyOf(ts)
  const hk = hourKeyOf(ts)
  if (next.dayKey !== dk) {
    next.dayKey = dk
    next.publishedToday = 0
  }
  if (next.hourKey !== hk) {
    next.hourKey = hk
    next.publishedHour = 0
  }
  return next
}

async function getConfig() {
  try {
    const res = await db.collection(GLOBAL_COL).doc(CONFIG_ID).get()
    return { ...DEFAULT_CONFIG, ...(res.data || {}) }
  } catch (e) {
    return { ...DEFAULT_CONFIG }
  }
}

async function saveConfig(patch) {
  const data = { ...patch, updatedAt: now() }
  delete data._id
  try {
    await db.collection(GLOBAL_COL).doc(CONFIG_ID).update({ data })
  } catch (e) {
    try {
      await db.collection(GLOBAL_COL).doc(CONFIG_ID).set({
        data: { ...DEFAULT_CONFIG, ...data }
      })
    } catch (e2) {
      console.warn('[saveConfig]', e2.message || e2)
    }
  }
}

function eventSyncStatus(ev) {
  return String(ev.bilibiliSyncStatus || 'idle')
}

function extractImages(evOrMediaList) {
  // 兼容旧调用：传入整条事件，保证图文来自同一条推文/事件的 COS mediaList
  if (evOrMediaList && !Array.isArray(evOrMediaList) && typeof evOrMediaList === 'object') {
    return extractEventImages(evOrMediaList, 9)
  }
  return extractEventImages({ mediaList: evOrMediaList }, 9)
}

/**
 * HEAD 探测单张图是否仍可下载。
 * 404/403/410 视为永久失效；网络异常/超时 fail-open（避免抖动误杀好图）。
 */
function headImageAlive(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false
    const done = (alive) => {
      if (settled) return
      settled = true
      resolve(alive)
    }
    try {
      const req = https.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
        const code = Number(res.statusCode || 0)
        res.resume()
        if (code === 404 || code === 403 || code === 410) return done(false)
        done(true)
      })
      req.on('timeout', () => {
        try { req.destroy() } catch (e) {}
        done(true)
      })
      req.on('error', () => done(true))
      req.end()
    } catch (e) {
      done(true)
    }
  })
}

/** 剔除已从 COS 删除的死图，保持原顺序 */
async function filterAliveImages(urls) {
  const list = Array.isArray(urls) ? urls : []
  if (!list.length) return { alive: [], dead: [] }
  const flags = await Promise.all(list.map((u) => headImageAlive(u)))
  const alive = []
  const dead = []
  list.forEach((u, i) => {
    if (flags[i]) alive.push(u)
    else dead.push(u)
  })
  return { alive, dead }
}

function truncate(s, max) {
  const t = String(s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

function normalizeForSimilar(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[#【】\[\]（）()]/g, '')
    .slice(0, 400)
}

function similarEnough(a, b) {
  const x = normalizeForSimilar(a)
  const y = normalizeForSimilar(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length >= 40 && y.includes(x.slice(0, 40))) return true
  if (y.length >= 40 && x.includes(y.slice(0, 40))) return true
  const setX = new Set()
  for (let i = 0; i < x.length - 1; i++) setX.add(x.slice(i, i + 2))
  let inter = 0
  const setY = new Set()
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2)
    setY.add(bg)
    if (setX.has(bg)) inter++
  }
  const union = setX.size + setY.size - inter || 1
  return inter / union >= 0.72
}

function sourceLine(ev) {
  const parts = []
  if (ev.source) parts.push(`来源：${ev.source}`)
  if (ev.tweetUrl) parts.push(String(ev.tweetUrl))
  return parts.join(' ')
}

async function composeSingle(ev, cfg) {
  // 正文只用推文/事件 content（无 content 时退回 originalText），不把 title 写进动态
  const body = String(ev.content || ev.originalText || '').trim()
  const textBlob = [body, ev.originalText].filter(Boolean).join('\n')
  const { topics } = await resolveTopics(db, textBlob, cfg)
  const images = extractImages(ev)
  const lines = []
  lines.push(truncate(body, 1000))
  if (ev.liveRoomId) {
    lines.push('')
    lines.push(`直播间：https://live.bilibili.com/${String(ev.liveRoomId).replace(/\D/g, '')}`)
  }
  const src = sourceLine(ev)
  if (src) {
    lines.push('')
    lines.push(src)
  }
  const topicLine = formatTopicsLine(topics)
  if (topicLine) {
    lines.push('')
    lines.push(topicLine)
  }
  if (cfg.footer) {
    lines.push('')
    lines.push(cfg.footer)
  }
  return {
    type: 'single',
    eventIds: [ev._id],
    title: ev.title || '',
    content: lines.join('\n').trim(),
    images,
    topics,
    eventPublishedAt: Number(ev.publishedAt || ev.createdAt || 0)
  }
}

function computeScheduledAt(cfg, hasImages) {
  const ts = now()
  let cfg2 = refreshQuotaCounters(cfg, ts)
  if (Number(cfg2.publishedToday || 0) >= Number(cfg2.maxPerDay || 8)) return { ok: false, reason: 'day_limit', cfg: cfg2 }
  if (Number(cfg2.publishedHour || 0) >= Number(cfg2.maxPerHour || 2)) return { ok: false, reason: 'hour_limit', cfg: cfg2 }
  if (!hasImages && Number(cfg2.publishedToday || 0) >= 0) {
    // text-only daily cap checked against how many text posts — approximate via queue later; here soft check
  }
  const minInterval = Number(cfg2.minIntervalSec || 1800) * 1000
  const jitter = Math.floor(Math.random() * (Number(cfg2.intervalJitterSec || 600) + 1) * 1000)
  const earliest = Number(cfg2.lastPublishAt || 0) + minInterval + jitter
  const scheduledAt = Math.max(ts, earliest)
  return { ok: true, scheduledAt, cfg: cfg2 }
}

/**
 * 取消积压 pending；keepEventId 对应事件重置为 idle，便于立刻重新入队最新一条
 * @returns {Promise<number>}
 */
async function cancelPendingQueueJobs(reason = 'superseded_by_newer', keepEventId = '') {
  let total = 0
  const keep = keepEventId ? String(keepEventId) : ''
  for (let round = 0; round < 30; round++) {
    let rows = []
    try {
      const res = await db.collection(QUEUE_COL).where({ status: 'pending' }).limit(100).get()
      rows = res.data || []
    } catch (e) {
      console.warn('[cancelPendingQueueJobs]', e.message || e)
      break
    }
    if (!rows.length) break
    for (const row of rows) {
      try {
        await db.collection(QUEUE_COL).doc(row._id).update({
          data: {
            status: 'cancelled',
            lastError: reason,
            updatedAt: now()
          }
        })
        const ids = Array.isArray(row.eventIds) ? row.eventIds : []
        for (const eid of ids) {
          if (keep && String(eid) === keep) {
            await markEvents([eid], {
              bilibiliSyncStatus: 'idle',
              bilibiliLastError: '',
              bilibiliQueueId: ''
            })
          } else {
            await markEvents([eid], {
              bilibiliSyncStatus: 'skipped',
              bilibiliLastError: reason,
              bilibiliQueueId: ''
            })
          }
        }
        total++
      } catch (e) {
        console.warn('[cancelPendingQueueJobs] row', row._id, e.message || e)
      }
    }
  }
  if (total) console.log('[cancelPendingQueueJobs]', { total, reason, keepEventId: keep || undefined })
  return total
}

/** 拉取 syncFromAt 之后的事件，按 publishedAt 从新到旧 */
async function loadEventsNewestFirst(cfg, limit = 50) {
  const syncFromAt = Number(cfg.syncFromAt || 0)
  const lim = Math.max(1, Math.min(100, Number(limit) || 50))
  try {
    const res = await db
      .collection(EVENTS_COL)
      .where({
        status: 'published',
        publishedAt: _.gte(syncFromAt)
      })
      .orderBy('publishedAt', 'desc')
      .limit(lim)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('[loadEventsNewestFirst] compound query failed, fallback:', e.message || e)
    try {
      const res = await db
        .collection(EVENTS_COL)
        .where({ status: 'published' })
        .orderBy('publishedAt', 'desc')
        .limit(lim)
        .get()
      return (res.data || [])
        .filter((ev) => Number(ev.publishedAt || ev.createdAt || 0) >= syncFromAt)
        .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0))
    } catch (e2) {
      console.warn('[loadEventsNewestFirst] fallback failed:', e2.message || e2)
      const res = await db.collection(EVENTS_COL).where({ status: 'published' }).limit(lim).get()
      return (res.data || [])
        .filter((ev) => Number(ev.publishedAt || ev.createdAt || 0) >= syncFromAt)
        .sort((a, b) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0))
    }
  }
}

/**
 * 当时最新一条尚未成功发到 B 站的推文（已 success 的跳过）
 */
async function loadLatestPublishableEvent(cfg) {
  const list = await loadEventsNewestFirst(cfg, 50)
  return list.find((ev) => eventSyncStatus(ev) !== 'success') || null
}

async function loadRecentContents(windowSize) {
  const n = Math.max(1, Math.min(20, Number(windowSize) || 5))
  try {
    const res = await db
      .collection(QUEUE_COL)
      .where({ status: _.in(['pending', 'claimed', 'success']) })
      .orderBy('createdAt', 'desc')
      .limit(n)
      .get()
    return (res.data || []).map((r) => r.content || '')
  } catch (e) {
    return []
  }
}

async function markEvents(ids, patch) {
  for (const id of ids) {
    try {
      await db.collection(EVENTS_COL).doc(id).update({ data: { ...patch, updatedAt: now() } })
    } catch (e) {
      console.warn('[markEvents]', id, e.message || e)
    }
  }
}

async function enqueueOne(payload, scheduledAt) {
  const doc = {
    ...payload,
    status: 'pending',
    claimToken: '',
    claimedAt: 0,
    attempts: 0,
    lastError: '',
    scheduledAt,
    createdAt: now(),
    updatedAt: now(),
    resultDynamicId: ''
  }
  const res = await db.collection(QUEUE_COL).add({ data: doc })
  return res._id
}

async function ensureCollections() {
  for (const name of [QUEUE_COL, 'bilibili_topic_keywords', 'bilibili_topic_blacklist']) {
    try {
      await db.createCollection(name)
    } catch (e) {}
  }
}

async function runEnqueue(from = 'timer') {
  await ensureCollections()
  let cfg = await getConfig()
  const ts = now()

  if (!cfg.enabled) {
    console.log('[runEnqueue] skip disabled', { from })
    return { ok: true, skipped: true, reason: 'disabled', from }
  }
  if (Number(cfg.cooldownUntil || 0) > ts) {
    console.log('[runEnqueue] skip cooldown', { from, until: cfg.cooldownUntil })
    return { ok: true, skipped: true, reason: 'cooldown', until: cfg.cooldownUntil, from }
  }
  if (!Number(cfg.syncFromAt || 0)) {
    console.log('[runEnqueue] skip no_syncFromAt', { from })
    return { ok: true, skipped: true, reason: 'no_syncFromAt', from }
  }

  cfg = refreshQuotaCounters(cfg, ts)

  // 锁定「当时最新」未成功发送的事件，再清掉其余 pending（保留该事件可重入队）
  const ev = await loadLatestPublishableEvent(cfg)
  if (!ev) {
    const cancelledPending = await cancelPendingQueueJobs('superseded_by_newer')
    console.log('[runEnqueue] no latest publishable', { from, syncFromAt: cfg.syncFromAt, cancelledPending })
    return { ok: true, enqueued: 0, candidates: 0, cancelledPending, from }
  }

  // 若最新条已在 Agent 领取中，不重复入队，只清掉其它旧 pending
  if (eventSyncStatus(ev) === 'queued' || eventSyncStatus(ev) === 'merged') {
    // 下面 cancel 会把 keep 的 queued 重置为 idle；若仍有 claimed 任务对应此事件则由 Agent 完成
  }

  const cancelledPending = await cancelPendingQueueJobs('superseded_by_newer', ev._id)

  const recent = cfg.skipIfTooSimilar ? await loadRecentContents(cfg.similarWindow) : []
  let enqueued = 0
  let skippedSimilar = 0
  let skippedDeadImages = 0
  let droppedDeadImages = 0
  let blockedQuota = 0
  let blockedReason = ''

  const draft = await composeSingle(ev, cfg)

  // 入队前剔除已从 COS 删除的死图（旧事件清理会删文件），避免 Agent 下载 404 反复失败熔断
  if ((draft.images || []).length) {
    const { alive, dead } = await filterAliveImages(draft.images)
    if (dead.length) {
      droppedDeadImages = dead.length
      console.warn('[runEnqueue] drop dead images', JSON.stringify({ eventId: ev._id, dead }))
    }
    draft.images = alive
  }
  const bodyText = String(ev.content || ev.originalText || '').trim()

  if ((draft.images || []).length === 0 && droppedDeadImages > 0 && !bodyText) {
    // 图全部失效且没有正文可发：跳过该事件，流水线继续处理后续更新
    await markEvents([ev._id], { bilibiliSyncStatus: 'skipped', bilibiliLastError: 'dead_images' })
    skippedDeadImages++
  } else if (cfg.skipIfTooSimilar && recent.some((c) => similarEnough(c, draft.content))) {
    await markEvents([ev._id], { bilibiliSyncStatus: 'skipped', bilibiliLastError: 'too_similar' })
    skippedSimilar++
  } else {
    const hasImages = (draft.images || []).length > 0
    const sched = computeScheduledAt(cfg, hasImages)
    if (!sched.ok) {
      blockedQuota++
      blockedReason = sched.reason || 'quota'
    } else if (!hasImages && Number(sched.cfg.publishedToday || 0) >= Number(sched.cfg.textOnlyMaxPerDay || 3)) {
      blockedQuota++
      blockedReason = 'text_only_day_limit'
    } else {
      cfg = sched.cfg
      const queueId = await enqueueOne(draft, sched.scheduledAt)
      await markEvents([ev._id], {
        bilibiliSyncStatus: 'queued',
        bilibiliQueueId: queueId,
        bilibiliTopics: draft.topics || [],
        bilibiliLastError: ''
      })
      enqueued++
    }
  }

  await saveConfig({
    dayKey: cfg.dayKey,
    hourKey: cfg.hourKey,
    publishedToday: cfg.publishedToday,
    publishedHour: cfg.publishedHour,
    lastEnqueueAt: ts,
    lastEnqueueFrom: from,
    lastEnqueueResult:
      enqueued > 0
        ? 'enqueued'
        : blockedReason || (skippedSimilar ? 'similar' : skippedDeadImages ? 'dead_images' : 'empty')
  })

  const result = {
    ok: true,
    from,
    candidates: 1,
    enqueued,
    cancelledPending,
    skippedSimilar,
    skippedDeadImages,
    droppedDeadImages,
    blockedQuota,
    blockedReason: blockedReason || undefined,
    latestEventId: ev._id
  }
  console.log('[runEnqueue] done', JSON.stringify(result))
  return result
}

exports.main = async (event = {}) => {
  // 微信云开发定时触发器：Type=Timer / TriggerName；也兼容控制台与 callFunction
  const isTimer =
    event.Type === 'Timer' ||
    !!event.TriggerName ||
    !!event.triggerName ||
    event.scheduleAction === 'publishBilibili'
  const from =
    (event && event.from) ||
    (isTimer ? 'timer' : event.action === 'manual_trigger' ? 'admin' : 'manual')
  try {
    console.log('[publishBilibiliFromEvents] start', {
      from,
      isTimer,
      TriggerName: event.TriggerName || event.triggerName || '',
      Type: event.Type || ''
    })
    const result = await runEnqueue(from)
    return { code: 0, data: result }
  } catch (e) {
    console.error('[publishBilibiliFromEvents] error', e)
    return { code: 5000, message: e.message || String(e) }
  }
}

exports.runEnqueue = runEnqueue
exports.getConfig = getConfig
exports.DEFAULT_CONFIG = DEFAULT_CONFIG
