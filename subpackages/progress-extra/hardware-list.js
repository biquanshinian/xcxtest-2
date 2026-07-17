/**
 * 星舰硬件设施完整列表页 —— 搜索 + 分类筛选 + 全量卡片网格
 * 由星舰进度页「展开更多」进入，可携带 category / keyword 初始条件
 */
const pageBase = require('../../utils/page-base.js')
const { getStarshipHardwareFromDB } = require('../../utils/api-app-services.js')
const { resolveMediaUrl } = require('../../utils/image-config.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')
const { gateCheck } = require('../../utils/membership.js')

const B19_IMAGE_KEY = '最新版星舰组合体进展一二级图/b19_spacex3.webp'
const S39_IMAGE_KEY = '最新版星舰组合体进展一二级图/s39_spacex.webp'

const HARDWARE_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'fullstack', label: '组合体' },
  { id: 'booster', label: '助推器' },
  { id: 'ship', label: '飞船' },
  { id: 'suborbital', label: '亚轨道' },
  { id: 'other', label: '其他' }
]

function getFallbackImage(category) {
  const key = category === 'booster' || category === 'fullstack' ? B19_IMAGE_KEY : S39_IMAGE_KEY
  return resolveMediaUrl(key, '')
}

function resolveHardwareDisplayImage(image) {
  const raw = String(image || '').trim()
  if (!raw) return ''
  return getCachedMediaImage(raw, 'thumb')
}

function getStatusType(statusText) {
  const text = String(statusText || '').trim().toUpperCase()
  if (text === 'ACTIVE') return 'active'
  if (text === 'DESTROYED') return 'destroyed'
  if (text === 'EXPENDED') return 'expended'
  return 'retired'
}

function buildSearchKey(name) {
  const lower = String(name || '').toLowerCase()
  const noSpace = lower.replace(/[\s/]+/g, '')
  const abbrev = lower
    .replace(/booster\s*/g, 'b')
    .replace(/starship\s*/g, '')
    .replace(/ship\s*/g, 's')
    .replace(/[\s/]+/g, '')
  return `${lower}|${noSpace}|${abbrev}`
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/progress/progress',

  data: {
    loading: true,
    errorMessage: '',
    categories: HARDWARE_CATEGORIES,
    category: 'all',
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
    const category = HARDWARE_CATEGORIES.some((c) => c.id === (options && options.category))
      ? options.category
      : 'all'
    const keyword = options && options.keyword ? decodeURIComponent(options.keyword) : ''
    this.setData({ category, keyword })
    this.loadList()
  },

  async loadList(skipCache) {
    try {
      const res = await getStarshipHardwareFromDB({ skipCache: !!skipCache })
      this._all = (res.vehicles || []).map((item) => ({
        ...item,
        statusType: getStatusType(item.status),
        displayImage: item.image
          ? resolveHardwareDisplayImage(item.image)
          : getFallbackImage(item.category),
        searchKey: buildSearchKey(item.name)
      }))
      this.setData({
        loading: false,
        errorMessage: this._all.length === 0 ? (res.fetchError || '暂无数据，请稍后重试') : ''
      })
      this._applyFilter()
    } catch (e) {
      this.setData({ loading: false, errorMessage: '加载失败，请稍后重试' })
    }
  },

  _applyFilter() {
    const all = this._all || []
    const category = this.data.category
    const keyword = String(this.data.keyword || '').trim().toLowerCase().replace(/\s+/g, '')

    let filtered = category === 'all' ? all : all.filter((v) => v.category === category)
    if (keyword) {
      filtered = filtered.filter((v) => v.searchKey.indexOf(keyword) >= 0)
    }
    this.setData({ list: filtered, totalCount: filtered.length })
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id === this.data.category) return
    this.setData({ category: id }, () => this._applyFilter())
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
    if (id == null) return
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('starship_hardware', '星舰硬件设施')
    if (!allowed) return
    wx.navigateTo({
      url: `/subpackages/progress-extra/hardware-detail?id=${id}`
    })
  },

  onCardImageError(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.list[idx]
    if (!item) return
    const fallback = getFallbackImage(item.category)
    if (item.displayImage === fallback) return
    this.setData({ [`list[${idx}].displayImage`]: fallback })
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
  },

  _buildShareQuery() {
    const params = []
    if (this.data.category !== 'all') params.push('category=' + this.data.category)
    const keyword = String(this.data.keyword || '').trim()
    if (keyword) params.push('keyword=' + encodeURIComponent(keyword))
    return params.join('&')
  },

  onShareAppMessage() {
    const query = this._buildShareQuery()
    return {
      title: 'SpaceX 星舰硬件设施 | 火星探索日志',
      path: '/subpackages/progress-extra/hardware-list' + (query ? '?' + query : ''),
      imageUrl: (this.data.list[0] && this.data.list[0].displayImage) || ''
    }
  },

  onShareTimeline() {
    return {
      title: 'SpaceX 星舰硬件设施 | 火星探索日志',
      query: this._buildShareQuery(),
      imageUrl: (this.data.list[0] && this.data.list[0].displayImage) || ''
    }
  }
})
