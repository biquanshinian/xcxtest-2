/**
 * 用户成长体系 — 三功能共享核心模块
 * 管理：偏好设置、每日简报、个人时间线
 */

const storageCache = require('./storage-sync-cache.js')

const PREFS_STORAGE_KEY = '_user_preferences'
const TIMELINE_STORAGE_KEY = '_user_timeline'
const BRIEFING_READ_KEY = '_briefing_read_date'
const BRIEFING_CACHE_KEY = '_briefing_cache'
const BRIEFING_STREAK_KEY = '_briefing_streak'
const BRIEFING_POPUP_SHOWN_KEY = '_briefing_popup_shown_date'

let _timelineMem = null
let _timelineMemLoaded = false

// ── 天文事件类型（偏好筛选 / 简报匹配 / 时间线关联共用） ──
const ASTRO_EVENT_CATEGORIES = [
  { id: 'meteor', name: '流星雨' },
  { id: 'eclipse', name: '日月食' },
  { id: 'planet', name: '行星事件' },
  { id: 'solstice', name: '节气' }
]

// ── 火箭型号选项（从历史数据中提取的常见型号） ──
const ROCKET_TYPE_OPTIONS = [
  'Falcon 9', 'Falcon Heavy', 'Starship',
  '长征5号', '长征2号', '长征7号', '长征11号',
  'Ariane 6', 'Vega-C', 'Electron',
  'Atlas V', 'Vulcan Centaur', 'New Glenn',
  'H3', 'PSLV', 'GSLV', 'Soyuz'
]

// ── 发射场选项 ──
const LAUNCH_SITE_OPTIONS = [
  'KSC LC-39A', 'CCSFS SLC-40', 'Vandenberg SLC-4E',
  'Boca Chica', '文昌', '酒泉', '太原', '西昌',
  'Kourou', 'Mahia LC-1', 'Tanegashima',
  'Baikonur', 'Vostochny', 'Sriharikota'
]

// ── 里程碑类型定义 ──
const MILESTONE_TYPES = {
  FIRST_OPEN: { name: '初次启程', icon: 'rocket', desc: '第一次打开火星探索日志' },
  FIRST_CHECKIN: { name: '首次签到', icon: 'check', desc: '完成第一次每日签到' },
  FIRST_QUIZ: { name: '知识启蒙', icon: 'brain', desc: '完成第一次太空问答' },
  FIRST_SUBSCRIBE: { name: '追踪者', icon: 'bell', desc: '第一次订阅发射提醒' },
  FIRST_SHARE: { name: '传播者', icon: 'share', desc: '第一次分享给好友' },
  WITNESS_LAUNCH: { name: '见证历史', icon: 'live', desc: '在线观看了一次发射直播' },
  STREAK_7: { name: '一周轨道', icon: 'moon', desc: '连续签到7天' },
  STREAK_30: { name: '月球常驻', icon: 'fullmoon', desc: '连续签到30天' },
  QUIZ_STREAK_5: { name: '五连胜', icon: 'trophy', desc: '答题连续答对5题' },
  NIGHT_OWL: { name: '夜猫子', icon: 'owl', desc: '凌晨观看发射直播' },
  STARLINK_HUNTER: { name: '星链猎人', icon: 'satellite', desc: '首次使用卫星追踪' },
  FACTS_10: { name: '知识收集者', icon: 'book', desc: '收集10张太空知识卡' },
  MEMBERSHIP: { name: '太空通行证', icon: 'diamond', desc: '成为 Pro 会员' },
  BRIEFING_7: { name: '简报达人', icon: 'news', desc: '连续7天阅读每日简报' }
}

// ══════════════════════════════════════════
// 偏好相关
// ══════════════════════════════════════════

function loadPreferences() {
  return storageCache.readSync(PREFS_STORAGE_KEY, getDefaultPreferences()) || getDefaultPreferences()
}

function warmUserPreferencesSync() {
  return loadPreferences()
}

function warmUserPreferencesAsync() {
  if (storageCache.isLoaded(PREFS_STORAGE_KEY)) {
    return Promise.resolve(loadPreferences())
  }
  return storageCache.warmAsync(PREFS_STORAGE_KEY, getDefaultPreferences())
}

