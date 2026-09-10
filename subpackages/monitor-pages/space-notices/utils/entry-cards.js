/**
 * SPACE_NOTICES_FEATURE — 列表卡片：分类 + 配图
 * 即将/历史按发射时刻（与首页 upcoming/previous 对齐），配置图走
 * resolveMissionRocketImage('', rocketNameEn, rocketConfiguration, true)
 * 与 utils/api-launch-list.mapLaunchToListItem 同一条路。
 */
const { resolveMissionRocketImage, isDefaultRocketSrc } = require('../../../../utils/util.js')
const { pickConfigById, cleanConfigId } = require('../../../../utils/rocket-config-match.js')
const { decorateSpaceNoticeEntry } = require('./notice-format.js')
const { computeEntryIsPast, launchTimeMs, parseTimeMs } = require('./entry-lifecycle.js')
const { CHINESE_COLLECTION_KEY } = require('./china-filter.js')

function foldKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function digitKey(value) {
  return (String(value || '').match(/\d+/g) || []).map((d) => String(Number(d))).join('-')
}

function launchMissionText(launch) {
  if (!launch || typeof launch !== 'object') return ''
  const pack = launch._langPack || {}
  return String(
    launch.missionName ||
      pack.missionNameEn ||
      pack.missionNameZh ||
      launch.name ||
      pack.nameEn ||
      ''
  )
}

function launchRocketText(launch) {
  if (!launch || typeof launch !== 'object') return ''
  const pack = launch._langPack || {}
  return String(launch.rocketName || pack.rocketNameEn || pack.rocketNameZh || '')
}

function scoreHomeLaunch(entry, launch) {
  if (!entry || !launch) return 0
  const eDigits = digitKey(entry.missionName || entry.missionNameEn || '')
  const lDigits = digitKey(launchMissionText(launch))
  // 有一侧带组号时必须完全一致，避免「Starlink」配到任意 17-51
  if (eDigits !== lDigits) return -100

  const eId = String(entry.ll2Id || '').trim()
  const lId = String(launch.id || '').trim()
  if (eId && lId && eId === lId) return 1000

  const eMission = foldKey(entry.missionName || entry.missionNameEn || '')
  const lMission = foldKey(launchMissionText(launch))
  if (!eMission || !lMission) return 0

  let score = 0
  if (eMission === lMission) score += 70
  else if (eMission.length >= 4 && lMission.length >= 4 && (eMission.indexOf(lMission) >= 0 || lMission.indexOf(eMission) >= 0)) {
    score += 40
  } else {
    return 0
  }

  const eRocket = foldKey(entry.rocketName || entry.rocketNameEn || '')
  const lRocket = foldKey(launchRocketText(launch))
  if (eRocket && lRocket) {
    if (eRocket === lRocket) score += 20
    else if (eRocket.indexOf(lRocket) >= 0 || lRocket.indexOf(eRocket) >= 0) score += 12
  }
  return score
}

const HOME_MATCH_THRESHOLD = 62

function pickBestLaunch(entry, list) {
  let best = null
  let bestScore = 0
  ;(Array.isArray(list) ? list : []).forEach((launch) => {
    const s = scoreHomeLaunch(entry, launch)
    if (s > bestScore) {
      bestScore = s
      best = launch
    }
  })
  return bestScore >= HOME_MATCH_THRESHOLD ? best : null
}

function matchHomeLaunch(entry, upcomingLaunches, previousLaunches) {
  const up = pickBestLaunch(entry, upcomingLaunches)
  const prev = pickBestLaunch(entry, previousLaunches)
  const upScore = up ? scoreHomeLaunch(entry, up) : 0
  const prevScore = prev ? scoreHomeLaunch(entry, prev) : 0
  if (upScore >= HOME_MATCH_THRESHOLD && upScore >= prevScore) return { launch: up, homeBucket: 'upcoming' }
  if (prevScore >= HOME_MATCH_THRESHOLD) return { launch: prev, homeBucket: 'previous' }
  return null
}

function overlayHomeLaunch(entry, launch, homeBucket) {
  const row = entry && typeof entry === 'object' ? entry : {}
  if (!launch || typeof launch !== 'object') return Object.assign({}, row, { homeBucket: homeBucket || '' })
  const net = launch.launchTime || launch.net || row.net || ''
  const cfg = launch.rocketConfiguration && typeof launch.rocketConfiguration === 'object'
    ? launch.rocketConfiguration
    : row.rocketConfiguration || null
  return Object.assign({}, row, {
    ll2Id: launch.id || row.ll2Id || '',
    net: net || row.net || '',
    windowStart: launch.windowStart || '',
    windowStartMs: parseTimeMs(launch.windowStart) || parseTimeMs(net) || 0,
    rocketName: launch.rocketName || row.rocketName || '',
    rocketConfiguration: cfg,
    rocketConfigId: (launch.rocketConfigId != null ? launch.rocketConfigId : null)
      || (cfg && cfg.id != null ? cfg.id : null)
      || row.rocketConfigId
      || '',
    homeRocketImage: launch.rocketImage || '',
    // 首页 status 是中文 badge，不能写入 statusName（会误触终态正则）
    statusName: row.statusName || launch.statusName || '',
    statusAbbrev: launch.statusAbbrev || row.statusAbbrev || '',
    statusId: launch.statusId != null ? launch.statusId : row.statusId,
    statusCategory: launch.statusCategory || row.statusCategory || '',
    homeBucket: homeBucket || ''
  })
}

