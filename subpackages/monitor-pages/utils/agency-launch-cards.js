/**
 * 发射商任务卡片共享逻辑：agency-detail 板块 与 agency-launches 独立列表页共用。
 * 数据复用首页 limit=100 规范缓存（云函数后台刷新，不直连 LL2），客户端按发射商过滤。
 */
const { getUpcomingMissions, getCompletedMissions } = require('../../../utils/api-launch-list.js')
const {
  applyContentLangToMission,
  formatMissionListTimeOrUnknown
} = require('../../../utils/launch-card-i18n.js')
const { launchCardUiText } = require('../../../utils/locale.js')

/** 发射任务列表项 → 板块卡片轻量模型（时间随 contentLang） */
function formatAgencyLaunchCard(m) {
  const localized = applyContentLangToMission(Object.assign({}, m || {}))
  const timeText = formatMissionListTimeOrUnknown(localized.launchTime)
  const category = localized.statusCategory || ''
  let statusClass = 'neutral'
  if (category === 'success') statusClass = 'success'
  else if (category === 'failure' || category === 'partial') statusClass = 'failure'
  return {
    id: localized.id,
    name: localized.missionName || localized.name || launchCardUiText('unknownMission'),
    rocketName: localized.rocketName || '',
    rocketImage: localized.rocketImage || '',
    timeText,
    statusText: localized.statusBadgeText || localized.status || '',
    statusClass
  }
}

/** 按发射商匹配任务：优先 LL2 机构 id，兜底缩写（老缓存可能缺 id） */
function matchLaunchAgency(m, agency) {
  if (!m || !agency) return false
  if (agency.id != null && m.launchAgencyId != null) {
    return String(m.launchAgencyId) === String(agency.id)
  }
  if (agency.abbrev && m.launchAgencyAbbrev) {
    return m.launchAgencyAbbrev === agency.abbrev
  }
  return false
}

/**
 * 拉取单一类型的发射商任务卡片列表
 * @param {Object} agency { id, abbrev }
 * @param {String} type 'upcoming' | 'completed'
 * @returns {Promise<Array>} 卡片数组（拉取失败返回空数组）
 */
function fetchAgencyLaunchCards(agency, type) {
  const fetcher = type === 'completed' ? getCompletedMissions : getUpcomingMissions
  return fetcher(100, 0)
    .then(res => ((res && res.list) || [])
      .filter(m => matchLaunchAgency(m, agency))
      .map(formatAgencyLaunchCard))
    .catch(() => [])
}

module.exports = {
  formatAgencyLaunchCard,
  matchLaunchAgency,
  fetchAgencyLaunchCards
}
