/**
 * 火箭 3D 对齐绑定：族谱型号详情只绑「本型号自己的」专用 GLB。
 * 放在 monitor-pages 分包：主包 Tab 未引用会被「未使用 JS」扫描拦截。
 * 禁止长征全系列底模回落，禁止 Falcon 9 / Heavy、长五 / 长五 B 等近邻串位。
 */
const { resolveCosHttpsUrl } = require('../../../utils/cos-url.js')
const {
  SERIES_SLUG,
  normalizeRocketKey,
  resolveSlug,
  isValidRocket3dSlug
} = require('../../../utils/rocket-3d-slug.js')
const ready = require('../../../utils/rocket-3d-ready.js')

function firstText(list) {
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || '').trim()
    if (s) return s
  }
  return ''
}

function collectIdentityNames(input) {
  var src = input && typeof input === 'object' ? input : {}
  return [
    src.fullNameEn,
    src.full_name,
    src.nameEn,
    src.name,
    src.fullName,
    src.full_nameZh,
    src.nameZh,
    src.alias,
    src.rocketNameEn,
    src.rocketName,
    src.configuration
  ]
}

/** LL2 官方英文名：别名/中文不得反过来盖掉本页构型 */
function collectOfficialNames(input) {
  var src = input && typeof input === 'object' ? input : {}
  return [src.fullNameEn, src.full_name, src.nameEn, src.rocketNameEn]
}

function dedicatedSlugsFrom(names) {
  return collectResolvedSlugs(names).filter(function (slug) {
    return slug && slug !== SERIES_SLUG && ready.hasDedicatedUrl(slug)
  })
}

function collectResolvedSlugs(names) {
  var seen = []
  for (var i = 0; i < names.length; i++) {
    var slug = resolveSlug(names[i])
    if (!slug || seen.indexOf(slug) >= 0) continue
    seen.push(slug)
  }
  return seen
}

/** 多个候选 slug 时，按名称里出现的专有词选最贴的那个 */
function pickAlignedSlug(slugs, names) {
  if (!slugs.length) return ''
  if (slugs.length === 1) return slugs[0]
  var hay = names.map(normalizeRocketKey).filter(Boolean).join(' ')
  var best = slugs[0]
  var bestScore = -1
  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i]
    var tokens = slug.split('-').filter(function (t) {
      return t && t.length > 1 && t !== 'long' && t !== 'march'
    })
    var score = slug.length * 0.01
    for (var t = 0; t < tokens.length; t++) {
      if (hay.indexOf(tokens[t]) >= 0) score += tokens[t].length
    }
    if (score > bestScore) {
      bestScore = score
      best = slug
    }
  }
  return best
}

function emptyBind() {
  return { aligned: false, slug: '', url: '', series: false, label: '' }
}

/**
 * 族谱型号详情用：必须有专用 GLB，且 slug 与本页名称对齐。
 * 全系列底模一律不算对齐。
 */
function alignDedicatedRocket3d(input) {
  var official = collectOfficialNames(input)
  var names = official
  var slugs = dedicatedSlugsFrom(official)
  if (!slugs.length) {
    names = collectIdentityNames(input)
    slugs = dedicatedSlugsFrom(names)
  }
  if (!slugs.length) return emptyBind()
  var slug = pickAlignedSlug(slugs, names)
  if (!slug || slug === SERIES_SLUG || !ready.hasDedicatedUrl(slug)) return emptyBind()
  var url = ready.getReadyUrl(slug)
  if (!url || ready.isSeriesModel(slug)) return emptyBind()
  return {
    aligned: true,
    slug: slug,
    url: resolveCosHttpsUrl(url) || url,
    series: false,
    label: firstText(names)
  }
}

function hasAlignedDedicatedRocket3d(input) {
  return !!alignDedicatedRocket3d(input).aligned
}

/** 展陈页只取规格相关字段，避免把整份族谱档案塞进 globalData */
function pickExhibitConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null
  return {
    id: cfg.id,
    name: cfg.name,
    full_name: cfg.full_name,
    nameZh: cfg.nameZh,
    full_nameZh: cfg.full_nameZh,
    alias: cfg.alias,
    manufacturerName: cfg.manufacturerName,
    manufacturerNameZh: cfg.manufacturerNameZh,
    length: cfg.length,
    diameter: cfg.diameter,
    launch_mass: cfg.launch_mass,
    to_thrust: cfg.to_thrust,
    leo_capacity: cfg.leo_capacity,
    gto_capacity: cfg.gto_capacity,
    geo_capacity: cfg.geo_capacity,
    sso_capacity: cfg.sso_capacity,
    max_stage: cfg.max_stage,
    min_stage: cfg.min_stage,
    reusable: cfg.reusable,
    maiden_flight: cfg.maiden_flight,
    description: cfg.description,
    descriptionZh: cfg.descriptionZh,
    total_launch_count: cfg.total_launch_count
  }
}

function stashRocket3dSpecs(payload) {
  try {
    var app = getApp()
    if (app && app.globalData) app.globalData.pendingRocket3dSpecs = payload || null
  } catch (e) {}
}

function buildRocket3dNavUrl(bind, extra) {
  var src = extra && typeof extra === 'object' ? extra : {}
  var q = []
  var name = firstText([src.rocketName, bind && bind.label])
  var nameEn = firstText([src.rocketNameEn])
  var poster = String(src.poster || '').trim()
  var configId = src.configId != null ? String(src.configId).trim() : ''
  var slug = bind && bind.slug ? String(bind.slug) : ''
  var url = bind && bind.url ? String(bind.url) : ''
  if (name) q.push('name=' + encodeURIComponent(name))
  if (nameEn) q.push('nameEn=' + encodeURIComponent(nameEn))
  if (poster) q.push('poster=' + encodeURIComponent(poster))
  if (configId) q.push('configId=' + encodeURIComponent(configId))
  if (slug && isValidRocket3dSlug(slug)) q.push('slug=' + encodeURIComponent(slug))
  if (/^https:\/\//i.test(url)) q.push('modelUrl=' + encodeURIComponent(url))
  return '/subpackages/rocket-3d/viewer' + (q.length ? '?' + q.join('&') : '')
}

module.exports = {
  alignDedicatedRocket3d,
  hasAlignedDedicatedRocket3d,
  pickAlignedSlug,
  pickExhibitConfig,
  stashRocket3dSpecs,
  buildRocket3dNavUrl
}
