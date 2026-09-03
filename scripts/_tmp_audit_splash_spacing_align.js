/**
 * 审计：开屏通知行距/字距/行间距 — 后台 ↔ 网关 ↔ 小程序对齐
 * 全绿输出 SPLASH_SPACING_ALIGN_AUDIT_OK
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const fails = []
const oks = []
const must = (c, m) => {
  if (!c) fails.push(m)
  else oks.push(m)
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const admin = read('admin-web/src/views/SplashScreenPage.vue')
const editor = read('admin-web/src/components/SplashNoticeEditor.vue')
const gw = read('cloudfunctions/adminGateway/index.js')
const splash = read('subpackages/index-extra/utils/index-splash.js')
const wxml = read('pages/index/index.wxml')
const wxss = read('pages/index/index.wxss')
const indexJs = read('pages/index/index.js')

// ── 1. Admin UI 控件 + 读写 ──
must(editor.includes('行距') && editor.includes('字距') && (editor.includes('行间距') || editor.includes('段间距')), 'admin editor: spacing labels')
must(editor.includes('用法同 Word') || editor.includes('sne-group-title'), 'admin editor: Word-style groups')
must(editor.includes('>字号<') || editor.includes('sne-label">字号'), 'admin editor: 字号 label before size')
must(editor.includes('sne-field'), 'admin editor: field groups (anti mislabel wrap)')
must(editor.includes('applyLineHeight'), 'admin editor: per-line applyLineHeight')
must(editor.includes('normalizeEditorOnce') || editor.includes('ensureLineDivStructure'), 'admin editor: safe normalize')
must(editor.includes('MAX_LINES') || editor.includes('slice(0, 6)'), 'admin editor: line cap')
must(editor.includes('scheduleEmit') && editor.includes('flushEmit'), 'admin editor: debounce emit')
must(editor.includes('editorFocused'), 'admin editor: focus guard vs watch loop')
must(editor.includes('clampLineHeight') && editor.includes('clampLetterSpacing') && editor.includes('clampLineGap'), 'admin editor: clamp fns')
must(editor.includes(':max="8"') && editor.includes(':max="24"'), 'admin editor: ls≤8 lg≤24')
must(editor.includes('开屏预览'), 'admin editor: preview')
must(/gap:\s*`\$\{clampLineGap\(props\.lineGap\)\}px`/.test(editor), 'admin preview: gap px')
must(/letterSpacing:\s*`\$\{clampLetterSpacing\(props\.letterSpacing\)\}px`/.test(editor), 'admin preview: letterSpacing px')
must(/line\.lineHeight/.test(editor), 'admin preview: per-line lineHeight')
must(gw.includes('line-height:') && /line-height\s*:\s*([\d.]+)/.test(gw) || gw.includes("parts.push(`line-height:"), 'gw: keep line-height in sanitize')
must(splash.includes("parts.push(`line-height:") || splash.includes('line-height:${'), 'mini client sanitize: line-height')
must(splash.includes('buildSplashNoticeLines(html, lineHeight)') || /buildSplashNoticeLines\(\s*html\s*,\s*lineHeight\s*\)/.test(splash), 'mini: build lines with default lh')
must(/item\.lineHeight|seg\.lineHeight/.test(wxml), 'wxml: per-line lineHeight bind')
must(/line-height:\s*\{\{seg\.lineHeight/.test(wxml) || /line-height:\s*\{\{item\.lineHeight/.test(wxml), 'wxml: unitless line-height on text/line')
must(/min-height:\s*\{\{item\.minHeightRpx\}\}rpx/.test(wxml), 'wxml: minHeightRpx for line box')
must(/gap:\s*\{\{splashNotice\.lineGap\}\}rpx/.test(wxml), 'wxml: gap ← lineGap rpx')
must(/letter-spacing:\s*\{\{splashNotice\.letterSpacing\}\}rpx/.test(wxml), 'wxml: letter-spacing ← ls rpx')
must(wxml.includes('splash-notice-lines') && !/<rich-text[^>]*splashNotice/.test(wxml), 'wxml: native lines, no rich-text')
must(splash.includes('minHeightRpx') && /fontSize:\s*32/.test(splash), 'mini: minHeightRpx + default 32rpx')
must(admin.includes(':line-height="form.noticeLineHeight"'), 'admin page: bind lineHeight')
must(admin.includes(':letter-spacing="form.noticeLetterSpacing"'), 'admin page: bind letterSpacing')
must(admin.includes(':line-gap="form.noticeLineGap"'), 'admin page: bind lineGap')
must(admin.includes('noticeLineHeight: form.noticeLineHeight'), 'admin save: lineHeight')
must(admin.includes('noticeLetterSpacing: form.noticeLetterSpacing'), 'admin save: letterSpacing')
must(admin.includes('noticeLineGap: form.noticeLineGap'), 'admin save: lineGap')
must(/Math\.min\(2\.5,\s*Math\.max\(1/.test(admin), 'admin load: clamp lh')
must(/Math\.min\(8,\s*Math\.max\(0/.test(admin), 'admin load: clamp ls')
must(/Math\.min\(24,\s*Math\.max\(0/.test(admin), 'admin load: clamp lg')

// ── 2. Gateway 持久化 + clamp 范围一致 ──
must(gw.includes('noticeLineHeight') && gw.includes('noticeLetterSpacing') && gw.includes('noticeLineGap'), 'gw: spacing fields')
must(gw.includes("hasOwnProperty.call(body, 'noticeLineHeight')"), 'gw: preserve lh')
must(gw.includes("hasOwnProperty.call(body, 'noticeLetterSpacing')"), 'gw: preserve ls')
must(gw.includes("hasOwnProperty.call(body, 'noticeLineGap')"), 'gw: preserve lg')
must(/Math\.min\(2\.5,\s*Math\.max\(1/.test(gw), 'gw: lh clamp 1–2.5')
must(/Math\.min\(8,\s*Math\.max\(0/.test(gw), 'gw: ls clamp 0–8')
must(/Math\.min\(24,\s*Math\.max\(0/.test(gw), 'gw: lg clamp 0–24')
must(/noticeLineHeight:\s*docExists\s*\?\s*undefined\s*:\s*1\.4/.test(gw), 'gw: autosync default lh')
must(/noticeLetterSpacing:\s*docExists\s*\?\s*undefined\s*:\s*0/.test(gw), 'gw: autosync default ls')
must(/noticeLineGap:\s*docExists\s*\?\s*undefined\s*:\s*4/.test(gw), 'gw: autosync default lg')

// 字号 12–36 与编辑器一致
must(/function isAllowedSplashNoticeSize/.test(gw) || /isAllowedSplashNoticeSize/.test(gw), 'gw: size allowlist fn')
must(editor.includes('SIZE_MIN = 12') && editor.includes('SIZE_MAX = 36'), 'admin: size 12–36')
must(/px\s*>=\s*12\s*&&\s*px\s*<=\s*36/.test(splash), 'mini: size 12–36 → rpx')

// ── 3. 小程序 normalize：px×2 → rpx；lh 无单位共用 ──
must(/letterSpacing:\s*letterSpacingPx\s*\*\s*2/.test(splash), 'mini normalize: ls ×2')
must(/lineGap:\s*lineGapPx\s*\*\s*2/.test(splash), 'mini normalize: lg ×2')
must(/lineHeight,\s*[\s\S]*?letterSpacing:\s*letterSpacingPx\s*\*\s*2/.test(splash.replace(/\n/g, ' ')), 'mini normalize: returns lh+ls+lg')
must(/Math\.min\(2\.5,\s*Math\.max\(1/.test(splash), 'mini: lh clamp')
must(/Math\.min\(8,\s*Math\.max\(0/.test(splash), 'mini: ls clamp')
must(/Math\.min\(24,\s*Math\.max\(0/.test(splash), 'mini: lg clamp')
must(splash.includes('noticeLineHeightForCache'), 'mini: cache spacing')
must(/Math\.round\(\(Number\(splashNotice\.letterSpacing\)\s*\|\|\s*0\)\s*\/\s*2\)/.test(splash), 'mini: cache ls rpx→px')
must(/Math\.round\(\(Number\(splashNotice\.lineGap\)\s*\|\|\s*8\)\s*\/\s*2\)/.test(splash), 'mini: cache lg rpx→px')

// ── 4. WXML 内联绑定（与后台参数同源）──
must(/gap:\s*\{\{splashNotice\.lineGap\}\}rpx/.test(wxml), 'wxml: gap ← lineGap rpx')
must(/letter-spacing:\s*\{\{splashNotice\.letterSpacing\}\}rpx/.test(wxml), 'wxml: letter-spacing ← ls rpx')
must(wxml.includes('splash-notice-lines') && !/<rich-text[^>]*splashNotice/.test(wxml), 'wxml: native lines, no rich-text')

// ── 5. WXSS 不硬编码覆盖 spacing（lines 容器）──
const linesBlock = wxss.match(/\.splash-notice-lines\s*\{[^}]*\}/)
must(!!linesBlock, 'wxss: .splash-notice-lines exists')
if (linesBlock) {
  must(!/\bgap\s*:/.test(linesBlock[0]), 'wxss: lines 无固定 gap（交给内联）')
  must(!/letter-spacing\s*:/.test(linesBlock[0]), 'wxss: lines 无固定 letter-spacing')
}
const lineBlock = wxss.match(/\.splash-notice-line\s*\{[^}]*\}/)
must(!!lineBlock, 'wxss: .splash-notice-line exists')
if (lineBlock) {
  must(!/line-height\s*:/.test(lineBlock[0]), 'wxss: line 无固定 line-height（交给内联）')
}

// ── 6. 既有能力仍在 ──
must(admin.includes('SplashNoticeEditor'), 'admin: editor wired')
must(admin.indexOf('label="开屏通知文案"') < admin.indexOf('label="倒计时秒数"'), 'admin: notice above countdown')
must(gw.includes('sanitizeSplashNoticeHtml') && gw.includes('strong\\b[^>]*>'), 'gw: sanitize + strong >')
must(splash.includes('buildSplashNoticeLines') && splash.includes('parseSplashNoticeInlineSegs'), 'mini: lines parse')
must(/splashNotice\s*=\s*cfg\s*\?\s*normalizeSplashNotice\(cfg\)/.test(splash), 'mini: cloud prefer')
must(wxml.indexOf('splash-notice') < wxml.indexOf('splash-mission-card'), 'wxml: notice above card')
must(wxml.includes('splash-mission-title-row'), 'wxml: title-row')
must(indexJs.includes('splashNotice: null'), 'index.js: splashNotice data')

// ── 7. Dist 含间距控件 ──
let distHit = false
const distAssets = path.join(root, 'admin-web/dist/assets')
if (fs.existsSync(distAssets)) {
  for (const f of fs.readdirSync(distAssets)) {
    if (!f.endsWith('.js')) continue
    const s = fs.readFileSync(path.join(distAssets, f), 'utf8')
    if (
      s.includes('行距') &&
      s.includes('字距') &&
      (s.includes('行间距') || s.includes('段间距')) &&
      s.includes('字号') &&
      s.includes('开屏预览') &&
      s.includes('sne-field') &&
      s.includes('noticeLineHeight')
    ) {
      distHit = true
      break
    }
  }
}
must(distHit, 'dist: spacing controls + preview shipped')

// ── 8. 逻辑：换算一致性模拟 ──
function normalizeLikeMini(cfg) {
  const lh = Number(cfg.noticeLineHeight)
  const lineHeight = Number.isFinite(lh) ? Math.min(2.5, Math.max(1, Math.round(lh * 10) / 10)) : 1.4
  const ls = Number(cfg.noticeLetterSpacing)
  const letterSpacingPx = Number.isFinite(ls) ? Math.min(8, Math.max(0, Math.round(ls))) : 0
  const lg = Number(cfg.noticeLineGap)
  const lineGapPx = Number.isFinite(lg) ? Math.min(24, Math.max(0, Math.round(lg))) : 4
  return {
    lineHeight,
    letterSpacing: letterSpacingPx * 2,
    lineGap: lineGapPx * 2
  }
}
const sample = normalizeLikeMini({ noticeLineHeight: 1.8, noticeLetterSpacing: 2, noticeLineGap: 6 })
must(sample.lineHeight === 1.8, 'logic: lh 1.8 共用')
must(sample.letterSpacing === 4, 'logic: ls 2px → 4rpx')
must(sample.lineGap === 12, 'logic: lg 6px → 12rpx')

const clamped = normalizeLikeMini({ noticeLineHeight: 9, noticeLetterSpacing: 99, noticeLineGap: -3 })
must(clamped.lineHeight === 2.5 && clamped.letterSpacing === 16 && clamped.lineGap === 0, 'logic: clamp extremes')

if (fails.length) {
  console.error('SPLASH_SPACING_ALIGN_AUDIT_FAIL')
  fails.forEach((f) => console.error(' -', f))
  console.error(`passed=${oks.length} failed=${fails.length}`)
  process.exit(1)
}
console.log('SPLASH_SPACING_ALIGN_AUDIT_OK')
console.log(`checks=${oks.length}`)
console.log(
  [
    'admin spacing UI + save/load + preview',
    'gateway persist/clamp/autosync',
    'mini px×2 rpx + cache roundtrip',
    'wxml inline bind; wxss no hard override',
    'dist rebuilt with 行距/字距/行间距'
  ].join('\n')
)
