const h = require('../cloudfunctions/adminGateway/oaStudioHelpers.js')

const defaultCover = 'https://example.com/default-cover.jpg'
const brand = { defaultCoverUrl: defaultCover }
const cfg = { defaultCoverUrl: defaultCover }

// 1) 事件无配图，只用默认封面
const coverOnly = {
  coverUrl: defaultCover,
  imageUrls: [defaultCover],
  markdown: '# 标题\n\n正文没有图。\n',
  sourceSlottedBody: '正文没有图。'
}
console.log(
  'cover-only → []',
  JSON.stringify(h.resolveBodyImageUrls(coverOnly, brand, cfg))
)
if (h.resolveBodyImageUrls(coverOnly, brand, cfg).length) throw new Error('cover-only should be empty')

// 2) imageUrls 挂了废链但正文/原稿无图槽 → 仍视为仅封面
const junkUrls = {
  coverUrl: defaultCover,
  imageUrls: ['https://bad.example/a.jpg', 'https://bad.example/b.jpg'],
  markdown: '纯文字',
  sourceSlottedBody: '纯文字'
}
console.log('junk imageUrls no slots → []', h.resolveBodyImageUrls(junkUrls, brand, cfg))
if (h.resolveBodyImageUrls(junkUrls, brand, cfg).length) throw new Error('junk should be empty')

// 3) 正文真有图
const withBody = {
  coverUrl: defaultCover,
  imageUrls: ['https://cdn.example/a.jpg'],
  markdown: '见下图\n\n![配图1](https://cdn.example/a.jpg)\n',
  sourceSlottedBody: '见下图\n\n[[IMG:1]]'
}
const body = h.resolveBodyImageUrls(withBody, brand, cfg)
console.log('with body →', body)
if (body.length !== 1 || body[0] !== 'https://cdn.example/a.jpg') throw new Error('body imgs wrong')

// 4) 默认封面也写进了正文 → 保留（需要转存）
const coverInMd = {
  coverUrl: defaultCover,
  imageUrls: [defaultCover],
  markdown: `![x](${defaultCover})`,
  sourceSlottedBody: '[[IMG:1]]'
}
console.log('cover in md → keep', h.resolveBodyImageUrls(coverInMd, brand, cfg))
if (h.resolveBodyImageUrls(coverInMd, brand, cfg)[0] !== defaultCover) throw new Error('cover-in-md')

console.log('RESULT: OK')
