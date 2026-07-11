/**
 * 空间站轨道计算工具
 * 基于 satellite.js (SGP4) 计算空间站实时位置、轨道线、轨道参数
 * 与 monitor-pages 分包同目录，满足主包「仅主包使用的 JS」规则
 */
const satellite = require('./libs/satellite.min.js')

function safeDegreesLat(rad) {
  if (!Number.isFinite(rad)) return 0
  try {
    return satellite.degreesLat(rad)
  } catch (e) {
    return 0
  }
}

function safeDegreesLong(rad) {
  if (!Number.isFinite(rad)) return 0
  try {
    return satellite.degreesLong(rad)
  } catch (e) {
    return 0
  }
}

// 空间站 NORAD ID → SpaceDevs API station ID 映射
const NORAD_MAP = {
  4: '25544',   // ISS
  18: '48274'   // 天宫
}

/**
 * 从 TLE 两行数据创建 satrec 对象
 */
function createSatrec(line1, line2) {
  if (!line1 || !line2) return null
  try {
    return satellite.twoline2satrec(line1, line2)
  } catch (e) {
    return null
  }
}

/**
 * 计算指定时刻的地理坐标（经纬度 + 高度）
 * @returns {{ lat, lng, alt, velocity }} 或 null
 */
function getPositionAt(satrec, date) {
  if (!satrec) return null
  try {
    const posVel = satellite.propagate(satrec, date)
    if (!posVel.position) return null
    const gmst = satellite.gstime(date)
    const geo = satellite.eciToGeodetic(posVel.position, gmst)
    const lat = safeDegreesLat(geo.latitude)
    const lng = safeDegreesLong(geo.longitude)
    const alt = geo.height // km
    // 计算速度（km/s）
    const vel = posVel.velocity
    const speed = vel ? Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) : 0
    return { lat, lng, alt, speed }
  } catch (e) {
    return null
  }
}

/**
 * 计算当前位置
 */
function getCurrentPosition(satrec) {
  return getPositionAt(satrec, new Date())
}

/**
 * 计算轨道线（未来 N 分钟的轨迹点）
 * 处理经度 ±180° 跨越，自动拆分为多段 polyline
 * @param {Object} satrec
 * @param {Number} totalMinutes 总时长（默认 92 分钟 ≈ 一圈）
 * @param {Number} stepSeconds 采样间隔秒数（默认 30 秒）
 * @returns {Array<Array<{lat, lng}>>} 多段轨道线
 */
function computeOrbitPath(satrec, totalMinutes, stepSeconds) {
  if (!satrec) return []
  totalMinutes = totalMinutes || 92
  stepSeconds = stepSeconds || 30
  const now = new Date()
  const segments = []
  let currentSegment = []
  let prevLng = null

  const totalSteps = Math.ceil((totalMinutes * 60) / stepSeconds)
  for (let i = 0; i <= totalSteps; i++) {
    const time = new Date(now.getTime() + i * stepSeconds * 1000)
    const pos = getPositionAt(satrec, time)
    if (!pos) continue

    // 检测经度跨越 ±180°（跳变超过 180° 视为跨越）
    if (prevLng !== null && Math.abs(pos.lng - prevLng) > 180) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment)
      }
      currentSegment = []
    }
    currentSegment.push({ latitude: pos.lat, longitude: pos.lng })
    prevLng = pos.lng
  }
  if (currentSegment.length > 1) {
    segments.push(currentSegment)
  }
  return segments
}

/**
 * 计算过去 N 分钟的已飞过轨迹
 */
function computePastOrbitPath(satrec, pastMinutes, stepSeconds) {
  if (!satrec) return []
  pastMinutes = pastMinutes || 45
  stepSeconds = stepSeconds || 30
  const now = new Date()
  const segments = []
  let currentSegment = []
  let prevLng = null

  const totalSteps = Math.ceil((pastMinutes * 60) / stepSeconds)
  for (let i = totalSteps; i >= 0; i--) {
    const time = new Date(now.getTime() - i * stepSeconds * 1000)
    const pos = getPositionAt(satrec, time)
    if (!pos) continue

    if (prevLng !== null && Math.abs(pos.lng - prevLng) > 180) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment)
      }
      currentSegment = []
    }
    currentSegment.push({ latitude: pos.lat, longitude: pos.lng })
    prevLng = pos.lng
  }
  if (currentSegment.length > 1) {
    segments.push(currentSegment)
  }
  return segments
}

/**
 * 计算详细轨道参数
 * @returns {{ period, inclination, apogee, perigee, meanMotion, eccentricity, epoch }}
 */
