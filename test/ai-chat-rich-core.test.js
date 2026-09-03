/**
 * 星问富消息纯逻辑单测（放 test/，已在 packOptions.ignore，不进小程序包）
 * node test/ai-chat-rich-core.test.js
 */
const assert = require('assert')
const {
  matchStarshipNextFlightIntent,
  matchStarshipStatusIntent,
  matchLaunchStatsIntent,
  matchLaunchListIntent,
  matchHistoryListIntent,
  matchFlightDemoIntent,
  matchMissionSimIntent,
  matchVehicleTrackerIntent,
  matchRoadClosureIntent,
  matchStationIntent,
  matchAgencyIntent,
  matchMissionLookupIntent,
  matchMissionReplayIntent,
  resolveAiChatRichIntent,
  stripReplayAskNoise,
  parseLaunchStatsFocus,
  getBeijingPeriodBounds,
  countLaunchesInBounds,
  isUsableMissionForCard,
  isUsableLaunchForCard,
  pickStarshipMission,
  pickLaunchList,
  pickStation,
  pickBestMissionMatch,
  pickBestAgencyMatch,
  missionLookupTimePreference,
  hasHistorySense,
  hasSingularRecentLaunchAsk,
  hasAgencyOwnershipAsk,
  hasSetReminderAsk,
  resolveAgencyFromRocketConfig,
  matchSetReminderIntent,
  buildHistoryCloudSearchKeys,
  parseHistoryListFilter,
  resolveMissionDetailType,
  normalizeMatchText,
  extractBoosterSerial,
  extractRocketModelKey,
  extractStarshipHardwareRef,
  pickStarshipHardware,
  parseHardwareVehicleRef,
  pickRocketConfig,
  pickLaunchSite,
  pickSpacecraftConfig,
  enrichLaunchContextWithSpec,
  enrichLaunchContextNoSpec,
  enrichLaunchContextWithMyLaunches,
  enrichLaunchContextNoMyLaunches,
  enrichLaunchContextWithSimpleEntry,
  parseLaunchListFilter,
  parseLaunchListSiteFilter,
  parseLaunchListCountryFilter,
  missionMatchesLaunchListFilter,
  missionWithinUpcomingDays,
  LAUNCH_LIST_WITHIN_DAYS,
  resolveAgencyCanonicalSearchKey,
  detectKnownAgencyCanonical,
  agencyMatchesCanonical,
  extractMissionSearchKey,
  extractAgencySearchKey,
  buildLaunchSearchQueries,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule,
  enrichLaunchContextWithLaunchList,
  enrichLaunchContextWithStarshipStatus,
  enrichLaunchContextWithFlightDemo,
  enrichLaunchContextWithVehicleTracker,
  enrichLaunchContextWithMissionSim,
  enrichLaunchContextWithRoadClosure,
  enrichLaunchContextWithStation,
  enrichLaunchContextWithLaunchStats,
  enrichLaunchContextWithAgency,
  enrichLaunchContextWithMissionReplay,
  enrichLaunchContextWithWatchParty,
  enrichLaunchContextWatchPartyClosed,
  matchMerchantJoinIntent,
  enrichLaunchContextWithMerchantJoin,
  enrichLaunchContextMerchantJoinFeatureOff
} = require('../subpackages/shared/utils/ai-chat-rich-core.js')

function testIntentNext() {
  ;[
    '星舰下一次试飞是什么时候？',
    '星舰什么时候发射',
    '星舰啥时候飞',
    'starship next flight'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'starship_next', q)
  })
}

function testIntentStatus() {
  ;[
    '星舰最新进展如何？',
    '最新进展如何？',
    '进展',
    '进度怎么样',
    '造到哪了',
    '星舰组合体进度',
    '星舰造到哪了',
    '星舰 B15 状态怎么样'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'starship_status', q)
    assert.strictEqual(matchStarshipStatusIntent(q), true, q)
  })
}

function testIntentLaunchList() {
  ;[
    '接下来有哪些发射？',
    '本周发射计划',
    '即将发射的任务',
    'SpaceX接下来发什么',
    '海南文昌发射场最近有什么发射任务？',
    '文昌接下来有哪些发射',
    '中国接下来有哪些发射',
    '国内近期有什么发射任务'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'launch_list', q)
    assert.strictEqual(matchLaunchListIntent(q), true, q)
  })

  const site = parseLaunchListSiteFilter('海南文昌发射场最近有什么发射任务？')
  assert.ok(site && site.key === 'wenchang', '文昌场站解析')
  const agencyFilter = parseLaunchListFilter('SpaceX接下来发什么')
  assert.ok(agencyFilter && agencyFilter.agencyKey === 'spacex', 'SpaceX 列表筛选')
  assert.ok(agencyFilter.withinDays === LAUNCH_LIST_WITHIN_DAYS, '发射商筛带 60 天窗')
  assert.strictEqual(parseLaunchListFilter('接下来有哪些发射？'), null, '全局列表无筛选')
  const cn = parseLaunchListFilter('中国接下来有哪些发射')
  assert.ok(cn && cn.country === '中国', '中国国家筛选')
  assert.strictEqual(cn.withinDays, LAUNCH_LIST_WITHIN_DAYS)
  assert.strictEqual(parseLaunchListCountryFilter('美国接下来有哪些发射'), '美国')
  // 数量统计不被国家列表抢走
  assert.strictEqual(resolveAiChatRichIntent('今天中国发射了多少次火箭'), 'launch_stats')
}

