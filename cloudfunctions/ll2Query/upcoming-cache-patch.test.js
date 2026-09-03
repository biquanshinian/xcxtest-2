const test = require('node:test')
const assert = require('node:assert/strict')
const { createUpcomingCachePatcher, upcomingCacheKey } = require('./upcoming-cache-patch.js')

const KEY = upcomingCacheKey('_slim_v6')
const LOCK_KEY = 'launch_timeline_cache:_upcoming_patch_lock'

function createFakeDb(initialDocs) {
  const docs = new Map(Object.entries(initialDocs || {}))
  let writes = 0
  const makeDocRef = (colName, id) => ({
    async get() {
      const key = `${colName}:${id}`
      if (!docs.has(key)) throw new Error('not_found')
      return { data: docs.get(key) }
    },
    async set({ data }) {
      writes++
      docs.set(`${colName}:${id}`, data)
    }
  })
  const db = {
    collection: (name) => ({ doc: (id) => makeDocRef(name, id) }),
    runTransaction: async (fn) => fn({ collection: (name) => ({ doc: (id) => makeDocRef(name, id) }) })
  }
  return { db, docs, getWrites: () => writes }
}

function cacheRow(id, net, statusId) {
  return {
    id,
    name: `mission-${id}`,
    net,
    window_start: net,
    window_end: '',
    status: { id: statusId, name: String(statusId), abbrev: String(statusId) }
  }
}

function wrapperOf(results) {
  return { timestamp: 1, data: { results } }
}

test('改期：patch NET 并按新时间重排，主文档时间戳刷新', async () => {
  const { db, docs } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([
      cacheRow('a', '2026-07-20T14:49:00Z', 1),
      cacheRow('b', '2026-07-21T20:00:00Z', 1)
    ])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-22T10:00:00Z', window_start: '2026-07-22T10:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.equal(res.patched, 1)
  assert.equal(res.docsWritten, 1)
  const wrapper = docs.get(`space_devs_cache:${KEY}`)
  assert.ok(wrapper.timestamp > 1)
  const results = wrapper.data.results
  // a 改到 b 之后：重排后 b 在前
  assert.equal(results[0].id, 'b')
  assert.equal(results[1].id, 'a')
  assert.equal(results[1].net, '2026-07-22T10:00:00Z')
})

test('无变化：零写库退出', async () => {
  const { db, getWrites } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([cacheRow('a', '2026-07-20T14:49:00Z', 1)])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-20T14:49:00Z', window_start: '2026-07-20T14:49:00Z', status: { id: 1, name: '1', abbrev: '1' } }
  ])
  assert.equal(res.skipped, 'no_change')
  assert.equal(getWrites(), 0)
})

test('缓存中不存在的 id：不插入，零写库', async () => {
  const { db, getWrites } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([cacheRow('a', '2026-07-20T14:49:00Z', 1)])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'stranger', net: '2026-07-25T00:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.equal(res.skipped, 'no_change')
  assert.equal(getWrites(), 0)
})

test('终态：缓存 Success 被剔除出 upcoming（即使 live 仍带回 Go）', async () => {
  const { db, docs } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([
      cacheRow('a', '2026-07-20T14:49:00Z', 3),
      cacheRow('b', '2026-07-21T00:00:00Z', 1)
    ])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-20T15:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.ok(res.pruned >= 1)
  const results = docs.get(`space_devs_cache:${KEY}`).data.results
  assert.equal(results.some((r) => r && r.id === 'a'), false)
  assert.equal(results[0].id, 'b')
})

test('live Success：就地升终态后从 upcoming 剔除', async () => {
  const { db, docs } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([
      cacheRow('g1', '2026-07-22T02:54:00Z', 1),
      cacheRow('next', '2026-07-23T12:00:00Z', 1)
    ])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    {
      id: 'g1',
      net: '2026-07-22T02:54:00Z',
      status: { id: 3, name: 'Launch Successful', abbrev: 'Success' }
    }
  ])
  assert.equal(res.patched, 1)
  assert.equal(res.pruned, 1)
  const results = docs.get(`space_devs_cache:${KEY}`).data.results
  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'next')
})

test('缓存终态单独存在时也会被剔除（不依赖 live 字段变化）', async () => {
  const { db, docs, getWrites } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([cacheRow('a', '2026-07-20T14:49:00Z', 3)])
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    {
      id: 'a',
      net: '2026-07-20T14:49:00Z',
      window_start: '2026-07-20T14:49:00Z',
      status: { id: 1, name: 'Go', abbrev: 'Go' }
    }
  ])
  assert.ok(getWrites() > 0)
  assert.ok(res.pruned >= 1)
  assert.equal(docs.get(`space_devs_cache:${KEY}`).data.results.length, 0)
})

test('锁被其他写者占用：跳过且零写库', async () => {
  const { db, getWrites } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([cacheRow('a', '2026-07-20T14:49:00Z', 1)]),
    [LOCK_KEY]: { lockedAtMs: Date.now() }
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-22T10:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.equal(res.skipped, 'lock_busy')
  assert.equal(getWrites(), 0)
})

test('过期锁（超过 30s TTL）可被抢占', async () => {
  const { db } = createFakeDb({
    [`space_devs_cache:${KEY}`]: wrapperOf([cacheRow('a', '2026-07-20T14:49:00Z', 1)]),
    [LOCK_KEY]: { lockedAtMs: Date.now() - 60 * 1000 }
  })
  const patcher = createUpcomingCachePatcher(db)
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-22T10:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.equal(res.patched, 1)
})

test('分批缓存：改期跨批重排后按原批大小写回，全部批 + 主文档都刷新', async () => {
  const { db, docs } = createFakeDb({
    [`space_devs_cache:${KEY}`]: { timestamp: 1, data: { isBatched: true, count: 4, results: [] } },
    [`space_devs_cache:${KEY}_batch_0`]: wrapperOf([
      cacheRow('a', '2026-07-20T14:49:00Z', 1),
      cacheRow('b', '2026-07-21T00:00:00Z', 1)
    ]),
    [`space_devs_cache:${KEY}_batch_1`]: wrapperOf([
      cacheRow('c', '2026-07-22T00:00:00Z', 1),
      cacheRow('d', '2026-07-23T00:00:00Z', 1)
    ])
  })
  const patcher = createUpcomingCachePatcher(db)
  // a 改期到 c 与 d 之间 → 应从 batch_0 移到 batch_1
  const res = await patcher.patchUpcomingCacheWithLiveRows([
    { id: 'a', net: '2026-07-22T12:00:00Z', status: { id: 1, name: 'Go', abbrev: 'Go' } }
  ])
  assert.equal(res.patched, 1)
  assert.equal(res.docsWritten, 3)
  const batch0 = docs.get(`space_devs_cache:${KEY}_batch_0`).data.results.map((r) => r.id)
  const batch1 = docs.get(`space_devs_cache:${KEY}_batch_1`).data.results.map((r) => r.id)
  assert.deepEqual(batch0, ['b', 'c'])
  assert.deepEqual(batch1, ['a', 'd'])
  assert.ok(docs.get(`space_devs_cache:${KEY}`).timestamp > 1)
})

test('缓存键与小时探针 / syncLaunches 保持一致', () => {
  assert.equal(
    upcomingCacheKey('_slim_v6'),
    'api_cache_/launches/upcoming/_' +
      JSON.stringify({
        format: 'json',
        hide_recent_previous: true,
        limit: 100,
        mode: 'detailed',
        offset: 0,
        ordering: 'net'
      }) +
      '_slim_v6'
  )
})
