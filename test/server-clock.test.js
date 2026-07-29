/**
 * 单测：utils/server-clock.js 服务端时钟校准
 * 运行：npm test   或   node --test test/
 *
 * 覆盖：未校时等于本地时钟、RTT 中点补偿、噪声阈值丢弃、非法采样拒绝、
 * 以及 wx.request 不可用时的静默降级（保证校时失败不改变既有行为）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const clock = require('../utils/server-clock.js')

test('未校时：getServerNow 等于本地时钟，offset 为 0', () => {
  clock._resetForTest()
  assert.equal(clock.getClockOffsetMs(), 0)
  assert.equal(clock.isClockSynced(), false)
  assert.ok(Math.abs(clock.getServerNow() - Date.now()) < 50)
})

test('采样：服务端快 5 分钟 → offset 约 +5 分钟，getServerNow 随之前移', () => {
  clock._resetForTest()
  const sent = 1_000_000
  const recv = 1_000_200
  const serverMs = sent + 5 * 60 * 1000
  assert.equal(clock.noteServerTimeSample(serverMs, sent, recv), true)
  // 中点估计：server - (sent+recv)/2 = 5min - 100ms
  assert.equal(clock.getClockOffsetMs(), 5 * 60 * 1000 - 100)
  assert.equal(clock.isClockSynced(), true)
})

test('采样：设备时钟快（服务端更早）→ offset 为负', () => {
  clock._resetForTest()
  const sent = 2_000_000
  const recv = 2_000_000
  clock.noteServerTimeSample(sent - 90 * 1000, sent, recv)
  assert.equal(clock.getClockOffsetMs(), -90 * 1000)
})

test('采样：偏移小于噪声阈值 → 归零，不引入抖动', () => {
  clock._resetForTest()
  const sent = 3_000_000
  const adopted = clock.noteServerTimeSample(sent + 500, sent, sent + 20)
  assert.equal(adopted, false)
  assert.equal(clock.getClockOffsetMs(), 0)
  // 已经完成过一次校时（只是偏移可忽略）
  assert.equal(clock.isClockSynced(), true)
})

test('采样：非法入参一律拒绝且不污染既有 offset', () => {
  clock._resetForTest()
  clock.noteServerTimeSample(4_000_000 + 60_000, 4_000_000, 4_000_000)
  const before = clock.getClockOffsetMs()
  assert.equal(clock.noteServerTimeSample(NaN, 1, 2), false)
  assert.equal(clock.noteServerTimeSample(0, 1, 2), false)
  assert.equal(clock.noteServerTimeSample(5_000_000, undefined, 2), false)
  // recv 早于 sent（时钟跳变）
  assert.equal(clock.noteServerTimeSample(5_000_000, 100, 50), false)
  assert.equal(clock.getClockOffsetMs(), before)
})

test('syncServerClock：wx 不可用时静默降级为 offset 0（行为等同未校时）', async () => {
  clock._resetForTest()
  const offset = await clock.syncServerClock({ url: 'https://example.test/' })
  assert.equal(offset, 0)
  assert.ok(Math.abs(clock.getServerNow() - Date.now()) < 50)
})

test('syncServerClock：从 Date 响应头解析并采用偏移', async () => {
  clock._resetForTest()
  const serverDate = new Date(Date.now() + 20 * 60 * 1000)
  global.wx = {
    request({ success }) {
      success({ header: { Date: serverDate.toUTCString() } })
    }
  }
  try {
    await clock.syncServerClock({ url: 'https://example.test/', force: true })
    // Date 头秒级截断 + RTT，允许 2s 误差
    assert.ok(Math.abs(clock.getClockOffsetMs() - 20 * 60 * 1000) < 2000)
  } finally {
    delete global.wx
    clock._resetForTest()
  }
})

test('syncServerClock：请求失败 / 无 Date 头 → 保持 offset 0', async () => {
  clock._resetForTest()
  global.wx = {
    request({ fail }) {
      fail(new Error('network down'))
    }
  }
  try {
    assert.equal(await clock.syncServerClock({ url: 'https://example.test/', force: true }), 0)
    global.wx.request = ({ success }) => success({ header: {} })
    assert.equal(await clock.syncServerClock({ url: 'https://example.test/', force: true }), 0)
  } finally {
    delete global.wx
    clock._resetForTest()
  }
})

test('syncServerClock：节流内重复调用不重复发请求', async () => {
  clock._resetForTest()
  let calls = 0
  const serverDate = new Date(Date.now() + 10 * 60 * 1000)
  global.wx = {
    request({ success }) {
      calls += 1
      success({ header: { Date: serverDate.toUTCString() } })
    }
  }
  try {
    await clock.syncServerClock({ url: 'https://example.test/', force: true })
    await clock.syncServerClock({ url: 'https://example.test/' })
    await clock.syncServerClock({ url: 'https://example.test/' })
    assert.equal(calls, 1)
  } finally {
    delete global.wx
    clock._resetForTest()
  }
})
