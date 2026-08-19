/**
 * 近期 NET 改期（与服务号 net-change-push 同一信源：launch_data）。
 * 首页改期弹窗冷启动拉一次，避免等即将发射列表本地 30min / boot 快照。
 */
const LAUNCH_DATA_COLLECTION = 'launch_data'
/** 与 sendLaunchReminder/net-change-push.NET_CHANGE_NEAR_WINDOW_MS 对齐 */
const NET_CHANGE_NEAR_WINDOW_MS = 48 * 60 * 60 * 1000
const CHANGE_TOLERANCE_MS = 60 * 1000

function parseMs(raw) {
  if (!raw) return 0
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function isCoarseNetPrecision(name) {
  const s = String(name || '').trim().toLowerCase()
  if (!s) return false
  return /^(day|week|month|quarter|half|year|decade)/.test(s)
}

/** 与 sendLaunchReminder/pre-alert-gate.isNetChangeAnnouncable 对齐 */
function isNetChangeAnnouncable(launch) {
  const sid = launch && launch.statusId != null ? Number(launch.statusId) : 0
  if (sid === 2) return false
  if (isCoarseNetPrecision(launch && launch.netPrecision)) return false
  return true
}

function isWithinOaNearWindow(oldIso, newIso, nowMs) {
  const now = Number(nowMs) || Date.now()
  const oldMs = parseMs(oldIso)
  const newMs = parseMs(newIso)
  const nearOld = oldMs > 0 && oldMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  const nearNew = newMs > 0 && newMs - now <= NET_CHANGE_NEAR_WINDOW_MS
  return nearOld || nearNew
}

/**
 * 从 launch_data 行挑出「服务号会播报」的改期（已推送后 pending 已清，仍保留 previousNet）。
 * @param {object[]} rows
 * @param {number} [nowMs]
 */
function pickAnnouncableNetChanges(rows, nowMs) {
  const now = Number(nowMs) || Date.now()
  const list = Array.isArray(rows) ? rows : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    if (!row) continue
    const id = String(row._id || row.id || '').trim()
    const newIso = row.launchTime || ''
    const oldIso = row.previousNet || ''
    const newMs = parseMs(newIso)
    const oldMs = parseMs(oldIso)
    if (!id || !newMs || !oldMs) continue
    if (Math.abs(newMs - oldMs) < CHANGE_TOLERANCE_MS) continue
    if (!isWithinOaNearWindow(oldIso, newIso, now)) continue
    if (!isNetChangeAnnouncable(row)) continue
    out.push({
      id: id,
      launchTime: newIso,
      previousNet: oldIso,
      netChangedAt: Number(row.netChangedAt) || 0,
      netChangePending: !!row.netChangePending,
      lastNetChangePushedKey: row.lastNetChangePushedKey ? String(row.lastNetChangePushedKey) : '',
      missionName: row.missionName || '',
      rocketName: row.rocketName || '',
      rocketNameZh: row.rocketNameZh || '',
      launchAgency: row.launchAgency || '',
      launchAgencyZh: row.launchAgencyZh || '',
      launchAgencyAbbrev: row.launchAgencyAbbrev || '',
      launchAgencyId: row.launchAgencyId != null ? row.launchAgencyId : null,
      statusId: row.statusId != null ? Number(row.statusId) : null,
      netPrecision: row.netPrecision || ''
    })
  }
  return out
}

async function listRecentNetChangesAction(db) {
  const nowMs = Date.now()
  let rows = []
  try {
    const _ = db.command
    // 只按 windowStart 过滤、不 orderBy：与 OA 待推查询同字段，避免缺复合索引直接失败
    const res = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({
        windowStart: _.gt(new Date(nowMs))
      })
      .limit(100)
      .get()
    rows = (res && res.data) || []
  } catch (e) {
    return {
      success: false,
      error: (e && e.message) || String(e),
      rows: [],
      timestamp: nowMs
    }
  }
  return {
    success: true,
    rows: pickAnnouncableNetChanges(rows, nowMs),
    timestamp: nowMs
  }
}

module.exports = {
  NET_CHANGE_NEAR_WINDOW_MS,
  CHANGE_TOLERANCE_MS,
  isNetChangeAnnouncable,
  isWithinOaNearWindow,
  pickAnnouncableNetChanges,
  listRecentNetChangesAction
}
