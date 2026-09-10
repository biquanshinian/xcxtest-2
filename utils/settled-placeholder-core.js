/**
 * recent_settled → 历史列表的近窗瘦卡占位（搜索分包与首页 48h 规则对齐）。
 * 首页完整合并仍在 pages/index/utils/index-settled-merge.js，不把那份拉进搜索。
 */
const {
  getStatusCategory,
  getStatusBadgeText,
  isTerminalStatusId,
  getCountryDisplay
} = require('./api-request.js')
const { formatMissionListTimeOrUnknown } = require('./launch-card-i18n.js')

const SETTLED_PLACEHOLDER_NET_MAX_AGE_MS = 48 * 60 * 60 * 1000

function buildThinCompletedFromSettled(entry) {
  const statusObj = (entry && entry.status) || {}
  const category = getStatusCategory(statusObj)
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
  const countryDisplay = getCountryDisplay(null, null, { name })
  const badge = getStatusBadgeText(statusObj, category, {
    chineseRocket: countryDisplay === '中国',
    countryDisplay
  })
  return {
    id,
    name,
    missionName: missionName || name,
    rocketName: rocketName || '未知火箭',
    launchTime,
    formattedTime: launchTime ? formatMissionListTimeOrUnknown(launchTime) : '时间未知',
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
    countryDisplay,
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
    if (!Number.isFinite(netMs) || netMs < nowMs - SETTLED_PLACEHOLDER_NET_MAX_AGE_MS) continue
    inserts.push(buildThinCompletedFromSettled(s))
    presentIds.add(idStr)
  }
  return inserts.length ? inserts.concat(baseList) : baseList
}

module.exports = {
  mergeRecentSettledIntoCompletedList,
  buildThinCompletedFromSettled,
  SETTLED_PLACEHOLDER_NET_MAX_AGE_MS,
  PLACEHOLDER_NET_MAX_AGE_MS: SETTLED_PLACEHOLDER_NET_MAX_AGE_MS
}
