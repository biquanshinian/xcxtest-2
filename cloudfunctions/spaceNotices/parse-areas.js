/**
 * SPACE_NOTICES_FEATURE — NOTAM / NAVWARNING 坐标块 → areas[[[lon,lat],...]]
 *
 * 支持：
 * - 紧凑 DDMMSS：243400N0910100W
 * - 空格 DDMM（FAA E 段常见）：2338S 07500E / 10020E
 * - 连字符 DMS：38-30-00N 100-15-00E
 * - 半球在前：N383012 E1001518
 * - 度分秒符号：N38°30'12" E100°15'18"
 * - 两点坐标 → parseLinesFromRawText 线段（无法成面）
 * - 多危险区：TO BEGINNING / AREA A 切开，避免连成一块
 *
 * 自动成图链路：rawText → parseAreasFromRawText / parseLinesFromRawText → notice.areas / centerline
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

function pushPair(out, lat, lon) {
  if (lat == null || lon == null) return
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return
  out.push([lon, lat])
}

function extractSpacedPairs(text) {
  const out = []
  const spaced = /(\d{4,7}(?:\.\d+)?[NS])(?:\s*[,;]\s*|\s+)(\d{4,7}(?:\.\d+)?[EW])/gi
  let m
  while ((m = spaced.exec(text))) pushPair(out, dmsTokenToDeg(m[1]), dmsTokenToDeg(m[2]))
  return out
}

function extractCompactPairs(text) {
  const out = []
  const compact = /(\d{4,7}(?:\.\d+)?[NS])(\d{5,7}(?:\.\d+)?[EW])(?!\d)/gi
  let m
  while ((m = compact.exec(text))) pushPair(out, dmsTokenToDeg(m[1]), dmsTokenToDeg(m[2]))
  return out
}

function dmsPartsToDeg(deg, min, sec, hemi) {
  const d = Number(deg)
  const m = Number(min)
  const s = sec == null || sec === '' ? 0 : Number(sec)
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  if (m >= 60 || s >= 60) return null
  let val = d + m / 60 + s / 3600
  const h = String(hemi || '').toUpperCase()
  if (h === 'S' || h === 'W') val = -val
  return val
}

function extractHyphenPairs(text) {
  const out = []
  // 38-30-12N 100-15-18E / 38-30N 100-15E
  const re =
    /(\d{1,2})-(\d{1,2})(?:-(\d{1,2}(?:\.\d+)?))?([NS])\s*[,;]?\s*(\d{1,3})-(\d{1,2})(?:-(\d{1,2}(?:\.\d+)?))?([EW])/gi
  let m
  while ((m = re.exec(text))) {
    pushPair(out, dmsPartsToDeg(m[1], m[2], m[3], m[4]), dmsPartsToDeg(m[5], m[6], m[7], m[8]))
  }
  return out
}

function extractHemiFirstPairs(text) {
  const out = []
  // N383012 E1001518 / N38.50 E100.25
  const re = /([NS])\s*(\d{2,7}(?:\.\d+)?)\s*[,;]?\s*([EW])\s*(\d{3,7}(?:\.\d+)?)/gi
  let m
  while ((m = re.exec(text))) {
    if (String(m[2]).indexOf('.') >= 0 || String(m[4]).indexOf('.') >= 0) {
      let lat = Number(m[2])
      let lon = Number(m[4])
      if (String(m[1]).toUpperCase() === 'S') lat = -lat
      if (String(m[3]).toUpperCase() === 'W') lon = -lon
      pushPair(out, lat, lon)
      continue
    }
    const latTok = String(m[2]) + String(m[1])
    const lonTok = String(m[4]) + String(m[3])
    pushPair(out, dmsTokenToDeg(latTok), dmsTokenToDeg(lonTok))
  }
  return out
}

function extractDecimalPairs(text) {
  const out = []
  const re = /(\d{1,2}\.\d+)([NS])\s*[,;]?\s*(\d{1,3}\.\d+)([EW])/gi
  let m
  while ((m = re.exec(text))) {
    let lat = Number(m[1])
    let lon = Number(m[3])
    if (String(m[2]).toUpperCase() === 'S') lat = -lat
    if (String(m[4]).toUpperCase() === 'W') lon = -lon
    pushPair(out, lat, lon)
  }
  return out
}

function extractDmsSymbolPairs(text) {
  const out = []
  // N38°30'12"E100°15'18"  /  38°30'12"N 100°15'18"E
  const hemiFirst =
    /([NS])\s*(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['′]?\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([EW])\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]?\s*(\d{1,2}(?:\.\d+)?)\s*["″]?/gi
  const hemiLast =
    /(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['′]?\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NS])\s*[,;\s]+\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]?\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([EW])/gi
  let m
  while ((m = hemiFirst.exec(text))) {
    pushPair(out, dmsPartsToDeg(m[2], m[3], m[4], m[1]), dmsPartsToDeg(m[6], m[7], m[8], m[5]))
  }
  if (out.length >= 2) return out
  while ((m = hemiLast.exec(text))) {
    pushPair(out, dmsPartsToDeg(m[1], m[2], m[3], m[4]), dmsPartsToDeg(m[5], m[6], m[7], m[8]))
  }
  return out
}

function extractCoordPairs(text) {
  const src = String(text || '')
  const cands = [
    extractSpacedPairs(src),
    extractCompactPairs(src),
    extractHyphenPairs(src),
    extractHemiFirstPairs(src),
    extractDecimalPairs(src),
    extractDmsSymbolPairs(src)
  ]
  let best = []
  for (let i = 0; i < cands.length; i++) {
    if (cands[i].length > best.length) best = cands[i]
  }
  return best
}

function nearPair(a, b, eps) {
  const t = eps == null ? 1e-5 : eps
  return !!a && !!b && Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t
}

function dedupePairs(ring) {
  const out = []
  if (!Array.isArray(ring)) return out
  ring.forEach((p) => {
    if (!p || p.length < 2) return
    const prev = out[out.length - 1]
    if (prev && nearPair(prev, p)) return
    out.push([p[0], p[1]])
  })
  return out
}

function closeRing(ring) {
  if (!ring.length) return ring
  if (!nearPair(ring[0], ring[ring.length - 1])) ring.push([ring[0][0], ring[0][1]])
  return ring
}

/** 去掉 Q/A/B/C/D/F/G 头，优先用 E) 段，避免把情报区中心点画进边界 */
function isolateCoordText(text) {
  const src = String(text || '')
  const e = src.match(/(?:^|\n)E\)\s*([\s\S]*?)(?=\n[FG]\)|$)/i)
  if (e && e[1] && /[NSWE]/i.test(e[1]) && e[1].length >= 16) return e[1]
  return src.replace(/(?:^|\n)[ABCDFGHQ]\)[^\n]*/gi, '\n')
}