function getDefaultPreferences() {
  return {
    rocketTypes: [],
    launchSites: [],
    astroEventTypes: [],
    notifyMinutes: 60,
    briefingEnabled: true,
    updatedAt: 0
  }
}

function savePreferences(prefs) {
  prefs.updatedAt = Date.now()
  storageCache.writeMem(PREFS_STORAGE_KEY, prefs)
  try {
    wx.setStorage({ key: PREFS_STORAGE_KEY, data: prefs, fail: function () {} })
  } catch (e) {}
  syncPreferencesToCloud(prefs)
}

function syncPreferencesToCloud(prefs) {
  if (!wx.cloud) return
  try {
    wx.cloud.callFunction({
      name: 'userDataGateway',
      data: { action: 'savePreferences', preferences: prefs || loadPreferences() }
    }).catch(function () {})
  } catch (e) {}
}

/**
 * 后台「全局配置中心」每日太空简报开关（global_config.main.enableBriefing）。
 * 带 10 分钟内存缓存：此前每次实时读库，简报入口多、读库量大；
 * 关简报是极低频运营操作，10 分钟内生效完全够用
 */
var _briefingEnabledCache = { value: null, expireAt: 0 }
var BRIEFING_ENABLED_CACHE_TTL = 10 * 60 * 1000

function isBriefingGloballyEnabled() {
  if (!wx.cloud || !wx.cloud.database) {
    return Promise.resolve(true)
  }
  if (_briefingEnabledCache.value !== null && Date.now() < _briefingEnabledCache.expireAt) {
    return Promise.resolve(_briefingEnabledCache.value)
  }
  var db = wx.cloud.database()
  return db.collection('global_config').where({ _id: 'main' }).limit(1).get().then(function (res) {
    var cfg = res.data && res.data[0]
    var enabled = cfg ? (cfg.enableBriefing !== false) : true
    _briefingEnabledCache = { value: enabled, expireAt: Date.now() + BRIEFING_ENABLED_CACHE_TTL }
    return enabled
  }).catch(function () {
    return true
  })
}

// ══════════════════════════════════════════
// 每日简报相关
// ══════════════════════════════════════════

