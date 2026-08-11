const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    aboutText: '太空爱好者小程序，bug 比火箭发射还准时。没有团队，有问题欢迎加微信吐槽，没问题也欢迎来聊。',
    aboutWechat: 'huyuzecoin'
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
    this._loadAbout()
  },

  _loadAbout() {
    if (!wx.cloud || !wx.cloud.callFunction) return
    wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: '/about-config', method: 'GET' }
    }).then((res) => {
      const data = res.result && res.result.data
      if (!data) return
      const patch = {}
      if (data.aboutText) patch.aboutText = data.aboutText
      if (data.aboutWechat) patch.aboutWechat = data.aboutWechat
      if (Object.keys(patch).length) this.setData(patch)
    }).catch(() => {})
  },

  onCopyWechat() {
    const data = String(this.data.aboutWechat || '')
    if (!data) return
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  onContactCallback(e) {
    const path = e && e.detail && e.detail.path
    if (!path) return
    try {
      wx.navigateTo({ url: path.startsWith('/') ? path : '/' + path })
    } catch (err) {}
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
