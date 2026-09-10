/**
 * node cloudfunctions/syncSpaceDevsData/launch-net-hourly-insert.test.js
 * 小时探针补齐 LL2 upcoming 头：只插入缺失的非终态新 id，不覆盖 detailed。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  insertMissingUpcomingFromProbe,
  patchResultsInPlace,
  upcomingSkipIds
} = require('./launch-net-hourly.js')
const { sortResultsByNetAsc } = require('./net-patch-policy.js')

const ZHUQUE = 'de446468-057f-4c9d-a6a1-af99c93b541e'
const VEGA = '8effc13a-c658-4d2e-9f15-8dba4d7fe2dd'
const GRAVITY = '767f7827-53d8-4621-803b-f456a1e6b512'

function go(id, name, net, extra) {
  return Object.assign(
    {
      id,
      name,
      net,
      window_start: net,
      window_end: net,
      status: { id: 1, name: 'Go for Launch', abbrev: 'Go' }
    },
    extra || {}
  )
}

test('探针头里有、缓存没有的 Go：插入并按 NET 升序就位', () => {
  const results = [
    go(VEGA, 'Vega-C | Sentinel-3C & FLEX', '2026-09-15T01:21:07Z', {
      pad: { name: 'ELV', location: { name: 'Kourou' } }
    }),
    go(GRAVITY, 'Gravity-1 | Unknown Payload', '2026-09-15T21:55:00Z', {
      pad: { name: 'Haiyang', location: { name: 'Haiyang' } }
    })
  ]
  const liveRows = [
    go(VEGA, 'Vega-C | Sentinel-3C & FLEX', '2026-09-15T01:21:07Z'),
    go(ZHUQUE, 'Zhuque-2E Block 2 | Unknown Payload', '2026-09-15T06:25:00Z', {
      rocket: { configuration: { name: 'Zhuque-2E Block 2' } }
    }),
    go(GRAVITY, 'Gravity-1 | Unknown Payload', '2026-09-15T21:55:00Z')
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set())
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].id, ZHUQUE)
  assert.equal(inserted[0].reason, 'probe_missing')
  sortResultsByNetAsc(results)
  assert.deepEqual(
    results.map((r) => r.id),
    [VEGA, ZHUQUE, GRAVITY]
  )
  assert.equal(results[1].name, 'Zhuque-2E Block 2 | Unknown Payload')
  assert.equal(results[1].rocket.configuration.name, 'Zhuque-2E Block 2')
})

test('已有 detailed 行：不覆盖 pad / 不重复插入', () => {
  const results = [
    go(ZHUQUE, 'Zhuque-2E Block 2 | Unknown Payload', '2026-09-15T06:25:00Z', {
      pad: { name: 'LC-96', location: { name: 'Jiuquan' } },
      rocket: { configuration: { name: 'Zhuque-2E Block 2' } }
    })
  ]
  const liveRows = [
    go(ZHUQUE, 'Zhuque-2E Block 2 | Tianyi 33', '2026-09-15T06:25:00Z')
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set())
  assert.equal(inserted.length, 0)
  assert.equal(results.length, 1)
  assert.equal(results[0].pad.name, 'LC-96', '不得用 list stub 覆盖已有工位')
  assert.equal(results[0].name, 'Zhuque-2E Block 2 | Unknown Payload')
})

test('终态 / 飞行中：不插入 upcoming', () => {
  const results = []
  const liveRows = [
    go('term', 'Falcon 9 | Done', '2026-09-10T12:00:00Z', {
      status: { id: 3, name: 'Launch Successful', abbrev: 'Success' }
    }),
    go('fly', 'Falcon 9 | Flying', '2026-09-10T13:00:00Z', {
      status: { id: 6, name: 'In Flight', abbrev: 'In Flight' }
    })
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set())
  assert.equal(inserted.length, 0)
  assert.equal(results.length, 0)
})

test('非法 NET / skip 集：不插入', () => {
  const results = []
  const liveRows = [
    go('nonet', 'Falcon 9 | No Time', '', { net: '', window_start: '', window_end: '' }),
    go('skipme', 'Falcon 9 | Skip', '2026-09-16T01:00:00Z')
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set(['skipme']))
  assert.equal(inserted.length, 0)
  assert.equal(results.length, 0)
})

test('list 行无 rocket/pad：仍能从标题拆出火箭，不编造工位', () => {
  const results = []
  const liveRows = [
    {
      id: ZHUQUE,
      name: 'Zhuque-2E Block 2 | Unknown Payload',
      net: '2026-09-15T06:25:00Z',
      window_start: '2026-09-15T06:18:00Z',
      window_end: '2026-09-15T06:40:00Z',
      status: { id: 1, name: 'Go for Launch', abbrev: 'Go' },
      image: { image_url: 'https://example.com/zq.jpg' }
    }
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set())
  assert.equal(inserted.length, 1)
  assert.equal(results[0].rocket.configuration.name, 'Zhuque-2E Block 2')
  assert.equal(results[0].pad, undefined)
  assert.equal(results[0].image.image_url, 'https://example.com/zq.jpg')
})

test('过点仍 TBD：同样是 hide=关占位，不得插入展示面', () => {
  const now = Date.parse('2026-09-10T16:00:00Z')
  const results = []
  const liveRows = [
    go('old-tbd', 'Vulcan | Amazon Leo', '2026-09-10T00:00:00Z', {
      status: { id: 2, name: 'To Be Determined', abbrev: 'TBD' }
    })
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set(), now)
  assert.equal(inserted.length, 0)
})

test('未来 TBD：属于 LL2 hide=true 展示面，可以插入', () => {
  const now = Date.parse('2026-09-10T16:00:00Z')
  const results = []
  const liveRows = [
    go('future-tbd', 'Starship | Flight 14', '2026-09-15T00:00:00Z', {
      status: { id: 2, name: 'To Be Determined', abbrev: 'TBD' }
    })
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set(), now)
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].id, 'future-tbd')
})

test('过点仍 Go：探针 hide=关带回的行不得插入 hide=开缓存', () => {
  const now = Date.parse('2026-09-10T16:00:00Z')
  const results = []
  const liveRows = [
    go('ussf-153', 'Falcon 9 Block 5 | USSF-153', '2026-09-10T15:42:30Z'),
    go(ZHUQUE, 'Zhuque-2E Block 2 | Unknown Payload', '2026-09-15T06:25:00Z')
  ]
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, new Set(), now)
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].id, ZHUQUE)
  assert.equal(results.some((r) => r && r.id === 'ussf-153'), false)
})

test('本轮已 prune 的 cache_terminal：即使 live 仍是 Go 也不得复活', () => {
  const results = []
  const liveRows = [
    go(ZHUQUE, 'Zhuque-2E Block 2 | Unknown Payload', '2026-09-15T06:25:00Z')
  ]
  const skip = upcomingSkipIds(new Set(), new Set(), [{ id: ZHUQUE, reason: 'cache_terminal' }])
  const inserted = insertMissingUpcomingFromProbe(results, liveRows, skip)
  assert.equal(inserted.length, 0)
  assert.equal(results.length, 0)
})

test('patchResultsInPlace 仍只改已有行，不插入新 id', () => {
  const results = [go(VEGA, 'Vega-C | Sentinel-3C & FLEX', '2026-09-15T01:21:07Z')]
  const liveById = new Map([
    [VEGA, go(VEGA, 'Vega-C | Sentinel-3C & FLEX', '2026-09-15T01:21:07Z')],
    [ZHUQUE, go(ZHUQUE, 'Zhuque-2E Block 2 | Unknown Payload', '2026-09-15T06:25:00Z')]
  ])
  const changes = patchResultsInPlace(results, liveById)
  assert.equal(results.length, 1)
  assert.equal(results[0].id, VEGA)
  assert.equal(
    changes.some((c) => c && c.id === ZHUQUE),
    false
  )
})
