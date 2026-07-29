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
const { getSubscribedMissions } = require('../../../utils/subscribe.js')
const { workerProxyUrl } = require('../../../utils/config.js')
const { buildMissionDetailUrl } = require('../../../utils/index-mission-nav.js')
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
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
const { translateAgencyName } = require('../../../utils/space-terms-i18n.js')
const {
  isStarshipMissionLike,
  isUsableMissionForCard,
  isUsableLaunchForCard,
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
  pickStation,
  pickBestMissionMatch,
  missionLookupTimePreference,
  pickBestAgencyMatch,
  parseLaunchListFilter,
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
  enrichLaunchContextWithViewingSpots,
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
  enrichLaunchContextNoMissionReplay
} = require('./ai-chat-rich-core.js')
const { pickViewingSpots, toNavPoint } = require('./viewing-spots.js')

const AGENCY_TYPE_ZH = {
  Government: '政府',
  Commercial: '商业',
  Multinational: '跨国',
  Educational: '教育',
  Private: '私营'
}

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
  const rocketName = safe.rocketName || 'Rocket'
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
  const name = mission.missionName || mission.name || '发射任务'
  const rocketName = mission.rocketName || ''
  const rocketImage = await resolveChatCardRocketImage(mission)
  const formattedTime = mission.formattedTime
    || (mission.launchTime ? formatDate(mission.launchTime, 'MM月DD日 HH:mm') : '时间待定')
  return {
    cardType: 'mission',
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
    launchAgency: mission.launchAgency || '',
    detailType: type,
    detailUrl: buildMissionDetailUrl({ id: mission.id, detailType: type })
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

  // 有国家/场站/机构筛且本地不足时探云（仅 upcoming + 60 天内）
  const needCloud = listFilter && (listFilter.country || listFilter.siteKey || listFilter.agencyKey)
  if (needCloud && picked.length < limit) {
    const cloudKeys = []
    if (listFilter.country) {
      cloudKeys.push(listFilter.country)
      if (listFilter.country === '中国') cloudKeys.push('China', 'CASC')
    } else {
      const filterLabel = launchListFilterLabel(listFilter)
      if (filterLabel) cloudKeys.push(filterLabel)
    }
    const cloudPool = list.slice()
    for (let i = 0; i < cloudKeys.length && picked.length < limit; i++) {
      try {
        const res = await searchLaunchesByKeyword(cloudKeys[i], {
          limit: 40,
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

  const items = []
  for (let i = 0; i < picked.length; i++) {
    const card = await toChatMissionCard(picked[i], 'upcoming', { anyLaunch: true })
    if (card) items.push(card)
  }
  if (!items.length) return { card: null, scheduled: false, listFilter: listFilter || null }

  const filterLabel = launchListFilterLabel(listFilter)
  return {
    card: {
      cardType: 'launch_list',
      id: 'launch_list_' + items[0].id,
      title: filterLabel ? (filterLabel + '即将发射') : '即将发射',
      items,
      moreUrl: ROUTES.INDEX,
      listFilter: listFilter || null
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
  const boosterView = mergeStackUnit({
    id: booster.id || '',
    status: booster.status || '状态待更新',
    progress: clampProgress(booster.progress)
  }, stack.booster)
  const shipView = mergeStackUnit({
    id: ship.id || '',
    status: ship.status || '状态待更新',
    progress: clampProgress(ship.progress)
  }, stack.ship)

  return {
    card: {
      cardType: 'starship_status',
      id: 'starship_status',
      title: '星舰下一飞组合体',
      booster: {
        id: boosterView.id,
        status: boosterView.status || '状态待更新',
        progress: boosterView.progress,
        progressStyle: boosterView.progress != null
          ? ('width: ' + boosterView.progress + '%;')
          : ''
      },
      ship: {
        id: shipView.id,
        status: shipView.status || '状态待更新',
        progress: shipView.progress,
        progressStyle: shipView.progress != null
          ? ('width: ' + shipView.progress + '%;')
          : ''
      },
      checklist: checklistTotal
        ? { done: checklistDone, total: checklistTotal }
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
  const missionName = mission
    ? String(mission.missionName || mission.name || '').trim()
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
      tag: 'FLIGHT PROFILE',
      title: '飞行剖面演示',
      desc: missionName
        ? ('关联「' + missionName + '」· LL2 时间线动画演示')
        : '按任务时间线回放飞行剖面 · 双级遥测示意',
      cta: '进入演示 ›',
      variant: 'demo',
      missionId,
      detailType,
      missionName,
      detailUrl,
      gateProductId: 'mission_sim',
      gateProductName: '飞行剖面演示',
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
      tag: 'VEHICLE TRACKER',
      title: 'SpaceX 在轨飞行器追踪',
      desc: '官网同源遥测 · 可拖动 3D 地球实时定位在飞星舰与龙飞船',
      cta: '进入追踪 ›',
      variant: 'tracker',
      detailUrl: ROUTES.VEHICLE_TRACKER,
      gateProductId: 'orbital_data_center',
      gateProductName: '在轨飞行器追踪',
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
      tag: 'GO / NO-GO · SIM',
      title: '星舰任务指挥室',
      desc: '以飞行总监视角完成一次发射：席位轮询、天气权衡、筷子捕获决策',
      cta: '进入指挥室 ›',
      variant: 'sim',
      detailUrl: '/subpackages/mission-sim/mission-sim',
      gateProductId: 'mission_sim',
      gateProductName: '星舰任务指挥室',
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
      tag: 'STARSHIP · PROGRESS',
      title: '星舰进度',
      desc: '星舰硬件设施、事件更新与封路提醒 · 进入进度页查看最新动态',
      cta: '打开星舰进度 ›',
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
        title: c.title || '发射集锦'
      }
    }
  }
  if (data.videoUrl) {
    return {
      videoUrl: String(data.videoUrl),
      poster: videoSnapshotUrl(data.videoUrl, 30),
      publisher: data.sourcePublisher || '',
      durationSec: Number(data.durationSec) || 0,
      title: '发射回放'
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

  const mission = hit.mission
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
  subParts.push(playable ? '集锦回放' : '回放入口')

  return {
    card: {
      cardType: 'mission_replay',
      id: 'mission_replay_' + launchId,
      launchId,
      missionName,
      detailType,
      title: (missionName || '发射任务') + ' · 集锦回放',
      desc: playable
        ? subParts.join(' · ')
        : '在线集锦暂未就绪，点击打开任务详情查看回放',
      cta: playable ? '观看集锦 ›' : '打开详情 ›',
      poster,
      /** 仅供点击后写入 pendingEventVideo；卡片层只用 poster，不预加载 */
      videoUrl: playable ? clip.videoUrl : '',
      playable,
      gateProductId: 'mission_replay',
      gateProductName: '发射回放',
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

  // 本地扩大：即将 100 + 已完成 80（覆盖更多火箭，不单靠预热缓存）
  try {
    const [upRes, compRes] = await Promise.all([
      getUpcomingMissions(100, 0).catch(() => ({ list: [] })),
      getCompletedMissions(80, 0).catch(() => ({ list: [] }))
    ])
    _mergeMissionPool(pool, upRes.list, 'upcoming')
    _mergeMissionPool(pool, compRes.list, 'completed')
  } catch (e) {}

  let deduped = _dedupeMissions(pool)
  // 「什么时候发射」等未来问法：优先即将发射，本地无排期才回落历史
  const prefer = missionLookupTimePreference(queryText)
  let hit = pickBestMissionMatch(deduped, queryText)
  if (hit && prefer && hit.detailType !== prefer) hit = null

  // 云端回退：本地未命中时按中英查询词打 LL2 search
  if (!hit || !hit.mission) {
    const queries = buildLaunchSearchQueries(queryText)
    const cloudPool = []
    for (let i = 0; i < queries.length; i++) {
      try {
        // 未来问法先只搜 upcoming（LL2 previous 按 -net 排序会盖过未排期任务）
        const res = await searchLaunchesByKeyword(queries[i], {
          limit: 24,
          upcomingOnly: prefer === 'upcoming'
        })
        _mergeMissionPool(cloudPool, res && res.list, null)
      } catch (e) {}
      // 每搜完一轮就尝试命中，命中即停，省流量
      const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
      if (cloudHit && cloudHit.mission) {
        hit = cloudHit
        break
      }
    }
    // upcoming 侧仍无命中：放开窗口再搜一轮（含 previous），至少给出历史任务卡
    if ((!hit || !hit.mission) && prefer === 'upcoming') {
      for (let i = 0; i < queries.length; i++) {
        try {
          const res = await searchLaunchesByKeyword(queries[i], { limit: 24 })
          _mergeMissionPool(cloudPool, res && res.list, null)
        } catch (e) {}
        const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
        if (cloudHit && cloudHit.mission) {
          hit = cloudHit
          break
        }
      }
    }
    if ((!hit || !hit.mission) && cloudPool.length) {
      // 打分略宽：云端结果里取最高分（阈值已在 score 内）
      hit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
    }
    // 云端也没有即将发射：回落本地全池（含历史），避免完全不出卡
    if ((!hit || !hit.mission) && prefer) {
      hit = pickBestMissionMatch(deduped, queryText, { prefer: '' })
    }
  }

  if (!hit || !hit.mission) return { card: null, scheduled: false }
  const card = await toChatMissionCard(hit.mission, hit.detailType, { anyLaunch: true })
  return { card, scheduled: !!card }
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
  if (scope === 'today') return '今日'
  if (scope === 'week') return '本周'
  if (scope === 'month') return '本月'
  const nowYear = new Date().getUTCFullYear()
  if (Number(year) === nowYear) return '本年度'
  return String(year) + ' 年'
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
  const countryLabel = country || '全球'
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
      ? (year + ' 年' + country + '发射统计')
      : (year + ' 年全球发射统计'))
    : (scopeLabel + countryLabel + '发射')

  const subtitle = !dataReady
    ? '统计数据暂未就绪，可进入详情页查看'
    : (yearTotal != null
      ? ('本年度累计 ' + yearTotal + ' 次')
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
      cta: '查看全球发射统计 ›',
      detailUrl: buildLaunchStatsDetailUrl(year, country || ''),
      gateProductId: 'global_launch_stats',
      gateProductName: '全球发射统计'
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
  const name = agency.name || '发射商'
  const abbrev = agency.abbrev || ''
  const displayName = translateAgencyName(name, abbrev) || abbrev || name
  const typeName = agency.type && agency.type.name ? agency.type.name : ''
  const typeZh = AGENCY_TYPE_ZH[typeName] || typeName || ''
  const countryName = agency.country && agency.country[0] ? agency.country[0].name : ''
  const countryLabel = AGENCY_COUNTRY_ZH[countryName] || countryName || ''
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
  const desc = String(agency.description || '').trim()
  const descShort = desc.length > 72 ? (desc.slice(0, 72) + '…') : desc
  const metaParts = []
  if (countryLabel) metaParts.push(countryLabel)
  if (foundingYear) metaParts.push(foundingYear + ' 年成立')
  if (total != null) metaParts.push('历史 ' + total + ' 次发射')

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
    metaLine: metaParts.join(' · '),
    desc: descShort,
    cta: '进入发射商详情 ›',
    detailUrl: ROUTES.AGENCY_DETAIL + '?id=' + encodeURIComponent(String(agency.id)),
    gateProductId: 'agency_encyclopedia',
    gateProductName: '全球发射商图鉴'
  }
}

/**
 * 发射商信息卡：本地图鉴模糊匹配 → search 回退
 */
async function resolveAgencyLookupCard(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const queryText = opts.queryText || opts.text || ''
  const key = extractAgencySearchKey(queryText) || String(queryText || '').trim()
  // 中文别名优先用英文 canonical 搜（中国航天科技集团 → casc），避免云端乱配
  const searchKey = resolveAgencyCanonicalSearchKey(queryText) || key
  const knownCanon = detectKnownAgencyCanonical(queryText)

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

  if ((!hit || !hit.agency) && searchKey.length >= 2 && !opts.agencyHint) {
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
      tag: 'STARBASE · ROAD',
      title: '星舰基地封路通知',
      desc: '查看最新道路/海滩封闭时段 · 常预示测试或试飞临近',
      cta: '查看封路 ›',
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
  const title = stationName || '空间站实时状态'
  const desc = stationName
    ? ('查看「' + stationName + '」乘组、停靠与轨道实时状态')
    : 'ISS / 天宫 · 乘组与轨道实时状态'

  return {
    card: {
      cardType: 'entry',
      entryKind: 'station',
      id: 'entry_station_' + (stationId || 'monitor'),
      tag: isTiangong ? 'TIANGONG' : (stationId === '4' ? 'ISS' : 'STATION'),
      title,
      desc,
      cta: stationId ? '进入详情 ›' : '打开监控中心 ›',
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
    cta: s.cta || '查看详情 ›',
    variant: s.variant || 'wiki',
    gateProductId: s.gateProductId || '',
    gateProductName: s.gateProductName || ''
  }
}

/**
 * 观礼点卡（本地静态点位，最多两张：主推 + 备选）
 * 军事管制发射场只出一张「需官方渠道」的说明卡，不带导航坐标
 */
function resolveViewingSpotCards(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const picked = pickViewingSpots(opts.queryText || '', 2)
  const site = picked.site || {}
  const cards = []

  if (picked.restricted) {
    cards.push(buildSpecCard({
      specKind: 'viewing_spot',
      targetId: picked.siteKey,
      targetName: site.siteName || '',
      tag: '观礼须知 · 需官方渠道',
      title: (site.siteName || '该发射场') + '暂无公共观礼点',
      subtitle: [site.countryLabel, site.padNote].filter(Boolean).join(' · '),
      variant: 'viewing',
      cta: '需官方渠道预约',
      note: picked.restrictedNote || '',
      rows: [
        { label: '开放情况', value: '周边无公共观礼点' },
        { label: '抵达方式', value: '官方组织 / 正规团队报备' }
      ]
    }))
    return { cards, picked }
  }

  picked.spots.forEach((spot) => {
    cards.push(buildSpecCard({
      specKind: 'viewing_spot',
      targetId: spot.id,
      targetName: spot.name,
      tag: '观礼点 · ' + (site.siteName || ''),
      title: spot.name + (spot.nameEn ? '（' + spot.nameEn + '）' : ''),
      subtitle: spot.address || '',
      variant: 'viewing',
      cta: '一键导航 ›',
      note: spot.tips || '',
      nav: toNavPoint(spot),
      rows: [
        { label: '距离', value: spot.distanceText || '' },
        { label: '视角', value: spot.viewText || '' },
        { label: '费用', value: spot.costText || '' },
        { label: '可看', value: site.padNote || '' }
      ]
    }))
  })
  return { cards, picked }
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
  const subtitleParts = []
  if (cfg.manufacturerName) subtitleParts.push(cfg.manufacturerName)
  if (cfg.reusable === true) subtitleParts.push('可复用')
  const card = buildSpecCard({
    specKind: 'rocket_model',
    targetId: hit.id,
    targetName: cfg.name || '',
    tag: 'ROCKET',
    title: cfg.full_name || cfg.name || '运载火箭',
    subtitle: subtitleParts.join(' · '),
    desc: cfg.description || '',
    variant: 'wiki',
    cta: '查看型号档案 ›',
    rows: [
      { label: '全长', value: fmtSpecNum(cfg.length, ' m', 1) },
      { label: '直径', value: fmtSpecNum(cfg.diameter, ' m', 1) },
      { label: '起飞质量', value: fmtSpecNum(cfg.launch_mass, ' t') },
      { label: 'LEO 运力', value: fmtSpecNum(cfg.leo_capacity, ' kg') },
      { label: '起飞推力', value: fmtSpecNum(cfg.to_thrust, ' kN') },
      { label: '发射战绩', value: total ? (total + ' 次 · 成功 ' + success) : '' }
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
  const card = buildSpecCard({
    specKind: 'launch_site',
    targetId: site.id,
    targetName: site.name || '',
    tag: 'LAUNCH SITE',
    title: site.name || '发射场',
    subtitle: [site.countryName, site.active ? '在用' : '已停用'].filter(Boolean).join(' · '),
    image: site.imageUrl || site.mapImage || '',
    desc: site.description || '',
    variant: 'site',
    cta: '查看发射场详情 ›',
    gateProductId: 'launch_site_encyclopedia',
    gateProductName: '全球发射场',
    rows: [
      { label: '累计发射', value: launches ? launches + ' 次' : '' },
      { label: '累计回收', value: landings ? landings + ' 次' : '' },
      { label: '时区', value: site.timezoneName || '' },
      { label: '坐标', value: (site.latitude != null && site.longitude != null)
        ? (Number(site.latitude).toFixed(2) + ', ' + Number(site.longitude).toFixed(2))
        : '' }
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
  const card = buildSpecCard({
    specKind: 'spacecraft',
    targetId: sc.id,
    targetName: sc.name || '',
    tag: 'SPACECRAFT',
    title: sc.name || '航天器',
    subtitle: [translateAgencyName(sc.agencyName) || sc.agencyName, sc.inUse ? '现役' : '退役']
      .filter(Boolean).join(' · '),
    image: sc.imageUrl || '',
    desc: sc.capability || sc.details || '',
    variant: 'craft',
    cta: '查看飞船档案 ›',
    gateProductId: 'spacecraft_encyclopedia',
    gateProductName: '航天器图鉴',
    rows: [
      { label: '乘员', value: sc.crewCapacity != null && Number(sc.crewCapacity) > 0
        ? Number(sc.crewCapacity) + ' 人' : '' },
      { label: '高度', value: fmtSpecNum(sc.height, ' m', 1) },
      { label: '直径', value: fmtSpecNum(sc.diameter, ' m', 1) },
      { label: '上行载荷', value: fmtSpecNum(sc.payloadCapacity, ' kg') },
      { label: '首飞', value: String(sc.maidenFlight || '').slice(0, 10) },
      { label: '发射次数', value: total ? total + ' 次' : '' }
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
      const card = buildSpecCard({
        specKind: 'booster',
        targetId: item.serial,
        targetName: item.serial,
        tag: 'BOOSTER',
        title: item.serial || serial,
        subtitle: [item.rocketFamily, item.statusZh].filter(Boolean).join(' · '),
        variant: 'booster',
        cta: '查看助推器档案 ›',
        rows: [
          { label: '飞行次数', value: item.flights ? item.flights + ' 次' : '' },
          { label: '成功回收', value: attempts ? (landings + ' / ' + attempts) : '' },
          { label: '首飞', value: item.firstFlight || '' },
          { label: '最近一飞', value: item.lastFlight || '' },
          { label: '最近任务', value: recent && recent.mission ? recent.mission : '' }
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
      tag: 'BOOSTER · GENEALOGY',
      title: '助推器家谱',
      desc: '按编号追每一枚一级的复用与回收战绩 · 支持复用次数排行',
      cta: '打开家谱 ›',
      variant: 'booster',
      detailUrl: ROUTES.BOOSTER_GENEALOGY,
      gateProductId: 'booster_genealogy',
      gateProductName: '助推器家谱',
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
      name: row.name || ('发射任务 #' + row.id),
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
      title: '我订阅的发射提醒',
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
  const name = mission.missionName || mission.name || '下一场发射'
  return {
    card: {
      cardType: 'entry',
      entryKind: 'launch_vote',
      id: 'entry_launch_vote_' + mission.id,
      tag: 'VOTE · 竞猜',
      title: '猜一下：' + name,
      desc: '在任务详情页投票押准时/推迟或成败，发射后可回看自己猜得准不准',
      cta: '去投票 ›',
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
      tag: 'YEAR IN REVIEW',
      title: '我的航天年度回顾',
      desc: '这一年你追了多少场发射、最常看哪家发射商 · 生成可分享长图',
      cta: '打开年度回顾 ›',
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
      tag: 'SKY CALENDAR',
      title: '天象日历',
      desc: '流星雨、日月食、行星冲日与大距 · 按时间排好并可设提醒',
      cta: '打开天象日历 ›',
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
      tag: 'NEWS · 事件',
      title: '航天事件与新闻',
      desc: '发射事件、任务动态与航天资讯 · 中文摘要与图集',
      cta: '打开事件页 ›',
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
    tag: 'NASA APOD',
    title: doc.title || '每日天文图',
    subtitle: [doc.date || '', doc.copyright ? '© ' + String(doc.copyright).trim() : '']
      .filter(Boolean).join(' · '),
    image,
    desc: doc.explanation || '',
    variant: 'apod',
    cta: '打开天象页看大图 ›',
    rows: [
      { label: '日期', value: doc.date || '' },
      { label: '类型', value: isVideo ? '视频' : '图片' }
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
      tag: 'STARLINK · 过境',
      title: '星链过境预报',
      desc: '按你的位置算未来可见过境 · 含方位角、仰角与观测地图',
      cta: '打开监控中心 ›',
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
      tag: 'LIVE · 直播观看',
      title: '看发射直播',
      desc: '监控中心内嵌视频号直播间 · 另有 B站直播与推荐直播入口',
      cta: '打开直播观看 ›',
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
      tag: 'STARLINK · 星座',
      title: '星链实时分布',
      desc: '全球在轨星链的实时位置与在轨颗数 · 可拖动缩放的 3D 星座视图',
      cta: '查看实时分布 ›',
      variant: 'starlink',
      detailUrl: ROUTES.STARLINK_FULLSCREEN,
      gateProductId: 'starlink_pro',
      gateProductName: '星链高级追踪',
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
      tag: 'ARTEMIS · 绕月',
      title: 'Artemis II 任务面板',
      desc: '任务阶段、绕月轨迹与遥测简报 · 载人绕月飞行进度',
      cta: '进入任务面板 ›',
      variant: 'artemis',
      detailUrl: ROUTES.ARTEMIS_DETAIL,
      gateProductId: 'artemis_telemetry',
      gateProductName: 'Artemis 遥测面板',
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
      tag: 'STARSHIP · 硬件',
      title: hit.name || '星舰硬件',
      subtitle: [hit.typeZh || hit.type, hit.categoryZh].filter(Boolean).join(' · '),
      image: hit.imageMissing ? '' : (hit.image || ''),
      desc: hit.notesZh || hit.notesEn || '',
      variant: 'hardware',
      cta: '查看硬件详情 ›',
      gateProductId: 'starship_hardware',
      gateProductName: '星舰硬件设施',
      rows: [
        { label: '状态', value: hit.statusZh || hit.status || '' },
        { label: '类型', value: hit.typeZh || hit.type || '' }
      ]
    })
    return { card, scheduled: true }
  }

  return {
    card: {
      cardType: 'entry',
      entryKind: 'starship_hardware',
      id: 'entry_starship_hardware',
      tag: 'STARSHIP · 硬件',
      title: '星舰硬件设施',
      desc: '在建与在役的助推器、飞船与地面设施 · 状态、测试与图片',
      cta: '打开硬件列表 ›',
      variant: 'hardware',
      detailUrl: ROUTES.HARDWARE_LIST,
      gateProductId: 'starship_hardware',
      gateProductName: '星舰硬件设施',
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
        tag: 'BOOSTER · GENEALOGY',
        title: '助推器家谱',
        desc: '复用次数排行、单枚战绩与回收记录',
        cta: '打开家谱 ›',
        variant: 'booster',
        detailUrl: ROUTES.BOOSTER_GENEALOGY,
        gateProductId: 'booster_genealogy',
        gateProductName: '助推器家谱',
        needMissionSimFlag: false
      },
      scheduled: true
    }
  }

  const top = Array.isArray(res.topReused) ? res.topReused[0] : null
  const card = buildSpecCard({
    specKind: 'recovery_stats',
    targetId: 'all',
    targetName: '回收总览',
    tag: 'RECOVERY · 总览',
    title: '助推器回收与复用总览',
    subtitle: res.totalBoosters ? (res.totalBoosters + ' 枚在册 · ' + (res.activeBoosters || 0) + ' 枚在役') : '',
    variant: 'booster',
    cta: '查看助推器家谱 ›',
    gateProductId: 'booster_genealogy',
    gateProductName: '助推器家谱',
    rows: [
      { label: '累计飞行', value: res.totalFlights ? res.totalFlights + ' 次' : '' },
      { label: '成功回收', value: res.totalAttempts
        ? (res.totalLandings + ' / ' + res.totalAttempts) : '' },
      { label: '回收成功率', value: res.landingSuccessRate || '' },
      { label: '复用榜首', value: top && top.serial
        ? (top.serial + ' · ' + (top.flights || 0) + ' 飞') : '' }
    ]
  })
  return { card, scheduled: true }
}

async function resolveRichChatPayload(text, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const intent = resolveAiChatRichIntent(text)
  let launchContext = opts.launchContext || null
  const cards = []

  if (intent === 'starship_next') {
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
      launchContext = enrichLaunchContextWithAgency(launchContext, resolved.card)
    } else {
      launchContext = enrichLaunchContextNoAgency(launchContext, text)
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
  } else if (intent === 'viewing_spot') {
    const resolved = resolveViewingSpotCards({ ...opts, queryText: text })
    if (resolved.cards.length) {
      resolved.cards.forEach((card) => cards.push(card))
      launchContext = enrichLaunchContextWithViewingSpots(launchContext, {
        siteName: (resolved.picked.site && resolved.picked.site.siteName) || '',
        spots: resolved.picked.spots,
        restricted: resolved.picked.restricted,
        restrictedNote: resolved.picked.restrictedNote,
        matched: resolved.picked.matched
      })
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
  }

  return { intent, cards, launchContext }
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
  resolveViewingSpotCards,
  resolveArtemisEntryCard,
  resolveStarshipHardwareCard,
  resolveRecoveryStatsCard,
  buildSpecCard,
  resolveRichChatPayload,
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
