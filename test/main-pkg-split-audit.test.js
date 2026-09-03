/**
 * 主包拆分包后的静态守卫：防止再次把逻辑/资源拆坏。
 * 运行：node --test test/main-pkg-split-audit.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function walkFiles(relDir, acc, filter) {
  const dir = path.join(ROOT, relDir)
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const rel = path.posix.join(relDir.replace(/\\/g, '/'), name)
    const full = path.join(ROOT, rel)
    const st = fs.statSync(full)
    if (st.isDirectory()) walkFiles(rel, acc, filter)
    else if (!filter || filter(rel)) acc.push(rel)
  }
}

const MEDIA_IN_SUBPKG = /\/subpackages\/[^"' )\]]+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i
const ASYNC_CALL = /require\.async\s*\(\s*([^)]+?)\s*\)/g

test('主包 Tab / 主包组件不得写分包静态图路径', () => {
  const files = []
  for (const root of [
    'pages/index',
    'pages/monitor',
    'pages/progress',
    'pages/news',
    'pages/profile',
    'components',
    'custom-tab-bar'
  ]) {
    walkFiles(root, files, (rel) => /\.(wxml|wxss)$/.test(rel))
  }
  if (exists('app.wxss')) files.push('app.wxss')
  const hits = []
  for (const rel of files) {
    const text = read(rel)
    if (MEDIA_IN_SUBPKG.test(text)) hits.push(rel)
  }
  assert.deepEqual(hits, [], `主包 UI 引用了分包图片: ${hits.join(', ')}`)
})

test('博卡奇卡天气图标由 monitor-pages 组件渲染', () => {
  const page = read('pages/monitor/monitor.wxml')
  const json = read('pages/monitor/monitor.json')
  const comp = read('subpackages/monitor-pages/components/monitor-starbase-weather/index.wxml')
  assert.match(page, /<monitor-starbase-weather\b/)
  assert.doesNotMatch(page, /starbaseWeather\.weatherIcon/)
  assert.doesNotMatch(page, /starbaseWeather\.windIcon/)
  assert.match(json, /monitor-starbase-weather/)
  assert.match(comp, /weather\.weatherIcon/)
  assert.match(comp, /weather\.windIcon/)
  assert.ok(exists('subpackages/monitor-pages/images/starbase-weather/w-clear.svg'))
  assert.equal(exists('images/starbase-weather'), false)
})

test('微信小店图标由 profile-extra 组件渲染', () => {
  const page = read('pages/profile/profile.wxml')
  const json = read('pages/profile/profile.json')
  const comp = read('subpackages/profile-extra/components/wechat-shop-icon/index.wxml')
  assert.match(page, /<wechat-shop-icon\b/)
  assert.doesNotMatch(page, /ic-wechat-shop\.svg/)
  assert.match(json, /wechat-shop-icon/)
  assert.match(comp, /\/subpackages\/profile-extra\/images\/ic-wechat-shop\.svg/)
  assert.ok(exists('subpackages/profile-extra/images/ic-wechat-shop.svg'))
  assert.equal(exists('images/icons/ic-wechat-shop.svg'), false)
})

test('仅被主包 require.async 的分包模块有同分包同步锚点', () => {
  const eventDetail = read('subpackages/progress-extra/event-detail.js')
  const orbital = read('subpackages/monitor-pages/utils/monitor-orbital.js')
  const splash = read('subpackages/index-extra/utils/index-splash.js')
  const placeholder = read('subpackages/shared/placeholder.js')
  const starlink = read('subpackages/monitor-pages/starlink-fullscreen.js')
  const newsDetail = read('subpackages/news-extra/detail.js')
  assert.match(eventDetail, /require\('\.\/utils\/nsf-checklist-merge\.js'\)/)
  assert.match(orbital, /require\('\.\/upcoming-orbital-events\.js'\)/)
  assert.match(splash, /require\('\.\/splash-prefetch\.js'\)/)
  assert.match(placeholder, /require\('\.\/utils\/popup-ad\.js'\)/)
  assert.match(starlink, /require\('\.\/utils\/monitor-weather\.js'\)/)
  assert.match(newsDetail, /require\('\.\/utils\/news-thumb-url\.js'\)/)
})

test('新迁出模块的 require.async 使用字面量路径', () => {
  const api = read('utils/api-app-services.js')
  const app = read('app.js')
  const news = read('pages/news/news.js')
  const monitor = read('pages/monitor/monitor.js')
  assert.match(api, /require\.async\('\.\.\/subpackages\/progress-extra\/utils\/nsf-checklist-merge\.js'\)/)
  assert.match(api, /require\.async\('\.\.\/subpackages\/monitor-pages\/utils\/upcoming-orbital-events\.js'\)/)
  assert.match(app, /require\.async\('\.\/subpackages\/index-extra\/utils\/splash-prefetch\.js'\)/)
  assert.match(news, /require\.async\('\.\.\/\.\.\/subpackages\/news-extra\/utils\/api-news\.js'\)/)
  assert.match(news, /require\.async\('\.\.\/\.\.\/subpackages\/news-extra\/utils\/news-thumb-url\.js'\)/)
  assert.match(monitor, /require\.async\('\.\.\/\.\.\/subpackages\/monitor-pages\/utils\/monitor-weather\.js'\)/)

  for (const [rel, needles] of [
    ['utils/api-app-services.js', ['nsf-checklist-merge.js', 'upcoming-orbital-events.js']],
    ['app.js', ['splash-prefetch.js']],
    ['pages/news/news.js', ['api-news.js', 'news-thumb-url.js']],
    ['pages/monitor/monitor.js', ['monitor-weather.js']]
  ]) {
    const src = read(rel)
    let m
    ASYNC_CALL.lastIndex = 0
    while ((m = ASYNC_CALL.exec(src))) {
      const arg = m[1].trim()
      if (!needles.some((n) => arg.includes(n))) continue
      assert.match(arg, /^['"`]/, `${rel} require.async(${arg}) 必须是字面量`)
    }
  }
})

test('迁出文件不得回流主包', () => {
  const leftover = [
    'utils/event-feed-intel.js',
    'utils/splash-prefetch.js',
    'utils/splash-replay.js',
    'utils/nsf-checklist-merge.js',
    'utils/nsf-checklist-i18n.js',
    'utils/upcoming-orbital-events.js',
    'utils/news-thumb-url.js',
    'utils/store-product-style.js',
    'utils/ai-chat-ad-quota.js',
    'utils/festival-hat.js',
    'components/popup-ad',
    'components/festival-hat',
    'components/china-notice-preview',
    'images/roman',
    'images/starbase-weather',
    'images/space-notices',
    'styles/fav-btn.wxss',
    'styles/mission-card.wxss',
    'styles/detail-shell.wxss'
  ]
  const stillThere = leftover.filter(exists)
  assert.deepEqual(stillThere, [])
})

test('罗曼资源只在 monitor-pages，进详情走会员门控', () => {
  assert.ok(exists('subpackages/monitor-pages/images/roman/roman-craft.png'))
  assert.ok(exists('subpackages/monitor-pages/images/roman/roman-share.jpg'))
  assert.ok(exists('subpackages/monitor-pages/images/roman/roman-card-bg.jpg'))
  const card = read('subpackages/monitor-pages/components/monitor-roman-card/index.wxml')
  const detail = read('subpackages/monitor-pages/roman-detail.wxml')
  const detailJs = read('subpackages/monitor-pages/roman-detail.js')
  const cardJs = read('subpackages/monitor-pages/components/monitor-roman-card/index.js')
  const cfg = read('utils/config.js')
  assert.match(card, /\/subpackages\/monitor-pages\/images\/roman\/roman-craft\.png/)
  assert.match(card, /roman-hero/)
  assert.match(card, /roman-hero__viz/)
  assert.match(card, /roman-viz__halo/)
  assert.match(card, /roman-viz__cruise/)
  assert.match(cardJs, /\/subpackages\/monitor-pages\/images\/roman\/roman-card-bg\.jpg/)
  assert.match(cardJs, /optimizeImageUrl/)
  assert.match(cardJs, /isCosOriginUrl/)
  assert.match(cardJs, /_fetching/)
  assert.match(cardJs, /_failCardBg/)
  assert.match(card, /binderror="onCardBgError"/)
  assert.match(card, /binderror="onCosBgError"/)
  const cardWxss = read('subpackages/monitor-pages/components/monitor-roman-card/index.wxss')
  assert.match(cardWxss, /\.roman-hero__probe[\s\S]{0,220}width:\s*8rpx/)
  assert.doesNotMatch(cardWxss, /\.roman-hero__probe[\s\S]{0,80}width:\s*0/)
  assert.match(cfg, /cardBgUrl:[\s\S]*mars-1397421562\.cos\.ap-guangzhou\.myqcloud\.com/)
  assert.match(detail, /\/subpackages\/monitor-pages\/images\/roman\/roman-craft\.png/)
  assert.match(detailJs, /\/subpackages\/monitor-pages\/images\/roman\/roman-share\.jpg/)
  assert.match(cardJs, /GATE_PRODUCT_ID = 'roman_tracker'/)
  assert.match(cardJs, /gateCheck\(GATE_PRODUCT_ID/)
  assert.doesNotMatch(cardJs, /allowAd:\s*false/)
  assert.match(detailJs, /checkShareEntryGate/)
  assert.match(detailJs, /GATE_PRODUCT_ID = 'roman_tracker'/)
  assert.match(detail, /share-gate-countdown/)
  assert.doesNotMatch(detail, /分享给好友/)
})

test('事件 intel 双副本一致，关键词走主包薄文件', () => {
  const a = read('subpackages/progress-extra/utils/event-feed-intel.js')
  const b = read('subpackages/shared/utils/event-feed-intel.js')
  assert.equal(a, b)
  assert.match(a, /require\('\.\.\/\.\.\/\.\.\/utils\/event-feed-keywords\.js'\)/)
  const profile = read('pages/profile/profile.js')
  assert.match(profile, /require\('\.\.\/\.\.\/utils\/event-feed-keywords\.js'\)/)
  assert.doesNotMatch(profile, /event-feed-intel/)
})

test('广告加次与会员额度共用同一 storage key', () => {
  const quota = read('subpackages/shared/utils/ai-chat-ad-quota.js')
  const membership = read('utils/membership.js')
  assert.match(quota, /_ai_chat_ad_bonus/)
  assert.match(membership, /_ai_chat_ad_bonus/)
})

test('简报弹窗自带账号胶囊样式（root-portal 吃不到页面 @import）', () => {
  const wxss = read('subpackages/shared/components/morning-briefing/index.wxss')
  assert.match(wxss, /@import\s+["']?\.\.\/\.\.\/\.\.\/\.\.\/styles\/tweet-stats-bar\.wxss["']?/)
})

test('监控页罗曼/航警与轨道中心同用 monitor-block 白底', () => {
  const roman = read('subpackages/monitor-pages/components/monitor-roman-card/index.wxml')
  const monitor = read('pages/monitor/monitor.wxml')
  const orbital = read('subpackages/monitor-pages/components/monitor-orbital-card/index.wxml')
  assert.match(roman, /roman-card-root monitor-block/)
  assert.match(orbital, /odc-section monitor-block/)
  assert.match(monitor, /space-notices-section monitor-block/)
})

test('航警白底卡 overflow 能压过 monitor-block，避免裁切 canvas', () => {
  const wxss = read('pages/monitor/monitor.wxss')
  assert.match(wxss, /\.space-notices-section\.monitor-block[\s\S]{0,120}overflow:\s*visible/)
})

test('核心面板不再泄漏航警预览样式（apply-shared 会打到页面）', () => {
  const wxss = read('subpackages/monitor-pages/components/monitor-core-panel/index.wxss')
  assert.doesNotMatch(wxss, /\.sn-preview-stage\b/)
  assert.doesNotMatch(wxss, /\.space-notices-section\b/)
  assert.doesNotMatch(wxss, /\.sn-china-hud\b/)
})

test('代码包图音总量不超过 200KB（质量扫描「图片和音频资源」）', () => {
  const skipDir = new Set([
    '.git', 'node_modules', 'admin-web', 'cloudfunctions', 'cloudfunctionTemplate',
    'docs', 'scripts', 'test', 'workers', 'tools', 'scf-cos-trigger', 'agent-config',
    'assets', 'cloudflare-worker'
  ])
  const media = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp3', '.m4a', '.wav', '.aac', '.ogg'])
  let total = 0
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) {
        if (!skipDir.has(name)) walk(full)
        continue
      }
      if (media.has(path.extname(name).toLowerCase())) total += st.size
    }
  }
  walk(ROOT)
  assert.ok(total < 200 * 1024, `图音合计 ${(total / 1024).toFixed(1)} KB，应 < 200 KB`)
})

test('轨道卡不用 glass-card，避免 Tab 磨砂底发灰', () => {
  const orbital = read('subpackages/monitor-pages/components/monitor-orbital-card/index.wxml')
  const appWxss = read('app.wxss')
  assert.doesNotMatch(orbital, /orbital-card glass-card/)
  assert.match(appWxss, /glass-card:not\(\.orbit-card\):not\(\.orbital-card\)/)
})

test('在轨任务列表 wx:for 与 wx:if 不写在同一节点', () => {
  const wxml = read('subpackages/monitor-pages/components/monitor-orbit-events/index.wxml')
  assert.doesNotMatch(wxml, /wx:for="\{\{upcomingOrbitalEvents\}\}"[^>]*wx:if=/)
  assert.match(wxml, /<block wx:for="\{\{upcomingOrbitalEvents\}\}"/)
})
