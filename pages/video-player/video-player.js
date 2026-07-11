const { isPlaybackAllowed } = require('../../utils/feature-flags.js')

Page({
  data: {
    videoUrl: '',
    poster: '',
    closeTop: 48,
    closeSize: 32
  },

  onLoad(options) {
    isPlaybackAllowed()
      .catch(() => false)
      .then((allowed) => {
        if (!allowed) {
          wx.showToast({ title: '功能暂未开放', icon: 'none' })
          setTimeout(() => wx.navigateBack({ fail() {} }), 800)
          return
        }
        this._bootPlayer(options)
      })
  },

  _bootPlayer(options) {
    let url = ''
    let poster = ''

    try {
      const app = getApp()
      const pending = app && app.globalData && app.globalData.pendingEventVideo
      if (pending && pending.url) {
        url = pending.url
        poster = pending.poster || ''
        app.globalData.pendingEventVideo = null
      }
    } catch (e) {}

    if (!url) {
      const raw = options.url || ''
      url = raw ? decodeURIComponent(raw) : ''
      const posterRaw = options.poster || ''
      poster = posterRaw ? decodeURIComponent(posterRaw) : ''
    }

    if (!url) {
      wx.showToast({ title: '无效视频地址', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    // 关闭钮与胶囊同高、同顶边，固定在左上（避开右上胶囊）
    let closeTop = 48
    let closeSize = 32
    try {
      const rect = wx.getMenuButtonBoundingClientRect()
      if (rect && rect.height) {
        closeSize = Math.round(rect.height)
        closeTop = Math.round(rect.top)
      }
    } catch (e) {}

    this.setData({ videoUrl: url, poster, closeTop, closeSize })
  },

  onClose() {
    wx.navigateBack({ fail() {} })
  }
})
