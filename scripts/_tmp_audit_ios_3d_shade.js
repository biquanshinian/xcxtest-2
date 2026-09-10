/**
 * 本轮审计：iOS 3D 着色分流（猎鹰9 黑棍 / 全系列发黑 / 星舰材质）
 * 运行：node scripts/_tmp_audit_ios_3d_shade.js
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

function fnBody(src, name) {
  const idx = src.indexOf('function ' + name)
  if (idx < 0) return ''
  const open = src.indexOf('{', idx)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open, open + 4000)
}

console.log('── 源码约束 ──')
const runtime = read('subpackages/rocket-3d/runtime.js')
const createBody = fnBody(runtime, 'createSession')
const ensureBody = fnBody(runtime, 'ensureDrawableModel')
const seriesBody = fnBody(runtime, 'isIosSeriesBoard')
const basicBody = fnBody(runtime, 'basicFromStandard')
const adaptBody = fnBody(runtime, 'adaptViewerTextures')
const loadBody = fnBody(runtime, 'loadGlb')
const setModelBody = fnBody(runtime, 'setModel')
const wrapBody = fnBody(runtime, 'wrapStandingModel')

if (/ios && THREE.WebGL1Renderer/.test(createBody) || /WebGL1Renderer/.test(createBody)) {
  fail('createSession 仍按 iOS 强制 WebGL1')
} else if (/precision:\s*'mediump'/.test(createBody)) {
  fail('createSession 仍 mediump，金属更容易发黑')
} else if (!/new THREE.WebGLRenderer/.test(createBody)) {
  fail('createSession 未使用 WebGLRenderer')
} else ok('iOS 不再强制 WebGL1 / mediump')

if (!/!isWxIOS\(\) && renderer.outputColorSpace/.test(createBody)) {
  fail('iOS 未按 git 仓库跳过 outputColorSpace sRGB')
} else ok('iOS 输出色彩空间跟 git 仓库一致')

if (!(/!isWxIOS\(\)/.test(adaptBody) && /SRGBColorSpace/.test(adaptBody))) {
  fail('adaptViewerTextures 未按 git 仓库对 iOS 跳过 albedo sRGB')
} else ok('albedo sRGB 跟 git 仓库一致：仅安卓写入')

if (!/OES_element_index_uint/.test(createBody)) fail('未请求 OES_element_index_uint')
else ok('仍请求 32 位索引扩展')

if (/function phongFromStandard/.test(runtime) || /MeshPhongMaterial/.test(ensureBody)) {
  fail('仍有 Phong 全量改材质路径')
} else ok('没有 Phong 全量改材质')

if (!/function isIosSeriesBoard/.test(runtime) || !/slenderLineupSpread/.test(seriesBody)) {
  fail('全系列判定未按横排跨度收口')
} else if (!/opts && opts.series/.test(seriesBody) && !/opts\.series/.test(seriesBody)) {
  fail('全系列判定未认 catalog series 标记，1300 零件真模会只剩贴图')
} else if (!/countMeshes\(object\) >= 400/.test(seriesBody)) {
  fail('全系列判定未覆盖超多零件真模')
} else ok('Basic 给全系列标记 / 横向跨度 / 400+ 零件，不看取景盒薄片')

if (/function toneDownIosMetal/.test(runtime)) fail('非全系列仍有剥金属度贴图路径，星舰会镂空')
else ok('非全系列不剥金属度贴图，跟 git 仓库一致')

if (!/map && typeof m.alphaTest/.test(basicBody)) fail('Basic 仍给无贴图 MASK 留 alphaTest，箭体会被裁掉')
else ok('无贴图 MASK 不带 alphaTest')
if (!/colorSum\(m.color\) >= 0.9/.test(basicBody) || !/0\.78,\s*0\.8,\s*0\.84/.test(basicBody)) {
  fail('Basic 深色底未提亮，全系列还会发黑')
} else ok('全系列 Basic 深色底会提亮')

if (!/session.series = !!resolved.series/.test(read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js'))) {
  fail('展陈组件未把 series 标记传进装模')
} else ok('展陈组件把全系列标记传给 runtime')

if (!/waitForModelTextures\(root\)/.test(loadBody) || !/ensureDrawableModel\(root/.test(loadBody)) {
  fail('loadGlb 未先等贴图再着色')
} else ok('loadGlb：等贴图 → 着色')

if (!/ensureDrawableModel\(object/.test(setModelBody) || !/wrapStandingModel\(object/.test(setModelBody)) {
  fail('setModel 未按先着色再立起')
} else if (setModelBody.indexOf('wrapStandingModel') < setModelBody.indexOf('ensureDrawableModel')) {
  fail('setModel 先立起后着色，分类会看到包装盒')
} else ok('setModel：先着色再立起包装')

if (!/r3d-stand/.test(wrapBody) || !/r3d-yaw/.test(wrapBody) || !/r3d-exhibit-root/.test(wrapBody)) {
  fail('立起场景图缺 stand / yaw / root')
} else ok('翻转场景图仍是 root → yaw → stand')

if (/maxDim \/ 500/.test(runtime) && /maxDim \* 200/.test(runtime)) fail('近远比仍过大')
else if (!/ratioCap = isWxIOS\(\) \? 800/.test(runtime)) fail('iOS 近远比未回到 800')
else ok('iOS 近远比 800，未再用 WebGL1 那档 400')

const preview = read('admin-web/src/components/media/GlbPreview.vue')
if (/autoStandRotation|wrapStandingModel|ensureDrawableModel|toneDownIosMetal/.test(preview)) {
  fail('后台预览被套上了小程序着色/立起')
} else ok('后台预览仍按 GLB 原样，作对照')

if (!/prepareModel\(object\) \{\s*return object/.test(runtime.replace(/\n/g, ' '))) {
  const prep = fnBody(runtime, 'prepareModel')
  if (!/return object/.test(prep) || /material/.test(prep)) fail('prepareModel 仍改模型')
  else ok('prepareModel 不改网格')
} else ok('prepareModel 不改网格')

console.log('\n── 分类矩阵 ──')
const {
  ensureDrawableModel,
  isFragileTextureOnlyModel,
  getRenderableBox,
  isBoardSize,
  pickStandRotationFromSize,
  autoStandRotation,
  wrapStandingModel
} = require('../subpackages/rocket-3d/runtime.js')

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
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
function Color(r, g, b) {
  this.r = r
  this.g = g
  this.b = b
}
function Group() {
  this.children = []
  this.rotation = { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z } }
}
Group.prototype.add = function (child) {
  this.children.push(child)
}
Group.prototype.updateMatrixWorld = function () {}
Group.prototype.updateWorldMatrix = function () {}
Group.prototype.traverse = function (fn) {
  fn(this)
  this.children.forEach((c) => (c.traverse ? c.traverse(fn) : fn(c)))
}

function Basic(opts) {
  this.isBasic = true
  this.isMeshBasicMaterial = true
  this.map = opts && opts.map
  this.color = opts && opts.color
  this.transparent = !!(opts && opts.transparent)
}
function Lambert() {
  this.isLambert = true
}

const THREE = {
  Box3,
  Vector3,
  Color,
  Group,
  DoubleSide: 2,
  MeshBasicMaterial: Basic,
  MeshLambertMaterial: Lambert
}

function mesh(name, min, max, mat) {
  return {
    isMesh: true,
    visible: true,
    name,
    frustumCulled: true,
    geometry: {
      boundingBox: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] }
      },
      index: null,
      attributes: {}
    },
    updateWorldMatrix: function () {},
    matrixWorld: {},
    material: mat || {
      type: 'MeshStandardMaterial',
      metalness: 0.25,
      roughness: 0.5,
      color: { r: 0.9, g: 0.9, b: 0.92 }
    }
  }
}

function rootOf(meshes) {
  return {
    traverse: function (fn) {
      meshes.forEach(fn)
    }
  }
}

function paint(meshes, extra) {
  meshes.forEach((m) => {
    m.material = Object.assign(
      {
        type: 'MeshStandardMaterial',
        metalness: 0.25,
        roughness: 0.5,
        color: { r: 0.9, g: 0.9, b: 0.92 }
      },
      extra || {},
      m.material && m.material.type ? m.material : extra || {}
    )
  })
}

function runDraw(meshes, opts) {
  ensureDrawableModel(rootOf(meshes), THREE, opts)
}

const prevWx = global.wx

function withIOS(fn) {
  global.wx = { getDeviceInfo: function () { return { platform: 'ios' } } }
  try {
    fn()
  } finally {
    global.wx = prevWx
  }
}
function withAndroid(fn) {
  global.wx = { getDeviceInfo: function () { return { platform: 'android' } } }
  try {
    fn()
  } finally {
    global.wx = prevWx
  }
}

function seriesCylindrical() {
  const meshes = []
  for (let i = 0; i < 12; i++) {
    const x = -63 + i * 9.5
    meshes.push(mesh('CZ' + i, [x - 1.1, 0.2, -1.1], [x + 1.1, 38, 1.1], {
      type: 'MeshStandardMaterial',
      metalness: 0.4,
      roughness: 0.5,
      color: { r: 0.12, g: 0.12, b: 0.14 }
    }))
  }
  return meshes
}

function seriesCards() {
  const meshes = []
  for (let i = 0; i < 12; i++) {
    meshes.push(mesh('CZ' + i, [-60 + i * 10, 0, -2], [-50 + i * 10, 38, 2], {
      type: 'MeshStandardMaterial',
      metalness: 0.4,
      roughness: 0.5,
      map: i % 2 ? { image: { width: 64, height: 64, complete: true } } : null,
      color: { r: 0.85, g: 0.85, b: 0.88 }
    }))
  }
  return meshes
}

function falcon9WithPadAndEngines() {
  const meshes = [
    mesh('F9', [-1.85, 3, -1.85], [1.85, 70, 1.85], {
      type: 'MeshStandardMaterial',
      metalness: 0,
      roughness: 0.99,
      color: { r: 0.015, g: 0.015, b: 0.015 }
    }),
    mesh('Hangar', [-100, 0, -10], [100, 8, 10], {
      type: 'MeshStandardMaterial',
      metalness: 0.1,
      roughness: 0.8,
      color: { r: 0.4, g: 0.4, b: 0.42 }
    })
  ]
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const cx = Math.cos(a) * 1.2
    const cz = Math.sin(a) * 1.2
    meshes.push(mesh('Merlin' + i, [cx - 0.45, 0, cz - 0.45], [cx + 0.45, 3.1, cz + 0.45], {
      type: 'MeshStandardMaterial',
      metalness: 0.55,
      roughness: 0.35,
      color: { r: 0.55, g: 0.56, b: 0.58 }
    }))
  }
  return meshes
}

function starshipTiles() {
  const meshes = [
    mesh('Ship', [-4.5, 12, -4.5], [4.5, 50, 4.5], {
      type: 'MeshStandardMaterial',
      metalness: 0.92,
      roughness: 0.18,
      metalnessMap: { image: { width: 64, height: 64, complete: true } },
      roughnessMap: { image: { width: 64, height: 64, complete: true } },
      normalMap: { image: { width: 64, height: 64, complete: true } },
      color: { r: 0.72, g: 0.74, b: 0.76 }
    }),
    mesh('Booster', [-4.8, 0, -4.8], [4.8, 12, 4.8], {
      type: 'MeshStandardMaterial',
      metalness: 0.88,
      roughness: 0.22,
      color: { r: 0.7, g: 0.72, b: 0.74 }
    })
  ]
  for (let i = 0; i < 18; i++) {
    const y0 = 14 + (i % 9) * 3.6
    const x0 = i < 9 ? -4.6 : 3.8
    meshes.push(mesh('Tile' + i, [x0, y0, -3], [x0 + 0.8, y0 + 3.2, 3], {
      type: 'MeshStandardMaterial',
      metalness: 0.9,
      roughness: 0.2,
      color: { r: 0.68, g: 0.7, b: 0.72 }
    }))
  }
  return meshes
}

function falconHeavy() {
  return [
    mesh('Core', [-1.8, 0, -1.8], [1.8, 70, 1.8]),
    mesh('Left', [-6.2, 0, -1.8], [-2.6, 70, 1.8]),
    mesh('Right', [2.6, 0, -1.8], [6.2, 70, 1.8])
  ]
}

withAndroid(() => {
  const s = seriesCards()
  runDraw(s)
  if (s[0].material.isBasic) fail('安卓全系列被收成 Basic')
  else ok('安卓全系列仍 PBR')

  const metal = starshipTiles()
  runDraw(metal)
  if (metal[0].material.metalness < 0.8) fail('安卓星舰金属度被改了')
  else ok('安卓不降金属度')
})

withIOS(() => {
  const cards = seriesCards()
  runDraw(cards)
  if (!cards[0].material.isBasic || !cards[1].material.isBasic) fail('iOS 卡片全系列未收 Basic')
  else if (cards[0].material.map) fail('无贴图箭体被套了 map')
  else if (!cards[1].material.map) fail('有贴图网格丢掉 map')
  else ok('iOS 卡片全系列收 Basic，贴图/纯色都在')

  const cyl = seriesCylindrical()
  const cylSize = new Box3()
  rootOf(cyl).traverse((c) => {
    if (!c.isMesh) return
    if (cylSize.isEmpty()) cylSize.copy(c.geometry.boundingBox)
    else cylSize.union(c.geometry.boundingBox)
  })
  const cylFull = cylSize.getSize(new Vector3())
  const cylRocket = getRenderableBox(rootOf(cyl), THREE).getSize(new Vector3())
  runDraw(cyl)
  if (!isBoardSize(cylFull)) fail('圆柱全系列整盒应是薄片展陈，当前 ' + JSON.stringify(cylFull))
  else if (!cyl[0].material.isBasic) {
    fail(
      'iOS 圆柱全系列未收 Basic（整盒薄片=' +
        isBoardSize(cylFull) +
        ' 取景盒薄片=' +
        isBoardSize(cylRocket) +
        ' 取景=' +
        JSON.stringify(cylRocket) +
        '），会回到只剩国旗字标'
    )
  } else if (!(cyl[0].material.color && cyl[0].material.color.r >= 0.7)) {
    fail('圆柱全系列深色底未提亮，仍会整排发黑')
  } else ok('iOS 圆柱全系列也收 Basic，深色底已提亮')

  const f9 = falcon9WithPadAndEngines()
  const f9FullBox = new Box3()
  rootOf(f9).traverse((c) => {
    if (!c.isMesh) return
    if (f9FullBox.isEmpty()) f9FullBox.copy(c.geometry.boundingBox)
    else f9FullBox.union(c.geometry.boundingBox)
  })
  runDraw(f9)
  if (f9[0].material.isBasic || f9[2].material.isBasic) {
    fail('iOS 猎鹰9+9 台发动机+地坪被收成 Basic，会变成黑棍/灰棍')
  } else if (f9[0].material.color.r !== 0.015) {
    fail('猎鹰9 喷漆深色被改了: ' + f9[0].material.color.r)
  } else ok('iOS 猎鹰9+发动机+地坪保持喷漆 PBR')

  const fh = falconHeavy()
  paint(fh)
  runDraw(fh)
  if (fh.some((m) => m.material.isBasic)) fail('iOS 猎鹰重型三芯被收成 Basic')
  else ok('iOS 三芯猎鹰重型保持 PBR')

  const ship = starshipTiles()
  runDraw(ship)
  if (ship.some((m) => m.material.isBasic || m.material.isLambert)) {
    fail('iOS 星舰被换材质')
  } else if (!ship[0].material.metalnessMap) {
    fail('iOS 星舰金属度贴图被剥掉，壳体镂空')
  } else if (ship[0].material.metalness < 0.8) {
    fail('iOS 星舰金属度被改了')
  } else ok('iOS 星舰跟 git 仓库一样保留原 PBR')

  const slim = mesh('CZ5', [-2, 0, -2], [2, 57, 2], {
    type: 'MeshStandardMaterial',
    metalness: 0.3,
    roughness: 0.5,
    normalMap: { image: { width: 64, height: 64, complete: true } }
  })
  runDraw([slim])
  if (slim.material.isBasic) fail('iOS 单支长征被收成 Basic')
  else if (slim.material.metalness !== 0.3) fail('中等金属度不该动')
  else ok('iOS 单支长征保持原 PBR')

  const flagged = mesh('Lineup', [-70, 0, -2], [70, 38, 2], {
    type: 'MeshStandardMaterial',
    metalness: 0.5,
    roughness: 0.5,
    alphaTest: 0.5,
    color: { r: 0.96, g: 0.69, b: 0.27 }
  })
  runDraw([flagged], { series: true })
  if (!flagged.material.isBasic) fail('iOS 全系列标记未收 Basic')
  else if (flagged.material.alphaTest) fail('无贴图 MASK 仍带 alphaTest')
  else ok('iOS 全系列标记单网格也收 Basic，箭体不被 MASK 裁掉')

  const baked = [
    mesh('Lineup', [-70, 0, -2], [70, 38, 2], {
      type: 'MeshStandardMaterial',
      metalness: 0.4,
      roughness: 0.5,
      map: { image: { width: 64, height: 64, complete: true } },
      normalMap: { image: { width: 64, height: 64, complete: true } }
    })
  ]
  runDraw(baked)
  if (baked[0].material.isBasic) fail('单网格烘焙全系列不该走多箭 Basic（细长箭计数不够）')
  else ok('单网格烘焙展板不误伤（残缺风险见残留项）')

  const cards2 = seriesCards()
  runDraw(cards2)
  runDraw(cards2)
  if (!cards2[0].material.isBasic || cards2[1].material.map == null) fail('第二次 ensureDrawableModel 弄丢了全系列贴图')
  else ok('着色可重复调用，不二次破坏')

  const f9tex = {
    traverse: function (fn) {
      fn({
        isMesh: true,
        material: { map: { image: { width: 64, height: 64, complete: true } } },
        geometry: { index: null, attributes: {} }
      })
      fn({
        isMesh: true,
        material: { color: { r: 0.015, g: 0.015, b: 0.015 }, metalness: 0, roughness: 0.99 },
        geometry: { index: null, attributes: {} }
      })
      fn({
        isMesh: true,
        material: { color: { r: 0.015, g: 0.015, b: 0.015 }, metalness: 0, roughness: 0.99 },
        geometry: { index: null, attributes: {} }
      })
    }
  }
  if (isFragileTextureOnlyModel(f9tex)) fail('猎鹰9 被当成脆弱纯贴图')
  else ok('猎鹰9 不走 Lambert 纠偏')
})

console.log('\n── 朝向 / 翻转未回退 ──')
const rotCases = [
  { name: '长征全系列横排', size: { x: 80, y: 55, z: 8 }, want: { x: 0, z: 0 } },
  { name: 'Z-up 猎鹰重型', size: { x: 52.5, y: 21.6, z: 296.8 }, want: { x: -Math.PI / 2, z: 0 } },
  { name: 'X-up 细长箭', size: { x: 90, y: 8, z: 12 }, want: { x: 0, z: -Math.PI / 2 } },
  { name: 'Y-up 猎鹰9', size: { x: 4, y: 70, z: 4 }, want: { x: 0, z: 0 } }
]
rotCases.forEach((c) => {
  const r = pickStandRotationFromSize(c.size)
  if (Math.abs(r.x - c.want.x) > 1e-6 || Math.abs(r.z - c.want.z) > 1e-6) {
    fail(c.name + ' 朝向回退 x=' + r.x + ' z=' + r.z)
  } else ok(c.name + ' 朝向保持')
})

withIOS(() => {
  const series = seriesCylindrical()
  const stand = autoStandRotation(rootOf(series), THREE)
  if (Math.abs(stand.x) > 1e-6 || Math.abs(stand.z) > 1e-6) fail('圆柱全系列被立成竖版 x=' + stand.x)
  else ok('圆柱全系列底座仍水平')
})

if (typeof wrapStandingModel === 'function') {
  const dummy = mesh('F9', [-2, 0, -2], [2, 70, 2])
  dummy.traverse = function (fn) { fn(this) }
  const wrapped = wrapStandingModel(dummy, THREE)
  const names = []
  if (wrapped && wrapped.traverse) wrapped.traverse((c) => { if (c.name) names.push(c.name) })
  if (!names.includes('r3d-exhibit-root') || !names.includes('r3d-yaw') || !names.includes('r3d-stand')) {
    fail('wrapStandingModel 场景图不完整: ' + names.join(','))
  } else ok('wrapStandingModel 场景图完整')
}

console.log('\n── 单测 ──')
const tests = spawnSync(
  process.execPath,
  [
    '--test',
    'test/rocket-3d-models.test.js',
    'test/rocket-3d-audit.test.js',
    'test/rocket-3d-exhibit.test.js',
    'test/rocket-3d-bind.test.js'
  ],
  { cwd: ROOT, encoding: 'utf8' }
)
if (tests.status !== 0) {
  fail('3D 单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:pass|tests)[^\n]*/g)
  ok('3D 单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

const orient = spawnSync(process.execPath, ['scripts/_tmp_audit_series_3d_orient.js'], {
  cwd: ROOT,
  encoding: 'utf8'
})
if (orient.status !== 0) {
  fail('朝向审计失败')
  console.log(orient.stdout || orient.stderr)
} else ok('朝向审计通过')

console.log('')
if (issues.length) {
  console.log('结论：有问题')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('结论：通过')
console.log('残留：真机 WebGL 编不过、单网格烘焙全系列、无 IBL 的外观差异，这边验不了。')
