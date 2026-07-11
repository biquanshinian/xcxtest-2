Component({
  data: {
    show: false,
    dismissed: false
  },

  lifetimes: {
    attached() {
      try {
        const launchInfo = wx.getLaunchOptionsSync()
        // scene 1154 = 朋友圈单页模式
        if (launchInfo.scene === 1154) {
          this.setData({ show: true })
          this._autoHideTimer = setTimeout(() => {
            if (!this.data.dismissed) {
              this.setData({ dismissed: true })
              setTimeout(() => this.setData({ show: false }), 400)
            }
          }, 15000)
        }
      } catch (_) {}
    },

    detached() {
      if (this._autoHideTimer) clearTimeout(this._autoHideTimer)
    }
  },

  methods: {
    onDismiss() {
      this.setData({ dismissed: true })
      if (this._autoHideTimer) clearTimeout(this._autoHideTimer)
      setTimeout(() => this.setData({ show: false }), 400)
    }
  }
})
