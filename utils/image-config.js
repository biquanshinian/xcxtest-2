/**
 * 图片配置文件
 * - 保留原有本地目录结构（兜底）
 * - 支持配置云端 URL（优先）
 * - 支持从云数据库动态加载映射
 */
const config = require('./config.js')
const { getCachedRocketConfig, getCachedMediaImage } = require('./icon-cache.js')
const { toCdnUrl } = require('./cos-url.js')

const folderConfig = {
  'images/monitor/news': {
    images: ['图片2.jpg']
  },
  'images/monitor/checklist': {
    images: ['图片1.jpg']
  },
  'images/monitor/starship': {
    images: ['图片3.png']
  },
  'images/monitor/superheavy': {
    images: ['图片4.png']
  }
}

/**
 * 静态媒体映射（可手动写死，作为云数据库加载失败时的兜底）
 * key: `${folder}/${filename}`
 */
const cloudMediaMap = {}

let runtimeCloudMediaMap = {}
let cloudMapLoaded = false
/** 本地媒体映射缓存已被标记失效（异步删除尚未完成时挡住旧缓存） */
let _localMediaMapCacheInvalid = false
/** 并发 `loadCloudMediaMap` 合并为同一 Promise，避免早退拿到空 map */
let loadCloudMediaMapInFlight = null
// canonical key → normalized key 索引（O(1) 模糊查找，替代遍历）
let canonicalKeyIndex = {}

const MEDIA_MAP_CACHE_KEY = '_media_map_local_cache'
const MEDIA_MAP_CACHE_TTL = 6 * 60 * 60 * 1000
const USER_DATA_GATEWAY_FN = 'userDataGateway'

/** 与云函数 syncRocketCosIndex 配合：定时拉取 COS 火箭图目录写入 media_assets */
const ROCKET_COS_SYNC_STORAGE_KEY = '_rocket_cos_sync_last_ok'
// 6 小时（与 MEDIA_MAP_CACHE_TTL 对齐）：火箭配置图是极低频运营素材，
// 原 6 分钟节流下 150 日活即产生上千次云函数 + COS 列举 + media_assets diff 读写
const ROCKET_COS_SYNC_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
const ROCKET_COS_SYNC_FN = 'syncRocketCosIndex'

// ── 内存缓存：避免 maybeInvokeRocketCosSync 重复读 storage ──
let _memRocketCosSyncLastOk = undefined  // number | undefined
let _rocketCosSyncInFlight = null        // Promise | null（并发去重）

function storageGetAsync(key) {
  return new Promise((resolve) => {
    wx.getStorage({
      key,
      success: (res) => resolve(res.data),
      fail: () => resolve(undefined)
    })
  })
}

function storageSetAsync(key, data) {
  return new Promise((resolve) => {
    wx.setStorage({
      key,
      data,
      complete: () => resolve()
    })
  })
}

const STARSHIP_TARGET_KEYS = [
  '火箭配置图/Starship V3 Flight 12.jpg',
  '火箭配置图/Starship_V3_Flight_12.jpg',
  '火箭配置图/Starship-V3-Flight-12.jpg'
]

function isDevEnvironment() {
  try {
    const info = wx && wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
    const envVersion = info && info.miniProgram ? info.miniProgram.envVersion : ''
    return envVersion === 'develop' || envVersion === 'trial'
  } catch (e) {
    return false
  }
}

function shouldLogDebug() {
  return !!(isDevEnvironment() && config && config.imageCDN && config.imageCDN.debug)
}

function logDebug(...args) {
  if (shouldLogDebug()) console.log(...args)
}

function warnDebug(...args) {
  if (shouldLogDebug()) console.warn(...args)
}

