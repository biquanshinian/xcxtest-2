/**
 * 任务年内计数：有 LL2 机构 id 只认 id，禁止用名称把 CALT 算进 CASC。
 * 无 id 的旧任务才按发射商名/缩写兜底。
 */

function launchMatchesAgencyFilter(launch, mission) {
  const lsp = launch && launch.launch_service_provider
  const rawId = mission && mission.launchAgencyId
  const targetId = rawId != null && rawId !== '' ? Number(rawId) : NaN
  if (Number.isFinite(targetId)) {
    return !!(lsp && Number(lsp.id) === targetId)
  }
  const agencyName = String((lsp && (lsp.name || lsp.abbrev)) || '').trim()
  const targetName = String(
    (mission && mission.launchAgency) || (mission && mission.launchAgencyAbbrev) || ''
  ).trim()
  if (!targetName || !agencyName) return false
  return agencyName.toLowerCase() === targetName.toLowerCase()
}

module.exports = {
  launchMatchesAgencyFilter
}
