/** 探测 space-notices.com 收录了哪些 entry（是否含非星舰任务） */
const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')

async function main() {
  const pages = ['https://space-notices.com/', 'https://space-notices.com/entries', 'https://space-notices.com/launches']
  for (const url of pages) {
    let html = ''
    try {
      html = await httpGet(url)
    } catch (e) {
      console.log(`\n=== ${url} → ERROR ${(e && e.message) || e}`)
      continue
    }
    const entries = [...new Set((html.match(/\/entry\/[a-z0-9\-_%]+/gi) || []).map((s) => s.replace(/\\+$/, '')))]
    console.log(`\n=== ${url} → ${html.length} chars, ${entries.length} entry links`)
    entries.slice(0, 60).forEach((e) => console.log('   ' + e))
    if (!entries.length) {
      const titles = (html.match(/<title>[^<]*<\/title>/i) || [''])[0]
      console.log('   title:', titles)
      console.log('   sample:', html.slice(0, 400).replace(/\s+/g, ' '))
    }
  }
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
