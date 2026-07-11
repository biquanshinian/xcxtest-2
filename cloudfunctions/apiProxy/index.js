/**
 * apiProxy — 通用 API 代理云函数
 * 合并原 getLiveStatus + getTelemetry
 *
 * event.action:
 *   'liveStatus'  — B站直播间状态查询（原 getLiveStatus）
 *   'getOpenid'   — 获取调用者 openid
 *   'list'        — 遥测发射列表（原 getTelemetry action=list）
 *   'telemetry'   — 单次发射遥测数据（原 getTelemetry action=telemetry）
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const http = require('http')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 复用连接，降低重复 TLS/TCP 握手开销
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 })
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 })

// ── 共享缓存工具 ──
async function getCache(collection, docId, ttlMs) {
  try {
    const res = await db.collection(collection).doc(docId).get()
    const doc = res.data
    if (doc && (Date.now() - doc.updatedAt) < ttlMs) {
      return doc.result || doc.data
    }
  } catch (_) {}
  return null
}

async function setCache(collection, docId, payload, field) {
  if (field === undefined) field = 'result'
  const record = { updatedAt: Date.now() }
  record[field] = payload
  try {
    await db.collection(collection).doc(docId).set({ data: { _id: docId, ...record } })
  } catch (_) {}
}

// ── LL2 图片 COS 镜像映射表 ──
// syncSpaceDevsData 的 syncImageMirror 定时任务把 LL2 外网图（DigitalOcean Spaces，
// 国内直连极差）镜像到自有 COS，映射写在 space_devs_cache 的 _image_mirror_map 文档。
// 这里在 TTL 到期重拉 LL2 后查表替换，防止缓存刷新把 URL 回退成外网；
// 未镜像的保持原样（客户端走 Worker 代理兜底，等下轮定时任务补录）。
const crypto = require('crypto')
let _mirrorMapCache = { map: null, ts: 0 }
const MIRROR_MAP_CACHE_MS = 5 * 60 * 1000

async function getMirrorMap() {
  const now = Date.now()
  if (_mirrorMapCache.map && (now - _mirrorMapCache.ts) < MIRROR_MAP_CACHE_MS) {
    return _mirrorMapCache.map
  }
  let map = {}
  try {
    const res = await db.collection('space_devs_cache').doc('_image_mirror_map').get()
    map = (res.data && res.data.map) || {}
  } catch (_) {}
  _mirrorMapCache = { map, ts: now }
  return map
}

/** 已镜像返回 COS URL，否则原样返回 */
function applyMirror(url, map) {
  if (!url || !map) return url
  const key = crypto.createHash('md5').update(String(url).trim()).digest('hex')
  const entry = map[key]
  return entry && entry.cosUrl ? entry.cosUrl : url
}

// ── HTTPS JSON 请求 ──
function fetchJSON(url, headers, timeout) {
  if (headers === undefined) headers = {}
  if (timeout === undefined) timeout = 8000
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, agent: httpsAgent }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('JSON parse error')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ── HTTP JSON 请求（遥测 API 使用 HTTP） ──
function httpGet(url, timeout) {
  if (timeout === undefined) timeout = 15000
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout, agent: httpAgent }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error('JSON parse error')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// ══════════════════════════════════════════════
//  B站直播间状态（原 getLiveStatus）
// ══════════════════════════════════════════════
const LIVE_CACHE_COLLECTION = 'live_status_cache'
const LIVE_CACHE_TTL = 60 * 1000

function extractRoomId(raw) {
  if (!raw) return ''
  const m = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
  return m ? m[1] : String(raw).replace(/\D/g, '')
}

async function handleLiveStatus(event) {
  const roomId = extractRoomId(event.roomId)
  if (!roomId) return { code: 400, message: '缺少 roomId 参数' }

  const cached = await getCache(LIVE_CACHE_COLLECTION, 'live_' + roomId, LIVE_CACHE_TTL)
  if (cached) return cached

  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    const data = await fetchJSON(
      'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=' + roomId,
      { 'User-Agent': ua }
    )
    const info = (data && data.data) || {}
    const result = {
      code: 0,
      roomId,
      liveStatus: info.live_status || 0,
      title: info.title || '',
      cover: info.user_cover || info.keyframe || ''
    }
    await setCache(LIVE_CACHE_COLLECTION, 'live_' + roomId, result, 'result')
    return result
  } catch (e) {
    return { code: 500, message: e.message || '查询失败' }
  }
}

