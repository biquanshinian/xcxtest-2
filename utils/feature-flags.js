/**
 * 前端功能开关：读 global_config.main（后台「全局配置中心」维护）
 * 模块级缓存 + inflight 去重：贴图讨论区组件遍布全站详情页，
 * 避免每个组件实例各查一次库；TTL 内整个会话只读一次。
 */
const TTL = 5 * 60 * 1000

let _cache = null
let _cacheAt = 0
let _inflight = null

/**
 * @param {boolean} [forceRefresh]
 * @returns {Promise<Object>}
 */
function _fetchMainConfigOnce(opts) {
  // allowStaleFallback=false（force 失败）：拒绝回落旧缓存，供 failClosed 入口使用
  const allowStaleFallback = !opts || opts.allowStaleFallback !== false
  if (!wx.cloud || !wx.cloud.database) {
    if (!allowStaleFallback) {
      return Promise.reject(new Error('GLOBAL_CONFIG_UNAVAILABLE'))
    }
    return Promise.resolve(_cache || {})
  }
  return wx.cloud.database()
    .collection('global_config')
    .doc('main')
    .get()
    .then((res) => {
      _cache = (res && res.data) || {}
      _cacheAt = Date.now()
      return _cache
    })
    .catch(() => {
      // 兼容旧权限：doc 读失败时再试 where
      return wx.cloud.database()
        .collection('global_config')
        .where({ _id: 'main' })
        .limit(1)
        .get()
        .then((res) => {
          _cache = (res.data && res.data[0]) || {}
          _cacheAt = Date.now()
          return _cache
        })
        .catch((err) => {
          if (!allowStaleFallback) {
            return Promise.reject(err || new Error('GLOBAL_CONFIG_FETCH_FAILED'))
          }
          return _cache || {}
        })
    })
}

function fetchMainConfig(forceRefresh) {
  const now = Date.now()
  if (!forceRefresh && _cache && now - _cacheAt < TTL) return Promise.resolve(_cache)
  // forceRefresh：等当前 inflight 结束后再打一枪，避免吞掉强制刷新
  if (_inflight) {
    if (!forceRefresh) return _inflight
    return _inflight.then(() => fetchMainConfig(true)).catch(() => fetchMainConfig(true))
  }
  _inflight = _fetchMainConfigOnce({ allowStaleFallback: !forceRefresh })
    .finally(() => { _inflight = null })
  return _inflight
}

/** 同步读已缓存的 main（未拉取则为 null） */
function getCachedMainConfig() {
  return _cache
}

/**
 * 单个开关是否开启。字段缺省视为开启（!== false），
 * 与 enableBriefing/enableEventVideo 等既有全局开关语义一致。
 * @param {String} field 如 'enableLiveWatch' / 'enablePublishPanel' / 'enableLunarWishes'
 * @param {{ failClosed?: boolean, defaultOff?: boolean }} [options]
 *   failClosed=true：读库失败或拿不到 main 配置时视为关闭（用于需彻底隐藏的入口）
 *   defaultOff=true：字段缺省视为关闭（=== true 才开启），用于「默认关闭、后台显式开启」的新功能，
 *     与后台管理端 enableMissionSim 等字段的读取语义保持一致
 * @returns {Promise<Boolean>}
 */
function isFeatureEnabled(field, options) {
  const failClosed = !!(options && options.failClosed)
  const defaultOff = !!(options && options.defaultOff)
  return fetchMainConfig()
    .then((cfg) => {
      if (failClosed && (!cfg || !cfg._id)) return false
      if (defaultOff) return cfg[field] === true
      return cfg[field] !== false
    })
    .catch(() => !failClosed)
}

/**
 * 过审相关「可播视频」是否允许（事件视频 / 背景 mp4 / video-player）。
 * failClosed：读不到配置视为关闭，避免送审时露出播放控件。
 * @returns {Promise<Boolean>}
 */
function isPlaybackAllowed() {
  return fetchMainConfig()
    .then((cfg) => {
      if (!cfg || !cfg._id) return false
      return cfg.enableEventVideo !== false
    })
    .catch(() => false)
}

/**
 * 直播入口是否允许（任务详情 + 监控中心）。
 * 需 enableLiveWatch 开启，且 enableLive 未被显式关闭；failClosed。
 * enableLive 缺省（旧配置无字段）视为允许，与历史「只靠 enableLiveWatch」兼容；
 * 一键过审会写入 enableLive=false。
 * @returns {Promise<Boolean>}
 */
function isLiveEntryAllowed() {
  return fetchMainConfig()
    .then((cfg) => {
      if (!cfg || !cfg._id) return false
      if (cfg.enableLiveWatch === false) return false
      if (cfg.enableLive === false) return false
      return true
    })
    .catch(() => false)
}

module.exports = {
  isFeatureEnabled,
  isPlaybackAllowed,
  isLiveEntryAllowed,
  fetchMainConfig,
  getCachedMainConfig
}
