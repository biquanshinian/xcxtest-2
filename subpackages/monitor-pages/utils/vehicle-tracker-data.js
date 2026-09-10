/**
 * ODC「Vehicle Tracker」数据层
 *
 * 数据源：SpaceX 官网 tracker 页轮询的公开 JSON（starship/dragon tracker_public），
 * 经 Cloudflare Worker /vehicle-tracker 路由合并代理（见 cloudflare-worker/spacex-proxy.js）。
 *
 * 两种载荷 schema（实测 2026-07）：
 *   starship：{ current: { gps_time, mission_time(秒), altitude(米), speed(米/秒), latitude, longitude(度) },
 *              trajectory: [{ time, latitude, longitude, altitude }, ...]（60s 间隔） }
 *   dragon：  { 'glass.dragon.mission_time_f64', 'glass.dgn_alt_geod_f64'(米), 'glass.dgn_speed_f64'(米/秒),
 *              'glass.predict_dgn_r_lla_v3': [lat(弧度), lon(弧度), alt(米)],
 *              'glass.prop_dgn_r_ecef_v3': [[x,y,z](米), ...]（轨道传播序列，约 60s 一点） }
 *
 * 列表策略对齐官网：零值/垫上任务仍出现在按钮列表（listed）；
 * 渲染轨迹仅对 active 且高度足够的条目启用（showTrack）。
 */
var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')

var REQUEST_TIMEOUT = 15000
var RAD2DEG = 180 / Math.PI
var EARTH_RADIUS_M = 6378137
/** 官网 threed.js：星舰 altitude < 500 时隐藏轨迹 */
var STARSHIP_TRACK_MIN_ALT_M = 500

/**
 * 在飞判定阈值：星舰载荷在任务间歇期仍会持续生成（gps_time 跟随 generation_time
 * 推进），但轨迹窗口停留在上次任务/演练时刻、speed 归零、位置冻结。
 * 双保险：
 *   1) 轨迹末点相对 gps_time 落后 > 1h → 管线在推时间戳、轨迹已停（当前实测形态）
 *   2) 轨迹末点相对墙钟落后 > 1h → gps_time 与轨迹一并冻结，或 Worker KV 回灌陈旧包
 * GPS 秒 → Unix 秒近似偏移（忽略闰秒，对 1h 阈值无影响）。
 * 任务真正开始后官网数据流恢复滚动，下一轮轮询即自动上线。
 */
var STARSHIP_STALE_SEC = 3600
var GPS_TO_UNIX_SEC = 315964800

/** ECEF（米）→ 地心经纬度（度）+ 近似高度（米） */
function ecefToLatLngAlt(p) {
  var x = p[0], y = p[1], z = p[2]
  var r = Math.sqrt(x * x + y * y + z * z)
  return [
    Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG,
    Math.atan2(y, x) * RAD2DEG,
    r - EARTH_RADIUS_M
  ]
}

/** 星舰轨迹是否仍视为在飞（相对 gps_time + 相对墙钟） */
function isStarshipTrackActive(gpsTime, lastTrajT) {
  if (!(lastTrajT > 0)) return false
  if (gpsTime > 0 && gpsTime - lastTrajT > STARSHIP_STALE_SEC) return false
  var wallAge = Date.now() / 1000 - (lastTrajT + GPS_TO_UNIX_SEC)
  if (wallAge > STARSHIP_STALE_SEC) return false
  return true
}

function getWorkerBase() {
  var base = config && config.workerProxyUrl && String(config.workerProxyUrl).trim()
  return base ? base.replace(/\/$/, '') : ''
}

/** 飞行器 id → 展示名（与官网 getDisplayName 逻辑一致，兜底大写原始 id） */
function displayName(id) {
  var m
  if ((m = /^crew(\d+)$/.exec(id))) return 'CREW-' + m[1]
  if ((m = /^crs(\d+)$/.exec(id))) return 'CRS-' + m[1]
  var shipMap = { ship39: 'FLIGHT 12', ship40: 'FLIGHT 13' }
  if (shipMap[id]) return shipMap[id]
  if ((m = /^ship(\d+)$/.exec(id))) return 'SHIP ' + m[1]
  return String(id || '').toUpperCase()
}

