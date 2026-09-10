/**
 * 3D 页 IP 身高参照：以马斯克真实身高为标尺，把 Q 版人像
 * 按火箭全长（米）与模型包围盒做等比，站到箭体旁边。
 * 长征全系列（含成员回落底模、家族型号）不放参照。
 */
const { SERIES_SLUG, isLongMarchMemberSlug, isLongMarchFamilyName } = require('./rocket-3d-slug.js')

const MUSK_REAL_HEIGHT_M = 1.88
const IP_REF_PREFIX = 'models/reference/'
const IP_SLUGS = ['musk', 'astro', 'cyber-pickup']
/** 落地从左到右：星问、马斯克，车辆在两个 IP 后面。目录仍以马斯克为标尺。 */
const IP_STAND_ORDER = ['astro', 'musk', 'cyber-pickup']
const VEHICLE_SLUGS = ['cyber-pickup']
/**
 * 赛博皮卡标注用特斯拉 Cybertruck 车主手册（量产皮卡）：
 * 长 5682.9 mm，宽 2031.6 mm（不含后视镜），高 1793.8 mm（中等气悬）。
 * https://www.tesla.com/ownersmanual/cybertruck/en_us/GUID-12A976DD-EB60-431B-AFF1-5A37E95006DB.html
 */
const CYBER_PICKUP_SPECS = {
  slug: 'cyber-pickup',
  lengthM: 5.683,
  widthM: 2.032,
  heightM: 1.794,
  wheelbaseM: 3.635
}
/** 车辆停在两个 IP 背后的净空（米）。 */
const VEHICLE_BEHIND_M = 2

function parseLengthMeters(raw) {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return raw > 0 && isFinite(raw) ? raw : 0
  const m = String(raw)
    .replace(/,/g, '')
    .match(/(\d+(?:\.\d+)?)/)
  const n = m ? Number(m[1]) : 0
  return n > 0 && isFinite(n) ? n : 0
}

function normalizeHighestPoint(raw, fallback) {
  const n = Number(raw)
  if (isFinite(n) && n > 0) {
    const clamped = Math.min(5, Math.max(0.3, n))
    return Math.round(clamped * 1000) / 1000
  }
  const fb = Number(fallback)
  return isFinite(fb) && fb > 0 ? fb : MUSK_REAL_HEIGHT_M
}

/** 3D 尺寸标签：与火箭「70 m」同一写法。 */
function formatHeightCaption(raw, fallback) {
  const n = normalizeHighestPoint(raw, fallback)
  if (!(n > 0)) return ''
  if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + ' m'
  return String(n) + ' m'
}

function formatMetersCaption(raw) {
  const n = Number(raw)
  if (!(n > 0) || !isFinite(n)) return ''
  const rounded = Math.round(n * 1000) / 1000
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return Math.round(rounded) + ' m'
  return String(rounded) + ' m'
}

function isVehicleRef(slug) {
  return VEHICLE_SLUGS.indexOf(String(slug || '').toLowerCase()) >= 0
}

function defaultHighestPoint(slug) {
  return isVehicleRef(slug) ? CYBER_PICKUP_SPECS.heightM : MUSK_REAL_HEIGHT_M
}

function getVehicleSpecs(slug) {
  return String(slug || '').toLowerCase() === CYBER_PICKUP_SPECS.slug ? CYBER_PICKUP_SPECS : null
}

function normalizeLengthM(raw, fallback) {
  const n = Number(raw)
  if (isFinite(n) && n > 0) {
    return Math.round(Math.min(15, Math.max(1, n)) * 1000) / 1000
  }
  const fb = Number(fallback)
  return isFinite(fb) && fb > 0 ? fb : CYBER_PICKUP_SPECS.lengthM
}

function normalizeWidthM(raw, fallback) {
  const n = Number(raw)
  if (isFinite(n) && n > 0) {
    return Math.round(Math.min(6, Math.max(0.5, n)) * 1000) / 1000
  }
  const fb = Number(fallback)
  return isFinite(fb) && fb > 0 ? fb : CYBER_PICKUP_SPECS.widthM
}

