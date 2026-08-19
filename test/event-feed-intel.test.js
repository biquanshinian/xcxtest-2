/**
 * 事件更新活窗口匹配 — 单测（放 test/，不进小程序包）
 * node test/event-feed-intel.test.js
 */
const assert = require('assert')
const intel = require('../utils/event-feed-intel.js')

function testKeywordMatch() {
  const item = {
    title: 'Starbase static fire',
    content: '星舰完成静态点火，封路已发布',
    originalText: 'Starship static fire and road closure'
  }
  const hits = intel.matchKeywords(item, intel.DEFAULT_EVENT_ALERT_KEYWORDS)
  assert.ok(hits.indexOf('封路') >= 0, '命中封路')
  assert.ok(hits.indexOf('static fire') >= 0 || hits.indexOf('静态点火') >= 0, '命中点火')
  assert.ok(hits.length <= 3, '卡片最多展示 3 个关键词')
  assert.deepStrictEqual(intel.matchKeywords({ content: '星舰回收窗口' }, ['星舰']), ['星舰'])
  assert.deepStrictEqual(intel.matchKeywords(item, []), [])
}

function testNewCount() {
  const items = [
    { publishedAt: 200 },
    { publishedAt: 80 },
    { publishedAt: 50 }
  ]
  assert.strictEqual(intel.countNewItems(items, 100), 1)
  assert.strictEqual(intel.isItemNew(items[1], 100), false)
  assert.strictEqual(intel.countNewItems(items, 0), 0)
}

function testRelatedLaunchRequiresTextHit() {
  const launches = [
    {
      id: 's1',
      rocketName: 'Starship',
      missionName: 'Flight 10',
      launchTime: Date.now() + 36 * 3600 * 1000
    },
    {
      id: 'f9',
      rocketName: 'Falcon 9',
      missionName: 'Starlink Group 12-18',
      launchTime: Date.now() + 10 * 3600 * 1000
    }
  ]
  const starshipTweet = {
    title: 'Ship 36 吊装',
    content: '星舰 Flight 10 窗口临近',
    originalText: 'Starship Flight 10 stacking',
    source: 'NASASpaceflight'
  }
  const related = intel.matchRelatedLaunch(starshipTweet, launches)
  assert.ok(related && related.id === 's1', '星舰推文应对应 Starship 任务')
  assert.strictEqual(related.rocketName, 'Starship')
  assert.strictEqual(related.missionName, 'Flight 10')
  assert.ok(related.formattedTime, '建议卡应带发射时间')
  assert.strictEqual(related.statusBadgeText, '计划中')

  const generic = {
    title: 'Good morning',
    content: '早上好',
    originalText: 'Good morning from the cape',
    source: 'SpaceX'
  }
  assert.strictEqual(intel.matchRelatedLaunch(generic, launches), null, '无文本命中不关联')
}

function testRelatedLaunchPicksNamedFlight() {
  const launches = [
    {
      id: 's11',
      rocketName: 'Starship',
      missionName: 'Flight 11',
      _detailType: 'upcoming',
      launchTime: Date.now() + 10 * 3600 * 1000
    },
    {
      id: 's10',
      rocketName: 'Starship',
      missionName: 'Flight 10',
      _detailType: 'upcoming',
      launchTime: Date.now() + 36 * 3600 * 1000
    }
  ]
  const related = intel.matchRelatedLaunch({
    content: '星舰 Flight 10 窗口临近',
    originalText: 'Starship Flight 10 stacking'
  }, launches)
  assert.ok(related && related.id === 's10', '同火箭多任务应命中推文里的 Flight 10')
}

function testRelatedLaunchKeepsUpcomingType() {
  const related = intel.matchRelatedLaunch({
    content: 'Starship Flight 10 delayed',
    originalText: 'Starship Flight 10 delayed'
  }, [{
    id: 's10',
    rocketName: 'Starship',
    missionName: 'Flight 10',
    _detailType: 'upcoming',
    launchTime: Date.now() - 2 * 3600 * 1000
  }])
  assert.ok(related)
  assert.strictEqual(related.detailType, 'upcoming', '推迟仍在 upcoming 列表的任务不能改 completed')
}

