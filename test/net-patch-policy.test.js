/**
 * 客户端 utils/net-patch-policy.js（与云侧同源）
 * 运行：node --test test/net-patch-policy.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  shouldRejectNetAdvance,
  sortResultsByNetAsc,
  sortNetKeyMs,
  mergeLiveRowNetHysteresis,
  isLikelyPlaceholderNet
} = require('../utils/net-patch-policy.js')

const now = Date.parse('2026-08-10T14:45:00Z')

test('远窗 TBD 假近窗前移：拒', () => {
  assert.equal(
    shouldRejectNetAdvance(
      { net: '2026-08-31T00:00:00Z', status: { id: 2 } },
      { net: '2026-08-10T19:15:00Z', status: { id: 2 } },
      now
    ),
    true
  )
})

test('远窗 TBD → 近窗 Go：放行治愈', () => {
  assert.equal(
    shouldRejectNetAdvance(
      { net: '2026-08-31T00:00:00Z', status: { id: 2 } },
      { net: '2026-08-10T19:23:31Z', status: { id: 1 } },
      now
    ),
    false
  )
})

test('近窗 Go → 月末 00:00Z 占位 Go：拒', () => {
  assert.equal(
    shouldRejectNetAdvance(
      { net: '2026-08-10T19:23:31Z', status: { id: 1 } },
      { net: '2026-08-31T00:00:00Z', status: { id: 1 } },
      now
    ),
    true
  )
})

test('近窗 Go → 十天后具体钟点 Go（真实改期）：放行', () => {
  assert.equal(
    shouldRejectNetAdvance(
      { net: '2026-08-10T19:23:31Z', status: { id: 1 } },
      { net: '2026-08-20T15:30:00Z', status: { id: 1 } },
      now
    ),
    false
  )
})

test('近窗 Go → 远窗 TBD 占位：拒且整包保留', () => {
  const cached = { net: '2026-08-10T19:23:31Z', status: { id: 1, abbrev: 'Go' } }
  const live = { net: '2026-08-31T00:00:00Z', status: { id: 2, abbrev: 'TBD' } }
  assert.equal(shouldRejectNetAdvance(cached, live, now), true)
  const merged = mergeLiveRowNetHysteresis(cached, live, now)
  assert.equal(merged.net, '2026-08-10T19:23:31Z')
  assert.equal(merged.status.id, 1)
})

test('isLikelyPlaceholderNet：月末 00:00Z 为真，具体钟点为假', () => {
  assert.equal(isLikelyPlaceholderNet(Date.parse('2026-08-31T00:00:00Z')), true)
  assert.equal(isLikelyPlaceholderNet(Date.parse('2026-08-01T00:00:00Z')), true)
  assert.equal(isLikelyPlaceholderNet(Date.parse('2026-08-20T15:30:00Z')), false)
})

test('sortResultsByNetAsc：纯 NET，无视 TBD', () => {
  const rows = [
    { id: 'b', net: '2026-08-11T14:26:00Z', status: { id: 1 } },
    { id: 'a', net: '2026-08-10T19:15:00Z', status: { id: 2 } }
  ]
  sortResultsByNetAsc(rows, now)
  assert.equal(rows[0].id, 'a')
  assert.equal(sortNetKeyMs(rows[0], now), Date.parse('2026-08-10T19:15:00Z'))
})
