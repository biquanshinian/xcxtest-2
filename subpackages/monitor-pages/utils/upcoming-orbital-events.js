/**
 * 即将进行的在轨任务：从 LL2 events 列表筛对接/出舱/入轨等
 * （监控页 / 云端 spacex_launch_stats 共用同一套类型规则）
 */

/** LL2 type.name 关键词（不区分大小写） */
const ORBITAL_TYPE_RE =
  /dock|berth|\beva\b|spacewalk|hatch|orbital insertion|reboost|crew handover|change of command|spacecraft landing|spacecraft release|spacecraft event|splashdown|crew departure|hatch open|hatch close/

const DEFAULT_LIMIT = 8
const PAST_TOLERANCE_MS = 6 * 60 * 60 * 1000
const MAX_AHEAD_MS = 18 * 30 * 86400 * 1000

function eventTypeName(ev) {
  if (!ev) return ''
  if (ev.typeName) return String(ev.typeName)
  if (ev.type && typeof ev.type === 'object') return String(ev.type.name || '')
  if (typeof ev.type === 'string') return ev.type
  return ''
}

function eventImageUrl(ev) {
  if (!ev) return ''
  if (ev.imageUrl) return String(ev.imageUrl)
  const img = ev.image
  if (typeof img === 'string') return img
  if (img && typeof img === 'object') {
    return img.image_url || img.thumbnail_url || img.url || ''
  }
  return ev.feature_image || ev.image_url || ''
}

function eventDateMs(ev) {
  if (!ev) return NaN
  if (isFinite(ev.dateMs)) return Number(ev.dateMs)
  if (ev.date) return Date.parse(ev.date)
  return NaN
}

function isOrbitalEventType(typeName) {
  return ORBITAL_TYPE_RE.test(String(typeName || '').toLowerCase())
}

/**
 * LL2 / 缓存 events → 在轨任务卡片结构
 * @param {Array} results
 * @param {{ limit?: number, now?: number }} [options]
 */
function pickUpcomingOrbitalEvents(results, options) {
  const limit = (options && options.limit) || DEFAULT_LIMIT
  const now = (options && options.now) || Date.now()
  if (!Array.isArray(results) || !results.length) return []

  const matched = []
  for (let i = 0; i < results.length; i++) {
    const ev = results[i]
    if (!ev) continue
    const typeName = eventTypeName(ev)
    if (!isOrbitalEventType(typeName)) continue
    const dateMs = eventDateMs(ev)
    if (!isFinite(dateMs)) continue
    if (dateMs < now - PAST_TOLERANCE_MS) continue
    if (dateMs > now + MAX_AHEAD_MS) continue

    const vid = Array.isArray(ev.vid_urls) && ev.vid_urls.length ? ev.vid_urls[0] : null
    matched.push({
      id: ev.id,
      slug: ev.slug || '',
      name: ev.nameZh || ev.name || '',
      nameZh: ev.nameZh || '',
      nameEn: ev.name || '',
      typeName,
      typeNameZh: (ev.type && ev.type.nameZh) || ev.typeNameZh || '',
      date: ev.date || '',
      dateMs,
      location: ev.locationZh || ev.location || '',
      locationZh: ev.locationZh || '',
      description: ev.descriptionZh || ev.description || '',
      descriptionZh: ev.descriptionZh || '',
      imageUrl: eventImageUrl(ev),
      webcastUrl: (vid && vid.url) || ev.webcastUrl || '',
      webcastTitle: (vid && vid.title) || ev.webcastTitle || '',
      webcastPublisher: (vid && vid.publisher) || ev.webcastPublisher || '',
      precision: (ev.date_precision && ev.date_precision.name) || ev.precision || ''
    })
  }
  matched.sort((a, b) => a.dateMs - b.dateMs)
  return matched.slice(0, limit)
}

/** 去掉已过期条目（库内陈旧 upcoming 列表） */
function filterFreshOrbitalEvents(list, now) {
  const t = now || Date.now()
  if (!Array.isArray(list)) return []
  return list.filter((ev) => {
    const dateMs = eventDateMs(ev)
    return isFinite(dateMs) && dateMs >= t - PAST_TOLERANCE_MS
  })
}

module.exports = {
  ORBITAL_TYPE_RE,
  isOrbitalEventType,
  pickUpcomingOrbitalEvents,
  filterFreshOrbitalEvents,
  eventTypeName,
  eventImageUrl,
  eventDateMs
}