/** starship 风格条目；始终 listed（有 current），轨迹按高度/新鲜度决定 */
function parseStarshipEntry(id, v, fetchedAt) {
  var cur = v.current
  if (!cur || !isFinite(cur.latitude) || !isFinite(cur.longitude)) return null
  var traj = []
  var track = []
  if (Array.isArray(v.trajectory)) {
    for (var i = 0; i < v.trajectory.length; i++) {
      var p = v.trajectory[i]
      if (!p || !isFinite(p.latitude) || !isFinite(p.longitude)) continue
      var alt = isFinite(p.altitude) ? +p.altitude : 0
      traj.push({ t: +p.time || 0, lat: +p.latitude, lng: +p.longitude, alt: alt })
      track.push([+p.latitude, +p.longitude, alt])
    }
  }
  var gpsTime = isFinite(cur.gps_time) ? +cur.gps_time : 0
  var lastTrajT = traj.length ? traj[traj.length - 1].t : 0
  var altM = isFinite(cur.altitude) ? +cur.altitude : 0
  var speedMs = isFinite(cur.speed) ? +cur.speed : 0
  var trackFresh = traj.length > 0 && isStarshipTrackActive(gpsTime, lastTrajT)
  // 对齐官网：alt < 500m 不画轨迹（垫上/低空避免乱飞弹道）
  var showTrack = trackFresh && altM >= STARSHIP_TRACK_MIN_ALT_M
  var active = trackFresh || altM > 10 || speedMs > 1
  return {
    id: id,
    label: displayName(id),
    group: 'starship',
    listed: true,
    active: active,
    showTrack: showTrack,
    gpsTime: gpsTime,
    missionTime: isFinite(cur.mission_time) ? +cur.mission_time : 0,
    altitudeM: altM,
    speedMs: speedMs,
    lat: +cur.latitude,
    lng: +cur.longitude,
    traj: showTrack ? traj : [],
    track: showTrack ? track : [],
    stepSec: 0,
    fetchedAt: fetchedAt
  }
}

/** dragon 风格条目（含零值任务，供列表展示） */
function parseDragonEntry(id, v, fetchedAt) {
  var lla = v['glass.predict_dgn_r_lla_v3']
  if (!Array.isArray(lla) || lla.length < 2) return null
  var mission = +v['glass.dragon.mission_time_f64'] || 0
  var altM = +v['glass.dgn_alt_geod_f64'] || 0
  var speed = +v['glass.dgn_speed_f64'] || 0
  var lat = lla[0] * RAD2DEG
  var lng = lla[1] * RAD2DEG
  // 全零载荷 = 任务未开始/已结束：官网仍展示按钮，遥测为 0
  var isZero = !mission && !altM && !lla[0] && !lla[1]
  var track = []
  var stepSec = 0
  var prop = v['glass.prop_dgn_r_ecef_v3']
  if (!isZero && Array.isArray(prop)) {
    for (var i = 0; i < prop.length; i++) {
      var p = prop[i]
      if (Array.isArray(p) && p.length >= 3) track.push(ecefToLatLngAlt(p))
    }
    if (prop.length >= 2 && speed > 0) {
      var dx = prop[1][0] - prop[0][0]
      var dy = prop[1][1] - prop[0][1]
      var dz = prop[1][2] - prop[0][2]
      stepSec = Math.sqrt(dx * dx + dy * dy + dz * dz) / speed
    }
  }
  var issLat = null
  var issLng = null
  var issAltM = null
  var issTrack = []
  var iss = v['glass.predict_iss_r_lla_v3']
  if (!isZero && Array.isArray(iss) && iss.length >= 2 && (iss[0] || iss[1])) {
    issLat = iss[0] * RAD2DEG
    issLng = iss[1] * RAD2DEG
    if (isFinite(iss[2])) issAltM = +iss[2]
  }
  // 与龙飞船同一套传播序列，保证 1Hz 插值时 ISS/Dragon 同步走
  var issProp = v['glass.prop_iss_r_ecef_v3']
  if (!isZero && Array.isArray(issProp)) {
    for (var j = 0; j < issProp.length; j++) {
      var ip = issProp[j]
      if (Array.isArray(ip) && ip.length >= 3) issTrack.push(ecefToLatLngAlt(ip))
    }
  }
  return {
    id: id,
    label: displayName(id),
    group: 'dragon',
    listed: true,
    active: !isZero,
    showTrack: !isZero && track.length >= 2,
    gpsTime: +v['glass.dragon.gps_time_f64'] || 0,
    missionTime: mission,
    altitudeM: altM,
    speedMs: speed,
    lat: lat,
    lng: lng,
    issLat: issLat,
    issLng: issLng,
    issAltM: issAltM,
    issTrack: issTrack,
    traj: [],
    track: track,
    stepSec: stepSec,
    fetchedAt: fetchedAt
  }
}

