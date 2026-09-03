/**
 * SPACE_NOTICES_FEATURE — 中国区航警
 * 客户端过滤：与云函数 china-notices.js 规则对齐。
 * 分类只看 FIR / 原文 / 坐标，不用 entryKey。
 */

const CHINA_FIRS = [
  'ZBPE',
  'ZGZU',
  'ZHWH',
  'ZLHW',
  'ZPKM',
  'ZSHA',
  'ZYSH',
  'ZWUQ',
  'ZJSA',
  'VHHK',
  'VMMC',
  'RCAA'
]

const CHINA_FIR_SET = {}
CHINA_FIRS.forEach((c) => {
  CHINA_FIR_SET[c] = true
})

const FIR_LABEL = {
  ZBPE: '北京情报区',
  ZGZU: '广州情报区',
  ZHWH: '武汉情报区',
  ZLHW: '兰州情报区',
  ZPKM: '昆明情报区',
  ZSHA: '上海情报区',
  ZYSH: '沈阳情报区',
  ZWUQ: '乌鲁木齐情报区',
  ZJSA: '三亚情报区',
  VHHK: '香港情报区',
  VMMC: '澳门情报区',
  RCAA: '台北情报区'
}

const CHINA_BBOX = { minLon: 73, maxLon: 140, minLat: 0, maxLat: 54 }
/** 初始中心；完整国土靠 include-points 四至，不靠 scale 4（会只剩中部几省） */
const CHINA_VIEW = { latitude: 36, longitude: 104, scale: 3 }
/** 大陆四至：南海南、北漠河、西喀什、东抚远（不含赤道溅落区） */
const CHINA_FIT_POINTS = [
  { latitude: 18.2, longitude: 73.6 },
  { latitude: 53.5, longitude: 73.6 },
  { latitude: 53.5, longitude: 135 },
  { latitude: 18.2, longitude: 135 }
]
const CHINA_INCLUDE_POINTS = CHINA_FIT_POINTS

function fitChinaPreviewMap(ctx, padding) {
  if (!ctx || typeof ctx.includePoints !== 'function') return
  try {
    ctx.includePoints({
      points: CHINA_FIT_POINTS,
      padding: Array.isArray(padding) && padding.length === 4 ? padding : [8, 8, 56, 8]
    })
  } catch (e) {}
}

const CHINA_HINT = /文昌|酒泉|太原|西昌|黄海|武汉|兰州|长征|Wenchang|Jiuquan|Xichang|Taiyuan|Long March|CZ[-_ ]?\d/i
const FOREIGN_FIR_RE = /^(RP|VV|VT|WB|WM|WS|RJ|RK|KZ|PA|PH|EG|ED|LF|LI|LE|UH|UE|UL)/i

function firOf(notice) {
  const raw = String((notice && notice.rawText) || '')
  const q = raw.match(/Q\)\s*([A-Z]{4})\b/i)
  if (q) return q[1].toUpperCase()
  const a = raw.match(/A\)\s*([A-Z]{4})\b/i)
  if (a) return a[1].toUpperCase()
  const named = String((notice && (notice.name || notice.noticeKey)) || '').match(
    /\b(Z[A-Z]{3}|VHHK|VMMC|RCAA|RPHI)\b/i
  )
  return named ? named[1].toUpperCase() : ''
}

function isChinaFir(code) {
  const c = String(code || '').toUpperCase()
  if (!c) return false
  if (CHINA_FIR_SET[c]) return true
  if (/^(RC|VH|VM)/.test(c) && c.length === 4) return true
  return c.length === 4 && c.charAt(0) === 'Z' && c.charAt(1) !== 'K' && c.charAt(1) !== 'M'
}

function isForeignFir(code) {
  const c = String(code || '').toUpperCase()
  if (!c || isChinaFir(c)) return false
  if (FOREIGN_FIR_RE.test(c)) return true
  return c.length === 3 && c.charAt(0) === 'Z'
}

function firLabel(code) {
  const c = String(code || '').toUpperCase()
  return FIR_LABEL[c] || (isChinaFir(c) ? c + ' 情报区' : '')
}

function pointInChina(lon, lat) {
  return lon >= CHINA_BBOX.minLon && lon <= CHINA_BBOX.maxLon && lat >= CHINA_BBOX.minLat && lat <= CHINA_BBOX.maxLat
}

function ringHitsChina(ring) {
  if (!Array.isArray(ring)) return false
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]
    const lon = Number(Array.isArray(p) ? p[0] : p && (p.longitude != null ? p.longitude : p.lon))
    const lat = Number(Array.isArray(p) ? p[1] : p && (p.latitude != null ? p.latitude : p.lat))
    if (Number.isFinite(lon) && Number.isFinite(lat) && pointInChina(lon, lat)) return true
  }
  return false
}

function hasChinaGeometry(notice) {
  const rings = (notice && notice.areas) || []
  for (let i = 0; i < rings.length; i += 1) {
    if (ringHitsChina(rings[i])) return true
  }
  return ringHitsChina(notice && notice.centerline)
}

function hasChinaLaunchHint(notice) {
  const blob = [notice && notice.name, notice && notice.reason, notice && notice.rawText].join(' ')
  return CHINA_HINT.test(blob)
}

function isChinaNotice(notice) {
  if (!notice) return false
  const fir = firOf(notice)
  if (fir && isChinaFir(fir)) return true
  if (fir && isForeignFir(fir)) return hasChinaLaunchHint(notice)
  if (hasChinaLaunchHint(notice)) return true
  if (!fir && hasChinaGeometry(notice)) return true
  return false
}

function filterChinaNotices(notices) {
  return (Array.isArray(notices) ? notices : []).filter(isChinaNotice)
}

/**
 * 预览卡精简条目：无标线的航警优先，最多 3 条。
 * @param {object[]} notices
 * @param {(n:object)=>boolean} [hasGeometryFn]
 * @param {number} [limit]
 */
function buildChinaPreviewCards(notices, hasGeometryFn, limit) {
  const cap = limit > 0 ? limit : 3
  let decorateNotice
  let sortNotices
  try {
    const fmt = require('./notice-format.js')
    decorateNotice = fmt.decorateNotice
    sortNotices = fmt.sortNotices
  } catch (e) {
    return []
  }
  const decorated = sortNotices((Array.isArray(notices) ? notices : []).map((n) => decorateNotice(n, hasGeometryFn)))
  const noGeo = []
  const withGeo = []
  decorated.forEach((n) => {
    if (!n) return
    if (n.hasGeo) withGeo.push(n)
    else noGeo.push(n)
  })
  return noGeo.concat(withGeo).slice(0, cap).map((n, i) => {
    const firName = firLabel(n.fir)
    const title = String(n.notamId || n.name || firName || '中国航警').slice(0, 28)
    return {
      noticeKey: String(n.noticeKey || n.notamId || title || i),
      title,
      meta: [n.typeShort, firName, n.timeText].filter(Boolean).join(' · '),
      statusText: n.statusText || '',
      statusTone: n.statusTone || '',
      hasGeo: !!n.hasGeo
    }
  })
}

module.exports = {
  CHINA_FIRS,
  CHINA_VIEW,
  CHINA_INCLUDE_POINTS,
  CHINA_FIT_POINTS,
  CHINA_BBOX,
  fitChinaPreviewMap,
  FIR_LABEL,
  firOf,
  firLabel,
  isChinaFir,
  isForeignFir,
  isChinaNotice,
  filterChinaNotices,
  buildChinaPreviewCards
}
