const pageBase = require('../../utils/page-base.js')
const { loadData, StarlinkRenderer } = require('./utils/starlink-renderer.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 44,
    satCount: 0,
    paused: false,
    loading: true,
    updateTime: ''
  },

  _renderer: null,

  async onLoad() {
    try {
      const result = await loadData()
      const now = new Date()
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

      this.setData({
        satCount: result.count,
        updateTime: timeStr,
        loading: false
      })

      this._renderer = new StarlinkRenderer()
      // 注册实时数量回调
      this._renderer._onCountUpdate = (count) => {
        if (count !== this.data.satCount) {
          this.setData({ satCount: count })
        }
      }
      setTimeout(async () => {
        try {
          await this._renderer.bindCanvas(this, '#starlinkFullCanvas')
        } catch (err) {
          console.error('[Starlink-FS] bindCanvas error:', err)
          wx.showToast({ title: 'Canvas 初始化失败', icon: 'none' })
        }
      }, 200)
    } catch (err) {
      console.error('[Starlink-FS] init error:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '卫星数据加载失败', icon: 'none' })
    }
  },

  onHide() {
    if (!this._renderer) return
    this._renderer.releaseInteraction()
    // 页面隐藏时停掉渲染循环（否则每秒全量 propagate + Canvas 绘制在后台空跑）
    this._resumeOnShow = !this._renderer.isPaused()
    if (this._resumeOnShow) this._renderer.togglePause()
  },

  onShow() {
    if (this._renderer && this._resumeOnShow && this._renderer.isPaused()) {
      this._renderer.togglePause()
    }
    this._resumeOnShow = false
  },

  onUnload() {
    if (this._renderer) {
      this._renderer.destroy()
      this._renderer = null
    }
  },

  // ========== 触摸事件转发给渲染器 ==========
  onCanvasTouchStart(e) {
    if (this._renderer) this._renderer.onTouchStart(e)
  },
  onCanvasTouchMove(e) {
    if (this._renderer) this._renderer.onTouchMove(e)
  },
  onCanvasTouchEnd(e) {
    if (this._renderer) this._renderer.onTouchEnd(e)
  },

  // goBack inherited from pageBase,

  togglePause() {
    if (!this._renderer) return
    const paused = this._renderer.togglePause()
    this.setData({ paused })
  },

  onShareAppMessage() {
    return {
      title: 'Starlink 卫星实时追踪 - ' + this.data.satCount + '颗在轨 | 火星探索日志',
      path: '/subpackages/monitor-pages/starlink-fullscreen'
    }
  },

  onShareTimeline() {
    return {
      title: 'Starlink 卫星实时追踪 - ' + this.data.satCount + '颗在轨 | 火星探索日志'
    }
  }
})
