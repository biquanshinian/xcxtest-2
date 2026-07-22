/**
 * 独立全屏全球飞船图鉴页
 * 数据复用 utils/spacecraft-display.js（LL2 spacecraft_configurations 全量，本地缓存 24h）
 * 支持 现役/类型 筛选，分享可带 filter 参数直达（如 filter=type:Capsule）
 */
const pageBase = require('../../utils/page-base.js')
const spacecraftDisplay = require('./utils/spacecraft-display.js')
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
    agencyChips: [],
    filter: 'all',

    cards: [],
    stats: { inUseCount: 0, typeCount: 0, agencyCount: 0 },
    filterEmpty: false,
    imageLoadedMap: {}
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
      this._allCards = spacecraftDisplay.buildSpacecraftCards(list)
      var chips = spacecraftDisplay.buildSpacecraftFilterChips(this._allCards, { maxTypeChips: 10 })
      // 机构筛选 chip（数据驱动：LL2 新增机构自动出现）
      var agencyChips = spacecraftDisplay.buildSpacecraftAgencyChips(this._allCards)

      var filter = this._pendingFilter || 'all'
      var chipIds = chips.concat(agencyChips).map(function (c) { return c.id })
      if (chipIds.indexOf(filter) === -1) filter = 'all'

      this.setData({ loading: false, filterChips: chips, agencyChips: agencyChips })
      this.applyFilter(filter)
    } catch (err) {
      console.error('[SpacecraftGallery] load error:', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  applyFilter(filterId) {
    var all = this._allCards || []
    var filtered = spacecraftDisplay.applySpacecraftFilter(all, filterId)
    this.setData({
      filter: filterId,
      cards: filtered,
      stats: spacecraftDisplay.computeSpacecraftStats(filtered),
      filterEmpty: all.length > 0 && filtered.length === 0,
      imageLoadedMap: {}
    })
  },

  onFilterTap(e) {
    var id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.applyFilter(id)
  },

  /** 点击卡片上的机构标签 → 按该机构筛选（再点一次已选中机构则回到全部） */
  onAgencyTagTap(e) {
    var agency = e.currentTarget.dataset.agency
    if (!agency) return
    var id = 'agency:' + agency
    this.applyFilter(id === this.data.filter ? 'all' : id)
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

  onImageLoad(e) {
    var index = e.currentTarget.dataset.index
    if (index == null) return
    var kv = {}
    kv['imageLoadedMap.' + index] = true
    this.setData(kv)
  },

  /** 图片加载失败：沿兜底链切换（缩略图 404 时回退原图），链耗尽显示占位 */
  onImageError(e) {
    var idx = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(idx) || idx < 0) return
    var card = (this.data.cards || [])[idx]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    var kv = {}
    kv['cards[' + idx + '].imageUrl'] = spacecraftDisplay.cachedImage(fallbacks[0])
    kv['cards[' + idx + '].imageFallbacks'] = fallbacks.slice(1)
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
