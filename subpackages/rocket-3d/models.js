/**
 * 火箭 3D 模型映射：型号名 → COS GLB。
 * 上传约定：models/rockets/{slug}.glb
 * 只认后台 media_assets 已启用条目；运营停用/删除后不再显示。
 */
const { resolveCosHttpsUrl } = require('../../utils/cos-url.js')
const {
  MODEL_PREFIX,
  SERIES_SLUG,
  normalizeRocketKey,
  resolveSlug,
  isLongMarchFamilyName,
  isValidRocket3dSlug
} = require('../../utils/rocket-3d-slug.js')
const ready = require('../../utils/rocket-3d-ready.js')

const READY_SLUGS = {}

function isSlugReady(slug) {
  return !!slug && !!ready.getReadyUrl(slug)
}

function buildGlbUrl(slug) {
  const fromCloud = ready.getReadyUrl(slug)
  if (fromCloud) return resolveCosHttpsUrl(fromCloud) || fromCloud
  return ''
}

function firstNonEmpty(list) {
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || '').trim()
    if (s) return s
  }
  return ''
}

function resolveRocketModel(input) {
  const src = input && typeof input === 'object' ? input : {}
  const label = firstNonEmpty([src.rocketNameEn, src.rocketName, src.configuration])
  const names = [src.rocketNameEn, src.rocketName, src.configuration]
  let slug = ''
  const pinned = String(src.slug || '').trim().toLowerCase()
  if (pinned && isValidRocket3dSlug(pinned)) slug = pinned
  for (let i = 0; !slug && i < names.length; i++) {
    slug = resolveSlug(names[i])
  }
  if (!slug) {
    for (let i = 0; i < names.length; i++) {
      if (isLongMarchFamilyName(names[i])) {
        slug = SERIES_SLUG
        break
      }
    }
  }
  if (!isSlugReady(slug)) {
    return { slug, url: '', source: 'none', label, series: false }
  }
  const explicit = String(src.modelUrl || '').trim()
  const urlSlugMatch = /models\/rockets\/([a-z0-9]+(?:-[a-z0-9]+)*)\.glb/i.exec(explicit)
  const urlSlug = urlSlugMatch ? urlSlugMatch[1].toLowerCase() : ''
  if (pinned && urlSlug && urlSlug !== pinned) {
    const own = buildGlbUrl(pinned)
    if (!own) return { slug: pinned, url: '', source: 'none', label, series: false }
    return {
      slug: pinned,
      url: own,
      source: 'glb',
      label,
      series: ready.isSeriesModel(pinned)
    }
  }
  if (/^https:\/\//i.test(explicit)) {
    return {
      slug,
      url: resolveCosHttpsUrl(explicit) || explicit,
      source: 'glb',
      label,
      series: ready.isSeriesModel(slug) || /long-march-series\.glb/i.test(explicit)
    }
  }
  return {
    slug,
    url: buildGlbUrl(slug),
    source: 'glb',
    label,
    series: ready.isSeriesModel(slug)
  }
}

function hasReadyRocketModel(input) {
  const resolved = resolveRocketModel(input)
  return resolved.source === 'glb' && !!resolved.url
}

module.exports = {
  MODEL_PREFIX,
  READY_SLUGS,
  normalizeRocketKey,
  resolveSlug,
  buildGlbUrl,
  resolveRocketModel,
  hasReadyRocketModel
}
