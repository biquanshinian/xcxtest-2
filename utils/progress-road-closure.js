const EMPTY_ROAD_CLOSURE = {
  isActive: false,
  message: '',
  timeRange: '',
  source: '',
  beachClosureSchedule: [],
  roadDelays: [],
  roadUpdates: [],
  bannerAlerts: []
}

const OPEN_SEMANTIC_RE = /当前开放|正常通行|无道路延迟|无封路|未封路|无管制|currently open|no road delays|no closures?|roads?\s+open|beach\s+open|道路.*开放|海滩.*开放/i

function isOpenSemanticText(text) {
  const s = String(text || '').trim()
  return !!s && OPEN_SEMANTIC_RE.test(s)
}

function isClosureLine(item) {
  const s = String((item && item.description) || item || '').trim()
  if (!s) return false
  return !OPEN_SEMANTIC_RE.test(s)
}

function hasValidRoadClosure(data) {
  if (!data || data.isActive !== true) return false
  const toArr = (v) => (Array.isArray(v) ? v : [])
  const beachClosed = data.beachOpen === false
  const roadClosed = data.roadOpen === false
  if (beachClosed || roadClosed) return true

  const schedule = toArr(data.beachClosureSchedule).filter(isClosureLine)
  const roadUpdates = toArr(data.roadUpdates).filter(isClosureLine)
  const publicOrders = toArr(data.publicOrders)
  if (schedule.length > 0 || roadUpdates.length > 0 || publicOrders.length > 0) return true

  const roadOpenSignal = data.roadOpen === true || isOpenSemanticText(data.roadStatusLabel)
  const delays = roadOpenSignal ? [] : toArr(data.roadDelays).filter(isClosureLine)
  const banners = roadOpenSignal ? [] : toArr(data.bannerAlerts).filter(isClosureLine)
  if (delays.length > 0 || banners.length > 0) return true

  if (data.beachOpen != null || data.roadOpen != null) return false

  const msg = String(data.message || '').trim()
  const hasMessage = !!msg && !isOpenSemanticText(msg)
  const hasTimeWindow = !!String(data.timeRange || '').trim() || !!(data.startTime && data.endTime)
  return hasMessage || hasTimeWindow
}

function isRoadClosureFetchFailed(data) {
  return !!(data && (data.fetchFailed === true || data.__fetchError === true))
}

function resolveRoadClosureStatus(data, options) {
  const opt = options || {}
  if (opt.loading) return 'loading'
  if (opt.error || isRoadClosureFetchFailed(data)) return 'error'
  if (hasValidRoadClosure(data)) return 'active'
  return 'clear'
}

function flattenTickerPart(text) {
  return String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tickerContains(hay, needle) {
  const a = flattenTickerPart(hay).replace(/\s+/g, '')
  const b = flattenTickerPart(needle).replace(/\s+/g, '')
  return !!a && !!b && a.indexOf(b) >= 0
}

function pushTickerUnique(parts, value) {
  const s = flattenTickerPart(value)
  if (!s) return
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === s || tickerContains(p, s)) return
    if (tickerContains(s, p)) {
      parts[i] = s
      return
    }
  }
  parts.push(s)
}

function formatRoadUpdateLine(item) {
  if (!item) return ''
  if (typeof item === 'object') {
    const desc = flattenTickerPart(item.description)
    const date = flattenTickerPart(item.date)
    if (desc && date) return desc + '（' + date + '）'
    return desc || date
  }
  return flattenTickerPart(item)
}

/**
 * 首页灯箱跑马灯文案：压成单行，并带上海滩/道路状态 + 全部时段/延迟/更新。
 * 避免只用 schedule[0] 或带换行的 message，导致灯箱只露出第一行。
 */
