/**
 * SPACE_NOTICES_FEATURE — 条目「即将 / 历史」判定（纯函数）
 *
 * 以发射时刻为准，不用航警窗口结束时间。窗口可能比发射晚很多天，
 * 用 endMs 会把 7–8 月已飞的任务一直留在「即将 / 进行中」。
 */

const IN_FLIGHT_GRACE_MS = 6 * 60 * 60 * 1000
const ACTIVE_NOTICE_MS = 2 * 24 * 60 * 60 * 1000

function parseTimeMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const s = String(value).trim()
  if (!s) return 0
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
    ? s
    : (/^\d{4}-\d{2}-\d{2}T/.test(s) ? s + 'Z' : s)
  const n = Date.parse(iso)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function launchTimeMs(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  // 只用 NET / launchTime。windowStart 在老库里可能是航警窗口，不能当发射时刻。
  return parseTimeMs(row.net) || parseTimeMs(row.launchTime) || 0
}

function windowEndMs(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  return parseTimeMs(row.windowEnd) || parseTimeMs(row.launchWindowEnd) || 0
}

function statusBlob(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  return [row.statusName, row.statusAbbrev, row.statusCategory, row.status]
    .filter(Boolean)
    .join(' ')
}

function isInFlightStatus(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  if (Number(row.statusId) === 6) return true
  return /in\s*flight|飞行中|inflight/i.test(statusBlob(row))
}

function isTerminalLaunchStatus(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  const id = Number(row.statusId)
  if (id === 3 || id === 4 || id === 7 || id === 9) return true
  const blob = statusBlob(row)
  if (!blob) return false
  if (/payload\s*deployed|载荷已部署|已部署/i.test(blob)) return true
  if (/partial\s*(failure|success)|部分失败|部分失利|部分成功/i.test(blob)) return true
  if (/\bsuccess\b|succeeded|已成功|发射成功/i.test(blob)) return true
  if (/\bfailure\b|\bfailed\b|发射失败|失利/i.test(blob)) return true
  return false
}

/**
 * 即将 / 进行中 → false；历史 → true
 * 合集桶持续有效，不算历史。
 */
function computeEntryIsPast(entry, now) {
  const row = entry && typeof entry === 'object' ? entry : {}
  if (row.isCollection || /^collection-/i.test(String(row.entryKey || ''))) return false

  const at = Number.isFinite(now) ? now : Date.now()
  const start = launchTimeMs(row)
  const end = windowEndMs(row)

  // 首页 previous 只在发射时刻已过（或没有 NET）时强制历史；未来 NET 不被弱匹配带进历史
  if (row.homeBucket === 'previous' && (!start || start < at - IN_FLIGHT_GRACE_MS)) return true
  if (isTerminalLaunchStatus(row) && !isInFlightStatus(row)) return true

  if (row.homeBucket === 'upcoming') {
    if (isInFlightStatus(row)) return false
    if (start && start < at - IN_FLIGHT_GRACE_MS) return true
    return false
  }

  if (isInFlightStatus(row)) return false

  if (!start) return true

  if (start < at - IN_FLIGHT_GRACE_MS) {
    if (end && end >= at && at - start <= ACTIVE_NOTICE_MS) return false
    return true
  }
  return false
}

module.exports = {
  IN_FLIGHT_GRACE_MS,
  ACTIVE_NOTICE_MS,
  parseTimeMs,
  launchTimeMs,
  windowEndMs,
  isInFlightStatus,
  isTerminalLaunchStatus,
  computeEntryIsPast
}
