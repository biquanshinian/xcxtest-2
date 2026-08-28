/**
 * node --test test/rocket-3d-models.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeRocketKey,
  resolveSlug,
  buildGlbUrl,
  resolveRocketModel,
  hasReadyRocketModel,
  READY_SLUGS,
  MODEL_PREFIX
} = require('../subpackages/rocket-3d/models.js')
const {
  hasReadyRocketModel: hasReadyRocketModelGate,
  resolveReadyModelUrl
} = require('../pages/mission-detail/utils/rocket-3d-gate.js')
const {
  ingestMediaMap,
  getReadyCredit
} = require('../utils/rocket-3d-ready.js')
const {
  capPixelRatio,
  friendlyGlbError,
  prepareModel,
  exhibitStandRotation,
  pickStandRotationFromSize,
  scoreStandSize,
  isUprightExhibitSize,
  finalizeStandRotation,
  autoStandRotation,
  isNoseDown,
  adaptViewerTextures,
  dropBrokenColorMaps,
  autoFixExhibitShading,
  isFragileTextureOnlyModel,
  ensureDrawableModel,
  downgradeUint32Index,
  meshRocketScore,
  getRenderableBox,
  getExhibitFrameBox
} = require('../subpackages/rocket-3d/runtime.js')

test('normalizeRocketKey：中文长征/猎鹰译成英文键', () => {
  assert.equal(normalizeRocketKey('长征五号'), 'long march 5')
  assert.equal(normalizeRocketKey('猎鹰9号'), 'falcon 9')
  assert.equal(normalizeRocketKey('朱雀三号'), 'zhuque 3')
})

test('resolveSlug：常见型号命中稳定 slug', () => {
  assert.equal(resolveSlug('Falcon 9'), 'falcon-9')
  assert.equal(resolveSlug('Falcon Heavy'), 'falcon-heavy')
  assert.equal(resolveSlug('长征五号'), 'long-march-5')
  assert.equal(resolveSlug('长征五号乙'), 'long-march-5b')
  assert.equal(resolveSlug('长征五号B'), 'long-march-5b')
  assert.equal(resolveSlug('Long March 5'), 'long-march-5')
  assert.equal(resolveSlug('长征七号改'), 'long-march-7a')
  assert.equal(resolveSlug('长征七号甲'), 'long-march-7a')
  assert.equal(resolveSlug('长征火箭全系列'), 'long-march-series')
  assert.equal(resolveSlug('朱雀二号改'), 'zhuque-2e')
  assert.equal(resolveSlug('Starship'), 'starship')
  assert.equal(resolveSlug('Super Heavy'), 'starship')
  assert.equal(resolveSlug('星舰'), 'starship')
  assert.equal(resolveSlug('ZhuQue-3'), 'zhuque-3')
  assert.equal(resolveSlug('未知火箭xyz'), '')
  assert.equal(resolveSlug('Acme Heavy'), 'acme-heavy')
})

test('未就绪型号不拼远端 URL，不显示入口', () => {
  ingestMediaMap({})
  assert.equal(READY_SLUGS['falcon-9'], undefined)
  const resolved = resolveRocketModel({ rocketName: 'Falcon 9' })
  assert.equal(resolved.slug, 'falcon-9')
  assert.equal(resolved.url, '')
  assert.equal(resolved.source, 'none')
})

test('显式 HTTPS modelUrl 不能绕过未启用型号', () => {
  ingestMediaMap({})
  const resolved = resolveRocketModel({
    rocketName: 'Falcon 9',
    modelUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-9.glb'
  })
  assert.equal(resolved.source, 'none')
  assert.equal(resolved.url, '')
})

test('buildGlbUrl：未启用时不拼 COS 地址', () => {
  ingestMediaMap({})
  assert.equal(buildGlbUrl('starship'), '')
})

test('详情页门控：未 ingest 时星舰也不显示入口', () => {
  ingestMediaMap({})
  assert.equal(hasReadyRocketModelGate({ rocketName: '长征五号' }), false)
  assert.equal(hasReadyRocketModelGate({ rocketName: '星舰' }), false)
  assert.equal(hasReadyRocketModelGate({ rocketName: 'Falcon 9' }), false)
  assert.equal(resolveReadyModelUrl({ rocketName: '星舰' }), '')
})

test('后台 media_assets 启用后，门控与 3D 映射放行该型号', () => {
  ingestMediaMap({
    'models/rockets/falcon-9.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-9.glb?v=9',
    'models/rockets/starship.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb?v=2'
  })
  try {
    assert.equal(hasReadyRocketModelGate({ rocketName: 'Falcon 9' }), true)
    assert.equal(hasReadyRocketModelGate({ rocketName: '星舰' }), true)
    assert.match(resolveReadyModelUrl({ rocketName: '猎鹰9号' }), /falcon-9\.glb/)
    const resolved = resolveRocketModel({ rocketName: 'Falcon 9' })
    assert.equal(resolved.source, 'glb')
    assert.match(resolved.url, /falcon-9\.glb/)
    const starship = resolveRocketModel({ rocketName: 'Starship' })
    assert.equal(starship.source, 'glb')
    assert.ok(starship.url.includes(MODEL_PREFIX + 'starship.glb'))
    assert.equal(hasReadyRocketModel({ rocketName: '星舰' }), true)
    assert.match(buildGlbUrl('starship'), /models\/rockets\/starship\.glb/)
  } finally {
    ingestMediaMap({})
  }
  assert.equal(hasReadyRocketModelGate({ rocketName: 'Falcon 9' }), false)
})

test('捐赠注明随 media map 写入，停用型号后不再保留', () => {
  ingestMediaMap(
    {
      'models/rockets/starship.glb':
        'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb'
    },
    { starship: '模型由张三捐赠' }
  )
  try {
    assert.equal(getReadyCredit('starship'), '模型由张三捐赠')
    assert.equal(getReadyCredit('falcon-9'), '')
  } finally {
    ingestMediaMap({})
  }
  assert.equal(getReadyCredit('starship'), '')
})

test('长征全系列兜底：无专用型号时所有长征任务显示入口，不波及其他火箭', () => {
  ingestMediaMap({
    'models/rockets/long-march-series.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-series.glb'
  })
  try {
    assert.equal(hasReadyRocketModelGate({ rocketName: '长征五号' }), true)
    assert.equal(hasReadyRocketModelGate({ rocketName: '长征七号改' }), true)
    assert.match(resolveReadyModelUrl({ rocketName: '长征七号改' }), /long-march-series\.glb/)
    assert.equal(hasReadyRocketModel({ rocketName: '长征十二号' }), true)
    assert.equal(hasReadyRocketModelGate({ rocketName: 'Falcon 9' }), false)
    assert.equal(hasReadyRocketModelGate({ rocketName: '星舰' }), false)
  } finally {
    ingestMediaMap({})
  }
})

test('长征专用型号权重大于全系列，不覆盖已上传的具体模型', () => {
  ingestMediaMap({
    'models/rockets/long-march-series.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-series.glb',
    'models/rockets/long-march-5.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-5.glb'
  })
  try {
    assert.match(resolveReadyModelUrl({ rocketName: '长征五号' }), /long-march-5\.glb/)
    assert.match(resolveReadyModelUrl({ rocketName: '长征七号改' }), /long-march-series\.glb/)
    const specific = resolveRocketModel({ rocketName: '长征五号' })
    assert.match(specific.url, /long-march-5\.glb/)
    const family = resolveRocketModel({ rocketName: '长征七号改' })
    assert.match(family.url, /long-march-series\.glb/)
    assert.equal(family.series, true)
    assert.equal(specific.series, false)
  } finally {
    ingestMediaMap({})
  }
})

test('pinned slug 与 modelUrl 不一致时以 slug 为准，防止串位', () => {
  ingestMediaMap({
    'models/rockets/falcon-9.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-9.glb',
    'models/rockets/falcon-heavy.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-heavy.glb'
  })
  try {
    const resolved = resolveRocketModel({
      rocketName: '猎鹰9号',
      slug: 'falcon-heavy',
      modelUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-9.glb'
    })
    assert.equal(resolved.slug, 'falcon-heavy')
    assert.match(resolved.url, /falcon-heavy\.glb/)
    assert.doesNotMatch(resolved.url, /falcon-9\.glb/)
  } finally {
    ingestMediaMap({})
  }
})

test('运营删除 media_assets 后，星舰入口也必须消失', () => {
  ingestMediaMap({
    'models/rockets/starship.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb?v=2'
  })
  assert.equal(hasReadyRocketModelGate({ rocketName: '星舰' }), true)
  ingestMediaMap({})
  assert.equal(hasReadyRocketModelGate({ rocketName: '星舰' }), false)
  assert.equal(hasReadyRocketModel({ rocketName: '星舰' }), false)
  assert.equal(resolveReadyModelUrl({ rocketName: '星舰' }), '')
})

test('capPixelRatio：限制高分屏，避免 iOS 显存翻倍', () => {
  assert.equal(capPixelRatio(1), 1)
  assert.equal(capPixelRatio(3), 2)
  assert.equal(capPixelRatio(0), 1)
})

function makeColor(r, g, b) {
  return {
    r,
    g,
    b,
    setRGB: function (nr, ng, nb) {
      this.r = nr
      this.g = ng
      this.b = nb
    }
  }
}

test('exhibitStandRotation：Z-up 猎鹰重型只立起包装，不改网格', () => {
  const fh = exhibitStandRotation({ x: 52.5, y: 21.6, z: 296.8 })
  assert.ok(Math.abs(fh.x + Math.PI / 2) < 1e-6)
  assert.equal(fh.y, 0)
  assert.equal(fh.z, 0)
  const upright = exhibitStandRotation({ x: 4, y: 70, z: 4 })
  assert.equal(upright.x, 0)
  assert.equal(upright.y, 0)
  assert.equal(upright.z, 0)
})

test('pickStandRotationFromSize：任意轴向自动立起，不写死型号', () => {
  const zUp = pickStandRotationFromSize({ x: 12, y: 8, z: 90 })
  assert.ok(Math.abs(zUp.x + Math.PI / 2) < 1e-6, 'Z-up 细长箭应绕 X 立起')
  const xUp = pickStandRotationFromSize({ x: 90, y: 8, z: 12 })
  assert.ok(Math.abs(xUp.z + Math.PI / 2) < 1e-6, 'X-up 细长箭应绕 Z 立起')
  const yUp = pickStandRotationFromSize({ x: 8, y: 90, z: 12 })
  assert.equal(yUp.x, 0)
  assert.equal(yUp.z, 0)
  const board = pickStandRotationFromSize({ x: 80, y: 55, z: 8 })
  assert.ok(Math.abs(board.z + Math.PI / 2) < 1e-6, '横躺展板应绕薄轴立起')
  const uprightBoard = pickStandRotationFromSize({ x: 55, y: 80, z: 8 })
  assert.equal(uprightBoard.x, 0)
  assert.equal(uprightBoard.z, 0)
  const floorBoard = pickStandRotationFromSize({ x: 80, y: 8, z: 55 })
  assert.ok(Math.abs(floorBoard.x + Math.PI / 2) < 1e-6, '平铺展板应立起并对着镜头')
})

test('isUprightExhibitSize：细长箭躺着或对着镜头都不算展陈直立', () => {
  assert.equal(isUprightExhibitSize({ x: 52.5, y: 21.6, z: 296.8 }), false)
  assert.equal(isUprightExhibitSize({ x: 52.5, y: 296.8, z: 21.6 }), true)
  assert.equal(isUprightExhibitSize({ x: 80, y: 55, z: 8 }), false)
  assert.equal(isUprightExhibitSize({ x: 55, y: 80, z: 8 }), true)
  assert.equal(isUprightExhibitSize({ x: 4, y: 70, z: 4 }), true)
  const identity = { x: 0, y: 0, z: 0 }
  const forced = finalizeStandRotation({ x: 52.5, y: 21.6, z: 296.8 }, identity)
  assert.ok(Math.abs(forced.x + Math.PI / 2) < 1e-6, '躺平细长箭必须被纠正成立起')
  const keep = finalizeStandRotation({ x: 4, y: 70, z: 4 }, identity)
  assert.equal(keep.x, 0)
  assert.equal(keep.z, 0)
})

test('scoreStandSize：对着镜头的细长轴要扣分，避免看不见', () => {
  const standing = scoreStandSize({ x: 52, y: 297, z: 22 })
  const needle = scoreStandSize({ x: 52, y: 22, z: 297 })
  assert.ok(standing > needle + 10)
  const faceBoard = scoreStandSize({ x: 80, y: 55, z: 8 })
  const edgeBoard = scoreStandSize({ x: 8, y: 80, z: 55 })
  assert.ok(faceBoard > edgeBoard)
})

test('autoStandRotation：世界盒不随包装转时，猎鹰重型仍按尺寸立起', () => {
  const THREE = createBoxThree()
  const mesh = makeMesh('Object_2', [-26, -10, -198], [26.5, 11.6, 98.6])
  const stand = {
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      set: function (x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    },
    updateMatrixWorld: function () {},
    traverse: function (fn) {
      fn(mesh)
    }
  }
  const rot = autoStandRotation(stand, THREE)
  assert.ok(Math.abs(rot.x + Math.PI / 2) < 1e-6, 'Z-up 单网格必须 -90°X，不能停在躺平')
  assert.equal(rot.z, 0)
})

test('autoStandRotation：已竖直的箭和展板不被改轴', () => {
  const THREE = createBoxThree()
  const f9 = makeMesh('Falcon9', [-2, 0, -2], [2, 70, 2])
  const f9Stand = {
    rotation: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z } },
    updateMatrixWorld: function () {},
    traverse: function (fn) { fn(f9) }
  }
  const f9Rot = autoStandRotation(f9Stand, THREE)
  assert.equal(f9Rot.x, 0)
  assert.equal(f9Rot.z, 0)

  const boardMesh = makeMesh('Series', [-40, 0, -4], [40, 80, 4])
  const boardStand = {
    rotation: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z } },
    updateMatrixWorld: function () {},
    traverse: function (fn) { fn(boardMesh) }
  }
  const boardRot = autoStandRotation(boardStand, THREE)
  assert.equal(boardRot.x, 0)
  assert.equal(boardRot.z, 0)

  const lying = makeMesh('SeriesLie', [-40, 0, -4], [40, 55, 4])
  const lyingStand = {
    rotation: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z } },
    updateMatrixWorld: function () {},
    traverse: function (fn) { fn(lying) }
  }
  const lyingRot = autoStandRotation(lyingStand, THREE)
  assert.ok(Math.abs(lyingRot.z + Math.PI / 2) < 1e-6, '横躺展板仍应立起')
})

test('isNoseDown：顶部更粗判定为倒立', () => {
  const THREE = createBoxThree()
  const fairing = makeMesh('Fairing', [-1.2, 0, -1.2], [1.2, 10, 1.2])
  const body = makeMesh('Stage', [-1.8, 10, -1.8], [1.8, 60, 1.8])
  const engines = makeMesh('Engine', [-3.2, 60, -3.2], [3.2, 70, 3.2])
  const root = {
    traverse: function (fn) {
      fn(fairing)
      fn(body)
      fn(engines)
    },
    updateWorldMatrix: function () {}
  }
  assert.equal(isNoseDown(root, THREE), true)
})

test('exhibitStandRotation：全系列展板绕薄轴立起，不按单箭倾倒', () => {
  const board = exhibitStandRotation({ x: 80, y: 55, z: 8 })
  assert.equal(board.x, 0)
  assert.equal(board.y, 0)
  assert.ok(Math.abs(board.z + Math.PI / 2) < 1e-6)
  assert.equal(board.flip, 'z')
  const uprightBoard = exhibitStandRotation({ x: 55, y: 80, z: 8 })
  assert.equal(uprightBoard.x, 0)
  assert.equal(uprightBoard.y, 0)
  assert.equal(uprightBoard.z, 0)
})

test('adaptViewerTextures：只改采样，不改颜色金属度', () => {
  const mapped = {
    metalness: 0.7,
    color: makeColor(0.2, 0.3, 0.4),
    map: { generateMipmaps: true, minFilter: 9987, image: { width: 64, complete: true } }
  }
  const root = {
    traverse: function (fn) {
      fn({ isMesh: true, material: mapped })
    }
  }
  adaptViewerTextures(root, { LinearFilter: 9729, ClampToEdgeWrapping: 33071, SRGBColorSpace: 'srgb' })
  assert.equal(mapped.metalness, 0.7)
  assert.equal(mapped.color.r, 0.2)
  assert.equal(mapped.map.generateMipmaps, false)
  assert.equal(mapped.map.minFilter, 9729)
})

test('downgradeUint32Index：顶点数未超 65535 时改成 16 位，避免小程序不画', () => {
  const src = new Uint32Array([0, 1, 2, 2, 1, 3])
  const geo = {
    index: { array: src, needsUpdate: false },
    attributes: { position: { count: 4 } },
    setIndex: function (next) {
      this.index = { array: next.array || next, needsUpdate: true }
    }
  }
  downgradeUint32Index(
    {
      traverse: function (fn) {
        fn({ isMesh: true, geometry: geo })
      }
    },
    { BufferAttribute: function (arr) { this.array = arr } }
  )
  assert.equal(geo.index.array.BYTES_PER_ELEMENT, 2)
  assert.equal(geo.index.array.length, 6)
})

test('autoFixExhibitShading：同类上色问题自动纠偏，完整 PBR 不改外观', () => {
  const textureOnly = {
    map: { image: { width: 64, height: 64, complete: true } },
    color: makeColor(0, 0, 0),
    metalness: 1,
    roughness: 0.1,
    emissive: makeColor(0, 0, 0)
  }
  autoFixExhibitShading(textureOnly, { geometry: { attributes: {} } }, { DoubleSide: 2 })
  assert.equal(textureOnly.color.r, 1)
  assert.equal(textureOnly.metalness, 0)
  assert.equal(textureOnly.emissive.r, 0)

  const mirror = {
    color: makeColor(0.02, 0.02, 0.02),
    metalness: 1,
    roughness: 0.05
  }
  autoFixExhibitShading(mirror, { geometry: { attributes: {} } }, { DoubleSide: 2 })
  assert.ok(mirror.color.r > 0.7)
  assert.ok(mirror.metalness <= 0.2)

  const painted = {
    color: makeColor(0.2, 0.25, 0.3),
    metalness: 0.85,
    roughness: 0.35,
    normalMap: { image: { width: 64, height: 64, complete: true } },
    roughnessMap: { image: { width: 64, height: 64, complete: true } }
  }
  autoFixExhibitShading(painted, { geometry: { attributes: {} } }, { DoubleSide: 2 })
  assert.equal(painted.metalness, 0.85)
  assert.equal(painted.color.r, 0.2)

  const vertex = {
    color: makeColor(0, 0, 0),
    metalness: 0.3,
    roughness: 0.5
  }
  autoFixExhibitShading(vertex, { geometry: { attributes: { color: {} } } }, { DoubleSide: 2 })
  assert.equal(vertex.color.r, 1)
  assert.equal(vertex.metalness, 0.3)
})

test('isFragileTextureOnlyModel：猎鹰重型才纠偏，猎鹰9喷漆深色不动', () => {
  const fh = {
    traverse: function (fn) {
      fn({
        isMesh: true,
        material: { map: { image: { width: 64, height: 64, complete: true } }, color: makeColor(0, 0, 0) }
      })
    }
  }
  assert.equal(isFragileTextureOnlyModel(fh), true)
  const f9 = {
    traverse: function (fn) {
      fn({ isMesh: true, material: { map: { image: { width: 64, height: 64, complete: true } } } })
      fn({ isMesh: true, material: { color: makeColor(0.015, 0.015, 0.015), metalness: 0, roughness: 0.99 } })
      fn({ isMesh: true, material: { color: makeColor(0.015, 0.015, 0.015), metalness: 0, roughness: 0.99 } })
    }
  }
  assert.equal(isFragileTextureOnlyModel(f9), false)
})

test('ensureDrawableModel：纯贴图改为 Lambert，完整 PBR 不换材质', () => {
  const map = { image: { width: 64, height: 64, complete: true } }
  const fhMat = {
    map,
    color: makeColor(0, 0, 0),
    metalness: 0,
    roughness: 0.5
  }
  const fhMesh = { isMesh: true, material: fhMat, geometry: { index: null, attributes: {} } }
  function Lambert(opts) {
    this.isLambert = true
    this.map = opts.map
    this.color = opts.color
  }
  ensureDrawableModel(
    {
      traverse: function (fn) {
        fn(fhMesh)
      }
    },
    { DoubleSide: 2, MeshLambertMaterial: Lambert }
  )
  assert.equal(fhMesh.material.isLambert, true)
  assert.equal(fhMesh.material.map, map)
})

test('ensureDrawableModel：猎鹰9式喷漆深色保持原样', () => {
  const black = {
    metalness: 0,
    roughness: 0.99,
    color: makeColor(0.015, 0.015, 0.015),
    needsUpdate: false
  }
  const stage = {
    metalness: 0,
    roughness: 0.5,
    color: makeColor(1, 1, 1),
    map: { image: { width: 64, height: 64, complete: true }, wrapS: 10497, generateMipmaps: true },
    needsUpdate: false
  }
  ensureDrawableModel(
    {
      traverse: function (fn) {
        fn({ isMesh: true, material: black, geometry: { index: null, attributes: {} } })
        fn({ isMesh: true, material: stage, geometry: { index: null, attributes: {} } })
        fn({ isMesh: true, material: { color: makeColor(0.015, 0.015, 0.015) }, geometry: { index: null, attributes: {} } })
      }
    },
    { DoubleSide: 2, MeshLambertMaterial: function () { this.isLambert = true } }
  )
  assert.equal(black.color.r, 0.015)
  assert.equal(black.metalness, 0)
  assert.equal(stage.map.wrapS, 10497)
  assert.equal(stage.map.generateMipmaps, true)
})

test('ensureDrawableModel：纯贴图发黑或索引过宽时改运行时，不改已上色模型', () => {
  const fh = {
    metalness: 0,
    roughness: 0.2,
    color: makeColor(0, 0, 0),
    map: { image: { width: 2, height: 2, complete: true } },
    needsUpdate: false
  }
  ensureDrawableModel(
    {
      traverse: function (fn) {
        fn({ isMesh: true, material: fh, geometry: { index: null, attributes: {} } })
      }
    },
    { DoubleSide: 2 }
  )
  assert.equal(fh.map, null)
  assert.ok(fh.color.r > 0.7)
  assert.equal(fh.side, 2)
})

test('dropBrokenColorMaps：贴图未就绪时去掉坏 map，避免整箭发黑', () => {
  const broken = { map: { image: { width: 0, height: 0, complete: false } }, needsUpdate: false }
  const ok = { map: { image: { width: 64, height: 64, complete: true } }, needsUpdate: false }
  const root = {
    traverse: function (fn) {
      fn({ isMesh: true, material: broken })
      fn({ isMesh: true, material: ok })
    }
  }
  dropBrokenColorMaps(root)
  assert.equal(broken.map, null)
  assert.ok(ok.map)
})

test('prepareModel：不改原始模型材质与缩放', () => {
  const mapped = {
    metalness: 1,
    roughness: 0.1,
    map: {},
    color: makeColor(0, 0, 0)
  }
  const painted = {
    metalness: 0.8,
    roughness: 0.4,
    color: makeColor(0.08, 0.08, 0.1)
  }
  const root = {
    scale: { x: 1 },
    traverse: function (fn) {
      fn({ isMesh: true, material: mapped })
      fn({ isMesh: true, material: painted })
    }
  }
  assert.equal(prepareModel(root), root)
  assert.equal(mapped.metalness, 1)
  assert.equal(mapped.color.r, 0)
  assert.equal(painted.metalness, 0.8)
  assert.equal(painted.color.r, 0.08)
  assert.equal(root.scale.x, 1)
})

function createBoxThree() {
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
  return { Box3, Vector3 }
}

function makeMesh(name, min, max) {
  return {
    isMesh: true,
    visible: true,
    name,
    geometry: {
      boundingBox: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] }
      }
    },
    updateWorldMatrix: function () {},
    matrixWorld: {}
  }
}

test('meshRocketScore：细高箭体高于大方盒子', () => {
  const rocket = meshRocketScore({ x: 12, y: 70, z: 12 })
  const hangar = meshRocketScore({ x: 200, y: 200, z: 200 })
  assert.ok(rocket > hangar)
})

test('getRenderableBox：取箭体而不是巨大机库', () => {
  const THREE = createBoxThree()
  const rocket = makeMesh('FalconHeavy', [-6, 0, -6], [6, 70, 6])
  const hangar = makeMesh('Hangar', [-200, 0, -200], [200, 200, 200])
  const root = {
    traverse: function (fn) {
      fn(rocket)
      fn(hangar)
    },
    updateWorldMatrix: function () {}
  }
  const box = getRenderableBox(root, THREE)
  assert.ok(box.max.y - box.min.y < 80)
  assert.ok(box.max.x - box.min.x < 20)
  assert.equal(hangar.visible, true)
})

test('getRenderableBox：多段箭体把头罩和发动机并进取景盒', () => {
  const THREE = createBoxThree()
  const engines = makeMesh('Merlin', [-1.8, -4, -1.8], [1.8, 0, 1.8])
  const first = makeMesh('FirstStage', [-1.85, 0, -1.85], [1.85, 40, 1.85])
  const second = makeMesh('SecondStage', [-1.85, 40, -1.85], [1.85, 62, 1.85])
  const fairing = makeMesh('Fairing', [-2.4, 62, -2.4], [2.4, 76, 2.4])
  const hangar = makeMesh('Hangar', [-200, -20, -200], [200, 200, 200])
  const root = {
    traverse: function (fn) {
      fn(engines)
      fn(first)
      fn(second)
      fn(fairing)
      fn(hangar)
    },
    updateWorldMatrix: function () {}
  }
  const box = getRenderableBox(root, THREE)
  assert.ok(box.min.y <= -3.5, '发动机底部应进盒')
  assert.ok(box.max.y >= 75, '整流罩顶部应进盒')
  assert.ok(box.max.x - box.min.x < 12, '机库不能并进')
})

test('getRenderableBox：猎鹰重型三芯并排会并进同一取景盒', () => {
  const THREE = createBoxThree()
  const left = makeMesh('CoreL', [-11, 0, -2], [-7, 70, 2])
  const mid = makeMesh('CoreC', [-2, 0, -2], [2, 70, 2])
  const right = makeMesh('CoreR', [7, 0, -2], [11, 70, 2])
  const pad = makeMesh('Pad', [-80, 0, -80], [80, 3, 80])
  const root = {
    traverse: function (fn) {
      fn(left)
      fn(mid)
      fn(right)
      fn(pad)
    },
    updateWorldMatrix: function () {}
  }
  const box = getRenderableBox(root, THREE)
  assert.ok(box.max.x - box.min.x > 18)
  assert.ok(box.max.x - box.min.x < 30)
  assert.ok(box.max.y - box.min.y > 60)
  assert.equal(pad.visible, true)
})

test('getExhibitFrameBox：展板用整模取景，细长箭仍排除机库', () => {
  const THREE = createBoxThree()
  const left = makeMesh('CZ2', [-38, 0, -2], [-34, 52, 2])
  const mid = makeMesh('CZ5', [-2, 0, -2], [2, 52, 2])
  const right = makeMesh('CZ7', [34, 0, -2], [38, 52, 2])
  const board = {
    traverse: function (fn) {
      fn(left)
      fn(mid)
      fn(right)
    },
    updateWorldMatrix: function () {}
  }
  const boardBox = getExhibitFrameBox(board, THREE)
  assert.ok(boardBox.max.x - boardBox.min.x > 70, '展板应对准整排火箭')

  const rocket = makeMesh('Falcon9', [-2, 0, -2], [2, 70, 2])
  const hangar = makeMesh('Hangar', [-200, 0, -200], [200, 200, 200])
  const slim = {
    traverse: function (fn) {
      fn(rocket)
      fn(hangar)
    },
    updateWorldMatrix: function () {}
  }
  const slimBox = getExhibitFrameBox(slim, THREE)
  assert.ok(slimBox.max.x - slimBox.min.x < 20, '单箭仍应排除机库')
  assert.ok(slimBox.max.y - slimBox.min.y > 60)
})

test('3D 页分享 path 只带型号名，不带 modelUrl', () => {
  const {
    buildRocket3dShareQuery,
    buildRocket3dSharePath,
    buildRocket3dShareOptions
  } = require('../subpackages/rocket-3d/share.js')
  const input = {
    rocketName: '星舰',
    rocketNameEn: 'Starship',
    poster: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/rockets/starship.png',
    modelUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb?v=2'
  }
  const query = buildRocket3dShareQuery(input)
  assert.equal(query, 'name=' + encodeURIComponent('星舰') + '&nameEn=Starship')
  assert.equal(buildRocket3dSharePath(input), '/subpackages/rocket-3d/viewer?' + query)
  assert.doesNotMatch(query, /modelUrl/)
  assert.doesNotMatch(query, /poster/)
  const appMsg = buildRocket3dShareOptions(input, 'app')
  assert.equal(appMsg.title, '星舰 3D 模型 | 火星探索日志')
  assert.equal(appMsg.path, '/subpackages/rocket-3d/viewer?' + query)
  assert.equal(appMsg.imageUrl, input.poster)
  const timeline = buildRocket3dShareOptions(input, 'timeline')
  assert.equal(timeline.query, query)
  assert.equal(timeline.imageUrl, input.poster)
})

test('friendlyGlbError：wx.request 失败不把英文原文甩给用户', () => {
  assert.equal(
    friendlyGlbError(new Error('Request failed: request:fail url not in domain list')),
    '模型下载域名未配置'
  )
  assert.equal(friendlyGlbError({ errMsg: 'downloadFile:fail timeout' }), '模型下载超时，请重试')
  assert.match(friendlyGlbError(new Error('Request failed: request:fail')), /下载失败/)
  assert.equal(
    friendlyGlbError(Object.assign(new Error('self is not defined'), { _r3dStage: '装载模型' })),
    '模型装载失败，请重试'
  )
})
