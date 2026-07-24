// pages/index/index.js
const themeUtil = require('../../utils/theme.js')
const {
  resolveFestivalHatId,
  isFestivalHatDevMode,
  listFestivalHats,
  DEV_CYCLE_MS
} = require('../../utils/festival-hat.js')
const {
  getUpcomingMissions,
  getCompletedMissions,
  invalidateListSnapshots
} = require('../../utils/api-launch-list.js')
const {
  shareMission,
  getVoteStats,
  fetchLaunchStatusSnapshot
} = require('../../utils/api-app-services.js')
const { onLaunchListStale, forceLaunchListCloudBgCheck } = require('../../utils/api-request.js')
const {
  filterExpiredMissions,
  getStatusTextZh,
  formatSecondsText,
  getSecondsReel,
  DEFAULT_ROCKET_IMAGE,
  DEFAULT_SHARE_IMAGE,
  shouldSkipLaunchStatsRefresh,
  shouldSkipSimpleRefresh,
  setMissionDetailCacheEntry
} = require('../../utils/index-page-helpers.js')

const {
  formatDate,
  getCountdown,
  resolveMissionRocketImage,
  isDefaultRocketSrc,
  shouldReplaceRocketImage
} = require('../../utils/util.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const {
  fetchMissionListData,
  buildMissionListSetData,
  getMissionNextOffset,
  mergeMissionPages
} = require('../../utils/index-mission-services.js')
const {
  buildMissionListViewUpdateData,
  buildMissionReadyState,
  getMissionScrollTopField,
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
  buildCurrentLaunchPanelState,
  getNextUpcomingLaunch,
  pickCountdownDisplayMission,
  shouldHoldPastNetCountdownMission,
  pickOverlapSideCard,
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
const { nextProbeAction } = require('../../utils/countdown-window-machine.js')
const { mergeObservationList, projectLaunchRecords, isSettledStatusId } = require('../../utils/launch-status-store.js')
const {
  resolveMissionDetailSourceData,
  buildMissionDetailNavigation,
  buildMissionShareOptions,
  resolveMissionSharePayload,
  collectMissionShareCandidates
} = require('../../utils/index-mission-nav.js')
const { loadMoreInteraction, missionCardCountdown } = require('../../utils/config.js')
const config = require('../../utils/config.js')
const { loadCloudMediaMap } = require('../../utils/image-config.js')
const { preloadRocketConfigMedia } = require('../../utils/icon-cache.js')


function getLiveFinderUserNameFromConfig() {
  const cfg = (config && config.channelsLive) || {}
  return String(cfg.finderUserName || '').trim()
}
const { toCdnUrl } = require('../../utils/cos-url.js')
const { markDownloadFailed } = require('../../utils/download-fail-cache.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const {
  subscribeLaunch,
  unsubscribeLaunch,
  isSubscribed,
  getSubscribedMissionIdSet,
  syncSubscriptionState,
  warmSubscribedStoreSync,
  warmSubscribedStoreAsync
} = require('../../utils/subscribe.js')
const { isOaAlertReady, peekOaAlertReady } = require('../../utils/oa-alert.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const {
  getMembershipState,
  isMembershipEnabled,
  isProSync,
  canUsePaidCloudSync,
  gateCheck,
  warmMembershipStateSync,
  warmMembershipStateAsync
} = require('../../utils/membership.js')
const { getMemberPolicy, getMemberPolicySync } = require('../../utils/member-policy.js')
const { fetchMainConfig } = require('../../utils/feature-flags.js')
const { warmUserPreferencesSync, warmBriefingPopupShownSync } = require('../../utils/user-growth.js')
const { persistAgencyLogoAfterRemoteLoad, isRemoteAgencyLogoUrl } = require('../../utils/agency-logo-cache.js')
const { enrichMissionsLaunchAgencyImages } = require('../../utils/upcoming-agency-logo-enrich.js')
const { buildUpcomingAgencyFilterState, getAgencyKeyFromMission } = require('../../utils/upcoming-agency-filter.js')

// 倒计时到点实时状态确认：具体节奏（NET+10m 首查 / 窗口内 3m 复查 / 窗口+宽限后
// bestEffort、未决 15m 慢探）统一由 utils/countdown-window-machine.js 决策。
const LIVE_STATUS_MIN_ROUND_GAP_MS = 30 * 1000
// 结算→历史列表合并域：必须主包同步加载（_filterUpcomingAgainstSettled 等大量同步返回值调用点）
const {
  methods: settledMergeMethods,
  isSettleableLiveStatusId,
  RECENT_SETTLED_MEM_TTL_MS
} = require('./utils/index-settled-merge.js')
/** 首屏渲染前等云端 recent_settled 的最大预算（本地快照过期时才等） */
const RECENT_SETTLED_FIRST_PAINT_BUDGET_MS = 2000


// 非会员任务列表免费可见条数（即将发射 / 历史发射各自计）；
// 会员功能未开启、Pro 用户或广告解锁期内不限制
const FREE_MISSION_LIST_LIMIT = 10

const CALENDAR_PKG = '../../subpackages/index-extra/utils/index-calendar-page.js'
const CALENDAR_METHODS = [
  '_processCalendarMission',
  'getMissionTypeCategory',
  'inferLaunchSiteKey',
  'getMissionStatusCategoryForCalendar',
  'buildCalendarMissionQueryMeta',
  'buildCalendarSiteOptions',
  'getCalendarFilterSummaryText',
  'getMissionMapLinkMeta',
  'buildStarbaseFacilityQuery',
  'buildRoadClosureQuery',
  'getFilteredCalendarMissions',
  'buildCalendarDateMapFromMissions',
  'buildCalendarDerivedPayload',
  'updateCalendarDerivedState',
  'applyCalendarBatchState',
  'restoreCalendarCacheSnapshot',
  'fetchCalendarMissionPage',
  'fetchCalendarMissionBatch',
  'resetCalendarLoadFailureState',
  'finishCalendarAppendWithoutChanges',
  'applyCalendarMissionSnapshot',
  'hydrateCalendarFromLoadedMissionLists',
  'syncCalendarFromMissionListsIfNeeded',
  'loadCalendarData',
  '_continueLoadCalendarDataAfterCacheMiss',
  '_loadMoreCalendarData',
  '_saveCalendarCache',
  '_isMonthCovered',
  'buildCalendarDayCells',
  'shouldAutoLoadMoreCalendarMonth',
  'buildCalendarDays',
  'switchCalendarMonth',
  'calendarPrevMonth',
  'calendarNextMonth',
  'calendarGoToday',
  'onCalendarMonthTitleTap',
  'onCalendarMonthPickerChange',
  'onCalendarDateTap',
  'toggleCalendarFilterPanel',
  'applyCalendarFilterState',
  'onCalendarQuickFilterTap',
  'onCalendarSiteFilterTap',
  'onCalendarStatusFilterTap',
  'resetCalendarFilters',
  'buildMapEntryList',
  'openCalendarMapLink',
  '_patchCalendarMissionRocketImage',
  'loadLaunchStats',
  'goGlobalLaunchStats'
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
CALENDAR_METHODS.forEach((name) => {
  calendarDelegates[name] = delegateCalendar(name)
})

// 长按保存轮播图（纯用户触发路径）走分包异步加载
const SAVE_IMAGE_PKG = '../../subpackages/index-extra/utils/index-save-image.js'
const SAVE_IMAGE_METHODS = ['saveCarouselImage', 'saveImageToAlbum', 'handleSaveImageError']
function delegateSaveImage(name) {
  return function (...args) {
    const page = this
    if (page.__saveImageAttached) return page[name](...args)
    if (!page.__saveImageLoadPromise) {
      page.__saveImageLoadPromise = require.async(SAVE_IMAGE_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      })
    }
    return page.__saveImageLoadPromise.then(() => page[name](...args))
  }
}
const saveImageDelegates = {}
SAVE_IMAGE_METHODS.forEach((name) => {
  saveImageDelegates[name] = delegateSaveImage(name)
})

// 发射竞猜逻辑同样走分包异步加载（竞猜框在倒计时数据就绪后才出现，可延迟）
const VOTE_PKG = '../../subpackages/index-extra/utils/index-vote.js'
const VOTE_METHODS = [
  'resetVoteData',
  '_scheduleVoteRecheck',
  '_buildVoteMissionInfo',
  '_applyVoteBundle',
  'onVoteTypeSwitch',
  'loadVoteData',
  'onVote'
]
function delegateVote(name) {
  return function (...args) {
    const page = this
    if (page.__voteAttached) return page[name](...args)
    if (!page.__voteLoadPromise) {
      page.__voteLoadPromise = require.async(VOTE_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      })
    }
    return page.__voteLoadPromise.then(() => page[name](...args))
  }
}
const voteDelegates = {}
VOTE_METHODS.forEach((name) => {
  voteDelegates[name] = delegateVote(name)
})

const PINNED_UPCOMING_MISSION_STORAGE_KEY = '_idx_pinned_upcoming_mission_id'

// 开屏动画：本地缓存的配置 + 已下载媒体文件路径（冷启动零网络等待）

const COS_DEMO_QR_URL = toCdnUrl(
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E4%BA%8C%E7%BB%B4%E7%A0%81/1775323336594_jkl6zv.png'
)

function sortPinnedMissionFirst(list, pinnedId) {
  if (!pinnedId || !Array.isArray(list) || !list.length) return list.slice()
  const pid = String(pinnedId)
  const idx = list.findIndex((m) => m && String(m.id) === pid)
  if (idx <= 0) return list.slice()
  const next = list.slice()
  const [row] = next.splice(idx, 1)
  return [row, ...next]
}

/** 首屏等待云媒体映射的最大时间，超时后继续拉列表，避免长时间白屏 */
const LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS = 2500

