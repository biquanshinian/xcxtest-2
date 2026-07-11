/**
 * 定时扫 starship_event_updates → bilibili_publish_queue
 * 总开关：global_config / bilibili_auto_publish
 */
const cloud = require('wx-server-sdk')
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
    topics
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

async function loadCandidates(cfg) {
  const syncFromAt = Number(cfg.syncFromAt || 0)
  let list = []
  try {
    const res = await db
      .collection(EVENTS_COL)
      .where({
        status: 'published',
        publishedAt: _.gte(syncFromAt)
      })
      .orderBy('publishedAt', 'asc')
      .limit(50)
      .get()
    list = res.data || []
  } catch (e) {
    console.warn('[loadCandidates] compound query failed, fallback:', e.message || e)
    try {
      const res = await db
        .collection(EVENTS_COL)
        .where({ status: 'published' })
        .orderBy('publishedAt', 'desc')
        .limit(50)
        .get()
      list = (res.data || [])
        .filter((ev) => Number(ev.publishedAt || ev.createdAt || 0) >= syncFromAt)
        .sort((a, b) => Number(a.publishedAt || 0) - Number(b.publishedAt || 0))
    } catch (e2) {
      console.warn('[loadCandidates] fallback failed:', e2.message || e2)
      const res = await db.collection(EVENTS_COL).where({ status: 'published' }).limit(50).get()
      list = (res.data || [])
        .filter((ev) => Number(ev.publishedAt || ev.createdAt || 0) >= syncFromAt)
        .sort((a, b) => Number(a.publishedAt || 0) - Number(b.publishedAt || 0))
    }
  }
  return list.filter((ev) => {
    const st = eventSyncStatus(ev)
    return st === 'idle' || st === 'failed' || !ev.bilibiliSyncStatus
  })
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
    return { ok: true, skipped: true, reason: 'disabled', from }
  }
  if (Number(cfg.cooldownUntil || 0) > ts) {
    return { ok: true, skipped: true, reason: 'cooldown', until: cfg.cooldownUntil, from }
  }
  if (!Number(cfg.syncFromAt || 0)) {
    return { ok: true, skipped: true, reason: 'no_syncFromAt', from }
  }

  cfg = refreshQuotaCounters(cfg, ts)
  const candidates = await loadCandidates(cfg)
  if (!candidates.length) {
    return { ok: true, enqueued: 0, candidates: 0, from }
  }

  const recent = cfg.skipIfTooSimilar ? await loadRecentContents(cfg.similarWindow) : []
  let enqueued = 0
  let skippedSimilar = 0
  let blockedQuota = 0

  // 每条事件单独入队，绝不合并（每轮仍只入 1 条，配合限流）
  for (const ev of candidates) {
    const draft = await composeSingle(ev, cfg)

    if (cfg.skipIfTooSimilar && recent.some((c) => similarEnough(c, draft.content))) {
      await markEvents([ev._id], { bilibiliSyncStatus: 'skipped', bilibiliLastError: 'too_similar' })
      skippedSimilar++
      continue
    }

    const hasImages = (draft.images || []).length > 0
    const sched = computeScheduledAt(cfg, hasImages)
    if (!sched.ok) {
      blockedQuota++
      break
    }
    cfg = sched.cfg

    if (!hasImages) {
      if (Number(cfg.publishedToday || 0) >= Number(cfg.textOnlyMaxPerDay || 3)) {
        blockedQuota++
        continue
      }
    }

    if (enqueued >= 1) break

    const queueId = await enqueueOne(draft, sched.scheduledAt)
    await markEvents([ev._id], {
      bilibiliSyncStatus: 'queued',
      bilibiliQueueId: queueId,
      bilibiliTopics: draft.topics || [],
      bilibiliLastError: ''
    })
    recent.unshift(draft.content)
    enqueued++
  }

  await saveConfig({
    dayKey: cfg.dayKey,
    hourKey: cfg.hourKey,
    publishedToday: cfg.publishedToday,
    publishedHour: cfg.publishedHour
  })

  return {
    ok: true,
    from,
    candidates: candidates.length,
    enqueued,
    skippedSimilar,
    blockedQuota
  }
}

exports.main = async (event = {}) => {
  const from = (event && event.from) || (event.Type === 'Timer' ? 'timer' : 'manual')
  try {
    const result = await runEnqueue(from)
    console.log('[publishBilibiliFromEvents]', JSON.stringify(result))
    return { code: 0, data: result }
  } catch (e) {
    console.error('[publishBilibiliFromEvents] error', e)
    return { code: 5000, message: e.message || String(e) }
  }
}

exports.runEnqueue = runEnqueue
exports.getConfig = getConfig
exports.DEFAULT_CONFIG = DEFAULT_CONFIG
