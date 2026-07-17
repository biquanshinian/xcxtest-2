const { attachMissionDetailMeta } = require('./index-mission-nav.js')

function normalizeMissionType(type) {
  return type === 'completed' ? 'completed' : 'upcoming'
}

function normalizeMissionItem(mission, options) {
  const {
    type,
    index = 0,
    baseIndex = 0,
    formatDate
  } = options || {}

  const normalizedType = normalizeMissionType(type)
  const isCompleted = normalizedType === 'completed'

  return attachMissionDetailMeta({
    ...mission,
    _wxkey: `${isCompleted ? 'm-1' : 'm-0'}-${baseIndex + index}-${(mission.id != null ? mission.id : '')}`,
    formattedTime: mission.launchTime ? formatDate(mission.launchTime, 'MM月DD日 HH:mm') : '时间未知'
  }, {
    id: mission.id,
    detailType: normalizedType
  })
}

async function fetchMissionListData(options) {
  const {
    type,
    limit = 50,
    offset = 0,
    getUpcomingMissions,
    getCompletedMissions,
    formatDate,
    filterExpiredMissions
  } = options || {}

  const normalizedType = normalizeMissionType(type)
  const fetcher = normalizedType === 'completed' ? getCompletedMissions : getUpcomingMissions
  const res = await fetcher(limit, offset)
  const baseIndex = offset || 0
  const list = (res.list || []).map((mission, index) => normalizeMissionItem(mission, {
    type: normalizedType,
    index,
    baseIndex,
    formatDate
  }))

  // 排序兜底：云端小时级 NET 探针只就地 patch 时间不重排缓存，任务大幅改期后
  // 缓存数组会乱序（首屏出现上千天倒计时的卡片）。渲染前统一按发射时间排序
  // （复用 mergeMissionPages：upcoming 升序 + 过滤过期，completed 降序），
  // 保证初始加载 / 下拉刷新 / settle 后刷新所有入口顺序正确。
  return {
    res,
    list: mergeMissionPages(normalizedType, [], list, filterExpiredMissions)
  }
}

function buildMissionListSetData(type, missions, res = {}, filterExpiredMissions) {
  const normalizedType = normalizeMissionType(type)
  const list = Array.isArray(missions) ? missions : []

  if (normalizedType === 'completed') {
    return {
      completedMissions: list,
      completedMissionsOffset: getMissionNextOffset(res, 0),
      completedMissionsHasMore: !!res.hasMore
    }
  }

  return {
    upcomingMissions: filterExpiredMissions(list),
    missionsOffset: getMissionNextOffset(res, 0),
    missionsHasMore: !!res.hasMore
  }
}

function getMissionNextOffset(res = {}, fallbackOffset = 0) {
  const nextOffset = Number(res && res.nextOffset)
  if (Number.isFinite(nextOffset) && nextOffset >= 0) {
    return nextOffset
  }

  const safeFallback = Math.max(0, Number(fallbackOffset) || 0)
  const listLength = Array.isArray(res && res.list) ? res.list.length : 0
  return safeFallback + listLength
}

function mergeMissionPages(type, currentList, incomingList, filterExpiredMissions) {
  const normalizedType = normalizeMissionType(type)
  const merged = []
    .concat(Array.isArray(currentList) ? currentList : [])
    .concat(Array.isArray(incomingList) ? incomingList : [])

  if (normalizedType === 'completed') {
    return merged.sort((a, b) => {
      const timeA = a && a.launchTime ? new Date(a.launchTime).getTime() : 0
      const timeB = b && b.launchTime ? new Date(b.launchTime).getTime() : 0
      return timeB - timeA
    })
  }

  return filterExpiredMissions(merged.sort((a, b) => {
    const timeA = a && a.launchTime ? new Date(a.launchTime).getTime() : 0
    const timeB = b && b.launchTime ? new Date(b.launchTime).getTime() : 0
    return timeA - timeB
  }))
}

module.exports = {
  fetchMissionListData,
  buildMissionListSetData,
  getMissionNextOffset,
  mergeMissionPages
}
