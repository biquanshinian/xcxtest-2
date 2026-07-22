/**
 * ODC「Vehicle Tracker」渲染器 — Canvas 2D 正交投影地球 + 飞行器地面轨迹
 *
 * 复刻 starlink-renderer.js 的投影 / 触摸旋转 / 双指缩放 / 惯性方案，
 * 但数据侧无 TLE 依赖：页面直接喂入飞行器列表（当前位置 + 轨迹点序列）。
 *
 * 数据结构（setVehicles）：
 *   [{ id: 'ship40', label: 'FLIGHT 13', lat: -22.4, lng: 83.4, track: [[lat,lng], ...] }]
 * 轨迹按地面投影绘制（高度不参与投影，遥测数字由页面展示）。
 */
let _COASTLINE = null
function getCOASTLINE() {
  if (!_COASTLINE) _COASTLINE = require('./world-coastline.js')
  return _COASTLINE
}

const DEG = Math.PI / 180
const IDLE_INTERVAL = 1000
const FLY_DURATION = 900

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
    // 视角
    this._rotLon = 0
    this._rotLat = 20
    this._scale = 1
    this._minScale = 0.6
    this._maxScale = 4
    // 触摸
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
    // 惯性
    this._inertia = false
    this._velLon = 0
    this._velLat = 0
    this._lastMoveTime = 0
    this._lastMoveX = 0
    this._lastMoveY = 0
    this._inertiaLastTime = 0
    // 镜头飞行动画（rotateToLocation）
    this._flying = false
    this._flyFrom = null
    this._flyTo = null
    this._flyT0 = 0
    // 底图离屏缓存
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    this._baseCacheOk = true
    this._stars = null
    // 飞行器数据（页面喂入）
    this._vehicles = []
    this._featuredId = ''
    // destroy 后置位：bindCanvas 异步等待期间页面可能已卸载，须中止启动
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
    // 等待期间页面已卸载（onUnload 已调 destroy）：中止，避免定时器泄漏
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
    this._paused = false
    this._startLoop()
  }

  /** 页面喂入飞行器列表（约 1Hz），触发一次重绘 */
  setVehicles(list) {
    this._vehicles = Array.isArray(list) ? list : []
    if (!this._interacting && !this._flying && !this._paused) this._renderFrame()
  }

  setFeatured(id) {
    this._featuredId = id || ''
  }

  /** 镜头平滑对准某经纬度（选中飞行器时调用） */
  rotateToLocation(lat, lng) {
    if (!this._canvas) return
    if (!isFinite(lat) || !isFinite(lng)) return
    // 暂停中（页面隐藏）不跑动画循环，直接落位，resume 后即为对准状态
    if (this._paused) {
      this._rotLon = ((lng + 540) % 360) - 180
      this._rotLat = Math.max(-85, Math.min(85, lat))
      return
    }
    // 用户拖动/惯性中：先退出交互 RAF 循环，避免与飞行动画并行渲染
    this.releaseInteraction()
    this._stopInertia()
    // 经度取最短旋转路径
    const dLon = ((lng - this._rotLon + 540) % 360) - 180
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
    const ease = 1 - Math.pow(1 - t, 3) // ease-out cubic
    this._rotLon = this._flyFrom.lon + (this._flyTo.lon - this._flyFrom.lon) * ease
    this._rotLat = this._flyFrom.lat + (this._flyTo.lat - this._flyFrom.lat) * ease
    this._renderFrame()
    if (t >= 1) {
      this._flying = false
      this._rotLon = ((this._rotLon + 540) % 360) - 180
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

  _geoToPixel(lat, lng) {
    const phi = lat * DEG
    const lam = lng * DEG
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG
    const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
    if (cosC < 0) return { x: 0, y: 0, visible: false }
    const R = this._sphereR * this._scale
    const xProj = R * Math.cos(phi) * Math.sin(lam - lam0)
    const yProj = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
    return { x: this._cx + xProj, y: this._cy - yProj, visible: true }
  }

  // 球体：深色本体 + 青色大气光晕 + 经纬网格 + 海岸线（ODC 青色主题）
  _drawSphere(ctx) {
    const cx = this._cx
    const cy = this._cy
    const R = this._sphereR * this._scale
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG

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

    ctx.strokeStyle = 'rgba(0,180,255,0.28)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()

    // 经纬网格
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 0.8
    for (let lonDeg = -180; lonDeg < 180; lonDeg += 30) {
      ctx.beginPath()
      let started = false
      for (let latDeg = -90; latDeg <= 90; latDeg += 3) {
        const phi = latDeg * DEG
        const lam = lonDeg * DEG
        const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
        if (cosC < 0) { started = false; continue }
        const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
        const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
        if (!started) { ctx.moveTo(cx + xp, cy - yp); started = true }
        else ctx.lineTo(cx + xp, cy - yp)
      }
      ctx.stroke()
    }
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      ctx.beginPath()
      let started = false
      for (let lonDeg = -180; lonDeg <= 180; lonDeg += 3) {
        const phi = latDeg * DEG
        const lam = lonDeg * DEG
        const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
        if (cosC < 0) { started = false; continue }
        const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
        const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
        if (!started) { ctx.moveTo(cx + xp, cy - yp); started = true }
        else ctx.lineTo(cx + xp, cy - yp)
      }
      ctx.stroke()
    }

    // 海岸线：裁剪到球体圆盘内；只描可见折线（过缘插值到轮廓），
    // 禁止对跨背面的多边形 fill+closePath（否则会出现切线割裂大陆）
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

    // 小岛屿整环在正面时允许轻量填色；大洲一律描边，避免割裂
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
      ctx.globalAlpha = 0.55
      ctx.fillStyle = '#2a3d4d'
      ctx.fill()
    }

    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(170,210,235,0.55)'
    ctx.lineWidth = Math.max(1, 1.1 * this._dpr * 0.75)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (let c = 0; c < coast.length; c++) {
      const pts = coast[c]
      if (!pts || pts.length < 2) continue
      let prev = null
      ctx.beginPath()
      let drawing = false
      const flush = () => {
        if (drawing) {
          ctx.stroke()
          ctx.beginPath()
          drawing = false
        }
      }
      for (let j = 0; j < pts.length; j++) {
        const curr = projectCoast(pts[j][0], pts[j][1])
        const vis = curr.cosC >= 0
        if (prev) {
          const prevVis = prev.cosC >= 0
          if (prevVis && vis) {
            if (!drawing) { ctx.moveTo(prev.x, prev.y); drawing = true }
            ctx.lineTo(curr.x, curr.y)
          } else if (prevVis !== vis) {
            // 过缘：插值到 cosC=0 的轮廓点，避免线段在球缘戛然而止/乱连
            const denom = prev.cosC - curr.cosC
            if (Math.abs(denom) < 1e-12) { prev = curr; continue }
            const t = prev.cosC / denom
            // 经度走最短路径，避免跨日界线时插值绕远
            const dLng = ((curr.lng - prev.lng + 540) % 360) - 180
            const edge = projectCoast(
              prev.lng + dLng * t,
              prev.lat + (curr.lat - prev.lat) * t
            )
            if (!isFinite(edge.x) || !isFinite(edge.y)) { prev = curr; continue }
            if (prevVis) {
              if (!drawing) { ctx.moveTo(prev.x, prev.y); drawing = true }
              ctx.lineTo(edge.x, edge.y)
              flush()
            } else {
              ctx.moveTo(edge.x, edge.y)
              ctx.lineTo(curr.x, curr.y)
              drawing = true
            }
          }
        }
        prev = curr
      }
      flush()
    }
    ctx.restore()
    ctx.globalAlpha = 1.0
  }

  _drawBase(ctx) {
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
    this._drawSphere(ctx)
  }

  _paintBase(ctx) {
    if (this._baseCacheOk && this._baseCanvas && this._baseCtx) {
      const key = `${this._rotLon}|${this._rotLat}|${this._scale}|${this._canvasW}x${this._canvasH}`
      if (key !== this._baseCacheKey) {
        try {
          this._drawBase(this._baseCtx)
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
    this._drawBase(ctx)
  }

  // 轨迹折线：背面段断开
  _drawTrack(ctx, track, isFeatured) {
    if (!track || track.length < 2) return
    ctx.lineWidth = (isFeatured ? 1.6 : 1.1) * this._dpr * 0.75
    ctx.strokeStyle = isFeatured ? 'rgba(255,255,255,0.75)' : 'rgba(140,200,255,0.35)'
    ctx.beginPath()
    let started = false
    for (let i = 0; i < track.length; i++) {
      const pt = this._geoToPixel(track[i][0], track[i][1])
      if (!pt.visible) { started = false; continue }
      if (!started) { ctx.moveTo(pt.x, pt.y); started = true }
      else ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()

    // 轨迹终点方向小刻度（featured 才画，提示运动方向）
    if (isFeatured) {
      const last = this._geoToPixel(track[track.length - 1][0], track[track.length - 1][1])
      if (last.visible) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.beginPath()
        ctx.arc(last.x, last.y, 1.6 * this._dpr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // 飞行器标记：脉冲圈 + 白色菱形 + 标签
  _drawVehicle(ctx, v, isFeatured) {
    if (!isFinite(v.lat) || !isFinite(v.lng)) return
    const pt = this._geoToPixel(v.lat, v.lng)
    if (!pt.visible) return
    const dpr = this._dpr
    const size = (isFeatured ? 5 : 3.6) * dpr

    // 脉冲圈（featured：1.6s 周期扩散）
    if (isFeatured) {
      const t = (Date.now() % 1600) / 1600
      const pulseR = size * (1 + t * 2.2)
      ctx.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - t)).toFixed(3)})`
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, pulseR, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 菱形本体
    ctx.fillStyle = isFeatured ? '#ffffff' : 'rgba(200,230,255,0.85)'
    ctx.beginPath()
    ctx.moveTo(pt.x, pt.y - size)
    ctx.lineTo(pt.x + size * 0.7, pt.y)
    ctx.lineTo(pt.x, pt.y + size)
    ctx.lineTo(pt.x - size * 0.7, pt.y)
    ctx.closePath()
    ctx.fill()

    // 标签
    const fontSize = 8.5 * dpr
    ctx.font = `${fontSize}px monospace`
    ctx.fillStyle = isFeatured ? 'rgba(255,255,255,0.95)' : 'rgba(200,230,255,0.6)'
    ctx.fillText(v.label || v.id || '', pt.x + size + 3 * dpr, pt.y - size * 0.4)
  }

  _renderFrame() {
    if (!this._ctx || !this._canvas || this._paused) return
    const ctx = this._ctx
    this._paintBase(ctx)

    const vehicles = this._vehicles
    // 先画非选中（轨迹在标记之下）
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id !== this._featuredId) this._drawTrack(ctx, vehicles[i].track, false)
    }
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === this._featuredId) this._drawTrack(ctx, vehicles[i].track, true)
    }
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id !== this._featuredId) this._drawVehicle(ctx, vehicles[i], false)
    }
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === this._featuredId) this._drawVehicle(ctx, vehicles[i], true)
    }
  }

  _startLoop() {
    this._stopLoop()
    const tick = () => {
      if (!this._canvas) return  // destroy 后自行终止
      this._renderFrame()
      this._animTimer = setTimeout(tick, IDLE_INTERVAL)
    }
    tick()
  }

  _stopLoop() {
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null }
  }

  // ========== 触摸交互（与 starlink-renderer 同款） ==========
  _startInteraction() {
    if (this._interacting) return
    this._flying = false
    this._interacting = true
    this._stopLoop()
    this._rafLoop()
  }

  _stopInteraction() {
    this._stopInertia()
    this._interacting = false
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
    this._stars = null
    this._vehicles = []
  }
}

module.exports = { VehicleTrackerRenderer }
