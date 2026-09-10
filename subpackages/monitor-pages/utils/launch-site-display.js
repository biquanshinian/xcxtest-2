/**
 * utils/launch-site-display.js — 全球发射场分布共享展示层
 * 监控中心精简区块 / 独立图鉴页共用：
 *   - 加载 LL2 发射场（Location）全量列表（apiProxy ll2LocationList，本地缓存 24h）
 *   - 场地数据 → 展示卡片（名称主体、中文国家、卫星图兜底链、发射数角标）
 *   - 筛选 chip 生成（全部 / 活跃 / 各国家，数据驱动）与过滤、汇总统计
 */

var { getCachedMediaImage } = require('../../../utils/icon-cache.js')
var { optimizeImageUrl } = require('../../../utils/cos-url.js')
var { proxiedImageUrl } = require('../../../utils/ll2-image.js')
var { pickLocalized, zhField } = require('../../../utils/locale.js')
var { translateLocation } = require('../../../utils/space-terms-display.js')
var gallerySearch = require('./gallery-search.js')

var CACHE_KEY = '_launch_site_list_v4' // v4：国家名只读云端 countryNameZh
var CACHE_TTL = 24 * 60 * 60 * 1000
var TAB_PREVIEW_COUNT = 2
var PAD_CACHE_KEY_PREFIX = '_launch_site_pads_'
var PAD_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

function cachedImage(url) {
  if (!url) return ''
  // thumb：COS 静图走 imageMogr2 压缩（卡片仅 ~300rpx）；代理 URL 无图片扩展名会被自动跳过
  return getCachedMediaImage(url, 'thumb')
}

function remoteThumbImage(url) {
  if (!url) return ''
  if (/imageMogr2|ci-process=/i.test(url)) return url
  return optimizeImageUrl(url, 'thumb')
}

/** 中文/英文简称，补云端 nameZh 覆盖不到的口语检索 */
var SITE_SEARCH_ALIASES = {
  'Cape Canaveral SFS': '卡角|卡纳维拉尔|CCAFS|CCSFS',
  'Kennedy Space Center': '肯尼迪|KSC',
  'Vandenberg SFB': '范登堡|VAFB|VSFB',
  'SpaceX Starbase': '星舰基地|博卡奇卡|星堡|Starbase|Boca Chica',
  'Baikonur Cosmodrome': '拜科努尔',
  'Jiuquan Satellite Launch Center': '酒泉|东风',
  'Taiyuan Satellite Launch Center': '太原',
  'Xichang Satellite Launch Center': '西昌',
  'Wenchang Space Launch Site': '文昌',
  'Guiana Space Centre': '库鲁|圭亚那',
  'Tanegashima Space Center': '种子岛',
  'Rocket Lab Launch Complex 1': '马希亚|Mahia',
  'Wallops Flight Facility': '瓦勒普斯|Wallops',
  'Naro Space Center': '罗老',
  'Semnan Space Center': '塞姆南'
}

/** "Cape Canaveral SFS, FL, USA" → 主体名 "Cape Canaveral SFS" */
function mainSiteName(name) {
  var s = String(name || '').trim()
  var idx = s.indexOf(',')
  return idx > 0 ? s.slice(0, idx).trim() : s
}

function countryDisplayName(name) {
  return String(name || '').trim()
}

// ── 本地缓存（内存 + storage，TTL 24h） ──
var _mem = null

function _readCachedAsync() {
  if (_mem && _mem.ts && Date.now() - _mem.ts < CACHE_TTL) {
    return Promise.resolve(_mem.data)
  }
  return new Promise(function (resolve) {
    wx.getStorage({
      key: CACHE_KEY,
      success: function (res) {
        var raw = res.data
        if (raw && raw.ts && Date.now() - raw.ts < CACHE_TTL && Array.isArray(raw.data) && raw.data.length) {
          _mem = raw
          resolve(raw.data)
        } else {
          resolve(null)
        }
      },
      fail: function () { resolve(null) }
    })
  })
}

function _writeCached(list) {
  var payload = { data: list, ts: Date.now() }
  _mem = payload
  try {
    wx.setStorage({ key: CACHE_KEY, data: payload, fail: function () {} })
  } catch (e) {}
}

var _pending = null

/** 加载发射场全量列表（缓存命中即返回；miss 时走云函数并回填缓存） */
async function loadLaunchSiteList() {
  var cached = await _readCachedAsync()
  if (cached) return cached

  if (_pending) return _pending
  _pending = (async function () {
    var res = await wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'll2LocationList' }
    })
    var result = res && res.result
    if (!result || !result.success || !Array.isArray(result.data) || !result.data.length) {
      throw new Error((result && result.error) || 'launch site list empty')
    }
    _writeCached(result.data)
    return result.data
  })()
  try {
    return await _pending
  } finally {
    _pending = null
  }
}

/** 某发射场的工位（Pad）列表：本地缓存 7 天，miss 时走 apiProxy ll2PadList */
async function loadPadList(locationId) {
  var id = Number(locationId)
  if (!id) return []
  var key = PAD_CACHE_KEY_PREFIX + id
  var cached = await new Promise(function (resolve) {
    wx.getStorage({
      key: key,
      success: function (res) {
        var raw = res.data
        if (raw && raw.ts && Date.now() - raw.ts < PAD_CACHE_TTL && Array.isArray(raw.data)) {
          resolve(raw.data)
        } else {
          resolve(null)
        }
      },
      fail: function () { resolve(null) }
    })
  })
  if (cached) return cached

  var res = await wx.cloud.callFunction({
    name: 'apiProxy',
    data: { action: 'll2PadList', locationId: id }
  })
  var result = res && res.result
  if (!result || !result.success || !Array.isArray(result.data)) {
    throw new Error((result && result.error) || 'pad list load failed')
  }
  try {
    wx.setStorage({ key: key, data: { data: result.data, ts: Date.now() }, fail: function () {} })
  } catch (e) {}
  return result.data
}

