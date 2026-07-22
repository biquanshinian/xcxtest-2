// utils/api-monitor-data.js — monitor tab heavy data
const { getBoosterGenealogy } = require('./api-app-services.js')
const { translateAgencyName } = require('./space-terms-i18n.js')
const { optimizeImageUrl } = require('./cos-url.js')
const { buildLl2ImageChain } = require('./ll2-image.js')
const {
  request,
  getCacheKey,
  unwrapCacheData
} = require('./api-request.js')

/** 首页公告短缓存：避免 onShow / 重复进入反复查库 */
const ANNOUNCEMENT_MEM_TTL_MS = 8 * 60 * 1000
let _announcementMem = null

/**
 * 获取空间站实时状态（ISS + 天宫）
 * 从缓存获取 space_stations 和 docking_events 数据；
 * docking 列表缺失时回退站详情 docking_location[].currently_docked
 * @returns {Promise<Array>} 空间站列表，含当前停靠飞船
 */
async function getStationStatus() {
  const resolveApiImageUrl = (image) => {
    if (!image) return ''
    if (typeof image === 'string') return image
    return image.thumbnail_url || image.image_url || ''
  }

  const resolveApiImageParts = (image) => {
    if (!image) return { thumb: '', full: '' }
    if (typeof image === 'string') return { thumb: image, full: image }
    return {
      thumb: image.thumbnail_url || '',
      full: image.image_url || ''
    }
  }

  const getStationHeroImage = (stationId, fallbackImage) => {
    const heroMap = {
      4: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/1774271719959_6lm45w.jpg',
      18: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/1774271717044_8om5qs.png'
    }
    // 空间站卡片图展示约 140rpx 高，走 thumb 压缩避免拉原图
    const raw = heroMap[stationId] || fallbackImage || ''
    return raw ? optimizeImageUrl(raw, 'thumb') : ''
  }

  /** 卡片与详情共用的头图兜底链：COS 压缩 → COS 原图 → LL2 代理/原链 */
  const buildStationImageChain = (stationId, imageObj) => {
    const heroMap = {
      4: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/1774271719959_6lm45w.jpg',
      18: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/1774271717044_8om5qs.png'
    }
    const parts = resolveApiImageParts(imageObj)
    const cosRaw = heroMap[stationId] || ''
    const cosThumb = cosRaw ? optimizeImageUrl(cosRaw, 'thumb') : ''
    const ll2Primary = parts.thumb || parts.full || ''
    const chain = []
    ;[cosThumb, cosRaw].forEach((u) => {
      if (u && chain.indexOf(u) < 0) chain.push(u)
    })
    buildLl2ImageChain(parts.thumb, parts.full, ll2Primary).forEach((u) => {
      if (u && chain.indexOf(u) < 0) chain.push(u)
    })
    return chain
  }

  const getStationStatusMeta = (status) => {
    const rawStatus = status ? String(status).trim() : ''
    const normalized = rawStatus.toLowerCase()
    // 宽松匹配（与站点筛选逻辑一致）：LL2 状态文案变化时也能正确归类
    if (normalized.includes('active')) {
      return {
        status: rawStatus || 'Active',
        statusText: '活跃',
        statusBadgeText: '运行中',
        statusTone: 'active',
        statusSummary: '当前处于在轨运行状态'
      }
    }
    if (normalized.includes('retired') || normalized.includes('orbited') || normalized.includes('decommissioned')) {
      return {
        status: rawStatus || 'Retired',
        statusText: '已退役',
        statusBadgeText: '已退役',
        statusTone: 'inactive',
        statusSummary: '当前已结束在轨运行'
      }
    }
    if (normalized.includes('construction') || normalized.includes('assembly')) {
      return {
        status: rawStatus,
        statusText: '建设中',
        statusBadgeText: '建设中',
        statusTone: 'building',
        statusSummary: '当前处于建设或组装阶段'
      }
    }
    return {
      status: rawStatus || 'Unknown',
      statusText: rawStatus || '未知',
      statusBadgeText: rawStatus || '未知',
      statusTone: 'unknown',
      statusSummary: rawStatus ? `当前状态：${rawStatus}` : '状态信息暂缺'
    }
  }

  // 中文展示名词典（未收录的新站回退 LL2 原名，不影响是否显示）
  const STATION_NAME_ZH = {
    4: { name: '国际空间站 ISS', nameEn: 'International Space Station' },
    18: { name: '天宫空间站', nameEn: 'Tiangong Space Station' }
  }
  const DEFAULT_STATION_IDS = [4, 18]

  // ── 动态站点清单（数据驱动）：LL2 /space_stations/ 里 active/在建 的站自动纳入监控 ──
  // 列表缓存由云函数 syncCommonEndpoints / syncStations 写入；缓存缺失时回退 ISS+天宫
  let stationMetas = []
  try {
    const listData = await request('/space_stations/', { format: 'json', limit: 30, offset: 0 }, 8000, true)
    const rows = listData && Array.isArray(listData.results) ? listData.results : []
    stationMetas = rows.filter(s => {
      const st = String((s.status && s.status.name) || '').toLowerCase()
      return st.includes('active') || st.includes('construction') || st.includes('assembly')
    }).map(s => {
      const zh = STATION_NAME_ZH[s.id]
      return {
        id: s.id,
        name: (zh && zh.name) || s.name || '',
        nameEn: (zh && zh.nameEn) || s.name || '',
        // 列表行自带 status/founded/description/orbit/owners 等字段，
        // 详情缓存缺失或读取失败时兜底，避免状态显示「未知」
        listRow: s
      }
    })
    // 已知站（ISS/天宫）排前，新站按 id 排后，保持现有版面顺序稳定
    stationMetas.sort((a, b) => {
      const ia = DEFAULT_STATION_IDS.indexOf(a.id); const ib = DEFAULT_STATION_IDS.indexOf(b.id)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.id - b.id
    })
  } catch (e) { /* 列表缓存尚未同步：走兜底 */ }
  if (!stationMetas.length) {
    stationMetas = DEFAULT_STATION_IDS.map(id => ({ id, name: STATION_NAME_ZH[id].name, nameEn: STATION_NAME_ZH[id].nameEn }))
  }

  // 并行请求各空间站详情和对接事件
  const settled = await Promise.all([
    request('/docking_events/', { limit: 50, offset: 0, ordering: '-docking', format: 'json' }, 12000, true).catch(() => null),
    ...stationMetas.map(meta =>
      request(`/space_stations/${meta.id}/`, { format: 'json' }, 10000, true).catch(() => null)
    )
  ])
  const dockingData = settled[0]
  const stationsRaw = settled.slice(1)
  const dockingResults = (dockingData && dockingData.results) ? dockingData.results : []

  // 远征 ID：详情优先，详情缺失时回退列表行（避免整站详情超时导致远征板块整段消失）
  const expeditionIds = []
  const seenExpIds = {}
  const pushExpId = (id) => {
    const n = Number(id)
    if (!n || seenExpIds[n]) return
    seenExpIds[n] = true
    expeditionIds.push(n)
  }
  stationsRaw.forEach((raw, idx) => {
    const row = stationMetas[idx] && stationMetas[idx].listRow
    ;[raw, row].forEach((src) => {
      if (!src || !Array.isArray(src.active_expeditions)) return
      src.active_expeditions.forEach((e) => { if (e && e.id) pushExpId(e.id) })
    })
  })

  const expeditionDetailsMap = {}
  if (expeditionIds.length > 0) {
    const fetchOneExp = (id) =>
      request(`/expeditions/${id}/`, { format: 'json' }, 10000, true)
        .catch(() =>
          // 二次短重试：远征详情小文档，偶发云读超时不应直接丢 crew
          new Promise((r) => setTimeout(r, 400)).then(() =>
            request(`/expeditions/${id}/`, { format: 'json' }, 12000, true).catch(() => null)
          )
        )
    const expeditionDetailsArray = await Promise.all(expeditionIds.map(fetchOneExp))
    expeditionDetailsArray.forEach((detail) => {
      if (detail && detail.id) expeditionDetailsMap[detail.id] = detail
    })
  }

  // 停靠飞船：优先站详情 docking_location[].currently_docked（随站详情本地可缓存）；
  // docking_events 全量列表约 300KB 常超本地上限、易超时，仅作补充
  const mapDockingEvent = (e, portNameFallback) => {
    if (!e) return null
    const sc = e.flight_vehicle_chaser && e.flight_vehicle_chaser.spacecraft
    const config = sc && sc.spacecraft_config
    const configType = config && config.type && config.type.name
    const isCrew = (configType === 'Crew' || (configType === 'Capsule' && config && config.name && !config.name.includes('Cargo')))
      || !!(config && config.human_rated)
    const dockingDate = e.docking ? new Date(e.docking) : null
    const daysInOrbit = dockingDate && isFinite(dockingDate.getTime())
      ? Math.max(0, Math.floor((Date.now() - dockingDate.getTime()) / 86400000))
      : 0
    const agency = config && config.agency
    const agencyNameEn = agency ? (agency.name || '') : ''
    const agencyAbbrev = agency ? (agency.abbrev || '') : ''
    const agencyName = translateAgencyName(agencyNameEn, agencyAbbrev) || agencyNameEn
    const dockingTimeStr = e.docking ? e.docking.replace('T', ' ').replace('Z', '').slice(0, 19) : ''
    const portName = (e.docking_location && e.docking_location.name) || portNameFallback || ''
    return {
      id: e.id,
      configId: config && config.id != null ? config.id : null,
      name: sc ? sc.name : '未知飞船',
      configName: config ? config.name : '',
      image: resolveApiImageUrl(sc && sc.image),
      portName,
      isCrew: !!isCrew,
      humanRated: isCrew ? '载人' : '货运',
      daysInOrbit,
      dockingDate: e.docking || '',
      dockingTime: dockingTimeStr,
      agencyName,
      agencyAbbrev
    }
  }

  const filterDockedFromList = (stationId) => {
    return dockingResults.filter(e =>
      e.departure === null &&
      e.docking_location &&
      e.docking_location.spacestation &&
      e.docking_location.spacestation.id === stationId
    ).map(e => mapDockingEvent(e)).filter(Boolean)
      .sort((a, b) => new Date(b.dockingDate) - new Date(a.dockingDate))
  }

  const filterDockedFromStation = (raw) => {
    const locs = raw && Array.isArray(raw.docking_location) ? raw.docking_location : []
    const list = []
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i]
      const ev = loc && loc.currently_docked
      if (!ev || ev.departure) continue
      const mapped = mapDockingEvent(ev, loc.name || '')
      if (mapped) list.push(mapped)
    }
    return list.sort((a, b) => new Date(b.dockingDate) - new Date(a.dockingDate))
  }

  /** 合并：站详情 currently_docked 优先，列表补充未见过的 id */
  const mergeDocked = (stationId, raw) => {
    const fromStation = filterDockedFromStation(raw)
    const fromList = filterDockedFromList(stationId)
    if (!fromStation.length) return fromList
    if (!fromList.length) return fromStation
    const seen = {}
    fromStation.forEach((s) => { if (s && s.id != null) seen[s.id] = true })
    const extra = fromList.filter((s) => s && s.id != null && !seen[s.id])
    return fromStation.concat(extra).sort((a, b) => new Date(b.dockingDate) - new Date(a.dockingDate))
  }

  return stationMetas.map((meta, idx) => {
    // 详情缓存缺失/读取超时 → 回退列表行数据（含 status/founded/description 等），保证状态不显示「未知」
    const raw = stationsRaw[idx] || meta.listRow || null
    const docked = mergeDocked(meta.id, raw)
    const owners = raw && Array.isArray(raw.owners) ? raw.owners : []
    const ownerNames = owners
      .map(item => item && (translateAgencyName(item.name, item.abbrev) || item.name))
      .filter(Boolean)
    // 详情缺 active_expeditions 时回退列表行，避免远征整块消失
    const listRowExps = meta.listRow && Array.isArray(meta.listRow.active_expeditions)
      ? meta.listRow.active_expeditions
      : []
    const activeExpeditions = (raw && Array.isArray(raw.active_expeditions) && raw.active_expeditions.length)
      ? raw.active_expeditions
      : listRowExps
    const dockingLocations = raw && Array.isArray(raw.docking_location) ? raw.docking_location : []
    const statusMeta = getStationStatusMeta(raw && raw.status ? raw.status.name : '')
    const imageChain = buildStationImageChain(meta.id, raw && raw.image)

    return {
      id: meta.id,
      apiName: raw && raw.name ? raw.name : '',
      name: meta.name,
      nameEn: meta.nameEn,
      image: imageChain[0] || getStationHeroImage(meta.id, resolveApiImageUrl(raw && raw.image)),
      imageFallbacks: imageChain.slice(1),
      rawImage: resolveApiImageUrl(raw && raw.image),
      imageTitle: raw && raw.image ? (raw.image.name || '') : '',
      imageCredit: raw && raw.image ? (raw.image.credit || '') : '',
      imageLicense: raw && raw.image && raw.image.license ? (raw.image.license.name || '') : '',
      imageLicenseLink: raw && raw.image && raw.image.license ? (raw.image.license.link || '') : '',
      status: statusMeta.status,
      statusText: statusMeta.statusText,
      statusBadgeText: statusMeta.statusBadgeText,
      statusTone: statusMeta.statusTone,
      statusSummary: statusMeta.statusSummary,
      typeName: raw && raw.type ? raw.type.name : '',
      founded: raw ? raw.founded : '',
      deorbited: raw ? raw.deorbited : '',
      orbit: raw ? (raw.orbit || 'LEO') : 'LEO',
      description: raw && raw.description ? raw.description : '',
      owners: ownerNames,
      ownerText: ownerNames.join(' / '),
      ownerCount: ownerNames.length,
      ownerAgencies: owners.map(item => ({
        id: item && item.id,
        name: item ? (translateAgencyName(item.name, item.abbrev) || item.name || '') : '',
        abbrev: item && item.abbrev ? item.abbrev : '',
        typeName: item && item.type && item.type.name ? item.type.name : '',
        countryText: item && Array.isArray(item.country)
          ? item.country.map(country => country && country.name).filter(Boolean).join(' / ')
          : ''
      })).filter(item => item.name),
      expedition: activeExpeditions.length > 0 ? activeExpeditions[0].name : '',
      expeditionCount: activeExpeditions.length,
      expeditionList: activeExpeditions.map(item => {
        // 优先使用详情API的数据（包含完整crew信息）
        const detailData = item && item.id && expeditionDetailsMap[item.id] ? expeditionDetailsMap[item.id] : item
        const crewArray = detailData && Array.isArray(detailData.crew) ? detailData.crew : []
        
        return {
          id: item && item.id,
          name: item && item.name ? item.name : '',
          start: item && item.start ? item.start : '',
          end: item && item.end ? item.end : '',
          crew: crewArray.map(c => {
            // 修复：图片在 astronaut.image 对象中，不是 profile_image
            const imageUrl = resolveApiImageUrl(c.astronaut && c.astronaut.image)
            // 处理nationality：可能是字符串、对象或数组
            let nationality = ''
            let countryCode = ''
            if (c.astronaut && c.astronaut.nationality) {
              if (typeof c.astronaut.nationality === 'string') {
                // 字符串格式
                nationality = c.astronaut.nationality
              } else if (Array.isArray(c.astronaut.nationality) && c.astronaut.nationality.length > 0) {
                // 数组格式（实际情况）
                const nat = c.astronaut.nationality[0]
                nationality = nat.nationality_name || nat.name || ''
                countryCode = nat.alpha_2_code || nat.code || ''
              } else if (c.astronaut.nationality.name) {
                // 对象格式
                nationality = c.astronaut.nationality.name
                countryCode = c.astronaut.nationality.alpha_2_code || c.astronaut.nationality.code || ''
              }
            }
            // 将国家代码转换为国旗emoji
            const countryFlag = countryCode ? String.fromCodePoint(...[...countryCode.toUpperCase()].map(c => 127397 + c.charCodeAt())) : ''
            
            return {
              id: c.id,
              role: c.role && c.role.role ? c.role.role : (typeof c.role === 'string' ? c.role : ''),
              name: c.astronaut && c.astronaut.name ? c.astronaut.name : '',
              nationality: nationality,
              countryCode: countryCode,
              countryFlag: countryFlag,
              agency: c.astronaut && c.astronaut.agency && c.astronaut.agency.name ? c.astronaut.agency.name : '',
              agencyAbbrev: c.astronaut && c.astronaut.agency && c.astronaut.agency.abbrev ? c.astronaut.agency.abbrev : '',
              image: imageUrl,
              status: c.astronaut && c.astronaut.status && c.astronaut.status.name ? c.astronaut.status.name : '',
              age: c.astronaut && c.astronaut.age ? c.astronaut.age : null,
              dateOfBirth: c.astronaut && c.astronaut.date_of_birth ? c.astronaut.date_of_birth : '',
              bio: c.astronaut && c.astronaut.bio ? c.astronaut.bio : '',
              wiki: c.astronaut && c.astronaut.wiki ? c.astronaut.wiki : '',
              firstFlight: c.astronaut && c.astronaut.first_flight ? c.astronaut.first_flight.split('T')[0] : '',
              lastFlight: c.astronaut && c.astronaut.last_flight ? c.astronaut.last_flight.split('T')[0] : '',
              timeInSpace: c.astronaut && c.astronaut.time_in_space ? c.astronaut.time_in_space : '',
              evaTime: c.astronaut && c.astronaut.eva_time ? c.astronaut.eva_time : '',
              typeName: c.astronaut && c.astronaut.type && c.astronaut.type.name ? c.astronaut.type.name : ''
            }
          }).filter(c => c.name)
        }
      }).filter(item => item.name),
      onboardCrew: raw && raw.onboard_crew !== undefined && raw.onboard_crew !== null ? raw.onboard_crew : null,
      dockedVehicles: raw && raw.docked_vehicles !== undefined && raw.docked_vehicles !== null ? raw.docked_vehicles : null,
      height: raw && raw.height !== undefined && raw.height !== null ? `${raw.height} 米` : '',
      width: raw && raw.width !== undefined && raw.width !== null ? `${raw.width} 米` : '',
      mass: raw && raw.mass !== undefined && raw.mass !== null ? `${raw.mass} 吨` : '',
      volume: raw && raw.volume !== undefined && raw.volume !== null ? `${raw.volume} 立方米` : '',
      dockingPortCount: dockingLocations.length,
      dockingPorts: dockingLocations.map(item => ({
        id: item && item.id,
        name: item && item.name ? item.name : '',
        occupied: !!(item && item.currently_docked),
        occupiedText: item && item.currently_docked ? '已占用' : '空闲'
      })).filter(item => item.name),
      apiUrl: raw && raw.url ? raw.url : '',
      dockedSpacecraft: docked,
      dockedCount: docked.length
    }
  }).filter(item =>
    // 新增站的详情缓存可能晚于列表同步到位：详情未就绪前先不渲染空壳；
    // 默认站（ISS/天宫）保持历史行为，详情暂缺也占位显示
    item.apiName || DEFAULT_STATION_IDS.indexOf(item.id) !== -1
  )
}

