const https = require('https')
const fs = require('fs')

const url = 'https://space-notices.com/_next/static/chunks/2qfg_mtf9yqci.js'

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

async function main() {
  const js = await get(url)
  fs.writeFileSync('scripts/_tmp_traj_chunk_full.js', js)

  // Find all Trajectory-related snippets with more context
  const re = /.{0,120}Trajectory.{0,200}/g
  const hits = js.match(re) || []
  console.log('Trajectory contexts', hits.length)
  hits.slice(0, 20).forEach((h, i) => console.log(i, h.replace(/\s+/g, ' ')))

  const re2 = /.{0,80}trajectory.{0,160}/gi
  const hits2 = js.match(re2) || []
  console.log('\ntrajectory contexts', hits2.length)
  hits2.slice(0, 30).forEach((h, i) => console.log(i, h.replace(/\s+/g, ' ')))

  // function names near trajectory
  const fn = [...js.matchAll(/function\s+(\w*traj\w*)/gi)].map((m) => m[1])
  const fn2 = [...js.matchAll(/(\w*Traject\w*)\s*[=:(]/g)].map((m) => m[1])
  console.log('fn', [...new Set(fn.concat(fn2))])

  // look for lat/lon generation patterns
  for (const key of ['greatCircle', 'interpolate', 'bezier', 'spherical', 'destination', 'bearing', 'rhumb', 'geodesic']) {
    const n = (js.match(new RegExp(key, 'gi')) || []).length
    if (n) console.log(key, n)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
