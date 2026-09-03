/**
 * 用户手动翻转朝向：按 slug 记在本地，下次打开同一型号沿用。
 */
var STORE_KEY = 'r3d-stand-flip-v1'

function normalizeSlug(slug) {
  return String(slug || '').trim().toLowerCase()
}

function readMap() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return {}
    var raw = wx.getStorageSync(STORE_KEY)
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}

function writeMap(map) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return
    wx.setStorageSync(STORE_KEY, map && typeof map === 'object' ? map : {})
  } catch (e) {}
}

function getStandFlipPref(slug) {
  var key = normalizeSlug(slug)
  if (!key) return false
  return !!readMap()[key]
}

function setStandFlipPref(slug, flipped) {
  var key = normalizeSlug(slug)
  if (!key) return false
  var map = readMap()
  if (flipped) map[key] = 1
  else delete map[key]
  writeMap(map)
  return !!flipped
}

module.exports = {
  STORE_KEY,
  getStandFlipPref,
  setStandFlipPref
}
