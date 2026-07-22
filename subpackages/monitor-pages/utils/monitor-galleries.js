/**
 * subpackages/monitor-pages/utils/monitor-galleries.js
 * 监控页四个图鉴板块逻辑（从 pages/monitor/monitor.js 拆出）：
 * - 可回收火箭族谱（booster）
 * - 全球飞船图鉴（spacecraft）
 * - 全球发射场分布（launch site）
 * - 全球发射商图鉴（agency 预览卡）
 *
 * 展示层依赖（booster-display / spacecraft-display / launch-site-display / agency-data）
 * 已随本模块迁入 monitor-pages 分包，主包不再承担其体积。
 * 主包 monitor.js 通过 require.async + attachTo 委托加载；监控页在 preloadRule
 * 中预下载 monitor-pages 分包，冷启动首次进 Tab 时至多几百毫秒等待，
 * 各板块自带 loading 骨架，感知一致。
 */
const { getRocketConfigMeta } = require('../../../utils/api-app-services.js')
const { getBoosterGenealogy } = require('../../../utils/api-monitor-data.js')
const boosterDisplay = require('./booster-display.js')
const spacecraftDisplay = require('./spacecraft-display.js')
const launchSiteDisplay = require('./launch-site-display.js')
const { getFeaturedAgencies, filterAgencies, toDisplayRow } = require('./agency-data.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const { gateCheck, canUsePaidCloudSync } = require('../../../utils/membership.js')
const { openBoosterEntityDetail } = require('../../../utils/booster-nav.js')
const { getSystemInfo } = require('../../../utils/system.js')

const methods = {
  // ========== 可回收火箭族谱 ==========
  async loadBoosterGenealogy() {
    this.setData({ boosterLoading: true, boosterLoadError: false })
    try {
      // 非会员 Tab：只预览 2 条 + 最多 1 批库读，全量留给门控后的族谱页
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = boosterDisplay.TAB_PREVIEW_COUNT || 2
      var results = await Promise.all([
        getBoosterGenealogy(previewOnly
          ? { previewOnly: true, previewLimit: previewLimit }
          : undefined),
        getRocketConfigMeta().catch(function () { return { configs: {} } })
      ])
      var list = results[0]
      var configMeta = results[1] || { configs: {} }
      if (!list || list.length === 0) {
        this.setData({ boosterLoading: false })
        return
      }
      var result = boosterDisplay.processBoosterList(list, configMeta.configs, {
        imageCacheLimit: previewLimit
      })
      // 原始数据只给详情页跳转用，存实例变量，不进 setData（体积大、渲染层用不到）
      this._boosterRawBySerial = result.rawBySerial
      this._boosterAllProcessed = result.processed
      this._boosterPreviewOnly = previewOnly
      this.setData({
        boosterFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : boosterDisplay.buildBoosterFilterChips(result.processed),
        boosterLoading: false
      })
      this.applyBoosterFilter(this.data.boosterFilter || 'all')
    } catch (err) {
      console.error('[Monitor] booster load error:', err)
      // 区分「加载失败」与「暂无数据」，失败态给重试入口
      this.setData({ boosterLoading: false, boosterLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applyBoosterFilter(filterId) {
    var all = this._boosterAllProcessed || []
    var filtered = boosterDisplay.applyBoosterFilter(all, filterId)
    var previewLimit = boosterDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._boosterPreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      boosterFilter: filterId,
      boosterList: list,
      boosterStats: boosterDisplay.computeBoosterStats(filtered),
      boosterFilterEmpty: all.length > 0 && filtered.length === 0,
      boosterImageLoadedMap: {}
    })
  },

  onBoosterFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.boosterFilter) return
    this.applyBoosterFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏族谱页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllBoosters() {
    const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.boosterFilter || 'all'
    navigateTo(ROUTES.BOOSTER_GENEALOGY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetryBoosterLoad() {
    this.loadBoosterGenealogy()
  },

  /** 中度震动反馈 */
  _vibrateMedium() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {
      try { wx.vibrateShort() } catch (_) {}
    }
  },

  /** 助推器横向滚动震动 */
  onBoosterScroll(e) {
    var scrollLeft = e.detail.scrollLeft || 0
    var cardPitch = this._rpxToPx(296)
    var newIndex = Math.round(scrollLeft / cardPitch)
    if (newIndex < 0) newIndex = 0
    if (newIndex === this._boosterHapticIndex) return
    this._boosterHapticIndex = newIndex
    var now = Date.now()
    if (this._lastBoosterVibrateAt && now - this._lastBoosterVibrateAt < 200) return
    this._lastBoosterVibrateAt = now
    this._vibrateMedium()
  },

  /** rpx 转 px（缓存 windowWidth 避免重复调用 getSystemInfoSync） */
  _rpxToPx(rpx) {
    if (!this._cachedWindowWidth) {
      var info = getSystemInfo()
      this._cachedWindowWidth = (info && info.windowWidth) || 375
    }
    return rpx / 750 * this._cachedWindowWidth
  },

  /** 助推器卡片图片加载完成 */
  onBoosterImageLoad(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var key = 'boosterImageLoadedMap.' + index
    this.setData({ [key]: true })
  },

  /** 助推器卡片图片加载失败：沿多级兜底链逐级切换，链耗尽则清空显示占位符 */
  onBoosterImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.boosterList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['boosterList[' + index + '].thumbnailUrl']: fallbacks[0] || '',
      ['boosterList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击助推器卡片 → 与族谱详情统一入口（门控 + 预塞档案 + 卡面图） */
  async onBoosterCardTap(e) {
    var serial = e.currentTarget.dataset.serial
    if (!serial) return
    var raw = (this._boosterRawBySerial && this._boosterRawBySerial[serial]) || null
    var card = (this.data.boosterList || []).find(function (b) {
      return b && String(b.serial) === String(serial)
    })
    await openBoosterEntityDetail(serial, {
      raw: raw,
      heroImage: (card && (card.thumbnailUrl || card.imageUrl)) || ''
    })
  },

  // ========== 全球飞船图鉴（骨架镜像可回收火箭族谱） ==========
  async loadSpacecraftGallery() {
    this.setData({ spacecraftLoading: true, spacecraftLoadError: false })
    try {
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = spacecraftDisplay.TAB_PREVIEW_COUNT || 2
      var list = await spacecraftDisplay.loadSpacecraftList()
      if (!list || list.length === 0) {
        this.setData({ spacecraftLoading: false })
        return
      }
      // 非会员：只对预览条做图缓存预热，避免进 Tab 全量 COS 下行
      var cards = spacecraftDisplay.buildSpacecraftCards(list, {
        imageCacheLimit: previewLimit
      })
      this._spacecraftAllCards = cards
      this._spacecraftPreviewOnly = previewOnly
      this.setData({
        spacecraftFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : spacecraftDisplay.buildSpacecraftFilterChips(cards),
        spacecraftLoading: false
      })
      this.applySpacecraftFilter(this.data.spacecraftFilter || 'all')
    } catch (err) {
      console.error('[Monitor] spacecraft load error:', err)
      this.setData({ spacecraftLoading: false, spacecraftLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applySpacecraftFilter(filterId) {
    var all = this._spacecraftAllCards || []
    var filtered = spacecraftDisplay.applySpacecraftFilter(all, filterId)
    var previewLimit = spacecraftDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._spacecraftPreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      spacecraftFilter: filterId,
      spacecraftList: list,
      spacecraftStats: spacecraftDisplay.computeSpacecraftStats(filtered),
      spacecraftFilterEmpty: all.length > 0 && filtered.length === 0
    })
  },

  onSpacecraftFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.spacecraftFilter) return
    this.applySpacecraftFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏图鉴页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllSpacecraft() {
    const allowed = await gateCheck('spacecraft_encyclopedia', '全球飞船图鉴')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.spacecraftFilter || 'all'
    navigateTo(ROUTES.SPACECRAFT_GALLERY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetrySpacecraftLoad() {
    this.loadSpacecraftGallery()
  },

  /** 飞船卡片图片加载失败：沿兜底链切换（缩略图 404 时回退原图） */
  onSpacecraftImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.spacecraftList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['spacecraftList[' + index + '].imageUrl']: spacecraftDisplay.cachedImage(fallbacks[0]),
      ['spacecraftList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击飞船卡片 → 会员门控 → 跳转飞船详情页（复用现有 spacecraft-detail） */
  async onSpacecraftCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    var id = ds.id
    if (id == null || id === '') return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('spacecraft_encyclopedia', '全球飞船图鉴')
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

  // ========== 全球发射场分布（骨架镜像全球飞船图鉴） ==========
  async loadLaunchSiteGallery() {
    this.setData({ launchSiteLoading: true, launchSiteLoadError: false })
    try {
      var previewOnly = !canUsePaidCloudSync()
      var previewLimit = launchSiteDisplay.TAB_PREVIEW_COUNT || 2
      var list = await launchSiteDisplay.loadLaunchSiteList()
      if (!list || list.length === 0) {
        this.setData({ launchSiteLoading: false })
        return
      }
      var cards = launchSiteDisplay.buildLaunchSiteCards(list, {
        imageCacheLimit: previewLimit
      })
      this._launchSiteAllCards = cards
      this._launchSitePreviewOnly = previewOnly
      this.setData({
        launchSiteFilterChips: previewOnly
          ? [{ id: 'all', label: '全部' }]
          : launchSiteDisplay.buildLaunchSiteFilterChips(cards),
        launchSiteLoading: false
      })
      this.applyLaunchSiteFilter(this.data.launchSiteFilter || 'all')
    } catch (err) {
      console.error('[Monitor] launch site load error:', err)
      this.setData({ launchSiteLoading: false, launchSiteLoadError: true })
    }
  },

  /** 应用筛选：卡片列表与汇总条联动刷新 */
  applyLaunchSiteFilter(filterId) {
    var all = this._launchSiteAllCards || []
    var filtered = launchSiteDisplay.applyLaunchSiteFilter(all, filterId)
    var previewLimit = launchSiteDisplay.TAB_PREVIEW_COUNT || 2
    var list = this._launchSitePreviewOnly ? filtered.slice(0, previewLimit) : filtered
    this.setData({
      launchSiteFilter: filterId,
      launchSiteList: list,
      launchSiteStats: launchSiteDisplay.computeLaunchSiteStats(filtered),
      launchSiteFilterEmpty: all.length > 0 && filtered.length === 0
    })
  },

  onLaunchSiteFilterTap(e) {
    var filterId = e.currentTarget.dataset.filter
    if (!filterId || filterId === this.data.launchSiteFilter) return
    this.applyLaunchSiteFilter(filterId)
  },

  /** 「查看全部」→ 独立全屏发射场页（带当前筛选），中度震动反馈；与卡片点击共用同一门控 */
  async onViewAllLaunchSites() {
    const allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
    if (!allowed) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var filter = this.data.launchSiteFilter || 'all'
    navigateTo(ROUTES.LAUNCH_SITE_GALLERY, filter !== 'all' ? { filter: filter } : undefined)
  },

  onRetryLaunchSiteLoad() {
    this.loadLaunchSiteGallery()
  },

  /** 发射场卡片图片加载失败：沿兜底链切换（卫星图 404 时回退实景图） */
  onLaunchSiteImageError(e) {
    var index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    var card = (this.data.launchSiteList || [])[index]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    this.setData({
      ['launchSiteList[' + index + '].imageUrl']: launchSiteDisplay.cachedImage(fallbacks[0]),
      ['launchSiteList[' + index + '].imageFallbacks']: fallbacks.slice(1)
    })
  },

  /** 点击发射场卡片 → 会员门控（复用全球飞船图鉴逻辑）→ 发射场详情页 */
  async onLaunchSiteCardTap(e) {
    var ds = e.currentTarget.dataset || {}
    if (!ds.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证
    const allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
    if (!allowed) return
    navigateTo(ROUTES.LAUNCH_SITE_DETAIL, { id: ds.id })
  },

  // ========== 全球发射商图鉴（默认展示 2 张预览卡） ==========

  /**
   * 加载发射商预览（轻量）：只读 featured 聚合缓存（1 个云文档），默认展示 2 张卡；
   * 全量数据只在用户点「查看全部」进入完整列表页时才加载
   */
  async loadAgencies(opts = {}) {
    // silent（下拉刷新）：已有卡片时不回退到骨架网格
    const silent = !!(opts.silent && (this.data.agencyVisible || []).length > 0)
    this.setData(silent ? { agencyError: '' } : { agencyLoading: true, agencyError: '' })
    try {
      const { list, totalCount } = await getFeaturedAgencies()
      const featured = filterAgencies(list || [], 'featured', '')
      const pick = featured.length ? featured : (list || [])
      this.setData({
        agencyLoading: false,
        agencyError: '',
        agencyTotal: totalCount || 0,
        agencyVisible: pick.slice(0, 2).map(toDisplayRow)
      })
      this.tryOpenPendingAgencyDetail()
    } catch (e) {
      console.error('[Agency] loadAgencies error:', e)
      this.setData({ agencyLoading: false, agencyError: '加载失败，请稍后重试' })
    }
  },

  /** 卡片图加载失败：优先走统一 imageFallbacks，再兜底压缩链/logo */
  onAgencyImageError(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const item = this.data.agencyVisible[idx]
    if (!item) return
    const cur = String(item.displayImage || '')
    const fallbacks = item.imageFallbacks || []
    if (fallbacks.length) {
      const next = fallbacks[0]
      const remaining = fallbacks.slice(1)
      if (next && next !== cur) {
        this.setData({
          [`agencyVisible[${idx}].displayImage`]: next,
          [`agencyVisible[${idx}].imageFallbacks`]: remaining,
          [`agencyVisible[${idx}].imageMode`]: (item.imageUrl || item.imageUrlRaw) ? 'aspectFill' : 'aspectFit'
        })
        return
      }
      this.setData({
        [`agencyVisible[${idx}].displayImage`]: remaining[0] || '',
        [`agencyVisible[${idx}].imageFallbacks`]: remaining.slice(1)
      })
      return
    }
    const stripCi = (u) => {
      const s = String(u || '').trim()
      if (!s) return ''
      const q = s.indexOf('?')
      if (q < 0) return s
      if (!/imageMogr2|ci-process=/i.test(s.slice(q + 1))) return s
      return s.slice(0, q)
    }
    // 1) 当前是 imageMogr2/CI 压缩链 → 回退同图原链
    const stripped = stripCi(cur)
    if (stripped && stripped !== cur) {
      this.setData({ [`agencyVisible[${idx}].displayImage`]: stripped })
      return
    }
    // 2) 大图失败 → 换 logo（压缩版或原链）
    const logoCandidates = [item.logoUrl, item.logoUrlRaw].filter(Boolean)
    for (let i = 0; i < logoCandidates.length; i++) {
      const next = logoCandidates[i]
      if (next && next !== cur) {
        this.setData({
          [`agencyVisible[${idx}].displayImage`]: next,
          [`agencyVisible[${idx}].imageMode`]: 'aspectFit'
        })
        return
      }
    }
    // 3) logo 压缩链失败 → 再试 logo 原链（上面循环已覆盖）；都失败则占位
    if (item.displayImage) {
      this.setData({ [`agencyVisible[${idx}].displayImage`]: '' })
    }
  },

  /** 查看全部 → 完整列表页（全量数据在该页加载，含筛选与搜索）；与卡片点击共用同一门控 */
  async onViewAllAgencies() {
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    }
    wx.navigateTo({
      url: '/subpackages/monitor-pages/agency-list'
    })
  },

  /** 点击发射商卡片 → 跳转独立详情页 */
  async onAgencyTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    const item = (this.data.agencyVisible || []).find(a => String(a.id) === String(id))
    try {
      const app = getApp()
      if (app && item && item.displayImage) {
        app._agencyHeroImage = {
          id: String(id),
          src: item.displayImage,
          fallbacks: (item.imageFallbacks || []).slice()
        }
      }
    } catch (err) {}
    wx.navigateTo({
      url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(id)}`
    })
  },

  /** 尝试打开待展示的发射商详情（供搜索跳转后自动打开，globalData 内存交接） */
  tryOpenPendingAgencyDetail() {
    let pendingId = ''
    try {
      const app = getApp()
      if (app && app.globalData) {
        pendingId = app.globalData.pendingAgencyDetailId || ''
        if (pendingId) app.globalData.pendingAgencyDetailId = ''
      }
    } catch (e) {}
    if (!pendingId) return
    wx.navigateTo({
      url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(pendingId)}`
    })
  },

  /** 重试加载发射商 */
  retryLoadAgencies() {
    this.loadAgencies()
  }
}

module.exports = {
  methods,
  attachTo(page) {
    Object.keys(methods).forEach((name) => {
      page[name] = methods[name].bind(page)
    })
    page.__galleriesAttached = true
  }
}
