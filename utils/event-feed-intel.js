/**
 * 事件更新活窗口能力（推文约 7 天 / 最多约 100 条，不做历史档案）：
 * 关键词命中、新动态、关注账号、当时关联发射、当日重点。
 */
const FEED_SEEN_KEY = '_event_updates_feed_seen_at'
const LAUNCH_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
const LAUNCH_LOOKBACK_MS = 12 * 60 * 60 * 1000

const { isPlaceholderMissionField } = require('./mission-list-card.js')

const DEFAULT_EVENT_ALERT_KEYWORDS = [
  '封路',
  'static fire',
  '静态点火',
  '回收',
  '推迟',
  'scrub',
  'Flight',
  '星舰'
]

const HIGHLIGHT_EXTRA_KEYWORDS = ['发射', '测试', '点火', 'launch', 'test']

const EVENT_WATCH_ACCOUNT_OPTIONS = [
  { screenName: 'SpaceX', label: 'SpaceX' },
  { screenName: 'Starlink', label: 'Starlink' },
  { screenName: 'NASASpaceflight', label: 'NSF' },
  { screenName: 'StarshipGazer', label: 'StarshipGazer' },
  { screenName: 'NASA', label: 'NASA' },
  { screenName: 'elonmusk', label: 'Elon Musk' },
  { screenName: 'JerryPikePhoto', label: 'Jerry Pike' },
  { screenName: 'CNSpaceflight', label: 'CNSpaceflight' },
  { screenName: 'InfographicTony', label: 'Tony Bela' },
  { screenName: 'LandSpace_Tech', label: '蓝箭航天' }
]

const TOKEN_STOP = {
  mission: 1, launch: 1, satellite: 1, group: 1, flight: 1,
  任务: 1, 发射: 1, 卫星: 1, 组: 1, the: 1, and: 1, for: 1
}

function _norm(s) {
  return String(s || '').trim().toLowerCase()
}

function eventHaystack(item) {
  if (!item) return ''
  return _norm([
    item.title,
    item.content,
    item.originalText,
    item.author,
    item.source
  ].join('\n'))
}

function getEventAlertKeywords(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {}
  if (!p.eventAlertKeywordsV1) return DEFAULT_EVENT_ALERT_KEYWORDS.slice()
  if (!Array.isArray(p.eventAlertKeywords)) return DEFAULT_EVENT_ALERT_KEYWORDS.slice()
  return p.eventAlertKeywords.map((s) => String(s || '').trim()).filter(Boolean)
}

function getEventWatchSources(prefs, canWatch) {
  if (!canWatch) return []
  const list = prefs && Array.isArray(prefs.eventWatchSources) ? prefs.eventWatchSources : []
  return list.map((s) => String(s || '').trim()).filter(Boolean)
}

function matchKeywords(item, keywords) {
  const list = Array.isArray(keywords) ? keywords : []
  if (!list.length) return []
  const hay = eventHaystack(item)
  if (!hay) return []
  const hits = []
  const seen = {}
  for (let i = 0; i < list.length; i++) {
    const raw = String(list[i] || '').trim()
    if (!raw) continue
    const key = _norm(raw)
    if (!key || seen[key]) continue
    if (hay.indexOf(key) >= 0) {
      seen[key] = 1
      hits.push(raw)
    }
  }
  return hits.slice(0, 3)
}

function detectMediaKind(item) {
  const media = item && Array.isArray(item.mediaList) ? item.mediaList : []
  let image = false
  let video = false
  for (let i = 0; i < media.length; i++) {
    const t = media[i] && media[i].type
    if (t === 'video') video = true
    else if (t === 'image') image = true
  }
  if (video && image) return 'both'
  if (video) return 'video'
  if (image) return 'image'
  return 'none'
}

function isItemNew(item, lastSeenAt) {
  const seen = Number(lastSeenAt) || 0
  if (seen <= 0) return false
  const ts = Number(item && item.publishedAt) || 0
  return ts > seen
}

