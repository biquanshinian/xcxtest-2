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

async function syncRoadClosureFromCloud() {
  const res = await wx.cloud.callFunction({
    name: 'syncSpaceDevsData',
    data: { action: 'syncRoadClosure' }
  })
  const result = res && res.result
  return !!(result && result.success && result.merged > 0)
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
  buildRoadClosureState,
  syncRoadClosureFromCloud,
  verifyRoadClosurePassword,
  saveManualRoadClosureNotice
}
