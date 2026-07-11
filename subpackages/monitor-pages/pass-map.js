const pageBase = require('../../utils/page-base.js')
const { formatMapUpdateTime, buildMapStatePatch, createMapBaseState, findItemById, buildMapLayoutData, buildSelectionPatch, buildMapOverlayTopStyle, buildMapShareOptions, copyMapText, runMapRefresh } = require('./utils/map-page-common.js')
const { buildObservationCandidates, getPassQualityMeta } = require('./utils/map-scenes.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    summaryCardTopStyle: 'top: 158px;',
    latitude: 39.9,
    longitude: 116.4,
    scale: 12,
    mapMarkers: [],
    mapPolylines: [],
    selectedPass: null,
    locationText: '',
    candidatePoints: [],
    selectedCandidateId: 0,
    hasLocation: false,
    passOptions: [],
    selectedPassIdx: 0,
    selectedCandidate: null,
    qualityMeta: { level: '普通', color: '#8E8E93', advice: '', trainLabel: '' },
    summaryTips: [],
    introText: '优先选择开阔、低光污染区域，建议在过境开始前 10 分钟抵达。',
    summaryCollapsed: true,
    candidateSheetCollapsed: true,
    actionMenuCollapsed: true,
    ...createMapBaseState({
      dataSourceText: 'Starlink TLE + 本地过境预测',
      dataUpdatedText: '刚刚更新',
      loading: true,
      analyticsScene: 'pass-map',
      shareTitle: '星链观测地图'
    })
  },

  onLoad(options) {
    this.initUiShell()
    const app = getApp()
    const selectedPass = this.parsePass(options)
    const passOptions = this.parsePassList(options, selectedPass)
    if (!passOptions.length) {
      this.setData(buildMapStatePatch({ loading: false, emptyText: '暂无可展示的过境记录' }))
    }
    const latitude = Number(options.lat)
    const longitude = Number(options.lng)
    const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
    this._observer = {
      latitude: hasLocation ? latitude : 39.9,
      longitude: hasLocation ? longitude : 116.4
    }

    const layoutData = buildMapLayoutData(app, { includeNavPlaceholder: true, includeTabBarReserved: true })
    this.setData({
      ...layoutData,
      summaryCardTopStyle: buildMapOverlayTopStyle(layoutData.mapActionTop, { collapsed: true }),
      locationText: options.locationText ? decodeURIComponent(options.locationText) : `${this._observer.latitude.toFixed(2)}°, ${this._observer.longitude.toFixed(2)}°`,
      hasLocation,
      passOptions,
      dataUpdatedText: formatMapUpdateTime(new Date(), '刚刚更新')
    })

    this.applyPassSelection(passOptions[0] || selectedPass, 0)
  },


  parsePass(options) {
    return {
      startTimeStr: decodeURIComponent(options.startTimeStr || '今晚可见'),
      maxElev: Number(options.maxElev || 45),
      startDirection: decodeURIComponent(options.startDirection || 'W'),
      endDirection: decodeURIComponent(options.endDirection || 'E'),
      durationMin: Number(options.durationMin || 5),
      brightnessText: decodeURIComponent(options.brightnessText || 'medium'),
      trainCount: Number(options.trainCount || 1)
    }
  },

  parsePassList(options, fallbackPass) {
    try {
      const raw = options.passList ? JSON.parse(decodeURIComponent(options.passList)) : []
      if (Array.isArray(raw) && raw.length) return raw
    } catch (e) {}
    return [fallbackPass]
  },

  applyPassSelection(pass, index) {
    const selectedPass = pass || {}
    const candidatePoints = buildObservationCandidates(this._observer, selectedPass)
    const mapMarkers = this.buildMarkers(this._observer, candidatePoints)
    const mapPolylines = this.buildPolylines(this._observer, candidatePoints)
    const qualityMeta = getPassQualityMeta(selectedPass)
    const selectedCandidate = candidatePoints[0] || null
    const summaryTips = [
      qualityMeta.trainLabel,
      selectedPass.maxElev >= 55 ? '高仰角' : '中低仰角',
      selectedPass.durationMin >= 6 ? '观测窗口较长' : '建议快速站位',
      this.data.hasLocation ? '已绑定当前位置' : '未获取精确位置'
    ]
    this.setData({
      latitude: this._observer.latitude,
      longitude: this._observer.longitude,
      selectedPass,
      selectedPassIdx: index,
      candidatePoints,
      selectedCandidate,
      selectedCandidateId: selectedCandidate ? selectedCandidate.id : 0,
      mapMarkers,
      mapPolylines,
      qualityMeta,
      summaryTips,
      introText: qualityMeta.advice,
      ...buildMapStatePatch({ loading: false, emptyText: candidatePoints.length ? '' : '暂无推荐观测点', errorText: '' })
    })
  },

  buildMarkers(observer, candidates) {
    const markers = [
      {
        id: 1,
        latitude: observer.latitude,
        longitude: observer.longitude,
        width: 28,
        height: 28,
        callout: {
          content: '你的位置',
          color: '#FFFFFF',
          fontSize: 12,
          borderRadius: 12,
          bgColor: '#0A84FF',
          padding: 8,
          display: 'ALWAYS'
        }
      }
    ]

    candidates.forEach((item, index) => {
      markers.push({
        id: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        width: index === 0 ? 32 : 26,
        height: index === 0 ? 32 : 26,
        callout: {
          content: item.title,
          color: '#FFFFFF',
          fontSize: 12,
          borderRadius: 12,
          bgColor: index === 0 ? '#34C759' : '#8E8E93',
          padding: 8,
          display: index === 0 ? 'ALWAYS' : 'BYCLICK'
        }
      })
    })

    return markers
  },

  buildPolylines(observer, candidates) {
    if (!candidates.length) return []
    return [
      {
        points: [
          { latitude: observer.latitude, longitude: observer.longitude },
          { latitude: candidates[0].latitude, longitude: candidates[0].longitude }
        ],
        color: '#34C759CC',
        width: 6,
        arrowLine: true,
        dottedLine: false
      },
      {
        points: candidates.map((item) => ({ latitude: item.latitude, longitude: item.longitude })),
        color: '#64D2FFAA',
        width: 4,
        dottedLine: true,
        arrowLine: false
      }
    ]
  },

  onPassOptionTap(e) {
    const idx = Number(e.currentTarget.dataset.idx || 0)
    const pass = (this.data.passOptions || [])[idx]
    if (!pass) return
    this.applyPassSelection(pass, idx)
  },

  onCandidateTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.selectCandidateById(id)
  },

  selectCandidateById(id) {
    const patch = buildSelectionPatch({
      list: this.data.candidatePoints,
      id,
      selectedKey: 'selectedCandidate',
      extra: { selectedCandidateId: id }
    })
    if (!patch) return
    this.setData(patch)
  },

  onMarkerTap(e) {
    const markerId = Number((e && e.detail && e.detail.markerId) || 0)
    if (markerId >= 300) {
      this.selectCandidateById(markerId)
    }
  },

  openNavigation() {
    const current = findItemById(this.data.candidatePoints, this.data.selectedCandidateId) || this.data.candidatePoints[0]
    if (!current) return
    wx.openLocation({
      latitude: current.latitude,
      longitude: current.longitude,
      name: current.title,
      address: `${current.reason} · ${current.etaText}`,
      scale: 16
    })
  },

  previewPassTips() {
    const pass = this.data.selectedPass || {}
    wx.showModal({
      title: '观测建议',
      content: `建议朝 ${pass.startDirection || '东'} → ${pass.endDirection || '西'} 方向观察，最高仰角约 ${pass.maxElev || 45}°，过境持续 ${pass.durationMin || 5} 分钟。${this.data.qualityMeta && this.data.qualityMeta.trainLabel ? ' 当前为' + this.data.qualityMeta.trainLabel + '。' : ''}`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async refreshMapData() {
    await runMapRefresh(this, async () => {
      const selectedPass = (this.data.passOptions || [])[this.data.selectedPassIdx] || this.data.selectedPass || {}
      this.setData(buildMapStatePatch({ loading: true, errorText: '', emptyText: '' }))
      this.applyPassSelection(selectedPass, this.data.selectedPassIdx || 0)
      this.setData({ dataUpdatedText: formatMapUpdateTime(new Date(), '刚刚更新') })
    })
  },

  resetMapView() {
    this.setData({
      latitude: this._observer.latitude,
      longitude: this._observer.longitude,
      scale: 12
    })
  },

  copySummary() {
    const pass = this.data.selectedPass || {}
    const candidate = this.data.selectedCandidate || {}
    copyMapText(
      `观测窗口：${pass.startTimeStr || '今晚可见'}\n方向：${pass.startDirection || '-'} → ${pass.endDirection || '-'}\n最高仰角：${pass.maxElev || '-'}°\n推荐观测点：${candidate.title || '暂无'}\n位置：${this.data.locationText || '-'}`,
      '观测信息已复制'
    )
  },

  toggleSummaryCollapsed() {
    this.setData({ summaryCollapsed: !this.data.summaryCollapsed })
  },

  toggleCandidateSheetCollapsed() {
    this.setData({ candidateSheetCollapsed: !this.data.candidateSheetCollapsed })
  },

  toggleActionMenuCollapsed() {
    const nextCollapsed = !this.data.actionMenuCollapsed
    this.setData({
      actionMenuCollapsed: nextCollapsed,
      summaryCardTopStyle: buildMapOverlayTopStyle(this.data.mapActionTop, { collapsed: nextCollapsed })
    })
  },


  onShareAppMessage() {
    const pass = this.data.selectedPass || {}
    return buildMapShareOptions({
      shareTitle: this.data.shareTitle,
      detailText: pass.startTimeStr,
      fallbackDetailText: '今晚可见',
      path: '/subpackages/monitor-pages/pass-map'
    })
  },

  // goBack inherited from pageBase
})
