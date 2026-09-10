const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, applyThemeToPage } = require('../../../utils/theme.js')
const { checkAchievements } = require('../utils/checkin.js')
const { ROUTES } = require('../../../utils/routes.js')
const userIdentity = require('../../../utils/user-identity.js')

function badgesPageBg() {
  return isLightSync() ? '#F3F4F7' : '#0B0E18'
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#0B0E18',
    achievements: [],
    unlockedCount: 0,
    totalCount: 0,
    detailOpen: false,
    detailIndex: 0,
    currentBadge: null,
    identityDisplayName: userIdentity.DEFAULT_DISPLAY_NAME,
    identityAvatarUrl: '',
    identityHasAvatar: false
  },

  onLoad(query) {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: badgesPageBg(),
      ...userIdentity.getIdentityView()
    })
    this._load()
    const idx = Number(query && query.index)
    if (Number.isFinite(idx) && idx >= 0) {
      setTimeout(() => this.openDetail(idx), 80)
    }
  },

  onShow() {
    applyThemeToPage(this)
    this.setData({
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: badgesPageBg(),
      ...userIdentity.getIdentityView()
    })
    this._load()
    if (this.data.detailOpen) {
      const list = this.data.achievements || []
      const i = this.data.detailIndex || 0
      this.setData({ currentBadge: list[i] || null })
    }
  },

  _load() {
    const info = checkAchievements() || {}
    const list = (info.achievements || []).map((a) => ({
      id: a.id,
      name: a.name,
      desc: a.desc,
      hint: a.hint || '',
      iconUrl: a.iconUrl,
      unlocked: !!a.unlocked,
      unlockedAt: a.unlockedAt || null
    }))
    this.setData({
      achievements: list,
      unlockedCount: info.unlockedCount || 0,
      totalCount: info.totalCount || list.length
    })
  },

  onBadgeTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index)) return
    this.openDetail(index)
  },

  openDetail(index) {
    const list = this.data.achievements || []
    const i = Math.max(0, Math.min(list.length - 1, index))
    this.setData({
      detailOpen: true,
      detailIndex: i,
      currentBadge: list[i] || null
    })
  },

  onDetailSwiperChange(e) {
    const i = Number(e.detail && e.detail.current)
    if (!Number.isFinite(i)) return
    const list = this.data.achievements || []
    this.setData({
      detailIndex: i,
      currentBadge: list[i] || null
    })
  },

  closeDetail() {
    this.setData({ detailOpen: false })
  },

  onDetailCta() {
    const b = this.data.currentBadge
    if (!b) return
    if (b.unlocked) {
      wx.showToast({ title: '已点亮', icon: 'success' })
      return
    }
    const id = String(b.id || '')
    if (id.indexOf('quiz') === 0) {
      wx.navigateTo({ url: ROUTES.DAILY_QUIZ })
      return
    }
    if (id === 'satellite_hunter') {
      wx.switchTab({ url: ROUTES.MONITOR })
      return
    }
    if (id === 'news_master') {
      wx.switchTab({ url: ROUTES.NEWS })
      return
    }
    if (id === 'mars_expert') {
      wx.switchTab({ url: ROUTES.PROGRESS })
      return
    }
    // 签到 / 知识卡类：回「我的」去签到
    if (
      id.indexOf('first_checkin') === 0 ||
      id.indexOf('streak_') === 0 ||
      id.indexOf('total_') === 0 ||
      id.indexOf('facts_') === 0
    ) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.showToast({ title: b.hint || b.desc || '继续探索即可点亮', icon: 'none', duration: 2500 })
  },

  noop() {},

  goBack() {
    if (this.data.detailOpen) {
      this.closeDetail()
      return
    }
    wx.navigateBack({ delta: 1 })
  }
})
