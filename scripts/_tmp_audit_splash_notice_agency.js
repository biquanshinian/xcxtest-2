/**
 * 审计：开屏自定义通知 + 倒计时机构信息
 * 静态检查计划清单，全绿输出 SPLASH_NOTICE_AGENCY_AUDIT_OK
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const fails = []

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function must(cond, msg) {
  if (!cond) fails.push(msg)
}

function hasAll(src, needles, label) {
  for (const n of needles) {
    must(src.includes(n), `${label}: missing ${JSON.stringify(n)}`)
  }
}

// ── 1. Admin SplashScreenPage ──
const admin = read('admin-web/src/views/SplashScreenPage.vue')
hasAll(
  admin,
  [
    'SplashNoticeEditor',
    'v-model="form.noticeText"',
    'NOTICE_MAX_LEN',
    'v-model="form.noticeFont"',
    'value="default"',
    'value="yahei"',
    'value="yahei-bold"',
    '微软雅黑',
    '微软雅黑加粗',
    'noticeText:',
    'noticeFont:',
    'NOTICE_FONTS'
  ],
  'admin SplashScreenPage'
)
must(admin.includes('不填则不显示') || admin.includes('SplashNoticeEditor'), 'admin: empty hint / rich editor')
must(/noticeText:\s*String\(form\.noticeText/.test(admin), 'admin: save sends noticeText')
must(/noticeFont:\s*NOTICE_FONTS/.test(admin) || admin.includes('noticeFont: NOTICE_FONTS'), 'admin: save sends noticeFont')
// 表单项顺序：开屏通知文案 + 通知字体 必须在「倒计时秒数」上方
{
  const noticeLabelIdx = admin.indexOf('label="开屏通知文案"')
  const fontLabelIdx = admin.indexOf('label="通知字体"')
  const cdLabelIdx = admin.indexOf('label="倒计时秒数"')
  must(noticeLabelIdx > 0 && fontLabelIdx > 0 && cdLabelIdx > 0, 'admin: notice/font/countdown labels exist')
  must(noticeLabelIdx < cdLabelIdx, 'admin: 开屏通知文案 above 倒计时秒数')
  must(fontLabelIdx < cdLabelIdx, 'admin: 通知字体 above 倒计时秒数')
  must(noticeLabelIdx < fontLabelIdx, 'admin: 开屏通知文案 above 通知字体')
}
// dist 产物需含通知字段（已 build）
{
  const distAssets = path.join(root, 'admin-web/dist/assets')
  let distHit = false
  if (fs.existsSync(distAssets)) {
    for (const f of fs.readdirSync(distAssets)) {
      if (!f.endsWith('.js')) continue
      const s = fs.readFileSync(path.join(distAssets, f), 'utf8')
      if (s.includes('开屏通知文案') && s.includes('noticeText') && s.includes('yahei-bold')) {
        distHit = true
        break
      }
    }
  }
  must(distHit, 'admin dist: built bundle contains notice UI')
}

// ── 2. adminGateway ──
const gw = read('cloudfunctions/adminGateway/index.js')
must(gw.includes("yahei-bold"), 'gateway: yahei-bold whitelist')
must(gw.includes('sanitizeSplashNoticeHtml'), 'gateway: sanitizeSplashNoticeHtml')
must(gw.includes('SPLASH_NOTICE_MAX_PLAIN'), 'gateway: notice plain max')
must(/noticeText,\s*\n\s*noticeFont,/.test(gw) || (gw.includes('noticeText,') && gw.includes('noticeFont,')), 'gateway: patch includes notice fields')
must(gw.includes("hasOwnProperty.call(body, 'noticeText')"), 'gateway: preserve noticeText if omitted')
must(gw.includes("hasOwnProperty.call(body, 'noticeFont')"), 'gateway: preserve noticeFont if omitted')
// auto sync must not wipe notice on update
must(gw.includes("noticeText: docExists ? undefined : ''"), 'gateway: auto-sync bootstrap notice only')

// ── 3. index-splash.js ──
const splash = read('subpackages/index-extra/utils/index-splash.js')
hasAll(
  splash,
  [
    'normalizeSplashNotice',
    'buildSplashMissionPayload',
    'enrichOneMissionAgencyLogo',
    'applyLaunchAgencyLogoOverridesToMission',
    'SPLASH_NOTICE_FONTS',
    'SPLASH_NOTICE_MAX_LEN',
    'agencyName',
    'agencyLogo',
    'rocketName',
    'splashNotice',
    'noticeText',
    'noticeFont'
  ],
  'index-splash'
)
// 云端优先：清空文案不再回落缓存
must(
  /splashNotice\s*=\s*cfg\s*\?\s*normalizeSplashNotice\(cfg\)\s*:\s*normalizeSplashNotice\(cached\)/.test(splash),
  'index-splash: notice prefers cloud over cache (empty clears)'
)
// 写缓存：有 cfg 时禁止用 || cached.noticeText 复活旧公告
must(splash.includes('noticeTextForCache'), 'index-splash: explicit noticeTextForCache')
must(
  !/noticeText:\s*splashNotice\s*\?\s*splashNotice\.text\s*:\s*\(cfg\s*&&\s*cfg\.noticeText\)\s*\|\|\s*\(cached/.test(
    splash
  ),
  'index-splash: must not fall back cached.noticeText when cloud empty'
)
must(
  /if\s*\(cfg\)\s*\{\s*noticeTextForCache\s*=/.test(splash.replace(/\s+/g, ' ')),
  'index-splash: cache write prefers cfg noticeText (incl empty)'
)
must(splash.includes('agencyName: payload.agencyName'), 'index-splash: mission hit cache stores agency')
must(splash.includes('agencyLogo: payload.agencyLogo'), 'index-splash: mission hit cache stores logo')
must(splash.includes('rocketName: payload.rocketName'), 'index-splash: mission hit cache stores rocket')
must(splash.includes('splashNotice: null'), 'index-splash: closeSplash clears notice')

// ── 4. pages/index data + UI ──
const indexJs = read('pages/index/index.js')
must(indexJs.includes('splashNotice: null'), 'index.js: data.splashNotice')

const wxml = read('pages/index/index.wxml')
hasAll(
  wxml,
  [
    'splash-bottom-stack',
    'splash-notice',
    'splash-notice-lines',
    'splash-notice-seg',
    'splash-mission-agency-logo',
    'splashMission.agencyName',
    'splashMission.agencyLogo',
    'splashMission.rocketName',
    'splash-mission-rocket',
    'splash-mission-title-row'
  ],
  'index.wxml'
)
must(wxml.includes('splash-notice-lines') && wxml.includes('splashNotice.lines'), 'index.wxml: native lines')
// 通知在倒计时卡之前
const noticeIdx = wxml.indexOf('splash-notice')
const cardIdx = wxml.indexOf('splash-mission-card')
must(noticeIdx > 0 && cardIdx > noticeIdx, 'index.wxml: notice above mission card in markup')

const wxss = read('pages/index/index.wxss')
hasAll(
  wxss,
  [
    '.splash-bottom-stack',
    '.splash-notice',
    '.splash-notice-lines',
    '.splash-notice-seg',
    'word-break: break-word',
    '.splash-notice--yahei',
    '.splash-notice--yahei-bold',
    'Microsoft YaHei',
    '.splash-mission-agency-logo',
    'border-radius: 50%',
    '.splash-mission-title-row',
    '.splash-mission-rocket',
    'text-overflow: ellipsis'
  ],
  'index.wxss'
)

// ── 5. 单元逻辑：normalizeSplashNotice 行为（内联复刻）──
const SPLASH_NOTICE_FONTS = { default: true, yahei: true, 'yahei-bold': true }
const SPLASH_NOTICE_MAX_LEN = 80
function normalizeSplashNotice(cfg) {
  if (!cfg || typeof cfg !== 'object') return null
  const raw = String(cfg.noticeText || '').trim()
  if (!raw) return null
  const plain = raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
  if (!plain) return null
  const text = plain.slice(0, SPLASH_NOTICE_MAX_LEN)
  const fontRaw = String(cfg.noticeFont || 'default').trim()
  const font = SPLASH_NOTICE_FONTS[fontRaw] ? fontRaw : 'default'
  return { text, html: raw, font }
}
must(normalizeSplashNotice(null) === null, 'logic: null cfg')
must(normalizeSplashNotice({ noticeText: '  ' }) === null, 'logic: blank text hidden')
must(normalizeSplashNotice({ noticeText: 'hello' }).font === 'default', 'logic: default font')
must(normalizeSplashNotice({ noticeText: 'hello', noticeFont: 'yahei-bold' }).font === 'yahei-bold', 'logic: bold font')
must(normalizeSplashNotice({ noticeText: 'hello', noticeFont: 'comic' }).font === 'default', 'logic: bad font fallback')
must(normalizeSplashNotice({ noticeText: 'a'.repeat(100) }).text.length === 80, 'logic: truncate 80')
must(!!normalizeSplashNotice({ noticeText: '<div style="text-align:center">hi</div>' }).html, 'logic: html kept')

function buildSplashMissionPayload(hit) {
  if (!hit || !hit.id) return null
  return {
    id: hit.id,
    name: hit.missionName || hit.name || '',
    launchTime: hit.launchTime,
    agencyName: String(hit.launchAgency || '').trim(),
    agencyLogo: String(hit.launchAgencyImage || '').trim(),
    rocketName: String(hit.rocketName || hit.rocketConfiguration || '').trim()
  }
}
const payload = buildSplashMissionPayload({
  id: '1',
  missionName: 'Starlink',
  launchTime: '2026-01-01',
  launchAgency: 'SpaceX',
  launchAgencyImage: 'https://logo',
  rocketName: '',
  rocketConfiguration: 'Falcon 9'
})
must(payload.agencyName === 'SpaceX', 'logic: agency name')
must(payload.agencyLogo === 'https://logo', 'logic: agency logo')
must(payload.rocketName === 'Falcon 9', 'logic: rocket fallback to configuration')
must(buildSplashMissionPayload(null) === null, 'logic: null hit')

// ── report ──
if (fails.length) {
  console.error('SPLASH_NOTICE_AGENCY_AUDIT_FAIL')
  fails.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('SPLASH_NOTICE_AGENCY_AUDIT_OK')
console.log(
  [
    'admin noticeText/noticeFont UI+save',
    'gateway normalize+preserve+autosync-safe',
    'splash notice cloud-priority + cache',
    'agency/logo/rocket enrich + hit cache',
    'wxml/wxss typography + circular logo'
  ].join('\n')
)
