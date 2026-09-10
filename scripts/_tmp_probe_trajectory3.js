const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

function tryParseCoordArray(raw) {
  // unescape RSC style
  let s = raw
  if (s.includes('\\"')) s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  try {
    return JSON.parse(s)
  } catch (e) {
    return null
  }
}

async function main() {
  const html = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const re = /\[\[\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\](?:\s*,\s*\[\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\]){15,}/g
  let m
  const found = []
  while ((m = re.exec(html))) {
    const arr = tryParseCoordArray(m[0])
    if (!arr) {
      found.push({ parse: false, preview: m[0].slice(0, 80), len: m[0].length })
      continue
    }
    const lons = arr.map((p) => p[0])
    const lats = arr.map((p) => p[1])
    found.push({
      parse: true,
      n: arr.length,
      lon0: lons[0],
      lat0: lats[0],
      lonN: lons[lons.length - 1],
      latN: lats[lats.length - 1],
      lonMin: Math.min(...lons),
      lonMax: Math.max(...lons),
      latMin: Math.min(...lats),
      latMax: Math.max(...lats),
      spanLon: Math.max(...lons) - Math.min(...lons)
    })
  }
  console.log('found', found.length)
  found.forEach((f, i) => console.log(i, JSON.stringify(f)))

  // context before longest span (likely trajectory)
  const best = found
    .map((f, i) => ({ i, span: f.spanLon || 0 }))
    .sort((a, b) => b.span - a.span)[0]
  if (best) {
    re.lastIndex = 0
    let idx = 0
    let hit
    while ((hit = re.exec(html))) {
      if (idx === best.i) {
        const start = Math.max(0, hit.index - 400)
        fs.writeFileSync('scripts/_tmp_traj_ctx2.txt', html.slice(start, hit.index + 200))
        const arr = tryParseCoordArray(hit[0])
        fs.writeFileSync('scripts/_tmp_traj_path.json', JSON.stringify(arr))
        console.log('wrote traj path points', arr && arr.length)
        break
      }
      idx++
    }
  }

  // Look for field names before arrays in self.__next_f payloads
  const nameRe = /([A-Za-z_][A-Za-z0-9_]{2,40})\\?":\s*\[\[-?\d/g
  const names = {}
  let nm
  while ((nm = nameRe.exec(html))) {
    names[nm[1]] = (names[nm[1]] || 0) + 1
  }
  console.log('field names before coord arrays', names)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