function normalizeKey(key) {
  if (!key || typeof key !== 'string') return ''
  return key
    // 各类不可见空白统一处理（含零宽字符）
    .replace(/[\u00A0\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ')
    // 全角斜杠统一为半角
    .replace(/／/g, '/')
    // 连续空白折叠
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
}

function canonicalizeMediaKey(key) {
  return normalizeKey(key)
    .toLowerCase()
    .replace(/[ _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 重建 canonical key 索引（加载/更新 runtimeCloudMediaMap 后调用） */
function rebuildCanonicalIndex() {
  const idx = {}
  for (const k of Object.keys(runtimeCloudMediaMap || {})) {
    const ck = canonicalizeMediaKey(k)
    if (!idx[ck]) idx[ck] = k
  }
  canonicalKeyIndex = idx
}

function logMediaKeyHealthCheck() {
  if (!shouldLogDebug()) return

  const focusKeywords = [/starship/i, /火箭配置图/i]
  const rows = Object.keys(runtimeCloudMediaMap || {})
    .filter((k) => focusKeywords.some((re) => re.test(k)))
    .slice(0, 50)
    .map((k) => ({
      rawKey: k,
      normalizedKey: normalizeKey(k),
      canonicalKey: canonicalizeMediaKey(k),
      hasUrl: !!runtimeCloudMediaMap[k]
    }))

  logDebug('[image-config] 媒体key健康检查(开发环境)', {
    totalKeys: Object.keys(runtimeCloudMediaMap || {}).length,
    focusRows: rows
  })
}

function logStarshipKeyDiagnosis() {
  if (!shouldLogDebug()) return

  const runtimeKeys = Object.keys(runtimeCloudMediaMap || {})
  const normalizedRuntimeSet = new Set(runtimeKeys.map((k) => normalizeKey(k)))
  const canonicalRuntimeSet = new Set(runtimeKeys.map((k) => canonicalizeMediaKey(k)))

  const diagnosisRows = STARSHIP_TARGET_KEYS.map((targetKey) => {
    const normalizedTarget = normalizeKey(targetKey)
    const canonicalTarget = canonicalizeMediaKey(targetKey)

    const exactHit = !!runtimeCloudMediaMap[normalizedTarget]
    const normalizedHit = normalizedRuntimeSet.has(normalizedTarget)
    const canonicalHit = canonicalRuntimeSet.has(canonicalTarget)

    const canonicalCandidates = runtimeKeys
      .filter((k) => canonicalizeMediaKey(k) === canonicalTarget)
      .slice(0, 5)

    return {
      targetKey,
      normalizedTarget,
      canonicalTarget,
      exactHit,
      normalizedHit,
      canonicalHit,
      canonicalCandidates
    }
  })

  logDebug('[image-config] Starship V3 key诊断(开发环境)', {
    runtimeMapSize: runtimeKeys.length,
    rocketKeyCount: runtimeKeys.filter((k) => /^火箭配置图\//.test(k)).length,
    rocketKeySamples: runtimeKeys.filter((k) => /^火箭配置图\//.test(k)).slice(0, 10),
    diagnosisRows
  })

  try {
    logDebug('[image-config] Starship V3 key诊断JSON', JSON.stringify({
      runtimeMapSize: runtimeKeys.length,
      rocketKeyCount: runtimeKeys.filter((k) => /^火箭配置图\//.test(k)).length,
      diagnosisRows
    }))
  } catch (e) {
    warnDebug('[image-config] Starship V3 key诊断JSON序列化失败', e)
  }
}

function normalizeLocalPath(folder, fileName) {
  const path = `${folder}/${fileName}`.replace(/\\/g, '/')
  return path.startsWith('/') ? path : `/${path}`
}

function setCloudMediaMap(map = {}) {
  runtimeCloudMediaMap = { ...runtimeCloudMediaMap, ...map }
  rebuildCanonicalIndex()
}

function invalidateLocalMediaMapCache() {
  cloudMapLoaded = false
  // 删除改异步；用内存标记挡住「删除完成前 loadCloudMediaMap 又读到旧缓存」的竞态
  _localMediaMapCacheInvalid = true
  try {
    wx.removeStorage({ key: MEDIA_MAP_CACHE_KEY, fail: () => {} })
  } catch (e) {}
}

/**
 * 节流调用云函数：列举 COS「火箭配置图/」并写入 media_assets，便于 canonical 模糊匹配
 * @returns {Promise<number>} media_assets 变更条数（add+update+remove），未调用云函数时为 0
 */
async function maybeInvokeRocketCosSync() {
  if (!config.imageCDN || !config.imageCDN.enabled) return 0
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return 0
  // in-flight 锁：并发调用共享同一次 storage 读 + 云函数调用，
  // 避免 _memRocketCosSyncLastOk 未就绪时各自发起一次 getStorage（启动阶段可达 6 次）
  if (_rocketCosSyncInFlight) return _rocketCosSyncInFlight
  _rocketCosSyncInFlight = (async () => {
    try {
      // 先查内存缓存
      let last = _memRocketCosSyncLastOk
      if (last === undefined) {
        last = await new Promise((resolve) => {
          wx.getStorage({
            key: ROCKET_COS_SYNC_STORAGE_KEY,
            success: (res) => resolve(Number(res.data || 0)),
            fail: () => resolve(0)
          })
        })
        _memRocketCosSyncLastOk = last
      }
      if (last && Date.now() - last < ROCKET_COS_SYNC_MIN_INTERVAL_MS) return 0
      const res = await wx.cloud.callFunction({
        name: ROCKET_COS_SYNC_FN,
        data: { from: 'miniprogram' }
      })
      const result = res && res.result
      if (result && result.ok) {
        const now = Date.now()
        _memRocketCosSyncLastOk = now
        wx.setStorage({ key: ROCKET_COS_SYNC_STORAGE_KEY, data: now })
        const touched = (result.added || 0) + (result.updated || 0) + (result.removed || 0)
        if (touched > 0) {
          invalidateLocalMediaMapCache()
        }
        return touched
      }
    } catch (e) {
      console.warn('[image-config] syncRocketCosIndex:', (e && e.errMsg) || e)
    }
    return 0
  })()
  try {
    return await _rocketCosSyncInFlight
  } finally {
    _rocketCosSyncInFlight = null
  }
}

function scheduleRocketCosReloadIfNeeded(touched) {
  if (!touched) return
  setTimeout(() => {
    loadCloudMediaMap(false).catch(() => {})
  }, 0)
}

function normalizeMediaMapFromRows(rows) {
  const fetchedMap = {}
  ;(rows || []).forEach((item) => {
    const key = normalizeKey(item.key)
    const url = (typeof item.url === 'string') ? item.url.trim() : item.url
    if (key && url) fetchedMap[key] = url
  })
  return fetchedMap
}

/** 云函数单次下发 media_assets 映射；失败返回 null 由调用方 fallback */
async function fetchMediaMapViaCloudFunction() {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null
  try {
    const res = await wx.cloud.callFunction({
      name: USER_DATA_GATEWAY_FN,
      data: { action: 'getMediaAssetsMap' },
      timeout: 15000
    })
    const r = (res && res.result) || {}
    if (r.success !== true || !r.map || typeof r.map !== 'object') return null
    const fetchedMap = {}
    Object.keys(r.map).forEach((rawKey) => {
      const key = normalizeKey(rawKey)
      const url = typeof r.map[rawKey] === 'string' ? r.map[rawKey].trim() : r.map[rawKey]
      if (key && url) fetchedMap[key] = url
    })
    return fetchedMap
  } catch (e) {
    console.warn('[image-config] getMediaAssetsMap:', (e && e.errMsg) || e)
    return null
  }
}

/** 客户端分页读 media_assets（云函数不可用时的轻量 fallback） */
async function fetchMediaMapViaDbPaginated() {
  if (!wx.cloud || !wx.cloud.database) return {}
  const db = wx.cloud.database()
  const collectionName = (config.imageCDN && config.imageCDN.mediaCollection) || 'media_assets'
  let hasMore = true
  let skip = 0
  const pageSize = 20
  const fetchedMap = {}
  let pageIndex = 0

  while (hasMore) {
    const res = await db.collection(collectionName)
      .where({ enabled: true })
      .field({ key: true, url: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get()

    const rows = (res && res.data) || []
    Object.assign(fetchedMap, normalizeMediaMapFromRows(rows))

    hasMore = rows.length === pageSize
    skip += rows.length
    pageIndex += 1
    if (pageIndex % 4 === 0 && hasMore) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return fetchedMap
}

async function loadCloudMediaMap(force = false) {
  if (!config.imageCDN || !config.imageCDN.enabled) {
    return runtimeCloudMediaMap
  }
  if (cloudMapLoaded && !force) {
    void maybeInvokeRocketCosSync().then(scheduleRocketCosReloadIfNeeded)
    return runtimeCloudMediaMap
  }
  if (loadCloudMediaMapInFlight && !force) {
    return loadCloudMediaMapInFlight
  }

  const loadPromise = (async () => {
    // 异步读本地缓存，避免超大 JSON 同步反序列化卡死主线程（模拟器易报无响应）
    if (!force && !_localMediaMapCacheInvalid) {
      try {
        const cached = await storageGetAsync(MEDIA_MAP_CACHE_KEY)
        if (cached && cached.ts && (Date.now() - cached.ts < MEDIA_MAP_CACHE_TTL)) {
          runtimeCloudMediaMap = cached.data || {}
          cloudMapLoaded = true
          rebuildCanonicalIndex()
          void maybeInvokeRocketCosSync().then(scheduleRocketCosReloadIfNeeded)
          return runtimeCloudMediaMap
        }
      } catch (e) {}
    }

    await maybeInvokeRocketCosSync()

    try {
      let fetchedMap = await fetchMediaMapViaCloudFunction()
      if (!fetchedMap || !Object.keys(fetchedMap).length) {
        fetchedMap = await fetchMediaMapViaDbPaginated()
      }

      runtimeCloudMediaMap = fetchedMap || {}
      cloudMapLoaded = true
      rebuildCanonicalIndex()

      try {
        await storageSetAsync(MEDIA_MAP_CACHE_KEY, { data: fetchedMap, ts: Date.now() })
        _localMediaMapCacheInvalid = false
      } catch (e) {}

      logMediaKeyHealthCheck()
      logStarshipKeyDiagnosis()
      return runtimeCloudMediaMap
    } catch (e) {
      console.error('[image-config] 加载媒体映射失败', e)
      return runtimeCloudMediaMap
    } finally {
    }
  })()

  loadCloudMediaMapInFlight = loadPromise
  loadPromise.finally(() => {
    if (loadCloudMediaMapInFlight === loadPromise) {
      loadCloudMediaMapInFlight = null
    }
  })
  return loadPromise
}

function getCloudUrlByKey(key) {
  if (!config.imageCDN || !config.imageCDN.enabled) return ''
  const normalizedKey = normalizeKey(key)
  if (!normalizedKey) return ''

  const runtimeUrl = runtimeCloudMediaMap[normalizedKey] || ''
  const staticUrl = cloudMediaMap[normalizedKey] || ''

  let fuzzyRuntimeUrl = ''
  let fuzzyStaticUrl = ''

  if (!runtimeUrl && !staticUrl) {
    const targetCanonical = canonicalizeMediaKey(normalizedKey)

    // O(1) 索引查找，替代遍历所有 key
    const indexedKey = canonicalKeyIndex[targetCanonical]
    if (indexedKey) {
      fuzzyRuntimeUrl = runtimeCloudMediaMap[indexedKey] || ''
    }

    if (!fuzzyRuntimeUrl) {
      const staticKeys = Object.keys(cloudMediaMap || {})
      for (const itemKey of staticKeys) {
        if (canonicalizeMediaKey(itemKey) === targetCanonical) {
          fuzzyStaticUrl = cloudMediaMap[itemKey] || ''
          break
        }
      }
    }
  }

  const finalUrl = runtimeUrl || staticUrl || fuzzyRuntimeUrl || fuzzyStaticUrl || ''

  if (shouldLogDebug() && /^火箭配置图\//.test(normalizedKey)) {
    logDebug('[image-config] 火箭图key解析', {
      key: normalizedKey,
      hitRuntime: !!runtimeUrl,
      hitStatic: !!staticUrl,
      hitFuzzyRuntime: !!fuzzyRuntimeUrl,
      hitFuzzyStatic: !!fuzzyStaticUrl,
      hasUrl: !!finalUrl
    })
  }

  return finalUrl
}

/** 与文件名模糊匹配用：忽略大小写、多空格、常见分隔符差异 */
function normalizeRocketNameForFileMatch(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .replace(/[\u00A0\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ')
    .replace(/／/g, '/')
    .toLowerCase()
    .replace(/[._/\\]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactRocketMatchStr(s) {
  return normalizeRocketNameForFileMatch(s).replace(/\s+/g, '')
}

/** 从规范化火箭名抽出型号 token（如 10b / 3be / 12a），用于跨型号误配拦截 */
function extractRocketModelTokens(norm) {
  if (!norm || typeof norm !== 'string') return []
  const out = []
  const re = /(\d+)\s*([a-z]+)/gi
  let m
  while ((m = re.exec(norm)) !== null) {
    out.push((m[1] + m[2]).toLowerCase())
  }
  return [...new Set(out)]
}

/** COS 文件名常见后缀：Atlas V 551 rocket launch.webp → stem「火箭名」参与匹配 */
function stemFromRocketConfigFilename(mediaKey) {
  const k = normalizeKey(mediaKey)
  if (!k || !/^火箭配置图\//.test(k)) return ''
  let stem = k.replace(/^火箭配置图\//i, '').replace(/\.(jpe?g|png|webp|gif)$/i, '').trim()
  stem = stem.replace(/\s*rocket\s*launch\s*$/i, '').trim()
  return stem
}

/** 与火箭名中出现的 2–6 位连续数字段精确对齐（避免 1551 误命中 stem「551」） */
function extractDigitRunsFromRocketNorm(rocketNorm) {
  const set = new Set()
  if (!rocketNorm || typeof rocketNorm !== 'string') return set
  const re = /\d{2,6}/g
  let m
  while ((m = re.exec(rocketNorm)) !== null) {
    set.add(m[0])
  }
  return set
}

/**
 * 在已加载的 media_assets 映射中，按火箭展示名模糊匹配「火箭配置图/」下的文件 stem
 *（同步自 COS 的 key 如「KSLV-2 rocket launch.webp」可与 API 的「KSLV-II」等对齐）
 */
function findFuzzyRocketConfigUrl(rocketName) {
  if (!config.imageCDN || !config.imageCDN.enabled) return ''
  const rocketRaw = String(rocketName || '').trim()
  const rocketNorm = normalizeRocketNameForFileMatch(rocketRaw)
  if (!rocketNorm || rocketNorm.length < 2) return ''

  const rocketCompact = compactRocketMatchStr(rocketRaw)
  const rocketModels = extractRocketModelTokens(rocketNorm)
  const FUZZY_MIN_SCORE = 340000

  let bestUrl = ''
  let bestScore = -1
  let bestStemLen = -1

  const map = runtimeCloudMediaMap || {}
  for (const rawKey of Object.keys(map)) {
    const k = normalizeKey(rawKey)
    if (!/^火箭配置图\//.test(k)) continue

    const stem = stemFromRocketConfigFilename(k)
    if (!stem) continue

    const stemNorm = normalizeRocketNameForFileMatch(stem)
    const stemCompact = compactRocketMatchStr(stem)
    const url = map[rawKey]
    if (!url || typeof url !== 'string') continue

    // 火箭名已带具体型号（如 10b）时，禁止命中其它型号文件（如 3be）
    if (rocketModels.length > 0) {
      const stemModels = extractRocketModelTokens(stemNorm)
      if (stemModels.length > 0 && !rocketModels.some((m) => stemModels.includes(m))) {
        continue
      }
      if (stemModels.length === 0) {
        const hasAnyModelInStem = rocketModels.some((m) =>
          stemCompact.includes(m) || stemNorm.includes(m.split('').join(' '))
        )
        if (!hasAnyModelInStem) continue
      }
    }

    const pureDigitStem = /^\d{2,6}$/.test(stemNorm)

    let score = 0

    if (stemNorm === rocketNorm) {
      score = 1000000
    } else if (rocketCompact.length >= 3 && stemCompact === rocketCompact) {
      score = 960000
    } else if (rocketNorm.length >= 3 && (stemNorm.startsWith(rocketNorm + ' ') || stemNorm === rocketNorm)) {
      score = 820000
    } else if (stemNorm.length >= 3 && (rocketNorm.startsWith(stemNorm + ' ') || rocketNorm === stemNorm)) {
      score = 750000
    } else if (rocketNorm.length >= 3 && stemNorm.includes(rocketNorm)) {
      score = 620000 + rocketNorm.length * 80
    } else if (!pureDigitStem && stemNorm.length >= 3 && rocketNorm.includes(stemNorm)) {
      score = 550000 + stemNorm.length * 80
    } else {
      const rtoks = rocketNorm.split(' ').filter((t) => t.length >= 2)
      if (rtoks.length > 0) {
        const allInStem = rtoks.every((t) => stemNorm.includes(t))
        if (allInStem) {
          score = 420000 + rtoks.length * 1200 + rocketNorm.length * 10
        } else {
          const stoks = stemNorm.split(' ').filter((t) => t.length >= 2)
          if (stoks.length > 0) {
            const allInRocket = stoks.every((t) => rocketNorm.includes(t))
            if (allInRocket) {
              score = 380000 + stoks.length * 1000 + stemNorm.length * 10
            }
          }
        }
      }
    }

    if (pureDigitStem) {
      const runs = extractDigitRunsFromRocketNorm(rocketNorm)
      if (runs.has(stemNorm)) {
        score = Math.max(score, 925000)
      }
    }

    if (score < FUZZY_MIN_SCORE) continue

    const stemLen = stemNorm.length
    if (score > bestScore || (score === bestScore && stemLen > bestStemLen)) {
      bestScore = score
      bestUrl = url.trim()
      bestStemLen = stemLen
    }
  }

  return bestUrl
}

/** 火箭配置图拼接用根地址：优先 DB 无映射时的真实 COS/CDN（与用户 media_assets 中 url 一致） */
function getRocketImageCdnRoot() {
  const img = config.imageCDN || {}
  const explicit = typeof img.rocketCosBaseUrl === 'string' ? img.rocketCosBaseUrl.trim() : ''
  if (explicit) return explicit.replace(/\/$/, '')
  const ins = config.inspirationCOS || {}
  const cos =
    (typeof ins.cdnBaseUrl === 'string' && ins.cdnBaseUrl.trim()) ||
    (typeof ins.baseUrl === 'string' && ins.baseUrl.trim()) ||
    ''
  if (cos) return cos.replace(/\/$/, '')
  return typeof img.baseUrl === 'string' ? img.baseUrl.replace(/\/$/, '') : ''
}

function getCloudStorageCdnRoot() {
  const img = config.imageCDN || {}
  return typeof img.baseUrl === 'string' ? img.baseUrl.replace(/\/$/, '') : ''
}

function wrapCosHttpsUrl(url, preset) {
  const u = typeof url === 'string' ? url.trim() : ''
  if (!u || !/^https?:\/\//i.test(u)) return u
  return getCachedMediaImage(toCdnUrl(u), preset || 'thumb')
}

function wrapRocketHttpsUrl(normalizedKey, url) {
  const u = typeof url === 'string' ? url.trim() : ''
  if (!u || !/^火箭配置图\//.test(normalizedKey || '')) return u
  if (!/^https?:\/\//i.test(u)) return u
  return getCachedRocketConfig(wrapCosHttpsUrl(u))
}

function resolveMediaUrl(key, localFallback = '') {
  const normalizedKey = normalizeKey(key)

  if (normalizedKey) {
    const cloudUrl = getCloudUrlByKey(normalizedKey)
    const mediaPreset = /^首页轮播图\//.test(normalizedKey) ? 'medium' : 'thumb'
    if (cloudUrl) {
      if (/^火箭配置图\//.test(normalizedKey)) {
        return wrapRocketHttpsUrl(normalizedKey, cloudUrl)
      }
      return wrapCosHttpsUrl(cloudUrl, mediaPreset)
    }

    // media_assets 未命中时按 key 拼公开 URL：火箭图走 COS，其余走云开发存储 baseUrl
    if (config.imageCDN && config.imageCDN.enabled) {
      if (/^火箭配置图\//.test(normalizedKey)) {
        const base = getRocketImageCdnRoot()
        if (base) return wrapRocketHttpsUrl(normalizedKey, `${base}/${encodeURI(normalizedKey)}`)
      } else if (/^(首页轮播图|开屏动画)\//.test(normalizedKey)) {
        const base = getCloudStorageCdnRoot()
        if (base) return wrapCosHttpsUrl(`${base}/${encodeURI(normalizedKey)}`, mediaPreset)
      }
    }
  }

  let fallback = localFallback
  const fallbackEmpty = !fallback || typeof fallback !== 'string' || !String(fallback).trim()
  if (fallbackEmpty && normalizedKey && shouldUseKeyAsLocalPath(normalizedKey)) {
    fallback = `/${normalizedKey}`
  }

  if (!fallback || typeof fallback !== 'string' || !String(fallback).trim()) {
    return ''
  }
  const normalized = String(fallback).replace(/\\/g, '/').trim()
  if (/^https?:\/\//i.test(normalized)) return wrapCosHttpsUrl(normalized)
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

/**
 * 无云映射且无 CDN 拼接结果时，是否回退为小程序包内路径。
 * 火箭配置图仅在 COS / media_assets 维护，不在包内——不回退本地路径，交给上层用 default.jpg（同走 COS）。
 */
function shouldUseKeyAsLocalPath(normalizedKey) {
  return (
    /^首页轮播图\//.test(normalizedKey) ||
    /^开屏动画\//.test(normalizedKey) ||
    /^images\//.test(normalizedKey)
  )
}

function getFolderImages(folder) {
  const current = folderConfig[folder]
  if (!current || !Array.isArray(current.images)) return []

  return current.images
    .map((fileName) => {
      const mediaKey = normalizeKey(`${folder}/${fileName}`)
      const localPath = normalizeLocalPath(folder, fileName)
      return resolveMediaUrl(mediaKey, localPath)
    })
    .filter(Boolean)
}

module.exports = {
  loadCloudMediaMap,
  resolveMediaUrl,
  findFuzzyRocketConfigUrl
}
