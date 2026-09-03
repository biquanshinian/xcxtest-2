/* 探测 NSF 栏目 feed 结构：全文/配图/作者 */
const https = require('https')

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      .on('error', reject)
  })
}

;(async () => {
  for (const feed of [
    'https://www.nasaspaceflight.com/news/spacex/feed/',
    'https://www.nasaspaceflight.com/news/international/chinese/feed/'
  ]) {
    const xml = await get(feed)
    const items = xml.split('<item>').slice(1)
    console.log('\n===', feed)
    console.log('bytes:', xml.length, 'items:', items.length)
    const it = items[0] || ''
    const pick = (re) => {
      const m = it.match(re)
      return m ? m[1].slice(0, 140) : '(none)'
    }
    console.log('title:', pick(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/))
    console.log('link:', pick(/<link>([\s\S]*?)<\/link>/))
    console.log('creator:', pick(/<dc:creator>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/dc:creator>/))
    console.log('pubDate:', pick(/<pubDate>([\s\S]*?)<\/pubDate>/))
    const enc = it.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/)
    console.log('content:encoded len:', enc ? enc[1].length : 0)
    const desc = it.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)
    console.log('description len:', desc ? desc[1].length : 0)
    const body = enc ? enc[1] : ''
    const imgs = body.match(/<img[^>]+src="([^"]+)"/g) || []
    console.log('imgs:', imgs.length)
    imgs.slice(0, 3).forEach((t) => console.log('  ', (t.match(/src="([^"]+)"/) || [])[1]))
    const media = it.match(/<media:content[^>]*url="([^"]+)"/)
    console.log('media:content:', media ? media[1] : '(none)')
    console.log('body head:', body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200))
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
