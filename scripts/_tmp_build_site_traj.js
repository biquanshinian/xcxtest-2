const https = require('https')
const fs = require('fs')

function get(u) {
  return new Promise((res, rej) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let d = ''
      r.setEncoding('utf8')
      r.on('data', (c) => (d += c))
      r.on('end', () => res(d))
    }).on('error', rej)
  })
}

/** Douglas-Peucker-ish: keep every Nth + endpoints; denser near ends */
function downsample(pts, target) {
  if (pts.length <= target) return pts
  const out = [pts[0]]
  const n = pts.length
  // more samples in first/last 15%
  const head = Math.floor(n * 0.15)
  const tail = Math.floor(n * 0.15)
  const mid = n - head - tail
  const headN = Math.floor(target * 0.25)
  const midN = Math.floor(target * 0.5)
  const tailN = target - headN - midN - 1

  function take(slice, count) {
    if (slice.length <= count) return slice.slice(1) // skip first (already added or overlap)
    const step = (slice.length - 1) / count
    const res = []
    for (let i = 1; i <= count; i++) {
      res.push(slice[Math.min(slice.length - 1, Math.round(i * step))])
    }
    return res
  }

  const headSlice = pts.slice(0, head)
  const midSlice = pts.slice(head, head + mid)
  const tailSlice = pts.slice(head + mid)

  out.push(...take(headSlice, headN))
  // ensure continuity: take from mid without duplicating last
  const midPts = take([out[out.length - 1], ...midSlice], midN)
  out.push(...midPts)
  const tailPts = take([out[out.length - 1], ...tailSlice], tailN)
  out.push(...tailPts)
  const last = pts[pts.length - 1]
  if (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1]) out.push(last)
  return out
}

async function main() {
  const js = await get('https://space-notices.com/_next/static/chunks/2qfg_mtf9yqci.js')
  const ids = [...js.matchAll(/\{id:(\d+),latitude:(-?\d+\.?\d*),longitude:(-?\d+\.?\d*)\}/g)]
  const map = new Map()
  ids.forEach((m) => {
    map.set(Number(m[1]), [Number(m[3]), Number(m[2])]) // [lon, lat]
  })
  const full = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((e) => e[1])
  console.log('full', full.length, full[0], full[full.length - 1])

  const slim = downsample(full, 280)
  console.log('slim', slim.length)

  fs.writeFileSync(
    'cloudfunctions/spaceNotices/flight13-trajectory.json',
    JSON.stringify({
      source: 'space-notices.com embedded Ship 40 / Flight 13 trajectory',
      color: '#ffcc00',
      pointCount: slim.length,
      fullCount: full.length,
      coordinates: slim
    })
  )

  // also copy for client fallback
  fs.writeFileSync(
    'subpackages/monitor-pages/space-notices/utils/flight13-trajectory.json',
    JSON.stringify({
      source: 'space-notices.com embedded Ship 40 / Flight 13 trajectory',
      color: '#ffcc00',
      coordinates: slim
    })
  )
  console.log('written')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
