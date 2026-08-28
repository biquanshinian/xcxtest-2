/**
 * SPACE_NOTICES_FEATURE — notice.areas / trajectory → 微信 map polygons / polylines / marker
 *
 * 深浅主题用不同填充强度：浅色底图上低透明度填充几乎看不见，需要加深。
 */

// 小程序 require 不支持 .json（会被补成 .json.js 而整模块加载失败），轨迹副本必须是 .js
const SITE_TRAJ = require('./flight13-trajectory.js')
const { resolvePadCoords } = require('./pad-coords.js')
const { pickLocalized, isContentLangEn } = require('../../../../utils/locale.js')
const { localizeMissionTitle } = require('../../../../utils/mission-title-i18n.js')
const SITE_TRAJ_COLOR = (SITE_TRAJ && SITE_TRAJ.color) || '#ffcc00'
const SITE_TRAJ_VERSION = Number((SITE_TRAJ && SITE_TRAJ.version) || 1)
const FLIGHT13_LL2_ID = 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2'

/** 与参考站图例一致：NOTAM 红 / NOTMAR 蓝 / ADP 黄 */
const TYPE_BASE_COLOR = {
  NOTAM: '#FF3B30',
  TFR: '#FF9500',
  NAVWARNING: '#0A84FF',
  BNM: '#0A84FF',
  LNM: '#0A84FF',
  ADP_LINK_FILE: '#ffcc00'
}

const CANCELLED_COLOR = '#8E8E93'
const SOON_COLOR = '#FF9500'

/** 填充透明度（16 进制后缀）：浅色底图需要更实 */
const FILL_ALPHA = {
  dark: { normal: '40', selected: '73', dimmed: '1F' },
  light: { normal: '5C', selected: '99', dimmed: '2B' }
}

/** 旧版跨洋假走廊，客户端也过滤 */
const SKIP_NOTICE_KEYS = {
  'adp-aha-starship-flight-13-demo': true
}

/** 经度跨度过大的环 = 演示粗管/坏数据，不填色（会盖住精细多边形） */
const MAX_RING_LON_SPAN = 55

function normalizeType(type) {
  return String(type || 'NOTAM').toUpperCase()
}

function baseColorForType(type) {
  return TYPE_BASE_COLOR[normalizeType(type)] || TYPE_BASE_COLOR.NOTAM
}

/**
 * @param {string} type
 * @param {{ light?: boolean, state?: 'normal'|'selected'|'dimmed', cancelled?: boolean, soon?: boolean }} [opts]
 */
function styleForType(type, opts) {
  const o = opts || {}
  const alpha = FILL_ALPHA[o.light ? 'light' : 'dark']
  const state = o.state || 'normal'
  const color = o.cancelled ? CANCELLED_COLOR : o.soon ? SOON_COLOR : baseColorForType(type)
  return {
    strokeColor: color,
    fillColor: color + (alpha[state] || alpha.normal)
  }
}

function toLonLatPair(p) {
  if (!p) return null
  const lon = Number(Array.isArray(p) ? p[0] : p.longitude)
  const lat = Number(Array.isArray(p) ? p[1] : p.latitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { longitude: lon, latitude: lat }
}

function ringLonSpan(ring) {
  let minLon = Infinity
  let maxLon = -Infinity
  for (let i = 0; i < ring.length; i++) {
    const lon = Number(Array.isArray(ring[i]) ? ring[i][0] : ring[i] && ring[i].longitude)
    if (!Number.isFinite(lon)) continue
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon)) return 0
  return maxLon - minLon
}

function shouldSkipNotice(n) {
  const key = String((n && n.noticeKey) || '')
  return !!(SKIP_NOTICE_KEYS[key] || /flight-13-demo$/i.test(key))
}

/** 可画几何（≥3 点且非跨洋粗环）的环 */
function drawableRings(notice) {
  const rings = Array.isArray(notice && notice.areas) ? notice.areas : []
  return rings.filter(
    (ring) => Array.isArray(ring) && ring.length >= 3 && ringLonSpan(ring) <= MAX_RING_LON_SPAN
  )
}

function hasGeometry(notice) {
  return drawableRings(notice).length > 0
}

/**
 * @param {object[]} notices
 * @param {object|null} enabledTypes
 * @param {{ light?: boolean, selectedKey?: string }} [opts]
 */
