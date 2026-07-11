/**
 * Starlink 卫星实时渲染器（支持多实例、缩放、平移、卫星编号）
 */
const satellite = require('../libs/satellite.min.js') // monitor-pages 分包内 libs
let _COASTLINE = null
function getCOASTLINE() {
  if (!_COASTLINE) _COASTLINE = require('./world-coastline.js')
  return _COASTLINE
}

const MAX_SATS = 60000
const UPDATE_INTERVAL = 1000
const TLE_CACHE_KEY = '_starlink_tle_cache'
const TLE_CACHE_TTL = 6 * 3600 * 1000
const DB_COLLECTION = 'starlink_tle'

let _sharedSatrecList = []  // { name, satrec }
let _sharedAllCount = 0

// ========== 数据获取（支持分片存储） ==========
async function fetchTLE() {
  // 1. 尝试本地缓存
  try {
    const cached = wx.getStorageSync(TLE_CACHE_KEY)
    if (cached && cached.data && cached.ts && (Date.now() - cached.ts < TLE_CACHE_TTL)) {
      if (cached.totalCount && cached.totalCount >= 2000) {
        return { data: cached.data, format: cached.format, totalCount: cached.totalCount }
      }
      console.warn('[Starlink] 本地缓存卫星数异常:', cached.totalCount, '，强制从数据库刷新')
    }
  } catch (e) { /* ignore */ }

  // 2. 从云数据库读取（兼容分片和旧格式）
  const db = wx.cloud.database()
  const collection = db.collection(DB_COLLECTION)

  // 先尝试读取分片 0（新格式带 shardIndex 字段）
  let shard0
  try {
    const { data } = await collection.where({ shardIndex: 0 }).limit(1).get()
    shard0 = data.length > 0 ? data[0] : null
  } catch (e) {
    shard0 = null
  }

  if (shard0 && shard0.shardCount) {
    // 新格式：分片存储
    const shardCount = shard0.shardCount
    const totalCount = shard0.totalCount || 0

    // 数据新鲜度检查
    if (shard0.updatedAtMs) {
      const ageHours = (Date.now() - shard0.updatedAtMs) / 3600000
      if (ageHours > 12) {
        console.warn(`[Starlink] ⚠️ TLE 数据已 ${ageHours.toFixed(1)} 小时未更新`)
      }
    }

    // 并行读取所有分片（单片读取超时/失败不应让整体 reject，降级为空串跳过该片）
    const shardPromises = [Promise.resolve(shard0.data)]
    for (let i = 1; i < shardCount; i++) {
      shardPromises.push(
        collection.where({ shardIndex: i }).limit(1).get()
          .then(res => (res.data.length > 0 ? res.data[0].data : ''))
          .catch(() => '')
      )
    }
    const shardDataArr = await Promise.all(shardPromises)
    const mergedData = shardDataArr.filter(Boolean).join('\n')

    // 写入本地缓存
    try {
      wx.setStorageSync(TLE_CACHE_KEY, {
        data: mergedData, format: 'tle',
        ts: Date.now(), totalCount
      })
    } catch (e) { /* ignore */ }

    return { data: mergedData, format: 'tle', totalCount }
  }

  // 3. 回退：旧格式（单条记录，无 shardIndex）
  let data
  try {
    const fallbackRes = await collection.limit(1).get()
    data = fallbackRes.data
  } catch (e) {
    throw new Error('No TLE data in database')
  }
  if (!data || !data.length || !data[0].data) {
    throw new Error('No TLE data in database')
  }
  const record = data[0]

  if (record.updatedAtMs) {
    const ageHours = (Date.now() - record.updatedAtMs) / 3600000
    if (ageHours > 12) {
      console.warn(`[Starlink] ⚠️ TLE 数据已 ${ageHours.toFixed(1)} 小时未更新`)
    }
  }

  try {
    wx.setStorageSync(TLE_CACHE_KEY, {
      data: record.data, format: record.format,
      ts: Date.now(), count: record.sampledCount, totalCount: record.totalCount
    })
  } catch (e) { /* ignore */ }
  return { data: record.data, format: record.format, totalCount: record.totalCount }
}

function parseData(raw) {
  let d = raw
  if (typeof d === 'string') {
    d = d.trim()
    if (d.startsWith('[')) { try { d = JSON.parse(d) } catch (e) { /* tle */ } }
  }
  if (Array.isArray(d)) return parseJsonGP(d)
  return parseTLE(String(d))
}

