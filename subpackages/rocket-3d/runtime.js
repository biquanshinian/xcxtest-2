/**
 * three.js 场景装配：WebGL 渲染、OrbitControls、远端 GLB、销毁。
 * lib 由调用方懒加载，避免未点「查看模型」就解析整包。
 */

var PIXEL_RATIO_CAP = 2
var ipScaleRef = require('../../utils/ip-scale-ref.js')
var ipIntro = require('./ip-intro.js')
var ipChat3d = require('./ip-chat-3d.js')
var ipAnim = require('./ip-anim.js')

// 视口清屏色与组件 wxss 的 .r3d-stage 背景一一对应（深 / 浅主题）
var CLEAR_COLOR_DARK = 0x07080c
var CLEAR_COLOR_LIGHT = 0xdde3ec
var CLEAR_COLOR_EXHIBIT = 0x050608

/** 按主题切换渲染器清屏色（渲染循环下一帧生效） */
function applyClearColor(session, light) {
  if (!session || !session.renderer) return
  if (session.exhibit) {
    session.renderer.setClearColor(CLEAR_COLOR_EXHIBIT, 1)
    return
  }
  session.renderer.setClearColor(light ? CLEAR_COLOR_LIGHT : CLEAR_COLOR_DARK, 1)
}

function capPixelRatio(raw) {
  var n = Number(raw)
  if (!isFinite(n) || n <= 0) return 1
  return Math.min(PIXEL_RATIO_CAP, n)
}

function waitMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function measureCanvasBox(component, selector, attempt) {
  var left = attempt == null ? 6 : attempt
  return new Promise(function (resolve, reject) {
    wx.createSelectorQuery()
      .in(component)
      .select(selector)
      .boundingClientRect()
      .exec(function (res) {
        var rect = res && res[0]
        if (rect && rect.width && rect.height) {
          resolve(rect)
          return
        }
        if (left <= 1) {
          reject(new Error('3D 画布尺寸无效'))
          return
        }
        waitMs(50)
          .then(function () {
            return measureCanvasBox(component, selector, left - 1)
          })
          .then(resolve, reject)
      })
  })
}

function disposeObject3D(root) {
  if (!root) return
  root.traverse(function (child) {
    if (child.geometry && child.geometry.dispose) child.geometry.dispose()
    var mats = child.material
    if (!mats) return
    var list = Array.isArray(mats) ? mats : [mats]
    for (let i = 0; i < list.length; i++) {
      var m = list[i]
      if (!m) continue
      Object.keys(m).forEach(function (key) {
        var val = m[key]
        if (val && val.isTexture && val.dispose) val.dispose()
      })
      if (m.dispose) m.dispose()
    }
  })
}

function meshWorldBox(child, THREE) {
  var box = new THREE.Box3()
  if (child.geometry) {
    if (!child.geometry.boundingBox && child.geometry.computeBoundingBox) {
      child.geometry.computeBoundingBox()
    }
    if (child.geometry.boundingBox) {
      box.copy(child.geometry.boundingBox)
      if (typeof child.updateWorldMatrix === 'function') child.updateWorldMatrix(true, false)
      if (child.matrixWorld && typeof box.applyMatrix4 === 'function') box.applyMatrix4(child.matrixWorld)
      if (!box.isEmpty()) return box
    }
  }
  if (typeof box.setFromObject === 'function') box.setFromObject(child)
  return box
}

var ENV_NAME_RE =
  /ground|floor|backdrop|skybox|terrain|grass|ocean|water|helipad|landing.?pad|environment|plinth|pedestal|shadow.?catcher/i

function meshNameHay(child) {
  var mat = ''
  if (child.material) {
    var first = Array.isArray(child.material) ? child.material[0] : child.material
    mat = String((first && first.name) || '')
  }
  var parent = child.parent ? String(child.parent.name || '') : ''
  return String(child.name || '') + ' ' + parent + ' ' + mat
}

function isEnvMeshName(child) {
  return ENV_NAME_RE.test(meshNameHay(child))
}

function isIpRefObject(obj) {
  var o = obj
  while (o) {
    if (o.userData && o.userData.r3dIpRef) return true
    if (o.name && String(o.name).indexOf('r3d-ip') === 0) return true
    o = o.parent
  }
  return false
}

/** 参照人碰撞用整船水平盒，含助推器/外壳；取景盒只认细长箭体会把人摆进体积里。 */
function getIpCollisionBox(object, THREE) {
  if (!THREE || !THREE.Box3) return null
  var box = new THREE.Box3()
  if (!object) return box
  var has = false
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  if (typeof object.traverse === 'function') {
    object.traverse(function (child) {
      if (!child || !child.isMesh || !child.geometry) return
      if (child.visible === false) return
      if (isEnvMeshName(child)) return
      if (isIpRefObject(child)) return
      var part = meshWorldBox(child, THREE)
      if (!part || part.isEmpty()) return
      if (!has) {
        box.copy(part)
        has = true
      } else box.union(part)
    })
  }
  if (!has && typeof box.setFromObject === 'function') {
    box.setFromObject(object)
    has = !box.isEmpty()
  }
  return box
}

/** 偏爱细高箭体；体积不参与，避免机库/广场把箭体比下去 */
function meshRocketScore(size) {
  var max = Math.max(size.x, size.y, size.z)
  var min = Math.min(size.x, size.y, size.z)
  if (max <= 0) return 0
  if (min / max < 0.012) return 0
  var height = size.y >= size.z ? size.y : size.z
  var width = size.y >= size.z ? Math.max(size.x, size.z, 0.0001) : Math.max(size.x, size.y, 0.0001)
  var tall = Math.min(height / width, 10)
  return tall * tall * Math.log(1 + height)
}

function boxesNear(a, b, reach) {
  var dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x))
  var dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y))
  var dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z))
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= reach
}

function xzGap(a, b) {
  var dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x))
  var dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z))
  return Math.sqrt(dx * dx + dz * dz)
}

function yGap(a, b) {
  return Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y))
}

/** 把同一竖列上的头罩/级间段/发动机并进取景盒，不改网格 */
function expandRocketColumn(box, items, THREE) {
  if (!box || !items || !items.length) return box
  var size = box.getSize(new THREE.Vector3())
  var colW = Math.max(size.x, size.z, 0.0001)
  var colH = Math.max(size.y, 0.0001)
  var changed = true
  var guard = 0
  while (changed && guard < 10) {
    changed = false
    guard++
    for (var i = 0; i < items.length; i++) {
      var it = items[i]
      var itY = it.box.max.y - it.box.min.y
      var itXZ = Math.max(it.box.max.x - it.box.min.x, it.box.max.z - it.box.min.z, 0.0001)
      if (itXZ > colW * 3.6 && itY < colH * 0.28) continue
      if (itXZ > colW * 5.5) continue
      if (xzGap(box, it.box) > colW * 0.95) continue
      if (yGap(box, it.box) > Math.max(colH, itY) * 0.42) continue
      var prevMinY = box.min.y
      var prevMaxY = box.max.y
      var prevMinX = box.min.x
      var prevMaxX = box.max.x
      var prevMinZ = box.min.z
      var prevMaxZ = box.max.z
      box.union(it.box)
      if (
        box.min.y !== prevMinY ||
        box.max.y !== prevMaxY ||
        box.min.x !== prevMinX ||
        box.max.x !== prevMaxX ||
        box.min.z !== prevMinZ ||
        box.max.z !== prevMaxZ
      ) {
        changed = true
        size = box.getSize(new THREE.Vector3())
        colW = Math.max(size.x, size.z, colW)
        colH = Math.max(size.y, colH)
      }
    }
  }
  return box
}

/** 展板/取景失败时用整模，细长箭仍排除机库。不改模型。 */
function getExhibitFrameBox(object, THREE) {
  var full = new THREE.Box3()
  if (object) full.setFromObject(object)
  var rocket = getRenderableBox(object, THREE)
  if (!rocket || rocket.isEmpty()) return full
  if (!object || full.isEmpty()) return rocket
  var fullSize = full.getSize(new THREE.Vector3())
  if (isBoardSize(fullSize)) return full
  var rocketSize = rocket.getSize(new THREE.Vector3())
  var fullMax = Math.max(fullSize.x, fullSize.y, fullSize.z)
  var rocketMax = Math.max(rocketSize.x, rocketSize.y, rocketSize.z)
  if (fullMax > 0 && rocketMax / fullMax < 0.12) return full
  return rocket
}

/** 只用于取景/灯光/展台，不改模型本身 */
function getRenderableBox(object, THREE) {
  var fallback = new THREE.Box3()
  if (!object) return fallback
  fallback.setFromObject(object)
  if (!object.traverse) return fallback
  var items = []
  object.updateWorldMatrix && object.updateWorldMatrix(true, true)
  object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    if (child.visible === false) return
    if (isEnvMeshName(child)) return
    if (isIpRefObject(child)) return
    var box = meshWorldBox(child, THREE)
    if (!box || box.isEmpty()) return
    var size = box.getSize(new THREE.Vector3())
    var score = meshRocketScore(size)
    if (score <= 0) return
    var height = size.y >= size.z ? size.y : size.z
    var width = size.y >= size.z ? Math.max(size.x, size.z, 0.0001) : Math.max(size.x, size.y, 0.0001)
    items.push({
      box: box,
      score: score,
      max: Math.max(size.x, size.y, size.z),
      height: height,
      tall: height / width
    })
  })
  if (!items.length) return fallback
  var slender = []
  for (var s = 0; s < items.length; s++) {
    if (items[s].tall >= 1.35) slender.push(items[s])
  }
  var pool = slender.length ? slender : items
  pool.sort(function (a, b) {
    return b.height - a.height || b.score - a.score
  })
  var seed = pool[0]
  var box = new THREE.Box3().copy(seed.box)
  var reach = seed.max * 1.8
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].height < seed.height * 0.42) continue
    if (pool[i].max > seed.max * 3.2) continue
    if (!boxesNear(seed.box, pool[i].box, reach + pool[i].max * 0.6)) continue
    box.union(pool[i].box)
  }
  return expandRocketColumn(box, items, THREE)
}

function applyBoxToCamera(camera, controls, box, THREE, distScale) {
  if (!box || box.isEmpty()) return
  var pose = exhibitCameraPose(box, THREE, 'show', distScale)
  camera.near = pose.near
  camera.far = pose.far
  camera.position.copy(pose.pos)
  camera.lookAt(pose.target)
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.copy(pose.target)
    controls.minDistance = pose.minDistance
    controls.maxDistance = pose.maxDistance
    controls.update()
  }
}

/** 全箭取景并略压低画面，给顶栏/底栏留空，避免头罩顶出导航 */
function exhibitCameraPose(box, THREE, mode, distScale) {
  var size = box.getSize(new THREE.Vector3())
  var center = box.getCenter(new THREE.Vector3())
  var maxDim = Math.max(size.x, size.y, size.z) || 1
  var look = new THREE.Vector3(center.x, center.y + size.y * 0.03, center.z)
  if (mode === 'feat') {
    var focus = new THREE.Vector3(center.x, box.min.y + size.y * 0.58, center.z)
    var close = maxDim * 1.08
    return {
      pos: new THREE.Vector3(focus.x + close * 0.42, focus.y + close * 0.04, focus.z + close * 0.62),
      target: focus,
      near: Math.max(close / 140, maxDim / 400, 0.01),
      far: Math.max(close * 50, maxDim * 80, 400),
      minDistance: maxDim * 0.14,
      maxDistance: maxDim * 7,
      ms: 860
    }
  }
  if (mode === 'size') {
    var wide = maxDim * 2.55
    return {
      pos: new THREE.Vector3(look.x + wide * 0.58, look.y + wide * 0.18, look.z + wide * 0.9),
      target: look,
      near: Math.max(wide / 140, maxDim / 400, 0.01),
      far: Math.max(wide * 50, maxDim * 80, 400),
      minDistance: maxDim * 0.35,
      maxDistance: maxDim * 10,
      ms: 640
    }
  }
  var dist = maxDim * (distScale == null ? 2.32 : distScale)
  var needleZ = size.z / maxDim > 0.8 && Math.max(size.x, size.y) / maxDim < 0.38
  return {
    pos: needleZ
      ? new THREE.Vector3(look.x + dist, look.y + dist * 0.2, look.z + dist * 0.35)
      : new THREE.Vector3(look.x + dist * 0.5, look.y + dist * 0.2, look.z + dist),
    target: look,
    near: Math.max(dist / 140, maxDim / 400, 0.01),
    far: Math.max(dist * 50, maxDim * 80, 400),
    minDistance: maxDim * 0.35,
    maxDistance: maxDim * 10,
    ms: 680
  }
}

function fitCameraToObject(camera, controls, object, THREE) {
  applyBoxToCamera(camera, controls, getExhibitFrameBox(object, THREE), THREE, 2.15)
}

function addLights(scene, THREE, exhibit) {
  var ambient
  var key
  var fill
  var rim
  var hemi = null
  var spot = null
  if (exhibit) {
    ambient = new THREE.AmbientLight(0xffffff, 0.92)
    hemi = new THREE.HemisphereLight(0xfff1cc, 0x1a2230, 0.72)
    key = new THREE.DirectionalLight(0xfff3d6, 1.85)
    fill = new THREE.DirectionalLight(0x8ea4c4, 0.48)
    rim = new THREE.DirectionalLight(0xffc48a, 0.55)
    spot = new THREE.SpotLight(0xfff4d0, 2.4, 0, Math.PI / 5.2, 0.42, 1)
    spot.position.set(0, 14, 0.8)
  } else {
    ambient = new THREE.AmbientLight(0xffffff, 0.95)
    key = new THREE.DirectionalLight(0xffffff, 1.25)
    fill = new THREE.DirectionalLight(0x8ec5ff, 0.55)
    rim = new THREE.DirectionalLight(0xffc48a, 0.4)
  }
  scene.add(ambient)
  if (hemi) scene.add(hemi)
  scene.add(key)
  scene.add(fill)
  scene.add(rim)
  if (spot) {
    scene.add(spot)
    scene.add(spot.target)
  }
  return { ambient: ambient, key: key, fill: fill, rim: rim, hemi: hemi, spot: spot }
}

function layoutLights(session, box) {
  if (!session || !session.lights || !box || box.isEmpty()) return
  var THREE = session.THREE
  var size = box.getSize(new THREE.Vector3())
  var center = box.getCenter(new THREE.Vector3())
  var maxDim = Math.max(size.x, size.y, size.z) || 1
  session.lights.key.position.set(
    center.x + maxDim * 0.35,
    center.y + maxDim * 2.6,
    center.z + maxDim * 0.55
  )
  session.lights.fill.position.set(
    center.x - maxDim * 1.1,
    center.y + maxDim * 0.35,
    center.z - maxDim * 0.8
  )
  session.lights.rim.position.set(center.x, center.y - maxDim * 0.4, center.z + maxDim)
  if (session.lights.spot) {
    session.lights.spot.position.set(center.x, box.max.y + maxDim * 1.8, center.z + maxDim * 0.12)
    session.lights.spot.target.position.copy(center)
    session.lights.spot.distance = maxDim * 7
    session.lights.spot.target.updateMatrixWorld()
  }
}

var STAGE_LOGO_VIEW_H = 57
var STAGE_LOGO_PATH =
  'M18.215445,2.220227L3.0127578,2.220227C1.695654,2.220227,0.57675987,3.0237782,0.16733406,4.263732C-0.24215524,5.503624,0.18097524,6.8068008,1.2434014,7.5777974L19.784561,21.032907C20.615595,21.635979,21.609751,21.776314,22.57777,21.427326C26.915979,19.863525,29.844072,17.982981,32.047157,15.111856C32.554928,14.450213,32.748951,13.697948,32.624146,12.876106C32.499222,12.054203,32.090172,11.391869,31.408312,10.907513L19.960058,2.7757246C19.429382,2.398773,18.868446,2.2201018,18.215445,2.220227ZM53.590393,46.050011L64.861053,54.208569C65.395912,54.595695,65.965034,54.779781,66.627495,54.779781L82.000534,54.779781C83.317139,54.779781,84.435646,53.976864,84.84552,52.737587C85.255447,51.498268,84.833275,50.195461,83.771919,49.423779L65.244278,35.954086C64.412865,35.349693,63.417316,35.208729,62.448338,35.558338C58.111668,37.122643,55.181137,38.997978,52.977551,41.855968C52.470413,42.513714,52.274242,43.26152,52.393955,44.080593C52.513687,44.89967,52.915817,45.561691,53.590393,46.050011ZM31.407412,46.051582L20.138912,54.208569C19.604046,54.595695,19.034927,54.779781,18.372473,54.779781L2.9994934,54.779781C1.6828973,54.779781,0.5643841,53.976864,0.15445058,52.737587C-0.25541937,51.498268,0.16669591,50.195461,1.2280434,49.423779L19.753914,35.955463C20.585384,35.351013,21.581005,35.210056,22.550098,35.559723C26.884375,37.123653,29.814503,38.998161,32.019745,41.856785C32.527195,42.51453,32.723499,43.262463,32.603966,44.081665C32.484364,44.900925,32.082172,45.563202,31.407412,46.051582ZM66.784462,2.220227L81.987152,2.220227C83.304184,2.220227,84.423073,3.0237782,84.832565,4.2637339C85.24205,5.503624,84.818855,6.8068023,83.756424,7.5777974L65.214317,21.033596C64.383408,21.636606,63.389324,21.777008,62.421364,21.428146C58.083157,19.864594,55.154041,17.983852,52.951527,15.111417C52.444138,14.44971,52.250313,13.69763,52.375294,12.87598C52.500229,12.054329,52.909275,11.392183,53.591019,10.907953L65.039841,2.7757876C65.57058,2.3988359,66.131447,2.2202277,66.784462,2.220227ZM13.7273,28.492243C33.490833,24.037018,37.983288,19.560297,42.507843,0C47.002769,19.563375,51.520348,24.039593,71.272667,28.492243C51.528286,32.971348,47.003792,37.432358,42.507851,56.999996C37.982464,37.436131,33.483662,32.974121,13.7273,28.492243Z'

function layFlat(mesh, y) {
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

function makeStageRing(THREE, inner, outer, material, y) {
  var mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), material)
  return layFlat(mesh, y)
}

function tokenizeSvgPath(d) {
  return String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || []
}

function svgPathToShapes(THREE, d) {
  var tokens = tokenizeSvgPath(d)
  var shapes = []
  var shape = null
  var i = 0
  var cmd = 'M'
  var cx = 0
  var cy = 0
  var sx = 0
  var sy = 0
  function nextNum() {
    var n = Number(tokens[i])
    i += 1
    return n
  }
  function py(y) {
    return STAGE_LOGO_VIEW_H - y
  }
  function ensureShape() {
    if (shape) return
    shape = new THREE.Shape()
    shapes.push(shape)
  }
  while (i < tokens.length) {
    var tok = tokens[i]
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      cmd = tok
      i += 1
    }
    if (cmd === 'Z' || cmd === 'z') {
      if (shape) shape.closePath()
      shape = null
      cx = sx
      cy = sy
      continue
    }
    if (cmd === 'M' || cmd === 'm') {
      var mx = nextNum()
      var my = nextNum()
      if (cmd === 'm') {
        mx += cx
        my += cy
      }
      shape = new THREE.Shape()
      shapes.push(shape)
      shape.moveTo(mx, py(my))
      cx = mx
      cy = my
      sx = mx
      sy = my
      cmd = cmd === 'm' ? 'l' : 'L'
      continue
    }
    if (cmd === 'L' || cmd === 'l') {
      var lx = nextNum()
      var ly = nextNum()
      if (cmd === 'l') {
        lx += cx
        ly += cy
      }
      ensureShape()
      shape.lineTo(lx, py(ly))
      cx = lx
      cy = ly
      continue
    }
    if (cmd === 'C' || cmd === 'c') {
      var x1 = nextNum()
      var y1 = nextNum()
      var x2 = nextNum()
      var y2 = nextNum()
      var x = nextNum()
      var y = nextNum()
      if (cmd === 'c') {
        x1 += cx
        y1 += cy
        x2 += cx
        y2 += cy
        x += cx
        y += cy
      }
      ensureShape()
      shape.bezierCurveTo(x1, py(y1), x2, py(y2), x, py(y))
      cx = x
      cy = y
      continue
    }
    break
  }
  return shapes
}

function makeStageLogo(THREE) {
  var shapes = svgPathToShapes(THREE, STAGE_LOGO_PATH)
  var geo = new THREE.ShapeGeometry(shapes)
  if (geo.computeBoundingBox) geo.computeBoundingBox()
  var box = geo.boundingBox
  if (box && !box.isEmpty()) {
    var span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) || 1
    var s = 0.56 / span
    geo.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0)
    geo.scale(s, s, 1)
  }
  var mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xc8cdd4,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
  )
  mesh.name = 'r3d-stage-logo'
  return layFlat(mesh, 0)
}

