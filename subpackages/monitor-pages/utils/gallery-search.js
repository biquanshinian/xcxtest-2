/**
 * 图鉴页共用：中英搜索归一化、chip 补齐、图片兜底推进
 * 不依赖 wx，可供 node:test 直接引用
 */

var ZH_NUM_PAIRS = [
  ['十二', '12'],
  ['十一', '11'],
  ['十', '10'],
  ['一', '1'],
  ['二', '2'],
  ['三', '3'],
  ['四', '4'],
  ['五', '5'],
  ['六', '6'],
  ['七', '7'],
  ['八', '8'],
  ['九', '9']
]

function expandZhNumerals(text) {
  var s = String(text || '')
  for (var i = 0; i < ZH_NUM_PAIRS.length; i++) {
    s = s.split(ZH_NUM_PAIRS[i][0]).join(ZH_NUM_PAIRS[i][1])
  }
  return s
}

/** 搜索归一：小写、去空白标点、中文数字→阿拉伯数字、甲乙丙丁→abcd、去掉「号」 */
function normalizeGalleryQuery(text) {
  var s = expandZhNumerals(String(text || '').toLowerCase())
  s = s.replace(/甲/g, 'a').replace(/乙/g, 'b').replace(/丙/g, 'c').replace(/丁/g, 'd')
  s = s.replace(/号/g, '')
  s = s.replace(/[\s\-_.·・/(),（）[\]【】|+]+/g, '')
  return s
}

function joinSearchText(parts) {
  var out = []
  var seen = {}
  for (var i = 0; i < (parts || []).length; i++) {
    var raw = String(parts[i] == null ? '' : parts[i]).trim()
    if (!raw) continue
    var chunks = raw.split('|')
    for (var j = 0; j < chunks.length; j++) {
      var piece = String(chunks[j] || '').trim()
      if (!piece) continue
      var key = piece.toLowerCase()
      if (seen[key]) continue
      seen[key] = true
      out.push(piece)
    }
  }
  return out.join('|')
}

/**
 * 按字段精确命中：keyword 归一后只要任一 searchText 分段包含即命中。
 * 分段用 | 分隔，避免跨字段误拼（如 falcon9 + spacex → 9s）。
 */
function matchGalleryQuery(searchText, keyword) {
  var q = normalizeGalleryQuery(keyword)
  if (!q) return true
  var parts = String(searchText || '').split('|')
  for (var i = 0; i < parts.length; i++) {
    var hay = normalizeGalleryQuery(parts[i])
    if (hay && hay.indexOf(q) >= 0) return true
  }
  return false
}

function cardSearchText(card) {
  if (!card) return ''
  if (card.searchText) return card.searchText
  return joinSearchText([
    card.serial, card.rocketFamily, card.rocketFamilyEn,
    card.fullName, card.fullNameEn, card.name, card.nameEn, card.nameZh,
    card.alias, card.variant, card.manufacturer, card.manufacturerZh,
    card.manufacturerDisplay, card.countryName, card.countryLabel, card.countryCode,
    card.statusText, card.status
  ])
}

function filterCardsByKeyword(cards, keyword) {
  if (!normalizeGalleryQuery(keyword)) return (cards || []).slice()
  return (cards || []).filter(function (card) {
    return matchGalleryQuery(cardSearchText(card), keyword)
  })
}

function ensureActiveChip(chips, filterId, chip) {
  var list = (chips || []).slice()
  if (!filterId || filterId === 'all') return list
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === filterId) return list
  }
  if (chip && chip.id) list.push(chip)
  return list
}

function isKnownGenealogyFilter(filterId) {
  var id = String(filterId || '')
  return id === 'all' || id === 'reusable' || id === 'expendable' ||
    id.indexOf('country:') === 0 || id.indexOf('mfr:') === 0
}

function isKnownLaunchSiteFilter(filterId) {
  var id = String(filterId || '')
  return id === 'all' || id === 'active' || id.indexOf('country:') === 0
}

function isKnownSpacecraftFilter(filterId) {
  var id = String(filterId || '')
  return id === 'all' || id === 'inuse' ||
    id.indexOf('type:') === 0 || id.indexOf('agency:') === 0
}

function findCardIndexByKey(list, field, id) {
  var rows = list || []
  var target = String(id == null ? '' : id)
  if (!target) return -1
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (row && String(row[field]) === target) return i
  }
  return -1
}

/** 沿兜底链前进一步；同对象引用会同步写回源列表 */
function advanceCardImage(card, resolveUrl) {
  if (!card) return false
  var fallbacks = card.imageFallbacks || []
  var next = fallbacks[0] || ''
  var url = next
  if (next && typeof resolveUrl === 'function') {
    url = resolveUrl(next) || next
  }
  card.thumbnailUrl = url
  card.imageUrl = url
  card.imageFallbacks = fallbacks.slice(1)
  return true
}

function pickPatchValue(patch, key, current) {
  if (patch && Object.prototype.hasOwnProperty.call(patch, key) && patch[key] != null) {
    return patch[key]
  }
  return current
}

function flightTime(value) {
  var t = Date.parse(value || '')
  return isNaN(t) ? 0 : t
}

function reusableRank(item) {
  return item && item.reusable === true ? 1 : 0
}

/**
 * 飞行次数 / 最近飞行排序。返回新数组，避免小程序 setData 对原地 sort 无感知。
 * 族谱页始终可复用优先：同组内再按次数或最近飞行。
 * @param {string} flightsKey 次数字段
 * @param {string} recentKey 日期字段
 */
function sortByFlightsOrRecent(list, sortBy, flightsKey, recentKey) {
  var rows = (list || []).slice()
  var fKey = flightsKey || 'flights'
  var rKey = recentKey || 'lastFlight'
  rows.sort(function (a, b) {
    var reuseDiff = reusableRank(b) - reusableRank(a)
    if (reuseDiff) return reuseDiff
    if (sortBy === 'recent') {
      var tb = flightTime(b && b[rKey])
      var ta = flightTime(a && a[rKey])
      if (tb !== ta) return tb - ta
      return ((b && b[fKey]) || 0) - ((a && a[fKey]) || 0)
    }
    var fb = (b && b[fKey]) || 0
    var fa = (a && a[fKey]) || 0
    if (fb !== fa) return fb - fa
    return flightTime(b && b[rKey]) - flightTime(a && a[rKey])
  })
  return rows
}

module.exports = {
  expandZhNumerals: expandZhNumerals,
  normalizeGalleryQuery: normalizeGalleryQuery,
  joinSearchText: joinSearchText,
  cardSearchText: cardSearchText,
  matchGalleryQuery: matchGalleryQuery,
  filterCardsByKeyword: filterCardsByKeyword,
  ensureActiveChip: ensureActiveChip,
  isKnownGenealogyFilter: isKnownGenealogyFilter,
  isKnownLaunchSiteFilter: isKnownLaunchSiteFilter,
  isKnownSpacecraftFilter: isKnownSpacecraftFilter,
  findCardIndexByKey: findCardIndexByKey,
  advanceCardImage: advanceCardImage,
  pickPatchValue: pickPatchValue,
  flightTime: flightTime,
  sortByFlightsOrRecent: sortByFlightsOrRecent
}
