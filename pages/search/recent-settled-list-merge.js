/**
 * 将 recent_settled 终态补进历史列表（搜索分包内复用）。
 * 与首页 _mergeRecentSettledIntoCompletedList 的「无 base 仅 48h 终态占位」规则对齐。
 */
const {
  getStatusCategory,
  getStatusBadgeText,
  isTerminalStatusId,
  getCountryDisplay
} = require('../../utils/api-request.js')
const { formatDate } = require('../../utils/util.js')

const PLACEHOLDER_NET_MAX_AGE_MS = 48 * 60 * 60 * 1000

function buildThinCompletedFromSettled(entry) {
  const statusObj = (entry && entry.status) || {}
  const category = getStatusCategory(statusObj)
  const badge = getStatusBadgeText(statusObj, category)
  const name = (entry && entry.name) || ''
  const parts = String(name)
    .split('|')
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  const launchTime = (entry && entry.net) || ''
  const sid = statusObj.id != null ? Number(statusObj.id) : null
  const id = entry.id
  const rocketName = parts[0] || ''
  const missionName = parts[1] || ''
  return {
    id,
    name,
    missionName: missionName || name,
    rocketName: rocketName || '未知火箭',
    launchTime,
    formattedTime: launchTime ? formatDate(launchTime, 'MM月DD日 HH:mm') : '时间未知',
    status: badge,
    statusId: sid,
    statusAbbrev: statusObj.abbrev || '',
    statusCategory: category,
    statusBadgeText: badge,
    success: category === 'success' || category === 'deployed',
    isPartialFailure: category === 'partial',
    isFailure: category === 'failure' || category === 'partial',
    missionDescription: '',
    padLocation: '',
    // 结算行无 pad/服务商，用「火箭 | 任务」文本兜底推断国家
    countryDisplay: getCountryDisplay(null, null, { name }),
    isExpired: false,
    _optimisticSettled: true,
    _fromRecentSettled: true,
    _detailType: 'completed',
    _detailUrl: `/pages/mission-detail/mission-detail?id=${encodeURIComponent(String(id || ''))}&type=completed`
  }
}

function mergeRecentSettledIntoCompletedList(list, settled) {
  const baseList = Array.isArray(list) ? list : []
  const rows = Array.isArray(settled) ? settled : []
  if (!rows.length) return baseList

  const presentIds = new Set()
  for (let i = 0; i < baseList.length; i++) {
    const item = baseList[i]
    if (item && item.id != null) presentIds.add(String(item.id))
  }

  const nowMs = Date.now()
  const inserts = []
  const sorted = rows.slice().sort(
    (a, b) =>
      (Number(b.settledAtMs) || Number(b.observedAtMs) || 0) -
      (Number(a.settledAtMs) || Number(a.observedAtMs) || 0)
  )
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    if (!s || s.id == null || !s.status) continue
    const idStr = String(s.id)
    if (presentIds.has(idStr)) continue
    const sid = s.status.id != null ? Number(s.status.id) : 0
    if (!isTerminalStatusId(sid)) continue
    const netMs = s.net ? new Date(s.net).getTime() : NaN
    if (Number.isFinite(netMs) && netMs > nowMs) continue
    if (!Number.isFinite(netMs) || netMs < nowMs - PLACEHOLDER_NET_MAX_AGE_MS) continue
    inserts.push(buildThinCompletedFromSettled(s))
    presentIds.add(idStr)
  }
  return inserts.length ? inserts.concat(baseList) : baseList
}

module.exports = {
  mergeRecentSettledIntoCompletedList,
  buildThinCompletedFromSettled,
  PLACEHOLDER_NET_MAX_AGE_MS
}
