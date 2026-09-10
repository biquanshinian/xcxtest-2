var { resolveRocketModel } = require('../../models.js')
var runtime = require('../../runtime.js')
var { getStandFlipState, setStandFlipState } = require('../../stand-flip-pref.js')
var theme = require('../../../../utils/theme.js')
var ipScaleRef = require('../../../../utils/ip-scale-ref.js')
var ipReferenceReady = require('../../../../utils/ip-reference-ready.js')
var ipIntro = require('../../ip-intro.js')
var ipChat3d = require('../../ip-chat-3d.js')
var xingwenExhibit = require('../../xingwen-exhibit-client.js')
var xingwenCards = require('../../xingwen-exhibit-cards.js')
var ipFx = require('../../ip-fx.js')

function emptyIpIntro() {
  return {
    open: false,
    slug: '',
    name: '',
    title: '',
    typed: '',
    done: false,
    typing: false,
    x: 16,
    y: 16,
    w: 220,
    h: 120,
    fs: 13,
    scale: 1,
    hint: false,
    below: false,
    visible: false
  }
}

function emptyXwChat() {
  return {
    open: false,
    armed: false,
    sending: false,
    draft: '',
    messages: [],
    scrollTarget: '',
    inputFocus: false,
    keyboardH: 0
  }
}

