/**
 * 倒计时面板「窗口期状态机」：面板选型、停留（挂住）、探针编排的唯一规则源。
 *
 * 一切阶段均由「任务字段 + 权威状态记录(_launchRecordsById) + now」纯推导，
 * 不存隐藏状态——NET 改期后自动回 PRE_WINDOW，无需手动重置计时器。
 *
 * 阶段定义（derivePhase）：
 *   SETTLED     终态(3/4/7/9) 或飞行中(6)：任何时刻立即可落库，窗口不阻挡
 *   PRE_WINDOW  now < NET：正常倒计时
 *   IN_WINDOW   NET <= now <= holdUntil + GRACE：面板挂住，不允许被下一条未来任务顶掉
 *   POST_WINDOW now > holdUntil + GRACE 仍未决：释放挂住（有未来任务即让位），降频慢探
 *
 * holdUntil = windowEnd（有效且 > NET）；缺失/非法回退 NET + 30 分钟
 * （与首页 LIVE_STATUS_MAX_WAIT_MS 语义一致）。
 *
 * 状态证据优先级：权威观测记录 record（resolve/live/详情等已按来源合并）
 * 优先于列表行残留字段——upcoming 缓存里的旧 Go 不作数。
 */

const { isSettledStatusId, statusIdOf } = require('./launch-status-store.js')

const PHASE = {
  PRE_WINDOW: 'PRE_WINDOW',
  IN_WINDOW: 'IN_WINDOW',
  POST_WINDOW: 'POST_WINDOW',
  SETTLED: 'SETTLED'
}

/** 无 windowEnd 时的挂住时长（NET 起算） */
const WINDOW_HOLD_FALLBACK_MS = 30 * 60 * 1000
/** windowEnd 后的探针宽限：给 bestEffort 一次落库机会后才释放面板 */
const WINDOW_PROBE_GRACE_MS = 10 * 60 * 1000
/** LL2 状态滞后：T-0 后首查延时 */
const FIRST_CHECK_DELAY_MS = 10 * 60 * 1000
/** 窗口内复查间隔 */
const IN_WINDOW_RECHECK_MS = 3 * 60 * 1000
/** 窗口外（未决慢探 / 未过点常规）复查间隔 */
const POST_WINDOW_RECHECK_MS = 15 * 60 * 1000

function toMs(value) {
  if (!value) return NaN
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : NaN
}

/** 权威记录优先的有效 statusId；记录缺失时退回任务行字段 */
function getEffectiveStatusId(mission, record) {
  if (record) {
    const rid = statusIdOf(record)
    if (rid > 0) return rid
  }
  if (!mission) return 0
  const sid = mission.statusId != null ? Number(mission.statusId) : NaN
  if (Number.isFinite(sid) && sid > 0) return sid
  return 0
}

/** 记录缺 statusId 时，用 statusCategory 兜底判定「已可落库」 */
function isSettledByCategory(mission) {
  const cat = String((mission && mission.statusCategory) || '')
  return cat === 'success' || cat === 'failure' || cat === 'partial' || cat === 'deployed' || cat === 'inflight'
}

function isMissionSettled(mission, record) {
  const sid = getEffectiveStatusId(mission, record)
  if (sid > 0) return isSettledStatusId(sid)
  return isSettledByCategory(mission)
}

/** 权威记录优先的有效 NET（毫秒） */
function getEffectiveNetMs(mission, record) {
  const fromRecord = record ? toMs(record.net) : NaN
  if (Number.isFinite(fromRecord)) return fromRecord
  return toMs(mission && mission.launchTime)
}

/** 挂住截止：windowEnd（须晚于 NET）优先，否则 NET + 30m */
function getHoldUntilMs(mission, record) {
  const net = getEffectiveNetMs(mission, record)
  if (!Number.isFinite(net)) return NaN
  const windowEnd = (record && record.windowEnd) || (mission && mission.windowEnd) || ''
  const end = toMs(windowEnd)
  if (Number.isFinite(end) && end > net) return end
  return net + WINDOW_HOLD_FALLBACK_MS
}

/**
 * @param {object} mission 列表/面板任务行（launchTime/windowEnd/statusId/statusCategory）
 * @param {object|null} record _launchRecordsById 中的权威观测（可空）
 * @param {number} now
 * @returns {string} PHASE.*
 */
