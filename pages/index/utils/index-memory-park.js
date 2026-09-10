/**
 * 首页是 Tab，切走也不会 onUnload。日历 / 轮播仍占原生节点和 setData 树，
 * 是 We 分析「主动回收」的主要常驻开销。切走时把重列表卸到实例上，回来再灌回去。
 */
const HEAVY_KEYS = [
  'calendarAllMissions',
  'calendarDays',
  'calendarMapEntryList',
  'expandedDateMissions',
  'carouselItems',
  'carouselImages'
]

const SPLASH_KEYS = ['splashConfig', 'splashNotice', 'splashMission', 'splashMissionCd']

function emptyValue(key) {
  if (String(key).indexOf('splash') === 0) return null
  return []
}

function readParkedOrData(page, key) {
  if (page && page._indexParked && Object.prototype.hasOwnProperty.call(page._indexParked, key)) {
    return page._indexParked[key]
  }
  return page && page.data ? page.data[key] : undefined
}

function resolveParkedRootKey(parked, k) {
  if (!parked || !k) return ''
  if (Object.prototype.hasOwnProperty.call(parked, k)) return k
  const roots = Object.keys(parked)
  for (let i = 0; i < roots.length; i++) {
    const pk = roots[i]
    if (k.indexOf(pk + '[') === 0 || k.indexOf(pk + '.') === 0) return pk
  }
  return ''
}

function applyPathToParked(parked, pathKey, value) {
  const m = /^([A-Za-z_][\w]*)(?:\[(\d+)\])?(?:\.(.+))?$/.exec(pathKey)
  if (!m) return false
  const root = m[1]
  if (!Object.prototype.hasOwnProperty.call(parked, root)) return false
  const idx = m[2] != null ? Number(m[2]) : -1
  const rest = m[3]
  if (idx < 0) {
    if (!rest) {
      parked[root] = value
      return true
    }
    const obj = parked[root] && typeof parked[root] === 'object' ? Object.assign({}, parked[root]) : {}
    obj[rest] = value
    parked[root] = obj
    return true
  }
  const arr = Array.isArray(parked[root]) ? parked[root].slice() : []
  if (!rest) {
    arr[idx] = value
    parked[root] = arr
    return true
  }
  const item = arr[idx] && typeof arr[idx] === 'object' ? Object.assign({}, arr[idx]) : {}
  item[rest] = value
  arr[idx] = item
  parked[root] = arr
  return true
}

function installIndexSetDataGuard(page) {
  if (!page || page._rawIndexSetData) return
  page._rawIndexSetData = page.setData.bind(page)
  page.setData = function (patch, cb) {
    if (page._indexParked && patch && typeof patch === 'object' && !Array.isArray(patch)) {
      const next = {}
      const keys = Object.keys(patch)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const root = resolveParkedRootKey(page._indexParked, k)
        if (root) {
          if (k === root) page._indexParked[k] = patch[k]
          else applyPathToParked(page._indexParked, k, patch[k])
        } else {
          next[k] = patch[k]
        }
      }
      patch = next
      if (!Object.keys(patch).length) {
        if (typeof cb === 'function') cb.call(page)
        return
      }
    }
    return page._rawIndexSetData(patch, cb)
  }
}

function parkIndexHeavyData(page) {
  if (!page || !page.data || page._indexParked) return false
  const parked = {}
  const patch = {}
  const take = (key) => {
    const val = page.data[key]
    const has = Array.isArray(val) ? val.length > 0 : !!val
    // 空列表也要占坑：冷启动很快切走时，后续 loadCarousel / 日历回填必须进副本
    parked[key] = has ? val : emptyValue(key)
    if (has) patch[key] = emptyValue(key)
  }
  for (let i = 0; i < HEAVY_KEYS.length; i++) take(HEAVY_KEYS[i])
  if (!page.data.splashVisible && !page.data.splashFading) {
    for (let j = 0; j < SPLASH_KEYS.length; j++) take(SPLASH_KEYS[j])
  }
  page._indexParked = parked
  if (Object.keys(patch).length) {
    const setter = page._rawIndexSetData || page.setData.bind(page)
    setter.call(page, patch)
  }
  return true
}

function unparkIndexHeavyData(page) {
  if (!page || !page._indexParked) return false
  const parked = page._indexParked
  page._indexParked = null
  const setter = page._rawIndexSetData || page.setData.bind(page)
  setter.call(page, parked)
  return true
}

function hintIndexGC() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.triggerGC === 'function') wx.triggerGC()
  } catch (e) {}
}

module.exports = {
  HEAVY_KEYS,
  SPLASH_KEYS,
  readParkedOrData,
  installIndexSetDataGuard,
  parkIndexHeavyData,
  unparkIndexHeavyData,
  hintIndexGC
}
