/**
 * ODC「Vehicle Tracker」渲染器 — Canvas 2D 正交投影地球
 *
 * 性能优先：无贴图像素扫描。拖转/飞镜时画简化球体，静止时才画完整海岸线。
 * 机标使用官网 SpaceX vehicle-tracker 图标。
 *
 * setVehicles：
 *   [{ id, label, group, lat, lng, altM, track, showTrack?, active?, issLat?, issLng? }]
 */
let _COASTLINE = null
function getCOASTLINE() {
  if (!_COASTLINE) _COASTLINE = require('./world-coastline.js')
  return _COASTLINE
}

const DEG = Math.PI / 180
const EARTH_RADIUS_M = 6378137
/** 静止时涟漪刷新间隔（约 30fps）；地球/轨迹走离屏缓存，每帧只重绘波纹 */
const PULSE_INTERVAL = 33
const PULSE_PERIOD = 1400
const FLY_DURATION = 420
const ICON_BASE = '/subpackages/monitor-pages/assets/vehicle-tracker/'
/** ISS / Dragon（含对接合成图）相对原尺寸缩放 */
const DRAGON_ISS_ICON_SCALE = 0.7

class VehicleTrackerRenderer {
  constructor() {
    this._canvas = null
    this._ctx = null
    this._animTimer = null
    this._canvasW = 0
    this._canvasH = 0
    this._paused = false
    this._dpr = 1
    this._sphereR = 0
    this._cx = 0
    this._cy = 0
    this._rotLon = 0
    this._rotLat = 20
    this._scale = 1
    this._minScale = 0.6
    this._maxScale = 4
    this._touchStartDist = 0
    this._touchStartScale = 1
    this._touchStartX = 0
    this._touchStartY = 0
    this._touchStartRotLon = 0
    this._touchStartRotLat = 0
    this._touching = false
    this._pinching = false
    this._interacting = false
    this._rafId = null
    this._inertia = false
    this._velLon = 0
    this._velLat = 0
    this._lastMoveTime = 0
    this._lastMoveX = 0
    this._lastMoveY = 0
    this._inertiaLastTime = 0
    this._flying = false
    this._flyFrom = null
    this._flyTo = null
    this._flyT0 = 0
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    this._baseCacheOk = true
    // 静态叠加层：轨迹 + 机标（不含涟漪），随数据/视角失效
    this._fxCanvas = null
    this._fxCtx = null
    this._fxCacheKey = ''
    this._fxCacheOk = true
    this._stars = null
    this._vehicles = []
    this._featuredId = ''
    this._iss = null
    this._icons = { starship: null, dragon: null, iss: null, dragonIss: null, dragonIss2: null }
    this._iconsReady = false
    this._dockState = null // { hideIss, dockedIds: {id:1|2}, hideIds: {id:true} }
    this._dockSticky = Object.create(null) // id -> true，滞回防抖，避免尺寸突变
    this._destroyed = false
  }

  async bindCanvas(page, canvasId) {
    const id = canvasId || '#vtCanvas'
    let canvasNode = null
    for (let attempt = 0; attempt < 5; attempt++) {
      canvasNode = await new Promise((resolve) => {
        page.createSelectorQuery().select(id)
          .fields({ node: true, size: true })
          .exec((res) => resolve(res && res[0]))
      })
      if (canvasNode && canvasNode.node) break
      await new Promise(r => setTimeout(r, 300))
    }
    if (this._destroyed) throw new Error('Renderer destroyed during bind')
    if (!canvasNode || !canvasNode.node) throw new Error('Canvas node not found')

    this._canvas = canvasNode.node
    this._ctx = this._canvas.getContext('2d')
    this._dpr = wx.getWindowInfo().pixelRatio || 2

    this._canvasW = canvasNode.width * this._dpr
    this._canvasH = canvasNode.height * this._dpr
    this._canvas.width = this._canvasW
    this._canvas.height = this._canvasH

    this._sphereR = Math.min(this._canvasW, this._canvasH) * 0.42
    this._cx = this._canvasW / 2
    this._cy = this._canvasH / 2

    this._initStars()
    this._initBaseCanvas()
    this._initFxCanvas()
    this._loadIcons()
    this._paused = false
    this._startLoop()
  }

  _loadIcon(src) {
    return new Promise((resolve) => {
      if (!this._canvas || typeof this._canvas.createImage !== 'function') {
        resolve(null)
        return
      }
      try {
        const img = this._canvas.createImage()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = src
      } catch (e) {
        resolve(null)
      }
    })
  }

