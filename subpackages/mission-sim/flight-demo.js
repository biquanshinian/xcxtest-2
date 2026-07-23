/**
 * 飞行剖面自动演示详情页
 * - 主体复用 flight-profile-demo（示意图 + 双级遥测）
 * - 数据来自任务详情 eventChannel 传递的 LL2 飞行时间线
 * - 入口门控：任务详情 openFlightDemo → gateCheck('mission_sim')（会员 / 广告）
 * - 过审开关 enableMissionSim failClosed
 */
var featureFlags = require('../../utils/feature-flags.js')
var pageBase = require('../../utils/page-base.js')

Page({
  behaviors: [pageBase],
  /** 告知 theme.applyThemeToPage：恒深色，勿写入 theme-light */
  forceDarkTheme: true,
  _fallbackTab: '/pages/progress/progress',

  data: {
    enabled: true,
    pageVisible: true,
    contextPending: true,
    missionName: '',
    timeline: []
  },

  /** 覆盖 pageBase：本页固定深色 HUD，不跟随全局浅色主题 */
  syncTheme: function () {
    this.setData({ themeClass: '', themeLight: false, pageBgColor: '#000000' })
  },

  onLoad: function (options) {
    var that = this
    that.initUiShell()
    that.syncTheme()
    try {
      wx.setBackgroundColor({
        backgroundColor: '#000000',
        backgroundColorTop: '#000000',
        backgroundColorBottom: '#000000'
      })
    } catch (e) {}
    var gotCtx = false
    try {
      var ec = that.getOpenerEventChannel && that.getOpenerEventChannel()
      if (ec && ec.on) {
        ec.on('flightDemoContext', function (ctx) {
          gotCtx = true
          if (!ctx || !Array.isArray(ctx.rows) || !ctx.rows.length) {
            that.setData({ contextPending: false, timeline: [] })
            return
          }
          that.setData({
            contextPending: false,
            missionName: String(ctx.name || '').trim(),
            timeline: ctx.rows
          })
        })
      }
    } catch (e) {}
    // eventChannel 异步：短暂等待，避免首帧误显「请从详情页进入」
    setTimeout(function () {
      if (!gotCtx && that.data.contextPending) {
        that.setData({ contextPending: false })
      }
    }, 400)
    featureFlags.isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then(function (on) {
      if (!on) that.setData({ enabled: false })
    }).catch(function () {
      that.setData({ enabled: false })
    })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },

  onShow: function () {
    this.syncTheme()
    this.setData({ pageVisible: true })
  },

  onHide: function () {
    this.setData({ pageVisible: false })
  },

  onShareAppMessage: function () {
    return {
      title: '飞行剖面演示：按星舰任务时间线自动循环',
      path: '/pages/progress/progress'
    }
  },

  onShareTimeline: function () {
    return {
      title: '飞行剖面演示：按星舰任务时间线自动循环'
    }
  }
})
