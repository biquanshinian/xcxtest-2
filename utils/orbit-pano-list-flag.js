/**
 * 列表卡「有环绕全景」标记：与详情页 pickOrbitPanoItem 同一套对齐。
 * 过审总闸关闭或读不到配置时不打标（failClosed）。
 */
const { pickOrbitPanoItem } = require('./rocket-name-i18n.js')
const { getCachedMainConfig } = require('./feature-flags.js')

function orbitPanoConfigOn(cfg) {
  if (!cfg) return false
  if (cfg.enableOrbitPano === false || cfg.orbitPanoEnabled === false) return false
  return true
}

function safePickOrbitPano(items, mission) {
  try {
    return !!pickOrbitPanoItem(items, mission)
  } catch (e) {
    return false
  }
}

function missionHasOrbitPano(mission) {
  if (!mission) return false
  try {
    const cfg = getCachedMainConfig()
    if (!cfg || !orbitPanoConfigOn(cfg)) return false
    const items = Array.isArray(cfg.orbitPanoItems) ? cfg.orbitPanoItems : []
    return safePickOrbitPano(items, mission)
  } catch (e) {
    return false
  }
}

function applyOrbitPanoFlags(list) {
  if (!Array.isArray(list)) return list
  try {
    const cfg = getCachedMainConfig()
    const on = !!(cfg && orbitPanoConfigOn(cfg))
    const items = on && Array.isArray(cfg.orbitPanoItems) ? cfg.orbitPanoItems : []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m) continue
      try {
        m.hasOrbitPano = !!(on && safePickOrbitPano(items, m))
      } catch (e) {}
    }
  } catch (e) {}
  return list
}

function buildOrbitPanoFlagPatch(list, prefix) {
  const patch = {}
  if (!Array.isArray(list) || !prefix) return patch
  try {
    const cfg = getCachedMainConfig()
    const on = !!(cfg && orbitPanoConfigOn(cfg))
    const items = on && Array.isArray(cfg.orbitPanoItems) ? cfg.orbitPanoItems : []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m) continue
      const next = !!(on && safePickOrbitPano(items, m))
      if (!!m.hasOrbitPano !== next) {
        m.hasOrbitPano = next
        patch[prefix + '[' + i + '].hasOrbitPano'] = next
      }
    }
  } catch (e) {}
  return patch
}

module.exports = {
  missionHasOrbitPano,
  applyOrbitPanoFlags,
  buildOrbitPanoFlagPatch
}
