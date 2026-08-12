/**
 * 星问富消息：意图识别 + 任务/列表/状态卡片载荷
 */
const {
  getUpcomingStarshipMissions,
  getUpcomingMissions,
  getCompletedMissions,
  searchLaunchesByKeyword
} = require('../../../utils/api-launch-list.js')
const {
  getStarshipStatusFromDB,
  getRocketConfigMeta,
  getStarshipHardwareFromDB
} = require('../../../utils/api-app-services.js')
const { getSubscribedMissions, isSubscribed } = require('../../../utils/subscribe.js')
const { peekOaAlertReady } = require('../../../utils/oa-alert.js')
const { matchWatchPartySession } = require('./watch-party.js')
const { workerProxyUrl } = require('../../../utils/config.js')
const { buildMissionDetailUrl } = require('../../../utils/index-mission-nav.js')
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
const {
  applyContentLangToMission,
  formatMissionListTimeOrUnknown,
  rocketNameForImage
} = require('../../../utils/launch-card-i18n.js')
const { launchCardUiText, isContentLangEn } = require('../../../utils/locale.js')
const {
  aiChatUiText,
  localizeCountryName,
  localizeTimezoneName,
  localizeAgencyType
} = require('./ai-chat-i18n.js')
const { loadCloudMediaMap } = require('../../../utils/image-config.js')
const { ROUTES } = require('../../../utils/routes.js')
const { isFeatureEnabled } = require('../../../utils/feature-flags.js')
const { videoSnapshotUrl, optimizeImageUrl } = require('../../../utils/cos-url.js')
const {
  fetchGlobalSummaryFromCloud,
  fetchGlobalBreakdownFromCloud
} = require('../../../utils/launch-stats-cloud.js')
const { getAgencies, getAgencyDetail } = require('../../../utils/api-monitor-data.js')
const { overrideAgencyLogoUrl } = require('../../../utils/agency-logo-overrides.js')
const { resolveAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')
const {
  translateAgencyName,
  translateLocation,
  translateSpacecraftName
} = require('../../../utils/space-terms-i18n.js')
const { translateRocketName } = require('../../../utils/rocket-name-i18n.js')
const { localizeMissionTitle } = require('../../../utils/mission-title-i18n.js')
const {
  isStarshipMissionLike,
  isUsableMissionForCard,
  isUsableLaunchForCard,
  matchStarshipNextFlightIntent,
  matchStarshipStatusIntent,
  matchLaunchStatsIntent,
  matchLaunchListIntent,
  matchHistoryListIntent,
  matchFlightDemoIntent,
  matchMissionSimIntent,
  matchVehicleTrackerIntent,
  matchRoadClosureIntent,
  matchStationIntent,
  matchAgencyIntent,
  matchMissionLookupIntent,
  matchSetReminderIntent,
  matchMissionReplayIntent,
  matchRocketModelIntent,
  matchLaunchSiteIntent,
  matchSpacecraftIntent,
  matchBoosterIntent,
  matchMyLaunchesIntent,
  matchYearReviewIntent,
  matchLaunchVoteIntent,
  matchApodIntent,
  matchAstroCalendarIntent,
  matchNewsIntent,
  matchStarlinkPassIntent,
  matchStarlinkMapIntent,
  matchMerchantJoinIntent,
  matchViewingSpotIntent,
  matchArtemisIntent,
  matchStarshipHardwareIntent,
  matchRecoveryStatsIntent,
  resolveAiChatRichIntent,
  parseLaunchStatsFocus,
  getBeijingPeriodBounds,
  countLaunchesInBounds,
  pickStarshipMission,
  pickLaunchList,
  pickHistoryList,
  pickStation,
  pickBestMissionMatch,
  pickSoonestUpcomingMission,
  isBareNextLaunchAsk,
  missionLookupTimePreference,
  resolveMissionDetailType,
  pickBestAgencyMatch,
  resolveAgencyFromRocketConfig,
  hasAgencyOwnershipAsk,
  parseLaunchListFilter,
  parseHistoryListFilter,
  buildHistoryCloudSearchKeys,
  launchListFilterLabel,
  extractAgencySearchKey,
  resolveAgencyCanonicalSearchKey,
  detectKnownAgencyCanonical,
  agencyMatchesCanonical,
  AGENCY_CANONICAL_IDS,
  buildLaunchSearchQueries,
  extractMissionSearchKey,
  stripReplayAskNoise,
  extractRocketModelKey,
  extractBoosterSerial,
  pickRocketConfig,
  pickLaunchSite,
  pickSpacecraftConfig,
  pickStarshipHardware,
  parseHardwareVehicleRef,
  enrichLaunchContextWithSpec,
  enrichLaunchContextNoSpec,
  enrichLaunchContextWithMyLaunches,
  enrichLaunchContextNoMyLaunches,
  enrichLaunchContextWithSimpleEntry,
  enrichLaunchContextWithWatchParty,
  enrichLaunchContextWatchPartyClosed,
  enrichLaunchContextWatchPartyFeatureOff,
  enrichLaunchContextWithMerchantJoin,
  enrichLaunchContextMerchantJoinFeatureOff,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule,
  enrichLaunchContextNoMissionLookup,
  enrichLaunchContextWithLaunchList,
  enrichLaunchContextNoLaunchList,
  enrichLaunchContextWithStarshipStatus,
  enrichLaunchContextNoStarshipStatus,
  enrichLaunchContextWithFlightDemo,
  enrichLaunchContextWithVehicleTracker,
  enrichLaunchContextWithMissionSim,
  enrichLaunchContextWithRoadClosure,
  enrichLaunchContextWithStation,
  enrichLaunchContextWithLaunchStats,
  enrichLaunchContextNoLaunchStats,
  enrichLaunchContextWithAgency,
  enrichLaunchContextNoAgency,
  enrichLaunchContextWithMissionReplay,
  enrichLaunchContextNoMissionReplay,
  enrichLaunchContextWithSetReminder,
  stripReminderAskNoise
} = require('./ai-chat-rich-core.js')

const AGENCY_COUNTRY_ZH = {
  China: '中国',
  'United States of America': '美国',
  Russia: '俄罗斯',
  Japan: '日本',
  India: '印度',
  France: '法国',
  Germany: '德国',
  'United Kingdom': '英国',
  'South Korea': '韩国',
  'New Zealand': '新西兰'
}

const DEFAULT_ROCKET_IMAGE = '火箭配置图/default.jpg'

async function resolveChatCardRocketImage(mission) {
  const safe = mission && typeof mission === 'object' ? mission : {}
  try {
    await loadCloudMediaMap()
  } catch (e) {}
  const rocketName = rocketNameForImage(safe) || safe.rocketName || 'Rocket'
  return resolveMissionRocketImage(
    safe.rocketImage || safe.image || '',
    rocketName,
    safe.rocketConfiguration,
    true
  ) || resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE, rocketName, safe.rocketConfiguration, true) || ''
}

async function toChatMissionCard(mission, detailType, options) {
  const starshipOnly = !(options && options.anyLaunch)
  const usable = starshipOnly ? isUsableMissionForCard(mission) : isUsableLaunchForCard(mission)
  if (!usable) return null
  const type = detailType === 'completed' ? 'completed' : 'upcoming'
  const localized = applyContentLangToMission(Object.assign({}, mission || {}))
  const name = localized.missionName || localized.name || launchCardUiText('launchMission')
  const rocketName = localized.rocketName || ''
  const rocketImage = await resolveChatCardRocketImage(localized)
  const formattedTime = localized.formattedTime || formatMissionListTimeOrUnknown(localized.launchTime)
  return {
    cardType: 'mission',
    id: String(localized.id),
    name,
    rocketName,
    rocketImage: rocketImage || '',
    rocketConfiguration: localized.rocketConfiguration || null,
    launchTime: localized.launchTime || '',
    formattedTime,
    statusText: localized.statusBadgeText || localized.status || launchCardUiText('planned'),
    statusCategory: localized.statusCategory || 'pending',
    padLocation: localized.padLocation || localized.launchSite || '',
    launchAgency: localized.launchAgency || '',
    detailType: type,
    detailUrl: buildMissionDetailUrl({ id: localized.id, detailType: type })
  }
}

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

/**
 * 即将发射列表卡（支持按发射场 / 国家 / 发射商筛选；默认只出未来 60 天）
 * @returns {Promise<{card: object|null, scheduled: boolean, listFilter?: object|null}>}
 */
async function resolveLaunchListCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const limit = opts.limit || 5
  const listFilter = opts.listFilter != null
    ? opts.listFilter
    : parseLaunchListFilter(opts.queryText || '')
  // 60 天窗口 + 国家/场站筛：多拉 upcoming 再本地裁剪
  const fetchLimit = Math.max(100, limit * 12)
  const withinDays = (listFilter && listFilter.withinDays) || 60
  let list = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  if (!list.length) {
    try {
      const res = await getUpcomingMissions(fetchLimit, 0)
      list = (res && res.list) || []
    } catch (e) {
      list = []
    }
  }
  let picked = pickLaunchList(list, limit, listFilter || undefined)

  // 有国家/场站/机构筛且本地不足时探云（仅 upcoming + 60 天内；最多 2 词早停）
  const needCloud = listFilter && (listFilter.country || listFilter.siteKey || listFilter.agencyKey)
  if (needCloud && picked.length < Math.min(2, limit)) {
    const cloudKeys = []
    const pushKey = (s) => {
      const t = String(s || '').trim()
      if (!t || cloudKeys.length >= 2) return
      if (cloudKeys.some((k) => k.toLowerCase() === t.toLowerCase())) return
      cloudKeys.push(t)
    }
    if (listFilter.agencyKey) pushKey(listFilter.agencyKey)
    if (listFilter.country === '中国') pushKey('China')
    else if (listFilter.country) pushKey(listFilter.country)
    pushKey(launchListFilterLabel(listFilter))
    const cloudPool = list.slice()
    for (let i = 0; i < cloudKeys.length && picked.length < limit; i++) {
      try {
        const res = await searchLaunchesByKeyword(cloudKeys[i], {
          limit: 24,
          withinDays,
          upcomingOnly: true
        })
        const rows = (res && res.list) || []
        for (let j = 0; j < rows.length; j++) {
          const id = rows[j] && rows[j].id != null ? String(rows[j].id) : ''
          if (!id || cloudPool.some((m) => String(m && m.id) === id)) continue
          cloudPool.push(rows[j])
        }
        picked = pickLaunchList(cloudPool, limit, listFilter || undefined)
      } catch (e) {}
    }
  }

  if (!picked.length) return { card: null, scheduled: false, listFilter: listFilter || null }

  const upcomingItemCards = await Promise.all(
    picked.map((m) => toChatMissionCard(m, 'upcoming', { anyLaunch: true }))
  )
  const items = upcomingItemCards.filter(Boolean)
  if (!items.length) return { card: null, scheduled: false, listFilter: listFilter || null }

  const filterLabel = launchListFilterLabel(listFilter)
  const upcomingLabel = launchCardUiText('upcoming')
  return {
    card: {
      cardType: 'launch_list',
      id: 'launch_list_' + items[0].id,
      title: filterLabel
        ? (isContentLangEn() ? (filterLabel + ' · ' + upcomingLabel) : (filterLabel + upcomingLabel))
        : upcomingLabel,
      items,
      moreUrl: ROUTES.INDEX,
      listFilter: listFilter || null,
      listMode: 'upcoming'
    },
    scheduled: true,
    listFilter: listFilter || null
  }
}

/**
 * 历史发射列表卡（已完成任务；可按火箭/场站/国家/发射商筛）
 */
