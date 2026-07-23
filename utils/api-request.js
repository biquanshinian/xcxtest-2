// utils/api-request.js — HTTP/cache layer shared by api modules
const { cleanExpiredApiCache } = require('./api-cache-clean.js')
const {
  CACHE_PREFIX,
  CACHE_DURATION,
  SLOW_CACHE_DURATION,
  SLOW_STALE_CACHE_MAX_AGE,
  isSlowEndpointKey
} = require('./cache-constants.js')
const {
  emptyListResult,
  withTimeout,
  unwrapCacheData
} = require('./api-list-helpers.js')

// 环境配置：true=开发环境，false=生产环境
// 开发环境：https://lldev.thespacedevs.com/2.3.0
// 生产环境：https://ll.thespacedevs.com/2.3.0
// ⚠️ 注意：开发环境API可能不稳定或不可用，如遇超时请改为 false 使用生产环境
const USE_DEV_API = false

const LAUNCH_LIBRARY_API = USE_DEV_API 
  ? 'https://lldev.thespacedevs.com/2.3.0'
  : 'https://ll.thespacedevs.com/2.3.0'
// 有效载荷、payload_flights API
const PAYLOAD_API_BASE = USE_DEV_API 
  ? 'https://lldev.thespacedevs.com/2.3.0'
  : 'https://ll.thespacedevs.com/2.3.0'

// 缓存配置：
// - 本地缓存：30分钟（用于快速响应，避免频繁查询云数据库）
// - 云数据库缓存：3.5小时（由云函数同步，主要数据源）
// 云函数每3小时执行1次，云数据库缓存有效期3.5小时，确保在同步间隔期间数据仍然可用
const STALE_CACHE_MAX_AGE = 4 * 60 * 60 * 1000 // 4 小时 - 过期缓存最大可用时间（stale-while-revalidate）
const CLOUD_CACHE_DURATION = 3.5 * 60 * 60 * 1000 // 3.5小时（毫秒）- 云数据库缓存有效期

// ── 慢变化端点（空间站/对接/远征/机构）按 key 分档 ──
// 云端 6 小时才同步一次，本地按 30 分钟节奏回云读库纯属浪费；
// 慢档 key 的本地 TTL / stale 上限 / 后台探云间隔统一对齐服务端同步周期
function _localCacheDurationFor(cacheKey) {
  return isSlowEndpointKey(cacheKey) ? SLOW_CACHE_DURATION : CACHE_DURATION
}

function _staleMaxAgeFor(cacheKey) {
  return isSlowEndpointKey(cacheKey) ? SLOW_STALE_CACHE_MAX_AGE : STALE_CACHE_MAX_AGE
}

function _bgCheckIntervalFor(cacheKey) {
  if (isSlowEndpointKey(cacheKey)) return SLOW_CACHE_DURATION
  // CLOUD_CACHE_BG_CHECK_INTERVAL / LAUNCH_LIST_* 在下方声明；运行时 request 才调用本函数
  if (typeof isLaunchListCacheKey === 'function' && isLaunchListCacheKey(cacheKey)) {
    return LAUNCH_LIST_BG_CHECK_INTERVAL
  }
  return CLOUD_CACHE_BG_CHECK_INTERVAL
}

// ── 内存缓存层：避免同一 key 反复调用 getStorageSync ──
const _memCache = Object.create(null)   // { key: { data, expireAt } }
// ── storage 同步读取去重层：记录每个 key 上一次同步读到的"原始 entry"，
// 让 stale 探测也能复用，从根源消除"重复读同一 key"的告警 ──
const _storageReadCache = Object.create(null) // { key: { entry, expireAt } }
const STORAGE_READ_DEDUP_TTL = 60 * 1000
// miss（key 不存在）记忆时间可以更长：api_cache_* 只由本模块的 setCache 写入，
// setCache 会同步刷新去重层，因此不会读到僵尸 miss
const STORAGE_READ_MISS_TTL = 5 * 60 * 1000

// ── api_cache_* 已存在 key 的异步索引 ──
// 冷启动候选 key 扫描会对 8~12 个历史格式 key 各做一次 getStorageSync（微信启动
// 性能报告的主要告警来源）。这里用一次异步 wx.getStorageInfo 建立「存在哪些 key」
// 的索引，索引就绪后不存在的 key 直接判 miss，不再触发同步读。
let _existingKeyIndex = null // Set<string> | null（null = 索引尚未就绪）
let _existingKeyIndexRequested = false
// 索引就绪前发生的写入/删除，就绪时补录（消除快照与回调之间的竞态窗口）
const _pendingIndexAdds = new Set()
function _ensureExistingKeyIndex() {
  if (_existingKeyIndexRequested) return
  _existingKeyIndexRequested = true
  try {
    wx.getStorageInfo({
      success: (info) => {
        const set = new Set()
        const keys = (info && info.keys) || []
        for (let i = 0; i < keys.length; i++) {
          if (keys[i].startsWith(CACHE_PREFIX)) set.add(keys[i])
        }
        _pendingIndexAdds.forEach((k) => set.add(k))
        _pendingIndexAdds.clear()
        _existingKeyIndex = set
      },
      fail: () => {}
    })
  } catch (e) {}
}
_ensureExistingKeyIndex()

function _indexMarkExists(cacheKey) {
  if (_existingKeyIndex) _existingKeyIndex.add(cacheKey)
  else _pendingIndexAdds.add(cacheKey)
}

function _indexMarkRemoved(cacheKey) {
  if (_existingKeyIndex) _existingKeyIndex.delete(cacheKey)
  else _pendingIndexAdds.delete(cacheKey)
}

function _memGet(key) {
  const entry = _memCache[key]
  if (!entry) return undefined          // undefined = 未命中
  if (Date.now() > entry.expireAt) {
    delete _memCache[key]
    return undefined
  }
  return entry.data                     // 可能是 null（表示"已读过，确认无缓存"）
}

