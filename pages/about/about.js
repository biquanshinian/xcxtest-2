// pages/about/about.js
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { applyPageSearchInfo } = require('./utils/page-search-info.js')
const theme = require('../../utils/theme.js')

const ABOUT_DESCRIPTION = '本小程序星舰基地监控预览为设计稿查看工具，仅提供 MARS 设计稿的查看、移动、放大功能，无任何编辑、修改、评论权限。所有展示内容均为合法设计作品，预览通过合规域名中转，不直连第三方编辑站点。'

Page({
  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000'
  },

  async onLoad() {
    this.setData({
      themeClass: theme.getThemeClassSync(),
      themeLight: theme.isLightSync(),
      pageBgColor: theme.getPageBgSync()
    })
    await loadCloudMediaMap().catch(() => {})
    applyPageSearchInfo({
      title: '关于本功能',
      description: ABOUT_DESCRIPTION,
      imageUrl: resolveMediaUrl('images/share/default.jpg', ''),
      path: '/pages/about/about'
    })
  }
})
