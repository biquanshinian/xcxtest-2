/**
 * 后台 media_assets 里已启用的 3D GLB（key = models/rockets/{slug}.glb）。
 * 由 image-config 在加载映射时写入，详情门控 / 3D 页只读。
 */
const { parseRocket3dGlbKey, isLongMarchMemberSlug, SERIES_SLUG } = require('./rocket-3d-slug.js')

let _urlBySlug = {}
let _creditBySlug = {}

function extractFromMediaMap(mediaMap) {
  const out = {}
  const map = mediaMap && typeof mediaMap === 'object' ? mediaMap : {}
  const keys = Object.keys(map)
  for (let i = 0; i < keys.length; i++) {
    const slug = parseRocket3dGlbKey(keys[i])
    const url = typeof map[keys[i]] === 'string' ? map[keys[i]].trim() : ''
    if (slug && url) out[slug] = url
  }
  return out
}

function extractCredits(credits) {
  const out = {}
  const src = credits && typeof credits === 'object' ? credits : {}
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    const slug = String(keys[i] || '').toLowerCase()
    const credit = String(src[keys[i]] || '').trim()
    if (slug && credit) out[slug] = credit
  }
  return out
}

function ingestMediaMap(mediaMap, credits) {
  _urlBySlug = extractFromMediaMap(mediaMap)
  if (credits && typeof credits === 'object') {
    _creditBySlug = extractCredits(credits)
  } else {
    const next = {}
    const slugs = Object.keys(_creditBySlug)
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i]
      if (_urlBySlug[slug]) next[slug] = _creditBySlug[slug]
    }
    _creditBySlug = next
  }
  return _urlBySlug
}

function getReadyUrl(slug) {
  const key = String(slug || '').toLowerCase()
  if (!key) return ''
  if (_urlBySlug[key]) return _urlBySlug[key]
  if (isLongMarchMemberSlug(key) && _urlBySlug[SERIES_SLUG]) return _urlBySlug[SERIES_SLUG]
  return ''
}

function hasDedicatedUrl(slug) {
  const key = String(slug || '').toLowerCase()
  return !!(key && _urlBySlug[key])
}

/** 实际播的是全系列底模（含长征成员回落到 long-march-series） */
function isSeriesModel(slug) {
  const key = String(slug || '').toLowerCase()
  if (!key) return false
  if (key === SERIES_SLUG) return true
  return isLongMarchMemberSlug(key) && !_urlBySlug[key] && !!_urlBySlug[SERIES_SLUG]
}

function getReadyCredit(slug) {
  const key = String(slug || '').toLowerCase()
  if (!key) return ''
  if (_creditBySlug[key]) return _creditBySlug[key]
  if (isLongMarchMemberSlug(key) && _creditBySlug[SERIES_SLUG]) return _creditBySlug[SERIES_SLUG]
  return ''
}

function getReadySlugs() {
  const out = {}
  const keys = Object.keys(_urlBySlug)
  for (let i = 0; i < keys.length; i++) out[keys[i]] = true
  return out
}

module.exports = {
  extractFromMediaMap,
  ingestMediaMap,
  getReadyUrl,
  getReadyCredit,
  getReadySlugs,
  hasDedicatedUrl,
  isSeriesModel
}
