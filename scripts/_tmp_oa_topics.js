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

function requestJson(url, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) })
          } catch (e) {
            reject(new Error(text.slice(0, 400)))
          }
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  const env = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = env.OA_ADMIN_TOKEN
  const base = String(env.ADMIN_API_BASE || '').replace(/\/$/, '')
  if (!token || !base) throw new Error('MISSING_TOKEN')
  const auth = { Authorization: 'Bearer ' + token }
  const { status, json } = await requestJson(base, {
    method: 'POST',
    headers: auth,
    body: {
      path: '/oa-content/topics',
      method: 'GET',
      query: { limit: '20' },
      body: {},
      headers: auth
    }
  })
  const data = json.data || json
  const list = data.list || data.topics || []
  const slim = (Array.isArray(list) ? list : []).map((t) => ({
    sourceType: t.sourceType,
    title: t.title,
    summary: String(t.summary || t.body || '').replace(/\s+/g, ' ').slice(0, 220),
    publishedAt: t.publishedAt || '',
    rocket: t.rocket || '',
    net: t.net || '',
    sourceId: t.sourceId || ''
  }))
  console.log(JSON.stringify({ status, code: json.code, n: slim.length, slim }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
