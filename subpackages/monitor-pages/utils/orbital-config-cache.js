// 太空轨道数据中心 · 远程配置缓存层
// 策略：内存缓存 + wx.storage 持久化，TTL 30 分钟
// 先返回缓存（如有），再异步刷新；过期则强制刷新

const STORAGE_KEY = 'orbital_config_cache_v1'
const TTL_MS = 30 * 60 * 1000 // 30 分钟

let _memCache = null // { data, ts }
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

/** 实际拉取远程（云函数） */
function fetchRemote() {
  if (_inflight) return _inflight
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('wx.cloud 不可用'))
  }
  _inflight = wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: '/orbital-config', method: 'GET' }
  }).then((res) => {
    const result = res && res.result
    const data = (result && result.data) || null
    if (data) writeLocal(data)
    return data
  }).finally(() => { _inflight = null })
  return _inflight
}

/**
 * 获取轨道配置
 * @param {object} opts
 * @param {boolean} opts.forceRefresh 强制刷新
 * @param {function} opts.onUpdate 拿到新数据时的回调（用于 stale-while-revalidate）
 * @returns {Promise<object|null>}
 */
async function getOrbitalConfig(opts) {
  const options = opts || {}
  const local = await readLocalAsync()

  // 命中且新鲜，直接返回
  if (!options.forceRefresh && isFresh(local)) {
    return local.data
  }

  // 命中但过期：先返回旧的，后台静默刷新
  if (!options.forceRefresh && local && local.data) {
    fetchRemote().then((data) => {
      if (data && typeof options.onUpdate === 'function') {
        try { options.onUpdate(data) } catch (e) {}
      }
    }).catch(() => {})
    return local.data
  }

  // 没本地缓存或强制刷新
  return fetchRemote().catch((e) => {
    // 拉取失败时仍尝试用旧缓存兜底
    if (local && local.data) return local.data
    throw e
  })
}

/** 主动清空缓存（不常用，留给将来加「立即生效」按钮） */
function clearOrbitalConfigCache() {
  _memCache = null
  _memChecked = false
  try { wx.removeStorage({ key: STORAGE_KEY, fail: () => {} }) } catch (e) {}
}

module.exports = {
  getOrbitalConfig,
  clearOrbitalConfigCache
}
