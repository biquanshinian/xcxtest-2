/**
 * 任务详情页发射统计：走 getLaunchStats 云函数（LL2 官方 count / net 年界）
 */

const { fetchMissionLaunchStatsFromCloud } = require('../../../utils/launch-stats-cloud.js')

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

async function loadMissionLaunchStats(mission, options = {}) {
  const data = await fetchMissionLaunchStatsFromCloud(mission, options)
  return applyClientAgencyFallback({
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
  }, mission)
}

module.exports = {
  loadMissionLaunchStats,
  resolveAgencyAttemptHints,
  applyClientAgencyFallback
}
