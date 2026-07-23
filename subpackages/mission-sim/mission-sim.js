/**
 * 星舰任务指挥室：飞行总监决策模拟（互动科普详情页）
 * - 纯本地运行（sim-engine.js 确定性引擎），零云调用
 * - 竖向飞行时间线（决策门内联节点）+ 简易平面飞行示意图（离屏底图缓存）
 * - 入口由 global_config.main.enableMissionSim 过审开关控制（failClosed）
 */
var engine = require('./sim-engine.js')
var flightViz = require('./flight-viz.js')
var flightTick = require('./flight-tick.js')
var featureFlags = require('../../utils/feature-flags.js')
var pageBase = require('../../utils/page-base.js')
var shareGate = require('./utils/share-gate.js')

var GATE_PRODUCT_ID = 'mission_sim'
var GATE_PRODUCT_NAME = '星舰任务指挥室'

var DEFAULT_GEO_PROFILE = flightViz.DEFAULT_GEO_PROFILE

Page({
  behaviors: [pageBase],
  /** 告知 theme.applyThemeToPage：恒深色，勿写入 theme-light */
  forceDarkTheme: true,
  _fallbackTab: '/pages/progress/progress',

  data: {
    enabled: true,
    disabledText: '',
    shareGateExpireAt: 0,
    started: false,
    seed: 20260,
    sim: null,
    logTail: [],
    logAnchor: '',
    scrollAnchor: '',
    debriefHidden: false,
    rate: 1,
    missionName: '',
    missionTlCount: 0
  },

  _missionCtx: null,

  _mission: null,
  _loop: null,
  _lastRev: -1,
  _lastTeleKey: '',
  _lastTlKey: '',
  _viz: null,

  onLoad: async function (options) {
    var that = this
    that._viz = flightViz.createFlightViz({
      scope: that,
      diagramId: '#msDiagram',
      enginesId: '#msEngines',
      getSeed: function () { return that.data.seed }
    })
    that.initUiShell()
    // 指挥室固定深色 HUD，不跟随全局浅色主题
    that.setData({ themeClass: '', themeLight: false, pageBgColor: '#000000' })
    try {
      wx.setBackgroundColor({
        backgroundColor: '#000000',
        backgroundColorTop: '#000000',
        backgroundColorBottom: '#000000'
      })
    } catch (e) {}
    var seed = parseInt(options && options.seed, 10)
    that.setData({
      seed: (seed > 0 && seed < 100000000) ? seed : 20260
    })
    // 从任务详情页进入：接收该任务的 LL2 飞行时间线，模拟全程对齐真实节点
    try {
      var ec = that.getOpenerEventChannel && that.getOpenerEventChannel()
      if (ec && ec.on) {
        ec.on('missionSimContext', function (ctx) {
          if (!ctx || !Array.isArray(ctx.rows) || !ctx.rows.length) return
          that._missionCtx = ctx
          that.setData({
            missionName: String(ctx.name || '').trim(),
            missionTlCount: ctx.rows.length
          })
        })
      }
    } catch (e) { }
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
    // 过审开关：failClosed，读不到配置直接不放行
    featureFlags.isFeatureEnabled('enableMissionSim', { failClosed: true, defaultOff: true }).then(function (on) {
      if (!on) that.setData({ enabled: false })
    }).catch(function () {
      that.setData({ enabled: false })
    })
    // 分享直达门控：App 内自然入口已在进度页/任务详情页 gateCheck；
    // 分享卡片带 sst 时间戳 24h 内免门控，过期走 gateCheck（会员放行，非会员弹开通引导）
    var shareAllowed = await shareGate.checkShareEntryGate(that, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      that.setData({ enabled: false, disabledText: '分享链接已过期，开通星际通行证后可继续体验' })
      return
    }
    shareGate.warmShareEntitlement(that, GATE_PRODUCT_ID)
  },

  /** 覆盖 pageBase：全局切浅色时也不给本页挂 theme-light */
  syncTheme: function () {
    this.setData({ themeClass: '', themeLight: false, pageBgColor: '#000000' })
  },

  onShow: function () {
    this.syncTheme()
    if (this.data.started && this._mission && (!this._loop || !this._loopRunning)) this._startTimer()
  },

  onHide: function () {
    this._stopTimer()
  },

  onUnload: function () {
    this._stopTimer()
    this._mission = null
    if (this._viz) { this._viz.destroy(); this._viz = null }
  },

  /* ========== 开局 ========== */

  onStartTap: function (e) {
    var mode = e.currentTarget.dataset.mode
    var seed = this.data.seed
    if (mode === 'random') {
      seed = (Date.now() % 900000) + 100000
    }
    this._begin(seed)
  },

  _begin: function (seed) {
    var that = this
    that._mission = engine.createMission({
      seed: seed,
      timeline: that._missionCtx ? that._missionCtx.rows : null
    })
    // 飞行路线图随任务剖面自动生成（捕获/溅落/载荷部署）
    if (that._viz) {
      that._viz.setGeo(that._mission.snapshot().profile || DEFAULT_GEO_PROFILE)
      that._viz.clearTrails()
    }
    // 保留玩家上一局选择的倍率
    if (that.data.rate !== 1) that._mission.setRate(that.data.rate)
    that._lastRev = -1
    that._lastTeleKey = ''
    that._lastTlKey = ''
    that.setData({ started: true, seed: seed, sim: null, logTail: [], logAnchor: '', scrollAnchor: '', debriefHidden: false }, function () {
      if (that._viz) that._viz.init()
    })
    that._applySnapshot(that._mission.snapshot())
    that._startTimer()
  },

  _startTimer: function () {
    var that = this
    that._stopTimer()
    that._loopRunning = true
    that._loop = flightTick.createRenderLoop({
      onFrame: function (dt, flushUi) { that._tick(dt, flushUi) }
    })
    that._loop.start()
  },

  _stopTimer: function () {
    this._loopRunning = false
    if (this._loop) {
      this._loop.stop()
      this._loop = null
    }
  },

  _tick: function (dtMs, flushUi) {
    if (!this._mission) return
    var snap = flightTick.stepSmoothed(this._mission, dtMs)
    if (!snap) return
    // 画布每帧刷新；文案/时间线约 10Hz，避免 setData 拖垮帧率
    if (this._viz) this._viz.draw(snap)
    var discrete = snap.rev !== this._lastRev || snap.tlKey !== this._lastTlKey
    if (this.data.sim === null || discrete || flushUi || snap.phase === 'done') {
      this._applySnapshot(snap, true)
    }
    if (snap.phase === 'done') this._stopTimer()
  },

  /* ========== 快照 → setData（分层 diff；画布由 _tick 单独刷新） ========== */

  _applySnapshot: function (snap, skipDraw) {
    var patch = {}
    var gateJustOpened = false

    // 连续遥测
    var teleKey = snap.tText + '|' + Math.round(snap.altKm * 10) + '|' + Math.round(snap.speedKmh) + '|' + snap.propLoad + '|' + snap.water + '|' + snap.warp + '|' + snap.phaseLabel
    if (teleKey !== this._lastTeleKey) {
      this._lastTeleKey = teleKey
      patch['sim.tText'] = snap.tText
      patch['sim.phaseLabel'] = snap.phaseLabel
      patch['sim.warp'] = snap.warp
      patch['sim.propLoad'] = snap.propLoad
      patch['sim.water'] = snap.water
      patch['sim.altText'] = snap.altKm >= 10 ? String(Math.round(snap.altKm)) : snap.altKm.toFixed(1)
      patch['sim.speedText'] = String(Math.round(snap.speedKmh))
    }
    // 时间线节点状态
    if (snap.tlKey !== this._lastTlKey) {
      gateJustOpened = snap.tlKey.indexOf('G') !== -1 && this._lastTlKey.indexOf('G') === -1
      this._lastTlKey = snap.tlKey
      patch['sim.timeline'] = snap.timeline
    }
    // 离散状态
    if (snap.rev !== this._lastRev) {
      this._lastRev = snap.rev
      patch['sim.phase'] = snap.phase
      patch['sim.stations'] = snap.stations
      patch['sim.gate'] = snap.gate
      patch['sim.outcome'] = snap.outcome
      var tail = snap.log.slice(-8)
      patch.logTail = tail
      patch.logAnchor = 'msLog' + (tail.length - 1)
    }

    if (this.data.sim === null) {
      this.setData({
        sim: {
          tText: snap.tText, phase: snap.phase, phaseLabel: snap.phaseLabel, warp: snap.warp,
          propLoad: snap.propLoad, water: snap.water,
          altText: '0', speedText: '0',
          timeline: snap.timeline,
          stations: snap.stations, gate: snap.gate, outcome: snap.outcome
        },
        logTail: snap.log.slice(-8),
        logAnchor: ''
      })
    } else if (Object.keys(patch).length) {
      this.setData(patch)
    }

    // 决策门刚打开：滚到时间线上的门节点（scroll-view 内用 scroll-into-view）
    if (gateJustOpened) {
      var that = this
      setTimeout(function () {
        that.setData({ scrollAnchor: '' }, function () {
          that.setData({ scrollAnchor: 'msGateNode' })
        })
      }, 150)
    }

    if (!skipDraw && this._viz) this._viz.draw(snap)
  },

  /* ========== 决策与结算操作 ========== */

  onRateTap: function (e) {
    if (!this._mission) return
    var rate = parseInt(e.currentTarget.dataset.rate, 10) || 1
    if (rate === this.data.rate) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) { }
    this._mission.setRate(rate)
    this.setData({ rate: rate })
  },

  onGateDecide: function (e) {
    if (!this._mission) return
    var key = e.currentTarget.dataset.key
    var snap = this._mission.snapshot()
    if (!snap.gate) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) { }
    this._mission.decide(snap.gate.id, key)
    this._applySnapshot(this._mission.snapshot())
    if (this._mission.snapshot().phase === 'done') this._stopTimer()
  },

  onReplaySame: function () {
    this._begin(this.data.seed)
  },

  onReplayNew: function () {
    this._begin((Date.now() % 900000) + 100000)
  },

  onHideDebrief: function () {
    this.setData({ debriefHidden: true })
  },

  onShowDebrief: function () {
    this.setData({ debriefHidden: false })
  },

  onShareAppMessage: function () {
    var o = this.data.sim && this.data.sim.outcome
    return {
      title: o ? ('星舰任务指挥室：' + o.title + '（SEED ' + this.data.seed + '，同种子同结果）') : '星舰任务指挥室：来做一次发射 GO/NO-GO 决策',
      // 有权益用户分享带新 sst 时间戳（接收者 24h 内免门控）；无权益接收者转发继承原时间戳
      path: shareGate.withShareStampPath('/subpackages/mission-sim/mission-sim?seed=' + this.data.seed, this)
    }
  },

  onShareTimeline: function () {
    return {
      title: '星舰任务指挥室：发射流程互动模拟',
      query: shareGate.withShareStampQuery('seed=' + this.data.seed, this)
    }
  },


})
