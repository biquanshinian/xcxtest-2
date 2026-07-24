const { isAIAvailable, streamChat, QUICK_QUESTIONS } = require('../../utils/aiService.js')
const { getUpcomingMissions, getCompletedMissions, getUpcomingStarshipMissions } = require('../../../../utils/api-launch-list.js')
const { getStarshipStatusFromDB } = require('../../../../utils/api-app-services.js')
const { buildMissionDetailUrl } = require('../../../../utils/index-mission-nav.js')
const { getMembershipState, getAiChatRemaining, recordAiChatUse, FREE_LIMITS, isMembershipEnabled } = require('../../../../utils/membership.js')
const { getSystemInfo } = require('../../../../utils/system.js')
const { getUiShellLayout } = require('../../../../utils/layout.js')
const {
  matchStarshipNextFlightIntent,
  resolveStarshipNextFlightCard,
  resolveChatCardRocketImage,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule
} = require('../../utils/ai-chat-rich.js')
const { shouldReplaceRocketImage } = require('../../../../utils/util.js')
const { markDownloadFailed } = require('../../../../utils/download-fail-cache.js')
const { loadCloudMediaMap } = require('../../../../utils/image-config.js')
const themeUtil = require('../../../../utils/theme.js')

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
  return Math.max(0, MAX_DAILY_QUESTIONS - info.count)
}

