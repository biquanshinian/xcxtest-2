// 云函数：同步 The Space Devs API 数据到云数据库
// 用于定时更新API数据，减少小程序直接请求API的频率

const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')
const voteRoundsFromUpdates = require('./vote-rounds-from-updates.js')
const { enrichApiDataForTranslation, enrichSingleLaunch, enrichEventsList } = require('./ll2-translate-enrich.js')
const { slimLaunchUpdates, splitLaunchUpdatesIntoTimelineCache } = require('./split-launch-updates-cache.js')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// API配置
// 生产环境：https://ll.thespacedevs.com/2.3.0
// 开发环境：https://lldev.thespacedevs.com/2.3.0
const LAUNCH_LIBRARY_API = 'https://ll.thespacedevs.com/2.3.0'
const PAYLOAD_API_BASE = 'https://ll.thespacedevs.com/2.3.0'
// 航天事件API 基础地址（注意：这里只能写到 /v4，具体端点在 url 里拼接）
// 之前写成了 /v4/articles，再叠加 url='/articles/' 会变成 /v4/articles/articles/，导致同步失败
const SPACEFLIGHT_NEWS_API = 'https://api.spaceflightnewsapi.net/v4'

// 缓存有效期：3.5小时（云数据库存储时间）
// 云函数每3小时执行1次，缓存有效期设置为3.5小时，确保在同步间隔期间数据仍然可用
// 同时避免数据过期时间过长导致数据不够新鲜
const CACHE_DURATION = 3.5 * 60 * 60 * 1000 // 3.5小时（210分钟）

// 核心发射列表（/launches/upcoming/、/launches/previous/ 的主文档 + 批次文档）保底 TTL：
// 这是首页倒计时/即将发射/历史发射的唯一数据源。LL2 偶发限流或同步失败一两轮时，
// 宁可让用户看到稍旧的数据，也绝不能让 cleanExpiredCache 把它们物理删除（会导致
// 客户端 cache_miss → 整页「数据暂不可用」）。48 小时内同步只要成功一次即被覆盖刷新。
const CORE_LAUNCH_LIST_CACHE_DURATION = 48 * 60 * 60 * 1000 // 48 小时

/** 是否核心发射列表缓存 key（含其 _batch_N 批次文档） */
function isCoreLaunchListKey(cacheKey) {
  return typeof cacheKey === 'string' &&
    (cacheKey.indexOf('api_cache_/launches/upcoming/') === 0 ||
     cacheKey.indexOf('api_cache_/launches/previous/') === 0)
}

const CLOUD_FILE_PREFIX = 'cloud://cloud1-9gdqgdt5bfaa20fb.636c-cloud1-9gdqgdt5bfaa20fb-1397421562/'
const CLOUD_CDN_BASE = 'https://636c-cloud1-9gdqgdt5bfaa20fb-1397421562.tcb.qcloud.la/'
const INSPIRATION_OLD_DIR = '灵感流照片片集'
const INSPIRATION_DIR = '灵感流照片集'
const INSPIRATION_MIN_RENDER_COUNT = 12
const INSPIRATION_SOURCE_TAG = 'inspiration'
const INSPIRATION_ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])
const INSPIRATION_ALLOWED_VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm'])
const DEFAULT_COS_REGION = process.env.COS_REGION || 'ap-shanghai'

const INSPIRATION_COS_BUCKET = 'mars-1397421562'
const INSPIRATION_COS_REGION = 'ap-guangzhou'
const INSPIRATION_COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

/**
 * 发起HTTP请求（云函数中使用）
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      url: url,
      method: options.method || 'GET',
      headers: options.headers || {
        'Content-Type': 'application/json'
      },
      timeout: options.timeout || 20000,
      ...options
    }

    // 使用云函数内置的 request 方法
    cloud.callFunction({
      name: 'httpRequest',
      data: { url, options: requestOptions }
    }).then(res => {
      resolve(res.result)
    }).catch(err => {
      // 如果 httpRequest 云函数不存在，使用 axios 或直接返回错误
      reject(err)
    })
  })
}

/**
 * 使用云函数内置的 HTTP 请求能力
 * 注意：微信云函数需要使用第三方库如 axios 或 node-fetch
 * 这里使用云函数内置能力（如果可用）或直接使用 node 的 https 模块
 */
async function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'SpaceDevs-Sync-CloudFunction/1.0'
    }
    if (token && token !== 'FILL_ME') headers['Authorization'] = `Token ${token}`

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 30000  // 增加到30秒，确保大数据量请求有足够时间完成
    }

    const req = client.request(options, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const jsonData = JSON.parse(data)
            resolve(jsonData)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        } catch (error) {
          reject(new Error(`解析响应失败: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    req.end()
  })
}

// === Launch 列表精简（提到顶层，便于 fetchLaunchDetail 等 action 复用）=================
function shouldSlimLaunchList(u, p) {
  if (!(typeof u === 'string')) return false
  if (!(u.includes('/launches/upcoming/') || u.includes('/launches/previous/'))) return false
  if (!p || typeof p !== 'object') return false
  return p.mode === 'detailed'
}

/** 保留轨道展示所需字段；abbrev 在 LL2 里偶发为嵌套对象 */
function slimOrbit(orbit) {
  if (!orbit || typeof orbit !== 'object') return null
  const abbrevRaw = orbit.abbrev
  const abbrevFlat = (abbrevRaw != null && typeof abbrevRaw === 'object')
    ? (abbrevRaw.abbrev || abbrevRaw.name || null)
    : abbrevRaw
  return {
    id: orbit.id != null ? orbit.id : null,
    name: orbit.name != null ? orbit.name : null,
    abbrev: abbrevFlat != null ? abbrevFlat : null,
    perigee: orbit.perigee != null ? orbit.perigee : null,
    apogee: orbit.apogee != null ? orbit.apogee : null
  }
}

/** LL2 mission.type 有时为嵌套对象，统一成可展示字符串，避免小程序 String(object) */
function slimMissionType(t) {
  if (t == null) return null
  if (typeof t === 'string') return t
  if (typeof t === 'object') {
    const s = t.name || t.abbrev || t.full_name || ''
    return s || null
  }
  return String(t)
}

/**
 * 从 LL2 Country 对象/数组/字符串中取 alpha_2 国家码。
 * LL2 2.3.0 把扁平 country_code 换成嵌套 Country 对象（alpha_2_code/alpha_3_code），
 * 这里抽取 2 字母码写回 slim，保持 slim 体积小（仅 2 字符），
 * 同时让 getLaunchStats 的 pad.location.country_code 路径继续可用。
 */
function slimCountryCode(src) {
  if (!src) return null
  if (typeof src === 'string') {
    const s = src.trim().toUpperCase()
    return s && s !== '??' && s !== '???' ? s : null
  }
  if (Array.isArray(src)) {
    for (const item of src) {
      const c = slimCountryCode(item)
      if (c) return c
    }
    return null
  }
  if (typeof src === 'object') {
    const code = String(src.alpha_2_code || src.alpha_3_code || src.code || '').trim().toUpperCase()
    return code && code !== '??' && code !== '???' ? code : null
  }
  return null
}

function slimLaunch(launch) {
  if (!launch || typeof launch !== 'object') return launch
  const rocketCfg = launch.rocket && launch.rocket.configuration ? launch.rocket.configuration : null
  const padLoc = launch.pad && launch.pad.location ? launch.pad.location : null
  const padCountryCode = (launch.pad && slimCountryCode(launch.pad.country))
    || (padLoc && (slimCountryCode(padLoc.country) || slimCountryCode(padLoc.country_code)))
    || null
  const mission = launch.mission || null
  const status = launch.status || null
  const provider = launch.launch_service_provider || launch.lsp || null

  const slimLandingLocation = (loc) => {
    if (!loc) return null
    if (typeof loc === 'string') return loc
    if (typeof loc === 'object') {
      return { id: loc.id, name: loc.name, abbrev: loc.abbrev, type: loc.type }
    }
    return null
  }

  const slimLanding = (landing) => {
    if (!landing || typeof landing !== 'object') return null
    // 保留 landing.type / attempt / success —— 是回收方式（Expended/RTLS/ASDS/SD/HL…）的核心字段
    // 飞船级着陆 LL2 常用 location，助推器用 landing_location —— 统一落到 landing_location
    const t = landing.type
    return {
      landing_location: slimLandingLocation(landing.landing_location || landing.location),
      type: t && typeof t === 'object'
        ? { id: t.id, name: t.name, abbrev: t.abbrev }
        : t,
      attempt: landing.attempt,
      success: landing.success,
      description: landing.description
    }
  }

  const slimLauncherStageItem = (st) => {
    if (!st || typeof st !== 'object') return null
    const innerLauncher = (st.launcher && typeof st.launcher === 'object') ? st.launcher : null
    const serialNumber = st.serial_number
      || (innerLauncher && innerLauncher.serial_number)
      || (innerLauncher && innerLauncher.name)
      || ''
    return {
      id: st.id,
      type: st.type || st.position || st.role || null,
      serial_number: serialNumber,
      flights: st.flights != null ? st.flights : (innerLauncher && innerLauncher.flights != null ? innerLauncher.flights : null),
      launcher_flight_number: st.launcher_flight_number != null ? st.launcher_flight_number : null,
      reused: st.reused,
      landing_type: st.landing_type,
      landing_location: st.landing_location,
      landing: slimLanding(st.landing),
      launcher: innerLauncher ? {
        name: innerLauncher.name || null,
        full_name: innerLauncher.full_name || null,
        serial_number: innerLauncher.serial_number || null,
        flights: innerLauncher.flights != null ? innerLauncher.flights : null,
        successful_landings: innerLauncher.successful_landings != null ? innerLauncher.successful_landings : null,
        attempted_landings: innerLauncher.attempted_landings != null ? innerLauncher.attempted_landings : null,
        flight_proven: innerLauncher.flight_proven || false,
        image_url: innerLauncher.image_url || null
      } : null
    }
  }

  const slimSpacecraftStageItem = (st) => {
    if (!st || typeof st !== 'object') return null
    const sc = (st.spacecraft && typeof st.spacecraft === 'object') ? st.spacecraft : null
    const cfg = (sc && sc.spacecraft_config && typeof sc.spacecraft_config === 'object')
      ? sc.spacecraft_config
      : (sc && sc.configuration && typeof sc.configuration === 'object' ? sc.configuration : null)
    const cfgType = cfg && cfg.type
    return {
      id: st.id,
      landing: slimLanding(st.landing),
      destination: st.destination || null,
      mission_end: st.mission_end || null,
      spacecraft: sc ? {
        id: sc.id,
        name: sc.name || null,
        serial_number: sc.serial_number || null,
        flights_count: sc.flights_count != null ? sc.flights_count : null,
        flights: sc.flights != null ? sc.flights : null,
        mission_ends_count: sc.mission_ends_count != null ? sc.mission_ends_count : null,
        in_space: sc.in_space === true ? true : (sc.in_space === false ? false : undefined),
        status: sc.status && sc.status.name ? sc.status.name : null,
        configuration: cfg ? {
          id: cfg.id,
          name: cfg.name,
          full_name: cfg.full_name,
          type: cfgType && typeof cfgType === 'object'
            ? { id: cfgType.id, name: cfgType.name }
            : (cfgType || null)
        } : null
      } : null
    }
  }

  const launcherStageRaw = launch.rocket && (launch.rocket.launcher_stage || (launch.rocket.rocket && launch.rocket.rocket.launcher_stage) || launch.rocket.first_stage)
  const launcherStageArr = Array.isArray(launcherStageRaw) ? launcherStageRaw : (launcherStageRaw ? [launcherStageRaw] : [])
  const launcher_stage = launcherStageArr.map(slimLauncherStageItem).filter(Boolean)

  const spacecraftStageRaw = launch.rocket && (launch.rocket.spacecraft_stage || (launch.rocket.rocket && launch.rocket.rocket.spacecraft_stage))
  const spacecraftStageArr = Array.isArray(spacecraftStageRaw) ? spacecraftStageRaw : (spacecraftStageRaw ? [spacecraftStageRaw] : [])
  const spacecraft_stage = spacecraftStageArr.map(slimSpacecraftStageItem).filter(Boolean)

  // 轨道上 LL2 常挂在 mission.orbit；星舰试飞等还会在 payload 上——以往 slim 整块丢掉导致小程序永远拉不到「任务轨道」
  let payload_flights_slim = null
  if (Array.isArray(launch.payload_flights) && launch.payload_flights.length > 0) {
    const rows = []
    for (const row of launch.payload_flights) {
      const p = row && row.payload
      if (!p || typeof p !== 'object' || !p.orbit) continue
      rows.push({ payload: { orbit: slimOrbit(p.orbit) } })
    }
    if (rows.length > 0) payload_flights_slim = rows
  }

  let payloads_slim = null
  if (mission && Array.isArray(mission.payloads) && mission.payloads.length > 0) {
    const rows = []
    for (const p of mission.payloads) {
      if (!p || typeof p !== 'object' || !p.orbit) continue
      rows.push({ orbit: slimOrbit(p.orbit) })
    }
    if (rows.length > 0) payloads_slim = rows
  }

  return {
    id: launch.id,
    url: launch.url,
    name: launch.name,
    net: launch.net,
    window_start: launch.window_start,
    window_end: launch.window_end,
    status: status ? { id: status.id, name: status.name, abbrev: status.abbrev } : null,
    probability: launch.probability,
    weather_concerns: launch.weather_concerns,
    mission: mission ? {
      name: mission.name,
      description: mission.description,
      type: slimMissionType(mission.type),
      orbit: mission.orbit ? slimOrbit(mission.orbit) : null,
      payloads: payloads_slim || undefined
    } : null,
    payload_flights: payload_flights_slim || undefined,
    launch_service_provider: provider ? { id: provider.id, name: provider.name, abbrev: provider.abbrev, country_code: provider.country_code || slimCountryCode(provider.country) || null } : null,
    rocket: rocketCfg ? {
      // reusable：LL2 构型级可复用标记（长十乙网系回收等中国火箭无 stage 级着陆数据，靠它判定「可回收」）——_v5 起保留
      configuration: { id: rocketCfg.id, name: rocketCfg.name, full_name: rocketCfg.full_name, family: rocketCfg.family, variant: rocketCfg.variant, reusable: rocketCfg.reusable === true || undefined },
      launcher_stage,
      spacecraft_stage
    } : (launch.rocket && launch.rocket.configuration
      ? { configuration: launch.rocket.configuration, launcher_stage, spacecraft_stage }
      : { launcher_stage, spacecraft_stage }),
    pad: launch.pad ? {
      id: launch.pad.id,
      name: launch.pad.name,
      country_code: padCountryCode,
      location: padLoc ? { id: padLoc.id, name: padLoc.name, country_code: slimCountryCode(padLoc.country) || slimCountryCode(padLoc.country_code) || padCountryCode || null } : null
    } : null,
    webcast_live: launch.webcast_live,
    infographic: launch.infographic,
    image: launch.image,
    // 嵌套 updates：供详情「发射动态」与 6h 拆分入库 updates_{uuid}（冷路径养历史）
    updates: slimLaunchUpdates(launch.updates)
  }
}
// === END slimLaunch ====================================================================

/**
 * 清理指定 key 上一代残留的批次文档（_batch_N，N >= fromIndex）。
 * 只在新数据成功写入后调用；逐个删除直到遇到第一个不存在的文档。
 * 删除失败静默忽略，不影响主流程。
 */
async function removeOrphanBatchDocs(cacheKey, fromIndex) {
  const MAX_SCAN = 30 // 防御性上限
  for (let i = fromIndex; i < fromIndex + MAX_SCAN; i++) {
    try {
      const res = await db.collection('space_devs_cache').doc(`${cacheKey}_batch_${i}`).remove()
      const removed = res && res.stats ? res.stats.removed : 0
      if (!removed) break
    } catch (e) {
      break // 文档不存在或删除失败：停止扫描
    }
  }
}

/**
 * 保存数据到云数据库（带重试）
 */
async function saveToCloudDB(cacheKey, apiData, retryCount = 0) {
  const MAX_RETRIES = 3
  const SAVE_TIMEOUT = 10000 // 增加到10秒，确保大数据也能保存
  
  try {
    // 验证数据完整性
    if (!apiData) {
      throw new Error('API数据为空')
    }
    
    const now = Date.now()
    // 核心发射列表用 48h 保底 TTL，其余端点维持 3.5h
    const cacheTtl = isCoreLaunchListKey(cacheKey) ? CORE_LAUNCH_LIST_CACHE_DURATION : CACHE_DURATION
    
    // 检查数据大小（按字节），如果超过1MB，需要分批保存
    const dataSize = Buffer.byteLength(JSON.stringify(apiData), 'utf8')
    
    // 如果数据包含results数组，验证数组长度
    if (apiData.results && Array.isArray(apiData.results)) {
      const resultsCount = apiData.results.length
      
      // 如果预期应该有更多数据，记录警告
      if (resultsCount === 0) {
      }
      
      // 如果数据大小接近1MB限制，记录警告
      if (dataSize > 1024 * 1024 * 0.8) {
      }
    }
    const MAX_DOC_SIZE = 1024 * 1024 * 0.8 // 约 800KB，留足余量避免 BSON/索引等开销导致超过 1MB
    
    if (dataSize > MAX_DOC_SIZE && apiData.results && Array.isArray(apiData.results)) {

      const results = apiData.results

      const batchKeys = []
      let currentBatch = []
      let batchIndex = 0

      // 估算“除 results 外的固定部分”大小，避免每次都 stringify 全量
      const baseWithoutResults = {
        ...apiData,
        results: [],
        count: results.length,
        isBatch: true
      }
      const baseBytes = Buffer.byteLength(JSON.stringify(baseWithoutResults), 'utf8')

      const flushBatch = async () => {
        if (currentBatch.length === 0) return

        const batchCacheKey = `${cacheKey}_batch_${batchIndex}`
        const batchApiData = {
          ...apiData,
          results: currentBatch,
          count: results.length,
          batchIndex: batchIndex,
          isBatch: true
        }

        const batchCacheData = {
          data: batchApiData,
          timestamp: now,
          expireAt: now + cacheTtl,
          updatedAt: now
        }

        await Promise.race([
          db.collection('space_devs_cache').doc(batchCacheKey).set({
            data: batchCacheData
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('数据库保存超时')), SAVE_TIMEOUT)
          )
        ])

        batchKeys.push(batchCacheKey)

        batchIndex++
        currentBatch = []
      }

      for (const item of results) {
        // 尽量用单条记录的字节估算来决定是否切批次
        const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8')

        // 如果一条记录本身就很大，仍然尝试单条成批（极端情况下会失败，但比固定 50 更稳）
        const nextEstimatedBytes = baseBytes + Buffer.byteLength(JSON.stringify([...currentBatch, item]), 'utf8')

        if (currentBatch.length > 0 && nextEstimatedBytes > MAX_DOC_SIZE) {
          await flushBatch()
        }

        // 若当前批为空但单条仍超阈值，先直接放入批次，后续写入时由数据库限制兜底报错
        currentBatch.push(item)

        // 简单保护：避免批次无限增长
        if (baseBytes + itemBytes > MAX_DOC_SIZE) {
          await flushBatch()
        }
      }

      await flushBatch()

      // 保存主文档（包含元数据，指向批次数据）
      const mainCacheData = {
        data: {
          count: results.length,
          results: [],
          next: null,
          previous: null,
          isBatched: true,
          totalBatches: batchKeys.length,
          batchKeys: batchKeys
        },
        timestamp: now,
        expireAt: now + cacheTtl,
        updatedAt: now
      }

      await Promise.race([
        db.collection('space_devs_cache').doc(cacheKey).set({
          data: mainCacheData
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('数据库保存超时')), SAVE_TIMEOUT)
        )
      ])

      // 新数据已成功落库：此时才清理上一代多余的批次文档（批次数变少时的孤儿文档）。
      // 若本轮拉取/写入在前面任何一步失败，绝不会走到这里，旧缓存原样保留。
      await removeOrphanBatchDocs(cacheKey, batchKeys.length)

      return true
    }
    
    // 数据大小在限制内，正常保存
    // 云数据库文档结构：{ _id: cacheKey, data: { data: apiData, timestamp, expireAt }, ... }
    const cacheData = {
      data: apiData,  // 实际的API数据
      timestamp: now,
      expireAt: now + cacheTtl,
      updatedAt: now
    }

    // 使用 set 操作，如果存在则更新，不存在则创建
    // 注意：云数据库的 set 方法会自动处理文档的创建和更新
    // set 方法的参数会被包装在 data 字段中
    await Promise.race([
      db.collection('space_devs_cache').doc(cacheKey).set({
        data: cacheData
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('数据库保存超时')), SAVE_TIMEOUT)
      )
    ])

    // 上一代若是分批存储（数据缩小后不再分批），新主文档落库成功后清掉旧批次孤儿文档
    await removeOrphanBatchDocs(cacheKey, 0)

    // set 操作成功即可信赖，无需额外验证读取（节省数据库读操作）
    return true
  } catch (error) {
    
    // 如果未达到最大重试次数，进行重试
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000))
      return saveToCloudDB(cacheKey, apiData, retryCount + 1)
    }
    
    throw error
  }
}

/**
 * 分页请求全部数据（直到没有更多数据）
 * @param {String} url API路径（相对路径或完整URL）
 * @param {Object} baseParams 基础请求参数
 * @param {String} apiBase 可选，API基础URL
 * @param {Number} maxPages 最大请求页数，防止无限循环，默认5页（遵循API速率限制：每小时15次）
 * @param {Number} maxExecutionTime 最大执行时间（毫秒），默认30秒
 * @param {Number} maxApiCalls 最大API调用次数，防止超过速率限制，默认5次
 */
async function syncAPIEndpointWithPagination(url, baseParams = {}, apiBase = null, maxPages = 5, maxExecutionTime = 30000, maxApiCalls = 5) {
  const startTime = Date.now()
  let allResults = []
  let offset = baseParams.offset || 0
  const limit = baseParams.limit || 100
  let hasMore = true
  let pageCount = 0
  let apiCallCount = 0 // 记录API调用次数，防止超过速率限制
  
  // API速率限制：每小时最多15次请求（整个账户，包括小程序端和云函数）
  // 云函数每3小时执行1次，每次最多使用maxApiCalls次API调用，确保不超过限制
  while (hasMore && pageCount < maxPages && apiCallCount < maxApiCalls) {
    // 检查是否超时
    if (Date.now() - startTime > maxExecutionTime) {
      break
    }
    
    // 构建当前页的参数
    const currentParams = {
      ...baseParams,
      limit: limit,
      offset: offset
    }
    
    try {
      // 构建完整URL
      let fullUrl
      if (url.startsWith('http://') || url.startsWith('https://')) {
        fullUrl = url
      } else {
        let base
        if (apiBase) {
          base = apiBase
        } else if (url.startsWith('/payloads') || url.startsWith('/payload_flights')) {
          base = PAYLOAD_API_BASE
        } else {
          base = LAUNCH_LIBRARY_API
        }
        fullUrl = base + url
      }
      
      if (Object.keys(currentParams).length > 0) {
        const queryString = Object.keys(currentParams)
          .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(currentParams[key])}`)
          .join('&')
        fullUrl += (url.includes('?') ? '&' : '?') + queryString
      }
      
      
      // 检查是否超过API调用次数限制
      if (apiCallCount >= maxApiCalls) {
        break
      }
      
      // 获取当前页数据（对于大数据量请求，使用更长的超时时间）
      const apiData = await Promise.race([
        fetchAPI(fullUrl),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API请求超时')), 25000) // 增加到25秒
        )
      ])
      
      // 记录API调用次数
      apiCallCount++
      
      if (!apiData || !apiData.results || !Array.isArray(apiData.results)) {
        break
      }
      
      const currentResults = apiData.results
      allResults = allResults.concat(currentResults)
      
      
      // 检查是否还有更多数据
      hasMore = !!(apiData.next && currentResults.length === limit)
      offset += currentResults.length
      pageCount++
      
      // 如果当前页返回的数据少于limit，说明已经是最后一页
      if (currentResults.length < limit) {
        hasMore = false
      }
      
      // 短暂延迟，避免请求过于频繁
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    } catch (error) {
      // 如果已经获取到一些数据，就保存已获取的数据
      if (allResults.length > 0) {
        break
      } else {
        throw error
      }
    }
  }
  
  // 构建完整的API响应格式
  const finalData = {
    count: allResults.length,
    next: null, // 合并后的数据不再有next
    previous: null,
    results: allResults
  }
  
  return finalData
}

/**
 * 同步指定的API端点数据
 * @param {String} url API路径（相对路径或完整URL）
 * @param {Object} params 请求参数
 * @param {String} apiBase 可选，API基础URL，如果不提供则根据url自动判断
 * @param {Boolean} fetchAll 是否分页请求全部数据，默认false
 * @param {Number} maxPages 最大请求页数，默认5页
 * @param {Number} maxApiCalls 最大API调用次数，默认5次
 */
