// pages/profile/profile.js
const { ROUTES } = require('../../utils/routes.js')
const { warmProfilePageStorageSync } = require('../../utils/page-storage-boot.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const userIdentity = require('../../utils/user-identity.js')
const { getSubscribedMissions, unsubscribeLaunch, syncSubscribedMissions } = require('../../utils/subscribe.js')
const { resolveMissionRocketImageFresh, isDefaultRocketSrc } = require('../../utils/util.js')
const { getMembershipState, isPro, isMembershipEnabled, MEMBER_ICONS, MEMBER_BENEFIT_ICONS, MEMBER_PASS_BENEFITS } = require('../../utils/membership.js')
const { getFavoriteCount } = require('../../utils/favorites.js')
const themeUtil = require('../../utils/theme.js')
const tabLoadPage = require('../../utils/tab-load-page.js')
const rocketArtUtil = require('../../utils/rocket-config-art.js')
const { getCachedIcon, preloadIcons } = require('../../utils/icon-cache.js')
const {
  loadPreferences,
  savePreferences,
  ROCKET_TYPE_OPTIONS,
  LAUNCH_SITE_OPTIONS
} = require('../../utils/user-growth.js')
const { normalizeContentLang } = require('../../utils/locale.js')
const { invalidateListSnapshots } = require('../../utils/api-launch-list.js')

function prefsArrayToMap(arr) {
  const map = {}
  if (arr && arr.length) {
    for (let i = 0; i < arr.length; i++) map[arr[i]] = true
  }
  return map
}

const GROWTH_ICONS = {
  BRIEFING: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%A4%AA%E7%A9%BA%E6%8E%A2%E7%B4%A2%E7%94%9F%E6%88%90%E8%83%8C%E6%99%AF%E5%9B%BE/1778755615793_c11otc.png',
  TIMELINE: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%A4%AA%E7%A9%BA%E6%8E%A2%E7%B4%A2%E7%94%9F%E6%88%90%E8%83%8C%E6%99%AF%E5%9B%BE/1778755614206_yklby8.png',
  // 观礼入口统一图标：单一真相源在 utils/watch-party-feature.js
  WATCH_PARTY: require('../../utils/watch-party-feature.js').WATCH_PARTY_ICON
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
  '_applyVoteHistoryContentLang',
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
  '_refreshVoteHistoryRocketArt',
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
  'closeSettingsPanel',
  'onThemeModeTap',
  'onRocketArtTap',
  'onContentLangChange',
  'onBriefingToggle',
  'onTogglePrefRocket',
  'onTogglePrefSite',
  'onNotifyPrefChange',
  'onSaveReminderPrefs',
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

const NOTIFY_PREF_OPTIONS = [
  { value: 30, label: '30分钟前' },
  { value: 60, label: '1小时前' },
  { value: 120, label: '2小时前' }
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
    rocketArtStyle: 'original',
    contentLang: 'zh',
    briefingEnabled: true,
    settingsPanelOpen: false,
    settingsPanelPadTop: 44,
    menuButtonTop: 48,
    menuButtonHeight: 32,
    rocketOptions: ROCKET_TYPE_OPTIONS,
    siteOptions: LAUNCH_SITE_OPTIONS,
    notifyOptions: NOTIFY_PREF_OPTIONS,
    selectedRockets: [],
    selectedSites: [],
    rocketMap: {},
    siteMap: {},
    notifyMinutes: 60,
    prefSaving: false,
    pageBgColor: '#000000',
    popupAdItem: null,
    popupAdVisible: false,
    statusBarHeight: 44,
    isAndroid: false,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    // 身份展示
    identityDisplayName: userIdentity.DEFAULT_DISPLAY_NAME,
    identityAvatarUrl: '',
    identityHasAvatar: false,
    identityOpenId: '',
    identityOpenIdMasked: '',
    // 签到
    checkinSummary: { totalDays: 0, currentStreak: 0, factsCollected: 0, totalFacts: 60, isCheckedInToday: false },
    weekDots: [],
    todayFact: null,
    showFactCard: false,
    // 成就
    achievementInfo: { achievements: [], unlockedCount: 0, totalCount: 0 },
    showBadgeModal: false,
    badgeModalData: {},
    // 我的收藏数量（角标）
    favoritesCount: 0,
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
    passBenefits: [],
    briefingIcon: '',
    timelineIcon: '',
    watchPartyIcon: '',
    // 年度报告（后台配置时间窗）
    yearReviewVisible: false,
    yearReviewTitle: '',
    yearReviewSubtitle: '',
    yearReviewYear: new Date().getFullYear(),
    // 里程碑彩蛋
    showMilestoneEgg: false,
    currentMilestone: {},
    _milestoneQueue: [],
    myPrizes: [],
    /** 火箭观礼入口（enableWatchParty，failClosed；未确认前隐藏） */
    enableWatchParty: false,
    /** 观礼入口红角标：对外场次总数（0 = 不显示） */
    watchPartyCount: 0
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

    let menuButtonTop = uiShellLayout.statusBarHeight + 6
    let menuButtonHeight = 32
    try {
      const menuBtn = wx.getMenuButtonBoundingClientRect()
      if (menuBtn && menuBtn.height) {
        menuButtonTop = menuBtn.top
        menuButtonHeight = menuBtn.height
      }
    } catch (e) {}

    this.setData({
      statusBarHeight: uiShellLayout.statusBarHeight,
      isAndroid: platform.includes('android'),
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      tabBarReservedHeight: uiShellLayout.tabBarReservedHeight,
      menuButtonTop,
      menuButtonHeight,
      settingsPanelPadTop: menuButtonTop,
      themeClass: themeUtil.getThemeClassSync(),
      themeLight: themeUtil.isLightSync(),
      themeMode: themeUtil.getThemeModeSync(),
      rocketArtStyle: rocketArtUtil.getRocketConfigArtStyle(),
      pageBgColor: themeUtil.getPageBgSync(),
      ...userIdentity.getIdentityView()
    })
    this._syncSettingsPrefs()
    this._loadReminderPrefs()
    this._profileBootPending = true
    this._profileShowRefreshPending = false
    try { warmProfilePageStorageSync() } catch (e) {}
    var self = this
    setTimeout(function () {
      self._runProfileBoot()
    }, 0)
    this.refreshIdentity(true)
  },

  /** 刷新昵称 / 头像；needOpenId 时会向云端补 openid（内部用，不展示） */
  refreshIdentity(needOpenId) {
    this.setData(userIdentity.getIdentityView())
    if (!needOpenId && this.data.identityOpenId) return
    var self = this
    userIdentity.ensureOpenId().then(function () {
      self.setData(userIdentity.getIdentityView())
    })
  },

  onAvatarTap() {
    if (this._avatarUploading) return
    this._avatarUploading = true
    var self = this
    userIdentity
      .chooseAndUploadAvatar()
      .then(function () {
        self.setData(userIdentity.getIdentityView())
        wx.showToast({ title: '头像已更新', icon: 'success' })
      })
      .catch(function (err) {
        if (err && err.message === 'cancel') return
      })
      .then(function () {
        self._avatarUploading = false
      })
  },

  onDisplayNameTap() {
    var cur = this.data.identityDisplayName || userIdentity.DEFAULT_DISPLAY_NAME
    var self = this
    wx.showModal({
      title: '设置昵称',
      editable: true,
      placeholderText: '太空探索者',
      content: cur === userIdentity.DEFAULT_DISPLAY_NAME ? '' : cur,
      success: function (res) {
        if (!res.confirm) return
        var next = userIdentity.setDisplayName(res.content)
        self.setData(userIdentity.getIdentityView())
        wx.showToast({ title: next ? '昵称已更新' : '已恢复默认', icon: 'none' })
      }
    })
  },

  /** 同步统一设置区：发射卡片语言 + 每日简报开关 */
  _syncSettingsPrefs() {
    try {
      const prefs = loadPreferences() || {}
      const contentLang = normalizeContentLang(prefs.contentLang)
      const briefingEnabled = prefs.briefingEnabled !== false
      if (this.data.contentLang !== contentLang || this.data.briefingEnabled !== briefingEnabled) {
        this.setData({ contentLang, briefingEnabled })
      }
    } catch (e) {}
  },

  _loadReminderPrefs() {
    try {
      const prefs = loadPreferences() || {}
      const rockets = prefs.rocketTypes || []
      const sites = prefs.launchSites || []
      this.setData({
        selectedRockets: rockets,
        selectedSites: sites,
        rocketMap: prefsArrayToMap(rockets),
        siteMap: prefsArrayToMap(sites),
        notifyMinutes: prefs.notifyMinutes || 60
      })
    } catch (e) {}
  },

  onToggleSettingsPanel() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const next = !this.data.settingsPanelOpen
    if (next) {
      this._syncSettingsPrefs()
      this._loadReminderPrefs()
    }
    this.setData({ settingsPanelOpen: next })
  },

  closeSettingsPanel() {
    if (!this.data.settingsPanelOpen) return
    this.setData({ settingsPanelOpen: false })
  },

  onTogglePrefRocket(e) {
    const name = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name
    if (!name) return
    const list = this.data.selectedRockets.slice()
    const map = Object.assign({}, this.data.rocketMap)
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      delete map[name]
    } else {
      list.push(name)
      map[name] = true
    }
    this.setData({ selectedRockets: list, rocketMap: map })
  },

  onTogglePrefSite(e) {
    const name = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name
    if (!name) return
    const list = this.data.selectedSites.slice()
    const map = Object.assign({}, this.data.siteMap)
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      delete map[name]
    } else {
      list.push(name)
      map[name] = true
    }
    this.setData({ selectedSites: list, siteMap: map })
  },

  onNotifyPrefChange(e) {
    const value = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value
    this.setData({ notifyMinutes: Number(value) || 60 })
  },

  onSaveReminderPrefs() {
    if (this.data.prefSaving) return
    this.setData({ prefSaving: true })
    const prefs = loadPreferences() || {}
    prefs.rocketTypes = this.data.selectedRockets
    prefs.launchSites = this.data.selectedSites
    prefs.notifyMinutes = this.data.notifyMinutes
    savePreferences(prefs)

    const finish = () => {
      this.setData({ prefSaving: false })
      wx.showToast({ title: '保存成功', icon: 'success' })
    }
    const RESULT_TMPL = 'ulf34VqAS9Tj32BMqj4M1qudtKKy04iiBM7Qb9_VDb4'
    const REMINDER_TMPL = 'T5J5sRh2UdEwFE7q_VTbdowA0PeXrz_3bUweWEL6uBs'
    try {
      const oaAlert = require('../../utils/oa-alert.js')
      if (oaAlert && typeof oaAlert.isOaAlertReady === 'function') {
        oaAlert.isOaAlertReady().then((ready) => {
          if (ready) {
            finish()
            return
          }
          wx.requestSubscribeMessage({
            tmplIds: [REMINDER_TMPL, RESULT_TMPL],
            complete: finish
          })
        }).catch(() => {
          wx.requestSubscribeMessage({
            tmplIds: [REMINDER_TMPL, RESULT_TMPL],
            complete: finish
          })
        })
        return
      }
    } catch (e) {}
    wx.requestSubscribeMessage({
      tmplIds: [REMINDER_TMPL, RESULT_TMPL],
      complete: finish
    })
  },

  _runProfileBoot() {
    if (!this._profileBootPending) return
    this._profileBootPending = false
    var route = tabLoadPage.TAB_ROUTES.profile
    var finished = false
    function finish() {
      if (finished) return
      finished = true
      try { tabLoadPage.endPageLoad(route) } catch (e) {}
    }
    try {
      tabLoadPage.beginPageLoad(route)
      try { this._runProfileShowRefresh(true) } catch (e) {}
      try { this.syncCloudProfile() } catch (e) {}
      try { this.loadAboutConfig() } catch (e) {}
      var self = this
      // 首屏本地 boot 很快；membership 异步补全，统一在短延迟后揭开遮罩
      Promise.resolve()
        .then(function () {
          return typeof self._loadMembershipEntry === 'function'
            ? self._loadMembershipEntry()
            : null
        })
        .catch(function () {})
        .then(finish)
      setTimeout(finish, 800)
    } catch (e) {
      finish()
    }
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
    this._refreshWatchPartyEntryFlag()
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
    const art = rocketArtUtil.getRocketConfigArtStyle()
    if (this.data.rocketArtStyle !== art) this.setData({ rocketArtStyle: art })
    this._syncSettingsPrefs()
    // 艺术风格切换后回到本 Tab：补刷提醒 / 竞猜缩略图
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
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
    this.refreshIdentity(false)

    if (this._profileBootPending) return

    var self = this
    setTimeout(function () {
      self._runProfileShowRefresh()
    }, 0)
  },

  /** ══ 设置：深色 / 浅色 / 跟随系统 三档切换 ══ */
  onThemeModeTap(e) {
    const mode = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || 'dark'
    if (mode === this.data.themeMode) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // setThemeMode 会遍历在栈页面（含本页）即时下发 themeClass / pageBgColor
    themeUtil.setThemeMode(mode)
    this.setData({ themeMode: mode })
  },

  /** ══ 设置：火箭配置图原图 / 机娘风格 ══ */
  onRocketArtTap(e) {
    const style = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.style) || 'original'
    if (style === this.data.rocketArtStyle) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    rocketArtUtil.setRocketConfigArtStyle(style)
    this.setData({ rocketArtStyle: rocketArtUtil.getRocketConfigArtStyle() })
  },

  /** ══ 设置：发射卡片语言（即时保存）══ */
  onContentLangChange(e) {
    const next = normalizeContentLang(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value)
    if (next === this.data.contentLang) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    const prefs = loadPreferences() || {}
    prefs.contentLang = next
    savePreferences(prefs)
    this.setData({ contentLang: next })
    try { invalidateListSnapshots() } catch (err2) {}
    // 详情 10 分钟缓存会带着旧语言展示字段；切换语言后清掉，避免 skipRebuild 卡在英文/中文
    try {
      storageCache.writeMem('mission_detail_cache', {})
      wx.removeStorage({ key: 'mission_detail_cache', fail: function () {} })
    } catch (err3) {}
    try {
      if (typeof this._applyVoteHistoryContentLang === 'function') {
        this._applyVoteHistoryContentLang()
      }
    } catch (err4) {}
  },

  /** ══ 设置：每日太空简报开关（即时保存）══ */
  onBriefingToggle(e) {
    const enabled = !!(e && e.detail && e.detail.value)
    if (enabled === this.data.briefingEnabled) return
    const prefs = loadPreferences() || {}
    prefs.briefingEnabled = enabled
    savePreferences(prefs)
    this.setData({ briefingEnabled: enabled })
  },

  /** 艺术风格切换后刷新本页提醒 / 竞猜缩略图 */
  refreshRocketConfigArt() {
    try {
      this.loadMyReminders(true)
    } catch (e) {}
    try {
      if (typeof this._refreshVoteHistoryRocketArt === 'function') {
        this._refreshVoteHistoryRocketArt()
      }
    } catch (e2) {}
    return true
  },

  /** ══ 我的收藏（数量角标；详情见 favorites 页）══ */
  loadMyFavorites() {
    try {
      this.setData({ favoritesCount: getFavoriteCount() })
    } catch (e) {
      this.setData({ favoritesCount: 0 })
    }
  },

  goFavorites() {
    wx.navigateTo({ url: ROUTES.FAVORITES })
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

  goBadges(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.index
      : undefined
    const index = Number(raw)
    let url = ROUTES.BADGES
    if (Number.isFinite(index) && index >= 0) {
      url += '?index=' + index
    }
    wx.navigateTo({ url })
  },

  onAchievementTap(e) {
    this.goBadges(e)
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
      let rocketNameEn = m.rocketNameEn || ''
      let launchTime = m.launchTime
      let rocketConfiguration = m.rocketConfiguration || null
      const cached = this._getMissionFromLocalCache(m.id)

      if (cached) {
        if (!name || name === '未知任务' || name === '发射任务 #' + m.id) {
          name = cached.missionName || cached.name || name
        }
        if (!rocket) rocket = cached.rocketName || rocket
        if (!launchTime) launchTime = cached.launchTime || cached.windowStart || launchTime
        if (!rocketConfiguration) rocketConfiguration = cached.rocketConfiguration || null
        // 配图链路与首页一致：优先英文火箭名
        if (!rocketNameEn) {
          const cachedEn = cached.rocketName || ''
          if (cachedEn && !/[\u4e00-\u9fff]/.test(cachedEn)) rocketNameEn = cachedEn
        }
      }
      if (!rocketNameEn && rocket && !/[\u4e00-\u9fff]/.test(String(rocket))) {
        rocketNameEn = rocket
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

      // 与首页任务卡同源：英文火箭名 + rocketConfiguration 强制重算
      const rocketImg = resolveMissionRocketImageFresh(rocketNameEn || rocket || '', rocketConfiguration)

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
        daysLabel: status === 'today' ? '即将发射' : status === 'past' ? '已发射' : launchMs ? daysLeft + '天后' : '待定',
        _needsEnrich: !rocketConfiguration || !rocketNameEn || isDefaultRocketSrc(rocketImg)
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

  goTimeline() {
    wx.navigateTo({ url: '/subpackages/profile-extra/timeline/timeline' })
  },

  openProfileBriefing() {
    if (!this.data.briefingEnabled) return
    wx.navigateTo({ url: ROUTES.BRIEFING })
  },

  goVoteRecord() {
    wx.navigateTo({ url: ROUTES.VOTE_RECORD })
  },

  goDailyQuiz() {
    wx.navigateTo({ url: ROUTES.DAILY_QUIZ })
  },

  /** 过审开关：强制刷新，避免一键过审后仍显示入口；开启时顺带拉场次数刷红角标 */
  _refreshWatchPartyEntryFlag() {
    try {
      const feature = require('../../utils/watch-party-feature.js')
      feature.isWatchPartyEnabled(true).then((on) => {
        this.setData({ enableWatchParty: !!on })
        if (!on) {
          this.setData({ watchPartyCount: 0 })
          return
        }
        feature.fetchWatchPartySessionCount().then((n) => {
          this.setData({ watchPartyCount: Number(n) || 0 })
        }).catch(() => {})
      }).catch(() => {
        this.setData({ enableWatchParty: false, watchPartyCount: 0 })
      })
    } catch (e) {
      this.setData({ enableWatchParty: false, watchPartyCount: 0 })
    }
  },

  goWatchParty() {
    if (!this.data.enableWatchParty) {
      wx.showToast({ title: '观礼服务暂未开放', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/subpackages/watch-party/merchant-list?channel=profile' })
  },

  goPreferences() {
    // 兼容旧入口：改为打开设置左半屏（提醒偏好已并入设置）
    this._loadReminderPrefs()
    this.setData({ settingsPanelOpen: true })
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
      const benefitUrls = MEMBER_PASS_BENEFITS.map(function (b) {
        return MEMBER_BENEFIT_ICONS[b.iconIndex]
      }).filter(Boolean)
      preloadIcons([memberIconUrl].concat(benefitUrls))
      const memberIcon = getCachedIcon(memberIconUrl)
      const passBenefits = MEMBER_PASS_BENEFITS.map(function (b) {
        const url = MEMBER_BENEFIT_ICONS[b.iconIndex] || ''
        return {
          name: b.name,
          iconUrl: url ? getCachedIcon(url) : ''
        }
      })
      this.setData({ memberIsPro: pro, memberIcon, passBenefits })
    } catch (e) {
      this.setData({ membershipEnabled: false })
    }
  },

  _loadGrowthIcons() {
    preloadIcons([GROWTH_ICONS.BRIEFING, GROWTH_ICONS.TIMELINE, GROWTH_ICONS.WATCH_PARTY])
    this.setData({
      briefingIcon: getCachedIcon(GROWTH_ICONS.BRIEFING),
      timelineIcon: getCachedIcon(GROWTH_ICONS.TIMELINE),
      watchPartyIcon: getCachedIcon(GROWTH_ICONS.WATCH_PARTY)
    })
  },

})
