/**
 * publicGateway — 公众内容站只读 HTTP 网关
 * 不鉴权、不写库、字段白名单；供 api.marsx.com.cn/public/v1 反代。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
}

const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const PREVIOUS_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}
const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']
const BOOSTER_META_DOC_IDS = {
  _sync_meta: 1,
  _img_cos_map: 1,
  _ll2_launchers_cache: 1,
  _config_meta: 1,
  _flight_history_progress: 1
}

function ok(data, extra = {}) {
  return { code: 0, data, ...extra }
}

function fail(code, message) {
  return { code, message: message || 'error' }
}

function sortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

function cacheKeyFor(path, params, suffix) {
  return `api_cache_${path}_${sortedParamsString(params)}${suffix || ''}`
}

function unwrapCacheData(apiData) {
  if (!apiData || typeof apiData !== 'object') return apiData
  if (apiData.data && typeof apiData.data === 'object' && Array.isArray(apiData.data.results)) {
    return apiData.data
  }
  return apiData
}

async function getCacheDoc(docId) {
  try {
    const res = await db.collection('space_devs_cache').doc(docId).get()
    return res && res.data ? res.data : null
  } catch (e) {
    return null
  }
}

async function readLaunchList(kind) {
  const path = kind === 'previous' ? '/launches/previous/' : '/launches/upcoming/'
  const params = kind === 'previous' ? PREVIOUS_PARAMS : UPCOMING_PARAMS
  for (const suffix of CANDIDATE_SUFFIXES) {
    const key = cacheKeyFor(path, params, suffix)
    const doc = await getCacheDoc(key)
    if (!doc) continue
    let apiData = unwrapCacheData(doc.data || doc)
    if (!apiData) continue

    if (apiData.isBatched && Array.isArray(apiData.batchKeys)) {
      const batches = await Promise.all(
        apiData.batchKeys.map(async (batchKey) => {
          const b = await getCacheDoc(batchKey)
          const payload = b && (b.data || b)
          return (payload && payload.results) || []
        })
      )
      const results = batches.reduce((all, chunk) => all.concat(chunk || []), [])
      return { results, count: results.length, cacheKey: key }
    }

    if (Array.isArray(apiData.results)) {
      return { results: apiData.results, count: apiData.results.length, cacheKey: key }
    }
  }
  return { results: [], count: 0, cacheKey: null }
}

function slimLaunch(launch) {
  if (!launch || typeof launch !== 'object') return null
  const rocket = launch.rocket || {}
  const configuration = rocket.configuration || (rocket.rocket && rocket.rocket.configuration) || {}
  const pad = launch.pad || {}
  const location = pad.location || {}
  const mission = launch.mission || {}
  const status = launch.status || {}
  const provider = launch.launch_service_provider || {}
  return {
    id: launch.id,
    name: launch.name || '',
    net: launch.net || '',
    window_start: launch.window_start || '',
    window_end: launch.window_end || '',
    status: {
      id: status.id,
      name: status.name || '',
      abbrev: status.abbrev || ''
    },
    rocket: {
      configuration: {
        id: configuration.id,
        name: configuration.name || '',
        full_name: configuration.full_name || '',
        family: configuration.family || '',
        variant: configuration.variant || '',
        length: configuration.length,
        diameter: configuration.diameter,
        launch_mass: configuration.launch_mass,
        to_thrust: configuration.to_thrust,
        leo_capacity: configuration.leo_capacity,
        gto_capacity: configuration.gto_capacity,
        reusable: configuration.reusable
      }
    },
    mission: {
      name: mission.name || '',
      type: mission.type || '',
      description: mission.description || ''
    },
    pad: {
      name: pad.name || '',
      latitude: pad.latitude,
      longitude: pad.longitude,
      location: {
        id: location.id,
        name: location.name || '',
        country_code: location.country_code || ''
      }
    },
    launch_service_provider: {
      id: provider.id,
      name: provider.name || '',
      abbrev: provider.abbrev || '',
      type: provider.type || ''
    },
    image: launch.image && typeof launch.image === 'object'
      ? {
          thumbnail_url: launch.image.thumbnail_url || '',
          image_url: launch.image.image_url || ''
        }
      : (typeof launch.image === 'string' ? { image_url: launch.image } : null),
    webcast_live: !!launch.webcast_live,
    probability: launch.probability
  }
}

async function handleLaunches(kind, query) {
  const list = await readLaunchList(kind)
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const offset = Math.max(0, Number(query.offset || 0))
  const provider = String(query.provider || '').trim().toLowerCase()
  let results = (list.results || []).map(slimLaunch).filter(Boolean)
  if (provider) {
    results = results.filter((l) => {
      const n = String((l.launch_service_provider && l.launch_service_provider.name) || '').toLowerCase()
      return n.indexOf(provider) !== -1
    })
  }
  const sliced = results.slice(offset, offset + limit)
  return ok({ results: sliced, count: results.length, offset, limit })
}

async function handleLaunchById(id) {
  if (!id) return fail(4001, 'missing id')
  const kinds = ['upcoming', 'previous']
  for (const kind of kinds) {
    const list = await readLaunchList(kind)
    const found = (list.results || []).find((l) => String(l.id) === String(id))
    if (found) return ok(slimLaunch(found))
  }
  // launch_data fallback
  try {
    const res = await db.collection('launch_data').where({ launchId: String(id) }).limit(1).get()
    const row = (res.data || [])[0]
    if (row) {
      return ok({
        id: row.launchId || id,
        name: row.name || row.missionName || '',
        net: row.net || row.launchTime || '',
        status: { name: row.statusName || row.status || '' },
        rocket: { configuration: { name: row.rocketName || '' } },
        mission: { name: row.missionName || '', description: row.description || '' },
        pad: { name: row.padName || '', location: { name: row.locationName || '' } },
        launch_service_provider: { name: row.providerName || '' }
      })
    }
  } catch (e) {}
  return fail(4040, 'launch not found')
}

async function handleSpaceXStats() {
  try {
    const res = await db
      .collection('spacex_launch_stats')
      .where({ isActive: true })
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get()
    const now = Date.now()
    const staleTTL = 72 * 60 * 60 * 1000
    const list = (res.data || []).filter((item) => {
      if (!item.isActive) return false
      if (item.syncedAt && now - item.syncedAt > staleTTL) return false
      return true
    })
    list.sort((a, b) => {
      const score = (item) => {
        let s = Number(item.priority || 0) * 1000
        if (item.totalLandings != null || item.totalReflights != null) s += 50
        if (Array.isArray(item.upcoming) && item.upcoming.length) s += 20
        if (item.source === 'spacex_official') s += 10
        return s
      }
      return score(b) - score(a)
    })
    const best = list[0] || null
    if (!best) return ok(null)

    // 若最高优先级文档缺着陆/复飞，用同批含完整字段的官网文档补齐
    const rich = list.find(
      (item) => item.totalLandings != null || item.totalReflights != null || (Array.isArray(item.upcoming) && item.upcoming.length)
    ) || best
    const merged = {
      ...rich,
      ...best,
      totalLaunches: best.totalLaunches != null ? best.totalLaunches : rich.totalLaunches,
      totalLandings: best.totalLandings != null ? best.totalLandings : rich.totalLandings,
      totalReflights: best.totalReflights != null ? best.totalReflights : rich.totalReflights,
      upcoming: (Array.isArray(best.upcoming) && best.upcoming.length) ? best.upcoming : (rich.upcoming || [])
    }

    const upcoming = Array.isArray(merged.upcoming) ? merged.upcoming : []
    const totalLandings = merged.totalLandings != null ? merged.totalLandings : merged.landings
    const totalReflights = merged.totalReflights != null ? merged.totalReflights : merged.reflights
    // 与小程序首页一致：官网同步字段为 totalLaunches / totalLandings / totalReflights / upcoming[]
    return ok({
      totalLaunches: merged.totalLaunches != null ? merged.totalLaunches : null,
      totalLandings: totalLandings != null ? totalLandings : null,
      totalReflights: totalReflights != null ? totalReflights : null,
      upcomingCount: upcoming.length,
      upcoming: upcoming.slice(0, 8).map((u) => ({
        title: u.title || u.name || '',
        vehicle: u.vehicle || u.rocket || '',
        launchSite: u.launchSite || u.pad || '',
        launchDate: u.launchDate || u.date || u.net || ''
      })),
      landings: totalLandings != null ? totalLandings : null,
      reflights: totalReflights != null ? totalReflights : null,
      upcomingLaunches: upcoming.length,
      source: merged.source || best.source || '',
      message: best.message || '',
      updatedAt: best.updatedAt || best.syncedAt || null,
      title: best.title || 'SpaceX 发射统计'
    })
  } catch (e) {
    return ok(null)
  }
}

async function handleBoosterGenealogy(query) {
  const limit = Math.min(200, Math.max(1, Number(query.limit || 100)))
  const offset = Math.max(0, Number(query.offset || 0))
  const BATCH = 100
  let all = []
  for (let i = 0; i < 10; i++) {
    const res = await db
      .collection('booster_genealogy')
      .orderBy('flights', 'desc')
      .skip(i * BATCH)
      .limit(BATCH)
      .get()
    const batch = res.data || []
    all = all.concat(batch)
    if (batch.length < BATCH) break
  }
  const list = all
    .filter((item) => item && !BOOSTER_META_DOC_IDS[item._id])
    .map((item) => {
      const serial = item.serialNumber || item.serial || item._id || item.id || ''
      return {
        id: item._id || item.id || serial,
        serial,
        name: item.name || item.serialNumber || item.serial || serial,
        flights: item.flights || 0,
        status: item.status || '',
        details: item.details || '',
        firstFlight: item.firstFlight || item.first_launch || '',
        lastFlight: item.lastFlight || item.last_launch || '',
        configId: item.configId || item.configurationId || null,
        countryCode: item.countryCode || '',
        rocketFamily: item.rocketFamily || '',
        manufacturer: item.manufacturer || '',
        successfulLandings: item.successfulLandings || 0,
        attemptedLandings: item.attemptedLandings || 0,
        image:
          item.cosImageUrl ||
          item.thumbnailUrl ||
          item.imageUrl ||
          (typeof item.image === 'string' ? item.image : '') ||
          '',
        launches: Array.isArray(item.launches) ? item.launches.slice(0, 20) : []
      }
    })

  let configMeta = null
  try {
    const metaRes = await db.collection('booster_genealogy').doc('_config_meta').get()
    const meta = metaRes.data || null
    if (meta && meta.configs) {
      configMeta = { configs: meta.configs, updatedAt: meta.updatedAt || null }
    }
  } catch (e) {}

  return ok({
    list: list.slice(offset, offset + limit),
    total: list.length,
    offset,
    limit,
    configMeta
  })
}

async function handleBoosterById(id) {
  if (!id) return fail(4001, 'missing id')
  try {
    const res = await db.collection('booster_genealogy').doc(String(id)).get()
    const item = res.data
    if (!item || BOOSTER_META_DOC_IDS[item._id]) return fail(4040, 'not found')
    return ok({
      id: item._id || item.id,
      serial: item.serial || item.name || '',
      name: item.name || item.serial || '',
      flights: item.flights || 0,
      status: item.status || '',
      details: item.details || '',
      firstFlight: item.firstFlight || item.first_launch || '',
      lastFlight: item.lastFlight || item.last_launch || '',
      configId: item.configId || null,
      countryCode: item.countryCode || '',
      image: typeof item.image === 'string' ? item.image : '',
      launches: Array.isArray(item.launches) ? item.launches : []
    })
  } catch (e) {
    return fail(4040, 'not found')
  }
}

async function readCacheResultsByNeedle(pathNeedle, maxDocs = 80) {
  try {
    const res = await db
      .collection('space_devs_cache')
      .where({
        _id: db.RegExp({ regexp: pathNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
      })
      .limit(maxDocs)
      .get()
    const rows = res.data || []
    // fallback: some envs can't regex _id; try prefix scan via known keys later
    const merged = []
    const seen = new Set()
    for (const row of rows) {
      const payload = unwrapCacheData(row.data || row)
      const results = (payload && payload.results) || []
      for (const item of results) {
        const key = item && item.id != null ? String(item.id) : ''
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        merged.push(item)
      }
    }
    return merged
  } catch (e) {
    return []
  }
}

async function handleAgencies(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const offset = Math.max(0, Number(query.offset || 0))
  // Prefer known cache keys pattern via agencies endpoint
  const paramsList = [
    { format: 'json', limit: 100, mode: 'list', offset: 0 },
    { format: 'json', limit: 50, offset: 0 }
  ]
  let results = []
  for (const params of paramsList) {
    for (const suffix of ['', '_slim_v6', '_slim_v5']) {
      const key = cacheKeyFor('/agencies/', params, suffix)
      const doc = await getCacheDoc(key)
      if (!doc) continue
      const apiData = unwrapCacheData(doc.data || doc)
      if (apiData && Array.isArray(apiData.results) && apiData.results.length) {
        results = apiData.results
        break
      }
    }
    if (results.length) break
  }
  if (!results.length) {
    results = await readCacheResultsByNeedle('/agencies/')
  }
  const slim = results.map((a) => ({
    id: a.id,
    name: a.name || '',
    abbrev: a.abbrev || '',
    type: a.type || '',
    country_code: a.country_code || '',
    description: a.description || '',
    logo_url: a.logo_url || (a.logo && (a.logo.image_url || a.logo.thumbnail_url)) || '',
    image_url: a.image_url || (a.image && (a.image.image_url || a.image.thumbnail_url)) || '',
    total_launch_count: a.total_launch_count,
    successful_launches: a.successful_launches,
    failed_launches: a.failed_launches,
    pending_launches: a.pending_launches
  }))
  return ok({ results: slim.slice(offset, offset + limit), count: slim.length, offset, limit })
}

async function callApiProxy(action, data = {}) {
  try {
    const res = await cloud.callFunction({
      name: 'apiProxy',
      data: { action, ...data }
    })
    return (res && res.result) || { success: false }
  } catch (e) {
    return { success: false, error: e.message || String(e) }
  }
}

async function handleSpacecraft(query) {
  const id = String(query.id || '').trim()
  if (id) {
    const r = await callApiProxy('ll2SpacecraftDetail', { spacecraftId: id })
    if (!r.success) return fail(4040, r.error || 'not found')
    const d = r.data || {}
    return ok({
      id: d.id,
      name: d.name || '',
      typeName: d.typeName || '',
      agencyName: d.agencyName || '',
      agencyAbbrev: d.agencyAbbrev || '',
      inUse: !!d.inUse,
      imageUrl: d.imageUrl || '',
      fullImageUrl: d.fullImageUrl || '',
      capability: d.capability || '',
      history: d.history || '',
      details: d.details || '',
      maidenFlight: d.maidenFlight || '',
      height: d.height,
      diameter: d.diameter,
      humanRated: !!d.humanRated,
      crewCapacity: d.crewCapacity,
      totalLaunchCount: d.totalLaunchCount,
      successfulLaunches: d.successfulLaunches,
      failedLaunches: d.failedLaunches
    })
  }
  const r = await callApiProxy('ll2SpacecraftList')
  if (!r.success) return ok({ results: [], count: 0 })
  const list = Array.isArray(r.data) ? r.data : []
  const limit = Math.min(200, Math.max(1, Number(query.limit || 100)))
  const offset = Math.max(0, Number(query.offset || 0))
  const slim = list.map((s) => ({
    id: s.id,
    name: s.name || '',
    typeName: s.typeName || '',
    agencyName: s.agencyName || '',
    agencyAbbrev: s.agencyAbbrev || '',
    inUse: !!s.inUse,
    imageUrl: s.imageUrl || ''
  }))
  return ok({ results: slim.slice(offset, offset + limit), count: slim.length, offset, limit })
}

async function handleLocations(query) {
  const r = await callApiProxy('ll2LocationList')
  if (!r.success) return ok({ results: [], count: 0 })
  const list = Array.isArray(r.data) ? r.data : []
  const limit = Math.min(200, Math.max(1, Number(query.limit || 100)))
  const offset = Math.max(0, Number(query.offset || 0))
  return ok({
    results: list.slice(offset, offset + limit),
    count: list.length,
    offset,
    limit
  })
}

async function handlePads(query) {
  const locationId = String(query.locationId || query.location_id || '').trim()
  const r = await callApiProxy('ll2PadList', { locationId })
  if (!r.success) return ok({ results: [], count: 0 })
  const list = Array.isArray(r.data) ? r.data : []
  return ok({ results: list, count: list.length })
}

function slimStarshipChecklist(list) {
  if (!Array.isArray(list)) return []
  return list.map((item, i) => ({
    id: (item && item.id) || `item_${i}`,
    title: (item && item.title) || '',
    location: (item && item.location) || '',
    date: (item && item.date) || '',
    description: (item && item.description) || '',
    status: (item && item.status) || 'normal',
    done: !!(item && (item.done || item.status === 'done' || item.status === 'completed')),
    // 清单项可选配图（COS）
    image: (item && (item.image || item.imageUrl || item.cover)) || ''
  })).filter((row) => row.title)
}

function collectStarshipImages(node) {
  const n = node && typeof node === 'object' ? node : {}
  const list = []
  if (n.image) list.push(n.image)
  if (Array.isArray(n.images)) list.push(...n.images)
  if (Array.isArray(n.previewImages)) list.push(...n.previewImages)
  const d = n.detail && typeof n.detail === 'object' ? n.detail : {}
  if (d.heroImage) list.push(d.heroImage)
  return [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))]
}

function slimStarshipNode(node, type) {
  const n = node && typeof node === 'object' ? node : {}
  const d = n.detail && typeof n.detail === 'object' ? n.detail : {}
  const id = n.id || ''
  const checklist = slimStarshipChecklist(d.checklist)
  let progress = typeof n.progress === 'number' ? n.progress : 0
  // 后台 progress 常为 0：用清单完成度推导展示进度，避免页面看起来「没数据」
  if ((!progress || progress <= 0) && checklist.length > 0) {
    const doneCount = checklist.filter((c) => c.done || c.status === 'normal').length
    progress = Math.round((doneCount / checklist.length) * 100)
  }
  const images = collectStarshipImages(n)
  const fallbackTitle = (type === 'ship' ? '星舰' : '助推器') + String(id || '').toUpperCase()
  return {
    id,
    status: n.status || '',
    progress,
    // 星舰运营图在 COS：明确透传，供公众站直接展示
    image: n.image || images[0] || '',
    images,
    detail: {
      title: d.title || fallbackTitle,
      subtitle: d.subtitle || (type === 'ship' ? 'STARSHIP' : 'SUPER HEAVY'),
      statusText: d.statusText || '',
      summary: d.summary || '',
      heroImage: d.heroImage || '',
      showChecklist: d.showChecklist !== false,
      checklist
    }
  }
}

async function handleStarshipStatus() {
  try {
    const res = await db.collection('starshipStatus').doc('current').get()
    const data = res.data || {}
    return ok({
      booster: slimStarshipNode(data.booster, 'booster'),
      ship: slimStarshipNode(data.ship, 'ship'),
      flightReadinessChecklist: Array.isArray(data.flightReadinessChecklist)
        ? data.flightReadinessChecklist.map((item, i) => ({
            id: item.id || `fr_${i}`,
            title: item.title || '',
            done: !!item.done,
            category: item.category || ''
          })).filter((x) => x.title)
        : [],
      ll2TrackedLaunchId: data.ll2TrackedLaunchId || '',
      showLaunchLibraryUpdates: data.showLaunchLibraryUpdates !== false,
      updatedAt: data.updatedAt || null
    })
  } catch (e) {
    return ok({
      booster: slimStarshipNode({}, 'booster'),
      ship: slimStarshipNode({}, 'ship'),
      flightReadinessChecklist: [],
      ll2TrackedLaunchId: '',
      showLaunchLibraryUpdates: true
    })
  }
}

function slimEvent(row) {
  if (!row) return null
  const mediaList = Array.isArray(row.mediaList)
    ? row.mediaList.map((m) => ({
        type: m.type || 'image',
        url: m.url || '',
        previewUrl: m.previewUrl || '',
        thumbnailUrl: m.thumbnailUrl || '',
        sourceUrl: m.sourceUrl || '',
        videoUrl: m.videoUrl || '',
        isLongVideo: !!m.isLongVideo
      }))
    : []
  return {
    id: row._id,
    title: row.title || '',
    content: row.content || '',
    originalText: row.originalText || '',
    translated: !!row.translated,
    mediaList,
    author: row.author || '',
    authorAvatar: row.authorAvatar || '',
    source: row.source || '',
    tweetId: row.tweetId || '',
    tweetUrl: row.tweetUrl || '',
    publishedAt: row.publishedAt || row.createdAt || 0,
    liveRoomId: row.liveRoomId || ''
  }
}

async function handleStarshipEvents(query) {
  const page = Math.max(1, Number(query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)))
  const id = String(query.id || '').trim()
  if (id) {
    try {
      const res = await db.collection('starship_event_updates').doc(id).get()
      const row = res.data
      if (!row || row.status !== 'published') return fail(4040, 'not found')
      return ok(slimEvent(row))
    } catch (e) {
      return fail(4040, 'not found')
    }
  }
  const where = { status: 'published' }
  const source = String(query.source || '').trim()
  if (source) where.source = source
  const dbQuery = db.collection('starship_event_updates').where(where)
  const [countRes, listRes] = await Promise.all([
    dbQuery.count(),
    dbQuery
      .orderBy('publishedAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
  ])
  const list = (listRes.data || []).map(slimEvent).filter(Boolean)
  return ok({ list, total: countRes.total || 0, page, pageSize })
}

async function handleMediaMap() {
  const MAX_ROWS = 500
  const PAGE = 100
  const map = {}
  let skip = 0
  let fetched = 0
  while (fetched < MAX_ROWS) {
    const limit = Math.min(PAGE, MAX_ROWS - fetched)
    const res = await db
      .collection('media_assets')
      .where({ enabled: true })
      .field({ key: true, url: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(limit)
      .get()
    const rows = res.data || []
    rows.forEach((item) => {
      const key = item && item.key != null ? String(item.key).trim() : ''
      const url = item && typeof item.url === 'string' ? item.url.trim() : ''
      // 仅下发火箭配置图相关 key，避免其它 COS 素材被公众站滥用
      if (key && url && (key.indexOf('火箭配置图/') === 0 || key.indexOf('火箭配置图') === 0)) {
        map[key] = url
      }
    })
    fetched += rows.length
    skip += rows.length
    if (rows.length < limit) break
  }
  return ok({ map, count: Object.keys(map).length, version: Date.now() })
}

function isLl2ApiUrl(url) {
  return /(?:^https?:\/\/)?(?:ll|lldev)\.thespacedevs\.com\b/i.test(String(url || ''))
}

/** 与小程序 formatEventItem 一致：优先 info_urls，其次 vid_urls；绝不回退到 LL2 API 的 url */
function pickEventOpenUrl(event) {
  const infos = Array.isArray(event && event.info_urls) ? event.info_urls : []
  for (const item of infos) {
    const u = item && item.url
    if (u && !isLl2ApiUrl(u)) return String(u)
  }
  const vids = Array.isArray(event && event.vid_urls) ? event.vid_urls : []
  for (const item of vids) {
    const u = item && item.url
    if (u && !isLl2ApiUrl(u)) return String(u)
  }
  const explicit = (event && (event.news_url || event.mainInfoUrl || event.videoUrl)) || ''
  if (explicit && !isLl2ApiUrl(explicit)) return String(explicit)
  return ''
}

