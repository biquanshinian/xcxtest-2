/**
 * 分享限时查看倒计时胶囊 —— 悬浮于页面底部居中
 *
 * 与 utils/share-gate.js 配套：非会员经分享链接（sst 时间戳）进入会员详情页时，
 * 页面把免门控窗口截止时间写入 data.shareGateExpireAt，本组件每秒刷新剩余时间；
 * 归零后显示「限时查看已结束」（当前页可继续浏览，再次进入将被门控拦截）。
 * expireAt 为 0 / 未设置时不渲染（自然入口、会员本人均不显示）。
 */
Component({
  properties: {
    expireAt: {
      type: Number,
      value: 0,
      observer() {
        this._restart()
      }
    }
  },

  data: {
    visible: false,
    ended: false,
    timeText: ''
  },

  lifetimes: {
    attached() {
      this._restart()
    },
    detached() {
      this._clearTimer()
    }
  },

  pageLifetimes: {
    show() {
      this._restart()
    },
    hide() {
      this._clearTimer()
    }
  },

  methods: {
    _clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    },

    _restart() {
      this._clearTimer()
      const expireAt = Number(this.properties.expireAt) || 0
      if (expireAt <= 0) {
        if (this.data.visible) this.setData({ visible: false })
        return
      }
      this._tick()
    },

    _tick() {
      const expireAt = Number(this.properties.expireAt) || 0
      if (expireAt <= 0) return
      const left = expireAt - Date.now()
      if (left <= 0) {
        this.setData({ visible: true, ended: true, timeText: '' })
        return
      }
      const total = Math.floor(left / 1000)
      const pad = (n) => (n < 10 ? '0' + n : '' + n)
      const timeText =
        pad(Math.floor(total / 3600)) + ':' + pad(Math.floor((total % 3600) / 60)) + ':' + pad(total % 60)
      this.setData({ visible: true, ended: false, timeText })
      // 对齐整秒刷新，避免长时间运行后跳秒
      this._timer = setTimeout(() => this._tick(), (left % 1000) + 20)
    }
  }
})
