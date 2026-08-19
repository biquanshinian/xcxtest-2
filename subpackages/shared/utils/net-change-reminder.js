/**
 * 发射时间变更提醒：基线对比 + 未发射任务挑选（纯逻辑，无 UI）
 *
 * 规则：
 * 1) 服务号同源：launch_data.previousNet → 当前 NET（满 1 分钟）即记为变更，
 *    不必等本地即将发射列表刷新，也不走「首次只记不弹」
 * 2) 无服务端改期行时：首次见到某任务只记 NET，不弹；再次见到且满 1 分钟才记
 * 3) 任务已发射 / 已离开即将列表 → 不再作为候选
 * 4) 近窗与服务号一致：原时间或新时间落在未来 48h 内才弹（远期例行改期是噪音）
 * 5) TBD / 粗精度占位新时间不弹（与服务号 isNetChangeAnnouncable 对齐）
 * 6) 多条未发射变更 → 新 NET 早的在前；是否弹出由首页冷启动队列决定
 */

const { isSettledStatusId } = require('../../../utils/launch-status-store.js')

const NET_WATCH_KEY = '_net_change_watch_map'
const NET_EVENTS_KEY = '_net_change_events_map'
const POPUP_SHOWN_KEY = '_net_change_popup_shown_date'
const POPUP_SHOWN_EVENTS_KEY = '_net_change_popup_shown_events'
/** 任意方向，满 1 分钟即记为变更（秒级抖动忽略） */
const CHANGE_TOLERANCE_MS = 60 * 1000
const DELAY_TOLERANCE_MS = CHANGE_TOLERANCE_MS
/** 与 sendLaunchReminder/net-change-push.NET_CHANGE_NEAR_WINDOW_MS 对齐 */
const NET_CHANGE_NEAR_WINDOW_MS = 48 * 60 * 60 * 1000
const SHOWN_EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1000

const _mapMem = Object.create(null)

