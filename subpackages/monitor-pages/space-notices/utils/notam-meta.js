/**
 * SPACE_NOTICES_FEATURE — 从 ICAO / FAA 原文抽出 FIR、航警编号、高度、坐标文本
 */
const { isContentLangEn } = require('../../../../utils/locale.js')

function toLonLatPair(p) {
  if (!p) return null
  const lon = Number(Array.isArray(p) ? p[0] : p.longitude)
  const lat = Number(Array.isArray(p) ? p[1] : p.latitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { longitude: lon, latitude: lat }
}

function tzLabel() {
  const min = -new Date().getTimezoneOffset()
  const sign = min >= 0 ? '+' : '-'
  const h = String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')
  const m = String(Math.abs(min) % 60).padStart(2, '0')
  const utc = 'UTC' + sign + h + (m === '00' ? '' : ':' + m)
  if (isContentLangEn()) return 'Local (' + utc + ')'
  return (min === 480 ? '北京时间' : '本地时间') + ' (' + utc + ')'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatLocalStamp(ms) {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return ''
  if (isContentLangEn()) {
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate()) +
      ' ' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    )
  }
  return (
    d.getFullYear() +
    '年' +
    (d.getMonth() + 1) +
    '月' +
    d.getDate() +
    '日 ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  )
}

function ts(v) {
  if (!v) return 0
  const n = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(n) ? n : 0
}

function pickWindow(dates, now) {
  const at = Number.isFinite(now) ? now : Date.now()
  const list = (Array.isArray(dates) ? dates : [])
    .map((d) => ({ start: ts(d && d.start), end: ts(d && d.end) }))
    .filter((d) => d.start || d.end)
    .sort((a, b) => (a.start || a.end) - (b.start || b.end))
  if (!list.length) return null
  const live = list.find((d) => (!d.start || d.start <= at) && (!d.end || d.end >= at))
  if (live) return live
  const next = list.find((d) => d.start && d.start > at)
  if (next) return next
  return list[list.length - 1]
}

function parseIcaoStamp(token) {
  const s = String(token || '').trim().toUpperCase()
  if (s === 'PERM') return 0
  const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (!m) return 0
  let year = Number(m[1])
  year += year >= 70 ? 1900 : 2000
  const ms = Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  return Number.isFinite(ms) ? ms : 0
}

function parseIcaoWindow(raw) {
  const text = String(raw || '')
  const same = text.match(/B\)\s*(\d{10})\s+C\)\s*(PERM|\d{10})/i)
  const b = same ? same[1] : ((text.match(/(?:^|\n)B\)\s*(\d{10})/i) || [])[1])
  const c = same ? same[2] : ((text.match(/(?:^|\n)C\)\s*(PERM|\d{10})/i) || [])[1])
  const start = parseIcaoStamp(b)
  if (String(c || '').toUpperCase() === 'PERM') {
    return start ? { start, end: 0, perm: true } : null
  }
  const end = parseIcaoStamp(c)
  if (!start && !end) return null
  return { start, end, perm: false }
}

function datesFromNotice(notice) {
  const n = notice || {}
  const listed = (Array.isArray(n.dates) ? n.dates : []).filter((d) => d && (d.start || d.end))
  const hasStart = listed.some((d) => d && d.start)
  if (listed.length && hasStart) return listed
  const w = parseIcaoWindow(n.rawText || '')
  if (!w) return listed
  return [{ start: w.start || undefined, end: w.perm ? undefined : w.end || undefined }]
}

function formatDuration(dates, now, rawText) {
  let list = Array.isArray(dates) ? dates : []
  if (!list.length && rawText) {
    const w = parseIcaoWindow(rawText)
    if (w) list = [{ start: w.start, end: w.perm ? 0 : w.end }]
  }
  const tz = tzLabel()
  const win = pickWindow(list, now)
  const icao = !win ? parseIcaoWindow(rawText || '') : null
  const start = win ? win.start : icao && icao.start
  const end = win ? win.end : icao && (icao.perm ? 0 : icao.end)
  const perm = !!(icao && icao.perm)
  if (!start && !end && !perm) return { durationText: '', durationSub: tz }
  const a = start ? formatLocalStamp(start) : ''
  const b = perm ? (isContentLangEn() ? 'PERM' : '永久') : end ? formatLocalStamp(end) : ''
  let durationText = ''
  if (a && b) durationText = a + ' ~ ' + b + ' ' + tz
  else if (a) durationText = a + (isContentLangEn() ? ' onward ' : ' 起 ') + tz
  else durationText = (isContentLangEn() ? 'until ' : '至 ') + b + ' ' + tz
  return { durationText: durationText.trim(), durationSub: tz }
}

