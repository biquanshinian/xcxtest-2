const https = require('https')
const { parseNoticeFromHtml, extractNoticeLinks, httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')

async function main() {
  const entryHtml = await httpGet('https://space-notices.com/entry/launch-starship-flight-13')
  const paths = extractNoticeLinks(entryHtml)
  const adp = paths.filter((p) => /adp-link-file/i.test(p))
  console.log('adp paths', adp)

  for (const pathName of adp.slice(0, 4)) {
    const html = await httpGet('https://space-notices.com' + pathName)
    const key = pathName.replace(/^\/notice\//, '')
    const notice = parseNoticeFromHtml(html, key)
    if (!notice) {
      console.log(key, 'PARSE FAIL')
      continue
    }
    const rings = (notice.areas || []).length
    const pts = (notice.areas || []).reduce((n, r) => n + (r && r.length) || 0, 0)
    console.log(JSON.stringify({
      key: notice.noticeKey,
      type: notice.type,
      cancelled: notice.cancelled,
      rings,
      pts,
      centerline: (notice.centerline || []).length,
      hasRaw: !!(notice.rawText && notice.rawText.length)
    }))
  }

  // entry page trajectory hints
  for (const k of ['centerline', 'trajectory', 'Trajectory', 'LineString', 'flightPath']) {
    console.log('entry', k, (entryHtml.match(new RegExp(k, 'g')) || []).length)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
