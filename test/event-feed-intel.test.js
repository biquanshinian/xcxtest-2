/**
 * 事件更新活窗口匹配 — 单测（放 test/，不进小程序包）
 * node test/event-feed-intel.test.js
 */
const assert = require('assert')
const intel = require('../subpackages/progress-extra/utils/event-feed-intel.js')

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

function testRelatedLaunchRejectsWeakScore() {
  const launches = [
    {
      id: 's11',
      rocketName: 'Starship',
      missionName: 'Flight 11',
      launchTime: Date.now() + 10 * 3600 * 1000
    },
    {
      id: 'f9a',
      rocketName: 'Falcon 9',
      missionName: 'Starlink Group 12-18',
      launchTime: Date.now() + 8 * 3600 * 1000
    },
    {
      id: 'f9b',
      rocketName: 'Falcon 9',
      missionName: 'Starlink Group 10-30',
      launchTime: Date.now() + 20 * 3600 * 1000
    }
  ]
  assert.strictEqual(intel.matchRelatedLaunch({
    title: 'Starship looking good',
    content: '星舰外观检查',
    originalText: 'Starship looking good this morning'
  }, launches), null, '只提火箭族名不合格')

  assert.strictEqual(intel.matchRelatedLaunch({
    title: 'Falcon 9 static fire',
    content: '猎鹰9号静态点火',
    originalText: 'Falcon 9 static fire complete'
  }, launches), null, '只提 Falcon 9 不合格')

  assert.strictEqual(intel.matchRelatedLaunch({
    title: 'Starlink deployment',
    content: '星链部署顺利',
    originalText: 'Successful Starlink deployment',
    source: 'Starlink',
    author: 'Starlink自动追踪'
  }, launches), null, '账号名或星座名不能当任务标识')

  const groupHit = intel.matchRelatedLaunch({
    content: 'Starlink Group 12-18 stacking',
    originalText: 'Starlink Group 12-18 stacking at the cape'
  }, launches)
  assert.ok(groupHit && groupHit.id === 'f9a', '带 Group 编号才挂对应星链任务')
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

function testRelatedLaunchChineseFlightNo() {
  const launches = [
    {
      id: 's11',
      rocketName: 'Starship',
      rocketNameZh: '星舰',
      missionName: 'Flight 11',
      launchTime: Date.now() + 10 * 3600 * 1000
    },
    {
      id: 's10',
      rocketName: 'Starship',
      rocketNameZh: '星舰',
      missionName: 'Flight 10',
      launchTime: Date.now() + 36 * 3600 * 1000
    }
  ]
  const related = intel.matchRelatedLaunch({
    content: '星舰第十次飞行窗口临近，静态点火完成',
    originalText: ''
  }, launches)
  assert.ok(related && related.id === 's10', '中文「第十次」应对应 Flight 10')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: '星舰静态点火画面',
    originalText: ''
  }, launches), null, '只有星舰二字不合格')
}

function testRelatedLaunchRejectsAmbiguousPair() {
  const launches = [
    {
      id: 'k5',
      rocketName: 'Falcon 9',
      missionName: 'Kuiper 5',
      launchTime: Date.now() + 12 * 3600 * 1000
    },
    {
      id: 'k6',
      rocketName: 'Falcon 9',
      missionName: 'Kuiper 6',
      launchTime: Date.now() + 40 * 3600 * 1000
    }
  ]
  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Falcon 9 Kuiper stacking',
    originalText: 'Falcon 9 Kuiper stacking today'
  }, launches), null, '两场 Kuiper 都沾边则不匹配')

  const hit = intel.matchRelatedLaunch({
    content: 'Kuiper 5 is GO for launch',
    originalText: 'Kuiper 5 is GO for launch'
  }, launches)
  assert.ok(hit && hit.id === 'k5', '写明 Kuiper 5 才挂卡')
}

function testRelatedLaunchDigitBoundary() {
  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Starship Flight 10 stacking',
    originalText: 'Starship Flight 10 stacking'
  }, [{
    id: 's1',
    rocketName: 'Starship',
    missionName: 'Flight 1',
    launchTime: Date.now() + 86400000
  }]), null, 'Flight 1 不能当前缀命中 Flight 10')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Transporter-15 is vertical',
    originalText: 'Transporter-15 is vertical'
  }, [{
    id: 't1',
    rocketName: 'Falcon 9',
    missionName: 'Transporter-1',
    launchTime: Date.now() + 86400000
  }]), null, 'Transporter-1 不能当前缀命中 Transporter-15')

  const t15 = intel.matchRelatedLaunch({
    content: 'Transporter-15 is vertical',
    originalText: 'Transporter-15 is vertical'
  }, [
    {
      id: 't1',
      rocketName: 'Falcon 9',
      missionName: 'Transporter-1',
      launchTime: Date.now() + 86400000
    },
    {
      id: 't15',
      rocketName: 'Falcon 9',
      missionName: 'Transporter-15',
      launchTime: Date.now() + 2 * 86400000
    }
  ])
  assert.ok(t15 && t15.id === 't15', '完整 Transporter-15 应命中')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Starlink Group 10-30 stacking',
    originalText: 'Starlink Group 10-30 stacking'
  }, [{
    id: 'g3',
    rocketName: 'Falcon 9',
    missionName: 'Starlink Group 10-3',
    launchTime: Date.now() + 86400000
  }]), null, 'Group 10-3 不能当前缀命中 10-30')
}