async function resolveHistoryListCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const limit = opts.limit || 5
  const listFilter = opts.listFilter != null
    ? opts.listFilter
    : parseHistoryListFilter(opts.queryText || '')
  const fetchLimit = Math.max(80, limit * 16)
  let list = Array.isArray(opts.completedHint) ? opts.completedHint.slice() : []
  if (!list.length) {
    try {
      const res = await getCompletedMissions(fetchLimit, 0)
      list = (res && res.list) || []
    } catch (e) {
      list = []
    }
  }
  let picked = pickHistoryList(list, limit, listFilter || undefined)

  // 本地不足才探云：最多 2 个关键词、串行早停，避免 search 风暴
  const needCloud = listFilter && (listFilter.country || listFilter.siteKey ||
    listFilter.agencyKey || listFilter.rocketKey)
  if (needCloud && picked.length < Math.min(2, limit)) {
    const cloudKeys = buildHistoryCloudSearchKeys(listFilter, opts.queryText || '')
    const cloudPool = list.slice()
    for (let i = 0; i < cloudKeys.length && picked.length < limit; i++) {
      try {
        const res = await searchLaunchesByKeyword(cloudKeys[i], {
          limit: 24,
          completedOnly: true
        })
        const rows = (res && res.list) || []
        for (let j = 0; j < rows.length; j++) {
          const id = rows[j] && rows[j].id != null ? String(rows[j].id) : ''
          if (!id || cloudPool.some((m) => String(m && m.id) === id)) continue
          cloudPool.push(rows[j])
        }
        picked = pickHistoryList(cloudPool, limit, listFilter || undefined)
      } catch (e) {}
    }
  }

  if (!picked.length) return { card: null, scheduled: false, listFilter: listFilter || null }

  const itemCards = await Promise.all(
    picked.map((m) => toChatMissionCard(m, 'completed', { anyLaunch: true }))
  )
  const items = itemCards.filter(Boolean)
  if (!items.length) return { card: null, scheduled: false, listFilter: listFilter || null }

  const filterLabel = launchListFilterLabel(listFilter)
  const historyLabel = launchCardUiText('previous')
  return {
    card: {
      cardType: 'launch_list',
      id: 'history_list_' + items[0].id,
      title: filterLabel
        ? (isContentLangEn() ? (filterLabel + ' · ' + historyLabel) : (filterLabel + historyLabel))
        : historyLabel,
      items,
      moreUrl: ROUTES.SEARCH,
      listFilter: listFilter || null,
      listMode: 'history',
      timeBucket: 'completed'
    },
    scheduled: true,
    listFilter: listFilter || null
  }
}

/**
 * 星舰 B/S 状态卡
 * @returns {Promise<{card: object|null, scheduled: boolean}>}
 */
/**
 * 当前组合体编号取自「星舰硬件设施」列表头两条（NSF 同步，手工 starshipStatus 常滞后）
 * @returns {Promise<{ booster: object|null, ship: object|null }>}
 */
async function resolveCurrentStackUnits(hardwareHint) {
  let vehicles = Array.isArray(hardwareHint) ? hardwareHint : null
  if (!vehicles) {
    try {
      const res = await getStarshipHardwareFromDB()
      vehicles = (res && res.vehicles) || []
    } catch (e) {
      vehicles = []
    }
  }
  const out = { booster: null, ship: null }
  // 先认列表头两条（页面首屏那两张卡）；若头部是工位等非载具条目，再全表兜底
  ;[vehicles.slice(0, 2), vehicles].forEach((pool) => {
    pool.forEach((v) => {
      const ref = parseHardwareVehicleRef(v && v.name)
      if (!ref) return
      const unit = {
        name: String(v.name || '').trim(),
        num: ref.num,
        status: String(v.statusZh || v.status || '').trim()
      }
      if (ref.kind === 'booster' && !out.booster) out.booster = unit
      else if (ref.kind === 'ship' && !out.ship) out.ship = unit
    })
  })
  return out
}

/**
 * 硬件表编号覆盖手工状态：编号一致时保留原状态与进度，
 * 换代了就改用硬件表状态并清掉进度（旧进度不属于新单元）
 */
function mergeStackUnit(current, unit) {
  if (!unit || !unit.name) return current
  const ref = parseHardwareVehicleRef(current && current.id)
  const sameUnit = !!(ref && ref.num === unit.num)
  return {
    id: unit.name,
    status: sameUnit ? current.status : (unit.status || current.status),
    progress: sameUnit ? current.progress : null
  }
}

async function resolveStarshipStatusCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  let status = opts.cachedStatus || null
  if (!status) {
    try {
      status = await getStarshipStatusFromDB()
    } catch (e) {
      status = null
    }
  }
  if (!status || (!status.booster && !status.ship)) {
    return { card: null, scheduled: false }
  }

  const booster = status.booster || {}
  const ship = status.ship || {}
  const checklistItems = Array.isArray(status.flightReadinessChecklist)
    ? status.flightReadinessChecklist
    : []
  const checklistTotal = checklistItems.length
  const checklistDone = checklistItems.filter((it) => it && (it.done || it.completed || it.checked)).length

  const clampProgress = (n) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return null
    return Math.max(0, Math.min(100, Math.round(v)))
  }

  const stack = await resolveCurrentStackUnits(opts.hardwareHint)
  const statusPending = aiChatUiText('statusPendingUpdate')
  const boosterView = mergeStackUnit({
    id: booster.id || '',
    status: booster.status || statusPending,
    progress: clampProgress(booster.progress)
  }, stack.booster)
  const shipView = mergeStackUnit({
    id: ship.id || '',
    status: ship.status || statusPending,
    progress: clampProgress(ship.progress)
  }, stack.ship)

  return {
    card: {
      cardType: 'starship_status',
      id: 'starship_status',
      title: aiChatUiText('starshipStackTitle'),
      booster: {
        id: boosterView.id,
        status: boosterView.status || statusPending,
        progress: boosterView.progress,
        progressStyle: boosterView.progress != null
          ? ('width: ' + boosterView.progress + '%;')
          : ''
      },
      ship: {
        id: shipView.id,
        status: shipView.status || statusPending,
        progress: shipView.progress,
        progressStyle: shipView.progress != null
          ? ('width: ' + shipView.progress + '%;')
          : ''
      },
      checklist: checklistTotal
        ? {
          done: checklistDone,
          total: checklistTotal,
          text: aiChatUiText('flightChecklist', { done: checklistDone, total: checklistTotal })
        }
        : null,
      detailUrl: ROUTES.PROGRESS
    },
    scheduled: true
  }
}

/**
 * 飞行演示入口卡（可带关联任务 id，页内自拉时间线）
 */
function resolveFlightDemoEntryCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  let mission = null
  if (isUsableMissionForCard(opts.cached)) mission = opts.cached
  if (!mission) mission = pickStarshipMission(opts.upcomingHint, opts.trackedId)
  if (!mission && Array.isArray(opts.upcomingHint) && opts.upcomingHint[0]) {
    mission = isUsableLaunchForCard(opts.upcomingHint[0]) ? opts.upcomingHint[0] : null
  }

  const missionId = mission && mission.id != null ? String(mission.id).trim() : ''
  const detailType = 'upcoming'
  const localized = mission ? applyContentLangToMission(Object.assign({}, mission)) : null
  const missionName = localized
    ? String(localized.missionName || localized.name || '').trim()
    : ''
  const parts = []
  if (missionId) {
    parts.push('id=' + encodeURIComponent(missionId))
    parts.push('type=' + detailType)
  }
  if (missionName) parts.push('name=' + encodeURIComponent(missionName.slice(0, 80)))
  const detailUrl = '/subpackages/mission-sim/flight-demo' + (parts.length ? '?' + parts.join('&') : '')

  return {
    card: {
      cardType: 'entry',
      entryKind: 'flight_demo',
      id: 'entry_flight_demo',
      tag: aiChatUiText('tagFlightProfile'),
      title: aiChatUiText('flightDemoTitle'),
      desc: missionName
        ? aiChatUiText('flightDemoDescLinked', { name: missionName })
        : aiChatUiText('flightDemoDesc'),
      cta: aiChatUiText('flightDemoCta'),
      variant: 'demo',
      missionId,
      detailType,
      missionName,
      detailUrl,
      gateProductId: 'mission_sim',
      gateProductName: aiChatUiText('flightDemoTitle'),
      needMissionSimFlag: true
    },
    scheduled: true
  }
}

/** 在轨飞行器追踪入口卡 */
function resolveVehicleTrackerEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'vehicle_tracker',
      id: 'entry_vehicle_tracker',
      tag: aiChatUiText('tagVehicleTracker'),
      title: aiChatUiText('vehicleTrackerTitle'),
      desc: aiChatUiText('vehicleTrackerDesc'),
      cta: aiChatUiText('vehicleTrackerCta'),
      variant: 'tracker',
      detailUrl: ROUTES.VEHICLE_TRACKER,
      gateProductId: 'orbital_data_center',
      gateProductName: aiChatUiText('vehicleTrackerGate'),
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 星舰任务指挥室入口卡 */
function resolveMissionSimEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'mission_sim',
      id: 'entry_mission_sim',
      tag: aiChatUiText('tagMissionSim'),
      title: aiChatUiText('missionSimTitle'),
      desc: aiChatUiText('missionSimDesc'),
      cta: aiChatUiText('missionSimCta'),
      variant: 'sim',
      detailUrl: '/subpackages/mission-sim/mission-sim',
      gateProductId: 'mission_sim',
      gateProductName: aiChatUiText('missionSimTitle'),
      needMissionSimFlag: true
    },
    scheduled: true
  }
}

/** 无 B/S 数据时：仍给出可点的星舰进度入口，避免「进展」空手 */
function resolveStarshipProgressEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'starship_progress',
      id: 'entry_starship_progress',
      tag: aiChatUiText('tagStarshipProgress'),
      title: aiChatUiText('starshipProgressTitle'),
      desc: aiChatUiText('starshipProgressDesc'),
      cta: aiChatUiText('starshipProgressCta'),
      variant: 'demo',
      detailUrl: ROUTES.PROGRESS,
      useSwitchTab: true,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

function _mergeMissionPool(pool, rows, detailType) {
  if (!Array.isArray(rows)) return
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]
    if (!m) continue
    pool.push(Object.assign({}, m, {
      _detailType: m._detailType || detailType || 'upcoming'
    }))
  }
}

function _dedupeMissions(pool) {
  const seen = {}
  const deduped = []
  for (let i = 0; i < pool.length; i++) {
    const m = pool[i]
    const id = m && m.id != null ? String(m.id) : ''
    if (!id || seen[id]) continue
    seen[id] = true
    deduped.push(m)
  }
  return deduped
}

function fetchMissionReplayDoc(launchId) {
  const id = launchId != null ? String(launchId).trim() : ''
  if (!id) return Promise.resolve(null)
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'missionReplay', launchId: id },
      success: (res) => {
        const r = res && res.result
        resolve((r && r.success && r.data) ? r.data : null)
      },
      fail: () => resolve(null)
    })
  })
}

function pickReplayClipFromDoc(data) {
  if (!data || typeof data !== 'object') return null
  const cosExpireAt = Number(data.cosExpireAt) || 0
  if (cosExpireAt > 0 && Date.now() > cosExpireAt) return null
  const clips = Array.isArray(data.clips) ? data.clips : []
  for (let i = 0; i < clips.length; i += 1) {
    const c = clips[i]
    if (c && c.videoUrl) {
      const dur = Number(c.durationSec) || 0
      return {
        videoUrl: String(c.videoUrl),
        poster: c.thumbnailUrl
          ? optimizeImageUrl(c.thumbnailUrl, 'thumb')
          : videoSnapshotUrl(c.videoUrl, 1),
        publisher: c.publisher || '',
        durationSec: dur,
        title: c.title || aiChatUiText('clipHighlight')
      }
    }
  }
  if (data.videoUrl) {
    return {
      videoUrl: String(data.videoUrl),
      poster: videoSnapshotUrl(data.videoUrl, 30),
      publisher: data.sourcePublisher || '',
      durationSec: Number(data.durationSec) || 0,
      title: aiChatUiText('clipReplay')
    }
  }
  return null
}