function eventLocationText(event) {
  const loc = event && event.location
  if (typeof loc === 'string') return loc
  if (loc && typeof loc === 'object') return loc.name || loc.nameZh || ''
  return ''
}

function eventImageUrl(event) {
  if (!event || typeof event !== 'object') return ''
  if (typeof event.feature_image === 'string' && event.feature_image) return event.feature_image
  if (typeof event.image_url === 'string' && event.image_url) return event.image_url
  const img = event.image
  if (typeof img === 'string' && img) return img
  if (img && typeof img === 'object') {
    return img.thumbnail_url || img.image_url || img.url || ''
  }
  return ''
}

async function handleNewsEvents(query) {
  const limit = Math.min(50, Math.max(1, Number(query.limit || 30)))
  const offset = Math.max(0, Number(query.offset || 0))
  // 与小程序 / syncSpaceDevsData 一致：优先 { limit: 100, offset: 0 }
  const candidateParams = [
    { limit: 100, offset: 0 },
    { format: 'json', limit: 100, offset: 0 },
    { format: 'json', limit: 50, mode: 'list', offset: 0, ordering: 'date' }
  ]
  let results = []
  for (const params of candidateParams) {
    for (const suffix of ['', '_slim_v6', '_slim_v5']) {
      const key = cacheKeyFor('/events/upcoming/', params, suffix)
      const doc = await getCacheDoc(key)
      if (!doc) continue
      const apiData = unwrapCacheData(doc.data || doc)
      if (apiData && Array.isArray(apiData.results) && apiData.results.length) {
        results = apiData.results
        break
      }
    }
    if (results.length) break
  }
  if (!results.length) results = await readCacheResultsByNeedle('/events/upcoming/')
  const slim = results.map((e) => {
    const openUrl = pickEventOpenUrl(e)
    const image = eventImageUrl(e)
    return {
      id: e.id,
      name: e.name || e.title || '',
      description: e.description || '',
      type: (e.type && e.type.name) || e.type || '',
      date: e.date || e.net || '',
      location: eventLocationText(e),
      // 外链图：前端经 api.marsx.com.cn/image 代理，不走 COS
      image,
      feature_image: image,
      image_url: image,
      news_url: openUrl,
      open_url: openUrl,
      video_url: (() => {
        const vids = Array.isArray(e.vid_urls) ? e.vid_urls : []
        const u = vids[0] && vids[0].url
        return u && !isLl2ApiUrl(u) ? String(u) : ''
      })()
    }
  })
  return ok({ results: slim.slice(offset, offset + limit), count: slim.length, offset, limit })
}

