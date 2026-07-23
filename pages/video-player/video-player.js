const { isPlaybackAllowed } = require('../../utils/feature-flags.js')
const { canUsePaidCloudSync, gateCheck } = require('../../utils/membership.js')
const { saveEventVideoToAlbum } = require('./utils/event-video.js')

Page({
  data: {
    playerReady: false,
    momentsHint: false,
    videoUrl: '',
    poster: '',
    closeTop: 48,
    closeLeft: 16,
    closeSize: 32
  },

  onLoad(options) {
    // 页面定义了 onShareAppMessage 后转发菜单默认开启；先关掉，待 _bootPlayer 按会员身份放开
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }) } catch (e) {}

    // 朋友圈分享落地：onShareTimeline 无法换页，落地页固定是本页，只能靠 goto 参数二跳。
    // 单页模式（scene 1154）无法跳转，展示提示引导打开完整小程序；完整模式直接重定向到来源详情页
    const goto = this._resolveShareLandingPath(options)
    if (goto) {
      if (this._isMomentsSinglePage()) {
        this.setData({ momentsHint: true })
        return
      }
      wx.redirectTo({
        url: goto,
        fail() {
          wx.switchTab({ url: '/pages/index/index', fail() {} })
        }
      })
      return
    }

    isPlaybackAllowed()
      .catch(() => false)
      .then((allowed) => {
        if (!allowed) {
          wx.showToast({ title: '功能暂未开放', icon: 'none' })
          wx.navigateBack({ fail() {} })
          return
        }
        this._bootPlayer(options)
      })
  },

  /** 分享落地参数：仅接受站内页面路径，防任意跳转 */
  _resolveShareLandingPath(options) {
    let raw = (options && options.goto) || ''
    if (!raw) return ''
    try { raw = decodeURIComponent(raw) } catch (e) {}
    return /^\/(pages|subpackages)\/[\w\-/?=&%.~!*'(),+:@]*$/.test(raw) ? raw : ''
  },

  _isMomentsSinglePage() {
    try {
      const enter = (typeof wx.getEnterOptionsSync === 'function' && wx.getEnterOptionsSync()) || wx.getLaunchOptionsSync()
      return !!enter && enter.scene === 1154
    } catch (e) {
      return false
    }
  },

  _bootPlayer(options) {
    let url = ''
    let poster = ''
    let remoteUrl = ''
    let originalUrl = ''
    let sourceUrl = ''
    let shareInfo = null

    try {
      const app = getApp()
      const pending = app && app.globalData && app.globalData.pendingEventVideo
      if (pending && pending.url) {
        url = pending.url
        poster = pending.poster || ''
        remoteUrl = pending.remoteUrl || ''
        originalUrl = pending.originalUrl || ''
        sourceUrl = pending.sourceUrl || ''
        shareInfo = (pending.share && pending.share.path) ? pending.share : null
        app.globalData.pendingEventVideo = null
      }
    } catch (e) {}

    // 分享上下文由来源页显式传入（如任务详情回放/集锦、事件更新视频），落地页回到来源详情页，
    // 观看仍走那边的门控。转发/朋友圈入口仅会员开放：免费用户（含看广告解锁）只支持观看；
    // 未传上下文的视频同样禁用转发
    const canShare = !!shareInfo && canUsePaidCloudSync()
    this._shareInfo = canShare ? shareInfo : null
    try {
      if (canShare) {
        wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
      } else {
        wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
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
      wx.navigateBack({ fail() {} })
      return
    }

    // 长按菜单用：保存与复制链接均优先原片（播放的是压缩预览，不能存压缩版）
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

    this.setData({
      playerReady: true,
      videoUrl: url,
      poster,
      closeTop,
      closeLeft,
      closeSize
    })
  },

  /** 长按视频：会员弹保存/复制菜单；非会员先过会员门控（无广告通道） */
  async onVideoLongPress() {
    if (!this.data.playerReady) return
    const playUrl = this.data.videoUrl
    if (!playUrl) return

    if (!canUsePaidCloudSync()) {
      const allowed = await gateCheck('starship_event_list_full', '事件视频 · 保存与转发', { allowAd: false })
      if (!allowed) return
    }

    const remotePlay = /^https?:\/\//i.test(playUrl) ? playUrl : ''
    const copyLink = this._originalUrl || this._sourceUrl || this._remoteUrl || remotePlay
    // 会员下载给原片；无原片地址（外部入口直传 url）才退回当前播放文件
    const saveUrl = this._originalUrl || playUrl
    const items = [this._originalUrl ? '保存原视频到相册' : '保存视频到相册']
    if (copyLink) items.push('复制视频链接')

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          saveEventVideoToAlbum(saveUrl)
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
  },

  /** 转发给朋友：回放/集锦带上下文时落回对应任务详情页，否则兜底首页 */
  onShareAppMessage() {
    const s = this._shareInfo
    if (s && s.path) {
      return { title: s.title || '发射回放 | 火星探索日志', path: s.path, imageUrl: s.imageUrl || '' }
    }
    return { title: '火星探索日志', path: '/pages/index/index' }
  },

  /** 分享到朋友圈：落地页固定是本页，query 带 goto 指向来源详情页，onLoad 里二跳 */
  onShareTimeline() {
    const s = this._shareInfo
    if (s && s.path) {
      return {
        title: s.title || '发射回放 | 火星探索日志',
        query: 'goto=' + encodeURIComponent(s.path),
        imageUrl: s.imageUrl || ''
      }
    }
    return { title: '火星探索日志', query: '' }
  }
})