function addExhibitStage(session) {
  var THREE = session.THREE
  var group = new THREE.Group()
  var disc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({
      color: 0x10141c,
      roughness: 0.92,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
  )
  layFlat(disc, 0)
  group.add(disc)
  group.add(
    makeStageRing(
      THREE,
      0.952,
      0.988,
      new THREE.MeshBasicMaterial({
        color: 0x2a3340,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      }),
      0.002
    )
  )
  var stripGlow = makeStageRing(
    THREE,
    0.99,
    1.18,
    new THREE.MeshBasicMaterial({
      color: 0xffe4b0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }),
    0.004
  )
  var stripCore = makeStageRing(
    THREE,
    1.028,
    1.078,
    new THREE.MeshBasicMaterial({
      color: 0xfff3cc,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }),
    0.006
  )
  group.add(stripGlow)
  group.add(stripCore)
  group.add(makeStageLogo(THREE))
  session.exhibitStage = group
  session.scene.add(group)
}

/** 火箭/参照相对圆形地板的净空（米，已按模型单位换算后仍为 0）。 */
function exhibitStageClearance() {
  return 0
}

function layoutExhibitStage(session, object) {
  if (!session || !session.exhibitStage || !object) return
  var THREE = session.THREE
  var box = getExhibitFrameBox(object, THREE)
  if (box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var center = box.getCenter(new THREE.Vector3())
  var radius = Math.max(size.x, size.z, size.y * 0.28) * 0.78
  session.exhibitStage.position.set(center.x, box.min.y - exhibitStageClearance(size), center.z)
  session.exhibitStage.scale.setScalar(Math.max(radius, 0.4))
}

function clearDimensionGuides(session) {
  if (!session) return
  session.dimGrow = null
  session.dimMeta = null
  if (!session.dimGuides) return
  session.scene.remove(session.dimGuides)
  disposeObject3D(session.dimGuides)
  session.dimGuides = null
}

function makeSegLine(THREE, material) {
  var geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
  return new THREE.Line(geo, material)
}

function writeSeg(line, ax, ay, az, bx, by, bz) {
  var arr = line.geometry.attributes.position.array
  arr[0] = ax
  arr[1] = ay
  arr[2] = az
  arr[3] = bx
  arr[4] = by
  arr[5] = bz
  line.geometry.attributes.position.needsUpdate = true
  line.geometry.computeBoundingSphere()
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function updateDimensionGrow(session, t) {
  var meta = session && session.dimMeta
  if (!meta) return
  var k = easeInOutCubic(Math.max(0, Math.min(1, t)))
  var hk = Math.min(1, k / 0.58)
  var wk = k < 0.28 ? 0 : Math.min(1, (k - 0.28) / 0.72)
  var hTo = lerp3(meta.hFrom, meta.hTo, hk)
  writeSeg(meta.height, meta.hFrom[0], meta.hFrom[1], meta.hFrom[2], hTo[0], hTo[1], hTo[2])
  var wTo = lerp3(meta.wFrom, meta.wTo, wk)
  writeSeg(meta.width, meta.wFrom[0], meta.wFrom[1], meta.wFrom[2], wTo[0], wTo[1], wTo[2])
  writeSeg(meta.hTickA, meta.hTickA0[0], meta.hTickA0[1], meta.hTickA0[2], meta.hTickA1[0], meta.hTickA1[1], meta.hTickA1[2])
  writeSeg(meta.hTickB, meta.hTickB0[0], meta.hTickB0[1], meta.hTickB0[2], meta.hTickB1[0], meta.hTickB1[1], meta.hTickB1[2])
  writeSeg(meta.wTickA, meta.wTickA0[0], meta.wTickA0[1], meta.wTickA0[2], meta.wTickA1[0], meta.wTickA1[1], meta.wTickA1[2])
  writeSeg(meta.wTickB, meta.wTickB0[0], meta.wTickB0[1], meta.wTickB0[2], meta.wTickB1[0], meta.wTickB1[1], meta.wTickB1[2])
  writeSeg(meta.hExtA, meta.hExtA0[0], meta.hExtA0[1], meta.hExtA0[2], meta.hExtA1[0], meta.hExtA1[1], meta.hExtA1[2])
  writeSeg(meta.hExtB, meta.hExtB0[0], meta.hExtB0[1], meta.hExtB0[2], meta.hExtB1[0], meta.hExtB1[1], meta.hExtB1[2])
  writeSeg(meta.wExtA, meta.wExtA0[0], meta.wExtA0[1], meta.wExtA0[2], meta.wExtA1[0], meta.wExtA1[1], meta.wExtA1[2])
  writeSeg(meta.wExtB, meta.wExtB0[0], meta.wExtB0[1], meta.wExtB0[2], meta.wExtB1[0], meta.wExtB1[1], meta.wExtB1[2])
  meta.height.visible = hk > 0.01
  meta.width.visible = wk > 0.01
  meta.hTickA.visible = hk > 0.04
  meta.hTickB.visible = hk > 0.92
  meta.wTickA.visible = wk > 0.04
  meta.wTickB.visible = wk > 0.92
  meta.hExtA.visible = hk > 0.02
  meta.hExtB.visible = hk > 0.88
  meta.wExtA.visible = wk > 0.02
  meta.wExtB.visible = wk > 0.88
  if (meta.ipHeight && meta.ipHFrom && meta.ipHTo) {
    var ipTo = lerp3(meta.ipHFrom, meta.ipHTo, hk)
    writeSeg(meta.ipHeight, meta.ipHFrom[0], meta.ipHFrom[1], meta.ipHFrom[2], ipTo[0], ipTo[1], ipTo[2])
    writeSeg(meta.ipHTickA, meta.ipHTickA0[0], meta.ipHTickA0[1], meta.ipHTickA0[2], meta.ipHTickA1[0], meta.ipHTickA1[1], meta.ipHTickA1[2])
    writeSeg(meta.ipHTickB, meta.ipHTickB0[0], meta.ipHTickB0[1], meta.ipHTickB0[2], meta.ipHTickB1[0], meta.ipHTickB1[1], meta.ipHTickB1[2])
    writeSeg(meta.ipHExtA, meta.ipHExtA0[0], meta.ipHExtA0[1], meta.ipHExtA0[2], meta.ipHExtA1[0], meta.ipHExtA1[1], meta.ipHExtA1[2])
    writeSeg(meta.ipHExtB, meta.ipHExtB0[0], meta.ipHExtB0[1], meta.ipHExtB0[2], meta.ipHExtB1[0], meta.ipHExtB1[1], meta.ipHExtB1[2])
    meta.ipHeight.visible = hk > 0.01
    meta.ipHTickA.visible = hk > 0.04
    meta.ipHTickB.visible = hk > 0.92
    meta.ipHExtA.visible = hk > 0.02
    meta.ipHExtB.visible = hk > 0.88
  }
  if (meta.vehLen && meta.vehLenFrom && meta.vehLenTo) {
    var vehLenTo = lerp3(meta.vehLenFrom, meta.vehLenTo, hk)
    writeSeg(meta.vehLen, meta.vehLenFrom[0], meta.vehLenFrom[1], meta.vehLenFrom[2], vehLenTo[0], vehLenTo[1], vehLenTo[2])
    writeSeg(meta.vehLenTickA, meta.vehLenTickA0[0], meta.vehLenTickA0[1], meta.vehLenTickA0[2], meta.vehLenTickA1[0], meta.vehLenTickA1[1], meta.vehLenTickA1[2])
    writeSeg(meta.vehLenTickB, meta.vehLenTickB0[0], meta.vehLenTickB0[1], meta.vehLenTickB0[2], meta.vehLenTickB1[0], meta.vehLenTickB1[1], meta.vehLenTickB1[2])
    writeSeg(meta.vehLenExtA, meta.vehLenExtA0[0], meta.vehLenExtA0[1], meta.vehLenExtA0[2], meta.vehLenExtA1[0], meta.vehLenExtA1[1], meta.vehLenExtA1[2])
    writeSeg(meta.vehLenExtB, meta.vehLenExtB0[0], meta.vehLenExtB0[1], meta.vehLenExtB0[2], meta.vehLenExtB1[0], meta.vehLenExtB1[1], meta.vehLenExtB1[2])
    meta.vehLen.visible = hk > 0.01
    meta.vehLenTickA.visible = hk > 0.04
    meta.vehLenTickB.visible = hk > 0.92
    meta.vehLenExtA.visible = hk > 0.02
    meta.vehLenExtB.visible = hk > 0.88
  }
  if (meta.vehH && meta.vehHFrom && meta.vehHTo) {
    var vehHTo = lerp3(meta.vehHFrom, meta.vehHTo, hk)
    writeSeg(meta.vehH, meta.vehHFrom[0], meta.vehHFrom[1], meta.vehHFrom[2], vehHTo[0], vehHTo[1], vehHTo[2])
    writeSeg(meta.vehHTickA, meta.vehHTickA0[0], meta.vehHTickA0[1], meta.vehHTickA0[2], meta.vehHTickA1[0], meta.vehHTickA1[1], meta.vehHTickA1[2])
    writeSeg(meta.vehHTickB, meta.vehHTickB0[0], meta.vehHTickB0[1], meta.vehHTickB0[2], meta.vehHTickB1[0], meta.vehHTickB1[1], meta.vehHTickB1[2])
    writeSeg(meta.vehHExtA, meta.vehHExtA0[0], meta.vehHExtA0[1], meta.vehHExtA0[2], meta.vehHExtA1[0], meta.vehHExtA1[1], meta.vehHExtA1[2])
    writeSeg(meta.vehHExtB, meta.vehHExtB0[0], meta.vehHExtB0[1], meta.vehHExtB0[2], meta.vehHExtB1[0], meta.vehHExtB1[1], meta.vehHExtB1[2])
    meta.vehH.visible = hk > 0.01
    meta.vehHTickA.visible = hk > 0.04
    meta.vehHTickB.visible = hk > 0.92
    meta.vehHExtA.visible = hk > 0.02
    meta.vehHExtB.visible = hk > 0.88
  }
}

function pickIpDimFigure(session) {
  var list = session && session.ipRefLoaded
  if (!list || !list.length) return null
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].object && list[i].slug === 'musk') return list[i]
  }
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].object && !ipScaleRef.isVehicleRef(list[i].slug)) return list[i]
  }
  return null
}

function peopleRefWorldBox(session, THREE, fallback) {
  var list = session && session.ipRefLoaded
  var box = null
  var i
  var fig
  var next
  if (!list || !THREE) return fallback || null
  for (i = 0; i < list.length; i++) {
    fig = list[i]
    if (!fig || !fig.object || ipScaleRef.isVehicleRef(fig.slug)) continue
    if (fig.object.updateWorldMatrix) fig.object.updateWorldMatrix(true, true)
    next = new THREE.Box3().setFromObject(fig.object)
    if (!next || next.isEmpty()) continue
    if (!box) box = next.clone()
    else box.union(next)
  }
  return box && !box.isEmpty() ? box : fallback || null
}

function appendIpHeightGuides(session, THREE, group, main, ext) {
  var fig = pickIpDimFigure(session)
  if (!fig || !fig.object || !session.dimMeta || !THREE) return
  if (fig.object.updateWorldMatrix) fig.object.updateWorldMatrix(true, true)
  var rulerBox = new THREE.Box3().setFromObject(fig.object)
  if (!rulerBox || rulerBox.isEmpty()) return
  var peopleBox = peopleRefWorldBox(session, THREE, rulerBox)
  if (!peopleBox || peopleBox.isEmpty()) peopleBox = rulerBox
  var gSize = peopleBox.getSize(new THREE.Vector3())
  var rSize = rulerBox.getSize(new THREE.Vector3())
  var pad = Math.max(gSize.x * 0.35, rSize.y * 0.08, rSize.x * 0.4)
  var tick = Math.max(rSize.y * 0.06, rSize.x * 0.16)
  var hx = peopleBox.max.x + pad
  var hz = (rulerBox.min.z + rulerBox.max.z) * 0.5
  var y0 = rulerBox.min.y
  var y1 = rulerBox.max.y
  var ipHeight = makeSegLine(THREE, main)
  var ipHTickA = makeSegLine(THREE, main)
  var ipHTickB = makeSegLine(THREE, main)
  var ipHExtA = makeSegLine(THREE, ext)
  var ipHExtB = makeSegLine(THREE, ext)
  group.add(ipHExtA, ipHExtB, ipHeight, ipHTickA, ipHTickB)
  var meta = session.dimMeta
  meta.ipHeight = ipHeight
  meta.ipHTickA = ipHTickA
  meta.ipHTickB = ipHTickB
  meta.ipHExtA = ipHExtA
  meta.ipHExtB = ipHExtB
  meta.ipHFrom = [hx, y0, hz]
  meta.ipHTo = [hx, y1, hz]
  meta.ipHTickA0 = [hx - tick * 0.5, y0, hz]
  meta.ipHTickA1 = [hx + tick * 0.5, y0, hz]
  meta.ipHTickB0 = [hx - tick * 0.5, y1, hz]
  meta.ipHTickB1 = [hx + tick * 0.5, y1, hz]
  meta.ipHExtA0 = [peopleBox.max.x, y0, hz]
  meta.ipHExtA1 = [hx, y0, hz]
  meta.ipHExtB0 = [peopleBox.max.x, y1, hz]
  meta.ipHExtB1 = [hx, y1, hz]
  meta.captions.ipHeight = ipScaleRef.formatHeightCaption(fig.highestPointM)
}

function pickVehicleDimFigure(session) {
  var list = session && session.ipRefLoaded
  if (!list || !list.length) return null
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].object && ipScaleRef.isVehicleRef(list[i].slug)) return list[i]
  }
  return null
}