function getTodayStr() {
  const d = new Date()
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

function parseNetMs(raw) {
  if (!raw) return 0
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function readMap(key) {
  if (_mapMem[key] && typeof _mapMem[key] === 'object') return _mapMem[key]
  try {
    const v = wx.getStorageSync(key)
    _mapMem[key] = v && typeof v === 'object' ? v : {}
    return _mapMem[key]
  } catch (e) {
    _mapMem[key] = {}
    return _mapMem[key]
  }
}

function writeMap(key, map) {
  _mapMem[key] = map || {}
  try {
    wx.setStorage({ key: key, data: _mapMem[key], fail: function () {} })
  } catch (e) {}
}

function isCoarseNetPrecision(name) {
  const s = String(name || '').trim().toLowerCase()
  if (!s) return false
  return /^(day|week|month|quarter|half|year|decade)/.test(s)
}

function isNetChangeAnnouncable(launch) {
  const sid = launch && launch.statusId != null ? Number(launch.statusId) : 0
  if (sid === 2) return false
  if (isCoarseNetPrecision(launch && launch.netPrecision)) return false
  return true
}

function isWithinOaNearWindow(oldIso, newIso, nowMs) {
  const now = Number(nowMs) || Date.now()
  const oldMs = parseNetMs(oldIso)
  const newMs = parseNetMs(newIso)
  const nearOld = oldMs > 0 && oldMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  const nearNew = newMs > 0 && newMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  return nearOld || nearNew
}

function formatChangeDelta(absMs) {
  const mins = Math.max(1, Math.round(Math.abs(absMs) / 60000))
  if (mins < 60) return mins + '分钟'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem ? hours + '小时' + rem + '分钟' : hours + '小时'
  const days = Math.floor(hours / 24)
  const h = hours % 24
  if (!h) return days + '天'
  return days + '天' + h + '小时'
}

function resolveChangeMeta(oldNet, newNet) {
  const oldMs = parseNetMs(oldNet)
  const newMs = parseNetMs(newNet)
  if (!oldMs || !newMs) {
    return { kind: 'delay', deltaMs: 0, deltaText: '', titleText: '发射时间变更' }
  }
  const deltaMs = newMs - oldMs
  const kind = deltaMs < 0 ? 'advance' : 'delay'
  const label = kind === 'advance' ? '提前' : '延期'
  return {
    kind: kind,
    deltaMs: deltaMs,
    deltaText: label + ' ' + formatChangeDelta(deltaMs),
    titleText: '发射时间' + label
  }
}

function eventFingerprint(ev) {
  if (!ev) return ''
  return [ev.missionId || '', ev.oldNet || '', ev.newNet || ''].join('|')
}

function readShownState() {
  const raw = readMap(POPUP_SHOWN_EVENTS_KEY)
  const keys = raw && raw.keys && typeof raw.keys === 'object' ? raw.keys : {}
  return { keys: keys }
}

function isEventShown(ev) {
  const fp = eventFingerprint(ev)
  if (!fp) return false
  const state = readShownState()
  return !!state.keys[fp]
}

function markEventShown(ev, nowMs) {
  const fp = eventFingerprint(ev)
  if (!fp) return
  const state = readShownState()
  const now = Number(nowMs) || Date.now()
  const nextKeys = {}
  const ids = Object.keys(state.keys || {})
  // 只清体积，不清「同一指纹已看过」——过期再弹会和服务号去重冲突
  for (let i = 0; i < ids.length; i++) {
    const key = ids[i]
    const ts = Number(state.keys[key])
    if (Number.isFinite(ts) && ts > 1 && now - ts >= SHOWN_EVENT_TTL_MS && ids.length > 80) continue
    nextKeys[key] = state.keys[key]
  }
  nextKeys[fp] = now
  writeMap(POPUP_SHOWN_EVENTS_KEY, { keys: nextKeys })
}

function isPopupShownToday() {
  try {
    return String(wx.getStorageSync(POPUP_SHOWN_KEY) || '') === getTodayStr()
  } catch (e) {
    return false
  }
}

function markPopupShownToday() {
  try {
    const today = getTodayStr()
    wx.setStorage({ key: POPUP_SHOWN_KEY, data: today, fail: function () {} })
  } catch (e) {}
}

function missionDisplayName(m) {
  if (!m || typeof m !== 'object') return ''
  const pack = m._langPack || {}
  return String(
    pack.missionNameZh ||
      pack.nameZh ||
      m.missionName ||
      m.name ||
      ''
  ).trim()
}

function missionRocketName(m) {
  if (!m || typeof m !== 'object') return ''
  const pack = m._langPack || {}
  return String(pack.rocketNameZh || m.rocketName || pack.rocketNameEn || '').trim()
}

function missionAgencyName(m) {
  if (!m || typeof m !== 'object') return ''
  const pack = m._langPack || {}
  return String(
    pack.launchAgencyZh ||
      m.launchAgency ||
      pack.launchAgencyEn ||
      m.launchAgencyAbbrev ||
      ''
  ).trim()
}

function isMissionAlreadyLaunched(m) {
  if (!m) return true
  const sid =
    m.statusId != null
      ? Number(m.statusId)
      : m.status && m.status.id != null
        ? Number(m.status.id)
        : 0
  if (isSettledStatusId(sid)) return true
  const cat = String(m.statusCategory || '').toLowerCase()
  return cat === 'success' || cat === 'failure' || cat === 'partial' || cat === 'deployed'
}

function buildEvent(id, oldNet, newNet, today) {
  const meta = resolveChangeMeta(oldNet, newNet)
  return {
    oldNet: oldNet,
    newNet: newNet,
    changedDate: today,
    missionId: id,
    kind: meta.kind,
    deltaMs: meta.deltaMs
  }
}

function buildReminderPayload(m, ev) {
  const oldNet = ev.oldNet
  const newNet = ev.newNet || (m && m.launchTime) || ''
  const meta = resolveChangeMeta(oldNet, newNet)
  return {
    missionId: String(m.id),
    rocketName: missionRocketName(m),
    missionName: missionDisplayName(m),
    agencyName: missionAgencyName(m),
    agencyAbbrev: String(m.launchAgencyAbbrev || '').trim(),
    launchAgencyId: m.launchAgencyId,
    rocketImage: m.rocketImage || m.image || '',
    rocketConfiguration: m.rocketConfiguration || null,
    rocketNameEn: (m._langPack && m._langPack.rocketNameEn) || m.rocketName || '',
    launchAgencyImage: m.launchAgencyImage || '',
    oldNet: oldNet,
    newNet: newNet,
    changeKind: meta.kind,
    deltaMs: meta.deltaMs,
    deltaText: meta.deltaText,
    titleText: meta.titleText
  }
}

function missionStubFromServerRow(row) {
  const id = String((row && (row.id || row._id)) || '').trim()
  const rocketZh = String((row && (row.rocketNameZh || row.rocketName)) || '').trim()
  const agencyZh = String((row && (row.launchAgencyZh || row.launchAgency)) || '').trim()
  return {
    id: id,
    launchTime: (row && row.launchTime) || '',
    previousNet: (row && row.previousNet) || '',
    netChangedAt: (row && row.netChangedAt) || 0,
    missionName: (row && row.missionName) || '',
    rocketName: rocketZh,
    launchAgency: agencyZh,
    launchAgencyAbbrev: (row && row.launchAgencyAbbrev) || '',
    launchAgencyId: row && row.launchAgencyId,
    statusId: row && row.statusId,
    netPrecision: (row && row.netPrecision) || '',
    _langPack: {
      missionNameZh: (row && row.missionName) || '',
      rocketNameZh: rocketZh,
      rocketNameEn: (row && row.rocketName) || '',
      launchAgencyZh: agencyZh,
      launchAgencyEn: (row && row.launchAgency) || ''
    }
  }
}

/**
 * 用 launch_data 改期行覆盖列表 NET（权威新时间 + previousNet）。
 * 列表仍是 boot/本地缓存旧时间时，也能按服务号同一口径弹窗。
 */
function overlayServerNetChanges(missions, serverRows) {
  const list = Array.isArray(missions) ? missions.map(function (m) {
    return m && typeof m === 'object' ? Object.assign({}, m) : m
  }) : []
  const byId = {}
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (m && m.id != null) byId[String(m.id)] = m
  }
  const rows = Array.isArray(serverRows) ? serverRows : []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const id = String(row.id || row._id || '').trim()
    if (!id) continue
    const hit = byId[id]
    if (hit) {
      if (row.previousNet) hit.previousNet = row.previousNet
      if (row.netChangedAt) hit.netChangedAt = row.netChangedAt
      // 不覆盖 status / 精度：列表实况可能比 launch_data 新，盖掉会误伤终态或 TBD 门控
      const listMs = parseNetMs(hit.launchTime || hit.net)
      const serverNew = parseNetMs(row.launchTime)
      const serverOld = parseNetMs(row.previousNet)
      const listStillOld =
        serverOld && listMs && Math.abs(listMs - serverOld) < CHANGE_TOLERANCE_MS
      if (serverNew && (!listMs || listStillOld)) {
        hit.launchTime = row.launchTime
      }
    } else {
      const stub = missionStubFromServerRow(row)
      list.push(stub)
      byId[id] = stub
    }
  }
  return list
}

