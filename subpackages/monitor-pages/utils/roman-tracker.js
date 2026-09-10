/**
 * 罗曼太空望远镜追踪
 *
 * 数据源：Worker GET /roman-tracker（服务端解析 Horizons -211 + DSN Now RST）
 * 精简接口失败时回落本地上次成功快照，不再客户端直打 /artemis-horizons
 *（该备用链在 We分析中 100% 发起失败，且 60s 超时会拖垮监控页）。
 *
 * 请求链路：小程序 → Worker → NASA/JPL Horizons、NASA DSN Now
 */

var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')
var ephem = require('./roman-ephem.js')

var REQUEST_TIMEOUT = 30000
var CACHE_TTL = 60000
var STALE_KEY = '_roman_tracker_last'
var STALE_TTL = 6 * 60 * 60 * 1000
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
    eyesUrl: c.eyesUrl || 'https://eyes.nasa.gov/apps/solar-system/',
    adoptPixelUrl: getAdoptPixelUrl()
  })
}

function getAdoptPixelUrl() {
  var c = getCfg()
  var raw = c && c.adoptPixelUrl
  var url = raw ? String(raw).trim() : ''
  return url || 'https://science.nasa.gov/mission/roman-space-telescope/adopt-a-pixel/'
}

/** 复制 NASA 官方认领页。像素由 NASA 按邮箱分配，小程序只做入口。 */
function copyAdoptPixelLink() {
  var url = getAdoptPixelUrl()
  if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') {
    return Promise.resolve(false)
  }
  return new Promise(function (resolve) {
    wx.setClipboardData({
      data: url,
      success: function () {
        wx.showModal({
          title: '认领链接已复制',
          content: '这是 NASA 官方 Adopt a Pixel 活动，每邮箱限领 1 个像素，首图预计 2027 年初公布。请到系统浏览器粘贴打开，用邮箱完成认领。',
          showCancel: false,
          confirmText: '我知道了'
        })
        resolve(true)
      },
      fail: function () {
        if (typeof wx.showToast === 'function') {
          wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' })
        }
        resolve(false)
      }
    })
  })
}

async function fetchFromCompact(launchMs, nowMs) {
  var base = getWorkerBase()
  if (!base) throw new Error('未配置 workerProxyUrl')
  var data = await requestJson(base + '/roman-tracker', 25000, 1)
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

function readStaleSnapshot() {
  if (_cache.data && _cache.data.ok) return _cache.data
  try {
    var stored = wx.getStorageSync(STALE_KEY)
    if (stored && stored.data && stored.data.ok && stored.ts && (Date.now() - stored.ts) < STALE_TTL) {
      return stored.data
    }
  } catch (e) {}
  return null
}

function writeStaleSnapshot(data) {
  _cache = { data: data, ts: Date.now() }
  try {
    wx.setStorage({ key: STALE_KEY, data: { data: data, ts: Date.now() }, fail: function () {} })
  } catch (e) {}
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
    writeStaleSnapshot(compact)
    return compact
  } catch (e1) {
    console.warn('[Roman] 精简接口失败:', e1.message)
    var stale = readStaleSnapshot()
    if (stale) {
      return Object.assign({}, stale, {
        missionElapsedText: ephem.fmtMet(nowTs, launchMs),
        stale: true
      })
    }
    return { ok: false, error: friendlyError(e1.message), creditLines: CREDIT_LINES }
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
  getAdoptPixelUrl: getAdoptPixelUrl,
  copyAdoptPixelLink: copyAdoptPixelLink,
  CREDIT_LINES: CREDIT_LINES,
  CREDIT_LINES_EPHEM: CREDIT_LINES_EPHEM
}