function _memSet(key, data, ttl) {
  _memCache[key] = { data, expireAt: Date.now() + ttl }
}

function _memDel(key) {
  delete _memCache[key]
}

/**
 * 同步读取 storage，但带去重层。同一个 key 在 STORAGE_READ_DEDUP_TTL 内
 * 只真正同步读 1 次，后续直接复用结果。
 * 这样 stale / non-stale 两条路径就不会重复读同一 key。
 * @returns {*|null} storage 中保存的原始对象（含 timestamp），不存在返回 null
 */
function _readStorageEntryDeduped(cacheKey) {
  const cached = _storageReadCache[cacheKey]
  if (cached && Date.now() < cached.expireAt) {
    return cached.entry
  }
  // 索引已就绪且 key 确认不存在：零成本 miss，避免候选 key 扫描风暴
  if (_existingKeyIndex && !_existingKeyIndex.has(cacheKey)) {
    _storageReadCache[cacheKey] = {
      entry: null,
      expireAt: Date.now() + STORAGE_READ_MISS_TTL
    }
    return null
  }
  let entry = null
  try {
    entry = wx.getStorageSync(cacheKey) || null
  } catch (e) {
    entry = null
  }
  if (entry === null) _indexMarkRemoved(cacheKey)
  _storageReadCache[cacheKey] = {
    entry,
    expireAt: Date.now() + (entry ? STORAGE_READ_DEDUP_TTL : STORAGE_READ_MISS_TTL)
  }
  return entry
}

function _invalidateStorageReadCache(cacheKey) {
  delete _storageReadCache[cacheKey]
}
// 重试配置
const MAX_RETRIES = USE_DEV_API ? 3 : 2 // 开发环境重试3次，生产环境2次
const RETRY_DELAY = 1000 // 重试延迟1秒

// 云缓存查询去重与节流：避免同一时刻大量重复查询触发数据库超时
const pendingCloudCacheRequests = Object.create(null)
const cloudCacheBgCheckAt = Object.create(null)
// 本地命中后的后台探云间隔：云端缓存由云函数约 3 小时同步一次，
// 2 分钟探一次纯属浪费计费调用，30 分钟足以及时拿到新数据
const CLOUD_CACHE_BG_CHECK_INTERVAL = 30 * 60 * 1000 // 30分钟
/** 发射列表会被小时探针/详情就地改写，探云需更勤，否则 previous 插入对客户端最长不可见 30min */
const LAUNCH_LIST_BG_CHECK_INTERVAL = 3 * 60 * 1000

function isLaunchListCacheKey(cacheKey) {
  if (typeof cacheKey !== 'string') return false
  return (
    cacheKey.indexOf('/launches/upcoming/') !== -1 ||
    cacheKey.indexOf('/launches/previous/') !== -1
  )
}

// 云端候选 key 查询上限：精确 key + 当前版本主 key + 1 个兜底，
// 旧版 slim 后缀只在本地扫描时兜底展示，不再打到云数据库
const MAX_CLOUD_CANDIDATE_KEYS = 3
// 旧版 slim schema 后缀（云端早已不再写入这些 key，读了也是白读）
const LEGACY_SLIM_SUFFIXES = ['_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim']

function _isLegacySlimKey(key) {
  return LEGACY_SLIM_SUFFIXES.some((sfx) => key.endsWith(sfx))
}

// ── 后台缓存更新监听器 ──
// 当 request 命中本地缓存后，后台发现云数据库有更新时，通知订阅方刷新 UI
const _staleUpdateListeners = Object.create(null)
/** 发射列表（upcoming/previous）任意 key 变新鲜时的总线；首页/搜索可订阅而不用绑死精确 key */
const _launchListStaleListeners = []

/**
 * 注册后台缓存更新监听器
 * @param {String} cacheKey 缓存 key
 * @param {Function} callback 回调函数，参数为新数据
 * @returns {Function} 取消监听的函数
 */
function onStaleUpdate(cacheKey, callback) {
  if (!_staleUpdateListeners[cacheKey]) {
    _staleUpdateListeners[cacheKey] = []
  }
  _staleUpdateListeners[cacheKey].push(callback)
  return function off() {
    const arr = _staleUpdateListeners[cacheKey]
    if (!arr) return
    const idx = arr.indexOf(callback)
    if (idx !== -1) arr.splice(idx, 1)
    if (arr.length === 0) delete _staleUpdateListeners[cacheKey]
  }
}

/**
 * 订阅发射列表母缓存后台变新鲜（不依赖精确 limit key）。
 * @param {Function} callback (info: { cacheKey, kind: 'upcoming'|'previous'|'other', data })
 * @returns {Function} off
 */
function onLaunchListStale(callback) {
  if (typeof callback !== 'function') return function () {}
  _launchListStaleListeners.push(callback)
  return function off() {
    const idx = _launchListStaleListeners.indexOf(callback)
    if (idx !== -1) _launchListStaleListeners.splice(idx, 1)
  }
}

function _fireStaleUpdate(cacheKey, newData) {
  // 列表母缓存刷新后丢掉内存快照，避免 5min 内仍吐旧 previous/upcoming
  if (isLaunchListCacheKey(cacheKey)) {
    try {
      const listApi = require('./api-launch-list.js')
      if (listApi && typeof listApi.invalidateListSnapshots === 'function') {
        listApi.invalidateListSnapshots()
      }
    } catch (e) {}
    const kind =
      cacheKey.indexOf('/launches/previous/') !== -1
        ? 'previous'
        : cacheKey.indexOf('/launches/upcoming/') !== -1
          ? 'upcoming'
          : 'other'
    _launchListStaleListeners.slice().forEach((fn) => {
      try {
        fn({ cacheKey, kind, data: newData })
      } catch (e) {
        console.error('[launchListStale] callback error:', e)
      }
    })
  }
  const arr = _staleUpdateListeners[cacheKey]
  if (!arr || arr.length === 0) return
  arr.slice().forEach(fn => {
    try { fn(newData) } catch (e) { console.error('[staleUpdate] callback error:', e) }
  })
}

