/**
 * 外链文章抓取：URL → { title, text, coverUrl, imageUrls }
 * Proxima Report 优先走 RSS（含 content:encoded + 图）
 */
const https = require('https')
const http = require('http')
const zlib = require('zlib')
const { URL } = require('url')
const wechatApi = require('./oaWechatApi')

// 超限截断而非报错：正文几乎都在前段，报「页面过大」直接失败体验差
const MAX_HTML_BYTES = 3 * 1024 * 1024
const MAX_REDIRECTS = 5
const MAX_IMAGES = 8
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function isHttpUrl(s) {
  return /^https?:\/\/[^\s]+$/i.test(String(s || '').trim())
}

function looksLikeLoneUrl(s) {
  const t = String(s || '').trim()
  if (!isHttpUrl(t)) return false
  if (/\s/.test(t)) return false
  return true
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractTag(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,
    'i'
  )
  const m = String(block || '').match(re)
  return m ? decodeXml(m[1]).trim() : ''
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i')
  const m = String(block || '').match(re)
  return m ? decodeXml(m[1]).trim() : ''
}

function resolveImgUrlFromTag(tag, baseUrl) {
  const raw =
    (tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1] ||
    (tag.match(/\bdata-original=["']([^"']+)["']/i) || [])[1] ||
    (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1] ||
    ''
  let u = decodeXml(raw).trim()
  if (!u || u.startsWith('data:')) return ''
  try {
    u = new URL(u, baseUrl || undefined).toString()
  } catch (e) {
    return ''
  }
  if (!/^https?:\/\//i.test(u)) return ''
  if (/emoji|icon|avatar|logo|spacer|blank\.|pixel/i.test(u)) return ''
  if (/\.(svg)(\?|$)/i.test(u)) return ''
  // NSF 等 Cloudflare 拦原站图：入库即改写为 Photon，管理端预览/洗稿转存都能用
  return wechatApi.hotlinkSafeImageUrl(u) || u
}

function collectImgUrls(html, baseUrl) {
  const out = []
  const re = /<img\b[^>]*>/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    const u = resolveImgUrlFromTag(m[0], baseUrl)
    if (!u) continue
    if (!out.includes(u)) out.push(u)
    if (out.length >= MAX_IMAGES) break
  }
  return out
}

/**
 * HTML → 纯文本，并在原图位置插入 [[IMG:n]] 占位（供洗稿按叙述落点插图）
 */
function htmlToTextWithSlots(html, baseUrl, maxImages = MAX_IMAGES) {
  const imageUrls = []
  let s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')

  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const u = resolveImgUrlFromTag(tag, baseUrl)
    if (!u) return '\n\n'
    let idx = imageUrls.indexOf(u)
    if (idx < 0) {
      if (imageUrls.length >= maxImages) return '\n\n'
      imageUrls.push(u)
      idx = imageUrls.length - 1
    }
    return `\n\n[[IMG:${idx + 1}]]\n\n`
  })

  const text = stripTags(s)
    .replace(/(\[\[IMG:\d+\]\]\s*){2,}/g, (block) => {
      // 连续占位保留换行分隔
      return block.replace(/\s+/g, '\n\n').trim() + '\n\n'
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000)

  return { text, imageUrls }
}

function buildPageHeaderProfiles(url, accept) {
  const base = {
    'User-Agent': BROWSER_UA,
    Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip'
  }
  // 403 常因 UA/Referer 风控：多套 header 轮询
  const profiles = [
    { ...base, Referer: url.origin + '/' },
    { ...base },
    { ...base, Referer: 'https://www.google.com/' }
  ]
  // RSS/XML 请求追加「诚实的阅读器 UA」：机房 IP+浏览器 UA 组合易被 Cloudflare 判伪装，
  // 已知 RSS 抓取器 UA 反而常被 WAF 规则放行
  if (/rss|xml/i.test(String(accept || ''))) {
    profiles.push(
      { ...base, 'User-Agent': 'Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)' },
      { ...base, 'User-Agent': 'Mozilla/5.0 (compatible; inoreader.com; 1 subscribers)' }
    )
  }
  return profiles
}

