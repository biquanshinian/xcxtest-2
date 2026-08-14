/**
 * SPACE_NOTICES_FEATURE — 通告是否落在中国（含港澳台）
 *
 * 只认高置信信号，避免：
 * - 时间里的 Zulu「Z」
 * - 美国 ARTCC 三字代码 ZHU / ZMA
 * - 文案 ZONE / ZULU
 * - China Lake（加州靶场）
 * - 日本种子岛 / 俄罗斯东方航天发射场 落在粗略经纬框内
 */

/** ICAO：中国大陆 ZB/ZG/ZH/ZJ/ZL/ZP/ZS/ZU/ZW/ZY、香港 VH、澳门 VM、台湾 RC */
const CHINA_ICAO_RE = /^(Z[BGHJLPSUWY][A-Z]{2}|VHHK|VHHH|VMMC|VHSK|RC[A-Z]{2})$/
const NOT_ICAO_WORD = /^(ZONE|ZULU|ZERO|ZOOM|ZEST|ZINC)$/

const CHINA_PLACE_RE =
  /文昌|西昌|酒泉|太原|海阳|宁波|海南|黄海|东海|南海|渤海|中国|Wenchang|Xichang|Jiuquan|Taiyuan|Haiyang|Ningbo|Hainan|Yellow Sea|East China Sea|South China Sea|Bohai|\bChina\b/i

const CHINA_LAKE_RE = /china\s+lake/i

/**
 * 分块包围盒，避开种子岛(30.4N,131E)、东方发射场(51.88N,128.3E)、拜科努尔(46N,63E)
 * [minLat, maxLat, minLon, maxLon]
 */
const CHINA_BOXES = [
  [18.0, 20.8, 108.0, 111.8], // 海南 / 文昌
  [20.5, 41.2, 108.0, 123.6], // 华南–华东沿海（含海阳、宁波近海）
  [26.0, 43.2, 97.0, 112.5], // 西昌 / 太原 / 酒泉
  [35.0, 49.0, 73.5, 97.0], // 新疆
  [27.0, 37.0, 78.0, 103.5], // 青藏
  [40.0, 50.6, 122.0, 135.0], // 东北（不含东方发射场 51.9N）
  [21.8, 25.4, 119.9, 122.1], // 台湾
  [8.0, 18.2, 109.5, 120.0] // 南海 / 苏禄海西缘（官网中国合集溅落区约 9N 119E）
]

/** 官网 https://space-notices.com/entry/collection-chinese-unknown */
const CHINESE_COLLECTION_KEY = 'collection-chinese-unknown'

function isChineseCollectionKey(key) {
  return String(key || '').trim() === CHINESE_COLLECTION_KEY
}

/** 用户能看懂的情报区名；NAV 表示航海警告（无 FIR） */
const FIR_LABELS = {
  ZLHW: '兰州',
  ZHWH: '武汉',
  ZBPE: '北京',
  ZSHA: '上海',
  ZGZU: '广州',
  ZPKM: '昆明',
  ZWUQ: '乌鲁木齐',
  ZYSH: '沈阳',
  ZJSA: '三亚',
  VHHK: '香港',
  VHHH: '香港',
  VMMC: '澳门',
  RCAA: '台北',
  RPHI: '马尼拉',
  RPLI: '马尼拉'
}

function firCodeFromNotice(notice) {
  const icaos = extractIcaoLocations(notice)
  const chinaHit = icaos.find(isChinaIcao)
  if (chinaHit) return chinaHit
  const key = String((notice && notice.noticeKey) || '')
  const fromKey = key.match(/notam-([A-Z]{4})[-_/]/i)
  if (fromKey) return fromKey[1].toUpperCase()
  const blob = key + '\n' + String((notice && notice.rawText) || '') + '\n' + String((notice && notice.name) || '')
  if (/HYDROPAC|HYDROLANT|NAVAREA|NAVWARNING/i.test(blob)) return 'NAV'
  return (icaos[0] || '').toUpperCase()
}

function firLabel(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return ''
  if (c === 'NAV') return '航海警告'
  if (FIR_LABELS[c]) return FIR_LABELS[c] + '情报区'
  return c + ' 情报区'
}

function isChinaIcao(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c || NOT_ICAO_WORD.test(c)) return false
  return CHINA_ICAO_RE.test(c)
}

