/**
 * agent-actions — 小程序 AI 开发模式原子接口的数据后端
 *
 * 供 launch-skill 的原子接口通过 apiProxy 调用，输出面向 LLM 的瘦身中文结构：
 *   agentUpcomingLaunches — 即将发射列表（读 space_devs_cache slim 缓存）
 *   agentRecentLaunches   — 近期已完成发射列表
 *   agentLaunchDetail     — 单次发射详情（缓存优先，LL2 直连兜底）
 *   agentLaunchStats      — 年度全球发射统计（转调 getLaunchStats readOnly）
 *   agentAgencyInfo       — 发射商查询（读 agencies 聚合缓存）
 *
 * 约定：所有返回控制在几 KB 内（LLM 上下文限制 200KB，实际越小推理越快）
 */

const SPACE_DEVS_COL = 'space_devs_cache'

// 与 syncSpaceDevsData/_legacy.js 落库参数保持一致
const UPCOMING_CACHE_PATH = '/launches/upcoming/'
const UPCOMING_CACHE_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const PREVIOUS_CACHE_PATH = '/launches/previous/'
const PREVIOUS_CACHE_PARAMS = {
  format: 'json',
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: '-net'
}
const SLIM_SUFFIXES = ['_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

// 发射状态中文（LL2 status.abbrev/name → 中文），slim 缓存里通常已带 status.nameZh，这里兜底
const STATUS_ZH = {
  'Go': '确认发射',
  'Go for Launch': '确认发射',
  'TBC': '待确认',
  'To Be Confirmed': '待确认',
  'TBD': '待定',
  'To Be Determined': '待定',
  'Success': '发射成功',
  'Launch Successful': '发射成功',
  'Failure': '发射失败',
  'Launch Failure': '发射失败',
  'Partial Failure': '部分失败',
  'In Flight': '飞行中',
  'On Hold': '暂停',
  'Hold': '暂停'
}

// 主要发射商中文别名（服务端轻量词典，用于中文关键词检索；完整词典在前端）
const AGENCY_ZH_KEYWORDS = {
  'spacex': ['spacex', '太空探索技术公司', '太空探索'],
  'casc': ['casc', '中国航天科技集团', '中国航天', '航天科技'],
  'nasa': ['nasa', '美国国家航空航天局', '美国宇航局'],
  'rvsn rf': ['roscosmos', '俄罗斯航天', '俄航天'],
  'roscosmos': ['roscosmos', '俄罗斯国家航天集团', '俄罗斯航天'],
  'ula': ['ula', '联合发射联盟'],
  'rocket lab': ['rocket lab', '火箭实验室'],
  'blue origin': ['blue origin', '蓝色起源'],
  'arianespace': ['arianespace', '阿丽亚娜'],
  'isro': ['isro', '印度空间研究组织', '印度航天'],
  'jaxa': ['jaxa', '日本宇宙航空研究开发机构', '日本航天'],
  'landspace': ['landspace', '蓝箭航天', '蓝箭'],
  'ispace': ['ispace', '星际荣耀'],
  'galactic energy': ['galactic energy', '星河动力'],
  'space pioneer': ['space pioneer', '天兵科技'],
  'cas space': ['cas space', '中科宇航'],
  'orienspace': ['orienspace', '东方空间'],
  'expace': ['expace', '快舟', '航天科工火箭'],
  'firefly aerospace': ['firefly', '萤火虫航天'],
  'northrop grumman': ['northrop', '诺斯罗普·格鲁曼', '诺格']
}

function pad2(n) { return n < 10 ? '0' + n : '' + n }

/** ISO 时间 → 北京时间可读串（2026-07-05 18:30） */
function toBeijingText(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (isNaN(t)) return ''
  const d = new Date(t + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

function statusZhOf(status) {
  if (!status) return ''
  if (status.nameZh) return status.nameZh
  return STATUS_ZH[status.abbrev] || STATUS_ZH[status.name] || status.name || ''
}

function truncate(text, max) {
  const s = String(text || '').trim()
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

module.exports = function createAgentActions({ db, cloud, fetchJSON, getCache, setCache }) {
  function sortedParamsString(params) {
    const sorted = Object.keys(params).sort().reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
    return JSON.stringify(sorted)
  }

  /** 批次感知地读取 space_devs_cache 列表缓存（与 getLaunchStats 同一套约定） */
  async function readListCache(path, params, suffixes) {
    const sortedParams = sortedParamsString(params)
    let cacheKey = null
    let doc = null
    for (const sfx of (suffixes || [''])) {
      const key = `api_cache_${path}_${sortedParams}${sfx}`
      const d = await db.collection(SPACE_DEVS_COL).doc(key).get().catch(() => null)
      if (d && d.data && d.data.data) {
        cacheKey = key
        doc = d
        break
      }
    }
    if (!doc) return { results: [], updatedAt: 0 }

    const apiData = doc.data.data
    const updatedAt = doc.data.updatedAt || doc.data.timestamp || 0
    let allResults = []
    const isBatched = !!(apiData.isBatched || apiData.isBatch)
      || (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)
    if (isBatched) {
      let batchIdx = 0
      while (batchIdx < 40) {
        const batchKey = `${cacheKey}_batch_${batchIdx}`
        const batchDoc = await db.collection(SPACE_DEVS_COL).doc(batchKey).get().catch(() => null)
        const batchData = batchDoc && batchDoc.data && batchDoc.data.data
        if (!batchData || !Array.isArray(batchData.results)) break
        allResults = allResults.concat(batchData.results)
        batchIdx++
      }
    }
    if (!allResults.length && Array.isArray(apiData.results)) allResults = apiData.results
    return { results: allResults, updatedAt }
  }

  /** 发射记录 → LLM 友好精简行 */
  function slimLaunchRow(launch) {
    if (!launch || launch.id == null) return null
    const cfg = (launch.rocket && launch.rocket.configuration) || {}
    const lsp = launch.launch_service_provider || launch.lsp || {}
    const pad = launch.pad || {}
    const loc = pad.location || {}
    const mission = launch.mission || {}
    return {
      launchId: String(launch.id),
      name: launch.name || '',
      statusZh: statusZhOf(launch.status),
      status: (launch.status && launch.status.abbrev) || '',
      netUtc: launch.net || '',
      netBeijing: toBeijingText(launch.net),
      rocket: cfg.name || '',
      agency: lsp.name || '',
      agencyAbbrev: lsp.abbrev || '',
      agencyId: lsp.id != null ? String(lsp.id) : '',
      pad: pad.nameZh || pad.name || '',
      location: (loc.nameZh || loc.name || ''),
      orbit: (mission.orbit && (mission.orbit.nameZh || mission.orbit.name)) || '',
      // 图片仅供原子组件渲染（png/jpg 网络地址），对 LLM 无意义但体积极小
      image: (launch.image && (launch.image.thumbnail_url || launch.image.image_url)) || (typeof launch.image === 'string' ? launch.image : '') || ''
    }
  }

  function matchAgencyKeyword(row, keyword) {
    if (!keyword) return true
    const kw = String(keyword).trim().toLowerCase()
    if (!kw) return true
    const name = (row.agency || '').toLowerCase()
    const abbrev = (row.agencyAbbrev || '').toLowerCase()
    if (name.includes(kw) || abbrev.includes(kw)) return true
    // 中文关键词 → 别名表反查
    for (const enKey of Object.keys(AGENCY_ZH_KEYWORDS)) {
      const aliases = AGENCY_ZH_KEYWORDS[enKey]
      if (aliases.some((a) => a.includes(kw) || kw.includes(a))) {
        if (name.includes(enKey) || abbrev.includes(enKey) || enKey.includes(name)) return true
      }
    }
    return false
  }

  // ── 1. 即将发射 ──────────────────────────────────────────
  async function agentUpcomingLaunches(event) {
    const days = Math.min(Math.max(Number(event.days) || 7, 1), 30)
    const limit = Math.min(Math.max(Number(event.limit) || 8, 1), 20)
    const agencyKeyword = String(event.agencyKeyword || '').trim()

    const { results, updatedAt } = await readListCache(UPCOMING_CACHE_PATH, UPCOMING_CACHE_PARAMS, SLIM_SUFFIXES)
    if (!results.length) {
      return { success: false, error: 'no_data', message: '发射数据暂未就绪，请稍后重试' }
    }

    const now = Date.now()
    const horizon = now + days * 24 * 3600 * 1000
    const rows = []
    for (const launch of results) {
      const row = slimLaunchRow(launch)
      if (!row || !row.netUtc) continue
      const t = Date.parse(row.netUtc)
      if (isNaN(t) || t < now - 2 * 3600 * 1000 || t > horizon) continue
      if (!matchAgencyKeyword(row, agencyKeyword)) continue
      rows.push(row)
      if (rows.length >= limit) break
    }

    return {
      success: true,
      days,
      agencyKeyword,
      total: rows.length,
      updatedAt,
      items: rows
    }
  }

  // ── 2. 近期已完成发射 ────────────────────────────────────
  async function agentRecentLaunches(event) {
    const limit = Math.min(Math.max(Number(event.limit) || 8, 1), 20)
    const agencyKeyword = String(event.agencyKeyword || '').trim()

    const { results, updatedAt } = await readListCache(PREVIOUS_CACHE_PATH, PREVIOUS_CACHE_PARAMS, SLIM_SUFFIXES)
    if (!results.length) {
      return { success: false, error: 'no_data', message: '发射数据暂未就绪，请稍后重试' }
    }

    const rows = []
    for (const launch of results) {
      const row = slimLaunchRow(launch)
      if (!row) continue
      if (!matchAgencyKeyword(row, agencyKeyword)) continue
      rows.push(row)
      if (rows.length >= limit) break
    }

    return {
      success: true,
      agencyKeyword,
      total: rows.length,
      updatedAt,
      items: rows
    }
  }

  // ── 3. 发射详情 ──────────────────────────────────────────
  async function agentLaunchDetail(event) {
    const launchId = String(event.launchId || '').trim()
    if (!launchId) return { success: false, error: 'missing_launchId', message: '缺少 launchId 参数' }

    // 先查两份列表缓存（免网络请求）
    for (const [path, params] of [
      [UPCOMING_CACHE_PATH, UPCOMING_CACHE_PARAMS],
      [PREVIOUS_CACHE_PATH, PREVIOUS_CACHE_PARAMS]
    ]) {
      const { results } = await readListCache(path, params, SLIM_SUFFIXES)
      const hit = results.find((l) => l && String(l.id) === launchId)
      if (hit) {
        const row = slimLaunchRow(hit)
        const mission = hit.mission || {}
        return {
          success: true,
          source: 'cache',
          item: {
            ...row,
            missionName: mission.name || '',
            missionType: (mission.type && (mission.type.nameZh || mission.type.name)) || (typeof mission.type === 'string' ? mission.type : ''),
            description: truncate(mission.descriptionZh || mission.description, 600),
            webcastLive: hit.webcast_live === true
          }
        }
      }
    }

    // 兜底：LL2 直连（缓存 6 小时）
    const cacheKey = `agent_launch_detail_v1_${launchId}`
    const cached = await getCache(SPACE_DEVS_COL, cacheKey, 6 * 3600 * 1000)
    if (cached) return { success: true, source: 'll2_cache', item: cached }

    try {
      const data = await fetchJSON(
        `https://ll.thespacedevs.com/2.3.0/launches/${encodeURIComponent(launchId)}/?format=json`,
        { 'User-Agent': 'SpaceSync/1.0' },
        15000
      )
      if (!data || data.id == null) return { success: false, error: 'not_found', message: `未找到 ID 为 ${launchId} 的发射任务` }
      const row = slimLaunchRow(data)
      const mission = data.mission || {}
      const item = {
        ...row,
        missionName: mission.name || '',
        missionType: (mission.type && mission.type.name) || (typeof mission.type === 'string' ? mission.type : ''),
        description: truncate(mission.description, 600),
        webcastLive: data.webcast_live === true
      }
      await setCache(SPACE_DEVS_COL, cacheKey, item)
      return { success: true, source: 'll2', item }
    } catch (e) {
      return { success: false, error: 'fetch_failed', message: '发射详情查询失败，请稍后重试' }
    }
  }

  // ── 4. 年度全球发射统计（转调 getLaunchStats，readOnly 不打 LL2） ──
  async function agentLaunchStats(event) {
    const year = Number(event.year) || new Date().getUTCFullYear()

    const [summaryRes, breakdownRes] = await Promise.all([
      cloud.callFunction({
        name: 'getLaunchStats',
        data: { action: 'getGlobalSummary', year, readOnly: true }
      }).then((r) => r.result).catch(() => null),
      cloud.callFunction({
        name: 'getLaunchStats',
        data: { action: 'getGlobalBreakdown', year, readOnly: true }
      }).then((r) => r.result).catch(() => null)
    ])

    const summary = summaryRes && summaryRes.success && summaryRes.summary ? summaryRes.summary : null
    if (!summary) {
      return { success: false, error: 'no_data', message: `${year} 年统计数据暂未就绪，请稍后重试` }
    }

    const slimBucket = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map((b) => ({
      name: b.name || b.key || '',
      total: b.total != null ? b.total : (b.count != null ? b.count : 0),
      success: b.success != null ? b.success : null
    }))

    const out = {
      success: true,
      year,
      total: summary.total != null ? summary.total : 0,
      successCount: summary.success != null ? summary.success : 0,
      failureCount: summary.failure != null ? summary.failure : 0
    }
    if (breakdownRes && breakdownRes.success) {
      out.topCountries = slimBucket(breakdownRes.byCountry, 8)
      out.topAgencies = slimBucket(breakdownRes.byAgency, 8)
      out.topRockets = slimBucket(breakdownRes.byRocket, 8)
    }
    return out
  }

  // ── 5. 发射商查询 ────────────────────────────────────────
  const AGENCIES_AGGREGATE_PARAMS = { format: 'json', limit: 400, offset: 0 }

  async function agentAgencyInfo(event) {
    const keyword = String(event.keyword || '').trim()
    if (!keyword) return { success: false, error: 'missing_keyword', message: '缺少 keyword 参数' }

    const { results } = await readListCache('/agencies/', AGENCIES_AGGREGATE_PARAMS, [''])
    if (!results.length) {
      return { success: false, error: 'no_data', message: '发射商数据暂未就绪，请稍后重试' }
    }

    const kw = keyword.toLowerCase()
    const scored = []
    for (const a of results) {
      if (!a || a.id == null) continue
      const name = String(a.name || '').toLowerCase()
      const abbrev = String(a.abbrev || '').toLowerCase()
      let score = 0
      if (abbrev === kw || name === kw) score = 100
      else if (abbrev.startsWith(kw) || name.startsWith(kw)) score = 80
      else if (abbrev.includes(kw) || name.includes(kw)) score = 60
      else {
        // 中文别名反查
        for (const enKey of Object.keys(AGENCY_ZH_KEYWORDS)) {
          const aliases = AGENCY_ZH_KEYWORDS[enKey]
          if (aliases.some((al) => al === kw || al.includes(kw) || kw.includes(al))) {
            if (name.includes(enKey) || abbrev === enKey) { score = 70; break }
          }
        }
      }
      if (score > 0) scored.push({ score, a })
    }

    if (!scored.length) {
      return {
        success: false,
        error: 'not_found',
        message: `未找到与「${keyword}」匹配的发射商，可尝试英文名称或缩写（如 SpaceX、CASC、Rocket Lab）`
      }
    }

    scored.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score
      return (y.a.total_launch_count || 0) - (x.a.total_launch_count || 0)
    })

    const toRow = (a) => ({
      agencyId: String(a.id),
      name: a.name || '',
      abbrev: a.abbrev || '',
      type: (a.type && a.type.name) || '',
      country: (a.country && a.country[0] && a.country[0].name) || '',
      foundingYear: a.founding_year || null,
      totalLaunchCount: a.total_launch_count != null ? a.total_launch_count : null,
      successfulLaunches: a.successful_launches != null ? a.successful_launches : null,
      failedLaunches: a.failed_launches != null ? a.failed_launches : null,
      description: truncate(a.description, 400)
    })

    return {
      success: true,
      keyword,
      item: toRow(scored[0].a),
      alternates: scored.slice(1, 4).map((s) => ({
        agencyId: String(s.a.id),
        name: s.a.name || '',
        abbrev: s.a.abbrev || ''
      }))
    }
  }

  // ══════════════════════════════════════════════
  //  星舰进度（starship-skill 专用）
  // ══════════════════════════════════════════════

  const VEHICLE_STATUS_ZH = {
    'In Production': '生产中',
    'Under Construction': '建造中',
    'Testing': '测试中',
    'Ready': '准备就绪',
    'Ready for Flight': '待飞',
    'Active': '现役',
    'Retired': '已退役',
    'Destroyed': '已损毁',
    'Scrapped': '已拆解',
    'Lost': '已损失'
  }

  function vehicleStatusZh(status) {
    const s = String(status || '').trim()
    return VEHICLE_STATUS_ZH[s] || s
  }

  // ── 6. 星舰当前状态（下一飞组合体 + 飞行准备清单） ──
  async function agentStarshipStatus() {
    let doc = null
    try {
      const res = await db.collection('starshipStatus').doc('current').get()
      doc = res && res.data
    } catch (e) {}
    if (!doc) {
      return { success: false, error: 'no_data', message: '星舰状态数据暂未就绪，请稍后重试' }
    }

    const booster = doc.booster || {}
    const ship = doc.ship || {}
    const checklist = Array.isArray(doc.flightReadinessChecklist) ? doc.flightReadinessChecklist : []
    const checklistDone = checklist.filter((c) => c && c.done).length

    return {
      success: true,
      booster: {
        id: booster.id || '',
        statusZh: vehicleStatusZh(booster.status),
        progress: typeof booster.progress === 'number' ? booster.progress : null
      },
      ship: {
        id: ship.id || '',
        statusZh: vehicleStatusZh(ship.status),
        progress: typeof ship.progress === 'number' ? ship.progress : null
      },
      checklist: {
        done: checklistDone,
        total: checklist.length,
        pendingItems: checklist.filter((c) => c && !c.done).map((c) => String(c.title || '').trim()).filter(Boolean).slice(0, 6)
      },
      trackedLaunchId: String(doc.ll2TrackedLaunchId || '').trim()
    }
  }

  // ── 7. 星舰最新动态（starship_event_updates，内容已翻译为中文） ──
  async function agentStarshipUpdates(event) {
    const limit = Math.min(Math.max(Number(event.limit) || 5, 1), 10)
    let rows = []
    try {
      const res = await db.collection('starship_event_updates')
        .where({ status: 'published' })
        .orderBy('publishedAt', 'desc')
        .limit(limit)
        .get()
      rows = res && Array.isArray(res.data) ? res.data : []
    } catch (e) {}

    if (!rows.length) {
      return { success: false, error: 'no_data', message: '星舰动态数据暂未就绪，请稍后重试' }
    }

    return {
      success: true,
      total: rows.length,
      items: rows.map((it) => ({
        title: truncate(it.title, 80),
        content: truncate(it.content || it.summary, 300),
        author: it.author || it.authorName || '',
        publishedAtBeijing: toBeijingText(
          typeof it.publishedAt === 'number' ? new Date(it.publishedAt).toISOString() : it.publishedAt
        ),
        source: it.source || ''
      }))
    }
  }

  // ── 8. 下一次星舰试飞（优先 starshipStatus 追踪 ID，兜底按火箭名过滤 upcoming） ──
  async function agentStarshipNextFlight() {
    let trackedId = ''
    try {
      const res = await db.collection('starshipStatus').doc('current').get()
      trackedId = String((res && res.data && res.data.ll2TrackedLaunchId) || '').trim()
    } catch (e) {}

    const { results } = await readListCache(UPCOMING_CACHE_PATH, UPCOMING_CACHE_PARAMS, SLIM_SUFFIXES)
    if (!results.length) {
      return { success: false, error: 'no_data', message: '发射数据暂未就绪，请稍后重试' }
    }

    let hit = null
    if (trackedId) {
      hit = results.find((l) => l && String(l.id) === trackedId) || null
    }
    if (!hit) {
      hit = results.find((l) => {
        if (!l) return false
        const cfgName = String((l.rocket && l.rocket.configuration && l.rocket.configuration.name) || '').toLowerCase()
        const name = String(l.name || '').toLowerCase()
        return cfgName.includes('starship') || name.includes('starship')
      }) || null
    }

    if (!hit) {
      return {
        success: false,
        error: 'not_found',
        message: '当前发射日程中暂无已排期的星舰试飞任务，可能尚未公布日期'
      }
    }

    const row = slimLaunchRow(hit)
    const mission = hit.mission || {}
    return {
      success: true,
      item: {
        ...row,
        missionName: mission.name || '',
        description: truncate(mission.descriptionZh || mission.description, 500)
      }
    }
  }

  // ── 9. 星舰基地道路封闭（road_closure_notice） ──
  async function agentStarshipRoadClosures() {
    let rows = []
    try {
      const res = await db.collection('road_closure_notice')
        .where({ isActive: true })
        .limit(20)
        .get()
      rows = res && Array.isArray(res.data) ? res.data : []
    } catch (e) {}

    const now = Date.now()
    const STALE_TTL = 24 * 3600 * 1000
    const active = rows.filter((it) => {
      if (!it || !it.isActive) return false
      if (it.endAt && it.endAt > 0 && it.endAt < now) return false
      if ((!it.endAt || it.endAt === 0) && it.syncedAt && (now - it.syncedAt > STALE_TTL)) return false
      return true
    })

    if (!active.length) {
      return {
        success: true,
        hasClosure: false,
        items: []
      }
    }

    active.sort((a, b) => {
      const pa = (a.source === 'manual' ? 999 : 0) + (a.priority || 0)
      const pb = (b.source === 'manual' ? 999 : 0) + (b.priority || 0)
      return pb - pa
    })

    return {
      success: true,
      hasClosure: true,
      items: active.slice(0, 3).map((it) => ({
        message: truncate(it.message || it.statusText, 200),
        timeRange: it.timeRange || '',
        startBeijing: it.startAt ? toBeijingText(new Date(it.startAt).toISOString()) : '',
        endBeijing: it.endAt ? toBeijingText(new Date(it.endAt).toISOString()) : '',
        beachStatus: it.beachStatus || ''
      }))
    }
  }

  // ══════════════════════════════════════════════
  //  空间站动态（station-skill 专用）
  // ══════════════════════════════════════════════

  const STATION_LIST_PARAMS = { format: 'json', limit: 30, offset: 0 }
  const STATION_NAME_ZH = {
    4: '国际空间站 ISS',
    18: '天宫空间站'
  }
  const STATION_STATUS_ZH = {
    'active': '在轨运行中',
    'under construction': '建设中'
  }

  async function readCacheDocData(cacheKey) {
    const d = await db.collection(SPACE_DEVS_COL).doc(cacheKey).get().catch(() => null)
    return (d && d.data && d.data.data) || null
  }

  function slimAstronautNationality(astronaut) {
    const nat = astronaut && astronaut.nationality
    if (!nat) return ''
    if (typeof nat === 'string') return nat
    if (Array.isArray(nat) && nat.length) return nat[0].nationality_name || nat[0].name || ''
    return nat.name || ''
  }

  // ── 10. 在轨空间站概览（站列表 + 乘组 + 停靠飞行器，一次返回） ──
  async function agentStationStatus() {
    const listData = await readCacheDocData(
      `api_cache_/space_stations/_${sortedParamsString(STATION_LIST_PARAMS)}`
    )
    const rows = listData && Array.isArray(listData.results) ? listData.results : []
    let metas = rows.filter((s) => {
      const st = String((s.status && s.status.name) || '').toLowerCase()
      return st.includes('active') || st.includes('construction') || st.includes('assembly')
    })
    if (!metas.length) metas = [{ id: 4 }, { id: 18 }]

    // 各站详情 + 对接事件（全部读缓存，零 LL2 请求）
    const [dockingData, ...stationDetails] = await Promise.all([
      readCacheDocData(
        `api_cache_/docking_events/_${sortedParamsString({ limit: 50, offset: 0, ordering: '-docking', format: 'json' })}`
      ),
      ...metas.map((m) => readCacheDocData(`api_cache_/space_stations/${m.id}/_${JSON.stringify({ format: 'json' })}`))
    ])
    const dockingResults = dockingData && Array.isArray(dockingData.results) ? dockingData.results : []

    const stations = []
    for (let i = 0; i < metas.length; i++) {
      const raw = stationDetails[i]
      if (!raw || raw.id == null) continue

      // 乘组：读各 active expedition 详情缓存
      const expeditions = Array.isArray(raw.active_expeditions) ? raw.active_expeditions : []
      const crew = []
      for (const exp of expeditions) {
        if (!exp || exp.id == null) continue
        const expDetail = await readCacheDocData(`api_cache_/expeditions/${exp.id}/_${JSON.stringify({ format: 'json' })}`)
        const crewArr = expDetail && Array.isArray(expDetail.crew) ? expDetail.crew : []
        for (const c of crewArr) {
          const a = c && c.astronaut
          if (!a || !a.name) continue
          crew.push({
            name: a.name,
            nationality: slimAstronautNationality(a),
            agency: (a.agency && (a.agency.abbrev || a.agency.name)) || '',
            expedition: exp.name || ''
          })
        }
      }

      // 当前停靠飞行器（departure === null）
      const docked = dockingResults.filter((e) =>
        e && e.departure === null &&
        e.docking_location && e.docking_location.spacestation &&
        e.docking_location.spacestation.id === raw.id
      ).map((e) => {
        const sc = e.flight_vehicle_chaser && e.flight_vehicle_chaser.spacecraft
        const config = sc && sc.spacecraft_config
        const configType = config && config.type && config.type.name
        const isCrew = configType === 'Crew' ||
          (configType === 'Capsule' && config && config.name && !config.name.includes('Cargo'))
        return {
          name: (sc && sc.name) || '未知飞行器',
          kind: isCrew ? '载人' : '货运',
          dockedSinceBeijing: toBeijingText(e.docking)
        }
      })

      const statusName = String((raw.status && raw.status.name) || '').trim()
      stations.push({
        stationId: String(raw.id),
        name: STATION_NAME_ZH[raw.id] || raw.name || '',
        nameEn: raw.name || '',
        statusZh: STATION_STATUS_ZH[statusName.toLowerCase()] || statusName,
        founded: raw.founded || '',
        orbit: raw.orbit || 'LEO',
        owners: (Array.isArray(raw.owners) ? raw.owners : []).map((o) => o && (o.abbrev || o.name)).filter(Boolean),
        crewCount: crew.length,
        crew,
        dockedVehicles: docked
      })
    }

    if (!stations.length) {
      return { success: false, error: 'no_data', message: '空间站数据暂未就绪，请稍后重试' }
    }

    return { success: true, total: stations.length, stations }
  }

  // ══════════════════════════════════════════════
  //  助推器与回收（booster-skill 专用）
  // ══════════════════════════════════════════════

  const BOOSTER_STATUS_ZH = {
    'active': '现役',
    'retired': '已退役',
    'destroyed': '已损毁',
    'expended': '已消耗',
    'unknown': '未知'
  }
  // booster_genealogy 集合中的元数据文档（非助推器实体）
  const BOOSTER_META_DOC_PREFIXES = ['_']

  function isBoosterEntityDoc(doc) {
    if (!doc || !doc.serialNumber) return false
    const id = String(doc._id || '')
    return !BOOSTER_META_DOC_PREFIXES.some((p) => id.startsWith(p))
  }

  function slimBoosterRow(b) {
    return {
      serial: b.serialNumber,
      statusZh: BOOSTER_STATUS_ZH[b.status] || b.status || '未知',
      flights: b.flights != null ? b.flights : 0,
      successfulLandings: b.successfulLandings != null ? b.successfulLandings : 0,
      attemptedLandings: b.attemptedLandings != null ? b.attemptedLandings : 0,
      rocketFamily: b.rocketFamily || '',
      firstFlight: (b.firstFlight || '').slice(0, 10),
      lastFlight: (b.lastFlight || '').slice(0, 10)
    }
  }

  // ── 11. 单枚助推器战绩（按编号查询，如 B1067） ──
  async function agentBoosterInfo(event) {
    const serial = String(event.serial || '').trim()
    if (!serial) return { success: false, error: 'missing_serial', message: '缺少 serial 参数' }

    let rows = []
    try {
      const res = await db.collection('booster_genealogy')
        .where({
          serialNumber: db.RegExp({ regexp: '^' + serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', options: 'i' })
        })
        .limit(3)
        .get()
      rows = res && Array.isArray(res.data) ? res.data : []
    } catch (e) {}

    const hit = rows.find(isBoosterEntityDoc)
    if (!hit) {
      return {
        success: false,
        error: 'not_found',
        message: `未找到编号为「${serial}」的助推器，请确认编号（如 B1067、B1080）`
      }
    }

    const history = Array.isArray(hit.flightHistory) ? hit.flightHistory : []
    return {
      success: true,
      item: {
        ...slimBoosterRow(hit),
        recentFlights: history.slice(-5).reverse().map((f) => ({
          mission: f.mission || '',
          date: (f.date || '').slice(0, 10),
          success: f.success !== false
        }))
      }
    }
  }

  // ── 12. 回收统计总览（族谱聚合 + 复用排行） ──
  async function agentRecoveryStats(event) {
    const limit = Math.min(Math.max(Number(event.limit) || 5, 1), 10)

    let all = []
    try {
      // 按 flights 倒序分批读（族谱数据量数百条，读前 400 条足够覆盖统计）
      for (let i = 0; i < 4; i++) {
        const res = await db.collection('booster_genealogy')
          .orderBy('flights', 'desc')
          .skip(i * 100)
          .limit(100)
          .get()
        const batch = res && Array.isArray(res.data) ? res.data : []
        all = all.concat(batch)
        if (batch.length < 100) break
      }
    } catch (e) {}

    const boosters = all.filter(isBoosterEntityDoc)
    if (!boosters.length) {
      return { success: false, error: 'no_data', message: '助推器族谱数据暂未就绪，请稍后重试' }
    }

    let totalFlights = 0
    let totalLandings = 0
    let totalAttempts = 0
    let activeCount = 0
    for (const b of boosters) {
      totalFlights += b.flights || 0
      totalLandings += b.successfulLandings || 0
      totalAttempts += b.attemptedLandings || 0
      if (b.status === 'active') activeCount++
    }

    return {
      success: true,
      totalBoosters: boosters.length,
      activeBoosters: activeCount,
      totalFlights,
      totalLandings,
      totalAttempts,
      landingSuccessRate: totalAttempts > 0 ? `${((totalLandings / totalAttempts) * 100).toFixed(1)}%` : '',
      topReused: boosters.slice(0, limit).map(slimBoosterRow)
    }
  }

  return {
    agentUpcomingLaunches,
    agentRecentLaunches,
    agentLaunchDetail,
    agentLaunchStats,
    agentAgencyInfo,
    agentStarshipStatus,
    agentStarshipUpdates,
    agentStarshipNextFlight,
    agentStarshipRoadClosures,
    agentStationStatus,
    agentBoosterInfo,
    agentRecoveryStats
  }
}
