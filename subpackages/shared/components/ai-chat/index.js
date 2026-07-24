const { isAIAvailable, streamChat, QUICK_QUESTIONS, QUICK_SHORTCUTS } = require('../../utils/aiService.js')
const { getUpcomingMissions, getCompletedMissions, getUpcomingStarshipMissions } = require('../../../../utils/api-launch-list.js')
const { getStarshipStatusFromDB } = require('../../../../utils/api-app-services.js')
const { buildMissionDetailUrl } = require('../../../../utils/index-mission-nav.js')
const { getMembershipState, getAiChatRemaining, recordAiChatUse, isMembershipEnabled, gateCheck, isPro } = require('../../../../utils/membership.js')
const { getAiChatAdBonus, offerAiChatQuotaRecover } = require('../../../../utils/ai-chat-ad-quota.js')
const { getSystemInfo } = require('../../../../utils/system.js')
const { getUiShellLayout } = require('../../../../utils/layout.js')
const {
  resolveRichChatPayload,
  resolveChatCardRocketImage
} = require('../../utils/ai-chat-rich.js')
const { shouldReplaceRocketImage } = require('../../../../utils/util.js')
const { markDownloadFailed } = require('../../../../utils/download-fail-cache.js')
const { loadCloudMediaMap } = require('../../../../utils/image-config.js')
const themeUtil = require('../../../../utils/theme.js')
const { ROUTES } = require('../../../../utils/routes.js')
const { isFeatureEnabled } = require('../../../../utils/feature-flags.js')
const {
  resolveFestivalHatId,
  getFestivalHatMeta,
  isFestivalHatDevMode,
  listFestivalHats,
  DEV_CYCLE_MS
} = require('../../../../utils/festival-hat.js')

const MIN_PANEL_HEIGHT = 280
const PANEL_HEIGHT_RATIO = 0.72

let _msgId = 0
function nextMsgId() { return 'msg_' + (++_msgId) + '_' + Date.now() }

const MAX_HISTORY_ROUNDS = 8
const MAX_DAILY_QUESTIONS = 10
const DAILY_QUOTA_KEY = '_ai_chat_daily_quota'

function getDailyQuotaInfo() {
  try {
    const data = wx.getStorageSync(DAILY_QUOTA_KEY)
    const today = new Date().toDateString()
    if (data && data.date === today) {
      return { count: data.count || 0, date: today }
    }
    return { count: 0, date: today }
  } catch (e) {
    return { count: 0, date: new Date().toDateString() }
  }
}

function incrementDailyQuota() {
  const info = getDailyQuotaInfo()
  info.count += 1
  try { wx.setStorageSync(DAILY_QUOTA_KEY, info) } catch (e) {}
  return info.count
}

function getRemainingQuota() {
  const info = getDailyQuotaInfo()
  let bonus = 0
  try { bonus = getAiChatAdBonus() } catch (e) {}
  return Math.max(0, MAX_DAILY_QUESTIONS + bonus - info.count)
}

