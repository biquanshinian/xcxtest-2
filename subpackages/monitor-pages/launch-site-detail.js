/**
 * 发射场详情页 — LL2 坐标数据驱动的腾讯地图详情
 * 入口：监控中心「全球发射场分布」卡片 / 发射场图鉴卡片
 * 设计参考 launch-site-map（全球发射基地）的 map-page 布局：
 *   全屏地图 + 顶部地图工具 + 底部可折叠玻璃信息面板
 */
const { formatMapUpdateTime, createMapBaseState, buildMapLayoutData, buildMapShareOptions, copyMapText } = require('./utils/map-page-common.js')
const launchSiteDisplay = require('./utils/launch-site-display.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const pageBase = require('../../utils/page-base.js')

/** 地图 marker id 约定：0 = 发射场主标记；>0 = 工位（pad.id） */
const SITE_MARKER_ID = 0
const SITE_SCALE = 11
const PAD_SCALE = 14
const WORLD_SCALE = 3

function siteMarker(site) {
  return {
    id: SITE_MARKER_ID,
    latitude: site.latitude,
    longitude: site.longitude,
    width: 34,
    height: 34,
    callout: {
      content: site.nameZh || site.name,
      color: '#FFFFFF',
      fontSize: 12,
      borderRadius: 12,
      bgColor: '#0A84FF',
      padding: 8,
      display: 'ALWAYS'
    }
  }
}

function padMarker(pad) {
  return {
    id: pad.id,
    latitude: pad.latitude,
    longitude: pad.longitude,
    width: 22,
    height: 22,
    alpha: pad.active ? 1 : 0.6,
    callout: {
      content: pad.name,
      color: '#FFFFFF',
      fontSize: 11,
      borderRadius: 10,
      bgColor: pad.active ? '#34C759' : '#8E8E93',
      padding: 6,
      display: 'BYCLICK'
    }
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    statusBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    latitude: 28.6,
    longitude: -80.6,
    scale: SITE_SCALE,
    markers: [],
    site: null,
    hasCoords: false,
    coordsText: '',
    pads: [],
    padsLoading: false,
    selectedPadId: 0,
    panelCollapsed: false,
    actionMenuCollapsed: true,
    descI18n: { siteDesc: '' },
    descTranslated: false,
    descTranslating: false,
    /* 分享免门控 24h 剩余时间倒计时胶囊（share-gate.js 写入） */
    shareGateExpireAt: 0,
    ...createMapBaseState({
      dataSourceText: 'Launch Library 2 · Locations / Pads',
      dataUpdatedText: '待更新',
      analyticsScene: 'launch-site-detail',
      shareTitle: '发射场详情'
    })
  },

  async onLoad(options = {}) {
    this.initUiShell()
    const app = getApp()
    this._siteId = Number(options.id || 0)
    this.setData(buildMapLayoutData(app))

    // 门控复用「全球飞船图鉴」：App 内入口已在卡片点击处 gateCheck，
    // 这里只处理分享卡片 —— 24h 免门控窗口，过期后 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'launch_site_encyclopedia', '全球发射场分布')
    if (!shareAllowed) {
      this.setData({ loading: false, errorText: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'launch_site_encyclopedia')

    this.loadDetail(this._siteId)
  },

  /** 主数据：列表 24h 缓存按 id 命中（缓存命中即秒开），miss 时走云函数回源 */
  async loadDetail(id) {
    if (!id) {
      this.setData({ loading: false, errorText: '缺少发射场参数，请返回重试' })
      return
    }
    this.setData({ loading: true, errorText: '' })
    try {
      const list = await launchSiteDisplay.loadLaunchSiteList()
      const cards = launchSiteDisplay.buildLaunchSiteCards(list)
      const site = cards.find((c) => Number(c.id) === Number(id)) || null
      if (!site) {
        this.setData({ loading: false, errorText: '未找到该发射场，数据可能已更新' })
        return
      }
      const hasCoords = site.latitude != null && site.longitude != null
      const patch = {
        loading: false,
        site,
        hasCoords,
        coordsText: hasCoords ? `${Number(site.latitude).toFixed(4)}, ${Number(site.longitude).toFixed(4)}` : '',
        dataUpdatedText: formatMapUpdateTime(new Date()),
        shareTitle: (site.nameZh || site.name) + ' · 发射场详情'
      }
      if (hasCoords) {
        patch.latitude = site.latitude
        patch.longitude = site.longitude
        patch.scale = SITE_SCALE
        patch.markers = [siteMarker(site)]
      }
      this.setData(patch)
      wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: site.nameZh || site.name, fail: () => {} })
      if (hasCoords) this._loadPads(site)
    } catch (e) {
      console.warn('[launch-site-detail] 加载失败:', e)
      this.setData({ loading: false, errorText: '发射场数据加载失败，请稍后重试' })
    }
  },

  /** 工位（Pad）标记：异步补充，失败静默（主信息不受影响） */
  async _loadPads(site) {
    this.setData({ padsLoading: true })
    try {
      const rows = await launchSiteDisplay.loadPadList(site.id)
      // 页面已切换（理论上不会，防御）或站点变化时丢弃
      if (!this.data.site || Number(this.data.site.id) !== Number(site.id)) return
      const pads = (rows || []).filter((p) => p.latitude != null && p.longitude != null)
      const markers = [siteMarker(site)].concat(pads.map(padMarker))
      this.setData({ pads, padsLoading: false, markers })
    } catch (e) {
      console.warn('[launch-site-detail] 工位加载失败:', e)
      this.setData({ padsLoading: false })
    }
  },

  onRetryLoad() {
    this.loadDetail(this._siteId)
  },

  /** 简介「翻译/原文」（同 agency-detail 简介胶囊，内置中度震动） */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const site = this.data.site || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [{ path: 'descI18n.siteDesc', text: site.description || '' }]
    })
  },

  // ── 地图交互 ──

  onMarkerTap(e) {
    const id = Number(e.markerId != null ? e.markerId : (e.detail && e.detail.markerId))
    if (id === SITE_MARKER_ID) {
      this.focusSite()
      return
    }
    const pad = this.data.pads.find((p) => Number(p.id) === id)
    if (pad) {
      this.setData({ selectedPadId: id, latitude: pad.latitude, longitude: pad.longitude, scale: PAD_SCALE })
    }
  },

  onPadChipTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    const pad = this.data.pads.find((p) => Number(p.id) === id)
    if (!pad) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    this.setData({ selectedPadId: id, latitude: pad.latitude, longitude: pad.longitude, scale: PAD_SCALE })
  },

  /** 回到发射场视角 */
  focusSite() {
    const site = this.data.site
    if (!site || !this.data.hasCoords) return
    this.setData({ selectedPadId: 0, latitude: site.latitude, longitude: site.longitude, scale: SITE_SCALE })
  },

  resetWorldView() {
    const site = this.data.site
    if (!site || !this.data.hasCoords) return
    this.setData({ selectedPadId: 0, latitude: site.latitude, longitude: site.longitude, scale: WORLD_SCALE })
  },

  copyCoords() {
    const site = this.data.site
    if (!site || !this.data.coordsText) {
      wx.showToast({ title: '暂无坐标数据', icon: 'none' })
      return
    }
    copyMapText(`${site.nameZh || site.name} ${this.data.coordsText}`, '坐标已复制')
  },

  // ── 面板 / 工具开合 ──

  togglePanelCollapsed() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed })
  },

  toggleActionMenuCollapsed() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  /** 卫星定位图预览（保留原卡片的预览能力） */
  onPreviewMapImage() {
    const site = this.data.site
    const url = site && site.imageUrl
    if (!url) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    wx.previewImage({ urls: [url], fail: () => {} })
  },

  onShareAppMessage() {
    const site = this.data.site
    // 分享路径带 sst 时间戳：有权益重开 24h 免门控窗口，无权益继承原窗口
    return buildMapShareOptions({
      shareTitle: this.data.shareTitle,
      detailText: site ? `${site.countryLabel || ''} · 累计发射 ${site.totalLaunchCount} 次` : '全球发射场分布',
      path: withShareStampPath(`/subpackages/monitor-pages/launch-site-detail?id=${this._siteId || ''}`, this)
    })
  },

  onShareTimeline() {
    return {
      title: this.data.shareTitle,
      query: withShareStampQuery(`id=${this._siteId || ''}`, this)
    }
  }
})
