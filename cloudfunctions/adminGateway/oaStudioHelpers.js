/**
 * 公众号内容中台：纯函数工具（无 db / 无副作用）
 * 从 oaContentStudio 拆出，降低上帝模块耦合；可独立单测。
 */
const wechatApi = require('./oaWechatApi')

function coerceBool(v, defaultValue) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true
  if (v === false || v === 0 || v === '0' || v === 'false') return false
  return defaultValue
}

/** 从多来源候选里收敛出图片 URL 列表（去重、剔除视频，最多 8 张） */
function pickImageUrls(...candidates) {
  const out = []
  const push = (u) => {
    const s = String(u || '').trim()
    if (!/^https?:\/\//i.test(s)) return
    // 跳过明显视频；但万象截帧（.mp4?ci-process=snapshot）出图为 jpg，属于图片
    if (/\.(mp4|mov|webm|m3u8)(\?|$)/i.test(s) && !/ci-process=snapshot/i.test(s)) return
    if (!out.includes(s)) out.push(s)
  }
  for (const c of candidates) {
    if (!c) continue
    if (typeof c === 'string') push(c)
    else if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === 'string') push(item)
        else if (item && typeof item === 'object') {
          const t = String(item.type || item.mediaType || '').toLowerCase()
          if (t === 'video') continue
          push(item.url || item.src || item.thumb || item.cover || item.image)
        }
      }
    }
  }
  return out.slice(0, 8)
}

// ===== 视频素材（公众号日更流水线支持视频：正文/封面用「视频封面截图」承载） =====

/** 自有 COS（含 CDN 前缀差异，按桶 ID 判断） */
function isOwnCosUrl(u) {
  const s = String(u || '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  try {
    const host = new URL(s).hostname.toLowerCase()
    return host.includes('1397421562') && host.endsWith('.myqcloud.com')
  } catch (e) {
    return /1397421562[^/]*\.myqcloud\.com/i.test(s)
  }
}

function isVideoFileUrl(u) {
  const path = String(u || '').split('?')[0].toLowerCase()
  return /\.(mp4|mov|m4v|webm|mkv)$/.test(path)
}

/**
 * 微信「阅读原文」content_source_url 只适合网页，不适合裸视频文件。
 * COS/CDN 直链 mp4 在微信内置浏览器里常打不开或被强制下载。
 */