function testIntentLaunchStats() {
  ;[
    '今天中国发射了多少次火箭',
    '今天中国发射了多少次？',
    '今年全球发射了多少次',
    '美国今年发射几次',
    '全球发射统计',
    '2025年中国发射统计'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'launch_stats', q)
    assert.strictEqual(matchLaunchStatsIntent(q), true, q)
  })
  // 日程问法不被统计抢走
  assert.strictEqual(resolveAiChatRichIntent('本周发射计划'), 'launch_list')
  // 具体火箭次数问法仍走任务检索
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号发射了多少次'), 'mission_lookup')

  const focus = parseLaunchStatsFocus('今天中国发射了多少次火箭')
  assert.strictEqual(focus.scope, 'today')
  assert.strictEqual(focus.country, '中国')

  const bounds = getBeijingPeriodBounds('today', Date.parse('2026-07-24T10:00:00+08:00'))
  const counted = countLaunchesInBounds([
    { launchTime: '2026-07-24T02:00:00Z', countryDisplay: '中国', success: true },
    { launchTime: '2026-07-24T08:00:00Z', countryDisplay: '美国', success: true },
    { launchTime: '2026-07-23T02:00:00Z', countryDisplay: '中国', success: true }
  ], bounds, '中国')
  assert.strictEqual(counted.total, 1)
  assert.strictEqual(counted.success, 1)
}

function testIntentFlightDemo() {
  ;[
    '看看飞行剖面演示',
    '飞行演示怎么看',
    '这次任务怎么飞的'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'flight_demo', q)
    assert.strictEqual(matchFlightDemoIntent(q), true, q)
  })
}

function testIntentVehicleTracker() {
  ;[
    '打开在轨飞行器追踪',
    '追踪龙飞船',
    '在轨飞行器实时定位',
    '星舰在轨追踪'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'vehicle_tracker', q)
    assert.strictEqual(matchVehicleTrackerIntent(q), true, q)
  })
}

function testIntentMissionSim() {
  ;[
    '打开星舰任务指挥室',
    'GO/NO-GO 模拟',
    '发射决策模拟'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'mission_sim', q)
    assert.strictEqual(matchMissionSimIntent(q), true, q)
  })
  assert.strictEqual(resolveAiChatRichIntent('星舰任务指挥室'), 'mission_sim')
}

function testIntentRoadClosure() {
  ;[
    '星舰封路了吗',
    '星舰基地封路了吗',
    '道路封闭通知',
    'road closure starbase'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'road_closure', q)
    assert.strictEqual(matchRoadClosureIntent(q), true, q)
  })
}

function testIntentStation() {
  ;[
    '看看空间站实时状态',
    '国际空间站怎么样',
    '天宫现在有哪些乘组',
    'ISS 轨道'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'station', q)
    assert.strictEqual(matchStationIntent(q), true, q)
  })
}

function testIntentAgency() {
  ;[
    'SpaceX',
    'SpaceX是什么公司？',
    '介绍一下蓝箭航天',
    'NASA发射商',
    '火箭实验室',
    '中国航天科技集团',
    'CASC'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'agency', q)
    assert.strictEqual(matchAgencyIntent(q), true, q)
  })
  // 型号+归属 → 机构卡（不得误进 mission_lookup）
  assert.ok(hasAgencyOwnershipAsk('长征七号甲属于哪家发射商？'))
  assert.strictEqual(resolveAiChatRichIntent('长征七号甲属于哪家发射商？'), 'agency')
  assert.strictEqual(resolveAiChatRichIntent('猎鹰9是哪家公司的'), 'agency')
  // 日程问法仍走列表 / 任务，不抢发射商
  assert.strictEqual(resolveAiChatRichIntent('SpaceX接下来发什么'), 'launch_list')
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号什么时候发射？'), 'mission_lookup')

  const distractor = { id: 9, name: 'Aérospatiale', abbrev: 'AS' }
  const agencies = [
    { id: 121, name: 'SpaceX', abbrev: 'SpX', total_launch_count: 300 },
    { id: 259, name: 'LandSpace', abbrev: 'LandSpace', total_launch_count: 10 },
    { id: 88, name: 'China Aerospace Science and Technology Corporation', abbrev: 'CASC' },
    { id: 44, name: 'National Aeronautics and Space Administration', abbrev: 'NASA' },
    distractor
  ]
  const hit = pickBestAgencyMatch(agencies, 'SpaceX是什么公司？')
  assert.ok(hit && hit.agency && String(hit.agency.id) === '121', '命中 SpaceX')
  const land = pickBestAgencyMatch(agencies, '蓝箭航天')
  assert.ok(land && land.agency && String(land.agency.id) === '259', '命中蓝箭')
  assert.ok(extractAgencySearchKey('SpaceX是什么公司？').toLowerCase().includes('spacex'))

  // 回归：中国航天科技集团 不得误配法国 Aérospatiale（旧逻辑 casc⊃as）
  const cascHit = pickBestAgencyMatch(agencies, '中国航天科技集团')
  assert.ok(cascHit && cascHit.agency && String(cascHit.agency.id) === '88', '命中 CASC')
  const noCasc = pickBestAgencyMatch(
    agencies.filter((a) => String(a.id) !== '88'),
    '中国航天科技集团'
  )
  assert.ok(!noCasc, '无 CASC 时不得回落 Aérospatiale')
  assert.strictEqual(resolveAgencyCanonicalSearchKey('中国航天科技集团'), 'casc')
  assert.strictEqual(detectKnownAgencyCanonical('中国航天科技集团'), 'casc')

  // 型号归属反查：构型 manufacturerAbbrev → CASC
  const configs = {
    cz7a: {
      id: 'cz7a',
      name: 'Long March 7A',
      full_name: 'Long March 7A',
      alias: '长征七号甲',
      manufacturerName: 'China Aerospace Science and Technology Corporation',
      manufacturerAbbrev: 'CASC',
      total_launch_count: 20
    }
  }
  const fromMfr = resolveAgencyFromRocketConfig(configs, agencies, '长征七号甲属于哪家发射商？')
  assert.ok(fromMfr && String(fromMfr.agency.id) === '88', 'manufacturer 反查 CASC')
  assert.strictEqual(fromMfr.via, 'manufacturer')
  // 无 manufacturer 时长征系回落 CASC
  const bareConfigs = {
    cz7a: { id: 'cz7a', name: 'Long March 7A', alias: '长征七号甲', total_launch_count: 20 }
  }
  const fallback = resolveAgencyFromRocketConfig(bareConfigs, agencies, '长征七号甲属于哪家发射商？')
  assert.ok(fallback && String(fallback.agency.id) === '88', '长征系无 manufacturer 仍回落 CASC')
  assert.strictEqual(fallback.via, 'long_march_fallback')

  // 知名发射商：有干扰项时仍锁本尊；硬 ID 优先
  ;[
    ['SpaceX', '121', 'spacex'],
    ['马斯克那家公司', '121', 'spacex'],
    ['CASC', '88', 'casc'],
    ['中国航天科技集团', '88', 'casc'],
    ['中国航天', '88', 'casc'],
    ['NASA', '44', 'nasa'],
    ['美国宇航局', '44', 'nasa'],
    ['蓝箭', '259', 'landspace']
  ].forEach(([q, id, canon]) => {
    assert.strictEqual(detectKnownAgencyCanonical(q), canon, 'canonical「' + q + '」')
    const r = pickBestAgencyMatch(agencies, q)
    assert.ok(r && String(r.agency.id) === id, '知名「' + q + '」→ id ' + id)
    assert.strictEqual(agencyMatchesCanonical(distractor, canon), false, '干扰项不得匹配「' + q + '」')
  })

  // 科工 ≠ 科技
  assert.strictEqual(detectKnownAgencyCanonical('中国航天科工集团'), 'casic')

  // 仅有干扰项时知名问法宁可不配
  assert.ok(!pickBestAgencyMatch([distractor], 'SpaceX'))
  assert.ok(!pickBestAgencyMatch([distractor], '中国航天科技集团'))
  assert.ok(!pickBestAgencyMatch([distractor], 'NASA'))
}

