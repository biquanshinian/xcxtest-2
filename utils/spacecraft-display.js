/**
 * utils/spacecraft-display.js — 全球飞船图鉴共享展示层
 * 监控中心精简区块 / 独立图鉴页共用：
 *   - 加载 LL2 飞船构型全量列表（apiProxy ll2SpacecraftList，本地缓存 24h）
 *   - 构型数据 → 展示卡片（类型中文、机构显示名、图片兜底链）
 *   - 筛选 chip 生成（全部 / 现役 / 各类型，数据驱动）与过滤、汇总统计
 */

var { mfrDisplayName } = require('./booster-display.js')
var { translateAgencyName } = require('./space-terms-i18n.js')
var { workerProxyUrl } = require('./config.js')
var { getCachedMediaImage } = require('./icon-cache.js')

var CACHE_KEY = '_spacecraft_list_v1'
var CACHE_TTL = 24 * 60 * 60 * 1000

/** 自有 COS / 云存储 CDN 域名：已是国内节点，无需再包 Worker 代理 */
function isOwnCdnUrl(url) {
  var s = String(url || '')
  return /^cloud:\/\//i.test(s) ||
    s.indexOf('.myqcloud.com/') !== -1 ||
    s.indexOf('.tcb.qcloud.la/') !== -1
}

/**
 * LL2 图床（DigitalOcean Spaces）国内直连大概率超时/失败，
 * 首选走 Cloudflare Worker 图片代理（GET /image?url=...，24h 边缘缓存），直连仅作兜底；
 * 云端已镜像到 COS 的 URL 直接返回（syncImageMirror 定时任务产出）
 */
function proxiedImageUrl(url) {
  if (!url) return ''
  if (isOwnCdnUrl(url)) return url
  var base = String(workerProxyUrl || '').trim().replace(/\/$/, '')
  if (!base) return ''
  return base + '/image?url=' + encodeURIComponent(url)
}

/**
 * 图片本地缓存：命中返回 wxfile:// 本地路径，未命中先展示远程 URL 并后台落盘，
 * 下次进入直接读本地，避免频繁走网络。preset=none：代理 URL 带 query，不做万象二次处理
 */
function cachedImage(url) {
  if (!url) return ''
  return getCachedMediaImage(url, 'none')
}

/** LL2 飞船类型 → 中文（未命中回退英文原文，数据驱动兜底） */
var TYPE_ZH_MAP = {
  'Capsule': '太空舱',
  'Cargo': '货运飞船',
  'Spaceplane': '航天飞机',
  'Space Station': '空间站',
  'Station': '空间站',
  'Tug': '太空拖船',
  'Lander': '着陆器',
  'Unknown': '未知'
}

