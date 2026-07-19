// utils/api-launch-detail.js — launch detail parsing (heavy)
const { getRocketImage } = require('../../../utils/util.js')
const { inferLandingStatus, resolveLandingIconSrc, isLandRecoveryType, isZhuque3Rocket, refineLandingTypeWithContext, buildLandingIcon, isNewGlennRocket, isNewShepardRocket, isLpv1Landing, getLandingLocationObj, formatLandingPlaceLabel } = require('../../../utils/landing-icons.js')
const {
  extractBoosterInfoForList,
  extractBoosterInfoSimple,
  inferRecoveryFallback,
  isRecoverable,
  extractLaunchAgency,
  resolveLauncher,
  resolveLandingType,
  REUSABLE_ROCKET_REGEX,
  SHIP_BOOSTER_REGEX
} = require('../../../utils/api-booster-extract.js')
const {
  request,
  getCacheKey,
  formatPadLocation,
  getCountryDisplay,
  unwrapCacheData,
  getStatusCategory,
  getStatusBadgeText,
  COUNTRY_DISPLAY,
  USE_DEV_API
} = require('../../../utils/api-request.js')
const { pickLocalized, zhField } = require('../../../utils/locale.js')
const { translateOrbit, translateLocation } = require('../../../utils/space-terms-i18n.js')

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
  push('最大飞行高度', cfg.apogee, '公里')
  if (cfg.min_stage != null && cfg.max_stage != null) {
    specs.push({
      label: '级数',
      line: `${cfg.min_stage}–${cfg.max_stage} 级`,
      _wxkey: 'stages'
    })
  }
  push('首飞日期', cfg.maiden_flight)
  const fastestTurnaround = formatIsoDurationToText(cfg.fastest_turnaround)
  if (fastestTurnaround) {
    specs.push({ label: '最快复飞纪录', line: fastestTurnaround, _wxkey: 'fastest_turnaround' })
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

/** LL2 net_precision.name → 中文标签 */
const NET_PRECISION_LABELS = {
  'Second': '精确到秒',
  'Minute': '精确到分',
  'Hour': '精确到小时',
  'Day': '精确到日',
  'Week': '周内',
  'Month': '月内',
  'Quarter': '季度内',
  'Half': '半年内',
  'Year': '年内',
  'Decade': '十年内',
  'Fiscal Year': '财年内'
}

function buildNetPrecisionLabel(netPrecision) {
  if (!netPrecision || typeof netPrecision !== 'object') return ''
  const name = (netPrecision.name != null ? String(netPrecision.name) : '').trim()
  if (!name) return ''
  return NET_PRECISION_LABELS[name] || name
}

/** ISO 8601 时长（如 P54DT14M36S）→ 「54 天」/「14 小时」中文文案 */
function formatIsoDurationToText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const m = raw.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m) return ''
  const days = m[1] ? parseInt(m[1], 10) : 0
  const hours = m[2] ? parseInt(m[2], 10) : 0
  const minutes = m[3] ? parseInt(m[3], 10) : 0
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes > 0) return `${minutes} 分钟`
  return ''
}