function isHttpPageUrl(u) {
  const s = String(u || '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  if (isVideoFileUrl(s)) return false
  return true
}

/**
 * 草稿「阅读原文」候选：真实来源页 / 推文页优先；绝不回落 COS/外链裸 mp4。
 */
function resolveDraftSourceUrl(source, videos) {
  const src = String((source && source.sourceUrl) || '').trim()
  if (isHttpPageUrl(src)) return src
  for (const v of Array.isArray(videos) ? videos : []) {
    const page = String((v && v.pageUrl) || '').trim()
    if (isHttpPageUrl(page)) return page
  }
  return ''
}

/** 推送前再挡一层：旧草稿若已写入视频直链，不落 content_source_url */
function sanitizeContentSourceUrl(u) {
  return isHttpPageUrl(u) ? String(u).trim() : ''
}

/**
 * 自有 COS 视频 → 万象截帧封面（jpg）。
 * 长视频未落 COS（url 是推文页/外链）时返回 ''，封面只能靠 thumbnailUrl。
 */
function cosVideoSnapshotUrl(videoUrl, second) {
  const s = String(videoUrl || '').trim()
  if (!isOwnCosUrl(s) || !isVideoFileUrl(s)) return ''
  const t = Number(second) > 0 ? Number(second) : 1
  return `${s.split('?')[0]}?ci-process=snapshot&time=${t}&format=jpg&width=720&height=0`
}

const LONG_VIDEO_DURATION_SEC = 120

/**
 * 从多来源候选（mediaList / videos 字段 / 裸 mp4 链接）收敛视频列表，最多 4 条。
 * 每条：{ url(直链 mp4，可为空), pageUrl(推文/来源页), posterUrl(封面截图), watchUrl(观看首选链), isLong }
 * posterUrl 优先缩略图，其次自有 COS 万象截帧 —— 保证长视频也有封面截图。
 */
function pickVideoEntries(...candidates) {
  const out = []
  const seen = new Set()
  const pushEntry = (entry) => {
    if (!entry) return
    const url = String(entry.url || '').trim()
    const pageUrl = String(entry.pageUrl || '').trim()
    const posterUrl = String(entry.posterUrl || '').trim()
    if (!url && !pageUrl && !posterUrl) return
    const key = url || pageUrl || posterUrl
    if (seen.has(key)) return
    seen.add(key)
    // 观看首选：自有 COS 压缩预览（境内可开、体积小）→ COS 原片 → 来源页 → 站外直链
    const watchUrl =
      (isOwnCosUrl(entry.previewUrl) && String(entry.previewUrl || '').trim()) ||
      (isOwnCosUrl(url) && url) ||
      pageUrl ||
      url ||
      ''
    out.push({
      url,
      pageUrl,
      posterUrl,
      watchUrl,
      isLong: !!entry.isLong
    })
  }
  const fromObject = (m) => {
    if (!m || typeof m !== 'object') return
    const type = String(m.type || m.mediaType || '').toLowerCase()
    const rawUrl = String(m.url || m.src || '').trim()
    const directUrl = String(m.videoUrl || '').trim()
    const previewUrl = String(m.previewUrl || '').trim()
    if (type !== 'video' && !isVideoFileUrl(rawUrl) && !directUrl && !previewUrl) return
    // mediaList 约定：长视频未存 COS 时 url 是推文页链接
    const fileUrl = isVideoFileUrl(rawUrl) ? rawUrl : ''
    const pageUrl =
      String(m.sourceUrl || m.tweetUrl || '').trim() || (!fileUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : '')
    const duration = Number(m.duration || m.durationSec || 0)
    const posterUrl =
      String(m.thumbnailUrl || m.posterUrl || m.poster || m.thumb || m.cover || '').trim() ||
      cosVideoSnapshotUrl(fileUrl) ||
      cosVideoSnapshotUrl(previewUrl)
    pushEntry({
      url: fileUrl || directUrl || previewUrl,
      previewUrl,
      pageUrl,
      posterUrl,
      // wasLongVideo：回填落 COS 后 isLongVideo 被摘除时保留的长视频标记
      isLong:
        coerceBool(m.isLongVideo, false) ||
        coerceBool(m.wasLongVideo, false) ||
        duration > LONG_VIDEO_DURATION_SEC
    })
  }
  for (const c of candidates) {
    if (!c) continue
    if (typeof c === 'string') {
      const s = c.trim()
      if (/^https?:\/\//i.test(s) && isVideoFileUrl(s)) {
        pushEntry({ url: s, posterUrl: cosVideoSnapshotUrl(s) })
      }
      continue
    }
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === 'string') {
          const s = item.trim()
          if (/^https?:\/\//i.test(s) && isVideoFileUrl(s)) {
            pushEntry({ url: s, posterUrl: cosVideoSnapshotUrl(s) })
          }
        } else {
          fromObject(item)
        }
      }
      continue
    }
    fromObject(c)
  }
  return out.slice(0, 4)
}

