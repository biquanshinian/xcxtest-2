/**
 * 空间站 TLE：Worker 兜底拉取，带内存缓存与 inflight 去重（仅监控分包使用）
 */

const { workerProxyUrl } = require('../../../utils/config.js')
const { requestJsonData } = require('./http-request.js')

const MEM_TTL_MS = 5 * 60 * 1000

let _mem = null
let _memTs = 0
let _inflight = null

function fetchStationTleFromWorker() {
  const now = Date.now()
  if (_mem && now - _memTs < MEM_TTL_MS) {
    return Promise.resolve(_mem)
  }
  if (_inflight) return _inflight

  const base = workerProxyUrl || 'https://api.marsx.com.cn'
  const url = `${base}/station-tle`

  _inflight = requestJsonData({ url, timeout: 15000 })
    .then((data) => {
      if (!data || data.code !== 0) {
        throw new Error('TLE 请求失败')
      }
      _mem = data
      _memTs = Date.now()
      return data
    })
    .finally(() => {
      _inflight = null
    })

  return _inflight
}

module.exports = {
  fetchStationTleFromWorker
}
