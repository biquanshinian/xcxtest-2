/**
 * wx.downloadFile 并发池，避免首屏同时发起过多下载导致失败率升高
 */

const MAX_CONCURRENT = 4

let _active = 0
const _queue = []

function _drain() {
  while (_active < MAX_CONCURRENT && _queue.length > 0) {
    const job = _queue.shift()
    _active++
    job.task()
      .then(job.resolve, job.reject)
      .finally(() => {
        _active--
        _drain()
      })
  }
}

/**
 * @param {() => Promise<*>} task
 * @returns {Promise<*>}
 */
function runDownload(task) {
  return new Promise((resolve, reject) => {
    _queue.push({ task, resolve, reject })
    _drain()
  })
}

/**
 * wx.downloadFile 经并发池排队，避免首屏同时过多下载
 * @param {WechatMiniprogram.DownloadFileOption} options
 * @returns {Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>}
 */
function pooledDownloadFile(options) {
  return runDownload(() => new Promise((resolve, reject) => {
    wx.downloadFile({
      ...options,
      success: resolve,
      fail: reject
    })
  }))
}

module.exports = {
  runDownload,
  pooledDownloadFile,
  MAX_CONCURRENT
}
