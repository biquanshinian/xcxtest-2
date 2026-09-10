/**
 * 决定性可行性验证：非星舰 entry 的通告是否真带坐标多边形 / 轨迹
 * 同时抽出 entry 页可用于匹配 LL2 的元信息（标题、日期、火箭名）
 */
const {
  httpGet,
  extractNoticeLinks,
  noticeKeyFromPath,
  parseNoticeFromHtml
} = require('../cloudfunctions/spaceNotices/fetch-external.js')

const BASE = 'https://space-notices.com'

function metaFromEntryHtml(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [, ''])[1]
  const desc = (html.match(/<meta name="description" content="([^"]*)"/i) || [, ''])[1]
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/i) || [, ''])[1]
  const isoDates = [...new Set(html.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) || [])].slice(0, 4)
  return { title, ogTitle, desc: desc.slice(0, 200), isoDates }
}

async function probe(slug, maxNotices) {
  const url = `${BASE}/entry/${slug}`
  const html = await httpGet(url)
  const meta = metaFromEntryHtml(html)
  const paths = extractNoticeLinks(html)
  console.log(`\n##### ${slug}`)
  console.log('  title   :', meta.title)
  console.log('  ogTitle :', meta.ogTitle)
  console.log('  desc    :', meta.desc)
  console.log('  dates   :', meta.isoDates.join(' | '))
  console.log(`  notices : ${paths.length} 条链接`)
  // 站点是否给了 trajectory（黄线）
  console.log('  has trajectory keyword:', /trajectory/i.test(html))

  let withAreas = 0
  let totalPts = 0
  const sample = []
  for (const p of paths.slice(0, maxNotices || 5)) {
    const key = noticeKeyFromPath(p)
    try {
      const nh = await httpGet(BASE + p)
      const n = parseNoticeFromHtml(nh, key)
      if (!n) {
        sample.push(`${key}: parse失败`)
        continue
      }
      const rings = (n.areas || []).length
      const pts = (n.areas || []).reduce((s, r) => s + (r ? r.length : 0), 0)
      if (rings) withAreas += 1
      totalPts += pts
      sample.push(`${n.type} ${n.name} → rings=${rings} pts=${pts}${n.cancelled ? ' [cancelled]' : ''}`)
    } catch (e) {
      sample.push(`${key}: ${(e && e.message) || e}`)
    }
  }
  sample.forEach((s) => console.log('    - ' + s))
  console.log(`  → 抽样中 ${withAreas} 条带多边形，合计 ${totalPts} 个坐标点`)
}

async function main() {
  await probe('launch-f9-starlink-17-51', 5)
  await probe('launch-f9-nrol-95', 5)
  await probe('launch-long-march-3be-tianlian-2-06', 4)
  await probe('collection-starbase-testing', 3)
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
