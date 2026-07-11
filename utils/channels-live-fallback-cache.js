/**
 * 推荐视频号引导（自己未开播兜底）
 * 主包同步模块：避免 require.async 失败后一直停在本地旧默认图
 *
 * 策略：
 * 1) 优先云函数 adminGateway GET
 * 2) 失败再尝试客户端直读云库 channels_live_config/fallback_guide
 * 3) 不再用带旧二维码的本地默认图顶替云端结果
 */
const config = require('./config.js')

const STORAGE_KEY = 'channels_live_fallback_guide_v3'
const CLOUD_COLLECTION = 'channels_live_config'
const CLOUD_DOC_ID = 'fallback_guide'

let _memCache = null
let _inflight = null

function emptyGuide() {
  return {
    enabled: false,
    title: '推荐观看',
    nickname: '',
    qrUrl: '',
    qrDisplayUrl: '',
    tip: '扫码前往视频号主页，可预约或观看直播',
    updatedAt: ''
  }
}

function bustQrUrl(url, updatedAt) {
  const u = String(url || '').trim()
  if (!u) return ''
  let token = String(updatedAt || '').replace(/[^\d]/g, '').slice(-14)
  if (!token) token = String(Date.now())
  const bare = u.replace(/([?&])_cb=\d+/g, '').replace(/[?&]$/, '')
  const sep = bare.indexOf('?') >= 0 ? '&' : '?'
  return `${bare}${sep}_cb=${token}`
}

function normalizeGuide(raw) {
  const body = (raw && typeof raw === 'object') ? raw : {}
  const nickname = String(body.nickname || '').trim()
  const qrUrl = String(body.qrUrl || '').trim()
  const updatedAt = body.updatedAt || ''
  return {
    enabled: !!(body.enabled && nickname && qrUrl),
    title: String(body.title || '推荐观看').trim() || '推荐观看',
    nickname,
    qrUrl,
    qrDisplayUrl: bustQrUrl(qrUrl, updatedAt),
    tip: String(body.tip || '扫码前往视频号主页，可预约或观看直播').trim(),
    updatedAt
  }
}

/** 仅作文案占位；禁止带二维码，避免云端失败时露出历史旧图 */
function getLocalDefault() {
  const raw = (config && config.channelsLive && config.channelsLive.fallbackGuide) || {}
  const guide = normalizeGuide({
    ...raw,
    qrUrl: '',
    enabled: false
  })
  return guide
}

function readLocalSync() {
  if (_memCache && _memCache.data) return _memCache
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && raw.data && typeof raw.ts === 'number') {
      _memCache = raw
      return raw
    }
  } catch (e) {}
  return null
}

function writeLocal(data) {
  const entry = { data, ts: Date.now() }
  _memCache = entry
  try { wx.setStorageSync(STORAGE_KEY, entry) } catch (e) {}
}

function clearLocal() {
  _memCache = null
  try { wx.removeStorageSync(STORAGE_KEY) } catch (e) {}
}

function extractDoc(res) {
  if (!res) return null
  let doc = res.data
  if (Array.isArray(doc)) doc = doc[0]
  if (!doc || typeof doc !== 'object') return null
  return doc
}

function fetchViaCallFunction() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('wx.cloud 不可用'))
  }
  return wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: '/channels-live-fallback-guide', method: 'GET' }
  }).then((res) => {
    const result = res && res.result
    if (!result) throw new Error('云函数无返回')
    if (result.code != null && Number(result.code) !== 0) {
      throw new Error(result.message || ('云函数错误 ' + result.code))
    }
    const data = result.data
    if (!data || typeof data !== 'object') throw new Error('云函数无配置数据')
    return normalizeGuide(data)
  })
}

function fetchViaDatabase() {
  if (!wx.cloud || !wx.cloud.database) {
    return Promise.reject(new Error('database 不可用'))
  }
  return wx.cloud.database()
    .collection(CLOUD_COLLECTION)
    .doc(CLOUD_DOC_ID)
    .get()
    .then((res) => {
      const doc = extractDoc(res)
      if (!doc) throw new Error('云库无文档')
      return normalizeGuide(doc)
    })
}

function fetchRemote() {
  if (_inflight) return _inflight
  _inflight = fetchViaCallFunction()
    .catch((err) => {
      console.warn('[fallback-guide] callFunction failed:', err && err.message ? err.message : err)
      return fetchViaDatabase()
    })
    .then((guide) => {
      if (guide && guide.qrUrl) writeLocal(guide)
      return guide
    })
    .finally(() => { _inflight = null })
  return _inflight
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.forceRefresh] 忽略本地缓存，强制拉云端
 * @param {function} [opts.onUpdate]
 * @returns {Promise<object>}
 */
async function getChannelsLiveFallbackGuide(opts) {
  const options = opts || {}
  const cached = readLocalSync()

  if (options.forceRefresh) {
    clearLocal()
    try {
      const remote = await fetchRemote()
      if (remote) return remote
    } catch (e) {
      console.warn('[fallback-guide] forceRefresh failed:', e && e.message ? e.message : e)
      if (cached && cached.data && cached.data.qrUrl) return normalizeGuide(cached.data)
    }
    return emptyGuide()
  }

  if (cached && cached.data && cached.data.qrUrl) {
    fetchRemote().then((data) => {
      if (!data || typeof options.onUpdate !== 'function') return
      const prev = normalizeGuide(cached.data)
      if (
        prev.qrUrl === data.qrUrl &&
        prev.nickname === data.nickname &&
        prev.title === data.title &&
        prev.tip === data.tip &&
        !!prev.enabled === !!data.enabled &&
        String(prev.updatedAt || '') === String(data.updatedAt || '')
      ) return
      try { options.onUpdate(data) } catch (e) {}
    }).catch(() => {})
    return normalizeGuide(cached.data)
  }

  try {
    const remote = await fetchRemote()
    if (remote) return remote
  } catch (e) {
    console.warn('[fallback-guide] fetch failed:', e && e.message ? e.message : e)
  }
  return emptyGuide()
}

module.exports = {
  getChannelsLiveFallbackGuide,
  getLocalDefault,
  normalizeGuide,
  bustQrUrl,
  clearLocal,
  emptyGuide
}