function resolveVehicleDims(fig) {
  const item = fig && typeof fig === 'object' ? fig : {}
  const spec = getVehicleSpecs(item.slug) || CYBER_PICKUP_SPECS
  return {
    heightM: normalizeHighestPoint(item.highestPointM != null ? item.highestPointM : item.highestPoint, spec.heightM),
    lengthM: normalizeLengthM(item.lengthM, spec.lengthM),
    widthM: normalizeWidthM(item.widthM, spec.widthM)
  }
}

function parseIpRefGlbKey(key) {
  const m = /^models\/reference\/([a-z0-9]+(?:-[a-z0-9]+)*)\.glb$/i.exec(
    String(key || '').split('?')[0]
  )
  if (!m) return ''
  const slug = m[1].toLowerCase()
  if (slug === 'ip-musk') return 'musk'
  if (slug === 'ip-astro' || slug === 'astronaut') return 'astro'
  if (slug === 'cybertruck' || slug === 'cyber-truck') return 'cyber-pickup'
  if (IP_SLUGS.indexOf(slug) >= 0) return slug
  return ''
}

function shouldShowIpScaleRef(input) {
  const src = input && typeof input === 'object' ? input : {}
  if (src.series) return false
  const slug = String(src.slug || '').toLowerCase()
  if (!slug) {
    return !isLongMarchFamilyName(src.name || src.rocketName || src.rocketNameEn || '')
  }
  if (slug === SERIES_SLUG) return false
  if (isLongMarchMemberSlug(slug)) return false
  if (isLongMarchFamilyName(src.name || src.rocketName || src.rocketNameEn || '')) return false
  return true
}

/**
 * 把「人物真实身高」映射到火箭模型空间。
 * rocketLengthM / rocketModelHeight = 每模型单位对应的米。
 */
function computeIpSceneScale(opts) {
  const src = opts && typeof opts === 'object' ? opts : {}
  const rocketLengthM = parseLengthMeters(src.rocketLengthM)
  const rocketModelH = Number(src.rocketModelHeight)
  const ipModelH = Number(src.ipModelHeight)
  const realH = normalizeHighestPoint(src.highestPointM, MUSK_REAL_HEIGHT_M)
  if (!(rocketLengthM > 0) || !(rocketModelH > 0) || !(ipModelH > 0) || !(realH > 0)) return 0
  const metersPerUnit = rocketLengthM / rocketModelH
  const targetSceneH = realH / metersPerUnit
  return targetSceneH / ipModelH
}

/** 车辆按车长对齐到真实米制，不用 max(y,z) 当身高（那会把车长缩成 1.8 米）。 */
function computeVehicleSceneScale(fig, opts) {
  const item = fig && typeof fig === 'object' ? fig : {}
  const src = opts && typeof opts === 'object' ? opts : {}
  const rocketLengthM = parseLengthMeters(src.rocketLengthM)
  const rocketModelH = Number(src.rocketModelHeight)
  if (!(rocketLengthM > 0) || !(rocketModelH > 0)) return 0
  const metersPerUnit = rocketLengthM / rocketModelH
  const dims = resolveVehicleDims(item)
  const size = item.modelSize && typeof item.modelSize === 'object' ? item.modelSize : null
  const sx = Number(size && size.x) || 0
  const sy = Number(size && size.y) || 0
  const sz = Number(size && size.z) || 0
  const along = Math.max(sx, sz)
  if (along > 0 && dims.lengthM > 0) {
    return dims.lengthM / metersPerUnit / along
  }
  const hy = sy > 0 ? sy : Number(item.ipModelHeight)
  if (hy > 0 && dims.heightM > 0) {
    return dims.heightM / metersPerUnit / hy
  }
  return 0
}

function peopleBoxHalfAlong(people, dx, dz) {
  const pW = Math.max(0, Number(people && people.maxX) - Number(people && people.minX) || 0)
  const pD = Math.max(0, Number(people && people.maxZ) - Number(people && people.minZ) || 0)
  return (Math.abs(dx) * pW + Math.abs(dz) * pD) * 0.5
}

function truckBoxHalfAlong(truck, dx, dz) {
  const tW = Math.max(0, Number(truck && truck.x) || 0)
  const tD = Math.max(0, Number(truck && truck.z) || 0)
  return (Math.abs(dx) * tW + Math.abs(dz) * tD) * 0.5
}

