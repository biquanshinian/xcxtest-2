// utils/api-launch-list.js — launch list APIs (upcoming/completed)
const { getRocketImage, resolveMissionRocketImage } = require('./util.js')
const {
  extractBoosterInfoForList,
  isRecoverable,
  extractLaunchAgency
} = require('./api-booster-extract.js')
const { extractRecoveryIcons } = require('./landing-icons.js')
const {
  request,
  getCacheKey,
  getCountryDisplayPair,
  getStatusCategory,
  getStatusBadgeTextPair,
  emptyListResult,
  patchUpcomingLocalCacheById
} = require('./api-request.js')
const { pickLocalized, zhField, launchCardUiText } = require('./locale.js')
const {
  applyContentLangToMission,
  buildRocketNamePair,
  buildTitlePair,
  buildLaunchSitePair,
  resolveAgencyDisplayZh
} = require('./launch-card-i18n.js')
const { missionHasOrbitPano } = require('./orbit-pano-list-flag.js')
const { hydrateMissionAgencyLogo } = require('./upcoming-agency-logo-enrich.js')
const {
  isPlaceholderMissionField,
  parseRocketMissionFromLaunchName
} = require('./mission-list-card.js')

function getRocketDisplayNameFromConfig(configuration) {
  if (!configuration || typeof configuration !== 'object') return ''
  return configuration.name || configuration.full_name || ''
}

