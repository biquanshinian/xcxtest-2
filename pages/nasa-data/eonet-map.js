const { buildMapLayoutData } = require('./utils/map-page-common.js')
const pageBase = require('../../utils/page-base.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    latitude: 0,
    longitude: 0,
    scale: 6,
    markers: [],
    title: '',
    category: '',
    date: '',
    magnitude: '',
    status: '',
    isOpen: true,
    statusBarHeight: 44,
    mapActionTop: 0
  },

  onLoad(options) {
    this.initUiShell()
    const layout = buildMapLayoutData(getApp())
    this.setData({
      mapActionTop: layout.mapActionTop
    })

    const lat = parseFloat(options.lat) || 0
    const lng = parseFloat(options.lng) || 0
    const title = decodeURIComponent(options.title || '')
    const category = decodeURIComponent(options.category || '')
    const date = decodeURIComponent(options.date || '')
    const magnitude = decodeURIComponent(options.magnitude || '')
    const status = decodeURIComponent(options.status || '')

    const markers = [{
      id: 1,
      latitude: lat,
      longitude: lng,
      width: 32,
      height: 32,
      callout: {
        content: title || '事件位置',
        color: '#FFFFFF',
        fontSize: 13,
        borderRadius: 12,
        bgColor: '#FF6B35',
        padding: 10,
        display: 'ALWAYS'
      }
    }]

    this.setData({
      latitude: lat,
      longitude: lng,
      scale: 8,
      markers,
      title,
      category,
      date,
      magnitude,
      status,
      isOpen: status === '活跃中'
    })
  },

  // goBack inherited from pageBase,

  copyCoords() {
    const { latitude, longitude } = this.data
    wx.setClipboardData({
      data: `${latitude}, ${longitude}`,
      success: () => wx.showToast({ title: '坐标已复制', icon: 'success' })
    })
  },

  onShareAppMessage() {
    return {
      title: `${this.data.title || '地球事件'} | NASA 数据中心 - 火星探索日志`,
      path: `/pages/nasa-data/eonet-map?lat=${this.data.latitude}&lng=${this.data.longitude}&title=${encodeURIComponent(this.data.title)}&category=${encodeURIComponent(this.data.category)}`
    }
  }
})
