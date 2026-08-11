/**
 * 统一收藏：发射商 / 任务 / 助推器 / 飞船 / 发射场 / 硬件 / 图鉴入口
 * 基于 user-growth preferences，随 savePreferences 云同步。
 *
 * 条目：{ type, id, title, subtitle, imageUrl, extra, category, route, ts }
 * category 用于详情页分组（collection 归入对应业务分类）
 */
const { loadPreferences, savePreferences } = require('./user-growth.js')
const { ROUTES } = require('./routes.js')

const MAX_FAVORITES = 80

/** @type {Record<string, { label: string, order: number }>} */
const CATEGORIES = {
  agency: { label: '发射商', order: 1 },
  mission: { label: '发射任务', order: 2 },
  booster: { label: '可回收火箭', order: 3 },
  spacecraft: { label: '飞船', order: 4 },
  launch_site: { label: '发射场', order: 5 },
  hardware: { label: '星舰硬件', order: 6 }
}

/** 图鉴/列表页可收藏入口 */
const COLLECTION_DEFS = {
  booster_genealogy: {
    category: 'booster',
    title: '全球可回收火箭族谱',
    subtitle: '图鉴入口',
    route: ROUTES.BOOSTER_GENEALOGY
  },
  spacecraft_gallery: {
    category: 'spacecraft',
    title: '全球飞船图鉴',
    subtitle: '图鉴入口',
    route: ROUTES.SPACECRAFT_GALLERY
  },
  launch_site_gallery: {
    category: 'launch_site',
    title: '全球发射场图鉴',
    subtitle: '图鉴入口',
    route: ROUTES.LAUNCH_SITE_GALLERY
  },
  launch_site_map: {
    category: 'launch_site',
    title: '全球发射场分布',
    subtitle: '地图入口',
    route: ROUTES.LAUNCH_SITE_MAP
  },
  hardware_list: {
    category: 'hardware',
    title: '星舰硬件设施',
    subtitle: '列表入口',
    route: ROUTES.HARDWARE_LIST
  }
}

function _key(type, id) {
  return String(type || '') + '::' + String(id == null ? '' : id)
}

function _migrateAgencies(list, agencies) {
  if (!Array.isArray(agencies) || !agencies.length) return list
  const map = {}
  list.forEach((f) => {
    if (f && f.type && f.id != null) map[_key(f.type, f.id)] = true
  })
  agencies.forEach((a) => {
    if (!a || a.id == null) return
    const k = _key('agency', a.id)
    if (map[k]) return
    list.push({
      type: 'agency',
      id: a.id,
      title: a.name || '',
      subtitle: a.typeName || a.abbrev || '',
      imageUrl: a.logoUrl || '',
      category: 'agency',
      route: '',
      extra: { abbrev: a.abbrev || '', typeName: a.typeName || '', logoUrl: a.logoUrl || '' },
      ts: Number(a.ts) || Date.now()
    })
    map[k] = true
  })
  return list
}

function _readRawList() {
  const prefs = loadPreferences() || {}
  let list = Array.isArray(prefs.favorites) ? prefs.favorites.slice() : []
  list = list.filter((f) => f && f.type && f.id != null)
  // 一次性把旧 favoriteAgencies 迁入
  if (Array.isArray(prefs.favoriteAgencies) && prefs.favoriteAgencies.length) {
    const before = list.length
    list = _migrateAgencies(list, prefs.favoriteAgencies)
    if (list.length !== before) {
      prefs.favorites = list
      // 同步回写旧字段，保持发射商列表可读
      prefs.favoriteAgencies = list
        .filter((f) => f.type === 'agency')
        .map((f) => ({
          id: f.id,
          name: f.title || '',
          abbrev: (f.extra && f.extra.abbrev) || '',
          logoUrl: f.imageUrl || (f.extra && f.extra.logoUrl) || '',
          typeName: (f.extra && f.extra.typeName) || f.subtitle || '',
          ts: f.ts || 0
        }))
      savePreferences(prefs)
    }
  }
  return list
}

function _writeList(list) {
  const prefs = loadPreferences() || {}
  const next = Array.isArray(list) ? list : []
  prefs.favorites = next
  prefs.favoriteAgencies = next
    .filter((f) => f.type === 'agency')
    .map((f) => ({
      id: f.id,
      name: f.title || '',
      abbrev: (f.extra && f.extra.abbrev) || '',
      logoUrl: f.imageUrl || (f.extra && f.extra.logoUrl) || '',
      typeName: (f.extra && f.extra.typeName) || f.subtitle || '',
      ts: f.ts || 0
    }))
  savePreferences(prefs)
}

