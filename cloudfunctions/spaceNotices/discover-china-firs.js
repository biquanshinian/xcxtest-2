/**
 * SPACE_NOTICES_FEATURE — 中国情报区通告发现
 *
 * 官网合集 collection-chinese-unknown 只收「对不上发射」的一小桶，
 * 用户要查未来窗口规划行程，不能等它上架。
 *
 * 发现顺序：
 * 1. 合集页现有链接（HYDROPAC / 马尼拉溅落等）
 * 2. sitemap 里全部中国 FIR（含港澳台）+ 溅落常用 RPHI
 * 3. 按情报区从 sitemap 最大编号往后扫，抓尚未编进 sitemap 的孤儿页
 *    （space-notices 对不存在的 URL 也返回 200，用 <title> 区分）
 */

const {
  BASE,
  httpGet,
  parseNoticeFromHtml,
  noticeKeyFromPath,
  mapPool
} = require('./fetch-external.js')

/** 大陆九区 + 港澳台。与客户端 china-filter FIR_LABELS 对齐（不含马尼拉） */
const CHINA_FIR_CODES = [
  'ZLHW', // 酒泉 / 太原 — 用户规划行程最常查
  'ZPKM', // 西昌
  'ZGZU', // 文昌航线
  'ZJSA',
  'ZHWH',
  'ZWUQ',
  'ZSHA',
  'ZBPE',
  'ZYSH',
  'VHHK',
  'VHHH',
  'VMMC',
  'RCAA'
]
/** 文昌等任务的海外溅落航警，sitemap / 合集都会出现 */
const SPLASH_FIR_CODES = ['RPHI', 'RPLI']
const SCAN_FIR_CODES = CHINA_FIR_CODES.concat(SPLASH_FIR_CODES)

const FIR_SERIES_LETTER = {
  RPHI: 'B',
  RPLI: 'B'
}

const CATCH_AHEAD = 400
/** 一轮优先扫完一个落后情报区（兰州 3379→3624 这种 sitemap 滞后也能当轮抓到） */
const CATCH_BATCH = 260
const TICK_BATCH = 4
const PROBE_BUDGET = 260
const PROBE_CONCURRENCY = 6
const KEEP_ENDED_MS = 14 * 24 * 3600 * 1000
const SITEMAP_PATH = '/sitemap.xml'

const SCAN_FIR_SET = {}
SCAN_FIR_CODES.forEach((c) => {
  SCAN_FIR_SET[c] = true
})

function currentNotamYear(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now())
  return String(d.getUTCFullYear()).slice(-2)
}

function decodePath(p) {
  try {
    return decodeURIComponent(String(p || ''))
  } catch (e) {
    return String(p || '')
  }
}

function locToNoticePath(loc) {
  const s = String(loc || '')
  const i = s.indexOf('/notice/')
  if (i < 0) return ''
  return s.slice(i).replace(/\/+$/, '')
}

function parseFirSeriesFromPath(pathName) {
  const d = decodePath(pathName)
  const m = d.match(/notam-([A-Z]{4})-([A-Z])(\d+)(?:\/|%2F)(\d+)/i)
  if (!m) return null
  return {
    fir: m[1].toUpperCase(),
    letter: m[2].toUpperCase(),
    num: Number(m[3]),
    yy: m[4]
  }
}

function noticePathForSeries(fir, letter, num, yy) {
  const n = String(Math.max(0, Number(num) || 0)).padStart(4, '0')
  return `/notice/notam-${fir}-${letter}${n}/${yy}`
}

function seriesLetterForFir(fir) {
  return FIR_SERIES_LETTER[String(fir || '').toUpperCase()] || 'A'
}

/**
 * 真通告：`<title>A3624/26 - NOTAM | Space Notices</title>`
 * 占位 200：`<title>Space Notices</title>`（站点对任意 notam-FIR-编号 都给 200）
 */
function titleIndicatesNotice(html) {
  const m = String(html || '').match(/<title>([^<]*)<\/title>/i)
  if (!m) return false
  const t = m[1].replace(/\s*\|\s*Space Notices\s*$/i, '').trim()
  if (!t) return false
  if (/^space notices$/i.test(t)) return false
  return true
}

function isScanFirCode(code) {
  return !!SCAN_FIR_SET[String(code || '').trim().toUpperCase()]
}

/**
 * @param {string} xml sitemap.xml
 * @returns {{ path: string, noticeKey: string, lastmod: string, fir: string, letter: string, num: number, yy: string }[]}
 */
function parseSitemapChinaNoticePaths(xml) {
  const out = []
  const seen = {}
  const re =
    /<loc>(https:\/\/space-notices\.com\/notice\/[^<]+)<\/loc>(?:\s*<image:image>[\s\S]*?<\/image:image>)?\s*<lastmod>([^<]*)<\/lastmod>/gi
  let m
  while ((m = re.exec(String(xml || '')))) {
    const pathName = locToNoticePath(m[1])
    const series = parseFirSeriesFromPath(pathName)
    if (!series || !isScanFirCode(series.fir)) continue
    const noticeKey = noticeKeyFromPath(pathName)
    if (!noticeKey || seen[noticeKey]) continue
    seen[noticeKey] = true
    out.push({
      path: pathName,
      noticeKey,
      lastmod: m[2] || '',
      fir: series.fir,
      letter: series.letter,
      num: series.num,
      yy: series.yy
    })
  }
  return out
}