function countNewItems(items, lastSeenAt) {
  const list = Array.isArray(items) ? items : []
  let n = 0
  for (let i = 0; i < list.length; i++) {
    if (isItemNew(list[i], lastSeenAt)) n++
  }
  return n
}

function stripMissionPipe(s) {
  return String(s || '').trim().replace(/^\s*[^|]*\|\s*/, '')
}

function pushSearchToken(tokens, seen, raw, applyStop) {
  const t = String(raw || '').trim()
  if (t.length < 3) return
  const key = _norm(t)
  if (!key || seen[key]) return
  if (applyStop && TOKEN_STOP[key]) return
  seen[key] = 1
  tokens.push(t)
}

function launchSearchTokens(launch) {
  if (!launch) return []
  const pack = launch._langPack || {}
  const raw = [
    launch.rocketName,
    launch.rocketNameEn,
    launch.rocketNameZh,
    pack.rocketNameEn,
    pack.rocketNameZh,
    launch.missionName,
    launch.name,
    pack.missionNameEn,
    pack.missionNameZh,
    stripMissionPipe(launch.missionName),
    stripMissionPipe(launch.name),
    stripMissionPipe(pack.missionNameEn),
    stripMissionPipe(pack.missionNameZh)
  ]
  const tokens = []
  const seen = {}
  for (let i = 0; i < raw.length; i++) {
    pushSearchToken(tokens, seen, raw[i], false)
  }
  for (let i = 0; i < raw.length; i++) {
    String(raw[i] || '')
      .split(/[\s|/·,，、()（）]+/)
      .forEach((part) => pushSearchToken(tokens, seen, part, true))
  }
  return tokens
}

function matchRelatedLaunch(item, launches) {
  const list = Array.isArray(launches) ? launches : []
  if (!list.length || !item) return null
  const hay = eventHaystack(item)
  if (!hay) return null
  const now = Date.now()
  let best = null
  for (let i = 0; i < list.length; i++) {
    const launch = list[i]
    if (!launch || launch.id == null || String(launch.id) === '') continue
    const tokens = launchSearchTokens(launch)
    let score = 0
    let textHit = false
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t]
      const key = _norm(tok)
      if (!key || hay.indexOf(key) < 0) continue
      textHit = true
      score += key.length >= 7 ? 4 : 3
    }
    if (!textHit) continue
    const ts = launch.launchTime ? new Date(launch.launchTime).getTime() : NaN
    const dist = Number.isFinite(ts) ? Math.abs(ts - now) : Number.POSITIVE_INFINITY
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { launch, score, dist }
    }
  }
  if (!best || best.score < 3) return null
  return slimRelatedLaunch(best.launch)
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

function formatRelatedLaunchTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const b = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return pad2(b.getUTCMonth() + 1) + '月' + pad2(b.getUTCDate()) + '日 ' + pad2(b.getUTCHours()) + ':' + pad2(b.getUTCMinutes())
}

function resolveRelatedRocketImage(launch) {
  const raw = String((launch && (launch.rocketImage || launch.image)) || '').trim()
  try {
    const { resolveMissionRocketImage } = require('./util.js')
    const pack = (launch && launch._langPack) || {}
    const rocketEn = String(
      pack.rocketNameEn || launch.rocketNameEn || launch.rocketName || ''
    ).trim()
    // 空 stamp：强制走火箭配置图，避免列表里的发射现场图被盖章粘住
    return resolveMissionRocketImage('', rocketEn, launch && launch.rocketConfiguration, true) || raw
  } catch (e) {
    return raw
  }
}

function pickRealField(values) {
  const list = Array.isArray(values) ? values : []
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || '').trim()
    if (!isPlaceholderMissionField(s)) return s
  }
  return ''
}

function resolveRelatedDetailType(launch) {
  if (!launch) return 'upcoming'
  if (launch._detailType === 'completed' || launch._detailType === 'upcoming') return launch._detailType
  if (launch._isUpcoming === false) return 'completed'
  if (launch._isUpcoming === true) return 'upcoming'
  const ts = launch.launchTime ? new Date(launch.launchTime).getTime() : NaN
  if (Number.isFinite(ts) && ts <= Date.now() - 30 * 60 * 1000) return 'completed'
  return 'upcoming'
}