async function syncAPIEndpoint(url, params = {}, apiBase = null, fetchAll = false, maxPages = 5, maxApiCalls = 5) {
  // shouldSlimLaunchList / slimLaunch 已抽到模块顶层，避免与 fetchLaunchDetail 重复定义
  try {
    let apiData
    let fetchTime = 0
    
    // 如果需要分页请求全部数据
    if (fetchAll) {
      // 对于大数据量端点，增加最大执行时间（每页最多25秒，5页最多125秒）
      // 现在云函数超时设置为500秒，可以给更多时间
      const maxExecTime = maxPages > 3 ? 150000 : 100000 // 多页请求给150秒，少页请求给100秒
      apiData = await syncAPIEndpointWithPagination(url, params, apiBase, maxPages, maxExecTime, maxApiCalls)
    } else {
      // 单次请求模式（原有逻辑）
      let fullUrl
      if (url.startsWith('http://') || url.startsWith('https://')) {
        fullUrl = url
      } else {
        // 构建完整URL
        let base
        if (apiBase) {
          base = apiBase
        } else if (url.startsWith('/payloads') || url.startsWith('/payload_flights')) {
          base = PAYLOAD_API_BASE
        } else {
          base = LAUNCH_LIBRARY_API
        }
        
        fullUrl = base + url
      }
      if (Object.keys(params).length > 0) {
        const queryString = Object.keys(params)
          .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join('&')
        fullUrl += (url.includes('?') ? '&' : '?') + queryString
      }

      const startTime = Date.now()

      // 获取API数据（带超时保护）
      apiData = await Promise.race([
        fetchAPI(fullUrl),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API请求超时')), 25000) // 增加到25秒
        )
      ])
      
      fetchTime = Date.now() - startTime
    }
    
    // 验证API返回的数据完整性
    if (!apiData) {
      throw new Error('API返回数据为空')
    }

    // 对 launches 列表做轻量化（只对 upcoming/previous 且 mode=detailed 的列表同步生效）
    if (shouldSlimLaunchList(url, params) && apiData.results && Array.isArray(apiData.results)) {
      apiData = {
        ...apiData,
        results: apiData.results.map(slimLaunch)
      }
      // 长十乙等网系回收：把 LL2 误标的 Ocean/ASDS 改写成 NET（前端已识别），不改小程序
      try {
        const { enrichLaunchListNetRecovery } = require('./ll2-net-recovery-enrich.js')
        enrichLaunchListNetRecovery(apiData)
      } catch (e) {
        console.warn('[net-recovery-enrich]', e.message || e)
      }
    }
    
    // 如果数据包含results数组，记录数量
    if (apiData.results && Array.isArray(apiData.results)) {
      const resultsCount = apiData.results.length
      
      if (resultsCount === 0) {
      }
      
      // 记录数据大小
      const dataSize = JSON.stringify(apiData).length
      
      if (dataSize > 1024 * 1024) {
      }
    } else if (apiData.results !== undefined) {
    }

    // 生成缓存key（使用完整URL或相对路径）
    // 对参数对象进行排序，确保属性顺序一致，避免 cacheKey 不匹配
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = params[key]
        return sorted
      }, {})
    const paramsStr = JSON.stringify(sortedParams)
    // 如果是完整URL，使用完整URL作为key的一部分；否则使用相对路径
    const urlForKey = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : url
    // 对 launches 列表写入单独的轻量缓存 key，避免与旧 detailed 缓存冲突
    // 规则：upcoming/previous 且 mode=detailed → 轻量列表 key + _slim_v6
    // _v6 是 slim schema 版本号（与前端 utils/api-request.js 的 SLIM_LIST_VERSION 保持一致）
    // 每次列表瘦身规则变更时都要升级版本号，自动让老 schema 的云端/本地缓存失效
    //   v5: configuration 保留 reusable（构型级可回收判定，长十乙网系回收等）
    //   v6: 保留嵌套 updates（历史发射动态冷路径）
    const SLIM_LIST_VERSION = '_v6'
    const isSlimList = shouldSlimLaunchList(url, params)
    const cacheKey = `api_cache_${urlForKey}_${paramsStr}${isSlimList ? '_slim' + SLIM_LIST_VERSION : ''}`
    let updatesSplit = null

    // 同步阶段写入中文字段（术语词典 + TMT + translation_cache）
    try {
      apiData = await enrichApiDataForTranslation(url, params, apiData, apiBase)
    } catch (translateErr) {
      console.warn('[translate-enrich]', translateErr.message || translateErr)
    }

    // 冷路径：在分批落库前拆分 updates（saveToCloudDB 会把主文档 results 置空）
    if (isSlimList && apiData && Array.isArray(apiData.results) && apiData.results.length) {
      try {
        updatesSplit = await splitLaunchUpdatesIntoTimelineCache(db, apiData.results, {
          source: 'sync_launches_slim_v6'
        })
      } catch (splitErr) {
        console.warn('[updates-split]', splitErr.message || splitErr)
        updatesSplit = { error: splitErr.message || String(splitErr) }
      }
    }

    // 保存到云数据库（saveToCloudDB内部已有超时和重试机制）
    await saveToCloudDB(cacheKey, apiData)

    // ⚠️ 旧版缓存清理必须放在新数据成功落库之后：
    // 若写入失败（上面已 throw），旧格式/老 schema 文档原样保留，客户端仍有兜底数据可读；
    // 只有拿到并写入新数据后才删除上一代缓存。

    // 如果是 /launches/upcoming/ 或 /launches/previous/，且使用新的 limit: 100 格式
    // 清理同一 endpoint 的旧格式缓存（limit: 20），避免缓存冲突
    if ((url.includes('/launches/upcoming/') || url.includes('/launches/previous/')) && 
        params.limit === 100) {
      try {
        // 构建旧格式的缓存 key（limit: 20）
        // 使用与构建 cacheKey 相同的排序逻辑
        const oldParams = { ...params, limit: 20 }
        const oldSortedParams = Object.keys(oldParams)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = oldParams[key]
            return sorted
          }, {})
        const oldParamsStr = JSON.stringify(oldSortedParams)
        const oldCacheKey = `api_cache_${urlForKey}_${oldParamsStr}`
        
        // 尝试删除旧格式的缓存
        try {
          await db.collection('space_devs_cache').doc(oldCacheKey).remove()
        } catch (removeError) {
          // 如果文档不存在（errCode: -1），忽略错误（这是正常的）
          if (removeError.errCode !== -1 && 
              !removeError.errMsg.includes('not exist') && 
              !removeError.errMsg.includes('不存在')) {
          } else {
          }
        }
      } catch (error) {
        // 清理失败不影响主流程
      }
    }

    // 清理同 endpoint 的老 slim schema 版本缓存（_slim / _slim_v2 … _slim_v5）
    if (isSlimList) {
      const legacySuffixes = ['_slim', '_slim_v2', '_slim_v3', '_slim_v4', '_slim_v5']
      for (const sfx of legacySuffixes) {
        const legacyKey = `api_cache_${urlForKey}_${paramsStr}${sfx}`
        try {
          await db.collection('space_devs_cache').doc(legacyKey).remove()
        } catch (removeError) {
          // 不存在属正常情况，静默忽略
        }
        // 同时清理分批存储的 batch 文档
        try {
          let batchIdx = 0
          while (batchIdx < 20) {
            const batchKey = `${legacyKey}_batch_${batchIdx}`
            const rmRes = await db.collection('space_devs_cache').doc(batchKey).remove().catch(() => null)
            if (!rmRes) break
            batchIdx++
          }
        } catch (_) {}
      }
    }

    // 记录最终保存的数据信息
    const resultsCount = apiData.results && Array.isArray(apiData.results) ? apiData.results.length : 0
    
    return {
      success: true,
      cacheKey: cacheKey,
      dataSize: JSON.stringify(apiData).length,
      fetchTime: fetchTime,
      resultsCount: resultsCount,
      updatesSplit: updatesSplit || undefined
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * 供 index.js 模块化 action `syncLaunches` 使用：与全量同步相同的 cacheKey / slim / 旧版缓存清理。
 * upcoming 增加 hide_recent_previous（LL2 FAQ：减少刚结束仍出现在 upcoming 的条目）。
 */
async function runModularSyncLaunches() {
  const results = []
  results.push(await syncAPIEndpoint('/launches/upcoming/', { limit: 100, offset: 0, ordering: 'net', mode: 'detailed', format: 'json', hide_recent_previous: true }, null, true, 4, 4))
  results.push(await syncAPIEndpoint('/launches/previous/', { limit: 100, offset: 0, ordering: '-net', mode: 'detailed', format: 'json' }, null, true, 2, 2))
  return results
}

/**
 * 供 index.js 模块化 action `syncEvents` 使用：与全量同步（syncCommonEndpoints）
 * 完全相同的 url/params，从而写入客户端读取的 api_cache_… 缓存 key。
 * 勿改用 shared.syncAPIEndpoint（其 key 规则不同，客户端读不到）。
 */
async function runModularSyncEvents() {
  const results = []
  results.push(await syncAPIEndpoint('/events/upcoming/', { limit: 100, offset: 0 }, null, true, 2, 2))
  results.push(await syncAPIEndpoint('/updates/', { limit: 100, offset: 0 }, null, true, 1, 1))
  results.push(await syncAPIEndpoint('/articles/', { format: 'json', limit: 100, offset: 0, ordering: '-published_at' }, SPACEFLIGHT_NEWS_API, true, 1, 1))
  return results
}

/**
 * 同步常用的API端点
 */
// ── 空间站动态清单（数据驱动）──
// LL2 /space_stations/ 列表中 active/在建 的站自动纳入同步与前端展示；
// 未来新增商业空间站等无需改代码
const STATION_LIST_PARAMS = { format: 'json', limit: 30, offset: 0 }
const DEFAULT_STATION_SYNC_IDS = [4, 18] // ISS + 天宫（列表不可用时的兜底）
const MAX_STATION_DETAIL_SYNC = 4 // 单轮详情同步上限，防 LL2 配额被打爆

function _isOperationalStationStatus(status) {
  const st = String((status && status.name) || '').toLowerCase()
  return st.includes('active') || st.includes('construction') || st.includes('assembly')
}

function _stationListCacheKey() {
  const sortedParams = Object.keys(STATION_LIST_PARAMS).sort().reduce((s, k) => { s[k] = STATION_LIST_PARAMS[k]; return s }, {})
  return `api_cache_/space_stations/_${JSON.stringify(sortedParams)}`
}

/** 拉取空间站列表并写入客户端可读缓存，返回需详情同步的站 id（失败回退 ISS+天宫） */
async function resolveActiveStationIds() {
  try {
    const qs = Object.keys(STATION_LIST_PARAMS).map(k => `${k}=${encodeURIComponent(STATION_LIST_PARAMS[k])}`).join('&')
    const data = await httpsGetJson(`${LAUNCH_LIBRARY_API}/space_stations/?${qs}`, 25000)
    const rows = data && Array.isArray(data.results) ? data.results : []
    if (!rows.length) return DEFAULT_STATION_SYNC_IDS
    await saveToCloudDB(_stationListCacheKey(), data)
    const ids = rows.filter(s => _isOperationalStationStatus(s.status)).map(s => s.id).filter(id => id != null)
    return ids.length ? ids.slice(0, MAX_STATION_DETAIL_SYNC) : DEFAULT_STATION_SYNC_IDS
  } catch (e) {
    console.warn('[Stations] 列表拉取失败，回退默认站:', e.message)
    return DEFAULT_STATION_SYNC_IDS
  }
}

/** 从已同步的列表缓存读取运营中的站 id（零 API 调用；缓存缺失回退 ISS+天宫） */
async function readSyncedStationIds() {
  try {
    const doc = await db.collection('space_devs_cache').doc(_stationListCacheKey()).get().catch(() => null)
    const rows = doc && doc.data && doc.data.data && Array.isArray(doc.data.data.results) ? doc.data.data.results : []
    const ids = rows.filter(s => _isOperationalStationStatus(s.status)).map(s => s.id).filter(id => id != null)
    if (ids.length) return ids.slice(0, MAX_STATION_DETAIL_SYNC)
  } catch (_) {}
  return DEFAULT_STATION_SYNC_IDS
}

async function syncCommonEndpoints() {
  // 生产环境限制：每小时最多15次请求（整个账户，包括小程序端和云函数）
  const year = new Date().getUTCFullYear()
  const yearStart = `${year}-01-01T00:00:00Z`
  const yearEnd = `${year + 1}-01-01T00:00:00Z`

  // 空间站清单动态解析（1 次 API 调用），新站自动进详情同步
  const stationIds = await resolveActiveStationIds()
  // 设计策略：
  // - 云函数每3小时执行1次，每次最多使用15次API调用（充分利用限制）：
  //   * /launches/upcoming/ 分页最多5次（最多500条）
  //   * /launches/previous/ 分页最多4次（最多400条）
  //   * /events/upcoming/ 分页最多2次（最多200条）
  //   * /updates/ 分页最多2次（最多200条）
  //   * /articles/ 分页最多1次（最多100条，航天事件API无限制但统一管理）
  //   = 高时效主数据同步不再包含 /agencies/，agencies 改由独立 action 低频全量同步
  // - 小程序端：优先从缓存读取
  const endpoints = [
    // 优化执行顺序：先执行数据量小的端点，最后执行数据量大的端点
    // 这样可以确保在时间限制内尽可能多地完成同步
    
    // 空间站详情（数据量极小，动态清单，优先执行）
    ...stationIds.map(id => ({
      url: `/space_stations/${id}/`,
      params: { format: 'json' },
      priority: 0,
      apiBase: null,
      fetchAll: false,
      maxPages: 1,
      maxApiCalls: 1
    })),
    // 对接事件（筛选当前停靠，数据量小）
    {
      url: '/docking_events/',
      params: { limit: 50, offset: 0, ordering: '-docking', format: 'json' },
      priority: 0,
      apiBase: null,
      fetchAll: true,
      maxPages: 1,
      maxApiCalls: 1
    },
    // 航天事件API（数据量小，优先执行）
    {
      url: '/articles/',
      params: { format: 'json', limit: 100, offset: 0, ordering: '-published_at' },
      priority: 2,
      apiBase: SPACEFLIGHT_NEWS_API,
      fetchAll: true, // 启用分页请求
      maxPages: 1, // 最多1页，最多100条数据（航天事件API无限制，但为了统一管理先给1次）
      maxApiCalls: 1 // 最多1次API调用
    },
    // 事件列表（数据量中等）
    {
      url: '/events/upcoming/',
      params: { limit: 100, offset: 0 },
      priority: 3,
      apiBase: null,
      fetchAll: true, // 启用分页请求
      maxPages: 2, // 最多2页，最多200条数据
      maxApiCalls: 2 // 最多2次API调用
    },
    // 事件列表（数据量中等）
    {
      url: '/updates/',
      params: { limit: 100, offset: 0 },
      priority: 4,
      apiBase: null,
      fetchAll: true, // 启用分页请求
      maxPages: 1, // 最多1页，最多100条数据（为统计预留配额）
      maxApiCalls: 1 // 最多1次API调用
    },
    // 已完成的任务（数据量大，放在后面）
    {
      url: '/launches/previous/',
      params: { limit: 100, offset: 0, ordering: '-net', mode: 'detailed', format: 'json' },
      priority: 5,
      apiBase: null,
      fetchAll: true, // 启用分页请求
      maxPages: 2, // 最多2页，最多200条数据
      maxApiCalls: 2 // 最多2次API调用
    },
    // 即将发射的任务（数据量最大，放在最后执行）
    // 启用分页请求模式，最多4页（每页100条，共400条），为统计预留配额
    {
      url: '/launches/upcoming/',
      params: { limit: 100, offset: 0, ordering: 'net', mode: 'detailed', format: 'json', hide_recent_previous: true },
      priority: 6, // 改为最低优先级，最后执行
      apiBase: null, // 使用默认的LAUNCH_LIBRARY_API
      fetchAll: true, // 启用分页请求
      maxPages: 4, // 最多4页，最多400条数据
      maxApiCalls: 4 // 最多4次API调用
    },
    // 发射统计：已收敛到 syncLaunchStats() 写入 launch_stats 集合
    // 这里不再缓存 count-only 端点，避免把未发射(upcoming)混入口径
    // 如需统计数据请读取 launch_stats/stats_${year}
    
  ]
  
  // 按优先级排序
  endpoints.sort((a, b) => a.priority - b.priority)

  const results = []
  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 480000 // 最大执行时间480秒（8分钟），留20秒缓冲（云函数超时设置为500秒）
  
  for (const endpoint of endpoints) {
    // 检查是否接近超时
    const elapsed = Date.now() - startTime
    if (elapsed > MAX_EXECUTION_TIME) {
      results.push({
        url: endpoint.url,
        success: false,
        error: '执行时间不足，已跳过'
      })
      continue
    }
    
    try {
      // 串行执行，避免并发过多
      // 如果启用分页请求全部数据，使用更长的超时时间（180秒，因为可能需要多页请求且数据量大）
      // 单次请求给90秒
      const timeout = endpoint.fetchAll ? 180000 : 90000
      const result = await Promise.race([
        syncAPIEndpoint(
          endpoint.url, 
          endpoint.params, 
          endpoint.apiBase, 
          endpoint.fetchAll || false,
          endpoint.maxPages || 5, // 默认最多5页
          endpoint.maxApiCalls || 5 // 默认最多5次API调用
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('单个端点超时')), timeout)
        )
      ])
      
      results.push({
        url: endpoint.url,
        ...result
      })
    } catch (error) {
      // 如果单个端点失败，记录错误但继续处理下一个
      results.push({
        url: endpoint.url,
        success: false,
        error: error.message
      })
    }
    
    // 减少延迟时间到200ms，加快整体执行速度
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  return results
}

/**
 * 同步expedition详情（动态获取空间站的active_expeditions ID）
 * 从已缓存的空间站数据中提取expedition ID，然后同步详情
 */
async function syncExpeditionDetails() {
  const startedAt = Date.now()
  const expeditionIds = []
  
  try {
    // 从云数据库读取已缓存的空间站数据（动态清单，与 syncCommonEndpoints 同源）
    const stationIds = await readSyncedStationIds()

    for (const stationId of stationIds) {
      const cacheKey = `api_cache_/space_stations/${stationId}/_${JSON.stringify({ format: 'json' })}`
      const cached = await db.collection('space_devs_cache').doc(cacheKey).get().catch(() => null)
      
      if (cached && cached.data && cached.data.data) {
        const stationData = cached.data.data
        if (stationData.active_expeditions && Array.isArray(stationData.active_expeditions)) {
          stationData.active_expeditions.forEach(exp => {
            if (exp && exp.id) {
              expeditionIds.push(exp.id)
            }
          })
        }
      }
    }
    
    if (expeditionIds.length === 0) {
      return {
        success: true,
        message: '没有找到需要同步的expedition',
        expeditionIds: [],
        elapsedMs: Date.now() - startedAt
      }
    }
    
    console.log(`找到 ${expeditionIds.length} 个expedition需要同步:`, expeditionIds)
    
    // 同步每个expedition的详情
    const results = []
    for (const id of expeditionIds) {
      try {
        const result = await syncAPIEndpoint(
          `/expeditions/${id}/`,
          { format: 'json' },
          null,
          false,
          1,
          1
        )
        results.push({
          id,
          ...result
        })
        // 短暂延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        results.push({
          id,
          success: false,
          error: error.message
        })
      }
    }
    
    return {
      success: true,
      expeditionIds,
      results,
      elapsedMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      elapsedMs: Date.now() - startedAt
    }
  }
}

/**
 * LL2 detailed 模式发射商列表项 → 与 normal 模式同构的精简记录
 * 额外保留发射统计字段（total_launch_count 等），供前端按总发射次数排序；
 * 剔除 detailed 模式的其余重字段，控制缓存文档体积
 */
function slimAgencyListItem(a) {
  if (!a || a.id == null) return null
  return {
    id: a.id,
    url: a.url || '',
    name: a.name || '',
    abbrev: a.abbrev || '',
    type: a.type || null,
    featured: !!a.featured,
    country: a.country || [],
    description: a.description || '',
    administrator: a.administrator || null,
    founding_year: a.founding_year || null,
    launchers: a.launchers || '',
    spacecraft: a.spacecraft || '',
    parent: a.parent || null,
    image: a.image ? { image_url: a.image.image_url, thumbnail_url: a.image.thumbnail_url, name: a.image.name, credit: a.image.credit } : null,
    logo: a.logo ? { image_url: a.logo.image_url, thumbnail_url: a.logo.thumbnail_url } : null,
    total_launch_count: a.total_launch_count != null ? a.total_launch_count : null,
    successful_launches: a.successful_launches != null ? a.successful_launches : null,
    failed_launches: a.failed_launches != null ? a.failed_launches : null,
    pending_launches: a.pending_launches != null ? a.pending_launches : null,
    attempted_landings: a.attempted_landings != null ? a.attempted_landings : null,
    successful_landings: a.successful_landings != null ? a.successful_landings : null
  }
}

/**
 * 独立同步发射商（Agencies）全量数据
 * 提供 featured 首屏缓存、分页缓存和聚合缓存
 * 用 mode=detailed 拉取（含发射统计）再瘦身入库；缓存 key 与 normal 模式保持一致，前端无感
 */
async function syncAgencies() {
  const startedAt = Date.now()
  const pageSize = 100
  const maxPages = 8  // 最多 8 页 800 条；实际不足时提前 break，无额外请求
  const pageResults = []
  const allResults = []

  // 分页同步发射商数据
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize
    const params = { format: 'json', limit: pageSize, offset }

    console.log(`正在同步第 ${page + 1} 页，offset=${offset}...`)
    // 缓存 key 不含 mode（与前端 getCacheKey 规则一致），拉取时才加 mode=detailed
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = params[key]
        return sorted
      }, {})
    const cacheKey = `api_cache_/agencies/_${JSON.stringify(sortedParams)}`

    try {
      const fetchUrl = `${LAUNCH_LIBRARY_API}/agencies/?format=json&mode=detailed&limit=${pageSize}&offset=${offset}`
      const data = await httpsGetJson(fetchUrl, 25000)
      const pageItems = (data && Array.isArray(data.results) ? data.results : [])
        .map(slimAgencyListItem)
        .filter(Boolean)

      const payload = {
        count: (data && data.count) || pageItems.length,
        next: (data && data.next) || null,
        previous: (data && data.previous) || null,
        results: pageItems
      }
      await saveToCloudDB(cacheKey, payload)
      pageResults.push({ page: page + 1, offset, success: true, count: pageItems.length })

      console.log(`第 ${page + 1} 页获取到 ${pageItems.length} 条数据`)
      allResults.push(...pageItems)

      // 如果返回的数据少于pageSize，说明已经是最后一页
      if (pageItems.length < pageSize || !data.next) {
        console.log(`已到达最后一页，总共 ${allResults.length} 条数据`)
        break
      }
    } catch (error) {
      console.error(`第 ${page + 1} 页同步失败:`, error.message)
      pageResults.push({ page: page + 1, offset, success: false, error: error.message })
      break
    }

    // 延迟200ms，避免请求过快
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  console.log(`总共收集到 ${allResults.length} 条发射商数据`)

  // 生成featured列表（重点机构）
  const featuredItems = allResults.filter(item => !!item.featured)
  const featuredPayload = {
    count: featuredItems.length,
    next: null,
    previous: null,
    results: featuredItems.slice(0, 50)
  }
  const featuredKey = `api_cache_/agencies/_${JSON.stringify({ featured: true, format: 'json', limit: 50, offset: 0 })}`
  await saveToCloudDB(featuredKey, featuredPayload)
  console.log(`Featured列表已保存: ${featuredPayload.results.length} 条`)

  // 生成聚合列表（前400条）
  const aggregatePayload = {
    count: allResults.length,
    next: allResults.length > 400 ? 'has_more' : null,
    previous: null,
    results: allResults.slice(0, 400)
  }
  const aggregateKey = `api_cache_/agencies/_${JSON.stringify({ format: 'json', limit: 400, offset: 0 })}`
  await saveToCloudDB(aggregateKey, aggregatePayload)
  console.log(`聚合列表已保存: ${aggregatePayload.results.length} 条`)

  return {
    success: true,
    total: allResults.length,
    featured: featuredPayload.results.length,
    aggregate: aggregatePayload.results.length,
    pages: pageResults,
    elapsedMs: Date.now() - startedAt
  }
}

/**
 * 直连抓取 starbase.texas.gov HTML（原始字节 → utf8 字符串）
 * @returns {Promise<{ success: boolean, html?: string, error?: string, statusCode?: number }>}
 */
function fetchStarbaseHtmlDirect() {
  return new Promise((resolve) => {
    const https = require('https')
    const zlib = require('zlib')
    const options = {
      hostname: 'www.starbase.texas.gov',
      path: '/beach-road-access',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, identity',
        'Connection': 'keep-alive'
      },
      timeout: 8000
    }

    const req = https.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location || ''
        resolve({ success: false, error: `Redirect ${res.statusCode} → ${loc}`, statusCode: res.statusCode })
        return
      }

      const chunks = []
      const encoding = (res.headers['content-encoding'] || '').toLowerCase()
      const stream = (encoding === 'gzip') ? res.pipe(zlib.createGunzip())
        : (encoding === 'deflate') ? res.pipe(zlib.createInflate())
        : res

      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => {
        try {
          const html = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            resolve({
              success: false,
              error: `HTTP ${res.statusCode}`,
              statusCode: res.statusCode,
              htmlLen: html.length,
              htmlPreview: html.substring(0, 500)
            })
            return
          }
          if (html.length < 100) {
            resolve({ success: false, error: '响应内容过短', htmlLen: html.length, htmlPreview: html })
            return
          }
          resolve({ success: true, html })
        } catch (e) {
          resolve({ success: false, error: 'Stream decode error: ' + e.message })
        }
      })
      stream.on('error', (e) => {
        resolve({ success: false, error: 'Stream error: ' + e.message })
      })
    })

    req.on('error', (e) => resolve({ success: false, error: 'Request error: ' + e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '请求超时(8s)' }) })
    req.end()
  })
}

/**
 * 经 Cloudflare Worker（或其它 HTTPS中转）抓取同一页面 HTML。
 * 云函数环境变量：STARBASE_FETCH_PROXY_URL（完整 URL，如 https://xxx.workers.dev）、STARBASE_FETCH_PROXY_SECRET
 */
function fetchStarbaseHtmlFromProxy(proxyUrl, secret) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(proxyUrl)
    } catch (e) {
      resolve({ success: false, error: '无效的 STARBASE_FETCH_PROXY_URL' })
      return
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      resolve({ success: false, error: '中转 URL 须为 http(s)' })
      return
    }
    const isHttps = u.protocol === 'https:'
    const mod = isHttps ? require('https') : require('http')
    const port = u.port || (isHttps ? 443 : 80)
    const pathWithQuery = u.pathname + (u.search || '')

    const options = {
      hostname: u.hostname,
      port,
      path: pathWithQuery || '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StarbaseSync/1.0)',
        Accept: 'text/html,*/*',
        Authorization: `Bearer ${secret}`,
        Connection: 'close'
      },
      timeout: 15000
    }

    const req = mod.request(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode === 401) {
          resolve({ success: false, error: '中转鉴权失败(401)，请核对 STARBASE_FETCH_PROXY_SECRET 与 Worker 密钥' })
          return
        }
        if (res.statusCode !== 200) {
          resolve({
            success: false,
            error: `中转 HTTP ${res.statusCode}`,
            htmlPreview: body.substring(0, 200)
          })
          return
        }
        if (body.length < 100) {
          resolve({ success: false, error: '中转响应过短' })
          return
        }
        resolve({ success: true, html: body })
      })
    })
    req.on('error', (e) => resolve({ success: false, error: '中转请求错误: ' + e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: '中转超时(15s)' })
    })
    req.end()
  })
}

function isStarbaseDnsFailure(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') return false
  return /ENOTFOUND|EAI_AGAIN|getaddrinfo|not known|NXDOMAIN/i.test(errorMsg)
}

/**
 * 从 starbase.texas.gov/beach-road-access 抓取封路/海滩状态
 * 页面结构包含：通知栏(Road Delay/Beach Closure)、Beach Access Status、Road Updates、PUBLIC NOTICE
 *
 * DNS 失败时：若已配置 STARBASE_FETCH_PROXY_URL + STARBASE_FETCH_PROXY_SECRET，则经 Worker 再试（见仓库 workers/starbase-texas-proxy.js）
 */
async function fetchStarbaseGovStatus() {
  const proxyUrl = String(process.env.STARBASE_FETCH_PROXY_URL || '').trim()
  const proxySecret = String(process.env.STARBASE_FETCH_PROXY_SECRET || '').trim()

  // 腾讯云函数环境通常无法快速直连 starbase.texas.gov：已配置中转时优先走国内代理
  if (proxyUrl && proxySecret) {
    const via = await fetchStarbaseHtmlFromProxy(proxyUrl, proxySecret)
    if (via.success && via.html) {
      const parsed = parseStarbaseHtml(via.html)
      parsed.fetchVia = 'proxy'
      return parsed
    }
    const direct = await fetchStarbaseHtmlDirect()
    if (direct.success && direct.html) {
      const parsed = parseStarbaseHtml(direct.html)
      parsed.fetchVia = 'direct'
      return parsed
    }
    return {
      success: false,
      error: `中转失败(${via.error || 'unknown'})；直连失败(${direct.error || 'unknown'})`
    }
  }

  const direct = await fetchStarbaseHtmlDirect()
  if (direct.success && direct.html) {
    const parsed = parseStarbaseHtml(direct.html)
    parsed.fetchVia = 'direct'
    return parsed
  }

  return { success: false, error: direct.error || '未知错误' }
}

// ========== 助推器族谱同步（LL2 Launchers API + SpaceX 官方 API） ==========
const BOOSTER_CACHE_DURATION = 5.5 * 60 * 60 * 1000 // 5.5小时（定时器 6h 触发，确保每次都能执行）
const SPACEX_CORES_API = 'https://api.spacexdata.com/v4/cores'
const SPACEX_LAUNCHES_V4_API = 'https://api.spacexdata.com/v4/launches'
const LL2_LAUNCHERS_API = 'https://ll.thespacedevs.com/2.3.0/launchers/'

/**
 * 解析 ISO 8601 duration 为可读中文字符串
 * 例如 P22DT16H51M10S → "22天16时51分"
 */
function parseDuration(iso) {
  if (!iso) return ''
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return ''
  const parts = []
  if (m[1]) parts.push(m[1] + '天')
  if (m[2]) parts.push(m[2] + '时')
  if (m[3]) parts.push(m[3] + '分')
  return parts.join('') || (m[4] ? m[4] + '秒' : '')
}

/**
 * 从 LL2 Launchers API 分页拉取所有可回收助推器
 * 自带云数据库缓存（24小时），避免频繁消耗 LL2 速率配额（免费层 15次/小时）
 */
const LL2_LAUNCHERS_CACHE_KEY = '_ll2_launchers_cache'
const LL2_LAUNCHERS_CACHE_DURATION = 5.5 * 60 * 60 * 1000 // 5.5小时（与定时器频率对齐）