function appendVehicleDimGuides(session, THREE, group, main, ext) {
  var fig = pickVehicleDimFigure(session)
  if (!fig || !fig.object || !session.dimMeta || !THREE) return
  if (fig.object.updateWorldMatrix) fig.object.updateWorldMatrix(true, true)
  var box = new THREE.Box3().setFromObject(fig.object)
  if (!box || box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var alongX = size.x >= size.z
  var dims = ipScaleRef.resolveVehicleDims(fig)
  var pad = Math.max(size.y * 0.12, Math.min(size.x, size.z) * 0.18, 0.08)
  var tick = Math.max(size.y * 0.05, Math.min(size.x, size.z) * 0.08)
  var midZ = (box.min.z + box.max.z) * 0.5
  var ly = box.min.y + Math.max(size.y * 0.04, 0.02)
  var vehLen = makeSegLine(THREE, main)
  var vehLenTickA = makeSegLine(THREE, main)
  var vehLenTickB = makeSegLine(THREE, main)
  var vehLenExtA = makeSegLine(THREE, ext)
  var vehLenExtB = makeSegLine(THREE, ext)
  var vehH = makeSegLine(THREE, main)
  var vehHTickA = makeSegLine(THREE, main)
  var vehHTickB = makeSegLine(THREE, main)
  var vehHExtA = makeSegLine(THREE, ext)
  var vehHExtB = makeSegLine(THREE, ext)
  group.add(vehLenExtA, vehLenExtB, vehLen, vehLenTickA, vehLenTickB, vehHExtA, vehHExtB, vehH, vehHTickA, vehHTickB)
  var meta = session.dimMeta
  meta.vehLen = vehLen
  meta.vehLenTickA = vehLenTickA
  meta.vehLenTickB = vehLenTickB
  meta.vehLenExtA = vehLenExtA
  meta.vehLenExtB = vehLenExtB
  meta.vehH = vehH
  meta.vehHTickA = vehHTickA
  meta.vehHTickB = vehHTickB
  meta.vehHExtA = vehHExtA
  meta.vehHExtB = vehHExtB
  if (alongX) {
    var lz = box.min.z - pad
    meta.vehLenFrom = [box.min.x, ly, lz]
    meta.vehLenTo = [box.max.x, ly, lz]
    meta.vehLenTickA0 = [box.min.x, ly, lz - tick * 0.5]
    meta.vehLenTickA1 = [box.min.x, ly, lz + tick * 0.5]
    meta.vehLenTickB0 = [box.max.x, ly, lz - tick * 0.5]
    meta.vehLenTickB1 = [box.max.x, ly, lz + tick * 0.5]
    meta.vehLenExtA0 = [box.min.x, ly, box.min.z]
    meta.vehLenExtA1 = [box.min.x, ly, lz]
    meta.vehLenExtB0 = [box.max.x, ly, box.min.z]
    meta.vehLenExtB1 = [box.max.x, ly, lz]
  } else {
    var lx = box.max.x + pad
    meta.vehLenFrom = [lx, ly, box.min.z]
    meta.vehLenTo = [lx, ly, box.max.z]
    meta.vehLenTickA0 = [lx - tick * 0.5, ly, box.min.z]
    meta.vehLenTickA1 = [lx + tick * 0.5, ly, box.min.z]
    meta.vehLenTickB0 = [lx - tick * 0.5, ly, box.max.z]
    meta.vehLenTickB1 = [lx + tick * 0.5, ly, box.max.z]
    meta.vehLenExtA0 = [box.max.x, ly, box.min.z]
    meta.vehLenExtA1 = [lx, ly, box.min.z]
    meta.vehLenExtB0 = [box.max.x, ly, box.max.z]
    meta.vehLenExtB1 = [lx, ly, box.max.z]
  }
  var hx = box.max.x + pad
  meta.vehHFrom = [hx, box.min.y, midZ]
  meta.vehHTo = [hx, box.max.y, midZ]
  meta.vehHTickA0 = [hx - tick * 0.5, box.min.y, midZ]
  meta.vehHTickA1 = [hx + tick * 0.5, box.min.y, midZ]
  meta.vehHTickB0 = [hx - tick * 0.5, box.max.y, midZ]
  meta.vehHTickB1 = [hx + tick * 0.5, box.max.y, midZ]
  meta.vehHExtA0 = [box.max.x, box.min.y, midZ]
  meta.vehHExtA1 = [hx, box.min.y, midZ]
  meta.vehHExtB0 = [box.max.x, box.max.y, midZ]
  meta.vehHExtB1 = [hx, box.max.y, midZ]
  if (!meta.captions) meta.captions = {}
  meta.captions.vehLength = ipScaleRef.formatMetersCaption(dims.lengthM)
  meta.captions.vehHeight = ipScaleRef.formatMetersCaption(dims.heightM)
  meta.captions.vehWidth = ipScaleRef.formatMetersCaption(dims.widthM)
}

function setDimensionGuides(session, visible, captions) {
  clearDimensionGuides(session)
  emitDimLabels(session, [])
  if (!visible || !session || !session.modelRoot) return
  var THREE = session.THREE
  var box = getRenderableBox(session.modelRoot, THREE)
  if (box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var min = box.min
  var max = box.max
  var padX = Math.max(size.x * 0.34, size.y * 0.06)
  var padZ = Math.max(size.z * 0.28, size.y * 0.05)
  var tick = Math.max(size.y * 0.028, size.x * 0.06)
  var hx = min.x - padX
  var hz = min.z
  var viewH = session.cssH || 700
  var lift = Math.max(size.y * 0.018, ((10 / viewH) * Math.max(size.x, size.y, size.z) * 2.4))
  var wy = min.y + lift
  var wz = max.z + padZ
  var main = new THREE.LineBasicMaterial({
    color: 0xe8d5a3,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false
  })
  var ext = new THREE.LineBasicMaterial({
    color: 0xc4b38a,
    transparent: true,
    opacity: 0.38,
    depthTest: false,
    depthWrite: false
  })
  var group = new THREE.Group()
  var height = makeSegLine(THREE, main)
  var width = makeSegLine(THREE, main)
  var hTickA = makeSegLine(THREE, main)
  var hTickB = makeSegLine(THREE, main)
  var wTickA = makeSegLine(THREE, main)
  var wTickB = makeSegLine(THREE, main)
  var hExtA = makeSegLine(THREE, ext)
  var hExtB = makeSegLine(THREE, ext)
  var wExtA = makeSegLine(THREE, ext)
  var wExtB = makeSegLine(THREE, ext)
  group.add(hExtA, hExtB, wExtA, wExtB, height, width, hTickA, hTickB, wTickA, wTickB)
  session.dimGuides = group
  session.dimMeta = {
    height: height,
    width: width,
    hTickA: hTickA,
    hTickB: hTickB,
    wTickA: wTickA,
    wTickB: wTickB,
    hExtA: hExtA,
    hExtB: hExtB,
    wExtA: wExtA,
    wExtB: wExtB,
    hFrom: [hx, min.y, hz],
    hTo: [hx, max.y, hz],
    wFrom: [min.x, wy, wz],
    wTo: [max.x, wy, wz],
    hTickA0: [hx - tick * 0.5, min.y, hz],
    hTickA1: [hx + tick * 0.5, min.y, hz],
    hTickB0: [hx - tick * 0.5, max.y, hz],
    hTickB1: [hx + tick * 0.5, max.y, hz],
    wTickA0: [min.x, wy, wz - tick * 0.5],
    wTickA1: [min.x, wy, wz + tick * 0.5],
    wTickB0: [max.x, wy, wz - tick * 0.5],
    wTickB1: [max.x, wy, wz + tick * 0.5],
    hExtA0: [min.x, min.y, hz],
    hExtA1: [hx, min.y, hz],
    hExtB0: [min.x, max.y, hz],
    hExtB1: [hx, max.y, hz],
    wExtA0: [min.x, wy, max.z],
    wExtA1: [min.x, wy, wz],
    wExtB0: [max.x, wy, max.z],
    wExtB1: [max.x, wy, wz],
    captions: {
      length: captions && captions.length ? String(captions.length) : '',
      diameter: captions && captions.diameter ? String(captions.diameter) : ''
    }
  }
  appendIpHeightGuides(session, THREE, group, main, ext)
  appendVehicleDimGuides(session, THREE, group, main, ext)
  session.dimGrow = 0
  group.renderOrder = 12
  session.scene.add(group)
  updateDimensionGrow(session, 0)
  emitDimLabels(session)
}

function applyExhibitControls(session, mode) {
  if (!session || !session.controls || !session.modelRoot) return
  var THREE = session.THREE
  var box = getRenderableBox(session.modelRoot, THREE)
  if (box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var maxDim = Math.max(size.x, size.y, size.z) || 1
  var controls = session.controls
  controls.enabled = true
  controls.enableRotate = true
  controls.enableZoom = true
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.panSpeed = 0.85
  controls.rotateSpeed = 0.78
  controls.zoomSpeed = 1.05
  controls.minPolarAngle = 0.06
  controls.maxPolarAngle = Math.PI - 0.06
  if (mode === 'feat') {
    controls.minDistance = maxDim * 0.14
    controls.maxDistance = maxDim * 7
  } else {
    controls.minDistance = maxDim * 0.35
    controls.maxDistance = maxDim * 10
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function cancelExhibitTween(session) {
  if (session) session.camTween = null
}

function clearAutoRotateTimer(session) {
  if (!session || !session._autoRotateTimer) return
  clearTimeout(session._autoRotateTimer)
  session._autoRotateTimer = 0
}

function scheduleAutoRotate(session) {
  if (!session) return
  clearAutoRotateTimer(session)
  session._autoRotateTimer = setTimeout(function () {
    session._autoRotateTimer = 0
    if (!session.orbiting) session.autoRotate = true
  }, 420)
}

function poseForExhibit(session, mode) {
  if (!session || !session.modelRoot || !session.THREE) return null
  var THREE = session.THREE
  var box = getExhibitFrameBox(session.modelRoot, THREE)
  if (!box || box.isEmpty()) return null
  return exhibitCameraPose(box, THREE, mode)
}

function applyBoxClip(camera, box, THREE) {
  if (!camera || !box || box.isEmpty() || !THREE) return
  var size = box.getSize(new THREE.Vector3())
  var center = box.getCenter(new THREE.Vector3())
  var maxDim = Math.max(size.x, size.y, size.z) || 1
  var dist = maxDim * 2
  if (camera.position && typeof camera.position.distanceTo === 'function') {
    dist = Math.max(camera.position.distanceTo(center), maxDim * 0.2)
  }
  var near = Math.max(Math.min(dist / 60, maxDim / 40), maxDim / 200, 0.001)
  var far = Math.max(dist + maxDim * 8, maxDim * 16, 80)
  var ratioCap = isWxIOS() ? 800 : 2500
  if (near > 0 && far / near > ratioCap) near = far / ratioCap
  camera.near = near
  camera.far = far
  if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix()
}

function projectToCss(session, x, y, z) {
  if (!session || !session.camera || !session.THREE) return { x: 0, y: 0, visible: false, inFront: false }
  var THREE = session.THREE
  var v = new THREE.Vector3(x, y, z)
  var cam = session.camera
  var inFront = true
  if (cam && THREE.Vector3) {
    var view = new THREE.Vector3(x, y, z)
    if (cam.matrixWorldInverse && typeof view.applyMatrix4 === 'function') {
      view.applyMatrix4(cam.matrixWorldInverse)
      inFront = view.z < 0
    }
  }
  v.project(cam)
  var w = session.cssW || 1
  var h = session.cssH || 1
  var inClip = v.z >= -1 && v.z <= 1
  if (!inClip) inFront = false
  return {
    x: Math.round((v.x * 0.5 + 0.5) * w),
    y: Math.round((-v.y * 0.5 + 0.5) * h),
    visible: inFront && inClip && v.x >= -1.15 && v.x <= 1.15 && v.y >= -1.15 && v.y <= 1.15,
    inFront: inFront && inClip && Math.abs(v.x) < 8 && Math.abs(v.y) < 8
  }
}

function dimLabelsChanged(prev, next) {
  if (!prev || prev.length !== next.length) return true
  for (var i = 0; i < next.length; i++) {
    if (prev[i].key !== next[i].key) return true
    if (prev[i].text !== next[i].text) return true
    if (!!prev[i].visible !== !!next[i].visible) return true
    if (Math.abs(prev[i].x - next[i].x) > 1.5) return true
    if (Math.abs(prev[i].y - next[i].y) > 1.5) return true
  }
  return false
}

function emitDimLabels(session, forced) {
  if (!session || typeof session.onDimLabels !== 'function') return
  if (session.ipIntroSlug) {
    if (session._dimLabelCache && session._dimLabelCache.length) {
      session._dimLabelCache = []
      session.onDimLabels([])
    }
    return
  }
  if (forced != null) {
    session._dimLabelCache = forced
    session.onDimLabels(forced)
    return
  }
  var meta = session.dimMeta
  if (!meta || !meta.captions) {
    if (session._dimLabelCache && session._dimLabelCache.length) {
      session._dimLabelCache = []
      session.onDimLabels([])
    }
    return
  }
  var k = session.dimGrow == null ? 1 : session.dimGrow
  var items = []
  if (meta.captions.length) {
    var hp = projectToCss(
      session,
      (meta.hFrom[0] + meta.hTo[0]) / 2,
      (meta.hFrom[1] + meta.hTo[1]) / 2,
      (meta.hFrom[2] + meta.hTo[2]) / 2
    )
    items.push({
      key: 'h',
      text: meta.captions.length,
      x: hp.x - 28,
      y: hp.y - 12,
      visible: hp.visible && k > 0.42
    })
  }
  if (meta.captions.diameter) {
    var wp = projectToCss(
      session,
      (meta.wFrom[0] + meta.wTo[0]) / 2,
      (meta.wFrom[1] + meta.wTo[1]) / 2,
      (meta.wFrom[2] + meta.wTo[2]) / 2
    )
    items.push({
      key: 'w',
      text: meta.captions.diameter,
      x: wp.x - 32,
      y: wp.y - 10,
      visible: wp.visible && k > 0.58
    })
  }
  if (meta.captions.ipHeight && meta.ipHFrom && meta.ipHTo) {
    var iphp = projectToCss(
      session,
      (meta.ipHFrom[0] + meta.ipHTo[0]) / 2,
      (meta.ipHFrom[1] + meta.ipHTo[1]) / 2,
      (meta.ipHFrom[2] + meta.ipHTo[2]) / 2
    )
    items.push({
      key: 'iph',
      text: meta.captions.ipHeight,
      x: iphp.x + 8,
      y: iphp.y - 12,
      visible: iphp.visible && k > 0.42
    })
  }
  if (meta.captions.vehLength && meta.vehLenFrom && meta.vehLenTo) {
    var vlp = projectToCss(
      session,
      (meta.vehLenFrom[0] + meta.vehLenTo[0]) / 2,
      (meta.vehLenFrom[1] + meta.vehLenTo[1]) / 2,
      (meta.vehLenFrom[2] + meta.vehLenTo[2]) / 2
    )
    items.push({
      key: 'vehl',
      text: meta.captions.vehLength,
      x: vlp.x - 28,
      y: vlp.y - 12,
      visible: vlp.visible && k > 0.42
    })
  }
  if (meta.captions.vehHeight && meta.vehHFrom && meta.vehHTo) {
    var vhp = projectToCss(
      session,
      (meta.vehHFrom[0] + meta.vehHTo[0]) / 2,
      (meta.vehHFrom[1] + meta.vehHTo[1]) / 2,
      (meta.vehHFrom[2] + meta.vehHTo[2]) / 2
    )
    items.push({
      key: 'vehh',
      text: meta.captions.vehHeight,
      x: vhp.x + 8,
      y: vhp.y - 12,
      visible: vhp.visible && k > 0.42
    })
  }
  if (!dimLabelsChanged(session._dimLabelCache, items)) return
  session._dimLabelCache = items
  session.onDimLabels(items)
}

function playExhibitView(session, mode) {
  if (!session || !session.modelRoot || !session.camera || !session.controls) return
  var pose = poseForExhibit(session, mode)
  if (!pose) return
  applyBoxClip(session.camera, getExhibitFrameBox(session.modelRoot, session.THREE), session.THREE)
  session.autoRotate = true
  applyExhibitControls(session, mode)
  session.camTween = {
    fromPos: session.camera.position.clone(),
    toPos: pose.pos,
    fromTarget: session.controls.target.clone(),
    toTarget: pose.target,
    start: Date.now(),
    duration: pose.ms
  }
}

/** 模型只读：不改材质、缩放、显隐。适配走相机/灯光/展台。 */
function prepareModel(object) {
  return object
}

function isBoardSize(size) {
  if (!size) return false
  var x = Number(size.x) || 0
  var y = Number(size.y) || 0
  var z = Number(size.z) || 0
  var max = Math.max(x, y, z)
  var min = Math.min(x, y, z)
  var mid = x + y + z - max - min
  if (max <= 0 || min <= 0) return false
  // 薄片展陈（含横排全系列）：最短边薄、另外两边构成面。
  // 不要求接近正方形，避免把宽台面误判成细长箭再绕 Z 立起。
  if (mid / max > 0.22 && min / max < 0.32 && mid / min > 1.6) return true
  // 更扁的横排：X 最长、箭已立在 Y、Z 最薄。躺着的细长箭 Y≈Z（截面），不会进这里。
  return x >= max * 0.92 && z <= min * 1.12 && y >= min * 1.8 && y / max >= 0.12
}

var STAND_CANDIDATES = [
  { x: 0, y: 0, z: 0 },
  { x: -Math.PI / 2, y: 0, z: 0 },
  { x: Math.PI / 2, y: 0, z: 0 },
  { x: Math.PI, y: 0, z: 0 },
  { x: 0, y: 0, z: -Math.PI / 2 },
  { x: 0, y: 0, z: Math.PI / 2 },
  { x: 0, y: 0, z: Math.PI }
]

function quarterTurn(rad) {
  var deg = Math.round(((Number(rad) || 0) * 180) / Math.PI)
  deg = ((deg % 360) + 360) % 360
  if (deg === 0) return 0
  if (deg === 90) return 90
  if (deg === 180) return 180
  if (deg === 270) return -90
  return 0
}

/** 90° 欧拉（先 X 后 Z）后的轴对齐包围盒尺寸，不改网格。 */
function rotateSizeByEuler(size, rot) {
  var x = Number(size && size.x) || 0
  var y = Number(size && size.y) || 0
  var z = Number(size && size.z) || 0
  var rx = quarterTurn(rot && rot.x)
  var rz = quarterTurn(rot && rot.z)
  if (rx === 90 || rx === -90) {
    var swapYZ = y
    y = z
    z = swapYZ
  }
  if (rz === 90 || rz === -90) {
    var swapXY = x
    x = y
    y = swapXY
  }
  return { x: x, y: y, z: z }
}

/**
 * 通用立起评分：竖直、对着镜头、别躺平、别对着镜头成一根针。
 * 不认 slug，以后新模型走同一套。
 */
function exhibitShape(size) {
  var x = Number(size && size.x) || 0
  var y = Number(size && size.y) || 0
  var z = Number(size && size.z) || 0
  var max = Math.max(x, y, z)
  var min = Math.min(x, y, z)
  var mid = x + y + z - max - min
  if (max <= 0) return 'empty'
  if (isBoardSize(size)) return 'board'
  if (mid > 0 && max / mid >= 2) return 'slender'
  return 'compact'
}

/** 展陈验收：细长箭必须 Y 向最长；展板薄轴朝 Z（对着镜头），允许横向比竖向更长。 */
function isUprightExhibitSize(size) {
  var x = Number(size && size.x) || 0
  var y = Number(size && size.y) || 0
  var z = Number(size && size.z) || 0
  var max = Math.max(x, y, z)
  var min = Math.min(x, y, z)
  var mid = x + y + z - max - min
  if (max <= 0) return false
  if (z / max > 0.8 && Math.max(x, y) / max < 0.38) return false
  var shape = exhibitShape(size)
  if (shape === 'board') return z <= min * 1.12 && y > min * 1.35 && x > min * 1.12
  if (shape === 'slender') return y >= max * 0.85
  return y >= mid * 0.9
}

function finalizeStandRotation(rawSize, chosen) {
  var rot = withStandFlip(chosen || { x: 0, y: 0, z: 0 })
  if (!rawSize) return rot
  if (isUprightExhibitSize(rawSize)) {
    var rx = quarterTurn(rot.x)
    var rz = quarterTurn(rot.z)
    if (rx === 90 || rx === -90 || rz === 90 || rz === -90) {
      return withStandFlip({ x: 0, y: 0, z: 0 })
    }
    return rot
  }
  var predicted = rotateSizeByEuler(rawSize, rot)
  if (isUprightExhibitSize(predicted)) return rot
  var forced = pickStandRotationFromSize(rawSize)
  if (isUprightExhibitSize(rotateSizeByEuler(rawSize, forced))) return forced
  return rot
}

function scoreStandSize(size) {
  var x = Number(size && size.x) || 0
  var y = Number(size && size.y) || 0
  var z = Number(size && size.z) || 0
  var max = Math.max(x, y, z)
  var min = Math.min(x, y, z)
  var mid = x + y + z - max - min
  if (max <= 0) return -1e9
  if (isBoardSize(size)) {
    var board = 0
    if (z <= min * 1.12) board += 16
    if (y <= min * 1.18) board -= 24
    if (x <= min * 1.12) board -= 16
    board += (y / max) * 3 + (x / max) * 3
    if (z / max > 0.8 && Math.max(x, y) / max < 0.38) board -= 20
    return board
  }
  var yRatio = y / max
  var face = Math.max(x, y) / max
  var score = yRatio * 10 + face * 8 + (x / max) * 5
  if (z / max > 0.8 && Math.max(x, y) / max < 0.38) score -= 20
  if (y <= min * 1.08 && mid / max > 0.4) score -= 16
  if (mid > 0 && max / mid >= 2) score += yRatio * 8
  return score
}

function standFlipAxis(rot) {
  if (rot && Math.abs(rot.z) > 1e-6) return 'z'
  return 'x'
}

function standCandidateBias(rot) {
  if (!rot) return 0
  var ax = Math.abs(rot.x) < 1e-6
  var az = Math.abs(rot.z) < 1e-6
  if (ax && az) return 0.4
  if (rot.x < 0 && az) return 0.3
  if (ax && rot.z < 0) return 0.3
  if (Math.abs(Math.abs(rot.x) - Math.PI) < 1e-6 || Math.abs(Math.abs(rot.z) - Math.PI) < 1e-6) {
    return 0.1
  }
  return 0
}

function withStandFlip(rot) {
  return {
    x: rot ? rot.x : 0,
    y: rot ? rot.y : 0,
    z: rot ? rot.z : 0,
    flip: standFlipAxis(rot)
  }
}

function pickStandRotationFromSize(size) {
  if (!size) return withStandFlip({ x: 0, y: 0, z: 0 })
  var x = Number(size.x) || 0
  var y = Number(size.y) || 0
  var z = Number(size.z) || 0
  if (Math.max(x, y, z) <= 0) return withStandFlip({ x: 0, y: 0, z: 0 })
  if (isUprightExhibitSize(size)) return withStandFlip({ x: 0, y: 0, z: 0 })
  var best = STAND_CANDIDATES[0]
  var bestScore = -1e12
  for (var i = 0; i < STAND_CANDIDATES.length; i++) {
    var cand = STAND_CANDIDATES[i]
    var score = scoreStandSize(rotateSizeByEuler(size, cand)) + standCandidateBias(cand)
    if (score > bestScore) {
      bestScore = score
      best = cand
    }
  }
  return withStandFlip(best)
}

function exhibitStandRotation(size) {
  return pickStandRotationFromSize(size)
}

function sizeClose(a, b) {
  if (!a || !b) return false
  var span = Math.max(a.x, a.y, a.z, b.x, b.y, b.z, 1e-6)
  return (
    Math.abs(a.x - b.x) / span < 0.12 &&
    Math.abs(a.y - b.y) / span < 0.12 &&
    Math.abs(a.z - b.z) / span < 0.12
  )
}

var ENGINE_NAME_RE =
  /raptor|merlin|nozzle|engine|thruster|bell|rutherford|ssme|rs-?25|rd-?\d|yf-?\d|be-?[34]|nk-?\d/i
var NOSE_NAME_RE = /fairing|nose.?cone|\bnose\b|payload.?fairing|cowling|头罩|整流罩/i

function collectStandMeshes(object, THREE) {
  var items = []
  if (!object || !object.traverse || !THREE) return items
  object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    if (child.visible === false) return
    var b = meshWorldBox(child, THREE)
    if (!b || b.isEmpty()) return
    items.push({
      box: b,
      name: meshNameHay(child)
    })
  })
  return items
}

/** 与 three.js 默认 XYZ 欧拉一致，只用于 90°/180° 候选的软件立起。 */
function rotatePointByEuler(x, y, z, rot) {
  var rx = Number(rot && rot.x) || 0
  var ry = Number(rot && rot.y) || 0
  var rz = Number(rot && rot.z) || 0
  var c = Math.cos(rx)
  var s = Math.sin(rx)
  var y1 = y * c - z * s
  var z1 = y * s + z * c
  y = y1
  z = z1
  c = Math.cos(ry)
  s = Math.sin(ry)
  var x1 = x * c + z * s
  var z2 = -x * s + z * c
  x = x1
  z = z2
  c = Math.cos(rz)
  s = Math.sin(rz)
  return { x: x * c - y * s, y: x * s + y * c, z: z }
}

function rotateBoxByEuler(box, rot, THREE) {
  if (!box || box.isEmpty() || !THREE) return box
  var rx = Number(rot && rot.x) || 0
  var ry = Number(rot && rot.y) || 0
  var rz = Number(rot && rot.z) || 0
  var out = new THREE.Box3()
  if (Math.abs(rx) < 1e-12 && Math.abs(ry) < 1e-12 && Math.abs(rz) < 1e-12) {
    out.copy(box)
    return out
  }
  var xs = [box.min.x, box.max.x]
  var ys = [box.min.y, box.max.y]
  var zs = [box.min.z, box.max.z]
  var started = false
  for (var i = 0; i < 2; i++) {
    for (var j = 0; j < 2; j++) {
      for (var k = 0; k < 2; k++) {
        var p = rotatePointByEuler(xs[i], ys[j], zs[k], rot)
        if (!started) {
          out.min.x = out.max.x = p.x
          out.min.y = out.max.y = p.y
          out.min.z = out.max.z = p.z
          started = true
        } else {
          out.min.x = Math.min(out.min.x, p.x)
          out.min.y = Math.min(out.min.y, p.y)
          out.min.z = Math.min(out.min.z, p.z)
          out.max.x = Math.max(out.max.x, p.x)
          out.max.y = Math.max(out.max.y, p.y)
          out.max.z = Math.max(out.max.z, p.z)
        }
      }
    }
  }
  return out
}

function sizedMesh(box) {
  var sx = box.max.x - box.min.x
  var sy = box.max.y - box.min.y
  var sz = box.max.z - box.min.z
  return {
    box: box,
    xz: Math.max(sx, sz),
    h: sy
  }
}

function emptyEndWidths() {
  return {
    top: 0,
    bot: 0,
    topParts: 0,
    botParts: 0,
    topEngineName: false,
    botEngineName: false,
    topNoseName: false,
    botNoseName: false
  }
}

/**
 * 在指定欧拉下量两端。不依赖 matrixWorld 是否跟上包装旋转，
 * 避免小程序晚一帧、或整流罩比箭体粗时误翻 180°。
 */
function measureEndWidthsFromItems(items, rawBox, rot, THREE) {
  var empty = emptyEndWidths()
  if (!items || !items.length || !rawBox || rawBox.isEmpty() || !THREE) return empty
  var box = rotateBoxByEuler(rawBox, rot, THREE)
  if (!box || box.isEmpty()) return empty
  var size = box.getSize(new THREE.Vector3())
  var h = Number(size.y) || 0
  if (h <= 0.0001) return empty
  var maxSpan = Math.max(size.x, size.z, 0.0001)
  var tipBand = Math.max(h * 0.18, 0.01)
  var bodyReach = Math.max(h * 0.48, tipBand)
  var topBody = 0
  var botBody = 0
  var topW = 0
  var botW = 0
  var topParts = 0
  var botParts = 0
  var topEngineName = false
  var botEngineName = false
  var topNoseName = false
  var botNoseName = false
  var nearestTopBody = null
  var nearestBotBody = null
  for (var i = 0; i < items.length; i++) {
    var src = items[i]
    var rb = rotateBoxByEuler(src.box, rot, THREE)
    if (!rb || rb.isEmpty()) continue
    var it = sizedMesh(rb)
    it.name = src.name
    var inTopTip = it.box.max.y >= box.max.y - tipBand
    var inBotTip = it.box.min.y <= box.min.y + tipBand
    var inTopHalf = it.box.max.y >= box.max.y - bodyReach
    var inBotHalf = it.box.min.y <= box.min.y + bodyReach
    var namedEngine = ENGINE_NAME_RE.test(it.name)
    var namedNose = NOSE_NAME_RE.test(it.name)
    var enginePart = namedEngine || (it.h < h * 0.1 && it.xz < maxSpan * 0.35)
    var lateral = it.h < h * 0.14 && it.xz > maxSpan * 0.42
    var body = it.h >= Math.max(it.xz * 0.85, h * 0.12)
    if (namedEngine) {
      if (inTopTip) topEngineName = true
      if (inBotTip) botEngineName = true
    }
    if (namedNose) {
      if (inTopTip) topNoseName = true
      if (inBotTip) botNoseName = true
    }
    if (enginePart) {
      if (inTopTip) topParts += 1
      if (inBotTip) botParts += 1
    }
    if (lateral) continue
    if (body) {
      if (inTopHalf) topBody = Math.max(topBody, it.xz)
      if (inBotHalf) botBody = Math.max(botBody, it.xz)
      if (!nearestTopBody || it.box.max.y > nearestTopBody.box.max.y) nearestTopBody = it
      if (!nearestBotBody || it.box.min.y < nearestBotBody.box.min.y) nearestBotBody = it
    }
    if (inTopTip && !enginePart) topW = Math.max(topW, it.xz)
    if (inBotTip && !enginePart) botW = Math.max(botW, it.xz)
  }
  if (!topBody && nearestTopBody) topBody = nearestTopBody.xz
  if (!botBody && nearestBotBody) botBody = nearestBotBody.xz
  return {
    top: topBody || topW,
    bot: botBody || botW,
    topParts: topParts,
    botParts: botParts,
    topEngineName: topEngineName,
    botEngineName: botEngineName,
    topNoseName: topNoseName,
    botNoseName: botNoseName
  }
}

function measureEndWidths(object, THREE, box, rot) {
  if (!object || !THREE || !box || box.isEmpty()) return emptyEndWidths()
  return measureEndWidthsFromItems(collectStandMeshes(object, THREE), box, rot, THREE)
}

function engineEndBias(ends) {
  var topP = ends && ends.topParts ? ends.topParts : 0
  var botP = ends && ends.botParts ? ends.botParts : 0
  if (botP >= 4 && botP > topP * 1.6) return 1
  if (topP >= 4 && topP > botP * 1.6) return -1
  if (botP >= 3 && topP === 0) return 1
  if (topP >= 3 && botP === 0) return -1
  return 0
}

function nameEndBias(ends) {
  if (!ends) return 0
  var score = 0
  if (ends.botEngineName && !ends.topEngineName) score += 1
  if (ends.topEngineName && !ends.botEngineName) score -= 1
  if (ends.topNoseName && !ends.botNoseName) score += 1
  if (ends.botNoseName && !ends.topNoseName) score -= 1
  if (score > 0) return 1
  if (score < 0) return -1
  return 0
}

function noseTaperFromEnds(ends, size) {
  var cluster = engineEndBias(ends)
  var names = nameEndBias(ends)
  var confirm = cluster || names
  var width = 0
  if (ends && ends.top > 0 && ends.bot > 0) {
    var span = Math.max(ends.top, ends.bot)
    var raw = (ends.bot - ends.top) / span
    if (confirm > 0 && raw < 0) raw = 0
    if (confirm < 0 && raw > 0) raw = 0
    width = confirm ? raw * (isBoardSize(size) ? 0.8 : 2.4) : 0
  }
  return width + cluster * 3.2 + names * 2.8
}

/** 只在发动机簇/名称对得上时判倒立。整流罩比箭体粗（猎鹰 9）不算倒立。 */
function isNoseDown(object, THREE) {
  if (!object || !THREE) return false
  var box = getRenderableBox(object, THREE)
  if (!box || box.isEmpty()) return false
  var ends = measureEndWidths(object, THREE, box)
  var cluster = engineEndBias(ends)
  if (cluster > 0) return false
  if (cluster < 0) return true
  var names = nameEndBias(ends)
  if (names > 0) return false
  if (names < 0) return true
  return false
}

function noseTaperScore(object, THREE, box, size, rot) {
  return noseTaperFromEnds(measureEndWidths(object, THREE, box, rot), size)
}

function standMeasureBox(object, THREE) {
  var full = new THREE.Box3()
  if (object) full.setFromObject(object)
  var rocket = getRenderableBox(object, THREE)
  if (!object || full.isEmpty()) return rocket
  if (!rocket || rocket.isEmpty()) return full
  var fullSize = full.getSize(new THREE.Vector3())
  if (isBoardSize(fullSize)) return full
  return rocket
}

function scoreStandWorld(object, THREE, rot) {
  var box = standMeasureBox(object, THREE)
  if (!box || box.isEmpty()) return -1e9
  var size = rotateSizeByEuler(box.getSize(new THREE.Vector3()), rot)
  return scoreStandSize(size) + noseTaperScore(object, THREE, box, size, rot)
}

/**
 * 尺寸先选定立起轴（猎鹰重型 Z-up → -90°X；平铺展板绕薄轴立起并对着镜头）。
 * 已 Y-up 的横排全系列保持底座水平，不把台面立成竖版展板。
 * 朝向用软件旋转量两端，不依赖 matrixWorld 是否跟上包装节点。
 */
function autoStandRotation(object, THREE) {
  var fallback = withStandFlip({ x: 0, y: 0, z: 0 })
  if (!object || !THREE) return fallback
  var sizeBox = standMeasureBox(object, THREE)
  var rawSize = sizeBox && !sizeBox.isEmpty() ? sizeBox.getSize(new THREE.Vector3()) : null
  fallback = pickStandRotationFromSize(rawSize)
  if (!rawSize || !sizeBox) return fallback
  var items = collectStandMeshes(object, THREE)
  var best = fallback
  var bestScore = -1e12
  for (var i = 0; i < STAND_CANDIDATES.length; i++) {
    var cand = STAND_CANDIDATES[i]
    var size = rotateSizeByEuler(rawSize, cand)
    var ends = measureEndWidthsFromItems(items, sizeBox, cand, THREE)
    var score = scoreStandSize(size) + noseTaperFromEnds(ends, size) + standCandidateBias(cand)
    if (score > bestScore) {
      bestScore = score
      best = withStandFlip(cand)
    }
  }
  return finalizeStandRotation(rawSize, best)
}

function wrapStandingModel(object, THREE) {
  if (!object || !THREE || !THREE.Group) return object
  var stand = new THREE.Group()
  stand.name = 'r3d-stand'
  stand.add(object)
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  var rot = autoStandRotation(stand, THREE)
  stand.rotation.set(rot.x, rot.y, rot.z)
  stand.updateMatrixWorld(true)
  stand._r3dStand = {
    base: { x: rot.x, y: rot.y, z: rot.z },
    axis: rot.flip || 'x',
    flipped: false,
    flippedLeft: false
  }
  var yaw = new THREE.Group()
  yaw.name = 'r3d-yaw'
  yaw.add(stand)
  var spin = new THREE.Group()
  spin.name = 'r3d-exhibit-root'
  spin.add(yaw)
  spin.updateMatrixWorld(true)
  return spin
}

function findNamedGroup(root, name) {
  if (!root || !name) return null
  if (root.name === name) return root
  if (typeof root.traverse === 'function') {
    var found = null
    root.traverse(function (child) {
      if (!found && child && child.name === name) found = child
    })
    if (found) return found
  }
  var kids = root.children || []
  for (var i = 0; i < kids.length; i++) {
    var hit = findNamedGroup(kids[i], name)
    if (hit) return hit
  }
  return null
}

function findStandGroup(root) {
  if (!root) return null
  if (root.name === 'r3d-stand' || root._r3dStand) return root
  if (typeof root.traverse === 'function') {
    var found = null
    root.traverse(function (child) {
      if (!found && child && (child.name === 'r3d-stand' || child._r3dStand)) found = child
    })
    if (found) return found
  }
  var kids = root.children || []
  for (var i = 0; i < kids.length; i++) {
    var hit = findStandGroup(kids[i])
    if (hit) return hit
  }
  return null
}

function findYawGroup(root) {
  return findNamedGroup(root, 'r3d-yaw')
}

function markIpRefTree(object, slug) {
  if (!object) return
  object.name = 'r3d-ip-' + String(slug || 'fig')
  if (!object.userData) object.userData = {}
  object.userData.r3dIpRef = true
  object.userData.r3dIpSlug = slug
  if (typeof object.traverse === 'function') {
    object.traverse(function (child) {
      if (!child.userData) child.userData = {}
      child.userData.r3dIpRef = true
    })
  }
}

function isMeshNode(child) {
  return !!(
    child &&
    child.geometry &&
    (child.isMesh || child.isSkinnedMesh || child.type === 'Mesh' || child.type === 'SkinnedMesh')
  )
}

function collectSkeletonCore(object, THREE) {
  if (!object || !THREE || typeof object.traverse !== 'function') return null
  var items = []
  var tmp = THREE.Vector3 ? new THREE.Vector3() : null
  object.traverse(function (child) {
    var bones = child && child.skeleton && child.skeleton.bones
    if (!bones || !bones.length) return
    if (child.skeleton.update) child.skeleton.update()
    for (var i = 0; i < bones.length; i++) {
      var bone = bones[i]
      if (!bone) continue
      if (typeof bone.getWorldPosition === 'function' && tmp) {
        bone.getWorldPosition(tmp)
        items.push({ name: bone.name, x: tmp.x, y: tmp.y, z: tmp.z })
      } else if (bone.matrixWorld && tmp && typeof tmp.setFromMatrixPosition === 'function') {
        tmp.setFromMatrixPosition(bone.matrixWorld)
        items.push({ name: bone.name, x: tmp.x, y: tmp.y, z: tmp.z })
      }
    }
  })
  var named = ipScaleRef.ipCoreFromNamedPoints(items)
  if (!named) return null
  return {
    x: named.x,
    y: named.y,
    z: named.z,
    bodyW: 0,
    bodyD: 0,
    minY: named.y,
    maxY: named.y
  }
}

function collectObjectWorldPoints(object, THREE, maxSamples) {
  var raw = []
  if (!object || !THREE) return raw
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  if (typeof object.traverse !== 'function') return raw
  object.traverse(function (child) {
    if (!isMeshNode(child)) return
    if (child.visible === false) return
    if (child.userData && child.userData.r3dIpProp) return
    forEachWorldVertex(child, THREE, function (pos) {
      raw.push({ x: pos.x, y: pos.y, z: pos.z })
    })
  })
  var cap = maxSamples > 0 ? maxSamples : 5000
  if (raw.length <= cap) return raw
  var step = Math.ceil(raw.length / cap)
  var out = []
  for (var i = 0; i < raw.length; i += step) out.push(raw[i])
  return out
}

function measureIpFigureCore(object, THREE) {
  var bone = collectSkeletonCore(object, THREE)
  if (bone) return bone
  var core = ipScaleRef.ipCoreCenterFromPoints(collectObjectWorldPoints(object, THREE, 5000))
  if (core) return core
  if (!object || !THREE) return null
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  var box = new THREE.Box3().setFromObject(object)
  if (!box || box.isEmpty()) return null
  return {
    x: (box.min.x + box.max.x) * 0.5,
    y: (box.min.y + box.max.y) * 0.5,
    z: (box.min.z + box.max.z) * 0.5,
    bodyW: Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 0.01) * 0.5,
    bodyD: Math.max(box.max.z - box.min.z, 0.01),
    minY: box.min.y,
    maxY: box.max.y
  }
}

function measureVehicleCore(object, THREE) {
  if (!object || !THREE) return null
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  var box = new THREE.Box3().setFromObject(object)
  if (!box || box.isEmpty()) return null
  return {
    x: (box.min.x + box.max.x) * 0.5,
    y: (box.min.y + box.max.y) * 0.5,
    z: (box.min.z + box.max.z) * 0.5,
    bodyW: Math.max(box.max.x - box.min.x, 0.01),
    bodyD: Math.max(box.max.z - box.min.z, 0.01),
    minY: box.min.y,
    maxY: box.max.y
  }
}

function rememberIpFigureCore(fig, THREE) {
  if (!fig || !fig.object || !THREE) return null
  var core = ipScaleRef.isVehicleRef(fig.slug)
    ? measureVehicleCore(fig.object, THREE)
    : measureIpFigureCore(fig.object, THREE)
  if (!core) {
    fig.coreLocal = null
    return null
  }
  var local = toMeshLocal(fig.object, THREE, core)
  fig.coreLocal = local ? { x: local.x, y: local.y, z: local.z } : null
  return core
}

function ipFigureCoreWorld(fig, THREE) {
  if (!fig || !fig.object || !THREE) return null
  if (fig.coreLocal) {
    var w = fromMeshLocal(fig.object, THREE, fig.coreLocal)
    return { x: w.x, y: w.y, z: w.z }
  }
  return measureIpFigureCore(fig.object, THREE)
}

function measureObjectSize(object, THREE) {
  if (!object || !THREE) return { x: 0, y: 0, z: 0 }
  if (object.updateWorldMatrix) object.updateWorldMatrix(true, true)
  var box = new THREE.Box3().setFromObject(object)
  if (!box || box.isEmpty()) return { x: 0, y: 0, z: 0 }
  var size = box.getSize(new THREE.Vector3())
  return { x: size.x, y: size.y, z: size.z }
}

function measureStandingHeight(object, THREE, slug) {
  var size = measureObjectSize(object, THREE)
  if (ipScaleRef.isVehicleRef(slug)) return size.y
  return Math.max(size.y, size.z)
}

function rocketUpHeight(session) {
  if (!session || !session.modelRoot || !session.THREE) return 0
  var box = getExhibitFrameBox(session.modelRoot, session.THREE)
  if (!box || box.isEmpty()) return 0
  return box.max.y - box.min.y
}

function detachIpScaleRoot(session) {
  if (!session || !session.ipRefRoot) return
  var kids = (session.ipRefRoot.children || []).slice()
  for (var i = 0; i < kids.length; i++) session.ipRefRoot.remove(kids[i])
  if (session.ipRefRoot.parent) session.ipRefRoot.parent.remove(session.ipRefRoot)
  session.ipRefRoot = null
}

function stopIpFigureMixers(session) {
  if (!session || !session.ipRefLoaded) return
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var fig = session.ipRefLoaded[i]
    if (!fig) continue
    if (fig.mixer && typeof fig.mixer.stopAllAction === 'function') {
      try {
        fig.mixer.stopAllAction()
      } catch (e) {}
    }
    fig.mixer = null
  }
}

function playIpFigureClips(session) {
  if (!session || !session.ipRefLoaded || !session.ipRefLoaded.length) return 0
  var THREE = session.THREE
  if (!THREE || typeof THREE.AnimationMixer !== 'function') return 0
  stopIpFigureMixers(session)
  var n = 0
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var fig = session.ipRefLoaded[i]
    var obj = fig && fig.object
    if (!obj) continue
    var clips = fig.animations
    if (!clips || !clips.length) {
      clips = obj.userData && obj.userData.gltfAnimations
    }
    var clip = ipAnim.pickIpIdleClip(clips)
    if (!clip) continue
    try {
      var mixer = new THREE.AnimationMixer(obj)
      var action = mixer.clipAction(clip)
      if (action) {
        if (THREE.LoopRepeat != null) action.loop = THREE.LoopRepeat
        if (action.clampWhenFinished != null) action.clampWhenFinished = false
        if (typeof action.play === 'function') action.play()
      }
      fig.mixer = mixer
      n += 1
    } catch (e) {
      fig.mixer = null
    }
  }
  return n
}