/** 解析 Worker 返回的 { starship, dragon } 合并载荷为飞行器数组（含 listed 零值） */
function parsePayload(payload) {
  var vehicles = []
  var fetchedAt = Date.now()
  var groups = ['starship', 'dragon']
  for (var g = 0; g < groups.length; g++) {
    var group = payload && payload[groups[g]]
    if (!group || typeof group !== 'object') continue
    var ids = Object.keys(group)
    for (var k = 0; k < ids.length; k++) {
      var id = ids[k]
      if (id === 'metadata') continue
      var v = group[id]
      if (!v || typeof v !== 'object') continue
      var parsed = null
      if (v.current) parsed = parseStarshipEntry(id, v, fetchedAt)
      else if (Array.isArray(v['glass.predict_dgn_r_lla_v3'])) parsed = parseDragonEntry(id, v, fetchedAt)
      if (parsed) vehicles.push(parsed)
    }
  }
  return vehicles
}

/** 拉取遥测；无任何 listed 飞行器时 reject（页面据此回退模拟模式） */
function fetchVehicles() {
  var base = getWorkerBase()
  if (!base) return Promise.reject(new Error('未配置 workerProxyUrl'))
  return httpRequest.requestJson({
    url: base + '/vehicle-tracker',
    method: 'GET',
    timeout: REQUEST_TIMEOUT
  }).then(function (res) {
    if (!res.ok) throw (res.error || new Error('request failed'))
    var data = res.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch (e) { throw new Error('bad json') }
    }
    if (!data || typeof data !== 'object') throw new Error('bad payload')
    var vehicles = parsePayload(data)
    if (!vehicles.length) throw new Error('no vehicles')
    return vehicles
  })
}

function lerpLatLng(a, b, k) {
  var dLng = ((b[1] - a[1] + 540) % 360) - 180
  var aAlt = a.length > 2 ? +a[2] : 0
  var bAlt = b.length > 2 ? +b[2] : 0
  return {
    lat: a[0] + (b[0] - a[0]) * k,
    lng: ((a[1] + dLng * k + 540) % 360) - 180,
    alt: aAlt + (bAlt - aAlt) * k
  }
}

/**
 * 两次轮询之间的位置插值（经度均取最短路径）：
 * 1. starship：目标 GPS 时刻落在带时间戳的轨迹区间内 → 线性插值
 * 2. dragon：沿 ECEF 传播轨迹按估算的点间隔（stepSec）推进
 * 3. 兜底：current 静态位置
 */
function _interpTrack(track, stepSec, extra, fallbackLat, fallbackLng, fallbackAlt) {
  if (stepSec > 0 && track && track.length >= 2 && extra > 0) {
    var idx = extra / stepSec
    var maxIdx = track.length - 1
    if (idx >= maxIdx) {
      var last = track[maxIdx]
      return { lat: last[0], lng: last[1], alt: last[2] != null ? last[2] : (fallbackAlt || 0) }
    }
    var j = Math.floor(idx)
    return lerpLatLng(track[j], track[j + 1], idx - j)
  }
  return { lat: fallbackLat, lng: fallbackLng, alt: fallbackAlt || 0 }
}