/**
 * 车辆中心：锁在两人站位中线，只沿纵深退后 gapM 米。
 * 不用镜头射线，否则正面看会往火箭那边偏。
 */
function pickVehicleBehindPeople(opts) {
  const src = opts && typeof opts === 'object' ? opts : {}
  const people = src.people
  const truck = src.truck
  const metersPerUnit = Number(src.metersPerUnit)
  const gapM = Number(src.gapM) > 0 ? Number(src.gapM) : VEHICLE_BEHIND_M
  if (!people || !truck || !(metersPerUnit > 0)) {
    return { x: 0, z: 0, behind: false }
  }
  const boxMidX = (Number(people.minX) + Number(people.maxX)) / 2
  const boxMidZ = (Number(people.minZ) + Number(people.maxZ)) / 2
  const pcx = isFinite(Number(people.midX)) ? Number(people.midX) : boxMidX
  const pcz = isFinite(Number(people.midZ)) ? Number(people.midZ) : boxMidZ
  const tW = Math.max(0, Number(truck.x) || 0)
  const tD = Math.max(0, Number(truck.z) || 0)
  const gap = gapM / metersPerUnit
  const cam = src.camera
  let dirZ = -1
  if (cam && isFinite(Number(cam.z))) {
    dirZ = pcz - Number(cam.z)
    dirZ = dirZ > 0 ? 1 : -1
  }
  function centerAt(dz) {
    const dist = peopleBoxHalfAlong(people, 0, dz) + gap + truckBoxHalfAlong(truck, 0, dz)
    return { x: pcx, z: pcz + dz * dist }
  }
  function overlapsRocket(c) {
    if (!src.rocket) return false
    return xzOverlap(
      {
        minX: c.x - tW / 2,
        maxX: c.x + tW / 2,
        minZ: c.z - tD / 2,
        maxZ: c.z + tD / 2
      },
      src.rocket,
      0
    )
  }
  const a = centerAt(dirZ)
  if (!overlapsRocket(a)) return { x: a.x, z: a.z, behind: true }
  const b = centerAt(-dirZ)
  if (!overlapsRocket(b)) return { x: b.x, z: b.z, behind: true }
  return { x: a.x, z: a.z, behind: true }
}

function resolveFigureSceneScale(fig, opts) {
  const item = fig && typeof fig === 'object' ? fig : {}
  const src = opts && typeof opts === 'object' ? opts : {}
  if (isVehicleRef(item.slug)) return computeVehicleSceneScale(item, src)
  const rulerModelH = Number(src.rulerModelHeight)
  const rulerReal = normalizeHighestPoint(src.rulerHighestPointM, MUSK_REAL_HEIGHT_M)
  const figReal = normalizeHighestPoint(item.highestPointM, rulerReal)
  const shared =
    rulerModelH > 0 && Math.abs(figReal - rulerReal) < 1e-6
      ? computeIpSceneScale({
          rocketLengthM: src.rocketLengthM,
          rocketModelHeight: src.rocketModelHeight,
          ipModelHeight: rulerModelH,
          highestPointM: rulerReal
        })
      : 0
  if (shared > 0) return shared
  return computeIpSceneScale({
    rocketLengthM: src.rocketLengthM,
    rocketModelHeight: src.rocketModelHeight,
    ipModelHeight: item.ipModelHeight,
    highestPointM: figReal
  })
}

function ipRefCosKey(slug) {
  const key = String(slug || '').toLowerCase()
  return IP_SLUGS.indexOf(key) >= 0 ? IP_REF_PREFIX + key + '.glb' : ''
}

function ipStandRank(slug) {
  const i = IP_STAND_ORDER.indexOf(String(slug || '').toLowerCase())
  return i < 0 ? IP_STAND_ORDER.length : i
}

function sortIpFiguresForStand(list) {
  const src = Array.isArray(list) ? list.slice() : []
  src.sort(function (a, b) {
    const sa = a && (a.slug || a)
    const sb = b && (b.slug || b)
    return ipStandRank(sa) - ipStandRank(sb)
  })
  return src
}