function updateIpFigureMixers(session, dt) {
  if (!session || !session.ipRefLoaded) return
  var step = Number(dt)
  if (!(step > 0) || !isFinite(step)) return
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var mixer = session.ipRefLoaded[i] && session.ipRefLoaded[i].mixer
    if (mixer && typeof mixer.update === 'function') mixer.update(step)
  }
}

function clearIpScaleRefs(session) {
  stopIpFigureMixers(session)
  clearIpChatPanel(session)
  clearMuskIntroPanel(session)
  clearXingwenHalo(session)
  detachIpScaleRoot(session)
  if (session && session.ipRefLoaded) {
    for (var i = 0; i < session.ipRefLoaded.length; i++) {
      var fig = session.ipRefLoaded[i]
      if (fig && fig.object) disposeObject3D(fig.object)
    }
  }
  if (session) session.ipRefLoaded = null
}

function placeIpScaleRefs(session, rocketLengthM) {
  if (!session || !session.ipRefLoaded || !session.ipRefLoaded.length) return false
  var THREE = session.THREE
  if (!session.scene || !session.modelRoot || !THREE) return false
  var lengthM = ipScaleRef.parseLengthMeters(rocketLengthM != null ? rocketLengthM : session.rocketLengthM)
  var rocketH = rocketUpHeight(session)
  session.rocketLengthM = lengthM
  if (!(lengthM > 0) || !(rocketH > 0)) return false
  session.ipRefLoaded = ipScaleRef.sortIpFiguresForStand(session.ipRefLoaded)
  detachIpScaleRoot(session)
  var rocketBox = getExhibitFrameBox(session.modelRoot, THREE)
  var groundY = rocketBox.min.y
  var root = new THREE.Group()
  root.name = 'r3d-ip-refs'
  if (!root.userData) root.userData = {}
  root.userData.r3dIpRef = true
  session.scene.add(root)
  session.ipRefRoot = root
  var ruler = null
  for (var r = 0; r < session.ipRefLoaded.length; r++) {
    if (session.ipRefLoaded[r] && session.ipRefLoaded[r].slug === 'musk') {
      ruler = session.ipRefLoaded[r]
      break
    }
  }
  if (!ruler) ruler = session.ipRefLoaded[0]
  if (ruler && !ruler.modelHeight && ruler.object) {
    ruler.modelHeight = measureStandingHeight(ruler.object, THREE)
  }
  var rulerOpts = {
    rocketLengthM: lengthM,
    rocketModelHeight: rocketH,
    rulerModelHeight: ruler && ruler.modelHeight,
    rulerHighestPointM: ruler && ruler.highestPointM
  }
  var prepared = []
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var fig = session.ipRefLoaded[i]
    var obj = fig && fig.object
    if (!obj) continue
    obj.position.set(0, 0, 0)
    obj.scale.set(1, 1, 1)
    if (obj.rotation) {
      if (typeof obj.rotation.set === 'function') obj.rotation.set(0, 0, 0)
      else obj.rotation.y = 0
    }
    session.scene.add(obj)
    if (obj.updateWorldMatrix) obj.updateWorldMatrix(true, true)
    var modelSize = measureObjectSize(obj, THREE)
    fig.modelSize = modelSize
    var modelH = ipScaleRef.isVehicleRef(fig.slug) ? modelSize.y : fig.modelHeight || measureStandingHeight(obj, THREE, fig.slug)
    fig.modelHeight = modelH
    var scale = ipScaleRef.resolveFigureSceneScale(
      {
        slug: fig.slug,
        ipModelHeight: modelH,
        modelSize: modelSize,
        highestPointM: fig.highestPointM,
        lengthM: fig.lengthM,
        widthM: fig.widthM
      },
      rulerOpts
    )
    if (!(scale > 0)) continue
    obj.scale.set(scale, scale, scale)
    if (obj.updateWorldMatrix) obj.updateWorldMatrix(true, true)
    var box = new THREE.Box3().setFromObject(obj)
    var size = box.getSize(new THREE.Vector3())
    var stride = ipScaleRef.ipStandingStride(size, fig.slug)
    if (!(stride.step > 0) && !ipScaleRef.isVehicleRef(fig.slug)) continue
    var core = rememberIpFigureCore(fig, THREE)
    prepared.push({
      fig: fig,
      obj: obj,
      box: box,
      size: size,
      stride: stride,
      isVehicle: ipScaleRef.isVehicleRef(fig.slug),
      midX: core ? core.x : (box.min.x + box.max.x) * 0.5,
      midZ: core ? core.z : (box.min.z + box.max.z) * 0.5
    })
  }
  if (!prepared.length) {
    detachIpScaleRoot(session)
    return false
  }
  var people = []
  var vehicles = []
  for (var s = 0; s < prepared.length; s++) {
    if (prepared[s].isVehicle) vehicles.push(prepared[s])
    else people.push(prepared[s])
  }
  if (!people.length) people = prepared
  var pairW = 0
  var pairD = 0
  var bodyW = people[0].stride.bodyW
  for (var p = 0; p < people.length; p++) {
    pairW += p === 0 ? people[p].stride.bodyW : people[p].stride.step
    pairD = Math.max(pairD, people[p].size.z, people[p].stride.bodyW * 0.72)
  }
  var hull = getIpCollisionBox(session.modelRoot, THREE)
  if (!hull || hull.isEmpty()) hull = rocketBox
  var cam = session.camera && session.camera.position
  var camXZ = cam && isFinite(cam.x) && isFinite(cam.z) ? { x: cam.x, z: cam.z } : null
  var rocketXZ = {
    minX: hull.min.x,
    maxX: hull.max.x,
    minZ: hull.min.z,
    maxZ: hull.max.z
  }
  var stand = ipScaleRef.pickIpStandBesideRocket({
    rocket: rocketXZ,
    pairW: pairW,
    pairD: pairD,
    bodyW: bodyW,
    camera: camXZ
  })
  var cursorX = stand.x
  var standZ = stand.z
  function attachRef(item, x, z) {
    item.obj.position.x += x - item.midX
    item.obj.position.y += groundY - item.box.min.y
    item.obj.position.z += z - item.midZ
    if (typeof root.attach === 'function') root.attach(item.obj)
    else {
      session.scene.remove(item.obj)
      root.add(item.obj)
    }
  }
  for (var j = 0; j < people.length; j++) {
    attachRef(people[j], cursorX, standZ)
    cursorX += people[j].stride.step
  }
  if (vehicles.length && people.length && people !== prepared) {
    var peopleWorld = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, midX: 0, midZ: 0 }
    for (var u = 0; u < people.length; u++) {
      var person = people[u]
      var dx = person.obj.position.x
      var dz = person.obj.position.z
      peopleWorld.minX = Math.min(peopleWorld.minX, person.box.min.x + dx)
      peopleWorld.maxX = Math.max(peopleWorld.maxX, person.box.max.x + dx)
      peopleWorld.minZ = Math.min(peopleWorld.minZ, person.box.min.z + dz)
      peopleWorld.maxZ = Math.max(peopleWorld.maxZ, person.box.max.z + dz)
      peopleWorld.midX += person.midX + dx
      peopleWorld.midZ += person.midZ + dz
    }
    peopleWorld.midX /= people.length
    peopleWorld.midZ /= people.length
    var metersPerUnit = lengthM / rocketH
    for (var v = 0; v < vehicles.length; v++) {
      var truck = vehicles[v]
      if (truck.obj.updateWorldMatrix) truck.obj.updateWorldMatrix(true, true)
      var behind = ipScaleRef.pickVehicleBehindPeople({
        people: peopleWorld,
        truck: { x: truck.size.x, z: truck.size.z },
        gapM: ipScaleRef.VEHICLE_BEHIND_M,
        metersPerUnit: metersPerUnit,
        camera: camXZ,
        rocket: rocketXZ
      })
      attachRef(truck, behind.x, behind.z)
    }
  } else {
    for (var w = 0; w < vehicles.length; w++) {
      attachRef(vehicles[w], cursorX, standZ)
      cursorX += vehicles[w].stride.step || vehicles[w].size.x
    }
  }
  clearXingwenHalo(session)
  playIpFigureClips(session)
  ensureXingwenHalo(session)
  layoutIpChatPanel(session)
  return true
}

