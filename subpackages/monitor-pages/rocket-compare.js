/**
 * 火箭型号对比页（分包，不进主包）
 * 交互对齐车型对比：选型列表 → 综合 PK / 参数表。
 */
const pageBase = require('../../utils/page-base.js')
const { getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const gallerySearch = require('./utils/gallery-search.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { openEncyclopediaAgency } = require('./utils/booster-nav.js')
const {
  isLocalSharePath,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
} = require('./utils/rocket-model-share-image.js')
const {
  MAX_COMPARE,
  parseCompareIds,
  resolveShareIds,
  buildShareQuery,
  buildPkView,
  buildSpecGroups,
  buildShareTitle,
  resolveConfig,
  idsMissingFromArchive,
  buildPickerView,
  isPickerEntry,
  shouldClosePickerOnBack,
  shouldReturnToPickerOnBack,
  GATE_PRODUCT_ID,
  GATE_PRODUCT_NAME
} = require('./utils/rocket-compare.js')

function enrichCfg(cfg) {
  if (!cfg) return cfg
  var next = {}
  for (var k in cfg) {
    if (Object.prototype.hasOwnProperty.call(cfg, k)) next[k] = cfg[k]
  }
  next.manufacturerDisplay = boosterDisplay.mfrDisplayName(
    cfg.manufacturerName || '',
    cfg.manufacturerAbbrev || '',
    cfg.manufacturerNameZh || ''
  )
  return next
}

function cardToModel(card, cfg) {
  return {
    configId: card.configId,
    name: card.name || card.fullName,
    fullName: card.fullName || card.name,
    alias: card.alias || '',
    imageUrl: card.thumbnailUrl || card.imageUrl || '',
    imageFallbacks: (card.imageFallbacks || []).slice(),
    countryFlag: card.countryFlag || '',
    reusable: card.reusable === true,
    manufacturerDisplay: card.manufacturerDisplay || card.manufacturer || '',
    cfg: enrichCfg(cfg)
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    navTitle: '火箭对比',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    pickerOpen: false,
    pickerMode: 'pick',
    replaceSlot: -1,
    keyword: '',
    onlyDiff: false,
    mainTab: 'overview',
    subTab: 'perf',
    selected: [],
    pickerGroups: [],
    pickerShown: 0,
    pickerTotal: 0,
    pickerTruncated: false,
    pk: { left: { empty: true, tone: 'orange' }, right: { empty: true, tone: 'blue' }, overview: [], sections: [] },
    specGroups: [],
    diffCount: 0,
    sameCount: 0,
    canStart: false,
    pickerBackHome: true,
    pickerFromResult: false,
    shareTitle: '火箭型号对比 | 火星探索日志',
    shareImage: '',
    shareGateExpireAt: 0,
    barAnimOn: false
  },

  async onLoad(options) {
    this.initUiShell()
    this._entryOptions = options || {}
    this._shareIds = parseCompareIds(options)
    this._pendingIds = this._shareIds.slice()
    this._catalogReady = false
    if (isPickerEntry(this._pendingIds)) {
      this.setData({
        pickerOpen: true,
        pickerMode: 'pick',
        pickerFromResult: false,
        loading: true
      })
    }
    var allowed = await this.ensureCompareAccess(options)
    if (allowed) this.loadCatalog()
  },

  async ensureCompareAccess(options) {
    var shareAllowed = await checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      this.setData({ loading: false, pickerOpen: false, errorMessage: '分享链接已过期，开通星际通行证或看广告后可继续查看' })
      return false
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)
    if (!this.data.shareGateExpireAt) {
      var allowed = await gateCheck(GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
      if (!allowed) {
        this.setData({ loading: false, pickerOpen: false, errorMessage: '开通星际通行证或看广告后可使用型号对比' })
        return false
      }
    }
    return true
  },

  async loadCatalog() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      var meta = await getRocketConfigMeta({ afterGate: true })
      var configs = (meta && meta.configs) || {}
      this._configs = configs
      this._allCards = boosterDisplay.buildModelCards(configs)
      var pending = (this._pendingIds && this._pendingIds.length)
        ? this._pendingIds.slice()
        : ((this.data.selected || []).length ? [] : (this._shareIds || []).slice())
      this._pendingIds = []
      if (pending.length) await this.applySelection(pending, { openPickerIfShort: true })
      else if ((this.data.selected || []).length) this.syncCompare(this.data.selected)
      else {
        this.setData(Object.assign({
          loading: false,
          pickerOpen: true,
          pickerMode: 'pick',
          pickerFromResult: false,
          pickerBackHome: !!this.data.isDirectEntry
        }, this.pickerViewPatch('', [])))
      }
      this._catalogReady = true
    } catch (err) {
      console.error('[RocketCompare] load error:', err)
      this._catalogReady = false
      this.setData({ loading: false, pickerOpen: false, errorMessage: '型号数据加载失败，请稍后重试' })
    }
  },

  pickerViewPatch(keyword, selectedModels) {
    var view = buildPickerView(this._allCards || [], keyword, selectedModels || this.data.selected || [])
    return {
      keyword: keyword == null ? '' : String(keyword),
      pickerGroups: view.groups,
      pickerShown: view.shown,
      pickerTotal: view.total,
      pickerTruncated: view.truncated
    }
  },

  /** 只补用户点进来的缺失 id，不拉全量 LL2 列表 */
  async fetchConfigFromLl2(configId) {
    try {
      var res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'll2RocketConfigDetail', configId: String(configId) }
      })
      var r = res && res.result
      return (r && r.success && r.data) ? r.data : null
    } catch (e) {
      console.warn('[RocketCompare] ll2 fallback failed:', e)
      return null
    }
  },

  async fillMissingConfigs(ids) {
    var missed = idsMissingFromArchive(ids, this._configs || {}).slice(0, MAX_COMPARE)
    if (!missed.length) return
    var that = this
    var fetched = await Promise.all(missed.map(function (id) { return that.fetchConfigFromLl2(id) }))
    var configs = that._configs || {}
    var added = 0
    fetched.forEach(function (cfg) {
      if (!cfg || cfg.id == null) return
      configs[String(cfg.id)] = cfg
      added += 1
    })
    if (!added) return
    this._configs = configs
    var extraMap = {}
    fetched.forEach(function (cfg) {
      if (cfg && cfg.id != null) extraMap[String(cfg.id)] = cfg
    })
    var extraCards = boosterDisplay.buildModelCards(extraMap)
    var have = {}
    ;(this._allCards || []).forEach(function (c) { have[String(c.configId)] = true })
    if (!that._allCards) that._allCards = []
    extraCards.forEach(function (c) {
      if (!have[String(c.configId)]) that._allCards.push(c)
    })
  },

  async applySelection(ids, options) {
    await this.fillMissingConfigs(ids)
    var configs = this._configs || {}
    var cards = this._allCards || []
    var selected = []
    var seen = {}
    var missed = 0
    ;(ids || []).forEach(function (id) {
      var key = String(id)
      if (!key || seen[key]) return
      var cfg = resolveConfig(configs, key)
      var card = cards.find(function (c) { return String(c.configId) === key })
      if (!cfg || !card) {
        missed += 1
        return
      }
      seen[key] = true
      selected.push(cardToModel(card, cfg))
    })
    selected = selected.slice(0, MAX_COMPARE)
    var openPicker = !!(options && options.openPickerIfShort && selected.length < 2)
    this.syncCompare(selected, {
      pickerOpen: openPicker,
      patch: { pickerFromResult: false }
    })
    if (missed && !(options && options.silentMiss)) {
      wx.showToast({ title: missed === (ids || []).length ? '未找到这些型号档案' : '部分型号尚未建档', icon: 'none' })
    }
  },

  decoratePickerGroups(keyword, selectedModels) {
    return this.pickerViewPatch(keyword, selectedModels).pickerGroups
  },

  _playBarAnim() {
    if ((this.data.selected || []).length < 2) return
    var that = this
    this.setData({ barAnimOn: false })
    var kick = function () { that.setData({ barAnimOn: true }) }
    if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(kick)
    else setTimeout(kick, 16)
  },

  syncCompare(selected, extra) {
    var pair = buildPkView(selected)
    var spec = buildSpecGroups(selected, { onlyDiff: this.data.onlyDiff })
    var keyword = extra && extra.keyword != null ? extra.keyword : this.data.keyword
    keyword = keyword == null ? '' : String(keyword)
    var that = this
    this.setData(Object.assign({
      loading: false,
      selected: selected,
      canStart: selected.length >= 2,
      pickerBackHome: !!(this.data.isDirectEntry && selected.length === 0),
      pk: pair,
      specGroups: spec.groups,
      diffCount: spec.diffCount,
      sameCount: spec.sameCount,
      shareTitle: buildShareTitle(selected),
      pickerOpen: extra && extra.pickerOpen != null ? extra.pickerOpen : this.data.pickerOpen,
      errorMessage: '',
      barAnimOn: false
    }, this.pickerViewPatch(keyword, selected), extra && extra.patch || {}), function () {
      that._syncShareImage(selected)
      if (selected.length >= 2) that._playBarAnim()
    })
  },

  applyPickerFilter(keyword, selectedModels) {
    this.setData(this.pickerViewPatch(keyword, selectedModels || this.data.selected || []))
  },

  onMainTab(e) {
    var tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.mainTab) return
    var that = this
    this.setData({ mainTab: tab }, function () {
      if (tab === 'overview') that._playBarAnim()
    })
  },

  onSubTab(e) {
    var tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.subTab) return
    var that = this
    this.setData({ subTab: tab }, function () {
      if (tab === 'perf' || tab === 'record') that._playBarAnim()
    })
  },

  onToggleOnlyDiff() {
    this.setData({ onlyDiff: !this.data.onlyDiff }, () => {
      this.syncCompare(this.data.selected || [])
    })
  },

  onOpenPicker() {
    this._replaceSlot = -1
    this.applyPickerFilter(this.data.keyword)
    this.setData({
      pickerOpen: true,
      pickerMode: 'pick',
      replaceSlot: -1,
      pickerFromResult: true,
      pickerBackHome: !!(this.data.isDirectEntry && !(this.data.selected || []).length)
    })
  },

  onChangeSlot(e) {
    var slot = Number(e.currentTarget.dataset.slot)
    this._replaceSlot = slot
    this.applyPickerFilter(this.data.keyword)
    this.setData({
      pickerOpen: true,
      pickerMode: 'replace',
      replaceSlot: slot,
      pickerFromResult: true,
      pickerBackHome: false
    })
  },

  onClosePicker() {
    this._replaceSlot = -1
    this.setData({ pickerOpen: false, pickerMode: 'pick', replaceSlot: -1 })
  },

  onNavBack() {
    if (this.data.pickerOpen) {
      this.onPickerBack()
      return
    }
    if (shouldReturnToPickerOnBack({ pickerOpen: false, selected: this.data.selected })) {
      this.applyPickerFilter(this.data.keyword)
      this.setData({
        pickerOpen: true,
        pickerMode: 'pick',
        replaceSlot: -1,
        pickerFromResult: false,
        pickerBackHome: !!this.data.isDirectEntry
      })
      return
    }
    this.goBack()
  },

  onPickerBack() {
    if (shouldClosePickerOnBack(this.data)) {
      this.onClosePicker()
      return
    }
    this.goBack()
  },

  onSlotImageError(e) {
    var pos = Number(e.currentTarget.dataset.slot)
    if (!isFinite(pos) || pos < 0) pos = 0
    var selected = (this.data.selected || []).slice()
    var model = selected[pos]
    if (!model) return
    var fallbacks = (model.imageFallbacks || []).slice()
    var next = fallbacks.shift() || ''
    if (next && next === model.imageUrl) next = fallbacks.shift() || ''
    model.imageUrl = next
    model.imageFallbacks = fallbacks
    this.syncCompare(selected)
  },

  onPhotoTap(e) {
    var url = e.currentTarget.dataset.url
    if (!url) return
    var pk = this.data.pk || {}
    var urls = []
    ;(pk.slots || [pk.left, pk.right]).forEach(function (slot) {
      if (slot && slot.imageUrl && urls.indexOf(slot.imageUrl) < 0) urls.push(slot.imageUrl)
    })
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  onStartCompare() {
    if ((this.data.selected || []).length < 2) {
      wx.showToast({ title: '请至少选择 2 款', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    this.setData({
      pickerOpen: false,
      pickerMode: 'pick',
      pickerFromResult: true,
      mainTab: 'overview',
      subTab: 'perf'
    })
  },

  onClearSelected() {
    if (!(this.data.selected || []).length) return
    this.syncCompare([], { pickerOpen: true, patch: { pickerMode: 'pick' } })
  },

  onSearchInput(e) {
    var value = (e.detail && e.detail.value) || ''
    this.setData({ keyword: value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    var self = this
    this._searchTimer = setTimeout(function () {
      self._searchTimer = null
      self.applyPickerFilter(value)
    }, 280)
  },

  onSearchClear() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    this.applyPickerFilter('')
  },

  onTogglePick(e) {
    var configId = e.currentTarget.dataset.configId
    if (configId == null) return
    var key = String(configId)
    if (this.data.pickerMode === 'replace') {
      this.replaceAtSlot(key, this.data.replaceSlot)
      return
    }
    var selected = (this.data.selected || []).slice()
    var idx = selected.findIndex(function (m) { return String(m.configId) === key })
    if (idx >= 0) {
      selected.splice(idx, 1)
      this.syncCompare(selected)
      return
    }
    if (selected.length >= MAX_COMPARE) {
      wx.showToast({ title: '最多对比 ' + MAX_COMPARE + ' 款', icon: 'none' })
      return
    }
    var model = this.modelFromId(key)
    if (!model) {
      wx.showToast({ title: '该型号暂无档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    selected.push(model)
    this.syncCompare(selected)
  },

  replaceAtSlot(key, slot) {
    var pos = Number(slot)
    if (!isFinite(pos) || pos < 0) pos = 0
    if (pos > MAX_COMPARE - 1) pos = MAX_COMPARE - 1
    var selected = (this.data.selected || []).slice()
    var exist = selected.findIndex(function (m) { return String(m.configId) === key })
    if (exist === pos) {
      this.onClosePicker()
      return
    }
    var model = this.modelFromId(key)
    if (!model) {
      wx.showToast({ title: '该型号暂无档案', icon: 'none' })
      return
    }
    if (exist >= 0) {
      var swap = selected[pos]
      selected[pos] = selected[exist]
      selected[exist] = swap
    } else if (selected[pos]) {
      selected[pos] = model
    } else {
      selected.push(model)
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    this.syncCompare(selected, { pickerOpen: false, patch: { pickerMode: 'pick', replaceSlot: -1 } })
  },

  modelFromId(key) {
    var cfg = resolveConfig(this._configs, key)
    var card = (this._allCards || []).find(function (c) { return String(c.configId) === key })
    if (!cfg || !card) return null
    return cardToModel(card, cfg)
  },

  async onTapPickerManufacturer(e) {
    var ds = (e.currentTarget && e.currentTarget.dataset) || {}
    var id = ds.id || ds.agencyId || ''
    if (!id) {
      wx.showToast({ title: '暂无该发射商档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    return openEncyclopediaAgency({ agencyId: id })
  },

  async onTapPkName(e) {
    var configId = e.currentTarget.dataset.configId
    if (configId == null || configId === '') return
    var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  },

  onImageError(e) {
    var id = e.currentTarget.dataset.id
    var groups = this.data.pickerGroups || []
    for (var g = 0; g < groups.length; g++) {
      var items = groups[g].items || []
      var idx = gallerySearch.findCardIndexByKey(items, 'configId', id)
      if (idx < 0) continue
      var card = items[idx]
      if (!gallerySearch.advanceCardImage(card)) return
      var kv = {}
      kv['pickerGroups[' + g + '].items[' + idx + '].thumbnailUrl'] = card.thumbnailUrl
      kv['pickerGroups[' + g + '].items[' + idx + '].imageUrl'] = card.imageUrl
      kv['pickerGroups[' + g + '].items[' + idx + '].imageFallbacks'] = card.imageFallbacks
      this.setData(kv)
      return
    }
  },

  async onRetryLoad() {
    var allowed = await this.ensureCompareAccess(this._entryOptions || {})
    if (!allowed) return
    this.loadCatalog()
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
  },

  _shareQuery() {
    return buildShareQuery(resolveShareIds(this.data.selected, this._shareIds, this._catalogReady))
  },

  _shareImageOpts(selected) {
    return rocketShareOptsFromModel((selected || this.data.selected || [])[0])
  },

  _syncShareImage(selected) {
    var opts = this._shareImageOpts(selected)
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
    var query = this._shareQuery()
    var path = '/subpackages/monitor-pages/rocket-compare' + (query ? '?' + query : '')
    return {
      title: this.data.shareTitle,
      path: withShareStampPath(path, this),
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
