const TERMINAL_STATUS_IDS = new Set([3, 4, 7, 9])
const INFLIGHT_STATUS_ID = 6

const SOURCE_PRIORITY = {
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
  fetchLaunchDetail_cached: 60,
  migration: 5
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

function statusIdOf(value) {
  if (!value) return 0
  const raw =
    value.statusId != null ? value.statusId : value.status && value.status.id != null ? value.status.id : value.id
  const id = Number(raw)
  return Number.isFinite(id) ? id : 0
}

function isTerminalStatusId(id) {
  return TERMINAL_STATUS_IDS.has(Number(id))
}

function isInflightStatusId(id) {
  return Number(id) === INFLIGHT_STATUS_ID
}

function isSettledStatusId(id) {
  return isTerminalStatusId(id) || isInflightStatusId(id)
}

function normalizeStatus(value) {
  const status = value && value.status ? value.status : value
  const id = statusIdOf(value)
  return {
    id,
    name: (status && status.name) || (value && value.status) || '',
    abbrev: (status && status.abbrev) || (value && value.statusAbbrev) || ''
  }
}

function normalizeLaunchObservation(value, defaults = {}) {
  if (!value || value.id == null) return null
  const observedAtMs =
    Number(value.observedAtMs || value.updatedAtMs || value.settledAtMs || defaults.observedAtMs) || Date.now()
  const source = String(value.source || defaults.source || 'list')
  const revision = Number(value.revision)
  return {
    id: String(value.id),
    name: value.name || value.missionName || '',
    net: value.net || value.launchTime || '',
    windowStart: value.windowStart || value.window_start || '',
    windowEnd: value.windowEnd || value.window_end || '',
    status: normalizeStatus(value),
    source,
    sourcePriority: sourcePriorityOf(source, value.sourcePriority),
    observedAtMs,
    revision: Number.isFinite(revision) ? revision : 0,
    correction: value.correction === true,
    payload: value.payload || null
  }
}

function compareObservation(incoming, current) {
  if (!current) return 1
  if (incoming.revision && current.revision && incoming.revision !== current.revision) {
    return incoming.revision > current.revision ? 1 : -1
  }
  if (incoming.observedAtMs !== current.observedAtMs) {
    return incoming.observedAtMs > current.observedAtMs ? 1 : -1
  }
  if (incoming.sourcePriority !== current.sourcePriority) {
    return incoming.sourcePriority > current.sourcePriority ? 1 : -1
  }
  return 0
}

function mergeLaunchObservation(currentValue, incomingValue, defaults) {
  const incoming = normalizeLaunchObservation(incomingValue, defaults)
  if (!incoming) return currentValue || null
  const current = currentValue ? normalizeLaunchObservation(currentValue) : null
  if (!current) return { ...incoming, revision: incoming.revision || 1 }

  const sameObservation =
    incoming.observedAtMs === current.observedAtMs &&
    incoming.source === current.source &&
    statusIdOf(incoming) === statusIdOf(current) &&
    incoming.name === current.name &&
    incoming.net === current.net &&
    incoming.windowStart === current.windowStart &&
    incoming.windowEnd === current.windowEnd
  if (sameObservation) {
    if (Number(currentValue.sourcePriority) !== incoming.sourcePriority) {
      return { ...current, sourcePriority: incoming.sourcePriority, revision: Number(currentValue.revision) || 0 }
    }
    return currentValue
  }

  const currentId = statusIdOf(current)
  const incomingId = statusIdOf(incoming)
  const order = compareObservation(incoming, current)
  const isRegression =
    (isTerminalStatusId(currentId) && !isTerminalStatusId(incomingId)) ||
    (isInflightStatusId(currentId) && !isSettledStatusId(incomingId))
  const authoritativeCorrection =
    isRegression &&
    incoming.observedAtMs >= current.observedAtMs &&
    incoming.sourcePriority >= SOURCE_PRIORITY.resolve &&
    incoming.sourcePriority > current.sourcePriority

  let acceptStatus = incoming.correction || authoritativeCorrection || (order >= 0 && !isRegression)

  const newerMetadata = order >= 0
  const next = {
    ...current,
    name: (newerMetadata && incoming.name) || current.name || incoming.name,
    net: (newerMetadata && incoming.net) || current.net || incoming.net,
    windowStart: (newerMetadata && incoming.windowStart) || current.windowStart || incoming.windowStart,
    windowEnd: (newerMetadata && incoming.windowEnd) || current.windowEnd || incoming.windowEnd,
    payload: (newerMetadata && incoming.payload) || current.payload || incoming.payload
  }
  if (acceptStatus) {
    next.status = incoming.status
    next.source = incoming.source
    next.sourcePriority = incoming.sourcePriority
    next.observedAtMs = incoming.observedAtMs
  }
  next.revision =
    Math.max(Number(current.revision) || 0, Number(incoming.revision) || 0) + (acceptStatus || newerMetadata ? 1 : 0)
  return next
}

function mergeObservationList(recordsById, observations, defaults) {
  const out = recordsById instanceof Map ? new Map(recordsById) : new Map()
  const list = Array.isArray(observations) ? observations : []
  for (let i = 0; i < list.length; i++) {
    const normalized = normalizeLaunchObservation(list[i], defaults)
    if (!normalized) continue
    out.set(normalized.id, mergeLaunchObservation(out.get(normalized.id), normalized))
  }
  return out
}

function applyRecordToMission(mission, record) {
  if (!mission || !record) return mission
  const status = normalizeStatus(record)
  return {
    ...mission,
    launchTime: record.net || mission.launchTime,
    windowStart: record.windowStart || mission.windowStart,
    windowEnd: record.windowEnd || mission.windowEnd,
    status: status.name || mission.status,
    statusId: status.id || mission.statusId,
    statusAbbrev: status.abbrev || mission.statusAbbrev,
    _launchStateRevision: record.revision || 0
  }
}

function projectLaunchRecords(options = {}) {
  const records = options.recordsById instanceof Map ? options.recordsById : new Map()
  const upcomingInput = Array.isArray(options.upcoming) ? options.upcoming : []
  const completedInput = Array.isArray(options.completed) ? options.completed : []
  const byId = new Map()
  completedInput.forEach((item) => {
    if (item && item.id != null) byId.set(String(item.id), item)
  })
  upcomingInput.forEach((item) => {
    if (item && item.id != null) byId.set(String(item.id), item)
  })

  const upcoming = []
  const completed = []
  const now = Number(options.now) || Date.now()
  byId.forEach((base, id) => {
    const record = records.get(id)
    const recordStatusId = record ? statusIdOf(record) : 0
    const effectiveNet = (record && record.net) || (base && (base.launchTime || base.net)) || ''
    const recordNetMs = effectiveNet ? new Date(effectiveNet).getTime() : 0
    // 终态/飞行中不可能发生在未来。若状态旁路误判了历史描述，忽略该状态，
    // 继续使用 upcoming 详情中的 Go/TBD 等权威字段。
    const ignoreFutureSettled =
      record && isSettledStatusId(recordStatusId) && Number.isFinite(recordNetMs) && recordNetMs > now
    let mission = record && !ignoreFutureSettled ? applyRecordToMission(base, record) : base
    let statusId = record && !ignoreFutureSettled ? recordStatusId : statusIdOf(mission)
    if (isSettledStatusId(statusId) && Number.isFinite(recordNetMs) && recordNetMs > now) {
      mission = {
        ...mission,
        status: '待定',
        statusId: null,
        statusAbbrev: '',
        statusCategory: 'unknown',
        statusBadgeText: '待定',
        success: false,
        isPartialFailure: false,
        isFailure: false
      }
      statusId = 0
    }
    if (isSettledStatusId(statusId)) completed.push(mission)
    else upcoming.push(mission)
  })

  const timeOf = (item) => new Date((item && (item.launchTime || item.net)) || 0).getTime() || 0
  upcoming.sort((a, b) => timeOf(a) - timeOf(b))
  completed.sort((a, b) => timeOf(b) - timeOf(a))
  const countdown = upcoming.find((item) => timeOf(item) > now) || null
  return { upcoming, completed, countdown }
}

module.exports = {
  TERMINAL_STATUS_IDS,
  INFLIGHT_STATUS_ID,
  SOURCE_PRIORITY,
  statusIdOf,
  isTerminalStatusId,
  isInflightStatusId,
  isSettledStatusId,
  normalizeLaunchObservation,
  mergeLaunchObservation,
  mergeObservationList,
  applyRecordToMission,
  projectLaunchRecords
}