function medianAxis(values) {
  const list = Array.isArray(values) ? values.filter((n) => isFinite(n)).sort((a, b) => a - b) : []
  if (!list.length) return NaN
  const mid = Math.floor(list.length / 2)
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) * 0.5
}

function percentileAxis(sorted, q) {
  if (!sorted || !sorted.length) return NaN
  if (sorted.length === 1) return sorted[0]
  const t = Math.max(0, Math.min(1, Number(q) || 0)) * (sorted.length - 1)
  const i = Math.floor(t)
  const f = t - i
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * f
}

/**
 * 星问这种不对称 Q 版：举手和星星会把整模包围盒心拽偏。
 * 只用躯干高度带里的顶点中位数当身体中心。
 */
const IP_CORE_SKIP_RE = /hand|arm|finger|wrist|thumb|index|middle|ring|pinky|leg|foot|toe|star|prop|item|weapon|手|臂|指|脚|星/i
const IP_CORE_TORSO_RE = /hip|pelvis|spine|chest|torso|body|waist|root|belly|肚|腰|胸|身|髋|脊/i
const IP_CORE_HEAD_RE = /head|neck|helmet|skull|头|颈|盔/i

function ipCoreFromNamedPoints(items) {
  const list = Array.isArray(items) ? items : []
  const torso = []
  const heads = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (!it || !isFinite(it.x) || !isFinite(it.y) || !isFinite(it.z)) continue
    const name = String(it.name || '')
    if (IP_CORE_SKIP_RE.test(name)) continue
    if (IP_CORE_HEAD_RE.test(name)) heads.push(it)
    else if (IP_CORE_TORSO_RE.test(name)) torso.push(it)
  }
  const use = torso.length ? torso : heads
  if (!use.length) return null
  let x = 0
  let y = 0
  let z = 0
  for (let j = 0; j < use.length; j++) {
    x += use[j].x
    y += use[j].y
    z += use[j].z
  }
  const n = use.length
  return { x: x / n, y: y / n, z: z / n, from: torso.length ? 'torso' : 'head' }
}

function ipCoreCenterFromPoints(points) {
  const list = Array.isArray(points) ? points : []
  let minY = Infinity
  let maxY = -Infinity
  const finite = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue
    finite.push(p)
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!finite.length || !(maxY > minY)) return null
  const h = maxY - minY
  const y0 = minY + h * 0.22
  const y1 = minY + h * 0.78
  const band = []
  for (let j = 0; j < finite.length; j++) {
    const q = finite[j]
    if (q.y >= y0 && q.y <= y1) band.push(q)
  }
  const use = band.length >= 12 ? band : finite
  const xs = []
  const ys = []
  const zs = []
  for (let k = 0; k < use.length; k++) {
    xs.push(use[k].x)
    ys.push(use[k].y)
    zs.push(use[k].z)
  }
  const x = medianAxis(xs)
  const y = medianAxis(ys)
  const z = medianAxis(zs)
  if (![x, y, z].every(isFinite)) return null
  const t0 = minY + h * 0.34
  const t1 = minY + h * 0.7
  const torsoX = []
  const torsoZ = []
  for (let t = 0; t < use.length; t++) {
    const p = use[t]
    if (p.y < t0 || p.y > t1) continue
    torsoX.push(p.x)
    torsoZ.push(p.z)
  }
  const hx = (torsoX.length >= 8 ? torsoX : xs).slice().sort((a, b) => a - b)
  const hz = (torsoZ.length >= 8 ? torsoZ : zs).slice().sort((a, b) => a - b)
  const xSpan = Math.max(percentileAxis(hx, 0.86) - percentileAxis(hx, 0.14), 0)
  const zSpan = Math.max(percentileAxis(hz, 0.86) - percentileAxis(hz, 0.14), 0)
  return {
    x,
    y,
    z,
    bodyW: Math.max(xSpan, h * 0.34),
    bodyD: Math.max(zSpan, h * 0.34),
    minY,
    maxY
  }
}

/**
 * 并排步长：占位跟水平跨度走（举手 Y 字会很宽），再留一身位缝。
 * 只认身高会叠进半个身子；整臂展再加火箭高度又会拉开一臂。
 */
