/**
 * 任务详情分包内的 3D 入口门控。
 * 只认后台 media_assets 已启用的 models/rockets/{slug}.glb；停用/删除后入口必须消失。
 */
const { resolveSlug, isLongMarchFamilyName, SERIES_SLUG } = require('../../../utils/rocket-3d-slug.js')
const ready = require('../../../utils/rocket-3d-ready.js')

function firstSlug(input) {
  const src = input && typeof input === 'object' ? input : {}
  const names = [src.rocketNameEn, src.rocketName, src.configuration]
  let seriesFallback = ''
  for (let i = 0; i < names.length; i++) {
    const slug = resolveSlug(names[i])
    if (slug) return slug
    if (!seriesFallback && isLongMarchFamilyName(names[i])) seriesFallback = SERIES_SLUG
  }
  return seriesFallback
}

function hasReadyRocketModel(input) {
  const slug = firstSlug(input)
  return !!slug && !!ready.getReadyUrl(slug)
}

function resolveReadyModelUrl(input) {
  const slug = firstSlug(input)
  return slug ? ready.getReadyUrl(slug) : ''
}

module.exports = {
  hasReadyRocketModel,
  resolveReadyModelUrl
}