function usableRocketImage(url) {
  const s = url == null ? '' : String(url).trim()
  if (!s || isDefaultRocketSrc(s)) return ''
  return s
}

/**
 * 与首页 mapLaunchToListItem 同一调用：
 * resolveMissionRocketImage('', rocketNameEn, rocketConfiguration, true)
 */
function configAssetUrl(cfg) {
  if (!cfg || typeof cfg !== 'object') return ''
  return usableRocketImage(cfg.cosImageUrl || cfg.thumbnail_url || cfg.image_url || '')
}

function resolveEntryRocketImage(entry, configs) {
  const row = entry && typeof entry === 'object' ? entry : {}
  const home = usableRocketImage(row.homeRocketImage)
  if (home) return home

  const rocketEn = String(row.rocketNameEn || row.rocketName || '').trim()
  let cfg = row.rocketConfiguration && typeof row.rocketConfiguration === 'object'
    ? row.rocketConfiguration
    : null
  if (!cfg && configs) {
    cfg = pickConfigById(configs, row.rocketConfigId || (row.rocketConfiguration && row.rocketConfiguration.id))
  }
  const rebuilt = resolveMissionRocketImage('', rocketEn, cfg, true)
  return usableRocketImage(rebuilt) || configAssetUrl(cfg)
}

function formatNet(net, windowStartMs) {
  const raw = net || (windowStartMs ? new Date(windowStartMs).toISOString() : '')
  if (!raw) return '时间待定'
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return String(raw)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  } catch (e) {
    return String(raw)
  }
}

function formatNetShort(net, windowStartMs) {
  const raw = net || (windowStartMs ? new Date(windowStartMs).toISOString() : '')
  if (!raw) return '时间待定'
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return '时间待定'
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return m + '-' + day
  } catch (e) {
    return '时间待定'
  }
}

function decorateEntryCard(entry, opts) {
  const options = opts || {}
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const hit = matchHomeLaunch(entry, options.upcomingLaunches, options.previousLaunches)
  const overlaid = hit ? overlayHomeLaunch(entry, hit.launch, hit.homeBucket) : (entry || {})
  const base = decorateSpaceNoticeEntry(overlaid)
  const rocketImage = resolveEntryRocketImage(Object.assign({}, base, overlaid), options.configs)
  const isPast = computeEntryIsPast(Object.assign({}, base, overlaid), now)
  const cfg = overlaid.rocketConfiguration && typeof overlaid.rocketConfiguration === 'object'
    ? overlaid.rocketConfiguration
    : (base.rocketConfiguration && typeof base.rocketConfiguration === 'object' ? base.rocketConfiguration : null)
  const rocketConfigId = cleanConfigId(
    (cfg && cfg.id) || overlaid.rocketConfigId || base.rocketConfigId
  )
  const noticeCount = Number(base.noticeCount)
  const safeNoticeCount = Number.isFinite(noticeCount) ? noticeCount : 0
  const metaBits = []
  const launchMs = launchTimeMs(Object.assign({}, base, overlaid))
  metaBits.push(formatNet(base.net, launchMs))
  metaBits.push('通告 ' + safeNoticeCount)
  if (base.hasTrajectory) metaBits.push('含轨迹')
  if (base.agencyDisplay) metaBits.push(base.agencyDisplay)
  return Object.assign({}, base, overlaid, {
    isPast,
    rocketImage,
    noticeCount: safeNoticeCount,
    netText: formatNet(base.net, launchMs),
    dateShort: formatNetShort(base.net, launchMs),
    netShort: formatNetShort(base.net, launchMs),
    metaText: metaBits.join(' · '),
    rocketConfigId,
    rocketClickable: !!rocketConfigId
  })
}

function isGridEntry(entry) {
  if (!entry || !entry.entryKey) return false
  if (entry.isCollection) return false
  if (entry.entryKey === CHINESE_COLLECTION_KEY) return false
  return true
}

function sortCardTime(entry) {
  return launchTimeMs(entry) || parseTimeMs(entry.net) || 0
}

function splitEntryCards(rows, opts) {
  const decorated = (Array.isArray(rows) ? rows : [])
    .map((row) => decorateEntryCard(row, opts))
    .filter(isGridEntry)

  const upcoming = decorated
    .filter((e) => !e.isPast)
    .sort((a, b) => sortCardTime(a) - sortCardTime(b))
    .map((e, i) => Object.assign({}, e, { badgeNo: i + 1 }))

  const past = decorated
    .filter((e) => e.isPast)
    .sort((a, b) => sortCardTime(b) - sortCardTime(a))
    .map((e, i) => Object.assign({}, e, { badgeNo: i + 1 }))

  return { upcoming, past, totalCount: decorated.length }
}

function applyConfigImages(cards, configs) {
  if (!configs || !cards) return cards
  return (cards || []).map((card) => {
    if (usableRocketImage(card && card.rocketImage)) return card
    const next = resolveEntryRocketImage(card, configs)
    return next ? Object.assign({}, card, { rocketImage: next }) : card
  })
}

module.exports = {
  foldKey,
  digitKey,
  HOME_MATCH_THRESHOLD,
  scoreHomeLaunch,
  matchHomeLaunch,
  overlayHomeLaunch,
  usableRocketImage,
  resolveEntryRocketImage,
  formatNet,
  formatNetShort,
  decorateEntryCard,
  splitEntryCards,
  applyConfigImages
}
