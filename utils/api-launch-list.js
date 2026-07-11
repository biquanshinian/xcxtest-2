// utils/api-launch-list.js — launch list APIs (upcoming/completed)
const { getRocketImage } = require('./util.js')
const {
  extractBoosterInfoForList,
  isRecoverable,
  extractLaunchAgency
} = require('./api-booster-extract.js')
const { extractRecoveryIcons } = require('./landing-icons.js')
const {
  request,
  getCacheKey,
  formatPadLocation,
  getCountryDisplay,
  getStatusCategory,
  getStatusBadgeText,
  emptyListResult
} = require('./api-request.js')
const { pickLocalized, zhField } = require('./locale.js')
const { translateLocation } = require('./space-terms-i18n.js')

function getRocketDisplayNameFromConfig(configuration) {
  if (!configuration || typeof configuration !== 'object') return '未知火箭'
  return configuration.name || configuration.full_name || '未知火箭'
}

function getRocketDisplayNameFromLaunch(launch) {
  const configuration = (launch && launch.rocket && launch.rocket.configuration)
    || (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  return getRocketDisplayNameFromConfig(configuration)
}

/** 列表与详情对齐头图：保留 LL2 configuration 快照供 getRocketImage 使用（与详情 rocketConfig 同源） */
function pickRocketConfigurationSnapshot(launch) {
  const cfg =
    (launch && launch.rocket && launch.rocket.configuration) ||
    (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  if (!cfg || typeof cfg !== 'object') return null
  return {
    name: typeof cfg.name === 'string' ? cfg.name : '',
    full_name: typeof cfg.full_name === 'string' ? cfg.full_name : ''
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
 * 预计算回收标签的 CSS 类名和文案（避免 WXML 中写复杂三元表达式）
 */
function computeRecoveryTag(boosterInfo, isRecoverableThisMission) {
  if (boosterInfo && boosterInfo.reused === false) {
    return { recoveryTagClass: 'recovery-tag--not-reused', recoveryTagText: '未复用/首次' }
  }
  if (isRecoverableThisMission) {
    return { recoveryTagClass: 'recovery-tag--reuse', recoveryTagText: '可回收' }
  }
  if (boosterInfo && boosterInfo.inferredRecovery) {
    return { recoveryTagClass: 'recovery-tag--expendable', recoveryTagText: '回收信息待确认' }
  }
  return { recoveryTagClass: 'recovery-tag--expendable', recoveryTagText: '一次性' }
}


function buildLocalizedLaunchSite(launch) {
  const pad = launch && launch.pad
  if (!pad) return '未知地点'
  const padEn = (pad.name || '').trim()
  const locEn = (pad.location && pad.location.name) ? String(pad.location.name).trim() : ''
  // 中文候选 = 云端 nameZh → 客户端词典；pickLocalized 再按语言选中文或英文
  const padDisplay = pickLocalized(zhField(pad, 'name') || translateLocation(padEn), padEn)
  const locDisplay = pickLocalized(
    (pad.location ? (zhField(pad.location, 'name') || translateLocation(locEn)) : ''),
    locEn
  )
  if (padDisplay && locDisplay) return `${padDisplay}, ${locDisplay}`.trim()
  return padDisplay || locDisplay || '未知地点'
}

function mapLaunchToListItem(launch, index, offset, type) {
  const rocketName = getRocketDisplayNameFromLaunch(launch)
  const finalImage = getRocketImage(rocketName)
  const boosterInfo = extractBoosterInfoForList(launch, rocketName, finalImage)
  const status = launch.status || {}
  const statusCategory = getStatusCategory(status)
  const { launchAgency, launchAgencyId, launchAgencyAbbrev } = extractLaunchAgency(launch)
  const _isRecoverable = isRecoverable(boosterInfo)
  const idPrefix = type === 'completed' ? 'completed' : 'mission'
  const statusBadgeText = getStatusBadgeText(status, statusCategory)

  const item = {
    id: launch.id || `${idPrefix}-${offset + index}`,
    name: launch.name || '',
    missionName: (launch.mission && launch.mission.name) || '',
    rocketName,
    launchSite: buildLocalizedLaunchSite(launch),
    padLocation: formatPadLocation(launch.pad),
    launchTime: launch.net || launch.window_start,
    windowStart: launch.window_start,
    windowEnd: launch.window_end,
    rocketImage: finalImage,
    rocketConfiguration: pickRocketConfigurationSnapshot(launch),
    // 与角标同源（按 LL2 status.id），避免「成功 / 已成功 / 发射成功」混用
    status: statusBadgeText,
    statusId: status.id != null ? Number(status.id) : null,
    statusAbbrev: status.abbrev || '',
    statusCategory,
    statusBadgeText,
    probability: launch.probability,
    countryDisplay: getCountryDisplay(launch.pad, launch.launch_service_provider, launch),
    launchAgency,
    launchAgencyId,
    launchAgencyAbbrev,
    boosterInfo,
    isRecoverableThisMission: _isRecoverable,
    landingIcon: boosterInfo && (boosterInfo.landingType === 'ASDS' ? 'asds' : (boosterInfo.landingType === 'RTLS' || boosterInfo.landingLocation ? 'rtls' : null)) || null,
    recoveryIcons: extractRecoveryIcons(launch, type === 'completed' ? 'completed' : 'upcoming'),
    ...computeRecoveryTag(boosterInfo, _isRecoverable)
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

  return item
}

function getUpcomingMissions(limit = 10, offset = 0) {
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

module.exports = {
  getUpcomingMissions,
  getCompletedMissions,
  mapLaunchToListItem
}