function emptyXwScreen() {
  return { visible: false, x: 0, y: 0, w: 0, h: 0, scale: 1, fs: 13 }
}

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
    dimDiameter: { type: String, value: '' },
    exhibitIntro: { type: String, value: '' }
  },

  data: {
    started: false,
    loading: false,
    usingPlaceholder: false,
    themeLight: false,
    live: false,
    standFlipped: false,
    standYawFlipped: false,
    dimLabels: [],
    ipTags: [],
    ipIntro: emptyIpIntro(),
    xwChat: emptyXwChat(),
    xwScreen: emptyXwScreen()
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
      var url = String(this.properties.modelUrl || '')
      if (this.properties.autoLoad && this._session && this._boundModelUrl && url && this._boundModelUrl !== url) {
        this._teardown()
        this.startViewer()
        return
      }
      if (this.properties.autoLoad) this._tryAutoLoad()
    },
    'dimLength, dimDiameter': function () {
      if (this._exhibitMode === 'size') this._applyDimGuides()
      this._syncIpScaleRefs()
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
      this.setData({ started: true, loading: true, live: false, standFlipped: false, standYawFlipped: false })
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
                    },
                    onIpTags: function (tags) {
                      that._setIpTags(tags)
                    },
                    onIpIntroAnchor: function (anchor) {
                      that._setIpIntroAnchor(anchor)
                    },
                    onXwScreen: function (layout) {
                      that._setXwScreen(layout)
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
      session.series = !!resolved.series
      return runtime
        .loadGlb(lib, resolved.url, that._nativeCanvas, function (pct) {
          if (bootGen !== that._bootGen) return
          that._emitStatus('', '', pct)
        }, { series: !!resolved.series })
        .then(function (scene) {
          if (bootGen !== that._bootGen || that._session !== session) return
          that.closeIpIntro(true)
          that._resetXingwenChat(true)
          runtime.setModel(session, scene)
          that._boundModelUrl = resolved.url || ''
          var slug = resolved.slug
          var pref = getStandFlipState(slug)
          if (pref.up) runtime.applyManualStandFlip(session, true)
          if (pref.left) runtime.applyManualStandYaw(session, true)
          that.setData({ usingPlaceholder: false })
          that._emitFlipState()
          that._emitStatus('', '', 100)
          that._syncIpScaleRefs()
        })
    },

    _syncIpScaleRefs: function () {
      var session = this._session
      var resolved = this._resolved || this._syncMeta()
      if (!session || !resolved) return
      var input = {
        series: !!resolved.series || !!session.series,
        slug: resolved.slug,
        name: this.properties.rocketName,
        rocketName: this.properties.rocketName,
        rocketNameEn: this.properties.rocketNameEn
      }
      if (!ipScaleRef.shouldShowIpScaleRef(input)) {
        if (this.data.ipIntro && this.data.ipIntro.open) this.closeIpIntro()
        this._resetXingwenChat(true)
        runtime.clearIpScaleRefs(session)
        if (this._exhibitMode === 'size') this._applyDimGuides()
        return
      }
      var lengthM = ipScaleRef.parseLengthMeters(this.properties.dimLength)
      if (!(lengthM > 0)) return
      var figures = ipScaleRef.sortIpFiguresForStand(ipReferenceReady.listEnabled())
      if (ipReferenceReady.listMissing().length) this._ensureIpRefCatalog()
      if (session.ipRefLoaded && session.ipRefLoaded.length && ipReferenceReady.sameSlugSet(session.ipRefLoaded, figures)) {
        if (this.data.ipIntro && this.data.ipIntro.open && this.data.ipIntro.slug !== 'astro') this.closeIpIntro()
        runtime.placeIpScaleRefs(session, lengthM)
        this._relayoutXingwenPanel()
        if (this._exhibitMode === 'size') this._applyDimGuides()
        return
      }
      if (!figures.length) {
        this._ensureIpRefCatalog()
        return
      }
      var that = this
      var bootGen = this._bootGen || 0
      runtime
        .attachIpScaleRefs(session, {
          figures: figures,
          rocketLengthM: lengthM,
          series: input.series,
          slug: input.slug,
          name: input.name,
          rocketName: input.rocketName,
          rocketNameEn: input.rocketNameEn,
          lib: loadThreeLib(),
          nativeCanvas: that._nativeCanvas
        })
        .catch(function () {})
        .then(function () {
          if (bootGen !== that._bootGen) return
          that._relayoutXingwenPanel()
          if (that._exhibitMode === 'size') that._applyDimGuides()
        })
    },

    _ensureIpRefCatalog: function () {
      if (this._ipRefCatalogWait || this._ipRefCatalogDone) return
      this._ipRefCatalogWait = true
      var that = this
      var imageConfig
      try {
        imageConfig = require('../../../../utils/image-config.js')
      } catch (e) {
        this._ipRefCatalogWait = false
        return
      }
      Promise.resolve(imageConfig.loadCloudMediaMap ? imageConfig.loadCloudMediaMap(true) : null)
        .then(function () {
          if (!ipReferenceReady.listMissing().length) return null
          return imageConfig.revalidateCloudMediaMap ? imageConfig.revalidateCloudMediaMap() : null
        })
        .then(function () {
          that._ipRefCatalogWait = false
          that._ipRefCatalogDone = true
          if (ipReferenceReady.listEnabled().length) that._syncIpScaleRefs()
        })
        .catch(function () {
          that._ipRefCatalogWait = false
          that._ipRefCatalogDone = true
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
      this._ipRefCatalogWait = false
      this._ipRefCatalogDone = false
      try {
        runtime.stopLoop(this._session)
      } catch (e) {}
      try {
        runtime.disposeSession(this._session)
      } catch (e) {}
      this._session = null
      this._boundModelUrl = ''
      this._exhibitMode = ''
      if (typeof this._clearIpType === 'function') this._clearIpType()
      this._xwArmed = false
      this._xwMessages = []
      this._xwKeyboardH = 0
      this._xwLastLayout = null
      this._xwSendGen = (this._xwSendGen || 0) + 1
      try {
        ipFx.dispose()
      } catch (eFx) {}
      try {
        this._setDimLabels([])
        if (typeof this._setIpTags === 'function') this._setIpTags([])
        this.setData({ ipIntro: emptyIpIntro(), xwChat: emptyXwChat(), xwScreen: emptyXwScreen() })
        this.triggerEvent('ipintro', { open: false })
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
      var on = this._exhibitMode === 'size' && !this.data.ipIntro.open
      runtime.setDimensionGuides(this._session, on, {
        length: this.properties.dimLength,
        diameter: this.properties.dimDiameter
      })
      if (!on) this._setDimLabels([])
    },

    _setIpTags: function (tags) {
      var next = (Array.isArray(tags) ? tags : []).filter(function (item) {
        return item && item.visible && item.text
      })
      var prev = this.data.ipTags || []
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
      this.setData({ ipTags: next })
    },

    _setIpIntroAnchor: function (anchor) {
      if (!this.data.ipIntro.open || !anchor) return
      if (anchor.slug && this.data.ipIntro.slug && anchor.slug !== this.data.ipIntro.slug) return
      if (!anchor.visible) {
        if (this.data.ipIntro.visible) this.setData({ 'ipIntro.visible': false })
        return
      }
      if (
        this.data.ipIntro.visible &&
        Math.abs(anchor.x - this.data.ipIntro.x) < 2 &&
        Math.abs(anchor.y - this.data.ipIntro.y) < 2 &&
        Math.abs((anchor.w || 0) - (this.data.ipIntro.w || 0)) < 2 &&
        Math.abs((anchor.h || 0) - (this.data.ipIntro.h || 0)) < 2
      ) {
        return
      }
      this.setData({
        'ipIntro.x': anchor.x,
        'ipIntro.y': anchor.y,
        'ipIntro.w': anchor.w,
        'ipIntro.h': anchor.h,
        'ipIntro.fs': anchor.fs || 13,
        'ipIntro.scale': anchor.scale || 1,
        'ipIntro.visible': true
      })
    },

    _xwPanelOpen: function () {
      return !!(
        this._xwArmed ||
        (this.data.xwChat && this.data.xwChat.open) ||
        (this.data.ipIntro && this.data.ipIntro.open && ipChat3d.canChatSlug(this.data.ipIntro.slug))
      )
    },

    _setXwScreen: function (layout) {
      if (!layout || !this._xwPanelOpen()) {
        if (this.data.xwScreen && this.data.xwScreen.visible) {
          this.setData({ 'xwScreen.visible': false, 'xwChat.inputFocus': false })
        }
        return
      }
      this._xwLastLayout = layout
      var y = layout.y
      var kb = this._xwKeyboardH || 0
      if (kb > 0 && layout.visible) {
        var cssH = (this._session && this._session.cssH) || 700
        var bottom = y + layout.h
        var limit = cssH - kb - 8
        if (bottom > limit) y = Math.max(8, y - (bottom - limit))
      }
      var next = {
        visible: !!layout.visible,
        x: layout.x,
        y: y,
        w: layout.w,
        h: layout.h,
        scale: layout.scale || 1,
        fs: layout.fs || 13
      }
      var prev = this.data.xwScreen || emptyXwScreen()
      if (
        !!prev.visible === !!next.visible &&
        Math.abs(prev.x - next.x) < 2 &&
        Math.abs(prev.y - next.y) < 2 &&
        Math.abs(prev.w - next.w) < 2 &&
        Math.abs(prev.h - next.h) < 2 &&
        prev.fs === next.fs
      ) {
        return
      }
      this.setData({ xwScreen: next })
    },

    _clearIpType: function () {
      if (this._ipTypeTimer) {
        clearTimeout(this._ipTypeTimer)
        this._ipTypeTimer = 0
      }
      if (this._xwFocusTimer) {
        clearTimeout(this._xwFocusTimer)
        this._xwFocusTimer = 0
      }
    },

    _resetXingwenChat: function (dropPanel) {
      this._xwArmed = false
      this._xwMessages = []
      this._xwKeyboardH = 0
      this._xwImeBlurAt = 0
      this._xwLastLayout = null
      this._xwSendGen = (this._xwSendGen || 0) + 1
      if (dropPanel && this._session) runtime.clearIpChatPanel(this._session)
      if (
        (this.data.xwChat && (this.data.xwChat.open || this.data.xwChat.armed || this.data.xwChat.draft || (this.data.xwChat.messages && this.data.xwChat.messages.length))) ||
        (this.data.xwScreen && this.data.xwScreen.visible)
      ) {
        this.setData({ xwChat: emptyXwChat(), xwScreen: emptyXwScreen() })
      }
    },

    _relayoutXingwenPanel: function () {
      if (!this._session || !this._session.xwPanel) return
      runtime.layoutIpChatPanel(this._session)
      this._syncXwView(false)
    },

    _xwPanelFooter: function () {
      if (this.data.xwChat && this.data.xwChat.sending) return ''
      if (this._xwArmed || (this.data.xwChat && this.data.xwChat.armed)) return ipChat3d.CHAT_FOOTER
      return ''
    },

    _viewXwMessages: function (streaming) {
      return ipChat3d.viewChatMessages(this._xwMessages || [], streaming)
    },

    _xwScrollId: function (preferCards) {
      var n = (this._xwMessages && this._xwMessages.length) || 0
      if (!n) return ''
      var last = this._xwMessages[n - 1]
      if (preferCards && last && last.cards && last.cards.length) return 'xw-' + (n - 1) + '-cards'
      return 'xw-' + (n - 1)
    },

    _syncXwView: function (streaming, preferCards) {
      var msgs = this._viewXwMessages(streaming)
      var patch = {
        'xwChat.messages': msgs,
        'xwChat.scrollTarget': this._xwScrollId(preferCards)
      }
      if (!this.data.xwChat || !this.data.xwChat.open) patch['xwChat.open'] = true
      this.setData(patch)
    },

    _paintXingwenPanel: function (footer, streaming) {
      this._syncXwView(streaming)
    },

    _exhibitChatContext: function () {
      return {
        rocketName: this.properties.rocketName,
        rocketNameEn: this.properties.rocketNameEn,
        title: this.properties.rocketName,
        length: this.properties.dimLength,
        diameter: this.properties.dimDiameter,
        intro: this.properties.exhibitIntro,
        configId: this.properties.configId
      }
    },

    _startIpTypewriter: function (lines, slug) {
      this._clearIpType()
      var full = ipIntro.joinIntroLines({ lines: lines })
      this._ipTypeFull = full
      this._ipTypeIndex = 0
      var astro = ipChat3d.canChatSlug(slug)
      this.setData({ 'ipIntro.typed': '', 'ipIntro.done': false, 'ipIntro.typing': true, 'ipIntro.hint': false })
      var that = this
      var tick = function () {
        if (!that.data.ipIntro.open) return
        if (that._ipTypeIndex >= that._ipTypeFull.length) {
          if (astro) {
            that._armXingwenChat()
            return
          }
          that.setData({ 'ipIntro.done': true, 'ipIntro.typing': false, 'ipIntro.hint': true })
          return
        }
        var ch = that._ipTypeFull.charAt(that._ipTypeIndex)
        that._ipTypeIndex += 1
        var typed = that._ipTypeFull.slice(0, that._ipTypeIndex)
        if (astro) {
          that._xwMessages = ipChat3d.seedIntroMessages(typed)
          var now = Date.now()
          if (!that._lastXwSync || now - that._lastXwSync > 64) {
            that._lastXwSync = now
            that._syncXwView(true)
          }
        } else {
          that.setData({ 'ipIntro.typed': typed })
        }
        that._ipTypeTimer = setTimeout(tick, ipIntro.nextTypeDelay(ch))
      }
      this._ipTypeTimer = setTimeout(tick, 420)
    },

    _armXingwenChat: function () {
      this._clearIpType()
      this._xwArmed = true
      var session = this._session
      if (session) {
        session.ipIntroSlug = ''
        runtime.clearMuskIntroPanel(session)
        runtime.unlockIpIntroControls(session, this._exhibitMode || 'show')
      }
      this._xwMessages = ipChat3d.seedIntroMessages(this._ipTypeFull)
      this.setData({
        ipIntro: emptyIpIntro(),
        xwChat: {
          open: true,
          armed: true,
          sending: false,
          draft: (this.data.xwChat && this.data.xwChat.draft) || '',
          messages: this._viewXwMessages(false),
          scrollTarget: this._xwScrollId(),
          inputFocus: false,
          keyboardH: (this.data.xwChat && this.data.xwChat.keyboardH) || 0
        }
      })
      this.triggerEvent('ipintro', { open: false })
    },

    _focusXingwenChat: function () {
      if (!this._session) return false
      runtime.playIpIntroView(this._session, 'astro')
      var patch = {
        'xwChat.open': true,
        ipTags: []
      }
      if (this.data.ipIntro && this.data.ipIntro.open && this.data.ipIntro.slug === 'musk') {
        patch.ipIntro = emptyIpIntro()
      }
      this.setData(patch)
      var that = this
      if (this._xwFocusTimer) clearTimeout(this._xwFocusTimer)
      this._xwFocusTimer = setTimeout(function () {
        if (!that._session || !that.data.xwChat || !that.data.xwChat.armed) return
        that._session.ipIntroSlug = ''
        runtime.unlockIpIntroControls(that._session, that._exhibitMode || 'show')
      }, 780)
      return true
    },

    openIpIntro: function (slug) {
      var intro = ipIntro.getIpIntro(slug)
      if (!intro || !this._session) return false
      if (ipChat3d.canChatSlug(intro.slug) && (this._xwArmed || (this.data.xwChat && this.data.xwChat.armed))) {
        return this._focusXingwenChat()
      }
      if (this.data.ipIntro.open && this.data.ipIntro.slug === intro.slug) {
        if (!this.data.ipIntro.done) this.onIpIntroBubble()
        else if (ipChat3d.canChatSlug(intro.slug)) this._armXingwenChat()
        else this.closeIpIntro()
        return true
      }
      if (!runtime.playIpIntroView(this._session, intro.slug)) return false
      runtime.setDimensionGuides(this._session, false)
      if (!ipChat3d.canChatSlug(intro.slug)) {
        this._resetXingwenChat(true)
      } else if (!(this.data.xwChat && this.data.xwChat.armed)) {
        runtime.clearIpChatPanel(this._session)
      }
      if (ipChat3d.canChatSlug(intro.slug)) {
        runtime.clearMuskIntroPanel(this._session)
        runtime.attachIpChatPanel(this._session)
        this._xwMessages = []
      } else {
        runtime.clearMuskIntroPanel(this._session)
      }
      var introData = {
        open: true,
        slug: intro.slug,
        name: intro.name,
        title: intro.title,
        typed: '',
        done: false,
        typing: true,
        x: this.data.ipIntro.x || 16,
        y: this.data.ipIntro.y || 80,
        hint: false,
        below: false,
        visible: false,
        w: this.data.ipIntro.w || 220,
        h: this.data.ipIntro.h || 120,
        fs: this.data.ipIntro.fs || 13,
        scale: this.data.ipIntro.scale || 1
      }
      var patch = { ipTags: [], ipIntro: introData }
      if (ipChat3d.canChatSlug(intro.slug)) {
        patch.xwChat = {
          open: true,
          armed: false,
          sending: false,
          draft: (this.data.xwChat && this.data.xwChat.draft) || '',
          messages: [],
          scrollTarget: '',
          inputFocus: false,
          keyboardH: 0
        }
      }
      this.setData(patch)
      this._startIpTypewriter(intro.lines, intro.slug)
      ipFx.playOpen()
      this.triggerEvent('ipintro', { open: true, slug: intro.slug, name: intro.name })
      return true
    },

    _dismissAllIpUi: function (keepCamera) {
      this.closeIpIntro(keepCamera)
      this._resetXingwenChat(true)
    },

    dismissIpWindows: function () {
      this._dismissAllIpUi(true)
    },

    closeIpIntro: function (keepCamera) {
      this._clearIpType()
      var session = this._session
      var was = !!(this.data.ipIntro && this.data.ipIntro.open)
      var armed = !!(this._xwArmed || (this.data.xwChat && this.data.xwChat.armed))
      if (session) {
        session.ipIntroSlug = ''
        if (keepCamera) runtime.unlockIpIntroControls(session, this._exhibitMode || 'show')
        else runtime.clearIpIntroView(session, this._exhibitMode || 'show')
        if (!keepCamera) this._applyDimGuides()
        if (!armed) runtime.clearIpChatPanel(session)
        runtime.clearMuskIntroPanel(session)
      }
      if (was) {
        this.setData({ ipIntro: emptyIpIntro() })
        this.triggerEvent('ipintro', { open: false })
      }
    },

    onIpIntroBubble: function () {
      if (!this.data.ipIntro.open) return
      if (!this.data.ipIntro.done && this._ipTypeFull) {
        this._clearIpType()
        if (ipChat3d.canChatSlug(this.data.ipIntro.slug)) {
          this._xwMessages = ipChat3d.seedIntroMessages(this._ipTypeFull)
          this._armXingwenChat()
          return
        }
        this.setData({
          'ipIntro.typed': this._ipTypeFull,
          'ipIntro.done': true,
          'ipIntro.typing': false,
          'ipIntro.hint': true
        })
        return
      }
    },

    onXingwenInput: function (e) {
      var value = e && e.detail ? e.detail.value : ''
      this.setData({ 'xwChat.draft': value })
    },

    onXingwenFocus: function () {
      this._xwImeBlurAt = 0
      this.setData({ 'xwChat.inputFocus': true })
    },

    onXingwenBlur: function () {
      this._xwImeBlurAt = Date.now()
      this.setData({ 'xwChat.inputFocus': false })
    },

    onXingwenKeyboard: function (e) {
      var h = e && e.detail && isFinite(Number(e.detail.height)) ? Number(e.detail.height) : 0
      this._xwKeyboardH = Math.max(0, h)
      this.setData({ 'xwChat.keyboardH': this._xwKeyboardH })
      if (this._xwLastLayout) this._setXwScreen(this._xwLastLayout)
    },

    onXwScreenTouch: function () {},

    _toggleXingwenIme: function () {
      if (!(this._xwArmed || (this.data.xwChat && this.data.xwChat.armed)) || (this.data.xwChat && this.data.xwChat.sending)) {
        return
      }
      if (this._xwImeBlurAt && Date.now() - this._xwImeBlurAt < 400) {
        this._xwImeBlurAt = 0
        return
      }
      if (!(this.data.xwChat && this.data.xwChat.inputFocus)) {
        this.setData({ 'xwChat.inputFocus': true })
      }
    },

    onXingwenComposerTap: function () {
      this._toggleXingwenIme()
    },

    _closeXingwenIme: function () {
      if (this.data.xwChat && this.data.xwChat.inputFocus) {
        this.setData({ 'xwChat.inputFocus': false })
      }
    },

    onXwScreenTap: function () {
      if (this.data.ipIntro.open && ipChat3d.canChatSlug(this.data.ipIntro.slug)) {
        this.onIpIntroBubble()
      }
      this._toggleXingwenIme()
    },

    onXingwenSend: function () {
      if (!this._session || !(this._xwArmed || (this.data.xwChat && this.data.xwChat.armed)) || (this.data.xwChat && this.data.xwChat.sending)) return
      var text = String(this.data.xwChat.draft || '').trim()
      if (!text) {
        this.setData({ 'xwChat.inputFocus': true })
        return
      }
      var history = (this._xwMessages || []).slice()
      this._xwMessages = history.concat([{ role: 'user', content: text }, { role: 'assistant', content: '' }])
      this.setData({ 'xwChat.draft': '', 'xwChat.sending': true })
      this._syncXwView(true)
      var gen = (this._xwSendGen || 0) + 1
      this._xwSendGen = gen
      var that = this
      var lastPaint = 0
      var haptic = { at: 0 }
      var lastLen = 0
      var pendingCards = []
      var applyLast = function (patch, streaming, preferCards) {
        var list = that._xwMessages || []
        if (!list.length) return
        var last = list[list.length - 1] || {}
        list[list.length - 1] = {
          role: 'assistant',
          content: patch.content != null ? patch.content : last.content || '',
          error: !!patch.error,
          cards: patch.cards != null ? patch.cards : last.cards || pendingCards
        }
        that._syncXwView(!!streaming, !!preferCards)
      }
      xingwenExhibit
        .sendExhibitChat({
          text: text,
          messages: history,
          context: this._exhibitChatContext(),
          onCards: function (cards) {
            if (that._xwSendGen !== gen) return
            pendingCards = Array.isArray(cards) ? cards : []
            applyLast({ cards: pendingCards }, true, true)
          },
          onPartial: function (partial) {
            if (that._xwSendGen !== gen) return
            var next = String(partial || '')
            var list = that._xwMessages || []
            if (!list.length) return
            var last = list[list.length - 1] || {}
            list[list.length - 1] = {
              role: 'assistant',
              content: next,
              cards: last.cards || pendingCards
            }
            if (next.length > lastLen) {
              lastLen = next.length
              xingwenExhibit.tickStreamHaptic(haptic)
            }
            var now = Date.now()
            if (now - lastPaint < 80) return
            lastPaint = now
            that._syncXwView(true, !!pendingCards.length)
          }
        })
        .then(function (res) {
          if (that._xwSendGen !== gen) return
          if (res && res.ok) {
            var cards = Array.isArray(res.cards) ? res.cards : pendingCards
            applyLast({ content: String(res.text || ''), cards: cards }, false, !!cards.length)
            if (cards.length) xingwenExhibit.pulseCardHaptic()
          } else {
            var msg = (res && res.error) || (res && res.reason === 'quota' ? '今天次数用完了' : res && res.reason === 'disabled' ? '星问暂未开放' : '星问这会儿有点忙，稍后再问')
            applyLast({ content: msg, error: true, cards: [] }, false, false)
          }
          that.setData({ 'xwChat.sending': false })
        })
        .catch(function () {
          if (that._xwSendGen !== gen) return
          var list = that._xwMessages || []
          if (list.length) list[list.length - 1] = { role: 'assistant', content: '星问这会儿有点忙，稍后再问', error: true, cards: [] }
          that.setData({ 'xwChat.sending': false, 'xwChat.inputFocus': false })
          that._syncXwView(false)
        })
    },

    onXingwenCardTap: function (e) {
      var ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      var mi = Number(ds.mi)
      var ci = Number(ds.ci)
      var msgs = (this.data.xwChat && this.data.xwChat.messages) || []
      var msg = msgs[mi]
      var card = msg && msg.cards && msg.cards[ci]
      if (!card) return
      var extra = {}
      if (ds.more === 1 || ds.more === '1') extra.more = true
      if (ds.ri != null && ds.ri !== '') {
        var ri = Number(ds.ri)
        extra.row = card.items && card.items[ri]
      }
      xingwenCards.openExhibitCard(card, extra)
    },

    playExhibitView: function (mode) {
      if (!this._session) return
      this._dismissAllIpUi(true)
      this._exhibitMode = mode
      runtime.playExhibitView(this._session, mode)
      this._applyDimGuides()
    },

    _emitFlipState: function () {
      var flags = runtime.getStandFlipFlags(this._session)
      this.setData({ standFlipped: flags.up, standYawFlipped: flags.left })
      this.triggerEvent('flipchange', { flipped: flags.up, flippedLeft: flags.left })
      return flags
    },

    flipStand: function () {
      if (!this._session) return false
      this._dismissAllIpUi(true)
      var flipped = runtime.toggleManualStandFlip(this._session)
      var slug = this._resolved && this._resolved.slug
      var flags = this._emitFlipState()
      setStandFlipState(slug, flags)
      this._applyDimGuides()
      if (this._exhibitMode) runtime.playExhibitView(this._session, this._exhibitMode)
      return flipped
    },

    flipYaw: function () {
      if (!this._session) return false
      this._dismissAllIpUi(true)
      var flipped = runtime.toggleManualStandYaw(this._session)
      var slug = this._resolved && this._resolved.slug
      var flags = this._emitFlipState()
      setStandFlipState(slug, flags)
      this._applyDimGuides()
      if (this._exhibitMode) runtime.playExhibitView(this._session, this._exhibitMode)
      return flipped
    },

    onFlipStand: function () {
      this.flipStand()
    },

    onFlipYaw: function () {
      this.flipYaw()
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
      var p = ipIntro.touchCssPoint(e)
      this._tap = p ? { x: p.x, y: p.y, t: Date.now(), moved: false } : null
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchstart(e)
    },
    onTouchMove: function (e) {
      var p = ipIntro.touchCssPoint(e)
      if (this._tap && p) {
        var dx = p.x - this._tap.x
        var dy = p.y - this._tap.y
        if (dx * dx + dy * dy > 64) this._tap.moved = true
      }
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchmove(e)
    },
    onTouchEnd: function (e) {
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchend(e)
      var tap = this._tap
      this._tap = null
      if (!tap || tap.moved || Date.now() - tap.t > 520) return
      if (!this.data.live || this.data.loading) return
      var p = ipIntro.touchCssPoint(e) || tap
      this._onCanvasTap(p.x, p.y)
    },
    onTouchCancel: function (e) {
      this._tap = null
      var h = this._adapter && this._adapter.touchEventHandlers
      if (h) h.touchcancel(e)
    },
    _onCanvasTap: function (x, y) {
      if (runtime.pickIpChatPanelAt(this._session, x, y)) {
        if (this._xwArmed || (this.data.xwChat && this.data.xwChat.armed)) {
          this._focusXingwenChat()
          this._toggleXingwenIme()
          return
        }
        if (this.data.ipIntro.open && ipChat3d.canChatSlug(this.data.ipIntro.slug)) {
          this.onIpIntroBubble()
        }
        return
      }
      this._closeXingwenIme()
      var slug = runtime.pickIpRefAt(this._session, x, y)
      if (slug) {
        this.openIpIntro(slug)
        return
      }
      if (this.data.ipIntro.open || this._xwArmed || (this.data.xwChat && this.data.xwChat.open)) {
        this._dismissAllIpUi(false)
      }
    }
  }
})
