/**
 * 独立全屏全球发射场分布页
 * 数据复用 utils/launch-site-display.js（LL2 locations 全量，本地缓存 24h）
 * 支持 活跃/国家 筛选，分享可带 filter 参数直达（如 filter=country:China）
 */
const pageBase = require('../../utils/page-base.js')
const launchSiteDisplay = require('../../utils/launch-site-display.js')
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
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,

    filterChips: [],
    filter: 'all',
    siteKeyword: '',

    cards: [],
    stats: { siteCount: 0, activeCount: 0, countryCount: 0, totalLaunches: 0 },
    filterEmpty: false,
    imageLoadedMap: {}
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
      var chips = launchSiteDisplay.buildLaunchSiteFilterChips(this._allCards, { maxCountryChips: 12 })

      var filter = this._pendingFilter || 'all'
      var chipIds = chips.map(function (c) { return c.id })
      if (chipIds.indexOf(filter) === -1) filter = 'all'

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

    // 关键词过滤：在 chip 筛选结果之上再过滤（大小写不敏感、去空格，命中任一可搜索字段即保留）
    var keyword = String(this.data.siteKeyword || '').trim().toLowerCase().replace(/\s+/g, '')
    if (keyword) {
      filtered = filtered.filter(function (card) {
        var fields = [card.name, card.nameZh, card.fullName, card.countryName, card.countryLabel]
        return fields.some(function (f) {
          return String(f || '').toLowerCase().replace(/\s+/g, '').indexOf(keyword) >= 0
        })
      })
    }

    this.setData({
      filter: filterId,
      cards: filtered,
      stats: launchSiteDisplay.computeLaunchSiteStats(filtered),
      filterEmpty: all.length > 0 && filtered.length === 0,
      imageLoadedMap: {}
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

  onImageLoad(e) {
    var index = e.currentTarget.dataset.index
    if (index == null) return
    var kv = {}
    kv['imageLoadedMap.' + index] = true
    this.setData(kv)
  },

  /** 图片加载失败：沿兜底链切换（卫星图 404 时回退实景图），链耗尽显示占位 */
  onImageError(e) {
    var idx = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(idx) || idx < 0) return
    var card = (this.data.cards || [])[idx]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    var kv = {}
    kv['cards[' + idx + '].imageUrl'] = launchSiteDisplay.cachedImage(fallbacks[0])
    kv['cards[' + idx + '].imageFallbacks'] = fallbacks.slice(1)
    this.setData(kv)
  },

  onRetryLoad() {
    this.loadData()
  },

  /** 页面级原生下拉刷新（全局统一）：重读云缓存发射场数据，绝不直接触发 LL2 */
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