/**
 * 生成缓存key
 * @param {String} url API路径
 * @param {Object} params 请求参数
 * @returns {String} 缓存key
 */
function getCacheKey(url, params = {}) {
  // 对参数对象进行排序，确保属性顺序一致，避免 cacheKey 不匹配
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = params[key]
      return sorted
    }, {})
  const paramsStr = JSON.stringify(sortedParams)

  // launches 列表：云端同步使用轻量列表缓存（key 追加 _slim）
  // 这里保持与云函数的规则一致：upcoming/previous 且 mode=detailed
  const shouldUseSlimList = typeof url === 'string' &&
    (url.includes('/launches/upcoming/') || url.includes('/launches/previous/')) &&
    params && typeof params === 'object' && params.mode === 'detailed'

  // _v4 是当前 slim schema 版本号——每次列表瘦身规则变更都必须同步云端与前端，避免读到缺字段的「僵尸数据」
  //   v1: 初始轻量 schema
  //   v2: detail 单条缓存保留 landing.type/success 等
  //   v3: 列表 slim 保留 landing.success + spacecraft_stage + launcher_stage
  //   v4: 保留 mission.orbit 及载荷 orbit（与云 slimLaunch 一致，供详情「任务轨道」）
  //   v5: configuration 保留 reusable（构型级可回收判定，长十乙网系回收等）
  //   v6: 保留嵌套 updates（历史发射动态冷路径，与云 _slim_v6 对齐）
  const SLIM_LIST_VERSION = '_v6'
  return `${CACHE_PREFIX}${url}_${paramsStr}${shouldUseSlimList ? '_slim' + SLIM_LIST_VERSION : ''}`
}

/**
 * 从本地存储获取缓存数据（同步）
 * 内部走两级缓存：
 *   1. _memCache —— 仅缓存「新鲜数据」(非 stale)
 *   2. _storageReadCache —— 缓存 storage 同步读到的「原始 entry」，
 *      stale / non-stale 路径共享，避免重复 getStorageSync
 * @param {String} cacheKey 缓存key
 * @param {Boolean} allowStale 是否允许返回过期但未超龄的数据（stale-while-revalidate）
 * @returns {Object|null} 缓存数据，如果不存在或已过期则返回null
 */
function getCacheFromLocal(cacheKey, allowStale) {
  try {
    if (!allowStale) {
      const mem = _memGet(cacheKey)
      if (mem !== undefined) return mem
    }

    // 通过去重层读 storage：同一个 key 在 60s 内只真正 sync 读 1 次
    const cacheData = _readStorageEntryDeduped(cacheKey)
    if (!cacheData) {
      if (!allowStale) _memSet(cacheKey, null, 60 * 1000)
      return null
    }

    const now = Date.now()
    const age = now - cacheData.timestamp
    const localDuration = _localCacheDurationFor(cacheKey)

    if (age <= localDuration) {
      const remainTTL = localDuration - age
      _memSet(cacheKey, cacheData.data, remainTTL)
      return cacheData.data
    }

    // 缓存已过期
    if (allowStale && age <= _staleMaxAgeFor(cacheKey)) {
      return cacheData.data
    }

    // 完全过期，异步删除存储并清掉去重层（不阻塞主线程）
    try {
      wx.removeStorage({ key: cacheKey, fail: () => {} })
    } catch (e) {}
    _memDel(cacheKey)
    _invalidateStorageReadCache(cacheKey)
    _indexMarkRemoved(cacheKey)
    return null
  } catch (error) {
    return null
  }
}

/**
 * 从云数据库获取缓存数据（异步）
 * @param {String} cacheKey 缓存key
 * @returns {Promise<Object|null>} 缓存数据，如果不存在或已过期则返回null
 */
