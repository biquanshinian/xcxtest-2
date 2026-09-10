/** 非星舰 entry 是否也有站点轨迹（黄线）数据：查页面内嵌坐标数组与引用的 chunk */
const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')

const BASE = 'https://space-notices.com'
/** [lon, lat] 数值对连续出现 ≥8 次即视为轨迹候选 */
const PAIR_RUN = /\[(-?\d{1,3}\.\d{3,},\s*-?\d{1,2}\.\d{3,})\](,\[(-?\d{1,3}\.\d{3,},\s*-?\d{1,2}\.\d{3,})\]){7,}/g

async function probe(slug) {
  const html = await httpGet(`${BASE}/entry/${slug}`)
  console.log(`\n##### ${slug} (${html.length} chars)`)

  const inline = html.match(PAIR_RUN) || []
  console.log(`  页面内嵌坐标串: ${inline.length} 段` + (inline.length ? `，最长 ${Math.max(...inline.map((s) => s.length))} 字符` : ''))
  if (inline.length) {
    const longest = inline.sort((a, b) => b.length - a.length)[0]
    const pts = JSON.parse('[' + longest + ']')
    console.log(`    最长段 ${pts.length} 点，首 ${JSON.stringify(pts[0])} 尾 ${JSON.stringify(pts[pts.length - 1])}`)
  }

  const ctx = []
  ;['trajectory', 'centerline', 'groundTrack'].forEach((kw) => {
    const i = html.indexOf(kw)
    ctx.push(`${kw}=${i >= 0 ? 'yes@' + i : 'no'}`)
  })
  console.log('  关键字:', ctx.join(' '))
  if (/trajectory/i.test(html)) {
    const i = html.search(/trajectory/i)
    console.log('  trajectory 上下文:', html.slice(Math.max(0, i - 120), i + 220).replace(/\s+/g, ' '))
  }

  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9_\-.]+\.js/g) || [])]
  console.log(`  引用 chunk ${chunks.length} 个`)
  return chunks
}

async function main() {
  const a = await probe('launch-f9-nrol-95')
  const b = await probe('launch-starship-flight-13')
  const onlyStarship = b.filter((c) => !a.includes(c))
  console.log('\n星舰页独有 chunk:', onlyStarship.length)
  onlyStarship.slice(0, 10).forEach((c) => console.log('   ' + c))

  // 在 F9 页独有 chunk 里找坐标串（轨迹可能懒加载在 chunk 内）
  const onlyF9 = a.filter((c) => !b.includes(c))
  console.log('\nF9 页独有 chunk:', onlyF9.length)
  for (const c of onlyF9.slice(0, 6)) {
    try {
      const js = await httpGet(BASE + c)
      const hits = js.match(PAIR_RUN) || []
      const longest = hits.length ? Math.max(...hits.map((s) => s.length)) : 0
      console.log(`   ${c} → ${js.length} chars, 坐标串 ${hits.length} 段, 最长 ${longest}`)
    } catch (e) {
      console.log(`   ${c} → ERROR ${(e && e.message) || e}`)
    }
  }
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
