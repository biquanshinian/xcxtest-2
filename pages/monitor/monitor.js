// pages/monitor/monitor.js
const { getSpaceXLaunchStats } = require('../../utils/api-app-services.js')
const { getStationStatus } = require('../../utils/api-monitor-data.js')
const { onStaleUpdate, getCacheKey } = require('../../utils/api-request.js')
const { loadCloudMediaMap } = require('../../utils/image-config.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { gateCheck, isMembershipEnabled, getMembershipState, isProSync, warmMembershipStateSync } = require('../../utils/membership.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { isLiveEntryAllowed, isPlaybackAllowed } = require('../../utils/feature-flags.js')
const themeUtil = require('../../utils/theme.js')
const { optimizeImageUrl, videoSnapshotUrl } = require('../../utils/cos-url.js')
const { advanceImageFallback } = require('../../utils/ll2-image.js')

let _starlinkRenderer = null
let _starlinkLoadPromise = null
const STARLINK_RENDERER_PATH = '../../subpackages/monitor-pages/utils/starlink-renderer.js'

function getChannelsFallbackGuideFromConfig() {
  // 本地仅占位，二维码必须等云端；禁止用历史写死 URL 顶上
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

function loadStarlinkRenderer() {
  if (_starlinkRenderer) return Promise.resolve(_starlinkRenderer)
  if (!_starlinkLoadPromise) {
    _starlinkLoadPromise = require.async(STARLINK_RENDERER_PATH)
      .then((mod) => {
        _starlinkRenderer = mod
        return mod
      })
      .catch((err) => {
        _starlinkLoadPromise = null
        throw err
      })
  }
  return _starlinkLoadPromise
}

function getStarlinkRenderer() {
  return _starlinkRenderer
}

// ========== Starlink 过境预报：整块逻辑在 monitor-pages 分包（monitor-pass.js） ==========
// 全部方法都由用户点击触发（加载按钮 / 刷新 / 详情 / 地图），首屏无需注入，
// require.async + attachTo 委托模式与首页 index-vote / index-save-image 一致。
const PASS_PKG = '../../subpackages/monitor-pages/utils/monitor-pass.js'
const PASS_METHODS = [
  '_getPassLocation',
  'onLoadStarlinkPasses',
  'loadStarlinkPasses',
  'requestPassLocation',
  'refreshPasses',
  'openPassDetail',
  'openPassMap'
]
function delegatePass(name) {
  return function (...args) {
    const page = this
    if (page.__passAttached) return page[name](...args)
    if (!page.__passLoadPromise) {
      page.__passLoadPromise = require.async(PASS_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__passLoadPromise = null
        console.error('[Pass] 分包模块加载失败:', err)
        page.setData({
          passLoading: false,
          passReady: true,
          passError: '过境计算模块加载失败，请检查网络后重试'
        })
        throw err
      })
    }
    return page.__passLoadPromise.then(() => page[name](...args))
  }
}
const passDelegates = {}
PASS_METHODS.forEach((name) => {
  passDelegates[name] = delegatePass(name)
})

// ========== 四个图鉴板块：整块逻辑在 monitor-pages 分包（monitor-galleries.js） ==========
// 火箭族谱 / 飞船图鉴 / 发射场分布 / 发射商图鉴的加载与跳转全部拆出（Tab 仅预览 2 卡）；
// 展示层 booster-display 等 4 个 utils 也随之迁入分包。监控页在 preloadRule
// 中预下载 monitor-pages，各板块自带 loading 骨架，首次进 Tab 无感知差异。
const GALLERIES_PKG = '../../subpackages/monitor-pages/utils/monitor-galleries.js'
const GALLERIES_METHODS = [
  'loadBoosterGenealogy', 'onViewAllBoosters',
  'onRetryBoosterLoad',
  'onBoosterImageLoad', 'onBoosterImageError', 'onBoosterCardTap',
  'loadSpacecraftGallery', 'onViewAllSpacecraft',
  'onRetrySpacecraftLoad', 'onSpacecraftImageError', 'onSpacecraftCardTap',
  'loadLaunchSiteGallery', 'onViewAllLaunchSites',
  'onRetryLaunchSiteLoad', 'onLaunchSiteImageError', 'onLaunchSiteCardTap',
  'loadAgencies', 'onAgencyImageError', 'onViewAllAgencies', 'onAgencyTap',
  'tryOpenPendingAgencyDetail', 'retryLoadAgencies'
]
function delegateGalleries(name) {
  return function (...args) {
    const page = this
    if (page.__galleriesAttached) return page[name](...args)
    if (!page.__galleriesLoadPromise) {
      page.__galleriesLoadPromise = require.async(GALLERIES_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__galleriesLoadPromise = null
        console.error('[Galleries] 分包模块加载失败:', err)
        page.setData({
          boosterLoading: false, boosterLoadError: true,
          spacecraftLoading: false, spacecraftLoadError: true,
          launchSiteLoading: false, launchSiteLoadError: true,
          agencyLoading: false, agencyError: '加载失败，请稍后重试'
        })
        throw err
      })
    }
    return page.__galleriesLoadPromise.then(() => page[name](...args))
  }
}
const galleriesDelegates = {}
GALLERIES_METHODS.forEach((name) => {
  galleriesDelegates[name] = delegateGalleries(name)
})