function fetchTextOnce(urlStr, { accept, headers } = {}, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_REDIRECTS) {
      reject(new Error('抓取重定向过多'))
      return
    }
    wechatApi
      .assertSafeFetchUrl(urlStr, 0)
      .then(() => {
        const url = new URL(urlStr)
        const lib = url.protocol === 'https:' ? https : http
        let truncated = false
        const req = lib.get(
          url,
          {
            timeout: 25000,
            headers: headers || buildPageHeaderProfiles(url, accept)[0]
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume()
              const next = new URL(res.headers.location, url).toString()
              fetchTextOnce(next, { accept, headers }, redirectDepth + 1).then(resolve, reject)
              return
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              res.resume()
              const err = new Error(`抓取失败 HTTP ${res.statusCode}`)
              err.statusCode = res.statusCode
              reject(err)
              return
            }
            const gzipped = /\bgzip\b/i.test(String(res.headers['content-encoding'] || ''))
            const chunks = []
            let total = 0
            res.on('data', (c) => {
              if (truncated) return
              total += c.length
              chunks.push(c)
              if (total > MAX_HTML_BYTES) {
                // 截断保留已收部分（正文一般在前段），不再整页报错
                truncated = true
                req.destroy()
              }
            })
            const finish = () => {
              const buf = Buffer.concat(chunks)
              if (!gzipped) {
                resolve(buf.toString('utf8'))
                return
              }
              zlib.gunzip(buf, (e, out) => {
                if (!e && out) {
                  resolve(
                    out.length > MAX_HTML_BYTES * 4
                      ? out.slice(0, MAX_HTML_BYTES * 4).toString('utf8')
                      : out.toString('utf8')
                  )
                  return
                }
                // 截断的 gzip 流：尽力解到出错为止
                const gz = zlib.createGunzip()
                const parts = []
                gz.on('data', (d) => parts.push(d))
                gz.on('error', () =>
                  parts.length ? resolve(Buffer.concat(parts).toString('utf8')) : reject(new Error('页面解压失败'))
                )
                gz.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
                gz.end(buf)
              })
            }
            res.on('end', finish)
            res.on('close', () => {
              if (truncated) finish()
            })
          }
        )
        req.on('error', (e) => {
          // 截断主动 destroy 会触发 error，此时结果已在 close 里返回
          if (!truncated) reject(e)
        })
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('抓取超时'))
        })
      })
      .catch(reject)
  })
}

async function fetchText(urlStr, { accept } = {}) {
  await wechatApi.assertSafeFetchUrl(urlStr, 0)
  const url = new URL(urlStr)
  const profiles = buildPageHeaderProfiles(url, accept)
  let lastErr = null
  for (const headers of profiles) {
    try {
      return await fetchTextOnce(urlStr, { accept, headers }, 0)
    } catch (e) {
      lastErr = e
      // 403/429 换 header 重试；其他错误直接抛
      const sc = Number(e && e.statusCode)
      if (sc !== 403 && sc !== 429) throw e
    }
  }
  throw lastErr || new Error('抓取失败')
}

function parseRssItems(xml) {
  const items = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m
  while ((m = re.exec(String(xml || '')))) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const creator =
      extractTag(block, 'dc:creator') ||
      extractTag(block, 'creator') ||
      extractTag(block, 'author')
    const pubDate = extractTag(block, 'pubDate')
    const content =
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'content') ||
      extractTag(block, 'description')
    const media = extractAttr(block, 'media:content', 'url')
    if (!link && !title) continue
    items.push({
      title,
      link: link.replace(/\?ref=proximareport\.com.*/i, ''),
      creator,
      pubDate,
      contentHtml: content,
      mediaUrl: media
    })
  }
  return items
}

function looksLikeChallengePage(body) {
  const s = String(body || '').slice(0, 4000)
  return /just a moment|cf-browser-verification|cdn-cgi\/challenge|attention required|cloudflare/i.test(s)
}

/**
 * 经 rss2json 公共中转拉 feed（绕开 Cloudflare 对腾讯云出口 IP 的 403）。
 * 直连失败时使用；上游 URL 仍先做 SSRF 校验。
 */
