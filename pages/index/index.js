// pages/index/index.js
const themeUtil = require('../../utils/theme.js')
const { getUpcomingMissions, getCompletedMissions } = require('../../utils/api-launch-list.js')
const { getRoadClosureNotice } = require('../../utils/api-road-closure.js')
const { getActiveAnnouncement } = require('../../utils/api-monitor-data.js')
const {
  shareMission,
  getLaunchStatsFromDB,
  getSpaceXLaunchStats,
  getVoteStats,
  getVoteStatsStale,
  castVote,
  fetchLiveLaunchStatuses,
  fetchLl2LaunchUpdates,
  fetchRecentSettledLaunches
} = require('../../utils/api-app-services.js')
const {
  inferTerminalStatusFromUpdates,
  buildSettledRowFromUpdates
} = require('../../utils/ll2-updates-outcome.js')
const { computeLaunchDelayInfo } = require('../../utils/launch-delay.js')
const { getStatusCategory, getStatusBadgeText, isTerminalStatusId } = require('../../utils/api-request.js')
const { isDemoActive, isLiveAccount, startDemo, startRemoteControl } = require('../../utils/demo-engine.js')
const { isPlaybackAllowed } = require('../../utils/feature-flags.js')
const {
  filterExpiredMissions,
  getStatusTextZh,
  formatSecondsText,
  getSecondsReel,
  DEFAULT_ROCKET_IMAGE,
  DEFAULT_SHARE_IMAGE,
  DEFAULT_CAROUSEL_ITEMS,
  getInitialVoteState,
  buildVoteState,
  buildDualVoteUiPatch,
  mergeVoteBundle,
  getLocalVote,
  saveLocalVote,
  removeLocalVote,
  shouldSkipVoteRefresh,
  shouldSkipLaunchStatsRefresh,
  shouldSkipSimpleRefresh,
  setMissionDetailCacheEntry,
  buildDetailPrefetchQueue
} = require('../../utils/index-page-helpers.js')