async function handleLiveStatusBatch(event) {
  const raw = Array.isArray(event.roomIds) ? event.roomIds : []
  const roomIds = [...new Set(raw.map(extractRoomId).filter(Boolean))]
  if (!roomIds.length) return { code: 400, message: '缺少 roomIds 参数' }

  const results = {}
  await Promise.all(roomIds.map(async (id) => {
    results[id] = await handleLiveStatus({ roomId: id })
  }))
  return { code: 0, results }
}

// ══════════════════════════════════════════════
//  遥测数据（原 getTelemetry）
// ══════════════════════════════════════════════
const TELEMETRY_API = 'http://api.launchdashboard.space/v2'
const TELEMETRY_CACHE_COLLECTION = 'telemetry_cache'
const TELEMETRY_CACHE_TTL = 24 * 60 * 60 * 1000

async function getTelemetryCache(cacheKey) {
  try {
    const res = await db.collection(TELEMETRY_CACHE_COLLECTION).where({ _id: cacheKey }).limit(1).get()
    if (res.data && res.data.length > 0) {
      const cached = res.data[0]
      if (Date.now() - cached.updatedAt < TELEMETRY_CACHE_TTL) return cached.data
    }
  } catch (_) {}
  return null
}

async function setTelemetryCache(cacheKey, data) {
  try {
    const existing = await db.collection(TELEMETRY_CACHE_COLLECTION).where({ _id: cacheKey }).limit(1).get()
    const record = { data, updatedAt: Date.now() }
    if (existing.data && existing.data.length > 0) {
      await db.collection(TELEMETRY_CACHE_COLLECTION).doc(cacheKey).update({ data: record })
    } else {
      await db.collection(TELEMETRY_CACHE_COLLECTION).add({ data: { _id: cacheKey, ...record } })
    }
  } catch (e) {
    console.warn('[apiProxy:telemetry] cache write failed:', e.message)
  }
}

