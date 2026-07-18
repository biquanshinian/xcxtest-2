const LAUNCH_STATS_CACHE_KEY = '_launch_stats_local_cache'
const LAUNCH_STATS_CACHE_TTL = 30 * 60 * 1000
const { fetchLaunchSummaryFromCloud } = require('./launch-stats-cloud.js')

const STARSHIP_STATUS_CACHE_KEY = '_starship_status_local_cache'
const STARSHIP_STATUS_CACHE_TTL = 10 * 60 * 1000

const NSF_STARSHIP_CACHE_KEY = '_nsf_starship_checklist_local_cache_v2'
const NSF_STARSHIP_CACHE_TTL = 10 * 60 * 1000

const NSF_HARDWARE_CACHE_KEY = '_nsf_hardware_local_cache'
const NSF_HARDWARE_TESTS_CACHE_KEY = '_nsf_hardware_tests_local_cache'
const NSF_HARDWARE_CACHE_TTL = 10 * 60 * 1000

const { mergeNsfChecklistDisplay } = require('./nsf-checklist-merge.js')

// ── 内存缓存层：避免首屏频繁同步读 storage（wx 启动性能告警） ──
const _memCacheStore = Object.create(null)

function _readStorageAsync(key) {
  return new Promise((resolve) => {
    wx.getStorage({
      key,
      success: (res) => resolve(res && res.data !== undefined ? res.data : null),
      fail: () => resolve(null)
    })
  })
}

function _writeStorageAsync(key, data) {
  try {
    wx.setStorage({ key, data, fail: () => {} })
  } catch (e) {}
}

/**
 * 优先从内存命中；内存未命中时改用异步 storage 读，避免阻塞首屏
 * @param {String} key 存储 key
 * @param {Number} ttl 缓存有效期（毫秒）
 * @returns {*|null} 命中则返回 data，否则返回 null
 */
async function _readCachedAsync(key, ttl) {
  const mem = _memCacheStore[key]
  if (mem && mem.ts && (Date.now() - mem.ts < ttl)) {
    return mem.data
  }
  const raw = await _readStorageAsync(key)
  if (raw && raw.ts && (Date.now() - raw.ts < ttl)) {
    _memCacheStore[key] = raw
    return raw.data
  }
  return null
}

function _writeCached(key, data) {
  const payload = { data, ts: Date.now() }
  _memCacheStore[key] = payload
  _writeStorageAsync(key, payload)
}
/* 仅 DB 完全不可用时的兜底；id 留空避免显示过期编号 */
const DEFAULT_STARSHIP_STATUS = {
  booster: {
    id: '',
    status: 'In Production',
    progress: 0,
    image: '/images/monitor/superheavy/图片4.png',
    images: ['/images/monitor/superheavy/图片4.png']
  },
  ship: {
    id: '',
    status: 'In Production',
    progress: 0,
    image: '/images/monitor/starship/图片3.png',
    images: ['/images/monitor/starship/图片3.png']
  },
  flightReadinessChecklist: [],
  ll2TrackedLaunchId: '',
  showLaunchLibraryUpdates: true
}

function normalizeFlightReadinessChecklistItems(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item, i) => ({
    id: String(item.id || `fr_${i}`),
    title: String(item.title || '').trim(),
    done: !!item.done,
    detailUrl: typeof item.detailUrl === 'string' ? item.detailUrl.trim() : '',
    category: typeof item.category === 'string' ? item.category.trim() : ''
  })).filter((row) => row.title)
}

function normalizeNsfChecklistItems(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item, i) => ({
    id: String(item.id || `nsf_${i}`),
    title: String(item.title || '').trim(),
    done: !!item.done,
    detailUrl: typeof item.detailUrl === 'string' ? item.detailUrl.trim() : '',
    category: typeof item.category === 'string' ? item.category.trim() : ''
  })).filter((row) => row.title)
}

/**
 * 读取云函数同步的 Next Spaceflight statuses（集合 nextspaceflight_starship_cache / latest）
 * @param {{ skipCache?: boolean }} options
 */
