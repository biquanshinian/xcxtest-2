var { resolveRocketModel } = require('../../models.js')
var runtime = require('../../runtime.js')
var { getStandFlipPref, setStandFlipPref } = require('../../stand-flip-pref.js')
var theme = require('../../../../utils/theme.js')

function loadThreeLib() {
  if (!loadThreeLib._mod) {
    loadThreeLib._mod = require('../../lib/three-wx.js')
  }
  return loadThreeLib._mod
}

/** 给异常打上失败环节标记（非 Error 对象也转成 Error），供失败弹窗展示 */
function tagErrorSafe(err, stage) {
  var e = err instanceof Error ? err : new Error(String((err && (err.message || err.errMsg)) || err))
  if (!e._r3dStage) e._r3dStage = stage
  return e
}

function waitForCanvasRetry(lib, component, left) {
  var n = left == null ? 6 : left
  return lib.waitForCanvas('#rocket3d', component).catch(function (err) {
    if (n <= 1) throw err
    return new Promise(function (resolve) {
      setTimeout(resolve, 50)
    }).then(function () {
      return waitForCanvasRetry(lib, component, n - 1)
    })
  })
}

Component({
  properties: {
    rocketName: { type: String, value: '' },
    rocketNameEn: { type: String, value: '' },
    poster: { type: String, value: '' },
    modelUrl: { type: String, value: '' },
    /** 为 false 时停渲染循环（切页签 / 退后台） */
    active: { type: Boolean, value: true },
    autoLoad: { type: Boolean, value: false },
    allowExpand: { type: Boolean, value: true },
    /** embed=详情内嵌视口；page=全屏展陈 */
    mode: { type: String, value: 'embed' },
    configId: { type: String, value: '' },
    dimLength: { type: String, value: '' },
    dimDiameter: { type: String, value: '' }
  },

  data: {
    started: false,
    loading: false,
    usingPlaceholder: false,
    themeLight: false,
    live: false,
    standFlipped: false,
    dimLabels: []
  },

  lifetimes: {
    attached: function () {
      this._syncMeta()
      var that = this
      this._onThemeChange = function () {
        that._applyTheme()
      }
      theme.onThemeChange(this._onThemeChange)
      this._applyTheme()
    },
    ready: function () {
      if (this.properties.autoLoad) {
        this._tryAutoLoad()
      }
    },
    detached: function () {
      theme.offThemeChange(this._onThemeChange)
      this._teardown()
    }
  },

  pageLifetimes: {
    show: function () {
      this._pageVisible = true
      this._recoverIfNeeded()
      this._syncLoop()
    },
    hide: function () {
      this._pageVisible = false
      this._syncLoop()
    }
  },

  observers: {
    'rocketName, rocketNameEn, modelUrl': function () {
      this._syncMeta()
      if (this.properties.autoLoad) this._tryAutoLoad()
    },
    'dimLength, dimDiameter': function () {
      if (this._exhibitMode === 'size') this._applyDimGuides()
    },
    active: function () {
      this._syncLoop()
    }
  },

  methods: {
    _isLightTheme: function () {
      if (this.properties.mode === 'page') return false
      return theme.isLightSync()
    },

    _applyTheme: function () {
      var light = this._isLightTheme()
      if (this.data.themeLight !== light) {
        this.setData({ themeLight: light })
      }
      runtime.applyClearColor(this._session, light)
    },

    _emitStatus: function (error, detail, progress) {
      var pct = progress == null ? this._loadProgress : progress
      this._loadProgress = pct == null ? 0 : pct
      this.triggerEvent('statuschange', {
        started: !!this.data.started,
        loading: !!this.data.loading,
        usingPlaceholder: !!this.data.usingPlaceholder,
        progress: this._loadProgress,
        error: error ? String(error) : '',
        detail: detail ? String(detail) : ''
      })
    },

    _syncMeta: function () {
      var resolved = resolveRocketModel({
        rocketName: this.properties.rocketName,
        rocketNameEn: this.properties.rocketNameEn,
        modelUrl: this.properties.modelUrl
      })
      this._resolved = resolved
      return resolved
    },

    _tryAutoLoad: function () {
      if (!this.properties.autoLoad || this._starting || this._session) return
      var resolved = this._syncMeta()
      if (!resolved.url) return
      this.startViewer()
    },

    onStageTap: function () {
      if (this.data.started) return
      this.startViewer()
    },

    startViewer: function () {
      if (this._starting || this._session) {
        this._syncLoop()
        return
      }
      this._starting = true
      this._loadProgress = 4
      var bootGen = this._bootGen || 0
      this._bootGen = bootGen
      this.setData({ started: true, loading: true, live: false, standFlipped: false })
      this._emitStatus('', '', 4)
      var that = this
      this._boot()
        .catch(function (err) {
          if (bootGen !== that._bootGen) return
          console.error('[rocket-3d] 启动失败', err)
          var msg = runtime.friendlyGlbError(err)
          that.setData({ started: false, loading: false, live: false })
          that._emitStatus(msg, runtime.errorDetail(err), 0)
          that._teardown()
        })
        .then(function () {
          if (bootGen === that._bootGen) that._starting = false
        })
    },

    _boot: function () {
      var that = this
      var bootGen = this._bootGen || 0
      var alive = function () {
        return bootGen === that._bootGen
      }
      var tag = function (stage) {
        return function (err) {
          throw tagErrorSafe(err, stage)
        }
      }
      var lib
      try {
        lib = loadThreeLib()
      } catch (err) {
        return Promise.reject(tagErrorSafe(err, '加载 3D 库'))
      }
      return waitForCanvasRetry(lib, this)
        .catch(tag('获取画布节点'))
        .then(function (nativeCanvas) {
          if (!alive()) return
          that._nativeCanvas = nativeCanvas
          try {
            that._adapter = lib.adaptForMiniProgram(nativeCanvas)
          } catch (err) {
            throw tagErrorSafe(err, '适配画布')
          }
          return runtime
            .measureCanvasBox(that, '#rocket3d')
            .catch(tag('测量画布尺寸'))
            .then(function (rect) {
              if (!alive()) return
              try {
                that._session = runtime.createSession(
                  lib,
                  nativeCanvas,
                  that._adapter.canvas,
                  rect,
                  {
                    exhibit: that.properties.mode === 'page',
                    onUserInteract: function () {
                      if (that._session) {
                        that._session.autoRotate = false
                        runtime.cancelExhibitTween(that._session)
                      }
                    },
                    onDimLabels: function (labels) {
                      that._setDimLabels(labels)
                    }
                  }
                )
              } catch (err) {
                throw tagErrorSafe(err, '创建渲染器')
              }
              if (!alive()) {
                try {
                  runtime.disposeSession(that._session)
                } catch (e) {}
                that._session = null
                return
              }
              runtime.applyClearColor(that._session, that._isLightTheme())
              return that._loadModel(lib).catch(tag('装载模型'))
            })
        })
        .then(function () {
          if (!alive()) return
          that.setData({ loading: false, live: true })
          that._emitStatus('', '', 100)
          that._syncLoop()
        })
    },

    _loadModel: function (lib) {
      var that = this
      var bootGen = this._bootGen || 0
      var resolved = this._syncMeta()
      var session = this._session
      if (!session) return Promise.resolve()
      if (!resolved.url) {
        return Promise.reject(new Error('该型号暂无 3D 模型'))
      }
      return runtime
        .loadGlb(lib, resolved.url, that._nativeCanvas, function (pct) {
          if (bootGen !== that._bootGen) return
          that._emitStatus('', '', pct)
        })
        .then(function (scene) {
          if (bootGen !== that._bootGen || that._session !== session) return
          runtime.setModel(session, scene)
          var slug = resolved.slug
          if (getStandFlipPref(slug)) runtime.applyManualStandFlip(session, true)
          var flipped = runtime.isStandFlipped(session)
          that.setData({ usingPlaceholder: false, standFlipped: flipped })
          that.triggerEvent('flipchange', { flipped: flipped })
          that._emitStatus('', '', 100)
        })
    },

    _shouldRun: function () {
      return !!(this._session && this.data.started && this.properties.active && this._pageVisible !== false)
    },

    _syncLoop: function () {
      if (!this._session) return
      if (this._shouldRun()) runtime.startLoop(this._session)
      else runtime.stopLoop(this._session)
    },

    _recoverIfNeeded: function () {
      var canvas = this._adapter && this._adapter.canvas
      if (canvas && typeof canvas.recoverContext === 'function') {
        try {
          canvas.recoverContext()
        } catch {}
      }
    },

    _teardown: function () {
      this._bootGen = (this._bootGen || 0) + 1
      this._starting = false
      try {
        runtime.stopLoop(this._session)
      } catch (e) {}
      try {
        runtime.disposeSession(this._session)
      } catch (e) {}
      this._session = null
      this._exhibitMode = ''
      try {
        this._setDimLabels([])
      } catch (e) {}
      if (this._adapter && this._adapter.dispose) {
        try {
          this._adapter.dispose()
        } catch (e) {}
      }
      this._adapter = null
      this._nativeCanvas = null
    },

    resizeViewport: function () {
      var that = this
      if (!this._session) return Promise.resolve()
      return runtime.measureCanvasBox(this, '#rocket3d').then(function (rect) {
        runtime.resizeSession(that._session, rect)
      })
    },

    _setDimLabels: function (labels) {
      var next = (Array.isArray(labels) ? labels : []).filter(function (item) {
        return item && item.visible && item.text
      })
      var prev = this.data.dimLabels || []
      if (prev.length === next.length) {
        var same = true
        for (var i = 0; i < next.length; i++) {
          if (prev[i].key !== next[i].key || prev[i].text !== next[i].text) {
            same = false
            break
          }
          if (Math.abs(prev[i].x - next[i].x) > 1 || Math.abs(prev[i].y - next[i].y) > 1) {
            same = false
            break
          }
        }
        if (same) return
      }
      this.setData({ dimLabels: next })
    },

    _applyDimGuides: function () {
      if (!this._session) return
      var on = this._exhibitMode === 'size'
      runtime.setDimensionGuides(this._session, on, {
        length: this.properties.dimLength,
        diameter: this.properties.dimDiameter
      })
      if (!on) this._setDimLabels([])
    },

    playExhibitView: function (mode) {
      if (!this._session) return
      this._exhibitMode = mode
      runtime.playExhibitView(this._session, mode)
      this._applyDimGuides()
    },

    flipStand: function () {
      if (!this._session) return false
      var flipped = runtime.toggleManualStandFlip(this._session)
      var slug = this._resolved && this._resolved.slug
      setStandFlipPref(slug, flipped)
      this.setData({ standFlipped: flipped })
      this.triggerEvent('flipchange', { flipped: flipped })
      this._applyDimGuides()
      if (this._exhibitMode) runtime.playExhibitView(this._session, this._exhibitMode)
      return flipped
    },

    onFlipStand: function () {
      this.flipStand()
    },

    onExpand: function () {
      var q = []
      var name = this.properties.rocketName || ''
      var nameEn = this.properties.rocketNameEn || ''
      var poster = this.properties.poster || ''
      var modelUrl = this.properties.modelUrl || ''
      if (name) q.push('name=' + encodeURIComponent(name))
      if (nameEn) q.push('nameEn=' + encodeURIComponent(nameEn))
      if (poster) q.push('poster=' + encodeURIComponent(poster))
      if (modelUrl) q.push('modelUrl=' + encodeURIComponent(modelUrl))
      var configId = this.properties.configId || ''
      if (configId) q.push('configId=' + encodeURIComponent(configId))
      this._teardown()
      this.setData({ started: false, loading: false, live: false, usingPlaceholder: false })
      wx.navigateTo({
        url: '/subpackages/rocket-3d/viewer' + (q.length ? '?' + q.join('&') : '')
      })
    },

    onTouchStart: function (e) {
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchstart(e)
    },
    onTouchMove: function (e) {
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchmove(e)
    },
    onTouchEnd: function (e) {
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchend(e)
    },
    onTouchCancel: function (e) {
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchcancel(e)
    }
  }
})
