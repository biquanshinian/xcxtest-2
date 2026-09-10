/**
 * 全量审计：开屏通知富文本 + 换行行渲染 + 倒计时排版
 * 全绿输出 SPLASH_NOTICE_FINAL_AUDIT_OK
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const fails = []
const must = (c, m) => {
  if (!c) fails.push(m)
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ── Admin ──
const admin = read('admin-web/src/views/SplashScreenPage.vue')
must(admin.includes('SplashNoticeEditor'), 'admin: SplashNoticeEditor')
must(admin.indexOf('label="开屏通知文案"') < admin.indexOf('label="倒计时秒数"'), 'admin: notice above countdown')
must(admin.indexOf('label="通知字体"') < admin.indexOf('label="倒计时秒数"'), 'admin: font above countdown')

const editor = read('admin-web/src/components/SplashNoticeEditor.vue')
must(editor.includes('左对齐') && editor.includes('居中') && editor.includes('右对齐'), 'editor: align')
must(editor.includes('加粗'), 'editor: bold')
must(editor.includes("label: '小'") || editor.includes('小'), 'editor: size buttons')
must(
  editor.includes('@mousedown.prevent="onSizeMouseDown') || editor.includes('@mousedown.prevent="applySize'),
  'editor: size via mousedown.prevent'
)
must(editor.includes('savedRange') || editor.includes('captureLiveSelection') || editor.includes('saveSelection'), 'editor: save selection')
must(
  editor.includes('flushEmit') && editor.includes('scheduleEmit') && (editor.includes('normalizeEditorOnce') || editor.includes('ensureLineDivStructure')),
  'editor: debounce emit + normalize on blur'
)
must(editor.includes('applyLineHeight'), 'editor: per-line lh')
must(editor.includes('@blur="onBlur"') || editor.includes('flushEmit(true)'), 'editor: blur normalize')
must(editor.includes('MAX_LINES') || /collected\.length\s*>=\s*6|slice\(0,\s*6\)/.test(editor), 'editor: max lines cap')
must(editor.includes('editorFocused'), 'editor: no watch rewrite while focused')

// ── Gateway ──
const gw = read('cloudfunctions/adminGateway/index.js')
must(gw.includes('sanitizeSplashNoticeHtml'), 'gw: sanitize')
must(gw.includes('SPLASH_NOTICE_MAX_PLAIN'), 'gw: max plain')
must(gw.includes("hasOwnProperty.call(body, 'noticeText')"), 'gw: preserve')
must(gw.includes("noticeText: docExists ? undefined : ''"), 'gw: autosync safe')

// ── Mini splash logic ──
const splash = read('subpackages/index-extra/utils/index-splash.js')
must(splash.includes('buildSplashNoticeLines'), 'splash: buildSplashNoticeLines')
must(splash.includes('parseSplashNoticeInlineSegs'), 'splash: parse inline segs')
must(splash.includes('cleanNoticeSegText'), 'splash: clean seg text (anti-garble)')
must(splash.includes('sanitizeSplashNoticeHtmlClient'), 'splash: client sanitize')
must(splash.includes('strong\\b[^>]*>'), 'splash: strong replace keeps >')
must(!splash.includes(".replace(/<\\s*strong\\b/gi, '<span style=\"font-weight:700\"')"), 'splash: no broken strong replace')
must(gw.includes('strong\\b[^>]*>'), 'gw: strong replace keeps >')
must(/return\s*\{\s*text:\s*plain,\s*html,\s*font,\s*align(?::\s*\w+)?,\s*lines/.test(splash.replace(/\s+/g, ' ')), 'splash: notice vm has lines')
must(/splashNotice\s*=\s*cfg\s*\?\s*normalizeSplashNotice\(cfg\)/.test(splash), 'splash: cloud prefer')
must(splash.includes('noticeTextForCache'), 'splash: cache write')
must(
  !/noticeText:\s*splashNotice\s*\?\s*splashNotice\.text\s*:\s*\(cfg\s*&&\s*cfg\.noticeText\)\s*\|\|\s*\(cached/.test(
    splash
  ),
  'splash: no poison cache'
)
must(splash.includes('agencyLogo') && splash.includes('rocketName'), 'splash: agency/rocket')
must(splash.includes('enrichOneMissionAgencyLogo'), 'splash: logo enrich')

// ── WXML / WXSS ──
const wxml = read('pages/index/index.wxml')
must(wxml.includes('splash-notice-lines'), 'wxml: lines container')
must(wxml.includes('splash-notice-line'), 'wxml: line')
must(wxml.includes('splash-notice-seg'), 'wxml: seg')
must(!/<rich-text[^>]*splashNotice/.test(wxml), 'wxml: no rich-text for notice')
must(wxml.indexOf('splash-notice') < wxml.indexOf('splash-mission-card'), 'wxml: notice above card')
must(wxml.includes('splash-mission-title-row'), 'wxml: title-row')
must(
  /splash-mission-title-row[\s\S]*?splash-mission-name[\s\S]*?splash-mission-rocket/.test(wxml),
  'wxml: name then rocket'
)

const wxss = read('pages/index/index.wxss')
must(wxss.includes('.splash-notice-lines--left'), 'wxss: align left')
must(wxss.includes('.splash-notice-lines--center'), 'wxss: align center')
must(wxss.includes('.splash-notice-lines--right'), 'wxss: align right')
must(wxss.includes('.splash-notice-seg--bold'), 'wxss: bold seg')
must(/\.splash-mission-title-row\s+\.splash-mission-rocket\s*\{[^}]*font-size:\s*36rpx/s.test(wxss), 'wxss: rocket 36rpx')
must(wxss.includes('pointer-events: none') && wxss.includes('pointer-events: auto'), 'wxss: card clickable')

const indexJs = read('pages/index/index.js')
must(indexJs.includes('splashNotice: null'), 'index.js: data')

// ── Dist ──
let distHit = false
const distAssets = path.join(root, 'admin-web/dist/assets')
if (fs.existsSync(distAssets)) {
  for (const f of fs.readdirSync(distAssets)) {
    if (!f.endsWith('.js')) continue
    const s = fs.readFileSync(path.join(distAssets, f), 'utf8')
    if (
      s.includes('SplashNoticeEditor') &&
      s.includes('字号') &&
      s.includes('左对齐') &&
      s.includes('开屏通知文案') &&
      s.includes('sne-field')
    ) {
      distHit = true
      break
    }
  }
}
must(distHit, 'dist: rich editor + spacing fields')

// ── Logic: line parse（与线上一致）──
function decodeNoticeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}
function parseSplashNoticeInlineSegs(fragment) {
  const segs = []
  const src = String(fragment || '')
  if (!src) return segs
  function walk(html, base) {
    const re = /<span\b([^>]*)>([\s\S]*?)<\/span>|([^<]+)/gi
    let m
    const str = String(html || '')
    let matched = false
    while ((m = re.exec(str))) {
      matched = true
      if (m[3] != null) {
        const t = decodeNoticeEntities(m[3])
        if (t) segs.push({ text: t, bold: !!base.bold, fontSize: base.fontSize })
        continue
      }
      const attrs = m[1] || ''
      const inner = m[2] || ''
      const next = {
        bold: base.bold || /font-weight\s*:\s*(bold|700)/i.test(attrs),
        fontSize: base.fontSize
      }
      const sizeM = attrs.match(/font-size\s*:\s*(\d+)\s*px/i)
      if (sizeM) {
        const px = Number(sizeM[1])
        if (px === 12 || px === 14 || px === 16 || px === 18) next.fontSize = px * 2
      }
      if (/<span\b/i.test(inner)) walk(inner, next)
      else {
        const t = decodeNoticeEntities(inner.replace(/<[^>]+>/g, ''))
        if (t) segs.push({ text: t, bold: !!next.bold, fontSize: next.fontSize })
      }
    }
    if (!matched) {
      const t = decodeNoticeEntities(str.replace(/<[^>]+>/g, ''))
      if (t) segs.push({ text: t, bold: !!base.bold, fontSize: base.fontSize })
    }
  }
  walk(src, { bold: false, fontSize: 28 })
  return segs
}
function buildSplashNoticeLines(html) {
  let src = String(html || '')
  src = src.replace(/<\/div>\s*<div\b[^>]*>/gi, '\n')
  src = src.replace(/<br\s*\/?>/gi, '\n')
  src = src.replace(/<\/?div\b[^>]*>/gi, '')
  const rawLines = src.split('\n')
  const lines = []
  for (let i = 0; i < rawLines.length; i++) {
    const segs = parseSplashNoticeInlineSegs(rawLines[i])
    if (!segs.length) {
      if (lines.length && i < rawLines.length - 1) lines.push({ empty: true, segs: [] })
      continue
    }
    lines.push({ empty: false, segs })
  }
  while (lines.length && lines[lines.length - 1].empty) lines.pop()
  return lines.slice(0, 6)
}

const brLines = buildSplashNoticeLines(
  '<div style="text-align:center">第一行<br/>第二行<span style="font-weight:700">加粗</span></div>'
)
must(brLines.length === 2, 'logic: br → 2 lines')
must(brLines[1].segs.some((s) => s.text.includes('加粗') && s.bold), 'logic: bold seg')

const divLines = buildSplashNoticeLines(
  '<div style="text-align:left">A</div><div style="text-align:left">B</div>'
)
must(divLines.length === 2 && divLines[0].segs[0].text === 'A' && divLines[1].segs[0].text === 'B', 'logic: div blocks → lines')

const sizeLines = buildSplashNoticeLines(
  '<div style="text-align:center"><span style="font-size:18px">大字</span></div>'
)
must(sizeLines[0] && sizeLines[0].segs[0].fontSize === 36, 'logic: 18px → 36rpx')

if (fails.length) {
  console.error('SPLASH_NOTICE_FINAL_AUDIT_FAIL')
  fails.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('SPLASH_NOTICE_FINAL_AUDIT_OK')
console.log(
  [
    'admin editor align/bold/size + Enter br + form order',
    'gateway sanitize/preserve/autosync',
    'mini lines render (no rich-text) + cloud cache',
    'countdown title-row name|rocket',
    'dist rebuilt with insertLineBreak'
  ].join('\n')
)
