/**
 * 星舰飞行时间线汉化
 * 运行：node --test test/ll2-timeline-i18n.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { translateTimelineText } = require('../subpackages/progress-extra/utils/ll2-timeline-i18n.js')
const { enrichLl2TimelineRow } = require('../subpackages/progress-extra/utils/ll2-launch-timeline.js')

const TIMELINE_COPIES = [
  'subpackages/progress-extra/utils/ll2-timeline-i18n.js',
  'subpackages/mission-sim/utils/ll2-timeline-i18n.js',
  'pages/mission-detail/utils/ll2-timeline-i18n.js'
]

test('常见时间线节点译成中文', () => {
  assert.equal(translateTimelineText('Liftoff'), '升空')
  assert.equal(translateTimelineText('MECO'), '一级发动机关机')
  assert.equal(translateTimelineText('Hot Staging'), '热分离')
  assert.equal(translateTimelineText('Max-Q'), '最大动压')
  assert.equal(translateTimelineText('Landing Burn'), '着陆点火')
})

test('展示行标题走汉化', () => {
  const row = enrichLl2TimelineRow({ abbrev: 'Liftoff', description: 'Liftoff', relativeTime: 'PT0S' }, 0)
  assert.equal(row.title, '升空')
})

test('分包时间线 i18n 副本一致', () => {
  const root = path.join(__dirname, '..')
  const base = fs.readFileSync(path.join(root, TIMELINE_COPIES[0]), 'utf8').replace(/\r\n/g, '\n')
  for (const rel of TIMELINE_COPIES.slice(1)) {
    const other = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(other, base, rel + ' 与 progress-extra 副本不一致')
  }
})
