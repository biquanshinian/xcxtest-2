/**
 * 「发射日历」红点摘要工具
 * 主包与分包共用，避免重复定义（主包不能同步 require 分包，故下沉到主包 util）。
 */

/** 本地记录的「已读」数据摘要存储 key（与当前快照比对决定是否显示红点） */
const LAUNCH_CALENDAR_ACK_SIG_KEY = '_launch_calendar_ack_missions_sig'

function djb2Hash(str) {
  let hash = 5381
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i)
    hash = hash | 0
  }
  return (hash >>> 0).toString(36)
}

/** 基于日历合并列表生成摘要，任一任务关键字段变化即变化 */
function computeLaunchCalendarSignature(missions) {
  const arr = Array.isArray(missions) ? missions : []
  if (!arr.length) return ''
  const rows = arr.map((m) => {
    if (!m) return ''
    const id = m.id != null ? String(m.id) : ''
    const net = String(m.net || m.launchTime || m.launch_time || m.formattedTime || '')
    const badge = String(m.statusBadgeText || m.statusCategory || '')
    const nm = String(m.missionName || m.name || '')
    return [id, net, badge, nm].join('\x1f')
  }).filter(Boolean).sort()
  const payload = rows.join('\x1e')
  return `${arr.length}:${djb2Hash(payload)}`
}

module.exports = {
  LAUNCH_CALENDAR_ACK_SIG_KEY,
  djb2Hash,
  computeLaunchCalendarSignature
}
