/**
 * 星问富消息：意图识别 + 任务卡片载荷（闭环：星舰下一飞）
 */
const { getUpcomingStarshipMissions } = require('../../../utils/api-launch-list.js')
const { buildMissionDetailUrl } = require('../../../utils/index-mission-nav.js')
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
const { loadCloudMediaMap } = require('../../../utils/image-config.js')
const {
  isStarshipMissionLike,
  isUsableMissionForCard,
  matchStarshipNextFlightIntent,
  pickStarshipMission,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule
} = require('./ai-chat-rich-core.js')

const DEFAULT_ROCKET_IMAGE = '火箭配置图/default.jpg'

/**
 * 与 mission-list-card / mapLaunchToListItem 同源：
 * await media map → resolveMissionRocketImage(..., forceRecompute=true)
 */
async function resolveChatCardRocketImage(mission) {
  const safe = mission && typeof mission === 'object' ? mission : {}
  try {
    await loadCloudMediaMap()
  } catch (e) {}
  const rocketName = safe.rocketName || 'Starship'
  return resolveMissionRocketImage(
    safe.rocketImage || safe.image || '',
    rocketName,
    safe.rocketConfiguration,
    true
  ) || resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE, rocketName, safe.rocketConfiguration, true) || ''
}

async function toChatMissionCard(mission, detailType) {
  if (!isUsableMissionForCard(mission)) return null
  const type = detailType === 'completed' ? 'completed' : 'upcoming'
  // 与首页 mission-list-card 一致：优先 missionName
  const name = mission.missionName || mission.name || '星舰试飞'
  const rocketName = mission.rocketName || 'Starship'
  const rocketImage = await resolveChatCardRocketImage(mission)
  const formattedTime = mission.formattedTime
    || (mission.launchTime ? formatDate(mission.launchTime, 'MM月DD日 HH:mm') : '时间待定')
  return {
    id: String(mission.id),
    name,
    rocketName,
    rocketImage: rocketImage || '',
    rocketConfiguration: mission.rocketConfiguration || null,
    launchTime: mission.launchTime || '',
    formattedTime,
    statusText: mission.statusBadgeText || mission.status || '计划中',
    statusCategory: mission.statusCategory || 'pending',
    padLocation: mission.padLocation || mission.launchSite || '',
    detailType: type,
    detailUrl: buildMissionDetailUrl({ id: mission.id, detailType: type })
  }
}

/**
 * 解析下一飞星舰任务卡片。
 * @returns {Promise<{card: object|null, scheduled: boolean}>}
 */
async function resolveStarshipNextFlightCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const trackedId = opts.trackedId != null ? String(opts.trackedId).trim() : ''

  const cached = opts.cached
  if (isUsableMissionForCard(cached)) {
    if (!trackedId || String(cached.id) === trackedId) {
      const card = await toChatMissionCard(cached, 'upcoming')
      return { card, scheduled: !!card }
    }
  }

  const hintList = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  const fromHint = pickStarshipMission(hintList, trackedId)
  if (fromHint) {
    const card = await toChatMissionCard(fromHint, 'upcoming')
    return { card, scheduled: !!card }
  }

  try {
    const res = await getUpcomingStarshipMissions(trackedId ? 12 : 1, 0)
    const mission = pickStarshipMission(res && res.list, trackedId)
    if (!mission) return { card: null, scheduled: false }
    const card = await toChatMissionCard(mission, 'upcoming')
    return { card, scheduled: !!card }
  } catch (e) {
    return { card: null, scheduled: false }
  }
}

module.exports = {
  matchStarshipNextFlightIntent,
  toChatMissionCard,
  resolveChatCardRocketImage,
  resolveStarshipNextFlightCard,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule,
  isStarshipMissionLike,
  isUsableMissionForCard,
  pickStarshipMission
}
