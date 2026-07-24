// pages/profile/profile.js
const { ROUTES } = require('../../utils/routes.js')
const { warmProfilePageStorageSync } = require('../../utils/page-storage-boot.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { getSubscribedMissions, unsubscribeLaunch, syncSubscribedMissions } = require('../../utils/subscribe.js')
const { resolveMissionRocketImage } = require('../../utils/util.js')
const { getMembershipState, isPro, isMembershipEnabled, MEMBER_ICONS, gateCheck } = require('../../utils/membership.js')
const { getFavoriteAgencies, removeFavoriteAgency } = require('../../utils/agency-favorites.js')
const themeUtil = require('../../utils/theme.js')
const { getCachedIcon, preloadIcons } = require('../../utils/icon-cache.js')

const GROWTH_ICONS = {
  BRIEFING: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%A4%AA%E7%A9%BA%E6%8E%A2%E7%B4%A2%E7%94%9F%E6%88%90%E8%83%8C%E6%99%AF%E5%9B%BE/1778755615793_c11otc.png',
  TIMELINE: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%A4%AA%E7%A9%BA%E6%8E%A2%E7%B4%A2%E7%94%9F%E6%88%90%E8%83%8C%E6%99%AF%E5%9B%BE/1778755614206_yklby8.png'
}

const { getUiShellLayout } = require('../../utils/layout.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')

// ========== 低频非首屏逻辑：在 profile-extra 分包（profile-lazy.js） ==========
// 竞猜战绩、里程碑彩蛋、服务号提醒、奖品、年鉴、客服区块均为 onShow 后异步触发或用户点击触发，
// require.async + attachTo 委托加载；profile 页在 preloadRule 中预下载 profile-extra 分包，实际几乎无加载等待
const PROFILE_LAZY_PKG = '../../subpackages/profile-extra/utils/profile-lazy.js'
const PROFILE_LAZY_METHODS = [
  'bootCheckinAndQuiz',
  'refreshCheckinUI',
  'onCheckIn',
  'loadDailyQuiz',
  'onQuizSelect',
  'syncCloudProfile',
  'loadVoteStats',
  '_enrichVoteHistory',
  'onVoteHistoryRocketImageError',
  'onVoteHistoryTap',
  'onToggleVoteHistory',
  'onClearVoteHistory',
  '_doClearVoteHistory',
  'checkMilestones',
  '_showNextMilestone',
  'onMilestoneClose',
  'onMilestoneClaimed',
  'loadOaAlertStatus',
  'onOaAlertSwitch',
  'onCopyOaName',
  '_enrichIncompleteReminders',
  'loadMyPrizes',
  'onCopyTracking',
  'onCopyWechat',
  'onContactCallback',
  'onShareFigma',
  'loadYearReviewEntry',
  'goYearReview',
  'loadAboutConfig'
]

// profile-sections 分包组件（我的提醒 / 竞猜战绩 / 每日问答 / 在线客服）回传事件白名单
const SECTION_EVENT_METHODS = [
  'goPreferences',
  'onOaAlertSwitch',
  'onCopyOaName',
  'onReminderTap',
  'onCancelReminder',
  'onGoAstroCalendar',
  'onVoteHistoryTap',
  'onVoteHistoryRocketImageError',
  'onClearVoteHistory',
  'onToggleVoteHistory',
  'onQuizSelect',
  'onCopyWechat',
  'onContactCallback',
  'onShareFigma'
]
function delegateProfileLazy(name) {
  return function (...args) {
    const page = this
    if (page.__profileLazyAttached) return page[name](...args)
    if (!page.__profileLazyLoadPromise) {
      page.__profileLazyLoadPromise = require.async(PROFILE_LAZY_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__profileLazyLoadPromise = null
        console.error('[Profile] 分包模块加载失败:', err)
        throw err
      })
    }
    return page.__profileLazyLoadPromise.then(() => page[name](...args))
  }
}
const profileLazyDelegates = {}
PROFILE_LAZY_METHODS.forEach((name) => {
  profileLazyDelegates[name] = delegateProfileLazy(name)
})