function typeDisplayName(name) {
  if (!name) return ''
  return TYPE_ZH_MAP[name] || name
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

/** 加载飞船构型全量列表（缓存命中即返回；miss 时走云函数并回填缓存） */
async function loadSpacecraftList() {
  var cached = await _readCachedAsync()
  if (cached) return cached

  if (_pending) return _pending
  _pending = (async function () {
    var res = await wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'll2SpacecraftList' }
    })
    var result = res && res.result
    if (!result || !result.success || !Array.isArray(result.data) || !result.data.length) {
      throw new Error((result && result.error) || 'spacecraft list empty')
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

/** 构型列表 → 展示卡片（现役优先，同状态按名称字母序） */
function buildSpacecraftCards(list) {
  var cards = (list || []).map(function (s) {
    // 多级兜底链（binderror 逐级切换）：代理缩略图 → 缩略图直连 → 代理原图 → 原图直连
    var chain = []
    ;[proxiedImageUrl(s.imageUrl), s.imageUrl, proxiedImageUrl(s.fullImageUrl), s.fullImageUrl].forEach(function (u) {
      if (u && chain.indexOf(u) < 0) chain.push(u)
    })
    return {
      id: s.id,
      name: s.name || '',
      typeName: s.typeName || '',
      typeLabel: typeDisplayName(s.typeName),
      agencyName: s.agencyName || '',
      // 中文名与发射商详情页同源（AGENCY_ZH 词典），未收录回退厂商简表再回退原文
      agencyLabel: translateAgencyName(s.agencyName, s.agencyAbbrev) || mfrDisplayName(s.agencyName || ''),
      agencyAbbrev: s.agencyAbbrev || '',
      inUse: !!s.inUse,
      statusText: s.inUse ? '现役' : '退役',
      // 首选图走本地缓存（命中秒开）；兜底链保持远程原样，切换时再按需缓存
      imageUrl: cachedImage(chain[0]),
      imageFallbacks: chain.slice(1)
    }
  })
  cards.sort(function (a, b) {
    if (a.inUse !== b.inUse) return a.inUse ? -1 : 1
    return String(a.name).localeCompare(String(b.name))
  })
  return cards
}

/**
 * 生成筛选 chip：全部 / 现役 / 各类型（按数量降序，数据驱动）
 * chip.id 约定：'all' | 'inuse' | 'type:Capsule'
 */
function buildSpacecraftFilterChips(cards, options) {
  var maxTypeChips = (options && options.maxTypeChips) || 6
  var chips = [{ id: 'all', label: '全部' }, { id: 'inuse', label: '现役' }]
  var typeCount = {}
  for (var i = 0; i < (cards || []).length; i++) {
    var t = cards[i].typeName
    if (t) typeCount[t] = (typeCount[t] || 0) + 1
  }
  var names = Object.keys(typeCount).sort(function (a, b) { return typeCount[b] - typeCount[a] })
  for (var j = 0; j < names.length && j < maxTypeChips; j++) {
    chips.push({ id: 'type:' + names[j], label: typeDisplayName(names[j]) })
  }
  return chips
}

/**
 * 生成机构筛选 chip（按飞船数量降序，数据驱动：LL2 新增机构自动出现）
 * chip.id 约定：'agency:<agencyName 原文>'，label 用中文显示名
 */
function buildSpacecraftAgencyChips(cards, options) {
  var maxChips = (options && options.maxChips) || 20
  var count = {}
  var labels = {}
  for (var i = 0; i < (cards || []).length; i++) {
    var a = cards[i].agencyName
    if (!a) continue
    count[a] = (count[a] || 0) + 1
    if (!labels[a]) labels[a] = cards[i].agencyLabel || a
  }
  var names = Object.keys(count).sort(function (x, y) {
    return count[y] - count[x] || String(labels[x]).localeCompare(String(labels[y]))
  })
  return names.slice(0, maxChips).map(function (n) {
    return { id: 'agency:' + n, label: labels[n], count: count[n] }
  })
}

/** 按 chip id 过滤卡片 */
function applySpacecraftFilter(cards, filterId) {
  if (!filterId || filterId === 'all') return (cards || []).slice()
  return (cards || []).filter(function (c) {
    if (filterId === 'inuse') return c.inUse
    if (filterId.indexOf('type:') === 0) return c.typeName === filterId.slice(5)
    if (filterId.indexOf('agency:') === 0) return c.agencyName === filterId.slice(7)
    return true
  })
}

/** 汇总统计（现役 / 类型数 / 机构数） */
function computeSpacecraftStats(cards) {
  var inUseCount = 0
  var typeSet = {}
  var agencySet = {}
  for (var i = 0; i < (cards || []).length; i++) {
    var c = cards[i]
    if (c.inUse) inUseCount++
    if (c.typeName) typeSet[c.typeName] = true
    if (c.agencyName) agencySet[c.agencyName] = true
  }
  return {
    inUseCount: inUseCount,
    typeCount: Object.keys(typeSet).length,
    agencyCount: Object.keys(agencySet).length
  }
}

module.exports = {
  typeDisplayName: typeDisplayName,
  cachedImage: cachedImage,
  proxiedImageUrl: proxiedImageUrl,
  loadSpacecraftList: loadSpacecraftList,
  buildSpacecraftCards: buildSpacecraftCards,
  buildSpacecraftFilterChips: buildSpacecraftFilterChips,
  buildSpacecraftAgencyChips: buildSpacecraftAgencyChips,
  applySpacecraftFilter: applySpacecraftFilter,
  computeSpacecraftStats: computeSpacecraftStats
}