/**
 * 在本地/云端池中定位任务（回放优先已完成）
 */
async function findMissionMatchForQuery(options, queryText) {
  const opts = options && typeof options === 'object' ? options : {}
  const upcoming = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  const completed = Array.isArray(opts.completedHint) ? opts.completedHint : []
  let pool = []

  _mergeMissionPool(pool, completed, 'completed')
  _mergeMissionPool(pool, upcoming, 'upcoming')

  try {
    const [compRes, upRes] = await Promise.all([
      getCompletedMissions(100, 0).catch(() => ({ list: [] })),
      getUpcomingMissions(60, 0).catch(() => ({ list: [] }))
    ])
    _mergeMissionPool(pool, compRes.list, 'completed')
    _mergeMissionPool(pool, upRes.list, 'upcoming')
  } catch (e) {}

  let deduped = _dedupeMissions(pool)
  const queries = buildLaunchSearchQueries(queryText)
  let hit = pickBestMissionMatch(deduped, queryText)
  // 中文实体 → Gravity-1 等英文别名，先在本地池再打一轮
  if (!hit || !hit.mission) {
    for (let i = 0; i < queries.length; i++) {
      hit = pickBestMissionMatch(deduped, queries[i])
      if (hit && hit.mission) break
    }
  }

  if (!hit || !hit.mission) {
    const cloudPool = []
    for (let i = 0; i < queries.length; i++) {
      try {
        const res = await searchLaunchesByKeyword(queries[i], { limit: 24 })
        _mergeMissionPool(cloudPool, res && res.list, null)
      } catch (e) {}
      const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText) ||
        pickBestMissionMatch(_dedupeMissions(cloudPool), queries[i])
      if (cloudHit && cloudHit.mission) {
        hit = cloudHit
        break
      }
    }
    if ((!hit || !hit.mission) && cloudPool.length) {
      hit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
      if (!hit || !hit.mission) {
        for (let i = 0; i < queries.length; i++) {
          hit = pickBestMissionMatch(_dedupeMissions(cloudPool), queries[i])
          if (hit && hit.mission) break
        }
      }
    }
  }
  return hit && hit.mission ? hit : null
}

/**
 * 发射集锦/回放视频卡：问「引力一号回放」→ 封面卡 + 门控播放
 */
async function resolveMissionReplayCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const rawQuery = opts.queryText || opts.text || ''
  const queryText = stripReplayAskNoise(rawQuery) || rawQuery

  let enabled = true
  try {
    enabled = await isFeatureEnabled('enableMissionReplay', { failClosed: true })
  } catch (e) {
    enabled = false
  }
  if (!enabled) return { card: null, scheduled: false, disabled: true }

  const hit = await findMissionMatchForQuery(opts, queryText)
  if (!hit || !hit.mission) return { card: null, scheduled: false }

  const mission = applyContentLangToMission(Object.assign({}, hit.mission))
  const launchId = String(mission.id)
  const missionName = String(mission.missionName || mission.name || '').trim()
  const detailType = hit.detailType === 'upcoming' ? 'upcoming' : 'completed'
  const rocketImage = await resolveChatCardRocketImage(mission)

  const replayDoc = await fetchMissionReplayDoc(launchId)
  const clip = pickReplayClipFromDoc(replayDoc)
  const playable = !!(clip && clip.videoUrl)
  const poster = (clip && clip.poster) || rocketImage || ''
  const publisher = (clip && clip.publisher) || ''
  const dur = clip && clip.durationSec ? Number(clip.durationSec) : 0
  const durationText = dur > 0
    ? (Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'))
    : ''
  const subParts = []
  if (publisher) subParts.push(publisher)
  if (durationText) subParts.push(durationText)
  subParts.push(playable ? aiChatUiText('highlightReel') : aiChatUiText('replayEntry'))

  return {
    card: {
      cardType: 'mission_replay',
      id: 'mission_replay_' + launchId,
      launchId,
      missionName,
      detailType,
      title: aiChatUiText('replayTitle', {
        name: missionName || aiChatUiText('launchMission')
      }),
      desc: playable
        ? subParts.join(' · ')
        : aiChatUiText('replayDescPending'),
      cta: playable ? aiChatUiText('watchHighlightsCta') : aiChatUiText('openDetailCta'),
      poster,
      /** 仅供点击后写入 pendingEventVideo；卡片层只用 poster，不预加载 */
      videoUrl: playable ? clip.videoUrl : '',
      playable,
      gateProductId: 'mission_replay',
      gateProductName: aiChatUiText('missionReplayGate'),
      rocketImage
    },
    scheduled: true
  }
}

/**
 * 通用任务检索卡：问谁显示谁（朱雀三号 / Falcon 9 / Starlink…）
 * 策略：本地扩大窗口 → 未命中再 LL2 云端 search
 */
async function resolveMissionLookupCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  const upcoming = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  const completed = Array.isArray(opts.completedHint) ? opts.completedHint : []
  let pool = []

  _mergeMissionPool(pool, upcoming, 'upcoming')
  _mergeMissionPool(pool, completed, 'completed')

  // 先判时间倾向：历史问法只扩 completed，避免无谓拉 upcoming
  const prefer = missionLookupTimePreference(queryText)
  try {
    if (prefer === 'completed') {
      const compRes = await getCompletedMissions(100, 0).catch(() => ({ list: [] }))
      _mergeMissionPool(pool, compRes.list, 'completed')
    } else if (prefer === 'upcoming') {
      const upRes = await getUpcomingMissions(100, 0).catch(() => ({ list: [] }))
      _mergeMissionPool(pool, upRes.list, 'upcoming')
    } else {
      const [upRes, compRes] = await Promise.all([
        getUpcomingMissions(100, 0).catch(() => ({ list: [] })),
        getCompletedMissions(80, 0).catch(() => ({ list: [] }))
      ])
      _mergeMissionPool(pool, upRes.list, 'upcoming')
      _mergeMissionPool(pool, compRes.list, 'completed')
    }
  } catch (e) {}

  let deduped = _dedupeMissions(pool)
  // 「下一次发射」裸问：直接抽最近一场 upcoming 任务卡（不依赖实体检索串）
  if (isBareNextLaunchAsk(queryText)) {
    if (!deduped.some((m) => resolveMissionDetailType(m) !== 'completed')) {
      try {
        const upRes = await getUpcomingMissions(100, 0).catch(() => ({ list: [] }))
        _mergeMissionPool(pool, upRes.list, 'upcoming')
        deduped = _dedupeMissions(pool)
      } catch (e) {}
    }
    const next = pickSoonestUpcomingMission(deduped)
    if (!next) return { card: null, scheduled: false }
    const card = await toChatMissionCard(next, 'upcoming', { anyLaunch: true })
    return { card, scheduled: !!card }
  }
  let hit = pickBestMissionMatch(deduped, queryText)
  if (hit && prefer && hit.detailType !== prefer) hit = null

  // 云端回退：本地未命中时按中英查询词打 LL2 search（最多 2 词，早停）
  if (!hit || !hit.mission) {
    const queries = buildLaunchSearchQueries(queryText).slice(0, 2)
    const cloudPool = []
    for (let i = 0; i < queries.length; i++) {
      try {
        // 未来问法先只搜 upcoming；历史问法只搜 previous，避免串成即将发射
        const searchOpts = { limit: 24 }
        if (prefer === 'upcoming') searchOpts.upcomingOnly = true
        if (prefer === 'completed') searchOpts.completedOnly = true
        const res = await searchLaunchesByKeyword(queries[i], searchOpts)
        _mergeMissionPool(cloudPool, res && res.list, prefer || null)
      } catch (e) {}
      const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText, { prefer: prefer || '' })
      if (cloudHit && cloudHit.mission) {
        hit = cloudHit
        break
      }
    }
    // upcoming 侧仍无命中：最多再搜 1 词放开窗口（含 previous），至少给出历史任务卡
    if ((!hit || !hit.mission) && prefer === 'upcoming' && queries[0]) {
      try {
        const res = await searchLaunchesByKeyword(queries[0], { limit: 24 })
        _mergeMissionPool(cloudPool, res && res.list, null)
      } catch (e) {}
      const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
      if (cloudHit && cloudHit.mission) hit = cloudHit
    }
    if ((!hit || !hit.mission) && cloudPool.length) {
      hit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText, { prefer: prefer || '' })
    }
    // 仅 upcoming 无排期时回落本地全池；历史问法禁止回落到即将发射
    if ((!hit || !hit.mission) && prefer === 'upcoming') {
      // 本地 initially 未拉 completed：此时补一枪 completed 再回落
      if (!deduped.some((m) => resolveMissionDetailType(m) === 'completed')) {
        try {
          const compRes = await getCompletedMissions(60, 0).catch(() => ({ list: [] }))
          _mergeMissionPool(pool, compRes.list, 'completed')
          deduped = _dedupeMissions(pool)
        } catch (e) {}
      }
      hit = pickBestMissionMatch(deduped, queryText, { prefer: '' })
    }
  }

  if (!hit || !hit.mission) return { card: null, scheduled: false }
  const card = await toChatMissionCard(hit.mission, hit.detailType, { anyLaunch: true })
  return { card, scheduled: !!card }
}

function buildReminderResultCard(missionCard, status) {
  const st = String(status || 'need_auth')
  const name = (missionCard && (missionCard.name || missionCard.missionName)) || '该任务'
  const titleMap = {
    success: '提醒已开启',
    already: '提醒已开启',
    oa_ready: '自动提醒已生效',
    need_auth: '待确认开启提醒',
    failed: '提醒开启失败',
    past: '无法设置提醒',
    no_mission: '未找到任务'
  }
  const descMap = {
    success: '发射前将通过微信通知你',
    already: '你已订阅该任务提醒',
    oa_ready: '服务号会自动推送发射前与结果通知',
    need_auth: '点击本卡完成微信授权即可开启',
    failed: '可点击本卡重试，或打开任务详情再开',
    past: '历史任务不能再设发射前提醒',
    no_mission: '请补充火箭或任务名称后再试'
  }
  const ok = st === 'success' || st === 'already' || st === 'oa_ready'
  return {
    cardType: 'reminder',
    id: 'reminder_' + (missionCard && missionCard.id ? missionCard.id : 'none') + '_' + st,
    status: st,
    ok: !!ok,
    title: titleMap[st] || '发射提醒',
    desc: descMap[st] || '',
    missionName: name,
    rocketName: (missionCard && missionCard.rocketName) || '',
    rocketImage: (missionCard && missionCard.rocketImage) || '',
    launchTime: (missionCard && missionCard.launchTime) || '',
    formattedTime: (missionCard && missionCard.formattedTime) || '',
    padLocation: (missionCard && missionCard.padLocation) || '',
    detailType: (missionCard && missionCard.detailType) || 'upcoming',
    detailUrl: (missionCard && missionCard.detailUrl) || '',
    missionId: missionCard && missionCard.id ? String(missionCard.id) : '',
    cta: st === 'need_auth' || st === 'failed'
      ? '点击开启提醒'
      : (missionCard && missionCard.detailUrl ? '查看任务详情' : '知道了')
  }
}

/**
 * 「提醒我一下」：定位即将发射任务 → 返回提醒卡；需授权时由组件侧自动 subscribe
 */
