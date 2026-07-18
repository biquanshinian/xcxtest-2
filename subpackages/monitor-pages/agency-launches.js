/**
 * 发射商任务列表页（独立路径，便于分享）
 * 入口：发射商详情页「即将发射 / 历史发射」板块的「查看全部」按钮
 * 参数：id（LL2 机构 id）、name、abbrev、type（upcoming | completed）
 * 数据：复用首页 limit=100 规范缓存按发射商过滤，不直连 LL2
 */
const pageBase = require('../../utils/page-base.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { fetchAgencyLaunchCards } = require('./utils/agency-launch-cards.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath } = require('./utils/share-gate.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    list: [],
    navTitle: '发射任务',
    typeLabel: '即将发射',
    agencyName: '',
    isCompleted: false,
    scrollRefreshing: false
  },

  async onLoad(options) {
    this._agencyId = options.id ? String(options.id).trim() : ''
    this._agencyAbbrev = options.abbrev ? decodeURIComponent(String(options.abbrev)).trim() : ''
    this._agencyName = options.name ? decodeURIComponent(String(options.name)).trim() : ''
    this._type = options.type === 'completed' ? 'completed' : 'upcoming'
    const typeLabel = this._type === 'completed' ? '历史发射' : '即将发射'

    this.initUiShell()

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'agency_encyclopedia', '全球发射商图鉴')
    if (!shareAllowed) {
      this.setData({ loading: false, list: [], navTitle: typeLabel })
      wx.showToast({ title: '分享链接已过期', icon: 'none' })
      return
    }
    warmShareEntitlement(this, 'agency_encyclopedia')
    this.setData({
      typeLabel,
      isCompleted: this._type === 'completed',
      agencyName: this._agencyName,
      navTitle: this._agencyName ? `${this._agencyName} · ${typeLabel}` : typeLabel
    })
    this.loadList()
  },

  async loadList(opts = {}) {
    if (!this._agencyId && !this._agencyAbbrev) {
      this.setData({ loading: false, list: [] })
      return
    }
    if (!opts.silent) this.setData({ loading: true })
    const cards = await fetchAgencyLaunchCards(
      { id: this._agencyId || null, abbrev: this._agencyAbbrev },
      this._type
    )
    this.setData({ loading: false, list: cards })
  },

  /** 原生三点下拉刷新（页面级 / scroll-view refresher 共用） */
  onScrollRefresh() {
    runPullRefresh(this, () => this.loadList({ silent: true }), 'scrollRefreshing')
  },

  onPullDownRefresh() {
    runPullRefresh(this, () => this.loadList({ silent: true }))
  },

  onRetry() {
    this.loadList()
  },

  onTapLaunch(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    if (!ds.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    navigateTo(ROUTES.MISSION_DETAIL, { id: ds.id, type: this._type })
  },

  _sharePath() {
    const q = [
      'id=' + encodeURIComponent(this._agencyId || ''),
      'name=' + encodeURIComponent(this._agencyName || ''),
      'abbrev=' + encodeURIComponent(this._agencyAbbrev || ''),
      'type=' + this._type
    ].join('&')
    return withShareStampPath(`${ROUTES.AGENCY_LAUNCHES}?${q}`, this)
  },

  onShareAppMessage() {
    return {
      title: `${this.data.navTitle} | 火星探索日志`,
      path: this._sharePath()
    }
  },

  onShareTimeline() {
    return {
      title: `${this.data.navTitle} | 火星探索日志`,
      query: this._sharePath().split('?')[1] || ''
    }
  }
})