async function fetchAllLL2Launchers(forceRefresh) {
  // 先检查云数据库缓存
  if (!forceRefresh) {
    try {
      const cacheDoc = await db.collection('booster_genealogy').doc(LL2_LAUNCHERS_CACHE_KEY).get().catch(() => null)
      if (cacheDoc && cacheDoc.data && cacheDoc.data.cachedAt
          && (Date.now() - cacheDoc.data.cachedAt < LL2_LAUNCHERS_CACHE_DURATION)
          && Array.isArray(cacheDoc.data.results) && cacheDoc.data.results.length > 0) {
        return cacheDoc.data.results
      }
    } catch (_) {}
  }

  const allResults = []
  // 用 limit=200 减少分页请求次数（180条数据只需 1 次请求）
  // 注意不能加 flight_proven=true：LL2 该字段指「已复用飞行」，首飞即回收/损毁的箭
  // （如 LM-12A F1 / ZQ-3 F1 等中国箭）均为 false，加了会被整批排除
  let url = LL2_LAUNCHERS_API + '?is_placeholder=false&ordering=-flights&limit=200&format=json&mode=detailed'
  let page = 0
  while (url && page < 5) { // 最多 5 页（1000条）；仅当 LL2 返回 next 时才翻页，数据少时无额外请求
    const data = await Promise.race([
      httpsGetJson(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 launchers API 超时')), 35000))
    ])
    if (data && Array.isArray(data.results)) {
      allResults.push(...data.results)
    }
    url = data && data.next ? data.next : null
    page++
  }

  // 写入云数据库缓存（只保留关键字段，减少存储体积）
  if (allResults.length > 0) {
    try {
      const slimResults = allResults.map(r => ({
        id: r.id,
        url: r.url,
        serial_number: r.serial_number,
        flight_proven: r.flight_proven,
        status: r.status,
        image: r.image ? { image_url: r.image.image_url, thumbnail_url: r.image.thumbnail_url, credit: r.image.credit, name: r.image.name } : null,
        details: r.details,
        successful_landings: r.successful_landings,
        attempted_landings: r.attempted_landings,
        flights: r.flights,
        last_launch_date: r.last_launch_date,
        first_launch_date: r.first_launch_date,
        fastest_turnaround: r.fastest_turnaround,
        launcher_config: r.launcher_config ? { id: r.launcher_config.id, name: r.launcher_config.name, full_name: r.launcher_config.full_name } : null
      }))
      await db.collection('booster_genealogy').doc(LL2_LAUNCHERS_CACHE_KEY).set({
        data: { results: slimResults, cachedAt: Date.now(), count: slimResults.length }
      })
    } catch (_) {}
  }

  return allResults
}

// ========== 构型元数据同步（launcher_configurations → _config_meta） ==========
// 型号详情页/族谱国家筛选的数据源：制造商+国家代码+规格+构型级着陆统计等全部来自 LL2，纯数据驱动
const CONFIG_META_DOC_ID = '_config_meta'
const CONFIG_META_TTL = 24 * 60 * 60 * 1000 // 24 小时内不重复拉取同一构型
const LL2_LAUNCHER_CONFIGS_API = 'https://ll.thespacedevs.com/2.3.0/launcher_configurations/'

/** LL2 launcher_configuration 详情 → 落库精简记录 */
function slimLauncherConfigMeta(cfg) {
  if (!cfg || cfg.id == null) return null
  const m = cfg.manufacturer || {}
  return {
    id: cfg.id,
    name: cfg.name || '',
    full_name: cfg.full_name || cfg.name || '',
    alias: cfg.alias || '',
    variant: cfg.variant || '',
    reusable: cfg.reusable === true,
    active: cfg.active !== false,
    manufacturerName: m.name || '',
    manufacturerAbbrev: m.abbrev || '',
    countryCode: slimCountryCode(m.country) || '',
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
    fastestTurnaroundText: parseDuration(cfg.fastest_turnaround || ''),
    fetchedAt: Date.now()
  }
}

/**
 * 同步构型元数据到 booster_genealogy/_config_meta
 * 需要的构型来源：
 *   1) LL2 launcher_configurations/?reusable=true 全量清单（数据驱动主源）
 *      —— LL2 新增可回收型号（哪怕尚无箭实体、也未上榜 upcoming）自动建档，前端零改动
 *   2) 箭实体携带的 configId（LL2 launchers 的 launcher_config.id）
 *   3) upcoming 发射缓存（_slim_v5）里 configuration.reusable === true 的构型
 *      —— 让长十乙这类「官宣可回收但未首飞」的型号提前建档
 * 带 24h TTL 与单轮拉取预算，返回 configs 映射（id 字符串 → 精简记录）
 */
async function syncLauncherConfigMeta(boosterList, forceRefresh) {
  const collection = db.collection('booster_genealogy')
  const now = Date.now()

  // 1) 收集需要的 config id
  const neededIds = new Set()
  for (const b of boosterList) {
    if (b && b.configId != null) neededIds.add(Number(b.configId))
  }
  try {
    const upcomingResults = await _readLaunchResultsFromSpaceDevsDoc(
      db.collection('space_devs_cache'),
      '/launches/upcoming/',
      { limit: 100, offset: 0, ordering: 'net', mode: 'detailed', format: 'json', hide_recent_previous: true }
    )
    for (const launch of upcomingResults || []) {
      const cfg = launch && launch.rocket && launch.rocket.configuration
      if (cfg && cfg.reusable === true && cfg.id != null) neededIds.add(Number(cfg.id))
    }
  } catch (_) { /* upcoming 缓存不可用不影响主流程 */ }

  // 2) 读取现有元数据
  let existing = {}
  let existingUpdatedAt = 0
  try {
    const doc = await collection.doc(CONFIG_META_DOC_ID).get().catch(() => null)
    if (doc && doc.data && doc.data.configs) {
      existing = doc.data.configs
      existingUpdatedAt = doc.data.updatedAt || 0
    }
  } catch (_) {}

  const isFresh = !forceRefresh && (now - existingUpdatedAt < CONFIG_META_TTL)
  const fetched = {}

  // 2.5) 全量可回收构型清单（TTL 到期才拉，detailed 列表模式 1~3 次请求覆盖全部字段，
  //      比逐 id 拉详情省配额）：LL2 侧新增可回收型号自动进档，无需改代码
  if (!isFresh) {
    try {
      let listUrl = `${LL2_LAUNCHER_CONFIGS_API}?reusable=true&is_placeholder=false&mode=detailed&limit=100&format=json`
      let listPage = 0
      while (listUrl && listPage < 3) {
        const data = await httpsGetJson(listUrl, 25000)
        const rows = data && Array.isArray(data.results) ? data.results : []
        for (const cfg of rows) {
          const slim = slimLauncherConfigMeta(cfg)
          if (slim) {
            fetched[String(slim.id)] = slim
            neededIds.add(Number(slim.id))
          }
        }
        listUrl = data && data.next ? data.next : null
        listPage++
      }
    } catch (e) {
      console.warn('[ConfigMeta] reusable list fetch failed:', e.message)
    }
  }

  // 3) 计算剩余待拉取列表（全量清单已覆盖的跳过；TTL 内且已存在的跳过），带单轮预算防超时/配额
  const toFetch = [...neededIds].filter(id => !fetched[String(id)] && !(isFresh && existing[String(id)]))
  // 预算内优先补齐缺失的构型，已有的（仅刷新）排后，避免强刷时反复拉同一批
  toFetch.sort((a, b) => (existing[String(a)] ? 1 : 0) - (existing[String(b)] ? 1 : 0))

  const MAX_CONFIG_FETCH_PER_RUN = 12
  const CONFIG_FETCH_CONCURRENCY = 4
  const fetchList = toFetch.slice(0, MAX_CONFIG_FETCH_PER_RUN)
  for (let ci = 0; ci < fetchList.length; ci += CONFIG_FETCH_CONCURRENCY) {
    const chunk = fetchList.slice(ci, ci + CONFIG_FETCH_CONCURRENCY)
    await Promise.all(chunk.map(async (id) => {
      try {
        const cfg = await httpsGetJson(`${LL2_LAUNCHER_CONFIGS_API}${id}/?format=json`, 20000)
        const slim = slimLauncherConfigMeta(cfg)
        if (slim) fetched[String(slim.id)] = slim
      } catch (e) {
        console.warn('[ConfigMeta] fetch config', id, 'failed:', e.message)
      }
    }))
  }

  // 4) 合并（保留旧记录，新拉取的覆盖；COS 镜像地址与中文简介从旧记录继承，避免刷新时丢失）
  for (const id of Object.keys(fetched)) {
    const old = existing[id]
    if (!old) continue
    if (old.cosImageUrl && !fetched[id].cosImageUrl) {
      fetched[id].cosImageUrl = old.cosImageUrl
    }
    // 简介原文没变 → 直接继承已有译文，避免重复机翻
    if (old.descriptionZh && old.description === fetched[id].description) {
      fetched[id].descriptionZh = old.descriptionZh
    }
  }
  const merged = Object.assign({}, existing, fetched)

  // 5) 补齐中文简介（Worker 机翻，带单轮预算；失败留空下轮再试）
  const translatedCount = await translateConfigDescriptions(merged)

  // 6) 有新拉取或新译文才写库
  if (Object.keys(fetched).length === 0 && translatedCount === 0) return merged
  try {
    await collection.doc(CONFIG_META_DOC_ID).set({
      data: { configs: merged, updatedAt: now, count: Object.keys(merged).length }
    })
  } catch (e) {
    console.warn('[ConfigMeta] write failed:', e.message)
  }
  return merged
}

/** 为缺少中文简介的构型补翻译（每轮预算 10 条、并发 3，结果落库长期复用） */
async function translateConfigDescriptions(configsMap) {
  const CONFIG_DESC_TRANSLATE_BUDGET = 10
  const CONFIG_DESC_TRANSLATE_CONCURRENCY = 3
  const targets = []
  for (const id of Object.keys(configsMap)) {
    if (targets.length >= CONFIG_DESC_TRANSLATE_BUDGET) break
    const c = configsMap[id]
    if (c && c.description && !c.descriptionZh) targets.push(c)
  }
  if (targets.length === 0) return 0

  let done = 0
  for (let i = 0; i < targets.length; i += CONFIG_DESC_TRANSLATE_CONCURRENCY) {
    const chunk = targets.slice(i, i + CONFIG_DESC_TRANSLATE_CONCURRENCY)
    await Promise.all(chunk.map(async (c) => {
      const zh = await translateTextToZh(c.description)
      if (zh) { c.descriptionZh = zh; done++ }
    }))
  }
  console.log('[ConfigMeta] 简介翻译完成:', done, '/', targets.length)
  return done
}

function _containsChinese(s) {
  return /[\u4e00-\u9fff]/.test(s || '')
}

/** 英文文本 → 简体中文（走 api.marsx.com.cn Worker /translate，边缘缓存 24h） */
async function translateTextToZh(text) {
  if (!text) return ''
  if (_containsChinese(text)) return text
  try {
    const res = await httpsPostJson(IMG_PROXY_BASE + '/translate', { text: text }, 15000)
    const zh = res && res.translated ? String(res.translated).trim() : ''
    if (zh && _containsChinese(zh)) return zh
  } catch (e) {
    console.warn('[ConfigMeta] 翻译失败:', e.message)
  }
  return ''
}

/**
 * 补全飞行历史：对 flights > flightHistory.length 的助推器，
 * 通过 LL2 Previous Launches API 拉取 SpaceX 历史发射，匹配 serial_number 补全记录。
 * 使用云数据库缓存避免重复拉取（缓存 7 天，因为历史数据不会变）。
 */
const FLIGHT_HISTORY_CACHE_KEY = '_flight_history_cache'
const FLIGHT_HISTORY_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24小时（历史数据变化极慢）

async function _fillMissingFlightHistory(boosterBySerial, boosterList, forceRefresh) {
  // 增量模式：每次只拉 1 页（100 条），记录进度到数据库，多次定时器调用逐步补全
  const needFill = boosterList.filter(b => b.flights > b.flightHistory.length && b.flights - b.flightHistory.length > 2)
  if (needFill.length === 0) return

  const collection = db.collection('booster_genealogy')

  // 读取进度文档（记录上次拉到第几页、下一页 URL）
  let progress = { page: 0, nextUrl: null, lastRunAt: 0, completed: false }
  try {
    const pDoc = await collection.doc('_flight_history_progress').get().catch(() => null)
    if (pDoc && pDoc.data) progress = pDoc.data
  } catch (_) {}

  // 如果上次已标记完成，且距上次不到 6 小时，直接用缓存补全
  if (progress.completed && !forceRefresh && (Date.now() - progress.lastRunAt < 6 * 60 * 60 * 1000)) {
    // 从缓存文档补全内存中的 flightHistory
    try {
      const cacheDoc = await collection.doc(FLIGHT_HISTORY_CACHE_KEY).get().catch(() => null)
      if (cacheDoc && cacheDoc.data && cacheDoc.data.histories) {
        for (const b of needFill) {
          const cached = cacheDoc.data.histories[b.serialNumber]
          if (cached && Array.isArray(cached) && cached.length > b.flightHistory.length) {
            b.flightHistory = cached
          }
        }
      }
    } catch (_) {}
    return
  }

  // 如果是强制刷新或首次，重置进度
  if (forceRefresh || !progress.nextUrl) {
    progress = { page: 0, nextUrl: null, lastRunAt: Date.now(), completed: false }
  }

  // 确定本次拉取的 URL
  const baseUrl = 'https://ll.thespacedevs.com/2.3.0/launches/previous/?search=SpaceX&mode=detailed&format=json&limit=100&ordering=-net'
  const fetchUrl = progress.nextUrl || baseUrl
  const maxPagesPerRun = 2

  let allLaunches = []
  let nextUrl = null
  let currentPage = progress.page

  for (let i = 0; i < maxPagesPerRun; i++) {
    const url = i === 0 ? fetchUrl : nextUrl
    if (!url) break
    try {
      const data = await Promise.race([
        httpsGetJson(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      ])
      if (data && Array.isArray(data.results)) {
        allLaunches.push(...data.results)
      }
      nextUrl = data && data.next ? data.next : null
      currentPage++
    } catch (e) {
      console.warn('[Booster] _fillMissingFlightHistory page error:', e.message)
      break
    }
  }

  // 从拉取到的 launches 中提取飞行记录，直接写入对应助推器
  if (allLaunches.length > 0) {
    for (const launch of allLaunches) {
      const stages = (launch.rocket && launch.rocket.launcher_stage) || []
      if (!Array.isArray(stages)) continue
      for (const stage of stages) {
        if (!stage) continue
        const sn = stage.serial_number
          || (stage.launcher && stage.launcher.serial_number)
          || ''
        if (!sn || !boosterBySerial[sn]) continue

        const b = boosterBySerial[sn]
        const launchDate = launch.net || ''
        const missionName = launch.name || ''
        const statusAbbrev = launch.status && launch.status.abbrev || ''
        const isSuccess = statusAbbrev === 'Success' || statusAbbrev === 'Partial Failure'
        const isFailed = statusAbbrev === 'Failure'
        const successValue = isSuccess ? true : (isFailed ? false : null)

        const dateStr = launchDate.split('T')[0]
        const alreadyHas = b.flightHistory.some(f => {
          const fDate = (f.date || '').split('T')[0]
          return fDate === dateStr && f.mission === missionName
        })
        if (!alreadyHas && dateStr) {
          const launchId = launch.id || ''
          b.flightHistory.push({ mission: missionName, date: launchDate, success: successValue, launchId: String(launchId) })
        }
      }
    }

    // 排序
    for (const b of needFill) {
      b.flightHistory.sort((a, c) => (a.date || '').localeCompare(c.date || ''))
      if (b.flightHistory.length > 0) {
        b.firstFlight = b.flightHistory[0].date
        b.lastFlight = b.flightHistory[b.flightHistory.length - 1].date
      }
    }
  }

  // 保存进度
  const isCompleted = !nextUrl
  try {
    await collection.doc('_flight_history_progress').set({
      data: { page: currentPage, nextUrl: nextUrl, lastRunAt: Date.now(), completed: isCompleted }
    })
  } catch (_) {}

  // 写入飞行历史缓存（供下次快速补全）
  if (isCompleted || allLaunches.length > 0) {
    const newHistories = {}
    for (const b of needFill) {
      if (b.flightHistory.length >= 3) {
        newHistories[b.serialNumber] = b.flightHistory
      }
    }
    if (Object.keys(newHistories).length > 0) {
      try {
        await collection.doc(FLIGHT_HISTORY_CACHE_KEY).set({
          data: { histories: newHistories, cachedAt: Date.now(), count: Object.keys(newHistories).length }
        })
      } catch (e) {
        const trimmed = {}
        for (const key of Object.keys(newHistories)) {
          if (newHistories[key].length >= 10) trimmed[key] = newHistories[key]
        }
        try {
          await collection.doc(FLIGHT_HISTORY_CACHE_KEY).set({
            data: { histories: trimmed, cachedAt: Date.now(), count: Object.keys(trimmed).length }
          })
        } catch (_) {}
      }
    }
  }

  // 直接写入每个助推器文档的 flightHistory（独立于步骤 6 的主写入）
  for (const b of needFill) {
    if (b.flightHistory.length === 0) continue
    const docId = b.serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_')
    try {
      await collection.doc(docId).update({
        data: {
          flightHistory: b.flightHistory,
          firstFlight: b.firstFlight || '',
          lastFlight: b.lastFlight || ''
        }
      })
    } catch (e) {
      // update 失败（文档可能不存在），尝试 set 整个文档
      try {
        await collection.doc(docId).set({ data: { flightHistory: b.flightHistory, serialNumber: b.serialNumber, flights: b.flights, firstFlight: b.firstFlight, lastFlight: b.lastFlight } })
      } catch (_) {}
    }
  }

  console.log('[Booster] _fillMissingFlightHistory done: page', currentPage, 'launches:', allLaunches.length, 'completed:', isCompleted)
}

/**
 * 从 LL2 Launchers API + SpaceX 官方 API 拉取助推器数据
 * 写入 booster_genealogy 集合，覆盖所有可回收火箭（不限 SpaceX）
 */
async function syncBoosterGenealogy(forceRefresh = false) {
  const now = Date.now()
  const collection = db.collection('booster_genealogy')

  // 检查缓存
  if (!forceRefresh) {
    try {
      const meta = await collection.doc('_sync_meta').get().catch(() => null)
      if (meta && meta.data && meta.data.syncedAt && (now - meta.data.syncedAt < BOOSTER_CACHE_DURATION)) {
        return { success: true, message: '缓存有效，跳过同步', cacheAge: Math.round((now - meta.data.syncedAt) / 60000) + '分钟' }
      }
    } catch (_) {}
  }

  // 分步计时日志：定位卡点（此前出现过 900s 超时且无任何日志的情况）
  const bootTs = Date.now()
  const logStep = (msg) => console.log('[Booster]', msg, '(+' + Math.round((Date.now() - bootTs) / 1000) + 's)')
  // DB/网络调用软超时：超时返回 fallback 并记日志，不让单个调用拖死整个同步
  // 注意成功后要清掉计时器，否则会留下误导性的「软超时」日志
  const withSoftTimeout = (promise, ms, label, fallback) => new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn('[Booster] 软超时(' + ms + 'ms):', label)
      resolve(fallback)
    }, ms)
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } },
      (e) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          console.warn('[Booster] 调用失败:', label, e && e.message)
          resolve(fallback)
        }
      }
    )
  })

  try {
    // ── 步骤 1：从 SpaceX API 拉取所有 cores（10s 超时）──
    // SpaceX v4 API 已停止服务，允许失败后跳过，完全依赖 LL2 数据
    let cores = []
    try {
      cores = await fetchSpaceXCoresJson()
    } catch (e) {
      console.warn('[Booster] SpaceX cores API 不可用，跳过步骤1-2，将完全依赖 LL2 数据:', e.message)
    }
    logStep('步骤1-4 完成, cores=' + cores.length)

    // ── 步骤 2：拉取 launches 数据用于构建飞行历史 ──
    const launchMap = {}
    if (cores.length > 0) {
      try {
        const launches = await Promise.race([
          httpsGetJson(SPACEX_LAUNCHES_V4_API),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SpaceX launches API 超时')), 25000))
        ])
        if (Array.isArray(launches)) {
          for (const l of launches) {
            launchMap[l.id] = { name: l.name || '', date: l.date_utc || '', success: l.success }
          }
        }
      } catch (_) {}
    }

    // ── 步骤 3：只保留 Falcon 9/Heavy 助推器（B 编号） ──
    const falcon = cores.filter(c => c.serial && /^B\d{4}/.test(c.serial))

    // ── 步骤 4：转换并构建 boosterList ──
    const boosterList = []

    for (const c of falcon) {
      const totalFlights = (c.reuse_count || 0) + 1
      const totalLandings = (c.rtls_landings || 0) + (c.asds_landings || 0)
      const totalAttempts = (c.rtls_attempts || 0) + (c.asds_attempts || 0)

      const flightHistory = []
      if (Array.isArray(c.launches)) {
        for (const launchId of c.launches) {
          const l = launchMap[launchId]
          if (l) {
            flightHistory.push({ mission: l.name, date: l.date, success: l.success, launchId: String(launchId) })
          }
        }
      }
      flightHistory.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

      let status = 'unknown'
      const apiStatus = (c.status || '').toLowerCase()
      if (apiStatus === 'active') status = 'active'
      else if (apiStatus === 'retired') status = 'retired'
      else if (apiStatus === 'lost' || apiStatus === 'destroyed') status = 'destroyed'
      else if (apiStatus === 'expended') status = 'expended'

      const doc = {
        serialNumber: c.serial,
        flights: Math.max(totalFlights, flightHistory.length),
        status: status,
        reuseCount: c.reuse_count || 0,
        successfulLandings: totalLandings,
        attemptedLandings: totalAttempts,
        rtlsLandings: c.rtls_landings || 0,
        asdsLandings: c.asds_landings || 0,
        block: c.block || null,
        lastUpdate: c.last_update || '',
        firstFlight: flightHistory.length > 0 ? flightHistory[0].date : '',
        lastFlight: flightHistory.length > 0 ? flightHistory[flightHistory.length - 1].date : '',
        rocketFamily: c.block ? 'Falcon 9 Block ' + c.block : 'Falcon 9',
        flightHistory: flightHistory,
        updatedAt: now,
        syncedAt: now
      }

      boosterList.push(doc)
    }

    boosterList.sort((a, b) => b.flights - a.flights)

    // ── 步骤 5：用 LL2 缓存补充 2022 年后的新增飞行记录 ──
    const boosterBySerial = {}
    for (const b of boosterList) { boosterBySerial[b.serialNumber] = b }

    try {
      // 读取 LL2 launches 缓存：直读两个已知 cacheKey 文档。
      // 严禁用 _id 正则 where 扫描——space_devs_cache 有数百个大文档，
      // 全表扫描曾导致本函数卡死 900s 超时（且静默无日志）。
      const spaceDevsCol = db.collection('space_devs_cache')
      const upcomingResults = await withSoftTimeout(
        _readLaunchResultsFromSpaceDevsDoc(spaceDevsCol, '/launches/upcoming/',
          { limit: 100, offset: 0, ordering: 'net', mode: 'detailed', format: 'json', hide_recent_previous: true }),
        20000, '读取 upcoming 缓存', []
      )
      const previousResults = await withSoftTimeout(
        _readLaunchResultsFromSpaceDevsDoc(spaceDevsCol, '/launches/previous/',
          { limit: 100, offset: 0, ordering: '-net', mode: 'detailed', format: 'json' }),
        20000, '读取 previous 缓存', []
      )
      const cachedLaunchGroups = [upcomingResults || [], previousResults || []]
      logStep('步骤5 缓存读取完成, upcoming=' + (upcomingResults || []).length + ' previous=' + (previousResults || []).length)

      {
        for (const results of cachedLaunchGroups) {
          for (const launch of results) {
            // 只处理 SpaceX 发射
            const provider = launch.launch_service_provider
            if (!provider || (provider.name !== 'SpaceX' && provider.abbrev !== 'SpX')) continue

            const stages = (launch.rocket && launch.rocket.launcher_stage) || []
            if (!Array.isArray(stages)) continue

            for (const stage of stages) {
              if (!stage) continue
              // 从多个位置提取 serial_number
              let sn = stage.serial_number
                || (stage.launcher && stage.launcher.serial_number)
                || ''
              if (!sn && stage.landing && stage.landing.description) {
                const match = stage.landing.description.match(/\b(B\d{4})\b/)
                if (match) sn = match[1]
              }
              if (!sn) continue
              // 接受标准 B 编号 和 星舰编号（Booster X, SN X, Starhopper, Ship X）
              const isValidSerial = /^B\d{4}$/.test(sn)
                || /^Booster\s*\d+$/i.test(sn)
                || /^SN\d+$/i.test(sn)
                || /^Ship\s*\d+$/i.test(sn)
                || sn === 'Starhopper'
              if (!isValidSerial) continue

              const launchDate = launch.net || ''
              const missionName = launch.name || ''
              const statusAbbrev = launch.status && launch.status.abbrev || ''
              // 三态判断：成功 / 失败 / 待定（未来发射或状态未知）
              const isSuccess = statusAbbrev === 'Success' || statusAbbrev === 'Partial Failure'
              const isFailed = statusAbbrev === 'Failure'
              const isPending = !isSuccess && !isFailed // Go, TBD, TBC, In Flight 等都算待定
              // success 字段：true=成功, false=失败, null=待定/未知
              const successValue = isSuccess ? true : (isFailed ? false : null)

              // 从 LL2 获取权威的飞行次数
              const ll2Flights = typeof stage.flights === 'number' ? stage.flights
                : (stage.launcher && typeof stage.launcher.flights === 'number' ? stage.launcher.flights : 0)

              if (boosterBySerial[sn]) {
                // 已有助推器 → 用 LL2 的 flights 更新飞行次数（LL2 为权威来源）
                const b = boosterBySerial[sn]
                if (ll2Flights > 0) {
                  b.flights = ll2Flights
                  b.reuseCount = Math.max(0, ll2Flights - 1)
                }

                // 补充飞行记录
                const dateStr = launchDate.split('T')[0]
                const alreadyHas = b.flightHistory.some(f => {
                  const fDate = (f.date || '').split('T')[0]
                  return fDate === dateStr && f.mission === missionName
                })
                if (!alreadyHas && dateStr) {
                  b.flightHistory.push({
                    mission: missionName,
                    date: launchDate,
                    success: successValue,
                    launchId: String(launch.id || '')
                  })
                  b.flightHistory.sort((a, c) => (a.date || '').localeCompare(c.date || ''))
                }

                // 更新首飞末飞日期
                if (b.flightHistory.length > 0) {
                  b.firstFlight = b.flightHistory[0].date
                  b.lastFlight = b.flightHistory[b.flightHistory.length - 1].date
                }

                // 更新状态：有最近飞行记录 → active
                if (b.lastFlight) {
                  const lastDate = new Date(b.lastFlight)
                  const twoYearsAgo = new Date(now - 2 * 365 * 24 * 60 * 60 * 1000)
                  if (lastDate > twoYearsAgo && b.status !== 'destroyed' && b.status !== 'expended') {
                    b.status = 'active'
                  }
                }
              } else {
                // 新助推器（SpaceX v4 里没有的） → 新建
                // 根据编号判断火箭型号
                let rocketFamily = 'Falcon 9 Block 5'
                let blockNum = 5
                if (/^Booster\s*\d+$/i.test(sn)) {
                  rocketFamily = 'Super Heavy'
                  blockNum = null
                } else if (/^SN\d+$/i.test(sn) || sn === 'Starhopper' || /^Ship\s*\d+$/i.test(sn)) {
                  rocketFamily = 'Starship'
                  blockNum = null
                }
                const newBooster = {
                  serialNumber: sn,
                  flights: Math.max(1, ll2Flights),
                  status: 'active',
                  reuseCount: 0,
                  successfulLandings: 0,
                  attemptedLandings: 0,
                  rtlsLandings: 0,
                  asdsLandings: 0,
                  block: blockNum,
                  lastUpdate: '',
                  firstFlight: launchDate,
                  lastFlight: launchDate,
                  rocketFamily: rocketFamily,
                  flightHistory: [{ mission: missionName, date: launchDate, success: successValue, launchId: String(launch.id || '') }],
                  updatedAt: now,
                  syncedAt: now
                }
                boosterBySerial[sn] = newBooster
                boosterList.push(newBooster)
              }
            }
          }
        }
      }
    } catch (e) {
      // LL2 缓存补充失败不影响主流程
    }

    // ── 步骤 5.5：从 LL2 Launchers API 拉取所有可回收助推器（覆盖全厂商） ──
    try {
      const ll2Launchers = await fetchAllLL2Launchers(forceRefresh)
      for (const lnch of ll2Launchers) {
        const sn = lnch.serial_number || ''
        if (!sn) continue

        const statusMap = { 1: 'retired', 2: 'expended', 3: 'active', 4: 'unknown', 7: 'destroyed' }
        const ll2Status = (lnch.status && statusMap[lnch.status.id]) || 'unknown'
        const ll2Flights = lnch.flights || 0
        const imageUrl = (lnch.image && lnch.image.image_url) || ''
        const thumbnailUrl = (lnch.image && lnch.image.thumbnail_url) || ''
        const imageCredit = (lnch.image && lnch.image.credit) || ''
        const turnaround = lnch.fastest_turnaround || ''
        const turnaroundText = parseDuration(turnaround)
        const details = lnch.details || ''
        const ll2Id = lnch.id || null
        const ll2Url = lnch.url || ''
        const successfulLandings = lnch.successful_landings || 0
        const attemptedLandings = lnch.attempted_landings || 0
        const firstLaunchDate = lnch.first_launch_date || ''
        const lastLaunchDate = lnch.last_launch_date || ''
        const lnchConfigId = (lnch.launcher_config && lnch.launcher_config.id != null) ? lnch.launcher_config.id : null

        if (boosterBySerial[sn]) {
          // 已有助推器 → 用 LL2 数据丰富字段
          const b = boosterBySerial[sn]
          if (lnchConfigId != null) b.configId = lnchConfigId
          // LL2 的 flights 为权威来源（实时更新），直接覆盖 SpaceX v4 的冻结值
          if (ll2Flights > 0) {
            b.flights = ll2Flights
            b.reuseCount = Math.max(0, ll2Flights - 1)
          }
          b.imageUrl = imageUrl
          b.thumbnailUrl = thumbnailUrl
          b.imageCredit = imageCredit
          b.fastestTurnaround = turnaround
          b.fastestTurnaroundText = turnaroundText
          b.details = details || b.details || b.lastUpdate || ''
          b.ll2Id = ll2Id
          b.ll2Url = ll2Url
          // LL2 的着陆数据可能更新
          if (successfulLandings > b.successfulLandings) b.successfulLandings = successfulLandings
          if (attemptedLandings > b.attemptedLandings) b.attemptedLandings = attemptedLandings
          if (firstLaunchDate && !b.firstFlight) b.firstFlight = firstLaunchDate
          if (lastLaunchDate) b.lastFlight = lastLaunchDate
          if (ll2Status !== 'unknown') b.status = ll2Status
        } else {
          // 新助推器（非 SpaceX，如 Rocket Lab Electron、Blue Origin New Glenn 等）
          // 优先从 launcher_config 获取精确的火箭名称
          const lcfg = lnch.launcher_config || {}
          let rocketFamily = lcfg.full_name || lcfg.name || ''
          let manufacturer = ''

          // 从 launcher_config 推断厂商
          if (rocketFamily.toLowerCase().includes('electron')) {
            manufacturer = 'Rocket Lab'
          } else if (rocketFamily.toLowerCase().includes('falcon') || rocketFamily.toLowerCase().includes('starship')) {
            manufacturer = 'SpaceX'
          } else if (rocketFamily.toLowerCase().includes('new glenn') || rocketFamily.toLowerCase().includes('new shepard')) {
            manufacturer = 'Blue Origin'
          } else if (rocketFamily.toLowerCase().includes('long march') || rocketFamily.toLowerCase().includes('cz-')) {
            manufacturer = 'CASC'
          } else if (rocketFamily.toLowerCase().includes('zhuque') || rocketFamily.toLowerCase().includes('zq-')) {
            manufacturer = 'LandSpace'
          }

          // 如果 launcher_config 没有，从 details 和 image name 兜底推断
          if (!rocketFamily) {
            const detailsLower = (details || '').toLowerCase()
            const imgName = ((lnch.image && lnch.image.name) || '').toLowerCase()
            if (detailsLower.includes('electron') || imgName.includes('electron')) {
              rocketFamily = 'Electron'
              manufacturer = 'Rocket Lab'
            } else if (detailsLower.includes('new glenn') || imgName.includes('new glenn')) {
              rocketFamily = 'New Glenn'
              manufacturer = 'Blue Origin'
            } else if (detailsLower.includes('falcon')) {
              rocketFamily = 'Falcon 9'
              manufacturer = 'SpaceX'
            } else {
              rocketFamily = 'Unknown'
            }
          }

          // SpaceX 特殊编号处理
          if (/^B\d{4}$/.test(sn)) {
            if (!rocketFamily || rocketFamily === 'Unknown') rocketFamily = 'Falcon 9'
            manufacturer = 'SpaceX'
          } else if (/^Booster\s*\d+$/i.test(sn)) {
            if (!rocketFamily || rocketFamily === 'Unknown') rocketFamily = 'Super Heavy'
            manufacturer = 'SpaceX'
          }

          const newBooster = {
            serialNumber: sn,
            flights: ll2Flights || 1,
            status: ll2Status,
            reuseCount: Math.max(0, (ll2Flights || 1) - 1),
            successfulLandings: successfulLandings,
            attemptedLandings: attemptedLandings,
            rtlsLandings: 0,
            asdsLandings: 0,
            block: null,
            lastUpdate: '',
            firstFlight: firstLaunchDate,
            lastFlight: lastLaunchDate,
            rocketFamily: rocketFamily,
            manufacturer: manufacturer,
            flightHistory: [],
            imageUrl: imageUrl,
            thumbnailUrl: thumbnailUrl,
            imageCredit: imageCredit,
            fastestTurnaround: turnaround,
            fastestTurnaroundText: turnaroundText,
            details: details,
            ll2Id: ll2Id,
            ll2Url: ll2Url,
            configId: lnchConfigId,
            updatedAt: now,
            syncedAt: now
          }
          boosterBySerial[sn] = newBooster
          boosterList.push(newBooster)
        }
      }
    } catch (e) {
      // LL2 Launchers API 失败不影响主流程
      console.warn('[Booster] LL2 Launchers API error:', e.message)
    }
    logStep('步骤5.5 LL2 launchers 完成, boosterList=' + boosterList.length)

    // ── 步骤 5.1 已移至独立 action fillFlightHistory，不再在主同步中执行 ──

    // 确保所有 SpaceX 助推器都有 manufacturer 字段
    for (const b of boosterList) {
      if (!b.manufacturer) {
        if (/^B\d{4}$/.test(b.serialNumber)) b.manufacturer = 'SpaceX'
        else if (/^Booster\s*\d+$/i.test(b.serialNumber)) b.manufacturer = 'SpaceX'
        else if (/^SN\d+$/i.test(b.serialNumber) || b.serialNumber === 'Starhopper' || /^Ship\s*\d+$/i.test(b.serialNumber)) b.manufacturer = 'SpaceX'
        else b.manufacturer = ''
      }
    }

    // ── 步骤 5.55：同步构型元数据（_config_meta）并回填 configId / countryCode ──
    // countryCode 数据驱动（来自 LL2 构型 manufacturer.country），名称/厂商映射仅作兜底
    let configMetaCount = 0
    let configMetaMap = {}
    try {
      configMetaMap = await syncLauncherConfigMeta(boosterList, forceRefresh)
      configMetaCount = Object.keys(configMetaMap).length

      // 名称 → configId 反查表（SpaceX v4 来源的箭没有 LL2 launcher_config 关联，用 rocketFamily 名称兜底）
      const nameToConfigId = {}
      for (const cid of Object.keys(configMetaMap)) {
        const c = configMetaMap[cid]
        if (!c) continue
        if (c.full_name) nameToConfigId[String(c.full_name).toLowerCase()] = c.id
        if (c.name) nameToConfigId[String(c.name).toLowerCase()] = c.id
      }

      // 厂商 → 国家兜底映射（仅在构型元数据缺失时使用）
      const FALLBACK_COUNTRY = {
        'SpaceX': 'US', 'Blue Origin': 'US', 'Rocket Lab': 'US',
        'CASC': 'CN', 'LandSpace': 'CN', 'iSpace': 'CN', 'Space Pioneer': 'CN',
        'Deep Blue Aerospace': 'CN', 'Galactic Energy': 'CN', 'OrienSpace': 'CN', 'CAS Space': 'CN'
      }

      for (const b of boosterList) {
        if (b.configId == null && b.rocketFamily) {
          const cid = nameToConfigId[String(b.rocketFamily).toLowerCase()]
          if (cid != null) b.configId = cid
        }
        const cfgMeta = b.configId != null ? configMetaMap[String(b.configId)] : null
        if (cfgMeta) {
          if (cfgMeta.countryCode) b.countryCode = cfgMeta.countryCode
          if (cfgMeta.manufacturerName && !b.manufacturer) b.manufacturer = cfgMeta.manufacturerName
        }
        if (!b.countryCode) b.countryCode = FALLBACK_COUNTRY[b.manufacturer] || ''
      }
    } catch (e) {
      console.warn('[Booster] config meta sync error:', e.message)
    }
    logStep('步骤5.55 构型元数据完成, configMetaCount=' + configMetaCount)

    // 重新排序和统计
    boosterList.sort((a, b) => b.flights - a.flights)

    // ── 步骤 5.6：将助推器 + 构型图片下载到 COS（解决外网域名无法在小程序加载的问题） ──
    // 箭实体图与型号构型图共用同一套镜像逻辑：同一个映射表、同一个负缓存、同一个上传预算
    try {
      // 先读取已有的 COS 图片映射，避免重复下载
      let existingCosMap = {}
      try {
        const metaDoc = await collection.doc('_img_cos_map').get().catch(() => null)
        if (metaDoc && metaDoc.data && metaDoc.data.map) {
          existingCosMap = metaDoc.data.map
        }
      } catch (_) {}

      const MAX_UPLOADS_PER_SYNC = 30 // 每次同步最多下载 30 张，避免超时
      const IMG_FAIL_RETRY_INTERVAL = 24 * 60 * 60 * 1000 // 下载失败的源 24h 内不重试（图床可能被网络屏蔽）
      const newCosMap = Object.assign({}, existingCosMap)

      // 判断某个 key + 源图是否需要重新下载；命中已有 COS 直接复用
      // 返回 'reuse'（已有可用）| 'skip'（负缓存内）| 'fetch'（需下载）
      const resolveCosEntry = (key, sourceUrl, applyFn) => {
        const entry = existingCosMap[key]
        if (entry && entry.source === sourceUrl) {
          if (entry.cosUrl) {
            applyFn(entry.cosUrl)
            return 'reuse'
          }
          // 负缓存：该源图近期「经代理仍失败」，24h 内不再浪费 45s 重试
          // proxyTried 标记区分代理上线前的旧失败记录——旧记录立即重试（代理大概率能救回）
          if (entry.failedAt && entry.proxyTried && (Date.now() - entry.failedAt < IMG_FAIL_RETRY_INTERVAL)) {
            return 'skip'
          }
        }
        return 'fetch'
      }

      // 先收集本轮需要下载的（跳过已有且源图未变的、以及近期失败过的），再并发上传
      // task = { key: COS 映射键 / 文件名, sourceUrl, apply: 成功后回填 cosImageUrl 的函数 }
      const pendingUploads = []

      // 1) 型号构型图（族谱页型号卡片 + 型号详情页头图共用）
      let configCosDirty = false
      for (const cid of Object.keys(configMetaMap)) {
        if (pendingUploads.length >= MAX_UPLOADS_PER_SYNC) break
        const cfg = configMetaMap[cid]
        if (!cfg) continue
        const sourceUrl = cfg.image_url || cfg.thumbnail_url || ''
        if (!sourceUrl) continue
        const key = 'config_' + cfg.id
        const action = resolveCosEntry(key, sourceUrl, (url) => {
          if (cfg.cosImageUrl !== url) { cfg.cosImageUrl = url; configCosDirty = true }
        })
        if (action === 'fetch') {
          pendingUploads.push({
            key: key, sourceUrl: sourceUrl,
            apply: (url) => { cfg.cosImageUrl = url; configCosDirty = true }
          })
        }
      }

      // 2) 箭实体图
      for (const b of boosterList) {
        if (pendingUploads.length >= MAX_UPLOADS_PER_SYNC) break
        const sn = b.serialNumber
        if (!sn) continue

        // 优先用原图，没有就用缩略图
        const sourceUrl = b.imageUrl || b.thumbnailUrl || ''
        if (!sourceUrl) continue

        const action = resolveCosEntry(sn, sourceUrl, (url) => { b.cosImageUrl = url })
        if (action === 'fetch') {
          pendingUploads.push({
            key: sn, sourceUrl: sourceUrl,
            apply: (url) => { b.cosImageUrl = url }
          })
        }
      }

      // 并发 5 路下载并上传到 COS（原串行 30 张可能耗时 60-90s，是超时主因）
      // 每张图整体套 45s 墙钟硬超时：http 的 timeout 只算「空闲超时」，
      // 源站慢速滴流时永远不触发，曾导致同步整体挂死
      logStep('步骤5.6 图片上传开始, pending=' + pendingUploads.length)
      const UPLOAD_CONCURRENCY = 5
      for (let ui = 0; ui < pendingUploads.length; ui += UPLOAD_CONCURRENCY) {
        const chunk = pendingUploads.slice(ui, ui + UPLOAD_CONCURRENCY)
        await Promise.all(chunk.map(async (task) => {
          const cosUrl = await withSoftTimeout(
            uploadBoosterImageToCOS(task.sourceUrl, task.key),
            45000, '图片上传 ' + task.key, ''
          )
          if (cosUrl) {
            task.apply(cosUrl)
            newCosMap[task.key] = { cosUrl: cosUrl, source: task.sourceUrl, ts: Date.now() }
          } else {
            // 记录失败（负缓存），保留旧的成功记录不覆盖
            const prev = newCosMap[task.key]
            if (!prev || !prev.cosUrl) {
              newCosMap[task.key] = { cosUrl: '', source: task.sourceUrl, failedAt: Date.now(), proxyTried: true }
            }
          }
        }))
      }

      // 对于已有 COS 映射但本轮没处理的助推器/构型，补上 cosImageUrl
      for (const b of boosterList) {
        if (!b.cosImageUrl && newCosMap[b.serialNumber] && newCosMap[b.serialNumber].cosUrl) {
          b.cosImageUrl = newCosMap[b.serialNumber].cosUrl
        }
      }
      for (const cid of Object.keys(configMetaMap)) {
        const cfg = configMetaMap[cid]
        if (!cfg) continue
        const mapped = newCosMap['config_' + cfg.id]
        if (!cfg.cosImageUrl && mapped && mapped.cosUrl) {
          cfg.cosImageUrl = mapped.cosUrl
          configCosDirty = true
        }
      }

      // 构型的 cosImageUrl 有变化 → 回写 _config_meta（前端读的是这个文档）
      if (configCosDirty && Object.keys(configMetaMap).length > 0) {
        await withSoftTimeout(
          collection.doc(CONFIG_META_DOC_ID).set({
            data: { configs: configMetaMap, updatedAt: Date.now(), count: Object.keys(configMetaMap).length }
          }),
          20000, '_config_meta 回写', null
        )
      }

      // 保存映射表
      await collection.doc('_img_cos_map').set({ data: { map: newCosMap, updatedAt: Date.now() } })
    } catch (e) {
      // 图片 COS 上传失败不影响主流程
      console.warn('[Booster] COS image upload error:', e.message)
    }
    logStep('步骤5.6 图片上传完成')

    // ── 步骤 6：统一写入 booster_genealogy 集合 ──
    // 保留所有有效助推器（有 LL2 数据来源的都保留，不再用正则白名单过滤）
    const isValidBoosterSerial = (s, b) => {
      if (!s || s === '_sync_meta' || s === '_img_cos_map' || s === '_ll2_launchers_cache' || s === '_config_meta' || s === '_flight_history_progress') return false
      // SpaceX 标准编号
      if (/^B\d{4}$/.test(s)) return true
      if (/^Booster\s*\d+$/i.test(s)) return true
      if (/^SN\d+$/i.test(s)) return true
      if (/^Ship\s*\d+$/i.test(s)) return true
      if (s === 'Starhopper') return true
      // 有 LL2 来源的助推器（Electron 等纯数字编号）
      if (b && b.ll2Id) return true
      // 有明确厂商的
      if (b && b.manufacturer) return true
      return false
    }
    const validBoosters = boosterList.filter(b => isValidBoosterSerial(b.serialNumber, b))
    validBoosters.sort((a, b) => b.flights - a.flights)

    // 清理旧文档：只删除不在本轮 validBoosters 中的非元数据文档
    const validSerialSet = {}
    for (const b of validBoosters) {
      validSerialSet[b.serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_')] = true
    }
    try {
      // 只取 _id（集合里有 launchers 缓存/飞行历史等大文档，全量拉取又慢又耗内存）
      const oldDocs = await withSoftTimeout(
        collection.field({ _id: true }).limit(200).get(),
        20000, '清理旧文档查询', null
      )
      if (oldDocs && oldDocs.data) {
        for (const d of oldDocs.data) {
          if (d._id === '_sync_meta' || d._id === '_img_cos_map' || d._id === '_ll2_launchers_cache' || d._id === '_config_meta' || d._id === '_flight_history_progress') continue
          if (!validSerialSet[d._id]) {
            try { await collection.doc(d._id).remove() } catch (_) {}
          }
        }
      }
    } catch (_) {}

    // 并发 15 路写入（原来 180 条串行 get+update ≈ 360 次 DB 往返，是超时另一主因）
    logStep('步骤6 开始写入, valid=' + validBoosters.length)
    let written = 0
    const WRITE_CONCURRENCY = 15
    for (let wi = 0; wi < validBoosters.length; wi += WRITE_CONCURRENCY) {
      const chunk = validBoosters.slice(wi, wi + WRITE_CONCURRENCY)
      await Promise.all(chunk.map(async (b) => {
        b.updatedAt = now
        b.syncedAt = now
        const docId = b.serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_')

        // 主同步不覆盖 flightHistory，该字段由 _fillMissingFlightHistory 单独维护
        const dataToWrite = Object.assign({}, b)
        delete dataToWrite.flightHistory

        try {
          // 先尝试 update（绝大多数文档已存在，updatedAt 每轮必变所以 updated>0）
          // 文档不存在时 update 返回 updated:0（或抛错），再 set 新建
          const upRes = await collection.doc(docId).update({ data: dataToWrite }).catch(() => null)
          if (upRes && upRes.stats && upRes.stats.updated > 0) {
            written++
            return
          }
          dataToWrite.flightHistory = []
          await collection.doc(docId).set({ data: dataToWrite })
          written++
        } catch (_) {}
      }))
    }

    logStep('步骤6 写入完成, written=' + written)
    const activeCount = validBoosters.filter(b => b.status === 'active').length
    const manufacturers = [...new Set(validBoosters.map(b => b.manufacturer).filter(Boolean))]
    const countries = [...new Set(validBoosters.map(b => b.countryCode).filter(Boolean))]
    await collection.doc('_sync_meta').set({
      data: {
        syncedAt: now, totalBoosters: validBoosters.length, written,
        source: 'LL2 Launchers API + SpaceX v4 + LL2 cache',
        activeBoosters: activeCount,
        maxFlights: validBoosters.length > 0 ? validBoosters[0].flights : 0,
        manufacturers: manufacturers,
        countries: countries
      }
    })

    return {
      success: true, message: '助推器族谱同步完成（含全厂商）',
      source: 'LL2 Launchers API + SpaceX API v4',
      totalCores: cores.length, falconBoosters: falcon.length,
      totalAfterLL2: validBoosters.length, written,
      activeBoosters: activeCount,
      manufacturers: manufacturers,
      countries: countries,
      configMetaCount: configMetaCount,
      maxFlights: validBoosters.length > 0 ? validBoosters[0].flights : 0,
      topBoosters: validBoosters.slice(0, 5).map(b => b.serialNumber + '(' + b.flights + '次)')
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ========== 通用工具：下载二进制数据 ==========
function httpsGetBuffer(url, timeout) {
  timeout = timeout || 20000
  return new Promise(function (resolve, reject) {
    const https = require('https')
    const http = require('http')
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CloudFunction/1.0)' },
      timeout: timeout
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetBuffer(res.headers.location, timeout).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      const chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end', function () { resolve(Buffer.concat(chunks)) })
    })
    req.on('error', reject)
    req.on('timeout', function () { req.destroy(); reject(new Error('Buffer download timeout')) })
  })
}