function getTodayStr() {
  var d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function markBriefingRead() {
  var today = getTodayStr()
  storageCache.writeMem(BRIEFING_READ_KEY, today)
  try {
    wx.setStorage({ key: BRIEFING_READ_KEY, data: today, fail: function () {} })
  } catch (e) {}
  trackBriefingStreak()
}

function isBriefingUnread() {
  try {
    var today = getTodayStr()
    var readDate = storageCache.readSync(BRIEFING_READ_KEY, '')
    return readDate !== today
  } catch (e) {
    return true
  }
}

function isBriefingPopupShownToday() {
  try {
    var today = getTodayStr()
    return storageCache.readSync(BRIEFING_POPUP_SHOWN_KEY, '') === today
  } catch (e) {
    return false
  }
}

function markBriefingPopupShown() {
  try {
    var today = getTodayStr()
    storageCache.writeMem(BRIEFING_POPUP_SHOWN_KEY, today)
    wx.setStorage({ key: BRIEFING_POPUP_SHOWN_KEY, data: today, fail: function () {} })
  } catch (e) {}
}

function warmBriefingPopupShownSync() {
  storageCache.warmSync(BRIEFING_POPUP_SHOWN_KEY, '')
}

function warmBriefingPopupShownAsync() {
  return storageCache.warmAsync(BRIEFING_POPUP_SHOWN_KEY, '')
}

function trackBriefingStreak() {
  try {
    var data = storageCache.readSync(BRIEFING_STREAK_KEY, { count: 0, lastDate: '' })
    var today = getTodayStr()
    if (data.lastDate === today) return data.count

    // 与 getTodayStr 同为本地日期，避免 UTC+8 凌晨误判断档
    var yd = new Date(Date.now() - 86400000)
    var yesterday = yd.getFullYear() + '-' +
      String(yd.getMonth() + 1).padStart(2, '0') + '-' +
      String(yd.getDate()).padStart(2, '0')
    if (data.lastDate === yesterday) {
      data.count += 1
    } else {
      data.count = 1
    }
    data.lastDate = today
    storageCache.writeMem(BRIEFING_STREAK_KEY, data)
    try {
      wx.setStorage({ key: BRIEFING_STREAK_KEY, data: data, fail: function () {} })
    } catch (e) {}

    if (data.count >= 7) {
      recordMilestone('BRIEFING_7')
    }
    return data.count
  } catch (e) {
    return 0
  }
}

// ══════════════════════════════════════════
// 时间线相关
// ══════════════════════════════════════════

const FIRST_OPEN_CONFIRMED_KEY = '_first_open_confirmed'
let _firstOpenConfirmedMem = null

function loadTimeline() {
  if (_timelineMemLoaded) return _timelineMem || []
  try {
    _timelineMem = wx.getStorageSync(TIMELINE_STORAGE_KEY) || []
  } catch (e) {
    _timelineMem = []
  }
  _timelineMemLoaded = true
  return _timelineMem
}

function saveTimeline(timeline) {
  _timelineMem = timeline || []
  _timelineMemLoaded = true
  try {
    wx.setStorage({ key: TIMELINE_STORAGE_KEY, data: _timelineMem, fail: function () {} })
  } catch (e) {}
}

/**
 * 记录里程碑（去重：同 type 只记录首次，WITNESS_LAUNCH 除外）
 */
function recordMilestone(type, meta, cloudCheck) {
  if (!MILESTONE_TYPES[type]) return false

  var timeline = loadTimeline()
  var allowDuplicate = type === 'WITNESS_LAUNCH'

  if (!allowDuplicate) {
    var exists = timeline.some(function (item) { return item.type === type })
    if (exists) return false
  }

  // cloudCheck 模式：先查云端是否已有记录，防止删除小程序后重复统计
  if (cloudCheck && type === 'FIRST_OPEN') {
    if (_firstOpenConfirmedMem === true) return false

    var startCloudCheck = function () {
      if (!wx.cloud) return
      try {
        wx.cloud.callFunction({
          name: 'userDataGateway',
          data: { action: 'getProfile' }
        }).then(function (res) {
          var profile = res.result && res.result.profile
          var cloudTimeline = (profile && profile.timeline) || []
          var alreadyExists = cloudTimeline.some(function (item) { return item.type === 'FIRST_OPEN' })
          if (alreadyExists) {
            _firstOpenConfirmedMem = true
            wx.setStorage({ key: FIRST_OPEN_CONFIRMED_KEY, data: true, fail: function () {} })
            return
          }
          _doRecordMilestone('FIRST_OPEN', meta)
          _firstOpenConfirmedMem = true
          wx.setStorage({ key: FIRST_OPEN_CONFIRMED_KEY, data: true, fail: function () {} })
        }).catch(function () {
          // 网络失败时保守处理：不记录，下次再试
        })
      } catch (e) {}
    }

    if (_firstOpenConfirmedMem === false) {
      startCloudCheck()
      return false
    }

    wx.getStorage({
      key: FIRST_OPEN_CONFIRMED_KEY,
      success: function (res) {
        if (res.data) {
          _firstOpenConfirmedMem = true
          return
        }
        _firstOpenConfirmedMem = false
        startCloudCheck()
      },
      fail: function () {
        _firstOpenConfirmedMem = false
        startCloudCheck()
      }
    })
    return false
  }

  return _doRecordMilestone(type, meta)
}

function _doRecordMilestone(type, meta) {
  var timeline = loadTimeline()

  var entry = {
    type: type,
    timestamp: Date.now(),
    meta: meta || {}
  }
  timeline.push(entry)
  saveTimeline(timeline)

  // 异步同步到云端
  syncTimelineToCloud(entry)
  return true
}

function getTimeline() {
  var timeline = loadTimeline()
  return timeline.sort(function (a, b) { return b.timestamp - a.timestamp })
}

function syncTimelineToCloud(entry) {
  if (!wx.cloud) return
  try {
    wx.cloud.callFunction({
      name: 'userDataGateway',
      data: { action: 'recordMilestone', milestone: entry }
    }).catch(function () {})
  } catch (e) {}
}

/**
 * 历史数据回填：从现有签到/成就数据反推里程碑
 */
function backfillTimeline() {
  var timeline = loadTimeline()
  if (timeline.length > 0) return // 已有数据则不回填

  var newEntries = []

  // 从签到数据回填
  try {
    var checkinData = require('./checkin.js').warmCheckinStoreSync()
    if (checkinData && checkinData.checkinHistory && checkinData.checkinHistory.length > 0) {
      var firstDate = checkinData.checkinHistory[0]
      newEntries.push({
        type: 'FIRST_CHECKIN',
        timestamp: new Date(firstDate + 'T08:00:00').getTime(),
        meta: {}
      })

      if (checkinData.maxStreak >= 7) {
        newEntries.push({
          type: 'STREAK_7',
          timestamp: new Date(firstDate + 'T08:00:00').getTime() + 7 * 86400000,
          meta: {}
        })
      }
      if (checkinData.maxStreak >= 30) {
        newEntries.push({
          type: 'STREAK_30',
          timestamp: new Date(firstDate + 'T08:00:00').getTime() + 30 * 86400000,
          meta: {}
        })
      }
      if ((checkinData.collectedFactIds || []).length >= 10) {
        newEntries.push({
          type: 'FACTS_10',
          timestamp: Date.now() - 86400000,
          meta: {}
        })
      }
    }
  } catch (e) {}

  // 从成就数据回填
  try {
    var achievements = storageCache.readMemOrSync('_achievements_data', {}) || {}
    if (achievements.night_owl) {
      newEntries.push({
        type: 'NIGHT_OWL',
        timestamp: achievements.night_owl.unlockedAt || Date.now() - 86400000,
        meta: {}
      })
    }
    if (achievements.satellite_hunter) {
      newEntries.push({
        type: 'STARLINK_HUNTER',
        timestamp: achievements.satellite_hunter.unlockedAt || Date.now() - 86400000,
        meta: {}
      })
    }
  } catch (e) {}

  // 从问答数据回填
  try {
    var quizData = require('./space-quiz.js').warmQuizStoreSync()
    if (quizData && quizData.totalAnswered > 0) {
      newEntries.push({
        type: 'FIRST_QUIZ',
        timestamp: Date.now() - 7 * 86400000,
        meta: {}
      })
    }
    if (quizData && quizData.streak >= 5) {
      newEntries.push({
        type: 'QUIZ_STREAK_5',
        timestamp: Date.now() - 3 * 86400000,
        meta: {}
      })
    }
  } catch (e) {}

  // 从订阅数据回填（走 subscribe 内存缓存，禁止直接 sync 读 _subscribed_missions）
  try {
    var subs = require('./subscribe.js').getSubscribedStore() || {}
    if (Object.keys(subs).length > 0) {
      var firstSub = Object.values(subs).sort(function (a, b) {
        return (a.ts || 0) - (b.ts || 0)
      })[0]
      newEntries.push({
        type: 'FIRST_SUBSCRIBE',
        timestamp: (firstSub && firstSub.ts) || Date.now() - 14 * 86400000,
        meta: {}
      })
    }
  } catch (e) {}

  if (newEntries.length > 0) {
    saveTimeline(newEntries)
  }
}

module.exports = {
  // 偏好
  loadPreferences: loadPreferences,
  savePreferences: savePreferences,
  syncPreferencesToCloud: syncPreferencesToCloud,
  getDefaultPreferences: getDefaultPreferences,
  warmUserPreferencesSync: warmUserPreferencesSync,
  warmUserPreferencesAsync: warmUserPreferencesAsync,

  // 简报
  markBriefingRead: markBriefingRead,
  isBriefingUnread: isBriefingUnread,
  isBriefingPopupShownToday: isBriefingPopupShownToday,
  markBriefingPopupShown: markBriefingPopupShown,
  warmBriefingPopupShownSync: warmBriefingPopupShownSync,
  warmBriefingPopupShownAsync: warmBriefingPopupShownAsync,
  trackBriefingStreak: trackBriefingStreak,
  isBriefingGloballyEnabled: isBriefingGloballyEnabled,

  // 时间线
  recordMilestone: recordMilestone,
  getTimeline: getTimeline,
  syncTimelineToCloud: syncTimelineToCloud,
  backfillTimeline: backfillTimeline,

  // 共享常量
  MILESTONE_TYPES: MILESTONE_TYPES,
  ASTRO_EVENT_CATEGORIES: ASTRO_EVENT_CATEGORIES,
  ROCKET_TYPE_OPTIONS: ROCKET_TYPE_OPTIONS,
  LAUNCH_SITE_OPTIONS: LAUNCH_SITE_OPTIONS
}
