const https = require('https')
const FEED = 'https://www.nasaspaceflight.com/news/spacex/feed/'
const list = [
  ['rss2json', `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(FEED)}`],
  ['jina-http', 'https://r.jina.ai/http://www.nasaspaceflight.com/news/spacex/feed/'],
  ['thingproxy', `https://thingproxy.freeboard.io/fetch/${FEED}`],
  ['yacdn', `https://yacdn.org/proxy/${FEED}`],
  ['rss-bridge-guess', `https://rss-bridge.org/bridge01/?action=display&bridge=Feed&url=${encodeURIComponent(FEED)}&format=Atom`],
  ['google-cache', `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(FEED)}`],
]
function get(u) {
  return new Promise((r) => {
    const req = https.get(
      u,
      { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } },
      (res) => {
        const c = []
        let n = 0
        res.on('data', (d) => {
          n += d.length
          if (n < 300000) c.push(d)
        })
        res.on('end', () => {
          const b = Buffer.concat(c).toString('utf8')
          r({ s: res.statusCode, b })
        })
      }
    )
    req.on('error', (e) => r({ s: -1, b: String(e.message) }))
    req.on('timeout', () => {
      req.destroy()
      r({ s: -3, b: 'timeout' })
    })
  })
}
;(async () => {
  for (const [n, u] of list) {
    const t = Date.now()
    const r = await get(u)
    const items = /<item>/i.test(r.b) || /"items"\s*:/i.test(r.b)
    console.log(
      n.padEnd(16),
      's=' + String(r.s).padEnd(4),
      Date.now() - t + 'ms',
      'items=' + items,
      'len=' + r.b.length,
      'head=' + JSON.stringify(r.b.slice(0, 160))
    )
  }
})()