function buildPolygonsFromNotices(notices, enabledTypes, opts) {
  const allow = enabledTypes && typeof enabledTypes === 'object' ? enabledTypes : null
  const o = opts || {}
  const selectedKey = o.selectedKey ? String(o.selectedKey) : ''
  const polygons = []
  let id = 1
  ;(notices || []).forEach((n) => {
    if (shouldSkipNotice(n)) return
    const t = normalizeType(n.type)
    if (allow && allow[t] === false) return
    const isSelected = !!selectedKey && String(n.noticeKey) === selectedKey
    const state = selectedKey ? (isSelected ? 'selected' : 'dimmed') : 'normal'
    const soon = !n.cancelled && n.statusTone === 'soon'
    const style = styleForType(t, { light: o.light, state, cancelled: !!n.cancelled, soon })
    if (n.cancelled || n.statusTone === 'off') return
    drawableRings(n).forEach((ring) => {
      const points = ring.map(toLonLatPair).filter(Boolean)
      if (points.length < 3) return
      polygons.push({
        id: id++,
        noticeKey: String(n.noticeKey || ''),
        points,
        strokeWidth: o.preview ? (isSelected ? 5 : 3) : isSelected ? 4 : t === 'ADP_LINK_FILE' ? 2 : 1,
        strokeColor: style.strokeColor,
        fillColor: style.fillColor,
        dottedLine: soon
      })
    })
  })
  return polygons
}

/**
 * 优先用 notice.centerline；否则对细长走廊取 ring 前半段作为脊线近似
 */
function buildPolylinesFromNotices(notices, enabledTypes, opts) {
  const allow = enabledTypes && typeof enabledTypes === 'object' ? enabledTypes : null
  const o = opts || {}
  const polylines = []
  let id = 1
  ;(notices || []).forEach((n) => {
    if (shouldSkipNotice(n)) return
    if (n.cancelled || n.statusTone === 'off') return
    const t = normalizeType(n.type)
    if (allow && allow[t] === false) return
    let points = []
    if (Array.isArray(n.centerline) && n.centerline.length >= 2) {
      points = n.centerline.map(toLonLatPair).filter(Boolean)
    } else if (t === 'ADP_LINK_FILE' && Array.isArray(n.areas) && n.areas[0] && n.areas[0].length >= 6) {
      const ring = n.areas[0]
      // 仅对中等跨度走廊做脊线近似；全球假走廊已跳过
      if (ringLonSpan(ring) <= MAX_RING_LON_SPAN) {
        const half = Math.floor((ring.length - 1) / 2)
        points = ring.slice(0, Math.max(2, half)).map(toLonLatPair).filter(Boolean)
      }
    }
    if (points.length < 2) return
    polylines.push({
      id: id++,
      points,
      noticeKey: String(n.noticeKey || ''),
      color: n.statusTone === 'soon' ? SOON_COLOR : baseColorForType(t),
      width: t === 'ADP_LINK_FILE' ? 3 : 2,
      dottedLine: n.statusTone === 'soon',
      arrowLine: false
    })
  })
  return polylines
}

function resolveTrajectory(entry) {
  const site = SITE_TRAJ && Array.isArray(SITE_TRAJ.coordinates) ? SITE_TRAJ.coordinates : []
  const fromEntry = entry && Array.isArray(entry.trajectory) ? entry.trajectory : []
  const isFlight13 =
    (entry && entry.ll2Id === FLIGHT13_LL2_ID) ||
    (entry && entry.entryKey === 'launch-starship-flight-13')
  if (isFlight13 && site.length >= 2) {
    // 云端版本落后（旧抽稀包）时用本地站点同源包，避免画出粗折线
    const entryVersion = Number(entry.trajectoryVersion || 0)
    if (entryVersion >= SITE_TRAJ_VERSION && fromEntry.length >= 2) return fromEntry
    return site
  }
  // 非 Flight 13：只用云端真实轨迹，绝不回退到 Flight 13 本地兜底
  if (fromEntry.length >= 2) return fromEntry
  return null
}

/** 跨洋黄线：与 space-notices.com 同色 #ffcc00、线宽 3 */
function buildTrajectoryPolyline(trajectory, color) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) return null
  const points = trajectory.map(toLonLatPair).filter(Boolean)
  if (points.length < 2) return null
  return {
    id: 900001,
    points,
    color: color || SITE_TRAJ_COLOR,
    width: 3,
    dottedLine: false,
    arrowLine: false
  }
}