function testRelatedLaunchDateIsNotGroupId() {
  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Falcon 9 static fire 12-18 at the cape',
    originalText: 'Falcon 9 static fire 12-18 at the cape'
  }, [{
    id: 'sl',
    rocketName: 'Falcon 9',
    missionName: 'Starlink Group 12-18',
    launchTime: Date.now() + 86400000
  }]), null, '日期 12-18 加 Falcon 9 不能当星链组号')

  const zhGroup = intel.matchRelatedLaunch({
    content: '星链组 12-18 正在叠箭',
    originalText: ''
  }, [{
    id: 'sl',
    rocketName: 'Falcon 9',
    missionName: 'Starlink Group 12-18',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(zhGroup && zhGroup.id === 'sl', '中文星链组号应命中')
}

function testRelatedLaunchFlightNoNotLoosePhrase() {
  const flight2 = [{
    id: 's2',
    rocketName: 'Starship',
    missionName: 'Flight 2',
    launchTime: Date.now() + 86400000
  }]
  assert.strictEqual(intel.matchRelatedLaunch({
    content: '星舰第二次静态点火完成',
    originalText: ''
  }, flight2), null, '「第二次静态点火」不是 Flight 2')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Starship in flight 2 hours from landing',
    originalText: 'Starship in flight 2 hours from landing'
  }, flight2), null, 'flight 2 hours 不是 Flight 2')
}

function testRelatedLaunchUniquePayload() {
  const hit = intel.matchRelatedLaunch({
    content: 'CRS-33 is GO for tonight',
    originalText: 'CRS-33 is GO for tonight'
  }, [{
    id: 'crs',
    rocketName: 'Falcon 9',
    missionName: 'CRS-33',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(hit && hit.id === 'crs', '唯一载荷代号应合格挂卡')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Amazon and Falcon 9 photos',
    originalText: 'Amazon and Falcon 9 photos'
  }, [{
    id: 'k5',
    rocketName: 'Falcon 9',
    missionName: 'Kuiper 5',
    launchTime: Date.now() + 86400000
  }]), null, 'Amazon+Falcon 不能当 Kuiper 5')
}

function testRelatedLaunchIftAndChineseSerial() {
  const ift = intel.matchRelatedLaunch({
    content: 'IFT-10 static fire complete',
    originalText: 'IFT-10 static fire complete'
  }, [{
    id: 's10',
    rocketName: 'Starship',
    missionName: 'Flight 10',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(ift && ift.id === 's10', 'IFT-10 应对应 Flight 10')

  assert.strictEqual(intel.matchRelatedLaunch({
    content: 'Flight 10 scrubbed, Flight 11 stacking',
    originalText: 'Flight 10 scrubbed, Flight 11 stacking'
  }, [
    { id: 's10', rocketName: 'Starship', missionName: 'Flight 10', launchTime: Date.now() + 86400000 },
    { id: 's11', rocketName: 'Starship', missionName: 'Flight 11', launchTime: Date.now() + 2 * 86400000 }
  ]), null, '一文写两场则不分胜负、不挂卡')

  const y1 = intel.matchRelatedLaunch({
    content: 'Zhuque-3 Y1 launch window confirmed',
    originalText: 'Zhuque-3 Y1 launch window confirmed'
  }, [{
    id: 'z',
    rocketName: 'Zhuque-3',
    missionName: 'Y1',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(y1 && y1.id === 'z', 'Y1 这类短编号应能挂卡')

  const yao = intel.matchRelatedLaunch({
    content: '长征八号甲遥二发射窗口确认',
    originalText: ''
  }, [{
    id: 'cz',
    rocketName: 'Long March 8A',
    rocketNameZh: '长征八号甲',
    missionName: '遥二',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(yao && yao.id === 'cz', '中文遥二应能挂卡')
}

testKeywordMatch()
testNewCount()
testRelatedLaunchRejectsWeakScore()
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
testRelatedLaunchChineseFlightNo()
testRelatedLaunchRejectsAmbiguousPair()
testRelatedLaunchDigitBoundary()
testRelatedLaunchDateIsNotGroupId()
testRelatedLaunchFlightNoNotLoosePhrase()
testRelatedLaunchUniquePayload()
testRelatedLaunchIftAndChineseSerial()
testDecorateFlattened()
{
  const fs = require('fs')
  const path = require('path')
  const a = fs.readFileSync(path.join(__dirname, '../subpackages/progress-extra/utils/event-feed-intel.js'), 'utf8')
  const b = fs.readFileSync(path.join(__dirname, '../subpackages/shared/utils/event-feed-intel.js'), 'utf8')
  assert.equal(a, b, 'progress-extra 与 shared 的 event-feed-intel 副本必须同步')
}
console.log('event-feed-intel.test.js ok')
