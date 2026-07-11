// custom-tab-bar/index.js
const { getUiShellLayout } = require('../utils/layout.js')
const { getSystemInfo } = require('../utils/system.js')
const storageCache = require('../utils/storage-sync-cache.js')
const themeUtil = require('../utils/theme.js')

const STORAGE_SNOOZE_UNTIL = 'add_desktop_strip_snooze_until'
const STORAGE_GUIDE_IMAGE_PATH = 'add_desktop_guide_saved_path'

const DESKTOP_GUIDE_REMOTE_URL =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%BC%B9%E7%AA%97%E6%8C%87%E5%BC%95%E6%B7%BB%E5%8A%A0%E5%88%B0%E6%A1%8C%E9%9D%A2%E8%83%8C%E6%99%AF%E5%9B%BE/1779097001449_sxxnvx.png'

const SNOOZE_MS = 24 * 60 * 60 * 1000

const TAB_ROUTE_TO_INDEX = {
  'pages/index/index': 0,
  'pages/monitor/monitor': 1,
  'pages/progress/progress': 2,
  'pages/news/news': 3,
  'pages/profile/profile': 4
}

Component({
  data: {
    themeClass: '',
    selected: 0,
    /** 滑动 Tab 时临时高亮（>=0）；未滑动时为 -1，沿用 selected */
    dragHighlightIndex: -1,
    currentPath: '/pages/index/index',
    color: '#8E8E93',
    selectedColor: '#FFFFFF',
    hidden: false,
    showProgressDot: false,
    showProfileDot: false,
    showNewsDot: false,
    showAddDesktopStrip: false,
    showDesktopGuideImage: false,
    navPlaceholderHeight: 0,
    desktopGuideDisplaySrc: '',
    desktopGuidePendingTempSave: false,
    desktopGuideTempPath: '',
    list: [
      {
        pagePath: '/pages/index/index',
        text: '主页',
        iconPath: '/images/tabbar/home.svg',
        selectedIconPath: '/images/tabbar/home-active.svg'
      },
      {
        pagePath: '/pages/monitor/monitor',
        text: '监控中心',
        iconPath: '/images/tabbar/monitor.svg',
        selectedIconPath: '/images/tabbar/monitor-active.svg'
      },
      {
        pagePath: '/pages/progress/progress',
        text: '星舰进度',
        iconPath: '/images/tabbar/starship.svg',
        selectedIconPath: '/images/tabbar/starship-active.svg'
      },
      {
        pagePath: '/pages/news/news',
        text: '事件',
        iconPath: '/images/tabbar/news.svg',
        selectedIconPath: '/images/tabbar/news-active.svg'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        iconPath: '/images/tabbar/profile.svg',
        selectedIconPath: '/images/tabbar/profile-active.svg'
      }
    ]
  },

  lifetimes: {
    // attached 的 setData 在首帧渲染前生效，选中态/横条显隐首帧即正确，无需隐藏-淡入机制
    attached() {
      const boot = this._collectBootPatch()
      this.setData(Object.assign({ dragHighlightIndex: -1 }, boot))
      this._refreshAddDesktopStripVisibility(true)
    }
  },

  pageLifetimes: {
    show() {
      const patch = this._collectBootPatch()
      this._setTabBarData(patch)
      this._refreshAddDesktopStripVisibility(true)
    }
  },

  methods: {
    _getAppSafe() {
      try {
        return getApp && getApp()
      } catch (_) {
        return null
      }
    },

    _patchAppCache(patch) {
      const app = this._getAppSafe()
      if (app && typeof app.patchTabBarUiCache === 'function') {
        app.patchTabBarUiCache(patch)
      }
    },

    _setTabBarData(patch) {
      if (!patch || typeof patch !== 'object') return
      this._patchAppCache(patch)
      this.setData(patch)
    },

    _resolveSelectedFromRoute() {
      try {
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
        const cur = pages && pages.length ? pages[pages.length - 1] : null
        const route = cur && cur.route ? cur.route : ''
        if (route && Object.prototype.hasOwnProperty.call(TAB_ROUTE_TO_INDEX, route)) {
          return {
            selected: TAB_ROUTE_TO_INDEX[route],
            currentPath: '/' + route
          }
        }
      } catch (_) {}
      const app = this._getAppSafe()
      const cache = app && app.globalData && app.globalData.tabBarUiCache
      if (cache && typeof cache.selected === 'number') {
        return {
          selected: cache.selected,
          currentPath: cache.currentPath || ''
        }
      }
      return { selected: 0, currentPath: '/pages/index/index' }
    },

    _readDesktopStripVisibleSync() {
      const app = this._getAppSafe()
      const cache = app && app.globalData && app.globalData.tabBarUiCache
      if (cache && typeof cache.showAddDesktopStrip === 'boolean' && storageCache.isLoaded(STORAGE_SNOOZE_UNTIL)) {
        return cache.showAddDesktopStrip
      }
      if (app && typeof app.readAddDesktopStripVisibleSync === 'function') {
        return app.readAddDesktopStripVisibleSync()
      }
      try {
        const snoozeUntil = Number(storageCache.readMemOrSync(STORAGE_SNOOZE_UNTIL, 0)) || 0
        return Date.now() >= snoozeUntil
      } catch (_) {
        return true
      }
    },

    _collectBootPatch() {
      const app = this._getAppSafe()
      const cache = app && typeof app.getTabBarUiCache === 'function' ? app.getTabBarUiCache() : null
      const routeSel = this._resolveSelectedFromRoute()
      let navPlaceholderHeight = 0
      try {
        const layout =
          (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
        navPlaceholderHeight = (layout && layout.navPlaceholderHeight) || 0
      } catch (_) {}

      const showAddDesktopStrip = cache && typeof cache.showAddDesktopStrip === 'boolean' && storageCache.isLoaded(STORAGE_SNOOZE_UNTIL)
        ? cache.showAddDesktopStrip
        : this._readDesktopStripVisibleSync()

      const onProgressTab = routeSel.currentPath === '/pages/progress/progress'

      return {
        themeClass: themeUtil.getThemeClassSync(),
        selected: routeSel.selected,
        currentPath: routeSel.currentPath,
        navPlaceholderHeight,
        showAddDesktopStrip,
        hidden: onProgressTab && cache ? !!cache.hidden : false,
        showProgressDot: cache ? !!cache.showProgressDot : false,
        showProfileDot: cache ? !!cache.showProfileDot : false,
        showNewsDot: cache ? !!cache.showNewsDot : false
      }
    },

    _syncLayoutMetrics() {
      try {
        const app = this._getAppSafe()
        const layout =
          (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
        const navPlaceholderHeight = layout.navPlaceholderHeight || 0
        this._setTabBarData({ navPlaceholderHeight })
      } catch (_) {
        this._setTabBarData({ navPlaceholderHeight: 0 })
      }
    },

    applyDesktopStripVisible(show) {
      const visible = !!show
      if (this.data.showAddDesktopStrip === visible) return
      this._setTabBarData({ showAddDesktopStrip: visible })
    },

    _refreshAddDesktopStripVisibility(preferSync) {
      if (preferSync) {
        const show = this._readDesktopStripVisibleSync()
        this.applyDesktopStripVisible(show)
        return
      }
      wx.getStorage({
        key: STORAGE_SNOOZE_UNTIL,
        success: (res) => {
          const snoozeUntil = Number(res.data) || 0
          this.applyDesktopStripVisible(Date.now() >= snoozeUntil)
        },
        fail: () => {
          this.applyDesktopStripVisible(true)
        }
      })
    },

    /** 供 App 与各 Tab onShow 调用：按本地存储统一刷新横条显隐 */
    syncDesktopStripFromStorage() {
      this._refreshAddDesktopStripVisibility(true)
    },

    /** 供 utils/theme.js setTheme() 调用：即时刷新 TabBar 主题 */
    applyTheme() {
      const cls = themeUtil.getThemeClassSync()
      if (this.data.themeClass !== cls) {
        this.setData({ themeClass: cls })
      }
    },

    onAddDesktopStripClose() {
      try { wx.vibrateShort({ type: 'medium' }) } catch (_) {}
      const app = this._getAppSafe()
      if (app && typeof app.snoozeAddDesktopStrip === 'function') {
        app.snoozeAddDesktopStrip(SNOOZE_MS)
      } else {
        try {
          storageCache.persistSync(STORAGE_SNOOZE_UNTIL, Date.now() + SNOOZE_MS)
        } catch (_) {}
        this.applyDesktopStripVisible(false)
      }
      if (app && typeof app.syncAllTabBarsDesktopStrip === 'function') {
        app.syncAllTabBarsDesktopStrip()
      } else {
        this.syncDesktopStripFromStorage()
      }
    },

    onAddDesktopNow() {
      try { wx.vibrateShort({ type: 'medium' }) } catch (_) {}
      const fs = wx.getFileSystemManager()
      let saved = ''
      try {
        saved = wx.getStorageSync(STORAGE_GUIDE_IMAGE_PATH) || ''
      } catch (_) {}

      const openWithPath = (filePath, pendingTempSave, tempPath) => {
        this.setData({
          desktopGuideDisplaySrc: filePath,
          desktopGuidePendingTempSave: pendingTempSave,
          desktopGuideTempPath: tempPath || '',
          showDesktopGuideImage: true
        })
      }

      if (saved) {
        fs.access({
          path: saved,
          success: () => openWithPath(saved, false, ''),
          fail: () => this._downloadDesktopGuideThenShow(openWithPath)
        })
      } else {
        this._downloadDesktopGuideThenShow(openWithPath)
      }
    },

    _downloadDesktopGuideThenShow(openWithPath) {
      wx.downloadFile({
        url: DESKTOP_GUIDE_REMOTE_URL,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            wx.showToast({ title: '图片加载失败', icon: 'none' })
            return
          }
          openWithPath(res.tempFilePath, true, res.tempFilePath)
        },
        fail: () => wx.showToast({ title: '网络异常', icon: 'none' })
      })
    },

    onDesktopGuideImageLoaded() {
      if (!this.data.desktopGuidePendingTempSave || !this.data.desktopGuideTempPath) return

      const tempPath = this.data.desktopGuideTempPath
      wx.saveFile({
        tempFilePath: tempPath,
        success: (saveRes) => {
          try {
            wx.setStorageSync(STORAGE_GUIDE_IMAGE_PATH, saveRes.savedFilePath)
          } catch (_) {}
          this.setData({
            desktopGuideDisplaySrc: saveRes.savedFilePath,
            desktopGuidePendingTempSave: false,
            desktopGuideTempPath: ''
          })
        },
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
      })
    },

    closeDesktopGuideImage() {
      this.setData({
        showDesktopGuideImage: false,
        desktopGuidePendingTempSave: false,
        desktopGuideTempPath: ''
      })
    },

    _vibrateMedium() {
      try {
        if (typeof wx.vibrateShort === 'function') {
          wx.vibrateShort({ type: 'medium' })
        }
      } catch (_) {}
    },

    onDesktopGuideCloseButtonTap() {
      this._vibrateMedium()
      this.closeDesktopGuideImage()
    },

    _computeSwipeIndex(clientX) {
      const rect = this._tabBarContentRect
      if (!rect || typeof rect.left !== 'number' || !rect.width) return null
      const n = (this.data.list && this.data.list.length) || 0
      if (n <= 0) return null
      const x = clientX - rect.left
      let idx = Math.floor((x / rect.width) * n)
      if (idx < 0) idx = 0
      if (idx >= n) idx = n - 1
      return idx
    },

    _resetTabSwipeGestureState() {
      this._horizontalSwipeActive = false
      this._swipeStartX = 0
      this._swipeStartY = 0
      this._lastSwipeBucket = null
      this._tabBarContentRect = null
    },

    onTabTouchStart(e) {
      if (this.data.hidden || this.data.showDesktopGuideImage) return
      const t = e.touches && e.touches[0]
      if (!t) return
      this._swipeStartX = t.clientX
      this._swipeStartY = t.clientY
      this._horizontalSwipeActive = false
      this._lastSwipeBucket = null

      wx.createSelectorQuery()
        .in(this)
        .select('.tab-bar-content')
        .boundingClientRect()
        .exec((res) => {
          const rect = res && res[0]
          if (rect && typeof rect.left === 'number' && rect.width) {
            this._tabBarContentRect = rect
          }
        })
    },

    onTabTouchMove(e) {
      if (this.data.hidden || this.data.showDesktopGuideImage) return
      const t = e.touches && e.touches[0]
      if (!t) return

      const dx = t.clientX - this._swipeStartX
      const dy = t.clientY - this._swipeStartY

      if (!this._horizontalSwipeActive) {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return
        if (Math.abs(dy) >= Math.abs(dx)) return
        this._horizontalSwipeActive = true
      }

      const idx = this._computeSwipeIndex(t.clientX)
      if (idx === null) return

      if (this._lastSwipeBucket === null) {
        this._lastSwipeBucket = idx
        if (this.data.dragHighlightIndex !== idx) {
          this.setData({ dragHighlightIndex: idx })
        }
        return
      }

      if (this._lastSwipeBucket !== idx) {
        this._lastSwipeBucket = idx
        this._vibrateMedium()
        if (this.data.dragHighlightIndex !== idx) {
          this.setData({ dragHighlightIndex: idx })
        }
      }
    },

    onTabTouchEnd(e) {
      if (this.data.hidden || this.data.showDesktopGuideImage) {
        this.setData({ dragHighlightIndex: -1 })
        this._resetTabSwipeGestureState()
        return
      }

      // 隐私授权状态确认前禁止滑动切 Tab
      try {
        const app = getApp()
        if (app && app.globalData && app.globalData.privacyGateActive) {
          this.setData({ dragHighlightIndex: -1 })
          this._resetTabSwipeGestureState()
          return
        }
      } catch (err) {}

      const wasHorizontalSwipe = !!this._horizontalSwipeActive
      let commitIdx = null

      if (wasHorizontalSwipe) {
        commitIdx = this.data.dragHighlightIndex
        if ((commitIdx == null || commitIdx < 0) && e.changedTouches && e.changedTouches[0]) {
          commitIdx = this._computeSwipeIndex(e.changedTouches[0].clientX)
        }
      }

      if (
        wasHorizontalSwipe &&
        typeof commitIdx === 'number' &&
        commitIdx >= 0 &&
        commitIdx !== this.data.selected
      ) {
        const item = this.data.list[commitIdx]
        if (item && item.pagePath) {
          wx.switchTab({
            url: item.pagePath,
            success: () => {
              this._setTabBarData({
                selected: commitIdx,
                currentPath: item.pagePath,
                dragHighlightIndex: -1
              })
            },
            fail: () => {
              this._setTabBarData({ dragHighlightIndex: -1 })
            }
          })
        } else {
          this.setData({ dragHighlightIndex: -1 })
        }
      } else {
        this.setData({ dragHighlightIndex: -1 })
      }

      this._resetTabSwipeGestureState()
    },

    switchTab(e) {
      // 隐私授权状态确认前禁止切 Tab（透明遮罩之外的第二道保险）
      try {
        const app = getApp()
        if (app && app.globalData && app.globalData.privacyGateActive) return
      } catch (err) {}
      const data = e.currentTarget.dataset
      const url = data.path
      const idx = Number(data.index)
      if (idx === this.data.selected) return

      this._vibrateMedium()
      wx.switchTab({
        url: url,
        success: () => {
          this._setTabBarData({
            selected: idx,
            currentPath: url,
            dragHighlightIndex: -1
          })
        }
      })
    }
  }
})
