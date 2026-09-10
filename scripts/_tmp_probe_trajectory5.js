const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')

async function main() {
  const html = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  // URLs in page
  const urls = [...html.matchAll(/https?:\/\/[^"'\\\s]+/g)].map((m) => m[0])
  const interesting = urls.filter((u) => /traj|path|geo|json|compass|adp|tle|orbit|kml|gpx/i.test(u))
  console.log('interesting urls', [...new Set(interesting)].slice(0, 40))

  // path-like hrefs
  const hrefs = [...html.matchAll(/href=\\"(\/[^"\\]+)\\"/g)].map((m) => m[1])
  const href2 = [...html.matchAll(/"(\/[a-zA-Z0-9_\-\/.]+)"/g)].map((m) => m[1])
  const all = [...new Set(hrefs.concat(href2))].filter((h) => /traj|path|geo|json|compass|data|api|entry/i.test(h))
  console.log('paths', all.slice(0, 50))

  // Look for RSC flight object fields around "Starship V3"
  const i = html.indexOf('Starship V3')
  console.log('ctx', html.slice(i, i + 1500).replace(/\\n/g, '\n').slice(0, 1200))

  // Find "padLocations" object and print keys around it by unescaping a window
  const j = html.indexOf('padLocations')
  const window = html.slice(j - 2000, j + 500)
  const keyHits = [...window.matchAll(/\\"([A-Za-z_][A-Za-z0-9_]*)\\":/g)].map((m) => m[1])
  console.log('keys near padLocations', [...new Set(keyHits)])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