const { formatDate, getCountdown, resolveMissionRocketImage, isDefaultRocketSrc, shouldReplaceRocketImage } = require('../../utils/util.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { resolveRoadClosureStatus } = require('../../utils/progress-road-closure.js')
const {
  fetchMissionListData,
  buildMissionListSetData,
  getMissionNextOffset,
  mergeMissionPages,
} = require('../../utils/index-mission-services.js')
const {
  buildMissionListViewUpdateData,
  buildMissionReadyState,
  getMissionScrollTopField,
  getMissionScrollTopValue,
  buildMissionTypeSwitchState,
  buildMissionScrollProgressState,
  buildMissionScrollPositionState,
  shouldScheduleMissionCardMeasurement,
  buildMissionCardHapticState,
  buildCompletedMissionLoadErrorState,
  buildMissionListErrorState,
  buildLoadMoreFallbackState
} = require('../../utils/index-mission-state.js')
const {
  buildHomeLaunchPanelState,
  formatHomeLaunchTime,
  formatHomeLaunchTimeParts,
  buildCurrentLaunchPanelState,
  getNextUpcomingLaunch,
  buildCountdownSubscriptionState,
  buildLaunchSwitchEffects,
  shouldRefreshExpiredLaunch,
  shouldAutoSwitchCountdown,
  buildCountdownTickState,
  buildCountdownLoopMeta,
  buildMissionCardCountdownTickPatch,
  attachCardCountdownToMissions,
  buildUpcomingLaunchEmptyState,
  buildUpcomingLaunchErrorState,
  mergePreservedRocketImages
} = require('../../utils/index-launch-state.js')
const {
  resolveMissionDetailSourceData,
  buildMissionDetailNavigation,
  buildMissionShareOptions,
  attachMissionDetailMeta,
  resolveMissionSharePayload,
  collectMissionShareCandidates
} = require('../../utils/index-mission-nav.js')
const { loadMoreInteraction, missionCardCountdown } = require('../../utils/config.js')
const config = require('../../utils/config.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { getCachedMediaImage, preloadRocketConfigMedia } = require('../../utils/icon-cache.js')
const { getCachedVideo } = require('../../utils/video-cache.js')
const { eventVideoAdUnlockId, playEventVideo } = require('../../utils/event-video.js')

/** 视频号直播（分包懒加载，与详情页同源） */
const CHANNELS_LIVE_PATH = '../../subpackages/shared/utils/channels-live.js'
const CHANNELS_LIVE_POLL_LIVE_MS = 75 * 1000
const CHANNELS_LIVE_POLL_IDLE_MS = 4 * 60 * 1000
/** 点击圆图进直播前的过渡动画时长（与 CSS cd-live-enter 对齐） */
const CHANNELS_LIVE_ENTER_MS = 220
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
const { pooledDownloadFile } = require('../../utils/download-pool.js')
const { toCdnUrl, optimizeImageUrl, carouselVideoPosterUrl } = require('../../utils/cos-url.js')
const { markDownloadFailed } = require('../../utils/download-fail-cache.js')
const { getUiShellLayout, getFloatingActionDragBounds } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { subscribeLaunch, unsubscribeLaunch, isSubscribed, getSubscribedMissionIdSet, syncSubscriptionState, warmSubscribedStoreSync, warmSubscribedStoreAsync } = require('../../utils/subscribe.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { getMembershipState, isMembershipEnabled, isProSync, canUsePaidCloudSync, canPrefetchVideoSync, gateCheck, warmMembershipStateSync, warmMembershipStateAsync } = require('../../utils/membership.js')
const { getMemberPolicy, getMemberPolicySync } = require('../../utils/member-policy.js')
const { fetchMainConfig } = require('../../utils/feature-flags.js')
const { warmUserPreferencesSync, warmBriefingPopupShownSync } = require('../../utils/user-growth.js')
const {
  persistAgencyLogoAfterRemoteLoad,
  isRemoteAgencyLogoUrl
} = require('../../utils/agency-logo-cache.js')
const { enrichMissionsLaunchAgencyImages } = require('../../utils/upcoming-agency-logo-enrich.js')
const {
  buildUpcomingAgencyFilterState,
  getAgencyKeyFromMission
} = require('../../utils/upcoming-agency-filter.js')

const {
  computeLaunchCalendarSignature,
  LAUNCH_CALENDAR_ACK_SIG_KEY
} = require('../../utils/launch-calendar-signature.js')

// 倒计时到点实时状态确认：LL2 状态更新有滞后，T-0 后先显示「状态确认中」，
// T+10 分钟才发第一次请求；之后每 5 分钟复查（云端 live 缓存 120s，多数命中缓存）；
// 30 分钟未决兜底切换。时序示例：T+10 首查 → T+15/20/25 复查 → T+30 兜底。
const LIVE_STATUS_FIRST_CHECK_DELAY_MS = 10 * 60 * 1000
const LIVE_STATUS_RECHECK_MS = 5 * 60 * 1000
const LIVE_STATUS_MAX_WAIT_MS = 30 * 60 * 1000
const LIVE_STATUS_MIN_ROUND_GAP_MS = 30 * 1000
const LL2_UPDATES_MEM_TTL_MS = 5 * 60 * 1000
const RECENT_SETTLED_MEM_TTL_MS = 10 * 60 * 1000

// 非会员任务列表免费可见条数（即将发射 / 历史发射各自计）；
// 会员功能未开启、Pro 用户或广告解锁期内不限制
const FREE_MISSION_LIST_LIMIT = 10

const CALENDAR_PKG = '../../subpackages/index-extra/utils/index-calendar-page.js'
const CALENDAR_METHODS = [
  '_processCalendarMission','getMissionTypeCategory','inferLaunchSiteKey','getMissionStatusCategoryForCalendar',
  'buildCalendarMissionQueryMeta','buildCalendarSiteOptions','getCalendarFilterSummaryText','getMissionMapLinkMeta',
  'buildStarbaseFacilityQuery','buildRoadClosureQuery','getFilteredCalendarMissions',
  'buildCalendarDateMapFromMissions',
  'buildCalendarDerivedPayload','updateCalendarDerivedState','applyCalendarBatchState','restoreCalendarCacheSnapshot',
  'fetchCalendarMissionPage','fetchCalendarMissionBatch','resetCalendarLoadFailureState','finishCalendarAppendWithoutChanges',
  'applyCalendarMissionSnapshot','_refreshLaunchCalendarDot','hydrateCalendarFromLoadedMissionLists','syncCalendarFromMissionListsIfNeeded',
  'loadCalendarData','_continueLoadCalendarDataAfterCacheMiss','_loadMoreCalendarData','_saveCalendarCache','_isMonthCovered',
  'buildCalendarDayCells','shouldAutoLoadMoreCalendarMonth','buildCalendarDays','switchCalendarMonth','calendarPrevMonth',
  'calendarNextMonth','calendarGoToday','onCalendarMonthTitleTap','onCalendarMonthPickerChange','onCalendarDateTap',
  'toggleCalendarFilterPanel','applyCalendarFilterState','onCalendarQuickFilterTap','onCalendarSiteFilterTap',
  'onCalendarStatusFilterTap','resetCalendarFilters','buildMapEntryList','openCalendarMapLink','onCalendarSwipeStart',
  'onCalendarSwipeEnd','_patchCalendarMissionRocketImage',
  'loadLaunchStats','goGlobalLaunchStats'
]
function delegateCalendar(name) {
  return function (...args) {
    const page = this
    if (page.__calendarAttached) return page[name](...args)
    if (!page.__calendarLoadPromise) {
      page.__calendarLoadPromise = require.async(CALENDAR_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      })
    }
    return page.__calendarLoadPromise.then(() => page[name](...args))
  }
}
const calendarDelegates = {}
CALENDAR_METHODS.forEach((name) => { calendarDelegates[name] = delegateCalendar(name) })

const PINNED_UPCOMING_MISSION_STORAGE_KEY = '_idx_pinned_upcoming_mission_id'

// 开屏动画：本地缓存的配置 + 已下载媒体文件路径（冷启动零网络等待）
const SPLASH_CACHE_KEY = '_splash_screen_cache'

const COS_DEMO_QR_URL = toCdnUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E4%BA%8C%E7%BB%B4%E7%A0%81/1775323336594_jkl6zv.png')

// 临时：NASA × FIFA 球迷节悬浮入口（活动下线后整段删除）
const COS_WORLDCUP_LOGO_URL = toCdnUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%A0%87/1781152428682_whvs5h.svg')
const WORLDCUP_FLOAT_STORAGE_KEY = '_idx_worldcup_float_pos'
const WORLDCUP_FLOAT_GAP_PX = 12

/** 活动是否进行中：开始按北京时间 6/11（国内用户当天即可见），结束按休斯顿 UTC-5 的 7/19 闭幕日终 */
function isWorldcupEventActive() {
  const nowMs = Date.now()
  return nowMs >= Date.parse('2026-06-11T00:00:00+08:00')
    && nowMs < Date.parse('2026-07-20T00:00:00-05:00')
}

/** 世界杯悬浮球：活动期内且可播视频开关开启（过审关 enableEventVideo 时隐藏） */
function resolveWorldcupFloatVisible() {
  if (!isWorldcupEventActive()) return Promise.resolve(false)
  return isPlaybackAllowed().catch(() => false)
}

function sortPinnedMissionFirst(list, pinnedId) {
  if (!pinnedId || !Array.isArray(list) || !list.length) return list.slice()
  const pid = String(pinnedId)
  const idx = list.findIndex((m) => m && String(m.id) === pid)
  if (idx <= 0) return list.slice()
  const next = list.slice()
  const [row] = next.splice(idx, 1)
  return [row, ...next]
}

const CAROUSEL_CONFIG_CACHE_KEY = '_carousel_global_config_cache'
const CAROUSEL_CONFIG_CACHE_TTL = 10 * 60 * 1000
/** 首屏等待云媒体映射的最大时间，超时后继续拉列表，避免长时间白屏 */
const LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS = 2500

const ROAD_CLOSURE_REFRESH_TTL = 5 * 60 * 1000
const SPACEX_STATS_REFRESH_TTL = 10 * 60 * 1000
// 竞猜刷新间隔：此前 15s，每次切 Tab 回首页都会重新打 adminGateway（skipCache=true 绕过本地缓存）。
// 投票后的最新票数由 castVote 返回值直接回填 bundle，不依赖这里的定时刷新；
// 防降级复核路径会先把 loadedAt 归零再触发，也不受该 TTL 影响。
const VOTE_REFRESH_TTL = 5 * 60 * 1000
const LAUNCH_STATS_REFRESH_TTL = 5 * 60 * 1000

Page({
  ...calendarDelegates,
  onLoad(options) {
    this._pageLoadAt = Date.now()
    // 朋友圈分享只能携带 query 参数（不能指定 path），因此用户从朋友圈点击进来
    // 总是落到首页。这里检测 query 是否带 mission id，若有就直接跳详情页，
    // 实现"打开即看到该任务详情"的体验。
    if (options && options.id) {
      const detailType = options.type === 'completed' ? 'completed' : 'upcoming'
      wx.navigateTo({
        url: '/pages/mission-detail/mission-detail?id=' + encodeURIComponent(options.id) + '&type=' + detailType
      })
    }

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0,
        currentPath: '/pages/index/index'
      })
    }
    
    // 获取系统信息，初始化状态栏高度
    const app = getApp()
    const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
    this._windowHeight = uiShellLayout.windowHeight || 0
    const windowWidth = uiShellLayout.windowWidth || 375
    this._cachedWindowWidth = windowWidth

    // 极端环境下该 API 可能抛错/返回空，兜底避免 onLoad 中断导致整页白屏
    let menuBtn = null
    try { menuBtn = wx.getMenuButtonBoundingClientRect() } catch (e) {}
    if (!menuBtn || !menuBtn.height) {
      menuBtn = {
        top: (uiShellLayout.statusBarHeight || 44) + 4,
        height: 32,
        left: windowWidth - 96
      }
    }

    // 临时：NASA × FIFA 球迷节悬浮按钮限时显示；过审关闭视频时一并隐藏
    this.setData({
      themeClass: themeUtil.getThemeClassSync(),
      themeLight: themeUtil.isLightSync(),
      pageBgColor: themeUtil.getPageBgSync(),
      statusBarHeight: uiShellLayout.statusBarHeight,
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      tabBarReservedHeight: uiShellLayout.tabBarReservedHeight,
      compactCdTop: menuBtn.top,
      compactCdHeight: menuBtn.height,
      compactCdRight: windowWidth - menuBtn.left + 8,
      isProUser: false,
      missionSwipeActionWidthPx: Math.round((windowWidth * 176) / 750),
      pinnedUpcomingMissionId: '',
      worldcupFloatVisible: false
    })

    resolveWorldcupFloatVisible().then((worldcupFloatVisible) => {
      if (!worldcupFloatVisible) return
      this.setData({ worldcupFloatVisible: true })
      this._scheduleWorldcupFloatLayoutInit()
    })

    // 置顶 id / Pro 态非首屏必需：异步读 storage，避免阻塞首帧
    wx.getStorage({
      key: PINNED_UPCOMING_MISSION_STORAGE_KEY,
      success: (res) => {
        const pv = res.data
        if (pv == null || pv === '') return
        const pinnedInit = String(pv)
        const patch = { pinnedUpcomingMissionId: pinnedInit }
        this.applyUpcomingAgencyFilterToPatch(patch)
        this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      }
    })
    setTimeout(() => {
      try {
        warmSubscribedStoreSync()
        warmMembershipStateSync()
        warmUserPreferencesSync()
        warmBriefingPopupShownSync()
        fetchMainConfig() // 预热会员策略 / 流量档
      } catch (e) {}
      try {
        this._refreshMembershipAndAgencyFilter()
      } catch (e) {}
      try {
        this._updateCarouselAutoplayGate()
      } catch (e) {}
      try {
        this._updateMissionListGate()
      } catch (e) {}
    }, 0)

    // 延后 + 分片清理，避免大对象同步展开/写存储卡死主线程
    setTimeout(() => {
      try {
        this.sanitizeMissionDetailCacheStore()
      } catch (e) {}
    }, 400)

    // ── 首屏优化：把所有可能触发同步存储读取/网络请求的逻辑推迟到下一个 tick ──
    // 微信「启动性能」分析对首屏渲染前的 wx.getStorageSync 累计调用做硬性告警。
    // 通过 setTimeout(fn, 0) 把这些调用排到首屏渲染队列之后，
    // 既不影响实际数据加载的最终时机（仍在同一帧内启动），又避免阻塞首帧绘制。
    setTimeout(() => {
      try { warmSubscribedStoreAsync() } catch (e) {}
      try { warmMembershipStateAsync() } catch (e) {}
      void loadCloudMediaMap().catch(() => {})

      // 竞猜预取：用上次会话缓存的首个可竞猜任务 id 提前发起云端查询，
      // 与任务列表加载并行（结果在 loadVoteData 中复用），显著缩短竞猜框首次出现时间
      wx.getStorage({
        key: '_vote_eligible_ids',
        success: (res) => {
          const ids = Array.isArray(res.data) ? res.data : []
          const firstId = ids[0] ? String(ids[0]) : ''
          if (!firstId) return
          this._votePrefetchId = firstId
          this._votePrefetchPromise = getVoteStats(firstId, false, null).catch(() => null)
        }
      })

      this.loadInitialData()
      this.loadSplashScreen().then(() => {
        // 无开屏动画时，首屏稳定后主动检查隐私授权；有开屏则由 closeSplash 触发
        if (!this.data.splashVisible) {
          setTimeout(() => this._maybePromptPrivacy(), 300)
        }
      }).catch(() => {})

      // 首屏后：轮播/封路（与倒计时面板相关，略延后）
      setTimeout(() => {
        Promise.all([
          this.loadRoadClosureNotice(),
          this.loadCarouselImages()
        ]).catch(() => {})
      }, 100)

      // 首屏稳定后再探视频号直播，避免抢首屏预算
      setTimeout(() => {
        this.refreshCountdownChannelsLive({ schedule: true })
      }, 1600)

      // 首屏预算结束后：统计横幅、公告、会员态（非首屏必需）
      setTimeout(() => {
        this.loadSpaceXStats()
        this.loadAnnouncementBanner()
        Promise.all([isMembershipEnabled(), getMembershipState()])
          .then(() => {
            try {
              this._refreshMembershipAndAgencyFilter()
            } catch (e) {}
          })
          .catch(() => {})
      }, LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS)
    }, 0)

    // 预加载日历任务数据，让简报弹窗能直接读取按北京日期分组的任务
    setTimeout(() => {
      try {
        this.loadCalendarData(true)
      } catch (e) {}
    }, 300)

    // 倒计时是纯计时器（无存储读取），保持原位以便最早进入计时
    this.startCountdown()
  },

  onShow() {
    // 主题兜底同步：在其他 Tab 切了主题后回到本 Tab（getCurrentPages 只含当前栈，切主题时刷不到本页）
    themeUtil.applyThemeToPage(this)

    // 切回前台/Tab：按真实时间重算并恢复倒计时（onHide 已暂停，避免后台空跑）
    this.startCountdown()

    // 开屏倒计时在 onHide 被停表：开屏仍可见则续跑
    if (this._splashTimerPaused && this.data.splashVisible && !this.data.splashFading) {
      this._splashTimerPaused = false
      this._resumeSplashTimer()
    }

    // 临时：世界杯活动入口生命周期复查——活动到期或过审关视频后立即消失
    resolveWorldcupFloatVisible().then((wcActive) => {
      if (this.data.worldcupFloatVisible !== wcActive) {
        this.setData({ worldcupFloatVisible: wcActive })
        if (wcActive) this._scheduleWorldcupFloatLayoutInit()
      } else if (wcActive && this.data.worldcupFloatReady) {
        const clamped = this._clampWorldcupFloatPos(this.data.worldcupFloatX, this.data.worldcupFloatY)
        if (clamped.x !== this.data.worldcupFloatX || clamped.y !== this.data.worldcupFloatY) {
          this.setData({ worldcupFloatX: clamped.x, worldcupFloatY: clamped.y })
        }
      }
    })

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      tabBar.setData({
        selected: 0,
        currentPath: '/pages/index/index'
      })
      setTimeout(() => {
        try {
          getApp().checkProgressDot(tabBar)
          getApp().checkProfileDot(tabBar)
          getApp().checkNewsDot(tabBar)
        } catch (e) {}
      }, 1200)
    }

    // 非首屏必需：排到首帧后，避免 onShow 生命周期长任务告警
    setTimeout(() => {
      const app = getApp && getApp()
      try {
        if (app && typeof app.syncAllTabBarsDesktopStrip === 'function') app.syncAllTabBarsDesktopStrip()
      } catch (e) {}

      wx.getStorage({
        key: 'profile_open_search',
        success: (res) => {
          if (res.data) {
            wx.removeStorage({ key: 'profile_open_search' })
            navigateTo(ROUTES.SEARCH)
          }
        }
      })

      if (!this._demoInited) {
        try {
          this._initDemoMode()
        } catch (e) {}
      }

      // 续费提醒兜底入口：给太空简报约 6s 决定是否弹窗；
      // 简报若弹出则此次跳过，由简报的 closed 事件接力触发
      if (this._renewalCheckTimer) clearTimeout(this._renewalCheckTimer)
      this._renewalCheckTimer = setTimeout(() => {
        this._tryShowRenewalReminder()
      }, 6000)

      if (this.data.carouselItems && this.data.carouselItems.length > 0) {
        this._activateCarouselVideos(this.data.carouselCurrent || 0)
        this._startCarouselTimer()
      }

      // 回前台：恢复直播动效并复查视频号状态
      if (this.data.channelsLiveAnimPaused) {
        this.setData({ channelsLiveAnimPaused: false })
      }
      this.refreshCountdownChannelsLive({ schedule: true })

      if (this.data.launchData && this.data.launchData.id) {
        const launchId = this.data.launchData.id
        const subPatch = buildCountdownSubscriptionState(this.data.launchData, null, this._getPageSubscribedIdSet())
        if (subPatch._countdownSubscribed !== this.data._countdownSubscribed) {
          this.setData(subPatch)
        }
        if (this._voteDeferTimer) clearTimeout(this._voteDeferTimer)
        this._voteDeferTimer = setTimeout(() => {
          this._voteDeferTimer = null
          if (this.data.launchData && String(this.data.launchData.id) === String(launchId)) {
            // onShow 走 5 分钟投票缓存即可（skipCache 会把每次切 Tab 都变成真实云调用）；
            // 用户提交投票后的即时刷新由 _scheduleVoteRecheck(skipCache=true) 负责
            this.loadVoteData(launchId, false)
          }
        }, 800)
        syncSubscriptionState(this.data.launchData.id).then((subscribed) => {
          this._invalidatePageSubscribedIdSet()
          if (this.data._countdownSubscribed !== subscribed) {
            this.setData({ _countdownSubscribed: subscribed })
          }
          this._syncDisplayedUpcomingSwipeRowFlags()
        })
      } else {
        this._syncDisplayedUpcomingSwipeRowFlags()
      }

      // 冷启动 3s 内 onLoad 已调度会员/筛选刷新，避免 onShow 重复 setData
      const sinceLoad = Date.now() - (this._pageLoadAt || 0)
      if (sinceLoad >= 3000) {
        this._refreshMembershipAndAgencyFilter()
        Promise.all([isMembershipEnabled(), getMembershipState()])
          .then(() => {
            try {
              this._refreshMembershipAndAgencyFilter()
            } catch (e) {}
            try {
              this._updateCarouselAutoplayGate()
            } catch (e) {}
            try {
              this._updateMissionListGate()
            } catch (e) {}
          })
          .catch(() => {})
      }

      // 从详情返回：强制拉 recent_settled，把「飞行中」等滞后角标修成终态
      if (Array.isArray(this.data.completedMissions) && this.data.completedMissions.length) {
        this._applyRecentSettledToCompletedList(true).catch(() => {})
      }
    }, 0)
  },

  /** 临时：跳转 NASA × FIFA 球迷节活动页（活动下线后随悬浮按钮一起删除） */
  onOpenWorldcupEvent() {
    navigateTo(ROUTES.WORLDCUP_EVENT)
  },

  _isAddDesktopStripVisible() {
    try {
      if (typeof this.getTabBar !== 'function') return false
      const tabBar = this.getTabBar()
      return !!(tabBar && tabBar.data && tabBar.data.showAddDesktopStrip)
    } catch (e) {
      return false
    }
  },

  _getWorldcupDragBounds() {
    const app = getApp && getApp()
    const sys = getSystemInfo()
    const layout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(sys)
    return getFloatingActionDragBounds(sys, {
      showAddDesktopStrip: this._isAddDesktopStripVisible(),
      btnSize: Math.round((layout.windowWidth || sys.windowWidth || 375) / 750 * 96)
    })
  },

  _clampWorldcupFloatPos(x, y) {
    const b = this._getWorldcupDragBounds()
    return {
      x: Math.max(b.minX, Math.min(b.maxX, x)),
      y: Math.max(b.minY, Math.min(b.maxY, y))
    }
  },

  _scheduleWorldcupFloatLayoutInit() {
    if (this._worldcupLayoutInitTimer) clearTimeout(this._worldcupLayoutInitTimer)
    this._worldcupLayoutInitTimer = setTimeout(() => {
      this._worldcupLayoutInitTimer = null
      this._initWorldcupFloatLayout()
    }, 80)
  },

  _initWorldcupFloatLayout() {
    if (!this.data.worldcupFloatVisible) return

    if (this._worldcupUserPositioned) {
      const clamped = this._clampWorldcupFloatPos(this.data.worldcupFloatX, this.data.worldcupFloatY)
      this.setData({
        worldcupFloatX: clamped.x,
        worldcupFloatY: clamped.y,
        worldcupFloatReady: true
      })
      return
    }

    try {
      const cached = wx.getStorageSync(WORLDCUP_FLOAT_STORAGE_KEY)
      if (cached && typeof cached.x === 'number' && typeof cached.y === 'number') {
        const clamped = this._clampWorldcupFloatPos(cached.x, cached.y)
        this._worldcupUserPositioned = true
        this.setData({
          worldcupFloatX: clamped.x,
          worldcupFloatY: clamped.y,
          worldcupFloatReady: true
        })
        return
      }
    } catch (e) {}

    this._syncWorldcupBelowNasaFloat()
  },

  _syncWorldcupBelowNasaFloat(nasaPos) {
    if (!this.data.worldcupFloatVisible || this._worldcupUserPositioned) return

    let nasa = nasaPos
    if (!nasa) {
      const comp = this.selectComponent('#nasaFloat')
      if (comp && typeof comp.getFloatPosition === 'function') {
        nasa = comp.getFloatPosition()
      }
    }
    const bounds = this._getWorldcupDragBounds()
    if (!nasa || !nasa.btnSize) {
      const sys = getSystemInfo()
      const btnSize = bounds.btnSize
      const btnX = sys.windowWidth - btnSize - bounds.edgeMargin
      const btnY = Math.round(sys.windowHeight * 0.65)
      nasa = { btnX, btnY, btnSize }
    }

    let wcY = nasa.btnY + nasa.btnSize + WORLDCUP_FLOAT_GAP_PX
    if (wcY > bounds.maxY) {
      wcY = Math.max(bounds.minY, nasa.btnY - nasa.btnSize - WORLDCUP_FLOAT_GAP_PX)
    }
    const clamped = this._clampWorldcupFloatPos(nasa.btnX, wcY)
    this.setData({
      worldcupFloatX: clamped.x,
      worldcupFloatY: clamped.y,
      worldcupFloatReady: true
    })
  },

  onNasaFloatPositionChange(e) {
    const detail = (e && e.detail) || {}
    if (!detail.btnSize) return
    this._syncWorldcupBelowNasaFloat(detail)
  },

  onWorldcupTouchStart(e) {
    const t = e.touches[0]
    this._wcTouchStartX = t.clientX
    this._wcTouchStartY = t.clientY
    this._wcStartFloatX = this.data.worldcupFloatX
    this._wcStartFloatY = this.data.worldcupFloatY
    this._wcDragging = false
  },

  onWorldcupTouchMove(e) {
    const t = e.touches[0]
    const dx = t.clientX - this._wcTouchStartX
    const dy = t.clientY - this._wcTouchStartY
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this._wcDragging = true
    const clamped = this._clampWorldcupFloatPos(this._wcStartFloatX + dx, this._wcStartFloatY + dy)
    this._wcPendingX = clamped.x
    this._wcPendingY = clamped.y
    const now = Date.now()
    if (!this._wcLastMoveSetAt || now - this._wcLastMoveSetAt >= 16) {
      this._wcLastMoveSetAt = now
      this.setData({ worldcupFloatX: clamped.x, worldcupFloatY: clamped.y })
    }
  },

  onWorldcupTouchEnd() {
    if (this._wcDragging) {
      if (this._wcPendingX != null) {
        this.setData({ worldcupFloatX: this._wcPendingX, worldcupFloatY: this._wcPendingY })
      }
      this._snapWorldcupFloatToEdge()
      this._worldcupUserPositioned = true
      try {
        wx.setStorageSync(WORLDCUP_FLOAT_STORAGE_KEY, {
          x: this.data.worldcupFloatX,
          y: this.data.worldcupFloatY
        })
      } catch (e) {}
      return
    }
    this.onOpenWorldcupEvent()
  },

  _snapWorldcupFloatToEdge() {
    const bounds = this._getWorldcupDragBounds()
    const { btnSize, windowWidth, edgeMargin } = bounds
    const btnX = this.data.worldcupFloatX
    const btnY = this.data.worldcupFloatY
    const newX = (btnX + btnSize / 2) < (windowWidth / 2) ? edgeMargin : windowWidth - btnSize - edgeMargin
    const clamped = this._clampWorldcupFloatPos(newX, btnY)
    this.setData({ worldcupFloatX: clamped.x, worldcupFloatY: clamped.y })
  },

  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    /** 临时：NASA × FIFA 球迷节悬浮入口（限时 2026-06-11 ~ 07-19，onLoad/onShow 按日期门控） */
    worldcupFloatVisible: false,
    worldcupLogoUrl: COS_WORLDCUP_LOGO_URL,
    worldcupFloatX: 0,
    worldcupFloatY: 0,
    worldcupFloatReady: false,
    missionType: 'upcoming', // upcoming / completed / calendar
    /** 发射日历：日历合并数据相对上次「已读摘要」有变动则显示；进入日历 Tab 即清除 */
    showLaunchCalendarDot: false,
    // 任务卡片长按 → 分享面板（朋友/群 + 朋友圈）
    shareSheetVisible: false,
    pendingShareMission: { id: '', detailType: '', missionName: '', rocketName: '' },
    // 预下载到本地的分享缩略图（wxfile:// 或 http://tmp/...），用于规避 iOS 朋友圈/网络分享缩略图加载失败
    shareImage: '',
    launchData: {},
    formattedLaunchTime: '',
    formattedLaunchDate: '',
    formattedLaunchWeekTime: '',
    // 当前任务的推迟徽标文案（如「已推迟 2 次 · 累计 3 天」），无推迟/无数据时为空
    launchDelayText: '',
    countdown: {
      days: '',
      hours: '',
      minutes: '',
      seconds: '',
      isExpired: false
    },
    countdownSecondsPrev: '',
    countdownSecondsCurrent: '',
    countdownSecondsRolling: false,
    countdownSecondsReel: [],
    upcomingMissions: [],
    /** 「即将发射」按发射服务商筛选 */
    selectedUpcomingAgencyKey: '_all',
    upcomingAgencyChipsDisplayed: [],
    upcomingAgencyChipsHasOverflow: false,
    displayedUpcomingMissions: [],
    /** 即将发射卡片火箭图倒计时：默认仅前 N 张显示 */
    missionCardCountdownVisibleCount: (missionCardCountdown && missionCardCountdown.visibleCount) || 2,
    upcomingAgencyFilterEmpty: false,
    pinnedUpcomingMissionId: '',
    missionSwipeOpenWxkey: '',
    missionSwipeDragWxkey: '',
    missionSwipeDragPx: 0,
    missionSwipeActionWidthPx: 88,
    /** PRO：发射商筛选生效；FREE：仍可横向浏览胶囊，点选非「所有任务」走会员引导 */
    isProUser: false,
    completedMissions: [],
    carouselImages: [],
    carouselItems: [],
    carouselCurrent: 0,
    carouselImageDuration: 5000,
    carouselVideoDuration: 5000,
    carouselLoadFailed: false,
    // 吸顶精简倒计时
    showCompactCountdown: false,
    compactCdTop: 0,
    compactCdHeight: 32,
    compactCdRight: 100,
    loadError: false,
    errorMessage: '',
    missionsLoadError: false,
    missionsErrorMessage: '',
    showMissionsEmpty: false,
    /** 首屏任务列表尚未返回：列表区显示骨架占位，避免空白/白屏感知 */
    missionsInitialLoading: true,
    showImageActionSheet: false,
    currentImageUrl: '',
    // 任务列表分页：无限滚动
    missionsOffset: 0,
    missionsHasMore: true,
    missionsLoadingMore: false,
    /** 非会员任务列表可见条数上限；0 = 不限制。
     * 初始按「可能开启会员」收紧为免费额度，避免 onLoad 竞态窗口里先拉 50 条 / 可翻页；
     * _updateMissionListGate 异步确认后会放宽（会员关 / Pro / 广告解锁 → 0） */
    missionGateLimit: FREE_MISSION_LIST_LIMIT,
    loadMoreLowerThreshold: (loadMoreInteraction && loadMoreInteraction.lowerThreshold) || 120,
    loadMoreTriggerZone: (loadMoreInteraction && loadMoreInteraction.triggerZone) || 280,
    loadMoreTriggered: false,
    scrollRefreshing: false,
    preloadProgress: 0,
    completedMissionsOffset: 0,
    completedMissionsHasMore: true,
    // 记录每个标签的滚动位置，避免切换时滚动位置同步
    scrollTopUpcoming: 0,
    scrollTopCompleted: 0,
    scrollTopCalendar: 0,
    // 发射日历
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarDays: [],
    expandedDateKey: '',
    expandedDateTitle: '',
    expandedDateMissions: [],
    calendarLoading: false,
    calendarAllMissions: [],
    calendarFilteredCount: 0,
    calendarTodayKey: '',
    calendarIsCurrentMonth: true,
    calendarQuickFilter: 'all',
    calendarSiteFilter: 'all',
    calendarStatusFilter: 'all',
    calendarFilterCollapsed: true,
    calendarFilterSummaryText: '全部任务',
    calendarPageAnimClass: '',
    calendarSiteOptions: [{ id: 'all', label: '全部基地' }],
    calendarMapEntryList: [],
    scrollViewId: 'mainScrollView', // scroll-view的id
    // 滚动节流相关
    scrollTimer: null,
    lastScrollTime: 0,
    // 用于控制scroll-view的scroll-top（只在切换标签时更新，避免频繁更新）
    _scrollTop: 0,
    // 标记是否正在切换标签，切换时暂时禁用滚动位置记录
    isSwitchingTab: false,
    // 封路通知
    roadClosureNotice: null,
    // 系统通知横幅
    announcementBanner: null,
    announcementDialogVisible: false,
    demoQrcodeUrl: COS_DEMO_QR_URL,
    // SpaceX 官网发射统计
    spacexStats: null,
    spacexStatsLoading: false,
    // 发射竞猜（倒计时卡片）
    voteData: { geCount: 0, buGeCount: 0, customQuestion: '', enabled: false },
    myVote: '',
    voteTotal: 0,
    voteGePct: 50,
    voteBugePct: 50,
    activeVoteType: 'ontime',
    voteSlotVisible: false,
    voteOntimeEnabled: false,
    voteOutcomeEnabled: false,
    // 开屏动画
    splashVisible: false,
    splashFading: false,
    splashConfig: null,
    splashCountdown: 0,
    splashVideoReady: false,
    _countdownSubscribed: false,
    launchStats: {},
    launchStatsLoading: false,
    launchStatsError: '',
    // 倒计时圆图：视频号直播态（红边涟漪 + 声波「直播中」）
    isChannelsLive: false,
    channelsLiveStatus: 0,
    channelsLiveFeedId: '',
    liveFinderUserName: getLiveFinderUserNameFromConfig(),
    channelsLiveAnimPaused: false,
    /** 点击进直播过渡中（压缩放动画） */
    isEnteringLive: false,
  },

  /**
   * 把网络分享缩略图（COS https / cloud://）下载到本地临时路径，并写入 data.shareImage。
   * 这样 onShareAppMessage / onShareTimeline 可以直接用本地路径，
   * 彻底规避 iOS 朋友圈、低端机型对网络图片缩略图加载失败的问题。
   * 同一 URL 不会重复下载。
   */
  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    var trimmed = imageUrl.trim()
    if (!trimmed) return
    // 已经是本地临时路径：直接写入，无需再下载
    if (trimmed.startsWith('wxfile://') || /^http:\/\/tmp/.test(trimmed)) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    // 命中缓存：URL 没变 + 本地路径已就绪
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage) return
    this._shareImageSourceUrl = trimmed

    var self = this
    wx.getImageInfo({
      src: trimmed,
      success: function (res) {
        // 下载完成期间用户可能已经切换到了别的任务，这里用 _shareImageSourceUrl 做校验
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail: function () {
        // 下载失败时清掉缓存标记，允许下次重试
        if (self._shareImageSourceUrl === trimmed) {
          self._shareImageSourceUrl = ''
        }
      }
    })
  },

  /** 卡片列表把某条的 rocketImage 修好后，与当前倒计时为同一 mission 时对齐到 launchData（列表与倒计时同源显示） */
  syncLaunchDataRocketImageFromListByMissionId(missionId, rocketImageSrc) {
    if (this.data.missionType !== 'upcoming' || this.data.loadError) return
    const ld = this.data.launchData
    if (!ld || ld.id == null || missionId == null) return
    if (String(ld.id) !== String(missionId)) return
    if (!rocketImageSrc || typeof rocketImageSrc !== 'string' || !rocketImageSrc.trim()) return
    const cur = (ld.rocketImage || ld.image || '').trim()
    if (!shouldReplaceRocketImage(cur, rocketImageSrc)) return
    this.setData({
      'launchData.image': rocketImageSrc,
      'launchData.rocketImage': rocketImageSrc
    })
  },

  /** 批量刷新列表后（如下拉），用当前列表里同 id 任务的图覆盖倒计时（列表已走完 resolve/onImageError） */
  syncLaunchPanelRocketImageWithUpcomingList() {
    if (this.data.missionType !== 'upcoming') return
    const ld = this.data.launchData
    const list = this.data.upcomingMissions || []
    if (!ld || !ld.id || !list.length) return
    let row = null
    for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(ld.id)) {
        row = list[i]
        break
      }
    }
    if (!row || !row.rocketImage) return
    this.syncLaunchDataRocketImageFromListByMissionId(ld.id, row.rocketImage)
  },

  async refreshLaunchPanelRocketImageUrl() {
    const ld = this.data.launchData
    if (!ld || !ld.id) return

    const idStr = String(ld.id)
    if (this._countdownRocketImageLaunchId !== idStr) {
      this._countdownRocketImageLaunchId = idStr
      this._countdownRocketImageErrorPasses = 0
    }

    try {
      await loadCloudMediaMap()
    } catch (e) {}

    const curImg = ld.image || ld.rocketImage || ''
    // 按火箭名重算；已有正确图时传入 stamped，避免 fuzzy miss 降级成 default
    const url = resolveMissionRocketImage(
      curImg,
      ld.rocketName,
      ld.rocketConfiguration,
      true
    )
    if (!shouldReplaceRocketImage(curImg, url)) return

    this.setData({
      'launchData.image': url,
      'launchData.rocketImage': url
    })
    this._patchUpcomingListsRocketImage(idStr, url)
  },

  /** 大号倒计时圆图 / 吸顶条火箭图加载失败：复用列表卡片 onImageError 的回退链（标记失败 → 模糊匹配 → 默认图） */
  async onCountdownRocketImageError() {
    if (this.data.missionType !== 'upcoming' || this.data.loadError) return
    const ld = this.data.launchData
    if (!ld || !ld.id) return

    const idStr = String(ld.id)
    if (this._countdownRocketImageLaunchId !== idStr) {
      this._countdownRocketImageLaunchId = idStr
      this._countdownRocketImageErrorPasses = 0
    }
    this._countdownRocketImageErrorPasses = (this._countdownRocketImageErrorPasses || 0) + 1
    if (this._countdownRocketImageErrorPasses > 5) return

    const failedImage = ld.rocketImage || ld.image || ''
    const rocketName = ld.rocketName

    // 与列表卡片一致：记录失败 URL，后续 resolve 不再返回同一个坏链接
    if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
      markDownloadFailed(String(failedImage).trim(), 404)
    }

    const applyImage = (nextImage) => {
      if (!nextImage || nextImage === (this.data.launchData && this.data.launchData.rocketImage)) return
      // 用户可能已切到别的任务，校验 id 再写
      if (!this.data.launchData || String(this.data.launchData.id) !== idStr) return
      this.setData({
        'launchData.image': nextImage,
        'launchData.rocketImage': nextImage
      })
      // 倒计时与列表同源显示：把修好的图回写到列表同 id 行
      this._patchUpcomingListsRocketImage(idStr, nextImage)
    }

    try {
      await loadCloudMediaMap()
    } catch (err) {}

    const nextImage = resolveMissionRocketImage(
      failedImage,
      rocketName,
      ld.rocketConfiguration,
      true
    )
    if (nextImage && nextImage !== failedImage) {
      applyImage(nextImage)
      return
    }

    if (!rocketName) {
      applyImage(resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE))
    }
  },

  /** 把倒计时区修好的配置图回写到 upcomingMissions / displayedUpcomingMissions 的同 id 行 */
  _patchUpcomingListsRocketImage(missionId, nextImage) {
    if (!missionId || !nextImage) return
    const patch = {}
    const list = this.data.upcomingMissions || []
    const idx = list.findIndex((m) => m && String(m.id) === String(missionId))
    if (idx >= 0 && shouldReplaceRocketImage(list[idx].rocketImage, nextImage)) {
      patch[`upcomingMissions[${idx}].rocketImage`] = nextImage
    }
    const disp = this.data.displayedUpcomingMissions || []
    const dIdx = disp.findIndex((m) => m && String(m.id) === String(missionId))
    if (dIdx >= 0 && shouldReplaceRocketImage(disp[dIdx].rocketImage, nextImage)) {
      patch[`displayedUpcomingMissions[${dIdx}].rocketImage`] = nextImage
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  /**
   * PRO 状态刷新后重建发射商胶囊展示（FREE 仍可展示胶囊，仅筛选能力不同）
   */
  _getPageSubscribedIdSet(forceRefresh) {
    if (forceRefresh) this._pageSubscribedIdSet = null
    if (this._pageSubscribedIdSet instanceof Set) return this._pageSubscribedIdSet
    this._pageSubscribedIdSet = getSubscribedMissionIdSet()
    return this._pageSubscribedIdSet
  },

  _invalidatePageSubscribedIdSet() {
    this._pageSubscribedIdSet = null
  },

  _refreshMembershipAndAgencyFilter() {
    const pro = isProSync()
    const patch = { isProUser: pro }
    if (!pro) {
      patch.selectedUpcomingAgencyKey = '_all'
    }
    this.applyUpcomingAgencyFilterToPatch(patch)
    const prevSel = this.data.selectedUpcomingAgencyKey
    const prevDisp = this.data.displayedUpcomingMissions
    const prevEmpty = this.data.upcomingAgencyFilterEmpty
    const prevChips = this.data.upcomingAgencyChipsDisplayed
    if (
      patch.isProUser === this.data.isProUser &&
      patch.selectedUpcomingAgencyKey === prevSel &&
      patch.displayedUpcomingMissions === prevDisp &&
      patch.upcomingAgencyFilterEmpty === prevEmpty &&
      patch.upcomingAgencyChipsDisplayed === prevChips
    ) {
      return
    }
    this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
  },

  /**
   * 置顶排序（首页即将发射列表左滑）
   */
  _finalizeDisplayedUpcomingForSwipe(safePatch) {
    if (!Array.isArray(safePatch.displayedUpcomingMissions)) return
    const pinnedRaw =
      safePatch.pinnedUpcomingMissionId !== undefined
        ? safePatch.pinnedUpcomingMissionId
        : this.data.pinnedUpcomingMissionId
    const pinned = pinnedRaw != null && pinnedRaw !== '' ? String(pinnedRaw) : ''
    let disp = safePatch.displayedUpcomingMissions.slice()
    if (pinned) disp = sortPinnedMissionFirst(disp, pinned)
    safePatch.displayedUpcomingMissions = disp
  },

  /** 列表项：reminderOn（isSubscribed）、pinnedOn（当前置顶 id），供左滑 UI 直接绑定，不走 WXS */
  _attachSwipeRowFlagsToDisplayedPatch(safePatch) {
    const disp = safePatch.displayedUpcomingMissions
    if (!Array.isArray(disp) || !disp.length) return
    const pinnedRaw =
      safePatch.pinnedUpcomingMissionId !== undefined
        ? safePatch.pinnedUpcomingMissionId
        : this.data.pinnedUpcomingMissionId
    const pid = pinnedRaw != null && pinnedRaw !== '' ? String(pinnedRaw) : ''
    const subSet = this._getPageSubscribedIdSet()
    safePatch.displayedUpcomingMissions = disp.map((m) => {
      if (!m || m.id == null) return m
      const reminderOn = subSet.has(String(m.id))
      const pinnedOn = !!pid && String(m.id) === pid
      if (m.reminderOn === reminderOn && m.pinnedOn === pinnedOn) return m
      return { ...m, reminderOn: reminderOn, pinnedOn: pinnedOn }
    })
    this._attachCardCountdownToDisplayedPatch(safePatch)
  },

  _getMissionCardCountdownDeps() {
    return {
      getCountdown,
      formatSecondsText
    }
  },

  _attachCardCountdownToDisplayedPatch(safePatch) {
    const limit = this.data.missionCardCountdownVisibleCount || 2
    const disp = safePatch.displayedUpcomingMissions
    if (!Array.isArray(disp) || !disp.length || !limit) return
    safePatch.displayedUpcomingMissions = attachCardCountdownToMissions(
      disp,
      limit,
      this._getMissionCardCountdownDeps()
    )
  },

  _buildMissionCardCountdownTickPatch() {
    if (this.data.missionType !== 'upcoming') return {}
    return buildMissionCardCountdownTickPatch(
      this.data.displayedUpcomingMissions || [],
      this.data.missionCardCountdownVisibleCount || 2,
      this._getMissionCardCountdownDeps()
    )
  },

  /**
   * 合并「即将发射」发射商胶囊与 displayedUpcomingMissions。
   * @param {Object} patch 写入 setData 的对象（会被就地合并筛选字段）
   * @param {Array|undefined} upcomingOverride 可选，覆盖 upcoming 列表源（避免尚未写入 data 的旧值）
   */
  applyUpcomingAgencyFilterToPatch(patch = {}, upcomingOverride) {
    const safePatch = patch && typeof patch === 'object' ? patch : {}
    const proFlag =
      safePatch.isProUser !== undefined ? !!safePatch.isProUser : !!this.data.isProUser

    const upcoming =
      upcomingOverride != null
        ? upcomingOverride
        : (Array.isArray(safePatch.upcomingMissions)
          ? safePatch.upcomingMissions
          : (this.data.upcomingMissions || []))

    let sel =
      safePatch.selectedUpcomingAgencyKey !== undefined
        ? safePatch.selectedUpcomingAgencyKey
        : this.data.selectedUpcomingAgencyKey

    if (!Array.isArray(upcoming) || upcoming.length === 0) {
      sel = '_all'
    } else if (sel && sel !== '_all') {
      const hasAgency = upcoming.some((m) => getAgencyKeyFromMission(m) === sel)
      if (!hasAgency) sel = '_all'
    }

    if (!proFlag) {
      const chipOnly = buildUpcomingAgencyFilterState(upcoming, '_all')
      Object.assign(safePatch, {
        displayedUpcomingMissions: chipOnly.displayedUpcomingMissions || upcoming,
        upcomingAgencyChipsDisplayed: chipOnly.upcomingAgencyChipsDisplayed || [],
        upcomingAgencyFilterEmpty: false,
        upcomingAgencyChipsHasOverflow: false,
        selectedUpcomingAgencyKey: '_all'
      })
      safePatch.selectedUpcomingAgencyKey = '_all'
      this._syncUpcomingAgencyScrollHapticBaseline(safePatch.upcomingAgencyChipsDisplayed || [])
      this._finalizeDisplayedUpcomingForSwipe(safePatch)
      this._attachSwipeRowFlagsToDisplayedPatch(safePatch)
      return safePatch
    }

    Object.assign(safePatch, buildUpcomingAgencyFilterState(upcoming, sel))
    safePatch.selectedUpcomingAgencyKey = sel
    this._syncUpcomingAgencyScrollHapticBaseline(safePatch.upcomingAgencyChipsDisplayed || [])
    this._finalizeDisplayedUpcomingForSwipe(safePatch)
    this._attachSwipeRowFlagsToDisplayedPatch(safePatch)
    return safePatch
  },

  closeMissionSwipeCells() {
    if (this._missionSwipeDragTimer) {
      clearTimeout(this._missionSwipeDragTimer)
      this._missionSwipeDragTimer = null
    }
    this._missionSwipeG = null
    this._missionSwipeOpenedAtScrollTop = null
    if (
      !this.data.missionSwipeOpenWxkey &&
      !this.data.missionSwipeDragWxkey &&
      !this.data.missionSwipeDragPx
    ) {
      return
    }
    this.setData({
      missionSwipeOpenWxkey: '',
      missionSwipeDragWxkey: '',
      missionSwipeDragPx: 0
    })
  },

  _syncDisplayedUpcomingSwipeRowFlags() {
    const disp = this.data.displayedUpcomingMissions
    if (!Array.isArray(disp) || !disp.length) return
    const pid = this.data.pinnedUpcomingMissionId ? String(this.data.pinnedUpcomingMissionId) : ''
    const subSet = this._getPageSubscribedIdSet()
    let changed = false
    const next = disp.map((m) => {
      if (!m || m.id == null) return m
      const reminderOn = subSet.has(String(m.id))
      const pinnedOn = !!pid && String(m.id) === pid
      if (m.reminderOn === reminderOn && m.pinnedOn === pinnedOn) return m
      changed = true
      return { ...m, reminderOn: reminderOn, pinnedOn: pinnedOn }
    })
    if (changed) this.setData({ displayedUpcomingMissions: next })
  },

  _scheduleMissionSwipeDragSet(wxkey, px) {
    const self = this
    if (!this._missionSwipeG || this._missionSwipeG.wxkey !== wxkey) return
    this._missionSwipeG.lastPx = px
    if (this._missionSwipeDragTimer) return
    this._missionSwipeDragTimer = setTimeout(() => {
      self._missionSwipeDragTimer = null
      self.setData({
        missionSwipeDragWxkey: wxkey,
        missionSwipeDragPx: px
      })
    }, 18)
  },

  onMissionSwipeTouchStart(e) {
    if (this.data.missionType !== 'upcoming') return
    const t = e.touches && e.touches[0]
    if (!t) return
    const wxkey = e.currentTarget.dataset.wxkey
    if (!wxkey) return
    const open = this.data.missionSwipeOpenWxkey
    let base = 0
    if (open === wxkey) base = -this.data.missionSwipeActionWidthPx
    this._missionSwipeG = {
      wxkey,
      startX: t.pageX,
      startY: t.pageY,
      baseX: base,
      lockH: false,
      lastPx: base
    }
  },

  onMissionSwipeTouchMove(e) {
    if (!this._missionSwipeG || this.data.missionType !== 'upcoming') return
    const t = e.touches && e.touches[0]
    if (!t) return
    const g = this._missionSwipeG
    const dx = t.pageX - g.startX
    const dy = t.pageY - g.startY
    if (!g.lockH) {
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.18) {
        g.lockH = true
        if (this.data.missionSwipeOpenWxkey && this.data.missionSwipeOpenWxkey !== g.wxkey) {
          this._missionSwipeOpenedAtScrollTop = null
          this.setData({ missionSwipeOpenWxkey: '' })
        }
      } else if (Math.abs(dy) > 22 && Math.abs(dy) > Math.abs(dx) * 1.05) {
        const abandonKey = g.wxkey
        this._missionSwipeG = null
        if (this.data.missionSwipeDragWxkey === abandonKey) {
          this.setData({ missionSwipeDragWxkey: '', missionSwipeDragPx: 0 })
        }
        return
      }
    }
    if (!g.lockH) return
    let next = g.baseX + dx
    const w = this.data.missionSwipeActionWidthPx
    if (next > 0) next = 0
    if (next < -w) next = -w
    this._scheduleMissionSwipeDragSet(g.wxkey, next)
  },

  onMissionSwipeTouchEnd() {
    const g = this._missionSwipeG
    if (this._missionSwipeDragTimer) {
      clearTimeout(this._missionSwipeDragTimer)
      this._missionSwipeDragTimer = null
    }
    if (!g || !g.lockH) {
      this._missionSwipeG = null
      if (this.data.missionSwipeDragWxkey || this.data.missionSwipeDragPx) {
        this.setData({ missionSwipeDragWxkey: '', missionSwipeDragPx: 0 })
      }
      return
    }
    const w = this.data.missionSwipeActionWidthPx
    const px = typeof g.lastPx === 'number' ? g.lastPx : g.baseX
    const shouldOpen = px <= -(w / 2.55)
    const prevOpen = this.data.missionSwipeOpenWxkey
    let nextOpen = ''
    if (shouldOpen) nextOpen = g.wxkey
    else if (prevOpen === g.wxkey) nextOpen = ''
    else nextOpen = prevOpen ? prevOpen : ''
    const newlyOpened = shouldOpen && prevOpen !== g.wxkey
    if (newlyOpened) this._vibrateMedium()
    this._missionSwipeG = null
    this.setData({
      missionSwipeDragWxkey: '',
      missionSwipeDragPx: 0,
      missionSwipeOpenWxkey: nextOpen
    })
    if (nextOpen) {
      this._missionSwipeOpenedAtScrollTop = this._latestMissionListScrollTop || 0
    } else {
      this._missionSwipeOpenedAtScrollTop = null
    }
  },

  _findUpcomingMissionRow(id) {
    const idStr = String(id)
    const disp = this.data.displayedUpcomingMissions
    if (Array.isArray(disp)) {
      for (let i = 0; i < disp.length; i++) {
        const m = disp[i]
        if (m && String(m.id) === idStr) return m
      }
    }
    const upcoming = this.data.upcomingMissions
    if (Array.isArray(upcoming)) {
      for (let i = 0; i < upcoming.length; i++) {
        const m = upcoming[i]
        if (m && String(m.id) === idStr) return m
      }
    }
    return null
  },

  /**
   * 发射提醒：与倒计时卡片「提醒」同源（subscribeLaunch + 同步列表项 reminderOn）
   * 与「倒计时提醒」「左滑提醒」共用 _subscribeReminderBusy，避免并发重复请求。
   */
  async subscribeReminderForMission(mission) {
    if (!mission || !mission.id) return false
    const ok = await subscribeLaunch(mission)
    if (ok) {
      this._invalidatePageSubscribedIdSet()
      const mid = String(mission.id)
      const cur = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      if (cur === mid) {
        this.setData({ _countdownSubscribed: true })
      }
      this._syncDisplayedUpcomingSwipeRowFlags()
    }
    return !!ok
  },

  /** 关闭发射提醒（本地 + 云端），并同步铃铛 / 列表左滑态 */
  async unsubscribeReminderForMission(missionId) {
    if (!missionId) return false
    const ok = await unsubscribeLaunch(missionId)
    if (ok) {
      this._invalidatePageSubscribedIdSet()
      const mid = String(missionId)
      const cur = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      if (cur === mid) {
        this.setData({ _countdownSubscribed: false })
      }
      this._syncDisplayedUpcomingSwipeRowFlags()
      wx.showToast({ title: '提醒已关闭', icon: 'none' })
    }
    return !!ok
  },

  async onMissionSwipeSubscribeTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const row = this._findUpcomingMissionRow(id)
    if (!row) return
    if (this._subscribeReminderBusy) return
    this._vibrateMedium()
    this._subscribeReminderBusy = true
    try {
      if (isSubscribed(id)) {
        await this.unsubscribeReminderForMission(id)
      } else {
        await this.subscribeReminderForMission(row)
      }
    } finally {
      this._subscribeReminderBusy = false
    }
  },

  onMissionSwipePinTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const cur = this.data.pinnedUpcomingMissionId ? String(this.data.pinnedUpcomingMissionId) : ''
    const sid = String(id)
    const next = cur === sid ? '' : sid
    try {
      if (next) wx.setStorageSync(PINNED_UPCOMING_MISSION_STORAGE_KEY, next)
      else wx.removeStorageSync(PINNED_UPCOMING_MISSION_STORAGE_KEY)
    } catch (err) {}
    const patch = { pinnedUpcomingMissionId: next }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch)
    this.closeMissionSwipeCells()
    this._vibrateMedium()
    wx.showToast({
      title: next ? '已置顶（列表顶部显示）' : '已取消置顶',
      icon: 'none'
    })
  },
  _syncUpcomingAgencyScrollHapticBaseline(chips) {
    const sig = Array.isArray(chips) && chips.length
      ? chips.map((c) => (c && c.key != null ? String(c.key) : '')).join('\x1e')
      : ''
    if (sig !== this._upcomingAgencyChipsHapticSig) {
      this._upcomingAgencyChipsHapticSig = sig
      this._upcomingAgencyScrollHapticBucket = null
    }
  },

  scheduleUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const self = this
    setTimeout(function () {
      self.updateUpcomingAgencyChipsOverflowHint()
    }, 0)
  },

  updateUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const query = wx.createSelectorQuery().in(this)
    query.select('.upcoming-agency-scroll').boundingClientRect()
    query.select('.upcoming-agency-chips-row').boundingClientRect()
    query.exec((res) => {
      const scrollRect = res && res[0]
      const gridRect = res && res[1]
      const hasOverflow = !!(scrollRect && gridRect && gridRect.width > scrollRect.width + 2)
      if (hasOverflow !== this.data.upcomingAgencyChipsHasOverflow) {
        this.setData({ upcomingAgencyChipsHasOverflow: hasOverflow })
      }
    })
  },

  /**
   * 横向滑动：按 scrollLeft 阶梯触发中度震动（左右双向一致；单帧封顶避免过猛）
   */
  onUpcomingAgencyChipsScroll(e) {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    if (this.data.missionType !== 'upcoming') return
    const left = Math.max(0, Number((e.detail && e.detail.scrollLeft) || 0))
    const stepPx = 52
    const bucket = Math.floor(left / stepPx)
    if (this._upcomingAgencyScrollHapticBucket == null) {
      this._upcomingAgencyScrollHapticBucket = bucket
      return
    }
    if (bucket === this._upcomingAgencyScrollHapticBucket) return
    const jumps = Math.min(Math.abs(bucket - this._upcomingAgencyScrollHapticBucket), 4)
    for (let i = 0; i < jumps; i++) {
      this._vibrateMedium()
    }
    this._upcomingAgencyScrollHapticBucket = bucket
  },

  async onUpcomingAgencyChipTap(e) {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    const key = e.currentTarget.dataset.key
    if (key === undefined || key === null) return
    const keyStr = key === '_all' ? '_all' : String(key)

    if (!this.data.isProUser) {
      if (keyStr === '_all') return
      const allowed = await gateCheck('home_upcoming_agency_filter', '即将发射 · 按发射商筛选')
      if (!allowed) return
      try {
        await getMembershipState(true)
      } catch (e) {}
      if (!isProSync()) return
      const upgradedPatch = { isProUser: true, selectedUpcomingAgencyKey: keyStr }
      this.applyUpcomingAgencyFilterToPatch(upgradedPatch)
      this.setData(upgradedPatch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      return
    }

    const patch = { selectedUpcomingAgencyKey: keyStr }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
  },

  /** 发射商远程 Logo 渲染成功后下载到 USER_DATA_PATH 并替换为本地路径 */
  onAgencyChipLogoLoad(e) {
    const remoteUrl = (e.currentTarget.dataset.logoRemote || '').trim()
    if (!isRemoteAgencyLogoUrl(remoteUrl)) return
    const self = this
    persistAgencyLogoAfterRemoteLoad(remoteUrl, function (localPath) {
      if (!localPath) return
      self._applyAgencyChipLocalLogo(remoteUrl, localPath)
    })
  },

  _applyAgencyChipLocalLogo(remoteUrl, localPath) {
    const chips = this.data.upcomingAgencyChipsDisplayed
    if (!Array.isArray(chips) || !chips.length || !localPath) return
    let changed = false
    const next = chips.map(function (c) {
      if (c.logoRemoteSrc === remoteUrl && c.logoUrl !== localPath) {
        changed = true
        return { ...c, logoUrl: localPath }
      }
      return c
    })
    if (changed) {
      this.setData({ upcomingAgencyChipsDisplayed: next }, () => this.scheduleUpcomingAgencyChipsOverflowHint())
    }
  },

  updateMissionListView(type, list) {
    const isActiveType = this.data.missionType === type
    const updateData = buildMissionListViewUpdateData({
      activeMissionType: this.data.missionType,
      type,
      list
    })

    if (type === 'upcoming') {
      this.applyUpcomingAgencyFilterToPatch(updateData, list)
    }

    this.setData(updateData, () => {
      this.syncCalendarFromMissionListsIfNeeded()
      if (type === 'upcoming') {
        this.syncLaunchPanelRocketImageWithUpcomingList()
        this.scheduleUpcomingAgencyChipsOverflowHint()
      }
      if (isActiveType) {
        this._resetMissionCardHaptics()
        this._scheduleMissionCardMeasurement(true)
      }
    })
  },

  async fetchMissionList(type, limit = 50, offset = 0) {
    return fetchMissionListData({
      type,
      limit,
      offset,
      getUpcomingMissions,
      getCompletedMissions,
      formatDate,
      filterExpiredMissions
    })
  },

  /**
   * 优化后的初始数据加载：一次性加载倒计时和即将发射数据（使用同一个API）
   * 然后并行加载历史发射数据，避免重复API请求
   */
  getDefaultCarouselImages() {
    return DEFAULT_CAROUSEL_ITEMS
      .map((item) => resolveMediaUrl(item.key, ''))
      .filter(Boolean)
  },

  runManagedPageRequest(promiseKey, requestFactory, options = {}) {
    const safeOptions = options || {}
    const allowReuse = safeOptions.allowReuse !== false
    if (allowReuse && this[promiseKey]) {
      return this[promiseKey]
    }

    let requestPromise = null
    requestPromise = (async () => {
      try {
        return await requestFactory()
      } finally {
        if (this[promiseKey] === requestPromise) {
          this[promiseKey] = null
        }
      }
    })()

    this[promiseKey] = requestPromise
    return requestPromise
  },

  getMissionDetailCacheStore() {
    // 全局共享内存缓存（storage-sync-cache）：index / mission-detail / search / profile
    // 共用同一份内存层，同一进程内 mission_detail_cache 最多同步读 1 次
    const stored = storageCache.readMemOrSync('mission_detail_cache', {})
    const safe = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
    return { ...safe }
  },

  setMissionDetailCacheStore(cache, options = {}) {
    const safe = cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {}
    try {
      if (options && options.syncWrite) {
        // 同步写入：navigateTo 跳详情页前落盘（详情页同进程读内存层，磁盘兜底冷启动场景）
        storageCache.persistSync('mission_detail_cache', safe)
      } else {
        // 异步写入，避免阻塞主线程；内存层已立即生效，下次读不会回源 storage
        storageCache.persistAsync('mission_detail_cache', safe)
      }
    } catch (err) {}
  },

  updateMissionDetailCacheEntries(entries = [], options = {}) {
    const safeEntries = Array.isArray(entries) ? entries : []
    let cache = options && options.cache && typeof options.cache === 'object' && !Array.isArray(options.cache)
      ? { ...options.cache }
      : this.getMissionDetailCacheStore()

    safeEntries.forEach((entry) => {
      const safeEntry = entry && typeof entry === 'object' ? entry : null
      if (!safeEntry || safeEntry.id == null || !safeEntry.mission) return
      cache = setMissionDetailCacheEntry(cache, safeEntry.id, safeEntry.detailType, safeEntry.mission, {
        source: safeEntry.source,
        cachedAt: safeEntry.cachedAt
      })
    })

    if (safeEntries.length > 0 && options.persist !== false) {
      this.setMissionDetailCacheStore(cache, { syncWrite: !!options.syncWrite })
    }

    return cache
  },

  sanitizeMissionDetailCacheStore() {
    // 经共享内存层异步预热读取：已 warm 时直接用内存值，避免读到落后于内存的磁盘数据
    storageCache.warmAsync('mission_detail_cache', {}).then((raw) => {
      const stored =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
      const keys = Object.keys(stored)
      if (!keys.length) return

      const sanitized = {}
      const cleanFallback = (value) => (value === '加载失败' ? '' : value)
      let i = 0
      const CHUNK = 20
      const self = this

      const step = () => {
        const end = Math.min(i + CHUNK, keys.length)
        for (; i < end; i++) {
          const key = keys[i]
          const mission = stored[key]
          if (!mission || typeof mission !== 'object') continue
          sanitized[key] = {
            ...mission,
            description: cleanFallback(mission.description),
            missionDetails: cleanFallback(mission.missionDetails),
            rocketInfo: cleanFallback(mission.rocketInfo),
            launchAgency: cleanFallback(mission.launchAgency),
            launchSite: cleanFallback(mission.launchSite),
            boosterInfo: self.normalizeBoosterInfo(mission.boosterInfo, mission)
          }
        }
        if (i < keys.length) {
          setTimeout(step, 0)
        } else {
          self.setMissionDetailCacheStore(sanitized)
        }
      }

      setTimeout(step, 0)
    }).catch(() => {})
  },

  buildMissionDetailViewContext(dataset = {}) {
    const safeDataset = dataset && typeof dataset === 'object' ? dataset : {}
    const id = safeDataset.id
    if (!id) return null

    const resolved = resolveMissionDetailSourceData(this.data, safeDataset.type, id)
    const navigation = buildMissionDetailNavigation({
      id: resolved.id,
      detailType: resolved.detailType,
      fromSearch: safeDataset.source === 'search'
    })
    const mission = collectMissionShareCandidates(this.data).find((item) => String(item && item.id) === String(resolved.id)) || null

    return {
      resolved,
      navigation,
      mission
    }
  },

  persistMissionDetailListSnapshot(context) {
    const safeContext = context && typeof context === 'object' ? context : {}
    const resolved = safeContext.resolved || {}
    const mission = safeContext.mission
    if (!resolved.id || !mission) return

    this.updateMissionDetailCacheEntries([{
      id: resolved.id,
      detailType: resolved.detailType,
      mission,
      source: 'list'
    }], { syncWrite: true })
  },

  buildPrefetchedMissionDetail(mission, apiDetail) {
    const hasRecovery = apiDetail.boosterInfo && (apiDetail.boosterInfo.configReusable === true || (!apiDetail.boosterInfo.inferredRecovery && (
      apiDetail.boosterInfo.landingType ||
      apiDetail.boosterInfo.landingLocation ||
      (typeof apiDetail.boosterInfo.landingDescription === 'string' && apiDetail.boosterInfo.landingDescription.trim())
    )))
    const boosterInfo = hasRecovery ? apiDetail.boosterInfo : (mission.boosterInfo || apiDetail.boosterInfo)

    return {
      ...apiDetail,
      boosterInfo,
      isRecoverableThisMission: !!(boosterInfo && (boosterInfo.configReusable === true || (!boosterInfo.inferredRecovery && (
        boosterInfo.landingType || boosterInfo.landingLocation || (typeof boosterInfo.landingDescription === 'string' && boosterInfo.landingDescription.trim())
      )))),
      launchTimeCST: this.formatToCST(apiDetail.launchTime || mission.launchTime),
      windowStartCST: apiDetail.windowStart ? this.formatToCST(apiDetail.windowStart) : '',
      windowEndCST: apiDetail.windowEnd ? this.formatToCST(apiDetail.windowEnd) : '',
      rocketImage: resolveMissionRocketImage(
        mission.rocketImage,
        mission.rocketName || apiDetail.rocketName,
        mission.rocketConfiguration || apiDetail.rocketConfiguration
      )
    }
  },

  buildDetailPrefetchCacheEntries(results = []) {
    const safeResults = Array.isArray(results) ? results : []
    return safeResults
      .filter((result) => result && result.status === 'fulfilled' && result.value)
      .map((result) => ({
        id: result.value.data.id,
        detailType: result.value.data.missionType || result.value.type || 'upcoming',
        mission: result.value.data,
        source: 'prefetch'
      }))
  },

  shouldSkipManagedPageRefresh(options = {}) {
    const safeOptions = options || {}
    if (safeOptions.forceRefresh) return false

    if (safeOptions.strategy === 'launchStats') {
      return shouldSkipLaunchStatsRefresh({
        stats: safeOptions.stats,
        lastLoadedAt: safeOptions.lastLoadedAt,
        ttlMs: safeOptions.ttlMs,
        errorMessage: safeOptions.errorMessage,
        now: safeOptions.now
      })
    }

    return shouldSkipSimpleRefresh({
      hasData: safeOptions.hasData,
      lastLoadedAt: safeOptions.lastLoadedAt,
      ttlMs: safeOptions.ttlMs,
      now: safeOptions.now
    })
  },

  runTimedManagedPageRequest(options = {}) {
    const safeOptions = options || {}
    if (this.shouldSkipManagedPageRefresh(safeOptions)) {
      return typeof safeOptions.getCachedValue === 'function'
        ? safeOptions.getCachedValue()
        : safeOptions.cachedValue
    }

    return this.runManagedPageRequest(safeOptions.promiseKey, safeOptions.requestFactory, {
      allowReuse: !safeOptions.forceRefresh
    })
  },

  resolveMissionLoadErrorMessage(error, options = {}) {
    const safeError = error || {}
    const safeOptions = options || {}
    let errorMessage = safeOptions.defaultMessage || '加载失败'

    if (safeError.type === 'cache_miss') {
      errorMessage = safeOptions.cacheMissMessage || '数据暂不可用，请稍后再试'
    } else if (safeError.message && safeError.message.includes('加载超时')) {
      errorMessage = safeOptions.loadTimeoutMessage || '加载超时，请稍后重试。'
    } else if (safeError.type === 'timeout' || (safeError.message && safeError.message.includes('timeout'))) {
      errorMessage = safeOptions.timeoutMessage || '请求超时，请稍后重试'
    } else if (safeError.type === 'network' || (safeError.message && safeError.message.includes('network'))) {
      errorMessage = safeOptions.networkMessage || '网络连接失败'
    } else if (safeError.statusCode === 404 && safeError.type !== 'cache_miss') {
      errorMessage = safeOptions.notFoundMessage || '接口不存在'
    } else if (safeError.statusCode >= 500) {
      errorMessage = safeOptions.serverErrorMessage || '服务器错误，请稍后重试'
    } else if (safeError.message) {
      errorMessage = safeError.message
    } else if (safeError.errMsg) {
      errorMessage = safeError.errMsg
    }

    return errorMessage
  },

  shouldIgnoreMissionLoadError(error) {
    const safeError = error || {}
    return safeError.statusCode === 429 || safeError.type === 'rate_limit'
  },

  applyLaunchSwitchEffects(mission, options = {}) {
    const launchEffects = buildLaunchSwitchEffects(mission, options)
    // 同一任务重复应用（如快速包→完整包两阶段首屏）时不清空已渲染的竞猜 UI，避免闪烁
    const voteTargetId = String(launchEffects.launchId || '')
    const voteAlreadyRendered = voteTargetId && String(this._voteRenderedLaunchId || '') === voteTargetId
    if (launchEffects.shouldResetVote && !voteAlreadyRendered) this.resetVoteData()
    if (launchEffects.shouldUpdateCountdown) this.updateCountdown()
    if (launchEffects.shouldLoadVote) this.loadVoteData(launchEffects.launchId, launchEffects.voteSkipCache)

    // 推迟徽标：任务确定 / 切换时异步拉取 LL2 updates 计算累计推迟数据
    this.refreshLaunchDelayInfo(launchEffects.launchId, mission && mission.launchTime)

    // 预下载分享缩略图到本地临时路径（COS https → wxfile://），
    // 这样倒计时分享按钮 / 任务卡片分享拿到的 imageUrl 是本地路径，
    // 微信缩略图加载成功率显著提升（特别是 iOS 朋友圈）
    if (mission && mission.rocketImage) {
      this.ensureShareImageHttpUrl(mission.rocketImage)
    } else {
      this.ensureShareImageHttpUrl(resolveMissionRocketImage(DEFAULT_SHARE_IMAGE))
    }

    return launchEffects
  },

  // ========== 倒计时卡片推迟徽标 ==========
  /**
   * 拉取当前任务的 LL2 updates 并计算推迟徽标文案。
   * - 任务切换（launchId 变化）时先清空徽标再拉取；
   * - 同一任务 + 同一 NET 重复触发（如快速包→完整包两阶段首屏）直接跳过；
   * - 本地缓存 30 分钟（key 带 launchId），命中且 NET 未变时不打云函数；
   * - 无数据 / 无推迟 / 请求失败时徽标置空。
   */
  refreshLaunchDelayInfo(launchId, launchTime) {
    const id = String(launchId || '')
    const net = String(launchTime || '')

    // 任务切换：先清空旧徽标，避免残留上一个任务的推迟信息
    if (this._launchDelayRenderedId !== id && this.data.launchDelayText) {
      this.setData({ launchDelayText: '' })
    }
    if (!id || !net) {
      this._launchDelayRenderedId = ''
      this._launchDelayLoadedKey = ''
      return
    }

    // 同一任务同一 NET 已加载或正在加载：跳过（NET 改期后 key 变化会重新计算）
    const loadKey = id + '|' + net
    if (this._launchDelayLoadedKey === loadKey) return
    this._launchDelayLoadedKey = loadKey

    const DELAY_CACHE_TTL_MS = 30 * 60 * 1000
    const cacheKey = '_launch_delay_' + id

    // 先查本地缓存：30 分钟内且 NET 未变直接复用，不打云函数
    try {
      const cached = wx.getStorageSync(cacheKey)
      if (cached && cached.net === net &&
        Date.now() - (cached.ts || 0) < DELAY_CACHE_TTL_MS) {
        this._launchDelayRenderedId = id
        this.setData({ launchDelayText: cached.text || '' })
        return
      }
    } catch (e) {}

    // 与终态旁路共用内存 updates（5 分钟）
    const mem = this._ll2UpdatesMem
    if (
      mem &&
      mem.id === id &&
      Array.isArray(mem.list) &&
      mem.limit >= 15 &&
      Date.now() - (mem.at || 0) < LL2_UPDATES_MEM_TTL_MS
    ) {
      const info = computeLaunchDelayInfo(mem.list, net)
      try {
        wx.setStorageSync(cacheKey, { net: net, text: info.text, ts: Date.now() })
      } catch (e) {}
      this._launchDelayRenderedId = id
      this.setData({ launchDelayText: info.text })
      return
    }

    // 优先读云库 updates_{uuid}（6h 拆分 / 热路径缓存），命中则 0 云函数、0 LL2
    this._tryLaunchDelayFromUpdatesCache(id, net, loadKey, cacheKey)
  },

  /**
   * 先读 launch_timeline_cache/updates_{id}；冷缓存命中则直接算徽标，否则再调 ll2Query。
   */
  _tryLaunchDelayFromUpdatesCache(id, net, loadKey, cacheKey) {
    const applyList = (list) => {
      if (this._launchDelayLoadedKey !== loadKey) return
      const safeList = Array.isArray(list) ? list : []
      this._ll2UpdatesMem = {
        id,
        list: safeList,
        limit: Math.max(15, safeList.length),
        at: Date.now(),
        outcome: inferTerminalStatusFromUpdates(safeList)
      }
      const info = computeLaunchDelayInfo(safeList, net)
      try {
        wx.setStorageSync(cacheKey, { net: net, text: info.text, ts: Date.now() })
      } catch (e) {}
      this._launchDelayRenderedId = id
      this.setData({ launchDelayText: info.text })
    }

    const fallbackFetch = () => {
      fetchLl2LaunchUpdates(id, 30)
        .then((res) => {
          if (this._launchDelayLoadedKey !== loadKey) return
          applyList((res && res.list) || [])
        })
        .catch(() => {
          if (this._launchDelayLoadedKey !== loadKey) return
          this._launchDelayLoadedKey = ''
          this._launchDelayRenderedId = id
          if (this.data.launchDelayText) this.setData({ launchDelayText: '' })
        })
    }

    if (!wx.cloud || typeof wx.cloud.database !== 'function') {
      fallbackFetch()
      return
    }

    const UPDATES_COLD_TTL_MS = 48 * 60 * 60 * 1000
    wx.cloud.database().collection('launch_timeline_cache').doc('updates_' + id).get()
      .then((cacheRes) => {
        const cached = cacheRes && cacheRes.data
        const list = cached && Array.isArray(cached.data) ? cached.data : null
        const age = cached && cached.updatedAtMs ? (Date.now() - cached.updatedAtMs) : Infinity
        if (list && list.length && age < UPDATES_COLD_TTL_MS) {
          applyList(list)
          return
        }
        fallbackFetch()
      })
      .catch(() => fallbackFetch())
  },

  applyInitialUpcomingLaunchState(firstMission, upcomingList, upcomingRes) {
    if (!firstMission) {
      const emptyState = buildUpcomingLaunchEmptyState({
        message: '暂无即将发射的任务',
        upcomingListState: buildMissionListSetData('upcoming', [], { nextOffset: 0, hasMore: false }, filterExpiredMissions)
      })
      this.applyUpcomingAgencyFilterToPatch(emptyState, [])
      this.setData(emptyState, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      this.resetVoteData()
      return
    }

    // 同一首条任务：只更新列表，不重建倒计时面板（避免快速包→完整包双次闪烁；现已合并为单次请求，仍保留防护）
    const curId = this.data.launchData && this.data.launchData.id != null
      ? String(this.data.launchData.id)
      : ''
    if (curId && String(firstMission.id) === curId && this.data.launchData.launchTime) {
      const listPatch = {
        ...buildMissionListSetData('upcoming', upcomingList, upcomingRes, filterExpiredMissions),
        showMissionsEmpty: this.data.missionType === 'upcoming' ? upcomingList.length === 0 : this.data.showMissionsEmpty
      }
      this.applyUpcomingAgencyFilterToPatch(listPatch, listPatch.upcomingMissions)
      this.setData(listPatch, () => {
        this.syncCalendarFromMissionListsIfNeeded()
        if (this.data.missionType === 'upcoming') {
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
      })
      this._upcomingAgencyEnrichGen = (this._upcomingAgencyEnrichGen || 0) + 1
      const enrichGen = this._upcomingAgencyEnrichGen
      enrichMissionsLaunchAgencyImages(upcomingList)
        .then((enriched) => {
          if (enrichGen !== this._upcomingAgencyEnrichGen) return
          const list = enriched || upcomingList
          if (!this._upcomingAgencyLogoFieldsChanged(upcomingList, list)) return
          this._patchUpcomingListAfterAgencyEnrich(list[0] || firstMission, list, upcomingRes)
        })
        .catch(() => {})
      return
    }

    /** 递增代数：快速包 / 完整包连续触发 enrich 时，只应用最后一次对应的补丁 */
    this._upcomingAgencyEnrichGen = (this._upcomingAgencyEnrichGen || 0) + 1
    const enrichGen = this._upcomingAgencyEnrichGen
    const baselineList = upcomingList

    // 阶段一：立即首屏（发射商 logo 可能为占位）；不再等待 enrich
    this._applyInitialUpcomingLaunchStateSync(firstMission, baselineList, upcomingRes)

    // 阶段二：补全 logo 后增量合并（与阶段一最终数据一致时再写入）
    enrichMissionsLaunchAgencyImages(baselineList)
      .then((enriched) => {
        if (enrichGen !== this._upcomingAgencyEnrichGen) return
        const list = enriched || baselineList
        const fm = list && list[0] ? list[0] : null
        if (!fm) {
          const emptyState = buildUpcomingLaunchEmptyState({
            message: '暂无即将发射的任务',
            upcomingListState: buildMissionListSetData('upcoming', [], { nextOffset: 0, hasMore: false }, filterExpiredMissions)
          })
          this.applyUpcomingAgencyFilterToPatch(emptyState, [])
          this.setData(emptyState, () => this.scheduleUpcomingAgencyChipsOverflowHint())
          this.resetVoteData()
          return
        }
        if (!this._upcomingAgencyLogoFieldsChanged(baselineList, list)) return
        this._patchUpcomingListAfterAgencyEnrich(fm, list, upcomingRes)
      })
      .catch(() => {})
  },

  /** 比较同一顺序列表的发射商展示图是否变化（用于跳过无意义的二次 setData） */
  _upcomingAgencyLogoFieldsChanged(before, after) {
    const a = Array.isArray(before) ? before : []
    const b = Array.isArray(after) ? after : []
    if (a.length !== b.length) return true
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      const y = b[i]
      if (!x || !y || String(x.id) !== String(y.id)) return true
      if (String(x.launchAgencyImage || '') !== String(y.launchAgencyImage || '')) return true
    }
    return false
  },

  /**
   * 发射商 logo 补全后的增量写入：不重跑 applyLaunchSwitchEffects / 详情预取（阶段一已执行）
   * 关键：enrichedList / firstMission 来自 enrich 前的 baseline 快照，rocketImage 可能仍是 default；
   * 若此时 media map 已把列表/倒计时升级为正确图，整包 setData 会把正确图盖回 default。
   * 因此合并时保留当前 data 里已升级的火箭图，并优先用当前列表同 id 行作为面板 mission。
   */
  _patchUpcomingListAfterAgencyEnrich(firstMission, enrichedList, upcomingRes) {
    const prevUpcoming = this.data.upcomingMissions || []
    const prevDisplayed = this.data.displayedUpcomingMissions || []
    const mergedList = mergePreservedRocketImages(enrichedList, prevUpcoming)

    const extraState = buildMissionReadyState({
      ...buildMissionListSetData('upcoming', mergedList, upcomingRes, filterExpiredMissions),
      showMissionsEmpty: this.data.missionType === 'upcoming' ? mergedList.length === 0 : this.data.showMissionsEmpty
    })
    // displayed 也要保留已升级的火箭图
    this.applyUpcomingAgencyFilterToPatch(extraState, extraState.upcomingMissions)
    if (Array.isArray(extraState.displayedUpcomingMissions)) {
      extraState.displayedUpcomingMissions = mergePreservedRocketImages(
        extraState.displayedUpcomingMissions,
        prevDisplayed
      )
    }

    // 面板 mission：优先当前列表同 id（可能已是正确图），再 merge 当前 launchData 的图
    const fmId = firstMission && firstMission.id != null ? String(firstMission.id) : ''
    let panelMission = mergedList.find((m) => m && String(m.id) === fmId) || firstMission
    const ld = this.data.launchData
    if (panelMission && ld && String(ld.id) === String(panelMission.id)) {
      const curImg = ld.rocketImage || ld.image || ''
      const nextImg = panelMission.rocketImage || panelMission.image || ''
      if (curImg && !shouldReplaceRocketImage(curImg, nextImg)) {
        panelMission = { ...panelMission, rocketImage: curImg, image: curImg }
      }
    }

    this.setData(
      {
        ...buildCurrentLaunchPanelState({
          mission: panelMission,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet(),
          extraState
        })
      },
      () => {
        this.syncCalendarFromMissionListsIfNeeded()
        if (this.data.missionType === 'upcoming') {
          this._scheduleMissionCardMeasurement(true)
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
        try {
          this.syncLaunchPanelRocketImageWithUpcomingList()
        } catch (e) {}
      }
    )
  },

  /** 首屏/刷新即将发射列表写入；发射商 logo 可由 applyInitialUpcomingLaunchState 阶段二再补丁合并 */
  _applyInitialUpcomingLaunchStateSync(firstMission, upcomingList, upcomingRes) {
    const extraState = buildMissionReadyState({
      ...buildMissionListSetData('upcoming', upcomingList, upcomingRes, filterExpiredMissions),
      showMissionsEmpty: this.data.missionType === 'upcoming' ? upcomingList.length === 0 : this.data.showMissionsEmpty
    })
    this.applyUpcomingAgencyFilterToPatch(extraState, extraState.upcomingMissions)

    this.setData({
      ...buildCurrentLaunchPanelState({
        mission: firstMission,
        formatDate,
        getStatusTextZh,
        subscribedIdSet: this._getPageSubscribedIdSet(),
        extraState
      })
    }, () => {
      this.syncCalendarFromMissionListsIfNeeded()
      if (this.data.missionType === 'upcoming') {
        this._resetMissionCardHaptics()
        this._scheduleMissionCardMeasurement(true)
        this.scheduleUpcomingAgencyChipsOverflowHint()
      }
      // 缓存前7个即将发射任务的ID
      try {
        var ids = []
        for (var vi = 0; vi < Math.min(7, upcomingList.length); vi++) {
          if (upcomingList[vi] && upcomingList[vi].id) ids.push(String(upcomingList[vi].id))
        }
        wx.setStorage({ key: '_vote_eligible_ids', data: ids, fail: () => {} })
      } catch (e) {}

      Promise.resolve(loadCloudMediaMap())
        .catch(() => {})
        .finally(() => {
          this.refreshLaunchPanelRocketImageUrl()
          this.syncLaunchPanelRocketImageWithUpcomingList()
        })
    })

    this.applyLaunchSwitchEffects(firstMission)
  },

  handleCompletedMissionLoadSuccess(list, res) {
    // 始终拉最新 recent_settled（勿用内存短路）：详情打开后云端才写入终态，
    // 若沿用旧缓存，历史卡片会长期卡在「飞行中」
    const apply = (settled) => {
      if (Array.isArray(settled)) {
        this._recentSettledCache = settled
        this._recentSettledCacheAt = Date.now()
      }
      const merged = this._mergeRecentSettledIntoCompletedList(list, settled)
      this.setData({
        ...buildMissionListSetData('completed', merged, res, filterExpiredMissions)
      }, () => {
        this.updateMissionListView('completed', merged)
        try {
          this.hydrateCalendarFromLoadedMissionLists()
        } catch (e) {}
        try {
          var briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e2) {}
      })
      this._preloadVisibleRocketImages(merged, 5)
    }

    fetchRecentSettledLaunches()
      .then((settled) => apply(settled))
      .catch(() => apply(Array.isArray(this._recentSettledCache) ? this._recentSettledCache : null))
  },

  /**
   * 用内存中的 recent_settled 同步修正历史列表角标（同步路径，list 已在手）。
   * 若尚无缓存则原样返回。
   */
  _mergeRecentSettledIntoCompletedList(list, settledOverride) {
    const settled = Array.isArray(settledOverride)
      ? settledOverride
      : (Array.isArray(this._recentSettledCache) ? this._recentSettledCache : null)
    if (!Array.isArray(list) || !list.length || !settled || !settled.length) return list || []

    const byId = new Map()
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]
      if (s && s.id && s.status) byId.set(String(s.id), s)
    }
    if (!byId.size) return list

    let changed = false
    const next = list.map((item) => {
      if (!item || item.id == null) return item
      const hit = byId.get(String(item.id))
      if (!hit || !hit.status) return item
      const sid = hit.status.id != null ? Number(hit.status.id) : 0
      if (!isTerminalStatusId(sid)) return item
      const category = getStatusCategory(hit.status)
      const badge = getStatusBadgeText(hit.status, category)
      if (item.statusCategory === category && item.statusBadgeText === badge) return item
      changed = true
      return {
        ...item,
        status: badge,
        statusId: sid || item.statusId,
        statusAbbrev: hit.status.abbrev || item.statusAbbrev || '',
        statusCategory: category,
        statusBadgeText: badge,
        success: category === 'success' || category === 'deployed',
        isPartialFailure: category === 'partial',
        isFailure: category === 'failure' || category === 'partial'
      }
    })
    return changed ? next : list
  },

  /**
   * 读云库 recent_settled 写入内存缓存（供 settle / 历史角标复用）。
   */
  async _ensureRecentSettledCache(force) {
    const now = Date.now()
    if (
      !force &&
      Array.isArray(this._recentSettledCache) &&
      this._recentSettledCacheAt &&
      now - this._recentSettledCacheAt < RECENT_SETTLED_MEM_TTL_MS
    ) {
      return this._recentSettledCache
    }
    try {
      const settled = await fetchRecentSettledLaunches()
      if (Array.isArray(settled)) {
        this._recentSettledCache = settled
        this._recentSettledCacheAt = now
        return settled
      }
    } catch (e) {}
    return Array.isArray(this._recentSettledCache) ? this._recentSettledCache : null
  },

  /** 用最新 recent_settled 修正历史列表角标（从详情返回 / 切到历史 Tab 时调用） */
  async _applyRecentSettledToCompletedList(force) {
    const settled = await this._ensureRecentSettledCache(!!force)
    if (!Array.isArray(settled) || !settled.length) return
    const list = this.data.completedMissions || []
    if (!list.length) return
    const merged = this._mergeRecentSettledIntoCompletedList(list, settled)
    if (merged === list) return
    this.setData({
      ...buildMissionListSetData('completed', merged, {
        nextOffset: this.data.completedMissionsOffset,
        hasMore: this.data.completedMissionsHasMore
      }, filterExpiredMissions)
    }, () => {
      try { this.updateMissionListView('completed', merged) } catch (e) {}
      try { this.hydrateCalendarFromLoadedMissionLists() } catch (e2) {}
    })
  },

  /**
   * 详情页终态回写：同 id 历史卡片立刻从「飞行中」改为「已成功」等，不依赖云定时。
   * @param {{ id: string, statusId?: number, statusBadgeText?: string, statusCategory?: string, statusAbbrev?: string }} patch
   */
  applyCompletedMissionStatusFromDetail(patch) {
    if (!patch || patch.id == null) return
    const sid = patch.statusId != null ? Number(patch.statusId) : 0
    if (!isTerminalStatusId(sid)) return
    const list = this.data.completedMissions || []
    if (!list.length) return
    const idStr = String(patch.id)
    const idx = list.findIndex((m) => m && String(m.id) === idStr)
    if (idx < 0) return
    const item = list[idx]
    const category = patch.statusCategory || getStatusCategory({ id: sid, name: patch.statusBadgeText, abbrev: patch.statusAbbrev })
    const badge = patch.statusBadgeText || getStatusBadgeText({ id: sid, abbrev: patch.statusAbbrev }, category)
    if (item.statusCategory === category && item.statusBadgeText === badge) return
    const next = list.slice()
    next[idx] = {
      ...item,
      status: badge,
      statusId: sid,
      statusAbbrev: patch.statusAbbrev || item.statusAbbrev || '',
      statusCategory: category,
      statusBadgeText: badge,
      success: category === 'success' || category === 'deployed',
      isPartialFailure: category === 'partial',
      isFailure: category === 'failure' || category === 'partial'
    }
    // 同步写入 recent_settled 内存，后续 merge / 加载更多也能命中
    const mem = Array.isArray(this._recentSettledCache) ? this._recentSettledCache.slice() : []
    const memIdx = mem.findIndex((s) => s && String(s.id) === idStr)
    const settledRow = {
      id: idStr,
      status: { id: sid, name: badge, abbrev: patch.statusAbbrev || '' },
      settledAtMs: Date.now(),
      source: 'detail_page_backfill'
    }
    if (memIdx >= 0) mem[memIdx] = { ...mem[memIdx], ...settledRow }
    else mem.unshift(settledRow)
    this._recentSettledCache = mem
    this._recentSettledCacheAt = Date.now()

    this.setData({
      ...buildMissionListSetData('completed', next, {
        nextOffset: this.data.completedMissionsOffset,
        hasMore: this.data.completedMissionsHasMore
      }, filterExpiredMissions)
    }, () => {
      try { this.updateMissionListView('completed', next) } catch (e) {}
    })
  },

  handleCompletedMissionLoadError(error) {
    const errorMessage = this.resolveMissionLoadErrorMessage(error, {
      timeoutMessage: '请求超时，请检查网络'
    })
    if (this.shouldIgnoreMissionLoadError(error)) return
    this.setData(buildCompletedMissionLoadErrorState(this.data.missionType, errorMessage))
  },

  handleInitialUpcomingLoadError(error) {
    const errorMessage = this.resolveMissionLoadErrorMessage(error)
    if (this.shouldIgnoreMissionLoadError(error)) return

    const errState = buildUpcomingLaunchErrorState({
      errorMessage,
      upcomingListState: buildMissionListSetData('upcoming', [], { nextOffset: 0, hasMore: false }, filterExpiredMissions),
      showMissionsEmpty: false
    })
    this.applyUpcomingAgencyFilterToPatch(errState, [])
    this.setData(errState, () => this.scheduleUpcomingAgencyChipsOverflowHint())

    wx.showToast({
      title: errorMessage,
      icon: 'none',
      duration: 2000
    })
  },

  getActiveMissionListType() {
    return this.data.missionType === 'completed' ? 'completed' : 'upcoming'
  },

  getMissionListByType(type) {
    return type === 'completed' ? (this.data.completedMissions || []) : (this.data.upcomingMissions || [])
  },

  getMissionListOffsetByType(type) {
    return type === 'completed' ? this.data.completedMissionsOffset : this.data.missionsOffset
  },

  hasMoreMissionListByType(type) {
    return type === 'completed' ? this.data.completedMissionsHasMore : this.data.missionsHasMore
  },

  resolveMissingMissionTypes(types = []) {
    const queue = Array.isArray(types) ? types : [types]
    const normalizedTypes = queue
      .map((type) => (type === 'completed' ? 'completed' : (type === 'upcoming' ? 'upcoming' : '')))
      .filter(Boolean)
    const uniqueTypes = normalizedTypes.filter((type, index) => normalizedTypes.indexOf(type) === index)

    return uniqueTypes.filter((type) => {
      const list = this.getMissionListByType(type)
      return !Array.isArray(list) || list.length === 0
    })
  },

  buildMissionListReadyState(results = [], missingTypes = []) {
    const safeResults = Array.isArray(results) ? results : []
    const safeMissingTypes = Array.isArray(missingTypes) ? missingTypes : []
    const updateData = buildMissionReadyState()

    safeResults.forEach((result, index) => {
      const type = safeMissingTypes[index]
      Object.assign(updateData, buildMissionListSetData(type, result.list, result.res, filterExpiredMissions))
    })

    const activeType = this.getActiveMissionListType()
    const activeResultIndex = safeMissingTypes.indexOf(activeType)
    if (activeResultIndex >= 0) {
      updateData.showMissionsEmpty = safeResults[activeResultIndex].list.length === 0
    }

    return updateData
  },

  applyMissionListsReadyState(updateData, options = {}) {
    const safeOptions = options || {}
    const payload = buildMissionReadyState(updateData)

    const commit = () => {
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'upcomingMissions')) {
        this.applyUpcomingAgencyFilterToPatch(payload)
      }
      this.setData(payload, () => {
        this.syncCalendarFromMissionListsIfNeeded()
        if (this.data.missionType !== 'calendar') {
          this._resetMissionCardHaptics()
          this._scheduleMissionCardMeasurement(true)
        }
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'upcomingMissions')) {
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
        // 缓存前7个即将发射任务的ID，供详情页判断是否开放竞猜
        try {
          var upcoming = this.data.upcomingMissions || []
          var ids = []
          for (var vi = 0; vi < Math.min(7, upcoming.length); vi++) {
            if (upcoming[vi] && upcoming[vi].id) ids.push(String(upcoming[vi].id))
          }
          wx.setStorage({ key: '_vote_eligible_ids', data: ids, fail: () => {} })
        } catch (e) {}
        if (typeof safeOptions.onReady === 'function') {
          safeOptions.onReady()
        }
        // 通知简报组件：任务数据已就绪，可以读取
        try {
          var briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e) {}
      })
    }

    if (
      payload &&
      Array.isArray(payload.upcomingMissions) &&
      payload.upcomingMissions.length > 0
    ) {
      enrichMissionsLaunchAgencyImages(payload.upcomingMissions)
        .then((enriched) => {
          payload.upcomingMissions = enriched || payload.upcomingMissions
          commit()
        })
        .catch(commit)
      return
    }

    commit()
  },

  async ensureMissionListsReady(types = []) {
    await loadCloudMediaMap().catch(() => {})

    const missingTypes = this.resolveMissingMissionTypes(types)
    if (!missingTypes.length) {
      this.setData(buildMissionReadyState())
      return
    }

    const results = await Promise.all(missingTypes.map((type) => this.fetchMissionList(type, 50, 0)))
    const updateData = this.buildMissionListReadyState(results, missingTypes)

    this.applyMissionListsReadyState(updateData)
  },

  beginLoadMoreMissions() {
    this._loadingMoreLock = true
    this.setData({
      missionsLoadingMore: true,
      loadMoreTriggered: true,
      preloadProgress: 1
    })

    const now = Date.now()
    if (!this._lastLoadMoreVibrateAt || now - this._lastLoadMoreVibrateAt > 1200) {
      this._lastLoadMoreVibrateAt = now
      wx.vibrateShort({ type: 'light' })
    }
  },

  buildLoadMoreMissionResult(type, previousList, formatted, res, offset) {
    const merged = mergeMissionPages(type, previousList, formatted, filterExpiredMissions)
    // 空页兜底：接口原始返回（过滤前）为空说明已到数据尽头（缓存切片越界等），
    // 强制收尾，避免 hasMore 恒真 + offset 不前进导致触底无限重试。
    // 注意用 res.list 而非 formatted 判断：upcoming 的 formatted 已过滤过期项，
    // 「整页都过期」时 offset 仍会前进，不应误判为尽头
    const isEmptyPage = !(res && Array.isArray(res.list) && res.list.length > 0)
    return buildMissionReadyState({
      ...buildMissionListSetData(type, merged, {
        nextOffset: getMissionNextOffset(res, offset),
        hasMore: isEmptyPage ? false : !!res.hasMore
      }, filterExpiredMissions)
    })
  },

  handleLoadMoreMissionSuccess(type, formatted, res, offset) {
    const previousList = this.getMissionListByType(type)
    let nextState = this.buildLoadMoreMissionResult(type, previousList, formatted, res, offset)

    const done = () => {
      if (type === 'upcoming') {
        this.applyUpcomingAgencyFilterToPatch(nextState)
      }
      this.setData(nextState, () => {
        this._scheduleMissionCardMeasurement(true)
        if (type === 'upcoming') this.scheduleUpcomingAgencyChipsOverflowHint()
      })
    }

    if (type === 'upcoming' && Array.isArray(nextState.upcomingMissions)) {
      enrichMissionsLaunchAgencyImages(nextState.upcomingMissions)
        .then((enriched) => {
          nextState.upcomingMissions = enriched || nextState.upcomingMissions
          done()
        })
        .catch(done)
      return
    }

    if (type === 'completed' && Array.isArray(nextState.completedMissions)) {
      this._ensureRecentSettledCache(false)
        .then((settled) => {
          const merged = this._mergeRecentSettledIntoCompletedList(nextState.completedMissions, settled)
          nextState = {
            ...nextState,
            ...buildMissionListSetData('completed', merged, {
              nextOffset: nextState.completedMissionsOffset != null
                ? nextState.completedMissionsOffset
                : this.data.completedMissionsOffset,
              hasMore: nextState.completedMissionsHasMore != null
                ? nextState.completedMissionsHasMore
                : this.data.completedMissionsHasMore
            }, filterExpiredMissions)
          }
          done()
        })
        .catch(done)
      return
    }

    done()
  },

  handleLoadMoreMissionFallback(error, type) {
    const noMoreData = error && error.type === 'cache_miss'
    this.setData(buildLoadMoreFallbackState({
      isUpcoming: type === 'upcoming',
      noMoreData
    }))
  },

  finishLoadMoreMissions() {
    this._loadingMoreLock = false
  },

  async loadRoadClosureNotice(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh

    return this.runTimedManagedPageRequest({
      forceRefresh,
      strategy: 'simple',
      hasData: !!this.data.roadClosureNotice,
      lastLoadedAt: this._roadClosureNoticeLoadedAt,
      ttlMs: ROAD_CLOSURE_REFRESH_TTL,
      getCachedValue: () => this.data.roadClosureNotice,
      promiseKey: '_loadRoadClosureNoticePromise',
      requestFactory: async () => {
      try {
        const data = await getRoadClosureNotice()

        if (resolveRoadClosureStatus(data) === 'active') {
          let timeRange = data.timeRange || ''
          if (!timeRange && data.startTime && data.endTime) {
            const s = formatDate(data.startTime, 'MM月DD日 HH:mm')
            const e = formatDate(data.endTime, 'MM月DD日 HH:mm')
            timeRange = `${s} - ${e}`
          }
          const sourceMap = { manual: '管理员', spacedevs: 'SpaceDevs', starbase_gov: 'Starbase.gov', legacy: '' }
          const schedule = data.beachClosureSchedule || []
          const msgText = schedule.length > 0
            ? (data.beachStatus || data.message || '封路通知') + ' | ' + schedule[0]
            : (data.message || '星舰基地道路封路通知')
          const nextNotice = {
            isActive: true,
            message: msgText,
            timeRange,
            sourceLabel: sourceMap[data.source] || data.source || ''
          }
          this._roadClosureNoticeLoadedAt = Date.now()
          const prev = this.data.roadClosureNotice
          // 内容未变时跳过 setData，避免横幅跑马灯动画被重置产生跳动
          if (
            !prev ||
            prev.message !== nextNotice.message ||
            prev.timeRange !== nextNotice.timeRange ||
            prev.sourceLabel !== nextNotice.sourceLabel
          ) {
            this.setData({ roadClosureNotice: nextNotice })
          }
          return nextNotice
        }

        this._roadClosureNoticeLoadedAt = Date.now()
        if (this.data.roadClosureNotice) {
          this.setData({ roadClosureNotice: null })
        }
        return null
      } catch (e) {
        return null
      }
      }
    })
  },

  async loadAnnouncementBanner() {
    try {
      const data = await getActiveAnnouncement()
      const prev = this.data.announcementBanner
      const next = data || null
      // 内容未变时跳过 setData，避免公告跑马灯动画被重置
      if (
        (!prev && !next) ||
        (prev && next &&
          prev.active === next.active &&
          prev.title === next.title &&
          prev.content === next.content)
      ) {
        return
      }
      this.setData({ announcementBanner: next })
    } catch (e) {
      if (this.data.announcementBanner) {
        this.setData({ announcementBanner: null })
      }
    }
  },

  closeAnnouncementBanner() {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    this.setData({ announcementBanner: null })
  },

  openAnnouncementDetail() {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    if (this.data.announcementBanner) {
      this.setData({ announcementDialogVisible: true })
    }
  },

  closeAnnouncementDetail() {
    this.setData({ announcementDialogVisible: false })
  },

  /** 客服会话回调：用户在会话中点击小程序卡片返回时，按卡片指定路径跳转（与 profile 页同款） */
  onContactCallback(e) {
    var detail = (e && e.detail) || {}
    var path = String(detail.path || '')
    if (!path) return
    var query = detail.query || {}
    var qs = Object.keys(query)
      .map(function (k) { return k + '=' + encodeURIComponent(query[k]) })
      .join('&')
    var url = (path.charAt(0) === '/' ? path : '/' + path) + (qs ? '?' + qs : '')
    wx.navigateTo({
      url: url,
      fail: function () {
        // tabBar 页面无法 navigateTo，退回 switchTab
        wx.switchTab({ url: url.split('?')[0], fail: function () {} })
      }
    })
  },

  // 加载 SpaceX 官网发射统计
  async loadSpaceXStats(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh

    return this.runTimedManagedPageRequest({
      forceRefresh,
      strategy: 'simple',
      hasData: !!this.data.spacexStats,
      lastLoadedAt: this._spacexStatsLoadedAt,
      ttlMs: SPACEX_STATS_REFRESH_TTL,
      getCachedValue: () => this.data.spacexStats,
      promiseKey: '_loadSpaceXStatsPromise',
      requestFactory: async () => {
      this.setData({ spacexStatsLoading: true })
      try {
        const data = await getSpaceXLaunchStats()
        if (data && data.isActive) {
          const sourceMap = { manual: '管理员', spacex_official: 'SpaceX官网' }
          const nextStats = {
            totalLaunches: data.totalLaunches || 0,
            totalLandings: data.totalLandings || 0,
            totalReflights: data.totalReflights || 0,
            upcoming: (data.upcoming || []).slice(0, 10),
            recentCompleted: (data.recentCompleted || []).slice(0, 5),
            sourceLabel: sourceMap[data.source] || data.source || 'SpaceX',
            syncedAt: data.syncedAt || data.updatedAt
          }
          this._spacexStatsLoadedAt = Date.now()
          this.setData({
            spacexStats: nextStats,
            spacexStatsLoading: false
          })
          return nextStats
        }

        this._spacexStatsLoadedAt = Date.now()
        this.setData({ spacexStats: null, spacexStatsLoading: false })
        return null
      } catch (e) {
        console.error('[SpaceXStats] load error:', e)
        this.setData({ spacexStatsLoading: false })
        return null
      }
      }
    })
  },

  openRoadClosureDetail() {
    navigateTo(ROUTES.ROAD_CLOSURE_DETAIL)
  },

  async loadCarouselImages() {
    const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm)$/i
    const PREFIX = /^首页轮播图\//i
    let carouselDisabled = false
    let imageDuration = 5
    let videoDuration = 5
    let configFromCache = false

    try {
      const cached = await new Promise((resolve) => {
        wx.getStorage({
          key: CAROUSEL_CONFIG_CACHE_KEY,
          success: (res) => resolve(res.data),
          fail: () => resolve(null)
        })
      })
      if (cached && cached.ts && (Date.now() - cached.ts < CAROUSEL_CONFIG_CACHE_TTL)) {
        carouselDisabled = !!cached.disabled
        imageDuration = cached.imageDuration || 5
        videoDuration = cached.videoDuration || 5
        configFromCache = true
      }
    } catch (e) {}

    // 配置命中本地缓存：只查条目（1 次 DB）；未命中：配置+条目并行（墙钟≈1 次）
    let docs = []
    try {
      const db = wx.cloud.database()
      const _ = db.command
      if (configFromCache) {
        if (!carouselDisabled) {
          const dbRes = await db.collection('media_assets')
            .where({ sourceTag: _.in(['carousel', 'auto-carousel']) })
            .limit(100)
            .get()
          docs = dbRes.data || []
        }
      } else {
        const [cfgRes, itemsRes] = await Promise.all([
          db.collection('media_assets').where({ key: '__carousel_global_config__' }).limit(1).get(),
          db.collection('media_assets').where({ sourceTag: _.in(['carousel', 'auto-carousel']) }).limit(100).get()
        ])
        const configDoc = (cfgRes.data || [])[0]
        carouselDisabled = !!(configDoc && configDoc.enabled === false)
        imageDuration = (configDoc && configDoc.imageDuration) ? Number(configDoc.imageDuration) : 5
        videoDuration = (configDoc && configDoc.videoDuration) ? Number(configDoc.videoDuration) : 5
        docs = itemsRes.data || []
        wx.setStorage({
          key: CAROUSEL_CONFIG_CACHE_KEY,
          data: {
            disabled: carouselDisabled,
            imageDuration,
            videoDuration,
            ts: Date.now()
          }
        })
      }
    } catch (e) {
      console.warn('动态获取轮播图失败，使用默认图片', e)
    }

    if (carouselDisabled) {
      this.setData({ carouselImages: [], carouselLoadFailed: false })
      return
    }

    this.setData({
      carouselImageDuration: imageDuration * 1000,
      carouselVideoDuration: videoDuration * 1000
    })

    let items = []
    try {
      const filtered = (docs || [])
        .filter((d) => d && d.enabled !== false && d.key && PREFIX.test(String(d.key)))
        .sort((a, b) => {
          const sa = Number(a.sort || 0)
          const sb = Number(b.sort || 0)
          const aIsAuto = a.sourceTag === 'auto-carousel'
          const bIsAuto = b.sourceTag === 'auto-carousel'
          if (!aIsAuto && bIsAuto) return -1
          if (aIsAuto && !bIsAuto) return 1
          if (!aIsAuto && !bIsAuto) {
            if (sa !== sb) return sa - sb
            return String(a.key || '').localeCompare(String(b.key || ''))
          }
          const ta = Number(a.cosSyncedAt || 0)
          const tb = Number(b.cosSyncedAt || 0)
          return tb - ta
        })
        .slice(0, 20)
      if (filtered.length > 0) {
        items = filtered
          .map((doc) => {
            const rawSrc = doc.url || resolveMediaUrl(doc.key, '')
            const src = doc.url
              ? getCachedMediaImage(toCdnUrl(doc.url), 'medium')
              : rawSrc
            if (!src) return null
            const isVideo = doc.type === 'video' || VIDEO_EXTS.test(doc.key || '') || VIDEO_EXTS.test(doc.url || '')
            const folderMatch = String(doc.key || '').match(/^首页轮播图\/auto\/([^/]+)\//)
            const posterUrl = isVideo
              ? carouselVideoPosterUrl(src, doc.thumbnailUrl || '')
              : ''
            const poster = posterUrl
              ? getCachedMediaImage(posterUrl, 'thumb')
              : ''
            const previewSrc = (doc.previewUrl && String(doc.previewUrl).trim())
              ? toCdnUrl(String(doc.previewUrl).trim())
              : ''
            // 非会员：默认不预热、不写入可播地址（策略 forceNonMemberVideoPoster）；有权益才预热预览片
            // 无预览片时也不用原片做内嵌自动播（原片过大），点击全屏再按需播
            const playSrc = previewSrc && canPrefetchVideoSync()
              ? getCachedVideo(previewSrc)
              : ''
            return {
              // 视频项 src 不挂 mp4，避免任何回退路径误拉原片
              src: isVideo ? (poster || src) : src,
              playSrc,
              poster: poster || '',
              type: isVideo ? 'video' : 'image',
              caption: doc.caption || '',
              eventId: doc.eventId || '',
              cosFolder: doc.cosFolder || (folderMatch ? folderMatch[1] : ''),
              accountLabel: '',
              accountAvatar: '',
              videoActive: false,
              videoStarted: false,
              lazyPlayUrl: isVideo ? (previewSrc || toCdnUrl(doc.url || rawSrc) || '') : ''
            }
          })
          .filter(Boolean)
      }
    } catch (e) {
      console.warn('解析轮播图失败，使用默认图片', e)
    }

    if (!items.length) {
      items = this.getDefaultCarouselImages().map(src => ({ src, type: 'image' }))
    }

    // lazyPlayUrl 只留在实例旁路，不进 setData，避免非会员视图层挂远程 mp4
    this._carouselLazyPlayUrls = items.map((i) => (i && i.lazyPlayUrl) || '')
    const viewItems = items.map((i) => {
      if (!i || !i.lazyPlayUrl) return i
      const { lazyPlayUrl, ...rest } = i
      return rest
    })

    this.setData({
      carouselItems: viewItems,
      carouselImages: viewItems.map(i => i.src),
      carouselLoadFailed: !viewItems.length,
      carouselCurrent: 0
    })

    if (viewItems.length > 0) {
      this._activateCarouselVideos(0)
      this._startCarouselTimer()
    }

    this._enrichCarouselCaptions(viewItems)
    this._enrichCarouselAccounts(viewItems)
  },

  /** 按 cosFolder 匹配 tweet_accounts，给轮播项补充账号名 + 头像（左上角胶囊） */
  async _enrichCarouselAccounts(items) {
    if (!items || !items.some((i) => i && i.cosFolder)) return
    const accounts = await this._getTweetAccountsCached()
    if (!accounts.length) return
    const byFolder = {}
    for (const acc of accounts) {
      if (acc.cosFolder) byFolder[acc.cosFolder] = acc
    }
    const updates = {}
    for (let i = 0; i < items.length; i++) {
      const acc = items[i] && items[i].cosFolder ? byFolder[items[i].cosFolder] : null
      if (!acc) continue
      // 头像：库里没配时按约定路径兜底（avatars/<screenName>.jpg），加载失败会自动隐藏
      const avatarUrl = acc.avatarUrl ||
        (acc.screenName ? `https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/${acc.screenName}.jpg` : '')
      updates[`carouselItems[${i}].accountLabel`] = acc.label || acc.screenName || ''
      updates[`carouselItems[${i}].accountAvatar`] = avatarUrl
        ? getCachedMediaImage(toCdnUrl(avatarUrl), 'thumb')
        : ''
    }
    if (Object.keys(updates).length) this.setData(updates)
  },

  /** 推文账号列表：本地缓存 24 小时，减少网关调用 */
  async _getTweetAccountsCached() {
    const CACHE_KEY = '_tweet_accounts_cache_v1'
    const TTL = 24 * 60 * 60 * 1000
    try {
      const hit = wx.getStorageSync(CACHE_KEY)
      if (hit && Array.isArray(hit.list) && hit.list.length && Date.now() - hit.at < TTL) {
        return hit.list
      }
    } catch (e) {}
    try {
      const res = await wx.cloud.callFunction({
        name: 'userDataGateway',
        data: { action: 'getTweetAccounts' }
      })
      const list = (res && res.result && res.result.accounts) || []
      if (list.length) {
        try { wx.setStorageSync(CACHE_KEY, { list, at: Date.now() }) } catch (e) {}
      }
      return list
    } catch (e) {
      return []
    }
  },

  /** 账号胶囊头像加载失败 → 只显示账号名 */
  onCarouselAvatarError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!isNaN(index) && this.data.carouselItems[index]) {
      this.setData({ [`carouselItems[${index}].accountAvatar`]: '' })
    }
  },

  async _enrichCarouselCaptions(items) {
    const needEnrich = []
    for (let i = 0; i < items.length; i++) {
      if (!items[i].caption && items[i].src) {
        // 从 URL 中提取 tweetId（格式: .../{tweetId}_video{n}.mp4 或 {tweetId}_{n}.jpg）
        const urlPath = decodeURIComponent(items[i].src).split('/').pop() || ''
        const match = urlPath.match(/^(\d+)_/)
        if (match) needEnrich.push({ index: i, tweetId: match[1] })
      }
    }
    if (!needEnrich.length) return

    try {
      const db = wx.cloud.database()
      const tweetIds = [...new Set(needEnrich.map(e => e.tweetId))]
      const res = await db.collection('starship_event_updates')
        .where({ tweetId: db.command.in(tweetIds), status: 'published' })
        .field({ _id: true, tweetId: true, content: true, title: true })
        .limit(20)
        .get()
      const eventMap = {}
      for (const doc of (res.data || [])) {
        if (doc.tweetId) eventMap[doc.tweetId] = { eventId: doc._id, content: doc.content || '', title: doc.title || '' }
      }

      const updates = {}
      for (const { index, tweetId } of needEnrich) {
        const info = eventMap[tweetId]
        if (info) {
          updates[`carouselItems[${index}].caption`] = info.content || info.title
          updates[`carouselItems[${index}].eventId`] = info.eventId
        }
      }
      if (Object.keys(updates).length) this.setData(updates)
    } catch (e) {}
  },

  async loadInitialData(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh
    // 下拉刷新时已有原生刷新指示器，不再叠加“加载中”toast
    const suppressLoading = !!safeOptions.suppressLoading

    return this.runManagedPageRequest('_loadInitialDataPromise', async () => {
      try {
        if (getApp()._splashShownThisSession && !suppressLoading) {
          wx.showLoading({ title: '加载中...' })
        }

        // 媒体映射与列表接口并行；首屏仍有 2.5s 预算，超时后继续渲染，map 就绪后再统一刷新三处图
        // 非会员只拉免费额度（与展示门控 / 后台 freeMissionListLimit 一致）
        const fullCloud = canUsePaidCloudSync()
        const freeMissionLimit = getMemberPolicySync().freeMissionListLimit || FREE_MISSION_LIST_LIMIT
        const FULL_LIMIT = fullCloud ? 50 : freeMissionLimit
        const [, pack] = await Promise.all([
          Promise.race([
            loadCloudMediaMap().catch(() => {}),
            new Promise((r) => setTimeout(r, LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS))
          ]),
          Promise.race([
            this.fetchMissionList('upcoming', FULL_LIMIT, 0),
            new Promise((_, reject) => setTimeout(() => reject(new Error('加载超时，请稍后再试')), 15000))
          ])
        ])
        let { res: upcomingRes, list: upcomingList } = pack

        // map 已就绪时，首屏盖章前按火箭名强制重算，避免把 default 写进倒计时/卡片
        try {
          upcomingList = (upcomingList || []).map((m) => {
            if (!m || !m.rocketName) return m
            const rebuilt = resolveMissionRocketImage(
              m.rocketImage || m.image || '',
              m.rocketName,
              m.rocketConfiguration,
              true
            )
            if (!shouldReplaceRocketImage(m.rocketImage || m.image, rebuilt)) return m
            return { ...m, rocketImage: rebuilt, image: rebuilt }
          })
        } catch (eStamp) {}

        const firstPaintList = upcomingList.slice(0, 5)

        try {
          this._preloadVisibleRocketImages(firstPaintList, 5)
        } catch (ePre) {}

        const firstMission = upcomingList[0]
        this.applyInitialUpcomingLaunchState(firstMission, upcomingList, upcomingRes)

        wx.hideLoading()

        // DB media_assets 真正加载完成后（即便 race 已超时）再刷新一次列表+倒计时火箭图
        loadCloudMediaMap()
          .then(() => {
            try { this._refreshRocketImagesFromMediaMap() } catch (e) {}
          })
          .catch(() => {})

        try { this._preloadVisibleRocketImages(upcomingList, fullCloud ? 8 : freeMissionLimit) } catch (e) {}

        this.fetchMissionList('completed', FULL_LIMIT, 0)
          .then(({ res, list }) => {
            this.handleCompletedMissionLoadSuccess(list, res)
          })
          .catch((error) => {
            this.handleCompletedMissionLoadError(error)
          })
      } catch (error) {
        wx.hideLoading()
        this.handleInitialUpcomingLoadError(error)
      }
    }, {
      allowReuse: !forceRefresh
    })
  },


  /**
   * 预下载列表中前 N 张火箭配置图到本地缓存（HTTPS → wxfile），下次冷启动可直接命中本地。
   * @param {Array} list 任务列表
   * @param {Number} n 预热数量
   */
  _preloadVisibleRocketImages(list, n) {
    if (!Array.isArray(list) || !list.length) return
    const max = Math.max(0, Math.min(Number(n) || 0, list.length))
    if (!max) return

    const urls = []
    for (let i = 0; i < max; i++) {
      const item = list[i]
      const ru = item && (item.rocketImage || item.image)
      if (typeof ru === 'string' && /^https?:\/\//i.test(ru.trim())) {
        urls.push(ru.trim())
      }
    }
    if (urls.length) preloadRocketConfigMedia(urls)
  },

  /**
   * DB media_assets 加载完成后，重算列表 + 倒计时区火箭图（三处同源）。
   * 允许 default → 正确图升级；禁止正确图 → default 降级（二次刷新 fuzzy miss 时）。
   */
  _refreshRocketImagesFromMediaMap() {
    const resolveOne = (m) => {
      if (!m || !m.rocketName) return null
      return resolveMissionRocketImage(
        m.rocketImage || m.image || '',
        m.rocketName,
        m.rocketConfiguration,
        true
      )
    }
    const refreshList = (listKey) => {
      const arr = this.data[listKey]
      if (!Array.isArray(arr) || !arr.length) return null
      let mutated = false
      const next = arr.map((m) => {
        if (!m || !m.rocketName) return m
        const rebuilt = resolveOne(m)
        if (!shouldReplaceRocketImage(m.rocketImage || m.image, rebuilt)) return m
        mutated = true
        return { ...m, rocketImage: rebuilt, image: rebuilt }
      })
      return mutated ? next : null
    }
    const patch = {}
    const upNext = refreshList('upcomingMissions')
    if (upNext) patch.upcomingMissions = upNext
    const dispNext = refreshList('displayedUpcomingMissions')
    if (dispNext) patch.displayedUpcomingMissions = dispNext
    const cpNext = refreshList('completedMissions')
    if (cpNext) patch.completedMissions = cpNext
    const calNext = refreshList('calendarAllMissions')
    if (calNext) patch.calendarAllMissions = calNext

    // 倒计时区与列表同 id 任务强制对齐（同样禁止降级）
    const ld = this.data.launchData
    if (ld && ld.id && ld.rocketName) {
      const curLd = ld.rocketImage || ld.image || ''
      const rebuiltLd = resolveOne(ld)
      if (shouldReplaceRocketImage(curLd, rebuiltLd)) {
        patch['launchData.image'] = rebuiltLd
        patch['launchData.rocketImage'] = rebuiltLd
      } else if (upNext) {
        const row = upNext.find((m) => m && String(m.id) === String(ld.id))
        if (row && shouldReplaceRocketImage(curLd, row.rocketImage)) {
          patch['launchData.image'] = row.rocketImage
          patch['launchData.rocketImage'] = row.rocketImage
        }
      }
    }

    if (Object.keys(patch).length) {
      this.setData(patch, () => {
        try {
          if (patch.upcomingMissions) this.updateMissionListView('upcoming', patch.upcomingMissions)
          if (patch.completedMissions) this.updateMissionListView('completed', patch.completedMissions)
          if (patch.calendarAllMissions) {
            this.updateCalendarDerivedState({
              sourceMissions: patch.calendarAllMissions,
              allMissions: patch.calendarAllMissions,
              keepExpanded: true
            })
          }
        } catch (e) {}
        try { this.syncLaunchPanelRocketImageWithUpcomingList() } catch (e) {}
        // 简报若已用 default 固化，随 media map 刷新重建，与卡片/倒计时同源
        try {
          const briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e2) {}
      })
      try {
        const top = patch.upcomingMissions || patch.completedMissions || patch.calendarAllMissions
        this._preloadVisibleRocketImages(top, 8)
      } catch (e) {}
    } else {
      try { this.syncLaunchPanelRocketImageWithUpcomingList() } catch (e) {}
    }
  },


  /**
   * 加载当前 tab 的任务列表（仅在缺失时补拉）
   */
  async loadMissions() {
    if (this.data.missionType === 'calendar') return

    const activeType = this.getActiveMissionListType()
    const currentList = this.getMissionListByType(activeType)
    if (Array.isArray(currentList) && currentList.length > 0) {
      this.updateMissionListView(activeType, currentList)
      return
    }

    try {
      await this.ensureMissionListsReady(activeType)
    } catch (error) {
      const errorMessage = this.resolveMissionLoadErrorMessage(error, {
        timeoutMessage: '请求超时，请检查网络'
      })
      if (this.shouldIgnoreMissionLoadError(error)) return
      this.setData(buildMissionListErrorState(errorMessage, { showMissionsEmpty: false }))
      wx.showToast({ title: errorMessage, icon: 'none', duration: 2000 })
    }
  },

  /**
   * 滚动到底时加载更多任务（无限滚动）
   */
  onMissionsScrollToLower() {
    if (this.data.missionType === 'calendar') return
    this.loadMoreMissions()
  },

  _withResolvedRocketImage(mission) {
    if (!mission || typeof mission !== 'object') return mission
    const stamped = mission.rocketImage || mission.image
    const force = isDefaultRocketSrc(stamped)
    const resolved = resolveMissionRocketImage(
      force ? '' : stamped,
      mission.rocketName,
      mission.rocketConfiguration,
      force
    )
    if (resolved === mission.rocketImage && resolved === mission.image) return mission
    return { ...mission, rocketImage: resolved, image: resolved }
  },


  _vibrateLight() {
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
  },

  _vibrateMedium() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      try { wx.vibrateShort() } catch (err) {}
    }
  },

  _rpxToPx(rpx) {
    if (!this._cachedWindowWidth) {
      const sys = getSystemInfo()
      this._cachedWindowWidth = (sys && sys.windowWidth) || 375
    }
    return (this._cachedWindowWidth / 750) * rpx
  },

  _getMissionListScrollTop() {
    if (typeof this._latestMissionListScrollTop === 'number') {
      return this._latestMissionListScrollTop
    }
    if (this.data.missionType === 'upcoming') return this.data.scrollTopUpcoming || 0
    if (this.data.missionType === 'completed') return this.data.scrollTopCompleted || 0
    return 0
  },

  _clearMissionCardMeasureTimer() {
    if (this._missionCardMeasureTimer) {
      clearTimeout(this._missionCardMeasureTimer)
      this._missionCardMeasureTimer = null
    }
  },

  _resetMissionCardHaptics() {
    this._clearMissionCardMeasureTimer()
    this._missionCardMetrics = null
    this._missionCardActiveIndex = -1
    this._lastMissionCardVibrateAt = 0
    this._latestMissionListScrollTop = null
    this._missionCardNeedsFreshMeasure = true
  },

  _applyScrollCardHapticState(options = {}) {
    const hapticState = buildMissionCardHapticState({
      focusIndex: options.focusIndex,
      activeIndex: options.activeIndex,
      lastVibrateAt: options.lastVibrateAt,
      now: Date.now(),
      vibrateIntervalMs: 120
    })
    if (hapticState.shouldSyncActiveIndex && typeof options.setActiveIndex === 'function') {
      options.setActiveIndex(hapticState.nextActiveIndex)
    }
    if (hapticState.shouldVibrate && typeof options.setLastVibrateAt === 'function') {
      options.setLastVibrateAt(hapticState.nextLastVibrateAt)
      this._vibrateMedium()
    }
    return hapticState
  },

  _getMissionCardFocusIndex(scrollTop) {
    const metrics = this._missionCardMetrics
    if (!metrics || !metrics.pitch || !metrics.cardCount) return -1

    const viewportHeight = this._windowHeight || getSystemInfo().windowHeight || 0
    const navPlaceholderHeight = this.data.navPlaceholderHeight || 0
    const visibleHeight = Math.max(viewportHeight - navPlaceholderHeight, metrics.cardHeight || 0)
    const anchorOffset = navPlaceholderHeight + visibleHeight * 0.32
    const firstCardCenter = metrics.firstOffset + ((metrics.cardHeight || metrics.pitch) / 2)

    let nextIndex = Math.round((scrollTop + anchorOffset - firstCardCenter) / metrics.pitch)
    if (nextIndex < 0) nextIndex = 0
    if (nextIndex > metrics.cardCount - 1) nextIndex = metrics.cardCount - 1
    return nextIndex
  },

  _syncMissionCardHapticIndex(scrollTop) {
    const focusIndex = this._getMissionCardFocusIndex(typeof scrollTop === 'number' ? scrollTop : this._getMissionListScrollTop())
    const hapticState = buildMissionCardHapticState({
      focusIndex,
      activeIndex: this._missionCardActiveIndex,
      lastVibrateAt: this._lastMissionCardVibrateAt,
      now: Date.now(),
      vibrateIntervalMs: 120
    })
    if (hapticState.shouldSyncActiveIndex) {
      this._missionCardActiveIndex = hapticState.nextActiveIndex
    }
    this._missionCardNeedsFreshMeasure = false
  },

  _handleMissionCardScrollHaptics(scrollTop) {
    this._latestMissionListScrollTop = scrollTop
    const shouldMeasure = shouldScheduleMissionCardMeasurement({
      missionType: this.data.missionType,
      missionsLoadingMore: this.data.missionsLoadingMore,
      hasMetrics: !!this._missionCardMetrics,
      needsFreshMeasure: !!this._missionCardNeedsFreshMeasure,
      hasPendingMeasure: !!this._missionCardMeasureTimer
    })
    if (shouldMeasure) {
      this._scheduleMissionCardMeasurement(true, scrollTop)
      return
    }
    if (this.data.missionType === 'calendar' || this.data.missionsLoadingMore) return

    const focusIndex = this._getMissionCardFocusIndex(scrollTop)
    this._applyScrollCardHapticState({
      focusIndex,
      activeIndex: this._missionCardActiveIndex,
      lastVibrateAt: this._lastMissionCardVibrateAt,
      setActiveIndex: (nextIndex) => {
        this._missionCardActiveIndex = nextIndex
      },
      setLastVibrateAt: (nextTime) => {
        this._lastMissionCardVibrateAt = nextTime
      }
    })
  },

  _scheduleMissionCardMeasurement(syncActiveCard = false, scrollTopOverride) {
    if (this.data.missionType === 'calendar') return
    if (this._missionCardMeasureTimer) return

    const measureDelay = typeof scrollTopOverride === 'number' ? 16 : 0
    this._missionCardMeasureTimer = setTimeout(() => {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.content-scroll').boundingClientRect()
        query.selectAll('.missions-list .mission-card').boundingClientRect()
        query.exec((res) => {
          this._missionCardMeasureTimer = null
          const scrollViewRect = res && res[0]
          const cardRects = (res && res[1]) || []
          if (!scrollViewRect || !cardRects.length) {
            this._missionCardMetrics = null
            this._missionCardActiveIndex = -1
            return
          }

          const currentScrollTop = typeof scrollTopOverride === 'number'
            ? scrollTopOverride
            : this._getMissionListScrollTop()
          const firstRect = cardRects[0]
          const secondRect = cardRects[1]
          const fallbackGap = this._rpxToPx(20)
          const pitch = secondRect && secondRect.top > firstRect.top
            ? (secondRect.top - firstRect.top)
            : ((firstRect.height || 0) + fallbackGap)

          this._missionCardMetrics = {
            firstOffset: currentScrollTop + firstRect.top - scrollViewRect.top,
            pitch: pitch || 1,
            cardHeight: firstRect.height || 0,
            cardCount: cardRects.length
          }
          this._missionCardNeedsFreshMeasure = false

          if (syncActiveCard) {
            this._syncMissionCardHapticIndex(currentScrollTop)
          }
        })
      })
    }, measureDelay)
  },


  /**
   * 加载更多任务（追加到列表，直至 API 无下一页）
   */
  async loadMoreMissions() {
    const type = this.getActiveMissionListType()

    // 非会员深度门控：列表只展示前 missionGateLimit 条，
    // 每次触底都弹开通引导（仅弹窗进行中防重入，关掉后再滑仍会提示）
    if (this.data.missionGateLimit > 0) {
      if (this._missionGateChecking) return
      this._missionGateChecking = true
      try {
        await this.onMissionGateTap()
      } finally {
        this._missionGateChecking = false
      }
      return
    }

    const hasMore = this.hasMoreMissionListByType(type)
    if (!hasMore || this.data.missionsLoadingMore || this._loadingMoreLock) return

    this.beginLoadMoreMissions()

    const offset = this.getMissionListOffsetByType(type)
    try {
      const { res, list: formatted } = await this.fetchMissionList(type, 10, offset)
      this.handleLoadMoreMissionSuccess(type, formatted, res, offset)
    } catch (error) {
      this.handleLoadMoreMissionFallback(error, type)
    } finally {
      this.finishLoadMoreMissions()
    }
  },

  /**
   * 开始倒计时
   */
  startCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    // 立即按真实时间刷新一次，避免后台返回后显示停留在旧值
    this.updateCountdown()
    const timer = setInterval(() => {
      this.updateCountdown()
      const loopMeta = buildCountdownLoopMeta(this.lastCheckTime, Date.now(), 60000)
      if (loopMeta.shouldCheckExpired) {
        this.lastCheckTime = loopMeta.nextLastCheckTime
        this.checkAndRefreshIfExpired()
      }
    }, 1000)

    this._countdownTimer = timer
  },

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    if (this._countdownSecondsRollTimer) {
      clearTimeout(this._countdownSecondsRollTimer)
      this._countdownSecondsRollTimer = null
    }
  },

  /**
   * 检查当前任务是否过期，如果过期则重新加载
   */
  async checkAndRefreshIfExpired() {
    if (!shouldRefreshExpiredLaunch(this.data.launchData, Date.now())) return
    // 到点后交给实时状态确认流程接管（成功/失败才落历史并切换，推迟则恢复倒计时），不再盲目本地切换
    this._onCountdownExpired()
  },

  /**
   * 更新倒计时
   */
  updateCountdown() {
    const cardCountdownPatch = this._buildMissionCardCountdownTickPatch()
    // 卡片倒计时与主倒计时相互独立：主倒计时的任何 early-return 都不能丢卡片补丁
    const flushCardCountdownPatch = () => {
      if (Object.keys(cardCountdownPatch).length) {
        this.setData(cardCountdownPatch)
      }
    }

    if (!this.data.launchData.launchTime) {
      flushCardCountdownPatch()
      return
    }

    const countdown = getCountdown(this.data.launchData.launchTime)

    if (shouldAutoSwitchCountdown(countdown, this._switchingCountdown)) {
      flushCardCountdownPatch()
      // 到点不再直接切下一个任务，先向 LL2 确认当前任务实际状态
      this._onCountdownExpired()
      return
    }

    const nextSecondsText = formatSecondsText(countdown.seconds)
    const currentSecondsText = formatSecondsText(this.data.countdownSecondsCurrent)
    const nextSecondsReel = getSecondsReel(countdown.seconds)
    const tickState = buildCountdownTickState({
      countdown,
      prevCountdown: this.data.countdown,
      currentSecondsText,
      nextSecondsText,
      nextSecondsReel
    })

    if (!tickState.didSecondsChange) {
      flushCardCountdownPatch()
      return
    }

    if (this._countdownSecondsRollTimer) {
      clearTimeout(this._countdownSecondsRollTimer)
      this._countdownSecondsRollTimer = null
    }
    // 秒位滚动 + 卡片 countdown 合并为一次 setData
    const immediateState = {
      ...(tickState.immediateState || {}),
      ...cardCountdownPatch
    }
    this.setData(immediateState)
    this._countdownSecondsRollTimer = setTimeout(() => {
      this.setData(tickState.settleState)
      this._countdownSecondsRollTimer = null
    }, 540)
  },

  /**
   * 切换倒计时到下一个未过期的任务（从已加载的列表中取，无需重新请求）
   */
  switchToNextUpcomingMission() {
    const currentId = this.data.launchData.id
    const missions = this.data.upcomingMissions || []

    const filtered = filterExpiredMissions(missions)
    if (filtered.length !== missions.length) {
      const patch = { upcomingMissions: filtered }
      this.applyUpcomingAgencyFilterToPatch(patch)
      this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
    }

    const next = getNextUpcomingLaunch(filtered, currentId, Date.now())

    if (next) {
      this.setData(buildCurrentLaunchPanelState({
        mission: next,
        formatDate,
        getStatusTextZh,
        subscribedIdSet: this._getPageSubscribedIdSet()
      }), () => {
        Promise.resolve(loadCloudMediaMap())
          .catch(() => {})
          .finally(() => {
            this.refreshLaunchPanelRocketImageUrl()
            this.syncLaunchPanelRocketImageWithUpcomingList()
          })
      })
      this.applyLaunchSwitchEffects(next, { shouldSkipVoteCache: true })
    }
    this._switchingCountdown = false
  },

  // ══════════════════════════════════════════════════════════════
  // 倒计时到点：实时状态确认（代替盲目切换）
  // T-0 后面板先显示「状态确认中」，T+10 分钟向 LL2 确认实际状态：
  // 成功/失败/部分失败/载荷已部署落历史并切换；飞行中/推迟/就绪展示实况并每 5 分钟复查；
  // NET 推后则恢复倒计时，30 分钟未决兜底切换。
  // 热路径：仅当前倒计时任务可走 /updates/ 社媒终态旁路（有云缓存）；
  // 历史任务发射动态靠 6h slim 拆分的 updates_{uuid} 冷路径。
  // ══════════════════════════════════════════════════════════════

  /** 倒计时到期入口（每秒 tick 都可能进来，需防重入 + 节流） */
  _onCountdownExpired() {
    if (this._launchStatusPolling) return
    const now = Date.now()
    if (now - (this._lastExpiredRoundAt || 0) < LIVE_STATUS_MIN_ROUND_GAP_MS) return
    this._lastExpiredRoundAt = now

    const ld = this.data.launchData
    const currentId = ld && ld.id != null ? String(ld.id) : ''
    if (!currentId) return

    // 兜底窗口以任务 NET 为起点：中途离开页面再回来也不会重置计时
    if (this._launchStatusPollLaunchId !== currentId) {
      const netMs = ld.launchTime ? new Date(ld.launchTime).getTime() : 0
      this._launchStatusPollLaunchId = currentId
      this._launchStatusPollStartAt = (netMs && !isNaN(netMs)) ? netMs : now
    }

    // NET 已过 30 分钟仍未决：不再请求，尽量带终态兜底切换
    if (now - this._launchStatusPollStartAt >= LIVE_STATUS_MAX_WAIT_MS) {
      this._launchStatusPolling = true
      this._settleExpiredLaunchWithBestEffort(currentId)
      return
    }

    this._launchStatusPolling = true
    // 面板定格 00:00:00，状态置「确认中」（竞猜框随 isExpired 自动隐藏）
    this.setData({
      countdown: { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, isExpired: true },
      countdownSecondsCurrent: 0,
      countdownSecondsRolling: false,
      countdownSecondsReel: getSecondsReel(0),
      'launchData.statusTextZh': '状态确认中',
      'launchData.statusCategory': 'pending'
    })
    // LL2 状态更新有滞后，T-0 不请求，到 NET+10 分钟才发第一次请求
    const firstCheckDelay = Math.max(0, this._launchStatusPollStartAt + LIVE_STATUS_FIRST_CHECK_DELAY_MS - now)
    if (this._statusRecheckTimer) clearTimeout(this._statusRecheckTimer)
    this._statusRecheckTimer = setTimeout(() => {
      this._statusRecheckTimer = null
      this._checkLiveLaunchStatus(currentId)
    }, firstCheckDelay)
  },

  /** 拉取前 5 个任务实时状态并按当前任务状态分流 */
  async _checkLiveLaunchStatus(currentId) {
    let rows = null
    try {
      rows = await fetchLiveLaunchStatuses()
      // 失败：短抖动后重试 1 次，避免与云端 30s fail memo 连击
      if (!rows) {
        await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 600)))
        rows = await fetchLiveLaunchStatuses()
      }
    } catch (e) {
      rows = null
    }

    // 期间任务已被切换（用户操作/整页刷新）：终止本轮，新任务到点会重新开始
    const ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== currentId) {
      this._launchStatusPolling = false
      return
    }

    if (!rows) {
      const fromUpdates = await this._trySettleFromLl2Updates(currentId)
      if (fromUpdates) return
      this._scheduleStatusRecheck(currentId, '待定', 'pending')
      return
    }

    // 顺带把实况 patch 进源列表，再同步 displayed（避免双倍路径字段）
    this._patchUpcomingListLiveStatuses(rows)

    const row = rows.find((r) => r && String(r.id) === currentId) || null
    if (!row) {
      // 已移出 upcoming 前 5：先验终态再切；无终态则继续复查，避免误裸切
      let settledRow = await this._lookupRecentSettledRow(currentId)
      if (!settledRow) {
        settledRow = await this._fetchTerminalFromLl2Updates(currentId)
      }
      if (settledRow && settledRow.status) {
        this._settleExpiredLaunch(settledRow)
        return
      }
      this._scheduleStatusRecheck(currentId, '待定', 'pending')
      return
    }

    const statusId = row.status ? Number(row.status.id) : 0

    // 终态：成功(3) / 失败(4) / 部分失败(7) / 载荷已部署(9) → 落历史并发射切换
    if (isTerminalStatusId(statusId)) {
      this._settleExpiredLaunch(row)
      return
    }

    // NET 已推后（新时间在 1 分钟以后）→ 更新发射时间，倒计时自然恢复
    const netMs = row.net ? new Date(row.net).getTime() : 0
    if (netMs && netMs - Date.now() > 60 * 1000) {
      this._applyPostponedNet(row)
      return
    }

    // status 仍非终态：用 Updates「Launch success.」等社媒记录旁路确认
    const fromUpdates = await this._trySettleFromLl2Updates(currentId, row)
    if (fromUpdates) return

    // 飞行中 / 推迟 / 就绪 等 → 显示实况并每 5 分钟复查（与角标同源）
    const category = getStatusCategory(row.status)
    const liveText = getStatusBadgeText(row.status, category)
    this._scheduleStatusRecheck(currentId, liveText, category)
  },

  /** 读 recent_settled 中该 id 的终态行（优先内存缓存） */
  async _lookupRecentSettledRow(currentId) {
    try {
      const settled = await this._ensureRecentSettledCache(false)
      if (!Array.isArray(settled)) return null
      const hit = settled.find((s) => s && String(s.id) === currentId && s.status)
      if (!hit) return null
      const sid = hit.status && hit.status.id != null ? Number(hit.status.id) : 0
      if (!isTerminalStatusId(sid)) return null
      return { id: hit.id, name: hit.name || '', status: hit.status, net: hit.net || '' }
    } catch (e) {
      return null
    }
  },

  /**
   * 拉 LL2 /updates/（与推迟徽标共用内存缓存），从「Launch success.」等推断终态。
   */
  async _fetchLl2UpdatesCached(launchId, minLimit) {
    const id = String(launchId || '').trim()
    if (!id) return null
    const need = Math.max(15, Number(minLimit) || 15)
    const now = Date.now()
    const mem = this._ll2UpdatesMem
    if (
      mem &&
      mem.id === id &&
      Array.isArray(mem.list) &&
      mem.limit >= need &&
      now - (mem.at || 0) < LL2_UPDATES_MEM_TTL_MS
    ) {
      return mem
    }
    try {
      const res = await fetchLl2LaunchUpdates(id, need)
      const list = res && Array.isArray(res.list) ? res.list : []
      const packed = {
        id,
        list,
        limit: need,
        at: now,
        outcome: (res && res.outcome) || inferTerminalStatusFromUpdates(list)
      }
      this._ll2UpdatesMem = packed
      return packed
    } catch (e) {
      return null
    }
  },

  /**
   * 拉 LL2 /updates/，从「Launch success.」等 comment + info_url 推断终态。
   * 云函数有 5–10 分钟缓存；仅在 status 未决时调用，避免浪费额度。
   */
  async _fetchTerminalFromLl2Updates(currentId) {
    const id = String(currentId || '').trim()
    if (!id) return null
    const now = Date.now()
    if (this._updatesOutcomeAt && this._updatesOutcomeId === id && now - this._updatesOutcomeAt < 3 * 60 * 1000) {
      return this._updatesOutcomeRow || null
    }
    try {
      const packed = await this._fetchLl2UpdatesCached(id, 15)
      const list = packed && Array.isArray(packed.list) ? packed.list : []
      const outcome = (packed && packed.outcome) || inferTerminalStatusFromUpdates(list)
      const ld = this.data.launchData || {}
      const row = outcome
        ? buildSettledRowFromUpdates(id, ld.missionName || ld.name || '', ld.launchTime || '', outcome)
        : null
      this._updatesOutcomeId = id
      this._updatesOutcomeAt = now
      this._updatesOutcomeRow = row
      return row
    } catch (e) {
      this._updatesOutcomeId = id
      this._updatesOutcomeAt = now
      this._updatesOutcomeRow = null
      return null
    }
  },

  /**
   * 若 Updates 能确认终态则落历史并返回 true。
   * @param {string} currentId
   * @param {object} [baseRow] 可选：保留 live 行的 net 等字段
   */
  async _trySettleFromLl2Updates(currentId, baseRow) {
    const fromUpdates = await this._fetchTerminalFromLl2Updates(currentId)
    if (!fromUpdates || !fromUpdates.status) return false
    const ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== String(currentId)) return false
    const merged = {
      ...fromUpdates,
      net: (baseRow && baseRow.net) || fromUpdates.net || ld.launchTime || '',
      name: fromUpdates.name || (baseRow && baseRow.name) || ld.missionName || ''
    }
    this._settleExpiredLaunch(merged)
    return true
  },

  /** 显示实况文案并安排 5 分钟后复查；NET 已过 30 分钟仍未决则兜底切换 */
  _scheduleStatusRecheck(currentId, liveText, liveCategory) {
    if (Date.now() - (this._launchStatusPollStartAt || 0) >= LIVE_STATUS_MAX_WAIT_MS) {
      this._settleExpiredLaunchWithBestEffort(currentId)
      return
    }
    const ld = this.data.launchData
    if (ld && String(ld.id != null ? ld.id : '') === currentId) {
      const patch = {}
      if (liveText && ld.statusTextZh !== liveText) patch['launchData.statusTextZh'] = liveText
      if (liveCategory && ld.statusCategory !== liveCategory) patch['launchData.statusCategory'] = liveCategory
      if (Object.keys(patch).length) this.setData(patch)
    }
    if (this._statusRecheckTimer) clearTimeout(this._statusRecheckTimer)
    this._statusRecheckTimer = setTimeout(() => {
      this._statusRecheckTimer = null
      this._checkLiveLaunchStatus(currentId)
    }, LIVE_STATUS_RECHECK_MS)
  },

  /**
   * 超时兜底：recent_settled → Updates 社媒记录 → 裸切。
   */
  async _settleExpiredLaunchWithBestEffort(currentId) {
    let row = await this._lookupRecentSettledRow(currentId)
    if (!row) {
      row = await this._fetchTerminalFromLl2Updates(currentId)
    }
    this._settleExpiredLaunch(row)
  },

  /**
   * 任务已有最终结果（或超时兜底）：有最终状态则把卡片落到历史发射头部，然后切下一个任务。
   * 真正的数据库落库由既有 syncSpaceDevsData 定时同步完成，这里是前端乐观先行。
   */
  _settleExpiredLaunch(row) {
    if (this._statusRecheckTimer) {
      clearTimeout(this._statusRecheckTimer)
      this._statusRecheckTimer = null
    }
    this._launchStatusPolling = false

    const ld = this.data.launchData
    const currentId = ld && ld.id != null ? String(ld.id) : ''
    const mission = (this.data.upcomingMissions || []).find((m) => m && String(m.id) === currentId) || null

    if (row && row.status && mission) {
      try {
        this._moveMissionToCompleted(mission, row)
      } catch (e) {
        console.error('[LiveStatus] 落历史发射失败:', e)
      }
    } else if (mission && (!row || !row.status)) {
      // 无终态时仍从即将发射移除，避免过期任务长期挂在 upcoming；历史角标等 recent_settled / 6h 同步修正
      try {
        const midStr = String(mission.id)
        const nextUpcoming = (this.data.upcomingMissions || []).filter((m) => m && String(m.id) !== midStr)
        const patch = { upcomingMissions: nextUpcoming }
        this.applyUpcomingAgencyFilterToPatch(patch)
        this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      } catch (e) {}
    }

    this._switchingCountdown = true
    this.switchToNextUpcomingMission()

    // 列表里没有下一个未过期任务：轻量刷新 upcoming（同一任务只兜底一次）
    const after = this.data.launchData
    if (after && String(after.id != null ? after.id : '') === currentId && this._settleReloadedForId !== currentId) {
      this._settleReloadedForId = currentId
      this._refreshUpcomingAfterSettle().catch(() => {})
    }
  },

  /** settle 后轻量刷新即将发射列表，避免整页 loadInitialData */
  async _refreshUpcomingAfterSettle() {
    try {
      const { res, list } = await this.fetchMissionList('upcoming', 50, 0)
      if (!Array.isArray(list) || !list.length) return
      const first = list[0]
      if (!first) return
      // 若当前面板已切到新任务且仍在列表中，只更新列表不重建面板
      const curId = this.data.launchData && this.data.launchData.id != null
        ? String(this.data.launchData.id)
        : ''
      const stillCurrent = curId && list.some((m) => m && String(m.id) === curId)
      if (stillCurrent) {
        const patch = { ...buildMissionListSetData('upcoming', list, res, filterExpiredMissions) }
        this.applyUpcomingAgencyFilterToPatch(patch)
        this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
        return
      }
      this.applyInitialUpcomingLaunchState(first, list, res)
    } catch (e) {}
  },

  /** 把当前任务卡片转成历史发射形态：从即将发射移除，插入历史发射头部，并同步日历 */
  _moveMissionToCompleted(mission, row) {
    const statusObj = row.status || {}
    const category = getStatusCategory(statusObj)
    const statusZh = getStatusBadgeText(statusObj, category)

    const completedItem = attachMissionDetailMeta({
      ...mission,
      status: statusZh,
      statusId: statusObj.id != null ? Number(statusObj.id) : mission.statusId,
      statusAbbrev: statusObj.abbrev || '',
      statusCategory: category,
      statusBadgeText: statusZh,
      success: category === 'success' || category === 'deployed',
      isPartialFailure: category === 'partial',
      isFailure: category === 'failure' || category === 'partial',
      missionDescription: mission.missionDescription || '',
      isExpired: false
    }, { id: mission.id, detailType: 'completed' })

    const midStr = String(mission.id)
    const nextUpcoming = (this.data.upcomingMissions || []).filter((m) => m && String(m.id) !== midStr)
    const nextCompleted = [completedItem, ...(this.data.completedMissions || []).filter((m) => m && String(m.id) !== midStr)]

    const patch = { upcomingMissions: nextUpcoming, completedMissions: nextCompleted }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch, () => {
      try { this.updateMissionListView('completed', nextCompleted) } catch (e) {}
      try { this.hydrateCalendarFromLoadedMissionLists() } catch (e) {}
      this.scheduleUpcomingAgencyChipsOverflowHint()
    })
  },

  /** NET 已推后：更新当前任务发射时间与列表卡片，倒计时自然恢复 */
  _applyPostponedNet(row) {
    if (this._statusRecheckTimer) {
      clearTimeout(this._statusRecheckTimer)
      this._statusRecheckTimer = null
    }
    this._launchStatusPolling = false
    // 新 T-0 重新计 30 分钟兜底窗口
    this._launchStatusPollLaunchId = ''
    this._launchStatusPollStartAt = 0
    this._lastExpiredRoundAt = 0

    const currentId = String(row.id)
    const missions = (this.data.upcomingMissions || []).slice()
    const idx = missions.findIndex((m) => m && String(m.id) === currentId)

    if (idx >= 0) {
      const mission = { ...missions[idx], launchTime: row.net }
      mission.formattedTime = formatDate(row.net, 'MM月DD日 HH:mm')
      if (row.status && row.status.name) {
        mission.status = getStatusTextZh(row.status)
        mission.statusId = row.status.id != null ? Number(row.status.id) : mission.statusId
        mission.statusAbbrev = row.status.abbrev || mission.statusAbbrev
        mission.statusCategory = getStatusCategory(row.status)
        mission.statusBadgeText = getStatusBadgeText(row.status, mission.statusCategory)
      }
      missions[idx] = mission
      // NET 变化可能影响顺序，按时间重排
      missions.sort((a, b) => new Date((a && a.launchTime) || 0) - new Date((b && b.launchTime) || 0))

      const patch = { upcomingMissions: missions }
      this.applyUpcomingAgencyFilterToPatch(patch)
      this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())

      // 用改期后的任务重建倒计时面板
      this.setData(buildCurrentLaunchPanelState({
        mission,
        formatDate,
        getStatusTextZh,
        subscribedIdSet: this._getPageSubscribedIdSet()
      }))
    } else {
      // 列表中找不到（边缘情况）：直接改面板时间
      const timeParts = formatHomeLaunchTimeParts(row.net, formatDate)
      this.setData({
        'launchData.launchTime': row.net,
        formattedLaunchTime: timeParts.full,
        formattedLaunchDate: timeParts.date,
        formattedLaunchWeekTime: timeParts.weekTime,
        'launchData.statusTextZh': row.status
          ? getStatusTextZh(row.status)
          : '计划中',
        'launchData.statusCategory': row.status ? getStatusCategory(row.status) : 'pending'
      })
    }
    this.updateCountdown()
    // NET 改期后重新计算推迟徽标（loadKey 含 NET，改期后必然重新拉取）
    this.refreshLaunchDelayInfo(currentId, row.net)
  },

  /** 把同一次返回的前 5 行实况（状态 + NET）patch 进即将发射源列表，再一次 filter 同步 displayed */
  _patchUpcomingListLiveStatuses(rows) {
    if (!Array.isArray(rows) || !rows.length) return
    const list = (this.data.upcomingMissions || []).slice()
    if (!list.length) return
    let changed = false

    rows.forEach((row) => {
      if (!row || !row.id || !row.status) return
      const statusObj = row.status
      const category = getStatusCategory(statusObj)
      const badge = getStatusBadgeText(statusObj, category)
      const statusId = statusObj.id != null ? Number(statusObj.id) : null
      const i = list.findIndex((m) => m && String(m.id) === String(row.id))
      if (i < 0) return
      const item = list[i]
      const next = { ...item }
      let rowChanged = false
      if (badge && (item.status !== badge || item.statusBadgeText !== badge || item.statusCategory !== category)) {
        next.status = badge
        next.statusId = statusId
        next.statusAbbrev = statusObj.abbrev || ''
        next.statusCategory = category
        next.statusBadgeText = badge
        rowChanged = true
      }
      if (row.net && item.launchTime !== row.net) {
        next.launchTime = row.net
        next.formattedTime = formatDate(row.net, 'MM月DD日 HH:mm')
        rowChanged = true
      }
      if (rowChanged) {
        list[i] = next
        changed = true
      }
    })

    if (!changed) return
    const patch = { upcomingMissions: list }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch)
  },

  /**
   * 切换任务类型
   */
  switchMissionType(e) {
    const type = e.currentTarget.dataset.type
    if (this.data.missionType === type) return

    this.closeMissionSwipeCells()
    this._resetMissionCardHaptics()
    
    // 标记正在切换标签，暂时禁用滚动位置记录
    this.setData({
      isSwitchingTab: true
    })
    
    // 先保存当前标签的滚动位置（如果scrollTimer还在运行，立即执行保存）
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = null
      const query = wx.createSelectorQuery().in(this)
      query.select('.content-scroll').scrollOffset((res) => {
        if (res) {
          const currentScrollTop = res.scrollTop
          const mt = this.data.missionType
          const scrollField = getMissionScrollTopField(mt)
          this.setData({ [scrollField]: currentScrollTop })
        }
      }).exec()
    }

    const switchState = buildMissionTypeSwitchState(this.data, type)
    const targetScrollTop = switchState.targetScrollTop

    const switchPatch = {
      missionType: switchState.missionType,
      showMissionsEmpty: switchState.showMissionsEmpty,
      showCompactCountdown: switchState.showCompactCountdown,
      _scrollTop: switchState._scrollTop
    }

    // 进入「发射日历」即清除红点；异步加载完成后由 suppress 将 ack 同步为最新快照，避免闪一下又亮起
    if (type === 'calendar') {
      this._calendarDotSuppressNextRefresh = true
      try {
        const sig = computeLaunchCalendarSignature(this.data.calendarAllMissions || [])
        if (sig) storageCache.persistAsync(LAUNCH_CALENDAR_ACK_SIG_KEY, sig)
      } catch (e) {}
      switchPatch.showLaunchCalendarDot = false
    }

    this.setData(switchPatch)

    wx.nextTick(() => {
      setTimeout(() => {
        this.setData({
          _scrollTop: targetScrollTop,
          isSwitchingTab: false
        }, () => {
          if (type !== 'calendar') {
            this._scheduleMissionCardMeasurement(true)
          }
          if (type === 'upcoming') this.scheduleUpcomingAgencyChipsOverflowHint()
        })
      }, 100)
    })

    if (type === 'calendar') {
      this.loadCalendarData(true)
      this.loadLaunchStats()
    } else {
      this.loadMissions()
      // 切到历史发射：强制用 recent_settled 修正「飞行中」等滞后角标
      if (type === 'completed') {
        this._applyRecentSettledToCompletedList(true).catch(() => {})
      }
    }
  },

  /**
   * 监听滚动事件，记录当前滚动位置（使用节流优化性能）
   */
  /**
   * scroll 高频事件入口：保持轻量（只读 detail + 节流标记），
   * 把震动/进度计算/setData 等耗时逻辑放到 _processScrollFrame 里，
   * 通过 leading + trailing 时间片节流合并到 ≤ 20fps 执行一次。
   *
   * 微信「最佳实践」明确建议：scroll/touchmove 等高频事件回调中
   * 不要做耗时操作或频繁 setData。
   */
  onScroll(e) {
    if (this.data.isSwitchingTab) return

    const detail = (e && e.detail) || {}
    // 始终立刻记录最新位置（其它逻辑可读取，不依赖节流帧）
    this._latestMissionListScrollTop = detail.scrollTop || 0
    this._latestMissionListScrollHeight = detail.scrollHeight || 0

    this._scheduleScrollFrame()
  },

  // 滚动节流参数：约等于 20fps，已足以驱动顶部吸顶倒计时与「即将加载」进度
  _SCROLL_THROTTLE_MS: 50,

  _scheduleScrollFrame() {
    const now = Date.now()
    const lastRunAt = this._scrollLastRunAt || 0
    const interval = this._SCROLL_THROTTLE_MS

    // leading：第一次或距上一次执行已经超过节流间隔，立刻执行一次（响应感）
    if (now - lastRunAt >= interval) {
      this._scrollLastRunAt = now
      this._processScrollFrame()
      return
    }

    // trailing：节流期内合并多次 scroll 为一次，由定时器在末尾兜底
    if (this._scrollFrameTimer) return
    const remaining = interval - (now - lastRunAt)
    this._scrollFrameTimer = setTimeout(() => {
      this._scrollFrameTimer = null
      this._scrollLastRunAt = Date.now()
      this._processScrollFrame()
    }, Math.max(0, remaining))
  },

  /**
   * 实际的滚动帧处理：耗时部分集中在这里，调用频率被节流到 ≤ 20fps。
   * 不再依赖原始 event 对象，统一从 this._latestMissionListScrollTop 读取，
   * 避免闭包持有整个 event 导致的内存压力。
   */
  _processScrollFrame() {
    if (this.data.isSwitchingTab) return

    const scrollTop = this._latestMissionListScrollTop || 0
    const scrollHeight = this._latestMissionListScrollHeight || 0

    if (
      this.data.missionType === 'upcoming' &&
      this.data.missionSwipeOpenWxkey &&
      typeof this._missionSwipeOpenedAtScrollTop === 'number' &&
      Math.abs(scrollTop - this._missionSwipeOpenedAtScrollTop) > 14
    ) {
      this.closeMissionSwipeCells()
    }

    this._handleMissionCardScrollHaptics(scrollTop)

    const viewportHeight = this._windowHeight || getSystemInfo().windowHeight || 0
    const triggerZone = this.data.loadMoreTriggerZone || 280
    const hasMore = this.data.missionType === 'upcoming'
      ? this.data.missionsHasMore
      : this.data.completedMissionsHasMore

    const progressState = buildMissionScrollProgressState({
      missionType: this.data.missionType,
      scrollTop,
      scrollHeight,
      viewportHeight,
      triggerZone,
      hasMore,
      missionsLoadingMore: this.data.missionsLoadingMore,
      currentShowCompactCountdown: this.data.showCompactCountdown,
      currentPreloadProgress: this.data.preloadProgress,
      preloadProgressStep: 0.05
    })

    if (progressState.shouldUpdateCompact) {
      this.setData({
        preloadProgress: progressState.preloadProgress,
        showCompactCountdown: progressState.showCompactCountdown
      })
    } else if (progressState.shouldUpdateProgress) {
      this.setData({ preloadProgress: progressState.preloadProgress })
    }

    // 滚动停止后 150ms 才把位置写回 data，避免频繁 setData
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
    }
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = null
      if (this.data.isSwitchingTab) return
      const currentScrollTop = this._latestMissionListScrollTop || 0
      const missionType = this.data.missionType
      const scrollPositionState = buildMissionScrollPositionState(this.data, missionType, currentScrollTop, 10)
      if (scrollPositionState) {
        this.setData(scrollPositionState)
      }
    }, 150)
  },

  scrollToCountdownCard() {
    this.closeMissionSwipeCells()
    this.setData({ _scrollTop: 0.1 })
    wx.nextTick(() => {
      this.setData({ _scrollTop: 0 })
    })
  },

  /**
   * 查看任务详情
   */
  viewMissionDetail(e) {
    this.closeMissionSwipeCells()
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
    const context = this.buildMissionDetailViewContext(dataset)
    if (!context) return

    this.persistMissionDetailListSnapshot(context)

    wx.navigateTo({
      url: context.navigation.url
    })
  },

  /**
   * 规范化助推器信息：避免展示内部ID，并尽量从描述中提取序列号/飞行次数
   */
  normalizeBoosterInfo(boosterInfo, detailSource = {}) {
    if (!boosterInfo || typeof boosterInfo !== 'object') return boosterInfo

    const normalized = { ...boosterInfo }
    const textPool = [
      (normalized.landingDescription || ''),
      (detailSource.missionFull && detailSource.missionFull.description) || detailSource.missionDetails || detailSource.description || '',
      detailSource.missionName || detailSource.name || ''
    ].join(' ')

    const serial = normalized.serialNumber
    const serialText = serial == null ? '' : String(serial).trim()
    // 纯数字序列号通常是内部ID，不给用户展示
    if (!serialText || /^\d+$/.test(serialText)) {
      const serialMatch = textPool.match(/\bB\d{3,5}\b/i)
      normalized.serialNumber = serialMatch ? serialMatch[0].toUpperCase() : null
    }

    const pickValidFlightCount = (val) => {
      const n = Number(val)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    }

    if (normalized.flights == null) {
      const flightCandidates = [
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

      for (const candidate of flightCandidates) {
        const flightCount = pickValidFlightCount(candidate)
        if (flightCount) {
          normalized.flights = flightCount
          break
        }
      }
    }

    if (normalized.flights == null) {
      const flightMatchEn = textPool.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+flight\b/i)
      const flightMatchCn = textPool.match(/第\s*(\d{1,3})\s*次飞行/)
      const flightMatch = flightMatchEn || flightMatchCn
      if (flightMatch) {
        const n = Number(flightMatch[1])
        if (!isNaN(n) && n > 0) normalized.flights = Math.floor(n)
      }
    }

    return normalized
  },

  /**
   * 格式化时间为CST（中国标准时间）
   */
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

  /**
   * 倒计时卡片 — 点击卡片打开详情
   */
  onCountdownCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.viewMissionDetail(e)
  },

  /**
   * 倒计时圆图直播态：拉取视频号状态，驱动红边涟漪 +「直播中」标签
   * @param {{ schedule?: boolean }} options schedule=true 时按开播/未开播间隔续轮询
   */
  refreshCountdownChannelsLive(options = {}) {
    const schedule = !!(options && options.schedule)
    if (this._channelsLiveInfoPromise) {
      return this._channelsLiveInfoPromise.then(() => {
        if (schedule) this._scheduleCountdownChannelsLivePoll()
      })
    }

    this._channelsLiveInfoPromise = loadChannelsLiveModule()
      .then((live) => live.fetchChannelsLiveInfo().then((payload) => payload))
      .then((payload) => {
        const status = payload.status || 0
        const feedId = payload.feedId || ''
        const isLive = Number(status) === 2
        const finder = getLiveFinderUserNameFromConfig()
        const patch = {}
        if (this.data.isChannelsLive !== isLive) patch.isChannelsLive = isLive
        if (this.data.channelsLiveStatus !== status) patch.channelsLiveStatus = status
        if (this.data.channelsLiveFeedId !== feedId) patch.channelsLiveFeedId = feedId
        if (finder && this.data.liveFinderUserName !== finder) patch.liveFinderUserName = finder
        if (!isLive && this.data.channelsLiveAnimPaused) patch.channelsLiveAnimPaused = false
        if (!isLive && this.data.isEnteringLive) patch.isEnteringLive = false
        if (Object.keys(patch).length) this.setData(patch)
      })
      .catch(() => {
        // 探测失败静默：保持未直播态，不打断倒计时
        if (this.data.isChannelsLive || this.data.isEnteringLive) {
          this.setData({
            isChannelsLive: false,
            isEnteringLive: false
          })
        }
      })
      .finally(() => {
        this._channelsLiveInfoPromise = null
        if (schedule) this._scheduleCountdownChannelsLivePoll()
      })

    return this._channelsLiveInfoPromise
  },

  _scheduleCountdownChannelsLivePoll() {
    this._clearCountdownChannelsLivePoll()
    const delay = this.data.isChannelsLive ? CHANNELS_LIVE_POLL_LIVE_MS : CHANNELS_LIVE_POLL_IDLE_MS
    this._channelsLivePollTimer = setTimeout(() => {
      this._channelsLivePollTimer = null
      this.refreshCountdownChannelsLive({ schedule: true })
    }, delay)
  },

  _clearCountdownChannelsLivePoll() {
    if (this._channelsLivePollTimer) {
      clearTimeout(this._channelsLivePollTimer)
      this._channelsLivePollTimer = null
    }
  },

  _clearCountdownLiveEnterTimer() {
    if (this._channelsLiveEnterTimer) {
      clearTimeout(this._channelsLiveEnterTimer)
      this._channelsLiveEnterTimer = null
    }
  },

  _resetCountdownLiveEnterState() {
    this._clearCountdownLiveEnterTimer()
    this._openingCountdownLive = false
    if (this.data.isEnteringLive) {
      this.setData({ isEnteringLive: false })
    }
  },

  /**
   * 点击圆图/直播标签：
   * 直播中 → 先播压缩放过渡，再 openChannelsLive；
   * 未直播 → 进任务详情。
   */
  onCountdownLiveAvatarTap() {
    if (!this.data.isChannelsLive) {
      const id = this.data.launchData && this.data.launchData.id
      if (!id) return
      this.viewMissionDetail({ currentTarget: { dataset: { id } } })
      return
    }
    if (this._openingCountdownLive || this.data.isEnteringLive) return

    this._openingCountdownLive = true
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    this.setData({ isEnteringLive: true })

    const self = this
    this._clearCountdownLiveEnterTimer()
    this._channelsLiveEnterTimer = setTimeout(() => {
      self._channelsLiveEnterTimer = null
      self._openCountdownChannelsLive()
    }, CHANNELS_LIVE_ENTER_MS)
  },

  /**
   * 过渡动画结束后打开视频号直播间；取消/失败时复位进入态。
   */
  _openCountdownChannelsLive() {
    const self = this
    const finish = () => {
      self._openingCountdownLive = false
      if (self.data.isEnteringLive) {
        self.setData({ isEnteringLive: false })
      }
    }

    const openWithPayload = (feedId, finderUserName) => {
      if (!feedId) {
        wx.showToast({ title: '暂无直播信息', icon: 'none' })
        finish()
        return
      }
      loadChannelsLiveModule()
        .then((live) => live.openChannelsLive({
          finderUserName: finderUserName || self.data.liveFinderUserName,
          feedId
        }))
        .then(() => {
          // 成功调起后稍后再清，避免确认框弹出瞬间圆图弹回
          setTimeout(finish, 400)
        })
        .catch(() => {
          finish()
        })
    }

    if (this.data.channelsLiveFeedId) {
      openWithPayload(this.data.channelsLiveFeedId, this.data.liveFinderUserName)
      return
    }

    this.refreshCountdownChannelsLive()
      .then(() => {
        openWithPayload(self.data.channelsLiveFeedId, self.data.liveFinderUserName)
      })
      .catch(() => {
        finish()
      })
  },

  /**
   * 倒计时卡片 — 助推器行「详情」按钮：按序列号（如 B1090）跳该箭实体详情页
   */
  async onGoBoosterDetail() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const launch = this.data.launchData || {}
    const serial = String((launch.boosterInfo && launch.boosterInfo.serialNumber) || '').trim()
    if (!serial || serial === '未披露') {
      wx.showToast({ title: '暂无该助推器档案', icon: 'none' })
      return
    }
    const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    navigateTo(ROUTES.BOOSTER_DETAIL, { serial: serial })
  },

  /**
   * 倒计时卡片 — 发射商行「详情」按钮：跳发射商详情页（id 优先，缺失时用缩写解析）
   */
  async onGoAgencyDetail() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const launch = this.data.launchData || {}
    const id = launch.launchAgencyId
    const abbrev = launch.launchAgencyAbbrev || ''
    if (id == null && !abbrev) return
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    const params = {}
    if (id != null) params.id = id
    else params.abbrev = abbrev
    navigateTo(ROUTES.AGENCY_DETAIL, params)
  },

  /**
   * 倒计时卡片 — 提醒按钮：未开则开启，已开则关闭（切换）
   */
  async onCountdownRemind() {
    if (this._subscribeReminderBusy) return
    const launch = this.data.launchData
    if (!launch || !launch.id) return
    this._vibrateMedium()
    this._subscribeReminderBusy = true
    try {
      const on = this.data._countdownSubscribed || isSubscribed(launch.id)
      if (on) {
        await this.unsubscribeReminderForMission(launch.id)
      } else {
        await this.subscribeReminderForMission(launch)
      }
    } finally {
      this._subscribeReminderBusy = false
    }
  },

  openAISearch() {
    this.closeMissionSwipeCells()
    wx.navigateTo({
      url: ROUTES.SEARCH,
      fail: () => {
        wx.showToast({ title: '打开搜索失败', icon: 'none' })
      }
    })
  },

  openShop() {
    wx.showToast({ title: '筹备中，敬请期待', icon: 'none' })
  },
  preventMove() {},
  stopPropagation() {},

  /**
   * 图片加载错误处理
   * 如果特殊匹配的图片加载失败，会重新执行模糊匹配
   */
  // 卡片图加载失败时的重试逻辑：
  //   1) 第一次构造的 URL 经常因为 cloud media map 还没加载完而是"假 URL"
  //      （例如 Long March 7.webp 文件 COS 上其实不存在，真正的文件叫 Long March 7A.jpg）
  //   2) 这里 await loadCloudMediaMap()，等清单到位后再做 fuzzy 匹配，
  //      避免因为时序问题永远拿不到真实文件 URL

  async onImageError(e) {
    const index = e.currentTarget.dataset.index
    const missionType = this.data.missionType
    const isCalendar = missionType === 'calendar'
    const listKey = missionType === 'upcoming'
      ? 'upcomingMissions'
      : (isCalendar ? 'calendarAllMissions' : 'completedMissions')
    const missions = isCalendar
      ? (this.data.expandedDateMissions || [])
      : (missionType === 'upcoming'
        ? (this.data.displayedUpcomingMissions || [])
        : (this.data.completedMissions || []))

    if (!missions || !missions[index]) return
    const mission = missions[index]
    const failedImage = mission.rocketImage
    const rocketName = mission.rocketName

    if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
      markDownloadFailed(String(failedImage).trim(), 404)
    }

    const fallbackDefault = resolveMissionRocketImage(
      DEFAULT_ROCKET_IMAGE,
      rocketName,
      mission.rocketConfiguration
    )
    const applyImage = (nextImage) => {
      if (isCalendar) {
        this._patchCalendarMissionRocketImage(mission.id, nextImage)
        return
      }
      const currentList = this.data[listKey]
      if (!Array.isArray(currentList)) return
      const idx = currentList.findIndex((m) => m && String(m.id) === String(mission.id))
      if (idx < 0) return
      currentList[idx].rocketImage = nextImage
      this.setData({ [listKey]: currentList })
      // 即将发射卡片实际渲染自 displayedUpcomingMissions（筛选后列表），必须同步补图，
      // 否则加载失败的配置图永远停留在破图状态
      if (missionType === 'upcoming') {
        const disp = this.data.displayedUpcomingMissions || []
        const dIdx = disp.findIndex((m) => m && String(m.id) === String(mission.id))
        if (dIdx >= 0 && disp[dIdx].rocketImage !== nextImage) {
          this.setData({ [`displayedUpcomingMissions[${dIdx}].rocketImage`]: nextImage })
        }
      }
      this.syncLaunchDataRocketImageFromListByMissionId(mission.id, nextImage)
    }

    // 等云端文件清单加载完成（已加载会立刻 resolve；并发请求会被去重）
    try {
      await loadCloudMediaMap()
    } catch (err) {}

    // 即使当前已是 default，也强制重算：default 能加载成功不会触发 error，但 map 晚到时需主动升级
    const fuzzyMatchImage = resolveMissionRocketImage(
      failedImage,
      rocketName,
      mission.rocketConfiguration,
      true
    )

    if (fuzzyMatchImage && fuzzyMatchImage !== failedImage) {
      applyImage(fuzzyMatchImage)
      return
    }

    if (!rocketName || isDefaultRocketSrc(failedImage)) {
      applyImage(fallbackDefault)
      return
    }

    applyImage(fallbackDefault)
  },

  /**
   * 轮播图加载错误处理
   */
  // ========== 轮播图/视频控制逻辑 ==========

  /** 启动轮播自动翻页定时器 */
  _startCarouselTimer() {
    this._stopCarouselTimer()
    const items = this.data.carouselItems
    if (!items || items.length <= 1) return
    const current = this.data.carouselCurrent || 0
    const isVideo = items[current] && items[current].type === 'video'
    const delay = isVideo
      ? (this.data.carouselVideoDuration || 5000)
      : (this.data.carouselImageDuration || 5000)
    this._carouselTimer = setTimeout(() => {
      const next = ((this.data.carouselCurrent || 0) + 1) % items.length
      this.setData({ carouselCurrent: next })
    }, delay)
  },

  /** 停止轮播定时器 */
  _stopCarouselTimer() {
    if (this._carouselTimer) {
      clearTimeout(this._carouselTimer)
      this._carouselTimer = null
    }
  },

  /** 停止当前视频播放 */
  _stopCarouselVideo(index) {
    if (index == null) return
    const ctx = wx.createVideoContext(`carousel-video-${index}`, this)
    if (ctx) {
      try { ctx.pause(); ctx.seek(0) } catch (e) {}
    }
  },

  /**
   * 轮播视频自动播放门控（流量成本控制）：
   * - 会员功能未开启：所有人保持自动播放（现状）
   * - 会员功能开启：仅会员自动播放；非会员只显示封面，点击先门控再播（不预加载）
   * 结果缓存在 this._carouselAutoplayAllowed，onLoad/onShow 异步刷新
   */
  _updateCarouselAutoplayGate() {
    Promise.all([isMembershipEnabled(), getMemberPolicy()])
      .then(([enabled, policy]) => {
        // 会员关 / Pro：可自动播；非会员需策略允许且未强制封面
        let allowed = !enabled || isProSync()
        if (enabled && !isProSync()) {
          allowed = !!policy.carouselAllowVideoForNonMember && !policy.forceNonMemberVideoPoster
        }
        if (this._carouselAutoplayAllowed !== allowed) {
          this._carouselAutoplayAllowed = allowed
          this._activateCarouselVideos(this.data.carouselCurrent || 0)
        }
      })
      .catch(() => {})
  },

  _isCarouselAutoplayAllowed() {
    // 默认 false：门控异步返回前不激活 src，避免非会员短暂拉到视频流
    return this._carouselAutoplayAllowed === true
  },

  /**
   * 非会员任务列表翻页深度门控：
   * - 会员功能未开启 / Pro / 广告解锁期内：不限制（missionGateLimit = 0）
   * - 其余：即将发射与历史发射列表各只展示前 FREE_MISSION_LIST_LIMIT 条，
   *   底部出现解锁横幅，继续上拉触发开通引导（gateCheck 弹窗）
   */
  _updateMissionListGate() {
    Promise.all([isMembershipEnabled(), getMemberPolicy()])
      .then(([enabled, policy]) => {
        let limit = 0
        if (enabled && !isProSync() && policy.enableMissionListGate) {
          limit = policy.freeMissionListLimit || FREE_MISSION_LIST_LIMIT
          try {
            const adUnlock = require('../../utils/ad-unlock.js')
            if (adUnlock.isUnlocked('mission_list_full')) limit = 0
          } catch (e) {}
        }
        if (this.data.missionGateLimit !== limit) {
          this.setData({ missionGateLimit: limit })
        }
      })
      .catch(() => {})
  },

  /** 解锁横幅点击 / 触底自动引导共用入口 */
  async onMissionGateTap() {
    const allowed = await gateCheck('mission_list_full', '完整发射任务列表')
    if (!allowed) return
    // Pro 购买回来 / 广告解锁成功：立即放开
    this.setData({ missionGateLimit: 0 })
  },

  /**
   * 仅激活当前视频的 src，避免多路大视频同时缓冲导致黑屏与预取流量浪费。
   * 非激活项清空 src，封面继续展示 poster。
   * 非会员（门控开启时）不激活任何视频，点击封面走全屏按需播放。
   */
  _activateCarouselVideos(current) {
    const items = this.data.carouselItems || []
    if (!items.length) return
    const n = items.length
    const cur = Math.max(0, Math.min(Number(current) || 0, n - 1))
    const autoplayAllowed = this._isCarouselAutoplayAllowed()
    const want = new Set(autoplayAllowed ? [cur] : [])

    const updates = {}
    for (let i = 0; i < n; i++) {
      if (!items[i] || items[i].type !== 'video') continue
      const active = want.has(i)
      if (!!items[i].videoActive !== active) {
        updates[`carouselItems[${i}].videoActive`] = active
      }
      if (!active && items[i].videoStarted) {
        updates[`carouselItems[${i}].videoStarted`] = false
      }
    }

    const play = () => {
      // 等 video 绑定新 src 后再 play，减少空 src 调用
      setTimeout(() => this._playCurrentVideoIfNeeded(), 80)
    }
    if (Object.keys(updates).length) {
      this.setData(updates, play)
    } else {
      play()
    }
  },

  /** 如果当前项是视频，静音自动播放 */
  _playCurrentVideoIfNeeded() {
    if (!this._isCarouselAutoplayAllowed()) return
    const items = this.data.carouselItems
    const current = this.data.carouselCurrent || 0
    if (!items || !items[current] || items[current].type !== 'video') return
    if (!items[current].videoActive) return
    const ctx = wx.createVideoContext(`carousel-video-${current}`, this)
    if (ctx) {
      try { ctx.play() } catch (e) {}
    }
  },

  /** swiper 切换回调 */
  onCarouselChange(e) {
    const current = e.detail.current
    const prev = this.data.carouselCurrent
    const items = this.data.carouselItems
    if (items && items[prev] && items[prev].type === 'video') {
      this._stopCarouselVideo(prev)
    }
    this.setData({ carouselCurrent: current })
    this._activateCarouselVideos(current)
    this._startCarouselTimer()
  },

  /** 真正出帧后再撤封面（play 事件过早，会露出原生黑底） */
  onCarouselVideoTimeUpdate(e) {
    const index = Number(e.currentTarget.dataset.index)
    const items = this.data.carouselItems
    if (isNaN(index) || !items || !items[index] || items[index].videoStarted) return
    const t = Number(e.detail && e.detail.currentTime) || 0
    if (t < 0.08) return
    this.setData({ [`carouselItems[${index}].videoStarted`]: true })
  },

  /** 视频加载失败（死链/格式不支持）→ 从轮播中移除，避免永久黑屏 */
  onCarouselVideoError(e) {
    // 预览版失败时不再回退原片：原片可达数十 MB，一次回退就会打穿流量预算；
    // 直接走图片错误路径，只保留 poster 封面
    this.onCarouselImageError(e)
  },

  /** 点击视频描述文字 → 跳转事件详情 */
  onCarouselCaptionTap(e) {
    const eventId = (e.currentTarget.dataset || {}).eventid
    if (!eventId) return
    this._stopCarouselTimer()
    navigateTo(ROUTES.EVENT_DETAIL, { id: eventId })
  },

  /** 点击视频 → 非会员先门控；通过后全屏播放（不预加载，按需缓存） */
  async onCarouselVideoTap(e) {
    const dataset = e.currentTarget.dataset || {}
    const index = dataset.index
    const item = (this.data.carouselItems || [])[index]
    if (!item || item.type !== 'video') return

    this._stopCarouselTimer()
    this._stopCarouselVideo(index)

    const playbackOk = await isPlaybackAllowed().catch(() => false)
    if (!playbackOk) {
      this._startCarouselTimer()
      return
    }

    const eventId = item.eventId
    const raw = item.playSrc
      || (this._carouselLazyPlayUrls && this._carouselLazyPlayUrls[index])
      || item.src
      || dataset.url

    // 非会员且强制封面：点击触发门控，通过前不拉流；一次广告只解锁当前这条视频
    if (!canPrefetchVideoSync()) {
      const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 视频播放', {
        adUnlockId: eventVideoAdUnlockId(eventId, 0, raw)
      })
      if (!allowed) {
        this._startCarouselTimer()
        return
      }
    }

    if (eventId) {
      navigateTo(ROUTES.EVENT_DETAIL, { id: eventId, autoPlayVideo: 0 })
      return
    }

    if (!raw) {
      this._startCarouselTimer()
      return
    }
    // 统一走自研播放页：长按菜单在页内做会员门控（原生 previewMedia 的 showmenu 无法按会员身份门控）
    // raw 可能是本地缓存路径（会员预热），复制链接需用远端地址
    const remote = /^https?:\/\//i.test(raw)
      ? raw
      : ((this._carouselLazyPlayUrls && this._carouselLazyPlayUrls[index]) || '')
    const playRemote = remote || raw
    await playEventVideo({
      url: playRemote,
      playUrl: getCachedVideo(playRemote),
      thumb: item.poster || '',
      canSave: canUsePaidCloudSync(),
      onSaveHint: () => {}
    })
    this._startCarouselTimer()
  },

  onCarouselImageLoad() {},

  onCarouselImageError(e) {
    if (this.data.carouselLoadFailed) return

    const index = Number(e.currentTarget.dataset.index)
    const items = [...this.data.carouselItems]

    // 移除加载失败的项
    if (index >= 0 && index < items.length) {
      items.splice(index, 1)

      if (items.length === 0) {
        this._stopCarouselTimer()
        this.setData({
          carouselItems: [],
          carouselImages: [],
          carouselLoadFailed: true
        })
        return
      }

      // 移除后当前索引可能越界：收敛回首项，并重启定时器/视频播放，避免停在空白帧
      const patch = {
        carouselItems: items,
        carouselImages: items.map(i => i.src)
      }
      if ((this.data.carouselCurrent || 0) >= items.length) {
        patch.carouselCurrent = 0
      }
      this.setData(patch, () => {
        this._activateCarouselVideos(this.data.carouselCurrent || 0)
        this._startCarouselTimer()
      })
    }
  },

  /**
   * 预览轮播图（点击直接预览）/ 视频由 onCarouselVideoTap 处理
   */
  previewCarouselImage(e) {
    const current = e.currentTarget.dataset.url
    // 只预览图片项
    const imageUrls = (this.data.carouselItems || [])
      .filter(i => i.type === 'image')
      .map(i => i.src)
    if (!imageUrls.length) return
    
    wx.previewImage({
      current: current,
      urls: imageUrls,
      success: () => {
      },
      fail: (err) => {
        wx.showToast({
          title: '预览失败',
          icon: 'none'
        })
      }
    })
  },

  /**
   * 长按保存轮播图
   */
  saveCarouselImage(e) {
    const imageUrl = e.currentTarget.dataset.url
    
    // 显示保存确认菜单
    wx.showActionSheet({
      itemList: ['保存图片'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 保存图片
          this.saveImageToAlbum(imageUrl)
        }
      },
      fail: () => {
        // 用户取消操作，不做任何处理
      }
    })
  },

  /**
   * 保存图片到相册
   */
  saveImageToAlbum(imageUrl) {
    wx.showLoading({
      title: '保存中...',
      mask: true
    })
    
    // 处理本地路径和网络路径
    if (imageUrl.startsWith('/')) {
      // 本地路径：先尝试直接保存，如果失败则转换为临时文件
      const fs = wx.getFileSystemManager()
      
      // 先尝试直接保存（某些版本可能支持）
      wx.saveImageToPhotosAlbum({
        filePath: imageUrl,
        success: () => {
          wx.hideLoading()
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          })
        },
        fail: (err) => {
          // 如果直接保存失败，尝试通过临时文件保存
          if (err.errMsg && err.errMsg.includes('file not exist')) {
            // 文件不存在
            wx.hideLoading()
            wx.showToast({
              title: '图片不存在',
              icon: 'none'
            })
          } else if (err.errMsg && (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize'))) {
            // 权限问题
            wx.hideLoading()
            this.handleSaveImageError(err, imageUrl)
          } else {
            // 其他错误，提示用户使用预览方式保存
            wx.hideLoading()
            wx.showModal({
              title: '提示',
              content: '本地图片保存需要先预览，请在预览图片时长按保存到相册',
              confirmText: '去预览',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  // 打开预览
                  wx.previewImage({
                    current: imageUrl,
                    urls: this.data.carouselImages,
                    success: () => {
                      wx.showToast({
                        title: '长按图片可保存',
                        icon: 'none',
                        duration: 2000
                      })
                    }
                  })
                }
              }
            })
          }
        }
      })
    } else {
      // 网络路径，需要先下载
      pooledDownloadFile({ url: toCdnUrl(imageUrl) })
        .then((res) => {
          if (res.statusCode === 200) {
            // 保存图片到相册
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.hideLoading()
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                })
              },
              fail: (err) => {
                wx.hideLoading()
                this.handleSaveImageError(err, imageUrl)
              }
            })
          } else {
            wx.hideLoading()
            wx.showToast({
              title: '下载失败',
              icon: 'none'
            })
          }
        })
        .catch((err) => {
          wx.hideLoading()
          wx.showToast({
            title: '下载失败',
            icon: 'none'
          })
        })
    }
  },

  /**
   * 处理保存图片错误
   */
  handleSaveImageError(err, imageUrl) {
    // 处理用户拒绝授权的情况
    if (err.errMsg && (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize') || err.errMsg.includes('permission'))) {
      wx.showModal({
        title: '需要授权',
        content: '需要您授权保存图片到相册',
        confirmText: '去设置',
        cancelText: '取消',
        success: (modalRes) => {
          if (modalRes.confirm) {
            wx.openSetting({
              success: (settingRes) => {
                if (settingRes.authSetting['scope.writePhotosAlbum']) {
                  // 用户授权后，重新保存
                  this.saveImageToAlbum(imageUrl)
                } else {
                  wx.showToast({
                    title: '需要授权才能保存',
                    icon: 'none'
                  })
                }
              }
            })
          }
        }
      })
    } else {
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  },

  /**
   * 分享任务
   */
  async shareMission() {
    try {
      // TODO: 调用分享API
      await shareMission(this.data.launchData)
      
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    } catch (error) {
      wx.showToast({
        title: '分享失败',
        icon: 'none'
      })
    }
  },

  /**
   * 原生三点下拉刷新（页面级 / scroll-view refresher 共用）
   * 即将发射重拉首屏；历史发射强制 merge recent_settled 修正角标
   */
  onScrollRefresh() {
    this._runMissionPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runMissionPullRefresh()
  },

  _runMissionPullRefresh(key) {
    if (this.data.missionType === 'completed') {
      runPullRefresh(this, async () => {
        try {
          const pack = await this.fetchMissionList('completed', 50, 0)
          this.handleCompletedMissionLoadSuccess(pack.list || [], pack.res || {})
        } catch (e) {
          await this._applyRecentSettledToCompletedList(true)
        }
      }, key)
      return
    }
    if (this.data.missionType !== 'upcoming') {
      if (key) {
        this.setData({ [key]: false })
      } else {
        try { wx.stopPullDownRefresh() } catch (e) {}
      }
      return
    }
    runPullRefresh(this, () => this.loadInitialData({ suppressLoading: true }), key)
  },

  onHide() {
    this.stopCountdown()
    this._resetMissionCardHaptics()
    this._stopCarouselTimer()
    try {
      this._stopCarouselVideo(this.data.carouselCurrent || 0)
    } catch (e) {}
    if (this._missionSwipeDragTimer) {
      clearTimeout(this._missionSwipeDragTimer)
      this._missionSwipeDragTimer = null
    }
    if (this._missionCardMeasureTimer) {
      clearTimeout(this._missionCardMeasureTimer)
      this._missionCardMeasureTimer = null
    }
    if (this._voteDeferTimer) {
      clearTimeout(this._voteDeferTimer)
      this._voteDeferTimer = null
    }
    if (this._renewalCheckTimer) {
      clearTimeout(this._renewalCheckTimer)
      this._renewalCheckTimer = null
    }
    if (this._voteRecheckTimer) {
      clearTimeout(this._voteRecheckTimer)
      this._voteRecheckTimer = null
    }
    // 开屏倒计时：切 Tab/后台时停表（onShow 若开屏仍可见会重启，避免后台空跑）
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
      this._splashTimerPaused = true
    }
    // 停直播动效 + 停视频号轮询（onShow 会恢复）
    if (this.data.isChannelsLive && !this.data.channelsLiveAnimPaused) {
      this.setData({ channelsLiveAnimPaused: true })
    }
    this._resetCountdownLiveEnterState()
    this._clearCountdownChannelsLivePoll()
    // 切后台保留状态复查定时器（5 分钟节拍不丢），只放开 polling 锁便于回前台 tick 重入
    this._launchStatusPolling = false
    this._lastExpiredRoundAt = 0
  },

  /** 清掉实时状态确认的复查定时器（页面卸载时调用）；onHide 不调此函数以免丢复查节奏 */
  _clearLiveStatusPolling() {
    if (this._statusRecheckTimer) {
      clearTimeout(this._statusRecheckTimer)
      this._statusRecheckTimer = null
    }
    this._launchStatusPolling = false
    this._lastExpiredRoundAt = 0
  },

  /** 演示模式（远程控制 overlay） */
  _initDemoMode() {
    const app = getApp && getApp()
    if (!app) return
    if (this._demoInited) return
    this._demoInited = true

    const tryInit = (retries) => {
      const { isLiveAccount: isLive, isInitDone } = require('../../utils/demo-engine.js')

      if (!isInitDone()) {
        if (retries > 0) {
          setTimeout(() => tryInit(retries - 1), 2000)
        }
        return
      }

      const live = isLive()

      if (live) {
        this.setData({ _isDemoLiveAccount: true })
        const overlay = this.selectComponent('#demoOverlay')
        if (overlay) {
          overlay.startRemoteControl()
        } else {
          console.warn('[Index] DemoMode overlay component not found')
        }
      }
    }

    // 演示引擎在 app.js 里 3s 后初始化，这里 5s 后开始检查，最多重试 5 次
    setTimeout(() => tryInit(5), 5000)
  },

  onDemoRemoteStart(e) {
    const scriptName = (e.detail && e.detail.scriptName) || 'fullTour'
    startDemo(this, scriptName)
  },

  onDemoStop() {
    // 演示结束，可以做一些清理
  },

  async loadSplashScreen() {
    try {
      // 用内存变量控制：冷启动时显示，切后台回来不重复显示
      const app = getApp()
      if (app._splashShownThisSession) return
      app._splashShownThisSession = true

      const normalizeItems = (cfg) => {
        if (!cfg) return []
        if (Array.isArray(cfg.mediaItems) && cfg.mediaItems.length) {
          return cfg.mediaItems.filter((it) => it && it.mediaUrl).map((it) => {
            // 与原逻辑一致：显式 mediaType 优先，缺省时按扩展名推断
            const itemType = it.mediaType || (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(it.mediaUrl) ? 'video' : 'image')
            const isVideoItem = itemType === 'video'
            return {
              id: String(it.id || it.mediaUrl || ''),
              mediaType: itemType,
              // 图片开屏全屏展示：medium 压缩（960w WebP），原图动辄数 MB
              mediaUrl: isVideoItem ? toCdnUrl(it.mediaUrl) : optimizeImageUrl(it.mediaUrl, 'medium'),
              previewUrl: it.previewUrl ? toCdnUrl(String(it.previewUrl).trim()) : '',
              posterUrl: it.posterUrl
                ? optimizeImageUrl(String(it.posterUrl).trim(), 'medium')
                : (isVideoItem ? carouselVideoPosterUrl(it.mediaUrl, '') : '')
            }
          })
        }
        // 旧单字段：仅作兜底，不算完整媒体池
        if (cfg.mediaUrl) {
          const isVideoCfg = cfg.mediaType === 'video'
          return [{
            id: String(cfg.mediaUrl),
            mediaType: cfg.mediaType || 'image',
            mediaUrl: isVideoCfg ? toCdnUrl(cfg.mediaUrl) : optimizeImageUrl(cfg.mediaUrl, 'medium'),
            previewUrl: cfg.previewUrl ? toCdnUrl(String(cfg.previewUrl).trim()) : '',
            posterUrl: cfg.posterUrl
              ? optimizeImageUrl(String(cfg.posterUrl).trim(), 'medium')
              : (isVideoCfg ? carouselVideoPosterUrl(cfg.mediaUrl, '') : '')
          }]
        }
        return []
      }

      const resolvePlay = (item) => {
        if (!item) return null
        const playUrl = item.previewUrl || item.mediaUrl
        return {
          id: item.id || '',
          mediaType: item.mediaType || 'image',
          mediaUrl: playUrl,
          posterUrl: item.posterUrl || '',
          originalUrl: item.mediaUrl,
          playUrl
        }
      }

      // 池子 ≥2 时：尽量不连续重复上一次，保证多轮测试能看到不同视频
      const pickSplashItem = (list, lastId) => {
        const arr = Array.isArray(list) ? list.filter((it) => it && it.mediaUrl) : []
        if (!arr.length) return null
        if (arr.length === 1) return arr[0]
        let pool = arr
        if (lastId) {
          const others = arr.filter((it) => String(it.id) !== String(lastId))
          if (others.length) pool = others
        }
        return pool[Math.floor(Math.random() * pool.length)]
      }

      let cached = null
      try { cached = wx.getStorageSync(SPLASH_CACHE_KEY) || null } catch (e) {}
      const cachedItems = normalizeItems(cached)
      // 只有显式 mediaItems 数组才视为「完整池」；旧单条缓存不能挡住云端多视频
      const cacheHasPool = !!(cached && cached.enabled && Array.isArray(cached.mediaItems) && cached.mediaItems.length > 0)
      const lastSplashId = (cached && cached.lastSplashId) ? String(cached.lastSplashId) : ''

      // ── 并行拉云端；有完整本地池则短等，否则多等一会再展示 ──
      let cfg = null
      if (wx.cloud && wx.cloud.database) {
        const waitMs = cacheHasPool ? 600 : 2500
        try {
          const db = wx.cloud.database()
          const res = await Promise.race([
            db.collection('starship_splash_config').doc('current').get(),
            new Promise((resolve) => setTimeout(() => resolve(null), waitMs))
          ])
          cfg = res && res.data ? res.data : null
        } catch (e) {
          cfg = null
        }
        // 短等未返回时，若本地没有完整池，再补一次较长等待
        if (!cfg && !cacheHasPool) {
          try {
            const db = wx.cloud.database()
            const res = await Promise.race([
              db.collection('starship_splash_config').doc('current').get(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000))
            ])
            cfg = res && res.data ? res.data : null
          } catch (e) {}
        }
      }

      const cloudItems = normalizeItems(cfg)
      // 优先云端完整池，其次本地池，最后旧单条
      let pool = []
      if (cloudItems.length > 1 || (cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length)) {
        pool = cloudItems
      } else if (cacheHasPool) {
        pool = cachedItems
      } else {
        pool = cloudItems.length ? cloudItems : cachedItems
      }

      // 开关：云端优先；无云端时看本地缓存
      if (cfg) {
        if (cfg.enabled === false) {
          try { wx.setStorageSync(SPLASH_CACHE_KEY, { enabled: false }) } catch (e) {}
          return
        }
      } else if (cached && cached.enabled === false) {
        return
      }

      if (!pool.length) return

      const picked = pickSplashItem(pool, lastSplashId)
      const resolved = resolvePlay(picked)
      if (!resolved) return

      // 流量门控：非会员默认降级封面；可由 splashAllowVideoForNonMember / 流量档远程调节
      let splashVideoAllowed = true
      if (resolved.mediaType === 'video') {
        try {
          const memberEnabled = await isMembershipEnabled()
          const policy = await getMemberPolicy()
          splashVideoAllowed = !memberEnabled || isProSync()
            || (policy.splashAllowVideoForNonMember && !policy.forceNonMemberVideoPoster)
        } catch (e) {}
        if (!splashVideoAllowed) {
          if (!resolved.posterUrl) return
          resolved.mediaType = 'image'
          resolved.playUrl = resolved.posterUrl
          resolved.mediaUrl = resolved.posterUrl
        }
      }

      const localMap = (cached && cached.localPaths && typeof cached.localPaths === 'object')
        ? cached.localPaths
        : {}
      let src = localMap[resolved.playUrl] || ''
      if (src) {
        try { wx.getFileSystemManager().accessSync(src) } catch (e) { src = '' }
      }

      const countdown = (cfg && cfg.countdownSeconds) || (cached && cached.countdownSeconds) || 5
      this._showSplash({
        mediaType: resolved.mediaType,
        mediaUrl: src || resolved.playUrl,
        posterUrl: resolved.posterUrl,
        originalUrl: resolved.originalUrl,
        countdown
      })

      // 后台刷新完整配置与本地预下载（不改变本次已展示内容）
      const finalItems = cloudItems.length ? cloudItems : pool
      this._cacheSplashMedia({
        enabled: true,
        countdownSeconds: countdown,
        mediaItems: finalItems,
        lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
        mediaType: resolved.mediaType,
        mediaUrl: resolved.originalUrl,
        originalUrl: resolved.originalUrl,
        playUrl: resolved.playUrl,
        previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
        posterUrl: resolved.posterUrl
      }, cached, { skipMediaDownload: !splashVideoAllowed })

      // 若刚才短等没拿到云端，后台再拉一次补全缓存池
      if (!cloudItems.length && wx.cloud && wx.cloud.database) {
        try {
          const db = wx.cloud.database()
          const late = await db.collection('starship_splash_config').doc('current').get()
          const lateCfg = late && late.data ? late.data : null
          const lateItems = normalizeItems(lateCfg)
          if (lateCfg && lateCfg.enabled !== false && lateItems.length) {
            this._cacheSplashMedia({
              enabled: true,
              countdownSeconds: lateCfg.countdownSeconds || countdown,
              mediaItems: lateItems,
              lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
              mediaType: resolved.mediaType,
              mediaUrl: resolved.originalUrl,
              originalUrl: resolved.originalUrl,
              playUrl: resolved.playUrl,
              previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
              posterUrl: resolved.posterUrl
            }, wx.getStorageSync(SPLASH_CACHE_KEY) || cached, { skipMediaDownload: !splashVideoAllowed })
          }
        } catch (e) {}
      }
    } catch (e) {
      // 静默失败，不影响主页加载
    }
  },

  _showSplash(opts) {
    if (this.data.splashVisible) return
    const mediaType = opts.mediaType || 'image'
    const mediaUrl = opts.mediaUrl || ''
    const posterUrl = opts.posterUrl || ''
    const originalUrl = opts.originalUrl || mediaUrl
    const countdown = opts.countdown || 5
    // 开屏期间让隐私禁触遮罩让位（遮罩在 root-portal 根层级，会压住开屏层吞掉「跳过」点击）；
    // 开屏自身全屏遮挡 + TabBar 守卫仍读 privacyGateActive，门控不失效
    const app = getApp()
    if (app && typeof app.setSplashActive === 'function') app.setSplashActive(true)
    this.setData({
      splashVisible: true,
      splashVideoReady: mediaType !== 'video',
      splashConfig: {
        mediaType,
        mediaUrl,
        posterUrl,
        originalUrl
      },
      splashCountdown: countdown
    })

    this._startSplashTick(mediaType)
  },

  /** 启动开屏倒计时 interval（onHide 停表后由 _resumeSplashTimer 复用） */
  _startSplashTick(mediaType) {
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    if (mediaType === 'image') {
      this._splashTimer = setInterval(() => {
        const next = this.data.splashCountdown - 1
        if (next <= 0) {
          this.closeSplash()
        } else {
          this.setData({ splashCountdown: next })
        }
      }, 1000)
    } else {
      this._splashTimer = setInterval(() => {
        const next = this.data.splashCountdown - 1
        if (next <= 0) {
          clearInterval(this._splashTimer)
          this._splashTimer = null
          this.setData({ splashCountdown: 0 })
        } else {
          this.setData({ splashCountdown: next })
        }
      }, 1000)
    }
  },

  _resumeSplashTimer() {
    const cfg = this.data.splashConfig || {}
    // 视频分支倒计时到 0 后 timer 已自清，剩余秒数 > 0 才需要续跑
    if (this.data.splashCountdown > 0) {
      this._startSplashTick(cfg.mediaType || 'image')
    }
  },

  onSplashVideoTimeUpdate(e) {
    if (this.data.splashVideoReady) return
    const t = Number(e.detail && e.detail.currentTime) || 0
    if (t < 0.05) return
    this.setData({ splashVideoReady: true })
  },

  /** 预览版失败：不回退原片（原片可达数十 MB），只留封面等倒计时结束 */
  onSplashVideoError() {
    const cfg = this.data.splashConfig || {}
    if (!cfg || cfg.mediaType !== 'video') return
    this.setData({ splashVideoReady: true })
  },

  /** 缓存完整媒体池；仅预下载本次开屏用的压缩预览（不再预拉池内其它条） */
  _cacheSplashMedia(cfg, prevCached, opts) {
    const prev = prevCached || {}
    const items = Array.isArray(cfg.mediaItems) ? cfg.mediaItems : []
    const prevLocalPaths = (prev.localPaths && typeof prev.localPaths === 'object') ? { ...prev.localPaths } : {}
    const baseEntry = {
      enabled: true,
      mediaItems: items,
      lastSplashId: cfg.lastSplashId || '',
      mediaUrl: cfg.mediaUrl || '',
      playUrl: cfg.playUrl || '',
      previewUrl: cfg.previewUrl || '',
      posterUrl: cfg.posterUrl || '',
      mediaType: cfg.mediaType || 'image',
      countdownSeconds: cfg.countdownSeconds || 5,
      localPath: prev.localPath || '',
      localPaths: prevLocalPaths,
      cachedAt: Date.now()
    }
    try { wx.setStorageSync(SPLASH_CACHE_KEY, baseEntry) } catch (e) {}

    // 非会员开屏视频已降级为静态图：只缓存配置，跳过视频预下载（省流量）
    if (opts && opts.skipMediaDownload) return

    // 只预下载本次选中的压缩预览，避免冷启动额外拉未播视频；原片不落盘
    const playUrls = []
    if (cfg.playUrl && !(cfg.originalUrl && cfg.playUrl === cfg.originalUrl)) {
      playUrls.push(cfg.playUrl)
    } else if (cfg.previewUrl) {
      playUrls.push(cfg.previewUrl)
    }

    const fs = wx.getFileSystemManager()
    const downloadOne = (playUrl) => {
      if (!playUrl || !/^https?:\/\//i.test(playUrl)) return
      // 原片不预下（仅缓存 preview 压缩片）
      if (cfg.originalUrl && playUrl === cfg.originalUrl && cfg.playUrl && cfg.playUrl !== cfg.originalUrl) return
      const existing = prevLocalPaths[playUrl]
      if (existing) {
        try {
          fs.accessSync(existing)
          return
        } catch (e) {
          delete prevLocalPaths[playUrl]
        }
      }
      wx.downloadFile({
        url: playUrl,
        success: (res) => {
          if (!res || res.statusCode !== 200 || !res.tempFilePath) return
          fs.saveFile({
            tempFilePath: res.tempFilePath,
            success: (saveRes) => {
              try {
                const cur = wx.getStorageSync(SPLASH_CACHE_KEY) || baseEntry
                const map = (cur.localPaths && typeof cur.localPaths === 'object') ? { ...cur.localPaths } : {}
                if (map[playUrl] && map[playUrl] !== saveRes.savedFilePath) {
                  try { fs.removeSavedFile({ filePath: map[playUrl], fail: () => {} }) } catch (e) {}
                }
                map[playUrl] = saveRes.savedFilePath
                const keys = Object.keys(map)
                if (keys.length > 6) {
                  const drop = keys.slice(0, keys.length - 6)
                  drop.forEach((k) => {
                    try { fs.removeSavedFile({ filePath: map[k], fail: () => {} }) } catch (e) {}
                    delete map[k]
                  })
                }
                wx.setStorageSync(SPLASH_CACHE_KEY, {
                  ...cur,
                  mediaItems: (cur.mediaItems && cur.mediaItems.length) ? cur.mediaItems : items,
                  localPaths: map,
                  localPath: (cfg.playUrl && map[cfg.playUrl]) || cur.localPath || ''
                })
              } catch (e) {}
            },
            fail: () => {}
          })
        },
        fail: () => {}
      })
    }

    playUrls.forEach(downloadOne)
  },

  onSplashVideoEnded() {
    this.closeSplash()
  },

  /** 用户手动点「跳过」：中度震动反馈（倒计时自动结束走 closeSplash，不震动） */
  onSplashSkipTap() {
    if (this.data.splashFading) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    this.closeSplash()
  },

  closeSplash() {
    if (this.data.splashFading) return
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    this.setData({ splashFading: true })
    setTimeout(() => {
      this.setData({ splashVisible: false, splashFading: false, splashVideoReady: false })
      // 开屏结束：恢复隐私禁触遮罩（若门控仍激活），并接力弹隐私授权窗
      const app = getApp()
      if (app && typeof app.setSplashActive === 'function') app.setSplashActive(false)
      // 开屏结束后再检查隐私授权，避免弹窗被品牌开屏盖住
      setTimeout(() => this._maybePromptPrivacy(), 200)
    }, 500)
  },

  /**
   * 首次进入小程序主动弹隐私授权：
   * ensurePrivacyAuthorized 内部会经 wx.getPrivacySetting 二次确认，
   * 已授权用户不会弹窗（微信侧记住同意状态），会话级防重避免反复触发。
   */
  _maybePromptPrivacy() {
    const app = getApp()
    if (!app || app._privacyPromptedThisSession) return
    app._privacyPromptedThisSession = true
    const check = (app.globalData && app.globalData.needPrivacyAuthorization)
      ? Promise.resolve({ needAuthorization: true })
      : (typeof app.updatePrivacySettingCache === 'function'
        ? app.updatePrivacySettingCache()
        : Promise.resolve({}))
    check.then((res) => {
      if (res && res.needAuthorization && typeof app.ensurePrivacyAuthorized === 'function') {
        app.ensurePrivacyAuthorized().then(() => {
          // 隐私弹窗关闭后接力被错峰跳过的弹窗：太空简报优先，未弹则判定续费提醒
          setTimeout(() => this._resumeDeferredPopups(), 400)
        })
      }
    }).catch(() => {})
  },

  /** 隐私授权流程结束后，补弹因错峰被跳过的太空简报 / 续费提醒 */
  _resumeDeferredPopups() {
    let briefingShown = false
    try {
      const comp = this.selectComponent('#morningBriefing')
      if (comp && typeof comp._maybeAutoShowPopup === 'function') {
        briefingShown = !!comp._maybeAutoShowPopup(true)
      }
    } catch (e) {}
    // 简报弹出时续费提醒由其 closed 事件接力；否则这里直接判定
    if (!briefingShown) {
      this._tryShowRenewalReminder()
    }
  },

  onUnload() {
    this._resetMissionCardHaptics()
    this._stopCarouselTimer()
    this._resetCountdownLiveEnterState()
    this._clearCountdownChannelsLivePoll()
    if (this._voteDeferTimer) {
      clearTimeout(this._voteDeferTimer)
      this._voteDeferTimer = null
    }
    // 清除定时器
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
    }
    if (this._countdownSecondsRollTimer) {
      clearTimeout(this._countdownSecondsRollTimer)
      this._countdownSecondsRollTimer = null
    }
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    // 清除滚动节流定时器
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = null
    }
    if (this._scrollFrameTimer) {
      clearTimeout(this._scrollFrameTimer)
      this._scrollFrameTimer = null
    }
    if (this._missionSwipeDragTimer) {
      clearTimeout(this._missionSwipeDragTimer)
      this._missionSwipeDragTimer = null
    }
    if (this._missionCardMeasureTimer) {
      clearTimeout(this._missionCardMeasureTimer)
      this._missionCardMeasureTimer = null
    }
    this._clearLiveStatusPolling()
  },

  /**
   * 任务卡片分享按钮点击（阻止冒泡，避免触发 viewMissionDetail）
   */
  onMissionShareTap() {
    // 分享由 open-type="share" 自动处理
  },

  /**
   * 任务卡片长按 → 中度震动 + 弹出分享面板（好友/群 + 朋友圈）
   */
  onMissionLongPress(e) {
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    var id = ds.id == null ? '' : String(ds.id).trim()
    if (!id) return

    // 中度震动反馈
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (_) {
      try { wx.vibrateShort() } catch (__) {}
    }

    var detailType = ds.type === 'completed' ? 'completed' : 'upcoming'
    this.setData({
      shareSheetVisible: true,
      pendingShareMission: {
        id: id,
        detailType: detailType,
        missionName: ds.name || '',
        rocketName: ds.rocket || ''
      }
    })

    // 同步预下载该任务卡片的火箭图，确保长按面板分享时缩略图能加载
    var sharePayload = resolveMissionSharePayload(this.data, { id: id, detailType: detailType })
    var targetMission = sharePayload && sharePayload.mission
    var targetImage = targetMission && (targetMission.rocketImage || targetMission.image)
    if (targetImage) {
      this.ensureShareImageHttpUrl(
        resolveMissionRocketImage(
          targetImage,
          targetMission.rocketName,
          targetMission.rocketConfiguration
        )
      )
    }
  },

  /**
   * 关闭分享面板
   */
  onShareSheetClose() {
    if (!this.data.shareSheetVisible) return
    this.setData({ shareSheetVisible: false })
  },

  /**
   * 用户点击了分享面板内的某个分享按钮（open-type 已自动触发原生分享）
   * 这里只负责关闭面板。pendingShareMission 保留到 onShareTimeline 读完即可。
   */
  onShareSheetItemTap() {
    this.setData({ shareSheetVisible: false })
  },

  /**
   * 阻止遮罩点击穿透/滚动穿透时的占位
   */
  onShareBriefing(e) {
    // 分享由 button open-type="share" 触发，走 onShareAppMessage
  },

  /** 太空简报弹窗关闭后，接力判断是否需要弹续费提醒 */
  onBriefingClosed() {
    this._tryShowRenewalReminder()
  },

  /** 会员到期续费提醒：展示条件与「关闭一次不再弹」逻辑在组件内部 */
  _tryShowRenewalReminder() {
    try {
      // 错峰隐私授权：首次进入需授权时本次跳过（隐私弹窗关闭后下次 onShow 再走原逻辑）
      const appInst = getApp()
      if (appInst && appInst.globalData && appInst.globalData.needPrivacyAuthorization) return
      const comp = this.selectComponent('#renewalReminder')
      if (!comp || typeof comp.maybeShow !== 'function') return
      const self = this
      comp.maybeShow(function () {
        // 异步取会员状态期间简报弹窗若已占屏，本次放弃（closed 事件会再触发）
        try {
          const briefing = self.selectComponent('#morningBriefing')
          return !!(briefing && briefing.data && briefing.data.showPopup)
        } catch (e) {
          return false
        }
      })
    } catch (e) {}
  },

  noop() {},

  /**
   * 分享给好友
   */
  onShareAppMessage(e) {
    if (e && e.from === 'button' && e.target && e.target.dataset) {
      const ds = e.target.dataset
      if (ds.shareType === 'briefing') {
        return {
          title: '每日太空简报 — 今天太空发生了什么？',
          // 接收方点开直接进入简报详情页
          path: ROUTES.BRIEFING,
          imageUrl: ''
        }
      }
      if (ds.shareType === 'roadClosure') {
        const notice = this.data.roadClosureNotice
        const lines = ['星舰基地封路通知']
        if (notice && notice.message) lines.push(notice.message)
        if (notice && notice.timeRange) lines.push('时间: ' + notice.timeRange)
        // 直达详情页并带上文案，朋友圈单页/未登录读不到云库时也能兜底渲染
        const parts = []
        if (notice && notice.message) parts.push('message=' + encodeURIComponent(String(notice.message).slice(0, 120)))
        if (notice && notice.timeRange) parts.push('timeRange=' + encodeURIComponent(notice.timeRange))
        if (notice && notice.sourceLabel) parts.push('source=' + encodeURIComponent(notice.sourceLabel))
        return {
          title: lines.join(' | '),
          path: ROUTES.ROAD_CLOSURE_DETAIL + (parts.length ? '?' + parts.join('&') : '')
        }
      }
      if (ds.shareType === 'mission' && ds.id) {
        const sharePayload = resolveMissionSharePayload(this.data, {
          id: ds.id,
          detailType: ds.type
        })
        const mission = sharePayload && sharePayload.mission
        if (mission) {
          // 只在 shareImage 已经预下载对应 mission 的图时才用本地路径，
          // 否则会拿当前 launchData 的图盖到别的卡片分享上
          const pending = this.data.pendingShareMission
          const localImage = (pending && pending.id === ds.id && this.data.shareImage) || ''
          return buildMissionShareOptions({
            mission,
            detailType: sharePayload.detailType,
            path: sharePayload.path,
            imageUrl: localImage,
            resolveMissionRocketImage: (imagePath, rocketName, rocketConfiguration) =>
              resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration),
            fallbackImageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
            mode: 'app'
          })
        }
      }
    }

    // 长按弹层中的"微信好友/群"按钮：button 有 dataset，会走上面的分支；
    // 但如果发生异常或 dataset 丢失，这里再用 pendingShareMission 兜底
    const pending = this.data.pendingShareMission
    if (pending && pending.id) {
      const fallbackPayload = resolveMissionSharePayload(this.data, {
        id: pending.id,
        detailType: pending.detailType
      })
      const fallbackMission = fallbackPayload && fallbackPayload.mission
      if (fallbackMission) {
        return buildMissionShareOptions({
          mission: fallbackMission,
          detailType: fallbackPayload.detailType,
          path: fallbackPayload.path,
          resolveMissionRocketImage: (imagePath, rocketName, rocketConfiguration) =>
              resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration),
          fallbackImageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
          mode: 'app'
        })
      }
    }

    // 默认分支：倒计时卡片右上角的箭头分享按钮走这里（button 没带 dataset）
    const launch = this.data.launchData || {}
    return buildMissionShareOptions({
      mission: launch,
      detailType: 'upcoming',
      // 优先用预下载到本地的临时路径（wxfile://），微信缩略图加载成功率显著高于直接给 COS https
      imageUrl: this.data.shareImage,
      resolveMissionRocketImage: (imagePath, rocketName, rocketConfiguration) =>
              resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration),
      fallbackImageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
      fallbackMissionName: 'SpaceX火箭发射',
      fallbackTimeText: '实时追踪',
      mode: 'app'
    })
  },

  /**
   * 分享到朋友圈
   *
   * 注意：onShareTimeline 不接收 e 参数（小程序限制），无法读 button 上的 dataset。
   * 因此优先使用 pendingShareMission（长按面板时已预存的任务 id），
   * 没有则回退到首页的 launchData。
   */
  onShareTimeline() {
    const pending = this.data.pendingShareMission
    if (pending && pending.id) {
      const sharePayload = resolveMissionSharePayload(this.data, {
        id: pending.id,
        detailType: pending.detailType
      })
      const mission = sharePayload && sharePayload.mission
      if (mission) {
        return buildMissionShareOptions({
          mission,
          detailType: sharePayload.detailType,
          path: sharePayload.path,
          imageUrl: this.data.shareImage, // 长按时已预下载该任务的图
          resolveMissionRocketImage: (imagePath, rocketName, rocketConfiguration) =>
              resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration),
          fallbackImageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
          mode: 'timeline'
        })
      }
    }

    // 默认分支：与 onShareAppMessage 默认分支同源（倒计时分享 + 朋友圈兜底）
    const launch = this.data.launchData || {}
    return buildMissionShareOptions({
      mission: launch,
      detailType: 'upcoming',
      imageUrl: this.data.shareImage, // 优先本地预下载路径，朋友圈缩略图也能稳定显示
      resolveMissionRocketImage: (imagePath, rocketName, rocketConfiguration) =>
              resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration),
      fallbackImageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE),
      fallbackMissionName: 'SpaceX火箭发射',
      fallbackTimeText: '实时追踪',
      mode: 'timeline'
    })
  },

  /**
   * 添加到收藏
   */
  onAddToFavorites() {
    return {
      title: `${this.data.launchData.missionName || 'SpaceX火箭发射'} - ${this.data.formattedLaunchTime || '实时追踪'} | 火星探索日志`,
      imageUrl: resolveMissionRocketImage(DEFAULT_SHARE_IMAGE)
    }
  },

  // ========== 发射竞猜投票 ==========
  resetVoteData() {
    this._voteRenderedLaunchId = ''
    this.setData(getInitialVoteState())
  },

  /** 竞猜防降级复核：绕过 30s 缓存强制重查一次（每任务限一次，避免循环重试） */
  _scheduleVoteRecheck(launchId) {
    this._voteRecheckDone = this._voteRecheckDone || {}
    if (this._voteRecheckDone[launchId]) return
    this._voteRecheckDone[launchId] = true
    if (this._voteRecheckTimer) clearTimeout(this._voteRecheckTimer)
    this._voteRecheckTimer = setTimeout(() => {
      this._voteRecheckTimer = null
      if (!this.data.launchData || String(this.data.launchData.id || '') !== String(launchId)) return
      this.loadVoteData(launchId, true)
    }, 1500)
  },

  _buildVoteMissionInfo(launchId, voteType) {
    const ld = this.data.launchData
    if (!ld || String(ld.id || '') !== String(launchId)) {
      return { voteType: voteType === 'outcome' ? 'outcome' : 'ontime' }
    }
    return {
      voteType: voteType === 'outcome' ? 'outcome' : 'ontime',
      launchTime: ld.launchTime || '',
      status: ld._detailType || '',
      statusCategory: ld.statusCategory || '',
      statusAbbrev: ld.statusAbbrev || '',
      statusName: ld.statusBadgeText || ld.status || '',
      missionName: ld.missionName || '',
      rocketName: ld.rocketName || ''
    }
  },

  _applyVoteBundle(launchId, preferredType) {
    const bundle = (this._voteBundle && this._voteBundle[String(launchId)]) || {}
    const active = preferredType || this.data.activeVoteType || 'ontime'
    this.setData(buildDualVoteUiPatch(bundle, active, launchId))
    this._voteRenderedLaunchId = String(launchId)
  },

  onVoteTypeSwitch(e) {
    const vt = (e.currentTarget.dataset && e.currentTarget.dataset.type) || ''
    if (vt !== 'ontime' && vt !== 'outcome') return
    if (vt === this.data.activeVoteType) return
    if (vt === 'ontime' && !this.data.voteOntimeEnabled) return
    if (vt === 'outcome' && !this.data.voteOutcomeEnabled) return
    const launchId = this.data.launchData && this.data.launchData.id
    if (!launchId) return
    this._applyVoteBundle(launchId, vt)
  },

  async loadVoteData(launchId, skipCache) {
    if (!launchId) return

    // 仅前7个即将发射的任务开放竞猜
    var missions = this.data.upcomingMissions || []
    var mIdx = -1
    for (var mi = 0; mi < missions.length; mi++) {
      if (String(missions[mi].id) === String(launchId)) { mIdx = mi; break }
    }
    // 不在前7个中（包括找不到的情况，missions为空时放行让后续逻辑处理）
    if (missions.length > 0 && (mIdx < 0 || mIdx >= 7)) {
      this.setData(getInitialVoteState())
      return null
    }

    var currentLaunchId = String(launchId)
    var now = Date.now()
    this._voteRequestMeta = this._voteRequestMeta || {}
    var voteMeta = this._voteRequestMeta[currentLaunchId] || {}

    if (voteMeta.promise) {
      return voteMeta.promise
    }

    if (shouldSkipVoteRefresh({
      launchId: currentLaunchId,
      lastLoadedAt: voteMeta.loadedAt,
      ttlMs: VOTE_REFRESH_TTL,
      skipCache,
      now
    })) {
      // 优先用投票后更新过的 live bundle，避免旧 voteMeta.bundle 把票数打回 0
      this._voteBundle = this._voteBundle || {}
      if (!this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = voteMeta.bundle
      } else if (this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = mergeVoteBundle(voteMeta.bundle, this._voteBundle[currentLaunchId], currentLaunchId)
      }
      if (this._voteBundle[currentLaunchId]) {
        this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
      }
      return voteMeta.stats || null
    }

    var request = (async () => {
      // stale-while-revalidate：先用本地旧缓存即时渲染（含本地已投选项），云端结果回来后覆盖
      if (!voteMeta.bundle) {
        try {
          var staleOntime = await getVoteStatsStale(launchId, 'ontime')
          var staleOutcome = await getVoteStatsStale(launchId, 'outcome')
          if ((staleOntime || staleOutcome) && this.data.launchData && String(this.data.launchData.id || '') === currentLaunchId) {
            var staleBundle = { ontime: staleOntime, outcome: staleOutcome }
            this._voteBundle = this._voteBundle || {}
            this._voteBundle[currentLaunchId] = staleBundle
            this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
          }
        } catch (eStale) {}
      }

      var ontimeInfo = this._buildVoteMissionInfo(currentLaunchId, 'ontime')
      var outcomeInfo = this._buildVoteMissionInfo(currentLaunchId, 'outcome')

      // 优先复用 onLoad 预取的准时竞猜结果
      var ontimeStats = null
      var outcomeStats = null
      if (String(this._votePrefetchId || '') === currentLaunchId && this._votePrefetchPromise) {
        var prefetchPromise = this._votePrefetchPromise
        this._votePrefetchId = ''
        this._votePrefetchPromise = null
        var ldTs = this.data.launchData && this.data.launchData.launchTime
          ? new Date(this.data.launchData.launchTime).getTime() : 0
        if (ldTs && ldTs - Date.now() > 30 * 60 * 1000) {
          try { ontimeStats = await prefetchPromise } catch (ePrefetch) { ontimeStats = null }
        }
      }

      var fetchTasks = []
      if (!ontimeStats) {
        fetchTasks.push(getVoteStats(launchId, skipCache, ontimeInfo).then(function (s) { ontimeStats = s }).catch(function () { ontimeStats = null }))
      }
      fetchTasks.push(getVoteStats(launchId, skipCache, outcomeInfo).then(function (s) { outcomeStats = s }).catch(function () { outcomeStats = null }))
      await Promise.all(fetchTasks)

      // 合并本地已投选项
      if (ontimeStats && !ontimeStats.myVote) ontimeStats.myVote = getLocalVote(launchId, 'ontime')
      if (outcomeStats && !outcomeStats.myVote) outcomeStats.myVote = getLocalVote(launchId, 'outcome')

      var prevBundle = (this._voteBundle && this._voteBundle[currentLaunchId]) || (voteMeta && voteMeta.bundle) || null
      var bundle = mergeVoteBundle(prevBundle, { ontime: ontimeStats, outcome: outcomeStats }, currentLaunchId)
      var activeStats = (this.data.activeVoteType === 'outcome' ? bundle.outcome : bundle.ontime) || bundle.ontime || bundle.outcome

      // 防降级：stale 已渲染出竞猜框后，fresh 若双题型都关闭/失败，先复核再隐藏
      var staleRendered = String(this._voteRenderedLaunchId || '') === currentLaunchId && this.data.voteSlotVisible
      var freshSlotVisible = !!(bundle.ontime && bundle.ontime.enabled) || !!(bundle.outcome && bundle.outcome.enabled)
      var freshDowngrade = !freshSlotVisible
      if (staleRendered && freshDowngrade) {
        this._voteRecheckDone = this._voteRecheckDone || {}
        if (!skipCache && !this._voteRecheckDone[currentLaunchId]) {
          this._voteRequestMeta[currentLaunchId] = { loadedAt: 0, stats: null, bundle: prevBundle || null, promise: null }
          this._scheduleVoteRecheck(currentLaunchId)
          return activeStats
        }
        if (!ontimeStats && !outcomeStats) {
          this._voteRequestMeta[currentLaunchId] = { loadedAt: 0, stats: null, bundle: prevBundle || null, promise: null }
          return null
        }
      }

      this._voteBundle = this._voteBundle || {}
      this._voteBundle[currentLaunchId] = bundle
      this._voteRequestMeta[currentLaunchId] = {
        loadedAt: Date.now(),
        stats: activeStats,
        bundle,
        promise: null
      }
      if (!this.data.launchData || String(this.data.launchData.id || '') !== currentLaunchId) return activeStats
      this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
      return activeStats
    })()

    this._voteRequestMeta[currentLaunchId] = {
      ...voteMeta,
      promise: request
    }

    try {
      return await request
    } finally {
      var latestMeta = this._voteRequestMeta[currentLaunchId] || {}
      if (latestMeta.promise === request) {
        this._voteRequestMeta[currentLaunchId] = {
          ...latestMeta,
          promise: null
        }
      }
    }
  },

  async onVote(e) {
    var pill = (e.currentTarget.dataset && (e.currentTarget.dataset.pill || e.currentTarget.dataset.side)) || ''
    var launchId = this.data.launchData.id
    var voteType = this.data.activeVoteType === 'outcome' ? 'outcome' : 'ontime'
    // 左右侧在 JS 内映射，避免把成败投成 ge/buge
    var choice = voteType === 'outcome'
      ? (pill === 'left' ? 'failure' : pill === 'right' ? 'success' : '')
      : (pill === 'left' ? 'ge' : pill === 'right' ? 'buge' : '')
    if (!launchId || !choice) return
    if (this.data.voteData && this.data.voteData.votingClosed) {
      wx.showToast({ title: '竞猜已封盘', icon: 'none' })
      return
    }
    if (this.data.myVote) {
      wx.showToast({ title: '你已经投过啦', icon: 'none' })
      return
    }
    // 投票成功路径：中度震动反馈
    this._vibrateMedium()
    saveLocalVote(launchId, choice, voteType)
    var oldData = this.data.voteData || { geCount: 0, buGeCount: 0 }
    var leftChoice = voteType === 'outcome' ? 'failure' : 'ge'
    var rightChoice = voteType === 'outcome' ? 'success' : 'buge'
    var newGe = (oldData.geCount || 0) + (choice === leftChoice ? 1 : 0)
    var newBuge = (oldData.buGeCount || 0) + (choice === rightChoice ? 1 : 0)
    var total = newGe + newBuge
    var votePatch = {
      myVote: choice,
      'voteData.geCount': newGe,
      'voteData.buGeCount': newBuge,
      'voteData.failureCount': voteType === 'outcome' ? newGe : (oldData.failureCount || 0),
      'voteData.successCount': voteType === 'outcome' ? newBuge : (oldData.successCount || 0),
      voteTotal: total,
      voteGePct: Math.round(newGe / total * 100),
      voteBugePct: Math.round(newBuge / total * 100)
    }
    this.setData(votePatch)
    var serverData = null
    var voteFailMsg = ''
    try {
      serverData = await castVote(launchId, choice, {
        voteType,
        missionName: this.data.launchData.missionName,
        rocketName: this.data.launchData.rocketName,
        launchTime: this.data.launchData.launchTime,
        statusCategory: this.data.launchData.statusCategory || '',
        statusAbbrev: this.data.launchData.statusAbbrev || '',
        statusName: this.data.launchData.statusBadgeText || ''
      })
    } catch (err) {
      serverData = null
      voteFailMsg = (err && err.message) || ''
    }
    if (serverData) {
      var normalized = buildVoteState(serverData, choice, voteType)
      // 服务端若未带回票数，至少保留乐观更新的人数与比例条
      if (!normalized.voteTotal && total > 0) {
        normalized.voteData.geCount = newGe
        normalized.voteData.buGeCount = newBuge
        if (voteType === 'outcome') {
          normalized.voteData.failureCount = newGe
          normalized.voteData.successCount = newBuge
        }
        normalized.voteTotal = total
        normalized.voteGePct = Math.round(newGe / total * 100)
        normalized.voteBugePct = Math.round(newBuge / total * 100)
      }
      this.setData({
        voteData: normalized.voteData,
        myVote: choice,
        voteTotal: normalized.voteTotal,
        voteGePct: normalized.voteGePct,
        voteBugePct: normalized.voteBugePct,
        activeVoteType: voteType
      })
      this._voteBundle = this._voteBundle || {}
      var lid = String(launchId)
      var b = this._voteBundle[lid] || {}
      var votedStats = Object.assign({}, serverData, {
        myVote: choice,
        enabled: true,
        geCount: normalized.voteData.geCount,
        buGeCount: normalized.voteData.buGeCount,
        failureCount: normalized.voteData.failureCount,
        successCount: normalized.voteData.successCount
      })
      b[voteType] = votedStats
      this._voteBundle[lid] = b
      // 同步 meta，避免 TTL 内刷新用旧 bundle 把票数打回 0
      this._voteRequestMeta = this._voteRequestMeta || {}
      var prevMeta = this._voteRequestMeta[lid] || {}
      this._voteRequestMeta[lid] = {
        loadedAt: Date.now(),
        stats: votedStats,
        bundle: b,
        promise: prevMeta.promise || null
      }
    } else {
      // 提交失败：回滚乐观更新（本地记录 + UI 计数），否则界面显示已投票但服务端没有记录
      removeLocalVote(launchId, voteType)
      var rbTotal = (oldData.geCount || 0) + (oldData.buGeCount || 0)
      this.setData({
        myVote: '',
        'voteData.geCount': oldData.geCount || 0,
        'voteData.buGeCount': oldData.buGeCount || 0,
        voteTotal: rbTotal,
        voteGePct: rbTotal > 0 ? Math.round((oldData.geCount || 0) / rbTotal * 100) : 50,
        voteBugePct: rbTotal > 0 ? Math.round((oldData.buGeCount || 0) / rbTotal * 100) : 50
      })
      wx.showToast({ title: voteFailMsg || '投票失败，请重试', icon: 'none' })
    }
  }



})
