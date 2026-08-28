/**
 * three.js 场景装配：WebGL 渲染、OrbitControls、远端 GLB、销毁。
 * lib 由调用方懒加载，避免未点「查看模型」就解析整包。
 */

var PIXEL_RATIO_CAP = 2

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
      child.updateWorldMatrix(true, false)
      box.applyMatrix4(child.matrixWorld)
      if (!box.isEmpty()) return box
    }
  }
  box.setFromObject(child)
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
  return layFlat(mesh, 0.012)
}

function addExhibitStage(session) {
  var THREE = session.THREE
  var group = new THREE.Group()
  var disc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({
      color: 0x10141c,
      roughness: 0.92,
      metalness: 0.08
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

function layoutExhibitStage(session, object) {
  if (!session || !session.exhibitStage || !object) return
  var THREE = session.THREE
  var box = getExhibitFrameBox(object, THREE)
  if (box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var center = box.getCenter(new THREE.Vector3())
  var radius = Math.max(size.x, size.z, size.y * 0.28) * 0.78
  var gap = Math.max(size.y * 0.02, Math.max(size.x, size.z) * 0.1, 0.03)
  session.exhibitStage.position.set(center.x, box.min.y - gap, center.z)
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
  if (!camera || !box || box.isEmpty()) return
  var size = box.getSize(new THREE.Vector3())
  var maxDim = Math.max(size.x, size.y, size.z) || 1
  camera.near = Math.max(maxDim / 500, 0.01)
  camera.far = Math.max(maxDim * 200, 800)
  camera.updateProjectionMatrix()
}

function projectToCss(session, x, y, z) {
  if (!session || !session.camera || !session.THREE) return { x: 0, y: 0, visible: false }
  var v = new session.THREE.Vector3(x, y, z)
  v.project(session.camera)
  var w = session.cssW || 1
  var h = session.cssH || 1
  return {
    x: Math.round((v.x * 0.5 + 0.5) * w),
    y: Math.round((-v.y * 0.5 + 0.5) * h),
    visible: v.z >= -1 && v.z <= 1 && v.x >= -1.15 && v.x <= 1.15 && v.y >= -1.15 && v.y <= 1.15
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
  var x = Number(size.x) || 0
  var y = Number(size.y) || 0
  var z = Number(size.z) || 0
  var max = Math.max(x, y, z)
  var min = Math.min(x, y, z)
  var mid = x + y + z - max - min
  if (max <= 0) return false
  return mid / max > 0.42 && min / max < 0.32
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

/** 展陈验收：细长箭必须 Y 向最长，展板必须立着且别侧对镜头。 */
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
  if (shape === 'board') return y >= max * 0.92 && x > min * 1.12
  if (shape === 'slender') return y >= max * 0.85
  return y >= mid * 0.9
}

function finalizeStandRotation(rawSize, chosen) {
  var rot = withStandFlip(chosen || { x: 0, y: 0, z: 0 })
  if (!rawSize) return rot
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
  var yRatio = y / max
  var face = Math.max(x, y) / max
  var score = yRatio * 10 + face * 8 + (x / max) * 5
  if (z / max > 0.8 && Math.max(x, y) / max < 0.38) score -= 20
  if (y <= min * 1.08 && mid / max > 0.4) score -= 16
  if (mid > 0 && max / mid >= 2) score += yRatio * 8
  if (isBoardSize(size)) {
    if (y >= mid * 0.95) score += 10
    if (z <= min * 1.12) score += 4
    if (x <= min * 1.12) score -= 12
  }
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

function measureEndWidths(object, THREE, box) {
  var empty = { top: 0, bot: 0 }
  if (!object || !object.traverse || !THREE || !box || box.isEmpty()) return empty
  var size = box.getSize(new THREE.Vector3())
  var h = size.y
  if (h <= 0.0001) return empty
  var band = Math.max(h * 0.2, 0.01)
  var topW = 0
  var botW = 0
  object.traverse(function (child) {
    if (!child.isMesh || !child.geometry) return
    var b = meshWorldBox(child, THREE)
    if (!b || b.isEmpty()) return
    var xz = Math.max(b.max.x - b.min.x, b.max.z - b.min.z)
    if (b.max.y >= box.max.y - band) topW = Math.max(topW, xz)
    if (b.min.y <= box.min.y + band) botW = Math.max(botW, xz)
  })
  return { top: topW, bot: botW }
}

/** 头罩细、发动机粗。顶部明显更粗说明头朝下。 */
function isNoseDown(object, THREE) {
  if (!object || !THREE) return false
  var box = getRenderableBox(object, THREE)
  if (!box || box.isEmpty()) return false
  var ends = measureEndWidths(object, THREE, box)
  if (ends.top <= 0 || ends.bot <= 0) return false
  return ends.top > ends.bot * 1.22
}

function noseTaperScore(object, THREE, box, size) {
  var ends = measureEndWidths(object, THREE, box)
  if (ends.top <= 0 || ends.bot <= 0) return 0
  var span = Math.max(ends.top, ends.bot)
  var weight = isBoardSize(size) ? 1.2 : 6
  return ((ends.bot - ends.top) / span) * weight
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

function scoreStandWorld(object, THREE) {
  var box = standMeasureBox(object, THREE)
  if (!box || box.isEmpty()) return -1e9
  var size = box.getSize(new THREE.Vector3())
  return scoreStandSize(size) + noseTaperScore(object, THREE, box, size)
}

/**
 * 尺寸先选定立起轴（猎鹰重型 Z-up → -90°X，展板 → 绕薄轴）。
 * 世界盒只有在「量到的尺寸和旋转预测一致」时才能改写，避免小程序
 * matrixWorld 未跟上包装旋转时误选不转，细长 Z-up 箭会躺成看不见。
 */
function autoStandRotation(object, THREE) {
  var fallback = withStandFlip({ x: 0, y: 0, z: 0 })
  if (!object || !THREE) return fallback
  var sizeBox = standMeasureBox(object, THREE)
  var rawSize = sizeBox && !sizeBox.isEmpty() ? sizeBox.getSize(new THREE.Vector3()) : null
  fallback = pickStandRotationFromSize(rawSize)
  if (!rawSize) return fallback
  if (typeof object.rotation === 'undefined' || !object.rotation || !object.rotation.set) {
    return fallback
  }
  if (typeof object.updateMatrixWorld !== 'function') return fallback
  var saved = {
    x: object.rotation.x || 0,
    y: object.rotation.y || 0,
    z: object.rotation.z || 0
  }
  var best = fallback
  var bestScore = scoreStandSize(rotateSizeByEuler(rawSize, fallback)) + standCandidateBias(fallback)
  for (var i = 0; i < STAND_CANDIDATES.length; i++) {
    var cand = STAND_CANDIDATES[i]
    object.rotation.set(cand.x, cand.y, cand.z)
    object.updateMatrixWorld(true)
    var measuredBox = standMeasureBox(object, THREE)
    var measured = measuredBox && !measuredBox.isEmpty() ? measuredBox.getSize(new THREE.Vector3()) : null
    if (!sizeClose(measured, rotateSizeByEuler(rawSize, cand))) continue
    var score = scoreStandWorld(object, THREE) + standCandidateBias(cand)
    if (score > bestScore + 0.05) {
      bestScore = score
      best = withStandFlip(cand)
    }
  }
  object.rotation.set(saved.x, saved.y, saved.z)
  if (object.updateMatrixWorld) object.updateMatrixWorld(true)
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
  var spin = new THREE.Group()
  spin.name = 'r3d-exhibit-root'
  spin.add(stand)
  spin.updateMatrixWorld(true)
  return spin
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
    var info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync && wx.getSystemInfoSync()
    var plat = String((info && (info.platform || info.system)) || '')
    return /ios/i.test(plat)
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
 * 纯贴图 PBR 在小程序上常发黑；32 位索引常整箭不画。
 */
/** 纯贴图 PBR 在 iOS WebGL 上着色器过重会整网格不画；Lambert 与官方示例一致。 */
function useLambertIfTextureOnly(object, THREE) {
  if (!object || !THREE || !THREE.MeshLambertMaterial) return object
  object.traverse(function (child) {
    if (!child.isMesh || !child.material || Array.isArray(child.material)) return
    var m = child.material
    if (!isTextureOnlyAlbedo(m)) return
    var map = m.map && textureReady(m.map) ? m.map : null
    child.material = new THREE.MeshLambertMaterial({
      map: map,
      color: 0xffffff,
      side: THREE.DoubleSide != null ? THREE.DoubleSide : m.side
    })
  })
  return object
}

function ensureDrawableModel(object, THREE) {
  if (!object) return object
  downgradeUint32Index(object, THREE)
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
    lights: lights,
    cssW: cssW,
    cssH: cssH,
    onDimLabels: handlers && handlers.onDimLabels,
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
  if (session.modelRoot) {
    session.scene.remove(session.modelRoot)
    disposeObject3D(session.modelRoot)
  }
  ensureDrawableModel(object, session.THREE)
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

function loadGlb(lib, url, nativeCanvas, onProgress) {
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
          if (isFragileTextureOnlyModel(root)) {
            adaptViewerTextures(root, lib.THREE)
            waitForModelTextures(root).then(function () {
              ensureDrawableModel(root, lib.THREE)
              if (typeof onProgress === 'function') onProgress(100)
              resolve(prepareModel(root))
            })
            return
          }
          ensureDrawableModel(root, lib.THREE)
          if (typeof onProgress === 'function') onProgress(100)
          resolve(prepareModel(root))
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
  isUprightExhibitSize,
  finalizeStandRotation,
  autoStandRotation,
  isBoardSize,
  isNoseDown,
  wrapStandingModel,
  adaptViewerTextures,
  dropBrokenColorMaps,
  dropBrokenMaps,
  autoFixExhibitShading,
  isFragileTextureOnlyModel,
  isWxIOS,
  ensureDrawableModel,
  downgradeUint32Index,
  loadGlb,
  friendlyGlbError,
  errorDetail,
  startLoop,
  stopLoop,
  resizeSession,
  disposeSession
}