async function getNsfStarshipChecklistFromDB(options) {
  const skipCache = options && options.skipCache === true
  if (!skipCache) {
    const cached = await _readCachedAsync(NSF_STARSHIP_CACHE_KEY, NSF_STARSHIP_CACHE_TTL)
    if (cached) return cached
  }

  const empty = { items: [], sourceLastFetch: '', updatedAtMs: 0, fetchError: '' }

  try {
    if (!wx.cloud || !wx.cloud.database) {
      return empty
    }

    const db = wx.cloud.database()
    const res = await db.collection('nextspaceflight_starship_cache').doc('latest').get()
    const doc = res && res.data ? res.data : null

    let overrides = {}
    try {
      const ores = await db.collection('nextspaceflight_starship_cache').doc('admin_overrides').get()
      if (ores.data && ores.data.itemOverrides && typeof ores.data.itemOverrides === 'object') {
        overrides = ores.data.itemOverrides
      }
    } catch (e2) {}

    const merged = mergeNsfChecklistDisplay(doc ? doc.statuses : [], overrides)

    const payload = {
      items: normalizeNsfChecklistItems(merged),
      sourceLastFetch: typeof (doc && doc.sourceLastFetch) === 'string' ? doc.sourceLastFetch : '',
      updatedAtMs: typeof (doc && doc.updatedAtMs) === 'number' ? doc.updatedAtMs : 0,
      fetchError: typeof (doc && doc.error) === 'string' ? doc.error : ''
    }
    _writeCached(NSF_STARSHIP_CACHE_KEY, payload)
    return payload
  } catch (error) {
    return empty
  }
}

function normalizeHardwareVehicles(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => ({
    id: Number(item.id),
    name: String(item.name || '').trim(),
    ordering: typeof item.ordering === 'number' ? item.ordering : 0,
    status: String(item.status || '').trim(),
    statusZh: String(item.statusZh || item.status || '').trim(),
    type: String(item.type || '').trim(),
    typeZh: String(item.typeZh || item.type || '').trim(),
    category: String(item.category || 'other').trim(),
    categoryZh: String(item.categoryZh || '').trim(),
    notesEn: String(item.notesEn || '').trim(),
    notesZh: String(item.notesZh || item.notesEn || '').trim(),
    image: String(item.image || '').trim(),
    imageMissing: !!item.imageMissing
  })).filter((row) => row.name && !Number.isNaN(row.id))
}

/**
 * 读取云函数同步的 NSF 星舰硬件设施列表（集合 nextspaceflight_hardware_cache / vehicles）
 * @param {{ skipCache?: boolean }} options
 * @returns {Promise<{ vehicles: any[], updatedAtMs: number, fetchError: string }>}
 */
async function getStarshipHardwareFromDB(options) {
  const skipCache = options && options.skipCache === true
  if (!skipCache) {
    const cached = await _readCachedAsync(NSF_HARDWARE_CACHE_KEY, NSF_HARDWARE_CACHE_TTL)
    if (cached) return cached
  }

  const empty = { vehicles: [], updatedAtMs: 0, fetchError: '' }
  try {
    if (!wx.cloud || !wx.cloud.database) return empty

    const db = wx.cloud.database()
    const res = await db.collection('nextspaceflight_hardware_cache').doc('vehicles').get()
    const doc = res && res.data ? res.data : null
    const payload = {
      vehicles: normalizeHardwareVehicles(doc && doc.list),
      updatedAtMs: typeof (doc && doc.updatedAtMs) === 'number' ? doc.updatedAtMs : 0,
      fetchError: typeof (doc && doc.error) === 'string' ? doc.error : ''
    }
    if (payload.vehicles.length > 0) {
      _writeCached(NSF_HARDWARE_CACHE_KEY, payload)
    }
    return payload
  } catch (error) {
    return empty
  }
}

/**
 * 读取 NSF 星舰硬件的测试/飞行记录（集合 nextspaceflight_hardware_cache / tests）
 * 数据量较大（约 300 条），仅详情页按需调用
 * @returns {Promise<{ tests: any[], updatedAtMs: number }>}
 */