const CAROUSEL_PKG = '../../subpackages/index-extra/utils/index-carousel.js'
const CAROUSEL_METHODS = [
  'getDefaultCarouselImages',
  'loadCarouselImages',
  '_enrichCarouselAccounts',
  '_getTweetAccountsCached',
  'onCarouselAvatarError',
  '_enrichCarouselCaptions',
  '_startCarouselTimer',
  '_stopCarouselTimer',
  '_stopCarouselVideo',
  '_updateCarouselAutoplayGate',
  '_activateCarouselVideos',
  '_playCurrentVideoIfNeeded',
  'onCarouselChange',
  'onCarouselVideoTimeUpdate',
  'onCarouselVideoError',
  'onCarouselCaptionTap',
  'onCarouselVideoTap',
  'onCarouselImageLoad',
  'onCarouselImageError',
  'previewCarouselImage'
]
function delegateCarousel(name) {
  return function (...args) {
    const page = this
    if (page.__carouselAttached) return page[name](...args)
    if (!page.__carouselLoadPromise) {
      page.__carouselLoadPromise = require.async(CAROUSEL_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__carouselLoadPromise = null
        console.error('[Index] 轮播分包模块加载失败:', err)
        throw err
      })
    }
    return page.__carouselLoadPromise.then(() => page[name](...args))
  }
}
const carouselDelegates = {}
CAROUSEL_METHODS.forEach((name) => {
  carouselDelegates[name] = delegateCarousel(name)
})

const SPLASH_PKG = '../../subpackages/index-extra/utils/index-splash.js'
const SPLASH_METHODS = [
  'loadSplashScreen',
  '_showSplash',
  '_startSplashTick',
  '_resumeSplashTimer',
  'onSplashVideoPlay',
  'onSplashVideoTimeUpdate',
  'onSplashVideoLoadedMeta',
  'onSplashVideoError',
  '_cacheSplashMedia',
  'onSplashVideoEnded',
  'onSplashSkipTap',
  'onSplashMissionTap',
  'closeSplash'
]
function delegateSplash(name) {
  return function (...args) {
    const page = this
    if (page.__splashAttached) return page[name](...args)
    if (!page.__splashLoadPromise) {
      page.__splashLoadPromise = require.async(SPLASH_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__splashLoadPromise = null
        console.error('[Index] 开屏分包模块加载失败:', err)
        throw err
      })
    }
    return page.__splashLoadPromise.then(() => page[name](...args))
  }
}
const splashDelegates = {}
SPLASH_METHODS.forEach((name) => {
  splashDelegates[name] = delegateSplash(name)
})


// ========== 结算/实况/直播/低频加载：在 index-extra 分包（index-live-settle.js） ==========
// 全部调用点均为语句式（无同步返回值依赖）；首页 preloadRule 预下载分包，几乎无等待。
// 注意：_onCountdownExpired / onHide / _clearLiveStatusPolling / _clearCountdownChannelsLivePoll
// 因需同步操作定时器锁保留在主包，与模块共享 page 实例属性（见模块头注释）。
const LIVE_SETTLE_PKG = '../../subpackages/index-extra/utils/index-live-settle.js'
const LIVE_SETTLE_METHODS = [
  '_scrubKnownSettleableCountdown',
  '_refilterUpcomingAgainstSettled',
  'refreshLaunchDelayInfo',
  '_tryLaunchDelayFromUpdatesCache',
  '_kickQuietSettlePastNetUpcoming',
  '_quietSettlePastNetMission',
  '_applyQuietPostponedNet',
  '_settleExpiredLaunch',
  '_refreshUpcomingAfterSettle',
  '_moveMissionToCompleted',
  '_applyPostponedNet',
  '_checkLiveLaunchStatus',
  '_fetchLl2UpdatesCached',
  '_fetchTerminalFromLl2Updates',
  '_trySettleFromLl2Updates',
  '_scheduleStatusRecheck',
  '_applyLiveStatusPanel',
  '_armLiveStatusRecheck',
  '_settleExpiredLaunchWithBestEffort',
  '_patchUpcomingListLiveStatuses',
  'refreshCountdownChannelsLive',
  '_scheduleCountdownChannelsLivePoll',
  'onCountdownLiveAvatarTap',
  '_openCountdownChannelsLive',
  'loadRoadClosureNotice',
  'openRoadClosureDetail',
  'loadSpaceXStats',
  'loadAnnouncementBanner',
  'openAnnouncementDetail',
  'onContactCallback',
  '_refreshRocketImagesFromMediaMap'
]
function delegateLiveSettle(name) {
  return function (...args) {
    const page = this
    if (page.__liveSettleAttached) return page[name](...args)
    if (!page.__liveSettleLoadPromise) {
      page.__liveSettleLoadPromise = require.async(LIVE_SETTLE_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__liveSettleLoadPromise = null
        throw err
      })
    }
    return page.__liveSettleLoadPromise.then(() => page[name](...args))
  }
}
const liveSettleDelegates = {}
LIVE_SETTLE_METHODS.forEach((name) => {
  liveSettleDelegates[name] = delegateLiveSettle(name)
})

// ========== 低频 UX（演示/隐私/分享面板/公告关闭）：index-extra ==========
const UX_PKG = '../../subpackages/index-extra/utils/index-ux.js'
const UX_METHODS = [
  "closeAnnouncementBanner",
  "closeAnnouncementDetail",
  "openAISearch",
  "openShop",
  "_initDemoMode",
  "onDemoRemoteStart",
  "onDemoStop",
  "_maybePromptPrivacy",
  "_resumeDeferredPopups",
  "onMissionShareTap",
  "onMissionLongPress",
  "onShareSheetClose",
  "onShareSheetItemTap",
  "onShareBriefing",
  "onBriefingClosed",
  "_tryShowRenewalReminder",
  "ensureShareImageHttpUrl"
]
function delegateUx(name) {
  return function (...args) {
    const page = this
    if (page.__uxAttached) return page[name](...args)
    if (!page.__uxLoadPromise) {
      page.__uxLoadPromise = require.async(UX_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__uxLoadPromise = null
        throw err
      })
    }
    return page.__uxLoadPromise.then(() => page[name](...args))
  }
}
const uxDelegates = {}
UX_METHODS.forEach((name) => {
  uxDelegates[name] = delegateUx(name)
})

