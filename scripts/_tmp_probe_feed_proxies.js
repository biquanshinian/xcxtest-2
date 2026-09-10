// 探测：哪些公共中转能拿到 NSF feed（绕开 Cloudflare 对机房 IP 的封锁）
const https = require('https')

const FEED = 'https://www.nasaspaceflight.com/news/spacex/feed/'

const candidates = [
  ['direct', FEED, {}],
  ['r.jina.ai', `https://r.jina.ai/${FEED}`, { 'x-respond-with': 'text' }],
  ['allorigins-raw', `https://api.allorigins.win/raw?url=${encodeURIComponent(FEED)}`, {}],
  ['corsproxy.io', `https://corsproxy.io/?url=${encodeURIComponent(FEED)}`, {}],
  ['codetabs', `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(FEED)}`, {}]
]

function get(url, extraHeaders) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/rss+xml,application/xml,text/xml,*/*',
          ...extraHeaders
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          get(new URL(res.headers.location, url).toString(), extraHeaders).then(resolve)
          return
        }
        const chunks = []
        let total = 0
        res.on('data', (c) => {
          total += c.length
          if (total < 200000) chunks.push(c)
        })
        res.on('end', () => {
          const zlib = require('zlib')
          let buf = Buffer.concat(chunks)
          if (/gzip/i.test(String(res.headers['content-encoding'] || ''))) {
            try { buf = zlib.gunzipSync(buf) } catch (e) {}
          }
          resolve({ status: res.statusCode, body: buf.toString('utf8') })
        })
        res.on('error', () => resolve({ status: -1, body: '' }))
      }
    )
    req.on('error', (e) => resolve({ status: -2, body: String(e.message || e) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: -3, body: 'timeout' }) })
  })
}

;(async () => {
  for (const [name, url, hdrs] of candidates) {
    const t0 = Date.now()
    const r = await get(url, hdrs)
    const hasItems = /<item>/i.test(r.body)
    const looksXml = /<rss|<feed|<channel/i.test(r.body)
    console.log(
      `${name.padEnd(16)} status=${String(r.status).padEnd(4)} ${Date.now() - t0}ms xml=${looksXml} items=${hasItems} len=${r.body.length}` +
        (hasItems ? '' : ` head=${JSON.stringify(r.body.slice(0, 120))}`)
    )
  }
})()