// ========== 轨道数据中心 + 在轨任务：逻辑在 monitor-pages 分包（monitor-orbital.js） ==========
// clearOrbitalCountdown 因 onHide/onUnload 需同步调用保留在下方 Page 内。
const ORBITAL_PKG = '../../subpackages/monitor-pages/utils/monitor-orbital.js'
const ORBITAL_METHODS = [
  '_formatUpcomingOrbitalEvents', '_formatLocalDate', 'onLoadUpcomingOrbitalEvents',
  'onUpcomingEventTap', 'onOrbitEventImageError', 'startOrbitalCountdown', 'updateOrbitalCountdown',
  'openOrbitalDataCenter', 'onOrbitalBgError', 'loadOrbitalConfig', '_applyOrbitalConfig'
]
function delegateOrbital(name) {
  return function (...args) {
    const page = this
    if (page.__orbitalAttached) return page[name](...args)
    if (!page.__orbitalLoadPromise) {
      page.__orbitalLoadPromise = require.async(ORBITAL_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__orbitalLoadPromise = null
        console.error('[Orbital] 分包模块加载失败:', err)
        page.setData({ orbitalLoading: false })
        throw err
      })
    }
    return page.__orbitalLoadPromise.then(() => page[name](...args))
  }
}
const orbitalDelegates = {}
ORBITAL_METHODS.forEach((name) => {
  orbitalDelegates[name] = delegateOrbital(name)
})

// ========== 博卡奇卡实况天气：整块逻辑在 monitor-pages 分包（monitor-weather.js） ==========
// onLoad 中本就延迟 1.5s 才发起网络请求，委托加载不改变时序；分包已在 preloadRule 预下载。
const WEATHER_METHODS = ['_hydrateStarbaseWeatherFromCache', 'loadStarbaseWeather', '_mapWeatherCode']
function delegateWeather(name) {
  return function (...args) {
    const page = this
    if (page.__weatherAttached) return page[name](...args)
    if (!page.__weatherLoadPromise) {
      // 字面量路径：开发者工具静态分析识别不了 require.async(变量)，会把分包模块误报为无依赖文件
      page.__weatherLoadPromise = require.async('../../subpackages/monitor-pages/utils/monitor-weather.js').then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__weatherLoadPromise = null
        console.error('[Weather] 分包模块加载失败:', err)
        const prev = page.data.starbaseWeather || {}
        page.setData({ starbaseWeather: { ...prev, loading: false, error: prev.loaded ? '' : '天气暂时不可用' } })
        throw err
      })
    }
    return page.__weatherLoadPromise.then(() => page[name](...args))
  }
}
const weatherDelegates = {}
WEATHER_METHODS.forEach((name) => {
  weatherDelegates[name] = delegateWeather(name)
})