async function getStarshipHardwareTestsFromDB(options) {
  const skipCache = options && options.skipCache === true
  if (!skipCache) {
    const cached = await _readCachedAsync(NSF_HARDWARE_TESTS_CACHE_KEY, NSF_HARDWARE_CACHE_TTL)
    if (cached) return cached
  }

  const empty = { tests: [], updatedAtMs: 0 }
  try {
    if (!wx.cloud || !wx.cloud.database) return empty

    const db = wx.cloud.database()
    const res = await db.collection('nextspaceflight_hardware_cache').doc('tests').get()
    const doc = res && res.data ? res.data : null
    const payload = {
      tests: Array.isArray(doc && doc.list) ? doc.list : [],
      updatedAtMs: typeof (doc && doc.updatedAtMs) === 'number' ? doc.updatedAtMs : 0
    }
    if (payload.tests.length > 0) {
      _writeCached(NSF_HARDWARE_TESTS_CACHE_KEY, payload)
    }
    return payload
  } catch (error) {
    return empty
  }
}

let spacexStatsPending = null
const SPACEX_STATS_CACHE_KEY = '_spacex_stats_local_cache'
const SPACEX_STATS_CACHE_TTL = 5 * 60 * 1000
const BOOSTER_GENEALOGY_CACHE_KEY = '_booster_genealogy'
const BOOSTER_GENEALOGY_CACHE_TTL = 30 * 60 * 1000
// 竞猜统计缓存：此前 30s，切 Tab 回首页就会重新打 adminGateway，是首页最高频的云函数来源之一。
// 票数展示对实时性要求不高，5 分钟足够；用户自己投票后 castVote 会主动失效缓存，不受影响。
const VOTE_CACHE_TTL = 5 * 60 * 1000
// 旧缓存最长可用时间：首屏先渲染上次数据（stale-while-revalidate），云端结果回来后覆盖
const VOTE_STALE_MAX_AGE = 24 * 60 * 60 * 1000
const { formatCloudError } = require('./launch-stats-cloud.js')

function getLaunchStatsYear(now) {
  const d = now == null
    ? new Date()
    : (now instanceof Date ? now : new Date(now))
  return Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear()
}

async function getLaunchStatsFromDB(options = {}) {
  const forceRefresh = !!(options && options.forceRefresh)
  const year = getLaunchStatsYear()
  const cacheKey = `${LAUNCH_STATS_CACHE_KEY}_${year}`

  if (!forceRefresh) {
    const cachedData = await _readCachedAsync(cacheKey, LAUNCH_STATS_CACHE_TTL)
    if (cachedData && Number(cachedData.year) === year) return cachedData
  }

  try {
    const cloudStats = await fetchLaunchSummaryFromCloud({ year, forceRefresh })
    const stats = {
      year: cloudStats.year || year,
      globalThisYear: cloudStats.globalThisYear,
      spacexThisYear: cloudStats.spacexThisYear,
      source: cloudStats.source || 'll2_previous_net',
      updatedAt: cloudStats.updatedAt || new Date().toISOString()
    }
    _writeCached(cacheKey, stats)
    return stats
  } catch (cloudErr) {
    if (!wx.cloud || !wx.cloud.database) {
      throw cloudErr
    }

    const db = wx.cloud.database()
    const docId = `stats_${year}`
    const res = await db.collection('launch_stats').doc(docId).get()

    if (!res.data) {
      throw cloudErr
    }

    const stats = res.data.data || res.data
    if (stats && stats.year != null && Number(stats.year) !== year) {
      throw new Error('统计数据年份不匹配')
    }
    _writeCached(cacheKey, stats)
    return stats
  }
}

function normalizeStarshipImages(item, fallback) {
  const list = []
  if (Array.isArray(item.images)) list.push(...item.images)
  if (Array.isArray(item.previewImages)) list.push(...item.previewImages)
  if (item.image) list.unshift(item.image)
  const normalized = [...new Set(list.filter(Boolean))]
  return normalized.length ? normalized : [fallback]
}

