/**
 * 飞行示意图 + 双级飞行遥测画布渲染（从 mission-sim 抽出，供指挥室与剖面演示复用）
 * createFlightViz({ scope, diagramId, enginesId, getSeed })
 */
/**
 * 示意图几何（归一化坐标，x 向右 y 向上；t 为任务秒，线性插值）。
 * 由引擎推断的任务剖面自动生成：一/二级各自区分「塔臂捕获」与「受控溅落」路线、
 * 有载荷部署节点则加部署标记——后续任务剖面变化无需人工改图。
 */
/** 溅落点归一化 x：一级近海偏左，二级靠右贴齐，拉开水平间距 */
var SPLASH_X_BOOSTER = 0.30
var SPLASH_X_SHIP = 0.90

function buildDiagramGeo(profile) {
  var ascent = [
    [0, 0.12, 0.03], [30, 0.15, 0.16], [62, 0.22, 0.32],
    [100, 0.31, 0.50], [150, 0.40, 0.64], [170, 0.46, 0.71], [190, 0.50, 0.74]
  ]
  var booster
  if (profile.boosterEnd === 'catch') {
    booster = ascent.concat([
      [230, 0.43, 0.62], [260, 0.35, 0.48], [310, 0.25, 0.32],
      [360, 0.18, 0.19], [400, 0.14, 0.10], [430, 0.123, 0.065], [444, 0.12, 0.05]
    ])
  } else {
    // 受控溅落：减速后落入近海回收区（偏左）
    booster = ascent.concat([
      [230, 0.47, 0.60], [260, 0.42, 0.46], [310, 0.36, 0.29],
      [360, 0.325, 0.16], [420, 0.305, 0.05], [444, SPLASH_X_BOOSTER, 0.008]
    ])
  }

  var shipHead = [
    [150, 0.40, 0.64], [200, 0.47, 0.72], [260, 0.53, 0.78], [320, 0.58, 0.82],
    [420, 0.645, 0.865], [520, 0.70, 0.90], [3000, 0.90, 0.92]
  ]
  // 二级收尾时间随任务时间线末节点（默认 T+1:05:21 = 3921s），下降段按相对偏移自动定时
  var se = profile.shipEndT || 3921
  var ship
  if (profile.shipEnd === 'catch') {
    ship = shipHead.concat([
      [se - 421, 0.94, 0.74], [se - 271, 0.85, 0.56], [se - 201, 0.72, 0.42], [se - 121, 0.56, 0.27],
      [se - 71, 0.42, 0.18], [se - 41, 0.26, 0.115], [se - 21, 0.17, 0.09], [se, 0.125, 0.05]
    ])
  } else {
    // 二级溅落靠右贴齐，与一级近海点拉开水平距离
    ship = shipHead.concat([
      [se - 421, 0.94, 0.74], [se - 271, 0.93, 0.55], [se - 201, 0.92, 0.40], [se - 121, 0.91, 0.24],
      [se - 71, 0.90, 0.12], [se - 31, 0.90, 0.04], [se, SPLASH_X_SHIP, 0.008]
    ])
  }

  var nodes = [
    { x: 0.22, y: 0.32, label: 'MAX-Q', align: 'l', c: 'g' },
    { x: 0.40, y: 0.64, label: '热分离', align: 'l', c: 'g' },
    { x: 0.50, y: 0.74, label: '反推点火', align: 'l', c: 'g' },
    { x: 0.70, y: 0.90, label: 'SECO', align: 'l', c: 'b' },
    { x: 0.94, y: 0.74, label: '再入', align: 'r', c: 'o' }
  ]
  if (profile.boosterEnd === 'splash') {
    nodes.push({ x: SPLASH_X_BOOSTER, y: 0.02, label: '一级溅落', align: 'l', c: 'g' })
  }
  if (profile.shipEnd === 'splash') {
    nodes.push({ x: 0.92, y: 0.40, label: '黑障段', align: 'l', c: 'o' })
    nodes.push({ x: SPLASH_X_SHIP, y: 0.02, label: '二级溅落', align: 'r', c: 'b' })
  } else {
    nodes.push({ x: 0.72, y: 0.42, label: '黑障段', align: 'r', c: 'o' })
    nodes.push({ x: 0.26, y: 0.115, label: '翻转点火', align: 'r', c: 'b' })
  }
  var deployPos = null
  if (profile.payloadT != null) {
    var clampT = Math.max(560, Math.min(profile.payloadT, 2960))
    deployPos = pathPos(ship, clampT)
    nodes.push({ x: deployPos.x, y: deployPos.y, label: '载荷部署', align: 'l', c: 'b' })
  }
  return { booster: booster, ship: ship, nodes: nodes, deployPos: deployPos, profile: profile }
}

var DEFAULT_GEO_PROFILE = { boosterEnd: 'splash', shipEnd: 'splash', payloadT: 1120, shipEndT: 3921 }

function pathPos(path, t) {
  if (t <= path[0][0]) return { x: path[0][1], y: path[0][2] }
  var last = path[path.length - 1]
  if (t >= last[0]) return { x: last[1], y: last[2] }
  for (var i = 1; i < path.length; i++) {
    if (t <= path[i][0]) {
      var p0 = path[i - 1]
      var p1 = path[i]
      var k = (t - p0[0]) / (p1[0] - p0[0])
      return { x: p0[1] + (p1[1] - p0[1]) * k, y: p0[2] + (p1[2] - p0[2]) * k }
    }
  }
  return { x: last[1], y: last[2] }
}