async function getCacheFromCloud(cacheKey, timeout = 5000) {
  if (!cacheKey) return null

  // 同一个 cacheKey 在同一时间只发起一次云查询，其他调用复用同一个 Promise
  if (pendingCloudCacheRequests[cacheKey]) {
    return pendingCloudCacheRequests[cacheKey]
  }

  const requestPromise = (async () => {
    try {
      if (!wx.cloud || !wx.cloud.database) {
        return null
      }

      const db = wx.cloud.database()

      // 文档确实不存在（definitive miss）：不值得重试
      const isDocMissError = (error) => {
        const code = error && (error.errCode != null ? error.errCode : error.code)
        const msg = String((error && error.errMsg) || '')
        return code === -502004 || code === 'DATABASE_DOCUMENT_NON_EXIST' ||
          msg.indexOf('non-exist') !== -1 || msg.indexOf('not exist') !== -1
      }

      const fetchDoc = (ms) => Promise.race([
        db.collection('space_devs_cache').doc(cacheKey).get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('云数据库查询超时')), ms))
      ])

      // 偶发超时 / 网络抖动自动重试一次（第二次放宽超时），避免误报「数据暂不可用」
      let result
      try {
        result = await fetchDoc(timeout)
      } catch (firstError) {
        if (isDocMissError(firstError)) return null
        result = await fetchDoc(Math.max(timeout, 8000))
      }

      if (!result.data) return null

      let apiData = result.data.data || null
      if (!apiData && result.data.results && Array.isArray(result.data.results)) {
        apiData = result.data
      }
      if (!apiData) return null

      apiData = unwrapCacheData(apiData)

      const hollowBatched =
        !!(apiData.isBatched || apiData.isBatch) &&
        Array.isArray(apiData.results) &&
        apiData.results.length === 0 &&
        Number(apiData.count) > 0

      if (apiData.isBatched && apiData.batchKeys && Array.isArray(apiData.batchKeys)) {
        const batchPromises = apiData.batchKeys.map(async (batchKey) => {
          try {
            const batchResult = await Promise.race([
              db.collection('space_devs_cache').doc(batchKey).get(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('批次查询超时')), 5000))
            ])
            return (batchResult.data && batchResult.data.data && batchResult.data.data.results) || []
          } catch (batchError) {
            return []
          }
        })

        const batchResults = await Promise.all(batchPromises)
        const mergedResults = batchResults.reduce((all, chunk) => all.concat(chunk || []), [])
        // 主文档声明有数据但批次全部读取失败（超时/网络抖动）：
        // 视为本次云查询失败，绝不能把空列表当成功结果缓存到本地
        if (mergedResults.length === 0 && Number(apiData.count) > 0) {
          return null
        }
        apiData = {
          ...apiData,
          results: mergedResults,
          count: mergedResults.length,
          isBatched: false,
          isBatch: false
        }
      } else if (hollowBatched) {
        // 无 batchKeys 时按小时探针同约定扫 _batch_N，避免把空 results 当成「真的没有历史」
        const mergedResults = []
        for (let batchIdx = 0; batchIdx < 40; batchIdx++) {
          const batchKey = `${cacheKey}_batch_${batchIdx}`
          try {
            const batchResult = await Promise.race([
              db.collection('space_devs_cache').doc(batchKey).get(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('批次查询超时')), 5000))
            ])
            const chunk =
              (batchResult.data && batchResult.data.data && batchResult.data.data.results) || null
            if (!Array.isArray(chunk)) break
            for (let i = 0; i < chunk.length; i++) mergedResults.push(chunk[i])
          } catch (e) {
            break
          }
        }
        if (mergedResults.length === 0) return null
        apiData = {
          ...apiData,
          results: mergedResults,
          count: mergedResults.length,
          isBatched: false,
          isBatch: false
        }
      }

      if (!apiData.results || !Array.isArray(apiData.results)) {
        // 兼容单对象 API（如 /space_stations/4/），没有 results 数组但有 id 字段
        if (apiData.id) {
          try {
            setCache(cacheKey, apiData)
          } catch (error) {}
          return apiData
        }
        return null
      }

      // 分批主文档若仍空壳且声称有 count：禁止写入本地，避免永久空历史
      if (
        apiData.results.length === 0 &&
        Number(apiData.count) > 0 &&
        !!(apiData.isBatched || apiData.isBatch)
      ) {
        return null
      }

      try {
        setCache(cacheKey, apiData)
      } catch (error) {}

      return apiData
    } catch (error) {
      const isSizeExceedError = error.errCode === -602001 ||
        (error.errMsg && error.errMsg.includes('exceed limit')) ||
        (error.errMsg && error.errMsg.includes('1MB'))

      if (isSizeExceedError) {
        const localCache = getCacheFromLocal(cacheKey)
        if (localCache !== null) return localCache
      }

      return null
    }
  })()

  pendingCloudCacheRequests[cacheKey] = requestPromise

  try {
    return await requestPromise
  } finally {
    delete pendingCloudCacheRequests[cacheKey]
  }
}

/**
 * 获取缓存数据（优先从云数据库读取，降级到本地存储）
 * @param {String} cacheKey 缓存key
 * @returns {Object|null} 缓存数据，如果不存在或已过期则返回null
 * 
 * 注意：此函数保持同步接口以兼容现有代码
 * 实际会先尝试本地缓存（快速），同时异步检查云数据库（后台更新）
 */
function getCache(cacheKey) {
  // 先尝试本地缓存（同步，快速响应）
  const localCache = getCacheFromLocal(cacheKey)
  if (localCache !== null) {
    // 后台异步检查云数据库是否有更新数据（不阻塞当前返回）
    // 增加节流，避免频繁重复查询导致云数据库超时
    const now = Date.now()
    const lastBgCheckAt = cloudCacheBgCheckAt[cacheKey] || 0
    if (now - lastBgCheckAt >= _bgCheckIntervalFor(cacheKey)) {
      cloudCacheBgCheckAt[cacheKey] = now
      getCacheFromCloud(cacheKey, 3000).then(cloudCache => {
        if (cloudCache !== null && cloudCache !== localCache) {
          // 云数据库有更新数据，更新本地缓存
          try {
            setCache(cacheKey, cloudCache)
          } catch (error) {
            // 静默失败
          }
        }
      }).catch(() => {
        // 静默失败
      })
    }
    return localCache
  }

  // 本地缓存不存在，返回null（调用方会继续请求API）
  // 注意：这里不等待云数据库查询，因为需要保持同步接口
  // 如果需要优先使用云数据库，应该在调用 request 函数前先调用 getCacheFromCloudAsync
  return null
}


/**
 * 清理数据中的 undefined、function 等不可序列化的值，确保可以正确序列化为 JSON
 * 使用简单的 JSON 序列化/反序列化即可
 * @param {*} obj 要清理的对象
 * @returns {*} 清理后的对象
 */
function cleanDataForJSON(obj) {
  if (obj === null || obj === undefined) {
    return null
  }
  
  // 使用 JSON 序列化/反序列化来清理数据（自动处理循环引用、undefined、function等）
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch (error) {
    // 如果序列化失败，返回 null
    return null
  }
}

/**
 * 保存缓存到云数据库（异步）
 * @param {String} cacheKey 缓存key
 * @param {*} data 要缓存的数据
 * @returns {Promise} 保存结果
 */
async function setCacheToCloud(cacheKey, data) {
  try {
    // 验证参数
    if (!cacheKey || typeof cacheKey !== 'string') {
      return false
    }
    
    if (data === null || data === undefined) {
      return false
    }
    
    // 检查是否已初始化云开发
    if (!wx.cloud || !wx.cloud.database) {
      return false
    }

    const db = wx.cloud.database()
    const now = Date.now()
    const expireAt = now + CLOUD_CACHE_DURATION

    // 清理数据（简单的 JSON 序列化/反序列化）
    const cleanedData = cleanDataForJSON(data)
    if (!cleanedData) {
      return false
    }
    
    // 构建缓存数据，格式与云函数保持一致
    const cacheData = {
      data: cleanedData,
      timestamp: now,
      expireAt: expireAt,
      updatedAt: now
    }

    // 保存到云数据库
    await db.collection('space_devs_cache').doc(cacheKey).set({
      data: cacheData
    })

    return true
  } catch (error) {
    // 云数据库保存失败，静默失败（不影响本地缓存）
    return false
  }
}

