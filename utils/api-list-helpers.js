/**
 * 列表/请求层轻量 helper（从 api-booster-extract 抽出）
 * 供 api-request 等基础设施使用，避免把 landing-icons 整链打进主包闭包。
 */

function emptyListResult() {
  return { list: [], hasMore: false, nextOffset: 0 }
}

function withTimeout(promise, ms, msg) {
  if (ms === undefined) ms = 5000
  if (msg === undefined) msg = '请求超时'
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(msg)) }, ms)
    })
  ])
}

function unwrapCacheData(docData) {
  let apiData = docData.data || docData
  if (apiData && typeof apiData === 'object' && !Array.isArray(apiData)) {
    if (apiData.data && apiData.data.results && Array.isArray(apiData.data.results)) {
      apiData = apiData.data
    }
  }
  return apiData
}

module.exports = {
  emptyListResult,
  withTimeout,
  unwrapCacheData
}
