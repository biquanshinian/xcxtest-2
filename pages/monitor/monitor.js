// pages/monitor/monitor.js
const { getSpaceXLaunchStats, getRocketConfigMeta } = require('../../utils/api-app-services.js')
const { getBoosterGenealogy, getStationStatus } = require('../../utils/api-monitor-data.js')
const boosterDisplay = require('../../utils/booster-display.js')
const spacecraftDisplay = require('../../utils/spacecraft-display.js')
const launchSiteDisplay = require('../../utils/launch-site-display.js')
const { getFeaturedAgencies, filterAgencies, toDisplayRow } = require('../../utils/agency-data.js')
const { onStaleUpdate, getCacheKey } = require('../../utils/api-request.js')
const { loadCloudMediaMap } = require('../../utils/image-config.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { getOrbitalConfig: getOrbitalConfigCached } = require('../../utils/orbital-config-cache.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { gateCheck, isMembershipEnabled, getMembershipState, isProSync, canUsePaidCloudSync, warmMembershipStateSync } = require('../../utils/membership.js')
const { getMemberPolicySync } = require('../../utils/member-policy.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { isLiveEntryAllowed, isPlaybackAllowed } = require('../../utils/feature-flags.js')
const themeUtil = require('../../utils/theme.js')
const config = require('../../utils/config.js')
const { optimizeImageUrl, toCdnUrl, isVideoUrl } = require('../../utils/cos-url.js')
const { getCachedVideo } = require('../../utils/video-cache.js')

const STARLINK_TLE_CACHE_KEY = '_starlink_tle_cache'
// 缓存版本：v2 = NORAD 倒序取最新 400 颗；与 starlink-renderer / starlink-ar 三方共用同一 key，需同步
const STARLINK_TLE_CACHE_VER = 2
// 过境预报参与计算的卫星上限（NORAD 倒序取最新，低轨新批次是肉眼"星链列车"主体）
const STARLINK_PASS_MAX_SATS = 400
const PASS_DETAIL_STORAGE_KEY = '_starlink_pass_detail_payload'
const STARBASE_WEATHER_PATH = '../../subpackages/monitor-pages/utils/starbase-weather.js'

let _starlinkRenderer = null
let _starlinkLoadPromise = null
const STARLINK_RENDERER_PATH = '../../subpackages/monitor-pages/utils/starlink-renderer.js'
// 过境计算模块已移入主包同步加载：此前跨分包 require.async 在部分真机上加载失败，
// 导致“过境计算模块加载失败”。模块仅 ~37KB，放主包可彻底消除该故障点。
const starlinkPass = require('../../utils/starlink-pass.js')

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

const STARLINK_TLE_CACHE_TTL = 6 * 60 * 60 * 1000

Page({
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
    orbitalCardBg: optimizeImageUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/SpaceX%E5%A4%AA%E7%A9%BA%E8%BD%A8%E9%81%93%E6%95%B0%E6%8D%AE%E4%B8%AD%E5%BF%83/1779046968216_7douwq.jpg', 'medium'),
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
    // 助推器族谱
    boosterList: [],
    boosterStats: { activeCount: 0, maxFlights: 0, totalFlights: 0, manufacturerCount: 0 },
    boosterLoading: false,
    boosterLoadError: false,
    boosterImageLoadedMap: {},
    boosterFilterChips: [],
    boosterFilter: 'all',
    boosterFilterEmpty: false,
    // 全球飞船图鉴
    spacecraftList: [],
    spacecraftStats: { inUseCount: 0, typeCount: 0, agencyCount: 0 },
    spacecraftLoading: false,
    spacecraftLoadError: false,
    spacecraftFilterChips: [],
    spacecraftFilter: 'all',
    spacecraftFilterEmpty: false,
    launchSiteList: [],
    launchSiteStats: { siteCount: 0, activeCount: 0, countryCount: 0, totalLaunches: 0 },
    launchSiteLoading: false,
    launchSiteLoadError: false,
    launchSiteFilterChips: [],
    launchSiteFilter: 'all',
    launchSiteFilterEmpty: false,
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

  /** 把 LL2 events 数据格式化为卡片所需展示字段 */
  _formatUpcomingOrbitalEvents(list) {
    if (!Array.isArray(list)) return []
    const now = Date.now()
    return list.map((ev) => {
      const dateMs = ev.dateMs || (ev.date ? Date.parse(ev.date) : NaN)
      let countdownText = ''
      let countdownClass = ''
      if (isFinite(dateMs)) {
        const diff = dateMs - now
        const absDay = Math.floor(Math.abs(diff) / 86400000)
        const absHour = Math.floor((Math.abs(diff) % 86400000) / 3600000)
        if (diff <= 0) {
          countdownText = '进行中/已开始'
          countdownClass = 'live'
        } else if (absDay >= 1) {
          countdownText = `${absDay}天${absHour}小时后`
        } else {
          const min = Math.floor((Math.abs(diff) % 3600000) / 60000)
          countdownText = absHour >= 1 ? `${absHour}小时${min}分后` : `${Math.max(1, min)}分钟后`
          countdownClass = 'soon'
        }
      }
      const dateText = isFinite(dateMs) ? this._formatLocalDate(dateMs) : ''
      return {
        ...ev,
        countdownText,
        countdownClass,
        dateText
      }
    })
  },

  _formatLocalDate(ms) {
    const d = new Date(ms)
    const m = d.getMonth() + 1
    const day = d.getDate()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${m}月${day}日 ${hh}:${mm}`
  },

  /** 点击「加载在轨任务」触发懒加载（节约资源；不在首屏自动调用） */
  async onLoadUpcomingOrbitalEvents() {
    if (this.data.orbitalReady || this.data.orbitalLoading) return
    this.setData({ orbitalReady: true, orbitalLoading: true })
    try {
      const stats = await getSpaceXLaunchStats()
      const list = stats && Array.isArray(stats.upcomingOrbitalEvents) ? stats.upcomingOrbitalEvents : []
      this.setData({
        orbitalLoading: false,
        upcomingOrbitalEvents: this._formatUpcomingOrbitalEvents(list)
      })
      this.startOrbitalCountdown()
    } catch (e) {
      this.setData({ orbitalLoading: false, upcomingOrbitalEvents: [] })
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
    }
  },

  /** 点击在轨事件卡片，跳转事件详情（复用 event-detail 页，传 ll2_event 模式） */
  onUpcomingEventTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/progress-extra/event-detail?mode=ll2_event&id=${encodeURIComponent(id)}`
    })
  },

  /** 启动在轨任务倒计时（第一个事件） */
  startOrbitalCountdown() {
    this.clearOrbitalCountdown()
    this.updateOrbitalCountdown()
    this._orbitalCountdownTimer = setInterval(() => this.updateOrbitalCountdown(), 1000)
  },

  /** 每秒更新在轨任务倒计时 */
  updateOrbitalCountdown() {
    const list = this.data.upcomingOrbitalEvents
    if (!list || !list.length) return
    const first = list[0]
    const dateMs = first.dateMs || (first.date ? Date.parse(first.date) : NaN)
    if (!isFinite(dateMs)) return
    const diff = dateMs - Date.now()
    if (diff <= 0) {
      this.setData({ orbitalCountdown: { days: '00', hours: '00', minutes: '00', seconds: '00', isExpired: true } })
      this.clearOrbitalCountdown()
      return
    }
    const days = String(Math.floor(diff / 86400000)).padStart(2, '0')
    const hours = String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0')
    const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
    const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
    // 路径更新：每秒只有变化字段进渲染层（通常只有秒位变化）
    const cur = this.data.orbitalCountdown || {}
    const patch = {}
    if (cur.days !== days) patch['orbitalCountdown.days'] = days
    if (cur.hours !== hours) patch['orbitalCountdown.hours'] = hours
    if (cur.minutes !== minutes) patch['orbitalCountdown.minutes'] = minutes
    if (cur.seconds !== seconds) patch['orbitalCountdown.seconds'] = seconds
    if (cur.isExpired !== false) patch['orbitalCountdown.isExpired'] = false
    if (Object.keys(patch).length) this.setData(patch)
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

  /** 分享 */
  onShareAppMessage(e) {
    const ds = (e && e.target && e.target.dataset) || {}
    const type = ds.shareType || ''
    const base = { path: '/pages/monitor/monitor' }

    if (type === 'orbit') {
      const count = (this.data.upcomingOrbitalEvents || []).length
      return { ...base, title: count ? '即将进行的在轨任务 - ' + count + '个事件待执行 | 火星探索日志' : '即将进行的在轨任务追踪 | 火星探索日志' }
    }
    if (type === 'station') {
      const count = this.data.stationList.length
      return { ...base, title: count ? '国际空间站 / 天宫空间站实时状态 - 当前收录' + count + '个空间站 | 火星探索日志' : '国际空间站 / 天宫空间站实时状态 | 火星探索日志' }
    }
    if (type === 'starlink') {
      return { ...base, title: 'Starlink卫星实时分布 - ' + this.data.starlinkCount + '颗在轨 | 火星探索日志' }
    }
    if (type === 'pass') {
      const count = this.data.passList.length
      return { ...base, title: count ? '星链过境预报 - 未来24小时共' + count + '次可见过境 | 火星探索日志' : '星链过境预报 | 火星探索日志' }
    }
    return { ...base, title: '监控中心 - SpaceX星舰基地实时监控 | 火星探索日志' }
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

  /** 打开太空轨道数据中心系统（超前科幻入口，会员门控） */
  async openOrbitalDataCenter() {
    if (this._orbitalGateChecking) return
    this._orbitalGateChecking = true
    try {
      const allowed = await gateCheck('orbital_data_center', '太空轨道数据中心')
      if (!allowed) return
      navigateTo(ROUTES.ORBITAL_DATA_CENTER)
    } finally {
      this._orbitalGateChecking = false
    }
  },

  /** 卡片背景图加载失败 */
  onOrbitalBgError() {
    this.setData({ orbitalCardBg: '', orbitalCardBgIsVideo: false })
  },

  /** 加载远程「太空轨道数据中心」配置（保留本地默认作为 fallback） */
  loadOrbitalConfig() {
    const self = this
    getOrbitalConfigCached({
      onUpdate(data) {
        // 后台拉到新版数据时，再覆盖一次（仅当卡片字段有变）
        self._applyOrbitalConfig(data)
      }
    }).then((data) => {
      self._applyOrbitalConfig(data)
    }).catch(() => { /* 静默失败，使用本地默认 */ })
  },

  /** 把远程配置应用到 data */
  _applyOrbitalConfig(data) {
    if (!data) return
    this._lastOrbitalConfig = data
    const card = data.card
    const detail = data.detail
    const updates = {}
    function isOrbitalBgVideoUrl(url) {
      if (!url || typeof url !== 'string') return false
      return isVideoUrl(url)
    }
    if (card) {
      if (card.bgImage) {
        const rawBg = String(card.bgImage).trim()
        const asVideo = isOrbitalBgVideoUrl(rawBg)
        // 过审关闭可播视频时不渲染卡片背景 <video>（未解析前也先不播）
        if (asVideo && this._orbitalBgVideoAllowed !== true) {
          updates.orbitalCardBg = ''
          updates.orbitalCardBgIsVideo = false
        } else if (asVideo) {
          // 非会员 / 紧急流量档：不挂轨道卡 mp4（进 Tab 循环拉流是 COS 大头）
          const emergency = !!(getMemberPolicySync().emergencyMedia)
          if (!canUsePaidCloudSync() || emergency) {
            updates.orbitalCardBg = ''
            updates.orbitalCardBgIsVideo = false
          } else {
            updates.orbitalCardBg = getCachedVideo(toCdnUrl(rawBg))
            updates.orbitalCardBgIsVideo = true
          }
        } else {
          updates.orbitalCardBg = optimizeImageUrl(rawBg, 'medium')
          updates.orbitalCardBgIsVideo = false
        }
      }
      if (card.metrics) {
        updates.orbitalLiveStats = {
          activeNodes: card.metrics.activeNodes || this.data.orbitalLiveStats.activeNodes,
          bandwidth: card.metrics.bandwidth || this.data.orbitalLiveStats.bandwidth,
          uptime: card.metrics.uptime || this.data.orbitalLiveStats.uptime
        }
      }
      if (typeof card.enabled === 'boolean') updates.orbitalCardEnabled = card.enabled
      if (card.badge) updates.orbitalCardBadge = card.badge
      if (card.titleEn) updates.orbitalCardTitleEn = card.titleEn
      if (card.titleCn) updates.orbitalCardTitleCn = card.titleCn
      if (card.desc) updates.orbitalCardDesc = card.desc
      if (card.ctaText) updates.orbitalCardCta = card.ctaText
    }
    if (detail) {
      try {
        const app = getApp()
        if (app) app.globalData = app.globalData || {}
        if (app && app.globalData) app.globalData.orbitalDetailConfig = detail
      } catch (e) {}
    }
    if (Object.keys(updates).length) this.setData(updates)
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

  /** 进页面先用上次成功的天气数据渲染（stale-while-revalidate），网络刷新随后进行 */
  _hydrateStarbaseWeatherFromCache() {
    if (this.data.starbaseWeather && this.data.starbaseWeather.loaded) return
    const MAX_STALE_MS = 3 * 60 * 60 * 1000
    const FRESH_MS = 10 * 60 * 1000
    wx.getStorage({
      key: '_starbase_weather_cache',
      success: (res) => {
        const cached = res.data
        if (!cached || !cached.payload || !cached.ts) return
        if (Date.now() - cached.ts > MAX_STALE_MS) return
        if (this.data.starbaseWeather && this.data.starbaseWeather.loaded) return
        this.setData({ starbaseWeather: { ...cached.payload, loading: false, error: '' } })
        // 命中新鲜缓存时视为已加载，短期内不再发起网络请求
        if (Date.now() - cached.ts < FRESH_MS) {
          this._starbaseWeatherCacheAt = cached.ts
        }
      },
      fail: () => {}
    })
  },

  /**
   * 博卡奇卡（Starbase）实况天气：观测时刻显示为 CST（中国标准时间 UTC+8），实况/气温/风速仍为当地观测值
   * @param {boolean} forceRefresh 为 true 时下拉刷新跳过短期缓存
   */
  loadStarbaseWeather(forceRefresh) {
    const CACHE_MS = 10 * 60 * 1000
    const now = Date.now()
    if (this._starbaseWeatherInFlight) return Promise.resolve()
    if (
      !forceRefresh &&
      this._starbaseWeatherCacheAt &&
      now - this._starbaseWeatherCacheAt < CACHE_MS &&
      this.data.starbaseWeather &&
      this.data.starbaseWeather.loaded
    ) {
      return Promise.resolve()
    }
    this._starbaseWeatherInFlight = true
    const prev = this.data.starbaseWeather || {}
    this.setData({
      starbaseWeather: {
        ...prev,
        loading: true,
        error: ''
      }
    })

    const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=25.9971&longitude=-97.1564&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia/Shanghai&wind_speed_unit=kmh'

    return new Promise((resolve, reject) => {
      wx.request({
        url: weatherUrl,
        method: 'GET',
        timeout: 15000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            reject(new Error('HTTP ' + res.statusCode))
          }
        },
        fail: (err) => reject(err || new Error('request:fail'))
      })
    })
      .then((data) => {
        const cur = data && data.current
        if (!cur || typeof cur !== 'object') throw new Error('invalid current')
        const units = data.current_units || {}
        const tempUnit = units.temperature_2m || '°C'
        const windUnit = units.wind_speed_10m || ''
        const code = Number(cur.weather_code)
        const wxMap = this._mapWeatherCode(code)
        const tempVal = cur.temperature_2m
        const tempLine = tempVal != null && tempVal !== ''
          ? `${Number(tempVal).toFixed(1).replace(/\.0$/, '')}${tempUnit}`
          : '—'
        const ws = cur.wind_speed_10m
        const windLine = ws != null && ws !== ''
          ? `${Number(ws).toFixed(1).replace(/\.0$/, '')}${windUnit ? ` ${windUnit}` : ''}`
          : '—'
        const timeLine = cur.time ? `${cur.time.replace('T', ' ').trim()} CST` : ''
        const payload = {
          loaded: true,
          loading: false,
          error: '',
          timeLine,
          conditionText: wxMap.text,
          tempLine,
          windLine,
          weatherIcon: wxMap.icon,
          windIcon: '/images/starbase-weather/wind-lines.svg'
        }
        this._starbaseWeatherCacheAt = Date.now()
        this.setData({ starbaseWeather: payload })
        // 持久化：下次进页面先展示上次数据，避免等待跨境请求
        try {
          wx.setStorage({ key: '_starbase_weather_cache', data: { payload, ts: Date.now() }, fail: () => {} })
        } catch (e) {}
      })
      .catch((err) => {
        const had = !!(prev && prev.loaded)
        console.warn('[monitor] starbase weather error:', err)
        if (!had && !this._starbaseWeatherRetried) {
          this._starbaseWeatherRetried = true
          this._starbaseWeatherInFlight = false
          setTimeout(() => this.loadStarbaseWeather(true), 4000)
          return
        }
        this._starbaseWeatherRetried = false
        this.setData({
          starbaseWeather: {
            ...prev,
            loading: false,
            error: had ? '' : '天气暂时不可用'
          }
        })
      })
      .finally(() => {
        this._starbaseWeatherInFlight = false
      })
  },

  _mapWeatherCode(code) {
    const c = Number(code)
    const base = '/images/starbase-weather/'
    if (!Number.isFinite(c)) return { text: '未知', icon: base + 'w-unknown.svg' }
    if (c === 0) return { text: '晴朗', icon: base + 'w-clear.svg' }
    if (c === 1) return { text: '大部晴朗', icon: base + 'w-mainly-clear.svg' }
    if (c === 2) return { text: '多云', icon: base + 'w-partly.svg' }
    if (c === 3) return { text: '阴', icon: base + 'w-overcast.svg' }
    if (c === 45 || c === 48) return { text: '雾', icon: base + 'w-fog.svg' }
    if (c >= 51 && c <= 57) return { text: '毛毛雨', icon: base + 'w-drizzle.svg' }
    if (c >= 61 && c <= 67) return { text: '雨', icon: base + 'w-rain.svg' }
    if (c >= 71 && c <= 77) return { text: '雪', icon: base + 'w-snow.svg' }
    if (c >= 80 && c <= 82) return { text: '阵雨', icon: base + 'w-rain.svg' }
    if (c === 85 || c === 86) return { text: '阵雪', icon: base + 'w-snow.svg' }
    if (c >= 95 && c <= 99) return { text: '雷暴', icon: base + 'w-thunder.svg' }
    return { text: '未知', icon: base + 'w-unknown.svg' }
  },

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

  // ========== 可回收火箭族谱 ==========
  async loadBoosterGenealogy() {
    this.setData({ boosterLoading: true, boosterLoadError: false })
    try {
      // 非会员 Tab：只预览 2 条 + 最多 1 批库读，全量留给门控后的族谱页
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = boosterDisplay.TAB_PREVIEW_COUNT || 2
      var results = await Promise.all([
        getBoosterGenealogy(previewOnly
          ? { previewOnly: true, previewLimit: previewLimit }
          : undefined),
        getRocketConfigMeta().catch(function () { return { configs: {} } })
      ])
      var list = results[0]
      var configMeta = results[1] || { configs: {} }
      if (!list || list.length === 0) {
        this.setData({ boosterLoading: false })
        return
      }
      var result = boosterDisplay.processBoosterList(list, configMeta.configs, {
        imageCacheLimit: previewLimit
      })
      // 原始数据只给详情页跳转用，存实例变量，不进 setData（体积大、渲染层用不到）
      this._boosterRawBySerial = result.rawBySerial
      this._boosterAllProcessed = result.processed
      this._boosterPreviewOnly = previewOnly
      this.setData({
        boosterFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : boosterDisplay.buildBoosterFilterChips(result.processed),
        boosterLoading: false
      })
      this.applyBoosterFilter(this.data.boosterFilter || 'all')
    } catch (err) {
      console.error('[Monitor] booster load error:', err)
      // 区分「加载失败」与「暂无数据」，失败态给重试入口
      this.setData({ boosterLoading: false, boosterLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applyBoosterFilter(filterId) {
    var all = this._boosterAllProcessed || []
    var filtered = boosterDisplay.applyBoosterFilter(all, filterId)
    var previewLimit = boosterDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._boosterPreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      boosterFilter: filterId,
      boosterList: list,
      boosterStats: boosterDisplay.computeBoosterStats(filtered),
      boosterFilterEmpty: all.length > 0 && filtered.length === 0,
      boosterImageLoadedMap: {}
    })
  },

  onBoosterFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.boosterFilter) return
    this.applyBoosterFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏族谱页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllBoosters() {
    const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.boosterFilter || 'all'
    navigateTo(ROUTES.BOOSTER_GENEALOGY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetryBoosterLoad() {
    this.loadBoosterGenealogy()
  },

  // ========== 全球飞船图鉴（骨架镜像可回收火箭族谱） ==========
  async loadSpacecraftGallery() {
    this.setData({ spacecraftLoading: true, spacecraftLoadError: false })
    try {
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = spacecraftDisplay.TAB_PREVIEW_COUNT || 2
      var list = await spacecraftDisplay.loadSpacecraftList()
      if (!list || list.length === 0) {
        this.setData({ spacecraftLoading: false })
        return
      }
      // 非会员：只对预览条做图缓存预热，避免进 Tab 全量 COS 下行
      var cards = spacecraftDisplay.buildSpacecraftCards(list, {
        imageCacheLimit: previewLimit
      })
      this._spacecraftAllCards = cards
      this._spacecraftPreviewOnly = previewOnly
      this.setData({
        spacecraftFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : spacecraftDisplay.buildSpacecraftFilterChips(cards),
        spacecraftLoading: false
      })
      this.applySpacecraftFilter(this.data.spacecraftFilter || 'all')
    } catch (err) {
      console.error('[Monitor] spacecraft load error:', err)
      this.setData({ spacecraftLoading: false, spacecraftLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applySpacecraftFilter(filterId) {
    var all = this._spacecraftAllCards || []
    var filtered = spacecraftDisplay.applySpacecraftFilter(all, filterId)
    var previewLimit = spacecraftDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._spacecraftPreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      spacecraftFilter: filterId,
      spacecraftList: list,
      spacecraftStats: spacecraftDisplay.computeSpacecraftStats(filtered),
      spacecraftFilterEmpty: all.length > 0 && filtered.length === 0
    })
  },

  onSpacecraftFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.spacecraftFilter) return
    this.applySpacecraftFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏图鉴页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllSpacecraft() {
    const allowed = await gateCheck('spacecraft_encyclopedia', '全球飞船图鉴')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.spacecraftFilter || 'all'
    navigateTo(ROUTES.SPACECRAFT_GALLERY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetrySpacecraftLoad() {
    this.loadSpacecraftGallery()
  },

  /** 飞船卡片图片加载失败：沿兜底链切换（缩略图 404 时回退原图） */
  onSpacecraftImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.spacecraftList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['spacecraftList[' + index + '].imageUrl']: spacecraftDisplay.cachedImage(fallbacks[0]),
      ['spacecraftList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击飞船卡片 → 会员门控 → 跳转飞船详情页（复用现有 spacecraft-detail） */
  async onSpacecraftCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    var id = ds.id
    if (id == null || id === '') return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('spacecraft_encyclopedia', '全球飞船图鉴')
    if (!allowed) return
    // 卡片当前已显示的图（可能是本地缓存路径）直传详情页，头图复用同一张不再加载
    if (ds.img) {
      var app = getApp && getApp()
      if (app) app._spacecraftHeroImage = { id: String(id), src: ds.img }
    }
    var params = { id: id }
    if (ds.name) params.name = ds.name
    navigateTo(ROUTES.SPACECRAFT_DETAIL, params)
  },

  // ========== 全球发射场分布（骨架镜像全球飞船图鉴） ==========
  async loadLaunchSiteGallery() {
    this.setData({ launchSiteLoading: true, launchSiteLoadError: false })
    try {
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = launchSiteDisplay.TAB_PREVIEW_COUNT || 2
      var list = await launchSiteDisplay.loadLaunchSiteList()
      if (!list || list.length === 0) {
        this.setData({ launchSiteLoading: false })
        return
      }
      var cards = launchSiteDisplay.buildLaunchSiteCards(list, {
        imageCacheLimit: previewLimit
      })
      this._launchSiteAllCards = cards
      this._launchSitePreviewOnly = previewOnly
      this.setData({
        launchSiteFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : launchSiteDisplay.buildLaunchSiteFilterChips(cards),
        launchSiteLoading: false
      })
      this.applyLaunchSiteFilter(this.data.launchSiteFilter || 'all')
    } catch (err) {
      console.error('[Monitor] launch site load error:', err)
      this.setData({ launchSiteLoading: false, launchSiteLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applyLaunchSiteFilter(filterId) {
    var all = this._launchSiteAllCards || []
    var filtered = launchSiteDisplay.applyLaunchSiteFilter(all, filterId)
    var previewLimit = launchSiteDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._launchSitePreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      launchSiteFilter: filterId,
      launchSiteList: list,
      launchSiteStats: launchSiteDisplay.computeLaunchSiteStats(filtered),
      launchSiteFilterEmpty: all.length > 0 && filtered.length === 0
    })
  },

  onLaunchSiteFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.launchSiteFilter) return
    this.applyLaunchSiteFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏发射场页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllLaunchSites() {
    const allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.launchSiteFilter || 'all'
    navigateTo(ROUTES.LAUNCH_SITE_GALLERY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetryLaunchSiteLoad() {
    this.loadLaunchSiteGallery()
  },

  /** 发射场卡片图片加载失败：沿兜底链切换（卫星图 404 时回退实景图） */
  onLaunchSiteImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.launchSiteList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['launchSiteList[' + index + '].imageUrl']: launchSiteDisplay.cachedImage(fallbacks[0]),
      ['launchSiteList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击发射场卡片 → 全屏预览卫星图（LL2 无发射场详情页可跳，看大图最直观） */
  /** 点击发射场卡片 → 会员门控（复用全球飞船图鉴逻辑）→ 发射场详情页 */
  async onLaunchSiteCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    if (!ds.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证
    const allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
    if (!allowed) return
    navigateTo(ROUTES.LAUNCH_SITE_DETAIL, { id: ds.id })
  },

  // ========== Starlink 过境预报 ==========
  async _getPassLocation() {
    var app = getApp && getApp()
    if (app && typeof app.ensurePrivacyAuthorized === 'function') {
      var privacyRes = await app.ensurePrivacyAuthorized()
      if (privacyRes && privacyRes.ok === false) {
        return { ok: false, needsSetting: false, message: '请先同意隐私指引后再获取位置' }
      }
    }

    var settingRes = await new Promise(function (resolve) {
      wx.getSetting({ success: resolve, fail: function () { resolve(null) } })
    })
    if (!settingRes) {
      return { ok: false, needsSetting: false, message: '无法获取权限状态，请稍后重试' }
    }

    var authStatus = settingRes.authSetting['scope.userFuzzyLocation']
    if (authStatus === false) {
      return { ok: false, needsSetting: true, message: '请在设置中开启位置权限后重试' }
    }

    var locRes = await new Promise(function (resolve) {
      wx.getFuzzyLocation({
        type: 'wgs84',
        success: function (res) { resolve({ ok: true, data: res }) },
        fail: function (err) { resolve({ ok: false, err: err }) }
      })
    })

    if (!locRes || !locRes.ok || !locRes.data) {
      var errMsg = locRes && locRes.err && (locRes.err.errMsg || locRes.err.message) ? (locRes.err.errMsg || locRes.err.message) : ''
      var isPermDenied = errMsg.indexOf('auth deny') !== -1 || errMsg.indexOf('auth denied') !== -1 || errMsg.indexOf('permission denied') !== -1 || errMsg.indexOf('system permission') !== -1
      return {
        ok: false,
        needsSetting: authStatus === false || isPermDenied,
        message: isPermDenied ? '系统定位权限未开启，请在设置中允许' : (errMsg || '定位获取失败，请稍后重试')
      }
    }

    return { ok: true, data: locRes.data }
  },

  /** 用户点击「加载」按钮触发过境预报 */
  onLoadStarlinkPasses() {
    this.setData({ passReady: true })
    this.loadStarlinkPasses()
  },

  async loadStarlinkPasses() {
    var that = this
    // in-flight 去重：刷新按钮 / 权限回调可能并行触发，避免重复的 CPU 密集计算与云读
    if (this._passLoadInFlight) return
    this._passLoadInFlight = true
    this.setData({ passLoading: true, passNoLocation: false, passError: '', passList: [], passReady: true })

    try {
      var locState = await this._getPassLocation()
      if (!locState.ok) {
        that.setData({
          passLoading: false,
          passNoLocation: true,
          passLocation: '',
          passError: locState.message || '需要位置权限'
        })
        return
      }

      var observer = { lat: locState.data.latitude, lng: locState.data.longitude, alt: locState.data.altitude || 0 }
      that.data._passObserver = observer
      that.setData({
        passLocation: observer.lat.toFixed(2) + '°N, ' + observer.lng.toFixed(2) + '°E',
        passError: ''
      })

      // 3. 获取 TLE 数据（优先复用 Starlink 渲染器已加载的数据）
      //    统一选星策略：历元 7 天内、按 NORAD ID 倒序取最新 400 颗
      var tleData = []
      var tleStale = false // 有原始数据但历元全部超 7 天 / 源数据超 7 天未更新

      // 尝试从渲染器获取已解析的 satrec 列表（避免重复读取云数据库）
      var starlinkRenderer = getStarlinkRenderer()
      if (!starlinkRenderer) {
        try { starlinkRenderer = await loadStarlinkRenderer() } catch (e) {
          console.warn('[Pass] loadStarlinkRenderer failed:', e)
        }
      }
      var sharedSatrecs = starlinkRenderer ? starlinkRenderer.getSharedSatrecList() : []
      if (sharedSatrecs && sharedSatrecs.length > 0) {
        var sampled = starlinkPass.selectNewestSatrecs(sharedSatrecs, STARLINK_PASS_MAX_SATS)
        tleData = sampled.map(function (s) { return { _satrec: s.satrec, name: s.name } })
        if (tleData.length === 0) {
          tleStale = true
          // 内存/本地缓存里的星历元全部超龄：清掉共享数据与缓存，
          // 让下面的 loadData 绕过 6h 缓存直接回源云端（云端可能已有新数据）
          if (typeof starlinkRenderer.resetSharedData === 'function') {
            starlinkRenderer.resetSharedData()
          }
        }
      }

      // 如果渲染器没有数据，通过渲染器的 loadData 再尝试一次
      if (tleData.length === 0 && starlinkRenderer && typeof starlinkRenderer.loadData === 'function') {
        try {
          await starlinkRenderer.loadData()
          var retryList = starlinkRenderer.getSharedSatrecList()
          if (retryList && retryList.length > 0) {
            var retrySampled = starlinkPass.selectNewestSatrecs(retryList, STARLINK_PASS_MAX_SATS)
            tleData = retrySampled.map(function (s) { return { _satrec: s.satrec, name: s.name } })
            tleStale = tleData.length === 0
          }
        } catch (e) {
          console.warn('[Pass] starlinkRenderer.loadData retry failed:', e)
        }
      }

      // 最后回退：从本地缓存或云数据库直接读 TLE 文本
      if (tleData.length === 0) {
        try {
          // 该 key 由 starlink-renderer / starlink-ar 用 wx.setStorageSync 直写，
          // 不能走 storage-sync-cache 内存层（首读后驻留，会读到会话内的旧值）
          var cached = wx.getStorageSync(STARLINK_TLE_CACHE_KEY)
          if (cached && cached.ver === STARLINK_TLE_CACHE_VER && cached.data && Date.now() - cached.ts < STARLINK_TLE_CACHE_TTL) {
            var rawList = []
            var rawData = cached.data
            if (typeof rawData === 'string') {
              var lines = rawData.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var i = 0; i + 2 < lines.length; i += 3) {
                rawList.push({ name: lines[i].trim(), line1: lines[i + 1].trim(), line2: lines[i + 2].trim() })
              }
            } else if (Array.isArray(rawData)) {
              rawList = rawData
            }
            if (rawList.length > 0) {
              tleData = starlinkPass.selectNewestTLEs(rawList, STARLINK_PASS_MAX_SATS)
              tleStale = tleData.length === 0
            }
          }
        } catch (e) {}
      }

      if (tleData.length === 0) {
        try {
          var db = wx.cloud.database()
          var shardIndex = 0
          var allLines = []
          // 先读 shard0 判断格式
          var shard0Res = await db.collection('starlink_tle').where({ shardIndex: 0 }).limit(1).get()
          if (shard0Res.data && shard0Res.data.length > 0) {
            var shard0 = shard0Res.data[0]
            if (shard0.updatedAtMs && Date.now() - shard0.updatedAtMs > starlinkPass.TLE_MAX_AGE_MS) {
              tleStale = true
            }
            if (shard0.shardCount) {
              // 新分片格式：并行读取所有分片
              var shardPromises = [Promise.resolve(shard0.data || '')]
              for (var si = 1; si < shard0.shardCount; si++) {
                shardPromises.push(
                  db.collection('starlink_tle').where({ shardIndex: si }).limit(1).get()
                    .then(function (res) { return res.data.length > 0 ? res.data[0].data : '' })
                    .catch(function () { return '' })
                )
              }
              var shardArr = await Promise.all(shardPromises)
              var mergedTle = shardArr.filter(Boolean).join('\n')
              var mLines = mergedTle.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var mi = 0; mi + 2 < mLines.length; mi += 3) {
                allLines.push({ name: mLines[mi].trim(), line1: mLines[mi + 1].trim(), line2: mLines[mi + 2].trim() })
              }
            } else if (shard0.data && typeof shard0.data === 'string') {
              // 旧格式循环读取
              var oldLines = shard0.data.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var oi = 0; oi + 2 < oldLines.length; oi += 3) {
                allLines.push({ name: oldLines[oi].trim(), line1: oldLines[oi + 1].trim(), line2: oldLines[oi + 2].trim() })
              }
              shardIndex = 1
              while (shardIndex < 10) {
                var nextRes = await db.collection('starlink_tle').where({ shardIndex: shardIndex }).limit(1).get()
                if (!nextRes.data || nextRes.data.length === 0) break
                var nextShard = nextRes.data[0]
                if (nextShard.data && typeof nextShard.data === 'string') {
                  var nLines = nextShard.data.split('\n').filter(function (l) { return l.trim() !== '' })
                  for (var ni = 0; ni + 2 < nLines.length; ni += 3) {
                    allLines.push({ name: nLines[ni].trim(), line1: nLines[ni + 1].trim(), line2: nLines[ni + 2].trim() })
                  }
                }
                shardIndex++
              }
            }
          }
          tleData = starlinkPass.selectNewestTLEs(allLines, STARLINK_PASS_MAX_SATS)
          if (allLines.length > 0 && tleData.length === 0) tleStale = true
          if (tleData.length > 0) {
            storageCache.persistAsync(STARLINK_TLE_CACHE_KEY, { data: tleData, ts: Date.now(), ver: STARLINK_TLE_CACHE_VER })
          }
        } catch (e) {
          console.error('[Pass] TLE cloud load error:', e)
        }
      }

      if (tleData.length === 0) {
        that.setData({
          passLoading: false,
          passList: [],
          passError: tleStale
            ? '星链轨道数据已陈旧（超 7 天未更新），暂无法计算过境，请稍后再试'
            : '星链轨道数据暂时无法获取，请检查网络后重试'
        })
        return
      }

      if (!starlinkPass || typeof starlinkPass.predictPasses !== 'function') {
        that.setData({ passLoading: false, passError: '过境计算模块异常，请重启小程序' })
        return
      }
      // 优先分片异步版：每 20 颗卫星让出一次主线程，避免长时间阻塞 UI
      var passes = typeof starlinkPass.predictPassesAsync === 'function'
        ? await starlinkPass.predictPassesAsync(tleData, observer, 24)
        : starlinkPass.predictPasses(tleData, observer, 24)

      var formatted = passes.slice(0, 10).map(function (p, idx) {
        var d = new Date(p.startTime)
        var h = d.getHours()
        var m = d.getMinutes()
        return {
          idx: idx,
          startTimeStr: (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m,
          maxElev: Math.round(p.maxElev),
          startDirection: p.startDirection,
          endDirection: p.endDirection,
          durationMin: Math.round(p.duration / 60),
          brightness: p.brightness,
          brightnessText: p.brightnessText,
          trainCount: p.trainCount || 1
        }
      })
      that.setData({ passList: formatted, passLoading: false, passNoLocation: false })
    } catch (err) {
      console.error('[Pass] error:', err)
      var errMsg = (err && (err.message || err.errMsg)) || ''
      var hasLocation = !!(that.data._passObserver || that.data.passLocation)
      var displayError = '过境预报加载失败，请稍后重试'
      if (errMsg.indexOf('No TLE') !== -1 || errMsg.indexOf('satellite') !== -1) {
        displayError = '星链轨道数据异常，请稍后重试'
      } else if (errMsg.indexOf('require') !== -1 || errMsg.indexOf('module') !== -1) {
        displayError = '过境计算模块加载失败，请退出重进'
      }
      that.setData({
        passLoading: false,
        passNoLocation: !hasLocation,
        passError: displayError
      })
    } finally {
      this._passLoadInFlight = false
    }
  },

  requestPassLocation() {
    var that = this
    wx.getSetting({
      success: function (res) {
        var authStatus = res.authSetting['scope.userFuzzyLocation']
        if (authStatus === false) {
          wx.showModal({
            title: '需要位置权限',
            content: '过境预报需要您的位置来计算可见卫星，请在设置中开启位置权限',
            confirmText: '去设置',
            cancelText: '取消',
            success: function (modalRes) {
              if (!modalRes.confirm) return
              wx.openSetting({
                success: function (settingRes) {
                  if (settingRes.authSetting['scope.userFuzzyLocation']) {
                    that.loadStarlinkPasses()
                  } else {
                    that.setData({
                      passNoLocation: true,
                      passLocation: '',
                      passError: '未开启位置权限，暂时无法计算过境预报'
                    })
                  }
                },
                fail: function () {
                  that.setData({
                    passNoLocation: true,
                    passLocation: '',
                    passError: '打开设置失败，请稍后重试'
                  })
                }
              })
            }
          })
          return
        }

        // authStatus 为 undefined 或 true，直接调用 loadStarlinkPasses（其内部会 getFuzzyLocation）
        that.loadStarlinkPasses()
      },
      fail: function () {
        that.setData({
          passNoLocation: true,
          passLocation: '',
          passError: '无法获取权限状态，请稍后重试'
        })
      }
    })
  },

  refreshPasses() {
    this.loadStarlinkPasses()
  },

  openPassDetail() {
    if (!this.data.passReady) {
      this.onLoadStarlinkPasses()
      return
    }
    if (this.data.passLoading) return
    if (this.data.passNoLocation || this.data.passError) {
      if (this.data.passNoLocation) this.requestPassLocation()
      else this.refreshPasses()
      return
    }

    try {
      wx.setStorageSync(PASS_DETAIL_STORAGE_KEY, {
        passList: this.data.passList || [],
        passLocation: this.data.passLocation || '',
        observer: this.data._passObserver || null,
        updatedAt: Date.now()
      })
    } catch (e) {}

    navigateTo(ROUTES.STARLINK_PASS_DETAIL)
  },

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

  async openPassMap() {
    if (this._gateChecking) return
    this._gateChecking = true
    let allowed = false
    try {
      allowed = await gateCheck('starlink_pro', '24小时过境预报')
    } finally {
      this._gateChecking = false
    }
    if (!allowed) return

    const passList = this.data.passList || []
    const firstPass = passList[0]
    if (!firstPass) {
      wx.showToast({ title: '暂无可用过境数据', icon: 'none' })
      return
    }
    const observer = this.data._passObserver || {}
    const encodedPassList = encodeURIComponent(JSON.stringify(passList.slice(0, 10)))
    const query = [
      'startTimeStr=' + encodeURIComponent(firstPass.startTimeStr || ''),
      'maxElev=' + encodeURIComponent(firstPass.maxElev || 0),
      'startDirection=' + encodeURIComponent(firstPass.startDirection || ''),
      'endDirection=' + encodeURIComponent(firstPass.endDirection || ''),
      'durationMin=' + encodeURIComponent(firstPass.durationMin || 0),
      'brightnessText=' + encodeURIComponent(firstPass.brightnessText || ''),
      'trainCount=' + encodeURIComponent(firstPass.trainCount || 1),
      'lat=' + encodeURIComponent(observer.lat || ''),
      'lng=' + encodeURIComponent(observer.lng || ''),
      'locationText=' + encodeURIComponent(this.data.passLocation || ''),
      'passList=' + encodedPassList
    ].join('&')
    wx.navigateTo({ url: ROUTES.PASS_MAP + '?' + query })
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
      this.setData({
        stationList: stationList || [],
        stationLoading: false,
        stationImageLoadedMap: {}
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
    this.setData({
      [`stationList[${index}].image`]: '',
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
  },

  /** 中度震动反馈 */
  _vibrateMedium() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {
      try { wx.vibrateShort() } catch (_) {}
    }
  },

  /** 助推器横向滚动震动 */
  onBoosterScroll(e) {
    var scrollLeft = e.detail.scrollLeft || 0
    var cardPitch = this._rpxToPx(296)
    var newIndex = Math.round(scrollLeft / cardPitch)
    if (newIndex < 0) newIndex = 0
    if (newIndex === this._boosterHapticIndex) return
    this._boosterHapticIndex = newIndex
    var now = Date.now()
    if (this._lastBoosterVibrateAt && now - this._lastBoosterVibrateAt < 200) return
    this._lastBoosterVibrateAt = now
    this._vibrateMedium()
  },

  /** rpx 转 px（缓存 windowWidth 避免重复调用 getSystemInfoSync） */
  _rpxToPx(rpx) {
    if (!this._cachedWindowWidth) {
      var info = getSystemInfo()
      this._cachedWindowWidth = (info && info.windowWidth) || 375
    }
    return rpx / 750 * this._cachedWindowWidth
  },

  /** 助推器卡片图片加载完成 */
  onBoosterImageLoad(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var key = 'boosterImageLoadedMap.' + index
    this.setData({ [key]: true })
  },

  /** 助推器卡片图片加载失败：沿多级兜底链逐级切换，链耗尽则清空显示占位符 */
  onBoosterImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.boosterList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['boosterList[' + index + '].thumbnailUrl']: fallbacks[0] || '',
      ['boosterList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击助推器卡片 → 会员门控（复用星舰硬件设施逻辑）→ 跳转详情页 */
  async onBoosterCardTap(e) {
    var serial = e.currentTarget.dataset.serial
    if (!serial) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    // 原始数据在实例变量中（不进 setData）
    var raw = (this._boosterRawBySerial && this._boosterRawBySerial[serial]) || null
    if (raw) {
      // 将原始数据存入全局临时变量，详情页读取
      var app = getApp && getApp()
      if (app) app._boosterDetailData = raw
    }
    wx.navigateTo({
      url: ROUTES.BOOSTER_DETAIL + '?serial=' + encodeURIComponent(serial)
    })
  },

  // ========== 全球发射商图鉴（默认展示 2 张预览卡） ==========

  /**
   * 加载发射商预览（轻量）：只读 featured 聚合缓存（1 个云文档），默认展示 2 张卡；
   * 全量数据只在用户点「查看全部」进入完整列表页时才加载
   */
  async loadAgencies(opts = {}) {
    // silent（下拉刷新）：已有卡片时不回退到骨架网格
    const silent = !!(opts.silent && (this.data.agencyVisible || []).length > 0)
    this.setData(silent ? { agencyError: '' } : { agencyLoading: true, agencyError: '' })
    try {
      const { list, totalCount } = await getFeaturedAgencies()
      const featured = filterAgencies(list || [], 'featured', '')
      const pick = featured.length ? featured : (list || [])
      this.setData({
        agencyLoading: false,
        agencyError: '',
        agencyTotal: totalCount || 0,
        agencyVisible: pick.slice(0, 2).map(toDisplayRow)
      })
      this.tryOpenPendingAgencyDetail()
    } catch (e) {
      console.error('[Agency] loadAgencies error:', e)
      this.setData({ agencyLoading: false, agencyError: '加载失败，请稍后重试' })
    }
  },

  /** 卡片图加载失败：压缩链 → 原图 → logo → 占位，避免默认图空白 */
  onAgencyImageError(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const item = this.data.agencyVisible[idx]
    if (!item) return
    const cur = String(item.displayImage || '')
    const stripCi = (u) => {
      const s = String(u || '').trim()
      if (!s) return ''
      const q = s.indexOf('?')
      if (q < 0) return s
      if (!/imageMogr2|ci-process=/i.test(s.slice(q + 1))) return s
      return s.slice(0, q)
    }
    // 1) 当前是 imageMogr2/CI 压缩链 → 回退同图原链
    const stripped = stripCi(cur)
    if (stripped && stripped !== cur) {
      this.setData({ [`agencyVisible[${idx}].displayImage`]: stripped })
      return
    }
    // 2) 大图失败 → 换 logo（压缩版或原链）
    const logoCandidates = [item.logoUrl, item.logoUrlRaw].filter(Boolean)
    for (let i = 0; i < logoCandidates.length; i++) {
      const next = logoCandidates[i]
      if (next && next !== cur) {
        this.setData({
          [`agencyVisible[${idx}].displayImage`]: next,
          [`agencyVisible[${idx}].imageMode`]: 'aspectFit'
        })
        return
      }
    }
    // 3) logo 压缩链失败 → 再试 logo 原链（上面循环已覆盖）；都失败则占位
    if (item.displayImage) {
      this.setData({ [`agencyVisible[${idx}].displayImage`]: '' })
    }
  },

  /** 查看全部 → 完整列表页（全量数据在该页加载，含筛选与搜索）；与卡片点击共用同一门控 */
  async onViewAllAgencies() {
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    }
    wx.navigateTo({
      url: '/subpackages/monitor-pages/agency-list'
    })
  },

  /** 点击发射商卡片 → 跳转独立详情页 */
  async onAgencyTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    wx.navigateTo({
      url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(id)}`
    })
  },

  /** 尝试打开待展示的发射商详情（供搜索跳转后自动打开，globalData 内存交接） */
  tryOpenPendingAgencyDetail() {
    let pendingId = ''
    try {
      const app = getApp()
      if (app && app.globalData) {
        pendingId = app.globalData.pendingAgencyDetailId || ''
        if (pendingId) app.globalData.pendingAgencyDetailId = ''
      }
    } catch (e) {}
    if (!pendingId) return
    wx.navigateTo({
      url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(pendingId)}`
    })
  },

  /** 重试加载发射商 */
  retryLoadAgencies() {
    this.loadAgencies()
  }
})
