/**
 * 星问富消息纯逻辑单测（放 test/，已在 packOptions.ignore，不进小程序包）
 * node test/ai-chat-rich-core.test.js
 */
const assert = require('assert')
const {
  matchStarshipNextFlightIntent,
  isUsableMissionForCard,
  pickStarshipMission,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule
} = require('../subpackages/shared/utils/ai-chat-rich-core.js')

function testIntentPositive() {
  const yes = [
    '星舰下一次试飞是什么时候？',
    '星舰什么时候发射',
    '下一次星舰飞行',
    'starship next flight',
    'When is the next Starship launch?',
    '星舰 Flight 10 几号',
    '星舰试飞安排'
  ]
  yes.forEach((q) => {
    assert.strictEqual(matchStarshipNextFlightIntent(q), true, '应命中: ' + q)
  })
}

function testIntentNegative() {
  const no = [
    '星舰最新进展如何？',
    '星舰有什么任务',
    '星舰任务',
    '星舰封路了吗',
    '星舰发射场在哪',
    '星舰基地怎么样',
    '星舰组合体进度',
    '猎鹰9号是怎么回收的？',
    '',
    '今天天气怎么样'
  ]
  no.forEach((q) => {
    assert.strictEqual(matchStarshipNextFlightIntent(q), false, '不应命中: ' + q)
  })
}

function testPickTracked() {
  const list = [
    { id: 'a', name: 'Falcon 9', rocketName: 'Falcon 9' },
    { id: 'b', name: 'Starship Flight 9', rocketName: 'Starship' },
    { id: 'c', name: 'Starship Flight 10', rocketName: 'Starship' }
  ]
  assert.strictEqual(pickStarshipMission(list, 'c').id, 'c')
  assert.strictEqual(pickStarshipMission(list, '').id, 'b')
  assert.strictEqual(pickStarshipMission(list, 'missing').id, 'b')
  assert.strictEqual(pickStarshipMission([], 'c'), null)
}

function testUsable() {
  assert.strictEqual(isUsableMissionForCard({ id: '1', name: 'Starship Flight 10' }), true)
  assert.strictEqual(isUsableMissionForCard({ id: '1', rocketName: 'Starship' }), false)
  assert.strictEqual(isUsableMissionForCard({ id: '1', name: 'Starlink' }), false)
  assert.strictEqual(isUsableMissionForCard(null), false)
}

function testEnrichWithCard() {
  const ctx = enrichLaunchContextWithCard(
    { upcoming: [{ name: 'Other' }] },
    {
      id: 'x',
      name: 'Starship Flight 10',
      rocketName: 'Starship',
      launchTime: '2026-08-01T00:00:00Z',
      padLocation: 'Starbase',
      statusText: '计划中'
    }
  )
  assert.ok(ctx.focusMission)
  assert.strictEqual(ctx.focusMission.name, 'Starship Flight 10')
  assert.strictEqual(ctx.upcoming[0].name, 'Starship Flight 10')
  assert.ok(String(ctx.focusHint).includes('任务卡片'))
}

function testEnrichNoSchedule() {
  const ctx = enrichLaunchContextNoStarshipSchedule({ upcoming: [] })
  assert.strictEqual(ctx.focusMission, null)
  assert.ok(String(ctx.focusHint).includes('暂无'))
  assert.ok(String(ctx.focusHint).includes('不要编造'))
}

function main() {
  const tests = [
    testIntentPositive,
    testIntentNegative,
    testPickTracked,
    testUsable,
    testEnrichWithCard,
    testEnrichNoSchedule
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