function interpPosition(v, nowMs) {
  if (!v) return { lat: 0, lng: 0, alt: 0 }
  if (!v.active) {
    return { lat: v.lat, lng: v.lng, alt: v.altitudeM || 0 }
  }
  var extra = (nowMs - v.fetchedAt) / 1000
  var target = v.gpsTime + extra
  var traj = v.traj
  if (traj && traj.length >= 2 && target >= traj[0].t && target <= traj[traj.length - 1].t) {
    for (var i = 0; i < traj.length - 1; i++) {
      if (target >= traj[i].t && target <= traj[i + 1].t) {
        var span = traj[i + 1].t - traj[i].t || 1
        var k = (target - traj[i].t) / span
        return lerpLatLng(
          [traj[i].lat, traj[i].lng, traj[i].alt || 0],
          [traj[i + 1].lat, traj[i + 1].lng, traj[i + 1].alt || 0],
          k
        )
      }
    }
  }
  return _interpTrack(v.track, v.stepSec, extra, v.lat, v.lng, v.altitudeM || 0)
}

/** ISS 与龙飞船共用 stepSec / fetchedAt，沿 prop_iss ECEF 同步插值 */
function interpIssPosition(v, nowMs) {
  if (!v) return null
  if (!isFinite(v.issLat) || !isFinite(v.issLng)) return null
  var extra = (nowMs - v.fetchedAt) / 1000
  return _interpTrack(
    v.issTrack,
    v.stepSec,
    extra,
    v.issLat,
    v.issLng,
    v.issAltM != null ? v.issAltM : 420000
  )
}

// ========== 格式化（对齐官网 threed.js：无秒、整数 km） ==========

function pad2(n) { return String(n).padStart(2, '0') }

function fmtThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 任务时间（秒）→ 'T+ 4D 16:19'（官网无秒） */
function fmtMissionTime(sec) {
  if (!isFinite(sec) || sec < 0) return 'T+ 0D 00:00'
  var s = Math.floor(sec)
  var d = Math.floor(s / 86400); s -= d * 86400
  var h = Math.floor(s / 3600); s -= h * 3600
  var m = Math.floor(s / 60)
  return 'T+ ' + d + 'D ' + pad2(h) + ':' + pad2(m)
}

/** 速度（米/秒）→ '27,580 KM/H'；官网钳制异常值到 0 */
function fmtSpeed(ms) {
  if (ms == null || !isFinite(ms)) return '--'
  var kmh = ms * 3.6
  if (kmh < 0 || kmh > 40000) kmh = 0
  return fmtThousands(kmh) + ' KM/H'
}

/** 高度（米）→ '418 KM'；官网钳制异常值到 0 */
function fmtAltitude(m) {
  if (m == null || !isFinite(m)) return '--'
  var km = m / 1000
  if (km < 0 || km > 2000) km = 0
  return fmtThousands(km) + ' KM'
}

// ========== 模拟兜底 ==========

/**
 * 无真实遥测时构造单个模拟飞行器。
 * @param computePos (tMs) => { lat, lon, alt(km), vel(km/s) }（页面的圆轨道模型）
 * @param simStartMs 任务时间 T0（页面加载时刻，与 LIVE TELEMETRY 面板一致）
 */
function buildSimulated(computePos, simStartMs) {
  var nowMs = Date.now()
  var track = []
  // 地面轨迹：前后各 45 分钟，60s 一点
  for (var dt = -45 * 60000; dt <= 45 * 60000; dt += 60000) {
    var p = computePos(nowMs + dt)
    track.push([p.lat, p.lon, p.alt * 1000])
  }
  var cur = computePos(nowMs)
  return {
    id: 'sim1',
    label: 'STARLINK V2 · SIM',
    group: 'starship',
    listed: true,
    active: true,
    showTrack: true,
    sim: true,
    simStartMs: simStartMs,
    lat: cur.lat,
    lng: cur.lon,
    altitudeM: cur.alt * 1000,
    speedMs: cur.vel * 1000,
    track: track,
    traj: []
  }
}

module.exports = {
  fetchVehicles: fetchVehicles,
  parsePayload: parsePayload,
  interpPosition: interpPosition,
  interpIssPosition: interpIssPosition,
  buildSimulated: buildSimulated,
  fmtMissionTime: fmtMissionTime,
  fmtSpeed: fmtSpeed,
  fmtAltitude: fmtAltitude,
  displayName: displayName,
  STARSHIP_TRACK_MIN_ALT_M: STARSHIP_TRACK_MIN_ALT_M
}
