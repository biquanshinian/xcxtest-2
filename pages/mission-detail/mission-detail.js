const { getLaunchDetail, mapRawUpdatesToLaunchUpdates } = require('./utils/api-launch-detail.js')
const { getUpcomingMissions, getCompletedMissions } = require('../../utils/api-launch-list.js')
const { getRoadClosureNotice } = require('../../utils/api-road-closure.js')
const { getVoteStats, castVote, fetchLl2LaunchTimeline, fetchLl2LaunchUpdates } = require('../../utils/api-app-services.js')
const { formatDate, getCountdown, resolveMissionRocketImage, isDefaultRocketSrc, shouldReplaceRocketImage } = require('../../utils/util.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('./utils/single-page.js')
const { subscribeLaunch, unsubscribeLaunch, isSubscribed } = require('../../utils/subscribe.js')
const { isOaAlertReady, peekOaAlertReady } = require('../../utils/oa-alert.js')
const { buildMissionShareOptions, buildMissionDetailUrl } = require('../../utils/index-mission-nav.js')
const { ROUTES, buildUrl } = require('../../utils/routes.js')
const { applyPageSearchInfo, buildMissionDetailSearchMeta } = require('./utils/page-search-info.js')
const pageBase = require('../../utils/page-base.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { resolveMissionDetailRoute } = require('./utils/page-route-options.js')
const {
  SHARE_GATE_TTL_MS,
  parseShareStamp,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('./utils/share-gate.js')
const { wgs84ToGcj02 } = require('./coord.js')
const { normalizeLl2TimelineList } = require('./utils/ll2-launch-timeline.js')
const { computeLaunchTimelineProgress } = require('./utils/launch-timeline-progress.js')
const { loadMissionLaunchStats, applyClientAgencyFallback } = require('./utils/mission-launch-stats.js')
const { formatCloudError } = require('../../utils/launch-stats-cloud.js')
const config = require('../../utils/config.js')
const { isLiveEntryAllowed, isFeatureEnabled } = require('../../utils/feature-flags.js')
const { videoSnapshotUrl, optimizeImageUrl } = require('../../utils/cos-url.js')
const { openBoosterEntityDetail, openRocketModelDetail } = require('../../utils/booster-nav.js')

const CHANNELS_LIVE_PATH = '../../subpackages/shared/utils/channels-live.js'
let _channelsLiveMod = null
let _channelsLiveLoadPromise = null

function loadChannelsLiveModule() {
  if (_channelsLiveMod) return Promise.resolve(_channelsLiveMod)
  if (_channelsLiveLoadPromise) return _channelsLiveLoadPromise
  _channelsLiveLoadPromise = require.async(CHANNELS_LIVE_PATH)
    .then((mod) => {
      _channelsLiveMod = mod
      return mod
    })
    .catch((err) => {
      _channelsLiveLoadPromise = null
      throw err
    })
    .finally(() => {
      if (_channelsLiveMod) _channelsLiveLoadPromise = null
    })
  return _channelsLiveLoadPromise
}

function getLiveFinderUserNameFromConfig() {
  const cfg = (config && config.channelsLive) || {}
  return String(cfg.finderUserName || '').trim()
}

// 直播配置（与监控中心 pages/monitor/monitor.js 保持一致：同一个视频号 + 同一个 B 站二维码）
const BILI_LIVE_QR_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1773602498836_o237or.png'
const BILI_LIVE_URL = 'https://live.bilibili.com/390508'
const BILI_LIVE_TITLE = 'SpaceX星舰直播'

// —— 发射回放（LL2 vid_urls + COS 转存） ——

/** 回放源排序：官方直播 > 非官方直播 > 转播（与云端 mission-replay.js 同规则） */
function replaySourceRank(typeName) {
  const t = String(typeName || '').toLowerCase()
  if (t.includes('official') && !t.includes('unofficial')) return 0
  if (t.includes('unofficial webcast')) return 1
  if (t.includes('re-stream') || t.includes('restream')) return 2
  return 3
}

function replayTypeLabel(typeName) {
  const rank = replaySourceRank(typeName)
  if (rank === 0) return '官方回放'
  if (rank === 1) return '第三方回放'
  if (rank === 2) return '转播回放'
  return '视频回放'
}

/** mission.vidUrls → 外链回放条目（官方优先，最多 3 条，点击复制） */
function buildReplayLinks(vidUrls) {
  const list = Array.isArray(vidUrls) ? vidUrls : []
  return list
    .filter((v) => v && typeof v.url === 'string' && /^https?:\/\//i.test(v.url))
    .slice()
    .sort((a, b) => {
      const r = replaySourceRank(a.type) - replaySourceRank(b.type)
      if (r !== 0) return r
      return (b.priority || 0) - (a.priority || 0)
    })
    .slice(0, 3)
    .map((v) => ({
      url: v.url,
      title: v.title || '',
      publisher: v.publisher || '',
      typeLabel: replayTypeLabel(v.type)
    }))
}

function formatReplayDuration(sec) {
  const s = Number(sec) || 0
  if (s <= 0) return ''
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h > 0) return `${h}小时${m > 0 ? m + '分' : ''}`
  return `${Math.max(1, m)}分钟`
}

function getChannelsFallbackGuideFromConfig() {
  return {
    enabled: false,
    title: '推荐观看',
    nickname: '',
    qrUrl: '',
    qrDisplayUrl: '',
    tip: '',
    updatedAt: ''
  }
}
const {
  formatSecondsText,
  getSecondsReel,
  DEFAULT_ROCKET_IMAGE,
  DEFAULT_SHARE_IMAGE,
  CALENDAR_SITE_META,
  getInitialVoteState,
  buildVoteState,
  buildDualVoteUiPatch,
  mergeVoteBundle,
  getLocalVote,
  saveLocalVote,
  removeLocalVote,
  getMissionDetailCacheEntry,
  setMissionDetailCacheEntry,
  shouldReuseMissionDetailCache,
  shouldReuseMissionListSnapshot,
  getMissionDetailCacheKey,
  shouldSkipVoteRefresh
} = require('../../utils/index-page-helpers.js')

const MISSION_DETAIL_CACHE_TTL = 10 * 60 * 1000

/** 是否有 API 返回的发射台精确经纬度（优先用于地图，避免仅用 KNOWN_LAUNCH_SITE_COORDS 近似点） */
function hasPrecisePadCoords(mission) {
  if (!mission || typeof mission !== 'object') return false
  const p = mission.padDetail
  if (!p || typeof p !== 'object') return false
  const lat = Number(p.latitude)
  const lng = Number(p.longitude)
  return isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)
}

const KNOWN_LAUNCH_SITE_COORDS = {
  'starbase': { lat: 25.9972, lng: -97.1553, name: 'Starbase, Boca Chica' },
  'lc-39a': { lat: 28.6083, lng: -80.6041, name: 'LC-39A, Kennedy Space Center' },
  'slc-40': { lat: 28.5618, lng: -80.5770, name: 'SLC-40, Cape Canaveral' },
  'slc-4e': { lat: 34.6322, lng: -120.6115, name: 'SLC-4E, Vandenberg' },
  'oca': { lat: 9.0477, lng: 167.7431, name: 'Omelek Island' },
  'wenchang': { lat: 19.6145, lng: 110.9510, name: '文昌航天发射场' },
  'jiuquan': { lat: 40.9582, lng: 100.2915, name: '酒泉卫星发射中心' },
  'xichang': { lat: 28.2461, lng: 102.0265, name: '西昌卫星发射中心' },
  'taiyuan': { lat: 38.8491, lng: 111.6082, name: '太原卫星发射中心' },
  'baikonur': { lat: 45.9645, lng: 63.3052, name: 'Baikonur Cosmodrome' },
  'vostochny': { lat: 51.8845, lng: 128.3340, name: 'Vostochny Cosmodrome' },
  'plesetsk': { lat: 62.9271, lng: 40.5780, name: 'Plesetsk Cosmodrome' },
  'kourou': { lat: 5.2361, lng: -52.7690, name: 'Guiana Space Centre' },
  'sriharikota': { lat: 13.7199, lng: 80.2304, name: 'Satish Dhawan Space Centre' },
  'tanegashima': { lat: 30.4000, lng: 131.0000, name: 'Tanegashima Space Center' },
  'naro': { lat: 34.4316, lng: 127.5351, name: 'Naro Space Center' },
  'semnan': { lat: 35.2342, lng: 53.9212, name: 'Semnan Launch Site' },
  'wallops': { lat: 37.8433, lng: -75.4775, name: 'Wallops Flight Facility' },
  'mahia': { lat: -39.2615, lng: 177.8648, name: 'Rocket Lab LC-1, Mahia' }
}
const DETAIL_VOTE_REFRESH_TTL = 5 * 60 * 1000
const ROAD_CLOSURE_QUERY_TTL = 5 * 60 * 1000

function truncateText(text, maxLength) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  if (!maxLength || raw.length <= maxLength) return raw
  return `${raw.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildDiscussionTopic(mission) {
  const rocket = String(mission.rocketName || '').trim()
  const fullName = String(mission.missionName || mission.name || '').trim()
  if (!rocket && !fullName) return '航天任务讨论'

  // 从任务名称中提取关键词（去掉公司前缀和冗长编号）
  var shortName = fullName
  // 去除常见前缀如 "SpaceX ", "ULA ", "ISRO " 等
  shortName = shortName.replace(/^(SpaceX|ULA|ISRO|CASC|Roscosmos|Arianespace|RocketLab|Rocket Lab|Blue Origin|Relativity)\s+/i, '')
  // 提取核心任务名（取第一个有意义的词组，如 "Starlink Group 12-7" -> "Starlink"）
  var coreMatch = shortName.match(/^(Starlink|Starship|Crew Dragon|Dragon|Transporter|Bandwagon|CRS|GPS|NROL|Türksat|OneWeb|Eutelsat|SES|O3b|Astra|Vega|Ariane|Falcon|长征|神舟|天舟|嫦娥|问天|梦天|巡天)/i)
  var coreName = coreMatch ? coreMatch[1] : ''

  if (rocket && coreName) {
    return rocket + ' ' + coreName
  }
  if (rocket && shortName) {
    // 火箭名 + 精简任务名（截取前 10 字符）
    var brief = shortName.length > 10 ? shortName.slice(0, 10) : shortName
    return rocket + ' ' + brief
  }
  if (rocket) return rocket
  return shortName || fullName
}

function buildMissionSeoMeta(mission, detailType) {
  const safeMission = mission || {}
  const missionName = String(safeMission.missionName || safeMission.name || '发射任务').trim()
  const rocketName = String(safeMission.rocketName || '').trim()
  const statusText = String(safeMission.statusBadgeText || safeMission.statusTextZh || '').trim()
  const agencyName = String(safeMission.launchAgency || '').trim()
  const dateText = safeMission.launchTime ? formatDate(safeMission.launchTime, 'MM月DD日') : ''
  const isUpcoming = detailType !== 'completed'
  const pageLabel = isUpcoming ? '发射倒计时' : '任务复盘'
  const subtitleTail = rocketName || agencyName || pageLabel
  const navTitle = truncateText(missionName, 18) || '任务详情'
  const shareParts = [missionName, rocketName, statusText, dateText, pageLabel].filter(Boolean)
  const pageTitle = truncateText([missionName, subtitleTail].filter(Boolean).join(' · '), 30) || '航天任务详情'
  const shareTitle = truncateText(`${shareParts.join(' · ')} | 火星探索日志`, 60) || '航天任务详情 | 火星探索日志'

  return {
    navTitle,
    pageTitle,
    shareTitle
  }
}

function buildMissionDetailBaseState(detailType) {
  const normalizedDetailType = detailType === 'completed' ? 'completed' : 'upcoming'
  return {
    loading: true,
    errorMessage: '',
    detailHydrating: false,
    detailType: normalizedDetailType,
    navTitle: normalizedDetailType === 'completed' ? '任务复盘' : '发射倒计时',
    pageTitle: normalizedDetailType === 'completed' ? '航天任务复盘详情' : '航天发射倒计时详情',
    shareTitle: normalizedDetailType === 'completed' ? '航天任务复盘详情 | 火星探索日志' : '航天发射倒计时详情 | 火星探索日志',
    missionCountdown: {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: false
    },
    missionDetailSecondsPrev: '00',
    missionDetailSecondsCurrent: '00',
    missionDetailSecondsRolling: false,
    missionDetailSecondsReel: ['01', '00', '59'],
    ...getInitialVoteState()
  }
}

function buildDefaultDetailExpanded() {
  return {
    missionDesc: false,
    rocketDesc: false,
    padDesc: false,
    locDesc: false
  }
}

/** descI18n 译文 override 的初始结构（空串/空数组时 WXML 兜底显示原文） */
function buildDefaultDescI18n() {
  return {
    missionDesc: '',
    rocketDesc: '',
    payloads: [],
    programs: [],
    updates: [],
    failReason: '',
    statusNote: '',
    padDesc: '',
    locDesc: '',
    weather: ''
  }
}

/**
 * 一二级箭体与助推器分卡去重：序列号已出现在 boosterStages 的级段不再重复显示，
 * 剩余级段并入「箭体与回收」块尾部（如 Falcon 9 的二级/上面级）。
 */
function computeStageInfoExtra(stageInfo, boosterStages) {
  const si = stageInfo && typeof stageInfo === 'object' ? stageInfo : {}
  const stages = Array.isArray(boosterStages) ? boosterStages : []
  const serials = {}
  stages.forEach(s => {
    if (s && s.serialNumber) serials[String(s.serialNumber).toUpperCase()] = true
  })
  const dedupe = (stage) => {
    if (!stage) return null
    const sn = stage.serialNumber ? String(stage.serialNumber).toUpperCase() : ''
    if (sn && serials[sn]) return null
    // 无序列号且已有分卡时，仅剩「型号/可回收」信息量太低的一级不再重复
    return stage
  }
  const firstStage = dedupe(si.firstStage)
  const secondStage = dedupe(si.secondStage)
  return {
    firstStage,
    secondStage,
    bothReusable: !!si.bothReusable,
    visible: !!(firstStage || secondStage)
  }
}

function buildDefaultDetailBlocks() {
  return {
    launcher: true,
    payload: true,
    pad: true,
    updates: true,
    links: true
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    errorMessage: '',
    detailHydrating: false,
    mission: null,
    detailType: 'upcoming',
    navTitle: '任务详情',
    pageTitle: '航天任务详情',
    shareTitle: '航天任务详情 | 火星探索日志',
    shareImage: '',
    /** 经会员分享链接（sst）进入的免门控截止时间：>0 时显示限时查看倒计时胶囊 */
    shareGateExpireAt: 0,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    scrollRefreshing: false,
    /** 朋友圈单页模式 scene 1154：无自定义 TabBar，需单独占位 */
    isMomentsPreview: false,
    missionCountdown: {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: false
    },
    missionDetailSecondsPrev: '00',
    missionDetailSecondsCurrent: '00',
    missionDetailSecondsRolling: false,
    missionDetailSecondsReel: ['01', '00', '59'],
    detailExpanded: buildDefaultDetailExpanded(),
    detailBlocks: buildDefaultDetailBlocks(),
    // 分栏页签：默认只渲染「概览」；其余页签首次切入才渲染（visitedTabs）并拉取数据
    detailTabs: [
      { key: 'overview', label: '概览' },
      { key: 'stats', label: '统计' },
      { key: 'info', label: '详情' },
      { key: 'timeline', label: '时间线' }
    ],
    activeTab: 'overview',
    visitedTabs: { overview: true, stats: false, info: false, timeline: false },
    detailScrollTop: 0,
    /** 页签栏吸顶位置 = 实测导航栏底边（navPlaceholderHeight 含 8rpx 内容间距，直接用会留缝） */
    detailTabStickyTop: 0,
    // 「翻译/原文」按钮状态；descI18n 为译文 override（空串时 WXML 兜底显示原文）
    descTranslated: false,
    descTranslating: false,
    descI18n: buildDefaultDescI18n(),
    // 实测渲染行数 > 3 行才折叠并显示「展开全文」（由 _measureDescOverflow 量取）
    descOverflow: { missionDesc: false, rocketDesc: false },
    missionSubscribed: false,
    oaAlertReady: false,
    ...getInitialVoteState(),
    fromSearch: false,
    // 地图预览
    mapPreviewReady: false,
    mapPreviewLat: 0,
    mapPreviewLng: 0,
    mapPreviewScale: 10,
    mapPreviewMarkers: [],
    mapPreviewSiteName: '',
    // 直播入口（与监控中心同款逻辑）
    liveFinderUserName: getLiveFinderUserNameFromConfig(),
    biliLive: {
      title: BILI_LIVE_TITLE,
      qrUrl: BILI_LIVE_QR_URL,
      liveUrl: BILI_LIVE_URL
    },
    showBiliQRModal: false,
    /** 自己未开播时：推荐第三方视频号主页二维码引导 */
    channelsFallbackGuide: getChannelsFallbackGuideFromConfig(),
    showChannelsGuideModal: false,
    /** 视频号直播（与监控中心 channels-live-panel 同源逻辑） */
    channelsLiveStatus: 0,
    channelsLiveFeedId: '',
    showChannelLiveTap: false,
    /** 直播入口总闸（enableLive + enableLiveWatch，过审 failClosed） */
    enableLiveEntry: false,
    /** 发射回放（enableMissionReplay 过审 failClosed）：集锦（压缩版）+ 完整回放外链 */
    enableReplayEntry: false,
    missionReplay: null,
    replayClips: [],
    replayLinks: [],
    /** Launch Library 飞行时间线（相对 T0），与当前任务 mission.id 绑定 */
    ll2FlightTimelineLoading: false,
    ll2FlightTimelineRows: [],
    ll2FlightTimelineError: '',
    ll2FlightTimelineEmpty: false,
    ll2FlightTimelineNet: '',
    tlTranslated: false,
    tlTranslating: false,
    tlI18n: { titles: [], descs: [] },
    /** LL2 型号 / 发射商发射统计（飞行时间线上方） */
    missionLaunchStatsLoading: false,
    missionLaunchStatsError: '',
    missionLaunchStats: null,
    /** 星舰任务指挥室入口（星舰任务 + 有 LL2 时间线 + enableMissionSim 开关） */
    missionSimEligible: false,
    enableMissionSim: false,
    /** 飞行剖面演示用时间线（与指挥室 payload 同构；免费预览） */
    flightDemoTimeline: [],
    /** 页面前台可见：控制内嵌演示 tick，避免后台空转 */
    pageVisible: true
  },

  /**
   * 朋友圈单页模式（scene 1154）：无自定义 TabBar，仅保留微信底栏占位，避免内容区被挤偏。
   */
  applyMomentsPreviewLayout() {
    try {
      const launchInfo = wx.getLaunchOptionsSync()
      if (!launchInfo || launchInfo.scene !== 1154) return

      const app = getApp()
      const layout = (app && app.getUiShellLayout && app.getUiShellLayout()) || {}
      const safeBottom = Number(layout.safeBottomInset) || 0
      const momentsBarPx = 52

      this.setData({
        isMomentsPreview: true,
        tabBarReservedHeight: momentsBarPx + safeBottom
      })
    } catch (_) {}
  },

  onReady() {
    // onLoad 阶段导航栏可能尚未渲染完成，onReady 补测一次吸顶位置
    this._measureTabStickyTop()
  },

  onShow() {
    this.setData({ pageVisible: true })
    // 从 profile 取消提醒后返回时刷新订阅状态（仅看本任务是否已写入订阅，不含 OA 全覆盖）
    const mission = this.data.mission
    if (mission && mission.id) {
      const subscribed = isSubscribed(mission.id)
      if (this.data.missionSubscribed !== subscribed) {
        this.setData({ missionSubscribed: subscribed })
      }
      // onHide 会清掉倒计时定时器：回到前台时若任务仍为未发射且未过期，
      // 按真实剩余时间重启倒计时（startMissionCountdown 内部会先 clear，避免重复定时器）
      const isUpcoming = this.data.detailType !== 'completed' &&
        !!(mission.launchTime && !getCountdown(mission.launchTime).isExpired)
      if (isUpcoming && !this._missionDetailTimer) {
        this.startMissionCountdown(mission.launchTime)
      }
    }
    this._refreshOaAlertReady(false)
  },

  async onLoad(options) {
    wx.setBackgroundColor({
      backgroundColor: '#000000',
      backgroundColorTop: '#000000',
      backgroundColorBottom: '#000000'
    })

    // 列表页（index/search）经 eventChannel 传入的任务快照：仅作首屏加速，
    // storage 快照与网络刷新逻辑保留作兜底（分享/冷启动无 opener 时走原路径）
    this._openerMissionSnapshot = null
    try {
      const channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
      if (channel && typeof channel.on === 'function') {
        channel.on('missionSnapshot', (mission) => {
          if (mission && mission.id) this._openerMissionSnapshot = mission
        })
      }
    } catch (e) {}

    // 小程序 AI 接力：领取 handoff payload（query 已含 id/type，payload 供首屏加速参考）
    try {
      const app = getApp()
      if (app && typeof app.takeAgentHandoff === 'function' && typeof this.getPageId === 'function') {
        this._agentHandoff = app.takeAgentHandoff(this.getPageId())
      }
    } catch (e) {}

    const route = resolveMissionDetailRoute(options)
    this._entryRoute = route
    const { detailType, id, fromSearch } = route

    // 会员分享的回放链接带 sst 时间戳：接收者 24h 内点回放免门控（限时查看倒计时胶囊），
    // 超时恢复原门控；有权益用户再分享写新 sst，无权益接收者转发继承原 sst（窗口不重置）。
    // 只认本页原始 options（与 launch-updates/event-detail 一致）：enter query 会话内不变，
    // 若经 route.options 合并会把 sst 泄漏给之后自然打开的其他任务详情页
    this._shareSst = parseShareStamp(options)
    if (this._shareSst && Date.now() - this._shareSst <= SHARE_GATE_TTL_MS) {
      this.setData({ shareGateExpireAt: this._shareSst + SHARE_GATE_TTL_MS })
    }
    warmShareEntitlement(this, 'mission_replay')

    this.initUiShell()
    this.applyMomentsPreviewLayout()
    this._measureTabStickyTop()
    // 头图与首页倒计时/卡片同源：先等 media_assets，再渲染，避免先闪 default 再纠正
    try {
      await Promise.race([
        loadCloudMediaMap().catch(() => {}),
        new Promise((r) => setTimeout(r, 2500))
      ])
    } catch (e) {}

    this.setData({
      detailType,
      fromSearch,
      navTitle: detailType === 'completed' ? '任务复盘' : '任务详情',
      shareImage: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE)
    })
    this.ensureShareImageHttpUrl(this.data.shareImage)

    if (!id) {
      this.setData({
        loading: false,
        errorMessage: '缺少任务参数，请返回首页重新进入'
      })
      return
    }

    await this.loadMissionDetail(id, detailType)
    // map 若在 2.5s 预算后才到齐，再强制对齐一次头图
    loadCloudMediaMap()
      .then(() => {
        try { this._refreshMissionRocketImageFromMediaMap() } catch (e) {}
      })
      .catch(() => {})
  },

  onUnload() {
    this.clearMissionCountdownTimer()
    this._backfillIndexCompletedStatus()
  },

  onHide() {
    this.setData({ pageVisible: false })
    this.clearMissionCountdownTimer()
    this._backfillIndexCompletedStatus()
  },

  /**
   * 详情已是终态时，回写首页历史列表同 id 卡片角标（解决详情「已成功」、卡片仍「飞行中」）
   */
  _backfillIndexCompletedStatus() {
    const mission = this.data.mission
    if (!mission || !mission.id) return
    const sid = mission.statusId != null ? Number(mission.statusId) : 0
    // 与 utils/api-request TERMINAL_STATUS_IDS 一致：3/4/7/9
    if (!(sid === 3 || sid === 4 || sid === 7 || sid === 9)) return
    try {
      const pages = getCurrentPages()
      for (let i = pages.length - 1; i >= 0; i--) {
        const p = pages[i]
        if (!p || !p.route) continue
        if (String(p.route).indexOf('pages/index/index') === -1) continue
        const applyObservation = typeof p.applyLaunchObservationFromDetail === 'function'
          ? p.applyLaunchObservationFromDetail
          : p.applyCompletedMissionStatusFromDetail
        if (typeof applyObservation === 'function') {
          applyObservation.call(p, {
            id: mission.id,
            statusId: sid,
            statusBadgeText: mission.statusBadgeText || '',
            statusCategory: mission.statusCategory || '',
            statusAbbrev: mission.statusAbbrev || '',
            name: mission.name || '',
            net: mission.launchTime || mission.net || '',
            observedAtMs: Date.now()
          })
        }
        break
      }
    } catch (e) {}
  },

  /**
   * 确保分享图片可用于 iOS 朋友圈分享
   * 将网络图片（https:// 或 cloud://）下载到本地临时路径，彻底规避 URL 编码兼容问题
   */
  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    // 已经是本地临时路径（wxfile:// 或 http://tmp），无需处理
    if (imageUrl.startsWith('wxfile://') || /^http:\/\/tmp/.test(imageUrl)) return

    var self = this
    wx.getImageInfo({
      src: imageUrl,
      success: function (res) {
        if (res.path && self.data.shareImage === imageUrl) {
          self.setData({ shareImage: res.path })
        }
      }
    })
  },

  normalizeBoosterInfo(boosterInfo, detailSource = {}) {
    if (!boosterInfo || typeof boosterInfo !== 'object') return boosterInfo

    const normalized = { ...boosterInfo }
    const textPool = [
      normalized.landingDescription || '',
      (detailSource.missionFull && detailSource.missionFull.description) || detailSource.missionDetails || detailSource.description || '',
      detailSource.missionName || detailSource.name || ''
    ].join(' ')

    const serialText = normalized.serialNumber == null ? '' : String(normalized.serialNumber).trim()
    if (!serialText || /^\d+$/.test(serialText)) {
      const serialMatch = textPool.match(/\bB\d{3,5}\b/i)
      normalized.serialNumber = serialMatch ? serialMatch[0].toUpperCase() : null
    }

    const pickValidFlightCount = (val) => {
      const n = Number(val)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    }

    if (normalized.flights == null) {
      const candidates = [
        normalized.flight,
        normalized.flightCount,
        normalized.flight_count,
        normalized.reuseCount,
        normalized.reuse_count,
        detailSource.flight,
        detailSource.flights,
        detailSource.flightCount,
        detailSource.flight_count,
        detailSource.reuseCount,
        detailSource.reuse_count,
        detailSource.launcherLanding && detailSource.launcherLanding.general && detailSource.launcherLanding.general.flights
      ]
      for (const candidate of candidates) {
        const count = pickValidFlightCount(candidate)
        if (count) {
          normalized.flights = count
          break
        }
      }
    }

    if (normalized.flights == null) {
      const flightMatchEn = textPool.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+flight\b/i)
      const flightMatchCn = textPool.match(/第\s*(\d{1,3})\s*次飞行/)
      const flightMatch = flightMatchEn || flightMatchCn
      if (flightMatch) {
        const count = Number(flightMatch[1])
        if (!isNaN(count) && count > 0) normalized.flights = Math.floor(count)
      }
    }

    return normalized
  },

  inferLaunchSiteKey(mission) {
    const text = [mission.launchSite, mission.padLocation, mission.missionName, mission.rocketName].filter(Boolean).join(' ').toLowerCase()
    // SpaceX
    if (/starbase|boca chica|texas|德州/.test(text)) return 'starbase'
    if (/39a|kennedy|肯尼迪/.test(text)) return 'lc-39a'
    if (/slc-40|cape canaveral|卡纳维拉尔/.test(text)) return 'slc-40'
    if (/slc-4e|vandenberg|范登堡/.test(text)) return 'slc-4e'
    if (/omelek|kwajalein|falcon 1/.test(text)) return 'oca'
    // 中国
    if (/wenchang|文昌/.test(text)) return 'wenchang'
    if (/jiuquan|酒泉/.test(text)) return 'jiuquan'
    if (/xichang|西昌/.test(text)) return 'xichang'
    if (/taiyuan|太原/.test(text)) return 'taiyuan'
    // 俄罗斯
    if (/baikonur|拜科努尔|байконур/.test(text)) return 'baikonur'
    if (/vostochny|东方航天发射场|восточный/.test(text)) return 'vostochny'
    if (/plesetsk|普列谢茨克|плесецк/.test(text)) return 'plesetsk'
    // 欧洲
    if (/kourou|guiana|库鲁|圭亚那/.test(text)) return 'kourou'
    // 印度
    if (/sriharikota|satish dhawan|shar/.test(text)) return 'sriharikota'
    // 日本
    if (/tanegashima|种子岛/.test(text)) return 'tanegashima'
    // 韩国
    if (/naro|罗老|goheung/.test(text)) return 'naro'
    // 伊朗
    if (/semnan|塞姆南/.test(text)) return 'semnan'
    // 美国其他
    if (/wallops|mid-atlantic|mars|沃洛普斯/.test(text)) return 'wallops'
    // 新西兰 Rocket Lab
    if (/mahia|rocket lab lc-?1/.test(text)) return 'mahia'
    return ''
  },

  buildStarbaseFacilityQuery(mission) {
    const text = [mission.missionName, mission.name, mission.rocketName, mission.padLocation, mission.launchSite].filter(Boolean).join(' ').toLowerCase()
    let focusId = 1
    if (/test|点火|raptor|engine/.test(text)) {
      focusId = 5
    } else if (/build|factory|ship|booster|starfactory|megabay|组装|总装/.test(text)) {
      focusId = 3
    }
    return `focusId=${focusId}`
  },

  async buildRoadClosureQuery() {
    if (this._roadClosureQueryCache && (Date.now() - this._roadClosureQueryCache.loadedAt < ROAD_CLOSURE_QUERY_TTL)) {
      return this._roadClosureQueryCache.query || ''
    }

    if (this._roadClosureQueryPromise) {
      return this._roadClosureQueryPromise
    }

    let requestPromise = null
    requestPromise = (async () => {
      try {
        const notice = await getRoadClosureNotice()
        const query = []
        if (notice && notice.message) query.push(`message=${encodeURIComponent(notice.message)}`)
        if (notice && notice.timeRange) query.push(`timeRange=${encodeURIComponent(notice.timeRange)}`)
        const result = query.join('&')
        this._roadClosureQueryCache = {
          query: result,
          loadedAt: Date.now()
        }
        return result
      } catch (e) {
        return ''
      } finally {
        if (this._roadClosureQueryPromise === requestPromise) {
          this._roadClosureQueryPromise = null
        }
      }
    })()

    this._roadClosureQueryPromise = requestPromise
    return requestPromise
  },

  async getMissionMapLinkMeta(mission) {
    const siteKey = this.inferLaunchSiteKey(mission)
    const siteMeta = CALENDAR_SITE_META[siteKey]
    const entries = []
    if (siteMeta && siteMeta.launchSiteId) {
      entries.push({
        key: 'launch-site',
        label: '发射场地图',
        path: '/subpackages/monitor-pages/launch-site-map',
        query: `focusId=${siteMeta.launchSiteId}`
      })
    }

    if (siteKey === 'starbase') {
      entries.push({
        key: 'starbase',
        label: 'Starbase 设施图',
        path: '/subpackages/progress-extra/starbase-map',
        query: this.buildStarbaseFacilityQuery(mission)
      })
      entries.push({
        key: 'road-closure',
        label: '封路地图',
        path: '/subpackages/progress-extra/road-closure-map',
        query: await this.buildRoadClosureQuery()
      })
    }

    return {
      siteKey,
      siteLabel: siteMeta ? siteMeta.label : '',
      entries
    }
  },

  formatToCST(isoTime) {
    if (!isoTime) return '时间未知'
    try {
      const date = new Date(isoTime)
      if (Number.isNaN(date.getTime())) return '时间未知'
      // 真正按 UTC+8 计算（先平移 8 小时再取 UTC 各字段），保证无论设备时区如何，
      // 显示的都是真正的北京时间 + "CST"，不再把海外本地时间错标成 CST
      const cst = new Date(date.getTime() + 8 * 3600 * 1000)
      const year = cst.getUTCFullYear()
      const month = String(cst.getUTCMonth() + 1).padStart(2, '0')
      const day = String(cst.getUTCDate()).padStart(2, '0')
      const hours = String(cst.getUTCHours()).padStart(2, '0')
      const minutes = String(cst.getUTCMinutes()).padStart(2, '0')
      return `${year}年${month}月${day}日 ${hours}:${minutes} CST`
    } catch (e) {
      return '时间未知'
    }
  },

  /** 与 formatToCST 同口径（UTC+8 北京时间），仅输出 HH:mm（用于发射时间表） */
  formatTimeHM(isoTime) {
    if (!isoTime) return ''
    try {
      const date = new Date(isoTime)
      if (Number.isNaN(date.getTime())) return ''
      const cst = new Date(date.getTime() + 8 * 3600 * 1000)
      const hours = String(cst.getUTCHours()).padStart(2, '0')
      const minutes = String(cst.getUTCMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    } catch (e) {
      return ''
    }
  },

  buildLaunchTimelinePatch(mission, options = {}) {
    const w = mission && mission.windowStart
    const l = mission && mission.launchTime
    const e = mission && mission.windowEnd
    const windowStart = this.formatTimeHM(w)
    const liftoff = this.formatTimeHM(l)
    const windowEnd = this.formatTimeHM(e)
    const launchTimelineVisible = !!(windowStart || liftoff || windowEnd)
    const progress = computeLaunchTimelineProgress(mission, options)
    return {
      launchTimelineVisible,
      launchTimeline: {
        windowStart: windowStart || '--',
        liftoff: liftoff || '--',
        windowEnd: windowEnd || '--',
        ...progress
      }
    }
  },

  refreshLaunchTimelineProgress(options = {}) {
    const mission = this.data.mission
    if (!mission || !mission.launchTimelineVisible) return
    const isCompleted = options.isCompleted != null
      ? options.isCompleted
      : (this.data.detailType === 'completed' || !!(mission.launchTime && getCountdown(mission.launchTime).isExpired))
    const patch = this.buildLaunchTimelinePatch(mission, {
      now: options.now != null ? options.now : Date.now(),
      isCompleted
    })
    const prev = mission.launchTimeline || {}
    const next = patch.launchTimeline
    if (
      prev.progressPercent === next.progressPercent
      && prev.activeStep === next.activeStep
      && prev.startState === next.startState
      && prev.liftoffState === next.liftoffState
      && prev.endState === next.endState
      && prev.statusText === next.statusText
      && prev.inWindow === next.inWindow
    ) {
      return
    }
    this.setData({
      'mission.launchTimeline': next
    })
  },

  getMissionDetailFallback(mission) {
    const missionDetails = mission.missionDetails || ''
    return {
      id: mission.id,
      name: mission.name || '',
      missionName: mission.missionName || '未知任务',
      discussionTopic: buildDiscussionTopic(mission),
      launchTime: mission.launchTime || '',
      windowStart: mission.windowStart || '',
      windowEnd: mission.windowEnd || '',
      launchTimeCST: this.formatToCST(mission.launchTime),
      windowStartCST: mission.windowStart ? this.formatToCST(mission.windowStart) : '',
      windowEndCST: mission.windowEnd ? this.formatToCST(mission.windowEnd) : '',
      description: mission.description || '',
      missionDetails,
      rocketInfo: mission.rocketInfo || '',
      launchAgency: mission.launchAgency || '',
      launchAgencyId: mission.launchAgencyId != null ? mission.launchAgencyId : null,
      launchAgencyAbbrev: mission.launchAgencyAbbrev || '',
      agencyLaunchAttemptCount: mission.agencyLaunchAttemptCount != null ? mission.agencyLaunchAttemptCount : null,
      agencyLaunchAttemptCountYear: mission.agencyLaunchAttemptCountYear != null ? mission.agencyLaunchAttemptCountYear : null,
      launchSite: mission.launchSite || '',
      padLocation: mission.padLocation || '',
      rocketName: mission.rocketName || '未知火箭',
      rocketImage: resolveMissionRocketImage(
        '',
        mission.rocketName,
        mission.rocketConfiguration,
        true
      ),
      rocketConfiguration: mission.rocketConfiguration || null,
      status: mission.status || '未知状态',
      statusId: mission.statusId != null ? mission.statusId : null,
      statusAbbrev: mission.statusAbbrev || '',
      statusCategory: mission.statusCategory || 'pending',
      statusBadgeText: mission.statusBadgeText || '计划中',
      probability: mission.probability,
      boosterInfo: this.normalizeBoosterInfo(mission.boosterInfo || null, mission),
      launchServiceProvider: {
        id: mission.launchAgencyId != null ? mission.launchAgencyId : null,
        name: mission.launchAgency || '',
        abbrev: mission.launchAgencyAbbrev || '',
        country: mission.countryDisplay || '',
        website: null
      },
      missionFull: (() => {
        const mf = mission.missionFull && typeof mission.missionFull === 'object' ? mission.missionFull : {}
        const desc = (mf.description && String(mf.description).trim()) ? mf.description : missionDetails
        return {
          name: mf.name || mission.missionName || '',
          description: desc,
          type: mf.type != null ? String(mf.type) : '',
          orbit: mf.orbit != null ? String(mf.orbit) : ''
        }
      })(),
      rocketFull: { configuration: mission.rocketName || '', description: mission.rocketInfo || '', manufacturer: '' },
      padDetail: {
        padName: (mission.padDetail && mission.padDetail.padName) || mission.padLocation || '',
        locationName: (mission.padDetail && mission.padDetail.locationName) || mission.launchSite || '',
        country: (mission.padDetail && mission.padDetail.country) || mission.countryDisplay || '',
        state: (mission.padDetail && mission.padDetail.state) || null,
        city: (mission.padDetail && mission.padDetail.city) || null,
        latitude: (mission.padDetail && mission.padDetail.latitude != null) ? mission.padDetail.latitude : null,
        longitude: (mission.padDetail && mission.padDetail.longitude != null) ? mission.padDetail.longitude : null,
        padType: (mission.padDetail && mission.padDetail.padType) || '陆上',
        totalLaunchCount: (mission.padDetail && mission.padDetail.totalLaunchCount != null) ? mission.padDetail.totalLaunchCount : null,
        turnaroundText: (mission.padDetail && mission.padDetail.turnaroundText) || '',
        padDescription: (mission.padDetail && mission.padDetail.padDescription) || '',
        locationDescription: (mission.padDetail && mission.padDetail.locationDescription) || '',
        wikiUrl: (mission.padDetail && mission.padDetail.wikiUrl) || '',
        mapUrl: (mission.padDetail && mission.padDetail.mapUrl) || '',
        timezoneName: (mission.padDetail && mission.padDetail.timezoneName) || ''
      },
      launcherLanding: (mission.launcherLanding && typeof mission.launcherLanding === 'object')
        ? mission.launcherLanding
        : { flightStats: {}, landingStats: {}, general: { flights: mission.boosterInfo ? mission.boosterInfo.flights : null, totalFlightDuration: null, orbitAccuracy: null, payloadWeight: null } },
      missionDescLong: missionDetails.length > 100,
      rocketDescLong: !!((mission.rocketInfo || '').length > 100),
      payloadDetails: Array.isArray(mission.payloadDetails) ? mission.payloadDetails : [],
      payloadAmount: mission.payloadAmount != null ? mission.payloadAmount : null,
      // ---- 瞬时呈现关键字段：直接透传缓存里已经构造好的数据 ----
      // 之前这里硬编码成空（boosterStages 根本没返回、stageInfo 全 null），
      // 导致每次打开详情页 "助推器/回收" 和 "一二级箭体" 两张卡片都要等 3~10s
      // 网络请求回来才显示。其实缓存里本来就有完整数据，透传即可瞬间呈现。
      // 新鲜度由 MISSION_DETAIL_CACHE_TTL 决定：过期数据不会进到这里（外层已校验）。
      boosterStages: Array.isArray(mission.boosterStages) ? mission.boosterStages : [],
      launcherBlockTitle: mission.launcherBlockTitle || '箭体与回收',
      stageInfo: (mission.stageInfo && typeof mission.stageInfo === 'object')
        ? mission.stageInfo
        : { firstStage: null, secondStage: null, bothReusable: false },
      stageInfoExtra: computeStageInfoExtra(mission.stageInfo, mission.boosterStages),
      // 其它常用的派生字段也一并透传，避免回退时页面出现 "一会儿有一会儿无" 的闪烁
      rocketConfig: mission.rocketConfig || null,
      rocketFamilyLabel: mission.rocketFamilyLabel || '',
      mapLinkMeta: mission.mapLinkMeta || null,
      countryDisplay: mission.countryDisplay || '',
      orbitalDestination: mission.orbitalDestination || '',
      isRecoverableThisMission: !!mission.isRecoverableThisMission,
      rocketSpecs: Array.isArray(mission.rocketSpecs) ? mission.rocketSpecs : [],
      rocketSpecsVisible: !!mission.rocketSpecsVisible,
      missionPatches: Array.isArray(mission.missionPatches) ? mission.missionPatches : [],
      launchUpdates: Array.isArray(mission.launchUpdates) ? mission.launchUpdates : [],
      failReason: mission.failReason || '',
      weatherConcerns: mission.weatherConcerns || '',
      netPrecisionLabel: mission.netPrecisionLabel || '',
      statusDescription: mission.statusDescription || '',
      hashtag: mission.hashtag || '',
      infographicUrl: mission.infographicUrl || '',
      programInfo: Array.isArray(mission.programInfo) ? mission.programInfo : [],
      launchSequenceRows: Array.isArray(mission.launchSequenceRows) ? mission.launchSequenceRows : [],
      relatedLinks: Array.isArray(mission.relatedLinks) ? mission.relatedLinks : [],
      vidUrls: Array.isArray(mission.vidUrls) ? mission.vidUrls : [],
      ...this.buildLaunchTimelinePatch(mission)
    }
  },

  async findMissionInList(id, detailType) {
    const type = detailType === 'completed' ? 'completed' : 'upcoming'

    // 列表页刚点进来时经 eventChannel 传入的快照天然新鲜，最优先复用；
    // 一次性消费（与 event-detail 对齐）：后续刷新走 storage 快照（10 分钟 TTL）/网络，
    // 避免整个页面存续期都把点击时刻的旧快照当作时间权威源
    const openerSnapshot = this._openerMissionSnapshot
    if (openerSnapshot && String(openerSnapshot.id) === String(id)) {
      this._openerMissionSnapshot = null
      return openerSnapshot
    }

    try {
      const cache = storageCache.readMemOrSync('mission_detail_cache', {}) || {}
      const cachedMission = getMissionDetailCacheEntry(cache, id, type)
      if (shouldReuseMissionListSnapshot({ mission: cachedMission, ttlMs: MISSION_DETAIL_CACHE_TTL })) {
        return cachedMission
      }
    } catch (e) {}

    const fetcher = type === 'completed' ? getCompletedMissions : getUpcomingMissions
    const res = await fetcher(50, 0)
    const list = (res && res.list) || []
    const mission = list.find((item) => String(item.id) === String(id))
    return mission || null
  },

  mergeMissionDetailData(detailMission, listMission) {
    const base = listMission && typeof listMission === 'object' ? { ...listMission } : {}
    const detail = detailMission && typeof detailMission === 'object' ? { ...detailMission } : {}
    const merged = { ...base, ...detail }
    if (detail.padDetail && base.padDetail && typeof detail.padDetail === 'object' && typeof base.padDetail === 'object') {
      merged.padDetail = { ...base.padDetail, ...detail.padDetail }
    }

    // 与首页倒计时/卡片同源：按火箭名强制重算，不沿用可能过期的 default 盖章
    merged.rocketImage = resolveMissionRocketImage(
      '',
      merged.rocketName || base.rocketName || detail.rocketName || '',
      merged.rocketConfiguration || detail.rocketConfiguration || base.rocketConfiguration || null,
      true
    )
    merged.statusCategory = detail.statusCategory || base.statusCategory || 'pending'
    merged.statusBadgeText = detail.statusBadgeText || base.statusBadgeText || '计划中'
    merged.missionName = detail.missionName || base.missionName || detail.name || base.name || '未知任务'
    merged.launchAgency = detail.launchAgency || base.launchAgency || ''
    merged.launchAgencyId = detail.launchAgencyId != null ? detail.launchAgencyId : (base.launchAgencyId != null ? base.launchAgencyId : null)
    merged.launchAgencyAbbrev = detail.launchAgencyAbbrev || base.launchAgencyAbbrev || ''
    merged.agencyLaunchAttemptCount = detail.agencyLaunchAttemptCount != null
      ? detail.agencyLaunchAttemptCount
      : (base.agencyLaunchAttemptCount != null ? base.agencyLaunchAttemptCount : null)
    merged.agencyLaunchAttemptCountYear = detail.agencyLaunchAttemptCountYear != null
      ? detail.agencyLaunchAttemptCountYear
      : (base.agencyLaunchAttemptCountYear != null ? base.agencyLaunchAttemptCountYear : null)
    merged.launchSite = detail.launchSite || base.launchSite || ''
    merged.padLocation = detail.padLocation || base.padLocation || ''
    merged.probability = detail.probability != null ? detail.probability : base.probability
    merged.isRecoverableThisMission = detail.isRecoverableThisMission != null ? detail.isRecoverableThisMission : !!base.isRecoverableThisMission

    const detailSeq = detail.launchSequenceRows && Array.isArray(detail.launchSequenceRows) ? detail.launchSequenceRows : []
    const baseSeq = base.launchSequenceRows && Array.isArray(base.launchSequenceRows) ? base.launchSequenceRows : []
    merged.launchSequenceRows = detailSeq.length > 0 ? detailSeq : baseSeq

    const baseMF = base.missionFull && typeof base.missionFull === 'object' ? base.missionFull : {}
    const detailMF = detail.missionFull && typeof detail.missionFull === 'object' ? detail.missionFull : {}
    merged.missionFull = { name: '', description: '', type: '', orbit: '', ...baseMF, ...detailMF }

    const detailSpecs = detail.rocketSpecs && Array.isArray(detail.rocketSpecs) ? detail.rocketSpecs : []
    const baseSpecs = base.rocketSpecs && Array.isArray(base.rocketSpecs) ? base.rocketSpecs : []
    if (detailSpecs.length > 0) {
      merged.rocketSpecs = detailSpecs
      merged.rocketSpecsVisible = !!detail.rocketSpecsVisible
    } else if (baseSpecs.length > 0) {
      merged.rocketSpecs = baseSpecs
      merged.rocketSpecsVisible = !!base.rocketSpecsVisible
    } else {
      merged.rocketSpecs = []
      merged.rocketSpecsVisible = false
    }

    // 时间字段以列表（base，即 listMission/list snapshot）为准：
    // 列表 getUpcomingMissions 拉取频率高，权威性更高；detail 走的是云函数 fetchLaunchDetail
    // 单条缓存，TTL 较长，时常陈旧，会出现"卡片 5/21 / 详情 5/20"这类差一天问题。
    if (base.launchTime) {
      merged.launchTime = base.launchTime
    }
    if (base.windowStart) {
      merged.windowStart = base.windowStart
    }
    if (base.windowEnd) {
      merged.windowEnd = base.windowEnd
    }
    // 旧 detail 上派生过的本地化字符串必须丢弃，否则 buildNormalizedMissionState
    // 里 `mission.launchTimeCST || formatToCST(...)` 这类短路会沿用旧值。
    if (base.launchTime || base.windowStart || base.windowEnd) {
      delete merged.launchTimeCST
      delete merged.windowStartCST
      delete merged.windowEndCST
      delete merged.launchTimeline
      delete merged.launchTimelineVisible
    }

    // 助推器分卡：列表快照多为 mode=list，不含周转等字段；详情 fetch 后必须用详情里的 boosterStages，
    // 否则云响应若省略 null 键，`{ ...list, ...detail }` 会残留列表侧残缺数组，周转时间永远不显示。
    if (Object.prototype.hasOwnProperty.call(detail, 'boosterStages')) {
      merged.boosterStages = detail.boosterStages
    }
    if (detail.launcherBlockTitle) {
      merged.launcherBlockTitle = detail.launcherBlockTitle
    }

    return merged
  },

  async buildNormalizedMissionState(mission, options = {}) {
    const safeOptions = options || {}
    const listMission = safeOptions.listMission || null
    const preferredDetailType = safeOptions.detailType === 'completed' ? 'completed' : 'upcoming'

    const boosterInfo = this.normalizeBoosterInfo(mission.boosterInfo || null, mission)
    const normalizedMission = {
      ...mission,
      boosterInfo,
      discussionTopic: buildDiscussionTopic(mission),
      rocketImage: resolveMissionRocketImage(
        '',
        mission.rocketName,
        mission.rocketConfiguration,
        true
      ),
      launchTimeCST: mission.launchTimeCST || this.formatToCST(mission.launchTime),
      windowStartCST: mission.windowStartCST || (mission.windowStart ? this.formatToCST(mission.windowStart) : ''),
      windowEndCST: mission.windowEndCST || (mission.windowEnd ? this.formatToCST(mission.windowEnd) : ''),
      payloadDetails: Array.isArray(mission.payloadDetails) ? mission.payloadDetails.map((item, index) => ({ ...item, _wxkey: item._wxkey || `payload-${item.id || index}-${index}` })) : [],
      missionDescLong: !!((mission.missionFull && mission.missionFull.description && mission.missionFull.description.length > 100) || (mission.missionDetails && mission.missionDetails.length > 100) || (mission.description && mission.description.length > 100)),
      rocketDescLong: !!((mission.rocketFull && mission.rocketFull.description && mission.rocketFull.description.length > 100) || (mission.rocketInfo && mission.rocketInfo.length > 100)),
      stageInfoExtra: computeStageInfoExtra(mission.stageInfo, mission.boosterStages)
    }

    const inferredUpcoming = !!(normalizedMission.launchTime && !getCountdown(normalizedMission.launchTime).isExpired)
    const effectiveDetailType = inferredUpcoming ? 'upcoming' : preferredDetailType
    Object.assign(normalizedMission, this.buildLaunchTimelinePatch(normalizedMission, {
      isCompleted: effectiveDetailType === 'completed'
    }))

    if (listMission && listMission.rocketImage && !isDefaultRocketSrc(listMission.rocketImage)) {
      if (isDefaultRocketSrc(normalizedMission.rocketImage)) {
        normalizedMission.rocketImage = listMission.rocketImage
      }
    }

    normalizedMission.mapLinkMeta = await this.getMissionMapLinkMeta(normalizedMission)
    const seoMeta = buildMissionSeoMeta(normalizedMission, effectiveDetailType)

    return {
      mission: normalizedMission,
      effectiveDetailType,
      inferredUpcoming,
      seoMeta,
      pageState: {
        mission: normalizedMission,
        detailType: effectiveDetailType,
        navTitle: seoMeta.navTitle,
        pageTitle: seoMeta.pageTitle,
        shareTitle: seoMeta.shareTitle,
        shareImage: normalizedMission.rocketImage || resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
        missionSubscribed: isSubscribed(normalizedMission.id),
        detailExpanded: buildDefaultDetailExpanded(),
        detailBlocks: buildDefaultDetailBlocks(),
        ...this.buildMapPreviewData(normalizedMission)
      }
    }
  },

  persistMissionDetailCache(id, mission, options = {}) {
    const safeOptions = options || {}
    const primaryDetailType = safeOptions.primaryDetailType === 'completed' ? 'completed' : 'upcoming'
    const secondaryDetailType = safeOptions.secondaryDetailType === 'completed' ? 'completed' : 'upcoming'
    const source = safeOptions.source || 'detail'

    try {
      let cache = storageCache.readMemOrSync('mission_detail_cache', {}) || {}
      cache = setMissionDetailCacheEntry(cache, id, primaryDetailType, mission, { source })
      if (secondaryDetailType !== primaryDetailType) {
        cache = setMissionDetailCacheEntry(cache, id, secondaryDetailType, mission, { source })
      }
      // 内存层立即生效，磁盘写异步，避免详情大对象同步序列化阻塞
      storageCache.persistAsync('mission_detail_cache', cache)
    } catch (e) {}
  },

  applyMissionPageSearchInfo(mission, detailType, shareImage) {
    const searchMeta = buildMissionDetailSearchMeta(mission, detailType, shareImage)
    if (searchMeta) applyPageSearchInfo(searchMeta)
  },

  syncMissionRuntimeState(normalizedState) {
    if (!normalizedState || !normalizedState.mission) return
    this.refreshLaunchTimelineProgress({
      isCompleted: !normalizedState.inferredUpcoming || normalizedState.effectiveDetailType === 'completed'
    })
    if (normalizedState.inferredUpcoming) {
      this.startMissionCountdown(normalizedState.mission.launchTime)
      this.loadVoteData(normalizedState.mission.id, true)
    } else {
      this.clearMissionCountdownTimer()
    }
    // 统计/飞行时间线数据延迟到对应页签首次切入才拉取（onDetailTabTap 触发）；
    // 用户已访问过页签时（如后台刷新回来）立即刷新
    if (this.data.visitedTabs.stats) {
      this.loadMissionLaunchStatsForMission(normalizedState.mission)
      this.patchMissionLaunchStatsFromAgency(normalizedState.mission)
    }
    if (this.data.visitedTabs.timeline) {
      this.loadLl2FlightTimelineForMission(normalizedState.mission && normalizedState.mission.id)
    }
    if (normalizedState.inferredUpcoming) {
      this.ensureLiveEntryAllowed().then((on) => {
        if (!on) return
        this.loadChannelsLiveInfo()
        this.loadChannelsFallbackGuide()
      })
    } else {
      this.loadMissionReplaySection(normalizedState.mission)
    }
  },

  /**
   * 发射后「观看回放」卡片：过审开关（enableMissionReplay，failClosed）+ 数据加载。
   * 云端 mission_replays 提供集锦（压缩版 COS 视频，会员观看）与完整回放外链；
   * 云端文档未就绪时外链回退到 LL2 vidUrls。
   */
  loadMissionReplaySection(mission) {
    if (!mission || !mission.id) return
    const isCompletedView = this.data.detailType === 'completed' ||
      !!(mission.launchTime && getCountdown(mission.launchTime).isExpired)
    if (!isCompletedView) return
    const launchId = String(mission.id)
    // 去重 key 带 vidUrls 数量：instant 缓存可能没有 vidUrls，详情返回后补建外链条目
    const dedupeKey = launchId + ':' + (Array.isArray(mission.vidUrls) ? mission.vidUrls.length : 0)
    if (this._replayLoadedKey === dedupeKey) return
    this._replayLoadedKey = dedupeKey
    this._replayLoadedLaunchId = launchId

    // 开关检查与数据请求并行发起（原来串行等开关再发请求，白等一次网络往返）
    const flagPromise = isFeatureEnabled('enableMissionReplay', { failClosed: true }).catch(() => false)
    const fetchPromise = wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'missionReplay', launchId }
    }).then((res) => {
      const r = res && res.result
      return (r && r.success && r.data) ? r.data : null
    }).catch(() => null)

    const showBase = () => {
      this.setData({
        enableReplayEntry: true,
        replayLinks: buildReplayLinks(mission.vidUrls)
      })
      const cached = this._readReplayCache(launchId)
      if (cached) this._applyReplayData(launchId, cached)
    }

    // 必须等开关确认后再上屏：内存缓存可能落后于「一键过审」刚写入的关闭态，
    // 提前渲染会出现回放区先闪现再被收回（flagPromise 命中 feature-flags 缓存时本身就是同步级返回）
    flagPromise.then((on) => {
      if (String(this.data.mission && this.data.mission.id) !== launchId) return
      if (!on) {
        // 审核模式下开关可能刚被关掉：把提前上屏的内容收回去
        if (this.data.enableReplayEntry) {
          this.setData({ enableReplayEntry: false, missionReplay: null, replayClips: [], replayLinks: [] })
        }
        return
      }
      if (!this.data.enableReplayEntry) showBase()
      fetchPromise.then((data) => {
        if (!data) return
        if (String(this.data.mission && this.data.mission.id) !== launchId) return
        this._writeReplayCache(launchId, data)
        this._applyReplayData(launchId, data)
      })
    })
  },

  /** mission_replays 文档 → 页面数据（集锦卡 + 外链 + 完整回放） */
  _applyReplayData(launchId, data) {
    const patch = {}

    // COS 文件在 net+30 天被生命周期回收，服务端 net+29 天停发；
    // 本地缓存可能跨过这个点，播放前按 cosExpireAt 再挡一道，防点开 404
    const cosExpireAt = Number(data.cosExpireAt) || 0
    const cosGone = cosExpireAt > 0 && Date.now() > cosExpireAt

    // 集锦短片（压缩版，会员观看）：官方推文集锦 + 指定博主（SciNews）集锦。
    // 始终整体覆盖（含空数组）：云端纠正/回收后，本地不残留旧集锦
    patch.replayClips = cosGone ? [] : (Array.isArray(data.clips) ? data.clips : [])
      .filter((c) => c && c.videoUrl)
      .map((c) => {
        const dur = Number(c.durationSec) || 0
        return {
          videoUrl: c.videoUrl,
          poster: c.thumbnailUrl
            ? optimizeImageUrl(c.thumbnailUrl, 'thumb')
            : videoSnapshotUrl(c.videoUrl, 1),
          publisher: c.publisher || 'SpaceX',
          durationText: dur > 0
            ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`
            : '',
          sourceUrl: c.sourceUrl || ''
        }
      })

    // 完整回放外链：云端已按官方优先排好序，优先用云端结果；
    // 云端为空时保留 showBase 里 LL2 vidUrls 建的兜底外链，故仅在有值时覆盖
    const links = (Array.isArray(data.links) ? data.links : [])
      .filter((l) => l && l.url)
      .slice(0, 3)
      .map((l) => ({
        url: l.url,
        title: l.title || '',
        publisher: l.publisher || '',
        typeLabel: replayTypeLabel(l.type)
      }))
    if (links.length) patch.replayLinks = links

    // 完整回放 COS 转存（可选链路，Agent 产出）；无值/已过期时清掉旧按钮
    patch.missionReplay = null
    if (data.videoUrl && !cosGone) {
      const durationText = formatReplayDuration(data.durationSec)
      const publisher = data.sourcePublisher || ''
      const subParts = []
      if (publisher) subParts.push(publisher)
      if (durationText) subParts.push(durationText)
      subParts.push('会员在线观看')
      patch.missionReplay = {
        videoUrl: data.videoUrl,
        poster: videoSnapshotUrl(data.videoUrl, 30),
        subText: subParts.join(' · ')
      }
    }
    this.setData(patch)
  },

  /** 回放数据本地缓存（按 launchId，最多 12 条）：再次进入详情页集锦秒开，云端结果回来后覆盖 */
  _readReplayCache(launchId) {
    const all = storageCache.readMemOrSync('_mission_replay_cache', null)
    const hit = all && all[launchId]
    if (!hit || !hit.data) return null
    // 24h 过期兜底（正常每次进页都会后台刷新覆盖）
    if (Date.now() - (hit.at || 0) > 24 * 60 * 60 * 1000) return null
    return hit.data
  },

  _writeReplayCache(launchId, data) {
    const all = Object.assign({}, storageCache.readMemOrSync('_mission_replay_cache', null))
    all[launchId] = { data, at: Date.now() }
    const ids = Object.keys(all).sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
    while (ids.length > 12) delete all[ids.shift()]
    storageCache.persistAsync('_mission_replay_cache', all)
  },

  /**
   * 回放/集锦的分享上下文：播放页转发给朋友/朋友圈时落回本任务详情页（完成态）。
   * 路径带 sst 分享时间戳：有权益用户分享后接收者 24h 内免门控观看（限时查看倒计时），
   * 超时或无时间戳时接收方仍走本页的会员/广告门控；不直接暴露可播视频地址
   */
  _buildReplayShareInfo(kindLabel, poster) {
    const mission = this.data.mission
    if (!mission || !mission.id) return null
    const name = String(mission.missionName || mission.name || '').trim()
    const title = (name ? `${name} ${kindLabel}` : kindLabel) + ' | 火星探索日志'
    return {
      title,
      path: withShareStampPath(buildMissionDetailUrl({ id: mission.id, detailType: 'completed' }), this),
      imageUrl: poster || this.data.shareImage || ''
    }
  },

  /** 分享 sst 免门控窗口（24h）当前是否生效 */
  _replayShareGateActive() {
    return !!(this._shareSst && Date.now() - this._shareSst <= SHARE_GATE_TTL_MS)
  },

  /** 门控通过后进全站播放页播视频（回放/集锦共用） */
  _playReplayVideo(videoUrl, poster, shareInfo) {
    try {
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.pendingEventVideo = {
          url: videoUrl,
          poster: poster || '',
          showmenu: false,
          remoteUrl: videoUrl,
          originalUrl: '',
          sourceUrl: '',
          share: shareInfo || null
        }
      }
    } catch (e) {}
    wx.navigateTo({
      url: ROUTES.VIDEO_PLAYER,
      fail() {
        // 跳转失败时清掉暂存数据，避免被下一次进播放页的其他视频误用
        try {
          const app = getApp()
          if (app && app.globalData) app.globalData.pendingEventVideo = null
        } catch (e) {}
        wx.previewMedia({
          sources: [{ url: videoUrl, type: 'video', poster: poster || '' }],
          current: 0,
          showmenu: false
        })
      }
    })
  },

  /** 点击 COS 转存完整回放：会员/看广告门控通过后播放；分享 sst 窗口内免门控 */
  async onTapMissionReplay() {
    const replay = this.data.missionReplay
    if (!replay || !replay.videoUrl) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}

    if (!this._replayShareGateActive()) {
      const { gateCheck } = require('../../utils/membership.js')
      const allowed = await gateCheck('mission_replay', '发射回放')
      if (!allowed) return
    }
    this._playReplayVideo(replay.videoUrl, replay.poster, this._buildReplayShareInfo('发射回放', replay.poster))
  },

  /** 点击发射集锦短片：同一门控，通过后播放压缩版；分享 sst 窗口内免门控 */
  async onTapReplayClip(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset.index)
    const clip = (this.data.replayClips || [])[idx]
    if (!clip || !clip.videoUrl) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e2) {}

    if (!this._replayShareGateActive()) {
      const { gateCheck } = require('../../utils/membership.js')
      const allowed = await gateCheck('mission_replay', '发射回放')
      if (!allowed) return
    }
    this._playReplayVideo(clip.videoUrl, clip.poster, this._buildReplayShareInfo('发射集锦', clip.poster))
  },

  /** 过审/全局开关：任务详情直播入口 */
  ensureLiveEntryAllowed() {
    return isLiveEntryAllowed()
      .catch(() => false)
      .then((on) => {
        if (this.data.enableLiveEntry !== on) {
          this.setData({
            enableLiveEntry: on,
            showChannelLiveTap: on ? this.data.showChannelLiveTap : false
          })
        }
        return on
      })
  },

  loadChannelsFallbackGuide(forceRefresh) {
    const { getChannelsLiveFallbackGuide } = require('../../utils/channels-live-fallback-cache.js')
    const apply = (guide) => {
      if (!guide || typeof guide !== 'object') return
      const prev = this.data.channelsFallbackGuide || {}
      if (
        prev.enabled === guide.enabled &&
        prev.title === guide.title &&
        prev.nickname === guide.nickname &&
        prev.qrUrl === guide.qrUrl &&
        prev.qrDisplayUrl === guide.qrDisplayUrl &&
        prev.tip === guide.tip &&
        String(prev.updatedAt || '') === String(guide.updatedAt || '')
      ) return
      this.setData({ channelsFallbackGuide: guide })
    }
    return getChannelsLiveFallbackGuide({
      // 仅显式传 true 才强刷（打开二维码弹窗），默认走本地缓存 + TTL
      forceRefresh: forceRefresh === true,
      onUpdate: (fresh) => apply(fresh)
    })
      .then((guide) => apply(guide))
      .catch((err) => {
        console.warn('[mission-detail] loadChannelsFallbackGuide failed:', err && err.message ? err.message : err)
      })
  },

  loadChannelsLiveInfo() {
    return loadChannelsLiveModule()
      .then((live) => {
        const sdkSupported = live.isChannelLiveSupported()
        return live.fetchChannelsLiveInfo().then((payload) => ({ live, sdkSupported, payload }))
      })
      .then(({ live, sdkSupported, payload }) => {
        const status = payload.status || 0
        const feedId = payload.feedId || ''
        this.setData({
          channelsLiveStatus: status,
          channelsLiveFeedId: feedId,
          showChannelLiveTap: live.shouldUseChannelLiveForTap(status, feedId, sdkSupported)
        })
      })
      .catch(() => {})
  },

  ensureChannelsLiveInfo() {
    if (this._channelsLiveInfoPromise) return this._channelsLiveInfoPromise
    this._channelsLiveInfoPromise = this.loadChannelsLiveInfo().finally(() => {
      this._channelsLiveInfoPromise = null
    })
    return this._channelsLiveInfoPromise
  },

  resetMissionLaunchStatsState() {
    this.setData({
      missionLaunchStatsLoading: false,
      missionLaunchStatsError: '',
      missionLaunchStats: null
    })
  },

  /** 详情/徽章已就绪但统计卡仍缺 providerTotal 时，用 attempt 就地补齐（不重打云） */
  patchMissionLaunchStatsFromAgency(mission) {
    const m = mission || this.data.mission
    const stats = this.data.missionLaunchStats
    if (!stats || !m) return false
    const filled = applyClientAgencyFallback(stats, m)
    if (filled.providerTotal === stats.providerTotal && filled.providerYear === stats.providerYear) {
      return false
    }
    this.setData({ missionLaunchStats: filled })
    return true
  },

  async loadMissionLaunchStatsForMission(mission, options = {}) {
    const m = mission || this.data.mission
    const launchId = String((m && m.id) || '').trim()
    if (!launchId) {
      this._statsInflightLaunchId = null
      this.resetMissionLaunchStatsState()
      return
    }

    // page 级去重：同一 launchId 已成功加载或正在加载中则跳过（onRetry 走 forceRefresh 绕过）。
    // 若已加载但累计仍空，用当前 mission（可能刚补上序号徽章）就地回填，避免一直显示 —
    const force = !!(options && options.forceRefresh)
    if (!force && this._statsLoadedLaunchId === launchId) {
      this.patchMissionLaunchStatsFromAgency(m)
      return
    }
    if (!force && this._statsInflightLaunchId === launchId) {
      // 加载中：等返回后再用最新 mission 补一次
      this._statsPatchAfterInflight = true
      return
    }
    this._statsInflightLaunchId = launchId
    this._statsPatchAfterInflight = false

    this.setData({
      missionLaunchStatsLoading: true,
      missionLaunchStatsError: '',
      missionLaunchStats: null
    })

    try {
      const stats = await loadMissionLaunchStats(m, { forceRefresh: force })
      if (String(this.data.mission && this.data.mission.id) !== launchId) return
      // 异步返回时优先用页面上最新 mission（详情可能已补上 attempt / 序号行）
      const filled = applyClientAgencyFallback(stats, this.data.mission || m)
      this.setData({
        missionLaunchStatsLoading: false,
        missionLaunchStatsError: '',
        missionLaunchStats: filled
      })
      this._statsLoadedLaunchId = launchId
      if (this._statsPatchAfterInflight) {
        this._statsPatchAfterInflight = false
        this.patchMissionLaunchStatsFromAgency(this.data.mission)
      }
    } catch (e) {
      const msg = formatCloudError(e)
      if (String(this.data.mission && this.data.mission.id) !== launchId) return
      this.setData({
        missionLaunchStatsLoading: false,
        missionLaunchStatsError: msg,
        missionLaunchStats: null
      })
    } finally {
      if (this._statsInflightLaunchId === launchId) this._statsInflightLaunchId = null
    }
  },

  onRetryMissionLaunchStats() {
    this._statsLoadedLaunchId = null
    this.loadMissionLaunchStatsForMission(this.data.mission, { forceRefresh: true })
  },

  /** 发射统计卡片 → 全球发射统计（免费用户弹门控，专属 id 引导开通星际通行证） */
  async goGlobalLaunchStats() {
    const { gateCheck } = require('../../utils/membership.js')
    const allowed = await gateCheck('global_launch_stats', '全球发射统计')
    if (!allowed) return
    const { ROUTES, navigateTo } = require('../../utils/routes.js')
    navigateTo(ROUTES.GLOBAL_LAUNCH_STATS)
  },

  /** 仅使用当前任务发射 UUID，不使用全局自动推断 */
  async loadLl2FlightTimelineForMission(launchId) {
    const id = String(launchId || '').trim()
    if (!id) {
      this._timelineInflightLaunchId = null
      this.setData({
        ll2FlightTimelineLoading: false,
        ll2FlightTimelineRows: [],
        ll2FlightTimelineError: '',
        ll2FlightTimelineEmpty: false,
        ll2FlightTimelineNet: '',
        flightDemoTimeline: [],
        missionSimEligible: false
      })
      return
    }
    if (String(this.data.mission && this.data.mission.id) !== id) return
    // page 级去重：同一 launchId 已成功加载或正在加载中则跳过，避免 instant / syncMissionRuntimeState /
    // refreshMissionDetailInBackground 三条路径对同一 launchId 重复拉取
    if (this._timelineLoadedLaunchId === id || this._timelineInflightLaunchId === id) return
    this._timelineInflightLaunchId = id
    this.setData({
      ll2FlightTimelineLoading: true,
      ll2FlightTimelineError: '',
      ll2FlightTimelineEmpty: false,
      ll2FlightTimelineRows: [],
      flightDemoTimeline: [],
      // 时间线数据重拉后旧译文失效，重置「翻译/原文」状态
      tlTranslated: false,
      tlTranslating: false,
      tlI18n: { titles: [], descs: [] }
    })
    try {
      const res = await fetchLl2LaunchTimeline(id, {})
      if (String(this.data.mission && this.data.mission.id) !== id) return
      const rows = normalizeLl2TimelineList(res.timeline || [])
      const emptyOk = !res.timeline || res.timeline.length === 0
      // 星舰任务 + 有时间线 + 过审开关 → 显示指挥室模拟入口（时间线上方）
      const m = this.data.mission || {}
      const isStarship = /starship/i.test([m.missionName, m.name, m.rocketName].filter(Boolean).join(' '))
      const demoTl = this._buildFlightDemoTimeline(rows)
      this.setData({
        ll2FlightTimelineLoading: false,
        ll2FlightTimelineRows: rows,
        ll2FlightTimelineError: '',
        ll2FlightTimelineEmpty: emptyOk,
        ll2FlightTimelineNet: res.net || '',
        missionSimEligible: isStarship && rows.length > 0,
        flightDemoTimeline: isStarship ? demoTl : []
      })
      if (isStarship && rows.length > 0 && !this._missionSimFlagChecked) {
        this._missionSimFlagChecked = true
        isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then((on) => {
          if (on) this.setData({ enableMissionSim: true })
        }).catch(() => {})
      }
      this._timelineLoadedLaunchId = id
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      if (String(this.data.mission && this.data.mission.id) !== id) return
      this.setData({
        ll2FlightTimelineLoading: false,
        ll2FlightTimelineRows: [],
        ll2FlightTimelineError: formatCloudError(new Error(raw)),
        ll2FlightTimelineEmpty: false,
        ll2FlightTimelineNet: '',
        flightDemoTimeline: [],
        missionSimEligible: false
      })
    } finally {
      if (this._timelineInflightLaunchId === id) this._timelineInflightLaunchId = null
    }
  },

  /** LL2 行 → 演示/指挥室共用 payload（尊重当前翻译态） */
  _buildFlightDemoTimeline(rows) {
    const list = Array.isArray(rows) ? rows : (this.data.ll2FlightTimelineRows || [])
    const i18n = this.data.tlI18n || { titles: [], descs: [] }
    const useI18n = !!this.data.tlTranslated
    return list.map((r, i) => ({
      t: r.sortKey,
      label: (useI18n && i18n.titles[i]) || r.title,
      desc: (useI18n && i18n.descs[i]) || r.description,
      tLabel: r.timeLabel
    }))
  },

  /** 进入星舰任务指挥室：携带本任务 LL2 飞行时间线，模拟全程对齐真实节点 */
  async openMissionSimFromDetail() {
    if (!this.data.enableMissionSim) return
    const rows = this.data.ll2FlightTimelineRows || []
    if (!rows.length) return
    // PRO 门控（与进度页入口同一 productId，任一处解锁全局生效）
    if (this._missionSimGatePending) return
    this._missionSimGatePending = true
    let allowed = false
    try {
      const { gateCheck } = require('../../utils/membership.js')
      allowed = await gateCheck('mission_sim', '星舰任务指挥室')
    } finally {
      this._missionSimGatePending = false
    }
    if (!allowed) return
    const m = this.data.mission || {}
    const name = String(m.missionName || m.name || '星舰任务').trim()
    const payload = this._buildFlightDemoTimeline(rows)
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    }
    wx.navigateTo({
      url: '/subpackages/mission-sim/mission-sim',
      success(res) {
        try {
          res.eventChannel.emit('missionSimContext', { name, rows: payload })
        } catch (e) {}
      }
    })
  },

  /** 飞行剖面完整演示页（免费预览，无会员门控） */
  openFlightDemo() {
    if (!this.data.enableMissionSim) return
    const payload = this.data.flightDemoTimeline || []
    if (!payload.length) return
    const m = this.data.mission || {}
    const name = String(m.missionName || m.name || '星舰任务').trim()
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    }
    wx.navigateTo({
      url: '/subpackages/mission-sim/flight-demo',
      success(res) {
        try {
          res.eventChannel.emit('flightDemoContext', { name, rows: payload })
        } catch (e) {}
      }
    })
  },

  /** 飞行时间线「翻译/原文」按钮：逐条翻译节点标题与描述（override 兜底显示原文） */
  onToggleTimelineTranslate() {
    if (this.data.tlTranslating) return
    const rows = this.data.ll2FlightTimelineRows || []
    const fields = []
    rows.forEach((r, i) => {
      if (r && r.title) fields.push({ path: 'tlI18n.titles[' + i + ']', text: r.title })
      if (r && r.description) fields.push({ path: 'tlI18n.descs[' + i + ']', text: r.description })
    })
    if (!fields.length) return
    const p = togglePageTranslation(this, {
      switchKey: 'tlTranslated',
      loadingKey: 'tlTranslating',
      fields
    })
    // 翻译态切换后同步演示卡文案（引擎按 t 驱动，标签仅展示用）
    const refreshDemo = () => {
      if (!this.data.missionSimEligible) return
      this.setData({ flightDemoTimeline: this._buildFlightDemoTimeline() })
    }
    if (p && typeof p.then === 'function') p.then(refreshDemo).catch(() => {})
    else setTimeout(refreshDemo, 0)
  },

  async loadMissionDetail(id, detailType, opts = {}) {
    this.clearMissionCountdownTimer()
    // 主加载竞态保护：重入（retryLoad / 页内切换任务）时旧请求的响应不得覆盖新任务的渲染
    const loadSeq = (this._missionLoadSeq || 0) + 1
    this._missionLoadSeq = loadSeq
    const normalizedDetailType = detailType === 'completed' ? 'completed' : 'upcoming'

    // 切换任务时重置「翻译/原文」状态，避免残留上一个任务的译文
    if (this.data.descTranslated || this.data.descI18n.missionDesc || this.data.descI18n.rocketDesc) {
      this.setData({ descTranslated: false, descTranslating: false, descI18n: buildDefaultDescI18n() })
    }
    this.setData({ descOverflow: { missionDesc: false, rocketDesc: false } })
    this._textTranslateCache = null

    // 切换任务时页签回到「概览」并重置访问记录，让新任务重新按需懒加载
    if (this._tabStateMissionId && this._tabStateMissionId !== String(id)) {
      this.setData({
        activeTab: 'overview',
        visitedTabs: { overview: true, stats: false, info: false, timeline: false }
      })
    }
    this._tabStateMissionId = String(id)

    // 切换任务时重置回放卡片状态，避免残留上一个任务的回放
    if (this._replayLoadedLaunchId && this._replayLoadedLaunchId !== String(id)) {
      this._replayLoadedLaunchId = ''
      this._replayLoadedKey = ''
      this.setData({ enableReplayEntry: false, missionReplay: null, replayClips: [], replayLinks: [] })
    }

    let cache = {}
    let cachedMission = null
    try {
      cache = storageCache.readMemOrSync('mission_detail_cache', {}) || {}
      cachedMission = getMissionDetailCacheEntry(cache, id, normalizedDetailType)
    } catch (e) {}

    const hasFreshCachedMission = shouldReuseMissionDetailCache({
      mission: cachedMission,
      ttlMs: MISSION_DETAIL_CACHE_TTL
    })
    const cacheMissingPadCoords = !!(cachedMission && !hasPrecisePadCoords(cachedMission))

    // 有缓存时立即渲染首屏，跳过 loading spinner 阶段
    let instantRendered = false
    if (cachedMission) {
      const fallback = this.getMissionDetailFallback(cachedMission)
      // 缓存里可能是过期的 default；map 已 await 时强制重算，避免头图先闪占位
      fallback.rocketImage = resolveMissionRocketImage(
        '',
        fallback.rocketName,
        fallback.rocketConfiguration || cachedMission.rocketConfiguration,
        true
      )
      const seoMeta = buildMissionSeoMeta(fallback, normalizedDetailType)
      const cacheShareImage = fallback.rocketImage || resolveMissionRocketImage(DEFAULT_SHARE_IMAGE)
      this.setData({
        loading: false,
        mission: fallback,
        detailType: normalizedDetailType,
        navTitle: seoMeta.navTitle,
        pageTitle: seoMeta.pageTitle,
        shareTitle: seoMeta.shareTitle,
        shareImage: cacheShareImage,
        missionSubscribed: isSubscribed(fallback.id),
        detailExpanded: buildDefaultDetailExpanded(),
        detailBlocks: buildDefaultDetailBlocks()
      })
      this._measureDescOverflow()
      this.applyMissionPageSearchInfo(fallback, normalizedDetailType, cacheShareImage)
      if (normalizedDetailType === 'upcoming' && fallback.launchTime) {
        this.startMissionCountdown(fallback.launchTime)
      } else {
        this.refreshLaunchTimelineProgress({ isCompleted: normalizedDetailType === 'completed' })
      }
      instantRendered = true
      if (!cacheMissingPadCoords) {
        this._patchMapPreviewAsync(fallback)
      }
      // 统计/飞行时间线延迟到对应页签首次切入才拉取
      if (this.data.visitedTabs.stats) this.loadMissionLaunchStatsForMission(fallback)
      if (this.data.visitedTabs.timeline) this.loadLl2FlightTimelineForMission(fallback.id)
      // 当缓存新鲜且坐标完整时，下面 skipRebuild 会令 mission=null、syncMissionRuntimeState 整体跳过。
      // 这里补齐竞猜/直播的一次性初始化（在 instant 路径原本被漏掉）。
      // 仅在该条件下补，避免与后续 mission 重建走 syncMissionRuntimeState 时重复请求。
      if (hasFreshCachedMission && !cacheMissingPadCoords) {
        const fallbackUpcoming = normalizedDetailType === 'upcoming' &&
          !!(fallback.launchTime && !getCountdown(fallback.launchTime).isExpired)
        if (fallbackUpcoming) {
          this.loadVoteData(fallback.id, true)
          this.ensureLiveEntryAllowed().then((on) => {
            if (on) {
              this.loadChannelsLiveInfo()
              this.loadChannelsFallbackGuide()
            }
          })
        } else {
          this.loadMissionReplaySection(fallback)
        }
        // skipRebuild 时不会再 sync；若缓存已有序号行，统计返回后仍可能缺累计，主动补一次
        if (this.data.visitedTabs.stats) this.patchMissionLaunchStatsFromAgency(fallback)
      }
    } else if (!(opts.silent && this.data.mission)) {
      // silent（下拉刷新）：已有内容时不回退到加载骨架，只显示微信原生刷新指示器
      this.setData(buildMissionDetailBaseState(normalizedDetailType))
    }

    // 时间字段以列表为准（mergeMissionDetailData 会用 list 的 launchTime 覆盖 detail 的旧值），
    // 即使已有 detailMission/cachedMission，也尝试取一份 list snapshot 用作时间权威源。
    // findMissionInList 内部会优先走 storage 短路（命中 _cacheSource='list'），
    // 仅在缺失时才回源 getUpcomingMissions 网络请求。
    // 与详情拉取并行启动：列表快照缺失需回源网络时，不再串在详情之后多等一轮 RTT
    const listMissionPromise = this.findMissionInList(id, normalizedDetailType).catch(() => null)

    let detailMission = null
    if (!hasFreshCachedMission || cacheMissingPadCoords) {
      // 详情仍在拉取：页签下方面板可能整块为空，亮转圈提示避免被误认为无数据
      // （silent 下拉刷新已有完整内容且有原生刷新指示器，不再转圈）
      if (!opts.silent && !this.data.detailHydrating) this.setData({ detailHydrating: true })
      this._detailRequestMap = this._detailRequestMap || {}
      const requestKey = getMissionDetailCacheKey(id, normalizedDetailType)
      if (!this._detailRequestMap[requestKey]) {
        this._detailRequestMap[requestKey] = getLaunchDetail(id, normalizedDetailType)
          .finally(() => {
            if (this._detailRequestMap && this._detailRequestMap[requestKey]) {
              delete this._detailRequestMap[requestKey]
            }
          })
      }

      try {
        detailMission = await this._detailRequestMap[requestKey]
      } catch (error) {
        this._lastLoadError = error
        detailMission = null
      }
      if (loadSeq !== this._missionLoadSeq) return
    }

    const listMission = await listMissionPromise
    if (loadSeq !== this._missionLoadSeq) return

    let mission = null
    if (detailMission) {
      mission = this.mergeMissionDetailData(detailMission, listMission || cachedMission)
    } else if (cachedMission) {
      const skipRebuild = instantRendered && hasFreshCachedMission && !cacheMissingPadCoords
      if (skipRebuild) {
        mission = null
      } else {
        mission = this.mergeMissionDetailData(cachedMission, listMission)
      }
    } else if (listMission) {
      mission = this.mergeMissionDetailData(this.getMissionDetailFallback(listMission), listMission)
    }

    if (!mission && !instantRendered) {
      const msg = isPermissionDenied(this._lastLoadError)
        ? getPermissionDeniedMessage()
        : '任务详情加载失败，请稍后再试'
      this.setData({
        loading: false,
        detailHydrating: false,
        errorMessage: msg
      })
      return
    }

    if (mission) {
      const normalizedState = await this.buildNormalizedMissionState(mission, {
        listMission,
        detailType: normalizedDetailType
      })
      if (loadSeq !== this._missionLoadSeq) return
      const normalizedMission = normalizedState.mission
      const effectiveDetailType = normalizedState.effectiveDetailType

      this.setData({
        loading: false,
        detailHydrating: false,
        ...normalizedState.pageState
      })
      this._measureDescOverflow()
      this.applyMissionPageSearchInfo(
        normalizedMission,
        effectiveDetailType,
        normalizedState.pageState.shareImage
      )
      this.ensureShareImageHttpUrl(this.data.shareImage)

      this.syncMissionRuntimeState(normalizedState)
      // 详情已带序号徽章时，补齐可能早于详情返回的统计卡「累计 —」
      this.patchMissionLaunchStatsFromAgency(normalizedMission)

      this.persistMissionDetailCache(id, normalizedMission, {
        primaryDetailType: effectiveDetailType,
        secondaryDetailType: normalizedDetailType,
        source: detailMission ? 'detail' : (cachedMission ? (cachedMission._cacheSource || 'detail') : 'fallback')
      })

      // 冷路径：6h 拆分的 updates_{uuid}；热路径：最新任务可走 LL2（有缓存）
      this.ensureLaunchUpdatesFromCache(id, normalizedMission)

      this.refreshMissionDetailInBackground(id, effectiveDetailType, {
        skipIfFresh: hasFreshCachedMission || !!detailMission
      })
    } else {
      // 详情拉取失败但已有缓存渲染（或 skipRebuild）：结束转圈，交给后台刷新兜底
      if (this.data.detailHydrating) this.setData({ detailHydrating: false })
      this.refreshMissionDetailInBackground(id, normalizedDetailType, {
        skipIfFresh: false
      })
    }
  },

  /**
   * 补齐「发射动态」：优先读云拆分缓存（历史任务 0 额外 LL2），
   * 仅当详情本身没有 updates 时才请求；热路径缓存未命中才会打 LL2。
   */
  ensureLaunchUpdatesFromCache(launchId, mission) {
    const id = String(launchId || '').trim()
    if (!id) return
    const existing = mission && Array.isArray(mission.launchUpdates) ? mission.launchUpdates : []
    if (existing.length > 0) return
    if (this._launchUpdatesInflightId === id) return
    this._launchUpdatesInflightId = id

    fetchLl2LaunchUpdates(id, 15)
      .then((res) => {
        if (this._launchUpdatesInflightId === id) this._launchUpdatesInflightId = ''
        if (!this.data.mission || String(this.data.mission.id) !== id) return
        const list = res && Array.isArray(res.list) ? res.list : []
        const mapped = mapRawUpdatesToLaunchUpdates(list)
        if (!mapped.length) return
        const cur = this.data.mission.launchUpdates
        if (Array.isArray(cur) && cur.length >= mapped.length) return
        this.setData({ 'mission.launchUpdates': mapped })
      })
      .catch(() => {
        if (this._launchUpdatesInflightId === id) this._launchUpdatesInflightId = ''
      })
  },

  async refreshMissionDetailInBackground(id, detailType, options = {}) {
    const safeOptions = options || {}
    if (safeOptions.skipIfFresh) return

    this._detailRefreshMeta = this._detailRefreshMeta || {}
    const requestKey = getMissionDetailCacheKey(id, detailType)
    const previousRefreshAt = this._detailRefreshMeta[requestKey] || 0
    if (Date.now() - previousRefreshAt < 30000) return
    this._detailRefreshMeta[requestKey] = Date.now()

    this._detailRequestMap = this._detailRequestMap || {}
    try {
      if (!this._detailRequestMap[requestKey]) {
        this._detailRequestMap[requestKey] = getLaunchDetail(id, detailType)
          .finally(() => {
            if (this._detailRequestMap && this._detailRequestMap[requestKey]) {
              delete this._detailRequestMap[requestKey]
            }
          })
      }
      const mission = await this._detailRequestMap[requestKey]
      if (!mission || !this.data.mission || String(this.data.mission.id) !== String(id)) return
      const mergedMission = this.mergeMissionDetailData(mission, this.data.mission)
      const normalizedState = await this.buildNormalizedMissionState(mergedMission, {
        listMission: this.data.mission,
        detailType: 'completed'
      })
      const refreshed = normalizedState.mission
      const effectiveDetailType = normalizedState.effectiveDetailType
      this.setData({
        mission: refreshed,
        detailType: effectiveDetailType,
        navTitle: normalizedState.seoMeta.navTitle,
        pageTitle: normalizedState.seoMeta.pageTitle,
        shareTitle: normalizedState.seoMeta.shareTitle,
        shareImage: normalizedState.pageState.shareImage,
        missionSubscribed: normalizedState.pageState.missionSubscribed,
        ...this.buildMapPreviewData(refreshed)
      })
      this.applyMissionPageSearchInfo(
        refreshed,
        effectiveDetailType,
        normalizedState.pageState.shareImage
      )
      this.ensureShareImageHttpUrl(this.data.shareImage)
      this.syncMissionRuntimeState(normalizedState)
      this.persistMissionDetailCache(id, refreshed, {
        primaryDetailType: detailType,
        secondaryDetailType: effectiveDetailType,
        source: 'detail'
      })
    } catch (e) {}
  },

  clearMissionCountdownTimer() {
    if (this._missionDetailTimer) {
      clearInterval(this._missionDetailTimer)
      this._missionDetailTimer = null
    }
    if (this._missionDetailSecondsRollTimer) {
      clearTimeout(this._missionDetailSecondsRollTimer)
      this._missionDetailSecondsRollTimer = null
    }
  },

  startMissionCountdown(launchTime) {
    this.clearMissionCountdownTimer()
    this.updateMissionCountdown(launchTime)
    const timer = setInterval(() => {
      this.updateMissionCountdown(launchTime)
    }, 1000)
    this._missionDetailTimer = timer
  },

  /** 倒计时窄路径差量：WXML 只绑定 days/hours/minutes/isExpired，秒位走独立滚轮字段 */
  _buildMissionCountdownPatch(countdown) {
    const cur = this.data.missionCountdown || {}
    const patch = {}
    if (cur.days !== countdown.days) patch['missionCountdown.days'] = countdown.days
    if (cur.hours !== countdown.hours) patch['missionCountdown.hours'] = countdown.hours
    if (cur.minutes !== countdown.minutes) patch['missionCountdown.minutes'] = countdown.minutes
    if (cur.seconds !== countdown.seconds) patch['missionCountdown.seconds'] = countdown.seconds
    if (cur.isExpired !== countdown.isExpired) patch['missionCountdown.isExpired'] = countdown.isExpired
    return patch
  },

  updateMissionCountdown(launchTime) {
    if (!launchTime) return
    const countdown = getCountdown(launchTime)
    const nextSecondsText = formatSecondsText(countdown.seconds)
    const currentSecondsText = formatSecondsText(this.data.missionDetailSecondsCurrent)
    const nextSecondsReel = getSecondsReel(countdown.seconds)
    const countdownPatch = this._buildMissionCountdownPatch(countdown)

    if (nextSecondsText !== currentSecondsText) {
      if (this._missionDetailSecondsRollTimer) {
        clearTimeout(this._missionDetailSecondsRollTimer)
        this._missionDetailSecondsRollTimer = null
      }
      this.setData({
        ...countdownPatch,
        missionDetailSecondsPrev: currentSecondsText,
        missionDetailSecondsCurrent: nextSecondsText,
        missionDetailSecondsReel: [currentSecondsText, nextSecondsText, nextSecondsReel[2]],
        missionDetailSecondsRolling: true
      })
      this._missionDetailSecondsRollTimer = setTimeout(() => {
        this.setData({
          missionDetailSecondsPrev: nextSecondsText,
          missionDetailSecondsCurrent: nextSecondsText,
          missionDetailSecondsReel: nextSecondsReel,
          missionDetailSecondsRolling: false
        })
        this._missionDetailSecondsRollTimer = null
      }, 540)
    } else if (Object.keys(countdownPatch).length) {
      // 秒位文本未变（如跨小时进位后同秒），只差量下发变化字段
      this.setData(countdownPatch)
    }

    this.refreshLaunchTimelineProgress()

    if (countdown.isExpired) {
      this.clearMissionCountdownTimer()
      this.refreshLaunchTimelineProgress({ isCompleted: true })
    }
  },

  toggleDetailExpand(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [`detailExpanded.${key}`]: !this.data.detailExpanded[key] })
  },

  /** 分栏页签点击：首次切入才渲染 panel 并拉取该页签的数据（懒加载） */
  onDetailTabTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset.key
    if (!key || key === this.data.activeTab) return
    try { wx.vibrateShort({ type: 'light' }) } catch (e2) {}

    const firstVisit = !this.data.visitedTabs[key]
    const patch = { activeTab: key }
    if (firstVisit) patch[`visitedTabs.${key}`] = true
    this.setData(patch, () => {
      // 「详情」panel 隐藏时（display:none）量不出行数：每次切入都补测一次文本折叠
      // （首次渲染后节点才存在；期间若切过翻译，译文行数与原文不同也靠这里纠正）
      if (key === 'info') this._measureDescOverflow()
    })

    // 首次切入才发起该页签的数据请求（模块内有 launchId 级去重，重复切换不重复拉）
    const mission = this.data.mission
    if (key === 'stats' && mission) {
      this.loadMissionLaunchStatsForMission(mission)
      this.patchMissionLaunchStatsFromAgency(mission)
    } else if (key === 'timeline' && mission) {
      this.loadLl2FlightTimelineForMission(mission.id)
    }

    this._scrollPanelsToTop()
  },

  /** 实测固定导航栏底边，作为页签栏 sticky top：与导航下口无缝对齐 */
  _measureTabStickyTop() {
    wx.nextTick(() => {
      try {
        wx.createSelectorQuery()
          .select('.top-nav-wrapper')
          .boundingClientRect((rect) => {
            if (!rect || !rect.bottom) return
            // 上移 1px 让页签栏顶边藏进导航底部 1px 边线下，杜绝亚像素缝
            const top = Math.max(0, rect.bottom - 1)
            if (Math.abs(top - this.data.detailTabStickyTop) >= 0.5) {
              this.setData({ detailTabStickyTop: top })
            }
          })
          .exec()
      } catch (e) {}
    })
  },

  /** 切页签时若已滚过页签栏，滚回页签栏吸顶位置，避免新 panel 内容落在视野外 */
  _scrollPanelsToTop() {
    try {
      const q = wx.createSelectorQuery().in(this)
      q.select('#detailTabAnchor').boundingClientRect()
      q.select('#detailScrollView').scrollOffset()
      q.exec((res) => {
        const rect = res && res[0]
        const off = res && res[1]
        if (!rect || !off) return
        const navH = Number(this.data.detailTabStickyTop || this.data.navPlaceholderHeight) || 0
        // 锚点还在导航栏下方（头图可见）→ 无需回滚
        if (rect.top >= navH - 1) return
        const target = Math.max(0, off.scrollTop + rect.top - navH)
        this.setData({ detailScrollTop: target })
      })
    } catch (e) {}
  },

  /** 量取任务说明/火箭信息的实际渲染行数，超过 3 行才折叠（以隐藏测量节点高度 ÷ 单行高判定） */
  _measureDescOverflow() {
    wx.nextTick(() => {
      try {
        const q = wx.createSelectorQuery().in(this)
        q.select('#descMeasureLineM').boundingClientRect()
        q.select('#descMeasureMission').boundingClientRect()
        q.select('#descMeasureLineR').boundingClientRect()
        q.select('#descMeasureRocket').boundingClientRect()
        q.exec((res) => {
          // 「详情」页签未渲染或被 hidden（display:none）时节点量不出高度，
          // 跳过本次更新保留旧值；切入页签时会再补测
          const lineM = res && res[0]
          const lineR = res && res[2]
          if ((!lineM || !lineM.height) && (!lineR || !lineR.height)) return
          const overflowOf = (lineRect, textRect) => {
            if (!lineRect || !textRect || !lineRect.height || !textRect.height) return false
            // 容差 2px：避免字体渲染取整导致恰好 3 行被误判为溢出
            return textRect.height > lineRect.height * 3 + 2
          }
          const missionOverflow = overflowOf(res && res[0], res && res[1])
          const rocketOverflow = overflowOf(res && res[2], res && res[3])
          const cur = this.data.descOverflow || {}
          if (cur.missionDesc !== missionOverflow || cur.rocketDesc !== rocketOverflow) {
            this.setData({ descOverflow: { missionDesc: missionOverflow, rocketDesc: rocketOverflow } })
          }
        })
      } catch (e) {}
    })
  },

  /** 「翻译/原文」按钮：任务说明 + 火箭信息 + 有效载荷描述一次性翻译（预翻译秒切，缺失才调云端） */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const m = this.data.mission || {}
    const missionText = (m.missionFull && m.missionFull.description) || m.missionDetails || m.description || ''
    const rocketText = (m.rocketFull && m.rocketFull.description) || m.rocketInfo || ''
    const fields = [
      { path: 'descI18n.missionDesc', text: missionText, zh: (m.missionFull && m.missionFull.descriptionZh) || '' },
      { path: 'descI18n.rocketDesc', text: rocketText, zh: (m.rocketFull && m.rocketFull.descriptionZh) || '' }
    ]
    const payloads = Array.isArray(m.payloadDetails) ? m.payloadDetails : []
    payloads.forEach((p, i) => {
      if (p && p.description) {
        fields.push({ path: 'descI18n.payloads[' + i + ']', text: p.description })
      }
    })
    // LL2 补充字段的英文文本：所属计划、发射动态、失败原因、状态说明、发射台/发射场简介、天气顾虑
    const programs = Array.isArray(m.programInfo) ? m.programInfo : []
    programs.forEach((p, i) => {
      if (p && p.description) {
        fields.push({ path: 'descI18n.programs[' + i + ']', text: p.description })
      }
    })
    if (m.failReason) fields.push({ path: 'descI18n.failReason', text: m.failReason })
    if (m.statusDescription) fields.push({ path: 'descI18n.statusNote', text: m.statusDescription })
    if (m.padDetail && m.padDetail.padDescription) fields.push({ path: 'descI18n.padDesc', text: m.padDetail.padDescription })
    if (m.padDetail && m.padDetail.locationDescription) fields.push({ path: 'descI18n.locDesc', text: m.padDetail.locationDescription })
    if (m.weatherConcerns) fields.push({ path: 'descI18n.weather', text: m.weatherConcerns })
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields
    }).then(() => {
      // 译文与原文行数不同，切换后重测折叠状态
      this._measureDescOverflow()
    })
  },

  toggleDetailBlock(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [`detailBlocks.${key}`]: !this.data.detailBlocks[key] })
  },

  /** 跳转发射动态独立页（会员门控 + 便于分享） */
  async onOpenLaunchUpdates() {
    const mission = this.data.mission
    if (!mission || !mission.id) return
    const updates = Array.isArray(mission.launchUpdates) ? mission.launchUpdates : []
    if (!updates.length) return

    const { gateCheck } = require('../../utils/membership.js')
    const allowed = await gateCheck('launch_updates', '发射动态')
    if (!allowed) return

    const missionName = mission.missionName || mission.name || ''
    const url = buildUrl(ROUTES.LAUNCH_UPDATES, {
      id: mission.id,
      name: String(missionName).slice(0, 80)
    })
    wx.navigateTo({
      url,
      success: (res) => {
        try {
          if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
            res.eventChannel.emit('init', { updates, missionName })
          }
        } catch (_) {}
      }
    })
  },

  /** 标题行任务徽章缩略图 → 全屏预览大图 */
  onPreviewPatch(e) {
    const patches = (this.data.mission && this.data.mission.missionPatches) || []
    const urls = patches.map(p => p && p.imageUrl).filter(Boolean)
    if (!urls.length) return
    const idx = Number(e.currentTarget.dataset.index) || 0
    wx.previewImage({ urls, current: urls[Math.min(idx, urls.length - 1)] })
  },

  async onSubscribeMission() {
    if (this._subscribing) return
    const mission = this.data.mission
    if (!mission || !mission.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const oaReady = !!(this.data.oaAlertReady || peekOaAlertReady())
    // 已订阅：OA 下关闭结果通知；非 OA 下保持提示（发射提醒+结果一体，避免误关）
    if (this.data.missionSubscribed) {
      if (oaReady) {
        this._subscribing = true
        try {
          await unsubscribeLaunch(mission.id)
          this.setData({ missionSubscribed: false })
          wx.showToast({ title: '已关闭结果通知（服务号发射提醒仍有效）', icon: 'none' })
        } finally {
          this._subscribing = false
        }
        return
      }
      wx.showToast({ title: '已设置提醒（含结果通知）', icon: 'none' })
      return
    }
    this._subscribing = true
    try {
      const ok = await subscribeLaunch(mission)
      if (ok) {
        this.setData({ missionSubscribed: true })
        // 记录提前订阅（先知成就统计）
        try {
          const { trackEarlySubscribe } = require('../../utils/behavior-stats.js')
          trackEarlySubscribe(mission.id, mission.launchTime)
        } catch (ex) {}
      }
    } finally {
      this._subscribing = false
    }
  },

  async _refreshOaAlertReady(force) {
    try {
      const ready = await isOaAlertReady(!!force)
      const patch = { oaAlertReady: ready }
      // missionSubscribed 只表示本任务已写入结果/提醒订阅，不再被 OA 就绪态强行置 true
      if (this.data.mission && this.data.mission.id) {
        patch.missionSubscribed = isSubscribed(this.data.mission.id)
      }
      this.setData(patch)
    } catch (e) {}
  },

  /** 是否在 upcoming 前 7 场开放竞猜；无首页缓存时自行拉列表，避免深链详情空白 */
  async _isVoteEligibleLaunch(launchId) {
    const lid = String(launchId || '')
    if (!lid) return false
    this._voteEligibleMemo = this._voteEligibleMemo || {}
    if (Object.prototype.hasOwnProperty.call(this._voteEligibleMemo, lid)) {
      return this._voteEligibleMemo[lid]
    }
    try {
      const cached = wx.getStorageSync('_vote_eligible_ids') || []
      if (Array.isArray(cached) && cached.length > 0) {
        const ok = cached.some((eid) => String(eid) === lid)
        this._voteEligibleMemo[lid] = ok
        return ok
      }
    } catch (e) {}
    try {
      const res = await getUpcomingMissions(7, 0)
      const list = (res && res.list) || []
      const ids = list
        .slice(0, 7)
        .map((m) => String((m && (m.id || m._id)) || ''))
        .filter(Boolean)
      if (ids.length) {
        try {
          wx.setStorage({ key: '_vote_eligible_ids', data: ids, fail: () => {} })
        } catch (eStore) {}
      }
      const ok = ids.some((id) => id === lid)
      this._voteEligibleMemo[lid] = ok
      return ok
    } catch (e) {
      // 列表失败时放行，交给后端 enabled / 封盘控制
      this._voteEligibleMemo[lid] = true
      return true
    }
  },

  async loadVoteData(launchId, skipCache) {
    if (!launchId) return

    // 仅前7个即将发射的任务开放竞猜（不依赖首页是否已写过缓存）
    const eligible = await this._isVoteEligibleLaunch(launchId)
    if (!eligible) {
      this.setData(getInitialVoteState())
      return null
    }

    const currentLaunchId = String(launchId)
    const now = Date.now()
    this._voteRequestMeta = this._voteRequestMeta || {}
    const voteMeta = this._voteRequestMeta[currentLaunchId] || {}

    if (voteMeta.promise) {
      return voteMeta.promise
    }

    if (shouldSkipVoteRefresh({
      launchId: currentLaunchId,
      lastLoadedAt: voteMeta.loadedAt,
      ttlMs: DETAIL_VOTE_REFRESH_TTL,
      skipCache,
      now
    })) {
      this._voteBundle = this._voteBundle || {}
      if (!this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = voteMeta.bundle
      } else if (this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = mergeVoteBundle(voteMeta.bundle, this._voteBundle[currentLaunchId], currentLaunchId)
      }
      if (this._voteBundle[currentLaunchId]) {
        this.setData(buildDualVoteUiPatch(this._voteBundle[currentLaunchId], this.data.activeVoteType, launchId))
      }
      return voteMeta.stats || null
    }

    const request = (async () => {
      const mission = this.data.mission
      const baseInfo = (mission && String(mission.id || '') === currentLaunchId) ? {
        launchTime: mission.launchTime || mission.windowStart || '',
        status: this.data.detailType || '',
        statusCategory: mission.statusCategory || '',
        statusAbbrev: mission.statusAbbrev || '',
        statusName: mission.statusBadgeText || mission.status || '',
        missionName: mission.missionName || mission.name || '',
        rocketName: mission.rocketName || ''
      } : {}
      const [ontimeStats, outcomeStats] = await Promise.all([
        getVoteStats(launchId, skipCache, { ...baseInfo, voteType: 'ontime' }).catch(() => null),
        getVoteStats(launchId, skipCache, { ...baseInfo, voteType: 'outcome' }).catch(() => null)
      ])
      if (ontimeStats && !ontimeStats.myVote) ontimeStats.myVote = getLocalVote(launchId, 'ontime')
      if (outcomeStats && !outcomeStats.myVote) outcomeStats.myVote = getLocalVote(launchId, 'outcome')
      const prevBundle = (this._voteBundle && this._voteBundle[currentLaunchId]) || voteMeta.bundle || null
      const bundle = mergeVoteBundle(prevBundle, { ontime: ontimeStats, outcome: outcomeStats }, currentLaunchId)
      const activeStats = (this.data.activeVoteType === 'outcome' ? bundle.outcome : bundle.ontime) || bundle.ontime || bundle.outcome
      this._voteBundle = this._voteBundle || {}
      this._voteBundle[currentLaunchId] = bundle
      this._voteRequestMeta[currentLaunchId] = {
        loadedAt: Date.now(),
        stats: activeStats,
        bundle,
        promise: null
      }
      if (!this.data.mission || String(this.data.mission.id || '') !== currentLaunchId) return activeStats
      this.setData(buildDualVoteUiPatch(bundle, this.data.activeVoteType, launchId))
      return activeStats
    })()

    this._voteRequestMeta[currentLaunchId] = {
      ...voteMeta,
      promise: request
    }

    try {
      return await request
    } finally {
      const latestMeta = this._voteRequestMeta[currentLaunchId] || {}
      if (latestMeta.promise === request) {
        this._voteRequestMeta[currentLaunchId] = {
          ...latestMeta,
          promise: null
        }
      }
    }
  },

  onVoteTypeSwitch(e) {
    const vt = (e.currentTarget.dataset && e.currentTarget.dataset.type) || ''
    if (vt !== 'ontime' && vt !== 'outcome') return
    if (vt === this.data.activeVoteType) return
    if (vt === 'ontime' && !this.data.voteOntimeEnabled) return
    if (vt === 'outcome' && !this.data.voteOutcomeEnabled) return
    const launchId = this.data.mission && this.data.mission.id
    if (!launchId) return
    const bundle = (this._voteBundle && this._voteBundle[String(launchId)]) || {}
    this.setData(buildDualVoteUiPatch(bundle, vt, launchId))
  },

  async onVote(e) {
    const pill = (e.currentTarget.dataset && (e.currentTarget.dataset.pill || e.currentTarget.dataset.side)) || ''
    const mission = this.data.mission
    const voteType = this.data.activeVoteType === 'outcome' ? 'outcome' : 'ontime'
    const choice = voteType === 'outcome'
      ? (pill === 'left' ? 'failure' : pill === 'right' ? 'success' : '')
      : (pill === 'left' ? 'ge' : pill === 'right' ? 'buge' : '')
    if (!mission || !mission.id || !choice) return
    if (this.data.voteData && this.data.voteData.votingClosed) {
      wx.showToast({ title: '竞猜已封盘', icon: 'none' })
      return
    }
    if (this.data.myVote) {
      wx.showToast({ title: '你已经投过啦', icon: 'none' })
      return
    }

    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    saveLocalVote(mission.id, choice, voteType)

    const oldData = this.data.voteData || { geCount: 0, buGeCount: 0 }
    const leftChoice = voteType === 'outcome' ? 'failure' : 'ge'
    const rightChoice = voteType === 'outcome' ? 'success' : 'buge'
    const newGe = (oldData.geCount || 0) + (choice === leftChoice ? 1 : 0)
    const newBuge = (oldData.buGeCount || 0) + (choice === rightChoice ? 1 : 0)
    const optimistic = buildVoteState({
      ...oldData,
      geCount: newGe,
      buGeCount: newBuge,
      failureCount: voteType === 'outcome' ? newGe : oldData.failureCount,
      successCount: voteType === 'outcome' ? newBuge : oldData.successCount,
      voteType
    }, choice, voteType)
    this.setData({
      ...optimistic,
      voteSlotVisible: this.data.voteSlotVisible,
      voteOntimeEnabled: this.data.voteOntimeEnabled,
      voteOutcomeEnabled: this.data.voteOutcomeEnabled,
      activeVoteType: voteType
    })

    let serverData = null
    let voteFailMsg = ''
    try {
      serverData = await castVote(mission.id, choice, {
        voteType,
        missionName: mission.missionName || mission.name,
        rocketName: mission.rocketName,
        launchTime: mission.launchTime,
        statusCategory: mission.statusCategory || '',
        statusAbbrev: mission.statusAbbrev || '',
        statusName: mission.statusBadgeText || ''
      })
    } catch (err) {
      serverData = null
      voteFailMsg = (err && err.message) || ''
    }

    if (serverData) {
      let normalized = buildVoteState(serverData, choice, voteType)
      if (!normalized.voteTotal && (newGe + newBuge) > 0) {
        normalized = buildVoteState({
          ...serverData,
          geCount: newGe,
          buGeCount: newBuge,
          failureCount: newGe,
          successCount: newBuge,
          voteType
        }, choice, voteType)
      }
      this.setData({
        ...normalized,
        voteSlotVisible: this.data.voteSlotVisible,
        voteOntimeEnabled: this.data.voteOntimeEnabled,
        voteOutcomeEnabled: this.data.voteOutcomeEnabled,
        activeVoteType: voteType
      })
      this._voteBundle = this._voteBundle || {}
      const lid = String(mission.id)
      const b = this._voteBundle[lid] || {}
      const votedStats = Object.assign({}, serverData, {
        myVote: choice,
        enabled: true,
        geCount: normalized.voteData.geCount,
        buGeCount: normalized.voteData.buGeCount,
        failureCount: normalized.voteData.failureCount,
        successCount: normalized.voteData.successCount
      })
      b[voteType] = votedStats
      this._voteBundle[lid] = b
      this._voteRequestMeta = this._voteRequestMeta || {}
      const prevMeta = this._voteRequestMeta[lid] || {}
      this._voteRequestMeta[lid] = {
        loadedAt: Date.now(),
        stats: votedStats,
        bundle: b,
        promise: prevMeta.promise || null
      }
    } else {
      // 提交失败/被拒（如已结算）：回滚乐观更新
      removeLocalVote(mission.id, voteType)
      this.setData({
        ...buildVoteState(oldData, '', voteType),
        voteSlotVisible: this.data.voteSlotVisible,
        voteOntimeEnabled: this.data.voteOntimeEnabled,
        voteOutcomeEnabled: this.data.voteOutcomeEnabled,
        activeVoteType: voteType
      })
      wx.showToast({ title: voteFailMsg || '投票失败，请重试', icon: 'none' })
    }
  },

  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const data = String(url)
    const doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () { wx.showToast({ title: '链接已复制', icon: 'success' }) },
        fail: function () { wx.showModal({ title: '链接', content: data, showCancel: false }) }
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doCopy, fail: doCopy })
    } else {
      doCopy()
    }
  },

  // 点击「直播」/「B站直播」按钮
  //   - official 直播中 → channel-live 透明层直进直播间（无确认弹窗）
  //   - official 未直播 → 推荐第三方视频号主页二维码（方案二）；无配置则打开自己视频号主页
  //   - bilibili → 弹出二维码 modal，扫码进 B 站直播间
  openLivestreamSheet(e) {
    const source = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.source) || 'official'
    try {
      const { trackNightOwl } = require('../../utils/behavior-stats.js')
      trackNightOwl()
    } catch (ex) {}
    if (source === 'bilibili') {
      this.setData({ showBiliQRModal: true })
      return
    }
    // 直播中由透明 channel-live 接管点击
    if (this.data.showChannelLiveTap) return

    const self = this
    this.ensureChannelsLiveInfo().then(function () {
      if (self.data.showChannelLiveTap) {
        wx.showToast({ title: '请再次点击进入直播间', icon: 'none', duration: 2000 })
        return
      }
      self.openChannelsFallbackOrOwnProfile()
    })
  },

  openChannelsFallbackOrOwnProfile() {
    const self = this
    this.loadChannelsFallbackGuide(true).finally(() => {
      const guide = self.data.channelsFallbackGuide
      if (guide && guide.enabled && guide.qrUrl) {
        self.setData({ showChannelsGuideModal: true })
        return
      }
      self.openOfficialLiveProfileWithConfirm()
    })
  },

  openOfficialLiveProfileWithConfirm() {
    wx.showModal({
      title: '打开视频号',
      content: '即将打开视频号，可在视频号内观看直播或获取开播提醒',
      confirmText: '前往',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.openOfficialLiveProfile()
      }
    })
  },

  openOfficialLiveProfile() {
    loadChannelsLiveModule()
      .then((live) => live.openChannelsUserProfile(this.data.liveFinderUserName))
      .catch(() => {})
  },

  hideChannelsGuideModal() {
    this.setData({ showChannelsGuideModal: false })
  },

  onChannelsGuideQRImageTap() {
    const guide = this.data.channelsFallbackGuide || {}
    const qrUrl = guide.qrUrl || guide.qrDisplayUrl
    if (!qrUrl) return
    wx.previewImage({
      urls: [qrUrl],
      current: qrUrl
    })
  },

  onCopyChannelsGuideNickname() {
    const guide = this.data.channelsFallbackGuide || {}
    const nickname = String(guide.nickname || '').trim()
    if (!nickname) {
      wx.showToast({ title: '暂无视频号名称', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: nickname,
      success: () => {
        setTimeout(() => {
          wx.hideToast()
          wx.showToast({ title: '名称已复制', icon: 'success', duration: 1500 })
        }, 200)
      },
      fail: () => {
        wx.showModal({
          title: '复制失败',
          content: `请手动搜索视频号：${nickname}`,
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    })
  },

  // 关闭 B 站二维码弹窗
  hideBiliQRCode() {
    this.setData({ showBiliQRModal: false })
  },

  // 点击 B 站二维码图片：放大预览
  onBiliQRImageTap() {
    const qrUrl = (this.data.biliLive && this.data.biliLive.qrUrl) || BILI_LIVE_QR_URL
    wx.previewImage({
      urls: [qrUrl],
      current: qrUrl
    })
  },

  // 复制 B 站直播链接
  // 注意：wx.setClipboardData 在 ≥ 2.1.0 基础库会自带 "内容已复制" 原生 toast，
  // 直接在 success 里再 showToast 会被它覆盖，让用户误以为"按了没反应"。
  // 处理方式：错开 200ms 再 showToast，并加 fail 兜底以 modal 形式给用户兜底拿到链接。
  onCopyBiliLiveLink() {
    const url = (this.data.biliLive && this.data.biliLive.liveUrl) || BILI_LIVE_URL
    wx.setClipboardData({
      data: url,
      success: () => {
        setTimeout(() => {
          wx.hideToast()
          wx.showToast({ title: '链接已复制', icon: 'success', duration: 1500 })
        }, 200)
      },
      fail: () => {
        wx.showModal({
          title: '复制失败',
          content: `请手动复制下方链接：\n${url}`,
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    })
  },

  buildMapPreviewData(mission) {
    if (!mission) return { mapPreviewReady: false }

    let lat = null
    let lng = null
    let siteName = ''
    let coordSource = '' // 调试：记录坐标来源

    // 1) 优先使用本地维护的精校坐标（KNOWN_LAUNCH_SITE_COORDS）
    //    原因：LL2 / 第三方 API 对中国发射场的经纬度普遍粗略，
    //    甚至会落到沿海几公里外的海面上（典型场景：文昌 LP-201）。
    const siteKey = this.inferLaunchSiteKey(mission)
    const known = siteKey && KNOWN_LAUNCH_SITE_COORDS[siteKey]
    if (known) {
      lat = known.lat
      lng = known.lng
      siteName = known.name
      coordSource = `known:${siteKey}`
    }

    // 2) Fallback：如果本地没有匹配（陌生发射场 / 海上平台等），再用 API 返回的坐标
    const pad = mission.padDetail
    if ((!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0))
        && pad && pad.latitude != null && pad.longitude != null) {
      lat = Number(pad.latitude)
      lng = Number(pad.longitude)
      siteName = pad.padName || pad.locationName || ''
      coordSource = 'padDetail'
    }

    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
      return { mapPreviewReady: false }
    }

    // 微信小程序 <map> 默认使用 GCJ-02（火星坐标系），而 API / 硬编码的发射场坐标
    // 都是 WGS-84（GPS 原始）。在中国大陆境内必须先转换，否则会有数百米偏移
    // （文昌等沿海发射场会被挤到海里）。境外坐标 wgs84ToGcj02 内部会原样返回。
    const rawLat = lat
    const rawLng = lng
    const fixed = wgs84ToGcj02(lng, lat)
    lat = fixed.lat
    lng = fixed.lng

    // padDetail 的 padName/locationName 通常更精确（带工位号），优先作为标签
    siteName = (pad && (pad.padName || pad.locationName)) || siteName
      || mission.launchSite || mission.padLocation || '发射场'
    return {
      mapPreviewReady: true,
      mapPreviewLat: lat,
      mapPreviewLng: lng,
      mapPreviewScale: 14,
      mapPreviewMarkers: [{
        id: 1,
        latitude: lat,
        longitude: lng,
        width: 28,
        height: 36,
        // 默认红色 pin 的图钉尖端在底部中央，用 anchor 显式对齐到 lat/lng，
        // 防止某些机型上图钉视觉中心略偏导致"标记和地址不对应"的错觉
        anchor: { x: 0.5, y: 1 },
        // 移除 callout 的 ALWAYS 显示：避免与顶部 badge 形成两个重叠的地址文案。
        // 改为点击标记才弹出（display: BYCLICK 是默认值，这里写出来明示意图）
        callout: {
          content: siteName,
          display: 'BYCLICK',
          fontSize: 12,
          color: '#ffffff',
          bgColor: '#1a1a2e',
          borderRadius: 8,
          borderColor: 'rgba(78,161,255,0.4)',
          borderWidth: 1,
          padding: 6
        }
      }],
      mapPreviewSiteName: siteName
    }
  },

  async _patchMapPreviewAsync(mission) {
    if (this.data.mapPreviewReady) return
    try {
      const mapMeta = await this.getMissionMapLinkMeta(mission)
      const mapData = this.buildMapPreviewData(mission)
      this.setData({
        'mission.mapLinkMeta': mapMeta,
        ...mapData
      })
    } catch (e) {}
  },

  openFirstMapLink() {
    const entries = this.data.mission && this.data.mission.mapLinkMeta && this.data.mission.mapLinkMeta.entries
    if (!entries || !entries.length) return
    const first = entries[0]
    const url = first.query ? `${first.path}?${first.query}` : first.path
    wx.navigateTo({ url })
  },

  openMissionMapLink(e) {
    const path = e.currentTarget.dataset.path
    const query = e.currentTarget.dataset.query || ''
    if (!path) return
    const url = query ? `${path}?${query}` : path
    wx.navigateTo({ url })
  },

  openAgencyDetail() {
    const mission = this.data.mission || {}
    const agencyName = String(mission.launchAgency || '').trim()
    const agencyId = mission.launchAgencyId != null ? String(mission.launchAgencyId).trim() : ''
    const agencyAbbrev = String(mission.launchAgencyAbbrev || (mission.launchServiceProvider && mission.launchServiceProvider.abbrev) || '').trim()
    if (!agencyName && !agencyId) return

    const query = []
    if (agencyId) query.push(`id=${encodeURIComponent(agencyId)}`)
    if (agencyName) query.push(`name=${encodeURIComponent(agencyName)}`)
    if (agencyAbbrev) query.push(`abbrev=${encodeURIComponent(agencyAbbrev)}`)
    wx.navigateTo({
      url: `/subpackages/monitor-pages/agency-detail?${query.join('&')}`
    })
  },

  openBoosterDetail(e) {
    const mission = this.data.mission || {}
    // 多芯火箭点击对应芯的序列号会通过 data-serial 传过来，优先用它
    const dataSerial = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.serial
    const serial = dataSerial || (mission.boosterInfo && mission.boosterInfo.serialNumber) || ''
    if (!serial) return
    // 与族谱入口统一：门控 + 预塞 booster_genealogy 档案 + booster-detail
    return openBoosterEntityDetail(serial)
  },

  /** 「规格」卡 → 族谱火箭型号详情页（与族谱型号卡同门控） */
  openRocketModelDetail() {
    const mission = this.data.mission || {}
    if (mission.rocketConfigId == null) return
    return openRocketModelDetail(mission.rocketConfigId)
  },

  /**
   * 跳转到星舰进度页（progress）并自动打开对应的组合体详情弹窗
   *
   * 星舰任务的 S39（Ship）和 B19（Super Heavy Booster）在 progress 页面已经有
   * 专门的"星舰组合体进展"卡片，包含图片、状态、描述、图集等完整信息。
   * 不在 mission-detail 场景下重新做一遍——直接路由过去，利用已有卡片弹窗。
   *
   * 分发依据 stageKind：
   *   'ship'                → progress?type=ship   → 自动打开 Ship 卡片弹窗
   *   'super_heavy_booster' → progress?type=booster → 自动打开 Booster 卡片弹窗
   *
   * progress 页面 onLoad 会读取 options.type，等 starshipData 加载完成后
   * 自动触发 onStarshipCardTap 模拟点击动作
   */
  openShipDetail(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const serial = ds.serial || ''
    if (!serial) return

    const mission = this.data.mission || {}
    const stages = mission.boosterStages || []
    const idx = (ds.index != null) ? Number(ds.index) : -1
    const stage = (idx >= 0 && stages[idx])
      ? stages[idx]
      : stages.find(s => s && s.serialNumber === serial)
    const kind = (stage && stage.stageKind) || 'ship'
    const progressType = (kind === 'super_heavy_booster') ? 'booster' : 'ship'

    // progress 页在 tabBar 里，优先用 switchTab + onShow 里读取参数的方式
    // 但 switchTab 不支持 query，所以把参数存到全局变量，progress.onShow 读取
    const app = getApp && getApp()
    if (app) {
      app._progressAutoOpenStarship = {
        type: progressType,
        serial: serial,
        setAt: Date.now()
      }
    }
    wx.switchTab({
      url: '/pages/progress/progress',
      fail: () => {
        // 非 tab 路由兜底（一般不会走到）
        wx.navigateTo({
          url: '/pages/progress/progress?type=' + progressType,
          fail: () => {
            wx.showToast({ title: '打开星舰进度失败', icon: 'none' })
          }
        })
      }
    })
  },

  retryLoad() {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const route = this._entryRoute || resolveMissionDetailRoute((currentPage && currentPage.options) || {})
    const { detailType, id } = route
    if (!id) return
    this.loadMissionDetail(id, detailType)
  },

  /** 原生三点下拉刷新：重读云缓存任务详情，绝不直接触发 LL2 */
  onScrollRefresh() {
    this._runMissionDetailPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runMissionDetailPullRefresh()
  },

  _runMissionDetailPullRefresh(key) {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const route = this._entryRoute || resolveMissionDetailRoute((currentPage && currentPage.options) || {})
    const { detailType, id } = route
    runPullRefresh(this, () => {
      if (!id) return Promise.resolve()
      return this.loadMissionDetail(id, detailType, { silent: true })
    }, key)
  },

  // hero 图加载失败时同样等 cloud media map 到位再 fuzzy，
  // 避免与首页卡片同样的时序竞态（详情页恰好打开得晚才"碰巧"能拿到真实 URL）
  async onHeroImageError() {
    const mission = this.data.mission
    if (!mission) return

    try {
      await loadCloudMediaMap()
    } catch (err) {}

    const latestMission = this.data.mission
    if (!latestMission || latestMission.id !== mission.id) return

    const currentImage = latestMission.rocketImage
    const fuzzyImage = resolveMissionRocketImage(
      currentImage || '',
      latestMission.rocketName,
      latestMission.rocketConfiguration,
      true
    )
    const fallbackImage = resolveMediaUrl(DEFAULT_ROCKET_IMAGE, '')
    const nextImage = fuzzyImage && fuzzyImage !== currentImage ? fuzzyImage : fallbackImage

    if (nextImage && nextImage !== currentImage) {
      this.setData({
        'mission.rocketImage': nextImage,
        shareImage: nextImage
      })
      this.ensureShareImageHttpUrl(nextImage)
    }
  },

  /** media_assets 就绪后强制对齐详情头图（与首页列表/倒计时同源） */
  _refreshMissionRocketImageFromMediaMap() {
    const mission = this.data.mission
    if (!mission || !mission.rocketName) return
    const nextImage = resolveMissionRocketImage(
      mission.rocketImage || '',
      mission.rocketName,
      mission.rocketConfiguration,
      true
    )
    if (!shouldReplaceRocketImage(mission.rocketImage, nextImage)) return
    this.setData({
      'mission.rocketImage': nextImage,
      shareImage: nextImage
    })
    this.ensureShareImageHttpUrl(nextImage)
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        // navigateBack 偶发失败兜底到下一层（search 路径或首页 tab）
        fail: () => this._fallbackGoBack()
      })
      return
    }
    this._fallbackGoBack()
  },

  /**
   * 页面栈无上一页时的兜底跳转链
   *
   * 场景：用户从微信群/朋友圈分享卡片冷启动进入详情页，页面栈只有 1 层，
   * navigateBack 无法执行。原来的 switchTab → reLaunch 链在 reLaunch 命中
   * tabBar 页面时会失败（wx.reLaunch 不支持 tabBar 页面），导致用户看似
   * "返回按钮无反应"。这里用多层 switchTab 串联，确保一定回到首页。
   *
   * 回退优先级：
   *   1. fromSearch = true  → 回搜索页（reLaunch 可行，因为 search 非 tabBar）
   *   2. switchTab 到首页    → 命中 tabBar 的正确 API
   *   3. 兜底：再试一次 switchTab（覆盖极端的 tabBar 未就绪情况）
   *   4. 完全失败：toast 提示
   */
  _fallbackGoBack() {
    if (this.data.fromSearch) {
      wx.reLaunch({
        url: '/pages/search/search',
        fail: () => this._switchToHomeTab()
      })
      return
    }
    this._switchToHomeTab()
  },

  _switchToHomeTab() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {
        // tabBar 未初始化之类的极端情况，再试一次
        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index',
            fail: () => {
              try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
            }
          })
        }, 50)
      }
    })
  },

  onShareAppMessage() {
    const mission = this.data.mission
    if (!mission) {
      return {
        title: '发射任务详情 | 火星探索日志',
        path: '/pages/index/index',
        imageUrl: this.data.shareImage
      }
    }

    const result = buildMissionShareOptions({
      mission,
      detailType: this.data.detailType,
      title: this.data.shareTitle,
      imageUrl: this.data.shareImage,
      fallbackTitle: '发射任务详情 | 火星探索日志',
      fallbackPath: '/pages/index/index',
      mode: 'app'
    })
    // 有权益用户分享写新 sst（接收者 24h 免门控看回放）；窗口内接收者转发继承原 sst
    result.path = withShareStampPath(result.path, this)
    return result
  },

  onShareTimeline() {
    const mission = this.data.mission
    const result = buildMissionShareOptions({
      mission,
      detailType: this.data.detailType,
      title: this.data.shareTitle,
      imageUrl: this.data.shareImage,
      fallbackTitle: '发射任务详情 | 火星探索日志',
      mode: 'timeline'
    })
    result.query = withShareStampQuery(result.query, this)
    return result
  }
})
