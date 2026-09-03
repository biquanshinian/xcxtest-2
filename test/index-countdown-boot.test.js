/**
 * node --test test/index-countdown-boot.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  slimMissionForCountdownBoot,
  parseCountdownBootPayload,
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
    boosterInfo: { serial: 'B1095', huge: true },
    landing: { type: 'ASDS' }
  })
  assert.equal(slim.id, 'abc')
  assert.equal(slim.rocketName, 'Falcon 9')
  assert.equal(slim.launchTime, '2099-01-01T00:00:00Z')
  assert.equal(slim.previousNet, '2098-12-31T00:00:00Z')
  assert.equal(slim.rocketImage, 'https://cdn.example/f9.png')
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
