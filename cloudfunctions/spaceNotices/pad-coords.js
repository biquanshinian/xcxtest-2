/**
 * SPACE_NOTICES_FEATURE — slim 缓存无 lat/lon 时的发射台坐标补齐（纯函数，可本地测）
 *
 * LL2 slimLaunch 历史上会丢掉 pad.latitude/longitude，只留 name + location.name。
 * 星舰靠 Starbase 名称能补点；其它发射场必须靠本表按 pad / location 名回填，
 * 否则地图既无红色坐标，默认视野也会落到 Starbase 兜底。
 */

/** 工位名优先（比场地更精确） */
const PAD_COORDS_BY_NAME = [
  // Starbase
  { re: /orbital launch pad\s*2/i, name: 'Orbital Launch Pad 2', latitude: 25.99677, longitude: -97.15799 },
  { re: /orbital launch pad\s*1|olm\b/i, name: 'Orbital Launch Pad 1', latitude: 25.9962, longitude: -97.154423 },
  { re: /suborbital pad\s*b/i, name: 'Suborbital Pad B', latitude: 25.997116, longitude: -97.155031 },
  { re: /suborbital pad\s*a/i, name: 'Suborbital Pad A', latitude: 25.997116, longitude: -97.155031 },
  // Vandenberg
  { re: /slc[- ]?4e\b|space launch complex\s*4e/i, name: 'SLC-4E', latitude: 34.632, longitude: -120.6106 },
  { re: /slc[- ]?4w\b|space launch complex\s*4w/i, name: 'SLC-4W', latitude: 34.633, longitude: -120.615 },
  { re: /slc[- ]?3e\b/i, name: 'SLC-3E', latitude: 34.640, longitude: -120.589 },
  { re: /slc[- ]?6\b|space launch complex\s*6/i, name: 'SLC-6', latitude: 34.5812, longitude: -120.6266 },
  // Cape / KSC
  { re: /slc[- ]?40\b|space launch complex\s*40/i, name: 'SLC-40', latitude: 28.5619, longitude: -80.5772 },
  { re: /slc[- ]?41\b|space launch complex\s*41/i, name: 'SLC-41', latitude: 28.5833, longitude: -80.583 },
  { re: /lc[- ]?39a\b|launch complex\s*39a/i, name: 'LC-39A', latitude: 28.6082, longitude: -80.6041 },
  { re: /lc[- ]?39b\b|launch complex\s*39b/i, name: 'LC-39B', latitude: 28.6272, longitude: -80.621 },
  { re: /slc[- ]?37\b/i, name: 'SLC-37', latitude: 28.5319, longitude: -80.5648 },
  { re: /lc[- ]?16\b/i, name: 'LC-16', latitude: 28.5016, longitude: -80.5187 },
  // China
  { re: /wenchang|文昌/i, name: 'Wenchang', latitude: 19.6145, longitude: 110.951 },
  { re: /xichang|西昌/i, name: 'Xichang', latitude: 28.246, longitude: 102.0281 },
  { re: /taiyuan|太原/i, name: 'Taiyuan', latitude: 38.849, longitude: 111.608 },
  { re: /jiuquan|酒泉/i, name: 'Jiuquan', latitude: 40.9605, longitude: 100.2983 },
  // Other common
  { re: /baikonur|拜科努尔/i, name: 'Baikonur', latitude: 45.965, longitude: 63.305 },
  { re: /plesetsk|普列谢茨克/i, name: 'Plesetsk', latitude: 62.9272, longitude: 40.575 },
  { re: /vostochny|东方/i, name: 'Vostochny', latitude: 51.8844, longitude: 128.3339 },
  { re: /guiana|kourou|圭亚那/i, name: 'Guiana Space Centre', latitude: 5.232, longitude: -52.769 },
  { re: /tanegashima|种子岛/i, name: 'Tanegashima', latitude: 30.401, longitude: 130.978 },
  { re: /satish dhawan|sriharikota/i, name: 'Satish Dhawan', latitude: 13.72, longitude: 80.23 },
  { re: /wallops/i, name: 'Wallops', latitude: 37.94, longitude: -75.466 },
  { re: /mahia|rocket lab launch complex\s*1/i, name: 'Rocket Lab LC-1', latitude: -39.2615, longitude: 177.8648 },
  { re: /kodiak|pacific spaceport/i, name: 'Kodiak', latitude: 57.435, longitude: -152.339 }
]

