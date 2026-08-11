/**
 * 发射时间变更提醒：基线对比 + 当天候选挑选（纯逻辑，无 UI）
 *
 * 规则：
 * 1) 首次见到某任务只记 NET，不弹
 * 2) 再次见到且 NET 向后推迟超过容差 → 记为「当天改期事件」
 * 3) 仅提醒「改期发生日 = 今天」的事件；一天最多弹一次
 * 4) 当天多个推迟任务 → 取新 NET 最近（最早）的一条
 */

const NET_WATCH_KEY = '_net_change_watch_map'
const NET_EVENTS_KEY = '_net_change_events_map'
const POPUP_SHOWN_KEY = '_net_change_popup_shown_date'
const DELAY_TOLERANCE_MS = 30 * 60 * 1000

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

/**
 * 用首页列表扫描改期；更新基线；返回当天应提醒的 payload（或 null）
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

    const prev = watch[id]
    const prevMs = parseNetMs(prev)

    if (!prevMs) {
      watch[id] = net
      watchDirty = true
      continue
    }

    // NET 未变：保持
    if (Math.abs(netMs - prevMs) <= DELAY_TOLERANCE_MS) {
      if (watch[id] !== net) {
        watch[id] = net
        watchDirty = true
      }
      continue
    }

    // 仅「向后推迟」记为改期提醒；提前不弹
    if (netMs <= prevMs) {
      watch[id] = net
      watchDirty = true
      continue
    }

    const prevEvent = events[id]
    // 同一天内连续多次 scrub：保留当天首次 oldNet，刷新 newNet
    if (prevEvent && prevEvent.changedDate === today && prevEvent.oldNet) {
      events[id] = {
        oldNet: prevEvent.oldNet,
        newNet: net,
        changedDate: today,
        missionId: id
      }
    } else {
      events[id] = {
        oldNet: prev,
        newNet: net,
        changedDate: today,
        missionId: id
      }
    }
    eventsDirty = true
    watch[id] = net
    watchDirty = true
  }

  if (watchDirty) writeMap(NET_WATCH_KEY, watch)
  if (eventsDirty) writeMap(NET_EVENTS_KEY, events)

  if (isPopupShownToday()) return null

  // 当天改期事件 ∩ 仍在列表中的任务
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
    if (!ev || ev.changedDate !== today) continue
    const m = byId[id]
    if (!m) continue
    const newMs = parseNetMs(ev.newNet || m.launchTime)
    if (!newMs) continue
    candidates.push({ mission: m, event: ev, newMs: newMs })
  }

  if (!candidates.length) return null

  // 最近：新 NET 最早者
  candidates.sort(function (a, b) {
    return a.newMs - b.newMs
  })
  const best = candidates[0]
  const m = best.mission
  const ev = best.event

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
    oldNet: ev.oldNet,
    newNet: ev.newNet || m.launchTime
  }
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
    oldNet: times.oldNet || '2026-08-11T07:45:00+08:00',
    newNet: times.newNet || '2026-08-31T08:00:00+08:00'
  }
}

module.exports = {
  DELAY_TOLERANCE_MS,
  getTodayStr,
  isPopupShownToday,
  markPopupShownToday,
  scanAndPickTodayReminder,
  pickDevPreviewPayload,
  missionRocketName,
  missionDisplayName,
  missionAgencyName
}