function faceIpFiguresToCamera(session) {
  if (!session || !session.ipRefLoaded || !session.ipRefLoaded.length) return false
  var n = 0
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var obj = session.ipRefLoaded[i] && session.ipRefLoaded[i].object
    if (!obj || !obj.rotation) continue
    if (typeof obj.rotation.set === 'function') obj.rotation.set(0, 0, 0)
    else obj.rotation.y = 0
    n += 1
  }
  return n > 0
}

function disposeIpFigureList(list) {
  if (!list || !list.length) return
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].object) disposeObject3D(list[i].object)
  }
}

function attachIpScaleRefs(session, opts) {
  var src = opts && typeof opts === 'object' ? opts : {}
  if (session) session.ipRefToken = (session.ipRefToken || 0) + 1
  var token = session ? session.ipRefToken : 0
  clearIpScaleRefs(session)
  var figures = src.figures || []
  var lengthM = ipScaleRef.parseLengthMeters(src.rocketLengthM)
  if (session) session.rocketLengthM = lengthM
  if (!session || !figures.length || !(lengthM > 0)) return Promise.resolve(false)
  if (!ipScaleRef.shouldShowIpScaleRef(src)) return Promise.resolve(false)
  return Promise.all(
    figures.map(function (fig) {
      if (!fig || !fig.url) return Promise.resolve(null)
      return loadGlb(src.lib, fig.url, src.nativeCanvas, null, { series: false })
        .then(function (object) {
          markIpRefTree(object, fig.slug)
          return {
            object: object,
            slug: fig.slug,
            highestPointM: fig.highestPoint,
            lengthM: fig.lengthM,
            widthM: fig.widthM,
            modelSize: measureObjectSize(object, session.THREE),
            modelHeight: measureStandingHeight(object, session.THREE, fig.slug),
            animations: (object.userData && object.userData.gltfAnimations) || []
          }
        })
        .catch(function () {
          return null
        })
    })
  ).then(function (loaded) {
    var ok = []
    for (var i = 0; i < loaded.length; i++) {
      if (loaded[i] && loaded[i].object) ok.push(loaded[i])
    }
    if (!session || session.ipRefToken !== token || !session.modelRoot || !session.scene) {
      disposeIpFigureList(ok)
      return false
    }
    if (!ok.length) return false
    session.ipRefLoaded = ipScaleRef.sortIpFiguresForStand(ok)
    return placeIpScaleRefs(session, lengthM)
  })
}

function findIpFigure(session, slug) {
  var list = session && session.ipRefLoaded
  var key = String(slug || '')
  if (!list || !key) return null
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].object && list[i].slug === key) return list[i]
  }
  return null
}

function ipFigureWorldBox(fig, THREE) {
  if (!fig || !fig.object || !THREE) return null
  if (fig.object.updateWorldMatrix) fig.object.updateWorldMatrix(true, true)
  var box = new THREE.Box3().setFromObject(fig.object)
  if (!box || box.isEmpty()) return null
  return box
}

var HIT_WORLD_PAD_RATIO = 0.06

function cloneWorldBox(box, THREE) {
  if (!box) return null
  if (typeof box.clone === 'function') return box.clone()
  if (!THREE || !THREE.Box3) return box
  var out = new THREE.Box3()
  if (typeof out.copy === 'function') return out.copy(box)
  out.min.x = box.min.x
  out.min.y = box.min.y
  out.min.z = box.min.z
  out.max.x = box.max.x
  out.max.y = box.max.y
  out.max.z = box.max.z
  return out
}

function inflateWorldBox(box, THREE, ratio) {
  var r = Number(ratio)
  if (!box || !(r > 0)) return box
  var out = cloneWorldBox(box, THREE)
  var sx = Math.max(0, out.max.x - out.min.x)
  var sy = Math.max(0, out.max.y - out.min.y)
  var sz = Math.max(0, out.max.z - out.min.z)
  out.min.x -= sx * r
  out.max.x += sx * r
  out.min.y -= sy * r
  out.max.y += sy * r
  out.min.z -= sz * r
  out.max.z += sz * r
  return out
}

function fitBoxAxis(out, axis, center, need, shrinkRatio) {
  if (!(need > 0) || !out || !out.min || !out.max) return
  var cur = out.max[axis] - out.min[axis]
  var limit = Number(shrinkRatio) > 1 ? need * Number(shrinkRatio) : 0
  if (cur >= need && !(limit > 0 && cur > limit)) return
  out.min[axis] = center - need * 0.5
  out.max[axis] = center + need * 0.5
}

function alignVehicleBoxToModel(box, fig, THREE, session) {
  var dims = ipScaleRef.resolveVehicleDims(fig)
  var rocketH = rocketUpHeight(session)
  var lengthM = ipScaleRef.parseLengthMeters(session && session.rocketLengthM)
  if (!(rocketH > 0) || !(lengthM > 0)) return box
  var mpu = lengthM / rocketH
  if (!(mpu > 0)) return box
  var needL = dims.lengthM / mpu
  var needW = dims.widthM / mpu
  var needH = dims.heightM / mpu
  var sx = box.max.x - box.min.x
  var sy = box.max.y - box.min.y
  var sz = box.max.z - box.min.z
  var out = cloneWorldBox(box, THREE)
  var cx = (box.min.x + box.max.x) * 0.5
  var cz = (box.min.z + box.max.z) * 0.5
  if (sx >= sz) {
    fitBoxAxis(out, 'x', cx, needL, 1.25)
    fitBoxAxis(out, 'z', cz, needW, 1.25)
  } else {
    fitBoxAxis(out, 'z', cz, needL, 1.25)
    fitBoxAxis(out, 'x', cx, needW, 1.25)
  }
  if (sy < needH || sy > needH * 1.25) out.max.y = box.min.y + needH
  return out
}

function ipFigurePersonHitBox(fig, THREE) {
  var box = ipFigureWorldBox(fig, THREE)
  if (!box) return null
  var core = ipFigureCoreWorld(fig, THREE)
  if (!core || !THREE.Box3 || !THREE.Vector3) return box
  var h = Math.max(box.max.y - box.min.y, 0.2)
  var r = Math.max(Number(core.bodyW) > 0 ? core.bodyW * 0.55 : h * 0.22, h * 0.18)
  var out = new THREE.Box3()
  if (out.min.set && out.max.set) {
    out.min.set(core.x - r, box.min.y, core.z - r)
    out.max.set(core.x + r, box.max.y, core.z + r)
  } else {
    out.min.x = core.x - r
    out.min.y = box.min.y
    out.min.z = core.z - r
    out.max.x = core.x + r
    out.max.y = box.max.y
    out.max.z = core.z + r
  }
  return out
}

function ipFigureHitWorldBox(fig, THREE, session) {
  var box = ipFigureWorldBox(fig, THREE)
  if (!box) return null
  var modelBox = ipScaleRef.isVehicleRef(fig && fig.slug)
    ? alignVehicleBoxToModel(box, fig, THREE, session)
    : ipFigurePersonHitBox(fig, THREE) || box
  return inflateWorldBox(modelBox || box, THREE, HIT_WORLD_PAD_RATIO)
}

function ipFigureFocusBox(fig, THREE) {
  var box = ipFigureWorldBox(fig, THREE)
  if (!box) return null
  if (ipScaleRef.isVehicleRef(fig && fig.slug)) return box
  var core = ipFigureCoreWorld(fig, THREE)
  if (!core || !THREE.Box3 || !THREE.Vector3) return box
  var h = Math.max(box.max.y - box.min.y, 0.2)
  var r = Math.max(Number(core.bodyW) > 0 ? core.bodyW * 0.55 : h * 0.22, h * 0.18)
  var yTop = Math.min(box.max.y, Math.max(core.y + r * 1.05, box.min.y + h * 0.58))
  var out = new THREE.Box3()
  out.min.set(core.x - r, box.min.y, core.z - r)
  out.max.set(core.x + r, yTop, core.z + r)
  return out
}

function projectBoxToCssRect(session, box, forHit) {
  if (!session || !box) return null
  var min = box.min
  var max = box.max
  var cx = (min.x + max.x) * 0.5
  var cy = (min.y + max.y) * 0.5
  var cz = (min.z + max.z) * 0.5
  var pts = [
    [min.x, min.y, min.z],
    [min.x, min.y, max.z],
    [min.x, max.y, min.z],
    [min.x, max.y, max.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z]
  ]
  if (forHit) {
    pts.push(
      [cx, cy, cz],
      [min.x, cy, cz],
      [max.x, cy, cz],
      [cx, min.y, cz],
      [cx, max.y, cz],
      [cx, cy, min.z],
      [cx, cy, max.z]
    )
  }
  var left = Infinity
  var top = Infinity
  var right = -Infinity
  var bottom = -Infinity
  var any = false
  for (var i = 0; i < pts.length; i++) {
    var p = projectToCss(session, pts[i][0], pts[i][1], pts[i][2])
    if (!p) continue
    if (forHit) {
      if (!p.inFront) continue
    } else if (!p.visible) {
      continue
    }
    any = true
    left = Math.min(left, p.x)
    top = Math.min(top, p.y)
    right = Math.max(right, p.x)
    bottom = Math.max(bottom, p.y)
  }
  if (!any) return null
  return { left: left, top: top, right: right, bottom: bottom }
}

function pickIpRefAt(session, cssX, cssY) {
  if (!session || !session.ipRefLoaded || !session.ipRefLoaded.length) return ''
  var hits = []
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var fig = session.ipRefLoaded[i]
    var box = ipFigureHitWorldBox(fig, session.THREE, session)
    var rect = projectBoxToCssRect(session, box, true)
    if (!rect) continue
    hits.push({
      slug: fig.slug,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom
    })
  }
  return ipIntro.pickHitSlug(hits, cssX, cssY)
}

function ipIntroClipBox(figBox, rocketBox) {
  if (!figBox) return rocketBox
  if (!rocketBox || (typeof rocketBox.isEmpty === 'function' && rocketBox.isEmpty())) return figBox
  if (typeof figBox.clone === 'function') {
    var u = figBox.clone()
    if (typeof u.union === 'function') {
      u.union(rocketBox)
      return u
    }
  }
  return rocketBox
}

function ipIntroCameraPose(figBox, rocketBox, THREE, focusBox) {
  var lookBox = focusBox && !(typeof focusBox.isEmpty === 'function' && focusBox.isEmpty()) ? focusBox : figBox
  var size = figBox.getSize(new THREE.Vector3())
  var lookSize = lookBox.getSize(new THREE.Vector3())
  var lookCenter = lookBox.getCenter(new THREE.Vector3())
  var focus = new THREE.Vector3(lookCenter.x, lookBox.min.y + lookSize.y * 0.76, lookCenter.z)
  var dist = Math.max(size.y * 1.72, size.x * 2.05, size.z * 2.05, 0.4)
  var rocketSpan = 0
  if (rocketBox && !(typeof rocketBox.isEmpty === 'function' && rocketBox.isEmpty())) {
    var rs = rocketBox.getSize(new THREE.Vector3())
    rocketSpan = Math.max(rs.x, rs.y, rs.z)
  }
  return {
    pos: new THREE.Vector3(focus.x + dist * 0.12, focus.y + dist * 0.16, focus.z + dist * 0.98),
    target: focus,
    near: Math.max(dist / 80, 0.01),
    far: Math.max(dist * 40, rocketSpan * 12, 200),
    minDistance: dist * 0.42,
    maxDistance: dist * 8,
    ms: 640
  }
}

function lockIpIntroControls(session) {
  if (!session) return
  session.autoRotate = false
  clearAutoRotateTimer(session)
}

function unlockIpIntroControls(session, mode) {
  if (!session) return
  applyExhibitControls(session, mode || 'show')
  session.autoRotate = false
}

function playIpIntroView(session, slug) {
  if (!session || !session.camera || !session.controls || !session.THREE) return false
  var fig = findIpFigure(session, slug)
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return false
  var rocketBox = getExhibitFrameBox(session.modelRoot, session.THREE)
  var pose = ipIntroCameraPose(box, rocketBox, session.THREE, ipFigureFocusBox(fig, session.THREE))
  applyBoxClip(session.camera, ipIntroClipBox(box, rocketBox), session.THREE)
  session.ipIntroSlug = fig.slug
  session.autoRotate = false
  clearAutoRotateTimer(session)
  session.camTween = {
    fromPos: session.camera.position.clone(),
    toPos: pose.pos,
    fromTarget: session.controls.target.clone(),
    toTarget: pose.target,
    start: Date.now(),
    duration: pose.ms
  }
  if (session._dimLabelCache && session._dimLabelCache.length && typeof session.onDimLabels === 'function') {
    session._dimLabelCache = []
    session.onDimLabels([])
  }
  emitIpIntroAnchor(session)
  return true
}

function clearIpIntroView(session, resumeMode) {
  if (!session) return
  session.ipIntroSlug = ''
  if (resumeMode) {
    applyExhibitControls(session, resumeMode)
    playExhibitView(session, resumeMode)
  } else {
    applyExhibitControls(session, 'show')
  }
}

function panelFacingCamera(session, root) {
  if (!session || !root || !session.camera || !session.camera.position) return false
  var dx = session.camera.position.x - root.position.x
  var dz = session.camera.position.z - root.position.z
  var len = Math.sqrt(dx * dx + dz * dz) || 1
  var yaw = (root.rotation && root.rotation.y) || 0
  var fwdX = Math.sin(yaw)
  var fwdZ = Math.cos(yaw)
  return fwdX * (dx / len) + fwdZ * (dz / len) > 0.12
}

function measureHeadLockLayout(session, slug) {
  var hidden = { visible: false, x: 0, y: 0, w: 0, h: 0, scale: 1, fs: 13, slug: String(slug || '') }
  if (!session || !session.THREE) return hidden
  var key = String(slug || '')
  var kind = key === 'astro' ? 'astro' : 'musk'
  var fig = findIpFigure(session, key)
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return hidden
  var h = Math.max(box.max.y - box.min.y, 0.2)
  var spec = ipChat3d.headLockWorldSize(kind, h)
  var core = ipFigureCoreWorld(fig, session.THREE)
  var cx = core ? core.x : (box.min.x + box.max.x) * 0.5
  var cz = core ? core.z : (box.min.z + box.max.z) * 0.5
  var headY = (core ? Math.min(box.max.y, core.y + Math.max(core.bodyW || 0, h * 0.4) * 0.72) : box.max.y) + spec.lift
  var head = projectToCss(session, cx, headY, cz)
  var extra = null
  if (kind !== 'astro') {
    extra = {
      text: ipIntro.joinIntroLines(ipIntro.getIpIntro(key)),
      hint: true
    }
  }
  var next = ipChat3d.layoutHeadLockOverlay(
    {
      headX: head.x,
      headY: head.y,
      visible: !!head.visible
    },
    session.cssW,
    session.cssH,
    kind,
    extra
  )
  next.slug = key
  return next
}

function emitIpIntroAnchor(session) {
  if (!session || typeof session.onIpIntroAnchor !== 'function' || !session.ipIntroSlug) return
  var next = measureHeadLockLayout(session, session.ipIntroSlug)
  var prev = session._ipIntroAnchor
  if (
    prev &&
    prev.slug === next.slug &&
    !!prev.visible === !!next.visible &&
    Math.abs(prev.x - next.x) < 1.5 &&
    Math.abs(prev.y - next.y) < 1.5 &&
    Math.abs((prev.w || 0) - (next.w || 0)) < 2 &&
    Math.abs((prev.h || 0) - (next.h || 0)) < 2
  ) {
    return
  }
  session._ipIntroAnchor = next
  session.onIpIntroAnchor(next)
}

function emitIpNameTags(session) {
  if (!session || typeof session.onIpTags !== 'function') return
  if (session.ipIntroSlug || !session.ipRefLoaded || !session.ipRefLoaded.length) {
    if (session._ipTagCache && session._ipTagCache.length) {
      session._ipTagCache = []
      session.onIpTags([])
    }
    return
  }
  var items = []
  for (var i = 0; i < session.ipRefLoaded.length; i++) {
    var fig = session.ipRefLoaded[i]
    var box = ipFigureWorldBox(fig, session.THREE)
    if (!box) continue
    var meta = ipIntro.getIpIntro(fig.slug)
    if (!meta) continue
    if (session.xwPanel && fig.slug === 'astro') continue
    var core = ipFigureCoreWorld(fig, session.THREE)
    var p = projectToCss(
      session,
      core ? core.x : (box.min.x + box.max.x) * 0.5,
      core ? Math.min(box.max.y, core.y + Math.max(core.bodyW || 0, box.max.y - box.min.y) * 0.36) : box.max.y,
      core ? core.z : (box.min.z + box.max.z) * 0.5
    )
    items.push({
      key: 'tag-' + fig.slug,
      text: meta.name,
      x: p.x - 16,
      y: p.y - 22,
      visible: p.visible
    })
  }
  if (!dimLabelsChanged(session._ipTagCache, items)) return
  session._ipTagCache = items
  session.onIpTags(items)
}

var XW_TEX_W = 512
var XW_TEX_H = 384

function markIpProp(obj, name) {
  if (!obj) return
  obj.name = name
  if (!obj.userData) obj.userData = {}
  obj.userData.r3dIpRef = true
}

function makeBoxGeo(THREE, w, h, d) {
  var Ctor = THREE && (THREE.BoxGeometry || THREE.BoxBufferGeometry)
  if (typeof Ctor !== 'function') return null
  return new Ctor(w, h, d)
}

function makeSphereGeo(THREE, r, seg) {
  var Ctor = THREE && (THREE.SphereGeometry || THREE.SphereBufferGeometry)
  if (typeof Ctor !== 'function') return null
  return new Ctor(r, seg || 16, seg || 12)
}

function makePlaneGeo(THREE, w, h) {
  var Ctor = THREE && (THREE.PlaneGeometry || THREE.PlaneBufferGeometry)
  if (typeof Ctor !== 'function') return null
  return new Ctor(w, h)
}

function makeDrawCanvas(w, h) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.createOffscreenCanvas === 'function') {
      var canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      if (canvas) {
        canvas.width = w
        canvas.height = h
        return canvas
      }
    }
  } catch (e) {}
  return null
}

function makeCanvasTexture(THREE, canvas) {
  if (!THREE || !canvas) return null
  var tex = null
  if (typeof THREE.CanvasTexture === 'function') tex = new THREE.CanvasTexture(canvas)
  else if (typeof THREE.Texture === 'function') tex = new THREE.Texture(canvas)
  if (tex) tex.needsUpdate = true
  return tex
}

function detachNamed(session, key) {
  if (!session || !session[key]) return
  var obj = session[key]
  if (obj.parent) obj.parent.remove(obj)
  disposeObject3D(obj)
  session[key] = null
}

function colorRgb(c) {
  if (!c) return null
  if (isFinite(c.r) && isFinite(c.g) && isFinite(c.b)) {
    return { r: c.r, g: c.g, b: c.b }
  }
  if (typeof c.getHex === 'function') {
    var hex = c.getHex()
    return {
      r: ((hex >> 16) & 255) / 255,
      g: ((hex >> 8) & 255) / 255,
      b: (hex & 255) / 255
    }
  }
  return null
}

function isYellowishRgb(rgb) {
  if (!rgb) return false
  return rgb.r > 0.52 && rgb.g > 0.36 && rgb.b < 0.48 && rgb.r + rgb.g > rgb.b * 2.6
}

function meshLooksLikeHeadLamp(child, mat) {
  var hay = String((child && (child.name || child.parent && child.parent.name)) || '')
  if (/lamp|light|halo|led|bulb|glow|yellow|gold|amber|灯|黄/i.test(hay)) return true
  if (!mat) return false
  return isYellowishRgb(colorRgb(mat.color)) || isYellowishRgb(colorRgb(mat.emissive))
}

function collectXingwenGlowMats(session) {
  var found = collectXingwenLampParts(session)
  return found.mats
}

function threeBoxToPlain(mb) {
  if (!mb || !mb.min || !mb.max) return null
  return {
    minX: mb.min.x,
    maxX: mb.max.x,
    minY: mb.min.y,
    maxY: mb.max.y,
    minZ: mb.min.z,
    maxZ: mb.max.z
  }
}

function plainBoxOverlaps(a, b, pad) {
  if (!a || !b) return false
  var p = isFinite(pad) ? pad : 1
  var ax = (a.minX + a.maxX) * 0.5
  var az = (a.minZ + a.maxZ) * 0.5
  var hx = Math.max((a.maxX - a.minX) * 0.5 * p, 0.01)
  var hz = Math.max((a.maxZ - a.minZ) * 0.5 * p, 0.01)
  var bx = (b.minX + b.maxX) * 0.5
  var bz = (b.minZ + b.maxZ) * 0.5
  return Math.abs(bx - ax) <= hx && Math.abs(bz - az) <= hz
}