async function loadRssItemsViaRss2Json(rssUrl) {
  await wechatApi.assertSafeFetchUrl(rssUrl, 0)
  const key = String(process.env.OA_RSS2JSON_API_KEY || '').trim()
  let apiUrl =
    'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl)
  if (key) apiUrl += '&api_key=' + encodeURIComponent(key)
  const body = await fetchTextOnce(
    apiUrl,
    {
      accept: 'application/json',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json'
      }
    },
    0
  )
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    throw new Error('RSS 中转返回非 JSON')
  }
  if (String(parsed.status || '') !== 'ok' || !Array.isArray(parsed.items)) {
    throw new Error('RSS 中转失败: ' + (parsed.message || parsed.status || 'unknown'))
  }
  return (parsed.items || []).map((it) => ({
    title: String(it.title || ''),
    link: String(it.link || it.guid || '').replace(/\?ref=proximareport\.com.*/i, ''),
    creator: String(it.author || ''),
    pubDate: String(it.pubDate || ''),
    contentHtml: String(it.content || it.description || ''),
    mediaUrl: String(
      it.thumbnail || (it.enclosure && (it.enclosure.link || it.enclosure.url)) || ''
    )
  }))
}

/**
 * 拉 RSS 条目：直连 →（403/429/挑战页）rss2json 中转
 */
async function loadRssItems(rssUrl) {
  try {
    const xml = await fetchText(rssUrl, {
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    const items = parseRssItems(xml)
    if (items.length) return { items, via: 'direct' }
    if (looksLikeChallengePage(xml)) {
      const items2 = await loadRssItemsViaRss2Json(rssUrl)
      return { items: items2, via: 'rss2json' }
    }
    return { items, via: 'direct' }
  } catch (e) {
    const sc = Number(e && e.statusCode)
    if (sc === 403 || sc === 429) {
      console.warn('[oaFetchArticle] feed blocked HTTP', sc, '→ rss2json', rssUrl)
      const items = await loadRssItemsViaRss2Json(rssUrl)
      return { items, via: 'rss2json' }
    }
    throw e
  }
}

function normalizeArticleUrl(u) {
  try {
    const url = new URL(String(u || '').trim())
    url.hash = ''
    // 去掉追踪参数
    ;['ref', 'utm_source', 'utm_medium', 'utm_campaign'].forEach((k) => url.searchParams.delete(k))
    let s = url.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch (e) {
    return String(u || '').trim().replace(/\/$/, '')
  }
}

function urlsMatch(a, b) {
  return normalizeArticleUrl(a) === normalizeArticleUrl(b)
}

function articleFromParts({ title, html, url, coverHint }) {
  const slotted = htmlToTextWithSlots(html, url, MAX_IMAGES)
  let imageUrls = slotted.imageUrls.slice()
  const text = slotted.text
  // 封面只作 thumb，不强行插到正文首图，避免打乱原稿 [[IMG:n]] 位置
  let coverUrl = imageUrls[0] || coverHint || ''
  if (coverUrl) coverUrl = wechatApi.hotlinkSafeImageUrl(coverUrl) || coverUrl
  if (coverHint && /^https?:\/\//i.test(coverHint)) {
    const safeHint = wechatApi.hotlinkSafeImageUrl(coverHint) || coverHint
    if (!coverUrl) coverUrl = safeHint
  }
  return {
    title: String(title || '').trim().slice(0, 120),
    text,
    coverUrl,
    imageUrls: imageUrls.slice(0, MAX_IMAGES),
    sourceUrl: normalizeArticleUrl(url),
    sourceSite: (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '')
      } catch (e) {
        return ''
      }
    })()
  }
}

/**
 * 已知站点的 feed 清单（Cloudflare 等反爬挡 HTML 页时，RSS 通常放行）。
 * NSF：单站主 feed 只有最近 10 条，栏目 feed 提升命中率。
 */
const SITE_FEEDS = {
  'proximareport.com': ['https://proximareport.com/rss/'],
  'nasaspaceflight.com': [
    'https://www.nasaspaceflight.com/feed/',
    'https://www.nasaspaceflight.com/news/spacex/feed/',
    'https://www.nasaspaceflight.com/news/international/chinese/feed/'
  ]
}

function candidateFeedsFor(articleUrl) {
  try {
    const url = new URL(String(articleUrl || '').trim())
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    const known = SITE_FEEDS[host] || []
    // WordPress 通用约定 /feed/；Ghost 常见 /rss/
    const generic = [`${url.origin}/feed/`, `${url.origin}/rss/`]
    return [...known, ...generic].filter((v, i, a) => a.indexOf(v) === i)
  } catch (e) {
    return []
  }
}

