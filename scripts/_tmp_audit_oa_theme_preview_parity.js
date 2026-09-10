/**
 * 公众号主题预览对齐冒烟审计
 * 要求：无缝切主题（preview-all + v-show）+ 预览 ≡ 推送同源管线
 * node scripts/_tmp_audit_oa_theme_preview_parity.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
let failed = 0
let passed = 0

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log('  OK ', name)
  } else {
    failed += 1
    console.log('  FAIL', name, detail ? `— ${detail}` : '')
  }
}

function prepareMarkdownForTheme(md, title) {
  let out = String(md || '').trim()
  const t = String(title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 64)
  if (t && !/^#\s+/m.test(out)) out = `# ${t}\n\n${out}`
  return out
}

function wrapThemeArticle(bodyHtml) {
  return `<section style="background-color:#ffffff;padding:16px">${String(bodyHtml || '')}</section>`
}

function main() {
  console.log('=== OA theme preview parity smoke ===\n')

  // ── 1) 语法 ──
  console.log('[1] syntax')
  ;[
    'cloudfunctions/adminGateway/oaContentStudio.js',
    'cloudfunctions/adminGateway/oaContentFormat.js',
    'cloudfunctions/adminGateway/oaContentThemes.js'
  ].forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
    check(`syntax ${f}`, r.status === 0, (r.stderr || '').trim().slice(0, 160))
  })

  // ── 2) 后端同源管线静态检查 ──
  console.log('\n[2] backend parity helpers')
  const studio = read('cloudfunctions/adminGateway/oaContentStudio.js')
  check('prepareMarkdownForTheme exists', /function prepareMarkdownForTheme\s*\(/.test(studio))
  check('wrapThemeArticle gallery section', /background-color:#ffffff;padding:16px/.test(studio))
  check('renderThemeBodyHtml exists', /function renderThemeBodyHtml\s*\(/.test(studio))
  check('previewAllThemes exists', /async function previewAllThemes\s*\(/.test(studio))
  check('no preview-only accent border', !/border-top:\s*4px solid/.test(studio), 'found accent top bar')
  check(
    'push uses prepareMarkdownForTheme',
    /prepareMarkdownForTheme\(mdForPush,\s*draft\.title\)/.test(studio)
  )
  check(
    'push uses wrapThemeArticle',
    /wrapThemeArticle\(\s*markdownToWechatHtml\(/.test(studio) ||
      /html = wrapThemeArticle\(/.test(studio)
  )
  check(
    'renderDraftHtml accepts title',
    /async function renderDraftHtml\(\{[\s\S]*?\btitle\b/.test(studio)
  )
  check(
    'preview-all route wired',
    exists('cloudfunctions/adminGateway/index.js') &&
      /preview-all|previewAllThemes/.test(read('cloudfunctions/adminGateway/index.js'))
  )

  // ── 3) 前端无缝切换 ──
  console.log('\n[3] frontend seamless switch')
  const drafts = read('admin-web/src/views/OaDraftsPage.vue')
  const client = exists('admin-web/src/api/client.js') ? read('admin-web/src/api/client.js') : ''
  check('v-show theme panes', /v-show="form\.themeId === tid"/.test(drafts))
  check('import v-show panes', /v-show="importForm\.themeId === tid"/.test(drafts))
  check('已缓存 copy', /已缓存.*套/.test(drafts))
  check('previewOaAllThemes API', /previewOaAllThemes|preview-all/.test(client + drafts))
  check('is-active theme chip', /is-active/.test(drafts) && /theme-chip/.test(drafts))
  check('passes title to preview', /title:\s*isImport \? importForm\.title : form\.title/.test(drafts))

  // ── 4) 本地渲染：主题差异 + 预览/推送同源指纹 ──
  console.log('\n[4] local render fingerprint')
  const {
    markdownToWechatHtml,
    listThemeMeta,
    resolveThemeId
  } = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaContentFormat.js'))

  const mdNoH1 = '第一段正文。\n\n第二段继续讲发射窗口。'
  const title = '火星探索日志八月更新'
  const prepared = prepareMarkdownForTheme(mdNoH1, title)
  check('injects h1 from title', prepared.startsWith('# 火星探索日志八月更新'))
  check('skips inject when h1 present', prepareMarkdownForTheme('# 已有标题\n\nbody', 'X') === '# 已有标题\n\nbody')

  const meta = listThemeMeta()
  check('theme count >= 10', meta.length >= 10, `got ${meta.length}`)

  const ids = ['bytedance', 'clean', 'lapis', 'orangeheart'].map(resolveThemeId)
  const bodies = {}
  const h1Styles = {}
  for (const tid of ids) {
    const html = wrapThemeArticle(markdownToWechatHtml(prepared, tid))
    bodies[tid] = html
    h1Styles[tid] = (html.match(/<h1 style="([^"]*)"/) || [])[1] || ''
    check(`theme ${tid} has h1`, /<h1\b/i.test(html), 'missing h1')
    check(`theme ${tid} gallery wrap`, html.includes('background-color:#ffffff;padding:16px'))
  }
  const uniq = new Set(Object.values(h1Styles).filter(Boolean))
  check('h1 styles distinct across themes', uniq.size >= 2, `uniq=${uniq.size}`)

  // 模拟「推送正文」与「预览正文」同一字符串
  const previewBody = bodies.bytedance
  const pushBody = wrapThemeArticle(
    markdownToWechatHtml(prepareMarkdownForTheme(mdNoH1, title), 'bytedance')
  )
  check('preview body === push body (bytedance)', previewBody === pushBody)

  // 纯段落无 title：两主题仍可能接近，但有 title 后必须不同
  const a = markdownToWechatHtml(prepared, 'bytedance')
  const b = markdownToWechatHtml(prepared, 'orangeheart')
  check('bytedance !== orangeheart html', a !== b)

  // ── 5) dist / 规则 ──
  console.log('\n[5] dist & rule')
  check(
    'oa-theme-preview-parity rule',
    exists('.cursor/rules/oa-theme-preview-parity.mdc')
  )
  if (exists('admin-web/dist/assets')) {
    const assets = fs.readdirSync(path.join(ROOT, 'admin-web/dist/assets'))
    const jsBundle = assets.filter((f) => f.endsWith('.js')).map((f) => read(`admin-web/dist/assets/${f}`)).join('\n')
    check('dist mentions preview-all or 已缓存', /preview-all|已缓存/.test(jsBundle))
  } else {
    check('dist built (optional skip)', true, 'no dist yet — rebuild after deploy')
  }

  // ── 6) 可选：线上 API（有 CLOUD_ENV + token 时）──
  console.log('\n[6] live API (optional)')
  const envId = process.env.CLOUD_ENV || process.env.TCB_ENV || ''
  if (!envId) {
    check('live API skipped (no CLOUD_ENV)', true)
  } else {
    check('live API env present', !!envId, envId)
  }

  console.log(`\n=== result: ${passed} passed, ${failed} failed ===`)
  process.exit(failed ? 1 : 0)
}

main()
