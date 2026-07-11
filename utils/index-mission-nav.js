const SEARCH_RESTORE_STORAGE_KEY = 'profile_open_search'

function resolveMissionDetailSourceData(state, explicitType, missionId) {
  var safeState = state && typeof state === 'object' ? state : {}
  var missionType = safeState.missionType || 'upcoming'
  var id = missionId == null ? '' : String(missionId).trim()
  var detailType = explicitType === 'completed' ? 'completed' : (explicitType === 'upcoming' ? 'upcoming' : '')

  if (!detailType) {
    var missions = []
    if (missionType === 'calendar') {
      missions = Array.isArray(safeState.calendarAllMissions) ? safeState.calendarAllMissions : []
    } else if (missionType === 'completed') {
      missions = Array.isArray(safeState.completedMissions) ? safeState.completedMissions : []
    } else {
      missions = Array.isArray(safeState.upcomingMissions) ? safeState.upcomingMissions : []
    }

    var mission = missions.find(function (item) {
      return String(item && item.id) === id
    })

    if (missionType === 'calendar') {
      var launchTime = mission && mission.launchTime ? mission.launchTime : ''
      var isUpcoming = false
      if (launchTime) {
        var ts = new Date(launchTime).getTime()
        isUpcoming = Number.isFinite(ts) && ts > Date.now()
      }
      detailType = isUpcoming ? 'upcoming' : 'completed'
    } else {
      detailType = missionType === 'completed' ? 'completed' : 'upcoming'
    }
  }

  return {
    id: id,
    detailType: detailType || 'upcoming'
  }
}

function buildMissionDetailQuery(params) {
  var safeParams = params && typeof params === 'object' ? params : {}
  var id = safeParams.id == null ? '' : String(safeParams.id).trim()
  var detailType = safeParams.detailType === 'completed' ? 'completed' : 'upcoming'
  var fromSearch = !!safeParams.fromSearch
  var query = 'id=' + encodeURIComponent(id) + '&type=' + detailType
  return fromSearch ? query + '&fromSearch=1' : query
}

function buildMissionDetailUrl(params) {
  return '/pages/mission-detail/mission-detail?' + buildMissionDetailQuery(params)
}

function buildMissionDetailNavigation(params) {
  var safeParams = params && typeof params === 'object' ? params : {}
  return {
    url: buildMissionDetailUrl(safeParams),
    fromSearch: !!safeParams.fromSearch,
    detailType: safeParams.detailType === 'completed' ? 'completed' : 'upcoming',
    id: safeParams.id == null ? '' : String(safeParams.id).trim()
  }
}

function attachMissionDetailMeta(mission, params) {
  var safeMission = mission && typeof mission === 'object' ? mission : {}
  var safeParams = params && typeof params === 'object' ? params : {}
  var detailType = safeParams.detailType === 'completed' ? 'completed' : 'upcoming'
  return {
    ...safeMission,
    _detailType: detailType,
    _detailUrl: buildMissionDetailUrl({
      id: safeParams.id != null ? safeParams.id : safeMission.id,
      detailType: detailType,
      fromSearch: !!safeParams.fromSearch
    })
  }
}

function collectMissionShareCandidates(state) {
  var safeState = state && typeof state === 'object' ? state : {}
  var upcoming = Array.isArray(safeState.upcomingMissions) ? safeState.upcomingMissions : []
  var completed = Array.isArray(safeState.completedMissions) ? safeState.completedMissions : []
  var calendar = Array.isArray(safeState.calendarAllMissions) ? safeState.calendarAllMissions : []
  return [].concat(upcoming, completed, calendar)
}

function resolveMissionSharePayload(state, params) {
  var safeParams = params && typeof params === 'object' ? params : {}
  var id = safeParams.id == null ? '' : String(safeParams.id).trim()
  if (!id) return null

  var missions = collectMissionShareCandidates(state)
  var mission = missions.find(function (item) {
    return String(item && item.id) === id
  })
  if (!mission) return null

  var detailType = safeParams.detailType === 'completed'
    ? 'completed'
    : (safeParams.detailType === 'upcoming' ? 'upcoming' : (mission && mission._detailType) || 'upcoming')

  return {
    mission: mission,
    detailType: detailType,
    path: buildMissionDetailUrl({ id: mission.id, detailType: detailType })
  }
}

