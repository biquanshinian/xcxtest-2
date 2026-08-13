/**
 * utils/booster-display.js — 可回收火箭族谱共享展示层
 * 监控中心精简区块 / 独立族谱页 / 型号详情页共用：
 *   - 箭实体文档 → 展示卡片（含国旗、厂商、飞行色块）
 *   - 筛选 chip 生成（全部 / 中国 / 各厂商，按数据动态生成）
 *   - 构型元数据（_config_meta）→ 型号卡片
 * 国家来源于云端回填的 countryCode（LL2 构型 manufacturer.country），纯数据驱动
 */

var { getRocketImage } = require('../../../utils/util.js')
var { getCachedMediaImage } = require('../../../utils/icon-cache.js')
var { optimizeImageUrl } = require('../../../utils/cos-url.js')
var { proxiedImageUrl } = require('../../../utils/ll2-image.js')
var { translateRocketName } = require('../../../utils/rocket-name-i18n.js')
var { translateAgencyName } = require('../../../utils/space-terms-i18n.js')
var { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../../utils/agency-logo-overrides.js')
var { resolveAgencyLogoForDisplay } = require('../../../utils/agency-logo-cache.js')
var gallerySearch = require('./gallery-search.js')

/** Tab 预览条数：与发射商图鉴一致，完整列表留给「查看全部」页 */
var TAB_PREVIEW_COUNT = 2

/** 卡片主图：COS 静图压缩 + 本地缓存；兜底链保持原链（binderror 逐级切换时才拉） */
function cachedCardImage(url) {
  if (!url) return ''
  return getCachedMediaImage(url, 'thumb')
}

/** 不触发 downloadFile 预热：只返回压缩远程 URL，由 <image> 滚动可见时再拉 */
function remoteThumbImage(url) {
  if (!url) return ''
  if (/imageMogr2|ci-process=/i.test(url)) return url
  return optimizeImageUrl(url, 'thumb')
}

var STATUS_TEXT_MAP = { active: '现役', retired: '退役', destroyed: '损毁', expended: '已消耗', unknown: '未知' }

var COUNTRY_CODE_ZH = {
  CN: '中国', US: '美国', RU: '俄罗斯', JP: '日本', IN: '印度',
  FR: '法国', DE: '德国', GB: '英国', NZ: '新西兰', KR: '韩国',
  IL: '以色列', BR: '巴西', AU: '澳大利亚', KZ: '哈萨克斯坦',
  UA: '乌克兰', IT: '意大利', ES: '西班牙', IR: '伊朗'
}

function normalizeBoosterStatus(status) {
  var s = String(status || '').trim().toLowerCase()
  if (s === 'lost') return 'destroyed'
  if (STATUS_TEXT_MAP[s]) return s
  return 'unknown'
}

function countrySearchLabel(countryCode) {
  var cc = String(countryCode || '').trim().toUpperCase()
  return COUNTRY_CODE_ZH[cc] || ''
}

function rocketSearchAliases(nameEn) {
  var n = String(nameEn || '')
  var m = n.match(/(?:long\s*march|changzheng|cz)[-\s]*(\d{1,2})\s*([a-z]*)/i)
  if (!m) return ''
  var num = m[1]
  var letters = (m[2] || '').toLowerCase()
  return ['cz' + num + letters, 'CZ-' + num + letters.toUpperCase()].join('|')
}

function configOf(configId, configsMap) {
  if (configId == null || !configsMap) return null
  return configsMap[String(configId)] || configsMap[configId] || null
}

/** 厂商英文名 → 中文显示名（SpaceX 品牌保留原文；不在表内的原样显示，保持数据驱动兜底） */
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
  'Stoke Space': '斯托克航天',
  'McDonnell Douglas': '麦克唐纳·道格拉斯',
  'Convair': '康维尔',
  'Orbital Sciences Corporation': '轨道科学公司',
  'Orbital ATK': '轨道 ATK',
  'NASA': '美国国家航空航天局',
  'Roscosmos': '俄罗斯国家航天集团',
  'ISRO': '印度空间研究组织',
  'JAXA': '日本宇宙航空研究开发机构',
  'ESA': '欧洲航天局'
}

function isSpaceXMfr(name, abbrev) {
  var n = String(name || '').toLowerCase()
  var a = String(abbrev || '').toLowerCase()
  return n.indexOf('spacex') >= 0 || n.indexOf('space exploration technologies') >= 0 ||
    a === 'spx' || a.indexOf('spacex') >= 0
}

