/** 补充审计：表单顺序 / 缓存清空 / dist / agency UI / rich-text */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const fails = []
const must = (c, m) => {
  if (!c) fails.push(m)
}

const admin = fs.readFileSync(path.join(root, 'admin-web/src/views/SplashScreenPage.vue'), 'utf8')
const iN = admin.indexOf('label="开屏通知文案"')
const iF = admin.indexOf('label="通知字体"')
const iC = admin.indexOf('label="倒计时秒数"')
must(iN > 0 && iF > 0 && iC > 0, 'labels exist')
must(iN < iF && iF < iC, 'form order: 通知文案 → 通知字体 → 倒计时秒数')
must(admin.includes('SplashNoticeEditor'), 'admin rich editor')

const gw = fs.readFileSync(path.join(root, 'cloudfunctions/adminGateway/index.js'), 'utf8')
must(gw.includes("hasOwnProperty.call(body, 'noticeText')"), 'gateway preserve noticeText')
must(gw.includes("noticeText: docExists ? undefined : ''"), 'autosync does not wipe notice')
must(gw.includes('sanitizeSplashNoticeHtml'), 'gateway sanitize')

const splash = fs.readFileSync(path.join(root, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
must(/splashNotice\s*=\s*cfg\s*\?\s*normalizeSplashNotice\(cfg\)/.test(splash), 'cloud prefer for display')
must(splash.includes('noticeTextForCache'), 'explicit cache write')
must(
  !/noticeText:\s*splashNotice\s*\?\s*splashNotice\.text\s*:\s*\(cfg\s*&&\s*cfg\.noticeText\)\s*\|\|\s*\(cached/.test(
    splash
  ),
  'no poison cache fallback'
)
must(splash.includes('enrichOneMissionAgencyLogo'), 'logo enrich')
must(splash.includes('agencyName: payload.agencyName'), 'hit cache agency')
must(splash.includes('sanitizeSplashNoticeHtmlClient'), 'client sanitize')

const wxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
must(wxml.indexOf('splash-notice') < wxml.indexOf('splash-mission-card'), 'notice above card')
must(wxml.includes('splash-notice-lines') && wxml.includes('splashNotice.lines'), 'native lines nodes')
must(wxml.includes('splash-mission-title-row'), 'title-row name|rocket')
must(wxml.includes('splashMission.agencyLogo') && wxml.includes('splashMission.rocketName'), 'agency rocket UI')

const wxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
must(wxss.includes('border-radius: 50%') && wxss.includes('.splash-mission-agency-logo'), 'circular logo')
must(wxss.includes('.splash-notice-lines') && wxss.includes('.splash-notice-seg--bold'), 'lines/bold styles')
must(/\.splash-mission-title-row\s+\.splash-mission-rocket\s*\{[^}]*font-size:\s*36rpx/s.test(wxss), 'rocket 36rpx')

let distHit = false
const distAssets = path.join(root, 'admin-web/dist/assets')
if (fs.existsSync(distAssets)) {
  for (const f of fs.readdirSync(distAssets)) {
    if (!f.endsWith('.js')) continue
    const s = fs.readFileSync(path.join(distAssets, f), 'utf8')
    if (
      s.includes('开屏通知文案') &&
      s.includes('SplashNoticeEditor') &&
      s.includes('左对齐') &&
      s.includes('字号') &&
      s.includes('sne-field')
    ) {
      distHit = true
      break
    }
  }
}
must(distHit, 'dist bundle contains rich notice UI + line fields')

if (fails.length) {
  console.error('ROUND2_FAIL')
  fails.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('ROUND2_OK')
