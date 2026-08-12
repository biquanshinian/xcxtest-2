/**
 * 列表卡 ↔ 详情：发射时间 / 窗口 / 状态同源对齐。
 *
 * 原则：
 * 1) 列表会话态（含 NET 迟滞后的卡片）作 cached，详情 API 作 live
 * 2) 复用 net-patch-policy：拒绝远窗推迟占位盖掉近窗；允许近窗 Go 治愈远窗待定
 * 3) 输出同一套 launchTime / windowStart / windowEnd / status，避免角标与时间分叉
 *
 * 仅详情分包使用，放在 pages/mission-detail/utils，避免主包「未使用 JS」告警。
 */

const { mergeLiveRowNetHysteresis } = require('../../../utils/net-patch-policy.js')

function toMs(value) {
  if (!value) return NaN
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : NaN
}

function statusFromMission(mission) {
  if (!mission) return null
  const id = mission.statusId != null ? Number(mission.statusId) : 0
  if (!Number.isFinite(id) || id <= 0) {
    if (mission.status && typeof mission.status === 'object' && mission.status.id != null) {
      return {
        id: Number(mission.status.id) || 0,
        name: mission.status.name || mission.statusBadgeText || '',
        abbrev: mission.status.abbrev || mission.statusAbbrev || ''
      }
    }
    return null
  }
  return {
    id,
    name: mission.statusBadgeText || mission.status || '',
    abbrev: mission.statusAbbrev || ''
  }
}

function missionToNetRow(mission) {
  if (!mission || typeof mission !== 'object') return null
  const net = mission.launchTime || mission.net || ''
  if (!net && mission.statusId == null && !mission.status) return null
  return {
    net: net || '',
    window_start: mission.windowStart || mission.window_start || '',
    window_end: mission.windowEnd || mission.window_end || '',
    status: statusFromMission(mission)
  }
}

/**
 * @param {object|null} listMission 列表卡 / opener 快照
 * @param {object|null} detailMission 详情 API 或 detail 缓存
 * @param {number} [nowMs]
 * @returns {{
 *   launchTime: string,
 *   windowStart: string,
 *   windowEnd: string,
 *   status: {id:number,name:string,abbrev:string}|null,
 *   preferredDetail: boolean,
 *   keptCached: boolean,
 *   source: 'list'|'detail'|'hysteresis'|'none'
 * }}
 */
function alignMissionScheduleAndStatus(listMission, detailMission, nowMs) {
  const now = Number(nowMs) || Date.now()
  const cached = missionToNetRow(listMission)
  const live = missionToNetRow(detailMission)

  if (!cached && !live) {
    return {
      launchTime: '',
      windowStart: '',
      windowEnd: '',
      status: null,
      preferredDetail: false,
      keptCached: false,
      source: 'none'
    }
  }

  if (!cached) {
    return {
      launchTime: live.net || '',
      windowStart: live.window_start || '',
      windowEnd: live.window_end || '',
      status: live.status || null,
      preferredDetail: true,
      keptCached: false,
      source: 'detail'
    }
  }

  if (!live) {
    return {
      launchTime: cached.net || '',
      windowStart: cached.window_start || '',
      windowEnd: cached.window_end || '',
      status: cached.status || null,
      preferredDetail: false,
      keptCached: true,
      source: 'list'
    }
  }

  const row = mergeLiveRowNetHysteresis(cached, live, now) || live
  const outNet = row.net || ''
  const listNet = cached.net || ''
  const detailNet = live.net || ''
  const preferredDetail =
    !!outNet &&
    !!detailNet &&
    String(outNet) === String(detailNet) &&
    String(outNet) !== String(listNet)
  // 迟滞拒写：日程仍是列表近窗，状态也必须跟列表，不能半套详情
  const keptCached =
    !!outNet &&
    !!listNet &&
    String(outNet) === String(listNet) &&
    String(outNet) !== String(detailNet)

  return {
    launchTime: outNet,
    windowStart: row.window_start || '',
    windowEnd: row.window_end || '',
    status: row.status || null,
    preferredDetail,
    keptCached,
    source: 'hysteresis'
  }
}

/** 列表卡与对齐结果在时间或状态上是否不一致（用于决定是否强制重绘详情首屏） */
function scheduleFieldsDiffer(mission, aligned) {
  if (!mission || !aligned) return false
  if (aligned.launchTime && String(mission.launchTime || '') !== String(aligned.launchTime)) return true
  if (aligned.windowStart && String(mission.windowStart || '') !== String(aligned.windowStart)) {
    return true
  }
  if (aligned.windowEnd && String(mission.windowEnd || '') !== String(aligned.windowEnd)) return true
  const sid = aligned.status && aligned.status.id != null ? Number(aligned.status.id) : 0
  const cur = mission.statusId != null ? Number(mission.statusId) : 0
  if (sid > 0 && sid !== cur) return true
  const alignedAbbrev = aligned.status && aligned.status.abbrev
    ? String(aligned.status.abbrev).toLowerCase()
    : ''
  const curAbbrev = String(mission.statusAbbrev || '').toLowerCase()
  if (alignedAbbrev && curAbbrev && alignedAbbrev !== curAbbrev) return true
  return false
}

module.exports = {
  toMs,
  missionToNetRow,
  alignMissionScheduleAndStatus,
  scheduleFieldsDiffer
}
