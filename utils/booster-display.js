/**
 * utils/booster-display.js — 可回收火箭族谱共享展示层
 * 监控中心精简区块 / 独立族谱页 / 型号详情页共用：
 *   - 箭实体文档 → 展示卡片（含国旗、厂商、飞行色块）
 *   - 筛选 chip 生成（全部 / 中国 / 各厂商，按数据动态生成）
 *   - 构型元数据（_config_meta）→ 型号卡片
 * 国家来源于云端回填的 countryCode（LL2 构型 manufacturer.country），纯数据驱动
 */

var { getRocketImage } = require('./util.js')

var STATUS_TEXT_MAP = { active: '现役', retired: '退役', destroyed: '损毁', expended: '已消耗', unknown: '未知' }

/** 厂商英文名 → 中文显示名（SpaceX 保留原文；不在表内的原样显示，保持数据驱动兜底） */
var MFR_ZH_MAP = {
  'Blue Origin': '蓝色起源',
  'Rocket Lab': '火箭实验室',
  'Rocket Lab Ltd': '火箭实验室',
  'LandSpace': '蓝箭航天',
  'CASC': '中国航天科技集团',
  'China Aerospace Science and Technology Corporation': '中国航天科技集团',
  'China Aerospace Science and Industry Corporation': '中国航天科工集团',
  'CASIC': '中国航天科工集团',
  'ExPace': '航天科工火箭（快舟）',
  'ArianeGroup': '阿丽亚娜集团',
  'Arianespace': '阿丽亚娜航天',
  'Virgin Galactic': '维珍银河',
  'Virgin Orbit': '维珍轨道',
  'Payload Aerospace S.L.': 'PLD 航天',
  'Mitsubishi Heavy Industries': '三菱重工',
  'Astra Space': '阿斯特拉',
  'Stoke Space Technologies': '斯托克航天',
  'National Center of Space Research': '法国国家空间研究中心',
  'EXOS Aerospace': 'EXOS 航天',
  'iSpace': '星际荣耀',
  'Space Pioneer': '天兵科技',
  'Deep Blue Aerospace': '深蓝航天',
  'Galactic Energy': '星河动力',
  'OrienSpace': '东方空间',
  'CAS Space': '中科宇航',
  'United Launch Alliance': '联合发射联盟',
  'Northrop Grumman': '诺斯罗普·格鲁曼',
  'Firefly Aerospace': '萤火虫航天',
  'Relativity Space': '相对论空间',
  'Stoke Space': '斯托克航天'
}

/** 厂商显示名（筛选 chip 等 UI 用；筛选 id 仍用英文原名，不影响过滤逻辑） */
function mfrDisplayName(name) {
  if (!name) return ''
  return MFR_ZH_MAP[name] || name
}

/** alpha-2 国家代码 → emoji 国旗（区域指示符拼接，任意国家自动支持） */
function countryCodeToFlag(cc) {
  if (!cc || typeof cc !== 'string') return ''
  var up = cc.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(up)) return ''
  var BASE = 0x1F1E6
  var A = 'A'.charCodeAt(0)
  return String.fromCodePoint(BASE + up.charCodeAt(0) - A, BASE + up.charCodeAt(1) - A)
}

/**
 * 从 _config_meta 取构型图：优先 configId 精确匹配，缺失时按 rocketFamily 名称匹配
 * 返回 '' 表示构型侧也无图
 */
function configImageOf(configId, rocketFamily, configsMap) {
  var map = configsMap || {}
  var cfg = null
  if (configId != null) cfg = map[String(configId)] || map[configId] || null
  if (!cfg && rocketFamily) {
    var famLower = String(rocketFamily).toLowerCase()
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue
      var c = map[key]
      if (!c) continue
      if (String(c.name || '').toLowerCase() === famLower ||
          String(c.full_name || '').toLowerCase() === famLower) {
        cfg = c
        break
      }
    }
  }
  if (!cfg) return ''
  return cfg.cosImageUrl || cfg.thumbnail_url || cfg.image_url || ''
}

/** COS 火箭配置图库兜底（getRocketImage 自带 default 占位，仅在有火箭名时使用） */
function cosRocketImageOf(rocketFamily) {
  var fam = String(rocketFamily || '').trim()
  if (!fam || fam.toLowerCase() === 'unknown') return ''
  try {
    return getRocketImage(fam) || ''
  } catch (e) {
    return ''
  }
}

