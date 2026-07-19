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
// 缓存版本：v2 与 monitor 过境预报 / starlink-ar 三方共用同一 key，改结构需三处同步
const TLE_CACHE_VER = 2
const TLE_CACHE_TTL = 6 * 3600 * 1000
const DB_COLLECTION = 'starlink_tle'

let _sharedSatrecList = []  // { name, satrec }
let _sharedAllCount = 0

// ========== 数据获取（支持分片存储） ==========
async function fetchTLE() {
  // 1. 尝试本地缓存
  try {
    const cached = wx.getStorageSync(TLE_CACHE_KEY)
    if (cached && cached.ver === TLE_CACHE_VER && cached.data && cached.ts && (Date.now() - cached.ts < TLE_CACHE_TTL)) {
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
        ts: Date.now(), totalCount, ver: TLE_CACHE_VER
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
      ts: Date.now(), count: record.sampledCount, totalCount: record.totalCount, ver: TLE_CACHE_VER
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
const DEFAULT_RENDER_MAX = 2500

class StarlinkRenderer {
  constructor(options) {
    const opts = options || {}
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
    // 渲染采样：只影响本实例渲染列表，不动共享 _sharedSatrecList（过境预报用全量）
    this._renderMax = (opts.renderMax > 0) ? opts.renderMax : DEFAULT_RENDER_MAX
    this._renderList = null
    // 底图离屏缓存（球体+网格+海岸线+星空）
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    this._baseCacheOk = true   // OffscreenCanvas 不可用时降级为直接绘制
    // 静态星空（初始化时生成一次）
    this._stars = null
    // 辉光 sprite
    this._spriteCanvas = null
    this._spriteSize = 0
    // 惯性旋转
    this._inertia = false
    this._velLon = 0           // 度/ms
    this._velLat = 0
    this._lastMoveTime = 0
    this._lastMoveX = 0
    this._lastMoveY = 0
    // HUD 心跳点闪烁（1Hz 下切换）
    this._blinkOn = true
  }

  setRenderMax(n) {
    if (n > 0 && n !== this._renderMax) {
      this._renderMax = n
      this._renderList = null
      this._cachedPositions = []
    }
  }

  // 从共享全量列表均匀采样出本实例渲染列表（共享列表本身不动）
  _getRenderList() {
    if (this._renderList && this._renderList._srcLen === _sharedSatrecList.length) {
      return this._renderList
    }
    const src = _sharedSatrecList
    let list
    if (src.length <= this._renderMax) {
      list = src.slice()
    } else {
      list = []
      const step = src.length / this._renderMax
      for (let i = 0; i < this._renderMax; i++) {
        list.push(src[Math.floor(i * step)])
      }
    }
    list._srcLen = src.length
    this._renderList = list
    return list
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

    this._initStars()
    this._initSprite()
    this._initBaseCanvas()

    this._lastFrameTime = Date.now()
    this._paused = false
    this._startLoop()
  }

  // 静态星空：初始化时生成一次（两档大小/亮度），画入底图缓存，零逐帧成本
  _initStars() {
    const stars = []
    for (let i = 0; i < 120; i++) {
      const big = Math.random() < 0.25
      stars.push({
        x: Math.random() * this._canvasW,
        y: Math.random() * this._canvasH,
        r: (big ? 1.0 : 0.5) * this._dpr,
        a: big ? 0.30 + Math.random() * 0.35 : 0.10 + Math.random() * 0.20
      })
    }
    this._stars = stars
  }

  // 预渲染卫星辉光 sprite：#00ff88 核心 + 径向渐变柔光（禁 shadowBlur，真机极慢）
  _initSprite() {
    // 旧基础库降级：无 sprite 时主循环回退 arc+fill
    this._spriteCanvas = null
    this._spriteSize = 0
    try {
      const size = Math.max(12, Math.round(8 * this._dpr))
      const sc = wx.createOffscreenCanvas({ type: '2d', width: size, height: size })
      const c = sc && sc.getContext('2d')
      if (!c) return
      const half = size / 2
      const grad = c.createRadialGradient(half, half, 0, half, half, half)
      grad.addColorStop(0, 'rgba(210,255,235,1)')
      grad.addColorStop(0.25, 'rgba(0,255,136,0.95)')
      grad.addColorStop(0.55, 'rgba(0,255,136,0.35)')
      grad.addColorStop(1, 'rgba(0,255,136,0)')
      c.fillStyle = grad
      c.fillRect(0, 0, size, size)
      this._spriteCanvas = sc
      this._spriteSize = size
    } catch (e) { /* 保持降级态 */ }
  }

  // 底图离屏 canvas（按主画布物理尺寸）；不可用时 _baseCacheOk=false 降级直绘
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

    // 大气光晕（外发光，边缘辉光稍增强）
    const glowR = R * 1.18
    const glow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, glowR)
    glow.addColorStop(0, 'rgba(60,150,255,0.32)')
    glow.addColorStop(0.45, 'rgba(40,110,230,0.12)')
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

  // 底图 = 深空背景 + 静态星空 + 球体（光晕/网格/海岸线）
  _drawBase(ctx) {
    const w = this._canvasW
    const h = this._canvasH
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#050a12'
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

  // 视角未变时复用离屏底图，只重画卫星层；OffscreenCanvas 不可用时降级直绘
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

  _renderFrame(useCache) {
    if (!this._ctx || !this._canvas || this._paused) return
    const ctx = this._ctx
    const w = this._canvasW

    // 自动旋转（非交互时）
    const now = Date.now()
    if (!this._interacting && this._lastFrameTime) {
      const dt = (now - this._lastFrameTime) / 1000
      this._rotLon = (this._rotLon - this._autoRotateSpeed * dt) % 360
    }
    this._lastFrameTime = now

    // 背景 + 球体（底图层，视角不变时走离屏缓存）
    this._paintBase(ctx)

    // 位置数据（只算采样后的渲染列表）
    let positions
    if (useCache && this._cachedPositions.length > 0 && (now - this._cacheTime < 2000)) {
      positions = this._cachedPositions
    } else {
      positions = calcPositions(this._getRenderList())
      this._cachedPositions = positions
      this._cacheTime = now
    }

    // 画卫星点（辉光 sprite 盖章；无 sprite 时降级 arc+fill）
    const scale = this._scale
    const dotSize = Math.max(1.2, 1.2 * Math.sqrt(scale))
    const showLabels = scale >= 2.5 && !this._interacting
    const sprite = this._spriteCanvas
    const spriteDrawSize = dotSize * 5   // 含柔光外圈，核心约占 1/2
    const R = this._sphereR * scale

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]
      const pt = this._geoToPixel(p.lat, p.lng)
      if (!pt.visible) continue

      // 根据离球心距离调整亮度（边缘暗淡）
      const dx = pt.x - this._cx
      const dy = pt.y - this._cy
      const distRatio = Math.sqrt(dx * dx + dy * dy) / R
      const alpha = Math.max(0.3, 1 - distRatio * 0.5)

      ctx.globalAlpha = alpha
      if (sprite) {
        ctx.drawImage(sprite, pt.x - spriteDrawSize / 2, pt.y - spriteDrawSize / 2, spriteDrawSize, spriteDrawSize)
      } else {
        ctx.fillStyle = '#00ff88'
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, dotSize, 0, Math.PI * 2)
        ctx.fill()
      }

      if (showLabels) {
        ctx.globalAlpha = alpha * 0.7
        ctx.fillStyle = '#aaffcc'
        const fontSize = Math.max(7, 6 * Math.log2(scale + 1)) * this._dpr / 2
        ctx.font = `${fontSize}px monospace`
        let label = p.name
        if (label.startsWith('STARLINK-')) label = label.substring(9)
        else if (label.startsWith('STARLINK')) label = label.substring(8).replace(/^-/, '')
        ctx.fillText(label, pt.x + dotSize + 2, pt.y + dotSize / 2)
      }
    }
    ctx.globalAlpha = 1.0

    // 通知页面（语义 = 全量在轨数，非渲染采样数）
    if (this._onCountUpdate && !useCache) this._onCountUpdate(_sharedAllCount)

    // HUD
    this._drawHUD(ctx, w)
  }

  // 科技风 HUD：等宽字体 + 半透明细边框条 + L 形角标（1Hz 心跳点闪烁）
  _drawHUD(ctx, w) {
    const dpr = this._dpr
    const fontSize = 9 * dpr
    ctx.font = `${fontSize}px monospace`
    const total = _sharedAllCount || 0
    const text = `STARLINK TRACKING \u00B7 ${total} IN ORBIT \u00B7 LIVE`

    const padX = 8 * dpr
    const barX = 6 * dpr
    const barY = 6 * dpr
    const barH = 20 * dpr
    let textW
    try { textW = ctx.measureText(text).width } catch (e) { textW = text.length * fontSize * 0.6 }
    const dotSpace = 10 * dpr   // LIVE 心跳点位置
    const barW = textW + padX * 2 + dotSpace

    // 半透明底 + 细边框
    ctx.fillStyle = 'rgba(4,12,8,0.35)'
    ctx.fillRect(barX, barY, barW, barH)
    ctx.strokeStyle = 'rgba(0,255,136,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(barX, barY, barW, barH)

    // L 形角标（左上/右下）
    const cLen = 5 * dpr
    ctx.strokeStyle = 'rgba(0,255,136,0.9)'
    ctx.lineWidth = Math.max(1, 1 * dpr * 0.75)
    ctx.beginPath()
    ctx.moveTo(barX, barY + cLen); ctx.lineTo(barX, barY); ctx.lineTo(barX + cLen, barY)
    ctx.moveTo(barX + barW, barY + barH - cLen); ctx.lineTo(barX + barW, barY + barH); ctx.lineTo(barX + barW - cLen, barY + barH)
    ctx.stroke()

    const textY = barY + barH / 2 + fontSize * 0.35
    ctx.fillStyle = '#00ff88'
    ctx.fillText(text, barX + padX, textY)

    // LIVE 心跳点（按秒闪烁，交互 RAF 下也不会高频抖动）
    this._blinkOn = Math.floor(Date.now() / 1000) % 2 === 0
    if (this._blinkOn) {
      const dotR = 2 * dpr
      ctx.fillStyle = '#00ff88'
      ctx.fillRect(barX + padX + textW + 4 * dpr, barY + barH / 2 - dotR, dotR * 2, dotR * 2)
    }

    // 缩放指示（同风格）
    const scale = this._scale
    if (scale !== 1) {
      const zText = `ZOOM ${scale.toFixed(1)}X`
      let zW
      try { zW = ctx.measureText(zText).width } catch (e) { zW = zText.length * fontSize * 0.6 }
      const zBarW = zW + padX * 2
      const zX = w - zBarW - 6 * dpr
      ctx.fillStyle = 'rgba(4,12,8,0.35)'
      ctx.fillRect(zX, barY, zBarW, barH)
      ctx.strokeStyle = 'rgba(0,255,136,0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(zX, barY, zBarW, barH)
      ctx.fillStyle = '#00ff88'
      ctx.fillText(zText, zX + padX, textY)
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
    this._stopInertia()
    this._interacting = false
    this._cancelRaf()
    this._renderFrame(false)
    this._startLoop()
  }

  _stopInertia() {
    this._inertia = false
    this._velLon = 0
    this._velLat = 0
  }

  // 惯性一步：按时间衰减（约 0.92/帧@60fps），返回是否仍在惯性中
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
    if (this._inertia && !this._touching && !this._pinching) {
      if (!this._inertiaStep()) {
        // 速度低于阈值：结束惯性，回 1Hz 循环
        this._stopInteraction()
        return
      }
    }
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
      // 拖动 → 旋转球体视角
      const dx = touches[0].clientX - this._touchStartX
      const dy = touches[0].clientY - this._touchStartY
      // 灵敏度：拖动 1px ≈ 旋转 0.3°
      this._rotLon = this._touchStartRotLon - dx * 0.3
      this._rotLat = Math.max(-85, Math.min(85, this._touchStartRotLat + dy * 0.3))
      // 记录末速度（度/ms），用于松手惯性
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
    // 松手前有明显速度且未停顿 → 进入惯性；否则直接回 1Hz 循环
    const speed = Math.max(Math.abs(this._velLon), Math.abs(this._velLat))
    const fresh = Date.now() - this._lastMoveTime < 100
    // _rafId 非空 = RAF 循环确实在跑；RAF 不可用时不进惯性，避免 1Hz 循环停摆
    if (wasDragging && fresh && speed > 0.015 && !this._paused && this._interacting && this._canvas && this._rafId != null) {
      this._inertia = true
      this._inertiaLastTime = Date.now()
      // RAF 循环已在交互中运行，_rafLoop 内接管衰减
    } else {
      this._stopInteraction()
    }
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
    this._renderList = null
    this._baseCanvas = null
    this._baseCtx = null
    this._baseCacheKey = ''
    this._spriteCanvas = null
    this._stars = null
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

/**
 * 清空共享数据与本地缓存：当消费方发现内存/缓存里的 TLE 历元全部超龄时调用，
 * 使下一次 loadData 绕过 6h 缓存直接回源云端（否则被旧数据锁死到 TTL 过期）
 */
function resetSharedData() {
  _sharedSatrecList = []
  _sharedAllCount = 0
  try { wx.removeStorageSync(TLE_CACHE_KEY) } catch (e) { /* ignore */ }
}

module.exports = {
  loadData,
  StarlinkRenderer,
  init: loadData,
  getSharedSatrecList,
  resetSharedData,
  bindCanvas: (page, canvasId) => _getDefault().bindCanvas(page, canvasId),
  setRenderMax: (n) => { _getDefault().setRenderMax(n) },
  togglePause: () => _getDefault().togglePause(),
  isPaused: () => _getDefault().isPaused(),
  setOnCountUpdate: (cb) => { _getDefault()._onCountUpdate = cb },
  onTouchStart: (e) => { _getDefault().onTouchStart(e) },
  onTouchMove: (e) => { _getDefault().onTouchMove(e) },
  onTouchEnd: (e) => { _getDefault().onTouchEnd(e) },
  releaseInteraction: () => { if (_defaultInstance) _defaultInstance.releaseInteraction() },
  destroy: () => { if (_defaultInstance) { _defaultInstance.destroy(); _defaultInstance = null } }
}