function buildRoadClosureTickerText(data) {
  const src = data || {}
  const headlines = []
  pushTickerUnique(headlines, src.beachStatus)
  if (src.roadStatusLabel && !/无道路延迟|无封路|正常通行/.test(src.roadStatusLabel)) {
    pushTickerUnique(headlines, src.roadStatusLabel)
  }

  const details = []
  const schedule = Array.isArray(src.beachClosureSchedule) ? src.beachClosureSchedule : []
  schedule.forEach((item) => pushTickerUnique(details, item))

  const updates = Array.isArray(src.roadUpdates) ? src.roadUpdates : []
  updates.forEach((item) => pushTickerUnique(details, formatRoadUpdateLine(item)))

  const delays = Array.isArray(src.roadDelays) ? src.roadDelays : []
  delays.forEach((item) => pushTickerUnique(details, item))

  const banners = Array.isArray(src.bannerAlerts) ? src.bannerAlerts : []
  banners.forEach((item) => pushTickerUnique(details, item))

  pushTickerUnique(details, src.timeRange)

  const msg = flattenTickerPart(src.message)
  if (msg) {
    const blob = headlines.concat(details).join(' ')
    if (!headlines.length && !details.length) {
      pushTickerUnique(details, msg)
    } else if (!tickerContains(blob, msg) && !tickerContains(msg, blob)) {
      msg.split(/[·;；|｜]/).forEach((chunk) => {
        const c = flattenTickerPart(chunk)
        if (c && !tickerContains(blob, c)) pushTickerUnique(details, c)
      })
    }
  }

  const MAX_DETAILS = 8
  const clipped = details.slice(0, MAX_DETAILS)
  const statusText = headlines.join(' · ')
  const detailText = clipped.join('  ·  ')
  const displayText = [statusText, detailText].filter(Boolean).join('  ·  ')
    || '星舰基地道路封路通知'

  return {
    statusText,
    detailText,
    displayText,
    timeRange: flattenTickerPart(src.timeRange)
  }
}

function buildRoadClosureState(data, formatDate) {
  if (!hasValidRoadClosure(data)) {
    return { ...EMPTY_ROAD_CLOSURE }
  }

  let timeRange = data.timeRange || ''
  if (!timeRange && data.startTime && data.endTime && typeof formatDate === 'function') {
    const startTime = formatDate(data.startTime, 'MM月DD日 HH:mm')
    const endTime = formatDate(data.endTime, 'MM月DD日 HH:mm')
    timeRange = `${startTime} - ${endTime}`
  }

  return {
    isActive: true,
    message: data.message || '星舰基地发射前道路封路通知',
    timeRange,
    source: data.source || '',
    beachClosureSchedule: data.beachClosureSchedule || [],
    roadDelays: data.roadDelays || [],
    roadUpdates: data.roadUpdates || [],
    bannerAlerts: data.bannerAlerts || []
  }
}

function syncRoadClosureFromCloud() {
  // 不再由前端触发 syncRoadClosure 外网抓取：封路数据由云端小时级定时器
  // （syncLaunchNetHourly 附带 syncRoadClosureThrottled）维护，前端读库优先。
  // 保留函数签名（调用方 await 兼容）：progress 页手动同步按钮会继续
  // loadRoadClosureNotice 读库，仍无数据时走现有「手动录入」兜底弹窗。
  return Promise.resolve(false)
}

async function verifyRoadClosurePassword(password) {
  if (!password) return false
  const verifyRes = await wx.cloud.callFunction({
    name: 'syncSpaceDevsData',
    data: { action: 'verifyRoadClosurePassword', password }
  })
  return !!(verifyRes && verifyRes.result && verifyRes.result.success)
}

async function saveManualRoadClosureNotice(message, timeRange) {
  const db = wx.cloud.database()
  const now = Date.now()
  const docId = 'starbase_gov_live'
  const expiresAt = now + 24 * 60 * 60 * 1000
  const doc = {
    source: 'starbase_gov',
    isActive: true,
    message,
    timeRange: timeRange || '',
    beachStatus: message,
    beachOpen: false,
    roadOpen: null,
    beachClosureSchedule: timeRange ? [timeRange] : [],
    roadDelays: [],
    roadUpdates: [],
    priority: 100,
    startAt: now,
    endAt: expiresAt,
    updatedAt: now,
    syncedAt: now
  }

  try {
    await db.collection('road_closure_notice').doc(docId).set({ data: doc })
  } catch (e) {
    await db.collection('road_closure_notice').add({ data: { _id: docId, ...doc } })
  }

  return doc
}

module.exports = {
  EMPTY_ROAD_CLOSURE,
  hasValidRoadClosure,
  isRoadClosureFetchFailed,
  resolveRoadClosureStatus,
  flattenTickerPart,
  buildRoadClosureTickerText,
  buildRoadClosureState,
  syncRoadClosureFromCloud,
  verifyRoadClosurePassword,
  saveManualRoadClosureNotice
}
