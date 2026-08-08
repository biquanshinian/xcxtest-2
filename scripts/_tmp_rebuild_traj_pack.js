/**
 * 重建 Flight 13 轨迹包：按形状抽稀（Douglas-Peucker），跨洋段保留站点原始点
 * node scripts/_tmp_rebuild_traj_pack.js
 */
const fs = require('fs')

const full = JSON.parse(fs.readFileSync('scripts/_tmp_site_traj_lonlat.json', 'utf8'))

function perpDist(p, a, b) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const px = p[0] * k
  const ax = a[0] * k
  const bx = b[0] * k
  const dx = bx - ax
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, p[1] - a[1])
  let t = ((px - ax) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy))
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

function maxDeviation(orig, simplified) {
  const key = (p) => `${p[0]},${p[1]}`
  const set = new Set(simplified.map(key))
  let si = 0
  let worst = 0
  for (const p of orig) {
    if (set.has(key(p))) {
      while (si < simplified.length - 1 && key(simplified[si]) !== key(p)) si++
      continue
    }
    const a = simplified[Math.min(si, simplified.length - 2)]
    const b = simplified[Math.min(si + 1, simplified.length - 1)]
    const d = perpDist(p, a, b)
    if (d > worst) worst = d
  }
  return worst
}

// 跨洋段（弹道主体）保留站点原始点；溅落簇（船位遥测抖动）按形状抽稀
const SPLASH_LON = 100
const oceanRaw = full.filter((p) => p[0] < SPLASH_LON)
const splashRaw = full.filter((p) => p[0] >= SPLASH_LON)

const splashSlim = douglasPeucker(splashRaw, 0.0004)
const coords = oceanRaw.concat(splashSlim)

console.log('ocean raw', oceanRaw.length, 'splash raw', splashRaw.length, '→ splash slim', splashSlim.length)
console.log('total', coords.length)
console.log('max deviation vs raw', maxDeviation(full, coords).toFixed(5), 'deg')

const out = {
  source: 'space-notices.com embedded Ship 40 / Flight 13 trajectory',
  version: 2,
  color: '#ffcc00',
  pointCount: coords.length,
  fullCount: full.length,
  note: 'cross-ocean segment kept at site resolution; splashdown telemetry simplified (Douglas-Peucker 0.0004deg)',
  coordinates: coords
}

fs.writeFileSync('cloudfunctions/spaceNotices/flight13-trajectory.json', JSON.stringify(out))

// 客户端副本必须是 .js：小程序 require 不支持 .json
const clientBody = [
  '/**',
  ' * SPACE_NOTICES_FEATURE — Flight 13 参考轨迹（客户端兜底副本）',
  ' *',
  ' * 必须是 .js：小程序 require 不支持 .json（会被补成 xxx.json.js 而报 module is not defined），',
  ' * 云函数侧的同源数据仍是 cloudfunctions/spaceNotices/flight13-trajectory.json（Node 环境可直接 require）。',
  ' * 由 scripts/_tmp_rebuild_traj_pack.js 生成，勿手改。',
  ' */',
  '',
  'module.exports = {',
  '  source: ' + JSON.stringify(out.source) + ',',
  '  version: ' + out.version + ',',
  '  color: ' + JSON.stringify(out.color) + ',',
  '  coordinates: [',
  coords.map((c) => '  [' + c[0] + ', ' + c[1] + ']').join(',\n'),
  '  ]',
  '}',
  ''
].join('\n')
fs.writeFileSync('subpackages/monitor-pages/space-notices/utils/flight13-trajectory.js', clientBody)
console.log('written both packs')