function slimRelatedLaunch(launch) {
  if (!launch || launch.id == null || String(launch.id) === '') return null
  const pack = (launch && launch._langPack) || {}
  const rocket = pickRealField([
    pack.rocketNameZh,
    launch.rocketNameZh,
    pack.rocketNameEn,
    launch.rocketName,
    launch.rocketNameEn
  ])
  const mission = pickRealField([
    stripMissionPipe(pack.missionNameZh),
    stripMissionPipe(launch.missionName),
    stripMissionPipe(pack.missionNameEn),
    stripMissionPipe(launch.name)
  ])
  const pad = pickRealField([
    pack.padLocationZh,
    pack.launchSiteZh,
    pack.locationNameZh,
    pack.padNameZh,
    launch.padLocationZh,
    launch.launchSite,
    launch.padLocationName,
    launch.padName,
    pack.padLocationEn,
    pack.launchSiteEn,
    launch.padLocation
  ])
  const country = pickRealField([
    pack.countryDisplayZh,
    launch.countryDisplay,
    pack.countryDisplayEn
  ])
  const label = [rocket, mission].filter(Boolean).join(' · ')
  const detailType = resolveRelatedDetailType(launch)
  const statusBadgeText = String(launch.statusBadgeText || launch.status || (detailType === 'completed' ? '已发射' : '计划中')).trim()
  const slim = {
    id: String(launch.id),
    detailType,
    label: label || '即将发射',
    rocketName: rocket,
    missionName: mission || label || '即将发射',
    rocketImage: resolveRelatedRocketImage(launch),
    formattedTime: String(launch.formattedTime || '').trim() || formatRelatedLaunchTime(launch.launchTime),
    statusBadgeText,
    statusCategory: String(launch.statusCategory || (detailType === 'completed' ? 'success' : 'pending')).trim() || 'pending',
    padLocation: pad,
    countryDisplay: country
  }
  slim.card = {
    id: slim.id,
    _detailType: slim.detailType,
    rocketName: slim.rocketName,
    missionName: slim.missionName,
    name: slim.missionName,
    rocketImage: slim.rocketImage,
    formattedTime: slim.formattedTime,
    statusBadgeText: slim.statusBadgeText,
    status: slim.statusBadgeText,
    statusCategory: slim.statusCategory,
    padLocation: slim.padLocation,
    countryDisplay: slim.countryDisplay,
    recoveryTagText: pickRealField([
      launch.recoveryTagText,
      pack.recoveryTagTextZh,
      pack.recoveryTagTextEn
    ]),
    recoveryTagClass: String(launch.recoveryTagClass || '').trim(),
    recoveryIcons: Array.isArray(launch.recoveryIcons) ? launch.recoveryIcons : [],
    flightCountLabel: String(launch.flightCountLabel || '').trim(),
    hasOrbitPano: !!launch.hasOrbitPano,
    rocketConfiguration: launch.rocketConfiguration || null,
    _langPack: launch._langPack || {}
  }
  return slim
}

function relatedLaunchFavorited(id) {
  try {
    return require('./favorites.js').isFavorite('mission', id)
  } catch (e) {
    return false
  }
}

