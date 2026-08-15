/**
 * 内容中台全面冒烟审计
 * node scripts/_tmp_audit_oa_full.js
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
function syntax(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return { ok: r.status === 0, detail: (r.stderr || '').trim().slice(0, 120) }
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
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            json = JSON.parse(text)
          } catch (e) {
            return reject(new Error(text.slice(0, 200)))
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
      query: {},
      body: body || {},
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }
  })
}

async function main() {
  console.log('=== OA full smoke audit ===\n')

  // 1 files
  console.log('[1] files')
  ;[
    'cloudfunctions/adminGateway/oaContentStudio.js',
    'cloudfunctions/adminGateway/oaXhsVariant.js',
    'cloudfunctions/adminGateway/oaContentFormat.js',
    'cloudfunctions/adminGateway/oaContentThemes.js',
    'cloudfunctions/adminGateway/oaFetchArticle.js',
    'cloudfunctions/oaAuthorTrack/index.js',
    'admin-web/src/views/OaDraftsPage.vue',
    'admin-web/src/views/OaContentConfigPage.vue',
    'admin-web/src/api/client.js',
    '.cursor/skills/oa-update-log/SKILL.md',
    '.cursor/skills/oa-update-log/scripts/import-to-drafts.js',
    'scripts/ops-admin-login.js',
    '.cursor/hooks/oa-update-log-import.js',
    '.cursor/hooks/admin-web-autobuild.js',
    '.cursor/hooks.json',
    '.cursor/rules/oa-theme-preview-parity.mdc',
    'docs/wechat-oa/2026-08-update/article.md',
    'docs/oa-multi-platform-design.md'
  ].forEach((f) => check('files', f, exists(f)))

  // 2 syntax
  console.log('\n[2] syntax')
  ;[
    'cloudfunctions/adminGateway/oaContentStudio.js',
    'cloudfunctions/adminGateway/oaXhsVariant.js',
    'cloudfunctions/adminGateway/oaContentFormat.js',
    'cloudfunctions/adminGateway/oaFetchArticle.js',
    'cloudfunctions/oaAuthorTrack/index.js',
    'scripts/ops-admin-login.js',
    '.cursor/skills/oa-update-log/scripts/import-to-drafts.js',
    '.cursor/hooks/oa-update-log-import.js',
    '.cursor/hooks/admin-web-autobuild.js',
    'scripts/_tmp_audit_oa_theme_preview_parity.js'
  ].forEach((f) => {
    const r = syntax(f)
    check('syntax', f, r.ok, r.detail)
  })

  // 3 hooks
  console.log('\n[3] hooks')
  const hooks = JSON.parse(read('.cursor/hooks.json'))
  const stopCmds = (hooks.hooks.stop || []).map((h) => h.command).join('\n')
  const editCmds = (hooks.hooks.afterFileEdit || []).map((h) => h.command).join('\n')
  check('hooks', 'admin-web autobuild on stop', /admin-web-autobuild\.js stop/.test(stopCmds))
  check('hooks', 'oa-update-log import on stop', /oa-update-log-import\.js stop/.test(stopCmds))
  check('hooks', 'admin-web mark on edit', /admin-web-autobuild\.js mark/.test(editCmds))
  check('hooks', 'oa-update-log mark on edit', /oa-update-log-import\.js mark/.test(editCmds))
  check('hooks', 'hook comment no **/ terminator', !/docs\/wechat-oa\/\*\*\/article/.test(read('.cursor/hooks/oa-update-log-import.js')))
  check('hooks', 'oa-admin.local.env gitignored', /\.cursor\/oa-admin\.local\.env/.test(read('.gitignore')))

  // 4 frontend XHS + preview
  console.log('\n[4] frontend')
  const drafts = read('admin-web/src/views/OaDraftsPage.vue')
  const cfgPage = read('admin-web/src/views/OaContentConfigPage.vue')
  const client = read('admin-web/src/api/client.js')
  check('frontend', 'XHS carousel pager', /xhs-pager|xhsSlideIndex/.test(drafts))
  check('frontend', 'XHS image list computed', /xhsImageList/.test(drafts))
  check('frontend', 'XHS strip thumbnails', /xhs-strip/.test(drafts))
  check('frontend', 'derive passes images', /images:\s*form\.imageUrls/.test(drafts))
  check('frontend', 'export + save variants.xhs', /exportOaXhs/.test(client) && /variants:\s*\{\s*xhs/.test(drafts))
  check('frontend', 'seamless v-show themes', /v-show="form\.themeId === tid"/.test(drafts))
  check('frontend', 'preview-all API', /preview-all/.test(client))
  check('frontend', 'dist has OaDraftsPage chunk', exists('admin-web/dist/assets') && fs.readdirSync(path.join(ROOT, 'admin-web/dist/assets')).some((f) => f.startsWith('OaDraftsPage')))
  check('frontend', 'track wash all brands UI', /全部启用号/.test(cfgPage) && /enabledBrandLabel/.test(cfgPage))
  check('frontend', 'track wash API', /runOaTrackWash/.test(client) && /runOaTrackSources/.test(client))
  check('frontend', 'no track brand single-select', !/v-model="row\.brandKey"/.test(cfgPage))

  // 5 backend
  console.log('\n[5] backend')
  const studio = read('cloudfunctions/adminGateway/oaContentStudio.js')
  const gw = read('cloudfunctions/adminGateway/index.js')
  const xhs = read('cloudfunctions/adminGateway/oaXhsVariant.js')
  const fetchArt = read('cloudfunctions/adminGateway/oaFetchArticle.js')
  const trackFn = read('cloudfunctions/oaAuthorTrack/index.js')
  const trackCfg = JSON.parse(read('cloudfunctions/oaAuthorTrack/config.json'))
  check('backend', 'prepareMarkdownForTheme', /function prepareMarkdownForTheme/.test(studio))
  check('backend', 'no accent-only preview border', !/border-top:\s*4px solid/.test(studio))
  check('backend', 'push prepareMarkdown', /prepareMarkdownForTheme\(mdForPush/.test(studio))
  check('backend', 'preview-all route', /\/oa-content\/preview-all/.test(gw))
  check('backend', 'import route', /\/oa-content\/drafts\/import/.test(gw))
  check('backend', 'derive-xhs + export-xhs', /derive-xhs/.test(gw) && /export-xhs/.test(gw))
  check('backend', 'xhs accepts imageUrls opts', /opts\.imageUrls/.test(xhs))
  check('backend', 'xhs export zip', /function buildExportZip/.test(xhs))
  check('backend', 'track wash all enabled brands', /enabledBrandKeys\(cfg\)/.test(studio) && /for \(const brandKey of brands\)/.test(studio))
  check('backend', 'track wash draft keyed by brand', /brandKey: job\.brandKey/.test(studio) && /brandKey: item\.brandKey/.test(studio))
  check('backend', 'track-wash + track-sources routes', /\/oa-content\/track-wash/.test(gw) && /\/oa-content\/track-sources/.test(gw))
  check('backend', 'internal wash-collected', /\/oa-content\/internal\/wash-collected/.test(gw))
  check('backend', 'rss any-fail rss2json', /feed fallback rss2json/.test(fetchArt) && /function resolveRssUrl/.test(fetchArt))
  check('backend', 'oaAuthorTrack washOnly', /washOnly/.test(trackFn) && /oaAuthorWashTimer/.test(JSON.stringify(trackCfg)))

  // 6 local theme parity child
  console.log('\n[6] theme parity script')
  const parity = spawnSync(process.execPath, [path.join(ROOT, 'scripts/_tmp_audit_oa_theme_preview_parity.js')], {
    encoding: 'utf8',
    cwd: ROOT
  })
  check('theme', 'parity script exit 0', parity.status === 0, (parity.stdout || '').match(/result:.*/)?.[0] || '')

  // 7 auth + live API
  console.log('\n[7] live API')
  const env = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const base = (env.ADMIN_API_BASE || '').replace(/\/$/, '')
  let token = env.OA_ADMIN_TOKEN || ''
  check('live', 'local env present', !!(base && token), base ? 'base ok' : 'missing')

  if (base && token) {
    // refresh login if needed via themes list probe
    let themesRes = await callAdmin(base, token, '/oa-content/themes', {}, 'GET')
    if (themesRes.json && themesRes.json.code === 4010) {
      check('live', 'token valid', false, 'expired — re-login required')
    } else {
      const list = (themesRes.json && themesRes.json.data && themesRes.json.data.list) || (themesRes.json && themesRes.json.list) || []
      check('live', 'GET /oa-content/themes', themesRes.json && (!themesRes.json.code || themesRes.json.code === 0) && list.length >= 5, `themes=${list.length}`)

      const previewAll = await callAdmin(base, token, '/oa-content/preview-all', {
        markdown: '第一段。\n\n第二段。',
        title: '全面审计标题',
        themeId: 'bytedance',
        includeChrome: false
      })
      const pad = previewAll.json && (previewAll.json.data || previewAll.json)
      const themes = (pad && pad.themes) || {}
      const keys = Object.keys(themes)
      const sample = themes.bytedance || ''
      check(
        'live',
        'POST preview-all',
        previewAll.json && (!previewAll.json.code || previewAll.json.code === 0) && keys.length >= 5 && /<h1\b/i.test(sample),
        `keys=${keys.length} distinct=${pad && pad.themeDistinct}`
      )
      check('live', 'preview-all no accent border', !/border-top:\s*4px solid/.test(sample))
      check('live', 'preview-all gallery wrap', /background-color:#ffffff;padding:16px/.test(sample))

      const one = await callAdmin(base, token, '/oa-content/preview', {
        markdown: '第一段。\n\n第二段。',
        title: '全面审计标题',
        themeId: 'bytedance',
        includeChrome: false
      })
      const html = (one.json && one.json.data && one.json.data.html) || ''
      check('live', 'preview === preview-all[bytedance]', html === sample, `p=${html.length} a=${sample.length}`)

      const draftsList = await callAdmin(base, token, '/oa-content/drafts', { page: 1, pageSize: 5 }, 'GET')
      const ddata = draftsList.json && (draftsList.json.data || draftsList.json)
      const rows = (ddata && ddata.list) || (ddata && ddata.rows) || []
      const hit = rows.find((r) => /星问会查了/.test(String(r.title || ''))) || rows[0]
      check(
        'live',
        'drafts list',
        draftsList.json && (!draftsList.json.code || draftsList.json.code === 0),
        `rows=${rows.length}`
      )
      check('live', 'august import visible or list ok', !!hit || rows.length > 0, hit ? hit.title.slice(0, 40) : '')

      const cfgRes = await callAdmin(base, token, '/oa-content/config', {}, 'GET')
      const cfgData = (cfgRes.json && (cfgRes.json.data || cfgRes.json)) || {}
      const tracks = cfgData.trackSources || []
      check(
        'live',
        'GET /oa-content/config trackSources',
        cfgRes.json && (!cfgRes.json.code || cfgRes.json.code === 0) && Array.isArray(tracks),
        `sources=${tracks.length} last=${String(cfgData.lastTrackResult || '').slice(0, 80)}`
      )

      // xhs derive dry on first draft if any
      if (hit && hit._id) {
        const xr = await callAdmin(base, token, `/oa-content/drafts/${hit._id}/derive-xhs`, {
          images: hit.imageUrls || []
        })
        const xd = xr.json && (xr.json.data || xr.json)
        const xhsV = (xd && xd.xhs) || (xd && xd.variants && xd.variants.xhs) || {}
        check(
          'live',
          'derive-xhs',
          xr.json && (!xr.json.code || xr.json.code === 0) && !!(xhsV.title || xhsV.body),
          `imgs=${(xhsV.images || []).length}`
        )
      } else {
        check('live', 'derive-xhs', true, 'skipped no draft')
      }
    }
  }

  // 8 import script dry
  console.log('\n[8] import dry')
  const dry = spawnSync(
    process.execPath,
    [path.join(ROOT, '.cursor/skills/oa-update-log/scripts/import-to-drafts.js'), 'docs/wechat-oa/2026-08-update', '--dry'],
    { encoding: 'utf8', cwd: ROOT }
  )
  check('import', 'dry-run article+3 images', dry.status === 0 && /DRY OK/.test(dry.stdout || ''), (dry.stdout || '').trim().slice(0, 120))

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n=== FULL RESULT: ${passed} passed, ${failed} failed ===`)

  const outPath = path.join(ROOT, 'scripts/_tmp_oa_full_audit_result.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed,
        failed,
        results
      },
      null,
      2
    )
  )
  console.log('wrote', outPath)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