function extractIcaoLocations(notice) {
  const n = notice || {}
  const text = String(n.rawText || '')
  const key = String(n.noticeKey || '')
  const out = []
  const q = text.match(/Q\)\s*([A-Z]{4})\b/i)
  if (q) out.push(q[1].toUpperCase())
  const aLines = text.match(/A\)\s*([A-Z]{4})\b/gi) || []
  aLines.forEach((m) => {
    const hit = m.match(/([A-Z]{4})/i)
    if (hit) out.push(hit[1].toUpperCase())
  })
  const fromKey = key.match(/notam-([A-Z]{4})[-_/]/i)
  if (fromKey) out.push(fromKey[1].toUpperCase())
  return out
}

function pointInChina(lat, lon) {
  const y = Number(lat)
  const x = Number(lon)
  if (!Number.isFinite(y) || !Number.isFinite(x)) return false
  for (let i = 0; i < CHINA_BOXES.length; i++) {
    const b = CHINA_BOXES[i]
    if (y >= b[0] && y <= b[1] && x >= b[2] && x <= b[3]) return true
  }
  return false
}

function readLonLat(p) {
  if (!p) return null
  let lon
  let lat
  if (Array.isArray(p)) {
    lon = Number(p[0])
    lat = Number(p[1])
  } else {
    lat = Number(p.latitude != null ? p.latitude : p.lat)
    lon = Number(p.longitude != null ? p.longitude : p.lon != null ? p.lon : p.lng)
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
    const t = lat
    lat = lon
    lon = t
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { latitude: lat, longitude: lon }
}

function collectNoticePoints(notice) {
  const n = notice || {}
  const pts = []
  const rings = Array.isArray(n.areas) ? n.areas : []
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]
    if (!Array.isArray(ring)) continue
    for (let j = 0; j < ring.length; j++) {
      const q = readLonLat(ring[j])
      if (q) pts.push(q)
    }
  }
  const line = Array.isArray(n.centerline) ? n.centerline : []
  for (let k = 0; k < line.length; k++) {
    const q = readLonLat(line[k])
    if (q) pts.push(q)
  }
  return pts
}

function geometryMostlyChina(notice) {
  const pts = collectNoticePoints(notice)
  if (!pts.length) return false
  let inside = 0
  for (let i = 0; i < pts.length; i++) {
    if (pointInChina(pts[i].latitude, pts[i].longitude)) inside += 1
  }
  return inside / pts.length >= 0.5
}

function hasChinaKeywords(notice) {
  const n = notice || {}
  const blob = [n.name, n.noticeKey, n.reason, n.rawText, n.sourceName].join('\n')
  if (!blob.trim()) return false
  if (CHINA_LAKE_RE.test(blob)) return false
  return CHINA_PLACE_RE.test(blob)
}

function isChinaPad(pad) {
  if (!pad) return false
  const lat = Number(pad.latitude)
  const lon = Number(pad.longitude)
  if (pointInChina(lat, lon)) return true
  const blob = [pad.name, pad.location && pad.location.name].join(' ')
  if (CHINA_LAKE_RE.test(blob)) return false
  return CHINA_PLACE_RE.test(blob)
}

/**
 * 中国相关通告：FIR / 地名 / 过半顶点落在中国包围盒。
 * 已标明外国 FIR 且无中国地名、几何也不在中国 → 否。
 */
function isChinaNotice(notice) {
  const n = notice || {}
  const icaos = extractIcaoLocations(n)
  if (icaos.some(isChinaIcao)) return true
  const place = hasChinaKeywords(n)
  if (place) return true
  const geo = geometryMostlyChina(n)
  if (geo) return true
  return false
}

function noticeChinaVisible(n, flags) {
  if (!flags || !flags.chinaOnly) return true
  return !!(n && n.inChina)
}

module.exports = {
  isChinaIcao,
  extractIcaoLocations,
  pointInChina,
  geometryMostlyChina,
  hasChinaKeywords,
  isChinaNotice,
  isChinaPad,
  noticeChinaVisible,
  isChineseCollectionKey,
  firCodeFromNotice,
  firLabel,
  FIR_LABELS,
  CHINESE_COLLECTION_KEY,
  CHINA_OVERVIEW: { latitude: 35.0, longitude: 104.0, scale: 4 }
}
