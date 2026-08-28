/**
 * SPACE_NOTICES_FEATURE — 通告展示层格式化（纯函数，便于单测）
 * 生效状态按 dates 窗口与当前时间推导：生效中 / 提前预警 / 已结束 / 已取消。
 * 缺 start 时从原文 B)/C) 回填。时间一律转本地时区展示。
 * 条目卡片：任务/火箭/机构汉化 + 火箭配置图（与列表卡同源 resolveMissionRocketImage）。
 */
const { formatDate, getRocketImage, resolveMissionRocketImage } = require('../../../../utils/util.js')
const { pickLocalized, isContentLangEn } = require('../../../../utils/locale.js')
const { translateRocketName } = require('../../../../utils/rocket-name-i18n.js')
const { localizeMissionTitle } = require('../../../../utils/mission-title-i18n.js')
const { translateAgencyName } = require('../../../../utils/agency-name-i18n.js')
const { isChinaNotice, noticeChinaVisible, isChineseCollectionKey, firCodeFromNotice, firLabel } = require('./china-filter.js')
const { parseNotamMeta } = require('./notam-meta.js')

const TONE_LABEL = { notam: '航空 NOTAM', nav: '航海警告', adp: '空域走廊' }

/**
 * 站点 slug（launch-f9-starlink-10-19）→ 可读英文任务/火箭名，供词典与配图匹配
 * @returns {{ missionName: string, rocketName: string }}
 */
function humanizeEntrySlug(entryKey) {
  const key = String(entryKey || '').trim()
  if (!/^launch[-_]/i.test(key)) return { missionName: '', rocketName: '' }
  let body = key.replace(/^launch[-_]/i, '')
  let rocketName = ''
  const rocketRules = [
    [/^f9[-_]/i, 'Falcon 9'],
    [/^fh[-_]/i, 'Falcon Heavy'],
    [/^falcon[-_]?9[-_]/i, 'Falcon 9'],
    [/^falcon[-_]?heavy[-_]/i, 'Falcon Heavy'],
    [/^starship[-_]/i, 'Starship'],
    [/^electron[-_]/i, 'Electron'],
    [/^new[-_]?glenn[-_]/i, 'New Glenn'],
    [/^cz[-_]?(\d+[a-z]*)[-_]?/i, function (m, n) { return 'Long March ' + String(n || '').toUpperCase() }],
    [/^long[-_]?march[-_]?(\d+[a-z]*)[-_]?/i, function (m, n) { return 'Long March ' + String(n || '').toUpperCase() }]
  ]
  for (let i = 0; i < rocketRules.length; i += 1) {
    const re = rocketRules[i][0]
    const nameOrFn = rocketRules[i][1]
    const m = body.match(re)
    if (!m) continue
    rocketName = typeof nameOrFn === 'function' ? nameOrFn(m[0], m[1]) : nameOrFn
    body = body.slice(m[0].length)
    break
  }
  let missionName = body.replace(/[-_]+/g, ' ').trim()
  const sl = missionName.match(/^starlink\s+(\d+)\s+(\d+)$/i)
  if (sl) {
    missionName = 'Starlink Group ' + sl[1] + '-' + sl[2]
  } else if (/^starlink\b/i.test(missionName)) {
    missionName = missionName.replace(/^starlink\s*/i, 'Starlink Group ').replace(/\s+/g, ' ').trim()
  } else if (/^flight\s+(\d+)$/i.test(missionName)) {
    missionName = missionName.replace(/^flight\s+/i, 'Flight ')
  } else if (missionName) {
    missionName = missionName.replace(/\b([a-z])/g, function (c) { return c.toUpperCase() })
  }
  return { missionName: missionName || '', rocketName: rocketName || '' }
}

/**
 * 列表 / 地图共用：条目展示字段（汉化标题、火箭、机构 + 圆形配置图用 URL）
 */