Page({
  ...uxDelegates,
  ...liveSettleDelegates,
  ...splashDelegates,
  ...carouselDelegates,
  ...calendarDelegates,
  ...voteDelegates,
  ...saveImageDelegates,
  onLoad(options) {
    this._pageLoadAt = Date.now()
    this._launchRecordsById = new Map()
    this._launchStateGeneration = 0
    // 冷启动立即异步回灌上次会话的 recent_settled 快照：
    // 首屏列表过滤可直接用本地快照，不再被 ll2Query 冷启动（数秒）卡住
    this._hydrateRecentSettledFromStorage()
    // 后台探云发现 previous/upcoming 变新鲜时刷新 UI（此前只有 monitor 订了 onStaleUpdate）
    this._offLaunchListStale = onLaunchListStale((info) => {
      try {
        this._onLaunchListCacheStale(info)
      } catch (e) {}
    })
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
    try {
      menuBtn = wx.getMenuButtonBoundingClientRect()
    } catch (e) {}
    if (!menuBtn || !menuBtn.height) {
      menuBtn = {
        top: (uiShellLayout.statusBarHeight || 44) + 4,
        height: 32,
        left: windowWidth - 96
      }
    }

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
      pinnedUpcomingMissionId: ''
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
      try {
        warmSubscribedStoreAsync()
      } catch (e) {}
      try {
        warmMembershipStateAsync()
      } catch (e) {}
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
      this.loadSplashScreen()
        .then(() => {
          // 无开屏动画时，首屏稳定后主动检查隐私授权；有开屏则由 closeSplash 触发
          if (!this.data.splashVisible) {
            setTimeout(() => this._maybePromptPrivacy(), 300)
          }
        })
        .catch(() => {})
      try { this._syncFestivalHat() } catch (e) {}

      // 首屏后：轮播/封路（与倒计时面板相关，略延后）
      setTimeout(() => {
        Promise.all([this.loadRoadClosureNotice(), this.loadCarouselImages()]).catch(() => {})
      }, 100)

      // 首屏稳定后再探视频号直播，避免抢首屏预算
      setTimeout(() => {
        this.refreshCountdownChannelsLive({ schedule: true })
      }, 1600)

      // 首屏预算结束后：统计横幅、公告、会员态（非首屏必需）
      setTimeout(() => {
        this.loadSpaceXStats()
        this.loadAnnouncementBanner()
        this._membershipWarmAt = Date.now()
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

    // 节日帽与星问对齐：回前台按当天再解析（开发模式则续轮播预览）
    this._syncFestivalHat()

    // 切回前台/Tab：按真实时间重算并恢复倒计时（onHide 已暂停，避免后台空跑）
    this.startCountdown()

    // 开屏倒计时在 onHide 被停表：开屏仍可见则续跑
    if (this._splashTimerPaused && this.data.splashVisible && !this.data.splashFading) {
      this._splashTimerPaused = false
      this._resumeSplashTimer()
    }

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

      // 轮播仅「即将发射」Tab 展示与播控
      if (
        this.data.missionType === 'upcoming' &&
        this.data.carouselItems &&
        this.data.carouselItems.length > 0
      ) {
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
        // 不再因 OA 就绪强行点亮铃铛：结果改由服务号推送
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
          const next = !!subscribed
          if (this.data._countdownSubscribed !== next) {
            this.setData({ _countdownSubscribed: next })
          }
          this._syncDisplayedUpcomingSwipeRowFlags()
        })
      } else {
        this._syncDisplayedUpcomingSwipeRowFlags()
      }
      this._refreshOaAlertReady(false)

      // 冷启动 3s 内 onLoad 已调度会员/筛选刷新，避免 onShow 重复 setData
      const sinceLoad = Date.now() - (this._pageLoadAt || 0)
      if (sinceLoad >= 3000) {
        this._refreshMembershipAndAgencyFilter()
        // 会员 warm 60 秒节流：频繁切 Tab 时不重复打云端权益查询
        if (!this._membershipWarmAt || Date.now() - this._membershipWarmAt >= 60 * 1000) {
          this._membershipWarmAt = Date.now()
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
      }

      // 从详情返回：强制拉 recent_settled；已可落库的立刻移出倒计时（与历史同拍）
      // 60 秒内重复 onShow 降级为读内存缓存（force=false），避免频繁切页触发云端强刷
      const settledForce = !this._settledOnShowForceAt || Date.now() - this._settledOnShowForceAt >= 60 * 1000
      if (settledForce) this._settledOnShowForceAt = Date.now()
      this._ensureRecentSettledCache(settledForce)
        .then(() => {
          try {
            this._scrubKnownSettleableCountdown()
          } catch (e) {}
          return this._applyRecentSettledToCompletedList(settledForce)
        })
        .then(() => {
          try {
            this._refilterUpcomingAgainstSettled()
          } catch (e2) {}
        })
        .catch(() => {
          try {
            this._scrubKnownSettleableCountdown()
          } catch (e3) {}
        })
    }, 0)
  },

  _absorbLaunchStateObservations(rows, source) {
    this._launchRecordsById = mergeObservationList(this._launchRecordsById, rows, {
      source: source || 'list',
      observedAtMs: Date.now()
    })
    return this._launchRecordsById
  },

  _beginLaunchStateGeneration() {
    this._launchStateGeneration = (this._launchStateGeneration || 0) + 1
    return this._launchStateGeneration
  },

  _isLaunchStateGenerationCurrent(generation) {
    return !generation || generation === this._launchStateGeneration
  },

  _projectAuthoritativeLaunchState(upcoming, completed, now) {
    return projectLaunchRecords({
      recordsById: this._launchRecordsById,
      upcoming: Array.isArray(upcoming) ? upcoming : [],
      completed: Array.isArray(completed) ? completed : [],
      now: now || Date.now()
    })
  },

  applyLaunchObservationFromDetail(observation) {
    if (!observation || observation.id == null) return
    this._absorbLaunchStateObservations(
      [
        {
          ...observation,
          status: {
            id: observation.statusId,
            name: observation.statusBadgeText || observation.status || '',
            abbrev: observation.statusAbbrev || ''
          },
          source: 'detail',
          observedAtMs: observation.observedAtMs || Date.now()
        }
      ],
      'detail'
    )
    const projected = this._projectAuthoritativeLaunchState(this.data.upcomingMissions, this.data.completedMissions)
    const completed = this._mergeRecentSettledIntoCompletedList(
      projected.completed,
      Array.from(this._launchRecordsById.values())
    )
    const patch = {
      upcomingMissions: projected.upcoming,
      completedMissions: completed
    }
    this.applyUpcomingAgencyFilterToPatch(patch, projected.upcoming)
    this.setData(patch, () => {
      this.updateMissionListView('completed', completed)
      if (this.data.launchData && String(this.data.launchData.id) === String(observation.id)) {
        this._scrubKnownSettleableCountdown()
      }
    })
  },

  _isKnownSettleableId(id) {
    if (id == null || id === '') return false
    return this._collectSettleableSettledIdSet().has(String(id))
  },

  /**
   * 已明确可落库（recent_settled 终态/飞行中，或本机历史卡）的任务：
   * 从即将发射剥离并补进历史，倒计时一次切到下一任务——禁止先闪该任务再消失。
   */
  _peelKnownSettleableFromUpcoming(list) {
    const source = Array.isArray(list) ? list : []
    const ids = this._collectSettleableSettledIdSet()
    if (!ids.size) return { upcoming: source, completedAdds: [] }

    const settled = Array.isArray(this._recentSettledCache) ? this._recentSettledCache : []
    const byId = new Map()
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]
      if (s && s.id) byId.set(String(s.id), s)
    }

    const upcoming = []
    const completedAdds = []
    const seenAdd = new Set()
    for (let i = 0; i < source.length; i++) {
      const m = source[i]
      if (!m || m.id == null) {
        upcoming.push(m)
        continue
      }
      const idStr = String(m.id)
      if (!ids.has(idStr)) {
        upcoming.push(m)
        continue
      }
      if (seenAdd.has(idStr)) continue
      seenAdd.add(idStr)
      // settleable 来自 _launchRecordsById；recentSettledCache 可能尚未对齐，不能只查 cache
      const cached = byId.get(idStr)
      const record = this._launchRecordsById && this._launchRecordsById.get(idStr)
      const row =
        cached && cached.status
          ? cached
          : record && record.status
            ? {
                id: idStr,
                name: record.name || m.name || '',
                net: record.net || m.launchTime || '',
                status: record.status,
                settledAtMs: record.observedAtMs || Date.now()
              }
            : null
      if (row && row.status) {
        const card = this._buildCompletedItemFromSettled(row, m)
        this._rememberSessionCompleted(card)
        completedAdds.push(card)
      } else {
        // 无状态证据时宁可不 peel，避免即将发射删了、历史又插不进
        upcoming.push(m)
      }
    }
    return { upcoming, completedAdds }
  },

  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    missionType: 'upcoming', // upcoming / completed / calendar
    // 任务卡片长按 → 分享面板（朋友/群 + 朋友圈）
    shareSheetVisible: false,
    pendingShareMission: { id: '', detailType: '', missionName: '', rocketName: '' },
    // 预下载到本地的分享缩略图（wxfile:// 或 http://tmp/...），用于规避 iOS 朋友圈/网络分享缩略图加载失败
    shareImage: '',
    launchData: {},
    /** 倒计时圆图节日帽（与星问同源日期解析） */
    festivalHat: '',
    formattedLaunchTime: '',
    formattedLaunchDate: '',
    formattedLaunchWeekTime: '',
    // 当前任务的推迟徽标文案（如「已推迟 2 次 · 累计 3 天」），无推迟/无数据时为空
    launchDelayText: '',
    /** 与主倒计时窗口重叠的相邻任务副卡（精简单行）；无重叠时为 null */
    overlapSideCard: null,
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
    /** 轮播数据未回来前显示等高骨架，避免异步插入造成布局偏移（CLS） */
    carouselPending: true,
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
    // 开屏全局通知条（后台 noticeText；空则不显示）
    splashNotice: null,
    // 开屏任务倒计时卡片（后台给媒体项配置任务名称后展示）
    splashMission: null,
    splashMissionCd: null,
    _countdownSubscribed: false,
    /** 服务号自动提醒已就绪：全任务覆盖，不再引导逐条订阅 */
    oaAlertReady: false,
    launchStats: {},
    launchStatsLoading: false,
    launchStatsError: '',
    // 倒计时圆图：视频号直播态（红边涟漪 + 声波「直播中」）
    // enableLiveEntry：过审直播入口开关（isLiveEntryAllowed，failClosed），关闭时不探测/不轮询/不渲染直播 UI
    enableLiveEntry: false,
    isChannelsLive: false,
    channelsLiveStatus: 0,
    channelsLiveFeedId: '',
    liveFinderUserName: getLiveFinderUserNameFromConfig(),
    channelsLiveAnimPaused: false,
    /** 点击进直播过渡中（压缩放动画） */
    isEnteringLive: false
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
    const url = resolveMissionRocketImage(curImg, ld.rocketName, ld.rocketConfiguration, true)
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

    const nextImage = resolveMissionRocketImage(failedImage, rocketName, ld.rocketConfiguration, true)
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

  /** 列表项：reminderOn = 本任务已写入小程序订阅；OA 就绪时结果改由服务号推，铃铛通常为关 */
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
      // OA 覆盖发射前与结果；铃铛仅反映是否仍有本任务小程序订阅（遗留可关）
      const reminderOn = subSet.has(String(m.id))
      const pinnedOn = !!pid && String(m.id) === pid
      if (m.reminderOn === reminderOn && m.pinnedOn === pinnedOn) return m
      return { ...m, reminderOn: reminderOn, pinnedOn: pinnedOn }
    })
    this._attachCardCountdownToDisplayedPatch(safePatch)
  },

  _getMissionCardCountdownDeps() {
    const holdMissionId =
      this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
    return {
      getCountdown,
      formatSecondsText,
      now: Date.now(),
      holdMissionId,
      recordsById: this._launchRecordsById
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
    const proFlag = safePatch.isProUser !== undefined ? !!safePatch.isProUser : !!this.data.isProUser

    let upcoming =
      upcomingOverride != null
        ? upcomingOverride
        : Array.isArray(safePatch.upcomingMissions)
          ? safePatch.upcomingMissions
          : this.data.upcomingMissions || []

    // 最终防线：历史已有 / 已可落库的 id，绝不能进 displayedUpcomingMissions
    // （否则会出现「历史=载荷已部署、即将发射=就绪」双开）
    const cleaned = this._filterUpcomingAgainstSettled(upcoming)
    if (cleaned !== upcoming) {
      upcoming = cleaned
      safePatch.upcomingMissions = cleaned
    }

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
    if (!this.data.missionSwipeOpenWxkey && !this.data.missionSwipeDragWxkey && !this.data.missionSwipeDragPx) {
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

  /** 刷新服务号自动提醒就绪态；铃铛仍只跟本任务小程序订阅走 */
  async _refreshOaAlertReady(force) {
    try {
      const ready = await isOaAlertReady(!!force)
      const patch = {}
      if (this.data.oaAlertReady !== ready) patch.oaAlertReady = ready
      if (this.data.launchData && this.data.launchData.id) {
        const nextSub = isSubscribed(this.data.launchData.id)
        if (this.data._countdownSubscribed !== nextSub) patch._countdownSubscribed = nextSub
      }
      if (Object.keys(patch).length) this.setData(patch)
      this._syncDisplayedUpcomingSwipeRowFlags()
    } catch (e) {}
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
  async unsubscribeReminderForMission(missionId, options) {
    if (!missionId) return false
    const silent = !!(options && options.silent)
    const ok = await unsubscribeLaunch(missionId)
    if (ok) {
      this._invalidatePageSubscribedIdSet()
      const mid = String(missionId)
      const cur = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      if (cur === mid) {
        this.setData({ _countdownSubscribed: false })
      }
      this._syncDisplayedUpcomingSwipeRowFlags()
      if (!silent) wx.showToast({ title: '提醒已关闭', icon: 'none' })
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
      const oaReady = !!(this.data.oaAlertReady || peekOaAlertReady())
      if (oaReady) {
        // 服务号已覆盖发射前与结果：遗留小程序结果订阅可关，否则仅提示
        if (isSubscribed(id)) {
          await this.unsubscribeReminderForMission(id, { silent: true })
          wx.showToast({ title: '已关闭本任务小程序结果订阅（服务号仍有效）', icon: 'none' })
        } else {
          wx.showToast({ title: '服务号已覆盖发射前与结果通知', icon: 'none' })
        }
        return
      }
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
    const sig =
      Array.isArray(chips) && chips.length
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
    let viewList = Array.isArray(list) ? list : []
    if (type === 'upcoming') {
      viewList = this._filterUpcomingAgainstSettled(viewList)
    }
    const updateData = buildMissionListViewUpdateData({
      activeMissionType: this.data.missionType,
      type,
      list: viewList
    })

    if (type === 'upcoming') {
      updateData.upcomingMissions = viewList
      this.applyUpcomingAgencyFilterToPatch(updateData, viewList)
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

  async fetchMissionList(type, limit = 50, offset = 0, options = {}) {
    const normalized = type === 'completed' ? 'completed' : 'upcoming'
    // 即将发射首屏/刷新：强制拉 recent_settled，与倒计时同拍；加载更多用内存缓存即可
    if (normalized === 'upcoming') {
      try {
        if (options && options.settledManagedByCaller) {
          // 首屏路径：云端快照由 loadInitialData 并行在拉，这里只等本地持久化快照
          // hydrate 完成（毫秒级），避免串行等 ll2Query 冷启动
          await this._hydrateRecentSettledFromStorage()
        } else {
          await this._ensureRecentSettledCache(offset === 0)
        }
      } catch (e) {}
    }
    const pack = await fetchMissionListData({
      type,
      limit,
      offset,
      getUpcomingMissions,
      getCompletedMissions,
      formatDate,
      filterExpiredMissions
    })
    if (normalized === 'upcoming' && Array.isArray(pack.list)) {
      pack.list = this._filterUpcomingAgainstSettled(pack.list)
    }
    return pack
  },

  /**
   * 优化后的初始数据加载：一次性加载倒计时和即将发射数据（使用同一个API）
   * 然后并行加载历史发射数据，避免重复API请求
   */
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
    let cache =
      options && options.cache && typeof options.cache === 'object' && !Array.isArray(options.cache)
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
    storageCache
      .warmAsync('mission_detail_cache', {})
      .then((raw) => {
        const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
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
      })
      .catch(() => {})
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
    const mission =
      collectMissionShareCandidates(this.data).find((item) => String(item && item.id) === String(resolved.id)) || null

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

    this.updateMissionDetailCacheEntries(
      [
        {
          id: resolved.id,
          detailType: resolved.detailType,
          mission,
          source: 'list'
        }
      ],
      { syncWrite: true }
    )
  },

  buildPrefetchedMissionDetail(mission, apiDetail) {
    const hasRecovery =
      apiDetail.boosterInfo &&
      (apiDetail.boosterInfo.configReusable === true ||
        (!apiDetail.boosterInfo.inferredRecovery &&
          (apiDetail.boosterInfo.landingType ||
            apiDetail.boosterInfo.landingLocation ||
            (typeof apiDetail.boosterInfo.landingDescription === 'string' &&
              apiDetail.boosterInfo.landingDescription.trim()))))
    const boosterInfo = hasRecovery ? apiDetail.boosterInfo : mission.boosterInfo || apiDetail.boosterInfo

    return {
      ...apiDetail,
      boosterInfo,
      isRecoverableThisMission: !!(
        boosterInfo &&
        (boosterInfo.configReusable === true ||
          (!boosterInfo.inferredRecovery &&
            (boosterInfo.landingType ||
              boosterInfo.landingLocation ||
              (typeof boosterInfo.landingDescription === 'string' && boosterInfo.landingDescription.trim()))))
      ),
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
      return typeof safeOptions.getCachedValue === 'function' ? safeOptions.getCachedValue() : safeOptions.cachedValue
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

  /**
   * 倒计时面板任务（窗口期状态机唯一入口）：
   * 窗口内未决挂住 → 未来 NET → 无未来时头条未决兜底；已落库任务绝不入选。
   * 权威状态记录（_launchRecordsById）优先于列表行残留字段。
   */
  _resolveCountdownPanelMission(upcomingList, now) {
    const list = Array.isArray(upcomingList) ? upcomingList : []
    const ts = now != null ? now : Date.now()
    const holdMissionId =
      this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
    const picked = pickCountdownDisplayMission(list, ts, {
      holdMissionId,
      recordsById: this._launchRecordsById
    })
    return { panelMission: picked, list }
  },

  /**
   * 重叠窗口副卡：仅当与主面板发射窗口相交时显示下一条未决任务。
   * 主卡落库并顶上后，按新主卡再查下一轮重叠；无重叠则副卡消失。
   */
  _buildOverlapSideCardState(now) {
    const ld = this.data.launchData
    const panelId = ld && ld.id != null ? String(ld.id) : ''
    if (!panelId || this.data.missionType !== 'upcoming') return null
    return pickOverlapSideCard(this.data.upcomingMissions || [], {
      panelMissionId: panelId,
      panelMission: ld,
      recordsById: this._launchRecordsById,
      now: now != null ? now : Date.now(),
      getCountdown,
      getStatusTextZh
    })
  },

  /** 同步副卡；返回可并入 setData 的补丁（无变化则空对象） */
  _buildOverlapSideCardPatch(now) {
    const next = this._buildOverlapSideCardState(now)
    const prev = this.data.overlapSideCard
    if (!next && !prev) return {}
    if (
      next &&
      prev &&
      String(prev.id) === String(next.id) &&
      prev.countdownText === next.countdownText &&
      prev.isExpired === next.isExpired &&
      prev.statusTextZh === next.statusTextZh &&
      prev.rocketImage === next.rocketImage
    ) {
      return {}
    }
    return { overlapSideCard: next }
  },

  _syncCountdownOverlapSideCard(now) {
    const patch = this._buildOverlapSideCardPatch(now)
    if (Object.keys(patch).length) this.setData(patch)
  },

  applyInitialUpcomingLaunchState(firstMission, upcomingList, upcomingRes) {
    this._upcomingStateGeneration = (this._upcomingStateGeneration || 0) + 1
    const now = Date.now()
    const rawList =
      Array.isArray(upcomingList) && upcomingList.length ? upcomingList : firstMission ? [firstMission] : []

    this._absorbLaunchStateObservations(rawList, 'list')
    const projected = this._projectAuthoritativeLaunchState(rawList, this.data.completedMissions, now)
    const list = projected.upcoming
    // 始终尝试 merge：冷启动时 rawList 往往已被 filter 掉终态，projected.completed 长度不变，
    // 旧逻辑会跳过 merge，导致 48h 占位卡插不进历史。
    const settledSource =
      Array.isArray(this._recentSettledCache) && this._recentSettledCache.length
        ? this._recentSettledCache
        : Array.from(this._launchRecordsById.values())
    const completedMerged = this._mergeRecentSettledIntoCompletedList(projected.completed, settledSource)
    const completedMerge =
      completedMerged !== projected.completed ||
      projected.completed.length !== (this.data.completedMissions || []).length
        ? completedMerged
        : null

    try {
      this._kickQuietSettlePastNetUpcoming(list, now)
    } catch (e) {}

    const { panelMission } = this._resolveCountdownPanelMission(list, now)
    if (!panelMission) {
      const emptyState = buildUpcomingLaunchEmptyState({
        message: '暂无即将发射的任务',
        upcomingListState: buildMissionListSetData(
          'upcoming',
          [],
          { nextOffset: 0, hasMore: false },
          filterExpiredMissions
        )
      })
      if (completedMerge) emptyState.completedMissions = completedMerge
      this.applyUpcomingAgencyFilterToPatch(emptyState, [])
      this.setData(emptyState, () => {
        this.scheduleUpcomingAgencyChipsOverflowHint()
        if (completedMerge) {
          try {
            this.updateMissionListView('completed', completedMerge)
          } catch (e2) {}
        }
      })
      this.resetVoteData()
      return
    }

    // 防御：面板 id 绝不能是已可落库（peel 后理论上不会）
    if (panelMission.id != null && this._isKnownSettleableId(panelMission.id)) {
      const emptyState = buildUpcomingLaunchEmptyState({
        message: '暂无即将发射的任务',
        upcomingListState: buildMissionListSetData('upcoming', list, upcomingRes, filterExpiredMissions)
      })
      if (completedMerge) emptyState.completedMissions = completedMerge
      this.applyUpcomingAgencyFilterToPatch(emptyState, list)
      this.setData(emptyState, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      this.resetVoteData()
      return
    }

    const curId = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
    const panelId = panelMission.id != null ? String(panelMission.id) : ''
    // 倒计时已停在已可落库任务上 → 禁止 early-return 保旧面板
    const curSettleable = curId && this._isKnownSettleableId(curId)
    if (!curSettleable && curId && panelId && curId === panelId && this.data.launchData.launchTime) {
      const listPatch = {
        ...buildMissionListSetData('upcoming', list, upcomingRes, filterExpiredMissions),
        showMissionsEmpty: this.data.missionType === 'upcoming' ? list.length === 0 : this.data.showMissionsEmpty
      }
      if (completedMerge) listPatch.completedMissions = completedMerge
      this.applyUpcomingAgencyFilterToPatch(listPatch, listPatch.upcomingMissions)
      this.setData(listPatch, () => {
        this.syncCalendarFromMissionListsIfNeeded()
        this._syncCountdownOverlapSideCard()
        if (this.data.missionType === 'upcoming') {
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
        if (completedMerge) {
          try {
            this.updateMissionListView('completed', completedMerge)
          } catch (e3) {}
        }
      })
      this._upcomingAgencyEnrichGen = (this._upcomingAgencyEnrichGen || 0) + 1
      const enrichGen = this._upcomingAgencyEnrichGen
      enrichMissionsLaunchAgencyImages(list)
        .then((enriched) => {
          if (enrichGen !== this._upcomingAgencyEnrichGen) return
          const nextList = enriched || list
          if (!this._upcomingAgencyLogoFieldsChanged(list, nextList)) return
          const fm = this._resolveCountdownPanelMission(nextList, Date.now()).panelMission || panelMission
          this._patchUpcomingListAfterAgencyEnrich(fm, nextList, upcomingRes)
        })
        .catch(() => {})
      return
    }

    this._upcomingAgencyEnrichGen = (this._upcomingAgencyEnrichGen || 0) + 1
    const enrichGen = this._upcomingAgencyEnrichGen
    const baselineList = list

    this._applyInitialUpcomingLaunchStateSync(panelMission, baselineList, upcomingRes, {
      completedMissions: completedMerge
    })

    enrichMissionsLaunchAgencyImages(baselineList)
      .then((enriched) => {
        if (enrichGen !== this._upcomingAgencyEnrichGen) return
        const nextList = this._filterUpcomingAgainstSettled(enriched || baselineList)
        const fm = this._resolveCountdownPanelMission(nextList, Date.now()).panelMission
        if (!fm) {
          const emptyState = buildUpcomingLaunchEmptyState({
            message: '暂无即将发射的任务',
            upcomingListState: buildMissionListSetData(
              'upcoming',
              [],
              { nextOffset: 0, hasMore: false },
              filterExpiredMissions
            )
          })
          this.applyUpcomingAgencyFilterToPatch(emptyState, [])
          this.setData(emptyState, () => this.scheduleUpcomingAgencyChipsOverflowHint())
          this.resetVoteData()
          return
        }
        if (!this._upcomingAgencyLogoFieldsChanged(baselineList, nextList)) return
        this._patchUpcomingListAfterAgencyEnrich(fm, nextList, upcomingRes)
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
    // 权威状态投影：enrich 回写不得把缓存残留的旧状态（如已成功任务的 Go）带回列表
    const projectedUpcoming = this._projectAuthoritativeLaunchState(
      mergedList,
      this.data.completedMissions,
      Date.now()
    ).upcoming
    const projectedIds = new Set(projectedUpcoming.map((m) => String(m.id)))
    const overlaidList = mergedList
      .filter((m) => m && m.id != null && projectedIds.has(String(m.id)))
      .map((m) => projectedUpcoming.find((p) => String(p.id) === String(m.id)) || m)
    const peeled = this._peelKnownSettleableFromUpcoming(overlaidList)
    const safeList = peeled.upcoming

    const extraState = buildMissionReadyState({
      ...buildMissionListSetData('upcoming', safeList, upcomingRes, filterExpiredMissions),
      showMissionsEmpty: this.data.missionType === 'upcoming' ? safeList.length === 0 : this.data.showMissionsEmpty
    })
    if (peeled.completedAdds.length) {
      const addIds = new Set(peeled.completedAdds.map((c) => String(c.id)))
      extraState.completedMissions = peeled.completedAdds.concat(
        (this.data.completedMissions || []).filter((m) => m && m.id != null && !addIds.has(String(m.id)))
      )
    }
    this.applyUpcomingAgencyFilterToPatch(extraState, extraState.upcomingMissions)
    if (Array.isArray(extraState.displayedUpcomingMissions)) {
      extraState.displayedUpcomingMissions = mergePreservedRocketImages(
        extraState.displayedUpcomingMissions,
        prevDisplayed
      )
    }

    const now = Date.now()
    const fmId = firstMission && firstMission.id != null ? String(firstMission.id) : ''
    let panelMission =
      this._resolveCountdownPanelMission(safeList, now).panelMission ||
      safeList.find((m) => m && String(m.id) === fmId) ||
      null
    if (panelMission && panelMission.id != null && this._isKnownSettleableId(panelMission.id)) {
      panelMission = null
    }
    if (!panelMission) {
      this.setData(extraState, () => {
        try {
          this._scrubKnownSettleableCountdown()
        } catch (e) {}
        if (extraState.completedMissions) {
          try {
            this.updateMissionListView('completed', extraState.completedMissions)
          } catch (e2) {}
        }
      })
      return
    }
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
        this._syncCountdownOverlapSideCard()
        if (this.data.missionType === 'upcoming') {
          this._scheduleMissionCardMeasurement(true)
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
        if (extraState.completedMissions) {
          try {
            this.updateMissionListView('completed', extraState.completedMissions)
          } catch (e) {}
        }
        try {
          this.syncLaunchPanelRocketImageWithUpcomingList()
        } catch (e) {}
      }
    )
  },

  /**
   * 首屏/刷新即将发射列表写入；与已剥离的历史卡同一拍 setData，避免倒计时先闪已落库任务。
   * @param {{ completedMissions?: Array|null }} options
   */
  _applyInitialUpcomingLaunchStateSync(firstMission, upcomingList, upcomingRes, options) {
    const safeOptions = options || {}
    const extraState = buildMissionReadyState({
      ...buildMissionListSetData('upcoming', upcomingList, upcomingRes, filterExpiredMissions),
      showMissionsEmpty: this.data.missionType === 'upcoming' ? upcomingList.length === 0 : this.data.showMissionsEmpty
    })
    if (Array.isArray(safeOptions.completedMissions)) {
      extraState.completedMissions = safeOptions.completedMissions
    }
    this.applyUpcomingAgencyFilterToPatch(extraState, extraState.upcomingMissions)

    this.setData(
      {
        ...buildCurrentLaunchPanelState({
          mission: firstMission,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet(),
          extraState
        })
      },
      () => {
        this.syncCalendarFromMissionListsIfNeeded()
        this._syncCountdownOverlapSideCard()
        if (this.data.missionType === 'upcoming') {
          this._resetMissionCardHaptics()
          this._scheduleMissionCardMeasurement(true)
          this.scheduleUpcomingAgencyChipsOverflowHint()
        }
        if (Array.isArray(safeOptions.completedMissions)) {
          try {
            this.updateMissionListView('completed', safeOptions.completedMissions)
          } catch (e) {}
        }
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
            this._syncCountdownOverlapSideCard()
          })
      }
    )

    this.applyLaunchSwitchEffects(firstMission)
  },

  // ========== 结算→历史列表合并域（recent_settled 缓存/角标覆盖/补插/详情回写）：见 ./utils/index-settled-merge.js ==========
  ...settledMergeMethods,

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
      upcomingListState: buildMissionListSetData(
        'upcoming',
        [],
        { nextOffset: 0, hasMore: false },
        filterExpiredMissions
      ),
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
    return type === 'completed' ? this.data.completedMissions || [] : this.data.upcomingMissions || []
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
      .map((type) => (type === 'completed' ? 'completed' : type === 'upcoming' ? 'upcoming' : ''))
      .filter(Boolean)
    const uniqueTypes = normalizedTypes.filter((type, index) => normalizedTypes.indexOf(type) === index)

    return uniqueTypes.filter((type) => {
      // 免费首屏跳过 previous 预拉后：completed 可能已有 settled 剥离瘦卡，
      // 不能仅凭 length>0 当作「云列表已就绪」，否则历史 Tab 永远只显示瘦卡。
      if (type === 'completed' && !this._completedCloudListReady) return true
      const list = this.getMissionListByType(type)
      return !Array.isArray(list) || list.length === 0
    })
  },

  /** 列表拉取条数：Pro/会员关用 50；免费与展示门控对齐 */
  _getMissionListFetchLimit() {
    if (canUsePaidCloudSync()) return 50
    const freeLimit = getMemberPolicySync().freeMissionListLimit || FREE_MISSION_LIST_LIMIT
    return freeLimit
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

    if (payload && Array.isArray(payload.upcomingMissions) && payload.upcomingMissions.length > 0) {
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

    const fetchLimit = this._getMissionListFetchLimit()
    const results = await Promise.all(
      missingTypes.map((type) => this.fetchMissionList(type, fetchLimit, 0))
    )

    // 历史列表必须走 handleCompletedMissionLoadSuccess（snapshot/剥离/角标），
    // 不能只 setData 瘦列表——免费用户首屏不预拉后，进历史 Tab 会走本路径。
    const completedIdx = missingTypes.indexOf('completed')
    if (completedIdx >= 0) {
      const completedPack = results[completedIdx] || {}
      this.handleCompletedMissionLoadSuccess(
        completedPack.list || [],
        completedPack.res || {}
      )
    }

    const otherTypes = []
    const otherResults = []
    for (let i = 0; i < missingTypes.length; i++) {
      if (missingTypes[i] === 'completed') continue
      otherTypes.push(missingTypes[i])
      otherResults.push(results[i])
    }
    if (!otherTypes.length) return

    const updateData = this.buildMissionListReadyState(otherResults, otherTypes)
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
      ...buildMissionListSetData(
        type,
        merged,
        {
          nextOffset: getMissionNextOffset(res, offset),
          hasMore: isEmptyPage ? false : !!res.hasMore
        },
        filterExpiredMissions
      )
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
            ...buildMissionListSetData(
              'completed',
              merged,
              {
                nextOffset:
                  nextState.completedMissionsOffset != null
                    ? nextState.completedMissionsOffset
                    : this.data.completedMissionsOffset,
                hasMore:
                  nextState.completedMissionsHasMore != null
                    ? nextState.completedMissionsHasMore
                    : this.data.completedMissionsHasMore
              },
              filterExpiredMissions
            )
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
    this.setData(
      buildLoadMoreFallbackState({
        isUpcoming: type === 'upcoming',
        noMoreData
      })
    )
  },

  finishLoadMoreMissions() {
    this._loadingMoreLock = false
  },





  async loadInitialData(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh
    // 下拉刷新时已有原生刷新指示器，不再叠加“加载中”toast
    const suppressLoading = !!safeOptions.suppressLoading

    // 用户显式刷新：清 5min 内存快照 + 列表探云节流，保证立刻打到云库
    // （静默停留时的后台探云已改为 15 分钟，见 api-request LAUNCH_LIST_BG_CHECK_INTERVAL）
    if (forceRefresh) {
      try {
        invalidateListSnapshots()
      } catch (eInv) {}
      try {
        forceLaunchListCloudBgCheck()
      } catch (eForce) {}
    }

    return this.runManagedPageRequest(
      '_loadInitialDataPromise',
      async () => {
        const stateGeneration = this._beginLaunchStateGeneration()
        try {
          if (getApp()._splashShownThisSession && !suppressLoading) {
            wx.showLoading({ title: '加载中...' })
          }

          // 媒体映射与列表接口并行；首屏仍有 2.5s 预算，超时后继续渲染，map 就绪后再统一刷新三处图
          // 非会员只拉免费额度（与展示门控 / 后台 freeMissionListLimit 一致）
          const fullCloud = canUsePaidCloudSync()
          const freeMissionLimit = getMemberPolicySync().freeMissionListLimit || FREE_MISSION_LIST_LIMIT
          const FULL_LIMIT = fullCloud ? 50 : freeMissionLimit

          // recent_settled 云端快照与列表并行发起（旧实现串行 await，ll2Query 冷启动
          // 直接把首屏拖到数秒）；列表过滤先用本地持久化快照兜底。
          // 预算计时与列表/媒体等待同时开跑：首屏最坏 ≈ max(列表, 2.5s 媒体, 2s 快照)
          const settledPromise = this._ensureRecentSettledCache(true).catch(() => null)
          const settledFirstPaintWait = Promise.race([
            settledPromise,
            new Promise((resolve) => setTimeout(resolve, RECENT_SETTLED_FIRST_PAINT_BUDGET_MS))
          ])

          const [, pack] = await Promise.all([
            Promise.race([
              loadCloudMediaMap().catch(() => {}),
              new Promise((r) => setTimeout(r, LOAD_CLOUD_MEDIA_MAP_FIRST_PAINT_BUDGET_MS))
            ]),
            Promise.race([
              this.fetchMissionList('upcoming', FULL_LIMIT, 0, { settledManagedByCaller: true }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('加载超时，请稍后再试')), 15000))
            ])
          ])
          let { res: upcomingRes, list: upcomingList } = pack

          // 本地快照新鲜（10 分钟内）→ 不等云端直接上屏；过期/缺失才等，且最多 2s。
          // 云端快照迟到时由下方后台补偿逻辑二次修正（scrub + 重过滤）。
          const settledFresh =
            Array.isArray(this._recentSettledCache) &&
            this._recentSettledCacheAt &&
            Date.now() - this._recentSettledCacheAt < RECENT_SETTLED_MEM_TTL_MS
          if (!settledFresh) {
            await settledFirstPaintWait
          }
          if (!this._isLaunchStateGenerationCurrent(stateGeneration)) return
          upcomingList = this._filterUpcomingAgainstSettled(upcomingList || [])

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

          // ── 首屏后台补偿（旧实现在上屏前串行等待，最多 +3s）──
          // 1) 云端 recent_settled 迟到：scrub 倒计时 + 重过滤即将发射 + 补插历史占位
          //    （hide_recent 后列表里已没有该 id，仅 peel/refilter 补不进 completed）
          settledPromise
            .then(async (settled) => {
              if (!this._isLaunchStateGenerationCurrent(stateGeneration)) return
              if (!Array.isArray(settled) || !settled.length) return
              try {
                this._scrubKnownSettleableCountdown()
              } catch (e) {}
              try {
                this._refilterUpcomingAgainstSettled()
              } catch (e2) {}
              try {
                await this._applyRecentSettledToCompletedList(false)
              } catch (e3) {}
            })
            .catch(() => {})
          // 2) 按 id 状态快照（NET 改期 / 状态变化）：走实况 patch 路径整体修正列表与面板。
          // 延迟 3s 发起：避免与「上屏后立刻点卡片进详情」的 fetchLaunchDetail 并发抢
          // ll2Query 实例（并发会摊上冷启动实例，拖慢详情页首包）
          const snapshotIds = (upcomingList || []).map((mission) => mission && mission.id).filter(Boolean)
          if (snapshotIds.length) {
            new Promise((resolve) => setTimeout(resolve, 3000))
              .then(() => {
                if (!this._isLaunchStateGenerationCurrent(stateGeneration)) return null
                return fetchLaunchStatusSnapshot(snapshotIds)
              })
              .then((rows) => {
                if (!this._isLaunchStateGenerationCurrent(stateGeneration)) return
                if (!Array.isArray(rows) || !rows.length) return
                this._patchUpcomingListLiveStatuses(rows)
                // 面板任务 NET 比列表缓存新（快照来自小时级探针）：重建倒计时面板
                try {
                  const curId =
                    this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
                  const row = curId ? rows.find((r) => r && String(r.id) === curId) : null
                  const sid = row && row.status && row.status.id != null ? Number(row.status.id) : 0
                  if (row && row.net && !isSettledStatusId(sid)) {
                    const newMs = new Date(row.net).getTime()
                    const curMs = new Date(this.data.launchData.launchTime || 0).getTime()
                    if (Number.isFinite(newMs) && newMs > 0 && newMs !== curMs) {
                      this._applyPostponedNet(row)
                    }
                  }
                } catch (eNet) {}
              })
              .catch(() => {})
          }

          // DB media_assets 真正加载完成后（即便 race 已超时）再刷新一次列表+倒计时火箭图
          loadCloudMediaMap()
            .then(() => {
              try {
                this._refreshRocketImagesFromMediaMap()
              } catch (e) {}
            })
            .catch(() => {})

          try {
            this._preloadVisibleRocketImages(upcomingList, fullCloud ? 8 : freeMissionLimit)
          } catch (e) {}

          // A：免费用户不预拉 previous（分批读是库请求大头）。
          // Pro / 会员功能关闭：仍后台预拉，保证历史 Tab / 日历 hydrate 立即可用。
          // settled 剥离瘦卡仍可写入 completedMissions；云母列表等切到历史或历史下拉再拉。
          if (fullCloud) {
            this.fetchMissionList('completed', FULL_LIMIT, 0)
              .then(({ res, list }) => {
                this.handleCompletedMissionLoadSuccess(list, res)
              })
              .catch((error) => {
                this.handleCompletedMissionLoadError(error)
              })
          }
        } catch (error) {
          wx.hideLoading()
          this.handleInitialUpcomingLoadError(error)
        }
      },
      {
        allowReuse: !forceRefresh
      }
    )
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
   * 加载当前 tab 的任务列表（仅在缺失时补拉）
   */
  async loadMissions() {
    if (this.data.missionType === 'calendar') return

    const activeType = this.getActiveMissionListType()
    const currentList = this.getMissionListByType(activeType)
    // 历史列表：必须等云母文档拉过（_completedCloudListReady），不能被 settled 瘦卡短路
    const cloudReady = activeType !== 'completed' || !!this._completedCloudListReady
    if (cloudReady && Array.isArray(currentList) && currentList.length > 0) {
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
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (e) {}
  },

  _vibrateMedium() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      try {
        wx.vibrateShort()
      } catch (err) {}
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
    const firstCardCenter = metrics.firstOffset + (metrics.cardHeight || metrics.pitch) / 2

    let nextIndex = Math.round((scrollTop + anchorOffset - firstCardCenter) / metrics.pitch)
    if (nextIndex < 0) nextIndex = 0
    if (nextIndex > metrics.cardCount - 1) nextIndex = metrics.cardCount - 1
    return nextIndex
  },

  _syncMissionCardHapticIndex(scrollTop) {
    const focusIndex = this._getMissionCardFocusIndex(
      typeof scrollTop === 'number' ? scrollTop : this._getMissionListScrollTop()
    )
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

          const currentScrollTop =
            typeof scrollTopOverride === 'number' ? scrollTopOverride : this._getMissionListScrollTop()
          const firstRect = cardRects[0]
          const secondRect = cardRects[1]
          const fallbackGap = this._rpxToPx(20)
          const pitch =
            secondRect && secondRect.top > firstRect.top
              ? secondRect.top - firstRect.top
              : (firstRect.height || 0) + fallbackGap

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
    const sideCardPatch = this._buildOverlapSideCardPatch()
    // 卡片倒计时与主倒计时相互独立：主倒计时的任何 early-return 都不能丢卡片补丁
    const flushCardCountdownPatch = () => {
      const merged = { ...cardCountdownPatch, ...sideCardPatch }
      if (Object.keys(merged).length) {
        this.setData(merged)
      }
    }

    if (!this.data.launchData.launchTime) {
      flushCardCountdownPatch()
      return
    }

    // 已可落库却仍停在倒计时：同拍切走（过点就绪未决不在此打断，交给探针）
    const ld = this.data.launchData
    if (ld && ld.id != null && this._isKnownSettleableId(ld.id)) {
      flushCardCountdownPatch()
      try {
        this._scrubKnownSettleableCountdown()
      } catch (e) {}
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
    // 秒位滚动 + 卡片 countdown + 重叠副卡 合并为一次 setData
    const immediateState = {
      ...(tickState.immediateState || {}),
      ...cardCountdownPatch,
      ...sideCardPatch
    }
    this.setData(immediateState)
    this._countdownSecondsRollTimer = setTimeout(() => {
      this.setData(tickState.settleState)
      this._countdownSecondsRollTimer = null
    }, 540)
  },

  /**
   * 切换倒计时到下一个未过期的任务（从已加载的列表中取，无需重新请求）
   * 当前任务仍在发射窗口内且未决时禁止因「有下一条未来任务」切走。
   * 落库/显式切换（_switchingCountdown 或 options.force）不受窗口挂住拦截——
   * _moveMissionToCompleted 的 setData 尚未回写时，列表里仍是旧「就绪」，否则会误挡。
   */
  switchToNextUpcomingMission(options) {
    const force = !!(options && options.force) || !!this._switchingCountdown
    const currentId = this.data.launchData && this.data.launchData.id
    const missions = this.data.upcomingMissions || []
    const now = Date.now()
    const current =
      currentId != null
        ? missions.find((m) => m && String(m.id) === String(currentId))
        : null
    const currentRecord =
      currentId != null && this._launchRecordsById ? this._launchRecordsById.get(String(currentId)) || null : null
    if (!force && current && shouldHoldPastNetCountdownMission(current, now, currentRecord)) {
      this._switchingCountdown = false
      return
    }

    const filtered = filterExpiredMissions(missions)
    if (filtered.length !== missions.length) {
      const patch = { upcomingMissions: filtered }
      this.applyUpcomingAgencyFilterToPatch(patch)
      this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
    }

    const next = getNextUpcomingLaunch(filtered, currentId, now)

    if (next) {
      this.setData(
        buildCurrentLaunchPanelState({
          mission: next,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet()
        }),
        () => {
          this._syncCountdownOverlapSideCard()
          Promise.resolve(loadCloudMediaMap())
            .catch(() => {})
            .finally(() => {
              this.refreshLaunchPanelRocketImageUrl()
              this.syncLaunchPanelRocketImageWithUpcomingList()
              this._syncCountdownOverlapSideCard()
            })
        }
      )
      this.applyLaunchSwitchEffects(next, { shouldSkipVoteCache: true })
    } else if (this.data.overlapSideCard) {
      this.setData({ overlapSideCard: null })
    }
    this._switchingCountdown = false
  },

  // ══════════════════════════════════════════════════════════════
  // 倒计时到点：实时状态确认（代替盲目切换），节奏由窗口期状态机决策
  // T-0 后面板先显示「状态确认中」，NET+10m 首查、窗口内 3m 复查：
  // 成功/失败/部分失败/载荷已部署/飞行中 → 落历史并切换；
  // 推迟/就绪/待确认等未决 → 展示实况并复查；NET 推后则恢复倒计时；
  // windowEnd（无窗口则 NET+30m）到点 bestEffort，无结果则 15m 慢探（禁止无状态裸切）。
  // 热路径：仅当前倒计时任务可走 /updates/ 社媒终态旁路（有云缓存）；
  // 历史任务发射动态靠 6h slim 拆分的 updates_{uuid} 冷路径。
  // ══════════════════════════════════════════════════════════════

  /**
   * 倒计时到期入口（每秒 tick 都可能进来，需防重入 + 节流）。
   * 探针动作由窗口期状态机决策：
   *   wait      → T-0 定格面板，NET+10m 首查（LL2 状态滞后）
   *   probeById → 窗口内立即进入复查循环（3 分钟间隔）
   *   bestEffort/slowProbe → 窗口（+宽限）已过：bestEffort 落库；未决则 15 分钟慢探
   */
  _onCountdownExpired() {
    if (this._launchStatusPolling) return
    const now = Date.now()
    if (now - (this._lastExpiredRoundAt || 0) < LIVE_STATUS_MIN_ROUND_GAP_MS) return
    this._lastExpiredRoundAt = now

    const ld = this.data.launchData
    const currentId = ld && ld.id != null ? String(ld.id) : ''
    if (!currentId) return

    // 计时基准始终为任务 NET（状态机由 NET/windowEnd 纯推导），离开页面再回来不重置
    const record = this._launchRecordsById ? this._launchRecordsById.get(currentId) || null : null
    const probe = nextProbeAction(ld, record, now)

    // 已可落库 / 窗口（+宽限）已过：bestEffort 查终态并落库；无结果则挂起慢探（不裸切）
    if (probe.action === 'settle' || probe.action === 'bestEffort' || probe.action === 'slowProbe') {
      this._launchStatusPolling = true
      this._settleExpiredLaunchWithBestEffort(currentId)
      return
    }

    // PRE_WINDOW（none）：权威记录已把 NET 推到未来而面板字段尚未回写（改期），
    // 直接应用新 NET 恢复倒计时，不定格面板、不发探针
    if (probe.action === 'none') {
      const recNetMs = record && record.net ? new Date(record.net).getTime() : 0
      if (recNetMs && recNetMs > now + 60 * 1000) {
        this._applyPostponedNet({ id: currentId, net: record.net, status: record.status, name: record.name })
        return
      }
      // 距 T-0 不足 1 分钟：等自然过点，下轮再判
      if (recNetMs && recNetMs > now) return
      // 走到这里说明有效 NET 缺失/非法（面板与记录都没有可用时间）：
      // 不能直接放弃，落到常规探针拿回真实 NET/状态自愈
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
    // wait：距 NET+10m 首查的剩余时间；probeById：立即查
    const firstCheckDelay = probe.action === 'wait' ? probe.delayMs : 0
    if (this._statusRecheckTimer) clearTimeout(this._statusRecheckTimer)
    this._statusRecheckTimer = setTimeout(() => {
      this._statusRecheckTimer = null
      this._checkLiveLaunchStatus(currentId)
    }, firstCheckDelay)
  },

  /** 读 recent_settled 中该 id 的可 settle 行（终态或飞行中；优先内存缓存） */
  async _lookupRecentSettledRow(currentId) {
    try {
      const settled = await this._ensureRecentSettledCache(false)
      if (!Array.isArray(settled)) return null
      const hit = settled.find((s) => s && String(s.id) === currentId && s.status)
      if (!hit) return null
      const sid = hit.status && hit.status.id != null ? Number(hit.status.id) : 0
      if (!isSettleableLiveStatusId(sid)) return null
      return { id: hit.id, name: hit.name || '', status: hit.status, net: hit.net || '' }
    } catch (e) {
      return null
    }
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
      query
        .select('.content-scroll')
        .scrollOffset((res) => {
          if (res) {
            const currentScrollTop = res.scrollTop
            const mt = this.data.missionType
            const scrollField = getMissionScrollTopField(mt)
            this.setData({ [scrollField]: currentScrollTop })
          }
        })
        .exec()
    }

    const switchState = buildMissionTypeSwitchState(this.data, type)
    const targetScrollTop = switchState.targetScrollTop
    const prevType = this.data.missionType

    // 离开即将发射：停轮播定时器与视频（历史/日历不展示轮播）
    if (prevType === 'upcoming' && type !== 'upcoming') {
      try {
        this._stopCarouselTimer()
        this._stopCarouselVideo(this.data.carouselCurrent || 0)
      } catch (e) {}
    }

    this.setData({
      missionType: switchState.missionType,
      showMissionsEmpty: switchState.showMissionsEmpty,
      showCompactCountdown: switchState.showCompactCountdown,
      _scrollTop: switchState._scrollTop
    })

    wx.nextTick(() => {
      setTimeout(() => {
        this.setData(
          {
            _scrollTop: targetScrollTop,
            isSwitchingTab: false
          },
          () => {
            if (type !== 'calendar') {
              this._scheduleMissionCardMeasurement(true)
            }
            if (type === 'upcoming') this.scheduleUpcomingAgencyChipsOverflowHint()
          }
        )
      }, 100)
    })

    if (type === 'calendar') {
      this.loadCalendarData(true)
      this.loadLaunchStats()
    } else {
      if (type === 'upcoming') {
        // 先剥离已在历史的任务，再刷新视图（避免 loadMissions 用旧列表画出就绪）
        try {
          this._refilterUpcomingAgainstSettled()
        } catch (e) {}
        // 回到即将发射：恢复轮播播控
        if (this.data.carouselItems && this.data.carouselItems.length > 0) {
          try {
            this._activateCarouselVideos(this.data.carouselCurrent || 0)
            this._startCarouselTimer()
          } catch (e) {}
        }
      }
      this.loadMissions()
      // 历史 Tab：仅在云母列表已就绪时轻量刷 settled 角标。
      // 未就绪时 loadMissions→handleCompleted 会合并 settled；若此处并行 _apply，
      // 会用剥离瘦卡快照盖掉完整 previous（A 之后免费首进历史必现该竞态）。
      if (type === 'completed' && this._completedCloudListReady) {
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

    try {
      const { pulseNasaFloatOnScroll } = require('../../utils/nasa-float-scroll.js')
      pulseNasaFloatOnScroll(this)
    } catch (err) {}

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
    this._scrollFrameTimer = setTimeout(
      () => {
        this._scrollFrameTimer = null
        this._scrollLastRunAt = Date.now()
        this._processScrollFrame()
      },
      Math.max(0, remaining)
    )
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
    const hasMore =
      this.data.missionType === 'upcoming' ? this.data.missionsHasMore : this.data.completedMissionsHasMore

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
      url: context.navigation.url,
      success: (res) => {
        // 快照经 eventChannel 直达详情页做首屏加速；storage 快照保留作分享冷启动兜底
        try {
          if (res && res.eventChannel && context.mission) {
            res.eventChannel.emit('missionSnapshot', context.mission)
          }
        } catch (err) {}
      }
    })
  },

  /**
   * 规范化助推器信息：避免展示内部ID，并尽量从描述中提取序列号/飞行次数
   */
  normalizeBoosterInfo(boosterInfo, detailSource = {}) {
    if (!boosterInfo || typeof boosterInfo !== 'object') return boosterInfo

    const normalized = { ...boosterInfo }
    const textPool = [
      normalized.landingDescription || '',
      (detailSource.missionFull && detailSource.missionFull.description) ||
        detailSource.missionDetails ||
        detailSource.description ||
        '',
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
        detailSource.launcherLanding &&
          detailSource.launcherLanding.general &&
          detailSource.launcherLanding.general.flights
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

  /** 重叠窗口副卡 — 点击进详情 */
  onOverlapSideCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.viewMissionDetail(e)
  },

  _clearCountdownChannelsLivePoll() {
    if (this._channelsLivePollTimer) {
      clearTimeout(this._channelsLivePollTimer)
      this._channelsLivePollTimer = null
    }
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
   * 倒计时卡片 — 助推器行「详情」按钮：按序列号（如 B1090）跳该箭实体详情页
   */
  async onGoBoosterDetail() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    const launch = this.data.launchData || {}
    const serial = String((launch.boosterInfo && launch.boosterInfo.serialNumber) || '').trim()
    const { openBoosterEntityDetail } = require('../../utils/booster-nav.js')
    await openBoosterEntityDetail(serial)
  },

  /**
   * 倒计时卡片 — 发射商行「详情」按钮：跳发射商详情页（id 优先，缺失时用缩写解析）
   */
  async onGoAgencyDetail() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
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
      const oaReady = !!(this.data.oaAlertReady || peekOaAlertReady())
      if (oaReady) {
        // 服务号已覆盖发射前与结果：遗留小程序结果订阅可关，否则仅提示
        if (isSubscribed(launch.id)) {
          await this.unsubscribeReminderForMission(launch.id, { silent: true })
          wx.showToast({ title: '已关闭本任务小程序结果订阅（服务号仍有效）', icon: 'none' })
        } else {
          wx.showToast({ title: '服务号已覆盖发射前与结果通知', icon: 'none' })
        }
        return
      }
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
    const listKey =
      missionType === 'upcoming' ? 'upcomingMissions' : isCalendar ? 'calendarAllMissions' : 'completedMissions'
    const missions = isCalendar
      ? this.data.expandedDateMissions || []
      : missionType === 'upcoming'
        ? this.data.displayedUpcomingMissions || []
        : this.data.completedMissions || []

    if (!missions || !missions[index]) return
    const mission = missions[index]
    const failedImage = mission.rocketImage
    const rocketName = mission.rocketName

    if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
      markDownloadFailed(String(failedImage).trim(), 404)
    }

    const fallbackDefault = resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE, rocketName, mission.rocketConfiguration)
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
    const fuzzyMatchImage = resolveMissionRocketImage(failedImage, rocketName, mission.rocketConfiguration, true)

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
      runPullRefresh(
        this,
        async () => {
          try {
            invalidateListSnapshots()
            forceLaunchListCloudBgCheck()
            const pack = await this.fetchMissionList(
              'completed',
              this._getMissionListFetchLimit(),
              0
            )
            this.handleCompletedMissionLoadSuccess(pack.list || [], pack.res || {})
          } catch (e) {
            await this._applyRecentSettledToCompletedList(true)
          }
        },
        key
      )
      return
    }
    if (this.data.missionType !== 'upcoming') {
      if (key) {
        this.setData({ [key]: false })
      } else {
        try {
          wx.stopPullDownRefresh()
        } catch (e) {}
      }
      return
    }
    runPullRefresh(
      this,
      () => this.loadInitialData({ suppressLoading: true, forceRefresh: true }),
      key
    )
  },

  /** 倒计时圆图节日帽：与星问同源日期；开发模式轮播预览 */
  _syncFestivalHat() {
    const list = listFestivalHats()
    if (isFestivalHatDevMode()) {
      if (!this._festivalHatDevIdx && this._festivalHatDevIdx !== 0) this._festivalHatDevIdx = 0
      const id = (list[this._festivalHatDevIdx] && list[this._festivalHatDevIdx].id) || (list[0] && list[0].id) || ''
      if (id !== this.data.festivalHat) this.setData({ festivalHat: id })
      this._startFestivalHatDevCycle()
      return
    }
    this._stopFestivalHatDevCycle()
    const id = resolveFestivalHatId(new Date()) || ''
    if (id !== (this.data.festivalHat || '')) this.setData({ festivalHat: id })
  },

  _startFestivalHatDevCycle() {
    this._stopFestivalHatDevCycle()
    const list = listFestivalHats()
    if (!list.length) return
    this._festivalHatDevTimer = setInterval(() => {
      if (!isFestivalHatDevMode()) {
        this._stopFestivalHatDevCycle()
        return
      }
      const next = ((this._festivalHatDevIdx || 0) + 1) % list.length
      this._festivalHatDevIdx = next
      const id = list[next] && list[next].id
      if (id) this.setData({ festivalHat: id })
    }, DEV_CYCLE_MS)
  },

  _stopFestivalHatDevCycle() {
    if (this._festivalHatDevTimer) {
      clearInterval(this._festivalHatDevTimer)
      this._festivalHatDevTimer = null
    }
  },

  onHide() {
    this._stopFestivalHatDevCycle()
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
    // 开屏任务倒计时同样停表（_resumeSplashTimer 会按绝对时间重启）
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
      this._splashTimerPaused = true
    }
    // 视频 12 秒硬上限：停表，回前台由 _resumeSplashTimer 按剩余墙钟续跑
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
      this._splashTimerPaused = true
    }
    if (this._splashVideoForcePlayTimer) {
      clearTimeout(this._splashVideoForcePlayTimer)
      this._splashVideoForcePlayTimer = null
    }
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = null
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











  /**
   * 本地命中后后台探云发现发射列表母缓存更新：重拉对应列表并 merge settled，
   * 否则 UI 会一直停在旧 previous（探云只写 storage、无人刷新页面）。
   */
  _onLaunchListCacheStale(info) {
    const kind = info && info.kind
    if (kind !== 'previous' && kind !== 'upcoming') return
    const now = Date.now()
    // 按列表种类分别去抖：下拉强制探云会几乎同时刷新 upcoming + previous，
    // 若共用一个时间戳，后到的一侧会在 1.5s 内被吞掉，历史/即将发射只更新一半。
    if (!this._launchListStaleAtByKind) this._launchListStaleAtByKind = Object.create(null)
    if (!this._launchListStaleGenByKind) this._launchListStaleGenByKind = Object.create(null)
    const lastAt = this._launchListStaleAtByKind[kind] || 0
    if (now - lastAt < 1500) return
    this._launchListStaleAtByKind[kind] = now
    const type = kind === 'previous' ? 'completed' : 'upcoming'
    const gen = (this._launchListStaleGenByKind[kind] =
      (this._launchListStaleGenByKind[kind] || 0) + 1)
    const fetchLimit = this._getMissionListFetchLimit()
    Promise.resolve()
      .then(() => this.fetchMissionList(type, fetchLimit, 0))
      .then(async (pack) => {
        if (gen !== this._launchListStaleGenByKind[kind]) return
        if (!pack || !Array.isArray(pack.list)) return
        // previous 走完整历史成功管线，与预拉 / 历史下拉一致
        if (type === 'completed') {
          this.handleCompletedMissionLoadSuccess(pack.list, pack.res || {})
          return
        }
        const list = this._filterUpcomingAgainstSettled(pack.list)
        const patch = buildMissionListSetData(type, list, pack.res, filterExpiredMissions)
        this.applyUpcomingAgencyFilterToPatch(patch, list)
        this.setData(patch, () => {
          try {
            this.updateMissionListView(type, list)
          } catch (e2) {}
          try {
            this.syncCalendarFromMissionListsIfNeeded()
          } catch (e3) {}
        })
      })
      .catch(() => {})
  },

  onUnload() {
    this._stopFestivalHatDevCycle()
    if (typeof this._offLaunchListStale === 'function') {
      try {
        this._offLaunchListStale()
      } catch (e) {}
      this._offLaunchListStale = null
    }
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
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
    }
    if (this._splashVideoForcePlayTimer) {
      clearTimeout(this._splashVideoForcePlayTimer)
      this._splashVideoForcePlayTimer = null
    }
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = null
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
    if (typeof this._clearLiveStatusPolling === 'function') {
      try {
        this._clearLiveStatusPolling()
      } catch (e) {}
    }
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

})