function testRelatedLaunchHidesUnknownPad() {
  const related = intel.matchRelatedLaunch({
    content: 'Starship Flight 10',
    originalText: 'Starship Flight 10'
  }, [{
    id: 's10',
    rocketName: 'Starship',
    missionName: 'Flight 10',
    padLocation: '未知地点',
    countryDisplay: '未知',
    _langPack: {
      rocketNameZh: '星舰',
      missionNameZh: 'Flight 10',
      padLocationZh: '未知地点',
      launchSiteZh: '卡纳维拉尔角',
      countryDisplayZh: '美国'
    },
    launchTime: Date.now() + 86400000
  }])
  assert.ok(related)
  assert.strictEqual(related.padLocation, '卡纳维拉尔角')
  assert.strictEqual(related.countryDisplay, '美国')
  assert.notStrictEqual(related.padLocation, '未知地点')
  assert.ok(related.card)
  assert.strictEqual(related.card.padLocation, '卡纳维拉尔角')
  assert.strictEqual(related.card._detailType, 'upcoming')
  assert.strictEqual(related.card.countryDisplay, '美国')
}

function testRelatedLaunchHidesUnknownCountry() {
  const related = intel.matchRelatedLaunch({
    content: 'Starship Flight 10',
    originalText: 'Starship Flight 10'
  }, [{
    id: 's10',
    rocketName: 'Starship',
    missionName: 'Flight 10',
    countryDisplay: '未知',
    _langPack: { countryDisplayZh: 'Unknown', countryDisplayEn: 'unknown' },
    launchTime: Date.now() + 86400000
  }])
  assert.ok(related)
  assert.strictEqual(related.countryDisplay, '')
  assert.strictEqual(related.card.countryDisplay, '', '任务卡国家为空，模板才不会回退成「未知」')
}

function testRelatedLaunchNavIgnoresTweetId() {
  assert.strictEqual(intel.parseRelatedLaunchNavDataset({
    id: 'tweet-1',
    type: 'upcoming'
  }), null, '只有推文 data-id 时不应跳转')
  const nav = intel.parseRelatedLaunchNavDataset({
    id: 'tweet-1',
    launchId: 's10',
    launchType: 'completed',
    type: 'upcoming'
  })
  assert.ok(nav)
  assert.strictEqual(nav.id, 's10')
  assert.strictEqual(nav.type, 'completed')
  const lower = intel.parseRelatedLaunchNavDataset({ launchid: 's11', launchtype: 'upcoming' })
  assert.strictEqual(lower.id, 's11')

  const fromCard = intel.relatedLaunchNavFromEvent({
    currentTarget: { dataset: { id: 'tweet-1' } },
    detail: { id: 's10', type: 'upcoming' }
  })
  assert.ok(fromCard)
  assert.strictEqual(fromCard.id, 's10')
  assert.strictEqual(fromCard.type, 'upcoming')

  const tweetTap = intel.relatedLaunchNavFromEvent({
    currentTarget: { dataset: { id: 'tweet-1' } },
    detail: { x: 1, y: 2 }
  })
  assert.strictEqual(tweetTap, null, '推文点击坐标 detail 不得当成发射 id')

  const wrapTap = intel.relatedLaunchNavFromEvent({
    currentTarget: { dataset: { id: 'tweet-1', launchId: 's10', launchType: 'upcoming' } },
    detail: { x: 12, y: 34 }
  })
  assert.ok(wrapTap)
  assert.strictEqual(wrapTap.id, 's10')
  assert.strictEqual(wrapTap.type, 'upcoming')
}

function testDecorateNeverThrows() {
  const out = intel.decorateEventItem({ _id: 'x', content: 'hi' }, {
    launches: [null, { id: 'bad' }, { id: 'ok', rocketName: 'Starship', missionName: 'Flight 10' }]
  })
  assert.ok(out && out._id === 'x')
}

function testFavAnimateDoesNotRestoreFavorite() {
  const afterUnfav = [{
    relatedLaunchId: 's10',
    relatedLaunchFavorited: false,
    relatedLaunchFavAnimate: true
  }]
  const staleWriteBack = intel.applyRelatedLaunchFavoriteToList(afterUnfav, 's10', true, false)
  assert.strictEqual(staleWriteBack[0].relatedLaunchFavorited, true, '旧写法会把已取消的收藏写回去')
  const cleared = intel.clearRelatedLaunchFavAnimate(afterUnfav, 's10')
  assert.strictEqual(cleared[0].relatedLaunchFavorited, false, '清动画不得改收藏态')
  assert.strictEqual(cleared[0].relatedLaunchFavAnimate, false)
}