function recordChangeEvent(events, id, oldNet, newNet, today) {
  const prevEvent = events[id]
  if (prevEvent && prevEvent.oldNet && Math.abs(parseNetMs(newNet) - parseNetMs(prevEvent.oldNet)) < CHANGE_TOLERANCE_MS) {
    delete events[id]
    return false
  }
  if (prevEvent && prevEvent.oldNet) {
    events[id] = buildEvent(id, prevEvent.oldNet, newNet, today)
  } else {
    events[id] = buildEvent(id, oldNet, newNet, today)
  }
  return true
}

/**
 * 用首页列表（可已 overlay 服务端改期）扫描 NET 变更；更新基线；
 * 返回未发射变更 payload 列表（新 NET 早的在前）
 * @param {Object[]} missions upcoming 列表项（含 id / launchTime / previousNet …）
 * @param {{ nowMs?: number }} [options]
 */
function scanAndPickTodayReminder(missions, options) {
  const list = Array.isArray(missions) ? missions : []
  const nowMs = options && options.nowMs != null ? Number(options.nowMs) : Date.now()
  const today = getTodayStr()
  const watch = readMap(NET_WATCH_KEY)
  const events = readMap(NET_EVENTS_KEY)
  let watchDirty = false
  let eventsDirty = false

  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || m.id == null) continue
    const id = String(m.id).trim()
    if (!id) continue
    const net = m.launchTime || m.net || ''
    const netMs = parseNetMs(net)
    if (!netMs) continue

    if (isMissionAlreadyLaunched(m)) {
      if (events[id]) {
        delete events[id]
        eventsDirty = true
      }
      if (watch[id] !== net) {
        watch[id] = net
        watchDirty = true
      }
      continue
    }

    const serverOld = m.previousNet || ''
    const serverOldMs = parseNetMs(serverOld)
    const prev = watch[id]
    const prevMs = parseNetMs(prev)

    // 服务号已打标：用 previousNet → 最新 NET，首次见到也弹（不必再等本地基线）
    if (serverOldMs && Math.abs(netMs - serverOldMs) >= CHANGE_TOLERANCE_MS) {
      recordChangeEvent(events, id, serverOld, net, today)
      eventsDirty = true
      if (watch[id] !== net) {
        watch[id] = net
        watchDirty = true
      }
      continue
    }

    if (!prevMs) {
      watch[id] = net
      watchDirty = true
      continue
    }

    // 未满 1 分钟：视为同一时刻，只同步字符串
    if (Math.abs(netMs - prevMs) < CHANGE_TOLERANCE_MS) {
      if (watch[id] !== net) {
        watch[id] = net
        watchDirty = true
      }
      continue
    }

    recordChangeEvent(events, id, prev, net, today)
    eventsDirty = true
    watch[id] = net
    watchDirty = true
  }

  const byId = {}
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (m && m.id != null) byId[String(m.id)] = m
  }

  const candidates = []
  const ids = Object.keys(events)
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const ev = events[id]
    if (!ev) continue
    const m = byId[id]
    if (!m || isMissionAlreadyLaunched(m)) {
      delete events[id]
      eventsDirty = true
      continue
    }
    const newMs = parseNetMs(ev.newNet || m.launchTime)
    if (!newMs) continue
    if (!isWithinOaNearWindow(ev.oldNet, ev.newNet || m.launchTime, nowMs)) continue
    if (!isNetChangeAnnouncable(m)) continue
    if (isEventShown(ev)) continue
    candidates.push({ mission: m, event: ev, newMs: newMs })
  }

  if (watchDirty) writeMap(NET_WATCH_KEY, watch)
  if (eventsDirty) writeMap(NET_EVENTS_KEY, events)

  if (!candidates.length) return []

  candidates.sort(function (a, b) {
    return a.newMs - b.newMs
  })
  const payloads = []
  for (let i = 0; i < candidates.length; i++) {
    payloads.push(buildReminderPayload(candidates[i].mission, candidates[i].event))
  }
  return payloads
}