Component({
  properties: {
    /** 独立 FAB 已迁移至 NASA 圆盘菜单，默认仅保留聊天面板 */
    showFab: { type: Boolean, value: false }
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
    inputFocus: false,
    hasHistory: false,
    errorMsgId: '',
    themeClass: ''
  },

  lifetimes: {
    attached() {
      const sys = getSystemInfo()
      const layout = getUiShellLayout(sys)

      this._windowHeight = sys.windowHeight
      this._defaultPanelHeight = Math.round(sys.windowHeight * PANEL_HEIGHT_RATIO)
      // Keep panel header below status bar when keyboard shrinks the sheet
      this._safeTop = layout.statusBarHeight + 8

      let themeClass = ''
      try { themeClass = themeUtil.getThemeClassSync() || '' } catch (e) {}
      this.setData({ panelHeight: this._defaultPanelHeight, themeClass })
      this._preloadLaunchData()

      this._kbHandler = (res) => {
        if (this.data.visible) {
          this._updateKeyboardLayout(res.height || 0)
        }
      }
      wx.onKeyboardHeightChange(this._kbHandler)
    },

    detached() {
      if (this._kbHandler) {
        try { wx.offKeyboardHeightChange(this._kbHandler) } catch (e) {}
      }
    }
  },

  methods: {
    _updateKeyboardLayout(keyboardHeight) {
      const kb = keyboardHeight || 0
      // 去抖：相同高度不重复 setData
      if (this._lastKbHeight === kb) return
      this._lastKbHeight = kb

      let panelHeight = this._defaultPanelHeight
      if (kb > 0) {
        const available = this._windowHeight - kb - this._safeTop
        panelHeight = Math.min(
          this._defaultPanelHeight,
          Math.max(available, MIN_PANEL_HEIGHT)
        )
      }

      this.setData({ keyboardHeight: kb, panelHeight })

      if (kb > 0) {
        setTimeout(() => this.setData({ scrollTarget: 'msg-bottom' }), 100)
      }
    },

    /** input 聚焦：focus 事件自带键盘高度（部分机型 wx.onKeyboardHeightChange 不触发） */
    onInputFocus(e) {
      const h = (e && e.detail && e.detail.height) || 0
      if (h > 0) this._updateKeyboardLayout(h)
    },

    /** input 键盘高度变化事件（adjust-position=false 时由输入框直接回调，最可靠） */
    onInputKeyboardHeightChange(e) {
      const h = (e && e.detail && e.detail.height) || 0
      this._updateKeyboardLayout(h)
    },

    /** input 失焦：键盘收起，面板归位 */
    onInputBlur() {
      this._updateKeyboardLayout(0)
    },

    openChat() {
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
      }, 30)
    },

    closeChat() {
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

    clearChat() {
      if (this.data.sending) return
      wx.vibrateShort({ type: 'light' })
      this.setData({
        messages: [],
        inputValue: '',
        hasHistory: false,
        errorMsgId: '',
        scrollTarget: ''
      })
    },

    onInput(e) {
      this.setData({ inputValue: e.detail.value })
    },

    onQuickQuestion(e) {
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
      // 即将离页：关闭面板时不要先把 TabBar 闪回来
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
            wx.showToast({ title: '打开详情失败', icon: 'none' })
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
      const cardIdx = cards.findIndex((c) => c && String(c.id) === String(cardId))
      if (cardIdx < 0) {
        this._rocketRetrying[retryKey] = false
        return
      }
      const card = cards[cardIdx]
      const failedImage = card.rocketImage || ''
      if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
        markDownloadFailed(String(failedImage).trim(), 404)
      }

      try {
        const nextImage = await resolveChatCardRocketImage({
          rocketName: card.rocketName,
          rocketConfiguration: card.rocketConfiguration
        })
        if (nextImage && nextImage !== failedImage && shouldReplaceRocketImage(failedImage, nextImage)) {
          this.setData({
            [`messages[${msgIdx}].cards[${cardIdx}].rocketImage`]: nextImage
          })
        }
      } catch (err) {}
      this._rocketRetrying[retryKey] = false
    },

    async _doSend(text) {
      if (this._sendLock || this.data.sending) return
      this._sendLock = true

      let membershipOn = false
      try { membershipOn = await isMembershipEnabled() } catch (e) {}

      if (membershipOn) {
        let memberState = null
        try { memberState = await getMembershipState() } catch (e) {}
        const remaining = getAiChatRemaining(memberState)
        if (remaining === 0) {
          this._sendLock = false
          wx.showModal({
            title: '今日次数已用完',
            content: '免费用户每日可提问 ' + (function () {
              try {
                return require('../../../../utils/member-policy.js').getMemberPolicySync().freeAiChatDaily
              } catch (e) {
                return FREE_LIMITS.AI_CHAT
              }
            })() + ' 次，升级星际通行证可无限提问',
            confirmText: '去升级',
            cancelText: '明天再来',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
              }
            }
          })
          return
        }
      } else {
        const remaining = getRemainingQuota()
        if (remaining <= 0) {
          this._sendLock = false
          wx.showToast({ title: '今日提问次数已用完，明天再来吧', icon: 'none', duration: 2500 })
          return
        }
      }

      const wantStarshipCard = matchStarshipNextFlightIntent(text)

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
      // 用本地数组下标，避免依赖 setData 后 this.data 时序
      const botIdx = messages.length - 1
      this.setData({
        messages,
        inputValue: '',
        sending: true,
        hasHistory: true,
        errorMsgId: '',
        scrollTarget: 'msg-bottom'
      })

      const recentMessages = messages
        .filter(m => !m.typing && m.content && !m.error)
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-(MAX_HISTORY_ROUNDS * 2))

      let launchContext = this._getLaunchContext()
      let missionCard = null

      // 意图命中：先取数再开流，保证 focusMission / 无排期提示写入 system prompt
      if (wantStarshipCard) {
        let resolved = { card: null, scheduled: false }
        try {
          resolved = await resolveStarshipNextFlightCard({
            cached: this._cachedStarshipNext,
            upcomingHint: this._cachedUpcoming,
            trackedId: this._trackedStarshipLaunchId || ''
          })
        } catch (e) {
          resolved = { card: null, scheduled: false }
        }
        missionCard = resolved.card || null
        if (missionCard) {
          // 回写完整列表缓存：下次意图命中可零等待
          if (this._cachedStarshipNext && String(this._cachedStarshipNext.id) === String(missionCard.id)) {
            // keep
          } else if (Array.isArray(this._cachedUpcoming)) {
            const hit = this._cachedUpcoming.find((m) => m && String(m.id) === String(missionCard.id))
            if (hit) this._cachedStarshipNext = hit
          }
          launchContext = enrichLaunchContextWithCard(launchContext, missionCard)
        } else {
          launchContext = enrichLaunchContextNoStarshipSchedule(launchContext)
        }
      }

      try {
        await streamChat(recentMessages, (partial) => {
          this.setData({
            [`messages[${botIdx}].content`]: partial,
            [`messages[${botIdx}].typing`]: false,
            scrollTarget: 'msg-bottom'
          })
        }, launchContext)

        const patch = { sending: false, scrollTarget: 'msg-bottom' }
        if (missionCard) {
          patch[`messages[${botIdx}].cards`] = [missionCard]
        }
        this.setData(patch)

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
      // 与首页任务卡同源：先热 media map，后续 resolveMissionRocketImage 才能命中 COS 配置图
      void loadCloudMediaMap().catch(() => {})
      Promise.all([
        getUpcomingMissions(15, 0).catch(() => ({ list: [] })),
        getCompletedMissions(5, 0).catch(() => ({ list: [] })),
        getUpcomingStarshipMissions(12, 0).catch(() => ({ list: [] })),
        getStarshipStatusFromDB().catch(() => null)
      ]).then(([upRes, compRes, starRes, status]) => {
        this._cachedUpcoming = upRes.list || []
        this._cachedCompleted = compRes.list || []
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