// ========== 助推器图片下载到 COS ==========
const BOOSTER_IMG_COS_FOLDER = '助推器图片'
// LL2 图床（DigitalOcean Spaces）从腾讯云函数直连不通，走 Cloudflare Worker 的通用图片代理
// （cloudflare-worker/spacex-proxy.js 的 GET /image?url=...，带 24h 边缘缓存）
const IMG_PROXY_BASE = String(process.env.SPACEX_PROXY_URL || 'https://api.marsx.com.cn').trim().replace(/\/$/, '')

async function uploadBoosterImageToCOS(imageUrl, serialNumber) {
  if (!imageUrl || !serialNumber) return ''
  try {
    const cos = createCOSClient()
    // 代理优先，失败再直连原图兜底
    let buffer = null
    try {
      buffer = await httpsGetBuffer(IMG_PROXY_BASE + '/image?url=' + encodeURIComponent(imageUrl), 15000)
    } catch (e) { buffer = null }
    if (!buffer || buffer.length < 1000) {
      try {
        buffer = await httpsGetBuffer(imageUrl, 15000)
      } catch (e) { buffer = null }
    }
    if (!buffer || buffer.length < 1000) return '' // 太小可能是错误页面
    if (buffer.length > 5 * 1024 * 1024) return '' // 超过 5MB 跳过

    const ext = imageUrl.includes('.png') ? '.png' : '.jpg'
    const safeName = serialNumber.replace(/[^a-zA-Z0-9_-]/g, '_')
    const key = BOOSTER_IMG_COS_FOLDER + '/' + safeName + ext

    // COS 上传加 30s 超时保护，避免网络异常时无限挂起拖垮整个同步
    await Promise.race([
      new Promise(function (resolve, reject) {
        cos.putObject({
          Bucket: INSPIRATION_COS_BUCKET,
          Region: INSPIRATION_COS_REGION,
          Key: key,
          Body: buffer,
          ContentType: ext === '.png' ? 'image/png' : 'image/jpeg'
        }, function (err, data) { err ? reject(err) : resolve(data) })
      }),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('COS 上传超时')) }, 30000) })
    ])

    return INSPIRATION_COS_BASE_URL + encodeURI(key)
  } catch (e) {
    // 图片下载/上传失败不影响主流程
    return ''
  }
}

// ========== SpaceX 官网发射数据抓取（JSON API） ==========
const SPACEX_API_BASE = 'https://api.marsx.com.cn/spacex-api'
const SPACEX_STATS_CACHE_DURATION = 6 * 60 * 60 * 1000

function httpsGetJson(url, timeoutMs) {
  timeoutMs = timeoutMs || 25000
  return new Promise((resolve, reject) => {
    const https = require('https')
    const urlObj = new URL(url)
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; CloudFunction/1.0)'
    }
    // LL2 请求带上 API Token（与 fetchAPI 一致），走付费配额避免匿名 15次/小时限流
    const ll2Token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    if (ll2Token && ll2Token !== 'FILL_ME' && /thespacedevs\.com$/i.test(urlObj.hostname)) {
      headers['Authorization'] = `Token ${ll2Token}`
    }
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      timeout: timeoutMs
    }
    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          resolve(JSON.parse(text))
        } catch (e) { reject(new Error('JSON parse error: ' + e.message)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + timeoutMs + 'ms')) })
    req.end()
  })
}

/** POST JSON 并解析 JSON 响应（Worker /translate 等；POST 避免长文本 query 截断） */
function httpsPostJson(url, body, timeoutMs) {
  timeoutMs = timeoutMs || 15000
  return new Promise((resolve, reject) => {
    const https = require('https')
    const urlObj = new URL(url)
    const payload = JSON.stringify(body || {})
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; CloudFunction/1.0)'
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          resolve(JSON.parse(text))
        } catch (e) { reject(new Error('JSON parse error: ' + e.message)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + timeoutMs + 'ms')) })
    req.write(payload)
    req.end()
  })
}

/** SpaceX cores API：10s 超时、不重试（v4 API 已停服，避免拖慢主流程；箭实体数据完全依赖 LL2） */
async function fetchSpaceXCoresJson() {
  const CORES_TIMEOUT_MS = 10000
  const cores = await httpsGetJson(SPACEX_CORES_API, CORES_TIMEOUT_MS)
  if (Array.isArray(cores) && cores.length > 0) return cores
  throw new Error('SpaceX cores API 返回数据为空')
}

async function fetchSpaceXData() {
  const [stats, tiles] = await Promise.all([
    httpsGetJson(`${SPACEX_API_BASE}/launches-page-stats`),
    httpsGetJson(`${SPACEX_API_BASE}/launches-page-tiles`)
  ])

  const now = new Date()
  const upcoming = []
  const completed = []

  // SpaceX回收方式统计
  let recoveryDroneship = 0, recoveryLandingZone = 0, recoveryExpended = 0
  // D2C 星链统计
  let starlinkTotal = 0, d2cTotal = 0
  const recentD2C = []
  // SpaceX在轨任务
  const ongoingMissions = []

  if (Array.isArray(tiles)) {
    for (const t of tiles) {
      const item = {
        title: t.title || '',
        vehicle: t.vehicle || '',
        launchSite: t.launchSite || '',
        returnSite: t.returnSite || '',
        launchDate: t.launchDate || '',
        launchTime: t.launchTime || '',
        missionType: t.missionType || '',
        missionStatus: t.missionStatus || '',
        link: t.link || '',
        isLive: !!t.isLive,
        directToCell: !!t.directToCell,
        endDate: t.endDate || '',
        endTime: t.endTime || '',
        imageUrl: (t.imageDesktop && t.imageDesktop.formats && t.imageDesktop.formats.small && t.imageDesktop.formats.small.url) || (t.imageDesktop && t.imageDesktop.url) || '',
        imageMobileUrl: (t.imageMobile && t.imageMobile.formats && t.imageMobile.formats.small && t.imageMobile.formats.small.url) || (t.imageMobile && t.imageMobile.url) || ''
      }

      const dateStr = (t.launchDate || '') + 'T' + (t.launchTime || '00:00:00') + 'Z'
      const launchDate = new Date(dateStr)
      if (launchDate > now && t.missionStatus !== 'final') {
        upcoming.push(item)
      } else {
        completed.push(item)
      }

      // --- SpaceX回收方式统计 ---
      const site = (t.returnSite || '').toLowerCase()
      if (site.includes('droneship')) recoveryDroneship++
      else if (site.includes('landing')) recoveryLandingZone++
      else if (site.includes('expended')) recoveryExpended++

      // --- D2C 星链统计 ---
      if (t.missionType === 'starlink') {
        starlinkTotal++
        if (t.directToCell) {
          d2cTotal++
          recentD2C.push({ title: item.title, launchDate: item.launchDate, link: item.link, imageUrl: item.imageMobileUrl || item.imageUrl })
        }
      }

      // --- SpaceX在轨任务（有 endDate 且尚未结束） ---
      if (t.endDate) {
        const endDateObj = new Date(t.endDate + 'T' + (t.endTime || '23:59:59') + 'Z')
        if (endDateObj > now) {
          const daysInOrbit = Math.max(0, Math.floor((now - launchDate) / 86400000))
          const daysRemaining = Math.max(0, Math.floor((endDateObj - now) / 86400000))
          ongoingMissions.push({
            title: item.title, vehicle: item.vehicle, launchSite: item.launchSite,
            launchDate: item.launchDate, endDate: item.endDate, missionType: item.missionType,
            link: item.link, imageUrl: item.imageMobileUrl || item.imageUrl,
            daysInOrbit, daysRemaining
          })
        }
      }
    }
    upcoming.sort((a, b) => a.launchDate.localeCompare(b.launchDate))
    completed.sort((a, b) => b.launchDate.localeCompare(a.launchDate))
    recentD2C.sort((a, b) => b.launchDate.localeCompare(a.launchDate))
  }

  const recoveryTotal = recoveryDroneship + recoveryLandingZone + recoveryExpended

  return {
    success: true,
    totalLaunches: stats.totalLaunches || 0,
    totalLandings: stats.totalLandings || 0,
    totalReflights: stats.totalReflights || 0,
    upcoming: upcoming.slice(0, 20),
    recentCompleted: completed.slice(0, 20),
    totalTiles: (tiles && tiles.length) || 0,
    fetchedAt: Date.now(),
    // 预计算统计（零额外请求）
    d2cStats: {
      d2cTotal,
      starlinkTotal,
      ratio: starlinkTotal ? Math.round((d2cTotal / starlinkTotal) * 100) : 0,
      recentD2C: recentD2C.slice(0, 5)
    },
    recoveryStats: {
      total: recoveryTotal,
      droneship: recoveryDroneship,
      landingZone: recoveryLandingZone,
      expended: recoveryExpended
    },
    // 从 SpaceX tiles 的 endDate 推导的"在轨任务"几乎永远为空（CMS 字段语义错位）
    // 真正的在轨数据由下方 fetchOngoingSpaceXMissionsFromLL2() 接管，这里仅作 fallback
    ongoingMissions
  }
}

// 从 LL2 docking_events + spacecraft_flights 合成「SpaceX 当前在轨任务」
// 做法：
//  1) docking_events?mode=detailed → 取 departure==null 且 飞船配置 agency=SpaceX
//  2) spacecraft_flights?spacecraft__in_space=true&mission_end__isnull=true → 补充未对接段
//  注：用「飞船 spacecraft_config.agency」而非「launch_service_provider」过滤，
//      避免把 Falcon 9 发射的 Cygnus 等他厂飞船误判（detailed 模式下没有 manufacturer 字段，
//      只能依赖 agency = 飞船型号的运营/制造方）
async function fetchOngoingSpaceXMissionsFromLL2() {
  const SPACEX_NAMES = ['spacex', 'space exploration technologies']
  const isSpaceX = (name) => {
    if (!name) return false
    const n = String(name).toLowerCase()
    return SPACEX_NAMES.some(k => n.includes(k))
  }
  const isSpaceXSpacecraft = (cfg) => {
    if (!cfg) return false
    const cfgAgency = cfg.agency && cfg.agency.name
    const mfgName = cfg.manufacturer && cfg.manufacturer.name // detailed 模式可能没有，兜底
    return isSpaceX(cfgAgency) || isSpaceX(mfgName)
  }
  const result = []
  const seenLaunchIds = new Set()

  try {
    const dockingUrl = `${LAUNCH_LIBRARY_API}/docking_events/?ordering=-docking&limit=50&mode=detailed&format=json`
    const dockingResp = await fetchAPI(dockingUrl).catch(() => null)
    const dockingList = dockingResp && Array.isArray(dockingResp.results) ? dockingResp.results : []
    const now = Date.now()
    for (const ev of dockingList) {
      if (ev.departure) continue
      const fv = ev.flight_vehicle_chaser || ev.payload_flight_chaser
      const sc = fv && fv.spacecraft
      const launch = fv && fv.launch
      const cfg = sc && sc.spacecraft_config
      const lspName = launch && launch.launch_service_provider && launch.launch_service_provider.name
      // 关键：必须是 SpaceX 飞船（按 spacecraft_config.agency 判定）
      if (!isSpaceXSpacecraft(cfg)) continue
      const launchId = launch && launch.id
      if (launchId && seenLaunchIds.has(launchId)) continue
      if (launchId) seenLaunchIds.add(launchId)
      const netStr = launch && launch.net
      const launchDateMs = netStr ? Date.parse(netStr) : null
      const daysInOrbit = launchDateMs ? Math.max(0, Math.floor((now - launchDateMs) / 86400000)) : null
      const pad = launch && launch.pad
      const padName = (pad && (pad.name || (pad.location && pad.location.name))) || ''
      const image = (sc && sc.image && sc.image.image_url) || (launch && launch.image && launch.image.image_url) || ''
      const station = ev.space_station_target && ev.space_station_target.name
      result.push({
        title: (launch && launch.name) || (sc && sc.name) || 'SpaceX Mission',
        vehicle: (cfg && cfg.name) || (sc && sc.name) || '',
        launchSite: padName,
        launchDate: netStr ? netStr.split('T')[0] : '',
        endDate: '',
        missionType: station ? `docked@${station}` : 'spacex',
        link: launch && launch.slug ? `launch/${launch.slug}` : (launch && launch.id ? `launch/${launch.id}` : ''),
        imageUrl: image,
        daysInOrbit: daysInOrbit == null ? 0 : daysInOrbit,
        daysRemaining: -1, // -1 表示无返航计划，前端 wx:if="{{daysRemaining >= 0}}" 会自动隐藏
        spacecraft: (sc && sc.name) || '',
        station: station || '',
        dockedAt: ev.docking || '',
        operator: lspName || '',
        source: 'll2_docking'
      })
    }
  } catch (e) {
    console.warn('[OngoingMissions] docking_events fetch failed:', e && e.message)
  }

  // 补充：还在转移段、未对接的 SpaceX 飞船（例如刚发射的 CRS-34 上升段）
  try {
    const flightUrl = `${LAUNCH_LIBRARY_API}/spacecraft_flights/?spacecraft__in_space=true&mission_end__isnull=true&mode=detailed&limit=20&format=json`
    const flightResp = await fetchAPI(flightUrl).catch(() => null)
    const flightList = flightResp && Array.isArray(flightResp.results) ? flightResp.results : []
    const now = Date.now()
    for (const f of flightList) {
      if (f.mission_end) continue
      const sc = f.spacecraft
      const cfg = sc && sc.spacecraft_config
      const launch = f.launch
      const lspName = launch && launch.launch_service_provider && launch.launch_service_provider.name
      if (!isSpaceXSpacecraft(cfg)) continue
      const launchId = launch && launch.id
      if (launchId && seenLaunchIds.has(launchId)) continue
      if (launchId) seenLaunchIds.add(launchId)
      const netStr = launch && launch.net
      const launchDateMs = netStr ? Date.parse(netStr) : null
      const daysInOrbit = launchDateMs ? Math.max(0, Math.floor((now - launchDateMs) / 86400000)) : null
      const pad = launch && launch.pad
      const padName = (pad && (pad.name || (pad.location && pad.location.name))) || ''
      const image = (sc && sc.image && sc.image.image_url) || (launch && launch.image && launch.image.image_url) || ''
      result.push({
        title: (launch && launch.name) || (sc && sc.name) || 'SpaceX Mission',
        vehicle: (cfg && cfg.name) || (sc && sc.name) || '',
        launchSite: padName,
        launchDate: netStr ? netStr.split('T')[0] : '',
        endDate: '',
        missionType: f.destination ? `enroute:${String(f.destination).slice(0, 32)}` : 'spacex',
        link: launch && launch.slug ? `launch/${launch.slug}` : (launch && launch.id ? `launch/${launch.id}` : ''),
        imageUrl: image,
        daysInOrbit: daysInOrbit == null ? 0 : daysInOrbit,
        daysRemaining: -1,
        spacecraft: (sc && sc.name) || '',
        station: '',
        dockedAt: '',
        operator: lspName || '',
        source: 'll2_flight'
      })
    }
  } catch (e) {
    console.warn('[OngoingMissions] spacecraft_flights fetch failed:', e && e.message)
  }

  result.sort((a, b) => (b.launchDate || '').localeCompare(a.launchDate || ''))
  return result
}

