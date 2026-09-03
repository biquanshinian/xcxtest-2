const test = require('node:test')
const assert = require('node:assert/strict')
const {
  stubFromTerminalEntry,
  attachLaunchStubsToTerminalEntries
} = require('./launch-net-state.js')

test('stubFromTerminalEntry prefers launchStub over thin fields', () => {
  const stub = stubFromTerminalEntry({
    id: 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
    name: 'thin name',
    net: '2026-07-21T14:49:34Z',
    status: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
    launchStub: {
      id: 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      pad: { name: 'Space Launch Complex 4E' },
      status: { id: 1, name: 'Go', abbrev: 'Go' }
    }
  })
  assert.equal(stub.name, 'Falcon 9 Block 5 | Starlink Group 17-39')
  assert.equal(stub.pad.name, 'Space Launch Complex 4E')
  assert.equal(stub.status.id, 3)
  assert.equal(stub.status.abbrev, 'Success')
})

test('buildPreviousListStub 无 configuration 时从 name 拆火箭', () => {
  const { buildPreviousListStub } = require('./launch-net-state.js')
  const stub = buildPreviousListStub({
    id: 'starlink-1750',
    name: 'Falcon 9 | Starlink Group 17-50',
    net: '2026-08-19T04:01:00Z',
    status: { id: 3, abbrev: 'Success' }
  })
  assert.equal(stub.rocket.configuration.name, 'Falcon 9')
})

test('attachLaunchStubs 会用 upcoming 完整行替换瘦 launchStub', () => {
  const entries = [
    {
      id: 'abc',
      name: 'Falcon 9 | Starlink Group 17-50',
      status: { id: 3, abbrev: 'Success' },
      net: '2026-08-19T04:01:00Z',
      launchStub: { id: 'abc', name: 'Falcon 9 | Starlink Group 17-50' }
    }
  ]
  const upcoming = [
    {
      id: 'abc',
      name: 'Falcon 9 | Starlink Group 17-50',
      rocket: { configuration: { name: 'Falcon 9' } },
      pad: { name: 'SLC-4E', location: { name: 'Vandenberg SFB, CA, USA' } },
      status: { id: 1, abbrev: 'Go' }
    }
  ]
  assert.equal(attachLaunchStubsToTerminalEntries(entries, upcoming, null), 1)
  assert.equal(entries[0].launchStub.rocket.configuration.name, 'Falcon 9')
  assert.equal(entries[0].launchStub.pad.name, 'SLC-4E')
})

test('attachLaunchStubsToTerminalEntries prefers upcoming row over live list row', () => {
  const entries = [
    {
      id: 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      status: { id: 3, name: 'Launch Successful', abbrev: 'Success' }
    }
  ]
  const upcoming = [
    {
      id: 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      rocket: { configuration: { name: 'Falcon 9' } },
      pad: { name: 'SLC-4E', location: { country_code: 'USA' } },
      status: { id: 1, name: 'Go', abbrev: 'Go' }
    }
  ]
  const liveById = new Map([
    [
      'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
      {
        id: 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc',
        name: 'Falcon 9 Block 5 | Starlink Group 17-39',
        status: { id: 3, abbrev: 'Success' }
      }
    ]
  ])
  const n = attachLaunchStubsToTerminalEntries(entries, upcoming, liveById)
  assert.equal(n, 1)
  assert.equal(entries[0].launchStub.rocket.configuration.name, 'Falcon 9')
  assert.equal(entries[0].launchStub.status.id, 3)
  const out = stubFromTerminalEntry(entries[0])
  assert.equal(out.pad.name, 'SLC-4E')
  assert.equal(out.status.abbrev, 'Success')
})

test('attachLaunchStubsToTerminalEntries falls back to live when upcoming missing', () => {
  const entries = [
    {
      id: 'abc',
      name: 'Test',
      status: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
      net: '2026-07-21T14:49:34Z'
    }
  ]
  const liveById = new Map([
    ['abc', { id: 'abc', name: 'Test', net: '2026-07-21T14:49:34Z', status: { id: 3, abbrev: 'Success' } }]
  ])
  assert.equal(attachLaunchStubsToTerminalEntries(entries, [], liveById), 1)
  assert.equal(entries[0].launchStub.id, 'abc')
})

test('attachLaunchStubs strips updates — 不把冷路径大字段打进 previous stub', () => {
  const entries = [
    {
      id: 'x',
      name: 'Mission',
      status: { id: 3, abbrev: 'Success' },
      net: '2026-07-21T14:49:34Z'
    }
  ]
  const upcoming = [
    {
      id: 'x',
      name: 'Mission',
      net: '2026-07-21T14:49:34Z',
      status: { id: 1, abbrev: 'Go' },
      pad: { name: 'SLC-4E' },
      updates: [{ id: 1, comment: 'huge'.repeat(100) }],
      rocket: { configuration: { name: 'Falcon 9' }, launcher_stage: [{ landing: { type: { abbrev: 'ASDS' } } }] }
    }
  ]
  attachLaunchStubsToTerminalEntries(entries, upcoming, null)
  assert.equal(entries[0].launchStub.updates, undefined)
  assert.equal(entries[0].launchStub.pad.name, 'SLC-4E')
  assert.ok(entries[0].launchStub.rocket.launcher_stage)
  const out = stubFromTerminalEntry(entries[0])
  assert.equal(out.updates, undefined)
  assert.equal(out.status.id, 3)
})
