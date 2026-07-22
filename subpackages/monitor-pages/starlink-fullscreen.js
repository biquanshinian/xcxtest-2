const pageBase = require('../../utils/page-base.js')
const { loadData, StarlinkRenderer } = require('./utils/starlink-renderer.js')
// 打包锚点：monitor-pass.js / monitor-galleries.js / monitor-orbital.js 仅被主包
// monitor.js require.async 引用，无同分包同步引用时会被"过滤无依赖文件"剔出分包导致异步加载失败
require('./utils/monitor-pass.js')
require('./utils/monitor-galleries.js')
require('./utils/monitor-orbital.js')

function fmtLat(lat) {
  if (lat == null || !isFinite(lat)) return '—'
  return (lat >= 0 ? 'N ' : 'S ') + Math.abs(lat).toFixed(2) + '°'
}

function fmtLng(lng) {
  if (lng == null || !isFinite(lng)) return '—'
  return (lng >= 0 ? 'E ' : 'W ') + Math.abs(lng).toFixed(2) + '°'
}

function fmtAlt(km) {
  if (km == null || !isFinite(km)) return '—'
  return km.toFixed(1) + ' km'
}

function fmtVel(kmS) {
  if (kmS == null || !isFinite(kmS)) return '—'
  return (kmS * 3600).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km/h'
}

function shortName(name) {
  if (!name) return ''
  let n = String(name).trim()
  if (n.startsWith('STARLINK-')) return 'STARLINK-' + n.substring(9)
  return n
}

function fmtCount(n) {
  if (!n) return ''
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' LIVE'
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    satCount: 0,
    satCountText: '',
    paused: false,
    loading: true,
    updateTime: '',
    loadError: '',
    selected: false,
    selectedOccluded: false,
    selectedName: '',
    selectedLat: '—',
    selectedLng: '—',
    selectedAlt: '—',
    selectedVel: '—'
  },

  _renderer: null,
  _lastSelectSig: '',

  onLoad() {
    this.initUiShell()
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
    this._lastSelectSig = ''
    this.setData({
      loading: true,
      loadError: '',
      paused: false,
      selected: false,
      selectedOccluded: false
    })
    try {
      const result = await loadData()
      const now = new Date()
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

      this.setData({
        satCount: result.count,
        satCountText: fmtCount(result.count),
        updateTime: timeStr,
        loading: false
      })

      const self = this
      // 全屏：采样 5000；关闭 Canvas 内置 HUD；点选回调驱动信息窗
      const renderer = new StarlinkRenderer({
        renderMax: 5000,
        hideHud: true,
        enablePick: true,
        onSelect(sat) {
          self._applySelection(sat)
        }
      })
      renderer._onCountUpdate = (count) => {
        if (count && count !== this.data.satCount) {
          this.setData({ satCount: count, satCountText: fmtCount(count) })
        }
      }
      this._renderer = renderer
      setTimeout(async () => {
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

  /** 点选 / 1Hz 遥测刷新 → 信息窗（签名去重，避免无效 setData） */
  _applySelection(sat) {
    if (this._fsDestroyed) return
    if (!sat) {
      if (!this.data.selected) return
      this._lastSelectSig = ''
      this.setData({
        selected: false,
        selectedOccluded: false,
        selectedName: '',
        selectedLat: '—',
        selectedLng: '—',
        selectedAlt: '—',
        selectedVel: '—'
      })
      return
    }
    // 有载荷的刷新必须仍挂着渲染器（避免卸载后 1Hz 回调写页面）
    if (!this._renderer) return
    const occluded = !!sat.occluded
    const name = shortName(sat.name)
    const lat = occluded ? '—' : fmtLat(sat.lat)
    const lng = occluded ? '—' : fmtLng(sat.lng)
    const alt = occluded ? '—' : fmtAlt(sat.altKm)
    const vel = occluded ? '—' : fmtVel(sat.velKmS)
    const sig = [name, occluded ? 1 : 0, lat, lng, alt, vel].join('|')
    if (sig === this._lastSelectSig) return
    this._lastSelectSig = sig
    this.setData({
      selected: true,
      selectedOccluded: occluded,
      selectedName: name,
      selectedLat: lat,
      selectedLng: lng,
      selectedAlt: alt,
      selectedVel: vel
    })
  },

  onClearSelected() {
    if (this._renderer) this._renderer.clearSelected()
    else this._applySelection(null)
  },

  onRetry() {
    this._initStarlink()
  },

  onHide() {
    if (!this._renderer) return
    this._renderer.releaseInteraction()
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
    this._fsDestroyed = true
    if (this._renderer) {
      this._renderer.destroy()
      this._renderer = null
    }
  },

  onCanvasTouchStart(e) {
    if (this._renderer) this._renderer.onTouchStart(e)
  },
  onCanvasTouchMove(e) {
    if (this._renderer) this._renderer.onTouchMove(e)
  },
  onCanvasTouchEnd(e) {
    if (this._renderer) this._renderer.onTouchEnd(e)
  },

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
