/**
 * 发射时间变更提醒：基线对比 + 未发射任务挑选（纯逻辑，无 UI）
 *
 * 规则：
 * 1) 首次见到某任务只记 NET，不弹
 * 2) 再次见到且 NET 变动满 1 分钟（提前或延期）→ 记为变更事件，直到发射才清掉
 * 3) 任务已发射 / 已离开即将列表 → 不再作为候选
 * 4) 多条未发射变更 → 取新 NET 最近（最早）的一条
 * 5) 是否弹出由首页冷启动队列决定（同一进程只弹一次）
 */

const { isSettledStatusId } = require('../../../utils/launch-status-store.js')

const NET_WATCH_KEY = '_net_change_watch_map'
const NET_EVENTS_KEY = '_net_change_events_map'
const POPUP_SHOWN_KEY = '_net_change_popup_shown_date'
const POPUP_SHOWN_EVENTS_KEY = '_net_change_popup_shown_events'
/** 任意方向，满 1 分钟即记为变更（秒级抖动忽略） */
const CHANGE_TOLERANCE_MS = 60 * 1000
const DELAY_TOLERANCE_MS = CHANGE_TOLERANCE_MS

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
  try {
    const v = wx.getStorageSync(key)
    return v && typeof v === 'object' ? v : {}
  } catch (e) {
    return {}
  }
}

function writeMap(key, map) {
  try {
    wx.setStorage({ key: key, data: map || {}, fail: function () {} })
  } catch (e) {}
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
  const today = getTodayStr()
  const raw = readMap(POPUP_SHOWN_EVENTS_KEY)
  if (raw.date !== today || !raw.keys || typeof raw.keys !== 'object') {
    return { date: today, keys: {} }
  }
  return { date: today, keys: raw.keys }
}

function isEventShown(ev) {
  const fp = eventFingerprint(ev)
  if (!fp) return false
  const state = readShownState()
  return !!state.keys[fp]
}

function markEventShown(ev) {
  const fp = eventFingerprint(ev)
  if (!fp) return
  const state = readShownState()
  state.keys[fp] = 1
  writeMap(POPUP_SHOWN_EVENTS_KEY, state)
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

/**
 * 用首页列表扫描 NET 变更；更新基线；返回未发射变更 payload 列表（新 NET 早的在前）
 * @param {Object[]} missions upcoming 列表项（含 id / launchTime / rocketImage …）
 */
function scanAndPickTodayReminder(missions) {
  const list = Array.isArray(missions) ? missions : []
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

    const prev = watch[id]
    const prevMs = parseNetMs(prev)

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

    const prevEvent = events[id]
    // 改回当天首次原时间：视为变更已撤销
    if (prevEvent && prevEvent.oldNet && Math.abs(netMs - parseNetMs(prevEvent.oldNet)) < CHANGE_TOLERANCE_MS) {
      delete events[id]
      eventsDirty = true
      watch[id] = net
      watchDirty = true
      continue
    }

    // 连续改期：保留首次 oldNet，刷新 newNet，方向按「首次原时间 → 最新」重算
    if (prevEvent && prevEvent.oldNet) {
      events[id] = buildEvent(id, prevEvent.oldNet, net, today)
    } else {
      events[id] = buildEvent(id, prev, net, today)
    }
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

module.exports = {
  CHANGE_TOLERANCE_MS,
  DELAY_TOLERANCE_MS,
  getTodayStr,
  isPopupShownToday,
  markPopupShownToday,
  isEventShown,
  markEventShown,
  resolveChangeMeta,
  formatChangeDelta,
  scanAndPickTodayReminder,
  pickDevPreviewPayload,
  pickDevPreviewPayloads,
  missionRocketName,
  missionDisplayName,
  missionAgencyName
}