  async _loadIcons() {
    const [starship, dragon, iss, dragonIss, dragonIss2] = await Promise.all([
      this._loadIcon(ICON_BASE + 'icon_starship.png'),
      this._loadIcon(ICON_BASE + 'icon_dragon.png'),
      this._loadIcon(ICON_BASE + 'icon_iss.png'),
      this._loadIcon(ICON_BASE + 'icon_dragon_iss.png'),
      this._loadIcon(ICON_BASE + 'icon_dragon_iss2.png')
    ])
    if (this._destroyed) return
    this._icons.starship = starship
    this._icons.dragon = dragon
    this._icons.iss = iss
    this._icons.dragonIss = dragonIss
    this._icons.dragonIss2 = dragonIss2
    this._iconsReady = !!(starship || dragon || iss)
    this._fxCacheKey = ''
    if (!this._paused) this._renderFrame()
  }

  /** 球面近似距离（km）；官网 threed.js 用 ECEF 距离 ≤400m 判定对接 */
  _distKm(lat1, lng1, lat2, lng2) {
    const p1 = lat1 * DEG
    const p2 = lat2 * DEG
    const dLat = (lat2 - lat1) * DEG
    const dLng = (lng2 - lng1) * DEG
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
  }

  /**
   * 对接判定带滞回：进入 ≤1km，退出 ≥5km，避免走着走着在分体/合成图标间跳变放大。
   * 对接后只画合成图标，ISS 位置锁到龙飞船（同步走）。
   */
  _updateDockState() {
    const docked = []
    const hideIds = Object.create(null)
    const dockedIds = Object.create(null)
    let hideIss = false
    const nextSticky = Object.create(null)
    if (this._iss) {
      for (let i = 0; i < this._vehicles.length; i++) {
        const v = this._vehicles[i]
        if (!v || v.group !== 'dragon' || v.active === false) continue
        if (!isFinite(v.lat) || !isFinite(v.lng)) continue
        const d = this._distKm(v.lat, v.lng, this._iss.lat, this._iss.lng)
        const was = !!this._dockSticky[v.id]
        const nowDocked = was ? d <= 5 : d <= 1
        if (nowDocked) {
          docked.push(v.id)
          nextSticky[v.id] = true
          // 锁同位：合成图标挂在龙飞船上，ISS 不再单独漂移
          v.issLat = v.lat
          v.issLng = v.lng
          if (isFinite(v.altM)) v.issAltM = v.altM
        }
      }
    }
    this._dockSticky = nextSticky
    // 刷新共享 ISS 为对接龙的位置（取第一艘）
    if (docked.length && this._iss) {
      const lead = this._vehicles.find((x) => x && x.id === docked[0])
      if (lead) {
        this._iss = { lat: lead.lat, lng: lead.lng, altM: lead.altM }
      }
    }
    if (docked.length >= 2) {
      hideIss = true
      dockedIds[docked[0]] = 2
      hideIds[docked[1]] = true
      for (let i = 2; i < docked.length; i++) hideIds[docked[i]] = true
    } else if (docked.length === 1) {
      hideIss = true
      dockedIds[docked[0]] = 1
    }
    this._dockState = { hideIss, dockedIds, hideIds }
  }

  setVehicles(list) {
    this._vehicles = Array.isArray(list) ? list : []
    this._iss = null
    for (let i = 0; i < this._vehicles.length; i++) {
      const v = this._vehicles[i]
      if (v && isFinite(v.issLat) && isFinite(v.issLng)) {
        this._iss = {
          lat: v.issLat,
          lng: v.issLng,
          altM: isFinite(v.issAltM) ? v.issAltM : 420000
        }
        break
      }
    }
    this._updateDockState()
    this._fxCacheKey = '' // 位置/轨迹变了，叠层失效；下一帧脉冲循环会重绘
  }

  setFeatured(id) {
    if ((id || '') === this._featuredId) return
    this._featuredId = id || ''
    this._fxCacheKey = ''
  }

