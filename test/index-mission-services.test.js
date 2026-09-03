/**
 * node --test test/index-mission-services.test.js
 * 列表合并排序口径：缺失/非法 launchTime 沉底（与 sortUpcomingMissionsByNetAsc、
 * 云端 net-patch-policy.sortResultsByNetAsc 一致），不得按 0 顶到列表最前。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { mergeMissionPages } = require('../utils/index-mission-services.js')

const passThroughFilter = (list) => list

test('upcoming：缺失 launchTime 沉底，其余按 NET 升序', () => {
  const merged = mergeMissionPages(
    'upcoming',
    [
      { id: 'no-time', launchTime: '' },
      { id: 'late', launchTime: '2026-09-01T00:00:00Z' }
    ],
    [
      { id: 'soon', launchTime: '2026-08-13T12:00:00Z' },
      { id: 'bad-time', launchTime: 'not-a-date' }
    ],
    passThroughFilter
  )
  assert.deepEqual(
    merged.map((m) => m.id),
    ['soon', 'late', 'no-time', 'bad-time'],
    '有时间的升序在前；无时间/非法时间沉底'
  )
})

test('upcoming：与 sortUpcomingMissionsByNetAsc 口径一致', () => {
  const { sortUpcomingMissionsByNetAsc } = require('../utils/index-launch-state.js')
  const rows = () => [
    { id: 'b', launchTime: '2026-08-20T00:00:00Z' },
    { id: 'x', launchTime: '' },
    { id: 'a', launchTime: '2026-08-14T00:00:00Z' }
  ]
  const viaMerge = mergeMissionPages('upcoming', rows(), [], passThroughFilter).map((m) => m.id)
  const viaSort = sortUpcomingMissionsByNetAsc(rows()).map((m) => m.id)
  assert.deepEqual(viaMerge, viaSort, '首屏合并与 live patch 重排必须同序，避免 TBD 卡位置对调')
})

test('completed：按时间降序，最新在前', () => {
  const merged = mergeMissionPages(
    'completed',
    [{ id: 'old', launchTime: '2026-08-01T00:00:00Z' }],
    [{ id: 'new', launchTime: '2026-08-11T00:00:00Z' }],
    passThroughFilter
  )
  assert.deepEqual(merged.map((m) => m.id), ['new', 'old'])
})