async function handleNewsArticles(query) {
  const limit = Math.min(50, Math.max(1, Number(query.limit || 30)))
  const offset = Math.max(0, Number(query.offset || 0))
  let results = []
  for (const path of ['/articles/', '/article/']) {
    results = await readCacheResultsByNeedle(path)
    if (results.length) break
  }
  const slim = results.map((a) => ({
    id: a.id,
    title: a.title || '',
    summary: a.summary || a.news_site || '',
    url: a.url || '',
    image_url: a.image_url || '',
    news_site: a.news_site || '',
    published_at: a.published_at || ''
  }))
  return ok({ results: slim.slice(offset, offset + limit), count: slim.length, offset, limit })
}

async function handleNewsManual() {
  try {
    const cfg = await db.collection('global_config').doc('main').get().catch(() => null)
    const enabled = !!(cfg && cfg.data && cfg.data.newsManualEnabled)
    if (!enabled) return ok({ enabled: false, items: [] })
    const res = await db
      .collection('news_articles')
      .where({ published: true })
      .orderBy('updatedAt', 'desc')
      .limit(30)
      .get()
    const items = (res.data || []).map((doc) => ({
      id: doc._id,
      title: doc.title || '',
      summary: doc.summary || '',
      content: doc.content || '',
      cover: doc.cover || '',
      updatedAt: doc.updatedAt || doc.createdAt || 0,
      source: 'manual'
    }))
    return ok({ enabled: true, items })
  } catch (e) {
    return ok({ enabled: false, items: [] })
  }
}

