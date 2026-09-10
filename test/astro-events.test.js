/**
 * node --test test/astro-events.test.js
 * 天象表按年生成：流星雨/二分二至自动套年；日食等一次性事件不跨年复用。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  beijingDateStr,
  beijingYear,
  buildAstroEvents,
  buildAstroEventsCovering,
  getTodayAstroEvent
} = require('../pages/space-explore/astro-events.js')

test('space-explore 与 morningBriefing 天象表副本一致', () => {
  const a = fs.readFileSync(path.join(__dirname, '../pages/space-explore/astro-events.js'), 'utf8').replace(/\r\n/g, '\n')
  const b = fs.readFileSync(path.join(__dirname, '../cloudfunctions/morningBriefing/astro-events.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(a, b, '请把 pages/space-explore/astro-events.js 的改动同步到 cloudfunctions/morningBriefing/astro-events.js')
})

test('北京日期按 UTC+8 切日', () => {
  assert.equal(beijingDateStr(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01')
  assert.equal(beijingYear(Date.parse('2026-12-31T16:00:00Z')), 2027)
  assert.equal(beijingYear(Date.parse('2026-12-31T15:59:00Z')), 2026)
})

test('2026 含英仙座与日全食，且英仙座排在同日前面', () => {
  const list = buildAstroEvents(2026)
  const sameDay = list.filter((e) => e.date === '2026-08-12').map((e) => e.title)
  assert.deepEqual(sameDay, ['英仙座流星雨极大', '日全食'])
  assert.ok(list.some((e) => e.date === '2026-03-29' && e.title === '日偏食'))
})

test('2027 套用流星雨日期，不复用 2026 日食', () => {
  const list = buildAstroEvents(2027)
  assert.ok(list.some((e) => e.date === '2027-08-12' && e.title === '英仙座流星雨极大'))
  assert.ok(list.some((e) => e.date === '2027-12-14' && e.title === '双子座流星雨极大'))
  assert.equal(list.filter((e) => e.title === '日全食' || e.title === '日偏食').length, 0)
})

test('简报：当年精确命中；一次性事件不跨年', () => {
  const perseids = getTodayAstroEvent('2026-08-12')
  assert.equal(perseids.title, '英仙座流星雨极大')
  assert.equal(perseids.icon, 'meteor')
  assert.equal(getTodayAstroEvent('2027-08-12').title, '英仙座流星雨极大')
  assert.equal(getTodayAstroEvent('2026-03-29').title, '日偏食')
  assert.equal(getTodayAstroEvent('2027-03-29'), null)
})

test('跨年日期覆盖当年与下一年', () => {
  const list = buildAstroEventsCovering(['2026-12-31', '2027-01-01'])
  assert.ok(list.some((e) => e.date === '2026-12-21' && e.title === '冬至'))
  assert.ok(list.some((e) => e.date === '2027-01-03' && e.title === '象限仪座流星雨极大'))
})

test('用户可见标题不再写死 2026', () => {
  const root = path.join(__dirname, '..')
  const files = [
    'subpackages/index-extra/components/calendar-stats/index.wxml',
    'pages/space-explore/astro-calendar.wxml',
    'subpackages/index-extra/components/launch-calendar/index.wxml',
    'subpackages/profile-extra/utils/space-quiz.js'
  ]
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.equal(src.includes('2026全球发射数据'), false, rel)
    assert.equal(src.includes('2026 天象日历'), false, rel)
    assert.equal(src.includes('目前（2026年）'), false, rel)
    assert.equal(src.includes('end="2030-12"'), false, rel)
  }
  const statsWxml = fs.readFileSync(path.join(root, files[0]), 'utf8')
  assert.ok(statsWxml.includes('{{statsYear}}全球发射数据'))
  const astroWxml = fs.readFileSync(path.join(root, files[1]), 'utf8')
  assert.ok(astroWxml.includes('{{astroYear}} 天象日历'))
  const calWxml = fs.readFileSync(path.join(root, files[2]), 'utf8')
  assert.ok(calWxml.includes('end="{{pickerEnd}}"'))
})
