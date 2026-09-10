const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isGenericMissionTitle,
  hasWeakLaunchIdentity,
  shouldUpgradeLaunchIdentity,
  applyLaunchIdentityUpgrade,
  mergeLaunchSourcesForStub,
  alignLaunchIdentityFromTitle,
  titleCfgRocketMismatch,
  rowNeedsIdentityProbe,
  detailCacheTtlMs,
  shouldRefreshCachedLaunchIdentity,
  IDENTITY_WEAK_TTL_MS,
  IDENTITY_RECENT_TTL_MS,
  IDENTITY_TERMINAL_TTL_MS
} = require('./launch-identity-upgrade.js')

const YAO_GAN_ID = '95eb9265-bdbe-43ad-b08c-6be7eb4e58f4'

function placeholderRow() {
  return {
    id: YAO_GAN_ID,
    name: 'Long March 2D | Unknown Payload',
    net: '2026-09-10T09:00:00Z',
    status: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
    mission: { name: 'Unknown Payload' },
    rocket: { configuration: { id: 64, name: 'Long March 2D', full_name: 'Long March 2D/Yuanzheng-3' } },
    pad: { name: 'Launch Area 94 (SLS-2 / 603)', location: { name: 'Jiuquan Satellite Launch Center' } }
  }
}

function liveLl2Row() {
  return {
    id: YAO_GAN_ID,
    name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
    net: '2026-09-10T09:00:00Z',
    status: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
    mission: {
      name: 'Yaogan 53-01 to 03/56-01 to 03',
      type: 'Government/Top Secret',
      description: '6 Chinese military “remote sensing” satellite of unknown purposes.',
      orbit: { id: 8, name: 'Low Earth Orbit', abbrev: 'LEO' }
    },
    rocket: { configuration: { id: 10, name: 'Long March 4B', full_name: 'Long March 4B' } },
    pad: { name: 'Launch Area 94 (SLS-2 / 603)', location: { name: 'Jiuquan Satellite Launch Center' } }
  }
}

test('未知有效载荷 / Unknown Payload 是弱身份', () => {
  assert.equal(isGenericMissionTitle('Unknown Payload'), true)
  assert.equal(isGenericMissionTitle('未知有效载荷'), true)
  assert.equal(isGenericMissionTitle('Long March 2D | Unknown Payload'), true)
  assert.equal(isGenericMissionTitle('Yaogan 53-01 to 03/56-01 to 03'), false)
  assert.equal(hasWeakLaunchIdentity(placeholderRow()), true)
  assert.equal(hasWeakLaunchIdentity(liveLl2Row()), false)
})

