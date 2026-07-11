/**
 * Launch Library 2.3 launch.timeline 辅助
 * 单条形态：{ type: { id, abbrev, description }, relative_time: "-PT53M" }
 */

/** @param {string} str */
function parseIso8601DurationToSeconds(str) {
  if (!str || typeof str !== 'string') return 0
  const trimmed = str.trim()
  const negative = trimmed[0] === '-'
  const body = negative ? trimmed.slice(1) : trimmed
  if (!/^P/i.test(body)) return 0
  const m = body.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m) return 0
  const days = parseInt(m[1] || '0', 10) || 0
  const hours = parseInt(m[2] || '0', 10) || 0
  const minutes = parseInt(m[3] || '0', 10) || 0
  const seconds = parseFloat(m[4] || '0') || 0
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds
  return negative ? -total : total
}

/** 相对于 T0 的秒数 → T-50:00 / T+1:05:17 */
function formatTimelineClock(seconds) {
  const rounded = Math.round(Number(seconds) || 0)
  if (rounded === 0) return 'T-0'
  const neg = rounded < 0
  const abs = Math.abs(rounded)
  const sign = neg ? 'T-' : 'T+'
  const h = Math.floor(abs / 3600)
  const mm = Math.floor((abs % 3600) / 60)
  const ss = abs % 60
  if (h > 0) {
    return sign + h + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
  }
  return sign + mm + ':' + String(ss).padStart(2, '0')
}

/**
 * 时间线节点几何类型（用于 CSS 单色形状，不使用 emoji）
 * @returns {'lift'|'diamond'|'square'|'ring'|'solid'|'dot'}
 */
function timelineIconVariant(abbrev, description) {
  const a = String(abbrev || '').toLowerCase()
  const d = String(description || '').toLowerCase()
  const hay = `${a} ${d}`
  if (a.includes('liftoff') || a.includes('ignition') || hay.includes('liftoff')) return 'lift'
  if (a.includes('max-q') || hay.includes('max q')) return 'diamond'
  if (a.includes('separation') || a.includes('meco')) return 'square'
  if (a.includes('burn')) return 'solid'
  if (a.includes('landing') || a.includes('splashdown')) return 'ring'
  if (a.includes('go for')) return 'ring'
  if (a.includes('excitement')) return 'dot'
  if (
    a.includes('chill') ||
    a.includes('lox') ||
    a.includes('lng') ||
    a.includes('propellant') ||
    hay.includes(' load')
  ) {
    return 'dot'
  }
  return 'dot'
}

/**
 * @param {{ abbrev?: string, description?: string, relativeTime?: string, id?: string }} row
 */
function enrichLl2TimelineRow(row, idx) {
  const abbrev = String((row && row.abbrev) || '').trim()
  const relativeTime = String((row && row.relativeTime) || '').trim()
  const sec = parseIso8601DurationToSeconds(relativeTime)
  const desc = String((row && row.description) || '').trim()
  const baseId = String((row && row.id) != null ? row.id : 'tl')
  const id = baseId + '_' + idx
  const title = abbrev || desc || '里程碑'
  const isHighlight = /liftoff/i.test(abbrev)
  return {
    id,
    title,
    description: desc && desc !== abbrev ? desc : '',
    relativeTimeRaw: relativeTime,
    timeLabel: formatTimelineClock(sec),
    sortKey: sec,
    iconVariant: timelineIconVariant(abbrev, desc),
    isHighlight,
    titleClass: isHighlight ? 'll2-timeline-title ll2-timeline-title--lift' : 'll2-timeline-title'
  }
}

/**
 * @param {Array<{ abbrev?: string, description?: string, relativeTime?: string, id?: string }>} list
 */
function normalizeLl2TimelineList(list) {
  if (!Array.isArray(list)) return []
  const enriched = list.map((row, i) => enrichLl2TimelineRow(row, i))
  enriched.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0))
  return enriched
}

module.exports = {
  parseIso8601DurationToSeconds,
  formatTimelineClock,
  timelineIconVariant,
  enrichLl2TimelineRow,
  normalizeLl2TimelineList
}