/** 场地列表 → 展示卡片（按累计发射数倒序，云端已排序，本地兜底再排一次）
 * @param {{ imageCacheLimit?: number }} [options] 仅前 N 条（排序后）触发图缓存预热
 */
function buildLaunchSiteCards(list, options) {
  var imageCacheLimit = (options && options.imageCacheLimit != null)
    ? options.imageCacheLimit
    : Number.MAX_SAFE_INTEGER
  var cards = (list || []).map(function (loc) {
    var main = mainSiteName(loc.name)
    var chain = []
    ;[proxiedImageUrl(loc.mapImage), loc.mapImage, proxiedImageUrl(loc.imageUrl), loc.imageUrl].forEach(function (u) {
      if (u && chain.indexOf(u) < 0) chain.push(u)
    })
    return {
      id: loc.id,
      name: main,
      nameZh: pickLocalized(loc.nameZh || '', '') || translateLocation(loc.name) || loc.nameZh || '',
      fullName: loc.name || '',
      countryName: loc.countryName || '',
      countryLabel: loc.countryNameZh || loc.countryName || '',
      countryCode: loc.countryCode || '',
      active: !!loc.active,
      statusText: loc.active ? '活跃' : '停用',
      latitude: loc.latitude,
      longitude: loc.longitude,
      description: loc.description || '',
      descriptionZh: zhField(loc, 'description') || '',
      timezoneName: loc.timezoneName || '',
      totalLaunchCount: Number(loc.totalLaunchCount) || 0,
      totalLandingCount: Number(loc.totalLandingCount) || 0,
      searchText: gallerySearch.joinSearchText([
        main,
        loc.nameZh || '',
        loc.name || '',
        loc.countryName || '',
        loc.countryNameZh || '',
        loc.countryCode || '',
        loc.active ? '活跃|active' : '停用|retired|inactive',
        SITE_SEARCH_ALIASES[main] || ''
      ]),
      _imageChain: chain
    }
  })
  cards.sort(function (a, b) { return b.totalLaunchCount - a.totalLaunchCount })
  for (var i = 0; i < cards.length; i++) {
    var chain = cards[i]._imageChain || []
    cards[i].imageUrl = i < imageCacheLimit ? cachedImage(chain[0]) : remoteThumbImage(chain[0])
    cards[i].imageFallbacks = chain.slice(1)
    delete cards[i]._imageChain
  }
  return cards
}

/**
 * 生成筛选 chip：全部 / 活跃 / 各国家（按发射场数量降序，数据驱动）
 * chip.id 约定：'all' | 'active' | 'country:United States of America'
 */
function buildLaunchSiteFilterChips(cards, options) {
  var maxCountryChips = (options && options.maxCountryChips) || 8
  var chips = [{ id: 'all', label: '全部' }, { id: 'active', label: '活跃' }]
  var count = {}
  var labels = {}
  for (var i = 0; i < (cards || []).length; i++) {
    var c = cards[i].countryName
    if (c) {
      count[c] = (count[c] || 0) + 1
      if (cards[i].countryLabel) labels[c] = cards[i].countryLabel
    }
  }
  var names = Object.keys(count).sort(function (a, b) { return count[b] - count[a] })
  for (var j = 0; j < names.length && j < maxCountryChips; j++) {
    chips.push({ id: 'country:' + names[j], label: labels[names[j]] || names[j] })
  }
  return chips
}

/** 按 chip id 过滤卡片 */
function applyLaunchSiteFilter(cards, filterId) {
  if (!filterId || filterId === 'all') return (cards || []).slice()
  return (cards || []).filter(function (c) {
    if (filterId === 'active') return c.active
    if (filterId.indexOf('country:') === 0) {
      var key = filterId.slice(8)
      return c.countryName === key || c.countryLabel === key || c.countryCode === key
    }
    return true
  })
}

function extraChipForFilter(filterId) {
  if (!filterId || filterId === 'all') return null
  if (filterId === 'active') return { id: 'active', label: '活跃' }
  if (filterId.indexOf('country:') === 0) {
    return { id: filterId, label: countryDisplayName(filterId.slice(8)) }
  }
  return { id: filterId, label: filterId }
}

/** 汇总统计（发射场总数 / 活跃数 / 覆盖国家数 / 累计发射） */
function computeLaunchSiteStats(cards) {
  var activeCount = 0
  var countrySet = {}
  var totalLaunches = 0
  for (var i = 0; i < (cards || []).length; i++) {
    var c = cards[i]
    if (c.active) activeCount++
    if (c.countryName) countrySet[c.countryName] = true
    totalLaunches += c.totalLaunchCount
  }
  return {
    siteCount: (cards || []).length,
    activeCount: activeCount,
    countryCount: Object.keys(countrySet).length,
    totalLaunches: totalLaunches
  }
}

module.exports = {
  cachedImage: cachedImage,
  proxiedImageUrl: proxiedImageUrl,
  mainSiteName: mainSiteName,
  countryDisplayName: countryDisplayName,
  loadLaunchSiteList: loadLaunchSiteList,
  loadPadList: loadPadList,
  buildLaunchSiteCards: buildLaunchSiteCards,
  buildLaunchSiteFilterChips: buildLaunchSiteFilterChips,
  applyLaunchSiteFilter: applyLaunchSiteFilter,
  extraChipForFilter: extraChipForFilter,
  computeLaunchSiteStats: computeLaunchSiteStats,
  TAB_PREVIEW_COUNT: TAB_PREVIEW_COUNT
}
