/**
 * SPACE_NOTICES_FEATURE — 通告展示层格式化（纯函数，便于单测）
 * 生效状态按 dates 窗口与当前时间推导；时间一律转本地时区展示。
 */
const { formatDate } = require('../../../../utils/util.js')

const TONE_LABEL = { notam: '航空 NOTAM', nav: '航海警告', adp: '空域走廊' }

function noticeTypeTone(type) {
  const t = String(type || '')
  if (/NAV|BNM|LNM/i.test(t)) return 'nav'
  if (/ADP/i.test(t)) return 'adp'
  return 'notam'
}

function shortType(type) {
  const t = String(type || '').toUpperCase()
  if (t === 'ADP_LINK_FILE') return 'ADP'
  if (t === 'NAVWARNING') return 'NAVWARN'
  return t || 'NOTAM'
}

function ts(v) {
  if (!v) return 0
  const n = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(n) ? n : 0
}

function windowText(start, end) {
  const s = ts(start)
  const e = ts(end)
  if (!s && !e) return ''
  if (!e) return formatDate(new Date(s), 'MM-DD HH:mm') + ' 起'
  if (!s) return '至 ' + formatDate(new Date(e), 'MM-DD HH:mm')
  const sameDay = formatDate(new Date(s), 'YYYY-MM-DD') === formatDate(new Date(e), 'YYYY-MM-DD')
  const tail = sameDay ? formatDate(new Date(e), 'HH:mm') : formatDate(new Date(e), 'MM-DD HH:mm')
  return formatDate(new Date(s), 'MM-DD HH:mm') + ' → ' + tail
}

/**
 * @param {object[]} dates [{ start, end }]
 * @param {boolean} [cancelled]
 * @param {number} [now] 注入当前时间便于测试
 * @returns {{statusText:string, statusTone:string, timeText:string, windows:object[]}}
 */
function describeDates(dates, cancelled, now) {
  const at = Number.isFinite(now) ? now : Date.now()
  const list = (Array.isArray(dates) ? dates : [])
    .map((d) => ({ start: ts(d && d.start), end: ts(d && d.end) }))
    .filter((d) => d.start || d.end)
    .sort((a, b) => (a.start || a.end) - (b.start || b.end))
  const windows = list.map((d, i) => ({ i, text: windowText(d.start, d.end) }))
  if (cancelled) {
    return {
      statusText: '已取消',
      statusTone: 'off',
      timeText: windows.length ? windows[0].text : '',
      windows
    }
  }
  if (!list.length) return { statusText: '', statusTone: '', timeText: '', windows }
  const active = list.find((d) => (!d.start || d.start <= at) && (!d.end || d.end >= at))
  if (active) {
    return { statusText: '生效中', statusTone: 'live', timeText: windowText(active.start, active.end), windows }
  }
  const next = list.find((d) => d.start && d.start > at)
  if (next) {
    return { statusText: '未生效', statusTone: 'soon', timeText: windowText(next.start, next.end), windows }
  }
  const last = list[list.length - 1]
  return { statusText: '已结束', statusTone: 'off', timeText: windowText(last.start, last.end), windows }
}

/**
 * @param {object} notice 云端 getEntry 返回的单条通告
 * @param {(n:object)=>boolean} hasGeometry map-build 的几何判定
 * @param {number} [now]
 */
function decorateNotice(notice, hasGeometry, now) {
  const n = notice || {}
  const tone = noticeTypeTone(n.type)
  const d = describeDates(n.dates, n.cancelled, now)
  return Object.assign({}, n, {
    typeTone: tone,
    typeLabel: TONE_LABEL[tone] || 'NOTAM',
    typeShort: shortType(n.type),
    statusText: d.statusText,
    statusTone: d.statusTone,
    timeText: d.timeText,
    windows: d.windows,
    hasGeo: typeof hasGeometry === 'function' ? !!hasGeometry(n) : false,
    rawLines: n.rawText
      ? String(n.rawText)
          .split(/\r?\n/)
          .filter((s) => s.trim())
          .map((text, i) => ({ i, text }))
      : []
  })
}

/** 生效中优先、已取消垫底；同级把有坐标图形的排前面 */
const TONE_RANK = { live: 0, soon: 1, '': 2, off: 3 }

function sortNotices(notices) {
  return (notices || []).slice().sort((a, b) => {
    if (!!a.cancelled !== !!b.cancelled) return a.cancelled ? 1 : -1
    const ra = TONE_RANK[a.statusTone] != null ? TONE_RANK[a.statusTone] : 2
    const rb = TONE_RANK[b.statusTone] != null ? TONE_RANK[b.statusTone] : 2
    if (ra !== rb) return ra - rb
    if (!!a.hasGeo !== !!b.hasGeo) return a.hasGeo ? -1 : 1
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

function buildStats(notices) {
  const stats = { notam: 0, nav: 0, adp: 0, live: 0, cancelled: 0 }
  ;(notices || []).forEach((n) => {
    if (stats[n.typeTone] != null) stats[n.typeTone] += 1
    if (n.cancelled) stats.cancelled += 1
    else if (n.statusTone === 'live') stats.live += 1
  })
  return stats
}

module.exports = {
  noticeTypeTone,
  shortType,
  windowText,
  describeDates,
  decorateNotice,
  sortNotices,
  buildStats,
  TONE_LABEL
}
