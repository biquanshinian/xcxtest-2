/**
 * 高频 storage key 的同步读去重 + 内存层。
 * 同一 key 在 invalidate 之前最多触发一次 wx.getStorageSync。
 */

const _mem = Object.create(null)
const _loaded = Object.create(null)
const _syncReadCounts = Object.create(null)

const DEV_WARN_THRESHOLD = 2

/** 启动 / Tab 页 warm 常用 key（供 app.onLaunch 批量预热）
 *  注意：加入此列表的 key，所有写入方必须走 persistSync/persistAsync/writeMem，
 *  否则内存层会读到旧值。 */
const HOT_SYNC_KEYS = [
  'add_desktop_strip_snooze_until',
  '_checkin_data',
  '_space_quiz_data',
  '_subscribed_missions',
  '_user_behavior_stats',
  '_voted_launches',
  '_achievements_data',
  'openclaw_guide_dismissed',
  '_briefing_progress_filter_clear',
  '_briefing_progress_filter_source',
  // 各 Tab 页 page-storage-boot warm 的 key：启动时异步预热后，
  // 页面 onLoad/onShow 的 warmSync 命中内存即不再触发 getStorageSync
  '_membership_state',
  '_user_preferences',
  '_progress_last_viewed',
  '_event_updates_local_cache',
  'mission_detail_cache',
  '_milestone_config_cache_v2',
  '_milestone_claims_cache',
  '_knowledge_cards_cache',
  // news 页 onShow / 首屏
  '_articles_nav_ack_manual_updated_at',
  'news_cache_articles_v5',
  'news_cache_events_v2',
  // nasa-float（挂在全部 Tab 页）
  '_float_visit_astro',
  '_float_visit_nasa',
  '_float_lunar_cache',
  '_float_lunar_count',
  // popup-ad 频控（各 Tab 页 onShow 触发）
  '_popup_ad_shown_by_day',
  '_popup_ad_protect_anchor_ts'
]

const HOT_SYNC_FALLBACKS = {
  'add_desktop_strip_snooze_until': 0,
  '_checkin_data': null,
  '_space_quiz_data': null,
  '_subscribed_missions': {},
  '_user_behavior_stats': {},
  '_voted_launches': {},
  '_achievements_data': {},
  'openclaw_guide_dismissed': false,
  '_briefing_progress_filter_clear': '',
  '_briefing_progress_filter_source': '',
  '_membership_state': null,
  '_user_preferences': null,
  '_progress_last_viewed': 0,
  '_event_updates_local_cache': null,
  'mission_detail_cache': {},
  '_milestone_config_cache_v2': [],
  '_milestone_claims_cache': [],
  '_knowledge_cards_cache': null,
  '_articles_nav_ack_manual_updated_at': 0,
  'news_cache_articles_v5': null,
  'news_cache_events_v2': null,
  '_float_visit_astro': '',
  '_float_visit_nasa': '',
  '_float_lunar_cache': null,
  '_float_lunar_count': 0,
  '_popup_ad_shown_by_day': null,
  '_popup_ad_protect_anchor_ts': 0
}

function _isDevEnv() {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true
  } catch (e) {}
  try {
    var info = wx.getAccountInfoSync && wx.getAccountInfoSync()
    var env = info && info.miniProgram && info.miniProgram.envVersion
    return env === 'develop' || env === 'trial'
  } catch (e2) {}
  return false
}

function _warnRepeatedSyncRead(key) {
  if (!_isDevEnv()) return
  var n = _syncReadCounts[key] || 0
  if (n > DEV_WARN_THRESHOLD) {
    console.warn('[storage-sync-cache] repeated getStorageSync for key:', key, 'count=', n)
  }
}