  rotateToLocation(lat, lng) {
    if (!this._canvas) return
    if (!isFinite(lat) || !isFinite(lng)) return
    if (this._paused) {
      this._rotLon = ((lng + 540) % 360) - 180
      this._rotLat = Math.max(-85, Math.min(85, lat))
      return
    }
    this.releaseInteraction()
    this._stopInertia()
    const dLon = ((lng - this._rotLon + 540) % 360) - 180
    // 已对准则只换轨迹/机标，不飞镜
    if (Math.abs(dLon) < 0.8 && Math.abs(lat - this._rotLat) < 0.8) {
      this._rotLon = ((lng + 540) % 360) - 180
      this._rotLat = Math.max(-85, Math.min(85, lat))
      this._fxCacheKey = ''
      this._renderFrame()
      return
    }
    this._flyFrom = { lon: this._rotLon, lat: this._rotLat }
    this._flyTo = { lon: this._rotLon + dLon, lat: Math.max(-85, Math.min(85, lat)) }
    this._flyT0 = Date.now()
    if (!this._flying) {
      this._flying = true
      this._stopLoop()
      this._flyLoop()
    }
  }

  _flyLoop() {
    if (!this._flying || !this._canvas) return
    const t = Math.min(1, (Date.now() - this._flyT0) / FLY_DURATION)
    const ease = 1 - Math.pow(1 - t, 3)
    this._rotLon = this._flyFrom.lon + (this._flyTo.lon - this._flyFrom.lon) * ease
    this._rotLat = this._flyFrom.lat + (this._flyTo.lat - this._flyFrom.lat) * ease
    this._renderFrame()
    if (t >= 1) {
      this._flying = false
      this._rotLon = ((this._rotLon + 540) % 360) - 180
      this._baseCacheKey = ''
      this._fxCacheKey = ''
      this._startLoop()
      return
    }
    const raf = this._canvas.requestAnimationFrame
    if (typeof raf === 'function') {
      try { this._rafId = raf.call(this._canvas, () => this._flyLoop()); return } catch (e) { /* fallthrough */ }
    }
    setTimeout(() => this._flyLoop(), 16)
  }

  _initStars() {
    const stars = []
    for (let i = 0; i < 90; i++) {
      const big = Math.random() < 0.25
      stars.push({
        x: Math.random() * this._canvasW,
        y: Math.random() * this._canvasH,
        r: (big ? 1.0 : 0.5) * this._dpr,
        a: big ? 0.28 + Math.random() * 0.3 : 0.08 + Math.random() * 0.18
      })
    }
    this._stars = stars
  }

  _initBaseCanvas() {
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    try {
      const oc = wx.createOffscreenCanvas({ type: '2d', width: this._canvasW, height: this._canvasH })
      const octx = oc && oc.getContext('2d')
      if (!oc || !octx) throw new Error('no offscreen ctx')
      this._baseCanvas = oc
      this._baseCtx = octx
      this._baseCacheOk = true
    } catch (e) {
      this._baseCacheOk = false
    }
  }

  _initFxCanvas() {
    this._fxCanvas = null
    this._fxCtx = null
    this._fxCacheKey = ''
    try {
      const oc = wx.createOffscreenCanvas({ type: '2d', width: this._canvasW, height: this._canvasH })
      const octx = oc && oc.getContext('2d')
      if (!oc || !octx) throw new Error('no fx ctx')
      this._fxCanvas = oc
      this._fxCtx = octx
      this._fxCacheOk = true
    } catch (e) {
      this._fxCacheOk = false
    }
  }

  _geoToPixel(lat, lng, altM) {
    const phi = lat * DEG
    const lam = lng * DEG
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG
    const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
    if (cosC < 0) return { x: 0, y: 0, visible: false, cosC }
    const alt = (altM > 0 && isFinite(altM)) ? altM : 0
    const boost = Math.min(0.06, (alt / EARTH_RADIUS_M) * 8)
    const R = this._sphereR * this._scale * (1 + boost)
    const xProj = R * Math.cos(phi) * Math.sin(lam - lam0)
    const yProj = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
    return { x: this._cx + xProj, y: this._cy - yProj, visible: true, cosC }
  }

  _isBusy() {
    return !!(this._interacting || this._flying || this._inertia)
  }