function parseFir(raw, name) {
  const text = String(raw || '')
  const q = text.match(/Q\)\s*([A-Z]{4})\b/i)
  if (q) return q[1].toUpperCase()
  const a = text.match(/A\)\s*([A-Z]{4})\b/i)
  if (a) return a[1].toUpperCase()
  const fromKey = String(name || '').match(/\b([A-Z]{4})\b/)
  if (fromKey && !/NOTA|AREA|TEMP|SFCU|HAZA/i.test(fromKey[1])) return fromKey[1]
  return ''
}

function parseNotamId(raw, name, noticeKey) {
  const fromName = String(name || '').match(/\b([A-Z]?\d{1,5}\/\d{2,4})\b/i)
  if (fromName) return fromName[1].toUpperCase()
  const text = String(raw || '')
  const head = text.match(/^\s*([A-Z]\d{3,5}\/\d{2})\b/m)
  if (head) return head[1].toUpperCase()
  const faa = text.match(/\b(\d{1,2}\/\d{3,5})\b/)
  if (faa) return faa[1]
  const key = String(noticeKey || '')
  const fromKey = key.match(/([A-Z]?\d{3,5}\/\d{2})(?:-|$)/i) || key.match(/(\d{1,2}\/\d{3,5})/)
  if (fromKey) return fromKey[1].toUpperCase()
  return String(name || '').trim()
}

function flToAltLabel(token) {
  const s = String(token || '').trim().toUpperCase()
  if (!s) return ''
  if (s === 'SFC' || s === 'GND' || s === '000' || s === '0') return '0'
  if (s === 'UNL' || s === 'UNLIM' || s === 'UNLIMITED' || s === '999' || s === 'INF') {
    return isContentLangEn() ? 'INF' : 'INF'
  }
  if (/^FL\d{2,3}$/.test(s)) {
    const fl = Number(s.slice(2))
    if (!Number.isFinite(fl)) return s
    return String(Math.round(fl * 100 * 0.3048))
  }
  if (/^\d{3}$/.test(s)) {
    const fl = Number(s)
    if (fl === 0) return '0'
    if (fl >= 999) return 'INF'
    return String(Math.round(fl * 100 * 0.3048))
  }
  const meters = s.match(/^(\d+)\s*M/)
  if (meters) return meters[1]
  return s
}

function parseAltitude(raw) {
  const text = String(raw || '')
  const f = text.match(/(?:^|\n)F\)\s*(\S+)/i)
  const g = text.match(/(?:^|\n)G\)\s*(\S+)/i)
  if (f || g) {
    const lo = flToAltLabel(((f && f[1]) || '').trim().split(/\s+/)[0])
    const hi = flToAltLabel(((g && g[1]) || '').trim().split(/\s+/)[0])
    if (lo || hi) {
      return (lo || '0') + ' ~ ' + (hi || 'INF') + (isContentLangEn() ? ' m' : ' 米')
    }
  }
  const sfcUnl = text.match(/\bSFC\s*[-–]\s*UNL\b/i)
  if (sfcUnl) return isContentLangEn() ? '0 ~ INF m' : '0 ~ INF 米'
  const q = text.match(/Q\)\s*[^\n]+/i)
  if (q) {
    const parts = q[0].replace(/^Q\)\s*/i, '').split('/')
    // FIR / Qcode / traffic / purpose / scope / lower / upper / ...
    if (parts.length >= 7) {
      const lo = flToAltLabel(parts[5])
      const hi = flToAltLabel(parts[6])
      if (lo || hi) {
        return (lo || '0') + ' ~ ' + (hi || 'INF') + (isContentLangEn() ? ' m' : ' 米')
      }
    }
  }
  return ''
}

function collectPoints(notice) {
  const pts = []
  const rings = Array.isArray(notice && notice.areas) ? notice.areas : []
  rings.forEach((ring) => {
    if (!Array.isArray(ring)) return
    ring.forEach((p) => {
      const q = toLonLatPair(p)
      if (q) pts.push(q)
    })
  })
  const line = Array.isArray(notice && notice.centerline) ? notice.centerline : []
  line.forEach((p) => {
    const q = toLonLatPair(p)
    if (q) pts.push(q)
  })
  return pts
}

function formatNoticeCoords(notice) {
  const pts = collectPoints(notice)
  if (!pts.length) return ''
  const lines = []
  const seen = {}
  pts.forEach((p) => {
    const row = p.latitude.toFixed(6) + ', ' + p.longitude.toFixed(6)
    if (seen[row]) return
    seen[row] = true
    lines.push(row)
  })
  return lines.join('\n')
}

function sourceLabel(notice) {
  const t = String((notice && notice.type) || 'NOTAM').toUpperCase()
  if (t === 'NAVWARNING' || t === 'BNM' || t === 'LNM') return 'NAVWARNING'
  if (t === 'ADP_LINK_FILE') return 'ADP'
  if (t === 'TFR') return 'TFR'
  return 'NOTAM'
}

