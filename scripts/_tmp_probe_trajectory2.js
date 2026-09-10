const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

async function main() {
  const html = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const idx = html.toLowerCase().indexOf('trajectory')
  console.log('first trajectory idx', idx)
  if (idx >= 0) {
    console.log(html.slice(Math.max(0, idx - 200), idx + 800))
  }

  // Find JSON-like blobs with many lon/lat pairs that look like a path
  // Look for patterns like [[-97.,25.],[...
  const re = /\[\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\](?:\s*,\s*\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]){20,}/g
  const matches = html.match(re) || []
  console.log('long coord arrays', matches.length)
  matches.slice(0, 3).forEach((m, i) => {
    let arr
    try { arr = JSON.parse(m) } catch (e) { arr = null }
    console.log(i, 'len', arr ? arr.length : m.length, 'first', arr && arr[0], 'last', arr && arr[arr.length - 1])
  })

  // search for key names near trajectory in RSC payload
  const keys = ['"trajectory"', '\\"trajectory\\"', 'trajectoryCoordinates', 'traj', 'groundTrack']
  keys.forEach((k) => {
    const i = html.indexOf(k)
    console.log(k, i)
    if (i >= 0) console.log(html.slice(i, i + 300).replace(/\n/g, ' ').slice(0, 280))
  })

  fs.writeFileSync('scripts/_tmp_entry_snippet.txt', html.slice(0, 5000))
  // dump around Trajectory UI string
  const i2 = html.indexOf('Trajectory')
  if (i2 >= 0) {
    fs.writeFileSync('scripts/_tmp_traj_ctx.txt', html.slice(Math.max(0, i2 - 500), i2 + 2000))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