/** 角标文案：任意任务名都走与列表卡同一套汉化，缺省再回落发射台名 */
function localizePadMarkerLabel(title, pad) {
  const raw = String(title || '').trim()
  if (raw) {
    const zh = localizeMissionTitle(raw) || raw
    return pickLocalized(zh, raw) || raw
  }
  const padName = String((pad && pad.name) || '').trim()
  if (padName) return padName
  return isContentLangEn() ? 'Launch pad' : '发射台'
}

function buildPadMarker(pad, title, opts) {
  if (!pad || pad.latitude == null || pad.longitude == null) return []
  const lat = Number(pad.latitude)
  const lon = Number(pad.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
  const light = !!(opts && opts.light)
  const label = localizePadMarkerLabel(title, pad)
  // 不传 iconPath：微信渲染腾讯地图原生默认红钉（自带钉尖锚点，勿再拼自定义图片，
  // 也勿用 ISS 的绿色 station-marker）
  return [
    {
      id: 1,
      latitude: lat,
      longitude: lon,
      title: label,
      callout: {
        content: label,
        display: 'ALWAYS',
        padding: 6,
        borderRadius: 6,
        fontSize: 12,
        color: light ? '#1C1C1E' : '#FFFFFF',
        bgColor: light ? '#FFFFFF' : '#1C1C1E',
        borderWidth: 1,
        borderColor: light ? '#E5E5EA' : '#3A3A3C'
      }
    }
  ]
}

/**
 * 有效发射台：entry.pad 有坐标则用；否则按名称表回填；再不行用通告几何密度中心
 * （与星舰同链路：有点才画 marker，默认视野落在该点）
 */
function resolveEffectivePad(entry, polygons, polylines) {
  const raw = entry && entry.pad
  const resolved = resolvePadCoords(raw || {})
  if (Number.isFinite(Number(resolved.latitude)) && Number.isFinite(Number(resolved.longitude))) {
    return {
      name: resolved.name || (raw && raw.name) || '',
      latitude: Number(resolved.latitude),
      longitude: Number(resolved.longitude)
    }
  }
  const pts = collectPoints(null, polygons || [], polylines || [])
  const origin = densestPoint(pts, 8)
  if (!origin) return resolved.name ? resolved : null
  return {
    name: resolved.name || (raw && raw.name) || '发射区',
    latitude: origin.latitude,
    longitude: origin.longitude
  }
}

function collectPoints(pad, polygons, polylines) {
  const pts = []
  if (pad && Number.isFinite(Number(pad.latitude)) && Number.isFinite(Number(pad.longitude))) {
    pts.push({ latitude: Number(pad.latitude), longitude: Number(pad.longitude) })
  }
  ;(polygons || []).forEach((poly) => {
    ;(poly.points || []).forEach((p) => {
      if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) pts.push(p)
    })
  })
  ;(polylines || []).forEach((line) => {
    ;(line.points || []).forEach((p) => {
      if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) pts.push(p)
    })
  })
  return pts
}

function lonDelta(a, b) {
  let d = Math.abs(Number(a) - Number(b))
  if (d > 180) d = 360 - d
  return d
}

/** 无发射台时，用邻域密度最高的点作为“发射区”原点 */
function densestPoint(pts, radiusDeg) {
  if (!pts || !pts.length) return null
  let best = pts[0]
  let bestCount = -1
  const step = Math.max(1, Math.floor(pts.length / 80))
  for (let i = 0; i < pts.length; i += step) {
    const c = pts[i]
    let n = 0
    for (let j = 0; j < pts.length; j += step) {
      const p = pts[j]
      if (Math.abs(p.latitude - c.latitude) <= radiusDeg && lonDelta(p.longitude, c.longitude) <= radiusDeg) n += 1
    }
    if (n > bestCount) {
      bestCount = n
      best = c
    }
  }
  return best
}

/**
 * 分区视野：相对发射台（或点密度中心），避免写死 Starbase 导致其它任务发射区被滤光
 * region: 'pad' | 'splash' | 'global'
 */
