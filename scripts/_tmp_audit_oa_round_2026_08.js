/**
 * 2026-08 内容中台全面审计（摘要/封面/手机卡片/主题/导入/线上草稿）
 * node scripts/_tmp_audit_oa_round_2026_08.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const http = require('http')
const https = require('https')
const {
  looksLikeCoverLinkDigest,
  markdownToDigest,
  resolveArticleDigest
} = require('../cloudfunctions/adminGateway/oaStudioHelpers')

const ROOT = path.join(__dirname, '..')
const results = []

function check(section, name, ok, detail) {
  results.push({ section, name, ok: !!ok, detail: String(detail || '') })
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
  console.log('=== OA round audit 2026-08 ===\n')

  // 1 digest unit
  console.log('[1] digest helpers')
  const sampleMd =
    '# 观礼商家入驻很简单：按这几步做就行\n\n![封面](https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg)\n\n你家有合适的观礼位置（楼顶、院子），想接待来看火箭的客人？'
  const dig = markdownToDigest(sampleMd)
  check('digest', 'strips cover image+alt', !/封面|https?:\/\//i.test(dig) && /观礼位置/.test(dig), dig.slice(0, 60))
  check(
    'digest',
    'detects polluted digest',
    looksLikeCoverLinkDigest('封面https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg 你家有')
  )
  check(
    'digest',
    'resolve prefers clean markdown',
    /观礼位置/.test(
      resolveArticleDigest(
        { digest: '封面https://mars.example.com/a.jpg', markdown: sampleMd },
        sampleMd
      )
    )
  )
  const helpers = read('cloudfunctions/adminGateway/oaStudioHelpers.js')
  const studio = read('cloudfunctions/adminGateway/oaContentStudio.js')
  check('digest', 'helpers exported', /markdownToDigest/.test(helpers) && /resolveArticleDigest/.test(helpers))
  check('digest', 'importDraft uses resolveArticleDigest', /resolveArticleDigest\(body,\s*bodyMd\)/.test(studio))
  check('digest', 'push corrects digest', /推送前校正摘要/.test(studio) || /resolveArticleDigest\(draft\)/.test(studio))
  check('digest', 'generate uses markdownToDigest', /markdownToDigest\(parsed\.body/.test(studio))
  check('digest', 'no legacy strip-only digest in import', !/replace\(\/\[#>\*`\\\[\\\]!\(\)\\]\/g/.test(studio))

  // 2 import script + skill
  console.log('\n[2] import / skill')
  const importJs = read('.cursor/skills/oa-update-log/scripts/import-to-drafts.js')
  const skill = exists('.cursor/skills/oa-update-log/SKILL.md') ? read('.cursor/skills/oa-update-log/SKILL.md') : ''
  check('import', 'passes digest field', /digest:\s*digest/.test(importJs))
  check('import', 'requires cover file', /缺专属封面|禁止默认封面/.test(importJs))
  check('import', 'uses markdownToDigest helper', /markdownToDigest/.test(importJs))
  check('skill', 'skill mentions no default cover', /禁止.*默认封面|专属.*封面|配生成图/.test(skill))

  // 3 local tip artifacts
  console.log('\n[3] local tips + merchant covers')
  const tipsRoot = path.join(ROOT, 'docs/wechat-oa/product-tips-2026-08')
  const tipDirs = fs.existsSync(tipsRoot)
    ? fs.readdirSync(tipsRoot).filter((n) => fs.existsSync(path.join(tipsRoot, n, 'article.md'))).sort()
    : []
  check('content', 'tips count 30', tipDirs.length === 30, `got ${tipDirs.length}`)
  let tipCoverOk = 0
  let tipMdCoverOk = 0
  let tipDigestOk = 0
  for (const d of tipDirs) {
    const dir = path.join(tipsRoot, d)
    const md = fs.readFileSync(path.join(dir, 'article.md'), 'utf8')
    const hasCoverJpg = fs.existsSync(path.join(dir, 'cover.jpg'))
    const hasMdCover = /!\[[^\]]*\]\([^)]*cover[^)]*\)/i.test(md)
    if (hasCoverJpg) tipCoverOk += 1
    if (hasMdCover) tipMdCoverOk += 1
    const dgst = markdownToDigest(md)
    if (dgst && !looksLikeCoverLinkDigest(dgst) && !/^https?:\/\//i.test(dgst)) tipDigestOk += 1
  }
  check('content', 'tips cover.jpg 30/30', tipCoverOk === 30, `${tipCoverOk}/30`)
  check('content', 'tips md ![封面]', tipMdCoverOk === 30, `${tipMdCoverOk}/30`)
  check('content', 'tips digest clean', tipDigestOk === 30, `${tipDigestOk}/30`)
  const merchantDir = 'docs/wechat-oa/merchant-onboarding-2026-08'
  check('content', 'merchant article', exists(`${merchantDir}/article.md`))
  check('content', 'merchant cover.jpg', exists(`${merchantDir}/cover.jpg`))
  if (exists(`${merchantDir}/article.md`)) {
    const mmd = read(`${merchantDir}/article.md`)
    const mdg = markdownToDigest(mmd)
    check('content', 'merchant digest clean', !looksLikeCoverLinkDigest(mdg) && /观礼/.test(mdg), mdg.slice(0, 50))
  }

  // 4 mobile drafts
  console.log('\n[4] mobile drafts UI')
  const drafts = read('admin-web/src/views/OaDraftsPage.vue')
  check('mobile', 'draft-cards list', /draft-cards/.test(drafts) && /ops--card/.test(drafts))
  check('mobile', 'isMobile matchMedia', /matchMedia\('\(max-width: 768px\)'\)/.test(drafts))
  check('mobile', 'desktop table gated', /v-if="!isMobile"/.test(drafts))
  check('mobile', 'mobile cards gated', /v-if="isMobile"/.test(drafts))
  check('mobile', 'ops 2-col on cards', /ops--card[\s\S]*grid-template-columns:\s*1fr 1fr/.test(drafts))
  check('mobile', 'no reliance on fixed-right alone', /draft-cards/.test(drafts))
  const theme = read('admin-web/src/styles/theme.css')
  const layout = read('admin-web/src/views/LayoutPage.vue')
  check('mobile', 'viewport/safe-area', /viewport-fit=cover/.test(read('admin-web/index.html')) && /safe-area-inset/.test(theme))
  check('mobile', 'layout hamburger', /hamburger-btn/.test(layout))

  // 5 dist
  console.log('\n[5] admin-web dist')
  check('dist', 'dist index', exists('admin-web/dist/index.html'))
  if (exists('admin-web/dist/assets')) {
    const assets = fs.readdirSync(path.join(ROOT, 'admin-web/dist/assets'))
    const draftsCss = assets.find((f) => f.startsWith('OaDraftsPage') && f.endsWith('.css'))
    const draftsJs = assets.find((f) => f.startsWith('OaDraftsPage') && f.endsWith('.js'))
    check('dist', 'OaDraftsPage css', !!draftsCss, draftsCss || '')
    check('dist', 'OaDraftsPage js', !!draftsJs, draftsJs || '')
    if (draftsCss) {
      const css = read(`admin-web/dist/assets/${draftsCss}`)
      check('dist', 'dist has draft-cards', /draft-cards/.test(css) || /draft-card/.test(css))
      check('dist', 'dist has ops--card grid', /ops--card|1fr 1fr/.test(css))
    }
    if (draftsJs) {
      const js = read(`admin-web/dist/assets/${draftsJs}`)
      check('dist', 'dist has isMobile cards', /draft-cards/.test(js) && /isMobile|matchMedia/.test(js))
    }
  }

  // 6 theme parity nested
  console.log('\n[6] nested theme parity')
  const parity = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/_tmp_audit_oa_theme_preview_parity.js')],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
  )
  check('parity', 'theme preview parity exit 0', parity.status === 0, (parity.stderr || parity.stdout || '').slice(-120))

  // 7 live drafts
  console.log('\n[7] live drafts API')
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/ops-admin-login.js')], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  const local = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = local.OA_ADMIN_TOKEN
  const base = String(local.ADMIN_API_BASE || '').replace(/\/$/, '')
  check('live', 'admin token', !!token)
  if (token && base) {
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
      const total = (j.data && j.data.total) || 0
      all.push(...list)
      if (!list.length || all.length >= total) break
    }
    check('live', 'drafts listed', all.length > 0, `n=${all.length}`)
    const polluted = all.filter((d) => looksLikeCoverLinkDigest(d.digest || ''))
    check('live', 'no polluted digests', polluted.length === 0, polluted.length ? polluted.slice(0, 3).map((d) => d.title).join(';') : '')
    const uniqueCovers = new Set(all.map((d) => String(d.coverUrl || '')).filter(Boolean))
    check('live', 'covers unique-ish', uniqueCovers.size >= Math.min(20, all.length), `unique=${uniqueCovers.size}/${all.length}`)
    const tipsMeta = exists('docs/wechat-oa/product-tips-2026-08/_covers-meta.json')
      ? JSON.parse(read('docs/wechat-oa/product-tips-2026-08/_covers-meta.json'))
      : []
    const tipTitles = new Set(tipsMeta.map((x) => x.title.trim()))
    tipTitles.add('观礼商家入驻很简单：按这几步做就行')
    const matched = all.filter((d) => tipTitles.has(String(d.title || '').trim()))
    check('live', 'tips+merchant present', matched.length >= 31, `matched=${matched.length}`)
    const byTitle = {}
    for (const d of matched) {
      const t = d.title.trim()
      byTitle[t] = (byTitle[t] || 0) + 1
    }
    const dups = Object.entries(byTitle).filter(([, n]) => n > 1)
    check('live', 'no tip title duplicates', dups.length === 0, dups.map(([t]) => t).join(';'))
  }

  // 8 syntax
  console.log('\n[8] syntax')
  for (const f of [
    'cloudfunctions/adminGateway/oaStudioHelpers.js',
    'cloudfunctions/adminGateway/oaContentStudio.js',
    '.cursor/skills/oa-update-log/scripts/import-to-drafts.js'
  ]) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
    check('syntax', f, r.status === 0, (r.stderr || '').slice(0, 80))
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  const summary = {
    at: new Date().toISOString(),
    passed,
    failed: failed.length,
    total: results.length,
    fails: failed,
    results
  }
  const out = path.join(ROOT, 'scripts/_tmp_oa_round_2026_08_result.json')
  fs.writeFileSync(out, JSON.stringify(summary, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(`passed ${passed}/${results.length}, failed ${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log('  -', f.section, f.name, f.detail)
  }
  console.log('wrote', out)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