async function getStarshipStatusFromDB() {
  const cachedData = await _readCachedAsync(STARSHIP_STATUS_CACHE_KEY, STARSHIP_STATUS_CACHE_TTL)
  if (cachedData) return cachedData

  try {
    if (!wx.cloud || !wx.cloud.database) {
      return DEFAULT_STARSHIP_STATUS
    }

    const db = wx.cloud.database()
    const res = await db.collection('starshipStatus').doc('current').get()
    const data = res && res.data ? res.data : null

    if (!data) return DEFAULT_STARSHIP_STATUS

    const booster = data.booster || {}
    const ship = data.ship || {}
    const boosterImages = normalizeStarshipImages(booster, DEFAULT_STARSHIP_STATUS.booster.image)
    const shipImages = normalizeStarshipImages(ship, DEFAULT_STARSHIP_STATUS.ship.image)

    const flightReadinessChecklist = normalizeFlightReadinessChecklistItems(data.flightReadinessChecklist)
    const ll2TrackedLaunchId = typeof data.ll2TrackedLaunchId === 'string' ? data.ll2TrackedLaunchId.trim() : ''
    const showLaunchLibraryUpdates = data.showLaunchLibraryUpdates !== false

    const result = {
      booster: {
        ...booster,
        id: booster.id || DEFAULT_STARSHIP_STATUS.booster.id,
        status: booster.status || DEFAULT_STARSHIP_STATUS.booster.status,
        progress: typeof booster.progress === 'number' ? booster.progress : DEFAULT_STARSHIP_STATUS.booster.progress,
        image: booster.image || boosterImages[0] || DEFAULT_STARSHIP_STATUS.booster.image,
        images: boosterImages,
        previewImages: boosterImages,
        detail: booster.detail || {}
      },
      ship: {
        ...ship,
        id: ship.id || DEFAULT_STARSHIP_STATUS.ship.id,
        status: ship.status || DEFAULT_STARSHIP_STATUS.ship.status,
        progress: typeof ship.progress === 'number' ? ship.progress : DEFAULT_STARSHIP_STATUS.ship.progress,
        image: ship.image || shipImages[0] || DEFAULT_STARSHIP_STATUS.ship.image,
        images: shipImages,
        previewImages: shipImages,
        detail: ship.detail || {}
      },
      flightReadinessChecklist,
      ll2TrackedLaunchId,
      showLaunchLibraryUpdates
    }

    _writeCached(STARSHIP_STATUS_CACHE_KEY, result)

    return result
  } catch (error) {
    return DEFAULT_STARSHIP_STATUS
  }
}

function shareMission() {
  return Promise.resolve({ success: true })
}

async function loadSpaceXStatsCache() {
  return _readCachedAsync(SPACEX_STATS_CACHE_KEY, SPACEX_STATS_CACHE_TTL)
}

function saveSpaceXStatsCache(data) {
  _writeCached(SPACEX_STATS_CACHE_KEY, data)
}

async function fetchSpaceXLaunchStats() {
  try {
    if (!wx.cloud || !wx.cloud.database) return null
    const db = wx.cloud.database()
    const res = await Promise.race([
      db.collection('spacex_launch_stats').where({ isActive: true }).orderBy('updatedAt', 'desc').limit(20).get(),
      new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 5000))
    ]).catch(() => ({ data: [] }))

    const now = Date.now()
    // 云端每 6 小时同步一次；放宽到 72h 容忍偶发同步失败，
    // 否则一次同步链路故障超过 24h 就会导致首页「SpaceX总发射数据」板块整块消失
    const staleTTL = 72 * 60 * 60 * 1000
    const list = (res.data || []).filter((item) => {
      if (!item.isActive) return false
      if (item.syncedAt && (now - item.syncedAt > staleTTL)) return false
      return true
    })

    list.sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const best = list[0] || null
    if (best) saveSpaceXStatsCache(best)
    return best
  } catch (e) {
    console.error('[SpaceXStats] fetch error:', e)
    return null
  }
}

async function getSpaceXLaunchStats() {
  const cached = await loadSpaceXStatsCache()
  if (cached) return cached

  if (spacexStatsPending) return spacexStatsPending
  spacexStatsPending = fetchSpaceXLaunchStats()
  try {
    return await spacexStatsPending
  } finally {
    spacexStatsPending = null
  }
}

const BOOSTER_META_DOC_IDS = ['_sync_meta', '_img_cos_map', '_ll2_launchers_cache', '_config_meta', '_flight_history_progress']