function derivePhase(mission, record, now = Date.now()) {
  if (!mission) return PHASE.POST_WINDOW
  if (isMissionSettled(mission, record)) return PHASE.SETTLED
  const net = getEffectiveNetMs(mission, record)
  if (!Number.isFinite(net)) return PHASE.PRE_WINDOW
  if (now < net) return PHASE.PRE_WINDOW
  const holdUntil = getHoldUntilMs(mission, record)
  if (Number.isFinite(holdUntil) && now <= holdUntil + WINDOW_PROBE_GRACE_MS) return PHASE.IN_WINDOW
  return PHASE.POST_WINDOW
}

function recordOf(recordsById, id) {
  if (!(recordsById instanceof Map) || id == null || id === '') return null
  return recordsById.get(String(id)) || null
}

/** 面板是否应挂住该任务（IN_WINDOW 且未决） */
function isPanelHoldActive(mission, record, now = Date.now()) {
  return derivePhase(mission, record, now) === PHASE.IN_WINDOW
}

/**
 * 面板选型唯一入口。
 * 优先级：
 *   1. 当前面板任务（holdMissionId）处于 IN_WINDOW → 继续挂住
 *   2. 列表头处于 IN_WINDOW → 挂住列表头
 *   3. 第一条 NET 在未来且未落库的任务
 *   4. 无未来任务时：头条 POST_WINDOW 未决任务继续展示（状态确认中），不空面板
 *   5. 全部落库/空列表 → null
 *
 * @param {Array} missions upcoming 升序列表（应已 peel 已落库任务；此处仍防御过滤）
 * @param {{ now?: number, holdMissionId?: string|number, recordsById?: Map }} options
 * @returns {{ mission: object|null, phase: string|null, reason: string }}
 */
function resolvePanelSelection(missions, options = {}) {
  const safeList = Array.isArray(missions) ? missions : []
  const now = options.now != null ? options.now : Date.now()
  const records = options.recordsById instanceof Map ? options.recordsById : null
  const holdId =
    options.holdMissionId != null && options.holdMissionId !== '' ? String(options.holdMissionId) : ''

  if (holdId) {
    const held = safeList.find((m) => m && String(m.id) === holdId)
    if (held) {
      const phase = derivePhase(held, recordOf(records, holdId), now)
      if (phase === PHASE.IN_WINDOW) return { mission: held, phase, reason: 'hold_current' }
    }
  }

  // 生效头条 = 第一条未落库任务（调用方应已 peel，此处防御跳过 SETTLED 残留行）
  for (let i = 0; i < safeList.length; i++) {
    const head = safeList[i]
    if (!head || head.id == null) continue
    const headPhase = derivePhase(head, recordOf(records, head.id), now)
    if (headPhase === PHASE.SETTLED) continue
    if (headPhase === PHASE.IN_WINDOW) return { mission: head, phase: headPhase, reason: 'hold_head' }
    break
  }

  let firstUnresolved = null
  let firstUnresolvedPhase = null
  for (let i = 0; i < safeList.length; i++) {
    const mission = safeList[i]
    if (!mission || mission.id == null) continue
    const record = recordOf(records, mission.id)
    const phase = derivePhase(mission, record, now)
    if (phase === PHASE.SETTLED) continue
    if (!firstUnresolved) {
      firstUnresolved = mission
      firstUnresolvedPhase = phase
    }
    if (phase === PHASE.PRE_WINDOW) return { mission, phase, reason: 'next_future' }
  }

  if (firstUnresolved) {
    return { mission: firstUnresolved, phase: firstUnresolvedPhase, reason: 'unresolved_fallback' }
  }
  return { mission: null, phase: null, reason: 'empty' }
}

/** 兼容旧调用形态：直接返回 mission（或 null） */
function resolvePanelMission(missions, options = {}) {
  return resolvePanelSelection(missions, options).mission
}

/**
 * 探针决策（只围绕临近任务的窗口期）：
 *   PRE_WINDOW  → none（不探针）
 *   IN_WINDOW   → NET+10m 前 wait；holdUntil 前 probeById（3m 间隔）；
 *                 holdUntil 过后（宽限内）bestEffort
 *   POST_WINDOW → slowProbe（15m 间隔，直至落库）
 *   SETTLED     → settle（立即落库切换）
 *
 * @param {object} mission
 * @param {object|null} record
 * @param {number} now
 * @returns {{ action: 'none'|'wait'|'probeById'|'bestEffort'|'slowProbe'|'settle', delayMs: number }}
 */
