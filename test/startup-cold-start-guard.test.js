/**
 * node --test test/startup-cold-start-guard.test.js
 * 冷启动守门：onLaunch 不抢首屏下载分包；Tab 预下载仅 WiFi。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const TAB_PAGES = [
  'pages/index/index',
  'pages/monitor/monitor',
  'pages/progress/progress',
  'pages/news/news',
  'pages/profile/profile'
]

test('onLaunch 不预下载 index-extra / 不开屏分包预拉', () => {
  const app = read('app.js')
  const launchStart = app.indexOf('onLaunch(options)')
  const methodStart = app.indexOf('preloadHomeSubpackages() {')
  assert.ok(launchStart >= 0)
  assert.ok(methodStart > launchStart)
  const launch = app.slice(launchStart, methodStart)
  assert.doesNotMatch(launch, /wx\.preloadSubpackage/)
  assert.doesNotMatch(launch, /preloadSubpackages\(/)
  assert.doesNotMatch(launch, /startSplashPrefetch/)
  assert.doesNotMatch(launch, /splash-prefetch\.js/)
  assert.match(launch, /hydrateCountdownBootToApp/)
})

test('首屏 onReady 后才预拉首页分包与开屏', () => {
  const app = read('app.js')
  assert.match(app, /preloadHomeSubpackages\(\) \{/)
  assert.match(app, /preload-subpackages\.js/)
  assert.match(
    app,
    /preloadSubpackages\(\['index-extra', 'shared'\]\)/
  )
  assert.match(app, /require\.async\('\.\/subpackages\/index-extra\/utils\/splash-prefetch\.js'\)/)
  const index = read('pages/index/index.js')
  assert.match(index, /_runIndexFirstPaintFollowup\(\) \{[\s\S]*?preloadHomeSubpackages/)
})

test('首页分包组件首帧不挂树，等 homeSubpkgUiReady', () => {
  const wxml = read('pages/index/index.wxml')
  const js = read('pages/index/index.js')
  assert.match(js, /homeSubpkgUiReady:\s*false/)
  assert.match(js, /setData\(\{ homeSubpkgUiReady: true \}/)
  ;[
    'official-account-bar',
    'index-announcement',
    'index-vote-box',
    'index-carousel',
    'index-road-closure',
    'morning-briefing',
    'renewal-reminder',
    'net-change-modal',
    'index-splash',
    'index-share-sheet',
    'nasa-float',
    'demo-overlay',
    'share-guide'
  ].forEach((name) => {
    assert.match(
      wxml,
      new RegExp(`<${name}[\\s\\S]{0,160}?wx:if="\\{\\{homeSubpkgUiReady`),
      `${name} should wait for first paint`
    )
  })
  assert.match(wxml, /index-carousel-boot-skel/)
})

test('Tab 页 preloadRule 仅 WiFi，避免蜂窝冷启动抢资源加载', () => {
  const app = JSON.parse(read('app.json'))
  assert.ok(app.preloadRule)
  TAB_PAGES.forEach((page) => {
    const rule = app.preloadRule[page]
    assert.ok(rule, `missing preloadRule for ${page}`)
    assert.equal(rule.network, 'wifi', `${page} should preload on wifi only`)
    assert.ok(rule.packages.includes('shared'))
  })
  assert.equal(app.preloadRule['pages/nasa-data/nasa-data'].network, 'wifi')
})

test('首页 onShow 延后任务等 followup 结束，不会被首帧 gate 丢掉', () => {
  const index = read('pages/index/index.js')
  assert.match(index, /_scheduleIndexShowDeferred\(\)/)
  assert.match(index, /_indexShowDeferredReady = true/)
  assert.match(index, /_indexShowDeferredPending/)
  assert.doesNotMatch(index, /if \(!this\._indexFirstPaintFollowup\) return/)
  assert.match(index, /onShow\(\) \{[\s\S]*?_scheduleIndexShowDeferred/)
  const follow = index.slice(
    index.indexOf('_runIndexFirstPaintFollowup() {'),
    index.indexOf('_scheduleIndexShowDeferred() {')
  )
  assert.match(follow, /_indexShowDeferredReady = true/)
  assert.match(follow, /_runIndexShowDeferred\(\)/)
})

test('其他 Tab 浮层首帧不挂树，弹窗广告等 overlay ready', () => {
  const tabs = [
    {
      id: 'pages/monitor/monitor',
      tags: ['nasa-float', 'popup-ad', 'demo-overlay', 'share-guide']
    },
    {
      id: 'pages/progress/progress',
      tags: ['nasa-float', 'popup-ad', 'demo-overlay', 'share-guide']
    },
    {
      id: 'pages/news/news',
      tags: ['nasa-float', 'popup-ad', 'demo-overlay', 'share-guide']
    },
    {
      id: 'pages/profile/profile',
      tags: ['nasa-float', 'popup-ad', 'milestone-egg', 'demo-overlay']
    }
  ]
  tabs.forEach((tab) => {
    const js = read(`${tab.id}.js`)
    const wxml = read(`${tab.id}.wxml`)
    assert.match(js, /tabSubpkgUiReady:\s*false/)
    assert.match(js, /markTabOverlayReady\(this\)/)
    assert.match(js, /scheduleAfterTabOverlayReady/)
    tab.tags.forEach((name) => {
      assert.match(
        wxml,
        new RegExp(`<${name}[\\s\\S]{0,160}?wx:if="\\{\\{tabSubpkgUiReady`),
        `${tab.id} ${name} should wait for first paint`
      )
    })
  })
  assert.match(
    read('pages/monitor/monitor.wxml'),
    /tabSubpkgUiReady && enableLiveWatch/
  )
  assert.match(
    read('pages/index/index.wxml'),
    /homeSubpkgUiReady && missionType === 'calendar'/
  )
  const newsOnLoad = read('pages/news/news.js').slice(
    read('pages/news/news.js').indexOf('onLoad('),
    read('pages/news/news.js').indexOf('onReady()')
  )
  assert.doesNotMatch(newsOnLoad, /loadNewsThumb\(/)
})

test('tab overlay ready 队列在 mark 后刷新，避免 onShow 抢 shared', async () => {
  const {
    markTabOverlayReady,
    scheduleAfterTabOverlayReady
  } = require('../utils/tab-overlay-ready.js')
  const page = {
    data: { tabSubpkgUiReady: false },
    setData(patch, cb) {
      this.data = Object.assign({}, this.data, patch)
      if (typeof cb === 'function') cb.call(this)
    }
  }
  let ran = 0
  scheduleAfterTabOverlayReady(page, () => { ran += 1 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(ran, 0)
  assert.equal(page._tabOverlayReadyPending.length, 1)
  markTabOverlayReady(page)
  assert.equal(page.data.tabSubpkgUiReady, true)
  assert.equal(ran, 1)
  scheduleAfterTabOverlayReady(page, () => { ran += 1 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(ran, 2)
})
