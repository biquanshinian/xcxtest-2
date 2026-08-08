/** SPACE_NOTICES_FEATURE — 外部拉取解析冒烟 */
const fs = require('fs')
const path = require('path')
const {
  parseNoticeFromHtml,
  extractNoticeLinks,
  noticeKeyFromPath,
  fetchWatchedEntries
} = require('../cloudfunctions/spaceNotices/fetch-external.js')

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exit(1)
  }
}

const htmlPath = path.join(__dirname, '_tmp_sn_notice.html')
assert(fs.existsSync(htmlPath), 'missing _tmp_sn_notice.html — run probe first or live fetch')

const html = fs.readFileSync(htmlPath, 'utf8')
const notice = parseNoticeFromHtml(html, 'notam-YMMM-E2700/26')
assert(!!notice, 'parseNoticeFromHtml null')
assert(notice.noticeKey === 'notam-YMMM-E2700/26', 'key ' + notice.noticeKey)
assert(notice.type === 'NOTAM', 'type ' + notice.type)
assert(notice.rawText.indexOf('2338S 07500E') >= 0, 'rawText coords')
assert(Array.isArray(notice.areas) && notice.areas[0] && notice.areas[0].length >= 18, 'areas pts')
assert(Math.abs(notice.areas[0][0][0] - 75) < 0.1, 'lon0')
console.log('OK offline parse', notice.name, 'pts=', notice.areas[0].length)

assert(noticeKeyFromPath('/notice/notam-YMMM-E2700%2F26') === 'notam-YMMM-E2700/26', 'keyFromPath')

const live = process.argv.includes('--live')
if (!live) {
  console.log('skip live (pass --live to hit space-notices.com)')
  process.exit(0)
}

fetchWatchedEntries()
  .then((batches) => {
    assert(batches.length >= 1, 'batches')
    const b = batches[0]
    console.log('live', {
      fetched: b.fetched,
      parsed: b.parsed,
      errors: b.errors,
      sample: (b.notices[0] && b.notices[0].noticeKey) || null
    })
    assert(b.parsed >= 1, 'parsed>=1')
    const e2700 = b.notices.find((n) => /E2700/i.test(n.noticeKey) || /E2700/i.test(n.name))
    assert(!!e2700, 'has E2700 among ' + b.parsed)
    assert(e2700.areas && e2700.areas[0] && e2700.areas[0].length >= 10, 'e2700 areas')
    console.log('OK live E2700 pts=', e2700.areas[0].length, 'keys=', b.notices.length)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
