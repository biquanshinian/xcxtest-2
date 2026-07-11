/**
 * 全球发射商图鉴完整列表页 —— 搜索 + 分类筛选 + 全量卡片网格
 * 由监控中心页「展开更多」进入，可携带 filter / keyword 初始条件
 * 显示与交互逻辑与星舰硬件设施列表页一致
 */
const pageBase = require('../../utils/page-base.js')
const { AGENCY_FILTERS, getAllAgencies, filterAgencies, toDisplayRow } = require('../../utils/agency-data.js')
const { gateCheck, isProSync } = require('../../utils/membership.js')
const { ROUTES } = require('../../utils/routes.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    loading: true,
    errorMessage: '',
    isProUser: false,
    filters: AGENCY_FILTERS,
    filter: 'featured',
    keyword: '',
    list: [],
    totalCount: 0
  },

  onLoad(options) {
    this.initUiShell()
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
    const filter = AGENCY_FILTERS.some((f) => f.id === (options && options.filter))
      ? options.filter
      : 'featured'
    const keyword = options && options.keyword ? decodeURIComponent(options.keyword) : ''
    this.setData({ filter, keyword, isProUser: isProSync() })
    this.loadList()
  },

  async loadList(forceRefresh) {
    try {
      const res = await getAllAgencies({ forceRefresh: !!forceRefresh })
      this._all = res.list || []
      this.setData({
        loading: false,
        errorMessage: this._all.length === 0 ? '暂无数据，请稍后重试' : ''
      })
      this._applyFilter()
    } catch (e) {
      this.setData({ loading: false, errorMessage: '加载失败，请稍后重试' })
    }
  },

  _applyFilter() {
    const filtered = filterAgencies(this._all || [], this.data.filter, this.data.keyword)
    this.setData({
      list: filtered.map(toDisplayRow),
      totalCount: filtered.length
    })
  },

  onFilterTap(e) {
    const id = e.currentTarget.dataset.filter
    if (!id || id === this.data.filter) return
    this.setData({ filter: id }, () => this._applyFilter())
  },

  onSearchInput(e) {
    const value = (e.detail && e.detail.value) || ''
    this.setData({ keyword: value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      this._applyFilter()
    }, 200)
  },

  onSearchClear() {
    if (!this.data.keyword) return
    this.setData({ keyword: '' }, () => this._applyFilter())
  },

  async onCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    wx.navigateTo({
      url: `${ROUTES.AGENCY_DETAIL}?id=${encodeURIComponent(id)}`
    })
  },

  onCardImageError(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const item = this.data.list[idx]
    if (!item) return
    if (item.imageUrl && item.logoUrl && item.displayImage !== item.logoUrl) {
      this.setData({
        [`list[${idx}].displayImage`]: item.logoUrl,
        [`list[${idx}].imageMode`]: 'aspectFit'
      })
    } else if (item.displayImage) {
      this.setData({ [`list[${idx}].displayImage`]: '' })
    }
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
  },

  _buildShareQuery() {
    const params = []
    if (this.data.filter !== 'featured') params.push('filter=' + this.data.filter)
    const keyword = String(this.data.keyword || '').trim()
    if (keyword) params.push('keyword=' + encodeURIComponent(keyword))
    return params.join('&')
  },

  onShareAppMessage() {
    const query = this._buildShareQuery()
    return {
      title: `全球发射商图鉴 - ${this.data.totalCount || ''}家航天机构全览 | 火星探索日志`,
      path: '/subpackages/monitor-pages/agency-list' + (query ? '?' + query : ''),
      imageUrl: (this.data.list[0] && this.data.list[0].displayImage) || ''
    }
  },

  onShareTimeline() {
    return {
      title: '全球发射商图鉴 | 火星探索日志',
      query: this._buildShareQuery(),
      imageUrl: (this.data.list[0] && this.data.list[0].displayImage) || ''
    }
  }
})
