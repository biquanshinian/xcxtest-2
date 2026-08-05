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
    // 跳过明显视频
    if (/\.(mp4|mov|webm|m3u8)(\?|$)/i.test(s)) return
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

/** 去掉 markdown 里指定外链图（跳过坏图时用） */
function stripMarkdownImages(md, urls) {
  let s = String(md || '')
  for (const u of urls || []) {
    if (!u) continue
    const esc = String(u).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s.replace(new RegExp(`!\\[[^\\]]*\\]\\(${esc}(?:\\s+"[^"]*")?\\)`, 'g'), '')
  }
  return s.replace(/\n{3,}/g, '\n\n').trim()
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
  normalizeImgSrc,
  collectHtmlImgSrcs,
  isWechatCdnUrl,
  isOwnedWxImage,
  collectMarkdownImageUrls,
  isDefaultOrCoverOnlyUrl,
  resolveBodyImageUrls,
  applyImageMapToMarkdown,
  stripMarkdownImages,
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
