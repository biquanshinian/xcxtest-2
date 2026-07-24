/**
 * 星问 AI 详情页
 * 入口：NASA 圆盘「星问AI」→ navigateTo
 * 内容复用 ai-chat 组件（mode="page"），骨架对齐 briefing 详情页
 * 过审：须同时过 isAIAvailable + global_config.enableAIChat（failClosed，防分享直达）
 */
const pageBase = require('./page-base.js')
const { ROUTES } = require('../../utils/routes.js')
const { isAIAvailable, fetchAIChatEnabled } = require('./utils/aiService.js')
const { isFeatureEnabled } = require('../../utils/feature-flags.js')

Page({
  behaviors: [pageBase],

  data: {
    shareHint: '',
    keyboardHeight: 0,
    /** 未通过开关前不挂载对话组件，避免审核员看到星问 UI */
    pageAllowed: false
  },

  onLoad() {
    this.initUiShell()
    try {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    } catch (e) {}

    this._guardAiChatPage()
  },

  /** 关闭星问后：直达/分享进详情页也要拦下并退出 */
  async _guardAiChatPage() {
    let allowed = false
    try {
      if (!isAIAvailable()) {
        allowed = false
      } else {
        // failClosed：读不到配置视为关闭，与过审视频门控同语义
        const flagOn = await isFeatureEnabled('enableAIChat', { failClosed: true })
        // 同步独立缓存，供圆盘 isAIChatEnabledSync 一致
        try { await fetchAIChatEnabled() } catch (e) {}
        allowed = !!flagOn
      }
    } catch (e) {
      allowed = false
    }

    if (!allowed) {
      this.setData({ pageAllowed: false })
      wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
      setTimeout(() => {
        try { this.goBack() } catch (err) {}
      }, 400)
      return
    }
    this.setData({ pageAllowed: true })
  },

  onShow() {
    try {
      if (typeof this.syncTheme === 'function') this.syncTheme()
    } catch (e) {}
    try {
      const chat = this.selectComponent('#aiChat')
      if (chat && typeof chat.syncTheme === 'function') chat.syncTheme()
    } catch (e) {}
  },

  /** 子组件同步最近提问，用于动态分享标题 */
  onShareHint(e) {
    const q = (e && e.detail && e.detail.question) || ''
    this.setData({ shareHint: String(q).trim().slice(0, 40) })
  },

  /** 键盘弹起：宿主页内容区 padding-bottom 上收，输入栏贴键盘顶 */
  onKeyboardHeight(e) {
    const h = Math.max(0, Number(e && e.detail && e.detail.height) || 0)
    if (h === this.data.keyboardHeight) return
    this.setData({ keyboardHeight: h })
  },

  onHide() {
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 })
  },

  onUnload() {
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 })
  },

  _buildShareTitle() {
    const hint = (this.data.shareHint || '').trim()
    if (hint) return '星问：' + hint
    return '星问 — 有太空问题，问我就对了'
  },

  onShareAppMessage() {
    return {
      title: this._buildShareTitle(),
      path: ROUTES.AI_CHAT,
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: this._buildShareTitle(),
      query: ''
    }
  }
})
