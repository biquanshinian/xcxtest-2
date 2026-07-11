// utils/api-road-closure.js
const { request } = require('./api-request.js')

async function getRoadClosureNoticeFromDB() {
  try {
    if (!wx.cloud || !wx.cloud.database) {
      return null
    }

    const db = wx.cloud.database()
    const now = Date.now()

    const newResult = await Promise.race([
      db.collection('road_closure_notice').where({ isActive: true }).limit(20).get(),
      new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 5000))
    ]).catch(() => ({ data: [] }))

    const candidates = []

    const STALE_TTL = 24 * 60 * 60 * 1000

    const newList = (newResult && newResult.data) || []
    for (const item of newList) {
      if (!item.isActive) continue
      if (item.endAt && item.endAt > 0 && item.endAt < now) continue
      if ((!item.endAt || item.endAt === 0) && item.syncedAt && (now - item.syncedAt > STALE_TTL)) continue
      const priority = (item.source === 'manual' ? 999 : 0) + (item.priority || 0)
      candidates.push({
        isActive: true,
        message: item.message || item.statusText || '道路封路通知',
        startTime: item.startAt || 0,
        endTime: item.endAt || 0,
        timeRange: item.timeRange || '',
        source: item.source || 'unknown',
        beachStatus: item.beachStatus || '',
        beachClosureSchedule: item.beachClosureSchedule || [],
        roadDelays: item.roadDelays || [],
        roadUpdates: item.roadUpdates || [],
        _priority: priority
      })
    }

    if (candidates.length === 0) {
      return null
    }

    candidates.sort((a, b) => b._priority - a._priority)
    const best = candidates[0]
    delete best._priority
    return best
  } catch (error) {
    return null
  }
}

const ROAD_CLOSURE_CACHE_KEY = '_road_closure_local_cache'
const ROAD_CLOSURE_CACHE_TTL = 5 * 60 * 1000
let _roadClosurePending = null
// 内存缓存：避免首屏频繁同步读 storage（wx 启动性能告警）
let _roadClosureMemCache = null // { data, timestamp }

function _readRoadClosureFromStorageAsync() {
  return new Promise((resolve) => {
    wx.getStorage({
      key: ROAD_CLOSURE_CACHE_KEY,
      success: (res) => resolve(res && res.data ? res.data : null),
      fail: () => resolve(null)
    })
  })
}

/**
 * 获取封路通知
 * 优先从内存/本地缓存读取（5分钟 TTL），减少云数据库读取
 * 其次从云数据库 road_closure_notice 获取
 * 最后从 events/upcoming API 缓存中筛选
 * 内置 Promise 去重，多页面同时调用只查一次
 */
async function getRoadClosureNotice() {
  // Phase 0: 内存缓存（零阻塞）
  if (_roadClosureMemCache && _roadClosureMemCache.timestamp &&
      (Date.now() - _roadClosureMemCache.timestamp < ROAD_CLOSURE_CACHE_TTL)) {
    return _roadClosureMemCache.data
  }

  // Phase 1: 异步读本地存储，不阻塞主线程
  try {
    const cached = await _readRoadClosureFromStorageAsync()
    if (cached && cached.timestamp && (Date.now() - cached.timestamp < ROAD_CLOSURE_CACHE_TTL)) {
      _roadClosureMemCache = cached
      return cached.data
    }
  } catch (e) {}

  if (_roadClosurePending) return _roadClosurePending
  _roadClosurePending = _fetchRoadClosureNotice()
  try {
    return await _roadClosurePending
  } finally {
    _roadClosurePending = null
  }
}

async function _fetchRoadClosureNotice() {
  try {
    const dbResult = await Promise.race([
      getRoadClosureNoticeFromDB(),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000))
    ])

    if (dbResult && dbResult.isActive === true) {
      _saveRoadClosureCache(dbResult)
      return dbResult
    }
  } catch (error) {
    // 静默失败
  }

  // DB 无数据时，从缓存的 events 中筛选
  try {
    const data = await request('/events/upcoming/', {
      limit: 100,
      offset: 0
    }, 5000, true)

    if (data && data.results && data.results.length > 0) {
      const now = Date.now()

      const roadClosureEvent = data.results.find(event => {
        const eventType = (event.type && event.type.name && event.type.name.toLowerCase()) || ''
        const eventName = (event.name && event.name.toLowerCase()) || ''
        const eventDescription = (event.description && event.description.toLowerCase()) || ''

        const isRoadClosure = eventType.includes('road') ||
               eventType.includes('closure') ||
               eventName.includes('road') ||
               eventName.includes('closure') ||
               eventDescription.includes('road closure') ||
               eventDescription.includes('封路')

        if (!isRoadClosure) return false

        const endTime = event.window_end ? new Date(event.window_end).getTime()
          : event.date ? new Date(event.date).getTime() : 0
        return endTime > now
      })

      if (roadClosureEvent) {
        const startTime = roadClosureEvent.date
          ? new Date(roadClosureEvent.date).getTime()
          : roadClosureEvent.window_start
            ? new Date(roadClosureEvent.window_start).getTime()
            : null
        const endTime = roadClosureEvent.window_end
          ? new Date(roadClosureEvent.window_end).getTime()
          : roadClosureEvent.date
            ? new Date(roadClosureEvent.date).getTime()
            : null

        const result = {
          isActive: true,
          message: roadClosureEvent.name || '星舰基地发射前道路封路通知',
          startTime,
          endTime
        }
        _saveRoadClosureCache(result)
        return result
      }
    }
  } catch (error) {
    // 静默失败
  }

  const emptyResult = { isActive: false, message: '', startTime: null, endTime: null }
  _saveRoadClosureCache(emptyResult)
  return emptyResult
}

function _saveRoadClosureCache(data) {
  const payload = { data, timestamp: Date.now() }
  _roadClosureMemCache = payload
  try {
    // 异步写入 storage，避免阻塞主线程
    wx.setStorage({ key: ROAD_CLOSURE_CACHE_KEY, data: payload, fail: () => {} })
  } catch (e) {}
}

module.exports = {
  getRoadClosureNotice
}
