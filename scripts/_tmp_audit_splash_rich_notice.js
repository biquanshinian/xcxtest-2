/**
 * 审计：开屏倒计时排版（任务名|火箭同排）+ 通知富文本（对齐/换行/字号/加粗）
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const fails = []
const must = (c, m) => {
  if (!c) fails.push(m)
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ── 1. 倒计时卡排版 ──
const wxml = read('pages/index/index.wxml')
must(wxml.includes('splash-mission-title-row'), 'wxml: title-row')
must(
  /splash-mission-title-row[\s\S]*?splash-mission-name[\s\S]*?splash-mission-rocket/.test(wxml),
  'wxml: name then rocket in same row'
)
must(!/splash-mission-meta[\s\S]*?splash-mission-rocket/.test(
  wxml.slice(wxml.indexOf('splash-mission-meta'), wxml.indexOf('splash-mission-title-row') + 1)
) || !wxml
  .slice(wxml.indexOf('splash-mission-meta'), wxml.indexOf('splash-mission-title-row'))
  .includes('splash-mission-rocket'), 'wxml: rocket not under agency meta')

const wxss = read('pages/index/index.wxss')
must(wxss.includes('.splash-mission-title-row'), 'wxss: title-row')
must(/\.splash-mission-title-row\s+\.splash-mission-rocket\s*\{[^}]*font-size:\s*36rpx/s.test(wxss), 'wxss: rocket same 36rpx as name')
must(wxss.includes('border-radius: 50%'), 'wxss: circular logo')

// ── 2. Admin 富文本编辑器 ──
const editor = read('admin-web/src/components/SplashNoticeEditor.vue')
must(editor.includes('左对齐') && editor.includes('居中') && editor.includes('右对齐'), 'editor: align buttons')
must(editor.includes('加粗'), 'editor: bold')
must(editor.includes('contenteditable'), 'editor: contenteditable')
must(editor.includes('applySize') && (editor.includes("value: 12") || editor.includes('SIZE_OPTS')), 'editor: size options')
must(editor.includes('maxLen'), 'editor: maxLen')
must(editor.includes('applyLineHeight') && editor.includes('flushEmit'), 'editor: per-line lh + flush')
must(
  (editor.includes('normalizeEditorOnce') || editor.includes('ensureLineDivStructure')) && editor.includes('scheduleEmit'),
  'editor: structure + debounce'
)
must(editor.includes('editorFocused') || editor.includes('@blur="onBlur"'), 'editor: blur/focus safe')

const admin = read('admin-web/src/views/SplashScreenPage.vue')
must(admin.includes('SplashNoticeEditor'), 'admin: uses SplashNoticeEditor')
must(admin.includes('NOTICE_MAX_LEN'), 'admin: NOTICE_MAX_LEN')
{
  const iN = admin.indexOf('label="开屏通知文案"')
  const iF = admin.indexOf('label="通知字体"')
  const iC = admin.indexOf('label="倒计时秒数"')
  must(iN > 0 && iN < iF && iF < iC, 'admin: notice above font above countdown')
}
must(!/maxlength="48"/.test(admin) || !admin.includes('v-model="form.noticeText"'), 'admin: no plain textarea maxlength 48')

// ── 3. Gateway 消毒 ──
const gw = read('cloudfunctions/adminGateway/index.js')
must(gw.includes('sanitizeSplashNoticeHtml'), 'gateway: sanitize fn')
must(gw.includes('SPLASH_NOTICE_MAX_PLAIN'), 'gateway: max plain')
must(gw.includes('sanitizeSplashNoticeHtml(body.noticeText)') || gw.includes('sanitizeSplashNoticeHtml(body.noticeText'), 'gateway: uses sanitize on save')
must(gw.includes("hasOwnProperty.call(body, 'noticeText')"), 'gateway: preserve omit')
must(gw.includes("noticeText: docExists ? undefined : ''"), 'gateway: autosync safe')
must(
  gw.includes('SPLASH_NOTICE_SIZE_MIN = 12') &&
    gw.includes('SPLASH_NOTICE_SIZE_MAX = 36') &&
    gw.includes('isAllowedSplashNoticeSize'),
  'gateway: size whitelist 12–36'
)

// ── 4. 小程序运行时 ──
const splash = read('subpackages/index-extra/utils/index-splash.js')
must(splash.includes('sanitizeSplashNoticeHtmlClient'), 'splash: client sanitize')
must(splash.includes('SPLASH_NOTICE_MAX_LEN = 80'), 'splash: max 80')
must(/return\s*\{\s*text:\s*plain,\s*html,\s*font/.test(splash.replace(/\s+/g, ' ')), 'splash: notice {text,html,font}')
must(/splashNotice\s*=\s*cfg\s*\?\s*normalizeSplashNotice\(cfg\)/.test(splash), 'splash: cloud prefer')
must(splash.includes('noticeTextForCache'), 'splash: cache write explicit')
must(splash.includes('agencyLogo') && splash.includes('rocketName'), 'splash: agency/rocket payload')

must(wxml.includes('splash-notice-lines') && wxml.includes('splash-notice-seg'), 'wxml: native lines/segs')
must(!/<rich-text[^>]*splashNotice/.test(wxml), 'wxml: notice not via rich-text')
must(wxss.includes('.splash-notice-lines') && wxss.includes('.splash-notice-seg--bold'), 'wxss: lines/bold styles')
must(wxss.includes('splash-notice--yahei-bold'), 'wxss: font classes')

// ── 5. pointer-events / 可点 ──
must(wxss.includes('pointer-events: none') && wxss.includes('pointer-events: auto'), 'wxss: card clickable')

// ── 6. dist ──
let distHit = false
const distAssets = path.join(root, 'admin-web/dist/assets')
if (fs.existsSync(distAssets)) {
  for (const f of fs.readdirSync(distAssets)) {
    if (!f.endsWith('.js')) continue
    const s = fs.readFileSync(path.join(distAssets, f), 'utf8')
    if (s.includes('SplashNoticeEditor') && s.includes('左对齐') && s.includes('开屏通知文案')) {
      distHit = true
      break
    }
  }
}
must(distHit, 'dist: built with rich editor')

// ── 7. 逻辑：消毒与空文案 ──
function splashNoticePlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n+$/g, '')
    .trim()
}
must(splashNoticePlainText('<div style="text-align:center">你好<br/>世界</div>') === '你好\n世界', 'logic: br to newline')
must(splashNoticePlainText('<div><br/></div>') === '', 'logic: empty br hidden')
must(splashNoticePlainText('') === '', 'logic: empty')

if (fails.length) {
  console.error('SPLASH_RICH_NOTICE_AUDIT_FAIL')
  fails.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('SPLASH_RICH_NOTICE_AUDIT_OK')
console.log(
  [
    'countdown title-row name|rocket same size',
    'admin rich editor align/bold/size + form order',
    'gateway sanitize + preserve + autosync',
    'mini rich-text + cloud-prefer cache',
    'dist rebuilt'
  ].join('\n')
)
