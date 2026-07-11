/**
 * 发射商 Logo 强制覆盖（首页即将发射等与列表同源字段 launchAgencyImage）
 */

const SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%8F%91%E5%B0%84%E5%95%86logo/1779110267094_e4gi54.jpg'

/** Launch Library / The Space Devs 常见：SpaceX agency id = 121 */
const SPACEX_AGENCY_IDS = new Set(['121'])

function missionIsSpaceXLaunchProvider(mission) {
  if (!mission || typeof mission !== 'object') return false
  const idRaw = mission.launchAgencyId
  if (idRaw != null && String(idRaw).trim() !== '') {
    if (SPACEX_AGENCY_IDS.has(String(idRaw).trim())) return true
  }
  const full = String(mission.launchAgency || '').toLowerCase()
  const abbr = String(mission.launchAgencyAbbrev || '').toLowerCase()
  if (full.includes('spacex')) return true
  if (abbr.includes('spacex')) return true
  return false
}

/** LL2 agency 记录（或含 id/name/abbrev 的对象）是否为 SpaceX */
function agencyRecordIsSpaceX(agency) {
  if (!agency || typeof agency !== 'object') return false
  if (agency.id != null && SPACEX_AGENCY_IDS.has(String(agency.id).trim())) return true
  const name = String(agency.name || '').toLowerCase()
  const abbrev = String(agency.abbrev || '').toLowerCase()
  return name.includes('spacex') || abbrev.includes('spacex')
}

/**
 * 发射商 logo 统一出口：SpaceX 一律返回统一 logo（与全球发射统计页同源），
 * 其它机构原样返回
 */
function overrideAgencyLogoUrl(agency, rawUrl) {
  return agencyRecordIsSpaceX(agency) ? SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL : rawUrl
}

/** @returns {Object} 同一引用表示未改 */
function applyLaunchAgencyLogoOverridesToMission(mission) {
  if (!mission || typeof mission !== 'object') return mission
  if (!missionIsSpaceXLaunchProvider(mission)) return mission
  const url = SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL
  if (String(mission.launchAgencyImage || '').trim() === url) return mission
  return { ...mission, launchAgencyImage: url }
}

function applyLaunchAgencyLogoOverridesToMissions(missions) {
  const list = Array.isArray(missions) ? missions : []
  let changed = false
  const next = list.map((m) => {
    const n = applyLaunchAgencyLogoOverridesToMission(m)
    if (n !== m) changed = true
    return n
  })
  return changed ? next : list
}

module.exports = {
  SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL,
  agencyRecordIsSpaceX,
  overrideAgencyLogoUrl,
  missionIsSpaceXLaunchProvider,
  applyLaunchAgencyLogoOverridesToMission,
  applyLaunchAgencyLogoOverridesToMissions
}
