let _imageHelpers = null
function getImageHelpers() {
  if (!_imageHelpers) {
    const util = require('./util.js')
    _imageHelpers = {
      resolveMissionRocketImage: util.resolveMissionRocketImage,
      shouldReplaceRocketImage: util.shouldReplaceRocketImage
    }
  }
  return _imageHelpers
}

function buildBoosterDisplay(boosterInfo) {
  const info = boosterInfo || null
  if (!info) return '未披露'
  const serialNumber = info.serialNumber || '未披露'
  const flightText = info.flights != null ? (` · 第${info.flights}次飞行`) : ''
  return `${serialNumber}${flightText}`
}

function buildRecoveryDisplay(boosterInfo) {
  const info = boosterInfo || null
  if (!info) return '未知'
  if (info.inferredRecovery) return '回收信息待确认'
  // 与详情页 buildLandingDisplay 同优先级：实际回收类型 > "未复用/首次"
  // （EXPENDED/LOST 已精确说明本次处置方式，比"未复用/首次"更有信息量）
  if (info.landingType === 'RTLS') return '陆地回收 (RTLS)'
  if (info.landingType === 'ASDS') return '海上回收 (ASDS)'
  if (info.landingType === 'NET_CATCH') return '网系回收'
  if (info.landingType === 'TOWER_CATCH') return '塔架捕获'
  if (info.landingType === 'HELICOPTER_CATCH') return '直升机捕获'
  if (info.landingType === 'VL') return '垂直着陆'
  if (info.landingType === 'HL') return '水平着陆'
  if (info.landingType === 'SPLASHDOWN') return '海面溅落'
  if (info.landingType === 'RECOVERY') return '海面回收'
  if (info.landingType === 'EXPENDED') return '一次性使用'
  if (info.landingType === 'LOST') return '未能回收'
  if (info.landingType === 'SPACECRAFT_LANDING') return '伞降着陆'
  if (info.reused === false) return '未复用/首次'
  if (info.landingLocation) return info.landingLocation
  if (info.netRecovery) return '网系回收'
  if (info.configReusable) return '可回收构型'
  return '未知'
}

function buildLaunchDataFromMission(mission, getStatusTextZh) {
  const source = mission || {}
  const boosterInfo = source.boosterInfo || null
  return {
    id: source.id,
    launchTime: source.launchTime,
    windowStart: source.windowStart,
    windowEnd: source.windowEnd,
    missionName: source.missionName || '未知任务',
    rocketName: source.rocketName || '未知火箭',
    payloadName: source.missionName || '未知载荷',
    launchSite: source.launchSite || '未知地点',
    launchAgency: source.launchAgency || '-',
    launchAgencyId: source.launchAgencyId != null ? source.launchAgencyId : null,
    launchAgencyAbbrev: source.launchAgencyAbbrev || '',
    boosterInfo,
    isRecoverableThisMission: !!source.isRecoverableThisMission,
    showRecoveryBlock: !!(source.isRecoverableThisMission || (boosterInfo && (boosterInfo.inferredRecovery || boosterInfo.reused === false))),
    boosterDisplay: buildBoosterDisplay(boosterInfo),
    recoveryDisplay: buildRecoveryDisplay(boosterInfo),
    recoveryTagClass: source.recoveryTagClass || 'recovery-tag--expendable',
    recoveryTagText: source.recoveryTagText || '一次性',
    status: source.status || '未知状态',
    statusId: source.statusId != null ? source.statusId : null,
    statusAbbrev: source.statusAbbrev || '',
    statusCategory: source.statusCategory || 'pending',
    // 与列表角标同源：优先 statusBadgeText，再按 id/文案兜底
    statusTextZh: source.statusBadgeText
      || (typeof getStatusTextZh === 'function'
        ? getStatusTextZh(
          source.statusId != null
            ? { id: source.statusId, name: source.status, abbrev: source.statusAbbrev }
            : (source.status || source.statusAbbrev || '')
        )
        : (source.status || '计划中')),
    probability: source.probability,
    rocketConfiguration: source.rocketConfiguration || null,
    // 与详情头图同源：按火箭名 forceRecompute，禁止整包 setData 把已正确的图降级回列表里的 default 快照
    ...(() => {
      const { resolveMissionRocketImage } = getImageHelpers()
      const stamped = source.rocketImage || source.image || ''
      const url = resolveMissionRocketImage(
        stamped,
        source.rocketName || '',
        source.rocketConfiguration || null,
        true
      )
      return { rocketImage: url, image: url }
    })(),
    missionType: 'upcoming'
  }
}