const RECENT_NET_CHANGES_TTL_MS = 60 * 1000

function fetchRecentNetChanges() {
  let appInst = null
  try {
    appInst = typeof getApp === 'function' ? getApp() : null
  } catch (e) {
    appInst = null
  }
  const cachedAt = appInst && Number(appInst._recentNetChangesAt)
  if (
    appInst &&
    appInst._recentNetChangesPromise &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < RECENT_NET_CHANGES_TTL_MS
  ) {
    return appInst._recentNetChangesPromise
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve({ rows: [], fromServer: false })
  }
  const p = new Promise(function (resolve) {
    wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'listRecentNetChanges' },
      timeout: 15000,
      success: function (res) {
        const r = res && res.result
        if (r && r.success && Array.isArray(r.rows)) resolve({ rows: r.rows, fromServer: true })
        else resolve(null)
      },
      fail: function () {
        resolve(null)
      }
    })
  }).then(function (pack) {
    if (!pack) {
      if (appInst) {
        appInst._recentNetChangesPromise = null
        appInst._recentNetChangesAt = 0
      }
      return { rows: [], fromServer: false }
    }
    return pack
  })
  if (appInst) {
    appInst._recentNetChangesPromise = p
    appInst._recentNetChangesAt = Date.now()
  }
  return p
}

/** 开发预览：从首页列表/倒计时挑一条有图的任务（优先朱雀），叠 mock 时间 */
function pickDevPreviewPayload(missions, mockTimes, extraMission) {
  const list = Array.isArray(missions) ? missions.slice() : []
  if (extraMission && typeof extraMission === 'object') list.unshift(extraMission)
  let picked = null
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m) continue
    const blob = [m.rocketName, m.name, m.missionName, (m._langPack && m._langPack.rocketNameEn) || ''].join(' ')
    if (/zhuque|朱雀|zq[\s-]?3/i.test(blob) && (m.rocketImage || m.image)) {
      picked = m
      break
    }
  }
  if (!picked) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] && (list[i].rocketImage || list[i].image)) {
        picked = list[i]
        break
      }
    }
  }
  if (!picked) return null

  const times = mockTimes || {}
  const oldNet = times.oldNet || '2026-08-11T07:45:00+08:00'
  const newNet = times.newNet || '2026-08-31T08:00:00+08:00'
  const meta = resolveChangeMeta(oldNet, newNet)
  return {
    missionId: String(picked.id || 'dev-net-change'),
    rocketName: missionRocketName(picked) || '朱雀三号',
    missionName: missionDisplayName(picked) || '第 2 次试飞',
    agencyName: missionAgencyName(picked) || '蓝箭航天',
    agencyAbbrev: String(picked.launchAgencyAbbrev || 'LandSpace').trim(),
    launchAgencyId: picked.launchAgencyId,
    rocketImage: picked.rocketImage || picked.image || '',
    rocketConfiguration: picked.rocketConfiguration || null,
    rocketNameEn: (picked._langPack && picked._langPack.rocketNameEn) || picked.rocketName || '',
    launchAgencyImage: picked.launchAgencyImage || '',
    oldNet: oldNet,
    newNet: newNet,
    changeKind: meta.kind,
    deltaMs: meta.deltaMs,
    deltaText: meta.deltaText,
    titleText: meta.titleText
  }
}

