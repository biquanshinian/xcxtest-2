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
 *   未在轨任务（如未发射的 crew/crs）载荷全零，须过滤。
 */
var config = require('../../../utils/config.js')
var httpRequest = require('./http-request.js')

var REQUEST_TIMEOUT = 15000
var RAD2DEG = 180 / Math.PI

/**
 * 在飞判定阈值：星舰载荷在任务间歇期仍会持续生成（gps_time 跟随 generation_time
 * 推进），但轨迹窗口停留在上次任务/演练时刻、speed 归零、位置冻结。
 * 双保险：
 *   1) 轨迹末点相对 gps_time 落后 > 1h → 管线在推时间戳、轨迹已停（当前实测形态）
 *   2) 轨迹末点相对墙钟落后 > 1h → gps_time 与轨迹一并冻结，或 Worker KV 回灌陈旧包
 * GPS 秒 → Unix 秒近似偏移（忽略闰秒，对 1h 阈值无影响）。
 * 任务真正开始后官网数据流恢复滚动，下一轮 15s 轮询即自动上线。
 */
var STARSHIP_STALE_SEC = 3600
var GPS_TO_UNIX_SEC = 315964800

/** ECEF（米）→ 地心经纬度（度）；展示用，无需大地纬度修正 */
function ecefToLatLng(p) {
  var x = p[0], y = p[1], z = p[2]
  return [
    Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG,
    Math.atan2(y, x) * RAD2DEG
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

/** starship 风格条目（current + trajectory，经纬度制）；非在飞任务返回 null */
function parseStarshipEntry(id, v, fetchedAt) {
  var cur = v.current
  if (!cur || !isFinite(cur.latitude) || !isFinite(cur.longitude)) return null
  var traj = []
  var track = []
  if (Array.isArray(v.trajectory)) {
    for (var i = 0; i < v.trajectory.length; i++) {
      var p = v.trajectory[i]
      if (!p || !isFinite(p.latitude) || !isFinite(p.longitude)) continue
      traj.push({ t: +p.time || 0, lat: +p.latitude, lng: +p.longitude })
      track.push([+p.latitude, +p.longitude])
    }
  }
  // 在飞判定：无轨迹，或轨迹相对 gps_time / 墙钟过旧 = 冻结/陈旧数据
  if (!traj.length) return null
  var gpsTime = isFinite(cur.gps_time) ? +cur.gps_time : 0
  var lastTrajT = traj[traj.length - 1].t
  if (!isStarshipTrackActive(gpsTime, lastTrajT)) return null
  return {
    id: id,
    label: displayName(id),
    group: 'starship',
    gpsTime: gpsTime,
    missionTime: isFinite(cur.mission_time) ? +cur.mission_time : 0,
    altitudeM: isFinite(cur.altitude) ? +cur.altitude : null,
    speedMs: isFinite(cur.speed) ? +cur.speed : null,
    lat: +cur.latitude,
    lng: +cur.longitude,
    traj: traj,
    track: track,
    stepSec: 0,
    fetchedAt: fetchedAt
  }
}

/** dragon 风格条目（glass.* 遥测键，弧度制 + ECEF 轨迹） */
function parseDragonEntry(id, v, fetchedAt) {
  var lla = v['glass.predict_dgn_r_lla_v3']
  if (!Array.isArray(lla) || lla.length < 2) return null
  var mission = +v['glass.dragon.mission_time_f64'] || 0
  var altM = +v['glass.dgn_alt_geod_f64'] || 0
  var speed = +v['glass.dgn_speed_f64'] || 0
  // 全零载荷 = 任务未开始/已结束（官网亦不展示）
  if (!mission && !altM && !lla[0] && !lla[1]) return null
  var track = []
  var stepSec = 0
  var prop = v['glass.prop_dgn_r_ecef_v3']
  if (Array.isArray(prop)) {
    for (var i = 0; i < prop.length; i++) {
      var p = prop[i]
      if (Array.isArray(p) && p.length >= 3) track.push(ecefToLatLng(p))
    }
    // 由首段弦长/速度估算轨迹点时间间隔，供两次轮询间沿轨迹推进
    if (prop.length >= 2 && speed > 0) {
      var dx = prop[1][0] - prop[0][0]
      var dy = prop[1][1] - prop[0][1]
      var dz = prop[1][2] - prop[0][2]
      stepSec = Math.sqrt(dx * dx + dy * dy + dz * dz) / speed
    }
  }
  return {
    id: id,
    label: displayName(id),
    group: 'dragon',
    gpsTime: +v['glass.dragon.gps_time_f64'] || 0,
    missionTime: mission,
    altitudeM: altM,
    speedMs: speed,
    lat: lla[0] * RAD2DEG,
    lng: lla[1] * RAD2DEG,
    traj: [],
    track: track,
    stepSec: stepSec,
    fetchedAt: fetchedAt
  }
}

/** 解析 Worker 返回的 { starship, dragon } 合并载荷为飞行器数组 */
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

/** 拉取遥测；无有效飞行器时 reject（页面据此回退模拟模式） */
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
  return {
    lat: a[0] + (b[0] - a[0]) * k,
    lng: ((a[1] + dLng * k + 540) % 360) - 180
  }
}

/**
 * 两次轮询之间的位置插值（经度均取最短路径）：
 * 1. starship：目标 GPS 时刻落在带时间戳的轨迹区间内 → 线性插值
 * 2. dragon：沿 ECEF 传播轨迹按估算的点间隔（stepSec）推进
 * 3. 兜底：current 静态位置
 */
function interpPosition(v, nowMs) {
  var extra = (nowMs - v.fetchedAt) / 1000
  var target = v.gpsTime + extra
  var traj = v.traj
  if (traj && traj.length >= 2 && target >= traj[0].t && target <= traj[traj.length - 1].t) {
    for (var i = 0; i < traj.length - 1; i++) {
      if (target >= traj[i].t && target <= traj[i + 1].t) {
        var span = traj[i + 1].t - traj[i].t || 1
        var k = (target - traj[i].t) / span
        return lerpLatLng([traj[i].lat, traj[i].lng], [traj[i + 1].lat, traj[i + 1].lng], k)
      }
    }
  }
  if (v.stepSec > 0 && v.track && v.track.length >= 2 && extra > 0) {
    var idx = extra / v.stepSec
    var maxIdx = v.track.length - 1
    if (idx >= maxIdx) return { lat: v.track[maxIdx][0], lng: v.track[maxIdx][1] }
    var j = Math.floor(idx)
    return lerpLatLng(v.track[j], v.track[j + 1], idx - j)
  }
  return { lat: v.lat, lng: v.lng }
}

// ========== 格式化 ==========

function pad2(n) { return String(n).padStart(2, '0') }

function fmtThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 任务时间（秒）→ 'T+ 4D 16:19:05' */
function fmtMissionTime(sec) {
  if (!isFinite(sec) || sec < 0) return 'T+ 0D 00:00:00'
  var s = Math.floor(sec)
  var d = Math.floor(s / 86400); s -= d * 86400
  var h = Math.floor(s / 3600); s -= h * 3600
  var m = Math.floor(s / 60); s -= m * 60
  return 'T+ ' + d + 'D ' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

/** 速度（米/秒）→ '27,580 KM/H' */
function fmtSpeed(ms) {
  if (ms == null || !isFinite(ms)) return '--'
  return fmtThousands(ms * 3.6) + ' KM/H'
}

/** 高度（米）→ '418 KM' */
function fmtAltitude(m) {
  if (m == null || !isFinite(m)) return '--'
  return fmtThousands(m / 1000) + ' KM'
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
    track.push([p.lat, p.lon])
  }
  var cur = computePos(nowMs)
  return {
    id: 'sim1',
    label: 'STARLINK V2 · SIM',
    sim: true,
    simStartMs: simStartMs,
    lat: cur.lat,
    lng: cur.lon,
    track: track,
    traj: []
  }
}

module.exports = {
  fetchVehicles: fetchVehicles,
  parsePayload: parsePayload,
  interpPosition: interpPosition,
  buildSimulated: buildSimulated,
  fmtMissionTime: fmtMissionTime,
  fmtSpeed: fmtSpeed,
  fmtAltitude: fmtAltitude,
  displayName: displayName
}