/** 合并列表时保留已升级的火箭图，避免 enrich 快照把正确图盖回 default */
function mergePreservedRocketImages(nextList, prevList) {
  const { shouldReplaceRocketImage } = getImageHelpers()
  if (!Array.isArray(nextList) || !nextList.length) return nextList
  const prev = Array.isArray(prevList) ? prevList : []
  const byId = {}
  for (let i = 0; i < prev.length; i++) {
    const m = prev[i]
    if (m && m.id != null) byId[String(m.id)] = m
  }
  return nextList.map((m) => {
    if (!m || m.id == null) return m
    const old = byId[String(m.id)]
    if (!old) return m
    const cur = m.rocketImage || m.image || ''
    const kept = old.rocketImage || old.image || ''
    if (!shouldReplaceRocketImage(kept, cur) && kept) {
      return { ...m, rocketImage: kept, image: kept }
    }
    return m
  })
}

function formatHomeLaunchTimeParts(launchTime, formatDate) {
  if (!launchTime || typeof formatDate !== 'function') {
    return { date: '时间未知', weekTime: '', full: '时间未知' }
  }
  const date = formatDate(launchTime, 'YYYY年MM月DD日')
  const weekTime = formatDate(launchTime, 'WW HH:mm:ss')
  return {
    date,
    weekTime,
    full: `${date} ${weekTime}`
  }
}

function formatHomeLaunchTime(launchTime, formatDate) {
  return formatHomeLaunchTimeParts(launchTime, formatDate).full
}

function _resolveMissionSubscribed(source, options = {}) {
  const { isSubscribed, subscribedIdSet } = options
  if (!source || source.id == null) return false
  const id = String(source.id)
  if (subscribedIdSet instanceof Set) return subscribedIdSet.has(id)
  if (typeof isSubscribed === 'function') return !!isSubscribed(source.id)
  return false
}

function buildHomeLaunchPanelState(options = {}) {
  const {
    mission,
    formattedLaunchTime,
    formattedLaunchDate,
    formattedLaunchWeekTime,
    getStatusTextZh,
    isSubscribed,
    subscribedIdSet,
    extraState = {}
  } = options

  const source = mission || {}
  const subscribed = _resolveMissionSubscribed(source, { isSubscribed, subscribedIdSet })

  return {
    launchData: buildLaunchDataFromMission(source, getStatusTextZh),
    formattedLaunchTime: formattedLaunchTime || '',
    formattedLaunchDate: formattedLaunchDate || '',
    formattedLaunchWeekTime: formattedLaunchWeekTime || '',
    loadError: false,
    errorMessage: '',
    _countdownSubscribed: subscribed,
    ...extraState
  }
}

function buildCurrentLaunchPanelState(options = {}) {
  const {
    mission,
    formatDate,
    getStatusTextZh,
    isSubscribed,
    subscribedIdSet,
    extraState = {}
  } = options

  const parts = formatHomeLaunchTimeParts(mission && mission.launchTime, formatDate)
  return buildHomeLaunchPanelState({
    mission,
    formattedLaunchTime: parts.full,
    formattedLaunchDate: parts.date,
    formattedLaunchWeekTime: parts.weekTime,
    getStatusTextZh,
    isSubscribed,
    subscribedIdSet,
    extraState
  })
}

function getNextUpcomingLaunch(missions, currentId, now = Date.now()) {
  const safeList = Array.isArray(missions) ? missions : []
  return safeList.find((mission) => {
    if (!mission || !mission.launchTime) return false
    if (mission.id === currentId) return false
    return new Date(mission.launchTime).getTime() > now
  }) || null
}

