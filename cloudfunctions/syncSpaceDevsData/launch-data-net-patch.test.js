/**
 * node cloudfunctions/syncSpaceDevsData/launch-data-net-patch.test.js
 * 小时探针 → launch_data 补丁构造：
 * 1) 满 1 分钟的提前或延期必须打 netChangePending（否则服务号改期推送永不触发）
 * 2) statusId 一并写入；3) 已有未消费 pending 保留最早 previousNet
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildLaunchDataNetPatch,
  NET_CHANGE_DELAY_MS
} = require('./launch-net-hourly.js')

const NOW = Date.parse('2026-08-12T12:00:00Z')
const OLD_ISO = '2026-08-13T10:00:00.000Z'

function change(overrides) {
  return Object.assign(
    {
      id: 'launch-1',
      net: '2026-08-13T12:00:00Z',
      window_start: '2026-08-13T12:00:00Z',
      statusName: 'Go for Launch',
      statusId: 1
    },
    overrides
  )
}

test('推迟 2 小时（≥30min）→ 打 netChangePending + previousNet', () => {
  const existing = { launchTime: OLD_ISO, netChangePending: false, previousNet: '' }
  const r = buildLaunchDataNetPatch(existing, change(), NOW)
  assert.ok(r.patch, '应产出补丁')
  assert.equal(r.flagged, true)
  assert.equal(r.patch.netChangePending, true)
  assert.equal(r.patch.previousNet, OLD_ISO)
  assert.equal(r.patch.launchTime, '2026-08-13T12:00:00Z')
  assert.equal(r.patch.statusId, 1, 'statusId 必须同步写入')
  assert.equal(r.patch.source, 'launch_net_hourly')
})

test('推迟 1 分钟 → 打标', () => {
  const existing = { launchTime: OLD_ISO }
  const r = buildLaunchDataNetPatch(
    existing,
    change({ net: '2026-08-13T10:01:00Z', window_start: '2026-08-13T10:01:00Z' }),
    NOW
  )
  assert.ok(r.patch)
  assert.equal(r.flagged, true)
  assert.equal(r.patch.netChangePending, true)
})

test('推迟不足 1 分钟 → 只改时间不打标', () => {
  const existing = { launchTime: OLD_ISO }
  const r = buildLaunchDataNetPatch(
    existing,
    change({ net: '2026-08-13T10:00:30Z', window_start: '2026-08-13T10:00:30Z' }),
    NOW
  )
  assert.ok(r.patch)
  assert.equal(r.flagged, false)
  assert.equal(r.patch.netChangePending, undefined, '不足阈值不动 pending 字段（update merge 保留库内现值）')
})

test('时间提前满 1 分钟 → 打改期标（与弹窗同口径）', () => {
  const existing = { launchTime: OLD_ISO }
  const r = buildLaunchDataNetPatch(
    existing,
    change({ net: '2026-08-13T08:00:00Z', window_start: '2026-08-13T08:00:00Z' }),
    NOW
  )
  assert.ok(r.patch)
  assert.equal(r.flagged, true)
  assert.equal(r.patch.netChangePending, true)
  assert.equal(r.patch.previousNet, OLD_ISO)
})

test('已有未消费 pending → 保留最早 previousNet（展示「原时间 → 最新时间」）', () => {
  const earliest = '2026-08-13T06:00:00.000Z'
  const existing = { launchTime: OLD_ISO, netChangePending: true, previousNet: earliest }
  const r = buildLaunchDataNetPatch(existing, change(), NOW)
  assert.equal(r.flagged, true)
  assert.equal(r.patch.previousNet, earliest, '不得用中间时间覆盖最早原时间')
})

test('无现有文档 / 无有效时间 → 跳过', () => {
  assert.equal(buildLaunchDataNetPatch(null, change(), NOW).patch, null)
  assert.equal(buildLaunchDataNetPatch({ launchTime: OLD_ISO }, change({ net: '', window_start: '' }), NOW).patch, null)
  assert.equal(buildLaunchDataNetPatch({ launchTime: OLD_ISO }, change({ id: '' }), NOW).patch, null)
})

test('阈值与 launch-data-sync 副本口径一致（1 分钟）', () => {
  const sync = require('./launch-data-sync.js')
  assert.equal(NET_CHANGE_DELAY_MS, sync.NET_CHANGE_DELAY_MS)
  assert.equal(NET_CHANGE_DELAY_MS, 60 * 1000)
})

test('attachNetChangeMeta：探针已打标后 5 分钟 tick 重写不丢标记', () => {
  const { attachNetChangeMeta } = require('./launch-data-sync.js')
  // 探针刚把 launch_data 拨到新时间并打标；随后 tick 从缓存重建 payload（同一新时间）
  const existing = {
    launchTime: '2026-08-13T12:00:00Z',
    netChangePending: true,
    previousNet: OLD_ISO,
    netChangedAt: NOW,
    lastNetChangePushedKey: ''
  }
  const payload = { launchTime: '2026-08-13T12:00:00Z' }
  attachNetChangeMeta(existing, payload)
  assert.equal(payload.netChangePending, true, '未消费 pending 必须保留')
  assert.equal(payload.previousNet, OLD_ISO)
})

console.log('launch-data-net-patch.test.js: all assertions queued (node:test will report)')
