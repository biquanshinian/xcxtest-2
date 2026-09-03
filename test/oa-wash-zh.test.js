const test = require('node:test')
const assert = require('node:assert/strict')
const oaFetch = require('../cloudfunctions/adminGateway/oaFetchArticle')
const helpers = require('../cloudfunctions/adminGateway/oaStudioHelpers')

test('extractArticleUrl：跳过 YouTube / X，优先 NSF', () => {
  const text =
    '本周航天动态 https://youtu.be/abc123 https://x.com/NASASpaceflight/status/1 https://www.nasaspaceflight.com/2026/08/this-week/'
  assert.equal(oaFetch.isNonArticleWashUrl('https://youtu.be/abc123'), true)
  assert.equal(oaFetch.isNonArticleWashUrl('https://x.com/foo/status/1'), true)
  assert.equal(oaFetch.isNonArticleWashUrl('https://www.nasaspaceflight.com/2026/08/foo/'), false)
  assert.match(oaFetch.extractArticleUrl(text), /nasaspaceflight/)
  assert.equal(oaFetch.extractArticleUrl('看这个 https://youtube.com/watch?v=1'), '')
  assert.match(
    oaFetch.pickWashableArticleUrl('https://x.com/a/1', '详情 -> https://www.nasaspaceflight.com/2026/08/foo/'),
    /nasaspaceflight/
  )
})

test('sanitizeArticleTitle：去掉 Elysia / @ 转发标题', () => {
  const t = helpers.sanitizeArticleTitle(
    '本周航天动态，由 Elysia Segal (@elysiasegal) 带来',
    '# 猎鹰重型将发射罗马望远镜\n\n正文足够长用来当标题。'
  )
  assert.equal(helpers.looksLikeRepostTitle('本周航天动态，由 Elysia Segal (@elysiasegal) 带来'), true)
  assert.doesNotMatch(t, /Elysia|@elysia/i)
  assert.match(t, /猎鹰|罗马/)
})

test('stripSocialAttributionMarkdown：剥图片来源/浏览量/由@带来', () => {
  const md = [
    '猎鹰重型将发射罗马望远镜。',
    '',
    '图片来源为 NASA/John Kraus。',
    '该动态发布于 2026 年 8 月 29 日 凌晨 5:28，浏览量 1.2K。',
    '本周航天动态，由 Elysia Segal (@elysiasegal) 带来',
    '',
    '窗口仍待确认。'
  ].join('\n')
  const out = helpers.stripSocialAttributionMarkdown(md)
  assert.match(out, /猎鹰重型/)
  assert.match(out, /窗口仍待确认/)
  assert.doesNotMatch(out, /图片来源|浏览量|elysiasegal/)
})

test('isMostlyChineseText 能识别已译推文', () => {
  const zh = '本周航天动态。猎鹰重型计划发射南希·格雷斯·罗马太空望远镜，窗口待确认。'
  assert.equal(helpers.isMostlyChineseText(zh, 24), true)
  assert.equal(helpers.isMostlyEnglishText(zh, 40), false)
  assert.equal(
    helpers.isMostlyEnglishText('This Week In Spaceflight by Elysia Segal on YouTube Aug 29 2026 extra words here.', 40),
    true
  )
})

test('looksLikeLlmFallbackMarkdown：待人工改写仍拦截推送', () => {
  assert.equal(helpers.looksLikeLlmFallbackMarkdown('# 待人工改写\n\n> 自动生成未完成汉化'), true)
  assert.equal(helpers.looksLikeLlmFallbackMarkdown('# 猎鹰重型将发射罗马望远镜\n\n窗口待确认。'), false)
})
