/**
 * SPACE_NOTICES_FEATURE — 从 space-notices.com 拉取通告并解析
 * 站点无稳定公开 API（/api 403），改为抓取 entry/notice HTML 中的 RSC 载荷。
 */

const https = require('https')
const { parseAreasFromRawText } = require('./parse-areas.js')

const BASE = 'https://space-notices.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 关注的 Space Notices entry → LL2 id（可扩展） */
const WATCH_ENTRIES = [
  {
    entrySlug: 'launch-starship-flight-13',
    ll2Id: 'ac897b9f-44d2-4ff4-8416-1a0a076e98a2'
  }
]

const PRIORITY_PREFIX = ['notam-', 'tfr-', 'nav-warning-', 'bnm-', 'lnm-', 'adp-']
/** 跨洋溅落 / 关键 TFR / AHA 等优先保留，避免被大量近岸 NOTAM 挤出配额 */
const MUST_INCLUDE_RE =
  /E2700|E2770|E2685|E2700|HYDROPAC|FDC%206|FDC 6|07%2F270|07\/270|adp-link-file-aha|adp-link-file-dra/i
const MAX_NOTICES_PER_ENTRY = 28
const FETCH_CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 10000
/** 外部拉取预算；超时则带着已拉到的通告返回（需配合云函数 timeout） */
const DEFAULT_FETCH_BUDGET_MS = 45000

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: REQUEST_TIMEOUT_MS
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : BASE + res.headers.location
          res.resume()
          httpGet(next).then(resolve, reject)
          return
        }
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          buf += c
        })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${url}`))
            return
          }
          resolve(buf)
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout ' + url))
    })
  })
}

function decodePath(p) {
  try {
    return decodeURIComponent(p)
  } catch (e) {
    return p
  }
}

function noticeKeyFromPath(pathname) {
  // /notice/notam-YMMM-E2700%2F26 → notam-YMMM-E2700/26
  const raw = String(pathname || '')
  const m = raw.match(/\/notice\/(.+)$/)
  if (!m) return ''
  return decodePath(m[1]).replace(/\/+$/, '')
}

function prefixRank(pathName) {
  const k = decodePath(pathName)
  const base = k.replace(/^\/notice\//, '')
  const ra = PRIORITY_PREFIX.findIndex((p) => base.indexOf(p) === 0 || k.indexOf(p) >= 0)
  return ra < 0 ? 99 : ra
}

function extractNoticeLinks(entryHtml) {
  const links = []
  const re = /href="(\/notice\/[^"]+)"/g
  let m
  while ((m = re.exec(entryHtml))) {
    links.push(m[1])
  }
  const uniq = [...new Set(links)]
  const must = []
  const rest = []
  uniq.forEach((p) => {
    if (MUST_INCLUDE_RE.test(p) || MUST_INCLUDE_RE.test(decodePath(p))) must.push(p)
    else rest.push(p)
  })
  rest.sort((a, b) => prefixRank(a) - prefixRank(b) || decodePath(a).localeCompare(decodePath(b)))
  must.sort((a, b) => decodePath(a).localeCompare(decodePath(b)))
  return must.concat(rest).slice(0, MAX_NOTICES_PER_ENTRY)
}

/**
 * 从 HTML 中切出 \"notice\":{...} / "notice":{...} 平衡大括号对象并 JSON.parse
 */
function extractNoticeObject(html) {
  const markers = ['\\"notice\\":{', '"notice":{']
  let idx = -1
  let escaped = false
  for (let m = 0; m < markers.length; m++) {
    idx = html.indexOf(markers[m])
    if (idx >= 0) {
      escaped = markers[m].charAt(0) === '\\'
      break
    }
  }
  if (idx < 0) return null
  const braceStart = html.indexOf('{', idx)
  if (braceStart < 0) return null

  let i = braceStart
  let depth = 0
  let inStr = false
  // RSC 转义串：字符串界符为 \"
  while (i < html.length && i < braceStart + 200000) {
    if (escaped) {
      if (!inStr) {
        if (html.startsWith('\\"', i)) {
          inStr = true
          i += 2
          continue
        }
        const ch = html[i]
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        i++
        continue
      }
      // in string
      if (html.startsWith('\\\\', i)) {
        i += 2
        continue
      }
      if (html.startsWith('\\"', i)) {
        inStr = false
        i += 2
        continue
      }
      i++
      continue
    }
    // plain JSON
    const ch = html[i]
    if (inStr) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '"') inStr = false
      i++
      continue
    }
    if (ch === '"') {
      inStr = true
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
    i++
  }
  if (depth !== 0) return null
  let raw = html.slice(braceStart, i)
  if (escaped) {
    // {\"id\":\"x\"} → {"id":"x"}
    raw = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

/**
 * 从 notice 页 HTML 抽出 notice 对象字段（RSC 转义 JSON）
 */
function parseNoticeFromHtml(html, fallbackKey) {
  const obj = extractNoticeObject(html)
  if (!obj || typeof obj !== 'object') return null

  const id = String(obj.id || fallbackKey || '')
  const name = String(obj.name || id)
  const reason = String(obj.reason || '')
  const rawText = String(obj.rawText || '')
  let type = String(obj.type || 'NOTAM').toUpperCase().replace(/\s+/g, '_')
  if (type === 'NAV_WARNING') type = 'NAVWARNING'
  const cancelled = !!obj.cancelled
  let areas = Array.isArray(obj.areas) ? obj.areas : []
  const dates = Array.isArray(obj.dates) ? obj.dates : []
  const sourceName = (obj.source && obj.source.name) || 'Space Notices'
  const sourceLink =
    (obj.source && obj.source.link) ||
    `${BASE}/notice/${encodeURIComponent(id).replace(/%2F/gi, '%2F')}`

  if (!rawText && (!areas || !areas.length)) return null

  // cancelled 仍保留站点多边形，地图可灰显；勿清空 areas
  if (!areas.length && rawText) {
    areas = parseAreasFromRawText(rawText)
  }

  const centerline = Array.isArray(obj.centerline) ? obj.centerline : []

  return {
    noticeKey: id,
    type,
    name,
    reason,
    rawText,
    areas,
    centerline,
    dates,
    sourceName,
    sourceLink,
    cancelled
  }
}

async function mapPool(items, concurrency, worker) {
  const results = []
  let i = 0
  async function run() {
    while (i < items.length) {
      const cur = i++
      results[cur] = await worker(items[cur], cur)
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => run()))
  return results
}

/**
 * 抓一批通告页并解析（entry 页由 discover-entries 负责）
 * @param {string[]} paths /notice/xxx 路径
 * @param {{ deadline?: number }} [opts] deadline 为绝对时间戳，超出即停并带回已拿到的
 * @returns {Promise<{ notices: object[], errors: string[] }>}
 */
async function fetchNoticesByPaths(paths, opts) {
  const deadline = Number(opts && opts.deadline) || Date.now() + DEFAULT_FETCH_BUDGET_MS
  const notices = []
  const errors = []
  await mapPool(Array.isArray(paths) ? paths : [], FETCH_CONCURRENCY, async (pathName) => {
    if (Date.now() > deadline) {
      if (errors.indexOf('fetch budget exceeded') < 0) errors.push('fetch budget exceeded')
      return
    }
    const key = noticeKeyFromPath(pathName)
    try {
      const html = await httpGet(BASE + pathName)
      const notice = parseNoticeFromHtml(html, key)
      if (notice) notices.push(notice)
    } catch (e) {
      errors.push(`${key}: ${(e && e.message) || String(e)}`)
    }
  })
  return { notices, errors }
}

/**
 * @param {{ budgetMs?: number }} [opts]
 * @returns {Promise<{ ll2Id: string, notices: object[], fetched: number, parsed: number, errors: string[] }[]>}
 */
async function fetchWatchedEntries(opts) {
  const budgetMs = Math.max(5000, Number(opts && opts.budgetMs) || DEFAULT_FETCH_BUDGET_MS)
  const deadline = Date.now() + budgetMs
  const out = []
  for (const watch of WATCH_ENTRIES) {
    if (Date.now() > deadline) {
      out.push({
        ll2Id: watch.ll2Id,
        notices: [],
        fetched: 0,
        parsed: 0,
        errors: ['fetch budget exceeded']
      })
      continue
    }
    const errors = []
    const entryUrl = `${BASE}/entry/${watch.entrySlug}`
    let entryHtml = ''
    try {
      entryHtml = await httpGet(entryUrl)
    } catch (e) {
      out.push({
        ll2Id: watch.ll2Id,
        notices: [],
        fetched: 0,
        parsed: 0,
        errors: [(e && e.message) || String(e)]
      })
      continue
    }
    const paths = extractNoticeLinks(entryHtml)
    const notices = []
    await mapPool(paths, FETCH_CONCURRENCY, async (pathName) => {
      if (Date.now() > deadline) {
        errors.push('fetch budget exceeded')
        return
      }
      const key = noticeKeyFromPath(pathName)
      const url = BASE + pathName
      try {
        const html = await httpGet(url)
        const notice = parseNoticeFromHtml(html, key)
        if (notice) notices.push(notice)
      } catch (e) {
        errors.push(`${key}: ${(e && e.message) || String(e)}`)
      }
    })
    out.push({
      ll2Id: watch.ll2Id,
      notices,
      fetched: paths.length,
      parsed: notices.length,
      errors: errors.slice(0, 8)
    })
  }
  return out
}

module.exports = {
  BASE,
  WATCH_ENTRIES,
  MAX_NOTICES_PER_ENTRY,
  fetchNoticesByPaths,
  fetchWatchedEntries,
  parseNoticeFromHtml,
  extractNoticeLinks,
  noticeKeyFromPath,
  httpGet
}
