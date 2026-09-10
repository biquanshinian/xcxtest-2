const test = require('node:test')
const assert = require('node:assert/strict')
const helpers = require('../cloudfunctions/adminGateway/oaStudioHelpers')

test('normalizeWxArticleType：图片帖别名归到 newspic，其余为 news', () => {
  assert.equal(helpers.normalizeWxArticleType('newspic'), 'newspic')
  assert.equal(helpers.normalizeWxArticleType('图片帖'), 'newspic')
  assert.equal(helpers.normalizeWxArticleType('贴图'), 'newspic')
  assert.equal(helpers.normalizeWxArticleType(''), 'news')
  assert.equal(helpers.normalizeWxArticleType('news'), 'news')
})

test('isNewspicDraft：根字段或 variants.wechat.articleType', () => {
  assert.equal(helpers.isNewspicDraft({ wxArticleType: 'newspic' }), true)
  assert.equal(helpers.isNewspicDraft({ variants: { wechat: { articleType: '图片消息' } } }), true)
  assert.equal(helpers.isNewspicDraft({ wxArticleType: 'news' }), false)
  assert.equal(helpers.isNewspicDraft({}), false)
})

test('collectNewspicImageUrls：封面优先、去重、最多 20 张', () => {
  const urls = Array.from({ length: 25 }, (_, i) => `https://cdn.example/${i}.jpg`)
  const out = helpers.collectNewspicImageUrls({
    coverUrl: 'https://cdn.example/cover.jpg',
    imageUrls: ['https://cdn.example/cover.jpg', ...urls],
    markdown: 'hello ![x](https://cdn.example/md.jpg)'
  })
  assert.equal(out[0], 'https://cdn.example/cover.jpg')
  assert.equal(out.length, helpers.NEWSPIC_MAX_IMAGES)
  assert.equal(new Set(out).size, out.length)
  assert.equal(out.includes('https://cdn.example/md.jpg'), false)
})

test('collectNewspicImageUrls：未保存图序时才从 Markdown 补图', () => {
  const fromMd = helpers.collectNewspicImageUrls({
    markdown: 'hello ![x](https://cdn.example/md.jpg)'
  })
  assert.deepEqual(fromMd, ['https://cdn.example/md.jpg'])
})

test('sanitizeNewspicContent：去 HTML/Markdown 图/IMG 占位，并按 2KB 截断', () => {
  const cleaned = helpers.sanitizeNewspicContent(
    '<p>发射升空</p> ![图](https://a.com/x.jpg) 详见 [链接](https://a.com) [[IMG:1]]'
  )
  assert.equal(cleaned.includes('<p>'), false)
  assert.equal(cleaned.includes('https://'), false)
  assert.equal(cleaned.includes('[[IMG:'), false)
  assert.match(cleaned, /发射升空/)
  assert.match(cleaned, /链接/)
  const long = '汉'.repeat(2000)
  const sliced = helpers.sanitizeNewspicContent(long)
  assert.ok(Buffer.byteLength(sliced, 'utf8') <= helpers.NEWSPIC_CONTENT_MAX_BYTES)
})