/** 副卡倒计时文案：有剩余时间显示紧凑时钟，过点显示「确认中」 */
function formatOverlapSideCountdownText(countdown) {
  if (!countdown || countdown.isExpired) return '确认中'
  const pad = (n) => String(Math.max(0, Number(n) || 0)).padStart(2, '0')
  const days = Number(countdown.days) || 0
  const clock = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`
  return days > 0 ? `${days}天 ${clock}` : clock
}

/**
 * 把任务行收成倒计时区重叠副卡视图（单行精简）。
 * @returns {object|null}
 */
function buildOverlapSideCardView(mission, options = {}) {
  if (!mission || mission.id == null) return null
  const { getCountdown, getStatusTextZh } = options
  const countdown =
    typeof getCountdown === 'function' && mission.launchTime
      ? getCountdown(mission.launchTime)
      : { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true }
  const statusObj = {
    id: mission.statusId,
    name: mission.statusBadgeText || mission.statusTextZh || mission.status || '',
    abbrev: mission.statusAbbrev || ''
  }
  const statusTextZh =
    mission.statusBadgeText ||
    mission.statusTextZh ||
    (typeof getStatusTextZh === 'function' ? getStatusTextZh(statusObj) : '') ||
    mission.status ||
    ''
  return {
    id: mission.id,
    missionName: mission.missionName || mission.name || '',
    rocketName: mission.rocketName || '',
    rocketImage: mission.rocketImage || mission.image || '',
    launchAgency: mission.launchAgency || '',
    statusTextZh,
    statusCategory: mission.statusCategory || 'pending',
    countdownText: formatOverlapSideCountdownText(countdown),
    isExpired: !!countdown.isExpired,
    label: '相邻发射窗口'
  }
}

/**
 * 选型 + 视图：仅窗口重叠时出副卡；主卡换人后按新主卡再排队下一条重叠。
 */
function pickOverlapSideCard(missions, options = {}) {
  const mission = windowMachine.resolveOverlapSideMission(missions, {
    panelMissionId: options.panelMissionId,
    panelMission: options.panelMission,
    recordsById: options.recordsById,
    now: options.now,
    forceNext: false
  })
  if (!mission) return null
  return buildOverlapSideCardView(mission, {
    getCountdown: options.getCountdown,
    getStatusTextZh: options.getStatusTextZh
  })
}

// 窗口期状态机：面板选型/挂住/探针决策的唯一规则源（本文件只做薄委托，保持旧 API）
const windowMachine = require('./countdown-window-machine.js')

/** @deprecated 用 windowMachine.WINDOW_HOLD_FALLBACK_MS */
const COUNTDOWN_WINDOW_HOLD_FALLBACK_MS = windowMachine.WINDOW_HOLD_FALLBACK_MS

/** 窗口挂住截止：优先 windowEnd，否则 NET + 30m（委托状态机） */
function getMissionWindowHoldUntilMs(mission, record) {
  return windowMachine.getHoldUntilMs(mission, record || null)
}

/** 未决状态（可继续占倒计时）：非终态、非飞行中（委托状态机） */
function isUnresolvedForCountdownHold(mission, record) {
  if (!mission) return false
  return !windowMachine.isMissionSettled(mission, record || null)
}

/**
 * NET 已过、状态未决、仍在发射窗口（+宽限）内 → 倒计时应继续挂住该任务。
 * @param {object} mission
 * @param {number} [now]
 * @param {object|null} [record] _launchRecordsById 权威观测（优先于列表行字段）
 */
function shouldHoldPastNetCountdownMission(mission, now = Date.now(), record = null) {
  return windowMachine.isPanelHoldActive(mission, record, now)
}

/**
 * 倒计时面板应展示的任务（委托状态机 resolvePanelMission）：
 * 1) 当前面板任务 / 列表头处于窗口内未决 → 挂住不让位
 * 2) 否则取 NET 仍在未来的首条
 * 3) 无未来任务时头条未决继续展示；已落库任务绝不入选
 * @param {Array} missions
 * @param {number} [now]
 * @param {{ holdMissionId?: string|number, recordsById?: Map }} [options]
 */
function pickCountdownDisplayMission(missions, now = Date.now(), options = {}) {
  return windowMachine.resolvePanelMission(missions, {
    now,
    holdMissionId: options.holdMissionId,
    recordsById: options.recordsById
  })
}

/** 列表头部已过 NET、尚未终态的任务（upcoming 升序，遇到未来 NET 即停） */
function collectPastNetUpcomingHeads(missions, now = Date.now(), limit = 3) {
  const safeList = Array.isArray(missions) ? missions : []
  const max = Math.max(0, Number(limit) || 0)
  const out = []
  for (let i = 0; i < safeList.length && out.length < max; i++) {
    const mission = safeList[i]
    if (!mission || !mission.launchTime) continue
    const t = new Date(mission.launchTime).getTime()
    if (!Number.isFinite(t)) continue
    if (t > now) break
    out.push(mission)
  }
  return out
}

/** NET 已过时倒计时角标：禁止显示「就绪」，统一「状态确认中」 */
function withCountdownConfirmingStatus(mission) {
  if (!mission) return mission
  return {
    ...mission,
    status: '状态确认中',
    statusBadgeText: '状态确认中',
    statusCategory: 'pending',
    _countdownConfirming: true
  }
}

function isPastNetMission(mission, now = Date.now()) {
  if (!mission || !mission.launchTime) return false
  const t = new Date(mission.launchTime).getTime()
  return Number.isFinite(t) && t <= now
}

function buildCountdownSubscriptionState(launch, isSubscribed, subscribedIdSet) {
  const launchId = launch && launch.id != null ? launch.id : ''
  let subscribed = false
  if (launchId) {
    if (subscribedIdSet instanceof Set) {
      subscribed = subscribedIdSet.has(String(launchId))
    } else if (typeof isSubscribed === 'function') {
      subscribed = !!isSubscribed(launchId)
    }
  }
  return {
    _countdownSubscribed: subscribed
  }
}

function buildLaunchSwitchEffects(mission, options = {}) {
  const source = mission || null
  const safeOptions = options || {}
  const shouldSkipVoteCache = !!safeOptions.shouldSkipVoteCache
  return {
    launchId: source && source.id != null ? source.id : '',
    shouldResetVote: true,
    shouldUpdateCountdown: true,
    shouldLoadVote: !!(source && source.id != null),
    voteSkipCache: shouldSkipVoteCache
  }
}

function shouldRefreshExpiredLaunch(launchData, now = Date.now()) {
  const launchTime = launchData && launchData.launchTime ? new Date(launchData.launchTime).getTime() : NaN
  return Number.isFinite(launchTime) && launchTime <= now
}

function shouldAutoSwitchCountdown(countdown, isSwitchingCountdown) {
  return !!(countdown && countdown.isExpired && !isSwitchingCountdown)
}

function buildCountdownTickState(options = {}) {
  const {
    countdown,
    prevCountdown,
    currentSecondsText,
    nextSecondsText,
    nextSecondsReel
  } = options

  const safeCountdown = countdown || {}
  const prev = prevCountdown || {}
  const reel = Array.isArray(nextSecondsReel) ? nextSecondsReel : []
  const didSecondsChange = nextSecondsText !== currentSecondsText

  if (!didSecondsChange) {
    return {
      didSecondsChange: false,
      shouldAutoSwitch: !!safeCountdown.isExpired,
      immediateState: null,
      settleState: null
    }
  }

  // 每秒 tick 只下发发生变化的字段（dotted path 增量更新），
  // 避免整个 countdown 对象每秒重复 setData 触发全量 diff/渲染
  const immediateState = {
    'countdown.seconds': safeCountdown.seconds,
    countdownSecondsPrev: currentSecondsText,
    countdownSecondsCurrent: nextSecondsText,
    countdownSecondsReel: [currentSecondsText, nextSecondsText, reel[2] || nextSecondsText],
    countdownSecondsRolling: true
  }
  if (prev.minutes !== safeCountdown.minutes) immediateState['countdown.minutes'] = safeCountdown.minutes
  if (prev.hours !== safeCountdown.hours) immediateState['countdown.hours'] = safeCountdown.hours
  if (prev.days !== safeCountdown.days) immediateState['countdown.days'] = safeCountdown.days
  if (!!prev.isExpired !== !!safeCountdown.isExpired) immediateState['countdown.isExpired'] = !!safeCountdown.isExpired

  return {
    didSecondsChange: true,
    shouldAutoSwitch: !!safeCountdown.isExpired,
    immediateState,
    settleState: {
      countdownSecondsPrev: nextSecondsText,
      countdownSecondsCurrent: nextSecondsText,
      countdownSecondsReel: reel,
      countdownSecondsRolling: false
    }
  }
}

function buildCountdownLoopMeta(lastCheckTime, now = Date.now(), intervalMs = 60000) {
  const previous = Number(lastCheckTime) || 0
  const shouldCheckExpired = !previous || now - previous > intervalMs
  return {
    shouldCheckExpired,
    nextLastCheckTime: shouldCheckExpired ? now : previous
  }
}

function buildMissionCardCountdownFields(launchTime, deps = {}) {
  const { getCountdown, formatSecondsText } = deps
  if (!launchTime || typeof getCountdown !== 'function') {
    return {
      days: 0,
      hours: '00',
      minutes: '00',
      seconds: '00',
      isExpired: true
    }
  }

  const cd = getCountdown(launchTime)
  const pad = typeof formatSecondsText === 'function'
    ? formatSecondsText
    : (value) => String(value == null ? 0 : value).padStart(2, '0')

  return {
    days: cd.days,
    hours: pad(cd.hours),
    minutes: pad(cd.minutes),
    seconds: pad(cd.seconds),
    isExpired: !!cd.isExpired
  }
}

/** 窗口挂住中的卡片角标：显示 00:00，避免空白让人以为倒计时跑到下一张 */
function buildHoldConfirmingCardCountdown() {
  return {
    days: 0,
    hours: '00',
    minutes: '00',
    seconds: '00',
    isExpired: false,
    holdConfirming: true
  }
}

function isSameMissionCardCountdown(prev, next) {
  if (!prev && !next) return true
  if (!prev || !next) return false
  return prev.days === next.days
    && prev.hours === next.hours
    && prev.minutes === next.minutes
    && prev.seconds === next.seconds
    && !!prev.isExpired === !!next.isExpired
    && !!prev.holdConfirming === !!next.holdConfirming
}

function resolveMissionCardCountdown(mission, deps = {}) {
  const now = deps.now != null ? deps.now : Date.now()
  const holdId = deps.holdMissionId != null && deps.holdMissionId !== ''
    ? String(deps.holdMissionId)
    : ''
  const record =
    deps.recordsById instanceof Map && mission && mission.id != null
      ? deps.recordsById.get(String(mission.id)) || null
      : null
  if (
    holdId
    && mission
    && String(mission.id) === holdId
    && shouldHoldPastNetCountdownMission(mission, now, record)
  ) {
    return buildHoldConfirmingCardCountdown()
  }
  return buildMissionCardCountdownFields(mission && mission.launchTime, deps)
}

function attachCardCountdownToMissions(missions, limit, deps) {
  const safeLimit = Math.max(0, Number(limit) || 0)
  if (!Array.isArray(missions)) return missions

  return missions.map((mission, index) => {
    if (!mission) return mission
    const showRocketCountdown = index < safeLimit
    if (!showRocketCountdown) {
      if (!mission.showRocketCountdown && !mission.cardCountdown) return mission
      const next = { ...mission }
      delete next.showRocketCountdown
      delete next.cardCountdown
      return next
    }

    const cardCountdown = resolveMissionCardCountdown(mission, deps || {})
    if (mission.showRocketCountdown && isSameMissionCardCountdown(mission.cardCountdown, cardCountdown)) {
      return mission
    }
    return { ...mission, showRocketCountdown: true, cardCountdown }
  })
}

function buildMissionCardCountdownTickPatch(missions, limit, deps) {
  const patch = {}
  const safeLimit = Math.max(0, Number(limit) || 0)
  if (!Array.isArray(missions) || !safeLimit) return patch

  for (let i = 0; i < Math.min(safeLimit, missions.length); i++) {
    const mission = missions[i]
    if (!mission) continue
    const next = resolveMissionCardCountdown(mission, deps || {})
    if (!isSameMissionCardCountdown(mission.cardCountdown, next)) {
      patch[`displayedUpcomingMissions[${i}].cardCountdown`] = next
    }
  }

  return patch
}

function buildUpcomingLaunchEmptyState(options = {}) {
  const {
    message = '暂无即将发射的任务',
    upcomingListState = {}
  } = options

  return {
    launchData: {},
    formattedLaunchTime: '',
    formattedLaunchDate: '',
    formattedLaunchWeekTime: '',
    _countdownSubscribed: false,
    overlapSideCard: null,
    loadError: true,
    errorMessage: message,
    ...upcomingListState,
    missionsLoadError: true,
    missionsErrorMessage: message,
    missionsInitialLoading: false,
    showMissionsEmpty: true
  }
}

function buildUpcomingLaunchErrorState(options = {}) {
  const {
    errorMessage,
    upcomingListState = {},
    showMissionsEmpty = false
  } = options

  return {
    loadError: true,
    errorMessage,
    launchData: {},
    _countdownSubscribed: false,
    overlapSideCard: null,
    ...upcomingListState,
    missionsLoadError: true,
    missionsErrorMessage: errorMessage,
    missionsInitialLoading: false,
    showMissionsEmpty
  }
}

module.exports = {
  formatHomeLaunchTime,
  formatHomeLaunchTimeParts,
  buildHomeLaunchPanelState,
  buildCurrentLaunchPanelState,
  getNextUpcomingLaunch,
  pickCountdownDisplayMission,
  collectPastNetUpcomingHeads,
  withCountdownConfirmingStatus,
  isPastNetMission,
  COUNTDOWN_WINDOW_HOLD_FALLBACK_MS,
  getMissionWindowHoldUntilMs,
  isUnresolvedForCountdownHold,
  shouldHoldPastNetCountdownMission,
  formatOverlapSideCountdownText,
  buildOverlapSideCardView,
  pickOverlapSideCard,
  buildCountdownSubscriptionState,
  buildLaunchSwitchEffects,
  shouldRefreshExpiredLaunch,
  shouldAutoSwitchCountdown,
  buildCountdownTickState,
  buildCountdownLoopMeta,
  buildMissionCardCountdownFields,
  attachCardCountdownToMissions,
  buildMissionCardCountdownTickPatch,
  buildUpcomingLaunchEmptyState,
  buildUpcomingLaunchErrorState,
  mergePreservedRocketImages
}
