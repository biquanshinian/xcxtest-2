/**
 * 微信贴图文案：去配图占位与旧稿小程序短链，按内容补微信话题。
 * 话题必须写成 #话题#（两侧井号）才会在微信里变成蓝色标签。
 * 纯函数，浏览器与云函数均可引用。
 */
const NEWSPIC_CONTENT_MAX_BYTES = 2000
const NEWSPIC_MP_LINK = '#小程序://火星探索/14h5DEboAtHOcwf'
const NEWSPIC_MP_RE = /#小程序:\/\/[^\s#]+/g
const NEWSPIC_IMG_SLOT_RE = /\[\[\s*IMG\s*:\s*\d+\s*\]\]/gi
const NEWSPIC_MAX_TOPICS = 4
const NEWSPIC_TOPIC_MAX_CHARS = 20
const NEWSPIC_TOPIC_TOKEN_RE = /#(?!小程序:\/\/)([^#\s]{1,20})#?/g

/** 更具体的规则靠前；命中正文/标题才落对应话题 */
const NEWSPIC_TOPIC_RULES = [
  { tag: '太空行走', keys: ['太空行走', '舱外活动', '出舱活动', '出舱', 'spacewalk', 'EVA'] },
  { tag: '国际空间站', keys: ['国际空间站', 'ISS', 'Canadarm', '加拿大机械臂'] },
  { tag: '中国空间站', keys: ['天宫', '中国空间站', '天和核心舱', '问天', '梦天'] },
  { tag: '航天员', keys: ['航天员', '宇航员'] },
  { tag: '星舰', keys: ['星舰', 'Starship', 'Super Heavy', '超重型助推'] },
  { tag: '猎鹰九号', keys: ['猎鹰九号', '猎鹰9', 'Falcon 9', 'Falcon9'] },
  { tag: '猎鹰重型', keys: ['猎鹰重型', 'Falcon Heavy'] },
  { tag: '星链', keys: ['星链', 'Starlink'] },
  { tag: '火箭回收', keys: ['海上回收', 'drone ship', '回收船', '火箭着陆', '助推器着陆'] },
  { tag: '长征火箭', keys: ['长征二号', '长征三号', '长征五号', '长征六号', '长征七号', '长征八号', '长征'] },
  { tag: '朱雀', keys: ['朱雀二号', '朱雀三号', '朱雀'] },
  { tag: '载人航天', keys: ['载人航天', '神舟'] },
  { tag: '探月', keys: ['探月', '登月', '嫦娥', '月球'] },
  { tag: '卫星', keys: ['卫星'] },
  { tag: '火箭发射', keys: ['发射升空', '点火升空', '升空', '入轨'] },
  { tag: 'NASA', keys: ['NASA', '美国宇航局'] },
  { tag: 'SpaceX', keys: ['SpaceX', '太空探索技术'] }
]

function utf8ByteLength(text) {
  const s = String(text || '')
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8')
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
  let n = 0
  for (const ch of s) {
    const code = ch.codePointAt(0)
    n += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return n
}

function sliceUtf8Bytes(text, maxBytes) {
  const s = String(text || '')
  let limit = NEWSPIC_CONTENT_MAX_BYTES
  if (maxBytes != null && maxBytes !== '') {
    const n = Number(maxBytes)
    if (Number.isFinite(n)) {
      if (n <= 0) return ''
      limit = n
    }
  }
  if (utf8ByteLength(s) <= limit) return s
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(s, 'utf8')
    let end = Math.min(limit, buf.length)
    while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end -= 1
    if (end > 0) {
      const lead = buf[end - 1]
      const need = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
      if (end - 1 + need > limit) end -= 1
    }
    return buf.slice(0, end).toString('utf8')
  }
  let bytes = 0
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    const n = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + n > limit) break
    bytes += n
    out += ch
  }
  return out
}

function keyHits(hay, key) {
  const k = String(key || '').trim()
  if (!k) return false
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(k)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (k.length <= 3) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i')
      return re.test(hay)
    }
    return hay.toLowerCase().includes(k.toLowerCase())
  }
  if (/^[A-Za-z][A-Za-z0-9 ]+$/.test(k)) {
    return hay.toLowerCase().includes(k.toLowerCase())
  }
  return hay.includes(k)
}

function pickNewspicTopics(text, max) {
  const hay = String(text || '')
  const limit = Math.max(1, Number(max) || NEWSPIC_MAX_TOPICS)
  const out = []
  const seen = new Set()
  const explicitIss = ['国际空间站', 'ISS', 'Canadarm', '加拿大机械臂'].some((k) => keyHits(hay, k))
  for (const rule of NEWSPIC_TOPIC_RULES) {
    if (!rule.keys.some((k) => keyHits(hay, k))) continue
    if (seen.has(rule.tag)) continue
    seen.add(rule.tag)
    out.push(`#${rule.tag}`)
    if (out.length >= limit) break
  }
  if (out.includes('#中国空间站') && out.includes('#国际空间站') && !explicitIss) {
    const i = out.indexOf('#国际空间站')
    if (i >= 0) out.splice(i, 1)
  }
  if (!out.length) out.push('#航天')
  return out.slice(0, limit)
}

