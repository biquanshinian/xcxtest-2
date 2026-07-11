/**
 * 页面公共 Behavior —— 消除 16+ 页面中重复的 UI Shell / goBack / retryLoad / menuButton 逻辑
 *
 * 用法：
 *   const pageBase = require('../../utils/page-base.js')
 *   Page({
 *     behaviors: [pageBase],
 *     // 可选覆盖：
 *     _tabIndex: 0,           // Tab 页序号（非 Tab 页不设）
 *     _tabPath: '/pages/index/index',
 *     _fallbackTab: '/pages/index/index',  // goBack 兜底跳转
 *     ...
 *   })
 */
const { getUiShellLayout } = require('./layout.js')
const { getSystemInfo } = require('./system.js')
const theme = require('./theme.js')

module.exports = Behavior({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    isDirectEntry: false,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000'
  },

  methods: {
    /**
     * 同步当前主题到页面（onLoad 由 initUiShell 自动完成；
     * setTheme() 会遍历在栈页面即时刷新，一般无需手动调用）
     */
    syncTheme() {
      theme.applyThemeToPage(this)
    },

    /**
     * 初始化 UI Shell 布局（导航栏高度、TabBar 占位等）
     * 页面 onLoad 中调用一次即可
     */
    initUiShell() {
      const app = getApp()
      const layout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
      const update = {
        statusBarHeight: layout.statusBarHeight,
        navPlaceholderHeight: layout.navPlaceholderHeight,
        tabBarReservedHeight: layout.tabBarReservedHeight
      }

      let menuButtonWidth = 88
      try {
        const rect = wx.getMenuButtonBoundingClientRect()
        if (rect && rect.width) {
          menuButtonWidth = Math.max(88, Math.ceil(rect.width + 24))
        }
      } catch (_) {}
      update.menuButtonWidth = menuButtonWidth

      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      update.isDirectEntry = pages.length <= 1

      // 主题注入：根 view 绑定 class="{{themeClass}}" 即可获得浅色变量覆盖
      update.themeClass = theme.getThemeClassSync()
      update.themeLight = theme.isLightSync()
      update.pageBgColor = theme.getPageBgSync()

      this.setData(update)
      return layout
    },

    /**
     * 设置 TabBar 选中态（仅 Tab 页使用）
     * @param {number} index  Tab 序号 0-4
     * @param {string} path   当前页面路径
     */
    selectTab(index, path) {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ selected: index, currentPath: path })
      }
    },

    /**
     * 在 onShow 中同步 TabBar 选中态 + progressDot
     */
    syncTab(index, path) {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ selected: index, currentPath: path })
        getApp().checkProgressDot(this.getTabBar())
      }
    },

    /**
     * 通用返回：有上一页则 navigateBack，否则 switchTab 到兜底页
     * 多重兜底：navigateBack 失败 → switchTab；switchTab 失败 → 再试 switchTab 首页 → reLaunch 首页
     * 解决「分享卡片冷启动进入子页面后返回按钮无反应」类问题。
     *
     * 关键：wx.reLaunch 不支持 tabBar 页面，所以兜底要先尝试 switchTab，
     * 只有在绝对非 tabBar 路径时才用 reLaunch。
     * @param {string} [fallbackTab]  兜底 Tab 路径，默认 '/pages/index/index'
     */
    goBack(fallbackTab) {
      const tab = fallbackTab || this._fallbackTab || '/pages/index/index'
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []

      // 首页始终可以作为最终兜底（switchTab 到 tabBar 根页）
      const HOME = '/pages/index/index'

      const forceHome = () => {
        // 最后的兜底链：switchTab 首页 → reLaunch 首页非 tabBar 路径
        wx.switchTab({
          url: HOME,
          fail: () => {
            // 极少数情况 tabBar 未初始化：用 reLaunch 到非 tabBar 子页兜底
            // 这里选 mission-detail 根路径会 404，所以降级为重启小程序到首页
            wx.reLaunch({ url: HOME, fail: () => {
              // 连 reLaunch 都失败（通常不会发生）给用户兜底提示
              try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
            } })
          }
        })
      }

      const switchToTab = () => {
        wx.switchTab({
          url: tab,
          fail: (err) => {
            // switchTab 失败常见原因：
            //   1. tab 不在 tabBar 列表里（配置错误）
            //   2. tabBar 页未初始化完成（冷启动早期）
            //   3. 当前正处于某种过渡态
            // 统一兜底到首页 tabBar
            forceHome()
          }
        })
      }

      // Tab 页面路径集合（navigateBack 到 Tab 页会报错，需用 switchTab）
      const TAB_PAGES = ['/pages/index/index', '/pages/monitor/monitor', '/pages/progress/progress', '/pages/news/news', '/pages/profile/profile']

      if (pages.length > 1) {
        // 检查上一页是否为 Tab 页面
        const prevPage = pages[pages.length - 2]
        const prevRoute = prevPage ? ('/' + (prevPage.route || '')) : ''
        if (TAB_PAGES.indexOf(prevRoute) !== -1) {
          wx.switchTab({ url: prevRoute, fail: forceHome })
          return
        }
        wx.navigateBack({
          fail: switchToTab
        })
        return
      }
      switchToTab()
    },

    /**
     * 通用重试加载：从当前页面 options 取 id，调用 this.loadDetail(id)
     */
    retryLoad() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const options = (current && current.options) || {}
      const id = options.id ? String(options.id).trim() : ''
      if (!id) return
      if (typeof this.loadDetail === 'function') {
        this.loadDetail(id)
      }
    }
  }
})
