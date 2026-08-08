const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

function extractBalanced(html, startIdx, open, close) {
  if (html[startIdx] !== open) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = startIdx; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return html.slice(startIdx, i + 1)
    }
  }
  return null
}

async function main() {
  const html = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')

  // Find COMPASS typed notices
  const compassIdx = []
  let from = 0
  while (true) {
    const j = html.indexOf('COMPASS', from)
    if (j < 0) break
    compassIdx.push(j)
    from = j + 1
  }
  console.log('COMPASS hits', compassIdx.length)
  compassIdx.slice(0, 5).forEach((j) => {
    console.log('---', html.slice(Math.max(0, j - 120), j + 200).replace(/\s+/g, ' '))
  })

  // Fetch AHA notice page and dump all top-level keys of notice object via fetch-external extract
  const aha = await httpGet('https://space-notices.com/notice/adp-link-file-aha-starship-flight-13')
  // locate "areas": and walk back for object start
  const a = aha.indexOf('"areas"')
  const a2 = aha.indexOf('\\"areas\\"')
  console.log('areas raw/escaped', a, a2)
  const needle = a2 >= 0 ? '\\"areas\\"' : '"areas"'
  const ai = a2 >= 0 ? a2 : a
  // walk back to nearest { 
  let start = ai
  while (start > 0 && aha[start] !== '{') start--
  // try find "notice" key
  const nKey = aha.indexOf('\\"notice\\":')
  console.log('notice key', nKey)
  if (nKey >= 0) {
    const objStart = aha.indexOf('{', nKey)
    const raw = extractBalanced(aha, objStart, '{', '}')
    if (raw) {
      let json = raw
      if (json.includes('\\"')) json = json.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      try {
        const obj = JSON.parse(json)
        console.log('notice keys', Object.keys(obj))
        for (const k of Object.keys(obj)) {
          const v = obj[k]
          if (Array.isArray(v)) console.log(k, 'array len', v.length, 'sample', JSON.stringify(v).slice(0, 120))
          else if (v && typeof v === 'object') console.log(k, 'object keys', Object.keys(v))
          else console.log(k, typeof v, String(v).slice(0, 80))
        }
        fs.writeFileSync('scripts/_tmp_aha_notice_meta.json', JSON.stringify({
          keys: Object.keys(obj),
          areasRings: Array.isArray(obj.areas) ? obj.areas.length : 0,
          centerline: obj.centerline,
          trajectory: obj.trajectory,
          path: obj.path
        }, null, 2))
      } catch (e) {
        console.log('parse notice fail', e.message, raw.slice(0, 200))
      }
    }
  }

  // Search JS chunk for Trajectory string
  const chunkRe = /\/_next\/static\/chunks\/[^"\\]+\.js/g
  const chunks = [...new Set((html.match(chunkRe) || []))]
  console.log('chunks', chunks.length)
  for (const c of chunks.slice(0, 12)) {
    try {
      const js = await httpGet('https://space-notices.com' + c)
      if (/Trajectory|centerline|groundTrack|flightPath/i.test(js)) {
        console.log('chunk hit', c, js.length)
        const k = js.search(/Trajectory/)
        if (k >= 0) console.log(js.slice(k - 100, k + 300).replace(/\s+/g, ' '))
      }
    } catch (e) {
      console.log('chunk fail', c, e.message)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
