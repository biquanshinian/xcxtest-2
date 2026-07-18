/**
 * ll2Query 云函数
 * 轻量级实时查询：飞行时间线、发射动态、单条发射详情
 * 从 syncSpaceDevsData 拆分，减少冷启动时间
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { enrichSingleLaunch } = require('./ll2-translate-enrich.js')
const { enrichLaunchNetRecovery } = require('./ll2-net-recovery-enrich.js')
const { translateTextsBatch, isTmtConfigured, runTranslateDiag } = require('./translate.js')
const { createLaunchStatusStore, normalize: normalizeLaunchStatus } = require('./launch-status-store.js')
const launchStatusStore = createLaunchStatusStore(db)

const httpsRequire = require('https')
const httpRequire = require('http')
const ll2HttpsAgent = new httpsRequire.Agent({ keepAlive: true, maxSockets: 16 })
const ll2HttpAgent = new httpRequire.Agent({ keepAlive: true, maxSockets: 16 })

const LAUNCH_LIBRARY_API = 'https://ll.thespacedevs.com/2.3.0'
const TIMELINE_CACHE_COL = 'launch_timeline_cache'
const TIMELINE_CACHE_TTL = 30 * 60 * 1000
/** 热路径：倒计时旁路可接受的 updates 新鲜度 */
const UPDATES_CACHE_TTL_HOT = 10 * 60 * 1000
/** 冷路径：6h 全量拆分入库后，历史详情可读的最长缓存 */
const UPDATES_CACHE_TTL_COLD = 48 * 60 * 60 * 1000
const STARSHIP_DB_CACHE_TTL = 60 * 60 * 1000

const LL2_USAGE_DOC = '_ll2_usage_hourly'
let _ll2UsageBucket = ''
let _ll2UsageCount = 0
let _ll2UsageFlushAt = 0

function ll2HourBucket(nowMs) {
  const d = new Date(nowMs || Date.now())
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  return `${y}${m}${day}T${h}`
}

function isLl2TokenConfigured() {
  const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
  return !!(token && token !== 'FILL_ME')
}

function noteLl2Request(source) {
  try {
    const now = Date.now()
    const bucket = ll2HourBucket(now)
    if (_ll2UsageBucket !== bucket) {
      _ll2UsageBucket = bucket
      _ll2UsageCount = 0
    }
    _ll2UsageCount += 1
    if (_ll2UsageCount % 5 !== 0 && now - _ll2UsageFlushAt < 60 * 1000) return
    _ll2UsageFlushAt = now
    const authed = isLl2TokenConfigured()
    db.collection(TIMELINE_CACHE_COL)
      .doc(LL2_USAGE_DOC)
      .set({
        data: {
          hourUtc: bucket,
          count: _ll2UsageCount,
          authed,
          source: source || 'll2Query',
          updatedAtMs: now
        }
      })
      .catch(() => {})
    if (!authed && _ll2UsageCount >= 10) {
      console.warn(
        '[LL2] anonymous hour usage high:',
        _ll2UsageCount,
        'bucket=',
        bucket,
        '— set LL2_API_TOKEN in cloud env'
      )
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
// fetchAPI — 通用 HTTPS 请求（从 shared.js 提取）
// ══════════════════════════════════════════════════════════════
function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http = require('http')
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http
    const agent = urlObj.protocol === 'https:' ? ll2HttpsAgent : ll2HttpAgent

    const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; SpaceSync/1.0)',
      Accept: 'application/json'
    }
    if (token && token !== 'FILL_ME') headers['Authorization'] = `Token ${token}`

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 30000,
      agent
    }

    const req = client.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          if (/thespacedevs\.com$/i.test(urlObj.hostname)) noteLl2Request('ll2Query')
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

// ══════════════════════════════════════════════════════════════
// 自动识别星舰发射（从 ll2-starship-auto.js 提取）
// ══════════════════════════════════════════════════════════════
// 热实例内存缓存与数据库缓存同为 60 分钟（星舰任务切换频率低，节省 LL2 限额）
const STARSHIP_CACHE_TTL_MS = 60 * 60 * 1000
let _starshipMem = { ts: 0, launchId: '', launchName: '', net: '', source: '' }

function firstLaunch(rows) {
  if (!Array.isArray(rows)) return null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r && r.id) {
      return { launchId: String(r.id), launchName: typeof r.name === 'string' ? r.name : '', net: r.net || '' }
    }
  }
  return null
}

async function resolveAutoStarshipLaunch() {
  const now = Date.now()
  // 1) 内存缓存（热实例）
  if (_starshipMem.launchId && now - _starshipMem.ts < STARSHIP_CACHE_TTL_MS) {
    return {
      launchId: _starshipMem.launchId,
      launchName: _starshipMem.launchName,
      net: _starshipMem.net,
      source: _starshipMem.source || '',
      cached: true
    }
  }

  // 2) 数据库缓存（跨冷启动）
  try {
    const dbCache = await db.collection(TIMELINE_CACHE_COL).doc('_starship_resolve_cache').get()
    const c = dbCache && dbCache.data
    if (c && c.launchId && c.updatedAtMs && now - c.updatedAtMs < STARSHIP_DB_CACHE_TTL) {
      _starshipMem = {
        ts: now,
        launchId: c.launchId,
        launchName: c.launchName || '',
        net: c.net || '',
        source: c.source || ''
      }
      return {
        launchId: c.launchId,
        launchName: c.launchName || '',
        net: c.net || '',
        source: c.source || '',
        cached: true
      }
    }
  } catch (e) {}

  const baseQs = [
    'format=json',
    'mode=list',
    'rocket__configuration__name=' + encodeURIComponent('Starship'),
    'limit=30'
  ]

  const upcomingUrl =
    LAUNCH_LIBRARY_API + '/launches/upcoming/?' + baseQs.concat(['ordering=' + encodeURIComponent('net')]).join('&')
  const upData = await fetchAPI(upcomingUrl)
  let picked = firstLaunch(upData && upData.results)
  let source = ''

  if (picked) {
    source = 'upcoming'
  } else {
    const prevUrl =
      LAUNCH_LIBRARY_API + '/launches/previous/?' + baseQs.concat(['ordering=' + encodeURIComponent('-net')]).join('&')
    const pvData = await fetchAPI(prevUrl)
    picked = firstLaunch(pvData && pvData.results)
    if (picked) source = 'previous'
  }

  if (!picked || !picked.launchId) {
    _starshipMem = { ts: now, launchId: '', launchName: '', net: '', source: '' }
    return { launchId: '', launchName: '', net: '', source: '', cached: false }
  }

  _starshipMem = { ts: now, launchId: picked.launchId, launchName: picked.launchName, net: picked.net, source }

  // 写入数据库缓存
  try {
    await db
      .collection(TIMELINE_CACHE_COL)
      .doc('_starship_resolve_cache')
      .set({
        data: { launchId: picked.launchId, launchName: picked.launchName, net: picked.net, source, updatedAtMs: now }
      })
  } catch (e) {}

  return { launchId: picked.launchId, launchName: picked.launchName, net: picked.net, source, cached: false }
}

