/**
 * 发射前推送状态门控（纯函数，无外部依赖，供单测直跑）。
 *
 * 背景：LL2 的 upcoming 里长期存在两类「不能当确切时间提醒」的条目：
 * 1) 状态 2 TBD（日期未定）/ 5 Hold（倒计时暂停）——TBD 的 NET 多为月末 00:00Z 占位，
 *    时间自然逼近进 [T-8, T-32] 发送窗时，会对「假时间」推送「即将发射」；
 * 2) net_precision 为 Day/Week/Month 等粗档——net 只是占位时刻。
 * 8 TBC（时间待官方确认）常见于中国发射且 NET 可靠（NOTAM 口径），放行。
 *
 * 使用方：
 * - shouldSendOaPreLaunchAlert（B 服务号模板 / C 订阅通知共用的窗口过滤与发送前复检）
 * - sendPendingReminders（A 小程序订阅消息发送门控）
 * - net-change-push（改期播报的「新时间可信」判定）
 */

/** 与 net-change-push / 首页改期弹窗近窗对齐 */
var NET_CHANGE_NEAR_WINDOW_MS = 48 * 60 * 60 * 1000

function parseNetMs(raw) {
  if (!raw) return 0
  var ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** 原 NET 已进入近窗（含已过）：临近任务的真实推迟，即便新时间变成 TBD/月末占位也要播报 */
function isNetChangeOldNetNear(oldIso, nowMs) {
  var oldMs = parseNetMs(oldIso)
  if (!oldMs) return false
  var now = Number(nowMs) || Date.now()
  return oldMs - now <= NET_CHANGE_NEAR_WINDOW_MS
}

/** LL2 未决态中不适合发「即将发射」的：2 TBD / 5 Hold */
function isUncertainPreAlertStatusId(id) {
  var n = id != null ? Number(id) : 0
  return n === 2 || n === 5
}

/** Day/Week/Month/Quarter/Half/Year/Decade 等粗精度 NET 只是占位时刻 */
function isCoarseNetPrecision(name) {
  var s = String(name || '').trim().toLowerCase()
  if (!s) return false
  return /^(day|week|month|quarter|half|year|decade)/.test(s)
}

/**
 * 新 NET 不可当确切时刻展示：TBD 或 Day/Month 等占位。
 * 嫦娥七号 Go→TBD + 9/30 Month 就是这种——官方只说窗口取消，LL2 用月末占位。
 */
function isUntrustedNetPlaceholder(launch) {
  var sid = launch && launch.statusId != null ? Number(launch.statusId) : 0
  if (sid === 2) return true
  return isCoarseNetPrecision(launch && launch.netPrecision)
}

/**
 * 任务当前是否适合发「发射前提醒」。
 * launch 需带 statusId / netPrecision（launch_data 文档或 resolveFreshLaunchMeta 结果）；
 * 字段缺失（旧文档）时放行，避免误伤存量数据。
 */
function isLaunchPreAlertEligible(launch) {
  if (!launch) return false
  if (isUncertainPreAlertStatusId(launch.statusId)) return false
  if (isCoarseNetPrecision(launch.netPrecision)) return false
  return true
}

/**
 * 改期播报的「新时间可信」判定。
 * - Hold(5) 放行：「暂停 + 时间后移」正是值得播报的真实推迟。
 * - 远期 TBD / Day·Month 占位不播报，避免把月末假日期推给用户。
 * - 例外：原 NET 已在 48h 近窗（含已过）时仍播报——嫦娥七号 Go→TBD、8/25→9/30
 *   Month 占位就是这种「临近任务被推迟」，不是远期噪音。
 *
 * @param {object} launch
 * @param {{ oldIso?: string, nowMs?: number }} [ctx]
 */
function isNetChangeAnnouncable(launch, ctx) {
  var oldIso = (ctx && ctx.oldIso) || (launch && launch.previousNet) || ''
  var nowMs = ctx && ctx.nowMs
  if (isNetChangeOldNetNear(oldIso, nowMs)) return true
  var sid = launch && launch.statusId != null ? Number(launch.statusId) : 0
  if (sid === 2) return false
  if (isCoarseNetPrecision(launch && launch.netPrecision)) return false
  return true
}

/** 近窗改期曾因 TBD 被清 pending、从未真正投递：7 天内仍视为可回收补推 */
var FALSE_SKIP_RECOVER_MS = 7 * 24 * 60 * 60 * 1000

function isRecoverableFalseSkip(launch, nowMs) {
  if (!launch || launch.netChangePending) return false
  var now = Number(nowMs) || Date.now()
  var changedAt = Number(launch.netChangedAt) || 0
  if (!changedAt || now - changedAt > FALSE_SKIP_RECOVER_MS) return false
  var oldIso = launch.previousNet || ''
  var newIso = launch.launchTime || ''
  var oldMs = parseNetMs(oldIso)
  var newMs = parseNetMs(newIso)
  if (!oldMs || !newMs || Math.abs(newMs - oldMs) < 60 * 1000) return false
  var nearOld = oldMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  var nearNew = newMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  if (!nearOld && !nearNew) return false
  return isNetChangeAnnouncable(launch, { oldIso: oldIso, nowMs: now })
}

module.exports = {
  NET_CHANGE_NEAR_WINDOW_MS,
  FALSE_SKIP_RECOVER_MS,
  isUncertainPreAlertStatusId,
  isCoarseNetPrecision,
  isLaunchPreAlertEligible,
  isNetChangeOldNetNear,
  isUntrustedNetPlaceholder,
  isNetChangeAnnouncable,
  isRecoverableFalseSkip
}