function testIntentMissionReplay() {
  ;[
    '引力一号的回放视频',
    '看看长征七号回放集锦',
    'Starlink replay video',
    '朱雀三号发射集锦'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'mission_replay', q)
    assert.strictEqual(matchMissionReplayIntent(q), true, q)
  })
  // 飞行剖面「回放」不抢
  assert.notStrictEqual(resolveAiChatRichIntent('回放飞行剖面演示'), 'mission_replay')
  assert.ok(stripReplayAskNoise('引力一号的回放视频').includes('引力'))
  assert.ok(!/回放|视频/.test(stripReplayAskNoise('引力一号的回放视频')))
}

function testIntentMissionLookup() {
  ;[
    '朱雀三号',
    '朱雀三号什么时候发射？',
    '猎鹰9号下次发射',
    'Falcon 9',
    '星链任务',
    // 裸问下一场：此前意图为 null、模型空口说有卡但不抽卡
    '下一次发射',
    '下次发射',
    '下一场发射',
    'next launch'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'mission_lookup', q)
    assert.strictEqual(matchMissionLookupIntent(q), true, q)
  })
  // 非星舰 + 进展 → 检索该火箭，不进星舰状态
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号进展'), 'mission_lookup')
  // 带型号的「下次」仍走任务检索，不与星舰下一飞抢
  assert.strictEqual(resolveAiChatRichIntent('猎鹰9号下一次发射'), 'mission_lookup')
}

function testIntentNegative() {
  ;[
    '今天天气怎么样',
    '你好',
    ''
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), null, q)
  })
}

/** 口语/同义改写：不依赖固定关键词也能命中 */
function testIntentGeneralization() {
  ;[
    ['中国今年发了几发火箭', 'launch_stats'],
    ['国内航天发射战绩怎么样', 'launch_stats'],
    ['看看各国发射排行', 'launch_stats'],
    ['最近有火箭要打吗', 'launch_list'],
    ['这几天有发射安排吗', 'launch_list'],
    ['马斯克那家公司怎么样', 'agency'],
    ['蓝色起源靠谱吗', 'agency'],
    ['讲讲火箭实验室', 'agency'],
    ['ULA 是干嘛的', 'agency'],
    ['天宫上现在有谁', 'station'],
    ['星基那边路封了吗', 'road_closure'],
    ['发射剖面给我看看', 'flight_demo'],
    ['模拟一下发射决策', 'mission_sim'],
    ['龙飞船现在飞到哪了', 'vehicle_tracker']
  ].forEach(([q, expect]) => {
    assert.strictEqual(resolveAiChatRichIntent(q), expect, q + ' → ' + expect)
  })
}

function testPriorityNextOverStatus() {
  assert.strictEqual(resolveAiChatRichIntent('星舰下一次试飞进展'), 'starship_next')
}

function testPriorityDemoOverStatus() {
  assert.strictEqual(resolveAiChatRichIntent('星舰飞行剖面演示'), 'flight_demo')
  assert.strictEqual(matchStarshipStatusIntent('星舰飞行剖面演示'), false)
}

function testPrioritySimOverStatus() {
  assert.strictEqual(resolveAiChatRichIntent('星舰任务指挥室进展'), 'mission_sim')
  assert.strictEqual(matchStarshipStatusIntent('星舰任务指挥室'), false)
}

function testPriorityRoadOverStatus() {
  assert.strictEqual(resolveAiChatRichIntent('星舰封路进展'), 'road_closure')
}