/**
 * 设置缓存数据（同时保存到本地和云数据库）
 * @param {String} cacheKey 缓存key
 * @param {*} data 要缓存的数据
 * 
 * 注意：优先保存到本地（同步），然后异步保存到云数据库（所有用户共享缓存）
 */
function setCache(cacheKey, data) {
  // 本地缓存最大字节数（避免触发 10MB 上限；并给其它业务留空间）
  const MAX_LOCAL_CACHE_BYTES = 512 * 1024 // 512KB

  const estimateBytes = (obj) => {
    try {
      const str = JSON.stringify(obj)
      return str.length * 3
    } catch (e) {
      return Number.POSITIVE_INFINITY
    }
  }

  try {
    // 验证参数
    if (!cacheKey || typeof cacheKey !== 'string') {
      return
    }

    if (data === null || data === undefined) {
      return
    }

    const cacheData = {
      data: data,
      timestamp: Date.now()
    }

    const bytes = estimateBytes(cacheData)

    // 过大的数据不写入本地 storage（否则很容易超过 10MB 总上限），
    // 但仍写入内存缓存：同会话内避免反复打云库（docking_events 约 300KB 常踩此阈值）
    if (bytes > MAX_LOCAL_CACHE_BYTES) {
      _memSet(cacheKey, data, _localCacheDurationFor(cacheKey))
      return
    }

    // 先保存到本地（同步，快速）
    wx.setStorageSync(cacheKey, cacheData)
    // 同步写入内存缓存
    _memSet(cacheKey, data, _localCacheDurationFor(cacheKey))
    // 同步刷新去重层，避免后续读取拿到旧的"原始 entry"
    _storageReadCache[cacheKey] = {
      entry: cacheData,
      expireAt: Date.now() + STORAGE_READ_DEDUP_TTL
    }
    _indexMarkExists(cacheKey)
  } catch (error) {
    // 如果存储空间不足，尝试清理旧缓存
    if (error.errMsg && error.errMsg.includes('exceed')) {
      clearExpiredCache()
      // 重试一次（仍然要做大小保护）
      try {
        if (cacheKey && typeof cacheKey === 'string') {
          const cacheData = {
            data: data,
            timestamp: Date.now()
          }
          const bytes = estimateBytes(cacheData)
          if (bytes <= MAX_LOCAL_CACHE_BYTES) {
            wx.setStorageSync(cacheKey, cacheData)
            _memSet(cacheKey, data, _localCacheDurationFor(cacheKey))
            _storageReadCache[cacheKey] = {
              entry: cacheData,
              expireAt: Date.now() + STORAGE_READ_DEDUP_TTL
            }
            _indexMarkExists(cacheKey)
          }
        }
      } catch (retryError) {
        // 静默失败
      }
    }
  }
}

/**
 * 清理过期的缓存（实现见 api-cache-clean.js，与 app 启动清理共用）
 */
function clearExpiredCache() {
  cleanExpiredApiCache()
}

/**
 * 构建缓存候选 key 列表（按命中概率降序排列，已去重）
 * 供 request() 在精确 key 未命中时依次探查
 */
function _buildCandidateKeys(url, params, exactKey) {
  const candidates = []
  const seen = new Set()
  function add(key, needsSlice) {
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ key, slice: needsSlice })
  }

  add(exactKey, false)

  const isDetailRequest = (/\/launches\/[^\/]+\/?$/.test(url)) &&
    !url.includes('/launches/upcoming') &&
    !url.includes('/launches/previous')
  if (isDetailRequest) return candidates

  const isLaunchList = typeof url === 'string' &&
    (url.includes('/launches/upcoming/') || url.includes('/launches/previous/'))
  const ordering = url.includes('previous') ? '-net' : 'net'
  const isUpcomingList = url.includes('/launches/upcoming/')

  // 当前 slim schema 版本号对应的列表后缀（与 getCacheKey 保持一致）
  // 旧版后缀做兜底：新缓存没来时，先让用户看到"不一定有颜色但能展示"的老数据，别白屏；
  // 云函数后台刷新后会自动覆盖为新版带颜色的缓存。
  // 注意：旧版后缀 key 只参与本地零成本扫描，云端查询会被 _isLegacySlimKey 过滤掉。
  const SLIM_SUFFIX = '_slim_v6'

  function addSlimListCandidates(fullKey) {
    add(fullKey, true)
    if (isLaunchList && fullKey.endsWith(SLIM_SUFFIX)) {
      const rootKey = fullKey.slice(0, -SLIM_SUFFIX.length)
      LEGACY_SLIM_SUFFIXES.forEach((sfx) => add(rootKey + sfx, true))
      add(rootKey, true)
    }
  }

  // launch 列表专用候选（带 ordering/mode=detailed 的 key 只有 launch 同步会写入）：
  // 仅对 launch 列表添加，避免 /agencies/、/events/ 等端点把 MAX_CLOUD_CANDIDATE_KEYS
  // 的云端查询名额浪费在必然不存在的 key 上，挤掉后面真正存在的分页缓存候选
  if (isLaunchList) {
    // upcoming 与 LL2 对齐：默认带 hide_recent_previous；仍候选无该参数的旧云缓存键
    const std100Base = { limit: 100, offset: 0, ordering, mode: 'detailed', format: 'json' }
    const std100Params = isUpcomingList ? { ...std100Base, hide_recent_previous: true } : std100Base
    addSlimListCandidates(getCacheKey(url, std100Params))
    if (isUpcomingList) {
      const kNew = getCacheKey(url, std100Params)
      const kLegacy = getCacheKey(url, std100Base)
      if (kLegacy !== kNew) addSlimListCandidates(kLegacy)
    }

    const std20Base = { limit: 20, offset: 0, ordering, mode: 'detailed', format: 'json' }
    const std20Params = isUpcomingList ? { ...std20Base, hide_recent_previous: true } : std20Base
    addSlimListCandidates(getCacheKey(url, std20Params))
    if (isUpcomingList) {
      const kNew = getCacheKey(url, std20Params)
      const kLegacy = getCacheKey(url, std20Base)
      if (kLegacy !== kNew) addSlimListCandidates(kLegacy)
    }
  }

  if (params.offset && params.offset > 0) {
    add(getCacheKey(url, { ...params, offset: 0 }), true)
  }
  if (params.limit && params.limit !== 100) {
    add(getCacheKey(url, { ...params, limit: 100 }), true)
  }
  if (params.limit && params.limit !== 20) {
    add(getCacheKey(url, { ...params, limit: 20 }), true)
  }

  return candidates
}