async function handleRoadClosure() {
  try {
    const now = Date.now()
    const STALE_TTL = 24 * 60 * 60 * 1000
    // 与小程序 api-road-closure 一致：优先 isActive 文档
    let rows = []
    try {
      const activeRes = await db
        .collection('road_closure_notice')
        .where({ isActive: true })
        .limit(20)
        .get()
      rows = activeRes.data || []
    } catch (e) {
      rows = []
    }
    if (!rows.length) {
      const allRes = await db
        .collection('road_closure_notice')
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get()
      rows = allRes.data || []
    }

    const list = []
    for (const row of rows) {
      const endAt = row.endAt || row.endTime || 0
      if (endAt > 0 && endAt < now) continue
      if ((!endAt || endAt === 0) && row.syncedAt && now - row.syncedAt > STALE_TTL) continue

      const message = row.message || row.statusText || row.title || row.content || ''
      const timeRange = row.timeRange || ''
      // 跳过空文档（如仅元数据的 starbase_gov_live / current 空壳）
      const hasSchedule =
        (Array.isArray(row.beachClosureSchedule) && row.beachClosureSchedule.length > 0) ||
        (Array.isArray(row.roadDelays) && row.roadDelays.length > 0) ||
        (Array.isArray(row.roadUpdates) && row.roadUpdates.length > 0)
      if (!message && !timeRange && !hasSchedule && !row.beachStatus) continue

      const priority = (row.source === 'manual' ? 999 : 0) + (row.priority || 0)
      list.push({
        id: row._id,
        isActive: row.isActive !== false,
        title: row.title || (row.source === 'manual' ? '手动封路通知' : '封路通知'),
        message,
        content: message,
        timeRange,
        status: row.beachStatus || row.status || (row.isActive ? 'active' : ''),
        source: row.source || '',
        beachStatus: row.beachStatus || '',
        beachOpen: row.beachOpen == null ? null : !!row.beachOpen,
        roadOpen: row.roadOpen == null ? null : !!row.roadOpen,
        roadStatusLabel: row.roadStatusLabel || '',
        beachClosureSchedule: Array.isArray(row.beachClosureSchedule) ? row.beachClosureSchedule : [],
        roadDelays: Array.isArray(row.roadDelays) ? row.roadDelays : [],
        roadUpdates: Array.isArray(row.roadUpdates) ? row.roadUpdates : [],
        startAt: row.startAt || row.startTime || null,
        endAt: endAt || null,
        updatedAt: row.updatedAt || row.syncedAt || null,
        _priority: priority
      })
    }

    list.sort((a, b) => (b._priority || 0) - (a._priority || 0))
    const cleaned = list.map(({ _priority, ...rest }) => rest)
    return ok({ list: cleaned, notice: cleaned[0] || null })
  } catch (e) {
    return ok({ list: [], notice: null })
  }
}