function getRocketDisplayNameFromLaunch(launch) {
  const configuration = (launch && launch.rocket && launch.rocket.configuration)
    || (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  const fromCfg = getRocketDisplayNameFromConfig(configuration)
  if (fromCfg && !isPlaceholderMissionField(fromCfg)) return fromCfg
  const parsed = parseRocketMissionFromLaunchName(launch && launch.name)
  if (parsed.rocketName && !isPlaceholderMissionField(parsed.rocketName)) return parsed.rocketName
  return ''
}

/** 列表与详情对齐头图：保留 LL2 configuration 快照供 getRocketImage 使用（与详情 rocketConfig 同源） */
function pickRocketConfigurationSnapshot(launch) {
  const cfg =
    (launch && launch.rocket && launch.rocket.configuration) ||
    (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  if (!cfg || typeof cfg !== 'object') return null
  const totalLaunchCount = Number(cfg.total_launch_count)
  return {
    name: typeof cfg.name === 'string' ? cfg.name : '',
    nameZh: typeof cfg.nameZh === 'string' ? cfg.nameZh : '',
    full_name: typeof cfg.full_name === 'string' ? cfg.full_name : '',
    full_nameZh: typeof cfg.full_nameZh === 'string' ? cfg.full_nameZh : '',
    total_launch_count: Number.isFinite(totalLaunchCount) && totalLaunchCount > 0 ? totalLaunchCount : null
  }
}

/** LL2 rocket.configuration 上的数值字段格式化为展示字符串 */
function formatRocketSpecScalar(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    const s = String(raw).trim()
    return s || null
  }
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  const t = Math.round(n * 100) / 100
  return String(t)
}

/**
 * 详情页「规格」区块（对齐 LL2 launcher_configuration：length、diameter、launch_mass、to_thrust、leo_capacity 等）
 */
function buildRocketSpecsForDetail(rocketConfig) {
  const cfg = rocketConfig && typeof rocketConfig === 'object' ? rocketConfig : null
  if (!cfg) return { rocketSpecsVisible: false, rocketSpecs: [] }
  const specs = []
  const push = (label, raw, suffix) => {
    const v = formatRocketSpecScalar(raw)
    if (v == null) return
    specs.push({
      label,
      line: suffix ? `${v} ${suffix}` : v,
      _wxkey: `${label}:${v}`
    })
  }
  push('长度', cfg.length, '米')
  push('直径', cfg.diameter, '米')
  push('发射质量', cfg.launch_mass, '吨')
  push('起飞推力', cfg.to_thrust, 'kN')
  push('LEO 运力', cfg.leo_capacity, '公斤')
  push('GTO 运力', cfg.gto_capacity, '公斤')
  push('GEO 运力', cfg.geo_capacity, '公斤')
  push('SSO 运力', cfg.sso_capacity, '公斤')
  if (cfg.min_stage != null && cfg.max_stage != null) {
    specs.push({
      label: '级数',
      line: `${cfg.min_stage}–${cfg.max_stage} 级`,
      _wxkey: 'stages'
    })
  }
  const costRaw = cfg.launch_cost
  if (costRaw != null && costRaw !== '') {
    const cn = Number(costRaw)
    if (Number.isFinite(cn)) {
      specs.push({
        label: '起飞成本（估值）',
        line: `$${cn.toLocaleString('en-US')} USD`,
        _wxkey: 'launch_cost'
      })
    }
  }
  return {
    rocketSpecsVisible: specs.length > 0,
    rocketSpecs: specs
  }
}

/**
 * 预计算回收标签的 CSS 类名和中英文案
 */
function computeRecoveryTagPair(boosterInfo, isRecoverableThisMission) {
  if (boosterInfo && boosterInfo.reused === false) {
    return {
      recoveryTagClass: 'recovery-tag--not-reused',
      recoveryTagTextZh: '未复用/首次',
      recoveryTagTextEn: 'New / first flight'
    }
  }
  if (isRecoverableThisMission) {
    return {
      recoveryTagClass: 'recovery-tag--reuse',
      recoveryTagTextZh: '可回收',
      recoveryTagTextEn: 'Recoverable'
    }
  }
  if (boosterInfo && boosterInfo.inferredRecovery) {
    return {
      recoveryTagClass: 'recovery-tag--expendable',
      recoveryTagTextZh: '回收信息待确认',
      recoveryTagTextEn: 'Recovery TBD'
    }
  }
  return {
    recoveryTagClass: 'recovery-tag--expendable',
    recoveryTagTextZh: '一次性',
    recoveryTagTextEn: 'Expendable'
  }
}

function buildLocalizedLaunchSite(launch) {
  const pair = buildLaunchSitePair(launch)
  return pickLocalized(pair.launchSiteZh, pair.launchSiteEn) || launchCardUiText('unknownPlace')
}

function mapLaunchToListItem(launch, index, offset, type) {
  const rocketNameEn = getRocketDisplayNameFromLaunch(launch)
  const rocketConfiguration = pickRocketConfigurationSnapshot(launch)
  // 优先云端 AI/学习词典写入的 nameZh，本地静态词典仅作兜底
  const rocketPair = buildRocketNamePair(rocketNameEn, rocketConfiguration)
  // 配图始终用英文原名匹配字典，避免中文名 miss
  const finalImage = resolveMissionRocketImage('', rocketNameEn, rocketConfiguration, true) || getRocketImage(rocketNameEn)
  const boosterInfo = extractBoosterInfoForList(launch, rocketNameEn, finalImage)
  const status = launch.status || {}
  const statusCategory = getStatusCategory(status)
  const { launchAgency, launchAgencyId, launchAgencyAbbrev, launchAgencyImage } = extractLaunchAgency(launch)
  const lsp = launch.launch_service_provider
  const agencyEn = (lsp && lsp.name) || launchAgency || ''
  const agencyZh = resolveAgencyDisplayZh(agencyEn, lsp && lsp.abbrev, lsp && zhField(lsp, 'name'))
  const _isRecoverable = isRecoverable(boosterInfo)
  const idPrefix = type === 'completed' ? 'completed' : 'mission'
  const countryPair = getCountryDisplayPair(launch.pad, launch.launch_service_provider, launch)
  const badgeOpts = {
    chineseRocket: countryPair.countryDisplayZh === '中国',
    countryDisplay: countryPair.countryDisplayZh
  }
  const badgePair = getStatusBadgeTextPair(status, statusCategory, badgeOpts)
  const sitePair = buildLaunchSitePair(launch)
  const titlePair = buildTitlePair(launch, rocketPair.rocketNameEn, rocketPair.rocketNameZh)
  const recoveryPair = computeRecoveryTagPair(boosterInfo, _isRecoverable)

  const item = {
    id: launch.id || `${idPrefix}-${offset + index}`,
    name: titlePair.nameEn,
    missionName: titlePair.missionNameEn,
    rocketName: rocketPair.rocketNameEn,
    launchSite: sitePair.launchSiteEn,
    padLocation: sitePair.padLocationEn,
    launchTime: launch.net || launch.window_start,
    previousNet: launch.previousNet || launch.previous_net || '',
    windowStart: launch.window_start,
    windowEnd: launch.window_end,
    // NET 精度：Day/Month 等粗档位的 net 只是占位时刻，倒计时不能按秒展示（详情页同源字段）
    netPrecision: (launch.net_precision && (launch.net_precision.name || launch.net_precision.abbrev)) || '',
    rocketImage: finalImage,
    rocketConfiguration,
    status: badgePair.statusBadgeTextZh,
    statusId: status.id != null ? Number(status.id) : null,
    statusAbbrev: status.abbrev || '',
    statusCategory,
    statusBadgeText: badgePair.statusBadgeTextZh,
    probability: launch.probability,
    countryDisplay: countryPair.countryDisplayZh,
    launchAgency: agencyZh || agencyEn,
    launchAgencyId,
    launchAgencyAbbrev,
    // 列表 LSP 若带 logo 则直接带上；瘦列表无图时先读本地按 id 缓存，再由 enrich 补齐
    launchAgencyImage: launchAgencyImage || '',
    rocketConfigId: (rocketConfiguration && rocketConfiguration.id != null) ? rocketConfiguration.id : null,
    padLocationId: (launch.pad && launch.pad.location && launch.pad.location.id != null)
      ? launch.pad.location.id
      : null,
    padLocationName: (launch.pad && launch.pad.location && (launch.pad.location.name || '')) || '',
    boosterInfo,
    isRecoverableThisMission: _isRecoverable,
    landingIcon: boosterInfo && (boosterInfo.landingType === 'ASDS' ? 'asds' : (boosterInfo.landingType === 'RTLS' || boosterInfo.landingLocation ? 'rtls' : null)) || null,
    recoveryIcons: extractRecoveryIcons(launch, type === 'completed' ? 'completed' : 'upcoming'),
    recoveryTagClass: recoveryPair.recoveryTagClass,
    recoveryTagText: recoveryPair.recoveryTagTextZh,
    _langPack: {
      rocketNameEn: rocketPair.rocketNameEn,
      rocketNameZh: rocketPair.rocketNameZh,
      padLocationEn: sitePair.padLocationEn,
      padLocationZh: sitePair.padLocationZh,
      launchSiteEn: sitePair.launchSiteEn,
      launchSiteZh: sitePair.launchSiteZh,
      nameEn: titlePair.nameEn,
      nameZh: titlePair.nameZh,
      missionNameEn: titlePair.missionNameEn,
      missionNameZh: titlePair.missionNameZh,
      launchAgencyEn: agencyEn,
      launchAgencyZh: agencyZh,
      countryDisplayEn: countryPair.countryDisplayEn,
      countryDisplayZh: countryPair.countryDisplayZh,
      statusBadgeTextEn: badgePair.statusBadgeTextEn,
      statusBadgeTextZh: badgePair.statusBadgeTextZh,
      recoveryTagTextEn: recoveryPair.recoveryTagTextEn,
      recoveryTagTextZh: recoveryPair.recoveryTagTextZh
    }
  }

  if (type === 'completed') {
    // 复用共享 id→category 映射（statusCategory 上面已用 getStatusCategory 算出）
    // 3=success 4=failure 7=partial(部分失败)；部分失败同时也算一种失败
    item.success = statusCategory === 'success' || statusCategory === 'deployed'
    item.isPartialFailure = statusCategory === 'partial'
    item.isFailure = statusCategory === 'failure' || statusCategory === 'partial'
    const mission = launch.mission
    // 长文本默认英文原文，预翻译中文随数据携带（详情页翻译按钮使用）
    item.missionDescription = (mission && mission.description) || ''
    item.missionDescriptionZh = mission ? zhField(mission, 'description') : ''
    item.isExpired = false
  }

  item.hasOrbitPano = missionHasOrbitPano(item)
  const hydrated = hydrateMissionAgencyLogo(item)
  if (hydrated && hydrated.launchAgencyImage) item.launchAgencyImage = hydrated.launchAgencyImage
  return applyContentLangToMission(item)
}

// ── 模块级内存快照 + inflight 去重 ──
// index / mission-detail / profile / search / 简报等调用方共享同一份列表结果，
// 短时间内重复调用不再各自走 storage/云库读路径（底层 api-request 仍有 30 分钟多层缓存兜底）。
const LIST_SNAPSHOT_TTL = 5 * 60 * 1000
const _listSnapshots = {}
const _listInflight = {}

/** 每次命中都返回浅拷贝的列表项，避免调用方就地改写污染共享快照 */
function cloneListResult(result) {
  return {
    list: (result.list || []).map((item) => {
      const next = { ...item }
      if (item && item._langPack && typeof item._langPack === 'object') {
        next._langPack = Object.assign({}, item._langPack)
      }
      next.hasOrbitPano = missionHasOrbitPano(next)
      return applyContentLangToMission(next)
    }),
    hasMore: result.hasMore,
    nextOffset: result.nextOffset
  }
}

function withListSnapshot(key, fetcher) {
  const cached = _listSnapshots[key]
  if (cached && Date.now() - cached.at < LIST_SNAPSHOT_TTL) {
    return Promise.resolve(cloneListResult(cached.result))
  }
  if (_listInflight[key]) {
    return _listInflight[key].then(cloneListResult)
  }
  const inflight = fetcher()
    .then((result) => {
      _listSnapshots[key] = { at: Date.now(), result }
      return result
    })
    .finally(() => {
      delete _listInflight[key]
    })
  _listInflight[key] = inflight
  return inflight.then(cloneListResult)
}

function getUpcomingMissions(limit = 10, offset = 0) {
  const { getContentLang } = require('./locale.js')
  return withListSnapshot(`upcoming:${limit}:${offset}:${getContentLang()}`, () => fetchUpcomingMissions(limit, offset))
}

function fetchUpcomingMissions(limit = 10, offset = 0) {
  // 使用 /launches/upcoming/ 端点获取即将发射的任务
  // /launches/upcoming/ 本身只返回未来任务，无需客户端再过滤过期
  return request('/launches/upcoming/', {
    limit: limit,
    offset: offset,
    ordering: 'net',
    mode: 'detailed',
    format: 'json',
    hide_recent_previous: true
  }).then(data => {
    if (!data) {
      return { list: [], hasMore: false, nextOffset: 0 }
    }
    if (!data.results || !Array.isArray(data.results)) {
      return { list: [], hasMore: false, nextOffset: 0 }
    }

    // /launches/upcoming/ 端点直接返回即将发射的任务，不需要过滤
    const upcomingLaunches = data.results
    
    // 转换数据格式，提取助推器信息
    const list = upcomingLaunches.map((launch, index) => mapLaunchToListItem(launch, index, offset, 'upcoming'))
    // 与 getCompletedMissions 完全一致的分页逻辑
    const actualReturnedCount = list.length
    // 优先用 LL2 返回的总数 data.count 判断是否还有更多；无 count 时回退本批长度，再回退 data.next
    const totalAvailable = typeof data.count === 'number' ? data.count : actualReturnedCount
    const hasMore = (offset + actualReturnedCount) < totalAvailable || !!(data && data.next)
    return { list, hasMore: hasMore, nextOffset: offset + actualReturnedCount }
  }).catch(error => {
    throw error
  })
}


/**
 * 获取已完成的任务列表（使用 /launches/previous/ 端点）
 * @param {Number} limit 返回数量，默认10
 * @param {Number} offset 偏移量，默认0
 * @returns {Promise} 返回已完成任务列表
 */
function getCompletedMissions(limit = 10, offset = 0) {
  const { getContentLang } = require('./locale.js')
  return withListSnapshot(`completed:${limit}:${offset}:${getContentLang()}`, () => fetchCompletedMissions(limit, offset))
}

function fetchCompletedMissions(limit = 10, offset = 0) {
  // 使用 /launches/previous/ 端点获取已完成的任务
  return request('/launches/previous/', {
    limit: limit,
    offset: offset,
    ordering: '-net', // 按时间倒序，最新的在前
    mode: 'detailed',
    format: 'json' // 明确指定JSON格式
  }).then(data => {
    if (!data) return emptyListResult()
    if (!data.results || !Array.isArray(data.results)) return emptyListResult()
    
    const completedLaunches = data.results
    
    const list = completedLaunches.map((launch, index) => mapLaunchToListItem(launch, index, offset, 'completed'))
    // 仅依赖 data.next 在“从缓存切片返回”时不可靠（next 可能为 null 或被构造为占位）
    // 这里按“实际可用总量 vs 本次返回量”计算，确保能滚动加载到缓存末尾
    const actualReturnedCount = list.length
    // 优先用 LL2 返回的总数 data.count 判断是否还有更多；无 count 时回退本批长度，再回退 data.next
    const totalAvailable = typeof data.count === 'number' ? data.count : actualReturnedCount
    const hasMore = (offset + actualReturnedCount) < totalAvailable || !!(data && data.next)
    return { list, hasMore: hasMore, nextOffset: offset + actualReturnedCount }
  }).catch(error => {
    throw error
  })
}

/** 列表项是否为星舰体系任务（火箭名 / 任务名关键词） */
function isStarshipListItem(mission) {
  if (!mission || typeof mission !== 'object') return false
  const hay = [mission.rocketName, mission.name, mission.missionName]
    .filter(Boolean)
    .join(' ')
  return /starship|super\s*heavy|星舰|超重/i.test(hay)
}

/**
 * 即将发射的星舰任务。
 * 注意：不能直接带 rocket__configuration__name 打 request——api-request 候选缓存会回退到
 * 未过滤的 upcoming 母缓存并切片，导致混入猎鹰等无关任务。改为读通用即将发射列表后再筛选。
 * @param {Number} limit 返回数量，默认 10
 * @param {Number} offset 偏移量，默认 0
 */
function getUpcomingStarshipMissions(limit = 10, offset = 0) {
  const safeLimit = Math.max(1, Number(limit) || 10)
  const safeOffset = Math.max(0, Number(offset) || 0)
  // 多取一批再筛，避免星舰排在列表后部时漏掉
  return getUpcomingMissions(Math.max(80, safeLimit * 8), 0).then((res) => {
    const filtered = (res.list || []).filter(isStarshipListItem)
    const list = filtered.slice(safeOffset, safeOffset + safeLimit)
    return {
      list,
      hasMore: safeOffset + list.length < filtered.length,
      nextOffset: safeOffset + list.length
    }
  })
}

/** 按 NET / 状态推断列表类型，供搜索结果进详情用 */
function inferLaunchListType(launch) {
  const sid = launch && launch.status && launch.status.id != null
    ? Number(launch.status.id)
    : NaN
  // LL2：3 success / 4 failure / 7 partial
  if (sid === 3 || sid === 4 || sid === 7) return 'completed'
  const net = launch && (launch.net || launch.window_start)
  const t = net ? Date.parse(net) : NaN
  if (Number.isFinite(t) && t < Date.now() - 60 * 60 * 1000) return 'completed'
  return 'upcoming'
}

function mapSearchResultsToList(data, typeHint) {
  const results = data && Array.isArray(data.results) ? data.results : []
  return results.map((launch, index) => {
    const detailType = typeHint || inferLaunchListType(launch)
    const item = mapLaunchToListItem(launch, index, 0, detailType)
    item._detailType = detailType
    return item
  })
}

/**
 * 按 NET 窗口裁剪搜索结果（天）。withinDays>0 时只保留 [now-1h, now+days]。
 * @param {object[]} list
 * @param {number} withinDays
 * @returns {object[]}
 */
function filterLaunchesWithinUpcomingDays(list, withinDays) {
  const n = Number(withinDays)
  if (!Number.isFinite(n) || n <= 0) return Array.isArray(list) ? list : []
  const now = Date.now()
  const end = now + n * 24 * 3600 * 1000
  const start = now - 60 * 60 * 1000
  return (Array.isArray(list) ? list : []).filter((m) => {
    if (!m || !m.launchTime) return false
    const t = new Date(m.launchTime).getTime()
    return Number.isFinite(t) && t >= start && t <= end
  })
}

/**
 * 云端关键词搜索发射任务（LL2 search）。
 * 用于星问「问谁出谁」本地缓存未命中时的回退。
 * @param {string} keyword
 * @param {{ limit?: number, withinDays?: number, upcomingOnly?: boolean, completedOnly?: boolean }} [options]
 *   - withinDays: 只保留未来 N 天内任务（发射列表探云用）
 *   - upcomingOnly: 只搜 upcoming，不合并 previous
 *   - completedOnly: 只搜 previous（历史发射）
 * @returns {Promise<{ list: object[] }>}
 */
function searchLaunchesByKeyword(keyword, options) {
  const q = String(keyword || '').trim()
  if (!q) return Promise.resolve({ list: [] })
  const limit = Math.max(1, Math.min(Number(options && options.limit) || 20, 40))
  const withinDays = Number(options && options.withinDays)
  const completedOnly = !!(options && options.completedOnly)
  const upcomingOnly = !completedOnly && (
    !!(options && options.upcomingOnly) || (Number.isFinite(withinDays) && withinDays > 0)
  )

  const applyWindow = (list) => {
    if (!Number.isFinite(withinDays) || withinDays <= 0) return list || []
    return filterLaunchesWithinUpcomingDays(list, withinDays)
  }

  const fetchUpcomingSearch = () => request('/launches/upcoming/', {
    search: q,
    limit: Math.min(limit, 40),
    offset: 0,
    ordering: 'net',
    mode: 'detailed',
    format: 'json',
    hide_recent_previous: true
  }, null, true).then((d) => mapSearchResultsToList(d, 'upcoming'))

  const fetchPreviousSearch = () => request('/launches/previous/', {
    search: q,
    limit: Math.min(limit, 40),
    offset: 0,
    ordering: '-net',
    mode: 'detailed',
    format: 'json'
  }, null, true).then((d) => mapSearchResultsToList(d, 'completed'))

  if (completedOnly) {
    return fetchPreviousSearch()
      .then((list) => ({ list: (list || []).slice(0, limit) }))
      .catch(() => ({ list: [] }))
  }

  if (upcomingOnly) {
    return fetchUpcomingSearch()
      .then((list) => ({ list: applyWindow(list).slice(0, limit) }))
      .catch(() => ({ list: [] }))
  }

  const fetchMain = () => request('/launches/', {
    search: q,
    limit,
    offset: 0,
    ordering: '-net',
    mode: 'detailed',
    format: 'json'
  }, null, true).then((data) => mapSearchResultsToList(data))

  return fetchMain()
    .then((list) => {
      if (list && list.length) return { list: applyWindow(list).slice(0, limit) }
      // 部分缓存链路对 /launches/ 支持弱：拆 upcoming + previous 再搜
      return Promise.all([
        fetchUpcomingSearch().catch(() => []),
        request('/launches/previous/', {
          search: q,
          limit: Math.min(limit, 20),
          offset: 0,
          ordering: '-net',
          mode: 'detailed',
          format: 'json'
        }, null, true).then((d) => mapSearchResultsToList(d, 'completed')).catch(() => [])
      ]).then(([up, prev]) => {
        const seen = {}
        const merged = []
        ;[].concat(up || [], prev || []).forEach((m) => {
          const id = m && m.id != null ? String(m.id) : ''
          if (!id || seen[id]) return
          seen[id] = true
          merged.push(m)
        })
        return { list: applyWindow(merged).slice(0, limit) }
      })
    })
    .catch(() => ({ list: [] }))
}

module.exports = {
  getUpcomingMissions,
  getCompletedMissions,
  getUpcomingStarshipMissions,
  searchLaunchesByKeyword,
  filterLaunchesWithinUpcomingDays,
  isStarshipListItem,
  mapLaunchToListItem,
  fetchLaunchAsListItem,
  patchCompletedListSnapshots,
  invalidateListSnapshots,
  findMissionInListSnapshots,
  peekUpcomingMissionsList,
  peekUpcomingMissionsFromLocalCache,
  getUpcomingMissionsAny,
  patchUpcomingLocalCacheById
}

/** 用详情同源 fetchLaunchDetail 补一张完整列表卡（云端缓存，顺带回写 previous stub） */
function fetchLaunchAsListItem(launchId, type) {
  const id = String(launchId || '').trim()
  if (!id) return Promise.resolve(null)
  const detailType = type === 'upcoming' ? 'upcoming' : 'completed'
  const viaCloud = () => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      return Promise.reject(new Error('no_cloud'))
    }
    return wx.cloud
      .callFunction({
        name: 'll2Query',
        data: { action: 'fetchLaunchDetail', launchId: id },
        timeout: 15000
      })
      .then((res) => {
        const data = res && res.result && res.result.data
        if (!data || !data.id) throw new Error('empty_detail')
        return mapLaunchToListItem(data, 0, 0, detailType)
      })
  }
  return viaCloud().catch(() =>
    request(`/launches/${id}/`, { mode: 'detailed', format: 'json' }, 10000, true).then((data) => {
      if (!data || !data.id) return null
      return mapLaunchToListItem(data, 0, 0, detailType)
    })
  ).catch(() => null)
}