Page({
  ...profileLazyDelegates,
  data: {
    themeClass: '',
    themeLight: false,
    scrollRefreshing: false,
    themeMode: 'dark',
    pageBgColor: '#000000',
    popupAdItem: null,
    popupAdVisible: false,
    statusBarHeight: 44,
    isAndroid: false,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    // 签到
    checkinSummary: { totalDays: 0, currentStreak: 0, factsCollected: 0, totalFacts: 60, isCheckedInToday: false },
    weekDots: [],
    todayFact: null,
    showFactCard: false,
    // 成就
    achievementInfo: { achievements: [], unlockedCount: 0, totalCount: 0 },
    showBadgeModal: false,
    badgeModalData: {},
    // 我的收藏（发射商）
    myFavorites: [],
    // 我的提醒
    myReminders: [],
    oaAlertEnabled: false,
    oaAlertFollowed: false,
    oaAlertReady: false,
    oaAlertMessage: '',
    oaAlertLoading: false,
    // 每日问答
    quizQuestion: null,
    quizAnswered: false,
    quizSelectedIndex: -1,
    quizResult: null,
    quizStats: { correctCount: 0, totalAnswered: 0, accuracy: 0 },
    // 竞猜统计
    voteStats: { total: 0, settled: 0, correct: 0, accuracy: 0, streak: 0, bestStreak: 0 },
    voteHistory: [],
    voteHistoryExpanded: false,
    // 在线客服（原「关于我们」）
    aboutText: '太空爱好者小程序，bug 比火箭发射还准时。没有团队，有问题欢迎加微信吐槽，没问题也欢迎来聊。',
    aboutWechat: 'huyuzecoin',
    figmaShareEnabled: false,
    // 会员
    membershipEnabled: false,
    memberIsPro: false,
    memberIcon: '',
    briefingIcon: '',
    timelineIcon: '',
    // 年度报告（后台配置时间窗）
    yearReviewVisible: false,
    yearReviewTitle: '',
    yearReviewSubtitle: '',
    yearReviewYear: new Date().getFullYear(),
    // 里程碑彩蛋
    showMilestoneEgg: false,
    currentMilestone: {},
    _milestoneQueue: [],
    myPrizes: []
  },

  onLoad() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 4,
        currentPath: '/pages/profile/profile'
      })
    }

    const deviceInfo = wx.getDeviceInfo()
    const windowInfo = wx.getWindowInfo()
    const systemInfo = Object.assign({}, deviceInfo, windowInfo, wx.getAppBaseInfo())
    const platform = String(deviceInfo.platform || '').toLowerCase()
    const app = getApp()
    const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(systemInfo)

    this.setData({
      statusBarHeight: uiShellLayout.statusBarHeight,
      isAndroid: platform.includes('android'),
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      tabBarReservedHeight: uiShellLayout.tabBarReservedHeight,
      themeClass: themeUtil.getThemeClassSync(),
      themeLight: themeUtil.isLightSync(),
      themeMode: themeUtil.getThemeModeSync(),
      pageBgColor: themeUtil.getPageBgSync()
    })
    this._profileBootPending = true
    this._profileShowRefreshPending = false
    try { warmProfilePageStorageSync() } catch (e) {}
    var self = this
    setTimeout(function () {
      self._runProfileBoot()
    }, 0)
  },

  _runProfileBoot() {
    if (!this._profileBootPending) return
    this._profileBootPending = false
    this._runProfileShowRefresh(true)
    this.syncCloudProfile()
    this.loadAboutConfig()
  },

  _runProfileShowRefresh(isBoot) {
    if (this._profileShowRefreshPending) return
    this._profileShowRefreshPending = true
    var self = this
    try { warmProfilePageStorageSync() } catch (e) {}

    this.bootCheckinAndQuiz()
    this.loadMyReminders()
    this.loadOaAlertStatus()
    this.loadVoteStats().then(function () {
      if (!isBoot) {
        setTimeout(function () { self.checkMilestones() }, 100)
      }
    })
    this.loadMyPrizes()
    this._loadMembershipEntry()
    this.loadYearReviewEntry()
    if (!isBoot) {
      tryShowPopupAd(4, this)
    } else {
      setTimeout(function () {
        self.checkMilestones()
        tryShowPopupAd(4, self)
      }, 100)
    }

    setTimeout(function () {
      self._profileShowRefreshPending = false
    }, 0)
  },

  onReady() {
    var self = this
    setTimeout(function () {
      self._loadGrowthIcons()
    }, 0)
  },

  onShow() {
    // 主题兜底同步（与其他 Tab 页一致）
    themeUtil.applyThemeToPage(this)
    try {
      const app = getApp && getApp()
      if (app && typeof app.syncAllTabBarsDesktopStrip === 'function') app.syncAllTabBarsDesktopStrip()
    } catch (e) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 4,
        currentPath: '/pages/profile/profile',
        showProfileDot: false
      })
      getApp().checkProgressDot(this.getTabBar())
      getApp().checkNewsDot(this.getTabBar())
    }

    // 收藏为本地读取零成本，从发射商详情页返回即刷新
    this.loadMyFavorites()

    if (this._profileBootPending) return

    var self = this
    setTimeout(function () {
      self._runProfileShowRefresh()
    }, 0)
  },

  /** ══ 外观：深色 / 浅色 / 跟随系统 三档切换 ══ */
  onThemeModeTap(e) {
    const mode = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || 'dark'
    if (mode === this.data.themeMode) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // setThemeMode 会遍历在栈页面（含本页）即时下发 themeClass / pageBgColor
    themeUtil.setThemeMode(mode)
    this.setData({ themeMode: mode })
  },

  /** ══ 我的收藏（发射商）══ */
  loadMyFavorites() {
    try {
      this.setData({ myFavorites: getFavoriteAgencies() })
    } catch (e) {}
  },

  async onFavoriteTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // 与全项目发射商入口门控一致
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    wx.navigateTo({ url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(id)}` })
  },

  onRemoveFavorite(e) {
    const ds = e.currentTarget.dataset
    const id = ds.id
    if (!id) return
    const self = this
    wx.showModal({
      title: '取消收藏',
      content: `确定取消收藏「${ds.name || '该发射商'}」吗？`,
      confirmText: '取消收藏',
      cancelText: '再想想',
      success(res) {
        if (!res.confirm) return
        removeFavoriteAgency(id)
        self.loadMyFavorites()
        wx.showToast({ title: '已取消收藏', icon: 'none' })
      }
    })
  },

  onPopupAdClose() {
    this.setData({ popupAdVisible: false, popupAdItem: null })
  },

  /** 原生三点下拉刷新（页面级 / scroll-view refresher 共用）：最多等 800ms 兜底复位 */
  onProfileScroll() {
    try {
      const { pulseNasaFloatOnScroll } = require('../../utils/nasa-float-scroll.js')
      pulseNasaFloatOnScroll(this)
    } catch (e) {}
  },

  onScrollRefresh() {
    this._runProfilePullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runProfilePullRefresh()
  },

  _runProfilePullRefresh(key) {
    runPullRefresh(this, () => {
      this.refreshCheckinUI()
      this.loadMyReminders()
      this.loadOaAlertStatus(true)
      this.loadDailyQuiz()
      return new Promise((resolve) => setTimeout(resolve, 800))
    }, key)
  },

  // ── 签到系统（实现在 profile-extra/profile-lazy：refreshCheckinUI / onCheckIn） ──

  _refreshProfileDot() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      getApp().checkProfileDot(this.getTabBar())
    }
  },

  closeFactCard() {
    this.setData({ showFactCard: false })
    setTimeout(() => {
      this.setData({ todayFact: null })
    }, 400)
  },

  onAchievementTap(e) {
    const index = e.currentTarget.dataset.index
    const achievements = this.data.achievementInfo.achievements || []
    const item = achievements[index]
    if (!item) return
    this.setData({ showBadgeModal: true, badgeModalData: item })
  },

  closeBadgeModal() {
    this.setData({ showBadgeModal: false })
  },

  /** profile-sections 分包组件统一事件通道：还原 currentTarget.dataset / detail 后分发 */
  onProfileSectionEvent(e) {
    const { name, dataset, edetail } = (e && e.detail) || {}
    if (!name || SECTION_EVENT_METHODS.indexOf(name) < 0 || typeof this[name] !== 'function') return
    return this[name]({ currentTarget: { dataset: dataset || {} }, detail: edetail || {} })
  },

  // ── 我的提醒 ──

  loadMyReminders(skipSync) {
    const today = new Date().toISOString().slice(0, 10)
    const nowMs = Date.now()
    const list = []
    const launches = getSubscribedMissions()
    this._cachedSubscribedMissions = launches
    launches.forEach(m => {
      // 老记录缺失信息时，从本地任务详情缓存补全
      let name = m.name
      let rocket = m.rocket
      let rocketImage = m.rocketImage
      let launchTime = m.launchTime
      let rocketConfiguration = m.rocketConfiguration || null

      if (!name || !rocket || !rocketImage || !launchTime || !rocketConfiguration) {
        const cached = this._getMissionFromLocalCache(m.id)
        if (cached) {
          if (!name || name === '未知任务' || name === '发射任务 #' + m.id) name = cached.missionName || cached.name || name
          if (!rocket) rocket = cached.rocketName || rocket
          if (!rocketImage) rocketImage = cached.rocketImage || cached.image || rocketImage
          if (!launchTime) launchTime = cached.launchTime || cached.windowStart || launchTime
          if (!rocketConfiguration) rocketConfiguration = cached.rocketConfiguration || null
        }
      }

      let launchMs = 0
      let launchDateStr = ''
      let dateLabel = '时间待定'
      let status = 'upcoming'

      if (launchTime) {
        launchMs = new Date(launchTime).getTime()
        const d = new Date(launchTime)
        launchDateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
        const h = String(d.getHours()).padStart(2, '0')
        const min = String(d.getMinutes()).padStart(2, '0')
        launchDateStr += ' ' + h + ':' + min
        // 时间轴节点标签：「7月12日 14:30」
        dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + h + ':' + min

        if (launchMs < nowMs) status = 'past'
        else if (launchMs - nowMs < 86400000) status = 'today'
      }

      const daysLeft = launchMs ? Math.ceil((launchMs - nowMs) / 86400000) : 0

      // 已过期的任务不再显示在提醒列表中
      if (status === 'past') return

      // 与首页卡片同源
      const rocketImg = resolveMissionRocketImage(rocketImage || '', rocket || '', rocketConfiguration, true)

      list.push({
        key: 'launch_' + m.id,
        type: 'launch',
        icon: '',
        rocketImg: rocketImg,
        title: name,
        rocketName: rocket || '',
        dateLabel: dateLabel,
        desc: (rocket ? rocket + ' · ' : '') + (launchDateStr || '时间待定'),
        date: launchDateStr,
        sortTime: launchMs || (nowMs + 999999999),
        status,
        missionId: m.id,
        daysLabel: status === 'today' ? '即将发射' : status === 'past' ? '已发射' : launchMs ? daysLeft + '天后' : '待定'
      })
    })

    // 排序：今天 > 即将，同类按时间升序（过期已过滤）
    list.sort((a, b) => {
      const order = { today: 0, upcoming: 1 }
      if ((order[a.status] || 0) !== (order[b.status] || 0)) return (order[a.status] || 0) - (order[b.status] || 0)
      return a.sortTime - b.sortTime
    })

    this.setData({ myReminders: list })

    if (!skipSync) {
      // 1) 先尝试云端同步
      syncSubscribedMissions().then((changed) => {
        if (changed) this.loadMyReminders(true)
      }).finally(() => {
        // 2) 云端同步后，对仍然缺失信息的老记录从本地缓存/API 补全
        this._enrichIncompleteReminders()
      })
    }
  },

  _getMissionFromLocalCache(missionId) {
    try {
      const cache = storageCache.readMemOrSync('mission_detail_cache', {}) || {}
      const keys = [missionId + '_upcoming', missionId + '_completed']
      for (const k of keys) {
        const entry = cache[k]
        if (entry && typeof entry === 'object' && (entry.missionName || entry.name)) {
          return entry
        }
      }
    } catch (e) {}
    return null
  },

  onCancelReminder(e) {
    const { key, type, missionid } = e.currentTarget.dataset
    if (!key) return

    wx.showModal({
      title: '取消提醒',
      content: '确定取消这个发射任务提醒吗？\n将同时取消云端订阅通知',
      success: async (res) => {
        if (!res.confirm) return

        wx.vibrateShort({ type: 'light' })

        if (type === 'launch' && missionid) {
          await unsubscribeLaunch(missionid)
        }

        wx.showToast({ title: '已取消提醒', icon: 'none' })
        // skipSync=true 跳过云端同步，防止竞争条件把刚删的数据拉回来
        this.loadMyReminders(true)
      }
    })
  },

  onReminderTap(e) {
    const { type, missionid } = e.currentTarget.dataset
    if (type === 'launch' && missionid) {
      wx.navigateTo({ url: ROUTES.MISSION_DETAIL + '?id=' + missionid + '&type=upcoming' })
    }
  },

  onGoAstroCalendar() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // ── 每日问答（实现在 profile-extra/profile-lazy：loadDailyQuiz / onQuizSelect） ──

  onShareAppMessage(e) {
    if (e && e.from === 'button' && e.target && e.target.dataset && e.target.dataset.share === 'figma') {
      return {
        title: 'Starship Tracking · Starbase Tx 设计稿',
        path: '/pages/profile/profile',
        imageUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/share/figma-cover.jpg'
      }
    }
    return {
      title: '火星探索日志 · SpaceX 星舰追踪',
      path: '/pages/index/index'
    }
  },

  goMembership() {
    wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
  },

  goInvite() {
    wx.navigateTo({ url: '/subpackages/profile-extra/invite/invite' })
  },

  goTimeline() {
    wx.navigateTo({ url: '/subpackages/profile-extra/timeline/timeline' })
  },

  goPreferences() {
    wx.navigateTo({ url: '/subpackages/profile-extra/preferences/preferences' })
  },

  async _loadMembershipEntry() {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) {
        this.setData({ membershipEnabled: false })
        return
      }
      this.setData({ membershipEnabled: true })
      const state = await getMembershipState()
      const pro = isPro(state)
      const memberIconUrl = pro ? MEMBER_ICONS.PRO : MEMBER_ICONS.FREE
      preloadIcons([memberIconUrl])
      const memberIcon = getCachedIcon(memberIconUrl)
      this.setData({ memberIsPro: pro, memberIcon })
    } catch (e) {
      this.setData({ membershipEnabled: false })
    }
  },

  _loadGrowthIcons() {
    preloadIcons([GROWTH_ICONS.BRIEFING, GROWTH_ICONS.TIMELINE])
    this.setData({
      briefingIcon: getCachedIcon(GROWTH_ICONS.BRIEFING),
      timelineIcon: getCachedIcon(GROWTH_ICONS.TIMELINE)
    })
  },

})
