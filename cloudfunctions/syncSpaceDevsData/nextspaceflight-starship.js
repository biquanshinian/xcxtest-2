/**
 * 从 Next Spaceflight 星舰页 HTML 中解析嵌入的 starshipData.statuses（Next.js Flight 内联负载）
 */
const https = require('https')
const zlib = require('zlib')
const { URL } = require('url')

const NSF_STARSHIP_PAGE = 'https://nextspaceflight.com/starship/'
const { enrichNsfStatusesForStorage } = require('./nsf-checklist-i18n.js')
const {
  parseStatusesMultiStrategy,
  extractLastFetchFlexible
} = require('./nextspaceflight-parse-strategies.js')

function decodeResponseBody(buf, encodingHeader) {
  const enc = String(encodingHeader || '').toLowerCase()
  if (!Buffer.isBuffer(buf) || buf.length === 0) return ''
  if (enc.includes('gzip') || (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b)) {
    return zlib.gunzipSync(buf).toString('utf8')
  }
  if (enc.includes('br')) {
    return zlib.brotliDecompressSync(buf).toString('utf8')
  }
  if (enc.includes('deflate')) {
    return zlib.inflateSync(buf).toString('utf8')
  }
  return buf.toString('utf8')
}

function fetchUrlText(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SpaceSync/1.0)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        timeout: 25000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const buf = Buffer.concat(chunks)
            const text = decodeResponseBody(buf, res.headers['content-encoding'])
            resolve(text)
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

/**
 * 多策略解析（nextspaceflight-parse-strategies）；失败抛出 Error.triedStrategies
 */
function parseStatusesFromHtml(htmlText) {
  const str = typeof htmlText === 'string' ? htmlText : String(htmlText || '')
  const anchorSd = str.indexOf('starshipData')
  const tried = []
  const multi = parseStatusesMultiStrategy(str, { tried })
  if (!multi) {
    const e = new Error('statuses_not_found')
    e.triedStrategies = tried
    throw e
  }
  const lastFetch = extractLastFetchFlexible(str, multi.endIdx, anchorSd >= 0 ? anchorSd : 0)
  const parsedRows = multi.arr
    .map((row, i) => {
      if (!row || typeof row !== 'object') return null
      const id = row.id != null ? String(row.id) : `nsf_${i}`
      const title = String(row.title || '').trim()
      const url = typeof row.url === 'string' ? row.url.trim() : ''
      const managerRaw = row.manager
      const mgrStr =
        typeof managerRaw === 'string'
          ? managerRaw.trim()
          : managerRaw != null && managerRaw !== ''
            ? String(managerRaw).trim()
            : ''
      const category = mgrStr && !/^\d+$/.test(mgrStr) ? mgrStr : ''
      const confirmed = !!row.confirmed
      if (!title) return null
      return {
        id,
        titleEn: title,
        doneWeb: confirmed,
        detailUrl: url,
        category
      }
    })
    .filter(Boolean)
  const statuses = enrichNsfStatusesForStorage(parsedRows)
  return {
    statuses,
    sourceLastFetch: lastFetch,
    parserMeta: {
      strategy: multi.strategy,
      triedStrategies: tried.slice(),
      matchedRawCount: multi.arr.length,
      enrichedCount: statuses.length
    }
  }
}

/**
 * 抓取并写入 nextspaceflight_starship_cache / latest；解析失败时保留旧 statuses
 */
async function runSyncNextSpaceflightStarship(db) {
  const coll = db.collection('nextspaceflight_starship_cache')
  let prev = { statuses: [], sourceLastFetch: '' }
  try {
    const r = await coll.doc('latest').get()
    if (r.data) {
      prev.statuses = Array.isArray(r.data.statuses) ? r.data.statuses : []
      prev.sourceLastFetch = typeof r.data.sourceLastFetch === 'string' ? r.data.sourceLastFetch : ''
    }
  } catch (e) {}

  let html
  try {
    html = await fetchUrlText(NSF_STARSHIP_PAGE)
  } catch (e) {
    const err = e.message || 'fetch_failed'
    await coll.doc('latest').set({
      data: {
        statuses: prev.statuses,
        sourceLastFetch: prev.sourceLastFetch,
        updatedAtMs: Date.now(),
        error: err
      }
    })
    return { success: false, error: err, count: prev.statuses.length }
  }

  let parsed
  try {
    parsed = parseStatusesFromHtml(html)
  } catch (e) {
    const err = e.message || 'parse_failed'
    await coll.doc('latest').set({
      data: {
        statuses: prev.statuses,
        sourceLastFetch: prev.sourceLastFetch,
        updatedAtMs: Date.now(),
        error: err,
        parserMeta: {
          ok: false,
          strategy: null,
          error: err,
          triedStrategies: e.triedStrategies || [],
          parsedAtMs: Date.now()
        }
      }
    })
    return { success: false, error: err, count: prev.statuses.length }
  }

  await coll.doc('latest').set({
    data: {
      statuses: parsed.statuses,
      sourceLastFetch: parsed.sourceLastFetch,
      updatedAtMs: Date.now(),
      error: '',
      parserMeta: {
        ok: true,
        ...(parsed.parserMeta || {}),
        parsedAtMs: Date.now()
      }
    }
  })
  return {
    success: true,
    count: parsed.statuses.length,
    sourceLastFetch: parsed.sourceLastFetch,
    parserStrategy: parsed.parserMeta && parsed.parserMeta.strategy
  }
}

module.exports = {
  NSF_STARSHIP_PAGE,
  runSyncNextSpaceflightStarship,
  parseStatusesFromHtml,
  fetchUrlText
}