async function resolveSetReminderCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  const cleaned = stripReminderAskNoise(queryText) || queryText
  // 强制走即将发射检索（避免命中历史任务）
  const lookupQuery = cleaned + (/什么时候|即将|下次|下一次/.test(cleaned) ? '' : ' 什么时候发射')
  const resolved = await resolveMissionLookupCard({ ...opts, queryText: lookupQuery })
  if (!resolved || !resolved.card) {
    const card = buildReminderResultCard(null, 'no_mission')
    return { card, scheduled: true, subscribeMission: null, rawMission: null }
  }
  const missionCard = resolved.card
  if (missionCard.detailType === 'completed') {
    const card = buildReminderResultCard(missionCard, 'past')
    return { card, scheduled: true, subscribeMission: null, rawMission: null }
  }

  let status = 'need_auth'
  try {
    if (peekOaAlertReady()) status = 'oa_ready'
    else if (missionCard.id && isSubscribed(missionCard.id)) status = 'already'
  } catch (e) {}

  const card = buildReminderResultCard(missionCard, status)
  // 供组件调用 subscribeLaunchForChat 的原始任务字段
  const rawMission = {
    id: missionCard.id,
    name: missionCard.name,
    missionName: missionCard.name,
    rocketName: missionCard.rocketName,
    launchTime: missionCard.launchTime,
    windowStart: missionCard.launchTime,
    padLocation: missionCard.padLocation
  }
  return {
    card,
    scheduled: true,
    subscribeMission: status === 'need_auth' ? rawMission : null,
    rawMission
  }
}

function buildLaunchStatsDetailUrl(year, country) {
  const parts = []
  if (year) parts.push('year=' + encodeURIComponent(String(year)))
  if (country) parts.push('country=' + encodeURIComponent(String(country)))
  return ROUTES.GLOBAL_LAUNCH_STATS + (parts.length ? '?' + parts.join('&') : '')
}

/** 云统计拉取软超时：失败/超时返回 null，不阻塞出卡 */
function softStatsFetch(promise, ms) {
  const wait = Number(ms) > 0 ? Number(ms) : 2500
  let timer = null
  return Promise.race([
    Promise.resolve(promise).then((v) => {
      if (timer) clearTimeout(timer)
      return v
    }).catch(() => {
      if (timer) clearTimeout(timer)
      return null
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), wait)
    })
  ])
}

function scopeLabelOf(scope, year) {
  if (scope === 'today') return aiChatUiText('scopeToday')
  if (scope === 'week') return aiChatUiText('scopeWeek')
  if (scope === 'month') return aiChatUiText('scopeMonth')
  const nowYear = new Date().getUTCFullYear()
  if (Number(year) === nowYear) return aiChatUiText('scopeThisYear')
  return aiChatUiText('scopeYear', { year })
}

/**
 * 发射统计卡：年度汇总 / 今日·本周·本月本地计数 → 全球发射统计详情
 */
async function resolveLaunchStatsCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  const focus = parseLaunchStatsFocus(queryText)
  const year = focus.year
  const country = focus.country || ''
  const scope = focus.scope || 'year'
  const countryKey = country || '_all'
  const countryLabel = localizeCountryName(country || '全球')
  const scopeLabel = scopeLabelOf(scope, year)

  let total = 0
  let success = 0
  let failure = 0
  let yearTotal = null
  let dataReady = false
  let topCountries = []

  if (scope === 'year') {
    const sumRes = await softStatsFetch(
      fetchGlobalSummaryFromCloud({ year, countryKey }),
      2500
    )
    const summary = sumRes && sumRes.summary ? sumRes.summary : null
    if (summary) {
      total = Number(summary.total) || 0
      success = Number(summary.success) || 0
      failure = Number(summary.failure) || 0
      dataReady = true
    }
    if (!country) {
      const bd = await softStatsFetch(
        fetchGlobalBreakdownFromCloud({ year, countryKey: '_all' }),
        2000
      )
      const rows = bd && Array.isArray(bd.byCountry) ? bd.byCountry : []
      topCountries = rows.slice(0, 3).map((r) => ({
        name: r.name || r.key || '',
        total: r.total != null ? r.total : (r.count != null ? r.count : 0)
      })).filter((r) => r.name)
    }
  } else {
    const bounds = getBeijingPeriodBounds(scope)
    let list = Array.isArray(opts.completedHint) ? opts.completedHint.slice() : []
    if (!list.length) {
      try {
        const res = await softStatsFetch(getCompletedMissions(120, 0), 2000)
        list = (res && res.list) || []
      } catch (e) {}
    }
    const counted = countLaunchesInBounds(list, bounds, country || null)
    total = counted.total
    success = counted.success
    failure = counted.failure
    dataReady = true
    const sumRes = await softStatsFetch(
      fetchGlobalSummaryFromCloud({ year, countryKey }),
      2000
    )
    const summary = sumRes && sumRes.summary ? sumRes.summary : null
    if (summary && summary.total != null) yearTotal = Number(summary.total) || 0
  }

  const title = scope === 'year'
    ? (country
      ? aiChatUiText('statsTitleYearCountry', { year, country: countryLabel })
      : aiChatUiText('statsTitleYearGlobal', { year }))
    : aiChatUiText('statsTitleScope', {
      scope: scopeLabel,
      country: countryLabel,
      countryLabel
    })

  const subtitle = !dataReady
    ? aiChatUiText('statsSubtitlePending')
    : (yearTotal != null
      ? aiChatUiText('statsYearTotal', { n: yearTotal })
      : (topCountries.length
        ? ('Top：' + topCountries.map((r) => r.name + ' ' + r.total).join(' · '))
        : ''))

  return {
    card: {
      cardType: 'launch_stats',
      id: 'launch_stats_' + year + '_' + (country || 'global') + '_' + scope,
      title,
      scopeLabel,
      countryLabel,
      year,
      countryKey: country || '',
      total,
      success,
      failure,
      yearTotal,
      topCountries,
      subtitle,
      dataReady,
      cta: aiChatUiText('statsCta'),
      detailUrl: buildLaunchStatsDetailUrl(year, country || ''),
      gateProductId: 'global_launch_stats',
      gateProductName: aiChatUiText('statsGate')
    },
    scheduled: true
  }
}

function softAgencyFetch(promise, ms) {
  const wait = Number(ms) > 0 ? Number(ms) : 2500
  let timer = null
  return Promise.race([
    Promise.resolve(promise).then((v) => {
      if (timer) clearTimeout(timer)
      return v
    }).catch(() => {
      if (timer) clearTimeout(timer)
      return null
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), wait)
    })
  ])
}

function toAgencyChatCard(agency) {
  if (!agency || agency.id == null) return null
  const name = agency.name || aiChatUiText('agencyFallback')
  const abbrev = agency.abbrev || ''
  const displayName = translateAgencyName(name, abbrev) || abbrev || name
  const typeName = agency.type && agency.type.name ? agency.type.name : ''
  const typeZh = localizeAgencyType(typeName) || typeName || ''
  const countryName = agency.country && agency.country[0] ? agency.country[0].name : ''
  const countryLabel = isContentLangEn()
    ? (countryName || '')
    : (AGENCY_COUNTRY_ZH[countryName] || localizeCountryName(countryName) || countryName || '')
  const foundingYear = agency.founding_year || null
  const total = agency.total_launch_count != null ? Number(agency.total_launch_count) : null
  const success = agency.successful_launches != null ? Number(agency.successful_launches) : null
  const successRateText = (total > 0 && success != null)
    ? (Math.round((success / total) * 100) + '%')
    : ''
  const logoRaw = agency.logo
    ? (agency.logo.thumbnail_url || agency.logo.image_url || '')
    : ''
  const logoUrl = overrideAgencyLogoUrl(agency, logoRaw) || logoRaw
  const logoBgTone = logoUrl ? resolveAgencyLogoBgTone(logoUrl) : ''
  const desc = String(agency.description || '').trim()
  const descShort = desc.length > 72 ? (desc.slice(0, 72) + '…') : desc
  const metaParts = []
  if (countryLabel) metaParts.push(countryLabel)
  if (foundingYear) metaParts.push(aiChatUiText('agencyFounded', { year: foundingYear }))
  if (total != null) metaParts.push(aiChatUiText('agencyHistoryLaunches', { n: total }))

  return {
    cardType: 'agency',
    id: String(agency.id),
    name,
    abbrev,
    displayName,
    typeZh,
    countryLabel,
    foundingYear,
    totalLaunchCount: total,
    successfulLaunches: success,
    successRateText,
    logoUrl: logoUrl || '',
    logoBgTone,
    metaLine: metaParts.join(' · '),
    desc: descShort,
    cta: aiChatUiText('agencyCta'),
    detailUrl: ROUTES.AGENCY_DETAIL + '?id=' + encodeURIComponent(String(agency.id)),
    gateProductId: 'agency_encyclopedia',
    gateProductName: aiChatUiText('agencyGate')
  }
}

/**
 * 发射商信息卡：本地图鉴模糊匹配 → search 回退 → 型号归属时按构型 manufacturer 反查
 */
async function resolveAgencyLookupCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  const key = extractAgencySearchKey(queryText) || String(queryText || '').trim()
  // 中文别名优先用英文 canonical 搜（中国航天科技集团 → casc），避免云端乱配
  const searchKey = resolveAgencyCanonicalSearchKey(queryText) || key
  const knownCanon = detectKnownAgencyCanonical(queryText)
  const ownershipAsk = hasAgencyOwnershipAsk(queryText)

  let list = Array.isArray(opts.agencyHint) ? opts.agencyHint.filter((a) => a && a.id != null) : []
  if (!list.length) {
    const cached = await softAgencyFetch(
      getAgencies({ featured: false, limit: 400, offset: 0 }),
      2500
    )
    if (cached && Array.isArray(cached.results)) list = cached.results
  }

  let hit = pickBestAgencyMatch(list, queryText)

  // 知名发射商：列表未命中时按硬 ID 拉详情，仍不串台
  if ((!hit || !hit.agency) && knownCanon && !opts.agencyHint) {
    const hardIds = AGENCY_CANONICAL_IDS[knownCanon] || []
    for (let i = 0; i < hardIds.length; i += 1) {
      const detail = await softAgencyFetch(getAgencyDetail(hardIds[i]), 2500)
      if (detail && detail.id != null) {
        hit = { agency: detail, score: 100 }
        break
      }
    }
  }

  // 型号+归属：机构名搜不到时，用火箭构型 manufacturer 反查（长征系可回落 CASC）
  if ((!hit || !hit.agency) && (ownershipAsk || /长征|猎鹰|朱雀|falcon|long\s*march/i.test(queryText))) {
    let configs = opts.rocketConfigsHint || null
    if (!configs) {
      try {
        const meta = await getRocketConfigMeta()
        configs = (meta && meta.configs) || {}
      } catch (e) {
        configs = {}
      }
    }
    const fromRocket = resolveAgencyFromRocketConfig(configs, list, queryText)
    if (fromRocket && fromRocket.agency) hit = fromRocket
  }

  if ((!hit || !hit.agency) && searchKey.length >= 2 && !opts.agencyHint && !ownershipAsk) {
    const searched = await softAgencyFetch(
      getAgencies({ featured: false, limit: 20, offset: 0, search: searchKey }),
      2500
    )
    const searchList = searched && Array.isArray(searched.results) ? searched.results : []
    hit = pickBestAgencyMatch(searchList, queryText)
    // 禁止「唯一结果就采纳」：云端可能只返回无关机构（如法航 Aérospatiale）
  }

  // 知名发射商最终仍必须是本尊
  if (hit && hit.agency && knownCanon && !agencyMatchesCanonical(hit.agency, knownCanon)) {
    hit = null
  }

  if (!hit || !hit.agency) return { card: null, scheduled: false }
  const card = toAgencyChatCard(hit.agency)
  return { card, scheduled: !!card }
}