function flattenRelatedLaunch(related) {
  if (!related) {
    return {
      relatedLaunchId: '',
      relatedLaunchType: 'upcoming',
      relatedLaunchLabel: '',
      relatedLaunchRocketImage: '',
      relatedLaunchRocket: '',
      relatedLaunchMission: '',
      relatedLaunchTime: '',
      relatedLaunchStatus: '',
      relatedLaunchStatusCategory: 'pending',
      relatedLaunchPad: '',
      relatedLaunchCountry: '',
      relatedLaunchFavorited: false,
      relatedLaunchFavAnimate: false,
      relatedLaunchCard: null
    }
  }
  return {
    relatedLaunchId: related.id,
    relatedLaunchType: related.detailType,
    relatedLaunchLabel: related.label,
    relatedLaunchRocketImage: related.rocketImage || '',
    relatedLaunchRocket: related.rocketName || '',
    relatedLaunchMission: related.missionName || related.label || '',
    relatedLaunchTime: related.formattedTime || '',
    relatedLaunchStatus: related.statusBadgeText || '',
    relatedLaunchStatusCategory: related.statusCategory || 'pending',
    relatedLaunchPad: related.padLocation || '',
    relatedLaunchCountry: related.countryDisplay || '',
    relatedLaunchFavorited: relatedLaunchFavorited(related.id),
    relatedLaunchFavAnimate: false,
    relatedLaunchCard: related.card || null
  }
}

function beijingDayStartMs(now) {
  const t = Number(now) || Date.now()
  const offset = 8 * 60 * 60 * 1000
  const b = new Date(t + offset)
  return Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - offset
}

function highlightScore(item, keywords) {
  let score = 0
  const hits = matchKeywords(item, keywords)
  if (hits.length) score += 4 + Math.min(2, hits.length - 1)
  const kind = item.mediaKind || detectMediaKind(item)
  if (kind === 'video' || kind === 'both') score += 3
  else if (kind === 'image') score += 2
  if (item.liveRoomId) score += 2
  const src = String(item.source || '').toLowerCase()
  if (src === 'spacex' || src === 'landspace_tech') score += 1
  return score
}

function pickTodayHighlights(items, now, limit) {
  const cap = Math.max(1, Number(limit) || 3)
  const start = beijingDayStartMs(now)
  const today = (Array.isArray(items) ? items : []).filter((it) => {
    return it && (Number(it.publishedAt) || 0) >= start
  })
  const keywords = DEFAULT_EVENT_ALERT_KEYWORDS.concat(HIGHLIGHT_EXTRA_KEYWORDS)
  const ranked = today.map((item) => ({
    item,
    score: highlightScore(item, keywords),
    ts: Number(item.publishedAt) || 0
  }))
  ranked.sort((a, b) => (b.score - a.score) || (b.ts - a.ts))
  return ranked.slice(0, cap).map((row) => row.item)
}

function slimHighlightItem(item) {
  if (!item) return null
  const content = String(item.content || item.title || '').trim()
  const media = Array.isArray(item.mediaList) ? item.mediaList : []
  let thumbUrl = ''
  for (let i = 0; i < media.length; i++) {
    const m = media[i]
    if (!m) continue
    if (m.type === 'image' && m.url) {
      thumbUrl = m.url
      break
    }
    if (m.type === 'video' && (m.thumbnailUrl || m.url)) {
      thumbUrl = m.thumbnailUrl || m.url
      break
    }
  }
  const ts = Number(item.publishedAt) || 0
  const d = ts ? new Date(ts) : null
  const pad = (n) => (n < 10 ? '0' : '') + n
  const publishedAtText = d
    ? pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    : ''
  return {
    _id: item._id,
    title: String(item.title || '').trim(),
    contentPreview: content.slice(0, 42),
    author: item.author || '',
    authorAvatar: item.authorAvatar || '',
    thumbUrl,
    keywordHitText: item.keywordHitText || '',
    publishedAtText
  }
}

function decorateEventItem(item, ctx) {
  if (!item) return item
  try {
    const c = ctx && typeof ctx === 'object' ? ctx : {}
    const keywords = Array.isArray(c.keywords) ? c.keywords : []
    const hits = matchKeywords(item, keywords)
    const related = matchRelatedLaunch(item, c.launches)
    const mediaKind = detectMediaKind(item)
    return Object.assign({}, item, {
      mediaKind,
      isNew: isItemNew(item, c.lastSeenAt),
      keywordHits: hits,
      keywordHitText: hits.join(' · ')
    }, flattenRelatedLaunch(related))
  } catch (e) {
    return item
  }
}

