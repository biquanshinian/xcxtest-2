/**
 * 罗曼太空望远镜追踪
 *
 * 数据源（按优先级）：
 *   1. Worker GET /roman-tracker — 服务端解析 Horizons -211 + DSN Now RST，精简 JSON
 *   2. 已有 Horizons 代理 GET /artemis-horizons — 客户端解析星历（DSN 不可用）
 *
 * 请求链路：小程序 → Worker → NASA/JPL Horizons、NASA DSN Now
 */

var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')
var ephem = require('./roman-ephem.js')

var REQUEST_TIMEOUT = 30000
var CACHE_TTL = 20000
var CREDIT_LINES = [
  '数据来源：NASA/JPL Horizons（星历体 -211）',
  '深空网状态来自 NASA DSN Now。'
]
var CREDIT_LINES_EPHEM = [
  '数据来源：NASA/JPL Horizons（南希·格雷斯·罗曼太空望远镜，星历体 -211）',
  '此为星历推算，非实时遥测。'
]

var _cache = { data: null, ts: 0 }

function getCfg() {
  return (config && config.romanTracker) || {}
}

function getWorkerBase() {
  var c = getCfg()
  if (c.trackerProxyUrl) return String(c.trackerProxyUrl).replace(/\/roman-tracker\/?$/, '').replace(/\/$/, '')
  var base = config && config.workerProxyUrl && String(config.workerProxyUrl).trim()
  return base ? base.replace(/\/$/, '') : ''
}

function shouldShow() {
  return ephem.isSectionVisible(getCfg(), Date.now())
}

function shouldShowOnMonitor() {
  return ephem.isMonitorVisible(getCfg(), Date.now())
}

function getLaunchMs() {
  var c = getCfg()
  return c.launchUtcIso ? Date.parse(c.launchUtcIso) : NaN
}

function getMissionSummary() {
  var c = getCfg()
  return {
    missionName: c.missionName || '罗曼太空望远镜',
    launchTime: c.launchUtcIso ? ephem.fmtUtcLabel(c.launchUtcIso) : '',
    vehicle: c.vehicleText || '猎鹰重型 · 肯尼迪 LC-39A',
    destination: c.destinationText || '日地第二拉格朗日点（L2）晕轨道',
    mirror: c.mirrorText || '主镜 2.4 米',
    mass: c.massText || '发射质量约 10.5 吨',
    size: c.sizeText || '展开约 12.7 米 × 4.4 米',
    command: c.command || '-211',
    dsnName: c.dsnName || 'RST',
    cruiseEndLabel: c.cruiseEndUtcIso ? ephem.fmtUtcLabel(c.cruiseEndUtcIso) : '',
    endTime: c.missionEndUtcIso ? ephem.fmtUtcLabel(c.missionEndUtcIso) : '',
    remainLabel: ephem.cruiseRemainLabel(c)
  }
}

function friendlyError(raw) {
  if (!raw) return '网络连接失败，请检查网络后重试'
  if (/not in domain list/i.test(raw)) return '服务配置异常，请联系开发者'
  if (/timeout/i.test(raw)) return '请求超时，请稍后重试'
  if (/request:fail/i.test(raw)) return '网络请求失败，请检查网络后重试'
  return '数据获取失败，请稍后重试'
}

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

function attachMeta(snapshot, creditLines) {
  var c = getCfg()
  var phase = ephem.getMissionPhase(c, Date.now())
  return Object.assign({}, snapshot, {
    phase: phase,
    phaseSub: ephem.phaseSubtitle(phase),
    missionName: c.missionName || '罗曼太空望远镜',
    creditLines: creditLines || CREDIT_LINES,
    officialUrl: c.officialUrl || 'https://science.nasa.gov/mission/roman-space-telescope/',
    eyesUrl: c.eyesUrl || 'https://eyes.nasa.gov/apps/solar-system/'
  })
}

async function fetchFromCompact(launchMs, nowMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var data = await requestJson(base + '/roman-tracker', 25000, 0)
  if (!data || !data.ok) throw new Error((data && data.error) || '罗曼追踪暂不可用')
  var phase = ephem.getMissionPhase(getCfg(), nowMs)
  var dsn = data.dsn || null
  var snapshot = {
    ok: true,
    source: data.source || 'roman-tracker',
    missionElapsedText: ephem.fmtMet(nowMs, launchMs),
    velocityKmh: data.velocityKmh,
    distanceFromEarthKm: data.distanceFromEarthKm,
    distanceToL2Km: data.distanceToL2Km != null ? data.distanceToL2Km : null,
    lightDelaySec: data.lightDelaySec != null ? data.lightDelaySec : null,
    lightDelayText: ephem.fmtLightDelay(data.lightDelaySec),
    rangeRateKmS: data.rangeRateKmS != null ? data.rangeRateKmS : null,
    progressPct: ephem.l2ProgressPct(data.distanceFromEarthKm, data.distanceToL2Km, phase),
    posKm: data.posKm || null,
    speedKmS: data.speedKmS != null ? data.speedKmS : null,
    dsn: dsn,
    dsnLine: data.dsnLine || ephem.formatDsnLine(dsn),
    updatedAtLabel: data.updatedAtLabel || ephem.fmtUtcLabel(new Date(nowMs))
  }
  return attachMeta(snapshot, (dsn && dsn.tracking) ? CREDIT_LINES : CREDIT_LINES_EPHEM)
}

