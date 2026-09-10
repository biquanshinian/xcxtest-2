/**
 * node --test test/index-memory-park.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const {
  parkIndexHeavyData,
  unparkIndexHeavyData,
  installIndexSetDataGuard,
  readParkedOrData
} = require('../pages/index/utils/index-memory-park.js')

function makePage(data) {
  const page = {
    data: Object.assign({}, data),
    setData(patch, cb) {
      this.data = Object.assign({}, this.data, patch)
      if (typeof cb === 'function') cb.call(this)
    }
  }
  return page
}

test('切走首页时卸下日历和轮播，回来原样灌回', () => {
  const calendar = [{ id: 'a' }, { id: 'b' }]
  const items = [{ id: 1, isVideo: true, src: 'https://x/a.mp4' }]
  const page = makePage({
    calendarAllMissions: calendar,
    calendarDays: [{ key: '2026-09-01' }],
    carouselItems: items,
    carouselImages: ['https://x/a.jpg'],
    splashVisible: false,
    splashFading: false,
    splashConfig: { mediaUrl: 'https://x/s.mp4' },
    upcomingMissions: [{ id: 'keep' }]
  })
  assert.equal(parkIndexHeavyData(page), true)
  assert.equal(page.data.calendarAllMissions.length, 0)
  assert.equal(page.data.carouselItems.length, 0)
  assert.equal(page.data.splashConfig, null)
  assert.equal(page.data.upcomingMissions[0].id, 'keep')
  assert.equal(readParkedOrData(page, 'calendarAllMissions').length, 2)
  assert.equal(unparkIndexHeavyData(page), true)
  assert.equal(page.data.calendarAllMissions.length, 2)
  assert.equal(page.data.carouselItems[0].src, 'https://x/a.mp4')
  assert.equal(page.data.splashConfig.mediaUrl, 'https://x/s.mp4')
  assert.equal(page._indexParked, null)
})

test('停泊期间 setData 重列表只改副本，不灌回渲染树', () => {
  const page = makePage({
    calendarAllMissions: [{ id: 'old' }],
    carouselItems: [],
    splashVisible: false,
    splashFading: false
  })
  installIndexSetDataGuard(page)
  parkIndexHeavyData(page)
  page.setData({ calendarAllMissions: [{ id: 'new' }, { id: 'x' }], navTitle: 'x' })
  assert.equal(page.data.calendarAllMissions.length, 0)
  assert.equal(page.data.navTitle, 'x')
  assert.equal(readParkedOrData(page, 'calendarAllMissions').length, 2)
  unparkIndexHeavyData(page)
  assert.equal(page.data.calendarAllMissions[0].id, 'new')
})

test('首页首帧不再预拉日历全量，未开日历 Tab 不委托加载日历包', () => {
  const index = fs.readFileSync(path.join(ROOT, 'pages/index/index.js'), 'utf8')
  const follow = index.slice(
    index.indexOf('_runIndexFirstPaintFollowup() {'),
    index.indexOf('_buildContentLangUiPatch() {')
  )
  assert.doesNotMatch(follow, /loadCalendarData\(true\)/)
  assert.match(follow, /calendar_missions_cache/)
  const delegate = index.slice(index.indexOf('const calendarDelegates'), index.indexOf('const SAVE_IMAGE_METHODS'))
  assert.match(delegate, /syncCalendarFromMissionListsIfNeeded/)
  assert.match(delegate, /missionType !== 'calendar'/)
  assert.match(delegate, /_indexParked/)
  assert.match(index, /installIndexSetDataGuard\(this\)/)
  assert.match(index, /parkIndexHeavyData\(this\)/)
  assert.match(index, /unparkIndexHeavyData\(this\)/)
})

test('开屏关闭后丢掉 splashConfig，避免视频地址常驻', () => {
  const splash = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
  const close = splash.slice(splash.indexOf('closeSplash() {'), splash.indexOf('module.exports'))
  assert.match(close, /splashConfig:\s*null/)
})

test('空列表也占停泊坑，首载竞态只写副本', () => {
  const page = makePage({
    calendarAllMissions: [],
    calendarDays: [],
    calendarMapEntryList: [],
    expandedDateMissions: [],
    carouselItems: [],
    carouselImages: [],
    splashVisible: false,
    splashFading: false
  })
  installIndexSetDataGuard(page)
  assert.equal(parkIndexHeavyData(page), true)
  assert.ok(page._indexParked)
  assert.ok(Object.prototype.hasOwnProperty.call(page._indexParked, 'carouselItems'))
  page.setData({
    carouselItems: [{ id: 1, src: 'https://x/a.mp4', type: 'video' }],
    carouselImages: ['https://x/a.mp4'],
    carouselPending: false
  })
  assert.equal(page.data.carouselItems.length, 0)
  assert.equal(page.data.carouselPending, false)
  assert.equal(readParkedOrData(page, 'carouselItems').length, 1)
  unparkIndexHeavyData(page)
  assert.equal(page.data.carouselItems[0].src, 'https://x/a.mp4')
})

test('停泊期间路径写法 carouselItems[i].x 不灌回渲染树', () => {
  const page = makePage({
    carouselItems: [{ id: 1, src: 'https://x/a.jpg', caption: '' }],
    splashVisible: false,
    splashFading: false
  })
  installIndexSetDataGuard(page)
  parkIndexHeavyData(page)
  page.setData({
    'carouselItems[0].caption': '发射窗口',
    'carouselItems[0].eventId': 'e1'
  })
  assert.equal(page.data.carouselItems.length, 0)
  const parked = readParkedOrData(page, 'carouselItems')
  assert.equal(parked[0].caption, '发射窗口')
  assert.equal(parked[0].eventId, 'e1')
  unparkIndexHeavyData(page)
  assert.equal(page.data.carouselItems[0].caption, '发射窗口')
})

test('配图刷新与事件 intel 读停泊日历，隐藏时不重建日历派生态', () => {
  const live = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-live-settle.js'), 'utf8')
  const interaction = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-interaction.js'), 'utf8')
  const intelShared = fs.readFileSync(path.join(ROOT, 'subpackages/shared/utils/event-feed-intel.js'), 'utf8')
  const intelProgress = fs.readFileSync(
    path.join(ROOT, 'subpackages/progress-extra/utils/event-feed-intel.js'),
    'utf8'
  )
  assert.match(live, /this\._indexParked/)
  assert.match(live, /!this\._indexParked && this\.data\.missionType === 'calendar'/)
  assert.match(interaction, /this\._indexParked/)
  assert.match(intelShared, /p\._indexParked && p\._indexParked\.calendarAllMissions/)
  assert.equal(intelShared, intelProgress)
})

test('停泊时不按空 data 回填日历，追加分页读停泊副本', () => {
  const cal = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-calendar-page.js'), 'utf8')
  assert.match(cal, /function pageCalendarMissions/)
  const sync = cal.slice(
    cal.indexOf('syncCalendarFromMissionListsIfNeeded() {'),
    cal.indexOf('needCalendarBackfill')
  )
  assert.match(sync, /_indexParked \|\| this\._countdownPageHidden/)
  const load = cal.slice(cal.indexOf('async loadCalendarData(useCache)'), cal.indexOf('if (useCache && this._calendarDataLoaded)'))
  assert.match(load, /_indexParked \|\| this\._countdownPageHidden/)
  assert.match(cal, /currentMissions: appendMode \? pageCalendarMissions\(this\) : undefined/)
  const more = cal.slice(cal.indexOf('async _loadMoreCalendarData()'), cal.indexOf('_isMonthCovered'))
  assert.match(more, /_indexParked \|\| this\._countdownPageHidden/)
  const cont = cal.slice(
    cal.indexOf('_continueLoadCalendarDataAfterCacheMiss()'),
    cal.indexOf('async _loadMoreCalendarData()')
  )
  assert.match(cont, /_indexParked \|\| this\._countdownPageHidden/)
})