function topicKey(tag) {
  return String(tag || '')
    .replace(/#/g, '')
    .replace(/^小程序:.*/i, '')
    .trim()
    .slice(0, NEWSPIC_TOPIC_MAX_CHARS)
}

function formatWxTopic(tag) {
  const key = topicKey(tag)
  return key ? `#${key}#` : ''
}

function extractTopicTokens(line) {
  const tags = []
  const re = new RegExp(NEWSPIC_TOPIC_TOKEN_RE.source, 'g')
  let m
  while ((m = re.exec(String(line || '')))) {
    const key = topicKey(m[1])
    if (key) tags.push(`#${key}`)
  }
  return tags
}

function isTopicOnlyLine(line) {
  const t = String(line || '').trim()
  if (!t || /#小程序:\/\//.test(t)) return false
  const tokens = extractTopicTokens(t)
  if (!tokens.length) return false
  const rest = t.replace(new RegExp(NEWSPIC_TOPIC_TOKEN_RE.source, 'g'), '').trim()
  return rest === ''
}

function isCatalogTopic(tag) {
  const key = topicKey(tag)
  if (!key) return false
  if (key === '航天') return true
  return NEWSPIC_TOPIC_RULES.some((r) => r.tag === key)
}

function sanitizeNewspicContent(text, maxBytes) {
  let s = String(text || '')
  s = s.replace(NEWSPIC_IMG_SLOT_RE, ' ')
  s = s.replace(NEWSPIC_MP_RE, ' ')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/https?:\/\/\S+/gi, ' ')
  s = s.replace(/&nbsp;/gi, ' ')
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ').trim()
  const limit = maxBytes == null ? NEWSPIC_CONTENT_MAX_BYTES : Number(maxBytes)
  if (!Number.isFinite(limit) || limit <= 0) return s
  return sliceUtf8Bytes(s, limit)
}

function peelNewspicFooter(text) {
  let s = String(text || '').trim()
  s = s.replace(NEWSPIC_MP_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim()
  const lines = s.split(/\n/)
  const tags = []
  while (lines.length) {
    const last = String(lines[lines.length - 1] || '').trim()
    if (!last) {
      lines.pop()
      continue
    }
    if (isTopicOnlyLine(last)) {
      extractTopicTokens(last).reverse().forEach((t) => tags.unshift(t))
      lines.pop()
      continue
    }
    break
  }
  return { body: lines.join('\n').trim(), tags }
}

function mergeNewspicTopics(autoTags, userTags, max) {
  const limit = Math.max(1, Number(max) || NEWSPIC_MAX_TOPICS)
  const out = []
  const seen = new Set()
  const push = (raw) => {
    const key = topicKey(raw)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(`#${key}`)
  }
  autoTags.forEach(push)
  ;(userTags || []).filter((t) => !isCatalogTopic(t)).forEach(push)
  return out.slice(0, limit)
}

function finalizeNewspicContent(text, opts = {}) {
  const title = String((opts && opts.title) || '')
  const cleaned = sanitizeNewspicContent(text, 100000)
  const peeled = peelNewspicFooter(cleaned)
  const auto = pickNewspicTopics(`${title}\n${peeled.body}`)
  const tags = mergeNewspicTopics(auto, peeled.tags, NEWSPIC_MAX_TOPICS)
  const tagLine = tags.map(formatWxTopic).filter(Boolean).join(' ')
  const footer = tagLine ? `\n\n${tagLine}` : ''
  const room = NEWSPIC_CONTENT_MAX_BYTES - utf8ByteLength(footer)
  const body = sliceUtf8Bytes(peeled.body, Math.max(0, room)).replace(/\s+$/g, '')
  return `${body}${footer}`.replace(/^\n+/, '').trim()
}

function newspicBodyForEditor(text) {
  return sanitizeNewspicContent(text, 100000)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

module.exports = {
  NEWSPIC_CONTENT_MAX_BYTES,
  NEWSPIC_MP_LINK,
  NEWSPIC_MAX_TOPICS,
  NEWSPIC_TOPIC_MAX_CHARS,
  NEWSPIC_TOPIC_RULES,
  sliceUtf8Bytes,
  topicKey,
  formatWxTopic,
  sanitizeNewspicContent,
  pickNewspicTopics,
  peelNewspicFooter,
  finalizeNewspicContent,
  newspicBodyForEditor
}
