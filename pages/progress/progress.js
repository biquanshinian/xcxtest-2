// pages/progress/progress.js
const themeUtil = require('../../utils/theme.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { getRoadClosureNotice } = require('../../utils/api-road-closure.js')
const {
  getStarshipStatusFromDB,
  getNsfStarshipChecklistFromDB,
  getStarshipHardwareFromDB
} = require('../../utils/api-app-services.js')
const { formatDate } = require('../../utils/util.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')
const {
  EMPTY_ROAD_CLOSURE,
  resolveRoadClosureStatus,
  buildRoadClosureState
} = require('../../utils/progress-road-closure.js')
const { isLiveEntryAllowed, isFeatureEnabled } = require('../../utils/feature-flags.js')
const { pickEventShareImageUrl } = require('../../utils/event-share-image.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { gateCheck, isProSync } = require('../../utils/membership.js')
const {
  warmProgressPageStorageSync,
  OPENCLAW_GUIDE_DISMISSED_KEY,
  BRIEFING_PROGRESS_FILTER_CLEAR_KEY,
  BRIEFING_PROGRESS_FILTER_SOURCE_KEY
} = require('../../utils/page-storage-boot.js')
const storageCache = require('../../utils/storage-sync-cache.js')

const PROGRESS_LAST_VIEWED_KEY = '_progress_last_viewed'

const NSF_CHECKLIST_GATE_PRODUCT_ID = 'starship_flight_checklist'
/** 首屏后再拉取折叠区（LL2 时间线/动态、推文统计等） */
const PROGRESS_BELOW_FOLD_DEFER_MS = 1200

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

// ========== 低频/折叠区逻辑：在 progress-extra 分包（progress-lazy.js） ==========
// 长按保存图片、封路手动录入、LL2 折叠区、事件动态（列表/推文统计/直播/视频/分享面板）
// 均为点击或首屏后延迟才发生，require.async + attachTo 委托加载
const PROGRESS_LAZY_PKG = '../../subpackages/progress-extra/utils/progress-lazy.js'
const PROGRESS_LAZY_METHODS = [
  'saveImageToAlbum',
  'onSyncRoadClosure',
  'showManualRoadClosureInput',
  'showRoadClosureForm',
  'saveManualRoadClosure',
  // LL2 折叠区（发射时间线 / 官方动态）
  'loadLl2LaunchUpdates',
  'onRefreshLl2LaunchUpdates',
  'loadLl2LaunchTimeline',
  'onRefreshLl2Timeline',
  // 事件动态：加载与推文统计
  'loadEventVideoConfig',
  'loadEventUpdates',
  '_loadTweetAccountStats',
  'onTweetStatsChipsScroll',
  'onTweetAccountTap',
  // 事件动态：交互
  'openEventDetail',
  'openEventShareSheet',
  'closeEventShareSheet',
  'onEventShareButtonTap',
  'openSelectedEventDetailForShare',
  'onFlightChecklistDetailTap',
  'onLiveCardTap',
  'onEventImagePreview',
  'onEventImageLongPress',
  'closeEventImageSavePicker',
  'toggleEventImageSaveSelect',
  'selectAllEventImageSave',
  'confirmEventImageSavePicker',
  'onVideoThumbnailTap',
  'onVideoSaveOriginal',
  'onEventScrollToLower',
  'onEventScrollRefresh',
  'toggleEventUpdatesExpanded',
  'openEventUpdatesList',
  'onAvatarError'
]

// event-updates 分包组件（事件更新区）回传事件白名单：
// 组件 sectionevent → onProgressSectionEvent 还原分发；
// 除 onEventItemTouchStart/End 在本页定义外，其余均经 progress-lazy 委托
const PROGRESS_SECTION_EVENT_METHODS = [
  'openEventUpdatesList',
  'onTweetStatsChipsScroll',
  'onTweetAccountTap',
  'openEventDetail',
  'onEventItemTouchStart',
  'onEventItemTouchEnd',
  'openEventShareSheet',
  'onEventImagePreview',
  'onEventImageLongPress',
  'onVideoThumbnailTap',
  'onVideoSaveOriginal',
  'onLiveCardTap',
  'onEventShareButtonTap',
  'onEventScrollRefresh',
  'onEventScrollToLower',
  'toggleEventUpdatesExpanded',
  'onAvatarError'
]
function delegateProgressLazy(name) {
  return function (...args) {
    const page = this
    if (page.__progressLazyAttached) return page[name](...args)
    if (!page.__progressLazyLoadPromise) {
      page.__progressLazyLoadPromise = require.async(PROGRESS_LAZY_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__progressLazyLoadPromise = null
        console.error('[Progress] 分包模块加载失败:', err)
        wx.showToast({ title: '模块加载失败，请检查网络后重试', icon: 'none' })
        throw err
      })
    }
    return page.__progressLazyLoadPromise.then(() => page[name](...args))
  }
}
const progressLazyDelegates = {}
PROGRESS_LAZY_METHODS.forEach((name) => {
  progressLazyDelegates[name] = delegateProgressLazy(name)
})

Page({
  ...progressLazyDelegates,
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

    isLiveEntryAllowed().then((on) => {
      this.setData({ enableLiveEntry: !!on })
    }).catch(() => {})

    // 与直播入口同一份 global_config 缓存，不产生额外读库
    isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then((on) => {
      if (on) this.setData({ enableMissionSim: true })
    }).catch(() => {})

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
    // 过审直播入口开关（isLiveEntryAllowed，failClosed）：关闭时不渲染 B 站直播卡、不查直播状态
    enableLiveEntry: false,
    // 星舰任务指挥室入口（enableMissionSim，failClosed）：过审时整卡隐藏
    enableMissionSim: false,
    showEventShareSheet: false,
    showEventImageSavePicker: false,
    eventImageSaveThumbs: [],
    eventImageSaveOriginals: [],
    eventImageSaveSelected: [],
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

      // 写入全局共享：starship-detail / starbase-map / event-detail 10 分钟内直接复用，不重复读库
      try {
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.starshipStatus = { data, fetchedAt: Date.now() }
        }
      } catch (e) {}

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

  // 封路手动同步 / 录入流程在 progress-extra 分包（经顶部 progressLazyDelegates 委托加载）

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

  /** 星舰任务指挥室入口（PRO 门控；专属 id 不在 PRODUCTS 单品表内 → 弹窗只提供开通星际通行证） */
  async openMissionSim() {
    if (!this.data.enableMissionSim) return
    if (this._missionSimGatePending) return
    this._missionSimGatePending = true
    try {
      const allowed = await gateCheck('mission_sim', '星舰任务指挥室')
      if (!allowed) return
      if (wx.vibrateShort) {
        try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
      }
      wx.navigateTo({ url: '/subpackages/mission-sim/mission-sim' })
    } finally {
      this._missionSimGatePending = false
    }
  },

  /** 在轨飞行器追踪独立页（与 ODC 控制台入口同一门控产品，会员解锁一处两处通行） */
  async openVehicleTracker() {
    if (this._vtGatePending) return
    this._vtGatePending = true
    try {
      const allowed = await gateCheck('orbital_data_center', '在轨飞行器追踪')
      if (!allowed) return
      navigateTo(ROUTES.VEHICLE_TRACKER)
    } finally {
      this._vtGatePending = false
    }
  },

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
      : '事件更新'
    const eventId = safeItem && safeItem._id ? String(safeItem._id) : ''

    return {
      title: `${titleText} | 火星探索日志`,
      path: eventId ? `/subpackages/progress-extra/event-detail?id=${encodeURIComponent(eventId)}` : '/pages/progress/progress',
      imageUrl: pickEventShareImageUrl(safeItem)
    }
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

  /** 事件更新区组件统一事件通道：还原 currentTarget.dataset / detail 后分发给对应方法 */
  onProgressSectionEvent(e) {
    const { name, dataset, edetail } = (e && e.detail) || {}
    if (!name || PROGRESS_SECTION_EVENT_METHODS.indexOf(name) < 0 || typeof this[name] !== 'function') return
    return this[name]({ currentTarget: { dataset: dataset || {} }, detail: edetail || {} })
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
    const titleText = latest && (latest.title || latest.content)
      ? String(latest.title || latest.content).trim()
      : '事件更新'
    return {
      title: `${titleText} | 火星探索日志`,
      imageUrl: pickEventShareImageUrl(latest)
    }
  }
})
