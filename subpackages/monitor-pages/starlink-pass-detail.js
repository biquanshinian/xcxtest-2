const pageBase = require('../../utils/page-base.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck, isProSync } = require('../../utils/membership.js')

const PASS_DETAIL_STORAGE_KEY = '_starlink_pass_detail_payload'
const BRIGHTNESS_LABEL = {
  bright: '极亮',
  medium: '较亮',
  dim: '较暗'
}

function enrichPassList(list) {
  return (Array.isArray(list) ? list : []).map((item, index) => ({
    ...item,
    index,
    brightnessLabel: BRIGHTNESS_LABEL[item.brightnessText] || item.brightnessText || '—',
    isNext: index === 0
  }))
}

function isMomentsSinglePage() {
  try {
    const enter = (typeof wx.getEnterOptionsSync === 'function' && wx.getEnterOptionsSync())
      || wx.getLaunchOptionsSync()
    return !!(enter && enter.scene === 1154)
  } catch (e) {
    return false
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    passList: [],
    passLocation: '',
    observer: null,
    nextPass: null,
    passCount: 0,
    isProUser: false,
    discussionTopic: '我拍到的星链列车',
    navTitle: '星链过境预报',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    menuButtonWidth: 88,
    momentsHint: false,
    shareLandingEmpty: false,
    sharePreviewCount: 0
  },

  onLoad(options) {
    this.initUiShell()
    this._syncProState()

    if (isMomentsSinglePage()) {
      const shareCount = parseInt((options && options.count) || '0', 10) || 0
      this.setData({
        momentsHint: true,
        shareLandingEmpty: true,
        sharePreviewCount: shareCount,
        passCount: 0,
        passList: [],
        nextPass: null
      })
      return
    }

    try {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    } catch (e) {}

    this._loadFromStorage()

    // 朋友圈/分享卡片冷启动：过境数据只存在分享方本地 storage，接收方无数据。
    // 与好友分享 path 一致，落到监控页让用户按自己的位置重新加载。
    if (!this.data.passCount && this.data.isDirectEntry) {
      this.setData({ shareLandingEmpty: true })
      wx.switchTab({
        url: '/pages/monitor/monitor',
        fail: () => {}
      })
    }
  },

  onShow() {
    this._syncProState()
  },

  _syncProState() {
    this.setData({ isProUser: isProSync() })
  },

  _loadFromStorage() {
    try {
      const payload = wx.getStorageSync(PASS_DETAIL_STORAGE_KEY) || {}
      const passList = enrichPassList(payload.passList)
      this.setData({
        passList,
        passCount: passList.length,
        nextPass: passList[0] || null,
        passLocation: payload.passLocation || '',
        observer: payload.observer || null,
        shareLandingEmpty: false
      })
    } catch (e) {
      this.setData({ passList: [], passCount: 0, nextPass: null })
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
    const observer = this.data.observer || {}
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

  goMonitorForPasses() {
    wx.switchTab({
      url: '/pages/monitor/monitor',
      fail: () => {
        wx.showToast({ title: '请从监控中心打开', icon: 'none' })
      }
    })
  },

  _shareTitle() {
    const count = this.data.passCount
    return count
      ? `星链过境预报 - 未来24小时共${count}次可见 | 火星探索日志`
      : '星链过境预报 | 火星探索日志'
  },

  onShareAppMessage() {
    return {
      title: this._shareTitle(),
      // 过境与位置相关：落到监控页，由接收方按本地位置重新加载
      path: '/pages/monitor/monitor'
    }
  },

  onShareTimeline() {
    const count = this.data.passCount || 0
    return {
      title: this._shareTitle(),
      // 朋友圈只能落本页；带 count 供单页预览展示，完整数据仍需进小程序后在监控页加载
      query: count ? ('count=' + count) : ''
    }
  }
})
