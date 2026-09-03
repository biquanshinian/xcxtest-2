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

async function main() {
  const js = await get('https://space-notices.com/_next/static/chunks/2qfg_mtf9yqci.js')

  // Find useState(f) and walk back to f=[{id:
  const marker = 'useState)(f)'
  const mi = js.indexOf(marker)
  console.log('useState(f) at', mi)

  // Find "let f=" or ",f=[" or "f=[{id:"
  const patterns = ['let f=[', 'var f=[', ',f=[{id:', 'f=[{id:']
  for (const p of patterns) {
    const i = js.indexOf(p)
    console.log(p, i)
  }

  // Find first {id: number, latitude near start of trajectory
  // Look for id:1,latitude or id:0,latitude
  for (let id = 0; id <= 5; id++) {
    const p = `{id:${id},latitude:`
    console.log(p, js.indexOf(p))
  }

  // Find min id in the big array by regex
  const ids = [...js.matchAll(/\{id:(\d+),latitude:(-?\d+\.?\d*),longitude:(-?\d+\.?\d*)\}/g)]
  console.log('point matches', ids.length)
  if (!ids.length) return
  const nums = ids.map((m) => Number(m[1]))
  console.log('id range', Math.min(...nums), Math.max(...nums))

  // reconstruct full path sorted by id ascending (site sorts descending for live updates)
  const pts = ids.map((m) => ({
    id: Number(m[1]),
    latitude: Number(m[2]),
    longitude: Number(m[3])
  }))
  // unique by id
  const map = new Map()
  pts.forEach((p) => map.set(p.id, p))
  const uniq = [...map.values()].sort((a, b) => a.id - b.id)
  console.log('unique', uniq.length)
  console.log('first', uniq[0])
  console.log('last', uniq[uniq.length - 1])
  const lons = uniq.map((p) => p.longitude)
  const lats = uniq.map((p) => p.latitude)
  console.log('lon', Math.min(...lons), Math.max(...lons))
  console.log('lat', Math.min(...lats), Math.max(...lats))

  // Convert to [lon,lat] in flight order - site uses sort by id descending for display?
  // From code: .sort((t,i)=>i.id-t.id) means higher id first
  // Initial f might already be in draw order. Check if id increases along path from Texas to IO
  const byAsc = uniq
  const byDesc = [...uniq].reverse()
  console.log('asc starts', byAsc[0], 'ends', byAsc[byAsc.length - 1])
  console.log('desc starts', byDesc[0], 'ends', byDesc[byDesc.length - 1])

  // Texas is ~ -97, 26; Indian Ocean splash ~ 95-110, -20 to -32
  // Which ordering starts near Texas?
  function nearTexas(p) {
    return p.longitude > -100 && p.longitude < -90 && p.latitude > 20 && p.latitude < 30
  }
  function nearSplash(p) {
    return p.longitude > 90 && p.longitude < 120 && p.latitude > -40 && p.latitude < -10
  }
  console.log('asc first texas?', nearTexas(byAsc[0]), 'last splash?', nearSplash(byAsc[byAsc.length - 1]))
  console.log('desc first texas?', nearTexas(byDesc[0]), 'last splash?', nearSplash(byDesc[byDesc.length - 1]))

  // Find any point near Texas
  const texas = uniq.filter(nearTexas)
  const splash = uniq.filter(nearSplash)
  console.log('texas pts', texas.length, texas[0], texas[texas.length - 1])
  console.log('splash pts', splash.length, splash[0], splash[splash.length - 1])

  // Maybe the embedded f is ONLY the ship-40 telemetry near splash, and the yellow CROSS-OCEAN line is something else?
  // Re-read the Source geojson after S&&
  const sIdx = js.indexOf('S&&(0,i.jsx)(n.Source')
  console.log('trajectory source at', sIdx)
  console.log(js.slice(sIdx, sIdx + 800))

  fs.writeFileSync(
    'scripts/_tmp_embedded_traj.json',
    JSON.stringify(
      {
        count: uniq.length,
        first: uniq[0],
        last: uniq[uniq.length - 1],
        lonRange: [Math.min(...lons), Math.max(...lons)],
        latRange: [Math.min(...lats), Math.max(...lats)],
        sample: uniq.filter((_, i) => i % Math.ceil(uniq.length / 20) === 0)
      },
      null,
      2
    )
  )

  // Save full as [lon,lat] in id ascending
  const line = uniq.map((p) => [p.longitude, p.latitude])
  fs.writeFileSync('scripts/_tmp_site_traj_lonlat.json', JSON.stringify(line))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
