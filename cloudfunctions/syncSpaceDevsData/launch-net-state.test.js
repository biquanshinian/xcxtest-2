const test = require('node:test')
const assert = require('node:assert/strict')
const { pruneStaleUpcomingResults, collectTerminalFromCachedUpcoming } = require('./launch-net-state.js')

test('过 NET 且未出现在探针前 30 条的 Go 不会被误删', () => {
  const go = { id: 'go', net: '2020-01-01T00:00:00Z', status: { id: 1 } }
  const result = pruneStaleUpcomingResults([go], new Map())
  assert.equal(result.results.length, 1)
  assert.equal(result.pruned.length, 0)
})

test('launch_status 终态可剔除 hide_recent 后残留的旧 Go', () => {
  const go = { id: 'g1', net: '2020-01-01T00:00:00Z', status: { id: 1 } }
  const result = pruneStaleUpcomingResults([go], new Map(), new Set(['g1']))
  assert.equal(result.results.length, 0)
  assert.equal(result.pruned[0].reason, 'status_store_terminal')
})

test('终态必须先采集再 prune', () => {
  const deployed = {
    id: '10fa7952-f00b-4292-80a2-4207e208844e',
    name: 'Skyroot | Vikram-I Demo Flight',
    net: '2026-07-18T08:00:00Z',
    status: { id: 9, name: 'Payload Deployed', abbrev: 'Deployed' }
  }
  const liveById = new Map([[deployed.id, deployed]])
  const terminal = collectTerminalFromCachedUpcoming([deployed], liveById, new Set(), 100)
  const projected = pruneStaleUpcomingResults([deployed], liveById)
  assert.equal(terminal.length, 1)
  assert.equal(terminal[0].status.id, 9)
  assert.equal(projected.results.length, 0)
  assert.equal(projected.pruned[0].reason, 'live_terminal')
})
