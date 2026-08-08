const https = require('https')
const fs = require('fs')
const path = require('path')

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html'
          }
        },
        (r) => {
          let b = ''
          r.on('data', (c) => {
            b += c
          })
          r.on('end', () => resolve(b))
        }
      )
      .on('error', reject)
  })
}

async function main() {
  const url = 'https://space-notices.com/notice/notam-YMMM-E2700%2F26'
  const body = await get(url)
  const out = path.join(__dirname, '_tmp_sn_notice.html')
  fs.writeFileSync(out, body)
  console.log('wrote', out, body.length)

  // self.__next_f.push payloads
  const pushes = [...body.matchAll(/self\.__next_f\.push\(\[.*?\]\)/g)]
  console.log('next_f pushes', pushes.length)

  // look for rawText / geometry / coordinates JSON-ish
  for (const key of ['rawText', 'raw_text', 'geometry', 'FeatureCollection', 'coordinates', 'NOTAMN', 'sourceLink']) {
    const i = body.indexOf(key)
    console.log(key, i)
    if (i >= 0) console.log(body.slice(Math.max(0, i - 60), i + 200).replace(/\n/g, ' '))
  }

  // extract notice links from entry page
  const entry = await get('https://space-notices.com/entry/launch-starship-flight-13')
  const links = [...entry.matchAll(/href="(\/notice\/[^"]+)"/g)].map((m) => m[1])
  const uniq = [...new Set(links)]
  console.log('notice links', uniq.length)
  console.log(uniq.slice(0, 15).join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
