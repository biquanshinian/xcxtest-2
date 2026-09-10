const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseFrontmatter,
  normalizeImportBrand,
  normalizeImportType,
  inferBrandFromDir,
  captionFromMarkdown,
  resolveImportMeta,
  titleFromMarkdown,
  parseCli
} = require('../.cursor/skills/oa-update-log/scripts/import-to-drafts.js')

test('parseFrontmatter：抽出 brand/type，正文从标题开始', () => {
  const { meta, body } = parseFrontmatter(
    '---\ntype: newspic\nbrand: mars_space\n---\n# 标题\n\n正文\n'
  )
  assert.equal(meta.type, 'newspic')
  assert.equal(meta.brand, 'mars_space')
  assert.equal(body.startsWith('# 标题'), true)
})

test('parseFrontmatter：无文首时原文不动', () => {
  const md = '# 标题\n\n正文'
  const { meta, body } = parseFrontmatter(md)
  assert.deepEqual(meta, {})
  assert.equal(body, md)
})

test('normalizeImportBrand / Type', () => {
  assert.equal(normalizeImportBrand('火星空间探索'), 'mars_space')
  assert.equal(normalizeImportBrand('mars-space'), 'mars_space')
  assert.equal(normalizeImportType('贴图'), 'newspic')
  assert.equal(normalizeImportType('图文'), 'news')
  assert.equal(normalizeImportType(''), '')
})

test('parseCli：--brand --newspic 与路径', () => {
  const cli = parseCli(['docs/wechat-oa/hot-x', '--brand', 'mars_space', '--newspic', '--dry'])
  assert.equal(cli.path, 'docs/wechat-oa/hot-x')
  assert.equal(cli.brand, 'mars_space')
  assert.equal(cli.newspic, true)
  assert.equal(cli.dry, true)
})

test('parseCli：--brand 后面是开关时不吞掉', () => {
  const cli = parseCli(['--brand', '--newspic', 'docs/wechat-oa/hot-x'])
  assert.equal(cli.brand, '')
  assert.equal(cli.newspic, true)
  assert.equal(cli.path, 'docs/wechat-oa/hot-x')
})

test('hot-* 目录默认 mars_space', () => {
  assert.equal(inferBrandFromDir('docs/wechat-oa/hot-2026-09-05-zq3'), 'mars_space')
  assert.equal(inferBrandFromDir('docs/wechat-oa/2026-09-roman-space'), '')
  const inferred = resolveImportMeta('docs/wechat-oa/hot-2026-09-05-x', {}, '', '')
  assert.equal(inferred.brandKey, 'mars_space')
  assert.equal(inferred.wxArticleType, 'news')
})

test('贴图标题截到 32 字，文案去掉标题和图', () => {
  const title = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超出'
  assert.equal(titleFromMarkdown(`# ${title}\n\n正文`, 'newspic').length, 32)
  const cap = captionFromMarkdown('# 标题\n\n![封面](cover.jpg)\n\n回收场那几张图对不上。\n')
  assert.equal(cap.includes('#'), false)
  assert.equal(cap.includes('cover.jpg'), false)
  assert.equal(cap.includes('回收场'), true)
})