function testExtractAndPick() {
  assert.ok(extractMissionSearchKey('朱雀三号什么时候发射？').includes('朱雀'))
  assert.strictEqual(extractMissionSearchKey('进展'), '')

  const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
  const later = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString()
  const tooFar = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
  const list = [
    { id: 'a', name: 'Falcon 9', rocketName: 'Falcon 9', launchTime: soon },
    { id: 'b', name: 'Starship Flight 9', rocketName: 'Starship', launchTime: soon },
    { id: 'c', name: 'Starship Flight 10', rocketName: 'Starship', launchTime: later },
    { id: 'z', name: 'Zhuque-3 | Demo Flight', rocketName: 'Zhuque-3', missionName: 'ZQ-3', launchTime: soon },
    { id: 's', name: 'Starlink Group 12-1', rocketName: 'Falcon 9', launchTime: later }
  ]
  assert.strictEqual(pickStarshipMission(list, 'c').id, 'c')
  assert.strictEqual(pickLaunchList(list, 2).length, 2)

  const mixed = [
    { id: '1', name: 'Flight 13', launchAgency: 'SpaceX', launchSite: 'Starbase', launchTime: soon, countryDisplay: '美国' },
    { id: '2', name: 'CZ-7A', launchAgency: 'CASC', launchSite: 'Wenchang, China', padLocation: 'LC-201 @ Wenchang', launchTime: soon, countryDisplay: '中国' },
    { id: '3', name: 'Starlink', launchAgency: 'SpaceX', padLocation: 'SLC-40 @ Cape Canaveral', launchTime: later, countryDisplay: '美国' },
    { id: '4', name: 'CZ-6A', launchAgency: 'CASC', padLocation: '文昌航天发射场', launchTime: later, countryDisplay: '中国' },
    { id: '5', name: 'CZ-far', launchAgency: 'CASC', padLocation: '酒泉', launchTime: tooFar, countryDisplay: '中国' }
  ]
  const wenchang = pickLaunchList(mixed, 5, parseLaunchListFilter('海南文昌发射场最近有什么发射任务？'))
  assert.strictEqual(wenchang.length, 2, '文昌只出 2 条')
  assert.ok(wenchang.every((m) => missionMatchesLaunchListFilter(m, { siteKey: 'wenchang', withinDays: LAUNCH_LIST_WITHIN_DAYS })))
  const spacexOnly = pickLaunchList(mixed, 5, parseLaunchListFilter('SpaceX接下来发什么'))
  assert.strictEqual(spacexOnly.length, 2, 'SpaceX 只出 2 条')
  assert.ok(spacexOnly.every((m) => /spacex/i.test(m.launchAgency)))
  const chinaOnly = pickLaunchList(mixed, 5, parseLaunchListFilter('中国接下来有哪些发射'))
  assert.strictEqual(chinaOnly.length, 2, '中国 60 天内只出 2 条（排除 90 天后）')
  assert.ok(chinaOnly.every((m) => m.countryDisplay === '中国'))
  assert.ok(!chinaOnly.some((m) => m.id === '5'), '60 天外不出卡')
  assert.strictEqual(missionWithinUpcomingDays(mixed[4], 60), false)
  assert.strictEqual(missionWithinUpcomingDays(mixed[1], 60), true)

  assert.strictEqual(isUsableLaunchForCard({ id: '1', name: 'Starlink' }), true)
  assert.strictEqual(isUsableMissionForCard({ id: '1', name: 'Starlink' }), false)

  const zq = pickBestMissionMatch(list, '朱雀三号什么时候发射')
  assert.ok(zq && zq.mission && zq.mission.id === 'z', '命中朱雀三号')

  const f9 = pickBestMissionMatch(list, '猎鹰9号')
  assert.ok(f9 && f9.mission && f9.mission.rocketName === 'Falcon 9', '命中猎鹰9')

  const qZq = buildLaunchSearchQueries('朱雀三号什么时候发射？')
  assert.ok(qZq.some((q) => /Zhuque|ZQ-3/i.test(q)), '云端查询含 Zhuque/ZQ-3')
  const qF9 = buildLaunchSearchQueries('猎鹰9号')
  assert.ok(qF9.some((q) => /Falcon\s*9/i.test(q)), '云端查询含 Falcon 9')

  const stations = [
    { id: 4, name: '国际空间站' },
    { id: 18, name: '天宫空间站' }
  ]
  assert.strictEqual(pickStation(stations, '天宫乘组').id, 18)
  assert.strictEqual(pickStation(stations, 'ISS 怎么样').id, 4)
}