/** LL2 mission_patches → 详情页「任务徽章」数据 */
function buildMissionPatches(launch) {
  const raw = launch && launch.mission_patches
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw
    .filter(p => p && typeof p.image_url === 'string' && /^https?:\/\//i.test(p.image_url))
    .sort((a, b) => (a.priority != null ? a.priority : 0) - (b.priority != null ? b.priority : 0))
    .map((p, idx) => ({
      name: (p.name != null ? String(p.name) : '').trim(),
      imageUrl: p.image_url,
      agency: (p.agency && p.agency.name) || '',
      _wxkey: `patch-${p.id != null ? p.id : idx}`
    }))
}

/** update.created_on（UTC ISO）→ 北京时间「YYYY-MM-DD HH:mm」 */
function formatUpdateTimeCST(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const p = n => (n < 10 ? '0' : '') + n
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`
}

/** LL2 program[] → 详情页「所属计划」数据 */
function buildProgramInfo(launch) {
  const raw = launch && launch.program
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw
    .filter(p => p && (p.name || p.description))
    .map((p, idx) => {
      const img = p.image && (p.image.image_url || p.image.thumbnail_url)
      const yearOf = v => (v ? String(v).slice(0, 4) : '')
      return {
        name: (p.name != null ? String(p.name) : '').trim(),
        description: (p.description != null ? String(p.description) : '').trim(),
        typeName: (p.type && p.type.name) || '',
        startYear: yearOf(p.start_date),
        endYear: yearOf(p.end_date),
        agencies: Array.isArray(p.agencies) ? p.agencies.map(a => a && a.name).filter(Boolean).join('、') : '',
        imageUrl: (typeof img === 'string' && /^https?:\/\//i.test(img)) ? img : '',
        wikiUrl: (typeof p.wiki_url === 'string' && /^https?:\/\//i.test(p.wiki_url)) ? p.wiki_url : '',
        infoUrl: (typeof p.info_url === 'string' && /^https?:\/\//i.test(p.info_url)) ? p.info_url : '',
        _wxkey: `program-${p.id != null ? p.id : idx}`
      }
    })
}

/** LL2 各维度发射序号（含本次）→ 「发射序号」网格数据 */
function buildLaunchSequenceRows(launch) {
  if (!launch || typeof launch !== 'object') return []
  const rows = []
  const push = (label, total, year) => {
    const t = (total != null && Number.isFinite(Number(total))) ? Number(total) : null
    const y = (year != null && Number.isFinite(Number(year))) ? Number(year) : null
    if (t == null && y == null) return
    let line = t != null ? `第 ${t} 次` : ''
    if (y != null) line += (line ? ' · ' : '') + `年内第 ${y} 次`
    rows.push({ label, line, _wxkey: `seq-${label}` })
  }
  push('全球轨道发射', launch.orbital_launch_attempt_count, launch.orbital_launch_attempt_count_year)
  push('发射商', launch.agency_launch_attempt_count, launch.agency_launch_attempt_count_year)
  push('该发射场', launch.location_launch_attempt_count, launch.location_launch_attempt_count_year)
  push('该发射台', launch.pad_launch_attempt_count, launch.pad_launch_attempt_count_year)
  return rows
}

/** 汇总 launch/mission 级 info_urls、vid_urls 与 flightclub_url → 「相关链接」列表（去重，点击复制） */
function buildRelatedLinks(launch) {
  if (!launch || typeof launch !== 'object') return []
  const links = []
  const seen = {}
  const add = (url, title, tag) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    if (seen[url]) return
    seen[url] = true
    const t = (title != null ? String(title) : '').trim()
    links.push({
      url,
      title: t || url.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 50),
      tag: tag || '',
      _wxkey: `link-${links.length}`
    })
  }
  const collect = (arr, tag) => {
    if (!Array.isArray(arr)) return
    arr.forEach(item => { if (item) add(item.url, item.title || item.publisher, tag) })
  }
  collect(launch.info_urls || launch.infoURLs, '资讯')
  collect(launch.mission && launch.mission.info_urls, '资讯')
  collect(launch.vid_urls || launch.vidURLs, '视频')
  collect(launch.mission && launch.mission.vid_urls, '视频')
  add(launch.flightclub_url, 'FlightClub 飞行模拟', '模拟')
  return links.slice(0, 12)
}

/** LL2 infographic：可能是 url 字符串或 image 对象 */
function pickInfographicUrl(launch) {
  const raw = launch && launch.infographic
  if (typeof raw === 'string' && /^https?:\/\//i.test(raw)) return raw
  if (raw && typeof raw === 'object') {
    const u = raw.image_url || raw.thumbnail_url
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u
  }
  return ''
}

/** LL2 updates（官方动态流，按 created_on 倒序）→ 详情页「发射动态」数据 */
function buildLaunchUpdates(launch) {
  const raw = launch && launch.updates
  if (!Array.isArray(raw) || raw.length === 0) return []
  return mapRawUpdatesToLaunchUpdates(raw)
}

/**
 * 将 updates 原始行（LL2 嵌套 / 云拆分缓存 / fetchLaunchUpdates）统一成详情页结构。
 * 兼容 info_url / infoUrl、created_on / createdOn。
 */
function mapRawUpdatesToLaunchUpdates(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw
    .filter(u => u && typeof (u.comment || '') === 'string' && String(u.comment).trim())
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.created_on || a.createdOn || 0).getTime()
      const tb = new Date(b.created_on || b.createdOn || 0).getTime()
      return tb - ta
    })
    .slice(0, 15)
    .map((u, idx) => {
      const infoUrlRaw = u.info_url || u.infoUrl || ''
      const createdOn = u.created_on || u.createdOn || ''
      const createdBy = u.created_by != null ? u.created_by : (u.createdBy != null ? u.createdBy : '')
      return {
        comment: String(u.comment).trim(),
        infoUrl: (typeof infoUrlRaw === 'string' && /^https?:\/\//i.test(infoUrlRaw)) ? infoUrlRaw : '',
        createdBy: String(createdBy || '').trim(),
        createdOnText: formatUpdateTimeCST(createdOn),
        _wxkey: `update-${u.id != null ? u.id : idx}`
      }
    })
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

function getLauncherInstanceDetail(launcherId) {
  if (!launcherId) {
    return Promise.reject(new Error('助推器ID不能为空'))
  }
  
  
  // 优化：使用较短的超时时间，避免长时间等待
  return request(`/launchers/${launcherId}/`, {
    mode: 'detailed'
  }, 5000, false).then(data => {
    if (!data) {
      throw new Error('未找到助推器详情')
    }
    
    const launcher = data
    // 检查是launcher实例还是launcher配置
    // 如果是实例，会有serial_number和flights字段
    // 如果是配置，会有configuration字段
    if (launcher.serial_number || launcher.flights !== undefined) {
      // 这是launcher实例
      const serialNumber = launcher.serial_number || null
      const flights = launcher.flights !== undefined && launcher.flights !== null ? launcher.flights : null
      const successfulLandings = launcher.successful_landings !== undefined && launcher.successful_landings !== null ? launcher.successful_landings : null
      const attemptedLandings = launcher.attempted_landings !== undefined && launcher.attempted_landings !== null ? launcher.attempted_landings : null
      
      return {
        serialNumber: serialNumber,
        flights: flights,
        successfulLandings: successfulLandings,
        attemptedLandings: attemptedLandings,
        flightProven: launcher.flight_proven || false
      }
    } else {
      // 这是launcher配置，不是实例，返回null
      return null
    }
  }).catch(error => {
    throw error
  })
}

/**
 * 获取单个发射任务的详细信息
 * 统一从 /launches/upcoming/ 获取
 * @param {String|Number} launchId 发射任务ID
 * @param {String} type 任务类型（已废弃，统一使用upcoming端点）
 * @returns {Promise} 返回任务详细信息
 */
/**
 * 通过云函数 fetchLaunchDetail 拉取单条 launch 的完整详情
 * 云端命中缓存就秒回；否则云函数会去打 LL2 → slim → 入库 → 返回
 * 返回未经 processLaunchDetail 处理的原始 launch 对象，调用方负责后续加工
 */
function _fetchLaunchDetailViaCloud(launchId, forceRefresh = false) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('云函数能力不可用'))
      return
    }
    wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'fetchLaunchDetail', launchId: String(launchId), forceRefresh: !!forceRefresh },
      timeout: 25000,
      success: (res) => {
        const r = res && res.result
        if (r && r.success && r.data) {
          resolve(r.data)
        } else {
          reject(new Error((r && r.error) || '云函数返回为空'))
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '云函数调用失败'))
    })
  })
}

function getLaunchDetail(launchId, type = 'upcoming') {
  if (!launchId) {
    return Promise.reject(new Error('发射任务ID不能为空'))
  }

  // 多芯火箭/星舰常常因为 list 缓存被 slim 而拿不到完整 launcher_stage / spacecraft_stage
  // → 优先走云函数 fetchLaunchDetail 直接拉 LL2 单条详情（云端带 cache，不会重复打 LL2）
  return _fetchLaunchDetailViaCloud(launchId).then(async data => {
    if (!data) throw new Error('云函数未返回详情')
    return await processLaunchDetail(data)
  }).catch(async (cloudErr) => {
    // 云函数失败 → 回退到原有逻辑（云数据库 list 缓存）
    return request(`/launches/${launchId}/`, {
      mode: 'detailed',
      format: 'json'
    }, 10000, true).then(async data => {
      if (!data) throw new Error('未找到任务详情')
      return await processLaunchDetail(data)
    }).catch(async () => {
      // 最后兜底：扫 upcoming/previous 列表缓存
      const listUrl = type === 'completed' || type === 'previous' ? '/launches/previous/' : '/launches/upcoming/'
      return request(listUrl, {
        mode: 'detailed',
        format: 'json',
        limit: 100,
        ...(listUrl.includes('/upcoming/') ? { hide_recent_previous: true } : {})
      }, 10000, true).then(async data => {
        if (data && data.results && Array.isArray(data.results)) {
          const foundLaunch = data.results.find(launch => {
            const id = launch.id || (launch.url && launch.url.split('/').filter(Boolean).pop())
            return id === launchId || id === String(launchId) || String(id) === String(launchId)
          })
          if (foundLaunch) return await processLaunchDetail(foundLaunch)
        }
        throw new Error('未找到任务详情')
      })
    })
  })
}

/**
 * 从 mission.description 文本中尝试提取载荷数量
 * 支持：载荷数量：5、共 20 颗卫星、携带 3 个载荷、22 satellites、payload_count 等
 * @param {String} str mission.description
 * @returns {Number} 提取到的数量，失败返回 0
 */
function tryExtractPayloadCountFromDescription(str) {
  if (typeof str !== 'string' || !str.trim()) return 0
  const s = str.trim()
  // 1) 显式「载荷数量：N」「载荷：N」
  let m = s.match(/(?:载荷\s*[数量]*\s*[：:]\s*|payload\s*count\s*[：:]\s*)(\d+)/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  // 2) 共/携带/搭载/发射/一箭 + 数字 + 颗/个/枚 + 卫星/载荷/航天器
  m = s.match(/(?:共|携带|搭载|发射|一箭)(?:约)?\s*(\d+)\s*[颗个枚只]?\s*(?:颗|个|枚|只)?\s*(?:卫星|载荷|航天器|飞行器)/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  // 3) 数字 + 颗/个 + 卫星/载荷
  m = s.match(/(\d+)\s*[颗个枚只]?\s*(?:卫星|载荷|航天器|飞行器)/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  // 4) 卫星/载荷 + 数字
  m = s.match(/(?:卫星|载荷)\s*(\d+)\s*[颗个]?/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  // 5) 英文：N satellites、carrying N payload、N payloads
  m = s.match(/(\d+)\s+satellites?/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  m = s.match(/(?:carrying|with|deploying)\s+(\d+)\s+payloads?/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  m = s.match(/(\d+)\s+payloads?/i)
  if (m) return Math.max(0, parseInt(m[1], 10))
  // 6) 若 description 为 JSON 字符串，尝试 payload_count / payloadCount / num_payloads
  try {
    const j = JSON.parse(s)
    if (j != null && typeof j === 'object') {
      const n = (j.payload_count != null ? j.payload_count : (j.payloadCount != null ? j.payloadCount : j.num_payloads))
      if (n != null && !isNaN(Number(n))) return Math.max(0, parseInt(String(n), 10))
    }
  } catch (_) { /* 非 JSON，忽略 */ }
  return 0
}

/** 轨道 abbrev 字段在 LL2 里可能是字符串或小型嵌套对象 */
function normalizeOrbitAbbrevField(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'object') {
    const a = raw.abbrev != null ? String(raw.abbrev).trim() : ''
    const n = raw.name != null ? String(raw.name).trim() : ''
    return (a || n).trim()
  }
  return String(raw).trim()
}

function buildMissionOrbitDisplayString(orbit) {
  if (!orbit || typeof orbit !== 'object') return ''
  const abbrevStr = normalizeOrbitAbbrevField(orbit.abbrev)
  const nameEn = ((orbit.name != null ? String(orbit.name) : '').trim() ||
    (orbit.full_name != null ? String(orbit.full_name).trim() : ''))
  const name = pickLocalized(zhField(orbit, 'name') || translateOrbit(orbit), nameEn)
  let orbitStr = [name, abbrevStr ? `(${abbrevStr})` : ''].filter(Boolean).join(' ').trim()
  if (orbit.perigee != null || orbit.apogee != null) {
    orbitStr += (orbitStr ? ' ' : '') + String(orbit.perigee != null ? orbit.perigee : orbit.apogee) + 'km'
    orbitStr = orbitStr.trim()
  }
  return orbitStr
}

function collectLaunchOrbitObjects(launch) {
  const list = []
  const push = (o) => {
    if (!o || typeof o !== 'object') return
    if (!list.includes(o)) list.push(o)
  }
  const mission = launch.mission
  if (mission && mission.orbit) push(mission.orbit)
  const payloads = mission && mission.payloads
  if (Array.isArray(payloads)) {
    for (const p of payloads) {
      if (p && typeof p === 'object' && p.orbit) push(p.orbit)
    }
  }
  const pf = launch.payload_flights
  if (Array.isArray(pf)) {
    for (const row of pf) {
      const payload = row && row.payload
      if (payload && typeof payload === 'object' && payload.orbit) push(payload.orbit)
    }
  }
  return list
}

/** 多条路径解析轨道文案（mission.orbit 常为空但 payload 上会带 orbit） */
function resolveLaunchOrbitStrings(launch) {
  const orbits = collectLaunchOrbitObjects(launch)
  let display = ''
  let shortLabel = ''
  for (const orb of orbits) {
    display = buildMissionOrbitDisplayString(orb)
    shortLabel =
      ((orb.name || orb.full_name || '').toString().trim()) ||
      normalizeOrbitAbbrevField(orb.abbrev)
    if (display || shortLabel) break
  }
  if (!shortLabel && display) shortLabel = display
  return { display: display || '', shortLabel: shortLabel || '' }
}

// ── launcher/spacecraft 落点解析统一口径（boosterStages 与 stageInfo.firstStage 共用）──
// 历史上 launcher_stage 被解析 3 遍、落点类型推断各写一份，导致同一发射在
// 「助推器/回收」卡与「一二级箭体」卡显示不一致（尤其星舰 TOWER_CATCH / SPLASHDOWN /
// EXPENDED 在 stageInfo.firstStage 不被识别）。这里收敛为一份内部解析器。

/** launcher_stage 统一取数组（兼容大小写 / rocket.rocket / configuration 多路径） */
function resolveLauncherStageArray(launch) {
  const lsRaw = (launch && launch.rocket && launch.rocket.launcher_stage)
    || (launch && launch.rocket && launch.rocket.Launcher_stage)
    || (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.launcher_stage)
    || (launch && launch.rocket && launch.rocket.configuration && launch.rocket.configuration.launcher_stage)
  if (!lsRaw) return []
  return Array.isArray(lsRaw) ? lsRaw : [lsRaw]
}

/** spacecraft_stage 统一取数组 */
function resolveSpacecraftStageArray(launch) {
  const ssRaw = (launch && launch.rocket && launch.rocket.spacecraft_stage)
    || (launch && launch.rocket && launch.rocket.configuration && launch.rocket.configuration.spacecraft_stage)
  if (ssRaw == null) return []
  return Array.isArray(ssRaw) ? ssRaw : [ssRaw]
}

/** 着陆类型规范化（ASDS/RTLS/SPLASHDOWN/RECOVERY/TOWER_CATCH/EXPENDED/LOST 全集） */
function normalizeLandingType(raw) {
  if (!raw) return null
  const v = String(raw).toUpperCase().replace(/[\s_-]+/g, '')
  // LL2 config/landing_types 词表全集（ASDS/Ocean/HL/RTLS/EXP/ATM/VL/HC/PCL/PFL）全部覆盖，
  // 与 utils/landing-icons.js 的 normalizeLandingTypeShort 保持同一口径
  if (v === 'EXP' || v === 'EXPENDED' || v === 'EXPENDABLE' || v === 'DISPOSED') return 'EXPENDED'
  if (v === 'ATM' || v.includes('DESTRUCTIVE')) return 'EXPENDED' // 再入烧毁 → 与一次性使用同待遇
  if (v === 'ASDS' || v === 'ASOG' || v === 'OCISLY' || v === 'JRTI') return 'ASDS'
  if (v === 'RTLS') return 'RTLS'
  if (v === 'SD' || v.includes('SPLASHDOWN') || v === 'OCEAN' || v.includes('OCEANLAND')) return 'SPLASHDOWN'
  if (v === 'PR' || v === 'PCL' || v === 'PFL' || v.includes('PARACHUTE') || v.includes('PARAFOIL') || v.includes('RECOVERY')) return 'RECOVERY'
  // 网系回收（拦阻网驳船）—— LL2 词表暂无该类型，预留接口：将来出现 Net/Arrestor 类 abbrev/name 自动识别
  if (v === 'NC' || v === 'NET' || v.includes('NETCATCH') || v.includes('ARRESTOR')) return 'NET_CATCH'
  // 直升机捕获必须先于塔架捕获判断，否则 "Helicopter Catch" 会被 CATCH 关键词误判
  if (v === 'HC' || v.includes('HELICOPTER')) return 'HELICOPTER_CATCH'
  if (v === 'TC' || v.includes('TOWER') || v.includes('CATCH') || v.includes('CHOPSTICK') || v.includes('MECHAZILLA')) return 'TOWER_CATCH'
  if (v === 'VL' || v.includes('VERTICALLANDING')) return 'VL'
  if (v === 'HL' || v.includes('HORIZONTALLANDING')) return 'HL'
  if (v.includes('LOST') || v.includes('FAILED')) return 'LOST'
  // LL2 全名兜底
  if (v.includes('RETURNTOLAUNCHSITE')) return 'RTLS'
  if (v.includes('AUTONOMOUSSPACEPORT') || v.includes('DRONESHIP') || v.includes('DRONE SHIP')) return 'ASDS'
  return v // 其它保留原值，前端可直接显示
}

/**
 * 当 LL2 没给 landing.type 时，根据落点缩写/名称智能反推：
 *   LZ-1/LZ-4 等陆地着陆区 → RTLS；OCISLY/JRTI/ASOG → ASDS；
 *   Mechazilla/Tower/Chopsticks → TOWER_CATCH；Atlantic/Pacific/Ocean → SPLASHDOWN
 */
function inferLandingTypeFromLocation(abbrev, name) {
  const a = String(abbrev || '').toUpperCase().trim()
  const n = String(name || '').toUpperCase()
  const text = `${a} ${n}`
  if (/\bLZ[\s-]?\d+\b/.test(text)) return 'RTLS'
  // 星舰塔架捕获：LL2 常写成 RTLS + OLM-A，无独立 Tower Catch 类型
  if (/\bOLM[\s-]?[A-Z0-9]*\b|ORBITAL\s*LAUNCH\s*MOUNT/.test(text)) return 'TOWER_CATCH'
  if (/\bLC[\s-]?\d+/.test(text) && /(MECHAZILLA|TOWER|CHOPSTICK|CATCH)/.test(text)) return 'TOWER_CATCH'
  if (/\bLZ\b|LANDING\s*ZONE/.test(text)) return 'RTLS'
  if (/OCISLY|JRTI|ASOG|\bASDS\b|OF\s*COURSE\s*I\s*STILL\s*LOVE\s*YOU|JUST\s*READ\s*THE\s*INSTRUCTIONS|SHORTFALL\s*OF\s*GRAVITAS/.test(text)) return 'ASDS'
  // 蓝色起源新格伦海上回收驳船 LPV1 / Jacklyn
  if (/\bLPV[\s-]?1\b|JACKLYN|LANDING\s*PLATFORM\s*VESSEL/.test(text)) return 'ASDS'
  if (/MECHAZILLA|TOWER\s*CATCH|CHOPSTICK/.test(text)) return 'TOWER_CATCH'
  // 网系回收驳船：将来 LL2 给出含 net/arrestor 的落点名时自动识别
  if (/ARRESTOR|NET\s*CATCH|RECOVERY\s*NET/.test(text)) return 'NET_CATCH'
  // 水平跑道着陆：罗布泊空军实验基地（CSSHQ 空天飞机等）
  if (/\bLNA\b|LOP\s*NUR/.test(text)) return 'HL'
  if (/\bATL\b|\bPAC\b|ATLANTIC|PACIFIC|INDIAN\s*OCEAN|\bOCEAN\b|SPLASHDOWN|\bGOM\b|GULF\s*OF\s*MEXICO|\bIND\b/.test(text)) return 'SPLASHDOWN'
  return null
}

/**
 * landing 对象 → 规范化落点类型。三处（boosterStages / 飞船 / stageInfo.firstStage）共用，统一口径：
 *   优先 landing.type.abbrev / landing.type.name（LL2 标准字段），其次按落点名反推。
 */
function resolveStageLandingType(landing, locAbbrev, locName) {
  const typeObj = (landing && landing.type && typeof landing.type === 'object') ? landing.type : null
  const raw = normalizeLandingType(
    (typeObj && (typeObj.abbrev || typeObj.name)) ||
    (landing && typeof landing.type === 'string' ? landing.type : null)
  )
  const base = raw || inferLandingTypeFromLocation(locAbbrev, locName)
  // RTLS + OLM-A / "caught by ... tower" → TOWER_CATCH（与首页卡片同源）
  return refineLandingTypeWithContext(base, landing, locAbbrev, locName)
}

/**
 * 处理launch详情数据，提取所需信息
 * @param {Object} launch launch数据对象
 * @returns {Promise} 返回处理后的任务详情
 */
async function processLaunchDetail(launch) {
    
    if (!launch) {
      throw new Error('未找到任务详情')
    }
    
    // 提取任务详情信息
    
    // 获取发射机构名称（优先使用launch_service_provider，其次使用program中的agencies）
    const { launchAgency, launchAgencyId, launchAgencyAbbrev } = extractLaunchAgency(launch)
    
    // 获取火箭配置详细信息
    let rocketInfo = ''
    const rocketConfig = (launch.rocket && launch.rocket.configuration)
      || (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
    if (rocketConfig) {
      const rocketName = getRocketDisplayNameFromConfig(rocketConfig)
      // 长文本默认英文原文，中文由页面"翻译"按钮切换
      const rocketDescription = rocketConfig.description || ''
      if (rocketDescription && rocketDescription.trim()) {
        rocketInfo = `${rocketName}：${rocketDescription}`
      } else {
        const manufacturer = (rocketConfig.manufacturer && rocketConfig.manufacturer.name) || ''
        const family = rocketConfig.family || ''
        const variant = rocketConfig.variant || ''
        if (manufacturer || family || variant) {
          const parts = []
          if (manufacturer) parts.push(`制造商：${manufacturer}`)
          if (family) parts.push(`系列：${family}`)
          if (variant) parts.push(`型号：${variant}`)
          rocketInfo = `${rocketName}（${parts.join('，')}）`
        } else {
          rocketInfo = rocketName || ''
        }
      }
    }
    
    // 获取任务详情
    let missionDetails = ''
    const mission = launch.mission
    if (mission) {
      const descEn = mission.description || ''
      if (descEn) {
        missionDetails = descEn
      } else if (mission.type) {
        const missionType = typeof mission.type === 'string' ? mission.type : mission.type.name
        missionDetails = `任务类型：${missionType}。${mission.name || '本次任务'}将执行重要的航天任务。`
      } else if (mission.name) {
        missionDetails = `${mission.name}：本次发射将携带重要载荷进入预定轨道，执行科学实验和观测任务。`
      }
    }
    
    // 获取启动说明（使用mission.description或者mission.name）
    let description = ''
    if (mission) {
      const descEn = (mission.description && mission.description.trim()) ? mission.description : ''
      if (descEn) {
        description = descEn
      } else if (mission.name && mission.name.trim()) {
        description = mission.name
      } else if (launch.name && launch.name.trim()) {
        description = launch.name
      }
    } else if (launch.name && launch.name.trim()) {
      description = launch.name
    }
    
    // 获取发射场信息
    let launchSite = ''
    if (launch.pad && launch.pad.location) {
      const padEn = launch.pad.name || ''
      const locationEn = launch.pad.location.name || ''
      const padDisplay = pickLocalized(zhField(launch.pad, 'name') || translateLocation(padEn), padEn)
      const locationDisplay = pickLocalized(zhField(launch.pad.location, 'name') || translateLocation(locationEn), locationEn)
      if (padDisplay && locationDisplay) {
        launchSite = `${padDisplay}, ${locationDisplay}`
      } else if (locationDisplay) {
        launchSite = locationDisplay
      } else if (padDisplay) {
        launchSite = padDisplay
      }
    } else if (launch.pad && launch.pad.name) {
      launchSite = pickLocalized(zhField(launch.pad, 'name') || translateLocation(launch.pad.name), launch.pad.name)
    }
    
    // 获取助推器信息（可回收火箭）
    // Launch Library API中，助推器信息可能在多个位置：
    // 1. launch.rocket.launcher_stage (第一级助推器)
    // 2. launch.rocket.rocket.launcher_stage
    // 3. launch.rocket 可能直接包含 launcher 信息
    // 4. 如果launch详情中没有，需要通过/launchers/{id}/端点查询
    let boosterInfo = null
    
    // 尝试多种路径获取助推器信息
    let launcher = null
    let launcherId = null
    
    // 路径1: launch.rocket.launcher_stage (检查小写)
    // 路径1b: launch.rocket.Launcher_stage (检查首字母大写，API可能使用这种格式)
    let launcherStagesArray = null  // 保存原始数组以支持多芯火箭（Falcon Heavy / SLS / 长征五号 等）
    if ((launch.rocket && launch.rocket.launcher_stage) || (launch.rocket && launch.rocket.Launcher_stage)) {
      launcher = launch.rocket.launcher_stage || launch.rocket.Launcher_stage
      
      // 如果launcher是数组，先保存整个数组，再取第一个元素继续走原解析流程
      if (Array.isArray(launcher) && launcher.length > 0) {
        launcherStagesArray = launcher
        launcher = launcher[0]
      }
      
      // launcher可能是对象引用（URL字符串）或完整对象
      if (typeof launcher === 'string') {
        // 如果是URL字符串，提取ID
        launcherId = launcher.split('/').filter(Boolean).pop()
      } else if (launcher && typeof launcher === 'object') {
        // 如果是对象，尝试获取id或从url中提取
        // 先检查所有可能的ID字段
        // 注意：launcher对象可能有嵌套的launcher字段
        // 直接检查launcher.id，如果存在就使用（即使为0也应该使用）
        let possibleId = null
        let possibleUrl = null
        
        if (launcher.id !== undefined && launcher.id !== null) {
          launcherId = launcher.id
          possibleId = launcher.id
        } else {
          // 尝试其他可能的ID字段
          possibleId = launcher.launcher_id || launcher.launcher_instance_id || (launcher.launcher && launcher.launcher.id)
          possibleUrl = launcher.url || launcher.launcher_url || launcher.instance_url || (launcher.launcher && launcher.launcher.url)
          launcherId = possibleId || (possibleUrl ? possibleUrl.split('/').filter(Boolean).pop() : null) || launcherId
        }
      }
    }
    // 路径2: launch.rocket.rocket.launcher_stage (检查小写)
    // 路径2b: launch.rocket.rocket.Launcher_stage (检查首字母大写)
    else if ((launch.rocket && launch.rocket.rocket && launch.rocket.rocket.launcher_stage) || (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.Launcher_stage)) {
      launcher = launch.rocket.rocket.launcher_stage || launch.rocket.rocket.Launcher_stage
      
      if (Array.isArray(launcher) && launcher.length > 0) {
        launcherStagesArray = launcher
        launcher = launcher[0]
      }
      
      launcherId = launcher.id || launcherId
    }
    // 路径3: launch.rocket 本身可能就是 launcher
    else if ((launch.rocket && launch.rocket.serial_number) || (launch.rocket && launch.rocket.flights !== undefined)) {
      launcher = launch.rocket
      launcherId = launcher.id || launcherId
    }
    // 路径4: 检查是否有launcher的ID引用（可能是字符串ID）
    else if ((launch.rocket && launch.rocket.launcher_stage_id) || (launch.rocket && launch.rocket.Launcher_stage_id)) {
      launcherId = launch.rocket.launcher_stage_id || launch.rocket.Launcher_stage_id
    }
    else if ((launch.rocket && launch.rocket.rocket && launch.rocket.rocket.launcher_stage_id) || (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.Launcher_stage_id)) {
      launcherId = launch.rocket.rocket.launcher_stage_id || launch.rocket.rocket.Launcher_stage_id
    }
    
    // 如果找到launcher信息，提取数据
    if (launcher) {
      // 从Launcher_stage数组中提取详细信息
      // 序列号可能在多个位置，优先从launcher.launcher中获取
      let serialNumber = (launcher.launcher && launcher.launcher.serial_number) ||
                        launcher.serial_number ||
                        null
      
      // 如果还没有序列号，尝试从着陆描述中提取（例如："B1080"）
      if (!serialNumber && launcher.landing && launcher.landing.description) {
        const descMatch = launcher.landing.description.match(/B\d+/i) // 匹配 B1080, B1060 等格式
        if (descMatch) {
          serialNumber = descMatch[0]
        }
      }
      
      const textPool = [
        (launcher.landing && launcher.landing.description) || '',
        (mission && mission.description) || '',
        (mission && mission.name) || '',
        launch.name || ''
      ].join(' ')

      // 不再回退到内部 ID（如 886）作为序列号，只从真实序列字段或描述文本中提取 Bxxxx
      if (!serialNumber && textPool) {
        const textSerialMatch = textPool.match(/\bB\d{3,5}\b/i)
        if (textSerialMatch) serialNumber = textSerialMatch[0].toUpperCase()
      }
      
      // 飞行次数可能在 launcher.launcher_flight_number / launcher.flights，或描述中的 "11th flight"
      let flights = launcher.launcher_flight_number !== undefined && launcher.launcher_flight_number !== null 
                    ? launcher.launcher_flight_number 
                    : (launcher.flights !== undefined && launcher.flights !== null ? launcher.flights : null)
      if (flights === null && textPool) {
        const flightMatch = textPool.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+flight\b/i)
        if (flightMatch) {
          const parsedFlights = Number(flightMatch[1])
          if (!isNaN(parsedFlights)) flights = parsedFlights
        }
      }
      
      // 着陆信息
      const landing = launcher.landing || null
      const landingLocation = (landing && landing.landing_location) || null
      // 优先使用缩写（如ASOG），如果没有缩写则使用全名
      const landingLocationAbbrev = (landingLocation && landingLocation.abbrev) || null
      const landingLocationName = (landingLocation && landingLocation.name) || null
      const landingDescription = (landing && landing.description) || null
      
      // 如果API没有返回着陆地点，尝试从描述提取常见关键词（如 OCISLY / ASOG / JRTI）
      let resolvedLandingLocation = landingLocationAbbrev || landingLocationName || null
      if (!resolvedLandingLocation && landingDescription) {
        const descUpper = String(landingDescription).toUpperCase()
        if (descUpper.includes('OCISLY') || descUpper.includes('OF COURSE I STILL LOVE YOU')) resolvedLandingLocation = 'OCISLY'
        else if (descUpper.includes('ASOG') || descUpper.includes('A SHORTFALL OF GRAVITAS')) resolvedLandingLocation = 'ASOG'
        else if (descUpper.includes('JRTI') || descUpper.includes('JUST READ THE INSTRUCTIONS')) resolvedLandingLocation = 'JRTI'
        else {
          const lzMatch = landingDescription.match(/\bLZ-?\d+\b/i)
          if (lzMatch) resolvedLandingLocation = lzMatch[0].toUpperCase().replace('LZ', 'LZ-')
        }
      }

      // 与 boosterStages / 首页卡片同源：优先 landing.type，再按落点反推，OLM 纠正为塔架捕获
      let landingType = resolveStageLandingType(landing, landingLocationAbbrev, landingLocationName)
      
      // 成功着陆和尝试着陆次数
      const successfulLandings = (launcher.launcher && launcher.launcher.successful_landings !== undefined)
                                ? launcher.launcher.successful_landings
                                : (launcher.successful_landings !== undefined && launcher.successful_landings !== null ? launcher.successful_landings : null)
      const attemptedLandings = (launcher.launcher && launcher.launcher.attempted_landings !== undefined)
                               ? launcher.launcher.attempted_landings
                               : (launcher.attempted_landings !== undefined && launcher.attempted_landings !== null ? launcher.attempted_landings : null)
      
      // 如果launcher存在，尝试创建boosterInfo
      // 对于可回收火箭（Falcon 9等），即使没有序列号，只要有飞行次数或着陆信息就显示
      if (launcher) {
        // 检查是否有足够的信息创建boosterInfo
        const hasBoosterData = serialNumber || 
                              flights !== null || 
                              resolvedLandingLocation || 
                              landingDescription ||
                              launcher.reused === true
        
        if (hasBoosterData) {
          const landingTypeIcon = (landingType === 'TOWER_CATCH' || landingType === 'SPLASHDOWN' || landingType === 'RECOVERY')
            ? buildLandingIcon(landingType, 'neutral')
            : null
          boosterInfo = {
            serialNumber: serialNumber || null,
            flights: flights,
            successfulLandings: successfulLandings,
            attemptedLandings: attemptedLandings,
            flightProven: launcher.flight_proven || (launcher.launcher && launcher.launcher.flight_proven) || false,
            // 优先显示缩写（如ASOG），如果没有缩写则显示全名；若 API 未给则从描述提取
            landingLocation: resolvedLandingLocation,
            landingLocationAbbrev: landingLocationAbbrev || (resolvedLandingLocation && /^[A-Z0-9-]{2,10}$/.test(resolvedLandingLocation) ? resolvedLandingLocation : null),
            landingType: landingType,
            landingTypeIcon: landingTypeIcon || undefined,
            landingDescription: landingDescription,
            reused: launcher.reused || false
          }
        } else {
          // 如果launcher有url，尝试从URL中提取ID
          if (!launcherId && launcher.url) {
            launcherId = launcher.url.split('/').filter(Boolean).pop()
          }
        }
      }
    }
    
    // 如果launch详情中没有完整的launcher信息，但有launcher ID，尝试查询launchers端点
    // 优化：只在确实需要时才调用，避免不必要的API请求
    // 检查launch详情中是否已经有足够的launcher信息，如果没有才调用API
    const needsLauncherDetail = !boosterInfo && 
                                 launcherId && 
                                 typeof launcherId === 'string' && 
                                 launcherId.trim() !== '' &&
                                 (!launcher || !launcher.serial_number) // 如果launch详情中已经有序列号，就不需要额外请求
    
    if (needsLauncherDetail) {
      try {
        // 使用较短的超时时间，避免长时间等待
        const launcherDetail = await getLauncherInstanceDetail(launcherId)
        if (launcherDetail && (launcherDetail.serialNumber || launcherDetail.flights !== null)) {
          boosterInfo = launcherDetail
        }
      } catch (error) {
        // 静默失败，不影响主流程
        // 如果查询失败，尝试使用launch详情中的基本信息
        if (launcher) {
          boosterInfo = {
            serialNumber: launcher.serial_number || null,
            flights: launcher.flights || null,
            successfulLandings: launcher.successful_landings || null,
            attemptedLandings: launcher.attempted_landings || null,
            flightProven: launcher.flight_proven || false
          }
        }
      }
    }
    
    // 优化：移除 /launchers/ 列表查询，因为：
    // 1. launch详情应该已经包含launcher信息
    // 2. 如果没有launcherId，列表查询无法精确匹配
    // 3. 这个查询容易超时且通常不必要
    // 如果launch详情中没有launcher信息，说明API不支持，不需要额外查询
    
    // 可回收火箭推断兜底（复用共享逻辑）
    const rocketName = getRocketDisplayNameFromLaunch(launch)
    const finalImage = getRocketImage(rocketName)
    boosterInfo = inferRecoveryFallback(launch, rocketName, finalImage, boosterInfo)

    // 多芯火箭支持（Falcon Heavy 中央芯+2 助推 / SLS / 长征五号 等）
    // LL2 API 对这类任务会在 launcher_stage 里返回多个元素，每个对应一根芯。
    // 上面的解析只取了第一个（boosterInfo），这里把整组解析出来给前端做 wx:for。
    //
    // 同时：星舰（Starship/Super Heavy）任务会在 spacecraft_stage 里额外返回飞船信息，
    // 这里也一起聚合，让"助推器/回收"区块同时显示 Super Heavy + Starship。
    let boosterStages = null
    const stageRoleMap = {
      core: '中央芯',
      side: '侧助推器',
      booster: '助推器',
      first_stage: '一级',
      strap_on: '助推器'
    }
    // normalizeLandingType / inferLandingTypeFromLocation 已上移到模块作用域，
    // 供 boosterStages、飞船、stageInfo.firstStage 三处共用同一落点类型口径。

    /**
     * 把 landingType 转成"前端直接渲染"的标签 + 图标路径，避免 WXML 写大段三元
     */
    function buildLandingDisplay(landingType, location, reused, landingStatus, ld, opts) {
      const type = landingType || null
      const loc = location ? String(location).trim() : ''
      const status = landingStatus || 'neutral' // 'success' | 'failure' | 'neutral'
      opts = opts || {}

      let typeLabel = ''
      switch (type) {
        case 'RTLS':       typeLabel = '陆地回收';   break
        case 'ASDS':       typeLabel = '海上回收';   break
        case 'SPLASHDOWN': typeLabel = '海面溅落';   break
        case 'RECOVERY':   typeLabel = '海面回收';   break
        case 'EXPENDED':   typeLabel = '一次性使用'; break
        case 'TOWER_CATCH':typeLabel = '塔架捕获';   break
        case 'NET_CATCH':  typeLabel = '网系回收';   break
        case 'HELICOPTER_CATCH': typeLabel = '直升机捕获'; break
        case 'VL':         typeLabel = '垂直着陆';   break
        case 'HL':         typeLabel = '水平着陆';   break
        case 'SPACECRAFT_LANDING': typeLabel = '伞降着陆'; break
        case 'LOST':       typeLabel = '未能回收';   break
        case 'DRAGON':     typeLabel = '海面溅落';   break  // 龙飞船伞降溅落
        default:           typeLabel = ''           // 未识别：留空，让前端只显示落点名
      }

      // 图标：朱雀三号陆地 → landspace；新格伦 LPV1 → BO_LZ；New Shepard 乘员舱 → spacecraft_landing
      const useLandspace = isLandRecoveryType(type) && isZhuque3Rocket(launch)
      const useBoLz = isNewGlennRocket(launch) && isLpv1Landing(ld, loc, null)
      const icon = resolveLandingIconSrc(type, status, launch, {
        ld,
        locAbbrev: loc,
        locName: '',
        forSpacecraft: !!opts.forSpacecraft
      })
      // --mono 仅用于中性白图标（浅色主题下 invert 反成深色）。
      // 成功绿/失败橙的 dataURI 自带状态色，加 --mono 会被 invert(0.72) 偏成紫色/蓝色
      const monoClass = status === 'neutral' ? ' recovery-icon--mono' : ''
      const landingIconClass = useLandspace
        ? ('recovery-icon--landspace' + monoClass)
        : (useBoLz ? ('recovery-icon--bolz' + monoClass) : (icon ? monoClass.trim() : ''))

      // 落点展示优先用 (abbrev) 中文名；无 abbrev 时退回原 location 字符串
      const llocObj = getLandingLocationObj(ld)
      const placeLabel = formatLandingPlaceLabel(
        (llocObj && llocObj.abbrev) || (/^[A-Z0-9-]{2,10}$/.test(loc) ? loc : null),
        (llocObj && llocObj.name) || (!/^[A-Z0-9-]{2,10}$/.test(loc) ? loc : null)
      ) || loc || null

      // 优先级：实际回收类型（销毁/陆地/海上/塔架捕获…）> "未复用/首次"
      // 因为 EXPENDED/LOST 已经精确说明了本次任务的处置方式，比"未复用/首次"更有信息量
      const isFirstFlight = (reused === false)
      let primary
      if (typeLabel) {
        primary = typeLabel
      } else if (isFirstFlight) {
        primary = '未复用/首次'
      } else {
        primary = ''
      }
      return {
        landingType: type,
        landingStatus: status,
        landingIcon: icon,
        landingIconClass,
        landingLocation: placeLabel,
        landingTypeLabel: primary || null,
        landingDisplayText: [primary, placeLabel].filter(Boolean).join(' ') || '—'
      }
    }

    // 兜底：如果前面 boosterInfo 的解析路径没拿到 launcher_stage 数组，
    // 这里独立从所有可能路径再取一次（与 stageInfo 解析使用相同路径），
    // 避免星舰任务等"路径1/2 未命中"场景丢掉助推器数组。
    if (!launcherStagesArray) {
      const arr = resolveLauncherStageArray(launch)
      if (arr.length > 0) launcherStagesArray = arr
    }

    if (launcherStagesArray && launcherStagesArray.length > 0) {
      boosterStages = launcherStagesArray.map((item, idx) => {
        if (!item || typeof item !== 'object') return null
        const innerLauncher = item.launcher || {}
        // 序列号
        let sn = innerLauncher.serial_number || item.serial_number || null
        if (!sn && item.landing && item.landing.description) {
          const m = item.landing.description.match(/B\d{3,5}/i)
          if (m) sn = m[0].toUpperCase()
        }
        // 星舰任务 Super Heavy 兜底用 launcher.name（如 "Booster 19"）
        if (!sn && innerLauncher.name) sn = innerLauncher.name
        // 飞行次数
        const fl = (item.launcher_flight_number !== undefined && item.launcher_flight_number !== null)
          ? item.launcher_flight_number
          : ((item.flights !== undefined && item.flights !== null) ? item.flights
            : ((innerLauncher.flights !== undefined && innerLauncher.flights !== null) ? innerLauncher.flights : null))
        // 着陆信息
        const ld = item.landing || (innerLauncher && innerLauncher.landing) || null
        const lloc = getLandingLocationObj(ld)
        const labbrev = (lloc && lloc.abbrev) || null
        const lname = (lloc && lloc.name) || null
        // landingType 统一口径：resolveStageLandingType 优先读 ld.type.abbrev/name（LL2 标准字段），
        // 再按落点名反推（stageInfo.firstStage 与此完全同源）
        const ltype = resolveStageLandingType(ld, labbrev, lname)
        const ldesc = (ld && ld.description) || null
        // 角色识别 —— 星舰任务的 launcher_stage[0].type 是 "Core"，会被 stageRoleMap
        // 错误识别为"中央芯"（中央芯是 Falcon Heavy 那种三芯火箭专属）。
        // 因此先按"火箭型号 + 数组长度"判断，再回落到通用 stageRoleMap。
        const roleRaw = String(item.type || item.position || item.role || '').toLowerCase()
        let roleLabel = ''
        const isStarshipRocket = /starship|超重|super\s*heavy/i.test(rocketName || '')
        const isFalconHeavyRocket = /falcon\s*heavy|猎鹰重型/i.test(rocketName || '')
        if (isStarshipRocket) {
          // 星舰只有两级：一级 = Super Heavy；飞船在 spacecraft_stage 里独立处理
          roleLabel = '超重助推器'
        } else if (isFalconHeavyRocket && launcherStagesArray.length >= 2) {
          // Falcon Heavy 有 1 中央芯 + 2 侧助推
          roleLabel = idx === 0 ? '中央芯' : `侧助推器 ${idx}`
        } else if (launcherStagesArray.length === 1) {
          // 单芯火箭（Falcon 9 / Electron / 长征 2/3/7 等）：无论 LL2 给什么 type，
          // 都只有一枚芯级 → 统一称"一级助推器"，避免把 LL2 的 "core" 解读为"中央芯"
          // （中央芯专指 Falcon Heavy 这种三芯火箭里"中间那一枚"的角色名）
          roleLabel = '一级助推器'
        } else if (stageRoleMap[roleRaw]) {
          // 其它多芯火箭（SLS / 长征五号 等）按 LL2 提供的 type 字段识别
          roleLabel = stageRoleMap[roleRaw]
          if (roleLabel === '侧助推器' && launcherStagesArray.length > 1) {
            roleLabel = `侧助推器 ${idx}`
          }
        } else if (launcherStagesArray.length > 1) {
          roleLabel = idx === 0 ? '主芯' : `助推器 ${idx}`
        } else {
          roleLabel = '一级助推器'
        }
        const reusedFlag = item.reused || innerLauncher.reused || false
        const lstatus = inferLandingStatus(ld, ltype)
        const display = buildLandingDisplay(ltype, labbrev || lname, reusedFlag, lstatus, ld)
        // 星舰任务的 Super Heavy 助推器（如 Booster 19）不是 Falcon B10xx 那种回收族谱对象，
        // 而是一枚独立组合体硬件——它的详情展示在 progress 页"星舰组合体进展"卡片里，
        // 不走 booster-detail。给它打上 stageKind，由 mission-detail.openShipDetail 分发
        const isSuperHeavy = isStarshipRocket
        return {
          // stageKind 用于序列号 chip 跳转分发：
          //   'ship'                → 跳 progress 页并自动打开 Ship 卡片弹窗
          //   'super_heavy_booster' → 跳 progress 页并自动打开 Booster 卡片弹窗
          //   undefined             → 跳 booster-detail（Falcon 助推器 B10xx 族谱）
          stageKind: isSuperHeavy ? 'super_heavy_booster' : undefined,
          role: roleLabel,
          serialNumber: sn || null,
          flights: fl,
          successfulLandings: (innerLauncher.successful_landings != null)
            ? innerLauncher.successful_landings
            : (item.successful_landings != null ? item.successful_landings : null),
          attemptedLandings: (innerLauncher.attempted_landings != null)
            ? innerLauncher.attempted_landings
            : (item.attempted_landings != null ? item.attempted_landings : null),
          flightProven: item.flight_proven || innerLauncher.flight_proven || false,
          landingLocation: display.landingLocation,
          landingLocationAbbrev: labbrev || (lname && /^[A-Z0-9-]{2,10}$/.test(lname) ? lname : null),
          landingType: display.landingType,
          landingTypeLabel: display.landingTypeLabel,
          landingIcon: display.landingIcon,
          landingIconClass: display.landingIconClass || '',
          landingStatus: display.landingStatus,
          landingDisplayText: display.landingDisplayText,
          landingDescription: ldesc || null,
          reused: reusedFlag
        }
      }).filter(Boolean)

      // 第一个元素与已解析的主 boosterInfo 同步（保证兜底字段不丢）
      // 注意：landingType / landingIcon 等以 boosterStages 解析为准（含 OLM→塔架捕获），
      // 避免旧 boosterInfo 的粗判覆盖正确结果。
      if (boosterInfo && boosterStages.length > 0) {
        const stage0 = boosterStages[0]
        boosterStages[0] = {
          ...boosterInfo,
          ...stage0,
          role: stage0.role,
          serialNumber: stage0.serialNumber || boosterInfo.serialNumber,
          flights: stage0.flights != null ? stage0.flights : boosterInfo.flights,
          landingType: stage0.landingType || boosterInfo.landingType,
          landingIcon: stage0.landingIcon || boosterInfo.landingIcon,
          landingTypeLabel: stage0.landingTypeLabel || boosterInfo.landingTypeLabel,
          landingStatus: stage0.landingStatus || boosterInfo.landingStatus,
          landingDisplayText: stage0.landingDisplayText || boosterInfo.landingDisplayText,
          landingTypeIcon: stage0.landingTypeIcon || boosterInfo.landingTypeIcon
        }
      }
    }

    // 飞船 / 载荷返回：凡 LL2 给出 spacecraft_stage（含着陆计划）都并入分卡
    // —— 不限星舰；长征 2F 空天飞机（CSSHQ）、Dragon 等一次性火箭 + 可返回载荷也要显示
    {
      const ssArr = resolveSpacecraftStageArray(launch)
      const shipStages = ssArr.map(it => {
        if (!it || typeof it !== 'object') return null
        const sc = (it && it.spacecraft) || it
        const scCfg = (sc && typeof sc.configuration === 'object')
          ? sc.configuration
          : (sc && typeof sc.spacecraft_config === 'object' ? sc.spacecraft_config : null)
        let sn = sc.serial_number || null
        if (!sn && typeof sc.name === 'string' && /^(ship|s)\s*\d+/i.test(sc.name)) sn = sc.name
        if (!sn && sc.name) sn = sc.name
        if (!sn && scCfg && scCfg.name) sn = scCfg.name
        const fl = (sc.flights_count != null) ? sc.flights_count
          : (sc.flights != null ? sc.flights : null)
        const ld = it.landing || sc.landing || null
        // 无着陆计划的飞船（纯部署载荷）不进回收/返回板块
        if (!ld || (!ld.type && !getLandingLocationObj(ld) && !ld.description)) return null
        const lloc = getLandingLocationObj(ld)
        const labbrev = (lloc && lloc.abbrev) || null
        const lname = (lloc && lloc.name) || null
        let ltypeShip = resolveStageLandingType(ld, labbrev, lname)
        const shipFamilyName = String(
          (scCfg && (scCfg.full_name || scCfg.name)) || sc.name || ''
        ).toLowerCase()
        const scTypeName = String(
          (scCfg && scCfg.type && (scCfg.type.name || scCfg.type)) || ''
        ).toLowerCase()
        const isDragonFamily = /dragon/.test(shipFamilyName)
        const isSpaceplane = /spaceplane/.test(scTypeName)
          || /reusable\s*space\s*vehicle|可重复使用试验航天器|csshq/i.test(shipFamilyName)
        const isNewShepardCapsule = isNewShepardRocket(launch)
        if (isDragonFamily) {
          ltypeShip = 'DRAGON'
        } else if (isSpaceplane) {
          // 空天飞机：图标统一 HL，仅落点名称随任务变化
          ltypeShip = 'HL'
        } else if (isNewShepardCapsule) {
          // New Shepard 乘员舱 / 二级返回：统一 spacecraft_landing 图标
          ltypeShip = 'SPACECRAFT_LANDING'
        } else {
          ltypeShip = refineLandingTypeWithContext(ltypeShip, ld, labbrev, lname)
        }
        if (!ltypeShip) return null

        let shipRoleLabel = '飞船'
        if (isDragonFamily) {
          shipRoleLabel = (scCfg && scCfg.full_name) || (scCfg && scCfg.name) || '龙飞船'
        } else if (isSpaceplane) {
          shipRoleLabel = (scCfg && scCfg.full_name) || (scCfg && scCfg.name) || sc.name || '可复用试验航天器'
        } else if (isNewShepardCapsule) {
          shipRoleLabel = (scCfg && scCfg.full_name) || (scCfg && scCfg.name) || sc.name || '乘员舱'
        } else if (/starship|super\s*heavy|星舰|超重/i.test(String(rocketName || ''))) {
          shipRoleLabel = '星舰飞船'
        } else {
          shipRoleLabel = (scCfg && scCfg.full_name) || (scCfg && scCfg.name) || sc.name || '飞船'
        }

        const reusedShip = sc.reused || false
        const lstatusShip = inferLandingStatus(ld, ltypeShip)
        const displayShip = buildLandingDisplay(ltypeShip, labbrev || lname, reusedShip, lstatusShip, ld, {
          forSpacecraft: true
        })
        const inSpace = sc.in_space === true
        const missionEnded = !!(it.mission_end || sc.mission_end)
        let returnStatusLabel = ''
        if (ld.success === true) returnStatusLabel = '已返回着陆'
        else if (ld.success === false) returnStatusLabel = '返回失败'
        else if (inSpace || (!missionEnded && ld.attempt === false)) returnStatusLabel = '在轨 · 待返回'
        else if (ld.attempt === true) returnStatusLabel = '返回进行中'

        return {
          stageKind: 'ship',
          isPayloadReturn: true,
          role: shipRoleLabel,
          serialNumber: sn || null,
          flights: fl,
          successfulLandings: null,
          attemptedLandings: null,
          flightProven: false,
          landingLocation: displayShip.landingLocation,
          landingLocationAbbrev: labbrev || null,
          landingType: displayShip.landingType,
          landingTypeLabel: displayShip.landingTypeLabel,
          landingIcon: displayShip.landingIcon,
          landingIconClass: displayShip.landingIconClass || '',
          landingStatus: displayShip.landingStatus,
          landingDisplayText: displayShip.landingDisplayText,
          landingDescription: (ld && ld.description) || null,
          returnStatusLabel: returnStatusLabel || null,
          destination: it.destination || null,
          reused: reusedShip
        }
      }).filter(Boolean)
      if (shipStages.length > 0) {
        boosterStages = (boosterStages || []).concat(shipStages)
      }
    }

    // 板块标题：仅有载荷/飞船返回计划、无助推器回收 →「返回 / 着陆计划」
    const stagesForTitle = Array.isArray(boosterStages) ? boosterStages : []
    const hasPayloadReturn = stagesForTitle.some((s) => s && s.isPayloadReturn)
    const hasBoosterRecovery = stagesForTitle.some((s) => s && !s.isPayloadReturn && (s.landingType || s.landingLocation))
    const launcherBlockTitle = (hasPayloadReturn && !hasBoosterRecovery)
      ? '返回 / 着陆计划'
      : '箭体与回收'
    const lsp = launch.launch_service_provider
    const launchServiceProvider = {
      id: (lsp && lsp.id != null) ? lsp.id : launchAgencyId,
      name: (lsp && lsp.name) || launchAgency || '',
      abbrev: (lsp && lsp.abbrev) || launchAgencyAbbrev || '',
      country: (lsp && lsp.country && lsp.country.name) || (lsp && lsp.country_code ? (COUNTRY_DISPLAY[(lsp.country_code || '').toUpperCase()] || lsp.country_code) : ''),
      website: (lsp && lsp.info_url) || (lsp && lsp.wiki_url) || null
    }
    
    // 任务完整信息（mission）；轨道优先 mission.orbit，并回落到各 payload 上的 orbit（与 LL2 实际返回一致）
    const orbitResolved = resolveLaunchOrbitStrings(launch)
    const orbitStr = orbitResolved.display || orbitResolved.shortLabel
    // missionFull.description 默认英文原文；云端预翻译的 descriptionZh 单独携带，
    // 页面"翻译"按钮命中时本地秒切，无需再调云端翻译
    const missionFull = {
      name: (mission && mission.name) || '',
      description: (mission && mission.description) || '',
      descriptionZh: mission ? zhField(mission, 'description') : '',
      type: (mission && mission.type && (typeof mission.type === 'string' ? mission.type : (mission.type && mission.type.name))) || '',
      orbit: orbitStr
    }
    
    // 火箭配置完整信息（rocket.configuration）
    const rocketFull = {
      configuration: getRocketDisplayNameFromConfig(rocketConfig),
      description: (rocketConfig && rocketConfig.description) || '',
      descriptionZh: rocketConfig ? zhField(rocketConfig, 'description') : '',
      manufacturer: (rocketConfig && rocketConfig.manufacturer && rocketConfig.manufacturer.name) || ''
    }

    const { rocketSpecsVisible, rocketSpecs } = buildRocketSpecsForDetail(rocketConfig)
    
    // 发射场地完整信息（pad + location）
    const pad = launch.pad
    const loc = (pad && pad.location)
    const padName = (pad && pad.name) || ''
    const locName = (loc && loc.name) || ''
    const padCountry = (loc && loc.country_code) ? (COUNTRY_DISPLAY[(loc.country_code || '').toUpperCase()] || loc.country_code) : (loc && loc.country && loc.country.name) || ''
    const padCoords = (pad && pad.latitude != null && pad.longitude != null) ? { lat: pad.latitude, lng: pad.longitude } : (loc && loc.latitude != null && loc.longitude != null ? { lat: loc.latitude, lng: loc.longitude } : null)
    const totalLaunchCount = (pad && pad.total_launch_count != null ? pad.total_launch_count : (loc && loc.total_launch_count != null ? loc.total_launch_count : null))
    const nameLower = (padName + ' ' + locName).toLowerCase()
    const padType = /ship|marine|sea|海上|mobile|maritime|drone|asds|floating|海上/.test(nameLower) ? '海上' : '陆上'
    const padDetail = {
      padName,
      locationName: locName,
      country: padCountry,
      state: null,
      city: null,
      latitude: padCoords && padCoords.lat,
      longitude: padCoords && padCoords.lng,
      padType,
      totalLaunchCount,
      // LL2 pad_turnaround：该发射台距上次发射的周转时长
      turnaroundText: formatIsoDurationToText(launch.pad_turnaround),
      // 发射台/发射场简介与外链（wiki / 地图）
      padDescription: (pad && typeof pad.description === 'string') ? pad.description.trim() : '',
      locationDescription: (loc && typeof loc.description === 'string') ? loc.description.trim() : '',
      wikiUrl: (pad && typeof pad.wiki_url === 'string' && /^https?:\/\//i.test(pad.wiki_url)) ? pad.wiki_url : '',
      mapUrl: (pad && typeof pad.map_url === 'string' && /^https?:\/\//i.test(pad.map_url)) ? pad.map_url : '',
      timezoneName: (loc && typeof loc.timezone_name === 'string') ? loc.timezone_name : ''
    }
    
    // 飞行 & 着陆全量统计（从 launcher/landing 能取则取，多数 API 无细粒度时序）
    const flightStats = {
      boosterIgnition: null,
      firstStageSep: null,
      secondStageOrbit: null,
      fairingSep: null,
      payloadOrbit: null
    }
    const landingStats = {
      sepAltitude: null,
      sepVelocity: null,
      reentryTime: null,
      landingBurnTime: null,
      landingTime: null,
      deviationDistance: null
    }
    const fl = (launcher && launcher.launcher_flight_number != null ? launcher.launcher_flight_number : (launcher && launcher.flights != null ? launcher.flights : undefined))
    const general = {
      totalFlightDuration: null,
      orbitAccuracy: orbitResolved.shortLabel || null,
      payloadWeight: null,
      flights: fl != null ? fl : null
    }
    const launcherLanding = { flightStats, landingStats, general }
    const missionDescLong = ((missionFull.description || '').length > 100)
    const rocketDescLong = ((rocketFull.description || '').length > 100)
    
    const status = launch.status || {}
    const statusCategory = getStatusCategory(status)
    const statusBadgeText = getStatusBadgeText(status, statusCategory)
    
    // 根据 launch 的 payload_flights、mission.payloads 或 /payload_flights/ 取 payload id 与 amount，再请求 /payloads/{id}/
    // 优化：优先使用launch详情中已有的payload信息，避免不必要的API调用
    let payloadDetails = []
    let payloadAmount = 0
    const amt = (r) => (r != null && r.amount != null && !isNaN(Number(r.amount)) ? Number(r.amount) : 1)
    const collectId = (p) => {
      if (p == null) return null
      if (typeof p === 'number' || (typeof p === 'string' && /^\d+$/.test(p))) return p
      if (typeof p === 'object' && p.id != null) return p.id
      if (typeof p === 'string' && p.indexOf('/') >= 0) return p.split('/').filter(Boolean).pop()
      return null
    }
    const ids = []
    const addId = (id) => { if (id != null && id !== '' && !ids.includes(id)) ids.push(id) }
    
    // 优先从launch.payload_flights获取payload信息
    if (Array.isArray(launch.payload_flights) && launch.payload_flights.length > 0) {
      for (const r of launch.payload_flights) {
        addId(collectId(r.payload))
        payloadAmount += amt(r)
      }
    }
    // 如果payload_flights为空，尝试从mission.payloads获取
    if (ids.length === 0 && launch.mission && launch.mission.payloads && Array.isArray(launch.mission.payloads) && launch.mission.payloads.length > 0) {
      for (const p of launch.mission.payloads) { addId(collectId(p)) }
      payloadAmount += launch.mission.payloads.length
    }
    // 优化：只在确实没有payload信息时才调用回退查询
    // 如果launch详情中没有payload_flights和mission.payloads，说明API可能不支持，回退查询也可能失败
    // 为了减少不必要的API调用，只在开发环境且确实需要时才调用
    if (ids.length === 0 && USE_DEV_API) {
      try {
        // 使用较短的超时时间，避免长时间等待
        const pfRes = await request('/payload_flights/', { launch: launch.id, limit: 50, mode: 'list' }, 5000, true)
        const raw = (pfRes && pfRes.results) || []
        const lid = String(launch.id)
        for (const r of raw) {
          const l = r.launch
          const lidR = l != null ? (l.id != null ? l.id : (typeof l === 'string' ? l.split('/').filter(Boolean).pop() : null)) : null
          if (lidR != null && String(lidR) === lid) {
            addId(collectId(r.payload))
            payloadAmount += amt(r)
          }
        }
      } catch (e) { 
        // 静默失败，不影响主流程
      }
    }
    // 优化：只在有payload ID且确实需要详细信息时才请求
    // 如果launch详情中已经包含了足够的payload信息，就不需要额外请求
    if (ids.length > 0) {
      // 优化：限制最多请求5个payload详情，避免请求过多
      // 大多数情况下，payload详情不是必需的，可以显示基本信息即可
      const maxPayloadRequests = 5
      const payloadIdsToRequest = ids.slice(0, maxPayloadRequests)
      for (const id of payloadIdsToRequest) {
        try {
          // 使用较短的超时时间，避免长时间等待
          const d = await getPayloadDetail(id)
          payloadDetails.push({ ...d, _wxkey: `p-${id}-${payloadDetails.length}` })
        } catch (e) {
          // 静默失败，不影响其它payload
        }
      }
    }
    // 若 mission 未展开轨道，但载荷详情接口带了 orbit，则用其补全「任务轨道」展示
    if (!missionFull.orbit && payloadDetails.length > 0) {
      for (const pd of payloadDetails) {
        const od = pd.orbitDisplay != null ? String(pd.orbitDisplay).trim() : ''
        if (od) {
          missionFull.orbit = od
          break
        }
      }
    }
    // 若 payload_flights / mission.payloads / payload_flights API 都未得到数量，尝试从 mission.description 文本中解析
    if (payloadAmount <= 0 && mission && mission.description) {
      const fromDesc = tryExtractPayloadCountFromDescription(mission.description)
      if (fromDesc > 0) payloadAmount = fromDesc
    }

    // 一二级箭体：从 launcher_stage、spacecraft_stage 提取型号与序列号，回收信息预留
    let firstStage = null
    let secondStage = null
    const _starshipCheck = [(rocketConfig && rocketConfig.full_name), (rocketConfig && rocketConfig.name), launch.name, (mission && mission.name), (mission && mission.description)].filter(Boolean).join(' ')
    const isStarship = /starship/i.test(_starshipCheck)

    // 一级/助推器：launcher_stage（与 boosterStages 共用同一份解析器，落点类型口径完全一致）
    const launcherArr = resolveLauncherStageArray(launch)
    for (const it of launcherArr) {
      if (!it || typeof it !== 'object') continue
      const l = it.launcher || it
      const cfg = (l && typeof l.configuration === 'object') ? l.configuration : null
      const sn = (l && l.serial_number != null ? l.serial_number : it.serial_number)
      const land = it.landing || (l && l.landing) || null
      const loc = (land && land.landing_location) || null
      const locAbbrev = (loc && loc.abbrev) || null
      const locName = (loc && loc.name) || null
      // 与「助推器/回收」卡同源：优先 landing.type.abbrev/name，再按落点名反推，识别全集
      // （ASDS/RTLS/SPLASHDOWN/TOWER_CATCH/EXPENDED 等），消除两卡显示不一致
      const lt = resolveStageLandingType(land, locAbbrev, locName)
      firstStage = {
        name: ((cfg && cfg.full_name) || (cfg && cfg.name)) || (isStarship ? 'Super Heavy' : null) || '一级助推器',
        serialNumber: sn || null,
        reusable: !!(land || (l && l.reused === true)) || isStarship,
        recoveryStatus: null,
        landingType: lt || null,
        landingLocation: locAbbrev || locName || null
      }
      break
    }

    // 二级/上面级：spacecraft_stage（数组或单对象 { spacecraft: { name, serial_number } }）
    const scArr = resolveSpacecraftStageArray(launch)
    for (const it of scArr) {
      const sc = (it && it.spacecraft) || it
      if (!sc || typeof sc !== 'object') continue
      const scCfg = (sc && typeof sc.configuration === 'object') ? sc.configuration : null
      const name = ((scCfg && scCfg.full_name) || (scCfg && scCfg.name)) || sc.name || (isStarship ? 'Starship' : null) || '二级/上面级'
      const sn = sc.serial_number || (typeof sc.name === 'string' && /^(ship|s)\s*\d+/i.test(sc.name) ? sc.name : null)

      // "可回收" 推断链（LL2 字段优先，兜底启发式）：
      //   1) spacecraft_config.reusable 显式 true/false  ← LL2 最准的字段（Dragon/Starship 都会给）
      //   2) spacecraft.reusable 本体字段               ← 少数响应有
      //   3) 飞船家族名关键词：Dragon / Starship / Orion / Crew Dragon / Cargo Dragon 等
      //   4) 星舰任务整体兜底                           ← 保留原逻辑
      //   5) 否则一律视为一次性
      //
      // 之前的 `reusable: isStarship` 只认星舰，导致 Dragon CRS 任务的 Cargo Dragon 2 
      // 显示"可回收 否"，与实际严重不符（NASA 二代货运龙支持最多 5 次复用）
      let reusableFlag = null
      if (scCfg && typeof scCfg.reusable === 'boolean') {
        reusableFlag = scCfg.reusable
      } else if (typeof sc.reusable === 'boolean') {
        reusableFlag = sc.reusable
      }
      if (reusableFlag === null) {
        const reusableCheckText = [name, scCfg && scCfg.name, sc.name].filter(Boolean).join(' ').toLowerCase()
        if (/dragon|starship|super\s*heavy|orion|dream\s*chaser|starliner/i.test(reusableCheckText)) {
          reusableFlag = true
        } else if (isStarship) {
          reusableFlag = true
        } else {
          reusableFlag = false
        }
      }

      secondStage = {
        name,
        serialNumber: sn || null,
        reusable: reusableFlag,
        recoveryStatus: null,
        landingType: null,
        landingLocation: null
      }
      break
    }
    const bothReusable = isStarship && (firstStage != null || secondStage != null)
    const stageInfo = { firstStage, secondStage, bothReusable }

    // 直播 / 视频源（LL2 详情端点会返回，列表里通常没有；
    // 字段名两种命名都兼容：vidURLs(camel) / vid_urls(snake)）
    const rawVidUrls = launch.vidURLs || launch.vid_urls || []
    const vidUrls = Array.isArray(rawVidUrls)
      ? rawVidUrls
          .filter(item => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
          .map(item => ({
            url: item.url,
            title: item.title || '',
            description: item.description || '',
            publisher: item.publisher || '',
            language: (item.language && item.language.name) || '',
            type: (item.type && item.type.name) || '',
            priority: item.priority != null ? item.priority : 0
          }))
          .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      : []

    const rawInfoUrls = launch.infoURLs || launch.info_urls || []
    const infoUrls = Array.isArray(rawInfoUrls)
      ? rawInfoUrls
          .filter(item => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
          .map(item => ({
            url: item.url,
            title: item.title || '',
            publisher: item.publisher || ''
          }))
      : []

    const webcastLive = !!(launch.webcast_live === true || launch.webcastLive === true)

    return {
      id: launch.id,
      name: launch.name || '',
      missionName: (launch.mission && launch.mission.name) || launch.name || '未知任务',
      launchTime: launch.net || launch.window_start || launch.window_end,
      windowStart: launch.window_start,
      windowEnd: launch.window_end,
      description: description,
      missionDetails: missionDetails,
      rocketInfo: rocketInfo,
      launchAgency: launchAgency,
      launchAgencyId: launchAgencyId,
      launchAgencyAbbrev: launchAgencyAbbrev,
      launchSite: launchSite,
      padLocation: formatPadLocation(launch.pad),
      rocketName: getRocketDisplayNameFromConfig(rocketConfig),
      status: status.name || '未知状态',
      statusId: status.id != null ? Number(status.id) : null,
      statusCategory,
      statusBadgeText,
      probability: launch.probability,
      boosterInfo: boosterInfo,
      boosterStages: boosterStages,
      launcherBlockTitle: launcherBlockTitle,
      isRecoverableThisMission: isRecoverable(boosterInfo),
      launchServiceProvider,
      missionFull,
      rocketFull,
      padDetail,
      launcherLanding,
      missionDescLong,
      rocketDescLong,
      payloadDetails,
      payloadAmount: payloadAmount > 0 ? payloadAmount : null,
      stageInfo,
      vidUrls,
      infoUrls,
      webcastLive,
      rocketImage: getRocketImage(getRocketDisplayNameFromConfig(rocketConfig)),
      rocketConfiguration: pickRocketConfigurationSnapshot(launch),
      rocketSpecsVisible,
      rocketSpecs,
      // ——以下为 LL2 详情端点独有字段（列表快照没有）——
      missionPatches: buildMissionPatches(launch),
      launchUpdates: buildLaunchUpdates(launch),
      failReason: (typeof launch.failreason === 'string' ? launch.failreason.trim() : ''),
      weatherConcerns: (typeof launch.weather_concerns === 'string' ? launch.weather_concerns.trim() : ''),
      netPrecisionLabel: buildNetPrecisionLabel(launch.net_precision),
      statusDescription: (launch.status && typeof launch.status.description === 'string') ? launch.status.description.trim() : '',
      hashtag: (typeof launch.hashtag === 'string') ? launch.hashtag.trim() : '',
      infographicUrl: pickInfographicUrl(launch),
      programInfo: buildProgramInfo(launch),
      launchSequenceRows: buildLaunchSequenceRows(launch),
      relatedLinks: buildRelatedLinks(launch),
      // 与序号徽章同源，供发射统计大数字回填累计/本年空缺
      agencyLaunchAttemptCount: (launch.agency_launch_attempt_count != null && Number.isFinite(Number(launch.agency_launch_attempt_count)))
        ? Number(launch.agency_launch_attempt_count) : null,
      agencyLaunchAttemptCountYear: (launch.agency_launch_attempt_count_year != null && Number.isFinite(Number(launch.agency_launch_attempt_count_year)))
        ? Number(launch.agency_launch_attempt_count_year) : null
    }
}

function getPayloadDetail(payloadId) {
  if (!payloadId) return Promise.reject(new Error('有效载荷ID不能为空'))
  // 优化：使用较短的超时时间，避免长时间等待
  return request(`/payloads/${payloadId}/`, {
    mode: 'detailed',
    format: 'json'
  }, 5000, true).then(data => {
    const type = data.type && (typeof data.type === 'string' ? data.type : data.type.name)
    const manufacturer = data.manufacturer && (typeof data.manufacturer === 'object' ? data.manufacturer.name : data.manufacturer)
    const operator = data.operator && (typeof data.operator === 'object' ? data.operator.name : data.operator)
    const img = data.image
    const imageUrl = (img && (img.image_url || img.thumbnail_url)) || ''
    const orbitDisplay =
      (data.orbit && typeof data.orbit === 'object' ? buildMissionOrbitDisplayString(data.orbit) : '') || ''
    return {
      id: data.id,
      name: data.name || '—',
      type: type || '',
      manufacturer: manufacturer || '',
      operator: operator || '',
      description: data.description || '',
      imageUrl,
      wiki_link: data.wiki_link || '',
      info_link: data.info_link || '',
      mass: data.mass != null ? data.mass : null,
      cost: data.cost != null ? data.cost : null,
      orbitDisplay
    }
  }).catch(error => {
    throw error
  })
}

module.exports = {
  getLaunchDetail,
  processLaunchDetail,
  getPayloadDetail,
  getLauncherInstanceDetail,
  buildLaunchUpdates,
  mapRawUpdatesToLaunchUpdates
}