function payloadFromMission(m, oldNet, newNet, fallbackId) {
  const meta = resolveChangeMeta(oldNet, newNet)
  return {
    missionId: String((m && m.id) || fallbackId || 'dev-net-change'),
    rocketName: missionRocketName(m) || '朱雀三号',
    missionName: missionDisplayName(m) || '第 2 次试飞',
    agencyName: missionAgencyName(m) || '蓝箭航天',
    agencyAbbrev: String((m && m.launchAgencyAbbrev) || 'LandSpace').trim(),
    launchAgencyId: m && m.launchAgencyId,
    rocketImage: (m && (m.rocketImage || m.image)) || '',
    rocketConfiguration: (m && m.rocketConfiguration) || null,
    rocketNameEn: (m && m._langPack && m._langPack.rocketNameEn) || (m && m.rocketName) || '',
    launchAgencyImage: (m && m.launchAgencyImage) || '',
    oldNet: oldNet,
    newNet: newNet,
    changeKind: meta.kind,
    deltaMs: meta.deltaMs,
    deltaText: meta.deltaText,
    titleText: meta.titleText
  }
}

/** 开发预览：最多 3 张卡（延期 / 提前 / 短延期），方便滑卡 */
function pickDevPreviewPayloads(missions, mockTimes, extraMission) {
  const list = Array.isArray(missions) ? missions.slice() : []
  if (extraMission && typeof extraMission === 'object') list.unshift(extraMission)
  const picked = []
  const seen = {}
  for (let i = 0; i < list.length && picked.length < 3; i++) {
    const m = list[i]
    if (!m || !(m.rocketImage || m.image)) continue
    const id = String(m.id || i)
    if (seen[id]) continue
    seen[id] = true
    picked.push(m)
  }
  if (!picked.length) {
    const one = pickDevPreviewPayload(missions, mockTimes, extraMission)
    return one ? [one] : []
  }
  const mocks = [
    { oldNet: '2026-08-11T07:45:00+08:00', newNet: '2026-08-31T08:00:00+08:00' },
    { oldNet: '2026-08-20T14:00:00+08:00', newNet: '2026-08-20T09:30:00+08:00' },
    { oldNet: '2026-08-16T10:00:00+08:00', newNet: '2026-08-16T12:15:00+08:00' }
  ]
  const out = []
  for (let i = 0; i < picked.length; i++) {
    const t = mocks[i] || mocks[0]
    out.push(payloadFromMission(picked[i], t.oldNet, t.newNet, 'dev-net-change-' + i))
  }
  if (out.length === 1) {
    out.push(payloadFromMission(picked[0], mocks[1].oldNet, mocks[1].newNet, 'dev-net-change-1'))
  }
  return out
}

function resetNetChangeReminderStorageForTest() {
  Object.keys(_mapMem).forEach(function (key) {
    delete _mapMem[key]
  })
}

module.exports = {
  CHANGE_TOLERANCE_MS,
  DELAY_TOLERANCE_MS,
  NET_CHANGE_NEAR_WINDOW_MS,
  getTodayStr,
  isPopupShownToday,
  markPopupShownToday,
  isEventShown,
  markEventShown,
  isNetChangeAnnouncable,
  isWithinOaNearWindow,
  resolveChangeMeta,
  formatChangeDelta,
  overlayServerNetChanges,
  scanAndPickTodayReminder,
  fetchRecentNetChanges,
  pickDevPreviewPayload,
  pickDevPreviewPayloads,
  missionRocketName,
  missionDisplayName,
  missionAgencyName,
  resetNetChangeReminderStorageForTest
}