/** 多个危险区：按 TO BEGINNING / AREA A / 区域一 切开，避免连成一块 */
function splitAreaChunks(text) {
  const src = String(text || '')
  const byClose = src
    .split(/\bTO\s+(?:THE\s+)?(?:BEGINNING|POINT OF ORIGIN|ORIGIN)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && /[NSWE]/i.test(s))
  if (byClose.length >= 2) return byClose
  const byArea = src
    .split(/\b(?:AREA\s+(?:[A-Z]|\d+)\b|区域[一二三四五六七八]|空域[一二三四五六])\s*[:.\-]?\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && /[NSWE]/i.test(s))
  if (byArea.length >= 2) return byArea
  return [src]
}

function pairsForChunk(chunk) {
  return dedupePairs(extractCoordPairs(chunk))
}

/**
 * @param {string} rawText
 * @returns {number[][][]} GeoJSON-like MultiPolygon rings as [[[lon,lat],...]]
 */
function parseAreasFromRawText(rawText) {
  const isolated = isolateCoordText(rawText)
  if (!String(isolated || '').trim()) return []
  const chunks = splitAreaChunks(isolated)
  const rings = []
  chunks.forEach((chunk) => {
    const pts = pairsForChunk(chunk)
    if (pts.length < 3) return
    rings.push(closeRing(pts.slice()))
  })
  if (rings.length) return rings
  const pts = pairsForChunk(isolated)
  if (pts.length < 3) return []
  return [closeRing(pts.slice())]
}

/**
 * 两点坐标无法成面，按线段返回 [[[lon,lat],[lon,lat]]]
 */
function parseLinesFromRawText(rawText) {
  const isolated = isolateCoordText(rawText)
  if (!String(isolated || '').trim()) return []
  const chunks = splitAreaChunks(isolated)
  const lines = []
  const consider = chunks.length ? chunks : [isolated]
  consider.forEach((chunk) => {
    const pts = pairsForChunk(chunk)
    if (pts.length === 2) lines.push(pts.slice())
  })
  if (lines.length) return lines
  const pts = pairsForChunk(isolated)
  if (pts.length === 2) return [pts.slice()]
  return []
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function rdp(points, eps) {
  if (!points || points.length <= 2) return (points || []).slice()
  let maxD = -1
  let idx = 0
  const a = points[0]
  const b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegDist(points[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps)
    const right = rdp(points.slice(idx), eps)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

/** 全球列表抽稀：保拐点，避免等步长把折角削掉 */
function simplifyRing(ring, maxPts) {
  const cap = Math.max(8, Number(maxPts) || 48)
  if (!Array.isArray(ring) || ring.length <= cap) return ring || []
  const closed = ring.length >= 2 && nearPair(ring[0], ring[ring.length - 1])
  const pts = closed ? ring.slice(0, -1) : ring.slice()
  let eps = 0.0003
  let out = rdp(pts, eps)
  while (out.length > cap && eps < 0.08) {
    eps *= 1.8
    out = rdp(pts, eps)
  }
  if (out.length > cap) {
    const step = Math.max(1, Math.ceil(out.length / cap))
    const slim = []
    for (let i = 0; i < out.length; i += step) slim.push(out[i])
    if (slim[slim.length - 1] !== out[out.length - 1]) slim.push(out[out.length - 1])
    out = slim
  }
  if (closed && out.length && !nearPair(out[0], out[out.length - 1])) out.push([out[0][0], out[0][1]])
  return out
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
  parseLinesFromRawText,
  areasToMapPolygons,
  dmsCompactToDeg,
  dmsTokenToDeg,
  extractCoordPairs,
  simplifyRing,
  isolateCoordText
}