Component({
  options: {
    // 去掉多余宿主节点，根节点直接参与详情页 flex，避免输入栏悬空
    virtualHost: true
  },

  properties: {
    /** 独立 FAB 已迁移至 NASA 圆盘菜单，默认仅保留聊天面板 */
    showFab: { type: Boolean, value: false },
    /** sheet=半屏弹层（旧）；page=详情页全屏嵌入 */
    mode: { type: String, value: 'sheet' }
  },

  data: {
    visible: false,
    panelMounted: false,
    panelHeight: 0,
    keyboardHeight: 0,
    messages: [],
    inputValue: '',
    sending: false,
    scrollTarget: '',
    quickQuestions: QUICK_QUESTIONS,
    quickShortcuts: QUICK_SHORTCUTS,
    inputFocus: false,
    errorMsgId: '',
    themeClass: '',
    isPageMode: false,
    welcomeBounce: false,
    festivalHat: '',
    festivalHatName: '',
    festivalHatTip: '',
    festivalHatDev: false,
    festivalHatList: []
  },

  lifetimes: {
    attached() {
      const sys = getSystemInfo()
      const layout = getUiShellLayout(sys)
      const isPageMode = String(this.properties.mode || '') === 'page'

      this._windowHeight = sys.windowHeight
      this._defaultPanelHeight = isPageMode
        ? sys.windowHeight
        : Math.round(sys.windowHeight * PANEL_HEIGHT_RATIO)
      // Keep panel header below status bar when keyboard shrinks the sheet
      this._safeTop = layout.statusBarHeight + 8

      let themeClass = ''
      try { themeClass = themeUtil.getThemeClassSync() || '' } catch (e) {}
      this.setData({
        isPageMode,
        panelHeight: this._defaultPanelHeight,
        themeClass,
        panelMounted: isPageMode,
        visible: isPageMode
      })
      this._initFestivalHat()
      this._preloadLaunchData()

      // 详情页不自动聚焦：避免进页假抬键盘高度导致输入栏悬空；由用户点击后再上收
      if (isPageMode) {
        setTimeout(() => this._playWelcomeBounce(), 60)
      }

      this._kbHandler = (res) => {
        if (this.data.visible || this.data.isPageMode) {
          this._updateKeyboardLayout(res.height || 0)
        }
      }
      try {
        wx.onKeyboardHeightChange(this._kbHandler)
      } catch (e) {}
    },

    detached() {
      this._stopFestivalHatDevCycle()
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      if (this._kbHandler) {
        try { wx.offKeyboardHeightChange(this._kbHandler) } catch (e) {}
      }
    }
  },

  pageLifetimes: {
    show() {
      this.syncTheme()
      // 法定假日生命周期：回前台按当天再解析一次（跨日/跨假自动戴脱帽）
      if (!isFestivalHatDevMode()) this._initFestivalHat()
    }
  },

  methods: {
    /** 与详情页骨架同步浅/深主题 class（欢迎区反色依赖此节点上的变量） */
    syncTheme() {
      let themeClass = ''
      try { themeClass = themeUtil.getThemeClassSync() || '' } catch (e) {}
      if (themeClass === (this.data.themeClass || '')) return
      this.setData({ themeClass })
    },

    _isPageMode() {
      return this.data.isPageMode || String(this.properties.mode || '') === 'page'
    },

    _scrollChatToBottom() {
      // 双拍：首帧布局 + 键盘动画结束后再滚，避免滚不到底
      this.setData({ scrollTarget: '' })
      setTimeout(() => this.setData({ scrollTarget: 'msg-bottom' }), 40)
      setTimeout(() => this.setData({ scrollTarget: 'msg-bottom' }), 260)
    },

    _updateKeyboardLayout(keyboardHeight) {
      const kb = Math.max(0, Number(keyboardHeight) || 0)
      // 去抖：相同高度不重复 setData
      if (this._lastKbHeight === kb) return
      this._lastKbHeight = kb

      if (kb > 0 && this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }

      if (this._isPageMode()) {
        // 详情页：通知宿主页用 padding-bottom 上收整栏（组件内不再叠一层 padding，避免双倍抬高）
        this.setData({ keyboardHeight: kb })
        try {
          this.triggerEvent('keyboardheight', { height: kb })
        } catch (e) {}
        if (kb > 0) this._scrollChatToBottom()
        return
      }

      let panelHeight = this._defaultPanelHeight
      if (kb > 0) {
        const available = this._windowHeight - kb - this._safeTop
        panelHeight = Math.min(
          this._defaultPanelHeight,
          Math.max(available, MIN_PANEL_HEIGHT)
        )
      }

      this.setData({ keyboardHeight: kb, panelHeight })

      if (kb > 0) this._scrollChatToBottom()
    },

    /** input 聚焦：focus 事件自带键盘高度（部分机型 wx.onKeyboardHeightChange 不触发） */
    onInputFocus(e) {
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      const h = (e && e.detail && e.detail.height) || 0
      if (h > 0) this._updateKeyboardLayout(h)
    },

    /** input 键盘高度变化事件（adjust-position=false 时由输入框直接回调，最可靠） */
    onInputKeyboardHeightChange(e) {
      const h = (e && e.detail && e.detail.height) || 0
      this._updateKeyboardLayout(h)
    },

    /** input 失焦：延迟归位，避免与 keyboardheightchange 竞态导致不上收/闪断 */
    onInputBlur() {
      if (this._blurKbTimer) clearTimeout(this._blurKbTimer)
      this._blurKbTimer = setTimeout(() => {
        this._blurKbTimer = null
        this._updateKeyboardLayout(0)
      }, 120)
    },

    /** 点对话区任意处：失焦并收起输入法 */
    dismissKeyboard() {
      if (!this.data.inputFocus && !(this.data.keyboardHeight > 0)) return
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      this.setData({ inputFocus: false })
      this._updateKeyboardLayout(0)
    },

    /** 欢迎区动态头像：进页时弹跳一次（少 setData，避免重挂导致掉帧） */
    _playWelcomeBounce() {
      if (this.data.messages && this.data.messages.length) return
      const start = () => {
        if (this.data.messages && this.data.messages.length) return
        this.setData({ welcomeBounce: true })
      }
      if (this.data.welcomeBounce) {
        this.setData({ welcomeBounce: false })
        setTimeout(start, 48)
      } else {
        setTimeout(start, 16)
      }
    },

    _applyFestivalHat(id) {
      const meta = getFestivalHatMeta(id)
      this.setData({
        festivalHat: id || '',
        festivalHatName: (meta && meta.name) || '',
        festivalHatTip: (meta && meta.tip) || ''
      })
    },

    /** 节日帽：生产按日期；开发模式轮播/点选预览全部 */
    _initFestivalHat() {
      const dev = isFestivalHatDevMode()
      const list = listFestivalHats()
      if (dev) {
        this._festivalHatDevIdx = 0
        const first = list[0] ? list[0].id : ''
        this.setData({
          festivalHatDev: true,
          festivalHatList: list
        })
        this._applyFestivalHat(first)
        this._startFestivalHatDevCycle()
        return
      }
      this._stopFestivalHatDevCycle()
      this.setData({ festivalHatDev: false, festivalHatList: [] })
      this._applyFestivalHat(resolveFestivalHatId(new Date()))
    },

    _startFestivalHatDevCycle() {
      this._stopFestivalHatDevCycle()
      const list = listFestivalHats()
      if (!list.length) return
      this._festivalHatDevTimer = setInterval(() => {
        if (!this.data.festivalHatDev) return
        if (this._festivalHatDevPauseUntil && Date.now() < this._festivalHatDevPauseUntil) return
        const next = ((this._festivalHatDevIdx || 0) + 1) % list.length
        this._festivalHatDevIdx = next
        this._applyFestivalHat(list[next].id)
      }, DEV_CYCLE_MS)
    },

    _stopFestivalHatDevCycle() {
      if (this._festivalHatDevTimer) {
        clearInterval(this._festivalHatDevTimer)
        this._festivalHatDevTimer = null
      }
    },

    onFestivalHatDevPick(e) {
      const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
      if (!id || !this.data.festivalHatDev) return
      const list = this.data.festivalHatList || []
      const idx = list.findIndex((it) => it && it.id === id)
      if (idx >= 0) this._festivalHatDevIdx = idx
      this._festivalHatDevPauseUntil = Date.now() + 5000
      this._applyFestivalHat(id)
      this._playWelcomeBounce()
    },

    openChat() {
      // 详情页模式已常驻，仅聚焦输入
      if (this._isPageMode()) {
        if (!isAIAvailable()) {
          wx.showToast({ title: 'AI功能暂未开放', icon: 'none' })
          return
        }
        this.setData({ inputFocus: true })
        return
      }

      wx.vibrateShort({ type: 'medium' })

      if (!isAIAvailable()) {
        wx.showToast({ title: 'AI功能暂未开放', icon: 'none' })
        return
      }

      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (page && typeof page.getTabBar === 'function' && page.getTabBar()) {
        page.getTabBar().setData({ hidden: true })
      }

      this._lastKbHeight = 0
      let themeClass = this.data.themeClass || ''
      try { themeClass = themeUtil.getThemeClassSync() || '' } catch (e) {}
      this.setData({
        panelMounted: true,
        panelHeight: this._defaultPanelHeight,
        keyboardHeight: 0,
        themeClass
      })

      setTimeout(() => {
        this.setData({ visible: true })
        setTimeout(() => this.setData({ inputFocus: true }), 400)
        this._playWelcomeBounce()
      }, 30)
    },

    closeChat() {
      if (this._isPageMode()) {
        this.setData({ inputFocus: false })
        try {
          const pages = getCurrentPages()
          if (pages.length > 1) {
            wx.navigateBack({ delta: 1 })
          } else {
            wx.switchTab({ url: ROUTES.INDEX })
          }
        } catch (e) {}
        return
      }

      this._lastKbHeight = 0
      this.setData({
        visible: false,
        inputFocus: false,
        keyboardHeight: 0,
        panelHeight: this._defaultPanelHeight
      })

      if (!this._skipTabBarRestore) {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && typeof page.getTabBar === 'function' && page.getTabBar()) {
          page.getTabBar().setData({ hidden: false })
        }
      }

      setTimeout(() => this.setData({ panelMounted: false }), 350)
    },

    onInput(e) {
      this.setData({ inputValue: e.detail.value })
    },

    onQuickQuestion(e) {
      if (this.data.sending) return
      const q = e.currentTarget.dataset.q
      if (!q) return
      this.setData({ inputValue: q })
      this._doSend(q)
    },

    sendMessage() {
      const text = (this.data.inputValue || '').trim()
      if (!text || this.data.sending) return
      this._doSend(text)
    },

    retryLastMessage() {
      if (this.data.sending) return
      const msgs = this.data.messages
      if (!msgs.length) return

      const lastBot = msgs[msgs.length - 1]
      if (!lastBot || lastBot.role !== 'assistant') return

      let lastUserText = ''
      for (let i = msgs.length - 2; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          lastUserText = msgs[i].content
          break
        }
      }
      if (!lastUserText) return

      const cleaned = msgs.slice(0, -2)
      this.setData({ messages: cleaned, errorMsgId: '' })
      setTimeout(() => this._doSend(lastUserText), 100)
    },

    /** 点击星问推送的任务卡片 → 进详情（用 id+type 拼 URL，避免 data-url 被 & 截断） */
    onMissionCardTap(e) {
      const id = e.currentTarget.dataset.id
      const detailType = e.currentTarget.dataset.type === 'completed' ? 'completed' : 'upcoming'
      if (!id) return
      const url = buildMissionDetailUrl({ id, detailType })
      wx.vibrateShort({ type: 'light' })
      this._navigateAwayFromChat(url)
    },

    _switchTabFromChat(url) {
      if (this._isPageMode()) {
        wx.switchTab({ url })
        return
      }
      this._skipTabBarRestore = true
      this.closeChat()
      setTimeout(() => {
        wx.switchTab({
          url,
          complete: () => { this._skipTabBarRestore = false }
        })
      }, 280)
    },

    /** 发射列表「查看首页」 */
    onLaunchListMoreTap() {
      wx.vibrateShort({ type: 'light' })
      this._switchTabFromChat(ROUTES.INDEX)
    },

    /** 星舰状态卡 → 进度页（Tab）；可选自动打开 B/S 弹窗 */
    onStarshipStatusTap(e) {
      const vehicle = e.currentTarget.dataset.vehicle
      wx.vibrateShort({ type: 'light' })
      try {
        const app = getApp()
        if (app && (vehicle === 'ship' || vehicle === 'booster')) {
          app._progressAutoOpenStarship = { type: vehicle }
        }
      } catch (err) {}
      this._switchTabFromChat(ROUTES.PROGRESS)
    },

    /** 发射商卡 → 发射商详情（门控与监控页图鉴一致） */
    async onAgencyCardTap(e) {
      const id = e.currentTarget.dataset.id
      if (!id) return
      const gateId = e.currentTarget.dataset.gateid || 'agency_encyclopedia'
      const gateName = e.currentTarget.dataset.gatename || '全球发射商图鉴'
      const url = ROUTES.AGENCY_DETAIL + '?id=' + encodeURIComponent(String(id))

      if (this._entryGatePending) return
      this._entryGatePending = true
      try {
        const allowed = await gateCheck(gateId, gateName)
        if (!allowed) return
        wx.vibrateShort({ type: 'light' })
        this._navigateAwayFromChat(url)
      } finally {
        this._entryGatePending = false
      }
    },

    /** 发射统计卡 → 全球发射统计详情（门控与首页日历一致） */
    async onLaunchStatsCardTap(e) {
      const year = e.currentTarget.dataset.year
      const country = e.currentTarget.dataset.country || ''
      const gateId = e.currentTarget.dataset.gateid || 'global_launch_stats'
      const gateName = e.currentTarget.dataset.gatename || '全球发射统计'
      const parts = []
      if (year) parts.push('year=' + encodeURIComponent(String(year)))
      if (country && country !== '_all') {
        parts.push('country=' + encodeURIComponent(String(country)))
      }
      const url = ROUTES.GLOBAL_LAUNCH_STATS + (parts.length ? '?' + parts.join('&') : '')

      if (this._entryGatePending) return
      this._entryGatePending = true
      try {
        const allowed = await gateCheck(gateId, gateName)
        if (!allowed) return
        wx.vibrateShort({ type: 'light' })
        this._navigateAwayFromChat(url)
      } finally {
        this._entryGatePending = false
      }
    },

    /** 发射集锦/回放卡：可播则门控进播放页（只封面不预加载）；否则打开任务详情 */
    async onMissionReplayCardTap(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      const launchId = ds.launchid ? String(ds.launchid) : ''
      const detailType = ds.type === 'upcoming' ? 'upcoming' : 'completed'
      const missionName = ds.name ? String(ds.name) : ''
      const playable = String(ds.playable) === '1'
      const videoUrl = ds.videourl ? String(ds.videourl) : ''
      const poster = ds.poster ? String(ds.poster) : ''
      const gateId = ds.gateid || 'mission_replay'
      const gateName = ds.gatename || '发射回放'

      if (!playable || !videoUrl) {
        if (!launchId) return
        wx.vibrateShort({ type: 'light' })
        this._navigateAwayFromChat(buildMissionDetailUrl({ id: launchId, detailType }))
        return
      }

      if (this._entryGatePending) return
      this._entryGatePending = true
      try {
        let enabled = true
        try {
          enabled = await isFeatureEnabled('enableMissionReplay', { failClosed: true })
        } catch (err) {
          enabled = false
        }
        if (!enabled) {
          wx.showToast({ title: '发射回放暂未开放', icon: 'none' })
          return
        }
        const allowed = await gateCheck(gateId, gateName)
        if (!allowed) return
        wx.vibrateShort({ type: 'light' })

        const title = (missionName ? missionName + ' 发射集锦' : '发射集锦') + ' | 火星探索日志'
        const sharePath = launchId
          ? buildMissionDetailUrl({ id: launchId, detailType: 'completed' })
          : ''
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
              share: sharePath
                ? { title, path: sharePath, imageUrl: poster || '' }
                : null
            }
          }
        } catch (err2) {}

        this._navigateAwayFromChat(ROUTES.VIDEO_PLAYER)
      } finally {
        this._entryGatePending = false
      }
    },

    /** 入口卡：飞行演示 / 在轨追踪 / 指挥室 / 封路 / 空间站（带会员门控） */
    async onEntryCardTap(e) {
      const kind = e.currentTarget.dataset.kind
      const gateId = e.currentTarget.dataset.gateid
      const gateName = e.currentTarget.dataset.gatename
      const needSim = String(e.currentTarget.dataset.needsim) === '1'
      const missionId = e.currentTarget.dataset.missionid || ''
      const detailType = e.currentTarget.dataset.type === 'completed' ? 'completed' : 'upcoming'
      const missionName = e.currentTarget.dataset.name || ''
      const stationId = e.currentTarget.dataset.stationid || ''

      let url = ''
      let useSwitchTab = false
      if (kind === 'vehicle_tracker') {
        url = ROUTES.VEHICLE_TRACKER
      } else if (kind === 'mission_sim') {
        url = '/subpackages/mission-sim/mission-sim'
      } else if (kind === 'road_closure') {
        url = ROUTES.ROAD_CLOSURE_DETAIL
      } else if (kind === 'starship_progress') {
        url = ROUTES.PROGRESS
        useSwitchTab = true
      } else if (kind === 'station') {
        if (stationId) {
          url = ROUTES.STATION_DETAIL + '?id=' + encodeURIComponent(stationId)
        } else {
          url = ROUTES.MONITOR
          useSwitchTab = true
        }
      } else if (kind === 'flight_demo') {
        const parts = []
        if (missionId) {
          parts.push('id=' + encodeURIComponent(missionId))
          parts.push('type=' + detailType)
        }
        if (missionName) parts.push('name=' + encodeURIComponent(String(missionName).slice(0, 80)))
        url = '/subpackages/mission-sim/flight-demo' + (parts.length ? '?' + parts.join('&') : '')
      }
      if (!url) return

      if (this._entryGatePending) return
      this._entryGatePending = true
      try {
        if (needSim) {
          let enabled = true
          try {
            enabled = await isFeatureEnabled('enableMissionSim', { failClosed: true })
          } catch (err) {
            enabled = false
          }
          if (!enabled) {
            wx.showToast({
              title: kind === 'mission_sim' ? '任务指挥室暂未开放' : '飞行演示暂未开放',
              icon: 'none'
            })
            return
          }
        }
        if (gateId) {
          const allowed = await gateCheck(gateId, gateName || '该功能')
          if (!allowed) return
        }
        wx.vibrateShort({ type: 'light' })
        if (useSwitchTab) {
          if (this._isPageMode()) {
            wx.switchTab({ url })
          } else {
            this._skipTabBarRestore = true
            this.closeChat()
            setTimeout(() => {
              wx.switchTab({
                url,
                complete: () => { this._skipTabBarRestore = false }
              })
            }, 280)
          }
        } else {
          this._navigateAwayFromChat(url)
        }
      } finally {
        this._entryGatePending = false
      }
    },

    _navigateAwayFromChat(url) {
      if (this._isPageMode()) {
        wx.navigateTo({
          url,
          fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
        })
        return
      }
      this._skipTabBarRestore = true
      this.closeChat()
      setTimeout(() => {
        wx.navigateTo({
          url,
          fail: () => {
            this._skipTabBarRestore = false
            const pages = getCurrentPages()
            const page = pages[pages.length - 1]
            if (page && typeof page.getTabBar === 'function' && page.getTabBar()) {
              page.getTabBar().setData({ hidden: false })
            }
            wx.showToast({ title: '打开失败', icon: 'none' })
          },
          complete: () => {
            this._skipTabBarRestore = false
          }
        })
      }, 280)
    },

    /** 与 mission-list-card 同源：配置图加载失败 → 拉黑坏链 → 按火箭名强制重算（勿再塞失败 URL） */
    async onMissionCardRocketError(e) {
      const msgId = e.currentTarget.dataset.msgid
      const cardId = e.currentTarget.dataset.id
      if (!msgId || !cardId) return
      const retryKey = msgId + ':' + cardId
      if (this._rocketRetrying && this._rocketRetrying[retryKey]) return
      if (!this._rocketRetrying) this._rocketRetrying = {}
      this._rocketRetrying[retryKey] = true

      const msgs = this.data.messages || []
      const msgIdx = msgs.findIndex((m) => m && m.id === msgId)
      if (msgIdx < 0) {
        this._rocketRetrying[retryKey] = false
        return
      }
      const cards = (msgs[msgIdx].cards || []).slice()
      let patchPath = ''
      let failedImage = ''
      let rocketName = ''
      let rocketConfiguration = null

      for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
        const card = cards[cardIdx]
        if (!card) continue
        if (String(card.id) === String(cardId) && card.cardType !== 'launch_list') {
          failedImage = card.rocketImage || ''
          rocketName = card.rocketName || ''
          rocketConfiguration = card.rocketConfiguration
          patchPath = `messages[${msgIdx}].cards[${cardIdx}].rocketImage`
          break
        }
        if (card.cardType === 'launch_list' && Array.isArray(card.items)) {
          const rowIdx = card.items.findIndex((c) => c && String(c.id) === String(cardId))
          if (rowIdx >= 0) {
            const row = card.items[rowIdx]
            failedImage = row.rocketImage || ''
            rocketName = row.rocketName || ''
            rocketConfiguration = row.rocketConfiguration
            patchPath = `messages[${msgIdx}].cards[${cardIdx}].items[${rowIdx}].rocketImage`
            break
          }
        }
      }
      if (!patchPath) {
        this._rocketRetrying[retryKey] = false
        return
      }
      if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
        markDownloadFailed(String(failedImage).trim(), 404)
      }

      try {
        const nextImage = await resolveChatCardRocketImage({
          rocketName,
          rocketConfiguration
        })
        if (nextImage && nextImage !== failedImage && shouldReplaceRocketImage(failedImage, nextImage)) {
          this.setData({ [patchPath]: nextImage })
        }
      } catch (err) {}
      this._rocketRetrying[retryKey] = false
    },

    async _doSend(text) {
      if (this._sendLock || this.data.sending) return
      this._sendLock = true
      try {
        this.triggerEvent('sharehint', { question: String(text || '').trim() })
      } catch (e) {}

      let membershipOn = false
      try { membershipOn = await isMembershipEnabled() } catch (e) {}

      if (membershipOn) {
        let memberState = null
        try { memberState = await getMembershipState() } catch (e) {}
        if (memberState && isPro(memberState)) {
          // Pro 无限
        } else {
          const remaining = getAiChatRemaining(memberState)
          if (remaining === 0) {
            this._sendLock = false
            const recovered = await offerAiChatQuotaRecover({ offerUpgrade: true })
            if (!recovered) return
            // 加次成功后继续发送
            this._sendLock = true
          }
        }
      } else {
        const remaining = getRemainingQuota()
        if (remaining <= 0) {
          this._sendLock = false
          const recovered = await offerAiChatQuotaRecover({ offerUpgrade: false })
          if (!recovered) return
          this._sendLock = true
        }
      }

      const userMsg = { id: nextMsgId(), role: 'user', content: text }
      const botMsg = {
        id: nextMsgId(),
        role: 'assistant',
        content: '',
        typing: true,
        error: false,
        cards: []
      }

      const messages = [...this.data.messages, userMsg, botMsg]
      const botIdx = messages.length - 1
      this.setData({
        messages,
        inputValue: '',
        sending: true,
        errorMsgId: '',
        scrollTarget: 'msg-bottom'
      })

      const recentMessages = messages
        .filter(m => !m.typing && m.content && !m.error)
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-(MAX_HISTORY_ROUNDS * 2))

      let launchContext = this._getLaunchContext()
      let richCards = []

      try {
        const rich = await resolveRichChatPayload(text, {
          launchContext,
          cached: this._cachedStarshipNext,
          upcomingHint: this._cachedUpcoming,
          completedHint: this._cachedCompleted,
          trackedId: this._trackedStarshipLaunchId || '',
          cachedStatus: this._cachedStarshipStatus || null,
          limit: 5
        })
        richCards = Array.isArray(rich.cards) ? rich.cards : []
        launchContext = rich.launchContext
        // 回写星舰下一飞缓存
        const missionCard = richCards.find((c) => c && c.cardType === 'mission')
        if (missionCard && Array.isArray(this._cachedUpcoming)) {
          const hit = this._cachedUpcoming.find((m) => m && String(m.id) === String(missionCard.id))
          if (hit) this._cachedStarshipNext = hit
        }
      } catch (e) {
        richCards = []
      }

      try {
        // 出卡成功且有固定引导文案时不再走大模型，避免文案说「没匹配」与下方卡片矛盾
        const suggested = launchContext && typeof launchContext.suggestedReply === 'string'
          ? String(launchContext.suggestedReply).trim()
          : ''
        if (suggested && richCards.length) {
          this.setData({
            [`messages[${botIdx}].content`]: suggested,
            [`messages[${botIdx}].typing`]: false,
            [`messages[${botIdx}].cards`]: richCards,
            sending: false,
            scrollTarget: 'msg-bottom'
          })
        } else {
          await streamChat(recentMessages, (partial) => {
            this.setData({
              [`messages[${botIdx}].content`]: partial,
              [`messages[${botIdx}].typing`]: false,
              scrollTarget: 'msg-bottom'
            })
          }, launchContext)

          const patch = { sending: false, scrollTarget: 'msg-bottom' }
          if (richCards.length) {
            patch[`messages[${botIdx}].cards`] = richCards
          }
          this.setData(patch)
        }

        if (membershipOn) {
          recordAiChatUse()
        } else {
          incrementDailyQuota()
        }
      } catch (err) {
        const errorText = err.message || '抱歉，我暂时无法回答，请稍后再试。'
        this.setData({
          [`messages[${botIdx}].content`]: errorText,
          [`messages[${botIdx}].typing`]: false,
          [`messages[${botIdx}].error`]: true,
          [`messages[${botIdx}].cards`]: [],
          errorMsgId: (messages[botIdx] && messages[botIdx].id) || '',
          sending: false
        })
      } finally {
        this._sendLock = false
      }
    },

    _preloadLaunchData() {
      void loadCloudMediaMap().catch(() => {})
      Promise.all([
        getUpcomingMissions(100, 0).catch(() => ({ list: [] })),
        getCompletedMissions(80, 0).catch(() => ({ list: [] })),
        getUpcomingStarshipMissions(12, 0).catch(() => ({ list: [] })),
        getStarshipStatusFromDB().catch(() => null)
      ]).then(([upRes, compRes, starRes, status]) => {
        this._cachedUpcoming = upRes.list || []
        this._cachedCompleted = compRes.list || []
        this._cachedStarshipStatus = status || null
        this._trackedStarshipLaunchId = (status && status.ll2TrackedLaunchId) || ''
        const starList = starRes.list || []
        const tracked = this._trackedStarshipLaunchId
        this._cachedStarshipNext = (tracked && starList.find((m) => String(m.id) === String(tracked)))
          || starList[0]
          || null
      })
    },

    _getLaunchContext() {
      try {
        const pages = getCurrentPages()
        const indexPage = pages.find(p => p.route === 'pages/index/index')
        const d = indexPage && indexPage.data

        let upcoming = []
        let completed = []
        let countdown = null

        if (d && d.launchData && d.launchData.name) {
          countdown = {
            name: d.launchData.name,
            rocketName: d.launchData.rocketName,
            launchTime: d.launchData.launchTime,
            launchAgency: d.launchData.launchAgency,
            launchSite: d.launchData.launchSite,
            status: d.launchData.status
          }
        }

        if (d && Array.isArray(d.upcomingMissions) && d.upcomingMissions.length > 0) {
          upcoming = d.upcomingMissions.slice(0, 15)
        } else if (Array.isArray(this._cachedUpcoming) && this._cachedUpcoming.length > 0) {
          upcoming = this._cachedUpcoming.slice(0, 15)
        }

        if (d && Array.isArray(d.completedMissions) && d.completedMissions.length > 0) {
          completed = d.completedMissions.slice(0, 5)
        } else if (Array.isArray(this._cachedCompleted) && this._cachedCompleted.length > 0) {
          completed = this._cachedCompleted.slice(0, 5)
        }

        if (!countdown && !upcoming.length && !completed.length) return null

        return {
          countdown,
          upcoming: upcoming.map(m => ({
            name: m.name || m.missionName,
            rocketName: m.rocketName,
            launchTime: m.launchTime,
            launchAgency: m.launchAgency,
            launchSite: m.launchSite || m.padLocation,
            status: m.status
          })),
          completed: completed.map(m => ({
            name: m.name || m.missionName,
            rocketName: m.rocketName,
            launchTime: m.launchTime,
            launchAgency: m.launchAgency,
            status: m.status
          }))
        }
      } catch (e) {}
      return null
    }
  }
})
