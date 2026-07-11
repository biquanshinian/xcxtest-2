Component({
  data: {
    visible: false,
    contractName: '《小程序用户隐私保护指引》',
    referrer: '',
    // 隐私授权状态确认前全局禁触：true 时渲染透明全屏遮罩（含 TabBar 区域）
    gateBlocking: false
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
      this.setData({ gateBlocking: !!gd.privacyGateActive && !gd.splashActive })
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
    }
  },

  methods: {
    /** 吞掉遮罩上的所有触控 */
    onGateBlock() {},

    show(payload) {
      const contractName = payload && payload.contractName ? payload.contractName : '《小程序用户隐私保护指引》'
      const referrer = payload && payload.referrer ? payload.referrer : ''
      this.setData({
        visible: true,
        contractName,
        referrer
      })
    },

    hide() {
      this.setData({ visible: false })
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

    onAgree() {
      const app = getApp()
      if (app && typeof app.agreePrivacyAuthorization === 'function') {
        app.agreePrivacyAuthorization('privacy-modal-agree-btn')
      }
      this.hide()
    },

    onDisagree() {
      const app = getApp()
      if (app && typeof app.disagreePrivacyAuthorization === 'function') {
        app.disagreePrivacyAuthorization()
      }
      this.hide()
    }
  }
})
