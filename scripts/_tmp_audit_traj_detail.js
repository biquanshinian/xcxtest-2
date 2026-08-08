/**
 * 审计：黄线是否与 space-notices.com 严格一致 + 放大后是否有细节
 * node scripts/_tmp_audit_traj_detail.js
 */
const fs = require('fs')

const full = JSON.parse(fs.readFileSync('scripts/_tmp_site_traj_lonlat.json', 'utf8'))
const pack = JSON.parse(fs.readFileSync('cloudfunctions/spaceNotices/flight13-trajectory.json', 'utf8'))
const slim = pack.coordinates

function segDeg(a, b) {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

function stats(pts, label) {
  const segs = []
  for (let i = 1; i < pts.length; i++) segs.push(segDeg(pts[i - 1], pts[i]))
  const sorted = [...segs].sort((a, b) => b - a)
  const total = segs.reduce((s, v) => s + v, 0)
  console.log(
    `${label}: n=${pts.length} totalLen=${total.toFixed(1)}° maxSeg=${sorted[0].toFixed(3)}° p95=${sorted[
      Math.floor(sorted.length * 0.05)
    ].toFixed(3)}° median=${sorted[Math.floor(sorted.length / 2)].toFixed(5)}°`
  )
  return { maxSeg: sorted[0], total }
}

/** 点到线段距离（度，粗略等距投影） */
function perpDist(p, a, b) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const px = p[0] * k
  const py = p[1]
  const ax = a[0] * k
  const ay = a[1]
  const bx = b[0] * k
  const by = b[1]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 抽稀后相对原始轨迹的最大偏离 */
function maxDeviation(orig, simplified) {
  const set = new Set(simplified.map((p) => `${p[0]},${p[1]}`))
  let worst = 0
  let worstPt = null
  // 对每个原始点，找到 simplified 中相邻的两点段并求垂距
  let si = 0
  for (const p of orig) {
    if (set.has(`${p[0]},${p[1]}`)) {
      // 前进 simplified 指针
      while (si < simplified.length - 1 && `${simplified[si][0]},${simplified[si][1]}` !== `${p[0]},${p[1]}`) si++
      continue
    }
    const a = simplified[Math.min(si, simplified.length - 2)]
    const b = simplified[Math.min(si + 1, simplified.length - 1)]
    const d = perpDist(p, a, b)
    if (d > worst) {
      worst = d
      worstPt = p
    }
  }
  return { worst, worstPt }
}

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

console.log('=== 轨迹审计 ===\n')
stats(full, '站点原始 (site raw)')
stats(slim, '当前包 (current pack)')

const oceanFull = full.filter((p) => p[0] < 100).length
const oceanSlim = slim.filter((p) => p[0] < 100).length
console.log(`\n跨洋段点数: 原始 ${oceanFull} → 当前包 ${oceanSlim}`)
console.log(
  `溅落簇点数: 原始 ${full.length - oceanFull} → 当前包 ${slim.length - oceanSlim} （占比 ${(
    ((slim.length - oceanSlim) / slim.length) *
    100
  ).toFixed(0)}%）`
)

const dev = maxDeviation(full, slim)
console.log(`\n当前包相对原始最大偏离: ${dev.worst.toFixed(3)}° (~${(dev.worst * 111).toFixed(0)} km) @ ${JSON.stringify(dev.worstPt)}`)

console.log('\n--- Douglas-Peucker 候选 ---')
for (const eps of [0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002]) {
  const s = douglasPeucker(full, eps)
  const d = maxDeviation(full, s)
  const ocean = s.filter((p) => p[0] < 100).length
  console.log(
    `eps=${eps}: n=${s.length} 跨洋=${ocean} 溅落=${s.length - ocean} 最大偏离=${d.worst.toFixed(4)}° (~${(
      d.worst * 111
    ).toFixed(1)} km)`
  )
}
