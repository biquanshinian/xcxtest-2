/**
 * node --test test/index-countdown-boot.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  slimMissionForCountdownBoot,
  slimLangPackForCountdownBoot,
  parseCountdownBootPayload,
  normalizeBootMissionList,
  pickCountdownBootPanelMission,
  waitRecentSettledHydrateForBoot,
  methods,
  COUNTDOWN_BOOT_TTL_MS,
  COUNTDOWN_BOOT_LIST_MAX
} = require('../pages/index/utils/index-countdown-boot.js')

test('slimMissionForCountdownBoot：保留倒计时必要字段，丢掉无关大对象', () => {
  const slim = slimMissionForCountdownBoot({
    id: 'abc',
    missionName: 'Starlink',
    rocketName: 'Falcon 9',
    launchTime: '2099-01-01T00:00:00Z',
    previousNet: '2098-12-31T00:00:00Z',
    rocketImage: 'https://cdn.example/f9.png',
    launchAgencyId: 121,
    rocketConfigId: 164,
    padLocationId: 12,
    launchSite: 'Cape Canaveral',
    boosterInfo: { serial: 'B1095', huge: true },
    landing: { type: 'ASDS' }
  })
  assert.equal(slim.id, 'abc')
  assert.equal(slim.rocketName, 'Falcon 9')
  assert.equal(slim.launchTime, '2099-01-01T00:00:00Z')
  assert.equal(slim.previousNet, '2098-12-31T00:00:00Z')
  assert.equal(slim.rocketImage, 'https://cdn.example/f9.png')
  assert.equal(slim.launchAgencyId, 121)
  assert.equal(slim.rocketConfigId, 164)
  assert.equal(slim.padLocationId, 12)
  assert.equal(slim.launchSite, 'Cape Canaveral')
  assert.equal(slim.boosterInfo, undefined)
  assert.equal(slim.landing, undefined)
})

test('slimMissionForCountdownBoot：无 id 丢弃', () => {
  assert.equal(slimMissionForCountdownBoot({ missionName: 'x' }), null)
})

test('parseCountdownBootPayload：过期 / 空 / 未来时间戳都不可用', () => {
  const now = 1_700_000_000_000
  assert.equal(parseCountdownBootPayload(null, now), null)
  assert.equal(parseCountdownBootPayload({ list: [], at: now }, now), null)
  assert.equal(
    parseCountdownBootPayload(
      { list: [{ id: 'a' }], at: now - COUNTDOWN_BOOT_TTL_MS - 1 },
      now
    ),
    null
  )
  assert.equal(
    parseCountdownBootPayload({ list: [{ id: 'a' }], at: now + 120000 }, now),
    null
  )
})

test('parseCountdownBootPayload：有效期内返回列表', () => {
  const now = 1_700_000_000_000
  const list = parseCountdownBootPayload(
    { list: [{ id: 'a' }, { id: null }, { id: 'b' }], at: now - 1000 },
    now
  )
  assert.deepEqual(
    list.map((m) => m.id),
    ['a', 'b']
  )
  assert.ok(COUNTDOWN_BOOT_LIST_MAX >= 5)
})

test('引导快照存活跨过隔天/隔周打开（24h 太短，隔天必吃空面板）', () => {
  assert.ok(COUNTDOWN_BOOT_TTL_MS >= 48 * 60 * 60 * 1000)
  const now = 1_700_000_000_000
  const twoDaysAgo = now - 48 * 60 * 60 * 1000
  const list = parseCountdownBootPayload({ list: [{ id: 'a' }], at: twoDaysAgo }, now)
  assert.ok(list && list.length === 1)
})

function makeBootPage(overrides) {
  const page = {
    data: { missionType: 'upcoming', launchData: null },
    applied: null,
    hydrateCalls: 0,
    _isLaunchStateGenerationCurrent: () => true,
    _hydrateCountdownBootFromStorage() {
      page.hydrateCalls += 1
      return Promise.resolve(null)
    },
    _applyInitialUpcomingLaunchStateSync(first, head) {
      page.applied = { first, head }
    }
  }
  return Object.assign(page, overrides || {})
}

test('_paintCountdownFromBootCache：同步源命中就同帧出卡，不为异步 storage 让一拍', () => {
  const page = makeBootPage({
    _resolveCountdownBootList: () => [{ id: 'a' }, { id: 'b' }]
  })
  const pending = methods._paintCountdownFromBootCache.call(page, 1)
  // 关键断言：promise 还没被 await，面板已经提交（函数在首个 await 之前完成）
  assert.ok(page.applied, '同步源命中时不应先 await 异步 hydrate')
  assert.equal(page.applied.first.id, 'a')
  assert.equal(page.hydrateCalls, 0)
  return pending.then((ok) => assert.equal(ok, true))
})

test('_paintCountdownFromBootCache：同步源全空时才回落等 storage', async () => {
  let calls = 0
  const page = makeBootPage({
    _resolveCountdownBootList: () => {
      calls += 1
      return calls === 1 ? [] : [{ id: 'late' }]
    }
  })
  const painted = await methods._paintCountdownFromBootCache.call(page, 1)
  assert.equal(page.hydrateCalls, 1)
  assert.equal(painted, true)
  assert.equal(page.applied.first.id, 'late')
})

test('slimMissionForCountdownBoot：保留精简 _langPack，丢掉无关键', () => {
  const slim = slimMissionForCountdownBoot({
    id: 'abc',
    rocketName: '猎鹰9号',
    missionName: '星链组 10-19',
    launchTime: '2099-01-01T00:00:00Z',
    _langPack: {
      rocketNameEn: 'Falcon 9',
      rocketNameZh: '猎鹰9号',
      missionNameEn: 'Starlink Group 10-19',
      missionNameZh: '星链组 10-19',
      nameEn: 'Falcon 9 | Starlink Group 10-19',
      nameZh: '猎鹰9号 | 星链组 10-19',
      launchSiteEn: 'Kennedy Space Center',
      launchSiteZh: '肯尼迪航天中心',
      launchAgencyEn: 'SpaceX',
      launchAgencyZh: '太空探索技术公司',
      unusedBig: { nested: true }
    },
    boosterInfo: { huge: true }
  })
  assert.ok(slim._langPack)
  assert.equal(slim._langPack.rocketNameEn, 'Falcon 9')
  assert.equal(slim._langPack.rocketNameZh, '猎鹰9号')
  assert.equal(slim._langPack.launchAgencyEn, 'SpaceX')
  assert.equal(slim._langPack.unusedBig, undefined)
  assert.equal(slim.boosterInfo, undefined)
  assert.equal(slimLangPackForCountdownBoot(null), null)
})

test('中文-only boot 瘦对象回放不得洗成未知', () => {
  const { setContentLangMem } = require('../utils/locale.js')
  const { isPlaceholderMissionField } = require('../utils/mission-list-card.js')
  setContentLangMem('zh')
  const [n] = normalizeBootMissionList([{
    id: 'abc',
    name: '猎鹰9号 | 星链组 10-19',
    missionName: '星链组 10-19',
    rocketName: '猎鹰9号',
    launchSite: 'LC-39A, 肯尼迪航天中心',
    launchAgency: '太空探索技术公司',
    launchTime: '2099-01-01T00:00:00Z',
    rocketConfiguration: { id: 164, name: 'Falcon 9', full_name: 'Falcon 9 Block 5' }
  }])
  assert.equal(isPlaceholderMissionField(n.rocketName), false)
  assert.equal(isPlaceholderMissionField(n.missionName), false)
  assert.equal(isPlaceholderMissionField(n.launchSite), false)
  assert.equal(isPlaceholderMissionField(n.launchAgency), false)
  assert.match(n.rocketName, /猎鹰/)
  assert.match(n.missionName, /星链/)
  assert.match(n.launchSite, /肯尼迪/)
  assert.match(n.launchAgency, /太空探索/)
  assert.equal(/[\u4e00-\u9fff]/.test(n._langPack.rocketNameEn), false)
  assert.equal(/[\u4e00-\u9fff]/.test(n._langPack.missionNameEn), false)
})

test('发射商 SpaceX、其余中文时火箭/任务/地点不被洗掉', () => {
  const { setContentLangMem } = require('../utils/locale.js')
  const { isPlaceholderMissionField } = require('../utils/mission-list-card.js')
  setContentLangMem('zh')
  const [n] = normalizeBootMissionList([{
    id: 'abc',
    name: '猎鹰9号 | 星链组 10-19',
    missionName: '星链组 10-19',
    rocketName: '猎鹰9号',
    launchSite: '肯尼迪航天中心',
    launchAgency: 'SpaceX',
    launchTime: '2099-01-01T00:00:00Z',
    rocketConfiguration: { id: 164, name: 'Falcon 9', full_name: 'Falcon 9 Block 5' }
  }])
  assert.equal(isPlaceholderMissionField(n.rocketName), false)
  assert.equal(isPlaceholderMissionField(n.missionName), false)
  assert.equal(isPlaceholderMissionField(n.launchSite), false)
  assert.match(n.rocketName, /猎鹰/)
  assert.match(n.missionName, /星链/)
  assert.match(n.launchSite, /肯尼迪/)
  assert.ok(n.launchAgency && !isPlaceholderMissionField(n.launchAgency))
})

test('持久化 _langPack 后再读回，中英文切换不丢字段', () => {
  const { applyContentLangToMission } = require('../utils/launch-card-i18n.js')
  const { setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  const mapped = applyContentLangToMission({
    id: 'abc',
    name: 'Falcon 9 | Starlink Group 10-19',
    missionName: 'Starlink Group 10-19',
    rocketName: 'Falcon 9',
    launchSite: 'Kennedy Space Center',
    launchAgency: 'SpaceX',
    launchTime: '2099-01-01T00:00:00Z',
    rocketConfiguration: { id: 164, name: 'Falcon 9', full_name: 'Falcon 9 Block 5' },
    _langPack: {
      rocketNameEn: 'Falcon 9',
      rocketNameZh: '猎鹰9号',
      missionNameEn: 'Starlink Group 10-19',
      missionNameZh: '星链组 10-19',
      nameEn: 'Falcon 9 | Starlink Group 10-19',
      nameZh: '猎鹰9号 | 星链组 10-19',
      launchSiteEn: 'Kennedy Space Center',
      launchSiteZh: '肯尼迪航天中心',
      launchAgencyEn: 'SpaceX',
      launchAgencyZh: '太空探索技术公司'
    }
  })
  const slim = slimMissionForCountdownBoot(mapped)
  assert.ok(slim._langPack)
  assert.equal(slim._langPack.rocketNameEn, 'Falcon 9')
  const [replay] = normalizeBootMissionList([slim])
  assert.match(replay.rocketName, /猎鹰/)
  assert.match(replay.missionName, /星链/)
  setContentLangMem('en')
  const en = applyContentLangToMission(Object.assign({}, replay))
  assert.match(en.rocketName, /Falcon/)
  assert.match(en.missionName, /Starlink/)
  setContentLangMem('zh')
  const zh = applyContentLangToMission(Object.assign({}, en))
  assert.match(zh.rocketName, /猎鹰/)
  assert.match(zh.missionName, /星链/)
})

test('同 id 早退：弱身份/默认图必须重画，完整面板保持', () => {
  const { shouldRebuildSameIdCountdownPanel } = require('../utils/index-launch-state.js')
  assert.equal(
    shouldRebuildSameIdCountdownPanel(
      {
        id: 'a',
        rocketName: '未知火箭',
        missionName: '未知任务',
        launchSite: '未知地点',
        launchTime: '2099-01-01T00:00:00Z',
        rocketImage: 'https://cdn.example/火箭配置图/default.jpg'
      },
      {
        id: 'a',
        rocketName: '猎鹰9号',
        missionName: '星链组 10-19',
        launchSite: '肯尼迪航天中心',
        rocketImage: 'https://cdn.example/f9.jpg'
      }
    ),
    true
  )
  assert.equal(
    shouldRebuildSameIdCountdownPanel(
      {
        id: 'a',
        rocketName: '猎鹰9号',
        missionName: '星链组 10-19',
        launchSite: '肯尼迪航天中心',
        rocketImage: 'https://cdn.example/f9.jpg'
      },
      {
        id: 'a',
        rocketName: '猎鹰9号',
        missionName: '星链组 10-19',
        launchSite: '肯尼迪航天中心',
        rocketImage: 'https://cdn.example/f9.jpg'
      }
    ),
    false
  )
})

test('pickCountdownBootPanelMission：过窗未决头条让位给下一发未来 NET', () => {
  const now = Date.now()
  const picked = pickCountdownBootPanelMission(
    [
      {
        id: 'old',
        launchTime: new Date(now - 2 * 3600 * 1000).toISOString(),
        windowEnd: new Date(now - 90 * 60 * 1000).toISOString(),
        statusId: 1
      },
      {
        id: 'next',
        launchTime: new Date(now + 3600 * 1000).toISOString(),
        statusId: 1
      }
    ],
    { _launchRecordsById: new Map() }
  )
  assert.equal(picked && picked.id, 'next')
})

test('pickCountdownBootPanelMission：权威终态覆盖残留 Go，选下一发', () => {
  const now = Date.now()
  const picked = pickCountdownBootPanelMission(
    [
      {
        id: 'old',
        launchTime: new Date(now - 10 * 60 * 1000).toISOString(),
        windowEnd: new Date(now + 20 * 60 * 1000).toISOString(),
        statusId: 1
      },
      {
        id: 'next',
        launchTime: new Date(now + 3600 * 1000).toISOString(),
        statusId: 1
      }
    ],
    {
      _launchRecordsById: new Map([
        ['old', { id: 'old', status: { id: 3, name: 'Launch Successful' } }]
      ])
    }
  )
  assert.equal(picked && picked.id, 'next')
})

test('pickCountdownBootPanelMission：全部已落库时不回落 list[0]', () => {
  const now = Date.now()
  const picked = pickCountdownBootPanelMission(
    [
      {
        id: 'old',
        launchTime: new Date(now - 10 * 60 * 1000).toISOString(),
        statusId: 1
      }
    ],
    {
      _launchRecordsById: new Map([
        ['old', { id: 'old', status: { id: 3, name: 'Launch Successful' } }]
      ])
    }
  )
  assert.equal(picked, null)
})

test('waitRecentSettledHydrateForBoot：已回灌 / 无承诺不返回等待', () => {
  assert.equal(waitRecentSettledHydrateForBoot({ _recentSettledHydrateDone: true }), null)
  assert.equal(waitRecentSettledHydrateForBoot({ _launchRecordsById: new Map([['a', {}]]) }), null)
  assert.equal(waitRecentSettledHydrateForBoot({}), null)
})

test('_paintCountdownFromBootCache：按状态机选面板，不用 list[0]', () => {
  const now = Date.now()
  const page = makeBootPage({
    _resolveCountdownBootList: () => [
      {
        id: 'old',
        launchTime: new Date(now - 2 * 3600 * 1000).toISOString(),
        windowEnd: new Date(now - 90 * 60 * 1000).toISOString(),
        statusId: 1
      },
      {
        id: 'next',
        launchTime: new Date(now + 3600 * 1000).toISOString(),
        statusId: 1
      }
    ]
  })
  const pending = methods._paintCountdownFromBootCache.call(page, 1)
  assert.ok(page.applied, '无落库等待时应同帧出卡')
  assert.equal(page.applied.first.id, 'next')
  return pending.then((ok) => assert.equal(ok, true))
})

test('_paintCountdownFromBootCache：等落库快照回灌后再画，避免先画已结算', async () => {
  const now = Date.now()
  let resolveHydrate
  const page = makeBootPage({
    _recentSettledHydrateDone: false,
    _recentSettledHydratePromise: new Promise((resolve) => {
      resolveHydrate = resolve
    }),
    _launchRecordsById: new Map(),
    _resolveCountdownBootList() {
      const ids = new Set()
      page._launchRecordsById.forEach((record, id) => {
        if (record && record.status && Number(record.status.id) === 3) ids.add(String(id))
      })
      return [
        {
          id: 'old',
          launchTime: new Date(now - 10 * 60 * 1000).toISOString(),
          windowEnd: new Date(now + 20 * 60 * 1000).toISOString(),
          statusId: 1
        },
        {
          id: 'next',
          launchTime: new Date(now + 3600 * 1000).toISOString(),
          statusId: 1
        }
      ].filter((m) => !ids.has(String(m.id)))
    }
  })
  const pending = methods._paintCountdownFromBootCache.call(page, 1)
  assert.equal(page.applied, null, '落库快照未回灌时不应先画出旧任务')
  page._launchRecordsById.set('old', { id: 'old', status: { id: 3, name: 'Launch Successful' } })
  page._recentSettledHydrateDone = true
  resolveHydrate()
  assert.equal(await pending, true)
  assert.equal(page.applied.first.id, 'next')
})

test('_paintCountdownFromBootCache：已有倒计时 / 非即将发射页签都不重画', async () => {
  const hasPanel = makeBootPage({
    data: { missionType: 'upcoming', launchData: { id: 'x' } },
    _resolveCountdownBootList: () => [{ id: 'a' }]
  })
  assert.equal(await methods._paintCountdownFromBootCache.call(hasPanel, 1), false)
  const otherTab = makeBootPage({
    data: { missionType: 'completed', launchData: null },
    _resolveCountdownBootList: () => [{ id: 'a' }]
  })
  assert.equal(await methods._paintCountdownFromBootCache.call(otherTab, 1), false)
})