function readAttrVertex(attr, index, target) {
  if (!attr || !target) return false
  if (typeof attr.getX === 'function') {
    target.x = attr.getX(index)
    target.y = attr.getY(index)
    target.z = attr.getZ(index)
    return isFinite(target.x) && isFinite(target.y) && isFinite(target.z)
  }
  var arr = attr.array
  var size = Number(attr.itemSize) > 0 ? attr.itemSize : 3
  if (!arr) return false
  var i = index * size
  if (i + 2 >= arr.length) return false
  target.x = arr[i]
  target.y = arr[i + 1]
  target.z = arr[i + 2]
  return isFinite(target.x) && isFinite(target.y) && isFinite(target.z)
}

function forEachWorldVertex(child, THREE, fn) {
  if (!child || !child.geometry || !THREE || typeof fn !== 'function') return
  var g = child.geometry
  if (typeof child.updateWorldMatrix === 'function') child.updateWorldMatrix(true, false)
  var mw = child.matrixWorld
  var pos = new THREE.Vector3()
  var attr = (g.attributes && g.attributes.position) || (typeof g.getAttribute === 'function' ? g.getAttribute('position') : null)
  var count = attr && isFinite(attr.count) ? attr.count : attr && attr.array ? Math.floor(attr.array.length / (attr.itemSize || 3)) : 0
  if (attr && count > 0) {
    for (var i = 0; i < count; i++) {
      if (!readAttrVertex(attr, i, pos)) continue
      if (mw && typeof pos.applyMatrix4 === 'function') pos.applyMatrix4(mw)
      fn(pos)
    }
    return
  }
  var verts = g.vertices
  if (!verts || !verts.length) return
  for (var j = 0; j < verts.length; j++) {
    var v = verts[j]
    if (!v) continue
    pos.set(v.x, v.y, v.z)
    if (mw && typeof pos.applyMatrix4 === 'function') pos.applyMatrix4(mw)
    fn(pos)
  }
}

function measureXingwenCrownBox(session, fig) {
  if (!fig || !fig.object || !session || !session.THREE) return null
  var THREE = session.THREE
  var box = ipFigureWorldBox(fig, THREE)
  if (!box) return null
  var spanY = Math.max(box.max.y - box.min.y, 0.2)
  var band = spanY * 0.012
  var pts = []
  fig.object.traverse(function (child) {
    if (!isMeshNode(child)) return
    if (child.userData && child.userData.r3dIpProp) return
    forEachWorldVertex(child, THREE, function (pos) {
      pts.push({ x: pos.x, y: pos.y, z: pos.z })
    })
  })
  var apex = ipChat3d.pickApexFromPoints(pts, band)
  if (!apex || !apex.from) return null
  var pad = Math.max(band, 0.006)
  return {
    minX: apex.x - pad,
    maxX: apex.x + pad,
    minY: apex.y - band,
    maxY: apex.y,
    minZ: apex.z - pad,
    maxZ: apex.z + pad
  }
}

function meshLocalTopCenter(mesh, THREE) {
  if (!mesh || !THREE) return null
  var g = mesh.geometry
  if (g && !g.boundingBox && g.computeBoundingBox) g.computeBoundingBox()
  var bb = g && g.boundingBox
  if (!bb || (bb.isEmpty && bb.isEmpty())) return null
  var dx = bb.max.x - bb.min.x
  var dy = bb.max.y - bb.min.y
  var dz = bb.max.z - bb.min.z
  var p = new THREE.Vector3(
    (bb.min.x + bb.max.x) * 0.5,
    (bb.min.y + bb.max.y) * 0.5,
    (bb.min.z + bb.max.z) * 0.5
  )
  if (dy >= dx && dy >= dz) p.y = bb.max.y
  return p
}

function pickXingwenHelmetMesh(session, fig) {
  if (!fig || !fig.object || !session || !session.THREE) return null
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return null
  var topY = box.max.y
  var spanY = Math.max(box.max.y - box.min.y, 0.2)
  var best = null
  var bestScore = -1
  fig.object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    if (isIpRefObject(child)) return
    var mb = meshWorldBox(child, session.THREE)
    if (!mb || mb.isEmpty()) return
    if (topY - mb.max.y > spanY * 0.08) return
    var dx = mb.max.x - mb.min.x
    var dy = mb.max.y - mb.min.y
    var dz = mb.max.z - mb.min.z
    var area = Math.max(dx, 0) * Math.max(dz, 0)
    var name = String(child.name || (child.parent && child.parent.name) || '')
    var score = area
    if (/helm|head|hat|helmet|盔|头/i.test(name)) score *= 4
    if (Math.min(dx, dz) < Math.max(dx, dz) * 0.28 && dy > Math.max(dx, dz)) score *= 0.12
    if (score > bestScore) {
      bestScore = score
      best = child
    }
  })
  return best
}

function meshIsFullBody(mesh, figBox, THREE) {
  if (!mesh || !figBox) return false
  var mb = meshWorldBox(mesh, THREE)
  if (!mb || mb.isEmpty()) return false
  var h = Math.max(figBox.max.y - figBox.min.y, 0.2)
  return mb.max.y - mb.min.y > h * 0.55
}

function toMeshLocal(mesh, THREE, world) {
  var p = new THREE.Vector3(world.x, world.y, world.z)
  if (typeof mesh.worldToLocal === 'function') {
    mesh.worldToLocal(p)
    return p
  }
  if (mesh.updateWorldMatrix) mesh.updateWorldMatrix(true, false)
  if (mesh.matrixWorld && typeof mesh.matrixWorld.clone === 'function') {
    var inv = mesh.matrixWorld.clone()
    if (inv.invert) inv.invert()
    else if (inv.getInverse) inv.getInverse(mesh.matrixWorld)
    if (p.applyMatrix4) p.applyMatrix4(inv)
  }
  return p
}

function fromMeshLocal(mesh, THREE, local) {
  var p = new THREE.Vector3(local.x, local.y, local.z)
  if (typeof mesh.localToWorld === 'function') {
    mesh.localToWorld(p)
    return p
  }
  if (mesh.updateWorldMatrix) mesh.updateWorldMatrix(true, false)
  if (mesh.matrixWorld && p.applyMatrix4) p.applyMatrix4(mesh.matrixWorld)
  return p
}

function meshMaterials(child) {
  if (!child || !child.material) return []
  return Array.isArray(child.material) ? child.material : [child.material]
}

function meshHasYellowMat(child) {
  var list = meshMaterials(child)
  for (var i = 0; i < list.length; i++) {
    if (meshLooksLikeHeadLamp(child, list[i])) return true
  }
  return false
}

function readLocalVertex(attr, index, target) {
  return readAttrVertex(attr, index, target)
}

function measureLocalIsland(attr, idx, start, count, collect) {
  var minX = Infinity
  var maxX = -Infinity
  var minY = Infinity
  var maxY = -Infinity
  var minZ = Infinity
  var maxZ = -Infinity
  var xs = collect ? [] : null
  var zs = collect ? [] : null
  var n = 0
  var tmp = { x: 0, y: 0, z: 0 }
  var end = start + count
  for (var i = start; i < end; i++) {
    var vi = idx && typeof idx.getX === 'function' ? idx.getX(i) : i
    if (!readLocalVertex(attr, vi, tmp)) continue
    n += 1
    if (tmp.x < minX) minX = tmp.x
    if (tmp.x > maxX) maxX = tmp.x
    if (tmp.y < minY) minY = tmp.y
    if (tmp.y > maxY) maxY = tmp.y
    if (tmp.z < minZ) minZ = tmp.z
    if (tmp.z > maxZ) maxZ = tmp.z
    if (collect) {
      xs.push(tmp.x)
      zs.push(tmp.z)
    }
  }
  if (!n) return null
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ, xs: xs, zs: zs, n: n }
}

function finishYellowIsland(ext) {
  if (!ext) return null
  var midX = (ext.minX + ext.maxX) * 0.5
  var midZ = (ext.minZ + ext.maxZ) * 0.5
  var medX = ipChat3d.medianNumber(ext.xs)
  var medZ = ipChat3d.medianNumber(ext.zs)
  if (isFinite(medX)) midX = medX
  if (isFinite(medZ)) midZ = medZ
  return {
    x: midX,
    y: ext.maxY,
    z: midZ,
    size: { x: ext.maxX - ext.minX, y: ext.maxY - ext.minY, z: ext.maxZ - ext.minZ },
    center: { x: midX, y: (ext.minY + ext.maxY) * 0.5, z: midZ }
  }
}

function yellowIslandLocal(mesh) {
  if (!mesh || !mesh.geometry) return null
  var g = mesh.geometry
  var attr = (g.attributes && g.attributes.position) || (typeof g.getAttribute === 'function' ? g.getAttribute('position') : null)
  if (!attr || !attr.count) return null
  var mats = meshMaterials(mesh)
  var groups = g.groups || []
  var idx = g.index
  var useGroups = groups.length > 1 && mats.length > 1
  var cache = mesh.userData && mesh.userData._xwYellowIsland
  var sig = String(g.uuid || '') + ':' + attr.count + ':' + groups.length + ':' + mats.length
  if (cache && cache.sig === sig) return cache.island
  var best = null
  var bestScore = 0
  var fullCount = idx && idx.count ? idx.count : attr.count
  if (useGroups) {
    for (var gI = 0; gI < groups.length; gI++) {
      var grp = groups[gI]
      if (!grp) continue
      var mat = mats[grp.materialIndex]
      if (!meshLooksLikeHeadLamp(mesh, mat)) continue
      var ext = measureLocalIsland(attr, idx, grp.start || 0, grp.count || 0, false)
      if (!ext) continue
      var sx = ext.maxX - ext.minX
      var sy = ext.maxY - ext.minY
      var sz = ext.maxZ - ext.minZ
      var thin = Math.min(sx, sz)
      var wide = Math.max(sx, sz)
      if (sy < wide * 0.85) continue
      var score = sy / Math.max(thin, 0.001)
      if (score > bestScore) {
        bestScore = score
        best = grp
      }
    }
  }
  var raw = null
  if (best) raw = measureLocalIsland(attr, idx, best.start || 0, best.count || 0, true)
  if (!raw && meshHasYellowMat(mesh)) raw = measureLocalIsland(attr, idx, 0, fullCount, true)
  var island = finishYellowIsland(raw)
  if (!mesh.userData) mesh.userData = {}
  mesh.userData._xwYellowIsland = { sig: sig, island: island }
  return island
}

function pickXingwenStripeMesh(session, fig) {
  if (!fig || !fig.object || !session || !session.THREE) return null
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return null
  var core = ipFigureCoreWorld(fig, session.THREE)
  var cx = core ? core.x : (box.min.x + box.max.x) * 0.5
  var cz = core ? core.z : (box.min.z + box.max.z) * 0.5
  var h = Math.max(box.max.y - box.min.y, 0.2)
  var half = core && core.bodyW > 0 ? core.bodyW * 0.5 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
  var best = null
  var bestScore = 0
  fig.object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    if (isIpRefObject(child)) return
    if (!meshHasYellowMat(child)) return
    var island = yellowIslandLocal(child)
    if (!island || !island.size) return
    var sy = island.size.y
    if (sy < h * 0.16) return
    var sx = island.size.x
    var sz = island.size.z
    var thin = Math.min(sx, sz)
    var wide = Math.max(sx, sz)
    if (!(wide > 0)) return
    if (sy < wide * 0.9 && thin > wide * 0.82) return
    var w = fromMeshLocal(child, session.THREE, { x: island.x, y: island.y, z: island.z })
    var radial = Math.hypot(w.x - cx, w.z - cz)
    if (radial < half * 0.12) return
    var score = sy / Math.max(thin, 0.001)
    if (score > bestScore) {
      bestScore = score
      best = child
    }
  })
  return best
}

function xingwenBodyCenterWorld(session, fig) {
  if (!fig || !session || !session.THREE) return null
  var core = ipFigureCoreWorld(fig, session.THREE)
  if (core) return { x: core.x, y: core.y, z: core.z }
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return null
  return {
    x: (box.min.x + box.max.x) * 0.5,
    y: (box.min.y + box.max.y) * 0.5,
    z: (box.min.z + box.max.z) * 0.5
  }
}

function xingwenStripeFrontXZ(session, fig, body) {
  var stripe = pickXingwenStripeMesh(session, fig)
  if (!stripe || !body || !session.THREE) return null
  var island = yellowIslandLocal(stripe)
  var local = island
    ? { x: island.center.x, y: island.center.y, z: island.center.z }
    : meshLocalTopCenter(stripe, session.THREE)
  if (!local) return null
  var w = fromMeshLocal(stripe, session.THREE, local)
  var fx = w.x - body.x
  var fz = w.z - body.z
  if (!(Math.hypot(fx, fz) > 1e-5)) return null
  return { x: fx, z: fz }
}

function bindXingwenHalo(session, fig) {
  if (!session) return null
  session.xwHaloBind = null
  if (!fig || !fig.object || !session.THREE) return null
  var THREE = session.THREE
  var box = ipFigureWorldBox(fig, THREE)
  var helmet = pickXingwenHelmetMesh(session, fig)
  var stripe = pickXingwenStripeMesh(session, fig)
  var mesh = stripe || helmet || fig.object
  var local = null
  var from = 'helmet'
  if (stripe) {
    var island = yellowIslandLocal(stripe)
    local = island
      ? new THREE.Vector3(island.x, island.y, island.z)
      : meshLocalTopCenter(stripe, THREE)
    if (local && island) {
      var snapped = ipChat3d.snapLocalToStripeMid(local, island)
      local.set(snapped.x, snapped.y, snapped.z)
    }
    mesh = stripe
    from = 'stripe'
  } else if (helmet && helmet.isMesh) {
    var paint = yellowIslandLocal(helmet)
    if (paint && paint.size && paint.size.y > Math.max(paint.size.x, paint.size.z) * 0.85) {
      local = new THREE.Vector3(paint.x, paint.y, paint.z)
      var paintSnap = ipChat3d.snapLocalToStripeMid(local, paint)
      local.set(paintSnap.x, paintSnap.y, paintSnap.z)
      mesh = helmet
      from = 'stripe'
    } else if (!meshIsFullBody(helmet, box, THREE)) {
      local = meshLocalTopCenter(helmet, THREE)
    }
  }
  if (!local) {
    var crown = measureXingwenCrownBox(session, fig)
    var apex = crown
      ? {
          x: (crown.minX + crown.maxX) * 0.5,
          y: crown.maxY,
          z: (crown.minZ + crown.maxZ) * 0.5
        }
      : null
    if (!apex) return null
    local = toMeshLocal(mesh, THREE, apex)
    from = 'apex'
  }
  session.xwHaloBind = { mesh: mesh, x: local.x, y: local.y, z: local.z, from: from }
  return session.xwHaloBind
}

function resolveXingwenHaloWorld(session) {
  var b = session && session.xwHaloBind
  if (!b || !b.mesh || !session.THREE) return null
  var p = fromMeshLocal(b.mesh, session.THREE, b)
  return { x: p.x, y: p.y, z: p.z, from: b.from || 'helmet' }
}

function collectXingwenLampParts(session) {
  var mats = []
  var hits = []
  var crown = []
  var fig = findIpFigure(session, 'astro')
  if (!fig || !fig.object || typeof fig.object.traverse !== 'function' || !session.THREE) {
    return { mats: mats, hits: hits, crown: crown, body: null, helmet: null, stripe: null }
  }
  var box = ipFigureWorldBox(fig, session.THREE)
  var body = box
    ? {
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
        minZ: box.min.z,
        maxZ: box.max.z
      }
    : null
  var topY = box ? box.max.y : 0
  var spanY = box ? Math.max(box.max.y - box.min.y, 0.001) : 1
  var headItems = []
  fig.object.traverse(function (child) {
    if (!child.isMesh || !child.material) return
    if (isIpRefObject(child)) return
    var mb = meshWorldBox(child, session.THREE)
    if (!mb || mb.isEmpty()) return
    var cy = (mb.min.y + mb.max.y) * 0.5
    var dx = mb.max.x - mb.min.x
    var dy = mb.max.y - mb.min.y
    var dz = mb.max.z - mb.min.z
    var area = Math.max(dx, 0) * Math.max(dz, 0)
    if (box && topY - cy <= spanY * 0.16) {
      crown.push({
        x: (mb.min.x + mb.max.x) * 0.5,
        y: (mb.min.y + mb.max.y) * 0.5,
        z: (mb.min.z + mb.max.z) * 0.5
      })
    }
    if (box && topY - cy > spanY * 0.26) return
    var list = Array.isArray(child.material) ? child.material : [child.material]
    var lamp = false
    for (var i = 0; i < list.length; i++) {
      var m = list[i]
      if (!m) continue
      if (meshLooksLikeHeadLamp(child, m)) {
        lamp = true
        if (mats.indexOf(m) < 0) mats.push(m)
      }
    }
    if (lamp) {
      hits.push({
        x: (mb.min.x + mb.max.x) * 0.5,
        y: mb.max.y,
        z: (mb.min.z + mb.max.z) * 0.5
      })
    }
    headItems.push({ mb: mb, lamp: lamp, area: area, dx: dx, dy: dy, dz: dz })
  })
  var helmet = measureXingwenCrownBox(session, fig)
  if (!helmet) {
    var bestArea = 0
    for (var h = 0; h < headItems.length; h++) {
      var it = headItems[h]
      var thin = Math.min(it.dx, it.dz)
      var wide = Math.max(it.dx, it.dz)
      if (it.lamp && wide > 0.0001 && thin <= wide * 0.5) continue
      if (it.area > bestArea) {
        bestArea = it.area
        helmet = threeBoxToPlain(it.mb)
      }
    }
  }
  var stripe = null
  var bestScore = 0
  if (helmet) {
    for (var s = 0; s < headItems.length; s++) {
      var st = headItems[s]
      if (!st.lamp) continue
      var plain = threeBoxToPlain(st.mb)
      if (!plainBoxOverlaps(helmet, plain, 2.4)) continue
      var thinS = Math.min(st.dx, st.dz)
      var wideS = Math.max(st.dx, st.dz)
      if (!(wideS > 0) || thinS > wideS * 0.62) continue
      var score = st.dy / Math.max(thinS, 0.001)
      if (score > bestScore) {
        bestScore = score
        stripe = plain
      }
    }
  }
  return { mats: mats, hits: hits, crown: crown, body: body, helmet: helmet, stripe: stripe }
}

function measureXingwenLampAnchor(session) {
  var fig = findIpFigure(session, 'astro')
  if (!session.xwHaloBind || !session.xwHaloBind.mesh) bindXingwenHalo(session, fig)
  var world = resolveXingwenHaloWorld(session)
  if (world) return world
  var parts = collectXingwenLampParts(session)
  return ipChat3d.pickCrownAnchor(parts.body, parts.hits, parts.helmet)
}

function xingwenLightReach(session, pos) {
  if (!session || !session.THREE || !pos) return 4
  var hull = getIpCollisionBox(session.modelRoot, session.THREE)
  if (!hull || hull.isEmpty()) hull = session.modelRoot ? getExhibitFrameBox(session.modelRoot, session.THREE) : null
  if (!hull || hull.isEmpty()) return 6
  var nx = Math.max(hull.min.x, Math.min(hull.max.x, pos.x))
  var ny = Math.max(hull.min.y, Math.min(hull.max.y, pos.y))
  var nz = Math.max(hull.min.z, Math.min(hull.max.z, pos.z))
  var dx = pos.x - nx
  var dy = pos.y - ny
  var dz = pos.z - nz
  var near = Math.sqrt(dx * dx + dy * dy + dz * dz)
  var span = Math.max(hull.max.x - hull.min.x, hull.max.z - hull.min.z, (hull.max.y - hull.min.y) * 0.28, 1)
  return Math.max(near + span * 0.7, 3.5)
}

function makeHaloGlowTexture(THREE) {
  var size = 128
  var canvas = makeDrawCanvas(size, size)
  if (!canvas || typeof canvas.getContext !== 'function') return null
  var ctx = canvas.getContext('2d')
  if (!ctx || typeof ctx.createRadialGradient !== 'function') return null
  var g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,247,180,1)')
  g.addColorStop(0.2, 'rgba(250,204,21,0.88)')
  g.addColorStop(0.52, 'rgba(250,204,21,0.32)')
  g.addColorStop(1, 'rgba(250,204,21,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  var tex = makeCanvasTexture(THREE, canvas)
  if (tex) {
    tex.needsUpdate = true
    if (tex.minFilter != null && THREE && THREE.LinearFilter) tex.minFilter = THREE.LinearFilter
  }
  return tex
}

function makeHaloMat(THREE, opts) {
  var src = opts || {}
  var mat = new THREE.MeshBasicMaterial({
    color: src.color != null ? src.color : 0xfacc15,
    transparent: true,
    opacity: src.opacity != null ? src.opacity : 0.9,
    depthWrite: false,
    depthTest: src.depthTest !== false,
    blending: THREE.AdditiveBlending || 2,
    side: THREE.DoubleSide || 2,
    map: src.map || null
  })
  if (src.map) mat.toneMapped = false
  return mat
}

function clearXingwenHalo(session) {
  if (!session) return
  restoreXingwenGlowMats(session)
  detachNamed(session, 'xwHalo')
  session.xwHaloMat = null
  session.xwHaloCoreMat = null
  session.xwHaloBloomMat = null
  session.xwHaloLight = null
  session.xwHaloDisc = null
  session.xwHaloCore = null
  session.xwHaloBloom = null
  session.xwHaloMats = null
  session.xwHaloBind = null
  session.xwTalking = false
}