/**
 * 从完整缓存中按 params 切出所需的分页数据
 */
function _sliceCacheResult(cache, params) {
  if (!cache || !cache.results || !Array.isArray(cache.results)) return null
  const start = params.offset || 0
  const end = start + (params.limit || 10)
  const sliced = cache.results.slice(start, end)
  // 切片为空说明 offset 已越过缓存尽头：count 收敛为缓存实际条数，
  // 否则 LL2 总数（几千）会让调用方算出 hasMore=true，触底时反复发空请求
  const count = sliced.length > 0
    ? (cache.count || cache.results.length)
    : cache.results.length
  return {
    ...cache,
    results: sliced,
    count,
    next: sliced.length > 0 && end < cache.results.length ? (cache.next || 'has_more') : null
  }
}

/**
 * 通用请求方法 - 对接Launch Library API（带缓存和重试）
 * @param {String} url API路径
 * @param {Object} params 请求参数
 * @param {Number} timeout 超时时间（毫秒），开发环境默认20000，生产环境默认10000
 * @param {Boolean} useCache 是否使用缓存，默认true
 * @param {Number} retryCount 当前重试次数（内部使用）
 * @returns {Promise} 返回请求结果
 */
function request(url, params = {}, timeout = null, useCache = true, retryCount = 0) {
  if (timeout === null) {
    timeout = USE_DEV_API ? 20000 : 10000
  }
  return new Promise(async (resolve, reject) => {
    const cacheKey = getCacheKey(url, params)

    if (useCache) {
      // Phase 1: 精确 key 本地缓存命中（零成本、零延迟）
      const localExact = getCacheFromLocal(cacheKey)
      if (localExact !== null) {
        resolve(localExact)
        const now = Date.now()
        const lastBg = cloudCacheBgCheckAt[cacheKey] || 0
        if (now - lastBg >= _bgCheckIntervalFor(cacheKey)) {
          cloudCacheBgCheckAt[cacheKey] = now
          getCacheFromCloud(cacheKey).then(cloud => {
            if (cloud !== null && JSON.stringify(cloud) !== JSON.stringify(localExact)) {
              setCache(cacheKey, cloud)
              _fireStaleUpdate(cacheKey, cloud)
            }
          }).catch(() => {})
        }
        return
      }

      // Phase 2: 构建候选 key，先扫描本地缓存（零成本）
      const candidates = _buildCandidateKeys(url, params, cacheKey)
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i]
        const local = getCacheFromLocal(c.key)
        if (local !== null) {
          const result = c.slice ? _sliceCacheResult(local, params) : local
          if (result !== null) {
            resolve(result)
            // 切片结果不再另存到精确 key：否则首屏快速包(limit 5)与完整包(limit 50)
            // 各自持久化不同时间戳的旧切片，下次冷启动两包先后渲染不同代际的数据，
            // 造成倒计时面板「闪旧数据」。母缓存是唯一数据源，切片始终同代际。
            if (!c.slice) setCache(cacheKey, result)
            // 与 Phase 1 对齐：母 key 本地命中也要节流探云，否则小时探针插入的 previous
            // stub 最长要等本地 TTL(30min) 才对客户端可见。
            const motherKey = c.key
            const now = Date.now()
            const lastBg = cloudCacheBgCheckAt[motherKey] || 0
            if (now - lastBg >= _bgCheckIntervalFor(motherKey)) {
              cloudCacheBgCheckAt[motherKey] = now
              getCacheFromCloud(motherKey).then((cloud) => {
                if (cloud === null) return
                if (JSON.stringify(cloud) === JSON.stringify(local)) return
                setCache(motherKey, cloud)
                const fresh = c.slice ? _sliceCacheResult(cloud, params) : cloud
                if (fresh !== null) {
                  _fireStaleUpdate(cacheKey, fresh)
                  _fireStaleUpdate(motherKey, cloud)
                }
              }).catch(() => {})
            }
            return
          }
        }
      }

      // Phase 2.5: Stale-while-revalidate — 本地缓存刚过期时先用旧数据秒出，后台云端刷新
      let staleResolved = false
      const staleLocal = getCacheFromLocal(cacheKey, true)
      if (staleLocal !== null) {
        resolve(staleLocal)
        staleResolved = true
      }

      // Phase 3: 云数据库查询——只查当前 schema 版本的少量候选 key（旧版 _slim/_slim_v2~v5
      // 仅用于上面的本地零成本扫描，不再打云端），并按优先级顺序查询、命中即停，
      // 把「一次列表请求 = 十多次并行读库」收敛为通常 1 次读
      try {
        const cloudCandidates = candidates
          .filter(c => !_isLegacySlimKey(c.key))
          .slice(0, MAX_CLOUD_CANDIDATE_KEYS)
        for (const c of cloudCandidates) {
          let cloud = null
          try {
            cloud = await getCacheFromCloud(c.key)
          } catch (e) {
            cloud = null
          }
          if (!cloud) continue
          const isList = cloud.results && Array.isArray(cloud.results)
          const isSingleObject = !isList && cloud.id
          if (isList) {
            const result = c.slice ? _sliceCacheResult(cloud, params) : cloud
            if (result !== null) {
              if (!staleResolved) resolve(result)
              else _fireStaleUpdate(cacheKey, result)
              // 命中候选母文档时把完整数据存到母 key（供所有切片请求共享同一代际），
              // 精确 key 不再持久化切片副本，避免多份不同时间戳的旧数据来回闪
              setCache(c.slice ? c.key : cacheKey, c.slice ? cloud : result)
              return
            }
          } else if (isSingleObject) {
            if (!staleResolved) resolve(cloud)
            else _fireStaleUpdate(cacheKey, cloud)
            setCache(cacheKey, cloud)
            return
          }
        }
      } catch (error) {}

      if (staleResolved) return
    }

    reject({
      errMsg: '数据暂不可用，请稍后再试。数据由云函数定时同步，请等待云函数更新缓存。',
      statusCode: 404,
      type: 'cache_miss',
      retryable: false,
      cacheKey: cacheKey
    })
  })
}