/** 在站点各 feed 里按链接找同一篇文章（绕过 HTML 页反爬） */
async function fetchFromSiteFeeds(articleUrl) {
  for (const feedUrl of candidateFeedsFor(articleUrl)) {
    try {
      const { items } = await loadRssItems(feedUrl)
      const hit = items.find((it) => urlsMatch(it.link, articleUrl))
      if (!hit || !hit.contentHtml) continue
      const art = articleFromParts({
        title: hit.title,
        html: hit.contentHtml,
        url: hit.link || articleUrl,
        coverHint: hit.mediaUrl
      })
      if (art.text && art.text.length > 80) return art
    } catch (e) {
      // 单个 feed 失败继续试下一个
    }
  }
  return null
}

async function fetchFromHtml(articleUrl) {
  const html = await fetchText(articleUrl)
  let title =
    (html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
    ''
  title = stripTags(decodeXml(title)).slice(0, 120)
  const ogImage =
    (html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) || [])[1] || ''
  let bodyHtml = html
  const articleMatch =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<div[^>]*class=["'][^"']*gh-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  if (articleMatch) bodyHtml = articleMatch[1]
  return articleFromParts({
    title,
    html: bodyHtml,
    url: articleUrl,
    coverHint: decodeXml(ogImage)
  })
}

/**
 * @param {string} url
 * @returns {Promise<{ title, text, coverUrl, imageUrls, sourceUrl, sourceSite }>}
 */
async function fetchArticle(url) {
  const u = String(url || '').trim()
  if (!isHttpUrl(u)) throw new Error('非法文章 URL')
  await wechatApi.assertSafeFetchUrl(u, 0)
  const host = new URL(u).hostname.replace(/^www\./, '').toLowerCase()
  // 已知反爬站（NSF/Proxima 等）：优先走 RSS，命中即免抓 HTML
  const knownFeedHost = Object.keys(SITE_FEEDS).some(
    (h) => host === h || host.endsWith(`.${h}`)
  )
  if (knownFeedHost) {
    try {
      const fromRss = await fetchFromSiteFeeds(u)
      if (fromRss) return fromRss
    } catch (e) {
      console.warn('[oaFetchArticle] site feed pre-try fail', e.message || e)
    }
  }
  let fromHtml
  try {
    fromHtml = await fetchFromHtml(u)
  } catch (e) {
    // HTML 页被反爬拦截（Cloudflare 403/429）：兜底扫站点 feed 找同链接文章
    const sc = Number(e && e.statusCode)
    if (sc === 403 || sc === 429) {
      const fromRss = await fetchFromSiteFeeds(u).catch(() => null)
      if (fromRss) return fromRss
      const err = new Error(
        `抓取失败 HTTP ${sc}（站点反爬拦截，RSS 兜底也未命中——文章可能不在 feed 最近条目里）。` +
          '建议：把该站点栏目加入「追踪源」，新文章会自动经 RSS 采集入库。'
      )
      err.statusCode = sc
      throw err
    }
    throw e
  }
  if (!fromHtml.text || fromHtml.text.length < 40) {
    throw new Error('未能从页面提取到有效正文')
  }
  return fromHtml
}

/**
 * 拉 RSS 并按作者过滤（直连 403/429 时自动走 rss2json 中转）
 */
async function fetchRssByAuthor({ rssUrl, authorMatch, limit = 10 }) {
  const { items } = await loadRssItems(rssUrl)
  const needle = String(authorMatch || '').trim().toLowerCase()
  const filtered = needle
    ? items.filter((it) => String(it.creator || '').toLowerCase().includes(needle))
    : items
  return filtered.slice(0, Math.min(30, Math.max(1, Number(limit) || 10))).map((it) =>
    articleFromParts({
      title: it.title,
      html: it.contentHtml,
      url: it.link,
      coverHint: it.mediaUrl
    })
  )
}

module.exports = {
  isHttpUrl,
  looksLikeLoneUrl,
  normalizeArticleUrl,
  fetchArticle,
  fetchRssByAuthor,
  fetchFromSiteFeeds,
  candidateFeedsFor,
  parseRssItems,
  loadRssItems,
  loadRssItemsViaRss2Json,
  stripTags,
  collectImgUrls,
  htmlToTextWithSlots,
  MAX_IMAGES
}