function createFlightViz(opts) {
  opts = opts || {}
  var scope = opts.scope
  var diagramSel = opts.diagramId || '#msDiagram'
  var enginesSel = opts.enginesId || '#msEngines'
  var getSeed = typeof opts.getSeed === 'function' ? opts.getSeed : function () { return 0 }

  var that = {
    _canvas: null,
    _ctx: null,
    _dpr: 1,
    _canvasW: 0,
    _canvasH: 0,
    _engCanvas: null,
    _engCtx: null,
    _engW: 0,
    _engH: 0,
    _baseCanvas: null,
    _baseOk: false,
    _trailB: [],
    _trailS: [],
    _geo: buildDiagramGeo(DEFAULT_GEO_PROFILE),
    _destroyed: false,
    _lastSnap: null,
    data: { seed: 0 },

    setGeo: function (profile) {
      this._geo = buildDiagramGeo(profile || DEFAULT_GEO_PROFILE)
      this._trailB = []
      this._trailS = []
      if (this._canvasW) this._buildBaseLayer()
    },

    clearTrails: function () {
      this._trailB = []
      this._trailS = []
    },

    destroy: function () {
      this._destroyed = true
      this._lastSnap = null
      this._canvas = null
      this._ctx = null
      this._baseCanvas = null
      this._baseOk = false
      this._engCanvas = null
      this._engCtx = null
    },

    draw: function (snap) {
      if (!snap || this._destroyed) return
      this._lastSnap = snap
      this.data.seed = getSeed()
      this._drawDiagram(snap)
      this._drawEngines(snap)
    },

    _redrawLast: function () {
      if (this._destroyed || !this._lastSnap) return
      this.data.seed = getSeed()
      if (this._ctx) this._drawDiagram(this._lastSnap)
      if (this._engCtx) this._drawEngines(this._lastSnap)
    },

    /** 静态底图：地面/发射塔/两条轨迹/节点标记，只画一次 */
    _buildBaseLayer: function () {
      var w = this._canvasW
      var h = this._canvasH
      this._baseOk = false
      var base = null
      try {
        base = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      } catch (e) { base = null }
      if (!base) return
      var ctx = base.getContext('2d')
      this._paintBase(ctx, w, h)
      this._baseCanvas = base
      this._baseOk = true
    },

    _px: function (nx, w) { return w * nx },
    _py: function (ny, h) { return h * (0.92 - ny * 0.80) },
    /** 高度(km) → 归一化 y（示意标尺：165km 顶满） */
    _altNy: function (altKm) { return altKm / 165 },

    /** 沿点列画平滑曲线（相邻中点作二次贝塞尔控制点） */
    _smoothPath: function (ctx, pts) {
      if (pts.length < 2) return
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i].x + pts[i + 1].x) / 2
        var my = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    },

    _pathToPts: function (path, w, h, fromT, toT) {
      var pts = []
      for (var i = 0; i < path.length; i++) {
        if (fromT != null && path[i][0] < fromT) continue
        if (toT != null && path[i][0] > toT) continue
        pts.push({ x: this._px(path[i][1], w), y: this._py(path[i][2], h) })
      }
      return pts
    },

    _paintBase: function (ctx, w, h) {
      var that = this
      var dpr = this._dpr
      var gy = that._py(0, h)

      /* 深空 → 地平线的垂直渐变 + 地平线辉光 */
      var sky = ctx.createLinearGradient(0, 0, 0, gy)
      sky.addColorStop(0, '#02040a')
      sky.addColorStop(0.55, '#050a14')
      sky.addColorStop(0.88, '#07131a')
      sky.addColorStop(1, '#0a1f1c')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      /* 静态星点（上半空域，三档亮度，个别加十字闪光） */
      for (var s = 0; s < 64; s++) {
        var sx = ((s * 7919) % 997) / 997
        var sy = ((s * 6101) % 883) / 883 * 0.62
        var tier = (s * 31) % 3
        ctx.globalAlpha = 0.12 + tier * 0.14
        ctx.fillStyle = '#ffffff'
        var r = (tier === 2 ? 1.2 : 0.8) * dpr
        ctx.fillRect(w * sx, h * sy, r, r)
        if (s % 17 === 0) {
          ctx.globalAlpha = 0.2
          ctx.fillRect(w * sx - 2 * dpr, h * sy, 5 * dpr, dpr * 0.6)
          ctx.fillRect(w * sx, h * sy - 2 * dpr, dpr * 0.6, 5 * dpr)
        }
      }
      ctx.globalAlpha = 1

      /* 高度标尺：50/150km 虚线 + 卡门线 100km 实线（右侧标签） */
      ctx.font = (6.5 * dpr) + 'px "Courier New", monospace'
      ctx.textAlign = 'right'
      var alts = [50, 100, 150]
      for (var a = 0; a < alts.length; a++) {
        var ay = that._py(that._altNy(alts[a]), h)
        var karman = alts[a] === 100
        ctx.strokeStyle = karman ? 'rgba(120,200,255,0.22)' : 'rgba(255,255,255,0.07)'
        ctx.lineWidth = dpr * 0.7
        ctx.setLineDash(karman ? [] : [3 * dpr, 5 * dpr])
        ctx.beginPath()
        ctx.moveTo(0, ay)
        ctx.lineTo(w, ay)
        ctx.stroke()
        ctx.fillStyle = karman ? 'rgba(120,200,255,0.45)' : 'rgba(255,255,255,0.22)'
        ctx.fillText(karman ? 'KARMAN 100KM' : (alts[a] + 'KM'), w - 5 * dpr, ay - 2.5 * dpr)
      }
      ctx.setLineDash([])
      ctx.textAlign = 'left'

      /* 地表：地面线 + 向下的渐隐地层 */
      var gnd = ctx.createLinearGradient(0, gy, 0, h)
      gnd.addColorStop(0, 'rgba(0,255,136,0.10)')
      gnd.addColorStop(1, 'rgba(0,255,136,0.01)')
      ctx.fillStyle = gnd
      ctx.fillRect(0, gy, w, h - gy)
      ctx.strokeStyle = 'rgba(0,255,136,0.4)'
      ctx.lineWidth = dpr
      ctx.beginPath()
      ctx.moveTo(0, gy)
      ctx.lineTo(w, gy)
      ctx.stroke()

      /* 发射塔：桁架塔身 + 双筷子臂 + 发射台，塔顶警示点（塔略高于全箭，对齐真实比例） */
      var tx = that._px(0.12, w)
      var th = 33 * dpr
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 2.1 * dpr
      ctx.beginPath()
      ctx.moveTo(tx, gy)
      ctx.lineTo(tx, gy - th)
      ctx.stroke()
      // 桁架斜撑
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = dpr * 0.9
      ctx.beginPath()
      for (var b = 1; b <= 4; b++) {
        var by = gy - (th / 5) * b
        ctx.moveTo(tx - 2.1 * dpr, by)
        ctx.lineTo(tx + 2.1 * dpr, by - th / 5)
      }
      ctx.stroke()
      // 筷子臂（两根，微张）
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 1.7 * dpr
      ctx.beginPath()
      ctx.moveTo(tx, gy - th * 0.78)
      ctx.lineTo(tx + 9.1 * dpr, gy - th * 0.83)
      ctx.moveTo(tx, gy - th * 0.68)
      ctx.lineTo(tx + 9.1 * dpr, gy - th * 0.63)
      ctx.stroke()
      // 发射台（OLM）
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(tx - 5.2 * dpr, gy - 2.9 * dpr, 10.4 * dpr, 2.9 * dpr)
      // 塔顶警示点
      ctx.fillStyle = 'rgba(255,69,58,0.8)'
      ctx.beginPath()
      ctx.arc(tx, gy - th - 1.8 * dpr, 1.3 * dpr, 0, Math.PI * 2)
      ctx.fill()
      // 场名
      ctx.font = (6.5 * dpr) + 'px "Courier New", monospace'
      ctx.fillStyle = 'rgba(0,255,136,0.45)'
      ctx.fillText('STARBASE', tx - 10 * dpr, gy + 9 * dpr)

      /* 溅落回收区：水面波浪 + 虚线定位圈（按剖面自动出现） */
      var geo = that._geo
      function splashZone(nx, tint) {
        var zx = that._px(nx, w)
        ctx.strokeStyle = tint
        ctx.lineWidth = dpr * 0.8
        ctx.beginPath()
        for (var k = -2; k <= 2; k++) {
          ctx.moveTo(zx + k * 5 * dpr - 2 * dpr, gy + (Math.abs(k) === 2 ? 5 : 3) * dpr)
          ctx.quadraticCurveTo(zx + k * 5 * dpr, gy + (Math.abs(k) === 2 ? 3 : 1) * dpr, zx + k * 5 * dpr + 2 * dpr, gy + (Math.abs(k) === 2 ? 5 : 3) * dpr)
        }
        ctx.stroke()
        ctx.setLineDash([2.5 * dpr, 3 * dpr])
        ctx.save()
        ctx.translate(zx, gy)
        ctx.scale(1, 0.27)
        ctx.beginPath()
        ctx.arc(0, 0, 9 * dpr, 0, Math.PI * 2)
        ctx.restore()
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (geo.profile.boosterEnd === 'splash') splashZone(SPLASH_X_BOOSTER, 'rgba(0,255,136,0.3)')
      if (geo.profile.shipEnd === 'splash') splashZone(SPLASH_X_SHIP, 'rgba(120,180,255,0.3)')

      /* 轨迹（平滑曲线，整体调淡不抢动态层）：
         助推器绿；飞船蓝，SECO 后滑行段暗虚线，再入段淡橙渐变 */
      function stroke(pts, color, width, dash) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.setLineDash(dash || [])
        that._smoothPath(ctx, pts)
        ctx.stroke()
        ctx.setLineDash([])
      }

      stroke(that._pathToPts(geo.booster, w, h), 'rgba(0,255,136,0.22)', 1.2 * dpr)
      stroke(that._pathToPts(geo.ship, w, h, null, 520), 'rgba(77,163,255,0.24)', 1.2 * dpr)
      stroke(that._pathToPts(geo.ship, w, h, 520, 3000), 'rgba(77,163,255,0.10)', 1 * dpr, [4 * dpr, 5 * dpr])
      // 再入段：蓝→橙渐变（淡）
      var entryPts = that._pathToPts(geo.ship, w, h, 3000)
      if (entryPts.length > 1) {
        var eg = ctx.createLinearGradient(entryPts[0].x, entryPts[0].y, entryPts[entryPts.length - 1].x, entryPts[entryPts.length - 1].y)
        eg.addColorStop(0, 'rgba(77,163,255,0.22)')
        eg.addColorStop(0.35, 'rgba(255,140,60,0.3)')
        eg.addColorStop(1, 'rgba(77,163,255,0.22)')
        stroke(entryPts, eg, 1.2 * dpr)
      }

      /* 节点标记：菱形 + 引出短线 + 等宽标签（低饱和） */
      ctx.font = (7 * dpr) + 'px "Courier New", monospace'
      for (var n = 0; n < geo.nodes.length; n++) {
        var nd = geo.nodes[n]
        var x = that._px(nd.x, w)
        var y = that._py(nd.y, h)
        var col = nd.c === 'g' ? 'rgba(0,255,136,0.5)' : nd.c === 'o' ? 'rgba(255,150,80,0.5)' : 'rgba(120,180,255,0.5)'
        var d = 2.2 * dpr
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(x, y - d)
        ctx.lineTo(x + d, y)
        ctx.lineTo(x, y + d)
        ctx.lineTo(x - d, y)
        ctx.closePath()
        ctx.fill()
        var dir = nd.align === 'r' ? -1 : 1
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.lineWidth = dpr * 0.7
        ctx.beginPath()
        ctx.moveTo(x + dir * d, y)
        ctx.lineTo(x + dir * (d + 4 * dpr), y - 3 * dpr)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.38)'
        var tw = ctx.measureText(nd.label).width
        ctx.fillText(nd.label, nd.align === 'r' ? x - d - 5 * dpr - tw : x + d + 5 * dpr, y - 4.5 * dpr)
      }

      /* 四角角标 */
      ctx.strokeStyle = 'rgba(0,255,136,0.45)'
      ctx.lineWidth = 2
      var L = 12 * dpr
      ctx.beginPath()
      ctx.moveTo(1, L); ctx.lineTo(1, 1); ctx.lineTo(L, 1)
      ctx.moveTo(w - L, 1); ctx.lineTo(w - 1, 1); ctx.lineTo(w - 1, L)
      ctx.moveTo(w - 1, h - L); ctx.lineTo(w - 1, h - 1); ctx.lineTo(w - L, h - 1)
      ctx.moveTo(L, h - 1); ctx.lineTo(1, h - 1); ctx.lineTo(1, h - L)
      ctx.stroke()
    },

    _drawDiagram: function (snap) {
      var ctx = this._ctx
      if (!ctx) return
      var w = this._canvasW
      var h = this._canvasH
      var dpr = this._dpr

      ctx.clearRect(0, 0, w, h)
      if (this._baseOk && this._baseCanvas) {
        try {
          ctx.drawImage(this._baseCanvas, 0, 0, w, h)
        } catch (e) {
          this._paintBase(ctx, w, h)
        }
      } else {
        this._paintBase(ctx, w, h)
      }

      var t = snap.t
      var geo = this._geo
      var gy = this._py(0, h)

      /* 点火/离塔阶段：发射台喷淋系统喷水（T-16 起水幕开启，离塔后渐收） */
      if (t >= -16 && t <= 25) {
        this._drawDeluge(ctx, this._px(0.12, w), gy, t)
      }

      /* 发射前：组合体立在发射台上；T-3 点火序列出现火焰（推力渐增） */
      if (t < 0) {
        var pad = pathPos(geo.booster, 0)
        var padX = this._px(pad.x, w)
        var stackL = 27.3 * dpr
        var cy = gy - 2.9 * dpr - stackL / 2
        var ignite = t >= -3 ? Math.min(1, (t + 3) / 2.5) : 0
        this._drawVehicle(ctx, padX, cy, -Math.PI / 2, 'stack', ignite)
      }

      /* T+0 → 热分离：组合体沿上升弧线飞行，全程主发动机燃烧 */
      if (t >= 0 && t < 150) {
        var stp = pathPos(geo.booster, t)
        var stx = this._px(stp.x, w)
        var sty = this._py(stp.y, h)
        this._pushTrail(this._trailB, stx, sty)
        this._drawTrail(ctx, this._trailB, '0,255,136')
        this._drawVehicle(ctx, stx, sty, this._headingOf(this._trailB, -Math.PI / 2), 'stack', 1)
      }

      /* 热分离后：助推器（绿）——反推点火 190-230、着陆点火 420-444 有火焰 */
      if (t >= 150 && t <= 444) {
        var bp = pathPos(geo.booster, t)
        var bx = this._px(bp.x, w)
        var by = this._py(bp.y, h)
        this._pushTrail(this._trailB, bx, by)
        this._drawTrail(ctx, this._trailB, '0,255,136')
        var bAng = this._headingOf(this._trailB, -Math.PI / 2)
        var bBurn = 0
        if (t >= 190 && t < 230) bBurn = 1          // 反推点火
        else if (t >= 420) bBurn = 1                // 着陆点火
        // 反推后尾部朝前（倒飞）
        if (t >= 190) bAng += Math.PI
        this._drawVehicle(ctx, bx, by, bAng, 'booster', bBurn)
      } else if (t > 444 && this._trailB.length) {
        this._trailB.length = 0
      }
      /* 一级溅落水花 */
      if (geo.profile.boosterEnd === 'splash' && t >= 438 && t <= 560) {
        this._drawSplash(ctx, this._px(SPLASH_X_BOOSTER, w), gy, (t - 438) / 20, '0,255,136')
      }

      /* 飞船（蓝）：入轨燃烧 150-520；载荷部署；再入等离子光晕；翻转着陆点火 3881+ */
      if (t >= 150) {
        var sp = pathPos(geo.ship, t)
        var sx = this._px(sp.x, w)
        var sy = this._py(sp.y, h)
        this._pushTrail(this._trailS, sx, sy)
        this._drawTrail(ctx, this._trailS, '77,163,255')
        if (snap.phase === 'shipEntry' && t < 3760) {
          var pg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 10 * dpr)
          pg.addColorStop(0, 'rgba(255,150,60,0.55)')
          pg.addColorStop(0.6, 'rgba(255,90,40,0.2)')
          pg.addColorStop(1, 'rgba(255,90,40,0)')
          ctx.fillStyle = pg
          ctx.beginPath()
          ctx.arc(sx, sy, 10 * dpr, 0, Math.PI * 2)
          ctx.fill()
        }
        var se = geo.profile.shipEndT || 3921
        var sAng = this._headingOf(this._trailS, -Math.PI / 2)
        var sBurn = 0
        if (t < 520) sBurn = 1                      // 上升入轨燃烧
        else if (t >= se - 40) sBurn = 1            // 翻转与着陆点火
        if (t >= se - 50) sAng += Math.PI           // 翻转后尾部朝下
        this._drawVehicle(ctx, sx, sy, sAng, 'ship', sBurn)
      }
      /* 载荷部署：部署点附近弹出的小方块载荷（随时间散开淡出） */
      var pT = geo.profile.payloadT
      if (pT != null && geo.deployPos && t >= pT && t <= pT + 900) {
        var k = (t - pT) / 900
        var dx0 = this._px(geo.deployPos.x, w)
        var dy0 = this._py(geo.deployPos.y, h)
        ctx.globalAlpha = 0.75 * (1 - k)
        ctx.fillStyle = '#9fc8ff'
        for (var pi = 0; pi < 3; pi++) {
          var off = (pi + 1) * (3 + 9 * k) * dpr
          ctx.fillRect(dx0 - off, dy0 + off * 0.35 + pi * dpr, 1.6 * dpr, 1.6 * dpr)
        }
        ctx.globalAlpha = 1
      }
      /* 二级溅落水花 */
      var seT = (geo.profile.shipEndT || 3921) - 8
      if (geo.profile.shipEnd === 'splash' && t >= seT && t <= seT + 147) {
        this._drawSplash(ctx, this._px(SPLASH_X_SHIP, w), gy, (t - seT) / 30, '120,180,255')
      }

      /* 左上读数面板 */
      var altText = snap.altKm >= 10 ? String(Math.round(snap.altKm)) : snap.altKm.toFixed(1)
      var spdText = String(Math.round(snap.speedKmh))
      ctx.fillStyle = 'rgba(3,8,6,0.62)'
      ctx.strokeStyle = 'rgba(0,255,136,0.25)'
      ctx.lineWidth = dpr * 0.7
      var pw = 78 * dpr
      var ph = 26 * dpr
      ctx.beginPath()
      ctx.rect(5 * dpr, 5 * dpr, pw, ph)
      ctx.fill()
      ctx.stroke()
      ctx.font = (8 * dpr) + 'px "Courier New", monospace'
      ctx.fillStyle = '#00ff88'
      ctx.fillText('ALT ' + altText + ' KM', 10 * dpr, 15.5 * dpr)
      ctx.fillStyle = '#4da3ff'
      ctx.fillText('SPD ' + spdText + ' KM/H', 10 * dpr, 26 * dpr)

      /* 右上任务钟 */
      ctx.textAlign = 'right'
      ctx.font = (9 * dpr) + 'px "Courier New", monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillText(snap.tText, w - 6 * dpr, 13 * dpr)
      ctx.textAlign = 'left'
    },

    _pushTrail: function (trail, x, y) {
      var last = trail[trail.length - 1]
      // 提高帧率后略放宽采样，拖尾更连贯
      if (last && Math.abs(last.x - x) < 0.35 && Math.abs(last.y - y) < 0.35) return
      trail.push({ x: x, y: y })
      if (trail.length > 40) trail.shift()
    },

    /** 渐隐拖尾：越旧越透明越细 */
    _drawTrail: function (ctx, trail, rgb) {
      var dpr = this._dpr
      var n = trail.length
      if (n < 2) return
      for (var i = 1; i < n; i++) {
        var k = i / n
        ctx.strokeStyle = 'rgba(' + rgb + ',' + (k * 0.55).toFixed(2) + ')'
        ctx.lineWidth = (0.6 + k * 1.6) * dpr
        ctx.beginPath()
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
        ctx.lineTo(trail[i].x, trail[i].y)
        ctx.stroke()
      }
    },

    /**
     * 双级飞行遥测面板（左一级 / 右二级），每半区四组件：
     * 发动机集群（一级 3+10+20、二级 3 海平面+3 真空，点亮/熄灭/失效随阶段）、
     * 飞行姿态球（人工地平仪，姿态角随飞行剖面）、速度/高度读数、推进剂 LOX/CH4 双燃料条。
     * 数据全部来自引擎快照 engines + stages 字段，级溅落/捕获完成后整半区调暗。
     */
    _drawEngines: function (snap) {
      var ctx = this._engCtx
      if (!ctx) return
      var w = this._engW
      var h = this._engH
      var dpr = this._dpr
      var eng = snap.engines || { b: 'off', bOut: 0, s: 'off' }
      var stages = snap.stages || {
        b: { alt: 0, speed: 0, fuel: 0, ori: 0, active: true },
        s: { alt: 0, speed: 0, fuel: 0, ori: 0, active: true }
      }
      var now = Date.now()
      var flick = 0.82 + 0.18 * Math.sin(now / 70)
      var hw = w / 2

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#04080c'
      ctx.fillRect(0, 0, w, h)
      // 中缝分隔线
      ctx.strokeStyle = 'rgba(0,255,136,0.12)'
      ctx.lineWidth = dpr * 0.7
      ctx.beginPath()
      ctx.moveTo(hw, 8 * dpr)
      ctx.lineTo(hw, h - 8 * dpr)
      ctx.stroke()

      function dot(x, y, r, mode) {
        // mode: 'lit' | 'off' | 'out'
        if (mode === 'lit') {
          ctx.fillStyle = 'rgba(255,179,64,' + (0.25 * flick) + ')'
          ctx.beginPath()
          ctx.arc(x, y, r * 1.9, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = 'rgba(255,205,120,' + (0.75 + 0.25 * flick) + ')'
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        } else if (mode === 'out') {
          ctx.fillStyle = 'rgba(255,69,58,0.75)'
          ctx.beginPath()
          ctx.arc(x, y, r * 0.9, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(255,120,110,0.9)'
          ctx.lineWidth = dpr * 0.8
          var s = r * 0.62
          ctx.beginPath()
          ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s)
          ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s)
          ctx.stroke()
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'
          ctx.lineWidth = dpr * 0.8
          ctx.beginPath()
          ctx.arc(x, y, r * 0.85, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      /* 人工地平仪：上蓝天下地表，随姿态角旋转；中心固定黄色机体标记 */
      function ball(cx, cy, r, oriDeg) {
        var a = oriDeg * Math.PI / 180
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.clip()
        ctx.translate(cx, cy)
        ctx.rotate(a)
        ctx.fillStyle = '#3d69a8'
        ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 1.5)
        ctx.fillStyle = '#77572f'
        ctx.fillRect(-r * 1.5, 0, r * 3, r * 1.5)
        // 地平线
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = dpr * 0.8
        ctx.beginPath()
        ctx.moveTo(-r, 0)
        ctx.lineTo(r, 0)
        ctx.stroke()
        // 俯仰刻度短线（±30/±60 位置示意）
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.lineWidth = dpr * 0.6
        ctx.beginPath()
        for (var pi = -2; pi <= 2; pi++) {
          if (pi === 0) continue
          var py = pi * r * 0.32
          var pl = (Math.abs(pi) === 1 ? 0.3 : 0.18) * r
          ctx.moveTo(-pl, py)
          ctx.lineTo(pl, py)
        }
        ctx.stroke()
        ctx.restore()
        // 外圈
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.lineWidth = dpr * 0.9
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        // 固定机体标记（黄色箭头 + 基线，不随姿态旋转）
        ctx.strokeStyle = '#ffd028'
        ctx.fillStyle = '#ffd028'
        ctx.lineWidth = dpr * 1.1
        ctx.beginPath()
        ctx.moveTo(cx, cy + r * 0.34)
        ctx.lineTo(cx, cy - r * 0.30)
        ctx.moveTo(cx - r * 0.22, cy + r * 0.34)
        ctx.lineTo(cx + r * 0.22, cy + r * 0.34)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx, cy - r * 0.46)
        ctx.lineTo(cx - r * 0.13, cy - r * 0.24)
        ctx.lineTo(cx + r * 0.13, cy - r * 0.24)
        ctx.closePath()
        ctx.fill()
      }

      /* 燃料条：LOX（蓝）/ CH4（绿）双竖条 */
      function fuelBars(x, top, hgt, pct) {
        var bw = 5 * dpr
        var gap = 4 * dpr
        var cols = [
          { c: '#4da3ff', label: 'LOX' },
          { c: '#00ff88', label: 'CH4' }
        ]
        ctx.font = (5.5 * dpr) + 'px "Courier New", monospace'
        ctx.textAlign = 'center'
        for (var i = 0; i < 2; i++) {
          var bx = x + i * (bw + gap)
          ctx.fillStyle = 'rgba(255,255,255,0.07)'
          ctx.fillRect(bx, top, bw, hgt)
          ctx.strokeStyle = 'rgba(255,255,255,0.14)'
          ctx.lineWidth = dpr * 0.6
          ctx.strokeRect(bx, top, bw, hgt)
          var fh = hgt * Math.max(0, Math.min(100, pct)) / 100
          ctx.fillStyle = pct <= 12 ? 'rgba(255,120,90,0.9)' : cols[i].c
          ctx.fillRect(bx, top + hgt - fh, bw, fh)
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.fillText(cols[i].label, bx + bw / 2, top + hgt + 7 * dpr)
        }
        ctx.textAlign = 'left'
      }

      var that = this
      var seedNum = this.data.seed || 0

      /* ---------- 半区绘制（x0 起点，一级/二级共用骨架） ---------- */
      function halfPanel(x0, stage, info) {
        ctx.save()
        ctx.globalAlpha = info.active ? 1 : 0.42

        /* 顶部标题：英文名+计数居左上，中文名居右上 */
        ctx.font = (7.5 * dpr) + 'px "Courier New", monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillText(info.en, x0 + 8 * dpr, 12 * dpr)
        ctx.fillStyle = info.lit > 0 ? '#ffb340' : 'rgba(255,255,255,0.3)'
        ctx.fillText(info.lit + '/' + info.total, x0 + 8 * dpr, 22 * dpr)
        if (info.out > 0) {
          ctx.fillStyle = 'rgba(255,110,100,0.9)'
          ctx.fillText('OUT ' + info.out, x0 + 8 * dpr, 32 * dpr)
        }
        ctx.textAlign = 'right'
        ctx.font = (7 * dpr) + 'px "Courier New", monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.fillText(info.zh, x0 + hw - 8 * dpr, 12 * dpr)
        ctx.textAlign = 'left'

        var cy = h * 0.58
        var R = Math.min(h * 0.22, hw * 0.13)

        /* 1) 发动机集群 */
        var ccx = x0 + hw * 0.17
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'
        ctx.lineWidth = dpr * 0.7
        ctx.beginPath()
        ctx.arc(ccx, cy, R * 1.22, 0, Math.PI * 2)
        ctx.stroke()
        info.drawCluster(ccx, cy, R)

        /* 2) 飞行姿态球 */
        ball(x0 + hw * 0.47, cy, R * 0.88, stage.ori)

        /* 3) 速度 / 高度 */
        var tx0 = x0 + hw * 0.62
        ctx.font = (5.8 * dpr) + 'px "Courier New", monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.38)'
        ctx.fillText('SPEED', tx0, cy - R * 0.72)
        ctx.fillText('ALTITUDE', tx0, cy + R * 0.30)
        ctx.font = 'bold ' + (8 * dpr) + 'px "Courier New", monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        var spdStr = String(stage.speed)
        var altText = stage.alt >= 10 ? String(Math.round(stage.alt)) : stage.alt.toFixed(1)
        ctx.fillText(spdStr, tx0, cy - R * 0.14)
        ctx.fillText(altText, tx0, cy + R * 0.82)
        var spdW = ctx.measureText(spdStr).width
        var altW = ctx.measureText(altText).width
        ctx.font = (5.2 * dpr) + 'px "Courier New", monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillText('KM/H', tx0 + spdW + 3 * dpr, cy - R * 0.14)
        ctx.fillText('KM', tx0 + altW + 3 * dpr, cy + R * 0.82)

        /* 4) 推进剂燃料条 */
        fuelBars(x0 + hw - 20 * dpr, cy - R * 0.95, R * 1.9, stage.fuel)

        ctx.restore()
      }

      /* ---- 一级 Super Heavy：33 台（3+10+20） ---- */
      var bMode = eng.b
      var innerLit = bMode === 'ignite' || bMode === 'full' || bMode === 'boostback' || bMode === 'landing13' || bMode === 'landing3'
      var midLit = bMode === 'ignite' || bMode === 'full' || bMode === 'boostback' || bMode === 'landing13'
      var outerLit = bMode === 'ignite' || bMode === 'full'
      var outMap = {}
      for (var f = 0; f < (eng.bOut || 0); f++) {
        outMap[(seedNum + f * 7) % 20] = true
      }
      var bLit = (innerLit ? 3 : 0) + (midLit ? 10 : 0)
      if (outerLit) bLit += 20 - (eng.bOut || 0)

      halfPanel(0, stages.b, {
        en: 'SUPER HEAVY',
        zh: '一级发动机',
        lit: bLit,
        total: 33,
        out: eng.bOut || 0,
        active: stages.b.active,
        drawCluster: function (ccx, ccy, R) {
          var dotR = R * 0.105
          for (var i = 0; i < 3; i++) {
            var a0 = -Math.PI / 2 + i * (Math.PI * 2 / 3)
            dot(ccx + Math.cos(a0) * R * 0.24, ccy + Math.sin(a0) * R * 0.24, dotR, innerLit ? 'lit' : 'off')
          }
          for (var j = 0; j < 10; j++) {
            var a1 = -Math.PI / 2 + j * (Math.PI * 2 / 10)
            dot(ccx + Math.cos(a1) * R * 0.62, ccy + Math.sin(a1) * R * 0.62, dotR, midLit ? 'lit' : 'off')
          }
          for (var k = 0; k < 20; k++) {
            var a2 = -Math.PI / 2 + k * (Math.PI * 2 / 20)
            dot(ccx + Math.cos(a2) * R, ccy + Math.sin(a2) * R, dotR, outMap[k] ? 'out' : (outerLit ? 'lit' : 'off'))
          }
        }
      })

      /* ---- 二级 Ship：6 台（3 海平面 + 3 真空） ---- */
      var sMode = eng.s
      var slLit = sMode === 'full' || sMode === 'landing' // 海平面 3 台
      var vacLit = sMode === 'full'                        // 真空 3 台（着陆点火不点）
      var sLit = (slLit ? 3 : 0) + (vacLit ? 3 : 0)

      halfPanel(hw, stages.s, {
        en: 'SHIP',
        zh: '二级发动机',
        lit: sLit,
        total: 6,
        out: 0,
        active: stages.s.active,
        drawCluster: function (ccx, ccy, R) {
          for (var v = 0; v < 3; v++) {
            var a3 = -Math.PI / 2 + v * (Math.PI * 2 / 3)
            dot(ccx + Math.cos(a3) * R * 0.68, ccy + Math.sin(a3) * R * 0.68, R * 0.24, vacLit ? 'lit' : 'off')
          }
          for (var q = 0; q < 3; q++) {
            var a4 = Math.PI / 2 + q * (Math.PI * 2 / 3)
            dot(ccx + Math.cos(a4) * R * 0.26, ccy + Math.sin(a4) * R * 0.26, R * 0.13, slLit ? 'lit' : 'off')
          }
        }
      })
    },

    /** 发射台喷淋系统：点火前后从台座两侧喷出的水幕弧线 + 底部水雾 */
    _drawDeluge: function (ctx, tx, gy, t) {
      var dpr = this._dpr
      var now = Date.now()
      // 强度：T-16 开启 → 全量 → T+10 后渐收
      var power = t < 10 ? 1 : Math.max(0, 1 - (t - 10) / 15)
      if (power <= 0) return
      var flick = 0.85 + 0.15 * Math.sin(now / 60)

      for (var side = -1; side <= 1; side += 2) {
        for (var j = 0; j < 4; j++) {
          var reach = (6 + j * 3.2) * dpr * power * flick
          var rise = (3.5 + j * 1.1) * dpr * power
          var x0 = tx + side * 3 * dpr
          var y0 = gy - 1.2 * dpr
          ctx.strokeStyle = 'rgba(165,215,255,' + (0.4 - j * 0.07) * power + ')'
          ctx.lineWidth = (1.1 - j * 0.15) * dpr
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.quadraticCurveTo(x0 + side * reach * 0.45, y0 - rise, x0 + side * reach, gy)
          ctx.stroke()
        }
      }
      // 底部水雾
      var mist = ctx.createRadialGradient(tx, gy, 0, tx, gy, 16 * dpr * power)
      mist.addColorStop(0, 'rgba(190,225,255,' + 0.2 * power + ')')
      mist.addColorStop(1, 'rgba(190,225,255,0)')
      ctx.fillStyle = mist
      ctx.beginPath()
      ctx.arc(tx, gy, 16 * dpr * power, 0, Math.PI, true)
      ctx.fill()
    },

    /** 溅落水花：扩散涟漪 + 初段升腾水柱（k 0→1 展开淡出） */
    _drawSplash: function (ctx, x, gy, k, rgb) {
      var dpr = this._dpr
      if (k < 0) return
      k = Math.min(1, k)
      var fade = 1 - k
      // 涟漪（两圈扩散椭圆）
      for (var r = 0; r < 2; r++) {
        var rad = (4 + (k * 10) + r * 4) * dpr
        ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.5 * fade - r * 0.15) + ')'
        ctx.lineWidth = dpr
        ctx.save()
        ctx.translate(x, gy)
        ctx.scale(1, 0.3)
        ctx.beginPath()
        ctx.arc(0, 0, rad, 0, Math.PI * 2)
        ctx.restore()
        ctx.stroke()
      }
      // 初段水柱
      if (k < 0.45) {
        var col = (1 - k / 0.45)
        ctx.strokeStyle = 'rgba(210,235,255,' + 0.6 * col + ')'
        ctx.lineWidth = 1.2 * dpr
        ctx.beginPath()
        ctx.moveTo(x, gy)
        ctx.lineTo(x, gy - (5 + 4 * col) * dpr)
        ctx.moveTo(x - 2.5 * dpr, gy)
        ctx.lineTo(x - 3.5 * dpr, gy - 3.5 * col * dpr)
        ctx.moveTo(x + 2.5 * dpr, gy)
        ctx.lineTo(x + 3.5 * dpr, gy - 3.5 * col * dpr)
        ctx.stroke()
      }
    },

    /** 由拖尾最近两点推航向角；不足时用 fallback（默认机头朝上） */
    _headingOf: function (trail, fallback) {
      if (trail && trail.length >= 2) {
        var p1 = trail[trail.length - 1]
        var p0 = trail[trail.length - 2]
        var dx = p1.x - p0.x
        var dy = p1.y - p0.y
        if (dx * dx + dy * dy > 0.2) return Math.atan2(dy, dx)
      }
      return fallback
    },

    /**
     * 星舰简化矢量图（本地坐标：机头朝 +x，发动机在 -x 端）
     * kind: 'stack' 组合体 / 'booster' 助推器 / 'ship' 飞船
     * burn: 0-1 发动机推力，>0 时画双层摆动火焰
     */
    _drawVehicle: function (ctx, x, y, ang, kind, burn) {
      var dpr = this._dpr
      var L, W, noseL, accent
      if (kind === 'stack') { L = 27.3 * dpr; W = 4.2 * dpr; noseL = 6.2 * dpr; accent = 'rgba(0,255,136,0.9)' }
      else if (kind === 'booster') { L = 18.2 * dpr; W = 3.9 * dpr; noseL = 0; accent = 'rgba(0,255,136,0.9)' }
      else { L = 15.4 * dpr; W = 4.2 * dpr; noseL = 5 * dpr; accent = 'rgba(120,180,255,0.9)' }
      var half = L / 2

      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(ang)

      /* 尾焰（画在箭体下层） */
      if (burn > 0) {
        var now = Date.now()
        var flick = 0.8 + 0.14 * Math.sin(now / 47) + 0.06 * Math.sin(now / 89 + x)
        var fl = (7 + 4 * flick) * dpr * burn
        var fw = W * 0.62
        // 外焰：橙红渐变
        var og = ctx.createLinearGradient(-half, 0, -half - fl, 0)
        og.addColorStop(0, 'rgba(255,190,80,0.9)')
        og.addColorStop(0.45, 'rgba(255,120,40,0.55)')
        og.addColorStop(1, 'rgba(255,70,20,0)')
        ctx.fillStyle = og
        ctx.beginPath()
        ctx.moveTo(-half, -fw)
        ctx.quadraticCurveTo(-half - fl * 0.55, -fw * 0.55, -half - fl, 0)
        ctx.quadraticCurveTo(-half - fl * 0.55, fw * 0.55, -half, fw)
        ctx.closePath()
        ctx.fill()
        // 内焰：亮黄白
        var ig = ctx.createLinearGradient(-half, 0, -half - fl * 0.55, 0)
        ig.addColorStop(0, 'rgba(255,255,220,0.95)')
        ig.addColorStop(1, 'rgba(255,190,90,0)')
        ctx.fillStyle = ig
        ctx.beginPath()
        ctx.moveTo(-half, -fw * 0.45)
        ctx.quadraticCurveTo(-half - fl * 0.32, 0, -half - fl * 0.55, 0)
        ctx.quadraticCurveTo(-half - fl * 0.32, 0, -half, fw * 0.45)
        ctx.closePath()
        ctx.fill()
        // 发动机口辉光
        ctx.fillStyle = 'rgba(255,200,120,0.8)'
        ctx.beginPath()
        ctx.arc(-half, 0, W * 0.4, 0, Math.PI * 2)
        ctx.fill()
      }

      /* 箭体：不锈钢渐变 */
      var bodyEnd = half - noseL
      var bg = ctx.createLinearGradient(0, -W / 2, 0, W / 2)
      bg.addColorStop(0, 'rgba(235,240,244,0.95)')
      bg.addColorStop(0.5, 'rgba(196,206,214,0.95)')
      bg.addColorStop(1, 'rgba(150,160,170,0.95)')
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.moveTo(-half, -W / 2)
      ctx.lineTo(bodyEnd, -W / 2)
      if (noseL > 0) {
        // 头锥（二次曲线收尖）
        ctx.quadraticCurveTo(half - noseL * 0.25, -W / 2, half, 0)
        ctx.quadraticCurveTo(half - noseL * 0.25, W / 2, bodyEnd, W / 2)
      } else {
        ctx.lineTo(half, -W / 2)
        ctx.lineTo(half, W / 2)
        ctx.lineTo(bodyEnd, W / 2)
      }
      ctx.lineTo(-half, W / 2)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = accent
      ctx.lineWidth = 0.55 * dpr
      ctx.stroke()

      /* 细节：翼面 / 格栅舵 / 级间段 */
      ctx.fillStyle = 'rgba(120,130,140,0.9)'
      if (kind === 'ship' || kind === 'stack') {
        // 后襟翼
        ctx.beginPath()
        ctx.moveTo(-half + 0.65 * dpr, -W / 2)
        ctx.lineTo(-half + 2.9 * dpr, -W / 2 - 1.7 * dpr)
        ctx.lineTo(-half + 4.2 * dpr, -W / 2)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(-half + 0.65 * dpr, W / 2)
        ctx.lineTo(-half + 2.9 * dpr, W / 2 + 1.7 * dpr)
        ctx.lineTo(-half + 4.2 * dpr, W / 2)
        ctx.closePath()
        ctx.fill()
        // 前襟翼
        var fx = kind === 'stack' ? bodyEnd - 2.1 * dpr : bodyEnd - 0.8 * dpr
        ctx.beginPath()
        ctx.moveTo(fx - 1.6 * dpr, -W / 2)
        ctx.lineTo(fx, -W / 2 - 1.3 * dpr)
        ctx.lineTo(fx + 1.0 * dpr, -W / 2)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(fx - 1.6 * dpr, W / 2)
        ctx.lineTo(fx, W / 2 + 1.3 * dpr)
        ctx.lineTo(fx + 1.0 * dpr, W / 2)
        ctx.closePath()
        ctx.fill()
      }
      if (kind === 'booster' || kind === 'stack') {
        // 格栅舵（靠机头端的两个小方块）
        var gx = kind === 'stack' ? -half + L * 0.56 : half - 2.3 * dpr
        ctx.fillStyle = 'rgba(90,100,110,0.95)'
        ctx.fillRect(gx - 0.9 * dpr, -W / 2 - 1.4 * dpr, 2.1 * dpr, 1.4 * dpr)
        ctx.fillRect(gx - 0.9 * dpr, W / 2, 2.1 * dpr, 1.4 * dpr)
      }
      if (kind === 'stack') {
        // 级间分界线
        ctx.strokeStyle = 'rgba(60,70,80,0.8)'
        ctx.lineWidth = 0.8 * dpr
        ctx.beginPath()
        ctx.moveTo(-half + L * 0.58, -W / 2)
        ctx.lineTo(-half + L * 0.58, W / 2)
        ctx.stroke()
      }
      // 发动机段暗带
      ctx.fillStyle = 'rgba(70,78,86,0.9)'
      ctx.fillRect(-half, -W / 2, 1.4 * dpr, W)

      ctx.restore()
    }
  }

  function querySelect(sel, attempt, onNode) {
    if (that._destroyed) return
    attempt = attempt || 0
    if (attempt > 8) return
    var q = (scope && typeof scope.createSelectorQuery === 'function')
      ? scope.createSelectorQuery()
      : wx.createSelectorQuery().in(scope)
    q.select(sel).fields({ node: true, size: true }).exec(function (res) {
      if (that._destroyed) return
      if (!res || !res[0] || !res[0].node) {
        setTimeout(function () { querySelect(sel, attempt + 1, onNode) }, 200)
        return
      }
      onNode(res[0])
    })
  }

  that._initCanvas = function (attempt) {
    if (that._destroyed) return
    querySelect(diagramSel, attempt || 0, function (info) {
      var canvas = info.node
      var dpr = wx.getWindowInfo().pixelRatio || 2
      that._canvasW = info.width * dpr
      that._canvasH = info.height * dpr
      canvas.width = that._canvasW
      canvas.height = that._canvasH
      that._canvas = canvas
      that._ctx = canvas.getContext('2d')
      that._dpr = dpr
      that._buildBaseLayer()
      // 异步拿到 canvas 后立刻补一帧，避免首屏空白等到下一 tick
      that._redrawLast()
    })
    that._initEngineCanvas(0)
  }

  that._initEngineCanvas = function (attempt) {
    if (that._destroyed) return
    querySelect(enginesSel, attempt || 0, function (info) {
      var canvas = info.node
      var dpr = wx.getWindowInfo().pixelRatio || 2
      that._engW = info.width * dpr
      that._engH = info.height * dpr
      canvas.width = that._engW
      canvas.height = that._engH
      that._engCanvas = canvas
      that._engCtx = canvas.getContext('2d')
      that._redrawLast()
    })
  }

  that.init = function (attempt) { that._initCanvas(attempt) }
  that.initEngines = function (attempt) { that._initEngineCanvas(attempt) }

  return that
}

module.exports = {
  createFlightViz: createFlightViz,
  buildDiagramGeo: buildDiagramGeo,
  pathPos: pathPos,
  DEFAULT_GEO_PROFILE: DEFAULT_GEO_PROFILE
}
