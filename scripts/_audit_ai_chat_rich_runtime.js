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
    'enrichLaunchContextWithMissionReplay'
  ]
  coreExports.forEach((k) => ok(typeof core[k] === 'function', 'core export ' + k))

  const richExports = [
    'resolveRichChatPayload', 'resolveFlightDemoEntryCard', 'resolveMissionSimEntryCard',
    'resolveVehicleTrackerEntryCard', 'resolveRoadClosureEntryCard', 'resolveStationEntryCard',
    'resolveStarshipNextFlightCard', 'resolveLaunchListCard', 'resolveStarshipStatusCard',
    'resolveMissionLookupCard', 'resolveMissionReplayCard', 'resolveStarshipProgressEntryCard',
    'resolveLaunchStatsCard', 'resolveAgencyLookupCard',
    'matchRoadClosureIntent', 'matchStationIntent', 'matchMissionLookupIntent', 'matchLaunchStatsIntent',
    'matchAgencyIntent', 'matchMissionReplayIntent'
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
    ['猎鹰9号', 'mission_lookup'],
    ['引力一号的回放视频', 'mission_replay'],
    ['看看长征七号回放集锦', 'mission_replay'],
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
  ok(core.resolveAiChatRichIntent('空间站在轨飞行器追踪') !== 'station' ||
    core.resolveAiChatRichIntent('打开在轨飞行器追踪') === 'vehicle_tracker', 'tracker 不被空间站误伤')

  // ── 3. 快捷问题全部可路由到意图 ──
  const svc = read('subpackages/shared/utils/aiService.js')
  const quickMatch = svc.match(/const QUICK_QUESTIONS = \[([\s\S]*?)\]/)
  ok(!!quickMatch, 'QUICK_QUESTIONS 可解析')
  const quicks = []
  if (quickMatch) {
    const re = /'([^']+)'/g
    let m
    while ((m = re.exec(quickMatch[1]))) quicks.push(m[1])
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
    let m
    while ((m = re.exec(scMatch[1]))) shortcutQs.push(m[1])
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
      launchTime: '2026-08-01T12:00:00Z'
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

  const road = rich.resolveRoadClosureEntryCard()
  ok(road.card.entryKind === 'road_closure' && !road.card.needMissionSimFlag, 'road 载荷')
  ok(road.card.detailUrl === ROUTES.ROAD_CLOSURE_DETAIL, 'road 对齐 ROUTES')
  ok(pageExists(pages, road.card.detailUrl), 'road 页在 app.json')

  // ── 5. resolveRichChatPayload 全意图（fixture） ──
  const fixtureMission = {
    id: 'ss-10',
    name: 'Starship Flight 10',
    rocketName: 'Starship',
    launchTime: '2026-08-01T12:00:00Z',
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
      launchTime: '2026-08-02T00:00:00Z',
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
            launchTime: '2026-09-01T00:00:00Z',
            statusBadgeText: 'TBD',
            padLocation: 'Jiuquan'
          }
        ]
      },
      expectIntent: 'mission_lookup',
      expectCard: 'mission',
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
    } else {
      ok(!!card && card.cardType === c.expectCard, 'payload 出卡「' + c.q + '」type=' + c.expectCard)
    }
    if (c.expectKind) {
      ok(card && card.entryKind === c.expectKind, 'payload kind「' + c.q + '」= ' + c.expectKind)
    }
    if (c.mustHaveHint) {
      ok(!!(r.launchContext && r.launchContext.focusHint), 'payload focusHint「' + c.q + '」')
    }
    if (card && card.detailUrl) {
      ok(pageExists(pages, card.detailUrl) || card.useSwitchTab, 'payload 路由可落点「' + c.q + '」')
    }
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
  ok(lc.items.every((it) => it.id && it.name && it.detailUrl), 'launch_list 行字段完备')

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

  ;['flight_demo', 'mission_sim', 'vehicle_tracker', 'road_closure', 'station', 'starship_progress'].forEach((kind) => {
    ok(chatJs.includes("kind === '" + kind + "'") || chatJs.includes('kind === "' + kind + '"'),
      'onEntryCardTap 处理 ' + kind)
  })
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
