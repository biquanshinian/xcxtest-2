const https = require('https')

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/json'
          }
        },
        (r) => {
          let b = ''
          r.on('data', (c) => {
            b += c
          })
          r.on('end', () => resolve({ status: r.statusCode, body: b, type: r.headers['content-type'] }))
        }
      )
      .on('error', reject)
  })
}

async function main() {
  const urls = [
    'https://space-notices.com/entry/launch-starship-flight-13',
    'https://space-notices.com/notice/notam-YMMM-E2700%2F26'
  ]
  for (const url of urls) {
    const r = await get(url)
    console.log('\n==', r.status, url, r.type, 'len', r.body.length)
    const next = r.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (next) {
      console.log('NEXT_DATA bytes', next[1].length)
      try {
        const j = JSON.parse(next[1])
        console.log('keys', Object.keys(j))
        console.log(JSON.stringify(j).slice(0, 800))
      } catch (e) {
        console.log('parse fail', e.message)
      }
    } else {
      console.log('no NEXT_DATA')
      const i = r.body.indexOf('E2700')
      console.log('E2700 context', i > -1 ? r.body.slice(i, i + 180) : 'n/a')
      const i2 = r.body.indexOf('2338S')
      console.log('2338S context', i2 > -1 ? r.body.slice(i2 - 40, i2 + 120) : 'n/a')
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
