/**
 * 飞行剖面自动演示：飞行示意图 + 双级遥测，按任务 LL2 时间线 autoDemo 循环
 * mode=mini 内嵌预览（点击抛 opentap）；mode=full 完整演示页主体
 */
var engine = require('../../sim-engine.js')
var flightViz = require('../../flight-viz.js')
var flightTick = require('../../flight-tick.js')
var themeUtil = require('../../../../utils/theme.js')

var DEMO_RATE = 4
var DEMO_SEED = 20260

function normalizeTimeline(list) {
  if (!Array.isArray(list) || !list.length) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {}
    var t = Number(r.t != null ? r.t : r.sortKey)
    if (!isFinite(t)) continue
    out.push({
      t: t,
      label: String(r.label || r.title || '').trim(),
      desc: String(r.desc || r.description || '').trim(),
      tLabel: String(r.tLabel || r.timeLabel || '').trim()
    })
  }
  return out.length ? out : null
}

function timelineKey(list) {
  // 仅用任务秒序列作身份；翻译只改文案，不应打断循环
  if (!list || !list.length) return ''
  return list.map(function (r) {
    return String(r.t != null ? r.t : r.sortKey)
  }).join('|')
}

Component({
  properties: {
    timeline: { type: Array, value: [] },
    missionName: { type: String, value: '' },
    mode: { type: String, value: 'mini' },
    active: { type: Boolean, value: true },
    /** 为 true 时锁定深色外壳（完整演示页 / 指挥室同款 HUD） */
    lockDark: { type: Boolean, value: false }
  },

  data: {
    sim: null,
    /* 组件样式隔离：页面根 .theme-light 进不来，自挂浅色修饰类 */
    themeLight: false
  },

  lifetimes: {
    attached: function () {
      var that = this
      that._syncTheme()
      that._themeHandler = that._syncTheme.bind(that)
      themeUtil.onThemeChange(that._themeHandler)
      that._viz = flightViz.createFlightViz({
        scope: that,
        diagramId: '#fpdDiagram',
        enginesId: '#fpdEngines',
        getSeed: function () { return DEMO_SEED }
      })
      that._syncRun()
    },
    detached: function () {
      this._dead = true
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
      this._clearLoopTimer()
      this._stop()
      if (this._viz) {
        this._viz.destroy()
        this._viz = null
      }
    }
  },

  pageLifetimes: {
    show: function () {
      if (this._dead) return
      this._pageHidden = false
      this._syncTheme()
      this._syncRun()
    },
    hide: function () {
      this._pageHidden = true
      this._clearLoopTimer()
      this._stopTimer()
    }
  },

  observers: {
    'timeline, active': function () {
      this._syncRun()
    }
  },

  methods: {
    _syncTheme: function () {
      var light = this.properties.lockDark ? false : themeUtil.isLightSync()
      if (light !== this.data.themeLight) this.setData({ themeLight: light })
    },

    onRootTap: function () {
      if (this.data.mode !== 'mini') return
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
      this.triggerEvent('opentap')
    },

    _syncRun: function () {
      if (!this._viz) return
      var active = !!this.properties.active && !this._pageHidden
      var rows = normalizeTimeline(this.properties.timeline)
      var key = timelineKey(this.properties.timeline)
      if (!active || !rows) {
        this._stop()
        return
      }
      if (this._running && this._tlKey === key) {
        // 从后台回前台时 _loop 已被 stop，需续跑（勿再用已删除的 _timer）
        if (!this._loop) this._startTimer()
        return
      }
      this._tlKey = key
      this._begin(rows)
    },

    _begin: function (rows) {
      var that = this
      if (that._dead || !that._viz) return
      that._clearLoopTimer()
      that._stopTimer()
      that._mission = engine.createMission({
        seed: DEMO_SEED,
        timeline: rows,
        autoDemo: true
      })
      that._mission.setRate(DEMO_RATE)
      var profile = that._mission.snapshot().profile || flightViz.DEFAULT_GEO_PROFILE
      that._viz.setGeo(profile)
      that._viz.clearTrails()
      that._running = true
      that._lastTeleKey = ''
      that.setData({ sim: null }, function () {
        if (that._dead || !that._viz || !that._mission) return
        that._viz.init()
        var snap0 = that._mission.snapshot()
        that._lastTeleKey = ''
        that._viz.draw(snap0)
        that.setData({
          sim: {
            tText: snap0.tText,
            phaseLabel: snap0.phaseLabel,
            propLoad: snap0.propLoad,
            water: snap0.water,
            phase: snap0.phase
          }
        })
        that._startTimer()
      })
    },

    _loopRestart: function () {
      if (this._dead || !this._viz) return
      var rows = normalizeTimeline(this.properties.timeline)
      if (!rows || !this.properties.active || this._pageHidden) {
        this._stop()
        return
      }
      this._begin(rows)
    },

    _startTimer: function () {
      var that = this
      that._stopTimer()
      if (that._dead) return
      that._loop = flightTick.createRenderLoop({
        onFrame: function (dt, flushUi) { that._tick(dt, flushUi) }
      })
      that._loop.start()
    },

    _stopTimer: function () {
      if (this._loop) {
        this._loop.stop()
        this._loop = null
      }
    },

    _clearLoopTimer: function () {
      if (this._loopTimer) {
        clearTimeout(this._loopTimer)
        this._loopTimer = null
      }
    },

    _stop: function () {
      this._clearLoopTimer()
      this._stopTimer()
      this._running = false
      this._mission = null
      if (!this._dead && this.data.sim) this.setData({ sim: null })
    },

    _tick: function (dtMs, flushUi) {
      if (this._dead || !this._mission) return
      var snap = flightTick.stepSmoothed(this._mission, dtMs)
      if (!snap) return
      if (this._viz) this._viz.draw(snap)
      var teleKey = snap.tText + '|' + snap.phaseLabel + '|' + snap.propLoad + '|' + snap.water
      if (!this.data.sim || flushUi || teleKey !== this._lastTeleKey || snap.phase === 'done') {
        this._lastTeleKey = teleKey
        this.setData({
          sim: {
            tText: snap.tText,
            phaseLabel: snap.phaseLabel,
            propLoad: snap.propLoad,
            water: snap.water,
            phase: snap.phase
          }
        })
      }
      if (snap.phase === 'done') {
        this._stopTimer()
        var that = this
        that._clearLoopTimer()
        that._loopTimer = setTimeout(function () {
          that._loopTimer = null
          that._loopRestart()
        }, 600)
      }
    }
  }
})
