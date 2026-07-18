const pageBase = require('../../utils/page-base.js')
const {
  ALL_COUNTRY_KEY,
  buildYearOptions,
  fetchGlobalLaunchStats,
  readPersistedGlobalStats,
  loadAgencyLogoNameMap,
  decorateAgencyRows,
  decorateRocketRows
} = require('./utils/global-launch-stats.js')
const { persistAgencyLogoAfterRemoteLoad } = require('../../utils/agency-logo-cache.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
// 确保首页 require.async 能加载该分包模块（未被引用时不会打进分包）
require('./utils/index-calendar-page.js')

const CURRENT_YEAR = new Date().getUTCFullYear()

/** 成功率文案：总数为 0 时返回空串（不显示徽章） */
function successRateText(summary) {
  const total = Number(summary && summary.total) || 0
  const success = Number(summary && summary.success) || 0
  if (total <= 0) return ''
  return `${((success / total) * 100).toFixed(1)}%`
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    loadingSummary: true,
    loadingBreakdown: true,
    breakdownReady: false,
    errorMessage: '',
    scrollRefreshing: false,
    navTitle: '全球发射统计',
    selectedYear: CURRENT_YEAR,
    selectedCountryKey: ALL_COUNTRY_KEY,
    selectedCountryLabel: '全部国家',
    yearLabel: '本年度',
    yearOptions: [],
    countryOptions: [],
    showYearPicker: false,
    showCountryPicker: false,
    summary: { total: 0, success: 0, failure: 0 },
    summaryRateText: '',
    byCountry: [],
    byAgency: [],
    byRocket: [],
    activeTab: 'country',
    listExpanded: false
  },

  async onLoad(options) {
    this.initUiShell()

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'global_launch_stats', '全球发射统计')
    if (!shareAllowed) {
      this.setData({
        loading: false,
        loadingSummary: false,
        loadingBreakdown: false,
        errorMessage: '分享链接已过期，开通星际通行证后可继续查看'
      })
      return
    }
    warmShareEntitlement(this, 'global_launch_stats')

    // 小程序 AI 接力/服务直达：支持 query 指定年份（year=2025）
    try {
      const app = getApp()
      if (app && typeof app.takeAgentHandoff === 'function' && typeof this.getPageId === 'function') {
        this._agentHandoff = app.takeAgentHandoff(this.getPageId())
      }
    } catch (e) {}
    let initialYear = CURRENT_YEAR
    const queryYear = Number(options && options.year)
    if (queryYear >= 1957 && queryYear <= CURRENT_YEAR + 1) initialYear = queryYear

    this.setData({
      selectedYear: initialYear,
      yearOptions: buildYearOptions(CURRENT_YEAR),
      yearLabel: initialYear === CURRENT_YEAR ? '本年度' : `${initialYear} 年`
    })
    // 机构 logo 映射：getAgencies 自带本地 Storage 缓存，首次拉取后离线可用
    this._agencyLogoMap = null
    loadAgencyLogoNameMap().then((map) => {
      this._agencyLogoMap = map
      if ((this.data.byAgency || []).length) {
        this.setData({ byAgency: decorateAgencyRows(this.data.byAgency, map) })
      }
    })
    this.applyPersistedSnapshot()
    this.loadStats()
  },

  applyPersistedSnapshot() {
    const snap = readPersistedGlobalStats(this.data.selectedYear, this.data.selectedCountryKey)
    if (!snap) return

    let selectedCountryLabel = '全部国家'
    if (this.data.selectedCountryKey !== ALL_COUNTRY_KEY) {
      const hit = (snap.countryOptions || []).find((c) => c.key === this.data.selectedCountryKey)
      selectedCountryLabel = hit ? hit.label : this.data.selectedCountryKey
    }

    const hasBreakdown = (snap.byCountry || []).length > 0
      || (snap.byAgency || []).length > 0
      || (snap.byRocket || []).length > 0
    // 只要有 summary 总数即先渲染（秒显头部），明细缺失时仅明细区显示加载
    const hasSummary = !!(snap.summary && snap.summary.total > 0)

    this.setData({
      loading: !hasSummary && !hasBreakdown,
      loadingSummary: !hasSummary,
      loadingBreakdown: !hasBreakdown,
      breakdownReady: hasBreakdown,
      summary: snap.summary || { total: 0, success: 0, failure: 0 },
      summaryRateText: successRateText(snap.summary),
      byCountry: snap.byCountry || [],
      byAgency: decorateAgencyRows(snap.byAgency || [], this._agencyLogoMap),
      byRocket: decorateRocketRows(snap.byRocket || []),
      countryOptions: snap.countryOptions || [],
      selectedCountryLabel
    })
  },

  applyStats(stats, options = {}) {
    const partial = !!(options && options.partial)
    let selectedCountryLabel = '全部国家'
    if (this.data.selectedCountryKey !== ALL_COUNTRY_KEY) {
      const hit = (stats.countryOptions || []).find((c) => c.key === this.data.selectedCountryKey)
      selectedCountryLabel = hit ? hit.label : this.data.selectedCountryKey
    }

    const breakdownReady = !!stats.breakdownReady
      || (stats.byCountry || []).length > 0
      || (stats.byAgency || []).length > 0
      || (stats.byRocket || []).length > 0

    this.setData({
      loading: partial ? this.data.loading : false,
      loadingSummary: false,
      loadingBreakdown: partial ? true : !breakdownReady,
      breakdownReady,
      summary: stats.summary || { total: 0, success: 0, failure: 0 },
      summaryRateText: successRateText(stats.summary),
      byCountry: stats.byCountry || [],
      byAgency: decorateAgencyRows(stats.byAgency || [], this._agencyLogoMap),
      byRocket: decorateRocketRows(stats.byRocket || []),
      countryOptions: (stats.countryOptions || []).length ? stats.countryOptions : this.data.countryOptions,
      selectedCountryLabel,
      yearLabel: this.data.selectedYear === CURRENT_YEAR ? '本年度' : `${this.data.selectedYear}年`
    })
  },

  async loadStats(options = {}) {
    const forceRefresh = !!(options && options.forceRefresh)
    const skipLocalCache = !!(options && options.skipLocalCache)
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1)

    this.setData({
      loading: !this.data.breakdownReady,
      loadingSummary: true,
      loadingBreakdown: true,
      errorMessage: ''
    })

    try {
      const stats = await fetchGlobalLaunchStats({
        year: this.data.selectedYear,
        countryKey: this.data.selectedCountryKey,
        forceRefresh,
        skipLocalCache,
        onSummary: (summaryStats) => {
          if (loadSeq !== this._loadSeq) return
          this.applyStats(summaryStats, { partial: true })
        }
      })
      if (loadSeq !== this._loadSeq) return
      this.applyStats(stats)
      this.setData({
        loading: false,
        loadingSummary: false,
        loadingBreakdown: false,
        breakdownReady: true,
        errorMessage: stats.loadError || ''
      })
    } catch (err) {
      if (loadSeq !== this._loadSeq) return
      const hasPartial = this.data.summary.total > 0 || this.data.breakdownReady
      if (hasPartial) {
        this.setData({
          loading: false,
          loadingSummary: false,
          loadingBreakdown: false
        })
        return
      }
      const msg = (err && err.message) || '数据加载失败，请稍后重试'
      this.setData({
        loading: false,
        loadingSummary: false,
        loadingBreakdown: false,
        errorMessage: msg
      })
    }
  },

  onOpenYearPicker() {
    this.setData({ showYearPicker: true })
  },

  onCloseYearPicker() {
    this.setData({ showYearPicker: false })
  },

  onSelectYear(e) {
    const year = Number(e.currentTarget.dataset.year)
    if (!Number.isFinite(year)) return
    this.setData({
      selectedYear: year,
      showYearPicker: false,
      selectedCountryKey: ALL_COUNTRY_KEY,
      selectedCountryLabel: '全部国家',
      breakdownReady: false,
      listExpanded: false
    })
    this.applyPersistedSnapshot()
    this.loadStats()
  },

  onOpenCountryPicker() {
    this.setData({ showCountryPicker: true })
  },

  onCloseCountryPicker() {
    this.setData({ showCountryPicker: false })
  },

  onSelectCountry(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const hit = (this.data.countryOptions || []).find((c) => c.key === key)
    this.setData({
      selectedCountryKey: key,
      selectedCountryLabel: hit ? hit.label : (key === ALL_COUNTRY_KEY ? '全部国家' : key),
      showCountryPicker: false,
      breakdownReady: false,
      listExpanded: false
    })
    this.applyPersistedSnapshot()
    this.loadStats()
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab, listExpanded: false })
  },

  onToggleListExpand() {
    this.setData({ listExpanded: !this.data.listExpanded })
  },

  /** 原生三点下拉刷新：跳过本地缓存重读云端只读统计，绝不触发 LL2 */
  onScrollRefresh() {
    runPullRefresh(this, () => this.loadStats({ skipLocalCache: true }), 'scrollRefreshing')
  },

  onPullDownRefresh() {
    runPullRefresh(this, () => this.loadStats({ skipLocalCache: true }))
  },

  retryLoad() {
    this.loadStats({ forceRefresh: true })
  },

  /** 机构 logo 远程首次展示成功 → 落盘本地磁盘缓存，下次打开零流量 */
  onAgencyLogoLoad(e) {
    const url = e.currentTarget.dataset.url
    if (url && /^https?:\/\//i.test(url)) {
      persistAgencyLogoAfterRemoteLoad(url)
    }
  },

  /** logo 加载失败 → 回退首字母占位 */
  onAgencyLogoError(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(idx) || !this.data.byAgency[idx]) return
    this.setData({ [`byAgency[${idx}].logo`]: '' })
  },

  /** 火箭配置图加载失败 → 回退首字母占位（getRocketImage 的缓存与重试由底层处理） */
  onRocketImageError(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(idx) || !this.data.byRocket[idx]) return
    this.setData({ [`byRocket[${idx}].image`]: '' })
  },

  onShareAppMessage() {
    return {
      title: '全球发射统计 | 火星探索日志',
      path: withShareStampPath('/subpackages/index-extra/global-launch-stats', this)
    }
  },

  onShareTimeline() {
    return {
      title: '全球发射统计 | 火星探索日志',
      query: withShareStampQuery('', this)
    }
  }
})
