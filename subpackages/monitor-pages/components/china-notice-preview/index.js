/**
 * 监控/列表中国航警预览卡。
 * nativeMap：与详情页同一套腾讯卫星图 + CHINA_VIEW / 预警区。
 * catcher 挡住拖动手势，点整卡进详情。
 */
const {
  lookupChinaBulletinPreview,
  CHINESE_COLLECTION_KEY
} = require('../../../../utils/space-notices-feature.js')
const themeUtil = require('../../../../utils/theme.js')
const { CHINA_VIEW, CHINA_FIT_POINTS, fitChinaPreviewMap } = require('../../space-notices/utils/china-notices.js')
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
  if (!Array.isArray(p)) {
    const lon = Number(p.longitude != null ? p.longitude : p.lon)
    const lat = Number(p.latitude != null ? p.latitude : p.lat)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null
    return { longitude: lon, latitude: lat }
  }
  const a = Number(p[0])
  const b = Number(p[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  let lon = a
  let lat = b
  if (Math.abs(b) > 90 && Math.abs(a) <= 90) {
    lon = b
    lat = a
  }
  if (Math.abs(lat) > 90) return null
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
    title: { type: String, value: '中国航警' },
    /** 与详情页同一套腾讯卫星图；catcher 挡住拖动手势 */
    nativeMap: { type: Boolean, value: true }
  },

  data: {
    hint: '覆盖全国情报区 · 点开查看中国航警地图',
    mapLat: CHINA_VIEW.latitude,
    mapLng: CHINA_VIEW.longitude,
    mapScale: CHINA_VIEW.scale,
    polygons: [],
    polylines: [],
    includePoints: CHINA_FIT_POINTS.slice(),
    mapSetting: { enableSatellite: true },
    /** 原生 map 切 Tab / 改 page-meta 底色后图层会失效，靠 wx:if 拆掉重建 */
    mapAlive: true
  },

  lifetimes: {
    attached() {
      this._alive = true
      this._pageVisible = true
      this._polygons = []
      this._themeHandler = () => {
        if (this._pageVisible) this._reviveNativeMap()
        else this._needRevive = true
      }
      try { themeUtil.onThemeChange(this._themeHandler) } catch (e) {}
      this.refresh()
    },
    ready() {
      if (!this.properties.nativeMap) {
        this._paint()
        return
      }
      this._fitPreviewMap()
    },
    detached() {
      this._alive = false
      this._pageVisible = false
      if (this._themeHandler) {
        try { themeUtil.offThemeChange(this._themeHandler) } catch (e) {}
        this._themeHandler = null
      }
      this._ctx = null
      this._canvas = null
    }
  },

  pageLifetimes: {
    show() {
      this._pageVisible = true
      if (!this._needRevive) return
      // 等页面 onShow 改完 page-meta / themeClass，再拆原生图层
      setTimeout(() => {
        if (!this._alive || !this._pageVisible || !this._needRevive) return
        this._needRevive = false
        this._reviveNativeMap()
      }, 64)
    },
    hide() {
      this._pageVisible = false
      this._needRevive = true
    }
  },

  methods: {
    onOpen() {
      this.triggerEvent('open')
    },

    refresh() {
      this._zoneHint = false
      this._loadHint()
      this._loadZones()
    },

    revive() {
      this._pageVisible = true
      this._needRevive = false
      this._reviveNativeMap()
    },

    _fitPreviewMap() {
      if (!this.properties.nativeMap || !this._alive || !this.data.mapAlive) return
      try {
        fitChinaPreviewMap(wx.createMapContext('snPreviewMap', this))
      } catch (e) { /* 已有 CHINA_VIEW / include-points */ }
    },

    _reviveNativeMap() {
      if (!this.properties.nativeMap || !this._alive) return
      if (this._reviving) {
        this._reviveAgain = true
        return
      }
      this._reviving = true
      this.setData({ mapAlive: false }, () => {
        setTimeout(() => {
          if (!this._alive) {
            this._reviving = false
            return
          }
          this.setData({
            mapAlive: true,
            mapSetting: { enableSatellite: true, _tick: Date.now() }
          }, () => {
            this._reviving = false
            this._fitPreviewMap()
            if (this._reviveAgain) {
              this._reviveAgain = false
              this._reviveNativeMap()
            }
          })
        }, 32)
      })
    },

    _loadHint() {
      lookupChinaBulletinPreview()
        .then((row) => {
          if (!this._alive || !row || this._zoneHint) return
          const n = Number(row.noticeCount) || 0
          this.setData({
            hint: n ? (n + ' 条航警 · 点开查看中国航警地图') : '覆盖全国情报区 · 点开查看中国航警地图'
          })
        })
        .catch(() => {})
    },

    _loadZones() {
      return Promise.all([
        require.async('../../space-notices/utils/api-space-notices.js'),
        require.async('../../space-notices/utils/map-build.js'),
        require.async('../../space-notices/utils/notice-format.js')
      ])
        .then(([api, mb, fmt]) => {
          if (!this._alive || !api || !api.getSpaceNoticeEntry) return null
          return api.getSpaceNoticeEntry({ entryKey: CHINESE_COLLECTION_KEY }).then((res) => ({ res, mb, fmt }))
        })
        .then((pack) => {
          if (!this._alive || !pack || !pack.res || !pack.res.success) return
          const notices = (pack.res.notices || []).map((n) => {
            const row = pack.fmt.decorateNotice(n, pack.mb.hasGeometry)
            row.inChina = true
            return row
          })
          const layers = pack.mb.buildPreviewLayers(notices, { chinaCollection: true })
          const n = (layers.polygons || []).length
          this._polygons = layers.polygons || []
          const patch = {}
          if (n) {
            patch.hint = n + ' 个预警区 · 点开查看全部任务'
            this._zoneHint = true
          }
          if (this.properties.nativeMap) {
            patch.polygons = layers.polygons || []
            patch.polylines = layers.polylines || []
          }
          if (Object.keys(patch).length) {
            this.setData(patch, () => this._fitPreviewMap())
          }
          if (!this.properties.nativeMap) this._paint()
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
