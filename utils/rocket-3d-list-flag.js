/**
 * 列表卡「有 3D 模型」标记：与详情页 hasReadyRocketModel 同一套对齐。
 * media map 未 ingest / 该型号无已启用 GLB 时不打标（failClosed）。
 */
const { resolveSlug, isLongMarchFamilyName, SERIES_SLUG } = require('./rocket-3d-slug.js')
const ready = require('./rocket-3d-ready.js')

function configName(cfg) {
  if (!cfg) return ''
  if (typeof cfg === 'string') return cfg
  if (typeof cfg === 'object') return String(cfg.full_name || cfg.name || '').trim()
  return ''
}

function firstSlug(input) {
  const src = input && typeof input === 'object' ? input : {}
  const pack = src._langPack && typeof src._langPack === 'object' ? src._langPack : {}
  const names = [
    pack.rocketNameEn,
    src.rocketNameEn,
    src.rocketName,
    configName(src.rocketConfiguration || src.configuration)
  ]
  let seriesFallback = ''
  for (let i = 0; i < names.length; i++) {
    const slug = resolveSlug(names[i])
    if (slug) return slug
    if (!seriesFallback && isLongMarchFamilyName(names[i])) seriesFallback = SERIES_SLUG
  }
  return seriesFallback
}

function missionHasRocket3d(mission) {
  if (!mission) return false
  try {
    const slug = firstSlug(mission)
    return !!slug && !!ready.getReadyUrl(slug)
  } catch (e) {
    return false
  }
}

function applyRocket3dFlags(list) {
  if (!Array.isArray(list)) return list
  try {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m) continue
      try {
        m.hasRocket3d = missionHasRocket3d(m)
      } catch (e) {}
    }
  } catch (e) {}
  return list
}

function buildRocket3dFlagPatch(list, prefix) {
  const patch = {}
  if (!Array.isArray(list) || !prefix) return patch
  try {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m) continue
      const next = missionHasRocket3d(m)
      if (!!m.hasRocket3d !== next) {
        m.hasRocket3d = next
        patch[prefix + '[' + i + '].hasRocket3d'] = next
      }
    }
  } catch (e) {}
  return patch
}

module.exports = {
  missionHasRocket3d,
  applyRocket3dFlags,
  buildRocket3dFlagPatch
}
