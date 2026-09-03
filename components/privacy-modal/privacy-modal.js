const privacyTapGuard = require('../../utils/privacy-tap-guard.js')
const themeUtil = require('../../utils/theme.js')

Component({
  data: {
    visible: false,
    closing: false,
    contractName: '《小程序用户隐私保护指引》',
    referrer: '',
    // 隐私授权状态确认前全局禁触：true 时渲染透明全屏遮罩（含 TabBar 区域）
    gateBlocking: false,
    /* root-portal 弹窗脱离页面 DOM，继承不到页面根的 theme-light 变量，组件自行挂主题类 */
    themeClass: ''
  },

  lifetimes: {
    attached() {
      const app = getApp()
      if (!app) return
      // 监听回调收到的已是「门控激活 且 开屏未展示」的合成值（app._notifyPrivacyGateListeners）：
      // 开屏层自身全屏遮挡，遮罩若同时渲染会经 root-portal 压住开屏，吞掉「跳过」按钮的点击
      this._onGateChange = (blocking) => {
        this.setData({ gateBlocking: !!blocking })
      }
      const gd = app.globalData || {}
      this.setData({
        gateBlocking: !!gd.privacyGateActive && !gd.splashActive,
        themeClass: this._resolveThemeClass()
      })
      if (typeof app.onPrivacyGateChange === 'function') {
        app.onPrivacyGateChange(this._onGateChange)
      }
    },

    detached() {
      const app = getApp()
      if (app && typeof app.offPrivacyGateChange === 'function' && this._onGateChange) {
        app.offPrivacyGateChange(this._onGateChange)
      }
      this._onGateChange = null
      if (this._hideTimer) {
        clearTimeout(this._hideTimer)
        this._hideTimer = null
      }
    }
  },

  methods: {
    /** 吞掉遮罩上的所有触控 */
    onGateBlock() {},

    _resolveThemeClass() {
      try {
        return themeUtil.getThemeClassSync()
      } catch (e) {
        return ''
      }
    },

    show(payload) {
      if (this._hideTimer) {
        clearTimeout(this._hideTimer)
        this._hideTimer = null
      }
      this._hideScheduled = false
      const contractName = payload && payload.contractName ? payload.contractName : '《小程序用户隐私保护指引》'
      const referrer = payload && payload.referrer ? payload.referrer : ''
      // 用户可能在「我的太空」切了主题，弹出前重新解析（跟随系统时也可能已变）
      this.setData({
        visible: true,
        closing: false,
        contractName,
        referrer,
        themeClass: this._resolveThemeClass()
      })
      const app = getApp()
      if (app && typeof app.setPrivacyModalVisible === 'function') {
        app.setPrivacyModalVisible(true)
      }
    },

    hide() {
      const app = getApp()
      if (app && typeof app.armPrivacyTapGuard === 'function') {
        app.armPrivacyTapGuard(privacyTapGuard.PRIVACY_TAP_GUARD_MS)
      }
      // 先视觉关掉（opacity:0），DOM 再留一小段吞掉同意按钮抬起后的残余点击，避免点穿到底下 video
      if (!this.data.closing) this.setData({ closing: true })
      if (this._hideScheduled) return
      this._hideScheduled = true
      if (this._hideTimer) clearTimeout(this._hideTimer)
      this._hideTimer = setTimeout(() => {
        this._hideTimer = null
        this._hideScheduled = false
        this.setData({ visible: false, closing: false })
        if (app && typeof app.setPrivacyModalVisible === 'function') {
          app.setPrivacyModalVisible(false)
        }
      }, privacyTapGuard.PRIVACY_MODAL_HIDE_DELAY_MS)
    },

    _runAfterPaint(fn) {
      if (typeof fn !== 'function') return
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(fn)
        return
      }
      setTimeout(fn, 0)
    },

    onMaskTap() {},

    onOpenContract() {
      const app = getApp()
      if (!app || typeof app.openPrivacyContract !== 'function') {
        wx.showToast({ title: '暂不支持查看隐私指引', icon: 'none' })
        return
      }

      app.openPrivacyContract().then((res) => {
        if (!res || !res.ok) {
          wx.showToast({ title: '打开隐私指引失败', icon: 'none' })
        }
      })
    },

    _vibrateLight() {
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (e) {
        try {
          wx.vibrateShort()
        } catch (e2) {}
      }
    },

    onAgreeTap() {
      this.hide()
    },

    onAgree() {
      this.hide()
      const app = getApp()
      this._runAfterPaint(() => {
        this._vibrateLight()
        if (app && typeof app.agreePrivacyAuthorization === 'function') {
          app.agreePrivacyAuthorization('privacy-modal-agree-btn')
        }
      })
    },

    onDisagree() {
      this.hide()
      const app = getApp()
      this._runAfterPaint(() => {
        if (app && typeof app.disagreePrivacyAuthorization === 'function') {
          app.disagreePrivacyAuthorization()
        }
      })
    }
  }
})