test('resolveNewspicContent：优先 wxPicContent，摘要被封面链污染时回退正文', () => {
  const resolved = helpers.resolveNewspicContent({
    wxPicContent: '窗口已定',
    digest: '封面 https://x.com/a.jpg'
  })
  assert.match(resolved, /窗口已定/)
  assert.equal(resolved.includes('#小程序:'), false)
  assert.match(resolved, /#航天#/)
  const fromMd = helpers.resolveNewspicContent({
    digest: 'https://cdn.example/cover.jpg',
    markdown: '# 标题\n\n载荷已确认入轨。'
  })
  assert.match(fromMd, /载荷已确认入轨/)
  assert.equal(fromMd.includes('#小程序:'), false)
})

test('finalizeNewspicContent：去占位、按内容补 #话题#，不附小程序短链', () => {
  const title = '太空行走期间拍摄地球倒影与气闸照片'
  const body =
    '周二太空行走期间，使用尼康 D5 相机拍摄了初步视图。自拍时地球在头盔中的倒影，当时乘坐 CSA 的 Canadarm2 机械臂。[[IMG:1]]'
  const out = helpers.finalizeNewspicContent(body, { title })
  assert.equal(out.includes('[[IMG:'), false)
  assert.match(out, /#太空行走#/)
  assert.match(out, /#国际空间站#/)
  assert.equal(out.includes('#小程序:'), false)
  assert.equal(/#太空行走(?!#)/.test(out), false)
  assert.equal(helpers.finalizeNewspicContent(out, { title }), out)
  const editor = helpers.newspicBodyForEditor(out)
  assert.equal(editor.includes('[[IMG:'), false)
  assert.equal(editor.includes('#小程序:'), false)
  assert.match(editor, /#太空行走#/)
})

test('finalizeNewspicContent：目录话题随正文重算，自定义话题保留', () => {
  const tiangong = helpers.finalizeNewspicContent('航天员从天宫气闸出舱。', { title: '出舱活动' })
  assert.match(tiangong, /#太空行走#/)
  assert.match(tiangong, /#中国空间站#/)
  assert.equal(tiangong.includes('#国际空间站'), false)
  const stale = helpers.finalizeNewspicContent(
    '星舰完成静态点火。\n\n#中国空间站# #载人航天#\n#自定义热点#\n#小程序://火星探索/14h5DEboAtHOcwf',
    { title: '星舰静态点火' }
  )
  assert.match(stale, /#星舰#/)
  assert.equal(stale.includes('#中国空间站'), false)
  assert.match(stale, /#自定义热点#/)
  assert.equal(stale.includes('#小程序:'), false)
})

test('formatWxTopic / peelNewspicFooter：两侧井号与旧稿单侧#都能识别', () => {
  assert.equal(helpers.formatWxTopic('#NASA'), '#NASA#')
  assert.equal(helpers.formatWxTopic('#NASA#'), '#NASA#')
  const peeled = helpers.peelNewspicFooter('NASA完成安装。\n\n#NASA#\n#小程序://火星探索/abc')
  assert.match(peeled.body, /NASA完成安装/)
  assert.deepEqual(peeled.tags, ['#NASA'])
  const nasa = helpers.finalizeNewspicContent(
    '约翰霍普金斯应用物理实验室完成飞行结构电线束安装。\n#NASA\n#小程序://火星探索/14h5DEboAtHOcwf',
    { title: 'NASA完成Dragonfly飞行结构电线束安装' }
  )
  assert.match(nasa, /#NASA#/)
  assert.equal(nasa.includes('#小程序:'), false)
})

test('sliceUtf8Bytes：0 字节上限返回空串，不回退到 2KB', () => {
  assert.equal(helpers.sliceUtf8Bytes('汉', 0), '')
})

test('buildNewspicArticle：组装 image_info，无图则抛错', () => {
  const article = helpers.buildNewspicArticle({
    title: '显微组发射升空额外很长的标题会被截断到三十二字限制之外',
    content: '<b>短讯</b>',
    imageMediaIds: ['id-a', 'id-b'],
    thumbMediaId: 'thumb-1',
    needOpenComment: true,
    author: '火星空间探索',
    onlyFansCanComment: false
  })
  assert.equal(article.article_type, 'newspic')
  assert.ok(article.title.length <= 32)
  assert.equal(article.author, '火星空间探索')
  assert.equal(article.content.includes('<b>'), false)
  assert.deepEqual(article.image_info.image_list, [
    { image_media_id: 'id-a' },
    { image_media_id: 'id-b' }
  ])
  assert.equal(article.thumb_media_id, 'thumb-1')
  assert.equal(article.need_open_comment, 1)
  assert.throws(() => helpers.buildNewspicArticle({ title: 'x', imageMediaIds: [] }))
})

test('newspicImagesReady：必须每张图都有永久素材 id', () => {
  const urls = ['https://a.com/1.jpg', 'https://a.com/2.jpg']
  assert.equal(
    helpers.newspicImagesReady({
      wxArticleType: 'newspic',
      imagesReady: true,
      imagePrepKind: 'newspic',
      imageUrls: urls,
      wxPicEntries: [{ u: urls[0], id: 'm1' }]
    }),
    false
  )
  assert.equal(
    helpers.newspicImagesReady({
      wxArticleType: 'newspic',
      imagesReady: true,
      imagePrepKind: 'newspic',
      imageUrls: urls,
      wxPicEntries: [
        { u: urls[0], id: 'm1' },
        { u: urls[1], id: 'm2' }
      ]
    }),
    true
  )
})

test('sliceUtf8Bytes：截断时不切开汉字', () => {
  const s = '汉'.repeat(800)
  const sliced = helpers.sanitizeNewspicContent(s)
  assert.ok(Buffer.byteLength(sliced, 'utf8') <= helpers.NEWSPIC_CONTENT_MAX_BYTES)
  assert.equal(sliced.includes('\uFFFD'), false)
  assert.match(sliced, /汉$/)
})

test('picMediaIdsForUrls：按图序输出永久素材 id', () => {
  const ids = helpers.picMediaIdsForUrls(
    ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg'],
    { 'https://a.com/1.jpg': 'm1', 'https://a.com/3.jpg': 'm3' }
  )
  assert.deepEqual(ids, ['m1', 'm3'])
})