  /** 中点二次贝塞尔：折线变圆润 */
  _strokeSmooth(ctx, pts) {
    const n = pts.length
    if (n < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    if (n === 2) {
      ctx.lineTo(pts[1].x, pts[1].y)
    } else {
      for (let i = 1; i < n - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) * 0.5
        const yc = (pts[i].y + pts[i + 1].y) * 0.5
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc)
      }
      ctx.lineTo(pts[n - 1].x, pts[n - 1].y)
    }
    ctx.stroke()
  }

  _drawMeridian(ctx, lonDeg, R, step) {
    const cx = this._cx
    const cy = this._cy
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG
    const lam = lonDeg * DEG
    const pts = []
    for (let latDeg = -90; latDeg <= 90; latDeg += step) {
      const phi = latDeg * DEG
      const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
      if (cosC < 0) {
        if (pts.length >= 2) this._strokeSmooth(ctx, pts)
        pts.length = 0
        continue
      }
      const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
      const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
      pts.push({ x: cx + xp, y: cy - yp })
    }
    if (pts.length >= 2) this._strokeSmooth(ctx, pts)
  }

  _drawParallel(ctx, latDeg, R, step) {
    const cx = this._cx
    const cy = this._cy
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG
    const phi = latDeg * DEG
    const pts = []
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += step) {
      const lam = lonDeg * DEG
      const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
      if (cosC < 0) {
        if (pts.length >= 2) this._strokeSmooth(ctx, pts)
        pts.length = 0
        continue
      }
      const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
      const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
      pts.push({ x: cx + xp, y: cy - yp })
    }
    if (pts.length >= 2) this._strokeSmooth(ctx, pts)
  }

  /**
   * 球体：拖动时也画海岸线（lite 仅跳过小岛填色 + 略稀疏采样，线条始终可见）
   */
  _drawSphere(ctx, lite) {
    const cx = this._cx
    const cy = this._cy
    const R = this._sphereR * this._scale
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG
    const dpr = this._dpr

    const glowR = R * 1.16
    const glow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, glowR)
    glow.addColorStop(0, 'rgba(0,170,255,0.26)')
    glow.addColorStop(0.5, 'rgba(0,120,220,0.10)')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()

    const bodyGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R)
    bodyGrad.addColorStop(0, '#14222f')
    bodyGrad.addColorStop(0.7, '#0a121c')
    bodyGrad.addColorStop(1, '#05080e')
    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()

    // 球缘
    ctx.strokeStyle = 'rgba(140,190,230,0.4)'
    ctx.lineWidth = 1.4 * dpr * 0.75
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()

    // 经纬网（圆润描边）
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = Math.max(0.8, 0.9 * dpr * 0.7)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const gridStep = lite ? 4 : 2
    for (let lonDeg = -180; lonDeg < 180; lonDeg += 30) {
      this._drawMeridian(ctx, lonDeg, R, gridStep)
    }
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      this._drawParallel(ctx, latDeg, R, gridStep)
    }

    // 海岸线（拖动也画）
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.clip()

    const coast = getCOASTLINE()
    const projectCoast = (lng, lat) => {
      const phi = lat * DEG
      const lam = lng * DEG
      const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
      const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
      const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
      return { x: cx + xp, y: cy - yp, cosC, lng, lat }
    }

    // 小岛填色仅静止时做，拖动跳过以保帧率
    if (!lite) {
      for (let c = 0; c < coast.length; c++) {
        const pts = coast[c]
        if (pts.length < 3 || pts.length > 40) continue
        let allFront = true
        const ring = []
        for (let j = 0; j < pts.length; j++) {
          const p = projectCoast(pts[j][0], pts[j][1])
          if (p.cosC < 0.02) { allFront = false; break }
          ring.push(p)
        }
        if (!allFront || ring.length < 3) continue
        ctx.beginPath()
        ctx.moveTo(ring[0].x, ring[0].y)
        for (let j = 1; j < ring.length; j++) ctx.lineTo(ring[j].x, ring[j].y)
        ctx.closePath()
        ctx.globalAlpha = 0.5
        ctx.fillStyle = '#2a3d4d'
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(175,215,240,0.62)'
    ctx.lineWidth = Math.max(1.15, 1.25 * dpr * 0.75)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // 拖动时隔点采样，静止全量；描边一律走平滑曲线
    const stride = lite ? 2 : 1

    for (let c = 0; c < coast.length; c++) {
      const pts = coast[c]
      if (!pts || pts.length < 2) continue
      let seg = []
      let prev = null
      const flushSeg = () => {
        if (seg.length >= 2) this._strokeSmooth(ctx, seg)
        seg = []
      }
      for (let j = 0; j < pts.length; j += stride) {
        // 末点保证落到真实终点，避免 stride 截断
        const idx = (stride > 1 && j + stride >= pts.length) ? pts.length - 1 : j
        const curr = projectCoast(pts[idx][0], pts[idx][1])
        const vis = curr.cosC >= 0
        if (prev) {
          const prevVis = prev.cosC >= 0
          if (prevVis && vis) {
            if (!seg.length) seg.push(prev)
            seg.push(curr)
          } else if (prevVis !== vis) {
            const denom = prev.cosC - curr.cosC
            if (Math.abs(denom) >= 1e-12) {
              const t = prev.cosC / denom
              const dLng = ((curr.lng - prev.lng + 540) % 360) - 180
              const edge = projectCoast(
                prev.lng + dLng * t,
                prev.lat + (curr.lat - prev.lat) * t
              )
              if (isFinite(edge.x) && isFinite(edge.y)) {
                if (prevVis) {
                  if (!seg.length) seg.push(prev)
                  seg.push(edge)
                  flushSeg()
                } else {
                  seg = [edge, curr]
                }
              } else {
                flushSeg()
              }
            } else {
              flushSeg()
            }
          } else {
            flushSeg()
          }
        }
        prev = curr
        if (idx === pts.length - 1) break
      }
      flushSeg()
    }
    ctx.restore()
    ctx.globalAlpha = 1.0
  }

  _drawBase(ctx, lite) {
    const w = this._canvasW
    const h = this._canvasH
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#04070d'
    ctx.fillRect(0, 0, w, h)
    if (this._stars) {
      ctx.fillStyle = '#cfe8ff'
      for (let i = 0; i < this._stars.length; i++) {
        const s = this._stars[i]
        ctx.globalAlpha = s.a
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1.0
    }
    this._drawSphere(ctx, lite)
  }

  _paintBase(ctx) {
    // lite=拖动中：仍画海岸线/经纬网，只跳过小岛填色并略稀疏
    const lite = this._isBusy()
    if (this._baseCacheOk && this._baseCanvas && this._baseCtx) {
      const key = `${this._rotLon.toFixed(2)}|${this._rotLat.toFixed(2)}|${this._scale.toFixed(3)}|${lite ? 1 : 0}|${this._canvasW}x${this._canvasH}`
      if (key !== this._baseCacheKey) {
        try {
          this._drawBase(this._baseCtx, lite)
          this._baseCacheKey = key
        } catch (e) {
          this._baseCacheOk = false
        }
      }
      if (this._baseCacheOk) {
        try {
          ctx.clearRect(0, 0, this._canvasW, this._canvasH)
          ctx.drawImage(this._baseCanvas, 0, 0)
          return
        } catch (e) {
          this._baseCacheOk = false
        }
      }
    }
    this._drawBase(ctx, lite)
  }

  _drawTrack(ctx, track) {
    if (!track || track.length < 2) return
    const dpr = this._dpr
    const baseW = 1.9 * dpr * 0.75
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // 按可见段收集后平滑描边，并分段设 alpha（头淡尾亮）
    let seg = []
    let segStart = 0
    const flush = () => {
      if (seg.length < 2) { seg = []; return }
      const mid = (segStart + segStart + seg.length - 1) / 2
      const t = mid / Math.max(1, track.length - 1)
      const alpha = 0.18 + 0.7 * t
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`
      ctx.lineWidth = baseW
      this._strokeSmooth(ctx, seg)
      seg = []
    }
    for (let i = 0; i < track.length; i++) {
      const alt = track[i].length > 2 ? track[i][2] : 0
      const pt = this._geoToPixel(track[i][0], track[i][1], alt)
      if (!pt.visible) {
        flush()
        continue
      }
      if (!seg.length) segStart = i
      seg.push(pt)
      // 每段不宜太长，避免整圈同一透明度
      if (seg.length >= 8) {
        const last = seg[seg.length - 1]
        flush()
        seg = [last]
        segStart = i
      }
    }
    flush()
  }

  /**
   * @param {number} [anchorY=0.5] 锚点相对图标高度：0=顶，0.5=中，越大图标整体越往下
   */
  _drawIcon(ctx, img, x, y, size, anchorY) {
    if (!img) return false
    const ay = anchorY == null ? 0.5 : anchorY
    try {
      ctx.drawImage(img, x - size / 2, y - size * ay, size, size)
      return true
    } catch (e) {
      return false
    }
  }

  _drawIss(ctx) {
    if (!this._iss) return
    // 对接时官网隐藏独立 ISS，改由 dragon_iss 合成图标呈现
    if (this._dockState && this._dockState.hideIss) return
    const alt = isFinite(this._iss.altM) ? this._iss.altM : 420000
    const pt = this._geoToPixel(this._iss.lat, this._iss.lng, alt)
    if (!pt.visible) return
    const dpr = this._dpr
    const size = 36 * dpr * DRAGON_ISS_ICON_SCALE
    if (!this._drawIcon(ctx, this._icons.iss, pt.x, pt.y, size, 0.5)) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillRect(pt.x - 3 * dpr, pt.y - 2 * dpr, 6 * dpr, 4 * dpr)
    }
    ctx.font = `${8 * dpr}px monospace`
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText('ISS', pt.x + size * 0.45, pt.y - size * 0.2)
  }

  _drawVehicle(ctx, v, isFeatured) {
    if (!v || v.active === false) return
    if (!isFinite(v.lat) || !isFinite(v.lng)) return
    const dock = this._dockState
    if (dock && dock.hideIds && dock.hideIds[v.id]) return null

    const alt = isFinite(v.altM) ? v.altM : 0
    const pt = this._geoToPixel(v.lat, v.lng, alt)
    if (!pt.visible) return null
    const dpr = this._dpr
    const group = v.group || 'starship'
    const dockMode = (dock && dock.dockedIds && dock.dockedIds[v.id]) || 0

    let icon
    let size
    let anchorY = 0.5
    if (group === 'dragon' && dockMode) {
      // 合成图标：固定尺寸（选中不放大，防突变）；锚点偏上，让底部小胶囊更靠下
      icon = dockMode === 2 ? (this._icons.dragonIss2 || this._icons.dragonIss) : this._icons.dragonIss
      size = 44 * dpr * DRAGON_ISS_ICON_SCALE
      anchorY = 0.28
      if (!icon) {
        icon = this._icons.dragon
        size = 22 * dpr * DRAGON_ISS_ICON_SCALE
        anchorY = 0.5
      }
    } else if (group === 'dragon') {
      icon = this._icons.dragon
      size = (isFeatured ? 24 : 20) * dpr * DRAGON_ISS_ICON_SCALE
      // 未对接但靠近 ISS 时略下移，避免叠在 ISS 中心
      if (this._iss && this._distKm(v.lat, v.lng, this._iss.lat, this._iss.lng) < 80) {
        anchorY = 0.15
        pt.y += 14 * dpr * DRAGON_ISS_ICON_SCALE
      }
    } else {
      icon = this._icons.starship
      size = (isFeatured ? 32 : 24) * dpr
    }

    if (!this._drawIcon(ctx, icon, pt.x, pt.y, size, anchorY)) {
      const s = (isFeatured ? 5 : 3.6) * dpr
      ctx.fillStyle = isFeatured ? '#ffffff' : 'rgba(200,230,255,0.85)'
      ctx.beginPath()
      ctx.moveTo(pt.x, pt.y - s)
      ctx.lineTo(pt.x + s * 0.7, pt.y)
      ctx.lineTo(pt.x, pt.y + s)
      ctx.lineTo(pt.x - s * 0.7, pt.y)
      ctx.closePath()
      ctx.fill()
    }

    const fontSize = 8.5 * dpr
    ctx.font = `${fontSize}px monospace`
    ctx.fillStyle = isFeatured ? 'rgba(255,255,255,0.95)' : 'rgba(200,230,255,0.55)'
    const label = dockMode ? ((v.label || v.id || '') + ' · ISS') : (v.label || v.id || '')
    const labelY = pt.y - size * anchorY - 2 * dpr
    ctx.fillText(label, pt.x + size * 0.42, labelY)
    return { x: pt.x, y: pt.y, size }
  }

  /** 仅画涟漪（主画布每帧调用；双环错相更顺滑） */
  _drawPulse(ctx, x, y, size) {
    const dpr = this._dpr
    const t = (Date.now() % PULSE_PERIOD) / PULSE_PERIOD
    ctx.lineCap = 'round'
    for (let k = 0; k < 2; k++) {
      const tk = (t + k * 0.5) % 1
      const r = size * (0.42 + tk * 0.85)
      const a = 0.38 * (1 - tk)
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
      ctx.lineWidth = Math.max(1, (1.1 - tk * 0.5) * dpr)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  _fxKey() {
    const vs = this._vehicles
    let sig = this._featuredId + '|'
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]
      const lat = isFinite(v.lat) ? v.lat.toFixed(3) : 'x'
      const lng = isFinite(v.lng) ? v.lng.toFixed(3) : 'x'
      sig += v.id + ':' + lat + ',' + lng + ',' + (v.showTrack ? 1 : 0) + ';'
    }
    if (this._iss) sig += 'iss:' + this._iss.lat.toFixed(3) + ',' + this._iss.lng.toFixed(3)
    return `${sig}|${this._rotLon.toFixed(2)}|${this._rotLat.toFixed(2)}|${this._scale.toFixed(3)}`
  }

  /** 轨迹 + 机标（无涟漪）画进离屏，供脉冲帧复用 */
  _paintFxLayer() {
    if (!this._fxCacheOk || !this._fxCanvas || !this._fxCtx) return false
    const key = this._fxKey()
    if (key === this._fxCacheKey) return true
    const ctx = this._fxCtx
    ctx.clearRect(0, 0, this._canvasW, this._canvasH)

    const vehicles = this._vehicles
    if (this._featuredId) {
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i]
        if (v.id !== this._featuredId) continue
        if (v.showTrack !== false) this._drawTrack(ctx, v.track)
        break
      }
    }
    this._drawIss(ctx)
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id !== this._featuredId) this._drawVehicle(ctx, vehicles[i], false)
    }
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === this._featuredId) this._drawVehicle(ctx, vehicles[i], true)
    }
    this._fxCacheKey = key
    return true
  }

  _featuredPulseAnchor() {
    if (!this._featuredId) return null
    for (let i = 0; i < this._vehicles.length; i++) {
      const v = this._vehicles[i]
      if (v.id !== this._featuredId || v.active === false) continue
      if (!isFinite(v.lat) || !isFinite(v.lng)) return null
      const alt = isFinite(v.altM) ? v.altM : 0
      const pt = this._geoToPixel(v.lat, v.lng, alt)
      if (!pt.visible) return null
      const dockMode = (this._dockState && this._dockState.dockedIds && this._dockState.dockedIds[v.id]) || 0
      let size = 32 * this._dpr
      if (v.group === 'dragon' && dockMode) size = 44 * this._dpr * DRAGON_ISS_ICON_SCALE
      else if (v.group === 'dragon') size = 24 * this._dpr * DRAGON_ISS_ICON_SCALE
      return { x: pt.x, y: pt.y, size }
    }
    return null
  }

  _renderFrame() {
    if (!this._ctx || !this._canvas || this._paused) return
    const ctx = this._ctx
    this._paintBase(ctx)

    // 拖转/飞镜：视角每帧都变，叠层缓存无意义，直接画
    if (this._isBusy() || !this._paintFxLayer()) {
      this._fxCacheKey = ''
      const vehicles = this._vehicles
      if (this._featuredId) {
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i]
          if (v.id !== this._featuredId) continue
          if (v.showTrack !== false) this._drawTrack(ctx, v.track)
          break
        }
      }
      this._drawIss(ctx)
      for (let i = 0; i < vehicles.length; i++) {
        if (vehicles[i].id !== this._featuredId) this._drawVehicle(ctx, vehicles[i], false)
      }
      let pulse = null
      for (let i = 0; i < vehicles.length; i++) {
        if (vehicles[i].id === this._featuredId) {
          pulse = this._drawVehicle(ctx, vehicles[i], true)
        }
      }
      if (pulse) this._drawPulse(ctx, pulse.x, pulse.y, pulse.size)
      return
    }

    try {
      ctx.drawImage(this._fxCanvas, 0, 0)
    } catch (e) {
      this._fxCacheOk = false
      return
    }
    const pulse = this._featuredPulseAnchor()
    if (pulse) this._drawPulse(ctx, pulse.x, pulse.y, pulse.size)
  }

  _startLoop() {
    this._stopLoop()
    const tick = () => {
      if (!this._canvas || this._paused) return
      // 交互/飞镜由各自 RAF 驱动，避免双循环
      if (!this._interacting && !this._flying) {
        this._renderFrame()
      }
      this._animTimer = setTimeout(tick, PULSE_INTERVAL)
    }
    tick()
  }

  _stopLoop() {
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null }
  }

  _startInteraction() {
    if (this._interacting) return
    this._flying = false
    this._interacting = true
    this._baseCacheKey = ''
    this._fxCacheKey = ''
    this._stopLoop()
    this._rafLoop()
  }

  _stopInteraction() {
    this._stopInertia()
    this._interacting = false
    this._baseCacheKey = ''
    this._fxCacheKey = ''
    this._cancelRaf()
    this._renderFrame()
    this._startLoop()
  }

  _stopInertia() {
    this._inertia = false
    this._velLon = 0
    this._velLat = 0
  }

  _inertiaStep() {
    const now = Date.now()
    const dt = Math.min(50, now - (this._inertiaLastTime || now))
    this._inertiaLastTime = now
    this._rotLon += this._velLon * dt
    this._rotLat = Math.max(-85, Math.min(85, this._rotLat + this._velLat * dt))
    const decay = Math.pow(0.92, dt / 16.7)
    this._velLon *= decay
    this._velLat *= decay
    if (Math.max(Math.abs(this._velLon), Math.abs(this._velLat)) < 0.003) {
      this._inertia = false
      return false
    }
    return true
  }

  _rafLoop() {
    if (!this._interacting || !this._canvas) return
    if (this._inertia && !this._touching && !this._pinching) {
      if (!this._inertiaStep()) {
        this._stopInteraction()
        return
      }
    }
    this._renderFrame()
    const raf = this._canvas.requestAnimationFrame
    if (typeof raf !== 'function') return
    try {
      this._rafId = raf.call(this._canvas, () => this._rafLoop())
    } catch (e) {
      this._rafId = null
    }
  }

  _cancelRaf() {
    if (this._rafId != null && this._canvas) {
      const cancel = this._canvas.cancelAnimationFrame
      if (typeof cancel === 'function') {
        try { cancel.call(this._canvas, this._rafId) } catch (e) { /* ignore */ }
      }
      this._rafId = null
    }
  }

  releaseInteraction() {
    this._stopInertia()
    if (!this._interacting) return
    this._interacting = false
    this._touching = false
    this._pinching = false
    this._cancelRaf()
  }

  onTouchStart(e) {
    const touches = e.touches
    this._stopInertia()
    this._startInteraction()
    if (touches.length === 2) {
      this._pinching = true
      this._touching = false
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      this._touchStartDist = Math.sqrt(dx * dx + dy * dy)
      this._touchStartScale = this._scale
    } else if (touches.length === 1) {
      this._touching = true
      this._pinching = false
      this._touchStartX = touches[0].clientX
      this._touchStartY = touches[0].clientY
      this._touchStartRotLon = this._rotLon
      this._touchStartRotLat = this._rotLat
      this._lastMoveX = touches[0].clientX
      this._lastMoveY = touches[0].clientY
      this._lastMoveTime = Date.now()
    }
  }

  onTouchMove(e) {
    const touches = e.touches
    if (this._pinching && touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ratio = dist / this._touchStartDist
      this._scale = Math.max(this._minScale, Math.min(this._maxScale, this._touchStartScale * ratio))
    } else if (this._touching && touches.length === 1) {
      const dx = touches[0].clientX - this._touchStartX
      const dy = touches[0].clientY - this._touchStartY
      this._rotLon = this._touchStartRotLon - dx * 0.3
      this._rotLat = Math.max(-85, Math.min(85, this._touchStartRotLat + dy * 0.3))
      const now = Date.now()
      const mdt = now - this._lastMoveTime
      if (mdt > 0) {
        this._velLon = -(touches[0].clientX - this._lastMoveX) * 0.3 / mdt
        this._velLat = (touches[0].clientY - this._lastMoveY) * 0.3 / mdt
      }
      this._lastMoveX = touches[0].clientX
      this._lastMoveY = touches[0].clientY
      this._lastMoveTime = now
    }
  }

  onTouchEnd() {
    const wasDragging = this._touching && !this._pinching
    this._touching = false
    this._pinching = false
    const speed = Math.max(Math.abs(this._velLon), Math.abs(this._velLat))
    const fresh = Date.now() - this._lastMoveTime < 100
    if (wasDragging && fresh && speed > 0.015 && !this._paused && this._interacting && this._canvas && this._rafId != null) {
      this._inertia = true
      this._inertiaLastTime = Date.now()
    } else {
      this._stopInteraction()
    }
  }

  pause() {
    this._paused = true
    this._flying = false
    this._stopLoop()
    this.releaseInteraction()
  }

  resume() {
    if (!this._canvas) return
    this._paused = false
    this._startLoop()
  }

  destroy() {
    this._destroyed = true
    this.releaseInteraction()
    this._flying = false
    this._stopLoop()
    this._canvas = null
    this._ctx = null
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    this._fxCanvas = null
    this._fxCtx = null
    this._fxCacheKey = ''
    this._stars = null
    this._vehicles = []
    this._icons = { starship: null, dragon: null, iss: null, dragonIss: null, dragonIss2: null }
    this._iss = null
    this._dockState = null
    this._dockSticky = Object.create(null)
  }
}

module.exports = { VehicleTrackerRenderer }
