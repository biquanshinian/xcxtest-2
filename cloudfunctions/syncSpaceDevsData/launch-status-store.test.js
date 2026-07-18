const test = require('node:test')
const assert = require('node:assert/strict')
const { merge, createLaunchStatusStore } = require('./launch-status-store.js')
const { merge: mergeLl2 } = require('../ll2Query/launch-status-store.js')

function row(id, statusId, observedAtMs, extra) {
  return {
    id,
    status: { id: statusId, name: String(statusId), abbrev: String(statusId) },
    observedAtMs,
    source: 'hourly_probe',
    ...extra
  }
}

test('云端归并不会用较新 Go 降级 Deployed', () => {
  const terminal = merge(null, row('a', 9, 100))
  const next = merge(terminal, row('a', 1, 200))
  assert.equal(next.status.id, 9)
})

test('不同 launchId 使用独立文档键，不共享数组覆盖', () => {
  const a = merge(null, row('a', 9, 100))
  const b = merge(null, row('b', 6, 100))
  assert.equal(a.id, 'a')
  assert.equal(b.id, 'b')
  assert.notEqual(a.id, b.id)
})

test('显式 correction 可修正错误终态', () => {
  const terminal = merge(null, row('a', 9, 100))
  const corrected = merge(terminal, row('a', 1, 200, { correction: true, source: 'detail' }))
  assert.equal(corrected.status.id, 1)
})

test('较新的 resolve 直接读数可纠正 updates 文案误判', () => {
  const inferred = merge(null, row('future', 4, 100, { source: 'll2_updates' }))
  const corrected = merge(inferred, row('future', 1, 200, { source: 'resolve' }))
  assert.equal(corrected.status.id, 1)
  assert.equal(corrected.source, 'resolve')
})

test('普通列表仍不能把真实终态降级', () => {
  const terminal = merge(null, row('done', 9, 100, { source: 'fetchLaunchStatuses' }))
  const list = merge(terminal, row('done', 1, 200, { source: 'list' }))
  assert.equal(list.status.id, 9)
})

test('两个独立部署云函数使用相同归并规则', () => {
  const current = row('a', 9, 100)
  const incoming = row('a', 1, 200)
  assert.deepEqual(merge(current, incoming), mergeLl2(current, incoming))
})

test('事务串行化并发写，同一任务不会被 Go 覆盖终态', async () => {
  const docs = new Map()
  let queue = Promise.resolve()
  const docRef = (id) => ({
    async get() {
      if (!docs.has(id)) throw new Error('not_found')
      return { data: docs.get(id) }
    },
    async set({ data }) {
      docs.set(id, data)
    }
  })
  const db = {
    serverDate: () => 'server-date',
    collection: () => ({ doc: docRef }),
    runTransaction(callback) {
      const run = queue.then(() => callback({ collection: () => ({ doc: docRef }) }))
      queue = run.catch(() => {})
      return run
    }
  }
  const store = createLaunchStatusStore(db)
  await Promise.all([store.upsertOne(row('same', 9, 100)), store.upsertOne(row('same', 1, 200))])
  assert.equal(docs.get('same').status.id, 9)
})

test('旧 source 名称补齐优先级，重复迁移保持 revision 不变', () => {
  const first = merge(null, row('legacy', 9, 100, { source: 'fetchLaunchStatuses' }))
  const repeated = merge(first, row('legacy', 9, 100, { source: 'fetchLaunchStatuses' }))
  assert.equal(first.sourcePriority, 30)
  assert.equal(repeated, first)
  assert.equal(repeated.revision, first.revision)
})

test('较旧迁移快照不会改写记录或增加 revision', () => {
  const current = merge(null, row('stale', 9, 200, { source: 'fetchLaunchStatuses' }))
  const stale = merge(current, row('stale', 9, 100, { source: 'migration' }))
  assert.equal(stale, current)
  assert.equal(stale.revision, current.revision)
})
