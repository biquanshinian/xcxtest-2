/**
 * 用户行为统计模块
 * 用于成就徽章系统的数据采集
 */

const storageCache = require('./storage-sync-cache.js')

const STATS_KEY = '_user_behavior_stats'

let _statsMem = null
let _statsMemLoaded = false

function loadStats() {
  if (_statsMemLoaded) return _statsMem || {}
  _statsMem = storageCache.readSync(STATS_KEY, {}) || {}
  _statsMemLoaded = true
  return _statsMem
}

function warmBehaviorStatsSync() {
  return loadStats()
}

function saveStats(stats) {
  _statsMem = stats || {}
  _statsMemLoaded = true
  storageCache.persistAsync(STATS_KEY, _statsMem)
}

function incrementStat(key, amount) {
  const stats = loadStats()
  stats[key] = (stats[key] || 0) + (amount || 1)
  saveStats(stats)
  return stats[key]
}

function setStat(key, value) {
  const stats = loadStats()
  stats[key] = value
  saveStats(stats)
}

function getStat(key) {
  const stats = loadStats()
  return stats[key] || 0
}

/**
 * 记录凌晨活跃（0:00-5:00 观看直播）
 */
function trackNightOwl() {
  const hour = new Date().getHours()
  if (hour >= 0 && hour < 5) {
    incrementStat('nightOwlCount')
    try { require('./user-growth.js').recordMilestone('NIGHT_OWL') } catch (e) {}
  }
}

/**
 * 记录新闻阅读
 */
/** 去重 id 列表上限：只保留最近 N 条防 storage 无界膨胀，累计数由 newsReadCount 独立维护 */
const MAX_READ_NEWS_IDS = 500

function trackNewsRead(newsId) {
  const stats = loadStats()
  const readNews = stats.readNewsIds || []
  // 旧数据 newsReadCount 与列表长度同步，取 max 兼容
  const totalCount = Math.max(Number(stats.newsReadCount) || 0, readNews.length)
  if (newsId && !readNews.includes(String(newsId))) {
    readNews.push(String(newsId))
    if (readNews.length > MAX_READ_NEWS_IDS) {
      readNews.splice(0, readNews.length - MAX_READ_NEWS_IDS)
    }
    stats.readNewsIds = readNews
    stats.newsReadCount = totalCount + 1
    saveStats(stats)
    return stats.newsReadCount
  }
  return totalCount
}

/**
 * 记录卫星追踪使用
 */
function trackSatelliteAR() {
  incrementStat('satelliteARCount')
  try { require('./user-growth.js').recordMilestone('STARLINK_HUNTER') } catch (e) {}
}

/**
 * 记录发射提醒订阅（发射前24小时内）
 */
function trackEarlySubscribe(launchId, launchTime) {
  const stats = loadStats()
  const earlySubscribes = stats.earlySubscribes || {}
  if (launchId && launchTime) {
    const timeToLaunch = new Date(launchTime).getTime() - Date.now()
    if (timeToLaunch > 0 && timeToLaunch <= 24 * 60 * 60 * 1000) {
      earlySubscribes[launchId] = { subscribedAt: Date.now(), launchTime }
      stats.earlySubscribes = earlySubscribes
      saveStats(stats)
    }
  }
}

/**
 * 记录发射成功后检查"先知"成就
 * 返回成功预测的次数
 */
function checkProphetAchievement(launchId) {
  const stats = loadStats()
  const earlySubscribes = stats.earlySubscribes || {}
  if (earlySubscribes[launchId]) {
    stats.prophetCount = (stats.prophetCount || 0) + 1
    delete earlySubscribes[launchId]
    stats.earlySubscribes = earlySubscribes
    saveStats(stats)
    return stats.prophetCount
  }
  return stats.prophetCount || 0
}

/**
 * 记录连续打开小程序天数（全勤观察员）
 */
function _localDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function trackDailyOpen() {
  const stats = loadStats()
  // 本地自然日（此前用 toISOString 的 UTC 日期，UTC+8 用户凌晨 0-8 点会被算作前一天，导致同一天重复 +1）
  const today = _localDateStr(new Date())

  if (stats.lastOpenDate === today) return stats.consecutiveOpenDays || 0

  const yesterday = _localDateStr(new Date(Date.now() - 86400000))
  if (stats.lastOpenDate === yesterday) {
    stats.consecutiveOpenDays = (stats.consecutiveOpenDays || 0) + 1
  } else {
    stats.consecutiveOpenDays = 1
  }
  stats.lastOpenDate = today
  stats.maxConsecutiveOpenDays = Math.max(stats.maxConsecutiveOpenDays || 0, stats.consecutiveOpenDays)
  saveStats(stats)
  return stats.consecutiveOpenDays
}

/**
 * 获取所有统计数据（供成就判定用）
 */
function getAllStats() {
  const stats = loadStats()
  return {
    nightOwlCount: stats.nightOwlCount || 0,
    consecutiveOpenDays: stats.consecutiveOpenDays || 0,
    maxConsecutiveOpenDays: stats.maxConsecutiveOpenDays || 0,
    newsReadCount: stats.newsReadCount || 0,
    satelliteARCount: stats.satelliteARCount || 0,
    marsPhotoCount: stats.marsPhotoCount || 0,
    prophetCount: stats.prophetCount || 0
  }
}

module.exports = {
  loadStats,
  warmBehaviorStatsSync,
  saveStats,
  incrementStat,
  setStat,
  getStat,
  trackNightOwl,
  trackNewsRead,
  trackSatelliteAR,
  trackEarlySubscribe,
  checkProphetAchievement,
  trackDailyOpen,
  getAllStats
}