function restoreXingwenGlowMats(session) {
  var mats = session && session.xwHaloMats
  if (!mats) return
  for (var i = 0; i < mats.length; i++) {
    var m = mats[i]
    if (!m) continue
    if (m._xwEmi != null && m.emissive && typeof m.emissive.setHex === 'function') {
      m.emissive.setHex(m._xwEmi)
    }
    if (m._xwEmiInt != null && m.emissiveIntensity != null) m.emissiveIntensity = m._xwEmiInt
    if (m._xwBaseOp != null) m.opacity = m._xwBaseOp
    m.needsUpdate = true
  }
}

function layoutXingwenHalo(session) {
  if (!session || !session.xwHalo || !session.THREE) return false
  var fig = findIpFigure(session, 'astro')
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return false
  var h = Math.max(box.max.y - box.min.y, 0.2)
  bindXingwenHalo(session, fig)
  var anchor = measureXingwenLampAnchor(session)
  var body = xingwenBodyCenterWorld(session, fig)
  var front = xingwenStripeFrontXZ(session, fig, body)
  if (body && front) {
    var locked = ipChat3d.snapToMeridian(anchor, body, front)
    anchor.x = locked.x
    anchor.z = locked.z
  }
  session.xwHalo.scale.set(1, 1, 1)
  var bead = Math.max(h * 0.014, 0.009)
  session.xwHalo.position.set(anchor.x, anchor.y + bead * 0.2, anchor.z)
  if (session.xwHaloCore) session.xwHaloCore.scale.setScalar(bead)
  if (session.xwHaloBloom) session.xwHaloBloom.scale.setScalar(bead * 2.2)
  if (session.xwHaloDisc) session.xwHaloDisc.scale.setScalar(bead * 4.2)
  var light = session.xwHaloLight
  if (light) {
    light.distance = xingwenLightReach(session, anchor) * 1.35
    light.decay = 1
  }
  return true
}

function ensureXingwenHalo(session) {
  if (!session || !session.scene || !session.THREE) return false
  var fig = findIpFigure(session, 'astro')
  if (!fig) {
    clearXingwenHalo(session)
    return false
  }
  var THREE = session.THREE
  if (session.xwHalo) {
    session.xwHaloMats = collectXingwenGlowMats(session)
    layoutXingwenHalo(session)
    updateXingwenHalo(session, Date.now())
    return true
  }
  var coreGeo = makeSphereGeo(THREE, 1, 12) || makeBoxGeo(THREE, 1.6, 0.7, 1.6)
  var bloomGeo = makeSphereGeo(THREE, 1, 14) || makeBoxGeo(THREE, 2.2, 1.4, 2.2)
  var planeGeo = makePlaneGeo(THREE, 2, 2)
  if (!coreGeo) return false
  var root = new THREE.Group()
  markIpProp(root, 'r3d-ip-xw-halo')
  var coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff7c2,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  })
  var core = new THREE.Mesh(coreGeo, coreMat)
  markIpProp(core, 'r3d-ip-xw-lamp')
  root.add(core)
  var bloomMat = makeHaloMat(THREE, { color: 0xfacc15, opacity: 0.28, depthTest: false })
  var bloom = null
  if (bloomGeo) {
    bloom = new THREE.Mesh(bloomGeo, bloomMat)
    markIpProp(bloom, 'r3d-ip-xw-bloom')
    root.add(bloom)
  }
  var glowTex = makeHaloGlowTexture(THREE)
  var haloMat = makeHaloMat(THREE, {
    color: 0xffffff,
    opacity: 0.4,
    depthTest: false,
    map: glowTex
  })
  var disc = null
  if (planeGeo) {
    disc = new THREE.Mesh(planeGeo, haloMat)
    markIpProp(disc, 'r3d-ip-xw-glow')
    disc.renderOrder = 12
    root.add(disc)
  }
  var light = null
  if (typeof THREE.PointLight === 'function') {
    light = new THREE.PointLight(0xffe082, 6, 8, 1)
    markIpProp(light, 'r3d-ip-xw-light')
    root.add(light)
  }
  root.renderOrder = 10
  session.scene.add(root)
  session.xwHalo = root
  session.xwHaloMat = haloMat
  session.xwHaloCoreMat = coreMat
  session.xwHaloBloomMat = bloomMat
  session.xwHaloLight = light
  session.xwHaloCore = core
  session.xwHaloBloom = bloom
  session.xwHaloDisc = disc
  session.xwHaloMats = collectXingwenGlowMats(session)
  layoutXingwenHalo(session)
  updateXingwenHalo(session, Date.now())
  return true
}

function setXingwenHaloTalking(session) {
  if (!session) return
  session.xwTalking = false
  ensureXingwenHalo(session)
}

function updateXingwenHalo(session, now) {
  if (!session) return
  if (session.xwHalo) layoutXingwenHalo(session)
  var pulse = ipChat3d.haloPulse(now)
  var core = session.xwHaloCoreMat
  if (core) {
    core.transparent = true
    core.opacity = 0.28 + pulse * 0.72
    if (core.color && typeof core.color.setHex === 'function') {
      core.color.setHex(pulse > 0.4 ? 0xfff7c2 : 0xfacc15)
    }
    core.needsUpdate = true
  }
  var bloom = session.xwHaloBloomMat
  if (bloom) {
    bloom.transparent = true
    bloom.opacity = 0.06 + pulse * 0.42
    bloom.needsUpdate = true
  }
  var halo = session.xwHaloMat
  if (halo) {
    halo.transparent = true
    halo.opacity = 0.1 + pulse * 0.7
    halo.needsUpdate = true
  }
  var light = session.xwHaloLight
  var reach = light && isFinite(light.distance) ? light.distance : 6
  if (light) {
    light.color && light.color.setHex && light.color.setHex(0xffe082)
    light.decay = 1
    light.intensity = (0.35 + pulse * 2.4) * Math.max(reach, 3)
    if (!(light.distance > 0)) light.distance = reach
  }
  var disc = session.xwHaloDisc
  var cam = session.camera
  if (disc && cam && typeof disc.lookAt === 'function') {
    disc.lookAt(cam.position)
  }
  var mats = session.xwHaloMats
  if (!mats || !mats.length) return
  for (var i = 0; i < mats.length; i++) {
    var m = mats[i]
    if (!m) continue
    if (m._xwBaseOp == null && m.opacity != null) m._xwBaseOp = m.opacity
    if (m.emissive && typeof m.emissive.getHex === 'function' && m._xwEmi == null) {
      m._xwEmi = m.emissive.getHex()
    }
    if (m.emissiveIntensity != null && m._xwEmiInt == null) m._xwEmiInt = m.emissiveIntensity
    if (m.emissive && typeof m.emissive.setHex === 'function') m.emissive.setHex(0xfacc15)
    if (m.emissiveIntensity != null) m.emissiveIntensity = (m._xwEmiInt || 0.2) + pulse * 1.8
    if (m.opacity != null) {
      m.transparent = true
      m.opacity = Math.max(m._xwBaseOp || 0.7, 0.55 + pulse * 0.45)
    }
    m.needsUpdate = true
  }
}

function layoutIpChatPanel(session) {
  if (!session || !session.xwPanel || !session.THREE) return false
  var fig = findIpFigure(session, 'astro')
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return false
  var h = Math.max(box.max.y - box.min.y, 0.2)
  var spec = ipChat3d.headLockWorldSize('astro', h)
  var core = ipFigureCoreWorld(fig, session.THREE)
  var cx = core ? core.x : (box.min.x + box.max.x) * 0.5
  var cz = core ? core.z : (box.min.z + box.max.z) * 0.5
  var topY = core ? Math.min(box.max.y, core.y + Math.max(core.bodyW || 0, h * 0.4) * 0.72) : box.max.y
  session.xwPanel.scale.set(spec.w, spec.h, Math.max(h * 0.02, 0.01))
  session.xwPanel.position.set(cx, topY + spec.lift + spec.h * 0.5, cz)
  return true
}

function faceIpChatPanel(session) {
  var root = session && session.xwPanel
  var cam = session && session.camera
  if (!root || !cam || !cam.position) return
  var dx = cam.position.x - root.position.x
  var dz = cam.position.z - root.position.z
  if (dx * dx + dz * dz < 1e-8) return
  root.rotation.y = Math.atan2(dx, dz)
}

function attachIpChatPanel(session) {
  if (!session || !session.scene || !session.THREE) return false
  if (session.xwPanel) {
    layoutIpChatPanel(session)
    return true
  }
  var THREE = session.THREE
  var bodyGeo = makeBoxGeo(THREE, 0.56, 1, 0.02)
  var faceGeo = makePlaneGeo(THREE, 0.52, 0.96)
  if (!bodyGeo || !faceGeo) return false
  var root = new THREE.Group()
  markIpProp(root, 'r3d-ip-xw-panel')
  var body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  )
  markIpProp(body, 'r3d-ip-xw-body')
  body.visible = false
  var face = new THREE.Mesh(
    faceGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  )
  markIpProp(face, 'r3d-ip-xw-face')
  face.visible = false
  face.position.z = 0.011
  root.add(body)
  root.add(face)
  root.renderOrder = 8
  session.scene.add(root)
  session.xwPanel = root
  session.xwFaceMat = face.material
  layoutIpChatPanel(session)
  faceIpChatPanel(session)
  return true
}

function updateIpChatPanelTexture(session, state) {
  if (!session || !session.xwCanvas || typeof session.xwCanvas.getContext !== 'function') return false
  var ctx = session.xwCanvas.getContext('2d')
  if (!ctx) return false
  ipChat3d.paintChatCanvas(ctx, XW_TEX_W, XW_TEX_H, state || {})
  if (session.xwTex) session.xwTex.needsUpdate = true
  return true
}

function pickIpChatPanelAt(session, cssX, cssY) {
  if (!session || !session.THREE) return false
  var page = measureHeadLockLayout(session, 'astro')
  if (!page || !page.visible) return false
  return ipIntro.hitTestPoint(cssX, cssY, {
    left: page.x,
    top: page.y,
    right: page.x + page.w,
    bottom: page.y + page.h
  })
}

function emitXwScreenRect(session) {
  if (!session || typeof session.onXwScreen !== 'function') return
  if (!session.xwPanel || !session.THREE) {
    if (session._xwScreenOn) {
      session._xwScreenOn = false
      session.onXwScreen({ visible: false, x: 0, y: 0, w: 0, h: 0, scale: 1, fs: 13 })
    }
    return
  }
  var next = measureHeadLockLayout(session, 'astro')
  if (!next.visible) {
    if (session._xwScreenOn) {
      session._xwScreenOn = false
      session.onXwScreen(next)
    }
    return
  }
  var prev = session._xwScreenLayout
  if (
    prev &&
    !!prev.visible === !!next.visible &&
    Math.abs(prev.x - next.x) < 2 &&
    Math.abs(prev.y - next.y) < 2 &&
    Math.abs(prev.w - next.w) < 2 &&
    Math.abs(prev.h - next.h) < 2
  ) {
    return
  }
  session._xwScreenLayout = next
  session._xwScreenOn = !!next.visible
  session.onXwScreen(next)
}

function layoutMuskIntroPanel(session) {
  if (!session || !session.muskPanel || !session.THREE) return false
  var fig = findIpFigure(session, 'musk')
  var box = ipFigureWorldBox(fig, session.THREE)
  if (!box) return false
  var size = box.getSize(new session.THREE.Vector3())
  var h = Math.max(size.y, 0.2)
  var s = Math.max(h * 0.42, 0.22)
  session.muskPanel.scale.set(s, s, s)
  session.muskPanel.position.set(
    (box.min.x + box.max.x) * 0.5,
    box.max.y + s * 0.28,
    (box.min.z + box.max.z) * 0.5
  )
  var yaw = fig.object && fig.object.rotation ? fig.object.rotation.y : 0
  session.muskPanel.rotation.y = yaw
  return true
}

function attachMuskIntroPanel(session) {
  if (!session || !session.scene || !session.THREE) return false
  if (session.muskPanel) {
    layoutMuskIntroPanel(session)
    return true
  }
  var THREE = session.THREE
  var bodyGeo = makeBoxGeo(THREE, 1, 0.46, 0.03)
  if (!bodyGeo) return false
  var root = new THREE.Group()
  markIpProp(root, 'r3d-ip-musk-panel')
  var body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshBasicMaterial({
      color: 0x12151c,
      transparent: true,
      opacity: 0.06,
      depthWrite: false
    })
  )
  markIpProp(body, 'r3d-ip-musk-body')
  root.add(body)
  root.renderOrder = 8
  session.scene.add(root)
  session.muskPanel = root
  layoutMuskIntroPanel(session)
  return true
}

function clearMuskIntroPanel(session) {
  if (!session) return
  detachNamed(session, 'muskPanel')
}

function clearIpChatPanel(session) {
  if (!session) return
  detachNamed(session, 'xwPanel')
  session.xwFaceMat = null
  session.xwCanvas = null
  session.xwTex = null
  session._xwScreenLayout = null
  if (session._xwScreenOn && typeof session.onXwScreen === 'function') {
    session._xwScreenOn = false
    session.onXwScreen({ visible: false, x: 0, y: 0, w: 0, h: 0 })
  }
}

function isStandFlipped(session) {
  var stand = findStandGroup(session && session.modelRoot)
  return !!(stand && stand._r3dStand && stand._r3dStand.flipped)
}

function isStandYawFlipped(session) {
  var stand = findStandGroup(session && session.modelRoot)
  return !!(stand && stand._r3dStand && stand._r3dStand.flippedLeft)
}

function getStandFlipFlags(session) {
  return {
    up: isStandFlipped(session),
    left: isStandYawFlipped(session)
  }
}

function setEulerY(obj, y) {
  if (!obj || !obj.rotation) return
  if (typeof obj.rotation.set === 'function') {
    obj.rotation.set(obj.rotation.x || 0, y, obj.rotation.z || 0)
    return
  }
  obj.rotation.y = y
}

function applyManualStandFlip(session, flipped) {
  if (!session || !session.modelRoot) return false
  var stand = findStandGroup(session.modelRoot)
  if (!stand || !stand._r3dStand || !stand.rotation || !stand.rotation.set) {
    return isStandFlipped(session)
  }
  var meta = stand._r3dStand
  var next = { x: meta.base.x, y: meta.base.y, z: meta.base.z }
  if (flipped) {
    if (meta.axis === 'z') next.z += Math.PI
    else next.x += Math.PI
  }
  stand.rotation.set(next.x, next.y, next.z)
  if (stand.updateMatrixWorld) stand.updateMatrixWorld(true)
  meta.flipped = !!flipped
  relayoutAfterStandChange(session)
  return !!flipped
}

function applyManualStandYaw(session, flipped) {
  if (!session || !session.modelRoot) return false
  var stand = findStandGroup(session.modelRoot)
  var yaw = findYawGroup(session.modelRoot)
  if (!stand || !stand._r3dStand || !yaw) return isStandYawFlipped(session)
  setEulerY(yaw, flipped ? Math.PI : 0)
  if (yaw.updateMatrixWorld) yaw.updateMatrixWorld(true)
  stand._r3dStand.flippedLeft = !!flipped
  relayoutAfterStandChange(session)
  return !!flipped
}

function toggleManualStandFlip(session) {
  return applyManualStandFlip(session, !isStandFlipped(session))
}

function toggleManualStandYaw(session) {
  return applyManualStandYaw(session, !isStandYawFlipped(session))
}

function relayoutAfterStandChange(session) {
  if (!session || !session.modelRoot || !session.THREE) return
  var box = getExhibitFrameBox(session.modelRoot, session.THREE)
  layoutLights(session, box)
  layoutExhibitStage(session, session.modelRoot)
  if (session.camera && session.controls) {
    applyBoxToCamera(session.camera, session.controls, box, session.THREE, 2.15)
    applyBoxClip(session.camera, box, session.THREE)
  }
}

function eachMaterial(object, fn) {
  if (!object || !object.traverse) return
  object.traverse(function (child) {
    if (!child.isMesh) return
    child.frustumCulled = false
    var mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []
    for (var i = 0; i < mats.length; i++) {
      if (mats[i]) fn(mats[i], child)
    }
  })
}

var TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']

function isWxIOS() {
  try {
    if (typeof wx === 'undefined') return false
    var info = (wx.getDeviceInfo && wx.getDeviceInfo()) || (wx.getSystemInfoSync && wx.getSystemInfoSync()) || {}
    var blob = [info.platform, info.system, info.model].join(' ')
    return /ios|iphone|ipad/i.test(blob)
  } catch (e) {
    return false
  }
}

function textureReady(tex) {
  if (!tex) return true
  var img = tex.image
  if (!img) return false
  if (img.complete === false) return false
  var w = img.width || img.naturalWidth || 0
  var h = img.height || img.naturalHeight || 0
  return w >= 8 && h >= 8
}

function colorSum(color) {
  if (!color) return 1
  return (Number(color.r) || 0) + (Number(color.g) || 0) + (Number(color.b) || 0)
}

function isTextureOnlyAlbedo(m) {
  return !!(
    m &&
    m.map &&
    !m.normalMap &&
    !m.roughnessMap &&
    !m.metalnessMap &&
    !m.aoMap &&
    !m.emissiveMap
  )
}

function collectShadingProfile(object) {
  var profile = { meshes: 0, paintedDark: 0, textureOnly: 0, pbr: 0 }
  if (!object || !object.traverse) return profile
  object.traverse(function (child) {
    if (!child.isMesh || !child.material) return
    profile.meshes++
    var mats = Array.isArray(child.material) ? child.material : [child.material]
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i]
      if (!m) continue
      if (m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap) profile.pbr++
      else if (m.map) profile.textureOnly++
      else if (m.color && colorSum(m.color) < 0.35) profile.paintedDark++
    }
  })
  return profile
}

/**
 * 猎鹰重型这类：一两块网格、只靠一张贴图上色、没有喷漆深色。
 * 猎鹰 9 有大量故意涂黑的材质，不能走这套纠偏。
 */
function isFragileTextureOnlyModel(object) {
  var p = collectShadingProfile(object)
  return p.meshes > 0 && p.meshes <= 2 && p.textureOnly >= 1 && p.paintedDark === 0 && p.pbr === 0
}

function hasVertexColor(child) {
  return !!(child && child.geometry && child.geometry.attributes && child.geometry.attributes.color)
}

function dropBrokenMaps(object) {
  eachMaterial(object, function (m) {
    for (var i = 0; i < TEXTURE_SLOTS.length; i++) {
      var key = TEXTURE_SLOTS[i]
      if (m[key] && !textureReady(m[key])) {
        m[key] = null
        m.needsUpdate = true
      }
    }
  })
  return object
}

/**
 * 展陈上色自动纠偏：只改运行时材质，不写回 GLB、不认 slug。
 * 覆盖纯贴图乘黑底、高金属无环境贴图、坏贴图、无任何颜色来源。
 * 有完整 PBR（法线/粗糙度贴图）且底色正常的模型不改外观。
 */
function autoFixExhibitShading(m, child, THREE) {
  if (!m) return m
  if (THREE && THREE.DoubleSide != null) m.side = THREE.DoubleSide
  if (m.transparent && (m.opacity == null || m.opacity >= 0.98) && !m.alphaMap) {
    m.transparent = false
    m.opacity = 1
  }
  var albedoOk = !!(m.map && textureReady(m.map))
  var texturedOnly = isTextureOnlyAlbedo(m)
  var vertexColor = hasVertexColor(child)
  var dark = !!(m.color && colorSum(m.color) < 0.35)
  var mirrorBlack =
    typeof m.metalness === 'number' && m.metalness > 0.72 && !m.envMap && !m.metalnessMap

  if ((texturedOnly || (albedoOk && dark) || vertexColor) && dark && m.color && m.color.setRGB) {
    m.color.setRGB(1, 1, 1)
  }
  if (texturedOnly) {
    if (typeof m.metalness === 'number') m.metalness = 0
  } else if (mirrorBlack && (dark || (!albedoOk && !m.roughnessMap && !m.normalMap))) {
    m.metalness = Math.min(m.metalness, 0.2)
    if (typeof m.roughness === 'number') m.roughness = Math.max(Number(m.roughness) || 0, 0.55)
  }
  if (!albedoOk && !vertexColor && m.color && m.color.setRGB && colorSum(m.color) < 0.35) {
    m.color.setRGB(0.78, 0.8, 0.84)
    if (typeof m.metalness === 'number') m.metalness = Math.min(Number(m.metalness) || 0, 0.12)
  }
  m.needsUpdate = true
  return m
}

/** WebGL1 无 OES_element_index_uint 时，32 位索引整网格不画，尺寸线仍在。 */
function downgradeUint32Index(object, THREE) {
  if (!object || !object.traverse) return object
  object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    var geo = child.geometry
    var index = geo.index
    if (!index || !index.array || index.array.BYTES_PER_ELEMENT <= 2) return
    var pos = geo.attributes && geo.attributes.position
    var vcount = pos ? pos.count : 0
    if (vcount <= 0 || vcount > 65535) return
    var src = index.array
    var dst = new Uint16Array(src.length)
    for (var i = 0; i < src.length; i++) dst[i] = src[i]
    if (typeof geo.setIndex === 'function') {
      geo.setIndex(THREE && THREE.BufferAttribute ? new THREE.BufferAttribute(dst, 1) : dst)
    } else {
      index.array = dst
      index.needsUpdate = true
    }
  })
  return object
}

/**
 * 展陈可见性：只改运行时网格/材质，不写回 GLB。
 * 纯贴图 PBR 在 iOS WebGL 上着色器过重会整网格不画；Lambert 与官方示例一致。
 */
