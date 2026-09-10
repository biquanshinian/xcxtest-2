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
    all.push(...list)
    if (!list.length || all.length >= total) break
  }

  const matched = all.filter((d) => titles.has(String(d.title || '').trim()))
  const byTitle = {}
  for (const d of matched) {
    const t = d.title.trim()
    byTitle[t] = byTitle[t] || []
    byTitle[t].push(d)
  }

  const toDelete = []
  for (const [t, items] of Object.entries(byTitle)) {
    if (items.length < 2) continue
    items.sort(
      (a, b) =>
        Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0)
    )
    const keep = items[0]
    const drop = items.slice(1)
    console.log('KEEP', keep._id, t, 'drop', drop.length)
    for (const d of drop) {
      console.log('  DROP', d._id, d.createdAt)
      toDelete.push(d._id)
    }
  }

  if (!toDelete.length) {
    console.log('no duplicates')
    return
  }

  const del = await requestJson(base, {
    token,
    body: {
      path: '/oa-content/drafts/batch-delete',
      method: 'POST',
      query: {},
      body: { ids: toDelete },
      headers: { Authorization: `Bearer ${token}` }
    }
  })
  console.log('DELETED', JSON.stringify(del))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
