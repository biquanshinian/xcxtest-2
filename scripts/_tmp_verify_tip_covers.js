const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const ROOT = path.resolve(__dirname, '..')
function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}
function requestJson(url, { token, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Authorization: `Bearer ${token}`
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

;(async () => {
  const local = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = local.OA_ADMIN_TOKEN
  const base = local.ADMIN_API_BASE.replace(/\/$/, '')
  const meta = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs/wechat-oa/product-tips-2026-08/_covers-meta.json'), 'utf8')
  )
  const titles = new Set(meta.map((x) => x.title.trim()))
  titles.add('观礼商家入驻很简单：按这几步做就行')

  const all = []
  for (let page = 1; page <= 5; page++) {
    const j = await requestJson(base, {
      token,
      body: {
        path: '/oa-content/drafts',
        method: 'GET',
        query: { page, pageSize: 100 },
        body: {},
        headers: { Authorization: `Bearer ${token}` }
      }
    })
    const list = (j.data && j.data.list) || []
    const total = j.data && j.data.total
    console.log('page', page, 'got', list.length, 'total', total)
    all.push(...list)
    if (!list.length || all.length >= total) break
  }

  const matched = all.filter((d) => titles.has(String(d.title || '').trim()))
  console.log('all_drafts', all.length, 'matched_titles', matched.length)

  const coverSet = new Set(matched.map((d) => String(d.coverUrl || '')))
  console.log('unique_coverUrls', coverSet.size)

  let withCosImages = 0
  let withMdCover = 0
  for (const d of matched) {
    const imgs = [].concat(d.imageUrls || [], d.images || [])
    const hasCos = imgs.some((u) => /oa-update-log|myqcloud\.com/i.test(String(u)))
    if (hasCos) withCosImages += 1
    if (/!\[.*\]\(.*cover/i.test(String(d.markdown || ''))) withMdCover += 1
  }
  console.log('with_cos_imageUrls', withCosImages, 'md_has_cover_ref', withMdCover)

  // missing titles
  const have = new Set(matched.map((d) => d.title.trim()))
  const missing = [...titles].filter((t) => !have.has(t))
  console.log('missing', missing.length)
  missing.forEach((t) => console.log('  MISS', t))

  // sample first 3
  matched.slice(0, 3).forEach((d) => {
    console.log('SAMPLE', d.title)
    console.log('  cover', String(d.coverUrl || '').slice(0, 100))
    console.log('  images', JSON.stringify(d.imageUrls || d.images || []).slice(0, 180))
  })
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
