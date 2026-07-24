/**
 * 星问富消息：意图识别 + 任务/列表/状态卡片载荷
 */
const {
  getUpcomingStarshipMissions,
  getUpcomingMissions,
  getCompletedMissions,
  searchLaunchesByKeyword
} = require('../../../utils/api-launch-list.js')
const { getStarshipStatusFromDB } = require('../../../utils/api-app-services.js')
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
  resolveAiChatRichIntent,
  parseLaunchStatsFocus,
  getBeijingPeriodBounds,
  countLaunchesInBounds,
  pickStarshipMission,
  pickLaunchList,
  pickStation,
  pickBestMissionMatch,
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

  return {
    card: {
      cardType: 'starship_status',
      id: 'starship_status',
      title: '星舰下一飞组合体',
      booster: {
        id: booster.id || '',
        status: booster.status || '状态待更新',
        progress: clampProgress(booster.progress),
        progressStyle: clampProgress(booster.progress) != null
          ? ('width: ' + clampProgress(booster.progress) + '%;')
          : ''
      },
      ship: {
        id: ship.id || '',
        status: ship.status || '状态待更新',
        progress: clampProgress(ship.progress),
        progressStyle: clampProgress(ship.progress) != null
          ? ('width: ' + clampProgress(ship.progress) + '%;')
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
      desc: '组合体状态、事件更新与封路提醒 · 进入进度页查看最新动态',
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
  let hit = pickBestMissionMatch(deduped, queryText)

  // 云端回退：本地未命中时按中英查询词打 LL2 search
  if (!hit || !hit.mission) {
    const queries = buildLaunchSearchQueries(queryText)
    const cloudPool = []
    for (let i = 0; i < queries.length; i++) {
      try {
        const res = await searchLaunchesByKeyword(queries[i], { limit: 24 })
        _mergeMissionPool(cloudPool, res && res.list, null)
      } catch (e) {}
      // 每搜完一轮就尝试命中，命中即停，省流量
      const cloudHit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
      if (cloudHit && cloudHit.mission) {
        hit = cloudHit
        break
      }
    }
    if ((!hit || !hit.mission) && cloudPool.length) {
      // 打分略宽：云端结果里取最高分（阈值已在 score 内）
      hit = pickBestMissionMatch(_dedupeMissions(cloudPool), queryText)
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
