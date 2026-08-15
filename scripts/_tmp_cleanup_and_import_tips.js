/**
 * 清理旧技巧/商家草稿，再批量导入带专属封面的新稿。
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawnSync } = require('child_process')

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
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
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
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            reject(new Error(`非 JSON: ${text.slice(0, 300)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function callAdmin(base, token, apiPath, body, method = 'POST', query = {}) {
  return requestJson(base, {
    token,
    body: {
      path: apiPath,
      method,
      query,
      body: body || {},
      headers: { Authorization: `Bearer ${token}` }
    }
  })
}

function extractList(j) {
  if (!j) return []
  const d = j.data
  if (Array.isArray(d)) return d
  if (d && Array.isArray(d.list)) return d.list
  if (d && Array.isArray(d.items)) return d.items
  if (Array.isArray(j.list)) return j.list
  return []
}

async function main() {
  const local = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = local.OA_ADMIN_TOKEN
  const base = String(local.ADMIN_API_BASE || '').replace(/\/$/, '')
  if (!token || !base) throw new Error('MISSING_TOKEN')

  const meta = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs/wechat-oa/product-tips-2026-08/_covers-meta.json'), 'utf8')
  )
  const titles = new Set(meta.map((x) => x.title.trim()))
  titles.add('观礼商家入驻很简单：按这几步做就行')

  const listed = await callAdmin(base, token, '/oa-content/drafts', {}, 'GET', { limit: 200 })
  const arr = extractList(listed)
  console.log('drafts_total', arr.length)

  const match = arr.filter((d) => titles.has(String(d.title || '').trim()))
  console.log('title_match', match.length)
  for (const d of match) {
    console.log('  DEL_CAND', d._id, d.title, String(d.coverUrl || '').slice(0, 70))
  }

  if (match.length) {
    const ids = match.map((d) => d._id).filter(Boolean)
    const del = await callAdmin(base, token, '/oa-content/drafts/batch-delete', { ids })
    console.log('BATCH_DELETE', JSON.stringify(del).slice(0, 400))
  } else {
    console.log('no old matching drafts to delete')
  }

  // dry-run covers first
  const dry = spawnSync(
    process.execPath,
    [
      path.join(ROOT, '.cursor/skills/oa-update-log/scripts/import-to-drafts.js'),
      'docs/wechat-oa/product-tips-2026-08',
      '--batch',
      '--dry'
    ],
    { cwd: ROOT, encoding: 'utf8' }
  )
  console.log(dry.stdout)
  if (dry.status) {
    console.error(dry.stderr)
    throw new Error('dry tips failed')
  }

  const tips = spawnSync(
    process.execPath,
    [
      path.join(ROOT, '.cursor/skills/oa-update-log/scripts/import-to-drafts.js'),
      'docs/wechat-oa/product-tips-2026-08',
      '--batch'
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  console.log(tips.stdout)
  if (tips.stderr) console.error(tips.stderr)
  if (tips.status) throw new Error('import tips failed')

  const merchant = spawnSync(
    process.execPath,
    [
      path.join(ROOT, '.cursor/skills/oa-update-log/scripts/import-to-drafts.js'),
      'docs/wechat-oa/merchant-onboarding-2026-08'
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  )
  console.log(merchant.stdout)
  if (merchant.stderr) console.error(merchant.stderr)
  if (merchant.status) throw new Error('import merchant failed')

  console.log('ALL_DONE')
}

main().catch((e) => {
  console.error('ERR', e.message || e)
  process.exit(1)
})