async function handleTelemetryList() {
  const cacheKey = 'telemetry_list_spacex'
  const cached = await getTelemetryCache(cacheKey)
  if (cached) return { success: true, data: cached, fromCache: true }
  try {
    const data = await httpGet(TELEMETRY_API + '/launches/info/spacex')
    if (data) {
      await setTelemetryCache(cacheKey, data)
      return { success: true, data }
    }
    return { success: false, error: '遥测列表为空' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function handleTelemetry(event) {
  const { missionId, flightNumber, launchLibrary2Id, interval } = event
  let url = ''
  let cacheKey = ''

  if (launchLibrary2Id) {
    url = TELEMETRY_API + '/launches?launch_library_2_id=' + encodeURIComponent(launchLibrary2Id)
    cacheKey = 'telemetry_ll2_' + launchLibrary2Id
  } else if (missionId) {
    url = TELEMETRY_API + '/launches/spacex?mission_id=' + encodeURIComponent(missionId)
    cacheKey = 'telemetry_mid_' + missionId
  } else if (flightNumber) {
    url = TELEMETRY_API + '/launches/spacex?flight_number=' + encodeURIComponent(flightNumber)
    cacheKey = 'telemetry_fn_' + flightNumber
  } else {
    return { success: false, error: '缺少查询参数' }
  }

  if (interval) url += '&interval=' + interval

  const cached = await getTelemetryCache(cacheKey)
  if (cached) return { success: true, data: cached, fromCache: true }

  try {
    const data = await httpGet(url)
    if (data && (data.raw || data.analysed || data.events)) {
      await setTelemetryCache(cacheKey, data)
      return { success: true, data }
    }
    return { success: false, error: '该发射暂无遥测数据' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

let _apiProxyCollectionsEnsured = false
function ensureApiProxyCollectionsOnce() {
  if (_apiProxyCollectionsEnsured) return
  _apiProxyCollectionsEnsured = true
  // 后台并行执行，不阻塞用户请求
  Promise.all(
    ['live_status_cache', 'telemetry_cache'].map((n) => db.createCollection(n).catch(() => {}))
  ).catch(() => {})
}

// ══════════════════════════════════════════════
//  LL2 事件详情（detailed 模式，含关联发射/机构/空间站/项目/更新日志）
// ══════════════════════════════════════════════
const LL2_EVENT_CACHE_TTL = 30 * 60 * 1000

async function handleLl2EventDetail(event) {
  const eventId = event && event.eventId ? String(event.eventId).trim() : ''
  if (!eventId) return { success: false, error: 'missing eventId' }

  const cacheKey = `ll2_event_detail_${eventId}`
  const cached = await getCache('space_devs_cache', cacheKey, LL2_EVENT_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const url = `https://ll.thespacedevs.com/2.3.0/events/${eventId}/?mode=detailed&format=json`
    const resp = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
    if (!resp || !resp.id) return { success: false, error: 'LL2 returned empty' }

    const result = {
      id: resp.id,
      name: resp.name || '',
      slug: resp.slug || '',
      type: resp.type && resp.type.name ? resp.type.name : '',
      date: resp.date || '',
      dateMs: resp.date ? Date.parse(resp.date) : 0,
      location: resp.location || '',
      description: resp.description || '',
      datePrecision: resp.date_precision && resp.date_precision.name ? resp.date_precision.name : '',
      imageUrl: resp.image && (resp.image.image_url || resp.image.thumbnail_url) || '',
      imageCredit: resp.image && resp.image.credit || '',
      webcastLive: !!resp.webcast_live,
      lastUpdated: resp.last_updated || '',
      vidUrls: (resp.vid_urls || []).map(v => ({
        url: v.url || '',
        title: v.title || '',
        publisher: v.publisher || '',
        startTime: v.start_time || '',
        endTime: v.end_time || ''
      })),
      agencies: (resp.agencies || []).map(a => ({
        id: a.id,
        name: a.name || '',
        abbrev: a.abbrev || '',
        type: a.type && a.type.name ? a.type.name : ''
      })),
      launches: (resp.launches || []).map(l => ({
        id: l.id,
        name: l.name || '',
        slug: l.slug || '',
        status: l.status && l.status.name ? l.status.name : '',
        statusAbbrev: l.status && l.status.abbrev ? l.status.abbrev : '',
        net: l.net || '',
        imageUrl: l.image && (l.image.image_url || l.image.thumbnail_url) || ''
      })),
      spacestations: (resp.spacestations || []).map(s => ({
        id: s.id,
        name: s.name || '',
        status: s.status && s.status.name ? s.status.name : '',
        imageUrl: s.image && (s.image.image_url || s.image.thumbnail_url) || '',
        orbit: s.orbit || ''
      })),
      programs: (resp.program || []).map(p => ({
        id: p.id,
        name: p.name || '',
        description: p.description || '',
        imageUrl: p.image && (p.image.image_url || p.image.thumbnail_url) || '',
        type: p.type && p.type.name ? p.type.name : ''
      })),
      updates: (resp.updates || []).map(u => ({
        id: u.id,
        comment: u.comment || '',
        createdBy: u.created_by || '',
        createdOn: u.created_on || '',
        infoUrl: u.info_url || ''
      }))
    }

    await setCache('space_devs_cache', cacheKey, result)
    return { success: true, data: result, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ══════════════════════════════════════════════
//  LL2 飞船构型详情（detailed 模式，含规格/历史/战绩）
// ══════════════════════════════════════════════
const LL2_SPACECRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

async function handleLl2SpacecraftDetail(event) {
  const scId = event && event.spacecraftId ? String(event.spacecraftId).trim() : ''
  if (!scId) return { success: false, error: 'missing spacecraftId' }

  // v2: 缩略图优先 + fullImageUrl 字段；升版本使旧缓存失效
  const cacheKey = `ll2_spacecraft_detail_v2_${scId}`
  const cached = await getCache('space_devs_cache', cacheKey, LL2_SPACECRAFT_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const url = `https://ll.thespacedevs.com/2.3.0/spacecraft_configurations/${scId}/?mode=detailed&format=json`
    const resp = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
    if (!resp || !resp.id) return { success: false, error: 'LL2 returned empty' }

    const agency = resp.agency || {}
    const family = Array.isArray(resp.family) && resp.family[0] ? resp.family[0] : null
    const mirrorMap = await getMirrorMap()
    const result = {
      id: resp.id,
      name: resp.name || '',
      typeName: resp.type && resp.type.name ? resp.type.name : '',
      agencyId: agency.id || null,
      agencyName: agency.name || '',
      agencyAbbrev: agency.abbrev || '',
      familyName: family && family.name ? family.name : '',
      inUse: !!resp.in_use,
      // 缩略图优先：LL2 原图托管在海外对象存储，国内直连大图经常加载失败；已镜像的替换为 COS
      imageUrl: applyMirror(resp.image && (resp.image.thumbnail_url || resp.image.image_url) || '', mirrorMap),
      fullImageUrl: applyMirror(resp.image && (resp.image.image_url || resp.image.thumbnail_url) || '', mirrorMap),
      capability: resp.capability || '',
      history: resp.history || '',
      details: resp.details || '',
      maidenFlight: resp.maiden_flight || '',
      height: resp.height != null ? resp.height : null,
      diameter: resp.diameter != null ? resp.diameter : null,
      humanRated: !!resp.human_rated,
      crewCapacity: resp.crew_capacity != null ? resp.crew_capacity : null,
      payloadCapacity: resp.payload_capacity != null ? resp.payload_capacity : null,
      payloadReturnCapacity: resp.payload_return_capacity != null ? resp.payload_return_capacity : null,
      flightLife: resp.flight_life || '',
      wikiLink: resp.wiki_link || '',
      infoLink: resp.info_link || '',
      spacecraftFlown: resp.spacecraft_flown != null ? resp.spacecraft_flown : null,
      totalLaunchCount: resp.total_launch_count != null ? resp.total_launch_count : null,
      successfulLaunches: resp.successful_launches != null ? resp.successful_launches : null,
      failedLaunches: resp.failed_launches != null ? resp.failed_launches : null,
      attemptedLandings: resp.attempted_landings != null ? resp.attempted_landings : null,
      successfulLandings: resp.successful_landings != null ? resp.successful_landings : null,
      failedLandings: resp.failed_landings != null ? resp.failed_landings : null
    }

    await setCache('space_devs_cache', cacheKey, result)
    return { success: true, data: result, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ══════════════════════════════════════════════
//  LL2 飞船构型全量列表（全球飞船图鉴数据源）
//  跟随 next 分页拉全量：LL2 新增飞船构型自动进列表，前端零改动
// ══════════════════════════════════════════════
async function handleLl2SpacecraftList() {
  const cacheKey = 'll2_spacecraft_list_v1'
  const cached = await getCache('space_devs_cache', cacheKey, LL2_SPACECRAFT_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const rows = []
    let url = 'https://ll.thespacedevs.com/2.3.0/spacecraft_configurations/?mode=normal&format=json&limit=100'
    let page = 0
    while (url && page < 3) { // 最多 3 页（300 条，当前全量 ~46 条，留足增长空间）
      const resp = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
      if (resp && Array.isArray(resp.results)) rows.push(...resp.results)
      url = resp && resp.next ? resp.next : null
      page++
    }
    if (!rows.length) return { success: false, error: 'LL2 returned empty' }

    const mirrorMap = await getMirrorMap()
    const list = rows.map((s) => {
      const agency = s.agency || {}
      return {
        id: s.id,
        name: s.name || '',
        typeName: s.type && s.type.name ? s.type.name : '',
        agencyId: agency.id || null,
        agencyName: agency.name || '',
        agencyAbbrev: agency.abbrev || '',
        inUse: !!s.in_use,
        // 缩略图优先：LL2 原图托管在海外对象存储，国内直连大图经常加载失败；已镜像的替换为 COS
        imageUrl: applyMirror(s.image && (s.image.thumbnail_url || s.image.image_url) || '', mirrorMap),
        fullImageUrl: applyMirror(s.image && (s.image.image_url || s.image.thumbnail_url) || '', mirrorMap)
      }
    })

    await setCache('space_devs_cache', cacheKey, list)
    return { success: true, data: list, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ══════════════════════════════════════════════
//  LL2 发射场（Location）全量列表（全球发射场分布数据源）
//  按累计发射数倒序；全量 ~68 条，单次 limit=100 可取完，跟随 next 兜底
// ══════════════════════════════════════════════
async function handleLl2LocationList() {
  // v2：补 description / timezoneName（发射场详情页信息面板用）
  const cacheKey = 'll2_location_list_v2'
  const cached = await getCache('space_devs_cache', cacheKey, LL2_SPACECRAFT_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const rows = []
    let url = 'https://ll.thespacedevs.com/2.3.0/locations/?format=json&limit=100&ordering=-total_launch_count'
    let page = 0
    while (url && page < 3) { // 最多 3 页（300 条，当前全量 ~68 条，留足增长空间）
      const resp = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
      if (resp && Array.isArray(resp.results)) rows.push(...resp.results)
      url = resp && resp.next ? resp.next : null
      page++
    }
    if (!rows.length) return { success: false, error: 'LL2 returned empty' }

    const mirrorMap = await getMirrorMap()
    const list = rows.map((loc) => {
      const country = loc.country || {}
      return {
        id: loc.id,
        name: loc.name || '',
        countryName: country.name || '',
        countryCode: country.alpha_2_code || '',
        active: !!loc.active,
        // map_image 为 LL2 生成的卫星定位图，尺寸统一适合卡片展示；已镜像的替换为 COS
        mapImage: applyMirror(loc.map_image || '', mirrorMap),
        // 缩略图优先：LL2 原图托管在海外对象存储，国内直连大图经常加载失败；已镜像的替换为 COS
        imageUrl: applyMirror(loc.image && (loc.image.thumbnail_url || loc.image.image_url) || '', mirrorMap),
        latitude: loc.latitude != null ? loc.latitude : null,
        longitude: loc.longitude != null ? loc.longitude : null,
        description: loc.description || '',
        timezoneName: loc.timezone_name || '',
        totalLaunchCount: loc.total_launch_count != null ? loc.total_launch_count : 0,
        totalLandingCount: loc.total_landing_count != null ? loc.total_landing_count : 0
      }
    })

    await setCache('space_devs_cache', cacheKey, list)
    return { success: true, data: list, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ══════════════════════════════════════════════
//  LL2 发射工位（Pad）列表（发射场详情页地图多标记数据源）
//  按 location__id 过滤，单场地工位 <50，一页取完；逐场地缓存 7 天
// ══════════════════════════════════════════════
const LL2_PAD_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

async function handleLl2PadList(event) {
  const locationId = Number(event.locationId)
  if (!locationId) return { success: false, error: 'locationId required' }

  const cacheKey = `ll2_pad_list_${locationId}_v1`
  const cached = await getCache('space_devs_cache', cacheKey, LL2_PAD_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const url = `https://ll.thespacedevs.com/2.3.0/pads/?format=json&limit=50&location__id=${locationId}&ordering=-total_launch_count`
    const resp = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
    const rows = resp && Array.isArray(resp.results) ? resp.results : []

    const list = rows.map((pad) => ({
      id: pad.id,
      name: pad.name || '',
      active: !!pad.active,
      latitude: pad.latitude != null ? Number(pad.latitude) : null,
      longitude: pad.longitude != null ? Number(pad.longitude) : null,
      totalLaunchCount: pad.total_launch_count != null ? pad.total_launch_count : 0
    }))

    // 空结果也缓存（合法状态），避免无工位场地反复穿透 LL2 配额
    await setCache('space_devs_cache', cacheKey, list)
    return { success: true, data: list, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ══════════════════════════════════════════════
//  LL2 火箭构型详情兜底（型号详情页数据源）
//  _config_meta 尚未同步到某型号时按 id 直连拉取，字段与 _config_meta 记录同构
// ══════════════════════════════════════════════
function parseIsoDuration(iso) {
  if (!iso) return ''
  const m = String(iso).match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return ''
  const parts = []
  if (m[1]) parts.push(m[1] + '天')
  if (m[2]) parts.push(m[2] + '时')
  if (m[3]) parts.push(m[3] + '分')
  return parts.join('') || (m[4] ? m[4] + '秒' : '')
}

function slimCountryCode(src) {
  if (!src) return ''
  if (typeof src === 'string') {
    const s = src.trim().toUpperCase()
    return s && s !== '??' && s !== '???' ? s : ''
  }
  if (Array.isArray(src)) {
    for (const item of src) {
      const c = slimCountryCode(item)
      if (c) return c
    }
    return ''
  }
  if (typeof src === 'object') {
    const code = String(src.alpha_2_code || src.alpha_3_code || src.code || '').trim().toUpperCase()
    return code && code !== '??' && code !== '???' ? code : ''
  }
  return ''
}

async function handleLl2RocketConfigDetail(event) {
  const cfgId = event && event.configId ? String(event.configId).trim() : ''
  if (!cfgId) return { success: false, error: 'missing configId' }

  const cacheKey = `ll2_rocket_config_v1_${cfgId}`
  const cached = await getCache('space_devs_cache', cacheKey, LL2_SPACECRAFT_CACHE_TTL)
  if (cached) return { success: true, data: cached, cached: true }

  try {
    const url = `https://ll.thespacedevs.com/2.3.0/launcher_configurations/${cfgId}/?format=json`
    const cfg = await fetchJSON(url, { 'User-Agent': 'SpaceSync/1.0' }, 15000)
    if (!cfg || cfg.id == null) return { success: false, error: 'LL2 returned empty' }

    const m = cfg.manufacturer || {}
    const result = {
      id: cfg.id,
      name: cfg.name || '',
      full_name: cfg.full_name || cfg.name || '',
      alias: cfg.alias || '',
      variant: cfg.variant || '',
      reusable: cfg.reusable === true,
      active: cfg.active !== false,
      manufacturerName: m.name || '',
      manufacturerAbbrev: m.abbrev || '',
      countryCode: slimCountryCode(m.country),
      image_url: (cfg.image && cfg.image.image_url) || '',
      thumbnail_url: (cfg.image && cfg.image.thumbnail_url) || '',
      imageCredit: (cfg.image && cfg.image.credit) || '',
      description: cfg.description || '',
      wiki_url: cfg.wiki_url || '',
      maiden_flight: cfg.maiden_flight || '',
      length: cfg.length != null ? cfg.length : null,
      diameter: cfg.diameter != null ? cfg.diameter : null,
      launch_mass: cfg.launch_mass != null ? cfg.launch_mass : null,
      leo_capacity: cfg.leo_capacity != null ? cfg.leo_capacity : null,
      gto_capacity: cfg.gto_capacity != null ? cfg.gto_capacity : null,
      to_thrust: cfg.to_thrust != null ? cfg.to_thrust : null,
      launch_cost: cfg.launch_cost != null ? cfg.launch_cost : null,
      min_stage: cfg.min_stage != null ? cfg.min_stage : null,
      max_stage: cfg.max_stage != null ? cfg.max_stage : null,
      total_launch_count: cfg.total_launch_count != null ? cfg.total_launch_count : null,
      successful_launches: cfg.successful_launches != null ? cfg.successful_launches : null,
      failed_launches: cfg.failed_launches != null ? cfg.failed_launches : null,
      pending_launches: cfg.pending_launches != null ? cfg.pending_launches : null,
      attempted_landings: cfg.attempted_landings != null ? cfg.attempted_landings : null,
      successful_landings: cfg.successful_landings != null ? cfg.successful_landings : null,
      failed_landings: cfg.failed_landings != null ? cfg.failed_landings : null,
      consecutive_successful_landings: cfg.consecutive_successful_landings != null ? cfg.consecutive_successful_landings : null,
      fastest_turnaround: cfg.fastest_turnaround || '',
      fastestTurnaroundText: parseIsoDuration(cfg.fastest_turnaround || ''),
      fetchedAt: Date.now()
    }

    await setCache('space_devs_cache', cacheKey, result)
    return { success: true, data: result, cached: false }
  } catch (e) {
    return { success: false, error: e.message || 'fetch failed' }
  }
}

// ── 小程序 AI 原子接口数据后端（launch-skill 专用） ──
const agentActions = require('./agent-actions.js')({ db, cloud, fetchJSON, getCache, setCache })

// ── 入口 ──
exports.main = async (event) => {
  await ensureApiProxyCollectionsOnce()
  const action = (event && event.action) || ''

  if (action === 'getOpenid') {
    const wxContext = cloud.getWXContext()
    return { code: 0, openid: wxContext.OPENID || '' }
  }
  if (action === 'liveStatus') return handleLiveStatus(event)
  if (action === 'liveStatusBatch') return handleLiveStatusBatch(event)
  if (action === 'list') return handleTelemetryList()
  if (action === 'telemetry') return handleTelemetry(event)
  if (action === 'll2EventDetail') return handleLl2EventDetail(event)
  if (action === 'll2SpacecraftDetail') return handleLl2SpacecraftDetail(event)
  if (action === 'll2SpacecraftList') return handleLl2SpacecraftList()
  if (action === 'll2LocationList') return handleLl2LocationList()
  if (action === 'll2PadList') return handleLl2PadList(event)
  if (action === 'll2RocketConfigDetail') return handleLl2RocketConfigDetail(event)
  if (typeof agentActions[action] === 'function') return agentActions[action](event)

  return { success: false, error: '未知 action: ' + action }
}
