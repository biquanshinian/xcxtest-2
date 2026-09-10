/**
 * node --test cloudfunctions/syncSpaceDevsData/ll2-budget.test.js
 * LL2 小时配额账本：计数累加、跨小时重置、剩余额度计算、读失败按满额放行。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ll2BudgetHourBucket,
  getLl2HourlyCap,
  recordLl2Request,
  getLl2BudgetRemaining,
  BUDGET_DOC
} = require('./ll2-budget.js')

/** 极简假 db：单文档 get/set/update(inc) */
function makeFakeDb(initialDoc) {
  const store = { [BUDGET_DOC]: initialDoc || null }
  const INC = Symbol('inc')
  const command = { inc: (n) => ({ [INC]: n }) }
  return {
    command,
    _store: store,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              if (!store[id]) {
                const e = new Error('document not exists')
                throw e
              }
              return { data: store[id] }
            },
            async set({ data }) {
              store[id] = { ...data }
            },
            async update({ data }) {
              if (!store[id]) return { stats: { updated: 0 } }
              for (const k of Object.keys(data)) {
                const v = data[k]
                if (v && typeof v === 'object' && v[INC] != null) {
                  store[id][k] = (Number(store[id][k]) || 0) + v[INC]
                } else {
                  store[id][k] = v
                }
              }
              return { stats: { updated: 1 } }
            }
          }
        }
      }
    }
  }
}

test('累加：同小时多次请求 count 递增，剩余额度相应下降', async () => {
  const db = makeFakeDb(null)
  await recordLl2Request(db, 'test')
  await recordLl2Request(db, 'test')
  await recordLl2Request(db, 'test')
  const doc = db._store[BUDGET_DOC]
  assert.equal(doc.hourUtc, ll2BudgetHourBucket())
  assert.equal(doc.count, 3)
  const remaining = await getLl2BudgetRemaining(db)
  assert.equal(remaining, getLl2HourlyCap() - 3)
})

test('跨小时：旧 bucket 文档视为满额，剩余额度回满', async () => {
  const db = makeFakeDb({ hourUtc: '20200101T00', count: 999 })
  const remaining = await getLl2BudgetRemaining(db)
  assert.equal(remaining, getLl2HourlyCap(), '过期 bucket 不应扣减当前小时额度')
})

test('默认档位：未配置 LL2_HOURLY_BUDGET 时为匿名档 15', () => {
  const prev = process.env.LL2_HOURLY_BUDGET
  delete process.env.LL2_HOURLY_BUDGET
  assert.equal(getLl2HourlyCap(), 15)
  process.env.LL2_HOURLY_BUDGET = '300'
  assert.equal(getLl2HourlyCap(), 300)
  if (prev === undefined) delete process.env.LL2_HOURLY_BUDGET
  else process.env.LL2_HOURLY_BUDGET = prev
})

test('读失败：按满额返回（软预算不误杀）', async () => {
  const badDb = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              throw new Error('db down')
            }
          }
        }
      }
    }
  }
  const remaining = await getLl2BudgetRemaining(badDb)
  assert.equal(remaining, getLl2HourlyCap())
})

test('记账失败静默：不抛错不影响主链路', async () => {
  const badDb = {
    command: { inc: () => ({}) },
    collection() {
      return {
        doc() {
          return {
            async get() { throw new Error('db down') },
            async set() { throw new Error('db down') },
            async update() { throw new Error('db down') }
          }
        }
      }
    }
  }
  await assert.doesNotReject(() => recordLl2Request(badDb, 'test'))
})
