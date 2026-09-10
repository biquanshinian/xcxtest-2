/**
 * node cloudfunctions/syncSpaceDevsData/cache-write-guard.test.js
 */
const assert = require('assert')
const {
  isSlimLaunchListKey,
  stripUpdatesFromListPayload,
  upcomingCacheKey,
  verifyBatchedCache,
  inspectUpcomingCacheHealth,
  repairUpcomingMainCount,
  makeGenerationBatchKey,
  removeOrphanBatchDocs
} = require('./cache-write-guard.js')

const upcomingKey =
  'api_cache_/launches/upcoming/_{"format":"json","hide_recent_previous":true,"limit":100,"mode":"detailed","offset":0,"ordering":"net"}_slim_v6'

assert.strictEqual(isSlimLaunchListKey(upcomingKey), true)
assert.strictEqual(isSlimLaunchListKey(upcomingKey.replace('_slim_v6', '')), false)
assert.ok(upcomingCacheKey('_slim_v6').endsWith('_slim_v6'))
assert.ok(makeGenerationBatchKey(upcomingKey, 0, 'abc').endsWith('_batch_0_abc'))

const stripped = stripUpdatesFromListPayload({
  count: 2,
  results: [
    { id: 'a', updates: [{ id: 1 }] },
    { id: 'b', name: 'x' }
  ]
})
assert.strictEqual(stripped.results[0].updates, undefined)
assert.strictEqual(stripped.results[1].name, 'x')
assert.strictEqual(stripped.results[0].id, 'a')

function makeDb(docs) {
  const removed = []
  return {
    removed,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              if (!docs[id]) throw new Error('missing')
              return docs[id]
            },
            async set({ data }) {
              docs[id] = { data }
            },
            async remove() {
              if (!docs[id]) throw new Error('missing')
              delete docs[id]
              removed.push(id)
              return { stats: { removed: 1 } }
            }
          }
        }
      }
    }
  }
}