function testEnrich() {
  const withCard = enrichLaunchContextWithCard({}, {
    id: 'x', name: 'Starship Flight 10', rocketName: 'Starship',
    launchTime: '2026-08-01T00:00:00Z', padLocation: 'Starbase', statusText: '计划中'
  })
  assert.ok(withCard.focusMission)
  assert.strictEqual(withCard.uiCardReady, true)
  assert.strictEqual(withCard.focusMission.detailType, 'upcoming')
  assert.ok((withCard.upcoming || []).some((m) => m.name === 'Starship Flight 10'), '未发射任务进 upcoming')

  // 历史任务卡：不能混进 upcoming，提示要求用过去时
  const withPastCard = enrichLaunchContextWithCard({ upcoming: [] }, {
    id: 'old', name: '长征十号甲 | 试验飞行', rocketName: '长征十号甲',
    launchTime: '2026-01-01T00:00:00Z', statusText: '成功', detailType: 'completed'
  })
  assert.strictEqual(withPastCard.focusMission.detailType, 'completed')
  assert.strictEqual((withPastCard.upcoming || []).length, 0, '历史任务不进 upcoming')
  assert.ok((withPastCard.completed || []).some((m) => m.rocketName === '长征十号甲'), '历史任务进 completed')
  assert.ok(/已完成/.test(withPastCard.focusHint), '历史任务提示标注已完成')
  assert.ok(/过去时/.test(withPastCard.focusHint), '历史任务提示要求过去时')
  assert.ok(String(enrichLaunchContextNoStarshipSchedule({}).focusHint).includes('暂无'))

  const replayPlayable = enrichLaunchContextWithMissionReplay({}, {
    missionName: '引力一号', playable: true, videoUrl: 'https://x/v.mp4', launchId: 'g1'
  })
  assert.ok(replayPlayable.suggestedReply && replayPlayable.suggestedReply.indexOf('引力一号') >= 0)
  assert.ok(!/未匹配|找不到/.test(replayPlayable.suggestedReply))
  assert.strictEqual(replayPlayable.uiCardReady, true)
  const replayPending = enrichLaunchContextWithMissionReplay({}, {
    missionName: 'CZ-7', playable: false, launchId: 'c7'
  })
  assert.ok(replayPending.suggestedReply.indexOf('暂未就绪') >= 0)

  const list = enrichLaunchContextWithLaunchList({}, {
    items: [{ name: 'A', rocketName: 'F9', formattedTime: '08月01日 12:00', statusText: 'Go' }]
  })
  assert.strictEqual(list.upcoming.length, 1)

  const st = enrichLaunchContextWithStarshipStatus({}, {
    booster: { id: 'B15', status: 'Stack', progress: 80 },
    ship: { id: 'S38', status: 'Rollout', progress: 60 },
    checklist: { done: 3, total: 10 }
  })
  assert.ok(String(st.focusHint).includes('B15'))

  assert.ok(String(enrichLaunchContextWithFlightDemo({}, { missionName: 'IFT-10' }).focusHint).includes('IFT-10'))
  assert.ok(String(enrichLaunchContextWithVehicleTracker({}).focusHint).includes('在轨'))
  assert.ok(String(enrichLaunchContextWithMissionSim({}).focusHint).includes('指挥室'))
  assert.ok(String(enrichLaunchContextWithRoadClosure({}).focusHint).includes('封路'))
  assert.ok(String(enrichLaunchContextWithStation({}, { stationName: '天宫' }).focusHint).includes('天宫'))
  assert.ok(String(enrichLaunchContextWithLaunchStats({}, {
    scopeLabel: '今日', countryLabel: '中国', total: 1, success: 1, failure: 0
  }).focusHint).includes('今日'))
  assert.ok(String(enrichLaunchContextWithAgency({}, {
    displayName: 'SpaceX', totalLaunchCount: 300, countryLabel: '美国'
  }).focusHint).includes('SpaceX'))
}

/** 「长征十号甲什么时候发射」必须出即将发射卡，不能抽历史任务 */
function testMissionLookupPrefersUpcoming() {
  assert.strictEqual(missionLookupTimePreference('长征十号甲什么时候发射？'), 'upcoming')
  assert.strictEqual(missionLookupTimePreference('朱雀三号下一次发射'), 'upcoming')
  assert.strictEqual(missionLookupTimePreference('长征七号回放'), 'completed')
  assert.strictEqual(missionLookupTimePreference('长征十号甲'), '')

  // 中英同源：长征十号甲 ↔ Long March 10A
  const nCn = normalizeMatchText('长征十号甲')
  assert.strictEqual(nCn, 'cz10a', '长征十号甲 → cz10a，实得 ' + nCn)
  assert.strictEqual(normalizeMatchText('Long March 10A'), 'cz10a')
  assert.strictEqual(normalizeMatchText('CZ-10A'), 'cz10a')
  assert.strictEqual(normalizeMatchText('长征十二乙'), 'cz12b')
  assert.strictEqual(normalizeMatchText('长征七'), 'cz7')
  assert.strictEqual(normalizeMatchText('Long March 7'), 'cz7')

  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const future = new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString()
  const farFuture = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString()
  const pool = [
    { id: 'old', name: 'Long March 10A | Test Flight', rocketName: 'Long March 10A', launchTime: past, success: true },
    { id: 'next', name: 'Long March 10A | Crew Demo', rocketName: 'Long March 10A', launchTime: farFuture },
    { id: 'soon', name: 'Long March 10A | Pad Test', rocketName: 'Long March 10A', launchTime: future }
  ]
  const hit = pickBestMissionMatch(pool, '长征十号甲什么时候发射？')
  assert.ok(hit && hit.mission, '长征十号甲应命中任务')
  assert.strictEqual(hit.detailType, 'upcoming', '未来问法必须出即将发射')
  assert.strictEqual(hit.mission.id, 'soon', '同分取 NET 最近的即将任务')

  // 只有历史任务时仍出卡（回落），不至于什么都不给
  const onlyPast = [pool[0]]
  const fallback = pickBestMissionMatch(onlyPast, '长征十号甲什么时候发射？')
  assert.ok(fallback && fallback.mission.id === 'old', '无排期时回落历史任务')
  assert.strictEqual(fallback.detailType, 'completed')

  // 回放问法仍拿历史
  const replayHit = pickBestMissionMatch(pool, '长征十号甲的回放')
  assert.strictEqual(replayHit.detailType, 'completed', '回放问法取历史')

  // detailType 兜底：无 _detailType/结果字段时按 NET 判断
  assert.strictEqual(resolveMissionDetailType({ launchTime: past }), 'completed')
  assert.strictEqual(resolveMissionDetailType({ launchTime: future }), 'upcoming')
  assert.strictEqual(resolveMissionDetailType({ _detailType: 'completed', launchTime: future }), 'completed')

  // 云端查询词能反查英文名
  const queries = buildLaunchSearchQueries('长征十号甲什么时候发射？')
  assert.ok(queries.some((q) => /Long March 10A/i.test(q)), '云端查询含 Long March 10A，实得 ' + queries.join('|'))
  assert.ok(buildLaunchSearchQueries('长征七号什么时候发射').some((q) => /Long March 7/i.test(q)))

  assert.strictEqual(missionLookupTimePreference('长征七号甲最近的历史发射'), 'completed')
}

