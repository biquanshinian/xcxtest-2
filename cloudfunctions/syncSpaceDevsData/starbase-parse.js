/**
 * starbase.texas.gov/beach-road-access HTML 解析
 * 从 _legacy.js 抽出为独立模块（无云 SDK 依赖），便于用 node --test 做回归测试
 *
 * 页面结构：顶部滚动通知(Road Delay/Beach Closure) | BEACH Access Status | Road Updates | Public Notice of Mayor's Order
 * 注意官网即使存在延迟明细，Road Updates 区块也常驻 "No road delays." 占位文本，状态判定必须以明细/横幅证据优先
 */

const { decodeHtmlEntities } = require('./decode-html-entities.js')
const { enrichStarbaseParsedForStorage } = require('./starbase-i18n.js')

function stripHtmlTags(str) {
  const stripped = String(str || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return decodeHtmlEntities(stripped)
}

/** 按页面标题切分 HTML 文本块（对应官网 BEACH Access Status / Road Updates 等区域） */
function sliceStarbaseSection(html, startLabel, endLabels) {
  const plain = stripHtmlTags(html)
  const startIdx = plain.search(new RegExp(startLabel, 'i'))
  if (startIdx < 0) return ''
  let endIdx = plain.length
  for (const label of endLabels) {
    const i = plain.slice(startIdx + startLabel.length).search(new RegExp(label, 'i'))
    if (i >= 0) endIdx = Math.min(endIdx, startIdx + startLabel.length + i)
  }
  return plain.slice(startIdx, endIdx).trim()
}

// 月份同时支持缩写与全称：官网横幅写 "Jul. 17"，Road Updates 明细写 "July 17"（历史 bug：只认缩写导致明细整体解析为空）
const STARBASE_MONTH_SRC =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
// 单个时间点，例如 "July 17 11:30 AM" / "Jul. 17 11:30 AM" / "July 17, 2026 11:30 AM"
const STARBASE_TIME_POINT_SRC =
  `${STARBASE_MONTH_SRC}\\.?\\s+\\d{1,2}(?:,?\\s*\\d{4})?\\s+\\d{1,2}:\\d{2}\\s*(?:AM|PM)`

const STARBASE_TIME_RANGE_RE = new RegExp(
  `(${STARBASE_TIME_POINT_SRC}\\s+to\\s+${STARBASE_TIME_POINT_SRC})`,
  'gi'
)

const STARBASE_OPEN_SEMANTIC_RE =
  /当前无道路延迟|无道路延迟|无封路|未封路|正常通行|无管制|currently open|no road delays?|no closures?|roads?\s+open|beach\s+open/i

function isStarbaseOpenSemantic(text) {
  const s = String(text || '').trim()
  return !!s && STARBASE_OPEN_SEMANTIC_RE.test(s)
}

function isStarbaseRoadOpen(result) {
  return result.roadOpen === true || isStarbaseOpenSemantic(result.roadStatusLabel)
}

function uniqueStrings(list) {
  const out = []
  const seen = new Set()
  for (const item of list || []) {
    const s = String(item || '').replace(/\s+/g, ' ').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

// ── 时间语义：把官网文本时段解析为 epoch（America/Chicago） ──

const STARBASE_MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

const STARBASE_TIME_POINT_PARSE_RE = new RegExp(
  `(${STARBASE_MONTH_SRC})\\.?\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?\\s+(\\d{1,2}):(\\d{2})\\s*(AM|PM)`,
  'gi'
)

/** 当月第 n 个周日的日期（1-31），用于美国 DST 边界计算 */
function nthSundayOfMonth(year, monthIdx, n) {
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay()
  const firstSunday = ((7 - firstDow) % 7) + 1
  return firstSunday + (n - 1) * 7
}

/** 美国中部时区 UTC 偏移小时数：3月第二个周日至11月第一个周日为 CDT(UTC-5)，其余为 CST(UTC-6) */
function usCentralOffsetHours(year, monthIdx, day) {
  const dstStart = Date.UTC(year, 2, nthSundayOfMonth(year, 2, 2))
  const dstEnd = Date.UTC(year, 10, nthSundayOfMonth(year, 10, 1))
  const d = Date.UTC(year, monthIdx, day)
  return d >= dstStart && d < dstEnd ? 5 : 6
}

/** 德州 Boca Chica 当地墙钟时间 → epoch(ms) */
function centralEpoch(year, monthIdx, day, hour, minute) {
  return Date.UTC(year, monthIdx, day, hour, minute) + usCentralOffsetHours(year, monthIdx, day) * 3600000
}

/** 官网日期通常不带年份：取与 now 最接近的年份（处理跨年场景） */
function resolveYearByProximity(point, nowMs) {
  if (point.year) return point.year
  const nowYear = new Date(nowMs).getUTCFullYear()
  let best = nowYear
  let bestDiff = Infinity
  for (const y of [nowYear - 1, nowYear, nowYear + 1]) {
    const diff = Math.abs(centralEpoch(y, point.monthIdx, point.day, point.hour, point.minute) - nowMs)
    if (diff < bestDiff) {
      bestDiff = diff
      best = y
    }
  }
  return best
}

/**
 * 解析 "July 17 11:30 AM to July 17 2:30 PM" / "Jul. 17 11:30 AM to Jul. 17 2:30 PM" 等时段为 epoch
 * @returns {{ startAt: number, endAt: number } | null}
 */
function parseStarbaseTimeRange(text, nowMs) {
  const now = typeof nowMs === 'number' && nowMs > 0 ? nowMs : Date.now()
  const re = new RegExp(STARBASE_TIME_POINT_PARSE_RE.source, 'gi')
  const points = []
  let m
  while ((m = re.exec(String(text || ''))) !== null && points.length < 2) {
    const hour12 = parseInt(m[4], 10)
    if (hour12 < 1 || hour12 > 12) continue
    points.push({
      monthIdx: STARBASE_MONTH_INDEX[m[1].slice(0, 3).toLowerCase()],
      day: parseInt(m[2], 10),
      year: m[3] ? parseInt(m[3], 10) : null,
      hour: (hour12 % 12) + (/pm/i.test(m[6]) ? 12 : 0),
      minute: parseInt(m[5], 10)
    })
  }
  if (points.length < 2) return null

  const [p0, p1] = points
  const startYear = resolveYearByProximity(p0, now)
  const startAt = centralEpoch(startYear, p0.monthIdx, p0.day, p0.hour, p0.minute)
  let endYear = p1.year || startYear
  let endAt = centralEpoch(endYear, p1.monthIdx, p1.day, p1.hour, p1.minute)
  if (endAt < startAt) {
    // 跨年时段，例如 Dec 31 ... to Jan 1 ...
    endYear += 1
    endAt = centralEpoch(endYear, p1.monthIdx, p1.day, p1.hour, p1.minute)
  }
  return { startAt, endAt }
}

/** 汇总解析结果里所有可识别时段，得到整体窗口（最早开始 ~ 最晚结束） */
function computeStarbaseDelayWindow(result, nowMs) {
  const texts = []
  for (const u of result.roadUpdates || []) {
    if (u && u.date) texts.push(u.date)
  }
  for (const s of result.roadDelays || []) texts.push(s)
  for (const s of result.bannerAlerts || []) texts.push(s)
  for (const s of result.beachClosureSchedule || []) texts.push(s)

  let startAt = 0
  let endAt = 0
  for (const t of texts) {
    const win = parseStarbaseTimeRange(t, nowMs)
    if (!win) continue
    if (!startAt || win.startAt < startAt) startAt = win.startAt
    if (!endAt || win.endAt > endAt) endAt = win.endAt
  }
  return startAt && endAt ? { startAt, endAt } : null
}

/** 按解析出的时段去重（横幅 "Jul. 17" 与明细 "July 17" 是同一时段的不同写法） */
function dedupeDelayRanges(list) {
  const out = []
  const seen = new Set()
  for (const item of list || []) {
    const s = String(item || '').replace(/\s+/g, ' ').trim()
    if (!s) continue
    const win = parseStarbaseTimeRange(s)
    const key = win ? `${win.startAt}-${win.endAt}` : s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

// ── 区块解析 ──

function parseBeachClosureSlots(sectionText, fullText) {
  const slots = []
  let source = String(sectionText || fullText || '').replace(/\s+/g, ' ')
  if (!source) return []

  // 官网常把时段与下一标签粘在一起，例如 "11:00 PMPrimary: May. 21 ..."
  source = source.replace(/(\d{1,2}:\d{2}\s*(?:AM|PM))(Primary|Backup)\s*:/gi, '$1 $2:')

  const slotRe = /(Primary|Backup)\s*:\s*([\s\S]*?)(?=\s*(?:Primary|Backup)\s*:|$)/gi
  let sm
  while ((sm = slotRe.exec(source)) !== null) {
    let timeText = sm[2].replace(/\s+/g, ' ').trim()
    const rangeMatch = timeText.match(STARBASE_TIME_RANGE_RE)
    if (rangeMatch) {
      timeText = rangeMatch[0].replace(/\s+/g, ' ').trim()
    } else if (!/(?:AM|PM)/i.test(timeText)) {
      continue
    }
    const kind = sm[1].charAt(0).toUpperCase() + sm[1].slice(1).toLowerCase()
    slots.push(`${kind}: ${timeText}`)
  }
  if (slots.length > 0) return uniqueStrings(slots)

  const chunks = source.split(/(?=(?:Primary|Backup)\s*:)/i).filter(Boolean)
  for (const chunk of chunks) {
    const m = chunk.match(/^(Primary|Backup)\s*:\s*(.+)$/i)
    if (!m) continue
    const timeText = m[2].replace(/\s+/g, ' ').trim()
    if (!timeText) continue
    slots.push(`${m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()}: ${timeText}`)
  }
  if (slots.length > 0) return uniqueStrings(slots)

  const fallback = []
  let tm
  const re = new RegExp(STARBASE_TIME_RANGE_RE.source, 'gi')
  while ((tm = re.exec(source)) !== null) {
    fallback.push(tm[1].replace(/\s+/g, ' ').trim())
  }
  return uniqueStrings(fallback)
}

function parseRoadUpdateItems(sectionText, fullText) {
  const items = []
  const seen = new Set()
  const sources = [sectionText, fullText].filter((s) => String(s || '').trim())
  const descRe = new RegExp(
    `Description\\s*:\\s*(.+?)\\s*Date\\s*:\\s*(${STARBASE_TIME_POINT_SRC}\\s+to\\s+${STARBASE_TIME_POINT_SRC})`,
    'gi'
  )

  for (const source of sources) {
    descRe.lastIndex = 0
    let dm
    while ((dm = descRe.exec(source)) !== null) {
      const description = dm[1].replace(/\s+/g, ' ').trim()
      const date = dm[2].replace(/\s+/g, ' ').trim()
      const key = `${description}|${date}`.toLowerCase()
      if (!description || seen.has(key)) continue
      seen.add(key)
      items.push({ description, date })
    }
  }
  return items
}

/**
 * 根据 roadUpdates / 横幅 / 页面文案统一道路开放状态。
 * 官网即使有延迟明细也常驻 "No road delays." 占位文本，因此明细与横幅证据优先于该文案。
 */
function resolveStarbaseRoadStatus(result, roadPlain, fullPlain, roadSectionDelays) {
  const hasUpdates = (result.roadUpdates || []).length > 0
  const hasRoadSectionDelays = Array.isArray(roadSectionDelays) && roadSectionDelays.length > 0
  const stripNoDelay = (s) => String(s || '').replace(/no\s+road\s+delays?\.?/gi, ' ')
  const bannerHasRoadDelay = (result.bannerAlerts || []).some((a) =>
    /road\s+(?:delay|closure)/i.test(stripNoDelay(a))
  )

  const sectionSaysNoDelay = /no\s+road\s+delays?\.?/i.test(String(roadPlain || ''))
  const fullSaysNoDelay = /no\s+road\s+delays?\.?/i.test(String(fullPlain || ''))
  if ((sectionSaysNoDelay || fullSaysNoDelay) && !hasUpdates && !hasRoadSectionDelays && !bannerHasRoadDelay) {
    result.roadOpen = true
    result.roadStatusLabel = '当前无道路延迟'
    return
  }

  const pageHasRoadDelay = /road\s+delay/i.test(stripNoDelay(roadPlain)) || /road\s+delay/i.test(stripNoDelay(fullPlain))
  const hasActiveDelay = hasUpdates || hasRoadSectionDelays || bannerHasRoadDelay || pageHasRoadDelay

  if (hasActiveDelay) {
    result.roadOpen = false
    result.roadStatusLabel = '道路延迟'
    return
  }

  if (/road\s+closure/i.test(String(roadPlain || '')) || /road\s+closure/i.test(String(fullPlain || ''))) {
    result.roadOpen = false
    result.roadStatusLabel = '道路管制中'
  }
}

function parseBannerAlerts(html, fullText) {
  const alerts = []
  const ticker = stripHtmlTags(
    (html.match(/notification-message[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ''
  )
  if (ticker) {
    ticker.split('|').forEach((part) => {
      const s = part.replace(/\s+/g, ' ').trim()
      if (s && /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(s)) alerts.push(s)
    })
  }
  // 页面头部滚动横幅：连同前缀标签（Road Delay / Beach Closure）一起捕获，供状态判定识别类型
  const labeledRe = new RegExp(
    `((?:(?:Road|Beach)\\s+(?:Delay|Closure)s?\\s+)?${STARBASE_TIME_POINT_SRC}\\s+to\\s+${STARBASE_TIME_POINT_SRC})`,
    'gi'
  )
  let tm
  const head = fullText.slice(0, 1200)
  while ((tm = labeledRe.exec(head)) !== null) {
    alerts.push(tm[1].replace(/\s+/g, ' ').trim())
  }
  return uniqueStrings(alerts)
}

/** 市长令区块：标题锚点为「令号 + 紧跟 Pursuant 正文」，正文里引用的 "Order No. xxxx-xx," 不会误切 */
function parsePublicOrders(noticeSection) {
  const orders = []
  const heads = []
  const orderHeadRe = /Order\s+No\.?\s*(\d[\d-]*)\s*(?=Pursuant)/gi
  let om
  while ((om = orderHeadRe.exec(noticeSection)) !== null) {
    heads.push({ orderNo: 'Order No. ' + om[1].trim(), bodyStart: om.index + om[0].length, matchIndex: om.index })
  }

  for (let i = 0; i < heads.length; i++) {
    const blockEnd = i + 1 < heads.length ? heads[i + 1].matchIndex : noticeSection.length
    const rest = noticeSection.slice(heads[i].bodyStart, blockEnd).trim()
    const bodyMatch = rest.match(
      /^([\s\S]*?)(?:Primary\s+Closure\s+Period|Alternate\s+Dates|Revocation\s+of\s+Closure|$)/i
    )
    const period = rest.match(
      /Primary\s+Closure\s+Period\s+([\s\S]*?)(?:Alternate\s+Dates|Revocation\s+of\s+Closure|$)/i
    )
    const alt = rest.match(/Alternate\s+Dates?\s+([\s\S]*?)(?:Revocation\s+of\s+Closure|Order\s+No|$)/i)
    const rev = rest.match(/Revocation\s+of\s+Closure\s+([\s\S]*?)(?=Order\s+No|$)/i)
    orders.push({
      orderNo: heads[i].orderNo,
      bodyText: bodyMatch ? bodyMatch[1].replace(/\s+/g, ' ').trim() : '',
      primaryPeriod: period ? period[1].replace(/\s+/g, ' ').trim() : '',
      alternateDates: alt ? alt[1].replace(/\s+/g, ' ').trim() : '',
      revocation: rev ? rev[1].replace(/\s+/g, ' ').trim() : ''
    })
  }
  return orders
}

/**
 * 解析 starbase.texas.gov/beach-road-access HTML
 * @param {string} html
 * @param {number} [nowMs] 供测试注入的当前时间（影响无年份日期的年份推断）
 */
function parseStarbaseHtml(html, nowMs) {
  const now = typeof nowMs === 'number' && nowMs > 0 ? nowMs : Date.now()
  const result = {
    success: true,
    beachOpen: null,
    roadOpen: null,
    beachStatus: '',
    roadDelays: [],
    beachClosureSchedule: [],
    roadUpdates: [],
    publicNotice: '',
    publicOrders: [],
    bannerAlerts: [],
    roadStatusLabel: '',
    message: '',
    timeRange: '',
    delayWindow: null,
    fetchedAt: now
  }

  const text = stripHtmlTags(html)
  const beachSection = sliceStarbaseSection(html, 'BEACH Access Status', [
    'Road Updates',
    'Public Notice',
    'OTHER BEACHES'
  ])
  const roadSection = sliceStarbaseSection(html, 'Road Updates', [
    'Public Notice',
    'OTHER BEACHES',
    'Surf Report'
  ])

  result.bannerAlerts = parseBannerAlerts(html, text)
  result.beachClosureSchedule = parseBeachClosureSlots(beachSection, text)
  result.roadUpdates = parseRoadUpdateItems(roadSection, text)

  // 海滩开放状态（官网文案有 "beach is currently open/closed" 与 "Boca Chica Beach is open/closed." 两种写法）
  if (
    /beach\s+is\s+currently\s+closed/i.test(text) ||
    /Boca\s+Chica\s+Beach\s+is\s+closed/i.test(text) ||
    /beach\s+closures?/i.test(beachSection)
  ) {
    result.beachOpen = false
    result.beachStatus = 'Boca Chica Beach 当前已关闭'
  } else if (
    /beach\s+is\s+currently\s+open/i.test(text) ||
    /Boca\s+Chica\s+Beach\s+is\s+open/i.test(text)
  ) {
    result.beachOpen = true
    result.beachStatus = 'Boca Chica Beach 当前开放'
  } else if (result.beachClosureSchedule.length > 0) {
    result.beachOpen = false
    result.beachStatus = 'Boca Chica Beach 计划封闭时段'
  }

  // 道路状态（Road Updates 区块）：有具体更新项时优先于页面上的 "No road delays."
  const roadPlain = roadSection || ''
  if (roadPlain) {
    let rm
    const delayRe = new RegExp(STARBASE_TIME_RANGE_RE.source, 'gi')
    while ((rm = delayRe.exec(roadPlain)) !== null) {
      result.roadDelays.push(rm[1].replace(/\s+/g, ' ').trim())
    }
  }
  const roadSectionDelays = uniqueStrings(result.roadDelays.slice())
  resolveStarbaseRoadStatus(result, roadPlain, text, roadSectionDelays)
  if (isStarbaseRoadOpen(result) || (result.beachOpen === true && result.roadOpen !== false)) {
    // 道路开放时不把横幅并入延迟明细；bannerAlerts 本身保留（证据不清空）
    result.roadDelays = roadSectionDelays
  } else {
    result.roadDelays = dedupeDelayRanges(result.roadDelays.concat(result.bannerAlerts))
  }

  // Public Notice — 市长令
  const noticeSection = sliceStarbaseSection(html, 'Public Notice', ['OTHER BEACHES', 'Surf Report', 'Previous Orders'])
  result.publicOrders = parsePublicOrders(noticeSection)
  if (result.publicOrders.length > 0) {
    const latest = result.publicOrders[0]
    result.publicNotice = [latest.bodyText, latest.primaryPeriod, latest.alternateDates]
      .filter(Boolean)
      .join('\n')
  }

  const msgParts = []
  if (result.beachStatus) msgParts.push(result.beachStatus)
  const roadLabelConflictsWithUpdates =
    result.roadUpdates.length > 0 && /无道路延迟/.test(result.roadStatusLabel || '')
  if (result.roadStatusLabel && !roadLabelConflictsWithUpdates) {
    msgParts.push(result.roadStatusLabel)
  }
  if (result.beachClosureSchedule.length > 0) {
    msgParts.push(result.beachClosureSchedule.slice(0, 3).join('；'))
  }
  if (result.roadUpdates.length > 0) {
    const roadLines = result.roadUpdates
      .slice(0, 2)
      .map((u) => `${u.description}（${u.date}）`)
    msgParts.push(roadLines.join('；'))
  }
  result.message = msgParts.join('\n') || ''

  if (result.beachClosureSchedule.length > 0) {
    result.timeRange = result.beachClosureSchedule.join('\n')
  } else if (result.roadDelays.length > 0 && !isStarbaseRoadOpen(result)) {
    result.timeRange = result.roadDelays.slice(0, 3).join('\n')
  } else if (result.publicNotice) {
    result.timeRange = result.publicNotice
  }

  // 二次校正：若明细存在则不得标记为无延迟
  resolveStarbaseRoadStatus(result, roadPlain, text, roadSectionDelays)

  // 整体时间窗（须在 i18n 转换前基于英文文本计算）
  result.delayWindow = computeStarbaseDelayWindow(result, now)

  enrichStarbaseParsedForStorage(result)

  return result
}

module.exports = {
  stripHtmlTags,
  sliceStarbaseSection,
  STARBASE_TIME_RANGE_RE,
  isStarbaseOpenSemantic,
  isStarbaseRoadOpen,
  uniqueStrings,
  usCentralOffsetHours,
  parseStarbaseTimeRange,
  computeStarbaseDelayWindow,
  parseBeachClosureSlots,
  parseRoadUpdateItems,
  resolveStarbaseRoadStatus,
  parseBannerAlerts,
  parsePublicOrders,
  parseStarbaseHtml
}