async function getBoosterGenealogy(options) {
  const cachedData = await _readCachedAsync(BOOSTER_GENEALOGY_CACHE_KEY, BOOSTER_GENEALOGY_CACHE_TTL)
  if (cachedData) return cachedData

  try {
    const db = wx.cloud.database()
    // 分页拉全量箭实体（含 configId / countryCode 等新字段，文档原样透传）
    const BATCH = 100
    // 与云端同步上限（5 页 × 200 = 1000）对齐；数据不足一批时提前 break，无额外查询
    // 预览模式（非会员 Tab）：只拉第 1 批，够 2 张预览卡，避免最多 10 次 DB 读
    const previewOnly = !!(options && options.previewOnly)
    const MAX_BATCHES = previewOnly ? 1 : 10
    let all = []
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await db.collection('booster_genealogy')
        .orderBy('flights', 'desc')
        .skip(i * BATCH)
        .limit(BATCH)
        .get()
      const batch = res.data || []
      all = all.concat(batch)
      if (batch.length < BATCH) break
    }
    const list = all.filter(function (item) {
      return BOOSTER_META_DOC_IDS.indexOf(item._id) === -1
    })
    // 仅全量拉取时写缓存，避免预览半份污染全量缓存
    if (!previewOnly) {
      _writeCached(BOOSTER_GENEALOGY_CACHE_KEY, list)
    }
    return list
  } catch (e) {
    console.error('[Booster] getBoosterGenealogy error:', e)
    return []
  }
}

const ROCKET_CONFIG_META_CACHE_KEY = '_rocket_config_meta'
const ROCKET_CONFIG_META_CACHE_TTL = 30 * 60 * 1000

/**
 * 读取火箭构型元数据（booster_genealogy/_config_meta）
 * 返回 { configs: { [configId]: {...} }, updatedAt }，字段全部来自 LL2 launcher_configurations，数据驱动
 */
async function getRocketConfigMeta() {
  const cachedData = await _readCachedAsync(ROCKET_CONFIG_META_CACHE_KEY, ROCKET_CONFIG_META_CACHE_TTL)
  if (cachedData) return cachedData

  try {
    const db = wx.cloud.database()
    const res = await db.collection('booster_genealogy').doc('_config_meta').get()
    const configs = (res.data && res.data.configs) || {}
    const payload = { configs: configs, updatedAt: (res.data && res.data.updatedAt) || 0 }
    if (Object.keys(configs).length > 0) {
      _writeCached(ROCKET_CONFIG_META_CACHE_KEY, payload)
    }
    return payload
  } catch (e) {
    console.error('[Booster] getRocketConfigMeta error:', e)
    return { configs: {}, updatedAt: 0 }
  }
}

/** 读竞猜本地旧缓存（忽略 30s 短 TTL，最长 24h），用于首屏即时渲染 */
async function getVoteStatsStale(launchId, voteType) {
  if (!launchId) return null
  const vt = voteType === 'outcome' ? 'outcome' : 'ontime'
  return _readCachedAsync(`_vote_${vt}_${launchId}`, VOTE_STALE_MAX_AGE)
}

async function getVoteStats(launchId, skipCache, missionInfo) {
  if (!launchId) return null
  const vt = (missionInfo && missionInfo.voteType === 'outcome') ? 'outcome' : 'ontime'
  const cacheKey = `_vote_${vt}_${launchId}`
  if (!skipCache) {
    const cachedData = await _readCachedAsync(cacheKey, VOTE_CACHE_TTL)
    if (cachedData) return cachedData
  }

  try {
    const queryParams = { voteType: vt }
    if (missionInfo && missionInfo.launchTime) queryParams.currentLaunchTime = missionInfo.launchTime
    if (missionInfo && missionInfo.status) queryParams.missionStatus = missionInfo.status
    if (missionInfo && missionInfo.statusCategory) queryParams.statusCategory = missionInfo.statusCategory
    if (missionInfo && missionInfo.statusAbbrev) queryParams.statusAbbrev = missionInfo.statusAbbrev
    if (missionInfo && missionInfo.statusName) queryParams.statusName = missionInfo.statusName

    const res = await wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: `/vote/${launchId}`, method: 'GET', query: queryParams }
    })
    if (res.result && res.result.code === 0) {
      _writeCached(cacheKey, res.result.data)
      return res.result.data
    }
    return null
  } catch (e) {
    console.error('[Vote] getVoteStats error:', e)
    return null
  }
}