/** 历史发射问法：不得误判为即将发射列表 */
function testHistoryLaunchIntent() {
  assert.ok(hasHistorySense('长征七号甲最近的历史发射'))
  assert.strictEqual(matchLaunchListIntent('长征七号甲最近的历史发射'), false, '历史问法不进 launch_list')
  assert.strictEqual(
    resolveAiChatRichIntent('长征七号甲最近的历史发射'),
    'mission_lookup',
    '单场历史 → mission_lookup'
  )
  // 用户原话：具体火箭「最近发射状态」≠ 通用即将发射列表
  assert.ok(hasSingularRecentLaunchAsk('长征七号甲最近发射状态'))
  assert.ok(hasHistorySense('长征七号甲最近发射状态'))
  assert.strictEqual(matchLaunchListIntent('长征七号甲最近发射状态'), false)
  assert.strictEqual(
    resolveAiChatRichIntent('长征七号甲最近发射状态'),
    'mission_lookup',
    '最近发射状态 → 单场任务卡'
  )
  assert.strictEqual(missionLookupTimePreference('长征七号甲最近发射状态'), 'completed')
  assert.strictEqual(resolveAiChatRichIntent('猎鹰9最近一次发射'), 'mission_lookup')
  assert.strictEqual(resolveAiChatRichIntent('有哪些历史发射'), 'history_list')
  assert.strictEqual(resolveAiChatRichIntent('SpaceX过往发射有哪些'), 'history_list')
  assert.ok(matchHistoryListIntent('中国历史发射列表'))
  assert.strictEqual(resolveAiChatRichIntent('接下来有哪些发射？'), 'launch_list')
  assert.strictEqual(resolveAiChatRichIntent('最近有火箭要打吗'), 'launch_list')
}

/** 「提醒我一下」→ 自动开提醒意图，不是任务卡 / 我的提醒列表 */
function testSetReminderIntent() {
  assert.ok(hasSetReminderAsk('朱雀三号发射提醒我一下'))
  assert.ok(matchSetReminderIntent('朱雀三号发射提醒我一下'))
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号发射提醒我一下'), 'set_reminder')
  assert.strictEqual(resolveAiChatRichIntent('猎鹰9提醒我一下'), 'set_reminder')
  assert.strictEqual(resolveAiChatRichIntent('帮我设个朱雀三号提醒'), 'set_reminder')
  // 查看列表仍走 my_launches
  assert.strictEqual(resolveAiChatRichIntent('我的提醒'), 'my_launches')
  assert.strictEqual(resolveAiChatRichIntent('我订阅了哪些发射'), 'my_launches')
  // 普通查任务不被抢走
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号什么时候发射'), 'mission_lookup')
}

/** 小程序功能入口抽卡覆盖 */
function testFeatureEntryIntents() {
  ;[
    ['打开我的徽章', 'badges'],
    ['我的收藏', 'favorites'],
    ['每日挑战', 'daily_quiz'],
    ['月愿计划', 'collect'],
    ['系外行星', 'exoplanet'],
    ['NASA数据', 'nasa_data'],
    ['全球飞船图鉴', 'spacecraft_gallery'],
    ['全球发射场分布', 'launch_site_gallery']
  ].forEach(([q, expect]) => {
    assert.strictEqual(resolveAiChatRichIntent(q), expect, q + ' → ' + expect)
  })
}

/** 历史云探关键词：最多 2 个，优先英文代号 */
function testHistoryCloudSearchKeysCap() {
  const spacexKeys = buildHistoryCloudSearchKeys(
    parseHistoryListFilter('SpaceX过往发射有哪些'),
    'SpaceX过往发射有哪些'
  )
  assert.ok(spacexKeys.length <= 2, '云探词不超过 2：' + spacexKeys.join('|'))
  assert.ok(spacexKeys.some((k) => /spacex/i.test(k)), '应含 spacex：' + spacexKeys.join('|'))

  const czKeys = buildHistoryCloudSearchKeys(
    { rocketKey: '长征七号甲', timeBucket: 'completed' },
    '长征七号甲历史发射有哪些'
  )
  assert.ok(czKeys.length <= 2, '火箭云探词不超过 2：' + czKeys.join('|'))
  assert.ok(czKeys.some((k) => /Long March|cz7|长征/i.test(k)), '应含长征检索词：' + czKeys.join('|'))
}

