const https = require('https')

const IMG =
  'https://www.nasaspaceflight.com/wp-content/uploads/2026/08/jsc2026e404725large.jpg'

const candidates = [
  ['direct', IMG],
  ['wp-i0', 'https://i0.wp.com/www.nasaspaceflight.com/wp-content/uploads/2026/08/jsc2026e404725large.jpg'],
  ['wp-i1', 'https://i1.wp.com/www.nasaspaceflight.com/wp-content/uploads/2026/08/jsc2026e404725large.jpg'],
  ['wsrv', 'https://wsrv.nl/?url=' + encodeURIComponent(IMG)],
  ['images.weserv', 'https://images.weserv.nl/?url=' + encodeURIComponent(IMG.replace(/^https?:\/\//, ''))],
  ['weserv-full', 'https://images.weserv.nl/?url=' + encodeURIComponent(IMG)],
  ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(IMG)],
  ['jina', 'https://r.jina.ai/' + IMG]
]

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        timeout: 25000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'image/*,*/*'
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          get(new URL(res.headers.location, url).toString()).then(resolve)
          return
        }
        let n = 0
        const chunks = []
        res.on('data', (c) => {
          n += c.length
          if (chunks.length < 3) chunks.push(c)
        })
        res.on('end', () => {
          const head = Buffer.concat(chunks)
          const isImg =
            (head[0] === 0xff && head[1] === 0xd8) ||
            (head[0] === 0x89 && head[1] === 0x50) ||
            /^image\//i.test(String(res.headers['content-type'] || ''))
          resolve({
            status: res.statusCode,
            type: res.headers['content-type'],
            len: n,
            isImg,
            head: head.toString('utf8').slice(0, 80)
          })
        })
      }
    )
    req.on('error', (e) => resolve({ status: -1, err: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: -3, err: 'timeout' })
    })
  })
}

;(async () => {
  for (const [name, url] of candidates) {
    const r = await get(url)
    console.log(
      name.padEnd(16),
      's=' + String(r.status).padEnd(4),
      'img=' + String(!!r.isImg).padEnd(5),
      'type=' + String(r.type || '').slice(0, 30).padEnd(30),
      'len=' + r.len,
      r.err || (r.isImg ? 'OK' : JSON.stringify(r.head || '').slice(0, 60))
    )
  }
})()
