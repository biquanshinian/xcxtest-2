const test = require('node:test')
const assert = require('node:assert/strict')
const {
  breakdownAggDocId,
  isBreakdownAggUsable,
  packBreakdownAggPayload,
  reconcileSummaryCounts
} = require('../cloudfunctions/getLaunchStats/breakdown-agg.js')

test('明细落后于 count 口径时抬到较大总数，并标记 raised', () => {
  const { summary, raised } = reconcileSummaryCounts(
    { total: 200, success: 193, failure: 7 },
    { total: 203 }
  )
  assert.deepEqual(summary, { total: 203, success: 193, failure: 7 })
  assert.equal(raised, true)
})

test('明细不落后时保持原样，不标 raised', () => {
  const { summary, raised } = reconcileSummaryCounts(
    { total: 203, success: 196, failure: 7 },
    { total: 200 }
  )
  assert.deepEqual(summary, { total: 203, success: 196, failure: 7 })
  assert.equal(raised, false)
})

test('成败之和不得超过总数', () => {
  const { summary } = reconcileSummaryCounts(
    { total: 100, success: 98, failure: 2 },
    { total: 100, success: 99, failure: 5 }
  )
  assert.deepEqual(summary, { total: 100, success: 99, failure: 1 })
})

test('缺一侧时回退到另一侧', () => {
  assert.deepEqual(reconcileSummaryCounts(null, { total: 5 }).summary, { total: 5, success: 0, failure: 0 })
  assert.deepEqual(reconcileSummaryCounts({ total: 5, success: 5, failure: 0 }, null).summary, { total: 5, success: 5, failure: 0 })
  assert.equal(reconcileSummaryCounts(null, null).summary, null)
})

test('聚合缓存 docId 带年份与国家', () => {
  assert.equal(breakdownAggDocId(2026, '_all'), 'global_breakdown_agg_2026__all')
  assert.equal(breakdownAggDocId(2025, '中国'), 'global_breakdown_agg_2025_中国')
})

test('聚合缓存：有 summary 或排行即可用', () => {
  assert.equal(isBreakdownAggUsable({ summary: { total: 10 } }), true)
  assert.equal(isBreakdownAggUsable({ byCountry: [{ key: '美国' }] }), true)
  assert.equal(isBreakdownAggUsable({ summary: { total: 'x' }, byCountry: [] }), false)
  assert.equal(isBreakdownAggUsable(null), false)
})

test('packBreakdownAggPayload 去掉 _launches 只留展示字段', () => {
  const packed = packBreakdownAggPayload({
    summary: { total: 3 },
    byCountry: [{ key: '中国' }],
    byAgency: [],
    byRocket: [],
    countryOptions: [],
    apiCount: 3,
    source: 'll2_previous_net',
    partial: false,
    launchCountListed: 3,
    filters: { net__gte: '2026-01-01' },
    _launches: [{ id: 1 }]
  })
  assert.equal(packed.summary.total, 3)
  assert.equal(packed._launches, undefined)
})