function nextProbeAction(mission, record, now = Date.now()) {
  const phase = derivePhase(mission, record, now)
  if (phase === PHASE.SETTLED) return { action: 'settle', delayMs: 0 }
  if (phase === PHASE.PRE_WINDOW) return { action: 'none', delayMs: 0 }

  const net = getEffectiveNetMs(mission, record)
  const holdUntil = getHoldUntilMs(mission, record)

  if (phase === PHASE.IN_WINDOW) {
    const firstCheckAt = (Number.isFinite(net) ? net : now) + FIRST_CHECK_DELAY_MS
    if (now < firstCheckAt) {
      return { action: 'wait', delayMs: Math.max(1000, firstCheckAt - now) }
    }
    if (Number.isFinite(holdUntil) && now >= holdUntil) {
      return { action: 'bestEffort', delayMs: 0 }
    }
    return { action: 'probeById', delayMs: IN_WINDOW_RECHECK_MS }
  }

  return { action: 'slowProbe', delayMs: POST_WINDOW_RECHECK_MS }
}

/** 任务发射窗口区间 [NET, holdUntil]；非法返回 null */
function getMissionWindowInterval(mission, record) {
  const net = getEffectiveNetMs(mission, record)
  if (!Number.isFinite(net)) return null
  const holdUntil = getHoldUntilMs(mission, record)
  if (!Number.isFinite(holdUntil)) return null
  return { start: net, end: holdUntil }
}

function windowsOverlap(a, b) {
  if (!a || !b) return false
  return a.start < b.end && b.start < a.end
}

/**
 * 与主倒计时面板窗口重叠的下一条未决任务（副卡）。
 * 规则：仅窗口相交才返回；主卡落库顶上后，对新主卡再查下一轮重叠（依次排队）；
 * 无重叠则返回 null（副卡消失）。forceNext 仅单测用，正式路径禁止。
 *
 * @param {Array} missions
 * @param {{
 *   panelMissionId?: string|number,
 *   panelMission?: object|null,
 *   recordsById?: Map,
 *   now?: number,
 *   forceNext?: boolean
 * }} options
 * @returns {object|null}
 */
function resolveOverlapSideMission(missions, options = {}) {
  const safeList = Array.isArray(missions) ? missions : []
  const records = options.recordsById instanceof Map ? options.recordsById : null
  const panelId =
    options.panelMissionId != null && options.panelMissionId !== '' ? String(options.panelMissionId) : ''
  if (!panelId) return null

  const panelFromList = safeList.find((m) => m && String(m.id) === panelId) || null
  const panelMission = panelFromList || options.panelMission || null

  const candidates = []
  for (let i = 0; i < safeList.length; i++) {
    const mission = safeList[i]
    if (!mission || mission.id == null) continue
    if (String(mission.id) === panelId) continue
    if (isMissionSettled(mission, recordOf(records, mission.id))) continue
    candidates.push(mission)
  }
  if (!candidates.length) return null

  if (options.forceNext) {
    const panelNet = getEffectiveNetMs(panelMission, recordOf(records, panelId))
    if (Number.isFinite(panelNet)) {
      const next = candidates.find((m) => {
        const net = getEffectiveNetMs(m, recordOf(records, m.id))
        return Number.isFinite(net) && net > panelNet
      })
      if (next) return next
    }
    return candidates[0]
  }

  if (!panelMission || isMissionSettled(panelMission, recordOf(records, panelId))) return null
  const panelIv = getMissionWindowInterval(panelMission, recordOf(records, panelId))
  if (!panelIv) return null

  for (let i = 0; i < candidates.length; i++) {
    const mission = candidates[i]
    const iv = getMissionWindowInterval(mission, recordOf(records, mission.id))
    if (iv && windowsOverlap(panelIv, iv)) return mission
  }
  return null
}

module.exports = {
  PHASE,
  WINDOW_HOLD_FALLBACK_MS,
  WINDOW_PROBE_GRACE_MS,
  FIRST_CHECK_DELAY_MS,
  IN_WINDOW_RECHECK_MS,
  POST_WINDOW_RECHECK_MS,
  getEffectiveStatusId,
  getEffectiveNetMs,
  getHoldUntilMs,
  getMissionWindowInterval,
  windowsOverlap,
  isMissionSettled,
  derivePhase,
  isPanelHoldActive,
  resolvePanelSelection,
  resolvePanelMission,
  resolveOverlapSideMission,
  nextProbeAction
}
