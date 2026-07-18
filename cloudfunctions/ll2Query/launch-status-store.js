const COLLECTION = 'launch_status'
const TERMINAL_IDS = { 3: true, 4: true, 7: true, 9: true }
const INFLIGHT_ID = 6
const SOURCE_PRIORITY = {
  migration: 5,
  list: 10,
  updates: 20,
  ll2_updates: 20,
  fetchLaunchDetail_updates: 20,
  live: 30,
  fetchLaunchStatuses: 30,
  hourly_probe: 40,
  launch_net_hourly: 40,
  resolve: 50,
  resolveLaunchStatuses: 50,
  detail: 60,
  fetchLaunchDetail_status: 60,
  fetchLaunchDetail_cached: 60
}

function sourcePriorityOf(source, explicitPriority) {
  const explicit = Number(explicitPriority)
  if (explicit > 0) return explicit
  const key = String(source || '')
  if (SOURCE_PRIORITY[key]) return SOURCE_PRIORITY[key]
  if (key.startsWith('launch_net_hourly')) return SOURCE_PRIORITY.launch_net_hourly
  if (key.startsWith('resolveLaunchStatuses')) return SOURCE_PRIORITY.resolveLaunchStatuses
  if (key.startsWith('ll2_updates')) return SOURCE_PRIORITY.ll2_updates
  if (key.startsWith('fetchLaunchDetail_')) return SOURCE_PRIORITY.detail
  return 0
}

function statusId(row) {
  const raw = row && row.status && row.status.id != null ? row.status.id : row && row.statusId
  const id = Number(raw)
  return Number.isFinite(id) ? id : 0
}

function normalize(row, defaults) {
  if (!row || row.id == null) return null
  const d = defaults || {}
  const source = String(row.source || d.source || 'list')
  const status = row.status || {}
  return {
    id: String(row.id),
    name: row.name || row.missionName || '',
    net: row.net || row.launchTime || '',
    windowStart: row.windowStart || row.window_start || '',
    windowEnd: row.windowEnd || row.window_end || '',
    status: {
      id: statusId(row),
      name: status.name || row.statusName || '',
      abbrev: status.abbrev || row.statusAbbrev || ''
    },
    source,
    sourcePriority: sourcePriorityOf(source, row.sourcePriority),
    observedAtMs: Number(row.observedAtMs || row.updatedAtMs || row.settledAtMs || d.observedAtMs) || Date.now(),
    revision: Number(row.revision) || 0,
    correction: row.correction === true,
    updateComment: row.updateComment || '',
    updateInfoUrl: row.updateInfoUrl || ''
  }
}

function merge(current, value, defaults) {
  const incoming = normalize(value, defaults)
  if (!incoming) return current || null
  if (!current) return { ...incoming, revision: incoming.revision || 1 }
  const existing = normalize(current)
  const sameObservation =
    incoming.observedAtMs === existing.observedAtMs &&
    incoming.source === existing.source &&
    statusId(incoming) === statusId(existing) &&
    incoming.name === existing.name &&
    incoming.net === existing.net &&
    incoming.windowStart === existing.windowStart &&
    incoming.windowEnd === existing.windowEnd &&
    incoming.updateComment === existing.updateComment &&
    incoming.updateInfoUrl === existing.updateInfoUrl
  if (sameObservation) {
    if (Number(current.sourcePriority) !== incoming.sourcePriority) {
      return { ...existing, sourcePriority: incoming.sourcePriority, revision: Number(current.revision) || 0 }
    }
    return current
  }
  const oldId = statusId(existing)
  const newId = statusId(incoming)
  const oldSettled = !!TERMINAL_IDS[oldId] || oldId === INFLIGHT_ID
  const newSettled = !!TERMINAL_IDS[newId] || newId === INFLIGHT_ID
  const older =
    incoming.observedAtMs < existing.observedAtMs ||
    (incoming.observedAtMs === existing.observedAtMs && incoming.sourcePriority < existing.sourcePriority)
  const regression = oldSettled && !newSettled
  if (older && !incoming.correction) {
    if (Number(current.sourcePriority) !== existing.sourcePriority) {
      return { ...existing, sourcePriority: existing.sourcePriority, revision: Number(current.revision) || 0 }
    }
    return current
  }
  // resolve/detail 是 LL2 当前 status 的直接读数。它们可以修正低优先级
  // updates 文案推断出的错误终态，否则一次误判会永久锁死在终态。
  const authoritativeCorrection =
    regression &&
    !older &&
    incoming.sourcePriority >= SOURCE_PRIORITY.resolve &&
    incoming.sourcePriority > existing.sourcePriority
  const accept = incoming.correction || authoritativeCorrection || (!older && !regression)
  const next = {
    ...existing,
    name: (!older && incoming.name) || existing.name,
    net: (!older && incoming.net) || existing.net,
    windowStart: (!older && incoming.windowStart) || existing.windowStart,
    windowEnd: (!older && incoming.windowEnd) || existing.windowEnd,
    revision: (Number(existing.revision) || 0) + 1
  }
  if (accept) {
    next.status = incoming.status
    next.source = incoming.source
    next.sourcePriority = incoming.sourcePriority
    next.observedAtMs = incoming.observedAtMs
    next.correction = incoming.correction
    next.updateComment = incoming.updateComment || existing.updateComment || ''
    next.updateInfoUrl = incoming.updateInfoUrl || existing.updateInfoUrl || ''
  }
  return next
}

function createLaunchStatusStore(db) {
  const collection = db.collection(COLLECTION)

  async function upsertOne(value, defaults) {
    const incoming = normalize(value, defaults)
    if (!incoming) return null
    if (typeof db.runTransaction === 'function') {
      return db.runTransaction(async (transaction) => {
        const doc = transaction.collection(COLLECTION).doc(incoming.id)
        let current = null
        try {
          const result = await doc.get()
          current = result && result.data
        } catch (e) {}
        const next = merge(current, incoming)
        if (next === current) return current
        await doc.set({ data: { ...next, updatedAt: db.serverDate(), updatedAtMs: Date.now() } })
        return next
      })
    }
    let current = null
    try {
      const result = await collection.doc(incoming.id).get()
      current = result && result.data
    } catch (e) {}
    const next = merge(current, incoming)
    if (next === current) return current
    await collection.doc(incoming.id).set({ data: { ...next, updatedAt: db.serverDate(), updatedAtMs: Date.now() } })
    return next
  }

  async function upsertMany(values, defaults) {
    const list = Array.isArray(values) ? values : []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const row = await upsertOne(list[i], defaults)
      if (row) out.push(row)
    }
    return out
  }

  async function getByIds(ids) {
    const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)))
    const rows = await Promise.all(
      unique.map(async (id) => {
        try {
          const result = await collection.doc(id).get()
          return result && result.data ? result.data : null
        } catch (e) {
          return null
        }
      })
    )
    return rows.filter(Boolean)
  }

  async function getRecent(limit) {
    try {
      const result = await collection
        .orderBy('observedAtMs', 'desc')
        .limit(Math.min(100, Number(limit) || 40))
        .get()
      return result && result.data ? result.data : []
    } catch (e) {
      return []
    }
  }

  return { upsertOne, upsertMany, getByIds, getRecent }
}

module.exports = { COLLECTION, TERMINAL_IDS, INFLIGHT_ID, normalize, merge, createLaunchStatusStore }
