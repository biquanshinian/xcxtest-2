const wapi = require('../cloudfunctions/adminGateway/oaWechatApi.js')

const nsf =
  'https://www.nasaspaceflight.com/wp-content/uploads/2026/08/jsc2026e404725large.jpg'
const proxima =
  'https://storage.ghost.io/c/c1/15/c115fdad-529f-4ea1-9d82-260375a868a5/content/images/2026/08/HN635obXcAAOR-7-1.jpg'

console.log('NSF safe:', wapi.hotlinkSafeImageUrl(nsf))
console.log('Proxima safe (unchanged):', wapi.hotlinkSafeImageUrl(proxima))
console.log('candidates:', wapi.imageUrlCandidates(nsf).slice(0, 4))

;(async () => {
  const buf = await wapi.fetchBuffer(nsf)
  console.log('fetchBuffer NSF via mirrors: bytes=', buf.length, 'jpeg=', buf[0] === 0xff && buf[1] === 0xd8)
  if (!buf.length || !(buf[0] === 0xff || buf[0] === 0x89 || buf.toString('ascii', 0, 4) === 'RIFF')) {
    throw new Error('NSF image fetch failed magic=' + buf.slice(0, 4).toString('hex'))
  }
  console.log('RESULT: OK')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