/**
 * 检查任务是否已过期
 * @param {String} launchTime 发射时间
 * @returns {Boolean} 是否已过期
 */
function isLaunchExpired(launchTime) {
  if (!launchTime) return true
  const now = new Date().getTime()
  const launchTimeMs = new Date(launchTime).getTime()
  return launchTimeMs <= now
}

/**
 * 格式化发射台+地点，卡片用：「发射台名称 @ 地区/国家」
 * @param {Object} pad launch.pad
 * @returns {String}
 */
function formatPadLocation(pad) {
  if (!pad) return '未知地点'
  const a = pad.name || ''
  const loc = pad.location
  if (!loc) return a || '未知地点'
  let countryStr = loc.country_code || ''
  if (!countryStr && loc.country) {
    countryStr = typeof loc.country === 'string' ? loc.country : (loc.country.name || '')
  }
  const b = [loc.name, countryStr].filter(Boolean).join(', ')
  return b ? `${a} @ ${b}`.trim() : (a || '未知地点')
}

/** country_code / country.name → 发射国家中文，如美国、中国 */
const COUNTRY_DISPLAY = {
  USA: '美国', US: '美国',
  CHN: '中国', CN: '中国', PRC: '中国',
  RUS: '俄罗斯', RU: '俄罗斯',
  JPN: '日本', JP: '日本',
  IND: '印度', IN: '印度',
  KOR: '韩国', KR: '韩国', PRK: '朝鲜', KP: '朝鲜',
  FRA: '法国', FR: '法国',
  GBR: '英国', UK: '英国', GB: '英国',
  DEU: '德国', DE: '德国',
  ITA: '意大利', IT: '意大利',
  ESA: '欧空局', EU: '欧洲',
  NZL: '新西兰', NZ: '新西兰',
  AUS: '澳大利亚', AU: '澳大利亚',
  CAN: '加拿大', CA: '加拿大',
  ISR: '以色列', IL: '以色列',
  IRN: '伊朗', BRA: '巴西',
  UAE: '阿联酋', ARE: '阿联酋',
  SAU: '沙特', MEX: '墨西哥',
  KAZ: '哈萨克斯坦'
}

