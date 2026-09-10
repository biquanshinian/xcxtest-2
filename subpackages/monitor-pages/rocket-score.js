/**
 * 火箭档案指数页（分包）。数据来自 _config_meta，按同量级折算。
 */
const pageBase = require('../../utils/page-base.js')
const { getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { openRocketCompare, openEncyclopediaAgency } = require('./utils/booster-nav.js')
const {
  resolveScoreConfig,
  buildScoreView,
  applyScoreProgress
} = require('./utils/rocket-score.js')
const theme = require('../../utils/theme.js')
const {
  isLocalSharePath,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
} = require('./utils/rocket-model-share-image.js')

const GATE_PRODUCT_ID = 'rocket_compare'
const GATE_PRODUCT_NAME = '火箭型号对比'

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    navTitle: '档案指数',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    shareGateExpireAt: 0,
    shareTitle: '火箭档案指数 | 火星探索日志',
    shareImage: '',
    animOn: false,
    scoreShown: '—',
    heroReady: false,
    model: null,
    view: null
  },

  async onLoad(options) {
    this.initUiShell()
    this._entryOptions = options || {}
    this._configId = ''
    if (options && options.configId) {
      try { this._configId = decodeURIComponent(String(options.configId)) } catch (e) { this._configId = String(options.configId) }
    }
    this._configId = String(this._configId || '').trim()
    this._name = ''
    this._nameEn = ''
    try { this._name = decodeURIComponent((options && options.name) || '') } catch (e) { this._name = (options && options.name) || '' }
    try { this._nameEn = decodeURIComponent((options && options.nameEn) || '') } catch (e) { this._nameEn = (options && options.nameEn) || '' }
    if (this._name) {
      this.setData({ shareTitle: this._name + ' 档案指数 | 火星探索日志' })
    }

    var that = this
    this._themeHook = function () {
      if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') {
        wx.nextTick(function () { if (that._view) that._drawRadar(1) })
      } else if (that._view) that._drawRadar(1)
    }
    theme.onThemeChange(this._themeHook)

    var allowed = await this.ensureScoreAccess(options)
    if (allowed) this.loadScore()
  },

  async ensureScoreAccess(options) {
    var shareAllowed = await checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      this._scoreAllowed = false
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证或看广告后可继续查看' })
      return false
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)
    if (!this.data.shareGateExpireAt) {
      var allowed = await gateCheck(GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
      if (!allowed) {
        this._scoreAllowed = false
        this.setData({ loading: false, errorMessage: '开通星际通行证或看广告后可查看档案指数' })
        return false
      }
    }
    this._scoreAllowed = true
    return true
  },

  async loadScore() {
    if (!this._scoreAllowed) return
    this.setData({
      loading: true,
      errorMessage: '',
      animOn: false,
      scoreShown: '—',
      view: null,
      model: null
    })
    try {
      var meta = await getRocketConfigMeta({ afterGate: true })
      var configs = (meta && meta.configs) || {}
      var cfg = resolveScoreConfig(configs, {
        configId: this._configId,
        name: this._name,
        nameEn: this._nameEn
      })
      // 有构型 id 时只认这一条：目录没有就去 LL2 拉，禁止用「猎鹰 9」落到 Block 1
      if (!cfg && this._configId) cfg = await this.fetchConfigFromLl2(this._configId)
      if (!cfg) {
        this.setData({ loading: false, errorMessage: '未找到该型号档案，暂时算不了指数' })
        return
      }
      if (cfg.id != null) {
        configs[String(cfg.id)] = cfg
        this._configId = String(cfg.id)
      }
      if (!this._name) this._name = cfg.nameZh || cfg.name || ''
      if (!this._nameEn) this._nameEn = cfg.name || cfg.full_name || ''
      var rawView = buildScoreView(cfg, configs)
      this._view = rawView
      var view = applyScoreProgress(rawView, 0)
      var extra = {}
      extra[String(cfg.id)] = cfg
      var cards = boosterDisplay.buildModelCards(extra)
      var card = cards[0] || {}
      var model = {
        configId: cfg.id,
        name: card.name || cfg.nameZh || cfg.name || '',
        fullName: card.fullName || cfg.full_nameZh || cfg.full_name || cfg.name || '',
        fullNameEn: card.fullNameEn || cfg.full_name || cfg.name || '',
        nameEn: card.nameEn || cfg.name || '',
        manufacturer: card.manufacturer || cfg.manufacturerName || '',
        manufacturerDisplay: card.manufacturerDisplay || card.manufacturerZh || '',
        manufacturerAbbrev: card.manufacturerAbbrev || cfg.manufacturerAbbrev || '',
        manufacturerId: card.manufacturerId || cfg.manufacturerId || '',
        imageUrl: card.thumbnailUrl || card.imageUrl || '',
        imageFallbacks: (card.imageFallbacks || []).slice(),
        countryFlag: card.countryFlag || '',
        reusable: cfg.reusable === true
      }
      var title = model.name || this._name || '该型号'
      var scoreText = rawView.overallText && rawView.overallText !== '—' ? ' ' + rawView.overallText : ''
      this.setData({
        loading: false,
        errorMessage: '',
        model: model,
        view: view,
        shareTitle: title + ' 档案指数' + scoreText + ' | 火星探索日志',
        navTitle: '档案指数',
        heroReady: false,
        animOn: false,
        scoreShown: view.overallShown || '—'
      }, () => {
        this._syncShareImage(model)
        this._playEnterAnim()
      })
    } catch (err) {
      console.error('[RocketScore] load error:', err)
      this.setData({ loading: false, errorMessage: '指数计算失败，请稍后重试' })
    }
  },

  async fetchConfigFromLl2(configId) {
    try {
      var res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'll2RocketConfigDetail', configId: String(configId) }
      })
      var r = res && res.result
      return (r && r.success && r.data) ? r.data : null
    } catch (e) {
      return null
    }
  },

  _playEnterAnim() {
    var source = this._view || this.data.view
    if (!source) return
    if (this._animTimer) {
      clearInterval(this._animTimer)
      this._animTimer = null
    }
    var that = this
    var start = applyScoreProgress(source, 0)
    this.setData({ animOn: false, view: start, scoreShown: start.overallShown })
    var kick = function () {
      that.setData({ animOn: true })
      that._drawRadar(0)
      var steps = 22
      var i = 0
      that._animTimer = setInterval(function () {
        i += 1
        var t = easeOutCubic(i / steps)
        var next = applyScoreProgress(source, t)
        that.setData({ view: next, scoreShown: next.overallShown })
        that._drawRadar(t)
        if (i >= steps) {
          clearInterval(that._animTimer)
          that._animTimer = null
          var done = applyScoreProgress(source, 1)
          that.setData({ view: done, scoreShown: done.overallShown })
          that._drawRadar(1)
        }
      }, 32)
    }
    if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(kick)
    else setTimeout(kick, 40)
  },

  _drawRadar(progress) {
    var view = this._view || this.data.view
    if (!view || !view.radar) return
    var that = this
    var paint = function (canvas, width, height) {
      if (!canvas || !width) return
      var dpr = 2
      try {
        var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        dpr = (info && info.pixelRatio) || 2
      } catch (e) {}
      canvas.width = width * dpr
      canvas.height = height * dpr
      var ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      var light = !!(that.data.themeLight)
      var cx = width / 2
      var cy = height / 2
      var radius = Math.min(width, height) * 0.36
      ctx.clearRect(0, 0, width, height)
      var rings = [0.36, 0.68, 1]
      ctx.strokeStyle = light ? 'rgba(28,28,30,0.08)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      rings.forEach(function (ring) {
        ctx.beginPath()
        for (var i = 0; i < 6; i++) {
          var ang = (-90 + i * 60) * Math.PI / 180
          var x = cx + radius * ring * Math.cos(ang)
          var y = cy + radius * ring * Math.sin(ang)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.stroke()
      })
      ctx.beginPath()
      for (var s = 0; s < 6; s++) {
        var a = (-90 + s * 60) * Math.PI / 180
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a))
      }
      ctx.stroke()

      var dims = view.dims || []
      ctx.beginPath()
      dims.forEach(function (d, idx) {
        var ratio = d.missing ? 0.12 : (d.score / 5)
        ratio = Math.max(0.08, Math.min(1, ratio * progress))
        var ang2 = (-90 + idx * 60) * Math.PI / 180
        var px = cx + radius * ratio * Math.cos(ang2)
        var py = cy + radius * ratio * Math.sin(ang2)
        if (idx === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
      ctx.fillStyle = light ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.28)'
      ctx.fill()
      ctx.strokeStyle = '#3B82F6'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (this._radarCanvas && this._radarBox) {
      paint(this._radarCanvas, this._radarBox.width, this._radarBox.height)
      return
    }
    wx.createSelectorQuery().in(this).select('#scoreRadar').fields({ node: true, size: true }).exec(function (res) {
      var box = res && res[0]
      if (!box || !box.node) return
      that._radarCanvas = box.node
      that._radarBox = box
      paint(box.node, box.width, box.height)
    })
  },

  onHeroLoad() {
    this.setData({ heroReady: true })
  },

  async onTapArchive() {
    var id = this._configId || (this.data.model && this.data.model.configId)
    if (id == null || id === '') return
    var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: id })
  },

  async onTapManufacturer() {
    var model = this.data.model || {}
    if (!model.manufacturerId) {
      wx.showToast({ title: '暂无该发射商档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    return openEncyclopediaAgency({ agencyId: model.manufacturerId })
  },

  onTapCompare() {
    var id = this._configId || (this.data.model && this.data.model.configId)
    return openRocketCompare(id, { skipGate: true })
  },

  async onRetryLoad() {
    var allowed = await this.ensureScoreAccess(this._entryOptions || {})
    if (!allowed) return
    this.loadScore()
  },

  onUnload() {
    if (this._animTimer) {
      clearInterval(this._animTimer)
      this._animTimer = null
    }
    if (this._themeHook) {
      theme.offThemeChange(this._themeHook)
      this._themeHook = null
    }
  },

  _shareQuery() {
    var q = []
    if (this._configId) q.push('configId=' + encodeURIComponent(this._configId))
    if (this._name) q.push('name=' + encodeURIComponent(this._name))
    if (this._nameEn) q.push('nameEn=' + encodeURIComponent(this._nameEn))
    return q.join('&')
  },

  _shareImageOpts(model) {
    return rocketShareOptsFromModel(model || this.data.model)
  },

  _syncShareImage(model) {
    var opts = this._shareImageOpts(model)
    var url = pickRocketModelShareImageUrl(opts)
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    this.ensureShareImageHttpUrl(pickRocketModelShareSourceForDownload(opts))
  },

  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    var trimmed = imageUrl.trim()
    if (!trimmed) return
    if (isLocalSharePath(trimmed)) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage && isLocalSharePath(this.data.shareImage)) {
      return
    }
    this._shareImageSourceUrl = trimmed
    var self = this
    wx.getImageInfo({
      src: trimmed,
      success: function (res) {
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail: function () {
        if (self._shareImageSourceUrl === trimmed) self._shareImageSourceUrl = ''
      }
    })
  },

  _buildShareImage() {
    return this.data.shareImage || pickRocketModelShareImageUrl(this._shareImageOpts())
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle,
      path: withShareStampPath('/subpackages/monitor-pages/rocket-score' + (this._shareQuery() ? '?' + this._shareQuery() : ''), this),
      imageUrl: this._buildShareImage()
    }
  },

  onShareTimeline() {
    return {
      title: this.data.shareTitle,
      query: withShareStampQuery(this._shareQuery(), this),
      imageUrl: this._buildShareImage()
    }
  }
})