/** 封路详情入口卡 */
function resolveRoadClosureEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'road_closure',
      id: 'entry_road_closure',
      tag: aiChatUiText('tagStarbaseRoad'),
      title: aiChatUiText('roadClosureTitle'),
      desc: aiChatUiText('roadClosureDesc'),
      cta: aiChatUiText('roadClosureCta'),
      variant: 'road',
      detailUrl: ROUTES.ROAD_CLOSURE_DETAIL,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/**
 * 空间站入口卡：按问法挑 ISS / 天宫；取数失败则仍出卡，点击进监控中心 Tab
 */
async function resolveStationEntryCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  let station = null
  try {
    const { getStationStatus } = require('../../../utils/api-monitor-data.js')
    const list = await getStationStatus()
    station = pickStation(list, queryText)
  } catch (e) {}

  const stationId = station && station.id != null ? String(station.id) : ''
  const stationName = station
    ? String(station.name || station.stationName || '').trim()
    : ''
  const isTiangong = /天宫|tiangong/i.test(stationName) || stationId === '18'
  const isIss = stationId === '4' || /\bISS\b|国际空间站/i.test(stationName)
  const titleRaw = stationName || aiChatUiText('stationDefaultTitle')
  const title = isTiangong
    ? (isContentLangEn() ? (stationName || 'Tiangong') : (stationName || '中国空间站天宫'))
    : (isIss
      ? (isContentLangEn() ? (stationName || 'ISS') : (stationName && /[\u4e00-\u9fff]/.test(stationName) ? stationName : '国际空间站（ISS）'))
      : titleRaw)
  const desc = stationName
    ? aiChatUiText('stationDescNamed', { name: title })
    : aiChatUiText('stationDescDefault')

  return {
    card: {
      cardType: 'entry',
      entryKind: 'station',
      id: 'entry_station_' + (stationId || 'monitor'),
      tag: isTiangong
        ? aiChatUiText('tagTiangong')
        : (isIss ? aiChatUiText('tagIss') : aiChatUiText('tagStation')),
      title,
      desc,
      cta: stationId ? aiChatUiText('enterDetailCta') : aiChatUiText('openMonitorCta'),
      variant: 'station',
      stationId,
      stationName,
      detailUrl: stationId
        ? (ROUTES.STATION_DETAIL + '?id=' + encodeURIComponent(stationId))
        : ROUTES.MONITOR,
      useSwitchTab: !stationId,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/**
 * 统一解析：按意图返回 cards[] + 已 enrich 的 launchContext 补丁函数结果
 * @returns {Promise<{intent: string|null, cards: object[], launchContext: object|null}>}
 */
// ══════════ 扩展卡片：百科参数卡 / 个人化 / 内容 ══════════

/** 统一调 apiProxy（与 fetchMissionReplayDoc 同风格，失败静默返回 null） */
function callApiProxy(payload) {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'apiProxy',
      data: payload || {},
      success: (res) => resolve((res && res.result) || null),
      fail: () => resolve(null)
    })
  })
}

/** 数值 + 单位；0 / 空 / 非数一律返回空串（由 buildSpecCard 丢掉该行） */
function fmtSpecNum(value, unit, digits) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = Number(digits) || 0
  const fixed = d > 0 ? String(Number(n.toFixed(d))) : String(Math.round(n))
  return fixed + (unit || '')
}

/** 参数卡载荷：空行自动丢弃，最多 6 行；跳转由组件按 specKind 白名单拼，卡里不带 URL */
function buildSpecCard(spec) {
  const s = spec && typeof spec === 'object' ? spec : {}
  const rows = (Array.isArray(s.rows) ? s.rows : [])
    .filter((r) => r && r.label && r.value !== '' && r.value != null)
    .slice(0, 6)
  return {
    cardType: 'spec',
    specKind: s.specKind || '',
    id: 'spec_' + (s.specKind || 'x') + '_' + (s.targetId != null ? s.targetId : '0'),
    targetId: s.targetId != null ? String(s.targetId) : '',
    targetName: s.targetName || '',
    tag: s.tag || '',
    title: s.title || '',
    subtitle: s.subtitle || '',
    image: s.image || '',
    desc: s.desc || '',
    rows,
    note: s.note || '',
    nav: s.nav || null,
    cta: s.cta || aiChatUiText('viewDetailsCta'),
    variant: s.variant || 'wiki',
    gateProductId: s.gateProductId || '',
    gateProductName: s.gateProductName || ''
  }
}

/**
 * 观礼类问题 → 火箭观礼入口卡。
 * 点击进「商家列表」（同任务多商家由用户自选），不再直达单一场次。
 */
async function resolveWatchPartyEntryCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  // 过审开关：关闭时不打匹配接口、不出入口卡（failClosed）
  let featureOn = false
  try {
    featureOn = await require('../../../utils/watch-party-feature.js').isWatchPartyEnabled(true)
  } catch (e) {
    featureOn = false
  }
  if (!featureOn) return { card: null, session: null, featureOff: true }
  let session = null
  try {
    session = await matchWatchPartySession(opts.queryText || '')
  } catch (e) {
    session = null
  }
  if (!session || !session.sessionId) return { card: null, session: null }
  const mid = String(session.missionId || '').trim()
  // match 已在同一次 DB 扫描里带上 missionSessionCount，禁止再打 list（省 1 次云函数+读）
  const count = Math.max(1, Number(session.missionSessionCount) || 1)
  const localized = applyContentLangToMission({
    missionName: session.missionName || '',
    name: session.missionName || '',
    rocketName: session.rocketName || ''
  })
  const rocket = localized.rocketName || session.rocketName || ''
  const mission = localized.missionName || localized.name || session.missionName || ''
  const title = count > 1
    ? ([rocket, mission].filter(Boolean).join(' · ') || aiChatUiText('watchOnSite')) +
      ' · ' + aiChatUiText('watchSpots', { n: count })
    : (session.title || aiChatUiText('watchLaunchTitle', {
      rocket: rocket || aiChatUiText('watchRocket')
    }))
  const placeBits = [
    count > 1 ? aiChatUiText('watchMerchants', { n: count }) : session.merchantName,
    session.padLocationName,
    rocket && mission ? (rocket + ' · ' + mission) : (rocket || mission || '')
  ].filter(Boolean)
  return {
    session,
    card: {
      cardType: 'entry',
      entryKind: 'watch_party',
      id: 'entry_watch_party_' + (mid || session.sessionId),
      tag: aiChatUiText('watchTag'),
      title,
      desc: (placeBits.join(' · ') || aiChatUiText('watchNear')) + aiChatUiText('watchDescSuffix'),
      cta: count > 1 ? aiChatUiText('watchCtaPick') : aiChatUiText('watchCtaEnter'),
      variant: 'watch',
      // 真实 missionId：列表页按任务筛商家；无任务 id 时列表展示全部开放场次
      missionId: mid,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    }
  }
}

/**
 * 商家入驻意向 → 入驻邀请抽卡（merchant_gacha）。
 * 卡背点击翻牌出「邀请函」，再点进入 merchant-apply 填表即入驻；
 * 观礼过审开关关闭时不出卡（failClosed）。
 */
async function resolveMerchantJoinCard() {
  let featureOn = false
  try {
    featureOn = await require('../../../utils/watch-party-feature.js').isWatchPartyEnabled(true)
  } catch (e) {
    featureOn = false
  }
  if (!featureOn) return { card: null, featureOff: true }
  return {
    card: {
      cardType: 'merchant_gacha',
      id: 'merchant_gacha_' + Date.now(),
      // 翻牌交互状态：组件内 setData 就地更新
      flipped: false,
      drawing: false,
      backTitle: aiChatUiText('mgachaBackTitle'),
      backEn: aiChatUiText('mgachaBackEn'),
      backHint: aiChatUiText('mgachaBackHint'),
      title: aiChatUiText('mgachaTitle'),
      perks: [
        aiChatUiText('mgachaPerk1'),
        aiChatUiText('mgachaPerk2'),
        aiChatUiText('mgachaPerk3'),
        aiChatUiText('mgachaPerk4')
      ],
      cta: aiChatUiText('mgachaCta'),
      foot: aiChatUiText('mgachaFoot')
    }
  }
}

/** 火箭型号参数卡（_config_meta 数据驱动） */
async function resolveRocketModelCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || ''
  let configs = opts.rocketConfigsHint || null
  if (!configs) {
    try {
      const meta = await getRocketConfigMeta()
      configs = (meta && meta.configs) || {}
    } catch (e) {
      configs = {}
    }
  }
  const hit = pickRocketConfig(configs, extractRocketModelKey(queryText)) ||
    pickRocketConfig(configs, queryText)
  if (!hit || !hit.config) return { card: null, scheduled: false }

  const cfg = hit.config
  const total = Number(cfg.total_launch_count) || 0
  const success = Number(cfg.successful_launches) || 0
  const rawTitle = cfg.full_name || cfg.name || ''
  const title = (!isContentLangEn()
    ? (translateRocketName(rawTitle) || rawTitle)
    : rawTitle) || aiChatUiText('launchVehicle')
  const maker = translateAgencyName(cfg.manufacturerName) || cfg.manufacturerName || ''
  const subtitleParts = []
  if (maker) subtitleParts.push(maker)
  if (cfg.reusable === true) subtitleParts.push(aiChatUiText('reusable'))
  const card = buildSpecCard({
    specKind: 'rocket_model',
    targetId: hit.id,
    targetName: cfg.name || '',
    tag: aiChatUiText('tagRocket'),
    title,
    subtitle: subtitleParts.join(' · '),
    desc: cfg.description || '',
    variant: 'wiki',
    cta: aiChatUiText('rocketModelCta'),
    rows: [
      { label: aiChatUiText('rowLength'), value: fmtSpecNum(cfg.length, ' m', 1) },
      { label: aiChatUiText('rowDiameter'), value: fmtSpecNum(cfg.diameter, ' m', 1) },
      { label: aiChatUiText('rowLaunchMass'), value: fmtSpecNum(cfg.launch_mass, ' t') },
      { label: aiChatUiText('rowLeo'), value: fmtSpecNum(cfg.leo_capacity, ' kg') },
      { label: aiChatUiText('rowThrust'), value: fmtSpecNum(cfg.to_thrust, ' kN') },
      {
        label: aiChatUiText('rowRecord'),
        value: total ? aiChatUiText('rowRecordVal', { total, success }) : ''
      }
    ]
  })
  return { card, scheduled: true }
}

/** 发射场参数卡（LL2 locations） */
async function resolveLaunchSiteCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || ''
  let list = Array.isArray(opts.launchSitesHint) ? opts.launchSitesHint : null
  if (!list) {
    const res = await callApiProxy({ action: 'll2LocationList' })
    list = res && res.success && Array.isArray(res.data) ? res.data : []
  }
  const hit = pickLaunchSite(list, queryText)
  if (!hit || !hit.site) return { card: null, scheduled: false }

  const site = hit.site
  const launches = Number(site.totalLaunchCount) || 0
  const landings = Number(site.totalLandingCount) || 0
  const rawName = site.name || ''
  const title = (!isContentLangEn()
    ? (translateLocation(rawName) || rawName)
    : rawName) || aiChatUiText('launchSite')
  const country = localizeCountryName(site.countryName) || site.countryName || ''
  const card = buildSpecCard({
    specKind: 'launch_site',
    targetId: site.id,
    targetName: site.name || '',
    tag: aiChatUiText('tagLaunchSite'),
    title,
    subtitle: [
      country,
      site.active ? aiChatUiText('siteActive') : aiChatUiText('siteInactive')
    ].filter(Boolean).join(' · '),
    image: site.imageUrl || site.mapImage || '',
    desc: site.description || '',
    variant: 'site',
    cta: aiChatUiText('launchSiteCta'),
    gateProductId: 'launch_site_encyclopedia',
    gateProductName: aiChatUiText('launchSiteGate'),
    rows: [
      {
        label: aiChatUiText('rowTotalLaunches'),
        value: launches ? aiChatUiText('nTimes', { n: launches }) : ''
      },
      {
        label: aiChatUiText('rowTotalLandings'),
        value: landings ? aiChatUiText('nTimes', { n: landings }) : ''
      },
      {
        label: aiChatUiText('rowTimezone'),
        value: localizeTimezoneName(site.timezoneName) || site.timezoneName || ''
      },
      {
        label: aiChatUiText('rowCoords'),
        value: (site.latitude != null && site.longitude != null)
          ? (Number(site.latitude).toFixed(2) + ', ' + Number(site.longitude).toFixed(2))
          : ''
      }
    ]
  })
  return { card, scheduled: true }
}

