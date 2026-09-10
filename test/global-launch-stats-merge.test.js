const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isUsableSummary,
  pickAlignedSummary,
  hasBreakdownRows,
  shouldKeepExistingBreakdown,
  countryRowSummary,
  mergeGlobalLaunchStatsParts,
  homeSummaryToGlobalPayload
} = require('../subpackages/index-extra/utils/global-launch-stats-merge.js')

test('isUsableSummary 接受 0，拒绝脏值', () => {
  assert.equal(isUsableSummary({ total: 0, success: 0, failure: 0 }), true)
  assert.equal(isUsableSummary({ total: 12 }), true)
  assert.equal(isUsableSummary({ total: 'x' }), false)
  assert.equal(isUsableSummary(null), false)
})

test('pickAlignedSummary 逐项取大值并压回自洽', () => {
  assert.deepEqual(
    pickAlignedSummary([{ total: 203, success: 0, failure: 0 }, { total: 200, success: 193, failure: 7 }]),
    { total: 203, success: 193, failure: 7 }
  )
  assert.equal(pickAlignedSummary([null, undefined]), null)
})

test('头部与首页卡片对齐：明细少算时取 count 口径总数，差额留给待定', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: {
      status: 'fulfilled',
      value: { year: 2026, summary: { total: 203, success: 0, failure: 0 }, summaryPartial: true }
    },
    breakdownSettled: {
      status: 'fulfilled',
      value: {
        year: 2026,
        summary: { total: 200, success: 193, failure: 7 },
        byCountry: [{ key: '美国', total: 112, success: 111, failure: 1 }],
        byAgency: [],
        byRocket: [],
        breakdownReady: true
      }
    }
  })
  assert.deepEqual(merged.summary, { total: 203, success: 193, failure: 7 })
  assert.equal(merged.summaryPartial, false)
})

test('本地过期快照的总数更大时也纳入对齐', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: { status: 'rejected', reason: new Error('STATS_NOT_READY') },
    breakdownSettled: {
      status: 'fulfilled',
      value: {
        year: 2026,
        summary: { total: 190, success: 185, failure: 5 },
        byCountry: [{ key: '美国', total: 100 }],
        byAgency: [],
        byRocket: [],
        breakdownReady: true
      }
    },
    persist: { summary: { total: 203, success: 196, failure: 7 } }
  })
  assert.deepEqual(merged.summary, { total: 203, success: 196, failure: 7 })
})

test('两端云数据都落后时，用首页卡片那份总数兜底对齐', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: {
      status: 'fulfilled',
      value: { year: 2026, summary: { total: 200, success: 193, failure: 7 } }
    },
    breakdownSettled: {
      status: 'fulfilled',
      value: {
        year: 2026,
        summary: { total: 200, success: 193, failure: 7 },
        byCountry: [{ key: '美国', total: 112 }],
        byAgency: [],
        byRocket: [],
        breakdownReady: true
      }
    },
    homeTotal: 203
  })
  assert.deepEqual(merged.summary, { total: 203, success: 193, failure: 7 })
})

test('按国家筛选时不拿全球总数对齐', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '中国',
    summarySettled: {
      status: 'fulfilled',
      value: { year: 2026, summary: { total: 57, success: 53, failure: 4 } }
    },
    breakdownSettled: { status: 'rejected', reason: new Error('明细未就绪') },
    homeTotal: 203
  })
  assert.equal(merged.summary.total, 57)
})

test('summary 失败但 breakdown 成功时用明细出数，不抛错', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: { status: 'rejected', reason: new Error('STATS_NOT_READY') },
    breakdownSettled: {
      status: 'fulfilled',
      value: {
        year: 2026,
        summary: { total: 80, success: 70, failure: 8 },
        byCountry: [{ key: '美国', total: 50, success: 45, failure: 4 }],
        byAgency: [{ key: 'SpaceX', total: 40 }],
        byRocket: [],
        breakdownReady: true
      }
    }
  })
  assert.equal(merged.summary.total, 80)
  assert.equal(merged.breakdownReady, true)
  assert.equal(merged.byCountry.length, 1)
})

