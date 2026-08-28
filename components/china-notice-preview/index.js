/**
 * 监控/列表中国航警预览卡。
 * 不用原生 <map>：一进 scroll-view 就会戳穿 Tab 遮罩、滑动黑块抖动。
 * 底图是卫星影像，预警区画在画布上；点进去才是可拖的腾讯卫星图。
 */
const {
  lookupChinaBulletinPreview,
  CHINESE_COLLECTION_KEY
} = require('../../utils/space-notices-feature.js')
const SAT = require('./sat-proj.js')

function lonToTileX(lon, z) {
  return ((Number(lon) + 180) / 360) * Math.pow(2, z)
}

function latToTileY(lat, z) {
  const r = (Number(lat) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)
}

function project(lon, lat, w, h) {
  const x0 = SAT.x0
  const y0 = SAT.y0
  const spanX = SAT.x1 + 1 - SAT.x0
  const spanY = SAT.y1 + 1 - SAT.y0
  return {
    x: ((lonToTileX(lon, SAT.z) - x0) / spanX) * w,
    y: ((latToTileY(lat, SAT.z) - y0) / spanY) * h
  }
}

function toLonLat(p) {
  if (!p) return null
  const lon = Number(Array.isArray(p) ? p[0] : p.longitude)
  const lat = Number(Array.isArray(p) ? p[1] : p.latitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { longitude: lon, latitude: lat }
}

function simplify(points, maxN) {
  if (!points || points.length <= maxN) return points || []
  const step = Math.ceil(points.length / maxN)
  const out = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  const last = points[points.length - 1]
  const tail = out[out.length - 1]
  if (!tail || last.longitude !== tail.longitude || last.latitude !== tail.latitude) out.push(last)
  return out
}

function colorCss(c, fallback) {
  if (!c) return fallback
  if (c.charAt(0) === '#' && c.length === 9) {
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    const a = parseInt(c.slice(7, 9), 16) / 255
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')'
  }
  return c
}

function drawZones(ctx, polygons, w, h) {
  const radius = Math.min(w, h) * 0.045
  ctx.beginPath()
  ctx.moveTo(radius, 0)
  ctx.arcTo(w, 0, w, h, radius)
  ctx.arcTo(w, h, 0, h, radius)
  ctx.arcTo(0, h, 0, 0, radius)
  ctx.arcTo(0, 0, w, 0, radius)
  ctx.closePath()
  ctx.clip()

  ;(polygons || []).forEach((poly) => {
    const pts = simplify((poly.points || []).map(toLonLat).filter(Boolean), 28)
    if (pts.length < 3) return
    ctx.beginPath()
    pts.forEach((pt, i) => {
      const p = project(pt.longitude, pt.latitude, w, h)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.fillStyle = colorCss(poly.fillColor, 'rgba(255, 59, 48, 0.28)')
    ctx.strokeStyle = colorCss(poly.strokeColor, '#FF9500')
    ctx.lineWidth = Math.max(1.6, w / 200)
    ctx.setLineDash(poly.dottedLine ? [6, 4] : [])
    ctx.fill()
    ctx.stroke()
    ctx.setLineDash([])
  })
}

Component({
  properties: {
    title: { type: String, value: '中国区卫星预览' }
  },

  data: {
    hint: '覆盖全国情报区 · 点开查看全部任务'
  },

  lifetimes: {
    attached() {
      this._alive = true
      this._polygons = []
      this.refresh()
    },
    ready() {
      this._paint()
    },
    detached() {
      this._alive = false
      this._ctx = null
      this._canvas = null
    }
  },

  methods: {
    onOpen() {
      this.triggerEvent('open')
    },

    refresh() {
      this._loadHint()
      this._loadZones()
    },

    _loadHint() {
      lookupChinaBulletinPreview()
        .then((row) => {
          if (!this._alive || !row) return
          const n = Number(row.noticeCount) || 0
          this.setData({
            hint: n ? (n + ' 条航警 · 点开查看全部任务') : '覆盖全国情报区 · 点开查看全部任务'
          })
        })
        .catch(() => {})
    },

    _loadZones() {
      return Promise.all([
        require.async('../../subpackages/monitor-pages/space-notices/utils/api-space-notices.js'),
        require.async('../../subpackages/monitor-pages/space-notices/utils/map-build.js'),
        require.async('../../subpackages/monitor-pages/space-notices/utils/notice-format.js')
      ])
        .then(([api, mb, fmt]) => {
          if (!this._alive || !api || !api.getSpaceNoticeEntry) return null
          return api.getSpaceNoticeEntry({ entryKey: CHINESE_COLLECTION_KEY }).then((res) => ({ res, mb, fmt }))
        })
        .then((pack) => {
          if (!this._alive || !pack || !pack.res || !pack.res.success) return
          const notices = (pack.res.notices || []).map((n) => pack.fmt.decorateNotice(n, pack.mb.hasGeometry))
          const layers = pack.mb.buildPreviewLayers(notices)
          const n = (layers.polygons || []).length
          this._polygons = layers.polygons || []
          if (n) this.setData({ hint: n + ' 个预警区 · 点开查看全部任务' })
          this._paint()
        })
        .catch(() => {})
    },

    _ensureCanvas() {
      if (this._ctx && this._w) return Promise.resolve(true)
      const self = this
      return new Promise((resolve) => {
        const tryQuery = (left) => {
          wx.createSelectorQuery()
            .in(self)
            .select('#snPreviewCanvas')
            .fields({ node: true, size: true })
            .exec((res) => {
              const info = res && res[0]
              const canvas = info && info.node
              if (!canvas || !info.width) {
                if (left > 0) setTimeout(() => tryQuery(left - 1), 50)
                else resolve(false)
                return
              }
              let dpr = 2
              try {
                dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || wx.getSystemInfoSync().pixelRatio || 2
              } catch (e) {}
              canvas.width = Math.max(1, Math.floor(info.width * dpr))
              canvas.height = Math.max(1, Math.floor(info.height * dpr))
              self._canvas = canvas
              self._ctx = canvas.getContext('2d')
              self._w = info.width
              self._h = info.height
              self._dpr = dpr
              resolve(true)
            })
        }
        tryQuery(8)
      })
    },

    _paint() {
      this._ensureCanvas().then((ok) => {
        if (!ok || !this._alive || !this._ctx) return
        const ctx = this._ctx
        const w = this._w
        const h = this._h
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(this._dpr || 1, this._dpr || 1)
        ctx.clearRect(0, 0, w, h)
        ctx.save()
        drawZones(ctx, this._polygons, w, h)
        ctx.restore()
      })
    }
  }
})
