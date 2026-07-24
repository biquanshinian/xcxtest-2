// 打包锚点：progress-lazy.js 仅被主包 progress.js require.async 引用，
// 无同分包同步引用时会被"过滤无依赖文件"剔出分包导致异步加载失败
require('./utils/progress-lazy.js')
const { loadCloudMediaMap } = require('../../utils/image-config.js')
const { isVideoUrl, optimizeImageUrl } = require('../../utils/cos-url.js')
const { enrichVideoMediaItem, eventVideoAdUnlockId, playEventVideo, saveEventOriginalVideo } = require('./utils/event-video.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')
const { buildLl2ImageChain, advanceImageFallback, proxiedImageUrl } = require('../../utils/ll2-image.js')
const { fetchLiveStatusBatch, parseLiveStatus } = require('./utils/live-status.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('./utils/single-page.js')
const pageBase = require('../../utils/page-base.js')
const { pickEventShareImageUrl, resolveTweetAccountAvatarUrl, resolveEventAuthorAvatarUrl } = require('../shared/utils/event-share-image.js')
const { warmEventShareImage } = require('../../utils/event-share-image.js')
try { warmEventShareImage() } catch (e) {}
const { gateCheck, isMembershipEnabled, getMembershipState, isPro, hasPurchased, canUsePaidCloudSync, canPrefetchVideoSync, canSaveOriginalVideoSync, isProSync } = require('../../utils/membership.js')
const { getMemberPolicy, getMemberPolicySync } = require('../../utils/member-policy.js')
const {
  getNsfStarshipChecklistFromDB,
  getStarshipStatusFromDB,
  fetchLl2LaunchTimeline,
  fetchLl2LaunchUpdates
} = require('../../utils/api-app-services.js')
const { getUpcomingStarshipMissions } = require('../../utils/api-launch-list.js')
const { attachMissionDetailMeta, buildMissionDetailUrl } = require('../../utils/index-mission-nav.js')
const { filterExpiredMissions } = require('../../utils/index-page-helpers.js')
const {
  formatDate,
  resolveMissionRocketImage,
  shouldReplaceRocketImage,
  isDefaultRocketSrc
} = require('../../utils/util.js')
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../utils/agency-logo-overrides.js')
const { normalizeLl2TimelineList } = require('./utils/ll2-launch-timeline.js')
const { isFeatureEnabled } = require('../../utils/feature-flags.js')

/** 清单/时间线/动态追踪分享兜底：SpaceX logo（禁止落到 default 火箭占位图） */
const STARSHIP_PAGE_SHARE_FALLBACK =
  optimizeImageUrl(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL, 'thumb') || SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL

/** 可用的任务卡片火箭配置图（排除 default.jpg 占位） */
function pickUsableMissionRocketShareImage(url) {
  const u = String(url || '').trim()
  if (!u || isDefaultRocketSrc(u)) return ''
  return u
}

/** 从星舰任务卡列表取分享图：优先匹配 launchId，否则取首张可用配置图 */
function pickShareImageFromStarshipMissions(missions, launchId) {
  const list = Array.isArray(missions) ? missions : []
  const wantId = launchId != null ? String(launchId).trim() : ''
  if (wantId) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m || String(m.id) !== wantId) continue
      const hit = pickUsableMissionRocketShareImage(m.rocketImage || m.image)
      if (hit) return hit
    }
  }
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const hit = pickUsableMissionRocketShareImage(m && (m.rocketImage || m.image))
    if (hit) return hit
  }
  return ''
}
const { getSystemInfo } = require('../../utils/system.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { translateAgencyName } = require('../../utils/space-terms-i18n.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { parseShareStamp, SHARE_GATE_TTL_MS } = require('./utils/share-gate.js')
const {
  saveImageToAlbum: saveImageToAlbumUtil,
  handleEventImageLongPress,
  closeEventImageSavePicker,
  toggleEventImageSaveSelect,
  selectAllEventImageSave,
  confirmEventImageSavePicker,
  parseLongPressDataset,
  previewEventImages
} = require('./utils/event-image-save.js')

function isNsfStarshipMissionCard(mission) {
  if (!mission || typeof mission !== 'object') return false
  const hay = [mission.rocketName, mission.name, mission.missionName]
    .filter(Boolean)
    .join(' ')
  return /starship|super\s*heavy|星舰|超重/i.test(hay)
}

/**
 * 与首页首屏盖章 / 任务详情头图同一套：media map 就绪后按火箭名强制重算配置图。
 * 列表内存快照可能在 map 未加载时盖过 default/空图，不重算则卡片左侧一直空白，
 * 而点进详情会重新 resolve 所以头图正常。
 */
function stampNsfStarshipMissionRocketImage(mission) {
  if (!mission || typeof mission !== 'object') return mission
  const stamped = mission.rocketImage || mission.image || ''
  const rebuilt = resolveMissionRocketImage(
    stamped,
    mission.rocketName,
    mission.rocketConfiguration,
    true
  )
  if (!rebuilt || !shouldReplaceRocketImage(stamped, rebuilt)) return mission
  return { ...mission, rocketImage: rebuilt, image: rebuilt }
}

function normalizeNsfStarshipMissionCards(list) {
  return filterExpiredMissions(Array.isArray(list) ? list : [])
    .filter(isNsfStarshipMissionCard)
    .map((mission, index) => {
      const stampedMission = stampNsfStarshipMissionRocketImage(mission)
      // 保留首页 mapLaunchToListItem 的 recoveryIcons / recoveryTag* 等字段原样透传
      const card = attachMissionDetailMeta({
        ...stampedMission,
        _wxkey: `nsf-ss-${index}-${stampedMission && stampedMission.id != null ? stampedMission.id : ''}`,
        formattedTime: stampedMission && stampedMission.launchTime
          ? formatDate(stampedMission.launchTime, 'MM月DD日 HH:mm')
          : '时间未知',
        recoveryIcons: Array.isArray(stampedMission.recoveryIcons) ? stampedMission.recoveryIcons : [],
        recoveryTagText: stampedMission.recoveryTagText || '',
        recoveryTagClass: stampedMission.recoveryTagClass || ''
      }, {
        id: stampedMission && stampedMission.id,
        detailType: 'upcoming'
      })
      return card
    })
}

const NSF_CHECKLIST_GATE_PRODUCT_ID = 'starship_flight_checklist'
/** 事件更新「查看更多」全量列表：非会员首屏免费条数，触底再门控 */
const DEFAULT_FREE_EVENT_LIST_LIMIT = 5
const EVENT_LIST_PAGE_LIMIT = 20

function formatEventTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 与云函数 userDataGateway.publishedAtToBeijingYmd 一致 */
function publishedAtToBeijingYmd(p) {
  if (p == null || p === '') return ''
  const offset = 8 * 60 * 60 * 1000
  let ms = NaN
  if (typeof p === 'number' && !isNaN(p)) {
    ms = p
  } else if (typeof p === 'string') {
    const s = p.trim()
    if (!s) return ''
    const d = new Date(s)
    if (!isNaN(d.getTime())) ms = d.getTime()
    else if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    else return ''
  } else if (p instanceof Date) {
    ms = p.getTime()
  } else if (typeof p.getTime === 'function') {
    ms = p.getTime()
  } else if (typeof p.seconds === 'number') {
    ms = p.seconds * 1000 + Math.floor((p.nanoseconds || 0) / 1e6)
  }
  if (isNaN(ms)) return ''
  const cn = new Date(ms + offset)
  return cn.toISOString().slice(0, 10)
}

function todayBeijingYmd() {
  const d = new Date()
  const cn = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return cn.toISOString().slice(0, 10)
}

const STARSHIP_SHARED_TTL = 10 * 60 * 1000

/** 优先复用 progress 页写入的全局共享星舰状态（10 分钟内新鲜），未命中再走库读 */
function getSharedStarshipStatus() {
  try {
    const app = getApp()
    const shared = app && app.globalData && app.globalData.starshipStatus
    if (shared && shared.data && Date.now() - (shared.fetchedAt || 0) < STARSHIP_SHARED_TTL) {
      return Promise.resolve(shared.data)
    }
  } catch (e) {}
  return getStarshipStatusFromDB()
}

/**
 * 安全解码 onLoad options 参数：跳转方 buildUrl 会 encodeURIComponent（逗号→%2C、中文 label 等），
 * 而微信不保证自动解码；解码失败（非法编码）时原样返回
 */
function safeDecodeOption(value) {
  const str = value == null ? '' : String(value)
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return str
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/progress/progress',

  data: {
    loading: true,
    avatarError: false,
    errorMessage: '',
    item: null,
    shareImage: '',
    shareTitle: '事件更新 | 火星探索日志',
    navTitle: '事件详情',
    detailScrollTop: 0,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    enableEventVideo: false,
    enableLiveEntry: false,
    listMode: false,
    listAllMode: false,
    listNoMore: false,
    listLoadingMore: false,
    scrollRefreshing: false,
    items: [],
    listDayHint: '',
    showEventShareSheet: false,
    selectedEventShareId: '',
    showEventImageSavePicker: false,
    eventImageSaveThumbs: [],
    eventImageSaveOriginals: [],
    eventImageSaveSelected: [],
    loadingHint: '事件详情加载中…',
    pageMode: '',
    nsfChecklistItems: [],
    nsfChecklistProgressDone: 0,
    nsfChecklistProgressTotal: 0,
    nsfChecklistProgressPercent: 0,
    nsfChecklistSyncing: false,
    nsfChecklistError: '',
    nsfChecklistSourceLastFetch: '',
    nsfChecklistUpdatedAtMs: 0,
    nsfStarshipMissions: [],

    ll2DetailTimelineRows: [],
    ll2DetailLaunchUpdates: [],
    detailLl2Refreshing: false,

    // 飞行剖面迷你演示（仅 ll2_timeline 详情页）
    enableMissionSim: false,
    flightDemoTimeline: [],
    flightDemoMissionName: '',
    pageVisible: true,

    ll2EventCountdown: { days: '00', hours: '00', minutes: '00', seconds: '00', isExpired: false },
    ll2DetailedData: null,
    ll2DetailedLoading: false,

    // 「翻译/原文」按钮状态（任务概述 / 更新日志 / 星舰动态追踪 各自独立）
    evtDescTranslated: false,
    evtDescTranslating: false,
    updTranslated: false,
    updTranslating: false,
    luTranslated: false,
    luTranslating: false,
    descI18n: { eventDesc: '', updates: [], launchUpdates: [] }
  },

  /** 任务概述「翻译/原文」 */
  onToggleEventDescTranslate() {
    if (this.data.evtDescTranslating) return
    const item = this.data.item || {}
    togglePageTranslation(this, {
      switchKey: 'evtDescTranslated',
      loadingKey: 'evtDescTranslating',
      fields: [{ path: 'descI18n.eventDesc', text: item.description || '' }]
    })
  },

  /** 更新日志「翻译/原文」（LL2 事件详细数据） */
  onToggleUpdatesTranslate() {
    if (this.data.updTranslating) return
    const updates = (this.data.ll2DetailedData && this.data.ll2DetailedData.updates) || []
    const fields = []
    updates.forEach((u, i) => {
      if (u && u.comment) fields.push({ path: 'descI18n.updates[' + i + ']', text: u.comment })
    })
    if (!fields.length) return
    togglePageTranslation(this, {
      switchKey: 'updTranslated',
      loadingKey: 'updTranslating',
      fields
    })
  },

  /** 星舰动态追踪「翻译/原文」 */
  onToggleLaunchUpdatesTranslate() {
    if (this.data.luTranslating) return
    const rows = this.data.ll2DetailLaunchUpdates || []
    const fields = []
    rows.forEach((u, i) => {
      if (u && u.comment) fields.push({ path: 'descI18n.launchUpdates[' + i + ']', text: u.comment })
    })
    if (!fields.length) return
    togglePageTranslation(this, {
      switchKey: 'luTranslated',
      loadingKey: 'luTranslating',
      fields
    })
  },

  async readStarshipLl2Prefs() {
    const data = await getSharedStarshipStatus().catch(() => null)
    const manualId = (data && typeof data.ll2TrackedLaunchId === 'string')
      ? String(data.ll2TrackedLaunchId).trim()
      : ''
    const enabled = !(data && data.showLaunchLibraryUpdates === false)
    return { manualId, enabled }
  },

  async loadLl2TimelineDetailPage(opts = {}) {
    const silent = opts.silent === true
    const { manualId, enabled } = await this.readStarshipLl2Prefs()
    if (!enabled) {
      if (!silent) {
        this.setData({
          loading: false,
          errorMessage: '未开启',
          pageMode: 'll2_timeline',
          navTitle: '星舰飞行时间线',
          shareTitle: '星舰飞行时间线 | 火星探索日志',
          listMode: false,
          items: [],
          item: null
        })
      }
      return
    }
    const autoStarship = !manualId
    if (!silent) {
      this.setData({
        loading: true,
        errorMessage: '',
        pageMode: 'll2_timeline',
        navTitle: '星舰飞行时间线',
        shareTitle: '星舰飞行时间线 | 火星探索日志',
        loadingHint: '加载中…',
        listMode: false,
        items: [],
        item: null
      })
    } else {
      this.setData({ detailLl2Refreshing: true })
    }
    try {
      const [res, starshipRes] = await Promise.all([
        fetchLl2LaunchTimeline(manualId, { autoStarship }),
        getUpcomingStarshipMissions(10, 0).catch(() => ({ list: [] }))
      ])
      const rows = normalizeLl2TimelineList(res.timeline || [])
      const missions = normalizeNsfStarshipMissionCards(starshipRes && starshipRes.list)
      this._starshipShareMissions = missions
      this._starshipShareLaunchId = res.launchId || ''
      this._starshipShareLaunchName = res.launchName || res.resolvedLaunchName || ''
      const demoTl = this._buildFlightDemoTimeline(rows)
      this.setData({
        loading: false,
        detailLl2Refreshing: false,
        ll2DetailTimelineRows: rows,
        flightDemoTimeline: demoTl,
        flightDemoMissionName: this._starshipShareLaunchName || '星舰任务'
      })
      if (rows.length > 0 && !this._missionSimFlagChecked) {
        this._missionSimFlagChecked = true
        isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then((on) => {
          if (on) this.setData({ enableMissionSim: true })
        }).catch(() => {})
      }
      this._syncStarshipPageShareImage({
        missions,
        launchId: this._starshipShareLaunchId,
        launchName: this._starshipShareLaunchName
      })
    } catch (e) {
      const msg = isPermissionDenied(e)
        ? getPermissionDeniedMessage()
        : ((e && e.message) ? String(e.message) : '加载失败')
      this.setData({
        loading: false,
        detailLl2Refreshing: false,
        flightDemoTimeline: [],
        flightDemoMissionName: ''
      })
      if (silent) wx.showToast({ title: msg, icon: 'none' })
      else this.setData({ errorMessage: msg })
      // 失败时仍用 SpaceX logo 兜底，避免落到 default 火箭图
      this._syncStarshipPageShareImage({})
    }
  },

  /** LL2 行 → 飞行剖面演示 payload */
  _buildFlightDemoTimeline(rows) {
    const list = Array.isArray(rows) ? rows : (this.data.ll2DetailTimelineRows || [])
    return list.map((r) => ({
      t: r.sortKey,
      label: r.title,
      desc: r.description,
      tLabel: r.timeLabel
    }))
  },

  /** 飞行剖面完整演示页：与指挥室同一 productId（会员 / 看广告解锁） */
  async openFlightDemo() {
    if (!this.data.enableMissionSim) return
    const payload = this.data.flightDemoTimeline || []
    if (!payload.length) return
    if (this._flightDemoGatePending) return
    this._flightDemoGatePending = true
    let allowed = false
    try {
      allowed = await gateCheck('mission_sim', '飞行剖面演示')
    } finally {
      this._flightDemoGatePending = false
    }
    if (!allowed) return
    const name = String(this.data.flightDemoMissionName || this._starshipShareLaunchName || '星舰任务').trim()
    const missionId = this._starshipShareLaunchId != null ? String(this._starshipShareLaunchId).trim() : ''
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    }
    const queryParts = []
    if (missionId) {
      queryParts.push(`id=${encodeURIComponent(missionId)}`)
      queryParts.push('type=upcoming')
    }
    if (name) queryParts.push(`name=${encodeURIComponent(name.slice(0, 80))}`)
    const query = queryParts.length ? `?${queryParts.join('&')}` : ''
    wx.navigateTo({
      url: '/subpackages/mission-sim/flight-demo' + query,
      success(res) {
        try {
          res.eventChannel.emit('flightDemoContext', {
            name,
            rows: payload,
            id: missionId,
            detailType: 'upcoming'
          })
        } catch (e) {}
      }
    })
  },

  async loadLl2LaunchUpdatesDetailPage(opts = {}) {
    const silent = opts.silent === true
    const { manualId, enabled } = await this.readStarshipLl2Prefs()
    if (!enabled) {
      if (!silent) {
        this.setData({
          loading: false,
          errorMessage: '未开启',
          pageMode: 'll2_launch_updates',
          navTitle: '星舰动态追踪',
          shareTitle: '星舰动态追踪 | 火星探索日志',
          listMode: false,
          items: [],
          item: null
        })
      }
      return
    }
    const autoStarship = !manualId
    if (!silent) {
      this.setData({
        loading: true,
        errorMessage: '',
        pageMode: 'll2_launch_updates',
        navTitle: '星舰动态追踪',
        shareTitle: '星舰动态追踪 | 火星探索日志',
        loadingHint: '加载中…',
        listMode: false,
        items: [],
        item: null
      })
    } else {
      this.setData({ detailLl2Refreshing: true })
    }
    try {
      const [res, starshipRes] = await Promise.all([
        fetchLl2LaunchUpdates(manualId, 48, { autoStarship }),
        getUpcomingStarshipMissions(10, 0).catch(() => ({ list: [] }))
      ])
      const list = (res.list || []).map((item) => ({
        ...item,
        timeLabel: formatEventTime(item.createdOn)
      }))
      const missions = normalizeNsfStarshipMissionCards(starshipRes && starshipRes.list)
      this._starshipShareMissions = missions
      this._starshipShareLaunchId = res.launchId || ''
      this._starshipShareLaunchName = res.resolvedLaunchName || res.launchName || ''
      this.setData({
        loading: false,
        detailLl2Refreshing: false,
        ll2DetailLaunchUpdates: list,
        // 列表刷新后清掉旧译文（条目/顺序可能已变化）
        luTranslated: false,
        'descI18n.launchUpdates': []
      })
      this._syncStarshipPageShareImage({
        missions,
        launchId: this._starshipShareLaunchId,
        launchName: this._starshipShareLaunchName
      })
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      this.setData({ loading: false, detailLl2Refreshing: false })
      if (silent) wx.showToast({ title: raw, icon: 'none' })
      else this.setData({ errorMessage: raw })
      this._syncStarshipPageShareImage({})
    }
  },

  onRefreshLl2TimelineDetail() {
    if (!this._ll2TimelineMode || this.data.detailLl2Refreshing) return
    this.loadLl2TimelineDetailPage({ silent: true })
  },

  onRefreshLl2LaunchUpdatesDetail() {
    if (!this._ll2LaunchUpdatesMode || this.data.detailLl2Refreshing) return
    this.loadLl2LaunchUpdatesDetailPage({ silent: true })
  },

  /** LL2 事件详情：从 spacex_launch_stats 的 upcomingOrbitalEvents 或 space_devs_cache 拿到事件，
   *  normalize 成 event-detail 期望的 item 喂给默认渲染（复用 detail-card glass-card 样式）
   */
  async loadLl2EventDetailPage(eventId) {
    this.setData({
      loading: true,
      errorMessage: '',
      pageMode: 'll2_event',
      navTitle: '事件详情',
      shareTitle: '在轨事件详情 | 火星探索日志',
      listMode: false,
      items: [],
      item: null,
      evtDescTranslated: false,
      evtDescTranslating: false,
      updTranslated: false,
      updTranslating: false,
      descI18n: { eventDesc: '', updates: [], launchUpdates: [] }
    })
    this._textTranslateCache = null
    this._ll2EventId = eventId ? String(eventId) : ''
    if (!eventId) {
      this.setData({ loading: false, errorMessage: '缺少事件 ID' })
      return
    }
    try {
      const db = wx.cloud.database()
      let raw = null
      let heroPassed = null

      // 监控页卡面图直传：秒开头图，并优先用已格式化的 raw
      try {
        const app = getApp()
        const passed = app && app._ll2EventHeroImage
        if (passed && String(passed.id) === String(eventId)) {
          heroPassed = {
            src: passed.src || '',
            fallbacks: Array.isArray(passed.fallbacks) ? passed.fallbacks.slice() : []
          }
          if (passed.raw && passed.raw.id != null) raw = passed.raw
          app._ll2EventHeroImage = null
        }
      } catch (e) {}

      if (!raw) {
        try {
          const sxRes = await db.collection('spacex_launch_stats').doc('spacex_official_live').get()
          const evList = sxRes && sxRes.data && Array.isArray(sxRes.data.upcomingOrbitalEvents) ? sxRes.data.upcomingOrbitalEvents : []
          raw = evList.find(ev => String(ev.id) === String(eventId)) || null
        } catch (e) {}
      }

      if (!raw) {
        try {
          const cacheRes = await db.collection('space_devs_cache')
            .where({ url: db.command.in(['/events/upcoming/']) })
            .limit(5)
            .get()
          const docs = (cacheRes && cacheRes.data) || []
          for (const doc of docs) {
            const list = (doc && doc.data && Array.isArray(doc.data.results)) ? doc.data.results
              : (Array.isArray(doc && doc.results) ? doc.results : [])
            const found = list.find(ev => String(ev.id) === String(eventId))
            if (found) {
              raw = this._normalizeRawLl2Event(found)
              break
            }
          }
        } catch (e) {}
      }

      if (!raw) {
        this.setData({ loading: false, errorMessage: '该事件不存在或已过期' })
        return
      }

      const item = this._buildLl2EventItem(raw)
      if (heroPassed && heroPassed.src) {
        if (heroPassed.src !== item.heroImageUrl) {
          const fb = [item.heroImageUrl].concat(item.imageFallbacks || []).filter((u, i, arr) => {
            return u && u !== heroPassed.src && arr.indexOf(u) === i
          })
          item.heroImageUrl = heroPassed.src
          item.imageFallbacks = fb.concat(heroPassed.fallbacks || []).filter((u, i, arr) => {
            return u && u !== item.heroImageUrl && arr.indexOf(u) === i
          })
        } else if (heroPassed.fallbacks && heroPassed.fallbacks.length) {
          item.imageFallbacks = (item.imageFallbacks || []).concat(heroPassed.fallbacks).filter((u, i, arr) => {
            return u && u !== item.heroImageUrl && arr.indexOf(u) === i
          })
        }
      }
      const titleText = item.title || '在轨事件'
      this.setData({
        loading: false,
        item,
        navTitle: '事件详情',
        shareTitle: `${titleText} | 火星探索日志`
      })
      this._syncLl2EventShareImage(item)
      this._scrollDetailToTop()
      this.startLl2EventCountdown()
      this.fetchLl2EventDetailedData(eventId)
    } catch (e) {
      this.setData({ loading: false, errorMessage: (e && e.message) || '加载失败' })
    }
  },

  async fetchLl2EventDetailedData(eventId) {
    if (!eventId) return
    this.setData({ ll2DetailedLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'll2EventDetail', eventId: String(eventId) }
      })
      const result = res && res.result
      if (result && result.success && result.data) {
        const data = result.data
        // 参与机构名称走词典恒中文（词典未命中保留英文原名）
        if (Array.isArray(data.agencies)) {
          data.agencies = data.agencies.map((a) => {
            if (!a) return a
            const zh = translateAgencyName(a.name, a.abbrev)
            return zh ? { ...a, name: zh } : a
          })
        }
        this.setData({ ll2DetailedData: data, ll2DetailedLoading: false, updTranslated: false, 'descI18n.updates': [] })
      } else {
        this.setData({ ll2DetailedLoading: false })
      }
    } catch (e) {
      this.setData({ ll2DetailedLoading: false })
    }
  },

  /** 点击直播链接 → 复制到剪贴板（小程序受限不能直接打开外网） */
  onLl2WebcastTap() {
    const url = this.data.item && this.data.item.webcastUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '直播链接已复制', icon: 'none' })
    })
  },

  /** 在轨事件 hero 图预览 */
  onLl2HeroPreview() {
    const item = this.data.item || {}
    const list = item.imageUrls || []
    const url = item.heroImageUrl || list[0]
    if (!url) return
    const urls = list.length ? list : [url]
    wx.previewImage({ urls, current: url })
  },

  /** 在轨事件头图失败：沿代理/原链推进（与监控卡同源） */
  onLl2HeroImageError() {
    const item = this.data.item || {}
    const advanced = advanceImageFallback(item.heroImageUrl, item.imageFallbacks)
    this.setData({
      'item.heroImageUrl': advanced.next,
      'item.imageFallbacks': advanced.remaining
    })
    this._syncLl2EventShareImage(Object.assign({}, item, {
      heroImageUrl: advanced.next,
      imageFallbacks: advanced.remaining
    }))
  },

  _isLocalSharePath(path) {
    const s = String(path || '')
    if (!s) return false
    if (s.indexOf('wxfile://') === 0) return true
    if (/^http:\/\/(tmp|usr)\b/i.test(s)) return true
    if (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH && s.indexOf(wx.env.USER_DATA_PATH) === 0) {
      return true
    }
    return !/^https?:\/\//i.test(s)
  },

  /**
   * 在轨事件分享缩略图：用该事件对应配图（非默认火箭图）。
   * 本地缓存命中优先；外链走 Worker 代理。
   */
  _pickLl2EventShareImage(item) {
    if (!item || typeof item !== 'object') return ''
    const hero = String(item.heroImageUrl || '').trim()
    const urls = Array.isArray(item.imageUrls) ? item.imageUrls : []
    const fallbacks = Array.isArray(item.imageFallbacks) ? item.imageFallbacks : []
    const seen = {}
    const candidates = []
    ;[hero].concat(urls).concat(fallbacks).forEach((u) => {
      const s = String(u || '').trim()
      if (!s || seen[s]) return
      seen[s] = true
      candidates.push(s)
    })
    for (let i = 0; i < candidates.length; i++) {
      const pick = candidates[i]
      if (this._isLocalSharePath(pick)) return pick
      const proxied = proxiedImageUrl(pick)
      return proxied || pick
    }
    return ''
  },

  _syncLl2EventShareImage(item) {
    const url = this._pickLl2EventShareImage(item)
    if (!url) {
      if (this.data.shareImage) this.setData({ shareImage: '' })
      this._shareImageSourceUrl = ''
      return
    }
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    this.ensureShareImageHttpUrl(url)
  },

  /** 网络图落到本地临时路径，规避 iOS 朋友圈远程缩略图加载失败 */
  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    const trimmed = imageUrl.trim()
    if (!trimmed) return
    if (this._isLocalSharePath(trimmed)) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage) return
    this._shareImageSourceUrl = trimmed
    const self = this
    wx.getImageInfo({
      src: trimmed,
      success(res) {
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail() {
        if (self._shareImageSourceUrl === trimmed) self._shareImageSourceUrl = ''
      }
    })
  },

  /** 把 LL2 events list 模式的原始字段，转成 upcomingOrbitalEvents 同款字段 */
  _normalizeRawLl2Event(ev) {
    const image = ev.image && (ev.image.image_url || ev.image.thumbnail_url || '')
    const vid = Array.isArray(ev.vid_urls) && ev.vid_urls.length ? ev.vid_urls[0] : null
    return {
      id: ev.id,
      slug: ev.slug || '',
      name: ev.name || '',
      typeName: ev.type && ev.type.name ? ev.type.name : '',
      date: ev.date || '',
      dateMs: ev.date ? Date.parse(ev.date) : 0,
      location: ev.location || '',
      description: ev.description || '',
      imageUrl: image || '',
      webcastUrl: vid && vid.url ? vid.url : '',
      webcastTitle: vid && vid.title ? vid.title : '',
      webcastPublisher: vid && vid.publisher ? vid.publisher : '',
      precision: (ev.date_precision && ev.date_precision.name) || ''
    }
  },

  /** 把 normalized LL2 event 转成专用渲染所需结构（不再 emoji 拼字符串） */
  _buildLl2EventItem(ev) {
    const dateMs = ev.dateMs || (ev.date ? Date.parse(ev.date) : 0)
    const dateText = dateMs ? formatEventTime(new Date(dateMs).toISOString()) : (ev.date || '')
    const isoDate = dateMs ? new Date(dateMs).toISOString() : ''

    // 倒计时（与监控页同款逻辑，独立计算一份给详情页）
    let countdownText = ''
    let countdownClass = ''
    if (dateMs) {
      const diff = dateMs - Date.now()
      const absDay = Math.floor(Math.abs(diff) / 86400000)
      const absHour = Math.floor((Math.abs(diff) % 86400000) / 3600000)
      const absMin = Math.floor((Math.abs(diff) % 3600000) / 60000)
      if (diff <= 0) {
        countdownText = '进行中 / 已开始'
        countdownClass = 'live'
      } else if (absDay >= 1) {
        countdownText = `${absDay} 天 ${absHour} 小时`
      } else if (absHour >= 1) {
        countdownText = `${absHour} 小时 ${absMin} 分`
        countdownClass = 'soon'
      } else {
        countdownText = `${Math.max(1, absMin)} 分钟`
        countdownClass = 'soon'
      }
    }

    const imageChain = buildLl2ImageChain(ev.imageUrl)
    const imageUrls = imageChain.length ? imageChain.slice() : (ev.imageUrl ? [ev.imageUrl] : [])

    return {
      _id: `ll2_event_${ev.id}`,
      title: ev.name || '在轨事件',
      typeName: ev.typeName || '',
      typeKey: (ev.typeName || '').toLowerCase().replace(/\s+/g, '-'),
      dateText,
      isoDate,
      location: ev.location || '',
      description: ev.description || '',
      heroImageUrl: imageChain[0] || ev.imageUrl || '',
      imageFallbacks: imageChain.slice(1),
      imageUrls,
      webcastUrl: ev.webcastUrl || '',
      webcastTitle: ev.webcastTitle || '',
      webcastPublisher: ev.webcastPublisher || '',
      countdownText,
      countdownClass,
      _ll2EventRaw: ev
    }
  },

  computeNsfChecklistProgress(items) {
    const list = Array.isArray(items) ? items : []
    const total = list.length
    const done = list.filter((row) => row && row.done).length
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    return {
      nsfChecklistProgressDone: done,
      nsfChecklistProgressTotal: total,
      nsfChecklistProgressPercent: percent
    }
  },

  /**
   * 构建清单分享路径的 sst 时间戳参数（'&sst=…' 或空串）。
   * 有权益 → 新时间戳（重开 24 小时免门控窗口）；无权益 → 继承进入时的时间戳（窗口不重置）。
   */
  _nsfShareStampQuery() {
    const ms = this._nsfGatePassed ? Date.now() : (this._shareSst || 0)
    return ms ? '&sst=' + ms.toString(36) : ''
  },

  /** 「按账号查看」列表分享的 sst 参数，规则同上（权益静默预取到 _sourceGatePassed） */
  _sourceShareStampQuery() {
    const ms = this._sourceGatePassed ? Date.now() : (this._shareSst || 0)
    return ms ? '&sst=' + ms.toString(36) : ''
  },

  /** 静默预取「按账号查看」权益（不弹开通引导），供分享回调同步读取 */
  async _refreshSourceGatePassedSilently() {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) {
        this._sourceGatePassed = true
        return
      }
      const state = await getMembershipState()
      this._sourceGatePassed = isPro(state) || hasPurchased(state, 'starship_progress_event_source')
    } catch (e) {
      this._sourceGatePassed = false
    }
    // 自身有权益：无需限时提示，隐藏倒计时胶囊
    if (this._sourceGatePassed && this.data.shareGateExpireAt) {
      this.setData({ shareGateExpireAt: 0 })
    }
  },

  /**
   * 静默判断当前用户自身是否有查看清单的权益（不弹任何开通引导）。
   * 用于分享免门控进入时决定「再分享出去的卡片是否继续携带免门控标记」：
   * 只有自身有权益（会员/已购/会员功能关闭）的用户，分享卡片才带新时间戳。
   */
  async _refreshNsfGatePassedSilently() {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) {
        this._nsfGatePassed = true
        return
      }
      const state = await getMembershipState()
      this._nsfGatePassed = isPro(state) || hasPurchased(state, NSF_CHECKLIST_GATE_PRODUCT_ID)
    } catch (e) {
      this._nsfGatePassed = false
    }
    // 自身有权益：无需限时提示，隐藏倒计时胶囊
    if (this._nsfGatePassed && this.data.shareGateExpireAt) {
      this.setData({ shareGateExpireAt: 0 })
    }
  },

  async loadNsfChecklistPage() {
    if (this._nsfShareEntry) {
      // 会员分享进入：免门控放行；后台静默确认自身权益（决定转发是否继续免门控）
      this._nsfGatePassed = false
      this._refreshNsfGatePassedSilently()
    } else {
      const allowed = await gateCheck(NSF_CHECKLIST_GATE_PRODUCT_ID, '星舰飞行检查清单')
      if (!allowed) {
        this._nsfGatePassed = false
        this.setData({
          loading: false,
          errorMessage: '需解锁后查看',
          navTitle: '星舰飞行检查清单',
          shareTitle: '星舰飞行检查清单 | 火星探索日志',
          pageMode: 'nsf_checklist'
        })
        return
      }
      this._nsfGatePassed = true
    }

    this.setData({
      loading: true,
      errorMessage: '',
      pageMode: 'nsf_checklist',
      navTitle: '星舰飞行检查清单',
      shareTitle: '星舰飞行检查清单 | 火星探索日志',
      loadingHint: '清单加载中…',
      listMode: false,
      items: [],
      item: null,
      listDayHint: ''
    })

    try {
      const [nsf, starshipRes] = await Promise.all([
        getNsfStarshipChecklistFromDB({ skipCache: false }),
        getUpcomingStarshipMissions(10, 0).catch(() => ({ list: [] }))
      ])
      const nsfItems = nsf.items || []
      const missions = normalizeNsfStarshipMissionCards(starshipRes && starshipRes.list)
      this._starshipShareMissions = missions
      this.setData({
        loading: false,
        nsfChecklistItems: nsfItems,
        ...this.computeNsfChecklistProgress(nsfItems),
        nsfChecklistError: nsf.fetchError || '',
        nsfChecklistSourceLastFetch: nsf.sourceLastFetch || '',
        nsfChecklistUpdatedAtMs: nsf.updatedAtMs || 0,
        nsfChecklistSyncing: false,
        nsfStarshipMissions: missions
      })
      this._syncStarshipPageShareImage({ missions })
    } catch (error) {
      const msg = isPermissionDenied(error)
        ? getPermissionDeniedMessage()
        : (error && (error.errMsg || error.message)) || '清单加载失败，请稍后重试'
      this.setData({
        loading: false,
        errorMessage: msg,
        nsfChecklistSyncing: false
      })
      this._syncStarshipPageShareImage({})
    }
  },

  async onRefreshNsfChecklistDetail() {
    if (!this._nsfChecklistMode || this.data.nsfChecklistSyncing) return
    this.setData({ nsfChecklistSyncing: true })
    // 只重读云数据库缓存，不触发 NSF 网页抓取——抓取节奏由云函数小时级定时器
    // （syncNextSpaceflightStarshipHourly）自动分配，用户手势不能成为抓取入口
    try {
      const [nsf, starshipRes] = await Promise.all([
        getNsfStarshipChecklistFromDB({ skipCache: true }),
        getUpcomingStarshipMissions(10, 0).catch(() => ({ list: [] }))
      ])
      const nsfItems = nsf.items || []
      const missions = normalizeNsfStarshipMissionCards(starshipRes && starshipRes.list)
      this._starshipShareMissions = missions
      this.setData({
        nsfChecklistItems: nsfItems,
        ...this.computeNsfChecklistProgress(nsfItems),
        nsfChecklistError: nsf.fetchError || '',
        nsfChecklistSourceLastFetch: nsf.sourceLastFetch || '',
        nsfChecklistUpdatedAtMs: nsf.updatedAtMs || 0,
        nsfChecklistSyncing: false,
        nsfStarshipMissions: missions
      })
      this._syncStarshipPageShareImage({ missions })
    } catch (e2) {
      this.setData({ nsfChecklistSyncing: false })
    }
  },

  onNsfStarshipMissionCardTap(e) {
    const detail = (e && e.detail) || {}
    const id = detail.id == null ? '' : String(detail.id).trim()
    if (!id) return
    const detailType = detail.type === 'completed' ? 'completed' : 'upcoming'
    wx.navigateTo({
      url: buildMissionDetailUrl({ id, detailType })
    })
  },

  /** 卡片左侧配置图 binderror 修好后回写列表，避免再次进入仍用坏 URL */
  onNsfStarshipRocketImageFix(e) {
    const detail = (e && e.detail) || {}
    const id = detail.id == null ? '' : String(detail.id).trim()
    const nextImage = detail.rocketImage
    if (!id || !nextImage || typeof nextImage !== 'string') return
    const list = this.data.nsfStarshipMissions || []
    const idx = list.findIndex((m) => m && String(m.id) === id)
    if (idx < 0) return
    const cur = list[idx].rocketImage || list[idx].image || ''
    if (!shouldReplaceRocketImage(cur, nextImage)) return
    this.setData({
      [`nsfStarshipMissions[${idx}].rocketImage`]: nextImage,
      [`nsfStarshipMissions[${idx}].image`]: nextImage
    })
    // 首卡配置图修好后同步分享缩略图
    if (idx === 0) {
      const nextList = list.slice()
      nextList[idx] = { ...nextList[idx], rocketImage: nextImage, image: nextImage }
      this._starshipShareMissions = nextList
      this._syncStarshipPageShareImage({ missions: nextList })
    }
  },

  /**
   * 清单 / 时间线 / 动态追踪分享图：
   * 优先任务卡片火箭配置图（排除 default 占位），再按任务名解析，最后 SpaceX logo。
   */
  _resolveStarshipPageShareImage(opts = {}) {
    const missions = opts.missions != null
      ? opts.missions
      : (this._starshipShareMissions || this.data.nsfStarshipMissions || [])
    const launchId = opts.launchId != null ? opts.launchId : this._starshipShareLaunchId
    const launchName = opts.launchName != null ? opts.launchName : this._starshipShareLaunchName
    let url = pickShareImageFromStarshipMissions(missions, launchId)
    if (!url && launchName) {
      url = pickUsableMissionRocketShareImage(
        resolveMissionRocketImage('', launchName, null, true)
      )
    }
    if (!url) {
      url = pickUsableMissionRocketShareImage(
        resolveMissionRocketImage('', 'Starship', null, true)
      )
    }
    return url || STARSHIP_PAGE_SHARE_FALLBACK
  },

  _syncStarshipPageShareImage(opts) {
    const url = this._resolveStarshipPageShareImage(opts || {})
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    this.ensureShareImageHttpUrl(url)
  },

  onFlightChecklistDetailTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url || typeof url !== 'string') return
    const data = url.trim()
    if (!/^https?:\/\//.test(data)) {
      wx.showToast({ title: '链接格式无效', icon: 'none' })
      return
    }
    const doCopy = () => {
      wx.setClipboardData({
        data,
        success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
        fail: () => wx.showModal({ title: '链接', content: data, showCancel: false })
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doCopy, fail: doCopy })
    } else {
      doCopy()
    }
  },

  /** 主列表滚回顶部（enhanced 模式优先用 ScrollViewContext.scrollTo） */
  _scrollDetailToTop() {
    var self = this
    try {
      wx.createSelectorQuery()
        .in(this)
        .select('.detail-scroll')
        .node()
        .exec(function (res) {
          var node = res && res[0] && res[0].node
          if (node && typeof node.scrollTo === 'function') {
            node.scrollTo({ top: 0, duration: 0 })
            return
          }
          self.setData({ detailScrollTop: 0.1 })
          wx.nextTick(function () { self.setData({ detailScrollTop: 0 }) })
        })
    } catch (e) {
      self.setData({ detailScrollTop: 0.1 })
      wx.nextTick(function () { self.setData({ detailScrollTop: 0 }) })
    }
  },

  onUnload() {
    this.clearLl2EventCountdown()
  },

  onHide() {
    // 页面被覆盖/切后台时暂停每秒倒计时，避免后台空跑发热
    this.clearLl2EventCountdown()
    this.setData({ pageVisible: false })
  },

  onShow() {
    this.setData({ pageVisible: true })
    // onHide 暂停后回到本页恢复（仅在倒计时曾启动且未到期时）
    if (this._ll2CountdownActive) {
      this.startLl2EventCountdown()
    }
  },

  startLl2EventCountdown() {
    this.clearLl2EventCountdown()
    this._ll2CountdownActive = true
    this.updateLl2EventCountdown()
    this._ll2EventCountdownTimer = setInterval(() => this.updateLl2EventCountdown(), 1000)
  },

  updateLl2EventCountdown() {
    const item = this.data.item
    if (!item) return
    const dateMs = item._ll2EventRaw && item._ll2EventRaw.dateMs
      ? item._ll2EventRaw.dateMs
      : (item.isoDate ? Date.parse(item.isoDate) : NaN)
    if (!isFinite(dateMs)) return
    const diff = dateMs - Date.now()
    if (diff <= 0) {
      this._ll2CountdownActive = false
      this.setData({ ll2EventCountdown: { days: '00', hours: '00', minutes: '00', seconds: '00', isExpired: true } })
      this.clearLl2EventCountdown()
      return
    }
    const days = String(Math.floor(diff / 86400000)).padStart(2, '0')
    const hours = String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0')
    const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
    const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
    // 窄路径差量更新：通常每秒只有秒位变化，避免整对象重复下发渲染层
    const cur = this.data.ll2EventCountdown || {}
    const patch = {}
    if (cur.days !== days) patch['ll2EventCountdown.days'] = days
    if (cur.hours !== hours) patch['ll2EventCountdown.hours'] = hours
    if (cur.minutes !== minutes) patch['ll2EventCountdown.minutes'] = minutes
    if (cur.seconds !== seconds) patch['ll2EventCountdown.seconds'] = seconds
    if (cur.isExpired !== false) patch['ll2EventCountdown.isExpired'] = false
    if (Object.keys(patch).length) this.setData(patch)
  },

  clearLl2EventCountdown() {
    if (this._ll2EventCountdownTimer) {
      clearInterval(this._ll2EventCountdownTimer)
      this._ll2EventCountdownTimer = null
    }
  },

  async onLoad(options = {}) {
    const id = options.id ? String(options.id).trim() : ''
    this._autoPlayVideoIndex = options.autoPlayVideo != null ? Number(options.autoPlayVideo) : -1

    // 进度页经 eventChannel 传入的原始事件文档：仅作首屏加速，网络刷新逻辑保留兜底
    this._openerEventSnapshot = null
    try {
      const channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
      if (channel && typeof channel.on === 'function') {
        channel.on('eventSnapshot', (doc) => {
          if (doc && doc._id) this._openerEventSnapshot = doc
        })
      }
    } catch (e) {}

    this.initUiShell()

    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })

    const nsfMode = options.mode === 'nsf_checklist'
    if (nsfMode) {
      this._nsfChecklistMode = true
      // 会员分享卡片进入（带 sst 时间戳）：24 小时内免门控直接查看；
      // 超过 24 小时或 App 内自然入口仍走 gateCheck
      const sst = parseShareStamp(options)
      this._shareSst = sst
      this._nsfShareEntry = sst > 0 && Date.now() - sst <= SHARE_GATE_TTL_MS
      if (this._nsfShareEntry) {
        // 底部「限时查看」倒计时胶囊（静默权益确认为有权益后会隐藏）
        this.setData({ shareGateExpireAt: sst + SHARE_GATE_TTL_MS })
      }
      await loadCloudMediaMap()
      await this.loadNsfChecklistPage()
      return
    }

    if (options.mode === 'll2_timeline') {
      this._ll2TimelineMode = true
      await loadCloudMediaMap()
      await this.loadLl2TimelineDetailPage()
      return
    }
    if (options.mode === 'll2_launch_updates') {
      this._ll2LaunchUpdatesMode = true
      await loadCloudMediaMap()
      await this.loadLl2LaunchUpdatesDetailPage()
      return
    }

    if (options.mode === 'll2_event') {
      this._ll2EventMode = true
      await loadCloudMediaMap()
      await this.loadLl2EventDetailPage(id)
      return
    }

    await loadCloudMediaMap()

    // 读取视频显示开关：走 feature-flags 的 global_config 共享缓存（5 分钟 + inflight 去重），
    // 避免每次进详情页直读一次云库同一文档；fail-closed，读不到配置不放出视频
    try {
      const { isPlaybackAllowed, isLiveEntryAllowed } = require('../../utils/feature-flags.js')
      const enabled = await isPlaybackAllowed()
      // 过审直播入口开关（failClosed）：关闭时不渲染 B 站直播卡、不查直播状态
      const liveOn = await isLiveEntryAllowed().catch(() => false)
      this.setData({ enableEventVideo: enabled, enableLiveEntry: !!liveOn })
    } catch (e) {}

    if (options.mode === 'list_all') {
      this._listAllMode = true
      // 参数先安全解码（跳转方已 encodeURIComponent，%2C 不解码会导致 split(',') 失败、整串被当成一个账号）
      this._listAllSource = options.source ? safeDecodeOption(options.source).trim() : ''
      // 多账号过滤（发射商详情页「事件更新 · 查看更多」）：sources=a,b,c + label=机构名，免门控
      this._listAllSources = options.sources
        ? safeDecodeOption(options.sources).split(',').map(s => s.trim()).filter(Boolean)
        : []
      this._listAllLabel = options.label ? safeDecodeOption(options.label).trim() : ''
      // 全量列表入口不设门控：非会员可进，首屏免费 FREE_EVENT_LIST_LIMIT 条，触底/播视频再拦
      // 多账号（sources=）或按账号（source= 过门控/分享）进入后可完整翻页
      this._eventListUnlocked = !!(this._listAllSources && this._listAllSources.length)
      // 「按账号查看」为会员功能：分享卡片带 sst 时间戳，24h 内免门控，过期走 gateCheck
      if (this._listAllSource) {
        const sst = parseShareStamp(options)
        this._shareSst = sst
        if (sst > 0 && Date.now() - sst > SHARE_GATE_TTL_MS) {
          const allowed = await gateCheck('starship_progress_event_source', '星舰事件更新 · 按账号查看')
          if (!allowed) {
            this.setData({
              loading: false,
              errorMessage: '分享链接已过期，开通星际通行证后可继续查看',
              navTitle: '星舰事件更新'
            })
            return
          }
        } else if (sst > 0) {
          // 底部「限时查看」倒计时胶囊（静默权益确认为有权益后会隐藏）
          this.setData({ shareGateExpireAt: sst + SHARE_GATE_TTL_MS })
        }
        this._eventListUnlocked = true
        this._refreshSourceGatePassedSilently()
      }
      await this.loadListAll(true)
      return
    }

    const source = options.source ? String(options.source).trim() : ''
    const listLabel = options.label ? String(options.label).trim() : ''
    const listDate = options.date ? String(options.date).trim() : todayBeijingYmd()

    this._listSource = source
    this._listLabel = listLabel
    this._listDate = listDate
    this._singleItemId = id

    if (id) {
      await this.loadDetail(id)
    } else if (source) {
      await this.loadListBySource(source, listDate, listLabel)
    } else {
      this.setData({ loading: false, errorMessage: '缺少事件参数，请返回列表重新进入' })
    }
  },

  enrichEventItem(item) {
    const safeItem = item && typeof item === 'object' ? item : null
    if (!safeItem) return null

    const mediaList = Array.isArray(safeItem.mediaList) ? safeItem.mediaList : []
    const enrichedMediaList = mediaList.map(media => {
      if (!media) return media
      if (media.type === 'video') {
        return enrichVideoMediaItem(media, { getCachedMediaImage, thumbPreset: 'thumb' })
      }
      if (media.type === 'image' && media.url) {
        // 列表/详情卡片用 thumb；remoteUrl 供分享（缓存后 url 可能是 wxfile://）
        const remoteUrl = media.url
        return { ...media, remoteUrl, url: getCachedMediaImage(media.url, 'thumb') }
      }
      return media
    })

    // 头像：优先 COS 地址，代理地址视为无效；按 source 约定路径兜底（含蓝箭等）
    let avatar = resolveEventAuthorAvatarUrl(safeItem)
    const authorAvatarRemote = avatar || ''
    if (avatar) avatar = getCachedMediaImage(avatar, 'thumb')

    // 缩略图与原图一一对应（同下标），避免预览/保存映射错位
    const imageUrls = []
    const imageOriginalUrls = []
    enrichedMediaList.forEach((media) => {
      if (!media || media.type !== 'image') return
      const original = media.remoteUrl || media.url
      const thumb = media.url || original
      if (!thumb && !original) return
      imageUrls.push(thumb || original)
      imageOriginalUrls.push(original || thumb)
    })
    const imageCount = imageUrls.length

    return {
      ...safeItem,
      mediaList: enrichedMediaList,
      imageUrls,
      imageOriginalUrls,
      imageCount,
      imageGridCols: Math.min(4, Math.max(1, imageCount || 1)),
      publishedAtText: formatEventTime(safeItem.publishedAt),
      authorAvatar: avatar,
      authorAvatarRemote,
      _liveStatus: 0,
      _liveCover: safeItem.liveCover || '',
      _liveTitle: ''
    }
  },

  async loadDetail(id, opts = {}) {
    // eventChannel 快照先上屏（首屏加速）：网络刷新照常执行，最终展示与原逻辑一致
    const snapshot = this._openerEventSnapshot
    if (
      snapshot && String(snapshot._id) === String(id) &&
      snapshot.status === 'published' && !this.data.item && !opts.silent
    ) {
      this._openerEventSnapshot = null
      const snapItem = this.enrichEventItem(snapshot)
      const snapTitle = (snapItem.title || snapItem.content || '事件更新').trim()
      this.setData({
        loading: false,
        item: snapItem,
        listMode: false,
        items: [],
        listDayHint: '',
        navTitle: '事件详情',
        shareTitle: `${snapTitle} | 火星探索日志`,
        shareImage: pickEventShareImageUrl(snapItem)
      })
      opts = { ...opts, silent: true }
    }

    // silent（下拉刷新）：已有内容时不回退到加载骨架，只显示微信原生刷新指示器
    if (!(opts.silent && this.data.item)) {
      this.setData({ loading: true, errorMessage: '' })
    }
    try {
      const db = wx.cloud.database()
      let rawItem = null

      try {
        const detailRes = await db.collection('starship_event_updates').doc(id).get()
        rawItem = detailRes && detailRes.data ? detailRes.data : null
      } catch (e) {}

      if (!rawItem) {
        const fallbackRes = await db.collection('starship_event_updates')
          .where({ _id: id, status: 'published' })
          .limit(1)
          .get()
        rawItem = (fallbackRes && fallbackRes.data && fallbackRes.data[0]) || null
      }

      if (!rawItem || rawItem.status !== 'published') {
        throw new Error('该事件不存在或暂不可查看')
      }

      const item = this.enrichEventItem(rawItem)
      const titleText = (item.title || item.content || '事件更新').trim()

      const shareImage = pickEventShareImageUrl(item)

      this.setData({
        loading: false,
        item,
        listMode: false,
        items: [],
        listDayHint: '',
        navTitle: '事件详情',
        shareTitle: `${titleText} | 火星探索日志`,
        shareImage
      })

      this._scrollDetailToTop()
      this.checkLiveStatus(item)

      // 从列表页点击视频跳转过来：先过视频门控，通过后再播（非会员只看封面）
      // 过审关闭 enableEventVideo 时绝不自动进播放页
      if (this.data.enableEventVideo && this._autoPlayVideoIndex >= 0 && item.mediaList) {
        const mediaIndex = this._autoPlayVideoIndex
        const media = item.mediaList[mediaIndex]
        this._autoPlayVideoIndex = -1
        if (media && media.type === 'video' && media.isPlayable) {
          setTimeout(async () => {
            // 与轮播/列表用同一单条解锁键：来源页刚看完广告则直接放行
            const playAllowed = await this._eventVideoPlayAllowed({
              eventId: item._id,
              mediaIndex,
              url: media.playUrl || media.url
            })
            if (!playAllowed) return
            await playEventVideo({
              url: media.url,
              playUrl: media.playUrl || media.url,
              originalUrl: media.originalUrl || media.url,
              thumb: media.thumbnailUrl || '',
              videoUrl: media.videoUrl || '',
              sourceUrl: media.sourceUrl || '',
              isLong: !!media.isLongVideo,
              // 原片保存仅 Pro/已购；广告解锁只放行预览播放
              canSave: canSaveOriginalVideoSync('starship_event_list_full'),
              onSaveHint: () => {},
              share: this._buildEventVideoShareInfo(item._id)
            })
          }, 300)
        }
      } else if (this._autoPlayVideoIndex >= 0) {
        this._autoPlayVideoIndex = -1
      }
    } catch (error) {
      const msg = isPermissionDenied(error)
        ? getPermissionDeniedMessage()
        : (error && (error.errMsg || error.message)) || '事件加载失败，请稍后重试'
      this.setData({
        loading: false,
        errorMessage: msg
      })
    }
  },

  /** 进度页「查看更多」：全部已发布动态（可选按 source 筛选），分页加载 */
  async loadListAll(refresh, opts = {}) {
    if (this._listAllLoading) return
    this._listAllLoading = true
    if (refresh) {
      this._listAllSkip = 0
      // silent（下拉刷新）：已有列表时不清列表、不显示加载骨架，成功后整页替换
      if (opts.silent && (this.data.items || []).length > 0) {
        this.setData({ errorMessage: '', listNoMore: false, listLoadingMore: false })
      } else {
        this.setData({
          loading: true,
          errorMessage: '',
          items: [],
          listNoMore: false,
          listLoadingMore: false
        })
      }
    } else {
      this.setData({ listLoadingMore: true })
    }

    const policy = getMemberPolicySync()
    const freePreview = !canUsePaidCloudSync() && !this._eventListUnlocked && policy.enableEventListGate
    const freeLimit = policy.freeEventListLimit || DEFAULT_FREE_EVENT_LIST_LIMIT
    const limit = freePreview && refresh ? freeLimit : EVENT_LIST_PAGE_LIMIT
    const skip = refresh ? 0 : (this._listAllSkip || 0)

    try {
      const db = wx.cloud.database()
      const where = { status: 'published' }
      if (this._listAllSources && this._listAllSources.length) {
        where.source = db.command.in(this._listAllSources)
      } else if (this._listAllSource) {
        where.source = this._listAllSource
      }
      const res = await db.collection('starship_event_updates')
        .where(where)
        .orderBy('publishedAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()

      const newItems = (res.data || []).map(it => this.enrichEventItem(it))
      const merged = refresh ? newItems : (this.data.items || []).concat(newItems)
      this._listAllSkip = skip + newItems.length
      let hint
      if (this._listAllSources && this._listAllSources.length) {
        hint = `${this._listAllLabel || this._listAllSources.join(' / ')} · 共 ${merged.length} 条`
      } else if (this._listAllSource) {
        hint = `${this._listAllSource} · 共 ${merged.length} 条`
      } else {
        hint = `全部账号 · 共 ${merged.length} 条`
      }

      // 免费预览：拉满免费条数时不标 listNoMore，便于触底触发门控；不足则真无更多
      const listNoMore = freePreview
        ? newItems.length < freeLimit
        : newItems.length < limit

      const listNavTitle = this._listAllLabel ? `${this._listAllLabel} · 事件更新` : '事件更新'
      let listShareImage = pickEventShareImageUrl(null)
      if (merged[0]) {
        listShareImage = pickEventShareImageUrl(merged[0])
      } else if (this._listAllSource) {
        listShareImage = pickEventShareImageUrl({
          source: this._listAllSource,
          authorAvatarRemote: resolveTweetAccountAvatarUrl(this._listAllSource)
        })
      } else if (this._listAllSources && this._listAllSources.length === 1) {
        const onlySource = this._listAllSources[0]
        listShareImage = pickEventShareImageUrl({
          source: onlySource,
          authorAvatarRemote: resolveTweetAccountAvatarUrl(onlySource)
        })
      }

      this.setData({
        loading: false,
        listMode: true,
        listAllMode: true,
        items: merged,
        item: null,
        errorMessage: '',
        navTitle: listNavTitle,
        listDayHint: hint,
        shareTitle: `${listNavTitle} | 火星探索日志`,
        shareImage: listShareImage,
        listNoMore,
        listLoadingMore: false,
        avatarError: false
      })
      if (refresh) this._scrollDetailToTop()
    } catch (error) {
      const msg = isPermissionDenied(error)
        ? getPermissionDeniedMessage()
        : (error && (error.errMsg || error.message)) || '事件加载失败，请稍后重试'
      this.setData({
        loading: false,
        errorMessage: msg,
        listMode: false,
        listAllMode: false,
        items: [],
        listLoadingMore: false
      })
    } finally {
      this._listAllLoading = false
    }
  },

  async onDetailScrollToLower() {
    if (!this._listAllMode || this.data.listNoMore || this._listAllLoading) return
    // 非会员触底：弹开通引导，通过后解锁完整翻页（enableEventListGate 关闭则直接放行）
    if (!canUsePaidCloudSync() && !this._eventListUnlocked) {
      const policy = await getMemberPolicy()
      if (!policy.enableEventListGate) {
        this._eventListUnlocked = true
      } else {
        if (this._eventGateChecking) return
        this._eventGateChecking = true
        try {
          const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 完整浏览')
          if (!allowed) return
          this._eventListUnlocked = true
        } finally {
          this._eventGateChecking = false
        }
      }
    }
    this.loadListAll(false)
  },

  /** 简报胶囊等：某 source 在北京日历日当天的全部已发布动态 */
  async loadListBySource(source, dateYmd, labelHint, opts = {}) {
    // silent（下拉刷新）：已有列表时不回退到加载骨架
    if (!(opts.silent && (this.data.items || []).length > 0)) {
      this.setData({ loading: true, errorMessage: '' })
    }
    try {
      const db = wx.cloud.database()
      const day = dateYmd || todayBeijingYmd()
      // 小程序端单次查询上限 20 条（.limit(150) 会被静默截断成 20），按 20/批翻页；
      // 结果按 publishedAt 降序，一旦本批最旧一条已早于目标日期即可提前收工
      const BATCH = 20
      const MAX_TOTAL = 150
      let raw = []
      for (let i = 0; i < Math.ceil(MAX_TOTAL / BATCH); i++) {
        const res = await db.collection('starship_event_updates')
          .where({ source: source, status: 'published' })
          .orderBy('publishedAt', 'desc')
          .skip(i * BATCH)
          .limit(BATCH)
          .get()
        const batch = res.data || []
        raw = raw.concat(batch)
        if (batch.length < BATCH) break
        const oldestYmd = publishedAtToBeijingYmd(batch[batch.length - 1].publishedAt)
        if (oldestYmd && oldestYmd < day) break
      }
      const filtered = raw.filter(it => publishedAtToBeijingYmd(it.publishedAt) === day)
      const items = filtered.map(it => this.enrichEventItem(it))
      const namePart = labelHint || source
      const shareImage = items[0]
        ? pickEventShareImageUrl(items[0])
        : pickEventShareImageUrl({ source, authorAvatarRemote: resolveTweetAccountAvatarUrl(source) })
      const hint = namePart + ' · 共 ' + items.length + ' 条'
      const navTitle = namePart + ' · 今日动态'
      const shareTitle = navTitle + ' | 火星探索日志'
      this.setData({
        loading: false,
        listMode: true,
        items,
        item: null,
        errorMessage: '',
        navTitle,
        listDayHint: hint,
        shareTitle,
        shareImage,
        avatarError: false
      })
      this._scrollDetailToTop()
    } catch (error) {
      const msg = isPermissionDenied(error)
        ? getPermissionDeniedMessage()
        : (error && (error.errMsg || error.message)) || '事件加载失败，请稍后重试'
      this.setData({
        loading: false,
        errorMessage: msg,
        listMode: false,
        items: []
      })
    }
  },

  extractRoomId(raw) {
    if (!raw) return ''
    const match = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
    return match ? match[1] : String(raw).replace(/\D/g, '')
  },

  async checkLiveStatus(item) {
    if (!item || !item.liveRoomId) return
    // 过审关闭直播入口：不发起 B 站直播状态查询
    if (!this.data.enableLiveEntry) return
    const roomId = this.extractRoomId(item.liveRoomId)
    if (!roomId) return

    try {
      const statusMap = await fetchLiveStatusBatch([roomId])
      const { liveStatus, cover, liveTitle } = parseLiveStatus(statusMap[roomId])
      this.setData({
        'item._liveStatus': liveStatus,
        'item._liveCover': cover || item.liveCover || '',
        'item._liveTitle': liveTitle
      })
    } catch (e) {
      console.warn('[Live] 查询直播间状态失败:', e.message || e)
    }
  },

  onScrollRefresh() {
    this._runEventDetailPullRefresh('scrollRefreshing')
  },

  async onPullDownRefresh() {
    await this._runEventDetailPullRefresh()
  },

  async _runEventDetailPullRefresh(key) {
    // LL2 实时数据模式直接拦截：用户刷新绝不触发 LL2 请求，
    // 拉取节奏由云函数缓存/定时任务自动分配
    if (this.data.loading || this._ll2TimelineMode || this._ll2LaunchUpdatesMode || this._ll2EventMode) {
      if (key) {
        this.setData({ [key]: false })
      } else {
        try { wx.stopPullDownRefresh() } catch (e) {}
      }
      return
    }
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const options = (currentPage && currentPage.options) || {}
    const id = options.id ? String(options.id).trim() : ''
    const source = options.source ? String(options.source).trim() : ''
    await runPullRefresh(this, async () => {
      if (this._nsfChecklistMode) {
        await this.onRefreshNsfChecklistDetail()
      } else if (this._listAllMode) {
        await this.loadListAll(true, { silent: true })
      } else if (id) {
        await this.loadDetail(id, { silent: true })
      } else if (source) {
        await this.loadListBySource(source, this._listDate || todayBeijingYmd(), this._listLabel || '', { silent: true })
      }
    }, key)
    this._scrollDetailToTop()
  },

  retryLoad() {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const options = (currentPage && currentPage.options) || {}
    const id = options.id ? String(options.id).trim() : ''
    const source = options.source ? String(options.source).trim() : ''
    if (this._nsfChecklistMode) {
      this.loadNsfChecklistPage()
      return
    }
    if (this._ll2TimelineMode) {
      this.loadLl2TimelineDetailPage()
      return
    }
    if (this._ll2LaunchUpdatesMode) {
      this.loadLl2LaunchUpdatesDetailPage()
      return
    }
    if (this._ll2EventMode && id) {
      this.loadLl2EventDetailPage(id)
      return
    }
    if (this._listAllMode) {
      this.loadListAll(true)
      return
    }
    if (id) this.loadDetail(id)
    else if (source) this.loadListBySource(source, this._listDate || todayBeijingYmd(), this._listLabel || '')
  },

  onListCardTap(e) {
    if (this._suppressListTapUntil && Date.now() < this._suppressListTapUntil) return
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(id)}`
    })
  },

  _vibrateMedium() {
    try {
      if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      try {
        if (wx.vibrateShort) wx.vibrateShort()
      } catch (e2) {}
    }
  },

  findListEventItem(id, idx) {
    const list = this.data.items || []
    if (id) {
      const matched = list.find(item => item && String(item._id) === String(id))
      if (matched) return matched
    }
    const numericIdx = Number(idx)
    if (!Number.isNaN(numericIdx) && numericIdx >= 0 && numericIdx < list.length) {
      return list[numericIdx]
    }
    return null
  },

  /**
   * 事件视频在全站播放页的分享上下文：落地页为该事件的详情页（不暴露视频直链），
   * 接收方观看仍走事件视频门控；播放页仅对会员开启转发入口
   */
  _buildEventVideoShareInfo(eventId) {
    const pageItem = this.data.item
    let item = null
    if (eventId) {
      item = (pageItem && String(pageItem._id) === String(eventId))
        ? pageItem
        : this.findListEventItem(eventId)
    } else {
      item = pageItem
    }
    if (!item || !item._id) return null
    const base = this.buildListEventShareOptions(item)
    return {
      title: base.title,
      path: base.path,
      imageUrl: base.imageUrl
    }
  },

  buildListEventShareOptions(item) {
    const safeItem = item && typeof item === 'object' ? item : null
    const titleText = safeItem && (safeItem.title || safeItem.content)
      ? String(safeItem.title || safeItem.content).trim()
      : '事件更新'
    const eventId = safeItem && safeItem._id ? String(safeItem._id) : ''

    return {
      title: `${titleText} | 火星探索日志`,
      path: eventId ? `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(eventId)}` : '/pages/progress/progress',
      imageUrl: pickEventShareImageUrl(safeItem)
    }
  },

  openListEventShareSheet(e) {
    if (!this.data.listMode) return
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const item = this.findListEventItem(ds.id, ds.idx)
    if (!item || !item._id) return
    this._vibrateMedium()
    this._suppressListTapUntil = Date.now() + 480
    this.setData({
      showEventShareSheet: true,
      selectedEventShareId: String(item._id)
    })
  },

  closeListEventShareSheet() {
    this.setData({
      showEventShareSheet: false,
      selectedEventShareId: ''
    })
  },

  onListShareButtonTap() {
    this.setData({ showEventShareSheet: false })
  },

  openListSelectedDetailForShare() {
    const eventId = this.data.selectedEventShareId
    this.setData({ showEventShareSheet: false })
    if (!eventId) return
    wx.navigateTo({
      url: `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(eventId)}`,
      success() {
        wx.showToast({
          title: '点击右上角可分享到朋友圈/收藏',
          icon: 'none',
          duration: 2200
        })
      }
    })
  },

  stopPropagation() {},

  onListAvatarError(e) {
    const idx = e.currentTarget.dataset.idx
    if (idx === undefined || idx === '') return
    const key = 'items[' + idx + ']._avatarFailed'
    this.setData({ [key]: true })
  },

  // goBack inherited from pageBase

  onAvatarError() {
    this.setData({ avatarError: true })
  },

  /** 点击：微信原生预览缩略图；原图保存走列表长按 */
  onEventImagePreview(e) {
    previewEventImages(e.currentTarget.dataset)
  },

  saveImageToAlbum(imageUrl, opts) {
    return saveImageToAlbumUtil(imageUrl, opts)
  },

  onEventImageLongPress(e) {
    handleEventImageLongPress(this, parseLongPressDataset(e.currentTarget.dataset))
  },

  closeEventImageSavePicker() {
    closeEventImageSavePicker(this)
  },

  toggleEventImageSaveSelect(e) {
    const idx = (e.currentTarget.dataset || {}).index
    toggleEventImageSaveSelect(this, idx)
  },

  selectAllEventImageSave() {
    selectAllEventImageSave(this)
  },

  confirmEventImageSavePicker() {
    return confirmEventImageSavePicker(this)
  },

  /** 推文视频播放为会员权益；非会员点封面弹开通引导（一次广告只解锁当前这条视频） */
  async _eventVideoPlayAllowed(opts) {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) return true
      if (isProSync()) return true
      // 后台关闭「强制封面」时非会员也可直接播
      if (canPrefetchVideoSync()) return true
      const o = opts || {}
      return await gateCheck('starship_event_list_full', '星舰事件更新 · 视频播放', {
        adUnlockId: eventVideoAdUnlockId(o.eventId, o.mediaIndex, o.url)
      })
    } catch (err) {
      return true
    }
  },

  async onVideoThumbnailTap(e) {
    const dataset = e.currentTarget.dataset || {}
    const url = dataset.url
    if (!url && !dataset.playurl) return

    const playAllowed = await this._eventVideoPlayAllowed({
      eventId: dataset.eventid || (this.data.item && this.data.item._id) || '',
      mediaIndex: dataset.midx,
      url: dataset.playurl || url
    })
    if (!playAllowed) return

    await playEventVideo({
      url,
      playUrl: dataset.playurl || url,
      originalUrl: dataset.original || url,
      thumb: dataset.thumb || '',
      videoUrl: dataset.videourl || '',
      sourceUrl: dataset.sourceurl || '',
      isLong: !!dataset.islong,
      // 原片保存仅 Pro/已购；广告解锁只放行预览播放
      canSave: canSaveOriginalVideoSync('starship_event_list_full'),
      onSaveHint: () => {},
      share: this._buildEventVideoShareInfo(dataset.eventid || (this.data.item && this.data.item._id) || '')
    })
  },

  /** 长按封面：下载原视频（原片体积大，仅 Pro/已购，无广告通道） */
  async onVideoSaveOriginal(e) {
    const dataset = e.currentTarget.dataset || {}
    const original = dataset.original || dataset.url
    if (!original || !isVideoUrl(original)) return
    if (dataset.islong || dataset.videourl) return

    if (!canUsePaidCloudSync()) {
      const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 原视频下载', { allowAd: false })
      if (!allowed) return
    }
    await saveEventOriginalVideo(original)
  },

  onLiveCardTap() {
    const item = this.data.item
    if (item) this._openLiveForItem(item)
  },

  onLiveCardTapFromList(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const ev = (this.data.items || []).find(x => String(x._id) === String(id))
    if (ev) this._openLiveForItem(ev)
  },

  _openLiveForItem(item) {
    if (!this.data.enableLiveEntry) return
    if (!item || !item.liveRoomId) return
    const rid = this.extractRoomId(item.liveRoomId)
    const liveUrl = `https://live.bilibili.com/${rid}`

    if (item._liveStatus !== 1) {
      wx.showToast({ title: '主播尚未开播', icon: 'none', duration: 2000 })
      return
    }

    wx.setClipboardData({
      data: liveUrl,
      success() {
        wx.showModal({
          title: '直播中',
          content: '直播链接已复制到剪贴板，请在浏览器中打开观看直播',
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    })
  },

  onShareAppMessage(e) {
    if (this._ll2TimelineMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰飞行时间线 | 火星探索日志',
        path: '/subpackages/progress-extra/event-detail?mode=ll2_timeline'
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._ll2LaunchUpdatesMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰动态追踪 | 火星探索日志',
        path: '/subpackages/progress-extra/event-detail?mode=ll2_launch_updates'
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._ll2EventMode) {
      const eventId = this._ll2EventId || ''
      const imageUrl = this.data.shareImage || this._pickLl2EventShareImage(this.data.item)
      const result = {
        title: this.data.shareTitle || '在轨事件详情 | 火星探索日志',
        path: `/subpackages/progress-extra/event-detail?mode=ll2_event&id=${encodeURIComponent(eventId)}`
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._nsfChecklistMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰飞行检查清单 | 火星探索日志',
        // 有权益用户分享带新 sst 时间戳（接收者 24h 内免门控）；无权益接收者转发继承原时间戳
        path: '/subpackages/progress-extra/event-detail?mode=nsf_checklist' + this._nsfShareStampQuery()
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (e && e.from === 'button' && e.target && e.target.dataset && e.target.dataset.shareType === 'eventUpdateItem') {
      const buttonId = e.target.dataset.id
      const item = this.findListEventItem(buttonId)
      if (item) return this.buildListEventShareOptions(item)
      if (buttonId) {
        return {
          title: '事件更新 | 火星探索日志',
          path: `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(buttonId)}`,
          imageUrl: pickEventShareImageUrl(null)
        }
      }
      return {
        title: '事件更新 | 火星探索日志',
        path: '/pages/progress/progress',
        imageUrl: pickEventShareImageUrl(null)
      }
    }
    if (this.data.listAllMode) {
      let path = '/subpackages/progress-extra/event-detail?mode=list_all'
      if (this._listAllSources && this._listAllSources.length) {
        path += `&sources=${encodeURIComponent(this._listAllSources.join(','))}`
        if (this._listAllLabel) path += `&label=${encodeURIComponent(this._listAllLabel)}`
      } else if (this._listAllSource) {
        path += `&source=${encodeURIComponent(this._listAllSource)}` + this._sourceShareStampQuery()
      }
      return {
        title: this.data.shareTitle,
        path,
        imageUrl: this.data.shareImage
      }
    }
    if (this.data.listMode && this._listSource) {
      let path = `/subpackages/progress-extra/event-detail?source=${encodeURIComponent(this._listSource)}&date=${encodeURIComponent(this._listDate || todayBeijingYmd())}`
      if (this._listLabel) path += `&label=${encodeURIComponent(this._listLabel)}`
      return {
        title: this.data.shareTitle,
        path,
        imageUrl: this.data.shareImage
      }
    }
    const item = this.data.item
    const entryId = (item && item._id) ? item._id : this._singleItemId
    if (!entryId) {
      return {
        title: this.data.shareTitle || '事件更新 | 火星探索日志',
        path: '/pages/progress/progress',
        imageUrl: this.data.shareImage || pickEventShareImageUrl(null)
      }
    }

    return {
      title: this.data.shareTitle || '事件更新 | 火星探索日志',
      path: `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(entryId)}`,
      imageUrl: this.data.shareImage || pickEventShareImageUrl(item)
    }
  },

  onShareTimeline() {
    if (this._ll2TimelineMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰飞行时间线 | 火星探索日志',
        query: 'mode=ll2_timeline'
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._ll2LaunchUpdatesMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰动态追踪 | 火星探索日志',
        query: 'mode=ll2_launch_updates'
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._ll2EventMode) {
      const eventId = this._ll2EventId || ''
      const imageUrl = this.data.shareImage || this._pickLl2EventShareImage(this.data.item)
      const result = {
        title: this.data.shareTitle || '在轨事件详情 | 火星探索日志',
        query: `mode=ll2_event&id=${encodeURIComponent(eventId)}`
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this._nsfChecklistMode) {
      const imageUrl = this.data.shareImage || this._resolveStarshipPageShareImage()
      const result = {
        title: '星舰飞行检查清单 | 火星探索日志',
        query: 'mode=nsf_checklist' + this._nsfShareStampQuery()
      }
      if (imageUrl) result.imageUrl = imageUrl
      return result
    }
    if (this.data.listAllMode) {
      let q = 'mode=list_all'
      if (this._listAllSources && this._listAllSources.length) {
        q += `&sources=${encodeURIComponent(this._listAllSources.join(','))}`
        if (this._listAllLabel) q += `&label=${encodeURIComponent(this._listAllLabel)}`
      } else if (this._listAllSource) {
        q += `&source=${encodeURIComponent(this._listAllSource)}` + this._sourceShareStampQuery()
      }
      return {
        title: this.data.shareTitle,
        query: q,
        imageUrl: this.data.shareImage
      }
    }
    if (this.data.listMode && this._listSource) {
      let q = `source=${encodeURIComponent(this._listSource)}&date=${encodeURIComponent(this._listDate || todayBeijingYmd())}`
      if (this._listLabel) q += `&label=${encodeURIComponent(this._listLabel)}`
      return {
        title: this.data.shareTitle,
        query: q,
        imageUrl: this.data.shareImage
      }
    }
    const item = this.data.item
    const entryId = (item && item._id) ? item._id : this._singleItemId
    return {
      title: this.data.shareTitle,
      query: entryId ? `id=${encodeURIComponent(entryId)}` : '',
      imageUrl: this.data.shareImage
    }
  }
})