// 即将进行的在轨任务/事件（不限 SpaceX）：Docking / Undocking / Berthing / EVA / Crew Handover 等
// 数据源：LL2 /events/upcoming/?mode=list（list 模式已含 description/image/location/type/date/vid_urls）
async function fetchUpcomingOrbitalEvents(limit = 8) {
  const ORBITAL_TYPE_NAMES = new Set([
    'docking', 'undocking', 'berthing', 'unberthing',
    'eva', 'spacewalk', 'crew handover', 'hatch closure', 'hatch opening',
    'orbital insertion', 'reboost'
  ])
  try {
    const url = `${LAUNCH_LIBRARY_API}/events/upcoming/?limit=50&mode=list&format=json`
    const resp = await fetchAPI(url).catch(() => null)
    const list = resp && Array.isArray(resp.results) ? resp.results : []
    // 该路径绕过 syncAPIEndpoint，同样补充中文字段
    try {
      await enrichEventsList({ results: list })
    } catch (translateErr) {
      console.warn('[translate-enrich orbital-events]', translateErr.message || translateErr)
    }
    const now = Date.now()
    const matched = []
    for (const ev of list) {
      const typeName = ev.type && ev.type.name ? String(ev.type.name).toLowerCase() : ''
      if (!ORBITAL_TYPE_NAMES.has(typeName)) continue
      const dateMs = ev.date ? Date.parse(ev.date) : NaN
      if (!isFinite(dateMs)) continue
      // 仅保留未来事件，向前再保留 6 小时容差（避免临近 T-0 抖动）
      if (dateMs < now - 6 * 60 * 60 * 1000) continue
      // 太远期事件（>18 个月）剔除：Juice/BepiColombo 等深空插入暂不展示在「即将进行」
      if (dateMs > now + 18 * 30 * 86400 * 1000) continue
      const image = ev.image && (ev.image.image_url || (ev.image.thumbnail_url || ''))
      const vid = Array.isArray(ev.vid_urls) && ev.vid_urls.length ? ev.vid_urls[0] : null
      matched.push({
        id: ev.id,
        slug: ev.slug || '',
        name: ev.name || '',
        nameZh: ev.nameZh || '',
        typeName: ev.type && ev.type.name ? ev.type.name : '',
        typeNameZh: (ev.type && ev.type.nameZh) || '',
        date: ev.date || '',
        dateMs,
        location: ev.location || '',
        locationZh: ev.locationZh || '',
        description: ev.description || '',
        descriptionZh: ev.descriptionZh || '',
        imageUrl: image || '',
        webcastUrl: vid && vid.url ? vid.url : '',
        webcastTitle: vid && vid.title ? vid.title : '',
        webcastPublisher: vid && vid.publisher ? vid.publisher : '',
        precision: (ev.date_precision && ev.date_precision.name) || ''
      })
    }
    matched.sort((a, b) => a.dateMs - b.dateMs)
    return matched.slice(0, limit)
  } catch (e) {
    console.warn('[UpcomingOrbitalEvents] fetch failed:', e && e.message)
    return []
  }
}

async function syncSpaceXLaunchStats(forceRefresh = false) {
  const now = Date.now()
  const collection = db.collection('spacex_launch_stats')
  const docId = 'spacex_official_live'

  if (!forceRefresh) {
    try {
      const lastSync = await collection.doc(docId).get().catch(() => null)
      if (lastSync && lastSync.data && lastSync.data.syncedAt && (now - lastSync.data.syncedAt < SPACEX_STATS_CACHE_DURATION)) {
        return { success: true, message: '缓存有效，跳过同步', cacheAge: Math.round((now - lastSync.data.syncedAt) / 60000) + '分钟' }
      }
    } catch (_) {}
  }

  try {
    const data = await fetchSpaceXData()

    // 用 LL2 的真实在轨任务覆盖（tiles 推导出的 ongoingMissions 几乎永远为空）
    let ongoingMissions = data.ongoingMissions || []
    try {
      const ll2Ongoing = await fetchOngoingSpaceXMissionsFromLL2()
      if (Array.isArray(ll2Ongoing) && ll2Ongoing.length) {
        ongoingMissions = ll2Ongoing
      }
    } catch (e) {
      console.warn('[SpaceXSync] LL2 ongoing missions failed, fallback to tiles:', e && e.message)
    }

    // 即将进行的在轨任务（Docking/EVA/Berthing 等，跨厂商）
    let upcomingOrbitalEvents = []
    try {
      upcomingOrbitalEvents = await fetchUpcomingOrbitalEvents(8)
    } catch (e) {
      console.warn('[SpaceXSync] upcoming orbital events failed:', e && e.message)
    }

    const doc = {
      source: 'spacex_official',
      isActive: true,
      totalLaunches: data.totalLaunches,
      totalLandings: data.totalLandings,
      totalReflights: data.totalReflights,
      upcoming: data.upcoming,
      recentCompleted: data.recentCompleted,
      totalTiles: data.totalTiles,
      d2cStats: data.d2cStats,
      recoveryStats: data.recoveryStats,
      ongoingMissions,
      upcomingOrbitalEvents,
      updatedAt: now,
      syncedAt: now
    }

    let existing = null
    try { existing = await collection.doc(docId).get() } catch (_) {}
    if (existing && existing.data) {
      await collection.doc(docId).update({ data: doc })
    } else {
      await collection.add({ data: { _id: docId, ...doc, createdAt: now } })
    }

    return { success: true, message: 'SpaceX数据同步完成', totalLaunches: data.totalLaunches, totalLandings: data.totalLandings, totalReflights: data.totalReflights, upcomingCount: data.upcoming.length, completedCount: data.recentCompleted.length, ongoingCount: ongoingMissions.length, upcomingOrbitalCount: upcomingOrbitalEvents.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 数据交叉校验：用 SpaceX 官方 tiles 数据补全 Space Devs 缓存
 * 零额外 API 请求，仅读取已同步到云数据库的两份数据做匹配
 */
async function crossValidateWithSpaceX() {
  try {
    // 读取 SpaceX 官方数据（刚刚同步的）
    const spacexDoc = await db.collection('spacex_launch_stats').doc('spacex_official_live').get().catch(() => null)
    if (!spacexDoc || !spacexDoc.data) return { success: false, message: 'SpaceX数据不存在' }

    const sxUpcoming = spacexDoc.data.upcoming || []
    const sxCompleted = spacexDoc.data.recentCompleted || []
    const sxAll = [...sxUpcoming, ...sxCompleted]
    if (!sxAll.length) return { success: true, message: '无SpaceX tiles可校验', matched: 0 }

    // 读取 Space Devs upcoming 缓存
    const sdDocs = await db.collection('space_devs_cache')
      .where({ _id: db.RegExp({ regexp: 'api_cache_/launches/upcoming/', options: 'i' }) })
      .orderBy('data.timestamp', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))

    if (!sdDocs.data || !sdDocs.data.length) return { success: true, message: '无Space Devs缓存可校验', matched: 0 }

    const sdDoc = sdDocs.data[0]
    const sdResults = (sdDoc.data && sdDoc.data.data && sdDoc.data.data.results) || []
    if (!sdResults.length) return { success: true, message: 'Space Devs结果为空', matched: 0 }

    // 构建 SpaceX tiles 的日期索引（用 launchDate 做快速匹配）
    const sxByDate = {}
    for (const tile of sxAll) {
      if (tile.launchDate) {
        const key = tile.launchDate // 格式: 2025-09-03
        if (!sxByDate[key]) sxByDate[key] = []
        sxByDate[key].push(tile)
      }
    }

    let matchCount = 0
    let enrichCount = 0

    for (const sdLaunch of sdResults) {
      // Space Devs 的 net 格式: "2025-09-03T07:56:00Z"
      const sdDate = (sdLaunch.net || '').split('T')[0]
      const candidates = sxByDate[sdDate]
      if (!candidates || !candidates.length) continue

      // 在同日期的 tiles 中找最佳匹配（名称模糊匹配）
      const sdName = (sdLaunch.name || '').toLowerCase()
      let bestMatch = candidates[0] // 默认取第一个
      for (const c of candidates) {
        const sxLink = (c.link || '').replace(/-/g, ' ').toLowerCase()
        const sxTitle = (c.title || '').toLowerCase()
        if (sdName.includes(sxLink) || sdName.includes(sxTitle) || sxTitle.includes('starlink') && sdName.includes('starlink')) {
          bestMatch = c
          break
        }
      }

      matchCount++

      // 补全 SpaceX 官方独有字段（用 _sx 前缀避免冲突）
      if (!sdLaunch._sxEnriched) {
        sdLaunch._sxReturnSite = bestMatch.returnSite || ''
        sdLaunch._sxMissionType = bestMatch.missionType || ''
        sdLaunch._sxDirectToCell = !!bestMatch.directToCell
        sdLaunch._sxLink = bestMatch.link || ''
        sdLaunch._sxImageUrl = bestMatch.imageMobileUrl || bestMatch.imageUrl || ''
        sdLaunch._sxEndDate = bestMatch.endDate || ''
        sdLaunch._sxIsLive = !!bestMatch.isLive
        sdLaunch._sxEnriched = true
        enrichCount++
      }
    }

    // 写回（仅当有实际补全时才写，节省写操作）
    if (enrichCount > 0) {
      await db.collection('space_devs_cache').doc(sdDoc._id).update({
        data: {
          'data.data.results': sdResults,
          'data.data._crossValidatedAt': Date.now()
        }
      })
    }

    return { success: true, matched: matchCount, enriched: enrichCount }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// starbase.texas.gov HTML 解析已抽出为独立模块（无云 SDK 依赖，可单测），见 starbase-parse.js
const {
  isStarbaseOpenSemantic,
  parseStarbaseHtml
} = require('./starbase-parse.js')

/**
 * 从 SpaceDevs dashboard/starship 端点获取 road_closures 数据
 */
async function fetchSpaceDevsRoadClosures() {
  try {
    const url = `${LAUNCH_LIBRARY_API}/dashboard/starship/?format=json`
    const apiData = await Promise.race([
      fetchAPI(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('dashboard/starship 请求超时')), 30000))
    ])

    if (!apiData) {
      return { success: false, error: 'dashboard/starship 返回为空', closures: [], notices: [] }
    }

    return {
      success: true,
      closures: Array.isArray(apiData.road_closures) ? apiData.road_closures : [],
      notices: Array.isArray(apiData.notices) ? apiData.notices : [],
      fetchedAt: Date.now()
    }
  } catch (error) {
    return { success: false, error: error.message, closures: [], notices: [] }
  }
}

// 封路数据缓存有效期：50 分钟（配合小时级触发器实现每小时刷新；
// 官网封路/延迟窗口常只有 3 小时，旧的 6 小时节流会整窗错过）
const ROAD_CLOSURE_CACHE_DURATION = 50 * 60 * 1000

/**
 * 同步封路通知到 road_closure_notice 集合
 * 数据源 A：SpaceDevs dashboard/starship 的 road_closures
 * 数据源 B：starbase.texas.gov 道路/海滩实时状态（主要来源）
 * 数据源 C：管理后台手动配置（id='current'）
 * 三者兼容并存，小时级刷新（50 分钟缓存节流）
 */
async function syncRoadClosure(forceRefresh = false) {
  const now = Date.now()
  const results = { spacedevs: null, starbaseGov: null, merged: 0, created: 0, updated: 0 }

  const collection = db.collection('road_closure_notice')

  // 检查是否需要刷新（缓存期内已同步则跳过，除非是手动强制刷新）
  if (!forceRefresh) {
    try {
      const lastSync = await collection.doc('starbase_gov_live').get().catch(() => null)
      if (lastSync && lastSync.data && lastSync.data.syncedAt) {
        const elapsed = now - lastSync.data.syncedAt
        if (elapsed < ROAD_CLOSURE_CACHE_DURATION) {
          return { success: true, message: '缓存有效，跳过同步', cacheAge: Math.round(elapsed / 60000) + '分钟' }
        }
      }
    } catch (_) {}
  }

  // ── 数据源 B（优先）：starbase.texas.gov ──
  try {
    const sgResult = await fetchStarbaseGovStatus()
    results.starbaseGov = {
      success: sgResult.success,
      beachOpen: sgResult.beachOpen,
      roadOpen: sgResult.roadOpen,
      error: sgResult.error || null,
      fetchVia: sgResult.fetchVia || null,
      scheduleCount: sgResult.beachClosureSchedule ? sgResult.beachClosureSchedule.length : 0,
      roadUpdateCount: sgResult.roadUpdates ? sgResult.roadUpdates.length : 0
    }

    if (sgResult.success) {
      const roadOpenState = sgResult.roadOpen === true || isStarbaseOpenSemantic(sgResult.roadStatusLabel)
      const hasSchedule = sgResult.beachClosureSchedule && sgResult.beachClosureSchedule.length > 0
      const hasDelays = sgResult.roadDelays && sgResult.roadDelays.length > 0
      const hasRoadUpdates = sgResult.roadUpdates && sgResult.roadUpdates.length > 0
      // 解析出的真实时间窗（America/Chicago → epoch）；整窗已过期的道路延迟不再激活
      // （注意：不能再用 isClosed=roadOpen===false 短路，否则过期延迟仍会 isActive=true）
      const delayWindow = sgResult.delayWindow || null
      const windowExpired = !!(delayWindow && delayWindow.endAt && delayWindow.endAt < now)
      const beachActive = sgResult.beachOpen === false || hasSchedule
      const roadActive =
        !windowExpired &&
        (sgResult.roadOpen === false || hasRoadUpdates || (hasDelays && !roadOpenState))
      const isActive = beachActive || roadActive
      const docId = 'starbase_gov_live'

      const doc = {
        source: 'starbase_gov',
        isActive,
        message: isActive
          ? (sgResult.message || 'Boca Chica 道路/海滩已封闭')
          : 'Boca Chica 道路/海滩当前开放',
        timeRange: sgResult.timeRange || '',
        beachStatus: sgResult.beachStatus || '',
        beachOpen: sgResult.beachOpen,
        roadOpen: sgResult.roadOpen,
        roadDelays: sgResult.roadDelays || [],
        beachClosureSchedule: sgResult.beachClosureSchedule || [],
        roadUpdates: sgResult.roadUpdates || [],
        publicNotice: sgResult.publicNotice || '',
        publicOrders: sgResult.publicOrders || [],
        bannerAlerts: sgResult.bannerAlerts || [],
        roadStatusLabel: sgResult.roadStatusLabel || '',
        // 优先使用解析出的真实窗口；解析不出时保留旧行为（now ~ +24h）
        startAt: isActive ? (delayWindow && delayWindow.startAt ? delayWindow.startAt : now) : 0,
        endAt: isActive ? (delayWindow && delayWindow.endAt ? delayWindow.endAt : now + 24 * 60 * 60 * 1000) : 0,
        priority: 100,
        updatedAt: now,
        syncedAt: now
      }

      let existing = null
      try { existing = await collection.doc(docId).get() } catch (_) {}
      if (existing && existing.data) {
        await collection.doc(docId).update({ data: doc })
        results.updated++
      } else {
        await collection.doc(docId).set({ data: { _id: docId, ...doc, createdAt: now } })
        results.created++
      }
      results.merged++
    }
  } catch (e) {
    results.starbaseGov = { success: false, error: e.message }
  }

  // ── 数据源 A：SpaceDevs dashboard/starship（定时全量同步；手动 forceRefresh 跳过以控制耗时）──
  if (!forceRefresh) {
    try {
      const sdResult = await Promise.race([
        fetchSpaceDevsRoadClosures(),
        new Promise((resolve) => {
          setTimeout(() => resolve({
            success: false,
            error: 'spacedevs timeout(12s)',
            closures: [],
            notices: []
          }), 12000)
        })
      ])
      results.spacedevs = { success: sdResult.success, count: sdResult.closures.length, error: sdResult.error || null }

      for (const closure of (sdResult.closures || [])) {
        try {
          const docId = `sd_${closure.id || closure.name || now}`
          const startTime = closure.window_start ? new Date(closure.window_start).getTime()
            : (closure.start ? new Date(closure.start).getTime() : null)
          const endTime = closure.window_end ? new Date(closure.window_end).getTime()
            : (closure.end ? new Date(closure.end).getTime() : null)
          const statusName = (closure.status && closure.status.name) ? closure.status.name : (closure.status || '')
          const isActive = !(/cancel|revoked|concluded|open|now open/i.test(String(statusName)))

          const doc = {
            source: 'spacedevs',
            isActive,
            message: closure.title || closure.name || statusName || '封路通知',
            timeRange: startTime && endTime
              ? `${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`
              : '',
            statusText: statusName,
            startAt: startTime || 0,
            endAt: endTime || 0,
            priority: 50,
            updatedAt: now,
            syncedAt: now
          }

          let existing = null
          try { existing = await collection.doc(docId).get() } catch (_) {}
          if (existing && existing.data) {
            await collection.doc(docId).update({ data: doc })
            results.updated++
          } else {
            await collection.doc(docId).set({ data: { _id: docId, ...doc, createdAt: now } })
            results.created++
          }
          results.merged++
        } catch (e) { /* skip */ }
      }
    } catch (e) {
      results.spacedevs = { success: false, error: e.message }
    }
  } else {
    results.spacedevs = { success: true, skipped: true, reason: 'manual_sync_starbase_only' }
  }

  // ── 清理已过期的 SpaceDevs 封路通知 ──
  try {
    const expiredResult = await collection.where({
      source: 'spacedevs',
      endAt: db.command.gt(0).and(db.command.lt(now))
    }).remove()
    results.expired = (expiredResult && expiredResult.stats) ? expiredResult.stats.removed : 0
  } catch (e) { results.expired = 0 }

  const starbaseOk = !!(results.starbaseGov && results.starbaseGov.success)
  const spacedevsFailed = !!(results.spacedevs && results.spacedevs.success === false && !results.spacedevs.skipped)
  const partial = starbaseOk && spacedevsFailed

  return {
    success: starbaseOk || results.merged > 0,
    partial,
    message: starbaseOk
      ? (partial ? 'Starbase 已同步，SpaceDevs 辅助源失败' : '封路通知同步完成')
      : (results.merged > 0 ? '封路通知同步完成（Starbase 抓取失败）' : '封路同步未完成：Starbase 抓取失败'),
    ...results
  }
}

/**
 * 清理过期的缓存数据
 */
async function cleanExpiredCache() {
  try {
    const now = Date.now()
    
    // 清理过期缓存（仅顶层 expireAt 的旧结构文档；当前写入的文档 expireAt 嵌套在 data 内，
    // 本就不会被此查询命中——它们只在同步成功拉到新数据时被覆盖写入，绝不按过期删除，
    // 避免 LL2 限流/同步失败期间把唯一数据源删掉导致客户端整页「数据暂不可用」）。
    // 核心发射列表（/launches/upcoming/、/launches/previous/ 及其批次文档）显式排除：
    // 先查出命中的 _id，在内存里过滤掉核心 key，再按 _id 批量删除。
    const _ = db.command
    const isCore = (id) => typeof id === 'string' &&
      (id.indexOf('api_cache_/launches/upcoming/') === 0 ||
       id.indexOf('api_cache_/launches/previous/') === 0)

    const expiredDocs = await db.collection('space_devs_cache')
      .where({ expireAt: _.lt(now) })
      .field({ _id: true })
      .limit(1000)
      .get()
    const removableIds = ((expiredDocs && expiredDocs.data) || [])
      .map((d) => d._id)
      .filter((id) => id && !isCore(id))

    let removedCount = 0
    for (let i = 0; i < removableIds.length; i += 100) {
      const chunk = removableIds.slice(i, i + 100)
      try {
        const r = await db.collection('space_devs_cache')
          .where({ _id: _.in(chunk) })
          .remove()
        removedCount += (r && r.stats && r.stats.removed) || 0
      } catch (e) { /* 单批删除失败不影响其余批次 */ }
    }
    const result = { stats: { removed: removedCount } }

    
    // 额外清理 /launches/upcoming/ 和 /launches/previous/ 的旧格式缓存（limit: 20）
    // 即使未过期也清理，因为现在使用 limit: 100 的新格式
    try {
      const oldFormatEndpoints = [
        { url: '/launches/upcoming/', ordering: 'net' },
        { url: '/launches/previous/', ordering: '-net' }
      ]
      
      for (const endpoint of oldFormatEndpoints) {
        // 构建旧格式的缓存 key（limit: 20）
        const oldParams = {
          limit: 20,
          offset: 0,
          ordering: endpoint.ordering,
          mode: 'detailed',
          format: 'json'
        }
        const oldSortedParams = Object.keys(oldParams)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = oldParams[key]
            return sorted
          }, {})
        const oldParamsStr = JSON.stringify(oldSortedParams)
        const oldCacheKey = `api_cache_${endpoint.url}_${oldParamsStr}`
        
        // 尝试删除旧格式的缓存
        try {
          await db.collection('space_devs_cache').doc(oldCacheKey).remove()
        } catch (removeError) {
          // 如果文档不存在，忽略错误（这是正常的）
          if (removeError.errCode !== -1 && 
              !removeError.errMsg.includes('not exist') && 
              !removeError.errMsg.includes('不存在')) {
          }
        }
      }
    } catch (cleanError) {
      // 清理旧格式缓存失败不影响主流程
    }
    
    return result.stats.removed
  } catch (error) {
    return 0
  }
}

/**
 * 查询发射次数（使用 API count 字段，limit=1 单次请求即可）
 * @param {Object} extraParams 额外的过滤参数（如 lsp__id、lsp__name、net__gte 等）
 * @returns {Promise<Number|null>} 发射次数
 */
/**
 * 从云数据库已缓存的 /launches/previous/ 数据中统计发射次数
 * 避免额外调用 Space Devs API，节省 3 次/轮 API 配额
 */
async function countLaunchesFromCache() {
  const cacheCollection = db.collection('space_devs_cache')
  const sortedParams = JSON.stringify({"format":"json","limit":100,"mode":"detailed","offset":0,"ordering":"-net"})
  // 优先读最新版本，失败再按版本号倒序降级，兼容旧缓存
  const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

  let cacheKey = null
  let doc = null
  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = `api_cache_/launches/previous/_${sortedParams}${sfx}`
    const d = await cacheCollection.doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      cacheKey = key
      doc = d
      break
    }
  }
  // 精确 key 未命中时，用正则回退匹配真实缓存 key（api_cache_/launches/previous/_...）
  if (!doc || !doc.data || !doc.data.data) {
    const fallbackDocs = await cacheCollection
      .where({ _id: db.RegExp({ regexp: 'api_cache_/launches/previous/', options: 'i' }) })
      .orderBy('data.timestamp', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (fallbackDocs.data && fallbackDocs.data.length) {
      doc = fallbackDocs.data[0]
      cacheKey = doc._id
    }
  }
  if (!doc || !doc.data || !doc.data.data) return null

  const apiData = doc.data.data
  // 如果是分批存储，需要合并所有 batch（主文档标记为 isBatched，历史可能为 isBatch，
  // 再兜底 results 为空但 count>0 的分批情形）
  let allResults = []
  const isBatched = !!(apiData.isBatched || apiData.isBatch)
    || (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)
  if (isBatched) {
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await cacheCollection.doc(batchKey).get().catch(() => null)
      if (!batchDoc || !batchDoc.data || !batchDoc.data.data) break
      const batchData = batchDoc.data.data
      if (batchData.results && Array.isArray(batchData.results)) {
        allResults = allResults.concat(batchData.results)
      }
      batchIdx++
    }
  }
  if (!allResults.length && apiData.results && Array.isArray(apiData.results)) {
    allResults = apiData.results
  }

  // count 字段是 API 返回的全量计数（不受 limit 限制），优先使用
  const totalCount = (typeof apiData.count === 'number') ? apiData.count : allResults.length
  return { totalCount, results: allResults, cacheKey }
}

/**
 * 竞猜结算用：从 space_devs_cache 拉取与同步任务一致的 upcoming/previous 列表（与 countLaunchesFromCache 同源）。
 * 历史原因：settleVotes 曾查 api_cache，现网数据均在 space_devs_cache，否则 findLaunch 永远为空。
 */
function _voteSortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

async function _readLaunchResultsFromSpaceDevsDoc(cacheCollection, urlPath, baseParams) {
  const sortedParams = _voteSortedParamsString(baseParams)
  const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']
  let cacheKey = null
  let doc = null
  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = `api_cache_${urlPath}_${sortedParams}${sfx}`
    const d = await cacheCollection.doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      cacheKey = key
      doc = d
      break
    }
  }
  if (!doc || !doc.data || !doc.data.data) return []
  const apiData = doc.data.data
  let allResults = []
  const isBatched = !!(apiData.isBatched || apiData.isBatch)
    || (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)
  if (isBatched) {
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await cacheCollection.doc(batchKey).get().catch(() => null)
      if (!batchDoc || !batchDoc.data || !batchDoc.data.data) break
      const batchData = batchDoc.data.data
      if (batchData.results && Array.isArray(batchData.results)) {
        allResults = allResults.concat(batchData.results)
      }
      batchIdx++
    }
  }
  if (!allResults.length && apiData.results && Array.isArray(apiData.results)) {
    allResults = apiData.results
  }
  return allResults
}

