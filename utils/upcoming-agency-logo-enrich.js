/**
 * 首页「即将发射」胶囊：任务列表里的 launch_service_provider 往往不带 logo，
 * 与监控页「全球发射商图鉴」一致，从 /agencies/ 批量记录解析 logo（thumbnail_url / image_url）。
 */

const { getAgencies, getAgencyDetail } = require('./api-monitor-data.js')
const { applyLaunchAgencyLogoOverridesToMissions } = require('./agency-logo-overrides.js')

const AGENCY_LOGO_FALLBACK_SUBSTR = '/images/icons/ic-rocket-outline'

function absolutizeAgencyAssetUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/^cloud:\/\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  if (s.startsWith('/')) return `https://ll.thespacedevs.com${s}`
  return s
}

/** 与 monitor.js _formatAgency 中 logo 解析逻辑对齐 */
function logoUrlFromAgencyRecord(agency) {
  if (!agency || typeof agency !== 'object') return ''
  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return ''
    const u = (obj.thumbnail_url || obj.image_url || obj.url || '').trim()
    return typeof u === 'string' ? u : ''
  }
  const raw = pick(agency.logo) || pick(agency.image) || pick(agency.social_logo)
  return raw ? absolutizeAgencyAssetUrl(raw) : ''
}

function missionNeedsAgencyLogoEnrichment(mission) {
  if (!mission || mission.launchAgencyId == null || String(mission.launchAgencyId).trim() === '') {
    return false
  }
  const img = String(mission.launchAgencyImage || '').trim()
  if (!img) return true
  if (img.indexOf(AGENCY_LOGO_FALLBACK_SUBSTR) !== -1) return true
  return false
}

let _bulkLogoMapPromise = null

function getBulkAgencyLogoMap() {
  if (_bulkLogoMapPromise) return _bulkLogoMapPromise
  _bulkLogoMapPromise = getAgencies({ featured: false, limit: 400, offset: 0 })
    .then((data) => {
      const map = new Map()
      const results = (data && data.results) || []
      for (let i = 0; i < results.length; i++) {
        const a = results[i]
        if (!a || a.id == null) continue
        const url = logoUrlFromAgencyRecord(a)
        if (url) map.set(String(a.id), url)
      }
      return map
    })
    .catch(() => new Map())
  return _bulkLogoMapPromise
}

/**
 * 为即将发射列表项补齐 launchAgencyImage（不改顺序与其它字段）
 * @param {Object[]} missions
 * @returns {Promise<Object[]>}
 */
async function enrichMissionsLaunchAgencyImages(missions) {
  const list = Array.isArray(missions) ? missions : []
  let anyNeed = false
  for (let i = 0; i < list.length; i++) {
    if (missionNeedsAgencyLogoEnrichment(list[i])) {
      anyNeed = true
      break
    }
  }
  // 即使无需补图，也要套用 SpaceX 统一 logo 覆盖
  if (!anyNeed) return applyLaunchAgencyLogoOverridesToMissions(list)

  const map = new Map(await getBulkAgencyLogoMap())

  const missingIds = new Set()
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!missionNeedsAgencyLogoEnrichment(m)) continue
    const id = String(m.launchAgencyId)
    if (!map.has(id)) missingIds.add(id)
  }

  const detailQueue = Array.from(missingIds).slice(0, 24)
  await Promise.all(
    detailQueue.map(async (idStr) => {
      try {
        const d = await getAgencyDetail(idStr)
        const u = logoUrlFromAgencyRecord(d)
        if (u) map.set(idStr, u)
      } catch (e) {}
    })
  )

  let changed = false
  const next = list.map((m) => {
    if (!missionNeedsAgencyLogoEnrichment(m)) return m
    const u = map.get(String(m.launchAgencyId))
    if (!u) return m
    changed = true
    return { ...m, launchAgencyImage: u }
  })

  const enriched = changed ? next : list
  return applyLaunchAgencyLogoOverridesToMissions(enriched)
}

module.exports = {
  enrichMissionsLaunchAgencyImages,
  logoUrlFromAgencyRecord
}