function parseNotamKind(raw) {
  const m = String(raw || '').match(/\bNOTAM([NRC])\b/i)
  if (!m) return ''
  const k = m[1].toUpperCase()
  if (k === 'N') return 'NOTAMN'
  if (k === 'R') return 'NOTAMR'
  return 'NOTAMC'
}

function itemText(raw, letter) {
  const text = String(raw || '')
  const re = new RegExp('(?:^|\\n)' + letter + '\\)\\s*([\\s\\S]*?)(?=\\n[A-Z]\\)|$)', 'i')
  const m = text.match(re)
  return m ? String(m[1] || '').trim() : ''
}

const TRAFFIC_LABEL = { IV: '仪表/目视', I: '仪表', V: '目视', K: '检查单' }
const PURPOSE_LABEL = { N: '立即', B: '运行', O: '运行', M: '杂项', K: '检查单' }
const SCOPE_LABEL = { A: '机场', E: '航路', W: '警告区', K: '检查单' }

function parseQLine(raw) {
  const q = String(raw || '').match(/Q\)\s*([^\n]+)/i)
  if (!q) {
    return { qCode: '', traffic: '', purpose: '', scope: '', radiusNm: '', centerText: '', qSummary: '' }
  }
  const parts = q[1].trim().split('/')
  const qCode = String(parts[1] || '').trim().toUpperCase()
  const traffic = String(parts[2] || '').trim().toUpperCase()
  const purpose = String(parts[3] || '').trim().toUpperCase()
  const scope = String(parts[4] || '').trim().toUpperCase()
  const loc = String(parts[7] || parts[parts.length - 1] || '').trim().toUpperCase()
  let radiusNm = ''
  let centerText = ''
  const locM = loc.match(/^(\d{4})([NS])(\d{5})([EW])(\d{3})?$/)
  if (locM) {
    let lat = Number(locM[1].slice(0, 2)) + Number(locM[1].slice(2, 4)) / 60
    let lon = Number(locM[3].slice(0, 3)) + Number(locM[3].slice(3, 5)) / 60
    if (locM[2] === 'S') lat = -lat
    if (locM[4] === 'W') lon = -lon
    centerText = lat.toFixed(6) + ', ' + lon.toFixed(6)
    if (locM[5] && locM[5] !== '000') radiusNm = String(Number(locM[5]))
  }
  const bits = []
  if (TRAFFIC_LABEL[traffic]) bits.push(TRAFFIC_LABEL[traffic])
  if (purpose) {
    const seen = {}
    const p = []
    String(purpose).split('').forEach((ch) => {
      const lab = PURPOSE_LABEL[ch]
      if (lab && !seen[lab]) {
        seen[lab] = 1
        p.push(lab)
      }
    })
    if (p.length) bits.push(p.join('/'))
  }
  if (SCOPE_LABEL[scope]) bits.push(SCOPE_LABEL[scope])
  return { qCode, traffic, purpose, scope, radiusNm, centerText, qSummary: bits.join(' · ') }
}

/**
 * @param {object} notice
 * @param {number} [now]
 */
function parseNotamMeta(notice, now) {
  const n = notice || {}
  const raw = n.rawText || ''
  const dates = datesFromNotice(n)
  const dur = formatDuration(dates, now, raw)
  const coordText = formatNoticeCoords(n)
  const q = parseQLine(raw)
  const activity = (itemText(raw, 'E') || String(n.reason || '')).replace(/\s+/g, ' ').trim()
  const schedule = itemText(raw, 'D').replace(/\s+/g, ' ').trim()
  const radiusText = q.radiusNm ? q.radiusNm + (isContentLangEn() ? ' NM' : ' 海里') : ''
  return {
    fir: parseFir(raw, n.name || n.noticeKey),
    notamId: parseNotamId(raw, n.name, n.noticeKey),
    notamKind: parseNotamKind(raw),
    altText: parseAltitude(raw),
    durationText: dur.durationText,
    durationSub: dur.durationSub,
    sourceLabel: sourceLabel(n),
    sourceName: String(n.sourceName || '').trim(),
    coordText,
    coordCount: coordText ? coordText.split('\n').length : 0,
    qCode: q.qCode,
    qSummary: q.qSummary,
    radiusText,
    centerText: q.centerText,
    scheduleText: schedule,
    activityText: activity,
    dates
  }
}

module.exports = {
  parseNotamMeta,
  formatNoticeCoords,
  formatDuration,
  parseFir,
  parseNotamId,
  parseAltitude,
  parseIcaoWindow,
  datesFromNotice,
  tzLabel
}
