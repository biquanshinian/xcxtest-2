/**
 * 首页「即将发射」胶囊 logo：与监控页发射商图鉴同一条链路。
 * 权威来源 = getAgencies() 缓存里的 agency.logo（云端 syncImageMirror 后多为 COS LL2镜像），
 * 再经 overrideAgencyLogoUrl（SpaceX → 发射商logo/ 固定图）。
 */

const { getAgencies, getAgencyDetail } = require('./api-monitor-data.js')
const {
  overrideAgencyLogoUrl,
  applyLaunchAgencyLogoOverridesToMissions
} = require('./agency-logo-overrides.js')

function absolutizeAgencyAssetUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/^cloud:\/\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  if (s.startsWith('/')) return `https://ll.thespacedevs.com${s}`
  return s
}

/**
 * 与 agency-data.formatAgency 一致：
 * overrideAgencyLogoUrl(agency, agency.logo.thumbnail_url || agency.logo.image_url)
 */
function logoUrlFromAgencyRecord(agency) {
  if (!agency || typeof agency !== 'object') return ''
  const raw = agency.logo
    ? absolutizeAgencyAssetUrl(agency.logo.thumbnail_url || agency.logo.image_url || '')
    : ''
  const out = overrideAgencyLogoUrl(agency, raw)
  return typeof out === 'string' ? out.trim() : ''
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
 * 按 agencyId 写成与图鉴相同的 logo URL（目录有图则覆盖 launch 内嵌外链）。
 * @param {Object[]} missions
 * @returns {Promise<Object[]>}
 */
async function enrichMissionsLaunchAgencyImages(missions) {
  const list = Array.isArray(missions) ? missions : []
  if (!list.length) return list

  const map = new Map(await getBulkAgencyLogoMap())

  const missingIds = new Set()
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || m.launchAgencyId == null) continue
    const id = String(m.launchAgencyId).trim()
    if (!id) continue
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
    if (!m || typeof m !== 'object') return m
    const id = m.launchAgencyId != null ? String(m.launchAgencyId).trim() : ''
    const catalog = id ? map.get(id) || '' : ''
    const prev = String(m.launchAgencyImage || '').trim()
    // 图鉴 COS 优先；无目录图时保留 launch 内嵌
    if (catalog && catalog !== prev) {
      changed = true
      return { ...m, launchAgencyImage: catalog }
    }
    return m
  })

  const withCatalog = changed ? next : list
  return applyLaunchAgencyLogoOverridesToMissions(withCatalog)
}

module.exports = {
  enrichMissionsLaunchAgencyImages,
  logoUrlFromAgencyRecord,
  getBulkAgencyLogoMap
}