/** 视频封面截图对应的图片 URL 列表（并入配图/封面池用） */
function videoPosterUrls(videos) {
  const out = []
  for (const v of Array.isArray(videos) ? videos : []) {
    const s = String((v && v.posterUrl) || '').trim()
    if (/^https?:\/\//i.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * 在成稿 markdown 里给视频封面截图补说明行（blockquote，运营可编辑/删除）。
 * readMoreUrl 与该视频 pageUrl/watchUrl 一致且为网页时，才提示「阅读原文」。
 */
function annotateVideoPostersInMarkdown(md, videos, opts = {}) {
  let s = String(md || '')
  if (!s) return s
  const readMoreUrl = sanitizeContentSourceUrl((opts && opts.readMoreUrl) || '')
  const done = new Set()
  for (const v of Array.isArray(videos) ? videos : []) {
    const poster = normalizeImgSrc(v && v.posterUrl)
    if (!poster || done.has(poster)) continue
    done.add(poster)
    const esc = poster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(!\\[[^\\]]*\\]\\(${esc}(?:\\s+"[^"]*")?\\))(?!\\s*\\n+>\\s*▶)`)
    if (!re.test(s)) continue
    const label = v.isLong ? '长视频封面截图' : '视频封面截图'
    const matchesVideo =
      readMoreUrl &&
      (v.watchUrl === readMoreUrl || v.pageUrl === readMoreUrl)
    const tail = matchesVideo ? '，完整视频点文末「阅读原文」' : ''
    s = s.replace(re, `$1\n\n> ▶ ${label}${tail}`)
  }
  return s
}

function normalizeImgSrc(u) {
  return String(u || '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

function collectHtmlImgSrcs(html) {
  const srcs = []
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    const s = normalizeImgSrc(m[1])
    if (s && !srcs.includes(s)) srcs.push(s)
  }
  return srcs
}

function isWechatCdnUrl(u) {
  return /(?:mmbiz|mmsns|mmecoa)?\.?qpic\.cn|(?:mmbiz\.)?qlogo\.cn/i.test(String(u || ''))
}

/**
 * 配图跳转小程序要求图片经「本公众号」uploadimg。
 * 他人 mmbiz 直链可显示，但 data-miniprogram 图链常无点击；
 * 仅当本槽位曾 uploadimg 得到的地址才算 owned。
 */
function isOwnedWxImage(src, imageMap, uploadSlot, currentSlot) {
  const s = normalizeImgSrc(src)
  if (!s) return false
  // 空 uploadSlot 不可信（禁止 normalize 成默认槽 1）
  const us = String(uploadSlot == null ? '' : uploadSlot).trim()
  if (!us) return false
  if (wechatApi.normalizeSlot(us) !== wechatApi.normalizeSlot(currentSlot)) return false
  const map = imageMap || {}
  // 外链/他人图已映射到本槽 uploadimg 产物
  if (map[s] && map[s] !== s && isWechatCdnUrl(map[s])) return true
  // src 本身就是本槽产物（出现在某条 u→w 的 w 上）
  if (isWechatCdnUrl(s)) {
    for (const [u, w] of Object.entries(map)) {
      if (w === s && u !== w) return true
    }
  }
  return false
}

function collectMarkdownImageUrls(md) {
  const out = []
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)/gi
  let m
  while ((m = re.exec(String(md || '')))) {
    const u = normalizeImgSrc(m[1])
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}

/**
 * 是否为「仅封面」用的默认/封面链（不应当作正文配图去转存/注入）。
 */
function isDefaultOrCoverOnlyUrl(url, draft, brand, cfg) {
  const u = normalizeImgSrc(url)
  if (!u) return false
  const pool = [draft && draft.coverUrl, brand && brand.defaultCoverUrl, cfg && cfg.defaultCoverUrl]
    .map((x) => normalizeImgSrc(x))
    .filter(Boolean)
  return pool.includes(u)
}

/**
 * 正文配图列表（不含纯封面/默认封面）。
 * 事件无配图、只挂了默认链接封面时，不应进入「配图上传未完成 0/N」。
 */
function resolveBodyImageUrls(draft, brand, cfg) {
  const mdImgs = collectMarkdownImageUrls((draft && draft.markdown) || '')
  const slotted = String((draft && draft.sourceSlottedBody) || '')
  const hasSlots = /\[\[IMG:\s*\d+\s*\]\]/i.test(slotted)
  // 正文与原稿都无图位：纯封面稿（默认链接封面），绝不当正文配图去转存
  if (!mdImgs.length && !hasSlots) return []

  const mdSet = new Set(mdImgs.map(normalizeImgSrc))
  const fromFields = pickImageUrls(
    draft && draft.imageUrls,
    draft && draft.images,
    draft && draft.sourceImageUrls
  )
  const out = []
  const push = (u) => {
    const s = normalizeImgSrc(u)
    if (!/^https?:\/\//i.test(s)) return
    if (out.includes(s)) return
    if (mdSet.has(s)) {
      out.push(s)
      return
    }
    if (isDefaultOrCoverOnlyUrl(s, draft, brand, cfg)) return
    out.push(s)
  }
  mdImgs.forEach(push)
  fromFields.forEach(push)
  return out.slice(0, 8)
}

function applyImageMapToMarkdown(md, map) {
  let s = String(md || '')
  if (!map || typeof map !== 'object') return s
  const keys = Object.keys(map).sort((a, b) => b.length - a.length)
  for (const from of keys) {
    const to = map[from]
    if (!from || !to || from === to) continue
    if (s.includes(from)) s = s.split(from).join(to)
  }
  return s
}

/** 去掉 markdown 里指定外链图（跳过坏图时用）；视频封面被丢时连带清掉「> ▶」说明行 */
function stripMarkdownImages(md, urls) {
  let s = String(md || '')
  for (const u of urls || []) {
    if (!u) continue
    const esc = String(u).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s.replace(
      new RegExp(`!\\[[^\\]]*\\]\\(${esc}(?:\\s+"[^"]*")?\\)(?:\\s*\\n+>\\s*▶[^\\n]*)?`, 'g'),
      ''
    )
  }
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 判断摘要是否被「封面图」污染（常见：`![封面](url)` 去标点后变成「封面https://…」）
 * 这类文案会出现在微信分享卡片描述里，必须拦截。
 */
function looksLikeCoverLinkDigest(s) {
  const t = String(s || '').trim()
  if (!t) return true
  if (/^封面\s*https?:\/\//i.test(t)) return true
  if (/^https?:\/\//i.test(t)) return true
  if (/^(封面|配图|头图|封面图)/i.test(t) && /https?:\/\//i.test(t.slice(0, 80))) return true
  const withoutUrls = t.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  if (/https?:\/\/[^\s]{16,}/i.test(t.slice(0, 100)) && withoutUrls.length < 10) return true
  return false
}

/**
 * 从 Markdown 正文生成微信 digest（分享卡片描述）。
 * 必须整段去掉图片语法，不能只删 `![]()` 标点（否则留下「封面+URL」）。
 */
function markdownToDigest(md, maxLen = 120) {
  let s = String(md || '')
  // 文首一级标题通常与推送 title 重复，不进分享摘要
  s = s.replace(/^#[^\n]*\n+/, '')
  // 图片整段删除（含 alt）
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  // 链接保留可读文字
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 裸 URL / 引用行前缀 / 标题井号
  s = s.replace(/https?:\/\/\S+/gi, ' ')
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/^>\s?/gm, '')
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`[^`]*`/g, ' ')
  s = s.replace(/[*_~|>\\]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^(封面|配图|头图|封面图|hero)\s*/i, '')
  // 分隔线残留
  s = s.replace(/^-{2,}\s*/g, '').trim()
  return s.slice(0, Math.max(1, Number(maxLen) || 120))
}

/** 优先用显式 digest；若空或被封面链污染，则从 markdown 重算 */
function resolveArticleDigest(source, markdownFallback, maxLen = 120) {
  const md =
    markdownFallback != null
      ? String(markdownFallback || '')
      : String((source && source.markdown) || '')
  const explicit = String((source && source.digest) || '').trim()
  if (explicit && !looksLikeCoverLinkDigest(explicit)) {
    return explicit.slice(0, maxLen)
  }
  return markdownToDigest(md, maxLen)
}

/**
 * 云库文档字段名不能含 `.`，URL 作 key 会丢数据。
 * 用数组 [{u,w}] / [{u,n}] 存，兼容读取旧 object。
 */
function decodeImageMap(draft) {
  const map = {}
  if (Array.isArray(draft && draft.wxImageEntries)) {
    for (const row of draft.wxImageEntries) {
      const u = normalizeImgSrc(row && row.u)
      const w = String((row && row.w) || '')
      if (u && isWechatCdnUrl(w)) map[u] = w
    }
  }
  const obj = draft && draft.wxImageMap
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = normalizeImgSrc(k)
      if (key && isWechatCdnUrl(v)) map[key] = String(v)
    }
  }
  return map
}

function decodeFailMap(draft) {
  const fail = {}
  if (Array.isArray(draft && draft.wxImageFailEntries)) {
    for (const row of draft.wxImageFailEntries) {
      const u = normalizeImgSrc(row && row.u)
      if (u) fail[u] = Number(row.n || 0)
    }
  }
  const obj = draft && draft.wxImageFail
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = normalizeImgSrc(k)
      if (key) fail[key] = Number(v || 0)
    }
  }
  return fail
}

function encodeImageEntries(map) {
  return Object.keys(map || {}).map((u) => ({ u, w: map[u] }))
}

function encodeFailEntries(failMap) {
  return Object.keys(failMap || {}).map((u) => ({ u, n: Number(failMap[u] || 0) }))
}

function looksLikeLlmFallbackMarkdown(md) {
  return /自动生成暂不可用|以下为素材整理稿|需人工改写后/.test(String(md || ''))
}

/**
 * 剥掉 LLM 兜底稿的引导语行（"> 自动生成暂不可用…请人工改写后保存再推送。"）。
 * 用户改写正文后常忘删这行，导致关键词判定永远打回 needs_review。
 */
function stripLlmFallbackNotice(md) {
  return String(md || '')
    .split('\n')
    .filter((line) => !/自动生成暂不可用|以下为素材整理稿|请人工改写后|需人工改写后/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normForCompare(s) {
  return String(s || '')
    .replace(/\[\[IMG:\d+\]\]/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[\s#>*`\-—\[\]()（）!！。，,.:：;；'"“”‘’]/g, '')
    .toLowerCase()
}

/**
 * 判定"是否仍是原素材照搬"（未实质改写）：
 * 从素材取 3 段连续文字探针，≥2 段原样出现在成稿里才算照搬。
 * 真改写（尤其英文素材洗成中文）不会保留素材的长连续原文。
 */
function looksLikeUnrewrittenSource(md, sourceBody) {
  const a = normForCompare(stripLlmFallbackNotice(md))
  const b = normForCompare(sourceBody)
  if (!a || !b || b.length < 60) return false
  const probes = []
  for (const at of [0.15, 0.45, 0.75]) {
    const i = Math.floor(b.length * at)
    const p = b.slice(i, i + 60)
    if (p.length >= 40) probes.push(p)
  }
  if (!probes.length) return a.includes(b.slice(0, 40))
  const hits = probes.filter((p) => a.includes(p)).length
  return hits >= 2
}

function sanitizeWxTitle(title) {
  return String(title || '未命名')
    .replace(/[\r\n\t\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
}

/** 凭证槽未配置的统一报错文案（槽 1 兼容无后缀环境变量） */
function credentialMissingMsg(slot) {
  const s = String(slot || '1').trim() || '1'
  return s === '1'
    ? '发稿号凭证槽 1 未配置（WECHAT_OA_APPID / WECHAT_OA_SECRET）'
    : `发稿号凭证槽 ${s} 未配置（WECHAT_OA_APPID_${s} / WECHAT_OA_SECRET_${s}）`
}

/** 草稿时间线：追加事件并截断，保留最近 20 条 */
function appendTimeline(draft, event, detail) {
  const list = Array.isArray(draft && draft.pushTimeline) ? draft.pushTimeline.slice() : []
  list.push({ t: Date.now(), e: String(event || ''), d: String(detail || '').slice(0, 200) })
  return list.slice(-20)
}

module.exports = {
  coerceBool,
  pickImageUrls,
  isOwnCosUrl,
  isVideoFileUrl,
  isHttpPageUrl,
  resolveDraftSourceUrl,
  sanitizeContentSourceUrl,
  cosVideoSnapshotUrl,
  pickVideoEntries,
  videoPosterUrls,
  annotateVideoPostersInMarkdown,
  normalizeImgSrc,
  collectHtmlImgSrcs,
  isWechatCdnUrl,
  isOwnedWxImage,
  collectMarkdownImageUrls,
  isDefaultOrCoverOnlyUrl,
  resolveBodyImageUrls,
  applyImageMapToMarkdown,
  stripMarkdownImages,
  looksLikeCoverLinkDigest,
  markdownToDigest,
  resolveArticleDigest,
  decodeImageMap,
  decodeFailMap,
  encodeImageEntries,
  encodeFailEntries,
  looksLikeLlmFallbackMarkdown,
  stripLlmFallbackNotice,
  looksLikeUnrewrittenSource,
  sanitizeWxTitle,
  credentialMissingMsg,
  appendTimeline
}