function patchCompletedListSnapshots(id, card) {
  if (id == null || !card) return
  const idStr = String(id)
  const keys = Object.keys(_listSnapshots)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key.indexOf('completed:') !== 0) continue
    const entry = _listSnapshots[key]
    const list = entry && entry.result && Array.isArray(entry.result.list) ? entry.result.list : null
    if (!list || !list.length) continue
    for (let j = 0; j < list.length; j++) {
      if (list[j] && String(list[j].id) === idStr) {
        list[j] = { ...card }
        if (card._langPack && typeof card._langPack === 'object') {
          list[j]._langPack = Object.assign({}, card._langPack)
        }
      }
    }
  }
}

function invalidateListSnapshots() {
  Object.keys(_listSnapshots).forEach((k) => {
    delete _listSnapshots[k]
  })
}

/**
 * 从模块级列表快照里按 id 找任务（不发网络）。
 * 供详情页深链/无 opener 时作日程权威短路。
 */
/** 任意一份未过期的 upcoming 内存快照（不发网络），优先更长的那份 */
function peekUpcomingMissionsFromLocalCache(limit) {
  try {
    const { peekCachedLaunchList } = require('./api-request.js')
    if (typeof peekCachedLaunchList !== 'function') return null
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20))
    const data = peekCachedLaunchList(
      '/launches/upcoming/',
      {
        limit: safeLimit,
        offset: 0,
        ordering: 'net',
        mode: 'detailed',
        format: 'json',
        hide_recent_previous: true
      },
      true
    )
    if (!data || !Array.isArray(data.results) || !data.results.length) return null
    return data.results.slice(0, safeLimit).map((launch, index) =>
      mapLaunchToListItem(launch, index, 0, 'upcoming')
    )
  } catch (e) {
    return null
  }
}