function ipStandingStride(size, slug) {
  const h = Number(size && size.y)
  if (isVehicleRef(slug)) {
    const along = Number(size && size.x) || 0
    if (!(along > 0) && !(h > 0)) return { bodyW: 0, gap: 0, step: 0 }
    const bodyW = Math.max(along, h > 0 ? h * 0.5 : 0)
    const gap = Math.max(h > 0 ? h * 0.42 : 0.72, 0.72)
    return { bodyW, gap, step: bodyW + gap }
  }
  if (!(h > 0) || !isFinite(h)) return { bodyW: 0, gap: 0, step: 0 }
  const span = Math.max(Number(size.x) || 0, Number(size.z) || 0)
  const bodyW = Math.max(h * 0.4, span * 0.86)
  const gap = Math.max(h * 0.52, span * 0.46)
  return { bodyW, gap, step: bodyW + gap }
}

function xzOverlap(a, b, pad) {
  const p = Math.max(0, Number(pad) || 0)
  if (!a || !b) return false
  return (
    a.minX < b.maxX + p &&
    a.maxX > b.minX - p &&
    a.minZ < b.maxZ + p &&
    a.maxZ > b.minZ - p
  )
}

function xzContains(box, x, z) {
  if (!box) return false
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ
}

/** 镜头→人的开线段是否穿过火箭水平盒。镜头已经在盒里不算挡。 */
function segmentHitsXZ(x0, z0, x1, z1, box) {
  if (!box) return false
  const dx = x1 - x0
  const dz = z1 - z0
  let tmin = 0
  let tmax = 1
  function slab(p, d, min, max) {
    if (Math.abs(d) < 1e-12) return p >= min && p <= max
    const t1 = (min - p) / d
    const t2 = (max - p) / d
    tmin = Math.max(tmin, Math.min(t1, t2))
    tmax = Math.min(tmax, Math.max(t1, t2))
    return tmin <= tmax
  }
  if (!slab(x0, dx, box.minX, box.maxX)) return false
  if (!slab(z0, dz, box.minZ, box.maxZ)) return false
  return tmax > 0 && tmin < 1
}

function ipViewBlocked(cam, ipX, ipZ, rocket) {
  if (!cam || !rocket) return false
  if (xzContains(rocket, cam.x, cam.z)) return false
  return segmentHitsXZ(cam.x, cam.z, ipX, ipZ, rocket)
}

function ipStandClearance(rocket, stride) {
  const w = Math.max(0, Number(rocket && rocket.maxX) - Number(rocket && rocket.minX) || 0)
  const d = Math.max(0, Number(rocket && rocket.maxZ) - Number(rocket && rocket.minZ) || 0)
  const bodyW = Number(stride && stride.bodyW) || 0
  return Math.max(bodyW * 0.55, Math.max(w, d) * 0.045, 0.02)
}

function pairFootprintXZ(pairX, pairZ, pairW, pairD) {
  return {
    minX: pairX - pairW / 2,
    maxX: pairX + pairW / 2,
    minZ: pairZ - pairD / 2,
    maxZ: pairZ + pairD / 2
  }
}

/**
 * 火箭与参照人是两套模型：按船体水平盒做碰撞/遮挡预测，选出能看见且不重叠的并排锚点。
 * 瘦箭可贴在侧面；胖箭/助推器会把侧面挡住，就外推或改到镜头前方的角落。
 */
