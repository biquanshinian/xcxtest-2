/**
 * Artemis II 星历简报
 *
 * 数据源：
 *   1. NASA AROW 实时遥测 — Worker 从 GCS bucket 拉取，已在服务端解析为精简 JSON
 *      路径：GET /artemis-telemetry（响应 < 1KB，缓存 10 秒）
 *   2. 失败回落本地上次成功快照，不再客户端直打 /artemis-horizons
 *      （We分析中该备用链 100% 发起失败；app.json request 超时 10s，
 *       Horizons 客户端 60s 实际会被掐死，冷启动无快照时会刷失败请求）
 *
 * 请求链路：小程序 → Worker → GCS
 *
 * 前置条件：
 *   1. cloudflare-worker/spacex-proxy.js 已部署
 *   2. 微信公众平台 request 合法域名已添加 Worker 域名
 */

var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')

var REQUEST_TIMEOUT = 30000 // 遥测接口很快，30 秒足够

var CREDIT_LINES = [
  '数据来源：NASA AROW 实时遥测（GCS p-2-cen1）',
  '此为猎户座飞船下行遥测数据，感谢NASA。'
]

// ==================== 配置 ====================

function getCfg() {
  return (config && config.artemisArow) || {}
}

function getWorkerBase() {
  var c = getCfg()
  if (c.horizonsProxyUrl) return String(c.horizonsProxyUrl).replace(/\/artemis-horizons\/?$/, '').replace(/\/$/, '')
  var base = config && config.workerProxyUrl && String(config.workerProxyUrl).trim()
  return base ? base.replace(/\/$/, '') : ''
}

function shouldShow() {
  var c = getCfg()
  if (!c.enabled) return false
  var now = Date.now()
  if (c.visibleAfterIso) {
    var t = Date.parse(c.visibleAfterIso)
    if (!isNaN(t) && now < t) return false
  }
  if (c.visibleUntilIso) {
    var t2 = Date.parse(c.visibleUntilIso)
    if (!isNaN(t2) && now > t2) return false
  }
  return true
}

/**
 * 任务阶段：'before' | 'active' | 'ended'
 *  - before: 当前时间 < launchUtcIso
 *  - active: 当前时间 >= launchUtcIso 且 (无 missionEndUtcIso 或 当前时间 < missionEndUtcIso)
 *  - ended:  missionEndUtcIso 已设置且当前时间 >= missionEndUtcIso
 */
function getMissionPhase() {
  var c = getCfg()
  var now = Date.now()
  var launchMs = c.launchUtcIso ? Date.parse(c.launchUtcIso) : NaN
  var endMs = c.missionEndUtcIso ? Date.parse(c.missionEndUtcIso) : NaN

  if (isFinite(endMs) && now >= endMs) return 'ended'
  if (isFinite(launchMs) && now < launchMs) return 'before'
  return 'active'
}

/**
 * 任务结束后的总结信息
 */
function getMissionSummary() {
  var c = getCfg()
  var launchMs = c.launchUtcIso ? Date.parse(c.launchUtcIso) : NaN
  var endMs = c.missionEndUtcIso ? Date.parse(c.missionEndUtcIso) : NaN

  var duration = c.missionDurationText || ''
  if (!duration && isFinite(launchMs) && isFinite(endMs)) {
    var s = Math.floor((endMs - launchMs) / 1000)
    var d = Math.floor(s / 86400); s -= d * 86400
    var h = Math.floor(s / 3600); s -= h * 3600
    var m = Math.floor(s / 60)
    duration = d + '天' + h + '时' + m + '分'
  }

  return {
    missionName: c.missionName || 'Artemis II',
    launchTime: c.launchUtcIso ? c.launchUtcIso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '',
    endTime: c.missionEndUtcIso ? c.missionEndUtcIso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '',
    duration: duration
  }
}

// ==================== 工具 ====================

function pad2(n) { return String(n).padStart(2, '0') }

function fmtUtc(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
}