// ========== 发射商（Agencies）图鉴 ==========
const AGENCY_CACHE_TTL = 60 * 60 * 1000 // 1小时

function normalizeAgencyLookupText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（）()\[\]{}.,'"&/\\-]+/g, ' ')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|gmbh|s a|sa|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function resolveAgencyReference(options = {}) {
  const agencyId = options.agencyId != null && String(options.agencyId).trim() !== ''
    ? String(options.agencyId).trim()
    : ''
  const agencyName = String(options.agencyName || '').trim()
  const agencyAbbrev = String(options.agencyAbbrev || '').trim()

  if (agencyId) {
    return {
      id: agencyId,
      matchType: 'id',
      item: null
    }
  }

  const normalizedName = normalizeAgencyLookupText(agencyName)
  const normalizedAbbrev = normalizeAgencyLookupText(agencyAbbrev)
  if (!normalizedName && !normalizedAbbrev) return null

  const data = await getAgencies({ featured: false, limit: 400, offset: 0 })
  const list = data && Array.isArray(data.results) ? data.results : []
  if (!list.length) return null

  const matched = list.find((item) => {
    if (!item) return false
    const itemId = item.id != null ? String(item.id) : ''
    if (agencyId && itemId === agencyId) return true

    const itemName = String(item.name || '').trim()
    const itemAbbrev = String(item.abbrev || '').trim()
    const itemNormalizedName = normalizeAgencyLookupText(itemName)
    const itemNormalizedAbbrev = normalizeAgencyLookupText(itemAbbrev)

    if (normalizedName && itemName === agencyName) return true
    if (normalizedAbbrev && itemAbbrev && itemAbbrev === agencyAbbrev) return true
    if (normalizedName && itemNormalizedName && itemNormalizedName === normalizedName) return true
    if (normalizedAbbrev && itemNormalizedAbbrev && itemNormalizedAbbrev === normalizedAbbrev) return true
    if (normalizedName && itemNormalizedAbbrev && itemNormalizedAbbrev === normalizedName) return true
    if (normalizedAbbrev && itemNormalizedName && itemNormalizedName === normalizedAbbrev) return true
    return false
  })

  if (!matched || matched.id == null) {
    // 列表缓存缺页或排序未覆盖时，用 Space Devs search 再解析（如 LandSpace）
    const searchQ = (agencyName && agencyName.trim()) || (agencyAbbrev && agencyAbbrev.trim()) || ''
    if (searchQ.length >= 2) {
      try {
        const searchData = await getAgencies({ featured: false, limit: 20, offset: 0, search: searchQ })
        const searchList = searchData && Array.isArray(searchData.results) ? searchData.results : []
        const sMatch = searchList.find((item) => {
          if (!item) return false
          const itemName = String(item.name || '').trim()
          const itemAbbrev = String(item.abbrev || '').trim()
          const itemNormName = normalizeAgencyLookupText(itemName)
          const itemNormAbbrev = normalizeAgencyLookupText(itemAbbrev)
          if (normalizedName && itemName === agencyName) return true
          if (normalizedAbbrev && itemAbbrev && itemAbbrev === agencyAbbrev) return true
          if (normalizedName && itemNormName === normalizedName) return true
          if (normalizedAbbrev && itemNormAbbrev === normalizedAbbrev) return true
          return false
        })
        if (sMatch && sMatch.id != null) {
          return {
            id: String(sMatch.id),
            matchType: 'search',
            item: sMatch
          }
        }
      } catch (e) {
      }
    }
    return null
  }

  return {
    id: String(matched.id),
    matchType: 'name',
    item: matched
  }
}