/** 飞船参数卡（LL2 spacecraft_configurations：列表命中 → 详情补参数） */
async function resolveSpacecraftCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || ''
  let list = Array.isArray(opts.spacecraftHint) ? opts.spacecraftHint : null
  if (!list) {
    const res = await callApiProxy({ action: 'll2SpacecraftList' })
    list = res && res.success && Array.isArray(res.data) ? res.data : []
  }
  const hit = pickSpacecraftConfig(list, queryText)
  if (!hit || !hit.config) return { card: null, scheduled: false }

  let sc = hit.config
  const detailRes = await callApiProxy({
    action: 'll2SpacecraftDetail',
    spacecraftId: String(sc.id)
  })
  if (detailRes && detailRes.success && detailRes.data && detailRes.data.id != null) {
    sc = Object.assign({}, sc, detailRes.data)
  }

  const total = Number(sc.totalLaunchCount) || 0
  const rawScName = sc.name || ''
  const scTitle = (!isContentLangEn()
    ? (translateSpacecraftName(rawScName) || rawScName)
    : rawScName) || aiChatUiText('spacecraft')
  const card = buildSpecCard({
    specKind: 'spacecraft',
    targetId: sc.id,
    targetName: sc.name || '',
    tag: aiChatUiText('tagSpacecraft'),
    title: scTitle,
    subtitle: [
      translateAgencyName(sc.agencyName) || sc.agencyName,
      sc.inUse ? aiChatUiText('inService') : aiChatUiText('retired')
    ].filter(Boolean).join(' · '),
    image: sc.imageUrl || '',
    desc: sc.capability || sc.details || '',
    variant: 'craft',
    cta: aiChatUiText('spacecraftCta'),
    gateProductId: 'spacecraft_encyclopedia',
    gateProductName: aiChatUiText('spacecraftGate'),
    rows: [
      {
        label: aiChatUiText('rowCrew'),
        value: sc.crewCapacity != null && Number(sc.crewCapacity) > 0
          ? aiChatUiText('rowCrewVal', { n: Number(sc.crewCapacity) })
          : ''
      },
      { label: aiChatUiText('rowHeight'), value: fmtSpecNum(sc.height, ' m', 1) },
      { label: aiChatUiText('rowDiameter'), value: fmtSpecNum(sc.diameter, ' m', 1) },
      { label: aiChatUiText('rowUplink'), value: fmtSpecNum(sc.payloadCapacity, ' kg') },
      { label: aiChatUiText('rowMaiden'), value: String(sc.maidenFlight || '').slice(0, 10) },
      {
        label: aiChatUiText('rowLaunchCount'),
        value: total ? aiChatUiText('nTimes', { n: total }) : ''
      }
    ]
  })
  return { card, scheduled: true }
}

/** 助推器战绩卡（有编号出参数卡，只问复用/家谱出族谱入口卡） */
async function resolveBoosterCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || ''
  const serial = extractBoosterSerial(queryText)

  if (serial) {
    const res = await callApiProxy({ action: 'agentBoosterInfo', serial })
    const item = res && res.success && res.item ? res.item : null
    if (item) {
      const landings = Number(item.successfulLandings) || 0
      const attempts = Number(item.attemptedLandings) || 0
      const recent = Array.isArray(item.recentFlights) ? item.recentFlights[0] : null
      const familyRaw = item.rocketFamily || ''
      const family = (!isContentLangEn()
        ? (translateRocketName(familyRaw) || familyRaw)
        : familyRaw)
      let lastMission = recent && recent.mission ? String(recent.mission) : ''
      if (lastMission && !isContentLangEn()) {
        lastMission = localizeMissionTitle(lastMission, familyRaw, family) || lastMission
      }
      const card = buildSpecCard({
        specKind: 'booster',
        targetId: item.serial,
        targetName: item.serial,
        tag: aiChatUiText('tagBooster'),
        title: item.serial || serial,
        subtitle: [family, item.statusZh].filter(Boolean).join(' · '),
        variant: 'booster',
        cta: aiChatUiText('boosterCta'),
        rows: [
          {
            label: aiChatUiText('rowFlights'),
            value: item.flights ? aiChatUiText('nTimes', { n: item.flights }) : ''
          },
          {
            label: aiChatUiText('rowLandingOk'),
            value: attempts ? (landings + ' / ' + attempts) : ''
          },
          { label: aiChatUiText('rowMaiden'), value: item.firstFlight || '' },
          { label: aiChatUiText('rowLastFlight'), value: item.lastFlight || '' },
          {
            label: aiChatUiText('rowLastMission'),
            value: lastMission
          }
        ]
      })
      return { card, scheduled: true }
    }
  }

  // 无编号（或编号查不到）：给族谱入口，别让「复用记录」空手
  return {
    card: {
      cardType: 'entry',
      entryKind: 'booster_genealogy',
      id: 'entry_booster_genealogy',
      tag: aiChatUiText('tagBoosterGene'),
      title: aiChatUiText('boosterGeneTitle'),
      desc: aiChatUiText('boosterGeneDesc'),
      cta: aiChatUiText('boosterGeneCta'),
      variant: 'booster',
      detailUrl: ROUTES.BOOSTER_GENEALOGY,
      gateProductId: 'booster_genealogy',
      gateProductName: aiChatUiText('boosterGeneTitle'),
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 我的发射提醒卡（本地订阅 + 云端最新状态对齐） */
async function resolveMySubscriptionsCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5, 8))
  let subscribed = []
  try {
    subscribed = getSubscribedMissions() || []
  } catch (e) {
    subscribed = []
  }
  if (!subscribed.length) return { card: null, scheduled: false }

  // 订阅时的快照可能已过期：能对上云端 upcoming 就用最新时间与状态
  const freshById = {}
  let pool = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  if (!pool.length) {
    try {
      const res = await getUpcomingMissions(100, 0)
      pool = (res && res.list) || []
    } catch (e) {
      pool = []
    }
  }
  pool.forEach((m) => {
    if (m && m.id != null) freshById[String(m.id)] = m
  })

  const sorted = subscribed.slice().sort((a, b) => {
    const ta = new Date((freshById[String(a.id)] || a).launchTime || 0).getTime() || Infinity
    const tb = new Date((freshById[String(b.id)] || b).launchTime || 0).getTime() || Infinity
    return ta - tb
  })

  const items = []
  for (let i = 0; i < sorted.length && items.length < limit; i++) {
    const row = sorted[i]
    const fresh = freshById[String(row.id)]
    const mission = fresh || {
      id: row.id,
      name: row.name || aiChatUiText('missionFallbackId', { id: row.id }),
      rocketName: row.rocket || '',
      rocketImage: row.rocketImage || '',
      launchTime: row.launchTime || '',
      padLocation: row.pad || ''
    }
    const card = await toChatMissionCard(mission, 'upcoming', { anyLaunch: true })
    if (card) items.push(card)
  }
  if (!items.length) return { card: null, scheduled: false }

  return {
    card: {
      cardType: 'launch_list',
      id: 'my_launches_' + items[0].id,
      title: aiChatUiText('mySubsTitle'),
      items,
      moreUrl: ROUTES.INDEX,
      listFilter: null
    },
    scheduled: true
  }
}