function extractBiliRoomId(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d{3,})/i)
  if (m) return m[1]
  if (/^\d{3,}$/.test(s)) return s
  return ''
}

function defaultBiliEmbedUrl(roomId) {
  // 官方文档参数：mute（不是 muted）；勿传 autoplay，避免活动播放器 92002
  return `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=${roomId}&mute=1&danmaku=0&logo=0&recommend=0`
}

function normalizePublicBiliRooms(data) {
  const DEFAULT_ROOM = '390508'
  const list = Array.isArray(data.publicBiliRooms) ? data.publicBiliRooms : []
  const rooms = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    let roomId =
      extractBiliRoomId(item.roomId || item.room_id) ||
      extractBiliRoomId(item.link) ||
      ''
    if (!roomId) continue
    const linkRaw = String(item.link || '').trim()
    const link = linkRaw || `https://live.bilibili.com/${roomId}`
    const fromLink = extractBiliRoomId(link)
    if (fromLink) roomId = fromLink
    const embedRaw = String(item.embedUrl || item.embed_url || '').trim()
    const embedUrl = embedRaw && embedRaw.includes(`cid=${roomId}`)
      ? embedRaw
      : defaultBiliEmbedUrl(roomId)
    rooms.push({
      roomId,
      title: String(item.title || '').trim(),
      link,
      embedUrl
    })
  }
  if (!rooms.length) {
    let roomId =
      extractBiliRoomId(data.publicBiliRoomId) ||
      extractBiliRoomId(data.roomId) ||
      DEFAULT_ROOM
    const linkRaw = String(data.publicBiliLink || '').trim()
    const link = linkRaw || `https://live.bilibili.com/${roomId}`
    const fromLink = extractBiliRoomId(link)
    if (fromLink) roomId = fromLink
    const embedRaw = String(data.publicBiliEmbedUrl || '').trim()
    rooms.push({
      roomId,
      title: String(data.publicBiliTitle || data.title || '').trim(),
      link,
      embedUrl: embedRaw || defaultBiliEmbedUrl(roomId)
    })
  }
  return rooms
}

