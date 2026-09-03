export function parseDate(str) {
  if (!str) return null
  if (str instanceof Date) {
    return isNaN(str.getTime()) ? null : new Date(str.getFullYear(), str.getMonth(), str.getDate())
  }
  const normalized = String(str).replace(/\./g, '-').replace(/\//g, '-')
  const parts = normalized.slice(0, 10).split('-')
  if (parts.length < 3) return null
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

export function formatDate(value) {
  const date = value instanceof Date ? value : parseDate(value)
  if (!date) return ''
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

export function today() {
  return formatDate(new Date())
}

export function addDays(str, n) {
  const date = parseDate(str)
  if (!date) return ''
  date.setDate(date.getDate() + n)
  return formatDate(date)
}

export function compare(a, b) {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da || !db) return null
  const ta = da.getTime()
  const tb = db.getTime()
  if (ta === tb) return 0
  return ta < tb ? -1 : 1
}

export function lte(a, b) {
  const result = compare(a, b)
  return result === null ? null : result <= 0
}

export function lt(a, b) {
  const result = compare(a, b)
  return result === null ? null : result < 0
}

export function inRangeInclusive(date, start, end) {
  const d = parseDate(date)
  const s = parseDate(start)
  const e = parseDate(end)
  if (!d || !s || !e) return null
  const t = d.getTime()
  return t >= s.getTime() && t <= e.getTime()
}

export function noticeEnd(start, days) {
  const span = days || 7
  return addDays(start, span - 1)
}

export function inclusiveDayCount(start, end) {
  const a = parseDate(start)
  const b = parseDate(end)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

export function maxDate(list) {
  let best = ''
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item) continue
    if (!best || compare(best, item) < 0) best = item
  }
  return best
}

export function minDate(list) {
  let best = ''
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item) continue
    if (!best || compare(item, best) < 0) best = item
  }
  return best
}