function sitemapMaxByFir(rows, yy, letterForFir) {
  const max = {}
  ;(rows || []).forEach((row) => {
    if (!row || row.yy !== yy) return
    const want = letterForFir ? letterForFir(row.fir) : seriesLetterForFir(row.fir)
    if (row.letter !== want) return
    const prev = Number(max[row.fir]) || 0
    if (row.num > prev) max[row.fir] = row.num
  })
  return max
}

function lastmodByNoticeKey(rows) {
  const map = {}
  ;(rows || []).forEach((row) => {
    if (row && row.noticeKey) map[row.noticeKey] = row.lastmod || ''
  })
  return map
}

/**
 * 规划本轮要探测的编号。只返回计划；scanned 要等 HTTP 成功后再连续推进，避免并发空洞。
 */
function pickProbeTargets(opts) {
  const o = opts || {}
  const firs = Array.isArray(o.firs) && o.firs.length ? o.firs : SCAN_FIR_CODES
  const yy = String(o.yy || currentNotamYear())
  const sitemapMax = o.sitemapMax || {}
  const prevCursors = (o.state && o.state.cursors) || {}
  const budget = Math.max(1, Number(o.budget) || PROBE_BUDGET)
  const catchAhead = Number(o.catchAhead) > 0 ? Number(o.catchAhead) : CATCH_AHEAD
  const catchBatch = Number(o.catchBatch) > 0 ? Number(o.catchBatch) : CATCH_BATCH
  const tickBatch = Number(o.tickBatch) > 0 ? Number(o.tickBatch) : TICK_BATCH

  const peerMax = firs.reduce((acc, fir) => {
    const sm = Number(sitemapMax[fir]) || 0
    const hit = Number((prevCursors[fir] || {}).lastHit) || 0
    return Math.max(acc, sm, hit)
  }, 0)

  const queued = []
  const cursors = {}
  firs.forEach((fir) => {
    const sm = Number(sitemapMax[fir]) || 0
    const st = prevCursors[fir] || {}
    const lastHit = Math.max(Number(st.lastHit) || 0, sm)
    const floor = sm > 0 ? sm : peerMax > 0 ? Math.max(1, peerMax - 600) : 1
    const scanned = Math.max(Number(st.scanned) || 0, floor)
    const target = Math.max(lastHit, floor) + catchAhead
    const behind = scanned < target
    cursors[fir] = { scanned, lastHit }
    queued.push({
      fir,
      behind,
      scanned,
      lastHit,
      start: scanned + 1,
      target
    })
  })
  queued.sort((a, b) => {
    if (a.behind !== b.behind) return a.behind ? -1 : 1
    return firs.indexOf(a.fir) - firs.indexOf(b.fir)
  })

  const targets = []
  queued.forEach((q) => {
    if (targets.length >= budget) return
    const left = budget - targets.length
    const batch = Math.min(left, q.behind ? catchBatch : tickBatch)
    const letter = seriesLetterForFir(q.fir)
    let n = q.start
    let count = 0
    while (count < batch && n <= q.target) {
      targets.push({
        fir: q.fir,
        letter,
        num: n,
        yy,
        path: noticePathForSeries(q.fir, letter, n, yy)
      })
      n += 1
      count += 1
    }
  })

  return { targets, yy, queued, nextState: { yy, cursors } }
}

function advanceContiguous(prevScanned, completedNums) {
  const set = {}
  ;(completedNums || []).forEach((n) => {
    set[Number(n)] = true
  })
  let n = Number(prevScanned) || 0
  while (set[n + 1]) n += 1
  return n
}

function emptyProbeState(yy) {
  return { yy: String(yy || currentNotamYear()), cursors: {} }
}

function normalizeProbeState(state, yy) {
  const want = String(yy || currentNotamYear())
  if (!state || typeof state !== 'object' || String(state.yy || '') !== want) {
    return emptyProbeState(want)
  }
  const cursors = {}
  const src = state.cursors && typeof state.cursors === 'object' ? state.cursors : {}
  Object.keys(src).forEach((fir) => {
    const row = src[fir] || {}
    cursors[fir] = {
      scanned: Number(row.scanned) || 0,
      lastHit: Number(row.lastHit) || 0
    }
  })
  return { yy: want, cursors }
}

/**
 * 只把 HTTP 成功的编号计入 scanned；命中页提升 lastHit。
 */
