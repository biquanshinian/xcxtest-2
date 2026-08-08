/**
 * 星问富消息 — 深度可运行态审计
 * node scripts/_audit_ai_chat_rich_runtime.js
 *
 * 覆盖：意图矩阵 / 快捷问题 / 卡片载荷形状 / 路由落点 / UI 接线 / 导出一致性
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
let failed = 0
let passed = 0

function ok(cond, msg) {
  if (cond) {
    passed += 1
    console.log('OK', msg)
  } else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function installWxStub() {
  const tmp = os.tmpdir()
  global.wx = {
    env: { USER_DATA_PATH: tmp },
    cloud: {
      // 业务侧多为 { success, fail } 回调；需主动回调，否则 Promise 会永久挂起
      callFunction: (opts) => {
        const o = opts || {}
        const action = o.data && o.data.action
        let result = { success: false, error: 'stub', message: 'audit stub' }
        if (action === 'missionReplay') {
          result = {
            success: true,
            data: {
              status: 'ready',
              clips: [{
                videoUrl: 'https://example.com/replay-clip.mp4',
                thumbnailUrl: 'https://example.com/replay-poster.jpg',
                publisher: 'SciNews',
                durationSec: 125,
                title: 'Launch highlight'
              }]
            }
          }
        }
        setTimeout(() => {
          try {
            if (typeof o.success === 'function') o.success({ result })
          } catch (e) {}
          try {
            if (typeof o.fail === 'function') { /* success 已回 */ }
          } catch (e) {}
          try {
            if (typeof o.complete === 'function') o.complete({})
          } catch (e) {}
        }, 0)
      },
      database: () => ({
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({
              data: name === 'global_config'
                ? { _id: id || 'main', enableMissionReplay: true, enableMissionSim: true }
                : {}
            })
          }),
          where: () => ({
            orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }),
            limit: () => ({ get: async () => ({ data: [] }) }),
            get: async () => ({
              data: name === 'global_config'
                ? [{ _id: 'main', enableMissionReplay: true, enableMissionSim: true }]
                : []
            })
          }),
          limit: () => ({ get: async () => ({ data: [] }) }),
          get: async () => ({ data: [] })
        })
      })
    },
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getStorage: (opts) => {
      const o = opts || {}
      try { if (typeof o.fail === 'function') o.fail({ errMsg: 'getStorage:stub' }) } catch (e) {}
      try { if (typeof o.complete === 'function') o.complete({}) } catch (e) {}
    },
    setStorage: (opts) => {
      const o = opts || {}
      try { if (typeof o.success === 'function') o.success({}) } catch (e) {}
      try { if (typeof o.complete === 'function') o.complete({}) } catch (e) {}
    },
    getFileSystemManager: () => ({
      accessSync: () => {},
      mkdirSync: () => {},
      writeFileSync: () => {},
      readFileSync: () => '',
      unlinkSync: () => {},
      readdirSync: () => []
    }),
    getSystemInfoSync: () => ({
      windowHeight: 800,
      statusBarHeight: 44,
      safeArea: { top: 44, bottom: 800 },
      platform: 'devtools'
    }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, width: 87, right: 375 }),
    vibrateShort: () => {},
    showToast: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    downloadFile: () => {},
    getImageInfo: () => {}
  }
}