function getOrbitalParams(satrec) {
  if (!satrec) return null
  try {
    // 轨道倾角（弧度 → 度）
    const inclination = (satrec.inclo * 180) / Math.PI
    // 离心率
    const eccentricity = satrec.ecco
    // 平均运动（圈/天）
    const meanMotionRadPerMin = satrec.no // rad/min
    const meanMotionRevPerDay = (meanMotionRadPerMin * 1440) / (2 * Math.PI)
    // 轨道周期（分钟）
    const period = 1440 / meanMotionRevPerDay
    // 半长轴 a（km）：由平均运动推算
    const mu = 398600.4418 // 地球引力常数 km³/s²
    const n = meanMotionRadPerMin / 60 // rad/s
    const a = Math.pow(mu / (n * n), 1 / 3)
    // 近地点 / 远地点高度（km，减去地球半径 6371 km）
    const Re = 6371
    const perigee = a * (1 - eccentricity) - Re
    const apogee = a * (1 + eccentricity) - Re
    // TLE 历元
    const epochYear = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr
    const epochDay = satrec.epochdays
    const epochDate = new Date(Date.UTC(epochYear, 0, 1))
    epochDate.setTime(epochDate.getTime() + (epochDay - 1) * 86400000)
    const epochStr = `${epochDate.getUTCFullYear()}-${String(epochDate.getUTCMonth() + 1).padStart(2, '0')}-${String(epochDate.getUTCDate()).padStart(2, '0')}`

    return {
      period: Math.round(period * 10) / 10,           // 分钟
      inclination: Math.round(inclination * 100) / 100, // 度
      apogee: Math.round(apogee * 10) / 10,            // km
      perigee: Math.round(perigee * 10) / 10,           // km
      meanMotion: Math.round(meanMotionRevPerDay * 100) / 100, // 圈/天
      eccentricity: eccentricity.toFixed(7),
      epoch: epochStr
    }
  } catch (e) {
    return null
  }
}

/**
 * 计算空间站相对于观测者的仰角和方位角
 */
function getLookAngles(satrec, observerLat, observerLng, observerAlt) {
  if (!satrec) return null
  try {
    const now = new Date()
    const posVel = satellite.propagate(satrec, now)
    if (!posVel.position) return null
    const gmst = satellite.gstime(now)
    const DEG2RAD = Math.PI / 180
    const observerGd = {
      latitude: observerLat * DEG2RAD,
      longitude: observerLng * DEG2RAD,
      height: observerAlt || 0
    }
    const posEcf = satellite.eciToEcf(posVel.position, gmst)
    const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf)
    return {
      azimuth: Math.round((lookAngles.azimuth * 180 / Math.PI) * 10) / 10,
      elevation: Math.round((lookAngles.elevation * 180 / Math.PI) * 10) / 10,
      rangeSat: Math.round(lookAngles.rangeSat * 10) / 10 // km
    }
  } catch (e) {
    return null
  }
}

/**
 * 一次 propagate 同时返回位置 + 观测角（避免重复计算）
 */
function getPositionAndLookAngles(satrec, observerLat, observerLng, observerAlt) {
  if (!satrec) return null
  try {
    const now = new Date()
    const posVel = satellite.propagate(satrec, now)
    if (!posVel.position) return null
    const gmst = satellite.gstime(now)
    const geo = satellite.eciToGeodetic(posVel.position, gmst)
    const lat = safeDegreesLat(geo.latitude)
    const lng = safeDegreesLong(geo.longitude)
    const alt = geo.height
    const vel = posVel.velocity
    const speed = vel ? Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) : 0

    var azimuth = null, elevation = null, rangeSat = null
    if (observerLat !== undefined && observerLng !== undefined) {
      var DEG2RAD = Math.PI / 180
      var observerGd = {
        latitude: observerLat * DEG2RAD,
        longitude: observerLng * DEG2RAD,
        height: observerAlt || 0
      }
      var posEcf = satellite.eciToEcf(posVel.position, gmst)
      var look = satellite.ecfToLookAngles(observerGd, posEcf)
      azimuth = look.azimuth * 180 / Math.PI
      elevation = look.elevation * 180 / Math.PI
      rangeSat = look.rangeSat
    }
    return { lat: lat, lng: lng, alt: alt, speed: speed, azimuth: azimuth, elevation: elevation, rangeSat: rangeSat }
  } catch (e) {
    return null
  }
}

function isInSunlight(alt) {
  return alt > 200
}

function formatSpeed(speedKmPerSec) {
  if (!speedKmPerSec) return '--'
  return (speedKmPerSec * 3600).toFixed(0) // km/h
}

function formatAltitude(altKm) {
  if (!altKm && altKm !== 0) return '--'
  return altKm.toFixed(1)
}

function formatCoord(lat, lng) {
  if (lat === undefined || lng === undefined) return '--'
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`
}

module.exports = {
  NORAD_MAP,
  createSatrec,
  getPositionAt,
  getCurrentPosition,
  computeOrbitPath,
  computePastOrbitPath,
  getOrbitalParams,
  getLookAngles,
  getPositionAndLookAngles,
  isInSunlight,
  formatSpeed,
  formatAltitude,
  formatCoord
}