function decorateSpaceNoticeEntry(e) {
  const row = e && typeof e === 'object' ? e : {}
  const key = String(row.entryKey || '').trim()
  let missionEn = String(row.missionName || '').trim()
  let rocketEn = String(row.rocketName || '').trim()
  const looksLikeSlug =
    !missionEn ||
    missionEn === key ||
    /^launch[-_]/i.test(missionEn)
  if (looksLikeSlug || !rocketEn) {
    const hum = humanizeEntrySlug(key)
    if (looksLikeSlug && hum.missionName) missionEn = hum.missionName
    if (!rocketEn && hum.rocketName) rocketEn = hum.rocketName
  }
  if (!rocketEn && row.isStarship) rocketEn = 'Starship'

  let rocketZh = translateRocketName(rocketEn) || rocketEn
  let missionZh = localizeMissionTitle(missionEn, rocketEn, rocketZh) || missionEn
  if (isChineseCollectionKey(key) || /chinese notices/i.test(missionEn)) {
    missionZh = '中国航警公告'
    if (!rocketEn || /unknown/i.test(rocketEn)) rocketZh = '未知发射'
  }
  const agencyEn = String(row.agency || '').trim()
  const agencyZh = translateAgencyName(agencyEn) || agencyEn

  const title = pickLocalized(missionZh, missionEn) || key || (isContentLangEn() ? 'Untitled' : '未命名任务')
  const subtitle =
    pickLocalized(rocketZh, rocketEn) ||
    (isContentLangEn() ? 'Launch' : '发射任务')
  const agencyDisplay = pickLocalized(agencyZh, agencyEn)

  // 与详情/列表卡同源：空 stamp + 英文火箭名 forceRecompute
  const rocketImage =
    resolveMissionRocketImage('', rocketEn || rocketZh, null, true) ||
    getRocketImage(rocketEn || rocketZh) ||
    ''

  return Object.assign({}, row, {
    missionNameEn: missionEn,
    rocketNameEn: rocketEn,
    title,
    subtitle,
    agencyDisplay,
    rocketImage
  })
}

/** 页头 / 定位角标共用：任意通告条目都走同一套任务名汉化 */
function spaceNoticeDisplayTitle(entry) {
  const row = entry && typeof entry === 'object' ? entry : {}
  return decorateSpaceNoticeEntry({
    entryKey: row.entryKey || '',
    missionName: row.missionName || row.siteTitle || '',
    rocketName: row.rocketName || '',
    isStarship: row.isStarship,
    agency: row.agency
  }).title
}

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

/** ICAO B)/C) yyMMddHHmm（UTC） */
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

/**
 * 优先用库内 dates；缺 start 时用原文 B)/C) 回填，避免「只有结束时间」被当成已生效。
 */
function datesFromNotice(notice) {
  const n = notice || {}
  const listed = (Array.isArray(n.dates) ? n.dates : []).filter((d) => d && (d.start || d.end))
  const hasStart = listed.some((d) => d && d.start)
  if (listed.length && hasStart) return listed
  const w = parseIcaoWindow(n.rawText || '')
  if (!w) return listed
  return [{ start: w.start || undefined, end: w.perm ? undefined : w.end || undefined }]
}

function remainingLead(start, at) {
  const ms = start - at
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const mins = Math.round(ms / 60000)
  if (mins < 60) return mins + ' 分钟后生效'
  const hours = Math.round(mins / 60)
  if (hours < 48) return hours + ' 小时后生效'
  const days = Math.round(hours / 24)
  return days + ' 天后生效'
}

/**
 * @param {object[]} dates [{ start, end }]
 * @param {boolean} [cancelled]
 * @param {number} [now] 注入当前时间便于测试
 * @returns {{statusText:string, statusTone:string, timeText:string, leadText:string, windows:object[]}}
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
      leadText: '',
      windows
    }
  }
  if (!list.length) return { statusText: '', statusTone: '', timeText: '', leadText: '', windows }
  const active = list.find((d) => (!d.start || d.start <= at) && (!d.end || d.end >= at))
  if (active) {
    return {
      statusText: '生效中',
      statusTone: 'live',
      timeText: windowText(active.start, active.end),
      leadText: '',
      windows
    }
  }
  const next = list.find((d) => d.start && d.start > at)
  if (next) {
    const leadText = remainingLead(next.start, at)
    const win = windowText(next.start, next.end)
    return {
      statusText: '提前预警',
      statusTone: 'soon',
      timeText: leadText ? leadText + (win ? ' · ' + win : '') : win,
      leadText,
      windows
    }
  }
  const last = list[list.length - 1]
  return {
    statusText: '已结束',
    statusTone: 'off',
    timeText: windowText(last.start, last.end),
    leadText: '',
    windows
  }
}

/** A3624/26、HYDROPAC 2308/26 — 用户对照官网编号用 */
function extractNotamSeries(notice) {
  const n = notice || {}
  const name = String(n.name || '')
  const key = String(n.noticeKey || '')
  const raw = String(n.rawText || '')
  const blob = name + '\n' + key + '\n' + raw
  const hyd = blob.match(/HYDROPAC\s*(\d+)\s*\/\s*(\d+)/i)
  if (hyd) return 'HYDROPAC ' + hyd[1] + '/' + hyd[2]
  const series = blob.match(/\b([A-Z]\d{3,5}\/\d{2})\b/)
  if (series) return series[1].toUpperCase()
  const fromKey = key.match(/([A-Z]\d{3,5})[-_/](\d{2})/i)
  if (fromKey) return fromKey[1].toUpperCase() + '/' + fromKey[2]
  return name.trim()
}