/** 只读 data-launch-id，避免和推文卡片 data-id 合并后跳进错误对象 */
function parseRelatedLaunchNavDataset(ds) {
  const raw = ds && typeof ds === 'object' ? ds : {}
  let id = ''
  if (raw.launchId != null && String(raw.launchId).trim() !== '') id = String(raw.launchId).trim()
  else if (raw.launchid != null && String(raw.launchid).trim() !== '') id = String(raw.launchid).trim()
  if (!id) return null
  const typeRaw = raw.launchType || raw.launchtype || raw.type
  return {
    id,
    type: typeRaw === 'completed' ? 'completed' : 'upcoming'
  }
}

/**
 * 任务卡组件 cardtap/favoritetap 走 e.detail.id；
 * 旧 data-launch-id 仍可用。不读 currentTarget.dataset.id（那是推文 _id）。
 */
function relatedLaunchNavFromEvent(e) {
  const d = (e && e.detail) || {}
  const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
  return parseRelatedLaunchNavDataset({
    launchId: d.launchId || ds.launchId || d.id,
    launchType: d.launchType || ds.launchType || d.type
  })
}

function findRelatedLaunchItem(lists, launchId) {
  const id = String(launchId || '')
  const arrs = Array.isArray(lists) ? lists : []
  for (let i = 0; i < arrs.length; i++) {
    const list = arrs[i]
    if (!Array.isArray(list)) continue
    for (let j = 0; j < list.length; j++) {
      if (list[j] && String(list[j].relatedLaunchId) === id) return list[j]
    }
  }
  return null
}

function toggleRelatedMissionFavorite(ds, lists) {
  const nav = parseRelatedLaunchNavDataset(ds)
  if (!nav) return null
  try {
    const item = findRelatedLaunchItem(lists, nav.id)
    const card = (item && item.relatedLaunchCard) || {}
    const { toggleMissionFavorite } = require('./favorites.js')
    const favorited = toggleMissionFavorite({
      id: nav.id,
      missionName: card.missionName || (item && item.relatedLaunchMission),
      name: card.name,
      rocketName: card.rocketName || (item && item.relatedLaunchRocket),
      rocketImage: card.rocketImage || (item && item.relatedLaunchRocketImage)
    }, nav.type)
    return { id: nav.id, favorited: !!favorited }
  } catch (e) {
    return null
  }
}

function applyRelatedLaunchFavoriteToList(list, launchId, favorited, animate) {
  const id = String(launchId || '')
  if (!id || !Array.isArray(list)) return list
  let changed = false
  const out = list.map((it) => {
    if (!it || String(it.relatedLaunchId) !== id) return it
    if (!!it.relatedLaunchFavorited === !!favorited && !!it.relatedLaunchFavAnimate === !!animate) return it
    changed = true
    return Object.assign({}, it, {
      relatedLaunchFavorited: !!favorited,
      relatedLaunchFavAnimate: !!animate
    })
  })
  return changed ? out : list
}

function clearRelatedLaunchFavAnimate(list, launchId) {
  const id = String(launchId || '')
  if (!id || !Array.isArray(list)) return list
  let changed = false
  const out = list.map((it) => {
    if (!it || String(it.relatedLaunchId) !== id || !it.relatedLaunchFavAnimate) return it
    changed = true
    return Object.assign({}, it, { relatedLaunchFavAnimate: false })
  })
  return changed ? out : list
}

function syncRelatedLaunchFavoriteFlags(list) {
  if (!Array.isArray(list) || !list.length) return list
  let isFav = null
  try {
    isFav = require('./favorites.js').isFavorite
  } catch (e) {
    return list
  }
  let changed = false
  const out = list.map((it) => {
    if (!it || !it.relatedLaunchId) return it
    const next = !!isFav('mission', it.relatedLaunchId)
    if (!!it.relatedLaunchFavorited === next && !it.relatedLaunchFavAnimate) return it
    changed = true
    return Object.assign({}, it, { relatedLaunchFavorited: next, relatedLaunchFavAnimate: false })
  })
  return changed ? out : list
}

