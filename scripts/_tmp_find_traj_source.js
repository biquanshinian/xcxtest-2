/**
 * 从 space-notices.com 挖 Trajectory 黄线真实数据来源
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const BASE = 'https://space-notices.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: 20000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : BASE + res.headers.location
          res.resume()
          return httpGet(next).then(resolve, reject)
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} ${url}`))
          else resolve({ url, buf, text: buf.toString('utf8'), ct: res.headers['content-type'] || '' })
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout ' + url))
    })
  })
}

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
  const entry = await httpGet(BASE + '/entry/launch-starship-flight-13')
  const html = entry.text
  fs.writeFileSync('scripts/_tmp_entry_full.html', html)

  // 1) all chunk urls
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"'\\\s]+/g) || [])]
  console.log('chunks', chunks.length)

  const hits = []
  for (const c of chunks) {
    try {
      const { text } = await httpGet(BASE + c)
      const patterns = [
        'Trajectory',
        'trajectory',
        'centerline',
        'groundTrack',
        'flightPath',
        'predictedPath',
        'greatCircle',
        'bezier',
        'splashdown',
        'suborbital'
      ]
      const found = patterns.filter((p) => text.includes(p))
      if (found.length) {
        hits.push({ c, found, len: text.length })
        // dump context for Trajectory
        let idx = text.indexOf('Trajectory')
        if (idx < 0) idx = text.indexOf('trajectory')
        if (idx >= 0) {
          fs.writeFileSync(
            `scripts/_tmp_chunk_${path.basename(c)}.txt`,
            text.slice(Math.max(0, idx - 500), idx + 2500)
          )
        }
      }
    } catch (e) {
      console.log('chunk fail', c, e.message)
    }
  }
  console.log('chunk hits', hits)

  // 2) look for fetch/XHR endpoints in chunks that mention trajectory
  for (const h of hits) {
    try {
      const { text } = await httpGet(BASE + h.c)
      const apis = [...text.matchAll(/["'`](\/[a-zA-Z0-9_\-/.?=&%]+)["'`]/g)]
        .map((m) => m[1])
        .filter((u) => /api|traj|path|geo|data|entry|launch|notice|compass/i.test(u))
      console.log(h.c, 'apis', [...new Set(apis)].slice(0, 30))
    } catch (e) { /* ignore */ }
  }

  // 3) Try common data endpoints
  const tryUrls = [
    '/api/entry/launch-starship-flight-13',
    '/api/entries/launch-starship-flight-13',
    '/api/trajectory/launch-starship-flight-13',
    '/api/flight/launch-starship-flight-13',
    '/data/launch-starship-flight-13.json',
    '/entry/launch-starship-flight-13.json',
    '/_next/data'
  ]
  for (const u of tryUrls) {
    try {
      const r = await httpGet(BASE + u)
      console.log('TRY', u, r.ct, r.buf.length, r.text.slice(0, 120).replace(/\s+/g, ' '))
    } catch (e) {
      console.log('TRY fail', u, e.message)
    }
  }

  // 4) In entry HTML, find arrays that start near Starbase and end in Indian Ocean
  //    by scanning ALL [[lon,lat] arrays and checking endpoints
  let from = 0
  const candidates = []
  while (from < html.length) {
    const j = html.indexOf('[[', from)
    if (j < 0) break
    from = j + 2
    const raw = extractBalancedArray(html, j)
    if (!raw || raw.length < 40) continue
    let arr
    try {
      arr = JSON.parse(raw)
    } catch (e) {
      continue
    }
    if (!Array.isArray(arr) || arr.length < 5) continue
    if (!Array.isArray(arr[0]) || typeof arr[0][0] !== 'number') continue
    if (Array.isArray(arr[0][0])) continue // nested rings
    const lons = arr.map((p) => p[0])
    const lats = arr.map((p) => p[1])
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const span = maxLon - minLon
    // trajectory-like: starts west hemisphere, ends east, not closed
    const first = arr[0]
    const last = arr[arr.length - 1]
    const closed =
      Math.abs(first[0] - last[0]) < 0.05 && Math.abs(first[1] - last[1]) < 0.05
    if (span > 30 && !closed) {
      candidates.push({
        n: arr.length,
        span,
        first,
        last,
        minLon,
        maxLon,
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        ctx: html.slice(Math.max(0, j - 60), j).replace(/\s+/g, ' ')
      })
      if (span > 120) {
        fs.writeFileSync('scripts/_tmp_site_traj.json', JSON.stringify(arr))
        console.log('SAVED cross-ocean open path', arr.length, span)
      }
    }
  }
  console.log('open long paths', candidates.length)
  candidates
    .sort((a, b) => b.span - a.span)
    .slice(0, 10)
    .forEach((c) => console.log(JSON.stringify(c)))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