/** 发射竞猜入口卡：指向下一场可竞猜的发射 */
async function resolveLaunchVoteEntryCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  let list = Array.isArray(opts.upcomingHint) ? opts.upcomingHint : []
  if (!list.length) {
    try {
      const res = await getUpcomingMissions(12, 0)
      list = (res && res.list) || []
    } catch (e) {
      list = []
    }
  }
  const mission = list.filter(isUsableLaunchForCard)[0] || null
  if (!mission) return { card: null, scheduled: false }
  const localized = applyContentLangToMission(Object.assign({}, mission))
  const name = localized.missionName || localized.name || aiChatUiText('nextLaunch')
  return {
    card: {
      cardType: 'entry',
      entryKind: 'launch_vote',
      id: 'entry_launch_vote_' + mission.id,
      tag: aiChatUiText('voteTag'),
      title: aiChatUiText('voteTitle', { name }),
      desc: aiChatUiText('voteDesc'),
      cta: aiChatUiText('voteCta'),
      variant: 'vote',
      missionId: String(mission.id),
      missionName: name,
      detailType: 'upcoming',
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 年度回顾入口卡 */
function resolveYearReviewEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'year_review',
      id: 'entry_year_review',
      tag: aiChatUiText('tagYearReview'),
      title: aiChatUiText('yearReviewTitle'),
      desc: aiChatUiText('yearReviewDesc'),
      cta: aiChatUiText('yearReviewCta'),
      variant: 'review',
      detailUrl: ROUTES.YEAR_REVIEW,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 天象日历入口卡（页内为静态天象表，这里只做导航，不复述条目） */
function resolveAstroCalendarEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'astro_calendar',
      id: 'entry_astro_calendar',
      tag: aiChatUiText('tagSkyCalendar'),
      title: aiChatUiText('astroTitle'),
      desc: aiChatUiText('astroDesc'),
      cta: aiChatUiText('astroCta'),
      variant: 'astro',
      detailUrl: ROUTES.ASTRO_CALENDAR,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 航天新闻入口卡（事件 Tab） */
function resolveNewsEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'news',
      id: 'entry_news',
      tag: aiChatUiText('newsTag'),
      title: aiChatUiText('newsTitle'),
      desc: aiChatUiText('newsDesc'),
      cta: aiChatUiText('newsCta'),
      variant: 'news',
      detailUrl: ROUTES.NEWS,
      useSwitchTab: true,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 通用功能入口卡（徽章/收藏/图鉴/NASA 等） */
function resolveSimpleFeatureEntryCard(kind) {
  const map = {
    badges: {
      tag: aiChatUiText('tagBadges'),
      titleKey: 'badgesTitle',
      descKey: 'badgesDesc',
      ctaKey: 'badgesCta',
      url: ROUTES.BADGES,
      variant: 'review'
    },
    favorites: {
      tag: aiChatUiText('tagFavorites'),
      titleKey: 'favoritesTitle',
      descKey: 'favoritesDesc',
      ctaKey: 'favoritesCta',
      url: ROUTES.FAVORITES,
      variant: 'review'
    },
    daily_quiz: {
      tag: aiChatUiText('tagQuiz'),
      titleKey: 'dailyQuizTitle',
      descKey: 'dailyQuizDesc',
      ctaKey: 'dailyQuizCta',
      url: ROUTES.DAILY_QUIZ,
      variant: 'vote'
    },
    collect: {
      tag: aiChatUiText('tagWish'),
      titleKey: 'collectTitle',
      descKey: 'collectDesc',
      ctaKey: 'collectCta',
      url: ROUTES.COLLECT,
      variant: 'astro'
    },
    exoplanet: {
      tag: aiChatUiText('tagExoplanet'),
      titleKey: 'exoplanetTitle',
      descKey: 'exoplanetDesc',
      ctaKey: 'exoplanetCta',
      url: ROUTES.EXOPLANET,
      variant: 'astro'
    },
    nasa_data: {
      tag: aiChatUiText('tagNasa'),
      titleKey: 'nasaDataTitle',
      descKey: 'nasaDataDesc',
      ctaKey: 'nasaDataCta',
      url: ROUTES.NASA_DATA,
      variant: 'news'
    },
    spacecraft_gallery: {
      tag: aiChatUiText('tagSpacecraft'),
      titleKey: 'spacecraftGalleryTitle',
      descKey: 'spacecraftGalleryDesc',
      ctaKey: 'spacecraftGalleryCta',
      url: ROUTES.SPACECRAFT_GALLERY,
      variant: 'agency'
    },
    launch_site_gallery: {
      tag: aiChatUiText('tagSites'),
      titleKey: 'launchSiteGalleryTitle',
      descKey: 'launchSiteGalleryDesc',
      ctaKey: 'launchSiteGalleryCta',
      url: ROUTES.LAUNCH_SITE_MAP,
      variant: 'agency'
    }
  }
  const conf = map[kind]
  if (!conf) return { card: null, scheduled: false }
  return {
    card: {
      cardType: 'entry',
      entryKind: kind,
      id: 'entry_' + kind,
      tag: conf.tag,
      title: aiChatUiText(conf.titleKey),
      desc: aiChatUiText(conf.descKey),
      cta: aiChatUiText(conf.ctaKey),
      variant: conf.variant,
      detailUrl: conf.url,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

const APOD_CACHE_KEY = '_ai_chat_apod_v1'
const APOD_CACHE_TTL = 6 * 60 * 60 * 1000

function readApodCache() {
  try {
    const raw = wx.getStorageSync(APOD_CACHE_KEY)
    if (raw && raw.ts && raw.data && Date.now() - raw.ts < APOD_CACHE_TTL) return raw.data
  } catch (e) {}
  return null
}

function fetchApodDoc() {
  const cached = readApodCache()
  if (cached) return Promise.resolve(cached)
  if (typeof wx === 'undefined' || typeof wx.request !== 'function') return Promise.resolve(null)
  const base = (workerProxyUrl || 'https://api.marsx.com.cn') + '/nasa-apod'
  return new Promise((resolve) => {
    wx.request({
      url: base,
      timeout: 12000,
      success: (res) => {
        const data = res && res.statusCode === 200 ? res.data : null
        if (data && (data.url || data.hdurl || data.title)) {
          try {
            wx.setStorageSync(APOD_CACHE_KEY, { ts: Date.now(), data })
          } catch (e) {}
          resolve(data)
          return
        }
        resolve(null)
      },
      fail: () => resolve(null)
    })
  })
}

/** 每日天文图卡（NASA APOD；视频类型只给封面与说明，不在聊天里播放） */
async function resolveApodCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const doc = opts.apodHint || await fetchApodDoc()
  if (!doc || !(doc.title || doc.url)) return { card: null, scheduled: false }
  const isVideo = String(doc.media_type || '') === 'video'
  const image = isVideo
    ? (doc.thumbnail_url || '')
    : optimizeImageUrl(doc.url || doc.hdurl || '', { width: 750 }) || doc.url || ''
  const card = buildSpecCard({
    specKind: 'apod',
    targetId: doc.date || 'today',
    targetName: doc.title || '',
    tag: aiChatUiText('tagApod'),
    title: doc.title || aiChatUiText('apodTitle'),
    subtitle: [doc.date || '', doc.copyright ? '© ' + String(doc.copyright).trim() : '']
      .filter(Boolean).join(' · '),
    image,
    desc: doc.explanation || '',
    variant: 'apod',
    cta: aiChatUiText('apodCta'),
    rows: [
      { label: aiChatUiText('rowDate'), value: doc.date || '' },
      {
        label: aiChatUiText('rowType'),
        value: isVideo ? aiChatUiText('typeVideo') : aiChatUiText('typeImage')
      }
    ]
  })
  return { card, scheduled: true }
}

/** 星链过境入口卡（过境计算依赖定位与 TLE，只在监控中心页内做） */
function resolveStarlinkPassEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'starlink_pass',
      id: 'entry_starlink_pass',
      tag: aiChatUiText('starlinkPassTag'),
      title: aiChatUiText('starlinkPassTitle'),
      desc: aiChatUiText('starlinkPassDesc'),
      cta: aiChatUiText('openMonitorCta'),
      variant: 'starlink',
      detailUrl: ROUTES.MONITOR,
      useSwitchTab: true,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/**
 * 观看发射直播入口卡。
 * 直播观看区在监控中心（内嵌视频号 channel-live + B站 / 推荐直播），
 * 聊天里不直接调 openChannelsLive：那要先探到 feedId，且会多弹一次确认框。
 */
function resolveLiveWatchEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'live_watch',
      id: 'entry_live_watch',
      tag: aiChatUiText('liveTag'),
      title: aiChatUiText('liveTitle'),
      desc: aiChatUiText('liveDesc'),
      cta: aiChatUiText('liveCta'),
      variant: 'live',
      detailUrl: ROUTES.MONITOR,
      useSwitchTab: true,
      gateProductId: '',
      gateProductName: '',
      needMissionSimFlag: false,
      needLiveFlag: true
    },
    scheduled: true
  }
}

/** 星链星座实时分布入口卡（在轨颗数以页面为准，聊天里不报数） */
function resolveStarlinkMapEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'starlink_map',
      id: 'entry_starlink_map',
      tag: aiChatUiText('starlinkMapTag'),
      title: aiChatUiText('starlinkMapTitle'),
      desc: aiChatUiText('starlinkMapDesc'),
      cta: aiChatUiText('starlinkMapCta'),
      variant: 'starlink',
      detailUrl: ROUTES.STARLINK_FULLSCREEN,
      gateProductId: 'starlink_pro',
      gateProductName: aiChatUiText('starlinkMapGate'),
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 阿尔忒弥斯入口卡 */
function resolveArtemisEntryCard() {
  return {
    card: {
      cardType: 'entry',
      entryKind: 'artemis',
      id: 'entry_artemis',
      tag: aiChatUiText('artemisTag'),
      title: aiChatUiText('artemisTitle'),
      desc: aiChatUiText('artemisDesc'),
      cta: aiChatUiText('artemisCta'),
      variant: 'artemis',
      detailUrl: ROUTES.ARTEMIS_DETAIL,
      gateProductId: 'artemis_telemetry',
      gateProductName: aiChatUiText('artemisGate'),
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 星舰硬件卡（B15 / S38 命中出参数卡，否则给硬件列表入口） */
async function resolveStarshipHardwareCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || ''
  let vehicles = Array.isArray(opts.hardwareHint) ? opts.hardwareHint : null
  if (!vehicles) {
    try {
      const res = await getStarshipHardwareFromDB()
      vehicles = (res && res.vehicles) || []
    } catch (e) {
      vehicles = []
    }
  }
  const hit = pickStarshipHardware(vehicles, queryText)
  if (hit) {
    const card = buildSpecCard({
      specKind: 'starship_hardware',
      targetId: hit.id,
      targetName: hit.name || '',
      tag: aiChatUiText('hardwareTag'),
      title: hit.name || aiChatUiText('hardwareTitle'),
      subtitle: [hit.typeZh || hit.type, hit.categoryZh].filter(Boolean).join(' · '),
      image: hit.imageMissing ? '' : (hit.image || ''),
      desc: hit.notesZh || hit.notesEn || '',
      variant: 'hardware',
      cta: aiChatUiText('hardwareCta'),
      gateProductId: 'starship_hardware',
      gateProductName: aiChatUiText('hardwareGate'),
      rows: [
        { label: aiChatUiText('rowStatus'), value: hit.statusZh || hit.status || '' },
        { label: aiChatUiText('rowType'), value: hit.typeZh || hit.type || '' }
      ]
    })
    return { card, scheduled: true }
  }

  return {
    card: {
      cardType: 'entry',
      entryKind: 'starship_hardware',
      id: 'entry_starship_hardware',
      tag: aiChatUiText('hardwareTag'),
      title: aiChatUiText('hardwareListTitle'),
      desc: aiChatUiText('hardwareListDesc'),
      cta: aiChatUiText('hardwareListCta'),
      variant: 'hardware',
      detailUrl: ROUTES.HARDWARE_LIST,
      gateProductId: 'starship_hardware',
      gateProductName: aiChatUiText('hardwareGate'),
      needMissionSimFlag: false
    },
    scheduled: true
  }
}

/** 回收 / 复用总览卡（族谱聚合） */
async function resolveRecoveryStatsCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const res = opts.recoveryHint || await callApiProxy({ action: 'agentRecoveryStats', limit: 5 })
  if (!res || !res.success) {
    return {
      card: {
        cardType: 'entry',
        entryKind: 'booster_genealogy',
        id: 'entry_booster_genealogy',
        tag: aiChatUiText('tagBoosterGene'),
        title: aiChatUiText('boosterGeneTitle'),
        desc: aiChatUiText('boosterGeneDescShort'),
        cta: aiChatUiText('boosterGeneCta'),
        variant: 'booster',
        detailUrl: ROUTES.BOOSTER_GENEALOGY,
        gateProductId: 'booster_genealogy',
        gateProductName: aiChatUiText('boosterGeneTitle'),
        needMissionSimFlag: false
      },
      scheduled: true
    }
  }

  const top = Array.isArray(res.topReused) ? res.topReused[0] : null
  const card = buildSpecCard({
    specKind: 'recovery_stats',
    targetId: 'all',
    targetName: aiChatUiText('recoveryOverview'),
    tag: aiChatUiText('recoveryTag'),
    title: aiChatUiText('recoveryTitle'),
    subtitle: res.totalBoosters
      ? aiChatUiText('recoverySubtitle', {
        total: res.totalBoosters,
        active: res.activeBoosters || 0
      })
      : '',
    variant: 'booster',
    cta: aiChatUiText('recoveryCta'),
    gateProductId: 'booster_genealogy',
    gateProductName: aiChatUiText('boosterGeneTitle'),
    rows: [
      {
        label: aiChatUiText('rowTotalFlights'),
        value: res.totalFlights ? aiChatUiText('nTimes', { n: res.totalFlights }) : ''
      },
      {
        label: aiChatUiText('rowLandingOk'),
        value: res.totalAttempts
          ? (res.totalLandings + ' / ' + res.totalAttempts)
          : ''
      },
      { label: aiChatUiText('rowLandingRate'), value: res.landingSuccessRate || '' },
      {
        label: aiChatUiText('rowTopReuse'),
        value: top && top.serial
          ? aiChatUiText('rowTopReuseVal', { serial: top.serial, n: top.flights || 0 })
          : ''
      }
    ]
  })
  return { card, scheduled: true }
}

async function resolveRichChatPayload(text, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const intent = resolveAiChatRichIntent(text)
  let launchContext = opts.launchContext || null
  const cards = []
  let subscribeMission = null

  if (intent === 'set_reminder') {
    const resolved = await resolveSetReminderCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSetReminder(launchContext, resolved.card)
    }
    subscribeMission = resolved.subscribeMission || null
  } else if (intent === 'starship_next') {
    const resolved = await resolveStarshipNextFlightCard(opts)
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithCard(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoStarshipSchedule(launchContext)
    }
  } else if (intent === 'starship_status') {
    const resolved = await resolveStarshipStatusCard(opts)
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithStarshipStatus(launchContext, resolved.card)
    } else {
      const fallback = resolveStarshipProgressEntryCard()
      if (fallback.card) cards.push(fallback.card)
      launchContext = enrichLaunchContextNoStarshipStatus(launchContext)
    }
  } else if (intent === 'mission_replay') {
    const resolved = await resolveMissionReplayCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithMissionReplay(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoMissionReplay(launchContext, text)
    }
  } else if (intent === 'mission_lookup') {
    const resolved = await resolveMissionLookupCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithCard(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoMissionLookup(launchContext, text)
    }
  } else if (intent === 'launch_stats') {
    const resolved = await resolveLaunchStatsCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = resolved.card.dataReady
        ? enrichLaunchContextWithLaunchStats(launchContext, resolved.card)
        : enrichLaunchContextNoLaunchStats(launchContext)
    } else {
      launchContext = enrichLaunchContextNoLaunchStats(launchContext)
    }
  } else if (intent === 'agency') {
    const resolved = await resolveAgencyLookupCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithAgency(launchContext, resolved.card, text)
    } else {
      launchContext = enrichLaunchContextNoAgency(launchContext, text)
    }
  } else if (intent === 'history_list') {
    const resolved = await resolveHistoryListCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithLaunchList(launchContext, resolved.card, resolved.listFilter)
    } else {
      launchContext = enrichLaunchContextNoLaunchList(launchContext, text)
    }
  } else if (intent === 'launch_list') {
    const resolved = await resolveLaunchListCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithLaunchList(launchContext, resolved.card, resolved.listFilter)
    } else {
      launchContext = enrichLaunchContextNoLaunchList(launchContext, text)
    }
  } else if (intent === 'flight_demo') {
    const resolved = resolveFlightDemoEntryCard(opts)
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithFlightDemo(launchContext, resolved.card)
    }
  } else if (intent === 'mission_sim') {
    const resolved = resolveMissionSimEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithMissionSim(launchContext)
    }
  } else if (intent === 'vehicle_tracker') {
    const resolved = resolveVehicleTrackerEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithVehicleTracker(launchContext)
    }
  } else if (intent === 'road_closure') {
    const resolved = resolveRoadClosureEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithRoadClosure(launchContext)
    }
  } else if (intent === 'station') {
    const resolved = await resolveStationEntryCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithStation(launchContext, resolved.card)
    }
  } else if (intent === 'rocket_model') {
    const resolved = await resolveRocketModelCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSpec(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '火箭型号', text)
    }
  } else if (intent === 'launch_site') {
    const resolved = await resolveLaunchSiteCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSpec(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '发射场', text)
    }
  } else if (intent === 'spacecraft') {
    const resolved = await resolveSpacecraftCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSpec(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '航天器', text)
    }
  } else if (intent === 'booster') {
    const resolved = await resolveBoosterCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = resolved.card.cardType === 'spec'
        ? enrichLaunchContextWithSpec(launchContext, resolved.card)
        : enrichLaunchContextWithSimpleEntry(launchContext, {
          label: '助推器家谱',
          action: '按编号查复用与回收战绩'
        })
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '助推器', text)
    }
  } else if (intent === 'my_launches') {
    const resolved = await resolveMySubscriptionsCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithMyLaunches(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoMyLaunches(launchContext)
    }
  } else if (intent === 'launch_vote') {
    const resolved = await resolveLaunchVoteEntryCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '发射竞猜',
        action: '进入任务详情投票'
      })
    } else {
      launchContext = enrichLaunchContextNoLaunchList(launchContext, text)
    }
  } else if (intent === 'year_review') {
    const resolved = resolveYearReviewEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '航天年度回顾',
        action: '查看自己这一年的追发射数据'
      })
    }
  } else if (intent === 'astro_calendar') {
    const resolved = resolveAstroCalendarEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '天象日历',
        action: '查看流星雨/日月食等天象时间'
      })
    }
  } else if (intent === 'news') {
    const resolved = resolveNewsEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '航天事件与新闻',
        action: '查看最新事件与资讯'
      })
    }
  } else if (intent === 'apod') {
    const resolved = await resolveApodCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSpec(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '每日天文图', text)
    }
  } else if (intent === 'live_watch') {
    const resolved = resolveLiveWatchEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '直播观看（监控中心）',
        action: '进入监控中心看视频号直播，另有 B站直播与推荐直播入口；' +
          '是否正在开播以页面为准，不要编造直播地址、平台或开播时间'
      })
    }
  } else if (intent === 'starlink_pass') {
    const resolved = resolveStarlinkPassEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '星链过境预报',
        action: '授权位置后查看可见过境时间与方位'
      })
    }
  } else if (intent === 'merchant_join') {
    const resolved = await resolveMerchantJoinCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithMerchantJoin(launchContext)
    } else {
      launchContext = enrichLaunchContextMerchantJoinFeatureOff(launchContext)
    }
  } else if (intent === 'viewing_spot') {
    const resolved = await resolveWatchPartyEntryCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithWatchParty(launchContext, resolved.session)
    } else if (resolved.featureOff) {
      launchContext = enrichLaunchContextWatchPartyFeatureOff(launchContext)
    } else {
      launchContext = enrichLaunchContextWatchPartyClosed(launchContext)
    }
  } else if (intent === 'starlink_map') {
    const resolved = resolveStarlinkMapEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: '星链实时分布',
        action: '查看在轨颗数与实时位置（具体数量以页面为准，不要凭记忆报数）'
      })
    }
  } else if (intent === 'artemis') {
    const resolved = resolveArtemisEntryCard()
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, {
        label: 'Artemis II 任务面板',
        action: '查看任务阶段与绕月轨迹'
      })
    }
  } else if (intent === 'starship_hardware') {
    const resolved = await resolveStarshipHardwareCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = resolved.card.cardType === 'spec'
        ? enrichLaunchContextWithSpec(launchContext, resolved.card)
        : enrichLaunchContextWithSimpleEntry(launchContext, {
          label: '星舰硬件设施',
          action: '查看在建硬件的状态与测试记录'
        })
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '星舰硬件', text)
    }
  } else if (intent === 'recovery_stats') {
    const resolved = await resolveRecoveryStatsCard({ ...opts, queryText: text })
    if (resolved.card) {
      cards.push(resolved.card)
      launchContext = resolved.card.cardType === 'spec'
        ? enrichLaunchContextWithSpec(launchContext, resolved.card)
        : enrichLaunchContextWithSimpleEntry(launchContext, {
          label: '助推器家谱',
          action: '查看复用排行与回收记录'
        })
    } else {
      launchContext = enrichLaunchContextNoSpec(launchContext, '回收统计', text)
    }
  } else if (
    intent === 'badges' || intent === 'favorites' || intent === 'daily_quiz' ||
    intent === 'collect' || intent === 'exoplanet' || intent === 'nasa_data' ||
    intent === 'spacecraft_gallery' || intent === 'launch_site_gallery'
  ) {
    const resolved = resolveSimpleFeatureEntryCard(intent)
    if (resolved.card) {
      cards.push(resolved.card)
      const labels = {
        badges: { label: '我的徽章', action: '查看与点亮徽章' },
        favorites: { label: '我的收藏', action: '查看收藏的任务与资料' },
        daily_quiz: { label: '每日挑战', action: '开始航天问答' },
        collect: { label: '月愿计划', action: '写下你的月球心愿' },
        exoplanet: { label: '系外行星', action: '浏览宜居带与系外行星' },
        nasa_data: { label: 'NASA 开放数据', action: '查看地球观测与开放数据' },
        spacecraft_gallery: { label: '全球飞船图鉴', action: '浏览飞船档案' },
        launch_site_gallery: { label: '全球发射场分布', action: '打开发射场地图' }
      }
      launchContext = enrichLaunchContextWithSimpleEntry(launchContext, labels[intent])
    }
  }

  return { intent, cards, launchContext, subscribeMission }
}

