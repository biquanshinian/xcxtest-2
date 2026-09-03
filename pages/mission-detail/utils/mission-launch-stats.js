/**
 * 任务详情页发射统计：走 getLaunchStats 云函数（LL2 官方 count / net 年界）
 */

const { fetchMissionLaunchStatsFromCloud } = require('../../../utils/launch-stats-cloud.js')
const { getContentLang } = require('../../../utils/locale.js')

/** 统计卡型号/发射商标签跟任务卡语言对齐 */
function localizeMissionStatsLabels(stats, mission) {
  if (!stats) return stats
  const pack = (mission && mission._langPack) || null
  const en = getContentLang() === 'en'
  const out = { ...stats }

  if (en) {
    out.rocketLabel =
      (pack && pack.rocketNameEn) ||
      out.rocketLabel ||
      (mission && mission.rocketName) ||
      ''
    // 右侧栏标题多为「Provider / 发射商」分类名，不是具体机构
    const p = String(out.providerLabel || '').trim()
    if (!p || p === '发射商' || /^provider$/i.test(p)) out.providerLabel = 'Provider'
    return out
  }

  const rocketZh =
    (pack && pack.rocketNameZh) ||
    (mission && mission.rocketName && /[\u4e00-\u9fff]/.test(mission.rocketName)
      ? mission.rocketName
      : '') ||
    out.rocketLabel ||
    ''
  out.rocketLabel = rocketZh

  const rawProvider = String(out.providerLabel || '').trim()
  if (!rawProvider || rawProvider === '发射商' || /^provider$/i.test(rawProvider)) {
    out.providerLabel = '发射商'
  } else if (!/[\u4e00-\u9fff]/.test(rawProvider)) {
    out.providerLabel = (pack && pack.launchAgencyZh) || rawProvider
  }
  return out
}

/** 从序号行解析「第 N 次」（排除「年内第」）与「年内第 N 次」 */
function parseAttemptLine(line) {
  const s = String(line || '')
  let total = null
  let year = null
  const yearMatch = s.match(/年内第\s*(\d+)\s*次/)
  if (yearMatch) year = Number(yearMatch[1])
  // 去掉「年内第 N 次」后再取累计，避免误匹配
  const withoutYear = s.replace(/年内第\s*\d+\s*次/g, '')
  const totalMatch = withoutYear.match(/第\s*(\d+)\s*次/)
  if (totalMatch) total = Number(totalMatch[1])
  return { total, year }
}

/** 从 mission 字段或序号徽章行解析发射商 attempt（防旧 mission_* / 本地 persist 缺 providerTotal） */
function resolveAgencyAttemptHints(mission) {
  if (!mission || typeof mission !== 'object') return { total: null, year: null }
  let total = mission.agencyLaunchAttemptCount
  let year = mission.agencyLaunchAttemptCountYear

  // 兼容未映射的 LL2 原始字段
  if (total == null && mission.agency_launch_attempt_count != null) {
    total = mission.agency_launch_attempt_count
  }
  if (year == null && mission.agency_launch_attempt_count_year != null) {
    year = mission.agency_launch_attempt_count_year
  }

  if ((total == null || year == null) && Array.isArray(mission.launchSequenceRows)) {
    const row = mission.launchSequenceRows.find((r) => r && (r.label === '发射商' || r.label === '发射服务商'))
    if (row) {
      const parsed = parseAttemptLine(row.line)
      if (total == null && parsed.total != null) total = parsed.total
      if (year == null && parsed.year != null) year = parsed.year
    }
  }

  return {
    total: (total != null && Number.isFinite(Number(total)) && Number(total) > 0) ? Number(total) : null,
    year: (year != null && Number.isFinite(Number(year)) && Number(year) > 0) ? Number(year) : null
  }
}

function applyClientAgencyFallback(stats, mission) {
  if (!stats) return stats
  const hints = resolveAgencyAttemptHints(mission)
  const out = { ...stats }
  let changed = false
  if ((out.providerTotal == null || out.providerTotal === '') && hints.total != null) {
    out.providerTotal = hints.total
    changed = true
  }
  if ((out.providerYear == null || out.providerYear === '') && hints.year != null) {
    out.providerYear = hints.year
    changed = true
  }
  out._agencyHintApplied = changed || !!out._agencyHintApplied
  return out
}

function isUpcomingMission(mission) {
  const t = mission && mission.launchTime ? new Date(mission.launchTime).getTime() : NaN
  return Number.isFinite(t) && t > Date.now()
}

function pickPositiveCount(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 型号累计：LL2 launcher_configuration.total_launch_count 是已完成次数。
 * 待发任务与发射商徽章一样按「含本次」展示，因此未发射时 +1。
 */
function resolveRocketAttemptHints(mission) {
  if (!mission || typeof mission !== 'object') return { total: null, year: null }
  const cfg = mission.rocketConfiguration || null
  let total = pickPositiveCount(mission.rocketLaunchAttemptCount)
  if (total == null) total = pickPositiveCount(cfg && cfg.total_launch_count)
  if (total != null && isUpcomingMission(mission)) total += 1
  const year = pickPositiveCount(mission.rocketLaunchAttemptCountYear)
  return { total, year }
}

function applyClientRocketFallback(stats, mission) {
  if (!stats) return stats
  const hints = resolveRocketAttemptHints(mission)
  const out = { ...stats }
  if ((out.rocketTotal == null || out.rocketTotal === '') && hints.total != null) {
    out.rocketTotal = hints.total
  }
  if ((out.rocketYear == null || out.rocketYear === '') && hints.year != null) {
    out.rocketYear = hints.year
  }
  return out
}

/**
 * 清洗云端/本地缓存里的矛盾计数：累计 < 年内（如型号名未归一化时精确过滤拿到的脏 0）。
 * 累计置 null（前端显示「—」），待云端预热重算后自动补正；年内计数来自年度明细聚合，可信保留。
 */
function sanitizeMissionStats(stats) {
  if (!stats) return stats
  const rBad = stats.rocketTotal != null && stats.rocketYear != null
    && Number(stats.rocketTotal) < Number(stats.rocketYear)
  const pBad = stats.providerTotal != null && stats.providerYear != null
    && Number(stats.providerTotal) < Number(stats.providerYear)
  if (!rBad && !pBad) return stats
  const out = { ...stats }
  if (rBad) out.rocketTotal = null
  if (pBad) out.providerTotal = null
  return out
}

async function loadMissionLaunchStats(mission, options = {}) {
  const data = (await fetchMissionLaunchStatsFromCloud(mission, options)) || {}
  const raw = applyClientRocketFallback(applyClientAgencyFallback(sanitizeMissionStats({
    year: data.year,
    rocketLabel: data.rocketLabel || '',
    providerLabel: data.providerLabel || '',
    rocketTotal: data.rocketTotal,
    rocketYear: data.rocketYear,
    providerTotal: data.providerTotal,
    providerYear: data.providerYear,
    yearOrdinal: data.yearOrdinal,
    staleCache: !!data.staleCache,
    clientStaleFallback: !!data.clientStaleFallback
  }), mission), mission)
  return localizeMissionStatsLabels(raw, mission)
}

module.exports = {
  loadMissionLaunchStats,
  resolveAgencyAttemptHints,
  applyClientAgencyFallback,
  resolveRocketAttemptHints,
  applyClientRocketFallback,
  sanitizeMissionStats
}
