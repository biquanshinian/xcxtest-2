/**
 * 独立全屏全球飞船图鉴页
 * 数据复用 utils/spacecraft-display.js（LL2 spacecraft_configurations 全量，本地缓存 24h）
 * 支持 现役/类型 筛选，分享可带 filter 参数直达（如 filter=type:Capsule）
 */
const pageBase = require('../../utils/page-base.js')
const spacecraftDisplay = require('./utils/spacecraft-display.js')
const boosterDisplay = require('./utils/booster-display.js')
const gallerySearch = require('./utils/gallery-search.js')
const { getFeaturedAgencies } = require('./utils/agency-data.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    loadError: false,
    navTitle: '全球飞船图鉴',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,

    filterChips: [],
    filter: 'all',
    keyword: '',

    cards: [],
    stats: { inUseCount: 0, typeCount: 0, agencyCount: 0 },
    filterEmpty: false
  },

  onLoad(options) {
    this.initUiShell()
    // 分享/入口可带 filter 参数：inuse / type:Capsule
    var filter = options && options.filter ? decodeURIComponent(options.filter) : 'all'
    this._pendingFilter = filter
    this.loadData()
  },

  async loadData(options) {
    // silent：下拉刷新时不显示整页骨架（避免 scroll-view 被 wx:if 卸载打断回弹）
    var silent = !!(options && options.silent)
    this.setData(silent ? { loadError: false } : { loading: true, loadError: false })
    try {
      var list = await spacecraftDisplay.loadSpacecraftList()
      var cards = spacecraftDisplay.buildSpacecraftCards(list)
      var agencies = await getFeaturedAgencies().catch(function () { return { list: [] } })
      this._allCards = boosterDisplay.attachManufacturerLogos(cards, agencies, 'agency')
      // 分类控制在一排：全部 + 现役 + 少量类型；机构走搜索 / 卡片标签
      var chips = spacecraftDisplay.buildSpacecraftFilterChips(this._allCards, { maxTypeChips: 5 })

      var filter = this._pendingFilter || 'all'
      if (!gallerySearch.isKnownSpacecraftFilter(filter)) filter = 'all'
      chips = gallerySearch.ensureActiveChip(chips, filter, spacecraftDisplay.extraChipForFilter(filter))
      this._filterChips = chips

      this.setData({ loading: false, filterChips: chips })
      this.applyFilter(filter)
    } catch (err) {
      console.error('[SpacecraftGallery] load error:', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  applyFilter(filterId) {
    var all = this._allCards || []
    var filtered = spacecraftDisplay.applySpacecraftFilter(all, filterId)
    filtered = gallerySearch.filterCardsByKeyword(filtered, this.data.keyword)

    var chips = gallerySearch.ensureActiveChip(
      this._filterChips || this.data.filterChips || [],
      filterId,
      spacecraftDisplay.extraChipForFilter(filterId)
    )

    this.setData({
      filter: filterId,
      cards: filtered,
      stats: spacecraftDisplay.computeSpacecraftStats(filtered),
      filterEmpty: all.length > 0 && filtered.length === 0,
      filterChips: chips
    })
  },

  onFilterTap(e) {
    var id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.applyFilter(id)
  },

  onSearchInput(e) {
    var value = (e.detail && e.detail.value) || ''
    this.setData({ keyword: value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    var self = this
    this._searchTimer = setTimeout(function () {
      self._searchTimer = null
      self.applyFilter(self.data.filter)
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
      self.applyFilter(self.data.filter)
    })
  },

  /** 点击卡片上的机构标签 → 写入搜索框筛选（再点同一机构则清空） */
  onAgencyTagTap(e) {
    var agency = e.currentTarget.dataset.agency
    if (!agency) return
    var label = String(agency || '').trim()
    var next = this.data.keyword === label ? '' : label
    var self = this
    this.setData({ keyword: next, filter: 'all' }, function () {
      self.applyFilter('all')
    })
  },

  /** 点击卡片 → 会员门控 → 飞船详情页（复用现有 spacecraft-detail） */
  async onCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    var id = ds.id
    if (id == null || id === '') return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证
    var allowed = await gateCheck('spacecraft_encyclopedia', '全球飞船图鉴')
    if (!allowed) return
    // 卡片当前已显示的图（可能是本地缓存路径）直传详情页，头图复用同一张不再加载
    if (ds.img) {
      var app = getApp && getApp()
      if (app) app._spacecraftHeroImage = { id: String(id), src: ds.img }
    }
    var params = { id: id }
    if (ds.name) params.name = ds.name
    navigateTo(ROUTES.SPACECRAFT_DETAIL, params)
  },

  onImageError(e) {
    var id = e.currentTarget.dataset.id
    var idx = gallerySearch.findCardIndexByKey(this.data.cards, 'id', id)
    if (idx < 0) return
    var card = this.data.cards[idx]
    if (!gallerySearch.advanceCardImage(card, spacecraftDisplay.cachedImage)) return
    var kv = {}
    kv['cards[' + idx + '].imageUrl'] = card.imageUrl
    kv['cards[' + idx + '].imageFallbacks'] = card.imageFallbacks
    this.setData(kv)
  },

  onRetryLoad() {
    this.loadData()
  },

  /** 原生三点下拉刷新：重读云缓存飞船数据，绝不直接触发 LL2 */
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
    var path = '/subpackages/monitor-pages/spacecraft-gallery'
    if (this.data.filter && this.data.filter !== 'all') {
      path += '?filter=' + encodeURIComponent(this.data.filter)
    }
    return path
  },

  onShareAppMessage() {
    return { title: '全球飞船图鉴 | 火星探索日志', path: this._sharePath() }
  },

  onShareTimeline() {
    var query = ''
    if (this.data.filter && this.data.filter !== 'all') {
      query = 'filter=' + encodeURIComponent(this.data.filter)
    }
    return { title: '全球飞船图鉴 | 火星探索日志', query: query }
  }
})