/** 新增百科 / 个人化 / 内容意图：既要能命中，也不能抢走排期问法 */
function testExtendedIntents() {
  const cases = [
    ['猎鹰9多高', 'rocket_model'],
    ['长征五号运力多少', 'rocket_model'],
    ['星舰有多高', 'rocket_model'],
    ['文昌发射场在哪', 'launch_site'],
    ['39A工位介绍', 'launch_site'],
    ['神舟飞船能坐几人', 'spacecraft'],
    ['龙飞船', 'spacecraft'],
    ['B1067飞了几次', 'booster'],
    ['猎鹰9助推器复用记录', 'booster'],
    ['我订阅了哪些发射', 'my_launches'],
    ['我的提醒', 'my_launches'],
    ['这次发射能成功吗', 'launch_vote'],
    ['我要竞猜', 'launch_vote'],
    ['年度回顾', 'year_review'],
    ['今天的天文图片', 'apod'],
    ['最近有什么流星雨', 'astro_calendar'],
    ['最近有什么航天新闻', 'news'],
    ['今晚能看到星链吗', 'starlink_pass'],
    ['星链过境预报', 'starlink_pass'],
    ['看看星链实时分布', 'starlink_map'],
    // 观礼类：问「人站哪儿看/观礼服务」统一走 viewing_spot → 火箭观礼卡
    ['去哪看火箭发射', 'viewing_spot'],
    ['文昌哪里看发射', 'viewing_spot'],
    ['观礼点推荐', 'viewing_spot'],
    ['看星舰发射去哪', 'viewing_spot'],
    ['淇水湾怎么去', 'viewing_spot'],
    ['现场观礼怎么参加', 'viewing_spot'],
    ['怎么预约火箭观礼', 'viewing_spot'],
    ['观礼抽卡', 'viewing_spot'],
    ['文昌发射场在哪', 'launch_site'],
    ['星链有多少颗卫星', 'starlink_map'],
    ['星链在哪', 'starlink_map'],
    // 星链的排期/回放/列表仍归原意图
    ['星链什么时候发射', 'mission_lookup'],
    ['星链回放', 'mission_replay'],
    ['接下来有哪些星链发射', 'launch_list'],
    ['阿尔忒弥斯2什么时候发射', 'artemis'],
    ['S38在哪', 'starship_hardware'],
    ['助推器15测试了吗', 'starship_hardware'],
    ['星舰硬件设施列表', 'starship_hardware'],
    ['猎鹰9回收成功率', 'recovery_stats'],
    ['助推器复用排行', 'recovery_stats'],
    ['一共回收了多少枚', 'recovery_stats'],
    // 组合体状态问法归 starship_status；单枚编号战绩归 booster
    ['星舰 B15 状态怎么样', 'starship_status'],
    ['B1067飞了几次', 'booster'],
    // 不许抢：排期 / 列表 / 追踪 / 星舰进展仍归原意图
    ['长征五号什么时候发射', 'mission_lookup'],
    ['朱雀三号什么时候发射？', 'mission_lookup'],
    ['接下来有哪些发射？', 'launch_list'],
    ['文昌接下来有哪些发射', 'launch_list'],
    ['追踪龙飞船', 'vehicle_tracker'],
    ['星舰最新进展如何？', 'starship_status'],
    ['今天中国发射了多少次？', 'launch_stats'],
    ['SpaceX是什么公司？', 'agency']
  ]
  cases.forEach(([q, expect]) => {
    assert.strictEqual(resolveAiChatRichIntent(q), expect, q + ' → ' + expect)
  })

  assert.strictEqual(extractBoosterSerial('B1067飞了几次'), 'B1067')
  assert.strictEqual(extractBoosterSerial('b-1080 复用'), 'B1080')
  // 星舰 B15 是两位数编号，不能当猎鹰助推器
  assert.strictEqual(extractBoosterSerial('星舰B15进展'), '')

  assert.deepStrictEqual(extractStarshipHardwareRef('S38在哪'), { kind: 'ship', num: 38 })
  assert.deepStrictEqual(extractStarshipHardwareRef('助推器15测试了吗'), { kind: 'booster', num: 15 })
  // 猎鹰四位数编号不能被当成星舰硬件
  assert.strictEqual(extractStarshipHardwareRef('B1067复用'), null)

  const vehicles = [
    { id: 1, name: 'Super Heavy Booster 15', statusZh: '静态点火' },
    { id: 2, name: 'Ship 38', statusZh: '测试中' }
  ]
  assert.strictEqual(pickStarshipHardware(vehicles, 'S38在哪').id, 2)
  assert.strictEqual(pickStarshipHardware(vehicles, '助推器15什么状态').id, 1)
  assert.strictEqual(pickStarshipHardware(vehicles, '星舰硬件设施'), null)
  assert.deepStrictEqual(parseHardwareVehicleRef('Ship 38'), { kind: 'ship', num: 38 })
  assert.deepStrictEqual(parseHardwareVehicleRef('Booster 16'), { kind: 'booster', num: 16 })
}

function testSpecPickers() {
  const configs = {
    164: { id: 164, name: 'Falcon 9', full_name: 'Falcon 9 Block 5', total_launch_count: 400 },
    62: { id: 62, name: 'Falcon 9', full_name: 'Falcon 9 v1.1', total_launch_count: 15 },
    200: { id: 200, name: 'Long March 5', full_name: 'Long March 5', total_launch_count: 20 }
  }
  const f9 = pickRocketConfig(configs, extractRocketModelKey('猎鹰9多高'))
  assert.ok(f9, '猎鹰9 应命中构型')
  assert.strictEqual(f9.id, '164', '同名系列取发射次数多的主力构型')
  const cz5 = pickRocketConfig(configs, extractRocketModelKey('长征五号运力多少'))
  assert.ok(cz5 && cz5.id === '200', '长征五号 ↔ Long March 5')
  assert.strictEqual(pickRocketConfig(configs, '不存在的火箭'), null)

  const sites = [
    { id: 12, name: 'Wenchang Space Launch Site', countryName: 'China', totalLaunchCount: 30 },
    { id: 27, name: 'Kennedy Space Center, FL, USA', countryName: 'USA', totalLaunchCount: 200 }
  ]
  assert.strictEqual(pickLaunchSite(sites, '文昌发射场在哪').site.id, 12, '中文地名 → 英文场站')
  assert.strictEqual(pickLaunchSite(sites, '39A工位介绍').site.id, 27, '39A → 肯尼迪航天中心')
  assert.strictEqual(pickLaunchSite(sites, '朱雀三号'), null)

  const crafts = [
    { id: 5, name: 'Shenzhou', inUse: true },
    { id: 6, name: 'Crew Dragon', inUse: true }
  ]
  assert.strictEqual(pickSpacecraftConfig(crafts, '神舟飞船能坐几人').config.id, 5)
  assert.strictEqual(pickSpacecraftConfig(crafts, '龙飞船介绍').config.id, 6)
  assert.strictEqual(pickSpacecraftConfig(crafts, '文昌发射场'), null)
}

