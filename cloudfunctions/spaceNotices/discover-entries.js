/**
 * SPACE_NOTICES_FEATURE — space-notices.com entry 索引与元信息
 *
 * 站点首页列出全部 entry（含历史与即将发射），每个 entry 页自带通告链接。
 * 站点不暴露 LL2 id，可用于匹配的元信息只有 <title>「任务名 - 火箭名 | Space Notices」
 * 与 meta description，故 entry 主键用站点 slug（永远存在），LL2 只作尽力补全。
 */

const { httpGet } = require('./fetch-external.js')

const BASE = 'https://space-notices.com'
/**
 * 首页只索引 launch-*。collection-* 多数是主题汇总（如 Starbase testing），
 * 不进轮转；中国航警桶除外——入库时合集页 + sitemap 全国 FIR + 按编号扫描。
 * https://space-notices.com/entry/collection-chinese-unknown
 */
const CHINESE_COLLECTION_KEY = 'collection-chinese-unknown'
const PINNED_ENTRY_SLUGS = [CHINESE_COLLECTION_KEY]
const ENTRY_PATH_RE = /\/entry\/(launch-[a-z0-9\-_%]+)/gi
const MAX_ENTRIES = 40

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' '
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, (m) => (HTML_ENTITIES[m.toLowerCase()] != null ? HTML_ENTITIES[m.toLowerCase()] : m))
}

/**
 * 从首页 HTML 抽 entry slug（去重、保序）
 * @returns {string[]}
 */
function parseEntrySlugs(html) {
  const out = []
  const seen = new Set()
  let m
  ENTRY_PATH_RE.lastIndex = 0
  while ((m = ENTRY_PATH_RE.exec(String(html || '')))) {
    let slug = m[1]
    try {
      slug = decodeURIComponent(slug)
    } catch (e) { /* keep raw */ }
    slug = slug.replace(/\\+$/, '')
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

function isCollectionKey(slug) {
  return /^collection-/i.test(String(slug || ''))
}

function isChineseCollectionKey(slug) {
  return String(slug || '').trim() === CHINESE_COLLECTION_KEY
}

/** 首页 launch-* 之后置顶中国合集，保证定时器第一轮就会抓 */
function withPinnedEntries(slugs) {
  const out = Array.isArray(slugs) ? slugs.slice() : []
  PINNED_ENTRY_SLUGS.forEach((s) => {
    if (s && out.indexOf(s) < 0) out.unshift(s)
  })
  if (out.length > MAX_ENTRIES) out.length = MAX_ENTRIES
  return out
}

function metaContent(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}="${value}"[^>]+content="([^"]*)"`, 'i')
  const m = String(html || '').match(re)
  if (m) return decodeEntities(m[1])
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="${value}"`, 'i')
  const m2 = String(html || '').match(re2)
  return m2 ? decodeEntities(m2[1]) : ''
}

/**
 * <title>Starlink Group 17-51 - Falcon 9 | Space Notices</title>
 *   → { missionName: 'Starlink Group 17-51', rocketName: 'Falcon 9' }
 * 任务名自身可能含连字符（NROL-95、17-51），故按最后一个「空格-连字符-空格」切分
 */
function splitTitle(rawTitle) {
  const t = decodeEntities(rawTitle).replace(/\s*\|\s*Space Notices\s*$/i, '').trim()
  if (!t) return { missionName: '', rocketName: '' }
  const idx = t.lastIndexOf(' - ')
  if (idx <= 0) return { missionName: t, rocketName: '' }
  return {
    missionName: t.slice(0, idx).trim(),
    rocketName: t.slice(idx + 3).trim()
  }
}

/**
 * @param {string} html entry 页 HTML
 * @param {string} slug
 * @returns {{ entryKey: string, missionName: string, rocketName: string, siteTitle: string, description: string, siteDates: string[] }}
 */
function parseEntryMeta(html, slug) {
  const rawTitle = (String(html || '').match(/<title>([^<]*)<\/title>/i) || [, ''])[1]
  const { missionName, rocketName } = splitTitle(rawTitle)
  const ogTitle = metaContent(html, 'property', 'og:title')
  const description = metaContent(html, 'name', 'description')
  // 页面渲染的通告窗口时间，用于 LL2 日期比对（通告入库后会用更权威的 dates 覆盖）
  // 合集页常用 2099-01-01 占位，不能当真实窗口
  const siteDates = [...new Set(String(html || '').match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) || [])]
    .filter((d) => !/^2099-01-01/.test(d))
    .sort()
  return {
    entryKey: slug,
    missionName: missionName || ogTitle || slug,
    rocketName,
    siteTitle: decodeEntities(rawTitle).replace(/\s*\|\s*Space Notices\s*$/i, '').trim(),
    description,
    siteDates: siteDates.slice(0, 12)
  }
}

/**
 * 抓首页 → entry slug 列表
 * @returns {Promise<string[]>}
 */
async function discoverEntrySlugs() {
  const html = await httpGet(BASE + '/')
  return withPinnedEntries(parseEntrySlugs(html))
}

/**
 * 抓单个 entry 页，返回元信息与原始 HTML（通告链接由调用方用 extractNoticeLinks 解析）
 * @returns {Promise<{ meta: object, html: string }>}
 */
async function fetchEntryPage(slug) {
  const html = await httpGet(`${BASE}/entry/${slug}`)
  return { meta: parseEntryMeta(html, slug), html }
}

module.exports = {
  BASE,
  MAX_ENTRIES,
  CHINESE_COLLECTION_KEY,
  PINNED_ENTRY_SLUGS,
  decodeEntities,
  parseEntrySlugs,
  withPinnedEntries,
  isCollectionKey,
  isChineseCollectionKey,
  splitTitle,
  parseEntryMeta,
  discoverEntrySlugs,
  fetchEntryPage
}
