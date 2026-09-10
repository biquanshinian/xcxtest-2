/**
 * node --test test/ip-scale-ref.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MUSK_REAL_HEIGHT_M,
  parseLengthMeters,
  normalizeHighestPoint,
  formatHeightCaption,
  parseIpRefGlbKey,
  isVehicleRef,
  defaultHighestPoint,
  formatMetersCaption,
  CYBER_PICKUP_SPECS,
  shouldShowIpScaleRef,
  computeIpSceneScale,
  computeVehicleSceneScale,
  pickVehicleBehindPeople,
  VEHICLE_BEHIND_M,
  resolveFigureSceneScale,
  ipRefCosKey,
  ipStandingStride,
  ipCoreCenterFromPoints,
  ipCoreFromNamedPoints,
  sortIpFiguresForStand,
  IP_STAND_ORDER,
  xzOverlap,
  ipViewBlocked,
  pickIpStandBesideRocket
} = require('../utils/ip-scale-ref.js')

test('马斯克默认身高 1.88m', () => {
  assert.equal(MUSK_REAL_HEIGHT_M, 1.88)
})

test('parseLengthMeters 吃 exhibit 的「70 m」', () => {
  assert.equal(parseLengthMeters('70 m'), 70)
  assert.equal(parseLengthMeters(124.4), 124.4)
  assert.equal(parseLengthMeters(''), 0)
  assert.equal(parseLengthMeters('x'), 0)
})

test('normalizeHighestPoint 夹在 0.3–5m，缺省回马斯克身高', () => {
  assert.equal(normalizeHighestPoint(1.88), 1.88)
  assert.equal(normalizeHighestPoint(0), 1.88)
  assert.equal(normalizeHighestPoint(9), 5)
  assert.equal(normalizeHighestPoint(0.1), 0.3)
})

test('formatHeightCaption 对齐火箭尺寸写法', () => {
  assert.equal(formatHeightCaption(1.88), '1.88 m')
  assert.equal(formatHeightCaption(2), '2 m')
  assert.equal(formatHeightCaption(null), '1.88 m')
})

test('parseIpRefGlbKey 只认 reference 前缀', () => {
  assert.equal(parseIpRefGlbKey('models/reference/musk.glb'), 'musk')
  assert.equal(parseIpRefGlbKey('models/reference/astro.glb?v=1'), 'astro')
  assert.equal(parseIpRefGlbKey('models/reference/ip-musk.glb'), 'musk')
  assert.equal(parseIpRefGlbKey('models/reference/cyber-pickup.glb'), 'cyber-pickup')
  assert.equal(parseIpRefGlbKey('models/reference/cybertruck.glb'), 'cyber-pickup')
  assert.equal(parseIpRefGlbKey('models/rockets/falcon-9.glb'), '')
})

test('长征全系列 / 家族不放参照，其它火箭放', () => {
  assert.equal(shouldShowIpScaleRef({ series: true, slug: 'falcon-9' }), false)
  assert.equal(shouldShowIpScaleRef({ slug: 'long-march-series' }), false)
  assert.equal(shouldShowIpScaleRef({ slug: 'long-march-5' }), false)
  assert.equal(shouldShowIpScaleRef({ slug: 'falcon-9' }), true)
  assert.equal(shouldShowIpScaleRef({ name: '长征五号' }), false)
  assert.equal(shouldShowIpScaleRef({ slug: 'starship' }), true)
  assert.equal(shouldShowIpScaleRef({ slug: 'new-glenn' }), true)
})

test('等比：70m 箭盒高 70 单位时，1.88m 人像盒高 1.88 → 缩放 1', () => {
  const s = computeIpSceneScale({
    rocketLengthM: 70,
    rocketModelHeight: 70,
    ipModelHeight: 1.88,
    highestPointM: 1.88
  })
  assert.ok(Math.abs(s - 1) < 1e-9)
})

test('等比：70m 箭盒高 10 单位、人像盒高 2 → 人在场景里高 1.88*(10/70)', () => {
  const s = computeIpSceneScale({
    rocketLengthM: 70,
    rocketModelHeight: 10,
    ipModelHeight: 2,
    highestPointM: 1.88
  })
  const target = (1.88 * 10) / 70 / 2
  assert.ok(Math.abs(s - target) < 1e-9)
})

test('缺火箭全长则无法缩放', () => {
  assert.equal(
    computeIpSceneScale({
      rocketLengthM: 0,
      rocketModelHeight: 10,
      ipModelHeight: 2,
      highestPointM: 1.88
    }),
    0
  )
})

test('并排默认共用马斯克标尺，自定义最高点才独立缩放', () => {
  const opts = {
    rocketLengthM: 70,
    rocketModelHeight: 70,
    rulerModelHeight: 2,
    rulerHighestPointM: 1.88
  }
  const shared = resolveFigureSceneScale({ ipModelHeight: 2.4, highestPointM: 1.88 }, opts)
  const musk = resolveFigureSceneScale({ ipModelHeight: 2, highestPointM: 1.88 }, opts)
  assert.ok(Math.abs(shared - musk) < 1e-9)
  const custom = resolveFigureSceneScale({ ipModelHeight: 2.4, highestPointM: 2.1 }, opts)
  const independent = computeIpSceneScale({
    rocketLengthM: 70,
    rocketModelHeight: 70,
    ipModelHeight: 2.4,
    highestPointM: 2.1
  })
  assert.ok(Math.abs(custom - independent) < 1e-9)
  assert.ok(Math.abs(custom - shared) > 1e-9)
})

test('ipRefCosKey', () => {
  assert.equal(ipRefCosKey('musk'), 'models/reference/musk.glb')
  assert.equal(ipRefCosKey('astro'), 'models/reference/astro.glb')
  assert.equal(ipRefCosKey('cyber-pickup'), 'models/reference/cyber-pickup.glb')
  assert.equal(ipRefCosKey('falcon-9'), '')
})

test('落地顺序星问在左、马斯克在右，车辆另算身后', () => {
  assert.deepEqual(IP_STAND_ORDER, ['astro', 'musk', 'cyber-pickup'])
  const sorted = sortIpFiguresForStand([{ slug: 'cyber-pickup' }, { slug: 'musk' }, { slug: 'astro' }])
  assert.deepEqual(sorted.map((item) => item.slug), ['astro', 'musk', 'cyber-pickup'])
})

test('车辆按车长 5.683m 对齐，不把长边当成身高', () => {
  assert.equal(VEHICLE_BEHIND_M, 2)
  const opts = { rocketLengthM: 70, rocketModelHeight: 70 }
  const real = computeVehicleSceneScale(
    { slug: 'cyber-pickup', lengthM: 5.683, highestPointM: 1.794, modelSize: { x: 5.683, y: 1.794, z: 2.032 } },
    opts
  )
  assert.ok(Math.abs(real - 1) < 1e-9)
  const gameAsset = computeVehicleSceneScale(
    { slug: 'cyber-pickup', lengthM: 5.683, highestPointM: 1.794, modelSize: { x: 1, y: 0.32, z: 0.36 } },
    opts
  )
  assert.ok(Math.abs(gameAsset - 5.683) < 1e-9)
  const longOnZ = computeVehicleSceneScale(
    { slug: 'cyber-pickup', lengthM: 5.683, highestPointM: 1.794, modelSize: { x: 0.36, y: 0.32, z: 1 } },
    opts
  )
  assert.ok(Math.abs(longOnZ - 5.683) < 1e-9)
  const wrongOld = 1.794 / 1
  assert.ok(Math.abs(longOnZ - wrongOld) > 3, '旧算法会把车缩到和身高一样长')
})

test('车辆停在两个 IP 身后 2 米净空', () => {
  const people = { minX: 8, maxX: 12, minZ: -0.4, maxZ: 0.4, midX: 10.2, midZ: 0 }
  const truck = { x: 5.683, z: 2.032 }
  const stand = pickVehicleBehindPeople({
    people,
    truck,
    gapM: 2,
    metersPerUnit: 1,
    camera: { x: 10, z: 20 }
  })
  assert.equal(stand.behind, true)
  assert.ok(Math.abs(stand.x - 10.2) < 1e-9, '应锁在两人站位中线')
  assert.ok(stand.z < people.minZ, '应在镜头更远处、人的背后')
  const gap = people.minZ - (stand.z + truck.z / 2)
  assert.ok(Math.abs(gap - 2) < 0.05, '人背后到车头净空应约 2 米，实际 ' + gap)
})

test('正面镜头偏在火箭一侧时，车也不往左偏', () => {
  const people = { minX: 7, maxX: 13, minZ: -0.4, maxZ: 0.4, midX: 10.4, midZ: 0 }
  const stand = pickVehicleBehindPeople({
    people,
    truck: { x: 5.683, z: 2.032 },
    gapM: 2,
    metersPerUnit: 1,
    camera: { x: 0, z: 24 }
  })
  assert.ok(Math.abs(stand.x - 10.4) < 1e-9, '正面看应仍在两人中间，实际 x=' + stand.x)
  assert.ok(stand.z < 0)
})

test('赛博皮卡按车主手册标注，不跟马斯克标尺', () => {
  assert.equal(isVehicleRef('cyber-pickup'), true)
  assert.equal(isVehicleRef('musk'), false)
  assert.equal(defaultHighestPoint('cyber-pickup'), CYBER_PICKUP_SPECS.heightM)
  assert.equal(CYBER_PICKUP_SPECS.lengthM, 5.683)
  assert.equal(CYBER_PICKUP_SPECS.widthM, 2.032)
  assert.equal(CYBER_PICKUP_SPECS.heightM, 1.794)
  assert.equal(formatMetersCaption(5.683), '5.683 m')
  assert.equal(formatMetersCaption(1.794), '1.794 m')
})

test('骨骼中心只认躯干，手臂和道具骨骼不算', () => {
  const core = ipCoreFromNamedPoints([
    { name: 'mixamorig:Hips', x: 0, y: 0.9, z: 0 },
    { name: 'mixamorig:Spine', x: 0.02, y: 1.1, z: 0 },
    { name: 'mixamorig:RightHand', x: -1.1, y: 1.6, z: 0 },
    { name: 'mixamorig:LeftHand', x: 0.9, y: 0.9, z: 0.1 },
    { name: 'star_prop', x: 0.95, y: 0.85, z: 0.2 }
  ])
  assert.ok(core)
  assert.equal(core.from, 'torso')
  assert.ok(Math.abs(core.x) < 0.03)
})

test('不对称举手和装饰件不能把身体中心拽偏', () => {
  const pts = []
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2
    const b = (i % 18) / 18 * Math.PI
    pts.push({
      x: Math.sin(b) * Math.cos(a) * 0.32,
      y: 0.9 + Math.cos(b) * 0.32,
      z: Math.sin(b) * Math.sin(a) * 0.32
    })
  }
  for (let h = 0; h < 18; h++) pts.push({ x: -1.05, y: 1.55, z: 0.02 * h })
  for (let s = 0; s < 18; s++) pts.push({ x: 0.92, y: 0.85, z: 0.04 * s })
  const core = ipCoreCenterFromPoints(pts)
  const boxMidX = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2
  assert.ok(core)
  assert.ok(Math.abs(core.x) < 0.08, '身体中心应在球心，不在整模包围盒')
  assert.ok(Math.abs(boxMidX) > 0.04, '对照：整模包围盒确实被手脚拽偏')
  assert.ok(Math.abs(core.x - boxMidX) > 0.03)
})

test('并排步长跟举手跨度走，留出身位缝也不加火箭缝', () => {
  const wave = ipStandingStride({ x: 1.8, y: 1.88, z: 0.4 })
  assert.ok(wave.step > 1.8, '举手姿态中心距太近会穿模')
  assert.ok(wave.gap >= 1.88 * 0.45, '两人要留出身位缝')
  assert.ok(wave.step < 1.8 + 1.88 * 0.7, '不能再加一整臂火箭缝')
  const slim = ipStandingStride({ x: 0.4, y: 1.88, z: 0.35 })
  assert.ok(slim.step >= 1.88 * 0.4)
  assert.ok(slim.step < wave.step)
  const wide = ipStandingStride({ x: 4, y: 1.88, z: 3 })
  assert.ok(wide.step > wave.step)
  assert.equal(ipStandingStride({ x: 2, y: 0, z: 2 }).step, 0)
  const truck = ipStandingStride({ x: 5.683, y: 1.794, z: 2.032 }, 'cyber-pickup')
  assert.ok(Math.abs(truck.bodyW - 5.683) < 1e-6)
  assert.ok(truck.gap < 1.2, '车辆应紧跟两个 IP，不按举手跨度拉开')
  assert.ok(truck.step > 5.683)
})

test('胖箭侧面会被镜头挡住，站位必须外推到不重叠也不遮挡', () => {
  const rocket = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  const stride = ipStandingStride({ x: 1.8, y: 1.88, z: 0.4 })
  const pairW = stride.step + stride.bodyW
  const pairD = stride.bodyW * 0.72
  const bodyW = stride.bodyW
  const cam = { x: 0, z: 40 }
  assert.equal(xzOverlap({ minX: 10.2, maxX: 11.2, minZ: -0.2, maxZ: 0.2 }, rocket), false)
  assert.equal(ipViewBlocked(cam, 11, 0, rocket), true)
  assert.equal(ipViewBlocked(cam, 12.2, 12.2, rocket), false)
  const stand = pickIpStandBesideRocket({
    rocket,
    pairW,
    pairD,
    bodyW,
    camera: cam
  })
  assert.equal(stand.overlap, false)
  assert.equal(stand.occluded, false)
  const fp = {
    minX: stand.pairX - pairW / 2,
    maxX: stand.pairX + pairW / 2,
    minZ: stand.pairZ - pairD / 2,
    maxZ: stand.pairZ + pairD / 2
  }
  assert.equal(xzOverlap(fp, rocket), false)
  assert.equal(ipViewBlocked(cam, stand.pairX, stand.pairZ, rocket), false)
  assert.ok(stand.pairX > 10 || stand.pairZ > 10, '胖箭还应站在船体之外')
})

test('瘦箭可以贴在侧面，不必被赶到镜头正前方', () => {
  const rocket = { minX: -0.4, maxX: 0.4, minZ: -0.4, maxZ: 0.4 }
  const stand = pickIpStandBesideRocket({
    rocket,
    pairW: 0.56,
    pairD: 0.2,
    bodyW: 0.49,
    camera: { x: 0, z: 8 }
  })
  assert.equal(stand.overlap, false)
  assert.equal(stand.occluded, false)
  assert.ok(stand.x > 0.4)
  assert.ok(Math.abs(stand.z) < 0.8, '瘦箭不该被赶到远处')
})
