function buildMissionListViewUpdateData(options = {}) {
  const {
    activeMissionType,
    type,
    list
  } = options

  const updateData = {
    missionsLoadError: false,
    missionsErrorMessage: ''
  }

  if (activeMissionType === type) {
    updateData.showMissionsEmpty = !Array.isArray(list) || list.length === 0
  }

  return updateData
}

function buildMissionInteractionResetState(extraState = {}) {
  return {
    missionsLoadingMore: false,
    loadMoreTriggered: false,
    preloadProgress: 0,
    ...extraState
  }
}

function buildMissionReadyState(extraState = {}) {
  return buildMissionInteractionResetState({
    missionsLoadError: false,
    missionsErrorMessage: '',
    missionsInitialLoading: false,
    ...extraState
  })
}

function buildCompletedMissionLoadErrorState(activeMissionType, errorMessage) {
  const updateData = {
    completedMissions: [],
    completedMissionsOffset: 0,
    completedMissionsHasMore: false
  }

  if (activeMissionType === 'completed') {
    updateData.missionsLoadError = true
    updateData.missionsErrorMessage = errorMessage
  }

  return updateData
}

function buildMissionListErrorState(errorMessage, options = {}) {
  const {
    showMissionsEmpty = false,
    extraState = {}
  } = options

  return buildMissionInteractionResetState({
    missionsLoadError: true,
    missionsErrorMessage: errorMessage,
    missionsInitialLoading: false,
    showMissionsEmpty,
    ...extraState
  })
}

function getMissionScrollTopField(missionType) {
  if (missionType === 'completed') return 'scrollTopCompleted'
  if (missionType === 'calendar') return 'scrollTopCalendar'
  return 'scrollTopUpcoming'
}

function getMissionScrollTopValue(data, missionType) {
  const safeData = data && typeof data === 'object' ? data : {}
  const field = getMissionScrollTopField(missionType)
  return Number(safeData[field]) || 0
}

function buildMissionTypeSwitchState(data, nextMissionType) {
  const safeData = data && typeof data === 'object' ? data : {}
  return {
    missionType: nextMissionType,
    showMissionsEmpty: false,
    showCompactCountdown: false,
    _scrollTop: 0,
    isSwitchingTab: true,
    targetScrollTop: getMissionScrollTopValue(safeData, nextMissionType)
  }
}

function buildMissionScrollProgressState(options = {}) {
  const {
    missionType,
    scrollTop = 0,
    scrollHeight = 0,
    viewportHeight = 0,
    triggerZone = 280,
    hasMore = false,
    missionsLoadingMore = false,
    currentShowCompactCountdown = false,
    currentPreloadProgress = 0,
    preloadProgressStep = 0.05
  } = options

  let preloadProgress = 0
  if (hasMore && !missionsLoadingMore && scrollHeight > 0 && viewportHeight > 0) {
    const distanceToBottom = Math.max(0, scrollHeight - scrollTop - viewportHeight)
    preloadProgress = Math.max(0, Math.min(1, (triggerZone - distanceToBottom) / triggerZone))
  }

  const normalizedProgress = Math.round(preloadProgress / preloadProgressStep) * preloadProgressStep
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(normalizedProgress) ? normalizedProgress : 0))
  const previousProgress = Number(currentPreloadProgress) || 0
  const showCompactCountdown = missionType === 'upcoming' && scrollTop > 60
  return {
    preloadProgress: safeProgress,
    showCompactCountdown,
    shouldUpdateCompact: showCompactCountdown !== !!currentShowCompactCountdown,
    shouldUpdateProgress: Math.abs(previousProgress - safeProgress) >= preloadProgressStep
  }
}

function buildMissionScrollPositionState(data, missionType, currentScrollTop, threshold = 10) {
  const safeData = data && typeof data === 'object' ? data : {}
  const field = getMissionScrollTopField(missionType)
  const previous = Number(safeData[field]) || 0
  if (Math.abs(previous - currentScrollTop) <= threshold) {
    return null
  }
  return {
    [field]: currentScrollTop
  }
}

function shouldScheduleMissionCardMeasurement(options = {}) {
  const {
    missionType,
    missionsLoadingMore = false,
    hasMetrics = false,
    needsFreshMeasure = false,
    hasPendingMeasure = false
  } = options

  if (missionType === 'calendar' || missionsLoadingMore) return false
  if (hasPendingMeasure) return false
  if (!hasMetrics) return true
  return !!needsFreshMeasure
}

function getMissionCardListCount(data) {
  const safeData = data && typeof data === 'object' ? data : {}
  const missionType = safeData.missionType
  const limit = Number(safeData.missionGateLimit) || 0
  let list = []
  if (missionType === 'upcoming') {
    list = Array.isArray(safeData.displayedUpcomingMissions) ? safeData.displayedUpcomingMissions : []
  } else if (missionType === 'completed') {
    list = Array.isArray(safeData.completedMissions) ? safeData.completedMissions : []
  } else {
    return 0
  }
  if (limit > 0) return Math.min(list.length, limit)
  return list.length
}

