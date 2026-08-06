/**
 * Markdown / 纯文本 → 微信公众号兼容内联 HTML（轻量）
 */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineFormat(text) {
  let s = escapeHtml(text)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
  s = s.replace(/`(.+?)`/g, '<code style="background:#f5f5f5;padding:2px 4px;border-radius:3px;">$1</code>')
  s = s.replace(
    /\[(.+?)\]\((https?:\/\/[^\s)"']+)\)/g,
    (_, label, href) =>
      `<a href="${escapeHtml(href)}" style="color:#576b95;text-decoration:none;">${label}</a>`
  )
  return s
}

const THEMES = {
  clean: {
    h2: 'margin:28px 0 12px;font-size:18px;font-weight:700;color:#1a1a1a;border-left:4px solid #2f6bff;padding-left:10px;',
    h3: 'margin:20px 0 10px;font-size:16px;font-weight:600;color:#333;',
    p: 'margin:0 0 14px;line-height:1.85;font-size:15px;color:#3a3a3a;letter-spacing:0.02em;',
    quote:
      'margin:16px 0;padding:12px 14px;background:#f7f8fa;border-left:3px solid #c0c4cc;color:#606266;line-height:1.7;',
    li: 'margin:0 0 8px;line-height:1.7;font-size:15px;color:#3a3a3a;'
  },
  diary: {
    h2: 'margin:28px 0 12px;font-size:18px;font-weight:700;color:#1f2a44;text-align:center;',
    h3: 'margin:20px 0 10px;font-size:16px;font-weight:600;color:#334155;',
    p: 'margin:0 0 16px;line-height:1.9;font-size:15px;color:#334155;',
    quote:
      'margin:16px 0;padding:14px;background:#f0f4ff;border-radius:8px;color:#475569;line-height:1.75;',
    li: 'margin:0 0 8px;line-height:1.75;font-size:15px;color:#334155;'
  },
  brief: {
    h2: 'margin:22px 0 10px;font-size:17px;font-weight:700;color:#111;border-bottom:1px solid #eee;padding-bottom:6px;',
    h3: 'margin:16px 0 8px;font-size:15px;font-weight:600;color:#222;',
    p: 'margin:0 0 12px;line-height:1.75;font-size:15px;color:#333;',
    quote: 'margin:12px 0;padding:10px 12px;background:#fafafa;color:#666;line-height:1.6;',
    li: 'margin:0 0 6px;line-height:1.65;font-size:15px;color:#333;'
  }
}

function markdownToWechatHtml(md, themeId = 'clean') {
  const theme = THEMES[themeId] || THEMES.clean
  // 行内图 / 带 title 的图拆成独立行，避免被 inlineFormat 误当成 <a>
  const normalized = String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(
      /!\[([^\]]*)\]\((https?:\/\/[^\s)"']+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g,
      '\n\n![$1]($2)\n\n'
    )
  const lines = normalized.split('\n')
  const out = []
  let inList = false
  let inQuote = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>')
      inQuote = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      closeQuote()
      continue
    }
    if (/^---+$/.test(line.trim())) {
      closeList()
      closeQuote()
      out.push('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />')
      continue
    }
    // 配图：![说明](https://...) 或单独一行图片 URL
    const mdImg = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)"']+)\)$/)
    if (mdImg) {
      closeList()
      closeQuote()
      out.push(
        `<p style="margin:16px 0;text-align:center;"><img src="${escapeHtml(
          mdImg[2]
        )}" alt="${escapeHtml(mdImg[1] || '')}" style="max-width:100%;height:auto;border-radius:4px;" /></p>`
      )
      continue
    }
    const bareUrl = line.trim().match(/^(https?:\/\/[^\s]+\.(?:jpe?g|png|gif|webp)(?:\?[^\s]*)?)$/i)
    if (bareUrl) {
      closeList()
      closeQuote()
      out.push(
        `<p style="margin:16px 0;text-align:center;"><img src="${escapeHtml(
          bareUrl[1]
        )}" alt="" style="max-width:100%;height:auto;border-radius:4px;" /></p>`
      )
      continue
    }
    if (/^###\s+/.test(line)) {
      closeList()
      closeQuote()
      out.push(`<h3 style="${theme.h3}">${inlineFormat(line.replace(/^###\s+/, ''))}</h3>`)
      continue
    }
    if (/^##\s+/.test(line)) {
      closeList()
      closeQuote()
      out.push(`<h2 style="${theme.h2}">${inlineFormat(line.replace(/^##\s+/, ''))}</h2>`)
      continue
    }
    if (/^#\s+/.test(line)) {
      closeList()
      closeQuote()
      out.push(`<h2 style="${theme.h2}">${inlineFormat(line.replace(/^#\s+/, ''))}</h2>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      closeList()
      if (!inQuote) {
        out.push(`<blockquote style="${theme.quote}">`)
        inQuote = true
      }
      out.push(`<p style="margin:0 0 8px;">${inlineFormat(line.replace(/^>\s?/, ''))}</p>`)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      closeQuote()
      if (!inList) {
        out.push('<ul style="padding-left:1.2em;margin:0 0 14px;">')
        inList = true
      }
      out.push(`<li style="${theme.li}">${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }
    closeList()
    closeQuote()
    out.push(`<p style="${theme.p}">${inlineFormat(line)}</p>`)
  }
  closeList()
  closeQuote()
  return out.join('\n')
}

function stripTitleFromMarkdown(md) {
  const text = String(md || '').trim()
  const m = text.match(/^#\s+(.+)\n+([\s\S]*)$/)
  if (m) return { title: m[1].trim().slice(0, 64), body: m[2].trim() }
  return { title: '', body: text }
}

function extractJsonBlock(text) {
  const raw = String(text || '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  const obj = candidate.match(/\{[\s\S]*\}/)
  if (!obj) return null
  try {
    return JSON.parse(obj[0])
  } catch (e) {
    return null
  }
}

function buildImageMarkdown(urls, max = 8) {
  const list = (urls || []).map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u))
  const uniq = []
  for (const u of list) {
    if (!uniq.includes(u)) uniq.push(u)
    if (uniq.length >= max) break
  }
  if (!uniq.length) return ''
  return uniq.map((u, i) => `![配图${i + 1}](${u})`).join('\n\n') + '\n\n'
}

/**
 * 纯文本素材插入 [[IMG:n]]：
 * - 单图：置顶作头图
 * - 多图：按段落均匀穿插，供 LLM 跟随落点
 */
function ensureImageSlotsInBody(text, urls, max = 8) {
  const list = []
  for (const u of urls || []) {
    const s = String(u || '').trim()
    if (!/^https?:\/\//i.test(s) || list.includes(s)) continue
    list.push(s)
    if (list.length >= max) break
  }
  let body = String(text || '').trim()
  if (!list.length) return body
  if (/\[\[IMG:\s*\d+\s*\]\]/i.test(body)) {
    // 已有原稿占位：严格保留；单图再统一抬到文首（头图策略）
    if (list.length === 1) {
      const only = (body.match(/\[\[IMG:\s*1\s*\]\]/i) || [])[0] || '[[IMG:1]]'
      const rest = body
        .replace(/\[\[IMG:\s*\d+\s*\]\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return rest ? `${only}\n\n${rest}` : only
    }
    return body
  }

  // 单图 / 无正文仅待插一张：直接头图置顶
  if (list.length === 1) {
    return body ? `[[IMG:1]]\n\n${body}` : '[[IMG:1]]'
  }

  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (!paras.length) {
    return list.map((_, i) => `[[IMG:${i + 1}]]`).join('\n\n')
  }

  const out = []
  let imgIdx = 0
  for (let i = 0; i < paras.length; i++) {
    out.push(paras[i])
    // 段落进度每越过一张图的「目标比例」就插一张；允许一段后连插多张，
    // 避免段落数少于图数时剩余图全部堆到文末
    const progress = (i + 1) / paras.length
    while (imgIdx < list.length && progress >= (imgIdx + 1) / (list.length + 1)) {
      out.push(`[[IMG:${imgIdx + 1}]]`)
      imgIdx += 1
    }
  }
  while (imgIdx < list.length) {
    out.push(`[[IMG:${imgIdx + 1}]]`)
    imgIdx += 1
  }
  return out.join('\n\n')
}

function normalizeImageUrlList(urls, max = 8) {
  const list = []
  for (const u of urls || []) {
    const s = String(u || '').trim()
    if (!/^https?:\/\//i.test(s) || list.includes(s)) continue
    list.push(s)
    if (list.length >= max) break
  }
  return list
}

/** 按 [[IMG:n]] 切开，保留原稿图序与相对位置 */
function tokenizeImageSlots(text) {
  const parts = []
  const s = String(text || '')
  const re = /\[\[IMG:\s*(\d+)\s*\]\]/gi
  let last = 0
  let m
  while ((m = re.exec(s))) {
    const before = s.slice(last, m.index).trim()
    if (before) parts.push({ type: 'text', text: before })
    parts.push({ type: 'img', n: Number(m[1]) })
    last = m.index + m[0].length
  }
  const tail = s.slice(last).trim()
  if (tail) parts.push({ type: 'text', text: tail })
  return parts
}

/**
 * 严格按原稿 [[IMG:n]] 位置落图：
 * - 图片顺序/夹插位置跟 sourceSlotted 一致
 * - 成稿文字按原稿文本段「字数占比」填入（按段数均分会让长短悬殊时图整体漂移）
 * - opts.preserveIndex=true 时 urls 按下标严格对应 IMG:n（空串=该图已丢弃，跳过不移位）
 */
function placeImagesAlignedToSource(llmBody, sourceSlotted, urls, max = 8, opts = {}) {
  const preserveIndex = !!(opts && opts.preserveIndex)
  const list = preserveIndex
    ? (urls || []).slice(0, Math.max(max, (urls || []).length)).map((u) => String(u || '').trim())
    : normalizeImageUrlList(urls, max)
  const srcParts = tokenizeImageSlots(sourceSlotted)
  const hasSrcSlots = srcParts.some((p) => p.type === 'img')
  if (!hasSrcSlots) {
    return placeImagesInMarkdown(llmBody, list.filter(Boolean), max, { redistribute: false })
  }
  if (!list.some(Boolean)) {
    return String(llmBody || '')
      .replace(/\[\[IMG:\s*\d+\s*\]\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  let llmClean = String(llmBody || '')
    .replace(/\[\[IMG:\s*\d+\s*\]\]/gi, '\n\n')
    .replace(/!\[[^\]]*\]\(https?:\/\/[^)\s]+(?:\s+"[^"]*")?\)/gi, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const llmParas = llmClean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  const textParts = srcParts.filter((p) => p.type === 'text')
  const textCount = Math.max(1, textParts.length || 1)
  const buckets = Array.from({ length: textCount }, () => [])
  if (llmParas.length) {
    // 按原稿各文本段字数的累计占比分桶，成稿段落顺序不变
    const lens = textParts.map((p) => Math.max(1, String(p.text || '').length))
    const totalLen = lens.reduce((a, b) => a + b, 0) || 1
    const cumRatio = []
    let acc = 0
    for (const L of lens) {
      acc += L
      cumRatio.push(acc / totalLen)
    }
    const totalParas = llmParas.length
    let bi = 0
    for (let i = 0; i < totalParas; i++) {
      const progress = (i + 1) / totalParas
      while (bi < textCount - 1 && progress > cumRatio[bi]) bi += 1
      buckets[bi].push(llmParas[i])
    }
  }

  let ti = 0
  const out = []
  for (const part of srcParts) {
    if (part.type === 'img') {
      const u = list[part.n - 1]
      if (u) out.push(`![配图${part.n}](${u})`)
      continue
    }
    const chunk =
      buckets[ti] && buckets[ti].length ? buckets[ti].join('\n\n') : String(part.text || '').trim()
    if (chunk) out.push(chunk)
    ti += 1
  }
  while (ti < buckets.length) {
    if (buckets[ti].length) out.push(buckets[ti].join('\n\n'))
    ti += 1
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 成稿落图：
 * 1) [[IMG:n]] → 真实 Markdown 图
 * 2) redistribute=true 时才把未使用的图按段落补插（默认 false，避免错位）
 */
function placeImagesInMarkdown(bodyMd, urls, max = 8, opts = {}) {
  const redistribute = !!(opts && opts.redistribute)
  const list = normalizeImageUrlList(urls, max)
  let body = String(bodyMd || '')
  if (!list.length) {
    return body.replace(/\[\[IMG:\s*\d+\s*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim()
  }

  const usedIdx = new Set()
  {
    const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi
    let m
    while ((m = re.exec(body))) {
      const i = list.indexOf(m[1])
      if (i >= 0) usedIdx.add(i)
    }
  }

  body = body.replace(/\[\[IMG:\s*(\d+)\s*\]\]/gi, (_, n) => {
    const idx = Number(n) - 1
    if (!(idx >= 0 && idx < list.length)) return ''
    usedIdx.add(idx)
    return `![配图${idx + 1}](${list[idx]})`
  })

  body = body.replace(/!\[([^\]]*)\]\(\s*\)/g, '')

  if (!redistribute) {
    return body.replace(/\n{3,}/g, '\n\n').trim()
  }

  const unused = []
  for (let i = 0; i < list.length; i++) {
    if (!usedIdx.has(i) && !body.includes(list[i])) unused.push({ u: list[i], i })
  }
  if (!unused.length) {
    return body.replace(/\n{3,}/g, '\n\n').trim()
  }

  const paras = body.split(/\n{2,}/)
  if (paras.length <= 1) {
    const block = unused.map(({ u, i }) => `![配图${i + 1}](${u})`).join('\n\n')
    return (body.trim() + '\n\n' + block).replace(/\n{3,}/g, '\n\n').trim()
  }

  const insertAt = []
  for (let k = 0; k < unused.length; k++) {
    const pos = Math.min(
      paras.length - 1,
      Math.max(1, Math.round(((k + 1) * paras.length) / (unused.length + 1)))
    )
    insertAt.push(pos)
  }
  for (let k = unused.length - 1; k >= 0; k--) {
    const pos = insertAt[k]
    const { u, i } = unused[k]
    paras.splice(pos, 0, `![配图${i + 1}](${u})`)
  }
  return paras.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 头图策略：
 * - 正文仅 1 张图 → 移到文首
 * - 正文 0 张图但有封面 → 封面作头图置顶
 * - 多图 → 不动（保持原稿/成稿穿插）
 */
function ensureHeroImagePlacement(bodyMd, opts = {}) {
  const coverUrl = String((opts && opts.coverUrl) || '').trim()
  let body = String(bodyMd || '').replace(/\n{3,}/g, '\n\n').trim()
  const imgRe = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi
  const images = []
  let m
  while ((m = imgRe.exec(body))) {
    images.push({ full: m[0], url: m[2], index: m.index, len: m[0].length })
  }

  if (images.length > 1) return body

  if (images.length === 1) {
    const img = images[0]
    const leading = body.slice(0, img.index).trim()
    if (!leading) return body
    const without = (body.slice(0, img.index) + body.slice(img.index + img.len))
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const hero = img.full.replace(/^!\[([^\]]*)\]/, '![头图]')
    return `${hero}\n\n${without}`.replace(/\n{3,}/g, '\n\n').trim()
  }

  if (/^https?:\/\//i.test(coverUrl)) {
    // 避免重复：正文已含该封面链则只抬到文首（上面 0 图分支不会走到）
    return `![头图](${coverUrl})\n\n${body}`.replace(/\n{3,}/g, '\n\n').trim()
  }
  return body
}

/** @deprecated 兼容旧调用 */
function mergeImageMarkdown(bodyMd, urls, max = 8) {
  return placeImagesInMarkdown(bodyMd, urls, max, { redistribute: false })
}

module.exports = {
  THEMES,
  markdownToWechatHtml,
  stripTitleFromMarkdown,
  extractJsonBlock,
  escapeHtml,
  buildImageMarkdown,
  mergeImageMarkdown,
  ensureImageSlotsInBody,
  placeImagesInMarkdown,
  placeImagesAlignedToSource,
  ensureHeroImagePlacement,
  tokenizeImageSlots
}
