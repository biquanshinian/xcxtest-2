const { canShowOfficialAccount } = require('../../utils/official-account-scene.js')
const themeUtil = require('../../../../utils/theme.js')

const STORAGE_KEY = 'official_account_bar_dismissed'
const DISMISS_THRESHOLD_PX = 70

Component({
  data: {
    show: false,
    dragOffset: 0,
    cardOpacity: 1,
    dragging: false,
    /* 组件样式隔离下页面根的 .theme-light 变量进不来，浅色态由组件自挂修饰类 */
    barLight: false
  },

  lifetimes: {
    attached() {
      if (!canShowOfficialAccount()) return
      try {
        if (wx.getStorageSync(STORAGE_KEY)) return
      } catch (_) {}
      // 设置页切换主题 / 系统主题变化不会触发 pageLifetimes.show，须订阅变更通知
      this._themeHandler = this._syncTheme.bind(this)
      themeUtil.onThemeChange(this._themeHandler)
      this.setData({ show: true, barLight: themeUtil.isLightSync() })
    },
    detached() {
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
    }
  },

  pageLifetimes: {
    /* 在其他页切了主题后返回本页：重新同步主题修饰类 */
    show() {
      this._syncTheme()
    }
  },

  methods: {
    _syncTheme() {
      const light = themeUtil.isLightSync()
      if (light !== this.data.barLight) {
        this.setData({ barLight: light })
      }
    },

    onOfficialAccountLoad() {},

    onOfficialAccountError(e) {
      const status = e && e.detail ? e.detail.status : null
      // 4=未开启功能 5=场景值错误 6=重复创建；隐藏容器避免占位
      if (status === 4 || status === 5 || status === 6) {
        this.setData({ show: false })
      }
    },

    onDismiss() {
      this.dismiss()
    },

    dismiss() {
      try {
        if (typeof wx.vibrateShort === 'function') {
          wx.vibrateShort({ type: 'medium' })
        }
      } catch (_) {}
      try {
        wx.setStorageSync(STORAGE_KEY, true)
      } catch (_) {}
      this._dragging = false
      this._isHorizontal = null
      this.setData({
        show: false,
        dragOffset: 0,
        cardOpacity: 1,
        dragging: false
      })
    },

    onNativeTouchStart() {
      this._ignoreSwipe = true
    },

    onTouchStart(e) {
      if (this._ignoreSwipe) return
      const touch = e.touches[0]
      if (!touch) return
      this._startX = touch.clientX
      this._startY = touch.clientY
      this._dragging = true
      this._isHorizontal = null
      this.setData({ dragging: true })
    },

    onTouchMove(e) {
      if (!this._dragging || this._ignoreSwipe) return
      const touch = e.touches[0]
      if (!touch) return

      const dx = touch.clientX - this._startX
      const dy = touch.clientY - this._startY

      if (this._isHorizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        this._isHorizontal = Math.abs(dx) > Math.abs(dy)
        if (!this._isHorizontal) return
      }
      if (!this._isHorizontal) return

      const opacity = Math.max(0.45, 1 - Math.abs(dx) / 220)
      this.setData({
        dragOffset: dx,
        cardOpacity: opacity
      })
    },

    onTouchEnd() {
      this._ignoreSwipe = false
      if (!this._dragging) return

      const shouldDismiss = Math.abs(this.data.dragOffset) >= DISMISS_THRESHOLD_PX
      this._dragging = false
      this._isHorizontal = null

      if (shouldDismiss) {
        this.dismiss()
        return
      }

      this.setData({
        dragOffset: 0,
        cardOpacity: 1,
        dragging: false
      })
    }
  }
})