async function loadCachedLaunchesForVoteSettle() {
  const cacheCollection = db.collection('space_devs_cache')
  const prevParams = { format: 'json', limit: 100, mode: 'detailed', offset: 0, ordering: '-net' }
  const upParams = {
    format: 'json',
    hide_recent_previous: true,
    limit: 100,
    mode: 'detailed',
    offset: 0,
    ordering: 'net'
  }
  const prev = await _readLaunchResultsFromSpaceDevsDoc(cacheCollection, '/launches/previous/', prevParams)
  const up = await _readLaunchResultsFromSpaceDevsDoc(cacheCollection, '/launches/upcoming/', upParams)
  let merged = (prev || []).concat(up || [])
  // 去重：同一 launch id 保留靠前一条（previous 列表通常更近）
  const seen = new Set()
  merged = merged.filter((l) => {
    if (!l || l.id == null) return false
    const id = String(l.id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return merged
}

/**
 * 通过 LL2 API count 字段获取已完成发射总数（limit=1 即可，不消耗 results 配额）
 */
async function fetchPreviousLaunchCount(extraParams = {}) {
  const params = {
    limit: 1,
    mode: 'detailed',
    format: 'json',
    ...extraParams
  }
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  const url = `${LAUNCH_LIBRARY_API}/launches/previous/?${qs}`
  const res = await fetchAPI(url).catch(() => null)
  return (res && typeof res.count === 'number') ? res.count : null
}

/** LL2 上 SpaceX 的 launch service provider id（常用过滤兜底） */
const SPACEX_LSP_ID = 121

/**
 * 判断单次发射是否属于 SpaceX（兼容 slim 缓存多种字段路径）
 */
function isSpacexLaunch(launch) {
  if (!launch || typeof launch !== 'object') return false

  const provider = launch.launch_service_provider || launch.lsp || null
  if (provider) {
    if (provider.id === SPACEX_LSP_ID) return true
    const name = String(provider.name || '').toLowerCase()
    const abbrev = String(provider.abbrev || '').toLowerCase()
    if (name === 'spacex' || abbrev === 'spx') return true
    if (name.includes('space exploration technologies')) return true
  }

  if (Array.isArray(launch.program)) {
    for (const prog of launch.program) {
      const agencies = prog && prog.agencies
      if (!Array.isArray(agencies)) continue
      for (const ag of agencies) {
        if (!ag) continue
        if (ag.id === SPACEX_LSP_ID) return true
        const n = String(ag.name || '').toLowerCase()
        const a = String(ag.abbrev || '').toLowerCase()
        if (n === 'spacex' || a === 'spx' || n.includes('space exploration technologies')) return true
      }
    }
  }

  const rocketCfg = launch.rocket && launch.rocket.configuration
  const mfg = rocketCfg && rocketCfg.manufacturer
  if (mfg) {
    if (mfg.id === SPACEX_LSP_ID) return true
    const mn = String(mfg.name || '').toLowerCase()
    if (mn === 'spacex' || mn.includes('space exploration technologies')) return true
  }

  return false
}

function countLaunchesFromCacheResults(results, yearStart, yearEnd) {
  let spacexThisYear = 0
  let spacexAllTime = 0
  let globalThisYear = 0

  for (const launch of results) {
    const isSpaceX = isSpacexLaunch(launch)
    const netTime = launch.net ? new Date(launch.net).getTime() : 0

    if (isSpaceX) spacexAllTime++
    if (netTime >= yearStart && netTime < yearEnd) {
      globalThisYear++
      if (isSpaceX) spacexThisYear++
    }
  }

  return { spacexThisYear, spacexAllTime, globalThisYear }
}

/** LL2 lsp__id / lsp__name 过滤失效时，SpaceX 计数会与全球计数相同；超过此阈值则视为可疑 */
const SPACEX_FILTER_SUSPECT_THRESHOLD = 10

function isSpacexApiFilterSuspect(spacexCount, globalCount) {
  const spacex = Number(spacexCount)
  const global = Number(globalCount)
  return Number.isFinite(spacex) && Number.isFinite(global)
    && spacex >= global
    && global > SPACEX_FILTER_SUSPECT_THRESHOLD
}

/** apiCounts.spacexThisYear 为 null/0 但全球本年>0 时，应回退缓存逐条过滤 */
function shouldFallbackSpacexThisYearToCache(spacexApi, globalApi) {
  if (spacexApi == null) return true
  if (isSpacexApiFilterSuspect(spacexApi, globalApi)) return true
  const global = Number(globalApi)
  const spacex = Number(spacexApi)
  return Number.isFinite(global) && global > SPACEX_FILTER_SUSPECT_THRESHOLD
    && Number.isFinite(spacex) && spacex === 0
}

/**
 * 依次尝试多种 LL2 SpaceX 过滤参数，返回首个非可疑的有效 count
 */
async function fetchSpacexLaunchCountWithFallback(yearParams = {}, globalCount = null) {
  const variants = [
    { key: 'lsp__id', params: { lsp__id: SPACEX_LSP_ID, ...yearParams } },
    { key: 'lsp__name', params: { lsp__name: 'SpaceX', ...yearParams } }
  ]
  for (const v of variants) {
    const count = await fetchPreviousLaunchCount(v.params)
    if (count == null) continue
    if (globalCount == null || !isSpacexApiFilterSuspect(count, globalCount)) {
      return { count, filterKey: v.key }
    }
  }
  return { count: null, filterKey: null }
}

/**
 * 同步发射统计到独立的 launch_stats 集合（仅已完成发射）
 * globalThisYear 优先 LL2 API count；SpaceX 计数 API 可疑时回退缓存逐条过滤
 */
async function syncLaunchStats() {
  const year = new Date().getUTCFullYear()
  const yearStartIso = `${year}-01-01T00:00:00Z`
  const yearEndIso = `${year + 1}-01-01T00:00:00Z`
  const yearStart = new Date(yearStartIso).getTime()
  const yearEnd = new Date(yearEndIso).getTime()
  const yearParams = { net__gte: yearStartIso, net__lt: yearEndIso }

  const stats = {}

  try {
    const [spacexThisYearRaw, spacexAllTimeRaw, globalThisYearApi, globalAllTimeApi] = await Promise.all([
      fetchPreviousLaunchCount({ lsp__id: SPACEX_LSP_ID, ...yearParams }),
      fetchPreviousLaunchCount({ lsp__id: SPACEX_LSP_ID }),
      fetchPreviousLaunchCount(yearParams),
      fetchPreviousLaunchCount({})
    ])

    let spacexThisYearApi = spacexThisYearRaw
    let spacexAllTimeApi = spacexAllTimeRaw
    let spacexThisYearFilter = 'lsp__id'
    let spacexAllTimeFilter = 'lsp__id'

    const suspectThisYearRaw = isSpacexApiFilterSuspect(spacexThisYearApi, globalThisYearApi)
    const suspectAllTimeRaw = isSpacexApiFilterSuspect(spacexAllTimeApi, globalAllTimeApi)

    if (suspectThisYearRaw || spacexThisYearApi == null) {
      const fb = await fetchSpacexLaunchCountWithFallback(yearParams, globalThisYearApi)
      if (fb.count != null) {
        spacexThisYearApi = fb.count
        spacexThisYearFilter = fb.filterKey
      }
    }
    if (suspectAllTimeRaw || spacexAllTimeApi == null) {
      const fb = await fetchSpacexLaunchCountWithFallback({}, globalAllTimeApi)
      if (fb.count != null) {
        spacexAllTimeApi = fb.count
        spacexAllTimeFilter = fb.filterKey
      }
    }

    let counts = null
    let source = 'api_count'
    let cachedResultsCount = 0
    let cacheCounts = null
    let cached = null
    const sources = {
      globalThisYear: 'api_count',
      spacexThisYear: 'api_count',
      spacexAllTime: 'api_count'
    }

    if (globalThisYearApi == null) {
      cached = await countLaunchesFromCache()
      if (!cached) {
        return { success: false, error: '缓存中无 /launches/previous/ 数据，跳过统计' }
      }
      counts = countLaunchesFromCacheResults(cached.results, yearStart, yearEnd)
      source = 'cache_filtered'
      sources.globalThisYear = 'cache_filtered'
      sources.spacexThisYear = 'cache_filtered'
      sources.spacexAllTime = 'cache_filtered'
      cachedResultsCount = cached.results.length
    } else {
      counts = {
        spacexThisYear: spacexThisYearApi != null ? spacexThisYearApi : 0,
        spacexAllTime: spacexAllTimeApi != null ? spacexAllTimeApi : 0,
        globalThisYear: globalThisYearApi
      }

      const needCacheThisYear = shouldFallbackSpacexThisYearToCache(spacexThisYearApi, globalThisYearApi)
      const suspectAllTime = isSpacexApiFilterSuspect(spacexAllTimeApi, globalAllTimeApi)

      if (needCacheThisYear) {
        cached = cached || await countLaunchesFromCache()
        if (cached && cached.results.length > 0) {
          cacheCounts = countLaunchesFromCacheResults(cached.results, yearStart, yearEnd)
          cachedResultsCount = cached.results.length
          if (cacheCounts.spacexThisYear > 0 || counts.spacexThisYear === 0) {
            counts.spacexThisYear = cacheCounts.spacexThisYear
            sources.spacexThisYear = 'cache_filtered'
            stats.lspFilterCorrected = true
            stats.cacheKey = cached.cacheKey || null
          }
        }
      }

      // allTime：缓存仅覆盖 recent N 条，不足以代表全量；过滤失效时保留 API 或备用 filter 结果
      if (suspectAllTime) {
        stats.lspFilterSuspectAllTime = true
        if (spacexAllTimeApi != null) {
          counts.spacexAllTime = spacexAllTimeApi
          sources.spacexAllTime = 'api_count'
        } else if (cached && cached.results.length > 0) {
          cacheCounts = cacheCounts || countLaunchesFromCacheResults(cached.results, yearStart, yearEnd)
          cachedResultsCount = cached.results.length
          counts.spacexAllTime = cacheCounts.spacexAllTime
          sources.spacexAllTime = 'cache_filtered'
          stats.lspFilterCorrected = true
        }
      }

      const usedCache = [sources.spacexThisYear, sources.spacexAllTime].some((s) => s === 'cache_filtered')
      source = usedCache && sources.globalThisYear === 'api_count' ? 'hybrid' : (usedCache ? 'cache_filtered' : 'api_count')
    }

    stats.spacexThisYear = counts.spacexThisYear
    stats.spacexAllTime = counts.spacexAllTime
    stats.globalThisYear = counts.globalThisYear
    stats.year = year
    stats.source = source
    stats.sources = sources
    stats.apiCounts = {
      spacexThisYear: spacexThisYearRaw,
      spacexAllTime: spacexAllTimeRaw,
      globalThisYear: globalThisYearApi,
      globalAllTime: globalAllTimeApi,
      spacexThisYearResolved: spacexThisYearApi,
      spacexAllTimeResolved: spacexAllTimeApi,
      spacexThisYearFilter,
      spacexAllTimeFilter
    }
    if (cacheCounts) {
      stats.cacheFiltered = cacheCounts
    }
    stats.cachedResultsCount = cachedResultsCount
    stats.updatedAt = new Date().toISOString()

    const docId = `stats_${year}`
    await db.collection('launch_stats').doc(docId).set({
      data: stats
    })

    return { success: true, stats }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 调试发射统计过滤字段（用于确认正确的 SpaceX 过滤参数）
 * @returns {Promise} 调试结果
 */
async function debugLaunchStatsFilters() {
  const year = new Date().getUTCFullYear()
  const yearStart = `${year}-01-01T00:00:00Z`
  const yearEnd = `${year + 1}-01-01T00:00:00Z`

  const results = {}

  try {
    // 尝试多种 SpaceX 过滤字段，找出正确的
    const filterTests = [
      { name: 'lsp__id=121', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp__id=121` },
      { name: 'lsp__name=SpaceX', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp__name=SpaceX` },
      { name: 'lsp_name=SpaceX (invalid)', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp_name=SpaceX` },
      { name: 'lsp_id=121 (invalid)', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp_id=121` },
      { name: 'launch_service_provider__name=SpaceX (invalid)', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&launch_service_provider__name=SpaceX` }
    ]

    for (const test of filterTests) {
      try {
        const res = await fetchAPI(test.url)
        results[test.name] = {
          success: true,
          count: res && res.count ? Number(res.count) : null,
          hasResults: !!(res && res.results && res.results.length > 0)
        }
      } catch (err) {
        results[test.name] = {
          success: false,
          error: err.message
        }
      }
    }

    // 测试当年过滤
    const yearTests = [
      { name: 'lsp__id=121+year', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp__id=121&net__gte=${yearStart}&net__lt=${yearEnd}` },
      { name: 'lsp__name=SpaceX+year', url: `${LAUNCH_LIBRARY_API}/launches/previous/?limit=1&lsp__name=SpaceX&net__gte=${yearStart}&net__lt=${yearEnd}` }
    ]

    for (const test of yearTests) {
      try {
        const res = await fetchAPI(test.url)
        results[test.name] = {
          success: true,
          count: res && res.count ? Number(res.count) : null,
          hasResults: !!(res && res.results && res.results.length > 0)
        }
      } catch (err) {
        results[test.name] = {
          success: false,
          error: err.message
        }
      }
    }

    const cached = await countLaunchesFromCache()
    if (cached) {
      const yearStartMs = new Date(yearStart).getTime()
      const yearEndMs = new Date(yearEnd).getTime()
      results.cacheFiltered = countLaunchesFromCacheResults(cached.results, yearStartMs, yearEndMs)
      results.cachedResultsCount = cached.results.length
      results.totalCountFromCache = cached.totalCount
    }

    return { success: true, results }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 批量写入 media_assets 映射（用于图片 CDN 映射）
 * @param {Array<{key:string,url:string,enabled?:boolean}>} assets
 */
async function syncMediaAssetsMappings(assets = [], options = {}) {
  if (!Array.isArray(assets) || !assets.length) {
    return {
      success: false,
      message: 'assets 为空，请传入至少一条映射'
    }
  }

  const normalized = assets
    .map((item) => {
      const key = item && item.key ? String(item.key).replace(/^\/+/, '').replace(/\\/g, '/') : ''
      const url = item && item.url ? String(item.url).trim() : ''
      const enabled = item && typeof item.enabled === 'boolean' ? item.enabled : true
      if (!key || !url) return null
      return { key, url, enabled }
    })
    .filter(Boolean)

  if (!normalized.length) {
    return {
      success: false,
      message: 'assets 格式无效，key/url 不能为空'
    }
  }

  const now = Date.now()
  const sourceTag = options && options.sourceTag ? String(options.sourceTag) : 'manual'
  const pruneMissing = !!(options && options.pruneMissing)
  const preserveExisting = !!(options && options.preserveExisting)
  let created = 0
  let updated = 0
  let skipped = 0
  let disabled = 0

  const collection = db.collection('media_assets')

  for (const item of normalized) {
    const docId = item.key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)
    try {
      let existing = null
      try {
        existing = await collection.doc(docId).get()
      } catch (e) {}

      if (preserveExisting && existing && existing.data) {
        skipped++
        continue
      }

      const payload = {
        key: item.key,
        url: item.url,
        enabled: item.enabled,
        sourceTag,
        updatedAt: now,
        createdAt: (existing && existing.data && existing.data.createdAt) ? existing.data.createdAt : now
      }

      await collection.doc(docId).set({ data: payload })

      if (existing && existing.data) updated++
      else created++
    } catch (e) {
    }
  }

  if (pruneMissing) {
    const incomingKeySet = new Set(normalized.map((item) => item.key))
    let hasMore = true
    let skip = 0
    const limit = 100

    while (hasMore) {
      const res = await collection
        .where({ sourceTag })
        .field({ key: true, enabled: true })
        .skip(skip)
        .limit(limit)
        .get()

      const rows = (res && res.data) || []
      for (const row of rows) {
        if (row && row.key && !incomingKeySet.has(row.key) && row.enabled !== false) {
          const docId = String(row.key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)
          await collection.doc(docId).update({
            data: {
              enabled: false,
              updatedAt: now
            }
          })
          disabled++
        }
      }

      hasMore = rows.length === limit
      skip += rows.length
    }
  }

  return {
    success: true,
    total: normalized.length,
    created,
    updated,
    skipped,
    disabled,
    sourceTag,
    pruneMissing,
    preserveExisting
  }
}

function toCloudFileID(relativePath) {
  const key = String(relativePath || '').replace(/^\/+/, '')
  return `${CLOUD_FILE_PREFIX}${key}`
}

function toCDNUrl(relativePath) {
  const key = String(relativePath || '').replace(/^\/+/, '')
  return `${CLOUD_CDN_BASE}${encodeURI(key)}`
}

function toVideoSnapshotUrl(relativePath, second = 1) {
  const baseUrl = toCDNUrl(relativePath)
  const t = Number(second) > 0 ? Number(second) : 1
  return `${baseUrl}?ci-process=snapshot&time=${t}&format=jpg&width=720&height=1280&scaletype=cover`
}

function toCOSUrl(relativePath) {
  const key = String(relativePath || '').replace(/^\/+/, '')
  return `${INSPIRATION_COS_BASE_URL}${encodeURI(key)}`
}

function toCOSVideoSnapshotUrl(relativePath, second = 1) {
  const baseUrl = toCOSUrl(relativePath)
  const t = Number(second) > 0 ? Number(second) : 1
  return `${baseUrl}?ci-process=snapshot&time=${t}&format=jpg&width=720&height=1280&scaletype=cover`
}

function normalizeInspirationPath(pathLike) {
  if (typeof pathLike !== 'string' || !pathLike) return pathLike
  return pathLike.replace(new RegExp(INSPIRATION_OLD_DIR, 'g'), INSPIRATION_DIR)
}

function normalizeInspirationMediaItem(item = {}) {
  const normalized = { ...item }
  normalized.fileID = normalizeInspirationPath(normalized.fileID)
  normalized.coverFileID = normalizeInspirationPath(normalized.coverFileID)
  if (Array.isArray(normalized.previewImages)) {
    normalized.previewImages = normalized.previewImages.map((img) => normalizeInspirationPath(img))
  }
  if (Array.isArray(normalized.images)) {
    normalized.images = normalized.images.map((img) => normalizeInspirationPath(img))
  }
  return normalized
}

function extractRelativePathFromCloudFileID(fileID = '') {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return ''
  const withoutProtocol = fileID.replace(/^cloud:\/\//, '')
  const slashIndex = withoutProtocol.indexOf('/')
  if (slashIndex < 0) return ''
  return withoutProtocol.slice(slashIndex + 1)
}

function normalizeStorageRelativePath(pathLike = '') {
  if (typeof pathLike !== 'string') return ''
  const normalized = normalizeInspirationPath(pathLike).replace(/^\/+/, '')
  if (normalized.startsWith('cloud://')) {
    return extractRelativePathFromCloudFileID(normalized)
  }
  if (normalized.startsWith(INSPIRATION_COS_BASE_URL)) {
    const raw = normalized.slice(INSPIRATION_COS_BASE_URL.length)
    try { return decodeURI(raw) } catch (e) { return raw }
  }
  return normalized
}

function isInspirationStoragePath(pathLike = '') {
  const rel = normalizeStorageRelativePath(pathLike)
  return rel.startsWith(`${INSPIRATION_DIR}/`)
}

function getFileExt(pathLike = '') {
  const rel = normalizeStorageRelativePath(pathLike)
  const dotIndex = rel.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return rel.slice(dotIndex + 1).toLowerCase()
}

function parseInspirationFilesFromEvent(event = {}) {
  const bucketLikeList = []

  if (Array.isArray(event.files)) bucketLikeList.push(...event.files)
  if (Array.isArray(event.fileList)) bucketLikeList.push(...event.fileList)
  if (Array.isArray(event.storageFiles)) bucketLikeList.push(...event.storageFiles)

  const records = []
  if (Array.isArray(event.records)) records.push(...event.records)
  if (Array.isArray(event.Records)) records.push(...event.Records)

  records.forEach((record) => {
    bucketLikeList.push(record)
    if (record && record.cos) bucketLikeList.push(record.cos)
    if (record && record.file) bucketLikeList.push(record.file)
  })

  return bucketLikeList
    .map((item) => {
      if (typeof item === 'string') {
        return {
          fileID: item,
          path: item,
          createdAt: Date.now()
        }
      }

      const fileID = item.fileID || item.fileid || item.cloudPath || item.path || item.key || ''
      const path = item.path || item.cloudPath || item.key || fileID || ''
      const createdAt = Number(item.createdAt || item.createTime || item.uploadedAt || item.timestamp || Date.now())
      return { fileID, path, createdAt }
    })
    .map((item) => ({
      ...item,
      fileID: normalizeInspirationPath(item.fileID),
      path: normalizeStorageRelativePath(item.path || item.fileID)
    }))
    .filter((item) => !!item.path && isInspirationStoragePath(item.path))
}

function buildInspirationFeedDocFromFile(file, index) {
  const relativePath = normalizeStorageRelativePath(file.path || file.fileID)
  const ext = getFileExt(relativePath)
  const filename = relativePath.split('/').pop() || `media_${index + 1}`
  const baseName = filename.replace(/\.[^.]+$/, '')
  const isImage = INSPIRATION_ALLOWED_IMAGE_EXT.has(ext)

  if (!isImage) return null

  const fileID = toCOSUrl(relativePath)
  const createdAt = Number(file.createdAt) || Date.now()
  const coverFileID = fileID

  return {
    type: 'image',
    fileID,
    coverFileID,
    previewImages: [coverFileID],
    title: baseName,
    desc: '来自云存储灵感流照片集',
    aspectRatio: 1,
    weight: Math.max(1, 1000000 - index),
    order: index + 1,
    enabled: true,
    auditStatus: 'approved',
    sourceTag: INSPIRATION_SOURCE_TAG,
    createdAt,
    updatedAt: Date.now()
  }
}

function buildInspirationPlaceholderDoc(index) {
  const rel = '首页轮播图/轮播图1.jpg'
  const fileID = toCOSUrl(rel)
  return {
    type: 'shop-placeholder',
    fileID,
    coverFileID: fileID,
    previewImages: [fileID],
    title: `占位 ${index + 1}`,
    desc: '内容较少，自动补位',
    aspectRatio: 0.94,
    weight: 0,
    order: index + 1,
    enabled: true,
    auditStatus: 'approved',
    sourceTag: INSPIRATION_SOURCE_TAG,
    createdAt: 0,
    updatedAt: Date.now()
  }
}

function buildInspirationMediaDocId(relativePath = '') {
  const safe = String(relativePath || '')
    .replace(/[^a-zA-Z0-9_\-./]/g, '_')
    .replace(/[./]/g, '_')
    .slice(0, 80)
  return `media_feed_media_${safe}`
}

function parseDeletedInspirationFiles(event = {}) {
  const deleted = []
  if (Array.isArray(event.deletedFiles)) deleted.push(...event.deletedFiles)
  if (Array.isArray(event.removeFiles)) deleted.push(...event.removeFiles)
  if (Array.isArray(event.deletedFileList)) deleted.push(...event.deletedFileList)

  return deleted
    .map((item) => {
      if (typeof item === 'string') return item
      return item.fileID || item.fileid || item.path || item.cloudPath || item.key || ''
    })
    .map((item) => normalizeStorageRelativePath(item))
    .filter((item) => !!item && isInspirationStoragePath(item))
}

function parseBucketFromCloudPrefix(cloudPrefix = '') {
  const normalized = String(cloudPrefix || '').replace(/^cloud:\/\//, '')
  const slashIndex = normalized.indexOf('/')
  const host = slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized
  // host 格式: envId.bucket-appid
  const parts = host.split('.')
  if (parts.length < 2) return ''
  return parts.slice(1).join('.')
}

function createCOSClient() {
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

async function listAllInspirationFilesFromCOS() {
  const bucket = INSPIRATION_COS_BUCKET
  const region = INSPIRATION_COS_REGION

  const cos = createCOSClient()
  const prefix = `${INSPIRATION_DIR}/`
  const files = []
  let marker = ''
  let listedObjects = 0

  while (true) {
    const resp = await new Promise((resolve, reject) => {
      cos.getBucket({
        Bucket: bucket,
        Region: region,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000
      }, (err, data) => {
        if (err) return reject(err)
        resolve(data || {})
      })
    })

    const contents = Array.isArray(resp.Contents) ? resp.Contents : []
    listedObjects += contents.length

    contents.forEach((obj) => {
      const key = normalizeStorageRelativePath(obj.Key || '')
      if (!isInspirationStoragePath(key)) return
      files.push({
        fileID: toCOSUrl(key),
        path: key,
        createdAt: Number(new Date(obj.LastModified || Date.now()).getTime())
      })
    })

    const isTruncated = String(resp.IsTruncated || 'false') === 'true'
    if (!isTruncated) break
    marker = resp.NextMarker || (contents.length ? contents[contents.length - 1].Key : '')
    if (!marker) break
  }

  return {
    files,
    stats: {
      source: 'cos',
      bucket,
      listedObjects,
      inspirationObjects: files.length,
      error: null
    }
  }
}

async function rebuildInspirationMediaFeedFromStorage(event = {}) {
  const collection = db.collection('media_feed')

  let files = parseInspirationFilesFromEvent(event)
  const deletedPaths = parseDeletedInspirationFiles(event)
  let sourceStats = {
    source: 'event.files',
    totalAssets: null,
    enabledAssets: null,
    inspirationAssets: null
  }

  // 手动触发未传 files 时，仅从 COS 目录全量扫描（不依赖 media_assets）
  let autoLoadedFullSnapshot = false
  if (!files.length) {
    const fromCOS = await listAllInspirationFilesFromCOS()
    files = fromCOS.files || []
    sourceStats = {
      source: 'cos',
      totalAssets: null,
      enabledAssets: null,
      inspirationAssets: fromCOS.stats ? fromCOS.stats.inspirationObjects : files.length,
      listedObjects: fromCOS.stats ? fromCOS.stats.listedObjects : files.length,
      bucket: fromCOS.stats ? fromCOS.stats.bucket : null,
      cosError: fromCOS.stats ? fromCOS.stats.error : null
    }
    autoLoadedFullSnapshot = true
  }

  // 默认策略：自动拿到全量快照时按全量对齐（清理缺失项）
  const removeMissing = Object.prototype.hasOwnProperty.call(event, 'removeMissing')
    ? !!event.removeMissing
    : autoLoadedFullSnapshot

  const invalidFiles = []
  const parsedDocs = files
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map((file, index) => {
      const relativePath = normalizeStorageRelativePath(file.path || file.fileID)
      const ext = getFileExt(relativePath)
      const doc = buildInspirationFeedDocFromFile(file, index)
      if (!doc) {
        invalidFiles.push({
          path: relativePath,
          ext,
          reason: ext ? 'unsupported_extension' : 'missing_extension'
        })
        return null
      }
      return { relativePath, doc }
    })
    .filter(Boolean)

  let upserted = 0
  for (const item of parsedDocs) {
    const docId = buildInspirationMediaDocId(item.relativePath)
    const payload = {
      ...item.doc,
      sourceTag: INSPIRATION_SOURCE_TAG,
      updatedAt: Date.now()
    }
    await collection.doc(docId).set({ data: payload })
    upserted++
  }

  let removed = 0
  for (const relativePath of deletedPaths) {
    const docId = buildInspirationMediaDocId(relativePath)
    try {
      await collection.doc(docId).remove()
      removed++
    } catch (e) {}
  }

  if (removeMissing && parsedDocs.length) {
    const incomingSet = new Set(parsedDocs.map((item) => item.relativePath))
    const existing = await fetchCollectionDocs('media_feed', { sourceTag: INSPIRATION_SOURCE_TAG })
    const existingMedia = existing.filter((row) => row.type === 'image' || row.type === 'video')

    for (const row of existingMedia) {
      const relativePath = normalizeStorageRelativePath(row.fileID || row.coverFileID || (row.previewImages && row.previewImages[0]) || '')
      const shouldRemove = !relativePath || !incomingSet.has(relativePath)
      if (shouldRemove) {
        try {
          await collection.doc(row._id).remove()
          removed++
        } catch (e) {}
      }
    }
  }

  const latestAll = await fetchCollectionDocs('media_feed', { sourceTag: INSPIRATION_SOURCE_TAG })
  const allMediaRows = latestAll
    .filter((row) => row.type === 'image' || row.type === 'video')
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))

  // 去重：同一 relativePath 只保留最新一条，删除历史重复记录
  const seenPathSet = new Set()
  const mediaRows = []
  for (const row of allMediaRows) {
    const relativePath = normalizeStorageRelativePath(row.fileID || row.coverFileID || (row.previewImages && row.previewImages[0]) || '')
    const dedupeKey = relativePath || row._id
    if (!seenPathSet.has(dedupeKey)) {
      seenPathSet.add(dedupeKey)
      mediaRows.push(row)
      continue
    }

    try {
      await collection.doc(row._id).remove()
      removed++
    } catch (e) {}
  }

  for (let i = 0; i < mediaRows.length; i++) {
    const row = mediaRows[i]
    await collection.doc(row._id).update({
      data: {
        order: i + 1,
        weight: Math.max(1, 1000000 - i),
        updatedAt: Date.now()
      }
    })
  }

  const latestAfterOrder = await fetchCollectionDocs('media_feed', { sourceTag: INSPIRATION_SOURCE_TAG })
  const placeholders = latestAfterOrder.filter((row) => row.type === 'shop-placeholder')
  const expectedPlaceholderCount = Math.max(0, INSPIRATION_MIN_RENDER_COUNT - mediaRows.length)

  if (placeholders.length > expectedPlaceholderCount) {
    const extra = placeholders.slice(expectedPlaceholderCount)
    for (const row of extra) {
      try {
        await collection.doc(row._id).remove()
        removed++
      } catch (e) {}
    }
  }

  for (let i = 0; i < expectedPlaceholderCount; i++) {
    const docId = `media_feed_placeholder_${i + 1}`
    const placeholderDoc = buildInspirationPlaceholderDoc(i)
    placeholderDoc.order = mediaRows.length + i + 1
    placeholderDoc.updatedAt = Date.now()
    await collection.doc(docId).set({ data: placeholderDoc })
  }

  return {
    success: true,
    sourceTag: INSPIRATION_SOURCE_TAG,
    sourceStats,
    totalInput: files.length,
    upserted,
    invalidCount: invalidFiles.length,
    invalidFiles: invalidFiles.slice(0, 200),
    deletedInput: deletedPaths.length,
    validMedia: mediaRows.length,
    placeholderCount: expectedPlaceholderCount,
    removed,
    minRenderCount: INSPIRATION_MIN_RENDER_COUNT,
    removeMissing
  }
}

function buildDefaultMediaAssets() {
  const keys = [
    'Figma网站静态预览图/Figma静态图.jpg',
    // 首页轮播图仅由后台「轮播图管理」写入 sourceTag:carousel，避免种子与后台重复、删了又出现
    '星舰建设进度图/starship/星舰二级生产进度.png',
    '星舰建设进度图/starship/星舰二级生产进度.png',
    '星舰建设进度图/superheavy/超重助推器生产进度.png',
    '最新版星舰组合体进展一二级图/b19_spacex3.webp',
    '最新版星舰组合体进展一二级图/s39_spacex.webp',

    '火箭配置图/default.jpg',
    '火箭配置图/Falcon 9 Block 5.jpg',
    '火箭配置图/Falcon Heavy.jpg',
    '火箭配置图/Electron.jpg',
    '火箭配置图/New-Shepard.jpg',
    '火箭配置图/New Shepard.jpg',
    '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
    '火箭配置图/SLS_Block_1.jpg',
    '火箭配置图/Vulcan VC4S.jpg',
    '火箭配置图/pslv_dl.jpg',
    '火箭配置图/Ceres-1S.jpg',
    '火箭配置图/Ceres-2.jpg',
    '火箭配置图/Spectrum-Flight-1.jpg',
    '火箭配置图/Jielong-3.jpg',
    '火箭配置图/p1LVM-3 Mark-3.jpg',
    '火箭配置图/Starship V3 Flight 12.jpg',
    '火箭配置图/Long March 8A CZ-8A_SatNet_LEO-14.jpg',
    '火箭配置图/Long-March-6A-CZ-6A_SatNet_LEO_Group_05.jpg',
    '火箭配置图/Long March 7A.jpg',
    '火箭配置图/LongMarch2C.jpg',
    '火箭配置图/Long_March_3BE.jpg',
    '火箭配置图/Long_March_4B_rocket.jpg',
    '火箭配置图/CZ-12A Long March 12A.jpg',
    '火箭配置图/LongMarch12B.jpg',
    '火箭配置图/LM12.jpg',
    '火箭配置图/Alpha Block 1.jpg',
    '火箭配置图/Ariane 64.jpg',
    '火箭配置图/CZ-7A_YG-45.jpg',
    '火箭配置图/GSLV Mk II.jpg',
    '火箭配置图/H3-30S.jpg',
    '火箭配置图/KAIROS.jpg',
    '火箭配置图/KSLV-2.jpg',
    '火箭配置图/Long March 11H.jpg',
    '火箭配置图/Long March 2D.jpg',
    '火箭配置图/Long March 2FG.jpg',
    '火箭配置图/Long March 4C.jpg',
    '火箭配置图/Long March 5BYZ-2.jpg',
    '火箭配置图/LongMarch12B.jpg',
    '火箭配置图/Long_March_3BE.jpg',
    '火箭配置图/Long_March_4B_rocket.jpg',
    '火箭配置图/Minotaur IV.jpg',
    '火箭配置图/New Glenn.jpg',
    '火箭配置图/Pegasus XL.jpg',
    '火箭配置图/Tianlong 2.jpg',
    '火箭配置图/Vega C.jpg',
    '火箭配置图/ZhuQue-2E.jpg',
    '火箭配置图/ZhuQue-3.jpg'
  ]

  const uniqueKeys = [...new Set(keys)]
  return uniqueKeys.map((key) => ({ key, url: toCOSUrl(key), enabled: true, sourceTag: 'default-bundle' }))
}

function buildDefaultMediaFeed() {
  return []
}

function buildDefaultShopFeed() {
  return [
    {
      title: 'SHOP 产品位 1',
      desc: '后续接入微信小店后自动替换',
      coverFileID: toCOSUrl('首页轮播图/轮播图1.jpg'),
      aspectRatio: 0.94,
      order: 1,
      enabled: true
    },
    {
      title: 'SHOP 产品位 2',
      desc: '后续接入微信小店后自动替换',
      coverFileID: toCOSUrl('首页轮播图/轮播图2.jpg'),
      aspectRatio: 0.94,
      order: 2,
      enabled: true
    }
  ]
}

function buildFeedDocId(collectionName, item, index) {
  const rawId = (item && (item.id || item._id))
    || `${collectionName}_${item && item.type ? item.type : 'item'}_${item && item.order ? item.order : index + 1}`
  return String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)
}

async function importFeedCollection(collectionName, docs = [], options = {}) {
  const collection = db.collection(collectionName)
  if (!Array.isArray(docs) || !docs.length) {
    return { collectionName, total: 0, created: 0, updated: 0, disabled: 0 }
  }

  const sourceTag = options && options.sourceTag ? String(options.sourceTag) : 'manual'
  const pruneMissing = !!(options && options.pruneMissing)
  const now = Date.now()

  let created = 0
  let updated = 0
  let disabled = 0
  const incomingDocIds = new Set()

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const docId = buildFeedDocId(collectionName, doc, i)
    incomingDocIds.add(docId)

    try {
      let existing = null
      try {
        existing = await collection.doc(docId).get()
      } catch (e) {}

      const payload = {
        ...doc,
        sourceTag,
        updatedAt: now,
        createdAt: (doc && doc.createdAt) || (existing && existing.data && existing.data.createdAt) || now
      }

      await collection.doc(docId).set({ data: payload })
      if (existing && existing.data) updated++
      else created++
    } catch (e) {
    }
  }

  if (pruneMissing) {
    let hasMore = true
    let skip = 0
    const limit = 100

    while (hasMore) {
      const res = await collection
        .where({ sourceTag })
        .field({ _id: true, enabled: true })
        .skip(skip)
        .limit(limit)
        .get()

      const rows = (res && res.data) || []
      for (const row of rows) {
        if (row && row._id && !incomingDocIds.has(row._id) && row.enabled !== false) {
          await collection.doc(row._id).update({
            data: {
              enabled: false,
              updatedAt: now
            }
          })
          disabled++
        }
      }

      hasMore = rows.length === limit
      skip += rows.length
    }
  }

  return { collectionName, total: docs.length, created, updated, disabled, sourceTag, pruneMissing }
}

async function initAppCollectionsAndSeed(payload = {}) {
  const now = Date.now()

  const mediaAssets = Array.isArray(payload.assets) && payload.assets.length
    ? payload.assets
    : buildDefaultMediaAssets()

  const mediaFeedSource = Array.isArray(payload.mediaFeed) && payload.mediaFeed.length
    ? payload.mediaFeed
    : buildDefaultMediaFeed()

  const shopFeedSource = Array.isArray(payload.shopFeed) && payload.shopFeed.length
    ? payload.shopFeed
    : buildDefaultShopFeed()

  const sourceTag = payload && payload.sourceTag ? String(payload.sourceTag) : 'inspiration'
  const pruneMissingAssets = !!(payload && payload.pruneMissingAssets)
  const pruneMissingFeeds = !!(payload && payload.pruneMissingFeeds)
  const preserveExistingAssets = payload && Object.prototype.hasOwnProperty.call(payload, 'preserveExistingAssets')
    ? !!payload.preserveExistingAssets
    : true

  const mediaFeed = mediaFeedSource
    .map((item) => normalizeInspirationMediaItem(item))
    .map((item) => ({ ...item, createdAt: item.createdAt || now, updatedAt: now }))
  const shopFeed = shopFeedSource.map((item) => ({ ...item, createdAt: item.createdAt || now, updatedAt: now }))

  // 顺序固定：先同步 media_assets，再导入 media_feed（shop_feed 改为手动维护，不自动写入）
  const mediaResult = await syncMediaAssetsMappings(mediaAssets, {
    sourceTag,
    pruneMissing: pruneMissingAssets,
    preserveExisting: preserveExistingAssets
  })
  const feedResult = await importFeedCollection('media_feed', mediaFeed, {
    sourceTag,
    pruneMissing: pruneMissingFeeds
  })

  return {
    success: !!(mediaResult && mediaResult.success),
    sourceTag,
    pruneMissingAssets,
    pruneMissingFeeds,
    mediaAssets: mediaResult,
    mediaFeed: feedResult,
    shopFeed: {
      skipped: true,
      reason: 'shop_feed_manual_only',
      total: shopFeed.length
    }
  }
}

async function fetchCollectionDocs(collectionName, whereCondition = null) {
  const collection = db.collection(collectionName)
  const limit = 100
  let hasMore = true
  let skip = 0
  const docs = []

  while (hasMore) {
    const query = whereCondition ? collection.where(whereCondition) : collection
    const res = await query.skip(skip).limit(limit).get()
    const rows = (res && res.data) || []
    docs.push(...rows)
    hasMore = rows.length === limit
    skip += rows.length
  }

  return docs
}

async function repairInspirationPathInCollection(collectionName, sourceTag = 'inspiration') {
  const collection = db.collection(collectionName)
  const docs = await fetchCollectionDocs(collectionName, { sourceTag })
  let updated = 0

  for (const doc of docs) {
    const payload = normalizeInspirationMediaItem(doc)

    const changed = JSON.stringify({
      fileID: doc.fileID,
      coverFileID: doc.coverFileID,
      previewImages: doc.previewImages,
      images: doc.images
    }) !== JSON.stringify({
      fileID: payload.fileID,
      coverFileID: payload.coverFileID,
      previewImages: payload.previewImages,
      images: payload.images
    })

    if (!changed) continue

    const updateData = {
      updatedAt: Date.now()
    }
    if (typeof payload.fileID !== 'undefined') updateData.fileID = payload.fileID
    if (typeof payload.coverFileID !== 'undefined') updateData.coverFileID = payload.coverFileID
    if (typeof payload.previewImages !== 'undefined') updateData.previewImages = payload.previewImages
    if (typeof payload.images !== 'undefined') updateData.images = payload.images

    await collection.doc(doc._id).update({
      data: updateData
    })
    updated++
  }

  return { collectionName, total: docs.length, updated, sourceTag }
}

async function repairInspirationDataPaths(payload = {}) {
  const sourceTag = payload && payload.sourceTag ? String(payload.sourceTag) : 'inspiration'
  const mediaFeed = await repairInspirationPathInCollection('media_feed', sourceTag)

  return {
    success: true,
    sourceTag,
    oldDir: INSPIRATION_OLD_DIR,
    newDir: INSPIRATION_DIR,
    mediaFeed,
    shopFeed: {
      skipped: true,
      reason: 'shop_feed_manual_only'
    }
  }
}

async function exportInspirationTemplates(payload = {}) {
  const sourceTag = payload && payload.sourceTag ? String(payload.sourceTag) : 'inspiration'
  const includeCurrent = payload && payload.includeCurrent !== false

  const templates = {
    assets: buildDefaultMediaAssets(),
    mediaFeed: buildDefaultMediaFeed(),
    shopFeed: buildDefaultShopFeed()
  }

  if (!includeCurrent) {
    return {
      success: true,
      sourceTag,
      templates
    }
  }

  const [currentAssets, currentMediaFeed, currentShopFeed] = await Promise.all([
    fetchCollectionDocs('media_assets', { sourceTag }),
    fetchCollectionDocs('media_feed', { sourceTag }),
    fetchCollectionDocs('shop_feed', { sourceTag })
  ])

  return {
    success: true,
    sourceTag,
    templates,
    current: {
      assets: currentAssets,
      mediaFeed: currentMediaFeed,
      shopFeed: currentShopFeed
    },
    usage: {
      action: 'syncCloudInspirationData',
      requiredFields: ['action'],
      optionalFields: ['assets', 'mediaFeed', 'shopFeed', 'sourceTag', 'pruneMissingAssets', 'pruneMissingFeeds']
    }
  }
}

/**
 * 自动清理已完成任务的竞猜记录
 * 检查 launch_votes 中的记录，如果对应任务状态为 success/failure/partial/cancelled，直接删除
 */
function _voteParseTimeMs(t) {
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function _voteTimesDiffer(a, b, toleranceMs) {
  const am = _voteParseTimeMs(a)
  const bm = _voteParseTimeMs(b)
  if (!am || !bm) return false
  return Math.abs(am - bm) > toleranceMs
}

function _voteRoundBaseline(vote) {
  const currentRound = vote.currentRound || 1
  const rounds = vote.rounds || []
  const roundInfo = rounds.find(function (r) { return r.round === currentRound })
  if (roundInfo && roundInfo.launchTime) return roundInfo.launchTime
  if (vote.lockedLaunchTime) return vote.lockedLaunchTime
  return vote.launchTime || ''
}

function _voteUpsertRound(rounds, roundNum, patch) {
  const next = Array.isArray(rounds) ? rounds.slice() : []
  const idx = next.findIndex(function (r) { return r.round === roundNum })
  const base = idx >= 0 ? next[idx] : { round: roundNum, launchTime: '', result: '', settledAt: '' }
  const entry = Object.assign({}, base, patch, { round: roundNum })
  if (idx >= 0) next[idx] = entry
  else next.push(entry)
  return next
}

function _voteLaunchTerminal(found) {
  const abbrev = (found && found.status && found.status.abbrev) || ''
  const name = (found && found.status && found.status.name) || ''
  return /success|failure|partial failure|partial|cancel|scrub|abort|hold/i.test(abbrev) ||
    /cancel|scrub|abort/i.test(name)
}

/** launch 不在列表缓存时，用 vote 自身字段推断是否已终态 */
function _voteIsTerminalContext(vote, found) {
  if (found && _voteLaunchTerminal(found)) return true
  if (!vote) return false
  const hasResult = vote.result === 'ge' || vote.result === 'buge'
  return !!(hasResult && vote.settledAt && vote.votingClosed)
}

function _launchDataRowToFound(row) {
  if (!row) return null
  const statusName = row.status ? String(row.status) : ''
  let abbrev = ''
  if (/success/i.test(statusName)) abbrev = 'Success'
  else if (/fail/i.test(statusName)) abbrev = 'Failure'
  else if (/cancel|scrub|abort/i.test(statusName)) abbrev = 'TBD'
  const net = row.launchTime ||
    (row.windowStart instanceof Date ? row.windowStart.toISOString() : row.windowStart) ||
    ''
  return {
    id: row.id || row._id,
    net: net,
    window_start: net,
    status: { abbrev: abbrev, name: statusName }
  }
}

/** 列表 cache 未命中时：detail cache → launch_data → LL2 单条详情 */
async function _resolveLaunchForVoteOps(launchId, cachedLaunches) {
  if (!launchId) return null
  const id = String(launchId)
  const fromList = (cachedLaunches || []).find(function (l) {
    return l && String(l.id) === id
  })
  if (fromList) return fromList

  const detailCacheKey = 'api_cache_/launches/' + id + '/_' +
    JSON.stringify({ format: 'json', mode: 'detailed' }) + '_full_v5'
  try {
    const doc = await db.collection('space_devs_cache').doc(detailCacheKey).get()
    const nested = doc && doc.data && doc.data.data
    const data = nested && nested.data ? nested.data : nested
    if (data && data.id) return data
  } catch (e) {}

  try {
    const res = await db.collection('launch_data').where({ id: id }).limit(1).get()
    const row = res.data && res.data[0]
    const mapped = _launchDataRowToFound(row)
    if (mapped && mapped.id) return mapped
  } catch (e) {}

  try {
    const fullUrl = LAUNCH_LIBRARY_API + '/launches/' + encodeURIComponent(id) +
      '/?mode=detailed&format=json'
    const apiData = await Promise.race([
      fetchAPI(fullUrl),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('LL2 launch timeout')) }, 15000)
      })
    ])
    if (apiData && apiData.id) return apiData
  } catch (e) {
    console.error('[vote rebuild] fetch launch failed:', id, e.message || e)
  }
  return null
}

function _voteComputeResult(baselineTime, actualTime, statusAbbrev, statusName, toleranceMs) {
  if (/cancel|scrub|abort/i.test(statusAbbrev) || /cancel|scrub|abort/i.test(statusName)) {
    return 'ge'
  }
  if (actualTime) {
    const diffMs = Math.abs(_voteParseTimeMs(actualTime) - _voteParseTimeMs(baselineTime))
    return diffMs > toleranceMs ? 'ge' : 'buge'
  }
  return 'buge'
}

function _voteBuildPostponePatch(vote, latestTime) {
  const currentRound = vote.currentRound || 1
  const baseline = _voteRoundBaseline(vote)
  const rounds = _voteUpsertRound(vote.rounds, currentRound, {
    launchTime: baseline,
    result: 'ge',
    settledAt: new Date().toISOString()
  })
  return {
    rounds: rounds,
    currentRound: currentRound + 1,
    result: '',
    resultNote: '',
    settledAt: '',
    votingClosed: false,
    lockedLaunchTime: '',
    launchTime: latestTime || vote.launchTime || baseline,
    updatedAt: new Date().toISOString()
  }
}

function _voteDetectPostponement(vote, latestTime, found, toleranceMs) {
  const baseline = _voteRoundBaseline(vote)
  if (!baseline || !latestTime) return false
  if (_voteTimesDiffer(baseline, latestTime, toleranceMs)) return true
  const baselineMs = _voteParseTimeMs(baseline)
  const latestMs = _voteParseTimeMs(latestTime)
  const nowMs = Date.now()
  if (baselineMs > 0 && nowMs - baselineMs > toleranceMs && latestMs > nowMs + toleranceMs) {
    if (!found || !_voteLaunchTerminal(found)) return true
  }
  return false
}

/** Starship | Flight 12 — LL2 launch UUID（见 vote-rounds-from-updates.js） */
const _VOTE_FLIGHT12_LAUNCH_ID = voteRoundsFromUpdates.VOTE_FLIGHT12_LAUNCH_ID

function _voteParseNetFromUpdateComment(comment, refIso) {
  return voteRoundsFromUpdates.parseNetFromUpdateComment(comment, refIso)
}

function _voteExtractAttemptNetsFromUpdates(updates) {
  return voteRoundsFromUpdates.extractAttemptNetsFromUpdates(updates)
}

function _voteTrimAttemptNetsForTerminal(attempts, found) {
  return voteRoundsFromUpdates.trimAttemptNetsForTerminal(attempts, found)
}

function _voteBuildRoundsFromAttemptNets(attemptNets, found) {
  return voteRoundsFromUpdates.buildRoundsFromAttemptNets(attemptNets, found)
}

function _tryBuildRoundsFromNetHistory(vote, found, updates) {
  return voteRoundsFromUpdates.tryBuildRoundsFromNetHistory(vote, found, updates)
}

const _VOTE_UPDATES_CACHE_TTL_MS = 30 * 60 * 1000
const _VOTE_UPDATES_FETCH_LIMIT = 100
const _VOTE_UPDATES_FETCH_TIMEOUT_MS = 22000

function _normalizeVoteRebuildUpdateRow(u) {
  if (!u || typeof u !== 'object') return null
  const comment = String(u.comment || u.text || u.description || '').trim()
  const createdOn = u.createdOn || u.created_on || u.createdAt || u.created_at || ''
  if (!comment && !createdOn) return null
  return {
    id: u.id,
    comment: comment,
    createdOn: createdOn,
    infoUrl: typeof u.infoUrl === 'string' ? u.infoUrl.trim()
      : (typeof u.info_url === 'string' ? u.info_url.trim() : '')
  }
}

function _normalizeVoteRebuildUpdates(raw) {
  if (!raw) return []
  const arr = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw.results) ? raw.results : (Array.isArray(raw.data) ? raw.data : []))
  return arr.map(_normalizeVoteRebuildUpdateRow).filter(Boolean)
}

