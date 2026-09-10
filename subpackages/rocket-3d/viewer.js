var pageBase = require('../../utils/page-base.js')
var { loadCloudMediaMap } = require('../../utils/image-config.js')
var rocket3dReady = require('../../utils/rocket-3d-ready.js')
var { resolveRocketModel } = require('./models.js')
var { SERIES_SLUG } = require('../../utils/rocket-3d-slug.js')
var { buildRocket3dShareOptions } = require('./share.js')
var { ensureShareImageOnPage, pickShareDownloadSrc, SHARE_THUMB_FALLBACK } = require('../../utils/share-thumb.js')
var { matchRocketConfig, buildExhibit } = require('./exhibit.js')
var { buildModelCatalog, navFromDisplayedSlug, pickCatalogItem } = require('./catalog.js')
var { getRocketConfigMeta } = require('../../utils/api-app-services.js')
var { gateCheck, canUsePaidCloudSync } = require('../../utils/membership.js')
var { ROUTES, navigateTo } = require('../../utils/routes.js')
var { cleanConfigId } = require('../../utils/rocket-config-match.js')
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
    standFlipped: false,
    standYawFlipped: false,
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
    },
    catalog: [],
    currentSlug: '',
    pickerOpen: false,
    pickerTitle: '',
    pickerSub: '',
    ipIntroOpen: false
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
    var hintSlug = safeQuery(q.slug)
    var bootExhibit = buildExhibit(null, { rocketName: rocketName, rocketNameEn: rocketNameEn })
    this.setData(Object.assign({
      rocketName: rocketName,
      rocketNameEn: rocketNameEn,
      poster: poster,
      configId: configId,
      modelUrl: '',
      memberLocked: false,
      viewerLoading: true,
      loadPercent: 0,
      exhibit: bootExhibit,
      pickerOpen: false,
      catalog: [],
      currentSlug: hintSlug
    }, navFromDisplayedSlug(hintSlug)))
    ensureShareImageOnPage(this, pickShareDownloadSrc({ displayImage: poster, rawImage: poster }) || SHARE_THUMB_FALLBACK)
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
      poster: this.data.poster,
      slug: this.data.currentSlug || this._modelSlug || ''
    }
  },

  onNavBack: function () {
    if (this.data.pickerOpen) {
      this.setData({ pickerOpen: false })
      return
    }
    this.goBack()
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
    this._catalogAllowed = false
    var that = this
    this.setData({
      memberLocked: false,
      viewerLoading: true,
      viewerError: '',
      viewerErrorDetail: '',
      modelUrl: '',
      standFlipped: false,
      standYawFlipped: false
    })
    this._checkEntryAllowed()
      .then(function (allowed) {
        warmShareEntitlement(that, ROCKET_3D_GATE_ID)
        if (!allowed) {
          that._catalogAllowed = false
          that.setData({
            memberLocked: true,
            viewerLoading: false,
            viewerError: '',
            modelUrl: '',
            shareGateExpireAt: 0
          })
          return
        }
        that._catalogAllowed = true
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
    var gen = (this._bindGen = (this._bindGen || 0) + 1)
    var rocketName = this.data.rocketName
    var rocketNameEn = this.data.rocketNameEn
    var hintUrl = this._hintUrl
    return loadCloudMediaMap()
      .then(function () {
        if (gen !== that._bindGen) return
        var resolved = resolveRocketModel({
          rocketName: rocketName,
          rocketNameEn: rocketNameEn,
          modelUrl: hintUrl,
          slug: that._hintSlug
        })
        if (!resolved.url) {
          if (gen !== that._bindGen) return
          that.setData({
            memberLocked: false,
            viewerLoading: false,
            viewerError: '该型号暂无 3D 模型',
            modelUrl: '',
            credit: ''
          })
          that._refreshCatalog()
          return
        }
        var credit = rocket3dReady.getReadyCredit(resolved.slug)
        var series = !!(resolved.series || String(resolved.slug || '') === SERIES_SLUG)
        that._modelSlug = resolved.slug || ''
        var catalog = buildModelCatalog(rocket3dReady.getReadySlugs(), that._catalogConfigs || {})
        var exhibit = buildExhibit(null, {
          rocketName: rocketName,
          rocketNameEn: rocketNameEn,
          credit: credit,
          series: series
        })
        that.setData(Object.assign({
          memberLocked: false,
          viewerLoading: true,
          viewerError: '',
          standFlipped: false,
          standYawFlipped: false,
          modelUrl: resolved.url,
          credit: credit,
          catalog: catalog,
          exhibit: exhibit
        }, navFromDisplayedSlug(resolved.slug, catalog)))
        that._loadExhibitMeta(credit, series)
        that._refreshCatalog()
        if (!credit) that._loadCredit(resolved.slug)
      })
      .catch(function () {
        if (gen !== that._bindGen) return
        that.setData({
          memberLocked: false,
          viewerLoading: false,
          viewerError: '该型号暂无 3D 模型',
          modelUrl: '',
          credit: ''
        })
      })
  },

  _refreshCatalog: function () {
    if (!this._catalogAllowed) return Promise.resolve(this.data.catalog || [])
    var that = this
    return loadCloudMediaMap()
      .then(function () {
        return getRocketConfigMeta({ afterGate: true })
      })
      .then(function (meta) {
        that._catalogConfigs = (meta && meta.configs) || {}
        var catalog = buildModelCatalog(rocket3dReady.getReadySlugs(), that._catalogConfigs)
        var patch = Object.assign({
          catalog: catalog
        }, navFromDisplayedSlug(that._modelSlug, catalog))
        if (!cleanConfigId(that.data.configId)) {
          var picked = pickCatalogItem(
            catalog,
            that._modelSlug || that.data.currentSlug,
            that.data.rocketName,
            that.data.rocketNameEn
          )
          if (picked && !picked.series) {
            var fromCatalog = cleanConfigId(picked.configId)
            if (fromCatalog) patch.configId = fromCatalog
          }
        }
        that.setData(patch)
        return catalog
      })
      .catch(function () {
        return that.data.catalog || []
      })
  },

  onTogglePicker: function () {
    if (this.data.isMomentsPreview) return
    if (typeof this._dismissIpWindows === 'function') this._dismissIpWindows()
    if (this.data.pickerOpen) {
      this.setData({ pickerOpen: false })
      return
    }
    if (this.data.memberLocked || !this._catalogAllowed) return
    var that = this
    var open = function (catalog) {
      var list = catalog || that.data.catalog || []
      if (!list.length) {
        wx.showToast({ title: '暂无可切换型号', icon: 'none' })
        return
      }
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
      that.setData({ pickerOpen: true, catalog: list })
    }
    if ((this.data.catalog || []).length) {
      open(this.data.catalog)
      return
    }
    this._refreshCatalog().then(open)
  },

  onClosePicker: function () {
    if (this.data.pickerOpen) this.setData({ pickerOpen: false })
  },

  _resolveExhibitConfigId: function () {
    if (this.data.exhibit && this.data.exhibit.series) return ''
    var id = cleanConfigId(this.data.configId)
    if (id) return id
    var picked = pickCatalogItem(
      this.data.catalog || [],
      this._modelSlug || this.data.currentSlug,
      this.data.rocketName,
      this.data.rocketNameEn
    )
    if (picked && !picked.series) return cleanConfigId(picked.configId)
    return ''
  },

  onTapExhibitTitle: async function () {
    if (typeof this._dismissIpWindows === 'function') this._dismissIpWindows()
    if (this.data.exhibit && this.data.exhibit.series) {
      wx.showToast({ title: '全系列没有单独档案', icon: 'none' })
      return
    }
    var configId = this._resolveExhibitConfigId()
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    if (!configId) {
      wx.showToast({ title: '暂无型号档案', icon: 'none' })
      return
    }
    if (configId !== this.data.configId) this.setData({ configId: configId })
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  },

  onPickModel: function (e) {
    var slug = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.slug : ''
    var key = String(slug || '').toLowerCase()
    if (!key) return
    var items = this.data.catalog || []
    var item = null
    for (var i = 0; i < items.length; i++) {
      if (items[i].slug === key) {
        item = items[i]
        break
      }
    }
    if (!item) return
    if (item.slug === this._modelSlug && this.data.modelUrl) {
      this.setData({ pickerOpen: false })
      return
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    this._hintSlug = item.slug
    this._hintUrl = ''
    this._detailSpecs = item.configId ? { configId: item.configId, specs: [], detailConfig: null } : null
    this._modelSlug = item.slug
    var that = this
    this.setData({
      pickerOpen: false,
      rocketName: item.title,
      rocketNameEn: item.nameEn,
      configId: item.configId || '',
      poster: '',
      modelUrl: '',
      credit: '',
      viewerLoading: true,
      viewerReady: false,
      viewerError: '',
      viewerErrorDetail: '',
      introOpen: false,
      standFlipped: false,
      standYawFlipped: false,
      exhibitTab: 'show',
      currentSlug: item.slug,
      pickerTitle: item.title,
      pickerSub: item.subtitle,
      navTitle: item.title
    }, function () {
      that._resolveAndBindModel()
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
          if (that._modelSlug && key !== String(that._modelSlug || '').toLowerCase()) return
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
    if (!this._catalogAllowed) return
    var that = this
    var slugAtStart = this._modelSlug
    var seriesModel =
      series == null ? rocket3dReady.isSeriesModel(this._modelSlug) : !!series
    getRocketConfigMeta({ afterGate: true })
      .then(function (meta) {
        if (slugAtStart && that._modelSlug && slugAtStart !== that._modelSlug) return
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
        var exhibit = buildExhibit(cfg, {
          rocketName: that.data.rocketName,
          rocketNameEn: that.data.rocketNameEn,
          credit: credit || that.data.credit || '',
          series: seriesModel
        })
        var matchedId = seriesModel ? '' : cleanConfigId(cfg && (cfg.id != null ? cfg.id : cfg.configId))
        that.setData({
          exhibitTab: nextTab,
          exhibit: exhibit,
          configId: seriesModel ? '' : (matchedId || that.data.configId || '')
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

  _dismissIpWindows: function () {
    var c = this.selectComponent('#rocket3dViewer')
    if (c && typeof c.dismissIpWindows === 'function') c.dismissIpWindows()
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

  onIpIntro: function (e) {
    var open = !!(e && e.detail && e.detail.open)
    if (this.data.ipIntroOpen !== open) this.setData({ ipIntroOpen: open })
  },

  onFlipChange: function (e) {
    var d = (e && e.detail) || {}
    var up = !!d.flipped
    var left = !!d.flippedLeft
    var patch = {}
    if (this.data.standFlipped !== up) patch.standFlipped = up
    if (this.data.standYawFlipped !== left) patch.standYawFlipped = left
    if (Object.keys(patch).length) this.setData(patch)
  },

  onFlipStand: function () {
    var c = this.selectComponent('#rocket3dViewer')
    if (!c || typeof c.flipStand !== 'function') return
    c.flipStand()
  },

  onFlipYaw: function () {
    var c = this.selectComponent('#rocket3dViewer')
    if (!c || typeof c.flipYaw !== 'function') return
    c.flipYaw()
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
    this.setData({ viewerLoading: true, viewerError: '', viewerErrorDetail: '', standFlipped: false, standYawFlipped: false })
    var c = this.selectComponent('#rocket3dViewer')
    if (c && typeof c.startViewer === 'function') c.startViewer()
  }
})
