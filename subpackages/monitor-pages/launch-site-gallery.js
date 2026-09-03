/**
 * 独立全屏全球发射场分布页
 * 数据复用 utils/launch-site-display.js（LL2 locations 全量，本地缓存 24h）
 * 支持 活跃/国家 筛选，分享可带 filter 参数直达（如 filter=country:China）
 */
const pageBase = require('../../utils/page-base.js')
const launchSiteDisplay = require('./utils/launch-site-display.js')
const gallerySearch = require('./utils/gallery-search.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    loadError: false,
    navTitle: '全球发射场分布',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,

    filterChips: [],
    filter: 'all',
    siteKeyword: '',

    cards: [],
    stats: { siteCount: 0, activeCount: 0, countryCount: 0, totalLaunches: 0 },
    filterEmpty: false
  },

  onLoad(options) {
    this.initUiShell()
    // 分享/入口可带 filter 参数：active / country:China
    var filter = options && options.filter ? decodeURIComponent(options.filter) : 'all'
    this._pendingFilter = filter
    this.loadData()
  },

  async loadData(options) {
    // silent：下拉刷新时不显示整页骨架（避免 scroll-view 被 wx:if 卸载打断回弹）
    var silent = !!(options && options.silent)
    this.setData(silent ? { loadError: false } : { loading: true, loadError: false })
    try {
      var list = await launchSiteDisplay.loadLaunchSiteList()
      this._allCards = launchSiteDisplay.buildLaunchSiteCards(list)
      // 分类控制在一排可横滑范围内：全部 + 活跃 + 少量国家
      var chips = launchSiteDisplay.buildLaunchSiteFilterChips(this._allCards, { maxCountryChips: 5 })

      var filter = this._pendingFilter || 'all'
      if (!gallerySearch.isKnownLaunchSiteFilter(filter)) filter = 'all'
      chips = gallerySearch.ensureActiveChip(chips, filter, launchSiteDisplay.extraChipForFilter(filter))
      this._filterChips = chips

      this.setData({ loading: false, filterChips: chips })
      this.applyFilter(filter)
    } catch (err) {
      console.error('[LaunchSiteGallery] load error:', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  applyFilter(filterId) {
    var all = this._allCards || []
    var filtered = launchSiteDisplay.applyLaunchSiteFilter(all, filterId)
    filtered = gallerySearch.filterCardsByKeyword(filtered, this.data.siteKeyword)

    var chips = gallerySearch.ensureActiveChip(
      this._filterChips || this.data.filterChips || [],
      filterId,
      launchSiteDisplay.extraChipForFilter(filterId)
    )

    this.setData({
      filter: filterId,
      cards: filtered,
      stats: launchSiteDisplay.computeLaunchSiteStats(filtered),
      filterEmpty: all.length > 0 && filtered.length === 0,
      filterChips: chips
    })
  },

  onFilterTap(e) {
    var id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.applyFilter(id)
  },

  onSiteSearchInput(e) {
    var value = (e.detail && e.detail.value) || ''
    this.setData({ siteKeyword: value })
    // 200ms 防抖：避免每个字符都触发全量过滤 setData
    if (this._siteSearchTimer) clearTimeout(this._siteSearchTimer)
    this._siteSearchTimer = setTimeout(() => {
      this._siteSearchTimer = null
      this.applyFilter(this.data.filter)
    }, 200)
  },

  onSiteSearchClear() {
    if (!this.data.siteKeyword) return
    if (this._siteSearchTimer) {
      clearTimeout(this._siteSearchTimer)
      this._siteSearchTimer = null
    }
    this.setData({ siteKeyword: '' }, () => {
      this.applyFilter(this.data.filter)
    })
  },

  onUnload() {
    if (this._siteSearchTimer) {
      clearTimeout(this._siteSearchTimer)
      this._siteSearchTimer = null
    }
  },

  /** 点击卡片上的国家标签 → 按该国家筛选（再点一次已选中国家则回到全部） */
  onCountryTagTap(e) {
    var country = e.currentTarget.dataset.country
    if (!country) return
    var id = 'country:' + country
    this.applyFilter(id === this.data.filter ? 'all' : id)
  },

  /** 点击卡片 → 全屏预览卫星图（LL2 无发射场详情页可跳，看大图最直观） */
  /** 点击卡片 → 会员门控（复用全球飞船图鉴逻辑）→ 发射场详情页 */
  async onCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    if (!ds.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证
    var allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
    if (!allowed) return
    navigateTo(ROUTES.LAUNCH_SITE_DETAIL, { id: ds.id })
  },

  onImageError(e) {
    var id = e.currentTarget.dataset.id
    var idx = gallerySearch.findCardIndexByKey(this.data.cards, 'id', id)
    if (idx < 0) return
    var card = this.data.cards[idx]
    if (!gallerySearch.advanceCardImage(card, launchSiteDisplay.cachedImage)) return
    var kv = {}
    kv['cards[' + idx + '].imageUrl'] = card.imageUrl
    kv['cards[' + idx + '].thumbnailUrl'] = card.thumbnailUrl
    kv['cards[' + idx + '].imageFallbacks'] = card.imageFallbacks
    this.setData(kv)
  },

  onRetryLoad() {
    this.loadData()
  },

  /** 原生三点下拉刷新：重读云缓存发射场数据，绝不直接触发 LL2 */
  onScrollRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }), 'scrollRefreshing')
  },

  onPullDownRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }))
  },

  _sharePath() {
    var path = '/subpackages/monitor-pages/launch-site-gallery'
    if (this.data.filter && this.data.filter !== 'all') {
      path += '?filter=' + encodeURIComponent(this.data.filter)
    }
    return path
  },

  onShareAppMessage() {
    return { title: '全球发射场分布 | 火星探索日志', path: this._sharePath() }
  },

  onShareTimeline() {
    var query = ''
    if (this.data.filter && this.data.filter !== 'all') {
      query = 'filter=' + encodeURIComponent(this.data.filter)
    }
    return { title: '全球发射场分布 | 火星探索日志', query: query }
  }
})
