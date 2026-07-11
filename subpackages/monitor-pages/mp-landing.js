const config = require('../../utils/config.js')
const { ROUTES } = require('../../utils/routes.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const pageBase = require('../../utils/page-base.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    source: '监控中心入口',
    targetUrl: '',
    displayUrl: '',
    previewImage: ''
  },

  async onLoad(options = {}) {
    this.initUiShell()

    const fallbackUrl = 'https://www.marsx.com.cn/'
    const rawUrl = options.url ? decodeURIComponent(options.url) : (config.userWebPreviewUrl || fallbackUrl)
    const normalizedUrl = this.normalizeUrl(rawUrl)
    const source = options.source ? decodeURIComponent(options.source) : '监控中心入口'

    await loadCloudMediaMap()

    const previewImage = this.formatPreviewSrc(
      resolveMediaUrl('Figma网站静态预览图/Figma静态图.jpg', '')
    )

    this.setData({
      source,
      targetUrl: normalizedUrl,
      displayUrl: normalizedUrl.replace(/^https?:\/\//, ''),
      previewImage
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 1,
        currentPath: '/pages/monitor/monitor'
      })
    }
  },

  // goBack inherited from pageBase

  formatPreviewSrc(src) {
    if (!src || typeof src !== 'string') return ''
    const normalized = src.replace(/\\/g, '/')

    if (/^https?:\/\//i.test(normalized) || normalized.startsWith('wxfile://') || normalized.startsWith('cloud://')) {
      return normalized
    }

    return normalized.startsWith('/') ? normalized : `/${normalized}`
  },

  normalizeUrl(url) {
    const val = (url || '').trim()
    if (!val) return 'https://www.marsx.com.cn/'
    if (/^https?:\/\//i.test(val)) return val
    return `https://${val}`
  },

  onPreviewImageTap() {
    const url = this.data.targetUrl || 'https://www.marsx.com.cn/'
    wx.navigateTo({
      url: `${ROUTES.WEBVIEW}?url=${encodeURIComponent(url)}`,
      fail: () => {
        this.copyLinkAndGuide()
      }
    })
  },

  copyLinkOnly() {
    const url = this.data.targetUrl || 'https://www.marsx.com.cn/'
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({
          title: '地址已复制',
          icon: 'success',
          duration: 1800
        })
      },
      fail: () => {
        wx.showToast({
          title: '复制失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  copyLinkAndGuide() {
    const url = this.data.targetUrl || 'https://www.marsx.com.cn/'
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '地址已复制',
          content: `已复制：\n${url}\n\n请打开浏览器，粘贴访问完整版页面。`,
          showCancel: false,
          confirmText: '我知道了'
        })
      },
      fail: () => {
        wx.showToast({
          title: '复制失败，请重试',
          icon: 'none'
        })
      }
    })
  }
})
