/**
 * 统一 wx.request 封装：inflight 去重、GET 重试、可选本地 TTL 缓存、开发期埋点
 *
 * monitor-pages 分包内副本（space-explore 分包另有一份，修改时需同步）。
 * 不能跨分包同步 require，也不放主包（扫描会报「主包未使用文件」），故各分包自留一份。
 */

const DEFAULT_TIMEOUT = 8000
const MAX_RETRIES = 2
const RETRY_DELAYS = [300, 600]

const _inflight = Object.create(null)
const _memCache = Object.create(null)

function _inflightKey(url, method, data) {
  return `${method || 'GET'}:${url}:${JSON.stringify(data || {})}`
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function _logDev(meta) {
  try {
    const env = typeof __wxConfig !== 'undefined' && __wxConfig.envVersion
    if (env !== 'develop' && env !== 'trial') return
    const tag = meta.fromCache ? 'cache' : (meta.statusCode != null ? meta.statusCode : 'fail')
    console.log('[http-request]', meta.url || meta.cacheKey, `${meta.durationMs || 0}ms`, tag, meta.retries ? `retry:${meta.retries}` : '')
  } catch (e) {}
}

function _readStorageCache(cacheKey, maxAge) {
  try {
    const stored = wx.getStorageSync(cacheKey)
    if (stored && stored.ts && stored.data != null && Date.now() - stored.ts < maxAge) {
      return stored.data
    }
  } catch (e) {}
  return null
}

function _writeStorageCache(cacheKey, data) {
  const entry = { ts: Date.now(), data }
  _memCache[cacheKey] = entry
  try {
    wx.setStorageSync(cacheKey, entry)
  } catch (e) {}
}

/**
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.method]
 * @param {object} [options.data]
 * @param {number} [options.timeout]
 * @param {string} [options.cacheKey] storage key（不含前缀时可自行加）
 * @param {number} [options.maxAge] 毫秒
 * @param {number} [options.retries] GET 失败重试次数，默认 2
 * @returns {Promise<{ok:boolean,data?:*,error?:*,statusCode?:number,fromCache?:boolean,retryable?:boolean}>}
 */
function requestJson(options) {
  const {
    url,
    method = 'GET',
    data,
    timeout = DEFAULT_TIMEOUT,
    cacheKey,
    maxAge = 0,
    retries = MAX_RETRIES
  } = options

  if (cacheKey && maxAge > 0) {
    const mem = _memCache[cacheKey]
    if (mem && Date.now() - mem.ts < maxAge) {
      _logDev({ cacheKey, fromCache: true, durationMs: 0 })
      return Promise.resolve({ ok: true, data: mem.data, fromCache: true })
    }
    const stored = _readStorageCache(cacheKey, maxAge)
    if (stored != null) {
      _logDev({ cacheKey, fromCache: true, durationMs: 0 })
      return Promise.resolve({ ok: true, data: stored, fromCache: true })
    }
  }

  const key = _inflightKey(url, method, data)
  if (_inflight[key]) return _inflight[key]

  const promise = _doRequest({ url, method, data, timeout }, retries, 0).then((result) => {
    if (result.ok && cacheKey && maxAge > 0) {
      _writeStorageCache(cacheKey, result.data)
    }
    return result
  }).finally(() => {
    delete _inflight[key]
  })

  _inflight[key] = promise
  return promise
}

function _doRequest(opts, retriesLeft, attempt) {
  const { url, method, data, timeout } = opts
  const start = Date.now()

  return new Promise((resolve) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      success(res) {
        const status = res.statusCode
        if (status >= 200 && status < 300) {
          _logDev({ url, statusCode: status, durationMs: Date.now() - start, retries: attempt })
          resolve({ ok: true, data: res.data, statusCode: status })
          return
        }
        if (method === 'GET' && status >= 500 && retriesLeft > 0) {
          _retry(resolve)
          return
        }
        resolve({
          ok: false,
          error: new Error('HTTP ' + status),
          statusCode: status,
          retryable: status >= 500
        })
      },
      fail(err) {
        if (method === 'GET' && retriesLeft > 0) {
          _retry(resolve)
          return
        }
        _logDev({ url, durationMs: Date.now() - start, retries: attempt, error: err && err.errMsg })
        resolve({
          ok: false,
          error: err || new Error('request:fail'),
          retryable: true
        })
      }
    })

    function _retry(done) {
      const delay = RETRY_DELAYS[attempt] || 600
      _sleep(delay).then(() => {
        _doRequest(opts, retriesLeft - 1, attempt + 1).then(done)
      })
    }
  })
}

/** 成功返回 data，失败 throw */
function requestJsonData(options) {
  return requestJson(options).then((r) => {
    if (r.ok) return r.data
    throw r.error || new Error('request failed')
  })
}

module.exports = {
  requestJson,
  requestJsonData,
  DEFAULT_TIMEOUT
}
