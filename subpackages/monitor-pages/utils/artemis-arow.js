/**
 * Artemis II 星历简报
 *
 * 数据源（按优先级）：
 *   1. NASA AROW 实时遥测 — Worker 从 GCS bucket 拉取，已在服务端解析为精简 JSON
 *      路径：GET /artemis-telemetry（响应 < 1KB，缓存 10 秒）
 *   2. JPL Horizons 星历 — 备用，Worker 代理转发
 *      路径：GET /artemis-horizons?...（响应较大，缓存 60 秒）
 *
 * 请求链路：小程序 → Worker → GCS / JPL
 *
 * 前置条件：
 *   1. cloudflare-worker/spacex-proxy.js 已部署
 *   2. 微信公众平台 request 合法域名已添加 Worker 域名
 */

var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')

var KM_S_TO_KMH = 3600
var REQUEST_TIMEOUT = 30000 // 遥测接口很快，30 秒足够

var CREDIT_LINES = [
  '数据来源：NASA AROW 实时遥测（GCS p-2-cen1）',
  '此为猎户座飞船下行遥测数据，感谢NASA。'
]

var CREDIT_LINES_HORIZONS = [
  '数据来源：NASA/JPL Horizons（Artemis II 星历体 -1024）',
  '此为星历推算，非实时遥测；详情见 NASA AROW 官网。'
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

function requestJson(url, timeout) {
  return httpRequest.requestJson({
    url: url,
    method: 'GET',
    timeout: timeout || REQUEST_TIMEOUT
  }).then(function (res) {
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

// ==================== 方案 1：AROW 实时遥测（快） ====================

async function fetchFromTelemetry(launchMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var url = base + '/artemis-telemetry'
  var data = await requestJson(url, 20000) // 遥测接口应该很快

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

// ==================== 方案 2：Horizons 星历（慢，兜底） ====================

var MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

function parseRows(text) {
  if (!text || typeof text !== 'string') return []
  var m = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text)
  if (!m) return []
  var lines = m[1].split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean)
  var out = []
  for (var i = 0; i < lines.length;) {
    var head = lines[i]
    if (!/^\d+\.\d+/.test(head) || head.indexOf('A.D.') < 0) { i++; continue }
    if (!lines[i + 1] || !lines[i + 2] || !lines[i + 3]) break
    var cm = /A\.D\.\s*(\d{4})-(\w{3})-(\d+)\s+(\d+):(\d+):(\d+)/.exec(head)
    var tMs = NaN
    if (cm && MON[cm[2]] !== undefined) tMs = Date.UTC(+cm[1], MON[cm[2]], +cm[3], +cm[4], +cm[5], +cm[6])
    var xm = /X\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var ym = /Y\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var zm = /Z\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var vxm = /VX\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var vym = /VY\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var vzm = /VZ\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var rgm = /RG=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    if (xm && ym && zm && vxm && vym && vzm && rgm) {
      var vx = parseFloat(vxm[1]), vy = parseFloat(vym[1]), vz = parseFloat(vzm[1])
      out.push({
        tMs: tMs,
        pos: { x: parseFloat(xm[1]), y: parseFloat(ym[1]), z: parseFloat(zm[1]) },
        rgKm: parseFloat(rgm[1]),
        speedKmS: Math.sqrt(vx * vx + vy * vy + vz * vz)
      })
    }
    i += 4
  }
  return out
}

function pickClosest(rows, nowMs) {
  if (!rows.length) return null
  var best = rows[0], bestDt = isFinite(rows[0].tMs) ? Math.abs(rows[0].tMs - nowMs) : Infinity
  for (var i = 1; i < rows.length; i++) {
    if (!isFinite(rows[i].tMs)) continue
    var dt = Math.abs(rows[i].tMs - nowMs)
    if (dt < bestDt) { bestDt = dt; best = rows[i] }
  }
  return best
}

function dist3d(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

async function fetchFromHorizons(launchMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var e = encodeURIComponent
  var nowMs = Date.now()
  var startCal = fmtUtc(new Date(nowMs - 3 * 60000))
  var stopCal = fmtUtc(new Date(nowMs + 1 * 60000))

  function buildUrl(cmd) {
    return base + '/artemis-horizons?format=json' +
      '&COMMAND=' + e("'" + cmd + "'") +
      '&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=VECTORS' +
      '&CENTER=' + e("'500@399'") +
      '&START_TIME=' + e("'" + startCal + "'") +
      '&STOP_TIME=' + e("'" + stopCal + "'") +
      '&STEP_SIZE=' + e("'1 min'") +
      "&QUANTITIES='1'&OUT_UNITS=KM-S"
  }

  var results = await Promise.all([requestJson(buildUrl('-1024'), 60000), requestJson(buildUrl('301'), 60000)])
  var rawO = results[0], rawM = results[1]
  if (rawO.error) throw new Error(String(rawO.error).slice(0, 120))
  if (rawM.error) throw new Error(String(rawM.error).slice(0, 120))

  var ro = pickClosest(parseRows(rawO.result || ''), nowMs)
  var rm = pickClosest(parseRows(rawM.result || ''), nowMs)
  if (!ro || !rm || !ro.pos || !rm.pos) throw new Error('无法解析星历')

  return {
    ok: true,
    source: 'horizons',
    missionElapsedText: fmtMet(nowMs, launchMs),
    velocityKmh: Math.round(ro.speedKmS * KM_S_TO_KMH),
    distanceFromEarthKm: Math.round(ro.rgKm),
    distanceToMoonKm: Math.round(dist3d(ro.pos, rm.pos)),
    updatedAtLabel: fmtUtc(new Date()) + ' UTC',
    creditLines: CREDIT_LINES_HORIZONS
  }
}

// ==================== 主入口 ====================

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
    _cache = { data: result, ts: Date.now() }
    return result
  } catch (e1) {
    console.warn('[Artemis] 遥测失败:', e1.message, '| Worker:', getWorkerBase() + '/artemis-telemetry')
  }

  // 兜底：Horizons 星历（慢但稳）
  try {
    var result2 = await fetchFromHorizons(launchMs)
    _cache = { data: result2, ts: Date.now() }
    return result2
  } catch (e2) {
    console.error('[Artemis] Horizons 也失败:', e2.message)
    return { ok: false, error: friendlyError(e2.message), creditLines: CREDIT_LINES }
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