function testHighlightPrefersTodaySignal() {
  const now = Date.UTC(2026, 7, 19, 10, 0, 0) // 北京 8/19 18:00
  const dayStart = Date.UTC(2026, 7, 18, 16, 0, 0) // 北京 8/19 00:00
  const items = [
    {
      _id: 'old',
      publishedAt: dayStart - 3600 * 1000,
      content: '封路 static fire',
      mediaList: [{ type: 'video', url: 'x' }]
    },
    {
      _id: 'plain',
      publishedAt: dayStart + 1000,
      content: '例行照片',
      mediaList: []
    },
    {
      _id: 'hot',
      publishedAt: dayStart + 2000,
      content: '封路 静态点火',
      mediaList: [{ type: 'video', url: 'y' }],
      source: 'SpaceX'
    }
  ]
  const picked = intel.pickTodayHighlights(items, now, 3)
  assert.ok(picked.every((x) => x._id !== 'old'), '不收录昨日')
  assert.strictEqual(picked[0]._id, 'hot', '高信号排第一')
}

function testKeywordPrefsMigration() {
  assert.deepStrictEqual(
    intel.getEventAlertKeywords({}),
    intel.DEFAULT_EVENT_ALERT_KEYWORDS
  )
  assert.deepStrictEqual(intel.getEventAlertKeywords({ eventAlertKeywordsV1: true, eventAlertKeywords: [] }), [])
  assert.deepStrictEqual(
    intel.getEventAlertKeywords({ eventAlertKeywordsV1: true, eventAlertKeywords: ['封路', ''] }),
    ['封路']
  )
}

function testWatchSourcesNeedPaid() {
  const prefs = { eventWatchSources: ['SpaceX', 'NASA'] }
  assert.deepStrictEqual(intel.getEventWatchSources(prefs, false), [])
  assert.deepStrictEqual(intel.getEventWatchSources(prefs, true), ['SpaceX', 'NASA'])
}

function testDecorateFlattened() {
  const item = {
    _id: 'e1',
    title: 'Starship Flight 10',
    content: '星舰窗口',
    publishedAt: 500,
    mediaList: [{ type: 'image', url: 'u' }]
  }
  const decorated = intel.decorateEventItem(item, {
    lastSeenAt: 100,
    keywords: ['星舰', 'Flight'],
    launches: [{
      id: 's1',
      rocketName: 'Starship',
      missionName: 'Flight 10',
      rocketImage: 'https://cdn.example/starship.jpg',
      padLocation: 'Starbase',
      statusBadgeText: '计划中',
      statusCategory: 'pending',
      launchTime: Date.now() + 86400000
    }]
  })
  assert.strictEqual(decorated.isNew, true)
  assert.ok(decorated.keywordHitText.indexOf('星舰') >= 0)
  assert.strictEqual(decorated.relatedLaunchId, 's1')
  assert.ok(decorated.relatedLaunchLabel)
  assert.strictEqual(decorated.relatedLaunchRocketImage, 'https://cdn.example/starship.jpg')
  assert.strictEqual(decorated.relatedLaunchMission, 'Flight 10')
  assert.strictEqual(decorated.relatedLaunchRocket, 'Starship')
  assert.strictEqual(decorated.relatedLaunchPad, 'Starbase')
  assert.ok(decorated.relatedLaunchTime)
  assert.ok(decorated.relatedLaunchCard)
  assert.strictEqual(decorated.relatedLaunchCard.id, 's1')
  assert.strictEqual(decorated.relatedLaunchCard._detailType, 'upcoming')
  assert.strictEqual(decorated.relatedLaunchCard.missionName, 'Flight 10')
  assert.ok(Array.isArray(decorated.relatedLaunchCard.recoveryIcons))
  assert.strictEqual(decorated.mediaKind, 'image')
}

testKeywordMatch()
testNewCount()
testRelatedLaunchRequiresTextHit()
testRelatedLaunchPicksNamedFlight()
testRelatedLaunchKeepsUpcomingType()
testRelatedLaunchHidesUnknownPad()
testRelatedLaunchHidesUnknownCountry()
testRelatedLaunchNavIgnoresTweetId()
testDecorateNeverThrows()
testFavAnimateDoesNotRestoreFavorite()
testHighlightPrefersTodaySignal()
testKeywordPrefsMigration()
testWatchSourcesNeedPaid()
testDecorateFlattened()
console.log('event-feed-intel.test.js ok')