function peekUpcomingMissionsList() {
  const now = Date.now()
  let best = null
  const keys = Object.keys(_listSnapshots)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key.indexOf('upcoming:') !== 0) continue
    const entry = _listSnapshots[key]
    if (!entry || now - entry.at >= LIST_SNAPSHOT_TTL) continue
    const list = entry.result && Array.isArray(entry.result.list) ? entry.result.list : null
    if (!list || !list.length) continue
    if (!best || list.length > best.length) best = list
  }
  if (!best) return null
  return best.map((item) => {
    const next = { ...item }
    if (item && item._langPack && typeof item._langPack === 'object') {
      next._langPack = Object.assign({}, item._langPack)
    }
    next.hasOrbitPano = missionHasOrbitPano(next)
    return applyContentLangToMission(next)
  })
}

function peekUpcomingMissionsInflight() {
  const keys = Object.keys(_listInflight)
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('upcoming:') === 0) return _listInflight[keys[i]]
  }
  return null
}

/** 开屏/倒计时：复用首页已在飞的 upcoming，避免再打一枪 limit=20 */
function getUpcomingMissionsAny(fallbackLimit) {
  const peeked = peekUpcomingMissionsList()
  if (peeked && peeked.length) return Promise.resolve({ list: peeked })
  const inflight = peekUpcomingMissionsInflight()
  if (inflight) return inflight.then(cloneListResult)
  return getUpcomingMissions(fallbackLimit || 20, 0)
}

function findMissionInListSnapshots(id, detailType) {
  if (id == null || id === '') return null
  const idStr = String(id)
  const prefix = detailType === 'completed' ? 'completed:' : 'upcoming:'
  const keys = Object.keys(_listSnapshots)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key.indexOf(prefix) !== 0) continue
    const entry = _listSnapshots[key]
    const list = entry && entry.result && Array.isArray(entry.result.list) ? entry.result.list : null
    if (!list || !list.length) continue
    for (let j = 0; j < list.length; j++) {
      const m = list[j]
      if (m && String(m.id) === idStr) {
        const next = { ...m }
        if (m._langPack && typeof m._langPack === 'object') {
          next._langPack = Object.assign({}, m._langPack)
        }
        return applyContentLangToMission(next)
      }
    }
  }
  return null
}
