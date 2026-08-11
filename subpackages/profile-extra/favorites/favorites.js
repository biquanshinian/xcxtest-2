const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync, applyThemeToPage } = require('../../../utils/theme.js')
const {
  getGroupedFavorites,
  getFavoriteCount,
  removeFavorite,
  resolveFavoriteUrl
} = require('../../../utils/favorites.js')
const { ROUTES } = require('../../../utils/routes.js')
const { gateCheck } = require('../../../utils/membership.js')

const GATE_BY_CAT = {
  agency: ['agency_encyclopedia', '全球发射商图鉴'],
  booster: ['booster_genealogy', '全球可回收火箭族谱'],
  spacecraft: ['spacecraft_encyclopedia', '全球飞船图鉴'],
  launch_site: ['launch_site_encyclopedia', '全球发射场分布']
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    groups: [],
    total: 0
  },

  onLoad() {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (e) {}
    this._reload()
  },

  onShow() {
    applyThemeToPage(this)
    this.setData({
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    this._reload()
  },

  _reload() {
    const groups = (getGroupedFavorites() || []).map((group) => {
      const items = (group.items || []).map((item) => {
        const title = String((item && item.title) || '').trim()
        let fallbackChar = '?'
        if (item && item.type === 'collection') fallbackChar = '册'
        else if (title) fallbackChar = title.charAt(0)
        return Object.assign({}, item, { fallbackChar })
      })
      return Object.assign({}, group, { items })
    })
    this.setData({
      groups,
      total: getFavoriteCount()
    })
  },

  async onItemTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const type = ds.type
    const id = ds.id
    if (!type || id == null) return
    const groups = this.data.groups || []
    let item = null
    for (let i = 0; i < groups.length; i++) {
      const found = (groups[i].items || []).find((x) => String(x.type) === String(type) && String(x.id) === String(id))
      if (found) { item = found; break }
    }
    const url = resolveFavoriteUrl(item || { type, id, route: ds.route })
    if (!url) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}

    const cat = (item && item.category) || (type === 'collection' ? '' : type)
    const gate = GATE_BY_CAT[cat]
    if (gate) {
      const allowed = await gateCheck(gate[0], gate[1])
      if (!allowed) return
    }
    wx.navigateTo({ url })
  },

  /** 长按卡片 → 取消收藏（与微信列表管理一致，去掉角标 ✕） */
  onItemLongPress(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const type = ds.type
    const id = ds.id
    const title = ds.title || '该项'
    if (!type || id == null) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    const self = this
    wx.showActionSheet({
      itemList: ['取消收藏'],
      itemColor: '#FF3B30',
      success(res) {
        if (res.tapIndex !== 0) return
        removeFavorite(type, id)
        self._reload()
        wx.showToast({ title: '已取消收藏', icon: 'none' })
      }
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  onShareAppMessage() {
    return {
      title: '我的收藏 · 火星探索日志',
      path: ROUTES.FAVORITES
    }
  },

  onShareTimeline() {
    return {
      title: '我的收藏 · 火星探索日志',
      query: ''
    }
  }
})
