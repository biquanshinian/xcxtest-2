/* NSF 抓取兜底冒烟：单篇 403 → feed 兜底；栏目 feed 全量拉取 */
const path = require('path')
const oaFetch = require(path.join(__dirname, '../cloudfunctions/adminGateway/oaFetchArticle.js'))

;(async () => {
  // 1) 用户报错的原始 URL（带 #more 锚点）
  const url = 'https://www.nasaspaceflight.com/2026/08/launch-preview-080326/#more-114437'
  console.log('[1] fetchArticle', url)
  const art = await oaFetch.fetchArticle(url)
  console.log('  title:', art.title)
  console.log('  text len:', art.text.length, '| imgs:', art.imageUrls.length, '| cover:', !!art.coverUrl)
  console.log('  sourceUrl:', art.sourceUrl)
  console.log('  slots in text:', (art.text.match(/\[\[IMG:\d+\]\]/g) || []).length)
  if (!art.title || art.text.length < 500 || !art.imageUrls.length) throw new Error('article fallback FAIL')

  // 2) 栏目 feed 全量（authorMatch 留空）
  for (const feed of [
    'https://www.nasaspaceflight.com/news/spacex/feed/',
    'https://www.nasaspaceflight.com/news/international/chinese/feed/'
  ]) {
    console.log('\n[2] fetchRssByAuthor (no author filter)', feed)
    const list = await oaFetch.fetchRssByAuthor({ rssUrl: feed, authorMatch: '', limit: 8 })
    console.log('  items:', list.length)
    const a = list[0]
    console.log('  first:', a.title.slice(0, 60), '| text:', a.text.length, '| imgs:', a.imageUrls.length)
    if (!list.length || !a.text || a.text.length < 300) throw new Error('feed track FAIL: ' + feed)
  }

  // 3) 候选 feed 推导
  console.log('\n[3] candidateFeedsFor:', oaFetch.candidateFeedsFor(url))
  console.log('\nALL OK')
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e)
  process.exit(1)
})