/** 公众网页 B 站直播配置（后台 live_config 控制） */
async function handleBilibiliLive() {
  const DEFAULT_ROOM = '390508'
  try {
    const res = await db.collection('live_config').doc('current').get().catch(() => null)
    const data = (res && res.data) || {}
    const enabled = data.publicBiliEnabled !== false
    const rooms = normalizePublicBiliRooms(data)
    const first = rooms[0] || {
      roomId: DEFAULT_ROOM,
      title: '',
      link: `https://live.bilibili.com/${DEFAULT_ROOM}`,
      embedUrl: defaultBiliEmbedUrl(DEFAULT_ROOM)
    }
    return ok({
      enabled,
      rooms,
      // 兼容旧前端：保留单房间字段
      roomId: first.roomId,
      link: first.link,
      embedUrl: first.embedUrl,
      title: first.title,
      updatedAt: data.updatedAt || null
    })
  } catch (e) {
    const embedUrl = defaultBiliEmbedUrl(DEFAULT_ROOM)
    const room = {
      roomId: DEFAULT_ROOM,
      title: '',
      link: `https://live.bilibili.com/${DEFAULT_ROOM}`,
      embedUrl
    }
    return ok({
      enabled: true,
      rooms: [room],
      roomId: room.roomId,
      link: room.link,
      embedUrl: room.embedUrl,
      title: '',
      updatedAt: null
    })
  }
}