// ══════════════════════════════════════════════════════════════
// resolveLaunchId — 解析 launchId（手动传入或自动星舰）
// ══════════════════════════════════════════════════════════════
async function resolveLaunchIdForLl2Progress(event) {
  const manual = String((event && event.launchId) || '').trim()
  const autoStarship = !!(event && event.autoStarship)
  if (manual) {
    return {
      launchId: manual,
      autoResolved: false,
      resolvedSource: '',
      resolvedLaunchName: '',
      resolvedNet: '',
      resolvedFromCache: false
    }
  }
  if (!autoStarship) {
    return {
      launchId: '',
      autoResolved: false,
      resolvedSource: '',
      resolvedLaunchName: '',
      resolvedNet: '',
      resolvedFromCache: false,
      error: 'missing_launch_id'
    }
  }
  try {
    const r = await resolveAutoStarshipLaunch()
    if (!r.launchId) {
      return {
        launchId: '',
        autoResolved: true,
        resolvedSource: '',
        resolvedLaunchName: '',
        resolvedNet: '',
        resolvedFromCache: false,
        error: 'no_starship_launch'
      }
    }
    return {
      launchId: r.launchId,
      autoResolved: true,
      resolvedSource: r.source || '',
      resolvedLaunchName: r.launchName || '',
      resolvedNet: r.net || '',
      resolvedFromCache: !!r.cached
    }
  } catch (e) {
    return {
      launchId: '',
      autoResolved: true,
      resolvedSource: '',
      resolvedLaunchName: '',
      resolvedNet: '',
      resolvedFromCache: false,
      error: e.message || 'resolve_starship_launch_failed'
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Action: fetchLaunchUpdates
// ══════════════════════════════════════════════════════════════
async function fetchLaunchUpdatesAction(event) {
  const startTime = Date.now()
  try {
    const limit = Math.min(30, Math.max(1, Number((event && event.limit) || 15)))
    const resolved = await resolveLaunchIdForLl2Progress(event || {})
    const launchId = resolved.launchId
    if (!launchId) {
      return {
        success: false,
        error: resolved.error === 'no_starship_launch' ? 'no_starship_launch' : resolved.error || 'missing_launch_id',
        list: [],
        launchId: '',
        autoResolved: resolved.autoResolved,
        resolvedSource: resolved.resolvedSource,
        resolvedLaunchName: resolved.resolvedLaunchName,
        timestamp: Date.now(),
        elapsed: Date.now() - startTime
      }
    }

    // 先查云数据库缓存
    // 热路径 <10min；冷路径（6h 拆分）<48h 仍直接返回，避免历史详情反复打 LL2
    const updatesCacheId = `updates_${launchId}`
    const forceRefresh = !!(event && event.forceRefresh)
    try {
      if (!forceRefresh) {
        const cacheRes = await db.collection(TIMELINE_CACHE_COL).doc(updatesCacheId).get()
        const cached = cacheRes && cacheRes.data
        const age = cached && cached.updatedAtMs ? Date.now() - cached.updatedAtMs : Infinity
        const list = cached && Array.isArray(cached.data) ? cached.data : null
        if (list && list.length && age < UPDATES_CACHE_TTL_COLD) {
          const cachedOutcome = inferTerminalFromUpdateComments(list)
          if (cachedOutcome) {
            try {
              await mergeTerminalRowsIntoRecentSettled([
                {
                  id: String(launchId),
                  name: resolved.resolvedLaunchName || cached.launchName || '',
                  status: cachedOutcome.status,
                  net: '',
                  windowStart: '',
                  windowEnd: '',
                  settledAtMs: Date.now(),
                  source: age < UPDATES_CACHE_TTL_HOT ? 'll2_updates_cache' : 'll2_updates_cold',
                  updateComment: cachedOutcome.comment,
                  updateInfoUrl: cachedOutcome.infoUrl
                }
              ])
            } catch (e) {}
          }
          return {
            success: true,
            launchId,
            autoResolved: resolved.autoResolved,
            resolvedSource: resolved.resolvedSource,
            resolvedLaunchName: resolved.resolvedLaunchName,
            totalCount: cached.totalCount || list.length,
            list,
            outcome: cachedOutcome || null,
            fromCache: true,
            cacheTier: age < UPDATES_CACHE_TTL_HOT ? 'hot' : 'cold',
            timestamp: Date.now(),
            elapsed: Date.now() - startTime
          }
        }
      }
    } catch (e) {}

    const q = [
      'format=json',
      'launch=' + encodeURIComponent(launchId),
      'ordering=' + encodeURIComponent('-created_on'),
      'limit=' + encodeURIComponent(String(limit))
    ].join('&')
    const url = `${LAUNCH_LIBRARY_API}/updates/?${q}`
    const apiData = await Promise.race([
      fetchAPI(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 updates 请求超时')), 15000))
    ])
    const results = Array.isArray(apiData && apiData.results) ? apiData.results : []
    const list = results.map((u) => ({
      id: u.id,
      comment: String(u.comment || ''),
      infoUrl: typeof u.info_url === 'string' ? u.info_url.trim() : '',
      createdOn: u.created_on || '',
      createdBy: String(u.created_by || '')
    }))

    // 写入缓存
    try {
      await db
        .collection(TIMELINE_CACHE_COL)
        .doc(updatesCacheId)
        .set({
          data: {
            data: list,
            totalCount: typeof apiData.count === 'number' ? apiData.count : list.length,
            updatedAtMs: Date.now()
          }
        })
    } catch (e) {}

    // 社媒/动态终态旁路：Launch success. + info_url → 写入 recent_settled（0 额外请求）
    const outcome = inferTerminalFromUpdateComments(list)
    if (outcome) {
      try {
        await mergeTerminalRowsIntoRecentSettled([
          {
            id: String(launchId),
            name: resolved.resolvedLaunchName || '',
            status: outcome.status,
            net: '',
            windowStart: '',
            windowEnd: '',
            settledAtMs: Date.now(),
            source: 'll2_updates',
            updateComment: outcome.comment,
            updateInfoUrl: outcome.infoUrl
          }
        ])
      } catch (e) {}
    }

    return {
      success: true,
      launchId,
      autoResolved: resolved.autoResolved,
      resolvedSource: resolved.resolvedSource,
      resolvedLaunchName: resolved.resolvedLaunchName,
      totalCount: typeof apiData.count === 'number' ? apiData.count : list.length,
      list,
      outcome: outcome || null,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  } catch (e) {
    return {
      success: false,
      error: e.message || 'fetch_launch_updates_failed',
      list: [],
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Action: fetchLaunchTimeline（含云数据库缓存）
// ══════════════════════════════════════════════════════════════
async function fetchLaunchTimelineAction(event) {
  const startTime = Date.now()
  try {
    const resolved = await resolveLaunchIdForLl2Progress(event || {})
    const launchId = resolved.launchId
    if (!launchId) {
      return {
        success: false,
        error: resolved.error === 'no_starship_launch' ? 'no_starship_launch' : resolved.error || 'missing_launch_id',
        timeline: [],
        launchId: '',
        autoResolved: resolved.autoResolved,
        resolvedSource: resolved.resolvedSource,
        resolvedLaunchName: resolved.resolvedLaunchName,
        timestamp: Date.now(),
        elapsed: Date.now() - startTime
      }
    }

    // 先查云数据库缓存
    const cacheDocId = `timeline_${launchId}`
    try {
      const cacheRes = await db.collection(TIMELINE_CACHE_COL).doc(cacheDocId).get()
      const cached = cacheRes && cacheRes.data
      if (cached && cached.updatedAtMs && Date.now() - cached.updatedAtMs < TIMELINE_CACHE_TTL) {
        return {
          success: true,
          launchId,
          autoResolved: resolved.autoResolved,
          resolvedSource: resolved.resolvedSource,
          resolvedLaunchName: resolved.resolvedLaunchName || cached.launchName || '',
          launchName: cached.launchName || '',
          net: cached.net || '',
          timeline: cached.data || [],
          timelineCount: (cached.data || []).length,
          fromCache: true,
          timestamp: Date.now(),
          elapsed: Date.now() - startTime
        }
      }
    } catch (e) {}

    const url = `${LAUNCH_LIBRARY_API}/launches/${encodeURIComponent(launchId)}/?format=json&mode=normal`
    const apiData = await Promise.race([
      fetchAPI(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 launch 详情请求超时')), 15000))
    ])
    const raw = Array.isArray(apiData && apiData.timeline) ? apiData.timeline : []
    const timeline = raw.map((row, idx) => {
      const t = row && row.type ? row.type : {}
      const id = t.id != null ? String(t.id) : String(idx)
      return {
        id,
        abbrev: typeof t.abbrev === 'string' ? t.abbrev.trim() : '',
        description: typeof t.description === 'string' ? t.description.trim() : '',
        relativeTime: typeof row.relative_time === 'string' ? row.relative_time.trim() : ''
      }
    })

    // 写入缓存
    const launchName = typeof apiData.name === 'string' ? apiData.name : ''
    const net = apiData.net || ''
    try {
      await db
        .collection(TIMELINE_CACHE_COL)
        .doc(cacheDocId)
        .set({ data: { data: timeline, launchName, net, updatedAt: db.serverDate(), updatedAtMs: Date.now() } })
    } catch (e) {}

    return {
      success: true,
      launchId,
      autoResolved: resolved.autoResolved,
      resolvedSource: resolved.resolvedSource,
      resolvedLaunchName: resolved.resolvedLaunchName || launchName,
      launchName,
      net,
      timeline,
      timelineCount: timeline.length,
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  } catch (e) {
    return {
      success: false,
      error: e.message || 'fetch_launch_timeline_failed',
      timeline: [],
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Action: fetchLaunchDetail（含云数据库缓存）
// ══════════════════════════════════════════════════════════════
async function fetchLaunchDetailAction(event) {
  const startTime = Date.now()
  try {
    const launchId = event && event.launchId
    if (!launchId || typeof launchId !== 'string') {
      return { success: false, error: 'launchId 不能为空', timestamp: Date.now() }
    }

    // _v7: 加入翻译富化字段（descriptionZh 等）；升版本让旧英文缓存整体失效
    const detailCacheKey = `api_cache_/launches/${launchId}/_${JSON.stringify({ format: 'json', mode: 'detailed' })}_full_v7`
    const forceRefresh = !!event.forceRefresh
    const now = Date.now()

    // 1) 先查云数据库缓存
    if (!forceRefresh) {
      try {
        const doc = await db.collection('space_devs_cache').doc(detailCacheKey).get()
        const cached = doc && doc.data && doc.data.data
        if (cached && cached.data && cached.expireAt && cached.expireAt > now) {
          // 旧缓存可能仍是 Ocean/ASDS：读出时就地 enrich，必要时回写，避免等 TTL
          const detail = cached.data
          let netPatched = false
          try {
            netPatched = !!enrichLaunchNetRecovery(detail)
          } catch (e) {}
          if (netPatched) {
            try {
              await db
                .collection('space_devs_cache')
                .doc(detailCacheKey)
                .set({
                  data: {
                    cacheKey: detailCacheKey,
                    data: { data: detail, expireAt: cached.expireAt },
                    updatedAt: db.serverDate(),
                    updatedAtMs: now
                  }
                })
            } catch (e) {}
          }
          // 缓存命中也顺带把终态回写 recent_settled / previous（0 额外 LL2）
          try {
            await settleTerminalFromLaunchDetail(detail, now, 'fetchLaunchDetail_cached')
          } catch (e) {}
          return { success: true, cached: true, data: detail, timestamp: now, elapsed: Date.now() - startTime }
        }
      } catch (_) {}
    }

    // 2) 拉 LL2 详情接口
    const fullUrl = `${LAUNCH_LIBRARY_API}/launches/${encodeURIComponent(launchId)}/?mode=detailed&format=json`
    const apiData = await Promise.race([
      fetchAPI(fullUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 详情接口超时')), 18000))
    ])
    if (!apiData || !apiData.id) {
      return {
        success: false,
        error: 'LL2 详情接口未返回有效数据',
        timestamp: Date.now(),
        elapsed: Date.now() - startTime
      }
    }

    // 2.4) 网系回收：Ocean/ASDS → NET（与列表同步口径一致）
    try {
      enrichLaunchNetRecovery(apiData)
    } catch (e) {
      console.warn('[net-recovery-enrich detail]', e.message || e)
    }

    // 2.5) 翻译富化（词典 + TMT + translation_cache），失败不影响主流程
    try {
      await enrichSingleLaunch(apiData)
    } catch (translateErr) {
      console.warn('[translate-enrich detail]', translateErr.message || translateErr)
    }

    // 2.6) 详情里的嵌套 updates 拆入 updates_{uuid}（冷/热共用，0 额外 LL2）
    if (Array.isArray(apiData.updates) && apiData.updates.length) {
      try {
        const mapped = apiData.updates
          .map((u) => ({
            id: u.id,
            comment: String(u.comment || ''),
            infoUrl: typeof u.info_url === 'string' ? u.info_url.trim() : '',
            createdOn: u.created_on || '',
            createdBy: String(u.created_by || '')
          }))
          .filter((u) => u.comment)
        if (mapped.length) {
          let existing = []
          try {
            const prev = await db
              .collection(TIMELINE_CACHE_COL)
              .doc('updates_' + launchId)
              .get()
            if (prev && prev.data && Array.isArray(prev.data.data)) existing = prev.data.data
          } catch (e) {}
          const byKey = new Map()
          const push = (arr) => {
            for (let i = 0; i < arr.length; i++) {
              const u = arr[i]
              if (!u || !u.comment) continue
              const key = u.id != null ? 'id:' + u.id : 'c:' + (u.createdOn || '') + '|' + u.comment
              if (!byKey.has(key)) byKey.set(key, u)
            }
          }
          push(mapped)
          push(existing)
          const merged = Array.from(byKey.values())
            .sort((a, b) => new Date(b.createdOn || 0).getTime() - new Date(a.createdOn || 0).getTime())
            .slice(0, 40)
          await db
            .collection(TIMELINE_CACHE_COL)
            .doc('updates_' + launchId)
            .set({
              data: {
                data: merged,
                totalCount: merged.length,
                updatedAtMs: now,
                expireAtMs: now + UPDATES_CACHE_TTL_COLD,
                source: 'fetchLaunchDetail',
                launchName: typeof apiData.name === 'string' ? apiData.name : ''
              }
            })
          const outcome = inferTerminalFromUpdateComments(merged)
          if (outcome) {
            await mergeTerminalRowsIntoRecentSettled([
              {
                id: String(launchId),
                name: typeof apiData.name === 'string' ? apiData.name : '',
                status: outcome.status,
                net: apiData.net || '',
                windowStart: '',
                windowEnd: '',
                settledAtMs: now,
                source: 'fetchLaunchDetail_updates',
                updateComment: outcome.comment,
                updateInfoUrl: outcome.infoUrl
              }
            ])
          }
        }
      } catch (e) {}
    }

    // 2.7) 详情 status 已是终态时写入 recent_settled + 就地修正 previous 列表缓存
    // （任务离开 upcoming 探针后，小时探针看不到 In Flight→Success，历史卡片会长期卡「飞行中」）
    try {
      await settleTerminalFromLaunchDetail(apiData, now, 'fetchLaunchDetail_status')
    } catch (e) {}

    // 3) 写入缓存（3.5 小时 TTL）
    const CACHE_DURATION = 3.5 * 60 * 60 * 1000
    try {
      await db
        .collection('space_devs_cache')
        .doc(detailCacheKey)
        .set({
          data: {
            cacheKey: detailCacheKey,
            data: { data: apiData, expireAt: now + CACHE_DURATION },
            updatedAt: db.serverDate(),
            updatedAtMs: now
          }
        })
    } catch (e) {}

    return { success: true, cached: false, data: apiData, timestamp: Date.now(), elapsed: Date.now() - startTime }
  } catch (e) {
    return {
      success: false,
      error: e.message || 'fetch_launch_detail_failed',
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Action: fetchLaunchStatuses — 倒计时到点实时状态确认
// 一次拉取前 10 个即将发射任务的最新状态（不带 hide_recent_previous，
// 刚点火的任务仍带 In Flight/Success 状态出现在结果里）。
// LL2 限流保护（匿名档 15 次/小时/IP）：
//   - 120s 共享缓存（前端发射窗约 3 分钟复查，多数命中缓存，不额外打 LL2）
//   - 429/异常响应识别为失败，回落到过期缓存（旧状态比误判"任务消失"好）
//   - 30s 失败记忆：失败后短时间内直接吃缓存/快速失败，防客户端重试连击
// ══════════════════════════════════════════════════════════════
const LIVE_STATUS_CACHE_DOC = '_live_status_cache'
const RECENT_SETTLED_DOC = '_recent_settled'
const LIVE_STATUS_CACHE_TTL = 120 * 1000
const LIVE_STATUS_STALE_MAX_MS = 15 * 60 * 1000
const LIVE_STATUS_FAIL_MEMO_MS = 30 * 1000
const LIVE_STATUS_PROBE_LIMIT = 10
const TERMINAL_STATUS_IDS = { 3: true, 4: true, 7: true, 9: true }
const INFLIGHT_STATUS_ID = 6
const UPDATES_TERMINAL = {
  success: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
  failure: { id: 4, name: 'Launch Failure', abbrev: 'Failure' },
  partial: { id: 7, name: 'Partial Failure', abbrev: 'Partial Failure' },
  inflight: { id: 6, name: 'Launch in Flight', abbrev: 'In Flight' }
}
let _liveStatusMem = { ts: 0, rows: null }
let _liveStatusFailAt = 0

function isLiftoffComment(c) {
  if (!c) return false
  if (/^in flight\.?$/.test(c)) return true
  if (/\bconfirmed liftoff\b/.test(c)) return true
  if (/\blaunch vehicle has lifted off\b/.test(c)) return true
  if (/\bliftoff (confirmed|successful)\b/.test(c)) return true
  if (/\blift[\s-]?off\b/.test(c) && !/\b(scrub|delay|hold|abort|cancel)\b/.test(c)) return true
  return false
}

/**
 * 从 LL2 updates comment 推断可 settle 状态（终态或飞行中）。
 * 与客户端 utils/ll2-updates-outcome.js 规则对齐。
 */
function inferTerminalFromUpdateComments(list) {
  if (!Array.isArray(list) || !list.length) return null
  for (let i = 0; i < list.length; i++) {
    const u = list[i]
    if (!u) continue
    const c = String(u.comment || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    if (!c) continue
    let kind = null
    if (
      /\blaunch success\b/.test(c) ||
      /\bmission success\b/.test(c) ||
      /\ball payloads? deployed\b/.test(c) ||
      /^success\.?$/.test(c)
    ) {
      if (!(/\b(not|no|failed)\b.*\bsuccess\b/.test(c) || /\bsuccess\b.*\b(not|no|failed)\b/.test(c))) {
        kind = 'success'
      }
    }
    if (!kind && (/\bpartial (launch )?failure\b/.test(c) || /\bpartial success\b/.test(c))) {
      kind = 'partial'
    }
    // 只接受对当前任务的直接失败结论，排除
    // "delayed due to previous H3 launch failure" 等历史背景描述。
    if (
      !kind &&
      (/^(launch|mission) failure\.?$/.test(c) ||
        /^(the )?(launch|mission) (has )?failed\.?$/.test(c) ||
        /^failure\.?$/.test(c))
    ) {
      kind = 'failure'
    }
    if (!kind && isLiftoffComment(c)) {
      kind = 'inflight'
    }
    if (!kind) continue
    return {
      status: UPDATES_TERMINAL[kind],
      comment: String(u.comment || '').trim(),
      infoUrl: String(u.infoUrl || u.info_url || '').trim(),
      createdOn: u.createdOn || u.created_on || '',
      kind
    }
  }
  return null
}

function slimStatusRow(r) {
  return {
    id: String(r.id || ''),
    name: typeof r.name === 'string' ? r.name : '',
    status: r.status
      ? {
          id: r.status.id,
          name: r.status.name || '',
          abbrev: r.status.abbrev || ''
        }
      : null,
    net: r.net || '',
    windowStart: r.window_start || '',
    windowEnd: r.window_end || ''
  }
}

/** 详情终态写入 previous 时的轻量 stub（足够列表 map，避免整包 detailed 过大） */
function buildPreviousStubFromLaunch(launch) {
  if (!launch || !launch.id) return null
  const cfg =
    (launch.rocket && launch.rocket.configuration) ||
    (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration) ||
    null
  const lsp = launch.launch_service_provider || launch.lsp || null
  const pad = launch.pad || null
  return {
    id: launch.id,
    name: typeof launch.name === 'string' ? launch.name : '',
    net: launch.net || '',
    window_start: launch.window_start || '',
    window_end: launch.window_end || '',
    status: launch.status
      ? {
          id: launch.status.id,
          name: launch.status.name || '',
          abbrev: launch.status.abbrev || ''
        }
      : null,
    mission: launch.mission ? { name: launch.mission.name || '', description: launch.mission.description || '' } : null,
    rocket: cfg ? { configuration: { name: cfg.name || '', full_name: cfg.full_name || '' } } : undefined,
    launch_service_provider: lsp ? { id: lsp.id, name: lsp.name || '', abbrev: lsp.abbrev || '' } : undefined,
    pad: pad
      ? {
          name: pad.name || '',
          location: pad.location
            ? { name: pad.location.name || '', country_code: pad.location.country_code || '' }
            : undefined
        }
      : undefined
  }
}

/**
 * 详情单条终态 → recent_settled + previous slim（有则改 status，无则插入头部）。
 */
async function settleTerminalFromLaunchDetail(launch, nowMs, source) {
  if (!launch || !launch.id || !launch.status) return
  const sid = launch.status.id != null ? Number(launch.status.id) : 0
  if (!TERMINAL_STATUS_IDS[sid]) return
  const now = nowMs || Date.now()
  const entry = {
    id: String(launch.id),
    name: typeof launch.name === 'string' ? launch.name : '',
    status: {
      id: launch.status.id,
      name: launch.status.name || '',
      abbrev: launch.status.abbrev || ''
    },
    net: launch.net || '',
    windowStart: launch.window_start || '',
    windowEnd: launch.window_end || '',
    settledAtMs: now,
    source: source || 'fetchLaunchDetail_status',
    launchStub: buildPreviousStubFromLaunch(launch)
  }
  await launchStatusStore.upsertOne(entry, { source: source || 'detail', observedAtMs: now })
}

/** previous 列表缓存 key 候选（与 syncSpaceDevsData / launch-net-hourly 对齐） */
function previousListCacheKeyCandidates() {
  const params = { format: 'json', limit: 100, mode: 'detailed', offset: 0, ordering: '-net' }
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  const base = `api_cache_/launches/previous/_${JSON.stringify(sorted)}`
  return ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', ''].map((s) => base + s)
}

function stubFromTerminalEntry(term) {
  if (term && term.launchStub && term.launchStub.id) return term.launchStub
  return {
    id: term.id,
    name: term.name || '',
    net: term.net || '',
    window_start: term.windowStart || term.net || '',
    window_end: term.windowEnd || '',
    status: term.status ? { id: term.status.id, name: term.status.name || '', abbrev: term.status.abbrev || '' } : null
  }
}

/** 用终态改 previous 云缓存；同 id 不存在则插入首批头部（避免详情已终态、列表刷新消失） */
async function patchPreviousCacheStatusFromTerminal(entries) {
  if (!Array.isArray(entries) || !entries.length) return { patched: 0 }
  const byId = new Map()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e && e.id && e.status) byId.set(String(e.id), e)
  }
  if (!byId.size) return { patched: 0 }

  const col = db.collection('space_devs_cache')
  let cacheKey = ''
  let wrapper = null
  let payload = null
  const keys = previousListCacheKeyCandidates()
  for (let i = 0; i < keys.length; i++) {
    try {
      const doc = await col.doc(keys[i]).get()
      if (doc && doc.data && doc.data.data) {
        cacheKey = keys[i]
        wrapper = doc.data
        payload = doc.data.data
        break
      }
    } catch (e) {}
  }
  if (!payload) return { patched: 0, skipped: 'previous_cache_miss' }

  const isBatched =
    !!(payload.isBatched || payload.isBatch) ||
    (Array.isArray(payload.results) && payload.results.length === 0 && Number(payload.count) > 0)

  let patched = 0
  let inserted = 0
  const foundIds = new Set()
  const patchRow = (row) => {
    if (!row || row.id == null) return false
    const id = String(row.id)
    const term = byId.get(id)
    if (!term || !term.status) return false
    foundIds.add(id)
    const curId = row.status && row.status.id != null ? Number(row.status.id) : 0
    const nextId = Number(term.status.id)
    // 已是终态且同 id：无需改；终态不可被降级（本函数只收终态）
    if (curId === nextId) return false
    if (TERMINAL_STATUS_IDS[curId] && curId !== nextId) {
      // 允许 Deployed(9) 覆盖 Success(3) 等终态升级；同级以详情为准
    }
    row.status = {
      id: term.status.id,
      name: term.status.name || '',
      abbrev: term.status.abbrev || ''
    }
    if (term.net) row.net = term.net
    return true
  }

  if (isBatched) {
    let firstBatchKey = ''
    let firstBatchWrapper = null
    let firstBatchPayload = null
    for (let batchIdx = 0; batchIdx < 40; batchIdx++) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      let batchDoc = null
      try {
        batchDoc = await col.doc(batchKey).get()
      } catch (e) {
        break
      }
      const batchWrapper = batchDoc && batchDoc.data
      const batchPayload = batchWrapper && batchWrapper.data
      if (!batchPayload || !Array.isArray(batchPayload.results)) break
      if (batchIdx === 0) {
        firstBatchKey = batchKey
        firstBatchWrapper = batchWrapper
        firstBatchPayload = batchPayload
      }
      let n = 0
      for (let r = 0; r < batchPayload.results.length; r++) {
        if (patchRow(batchPayload.results[r])) n++
      }
      if (!n) continue
      patched += n
      try {
        await col.doc(batchKey).set({
          data: {
            ...batchWrapper,
            data: batchPayload,
            updatedAt: db.serverDate(),
            updatedAtMs: Date.now()
          }
        })
      } catch (e) {}
    }
    const missing = []
    byId.forEach((term, id) => {
      if (!foundIds.has(id)) missing.push(term)
    })
    if (missing.length && firstBatchKey && firstBatchPayload) {
      const stubs = missing.map(stubFromTerminalEntry).filter(Boolean)
      firstBatchPayload.results = stubs.concat(firstBatchPayload.results || [])
      inserted = stubs.length
      try {
        await col.doc(firstBatchKey).set({
          data: {
            ...firstBatchWrapper,
            data: firstBatchPayload,
            updatedAt: db.serverDate(),
            updatedAtMs: Date.now()
          }
        })
      } catch (e) {}
    }
    if (patched || inserted) {
      try {
        await col.doc(cacheKey).set({
          data: {
            ...wrapper,
            updatedAt: db.serverDate(),
            updatedAtMs: Date.now()
          }
        })
      } catch (e) {}
    }
  } else if (Array.isArray(payload.results)) {
    for (let r = 0; r < payload.results.length; r++) {
      if (patchRow(payload.results[r])) patched++
    }
    const missing = []
    byId.forEach((term, id) => {
      if (!foundIds.has(id)) missing.push(term)
    })
    if (missing.length) {
      const stubs = missing.map(stubFromTerminalEntry).filter(Boolean)
      payload.results = stubs.concat(payload.results)
      inserted = stubs.length
    }
    if (patched || inserted) {
      try {
        await col.doc(cacheKey).set({
          data: {
            ...wrapper,
            data: { ...payload, results: payload.results },
            updatedAt: db.serverDate(),
            updatedAtMs: Date.now()
          }
        })
      } catch (e) {}
    }
  }

  return { patched, inserted, cacheKey }
}

/**
 * 把本次 live rows / updates 的终态或飞行中合并进 recent_settled（0 额外 LL2）。
 * 历史角标只消费终态；倒计时可读飞行中做跨会话 settle。终态不可被飞行中降级。
 */
async function mergeTerminalRowsIntoRecentSettled(rows) {
  if (!Array.isArray(rows) || !rows.length) return
  const now = Date.now()
  const entries = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const sid = r && r.status && r.status.id != null ? Number(r.status.id) : 0
    if (!r || !r.id) continue
    if (!TERMINAL_STATUS_IDS[sid] && sid !== INFLIGHT_STATUS_ID) continue
    const entry = {
      id: String(r.id),
      name: r.name || '',
      status: r.status,
      net: r.net || '',
      windowStart: r.windowStart || '',
      windowEnd: r.windowEnd || '',
      settledAtMs: r.settledAtMs || now,
      source: r.source || 'fetchLaunchStatuses'
    }
    if (r.updateComment) entry.updateComment = r.updateComment
    if (r.updateInfoUrl) entry.updateInfoUrl = r.updateInfoUrl
    entries.push(entry)
  }
  if (!entries.length) return

  await launchStatusStore.upsertMany(entries, { source: 'live', observedAtMs: now })
}

async function fetchLaunchStatusesAction() {
  const startTime = Date.now()
  const now = Date.now()

  // 1) 内存缓存（热实例）
  if (Array.isArray(_liveStatusMem.rows) && now - _liveStatusMem.ts < LIVE_STATUS_CACHE_TTL) {
    return {
      success: true,
      rows: _liveStatusMem.rows,
      fromCache: 'mem',
      timestamp: now,
      elapsed: Date.now() - startTime
    }
  }

  // 2) 数据库缓存（跨实例共享）；15 分钟内的过期数据留作失败回落（更老的会污染列表实况）
  let staleRows =
    Array.isArray(_liveStatusMem.rows) && now - _liveStatusMem.ts < LIVE_STATUS_STALE_MAX_MS
      ? _liveStatusMem.rows
      : null
  try {
    const cacheRes = await db.collection(TIMELINE_CACHE_COL).doc(LIVE_STATUS_CACHE_DOC).get()
    const cached = cacheRes && cacheRes.data
    if (cached && cached.updatedAtMs && Array.isArray(cached.data)) {
      if (now - cached.updatedAtMs < LIVE_STATUS_CACHE_TTL) {
        _liveStatusMem = { ts: cached.updatedAtMs, rows: cached.data }
        return { success: true, rows: cached.data, fromCache: 'db', timestamp: now, elapsed: Date.now() - startTime }
      }
      if (
        now - cached.updatedAtMs < LIVE_STATUS_STALE_MAX_MS &&
        (!staleRows || cached.updatedAtMs > _liveStatusMem.ts)
      ) {
        staleRows = cached.data
      }
    }
  } catch (e) {}

  // 刚失败过：不再打 LL2，有过期缓存就回落，没有则快速失败（客户端有 30 分钟兜底）
  if (now - _liveStatusFailAt < LIVE_STATUS_FAIL_MEMO_MS) {
    if (staleRows) {
      return { success: true, rows: staleRows, fromCache: 'stale', timestamp: now, elapsed: Date.now() - startTime }
    }
    return { success: false, error: 'll2_recently_failed', rows: [], timestamp: now, elapsed: Date.now() - startTime }
  }

  // 3) 实时请求 LL2（mode=list 极轻量）
  try {
    const url = `${LAUNCH_LIBRARY_API}/launches/upcoming/?format=json&mode=list&limit=${LIVE_STATUS_PROBE_LIMIT}&ordering=net`
    const apiData = await Promise.race([
      fetchAPI(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LL2 status 请求超时')), 15000))
    ])
    // 429 限流响应形如 { detail: "Request was throttled..." }，没有 results 数组。
    // 此时绝不能当成"成功但列表为空"——前端会误判任务已移出 upcoming 而直接切换。
    if (!apiData || !Array.isArray(apiData.results)) {
      throw new Error(apiData && apiData.detail ? `ll2_throttled: ${apiData.detail}` : 'll2_invalid_response')
    }
    const rows = apiData.results.map(slimStatusRow)

    // 按 id merge 写入：保留探针留下的其它行，只刷新本轮 5 条，避免覆盖 30 条探针结果
    let mergedRows = rows
    try {
      const cacheRes = await db.collection(TIMELINE_CACHE_COL).doc(LIVE_STATUS_CACHE_DOC).get()
      const cached = cacheRes && cacheRes.data
      const existing = cached && Array.isArray(cached.data) ? cached.data : []
      if (existing.length) {
        const byId = new Map()
        for (let i = 0; i < existing.length; i++) {
          const row = existing[i]
          if (row && row.id) byId.set(String(row.id), row)
        }
        for (let i = 0; i < rows.length; i++) {
          const id = String(rows[i].id)
          // 终态不可被后续 upcoming 探针里的 Go 覆盖
          const prev = byId.get(id)
          const inSid = rows[i].status && rows[i].status.id != null ? Number(rows[i].status.id) : 0
          const exSid = prev && prev.status && prev.status.id != null ? Number(prev.status.id) : 0
          if (prev && TERMINAL_STATUS_IDS[exSid] && !TERMINAL_STATUS_IDS[inSid]) {
            // keep prev
          } else {
            byId.set(id, rows[i])
          }
        }
        const out = []
        const seen = new Set()
        for (let i = 0; i < rows.length; i++) {
          const id = String(rows[i].id)
          out.push(byId.get(id) || rows[i])
          seen.add(id)
        }
        for (let i = 0; i < existing.length; i++) {
          const row = existing[i]
          if (!row || !row.id || seen.has(String(row.id))) continue
          out.push(row)
          seen.add(String(row.id))
        }
        mergedRows = out.slice(0, 40)
      }
    } catch (e) {}

    _liveStatusMem = { ts: Date.now(), rows: mergedRows }
    _liveStatusFailAt = 0
    try {
      await db
        .collection(TIMELINE_CACHE_COL)
        .doc(LIVE_STATUS_CACHE_DOC)
        .set({
          data: { data: mergedRows, updatedAtMs: Date.now() }
        })
    } catch (e) {}
    // 终态顺带写入 recent_settled，历史列表可修正角标（不另打 LL2）
    try {
      await mergeTerminalRowsIntoRecentSettled(rows)
    } catch (e) {}

    // 返回合并后的 rows：当前任务查找 + 列表实况 patch 都能受益
    return { success: true, rows: mergedRows, fromCache: '', timestamp: Date.now(), elapsed: Date.now() - startTime }
  } catch (e) {
    _liveStatusFailAt = Date.now()
    if (staleRows) {
      // 回落过期缓存：状态数据短时间内仍有参考价值，避免前端走盲切兜底
      return {
        success: true,
        rows: staleRows,
        fromCache: 'stale',
        timestamp: Date.now(),
        elapsed: Date.now() - startTime
      }
    }
    return {
      success: false,
      error: e.message || 'fetch_launch_statuses_failed',
      rows: [],
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Action: translateTexts — 客户端按需翻译（页面"翻译"按钮）
// 词典 + translation_cache + TMT；失败项返回空串，客户端保留原文
// ══════════════════════════════════════════════════════════════
const TRANSLATE_MAX_ITEMS = 20
const TRANSLATE_MAX_ITEM_CHARS = 4000
const TRANSLATE_MAX_TOTAL_CHARS = 12000

async function translateTextsAction(event) {
  const startTime = Date.now()
  const raw = Array.isArray(event && event.texts) ? event.texts : []
  if (!raw.length) {
    return { success: false, error: 'texts 不能为空', timestamp: Date.now() }
  }
  const texts = raw.slice(0, TRANSLATE_MAX_ITEMS).map((t) => String(t || '').slice(0, TRANSLATE_MAX_ITEM_CHARS))
  const total = texts.reduce((s, t) => s + t.length, 0)
  if (total > TRANSLATE_MAX_TOTAL_CHARS) {
    return { success: false, error: '文本总量超限', timestamp: Date.now() }
  }
  try {
    const list = await translateTextsBatch(texts)
    const translated = list.filter(Boolean).length
    return {
      success: true,
      list,
      translated,
      tmtConfigured: isTmtConfigured(),
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  } catch (e) {
    console.error('[translateTexts]', e.message || e)
    return {
      success: false,
      error: e.message || 'translate_failed',
      timestamp: Date.now(),
      elapsed: Date.now() - startTime
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 集合自动创建
// ══════════════════════════════════════════════════════════════
let _collectionsEnsured = false
let _legacySettledMigrated = false
async function ensureCollections() {
  if (_collectionsEnsured) return
  _collectionsEnsured = true
  const names = ['launch_timeline_cache', 'space_devs_cache', 'launch_status']
  for (const n of names) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
  if (!_legacySettledMigrated) {
    _legacySettledMigrated = true
    try {
      const legacy = await db.collection(TIMELINE_CACHE_COL).doc(RECENT_SETTLED_DOC).get()
      const rows = legacy && legacy.data && Array.isArray(legacy.data.data) ? legacy.data.data : []
      if (rows.length) await launchStatusStore.upsertMany(rows, { source: 'migration' })
    } catch (e) {}
  }
}

const RESOLVE_NON_TERMINAL_TTL_MS = 2 * 60 * 1000
const RESOLVE_FAILURE_TTL_MS = 30 * 1000
const RESOLVE_MAX_LL2_CALLS = 3
const RESOLVE_GLOBAL_HOURLY_BUDGET = 6
const _resolveInFlightById = new Map()
const _resolveFailureAtById = new Map()

async function acquireResolveBudget(requested) {
  const wanted = Math.max(0, Math.min(RESOLVE_MAX_LL2_CALLS, Number(requested) || 0))
  if (!wanted) return 0
  if (typeof db.runTransaction !== 'function') return Math.min(1, wanted)
  const bucket = ll2HourBucket(Date.now())
  const docId = `_resolve_rate_${bucket}`
  try {
    return await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(TIMELINE_CACHE_COL).doc(docId)
      let used = 0
      try {
        const result = await ref.get()
        used = Number(result && result.data && result.data.used) || 0
      } catch (e) {}
      const granted = Math.min(wanted, Math.max(0, RESOLVE_GLOBAL_HOURLY_BUDGET - used))
      if (granted > 0) {
        await ref.set({ data: { bucket, used: used + granted, updatedAtMs: Date.now() } })
      }
      return granted
    })
  } catch (e) {
    return 0
  }
}

function fetchLaunchStatusSingleFlight(id) {
  if (_resolveInFlightById.has(id)) return _resolveInFlightById.get(id)
  const promise = (async () => {
    const failedAt = Number(_resolveFailureAtById.get(id)) || 0
    if (Date.now() - failedAt < RESOLVE_FAILURE_TTL_MS) return null
    try {
      const url = `${LAUNCH_LIBRARY_API}/launches/${encodeURIComponent(id)}/?mode=list&format=json`
      const data = await Promise.race([
        fetchAPI(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))
      ])
      if (!data || !data.id) throw new Error('invalid_response')
      _resolveFailureAtById.delete(id)
      return data
    } catch (e) {
      _resolveFailureAtById.set(id, Date.now())
      return null
    } finally {
      _resolveInFlightById.delete(id)
    }
  })()
  _resolveInFlightById.set(id, promise)
  return promise
}

/** 按 id 解析状态：单文档缓存优先，过期非终态才受控访问 LL2。 */
async function resolveLaunchStatusesAction(event) {
  const startTime = Date.now()
  const raw = Array.isArray(event && event.ids) ? event.ids : []
  const ids = []
  const seen = new Set()
  for (let i = 0; i < raw.length && ids.length < 5; i++) {
    const id = String(raw[i] || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) {
    return { success: true, rows: [], ll2Calls: 0, timestamp: Date.now(), elapsed: 0 }
  }

  const settled = await launchStatusStore.getByIds(ids)
  const settledById = new Map()
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]
    if (s && s.id) settledById.set(String(s.id), s)
  }

  const rows = []
  const needFetch = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const hit = settledById.get(id)
    const sid = hit && hit.status && hit.status.id != null ? Number(hit.status.id) : 0
    const fresh = hit && Date.now() - Number(hit.observedAtMs || hit.updatedAtMs || 0) < RESOLVE_NON_TERMINAL_TTL_MS
    const hitNetMs = hit && hit.net ? new Date(hit.net).getTime() : 0
    const impossibleFutureTerminal = !!TERMINAL_STATUS_IDS[sid] && Number.isFinite(hitNetMs) && hitNetMs > Date.now()
    if (hit && hit.status && !impossibleFutureTerminal && (TERMINAL_STATUS_IDS[sid] || fresh)) {
      rows.push({
        id,
        name: hit.name || '',
        status: {
          id: hit.status.id,
          name: hit.status.name || '',
          abbrev: hit.status.abbrev || ''
        },
        net: hit.net || '',
        revision: Number(hit.revision) || 0,
        observedAtMs: Number(hit.observedAtMs) || 0,
        fromCache: 'launch_status'
      })
    } else {
      needFetch.push(id)
    }
  }

  const granted = await acquireResolveBudget(needFetch.length)
  const fetchIds = needFetch.slice(0, granted)
  const ll2Calls = fetchIds.length
  const fetched = await Promise.all(fetchIds.map(fetchLaunchStatusSingleFlight))

  const now = Date.now()
  for (let i = 0; i < fetched.length; i++) {
    const data = fetched[i]
    if (!data) continue
    let stored = null
    try {
      stored = await launchStatusStore.upsertOne({
        id: String(data.id),
        name: typeof data.name === 'string' ? data.name : '',
        status: data.status,
        net: data.net || '',
        windowStart: data.window_start || '',
        windowEnd: data.window_end || '',
        observedAtMs: now,
        source: 'resolve'
      })
    } catch (e) {}
    rows.push({
      id: String(data.id),
      name: typeof data.name === 'string' ? data.name : '',
      status: data.status
        ? { id: data.status.id, name: data.status.name || '', abbrev: data.status.abbrev || '' }
        : null,
      net: data.net || '',
      revision: stored ? Number(stored.revision) || 0 : 0,
      observedAtMs: now,
      fromCache: ''
    })
  }

  return {
    success: true,
    rows,
    ll2Calls,
    timestamp: Date.now(),
    elapsed: Date.now() - startTime
  }
}

async function getLaunchStatusSnapshotAction(event) {
  const ids = Array.isArray(event && event.ids) ? event.ids.map(String).filter(Boolean).slice(0, 100) : []
  const rows = ids.length
    ? await launchStatusStore.getByIds(ids)
    : await launchStatusStore.getRecent(Math.min(100, Number(event && event.limit) || 40))
  return { success: true, rows, timestamp: Date.now() }
}

async function backfillLaunchStatusPrioritiesAction() {
  let scanned = 0
  let updated = 0
  const batchSize = 100
  for (let offset = 0; offset < 1000; offset += batchSize) {
    const result = await db.collection('launch_status').skip(offset).limit(batchSize).get()
    const rows = result && Array.isArray(result.data) ? result.data : []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      scanned++
      const normalized = normalizeLaunchStatus(row)
      if (!normalized || normalized.sourcePriority <= 0) continue
      if (Number(row.sourcePriority) === normalized.sourcePriority) continue
      await launchStatusStore.upsertOne(row)
      updated++
    }
    if (rows.length < batchSize) break
  }
  return { success: true, scanned, updated, timestamp: Date.now() }
}

// ══════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════
exports.main = async (event = {}) => {
  await ensureCollections()
  const action = String(event.action || '').trim()

  switch (action) {
    case 'fetchLaunchUpdates':
      return fetchLaunchUpdatesAction(event)
    case 'fetchLaunchTimeline':
      return fetchLaunchTimelineAction(event)
    case 'fetchLaunchDetail':
      return fetchLaunchDetailAction(event)
    case 'fetchLaunchStatuses':
      return fetchLaunchStatusesAction()
    case 'resolveLaunchStatuses':
      return resolveLaunchStatusesAction(event)
    case 'getLaunchStatusSnapshot':
      return getLaunchStatusSnapshotAction(event)
    case 'backfillLaunchStatusPriorities':
      return backfillLaunchStatusPrioritiesAction()
    case 'translateTexts':
      return translateTextsAction(event)
    case 'translateDiag': {
      const diag = await runTranslateDiag()
      return { success: true, ...diag, timestamp: Date.now() }
    }
    default:
      return { success: false, error: `未知 action: ${action}`, timestamp: Date.now() }
  }
}
