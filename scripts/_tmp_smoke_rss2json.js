// 冒烟：rss2json 中转 + loadRssItems 在直连失败路径
const path = require('path')
const fetch = require(path.join(__dirname, '../cloudfunctions/adminGateway/oaFetchArticle.js'))

;(async () => {
  const feed = 'https://www.nasaspaceflight.com/news/spacex/feed/'
  const items = await fetch.loadRssItemsViaRss2Json(feed)
  console.log('rss2json items:', items.length)
  console.log('first title:', items[0] && items[0].title)
  console.log('first link:', items[0] && items[0].link)
  console.log('contentHtml len:', items[0] && String(items[0].contentHtml || '').length)
  if (!items.length) throw new Error('no items')
  if (!items[0].contentHtml || items[0].contentHtml.length < 200) throw new Error('content too short')

  const arts = await fetch.fetchRssByAuthor({ rssUrl: feed, authorMatch: '', limit: 3 })
  console.log('fetchRssByAuthor:', arts.length, arts.map((a) => a.title.slice(0, 40)))
  if (!arts.length) throw new Error('fetchRssByAuthor empty')
  if (!arts[0].text || arts[0].text.length < 80) throw new Error('article text too short')

  const chinese = await fetch.fetchRssByAuthor({
    rssUrl: 'https://www.nasaspaceflight.com/news/international/chinese/feed/',
    authorMatch: '',
    limit: 2
  })
  console.log('chinese feed:', chinese.length, chinese.map((a) => a.title.slice(0, 40)))
  if (!chinese.length) throw new Error('chinese feed empty')

  console.log('RESULT: OK')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