/** 从任务对象提取可用于国家推断的文本（火箭 full_name、任务名等） */
function collectLaunchCountryHintText(launch) {
  if (!launch || typeof launch !== 'object') return ''
  const parts = []
  if (launch.name) parts.push(String(launch.name))
  const mission = launch.mission
  if (mission && mission.name) parts.push(String(mission.name))
  const configuration =
    (launch.rocket && launch.rocket.configuration) ||
    (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  if (configuration && typeof configuration === 'object') {
    if (configuration.full_name) parts.push(String(configuration.full_name))
    if (configuration.name) parts.push(String(configuration.name))
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}

function getCountryDisplay(pad, launchServiceProvider = null, launch = null) {
  const loc = pad && pad.location ? pad.location : null

  // 1) 优先使用发射场国家
  let code = loc && loc.country_code ? String(loc.country_code).toUpperCase() : ''

  // 兼容：部分接口会给 GB/UK、UAE/ARE 等
  if (!code && loc && loc.country) {
    const c = loc.country
    if (typeof c === 'string') code = c.toUpperCase().slice(0, 3)
    else if (c && c.abbrev) code = String(c.abbrev || '').toUpperCase()
    else if (c && c.name) return c.name
  }

  // 2) 发射场缺失时，回退到发射服务商国家
  if (!code && launchServiceProvider && launchServiceProvider.country_code) {
    code = String(launchServiceProvider.country_code).toUpperCase()
  }

  // 3) 最后兜底：从地点/发射台/服务商/火箭型号/任务名推断（应对部分接口缺少 country_code）
  if (!code) {
    const hintFromLaunch = collectLaunchCountryHintText(launch)
    const text = [
      loc && loc.name,
      pad && pad.name,
      launchServiceProvider && launchServiceProvider.name,
      launchServiceProvider && launchServiceProvider.abbrev,
      hintFromLaunch
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (/(\busa\b|united states|vandenberg|cape canaveral|kennedy|florida|california|starbase|boca chica|texas|falcon 9|falcon heavy|starship|new glenn|vulcan|atlas v|delta iv|antares|minotaur|firefly alpha)/.test(text)) code = 'USA'
    else if (/(baikonur|kazakhstan)/.test(text)) code = 'KAZ'
    else if (/(plesetsk|vostochny|russia|russian|soyuz|proton-?m|angara)/.test(text)) code = 'RUS'
    else if (/(wenchang|jiuquan|taiyuan|xichang|china|\bprc\b|haiyang|oriental spaceport|orienspace|东方空间|long march|长征|kuaizhou|快舟|\bgravity-?\s?1\b|引力一号|\bceres-?\s?1\b|谷神星|hyperbola|双曲线|zhuque|朱雀|jielong|smart dragon|捷龙|tianlong|天龙|kinetica|lijian|力箭|landspace|galactic energy|expace|cas space|中科宇航)/.test(text)) code = 'CHN'
    else if (/(tanegashima|uchinoura|japan|h-?iia\b|\bh3\b|epsilon)/.test(text)) code = 'JPN'
    else if (/(sriharikota|india|\bpslv\b|\bgslv\b|\blvm-?3\b|\bsslv\b)/.test(text)) code = 'IND'
    else if (/(mahias|kourou|french guiana|guyane)/.test(text)) code = 'FRA'
    else if (/(new zealand|mahia)/.test(text)) code = 'NZL'
    else if (/(uae|united arab emirates|mohammed bin rashid)/.test(text)) code = 'ARE'
    else if (/\buk\b|united kingdom/.test(text)) code = 'GBR'
    else if (/(north korea|\bdprk\b|democratic people|pyongyang)/.test(text)) code = 'PRK'
    else if (/(south korea|republic of korea|south korean|\bkorean\b|\brok\b|daejeon|yeongjongdo|sejong)/.test(text)) code = 'KOR'
    else if (/\bkorea\b/.test(text)) code = 'KOR'
  }

  return COUNTRY_DISPLAY[code] || code || ''
}

/**
 * LL2 官方状态码 → 色标分类（唯一权威映射，getStatusCategory 与 mapLaunchToListItem 共用）
 * 1=Go 2=TBD 3=Success 4=Failure 5=On Hold 6=In Flight 7=Partial Failure 8=TBC 9=Payload Deployed
 * 色标：success|failure|partial|delayed|cancelled|pending|inflight|deployed
 */
const STATUS_ID_CATEGORY = {
  1: 'pending',
  2: 'pending',
  3: 'success',
  4: 'failure',
  5: 'delayed',
  6: 'inflight',
  7: 'partial',
  8: 'pending',
  9: 'deployed'
}

/** LL2 status.id → 角标中文（按官方状态显示，不把未决一律写成「待发射」） */
const STATUS_ID_BADGE_TEXT = {
  1: '就绪',
  2: '待定',
  3: '已成功',
  4: '失败',
  5: '推迟',
  6: '飞行中',
  7: '部分失败',
  8: '待确认',
  9: '载荷已部署'
}

/** 可落历史的终态：Success / Failure / Partial / Payload Deployed */
const TERMINAL_STATUS_IDS = { 3: true, 4: true, 7: true, 9: true }

function isTerminalStatusId(id) {
  const n = id != null ? Number(id) : 0
  return !!TERMINAL_STATUS_IDS[n]
}

function isTerminalStatus(status) {
  return isTerminalStatusId(status && status.id)
}

/**
 * 仅按 LL2 状态 id 取分类，命中返回对应 category，未命中返回 null（交由调用方做文本兜底）
 */
function getStatusCategoryById(id) {
  return Object.prototype.hasOwnProperty.call(STATUS_ID_CATEGORY, id) ? STATUS_ID_CATEGORY[id] : null
}

/**
 * 状态 → 色标分类：success|failure|partial|delayed|cancelled|pending|inflight|deployed
 */
function getStatusCategory(status) {
  if (!status) return 'pending'
  const id = status.id
  const n = (status.name || '').toLowerCase()
  const a = (status.abbrev || '').toLowerCase()
  const byId = getStatusCategoryById(id)
  if (byId) return byId
  if (/in\s*flight|飞行中/.test(n) || a === 'in flight') return 'inflight'
  if (/payload\s*deployed|载荷已部署|已部署/.test(n) || a === 'deployed') return 'deployed'
  if (/delayed|hold|slip|推迟|延迟/.test(n) || /hold|slip/.test(a)) return 'delayed'
  if (/cancel|取消/.test(n)) return 'cancelled'
  return 'pending'
}

/**
 * 状态 → 卡片角标文案（优先 LL2 id，再按 category / 英文名兜底）
 */
function getStatusBadgeText(status, category) {
  const id = status && status.id
  if (id != null && Object.prototype.hasOwnProperty.call(STATUS_ID_BADGE_TEXT, id)) {
    return STATUS_ID_BADGE_TEXT[id]
  }
  if (category === 'success') return '已成功'
  if (category === 'deployed') return '载荷已部署'
  if (category === 'failure') return '失败'
  if (category === 'partial') return '部分失败'
  if (category === 'delayed') return '推迟'
  if (category === 'cancelled') return '取消'
  if (category === 'inflight') return '飞行中'
  const n = ((status && status.name) || '').toLowerCase()
  const a = ((status && status.abbrev) || '').toLowerCase()
  if (/^go\b|go for launch|就绪/.test(n) || a === 'go') return '就绪'
  if (/\btbd\b|to be determined|待定/.test(n) || a === 'tbd') return '待定'
  if (/\btbc\b|to be confirmed|待确认/.test(n) || a === 'tbc') return '待确认'
  if (/in\s*flight|飞行中/.test(n)) return '飞行中'
  if (/payload\s*deployed|载荷已部署/.test(n)) return '载荷已部署'
  return '计划中'
}


module.exports = {
  request,
  getCacheKey,
  onStaleUpdate,
  onLaunchListStale,
  formatPadLocation,
  getCountryDisplay,
  getStatusCategory,
  getStatusCategoryById,
  STATUS_ID_CATEGORY,
  STATUS_ID_BADGE_TEXT,
  TERMINAL_STATUS_IDS,
  isTerminalStatusId,
  isTerminalStatus,
  getStatusBadgeText,
  unwrapCacheData,
  emptyListResult,
  withTimeout,
  isLaunchExpired,
  COUNTRY_DISPLAY,
  USE_DEV_API
}