function parsePath(rawPath) {
  let path = String(rawPath || '/').trim() || '/'
  // strip /public or /public/v1 prefixes if present
  path = path.replace(/^\/public\/v1/, '').replace(/^\/public/, '')
  if (!path.startsWith('/')) path = '/' + path
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

async function route(path, method, query) {
  if (method !== 'GET' && method !== 'POST') return fail(4050, 'method not allowed')
  if (path === '/ping' || path === '/') return ok({ pong: true, ts: Date.now() })

  if (path === '/launches/upcoming') return handleLaunches('upcoming', query)
  if (path === '/launches/previous') return handleLaunches('previous', query)
  if (path.startsWith('/launches/')) {
    const id = decodeURIComponent(path.slice('/launches/'.length))
    return handleLaunchById(id)
  }

  if (path === '/spacex-stats') return handleSpaceXStats()
  if (path === '/booster-genealogy') return handleBoosterGenealogy(query)
  if (path.startsWith('/booster-genealogy/')) {
    return handleBoosterById(decodeURIComponent(path.slice('/booster-genealogy/'.length)))
  }

  if (path === '/agencies') return handleAgencies(query)
  if (path === '/spacecraft') return handleSpacecraft(query)
  if (path === '/locations') return handleLocations(query)
  if (path === '/pads') return handlePads(query)

  if (path === '/starship/status') return handleStarshipStatus()
  if (path === '/starship/events') return handleStarshipEvents(query)

  if (path === '/media/map') return handleMediaMap()
  if (path === '/news/events') return handleNewsEvents(query)
  if (path === '/news/articles') return handleNewsArticles(query)
  if (path === '/news/manual') return handleNewsManual()
  if (path === '/road-closure') return handleRoadClosure()
  if (path === '/bilibili-live') return handleBilibiliLive()

  return fail(4040, `unknown route: ${method} ${path}`)
}

function normalizeEvent(event = {}) {
  let bodyData = event.body
  if (typeof bodyData === 'string') {
    try {
      bodyData = JSON.parse(bodyData)
    } catch (e) {
      bodyData = {}
    }
  }
  const merged = {
    ...event,
    ...(bodyData && typeof bodyData === 'object' ? bodyData : {})
  }
  if (!merged.method && event.httpMethod) merged.method = event.httpMethod
  if (!merged.path && event.path) merged.path = event.path
  if (!merged.query && event.queryStringParameters) merged.query = event.queryStringParameters
  return merged
}

function httpResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify(payload)
  }
}

exports.main = async (event = {}, context) => {
  try {
    // CloudBase HTTP OPTIONS preflight
    const httpMethod = (event.httpMethod || event.method || 'GET').toUpperCase()
    if (httpMethod === 'OPTIONS') {
      return httpResponse({ ok: true }, 204)
    }

    const normalized = normalizeEvent(event)
    const method = String(normalized.method || httpMethod || 'GET').toUpperCase()
    const path = parsePath(normalized.path || '/')
    const query = normalized.query || normalized.queryStringParameters || {}

    const result = await route(path, method, query)
    const status = result && result.code && result.code !== 0 ? (result.code === 4040 ? 404 : 400) : 200

    // HTTP trigger expects statusCode/body; callFunction clients get raw object — support both
    if (event.httpMethod || event.requestContext || event.headers) {
      return httpResponse(result, status)
    }
    return result
  } catch (error) {
    console.error('[publicGateway]', error && (error.stack || error.message || error))
    const payload = fail(5000, error.message || 'server error')
    if (event.httpMethod || event.requestContext || event.headers) {
      return httpResponse(payload, 500)
    }
    return payload
  }
}
