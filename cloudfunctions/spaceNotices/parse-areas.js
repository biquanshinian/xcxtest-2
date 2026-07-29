/**
 * SPACE_NOTICES_FEATURE — NOTAM / NAVWARNING 坐标块 → areas[[[lon,lat],...]]
 *
 * 支持：
 * - 紧凑 DDMMSS：243400N0910100W
 * - 空格 DDMM（FAA E 段常见）：2338S 07500E / 10020E
 *
 * 自动成图链路：rawText → parseAreasFromRawText → notice.areas → 小程序 map polygons
 */

/**
 * 单点 DMS token → 十进制度
 * @param {string} token 如 243400N / 2338S / 07500E / 0910100W
 */
function dmsTokenToDeg(token) {
  const s = String(token || '').trim().toUpperCase()
  const m = s.match(/^(\d+)(?:\.(\d+))?([NSEW])$/)
  if (!m) return null
  const digits = m[1]
  const frac = m[2] ? Number('0.' + m[2]) : 0
  const hemi = m[3]
  let deg
  let min = 0
  let sec = 0
  const n = digits.length
  if (n === 4) {
    // DDMM
    deg = Number(digits.slice(0, 2))
    min = Number(digits.slice(2, 4))
  } else if (n === 5) {
    // DDDMM（经度常见）
    deg = Number(digits.slice(0, 3))
    min = Number(digits.slice(3, 5))
  } else if (n === 6) {
    // DDMMSS
    deg = Number(digits.slice(0, 2))
    min = Number(digits.slice(2, 4))
    sec = Number(digits.slice(4, 6))
  } else if (n === 7) {
    // DDDMMSS
    deg = Number(digits.slice(0, 3))
    min = Number(digits.slice(3, 5))
    sec = Number(digits.slice(5, 7))
  } else {
    return null
  }
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null
  if (min >= 60 || sec >= 60) return null
  let val = deg + min / 60 + sec / 3600 + frac / 60
  if (hemi === 'S' || hemi === 'W') val = -val
  return val
}

/** @deprecated 兼容旧导出名 */
function dmsCompactToDeg(token) {
  return dmsTokenToDeg(token)
}

function extractCoordPairs(text) {
  const out = []
  // 1) 必须有分隔（空格/逗号）：2338S 07500E；避免把 Q 行 2139S09259E999 当成分隔坐标
  const spaced = /(\d{4,7}(?:\.\d+)?[NS])(?:\s*[,;]\s*|\s+)(\d{4,7}(?:\.\d+)?[EW])/gi
  let m
  while ((m = spaced.exec(text))) {
    const lat = dmsTokenToDeg(m[1])
    const lon = dmsTokenToDeg(m[2])
    if (lat == null || lon == null) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    out.push([lon, lat])
  }
  if (out.length >= 3) return out

  // 2) 紧凑连写：243400N0910100W（无空格）。跳过 Q 行尾部 …E999 噪声：经度后紧跟多余数字则丢弃
  const compact = /(\d{4,7}(?:\.\d+)?[NS])(\d{5,7}(?:\.\d+)?[EW])(?!\d)/gi
  while ((m = compact.exec(text))) {
    const lat = dmsTokenToDeg(m[1])
    const lon = dmsTokenToDeg(m[2])
    if (lat == null || lon == null) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    out.push([lon, lat])
  }
  return out
}

function closeRing(ring) {
  if (!ring.length) return ring
  const [a0, a1] = ring[0]
  const [b0, b1] = ring[ring.length - 1]
  if (a0 !== b0 || a1 !== b1) ring.push([a0, a1])
  return ring
}

/**
 * @param {string} rawText
 * @returns {number[][][]} GeoJSON-like MultiPolygon rings as [[[lon,lat],...]]
 */
function parseAreasFromRawText(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return []
  const pts = extractCoordPairs(text)
  if (pts.length < 3) return []
  return [closeRing(pts.slice())]
}

/**
 * 微信 <map> polygons.points 使用 {latitude, longitude}
 * @param {number[][][]} areas
 */
function areasToMapPolygons(areas, style) {
  const strokeColor = (style && style.strokeColor) || '#FF453A'
  const fillColor = (style && style.fillColor) || '#FF453A33'
  const strokeWidth = (style && style.strokeWidth) || 1
  const list = Array.isArray(areas) ? areas : []
  return list
    .map((ring, idx) => {
      if (!Array.isArray(ring) || ring.length < 3) return null
      const points = ring.map((p) => ({
        longitude: Number(p[0]),
        latitude: Number(p[1])
      })).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      if (points.length < 3) return null
      return {
        id: idx,
        points,
        strokeWidth,
        strokeColor,
        fillColor
      }
    })
    .filter(Boolean)
}

module.exports = {
  parseAreasFromRawText,
  areasToMapPolygons,
  dmsCompactToDeg,
  dmsTokenToDeg,
  extractCoordPairs
}
