/**
 * B 站自动发文：配置 / 词库 / Agent 队列 API（供 adminGateway 挂载）
 */
const crypto = require('crypto')

const CONFIG_ID = 'bilibili_auto_publish'
const TOPICS_COL = 'bilibili_topic_keywords'
const BLACKLIST_COL = 'bilibili_topic_blacklist'
const QUEUE_COL = 'bilibili_publish_queue'
const EVENTS_COL = 'starship_event_updates'
const GLOBAL_COL = 'global_config'

const SEED_TOPICS = [
  { keyword: '星舰', topic: '星舰', aliases: ['Starship', 'starship'], priority: 100 },
  { keyword: 'SpaceX', topic: 'SpaceX', aliases: ['spacex'], priority: 100 },
  { keyword: '猎鹰9', topic: '猎鹰9', aliases: ['Falcon 9', 'Falcon9', 'F9'], priority: 90 },
  { keyword: '重型猎鹰', topic: '重型猎鹰', aliases: ['Falcon Heavy'], priority: 85 },
  { keyword: '星链', topic: '星链', aliases: ['Starlink', 'starlink'], priority: 90 },
  { keyword: '星港', topic: '星港', aliases: ['Starbase', 'starbase', 'Boca Chica'], priority: 90 },
  { keyword: 'NASA', topic: 'NASA', aliases: ['nasa'], priority: 80 },
  { keyword: '发射', topic: '航天发射', aliases: ['launch', 'Liftoff', 'liftoff'], priority: 70 },
  { keyword: '静态点火', topic: '静态点火', aliases: ['static fire', 'Static Fire'], priority: 75 },
  { keyword: '路封', topic: '星港动态', aliases: ['road closure', 'Road Closure', '封路'], priority: 70 },
  { keyword: 'NSF', topic: '航天资讯', aliases: ['NASASpaceflight'], priority: 60 },
  { keyword: 'Crew', topic: '载人航天', aliases: ['Crew Dragon', '龙飞船'], priority: 70 },
  { keyword: 'Dragon', topic: '龙飞船', aliases: ['Cargo Dragon'], priority: 70 },
  { keyword: '超重助推器', topic: '超重助推器', aliases: ['Super Heavy', 'Booster'], priority: 80 },
  { keyword: '热分离', topic: '星舰', aliases: ['hot staging'], priority: 75 },
  { keyword: '回收', topic: '火箭回收', aliases: ['landing', 'catch', 'chopsticks'], priority: 70 },
  { keyword: '阿波罗', topic: '航天史', aliases: ['Apollo'], priority: 50 },
  { keyword: '阿尔忒弥斯', topic: '阿尔忒弥斯', aliases: ['Artemis'], priority: 70 },
  { keyword: '火星', topic: '火星', aliases: ['Mars', 'mars'], priority: 80 },
  { keyword: '轨道试飞', topic: '星舰试飞', aliases: ['IFT', 'flight test'], priority: 85 }
]