/**
 * 单个箭实体文档 → 展示卡片
 * @param {Object} configsMap 可选，_config_meta 的 configs 映射；
 *   传入时打通兜底链：LL2 箭实体图 → LL2 构型图 → COS 火箭配置图库
 */
function processBoosterItem(item, configsMap) {
  var flights = item.flights || 0
  var flightBlocks = []
  var history = item.flightHistory || []
  for (var i = 0; i < flights; i++) {
    var h = history[i]
    if (h) {
      var isSuccess = h.success === true
      var isFailed = h.success === false
      var isPending = h.success === null || h.success === undefined
      flightBlocks.push({ idx: i, success: isSuccess, failed: isFailed, pending: isPending, known: !isPending })
    } else {
      flightBlocks.push({ idx: i, success: true, failed: false, pending: false, known: false })
    }
  }
  var countryCode = item.countryCode || ''
  var cfgImage = configImageOf(item.configId, item.rocketFamily, configsMap)
  var cosImage = cosRocketImageOf(item.rocketFamily)
  // 多级兜底链（binderror 逐级切换）：COS 镜像 → LL2 缩略图 → LL2 原图 → 构型图 → COS 配置图库
  // LL2 缩略图会被官方重新生成导致旧链接 404，原图往往仍有效，必须纳入链条
  var chain = []
  ;[item.cosImageUrl, item.thumbnailUrl, item.imageUrl, cfgImage, cosImage].forEach(function (u) {
    if (u && chain.indexOf(u) < 0) chain.push(u)
  })
  return {
    serial: item.serialNumber || item.serial || '?',
    flights: flights,
    status: item.status || 'unknown',
    statusText: STATUS_TEXT_MAP[item.status] || '未知',
    rocketFamily: item.rocketFamily || 'Unknown',
    manufacturer: item.manufacturer || '',
    configId: item.configId != null ? item.configId : null,
    countryCode: countryCode,
    countryFlag: countryCodeToFlag(countryCode),
    isStarship: (item.rocketFamily || '').indexOf('Super Heavy') >= 0 || (item.rocketFamily || '').indexOf('Starship') >= 0,
    flightBlocks: flightBlocks,
    firstFlight: item.firstFlight || '',
    lastFlight: item.lastFlight || '',
    imageUrl: chain[0] || '',
    thumbnailUrl: chain[0] || '',
    imageFallbacks: chain.slice(1),
    successfulLandings: item.successfulLandings || 0,
    attemptedLandings: item.attemptedLandings || 0,
    fastestTurnaroundText: item.fastestTurnaroundText || '',
    details: item.details || ''
  }
}

/**
 * 箭实体文档列表 → { processed: 卡片数组, rawBySerial: 原始文档索引（详情页跳转用） }
 * @param {Object} configsMap 可选，透传给 processBoosterItem 打通构型图兜底
 */
function processBoosterList(list, configsMap) {
  var processed = []
  var rawBySerial = {}
  for (var i = 0; i < (list || []).length; i++) {
    var item = list[i]
    var card = processBoosterItem(item, configsMap)
    processed.push(card)
    rawBySerial[card.serial] = item
  }
  return { processed: processed, rawBySerial: rawBySerial }
}

/** 汇总统计（现役 / 最高复用 / 总飞行 / 厂商数） */
function computeBoosterStats(processed) {
  var activeCount = 0
  var maxFlights = 0
  var totalFlights = 0
  var manufacturerSet = {}
  for (var i = 0; i < (processed || []).length; i++) {
    var b = processed[i]
    totalFlights += b.flights
    if (b.flights > maxFlights) maxFlights = b.flights
    if (b.status === 'active') activeCount++
    if (b.manufacturer) manufacturerSet[b.manufacturer] = true
  }
  return {
    activeCount: activeCount,
    maxFlights: maxFlights,
    totalFlights: totalFlights,
    manufacturerCount: Object.keys(manufacturerSet).length
  }
}

/**
 * 生成筛选 chip：全部 / 中国 / 各厂商（按箭数量降序，数据驱动）
 * chip.id 约定：'all' | 'country:CN' | 'mfr:SpaceX'
 */
