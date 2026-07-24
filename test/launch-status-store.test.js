const test = require('node:test')
const assert = require('node:assert/strict')
const {
  mergeLaunchObservation,
  mergeObservationList,
  projectLaunchRecords
} = require('../utils/launch-status-store.js')

const SKYROOT_ID = '10fa7952-f00b-4292-80a2-4207e208844e'

function observation(statusId, observedAtMs, extra) {
  return {
    id: SKYROOT_ID,
    name: 'Skyroot | Vikram-I Demo Flight',
    net: '2026-07-18T08:00:00Z',
    status: { id: statusId, name: `status-${statusId}`, abbrev: String(statusId) },
    observedAtMs,
    source: 'resolve',
    ...extra
  }
}

test('Go → In Flight → Deployed 单向升级', () => {
  const go = mergeLaunchObservation(null, observation(1, 100))
  const inflight = mergeLaunchObservation(go, observation(6, 200))
  const deployed = mergeLaunchObservation(inflight, observation(9, 300))
  assert.equal(deployed.status.id, 9)
})

test('旧 Go 和较新的普通 Go 都不能覆盖终态', () => {
  const deployed = mergeLaunchObservation(null, observation(9, 300))
  assert.equal(mergeLaunchObservation(deployed, observation(1, 100)).status.id, 9)
  assert.equal(mergeLaunchObservation(deployed, observation(1, 400)).status.id, 9)
})

test('显式权威纠错允许终态回退', () => {
  const deployed = mergeLaunchObservation(null, observation(9, 300))
  const corrected = mergeLaunchObservation(deployed, observation(1, 400, { correction: true, source: 'detail' }))
  assert.equal(corrected.status.id, 1)
})

test('NET 推后更新元数据但不降低终态', () => {
  const deployed = mergeLaunchObservation(null, observation(9, 300))
  const changed = mergeLaunchObservation(deployed, observation(1, 400, { net: '2026-07-19T08:00:00Z' }))
  assert.equal(changed.status.id, 9)
  assert.equal(changed.net, '2026-07-19T08:00:00Z')
})

test('同一 UUID 只能投影到一个列表，已终态不进入倒计时', () => {
  const records = mergeObservationList(new Map(), [observation(9, 300)])
  const mission = { id: SKYROOT_ID, launchTime: '2026-07-18T08:00:00Z', statusId: 1 }
  const projected = projectLaunchRecords({
    recordsById: records,
    upcoming: [mission],
    completed: [],
    now: Date.parse('2026-07-18T09:00:00Z')
  })
  assert.equal(projected.upcoming.length, 0)
  assert.equal(projected.completed.length, 1)
  assert.equal(projected.countdown, null)
})

test('未来任务的错误终态不会进入历史或覆盖 upcoming 状态', () => {
  const id = 'b89ab080-66c3-4831-85a9-38d85da71d30'
  const records = mergeObservationList(new Map(), [
    {
      id,
      net: '2026-08-06T19:30:00Z',
      status: { id: 4, name: 'Launch Failure', abbrev: 'Failure' },
      source: 'll2_updates',
      observedAtMs: Date.parse('2026-07-18T10:00:00Z')
    }
  ])
  const mission = {
    id,
    launchTime: '2026-08-06T19:30:00Z',
    status: '就绪',
    statusId: 1,
    countryDisplay: '日本',
    recoveryIcons: []
  }
  const projected = projectLaunchRecords({
    recordsById: records,
    upcoming: [mission],
    now: Date.parse('2026-07-18T11:00:00Z')
  })
  assert.equal(projected.completed.length, 0)
  assert.equal(projected.upcoming.length, 1)
  assert.equal(projected.upcoming[0].statusId, 1)
  assert.equal(projected.upcoming[0].countryDisplay, '日本')
})

test('较新的 resolve 可纠正 updates 误判的终态', () => {
  const failed = mergeLaunchObservation(null, observation(4, 100, { source: 'll2_updates', revision: 9 }))
  const corrected = mergeLaunchObservation(failed, observation(1, 200, { source: 'resolve', revision: 0 }))
  assert.equal(corrected.status.id, 1)
})

test('过 NET 的 Go 仍保留 upcoming，但倒计时选择下一条未来任务', () => {
  const past = { id: 'past', launchTime: '2020-01-01T00:00:00Z', statusId: 1 }
  const future = { id: 'future', launchTime: '2099-01-01T00:00:00Z', statusId: 1 }
  const projected = projectLaunchRecords({ upcoming: [past, future], now: Date.UTC(2026, 0, 1) })
  assert.deepEqual(
    projected.upcoming.map((item) => item.id),
    ['past', 'future']
  )
  assert.equal(projected.countdown.id, 'future')
})

