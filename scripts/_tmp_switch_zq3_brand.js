/**
 * 把朱雀三号两篇草稿改到发稿号「火星空间探索」(mars_space / 槽2)
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const ROOT = path.resolve(__dirname, '..')
const IDS = [
  '860b2af16a8324fd00936e706ea3feb5',
  '253558636a8325060081f27e25c4a896'
]

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
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(new Error('bad json'))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  const env = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const base = String(env.ADMIN_API_BASE || '').replace(/\/$/, '')
  const token = env.OA_ADMIN_TOKEN
  if (!base || !token) throw new Error('MISSING_TOKEN')

  for (const id of IDS) {
    const put = await requestJson(base, {
      token,
      body: {
        path: `/oa-content/drafts/${id}`,
        method: 'PUT',
        query: {},
        body: {
          brandKey: 'mars_space',
          author: '火星空间探索'
        },
        headers: { Authorization: `Bearer ${token}` }
      }
    })
    if (put.code && put.code !== 0) {
      throw new Error(`PUT fail ${id}: ${put.message || JSON.stringify(put)}`)
    }
    const d = put.data || {}
    console.log('OK', {
      id,
      brandKey: d.brandKey,
      brandName: d.brandName,
      author: d.author,
      credentialSlot: d.credentialSlot
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
