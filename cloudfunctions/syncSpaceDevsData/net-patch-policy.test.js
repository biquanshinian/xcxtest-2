/**
 * node cloudfunctions/syncSpaceDevsData/net-patch-policy.test.js
 */
const assert = require('assert')
const {
  shouldRejectNetAdvance,
  sortResultsByNetAsc,
  sortNetKeyMs,
  mergeLiveRowNetHysteresis
} = require('./net-patch-policy.js')

const now = Date.parse('2026-08-10T14:45:00Z')

// TBD：从 8/31 临时拨到约 4.5h 后 → 拒绝（假近窗）
const cachedFarTbd = {
  net: '2026-08-31T00:00:00Z',
  status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' }
}
const liveNearTbd = {
  net: '2026-08-10T19:15:00Z',
  status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedFarTbd, liveNearTbd, now), true)

// TBD scrub 后移 → 放行
const liveLater = {
  net: '2026-09-15T00:00:00Z',
  status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedFarTbd, liveLater, now), false)

// 就绪任务小幅前移 2h → 放行
const cachedGo = {
  net: '2026-08-11T00:00:00Z',
  status: { id: 1, abbrev: 'Go', name: 'Go' }
}
const liveGoSlight = {
  net: '2026-08-10T22:00:00Z',
  status: { id: 1, abbrev: 'Go', name: 'Go' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedGo, liveGoSlight, now), false)

// Michibiki 关键因：缓存钉在 8/31 TBD，live 已是官方 Go + 近窗 T-0 → 必须放行收回
const liveMichibikiGo = {
  net: '2026-08-10T19:23:31Z',
  status: { id: 1, abbrev: 'Go', name: 'Go for Launch' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedFarTbd, liveMichibikiGo, now), false)

// 缓存已是 Go 但 NET 仍停在 8/31（上次拒 NET 只更了状态）→ live Go 近窗仍放行
const cachedGoStuckFar = {
  net: '2026-08-31T00:00:00Z',
  status: { id: 1, abbrev: 'Go', name: 'Go' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedGoStuckFar, liveMichibikiGo, now), false)

// 近窗 Go 被 TBD 一把拨到预备期末日 8/31 → 拒绝占位覆盖
const cachedNearGo = {
  net: '2026-08-10T19:23:31Z',
  status: { id: 1, abbrev: 'Go', name: 'Go' }
}
const livePlaceholderTbd = {
  net: '2026-08-31T00:00:00Z',
  status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedNearGo, livePlaceholderTbd, now), true)

// 已污染的近窗 TBD → 远窗 TBD 占位：也拒，避免钉死 8/31
const cachedNearTbd = {
  net: '2026-08-10T19:23:31Z',
  status: { id: 2, abbrev: 'TBD' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedNearTbd, livePlaceholderTbd, now), true)

// 近窗 Go → 远窗仍标 Go（预备期末日 00:00Z）：拒
const liveFarGo = {
  net: '2026-08-31T00:00:00Z',
  status: { id: 1, abbrev: 'Go', name: 'Go' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedNearGo, liveFarGo, now), true)

// 近窗 Go → 十天后仍 Go 且带具体钟点（真实改期）：放行
const liveRealPostponeGo = {
  net: '2026-08-20T15:30:00Z',
  status: { id: 1, abbrev: 'Go', name: 'Go for Launch' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedNearGo, liveRealPostponeGo, now), false)

// 拒写必须整包保留：net 与 status 都仍是近窗 Go（禁止近窗+待定半更新）
{
  const merged = mergeLiveRowNetHysteresis(cachedNearGo, livePlaceholderTbd, now)
  assert.strictEqual(merged.net, '2026-08-10T19:23:31Z')
  assert.strictEqual(merged.status.id, 1)
  assert.strictEqual(merged.status.abbrev, 'Go')
}

// 近窗 Go 真实 scrub 几天（仍近窗/中窗）→ 放行
const liveScrubFewDays = {
  net: '2026-08-14T19:23:31Z',
  status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedNearGo, liveScrubFewDays, now), false)

// 非 Go 的远→近大跳（例如 Hold）仍拒绝
const cachedHoldFar = {
  net: '2026-09-20T00:00:00Z',
  status: { id: 5, abbrev: 'Hold', name: 'Hold' }
}
const liveHoldNear = {
  net: '2026-08-10T20:00:00Z',
  status: { id: 5, abbrev: 'Hold', name: 'Hold' }
}
assert.strictEqual(shouldRejectNetAdvance(cachedHoldFar, liveHoldNear, now), true)

// 排序：严格按 NET 升序，TBD 不再因状态沉底
const rows = [
  {
    id: 'starlink',
    net: '2026-08-11T14:26:00Z',
    status: { id: 1, abbrev: 'Go' }
  },
  {
    id: 'michibiki',
    net: '2026-08-10T19:15:00Z',
    status: { id: 2, abbrev: 'TBD' }
  },
  {
    id: 'zhuque',
    net: '2026-08-10T23:45:00Z',
    status: { id: 1, abbrev: 'Go' }
  }
]
sortResultsByNetAsc(rows, now)
assert.strictEqual(rows[0].id, 'michibiki')
assert.strictEqual(rows[1].id, 'zhuque')
assert.strictEqual(rows[2].id, 'starlink')

const nearTbdKey = sortNetKeyMs(
  { net: '2026-08-10T19:15:00Z', status: { id: 2 } },
  now
)
assert.strictEqual(nearTbdKey, Date.parse('2026-08-10T19:15:00Z'))

console.log('net-patch-policy.test.js OK')