function testSpecEnrich() {
  const spec = enrichLaunchContextWithSpec({}, {
    title: 'Falcon 9 Block 5',
    rows: [
      { label: '全长', value: '70 m' },
      { label: '直径', value: '' },
      { label: 'LEO 运力', value: '22800 kg' }
    ]
  })
  assert.strictEqual(spec.uiCardReady, true)
  assert.ok(spec.focusHint.indexOf('70 m') >= 0, '提示里带真实参数')
  assert.ok(spec.focusHint.indexOf('22800 kg') >= 0)
  assert.ok(spec.focusHint.indexOf('直径') < 0, '空值字段不进提示')
  assert.ok(/禁止编造/.test(spec.focusHint), '要求不许编数字')

  const noSpec = enrichLaunchContextNoSpec({}, '火箭型号', '猎鹰99多高')
  assert.ok(/没查到|未匹配/.test(noSpec.focusHint))
  assert.strictEqual(noSpec.uiCardReady, undefined, '没出卡就不能置 uiCardReady')

  const mine = enrichLaunchContextWithMyLaunches({}, { items: [{ id: 'a' }, { id: 'b' }] })
  assert.strictEqual(mine.uiCardReady, true)
  assert.ok(mine.focusHint.indexOf('2 个任务') >= 0)
  const noMine = enrichLaunchContextNoMyLaunches({})
  assert.ok(/还没有订阅|没有任何订阅/.test(noMine.focusHint))
  assert.strictEqual(noMine.uiCardReady, undefined)

  const entry = enrichLaunchContextWithSimpleEntry({}, { label: '天象日历', action: '查看天象时间' })
  assert.strictEqual(entry.uiCardReady, true)
  assert.ok(entry.focusHint.indexOf('天象日历') >= 0)
}

function testViewingSpots() {
  // 观礼类问题已改推火箭观礼入口卡（静态观礼点导航表已下线）
  const viewing = enrichLaunchContextWithWatchParty({}, {
    title: '长征八号·文昌观礼专场',
    merchantName: 'wc002',
    padLocationName: '文昌'
  })
  assert.strictEqual(viewing.uiCardReady, true)
  assert.ok(viewing.focusHint.indexOf('火箭观礼') >= 0)
  assert.ok(viewing.focusHint.indexOf('文昌') >= 0 || viewing.focusHint.indexOf('wc002') >= 0)
  assert.ok(/不要编造/.test(viewing.focusHint))

  const closed = enrichLaunchContextWatchPartyClosed({})
  assert.strictEqual(closed.uiCardReady, false)
  assert.ok(/暂未开放|已结束/.test(closed.focusHint))
}

function testIntentMerchantJoin() {
  // 商家侧问入驻 → merchant_join（出入驻邀请抽卡）
  ;[
    '商家入驻',
    '商家入驻怎么弄',
    '我想入驻商家',
    '观礼商家怎么入驻',
    '怎么成为观礼合作商家',
    '民宿可以入驻吗',
    '怎么加盟观礼点',
    '商户合作怎么申请',
    '如何入驻',
    '入驻流程是什么',
    '入驻',
    '能入驻吗'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'merchant_join', q)
    assert.strictEqual(matchMerchantJoinIntent(q), true, q)
  })

  // 顾客侧观礼问法不许被抢走
  ;[
    ['去哪看火箭发射', 'viewing_spot'],
    ['现场观礼怎么参加', 'viewing_spot'],
    ['怎么预约火箭观礼', 'viewing_spot'],
    ['观礼抽卡', 'viewing_spot']
  ].forEach(([q, expect]) => {
    assert.strictEqual(resolveAiChatRichIntent(q), expect, q + ' → ' + expect)
  })

  // 航天语义的「进驻/入驻」不误伤
  assert.strictEqual(matchMerchantJoinIntent('宇航员什么时候进驻空间站'), false, '进驻空间站')
  assert.strictEqual(matchMerchantJoinIntent('神舟乘组入驻天宫了吗'), false, '入驻天宫')
  assert.strictEqual(matchMerchantJoinIntent('星链入驻美国市场了吗'), false, '入驻市场（非问句形态）')

  // launchContext：出卡走本地固定文案；开关关闭时不引导入口
  const on = enrichLaunchContextWithMerchantJoin({})
  assert.strictEqual(on.uiCardReady, true)
  assert.ok(on.focusHint.indexOf('商家入驻邀请') >= 0)
  assert.ok(on.suggestedReply && on.suggestedReply.indexOf('抽卡') >= 0, '固定文案含抽卡引导')
  assert.ok(/不要编造/.test(on.focusHint))

  const off = enrichLaunchContextMerchantJoinFeatureOff({ suggestedReply: '旧文案' })
  assert.strictEqual(off.uiCardReady, false)
  assert.strictEqual(off.suggestedReply, undefined, '开关关闭必须清掉固定文案')
  assert.ok(/暂未开放/.test(off.focusHint))
  assert.ok(/不要引导/.test(off.focusHint))
}

function main() {
  const tests = [
    testIntentNext,
    testIntentStatus,
    testIntentLaunchList,
    testIntentLaunchStats,
    testIntentFlightDemo,
    testIntentVehicleTracker,
    testIntentMissionSim,
    testIntentRoadClosure,
    testIntentStation,
    testIntentAgency,
    testIntentMissionReplay,
    testIntentMissionLookup,
    testIntentNegative,
    testIntentGeneralization,
    testPriorityNextOverStatus,
    testPriorityDemoOverStatus,
    testPrioritySimOverStatus,
    testPriorityRoadOverStatus,
    testExtractAndPick,
    testMissionLookupPrefersUpcoming,
    testHistoryLaunchIntent,
    testSetReminderIntent,
    testFeatureEntryIntents,
    testHistoryCloudSearchKeysCap,
    testExtendedIntents,
    testSpecPickers,
    testSpecEnrich,
    testViewingSpots,
    testIntentMerchantJoin,
    testEnrich
  ]
  let failed = 0
  tests.forEach((fn) => {
    try {
      fn()
      console.log('OK', fn.name)
    } catch (e) {
      failed += 1
      console.error('FAIL', fn.name, e.message)
    }
  })
  if (failed) {
    console.error('\n' + failed + ' failed')
    process.exit(1)
  }
  console.log('\nall green:', tests.length, 'tests')
}

main()
