/**
 * 部署 adminGateway 后调用：清 B 站发文队列/配置，并尝试删云函数。
 * 用法：node scripts/ops-decommission-bilibili.js [--force]
 * 读取 workers/replay-fetcher/.env 的 REPLAY_ADMIN_API_BASE + REPLAY_AGENT_TOKEN
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

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
    const data = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': data.length } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch (e) {
            return reject(new Error(`非 JSON 响应 HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function main() {
  const force = process.argv.includes('--force')
  const env = loadEnv(path.join(__dirname, '../workers/replay-fetcher/.env'))
  const base = (env.REPLAY_ADMIN_API_BASE || '').replace(/\/$/, '')
  const token = env.REPLAY_AGENT_TOKEN || ''
  if (!base || !token) {
    console.error('缺少 REPLAY_ADMIN_API_BASE / REPLAY_AGENT_TOKEN（workers/replay-fetcher/.env）')
    process.exit(1)
  }
  // adminGateway HTTP 触发器：POST 到 /admin，path 放在 JSON body 里
  const url = base
  const payload = {
    path: '/replay-agent/decommission-bilibili',
    method: 'POST',
    query: {},
    body: { force },
    headers: { Authorization: `Bearer ${token}` }
  }
  console.log('POST', url, '→', payload.path, force ? '(force)' : '')
  const res = await requestJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: payload
  })
  console.log(JSON.stringify(res.json, null, 2))
  if (res.status >= 400 || (res.json && res.json.code && res.json.code !== 0)) {
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
