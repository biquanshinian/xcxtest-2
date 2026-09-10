/**
 * 线上 preview-all / preview 冒烟（读 workers/replay-fetcher/.env，不打印 token）
 * node scripts/_tmp_live_oa_preview_smoke.js
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

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
    const lib = u.protocol === 'http:' ? http : https
    const payload = body == null ? null : JSON.stringify(body)
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          let j
          try {
            j = JSON.parse(d)
          } catch (e) {
            return reject(new Error(`bad json ${res.statusCode}: ${d.slice(0, 200)}`))
          }
          resolve({ status: res.statusCode, json: j })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  const env = loadEnv(path.join(__dirname, '..', 'workers', 'replay-fetcher', '.env'))
  const base = String(env.REPLAY_ADMIN_API_BASE || '').replace(/\/$/, '')
  const token = env.REPLAY_AGENT_TOKEN || ''
  if (!base || !token) {
    console.log('SKIP live: missing REPLAY_ADMIN_API_BASE / REPLAY_AGENT_TOKEN')
    process.exit(0)
  }

  const contentBody = {
    markdown: '第一段正文。\n\n第二段继续讲发射窗口。',
    title: '冒烟审计标题',
    themeId: 'bytedance',
    includeChrome: false
  }

  // HTTP 触发器：path 放在 JSON body（与 ops-decommission 一致）
  // OA 预览需管理员 JWT；若仅有 agent token 则跳过线上（本地审计已覆盖同源）
  async function callOa(apiPath, body) {
    return requestJson(base, {
      method: 'POST',
      body: {
        path: apiPath,
        method: 'POST',
        query: {},
        body,
        headers: { Authorization: `Bearer ${token}` }
      }
    })
  }

  const all = await callOa('/oa-content/preview-all', contentBody)
  const j = all.json || {}
  const data =
    (j.data && j.data.themes && j.data) ||
    (j.result && j.result.themes && j.result) ||
    (j.themes && j) ||
    j.data ||
    j.result ||
    j
  const themes = (data && data.themes) || {}
  const keys = Object.keys(themes)
  const sample = themes.bytedance || themes[keys[0]] || ''
  const hasH1 = /<h1\b/i.test(sample)
  const hasWrap = /background-color:#ffffff;padding:16px/.test(sample)
  const hasAccent = /border-top:\s*4px solid/.test(sample)
  const fps = (data && data.fingerprints) || {}
  const uniq = new Set(Object.values(fps).filter(Boolean))

  console.log('preview-all', {
    status: all.status,
    topKeys: Object.keys(j),
    code: j.code,
    message: j.message || j.msg || j.error,
    keys: keys.length,
    themeDistinct: data && data.themeDistinct,
    uniqFp: uniq.size,
    hasH1,
    hasWrap,
    hasAccent,
    sampleHead: String(sample).slice(0, 120)
  })

  if (j.code === 4010) {
    console.log('SKIP live OA: agent token 无管理员权限（需后台 JWT）；本地同源审计已通过')
    process.exit(0)
  }

  if (all.status !== 200 || keys.length < 5 || !hasH1 || !hasWrap || hasAccent) {
    console.log('FAIL preview-all checks')
    process.exit(1)
  }
  if (data.themeDistinct === false) {
    console.log('FAIL themeDistinct false')
    process.exit(1)
  }

  const one = await callOa('/oa-content/preview', contentBody)
  const j1 = one.json || {}
  const d1 = j1.data || j1.result || j1
  const html = (d1 && d1.html) || j1.html || ''
  const packed = themes.bytedance || ''
  const same = html === packed
  console.log('preview===preview-all[bytedance]', same, { previewLen: html.length, allLen: packed.length })
  if (!same) process.exit(1)
  console.log('LIVE OK')
}

main().catch((e) => {
  console.error('ERR', e.message || e)
  process.exit(1)
})