function parseJsonGP(arr) {
  const sats = []
  for (const gp of arr) {
    try { sats.push({ name: gp.OBJECT_NAME || 'STARLINK', satrec: satellite.json2satrec(gp) }) } catch (e) {}
  }
  return sats
}

function parseTLE(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim())
  const sats = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1] && lines[i + 1].startsWith('1 ') && lines[i + 2] && lines[i + 2].startsWith('2 ')) {
      try { sats.push({ name: lines[i].trim(), satrec: satellite.twoline2satrec(lines[i + 1], lines[i + 2]) }) } catch (e) {}
    }
  }
  return sats
}

function calcPositions(satrecList) {
  const now = new Date()
  const gmst = satellite.gstime(now)
  const results = []
  for (let i = 0; i < satrecList.length; i++) {
    try {
      const pv = satellite.propagate(satrecList[i].satrec, now)
      if (!pv.position) continue
      const geo = satellite.eciToGeodetic(pv.position, gmst)
      results.push({
        name: satrecList[i].name,
        lat: satellite.degreesLat(geo.latitude),
        lng: satellite.degreesLong(geo.longitude)
      })
    } catch (e) {}
  }
  return results
}

async function loadData() {
  if (_sharedSatrecList.length > 0) {
    return { count: _sharedAllCount, rendered: _sharedSatrecList.length }
  }
  const result = await fetchTLE()
  const allSats = parseData(result.data)
  if (!allSats.length) throw new Error('No satellite data parsed')
  _sharedAllCount = result.totalCount || allSats.length
  if (allSats.length > MAX_SATS) {
    const step = Math.ceil(allSats.length / MAX_SATS)
    _sharedSatrecList = allSats.filter((_, i) => i % step === 0)
  } else {
    _sharedSatrecList = allSats
  }
  return { count: _sharedAllCount, rendered: _sharedSatrecList.length }
}

// ========== 渲染器类（3D 球体投影） ==========
class StarlinkRenderer {
  constructor() {
    this._canvas = null
    this._ctx = null
    this._animTimer = null
    this._canvasW = 0
    this._canvasH = 0
    this._paused = false
    this._dpr = 1
    // 球体参数
    this._sphereR = 0       // 球体半径（像素）
    this._cx = 0            // 球心 X
    this._cy = 0            // 球心 Y
    // 视角（球体旋转）
    this._rotLon = 0        // 经度偏移（水平旋转），度
    this._rotLat = 20       // 纬度偏移（垂直倾斜），度
    // 缩放
    this._scale = 1
    this._minScale = 0.5
    this._maxScale = 5
    // 触摸状态
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
    // 位置缓存
    this._cachedPositions = []
    this._cacheTime = 0
    // 自动旋转速度（度/秒）— 设为 0 关闭自转
    this._autoRotateSpeed = 0
    this._lastFrameTime = 0
    // 回调
    this._onCountUpdate = null
  }

  async bindCanvas(page, canvasId) {
    const id = canvasId || '#starlinkCanvas'
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
    if (!canvasNode || !canvasNode.node) throw new Error('Canvas node not found')

    this._canvas = canvasNode.node
    this._ctx = this._canvas.getContext('2d')
    this._dpr = wx.getWindowInfo().pixelRatio || 2

    this._canvasW = canvasNode.width * this._dpr
    this._canvasH = canvasNode.height * this._dpr
    this._canvas.width = this._canvasW
    this._canvas.height = this._canvasH

    // 球体半径 = 画布短边的 40%
    this._sphereR = Math.min(this._canvasW, this._canvasH) * 0.40
    this._cx = this._canvasW / 2
    this._cy = this._canvasH / 2

    this._lastFrameTime = Date.now()
    this._paused = false
    this._startLoop()
  }