/**
 * 获取发射商列表
 * 优先走本地缓存 → 云缓存 → 直接请求 API
 * @param {Object} options - { featured, limit, offset, search, type }
 * @returns {Promise<Object>} { count, results: [...] }
 */
async function getAgencies(options = {}) {
  const featured = options.featured !== undefined ? options.featured : true
  const rawLimit = options.limit || 50
  const offset = options.offset || 0
  const search = options.search || ''
  const type = options.type || ''

  const limit = (!featured && !search && !type && offset === 0)
    ? Math.max(rawLimit, 400)
    : rawLimit

  const cacheId = `_agencies_f${featured ? 1 : 0}_l${limit}_o${offset}_s${search}_t${type}`

  // 1) 本地缓存（新鲜命中直接返回；过期条目保留在 staleEntry 供失败兜底）
  let staleEntry = null
  try {
    const cached = wx.getStorageSync(cacheId)
    if (cached && cached.data && Array.isArray(cached.data.results) && cached.data.results.length > 0) {
      if (Date.now() - cached.ts < AGENCY_CACHE_TTL) {
        return cached.data
      }
      staleEntry = cached.data
    }
  } catch (e) {
  }

  // 2) 尝试走 request（云缓存）
  const params = { format: 'json', limit, offset }
  if (featured) params.featured = true
  if (search) params.search = search
  if (type) params.type = type

  try {
    const data = await request('/agencies/', params, 10000, true)
    if (data && Array.isArray(data.results) && data.results.length > 0) {
      try { wx.setStorageSync(cacheId, { data, ts: Date.now() }) } catch (e) {}
      return data
    }
    // 云端返回空列表（同步异常期）：不写缓存（否则空态被钉住 1 小时），
    // 有过期旧数据时宁可展示旧数据
    if (staleEntry) return staleEntry
    if (data && data.results) return data
  } catch (e) {
  }

  // 3) 缓存未命中：不再由前端触发 syncAgencies 外网同步（改为仅服务端定时同步）。
  // 请求失败时优先回退过期本地缓存（stale-if-error），避免网络抖动直接白屏
  if (staleEntry) return staleEntry
  return { count: 0, results: [], __cacheMiss: true }
}