function applyProbeResults(state, results, yy) {
  const next = normalizeProbeState(state, yy)
  const byFir = {}
  ;(results || []).forEach((r) => {
    if (!r || !r.ok || !r.fir) return
    const fir = String(r.fir).toUpperCase()
    if (!byFir[fir]) byFir[fir] = { nums: [], hits: [] }
    byFir[fir].nums.push(Number(r.num) || 0)
    if (r.exists) byFir[fir].hits.push(Number(r.num) || 0)
  })
  Object.keys(byFir).forEach((fir) => {
    const prev = next.cursors[fir] || { scanned: 0, lastHit: 0 }
    const hitMax = byFir[fir].hits.reduce((a, n) => Math.max(a, n), prev.lastHit || 0)
    next.cursors[fir] = {
      scanned: advanceContiguous(prev.scanned, byFir[fir].nums),
      lastHit: hitMax
    }
  })
  return next
}

function uniqueNoticePaths(paths) {
  const seen = {}
  const out = []
  ;(paths || []).forEach((p) => {
    const raw = String(p || '')
    const pathName = raw.indexOf('/notice/') >= 0 ? locToNoticePath(raw) : raw
    if (!pathName) return
    const key = noticeKeyFromPath(pathName)
    if (!key || seen[key]) return
    seen[key] = true
    out.push(pathName.charAt(0) === '/' ? pathName : '/' + pathName)
  })
  return out
}

function prioritizeFetchPaths(paths, opts) {
  const o = opts || {}
  const have = o.have || {}
  const lastmod = o.lastmodByKey || {}
  const pending = (paths || []).filter((p) => {
    const key = noticeKeyFromPath(p)
    return key && !have[key]
  })
  pending.sort((a, b) => {
    const ka = noticeKeyFromPath(a)
    const kb = noticeKeyFromPath(b)
    const ta = Date.parse(lastmod[ka] || '') || 0
    const tb = Date.parse(lastmod[kb] || '') || 0
    if (tb !== ta) return tb - ta
    const sa = parseFirSeriesFromPath(a)
    const sb = parseFirSeriesFromPath(b)
    const ya = sa ? Number(sa.yy) : 0
    const yb = sb ? Number(sb.yy) : 0
    if (yb !== ya) return yb - ya
    return (sb ? sb.num : 0) - (sa ? sa.num : 0)
  })
  return pending
}

function noticeWindowEndMs(notice) {
  let end = 0
  ;((notice && notice.dates) || []).forEach((d) => {
    const e = Date.parse(String((d && d.end) || ''))
    if (Number.isFinite(e) && e > end) end = e
  })
  return end
}

/** 合集/sitemap/本轮扫到的，或窗口仍在（含结束后 14 天）→ 保留 */
function shouldKeepStoredNotice(notice, discoveredSet, now, keepEndedMs) {
  const key = notice && notice.noticeKey
  if (!key) return false
  if (discoveredSet && discoveredSet[key]) return true
  const end = noticeWindowEndMs(notice)
  if (!end) return true
  const keep = Number(keepEndedMs) >= 0 ? Number(keepEndedMs) : KEEP_ENDED_MS
  return end + keep >= (Number(now) || Date.now())
}

async function fetchSitemapChinaNoticePaths() {
  const xml = await httpGet(BASE + SITEMAP_PATH)
  return parseSitemapChinaNoticePaths(xml)
}

async function probeFirNoticePages(targets, opts) {
  const deadline = Number(opts && opts.deadline) || Date.now() + 20000
  const concurrency = Math.max(1, Number((opts && opts.concurrency) || PROBE_CONCURRENCY))
  const completed = []
  await mapPool(Array.isArray(targets) ? targets : [], concurrency, async (t) => {
    if (!t || Date.now() > deadline) return
    try {
      const html = await httpGet(BASE + t.path)
      const exists = titleIndicatesNotice(html)
      const notice = exists ? parseNoticeFromHtml(html, noticeKeyFromPath(t.path)) : null
      completed.push({
        fir: t.fir,
        letter: t.letter,
        num: t.num,
        yy: t.yy,
        path: t.path,
        ok: true,
        exists,
        notice
      })
    } catch (e) {
      completed.push({
        fir: t.fir,
        letter: t.letter,
        num: t.num,
        yy: t.yy,
        path: t.path,
        ok: false,
        exists: false,
        notice: null,
        error: (e && e.message) || String(e)
      })
    }
  })
  return completed
}

module.exports = {
  BASE,
  CHINA_FIR_CODES,
  SPLASH_FIR_CODES,
  SCAN_FIR_CODES,
  CATCH_AHEAD,
  CATCH_BATCH,
  TICK_BATCH,
  PROBE_BUDGET,
  KEEP_ENDED_MS,
  currentNotamYear,
  parseFirSeriesFromPath,
  noticePathForSeries,
  seriesLetterForFir,
  titleIndicatesNotice,
  isScanFirCode,
  parseSitemapChinaNoticePaths,
  sitemapMaxByFir,
  lastmodByNoticeKey,
  pickProbeTargets,
  advanceContiguous,
  emptyProbeState,
  normalizeProbeState,
  applyProbeResults,
  uniqueNoticePaths,
  prioritizeFetchPaths,
  noticeWindowEndMs,
  shouldKeepStoredNotice,
  fetchSitemapChinaNoticePaths,
  probeFirNoticePages
}