test('breakdown 失败但 summary 成功时保留头部，带 loadError', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: {
      status: 'fulfilled',
      value: { year: 2026, summary: { total: 80, success: 70, failure: 8 } }
    },
    breakdownSettled: { status: 'rejected', reason: new Error('明细超时') }
  })
  assert.equal(merged.summary.total, 80)
  assert.equal(merged.breakdownReady, false)
  assert.match(merged.loadError, /明细/)
})

test('两端失败时回退 persist，不抛错', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: { status: 'rejected', reason: new Error('timeout') },
    breakdownSettled: { status: 'rejected', reason: new Error('timeout') },
    persist: {
      summary: { total: 70, success: 60, failure: 7 },
      byCountry: [{ key: '中国', total: 20, success: 19, failure: 1 }],
      byAgency: [{ key: 'CASC', total: 18 }],
      byRocket: [],
      countryOptions: [{ key: '_all', label: '全部国家' }]
    }
  })
  assert.equal(merged.summary.total, 70)
  assert.equal(merged.breakdownReady, true)
  assert.equal(merged.clientStaleFallback, true)
  assert.equal(merged.byCountry[0].key, '中国')
})

test('国家筛选失败时从 _all persist 的 byCountry 抽出该国汇总', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '中国',
    summarySettled: { status: 'rejected', reason: new Error('notReady') },
    breakdownSettled: { status: 'rejected', reason: new Error('notReady') },
    allPersist: {
      summary: { total: 80, success: 70, failure: 8 },
      byCountry: [
        { key: '美国', total: 50, success: 45, failure: 4 },
        { key: '中国', total: 22, success: 20, failure: 2 }
      ],
      countryOptions: [{ key: '中国', label: '中国', count: 22 }]
    }
  })
  assert.equal(merged.summary.total, 22)
  assert.equal(merged.summary.success, 20)
  assert.equal(merged.byCountry.length, 1)
  assert.equal(merged.byCountry[0].key, '中国')
})

test('两端都空才抛错', () => {
  assert.throws(() => mergeGlobalLaunchStatsParts({
    year: 2026,
    countryKey: '_all',
    summarySettled: { status: 'rejected', reason: new Error('STATS_NOT_READY') },
    breakdownSettled: { status: 'rejected', reason: new Error('STATS_NOT_READY') }
  }), /STATS_NOT_READY/)
})

test('明细 partial 时头部改用 count-only summary，避免 success+failure<total', () => {
  const merged = mergeGlobalLaunchStatsParts({
    year: 2024,
    countryKey: '_all',
    summarySettled: {
      status: 'fulfilled',
      value: { summary: { total: 259, success: 240, failure: 12 } }
    },
    breakdownSettled: {
      status: 'fulfilled',
      value: {
        summary: { total: 180, success: 160, failure: 8 },
        byCountry: [{ key: '美国', total: 100 }],
        partial: true,
        breakdownReady: true
      }
    }
  })
  assert.equal(merged.summary.total, 259)
  assert.equal(merged.summary.success, 240)
  assert.equal(merged.breakdownReady, true)
})

test('homeSummaryToGlobalPayload 只出总数并标 summaryPartial', () => {
  const payload = homeSummaryToGlobalPayload({ globalThisYear: 88, year: 2026 }, 2026)
  assert.equal(payload.summary.total, 88)
  assert.equal(payload.summaryPartial, true)
  assert.equal(payload.breakdownReady, false)
  assert.equal(homeSummaryToGlobalPayload({ globalThisYear: null }, 2026), null)
})

test('countryRowSummary 找不到国家返回 null', () => {
  assert.equal(countryRowSummary({ byCountry: [] }, '法国'), null)
  assert.equal(hasBreakdownRows({ byCountry: [] }), false)
  assert.equal(hasBreakdownRows({ byAgency: [{ key: 'a' }] }), true)
})

test('汇总半包不得冲掉已有排行', () => {
  const existing = { byCountry: [{ key: '中国', total: 2 }] }
  assert.equal(shouldKeepExistingBreakdown(true, { byCountry: [] }, existing), true)
  assert.equal(shouldKeepExistingBreakdown(true, { byCountry: [{ key: '美国' }] }, existing), false)
  assert.equal(shouldKeepExistingBreakdown(false, { byCountry: [] }, existing), false)
})
