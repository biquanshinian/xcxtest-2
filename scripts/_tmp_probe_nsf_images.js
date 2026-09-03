const https = require('https')
const http = require('http')

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(
      url,
      {
        timeout: 20000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          ...headers
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          get(new URL(res.headers.location, url).toString(), headers).then(resolve)
          return
        }
        const chunks = []
        let n = 0
        res.on('data', (c) => {
          n += c.length
          if (n < 5000) chunks.push(c)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            type: res.headers['content-type'],
            len: n,
            cf: res.headers['cf-ray'] || '',
            head: Buffer.concat(chunks).toString('utf8').slice(0, 120)
          })
        )
      }
    )
    req.on('error', (e) => resolve({ status: -1, err: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: -3, err: 'timeout' })
    })
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let b = ''
        res.on('data', (d) => (b += d))
        res.on('end', () => {
          try {
            resolve(JSON.parse(b))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

function extractImgs(html) {
  const out = []
  const re = /src=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

;(async () => {
  for (const [name, feed] of [
    ['NSF SpaceX', 'https://www.nasaspaceflight.com/news/spacex/feed/'],
    ['Proxima', 'https://proximareport.com/rss/']
  ]) {
    const j = await fetchJson(
      'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feed)
    )
    const it = (j.items || [])[0]
    console.log('\n===', name, '===')
    console.log('title:', it && it.title)
    console.log('thumbnail:', it && it.thumbnail)
    const imgs = extractImgs(it && it.content).slice(0, 5)
    console.log('content imgs:', imgs)
    for (const u of [it && it.thumbnail, ...imgs].filter(Boolean).slice(0, 4)) {
      const bare = await get(u)
      const withRef = await get(u, { Referer: 'https://www.nasaspaceflight.com/' })
      console.log(
        '  IMG',
        u.slice(0, 90),
        '\n    bare=',
        bare.status,
        bare.type,
        bare.len,
        bare.err || '',
        '\n    referer=',
        withRef.status,
        withRef.type,
        withRef.len
      )
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