function buildMissionShareDisplay(options) {
  var safeOptions = options && typeof options === 'object' ? options : {}
  var mission = safeOptions.mission && typeof safeOptions.mission === 'object' ? safeOptions.mission : null
  var explicitTitle = typeof safeOptions.title === 'string' ? safeOptions.title.trim() : ''
  var explicitImageUrl = typeof safeOptions.imageUrl === 'string' ? safeOptions.imageUrl.trim() : ''
  var fallbackTitle = typeof safeOptions.fallbackTitle === 'string' ? safeOptions.fallbackTitle.trim() : ''
  var fallbackMissionName = typeof safeOptions.fallbackMissionName === 'string' ? safeOptions.fallbackMissionName.trim() : '未知任务'
  var fallbackTimeText = typeof safeOptions.fallbackTimeText === 'string' ? safeOptions.fallbackTimeText.trim() : '时间未知'
  var titleSuffix = typeof safeOptions.titleSuffix === 'string' ? safeOptions.titleSuffix : ' | 火星探索日志'
  var missionName = mission ? String(mission.missionName || mission.name || '').trim() : ''
  var timeText = mission ? String(mission.formattedTime || '').trim() : ''
  var title = explicitTitle || ''

  if (!title) {
    var safeMissionName = missionName || fallbackMissionName
    var safeTimeText = timeText || fallbackTimeText
    title = safeMissionName && safeTimeText
      ? safeMissionName + ' - ' + safeTimeText + titleSuffix
      : (fallbackTitle || safeMissionName || ('火星探索日志' + titleSuffix))
  }

  var imageUrl = explicitImageUrl || ''
  if (!imageUrl && typeof safeOptions.resolveMissionRocketImage === 'function') {
    var rocketSrc = ''
    if (mission) {
      var rImg = mission.rocketImage != null ? String(mission.rocketImage).trim() : ''
      var img = mission.image != null ? String(mission.image).trim() : ''
      rocketSrc = rImg || img
    }
    imageUrl = safeOptions.resolveMissionRocketImage(
      rocketSrc,
      mission && mission.rocketName ? mission.rocketName : '',
      mission && mission.rocketConfiguration ? mission.rocketConfiguration : undefined
    ) || ''
  }
  if (!imageUrl) {
    imageUrl = typeof safeOptions.fallbackImageUrl === 'string' ? safeOptions.fallbackImageUrl.trim() : ''
  }

  return {
    title: title,
    imageUrl: imageUrl
  }
}

function buildMissionShareOptions(options) {
  var safeOptions = options && typeof options === 'object' ? options : {}
  var mission = safeOptions.mission && typeof safeOptions.mission === 'object' ? safeOptions.mission : null
  var detailType = safeOptions.detailType === 'completed' ? 'completed' : 'upcoming'
  var mode = safeOptions.mode === 'timeline' ? 'timeline' : 'app'
  var display = buildMissionShareDisplay(safeOptions)
  var result = {
    title: display.title,
    imageUrl: display.imageUrl
  }

  if (mode === 'timeline') {
    result.query = mission && mission.id != null
      ? buildMissionDetailQuery({ id: mission.id, detailType: detailType })
      : ''
  } else {
    result.path = mission && mission.id != null
      ? buildMissionDetailUrl({ id: mission.id, detailType: detailType })
      : (safeOptions.fallbackPath || '/pages/index/index')
  }

  return result
}

module.exports = {
  SEARCH_RESTORE_STORAGE_KEY,
  resolveMissionDetailSourceData,
  buildMissionDetailQuery,
  buildMissionDetailUrl,
  buildMissionDetailNavigation,
  attachMissionDetailMeta,
  collectMissionShareCandidates,
  resolveMissionSharePayload,
  buildMissionShareDisplay,
  buildMissionShareOptions
}