function readSync(key, fallbackValue) {
  if (_loaded[key]) {
    return _mem[key] != null ? _mem[key] : fallbackValue
  }
  var data = fallbackValue
  try {
    var raw = wx.getStorageSync(key)
    data = raw != null && raw !== '' ? raw : fallbackValue
  } catch (e) {
    data = fallbackValue
  }
  _mem[key] = data
  _loaded[key] = true
  _syncReadCounts[key] = (_syncReadCounts[key] || 0) + 1
  _warnRepeatedSyncRead(key)
  return data
}

/** 已 warm 则只读内存，否则走 readSync（单次 sync） */
function readMemOrSync(key, fallbackValue) {
  if (_loaded[key]) {
    return _mem[key] != null ? _mem[key] : fallbackValue
  }
  return readSync(key, fallbackValue)
}

function writeMem(key, data) {
  _mem[key] = data
  _loaded[key] = true
}

function isLoaded(key) {
  return !!_loaded[key]
}

function getMem(key) {
  return _loaded[key] ? _mem[key] : undefined
}

function invalidate(key) {
  delete _mem[key]
  delete _loaded[key]
}

function warmAsync(key, fallbackValue) {
  if (_loaded[key]) return Promise.resolve(_mem[key] != null ? _mem[key] : fallbackValue)
  return new Promise(function (resolve) {
    wx.getStorage({
      key: key,
      success: function (res) {
        // 竞态保护：异步读取期间若已有写入方 writeMem/persist*（内存值更新），
        // 不能再用旧的 storage 快照覆盖，否则冷启动窗口内会出现数据回退
        if (_loaded[key]) {
          resolve(_mem[key] != null ? _mem[key] : fallbackValue)
          return
        }
        var data = res.data != null && res.data !== '' ? res.data : fallbackValue
        writeMem(key, data)
        resolve(data)
      },
      fail: function () {
        if (_loaded[key]) {
          resolve(_mem[key] != null ? _mem[key] : fallbackValue)
          return
        }
        writeMem(key, fallbackValue)
        resolve(fallbackValue)
      }
    })
  })
}

function warmSync(key, fallbackValue) {
  return readSync(key, fallbackValue)
}

function warmManySync(keys) {
  var list = keys || HOT_SYNC_KEYS
  for (var i = 0; i < list.length; i++) {
    var key = list[i]
    warmSync(key, Object.prototype.hasOwnProperty.call(HOT_SYNC_FALLBACKS, key)
      ? HOT_SYNC_FALLBACKS[key]
      : null)
  }
}

/**
 * 异步批量预热：不阻塞启动主线程。
 * 未预热完成前若有消费方 readMemOrSync，会自行做单 key 同步读（成本被摊薄），
 * warmAsync 对已 loaded 的 key 直接跳过，不会重复覆盖。
 */
function warmManyAsync(keys) {
  var list = keys || HOT_SYNC_KEYS
  return Promise.all(list.map(function (key) {
    return warmAsync(key, Object.prototype.hasOwnProperty.call(HOT_SYNC_FALLBACKS, key)
      ? HOT_SYNC_FALLBACKS[key]
      : null)
  }))
}

function persistAsync(key, data) {
  writeMem(key, data)
  try {
    wx.setStorage({ key: key, data: data, fail: function () {} })
  } catch (e) {}
}

function persistSync(key, data) {
  writeMem(key, data)
  try {
    wx.setStorageSync(key, data)
  } catch (e) {}
}

function getSyncReadCount(key) {
  return _syncReadCounts[key] || 0
}

module.exports = {
  HOT_SYNC_KEYS: HOT_SYNC_KEYS,
  readSync: readSync,
  readMemOrSync: readMemOrSync,
  writeMem: writeMem,
  isLoaded: isLoaded,
  getMem: getMem,
  invalidate: invalidate,
  warmAsync: warmAsync,
  warmSync: warmSync,
  warmManySync: warmManySync,
  warmManyAsync: warmManyAsync,
  persistAsync: persistAsync,
  persistSync: persistSync,
  getSyncReadCount: getSyncReadCount
}