/** 厂商显示名（筛选 chip / 卡片；筛选 id 仍用英文原名。SpaceX 一律显示品牌原文） */
function mfrDisplayName(name, abbrev) {
  if (!name && !abbrev) return ''
  if (isSpaceXMfr(name, abbrev)) return 'SpaceX'
  return MFR_ZH_MAP[name] || translateAgencyName(name, abbrev || '') || name || abbrev || ''
}

/** 卡片用发射商 logo：SpaceX 统一图；其它可由 attachManufacturerLogos 从发射商列表补全 */
function mfrLogoUrl(name, abbrev) {
  if (!isSpaceXMfr(name, abbrev)) return ''
  return resolveAgencyLogoForDisplay(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL) ||
    SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL
}

/**
 * 用发射商图鉴列表给卡片补 manufacturerLogoUrl / agencyLogoUrl
 * @param {Array} cards
 * @param {Array} agencies formatAgency 行（含 name/abbrev/logoUrl）
 * @param {'manufacturer'|'agency'} kind
 */
function attachManufacturerLogos(cards, agencies, kind) {
  var list = Array.isArray(cards) ? cards : []
  // 兼容 getFeaturedAgencies() 返回 { list } 与直接传数组
  var ags = Array.isArray(agencies)
    ? agencies
    : (agencies && Array.isArray(agencies.list) ? agencies.list : [])
  if (!list.length) return list
  var byKey = {}
  for (var i = 0; i < ags.length; i++) {
    var a = ags[i]
    if (!a || !a.logoUrl) continue
    var logo = resolveAgencyLogoForDisplay(a.logoUrl) || a.logoUrl
    ;[a.name, a.abbrev, a.displayName].forEach(function (k) {
      var key = String(k || '').trim().toLowerCase()
      if (key && !byKey[key]) byKey[key] = logo
    })
  }
  var logoField = kind === 'agency' ? 'agencyLogoUrl' : 'manufacturerLogoUrl'
  var nameField = kind === 'agency' ? 'agencyName' : 'manufacturer'
  var abbrevField = kind === 'agency' ? 'agencyAbbrev' : 'manufacturerAbbrev'
  return list.map(function (card) {
    if (!card) return card
    if (card[logoField]) return card
    var name = card[nameField] || ''
    var abbrev = card[abbrevField] || ''
    var logo = mfrLogoUrl(name, abbrev) ||
      byKey[String(name).trim().toLowerCase()] ||
      byKey[String(abbrev).trim().toLowerCase()] ||
      ''
    if (!logo) return card
    var next = {}
    for (var k in card) {
      if (Object.prototype.hasOwnProperty.call(card, k)) next[k] = card[k]
    }
    next[logoField] = logo
    return next
  })
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
 * @param {{ skipImageCache?: boolean }} [options] true 时不触发 getCachedMediaImage 预热
 */
function processBoosterItem(item, configsMap, options) {
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
  var familyEn = item.rocketFamily || 'Unknown'
  var mfrEn = item.manufacturer || ''
  var mfrZh = mfrDisplayName(mfrEn)
  var familyZh = translateRocketName(familyEn) || familyEn
  var status = normalizeBoosterStatus(item.status)
  var cfg = configOf(item.configId, configsMap)
  var reusable = cfg ? cfg.reusable === true : item.reusable !== false
  var cfgImage = configImageOf(item.configId, familyEn, configsMap)
  var cosImage = cosRocketImageOf(familyEn)
  // 多级兜底链（binderror 逐级切换）：COS 镜像 → 代理缩略/原图 → LL2 缩略/原图 → 构型图 → COS 配置图库
  // LL2 缩略图会被官方重新生成导致旧链接 404，原图往往仍有效，必须纳入链条；
  // DigitalOcean 图床国内直连易失败，代理 URL 优先于原链
  var chain = []
  ;[
    item.cosImageUrl,
    proxiedImageUrl(item.thumbnailUrl), item.thumbnailUrl,
    proxiedImageUrl(item.imageUrl), item.imageUrl,
    cfgImage, cosImage
  ].forEach(function (u) {
    if (u && chain.indexOf(u) < 0) chain.push(u)
  })
  var skipCache = !!(options && options.skipImageCache)
  var primary = skipCache ? remoteThumbImage(chain[0]) : cachedCardImage(chain[0])
  var serial = item.serialNumber || item.serial || '?'
  return {
    serial: serial,
    flights: flights,
    status: status,
    statusText: STATUS_TEXT_MAP[status] || '未知',
    rocketFamilyEn: familyEn,
    rocketFamily: familyZh,
    manufacturer: mfrEn,
    manufacturerZh: mfrZh,
    manufacturerDisplay: mfrZh,
    manufacturerLogoUrl: mfrLogoUrl(mfrEn),
    configId: item.configId != null ? item.configId : null,
    countryCode: countryCode,
    countryFlag: countryCodeToFlag(countryCode),
    reusable: reusable,
    reuseLabel: reusable ? '可复用' : '一次性',
    showLanding: reusable,
    isStarship: familyEn.indexOf('Super Heavy') >= 0 || familyEn.indexOf('Starship') >= 0,
    flightBlocks: flightBlocks,
    firstFlight: item.firstFlight || '',
    lastFlight: item.lastFlight || '',
    imageUrl: primary,
    thumbnailUrl: primary,
    imageFallbacks: chain.slice(1),
    successfulLandings: item.successfulLandings || 0,
    attemptedLandings: item.attemptedLandings || 0,
    fastestTurnaroundText: item.fastestTurnaroundText || '',
    details: item.details || '',
    searchText: gallerySearch.joinSearchText([
      serial, familyZh, familyEn, mfrEn, mfrZh,
      status, STATUS_TEXT_MAP[status],
      countryCode, countrySearchLabel(countryCode),
      rocketSearchAliases(familyEn),
      reusable ? '可复用|reusable' : '一次性|expendable',
      isSpaceXMfr(mfrEn) ? '太空探索技术公司' : ''
    ])
  }
}

/**
 * 箭实体文档列表 → { processed: 卡片数组, rawBySerial: 原始文档索引（详情页跳转用） }
 * @param {Object} configsMap 可选，透传给 processBoosterItem 打通构型图兜底
 * @param {{ imageCacheLimit?: number }} [options] 仅对前 N 条触发本地图缓存预热；其余只返回压缩远程 URL
 */
function processBoosterList(list, configsMap, options) {
  var imageCacheLimit = (options && options.imageCacheLimit != null)
    ? options.imageCacheLimit
    : Number.MAX_SAFE_INTEGER
  var processed = []
  var rawBySerial = {}
  for (var i = 0; i < (list || []).length; i++) {
    var item = list[i]
    var card = processBoosterItem(item, configsMap, {
      skipImageCache: i >= imageCacheLimit
    })
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
 * 生成筛选 chip：全部 / 中国 / 可复用 / 各厂商（按箭数量降序，数据驱动）
 * chip.id 约定：'all' | 'country:CN' | 'reusable' | 'expendable' | 'mfr:SpaceX'
 */
function buildBoosterFilterChips(processed, options) {
  // maxManufacturerChips：兼容旧调用；picker 模式传 Infinity / 很大值拿全量厂商
  var maxMfrChips = (options && options.maxManufacturerChips != null)
    ? options.maxManufacturerChips
    : 6
  var chips = [{ id: 'all', label: '全部' }]

  var hasCN = false
  var hasReusable = false
  var hasExpendable = false
  var mfrCount = {}
  for (var i = 0; i < (processed || []).length; i++) {
    var b = processed[i]
    if (b.countryCode === 'CN') hasCN = true
    if (b.reusable === true) hasReusable = true
    else hasExpendable = true
    if (b.manufacturer) mfrCount[b.manufacturer] = (mfrCount[b.manufacturer] || 0) + 1
  }

  // 中国筛选置顶（核心特性）：即使当前无中国箭也保留入口，空态由页面提示
  chips.push({ id: 'country:CN', label: countryCodeToFlag('CN') + ' 中国', empty: !hasCN })
  chips.push({ id: 'reusable', label: '可复用', empty: !hasReusable })
  chips.push({ id: 'expendable', label: '一次性', empty: !hasExpendable })

  var mfrNames = Object.keys(mfrCount).sort(function (a, b) { return mfrCount[b] - mfrCount[a] })
  for (var j = 0; j < mfrNames.length && j < maxMfrChips; j++) {
    chips.push({
      id: 'mfr:' + mfrNames[j],
      label: mfrDisplayName(mfrNames[j]),
      nameEn: mfrNames[j],
      count: mfrCount[mfrNames[j]]
    })
  }
  return chips
}

function matchesGenealogyChip(card, filterId) {
  if (!filterId || filterId === 'all') return true
  if (filterId === 'reusable') return card.reusable === true
  if (filterId === 'expendable') return card.reusable !== true
  if (filterId.indexOf('country:') === 0) return card.countryCode === filterId.slice(8)
  if (filterId.indexOf('mfr:') === 0) return card.manufacturer === filterId.slice(4)
  return true
}

/** 按 chip id 过滤箭实体卡片 */
function applyBoosterFilter(processed, filterId) {
  if (!filterId || filterId === 'all') return (processed || []).slice()
  return (processed || []).filter(function (b) { return matchesGenealogyChip(b, filterId) })
}

/** 按 chip id 过滤型号卡片（字段同源：countryCode / manufacturer / reusable） */
function applyModelFilter(models, filterId) {
  if (!filterId || filterId === 'all') return (models || []).slice()
  return (models || []).filter(function (m) { return matchesGenealogyChip(m, filterId) })
}

function extraChipForFilter(filterId) {
  if (!filterId || filterId === 'all') return null
  if (filterId === 'reusable') return { id: 'reusable', label: '可复用' }
  if (filterId === 'expendable') return { id: 'expendable', label: '一次性' }
  if (filterId.indexOf('country:') === 0) {
    var cc = filterId.slice(8)
    var zh = countrySearchLabel(cc) || cc
    return { id: filterId, label: (cc.length === 2 ? countryCodeToFlag(cc) + ' ' : '') + zh }
  }
  if (filterId.indexOf('mfr:') === 0) {
    return { id: filterId, label: mfrDisplayName(filterId.slice(4)), nameEn: filterId.slice(4) }
  }
  return { id: filterId, label: filterId }
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
    var nameEn = c.name || ''
    var fullEn = c.full_name || c.name || ''
    var mfrEn = c.manufacturerName || ''
    var mfrZh = mfrDisplayName(mfrEn, c.manufacturerAbbrev || '') || mfrEn
    var nameZh = translateRocketName(nameEn) || nameEn
    var fullZh = translateRocketName(fullEn) || fullEn
    var reusable = c.reusable === true
    var hasFlown = !!(c.maiden_flight || (c.total_launch_count && c.total_launch_count > 0))
    var totalLaunchCount = c.total_launch_count || 0
    var successfulLandings = c.successful_landings || 0
    var attemptedLandings = c.attempted_landings || 0
    var statPending = !hasFlown
    var statText = '首飞待定'
    if (hasFlown) {
      if (reusable) statText = '着陆 ' + successfulLandings + '/' + attemptedLandings
      else statText = totalLaunchCount > 0 ? ('发射 ' + totalLaunchCount + ' 次') : '一次性'
    }
    cards.push({
      configId: c.id,
      nameEn: nameEn,
      fullNameEn: fullEn,
      name: nameZh,
      fullName: fullZh,
      alias: c.alias || '',
      variant: c.variant || '',
      // manufacturer 保留英文，供 mfr: 筛选；展示用 manufacturerDisplay
      manufacturer: mfrEn,
      manufacturerZh: mfrZh,
      manufacturerDisplay: mfrZh,
      manufacturerAbbrev: c.manufacturerAbbrev || '',
      manufacturerLogoUrl: mfrLogoUrl(mfrEn, c.manufacturerAbbrev || ''),
      countryCode: countryCode,
      countryFlag: countryCodeToFlag(countryCode),
      reusable: reusable,
      reuseLabel: reusable ? '可复用' : '一次性',
      showLanding: reusable && hasFlown,
      statText: statText,
      statPending: statPending,
      imageUrl: cachedCardImage(chain[0]),
      thumbnailUrl: cachedCardImage(chain[0]),
      imageFallbacks: chain.slice(1),
      maidenFlight: c.maiden_flight || '',
      hasFlown: hasFlown,
      totalLaunchCount: totalLaunchCount,
      successfulLandings: successfulLandings,
      attemptedLandings: attemptedLandings,
      searchText: gallerySearch.joinSearchText([
        nameZh, nameEn, fullZh, fullEn, c.alias, c.variant,
        mfrEn, mfrZh, c.manufacturerAbbrev,
        countryCode, countrySearchLabel(countryCode),
        rocketSearchAliases(nameEn), rocketSearchAliases(fullEn),
        reusable ? '可复用|reusable' : '一次性|expendable',
        isSpaceXMfr(mfrEn, c.manufacturerAbbrev) ? '太空探索技术公司' : ''
      ])
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
  isSpaceXMfr: isSpaceXMfr,
  mfrDisplayName: mfrDisplayName,
  mfrLogoUrl: mfrLogoUrl,
  attachManufacturerLogos: attachManufacturerLogos,
  configImageOf: configImageOf,
  cosRocketImageOf: cosRocketImageOf,
  processBoosterItem: processBoosterItem,
  processBoosterList: processBoosterList,
  computeBoosterStats: computeBoosterStats,
  buildBoosterFilterChips: buildBoosterFilterChips,
  applyBoosterFilter: applyBoosterFilter,
  applyModelFilter: applyModelFilter,
  extraChipForFilter: extraChipForFilter,
  normalizeBoosterStatus: normalizeBoosterStatus,
  buildModelCards: buildModelCards,
  STATUS_TEXT_MAP: STATUS_TEXT_MAP,
  TAB_PREVIEW_COUNT: TAB_PREVIEW_COUNT
}
