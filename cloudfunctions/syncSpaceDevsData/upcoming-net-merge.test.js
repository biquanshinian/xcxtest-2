/**
 * node cloudfunctions/syncSpaceDevsData/upcoming-net-merge.test.js
 */
const assert = require('assert')
const {
  mergeUpcomingResultsWithNetHysteresis,
  mergeLiveRowNetHysteresis
} = require('./upcoming-net-merge.js')

const now = Date.parse('2026-08-10T14:45:00Z')
const MICHIBIKI_ID = 'b89ab080-66c3-4831-85a9-38d85da71d30'

// E: syncLaunches 整表覆写场景——旧缓存近窗 Go，detailed 仍 TBD+8/31 → 保留近窗 NET
{
  const previous = [
    {
      id: MICHIBIKI_ID,
      name: 'H3-22 | Michibiki 7 (QZS-7)',
      net: '2026-08-10T19:23:31Z',
      window_start: '2026-08-10T19:23:31Z',
      window_end: '2026-08-10T20:23:31Z',
      status: { id: 1, abbrev: 'Go', name: 'Go for Launch' }
    },
    {
      id: 'zhuque',
      net: '2026-08-10T23:45:00Z',
      status: { id: 1, abbrev: 'Go' }
    }
  ]
  const next = [
    {
      id: MICHIBIKI_ID,
      name: 'H3-22 | Michibiki 7 (QZS-7)',
      net: '2026-08-31T00:00:00Z',
      window_start: '2026-08-31T00:00:00Z',
      window_end: '2026-08-31T01:00:00Z',
      status: { id: 2, abbrev: 'TBD', name: 'To Be Determined' },
      pad: { name: 'YLP-1' }
    },
    {
      id: 'zhuque',
      net: '2026-08-10T23:45:00Z',
      status: { id: 1, abbrev: 'Go' }
    },
    {
      id: 'new-launch',
      net: '2026-08-12T00:00:00Z',
      status: { id: 1, abbrev: 'Go' }
    }
  ]
  const merged = mergeUpcomingResultsWithNetHysteresis(previous, next, now)
  const michi = merged.results.find((r) => r && r.id === MICHIBIKI_ID)
  assert.ok(michi)
  assert.strictEqual(michi.net, '2026-08-10T19:23:31Z')
  assert.strictEqual(michi.window_start, '2026-08-10T19:23:31Z')
  assert.strictEqual(michi.status.id, 1)
  assert.strictEqual(michi.status.abbrev, 'Go') // 拒写时 status 一并保留，不落成 TBD
  assert.ok(merged.results.find((r) => r && r.id === 'new-launch')) // 新任务整行接受
  assert.ok(merged.preserved >= 1)
  assert.strictEqual(merged.reasons.uncertain_placeholder_scrub, 1)
  // 两发都是 Go：按真实 NET，Michibiki 更近在前
  assert.strictEqual(merged.results[0].id, MICHIBIKI_ID)
}

// A: 旧 8/31 TBD，detailed 已是 Go+近窗 → 收回
{
  const previous = [
    {
      id: MICHIBIKI_ID,
      net: '2026-08-31T00:00:00Z',
      status: { id: 2, abbrev: 'TBD' }
    }
  ]
  const next = [
    {
      id: MICHIBIKI_ID,
      net: '2026-08-10T19:23:31Z',
      status: { id: 1, abbrev: 'Go', name: 'Go for Launch' }
    }
  ]
  const merged = mergeUpcomingResultsWithNetHysteresis(previous, next, now)
  assert.strictEqual(merged.results[0].net, '2026-08-10T19:23:31Z')
  assert.strictEqual(merged.results[0].status.abbrev, 'Go')
  assert.strictEqual(merged.preserved, 0)
}

// 近窗 TBD 污染态 → 远窗 TBD：拒写，保持近窗（等 Go 收回）
{
  const previous = [
    {
      id: MICHIBIKI_ID,
      net: '2026-08-10T19:23:31Z',
      status: { id: 2, abbrev: 'TBD' }
    }
  ]
  const next = [
    {
      id: MICHIBIKI_ID,
      net: '2026-08-31T00:00:00Z',
      status: { id: 2, abbrev: 'TBD' }
    }
  ]
  const merged = mergeUpcomingResultsWithNetHysteresis(previous, next, now)
  assert.strictEqual(merged.results[0].net, '2026-08-10T19:23:31Z')
  assert.strictEqual(merged.preserved, 1)
}

// 无旧缓存：原样接受并排序
{
  const next = [
    { id: 'b', net: '2026-08-12T00:00:00Z', status: { id: 1 } },
    { id: 'a', net: '2026-08-11T00:00:00Z', status: { id: 1 } }
  ]
  const merged = mergeUpcomingResultsWithNetHysteresis([], next, now)
  assert.strictEqual(merged.results[0].id, 'a')
  assert.strictEqual(merged.preserved, 0)
}

// 终态不被 Go 降级
{
  const cached = {
    id: 'x',
    net: '2026-08-01T00:00:00Z',
    status: { id: 3, abbrev: 'Success' }
  }
  const live = {
    id: 'x',
    net: '2026-08-01T00:00:00Z',
    status: { id: 1, abbrev: 'Go' }
  }
  const row = mergeLiveRowNetHysteresis(cached, live, now)
  assert.strictEqual(row.status.id, 3)
}

console.log('upcoming-net-merge.test.js OK')