test('占位行必须被 LL2 遥感身份升级', () => {
  const current = placeholderRow()
  const incoming = liveLl2Row()
  assert.equal(shouldUpgradeLaunchIdentity(current, incoming, { trustIncoming: true }), true)
  const res = applyLaunchIdentityUpgrade(current, incoming, { trustIncoming: true })
  assert.equal(res.changed, true)
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
  assert.equal(current.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
  assert.equal(current.mission.orbit.abbrev, 'LEO')
  assert.equal(current.mission.type, 'Government/Top Secret')
  assert.equal(current.name, 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03')
  assert.ok(current.pad.name.includes('Launch Area 94'))
})

test('未信任的 upcoming 占位不得把已公布身份打回未知', () => {
  const current = liveLl2Row()
  const incoming = placeholderRow()
  assert.equal(shouldUpgradeLaunchIdentity(current, incoming, { trustIncoming: false }), false)
  const res = applyLaunchIdentityUpgrade(current, incoming, { trustIncoming: false })
  assert.equal(res.changed, false)
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
  assert.equal(current.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
})

test('mergeLaunchSourcesForStub：保留 upcoming 工位，用 live 更好身份', () => {
  const cached = placeholderRow()
  cached.rocket.launcher_stage = [{ type: 'core' }]
  const live = liveLl2Row()
  delete live.pad
  const merged = mergeLaunchSourcesForStub(cached, live)
  assert.equal(merged.rocket.configuration.name, 'Long March 4B')
  assert.equal(merged.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
  assert.equal(merged.pad.name, cached.pad.name)
  assert.equal(merged.rocket.launcher_stage[0].type, 'core')
})

test('终态详情 TTL：占位 15 分钟，近窗已公布 30 分钟，旧终态 7 天', () => {
  const now = Date.parse('2026-09-10T12:00:00Z')
  assert.equal(detailCacheTtlMs(placeholderRow(), now), IDENTITY_WEAK_TTL_MS)
  const live = liveLl2Row()
  assert.equal(detailCacheTtlMs(live, now), IDENTITY_RECENT_TTL_MS)
  live.net = '2026-01-01T00:00:00Z'
  assert.equal(detailCacheTtlMs(live, now), IDENTITY_TERMINAL_TTL_MS)
})

test('只有 name 的 LL2 行也必须改掉 configuration 里的二号丁', () => {
  const current = placeholderRow()
  const incoming = {
    id: YAO_GAN_ID,
    name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03'
  }
  const res = applyLaunchIdentityUpgrade(current, incoming, { trustIncoming: true })
  assert.equal(res.changed, true)
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
  assert.equal(current.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
  assert.equal(hasWeakLaunchIdentity(current), false)
})

test('title 已更正但 mission 仍 Unknown Payload 时按 title 升级', () => {
  const current = placeholderRow()
  const incoming = {
    id: YAO_GAN_ID,
    name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
    mission: { name: 'Unknown Payload' },
    rocket: { configuration: { name: 'Long March 2D', full_name: 'Long March 2D/Yuanzheng-3' } }
  }
  const res = applyLaunchIdentityUpgrade(current, incoming, { trustIncoming: true })
  assert.equal(res.changed, true)
  assert.equal(current.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
})

test('未知载荷 也是弱身份', () => {
  assert.equal(isGenericMissionTitle('未知载荷'), true)
})

test('升级火箭后必须丢掉旧 nameZh，避免列表继续显示二号丁', () => {
  const current = placeholderRow()
  current.nameZh = '长征二号丁/远征三号 | 未知有效载荷'
  current.mission.nameZh = '未知有效载荷'
  current.rocket.configuration.nameZh = '长征二号丁'
  current.rocket.configuration.full_nameZh = '长征二号丁/远征三号'
  applyLaunchIdentityUpgrade(current, liveLl2Row(), { trustIncoming: true })
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
  assert.equal(current.rocket.configuration.nameZh, undefined)
  assert.equal(current.rocket.configuration.full_nameZh, undefined)
  assert.equal(current.nameZh, undefined)
  assert.equal(current.mission.nameZh, undefined)
})

test('name 已是四号乙但 cfg 仍是二号丁时就地按标题对齐', () => {
  const current = placeholderRow()
  current.name = 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03'
  assert.equal(titleCfgRocketMismatch(current), true)
  const res = alignLaunchIdentityFromTitle(current)
  assert.equal(res.changed, true)
  assert.equal(current.rocket.configuration.name, 'Long March 4B')
  assert.equal(current.mission.name, 'Yaogan 53-01 to 03/56-01 to 03')
  assert.equal(titleCfgRocketMismatch(current), false)
})

test('即将发射 LL2 仍是 Unknown Payload 时不得臆造载荷名', () => {
  const row = {
    id: 'de446468-057f-4c9d-a6a1-af99c93b541e',
    name: 'Zhuque-2E Block 2 | Unknown Payload',
    net: '2026-09-15T06:25:00Z',
    mission: { name: 'Unknown Payload' },
    rocket: { configuration: { name: 'Zhuque-2E Block 2' } }
  }
  const res = alignLaunchIdentityFromTitle(row)
  assert.equal(res.changed, false)
  assert.equal(row.mission.name, 'Unknown Payload')
  assert.equal(row.rocket.configuration.name, 'Zhuque-2E Block 2')
})

test('近窗 title/cfg 不一致也要触发 previous 探针', () => {
  const now = Date.parse('2026-09-10T12:00:00Z')
  const row = placeholderRow()
  row.name = 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03'
  row.mission = { name: 'Yaogan 53-01 to 03/56-01 to 03' }
  assert.equal(rowNeedsIdentityProbe(row, now), true)
})

test('已过期占位详情缓存必须刷新，即使 7 天 expireAt 未到', () => {
  const now = Date.parse('2026-09-10T12:00:00Z')
  assert.equal(
    shouldRefreshCachedLaunchIdentity(placeholderRow(), { cacheAge: 11 * 60 * 1000 }, now),
    true
  )
  assert.equal(
    shouldRefreshCachedLaunchIdentity(placeholderRow(), { cacheAge: 60 * 1000 }, now),
    false
  )
  const live = liveLl2Row()
  live.net = '2026-01-01T00:00:00Z'
  assert.equal(
    shouldRefreshCachedLaunchIdentity(live, { cacheAge: 2 * 60 * 60 * 1000 }, now),
    false
  )
})