function collectAppPages() {
  const app = JSON.parse(read('app.json'))
  const pages = new Set((app.pages || []).map((p) => '/' + String(p).replace(/^\//, '')))
  const subs = app.subPackages || app.subpackages || []
  subs.forEach((pkg) => {
    const rootPkg = String(pkg.root || '').replace(/\/$/, '')
    ;(pkg.pages || []).forEach((p) => {
      pages.add('/' + rootPkg + '/' + String(p).replace(/^\//, ''))
    })
  })
  return pages
}

function pageExists(pages, url) {
  if (!url) return false
  const bare = String(url).split('?')[0]
  return pages.has(bare)
}

async function main() {
  installWxStub()

  const core = require(path.join(root, 'subpackages/shared/utils/ai-chat-rich-core.js'))
  const rich = require(path.join(root, 'subpackages/shared/utils/ai-chat-rich.js'))
  const { ROUTES } = require(path.join(root, 'utils/routes.js'))
  const pages = collectAppPages()
  // 发射列表只出「未来 60 天窗」内任务：fixture 日期写死会随时间过期变红，一律动态生成
  const futureIso = (days) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()

  // ── 1. 导出一致性 ──
  const coreExports = [
    'matchStarshipNextFlightIntent', 'matchStarshipStatusIntent', 'matchLaunchListIntent',
    'matchFlightDemoIntent', 'matchMissionSimIntent', 'matchVehicleTrackerIntent',
    'matchRoadClosureIntent', 'matchStationIntent', 'matchMissionLookupIntent',
    'matchMissionReplayIntent',
    'resolveAiChatRichIntent',
    'pickStarshipMission', 'pickLaunchList', 'pickStation', 'pickBestMissionMatch',
    'extractMissionSearchKey', 'stripReplayAskNoise',
    'enrichLaunchContextWithCard', 'enrichLaunchContextWithFlightDemo',
    'enrichLaunchContextWithVehicleTracker', 'enrichLaunchContextWithMissionSim',
    'enrichLaunchContextWithRoadClosure', 'enrichLaunchContextWithStation',
    'enrichLaunchContextWithMissionReplay',
    'matchRocketModelIntent', 'matchLaunchSiteIntent', 'matchSpacecraftIntent',
    'matchBoosterIntent', 'matchMyLaunchesIntent', 'matchYearReviewIntent',
    'matchLaunchVoteIntent', 'matchApodIntent', 'matchAstroCalendarIntent', 'matchNewsIntent',
    'pickRocketConfig', 'pickLaunchSite', 'pickSpacecraftConfig',
    'extractBoosterSerial', 'extractRocketModelKey',
    'enrichLaunchContextWithSpec', 'enrichLaunchContextNoSpec',
    'enrichLaunchContextWithMyLaunches', 'enrichLaunchContextNoMyLaunches',
    'enrichLaunchContextWithSimpleEntry',
    'matchStarlinkPassIntent', 'matchStarlinkMapIntent', 'matchViewingSpotIntent', 'matchArtemisIntent',
    'matchStarshipHardwareIntent', 'matchRecoveryStatsIntent',
    'extractStarshipHardwareRef', 'pickStarshipHardware', 'parseHardwareVehicleRef'
  ]
  coreExports.forEach((k) => ok(typeof core[k] === 'function', 'core export ' + k))

  const richExports = [
    'resolveRichChatPayload', 'resolveFlightDemoEntryCard', 'resolveMissionSimEntryCard',
    'resolveVehicleTrackerEntryCard', 'resolveRoadClosureEntryCard', 'resolveStationEntryCard',
    'resolveStarshipNextFlightCard', 'resolveLaunchListCard', 'resolveStarshipStatusCard',
    'resolveLiveWatchEntryCard',
    'resolveMissionLookupCard', 'resolveMissionReplayCard', 'resolveStarshipProgressEntryCard',
    'resolveLaunchStatsCard', 'resolveAgencyLookupCard',
    'matchRoadClosureIntent', 'matchStationIntent', 'matchMissionLookupIntent', 'matchLaunchStatsIntent',
    'matchAgencyIntent', 'matchMissionReplayIntent',
    'resolveRocketModelCard', 'resolveLaunchSiteCard', 'resolveSpacecraftCard',
    'resolveBoosterCard', 'resolveMySubscriptionsCard', 'resolveLaunchVoteEntryCard',
    'resolveYearReviewEntryCard', 'resolveAstroCalendarEntryCard', 'resolveNewsEntryCard',
    'resolveApodCard', 'buildSpecCard',
    'resolveStarlinkPassEntryCard', 'resolveStarlinkMapEntryCard', 'resolveWatchPartyEntryCard',
    'resolveArtemisEntryCard',
    'resolveStarshipHardwareCard', 'resolveRecoveryStatsCard'
  ]
  richExports.forEach((k) => ok(typeof rich[k] === 'function', 'rich export ' + k))

  // ── 2. 意图矩阵（互斥 + 优先级） ──
  const intentCases = [
    ['星舰下一次试飞是什么时候？', 'starship_next'],
    ['starship next flight', 'starship_next'],
    ['星舰最新进展如何？', 'starship_status'],
    ['进展', 'starship_status'],
    ['最新进展如何？', 'starship_status'],
    ['星舰组合体进度', 'starship_status'],
    ['接下来有哪些发射？', 'launch_list'],
    ['本周发射计划', 'launch_list'],
    ['中国接下来有哪些发射', 'launch_list'],
    ['今天中国发射了多少次？', 'launch_stats'],
    ['今年全球发射了多少次', 'launch_stats'],
    ['全球发射统计', 'launch_stats'],
    ['SpaceX是什么公司？', 'agency'],
    ['介绍一下蓝箭航天', 'agency'],
    ['看看飞行剖面演示', 'flight_demo'],
    ['这次任务怎么飞的', 'flight_demo'],
    ['打开星舰任务指挥室', 'mission_sim'],
    ['GO/NO-GO 模拟', 'mission_sim'],
    ['打开在轨飞行器追踪', 'vehicle_tracker'],
    ['追踪龙飞船', 'vehicle_tracker'],
    ['星舰封路了吗', 'road_closure'],
    ['道路封闭通知', 'road_closure'],
    ['看看空间站实时状态', 'station'],
    ['天宫现在有哪些乘组', 'station'],
    ['国际空间站怎么样', 'station'],
    ['朱雀三号什么时候发射？', 'mission_lookup'],
    ['长征十号甲什么时候发射？', 'mission_lookup'],
    ['猎鹰9号', 'mission_lookup'],
    ['引力一号的回放视频', 'mission_replay'],
    ['看看长征七号回放集锦', 'mission_replay'],
    ['猎鹰9多高', 'rocket_model'],
    ['长征五号运力多少', 'rocket_model'],
    ['文昌发射场在哪', 'launch_site'],
    ['神舟飞船能坐几人', 'spacecraft'],
    ['B1067飞了几次', 'booster'],
    ['我订阅了哪些发射', 'my_launches'],
    ['这次发射能成功吗', 'launch_vote'],
    ['年度回顾', 'year_review'],
    ['今天的天文图片', 'apod'],
    ['最近有什么流星雨', 'astro_calendar'],
    ['最近有什么航天新闻', 'news'],
    ['今晚能看到星链吗', 'starlink_pass'],
    ['看看星链实时分布', 'starlink_map'],
    ['星链有多少颗卫星', 'starlink_map'],
    ['星链什么时候发射', 'mission_lookup'],
    ['去哪看火箭发射', 'viewing_spot'],
    ['文昌观礼点推荐', 'viewing_spot'],
    ['看星舰发射去哪', 'viewing_spot'],
    ['淇水湾怎么去', 'viewing_spot'],
    ['文昌发射场在哪', 'launch_site'],
    ['阿尔忒弥斯任务进展', 'artemis'],
    ['S38在哪', 'starship_hardware'],
    ['星舰硬件设施列表', 'starship_hardware'],
    ['猎鹰9回收成功率', 'recovery_stats'],
    ['助推器复用排行', 'recovery_stats'],
    // 直播：各种喊法都要出直播卡
    ['直播', 'live_watch'],
    ['看直播', 'live_watch'],
    ['有直播吗', 'live_watch'],
    ['在哪看直播', 'live_watch'],
    ['在哪看发射直播？', 'live_watch'],
    ['怎么看火箭发射直播', 'live_watch'],
    ['发射直播间在哪', 'live_watch'],
    ['视频号直播', 'live_watch'],
    ['B站直播在哪', 'live_watch'],
    ['哪个平台有直播', 'live_watch'],
    ['直播链接给我', 'live_watch'],
    ['开播了吗', 'live_watch'],
    ['今晚有直播吗', 'live_watch'],
    // 带任务名的直播问法也归直播，不去查任务详情
    ['星舰试飞直播', 'live_watch'],
    ['星舰发射直播在哪看', 'live_watch'],
    // 「回放/集锦」是录播，仍归回放卡；「去哪站着看」仍归观礼点
    ['有直播回放吗', 'mission_replay'],
    ['直播集锦', 'mission_replay'],
    // 组合体状态问法仍归 starship_status（与既有契约一致）
    ['星舰 B15 状态怎么样', 'starship_status'],
    ['今天天气怎么样', null],
    ['', null]
  ]
  intentCases.forEach(([q, expect]) => {
    const got = core.resolveAiChatRichIntent(q)
    ok(got === expect, 'intent「' + (q || '(空)') + '」→ ' + String(expect) + (got === expect ? '' : ' (got ' + got + ')'))
  })

  // 优先级交叉
  ok(core.resolveAiChatRichIntent('星舰下一次试飞进展') === 'starship_next', 'prio next > status')
  ok(core.resolveAiChatRichIntent('星舰飞行剖面演示') === 'flight_demo', 'prio demo > status')
  ok(core.resolveAiChatRichIntent('星舰任务指挥室进展') === 'mission_sim', 'prio sim > status')
  ok(core.resolveAiChatRichIntent('星舰封路进展') === 'road_closure', 'prio road > status')
  ok(core.resolveAiChatRichIntent('在哪看发射直播') === 'live_watch', 'prio live > viewing_spot')
  ok(core.resolveAiChatRichIntent('去哪看火箭发射') === 'viewing_spot', '观礼点不被直播误伤')
  ok(core.matchLiveWatchIntent('有直播吗') === true, 'matchLiveWatchIntent 可用')
  ok(core.matchLiveWatchIntent('接下来有哪些发射？') === false, 'matchLiveWatchIntent 不误报')
  ok(core.resolveAiChatRichIntent('空间站在轨飞行器追踪') !== 'station' ||
    core.resolveAiChatRichIntent('打开在轨飞行器追踪') === 'vehicle_tracker', 'tracker 不被空间站误伤')

  // ── 3. 快捷问题全部可路由到意图 ──
  const svc = read('subpackages/shared/utils/aiService.js')
  const quickMatch = svc.match(/const QUICK_QUESTIONS = \[([\s\S]*?)\]/)
  ok(!!quickMatch, 'QUICK_QUESTIONS 可解析')
  const quicks = []
  if (quickMatch) {
    const re = /'([^']+)'/g
    let m = re.exec(quickMatch[1])
    while (m) {
      quicks.push(m[1])
      m = re.exec(quickMatch[1])
    }
  }
  ok(quicks.length >= 8, '快捷问题数量 ≥ 8（got ' + quicks.length + '）')
  quicks.forEach((q) => {
    const intent = core.resolveAiChatRichIntent(q)
    ok(!!intent, '快捷「' + q + '」有意图（' + intent + '）')
  })

  // ── 3b. 横向快捷入口 QUICK_SHORTCUTS（输入栏上方）──
  ok(svc.includes('QUICK_SHORTCUTS'), 'QUICK_SHORTCUTS 存在')
  const scMatch = svc.match(/const QUICK_SHORTCUTS = \[([\s\S]*?)\]\s*\n/)
  ok(!!scMatch, 'QUICK_SHORTCUTS 可解析')
  const shortcutQs = []
  if (scMatch) {
    const re = /q:\s*'([^']+)'/g
    let m = re.exec(scMatch[1])
    while (m) {
      shortcutQs.push(m[1])
      m = re.exec(scMatch[1])
    }
  }
  ok(shortcutQs.length >= 8, '横向快捷数量 ≥ 8（got ' + shortcutQs.length + '）')
  shortcutQs.forEach((q) => {
    const intent = core.resolveAiChatRichIntent(q)
    ok(!!intent, '横向快捷「' + q + '」有意图（' + intent + '）')
  })

  // ── 4. 入口卡同步载荷（不依赖云） ──
  const demo = rich.resolveFlightDemoEntryCard({
    cached: {
      id: 'm10',
      name: 'Starship Flight 10',
      rocketName: 'Starship',
      launchTime: futureIso(3)
    }
  })
  ok(demo.card && demo.card.cardType === 'entry', 'demo cardType=entry')
  ok(demo.card.entryKind === 'flight_demo', 'demo entryKind')
  ok(demo.card.needMissionSimFlag === true, 'demo needMissionSimFlag')
  ok(demo.card.gateProductId === 'mission_sim', 'demo gate=mission_sim')
  ok(String(demo.card.detailUrl).indexOf('/subpackages/mission-sim/flight-demo') === 0, 'demo url')
  ok(pageExists(pages, demo.card.detailUrl), 'demo 页在 app.json')

  const sim = rich.resolveMissionSimEntryCard()
  ok(sim.card.entryKind === 'mission_sim' && sim.card.needMissionSimFlag === true, 'sim 载荷')
  ok(pageExists(pages, sim.card.detailUrl), 'sim 页在 app.json')

  const vt = rich.resolveVehicleTrackerEntryCard()
  ok(vt.card.entryKind === 'vehicle_tracker' && vt.card.gateProductId === 'orbital_data_center', 'tracker 载荷')
  ok(pageExists(pages, vt.card.detailUrl), 'tracker 页在 app.json')
  ok(vt.card.detailUrl === ROUTES.VEHICLE_TRACKER, 'tracker 对齐 ROUTES')

  // 直播卡：落点是监控中心 Tab，必须 switchTab；带过审开关标记，且不挂会员门控
  const live = rich.resolveLiveWatchEntryCard()
  ok(live.card.entryKind === 'live_watch' && live.card.cardType === 'entry', 'live 载荷')
  ok(live.card.detailUrl === ROUTES.MONITOR && live.card.useSwitchTab === true, 'live 走 MONITOR switchTab')
  ok(pageExists(pages, live.card.detailUrl), 'live 页在 app.json')
  ok(live.card.needLiveFlag === true, 'live 带过审开关标记')
  ok(!live.card.gateProductId, 'live 不挂会员门控')
  ok(live.card.variant === 'live', 'live 配色 variant')

  const livePayload = await rich.resolveRichChatPayload('在哪看发射直播？', {})
  const liveHint = (livePayload.launchContext && livePayload.launchContext.focusHint) || ''
  ok(/监控中心/.test(liveHint), 'live focusHint 指路监控中心')
  ok(/不要编造/.test(liveHint), 'live focusHint 禁止编造直播地址/时间')

  const road = rich.resolveRoadClosureEntryCard()
  ok(road.card.entryKind === 'road_closure' && !road.card.needMissionSimFlag, 'road 载荷')
  ok(road.card.detailUrl === ROUTES.ROAD_CLOSURE_DETAIL, 'road 对齐 ROUTES')
  ok(pageExists(pages, road.card.detailUrl), 'road 页在 app.json')

  // ── 5. resolveRichChatPayload 全意图（fixture） ──
  const fixtureMission = {
    id: 'ss-10',
    name: 'Starship Flight 10',
    rocketName: 'Starship',
    launchTime: futureIso(3),
    statusBadgeText: 'Go',
    statusCategory: 'go',
    padLocation: 'Starbase',
    launchAgency: 'SpaceX'
  }
  const fixtureLaunches = [
    fixtureMission,
    {
      id: 'f9-1',
      name: 'Starlink Group 1',
      rocketName: 'Falcon 9',
      launchTime: futureIso(5),
      statusBadgeText: 'TBD',
      padLocation: 'CCSFS'
    }
  ]
  const fixtureStatus = {
    booster: { id: 'B15', status: 'Stack', progress: 80 },
    ship: { id: 'S38', status: 'Rollout', progress: 55 },
    flightReadinessChecklist: [{ done: true }, { done: false }, { done: true }]
  }

  const payloadCases = [
    {
      q: '星舰下一次试飞是什么时候？',
      opts: { cached: fixtureMission, upcomingHint: fixtureLaunches, trackedId: 'ss-10' },
      expectIntent: 'starship_next',
      expectCard: 'mission',
      mustHaveHint: true
    },
    {
      q: '星舰最新进展如何？',
      opts: { cachedStatus: fixtureStatus },
      expectIntent: 'starship_status',
      expectCard: 'starship_status',
      mustHaveHint: true
    },
    {
      q: '接下来有哪些发射？',
      opts: { upcomingHint: fixtureLaunches, limit: 5 },
      expectIntent: 'launch_list',
      expectCard: 'launch_list',
      mustHaveHint: true
    },
    {
      q: '引力一号的回放视频',
      opts: {
        completedHint: [{
          id: 'g1-1',
          name: 'Gravity-1 | Maiden Flight',
          missionName: 'Gravity-1 Maiden Flight',
          rocketName: 'Gravity-1',
          launchTime: '2024-01-11T00:00:00Z',
          statusBadgeText: 'Success',
          statusCategory: 'success',
          launchAgency: 'Orienspace'
        }]
      },
      expectIntent: 'mission_replay',
      expectCard: 'mission_replay',
      mustHaveHint: true
    },
    {
      q: '今天中国发射了多少次？',
      opts: {
        completedHint: [{
          id: 'cn-1',
          name: 'CZ demo',
          rocketName: 'Long March',
          launchTime: new Date().toISOString(),
          countryDisplay: '中国',
          success: true,
          statusCategory: 'success'
        }]
      },
      expectIntent: 'launch_stats',
      expectCard: 'launch_stats',
      mustHaveHint: true
    },
    {
      q: 'SpaceX是什么公司？',
      opts: {
        agencyHint: [{
          id: 121,
          name: 'SpaceX',
          abbrev: 'SpX',
          type: { name: 'Commercial' },
          country: [{ name: 'United States of America', alpha_2_code: 'US' }],
          founding_year: 2002,
          total_launch_count: 300,
          successful_launches: 280,
          description: 'Space Exploration Technologies Corp.'
        }]
      },
      expectIntent: 'agency',
      expectCard: 'agency',
      mustHaveHint: true
    },
    {
      q: '看看飞行剖面演示',
      opts: { cached: fixtureMission },
      expectIntent: 'flight_demo',
      expectCard: 'entry',
      expectKind: 'flight_demo',
      mustHaveHint: true
    },
    {
      q: '打开星舰任务指挥室',
      opts: {},
      expectIntent: 'mission_sim',
      expectCard: 'entry',
      expectKind: 'mission_sim',
      mustHaveHint: true
    },
    {
      q: '打开在轨飞行器追踪',
      opts: {},
      expectIntent: 'vehicle_tracker',
      expectCard: 'entry',
      expectKind: 'vehicle_tracker',
      mustHaveHint: true
    },
    {
      q: '星舰基地封路了吗',
      opts: {},
      expectIntent: 'road_closure',
      expectCard: 'entry',
      expectKind: 'road_closure',
      mustHaveHint: true
    },
    {
      q: '看看空间站实时状态',
      opts: {},
      expectIntent: 'station',
      expectCard: 'entry',
      expectKind: 'station',
      mustHaveHint: true
    },
    {
      q: '进展',
      opts: {},
      expectIntent: 'starship_status',
      // 有 B/S 数据 → status 卡；无数据 → 进度入口卡
      expectCardAny: ['starship_status', 'entry'],
      mustHaveHint: true
    },
    {
      q: '朱雀三号什么时候发射？',
      opts: {
        upcomingHint: [
          {
            id: 'zq3',
            name: 'Zhuque-3 | Demo Flight',
            rocketName: 'Zhuque-3',
            launchTime: futureIso(30),
            statusBadgeText: 'TBD',
            padLocation: 'Jiuquan'
          }
        ]
      },
      expectIntent: 'mission_lookup',
      expectCard: 'mission',
      mustHaveHint: true
    },
    {
      // 未来问法：历史任务同名也不能盖过即将发射
      q: '长征十号甲什么时候发射？',
      opts: {
        upcomingHint: [
          {
            id: 'cz10a-next',
            name: 'Long March 10A | Maiden Flight',
            rocketName: 'Long March 10A',
            launchTime: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
            statusBadgeText: 'TBD',
            padLocation: 'Wenchang'
          }
        ],
        completedHint: [
          {
            id: 'cz10a-old',
            name: '长征十号甲 | 试验飞行',
            missionName: '长征十号甲 试验飞行',
            rocketName: '长征十号甲',
            launchTime: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
            statusBadgeText: 'Success',
            statusCategory: 'success',
            success: true
          }
        ]
      },
      expectIntent: 'mission_lookup',
      expectCard: 'mission',
      expectDetailType: 'upcoming',
      expectCardId: 'cz10a-next',
      mustHaveHint: true
    },
    {
      q: '猎鹰9多高',
      opts: {
        rocketConfigsHint: {
          164: {
            id: 164,
            name: 'Falcon 9',
            full_name: 'Falcon 9 Block 5',
            length: 70,
            diameter: 3.7,
            leo_capacity: 22800,
            total_launch_count: 400,
            successful_launches: 398,
            reusable: true,
            manufacturerName: 'SpaceX'
          }
        }
      },
      expectIntent: 'rocket_model',
      expectCard: 'spec',
      expectSpecKind: 'rocket_model',
      mustHaveHint: true
    },
    {
      q: '文昌发射场在哪',
      opts: {
        launchSitesHint: [
          {
            id: 12,
            name: 'Wenchang Space Launch Site',
            countryName: 'China',
            active: true,
            totalLaunchCount: 30,
            latitude: 19.6,
            longitude: 110.9
          }
        ]
      },
      expectIntent: 'launch_site',
      expectCard: 'spec',
      expectSpecKind: 'launch_site',
      mustHaveHint: true
    },
    {
      q: '神舟飞船能坐几人',
      opts: {
        spacecraftHint: [
          { id: 5, name: 'Shenzhou', inUse: true, agencyName: 'CASC', crewCapacity: 3, height: 9 }
        ]
      },
      expectIntent: 'spacecraft',
      expectCard: 'spec',
      expectSpecKind: 'spacecraft',
      mustHaveHint: true
    },
    {
      // 云端查不到编号时回落助推器家谱入口，不能空手
      q: 'B1067飞了几次',
      opts: {},
      expectIntent: 'booster',
      expectCard: 'entry',
      expectKind: 'booster_genealogy',
      mustHaveHint: true
    },
    {
      q: '年度回顾',
      opts: {},
      expectIntent: 'year_review',
      expectCard: 'entry',
      expectKind: 'year_review',
      mustHaveHint: true
    },
    {
      q: '最近有什么流星雨',
      opts: {},
      expectIntent: 'astro_calendar',
      expectCard: 'entry',
      expectKind: 'astro_calendar',
      mustHaveHint: true
    },
    {
      q: '最近有什么航天新闻',
      opts: {},
      expectIntent: 'news',
      expectCard: 'entry',
      expectKind: 'news',
      mustHaveHint: true
    },
    {
      q: '这次发射能成功吗',
      opts: { upcomingHint: fixtureLaunches },
      expectIntent: 'launch_vote',
      expectCard: 'entry',
      expectKind: 'launch_vote',
      mustHaveHint: true
    },
    {
      q: '今晚能看到星链吗',
      opts: {},
      expectIntent: 'starlink_pass',
      expectCard: 'entry',
      expectKind: 'starlink_pass',
      mustHaveHint: true
    },
    {
      // 有场次出火箭观礼入口卡；无场次只给诚实 focusHint（不注入静态观礼点）
      q: '去哪看火箭发射',
      opts: {},
      expectIntent: 'viewing_spot',
      expectCardOptional: true,
      expectKindIfCard: 'watch_party',
      mustHaveHint: true
    },
    {
      q: '看星舰发射去哪',
      opts: {},
      expectIntent: 'viewing_spot',
      expectCardOptional: true,
      expectKindIfCard: 'watch_party',
      mustHaveHint: true
    },
    {
      q: '酒泉能去现场看神舟发射吗',
      opts: {},
      expectIntent: 'viewing_spot',
      expectCardOptional: true,
      expectKindIfCard: 'watch_party',
      mustHaveHint: true
    },
    {
      q: '看看星链实时分布',
      opts: {},
      expectIntent: 'starlink_map',
      expectCard: 'entry',
      expectKind: 'starlink_map',
      mustHaveHint: true
    },
    {
      q: '阿尔忒弥斯任务进展',
      opts: {},
      expectIntent: 'artemis',
      expectCard: 'entry',
      expectKind: 'artemis',
      mustHaveHint: true
    },
    {
      q: 'S38在哪',
      opts: {
        hardwareHint: [
          {
            id: 338,
            name: 'Ship 38',
            status: 'Testing',
            statusZh: '测试中',
            type: 'Starship',
            typeZh: '星舰飞船',
            categoryZh: '在建',
            notesZh: '已完成低温测试'
          }
        ]
      },
      expectIntent: 'starship_hardware',
      expectCard: 'spec',
      expectSpecKind: 'starship_hardware',
      mustHaveHint: true
    },
    {
      // 硬件库为空时回落硬件列表入口
      q: '星舰硬件设施列表',
      opts: { hardwareHint: [] },
      expectIntent: 'starship_hardware',
      expectCard: 'entry',
      expectKind: 'starship_hardware',
      mustHaveHint: true
    },
    {
      q: '猎鹰9回收成功率',
      opts: {
        recoveryHint: {
          success: true,
          totalBoosters: 80,
          activeBoosters: 12,
          totalFlights: 520,
          totalLandings: 500,
          totalAttempts: 510,
          landingSuccessRate: '98.0%',
          topReused: [{ serial: 'B1067', flights: 30 }]
        }
      },
      expectIntent: 'recovery_stats',
      expectCard: 'spec',
      expectSpecKind: 'recovery_stats',
      mustHaveHint: true
    },
    {
      // 族谱聚合失败时回落家谱入口
      q: '助推器复用排行',
      opts: { recoveryHint: { success: false } },
      expectIntent: 'recovery_stats',
      expectCard: 'entry',
      expectKind: 'booster_genealogy',
      mustHaveHint: true
    },
    {
      q: '在哪看发射直播？',
      opts: {},
      expectIntent: 'live_watch',
      expectCard: 'entry',
      expectKind: 'live_watch',
      mustHaveHint: true
    },
    {
      // 光喊「直播」也要出卡，不依赖任何外部取数
      q: '直播',
      opts: {},
      expectIntent: 'live_watch',
      expectCard: 'entry',
      expectKind: 'live_watch',
      mustHaveHint: true
    }
  ]

  async function withTimeout(promise, ms, label) {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout ' + ms + 'ms: ' + label)), ms)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  for (const c of payloadCases) {
    let r
    try {
      r = await withTimeout(rich.resolveRichChatPayload(c.q, c.opts), 8000, c.q)
    } catch (e) {
      ok(false, 'payload「' + c.q + '」不抛错（' + e.message + '）')
      continue
    }
    ok(r.intent === c.expectIntent, 'payload intent「' + c.q + '」= ' + c.expectIntent)
    const card = (r.cards || [])[0]
    if (Array.isArray(c.expectCardAny)) {
      ok(!!card && c.expectCardAny.indexOf(card.cardType) >= 0,
        'payload 出卡「' + c.q + '」type∈' + c.expectCardAny.join('|') + ' (got ' + (card && card.cardType) + ')')
    } else if (c.expectCard) {
      ok(!!card && card.cardType === c.expectCard, 'payload 出卡「' + c.q + '」type=' + c.expectCard)
    } else if (c.expectCardOptional) {
      if (card) {
        ok(card.cardType === 'entry', 'payload 可选卡「' + c.q + '」应为入口卡')
        if (c.expectKindIfCard) {
          ok(card.entryKind === c.expectKindIfCard,
            'payload 可选卡 kind「' + c.q + '」= ' + c.expectKindIfCard)
        }
      }
    }
    if (c.expectKind) {
      ok(card && card.entryKind === c.expectKind, 'payload kind「' + c.q + '」= ' + c.expectKind)
    }
    if (c.expectSpecKind) {
      ok(card && card.specKind === c.expectSpecKind,
        'payload specKind「' + c.q + '」= ' + c.expectSpecKind + ' (got ' + (card && card.specKind) + ')')
      ok(card && Array.isArray(card.rows) && card.rows.length > 0,
        'payload 参数行非空「' + c.q + '」')
      ok(card && card.rows.every((r) => r && r.label && r.value !== '' && r.value != null),
        'payload 参数行无空值「' + c.q + '」')
      ok(card && !card.detailUrl, 'payload 参数卡不带 URL（跳转走白名单）「' + c.q + '」')
      const hint = (r.launchContext && r.launchContext.focusHint) || ''
      ok(!/未匹配|找不到|没有数据/.test(hint.replace(/禁止说[^。]*。/g, '')),
        'payload 参数卡提示不否定匹配「' + c.q + '」')
    }
    if (c.expectDetailType) {
      ok(card && card.detailType === c.expectDetailType,
        'payload detailType「' + c.q + '」= ' + c.expectDetailType + ' (got ' + (card && card.detailType) + ')')
    }
    if (c.expectCardId) {
      ok(card && String(card.id) === c.expectCardId,
        'payload 命中任务「' + c.q + '」= ' + c.expectCardId + ' (got ' + (card && card.id) + ')')
    }
    if (c.mustHaveHint) {
      ok(!!(r.launchContext && r.launchContext.focusHint), 'payload focusHint「' + c.q + '」')
    }
    if (card && card.detailUrl) {
      ok(pageExists(pages, card.detailUrl) || card.useSwitchTab, 'payload 路由可落点「' + c.q + '」')
    }
  }

  // ── 组合体编号取自硬件设施列表头两条 ──
  {
    const withHw = await rich.resolveRichChatPayload('星舰组合体最新进展如何？', {
      cachedStatus: { booster: { id: 'B14', status: '静态点火完成', progress: 80 }, ship: { id: 'S37', status: '低温测试中', progress: 60 } },
      hardwareHint: [
        { name: 'Ship 39', statusZh: '在建', status: 'Under Construction' },
        { name: 'Booster 18', statusZh: '测试中', status: 'Testing' },
        { name: 'Ship 40', statusZh: '在建', status: 'Under Construction' }
      ]
    })
    const c0 = (withHw.cards || [])[0]
    ok(c0 && c0.booster.id === 'Booster 18', '组合体 · 助推器名取硬件列表头两条 (got ' + (c0 && c0.booster.id) + ')')
    ok(c0 && c0.ship.id === 'Ship 39', '组合体 · 飞船名取硬件列表头两条 (got ' + (c0 && c0.ship.id) + ')')
    ok(c0 && c0.booster.progress === null && c0.ship.progress === null,
      '组合体 · 换代后不沿用旧进度')
    ok(c0 && c0.booster.status === '测试中' && c0.ship.status === '在建', '组合体 · 换代后用硬件表状态')
    ok(/Booster 18/.test(withHw.launchContext.focusHint || '') &&
      /Ship 39/.test(withHw.launchContext.focusHint || ''), '组合体 · 提示词同步新编号')

    // 编号一致时保留手工维护的进度与状态
    const same = await rich.resolveRichChatPayload('星舰组合体最新进展如何？', {
      cachedStatus: { booster: { id: 'B18', status: '静态点火完成', progress: 80 }, ship: { id: 'S39', status: '低温测试中', progress: 60 } },
      hardwareHint: [
        { name: 'Ship 39', statusZh: '在建' },
        { name: 'Booster 18', statusZh: '测试中' }
      ]
    })
    const c1 = (same.cards || [])[0]
    ok(c1 && c1.booster.progress === 80 && c1.ship.progress === 60, '组合体 · 同一单元保留进度')
    ok(c1 && c1.booster.status === '静态点火完成', '组合体 · 同一单元保留手工状态')
  }

  // ── 火箭型号：中文序数「号」不能挡住匹配 ──
  {
    const cfgs = {
      1: { id: 1, name: 'Falcon 9', full_name: 'Falcon 9 Block 5', total_launch_count: 400 },
      2: { id: 2, name: 'Falcon Heavy', full_name: 'Falcon Heavy', total_launch_count: 11 },
      3: { id: 3, name: 'Long March 5', full_name: 'Long March 5', total_launch_count: 20 }
    }
    ;[['猎鹰9号参数', 'Falcon 9'], ['猎鹰9号多高', 'Falcon 9'], ['猎鹰九号运力', 'Falcon 9'],
      ['猎鹰9参数', 'Falcon 9'], ['长征五号参数', 'Long March 5'], ['猎鹰重型参数', 'Falcon Heavy']]
      .forEach(([q, expect]) => {
        const hit = core.pickRocketConfig(cfgs, core.extractRocketModelKey(q))
        ok(hit && hit.config.name === expect,
          '火箭型号「' + q + '」→ ' + expect + ' (got ' + (hit && hit.config.name) + ')')
      })
  }

  // ── 观礼：统一走火箭观礼入口卡（静态观礼点导航表已下线） ──
  {
    const spotsPath = path.join(root, 'subpackages/shared/utils/viewing-spots.js')
    ok(!fs.existsSync(spotsPath), '观礼 · 静态观礼点表已移除（避免无依赖进包）')

    const cn = await rich.resolveRichChatPayload('文昌观礼点推荐', {})
    ok(cn.intent === 'viewing_spot', '观礼 · 文昌命中观礼意图')
    if (cn.cards && cn.cards.length) {
      ok(cn.cards.length === 1 && cn.cards[0].cardType === 'entry' &&
        cn.cards[0].entryKind === 'watch_party', '观礼 · 有场次时出火箭观礼入口卡')
      ok(/进入观礼/.test(cn.cards[0].cta || ''), '观礼 · CTA 进入观礼服务')
      ok(!(cn.cards[0].nav), '观礼 · 入口卡不带静态导航坐标')
    } else {
      ok(!!(cn.launchContext && /暂未开放|已结束/.test(cn.launchContext.focusHint || '')),
        '观礼 · 无场次时诚实说明未开放')
    }

    const jq = await rich.resolveRichChatPayload('酒泉能去现场看神舟发射吗', {})
    ok(jq.intent === 'viewing_spot', '观礼 · 管控发射场仍命中观礼意图')
    ok(!(jq.cards || []).some((c) => c && c.nav), '观礼 · 不再注入静态观礼点导航坐标')
  }

  // 无数据时仍不抛 + 给提示
  const emptyNext = await rich.resolveRichChatPayload('星舰下一次试飞是什么时候？', {})
  ok(emptyNext.intent === 'starship_next', '空数据仍识别下一飞')
  ok(Array.isArray(emptyNext.cards) && emptyNext.cards.length === 0, '空数据不出伪任务卡')
  ok(!!(emptyNext.launchContext && /暂无|尚未|暂未/.test(emptyNext.launchContext.focusHint || '')), '空数据 focusHint 诚实')

  // ── 6. 内容卡字段完备 ──
  const missionPayload = await rich.resolveRichChatPayload('星舰下一次试飞是什么时候？', {
    cached: fixtureMission
  })
  const mc = missionPayload.cards[0]
  ;['id', 'name', 'detailType', 'detailUrl', 'formattedTime', 'statusText'].forEach((f) => {
    ok(mc && mc[f] != null && mc[f] !== '', 'mission 字段 ' + f)
  })
  ok(pageExists(pages, mc && mc.detailUrl), 'mission detailUrl 在 app.json')

  const listPayload = await rich.resolveRichChatPayload('接下来有哪些发射？', {
    upcomingHint: fixtureLaunches,
    limit: 5
  })
  const lc = listPayload.cards[0]
  ok(lc && Array.isArray(lc.items) && lc.items.length >= 2, 'launch_list items≥2')
  ok(!!lc && Array.isArray(lc.items) && lc.items.every((it) => it.id && it.name && it.detailUrl),
    'launch_list 行字段完备')

  const stPayload = await rich.resolveRichChatPayload('星舰最新进展如何？', {
    cachedStatus: fixtureStatus
  })
  const sc = stPayload.cards[0]
  ok(sc && sc.booster && sc.booster.id === 'B15', 'status booster')
  ok(sc && sc.ship && sc.ship.id === 'S38', 'status ship')
  ok(sc && sc.checklist && sc.checklist.done === 2 && sc.checklist.total === 3, 'status checklist')

  // ── 7. 空间站挑站 ──
  const stations = [
    { id: 4, name: '国际空间站 ISS' },
    { id: 18, name: '天宫空间站' }
  ]
  ok(core.pickStation(stations, '天宫乘组').id === 18, 'pick 天宫')
  ok(core.pickStation(stations, 'ISS').id === 4, 'pick ISS')
  ok(core.pickStation(stations, '空间站').id === 4, 'pick 默认首项')

  const stationCard = await rich.resolveStationEntryCard({ queryText: '天宫实时状态' })
  ok(stationCard.card && stationCard.card.entryKind === 'station', 'station resolve 出卡')
  if (stationCard.card.stationId) {
    ok(pageExists(pages, stationCard.card.detailUrl), 'station detail 可落点')
  } else {
    ok(stationCard.card.useSwitchTab === true, 'station 无数据时 switchTab')
    ok(stationCard.card.detailUrl === ROUTES.MONITOR, 'station 回落 MONITOR')
  }

  // ── 8. UI / 跳转接线（静态源码） ──
  const chatJs = read('subpackages/shared/components/ai-chat/index.js')
  const chatWxml = read('subpackages/shared/components/ai-chat/index.wxml')
  const chatWxss = read('subpackages/shared/components/ai-chat/index.wxss')
  const hostJs = read('subpackages/shared/ai-chat.js')

  ok(chatWxml.includes('ai-shortcut-scroll') && chatWxml.includes('quickShortcuts'), 'wxml 横向快捷栏')
  ok(chatWxml.includes('adjust-position="{{false}}"'), 'wxml adjust-position=false')
  ok(chatJs.includes('virtualHost: true'), 'virtualHost 撑满')
  ok(chatJs.includes("triggerEvent('keyboardheight'") || chatJs.includes('triggerEvent("keyboardheight"'), '键盘高度事件上抛')
  ok(hostJs.includes('onKeyboardHeight') && hostJs.includes('keyboardHeight'), '宿主页接收键盘高度')

  ;['flight_demo', 'mission_sim', 'vehicle_tracker', 'road_closure', 'station', 'starship_progress',
    'live_watch'].forEach((kind) => {
    ok(chatJs.includes("kind === '" + kind + "'") || chatJs.includes('kind === "' + kind + '"'),
      'onEntryCardTap 处理 ' + kind)
  })
  ok(chatWxml.includes('data-needlive'), 'wxml 透传 needLiveFlag')
  ok(chatJs.includes('isLiveEntryAllowed') && chatJs.includes('needLive'), '直播卡受过审开关门控')
  ok(chatWxss.includes('.ai-entry-card--live'), '直播卡配色存在')
  ok(chatJs.includes('resolveRichChatPayload'), '发送链路调 resolveRichChatPayload')
  ok(chatJs.includes('completedHint'), '发送链路带 completedHint')
  ok(chatJs.includes('gateCheck'), '入口卡门控 gateCheck')
  ok(chatJs.includes("isFeatureEnabled('enableMissionSim'"), 'enableMissionSim 开关')
  ok(chatJs.includes('_navigateAwayFromChat') && chatJs.includes('switchTab'), 'navigate + switchTab')
  ok(chatWxml.includes("card.cardType === 'entry'"), 'wxml entry 分支')
  ok(chatWxml.includes("card.cardType === 'launch_list'"), 'wxml launch_list 分支')
  ok(chatWxml.includes("card.cardType === 'starship_status'"), 'wxml starship_status 分支')
  ok(chatWxml.includes("card.cardType === 'launch_stats'"), 'wxml launch_stats 分支')
  ok(chatWxml.includes("card.cardType === 'agency'"), 'wxml agency 分支')
  ok(chatWxml.includes("card.cardType === 'mission_replay'"), 'wxml mission_replay 分支')
  ok(chatWxml.includes('onMissionReplayCardTap'), 'wxml 回放卡点击')
  ok(chatWxml.includes('onLaunchStatsCardTap'), 'wxml 统计卡点击')
  ok(chatWxml.includes('onAgencyCardTap'), 'wxml 发射商卡点击')
  ok(chatJs.includes('onLaunchStatsCardTap'), 'js 统计卡跳转')
  ok(chatJs.includes('onAgencyCardTap'), 'js 发射商卡跳转')
  ok(chatJs.includes('onMissionReplayCardTap'), 'js 回放卡跳转')
  ok(chatJs.includes('pendingEventVideo') && chatJs.includes('VIDEO_PLAYER'), 'js 回放进播放页')
  ok(chatJs.includes("enableMissionReplay"), 'js 回放过审开关')
  ok(chatJs.includes('GLOBAL_LAUNCH_STATS') || chatJs.includes("global_launch_stats"), 'js 统计路由/门控')
  ok(chatJs.includes('AGENCY_DETAIL') || chatJs.includes('agency_encyclopedia'), 'js 发射商路由/门控')
  ok(chatWxml.includes("card.cardType === 'spec'"), 'wxml spec 参数卡分支')
  ok(chatWxml.includes('onSpecCardTap') && chatWxml.includes('data-targetid'), 'wxml 参数卡点击 + targetId')
  ok(chatWxml.includes('ai-spec-rows') && chatWxml.includes('spec.label'), 'wxml 参数行渲染')
  ok(chatJs.includes('onSpecCardTap') && chatJs.includes('SPEC_ROUTE_MAP'), 'js 参数卡跳转走白名单')
  ;['rocket_model', 'launch_site', 'spacecraft', 'booster', 'apod',
    'starship_hardware', 'recovery_stats'].forEach((kind) => {
    ok(new RegExp('\\b' + kind + ':\\s*\\{').test(chatJs), 'SPEC_ROUTE_MAP 含 ' + kind)
  })
  ;['booster_genealogy', 'launch_vote', 'year_review', 'astro_calendar', 'news',
    'starlink_pass', 'starlink_map', 'artemis', 'starship_hardware', 'watch_party'].forEach((kind) => {
    ok(chatJs.includes("kind === '" + kind + "'"), 'onEntryCardTap 处理 ' + kind)
  })
  ;['wiki', 'site', 'craft', 'booster', 'apod', 'hardware'].forEach((v) => {
    ok(chatWxss.includes('ai-spec-card--' + v), 'wxss spec variant ' + v)
  })
  ok(/kind === 'viewing_spot'[\s\S]{0,400}watch-party/.test(chatJs),
    'js 旧观礼卡兼容跳转火箭观礼')
  ;['booster', 'vote', 'review', 'astro', 'news', 'starlink', 'artemis', 'hardware', 'watch'].forEach((v) => {
    ok(chatWxss.includes('ai-entry-card--' + v), 'wxss entry variant ' + v)
  })
  ok(chatWxml.includes('wx:else') && chatWxml.includes('onMissionCardTap'), 'wxml mission 默认分支')
  ok(chatWxml.includes('data-stationid'), 'wxml stationId dataset')
  ok(!chatWxml.includes('data-url='), '禁用 data-url')
  ;['demo', 'tracker', 'sim', 'road', 'station'].forEach((v) => {
    ok(chatWxss.includes('ai-entry-card--' + v), 'wxss variant ' + v)
  })
  ok(chatWxss.includes('ai-stats-numbers'), 'wxss 统计数字区')
  ok(chatWxss.includes('ai-agency-card') || chatWxss.includes('ai-agency-row'), 'wxss 发射商卡')
  ok(chatWxss.includes('.ai-replay-card') && chatWxss.includes('.ai-replay-poster'), 'wxss 回放卡')

  // ── 9. ROUTES 常量覆盖 ──
  ok(!!ROUTES.ROAD_CLOSURE_DETAIL && pageExists(pages, ROUTES.ROAD_CLOSURE_DETAIL), 'ROUTES 封路详情')
  ok(!!ROUTES.STATION_DETAIL && pageExists(pages, ROUTES.STATION_DETAIL), 'ROUTES 空间站详情')
  ok(!!ROUTES.VEHICLE_TRACKER && pageExists(pages, ROUTES.VEHICLE_TRACKER), 'ROUTES 在轨追踪')
  ok(!!ROUTES.GLOBAL_LAUNCH_STATS && pageExists(pages, ROUTES.GLOBAL_LAUNCH_STATS), 'ROUTES 全球发射统计')
  ok(!!ROUTES.AGENCY_DETAIL && pageExists(pages, ROUTES.AGENCY_DETAIL), 'ROUTES 发射商详情')
  ok(!!ROUTES.MONITOR && pageExists(pages, ROUTES.MONITOR), 'ROUTES 监控 Tab')
  ok(!!ROUTES.PROGRESS && pageExists(pages, ROUTES.PROGRESS), 'ROUTES 进度 Tab')
  ok(!!ROUTES.ROCKET_MODEL_DETAIL && pageExists(pages, ROUTES.ROCKET_MODEL_DETAIL), 'ROUTES 火箭型号详情')
  ok(!!ROUTES.LAUNCH_SITE_DETAIL && pageExists(pages, ROUTES.LAUNCH_SITE_DETAIL), 'ROUTES 发射场详情')
  ok(!!ROUTES.SPACECRAFT_DETAIL && pageExists(pages, ROUTES.SPACECRAFT_DETAIL), 'ROUTES 飞船详情')
  ok(!!ROUTES.BOOSTER_DETAIL && pageExists(pages, ROUTES.BOOSTER_DETAIL), 'ROUTES 助推器详情')
  ok(!!ROUTES.BOOSTER_GENEALOGY && pageExists(pages, ROUTES.BOOSTER_GENEALOGY), 'ROUTES 助推器家谱')
  ok(!!ROUTES.YEAR_REVIEW && pageExists(pages, ROUTES.YEAR_REVIEW), 'ROUTES 年度回顾')
  ok(!!ROUTES.ASTRO_CALENDAR && pageExists(pages, ROUTES.ASTRO_CALENDAR), 'ROUTES 天象日历')
  ok(!!ROUTES.NEWS && pageExists(pages, ROUTES.NEWS), 'ROUTES 事件 Tab')
  ok(!!ROUTES.HARDWARE_LIST && pageExists(pages, ROUTES.HARDWARE_LIST), 'ROUTES 星舰硬件列表')
  ok(!!ROUTES.HARDWARE_DETAIL && pageExists(pages, ROUTES.HARDWARE_DETAIL), 'ROUTES 星舰硬件详情')
  ok(!!ROUTES.ARTEMIS_DETAIL && pageExists(pages, ROUTES.ARTEMIS_DETAIL), 'ROUTES Artemis 面板')
  ok(!!ROUTES.MONITOR && pageExists(pages, ROUTES.MONITOR), 'ROUTES 监控中心 Tab')
  ok(pageExists(pages, '/subpackages/mission-sim/flight-demo'), 'flight-demo 分包页')
  ok(pageExists(pages, '/subpackages/mission-sim/mission-sim'), 'mission-sim 分包页')

  // ── 汇总 ──
  console.log('\n---')
  console.log('passed:', passed, 'failed:', failed)
  if (failed) {
    console.error('\n' + failed + ' failed — runtime audit RED')
    process.exit(1)
  }
  console.log('\nall green: deep runtime audit passed')
}

main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e)
  process.exit(1)
})
