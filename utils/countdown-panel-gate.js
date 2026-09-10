/**
 * 倒计时大卡 / 副卡选型门控（纯函数，无 wx 依赖）。
 *
 * 口径对齐 sendLaunchReminder/pre-alert-gate：
 * 1) 2 TBD / 5 Hold 不可占主卡——NET 常是月末 00:00Z 占位或倒计时已暂停
 * 2) Day/Week/Month 等粗精度 NET 只是占位时刻，不可按时钟展示
 * 3) 8 TBC + Hour/Minute/Second 放行（中国发射 NOTAM 口径，时间通常可靠）
 * 4) status / precision 字段缺失时放行，避免误伤老列表缓存
 *
 * 列表「即将发射」不走本门控。
 */

/** LL2 未决态中不适合占倒计时大卡：2 TBD / 5 Hold（不含 8 TBC） */
function isUncertainPanelStatusId(id) {
  const n = id != null ? Number(id) : 0
  return n === 2 || n === 5
}

/** Day/Week/Month/Quarter/Half/Year/Decade 等粗精度 NET 只是占位时刻 */
function isCoarseNetPrecision(name) {
  const s = String(name || '').trim().toLowerCase()
  if (!s) return false
  return /^(day|week|month|quarter|half|year|decade)/.test(s)
}

function statusIdOf(mission, record) {
  if (record) {
    const raw =
      record.status && record.status.id != null
        ? record.status.id
        : record.statusId
    const rid = raw != null ? Number(raw) : 0
    if (Number.isFinite(rid) && rid > 0) return rid
  }
  if (!mission) return 0
  const sid = mission.statusId != null ? Number(mission.statusId) : 0
  return Number.isFinite(sid) && sid > 0 ? sid : 0
}

function precisionOf(mission, record) {
  if (record) {
    const fromRecord = record.netPrecision || record.net_precision
    if (fromRecord) return fromRecord
  }
  if (!mission) return ''
  return mission.netPrecision || mission.net_precision || ''
}

/**
 * 任务当前是否适合占倒计时大卡 / 重叠副卡。
 * @param {object|null} mission
 * @param {object|null} [record] _launchRecordsById 权威观测（可空）
 */
function isCountdownPanelEligible(mission, record) {
  if (!mission) return false
  if (isUncertainPanelStatusId(statusIdOf(mission, record))) return false
  if (isCoarseNetPrecision(precisionOf(mission, record))) return false
  return true
}

module.exports = {
  isUncertainPanelStatusId,
  isCoarseNetPrecision,
  isCountdownPanelEligible
}
