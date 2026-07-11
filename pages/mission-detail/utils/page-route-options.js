/**
 * 统一解析页面路由参数（含明文 URL Scheme scene 1286、分享、扫码等入口）。
 * PATH 不可带 query；query 可能在 onLoad(options) 中，也可能仅在 getEnterOptionsSync().query。
 */

function decodeURIComponentSafe(value) {
  if (value == null || value === '') return ''
  let s = String(value).trim()
  if (!s) return ''
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break
    try {
      const next = decodeURIComponent(s.replace(/\+/g, ' '))
      if (next === s) break
      s = next
    } catch (_) {
      break
    }
  }
  return s
}

function parseQueryString(raw) {
  const out = {}
  if (raw == null || raw === '') return out
  const q = String(raw).trim().replace(/^[?#]/, '')
  if (!q) return out
  q.split('&').forEach((pair) => {
    if (!pair) return
    const eq = pair.indexOf('=')
    const key = decodeURIComponentSafe(eq >= 0 ? pair.slice(0, eq) : pair)
    const val = decodeURIComponentSafe(eq >= 0 ? pair.slice(eq + 1) : '')
    if (key) out[key] = val
  })
  return out
}

function mergePlainObject(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target
  Object.keys(source).forEach((k) => {
    const v = source[k]
    if (v == null || v === '') return
    target[k] = typeof v === 'number' ? String(v) : String(v)
  })
  return target
}

function readSyncEnterQuery() {
  const readers = [
    () => (typeof wx.getEnterOptionsSync === 'function' ? wx.getEnterOptionsSync() : null),
    () => (typeof wx.getLaunchOptionsSync === 'function' ? wx.getLaunchOptionsSync() : null)
  ]
  for (let i = 0; i < readers.length; i += 1) {
    try {
      const info = readers[i]()
      if (info && info.query && typeof info.query === 'object') {
        return { ...info.query }
      }
    } catch (_) {}
  }
  return {}
}

/**
 * @param {Record<string, string>|undefined} rawOptions onLoad 收到的 options
 * @returns {Record<string, string>}
 */
function resolvePageRouteOptions(rawOptions) {
  const merged = {}
  mergePlainObject(merged, readSyncEnterQuery())

  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  mergePlainObject(merged, options)

  const nestedKeys = ['query', 'q', 'cq']
  nestedKeys.forEach((key) => {
    const raw = options[key]
    if (typeof raw === 'string' && raw.trim()) {
      mergePlainObject(merged, parseQueryString(raw))
    }
  })

  if (options.query && typeof options.query === 'object' && !Array.isArray(options.query)) {
    mergePlainObject(merged, options.query)
  }

  Object.keys(merged).forEach((k) => {
    merged[k] = decodeURIComponentSafe(merged[k])
  })

  if (!merged.id) {
    if (merged.articleId) merged.id = merged.articleId
    else if (merged.eventId) merged.id = merged.eventId
  }

  return merged
}

function resolveNewsDetailRoute(rawOptions) {
  const opts = resolvePageRouteOptions(rawOptions)
  const detailType = opts.type === 'article' ? 'article' : 'event'
  const id = opts.id ? String(opts.id).trim() : ''
  return { detailType, id, options: opts }
}

function resolveMissionDetailRoute(rawOptions) {
  const opts = resolvePageRouteOptions(rawOptions)
  const detailType = opts.type === 'completed' ? 'completed' : 'upcoming'
  const id = opts.id ? String(opts.id).trim() : ''
  const fromSearch = String(opts.fromSearch || '') === '1'
  return { detailType, id, fromSearch, options: opts }
}

module.exports = {
  decodeURIComponentSafe,
  parseQueryString,
  resolvePageRouteOptions,
  resolveNewsDetailRoute,
  resolveMissionDetailRoute
}
