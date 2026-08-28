var pageBase = require('../../utils/page-base.js')
var { loadCloudMediaMap } = require('../../utils/image-config.js')
var rocket3dReady = require('../../utils/rocket-3d-ready.js')
var { resolveRocketModel } = require('./models.js')
var { SERIES_SLUG } = require('../../utils/rocket-3d-slug.js')
var { buildRocket3dShareOptions } = require('./share.js')
var { matchRocketConfig, buildExhibit } = require('./exhibit.js')
var { getRocketConfigMeta } = require('../../utils/api-app-services.js')
var { gateCheck, canUsePaidCloudSync } = require('../../utils/membership.js')
var {
  SHARE_GATE_TTL_MS,
  parseShareStamp,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('./share-gate.js')

var ROCKET_3D_GATE_ID = 'rocket_3d'
var ROCKET_3D_GATE_NAME = '火箭 3D 模型'

function safeQuery(value) {
  var s = String(value || '')
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function takePendingRocket3dSpecs() {
  try {
    var app = getApp()
    var pending = app && app.globalData ? app.globalData.pendingRocket3dSpecs : null
    if (app && app.globalData) app.globalData.pendingRocket3dSpecs = null
    if (!pending || typeof pending !== 'object') return null
    return {
      configId: pending.configId || '',
      specs: Array.isArray(pending.specs) ? pending.specs : [],
      detailConfig: pending.detailConfig && typeof pending.detailConfig === 'object'
        ? pending.detailConfig
        : null
    }
  } catch (e) {
    return null
  }
}

function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  } catch (e) {}
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',
  _hintUrl: '',
  _hintSlug: '',
  _gateBusy: false,
  _entryQuery: null,
  _detailSpecs: null,

  data: {
    pageVisible: true,
    rocketName: '',
    rocketNameEn: '',
    poster: '',
    modelUrl: '',
    memberLocked: false,
    shareGateExpireAt: 0,
    credit: '',
    viewerLoading: true,
    viewerReady: false,
    viewerError: '',
    viewerErrorDetail: '',
    loadPercent: 0,
    loadChars: ['三', '维', '数', '据', '加', '载', '中'],
    lockChars: ['会', '员', '专', '属'],
    configId: '',
    exhibitTab: 'show',
    introOpen: false,
    exhibit: {
      title: '',
      subtitle: '三维展陈',
      credit: '',
      intro: '',
      sizeSummary: '',
      featureSummary: '',
      hasSize: false,
      hasIntro: false,
      hasFeat: false,
      series: false,
      length: '',
      diameter: ''
    }
  },

  onLoad: function (query) {
    this.initUiShell()
    enableShareMenu()
    var q = query || {}
    this._entryQuery = q
    var rocketName = safeQuery(q.name)
    var rocketNameEn = safeQuery(q.nameEn)
    var poster = safeQuery(q.poster)
    var configId = safeQuery(q.configId)
    this._hintUrl = safeQuery(q.modelUrl)
    this._hintSlug = safeQuery(q.slug)
    this._detailSpecs = takePendingRocket3dSpecs()
    this.setData({
      rocketName: rocketName,
      rocketNameEn: rocketNameEn,
      poster: poster,
      configId: configId,
      modelUrl: '',
      memberLocked: false,
      viewerLoading: true,
      loadPercent: 0,
      exhibit: buildExhibit(null, { rocketName: rocketName, rocketNameEn: rocketNameEn }),
      navTitle: rocketName || '3D 展陈'
    })
    this._ensureMemberAndLoad()
  },

  onShow: function () {
    this.syncTheme()
    this.setData({ pageVisible: true })
    enableShareMenu()
    if (this.data.memberLocked && canUsePaidCloudSync()) {
      this._ensureMemberAndLoad()
    }
  },

  onHide: function () {
    this.setData({ pageVisible: false })
  },

  _sharePayload: function () {
    return {
      rocketName: this.data.rocketName,
      rocketNameEn: this.data.rocketNameEn,
      poster: this.data.poster
    }
  },

  onShareAppMessage: function () {
    var result = buildRocket3dShareOptions(this._sharePayload(), 'app')
    result.path = withShareStampPath(result.path, this)
    return result
  },

  onShareTimeline: function () {
    var result = buildRocket3dShareOptions(this._sharePayload(), 'timeline')
    result.query = withShareStampQuery(result.query, this)
    return result
  },

  _checkEntryAllowed: function () {
    var sst = parseShareStamp(this._entryQuery)
    this._shareSst = sst
    this._shareGateProductId = ROCKET_3D_GATE_ID
    if (sst && Date.now() - sst <= SHARE_GATE_TTL_MS) {
      this.setData({ shareGateExpireAt: sst + SHARE_GATE_TTL_MS })
      return Promise.resolve(true)
    }
    return gateCheck(ROCKET_3D_GATE_ID, ROCKET_3D_GATE_NAME, { allowAd: false })
  },

  _ensureMemberAndLoad: function () {
    if (this._gateBusy) return
    this._gateBusy = true
    var that = this
    this.setData({
      memberLocked: false,
      viewerLoading: true,
      viewerError: '',
      viewerErrorDetail: '',
      modelUrl: ''
    })
    this._checkEntryAllowed()
      .then(function (allowed) {
        warmShareEntitlement(that, ROCKET_3D_GATE_ID)
        if (!allowed) {
          that.setData({
            memberLocked: true,
            viewerLoading: false,
            viewerError: '',
            modelUrl: '',
            shareGateExpireAt: 0
          })
          return
        }
        return that._resolveAndBindModel()
      })
      .catch(function () {
        that.setData({
          memberLocked: true,
          viewerLoading: false,
          viewerError: '',
          modelUrl: ''
        })
      })
      .then(function () {
        that._gateBusy = false
      })
  },

  _resolveAndBindModel: function () {
    var that = this
    var rocketName = this.data.rocketName
    var rocketNameEn = this.data.rocketNameEn
    var hintUrl = this._hintUrl
    return loadCloudMediaMap()
      .then(function () {
        var resolved = resolveRocketModel({
          rocketName: rocketName,
          rocketNameEn: rocketNameEn,
          modelUrl: hintUrl,
          slug: that._hintSlug
        })
        if (!resolved.url) {
          that.setData({
            memberLocked: false,
            viewerLoading: false,
            viewerError: '该型号暂无 3D 模型',
            modelUrl: '',
            credit: ''
          })
          return
        }
        var credit = rocket3dReady.getReadyCredit(resolved.slug)
        var series = !!(resolved.series || String(resolved.slug || '') === SERIES_SLUG)
        that._modelSlug = resolved.slug || ''
        that.setData({
          memberLocked: false,
          viewerLoading: true,
          viewerError: '',
          modelUrl: resolved.url,
          credit: credit,
          exhibit: buildExhibit(null, {
            rocketName: rocketName,
            rocketNameEn: rocketNameEn,
            credit: credit,
            series: series
          })
        })
        that._loadExhibitMeta(credit, series)
        if (!credit) that._loadCredit(resolved.slug)
      })
      .catch(function () {
        that.setData({
          memberLocked: false,
          viewerLoading: false,
          viewerError: '该型号暂无 3D 模型',
          modelUrl: '',
          credit: ''
        })
      })
  },

  _loadCredit: function (slug) {
    var that = this
    var key = String(slug || '').toLowerCase()
    if (!key || !wx.cloud || !wx.cloud.database) return
    try {
      wx.cloud.database().collection('media_assets')
        .where({ key: 'models/rockets/' + key + '.glb' })
        .field({ credit: true })
        .limit(1)
        .get()
        .then(function (res) {
          var row = ((res && res.data) || [])[0]
          var credit = String((row && row.credit) || '').trim()
          if (credit) {
            that.setData({
              credit: credit,
              'exhibit.credit': credit,
              'exhibit.subtitle': that.data.exhibit.subtitle || credit
            })
          }
        })
        .catch(function () {})
    } catch (e) {}
  },

  onViewerStatus: function (e) {
    var d = (e && e.detail) || {}
    var started = !!d.started
    var loading = !!d.loading
    var error = String(d.error || '')
    var progress = Number(d.progress)
    var that = this
    this.setData({
      viewerLoading: started && loading,
      viewerReady: started && !loading && !error,
      viewerError: error,
      viewerErrorDetail: String(d.detail || ''),
      loadPercent: isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : this.data.loadPercent
    }, function () {
      var c = that.selectComponent('#rocket3dViewer')
      if (c && typeof c.resizeViewport === 'function') {
        c.resizeViewport().catch(function () {})
      }
      if (started && !loading && !error && that.data.exhibitTab !== 'show') {
        that._playExhibitView(that.data.exhibitTab)
      }
    })
  },

  _loadExhibitMeta: function (credit, series) {
    var that = this
    var seriesModel =
      series == null ? rocket3dReady.isSeriesModel(this._modelSlug) : !!series
    getRocketConfigMeta()
      .then(function (meta) {
        var pending = that._detailSpecs || {}
        var cfg = matchRocketConfig((meta && meta.configs) || {}, {
          configId: pending.configId || that.data.configId,
          rocketName: that.data.rocketName,
          rocketNameEn: that.data.rocketNameEn,
          detailSpecs: pending.specs,
          detailConfig: pending.detailConfig
        })
        var nextTab = that.data.exhibitTab
        if (seriesModel && (nextTab === 'size' || nextTab === 'feat')) nextTab = 'show'
        that.setData({
          exhibitTab: nextTab,
          exhibit: buildExhibit(cfg, {
            rocketName: that.data.rocketName,
            rocketNameEn: that.data.rocketNameEn,
            credit: credit || that.data.credit || '',
            series: seriesModel
          })
        }, function () {
          if (that.data.exhibitTab === 'size' && that.data.exhibit.hasSize) {
            that._playExhibitView('size')
          }
        })
      })
      .catch(function () {})
  },

  _playExhibitView: function (tab) {
    var c = this.selectComponent('#rocket3dViewer')
    if (!c || typeof c.playExhibitView !== 'function') return
    c.playExhibitView(tab)
  },

  onExhibitTab: function (e) {
    var tab = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.tab : 'show'
    if (tab === 'size') {
      if (this.data.exhibit.series) {
        wx.showToast({ title: '全系列模型不标注尺寸', icon: 'none' })
        return
      }
      if (!this.data.exhibit.hasSize) {
        wx.showToast({ title: '暂无该型号规格', icon: 'none' })
        return
      }
    }
    if (tab === 'feat') {
      if (this.data.exhibit.series) {
        wx.showToast({ title: '全系列模型不提供特写', icon: 'none' })
        return
      }
      if (!this.data.exhibit.hasFeat) {
        wx.showToast({ title: '暂无特征数据', icon: 'none' })
        return
      }
    }
    this.setData({
      exhibitTab: tab,
      introOpen: tab === 'feat' && this.data.exhibit.hasIntro
    })
    this._playExhibitView(tab)
  },

  toggleIntro: function () {
    if (!this.data.exhibit.hasIntro) return
    this.setData({ introOpen: !this.data.introOpen, exhibitTab: 'show' })
    this._playExhibitView('show')
  },

  onRetryViewer: function () {
    if (this.data.memberLocked) {
      this._ensureMemberAndLoad()
      return
    }
    if (this.data.viewerReady) return
    if (!this.data.modelUrl) {
      this._ensureMemberAndLoad()
      return
    }
    this.setData({ viewerLoading: true, viewerError: '', viewerErrorDetail: '' })
    var c = this.selectComponent('#rocket3dViewer')
    if (c && typeof c.startViewer === 'function') c.startViewer()
  }
})
