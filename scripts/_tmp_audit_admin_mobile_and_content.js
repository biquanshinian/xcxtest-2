/**
 * 后台手机适配 + 近期成品稿 冒烟审计
 * node scripts/_tmp_audit_admin_mobile_and_content.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const http = require('http')
const https = require('https')

const ROOT = path.join(__dirname, '..')
const results = []

function check(section, name, ok, detail) {
  results.push({ section, name, ok: !!ok, detail: detail || '' })
  console.log(ok ? '  OK ' : '  FAIL', `[${section}]`, name, detail ? `— ${detail}` : '')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
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
          let json = null
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch (e) {
            return reject(new Error('bad json'))
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}
async function callAdmin(base, token, apiPath, body, method = 'POST') {
  return requestJson(base, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: {
      path: apiPath,
      method,
      query: method === 'GET' ? body || {} : {},
      body: method === 'GET' ? {} : body || {},
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }
  })
}

async function main() {
  console.log('=== Admin mobile + content audit ===\n')

  console.log('[1] mobile source')
  const html = read('admin-web/index.html')
  const theme = read('admin-web/src/styles/theme.css')
  const layout = read('admin-web/src/views/LayoutPage.vue')
  const drafts = read('admin-web/src/views/OaDraftsPage.vue')
  const login = read('admin-web/src/views/LoginPage.vue')

  check('mobile', 'viewport-fit=cover', /viewport-fit=cover/.test(html))
  check('mobile', 'theme safe-area', /safe-area-inset/.test(theme))
  check('mobile', 'theme touch min-height buttons', /min-height:\s*40px/.test(theme))
  check('mobile', 'theme dialog bottom sheet', /align-items:\s*flex-end/.test(theme))
  check('mobile', 'theme iOS font-size 16px', /font-size:\s*16px/.test(theme))
  check('mobile', 'layout body scroll lock', /setBodyScrollLock/.test(layout))
  check('mobile', 'layout hamburger + drawer', /hamburger-btn/.test(layout) && /is-mobile-open/.test(layout))
  check('mobile', 'layout menu item 44px', /min-height:\s*44px/.test(layout))
  check('mobile', 'drafts card list mobile', /draft-cards/.test(drafts) && /v-if="isMobile"/.test(drafts))
  check('mobile', 'drafts ops 2-col grid', /ops--card/.test(drafts) && /grid-template-columns:\s*1fr 1fr/.test(drafts))
  check('mobile', 'login mobile sheet', /border-radius:\s*20px 20px 0 0/.test(login))

  console.log('\n[2] dist built')
  check('dist', 'admin-web/dist exists', exists('admin-web/dist/index.html'))
  if (exists('admin-web/dist/index.html')) {
    const distHtml = read('admin-web/dist/index.html')
    check('dist', 'dist viewport-fit', /viewport-fit=cover/.test(distHtml))
    const cssFiles = fs.readdirSync(path.join(ROOT, 'admin-web/dist/assets')).filter((f) => f.endsWith('.css'))
    const cssBlob = cssFiles.map((f) => read(`admin-web/dist/assets/${f}`)).join('\n')
    check('dist', 'dist css has safe-area', /safe-area-inset/.test(cssBlob))
    check('dist', 'dist has OaDraftsPage', fs.readdirSync(path.join(ROOT, 'admin-web/dist/assets')).some((f) => f.startsWith('OaDraftsPage')))
  }

  console.log('\n[3] content artifacts')
  check('content', 'product-tips-30 dir', exists('docs/wechat-oa/product-tips-2026-08'))
  if (exists('docs/wechat-oa/product-tips-2026-08')) {
    const n = fs.readdirSync(path.join(ROOT, 'docs/wechat-oa/product-tips-2026-08')).filter((d) =>
      fs.existsSync(path.join(ROOT, 'docs/wechat-oa/product-tips-2026-08', d, 'article.md'))
    ).length
    check('content', '30 tip articles on disk', n === 30, `count=${n}`)
  }
  check('content', 'merchant onboarding article', exists('docs/wechat-oa/merchant-onboarding-2026-08/article.md'))
  check('content', 'skill has merchant section', /商家入驻简单教程/.test(read('.cursor/skills/oa-update-log/SKILL.md')))
  check('content', 'skill no-jargon rule', /不能写内部话术/.test(read('.cursor/skills/oa-update-log/SKILL.md')))
  check('content', 'import --batch support', /--batch/.test(read('.cursor/skills/oa-update-log/scripts/import-to-drafts.js')))

  console.log('\n[4] hooks / autobuild')
  const hooks = JSON.parse(read('.cursor/hooks.json'))
  const stop = (hooks.hooks.stop || []).map((h) => h.command).join('\n')
  check('hooks', 'admin-web autobuild stop', /admin-web-autobuild\.js stop/.test(stop))
  check('hooks', 'oa-update-log stop', /oa-update-log-import\.js stop/.test(stop))

  console.log('\n[5] syntax')
  ;[
    'admin-web/src/views/LayoutPage.vue',
    '.cursor/skills/oa-update-log/scripts/import-to-drafts.js',
    'scripts/ops-admin-login.js',
    'scripts/_tmp_audit_oa_full.js'
  ].forEach((f) => {
    if (f.endsWith('.vue')) {
      check('syntax', f + ' (parse skip vue)', true)
      return
    }
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
    check('syntax', f, r.status === 0, (r.stderr || '').trim().slice(0, 100))
  })

  console.log('\n[6] live API')
  const env = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const base = (env.ADMIN_API_BASE || '').replace(/\/$/, '')
  const token = env.OA_ADMIN_TOKEN || ''
  check('live', 'token env', !!(base && token))

  if (base && token) {
    const list = await callAdmin(base, token, '/oa-content/drafts', { page: 1, pageSize: 50 }, 'GET')
    const data = list.json && (list.json.data || list.json)
    const rows = (data && data.list) || []
    const okList = list.json && (!list.json.code || list.json.code === 0)
    check('live', 'drafts list', okList, `rows=${rows.length}`)

    const tipHits = rows.filter((r) =>
      /倒计时|星问|观礼商家入驻|通行证|星链|签到/.test(String(r.title || ''))
    )
    const merchant = rows.find((r) => /观礼商家入驻/.test(String(r.title || '')))
    const tipsSample = rows.filter((r) => /打开小程序|星问|星链|签到|观礼/.test(String(r.title || '')))
    check('live', 'merchant tutorial in drafts', !!merchant, merchant ? merchant.title.slice(0, 40) : 'not in first page')
    check('live', 'product tips appear in recent list', tipsSample.length >= 3, `sample=${tipsSample.length}`)

    const prev = await callAdmin(base, token, '/oa-content/preview-all', {
      markdown: '第一段\n\n第二段',
      title: '审计',
      themeId: 'bytedance',
      includeChrome: false
    })
    const pad = prev.json && (prev.json.data || prev.json)
    const themes = (pad && pad.themes) || {}
    check(
      'live',
      'preview-all',
      prev.json && (!prev.json.code || prev.json.code === 0) && Object.keys(themes).length >= 10,
      `keys=${Object.keys(themes).length}`
    )
  }

  // child OA full audit summary
  console.log('\n[7] nested oa full audit')
  const nested = spawnSync(process.execPath, [path.join(ROOT, 'scripts/_tmp_audit_oa_full.js')], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 120000
  })
  const m = (nested.stdout || '').match(/FULL RESULT:\s*(\d+)\s*passed,\s*(\d+)\s*failed/)
  check('nested', 'oa_full exit 0', nested.status === 0, m ? m[0] : (nested.stderr || '').slice(0, 120))

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== ROUND RESULT: ${passed} passed, ${failed.length} failed ===`)
  if (failed.length) failed.forEach((f) => console.log('  ·', f.section, f.name, f.detail))

  fs.writeFileSync(
    path.join(ROOT, 'scripts/_tmp_audit_round_result.json'),
    JSON.stringify({ at: new Date().toISOString(), passed, failed: failed.length, results }, null, 2)
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