function parseMissionCardHapticIndex(rect) {
  if (!rect || !rect.dataset) return NaN
  const raw = rect.dataset.hapticIndex
  if (raw === undefined || raw === null || raw === '') return NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

function buildMissionCardMetricsFromRects(options = {}) {
  const {
    scrollViewRect,
    cardRects,
    currentScrollTop = 0,
    fallbackGap = 0,
    previousMetrics = null,
    listCount = 0
  } = options

  if (!scrollViewRect || !Array.isArray(cardRects) || !cardRects.length) {
    return previousMetrics || null
  }

  const firstRect = cardRects[0]
  const secondRect = cardRects[1]
  const pitchFromPair =
    secondRect && secondRect.top > firstRect.top ? secondRect.top - firstRect.top : 0
  const pitch =
    pitchFromPair ||
    (firstRect.height || 0) + fallbackGap ||
    (previousMetrics && previousMetrics.pitch) ||
    1

  const measuredOffset = currentScrollTop + firstRect.top - scrollViewRect.top
  const measuredIndex = parseMissionCardHapticIndex(firstRect)
  let firstOffset
  if (Number.isFinite(measuredIndex) && measuredIndex === 0) {
    firstOffset = measuredOffset
  } else if (previousMetrics && typeof previousMetrics.firstOffset === 'number') {
    firstOffset = previousMetrics.firstOffset
  } else if (Number.isFinite(measuredIndex) && measuredIndex > 0) {
    firstOffset = measuredOffset - measuredIndex * pitch
  } else {
    firstOffset = measuredOffset
  }

  const lastIndex = parseMissionCardHapticIndex(cardRects[cardRects.length - 1])
  const inferredCount = Number.isFinite(lastIndex) ? lastIndex + 1 : cardRects.length
  const cardCount = Math.max(Number(listCount) || 0, inferredCount, cardRects.length, 1)

  return {
    firstOffset,
    pitch: pitch || 1,
    cardHeight: firstRect.height || (previousMetrics && previousMetrics.cardHeight) || 0,
    cardCount
  }
}

function resolveMissionCardFocusIndex(options = {}) {
  const {
    scrollTop = 0,
    metrics,
    cardCount,
    viewportHeight = 0,
    navPlaceholderHeight = 0
  } = options

  if (!metrics || !metrics.pitch) return -1
  const count = Math.max(Number(cardCount) || 0, Number(metrics.cardCount) || 0)
  if (!count) return -1

  const visibleHeight = Math.max(viewportHeight - navPlaceholderHeight, metrics.cardHeight || 0)
  const anchorOffset = navPlaceholderHeight + visibleHeight * 0.32
  const firstCardCenter = metrics.firstOffset + (metrics.cardHeight || metrics.pitch) / 2

  let nextIndex = Math.round((scrollTop + anchorOffset - firstCardCenter) / metrics.pitch)
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex > count - 1) nextIndex = count - 1
  return nextIndex
}

function buildMissionCardHapticState(options = {}) {
  const {
    focusIndex = -1,
    activeIndex = -1,
    now = Date.now(),
    lastVibrateAt = 0,
    vibrateIntervalMs = 120
  } = options

  if (focusIndex < 0) {
    return {
      nextActiveIndex: activeIndex,
      shouldVibrate: false,
      nextLastVibrateAt: lastVibrateAt,
      shouldSyncActiveIndex: false
    }
  }

  if (activeIndex === -1) {
    return {
      nextActiveIndex: focusIndex,
      shouldVibrate: false,
      nextLastVibrateAt: lastVibrateAt,
      shouldSyncActiveIndex: true
    }
  }

  if (focusIndex === activeIndex) {
    return {
      nextActiveIndex: activeIndex,
      shouldVibrate: false,
      nextLastVibrateAt: lastVibrateAt,
      shouldSyncActiveIndex: false
    }
  }

  const shouldVibrate = !lastVibrateAt || now - lastVibrateAt > vibrateIntervalMs
  return {
    nextActiveIndex: focusIndex,
    shouldVibrate,
    nextLastVibrateAt: shouldVibrate ? now : lastVibrateAt,
    shouldSyncActiveIndex: true
  }
}

function buildLoadMoreFallbackState(options = {}) {
  const {
    isUpcoming = true,
    noMoreData = false
  } = options

  const state = buildMissionInteractionResetState()
  if (noMoreData) {
    if (isUpcoming) {
      state.missionsHasMore = false
    } else {
      state.completedMissionsHasMore = false
    }
  }
  return state
}

module.exports = {
  buildMissionListViewUpdateData,
  buildMissionReadyState,
  getMissionScrollTopField,
  getMissionScrollTopValue,
  buildMissionTypeSwitchState,
  buildMissionScrollProgressState,
  buildMissionScrollPositionState,
  shouldScheduleMissionCardMeasurement,
  getMissionCardListCount,
  buildMissionCardMetricsFromRects,
  resolveMissionCardFocusIndex,
  buildMissionCardHapticState,
  buildCompletedMissionLoadErrorState,
  buildMissionListErrorState,
  buildLoadMoreFallbackState
}
