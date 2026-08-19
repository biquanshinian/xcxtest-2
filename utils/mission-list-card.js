/**
 * 历史/即将发射列表卡完整度：占位识别、从 LL2 name 拆火箭、同 id 选更完整的卡。
 * 终态 previous stub 常缺 rocket.configuration / pad，映射成 Unknown rocket / 未知地点；
 * 详情页走 detailed 所以正常。列表合并时必须跳过占位，不能让瘦卡盖掉完整卡。
 */

const PLACEHOLDER_FIELD_RE =
  /^(未知|未知火箭|未知地点|未知任务|未知载荷|未知有效载荷|待定|TBD|N\/A|-|—|unknown( rocket| location| launch site| mission| payload)?)$/i

function isPlaceholderMissionField(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return true
  return PLACEHOLDER_FIELD_RE.test(s)
}

function parseRocketMissionFromLaunchName(name) {
  const parts = String(name || '')
    .split('|')
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { rocketName: parts[0], missionName: parts.slice(1).join(' | ') }
  }
  return { rocketName: '', missionName: parts[0] || '' }
}

function scoreMissionCardCompleteness(item) {
  if (!item) return 0
  let score = 0
  if (!isPlaceholderMissionField(item.rocketName)) score += 4
  if (
    !isPlaceholderMissionField(item.padLocation) ||
    !isPlaceholderMissionField(item.launchSite)
  ) {
    score += 4
  }
  if (!isPlaceholderMissionField(item.countryDisplay)) score += 1
  if (item.rocketImage || item.image) score += 2
  const cfg = item.rocketConfiguration
  if (cfg && (cfg.name || cfg.full_name)) score += 2
  if (item.boosterInfo) score += 1
  if (Array.isArray(item.recoveryIcons) && item.recoveryIcons.length) score += 1
  if (item.launchAgency && !isPlaceholderMissionField(item.launchAgency)) score += 1
  if (!item._fromRecentSettled && !item._optimisticSettled) score += 1
  return score
}

/** 同分取 incoming（后写），避免破坏「完整 previous 覆盖旧瘦卡」 */
function pickRicherMissionCard(current, incoming) {
  if (!current) return incoming
  if (!incoming) return current
  const a = scoreMissionCardCompleteness(current)
  const b = scoreMissionCardCompleteness(incoming)
  if (b > a) return incoming
  if (a > b) return current
  return incoming
}

function isIncompleteCompletedListCard(item) {
  if (!item) return false
  if (isPlaceholderMissionField(item.rocketName)) return true
  if (
    isPlaceholderMissionField(item.padLocation) &&
    isPlaceholderMissionField(item.launchSite)
  ) {
    return true
  }
  return false
}

module.exports = {
  isPlaceholderMissionField,
  parseRocketMissionFromLaunchName,
  scoreMissionCardCompleteness,
  pickRicherMissionCard,
  isIncompleteCompletedListCard
}