/**
 * 获取单个发射商详情
 * @param {Number} agencyId
 * @returns {Promise<Object>}
 */
async function getAgencyDetail(agencyId, options = {}) {
  if (!agencyId) return null
  const cacheId = `_agency_detail_${agencyId}`
  const _tag = `[getAgencyDetail #${agencyId}]`
  // 下拉刷新用：跳过本地 1h 缓存直读云缓存（云端 TTL 决定 LL2 拉取节奏）
  const skipLocalCache = !!(options && options.skipLocalCache)

  // 1) 优先本地缓存（1小时有效期）；__partial 不锁死长缓存，便于云端自愈后尽快补全
  if (!skipLocalCache) {
    try {
      const cached = wx.getStorageSync(cacheId)
      if (cached && cached.data && Date.now() - cached.ts < AGENCY_CACHE_TTL) {
        if (!(cached.data && cached.data.__partial)) {
          return cached.data
        }
        // partial 仅保留 5 分钟，避免「部分数据待补全」横幅卡死 1h
        if (Date.now() - cached.ts < 5 * 60 * 1000) {
          return cached.data
        }
      }
    } catch (e) {
    }
  }

  // 2) 尝试从云缓存获取单个发射商详情（包含完整统计数据）
  try {
    const data = await request(`/agencies/${agencyId}/`, { format: 'json' }, 10000, true)
    if (data && data.id) {
      try {
        wx.setStorageSync(cacheId, { data, ts: Date.now() })
      } catch (e) {}
      return data
    }
  } catch (e) {
  }

  // 3) 云缓存未命中：不再由前端触发 syncAgencyDetail 外网同步，
  // 直接走下方发射商列表兜底（partial 数据或 cache_miss 提示）

  // 4) 从发射商列表中查找作为兜底
  let basicData = null
  try {
    const aggregateData = await getAgencies({ featured: false, limit: 400, offset: 0 })
    if (aggregateData && aggregateData.results && Array.isArray(aggregateData.results)) {
      const found = aggregateData.results.find(item =>
        item && (item.id === agencyId || String(item.id) === String(agencyId))
      )
      if (found) basicData = found
    }
  } catch (e) {
  }

  if (!basicData) {
    try {
      const featuredData = await getAgencies({ featured: true, limit: 50, offset: 0 })
      if (featuredData && featuredData.results && Array.isArray(featuredData.results)) {
        const found = featuredData.results.find(item =>
          item && (item.id === agencyId || String(item.id) === String(agencyId))
        )
        if (found) basicData = found
      }
    } catch (e) {
    }
  }

  if (basicData) {
    const partialData = {
      ...basicData,
      __partial: true,
      __partialReason: 'detail_sync_pending',
      __partialMessage: '当前先展示机构基础信息，统计与扩展资料将在云端详情同步完成后补齐。'
    }
    try {
      wx.setStorageSync(cacheId, { data: partialData, ts: Date.now() })
    } catch (e) {}
    return partialData
  }

  throw {
    errMsg: '该发射商数据暂不可用，请等待云函数定时同步。',
    statusCode: 404,
    type: 'cache_miss',
    retryable: false
  }
}