  // 经纬度 → 正交球面投影（返回 {x, y, visible}）
  _geoToPixel(lat, lng) {
    const DEG = Math.PI / 180
    const phi = lat * DEG          // 纬度弧度
    const lam = lng * DEG          // 经度弧度
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG

    // 正交投影公式
    const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
    // cosC < 0 表示在球体背面
    if (cosC < 0) return { x: 0, y: 0, visible: false }

    const R = this._sphereR * this._scale
    const xProj = R * Math.cos(phi) * Math.sin(lam - lam0)
    const yProj = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))

    return {
      x: this._cx + xProj,
      y: this._cy - yProj,  // Canvas Y 轴向下
      visible: true
    }
  }

  // 绘制球体背景（深色球体 + 经纬网格 + 大气光晕）
  _drawSphere(ctx) {
    const cx = this._cx
    const cy = this._cy
    const R = this._sphereR * this._scale

    // 大气光晕（外发光）
    const glowR = R * 1.15
    const glow = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, glowR)
    glow.addColorStop(0, 'rgba(60,140,255,0.25)')
    glow.addColorStop(0.5, 'rgba(40,100,220,0.08)')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()

    // 球体本体（深色渐变）
    const bodyGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R)
    bodyGrad.addColorStop(0, '#1a2a3a')
    bodyGrad.addColorStop(0.7, '#0d1520')
    bodyGrad.addColorStop(1, '#060a10')
    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()

    // 球体边缘描边
    ctx.strokeStyle = 'rgba(80,160,255,0.3)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()

    // 经纬网格
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 0.8
    const DEG = Math.PI / 180
    const phi0 = this._rotLat * DEG
    const lam0 = this._rotLon * DEG

    // 经线（每 30°）
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

    // 纬线（每 30°）
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

    // 大陆轮廓（Natural Earth 数据，纯坐标数组）
    ctx.fillStyle = '#1a3a2a'
    ctx.strokeStyle = 'rgba(100,200,150,0.35)'
    ctx.lineWidth = 0.8
    for (let c = 0; c < getCOASTLINE().length; c++) {
      const pts = getCOASTLINE()[c]
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      let started = false
      for (let j = 0; j < pts.length; j++) {
        const lng = pts[j][0]
        const lat = pts[j][1]
        const phi = lat * DEG
        const lam = lng * DEG
        const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0)
        if (cosC < 0) { started = false; continue }
        const xp = R * Math.cos(phi) * Math.sin(lam - lam0)
        const yp = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0))
        if (!started) { ctx.moveTo(cx + xp, cy - yp); started = true }
        else ctx.lineTo(cx + xp, cy - yp)
      }
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 0.5
      ctx.stroke()
    }
    ctx.globalAlpha = 1.0
  }

  _renderFrame(useCache) {
    if (!this._ctx || !this._canvas || this._paused) return
    const ctx = this._ctx
    const w = this._canvasW
    const h = this._canvasH

    // 自动旋转（非交互时）
    const now = Date.now()
    if (!this._interacting && this._lastFrameTime) {
      const dt = (now - this._lastFrameTime) / 1000
      this._rotLon = (this._rotLon - this._autoRotateSpeed * dt) % 360
    }
    this._lastFrameTime = now

    ctx.clearRect(0, 0, w, h)

    // 深空背景
    ctx.fillStyle = '#050a12'
    ctx.fillRect(0, 0, w, h)

    // 球体
    this._drawSphere(ctx)

    // 位置数据
    let positions
    if (useCache && this._cachedPositions.length > 0 && (now - this._cacheTime < 2000)) {
      positions = this._cachedPositions
    } else {
      positions = calcPositions(_sharedSatrecList)
      this._cachedPositions = positions
      this._cacheTime = now
    }

    // 画卫星点
    const scale = this._scale
    const dotSize = Math.max(1.2, 1.2 * Math.sqrt(scale))
    const showLabels = scale >= 2.5 && !this._interacting

    let visibleCount = 0
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]
      const pt = this._geoToPixel(p.lat, p.lng)
      if (!pt.visible) continue
      visibleCount++

      // 根据离球心距离调整亮度（边缘暗淡）
      const dx = pt.x - this._cx
      const dy = pt.y - this._cy
      const R = this._sphereR * scale
      const distRatio = Math.sqrt(dx * dx + dy * dy) / R
      const alpha = Math.max(0.3, 1 - distRatio * 0.5)

      ctx.globalAlpha = alpha
      ctx.fillStyle = '#00ff88'
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, dotSize, 0, Math.PI * 2)
      ctx.fill()

      if (showLabels) {
        ctx.globalAlpha = alpha * 0.7
        ctx.fillStyle = '#aaffcc'
        const fontSize = Math.max(7, 6 * Math.log2(scale + 1)) * this._dpr / 2
        ctx.font = `${fontSize}px sans-serif`
        let label = p.name
        if (label.startsWith('STARLINK-')) label = label.substring(9)
        else if (label.startsWith('STARLINK')) label = label.substring(8).replace(/^-/, '')
        ctx.fillText(label, pt.x + dotSize + 2, pt.y + dotSize / 2)
      }
    }
    ctx.globalAlpha = 1.0

    // 通知页面
    if (this._onCountUpdate && !useCache) this._onCountUpdate(positions.length)

    // 左上角信息
    const infoH = 22 * this._dpr
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, 260 * this._dpr, infoH)
    ctx.fillStyle = '#00ff88'
    ctx.font = `${10 * this._dpr}px sans-serif`
    ctx.fillText(`Starlink · ${visibleCount}/${positions.length} visible · LIVE`, 6 * this._dpr, 15 * this._dpr)

    // 缩放提示
    if (scale !== 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(w - 80 * this._dpr, 0, 80 * this._dpr, infoH)
      ctx.fillStyle = '#fff'
      ctx.font = `${10 * this._dpr}px sans-serif`
      ctx.fillText(`${scale.toFixed(1)}x`, w - 74 * this._dpr, 15 * this._dpr)
    }
  }

  _startLoop() {
    this._stopLoop()
    const tick = () => {
      this._renderFrame()
      this._animTimer = setTimeout(tick, UPDATE_INTERVAL)
    }
    tick()
  }

  _stopLoop() {
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null }
  }

  // ========== 触摸交互（拖动=旋转球体，双指=缩放） ==========
  _startInteraction() {
    if (this._interacting) return
    this._interacting = true
    this._stopLoop()
    this._rafLoop()
  }

  _stopInteraction() {
    this._interacting = false
    this._cancelRaf()
    this._renderFrame(false)
    this._startLoop()
  }

  _scheduleRaf() {
    if (!this._interacting || !this._canvas) return
    const canvas = this._canvas
    const raf = canvas && canvas.requestAnimationFrame
    if (typeof raf !== 'function') return
    const cb = () => {
      if (!this._interacting || !this._canvas) return
      this._rafLoop()
    }
    if (typeof cb !== 'function') return
    try {
      this._rafId = raf.call(canvas, cb)
    } catch (e) {
      this._rafId = null
    }
  }

  _rafLoop() {
    if (!this._interacting || !this._canvas) return
    this._renderFrame(true)
    this._scheduleRaf()
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
    if (!this._interacting) return
    this._interacting = false
    this._touching = false
    this._pinching = false
    this._cancelRaf()
  }

  onTouchStart(e) {
    const touches = e.touches
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
      // 拖动 → 旋转球体视角
      const dx = touches[0].clientX - this._touchStartX
      const dy = touches[0].clientY - this._touchStartY
      // 灵敏度：拖动 1px ≈ 旋转 0.3°
      this._rotLon = this._touchStartRotLon - dx * 0.3
      this._rotLat = Math.max(-85, Math.min(85, this._touchStartRotLat + dy * 0.3))
    }
  }

  onTouchEnd() {
    this._touching = false
    this._pinching = false
    this._stopInteraction()
  }

  togglePause() {
    this._paused = !this._paused
    if (this._paused) {
      this._stopLoop()
      this.releaseInteraction()
    } else {
      this._startLoop()
    }
    return this._paused
  }

  isPaused() { return this._paused }

  destroy() {
    this.releaseInteraction()
    this._stopLoop()
    this._canvas = null
    this._ctx = null
    this._cachedPositions = []
  }
}

// ========== 兼容旧 API ==========
let _defaultInstance = null
function _getDefault() {
  if (!_defaultInstance) _defaultInstance = new StarlinkRenderer()
  return _defaultInstance
}

/** 获取已加载的 satrec 列表（供过境预报复用，避免重复读取 TLE） */
function getSharedSatrecList() {
  return _sharedSatrecList
}

module.exports = {
  loadData,
  StarlinkRenderer,
  init: loadData,
  getSharedSatrecList,
  bindCanvas: (page, canvasId) => _getDefault().bindCanvas(page, canvasId),
  togglePause: () => _getDefault().togglePause(),
  isPaused: () => _getDefault().isPaused(),
  setOnCountUpdate: (cb) => { _getDefault()._onCountUpdate = cb },
  onTouchStart: (e) => { _getDefault().onTouchStart(e) },
  onTouchMove: (e) => { _getDefault().onTouchMove(e) },
  onTouchEnd: (e) => { _getDefault().onTouchEnd(e) },
  releaseInteraction: () => { if (_defaultInstance) _defaultInstance.releaseInteraction() },
  destroy: () => { if (_defaultInstance) { _defaultInstance.destroy(); _defaultInstance = null } }
}
