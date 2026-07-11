/**
 * 示范单测：utils/nsf-checklist-merge.js（依赖同目录 nsf-checklist-i18n.js，均无云依赖）
 * 运行：node --test test/   或   npm test
 *
 * 覆盖：抓取快照(statuses) 与后台覆盖(itemOverrides) 的合并优先级、
 * 手动 done 覆盖、中文标题回退、以及非法项过滤。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeNsfChecklistDisplay } = require('../utils/nsf-checklist-merge.js')

test('后台 titleZh 覆盖优先于机翻/英文', () => {
  const out = mergeNsfChecklistDisplay(
    [{ id: 1, titleEn: 'Static Fire', titleZh: '机翻静态点火', done: false }],
    { 1: { titleZh: '人工中文标题' } }
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].title, '人工中文标题')
  // titleZhAuto 仍保留机翻/回退结果
  assert.equal(out[0].titleZhAuto, '机翻静态点火')
})

test('无 titleZh 时回退到 i18n 短语翻译', () => {
  const out = mergeNsfChecklistDisplay(
    [{ id: 99, titleEn: 'Static Fire', done: false }],
    {}
  )
  assert.equal(out[0].title, '静态点火')
})

test('manualDone 覆盖网页抓取的 done 状态', () => {
  const out = mergeNsfChecklistDisplay(
    [
      { id: 'a', titleEn: 'A', doneWeb: false },
      { id: 'b', titleEn: 'B', doneWeb: true }
    ],
    { a: { manualDone: true }, b: { manualDone: false } }
  )
  const byId = Object.fromEntries(out.map((x) => [x.id, x.done]))
  assert.equal(byId.a, true)
  assert.equal(byId.b, false)
})

test('done 在无覆盖时取 doneWeb（doneWeb 优先于 done）', () => {
  const out = mergeNsfChecklistDisplay(
    [{ id: 'x', titleEn: 'X', done: true, doneWeb: false }],
    {}
  )
  assert.equal(out[0].done, false)
})

test('过滤非法项（null / 无标题）并对缺失 id 生成 nsf_<i>', () => {
  const out = mergeNsfChecklistDisplay(
    [null, { titleEn: 'Rollout' }, { id: 5 }],
    {}
  )
  // 第 1 项为 null 被过滤；第 3 项无任何标题被过滤
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'nsf_1')
  assert.equal(out[0].title, '转运')
})

test('入参非数组时安全返回空数组', () => {
  assert.deepEqual(mergeNsfChecklistDisplay(null, null), [])
  assert.deepEqual(mergeNsfChecklistDisplay(undefined, undefined), [])
})