function buildHorizonsUrl(cmd, startCal, stopCal) {
  var base = getWorkerBase()
  var e = encodeURIComponent
  return base + '/artemis-horizons?format=json' +
    '&COMMAND=' + e("'" + cmd + "'") +
    '&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=VECTORS' +
    '&CENTER=' + e("'500@399'") +
    '&START_TIME=' + e("'" + startCal + "'") +
    '&STOP_TIME=' + e("'" + stopCal + "'") +
    '&STEP_SIZE=' + e("'1 min'") +
    "&QUANTITIES='1'&OUT_UNITS=KM-S"
}

function fmtUtc(d) {
  return d.getUTCFullYear() + '-' + ephem.pad2(d.getUTCMonth() + 1) + '-' + ephem.pad2(d.getUTCDate()) +
    ' ' + ephem.pad2(d.getUTCHours()) + ':' + ephem.pad2(d.getUTCMinutes()) + ':' + ephem.pad2(d.getUTCSeconds())
}

async function fetchFromHorizons(launchMs, nowMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var c = getCfg()
  var startCal = fmtUtc(new Date(nowMs - 3 * 60000))
  var stopCal = fmtUtc(new Date(nowMs + 1 * 60000))
  var cmd = c.command || '-211'
  var l2Cmd = c.l2Command || 'SEMB-L2'
  var results = await Promise.all([
    requestJson(buildHorizonsUrl(cmd, startCal, stopCal), 60000),
    requestJson(buildHorizonsUrl(l2Cmd, startCal, stopCal), 60000).catch(function () { return null })
  ])
  var rawR = results[0]
  var rawL = results[1]
  if (rawR && rawR.error) throw new Error(String(rawR.error).slice(0, 120))
  var roman = ephem.pickClosest(ephem.parseHorizonsVectors((rawR && rawR.result) || ''), nowMs)
  var l2 = null
  if (rawL && !rawL.error) {
    l2 = ephem.pickClosest(ephem.parseHorizonsVectors(rawL.result || ''), nowMs)
  }
  var phase = ephem.getMissionPhase(c, nowMs)
  var snapshot = ephem.buildSnapshot({
    nowMs: nowMs,
    launchMs: launchMs,
    roman: roman,
    l2: l2,
    dsn: null,
    phase: phase,
    source: 'horizons'
  })
  if (!snapshot) throw new Error('无法解析星历')
  return attachMeta(snapshot, CREDIT_LINES_EPHEM)
}

async function fetchBriefing() {
  var nowTs = Date.now()
  if (_cache.data && _cache.data.ok && (nowTs - _cache.ts) < CACHE_TTL) {
    return Object.assign({}, _cache.data, {
      missionElapsedText: ephem.fmtMet(nowTs, getLaunchMs())
    })
  }
  var launchMs = getLaunchMs()
  try {
    var compact = await fetchFromCompact(launchMs, nowTs)
    _cache = { data: compact, ts: Date.now() }
    return compact
  } catch (e1) {
    console.warn('[Roman] 精简接口失败:', e1.message)
  }
  try {
    var horizons = await fetchFromHorizons(launchMs, nowTs)
    _cache = { data: horizons, ts: Date.now() }
    return horizons
  } catch (e2) {
    console.error('[Roman] Horizons 也失败:', e2.message)
    return { ok: false, error: friendlyError(e2.message), creditLines: CREDIT_LINES }
  }
}

module.exports = {
  fetchRomanBriefing: fetchBriefing,
  shouldShowRomanSection: shouldShow,
  shouldShowRomanOnMonitor: shouldShowOnMonitor,
  getRomanLaunchMs: getLaunchMs,
  getRomanMissionPhase: function (nowMs) {
    return ephem.getMissionPhase(getCfg(), nowMs)
  },
  getRomanMissionSummary: getMissionSummary,
  getRomanPhaseSubtitle: function (nowMs) {
    return ephem.phaseSubtitle(ephem.getMissionPhase(getCfg(), nowMs))
  },
  CREDIT_LINES: CREDIT_LINES,
  CREDIT_LINES_EPHEM: CREDIT_LINES_EPHEM
}