function chinaNoticeTitle(notice, firCode, series) {
  const label = firLabel(firCode)
  const num = String(series || '').trim()
  if (label && num) return label + ' · ' + num
  return num || label || String((notice && notice.name) || '')
}

function decorateNotice(notice, hasGeometry, now) {
  const n = notice || {}
  const tone = noticeTypeTone(n.type)
  const dates = datesFromNotice(n)
  const d = describeDates(dates, n.cancelled, now)
  const firCode = firCodeFromNotice(n)
  const series = extractNotamSeries(n)
  const label = firLabel(firCode)
  const meta = parseNotamMeta(Object.assign({}, n, { dates }), now)
  return Object.assign({}, n, meta, {
    typeTone: tone,
    typeLabel: TONE_LABEL[tone] || 'NOTAM',
    typeShort: shortType(n.type),
    statusText: d.statusText,
    statusTone: d.statusTone,
    timeText: d.timeText,
    leadText: d.leadText || '',
    windows: d.windows,
    fir: meta.fir || firCode,
    firCode,
    firLabel: label,
    series,
    displayName: chinaNoticeTitle(n, firCode, series),
    inChina: isChinaNotice(n),
    hasGeo: typeof hasGeometry === 'function' ? !!hasGeometry(n) : false,
    rawLines: n.rawText
      ? String(n.rawText)
          .split(/\r?\n/)
          .filter((s) => s.trim())
          .map((text, i) => ({ i, text }))
      : []
  })
}

/**
 * 中国航警公告的核对文案：检查时间 ≠ 内容变化时间。
 * 源站没有推送，只能定时拉；哈希没变就告诉用户「没有新航警」。
 */
function formatChinaBulletinSync(entry, now) {
  const cadenceText = '约 15 分钟核对一次全国情报区，有新航警才刷新'
  const row = entry && typeof entry === 'object' ? entry : {}
  const checked = Number(row.lastCheckedAt) || Number(row.syncedAt) || 0
  const changed = Number(row.lastChangedAt) || 0
  if (!checked) {
    return {
      checkText: '还没有自动核对',
      changeText: '点开后会拉取最新航警',
      unchanged: true,
      cadenceText,
      syncLine: '还没有自动核对 · 点开后会拉取最新航警'
    }
  }
  const at = now instanceof Date ? now : new Date(now || Date.now())
  const checkClock = formatDate(new Date(checked), 'HH:mm')
  const sameDay = formatDate(new Date(checked), 'YYYY-MM-DD') === formatDate(at, 'YYYY-MM-DD')
  const checkText = sameDay ? ('上次核对 ' + checkClock) : ('上次核对 ' + formatDate(new Date(checked), 'MM-DD HH:mm'))
  const unchanged = !changed || Math.abs(checked - changed) > 90 * 1000
  const changeText = unchanged ? '这一轮没有新航警' : '刚收到新航警'
  return {
    checkText,
    changeText,
    unchanged,
    cadenceText,
    syncLine: checkText + ' · ' + changeText
  }
}

/** 生效中优先、提前预警其次、已取消垫底；同级把有坐标图形的排前面 */
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
  const stats = { notam: 0, nav: 0, adp: 0, live: 0, soon: 0, ended: 0, cancelled: 0, china: 0 }
  ;(notices || []).forEach((n) => {
    if (stats[n.typeTone] != null) stats[n.typeTone] += 1
    if (n.inChina) stats.china += 1
    if (n.cancelled) stats.cancelled += 1
    else if (n.statusTone === 'live') stats.live += 1
    else if (n.statusTone === 'soon') stats.soon += 1
    else if (n.statusTone === 'off') stats.ended += 1
  })
  return stats
}

/** 状态图层开关：默认全开。cancelled 优先于 tone=off。 */
function noticeStatusVisible(n, flags) {
  const f = flags || {}
  if (n && n.cancelled) return f.showCancelled !== false
  const tone = n && n.statusTone
  if (tone === 'live') return f.showLive !== false
  if (tone === 'soon') return f.showSoon !== false
  if (tone === 'off') return f.showEnded !== false
  return true
}

module.exports = {
  noticeTypeTone,
  shortType,
  windowText,
  parseIcaoWindow,
  datesFromNotice,
  remainingLead,
  describeDates,
  decorateNotice,
  extractNotamSeries,
  chinaNoticeTitle,
  formatChinaBulletinSync,
  decorateSpaceNoticeEntry,
  spaceNoticeDisplayTitle,
  humanizeEntrySlug,
  sortNotices,
  buildStats,
  noticeStatusVisible,
  noticeChinaVisible,
  TONE_LABEL
}
