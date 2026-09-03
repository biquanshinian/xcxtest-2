/**
 * 飞行剖面自动演示详情页
 * - 主体复用 flight-profile-demo（示意图 + 双级遥测）
 * - App 内入口：任务详情 eventChannel 传 LL2 时间线（秒开）
 * - 分享冷启动：path 带 id，本页自行 fetchLl2LaunchTimeline 对齐演示
 * - 入口门控：任务详情 openFlightDemo → gateCheck；分享直达走 share-gate 24h
 * - 过审开关 enableMissionSim failClosed
 */
var featureFlags = require('../../utils/feature-flags.js')
var pageBase = require('../../utils/page-base.js')
var shareGate = require('./utils/share-gate.js')
var { fetchLl2LaunchTimeline } = require('../../utils/api-app-services.js')
var { normalizeLl2TimelineList } = require('./utils/ll2-launch-timeline.js')

var GATE_PRODUCT_ID = 'mission_sim'
var GATE_PRODUCT_NAME = '飞行剖面演示'

function buildDemoTimeline(rows) {
  if (!Array.isArray(rows) || !rows.length) return []
  return rows.map(function (r) {
    return {
      t: r.sortKey,
      label: r.title,
      desc: r.description,
      tLabel: r.timeLabel
    }
  })
}

function buildShareQuery(missionId, detailType, missionName) {
  var parts = []
  if (missionId) parts.push('id=' + encodeURIComponent(missionId))
  if (detailType === 'completed') parts.push('type=completed')
  else if (missionId) parts.push('type=upcoming')
  if (missionName) parts.push('name=' + encodeURIComponent(String(missionName).slice(0, 80)))
  return parts.join('&')
}

Page({
  behaviors: [pageBase],
  /** 告知 theme.applyThemeToPage：恒深色，勿写入 theme-light */
  forceDarkTheme: true,
  _fallbackTab: '/pages/progress/progress',
  _missionId: '',
  _detailType: 'upcoming',
  _loadSeq: 0,

  data: {
    enabled: true,
    disabledText: '',
    shareGateExpireAt: 0,
    pageVisible: true,
    contextPending: true,
    missionName: '',
    timeline: [],
    hasMissionEntry: false,
    loadError: ''
  },

  /** 覆盖 pageBase：本页固定深色 HUD，不跟随全局浅色主题 */
  syncTheme: function () {
    this.setData({ themeClass: '', themeLight: false, pageBgColor: '#000000' })
  },

  _applyMissionEntry: function (id, detailType, name) {
    var missionId = id != null ? String(id).trim() : ''
    var type = detailType === 'completed' ? 'completed' : 'upcoming'
    if (missionId) this._missionId = missionId
    this._detailType = type
    var patch = {}
    if (this._missionId) patch.hasMissionEntry = true
    if (name != null && String(name).trim()) {
      patch.missionName = String(name).trim()
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  _applyDemoRows: function (demoRows, name) {
    var demo = Array.isArray(demoRows) ? demoRows : []
    var patch = {
      contextPending: false,
      timeline: demo,
      loadError: demo.length ? '' : '暂无可用飞行时间线'
    }
    if (name) patch.missionName = String(name).trim()
    this.setData(patch)
  },

  /** 分享冷启动 / eventChannel 未到：按任务 id 拉 LL2 时间线 */
  _loadTimelineByMissionId: function () {
    var that = this
    var id = that._missionId
    if (!id) {
      that.setData({
        contextPending: false,
        timeline: [],
        loadError: ''
      })
      return Promise.resolve(false)
    }
    var seq = ++that._loadSeq
    that.setData({ contextPending: true, loadError: '' })
    return fetchLl2LaunchTimeline(id, {})
      .then(function (res) {
        if (seq !== that._loadSeq) return false
        var rows = normalizeLl2TimelineList((res && res.timeline) || [])
        var name = that.data.missionName || (res && res.launchName) || ''
        that._applyDemoRows(buildDemoTimeline(rows), name)
        return rows.length > 0
      })
      .catch(function (e) {
        if (seq !== that._loadSeq) return false
        that.setData({
          contextPending: false,
          timeline: [],
          loadError: (e && e.message) ? String(e.message) : '飞行时间线加载失败'
        })
        return false
      })
  },

  onLoad: async function (options) {
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

    var optId = options && options.id != null ? String(options.id).trim() : ''
    var optType = options && options.type === 'completed' ? 'completed' : 'upcoming'
    var optName = ''
    if (options && options.name) {
      try { optName = decodeURIComponent(String(options.name)) } catch (e) { optName = String(options.name) }
    }
    that._applyMissionEntry(optId, optType, optName)

    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })

    // 过审开关
    featureFlags.isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then(function (on) {
      if (!on) that.setData({ enabled: false, disabledText: '该功能暂未开放' })
    }).catch(function () {
      that.setData({ enabled: false, disabledText: '该功能暂未开放' })
    })

    // 分享直达门控（与指挥室同一 productId）
    var shareAllowed = await shareGate.checkShareEntryGate(that, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      that.setData({
        enabled: false,
        disabledText: '分享链接已过期，开通星际通行证后可继续体验',
        contextPending: false
      })
      return
    }
    shareGate.warmShareEntitlement(that, GATE_PRODUCT_ID)

    var gotCtx = false
    try {
      var ec = that.getOpenerEventChannel && that.getOpenerEventChannel()
      if (ec && ec.on) {
        ec.on('flightDemoContext', function (ctx) {
          gotCtx = true
          if (ctx) {
            that._applyMissionEntry(ctx.id, ctx.detailType || optType, ctx.name)
          }
          if (!ctx || !Array.isArray(ctx.rows) || !ctx.rows.length) {
            // channel 空：若有 id 再走网络兜底
            if (that._missionId) that._loadTimelineByMissionId()
            else that.setData({ contextPending: false, timeline: [] })
            return
          }
          that._applyDemoRows(ctx.rows, ctx.name || that.data.missionName)
        })
      }
    } catch (e) {}

    // eventChannel 异步：短暂等待；仍无数据则按 id 拉时间线（分享冷启动主路径）
    setTimeout(function () {
      if (gotCtx || !that.data.contextPending) return
      if (that._missionId) {
        that._loadTimelineByMissionId()
      } else {
        that.setData({ contextPending: false, timeline: [] })
      }
    }, 400)
  },

  onShow: function () {
    this.syncTheme()
    this.setData({ pageVisible: true })
  },

  onHide: function () {
    this.setData({ pageVisible: false })
  },

  retryLoadTimeline: function () {
    if (!this._missionId) return
    this._loadTimelineByMissionId()
  },

  _sharePath: function () {
    var q = buildShareQuery(this._missionId, this._detailType, this.data.missionName)
    var base = '/subpackages/mission-sim/flight-demo' + (q ? '?' + q : '')
    return shareGate.withShareStampPath(base, this)
  },

  onShareAppMessage: function () {
    return {
      title: this.data.missionName
        ? ('飞行剖面演示 · ' + this.data.missionName + ' | 火星探索日志')
        : '飞行剖面演示：按星舰任务时间线自动循环',
      path: this._sharePath()
    }
  },

  onShareTimeline: function () {
    var q = buildShareQuery(this._missionId, this._detailType, this.data.missionName)
    return {
      title: this.data.missionName
        ? ('飞行剖面演示 · ' + this.data.missionName + ' | 火星探索日志')
        : '飞行剖面演示：按星舰任务时间线自动循环',
      query: shareGate.withShareStampQuery(q, this)
    }
  }
})