// ==================== 遥测数据 ====================

/**
 * 获取发射遥测数据（通过云函数代理 Launch Dashboard API）
 * @param {Object} params 查询参数
 * @param {String} params.launchId SpaceDevs launch UUID（优先使用）
 * @param {String} params.missionId Launch Dashboard 任务名（如 crs-18）
 * @param {Number} params.flightNumber SpaceX 航班号
 * @param {Number} params.interval 数据点间隔秒数（默认2秒，减少数据量）
 * @returns {Promise<Object|null>} 遥测数据或 null
 */
function getTelemetryData(params = {}) {
  const { launchId, missionId, flightNumber, interval = 2 } = params

  if (!launchId && !missionId && !flightNumber) {
    return Promise.resolve(null)
  }

  // 本地缓存 key
  const cacheId = `telemetry_${launchId || missionId || flightNumber}`
  try {
    const cached = wx.getStorageSync(cacheId)
    if (cached && cached.data && (Date.now() - cached.ts < 12 * 60 * 60 * 1000)) {
      return Promise.resolve(cached.data)
    }
  } catch (e) {}

  return wx.cloud.callFunction({
    name: 'apiProxy',
    data: {
      action: 'telemetry',
      launchLibrary2Id: launchId || '',
      missionId: missionId || '',
      flightNumber: flightNumber || '',
      interval
    }
  }).then(res => {
    const result = res && res.result
    if (result && result.success && result.data) {
      try { wx.setStorageSync(cacheId, { data: result.data, ts: Date.now() }) } catch (e) {}
      return result.data
    }
    return null
  }).catch(() => null)
}


async function getActiveAnnouncement() {
  try {
    if (!wx.cloud || !wx.cloud.database) return null
    const now = Date.now()
    if (
      _announcementMem &&
      (now - (_announcementMem.at || 0) < ANNOUNCEMENT_MEM_TTL_MS)
    ) {
      return _announcementMem.data
    }
    const db = wx.cloud.database()
    const res = await Promise.race([
      db.collection('system_announcements')
        .where({ active: true })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
      new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 4000))
    ]).catch(() => ({ data: [] }))
    const list = res.data || []
    if (!list.length) {
      _announcementMem = { at: now, data: null }
      return null
    }
    const item = list[0]
    const data = {
      id: item._id,
      title: item.title || '',
      content: item.content || '',
      type: item.type || 'info',
      active: true
    }
    _announcementMem = { at: now, data }
    return data
  } catch (e) {
    return null
  }
}

module.exports = {
  getStationStatus,
  getAgencies,
  getAgencyDetail,
  resolveAgencyReference,
  getTelemetryData,
  getActiveAnnouncement,
  getBoosterGenealogy
}