function pickIpStandBesideRocket(opts) {
  const src = opts && typeof opts === 'object' ? opts : {}
  const rocket = src.rocket
  const pairW = Number(src.pairW)
  const pairD = Number(src.pairD)
  const bodyW = Number(src.bodyW) > 0 ? Number(src.bodyW) : pairD
  if (!rocket || !(pairW > 0) || !(pairD > 0) || !isFinite(pairW) || !isFinite(pairD)) {
    return { x: 0, z: 0, pairX: 0, pairZ: 0, overlap: true, occluded: true }
  }
  const pad0 = ipStandClearance(rocket, { bodyW })
  const rcx = (Number(rocket.minX) + Number(rocket.maxX)) / 2
  const rcz = (Number(rocket.minZ) + Number(rocket.maxZ)) / 2
  const spanX = Math.max(Number(rocket.maxX) - Number(rocket.minX), 1)
  const spanZ = Math.max(Number(rocket.maxZ) - Number(rocket.minZ), 1)
  const cam =
    src.camera && isFinite(src.camera.x) && isFinite(src.camera.z)
      ? { x: Number(src.camera.x), z: Number(src.camera.z) }
      : { x: rcx + spanX * 0.5, z: rcz + spanZ * 2.15 }

  const zTries = [
    rcz,
    rcz + (Number(rocket.maxZ) - rcz) * 0.55,
    rcz - (rcz - Number(rocket.minZ)) * 0.55,
    Number(rocket.maxZ) + pad0 + pairD * 0.5,
    Number(rocket.minZ) - pad0 - pairD * 0.5
  ]
  const padTries = [pad0, pad0 * 1.8, pad0 * 3, pad0 * 5]

  let best = null
  let bestScore = -1e12

  function consider(pairX, pairZ) {
    if (!isFinite(pairX) || !isFinite(pairZ)) return
    const fp = pairFootprintXZ(pairX, pairZ, pairW, pairD)
    const overlap = xzOverlap(fp, rocket, 0)
    const occluded = ipViewBlocked(cam, pairX, pairZ, rocket)
    const dist = Math.hypot(pairX - rcx, pairZ - rcz)
    let score = 0
    if (!overlap) score += 240
    if (!occluded) score += 180
    const viewX = rcx - cam.x
    const viewZ = rcz - cam.z
    if (viewX * (pairZ - rcz) - viewZ * (pairX - rcx) > 0) score += 28
    if ((pairX - rcx) * (cam.x - rcx) + (pairZ - rcz) * (cam.z - rcz) < 0) score -= 90
    if (Math.abs(pairX - rcx) < pairW * 0.4 && pairZ > rcz) score -= 36
    score -= dist * 3
    if (score <= bestScore) return
    bestScore = score
    best = {
      x: pairX - pairW / 2 + bodyW / 2,
      z: pairZ,
      pairX,
      pairZ,
      overlap,
      occluded,
      score
    }
  }

  for (let p = 0; p < padTries.length; p++) {
    const pad = padTries[p]
    for (let i = 0; i < zTries.length; i++) {
      consider(Number(rocket.maxX) + pad + pairW / 2, zTries[i])
      consider(Number(rocket.minX) - pad - pairW / 2, zTries[i])
    }
    consider(Number(rocket.maxX) + pad + pairW / 2, Number(rocket.maxZ) + pad + pairD / 2)
    consider(Number(rocket.minX) - pad - pairW / 2, Number(rocket.maxZ) + pad + pairD / 2)
  }

  return (
    best || {
      x: Number(rocket.maxX) + pad0 + bodyW / 2,
      z: rcz,
      pairX: Number(rocket.maxX) + pad0 + pairW / 2,
      pairZ: rcz,
      overlap: true,
      occluded: true
    }
  )
}

module.exports = {
  MUSK_REAL_HEIGHT_M,
  CYBER_PICKUP_SPECS,
  VEHICLE_BEHIND_M,
  IP_REF_PREFIX,
  IP_SLUGS,
  IP_STAND_ORDER,
  VEHICLE_SLUGS,
  parseLengthMeters,
  normalizeHighestPoint,
  defaultHighestPoint,
  isVehicleRef,
  getVehicleSpecs,
  normalizeLengthM,
  normalizeWidthM,
  resolveVehicleDims,
  formatHeightCaption,
  formatMetersCaption,
  parseIpRefGlbKey,
  shouldShowIpScaleRef,
  computeIpSceneScale,
  computeVehicleSceneScale,
  pickVehicleBehindPeople,
  resolveFigureSceneScale,
  ipRefCosKey,
  ipStandRank,
  sortIpFiguresForStand,
  ipCoreCenterFromPoints,
  ipCoreFromNamedPoints,
  ipStandingStride,
  xzOverlap,
  segmentHitsXZ,
  ipViewBlocked,
  ipStandClearance,
  pickIpStandBesideRocket
}
