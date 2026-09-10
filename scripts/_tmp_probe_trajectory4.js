const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

function extractBalancedArray(html, startIdx) {
  if (html[startIdx] !== '[') return null
  let depth = 0
  for (let i = startIdx; i < html.length; i++) {
    const c = html[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return html.slice(startIdx, i + 1)
    }
  }
  return null
}

async function main() {
  const html = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const marker = 'padLocations'
  const i = html.indexOf(marker)
  console.log('padLocations', i)
  fs.writeFileSync('scripts/_tmp_padloc_ctx.txt', html.slice(Math.max(0, i - 300), i + 2500))

  // Find all occurrences of [[lon,lat] that start near -97.22 (Starbase trajectory start)
  const starts = []
  let from = 0
  while (true) {
    const j = html.indexOf('[[-97.22', from)
    if (j < 0) break
    starts.push(j)
    from = j + 1
  }
  console.log('starts at -97.22', starts.length)
  for (const j of starts.slice(0, 3)) {
    const raw = extractBalancedArray(html, j)
    if (!raw) continue
    let arr
    try {
      arr = JSON.parse(raw)
    } catch (e) {
      console.log('parse fail', raw.slice(0, 100), e.message)
      continue
    }
    const span = Math.max(...arr.map((p) => p[0])) - Math.min(...arr.map((p) => p[0]))
    console.log({
      n: arr.length,
      first: arr[0],
      last: arr[arr.length - 1],
      spanLon: span,
      ctx: html.slice(Math.max(0, j - 80), j).replace(/\s+/g, ' ')
    })
    if (span > 100) {
      fs.writeFileSync('scripts/_tmp_traj_path.json', JSON.stringify(arr))
      console.log('saved full traj')
    }
  }

  // Also try -97.2167
  from = 0
  while (true) {
    const j = html.indexOf('[[-97.2167', from)
    if (j < 0) break
    const raw = extractBalancedArray(html, j)
    from = j + 1
    if (!raw) continue
    try {
      const arr = JSON.parse(raw)
      const span = Math.max(...arr.map((p) => p[0])) - Math.min(...arr.map((p) => p[0]))
      if (span > 50) {
        console.log('long path -97.2167', arr.length, arr[0], arr[arr.length - 1], 'span', span)
        fs.writeFileSync('scripts/_tmp_traj_path.json', JSON.stringify(arr))
      }
    } catch (e) { /* ignore */ }
  }

  // Search keys: predicted, path, track, orbit
  for (const k of ['predictedPath', 'predicted', 'groundTrack', 'flightTrack', 'ballistic', 'suborbital', 'pathPoints', 'lineCoordinates', 'coordinates']) {
    const n = (html.match(new RegExp(k, 'g')) || []).length
    if (n) console.log('key', k, n)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
