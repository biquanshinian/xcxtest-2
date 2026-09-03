/**
 * SPACE_NOTICES_FEATURE — 中国区航警
 * 大陆 9 个 FIR + 香港 / 澳门 / 台北。与客户端 china-notices.js 规则对齐。
 * 分类只看 FIR / 原文 / 坐标，不用 entryKey（避免 collection-china-firs 把外国通告洗成中国区）。
 */

const CHINA_FIRS = [
  'ZBPE', // 北京
  'ZGZU', // 广州
  'ZHWH', // 武汉
  'ZLHW', // 兰州
  'ZPKM', // 昆明
  'ZSHA', // 上海
  'ZYSH', // 沈阳
  'ZWUQ', // 乌鲁木齐
  'ZJSA', // 三亚
  'VHHK', // 香港
  'VMMC', // 澳门
  'RCAA' // 台北
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
const CHINA_HINT = /文昌|酒泉|太原|西昌|黄海|武汉|兰州|长征|Wenchang|Jiuquan|Xichang|Taiyuan|Long March|CZ[-_ ]?\d/i
const CHINA_SLUG_RE = /cz-|long-march|wenchang|jiuquan|taiyuan|xichang|haiyang|cangzhou|zhuhai|lanzhou|wuhan/i
const FOREIGN_FIR_RE = /^(RP|VV|VT|WB|WM|WS|RJ|RK|KZ|PA|PH|EG|ED|LF|LI|LE|UH|UE|UL)/i

function firOf(notice) {
  const raw = String((notice && notice.rawText) || '')
  const q = raw.match(/Q\)\s*([A-Z]{4})\b/i)
  if (q) return q[1].toUpperCase()
  const a = raw.match(/A\)\s*([A-Z]{4})\b/i)
  if (a) return a[1].toUpperCase()
  const named = String((notice && (notice.name || notice.noticeKey || notice.sourceLink)) || '').match(
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

function isChinaNoticePath(path) {
  const s = String(path || '')
  const m = s.match(/notam-([A-Z]{4})-/i)
  if (m) return isChinaFir(m[1]) && !isForeignFir(m[1])
  return /wenchang|jiuquan|lanzhou|wuhan|long-march/i.test(s)
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

function isChinaSlug(slug) {
  return CHINA_SLUG_RE.test(String(slug || '')) || CHINA_HINT.test(String(slug || ''))
}

module.exports = {
  CHINA_FIRS,
  CHINA_BBOX,
  FIR_LABEL,
  firOf,
  firLabel,
  isChinaFir,
  isForeignFir,
  isChinaNoticePath,
  isChinaNotice,
  hasChinaLaunchHint,
  filterChinaNotices,
  isChinaSlug
}