/** 场地名回退（pad 名未命中时） */
const LOCATION_COORDS = [
  { re: /starbase|boca chica/i, name: 'Starbase', latitude: 25.9972, longitude: -97.1566 },
  { re: /vandenberg/i, name: 'Vandenberg SFB', latitude: 34.742, longitude: -120.5724 },
  { re: /cape canaveral/i, name: 'Cape Canaveral', latitude: 28.4889, longitude: -80.5778 },
  { re: /kennedy space/i, name: 'Kennedy Space Center', latitude: 28.6082, longitude: -80.604 },
  { re: /wenchang|文昌/i, name: 'Wenchang', latitude: 19.6145, longitude: 110.951 },
  { re: /xichang|西昌/i, name: 'Xichang', latitude: 28.246, longitude: 102.0281 },
  { re: /taiyuan|太原/i, name: 'Taiyuan', latitude: 38.849, longitude: 111.608 },
  { re: /jiuquan|酒泉/i, name: 'Jiuquan', latitude: 40.9605, longitude: 100.2983 },
  { re: /baikonur/i, name: 'Baikonur', latitude: 45.965, longitude: 63.305 },
  { re: /plesetsk/i, name: 'Plesetsk', latitude: 62.9272, longitude: 40.575 },
  { re: /vostochny/i, name: 'Vostochny', latitude: 51.8844, longitude: 128.3339 },
  { re: /guiana|kourou/i, name: 'Guiana Space Centre', latitude: 5.232, longitude: -52.769 },
  { re: /tanegashima/i, name: 'Tanegashima', latitude: 30.401, longitude: 130.978 },
  { re: /satish dhawan|sriharikota/i, name: 'Satish Dhawan', latitude: 13.72, longitude: 80.23 },
  { re: /wallops/i, name: 'Wallops', latitude: 37.94, longitude: -75.466 },
  { re: /mahia/i, name: 'Mahia', latitude: -39.2615, longitude: 177.8648 },
  { re: /kodiak|pacific spaceport/i, name: 'Kodiak', latitude: 57.435, longitude: -152.339 }
]

const STARBASE_FALLBACK = {
  name: 'Starbase',
  latitude: 25.9972,
  longitude: -97.1566
}

function matchCoords(list, text) {
  const s = String(text || '')
  if (!s) return null
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    if (row.re.test(s)) {
      return { name: row.name, latitude: row.latitude, longitude: row.longitude }
    }
  }
  return null
}

function resolvePadCoords(pad) {
  const padName = String((pad && pad.name) || '')
  const locName = String((pad && pad.location && pad.location.name) || '')

  // 1) 缓存里已有数值坐标（slimLaunch 保留 lat/lon 后走这里）
  const lat = pad && pad.latitude != null ? Number(pad.latitude) : null
  const lon = pad && pad.longitude != null ? Number(pad.longitude) : null
  if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
    return { name: padName || locName || '', latitude: lat, longitude: lon }
  }

  // 2) 工位名
  const byPad = matchCoords(PAD_COORDS_BY_NAME, padName)
  if (byPad) {
    return { name: padName || byPad.name, latitude: byPad.latitude, longitude: byPad.longitude }
  }

  // 3) 场地名（pad.location 或 pad.name 里带场地）
  const byLoc = matchCoords(LOCATION_COORDS, locName) || matchCoords(LOCATION_COORDS, padName)
  if (byLoc) {
    return { name: padName || locName || byLoc.name, latitude: byLoc.latitude, longitude: byLoc.longitude }
  }

  return { name: padName || locName || '', latitude: null, longitude: null }
}

function isStarshipLaunch(row) {
  if (!row) return false
  const name = String(row.name || '')
  const cfg = row.rocket && row.rocket.configuration
  const rocket = String((cfg && (cfg.name || cfg.full_name)) || '')
  return /starship/i.test(rocket) || /starship/i.test(name)
}

/**
 * @param {object} row LL2 detailed 行
 * @param {{ starshipOnly?: boolean }} [opts] 早期只收录星舰；现在全量收录，仅在需要时收紧
 */
function slimFromCacheRow(row, opts) {
  if (!row || !row.id) return null
  if (opts && opts.starshipOnly && !isStarshipLaunch(row)) return null
  const padRaw = row.pad || {}
  const pad = resolvePadCoords(padRaw)
  const cfg = row.rocket && row.rocket.configuration
  const starship = isStarshipLaunch(row)
  const status = row.status || {}
  const provider = row.launch_service_provider || {}
  const mission = row.mission || {}
  return {
    ll2Id: String(row.id),
    slug: String(row.slug || ''),
    title: String(row.name || ''),
    titleZh: String(row.nameZh || (row.mission && row.mission.nameZh) || ''),
    subtitle: String((cfg && (cfg.name || cfg.full_name)) || (starship ? 'Starship' : '')),
    subtitleZh: String((cfg && (cfg.full_nameZh || cfg.nameZh)) || ''),
    description: String(mission.description || '').slice(0, 500),
    net: row.net || '',
    windowStart: row.window_start || '',
    windowEnd: row.window_end || '',
    pad,
    isStarship: starship,
    statusName: String(status.name || ''),
    statusAbbrev: String(status.abbrev || ''),
    agency: String(provider.name || ''),
    agencyZh: String(provider.nameZh || ''),
    orbitName: String((mission.orbit && mission.orbit.name) || ''),
    missionType: String(mission.type || '')
  }
}

module.exports = {
  resolvePadCoords,
  isStarshipLaunch,
  slimFromCacheRow,
  STARBASE_FALLBACK,
  PAD_COORDS_BY_NAME,
  LOCATION_COORDS
}
