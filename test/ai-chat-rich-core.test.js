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
  enrichLaunchContextWithMissionReplay
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
    '星链任务'
  ].forEach((q) => {
    assert.strictEqual(resolveAiChatRichIntent(q), 'mission_lookup', q)
    assert.strictEqual(matchMissionLookupIntent(q), true, q)
  })
  // 非星舰 + 进展 → 检索该火箭，不进星舰状态
  assert.strictEqual(resolveAiChatRichIntent('朱雀三号进展'), 'mission_lookup')
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