test('同一 UUID 同时出现在两份 API 快照时仍只投影一次', () => {
  const upcoming = { id: SKYROOT_ID, launchTime: '2099-01-01T00:00:00Z', statusId: 1, marker: 'upcoming' }
  const staleCompleted = { id: SKYROOT_ID, launchTime: '2099-01-01T00:00:00Z', statusId: 1, marker: 'completed' }
  const projected = projectLaunchRecords({ upcoming: [upcoming], completed: [staleCompleted], now: 0 })
  assert.equal(projected.upcoming.length, 1)
  assert.equal(projected.completed.length, 0)
  assert.equal(projected.upcoming[0].marker, 'upcoming')
})

test('同一历史 UUID 后出现的完整 previous 卡覆盖旧状态瘦卡', () => {
  const stub = { id: 'done', launchTime: '2026-07-01T00:00:00Z', statusId: 3 }
  const full = {
    ...stub,
    countryDisplay: '美国',
    recoveryTagText: '可回收',
    recoveryIcons: [{ type: 'ASDS', status: 'success' }]
  }
  const projected = projectLaunchRecords({
    completed: [stub, full],
    now: Date.parse('2026-07-18T00:00:00Z')
  })
  assert.equal(projected.completed.length, 1)
  assert.equal(projected.completed[0].countryDisplay, '美国')
  assert.equal(projected.completed[0].recoveryTagText, '可回收')
  assert.equal(projected.completed[0].recoveryIcons.length, 1)
})

test('旧来源名称映射到标准优先级，重复 observation 不增加 revision', () => {
  const first = mergeLaunchObservation(null, observation(9, 300, { source: 'fetchLaunchStatuses' }))
  const repeated = mergeLaunchObservation(first, observation(9, 300, { source: 'fetchLaunchStatuses' }))
  assert.equal(first.sourcePriority, 30)
  assert.equal(repeated, first)
  assert.equal(repeated.revision, first.revision)
})

test('projectBadgeOntoMission 投影角标与分类', () => {
  const { projectBadgeOntoMission } = require('../utils/launch-status-store.js')
  const base = {
    id: SKYROOT_ID,
    name: 'Skyroot | Vikram-I Demo Flight',
    rocketName: 'Vikram-I',
    statusId: 1,
    statusBadgeText: '就绪',
    statusCategory: 'pending'
  }
  const projected = projectBadgeOntoMission(base, observation(6, 200))
  assert.equal(projected.statusId, 6)
  assert.equal(projected.statusCategory, 'inflight')
  assert.equal(projected.statusBadgeText, '飞行中')
  assert.equal(projected.rocketName, 'Vikram-I')
})

test('applyAuthoritativeStatus：列表飞行中优先于详情就绪（NET 已过）', () => {
  const { applyAuthoritativeStatus } = require('../utils/launch-status-store.js')
  const enrichment = {
    id: SKYROOT_ID,
    name: 'Skyroot | Vikram-I Demo Flight',
    rocketName: 'Vikram-I'
  }
  const listCard = {
    id: SKYROOT_ID,
    statusId: 6,
    statusAbbrev: 'In Flight',
    launchTime: '2026-07-18T08:00:00Z',
    _launchStateSource: 'launch_net_hourly_inflight',
    _launchStateObservedAtMs: 200
  }
  const detailCard = {
    id: SKYROOT_ID,
    statusId: 1,
    statusAbbrev: 'Go',
    launchTime: '2026-07-18T08:00:00Z',
    _launchStateSource: 'fetchLaunchDetail_status',
    _launchStateObservedAtMs: 400
  }
  const merged = applyAuthoritativeStatus(enrichment, [listCard, detailCard])
  assert.equal(merged.statusId, 6)
  assert.equal(merged.statusBadgeText, '飞行中')
})

test('applyAuthoritativeStatus：无时间戳的列表就绪不能压过详情飞行中', () => {
  const { applyAuthoritativeStatus } = require('../utils/launch-status-store.js')
  const enrichment = { id: SKYROOT_ID, name: 'Skyroot | Vikram-I Demo Flight' }
  const staleListGo = {
    id: SKYROOT_ID,
    statusId: 1,
    statusAbbrev: 'Go',
    launchTime: '2026-07-18T08:00:00Z',
    _launchStateSource: 'list',
    _launchStateObservedAtMs: 0
  }
  const detailInflight = {
    id: SKYROOT_ID,
    statusId: 6,
    statusAbbrev: 'In Flight',
    launchTime: '2026-07-18T08:00:00Z',
    _launchStateSource: 'fetchLaunchDetail_status',
    _launchStateObservedAtMs: Date.now()
  }
  const merged = applyAuthoritativeStatus(enrichment, [staleListGo, detailInflight])
  assert.equal(merged.statusId, 6)
  assert.equal(merged.statusBadgeText, '飞行中')
})