function filterPointsByRegion(pts, region, pad) {
  if (!region || region === 'global') return pts || []
  if (!pts || !pts.length) return []

  let originLat = null
  let originLon = null
  if (pad && Number.isFinite(Number(pad.latitude)) && Number.isFinite(Number(pad.longitude))) {
    originLat = Number(pad.latitude)
    originLon = Number(pad.longitude)
  } else {
    const origin = densestPoint(pts, 8)
    if (origin) {
      originLat = origin.latitude
      originLon = origin.longitude
    }
  }
  if (originLat == null || originLon == null) return pts

  if (region === 'pad') {
    const near = pts.filter(
      (p) => Math.abs(p.latitude - originLat) <= 8 && lonDelta(p.longitude, originLon) <= 12
    )
    if (near.length) return near
    return pts.filter(
      (p) => Math.abs(p.latitude - originLat) <= 15 && lonDelta(p.longitude, originLon) <= 20
    )
  }

  // splash：远离发射台的再入/溅落点；没有远点时不硬套印度洋
  return pts.filter(
    (p) => Math.abs(p.latitude - originLat) > 10 || lonDelta(p.longitude, originLon) > 25
  )
}

/** 微信 map scale 合法范围 3–20（3≈1000km，20≈5m），越界会被钳制导致视野错位 */
const MIN_SCALE = 3
const MAX_SCALE = 20

function scaleFromSpan(span) {
  let s
  if (span > 80) s = 3
  else if (span > 40) s = 4
  else if (span > 15) s = 5
  else if (span > 5) s = 6
  else if (span > 2) s = 8
  else if (span > 0.8) s = 10
  else if (span > 0.3) s = 12
  else s = 13
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
}

function boundsOf(pts) {
  let minLat = pts[0].latitude
  let maxLat = pts[0].latitude
  let minLon = pts[0].longitude
  let maxLon = pts[0].longitude
  pts.forEach((p) => {
    if (p.latitude < minLat) minLat = p.latitude
    if (p.latitude > maxLat) maxLat = p.latitude
    if (p.longitude < minLon) minLon = p.longitude
    if (p.longitude > maxLon) maxLon = p.longitude
  })
  return { minLat, maxLat, minLon, maxLon }
}

function sampleIncludePoints(pts, max) {
  const cap = max || 40
  const step = Math.max(1, Math.floor(pts.length / cap))
  const out = []
  for (let i = 0; i < pts.length; i += step) out.push(pts[i])
  if (out.length < 2 && pts.length >= 2) return [pts[0], pts[pts.length - 1]]
  return out
}

function fitCenter(pad, polygons, polylines, opts) {
  const region = (opts && opts.region) || 'pad'
  const all = collectPoints(pad, polygons, polylines)

  // 发射区默认：中心钉死在红色坐标，避免危险区 bbox 把视野拽走
  if (
    region === 'pad' &&
    pad &&
    Number.isFinite(Number(pad.latitude)) &&
    Number.isFinite(Number(pad.longitude))
  ) {
    const padLat = Number(pad.latitude)
    const padLon = Number(pad.longitude)
    const near = filterPointsByRegion(all, 'pad', pad)
    let span = 1.2
    if (near.length >= 2) {
      const b = boundsOf(near)
      span = Math.max(b.maxLat - b.minLat, b.maxLon - b.minLon, 0.6)
    }
    return {
      latitude: padLat,
      longitude: padLon,
      scale: scaleFromSpan(span),
      // 只用发射台点，避免 include-points 覆盖 lat/lon 把中心挪开
      includePoints: [{ latitude: padLat, longitude: padLon }]
    }
  }

  let pts = filterPointsByRegion(all, region, pad)
  if (!pts.length && region !== 'global') {
    // 该分区无几何时回退：pad 用发射台，其余用全量点
    if (region === 'pad' && pad && Number.isFinite(Number(pad.latitude))) {
      return {
        latitude: Number(pad.latitude),
        longitude: Number(pad.longitude),
        scale: 8,
        includePoints: [{ latitude: Number(pad.latitude), longitude: Number(pad.longitude) }]
      }
    }
    pts = all
  }
  if (!pts.length) {
    return { latitude: 25.99677, longitude: -97.15799, scale: 6, includePoints: [] }
  }
  const b = boundsOf(pts)
  const span = Math.max(b.maxLat - b.minLat, b.maxLon - b.minLon)
  return {
    latitude: (b.minLat + b.maxLat) / 2,
    longitude: (b.minLon + b.maxLon) / 2,
    scale: scaleFromSpan(span),
    // include-points 让视野贴合几何（全程模式同样需要，否则 scale=3 只剩 1000km 窗口）
    includePoints: sampleIncludePoints(pts, 40)
  }
}