/** 订阅结果回写提醒卡文案（供星问发送链路调用） */
function applyReminderSubscribeStatus(card, status) {
  if (!card || card.cardType !== 'reminder') return card
  return buildReminderResultCard({
    id: card.missionId,
    name: card.missionName,
    missionName: card.missionName,
    rocketName: card.rocketName,
    rocketImage: card.rocketImage,
    launchTime: card.launchTime,
    formattedTime: card.formattedTime,
    padLocation: card.padLocation,
    detailType: card.detailType,
    detailUrl: card.detailUrl
  }, status)
}

module.exports = {
  matchStarshipNextFlightIntent,
  matchStarshipStatusIntent,
  matchLaunchStatsIntent,
  matchLaunchListIntent,
  matchFlightDemoIntent,
  matchMissionSimIntent,
  matchVehicleTrackerIntent,
  matchRoadClosureIntent,
  matchStationIntent,
  matchAgencyIntent,
  matchMissionLookupIntent,
  matchSetReminderIntent,
  matchMissionReplayIntent,
  matchRocketModelIntent,
  matchLaunchSiteIntent,
  matchSpacecraftIntent,
  matchBoosterIntent,
  matchMyLaunchesIntent,
  matchYearReviewIntent,
  matchLaunchVoteIntent,
  matchApodIntent,
  matchAstroCalendarIntent,
  matchNewsIntent,
  matchStarlinkPassIntent,
  matchStarlinkMapIntent,
  matchMerchantJoinIntent,
  matchViewingSpotIntent,
  matchArtemisIntent,
  matchStarshipHardwareIntent,
  matchRecoveryStatsIntent,
  resolveAiChatRichIntent,
  parseLaunchStatsFocus,
  parseLaunchListFilter,
  toChatMissionCard,
  resolveChatCardRocketImage,
  resolveStarshipNextFlightCard,
  resolveLaunchListCard,
  resolveLaunchStatsCard,
  resolveAgencyLookupCard,
  resolveStarshipStatusCard,
  resolveFlightDemoEntryCard,
  resolveVehicleTrackerEntryCard,
  resolveMissionSimEntryCard,
  resolveStarshipProgressEntryCard,
  resolveMissionLookupCard,
  resolveSetReminderCard,
  applyReminderSubscribeStatus,
  resolveMissionReplayCard,
  resolveRoadClosureEntryCard,
  resolveStationEntryCard,
  resolveRocketModelCard,
  resolveLaunchSiteCard,
  resolveSpacecraftCard,
  resolveBoosterCard,
  resolveMySubscriptionsCard,
  resolveLaunchVoteEntryCard,
  resolveYearReviewEntryCard,
  resolveAstroCalendarEntryCard,
  resolveNewsEntryCard,
  resolveApodCard,
  resolveStarlinkPassEntryCard,
  resolveLiveWatchEntryCard,
  resolveStarlinkMapEntryCard,
  resolveWatchPartyEntryCard,
  resolveMerchantJoinCard,
  resolveArtemisEntryCard,
  resolveStarshipHardwareCard,
  resolveRecoveryStatsCard,
  buildSpecCard,
  resolveRichChatPayload,
  enrichLaunchContextWithSetReminder,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule,
  enrichLaunchContextNoMissionLookup,
  enrichLaunchContextWithLaunchList,
  enrichLaunchContextNoLaunchList,
  enrichLaunchContextWithStarshipStatus,
  enrichLaunchContextNoStarshipStatus,
  enrichLaunchContextWithFlightDemo,
  enrichLaunchContextWithVehicleTracker,
  enrichLaunchContextWithMissionSim,
  enrichLaunchContextWithRoadClosure,
  enrichLaunchContextWithStation,
  enrichLaunchContextWithLaunchStats,
  enrichLaunchContextNoLaunchStats,
  enrichLaunchContextWithAgency,
  enrichLaunchContextNoAgency,
  enrichLaunchContextWithMissionReplay,
  enrichLaunchContextNoMissionReplay,
  isStarshipMissionLike,
  isUsableMissionForCard,
  isUsableLaunchForCard,
  pickStarshipMission,
  pickLaunchList,
  pickStation,
  pickBestMissionMatch,
  pickBestAgencyMatch
}
