/**
 * 用户手动翻转朝向：按 slug 记在本地，下次打开同一型号沿用。
 * v2 同时记住上下 / 左右；读得到旧 v1 的上下标记。
 */
var STORE_KEY_LEGACY = 'r3d-stand-flip-v1'
var STORE_KEY = 'r3d-stand-flip-v2'

function normalizeSlug(slug) {
  return String(slug || '').trim().toLowerCase()
}

function asState(raw) {
  if (raw === 1 || raw === true) return { up: true, left: false }
  if (raw && typeof raw === 'object') {
    return { up: !!raw.up, left: !!raw.left }
  }
  return { up: false, left: false }
}

function readLegacyMap() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return {}
    var raw = wx.getStorageSync(STORE_KEY_LEGACY)
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}

function readMap() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return {}
    var raw = wx.getStorageSync(STORE_KEY)
    if (raw && typeof raw === 'object') return raw
  } catch (e) {}
  var legacy = readLegacyMap()
  var out = {}
  Object.keys(legacy).forEach(function (key) {
    if (legacy[key]) out[key] = { up: 1 }
  })
  return out
}

function writeMap(map) {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) return
    wx.setStorageSync(STORE_KEY, map && typeof map === 'object' ? map : {})
  } catch (e) {}
}

function getStandFlipState(slug) {
  var key = normalizeSlug(slug)
  if (!key) return { up: false, left: false }
  return asState(readMap()[key])
}

function setStandFlipState(slug, state) {
  var key = normalizeSlug(slug)
  if (!key) return { up: false, left: false }
  var next = { up: !!(state && state.up), left: !!(state && state.left) }
  var map = readMap()
  if (!next.up && !next.left) delete map[key]
  else {
    map[key] = {}
    if (next.up) map[key].up = 1
    if (next.left) map[key].left = 1
  }
  writeMap(map)
  return next
}

function getStandFlipPref(slug) {
  return getStandFlipState(slug).up
}

function setStandFlipPref(slug, flipped) {
  var cur = getStandFlipState(slug)
  cur.up = !!flipped
  return setStandFlipState(slug, cur).up
}

module.exports = {
  STORE_KEY,
  STORE_KEY_LEGACY,
  getStandFlipState,
  setStandFlipState,
  getStandFlipPref,
  setStandFlipPref
}
