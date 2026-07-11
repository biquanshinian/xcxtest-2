// 视频号直播区块 · 自定义封面远程配置缓存
// 策略：内存 + wx.storage，TTL 30 分钟；stale-while-revalidate

const STORAGE_KEY = 'channels_live_cover_config_v2'
const TTL_MS = 30 * 60 * 1000

let _memCache = null
let _memChecked = false // 已尝试读过 storage（含未命中），后续纯内存
let _inflight = null

/** 取本地：内存优先，未读过则异步读 storage 回填（避免页面打开路径 getStorageSync） */
function readLocalAsync() {
  if (_memCache && _memCache.data) return Promise.resolve(_memCache)
  if (_memChecked) return Promise.resolve(null)
  return new Promise((resolve) => {
    wx.getStorage({
      key: STORAGE_KEY,
      success: (res) => {
        const raw = res.data
        if (raw && raw.data && typeof raw.ts === 'number') _memCache = raw
        _memChecked = true
        resolve(_memCache)
      },
      fail: () => {
        _memChecked = true
        resolve(null)
      }
    })
  })
}

function writeLocal(data) {
  const entry = { data, ts: Date.now() }
  _memCache = entry
  _memChecked = true
  try { wx.setStorage({ key: STORAGE_KEY, data: entry, fail: () => {} }) } catch (e) {}
}

function isFresh(entry) {
  return entry && entry.ts && (Date.now() - entry.ts) < TTL_MS
}

function fetchRemote() {
  if (_inflight) return _inflight
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('wx.cloud 不可用'))
  }
  _inflight = wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: '/channels-live-config', method: 'GET' }
  }).then((res) => {
    const result = res && res.result
    const data = (result && result.data) || null
    if (data) writeLocal(data)
    return data
  }).finally(() => { _inflight = null })
  return _inflight
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.forceRefresh]
 * @param {function} [opts.onUpdate]
 * @returns {Promise<object|null>}
 */
async function getChannelsLiveCoverConfig(opts) {
  const options = opts || {}
  const local = await readLocalAsync()

  if (!options.forceRefresh && isFresh(local)) {
    return local.data
  }

  if (!options.forceRefresh && local && local.data) {
    fetchRemote().then((data) => {
      if (data && typeof options.onUpdate === 'function') {
        try { options.onUpdate(data) } catch (e) {}
      }
    }).catch(() => {})
    return local.data
  }

  return fetchRemote().catch((e) => {
    if (local && local.data) return local.data
    throw e
  })
}

module.exports = {
  getChannelsLiveCoverConfig
}