function filterLaunchesInWindow(launches, now) {
  const t = Number(now) || Date.now()
  const floor = t - LAUNCH_LOOKBACK_MS
  const ceil = t + LAUNCH_HORIZON_MS
  const list = Array.isArray(launches) ? launches : []
  const out = []
  for (let i = 0; i < list.length && out.length < 40; i++) {
    const m = list[i]
    if (!m || m.id == null) continue
    const ts = m.launchTime ? new Date(m.launchTime).getTime() : 0
    if (!Number.isFinite(ts) || ts < floor || ts > ceil) continue
    out.push(m)
  }
  return out
}

function readLaunchPoolFromApp() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i]
      const route = p && p.route ? String(p.route).replace(/^\//, '') : ''
      if (route === 'pages/index/index' && p.data) {
        const up = p.data.upcomingMissions
        if (Array.isArray(up) && up.length) return up
        const cal = p.data.calendarAllMissions
        if (Array.isArray(cal) && cal.length) return cal
      }
    }
  } catch (e) {}
  try {
    const storageCache = require('./storage-sync-cache.js')
    const raw = storageCache.readMemOrSync('calendar_missions_cache', null)
    if (raw && Array.isArray(raw.all) && raw.all.length) return raw.all
  } catch (e2) {}
  return []
}

function collectUpcomingLaunchCandidates(opts) {
  const now = opts && opts.now != null ? opts.now : Date.now()
  const provided = opts && Array.isArray(opts.launches) ? opts.launches : null
  return filterLaunchesInWindow(provided || readLaunchPoolFromApp(), now)
}

function _storage() {
  try {
    return require('./storage-sync-cache.js')
  } catch (e) {
    return null
  }
}

function getFeedLastSeenAt() {
  const cache = _storage()
  if (!cache) return 0
  try {
    return Number(cache.readMemOrSync(FEED_SEEN_KEY, 0)) || 0
  } catch (e) {
    return 0
  }
}

function markEventFeedSeen(at) {
  const cache = _storage()
  if (!cache) return Number(at) || Date.now()
  const ts = Number(at) || Date.now()
  try {
    cache.persistAsync(FEED_SEEN_KEY, ts)
  } catch (e) {}
  return ts
}

function ensureFeedSeenSeed(latestPublishedAt) {
  const seen = getFeedLastSeenAt()
  if (seen > 0) return seen
  const seed = Math.max(Number(latestPublishedAt) || 0, Date.now())
  return markEventFeedSeen(seed)
}

function getEventIntelContext(opts) {
  const now = opts && opts.now != null ? opts.now : Date.now()
  let prefs = {}
  try {
    prefs = require('./user-growth.js').loadPreferences() || {}
  } catch (e) {}
  let canWatch = false
  try {
    canWatch = require('./membership.js').canUsePaidCloudSync()
  } catch (e2) {}
  return {
    now,
    lastSeenAt: getFeedLastSeenAt(),
    keywords: getEventAlertKeywords(prefs),
    watchSources: getEventWatchSources(prefs, canWatch),
    launches: collectUpcomingLaunchCandidates({ now })
  }
}

module.exports = {
  FEED_SEEN_KEY,
  DEFAULT_EVENT_ALERT_KEYWORDS,
  EVENT_WATCH_ACCOUNT_OPTIONS,
  getEventAlertKeywords,
  getEventWatchSources,
  matchKeywords,
  detectMediaKind,
  isItemNew,
  countNewItems,
  matchRelatedLaunch,
  pickTodayHighlights,
  slimHighlightItem,
  decorateEventItem,
  parseRelatedLaunchNavDataset,
  relatedLaunchNavFromEvent,
  toggleRelatedMissionFavorite,
  applyRelatedLaunchFavoriteToList,
  clearRelatedLaunchFavAnimate,
  syncRelatedLaunchFavoriteFlags,
  filterLaunchesInWindow,
  collectUpcomingLaunchCandidates,
  getFeedLastSeenAt,
  markEventFeedSeen,
  ensureFeedSeenSeed,
  getEventIntelContext
}
