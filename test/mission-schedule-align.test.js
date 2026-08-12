/**
 * 列表卡 ↔ 详情日程同源对齐
 * 运行：node --test test/mission-schedule-align.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  alignMissionScheduleAndStatus,
  scheduleFieldsDiffer
} = require('../pages/mission-detail/utils/mission-schedule-align.js')

const now = Date.parse('2026-08-12T06:00:00Z')

test('仅有列表：沿用列表时间与状态', () => {
  const list = {
    id: 'a',
    launchTime: '2026-08-17T02:00:00Z',
    statusId: 8,
    statusAbbrev: 'TBC',
    statusBadgeText: '待确认'
  }
  const aligned = alignMissionScheduleAndStatus(list, null, now)
  assert.equal(aligned.launchTime, '2026-08-17T02:00:00Z')
  assert.equal(aligned.status && aligned.status.id, 8)
  assert.equal(aligned.preferredDetail, false)
  assert.equal(aligned.source, 'list')
})

test('近窗 Go 详情治愈列表远窗待定：用详情近时间', () => {
  const list = {
    id: 'a',
    launchTime: '2026-08-31T00:00:00Z',
    statusId: 2,
    statusAbbrev: 'TBD',
    statusBadgeText: '待定'
  }
  const detail = {
    id: 'a',
    launchTime: '2026-08-15T12:00:00Z',
    statusId: 1,
    statusAbbrev: 'Go',
    statusBadgeText: '就绪'
  }
  const aligned = alignMissionScheduleAndStatus(list, detail, now)
  assert.equal(aligned.launchTime, '2026-08-15T12:00:00Z')
  assert.equal(aligned.status && aligned.status.id, 1)
  assert.equal(aligned.preferredDetail, true)
})

test('远窗推迟占位不能盖掉近窗列表：保留列表近时间', () => {
  const list = {
    id: 'a',
    launchTime: '2026-08-15T12:00:00Z',
    statusId: 1,
    statusAbbrev: 'Go',
    statusBadgeText: '就绪'
  }
  const detail = {
    id: 'a',
    launchTime: '2026-08-31T00:00:00Z',
    statusId: 2,
    statusAbbrev: 'TBD',
    statusBadgeText: '待定'
  }
  const aligned = alignMissionScheduleAndStatus(list, detail, now)
  assert.equal(aligned.launchTime, '2026-08-15T12:00:00Z')
  assert.equal(aligned.status && aligned.status.id, 1)
  assert.equal(aligned.preferredDetail, false)
  assert.equal(aligned.keptCached, true)
})

test('真实长推迟（具体钟点 Go）：详情时间胜出', () => {
  const list = {
    id: 'a',
    launchTime: '2026-08-15T12:00:00Z',
    statusId: 1,
    statusAbbrev: 'Go'
  }
  const detail = {
    id: 'a',
    launchTime: '2026-08-25T18:40:00Z',
    statusId: 1,
    statusAbbrev: 'Go'
  }
  const aligned = alignMissionScheduleAndStatus(list, detail, now)
  assert.equal(aligned.launchTime, '2026-08-25T18:40:00Z')
  assert.equal(aligned.preferredDetail, true)
  assert.equal(aligned.keptCached, false)
})

test('scheduleFieldsDiffer：时间或状态不一致时为 true', () => {
  const cached = {
    launchTime: '2026-08-31T00:00:00Z',
    statusId: 2
  }
  const aligned = {
    launchTime: '2026-08-15T12:00:00Z',
    status: { id: 1 }
  }
  assert.equal(scheduleFieldsDiffer(cached, aligned), true)
  assert.equal(
    scheduleFieldsDiffer(
      { launchTime: '2026-08-15T12:00:00Z', statusId: 1 },
      aligned
    ),
    false
  )
})
