/**
 * 小红书变体：从源稿派生短文案、预览结构、导出发布包（note.md + 图清单）。
 */
const https = require('https')
const http = require('http')
const crypto = require('crypto')

const DEFAULT_TOPICS = [
  '火箭发射',
  '航天科普',
  '火星探索日志',
  '观礼',
  'SpaceX',
  '中国航天',
  '星舰',
  '发射倒计时'
]

function stripMd(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectMdImages(md) {
  const out = []
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi
  let m
  while ((m = re.exec(String(md || '')))) {
    const u = String(m[1] || '').trim()
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}

function pickTopics(text, extra = []) {
  const pool = [...extra, ...DEFAULT_TOPICS]
  const body = String(text || '')
  const hit = []
  for (const t of pool) {
    if (!t) continue
    if (body.includes(t.replace(/^#/, '')) || hit.length < 6) {
      const tag = String(t).replace(/^#/, '').trim()
      if (tag && !hit.includes(tag)) hit.push(tag)
    }
    if (hit.length >= 12) break
  }
  while (hit.length < 8 && hit.length < DEFAULT_TOPICS.length) {
    const t = DEFAULT_TOPICS[hit.length]
    if (!hit.includes(t)) hit.push(t)
    else break
  }
  return hit.slice(0, 15)
}

function deriveXhsFromSource(draft = {}, opts = {}) {
  const titleRaw = String(opts.title || draft.title || '').trim()
  const md = String(opts.markdown || draft.markdown || '')
  const plain = stripMd(md)
  const title = (titleRaw || plain.slice(0, 20) || '航天速递').slice(0, 20)

  let body = plain
    .replace(titleRaw, '')
    .trim()
  // 压成种草短段
  const paras = body
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const short = []
  let len = 0
  for (const p of paras) {
    if (len > 480) break
    short.push(p)
    len += p.length
  }
  body = short.join('\n\n').slice(0, 1000)
  if (!body) body = '一起看火箭升空，打开小程序「火星探索日志」查发射与倒计时。'

  const images = []
  const pushImg = (u) => {
    const s = String(u || '').trim()
    if (!s || !/^https?:\/\//i.test(s) || images.includes(s)) return
    images.push(s)
  }
  if (Array.isArray(opts.images)) opts.images.forEach(pushImg)
  if (Array.isArray(opts.imageUrls)) opts.imageUrls.forEach(pushImg)
  if (Array.isArray(draft.imageUrls)) draft.imageUrls.forEach(pushImg)
  collectMdImages(md).forEach(pushImg)
  pushImg(opts.coverUrl || draft.coverUrl)

  const topics = Array.isArray(opts.topics) && opts.topics.length
    ? opts.topics.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15)
    : pickTopics(`${title}\n${body}\n${md}`)

  const pinnedComment =
    String(opts.pinnedComment || '').trim() ||
    '想查实时发射与倒计时，小程序搜「火星探索日志」～'

  return {
    title,
    body,
    topics,
    pinnedComment,
    images: images.slice(0, 9),
    coverIndex: 0,
    status: 'draft',
    exportPackageUrl: ''
  }
}

function previewXhsPayload(variant = {}) {
  const images = Array.isArray(variant.images) ? variant.images.filter(Boolean) : []
  const coverIndex = Math.min(
    Math.max(0, Number(variant.coverIndex) || 0),
    Math.max(0, images.length - 1)
  )
  return {
    title: String(variant.title || '').slice(0, 20),
    body: String(variant.body || ''),
    topics: Array.isArray(variant.topics) ? variant.topics : [],
    pinnedComment: String(variant.pinnedComment || ''),
    images,
    coverIndex,
    coverUrl: images[coverIndex] || '',
    status: variant.status || 'draft',
    exportPackageUrl: variant.exportPackageUrl || ''
  }
}

function normalizeXhsVariant(input, fallback = {}) {
  const base = { ...fallback, ...(input || {}) }
  const images = Array.isArray(base.images)
    ? base.images.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u))
    : []
  return {
    title: String(base.title || '').trim().slice(0, 20),
    body: String(base.body || '').trim().slice(0, 2000),
    topics: Array.isArray(base.topics)
      ? base.topics.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15)
      : [],
    pinnedComment: String(base.pinnedComment || '').trim().slice(0, 200),
    images: images.slice(0, 9),
    coverIndex: Math.max(0, Math.min(Number(base.coverIndex) || 0, Math.max(0, images.length - 1))),
    status: ['draft', 'ready', 'exported', 'failed'].includes(base.status)
      ? base.status
      : 'draft',
    exportPackageUrl: String(base.exportPackageUrl || '').trim()
  }
}

function buildNoteMarkdown(variant) {
  const v = previewXhsPayload(variant)
  const topicLine = (v.topics || []).map((t) => `#${t}`).join(' ')
  const imgLines = (v.images || [])
    .map((u, i) => `${String(i + 1).padStart(2, '0')}. ${u}`)
    .join('\n')
  return [
    `# ${v.title}`,
    '',
    v.body,
    '',
    topicLine,
    '',
    '---',
    '置顶评论：',
    v.pinnedComment,
    '',
    '配图顺序（竖版 3:4 建议）：',
    imgLines || '（无）',
    ''
  ].join('\n')
}

/** 极简 ZIP（store），用于导出 note + manifest */
function buildZipStore(files) {
  const locals = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data || ''), 'utf8')
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, data)

    const cen = Buffer.alloc(46 + name.length)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0, 8)
    cen.writeUInt16LE(0, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)
    name.copy(cen, 46)
    central.push(cen)
    offset += local.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, end])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function fetchBuffer(url, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = String(url || '')
    const lib = u.startsWith('https') ? https : http
    const req = lib.get(u, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return fetchBuffer(res.headers.location, { timeoutMs }).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

async function buildExportZip(variant) {
  const v = previewXhsPayload(variant)
  const note = buildNoteMarkdown(v)
  const files = [
    { name: 'note.md', data: note },
    {
      name: 'manifest.json',
      data: JSON.stringify(
        {
          title: v.title,
          topics: v.topics,
          pinnedComment: v.pinnedComment,
          coverIndex: v.coverIndex,
          images: v.images,
          createdAt: new Date().toISOString()
        },
        null,
        2
      )
    }
  ]
  // 尽量打进竖图（失败则只保留 URL 清单）
  for (let i = 0; i < v.images.length; i++) {
    const url = v.images[i]
    try {
      const buf = await fetchBuffer(url)
      const ext = /\.png(\?|$)/i.test(url) ? 'png' : /\.webp(\?|$)/i.test(url) ? 'webp' : 'jpg'
      files.push({ name: `${String(i + 1).padStart(2, '0')}.${ext}`, data: buf })
    } catch (e) {
      /* skip */
    }
  }
  return {
    zip: buildZipStore(files),
    note,
    fileCount: files.length
  }
}

function exportObjectKey(draftId) {
  const id = String(draftId || 'draft').replace(/[^\w-]/g, '').slice(0, 40) || 'draft'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rand = crypto.randomBytes(3).toString('hex')
  return `oa-xhs-exports/${id}/${stamp}-${rand}.zip`
}

module.exports = {
  deriveXhsFromSource,
  previewXhsPayload,
  normalizeXhsVariant,
  buildNoteMarkdown,
  buildExportZip,
  exportObjectKey
}
