const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}
global.wx = {
  getStorageSync(key) { return store[key] },
  setStorageSync(key, data) { store[key] = data },
  removeStorageSync(key) { delete store[key] },
  getStorageInfoSync() { return { keys: Object.keys(store) } },
  cloud: null
}

const {
  formatCloudError,
  isTimeoutError,
  isRetryableCloudError,
  readPersistSnapshot
} = require('../utils/launch-stats-cloud.js')

test('formatCloudError 把超时 / 未就绪 / 网络转成可读文案', () => {
  assert.equal(formatCloudError(new Error('504003')), '统计加载超时，请稍后重试')
  assert.equal(formatCloudError(new Error('STATS_NOT_READY')), '统计数据生成中，请稍后重试')
  assert.equal(formatCloudError(new Error('network error')), '网络异常，请检查后重试')
  assert.equal(formatCloudError(new Error('LL2 接口限流（429）')), '数据源请求繁忙，请稍后再试')
})

test('只重试超时/网络，不连打 notReady', () => {
  assert.equal(isTimeoutError('FUNCTIONS_TIME_LIMIT'), true)
  assert.equal(isRetryableCloudError('STATS_NOT_READY'), false)
  assert.equal(isRetryableCloudError('统计数据生成中，请稍后重试'), false)
  assert.equal(isRetryableCloudError('cloud.callFunction:fail timeout'), true)
  assert.equal(isRetryableCloudError('cloud.callFunction:fail Function not found'), false)
  assert.equal(isRetryableCloudError('unknown boom'), false)
})

test('过期 persist 在 allowExpired 时仍可作空屏兜底', () => {
  const key = '_launch_global_summary_cloud_2026__all'
  store['_launch_stats_persist_' + key] = {
    ts: Date.now() - 40 * 24 * 60 * 60 * 1000,
    data: { summary: { total: 91, success: 80, failure: 9 } }
  }
  assert.equal(readPersistSnapshot(key), null)
  const emergency = readPersistSnapshot(key, { allowExpired: true })
  assert.equal(emergency.data.summary.total, 91)
  assert.equal(emergency.expired, true)
  assert.equal(emergency.stale, true)
})