function buildBoosterFilterChips(processed, options) {
  var maxMfrChips = (options && options.maxManufacturerChips) || 6
  var chips = [{ id: 'all', label: '全部' }]

  var hasCN = false
  var mfrCount = {}
  for (var i = 0; i < (processed || []).length; i++) {
    var b = processed[i]
    if (b.countryCode === 'CN') hasCN = true
    if (b.manufacturer) mfrCount[b.manufacturer] = (mfrCount[b.manufacturer] || 0) + 1
  }

  // 中国筛选置顶（核心特性）：即使当前无中国箭也保留入口，空态由页面提示
  chips.push({ id: 'country:CN', label: countryCodeToFlag('CN') + ' 中国', empty: !hasCN })

  var mfrNames = Object.keys(mfrCount).sort(function (a, b) { return mfrCount[b] - mfrCount[a] })
  for (var j = 0; j < mfrNames.length && j < maxMfrChips; j++) {
    chips.push({ id: 'mfr:' + mfrNames[j], label: mfrDisplayName(mfrNames[j]) })
  }
  return chips
}

/** 按 chip id 过滤箭实体卡片 */
function applyBoosterFilter(processed, filterId) {
  if (!filterId || filterId === 'all') return (processed || []).slice()
  return (processed || []).filter(function (b) {
    if (filterId.indexOf('country:') === 0) return b.countryCode === filterId.slice(8)
    if (filterId.indexOf('mfr:') === 0) return b.manufacturer === filterId.slice(4)
    return true
  })
}

/** 按 chip id 过滤型号卡片（字段同源：countryCode / manufacturer） */
function applyModelFilter(models, filterId) {
  if (!filterId || filterId === 'all') return (models || []).slice()
  return (models || []).filter(function (m) {
    if (filterId.indexOf('country:') === 0) return m.countryCode === filterId.slice(8)
    if (filterId.indexOf('mfr:') === 0) return m.manufacturer === filterId.slice(4)
    return true
  })
}

/** _config_meta 的 configs 映射 → 型号卡片数组（按累计着陆降序，未首飞的排后） */
function buildModelCards(configsMap) {
  var cards = []
  var map = configsMap || {}
  for (var key in map) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue
    var c = map[key]
    if (!c || c.id == null) continue
    var countryCode = c.countryCode || ''
    // 多级兜底链：COS 镜像 → LL2 缩略图 → LL2 原图 → COS 配置图库
    var chain = []
    ;[c.cosImageUrl, c.thumbnail_url, c.image_url, cosRocketImageOf(c.name || c.full_name)].forEach(function (u) {
      if (u && chain.indexOf(u) < 0) chain.push(u)
    })
    cards.push({
      configId: c.id,
      name: c.name || '',
      fullName: c.full_name || c.name || '',
      alias: c.alias || '',
      variant: c.variant || '',
      manufacturer: c.manufacturerName || '',
      manufacturerAbbrev: c.manufacturerAbbrev || '',
      countryCode: countryCode,
      countryFlag: countryCodeToFlag(countryCode),
      reusable: c.reusable === true,
      imageUrl: chain[0] || '',
      thumbnailUrl: chain[0] || '',
      imageFallbacks: chain.slice(1),
      maidenFlight: c.maiden_flight || '',
      hasFlown: !!(c.maiden_flight || (c.total_launch_count && c.total_launch_count > 0)),
      totalLaunchCount: c.total_launch_count || 0,
      successfulLandings: c.successful_landings || 0,
      attemptedLandings: c.attempted_landings || 0
    })
  }
  cards.sort(function (a, b) {
    if (b.successfulLandings !== a.successfulLandings) return b.successfulLandings - a.successfulLandings
    return b.totalLaunchCount - a.totalLaunchCount
  })
  return cards
}

module.exports = {
  countryCodeToFlag: countryCodeToFlag,
  mfrDisplayName: mfrDisplayName,
  configImageOf: configImageOf,
  cosRocketImageOf: cosRocketImageOf,
  processBoosterItem: processBoosterItem,
  processBoosterList: processBoosterList,
  computeBoosterStats: computeBoosterStats,
  buildBoosterFilterChips: buildBoosterFilterChips,
  applyBoosterFilter: applyBoosterFilter,
  applyModelFilter: applyModelFilter,
  buildModelCards: buildModelCards,
  STATUS_TEXT_MAP: STATUS_TEXT_MAP
}