async function castVote(launchId, choice, missionInfo) {
  if (!launchId || !choice) return null
  const vt = (missionInfo && missionInfo.voteType === 'outcome') ? 'outcome' : 'ontime'
  let res = null
  try {
    res = await wx.cloud.callFunction({
      name: 'adminGateway',
      data: {
        path: '/vote',
        method: 'POST',
        body: {
          launchId,
          choice,
          voteType: vt,
          missionName: (missionInfo && missionInfo.missionName) || '',
          rocketName: (missionInfo && missionInfo.rocketName) || '',
          launchTime: (missionInfo && missionInfo.launchTime) || ''
        }
      }
    })
  } catch (e) {
    console.error('[Vote] castVote error:', e)
    return null
  }
  if (res.result && res.result.code === 0) {
    const voteKey = `_vote_${vt}_${launchId}`
    delete _memCacheStore[voteKey]
    try {
      wx.removeStorage({ key: voteKey, fail: () => {} })
    } catch (e) {}
    return res.result.data
  }
  // 业务拒绝（已结算 / 距发射不足30分钟等）：抛出带原因的错误，由调用方展示给用户
  const failMsg = res && res.result && res.result.message
  if (failMsg) throw new Error(failMsg)
  return null
}

async function getMyVoteResults() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: '/vote/my-results', method: 'GET' }
    })
    if (res.result && res.result.code === 0) return res.result.data || []
    return []
  } catch (e) {
    console.error('[Vote] getMyVoteResults error:', e)
    return []
  }
}

/** 清除当前用户的全部竞猜记录（云端个人投票记录） */
async function clearMyVoteResults() {
  const res = await wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: '/vote/my-results', method: 'DELETE' }
  })
  if (res.result && res.result.code === 0) return res.result.data || { removed: 0 }
  throw new Error((res.result && res.result.message) || '清除失败')
}

async function fetchLl2LaunchUpdates(launchId, limit = 15, options = {}) {
  const id = String(launchId || '').trim()
  const autoStarship = !!(options && options.autoStarship)
  if (!id && !autoStarship) {
    return Promise.reject(new Error('缺少发射 UUID'))
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云函数不可用'))
  }
  const payload = {
    action: 'fetchLaunchUpdates',
    limit
  }
  if (id) payload.launchId = id
  else payload.autoStarship = true

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'll2Query',
      data: payload,
      timeout: 25000,
      success: (res) => {
        const r = res && res.result
        if (r && r.success && Array.isArray(r.list)) {
          resolve({
            list: r.list,
            totalCount: r.totalCount,
            launchId: r.launchId,
            autoResolved: !!r.autoResolved,
            resolvedSource: r.resolvedSource || '',
            resolvedLaunchName: r.resolvedLaunchName || '',
            outcome: r.outcome || null,
            fromCache: !!r.fromCache
          })
        } else {
          reject(new Error(formatCloudError(new Error((r && r.error) || '拉取 Launch Library 更新失败'))))
        }
      },
      fail: (err) => reject(new Error(formatCloudError(err || new Error('云函数调用失败'))))
    })
  })
}

/**
 * 倒计时到点实时状态确认：拉取即将发射任务最新状态（云端 limit=10 + 120s 共享缓存）。
 * 失败返回 null；调用方应继续复查 / bestEffort，禁止无终态裸切。
 * @returns {Promise<Array<{id,name,status,net,windowStart,windowEnd}>|null>}
 */
async function fetchLiveLaunchStatuses() {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null
  try {
    const res = await wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'fetchLaunchStatuses' },
      timeout: 20000
    })
    const r = res && res.result
    if (r && r.success && Array.isArray(r.rows)) return r.rows
    return null
  } catch (e) {
    console.error('[LiveStatus] fetchLiveLaunchStatuses error:', e)
    return null
  }
}

/**
 * 小时探针 / 到点查询写入的近期 settle 行：终态(3/4/7/9) 或飞行中(6)。
 * 历史列表角标仅消费终态；倒计时 settle 可读飞行中。不打 LL2。
 * @returns {Promise<Array<{id,status,net,name}>|null>}
 */