function _voteRebuildUpdatesSufficient(updates) {
  return voteRoundsFromUpdates.updatesSufficientForHistoryRebuild(updates)
}

function _voteRebuildUpdatesMeta(updates) {
  const list = _normalizeVoteRebuildUpdates(updates)
  const attempts = voteRoundsFromUpdates.extractAttemptNetsFromUpdates(list)
  return {
    updatesCount: list.length,
    attemptsCount: attempts.length,
    sufficient: _voteRebuildUpdatesSufficient(list)
  }
}

async function _writeVoteRebuildUpdatesCache(launchId, updates) {
  const cacheDocId = 'updates_' + String(launchId)
  try {
    await db.collection('launch_timeline_cache').doc(cacheDocId).set({
      data: {
        data: updates,
        updatedAt: db.serverDate(),
        updatedAtMs: Date.now(),
        source: 'rebuildVoteSettle'
      }
    })
  } catch (e) {
    console.error('[vote rebuild] cache write failed:', launchId, e.message || e)
  }
}

async function _fetchLaunchUpdatesFromApi(launchId) {
  const id = String(launchId)
  const all = []
  let offset = 0
  let pages = 0
  const maxPages = 8

  while (pages < maxPages) {
    const url = LAUNCH_LIBRARY_API + '/updates/?format=json&launch=' +
      encodeURIComponent(id) + '&ordering=created_on&limit=' + _VOTE_UPDATES_FETCH_LIMIT +
      '&offset=' + offset
    const apiData = await Promise.race([
      fetchAPI(url),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('LL2 updates timeout')) }, _VOTE_UPDATES_FETCH_TIMEOUT_MS)
      })
    ])
    const results = Array.isArray(apiData && apiData.results) ? apiData.results : []
    const mapped = results.map(function (u) {
      return _normalizeVoteRebuildUpdateRow({
        id: u.id,
        comment: u.comment,
        created_on: u.created_on,
        info_url: u.info_url
      })
    }).filter(Boolean)
    all.push.apply(all, mapped)
    pages++
    if (!results.length || results.length < _VOTE_UPDATES_FETCH_LIMIT) break
    if (!apiData.next) break
    offset += results.length
  }

  return all
}

async function _fetchLaunchUpdatesForVoteRebuild(launchId) {
  if (!launchId) return { updates: [], source: 'none', cacheRejected: false }

  const cacheDocId = 'updates_' + String(launchId)
  let cacheRejected = false
  try {
    const cacheRes = await db.collection('launch_timeline_cache').doc(cacheDocId).get()
    const cached = cacheRes && cacheRes.data
    const record = (cached && Array.isArray(cached.data))
      ? cached
      : (cached && cached.data && typeof cached.data === 'object' ? cached.data : cached)
    const nested = record && record.data && !Array.isArray(record.data)
      ? record.data
      : (record && record.data ? record.data : record)
    const updatedAtMs = (record && record.updatedAtMs) || (cached && cached.updatedAtMs) || 0
    const fresh = updatedAtMs > 0 &&
      (Date.now() - updatedAtMs) < _VOTE_UPDATES_CACHE_TTL_MS
    const normalized = _normalizeVoteRebuildUpdates(nested)
    if (normalized.length && fresh && _voteRebuildUpdatesSufficient(normalized)) {
      return { updates: normalized, source: 'cache', cacheRejected: false }
    }
    if (normalized.length) {
      cacheRejected = true
      console.warn('[vote rebuild] reject insufficient updates cache:', launchId,
        'count=', normalized.length, 'attempts=',
        voteRoundsFromUpdates.extractAttemptNetsFromUpdates(normalized).length)
    }
  } catch (e) {}

  const delays = [0, 1200, 3000]
  let lastErr = null
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await new Promise(function (r) { setTimeout(r, delays[i]) })
    }
    try {
      const fetched = await _fetchLaunchUpdatesFromApi(launchId)
      if (fetched.length) {
        if (_voteRebuildUpdatesSufficient(fetched)) {
          await _writeVoteRebuildUpdatesCache(launchId, fetched)
        }
        return {
          updates: fetched,
          source: i === 0 ? 'api' : 'api_retry',
          cacheRejected: cacheRejected
        }
      }
    } catch (e) {
      lastErr = e
      console.error('[vote rebuild] fetch updates attempt', i + 1, launchId, e.message || e)
    }
  }

  if (lastErr) {
    console.error('[vote rebuild] fetch updates failed:', launchId, lastErr.message || lastErr)
  }
  return { updates: [], source: 'none', cacheRejected: cacheRejected }
}

function _voteHistoryPatchDiffers(vote, historyPatch) {
  if (!historyPatch || !historyPatch.rounds) return true
  const existing = (vote && vote.rounds) || []
  const next = historyPatch.rounds
  if (existing.length !== next.length) return true
  for (let i = 0; i < next.length; i++) {
    const a = existing[i] || {}
    const b = next[i] || {}
    if (a.round !== b.round || a.result !== b.result) return true
    if (a.launchTime && b.launchTime && _voteTimesDiffer(a.launchTime, b.launchTime, _VOTE_THIRTY_MIN)) {
      return true
    }
  }
  if (vote.result !== historyPatch.result) return true
  if ((vote.currentRound || 1) !== historyPatch.currentRound) return true
  return false
}

/** settleVotes 常量，重算与定时结算共用 */
const _VOTE_THIRTY_MIN = 30 * 60 * 1000
const _VOTE_SETTLE_AFTER_LOCK_MS = 60 * 60 * 1000
const _VOTE_NET_DONE_GRACE_MS = 15 * 60 * 1000

function _voteLatestLaunchTime(found, vote) {
  return (found && found.net) || (found && found.window_start) || (vote && vote.launchTime) || ''
}

/** 成败竞猜：按发射终态结算（成功/部署→success；失败/部分失败/取消等→failure） */
function _voteComputeOutcomeResult(found) {
  if (!found || !found.status) return ''
  const id = Number(found.status.id) || 0
  const abbrev = String(found.status.abbrev || '').toLowerCase()
  const name = String(found.status.name || '').toLowerCase()
  // LL2: 3 success, 4 failure, 7 partial failure, 9 payload deployed
  if (id === 3 || id === 9) return 'success'
  if (id === 4 || id === 7) return 'failure'
  if (/payload\s*deployed|success/.test(abbrev + ' ' + name) && !/partial|failure|fail/.test(abbrev + ' ' + name)) {
    return 'success'
  }
  if (/partial\s*failure|failure|fail|cancel|scrub|abort/.test(abbrev + ' ' + name)) {
    return 'failure'
  }
  return ''
}

/**
 * 成败竞猜结算：关盘 + 按终态揭晓（不走改期轮次）
 * @returns {{ kind: 'none'|'lock'|'settle', patch?: object }}
 */
