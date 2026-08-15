/**
 * 修复草稿箱里被「封面https://…」污染的 digest。
 * 用法：node scripts/_tmp_fix_draft_digests.js
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const {
  looksLikeCoverLinkDigest,
  markdownToDigest
} = require('../cloudfunctions/adminGateway/oaStudioHelpers')

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
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

;(async () => {
  // refresh login
  require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/ops-admin-login.js')], {
    cwd: ROOT,
    stdio: 'inherit'
  })
  const local = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = local.OA_ADMIN_TOKEN
  const base = String(local.ADMIN_API_BASE || '').replace(/\/$/, '')
  if (!token || !base) throw new Error('MISSING_TOKEN')

  const all = []
  for (let page = 1; page <= 10; page++) {
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
    const total = (j.data && j.data.total) || 0
    all.push(...list)
    if (!list.length || all.length >= total) break
  }
  console.log('drafts', all.length)

  let fixed = 0
  let skipped = 0
  for (const d of all) {
    const dig = String(d.digest || '')
    if (!looksLikeCoverLinkDigest(dig)) {
      skipped += 1
      continue
    }
    const next = markdownToDigest(d.markdown || '')
    if (!next) {
      console.log('EMPTY', d._id, d.title)
      continue
    }
    const res = await requestJson(base, {
      token,
      body: {
        path: `/oa-content/drafts/${d._id}`,
        method: 'PUT',
        query: {},
        body: { digest: next },
        headers: { Authorization: `Bearer ${token}` }
      }
    })
    if (res.code && res.code !== 0) {
      console.log('FAIL', d._id, res.message || res)
      continue
    }
    fixed += 1
    console.log('FIXED', d.title, '=>', next.slice(0, 40) + '…')
  }
  console.log('DONE', { fixed, skipped })
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