const DEFAULT_CONFIG = {
  enabled: false,
  syncFromAt: 0,
  minIntervalSec: 1800,
  intervalJitterSec: 600,
  maxPerHour: 2,
  maxPerDay: 8,
  textOnlyMaxPerDay: 3,
  topicMax: 5,
  mergeBurstWindowMin: 60,
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

function createBilibiliPublishApi({ db, _, ok, fail, now, writeOpLog, cloud }) {
  function dayKeyOf(ts = now()) {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function hourKeyOf(ts = now()) {
    const d = new Date(ts)
    return `${dayKeyOf(ts)}T${String(d.getHours()).padStart(2, '0')}`
  }

  function refreshQuota(cfg, ts = now()) {
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

  async function ensureCols() {
    for (const name of [TOPICS_COL, BLACKLIST_COL, QUEUE_COL]) {
      try {
        await db.createCollection(name)
      } catch (e) {}
    }
  }

  async function readConfig() {
    try {
      const res = await db.collection(GLOBAL_COL).doc(CONFIG_ID).get()
      return refreshQuota({ ...DEFAULT_CONFIG, ...(res.data || {}) })
    } catch (e) {
      return refreshQuota({ ...DEFAULT_CONFIG })
    }
  }

  async function writeConfig(patch) {
    const data = { ...patch, updatedAt: now() }
    delete data._id
    delete data.health
    try {
      const existing = await db.collection(GLOBAL_COL).doc(CONFIG_ID).get().catch(() => null)
      if (existing && existing.data) {
        await db.collection(GLOBAL_COL).doc(CONFIG_ID).update({ data })
      } else {
        await db.collection(GLOBAL_COL).doc(CONFIG_ID).set({
          data: { ...DEFAULT_CONFIG, ...data }
        })
      }
    } catch (e) {
      // 若 update 因文档不存在失败，回退 set（仍不写 _id）
      try {
        const clean = { ...DEFAULT_CONFIG, ...data }
        delete clean._id
        delete clean.health
        await db.collection(GLOBAL_COL).doc(CONFIG_ID).set({ data: clean })
      } catch (e2) {
        return fail(5000, '保存配置失败: ' + (e2.message || e.message || e2))
      }
    }
    return ok(await readConfig())
  }

  async function getBilibiliAutoPublish() {
    await ensureCols()
    const cfg = await readConfig()
    let pendingQueue = 0
    try {
      const c = await db.collection(QUEUE_COL).where({ status: 'pending' }).count()
      pendingQueue = c.total || 0
    } catch (e) {}
    return ok({
      ...cfg,
      health: {
        enabled: !!cfg.enabled,
        cooling: Number(cfg.cooldownUntil || 0) > now(),
        cooldownUntil: cfg.cooldownUntil || 0,
        publishedToday: cfg.publishedToday || 0,
        publishedHour: cfg.publishedHour || 0,
        consecutiveFails: cfg.consecutiveFails || 0,
        lastError: cfg.lastError || '',
        lastPublishAt: cfg.lastPublishAt || 0,
        syncFromAt: cfg.syncFromAt || 0,
        pendingQueue
      }
    })
  }

  async function updateBilibiliAutoPublish(body, user) {
    await ensureCols()
    const before = await readConfig()
    const allowed = [
      'enabled',
      'minIntervalSec',
      'intervalJitterSec',
      'maxPerHour',
      'maxPerDay',
      'textOnlyMaxPerDay',
      'topicMax',
      'mergeBurstWindowMin',
      'skipIfTooSimilar',
      'similarWindow',
      'onRateLimitCooldownMin',
      'autoPauseAfterFails',
      'aiTopicEnabled',
      'aiTopicAutopromote',
      'aiPromoteMinSuggests',
      'footer',
      'alwaysTopics',
      'syncFromAt',
      'cooldownUntil',
      'consecutiveFails',
      'lastError'
    ]
    const patch = {}
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(body || {}, k)) patch[k] = body[k]
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      const turningOn = !!patch.enabled && !before.enabled
      if (turningOn && !Number(before.syncFromAt || 0) && !Number(patch.syncFromAt || 0)) {
        patch.syncFromAt = now()
      }
      if (!patch.enabled) {
        // 关闭时取消 pending
        try {
          const pend = await db.collection(QUEUE_COL).where({ status: 'pending' }).limit(50).get()
          for (const row of pend.data || []) {
            await db.collection(QUEUE_COL).doc(row._id).update({
              data: { status: 'cancelled', updatedAt: now() }
            })
          }
        } catch (e) {}
      }
    }

    if (Array.isArray(patch.alwaysTopics)) {
      patch.alwaysTopics = patch.alwaysTopics.map((t) => String(t || '').trim()).filter(Boolean)
    }

    const result = await writeConfig(patch)
    await writeOpLog({
      user,
      module: 'global_config',
      action: 'bilibili_auto_publish',
      targetId: CONFIG_ID,
      before,
      after: patch
    })
    return result
  }

  async function enqueueBilibiliNow(user) {
    try {
      // 手动触发：把仍 pending 的任务立刻可领，并把卡在 queued/merged 且队列已失败的事件重置
      const ts = now()
      try {
        const pend = await db.collection(QUEUE_COL).where({ status: 'pending' }).limit(50).get()
        for (const row of pend.data || []) {
          await db.collection(QUEUE_COL).doc(row._id).update({
            data: { scheduledAt: ts, updatedAt: ts }
          })
        }
        const failedQ = await db.collection(QUEUE_COL).where({ status: 'failed' }).limit(20).get()
        for (const row of failedQ.data || []) {
          for (const eid of row.eventIds || []) {
            try {
              await db.collection(EVENTS_COL).doc(eid).update({
                data: {
                  bilibiliSyncStatus: 'failed',
                  bilibiliLastError: row.lastError || 'queue_failed',
                  updatedAt: ts
                }
              })
            } catch (e) {}
          }
        }
        // 卡在 queued/merged 超过 10 分钟且无成功动态的，重置为 failed 以便重新入队
        const stuck = await db
          .collection(EVENTS_COL)
          .where({ bilibiliSyncStatus: _.in(['queued', 'merged']) })
          .limit(30)
          .get()
          .catch(() => ({ data: [] }))
        for (const ev of stuck.data || []) {
          const age = ts - Number(ev.updatedAt || ev.publishedAt || 0)
          if (age > 10 * 60 * 1000 && !ev.bilibiliDynamicId) {
            await db.collection(EVENTS_COL).doc(ev._id).update({
              data: {
                bilibiliSyncStatus: 'failed',
                bilibiliLastError: 'stuck_reset',
                updatedAt: ts
              }
            })
          }
        }
      } catch (e) {
        console.warn('[enqueueBilibiliNow] reset helpers', e.message || e)
      }

      const res = await cloud.callFunction({
        name: 'publishBilibiliFromEvents',
        data: { from: 'admin', action: 'manual_trigger' }
      })
      const payload = res.result || {}
      await writeOpLog({
        user,
        module: 'cloud_functions',
        action: 'trigger',
        targetId: 'publishBilibiliFromEvents',
        after: payload
      })
      const data = payload.data || payload
      return ok(data)
    } catch (e) {
      return fail(5001, '触发入队失败: ' + (e.message || e) + '（请确认已部署云函数 publishBilibiliFromEvents）')
    }
  }

  function normalizeTopic(raw) {
    return String(raw || '')
      .replace(/[#＃\s]/g, '')
      .slice(0, 12)
  }

  async function listTopics(query = {}) {
    await ensureCols()
    const status = String(query.status || 'active').trim()
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    let where = {}
    if (status && status !== 'all') where.status = status
    if (query.enabled === 'true') where.enabled = true
    if (query.enabled === 'false') where.enabled = false
    try {
      const col = db.collection(TOPICS_COL).where(where)
      const [countRes, listRes] = await Promise.all([
        col.count(),
        col.orderBy('priority', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
      ])
      return ok({ list: listRes.data || [], total: countRes.total || 0, page, pageSize })
    } catch (e) {
      const res = await db.collection(TOPICS_COL).where(where).limit(100).get()
      let list = res.data || []
      list.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      const total = list.length
      list = list.slice((page - 1) * pageSize, page * pageSize)
      return ok({ list, total, page, pageSize })
    }
  }

  async function createTopic(body, user) {
    await ensureCols()
    const topic = normalizeTopic(body.topic || body.keyword)
    const keyword = String(body.keyword || topic).trim()
    if (!topic || !keyword) return fail(4001, 'keyword/topic 不能为空')
    const payload = {
      keyword,
      topic,
      aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
      pattern: String(body.pattern || ''),
      enabled: body.enabled !== false,
      priority: Number(body.priority != null ? body.priority : 80),
      source: body.source || 'manual',
      status: body.status || 'active',
      hitCount: 0,
      suggestCount: 0,
      lastHitAt: 0,
      createdAt: now(),
      updatedAt: now(),
      createdBy: user.username
    }
    const res = await db.collection(TOPICS_COL).add({ data: payload })
    await writeOpLog({ user, module: 'global_config', action: 'bili_topic_create', targetId: res._id, after: payload })
    return ok({ id: res._id })
  }

  async function updateTopic(id, body, user) {
    if (!id) return fail(4001, 'id 不能为空')
    const beforeRes = await db.collection(TOPICS_COL).doc(id).get().catch(() => null)
    if (!beforeRes?.data) return fail(4040, '词条不存在')
    const patch = {}
    for (const k of ['keyword', 'topic', 'aliases', 'pattern', 'enabled', 'priority', 'status', 'source']) {
      if (Object.prototype.hasOwnProperty.call(body || {}, k)) patch[k] = body[k]
    }
    if (patch.topic) patch.topic = normalizeTopic(patch.topic)
    patch.updatedAt = now()
    await db.collection(TOPICS_COL).doc(id).update({ data: patch })
    await writeOpLog({
      user,
      module: 'global_config',
      action: 'bili_topic_update',
      targetId: id,
      before: beforeRes.data,
      after: patch
    })
    return ok(true)
  }

  async function deleteTopic(id, user) {
    if (!id) return fail(4001, 'id 不能为空')
    const beforeRes = await db.collection(TOPICS_COL).doc(id).get().catch(() => null)
    await db.collection(TOPICS_COL).doc(id).remove()
    await writeOpLog({
      user,
      module: 'global_config',
      action: 'bili_topic_delete',
      targetId: id,
      before: beforeRes?.data || null
    })
    return ok(true)
  }

  async function promoteTopic(id, user) {
    return updateTopic(id, { status: 'active', enabled: true, source: 'manual' }, user)
  }

  async function rejectTopic(id, user) {
    return updateTopic(id, { status: 'disabled', enabled: false }, user)
  }

  async function seedTopics(user) {
    await ensureCols()
    let imported = 0
    for (const s of SEED_TOPICS) {
      const exist = await db.collection(TOPICS_COL).where({ topic: s.topic }).limit(1).get()
      if ((exist.data || []).length) continue
      await db.collection(TOPICS_COL).add({
        data: {
          ...s,
          pattern: '',
          enabled: true,
          source: 'manual',
          status: 'active',
          hitCount: 0,
          suggestCount: 0,
          lastHitAt: 0,
          createdAt: now(),
          updatedAt: now(),
          createdBy: user.username
        }
      })
      imported++
    }
    await writeOpLog({
      user,
      module: 'global_config',
      action: 'bili_topic_seed',
      after: { imported }
    })
    return ok({ imported })
  }

  async function listBlacklist() {
    await ensureCols()
    const res = await db.collection(BLACKLIST_COL).limit(200).get()
    return ok({ list: res.data || [] })
  }

  async function addBlacklist(body, user) {
    await ensureCols()
    const word = normalizeTopic(body.word || body.topic)
    if (!word) return fail(4001, 'word 不能为空')
    const res = await db.collection(BLACKLIST_COL).add({
      data: { word, createdAt: now(), createdBy: user.username }
    })
    return ok({ id: res._id })
  }

  async function removeBlacklist(id) {
    if (!id) return fail(4001, 'id 不能为空')
    await db.collection(BLACKLIST_COL).doc(id).remove()
    return ok(true)
  }

  function verifyAgentToken(headers = {}) {
    const expected = String(process.env.BILI_AGENT_TOKEN || '').trim()
    if (!expected || expected.length < 16) return false
    const authHeader = headers.Authorization || headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    return !!token && token === expected
  }

  async function agentClaimJob(body = {}) {
    await ensureCols()
    const cfg = await readConfig()
    if (!cfg.enabled) return ok({ job: null, reason: 'disabled' })
    if (Number(cfg.cooldownUntil || 0) > now()) {
      return ok({ job: null, reason: 'cooldown', cooldownUntil: cfg.cooldownUntil })
    }

    const ts = now()
    const force = body && (body.force === true || body.force === 'true' || body.force === 1)

    // 回收超时未完成的 claimed（Agent 崩溃会留下僵尸任务）
    try {
      const stuck = await db.collection(QUEUE_COL).where({ status: 'claimed' }).limit(20).get()
      for (const row of stuck.data || []) {
        if (ts - Number(row.claimedAt || 0) > 10 * 60 * 1000) {
          await db.collection(QUEUE_COL).doc(row._id).update({
            data: {
              status: 'pending',
              claimToken: '',
              claimedAt: 0,
              scheduledAt: ts,
              updatedAt: ts,
              lastError: 'reclaimed_stale_claim'
            }
          })
        }
      }
    } catch (e) {}

    let job = null
    try {
      const res = await db
        .collection(QUEUE_COL)
        .where({ status: 'pending' })
        .orderBy('scheduledAt', 'asc')
        .limit(20)
        .get()
      const rows = res.data || []
      // force / 调试：忽略延后时间，直接领最早的 pending（发布脚本已修复时可立刻重试）
      job =
        rows.find((r) => force || Number(r.scheduledAt || 0) <= ts) ||
        (force ? rows[0] : null) ||
        null
      // 若都因 scheduledAt 未到而领不到，但存在 pending，则仍允许领取最早一条（避免卡死）
      if (!job && rows.length) {
        job = rows[0]
      }
    } catch (e) {
      const res = await db.collection(QUEUE_COL).where({ status: 'pending' }).limit(20).get()
      const rows = (res.data || []).sort(
        (a, b) => Number(a.scheduledAt || 0) - Number(b.scheduledAt || 0)
      )
      job = rows[0] || null
    }
    if (!job) return ok({ job: null, reason: 'empty' })

    const claimToken = crypto.randomBytes(16).toString('hex')
    await db.collection(QUEUE_COL).doc(job._id).update({
      data: {
        status: 'claimed',
        claimToken,
        claimedAt: ts,
        updatedAt: ts
      }
    })
    return ok({
      job: {
        id: job._id,
        claimToken,
        title: job.title,
        content: job.content,
        images: job.images || [],
        topics: job.topics || [],
        eventIds: job.eventIds || [],
        type: job.type,
        attempts: job.attempts || 0
      }
    })
  }

  async function agentCompleteJob(body) {
    const id = body.queueId || body.id
    const claimToken = body.claimToken || ''
    const dynamicId = String(body.dynamicId || body.bilibiliDynamicId || '')
    if (!id || !claimToken) return fail(4001, 'queueId/claimToken 必填')

    const ref = db.collection(QUEUE_COL).doc(id)
    const rowRes = await ref.get().catch(() => null)
    const row = rowRes?.data
    if (!row) return fail(4040, '任务不存在')
    if (row.claimToken !== claimToken) return fail(4030, 'claimToken 不匹配')

    const ts = now()
    await ref.update({
      data: {
        status: 'success',
        resultDynamicId: dynamicId,
        updatedAt: ts,
        lastError: ''
      }
    })

    for (const eid of row.eventIds || []) {
      try {
        await db.collection(EVENTS_COL).doc(eid).update({
          data: {
            bilibiliSyncStatus: 'success',
            bilibiliDynamicId: dynamicId,
            bilibiliSyncedAt: ts,
            bilibiliLastError: '',
            updatedAt: ts
          }
        })
      } catch (e) {}
    }

    let cfg = await readConfig()
    cfg = refreshQuota(cfg, ts)
    await writeConfig({
      lastPublishAt: ts,
      publishedToday: Number(cfg.publishedToday || 0) + 1,
      publishedHour: Number(cfg.publishedHour || 0) + 1,
      dayKey: cfg.dayKey,
      hourKey: cfg.hourKey,
      consecutiveFails: 0,
      lastError: ''
    })

    return ok(true)
  }

  async function agentFailJob(body) {
    const id = body.queueId || body.id
    const claimToken = body.claimToken || ''
    const errorType = String(body.errorType || 'other') // rate_limit | auth | captcha | other
    const message = String(body.message || body.error || 'failed')
    if (!id || !claimToken) return fail(4001, 'queueId/claimToken 必填')

    const ref = db.collection(QUEUE_COL).doc(id)
    const rowRes = await ref.get().catch(() => null)
    const row = rowRes?.data
    if (!row) return fail(4040, '任务不存在')
    if (row.claimToken !== claimToken) return fail(4030, 'claimToken 不匹配')

    const ts = now()
    let cfg = await readConfig()
    const attempts = Number(row.attempts || 0) + 1
    const maxAttempts = 3

    if (errorType === 'rate_limit') {
      const coolMin = Number(cfg.onRateLimitCooldownMin || 120)
      const cooldownUntil = ts + coolMin * 60 * 1000
      await ref.update({
        data: {
          status: 'pending',
          claimToken: '',
          claimedAt: 0,
          attempts,
          lastError: message,
          scheduledAt: cooldownUntil,
          updatedAt: ts
        }
      })
      await writeConfig({
        cooldownUntil,
        lastError: message,
        consecutiveFails: Number(cfg.consecutiveFails || 0) + 1
      })
      return ok({ action: 'cooldown', cooldownUntil })
    }

    if (errorType === 'auth' || errorType === 'captcha') {
      await ref.update({
        data: {
          status: 'pending',
          claimToken: '',
          claimedAt: 0,
          attempts,
          lastError: message,
          updatedAt: ts
        }
      })
      await writeConfig({
        enabled: false,
        lastError: message,
        consecutiveFails: Number(cfg.consecutiveFails || 0) + 1
      })
      return ok({ action: 'disabled' })
    }

    if (attempts >= maxAttempts) {
      await ref.update({
        data: {
          status: 'failed',
          claimToken: '',
          attempts,
          lastError: message,
          updatedAt: ts
        }
      })
      for (const eid of row.eventIds || []) {
        try {
          await db.collection(EVENTS_COL).doc(eid).update({
            data: {
              bilibiliSyncStatus: 'failed',
              bilibiliLastError: message,
              updatedAt: ts
            }
          })
        } catch (e) {}
      }
      const fails = Number(cfg.consecutiveFails || 0) + 1
      const patch = { consecutiveFails: fails, lastError: message }
      if (fails >= Number(cfg.autoPauseAfterFails || 3)) {
        patch.enabled = false
      }
      await writeConfig(patch)
      return ok({
        action: 'failed',
        autoPaused: Object.prototype.hasOwnProperty.call(patch, 'enabled') && patch.enabled === false
      })
    }

    await ref.update({
      data: {
        status: 'pending',
        claimToken: '',
        claimedAt: 0,
        attempts,
        lastError: message,
        scheduledAt: ts + 2 * 60 * 1000,
        updatedAt: ts
      }
    })
    await writeConfig({
      consecutiveFails: Number(cfg.consecutiveFails || 0) + 1,
      lastError: message
    })
    return ok({ action: 'retry_later', attempts })
  }

  return {
    CONFIG_ID,
    DEFAULT_CONFIG,
    verifyAgentToken,
    getBilibiliAutoPublish,
    updateBilibiliAutoPublish,
    enqueueBilibiliNow,
    listTopics,
    createTopic,
    updateTopic,
    deleteTopic,
    promoteTopic,
    rejectTopic,
    seedTopics,
    listBlacklist,
    addBlacklist,
    removeBlacklist,
    agentClaimJob,
    agentCompleteJob,
    agentFailJob
  }
}

module.exports = {
  createBilibiliPublishApi,
  CONFIG_ID,
  TOPICS_COL,
  BLACKLIST_COL,
  QUEUE_COL,
  DEFAULT_CONFIG,
  SEED_TOPICS
}
