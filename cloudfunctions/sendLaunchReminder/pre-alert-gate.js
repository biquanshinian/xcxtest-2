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
 * 改期播报的「新时间可信」判定：TBD 的新时间或粗精度占位日期不播报。
 * 与 isLaunchPreAlertEligible 的差别：Hold(5) 放行——「暂停 + 时间后移」正是
 * 值得播报的真实推迟。
 */
function isNetChangeAnnouncable(launch) {
  var sid = launch && launch.statusId != null ? Number(launch.statusId) : 0
  if (sid === 2) return false
  if (isCoarseNetPrecision(launch && launch.netPrecision)) return false
  return true
}

module.exports = {
  isUncertainPreAlertStatusId,
  isCoarseNetPrecision,
  isLaunchPreAlertEligible,
  isNetChangeAnnouncable
}