function _applySettleOutcomeVotePass(vote, found, opts) {
  const nowMs = (opts && opts.nowMs) || Date.now()
  const THIRTY_MIN = (opts && opts.THIRTY_MIN) || _VOTE_THIRTY_MIN

  if (!vote || !vote.launchId) return { kind: 'none' }
  if (vote.result === 'success' || vote.result === 'failure') return { kind: 'none' }

  const latestTime = _voteLatestLaunchTime(found, vote)

  if (!vote.votingClosed && !vote.result && (latestTime || vote.launchTime)) {
    const lt = _voteParseTimeMs(latestTime || vote.launchTime)
    if (lt > 0 && lt - nowMs < THIRTY_MIN) {
      return {
        kind: 'lock',
        patch: {
          votingClosed: true,
          lockedLaunchTime: latestTime || vote.launchTime,
          updatedAt: new Date().toISOString()
        }
      }
    }
  }

  const outcome = _voteComputeOutcomeResult(found)
  if (outcome) {
    return {
      kind: 'settle',
      patch: {
        result: outcome,
        resultNote: '系统按发射状态自动结算',
        votingClosed: true,
        settledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  }

  return { kind: 'none' }
}

/**
 * 对单条 launch_vote 执行一轮 settleVotes 逻辑（改期 / 关盘 / 结算）
 * @returns {{ kind: 'none'|'postpone'|'lock'|'settle'|'legacy_settle', patch?: object }}
 */
function _applySettleVotePass(vote, found, opts) {
  const nowMs = (opts && opts.nowMs) || Date.now()
  const THIRTY_MIN = (opts && opts.THIRTY_MIN) || _VOTE_THIRTY_MIN
  const SETTLE_AFTER_LOCK_MS = (opts && opts.SETTLE_AFTER_LOCK_MS) || _VOTE_SETTLE_AFTER_LOCK_MS
  const NET_DONE_GRACE_MS = (opts && opts.NET_DONE_GRACE_MS) || _VOTE_NET_DONE_GRACE_MS

  if (!vote || !vote.launchId) return { kind: 'none' }
  if (vote.voteType === 'outcome') return _applySettleOutcomeVotePass(vote, found, opts)

  const latestTime = _voteLatestLaunchTime(found, vote)
  const currentRound = vote.currentRound || 1
  const rounds = vote.rounds || []
  const currentRoundInfo = rounds.find(function (r) { return r.round === currentRound })
  const currentRoundSettled = !!(currentRoundInfo && currentRoundInfo.result)

  if (!currentRoundSettled && latestTime && _voteDetectPostponement(vote, latestTime, found, THIRTY_MIN)) {
    return { kind: 'postpone', patch: _voteBuildPostponePatch(vote, latestTime) }
  }

  if (!vote.votingClosed && !currentRoundSettled && vote.launchTime) {
    const baseline = _voteRoundBaseline(vote)
    const lt = _voteParseTimeMs(baseline || latestTime || vote.launchTime)
    if (lt > 0 && lt - nowMs < THIRTY_MIN) {
      const lockTime = baseline || latestTime || vote.launchTime
      return {
        kind: 'lock',
        patch: { votingClosed: true, lockedLaunchTime: lockTime, updatedAt: new Date().toISOString() }
      }
    }
  }

  if (vote.votingClosed && !currentRoundSettled && vote.lockedLaunchTime) {
    const lockedMs = _voteParseTimeMs(vote.lockedLaunchTime)
    const netStr = (found && found.net) || ''
    const netMs = netStr ? _voteParseTimeMs(netStr) : 0
    const abbrevB = (found && found.status && found.status.abbrev) || ''
    const nameB = (found && found.status && found.status.name) || ''
    const launchClearlyDone =
      netMs > 0 &&
      nowMs - netMs > NET_DONE_GRACE_MS &&
      _voteLaunchTerminal(found)
    const waitAfterLockOk = lockedMs > 0 && nowMs - lockedMs >= SETTLE_AFTER_LOCK_MS
    if (waitAfterLockOk || launchClearlyDone) {
      const currentTime = netStr || ((found && found.window_start) || '')
      const result = _voteComputeResult(vote.lockedLaunchTime, currentTime, abbrevB, nameB, THIRTY_MIN)
      const updatedRounds = _voteUpsertRound(vote.rounds, currentRound, {
        launchTime: vote.lockedLaunchTime,
        result: result,
        settledAt: new Date().toISOString()
      })
      return {
        kind: 'settle',
        patch: {
          result: result,
          rounds: updatedRounds,
          currentLaunchTime: currentTime,
          settledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    }
  }

  if (!currentRoundSettled && !vote.lockedLaunchTime && vote.launchTime) {
    const baseline = _voteRoundBaseline(vote)
    const ltMs = _voteParseTimeMs(baseline)
    if (ltMs > 0 && nowMs - ltMs >= SETTLE_AFTER_LOCK_MS) {
      const statusAbbrev = (found && found.status && found.status.abbrev) || ''
      const statusName = (found && found.status && found.status.name) || ''
      const currentTime = (found && found.net) || (found && found.window_start) || ''
      const result = _voteComputeResult(baseline, currentTime, statusAbbrev, statusName, THIRTY_MIN)
      if (result) {
        const updatedRounds = _voteUpsertRound(vote.rounds, currentRound, {
          launchTime: baseline,
          result: result,
          settledAt: new Date().toISOString()
        })
        return {
          kind: 'legacy_settle',
          patch: {
            result: result,
            rounds: updatedRounds,
            lockedLaunchTime: baseline,
            votingClosed: true,
            currentLaunchTime: currentTime || baseline,
            settledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      }
    }
  }

  return { kind: 'none' }
}

/** 判断历史结算是否需重算（漏判改期、rounds 与主 result 不一致等） */
function _voteNeedsRebuild(vote, found, onlyWrong) {
  if (!vote || !vote.launchId) return false
  const latestTime = _voteLatestLaunchTime(found, vote)
  const hasResult = vote.result === 'ge' || vote.result === 'buge'

  if (onlyWrong) {
    return vote.result === 'buge' && !!latestTime &&
      _voteDetectPostponement(vote, latestTime, found, _VOTE_THIRTY_MIN)
  }

  if (!hasResult) return false

  const currentRound = vote.currentRound || 1
  const rounds = vote.rounds || []
  const roundInfo = rounds.find(function (r) { return r.round === currentRound })
  const settledCount = rounds.filter(function (r) { return r && r.result }).length
  const geCount = rounds.filter(function (r) { return r && r.result === 'ge' }).length

  if (!roundInfo || !roundInfo.result || roundInfo.result !== vote.result) return true

  // 已完成发射但 rounds 明显少于 currentRound（如 Flight 12 仅 R1:鸽）
  if (_voteIsTerminalContext(vote, found) && currentRound > settledCount) return true
  if (_voteIsTerminalContext(vote, found) && vote.result === 'buge' && geCount <= 1 && currentRound >= 3) {
    return true
  }
  // 已完成发射但仅单轮 ge（如 Flight 12 漏判多轮改期，DB 只有 R1:鸽 + result=ge）
  if (_voteIsTerminalContext(vote, found) && vote.result === 'ge' &&
    (settledCount <= 1 || rounds.length <= 1)) {
    return true
  }
  // 不依赖 launch 缓存：已关盘且仅单轮 ge，疑似多轮改期被压成一轮
  if (vote.result === 'ge' && vote.votingClosed &&
    (settledCount <= 1 || rounds.length <= 1)) {
    return true
  }

  if (vote.result === 'buge' && latestTime &&
    _voteDetectPostponement(vote, latestTime, found, _VOTE_THIRTY_MIN)) {
    return true
  }

  const baseline = vote.lockedLaunchTime || _voteRoundBaseline(vote)
  const netStr = (found && found.net) || ''
  if (baseline && netStr) {
    const abbrev = (found && found.status && found.status.abbrev) || ''
    const name = (found && found.status && found.status.name) || ''
    const expected = _voteComputeResult(baseline, netStr, abbrev, name, _VOTE_THIRTY_MIN)
    if (expected && expected !== vote.result &&
      !(vote.result === 'buge' && _voteDetectPostponement(vote, latestTime, found, _VOTE_THIRTY_MIN))) {
      return true
    }
  }

  return false
}

/** 重算前重置：回到第 1 轮，保留投票计数与元数据 */
function _voteRebuildResetPatch(vote, found) {
  const rounds = vote.rounds || []
  const r1 = rounds.find(function (r) { return r.round === 1 })
  const initialTime =
    (r1 && r1.launchTime) ||
    vote.lockedLaunchTime ||
    vote.launchTime ||
    _voteLatestLaunchTime(found, vote)
  return {
    result: '',
    resultNote: '',
    settledAt: '',
    votingClosed: false,
    lockedLaunchTime: '',
    currentRound: 1,
    rounds: [],
    launchTime: initialTime,
    currentLaunchTime: _voteLatestLaunchTime(found, vote) || initialTime,
    updatedAt: new Date().toISOString()
  }
}

async function _loadCachedLaunchesForVoteOps() {
  let cachedLaunches = await loadCachedLaunchesForVoteSettle()
  try {
    const cacheRes = await db.collection('api_cache')
      .where({ url: db.RegExp({ regexp: 'launches', options: 'i' }) })
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get()
    for (const cache of (cacheRes.data || [])) {
      const list = cache.data && cache.data.results ? cache.data.results : (cache.data && cache.data.list ? cache.data.list : [])
      if (Array.isArray(list)) cachedLaunches = cachedLaunches.concat(list)
    }
  } catch (e) {}
  return cachedLaunches
}

/** 单条竞猜：优先用 LL2 updates 重建多轮；否则重置后循环模拟 settleVotes */
async function _rebuildOneVote(vote, findLaunch, opts) {
  const col = opts.col || 'launch_votes'
  const dryRun = !!opts.dryRun
  const maxLoops = Math.min(20, Math.max(1, Number(opts.maxSettleLoops) || 10))
  const onlyWrong = !!opts.onlyWrong
  const forceHistory = !!opts.forceHistory
  const mustAttempt = !!opts.mustAttempt
  const out = {
    reset: 0, settled: 0, reopened: 0, roundsWritten: 0, historyRebuild: 0, skipReason: '',
    debug: {}
  }

  const found = typeof opts.resolveLaunch === 'function'
    ? await opts.resolveLaunch(vote.launchId)
    : findLaunch(vote.launchId)
  if (!mustAttempt && !forceHistory && !_voteNeedsRebuild(vote, found, onlyWrong)) {
    out.skipReason = 'no_rebuild_needed'
    return out
  }

  const fetchMeta = await _fetchLaunchUpdatesForVoteRebuild(vote.launchId)
  const updates = fetchMeta.updates || []
  const meta = _voteRebuildUpdatesMeta(updates)
  out.debug = {
    updatesCount: meta.updatesCount,
    attemptsCount: meta.attemptsCount,
    updatesSufficient: meta.sufficient,
    updatesSource: fetchMeta.source || 'none',
    cacheRejected: !!fetchMeta.cacheRejected,
    launchResolved: !!(found && found.id),
    launchTerminal: !!(found && _voteLaunchTerminal(found))
  }

  const historyPatch = _tryBuildRoundsFromNetHistory(vote, found, updates)
  out.debug.historyPatchBuilt = !!historyPatch
  if (historyPatch && _voteHistoryPatchDiffers(vote, historyPatch)) {
    out.reset = 1
    out.historyRebuild = 1
    out.roundsWritten = 1
    out.reopened = historyPatch.rounds.filter(function (r) { return r.result === 'ge' }).length
    out.settled = historyPatch.result === 'ge' || historyPatch.result === 'buge' ? 1 : 0
    if (!dryRun) {
      await db.collection(col).doc(vote._id).update({ data: historyPatch })
    }
    Object.assign(vote, historyPatch)
    return out
  }

  if (historyPatch && !_voteHistoryPatchDiffers(vote, historyPatch)) {
    out.skipReason = 'already_correct'
    return out
  }

  if (forceHistory || mustAttempt) {
    out.skipReason = updates.length ? 'no_history_patch' : 'no_updates'
    if (updates.length && !meta.sufficient) {
      out.skipReason = 'updates_insufficient'
    }
    return out
  }

  const resetPatch = _voteRebuildResetPatch(vote, found)
  out.reset = 1
  if (!dryRun) {
    await db.collection(col).doc(vote._id).update({ data: resetPatch })
  }
  Object.assign(vote, resetPatch)

  const settleOpts = {
    nowMs: Date.now(),
    THIRTY_MIN: _VOTE_THIRTY_MIN,
    SETTLE_AFTER_LOCK_MS: _VOTE_SETTLE_AFTER_LOCK_MS,
    NET_DONE_GRACE_MS: _VOTE_NET_DONE_GRACE_MS
  }

  for (let i = 0; i < maxLoops; i++) {
    const f = findLaunch(vote.launchId)
    const pass = _applySettleVotePass(vote, f, settleOpts)
    if (pass.kind === 'none') break

    if (pass.patch && pass.patch.rounds) out.roundsWritten++
    if (pass.kind === 'postpone') out.reopened++
    else if (pass.kind === 'settle' || pass.kind === 'legacy_settle') out.settled++

    if (!dryRun && pass.patch) {
      await db.collection(col).doc(vote._id).update({ data: pass.patch })
    }
    if (pass.patch) {
      Object.assign(vote, pass.patch)
      if (pass.patch.rounds) vote.rounds = pass.patch.rounds
    }
  }

  return out
}

/**
 * 批量重算历史错误竞猜结算（无需手改数据库）
 * @param {object} event - launchId / onlyWrong / dryRun / limit / cursor / all / maxSettleLoops / forceHistory
 */
async function rebuildVoteSettle(event) {
  event = event || {}
  const col = 'launch_votes'
  const _ = db.command
  const limit = Math.min(100, Math.max(1, Number(event.limit) || 20))
  const dryRun = !!event.dryRun
  const onlyWrong = !!event.onlyWrong
  const forceHistory = !!(event.forceHistory === true || event.forceHistory === 'true' || event.forceHistory === 1)
  const launchIdFilter = event.launchId ? String(event.launchId).trim() : ''
  const processAll = !!(event.all === true || event.all === 'true' || event.all === 1)
  const maxSettleLoops = Math.min(20, Math.max(1, Number(event.maxSettleLoops) || 10))

  const stats = {
    scanned: 0, reset: 0, settled: 0, reopened: 0, roundsWritten: 0,
    historyRebuild: 0, skipped: 0, errors: 0, skipReasons: {}
  }
  let cursor = event.cursor != null ? String(event.cursor) : ''
  let done = false
  let lastCursor = cursor

  const cachedLaunches = await _loadCachedLaunchesForVoteOps()
  const launchResolveCache = new Map()
  const resolveLaunch = async function (launchId) {
    const id = String(launchId || '')
    if (!id) return null
    if (launchResolveCache.has(id)) return launchResolveCache.get(id)
    const resolved = await _resolveLaunchForVoteOps(id, cachedLaunches)
    launchResolveCache.set(id, resolved)
    return resolved
  }
  const findLaunch = function (launchId) {
    const id = String(launchId || '')
    if (launchResolveCache.has(id)) return launchResolveCache.get(id)
    return cachedLaunches.find(function (l) { return l && String(l.id) === id })
  }

  do {
    let votes = []
    try {
      if (launchIdFilter) {
        const res = await db.collection(col).where({ launchId: launchIdFilter }).limit(1).get()
        votes = res.data || []
        done = true
      } else if (cursor) {
        const res = await db.collection(col).where({ _id: _.gt(cursor) }).orderBy('_id', 'asc').limit(limit).get()
        votes = res.data || []
      } else {
        const res = await db.collection(col).orderBy('_id', 'asc').limit(limit).get()
        votes = res.data || []
      }
    } catch (qErr) {
      const raw = await db.collection(col).limit(limit).get()
      votes = raw.data || []
      if (cursor) {
        votes = votes.filter(function (v) { return v && v._id && String(v._id) > cursor })
      }
      votes.sort(function (a, b) { return String(a._id).localeCompare(String(b._id)) })
      votes = votes.slice(0, limit)
    }

    if (!votes.length) {
      done = true
      break
    }

    for (const vote of votes) {
      stats.scanned++
      try {
        const found = await resolveLaunch(vote.launchId)
        const mustAttempt = forceHistory || !!launchIdFilter
        if (!mustAttempt && !_voteNeedsRebuild(vote, found, onlyWrong)) {
          stats.skipped++
          stats.skipReasons.no_rebuild_needed = (stats.skipReasons.no_rebuild_needed || 0) + 1
          continue
        }
        const one = await _rebuildOneVote(vote, findLaunch, {
          col: col,
          dryRun: dryRun,
          onlyWrong: onlyWrong,
          forceHistory: forceHistory,
          mustAttempt: mustAttempt,
          maxSettleLoops: maxSettleLoops,
          resolveLaunch: resolveLaunch
        })
        if (one.skipReason) {
          stats.skipped++
          stats.skipReasons[one.skipReason] = (stats.skipReasons[one.skipReason] || 0) + 1
        }
        if (one.debug && Object.keys(one.debug).length) {
          stats.debug = one.debug
        }
        stats.reset += one.reset
        stats.settled += one.settled
        stats.reopened += one.reopened
        stats.roundsWritten += one.roundsWritten
        stats.historyRebuild += one.historyRebuild || 0
      } catch (e) {
        stats.errors++
        console.error('[rebuildVoteSettle] vote error:', vote.launchId, e.message || e)
      }
    }

    lastCursor = votes[votes.length - 1]._id
    cursor = lastCursor
    if (launchIdFilter) {
      done = true
    } else {
      done = votes.length < limit
    }
  } while (processAll && !done && !launchIdFilter)

  return {
    success: true,
    action: 'rebuildVoteSettle',
    stats: stats,
    done: done,
    cursor: done ? '' : lastCursor,
    dryRun: dryRun,
    onlyWrong: onlyWrong,
    forceHistory: forceHistory,
    cacheLaunchCount: cachedLaunches.length
  }
}

async function settleVotes() {
  const col = 'launch_votes'
  const nowMs = Date.now()
  const _ = db.command
  const THIRTY_MIN = _VOTE_THIRTY_MIN
  const SETTLE_AFTER_LOCK_MS = _VOTE_SETTLE_AFTER_LOCK_MS
  const NET_DONE_GRACE_MS = _VOTE_NET_DONE_GRACE_MS
  let locked = 0, settled = 0, reopened = 0

  try {
    // 只处理未结算记录，避免 limit(50) 随机扫到全是已结算旧文档导致 settled 恒为 0
    // 准时：ge/buge；成败：success/failure
    let allVotes
    try {
      allVotes = await db.collection(col).where({
        result: _.nin(['ge', 'buge', 'success', 'failure'])
      }).limit(50).get()
    } catch (qErr) {
      const raw = await db.collection(col).limit(200).get()
      const rows = (raw.data || []).filter(function (v) {
        if (!v || !v.launchId) return false
        return v.result !== 'ge' && v.result !== 'buge' && v.result !== 'success' && v.result !== 'failure'
      })
      allVotes = { data: rows.slice(0, 50) }
    }
    const pendingCount = (allVotes.data && allVotes.data.length) || 0
    if (!pendingCount) return { locked: 0, settled: 0, reopened: 0, cacheLaunchCount: 0, pendingQueried: 0 }

    const cachedLaunches = await _loadCachedLaunchesForVoteOps()
    const findLaunch = (launchId) => cachedLaunches.find(l => l && String(l.id) === String(launchId))
    const settleOpts = { nowMs: nowMs, THIRTY_MIN: THIRTY_MIN, SETTLE_AFTER_LOCK_MS: SETTLE_AFTER_LOCK_MS, NET_DONE_GRACE_MS: NET_DONE_GRACE_MS }

    for (const vote of allVotes.data) {
      if (!vote.launchId) continue

      const found = findLaunch(vote.launchId)
      const pass = _applySettleVotePass(vote, found, settleOpts)
      if (pass.kind === 'none' || !pass.patch) continue

      await db.collection(col).doc(vote._id).update({ data: pass.patch })
      if (pass.kind === 'postpone') reopened++
      else if (pass.kind === 'lock') locked++
      else if (pass.kind === 'settle' || pass.kind === 'legacy_settle') settled++
    }

    return { locked, settled, reopened, cacheLaunchCount: cachedLaunches.length, pendingQueried: pendingCount }
  } catch (e) {
    console.error('[settleVotes] error:', e)
    return { locked, settled, reopened, error: e.message, cacheLaunchCount: 0, pendingQueried: 0 }
  }
}

async function autoCleanVotes() {
  try {
    const col = 'launch_votes'
    const allVotes = await db.collection(col).limit(50).get()
    if (!allVotes.data || allVotes.data.length === 0) return { deleted: 0 }

    // 优先 space_devs_cache，与 settleVotes 一致
    let cachedLaunches = await loadCachedLaunchesForVoteSettle()
    try {
      const cacheRes = await db.collection('api_cache')
        .where({ url: db.RegExp({ regexp: 'launches', options: 'i' }) })
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get()
      for (const cache of (cacheRes.data || [])) {
        const list = cache.data && cache.data.results ? cache.data.results : (cache.data && cache.data.list ? cache.data.list : [])
        if (Array.isArray(list)) cachedLaunches = cachedLaunches.concat(list)
      }
    } catch (e) {}

    let deleted = 0
    const DONE_STATUSES = ['success', 'failure', 'partial failure', 'cancelled', 'cancel']

    for (const vote of allVotes.data) {
      if (!vote.launchId) continue
      // 保留有结算结果的投票记录（供用户查看战绩），仅清理超过30天的已结算记录
      if (vote.result) {
        if (vote.settledAt && Date.now() - new Date(vote.settledAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
          await db.collection(col).doc(vote._id).remove()
          deleted++
        }
        continue
      }
      const found = cachedLaunches.find(l => l && String(l.id) === String(vote.launchId))
      if (!found || !found.status || !found.status.abbrev) continue
      if (DONE_STATUSES.includes(found.status.abbrev.toLowerCase())) {
        await db.collection(col).doc(vote._id).remove()
        deleted++
      }
    }
    return { deleted }
  } catch (e) {
    console.error('[autoCleanVotes] error:', e)
    return { deleted: 0, error: e.message }
  }
}

/** 模块化空间站同步：动态清单（LL2 新增站自动纳入）→ 各站详情 → 对接事件，全部写客户端可读的 api_cache_ key */
async function runModularSyncStations() {
  const stationIds = await resolveActiveStationIds()
  const results = []
  for (const id of stationIds) {
    try {
      results.push(await syncAPIEndpoint(`/space_stations/${id}/`, { format: 'json' }))
    } catch (e) {
      results.push({ url: `/space_stations/${id}/`, success: false, error: e.message })
    }
  }
  try {
    results.push(await syncAPIEndpoint('/docking_events/', { limit: 50, offset: 0, ordering: '-docking', format: 'json' }, null, true, 1, 1))
  } catch (e) {
    results.push({ url: '/docking_events/', success: false, error: e.message })
  }
  // 远征详情（含 crew 成员）依赖上面刚写入的空间站详情缓存里的 active_expeditions id；
  // 一并同步，保证「远征与团队成员」板块可通过 syncStations 一键修复
  try {
    results.push({ url: '/expeditions/', ...(await syncExpeditionDetails()) })
  } catch (e) {
    results.push({ url: '/expeditions/', success: false, error: e.message })
  }
  return results
}

exports.runModularSyncLaunches = runModularSyncLaunches
exports.runModularSyncEvents = runModularSyncEvents
exports.runModularSyncStations = runModularSyncStations

/** 供 vote-rounds-rebuild.test.js 本地验证（勿在生产调用） */
exports._voteRebuildInternals = Object.assign({}, voteRoundsFromUpdates, {
  _VOTE_FLIGHT12_LAUNCH_ID: voteRoundsFromUpdates.VOTE_FLIGHT12_LAUNCH_ID
})

/**
 * 云函数主入口
 */
exports.main = async (event, context) => {
  const { action, url, params } = event

  // 用于确认云端是否已部署到最新代码（每次改动可更新此标识）
  const BUILD_TAG = 'syncSpaceDevsData_2026-07-17_v4_starbase_parse_fix'

  try {
    if (action === 'sync') {
      // 同步指定端点
      if (url) {
        return await syncAPIEndpoint(url, params || {})
      } else {
        // 同步常用端点
        const results = await syncCommonEndpoints()
        
        // 同步expedition详情（动态获取ID）
        const expeditionResult = await syncExpeditionDetails()
        
        // 同步发射统计（独立集合）
        const statsResult = await syncLaunchStats()
        
        // 同步封路通知
        const roadClosureResult = await syncRoadClosure()
        
        // 竞猜自动关盘 + 结算
        const voteSettleResult = await settleVotes()
        // 自动清理已完成任务的竞猜记录
        const voteCleanResult = await autoCleanVotes()
        
        return {
          success: true,
          message: '同步完成',
          results: results,
          expedition: expeditionResult,
          stats: statsResult,
          roadClosure: roadClosureResult,
          voteSettle: voteSettleResult,
          voteClean: voteCleanResult,
          timestamp: Date.now()
        }
      }
    } else if (action === 'syncSpaceXStats') {
      // 手动触发同步 SpaceX 官网发射统计（强制刷新）
      const spacexResult = await syncSpaceXLaunchStats(true)
      return {
        success: true,
        spacexStats: spacexResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncBoosters') {
      // 手动触发同步助推器族谱（强制刷新）
      const boosterResult = await syncBoosterGenealogy(true)
      return {
        success: true,
        boosters: boosterResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncRoadClosure') {
      // 手动触发同步封路通知（强制刷新，跳过缓存节流）
      const roadClosureResult = await syncRoadClosure(true)
      return {
        success: true,
        ...roadClosureResult,
        roadClosure: roadClosureResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncRoadClosureThrottled') {
      // 小时级定时器附带触发：不强制，靠 50 分钟缓存节流
      const roadClosureResult = await syncRoadClosure(false)
      return {
        success: true,
        ...roadClosureResult,
        roadClosure: roadClosureResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncAgencies') {
      const agenciesResult = await syncAgencies()
      return {
        success: true,
        agencies: agenciesResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncAgencyDetail') {
      const agencyId = event.agencyId
      if (!agencyId) return { success: false, message: 'Missing agencyId' }
      const detailResult = await syncAPIEndpoint(
        `/agencies/${agencyId}/`, { format: 'json' }, null, false, 1, 1
      )
      return {
        success: !!(detailResult && detailResult.success),
        agencyId,
        timestamp: Date.now()
      }
    } else if (action === 'clean') {
      // 仅清理过期缓存
      const removed = await cleanExpiredCache()
      return {
        success: true,
        removed: removed,
        timestamp: Date.now()
      }
    } else if (action === 'syncStats') {
      // 仅同步发射统计
      const statsResult = await syncLaunchStats()
      return {
        success: true,
        stats: statsResult,
        buildTag: BUILD_TAG,
        timestamp: Date.now()
      }
    } else if (action === 'settleVotes') {
      const voteSettleResult = await settleVotes()
      return {
        success: true,
        voteSettle: voteSettleResult,
        buildTag: BUILD_TAG,
        timestamp: Date.now()
      }
    } else if (action === 'rebuildVoteSettle' || action === 'batchRecalculateVotes') {
      const rebuildResult = await rebuildVoteSettle(event)
      return Object.assign({}, rebuildResult, { buildTag: BUILD_TAG, timestamp: Date.now() })
    } else if (action === 'autoCleanVotes') {
      const voteCleanResult = await autoCleanVotes()
      return {
        success: true,
        voteClean: voteCleanResult,
        buildTag: BUILD_TAG,
        timestamp: Date.now()
      }
    } else if (action === 'version') {
      return {
        success: true,
        buildTag: BUILD_TAG,
        timestamp: Date.now()
      }
    } else if (action === 'fetchLaunchDetail') {
      // 按需拉取单条 launch 的完整详情（绕过 list 缓存，专治多芯火箭/星舰显示不全）
      // 入参：event.launchId  - LL2 launch UUID
      //      event.forceRefresh - 是否强制刷新（默认 false，命中云端缓存就直接返回）
      const launchId = event.launchId
      if (!launchId || typeof launchId !== 'string') {
        return { success: false, error: 'launchId 不能为空', timestamp: Date.now() }
      }
      // full_v5：详情不再 slim，保留 rocket.configuration 全长/直径/推力等规格字段（用户详情页展示）
      const detailCacheKey = `api_cache_/launches/${launchId}/_${JSON.stringify({ format: 'json', mode: 'detailed' })}_full_v5`
      const forceRefresh = !!event.forceRefresh
      const now = Date.now()

      // 1) 先查云数据库缓存
      if (!forceRefresh) {
        try {
          const doc = await db.collection('space_devs_cache').doc(detailCacheKey).get()
          const cached = doc && doc.data && doc.data.data
          if (cached && cached.data && cached.expireAt && cached.expireAt > now) {
            return { success: true, cached: true, data: cached.data, timestamp: now }
          }
        } catch (_) { /* not found，继续拉 LL2 */ }
      }

      // 2) 拉 LL2 详情接口（mode=detailed 保证 launcher_stage / spacecraft_stage 齐全）
      try {
        const fullUrl = `${LAUNCH_LIBRARY_API}/launches/${encodeURIComponent(launchId)}/?mode=detailed&format=json`
        const apiData = await Promise.race([
          fetchAPI(fullUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 详情接口超时')), 20000))
        ])
        if (!apiData || !apiData.id) {
          return { success: false, error: 'LL2 详情接口未返回有效数据', timestamp: Date.now() }
        }
        // 详情同样写入 xxxZh 字段（列表富化只覆盖 upcoming/previous 同步链路）
        try {
          await enrichSingleLaunch(apiData)
        } catch (translateErr) {
          console.warn('[translate-enrich detail]', translateErr.message || translateErr)
        }
        // 3) 完整写入缓存（详情需要 rocket.configuration 等完整字段，不做 slimLaunch）
        try {
          await db.collection('space_devs_cache').doc(detailCacheKey).set({
            data: {
              data: apiData,
              timestamp: now,
              expireAt: now + CACHE_DURATION,
              updatedAt: now
            }
          })
        } catch (saveErr) { /* 写库失败不阻塞返回 */ }
        return { success: true, cached: false, data: apiData, timestamp: now }
      } catch (e) {
        return { success: false, error: e.message || 'LL2 请求失败', timestamp: Date.now() }
      }
    } else if (action === 'debugStats') {
      // 调试统计过滤字段
      const debugResult = await debugLaunchStatsFilters()
      return {
        success: true,
        buildTag: BUILD_TAG,
        debug: debugResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncMediaAssets') {
      // 批量写入图片映射（支持 sourceTag 与 pruneMissing）
      const mediaResult = await syncMediaAssetsMappings(event.assets || [], {
        sourceTag: event.sourceTag,
        pruneMissing: !!event.pruneMissing,
        preserveExisting: event && Object.prototype.hasOwnProperty.call(event, 'preserveExisting')
          ? !!event.preserveExisting
          : true
      })
      return {
        success: !!mediaResult.success,
        buildTag: BUILD_TAG,
        media: mediaResult,
        timestamp: Date.now()
      }
    } else if (action === 'initCollections') {
      // 初始化 media_assets / media_feed（shop_feed 手动维护，不自动写入）
      const initResult = await initAppCollectionsAndSeed({
        assets: event.assets,
        mediaFeed: event.mediaFeed,
        shopFeed: event.shopFeed,
        sourceTag: event.sourceTag,
        pruneMissingAssets: !!event.pruneMissingAssets,
        pruneMissingFeeds: !!event.pruneMissingFeeds,
        preserveExistingAssets: event && Object.prototype.hasOwnProperty.call(event, 'preserveExistingAssets')
          ? !!event.preserveExistingAssets
          : true
      })
      return {
        success: !!(initResult && initResult.success),
        buildTag: BUILD_TAG,
        init: initResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncCloudInspirationData') {
      // 一步执行：先 syncMediaAssets，再导入 media_feed（shop_feed 手动维护，不自动写入）
      const initResult = await initAppCollectionsAndSeed({
        assets: event.assets,
        mediaFeed: event.mediaFeed,
        shopFeed: event.shopFeed,
        sourceTag: event.sourceTag,
        pruneMissingAssets: !!event.pruneMissingAssets,
        pruneMissingFeeds: !!event.pruneMissingFeeds,
        preserveExistingAssets: event && Object.prototype.hasOwnProperty.call(event, 'preserveExistingAssets')
          ? !!event.preserveExistingAssets
          : true
      })
      return {
        success: !!(initResult && initResult.success),
        buildTag: BUILD_TAG,
        sequence: ['syncMediaAssets', 'import:media_feed'],
        init: initResult,
        timestamp: Date.now()
      }
    } else if (action === 'repairInspirationPaths') {
      const repairResult = await repairInspirationDataPaths({
        sourceTag: event.sourceTag
      })
      return {
        success: !!(repairResult && repairResult.success),
        buildTag: BUILD_TAG,
        repair: repairResult,
        timestamp: Date.now()
      }
    } else if (action === 'rebuildInspirationFeed') {
      const rebuildResult = await rebuildInspirationMediaFeedFromStorage(event)
      return {
        success: !!(rebuildResult && rebuildResult.success),
        buildTag: BUILD_TAG,
        rebuild: rebuildResult,
        timestamp: Date.now()
      }
    } else if (action === 'syncInspirationOnly') {
      // 一键执行灵感流同步：仅从 COS 目录全量扫描并重建 media_feed
      const rebuildResult = await rebuildInspirationMediaFeedFromStorage(event)
      return {
        success: !!(rebuildResult && rebuildResult.success),
        buildTag: BUILD_TAG,
        rebuild: rebuildResult,
        timestamp: Date.now()
      }
    } else if (action === 'storageEventSyncInspiration') {
      const rebuildResult = await rebuildInspirationMediaFeedFromStorage(event)
      return {
        success: !!(rebuildResult && rebuildResult.success),
        buildTag: BUILD_TAG,
        rebuild: rebuildResult,
        timestamp: Date.now()
      }
    } else if (action === 'exportInspirationTemplates') {
      const exportResult = await exportInspirationTemplates({
        sourceTag: event.sourceTag,
        includeCurrent: event.includeCurrent
      })
      return {
        success: !!(exportResult && exportResult.success),
        buildTag: BUILD_TAG,
        export: exportResult,
        timestamp: Date.now()
      }
    } else {
      // 默认同步常用端点 + expedition详情 + 统计 + 封路通知 + SpaceX统计 + 助推器族谱 + 灵感流
      // SpaceX 官网统计放在最前：仅两次轻量 JSON 请求，若排在 LL2 全量链路之后，
      // 前面任何一步抛错或耗尽云函数超时都会导致本步骤跑不到，
      // spacex_official_live.syncedAt 超过 24h 后前端会整块隐藏「SpaceX总发射数据」板块
      let spacexStatsResult = null
      try {
        spacexStatsResult = await syncSpaceXLaunchStats()
      } catch (e) {
        spacexStatsResult = { success: false, error: e.message }
      }

      // 远征详情提前到重链路之前：LL2 免费配额约 15 次/小时，syncCommonEndpoints
      // 可能独自耗尽配额，导致 /expeditions/{id}/ 每轮都被限流、crew 缓存永远写不进去，
      // 前端「远征与团队成员」板块就会没有数据。站点详情缓存跨轮持久（不过期删除），
      // 用上一轮缓存里的 active_expeditions id 即可，无需等本轮站点详情先落库。
      let expeditionResult = null
      try {
        expeditionResult = await syncExpeditionDetails()
      } catch (e) {
        expeditionResult = { success: false, error: e.message }
      }

      const results = await syncCommonEndpoints()

      // 首轮冷启动兜底：站点详情缓存刚由上面写入，此前找不到任何 expedition id 时补一次
      if (expeditionResult && expeditionResult.success && Array.isArray(expeditionResult.expeditionIds) && expeditionResult.expeditionIds.length === 0) {
        try {
          expeditionResult = await syncExpeditionDetails()
        } catch (e) { /* 保留首次结果 */ }
      }

      // 各步骤独立兜底：任一失败不阻断后续同步
      let statsResult = null
      try {
        statsResult = await syncLaunchStats()
      } catch (e) {
        statsResult = { success: false, error: e.message }
      }
      let roadClosureResult = null
      try {
        roadClosureResult = await syncRoadClosure()
      } catch (e) {
        roadClosureResult = { success: false, error: e.message }
      }

      // 助推器族谱同步
      let boosterResult = null
      try {
        boosterResult = await syncBoosterGenealogy()
      } catch (e) {
        boosterResult = { success: false, error: e.message }
      }

      // 数据交叉校验：用 SpaceX 官方数据补全 Space Devs 缓存（零额外 API 请求）
      let crossValidateResult = null
      try {
        crossValidateResult = await crossValidateWithSpaceX()
      } catch (e) {
        crossValidateResult = { success: false, error: e.message }
      }

      let inspirationResult = null
      try {
        inspirationResult = await rebuildInspirationMediaFeedFromStorage({})
      } catch (e) {
        inspirationResult = { success: false, error: e.message }
      }
      
      // 所有数据同步完成后再清理过期缓存，避免新数据写入失败时旧缓存也被删
      await cleanExpiredCache().catch(() => {})

      return {
        success: true,
        message: '同步完成',
        results: results,
        expedition: expeditionResult,
        stats: statsResult,
        roadClosure: roadClosureResult,
        spacexStats: spacexStatsResult,
        crossValidate: crossValidateResult,
        boosters: boosterResult,
        inspiration: inspirationResult,
        timestamp: Date.now()
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    }
  }
}