function useLambertIfTextureOnly(object, THREE) {
  if (!object || !THREE || !THREE.MeshLambertMaterial) return object
  object.traverse(function (child) {
    if (!child.isMesh || !child.material) return
    var list = Array.isArray(child.material) ? child.material : [child.material]
    var changed = false
    var next = []
    for (var i = 0; i < list.length; i++) {
      var m = list[i]
      if (!m || !isTextureOnlyAlbedo(m)) {
        next.push(m)
        continue
      }
      var map = m.map && textureReady(m.map) ? m.map : null
      next.push(
        new THREE.MeshLambertMaterial({
          map: map,
          color: 0xffffff,
          side: THREE.DoubleSide != null ? THREE.DoubleSide : m.side
        })
      )
      changed = true
    }
    if (changed) child.material = Array.isArray(child.material) ? next : next[0]
  })
  return object
}

function exhibitObjectSize(object, THREE) {
  if (!object || !THREE || !THREE.Box3 || !THREE.Vector3) return null
  try {
    var box = new THREE.Box3()
    if (typeof box.setFromObject === 'function') box.setFromObject(object)
    if (!box || box.isEmpty()) return null
    return box.getSize(new THREE.Vector3())
  } catch (e) {
    return null
  }
}

function meshTallRatio(size) {
  if (!size) return 0
  var height = size.y >= size.z ? size.y : size.z
  var width = size.y >= size.z ? Math.max(size.x, size.z, 0.0001) : Math.max(size.x, size.y, 0.0001)
  return height / width
}

function countMeshes(object) {
  var n = 0
  if (!object || !object.traverse) return 0
  object.traverse(function (child) {
    if (child && child.isMesh) n++
  })
  return n
}

function slenderLineupSpread(object, THREE) {
  var xs = []
  var heights = []
  if (!object || !object.traverse || !THREE || !THREE.Vector3) {
    return { slender: 0, span: 0, maxHeight: 0 }
  }
  object.traverse(function (child) {
    if (!child || !child.isMesh || !child.geometry) return
    if (child.visible === false) return
    try {
      var box = meshWorldBox(child, THREE)
      if (!box || box.isEmpty()) return
      var size = box.getSize(new THREE.Vector3())
      if (meshRocketScore(size) <= 0) return
      if (meshTallRatio(size) < 1.35) return
      xs.push((box.min.x + box.max.x) / 2)
      heights.push(size.y >= size.z ? size.y : size.z)
    } catch (e) {}
  })
  if (!xs.length) return { slender: 0, span: 0, maxHeight: 0 }
  xs.sort(function (a, b) {
    return a - b
  })
  var maxH = 0
  for (var i = 0; i < heights.length; i++) if (heights[i] > maxH) maxH = heights[i]
  return { slender: xs.length, span: xs[xs.length - 1] - xs[0], maxHeight: maxH }
}

/**
 * 仅横排多箭展陈（长征全系列）在 iOS 上收 Basic。
 * 其它型号保持 git 仓库写法：不改 PBR。
 */
function isIosSeriesBoard(object, THREE, opts) {
  if (!isWxIOS() || !object || !THREE) return false
  if (opts && opts.series) return true
  if (countMeshes(object) >= 400) return true
  var spread = slenderLineupSpread(object, THREE)
  return spread.slender >= 6 && spread.span >= spread.maxHeight * 1.4
}

function cloneMatColor(src, THREE) {
  if (src && typeof src.clone === 'function') return src.clone()
  if (src && typeof src.r === 'number' && THREE && THREE.Color) {
    return new THREE.Color(src.r, src.g, src.b)
  }
  return src || 0xffffff
}

function basicFromStandard(m, THREE) {
  var map = m.map && textureReady(m.map) ? m.map : null
  var transparent = false
  if (typeof m.opacity === 'number' && m.opacity < 0.98) transparent = true
  else if (map && m.transparent && !(m.alphaTest > 0)) transparent = true
  var color = 0xffffff
  if (!map && m.color && colorSum(m.color) >= 0.9) color = cloneMatColor(m.color, THREE)
  else if (!map) color = THREE.Color ? new THREE.Color(0.78, 0.8, 0.84) : 0xc8ccd6
  var basic = new THREE.MeshBasicMaterial({
    map: map,
    color: color,
    side: THREE.DoubleSide != null ? THREE.DoubleSide : m.side,
    transparent: transparent,
    opacity: m.opacity == null ? 1 : m.opacity,
    vertexColors: false,
    depthWrite: !transparent,
    fog: false
  })
  if (map && typeof m.alphaTest === 'number' && m.alphaTest > 0) basic.alphaTest = m.alphaTest
  return basic
}

/**
 * 只处理 iOS 横排全系列：PBR 编不过会只剩国旗字标。
 * 猎鹰 9 / 星舰等细长箭保持原材质。
 */
function simplifyIosBoardMaterials(object, THREE) {
  if (!isWxIOS() || !object || !THREE || !THREE.MeshBasicMaterial) return object
  object.traverse(function (child) {
    if (!child.isMesh || !child.material) return
    var list = Array.isArray(child.material) ? child.material : [child.material]
    var next = []
    for (var i = 0; i < list.length; i++) {
      var m = list[i]
      if (!m) {
        next.push(m)
        continue
      }
      var type = String(m.type || '')
      if (m.isMeshBasicMaterial || type === 'MeshBasicMaterial') {
        next.push(m)
        continue
      }
      next.push(basicFromStandard(m, THREE))
    }
    child.material = Array.isArray(child.material) ? next : next[0]
  })
  return object
}

function ensureDrawableModel(object, THREE, opts) {
  if (!object) return object
  downgradeUint32Index(object, THREE)
  var iosBoard = isIosSeriesBoard(object, THREE, opts)
  if (iosBoard) {
    if (object.traverse) {
      object.traverse(function (child) {
        if (child && child.isMesh) child.frustumCulled = false
      })
    }
    dropBrokenMaps(object)
    eachMaterial(object, function (m, child) {
      autoFixExhibitShading(m, child, THREE)
    })
    simplifyIosBoardMaterials(object, THREE)
    return object
  }
  if (!isFragileTextureOnlyModel(object)) return object
  dropBrokenMaps(object)
  eachMaterial(object, function (m, child) {
    autoFixExhibitShading(m, child, THREE)
  })
  useLambertIfTextureOnly(object, THREE)
  return object
}

/** 只改采样参数，方便小程序吃进内嵌贴图；不改颜色/金属度。 */
function adaptViewerTextures(object, THREE) {
  eachMaterial(object, function (m) {
    var maps = [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap]
    for (var i = 0; i < maps.length; i++) {
      var tex = maps[i]
      if (!tex) continue
      tex.generateMipmaps = false
      if (THREE && THREE.LinearFilter) {
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
      }
      if (THREE && THREE.ClampToEdgeWrapping) {
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
      }
      if (
        tex === m.map &&
        !isWxIOS() &&
        THREE &&
        THREE.SRGBColorSpace &&
        tex.colorSpace !== undefined
      ) {
        tex.colorSpace = THREE.SRGBColorSpace
      }
      tex.needsUpdate = true
    }
    m.needsUpdate = true
  })
  return object
}

function dropBrokenColorMaps(object) {
  return dropBrokenMaps(object)
}

function waitForModelTextures(object, timeoutMs) {
  var limit = timeoutMs == null ? (isWxIOS() ? 4000 : 2200) : timeoutMs
  var start = Date.now()
  return new Promise(function (resolve) {
    var tick = function () {
      var pending = 0
      eachMaterial(object, function (m) {
        for (var i = 0; i < TEXTURE_SLOTS.length; i++) {
          if (m[TEXTURE_SLOTS[i]] && !textureReady(m[TEXTURE_SLOTS[i]])) pending++
        }
      })
      if (!pending || Date.now() - start >= limit) {
        dropBrokenMaps(object)
        resolve(object)
        return
      }
      setTimeout(tick, 48)
    }
    tick()
  })
}

function createSession(lib, nativeCanvas, adaptedCanvas, rect, handlers) {
  if (!lib || !lib.THREE || !nativeCanvas || !adaptedCanvas) {
    throw new Error('3D 会话参数无效')
  }
  var THREE = lib.THREE
  var box = rect || {}
  var dpr = capPixelRatio(wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2)
  var cssW = Math.max(1, Math.floor(box.width || 0))
  var cssH = Math.max(1, Math.floor(box.height || 0))

  nativeCanvas.width = Math.floor(cssW * dpr)
  nativeCanvas.height = Math.floor(cssH * dpr)

  var renderer = new THREE.WebGLRenderer({
    canvas: adaptedCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  })
  renderer.setPixelRatio(dpr)
  renderer.setSize(cssW, cssH, false)
  try {
    var gl = renderer.getContext && renderer.getContext()
    if (gl && gl.getExtension) gl.getExtension('OES_element_index_uint')
  } catch (e) {}
  var exhibit = !!(handlers && handlers.exhibit)
  renderer.setClearColor(exhibit ? CLEAR_COLOR_EXHIBIT : CLEAR_COLOR_DARK, 1)
  if (!isWxIOS() && renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }

  var scene = new THREE.Scene()
  var camera = new THREE.PerspectiveCamera(42, cssW / cssH, 0.1, 4000)
  camera.position.set(1.6, 0.8, 3.4)
  var lights = addLights(scene, THREE, exhibit)

  var controls = new lib.OrbitControls(camera, adaptedCanvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = !!exhibit
  controls.screenSpacePanning = true
  controls.panSpeed = 0.85
  controls.rotateSpeed = 0.78
  controls.zoomSpeed = 1.05
  controls.minPolarAngle = exhibit ? 0.06 : 0.18
  controls.maxPolarAngle = exhibit ? Math.PI - 0.06 : Math.PI - 0.18
  if (exhibit && THREE.TOUCH) {
    controls.touches.ONE = THREE.TOUCH.ROTATE
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
  }
  var session = {
    THREE: THREE,
    renderer: renderer,
    scene: scene,
    camera: camera,
    controls: controls,
    nativeCanvas: nativeCanvas,
    modelRoot: null,
    exhibitStage: null,
    dimGuides: null,
    exhibit: exhibit,
    series: !!(handlers && handlers.series),
    lights: lights,
    cssW: cssW,
    cssH: cssH,
    onDimLabels: handlers && handlers.onDimLabels,
    onIpIntroAnchor: handlers && handlers.onIpIntroAnchor,
    onIpTags: handlers && handlers.onIpTags,
    onXwScreen: handlers && handlers.onXwScreen,
    ipIntroSlug: '',
    orbiting: false,
    raf: 0,
    running: false,
    autoRotate: true
  }
  controls.addEventListener('start', function () {
    session.orbiting = true
    session.camTween = null
    session.autoRotate = false
    clearAutoRotateTimer(session)
    if (handlers && handlers.onUserInteract) handlers.onUserInteract()
  })
  controls.addEventListener('end', function () {
    session.orbiting = false
    scheduleAutoRotate(session)
    emitDimLabels(session)
  })
  return session
}

function setModel(session, object) {
  if (!session || !session.scene || !object) return
  session.ipRefToken = (session.ipRefToken || 0) + 1
  session.ipIntroSlug = ''
  clearIpScaleRefs(session)
  if (session.modelRoot) {
    session.scene.remove(session.modelRoot)
    disposeObject3D(session.modelRoot)
  }
  ensureDrawableModel(object, session.THREE, { series: !!session.series })
  var root = wrapStandingModel(object, session.THREE)
  session.modelRoot = root
  session.scene.add(root)
  var box = getExhibitFrameBox(root, session.THREE)
  layoutLights(session, box)
  if (session.exhibit && !session.exhibitStage) addExhibitStage(session)
  layoutExhibitStage(session, root)
  applyBoxToCamera(session.camera, session.controls, box, session.THREE, 2.15)
  applyBoxClip(session.camera, box, session.THREE)
  if (session.exhibit) applyExhibitControls(session, 'show')
}

function friendlyGlbError(err) {
  var msg = String((err && (err.message || err.errMsg)) || err || '')
  var stage = err && err._r3dStage ? String(err._r3dStage) : ''
  if (/url not in domain list/.test(msg)) return '模型下载域名未配置'
  if (/timeout/i.test(msg)) return '模型下载超时，请重试'
  if (/Request failed|downloadFile:fail|statusCode|下载失败/i.test(msg)) return '模型下载失败，请重试'
  if (/readFile|读取/.test(msg)) return '模型读取失败，请重试'
  if (/parse|解析|createObjectURL|URL is not|TextDecoder/i.test(msg)) return '模型解析失败'
  if (stage === '获取画布节点' || stage === '测量画布尺寸') return '3D 画布未就绪，请重试'
  if (stage === '创建渲染器' || stage === '适配画布') return '3D 引擎启动失败，请重试'
  if (stage === '装载模型') return '模型装载失败，请重试'
  if (/暂无 3D 模型|模型地址为空/.test(msg)) return '该型号暂无 3D 模型'
  return '三维模型加载失败，请重试'
}

function errorDetail(err) {
  var msg = String((err && (err.message || err.errMsg)) || err || '').replace(/\s+/g, ' ').trim()
  return msg.slice(0, 80)
}

function downloadGlbBuffer(url, onProgress) {
  return new Promise(function (resolve, reject) {
    if (!url) {
      reject(new Error('模型地址为空'))
      return
    }
    var task = wx.downloadFile({
      url: url,
      success: function (res) {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) {
          reject(new Error('模型下载失败 ' + ((res && res.statusCode) || '')))
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: res.tempFilePath,
          success: function (file) {
            if (!file || !file.data) {
              reject(new Error('模型读取失败'))
              return
            }
            resolve(file.data)
          },
          fail: function (err) {
            reject(err || new Error('模型读取失败'))
          }
        })
      },
      fail: function (err) {
        reject(err || new Error('模型下载失败'))
      }
    })
    if (task && typeof task.onProgressUpdate === 'function' && typeof onProgress === 'function') {
      task.onProgressUpdate(function (res) {
        var pct = Number(res && res.progress)
        if (!isFinite(pct)) return
        onProgress(Math.max(0, Math.min(90, Math.round(pct * 0.9))))
      })
    }
  })
}

function bindTextureImageFactory(THREE, nativeCanvas) {
  if (!THREE || !THREE.ImageLoader) return
  THREE.ImageLoader._r3dCreateImage = function () {
    try {
      if (nativeCanvas && typeof nativeCanvas.createImage === 'function') {
        return nativeCanvas.createImage()
      }
    } catch (e) {}
    return null
  }
}

function loadGlb(lib, url, nativeCanvas, onProgress, opts) {
  bindTextureImageFactory(lib && lib.THREE, nativeCanvas)
  return downloadGlbBuffer(url, onProgress).then(function (buffer) {
    if (typeof onProgress === 'function') onProgress(92)
    return new Promise(function (resolve, reject) {
      var loader = new lib.GLTFLoader()
      loader.parse(
        buffer,
        '',
        function (gltf) {
          var root = gltf && gltf.scene ? gltf.scene : gltf
          if (root) {
            if (!root.userData) root.userData = {}
            if (gltf && Array.isArray(gltf.animations) && gltf.animations.length) {
              root.userData.gltfAnimations = gltf.animations
            }
          }
          adaptViewerTextures(root, lib.THREE)
          waitForModelTextures(root).then(function () {
            ensureDrawableModel(root, lib.THREE, opts)
            if (typeof onProgress === 'function') onProgress(100)
            resolve(prepareModel(root))
          })
        },
        function (err) {
          reject(err || new Error('模型解析失败'))
        }
      )
    })
  })
}

function startLoop(session) {
  if (!session || session.running) return
  if (!session.nativeCanvas || !session.renderer || !session.controls || !session.camera) return
  if (typeof session.nativeCanvas.requestAnimationFrame !== 'function') return
  session.running = true
  var tick = function () {
    if (!session.running) return
    session.raf = session.nativeCanvas.requestAnimationFrame(tick)
    var now = Date.now()
    var last = session._lastTick || now
    session._lastTick = now
    var dt = Math.min(0.05, (now - last) / 1000)
    if (session.dimGrow != null && session.dimGrow < 1) {
      session.dimGrow = Math.min(1, session.dimGrow + dt / 0.78)
      updateDimensionGrow(session, session.dimGrow)
    }
    if (session.xwHalo) updateXingwenHalo(session, now)
    updateIpFigureMixers(session, dt)
    if (session.camTween && !session.orbiting) {
      var tw = session.camTween
      var t = Math.min(1, (Date.now() - tw.start) / tw.duration)
      var k = easeInOutCubic(t)
      session.camera.position.lerpVectors(tw.fromPos, tw.toPos, k)
      session.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k)
      if (t >= 1) session.camTween = null
    } else if (session.autoRotate && session.modelRoot && !session.orbiting) {
      session.modelRoot.rotation.y += 0.004
    }
    session.controls.update()
    session.renderer.render(session.scene, session.camera)
    if (session.dimMeta) emitDimLabels(session)
    emitIpNameTags(session)
    if (session.ipIntroSlug) emitIpIntroAnchor(session)
    if (session.xwPanel || session._xwScreenOn) emitXwScreenRect(session)
  }
  tick()
}

function stopLoop(session) {
  if (!session) return
  session.running = false
  var canvas = session.nativeCanvas
  var raf = session.raf
  session.raf = 0
  if (!raf || !canvas) return
  try {
    if (typeof canvas.cancelAnimationFrame === 'function') {
      canvas.cancelAnimationFrame(raf)
    }
  } catch (e) {}
}

function resizeSession(session, rect) {
  if (!session || !rect) return
  var dpr = capPixelRatio(wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2)
  var cssW = Math.max(1, Math.floor(rect.width))
  var cssH = Math.max(1, Math.floor(rect.height))
  if (cssW < 8 || cssH < 8) return
  session.nativeCanvas.width = Math.floor(cssW * dpr)
  session.nativeCanvas.height = Math.floor(cssH * dpr)
  session.renderer.setPixelRatio(dpr)
  session.renderer.setSize(cssW, cssH, false)
  session.cssW = cssW
  session.cssH = cssH
  session.camera.aspect = cssW / cssH
  session.camera.updateProjectionMatrix()
}

function safeDispose(fn) {
  try {
    fn()
  } catch (e) {}
}

function disposeSession(session) {
  if (!session) return
  session.ipRefToken = (session.ipRefToken || 0) + 1
  session.ipIntroSlug = ''
  safeDispose(function () {
    clearIpScaleRefs(session)
  })
  safeDispose(function () {
    clearAutoRotateTimer(session)
  })
  safeDispose(function () {
    stopLoop(session)
  })
  safeDispose(function () {
    if (session.controls && session.controls.dispose) session.controls.dispose()
  })
  session.controls = null
  safeDispose(function () {
    clearDimensionGuides(session)
  })
  safeDispose(function () {
    if (session.exhibitStage && session.scene) {
      session.scene.remove(session.exhibitStage)
      disposeObject3D(session.exhibitStage)
    }
  })
  session.exhibitStage = null
  safeDispose(function () {
    if (session.modelRoot && session.scene) {
      session.scene.remove(session.modelRoot)
      disposeObject3D(session.modelRoot)
    }
  })
  session.modelRoot = null
  safeDispose(function () {
    disposeObject3D(session.scene)
  })
  // 小程序卸载时 self/canvas 已空，three 内部 animation.stop 会读 cancelAnimationFrame 抛错
  safeDispose(function () {
    if (session.renderer && typeof session.renderer.setAnimationLoop === 'function') {
      session.renderer.setAnimationLoop(null)
    }
  })
  safeDispose(function () {
    if (session.renderer && session.renderer.dispose) session.renderer.dispose()
  })
  session.renderer = null
  session.nativeCanvas = null
  session.running = false
}

module.exports = {
  PIXEL_RATIO_CAP,
  applyClearColor,
  capPixelRatio,
  measureCanvasBox,
  disposeObject3D,
  getRenderableBox,
  getExhibitFrameBox,
  meshRocketScore,
  layoutLights,
  fitCameraToObject,
  createSession,
  setModel,
  setDimensionGuides,
  playExhibitView,
  applyExhibitControls,
  cancelExhibitTween,
  prepareModel,
  exhibitStandRotation,
  pickStandRotationFromSize,
  scoreStandSize,
  rotateSizeByEuler,
  rotateBoxByEuler,
  isUprightExhibitSize,
  finalizeStandRotation,
  autoStandRotation,
  isBoardSize,
  applyBoxClip,
  isNoseDown,
  measureEndWidths,
  wrapStandingModel,
  findStandGroup,
  findYawGroup,
  isStandFlipped,
  isStandYawFlipped,
  getStandFlipFlags,
  applyManualStandFlip,
  applyManualStandYaw,
  toggleManualStandFlip,
  toggleManualStandYaw,
  adaptViewerTextures,
  dropBrokenColorMaps,
  dropBrokenMaps,
  autoFixExhibitShading,
  isFragileTextureOnlyModel,
  isWxIOS,
  ensureDrawableModel,
  downgradeUint32Index,
  loadGlb,
  exhibitStageClearance,
  attachIpScaleRefs,
  placeIpScaleRefs,
  playIpFigureClips,
  getIpCollisionBox,
  faceIpFiguresToCamera,
  clearIpScaleRefs,
  pickIpRefAt,
  ipFigureHitWorldBox,
  pickIpChatPanelAt,
  playIpIntroView,
  clearIpIntroView,
  unlockIpIntroControls,
  attachIpChatPanel,
  layoutIpChatPanel,
  measureHeadLockLayout,
  updateIpChatPanelTexture,
  clearIpChatPanel,
  attachMuskIntroPanel,
  layoutMuskIntroPanel,
  clearMuskIntroPanel,
  setXingwenHaloTalking,
  updateXingwenHalo,
  ensureXingwenHalo,
  friendlyGlbError,
  errorDetail,
  startLoop,
  stopLoop,
  resizeSession,
  disposeSession
}
