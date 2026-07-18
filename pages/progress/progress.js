// pages/progress/progress.js
const themeUtil = require('../../utils/theme.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { getRoadClosureNotice } = require('../../utils/api-road-closure.js')
const {
  getStarshipStatusFromDB,
  fetchLl2LaunchUpdates,
  fetchLl2LaunchTimeline,
  getNsfStarshipChecklistFromDB,
  getStarshipHardwareFromDB
} = require('../../utils/api-app-services.js')
const { normalizeLl2TimelineList } = require('../../utils/ll2-launch-timeline.js')
const { formatDate } = require('../../utils/util.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('../../utils/single-page.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { isVideoUrl } = require('../../utils/cos-url.js')
const { enrichVideoMediaItem, eventVideoAdUnlockId, playEventVideo, saveEventOriginalVideo } = require('../../utils/event-video.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')
const {
  EMPTY_ROAD_CLOSURE,
  resolveRoadClosureStatus,
  buildRoadClosureState,
  syncRoadClosureFromCloud,
  verifyRoadClosurePassword,
  saveManualRoadClosureNotice
} = require('../../utils/progress-road-closure.js')
const { fetchLiveStatusBatch, parseLiveStatus } = require('../../utils/live-status.js')
const { pickEventShareImageUrl } = require('../../utils/event-share-image.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { gateCheck, isProSync, isMembershipEnabled, canUsePaidCloudSync, canPrefetchVideoSync, canSaveOriginalVideoSync } = require('../../utils/membership.js')
const { getMemberPolicy } = require('../../utils/member-policy.js')
const {
  warmProgressPageStorageSync,
  OPENCLAW_GUIDE_DISMISSED_KEY,
  BRIEFING_PROGRESS_FILTER_CLEAR_KEY,
  BRIEFING_PROGRESS_FILTER_SOURCE_KEY
} = require('../../utils/page-storage-boot.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { pooledDownloadFile } = require('../../utils/download-pool.js')

const PROGRESS_LAST_VIEWED_KEY = '_progress_last_viewed'

const NSF_CHECKLIST_GATE_PRODUCT_ID = 'starship_flight_checklist'
/** 首屏后再拉取折叠区（LL2 时间线/动态、推文统计等） */
const PROGRESS_BELOW_FOLD_DEFER_MS = 1200
/** 事件列表直播状态批量查询延后，避免与首屏 DB 查询抢带宽 */
const PROGRESS_LIVE_STATUS_DEFER_MS = 600

const { formatCloudError } = require('../../utils/launch-stats-cloud.js')

/** LL2 自动解析星舰发射失败时的可读文案 */
function formatLl2AutoError(message) {
  const m = String(message || '')
  if (m === 'no_starship_launch') {
    return 'LL2 上暂未找到火箭配置为「Starship」的发射（已查 upcoming / previous）。可稍后下拉刷新，或在后台手动填写发射 UUID。'
  }
  return formatCloudError(new Error(m))
}

const B19_IMAGE_KEY = '最新版星舰组合体进展一二级图/b19_spacex3.webp'
const S39_IMAGE_KEY = '最新版星舰组合体进展一二级图/s39_spacex.webp'

/** 星舰硬件设施板块：Tab 页仅预览 2 张，标题右侧「查看全部」跳完整列表页 */
const HARDWARE_PREVIEW_COUNT = 2

function getBoosterFallbackImage() {
  return resolveMediaUrl(B19_IMAGE_KEY, '')
}

function getShipFallbackImage() {
  return resolveMediaUrl(S39_IMAGE_KEY, '')
}

Page({
  async onLoad(options = {}) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 2,
        currentPath: '/pages/progress/progress'
      })
    }

    const app = getApp()
    const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())

    this.setData({
      themeClass: themeUtil.getThemeClassSync(),
      themeLight: themeUtil.isLightSync(),
      pageBgColor: themeUtil.getPageBgSync(),
      statusBarHeight: uiShellLayout.statusBarHeight,
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      tabBarReservedHeight: uiShellLayout.tabBarReservedHeight
    })

    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })

    // 首屏关键路径：云媒体映射 → 星舰卡片数据
    void loadCloudMediaMap()
      .then(() => this.loadStarshipStatusFromDB({ deferLl2: true }))
      .catch(() => {
        this.loadStarshipStatusFromDB({ deferLl2: true }).catch(() => {})
      })

    // 次优先：封路 + 硬件设施 + 事件列表（略延后，不阻塞首帧绘制）
    setTimeout(() => {
      this.loadRoadClosureNotice()
      this.loadStarshipHardware()
      this.loadEventUpdates(false, options.filterSource || '')
    }, 50)

    // 折叠区：LL2 时间线/动态、推文统计、视频开关配置
    this._scheduleBelowFoldLoads()

    // 如果是从任务详情页跳过来（mission-detail 点 S39/Booster19 序列号）
    // 会先触发 onLoad → onShow，需要记下"数据加载完成后自动打开对应卡片弹窗"的意图
    // 数据加载是异步的（loadStarshipStatusFromDB 内部有 Promise），这里记意图即可
    this._consumeAutoOpenStarshipIntent(options)

    try { warmProgressPageStorageSync() } catch (e) {}
  },

  /**
   * 读取从 mission-detail 页跳转过来时携带的"自动打开 Ship/Booster 弹窗"意图
   *
   * 来源有两个：
   *   1. getApp()._progressAutoOpenStarship  —— switchTab 不支持 query，用 app 全局变量
   *   2. options.type                        —— navigateTo 回退时携带的 query
   *
   * 意图只消费一次，读完立刻清掉。5 秒内有效（防止用户手动进来时误触发）
   */
  _consumeAutoOpenStarshipIntent(options) {
    const app = getApp && getApp()
    const intent = app && app._progressAutoOpenStarship
    let targetType = null
    if (intent && intent.type && (Date.now() - (intent.setAt || 0) < 5000)) {
      targetType = intent.type === 'ship' ? 'ship' : 'booster'
      if (app) app._progressAutoOpenStarship = null
    } else if (options && options.type) {
      targetType = options.type === 'ship' ? 'ship' : 'booster'
    }
    if (!targetType) return
    this.setData({ selectedStarshipType: targetType })
    // 与卡片点击一致：优先进硬件设施详情（无会员门控）
    this._openStarshipVehicleDetail(targetType)
  },

  onShow() {
    // 主题兜底同步：在其他 Tab 切了主题后回到本 Tab
    themeUtil.applyThemeToPage(this)
    try {
      const app = getApp && getApp()
      if (app && typeof app.syncAllTabBarsDesktopStrip === 'function') app.syncAllTabBarsDesktopStrip()
    } catch (e) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 2,
        currentPath: '/pages/progress/progress',
        hidden: false,
        showProgressDot: false
      })
      try {
        const app = getApp()
        if (app && typeof app.patchTabBarUiCache === 'function') {
          app.patchTabBarUiCache({
            selected: 2,
            currentPath: '/pages/progress/progress',
            hidden: false,
            showProgressDot: false
          })
        }
      } catch (_) {}
      getApp().checkProfileDot(this.getTabBar())
      getApp().checkNewsDot(this.getTabBar())
    }
    var self = this
    setTimeout(function () {
      try { warmProgressPageStorageSync() } catch (e) {}
      self.setData({ isProUser: isProSync() })
      storageCache.persistAsync(PROGRESS_LAST_VIEWED_KEY, Date.now())
      self._checkOpenClawGuide()
      tryShowPopupAd(2, self)
      self._applyBriefingProgressFilter()
      self._consumeAutoOpenStarshipIntent({})
    }, 0)
  },

  _applyBriefingProgressFilter() {
    if (this._briefingFilterApplied) return
    this._briefingFilterApplied = true
    var briefingFilter = ''
    var briefingClear = storageCache.readMemOrSync(BRIEFING_PROGRESS_FILTER_CLEAR_KEY, '') === '1'
    if (briefingClear) {
      storageCache.invalidate(BRIEFING_PROGRESS_FILTER_CLEAR_KEY)
      try { wx.removeStorage({ key: BRIEFING_PROGRESS_FILTER_CLEAR_KEY, fail: function () {} }) } catch (e) {}
      this.loadEventUpdates(true, '')
      return
    }
    briefingFilter = storageCache.readMemOrSync(BRIEFING_PROGRESS_FILTER_SOURCE_KEY, '') || ''
    if (briefingFilter) {
      storageCache.invalidate(BRIEFING_PROGRESS_FILTER_SOURCE_KEY)
      try { wx.removeStorage({ key: BRIEFING_PROGRESS_FILTER_SOURCE_KEY, fail: function () {} }) } catch (e2) {}
      this.loadEventUpdates(true, briefingFilter)
    }
  },

  onPopupAdClose() {
    this.setData({ popupAdVisible: false, popupAdItem: null })
  },

  onHide() {
    this._briefingFilterApplied = false
    this._openClawGuideChecked = false
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) {
      tabBar.setData({ hidden: false })
      try {
        const app = getApp()
        if (app && typeof app.patchTabBarUiCache === 'function') app.patchTabBarUiCache({ hidden: false })
      } catch (_) {}
    }
    if (this._openClawGuideTimer) {
      clearTimeout(this._openClawGuideTimer)
      this._openClawGuideTimer = null
    }
  },

  /** 检查是否需要显示 OpenClaw 提示 */
  _checkOpenClawGuide() {
    if (this._openClawGuideChecked) return
    this._openClawGuideChecked = true
    try {
      const dismissed = storageCache.readMemOrSync(OPENCLAW_GUIDE_DISMISSED_KEY, false)
      if (dismissed) return
      this.setData({ showOpenClawGuide: true })

      this._openClawGuideTimer = setTimeout(() => {
        this.setData({ showOpenClawGuide: false })
      }, 10000)
    } catch (e) {}
  },

  /** 关闭 OpenClaw 提示 */
  closeOpenClawGuide() {
    this.setData({ showOpenClawGuide: false })
    storageCache.persistAsync(OPENCLAW_GUIDE_DISMISSED_KEY, true)
    if (this._openClawGuideTimer) {
      clearTimeout(this._openClawGuideTimer)
      this._openClawGuideTimer = null
    }
  },

  _clearProgressDeferTimers() {
    if (this._belowFoldTimer) {
      clearTimeout(this._belowFoldTimer)
      this._belowFoldTimer = null
    }
    if (this._ll2DeferTimer) {
      clearTimeout(this._ll2DeferTimer)
      this._ll2DeferTimer = null
    }
    if (this._liveStatusDeferTimer) {
      clearTimeout(this._liveStatusDeferTimer)
      this._liveStatusDeferTimer = null
    }
  },

  /** 延后加载首屏以下区块的网络请求 */
  _scheduleBelowFoldLoads() {
    if (this._belowFoldScheduled) return
    this._belowFoldScheduled = true
    this._belowFoldTimer = setTimeout(() => {
      this._belowFoldTimer = null
      if (!this.data.belowFoldSectionsReady) {
        this.setData({ belowFoldSectionsReady: true })
      }
      this._loadTweetAccountStats()
      this.loadEventVideoConfig()
      this._scheduleDeferredLl2Loads()
    }, PROGRESS_BELOW_FOLD_DEFER_MS)
  },

  _scheduleDeferredLl2Loads() {
    if (this._ll2DeferTimer) clearTimeout(this._ll2DeferTimer)
    this._ll2DeferTimer = setTimeout(() => {
      this._ll2DeferTimer = null
      Promise.all([
        this.loadLl2LaunchUpdates(),
        this.loadLl2LaunchTimeline()
      ]).catch(() => {})
    }, 300)
  },

  onUnload() {
    this._clearProgressDeferTimers()
    if (this._openClawGuideTimer) clearTimeout(this._openClawGuideTimer)
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) {
      tabBar.setData({ hidden: false })
      try {
        const app = getApp()
        if (app && typeof app.patchTabBarUiCache === 'function') app.patchTabBarUiCache({ hidden: false })
      } catch (_) {}
    }
  },

  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    popupAdItem: null,
    popupAdVisible: false,
    isProUser: false,
    pageDesc: 'SpaceX星舰Starship建造进度·马斯克火箭回收OpenClaw猎鹰9号航天太空追踪',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    selectedStarshipType: 'booster',
    // OpenClaw 自动追踪提示
    showOpenClawGuide: false,
    /** 数据就绪前不渲染卡片，避免硬编码占位（旧 B19/S39）闪现残影 */
    starshipLoaded: false,
    /** 加载失败标记：展示重试入口而非无限骨架屏 */
    starshipLoadError: false,
    starshipData: {
      booster: { id: '', status: '', progress: 0, image: '', images: [], detail: null },
      ship: { id: '', status: '', progress: 0, image: '', images: [], detail: null }
    },
    roadClosure: { ...EMPTY_ROAD_CLOSURE },
    roadClosureSyncing: false,
    roadClosureStatus: 'loading',
    // ── 星舰硬件设施 ──
    hardwareLoaded: false,
    hardwareVisible: [],
    hardwareError: '',
    flightReadinessChecklist: [],
    nsfChecklistItems: [],
    nsfChecklistProgressDone: 0,
    nsfChecklistProgressTotal: 0,
    nsfChecklistProgressPercent: 0,
    nsfChecklistSyncing: false,
    nsfChecklistError: '',
    nsfChecklistSourceLastFetch: '',
    nsfChecklistUpdatedAtMs: 0,
    ll2TrackedLaunchId: '',
    showLaunchLibraryUpdates: true,
    ll2LaunchUpdates: [],
    ll2LaunchUpdatesLoading: false,
    ll2LaunchUpdatesError: '',
    ll2TimelineRows: [],
    ll2TimelineLoading: false,
    ll2TimelineError: '',
    belowFoldSectionsReady: false,
    eventUpdates: [],
    eventUpdatesExpanded: false,
    eventUpdatesLoading: false,
    eventUpdatesError: '',
    eventUpdatesNoMore: false,
    eventScrollRefreshing: false,
    scrollRefreshing: false,
    enableEventVideo: false,
    showEventShareSheet: false,
    tweetAccountStats: [],
    tweetEventTotal: 0,
    tweetStatsChipsHasOverflow: false,
    selectedEventShareId: '',
    pressedEventId: ''
  },

  getStatusType(statusText) {
    const text = String(statusText || '').trim().toUpperCase()
    if (text === 'ACTIVE') return 'active'
    if (text === 'DESTROYED') return 'destroyed'
    if (text === 'EXPENDED') return 'expended'
    if (text === 'RETIRED') return 'retired'
    return 'retired'
  },

  /** 英文状态 → 中文标签（与硬件设施 statusZh 口径一致），映射不到返回空串 */
  getStatusZh(status) {
    const map = { ACTIVE: '活跃', DESTROYED: '已损毁', EXPENDED: '已消耗', RETIRED: '已退役' }
    return map[String(status || '').trim().toUpperCase()] || ''
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

  normalizeStarshipStatusData(data) {
    const booster = (data && data.booster) || {}
    const ship = (data && data.ship) || {}

    const boosterType = this.getStatusType(booster.status)
    const shipType = this.getStatusType(ship.status)

    const normalizeImageUrl = (url) => {
      if (!url || typeof url !== 'string') return ''
      const normalized = url.replace(/\\/g, '/')

      if (/^https?:\/\//.test(normalized)) {
        // 星舰头图全宽展示：COS 直链走 medium 压缩 + 本地缓存，避免每次拉原图
        return getCachedMediaImage(normalized, 'medium')
      }
      if (/^cloud:\/\//.test(normalized) || /^wxfile:\/\//.test(normalized)) {
        return normalized
      }

      if (normalized.startsWith('/')) return normalized

      const resolved = resolveMediaUrl(normalized, '')
      if (resolved) return resolved

      return ''
    }

    const resolveCloudAsset = (item, keyField, fallbackField) => {
      const key = item[keyField]
      const fallback = item[fallbackField]
      if (key || fallback) {
        return normalizeImageUrl(resolveMediaUrl(key, fallback || ''))
      }
      return ''
    }

    const normalizeImages = (item) => {
      // 自动数据优先：NSF 同步的 image/images 排在前面；后台 thumbnail 仅作兜底
      const images = []
      if (item.image) images.push(item.image)
      if (Array.isArray(item.images)) images.push(...item.images)
      if (Array.isArray(item.previewImages)) images.push(...item.previewImages)

      const cloudImage = resolveCloudAsset(item, 'thumbnailMediaKey', 'thumbnailFallback')
      if (cloudImage) images.push(cloudImage)

      const filtered = images
        .map(normalizeImageUrl)
        .filter(Boolean)

      return [...new Set(filtered)]
    }

    const getDetailData = (item, type, fallbackImage) => {
      const detail = item.detail || {}
      // 标题优先全称（Ship 40），其次短编号（S40）
      const fullName = item.name ? String(item.name).trim() : ''
      const vehicleId = item.id ? String(item.id).trim().toUpperCase() : ''
      const fallbackTitle = fullName || ((type === 'ship' ? '星舰' : '助推器') + vehicleId)
      const fallbackSubtitle = type === 'ship' ? 'STARSHIP' : 'SUPER HEAVY'
      // 头图同样优先自动主图，手动 hero 仅兜底
      const heroImage = fallbackImage || resolveCloudAsset(detail, 'heroMediaKey', 'heroFallback')
      const showChecklist = detail.showChecklist === true
      const checklist = Array.isArray(detail.checklist) ? detail.checklist : []

      return {
        title: detail.title || fallbackTitle,
        subtitle: detail.subtitle || fallbackSubtitle,
        statusText: detail.statusText || this.getStatusZh(item.status) || '活跃',
        summary: detail.summary || `${fallbackTitle}正在执行对应阶段的测试与验证任务。`,
        heroImage,
        showChecklist,
        checklist
      }
    }

    const boosterImages = normalizeImages(booster)
    const shipImages = normalizeImages(ship)
    const boosterDetail = getDetailData(booster, 'booster', boosterImages[0])
    const shipDetail = getDetailData(ship, 'ship', shipImages[0])

    // 卡片状态中文标签：后台 statusText > 英文映射 > 英文原文
    // 不直接用 detail.statusText（其兜底恒为「活跃」，会掩盖 DESTROYED 等真实状态）
    const statusLabel = (item) =>
      ((item.detail || {}).statusText) ||
      this.getStatusZh(item.status) ||
      String(item.status || '').toUpperCase() || 'RETIRED'

    return {
      booster: {
        ...booster,
        image: boosterImages[0],
        images: boosterImages,
        statusType: boosterType,
        status: statusLabel(booster),
        detail: boosterDetail
      },
      ship: {
        ...ship,
        image: shipImages[0],
        images: shipImages,
        statusType: shipType,
        status: statusLabel(ship),
        detail: shipDetail
      }
    }
  },

  _applyNsfChecklistSetData(nsf) {
    const nsfItems = (nsf && nsf.items) || []
    this.setData({
      nsfChecklistItems: nsfItems,
      ...this.computeNsfChecklistProgress(nsfItems),
      nsfChecklistError: (nsf && nsf.fetchError) || '',
      nsfChecklistSourceLastFetch: (nsf && nsf.sourceLastFetch) || '',
      nsfChecklistUpdatedAtMs: (nsf && nsf.updatedAtMs) || 0,
      nsfChecklistSyncing: false
    })
  },

  _deferNsfChecklistLoad(skipCache) {
    setTimeout(() => {
      getNsfStarshipChecklistFromDB({ skipCache: !!skipCache })
        .then((nsf) => this._applyNsfChecklistSetData(nsf))
        .catch(() => {
          this.setData({ nsfChecklistSyncing: false })
        })
    }, 300)
  },

  async loadStarshipStatusFromDB(opts = {}) {
    try {
      // syncNsf 语义：只重读 NSF 清单的云数据库缓存，不触发 NSF 网页抓取——
      // 抓取节奏由云函数小时级定时器（syncNextSpaceflightStarshipHourly）自动分配，
      // 用户下拉刷新不能成为抓取入口
      const syncNsf = opts.syncNsf === true
      const deferLl2 = opts.deferLl2 === true
      if (syncNsf) this.setData({ nsfChecklistSyncing: true })

      let data
      let nsf
      if (syncNsf) {
        ;[data, nsf] = await Promise.all([
          getStarshipStatusFromDB(),
          getNsfStarshipChecklistFromDB({ skipCache: true })
        ])
      } else {
        data = await getStarshipStatusFromDB()
      }

      const starshipData = this.normalizeStarshipStatusData(data)
      const flightReadinessChecklist = Array.isArray(data && data.flightReadinessChecklist)
        ? data.flightReadinessChecklist
        : []
      const ll2TrackedLaunchId = (data && typeof data.ll2TrackedLaunchId === 'string')
        ? data.ll2TrackedLaunchId.trim()
        : ''
      const showLaunchLibraryUpdates = !(data && data.showLaunchLibraryUpdates === false)

      const patch = {
        starshipData,
        starshipLoaded: true,
        flightReadinessChecklist,
        ll2TrackedLaunchId,
        showLaunchLibraryUpdates
      }
      if (syncNsf && nsf) {
        const nsfItems = nsf.items || []
        Object.assign(patch, {
          nsfChecklistItems: nsfItems,
          ...this.computeNsfChecklistProgress(nsfItems),
          nsfChecklistError: nsf.fetchError || '',
          nsfChecklistSourceLastFetch: nsf.sourceLastFetch || '',
          nsfChecklistUpdatedAtMs: nsf.updatedAtMs || 0,
          nsfChecklistSyncing: false
        })
      }
      this.setData(patch)
      // 若硬件列表已就绪，立刻用 Active 载具覆盖组合体卡片（编号/状态/图片）
      this._overlayStarshipCardsFromHardware()

      if (!syncNsf) {
        this._deferNsfChecklistLoad(false)
      }

      // 用户下拉刷新（skipLl2）不重拉 LL2 时间线/动态：LL2 请求节奏由云函数缓存自动分配
      if (opts.skipLl2 === true) return

      if (deferLl2) {
        this._scheduleDeferredLl2Loads()
      } else {
        await Promise.all([
          this.loadLl2LaunchUpdates(),
          this.loadLl2LaunchTimeline()
        ])
      }

    } catch (error) {
      // 失败时置错误态：否则 starshipLoaded 恒为 false，骨架屏永远不消失
      this.setData({ nsfChecklistSyncing: false, starshipLoadError: true })
    }
  },

  onRetryStarshipLoad() {
    if (this.data.starshipLoaded) return
    this.setData({ starshipLoadError: false })
    this.loadStarshipStatusFromDB({ deferLl2: true })
  },

  async onNsfChecklistExpandTap() {
    if (this._nsfExpandGatePending) return
    this._nsfExpandGatePending = true
    try {
      const allowed = await gateCheck(NSF_CHECKLIST_GATE_PRODUCT_ID, '星舰飞行检查清单')
      if (!allowed) return
      wx.navigateTo({
        url: '/subpackages/progress-extra/event-detail?mode=nsf_checklist'
      })
    } finally {
      this._nsfExpandGatePending = false
    }
  },

  onLl2TimelineExpandTap() {
    wx.navigateTo({ url: '/subpackages/progress-extra/event-detail?mode=ll2_timeline' })
  },

  onLl2LaunchUpdatesExpandTap() {
    wx.navigateTo({ url: '/subpackages/progress-extra/event-detail?mode=ll2_launch_updates' })
  },

  loadLl2LaunchUpdates() {
    // in-flight 去重：starship 状态加载与首屏下方延迟调度两条路径可能各触发一次
    if (this._ll2UpdatesInflight) return this._ll2UpdatesInflight
    this._ll2UpdatesInflight = this._doLoadLl2LaunchUpdates().finally(() => {
      this._ll2UpdatesInflight = null
    })
    return this._ll2UpdatesInflight
  },

  async _doLoadLl2LaunchUpdates() {
    const manualId = String(this.data.ll2TrackedLaunchId || '').trim()
    const enabled = this.data.showLaunchLibraryUpdates !== false
    const autoStarship = !manualId
    if (!enabled) {
      this.setData({
        ll2LaunchUpdates: [],
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: ''
      })
      return
    }
    this.setData({ ll2LaunchUpdatesLoading: true, ll2LaunchUpdatesError: '' })
    try {
      const res = await fetchLl2LaunchUpdates(manualId, 15, { autoStarship })
      const list = (res.list || []).map((item) => ({
        ...item,
        timeLabel: this.formatEventTime(item.createdOn)
      }))
      this.setData({
        ll2LaunchUpdates: list,
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: ''
      })
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      this.setData({
        ll2LaunchUpdates: [],
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: formatLl2AutoError(raw)
      })
    }
  },

  onRefreshLl2LaunchUpdates() {
    if (this.data.ll2LaunchUpdatesLoading) return
    this.loadLl2LaunchUpdates()
  },

  loadLl2LaunchTimeline() {
    if (this._ll2TimelineInflight) return this._ll2TimelineInflight
    this._ll2TimelineInflight = this._doLoadLl2LaunchTimeline().finally(() => {
      this._ll2TimelineInflight = null
    })
    return this._ll2TimelineInflight
  },

  async _doLoadLl2LaunchTimeline() {
    const manualId = String(this.data.ll2TrackedLaunchId || '').trim()
    const enabled = this.data.showLaunchLibraryUpdates !== false
    const autoStarship = !manualId
    if (!enabled) {
      this.setData({
        ll2TimelineRows: [],
        ll2TimelineLoading: false,
        ll2TimelineError: ''
      })
      return
    }
    this.setData({ ll2TimelineLoading: true, ll2TimelineError: '' })
    try {
      const res = await fetchLl2LaunchTimeline(manualId, { autoStarship })
      const rows = normalizeLl2TimelineList(res.timeline || [])
      this.setData({
        ll2TimelineRows: rows,
        ll2TimelineLoading: false,
        ll2TimelineError: ''
      })
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      this.setData({
        ll2TimelineRows: [],
        ll2TimelineLoading: false,
        ll2TimelineError: formatLl2AutoError(raw)
      })
    }
  },

  onRefreshLl2Timeline() {
    if (this.data.ll2TimelineLoading) return
    this.loadLl2LaunchTimeline()
  },

  onStarshipImageError(e) {
    const type = e.currentTarget.dataset.type
    if (type === 'booster') {
      this.setData({
        'starshipData.booster.image': getBoosterFallbackImage(),
        'starshipData.booster.images': [getBoosterFallbackImage()]
      })
      return
    }

    if (type === 'ship') {
      this.setData({
        'starshipData.ship.image': getShipFallbackImage(),
        'starshipData.ship.images': [getShipFallbackImage()]
      })
    }
  },

  getStarshipImagesByType(type) {
    const key = type === 'ship' ? 'ship' : 'booster'
    const item = (this.data.starshipData && this.data.starshipData[key]) || {}
    const fallback = key === 'ship' ? getShipFallbackImage() : getBoosterFallbackImage()

    const list = []
    if (Array.isArray(item.images)) list.push(...item.images)
    if (Array.isArray(item.previewImages)) list.push(...item.previewImages)
    if (item.image) list.unshift(item.image)

    const images = [...new Set(list.filter(Boolean))]

    return images.length ? images : [fallback]
  },

  async onStarshipCardTap(e) {
    const type = e.currentTarget.dataset.type || 'booster'
    const selectedType = type === 'ship' ? 'ship' : 'booster'
    this.setData({ selectedStarshipType: selectedType })
    // 组合体进展两张卡片不门控：统一进硬件设施详情
    await this._openStarshipVehicleDetail(selectedType)
  },

  /**
   * 打开组合体对应硬件详情：优先 NSF 硬件库 id，匹配失败才回退旧详情页。
   */
  async _openStarshipVehicleDetail(selectedType) {
    const item = (this.data.starshipData || {})[selectedType] || {}
    let vehicleId = item.hardwareId
    if (vehicleId == null) {
      vehicleId = await this._resolveHardwareVehicleId(
        item.id || item.name,
        selectedType
      )
    }
    if (vehicleId != null) {
      wx.navigateTo({
        url: `/subpackages/progress-extra/hardware-detail?id=${vehicleId}`
      })
      return
    }
    wx.navigateTo({
      url: `/subpackages/progress-extra/starship-detail?type=${selectedType}`
    })
  },

  /** 'Ship 40' → 'S40'，'Booster 20' → 'B20' */
  _shortVehicleId(name) {
    const m = String(name || '').trim().match(/^(Ship|Booster)\s+(.+)$/i)
    if (!m) return ''
    return (m[1].toLowerCase() === 'ship' ? 'S' : 'B') + m[2].replace(/\s+/g, '').toUpperCase()
  },

  /**
   * 当前载具 = 该分类下状态 Active 且 ordering 最小（与云端 sync 逻辑一致）
   * @param {any[]} [list] 不传时用已加载的 _hardwareAll
   */
  _pickCurrentHardwareVehicle(category, list) {
    const all = list || this._hardwareAll || []
    let best = null
    for (let i = 0; i < all.length; i++) {
      const v = all[i]
      if (!v || v.category !== category) continue
      if (String(v.status || '').toLowerCase() !== 'active') continue
      if (!best || v.ordering < best.ordering) best = v
    }
    return best
  },

  /**
   * 用「星舰硬件设施」Active 载具覆盖组合体两张卡片的编号/状态/图片。
   * 硬件列表未加载时不改动；保证卡片始终跟自动数据对齐，不依赖后台手填。
   */
  _overlayStarshipCardsFromHardware() {
    const all = this._hardwareAll
    if (!all || !all.length) return
    if (!this.data.starshipLoaded) return

    const patch = {}
    const sides = ['ship', 'booster']
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i]
      const cur = this._pickCurrentHardwareVehicle(side)
      if (!cur) continue

      const shortId = this._shortVehicleId(cur.name) || String(cur.name || '').trim()
      if (!shortId) continue

      const fallback = side === 'ship' ? getShipFallbackImage() : getBoosterFallbackImage()
      const prev = (this.data.starshipData && this.data.starshipData[side]) || {}
      const image = cur.image || prev.image || fallback
      const statusEn = String(cur.status || '').toUpperCase() || 'ACTIVE'
      const statusZh = cur.statusZh || statusEn
      const detail = prev.detail || {}

      patch[`starshipData.${side}.id`] = shortId
      patch[`starshipData.${side}.name`] = cur.name
      patch[`starshipData.${side}.hardwareId`] = cur.id
      patch[`starshipData.${side}.status`] = statusZh
      patch[`starshipData.${side}.statusType`] = this.getStatusType(statusEn)
      patch[`starshipData.${side}.image`] = image
      patch[`starshipData.${side}.images`] = cur.image ? [cur.image] : (prev.images || [image])
      patch[`starshipData.${side}.detail`] = {
        ...detail,
        title: detail.title || cur.name || ((side === 'ship' ? '星舰' : '助推器') + shortId),
        statusText: statusZh,
        summary: cur.notesZh || detail.summary || '',
        heroImage: image || detail.heroImage || ''
      }
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  /**
   * 组合体卡片编号（如 S39 / B19）或全称（Ship 39）→ NSF 硬件库 vehicle id。
   * 优先用「星舰硬件设施」板块已加载的列表；未加载时读缓存接口兜底。
   */
  async _resolveHardwareVehicleId(serial, type) {
    const key = String(serial || '').trim().toLowerCase().replace(/[\s/]+/g, '')

    let all = this._hardwareAll
    if (!all || !all.length) {
      try {
        const res = await getStarshipHardwareFromDB()
        all = (res.vehicles || []).map((v) => ({
          ...v,
          searchKey: this._buildHardwareSearchKey(v.name)
        }))
      } catch (err) {
        return null
      }
    }

    if (key) {
      // 1) 搜索键精确命中（Ship 39 → s39 / ship39 等缩写段）
      const hit = all.find((v) => {
        const segs = String(v.searchKey || this._buildHardwareSearchKey(v.name)).split('|')
        return segs.indexOf(key) >= 0
      })
      if (hit && hit.id != null) return hit.id

      // 2) 数字兜底：类别 + 编号数字匹配（命名差异如 Starship 39 时仍可命中）
      const m = /^([bs])(\d+)$/.exec(key)
      if (m) {
        const cat = m[1] === 'b' ? 'booster' : 'ship'
        const num = m[2]
        const hit2 = all.find((v) =>
          v.category === cat && String(v.name || '').replace(/\D+/g, '') === num
        )
        if (hit2 && hit2.id != null) return hit2.id
      }
    }

    // 3) 编号缺失或过期时取当前 Active 载具（后台数据没人维护时的主要兜底）
    if (type === 'ship' || type === 'booster') {
      const cur = this._pickCurrentHardwareVehicle(type, all)
      if (cur && cur.id != null) return cur.id
    }
    return null
  },

  stopPropagation() {},

  onStarshipCardLongPress(e) {
    const type = e.currentTarget.dataset.type || 'booster'
    const images = this.getStarshipImagesByType(type)
    const imageUrl = images[0]
    if (!imageUrl) return

    wx.showActionSheet({
      itemList: ['保存图片'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.saveImageToAlbum(imageUrl)
        }
      }
    })
  },

  async saveImageToAlbum(imageUrl) {
    if (!imageUrl) return

    const app = getApp && getApp()
    if (app && typeof app.ensurePrivacyAuthorized === 'function') {
      const privacyRes = await app.ensurePrivacyAuthorized()
      if (privacyRes && privacyRes.ok === false) {
        wx.showToast({ title: '请先同意隐私指引后再保存图片', icon: 'none' })
        return
      }
    }

    wx.showLoading({ title: '保存中...', mask: true })

    const onSuccess = () => {
      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })
    }

    const onFail = (err) => {
      wx.hideLoading()
      const msg = (err && err.errMsg) || ''
      if (msg.includes('auth deny') || msg.includes('authorize')) {
        wx.showModal({
          title: '需要授权',
          content: '请在设置中开启"保存到相册"权限',
          showCancel: false
        })
        return
      }
      wx.showToast({ title: '保存失败', icon: 'none' })
    }

    if (/^https?:\/\//.test(imageUrl)) {
      pooledDownloadFile({ url: imageUrl })
        .then((res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: onSuccess, fail: onFail })
          } else {
            onFail({ errMsg: 'download fail' })
          }
        })
        .catch(onFail)
      return
    }

    wx.saveImageToPhotosAlbum({ filePath: imageUrl, success: onSuccess, fail: onFail })
  },

  openStarbaseMap() {
    navigateTo(ROUTES.STARBASE_MAP)
  },

  openLaunchSiteMap() {
    navigateTo(ROUTES.LAUNCH_SITE_MAP)
  },

  openRoadClosureMap() {
    if (!this.data.roadClosure || !this.data.roadClosure.isActive) return
    const query = [
      'message=' + encodeURIComponent(this.data.roadClosure.message || ''),
      'timeRange=' + encodeURIComponent(this.data.roadClosure.timeRange || '')
    ].join('&')
    wx.navigateTo({ url: ROUTES.ROAD_CLOSURE_MAP + '?' + query })
  },

  openRoadClosureDetail() {
    navigateTo(ROUTES.ROAD_CLOSURE_DETAIL)
  },

  async loadRoadClosureNotice() {
    if (this.data.roadClosureStatus !== 'active') {
      this.setData({ roadClosureStatus: 'loading' })
    }
    try {
      const data = await getRoadClosureNotice()
      const status = resolveRoadClosureStatus(data)
      if (status === 'active') {
        this.setData({
          roadClosure: buildRoadClosureState(data, formatDate),
          roadClosureStatus: 'active'
        })
      } else {
        this.setData({
          roadClosure: { ...EMPTY_ROAD_CLOSURE },
          roadClosureStatus: status
        })
      }
    } catch (error) {
      this.setData({
        roadClosure: { ...EMPTY_ROAD_CLOSURE },
        roadClosureStatus: 'error'
      })
    }
  },

  async onSyncRoadClosure() {
    if (this.data.roadClosureSyncing) return
    this.setData({ roadClosureSyncing: true })

    try {
      await syncRoadClosureFromCloud()
    } catch (e) {
    }

    await this.loadRoadClosureNotice()

    // 第三步：如果仍无数据，提示用户手动录入
    if (!this.data.roadClosure.isActive) {
      this.setData({ roadClosureSyncing: false })
      wx.showModal({
        title: '自动抓取暂不可用',
        content: '无法从 starbase.texas.gov 获取数据。是否手动录入当前封路信息？',
        confirmText: '手动录入',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.showManualRoadClosureInput()
          }
        }
      })
      return
    }

    wx.showToast({ title: '同步成功', icon: 'success' })
    this.setData({ roadClosureSyncing: false })
  },

  async showManualRoadClosureInput() {
    const that = this
    wx.showModal({
      title: '需要验证',
      editable: true,
      placeholderText: '请输入操作密码',
      async success(res) {
        if (!res.confirm) return
        const input = (res.content || '').trim()
        if (!input) {
          wx.showToast({ title: '请输入密码', icon: 'none' })
          return
        }
        try {
          const verified = await verifyRoadClosurePassword(input)
          if (verified) {
            that.showRoadClosureForm()
          } else {
            wx.showToast({ title: '密码错误', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '验证失败，请重试', icon: 'none' })
        }
      }
    })
  },

  showRoadClosureForm() {
    const that = this
    let inputMsg = ''
    let inputTime = ''

    wx.showModal({
      title: '星舰基地封路通知内容',
      editable: true,
      placeholderText: '如：Boca Chica Beach 已关闭',
      success(res) {
        if (!res.confirm) return
        inputMsg = (res.content || '').trim()
        if (!inputMsg) {
          wx.showToast({ title: '内容不能为空', icon: 'none' })
          return
        }

        wx.showModal({
          title: '时间范围（可选）',
          editable: true,
          placeholderText: '如：Mar. 9 8:00 AM - 8:00 PM',
          success(res2) {
            inputTime = (res2.content || '').trim()
            that.saveManualRoadClosure(inputMsg, inputTime)
          }
        })
      }
    })
  },

  async saveManualRoadClosure(message, timeRange) {
    try {
      wx.showLoading({ title: '保存中...' })
      await saveManualRoadClosureNotice(message, timeRange)
      wx.hideLoading()
      await this.loadRoadClosureNotice()
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败: ' + (e.errMsg || e.message || ''), icon: 'none' })
    }
  },

  /** 原生三点下拉刷新（页面级 / scroll-view refresher 共用）
   *  只重读云数据库缓存：不触发 NSF 抓取、不重拉 LL2（节奏由云函数自动分配） */
  onScrollRefresh() {
    this._runProgressPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runProgressPullRefresh()
  },

  _runProgressPullRefresh(key) {
    runPullRefresh(this, () => Promise.all([
      this.loadStarshipStatusFromDB({ syncNsf: true, skipLl2: true }),
      this.loadRoadClosureNotice(),
      this.loadStarshipHardware(true),
      this.loadEventUpdates(true, undefined, { silent: true })
    ]).catch(() => {}), key)
  },

  // ── 星舰硬件设施 ──

  async loadStarshipHardware(skipCache) {
    try {
      const res = await getStarshipHardwareFromDB({ skipCache: !!skipCache })
      const list = (res.vehicles || []).map((item, idx) => {
        const fallback = item.category === 'booster' || item.category === 'fullstack'
          ? getBoosterFallbackImage()
          : getShipFallbackImage()
        // 仅预览 2 条触发图缓存预热；其余保留远程 URL，避免进进度 Tab 全量 COS 下行
        const displayImage = !item.image
          ? fallback
          : (idx < HARDWARE_PREVIEW_COUNT
            ? getCachedMediaImage(item.image, 'thumb')
            : item.image)
        return {
          ...item,
          statusType: this.getStatusType(item.status),
          displayImage,
          searchKey: this._buildHardwareSearchKey(item.name)
        }
      })
      this._hardwareAll = list
      this.setData({
        hardwareLoaded: true,
        hardwareError: list.length === 0 ? (res.fetchError || '暂无数据，稍后下拉刷新重试') : ''
      })
      this._applyHardwareFilter()
      // 硬件就绪后覆盖组合体卡片（编号/状态/图片跟 Active 载具走）
      this._overlayStarshipCardsFromHardware()
    } catch (e) {
      this.setData({ hardwareLoaded: true, hardwareError: '加载失败，请下拉刷新重试' })
    }
  },

  _buildHardwareSearchKey(name) {
    const lower = String(name || '').toLowerCase()
    const noSpace = lower.replace(/[\s/]+/g, '')
    const abbrev = lower
      .replace(/booster\s*/g, 'b')
      .replace(/starship\s*/g, '')
      .replace(/ship\s*/g, 's')
      .replace(/[\s/]+/g, '')
    return `${lower}|${noSpace}|${abbrev}`
  },

  /** 预览截断：搜索能力已收敛到完整列表页（hardware-list），此处只做条数截断 */
  _applyHardwareFilter() {
    const all = this._hardwareAll || []
    this.setData({
      hardwareVisible: all.slice(0, HARDWARE_PREVIEW_COUNT)
    })
  },

  /** 标题右侧「查看全部」→ 完整列表页；与卡片点击共用同一门控 */
  async onHardwareViewAllTap() {
    const allowed = await gateCheck('starship_hardware', '星舰硬件设施')
    if (!allowed) return
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    }
    wx.navigateTo({
      url: '/subpackages/progress-extra/hardware-list'
    })
  },

  async onHardwareCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (id == null) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('starship_hardware', '星舰硬件设施')
    if (!allowed) return
    wx.navigateTo({
      url: `/subpackages/progress-extra/hardware-detail?id=${id}`
    })
  },

  onHardwareImageError(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.hardwareVisible[idx]
    if (!item) return
    const fallback = item.category === 'booster' || item.category === 'fullstack'
      ? getBoosterFallbackImage()
      : getShipFallbackImage()
    if (item.displayImage === fallback) return
    this.setData({ [`hardwareVisible[${idx}].displayImage`]: fallback })
  },

  _eventCacheKey: '_event_updates_local_cache',
  _eventCacheTTL: 30 * 60 * 1000,

  async loadEventVideoConfig() {
    try {
      // 走 feature-flags 的 global_config 共享缓存（5 分钟 + inflight 去重），
      // 避免每次进页直读一次云库同一文档；fail-closed，读不到配置不放出视频
      const { isPlaybackAllowed } = require('../../utils/feature-flags.js')
      const enabled = await isPlaybackAllowed()
      this.setData({ enableEventVideo: enabled })
    } catch (e) {}
  },

  _loadTweetAccountStats() {
    var self = this
    if (!wx.cloud) return
    var canShowChips = canUsePaidCloudSync()
    // 非会员不展示账号胶囊，但仍拉今日总数供标题红角标
    if (!canShowChips && (this.data.tweetAccountStats || []).length) {
      this.setData({ tweetAccountStats: [] })
    }
    // 推文统计为当日聚合数据，10 分钟内进页复用缓存，不重复打云函数
    var TTL = 10 * 60 * 1000
    var now = Date.now()
    var cached = this._tweetStatsCache
    if (cached && now - cached.at < TTL) {
      var cachedPatch = { tweetEventTotal: cached.total || 0 }
      if (canShowChips && cached.stats && cached.stats.length > 0) {
        cachedPatch.tweetAccountStats = cached.stats
      }
      this.setData(cachedPatch)
      if (canShowChips) this._updateTweetStatsChipsOverflowHint()
      return
    }
    wx.cloud.callFunction({
      name: 'userDataGateway',
      data: { action: 'getTodayTweetStats' }
    }).then(function (res) {
      var result = res.result || {}
      if (!result.success) return
      var total = typeof result.total === 'number' ? result.total : 0
      var stats = (result.tweetStats && result.tweetStats.length > 0) ? result.tweetStats : []
      self._tweetStatsCache = { at: Date.now(), stats: stats, total: total }
      var patch = { tweetEventTotal: total }
      if (canShowChips && stats.length > 0) {
        patch.tweetAccountStats = stats
      }
      self.setData(patch)
      if (canShowChips) self._updateTweetStatsChipsOverflowHint()
    }).catch(function () {})
  },

  /** 胶囊条是否溢出可滑动：控制右侧渐隐提示（与首页发射商胶囊一致） */
  _updateTweetStatsChipsOverflowHint() {
    const query = wx.createSelectorQuery().in(this)
    query.select('.tweet-stats-scroll').boundingClientRect()
    query.select('.tweet-stats-chips-row').boundingClientRect()
    query.exec((res) => {
      const scrollRect = res && res[0]
      const rowRect = res && res[1]
      const hasOverflow = !!(scrollRect && rowRect && rowRect.width > scrollRect.width + 2)
      if (hasOverflow !== this.data.tweetStatsChipsHasOverflow) {
        this.setData({ tweetStatsChipsHasOverflow: hasOverflow })
      }
    })
  },

  /** 横向滑动：按 scrollLeft 阶梯触发中度震动（复用首页发射商胶囊手感） */
  onTweetStatsChipsScroll(e) {
    const left = Math.max(0, Number((e.detail && e.detail.scrollLeft) || 0))
    const stepPx = 52
    const bucket = Math.floor(left / stepPx)
    if (this._tweetStatsScrollHapticBucket == null) {
      this._tweetStatsScrollHapticBucket = bucket
      return
    }
    if (bucket === this._tweetStatsScrollHapticBucket) return
    const jumps = Math.min(Math.abs(bucket - this._tweetStatsScrollHapticBucket), 4)
    for (let i = 0; i < jumps; i++) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    }
    this._tweetStatsScrollHapticBucket = bucket
  },

  /** 事件更新胶囊 → 按账号进入列表详情（PRO 门控；与简报胶囊逻辑一致但进度 Tab 单独拦截） */
  async onTweetAccountTap(e) {
    var allowed = await gateCheck('starship_progress_event_source', '星舰事件更新 · 按账号查看')
    if (!allowed) return
    var ds = e.currentTarget.dataset || {}
    var list = this.data.tweetAccountStats || []
    var item = list[ds.index]
    if (!item && ds.index !== undefined && ds.index !== '') {
      var n = parseInt(ds.index, 10)
      if (!isNaN(n)) item = list[n]
    }
    var screenName = (item && item.screenName) || ds.source || ''
    if (!screenName) return
    var params = { source: String(screenName) }
    var label = (item && item.label) || ds.label
    if (label) params.label = String(label)
    navigateTo(ROUTES.EVENT_DETAIL, params)
  },

  // 头像 fallback：source (screenName) → COS 头像 URL
  _avatarFallback: {
    SpaceX: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg',
    elonmusk: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/elonmusk.jpg',
    Starlink: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/Starlink.jpg',
    NASASpaceflight: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/NASASpaceflight.jpg',
    StarshipGazer: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/StarshipGazer.jpg',
    NASA: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/NASA.jpg'
  },

  _enrichEventItem(item) {
    const enrichedMediaList = (item.mediaList || []).map(m => {
      if (m.type !== 'video') {
        if (m.type === 'image' && m.url) {
          // 列表卡片用 thumb，避免 medium 全量双拉
          return { ...m, url: getCachedMediaImage(m.url, 'thumb') }
        }
        return m
      }
      return enrichVideoMediaItem(m, { getCachedMediaImage, thumbPreset: 'thumb' })
    })

      // 头像：优先 COS 地址，代理地址视为无效
      let avatar = item.authorAvatar || ''
      if (avatar && !avatar.includes('.cos.')) avatar = ''
      if (!avatar && item.source && this._avatarFallback[item.source]) avatar = this._avatarFallback[item.source]
      if (avatar) avatar = getCachedMediaImage(avatar, 'thumb')

      return {
        ...item,
        mediaList: enrichedMediaList,
        publishedAtText: this.formatEventTime(item.publishedAt),
        authorAvatar: avatar,
        imageUrls: enrichedMediaList.filter(m => m.type === 'image').map(m => m.url),
      _liveStatus: 0,
      _liveCover: '',
      _liveTitle: ''
    }
  },

  /** 缓存里若仍有英文正文（未翻译），应跳过本地缓存走云库 */
  _eventCacheHasUntranslated(list) {
    const rows = Array.isArray(list) ? list : []
    return rows.some((evt) => {
      if (!evt) return false
      if (evt.translated === false) return true
      const content = String(evt.content || '').trim()
      if (!content) return false
      return !/[\u4e00-\u9fff]/.test(content)
    })
  },

  async loadEventUpdates(refresh, filterSource, opts = {}) {
    if (this.data.eventUpdatesLoading) return
    this.setData({ eventUpdatesLoading: true })

    // 保存筛选条件
    if (filterSource !== undefined) {
      this._filterSource = filterSource || ''
    }

    // silent（下拉刷新）：已有列表时不先清空（避免闪“加载中”占位），成功后整页替换
    if (refresh && !(opts.silent && (this.data.eventUpdates || []).length > 0)) {
      this.setData({ eventUpdates: [], eventUpdatesNoMore: false })
    }

    const skip = refresh ? 0 : this.data.eventUpdates.length

    if (skip === 0 && !this._filterSource) {
      try {
        const cached = storageCache.readMemOrSync(this._eventCacheKey, null)
        if (cached && cached.timestamp && (Date.now() - cached.timestamp < this._eventCacheTTL)) {
          if (!this._eventCacheHasUntranslated(cached.data)) {
            const items = (cached.data || []).map(item => this._enrichEventItem(item))
            this.setData({
              eventUpdates: items,
              eventUpdatesNoMore: items.length < 10,
              eventUpdatesLoading: false,
              eventUpdatesError: ''
            })
            this._scheduleLiveStatusCheck(items)
            return
          }
        }
      } catch (e) {}
    }

    try {
      const db = wx.cloud.database()
      const limit = 10
      const where = { status: 'published' }
      if (this._filterSource) {
        where.source = this._filterSource
      }
      const res = await db.collection('starship_event_updates')
        .where(where)
        .orderBy('publishedAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()

      const newItems = (res.data || []).map(item => this._enrichEventItem(item))

      const merged = refresh ? newItems : this.data.eventUpdates.concat(newItems)
      this.setData({
        eventUpdates: merged,
        eventUpdatesNoMore: newItems.length < limit,
        eventUpdatesLoading: false,
        eventUpdatesError: ''
      })

      if (skip === 0 && res.data && res.data.length > 0) {
        try {
          storageCache.persistAsync(this._eventCacheKey, { data: res.data, timestamp: Date.now() })
        } catch (e) {}
      }

      this._scheduleLiveStatusCheck(merged)
    } catch (e) {
      if (isPermissionDenied(e)) {
        this.setData({ eventUpdatesLoading: false, eventUpdatesError: getPermissionDeniedMessage() })
      } else {
        this.setData({ eventUpdatesLoading: false })
      }
    }
  },

  _extractRoomId(raw) {
    if (!raw) return ''
    const m = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
    return m ? m[1] : String(raw).replace(/\D/g, '')
  },

  _scheduleLiveStatusCheck(items) {
    const liveItems = (items || []).filter((it) => it.liveRoomId)
    if (!liveItems.length) return
    if (this._liveStatusDeferTimer) clearTimeout(this._liveStatusDeferTimer)
    this._liveStatusDeferTimer = setTimeout(() => {
      this._liveStatusDeferTimer = null
      this._checkLiveStatus(items)
    }, PROGRESS_LIVE_STATUS_DEFER_MS)
  },

  async _checkLiveStatus(items) {
    const liveItems = (items || []).filter(it => it.liveRoomId)
    if (!liveItems.length) return

    const roomIds = [...new Set(liveItems.map(it => this._extractRoomId(it.liveRoomId)))]
    const statusMap = await fetchLiveStatusBatch(roomIds)

    let updates = this.data.eventUpdates || []
    for (const roomId of roomIds) {
      const { liveStatus, cover, liveTitle } = parseLiveStatus(statusMap[roomId])
      updates = updates.map(it => {
        if (it.liveRoomId && this._extractRoomId(it.liveRoomId) === roomId) {
          return {
            ...it,
            _liveStatus: liveStatus,
            _liveCover: it.liveCover || cover,
            _liveTitle: liveTitle
          }
        }
        return it
      })
    }
    this.setData({ eventUpdates: updates })
  },

  findEventUpdateItem(id, idx) {
    const list = this.data.eventUpdates || []
    if (id) {
      const matched = list.find(item => String(item && item._id) === String(id))
      if (matched) return matched
    }
    const numericIdx = Number(idx)
    if (!Number.isNaN(numericIdx) && numericIdx >= 0 && numericIdx < list.length) {
      return list[numericIdx]
    }
    return null
  },

  buildEventUpdateShareOptions(item) {
    const safeItem = item && typeof item === 'object' ? item : null
    const titleText = safeItem && (safeItem.title || safeItem.content)
      ? String(safeItem.title || safeItem.content).trim()
      : '星舰事件更新'
    const eventId = safeItem && safeItem._id ? String(safeItem._id) : ''

    return {
      title: `${titleText} | 火星探索日志`,
      path: eventId ? `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(eventId)}` : '/pages/progress/progress',
      imageUrl: pickEventShareImageUrl(safeItem)
    }
  },

  openEventDetail(e) {
    const eventId = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    if (!eventId) return
    wx.navigateTo({
      url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}`
    })
  },

  onEventItemTouchStart(e) {
    const eventId = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    if (!eventId) return
    this.setData({ pressedEventId: String(eventId) })
  },

  onEventItemTouchEnd() {
    if (!this.data.pressedEventId) return
    this.setData({ pressedEventId: '' })
  },

  openEventShareSheet(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const item = this.findEventUpdateItem(dataset.id, dataset.idx)
    if (!item || !item._id) return
    this.setData({
      showEventShareSheet: true,
      selectedEventShareId: String(item._id),
      pressedEventId: ''
    })
  },

  closeEventShareSheet() {
    this.setData({
      showEventShareSheet: false,
      selectedEventShareId: '',
      pressedEventId: ''
    })
  },

  onEventShareButtonTap() {
    this.setData({ showEventShareSheet: false, pressedEventId: '' })
  },

  openSelectedEventDetailForShare() {
    const eventId = this.data.selectedEventShareId
    this.setData({ showEventShareSheet: false, pressedEventId: '' })
    if (!eventId) return
    wx.navigateTo({
      url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}`,
      success: () => {
        wx.showToast({
          title: '打开右上角可分享到朋友圈/收藏',
          icon: 'none',
          duration: 2200
        })
      }
    })
  },

  stopPropagation() {},

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

  onLiveCardTap(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const item = this.data.eventUpdates[idx]
    if (!item) return

    const rid = this._extractRoomId(item.liveRoomId)
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

  formatEventTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  onEventImagePreview(e) {
    const dataset = e.currentTarget.dataset || {}
    const urls = dataset.urls || []
    const current = dataset.current || urls[0]
    if (!urls.length) return
    wx.previewImage({ urls, current })
  },

  /** 推文视频播放为会员权益；非会员点封面弹开通引导（一次广告只解锁当前这条视频） */
  async _eventVideoPlayAllowed(opts) {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) return true
      if (isProSync()) return true
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
    const eventId = dataset.eventid || ''
    const mIdx = dataset.midx
    const videoUrl = dataset.videourl || ''
    const isLong = !!dataset.islong
    if (!url && !dataset.playurl) return

    // 非会员：只展示封面，点击触发门控，不播放不下载
    const playAllowed = await this._eventVideoPlayAllowed({
      eventId,
      mediaIndex: mIdx,
      url: dataset.playurl || url
    })
    if (!playAllowed) return

    // 长视频未存储，点击直接复制视频直链
    if (isLong || videoUrl) {
      wx.setClipboardData({
        data: videoUrl || dataset.sourceurl || url,
        success() {
          wx.showToast({ title: '视频链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
        }
      })
      return
    }

    // COS 可播视频：跳转详情页自动播压缩预览
    if (isVideoUrl(url) || isVideoUrl(dataset.playurl)) {
      if (eventId) {
        wx.navigateTo({
          url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}&autoPlayVideo=${mIdx}`
        })
      } else {
        await playEventVideo({
          url,
          playUrl: dataset.playurl || url,
          originalUrl: dataset.original || url,
          thumb: dataset.thumb || '',
          videoUrl: '',
          sourceUrl: dataset.sourceurl || '',
          isLong: false,
          // 原片保存仅 Pro/已购；广告解锁只放行预览播放
          canSave: canSaveOriginalVideoSync('starship_event_list_full'),
          onSaveHint: () => {}
        })
      }
      return
    }

    // 外部链接（如 x.com），直接复制到剪贴板
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      }
    })
  },

  async onVideoSaveOriginal(e) {
    const dataset = e.currentTarget.dataset || {}
    const original = dataset.original || dataset.url
    if (!original || !isVideoUrl(original)) return
    if (dataset.islong || dataset.videourl) return
    // 原片体积大（COS 成本高）：仅 Pro/已购放行，不提供广告通道
    if (!canUsePaidCloudSync()) {
      const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 原视频下载', { allowAd: false })
      if (!allowed) return
    }
    await saveEventOriginalVideo(original)
  },

  async onEventScrollToLower() {
    if (this.data.eventUpdatesNoMore || this.data.eventUpdatesLoading) return
    // Tab 展开态翻页：非会员触底弹开通引导（enableEventListGate 关闭则放行）
    if (!canUsePaidCloudSync()) {
      const policy = await getMemberPolicy()
      if (policy.enableEventListGate) {
        if (this._eventGateChecking) return
        this._eventGateChecking = true
        try {
          const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 完整浏览')
          if (!allowed) return
        } finally {
          this._eventGateChecking = false
        }
      }
    }
    this.loadEventUpdates(false)
  },

  onEventScrollRefresh() {
    runPullRefresh(this, () => this.loadEventUpdates(true, undefined, { silent: true }), 'eventScrollRefreshing')
  },

  toggleEventUpdatesExpanded() {
    this.setData({ eventUpdatesExpanded: !this.data.eventUpdatesExpanded })
  },

  /** 查看更多事件更新 → 进入详情页列表模式；入口不设门控，页内免费前 5 条，翻页/播视频再拦 */
  openEventUpdatesList() {
    const params = { mode: 'list_all' }
    if (this._filterSource) params.source = this._filterSource
    navigateTo(ROUTES.EVENT_DETAIL, params)
  },

  onAvatarError(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const idx = this.data.eventUpdates.findIndex(item => item._id === id)
    if (idx >= 0) {
      this.setData({ [`eventUpdates[${idx}]._avatarError`]: true })
    }
  },

  onShareAppMessage(e) {
    if (e && e.from === 'button' && e.target && e.target.dataset) {
      const shareType = e.target.dataset.shareType

      if (shareType === 'eventUpdateItem') {
        const item = this.findEventUpdateItem(e.target.dataset.id)
        return this.buildEventUpdateShareOptions(item)
      }

      if (shareType === 'roadClosure') {
        const rc = this.data.roadClosure
        const lines = ['星舰基地封路通知']
        if (rc && rc.message) lines.push(rc.message)
        if (rc && rc.timeRange) lines.push('时间: ' + rc.timeRange)
        // 直达详情页并带上文案，朋友圈单页/未登录读不到云库时也能兜底渲染
        const parts = []
        if (rc && rc.message) parts.push('message=' + encodeURIComponent(String(rc.message).slice(0, 120)))
        if (rc && rc.timeRange) parts.push('timeRange=' + encodeURIComponent(rc.timeRange))
        const sourceLabel = rc && rc.source === 'starbase_gov' ? 'Starbase.gov'
          : rc && rc.source === 'spacedevs' ? 'SpaceDevs'
          : rc && rc.source === 'manual' ? '管理员' : ''
        if (sourceLabel) parts.push('source=' + encodeURIComponent(sourceLabel))
        return {
          title: lines.join(' | ') + ' | 火星探索日志',
          path: ROUTES.ROAD_CLOSURE_DETAIL + (parts.length ? '?' + parts.join('&') : '')
        }
      }
    }
    return {
      title: 'SpaceX星舰建造与火箭回收进度 | 火星探索日志',
      path: '/pages/progress/progress'
    }
  },

  onShareTimeline() {
    const latest = (this.data.eventUpdates || [])[0] || null
    let imageUrl = ''
    if (latest && Array.isArray(latest.mediaList)) {
      const firstImage = latest.mediaList.find(m => m && m.type === 'image' && m.url)
      if (firstImage) {
        imageUrl = firstImage.url
      } else {
        const firstVideo = latest.mediaList.find(m => m && m.type === 'video' && m.thumbnailUrl)
        if (firstVideo) imageUrl = firstVideo.thumbnailUrl
      }
    }
    return {
      title: latest && latest.title ? `事件更新：${latest.title} | 火星探索日志` : '星舰事件更新 | 火星探索日志',
      imageUrl
    }
  }
})