function fmtMet(nowMs, launchMs) {
  if (!isFinite(nowMs) || !isFinite(launchMs) || nowMs < launchMs) return '—'
  var s = Math.floor((nowMs - launchMs) / 1000)
  var d = Math.floor(s / 86400); s -= d * 86400
  var h = Math.floor(s / 3600); s -= h * 3600
  var m = Math.floor(s / 60); s -= m * 60
  return pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

function fmtNumber(n) {
  if (!isFinite(n)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function friendlyError(raw) {
  if (!raw) return '网络连接失败，请检查网络后重试'
  if (/not in domain list/i.test(raw)) return '服务配置异常，请联系开发者'
  if (/NETWORK_CHANGED/i.test(raw)) return '网络发生切换，请稍后重试'
  if (/timeout/i.test(raw)) return '请求超时，请稍后重试'
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(raw)) return '无法连接服务器，请检查网络'
  if (/SSL|CERT/i.test(raw)) return '安全连接失败，请检查网络环境'
  if (/request:fail/i.test(raw)) return '网络请求失败，请检查网络后重试'
  return '数据获取失败，请稍后重试'
}

// ==================== 网络请求 ====================

function requestJson(url, timeout, retries) {
  var opts = {
    url: url,
    method: 'GET',
    timeout: timeout || REQUEST_TIMEOUT
  }
  if (retries != null) opts.retries = retries
  return httpRequest.requestJson(opts).then(function (res) {
    if (!res.ok) {
      var err = res.error
      var msg = (err && err.errMsg) || (err && err.message) || String(err || '')
      throw new Error(friendlyError(msg))
    }
    var data = res.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch (_) {}
    }
    if (data && typeof data === 'object') return data
    throw new Error('响应不是有效 JSON')
  })
}

// ==================== 本地缓存 ====================

var _cache = { data: null, ts: 0 }
var CACHE_TTL = 8000
var STALE_KEY = '_artemis_briefing_last'
var STALE_TTL = 30 * 60 * 1000

// ==================== 方案 1：AROW 实时遥测（快） ====================

async function fetchFromTelemetry(launchMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var url = base + '/artemis-telemetry'
  var data = await requestJson(url, 20000, 1)

  if (!data.ok) throw new Error(data.error || '遥测数据不可用')

  var nowMs = Date.now()
  return {
    ok: true,
    source: 'arow-telemetry',
    missionElapsedText: fmtMet(nowMs, launchMs),
    velocityKmh: data.velocityKmh,
    distanceFromEarthKm: data.distanceFromEarthKm,
    distanceToMoonKm: data.distanceToMoonKm || null,
    altitudeKm: data.altitudeKm != null ? Math.round(data.altitudeKm) : null,
    posKm: data.posKm || null,
    rates: data.rates || null,
    attitude: data.attitude || null,
    orbit: data.orbit || null,
    power: data.power || null,
    rcs: data.rcs || null,
    thrusters: data.thrusters || null,
    solar: data.solar || null,
    commMode: data.commMode != null ? data.commMode : null,
    solar: data.solar || null,
    updatedAtLabel: data.timestamp ? data.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : fmtUtc(new Date()) + ' UTC',
    creditLines: CREDIT_LINES
  }
}

// ==================== 主入口 ====================

function readStaleBriefing() {
  if (_cache.data && _cache.data.ok) return _cache.data
  try {
    var stored = wx.getStorageSync(STALE_KEY)
    if (stored && stored.data && stored.data.ok && stored.ts && (Date.now() - stored.ts) < STALE_TTL) {
      return stored.data
    }
  } catch (e) {}
  return null
}

function writeStaleBriefing(data) {
  _cache = { data: data, ts: Date.now() }
  try {
    wx.setStorage({ key: STALE_KEY, data: { data: data, ts: Date.now() }, fail: function () {} })
  } catch (e) {}
}

async function fetchBriefing() {
  var nowTs = Date.now()
  // 本地缓存
  if (_cache.data && _cache.data.ok && (nowTs - _cache.ts) < CACHE_TTL) {
    var c = getCfg()
    var lMs = c.launchUtcIso ? Date.parse(c.launchUtcIso) : Date.parse('2026-04-01T22:35:12.000Z')
    return Object.assign({}, _cache.data, { missionElapsedText: fmtMet(nowTs, lMs) })
  }

  var cfg = getCfg()
  var launchMs = cfg.launchUtcIso ? Date.parse(cfg.launchUtcIso) : Date.parse('2026-04-01T22:35:12.000Z')

  // 优先：AROW 实时遥测（快，< 1KB）
  try {
    var result = await fetchFromTelemetry(launchMs)
    writeStaleBriefing(result)
    return result
  } catch (e1) {
    console.warn('[Artemis] 遥测失败:', e1.message, '| Worker:', getWorkerBase() + '/artemis-telemetry')
    var stale = readStaleBriefing()
    if (stale) {
      return Object.assign({}, stale, { missionElapsedText: fmtMet(nowTs, launchMs), stale: true })
    }
    return { ok: false, error: friendlyError(e1.message), creditLines: CREDIT_LINES }
  }
}

module.exports = {
  fetchArtemisIiBriefing: fetchBriefing,
  shouldShowArtemisArowSection: shouldShow,
  getArtemisLaunchMs: function () {
    var c = getCfg()
    return c.launchUtcIso ? Date.parse(c.launchUtcIso) : NaN
  },
  getArtemisMissionPhase: getMissionPhase,
  getArtemisMissionSummary: getMissionSummary,
  CREDIT_LINES: CREDIT_LINES
}
