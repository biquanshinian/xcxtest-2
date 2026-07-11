/**
 * 发射商收藏：基于 user-growth preferences 存储，免费获得云同步
 * （savePreferences 自动推 userDataGateway，syncAll 按 updatedAt 拉回）。
 * 存储形态：preferences.favoriteAgencies = [{ id, name, abbrev, logoUrl, typeName, ts }]
 */
const { loadPreferences, savePreferences } = require('./user-growth.js')

const MAX_FAVORITES = 50

function _readList() {
  const prefs = loadPreferences()
  const list = prefs && Array.isArray(prefs.favoriteAgencies) ? prefs.favoriteAgencies : []
  return list.filter(f => f && f.id != null)
}

/** 收藏列表（按收藏时间倒序，最新在前） */
function getFavoriteAgencies() {
  return _readList().slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

function isFavoriteAgency(id) {
  if (id == null) return false
  return _readList().some(f => String(f.id) === String(id))
}

/**
 * 切换收藏状态
 * @param {Object} agency { id, name, abbrev, logoUrl, typeName }
 * @returns {Boolean} 切换后是否为已收藏
 */
function toggleFavoriteAgency(agency) {
  if (!agency || agency.id == null) return false
  const prefs = loadPreferences()
  const list = Array.isArray(prefs.favoriteAgencies) ? prefs.favoriteAgencies : []
  const idx = list.findIndex(f => f && String(f.id) === String(agency.id))
  let favorited
  if (idx >= 0) {
    list.splice(idx, 1)
    favorited = false
  } else {
    list.push({
      id: agency.id,
      name: agency.name || '',
      abbrev: agency.abbrev || '',
      logoUrl: agency.logoUrl || '',
      typeName: agency.typeName || '',
      ts: Date.now()
    })
    // 上限 50 条防膨胀，超限时淘汰最早收藏
    if (list.length > MAX_FAVORITES) {
      list.sort((a, b) => (a.ts || 0) - (b.ts || 0))
      list.splice(0, list.length - MAX_FAVORITES)
    }
    favorited = true
  }
  prefs.favoriteAgencies = list
  savePreferences(prefs)
  return favorited
}

/** 按 id 移除收藏（我的太空移除按钮用） */
function removeFavoriteAgency(id) {
  if (id == null) return
  const prefs = loadPreferences()
  const list = Array.isArray(prefs.favoriteAgencies) ? prefs.favoriteAgencies : []
  const next = list.filter(f => !f || String(f.id) !== String(id))
  if (next.length === list.length) return
  prefs.favoriteAgencies = next
  savePreferences(prefs)
}

module.exports = {
  getFavoriteAgencies,
  isFavoriteAgency,
  toggleFavoriteAgency,
  removeFavoriteAgency
}
