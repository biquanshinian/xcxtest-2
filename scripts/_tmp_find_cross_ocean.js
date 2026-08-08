const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

function extractBalancedArray(html, startIdx) {
  if (html[startIdx] !== '[') return null
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
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return html.slice(startIdx, i + 1)
    }
  }
  return null
}

async function main() {
  const pages = [
    'https://space-notices.com/entry/launch-starship-flight-13',
    'https://space-notices.com/notice/adp-link-file-aha-starship-flight-13',
    'https://space-notices.com/notice/adp-link-file-dra-starship-flight-13'
  ]
  for (const url of pages) {
    const html = await httpGet(url)
    let from = 0
    let best = null
    while (from < html.length) {
      const j = html.indexOf('[[-', from)
      if (j < 0) break
      from = j + 2
      const raw = extractBalancedArray(html, j)
      if (!raw || raw.length < 80) continue
      let arr
      try {
        arr = JSON.parse(raw)
      } catch (e) {
        continue
      }
      if (!Array.isArray(arr) || arr.length < 8) continue
      if (!Array.isArray(arr[0]) || arr[0].length < 2) continue
      // skip if looks like polygon rings nested deeper
      if (Array.isArray(arr[0][0])) continue
      const lons = arr.map((p) => Number(p[0])).filter(Number.isFinite)
      if (lons.length < 8) continue
      const min = Math.min(...lons)
      const max = Math.max(...lons)
      const span = max - min
      if (span > 40) {
        const cand = { url, n: arr.length, min, max, span, first: arr[0], last: arr[arr.length - 1] }
        console.log(cand)
        if (!best || span > best.span) {
          best = { ...cand, arr }
        }
      }
    }
    if (best && best.span > 100) {
      fs.writeFileSync('scripts/_tmp_traj_path.json', JSON.stringify(best.arr))
      console.log('SAVED', best.url, best.n, best.span)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
