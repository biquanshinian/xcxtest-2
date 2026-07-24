/**
 * 发射状态权威模型（收敛约定）
 *
 * - 角标权威：只信 launch_status 观测（及同构的 normalizeLaunchObservation）。
 * - previous / upcoming / 详情缓存：只做 enrichment（图、垫、文案、序列）；其自带 status
 *   仅作 bootstrap，一旦有 store 观测就由 projectBadgeOntoMission 覆盖。
 * - 写入：hourly / resolve / detail-settle / updates(低优) → launch_status.merge
 * - 读取：列表与详情统一 observationFromMission → mergeLaunchObservation → projectBadgeOntoMission
 */
const { getStatusCategory, getStatusBadgeText } = require('./api-request.js')

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
  const status = value && value.status && typeof value.status === 'object' ? value.status : null
  const id = statusIdOf(value)
  const nameFromObj = status && status.name
  const nameFromScalar = value && typeof value.status === 'string' ? value.status : ''
  const abbrevFromObj = status && status.abbrev
  return {
    id,
    name: typeof nameFromObj === 'string' ? nameFromObj : nameFromScalar || '',
    abbrev: typeof abbrevFromObj === 'string' ? abbrevFromObj : (value && value.statusAbbrev) || ''
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
  const netMs = (() => {
    const raw = incoming.net || current.net || ''
    const t = raw ? new Date(raw).getTime() : NaN
    return Number.isFinite(t) ? t : NaN
  })()
  const netStillUpcoming = Number.isFinite(netMs) && netMs > Date.now()
  // NET 已过后禁止 resolve/detail 把飞行中打回 Go（详情缓存滞后）
  const blockInflightToPending =
    isInflightStatusId(currentId) && !isSettledStatusId(incomingId) && !netStillUpcoming
  const authoritativeCorrection =
    isRegression &&
    !blockInflightToPending &&
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
  return projectBadgeOntoMission(mission, record)
}

/**
 * 从 mission 卡片/详情抽出一条可归并的状态观测（无 statusId 则返回 null）。
 */
function observationFromMission(mission, defaults = {}) {
  if (!mission || mission.id == null) return null
  const sid = mission.statusId != null ? Number(mission.statusId) : 0
  if (!sid) return null
  return normalizeLaunchObservation(
    {
      id: mission.id,
      name: mission.name || mission.missionName || '',
      net: mission.launchTime || mission.net || '',
      windowStart: mission.windowStart || '',
      windowEnd: mission.windowEnd || '',
      status: {
        id: sid,
        name: mission.statusName || '',
        abbrev: mission.statusAbbrev || ''
      },
      source: mission._launchStateSource || defaults.source || 'list',
      sourcePriority: mission._launchStateSourcePriority || defaults.sourcePriority,
      observedAtMs: mission._launchStateObservedAtMs || defaults.observedAtMs,
      revision: mission._launchStateRevision
    },
    defaults
  )
}

/**
 * 用 store/观测投影角标到 mission。缓存行只提供 base enrichment。
 */
function projectBadgeOntoMission(mission, record) {
  if (!mission) return mission
  if (!record) return mission
  const status = normalizeStatus(record)
  if (!status.id && !status.name && !status.abbrev) return mission
  const statusObj = { id: status.id, name: status.name, abbrev: status.abbrev }
  const category = getStatusCategory(statusObj)
  const badge = getStatusBadgeText(statusObj, category)
  return {
    ...mission,
    launchTime: record.net || mission.launchTime,
    windowStart: record.windowStart || mission.windowStart,
    windowEnd: record.windowEnd || mission.windowEnd,
    status: badge,
    statusId: status.id || mission.statusId || null,
    statusAbbrev: status.abbrev || '',
    statusCategory: category,
    statusBadgeText: badge,
    success: category === 'success' || category === 'deployed',
    isPartialFailure: category === 'partial',
    isFailure: category === 'failure' || category === 'partial',
    _launchStateRevision: record.revision || mission._launchStateRevision || 0,
    _launchStateSource: record.source || mission._launchStateSource || '',
    _launchStateObservedAtMs: record.observedAtMs || mission._launchStateObservedAtMs || 0
  }
}

/**
 * 多源状态收敛：按 mergeLaunchObservation 规则选出权威观测，再投影角标。
 * @param {object} mission enrichment 底座（图/垫/文案）
 * @param {Array<object|null|undefined>} observations mission 卡片或已 normalize 的观测
 */
function applyAuthoritativeStatus(mission, observations, defaults) {
  if (!mission) return mission
  let current = null
  const list = Array.isArray(observations) ? observations : []
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]
    if (!raw) continue
    const looksNormalized =
      raw.id != null &&
      raw.status &&
      typeof raw.status === 'object' &&
      (raw.source != null || raw.observedAtMs != null || raw.sourcePriority != null)
    const incoming = looksNormalized
      ? normalizeLaunchObservation(raw, defaults)
      : observationFromMission(raw, defaults)
    if (!incoming) continue
    current = mergeLaunchObservation(current, incoming)
  }
  if (!current) return mission
  return projectBadgeOntoMission(mission, current)
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
  observationFromMission,
  projectBadgeOntoMission,
  applyAuthoritativeStatus,
  projectLaunchRecords
}