function getFavorites() {
  return _readRawList().slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

function getFavoritesByCategory(category) {
  return getFavorites().filter((f) => (f.category || f.type) === category)
}

function isFavorite(type, id) {
  if (!type || id == null) return false
  const k = _key(type, id)
  return _readRawList().some((f) => _key(f.type, f.id) === k)
}

/**
 * @param {Object} item
 * @param {string} item.type
 * @param {string|number} item.id
 * @param {string} [item.title]
 * @param {string} [item.subtitle]
 * @param {string} [item.imageUrl]
 * @param {string} [item.category]
 * @param {string} [item.route]
 * @param {Object} [item.extra]
 * @returns {boolean} 切换后是否已收藏
 */
function toggleFavorite(item) {
  if (!item || !item.type || item.id == null) return false
  const list = _readRawList()
  const k = _key(item.type, item.id)
  const idx = list.findIndex((f) => _key(f.type, f.id) === k)
  let favorited
  if (idx >= 0) {
    list.splice(idx, 1)
    favorited = false
  } else {
    const category = item.category || (item.type === 'collection'
      ? ((COLLECTION_DEFS[item.id] && COLLECTION_DEFS[item.id].category) || 'agency')
      : item.type)
    list.push({
      type: item.type,
      id: item.id,
      title: item.title || '',
      subtitle: item.subtitle || '',
      imageUrl: item.imageUrl || '',
      category,
      route: item.route || '',
      extra: item.extra && typeof item.extra === 'object' ? item.extra : {},
      ts: Date.now()
    })
    if (list.length > MAX_FAVORITES) {
      list.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      list.splice(0, list.length - MAX_FAVORITES)
    }
    favorited = true
  }
  _writeList(list)
  return favorited
}

function removeFavorite(type, id) {
  if (!type || id == null) return
  const list = _readRawList()
  const k = _key(type, id)
  const next = list.filter((f) => _key(f.type, f.id) !== k)
  if (next.length === list.length) return
  _writeList(next)
}

function toggleCollection(collectionId) {
  const def = COLLECTION_DEFS[collectionId]
  if (!def) return false
  return toggleFavorite({
    type: 'collection',
    id: collectionId,
    title: def.title,
    subtitle: def.subtitle,
    imageUrl: '',
    category: def.category,
    route: def.route
  })
}

function isCollectionFavorite(collectionId) {
  return isFavorite('collection', collectionId)
}

/** 按分类分组（仅非空），供收藏详情页 */
function getGroupedFavorites() {
  const all = getFavorites()
  const buckets = {}
  all.forEach((f) => {
    const cat = f.category || f.type
    if (!CATEGORIES[cat]) return
    if (!buckets[cat]) buckets[cat] = []
    buckets[cat].push(f)
  })
  return Object.keys(CATEGORIES)
    .sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order)
    .filter((k) => buckets[k] && buckets[k].length)
    .map((k) => ({
      key: k,
      label: CATEGORIES[k].label,
      count: buckets[k].length,
      items: buckets[k].map((f) => Object.assign({}, f, { _key: _key(f.type, f.id) }))
    }))
}

function resolveFavoriteUrl(item) {
  if (!item) return ''
  if (item.type === 'collection') {
    const def = COLLECTION_DEFS[item.id]
    return (item.route || (def && def.route) || '') + ''
  }
  if (item.route) return item.route
  const id = encodeURIComponent(item.id)
  switch (item.type) {
    case 'agency':
      return ROUTES.AGENCY_DETAIL + '?id=' + id
    case 'mission': {
      const t = (item.extra && item.extra.missionType) || 'upcoming'
      return ROUTES.MISSION_DETAIL + '?id=' + id + '&type=' + encodeURIComponent(t)
    }
    case 'booster':
      return ROUTES.BOOSTER_DETAIL + '?serial=' + id
    case 'spacecraft':
      return ROUTES.SPACECRAFT_DETAIL + '?id=' + id
    case 'launch_site':
      return ROUTES.LAUNCH_SITE_DETAIL + '?id=' + id
    case 'hardware':
      return ROUTES.HARDWARE_DETAIL + '?id=' + id
    default:
      return ''
  }
}

function getFavoriteCount() {
  return _readRawList().length
}

module.exports = {
  CATEGORIES,
  COLLECTION_DEFS,
  MAX_FAVORITES,
  getFavorites,
  getFavoritesByCategory,
  getGroupedFavorites,
  getFavoriteCount,
  isFavorite,
  toggleFavorite,
  removeFavorite,
  toggleCollection,
  isCollectionFavorite,
  resolveFavoriteUrl
}
