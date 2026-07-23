const { formatMapUpdateTime, buildMapStatePatch, createMapBaseState, findItemById, buildMapLayoutData, buildMapPanelScrollLayout, buildMapShareOptions, copyMapText, runMapRefresh } = require('./utils/map-page-common.js')
const { getRoadClosureNotice } = require('./utils/api-road-closure.js')
const { ROAD_CLOSURE_SCENE } = require('./utils/map-scenes.js')
const { resolveRoadClosureStatus } = require('../../utils/progress-road-closure.js')
const { applyStarbaseI18n, translateMayorOrderBody } = require('./utils/starbase-i18n.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../utils/theme.js')

Page({
  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    statusBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    latitude: ROAD_CLOSURE_SCENE.center.latitude,
    longitude: ROAD_CLOSURE_SCENE.center.longitude,
    scale: 13,
    markers: ROAD_CLOSURE_SCENE.markers,
    polylines: ROAD_CLOSURE_SCENE.polylines,
    polygons: ROAD_CLOSURE_SCENE.polygons,
    summary: '封闭区主要集中在检查点至发射区沿线，适合与通知时间联合查看。',
    source: '',
    schedule: [],
    delays: [],
    statusLabel: '待同步',
    timelineItems: [],
    panelCollapsed: true,
    panelMaxHeight: 0,
    panelScrollHeight: 320,
    panelExpandedStyle: '',
    actionMenuCollapsed: true,
    ...createMapBaseState({
      dataSourceText: 'road_closure_notice 云数据库',
      dataUpdatedText: '待更新',
      analyticsScene: 'road-closure-map',
      shareTitle: '封路地图'
    }),
    selectedMarkerId: 0
  },

  onLoad(options) {
    const app = getApp()
    const message = options.message ? decodeURIComponent(options.message) : ''
    const timeRange = options.timeRange ? decodeURIComponent(options.timeRange) : ''
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    this.setData({
      ...buildMapLayoutData(app),
      ...buildMapPanelScrollLayout(app, { chromeRpx: 120 }),
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync(),
      isDirectEntry: pages.length <= 1,
      message,
      timeRange
    })
    this.loadLiveRoadClosure()
  },


  buildTimelineItems(data, schedule, delays) {
    const list = []
    if (data && data.message) list.push({ label: '通知', value: data.message })
    if (data && Array.isArray(data.publicOrders)) {
      data.publicOrders.forEach((order) => {
        const body = order.bodyTextZh || translateMayorOrderBody(order.bodyText || '')
        if (body) {
          list.push({
            label: applyStarbaseI18n(order.orderNo || '市长令'),
            value: body
          })
        }
      })
    }
    schedule.forEach((item) => list.push({ label: '封闭时段', value: item }))
    delays.forEach((item) => list.push({ label: '道路提醒', value: item }))
    return list.slice(0, 8)
  },

  async loadLiveRoadClosure() {
    this.setData(buildMapStatePatch({ loading: true, errorText: '', emptyText: '' }))
    try {
      const data = await getRoadClosureNotice()
      const status = resolveRoadClosureStatus(data)
      if (status !== 'active') {
        const emptyText = status === 'error' ? '封路数据获取失败，请稍后重试' : '当前暂无封路通知'
        this.setData({ statusLabel: status === 'error' ? '状态同步失败' : '当前未封路', timelineItems: [], schedule: [], delays: [], ...buildMapStatePatch({ loading: false, emptyText }) })
        return
      }
      const schedule = Array.isArray(data.beachClosureSchedule) ? data.beachClosureSchedule : []
      const delays = Array.isArray(data.roadDelays) ? data.roadDelays : []
      const sourceLabelMap = {
        manual: '管理员录入',
        spacedevs: 'SpaceDevs',
        starbase_gov: 'Starbase.gov'
      }
      const timelineItems = this.buildTimelineItems(data, schedule, delays)
      this.setData({
        message: this.data.message || data.message || '',
        timeRange: this.data.timeRange || data.timeRange || '',
        source: sourceLabelMap[data.source] || data.source || '',
        schedule,
        delays,
        timelineItems,
        statusLabel: '封路生效中',
        dataUpdatedText: formatMapUpdateTime(new Date()),
        loading: false,
        summary: schedule.length ? `当前封路时段 ${schedule[0]}` : (data.message || this.data.summary)
      })
    } catch (e) {
      this.setData({ statusLabel: '状态同步失败', ...buildMapStatePatch({ loading: false, errorText: '封路数据加载失败' }) })
      throw e
    }
  },

  onMarkerTap(e) {
    const markerId = Number((e && e.detail && e.detail.markerId) || 0)
    const marker = findItemById(this.data.markers, markerId)
    if (!marker) return
    const content = marker.callout && marker.callout.content ? marker.callout.content : ''
    this.setData({
      selectedMarkerId: markerId,
      summary: content ? `当前选中：${content}` : this.data.summary,
      latitude: marker.latitude,
      longitude: marker.longitude
    })
  },

  async refreshMapData() {
    await runMapRefresh(this, async () => {
      await this.loadLiveRoadClosure()
    })
  },

  resetMapView() {
    this.setData({
      latitude: ROAD_CLOSURE_SCENE.center.latitude,
      longitude: ROAD_CLOSURE_SCENE.center.longitude,
      scale: 13
    })
  },

  copySummary() {
    copyMapText(
      `状态：${this.data.statusLabel || '-'}\n摘要：${this.data.summary || '-'}\n通知：${this.data.message || '暂无'}\n时间范围：${this.data.timeRange || '暂无'}\n来源：${this.data.source || this.data.dataSourceText || '-'}`,
      '封路信息已复制'
    )
  },

  resolvePanelScrollHeight() {
    const panelMaxHeight = Number(this.data.panelMaxHeight) || 0
    if (!panelMaxHeight) return this.data.panelScrollHeight || 320
    const app = getApp()
    const layout = buildMapPanelScrollLayout(app, { chromeRpx: 120 })
    const stateExtraPx = (this.data.loading || this.data.errorText || this.data.emptyText) ? 96 : 0
    return Math.max(160, layout.panelScrollHeight - stateExtraPx)
  },

  togglePanelCollapsed() {
    const panelCollapsed = !this.data.panelCollapsed
    const patch = { panelCollapsed }
    if (!panelCollapsed) {
      patch.panelScrollHeight = this.resolvePanelScrollHeight()
    }
    this.setData(patch)
  },

  toggleActionMenuCollapsed() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  onShareAppMessage() {
    return buildMapShareOptions({
      shareTitle: this.data.shareTitle,
      detailText: this.data.statusLabel,
      fallbackDetailText: '状态',
      path: '/subpackages/progress-extra/road-closure-map'
    })
  },

  /**
   * 返回按钮兜底逻辑：
   * 1) 正常导航栈（>1 页）→ navigateBack
   * 2) 通过分享卡片冷启动进入（栈只有 1 页）→ switchTab 到「星舰进度」TabBar
   * 3) 极端情况下 switchTab 仍失败 → reLaunch 兜底
   * 这样无论从哪种入口进来，左上角返回按钮都不会出现「无反应」。
   */
  goBack() {
    const FALLBACK_TAB = '/pages/progress/progress'
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []

    // wx.reLaunch 不支持 tabBar 页面，所以用 setTimeout + 再试 switchTab 兜底
    const retrySwitch = () => {
      setTimeout(() => {
        wx.switchTab({
          url: FALLBACK_TAB,
          fail: () => {
            try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
          }
        })
      }, 50)
    }

    if (pages.length > 1) {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({ url: FALLBACK_TAB, fail: retrySwitch })
        }
      })
      return
    }
    wx.switchTab({ url: FALLBACK_TAB, fail: retrySwitch })
  }
})
