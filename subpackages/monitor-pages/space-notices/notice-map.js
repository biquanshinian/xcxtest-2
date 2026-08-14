/**
 * SPACE_NOTICES_FEATURE — 单任务通告地图
 * 路由参数优先 entryKey（站点 slug）；ll2Id 仅兼容旧分享链接
 */
const pageBase = require('../../../utils/page-base.js')
const { formatDate } = require('../../../utils/util.js')
const { getSpaceNoticeEntry, syncSpaceNotices } = require('./utils/api-space-notices.js')
const { isSpaceNoticesEnabled } = require('../../../utils/space-notices-feature.js')
const { ROUTES, buildUrl } = require('../../../utils/routes.js')
const { gateCheck } = require('../../../utils/membership.js')
const {
  checkShareEntryGate,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('../utils/share-gate.js')
const { decorateNotice, decorateSpaceNoticeEntry, spaceNoticeDisplayTitle, sortNotices, buildStats, noticeStatusVisible, noticeChinaVisible } = require('./utils/notice-format.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildTrajectoryPolyline,
  resolveTrajectory,
  buildPadMarker,
  resolveEffectivePad,
  fitCenter,
  fitNotice,
  hasGeometry
} = require('./utils/map-build.js')
const { buildMapLayoutData, setMapSatelliteFromTap } = require('../utils/map-page-common.js')
const { isChinaPad, CHINA_OVERVIEW, isChineseCollectionKey, CHINESE_COLLECTION_KEY } = require('./utils/china-filter.js')

const GATE_PRODUCT_ID = 'space_notices'
const GATE_PRODUCT_NAME = '发射通告地图'

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    statusBarHeight: 44,
    menuButtonWidth: 88,
    isDirectEntry: false,
    entryKey: '',
    ll2Id: '',
    title: '',
    subtitle: '',
    padName: '',
    netText: '',
    latitude: 25.99677,
    longitude: -97.15799,
    scale: 6,
    markers: [],
    polygons: [],
    polylines: [],
    includePoints: [],
    notices: [],
    stats: { notam: 0, nav: 0, adp: 0, live: 0, soon: 0, ended: 0, cancelled: 0, china: 0 },
    loading: true,
    errorText: '',
    showNotam: true,
    showNav: true,
    showCorridor: true,
    /** 状态图层：生效 / 提前预警 / 已结束 / 已取消，默认全开 */
    showLive: true,
    showSoon: true,
    showEnded: true,
    showCancelled: true,
    /** 官网中国合集视图（collection-chinese-unknown），与底部图层 chip 无关 */
    chinaView: false,
    /** 仅显示中国相关通告；进入官网合集时为 true */
    chinaOnly: false,
    /** 仅当本任务有轨迹数据时才显示「轨迹」chip */
    hasTrajectory: false,
    showPad: true,
    /** 默认「全程」：首屏一眼看到所有通告几何/轨迹，再按需切发射区/溅落区 */
    mapRegion: 'global',
    panelCollapsed: false,
    selectedKey: '',
    selectedNotice: null,
    shareGateExpireAt: 0,
    mapActionTop: 0,
    actionMenuCollapsed: true,
    enableSatellite: true,
    mapSetting: { enableSatellite: true }
  },

  _entry: null,
  _notices: [],
  _decorated: [],
  _display: null,
  _prevMission: null,

  async onLoad(options) {
    this.initUiShell()
    const entryKey = options && options.entryKey ? decodeURIComponent(options.entryKey) : ''
    const ll2Id = options && options.ll2Id ? decodeURIComponent(options.ll2Id) : ''
    this.setData({
      entryKey,
      ll2Id,
      chinaView: isChineseCollectionKey(entryKey),
      chinaOnly: isChineseCollectionKey(entryKey),
      ...buildMapLayoutData(getApp())
    })

    const on = await isSpaceNoticesEnabled().catch(() => true)
    if (!on) {
      wx.showToast({ title: '功能已关闭', icon: 'none' })
      setTimeout(() => this.goBack(), 400)
      return
    }

    // 分享卡片 24h 免门控；过期走会员/广告门控
    const shareAllowed = await checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      this.setData({
        loading: false,
        errorText: '分享链接已过期，开通星际通行证或看广告后可继续查看'
      })
      return
    }
    // 无 sst 冷启动（旧分享/深链直达）：走完整门控；从列表进详情不拦
    const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (!this._shareSst && stack.length <= 1) {
      const allowed = await gateCheck(GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
      if (!allowed) {
        this.setData({ loading: false, errorText: '开通星际通行证或看广告后可使用发射通告地图' })
        setTimeout(() => this.goBack(), 500)
        return
      }
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)

    if (!entryKey && !ll2Id) {
      this.setData({ loading: false, errorText: '缺少任务 id' })
      return
    }
    this.loadEntry(entryKey, ll2Id)
  },

  onShow() {
    const before = this.data.themeLight
    this.syncTheme()
    if (this._notices.length && this.data.themeLight !== before) {
      this.applyLayers({ refit: false })
    }
  },

  async loadEntry(entryKey, ll2Id) {
    this.setData({ loading: true, errorText: '' })
    try {
      let res = await getSpaceNoticeEntry({ entryKey, ll2Id })
      if (!res || !res.success) {
        try {
          await syncSpaceNotices()
          res = await getSpaceNoticeEntry({ entryKey, ll2Id })
        } catch (e) { /* keep first error */ }
      }
      if (!res || !res.success) {
        const err = (res && res.error) || '加载失败，请先部署云函数 spaceNotices'
        const missing = err === 'not_found'
        this.setData({
          loading: false,
          errorText: missing
            ? (isChineseCollectionKey(entryKey)
              ? '暂未入库中国通告，请稍后重试或先部署云函数 spaceNotices'
              : '未找到该任务通告，请先在列表页同步')
            : err
        })
        return
      }
      this._entry = res.entry
      this._notices = res.notices || []
      const chinaCollection = isChineseCollectionKey((res.entry && res.entry.entryKey) || entryKey)
      this._decorated = sortNotices(this._notices.map((n) => {
        const row = decorateNotice(n, hasGeometry)
        if (chinaCollection) row.inChina = true
        return row
      }))
      const entry = res.entry || {}
      const display = decorateSpaceNoticeEntry(
        Object.assign({}, entry, {
          missionName: entry.missionName || entry.siteTitle || '',
          rocketName: entry.rocketName || ''
        })
      )
      this._display = display
      const traj = resolveTrajectory(entry)
      const hasTrajectory = !!(traj && traj.length >= 2)
      this.setData({
        loading: false,
        errorText: '',
        entryKey: entry.entryKey || entryKey || '',
        ll2Id: entry.ll2Id || ll2Id || '',
        title: display.title || '通告地图',
        subtitle: display.subtitle || entry.rocketName || '',
        padName: (entry.pad && entry.pad.name) || '',
        netText: entry.net ? formatDate(new Date(entry.net), 'MM-DD HH:mm') : '',
        stats: buildStats(this._decorated),
        hasTrajectory,
        chinaView: chinaCollection,
        chinaOnly: chinaCollection,
        // 无轨迹时强制关掉，避免空 chip 被点开
        showCorridor: hasTrajectory ? this.data.showCorridor : false
      })
      this.refreshVisible({ refit: true })
    } catch (e) {
      this.setData({
        loading: false,
        errorText: '加载失败：' + ((e && e.message) || '网络错误')
      })
    }
  },

  retryLoad() {
    this.loadEntry(this.data.entryKey, this.data.ll2Id)
  },

  visibleNotices() {
    return (this._decorated || []).filter(
      (n) => noticeStatusVisible(n, this.data) && noticeChinaVisible(n, this.data)
    )
  },

  /**
   * 按状态开关刷新列表与地图。stats 始终按全量通告计数，chip 数字不随筛选消失。
   */
  refreshVisible(opts) {
    const notices = this.visibleNotices()
    const selectedKey = this.data.selectedKey
    const keep = !!(selectedKey && notices.some((n) => n.noticeKey === selectedKey))
    this.setData({
      notices,
      selectedKey: keep ? selectedKey : '',
      selectedNotice: keep ? this.data.selectedNotice : null
    }, () => this.applyLayers({ refit: !opts || opts.refit !== false }))
  },

  /**
   * @param {{ refit?: boolean }} [opts] refit=false 时保留用户当前缩放（仅重画图层）
   */
  applyLayers(opts) {
    const refit = !opts || opts.refit !== false
    const enabledTypes = {
      NOTAM: !!this.data.showNotam,
      TFR: !!this.data.showNotam,
      ADP_LINK_FILE: !!this.data.showCorridor,
      NAVWARNING: !!this.data.showNav,
      BNM: !!this.data.showNav,
      LNM: !!this.data.showNav
    }
    const chinaOnly = !!(this.data.chinaView || this.data.chinaOnly)
    const styleOpts = { light: !!this.data.themeLight, selectedKey: this.data.selectedKey || '' }
    const source = this.visibleNotices()
    const polygons = buildPolygonsFromNotices(source, enabledTypes, styleOpts)
    const polylines = buildPolylinesFromNotices(source, enabledTypes, styleOpts)
    if (this.data.showCorridor && this.data.hasTrajectory && !chinaOnly) {
      const traj = buildTrajectoryPolyline(
        resolveTrajectory(this._entry),
        (this._entry && this._entry.trajectoryColor) || undefined
      )
      if (traj) polylines.unshift(traj)
    }
    // 与星舰同链路：先建图层，再解析有效红色坐标（缺 pad 时用通告密度中心兜底）
    const pad = resolveEffectivePad(this._entry, polygons, polylines)
    const padOk = !!(pad && (!chinaOnly || isChinaPad(pad)))
    const markerTitle =
      (this._display && this._display.title) || spaceNoticeDisplayTitle(this._entry)
    const markers = this.data.showPad && padOk
      ? buildPadMarker(pad, markerTitle, { light: !!this.data.themeLight })
      : []
    const next = { polygons, polylines, markers }
    if (pad && pad.name && !this.data.padName) {
      next.padName = pad.name
    }
    if (refit) {
      const hasShape =
        polygons.length > 0 ||
        polylines.some((l) => l && Array.isArray(l.points) && l.points.length >= 2)
      if (chinaOnly && !hasShape) {
        next.latitude = CHINA_OVERVIEW.latitude
        next.longitude = CHINA_OVERVIEW.longitude
        next.scale = CHINA_OVERVIEW.scale
        next.includePoints = []
      } else {
        const center = fitCenter(chinaOnly ? (padOk ? pad : null) : pad, polygons, polylines, {
          region: chinaOnly ? 'global' : (this.data.mapRegion || 'global')
        })
        next.includePoints = center.includePoints || []
        next.latitude = center.latitude
        next.longitude = center.longitude
        next.scale = center.scale
      }
    }
    this.setData(next)
  },

  toggleLayer(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    if (key === 'showCorridor' && !this.data.hasTrajectory) return
    const statusKey = key === 'showLive' || key === 'showSoon' || key === 'showEnded' || key === 'showCancelled'
    if (key === 'chinaOnly') {
      this.toggleChinaView()
      return
    }
    this.setData({ [key]: !this.data[key] }, () => {
      if (statusKey) this.refreshVisible({ refit: false })
      else this.applyLayers({ refit: false })
    })
  },

  /**
   * 右上角「中国」：加载官网 collection-chinese-unknown，而不是在当前星舰任务里筛 0 条。
   * 再点一次回到进入前的任务。
   */
  toggleChinaView() {
    if (this.data.loading) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    const turningOn = !this.data.chinaView
    if (turningOn) {
      if (isChineseCollectionKey(this.data.entryKey)) {
        this.setData({ chinaView: true, chinaOnly: true }, () => this.refreshVisible({ refit: true }))
        return
      }
      this._prevMission = { entryKey: this.data.entryKey || '', ll2Id: this.data.ll2Id || '' }
      this.setData({ chinaView: true, chinaOnly: true })
      this.loadEntry(CHINESE_COLLECTION_KEY, '')
      return
    }
    const prev = this._prevMission || {}
    this.setData({ chinaView: false, chinaOnly: false })
    if ((prev.entryKey || prev.ll2Id) && !isChineseCollectionKey(prev.entryKey)) {
      this.loadEntry(prev.entryKey, prev.ll2Id)
      return
    }
    this.refreshVisible({ refit: true })
  },

  setMapRegion(e) {
    const region = e.currentTarget.dataset.region
    if (!region || region === this.data.mapRegion) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    this.setData({ mapRegion: region }, () => this.applyLayers({ refit: true }))
  },

  togglePanel() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed })
  },

  toggleActionMenuCollapsed() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  setMapSatellite(e) {
    setMapSatelliteFromTap(this, e)
  },

  resetView() {
    this.setData({ selectedKey: '', selectedNotice: null }, () => this.applyLayers({ refit: true }))
  },

  selectNotice(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const notice = (this._decorated || []).find((n) => n.noticeKey === key)
    if (!notice) return
    this.setData({ selectedKey: key, selectedNotice: notice }, () => {
      this.applyLayers({ refit: false })
      const fit = fitNotice(notice)
      if (fit) {
        this.setData({
          latitude: fit.latitude,
          longitude: fit.longitude,
          scale: fit.scale,
          includePoints: fit.includePoints
        })
      } else {
        wx.showToast({ title: '该通告无坐标图形', icon: 'none' })
      }
    })
  },

  closeDetail() {
    this.setData({ selectedNotice: null, selectedKey: '' }, () => this.applyLayers({ refit: false }))
  },

  minimizeDetail() {
    this.setData({ selectedNotice: null })
  },

  copyRawText() {
    const n = this.data.selectedNotice
    const text = (n && n.rawText) || ''
    if (!text) {
      wx.showToast({ title: '该通告无原文', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: text })
  },

  copySourceLink() {
    const n = this.data.selectedNotice
    const link = (n && n.sourceLink) || ''
    if (!link) {
      wx.showToast({ title: '暂无来源链接', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: link })
  },

  noop() {},

  _shareTitle() {
    const title = this.data.title || '发射通告地图'
    const detail = this.data.subtitle || this.data.padName
    const live = this.data.stats && this.data.stats.live
    const soon = this.data.stats && this.data.stats.soon
    if (live && soon) return `${title} · ${live} 条生效 · ${soon} 条提前预警`
    if (live) return `${title} · ${live} 条通告生效中`
    if (soon) return `${title} · ${soon} 条提前预警`
    return detail ? `${title} · ${detail}` : title
  },

  onShareAppMessage() {
    const key = this.data.entryKey
    const base = key
      ? buildUrl(ROUTES.SPACE_NOTICE_MAP, { entryKey: key })
      : this.data.ll2Id
        ? buildUrl(ROUTES.SPACE_NOTICE_MAP, { ll2Id: this.data.ll2Id })
        : ROUTES.SPACE_NOTICE_LIST
    return {
      title: this._shareTitle(),
      path: withShareStampPath(base, this)
    }
  },

  onShareTimeline() {
    const key = this.data.entryKey
    const query = key
      ? 'entryKey=' + encodeURIComponent(key)
      : this.data.ll2Id
        ? 'll2Id=' + encodeURIComponent(this.data.ll2Id)
        : ''
    return {
      title: this._shareTitle(),
      query: withShareStampQuery(query, this)
    }
  }
})
