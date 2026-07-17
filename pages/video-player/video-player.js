const { isPlaybackAllowed } = require('../../utils/feature-flags.js')
const { canUsePaidCloudSync, gateCheck } = require('../../utils/membership.js')
const { saveEventVideoToAlbum } = require('../../utils/event-video.js')

Page({
  data: {
    videoUrl: '',
    poster: '',
    closeTop: 48,
    closeLeft: 16,
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
    let remoteUrl = ''
    let originalUrl = ''
    let sourceUrl = ''

    try {
      const app = getApp()
      const pending = app && app.globalData && app.globalData.pendingEventVideo
      if (pending && pending.url) {
        url = pending.url
        poster = pending.poster || ''
        remoteUrl = pending.remoteUrl || ''
        originalUrl = pending.originalUrl || ''
        sourceUrl = pending.sourceUrl || ''
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

    // 长按菜单用：复制链接优先原片/来源，保存用当前播放文件
    this._remoteUrl = remoteUrl
    this._originalUrl = originalUrl
    this._sourceUrl = sourceUrl

    // 关闭钮与胶囊同高、同顶边，左边距取胶囊的右边距做镜像对称
    let closeTop = 48
    let closeLeft = 16
    let closeSize = 32
    try {
      const rect = wx.getMenuButtonBoundingClientRect()
      if (rect && rect.height) {
        closeSize = Math.round(rect.height)
        closeTop = Math.round(rect.top)
        let windowWidth = 0
        try {
          windowWidth = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || 0
        } catch (err) {}
        if (!windowWidth) {
          try { windowWidth = wx.getSystemInfoSync().windowWidth || 0 } catch (err) {}
        }
        if (windowWidth && rect.right) {
          const margin = Math.round(windowWidth - rect.right)
          if (margin > 0 && margin < 60) closeLeft = margin
        }
      }
    } catch (e) {}

    this.setData({ videoUrl: url, poster, closeTop, closeLeft, closeSize })
  },

  /** 长按视频：会员弹保存/复制菜单；非会员先过会员门控（无广告通道） */
  async onVideoLongPress() {
    const playUrl = this.data.videoUrl
    if (!playUrl) return

    if (!canUsePaidCloudSync()) {
      const allowed = await gateCheck('starship_event_list_full', '事件视频 · 保存与转发', { allowAd: false })
      if (!allowed) return
    }

    const remotePlay = /^https?:\/\//i.test(playUrl) ? playUrl : ''
    const copyLink = this._originalUrl || this._sourceUrl || this._remoteUrl || remotePlay
    const items = ['保存视频到相册']
    if (copyLink) items.push('复制视频链接')

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          saveEventVideoToAlbum(playUrl)
        } else if (res.tapIndex === 1 && copyLink) {
          wx.setClipboardData({
            data: copyLink,
            success() {
              wx.showToast({ title: '视频链接已复制', icon: 'none' })
            }
          })
        }
      },
      fail() {}
    })
  },

  onClose() {
    wx.navigateBack({ fail() {} })
  }
})
