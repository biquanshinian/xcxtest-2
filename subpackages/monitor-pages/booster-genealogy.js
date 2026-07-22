/**
 * 独立全屏可回收火箭族谱页
 * 型号卡片区（_config_meta，含未首飞型号） + 箭实体网格（booster_genealogy）
 * 支持国家/厂商筛选、状态筛选、排序，分享可带 filter 参数直达（如 filter=country:CN）
 */
const pageBase = require('../../utils/page-base.js')
const { getBoosterGenealogy, getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { openBoosterEntityDetail } = require('../../utils/booster-nav.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')

const STATUS_FILTERS = [
  { id: 'all', label: '全部状态' },
  { id: 'active', label: '现役' },
  { id: 'retired', label: '退役' },
  { id: 'destroyed', label: '损毁' }
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
    navTitle: '全球可回收火箭族谱',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,

    filterChips: [],
    filter: 'all',
    statusFilters: STATUS_FILTERS,
    statusFilter: 'all',
    sortOptions: SORT_OPTIONS,
    sortBy: 'flights',

    modelCards: [],
    boosterCards: [],
    stats: { activeCount: 0, maxFlights: 0, totalFlights: 0, manufacturerCount: 0 },
    filterEmpty: false,
    imageLoadedMap: {}
  },

  onLoad(options) {
    this.initUiShell()
    // 分享/入口可带 filter 参数：country:CN（兼容简写 CN）/ mfr:SpaceX
    var filter = options && options.filter ? decodeURIComponent(options.filter) : 'all'
    if (/^[A-Za-z]{2}$/.test(filter)) filter = 'country:' + filter.toUpperCase()
    this._pendingFilter = filter
    this.loadData()
  },

  async loadData(options) {
    // silent：下拉刷新时不显示整页骨架（避免 scroll-view 被 wx:if 卸载打断回弹）
    var silent = !!(options && options.silent)
    this.setData(silent ? { loadError: false } : { loading: true, loadError: false })
    try {
      var results = await Promise.all([getBoosterGenealogy(), getRocketConfigMeta()])
      var list = results[0] || []
      var configMeta = results[1] || { configs: {} }

      // 传入构型映射：箭实体缺图时兜底用 LL2 构型图 → COS 火箭配置图库
      var processed = boosterDisplay.processBoosterList(list, configMeta.configs)
      this._allBoosters = processed.processed
      this._rawBySerial = processed.rawBySerial
      this._allModels = boosterDisplay.buildModelCards(configMeta.configs)

      // chip 由箭实体 + 型号两侧数据合并生成（未首飞型号也能出现在筛选里）
      var chipSource = this._allBoosters.concat(this._allModels.map(function (m) {
        return { countryCode: m.countryCode, manufacturer: m.manufacturer }
      }))
      var chips = boosterDisplay.buildBoosterFilterChips(chipSource, { maxManufacturerChips: 10 })

      var filter = this._pendingFilter || 'all'
      var chipIds = chips.map(function (c) { return c.id })
      if (chipIds.indexOf(filter) === -1) filter = 'all'

      this.setData({ loading: false, filterChips: chips })
      this.applyFilters({ filter: filter })
    } catch (err) {
      console.error('[Genealogy] load error:', err)
      this.setData({ loading: false, loadError: true })
    }
  },

  /** 统一应用 国家厂商筛选 + 状态筛选 + 排序 */
  applyFilters(patch) {
    var filter = (patch && patch.filter) || this.data.filter
    var statusFilter = (patch && patch.statusFilter) || this.data.statusFilter
    var sortBy = (patch && patch.sortBy) || this.data.sortBy

    var boosters = boosterDisplay.applyBoosterFilter(this._allBoosters || [], filter)
    if (statusFilter !== 'all') {
      boosters = boosters.filter(function (b) { return b.status === statusFilter })
    }
    if (sortBy === 'recent') {
      boosters.sort(function (a, b) {
        return new Date(b.lastFlight || 0).getTime() - new Date(a.lastFlight || 0).getTime()
      })
    } else {
      boosters.sort(function (a, b) { return b.flights - a.flights })
    }

    var models = boosterDisplay.applyModelFilter(this._allModels || [], filter)

    this.setData({
      filter: filter,
      statusFilter: statusFilter,
      sortBy: sortBy,
      modelCards: models,
      boosterCards: boosters,
      stats: boosterDisplay.computeBoosterStats(boosters),
      filterEmpty: boosters.length === 0 && models.length === 0,
      imageLoadedMap: {}
    })
  },

  onFilterTap(e) {
    var id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.applyFilters({ filter: id })
  },

  onStatusFilterTap(e) {
    var id = e.currentTarget.dataset.status
    if (!id || id === this.data.statusFilter) return
    this.applyFilters({ statusFilter: id })
  },

  onSortTap(e) {
    var id = e.currentTarget.dataset.sort
    if (!id || id === this.data.sortBy) return
    this.applyFilters({ sortBy: id })
  },

  async onModelCardTap(e) {
    var configId = e.currentTarget.dataset.configId
    if (configId == null) return
    // 会员门控（复用星舰硬件设施逻辑）：专属 id 不在 PRODUCTS 单品表内 → 弹窗只提供开通星际通行证
    var allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  },

  async onBoosterCardTap(e) {
    var serial = e.currentTarget.dataset.serial
    if (!serial) return
    var raw = (this._rawBySerial && this._rawBySerial[serial]) || null
    var list = this.data.boosterCards || []
    var card = list.find(function (b) { return b && String(b.serial) === String(serial) })
    await openBoosterEntityDetail(serial, {
      raw: raw,
      heroImage: (card && (card.thumbnailUrl || card.imageUrl)) || ''
    })
  },

  onImageLoad(e) {
    var key = e.currentTarget.dataset.imgKey
    if (!key) return
    this.setData(this._buildKV('imageLoadedMap.' + key, true))
  },

  /** 图片加载失败：沿多级兜底链逐级切换；链耗尽则清空 URL 显示渐变占位 */
  onImageError(e) {
    var key = e.currentTarget.dataset.imgKey
    if (!key) return
    var isModel = key.charAt(0) === 'm'
    var idx = parseInt(key.slice(1), 10)
    var listKey = isModel ? 'modelCards' : 'boosterCards'
    var card = (this.data[listKey] || [])[idx]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    var kv = {}
    kv[listKey + '[' + idx + '].thumbnailUrl'] = fallbacks[0] || ''
    kv[listKey + '[' + idx + '].imageFallbacks'] = fallbacks.slice(1)
    this.setData(kv)
  },

  _buildKV(key, value) {
    var kv = {}
    kv[key] = value
    return kv
  },

  onRetryLoad() {
    this.loadData()
  },

  /** 原生三点下拉刷新：重读云缓存族谱数据，绝不直接触发 LL2 */
  onScrollRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }), 'scrollRefreshing')
  },

  onPullDownRefresh() {
    runPullRefresh(this, () => this.loadData({ silent: true }))
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
    if (this.data.filter && this.data.filter.indexOf('mfr:') === 0) {
      return this.data.filter.slice(4) + ' 可回收火箭族谱 | 火星探索日志'
    }
    return '全球可回收火箭族谱 | 火星探索日志'
  },

  onShareAppMessage() {
    return { title: this._shareTitle(), path: this._sharePath() }
  },

  onShareTimeline() {
    var query = ''
    if (this.data.filter && this.data.filter !== 'all') {
      query = 'filter=' + encodeURIComponent(this.data.filter)
    }
    return { title: this._shareTitle(), query: query }
  }
})
