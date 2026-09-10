/**
 * 后台 media_assets 里已启用的 IP / 车辆参照 GLB（key = models/reference/{slug}.glb）。
 * 由 image-config 写入，3D 页只读。
 */
const {
  MUSK_REAL_HEIGHT_M,
  IP_SLUGS,
  parseIpRefGlbKey,
  normalizeHighestPoint,
  defaultHighestPoint,
  isVehicleRef,
  normalizeLengthM,
  normalizeWidthM,
  getVehicleSpecs
} = require('./ip-scale-ref.js')

let _bySlug = {}

function extraDims(slug, src) {
  if (!isVehicleRef(slug)) return {}
  const spec = getVehicleSpecs(slug) || {}
  const item = src && typeof src === 'object' ? src : {}
  return {
    lengthM: normalizeLengthM(item.lengthM, spec.lengthM),
    widthM: normalizeWidthM(item.widthM, spec.widthM)
  }
}

function emptyFigure(slug) {
  const key = String(slug || '').toLowerCase()
  return Object.assign(
    {
      slug: key,
      url: '',
      highestPoint: defaultHighestPoint(key),
      enabled: false
    },
    extraDims(key, null)
  )
}

function extractFromMediaMap(mediaMap, extras) {
  const out = {}
  const map = mediaMap && typeof mediaMap === 'object' ? mediaMap : {}
  const extra = extras && typeof extras === 'object' ? extras : {}
  const keys = Object.keys(map)
  for (let i = 0; i < keys.length; i++) {
    const slug = parseIpRefGlbKey(keys[i])
    const url = typeof map[keys[i]] === 'string' ? map[keys[i]].trim() : ''
    if (!slug || !url) continue
    const meta = extra[slug] && typeof extra[slug] === 'object' ? extra[slug] : {}
    out[slug] = Object.assign(
      {
        slug: slug,
        url: url,
        highestPoint: normalizeHighestPoint(
          meta.highestPoint != null ? meta.highestPoint : extra[slug],
          defaultHighestPoint(slug)
        ),
        enabled: true
      },
      extraDims(slug, meta)
    )
  }
  return out
}

function mergeFromMediaMap(next, mediaMap, extras) {
  const fromMap = extractFromMediaMap(mediaMap, extras)
  Object.keys(fromMap).forEach((slug) => {
    if (!next[slug]) next[slug] = fromMap[slug]
  })
  return next
}

function ingest(payload) {
  if (payload && payload.ipScaleRefs && typeof payload.ipScaleRefs === 'object') {
    const next = {}
    const src = payload.ipScaleRefs
    Object.keys(src).forEach((raw) => {
      const slug = String(raw || '').toLowerCase()
      const item = src[raw] && typeof src[raw] === 'object' ? src[raw] : {}
      const url = typeof item.url === 'string' ? item.url.trim() : ''
      if (IP_SLUGS.indexOf(slug) < 0 || !url) return
      next[slug] = Object.assign(
        {
          slug: slug,
          url: url,
          highestPoint: normalizeHighestPoint(item.highestPoint, defaultHighestPoint(slug)),
          enabled: item.enabled !== false
        },
        extraDims(slug, item)
      )
    })
    _bySlug = mergeFromMediaMap(next, payload.mediaMap, payload.extras)
    return _bySlug
  }
  _bySlug = extractFromMediaMap(payload)
  return _bySlug
}

function ingestMediaMap(mediaMap, extras) {
  _bySlug = extractFromMediaMap(mediaMap, extras)
  return _bySlug
}

function getFigure(slug) {
  const key = String(slug || '').toLowerCase()
  return _bySlug[key] || emptyFigure(key)
}

function listEnabled() {
  const out = []
  for (let i = 0; i < IP_SLUGS.length; i++) {
    const item = _bySlug[IP_SLUGS[i]]
    if (item && item.url && item.enabled !== false) out.push(item)
  }
  return out
}

function listMissing() {
  const out = []
  for (let i = 0; i < IP_SLUGS.length; i++) {
    const item = _bySlug[IP_SLUGS[i]]
    if (!item || !item.url || item.enabled === false) out.push(IP_SLUGS[i])
  }
  return out
}

function sameSlugSet(a, b) {
  const left = (Array.isArray(a) ? a : []).map((item) => String((item && item.slug) || '')).filter(Boolean).sort()
  const right = (Array.isArray(b) ? b : []).map((item) => String((item && item.slug) || '')).filter(Boolean).sort()
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function getMap() {
  const out = {}
  Object.keys(_bySlug).forEach((slug) => {
    out[slug] = _bySlug[slug]
  })
  return out
}

module.exports = {
  extractFromMediaMap,
  ingest,
  ingestMediaMap,
  getFigure,
  listEnabled,
  listMissing,
  sameSlugSet,
  getMap
}
