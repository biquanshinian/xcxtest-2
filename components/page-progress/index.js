/**
 * 顶部页面加载进度条（绿色，从左到右）
 * 用法：放在页面固定导航栏 top-nav-wrapper 内最后一个子节点，绑定 active="{{loading}}"
 * 行为：active=true 时从 0 逐渐推进到 90%（先快后慢）；active 变 false 后冲满 100% 再渐隐消失
 */
Component({
  properties: {
    active: {
      type: Boolean,
      value: false,
      observer(val) {
        if (val) {
          this._start()
        } else {
          this._finish()
        }
      }
    }
  },

  data: {
    visible: false,
    barStyle: ''
  },

  lifetimes: {
    attached() {
      if (this.data.active) this._start()
    },
    detached() {
      this._clearTimers()
    }
  },

  methods: {
    _clearTimers() {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
      if (this._fadeTimer) {
        clearTimeout(this._fadeTimer)
        this._fadeTimer = null
      }
    },

    _start() {
      this._clearTimers()
      // 先无过渡复位到 0，下一帧再启动前进过渡，保证每次都从最左端开始
      this.setData({
        visible: true,
        barStyle: 'width:0%;opacity:1;transition:none;'
      })
      this._timer = setTimeout(() => {
        this._timer = null
        if (!this.data.active) return
        // 先快后慢推进到 90%，剩余 10% 留给完成时冲满
        this.setData({
          barStyle: 'width:90%;opacity:1;transition:width 3s cubic-bezier(0.08, 0.65, 0.25, 1);'
        })
      }, 50)
    },

    _finish() {
      if (!this.data.visible) return
      this._clearTimers()
      this.setData({
        barStyle: 'width:100%;opacity:1;transition:width 0.2s ease-out;'
      })
      this._timer = setTimeout(() => {
        this._timer = null
        this.setData({
          barStyle: 'width:100%;opacity:0;transition:opacity 0.35s ease;'
        })
        this._fadeTimer = setTimeout(() => {
          this._fadeTimer = null
          this.setData({ visible: false, barStyle: '' })
        }, 400)
      }, 220)
    }
  }
})
