const { httpGet, parseNoticeFromHtml } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const fs = require('fs')

// Replicate extractNoticeObject by requiring internals via reading file - instead dump via monkey
const fe = require('../cloudfunctions/spaceNotices/fetch-external.js')

async function main() {
  const html = await httpGet('https://space-notices.com/notice/adp-link-file-aha-starship-flight-13')
  // Use private extract if exported - else copy logic
  let extract = fe.extractNoticeObject
  if (!extract) {
    // inline: find \"notice\":{ balanced
    const marker = '\\"notice\\":{'
    const i = html.indexOf(marker)
    console.log('marker', i)
    if (i < 0) return
    const start = i + marker.length - 1
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let p = start; p < html.length; p++) {
      const c = html[p]
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
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          end = p
          break
        }
      }
    }
    let raw = html.slice(start, end + 1)
    raw = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    const obj = JSON.parse(raw)
    console.log('keys', Object.keys(obj))
    const summary = {}
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (Array.isArray(v)) {
        summary[k] = {
          len: v.length,
          first: v[0],
          isNested: Array.isArray(v[0])
        }
      } else if (v && typeof v === 'object') summary[k] = { type: 'object', keys: Object.keys(v) }
      else summary[k] = v
    }
    fs.writeFileSync('scripts/_tmp_aha_keys.json', JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2).slice(0, 3000))
  }

  const notice = parseNoticeFromHtml(html, 'adp-link-file-aha-starship-flight-13')
  console.log('parsed rings', notice && notice.areas && notice.areas.length)

  // Derive a simple "spine" from AHA: take centroids of each ring sorted by lon
  if (notice && notice.areas) {
    const cents = notice.areas.map((ring) => {
      let lon = 0
      let lat = 0
      ring.forEach((p) => {
        lon += p[0]
        lat += p[1]
      })
      return [lon / ring.length, lat / ring.length]
    }).sort((a, b) => a[0] - b[0])
    console.log('aha centroids', cents)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
