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
    menuButtonWidth: 88
  },

  onLoad(options) {
    this.initUiShell()
    this._syncProState()
    this._loadFromStorage()
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
        observer: payload.observer || null
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
      allowed = await gateCheck('starlink_pro', '7天过境预报')
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

  onShareAppMessage() {
    const count = this.data.passCount
    return {
      title: count
        ? `星链过境预报 - 未来24小时共${count}次可见 | 火星探索日志`
        : '星链过境预报 | 火星探索日志',
      path: '/pages/monitor/monitor'
    }
  }
})