async function fetchLaunchStatusSnapshot(ids) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null
  try {
    const list = Array.isArray(ids) ? ids.map(String).filter(Boolean).slice(0, 100) : []
    const res = await wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'getLaunchStatusSnapshot', ids: list, limit: 40 },
      timeout: 15000
    })
    const result = res && res.result
    return result && result.success && Array.isArray(result.rows) ? result.rows : null
  } catch (e) {
    return null
  }
}

function fetchRecentSettledLaunches() {
  return fetchLaunchStatusSnapshot()
}

/**
 * 按 id 解析发射状态（云端 mode=list；recent_settled 已终态则 0 LL2）。
 * 用于历史列表「飞行中」升级为 Success/Deployed，不必先进详情。
 * @param {string[]} ids
 * @returns {Promise<Array<{id,name,status,net}>|null>}
 */
async function resolveLaunchStatuses(ids) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null
  const list = Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 5) : []
  if (!list.length) return []
  try {
    const res = await wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'resolveLaunchStatuses', ids: list },
      timeout: 20000
    })
    const r = res && res.result
    if (r && r.success && Array.isArray(r.rows)) return r.rows
    return null
  } catch (e) {
    console.error('[LiveStatus] resolveLaunchStatuses error:', e)
    return null
  }
}

/** LL2 GET /launches/{uuid}/?mode=detailed → timeline */
async function fetchLl2LaunchTimeline(launchId, options = {}) {
  const id = String(launchId || '').trim()
  const autoStarship = !!(options && options.autoStarship)
  if (!id && !autoStarship) {
    return Promise.reject(new Error('缺少发射 UUID'))
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云函数不可用'))
  }

  // 优先从云数据库缓存读取（30 分钟 TTL）
  if (id && !autoStarship) {
    try {
      const cacheDocId = 'timeline_' + id
      const cacheRes = await wx.cloud.database().collection('launch_timeline_cache').doc(cacheDocId).get()
      const cached = cacheRes && cacheRes.data
      if (cached && cached.updatedAtMs && (Date.now() - cached.updatedAtMs) < 30 * 60 * 1000 && Array.isArray(cached.data) && cached.data.length > 0) {
        return {
          timeline: cached.data,
          launchId: id,
          launchName: cached.launchName || '',
          net: cached.net || '',
          timelineCount: cached.data.length,
          autoResolved: false,
          resolvedSource: 'db_cache'
        }
      }
    } catch (e) {}
  }

  const payload = {
    action: 'fetchLaunchTimeline'
  }
  if (id) payload.launchId = id
  else payload.autoStarship = true

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'll2Query',
      data: payload,
      timeout: 25000,
      success: (res) => {
        const r = res && res.result
        if (r && r.success && Array.isArray(r.timeline)) {
          resolve({
            timeline: r.timeline,
            launchId: r.launchId,
            launchName: r.launchName || '',
            net: r.net || '',
            timelineCount: typeof r.timelineCount === 'number' ? r.timelineCount : r.timeline.length,
            autoResolved: !!r.autoResolved,
            resolvedSource: r.resolvedSource || ''
          })
        } else {
          reject(new Error(formatCloudError(new Error((r && r.error) || '拉取飞行时间线失败'))))
        }
      },
      fail: (err) => reject(new Error(formatCloudError(err || new Error('云函数调用失败'))))
    })
  })
}

module.exports = {
  getLaunchStatsFromDB,
  getStarshipStatusFromDB,
  getNsfStarshipChecklistFromDB,
  getStarshipHardwareFromDB,
  getStarshipHardwareTestsFromDB,
  fetchLl2LaunchUpdates,
  fetchLl2LaunchTimeline,
  fetchLiveLaunchStatuses,
  fetchLaunchStatusSnapshot,
  fetchRecentSettledLaunches,
  resolveLaunchStatuses,
  shareMission,
  getSpaceXLaunchStats,
  getBoosterGenealogy,
  getRocketConfigMeta,
  getVoteStats,
  getVoteStatsStale,
  castVote,
  getMyVoteResults,
  clearMyVoteResults
}
