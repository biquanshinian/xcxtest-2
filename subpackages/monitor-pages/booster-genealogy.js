/**
 * 独立全屏可回收火箭族谱页
 * 型号卡片区（_config_meta，含未首飞型号） + 箭实体网格（booster_genealogy）
 * 支持国家/厂商筛选、状态筛选、排序，分享可带 filter 参数直达（如 filter=country:CN）
 */
const pageBase = require('../../utils/page-base.js')
const { getBoosterGenealogy, getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const gallerySearch = require('./utils/gallery-search.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { openBoosterEntityDetail, openRocketCompare, openEncyclopediaAgency } = require('./utils/booster-nav.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const {
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
} = require('./utils/rocket-model-share-image.js')
const { ensureShareImageOnPage, pageShareImage } = require('../../utils/share-thumb.js')

const STATUS_FILTERS = [
  { id: 'all', label: '全部状态' },
  { id: 'active', label: '现役' },
  { id: 'retired', label: '退役' },
  { id: 'destroyed', label: '损毁' },
  { id: 'expended', label: '已消耗' }
]

const SORT_OPTIONS = [
  { id: 'flights', label: '飞行次数' },
  { id: 'recent', label: '最近飞行' }
]

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    loadError: false,
    errorMessage: '',
    shareGateExpireAt: 0,
    shareImage: '',
    navTitle: '全球可回收火箭族谱',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,

    filterChips: [],
    filter: 'all',
    keyword: '',
    statusFilters: STATUS_FILTERS,
    statusFilter: 'all',
    sortOptions: SORT_OPTIONS,
    sortBy: 'flights',

    modelCards: [],
    boosterCards: [],
    stats: { activeCount: 0, maxFlights: 0, totalFlights: 0, manufacturerCount: 0 },
    filterEmpty: false
  },

  onLoad(options) {
    this.initUiShell()
    // 分享/入口可带 filter 参数：country:CN（兼容简写 CN）/ mfr:SpaceX
    var filter = options && options.filter ? decodeURIComponent(options.filter) : 'all'
    if (/^[A-Za-z]{2}$/.test(filter)) filter = 'country:' + filter.toUpperCase()
    this._pendingFilter = filter
    this._entryOptions = options || {}
    this.ensureCatalogAccess(this._entryOptions).then((allowed) => {
      if (allowed) this.loadData()
    })
  },

  async ensureCatalogAccess(options) {
    var shareAllowed = await checkShareEntryGate(this, options, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) {
      this._catalogAllowed = false
      this.setData({
        loading: false,
        loadError: true,
        errorMessage: '分享链接已过期，开通星际通行证后可继续查看'
      })
      return false
    }
    warmShareEntitlement(this, 'booster_genealogy')
    if (!this.data.shareGateExpireAt) {
      var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
      if (!allowed) {
        this._catalogAllowed = false
        this.setData({
          loading: false,
          loadError: true,
          errorMessage: '开通星际通行证后可查看族谱'
        })
        return false
      }
    }
    this._catalogAllowed = true
    return true
  },

  async loadData(options) {
    if (!this._catalogAllowed) return
    // silent：下拉刷新时不显示整页骨架（避免 scroll-view 被 wx:if 卸载打断回弹）
    var silent = !!(options && options.silent)
    this.setData(silent ? { loadError: false } : { loading: true, loadError: false, errorMessage: '' })
    try {
      var results = await Promise.all([getBoosterGenealogy(), getRocketConfigMeta({ afterGate: true })])
      var list = results[0] || []
      var configMeta = results[1] || { configs: {} }

      // 传入构型映射：箭实体缺图时兜底用 LL2 构型图 → COS 火箭配置图库
      var processed = boosterDisplay.processBoosterList(list, configMeta.configs)
      this._allBoosters = processed.processed
      this._rawBySerial = processed.rawBySerial
      this._allModels = boosterDisplay.buildModelCards(configMeta.configs).filter(function (m) {
        return m.reusable === true
      })

      // chip 由箭实体 + 型号两侧数据合并；控制数量，单排横滑
      var chipSource = this._allBoosters.concat(this._allModels.map(function (m) {
        return {
          countryCode: m.countryCode,
          manufacturer: m.manufacturer,
          manufacturerDisplay: m.manufacturerDisplay,
          reusable: m.reusable
        }
      }))
      var chips = boosterDisplay.buildBoosterFilterChips(chipSource, { maxManufacturerChips: 5 })

      var filter = this._pendingFilter || 'all'
      if (!gallerySearch.isKnownGenealogyFilter(filter)) filter = 'all'
      chips = gallerySearch.ensureActiveChip(
        chips,
        filter,
        boosterDisplay.extraChipForFilter(filter, (this._allBoosters || []).concat(this._allModels || []))
      )
      this._filterChips = chips

      this.applyFilters({ filter: filter })
    } catch (err) {
      console.error('[Genealogy] load error:', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  /** 统一应用 国家厂商/可复用筛选 + 关键词 + 状态筛选 + 排序（可复用始终置顶） */
  applyFilters(patch) {
    var filter = gallerySearch.pickPatchValue(patch, 'filter', this.data.filter) || 'all'
    var statusFilter = gallerySearch.pickPatchValue(patch, 'statusFilter', this.data.statusFilter) || 'all'
    var sortBy = gallerySearch.pickPatchValue(patch, 'sortBy', this.data.sortBy) || 'flights'
    var keyword = gallerySearch.pickPatchValue(patch, 'keyword', this.data.keyword)

    var boosters = boosterDisplay.applyBoosterFilter(this._allBoosters || [], filter)
    if (statusFilter !== 'all') {
      boosters = boosters.filter(function (b) { return b.status === statusFilter })
    }
    boosters = gallerySearch.filterCardsByKeyword(boosters, keyword)
    boosters = gallerySearch.sortByFlightsOrRecent(boosters, sortBy, 'flights', 'lastFlight')

    var models = boosterDisplay.applyModelFilter(this._allModels || [], filter)
    // 现役/退役/损毁/已消耗只作用于箭实体；型号区同步隐藏，避免筛选看起来没生效
    if (statusFilter !== 'all') models = []
    else {
      models = gallerySearch.filterCardsByKeyword(models, keyword)
      models = gallerySearch.sortByFlightsOrRecent(models, sortBy, 'totalLaunchCount', 'maidenFlight')
    }

    var chips = gallerySearch.ensureActiveChip(
      this._filterChips || this.data.filterChips || [],
      filter,
      boosterDisplay.extraChipForFilter(filter, (this._allBoosters || []).concat(this._allModels || []))
    )

    this.setData({
      loading: false,
      filter: filter,
      statusFilter: statusFilter,
      sortBy: sortBy,
      keyword: keyword == null ? '' : String(keyword),
      modelCards: models,
      boosterCards: boosters,
      stats: boosterDisplay.computeBoosterStats(boosters),
      filterEmpty: boosters.length === 0 && models.length === 0,
      filterChips: chips
    })
    this._syncShareImage(models[0] || boosters[0])
  },

  _syncShareImage(card) {
    const opts = rocketShareOptsFromModel(card)
    const url = pickRocketModelShareImageUrl(opts)
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    ensureShareImageOnPage(this, pickRocketModelShareSourceForDownload(opts))
  },

  _buildShareImage() {
    const card = (this.data.modelCards && this.data.modelCards[0]) || (this.data.boosterCards && this.data.boosterCards[0])
    return pageShareImage(this) || pickRocketModelShareImageUrl(rocketShareOptsFromModel(card))
  },

  onFilterTap(e) {
    var id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.applyFilters({ filter: id })
  },

  onSearchInput(e) {
    var value = (e.detail && e.detail.value) || ''
    this.setData({ keyword: value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    var self = this
    this._searchTimer = setTimeout(function () {
      self._searchTimer = null
      self.applyFilters({ keyword: value })
    }, 200)
  },

  onSearchClear() {
    if (!this.data.keyword) return
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    var self = this
    this.setData({ keyword: '' }, function () {
      self.applyFilters({ keyword: '' })
    })
  },

  onStatusFilterTap(e) {
    var id = e.currentTarget.dataset.status
    if (!id || id === this.data.statusFilter) return
    this.applyFilters({ statusFilter: id })
  },

  onSortTap(e) {
    var id = e.currentTarget.dataset.sortBy
    if (!id || id === this.data.sortBy) return
    this.applyFilters({ sortBy: id })
  },

  onTapRocketCompare() {
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    return openRocketCompare()
  },

  async onModelCardTap(e) {
    var configId = e.currentTarget.dataset.configId
    if (configId == null) return
    // 会员门控（复用星舰硬件设施逻辑）：专属 id 不在 PRODUCTS 单品表内 → 弹窗只提供开通星际通行证
    var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  },

  async onTapModelManufacturer(e) {
    var ds = (e.currentTarget && e.currentTarget.dataset) || {}
    var id = ds.id || ds.agencyId || ''
    if (!id) {
      wx.showToast({ title: '暂无该发射商档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    return openEncyclopediaAgency({ agencyId: id })
  },

  async onBoosterCardTap(e) {
    var ds = (e.currentTarget && e.currentTarget.dataset) || {}
    var serial = ds.serial
    var launcherId = ds.launcherId
    var list = this.data.boosterCards || []
    var card = list.find(function (b) {
      return b && ((serial && String(b.serial) === String(serial)) ||
        (launcherId && String(b.launcherId || '') === String(launcherId)))
    })
    var raw = (serial && this._rawBySerial && this._rawBySerial[serial]) ||
      (card && card.serial && this._rawBySerial && this._rawBySerial[card.serial]) || null
    if (!serial && !launcherId && !(card && card.launcherId) && !(raw && raw.ll2Id)) return
    await openBoosterEntityDetail(serial, {
      raw: raw,
      ll2Id: launcherId || (card && card.launcherId) || (raw && raw.ll2Id) || '',
      heroImage: (card && (card.thumbnailUrl || card.imageUrl)) || ''
    })
  },

  onImageError(e) {
    var id = e.currentTarget.dataset.id
    var kind = e.currentTarget.dataset.kind
    var listKey = kind === 'model' ? 'modelCards' : 'boosterCards'
    var idField = kind === 'model' ? 'configId' : 'serial'
    var idx = gallerySearch.findCardIndexByKey(this.data[listKey], idField, id)
    if (idx < 0) return
    var card = this.data[listKey][idx]
    if (!gallerySearch.advanceCardImage(card)) return
    var kv = {}
    kv[listKey + '[' + idx + '].thumbnailUrl'] = card.thumbnailUrl
    kv[listKey + '[' + idx + '].imageUrl'] = card.imageUrl
    kv[listKey + '[' + idx + '].imageFallbacks'] = card.imageFallbacks
    this.setData(kv)
  },

  async onRetryLoad() {
    var allowed = await this.ensureCatalogAccess(this._entryOptions || {})
    if (!allowed) return
    this.loadData()
  },

  /** 原生三点下拉刷新：重读云缓存族谱数据，绝不直接触发 LL2 */
  onScrollRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }), 'scrollRefreshing')
  },

  onPullDownRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }))
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
  },

  _sharePath() {
    var path = '/subpackages/monitor-pages/booster-genealogy'
    if (this.data.filter && this.data.filter !== 'all') {
      path += '?filter=' + encodeURIComponent(this.data.filter)
    }
    return path
  },

  _shareTitle() {
    if (this.data.filter === 'country:CN') return '中国可回收火箭族谱 | 火星探索日志'
    if (this.data.filter === 'reusable') return '可复用火箭族谱 | 火星探索日志'
    if (this.data.filter === 'expendable') return '一次性火箭族谱 | 火星探索日志'
    if (this.data.filter && this.data.filter.indexOf('mfr:') === 0) {
      return this.data.filter.slice(4) + ' 可回收火箭族谱 | 火星探索日志'
    }
    return '全球可回收火箭族谱 | 火星探索日志'
  },

  onShareAppMessage() {
    return {
      title: this._shareTitle(),
      path: withShareStampPath(this._sharePath(), this),
      imageUrl: this._buildShareImage()
    }
  },

  onShareTimeline() {
    var query = ''
    if (this.data.filter && this.data.filter !== 'all') {
      query = 'filter=' + encodeURIComponent(this.data.filter)
    }
    return {
      title: this._shareTitle(),
      query: withShareStampQuery(query, this),
      imageUrl: this._buildShareImage()
    }
  }
})