async function runAsync() {
  const docs = {
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [{ id: 1 }, { id: 2 }], count: 3 }, timestamp: 1 }
    },
    [`${upcomingKey}_batch_1`]: {
      data: { data: { results: [{ id: 3 }], count: 3 }, timestamp: 1 }
    }
  }
  const db = makeDb(docs)

  const ok = await verifyBatchedCache(db, upcomingKey, 3, [
    `${upcomingKey}_batch_0`,
    `${upcomingKey}_batch_1`
  ])
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(ok.mergedCount, 3)

  const bad = await verifyBatchedCache(db, upcomingKey, 3, [
    `${upcomingKey}_batch_0`,
    `${upcomingKey}_batch_9`
  ])
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.reason, 'batch_missing')
  assert.strictEqual(bad.hasGap, true)

  const mismatch = await verifyBatchedCache(db, upcomingKey, 99, [
    `${upcomingKey}_batch_0`,
    `${upcomingKey}_batch_1`
  ])
  assert.strictEqual(mismatch.ok, false)
  assert.strictEqual(mismatch.reason, 'count_mismatch')
  assert.strictEqual(mismatch.hasGap, false)

  const empty = await verifyBatchedCache(db, upcomingKey, 0, [
    `${upcomingKey}_batch_0`
  ])
  // batch_0 非空但 expected=0 → count_mismatch；全空才 upcoming_empty
  assert.strictEqual(empty.ok, false)

  const emptyDocs = {
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [], count: 0 }, timestamp: 1 }
    }
  }
  const emptyDb = makeDb(emptyDocs)
  const emptyVerify = await verifyBatchedCache(emptyDb, upcomingKey, 0, [
    `${upcomingKey}_batch_0`
  ])
  assert.strictEqual(emptyVerify.ok, false)
  assert.strictEqual(emptyVerify.reason, 'upcoming_empty')

  // --- inspectUpcomingCacheHealth: 声明 batchKeys + count 漂移 → count_repair ---
  const healthDocs = {
    [upcomingKey]: {
      data: {
        data: {
          count: 99,
          results: [],
          isBatched: true,
          totalBatches: 2,
          batchKeys: [`${upcomingKey}_batch_0`, `${upcomingKey}_batch_1`]
        },
        timestamp: 1
      }
    },
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [{ id: 1 }, { id: 2 }], count: 99 }, timestamp: 1 }
    },
    [`${upcomingKey}_batch_1`]: {
      data: { data: { results: [{ id: 3 }], count: 99 }, timestamp: 1 }
    }
  }
  const healthDb = makeDb(healthDocs)
  const health = await inspectUpcomingCacheHealth(healthDb)
  assert.strictEqual(health.ok, false)
  assert.strictEqual(health.repairable, 'count_repair')
  assert.strictEqual(health.mergedCount, 3)

  const repaired = await repairUpcomingMainCount(healthDb, health)
  assert.strictEqual(repaired.repaired, true)
  assert.strictEqual(repaired.count, 3)
  const after = await inspectUpcomingCacheHealth(healthDb)
  assert.strictEqual(after.ok, true)

  // --- 缺片：禁止 count_repair ---
  const gapDocs = {
    [upcomingKey]: {
      data: {
        data: {
          count: 3,
          results: [],
          isBatched: true,
          totalBatches: 2,
          batchKeys: [`${upcomingKey}_batch_0`, `${upcomingKey}_batch_1`]
        },
        timestamp: 1
      }
    },
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [{ id: 1 }], count: 3 }, timestamp: 1 }
    }
    // batch_1 missing
  }
  const gapDb = makeDb(gapDocs)
  const gapHealth = await inspectUpcomingCacheHealth(gapDb)
  assert.strictEqual(gapHealth.ok, false)
  assert.strictEqual(gapHealth.repairable, 'syncLaunches')
  assert.notStrictEqual(gapHealth.repairable, 'count_repair')

  // --- 扫描路径中间空洞：禁止用残缺子集 count_repair ---
  const scanGapDocs = {
    [upcomingKey]: {
      data: {
        data: {
          count: 3,
          results: [],
          isBatched: true,
          totalBatches: 3
          // 无 batchKeys
        },
        timestamp: 1
      }
    },
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [{ id: 1 }], count: 3 }, timestamp: 1 }
    },
    // batch_1 missing
    [`${upcomingKey}_batch_2`]: {
      data: { data: { results: [{ id: 3 }], count: 3 }, timestamp: 1 }
    }
  }
  const scanGapDb = makeDb(scanGapDocs)
  const scanGapHealth = await inspectUpcomingCacheHealth(scanGapDb)
  assert.strictEqual(scanGapHealth.ok, false)
  assert.strictEqual(scanGapHealth.reason, 'batch_gap')
  assert.strictEqual(scanGapHealth.repairable, 'syncLaunches')

  // --- 无 batchKeys 扫描成功但 count 漂移：不可 count_repair（须 sync）---
  const scanMismatchDocs = {
    [upcomingKey]: {
      data: {
        data: {
          count: 99,
          results: [],
          isBatched: true,
          totalBatches: 2
        },
        timestamp: 1
      }
    },
    [`${upcomingKey}_batch_0`]: {
      data: { data: { results: [{ id: 1 }, { id: 2 }], count: 99 }, timestamp: 1 }
    },
    [`${upcomingKey}_batch_1`]: {
      data: { data: { results: [{ id: 3 }], count: 99 }, timestamp: 1 }
    }
  }
  const scanMismatchDb = makeDb(scanMismatchDocs)
  const scanMismatchHealth = await inspectUpcomingCacheHealth(scanMismatchDb)
  assert.strictEqual(scanMismatchHealth.ok, false)
  assert.strictEqual(scanMismatchHealth.repairable, 'syncLaunches')

  // --- removeOrphan：主文档已无 batchKeys 时靠 extraCandidates 清 generation ---
  const gen0 = makeGenerationBatchKey(upcomingKey, 0, 'oldgen')
  const gen1 = makeGenerationBatchKey(upcomingKey, 1, 'oldgen')
  const orphanDocs = {
    [upcomingKey]: {
      data: { data: { results: [{ id: 1 }], count: 1 }, timestamp: 1 }
    },
    [gen0]: { data: { data: { results: [{ id: 1 }], count: 1 }, timestamp: 1 } },
    [gen1]: { data: { data: { results: [{ id: 2 }], count: 1 }, timestamp: 1 } }
  }
  const orphanDb = makeDb(orphanDocs)
  await removeOrphanBatchDocs(orphanDb, upcomingKey, [], [gen0, gen1])
  assert.ok(orphanDb.removed.includes(gen0))
  assert.ok(orphanDb.removed.includes(gen1))
  assert.ok(orphanDocs[upcomingKey])

  // repairUpcomingMainCount 拒绝非 count_repair
  const denied = await repairUpcomingMainCount(healthDb, {
    cacheKey: upcomingKey,
    batchKeys: [`${upcomingKey}_batch_0`],
    mergedCount: 1,
    repairable: 'syncLaunches'
  })
  assert.strictEqual(denied.repaired, false)
  assert.strictEqual(denied.reason, 'not_count_repairable')

  console.log('cache-write-guard.test.js OK')
}

runAsync().catch((e) => {
  console.error(e)
  process.exit(1)
})
