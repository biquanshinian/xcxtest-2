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
    updateTime: '',
    loadError: ''
  },

  _renderer: null,

  onLoad() {
    this._initStarlink()
  },

  /** 初始化 / 重试共用：加载 TLE 数据并绑定 Canvas（重入前先销毁旧实例，防泄漏） */
  async _initStarlink() {
    if (this._initing) return
    this._initing = true
    if (this._renderer) {
      this._renderer.destroy()
      this._renderer = null
    }
    this.setData({ loading: true, loadError: '', paused: false })
    try {
      const result = await loadData()
      const now = new Date()
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

      this.setData({
        satCount: result.count,
        updateTime: timeStr,
        loading: false
      })

      // 全屏场景渲染采样上限 5000（卡片为 2500）；计数回调回传全量在轨数
      const renderer = new StarlinkRenderer({ renderMax: 5000 })
      renderer._onCountUpdate = (count) => {
        if (count && count !== this.data.satCount) {
          this.setData({ satCount: count })
        }
      }
      this._renderer = renderer
      setTimeout(async () => {
        // 页面已卸载 / 已被新一轮重试替换时不再绑定
        if (this._renderer !== renderer) return
        try {
          await renderer.bindCanvas(this, '#starlinkFullCanvas')
        } catch (err) {
          console.error('[Starlink-FS] bindCanvas error:', err)
          if (this._renderer === renderer) {
            this.setData({ loadError: 'Canvas 初始化失败，请重试' })
          }
        }
      }, 200)
    } catch (err) {
      console.error('[Starlink-FS] init error:', err)
      this.setData({ loading: false, loadError: '卫星数据加载失败，请检查网络后重试' })
    } finally {
      this._initing = false
    }
  },

  /** 错误层「重试」按钮 */
  onRetry() {
    this._initStarlink()
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