Page({
  ...passDelegates,
  ...galleriesDelegates,
  ...orbitalDelegates,
  ...weatherDelegates,

  /** 在轨任务组件卡片点击：还原 dataset.id 后交给委托方法 */
  onOrbitEventTapFromComp(e) {
    const id = (e && e.detail && e.detail.id) || ''
    return this.onUpcomingEventTap({ currentTarget: { dataset: { id } } })
  },

  /** 在轨任务配图失败：还原 index 后沿兜底链推进 */
  onOrbitEventImageErrorFromComp(e) {
    const index = (e && e.detail && e.detail.index)
    return this.onOrbitEventImageError({ currentTarget: { dataset: { index } } })
  },

  /** 图鉴组件统一事件通道：还原 currentTarget.dataset / detail 后分发给对应委托方法 */
  onGalleryEvent(e) {
    const { name, dataset, edetail } = (e && e.detail) || {}
    if (!name || GALLERIES_METHODS.indexOf(name) < 0 || typeof this[name] !== 'function') return
    return this[name]({ currentTarget: { dataset: dataset || {} }, detail: edetail || {} })
  },
  async onLoad() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 1,
        currentPath: '/pages/monitor/monitor'
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

    // 媒体映射不阻塞后续加载（其他模块可能仍依赖云端媒体映射）
    loadCloudMediaMap().catch(() => {})

    // 「直播观看」板块：enableLive + enableLiveWatch（过审 failClosed，初始隐藏）
    isLiveEntryAllowed().then((on) => {
      this.setData({ enableLiveWatch: !!on })
    }).catch(() => {
      this.setData({ enableLiveWatch: false })
    })

    // 过审关闭可播视频时，轨道卡片不用 mp4 背景（默认先关，读到允许再开）
    this._orbitalBgVideoAllowed = false
    isPlaybackAllowed().then((on) => {
      this._orbitalBgVideoAllowed = !!on
      if (!on && this.data.orbitalCardBgIsVideo) {
        this.setData({ orbitalCardBgIsVideo: false, orbitalCardBg: '' })
      } else if (on && this._lastOrbitalConfig) {
        this._applyOrbitalConfig(this._lastOrbitalConfig)
      }
    }).catch(() => {
      this._orbitalBgVideoAllowed = false
      if (this.data.orbitalCardBgIsVideo) {
        this.setData({ orbitalCardBgIsVideo: false, orbitalCardBg: '' })
      }
    })

    // 推荐视频号引导（运营后台可改）
    this.loadChannelsFallbackGuide()

    // 首屏只加载轻量数据（云数据库单次查询）
    this.loadSpaceXTilesData()
    this.loadBoosterGenealogy()
    this.loadSpacecraftGallery()
    this.loadLaunchSiteGallery()
    this.loadAgencies()

    // 重量级模块改为懒加载：用户点击「加载」按钮才请求
    // - Starlink 卫星实时分布（多分片TLE + Canvas渲染）
    // - Starlink 过境预报（定位 + TLE + CPU密集计算）
    // - 空间站实时状态（3个外部API）
    // - 全球发射商图鉴（多级回退请求链）

    setTimeout(function () {
      try { warmMembershipStateSync() } catch (e) {}
    }, 0)

    // 预热会员开关与状态缓存，减少首次点「AR 观测」等门控的空白等待
    this._membershipWarmAt = Date.now()
    setTimeout(function () {
      Promise.all([isMembershipEnabled(), getMembershipState()]).catch(function () {})
    }, 0)

    // 加载太空轨道数据中心远程配置（运营人员后台维护）
    setTimeout(() => {
      this.loadOrbitalConfig()
    }, 0)

    // 博卡奇卡天气（open-meteo）：先用本地持久缓存立即展示，
    // 网络请求延后到首屏渲染完成后（跨境 RTT 慢，避免计入页面打开阶段）
    setTimeout(() => {
      this._hydrateStarbaseWeatherFromCache()
    }, 0)
    setTimeout(() => {
      this.loadStarbaseWeather(false)
    }, 1500)

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
        selected: 1,
        currentPath: '/pages/monitor/monitor'
      })
      getApp().checkProgressDot(this.getTabBar())
      getApp().checkProfileDot(this.getTabBar())
      getApp().checkNewsDot(this.getTabBar())
    }
    var self = this
    setTimeout(function () {
      self.setData({ isProUser: isProSync() })
    }, 0)
    // 恢复 Starlink 渲染（如果离开前不是暂停状态）
    const starlinkRenderer = getStarlinkRenderer()
    if (starlinkRenderer && this._starlinkWasPaused === false && starlinkRenderer.isPaused()) {
      starlinkRenderer.togglePause()
    }
    // 恢复在轨任务倒计时
    if (this.data.orbitalReady && this.data.upcomingOrbitalEvents.length) {
      this.startOrbitalCountdown()
    }
    // 恢复空间站缓存更新监听（onHide 已注销）
    if (this._stationStaleWasActive) {
      this._stationStaleWasActive = false
      this._registerStationStaleListeners()
    }
    this.tryOpenPendingAgencyDetail()

    // 弹窗广告
    tryShowPopupAd(1, this)

    // 进入监控页走缓存刷新推荐引导（30 分钟 TTL）；打开引导弹窗时才强制拉最新二维码
    this.loadChannelsFallbackGuide()

    // 会员 warm 60 秒节流：频繁切 Tab 时不重复打云端权益查询
    if (!this._membershipWarmAt || Date.now() - this._membershipWarmAt >= 60 * 1000) {
      this._membershipWarmAt = Date.now()
      setTimeout(function () {
        Promise.all([isMembershipEnabled(), getMembershipState()]).catch(function () {})
      }, 0)
    }
  },

  onPopupAdClose() {
    this.setData({ popupAdVisible: false, popupAdItem: null })
  },

  onUnload() {
    this._clearStationStaleListeners()
    this.clearOrbitalCountdown()
    this._teardownStarlinkObserver()
    const starlinkRenderer = getStarlinkRenderer()
    if (starlinkRenderer) starlinkRenderer.destroy()
  },

  onHide() {
    this.clearOrbitalCountdown()
    // 切走时注销空间站缓存监听，避免后台被 stale 事件触发网络请求 + setData（onShow 重新注册）
    this._stationStaleWasActive = !!this._stationStaleOffs
    this._clearStationStaleListeners()
    // 页面隐藏时暂停渲染，节省性能
    const renderer = getStarlinkRenderer()
    if (!renderer) return
    renderer.releaseInteraction()
    this._starlinkWasPaused = renderer.isPaused()
    if (!this._starlinkWasPaused) {
      renderer.togglePause()
    }
  },
  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    scrollRefreshing: false,
    popupAdItem: null,
    popupAdVisible: false,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    isProUser: false,
    orbitalLiveStats: {
      activeNodes: '128',
      bandwidth: '4.8 Tbps',
      uptime: '99.97%'
    },
    orbitalCardBg: videoSnapshotUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1784884993160_b2tlgu.mp4') || '',
    orbitalCardBgIsVideo: false,
    pageDesc: 'SpaceX星舰Starbase基地实时监控·马斯克星链火箭回收太空航天追踪',
    channelsLiveStatus: 0,
    // 「直播观看」板块开关（后台 enableLive + enableLiveWatch；初始 failClosed）
    enableLiveWatch: false,
    // B站直播
    biliLive: {
      roomId: '390508',
      title: 'SpaceX星舰直播',
      cover: '',
      statusText: '点击查看',
      liveUrl: 'https://live.bilibili.com/390508'
    },
    showBiliQRModal: false,
    /** 自己未开播时：推荐第三方视频号主页二维码引导 */
    channelsFallbackGuide: getChannelsFallbackGuideFromConfig(),
    showChannelsGuideModal: false,
    // 博卡奇卡实况（Open-Meteo）
    starbaseWeather: {
      loading: false,
      loaded: false,
      error: '',
      timeLine: '',
      conditionText: '',
      tempLine: '',
      windLine: '',
      weatherIcon: '/images/starbase-weather/w-unknown.svg',
      windIcon: '/images/starbase-weather/wind-lines.svg'
    },
    // SpaceX tiles 预计算数据
    ongoingMissions: [],
    upcomingOrbitalEvents: [],
    orbitalReady: false,
    orbitalLoading: false,
    orbitalCountdown: { days: '00', hours: '00', minutes: '00', seconds: '00', isExpired: false },
    spacexTilesLoading: false,
    // Starlink 卫星实时分布
    starlinkCount: 0,
    starlinkLoading: false,
    starlinkError: '',
    starlinkPaused: false,
    starlinkUpdateTime: '',
    starlinkReady: false,
    // 助推器族谱（Tab 预览 2 张，筛选/统计在全屏页）
    boosterList: [],
    boosterLoading: false,
    boosterLoadError: false,
    boosterImageLoadedMap: {},
    // 全球飞船图鉴（Tab 预览 2 张）
    spacecraftList: [],
    spacecraftLoading: false,
    spacecraftLoadError: false,
    // 全球发射场分布（Tab 预览 2 张）
    launchSiteList: [],
    launchSiteLoading: false,
    launchSiteLoadError: false,
    // Starlink 过境预报
    passList: [],
    passLocation: '',
    passLoading: false,
    passNoLocation: false,
    passError: '',
    passReady: false,
    _passObserver: null,
    // 空间站实时状态
    stationList: [],
    stationLoading: false,
    stationImageLoadedMap: {},
    stationReady: false,
    // 全球发射商图鉴（2张预览 + 标题行「查看全部」跳完整列表页）
    agencyVisible: [],
    agencyLoading: false,
    agencyError: '',
    agencyTotal: 0
  },

  /** 加载 SpaceX tiles 预计算数据（复用现有 getSpaceXLaunchStats，零额外云调用） */
  async loadSpaceXTilesData() {
    try {
      const stats = await getSpaceXLaunchStats()
      if (!stats) return
      const updates = { spacexTilesLoading: false }
      if (stats.ongoingMissions) updates.ongoingMissions = stats.ongoingMissions
      this.setData(updates)
    } catch (err) {
      console.error('[Monitor] SpaceX tiles load error:', err)
      this.setData({ spacexTilesLoading: false })
    }
  },

  /** 清除在轨任务倒计时定时器 */
  clearOrbitalCountdown() {
    if (this._orbitalCountdownTimer) {
      clearInterval(this._orbitalCountdownTimer)
      this._orbitalCountdownTimer = null
    }
  },

  // ========== Starlink 卫星实时分布 ==========
  /** 用户点击「加载」按钮触发 */
  onLoadStarlink() {
    this.setData({ starlinkReady: true })
    this.initStarlink()
  },

  async initStarlink() {
    this.setData({ starlinkLoading: true, starlinkError: '', starlinkReady: true })
    try {
      const starlinkRenderer = await loadStarlinkRenderer()
      // 第 1 步：加载 TLE 数据（此时显示 loading 态，Canvas 不可见）
      const result = await starlinkRenderer.init(this)
      const now = new Date()
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

      // 第 2 步：数据就绪，切换到 Canvas 显示态
      this.setData({
        starlinkCount: result.count,
        starlinkLoading: false,
        starlinkUpdateTime: timeStr
      })

      // 第 3 步：等 Canvas 渲染到 DOM 后，绑定并启动渲染
      // 注册实时数量回调（渲染器回传全量在轨数，与徽章"颗在轨"语义一致）
      starlinkRenderer.setOnCountUpdate((count) => {
        if (count && count !== this.data.starlinkCount) {
          this.setData({ starlinkCount: count })
        }
      })
      // 卡片场景渲染采样上限（全屏页为 5000）
      if (typeof starlinkRenderer.setRenderMax === 'function') {
        starlinkRenderer.setRenderMax(2500)
      }
      setTimeout(async () => {
        try {
          await starlinkRenderer.bindCanvas(this)
          this._setupStarlinkObserver()
        } catch (err) {
          console.error('[Starlink] bindCanvas error:', err)
          this.setData({ starlinkError: 'Canvas 初始化失败，请下拉刷新重试' })
        }
      }, 200)
    } catch (err) {
      console.error('[Starlink] init error:', err)
      this.setData({
        starlinkLoading: false,
        starlinkError: '卫星数据加载失败，请稍后重试'
      })
    }
  },

  retryLoadStarlink() {
    this.initStarlink()
  },

  /**
   * 卡片滚出视野自动暂停渲染循环、滚回恢复。
   * 只接管"自动暂停"（_starlinkAutoPaused 标记）；用户手动暂停不被覆盖。
   */
  _setupStarlinkObserver() {
    this._teardownStarlinkObserver()
    try {
      const observer = wx.createIntersectionObserver(this)
      observer.relativeToViewport().observe('#starlinkCanvas', (res) => {
        const renderer = getStarlinkRenderer()
        if (!renderer) return
        const visible = res && res.intersectionRatio > 0
        if (!visible) {
          if (!renderer.isPaused()) {
            this._starlinkAutoPaused = true
            renderer.releaseInteraction()
            renderer.togglePause()
          }
        } else {
          if (this._starlinkAutoPaused && renderer.isPaused()) {
            renderer.togglePause()
          }
          this._starlinkAutoPaused = false
        }
      })
      this._starlinkObserver = observer
    } catch (e) {
      this._starlinkObserver = null
    }
  },

  _teardownStarlinkObserver() {
    if (this._starlinkObserver) {
      try { this._starlinkObserver.disconnect() } catch (e) {}
      this._starlinkObserver = null
    }
    this._starlinkAutoPaused = false
  },

  toggleStarlinkPause() {
    const starlinkRenderer = getStarlinkRenderer()
    if (!starlinkRenderer) return
    const paused = starlinkRenderer.togglePause()
    this.setData({ starlinkPaused: paused })
  },

  // Canvas 触摸事件 → 转发给渲染器
  onStarlinkTouchStart(e) { const r = getStarlinkRenderer(); if (r) r.onTouchStart(e) },
  onStarlinkTouchMove(e) { const r = getStarlinkRenderer(); if (r) r.onTouchMove(e) },
  onStarlinkTouchEnd(e) { const r = getStarlinkRenderer(); if (r) r.onTouchEnd(e) },

  async openStarlinkFullscreen() {
    const allowed = await gateCheck('starlink_pro', '星链高级追踪')
    if (!allowed) return
    navigateTo(ROUTES.STARLINK_FULLSCREEN)
  },

  /** 分享按钮点按时记下分区类型（兜底 dataset 丢失） */
  markPendingShareType(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.shareType) || ''
    if (type) this._pendingShareType = type
  },

  /** 分享：分区深链到对应功能详情页，避免好友点开只落到监控 Tab */
  onShareAppMessage(e) {
    const ds = (e && e.target && e.target.dataset) || {}
    // 分包组件内 share 按钮的 dataset 偶发丢；bindtap 会先写入 _pendingShareType
    const type = ds.shareType || this._pendingShareType || ''
    this._pendingShareType = ''
    const monitorPath = '/pages/monitor/monitor'

    if (type === 'orbit') {
      const events = this.data.upcomingOrbitalEvents || []
      const count = events.length
      const first = events[0]
      const title = count
        ? '即将进行的在轨任务 - ' + count + '个事件待执行 | 火星探索日志'
        : '即将进行的在轨任务追踪 | 火星探索日志'
      if (first && first.id != null) {
        return {
          title,
          path: `${ROUTES.EVENT_DETAIL}?mode=ll2_event&id=${encodeURIComponent(first.id)}`
        }
      }
      return { title, path: monitorPath }
    }
    if (type === 'station') {
      const list = this.data.stationList || []
      const count = list.length
      const first = list[0]
      const title = count
        ? '国际空间站 / 天宫空间站实时状态 - 当前收录' + count + '个空间站 | 火星探索日志'
        : '国际空间站 / 天宫空间站实时状态 | 火星探索日志'
      if (first && first.id != null) {
        return {
          title,
          path: `${ROUTES.STATION_DETAIL}?id=${encodeURIComponent(first.id)}`
        }
      }
      return { title, path: monitorPath }
    }
    if (type === 'starlink') {
      return {
        title: 'Starlink卫星实时分布 - ' + this.data.starlinkCount + '颗在轨 | 火星探索日志',
        path: ROUTES.STARLINK_FULLSCREEN
      }
    }
    if (type === 'pass') {
      const count = (this.data.passList || []).length
      const title = count
        ? '星链过境预报 - 未来24小时共' + count + '次可见过境 | 火星探索日志'
        : '星链过境预报 | 火星探索日志'
      return {
        title,
        path: count
          ? `${ROUTES.STARLINK_PASS_DETAIL}?count=${count}`
          : ROUTES.STARLINK_PASS_DETAIL
      }
    }
    return { path: monitorPath, title: '监控中心 - SpaceX星舰基地实时监控 | 火星探索日志' }
  },

  onShareTimeline() {
    return { title: '监控中心 - SpaceX星舰基地实时监控 | 火星探索日志' }
  },

  /** 打开小程序专用落地页（星舰监控中心） */
  openUserWebPreview() {
    wx.navigateTo({
      url: '/subpackages/monitor-pages/mp-landing',
      fail: (err) => {
        wx.showToast({
          title: '打开失败，请稍后重试',
          icon: 'none',
          duration: 2000
        })
      }
    })
  },


  /** 打开智能搜索页 */
  openAISearch() {
    wx.navigateTo({
      url: '/pages/search/search',
      fail: () => {
        wx.showToast({
          title: '打开搜索失败，请稍后重试',
          icon: 'none',
          duration: 2000
        })
      }
    })
  },

  /** 关于预览（合规说明） */
  goAbout() {
    navigateTo(ROUTES.ABOUT)
  },

  /** 我的收藏（原生功能，防套壳） */
  goCollect() {
    navigateTo(ROUTES.COLLECT)
  },

  /**
   * 原生三点下拉刷新（页面级 / scroll-view refresher 共用）— 只刷新已加载的模块
   */
  onMonitorScroll() {
    try {
      const { pulseNasaFloatOnScroll } = require('../../utils/nasa-float-scroll.js')
      pulseNasaFloatOnScroll(this)
    } catch (e) {}
  },

  onScrollRefresh() {
    this._runMonitorPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runMonitorPullRefresh()
  },

  _runMonitorPullRefresh(key) {
    runPullRefresh(this, () => {
      const tasks = [
        this.loadSpaceXTilesData(),
        this.loadBoosterGenealogy(),
        this.loadSpacecraftGallery(),
        this.loadLaunchSiteGallery(),
        Promise.resolve(this.refreshChannelsLivePanel()),
        Promise.resolve(this.loadStarbaseWeather(true))
      ]

      // 重量级模块：只有已加载过才刷新
      if (this.data.starlinkReady) {
        this._teardownStarlinkObserver()
        const starlinkRenderer = getStarlinkRenderer()
        if (starlinkRenderer) starlinkRenderer.destroy()
        tasks.push(Promise.resolve().then(() => this.initStarlink()))
      }
      if (this.data.stationReady) {
        tasks.push(this.loadStationStatus({ silent: true }))
      }
      tasks.push(this.loadAgencies({ silent: true }))

      return Promise.all(tasks).catch(() => {})
    }, key)
  },

  refreshChannelsLivePanel() {
    const panel = this.selectComponent('#channelsLivePanel')
    if (panel && typeof panel.refresh === 'function') {
      return panel.refresh()
    }
    return Promise.resolve()
  },

  onChannelsLiveStatusChange(e) {
    const detail = (e && e.detail) || {}
    this.setData({
      channelsLiveStatus: detail.status || 0
    })
  },

  // ========== 博卡奇卡实况天气（逻辑在分包 monitor-weather.js，经顶部 weatherDelegates 委托加载） ==========

  onBiliLiveTap() {
    this.setData({ showBiliQRModal: true })
  },

  onBiliQRImageTap() {
    const qrUrl = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1773602498836_o237or.png'
    wx.previewImage({
      urls: [qrUrl],
      current: qrUrl
    })
  },

  hideBiliQRCode() {
    this.setData({ showBiliQRModal: false })
  },

  onCopyBiliLiveLink() {
    wx.setClipboardData({
      data: this.data.biliLive.liveUrl,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  },

  onChannelsGuideTap() {
    const guide = this.data.channelsFallbackGuide
    if (!guide || !guide.enabled) {
      wx.showToast({ title: '暂未配置推荐直播', icon: 'none' })
      return
    }
    this.setData({ showChannelsGuideModal: true })
    // 打开弹窗时再拉一次，确保二维码是后台最新
    this.loadChannelsFallbackGuide(true)
  },

  onChannelsLiveFallbackGuide() {
    this.onChannelsGuideTap()
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
        console.warn('[monitor] loadChannelsFallbackGuide failed:', err && err.message ? err.message : err)
      })
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

  // ========== Starlink 过境预报（逻辑在分包 monitor-pass.js，经顶部 passDelegates 委托加载） ==========

  async openStarlinkAR() {
    if (this._gateChecking) return
    this._gateChecking = true
    try {
      const allowed = await gateCheck('starlink_ar', '星链 AR 观测')
      if (!allowed) return
      navigateTo(ROUTES.STARLINK_AR)
    } finally {
      this._gateChecking = false
    }
  },

  /** 用户点击「加载」按钮触发空间站数据 */
  onLoadStationStatus() {
    this.setData({ stationReady: true })
    this.loadStationStatus()
  },

  /** 加载空间站实时状态 */
  async loadStationStatus(opts = {}) {
    // silent（下拉刷新）：已有数据时不显示“加载空间站数据...”占位
    const silent = !!(opts.silent && (this.data.stationList || []).length > 0)
    this.setData(silent ? { stationReady: true } : { stationLoading: true, stationReady: true })
    try {
      const stationList = await getStationStatus()
      const list = stationList || []
      // 同 URL 刷新时 <image> 常不重触发 bindload；若清空 loadedMap，会一直停在 opacity:0（浅色下像白块）
      const prevList = this.data.stationList || []
      const prevLoaded = this.data.stationImageLoadedMap || {}
      const prevById = {}
      prevList.forEach((s, i) => {
        if (!s || s.id == null) return
        prevById[String(s.id)] = { image: s.image || '', loaded: !!prevLoaded[i] }
      })
      const stationImageLoadedMap = {}
      list.forEach((s, i) => {
        if (!s || s.id == null) return
        const prev = prevById[String(s.id)]
        if (prev && prev.loaded && prev.image && prev.image === (s.image || '')) {
          stationImageLoadedMap[i] = true
        }
      })
      this.setData({
        stationList: list,
        stationLoading: false,
        stationImageLoadedMap
      })
      // 注册后台缓存更新监听：当云数据库有更新数据时自动刷新 UI
      this._registerStationStaleListeners()
    } catch (err) {
      console.error('加载空间站状态失败', err)
      this.setData({ stationLoading: false })
    }
  },

  /**
   * 注册空间站相关 cacheKey 的后台更新监听器
   * 当 request 后台发现云数据库数据比本地缓存新时，自动重新加载空间站数据
   */
  _registerStationStaleListeners() {
    // 先清理旧监听器
    this._clearStationStaleListeners()

    // 动态跟随当前站点清单（数据驱动，新增站自动注册监听）
    const stationKeys = (this.data.stationList || [])
      .map(s => getCacheKey(`/space_stations/${s.id}/`, { format: 'json' }))

    this._stationStaleOffs = stationKeys.map(key =>
      onStaleUpdate(key, () => {
        if (this._stationRefreshTimer) clearTimeout(this._stationRefreshTimer)
        this._stationRefreshTimer = setTimeout(() => {
          this._stationRefreshTimer = null
          if (this.data.stationReady) {
            this.loadStationStatus()
          }
        }, 500)
      })
    )
  },

  _clearStationStaleListeners() {
    if (this._stationStaleOffs) {
      this._stationStaleOffs.forEach(off => off())
      this._stationStaleOffs = null
    }
    if (this._stationRefreshTimer) {
      clearTimeout(this._stationRefreshTimer)
      this._stationRefreshTimer = null
    }
  },

  onStationImageLoad(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    this.setData({
      [`stationImageLoadedMap.${index}`]: true
    })
  },

  onStationImageError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    const station = (this.data.stationList || [])[index]
    if (!station) return
    const advanced = advanceImageFallback(station.image, station.imageFallbacks)
    // 沿兜底链推进；链耗尽才清空（与飞船/助推器卡一致，避免卡空白而详情仍有图）
    this.setData({
      [`stationList[${index}].image`]: advanced.next,
      [`stationList[${index}].imageFallbacks`]: advanced.remaining,
      [`stationImageLoadedMap.${index}`]: false
    })
  },

  /** 点击空间站卡片 → 跳转独立详情页 */
  onStationCardTap(e) {
    const stationId = Number(e.currentTarget.dataset.stationId)
    if (!stationId) return
    // 传递封面图 URL，让详情页 onLoad 时立即展示 Hero 大图
    const station = (this.data.stationList || []).find(s => Number(s.id) === stationId)
    const imageParam = station && station.image ? `&image=${encodeURIComponent(station.image)}` : ''
    try {
      const app = getApp()
      if (app && station) {
        app._stationHeroImage = {
          id: String(stationId),
          src: station.image || '',
          fallbacks: (station.imageFallbacks || []).slice()
        }
      }
    } catch (err) {}
    wx.navigateTo({
      url: `${ROUTES.STATION_DETAIL}?id=${stationId}${imageParam}`
    })
  },

  /** 点击停靠飞船卡片 → 跳转发射详情 */
  onDockedShipTap(e) {
    const launchId = e.currentTarget.dataset.launchId
    if (launchId) {
      wx.navigateTo({
        url: '/pages/index/index?missionId=' + launchId
      })
    }
  }
})
