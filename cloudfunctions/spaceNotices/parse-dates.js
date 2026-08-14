/**
 * SPACE_NOTICES_FEATURE — ICAO B)/C) 时间窗解析
 * 缺 dates.start 时用原文回填，才能把「尚未生效」标成提前预警。
 */

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

function toIso(ms) {
  if (!ms) return undefined
  const d = new Date(ms)
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined
}

function fillNoticeDates(dates, rawText) {
  const listed = (Array.isArray(dates) ? dates : []).filter((d) => d && (d.start || d.end))
  const hasStart = listed.some((d) => d && d.start)
  if (listed.length && hasStart) return listed
  const w = parseIcaoWindow(rawText || '')
  if (!w) return listed
  const row = { start: toIso(w.start), end: w.perm ? undefined : toIso(w.end) }
  if (!row.start && !row.end) return listed
  return [row]
}

module.exports = {
  parseIcaoWindow,
  fillNoticeDates
}
