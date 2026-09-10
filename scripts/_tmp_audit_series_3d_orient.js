/**
 * 本轮审计：长征全系列 3D 朝向（Y 被顺时针转 90°）+ iOS 模型残缺
 * 运行：node scripts/_tmp_audit_series_3d_orient.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const issues = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => {
  issues.push(m)
  console.log('  FAIL ' + m)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function nearly(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-6
}

function identityRot(rot) {
  return rot && nearly(rot.x, 0) && nearly(rot.z, 0)
}

function neg90X(rot) {
  return rot && nearly(rot.x, -Math.PI / 2) && nearly(rot.z, 0)
}

function neg90Z(rot) {
  return rot && nearly(rot.z, -Math.PI / 2) && nearly(rot.x, 0)
}

console.log('── 源码约束 ──')
const runtime = read('subpackages/rocket-3d/runtime.js')
if (/mid \/ max > 0\.42 && min \/ max < 0\.32/.test(runtime) && !/y \/ max >= 0\.12/.test(runtime)) {
  fail('isBoardSize 仍要求接近正方形，宽台面会当成细长箭')
} else ok('isBoardSize 允许扁的横排展陈')
if (/shape === 'board'\) return y >= max \* 0\.92/.test(runtime)) {
  fail('isUprightExhibitSize 仍要求展板竖向最长，会把全系列立成竖版')
} else ok('展板直立允许横向比竖向长')
if (!/isUprightExhibitSize\(rawSize\)/.test(runtime) || !/rx === 90 \|\| rx === -90/.test(runtime)) {
  fail('已直立展陈未挡住 90° 改轴')
} else ok('已直立展陈禁止再绕 X/Z 转 90°')
if (!/waitForModelTextures\(root\)/.test(runtime) || /isFragileTextureOnlyModel\(root\)/.test(runtime.split('function loadGlb')[1] || '')) {
  const loadBody = runtime.slice(runtime.indexOf('function loadGlb'))
  const parseCb = loadBody.slice(loadBody.indexOf('function (gltf)'), loadBody.indexOf('function (err)'))
  if (!/waitForModelTextures/.test(parseCb)) fail('loadGlb 未统一等待贴图')
  else if (/isFragileTextureOnlyModel\(root\)/.test(parseCb)) fail('loadGlb 仍只给脆弱模型等贴图')
  else ok('loadGlb 装模前等待贴图')
} else ok('loadGlb 装模前等待贴图')
if (!/simplifyIosBoardMaterials/.test(runtime) || !/MeshBasicMaterial/.test(runtime)) fail('缺 iOS 展板 Basic 收口')
else ok('iOS 全系列展板走 MeshBasic')
if (/ios && THREE.WebGL1Renderer/.test(runtime) || /precision: 'mediump'/.test(runtime)) {
  fail('iOS 仍强制 WebGL1/mediump，金属会发黑、材质变体更容易编不过')
} else ok('iOS 不再强制 WebGL1')
if (!/function isIosSeriesBoard/.test(runtime) || !/slenderLineupSpread/.test(runtime)) {
  fail('iOS 材质降级未按多箭横排跨度收紧，会把猎鹰9/星舰收成黑棍')
} else ok('iOS 材质降级按横排跨度/全系列标记收口')
if (/function toneDownIosMetal/.test(runtime)) fail('非全系列仍有剥金属度贴图路径，星舰会镂空')
else ok('非全系列不剥金属度贴图，跟 git 仓库一致')
if (/function phongFromStandard/.test(runtime)) fail('仍有 Phong 全量改材质路径')
else ok('已去掉会改坏其它型号的 Phong 路径')
if (!/child\.frustumCulled = false/.test(runtime)) fail('全系列网格未关视锥裁剪')
else ok('全系列关闭视锥裁剪')
if (!/ratioCap = isWxIOS\(\)/.test(runtime)) fail('applyBoxClip 近远比未收紧')
else ok('applyBoxClip 限制近远裁剪比')
if (/maxDim \/ 500/.test(runtime) && /maxDim \* 200/.test(runtime)) {
  fail('applyBoxClip 仍用 1:100000 近远比')
} else ok('旧的过大近远比已去掉')

const preview = read('admin-web/src/components/media/GlbPreview.vue')
if (/autoStandRotation|wrapStandingModel/.test(preview)) {
  fail('后台预览不应套小程序立起包装')
} else ok('后台预览仍按 GLB 原朝向，作为对照')

console.log('\n── 立起矩阵 ──')
const {
  isBoardSize,
  isUprightExhibitSize,
  pickStandRotationFromSize,
  scoreStandSize,
  autoStandRotation,
  applyBoxClip,
  ensureDrawableModel,
  isFragileTextureOnlyModel
} = require('../subpackages/rocket-3d/runtime.js')

const cases = [
  { name: '长征全系列横排', size: { x: 80, y: 55, z: 8 }, want: 'id' },
  { name: '竖版已立展板', size: { x: 55, y: 80, z: 8 }, want: 'id' },
  { name: '偏扁横排', size: { x: 120, y: 40, z: 12 }, want: 'id' },
  { name: '很扁横排', size: { x: 220, y: 32, z: 14 }, want: 'id' },
  { name: '平铺展板', size: { x: 80, y: 8, z: 55 }, want: '-x' },
  { name: 'Z-up 猎鹰重型', size: { x: 52.5, y: 21.6, z: 296.8 }, want: '-x' },
  { name: 'X-up 细长箭', size: { x: 90, y: 8, z: 12 }, want: '-z' },
  { name: 'Y-up 细长箭', size: { x: 4, y: 70, z: 4 }, want: 'id' },
  { name: '三芯猎鹰重型 Y-up', size: { x: 22, y: 70, z: 4 }, want: 'id' }
]

for (const c of cases) {
  const rot = pickStandRotationFromSize(c.size)
  const hit =
    c.want === 'id' ? identityRot(rot) : c.want === '-x' ? neg90X(rot) : neg90Z(rot)
  if (hit) ok(c.name + ' → ' + c.want)
  else fail(c.name + ' 得到 x=' + rot.x.toFixed(3) + ' z=' + rot.z.toFixed(3) + ' 期望 ' + c.want)
}

if (isBoardSize({ x: 90, y: 8, z: 12 })) fail('X-up 细长箭被误判成展板')
else ok('X-up 细长箭不是展板')
if (!isBoardSize({ x: 220, y: 32, z: 14 })) fail('很扁横排仍不是展板，会被当成细长箭立起')
else ok('很扁横排识别为展陈')
if (!isUprightExhibitSize({ x: 80, y: 55, z: 8 })) fail('横排全系列未被当成已直立')
else ok('横排全系列已直立')
if (isUprightExhibitSize({ x: 80, y: 8, z: 55 })) fail('平铺展板被当成已直立')
else ok('平铺展板需要立起')

const face = scoreStandSize({ x: 80, y: 55, z: 8 })
const portrait = scoreStandSize({ x: 55, y: 80, z: 8 })
if (face + 0.05 < portrait) fail('横排得分低于竖版，会把全系列转成竖版')
else ok('横排不比竖版更吃亏')

console.log('\n── 多箭场景 / 裁剪 / 着色 ──')
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  distanceTo(other) {
    const dx = this.x - other.x
    const dy = this.y - other.y
    const dz = this.z - other.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
}
class Box3 {
  constructor() {
    this.min = new Vector3(Infinity, Infinity, Infinity)
    this.max = new Vector3(-Infinity, -Infinity, -Infinity)
  }
  isEmpty() {
    return this.min.x > this.max.x
  }
  copy(b) {
    this.min.x = b.min.x
    this.min.y = b.min.y
    this.min.z = b.min.z
    this.max.x = b.max.x
    this.max.y = b.max.y
    this.max.z = b.max.z
    return this
  }
  union(b) {
    this.min.x = Math.min(this.min.x, b.min.x)
    this.min.y = Math.min(this.min.y, b.min.y)
    this.min.z = Math.min(this.min.z, b.min.z)
    this.max.x = Math.max(this.max.x, b.max.x)
    this.max.y = Math.max(this.max.y, b.max.y)
    this.max.z = Math.max(this.max.z, b.max.z)
    return this
  }
  getSize(v) {
    v.x = this.max.x - this.min.x
    v.y = this.max.y - this.min.y
    v.z = this.max.z - this.min.z
    return v
  }
  getCenter(v) {
    v.x = (this.min.x + this.max.x) / 2
    v.y = (this.min.y + this.max.y) / 2
    v.z = (this.min.z + this.max.z) / 2
    return v
  }
  applyMatrix4() {
    return this
  }
  setFromObject(object) {
    const self = this
    object.traverse(function (child) {
      if (!child.isMesh || !child.geometry || !child.geometry.boundingBox) return
      if (self.isEmpty()) self.copy(child.geometry.boundingBox)
      else self.union(child.geometry.boundingBox)
    })
    return this
  }
}
const THREE = { Box3, Vector3, DoubleSide: 2 }

function mesh(name, min, max) {
  return {
    isMesh: true,
    visible: true,
    name,
    geometry: {
      boundingBox: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] }
      },
      index: null,
      attributes: {}
    },
    updateWorldMatrix: function () {},
    matrixWorld: {}
  }
}

function standOf(meshes) {
  return {
    rotation: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z } },
    updateMatrixWorld: function () {},
    updateWorldMatrix: function () {},
    traverse: function (fn) { meshes.forEach(fn) }
  }
}

const series = [mesh('Platform', [-70, -0.8, -8], [70, 0.2, 8])]
for (let i = 0; i < 14; i++) {
  const x = -63 + i * 9.5
  const h = 28 + (i % 4) * 6
  series.push(mesh('CZ' + i, [x - 1.1, 0.2, -1.1], [x + 1.1, h, 1.1]))
  series.push(mesh('YF-100', [x - 0.35, -1.1, -0.35], [x + 0.35, 0.25, 0.35]))
}
const seriesRot = autoStandRotation(standOf(series), THREE)
if (identityRot(seriesRot)) ok('14 箭+台座+YF-100 保持底座水平')
else fail('14 箭场景被转了 x=' + seriesRot.x + ' z=' + seriesRot.z)

const box = new Box3()
box.min.x = -60
box.min.y = 0
box.min.z = -8
box.max.x = 60
box.max.y = 40
box.max.z = 8
const camera = {
  position: new Vector3(0, 20, 258),
  updateProjectionMatrix: function () {}
}
applyBoxClip(camera, box, THREE)
const maxDim = 120
if (camera.far / camera.near > 2500) fail('近远比仍过大: ' + (camera.far / camera.near).toFixed(0))
else ok('近远比 ' + (camera.far / camera.near).toFixed(0))
if (camera.far < maxDim * 10) fail('far 小于展陈最大拉远，缩小时会切掉模型')
else ok('far 覆盖展陈最大拉远')

const f9 = {
  traverse: function (fn) {
    fn({ isMesh: true, material: { map: { image: { width: 64, height: 64, complete: true } } }, geometry: { index: null, attributes: {} } })
    fn({ isMesh: true, material: { color: { r: 0.015, g: 0.015, b: 0.015 }, metalness: 0, roughness: 0.99 }, geometry: { index: null, attributes: {} } })
    fn({ isMesh: true, material: { color: { r: 0.015, g: 0.015, b: 0.015 }, metalness: 0, roughness: 0.99 }, geometry: { index: null, attributes: {} } })
  }
}
if (isFragileTextureOnlyModel(f9)) fail('猎鹰9被当成脆弱纯贴图，会误改喷漆')
else ok('猎鹰9不走脆弱纯贴图纠偏')

const prevWx = global.wx
global.wx = { getDeviceInfo: function () { return { platform: 'android' } } }
const androidMat = { type: 'MeshStandardMaterial', map: { image: { width: 64, height: 64, complete: true } }, normalMap: { image: { width: 64, height: 64, complete: true } }, needsUpdate: false }
const androidMesh = mesh('CZ0', [-40, 0, -4], [40, 38, 4])
androidMesh.material = androidMat
ensureDrawableModel({ traverse: function (fn) { fn(androidMesh) } }, Object.assign({ MeshLambertMaterial: function () { this.isLambert = true } }, THREE))
if (androidMesh.material.isLambert) fail('安卓全系列不该把 PBR 收成 Lambert')
else ok('安卓全系列保留 PBR')

global.wx = { getDeviceInfo: function () { return { platform: 'ios' } } }
function Basic(opts) {
  this.isBasic = true
  this.map = opts && opts.map
  this.color = opts && opts.color
}
function Lambert() { this.isLambert = true }
const iosMeshes = []
for (let i = 0; i < 12; i++) {
  const m = mesh('CZ' + i, [-60 + i * 10, 0, -2], [-50 + i * 10, 38, 2])
  m.material = {
    type: 'MeshStandardMaterial',
    map: i % 2 ? { image: { width: 64, height: 64, complete: true } } : null,
    normalMap: { image: { width: 64, height: 64, complete: true } },
    color: { r: 0.85, g: 0.85, b: 0.88 }
  }
  iosMeshes.push(m)
}
ensureDrawableModel(
  { traverse: function (fn) { iosMeshes.forEach(fn) } },
  Object.assign({ MeshBasicMaterial: Basic, MeshLambertMaterial: Lambert }, THREE)
)
if (iosMeshes[0].material.isLambert) fail('iOS 全系列被收成 Lambert')
else if (!iosMeshes[0].material.isBasic) fail('iOS 全系列未收成 Basic')
else if (iosMeshes[0].material.map) fail('无贴图箭体不该硬套 map')
else if (!iosMeshes[1].material.map) fail('有贴图的网格丢掉了 map')
else ok('iOS 全系列收成 Basic，贴图和纯色都保留')

const slim = mesh('F9', [-2, 0, -2], [2, 70, 2])
slim.material = { type: 'MeshStandardMaterial', metalness: 0.3, roughness: 0.5, normalMap: { image: { width: 64, height: 64, complete: true } } }
ensureDrawableModel({ traverse: function (fn) { fn(slim) } }, Object.assign({ MeshBasicMaterial: Basic, MeshLambertMaterial: Lambert }, THREE))
if (slim.material.isBasic) fail('iOS 细长箭不该被收成 Basic')
else ok('iOS 普通型号保持原材质')

const f9Pad = [
  mesh('F9', [-2, 0, -2], [2, 70, 2]),
  mesh('Hangar', [-100, 0, -10], [100, 8, 10])
]
for (let i = 0; i < 5; i++) f9Pad.push(mesh('Crate' + i, [i * 10, 0, 12], [i * 10 + 8, 8, 20]))
f9Pad.forEach(function (m) {
  m.material = { type: 'MeshStandardMaterial', metalness: 0.25, roughness: 0.5, color: { r: 0.9, g: 0.9, b: 0.92 } }
})
ensureDrawableModel(
  { traverse: function (fn) { f9Pad.forEach(fn) } },
  Object.assign({ MeshBasicMaterial: Basic, MeshLambertMaterial: Lambert }, THREE)
)
if (f9Pad[0].material.isBasic) fail('iOS 猎鹰9带地坪被收成 Basic，会变成黑棍')
else ok('iOS 猎鹰9带地坪仍保持 PBR')
global.wx = prevWx

console.log('\n── 单测 ──')
const tests = spawnSync(
  process.execPath,
  ['--test', 'test/rocket-3d-models.test.js', 'test/rocket-3d-audit.test.js', 'test/rocket-3d-exhibit.test.js', 'test/rocket-3d-bind.test.js'],
  { cwd: ROOT, encoding: 'utf8' }
)
if (tests.status !== 0) {
  fail('3D 单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:pass|tests)[^\n]*/g)
  ok('3D 单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

console.log('')
if (issues.length) {
  console.log('结论：有问题')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('结论：通过')