/**
 * 聚焦单条通告：点列表项时把视野收到该通告多边形
 * @returns {{latitude:number, longitude:number, scale:number, includePoints:object[]}|null}
 */
function fitNotice(notice) {
  const rings = drawableRings(notice)
  if (!rings.length) return null
  const pts = []
  rings.forEach((ring) => {
    ring.forEach((p) => {
      const q = toLonLatPair(p)
      if (q) pts.push(q)
    })
  })
  if (pts.length < 2) return null
  const b = boundsOf(pts)
  const span = Math.max(b.maxLat - b.minLat, b.maxLon - b.minLon)
  return {
    latitude: (b.minLat + b.maxLat) / 2,
    longitude: (b.minLon + b.maxLon) / 2,
    scale: scaleFromSpan(span),
    includePoints: sampleIncludePoints(pts, 30)
  }
}

function pointInRing(lat, lng, points) {
  let inside = false
  const pts = points || []
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = Number(pts[i].latitude)
    const xi = Number(pts[i].longitude)
    const yj = Number(pts[j].latitude)
    const xj = Number(pts[j].longitude)
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue
    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function ringAbsArea(points) {
  let a = 0
  const pts = points || []
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length
    a += Number(pts[i].longitude) * Number(pts[j].latitude) - Number(pts[j].longitude) * Number(pts[i].latitude)
  }
  return Math.abs(a)
}

/** 点到哪个危险区（重叠时取更小的面） */
function hitTestPolygonNotice(lat, lng, polygons) {
  const hits = []
  ;(polygons || []).forEach((poly) => {
    const key = String((poly && poly.noticeKey) || '')
    const pts = poly && poly.points
    if (!key || !Array.isArray(pts) || pts.length < 3) return
    if (pointInRing(lat, lng, pts)) hits.push(poly)
  })
  if (!hits.length) return ''
  hits.sort((a, b) => ringAbsArea(a.points) - ringAbsArea(b.points))
  return String(hits[0].noticeKey || '')
}

const PREVIEW_TYPES = {
  NOTAM: true,
  TFR: true,
  NAVWARNING: true,
  BNM: true,
  LNM: true,
  ADP_LINK_FILE: true
}

function pointInChinaPreview(p) {
  const lat = Number(p && p.latitude)
  const lon = Number(p && p.longitude)
  return lat >= 0 && lat <= 54 && lon >= 73 && lon <= 140
}

function noticeHasChinaGeometry(n) {
  if (n && n.inChina) return true
  return drawableRings(n).some((ring) =>
    ring.some((pt) => {
      const q = toLonLatPair(pt)
      return q && pointInChinaPreview(q)
    })
  )
}

function buildPreviewLayers(notices, opts) {
  const o = Object.assign({ preview: true }, opts || {})
  const active = (notices || []).filter(
    (n) => n && !n.cancelled && n.statusTone !== 'off' && noticeHasChinaGeometry(n)
  )
  const polygons = buildPolygonsFromNotices(active, PREVIEW_TYPES, o).slice(0, 40)
  const outlines = []
  polygons.forEach((p, i) => {
    if (!p || !Array.isArray(p.points) || p.points.length < 2) return
    outlines.push({
      id: 8000 + i,
      points: p.points.concat([p.points[0]]),
      color: p.strokeColor,
      width: 3,
      dottedLine: !!p.dottedLine,
      noticeKey: p.noticeKey || ''
    })
  })
  return {
    polygons,
    polylines: buildPolylinesFromNotices(active, PREVIEW_TYPES, o).concat(outlines)
  }
}

module.exports = {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildTrajectoryPolyline,
  resolveTrajectory,
  buildPadMarker,
  localizePadMarkerLabel,
  resolveEffectivePad,
  fitCenter,
  fitNotice,
  collectPoints,
  densestPoint,
  styleForType,
  baseColorForType,
  hasGeometry,
  hitTestPolygonNotice,
  buildPreviewLayers,
  SKIP_NOTICE_KEYS,
  SITE_TRAJ_VERSION,
  SITE_TRAJ_COLOR,
  SOON_COLOR,
  CANCELLED_COLOR
}
