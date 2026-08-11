/**
 * 单测：utils/index-launch-state.js 中「即将发射」卡片倒计时纯函数（无 wx 依赖）
 * 运行：npm test   或   node --test test/
 *
 * 覆盖：字段构建与补零、过期兜底、前 N 张附加/超出剥离、
 * 未变化行的引用复用（避免多余 setData diff）、tick 增量补丁。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildMissionCardCountdownFields,
  attachCardCountdownToMissions,
  buildMissionCardCountdownTickPatch,
  pickCountdownDisplayMission,
  sortUpcomingMissionsByNetAsc,
  shouldHoldPastNetCountdownMission,
  resolveCountdownPrecision,
  buildOverlapSideCardView,
  buildCountdownTickState
} = require('../utils/index-launch-state.js')

// 固定倒计时值的 mock，避免依赖真实时间
function makeDeps(cd) {
  return {
    getCountdown: () => cd,
    formatSecondsText: (v) => String(v == null ? 0 : v).padStart(2, '0')
  }
}

const FUTURE = { days: 3, hours: 5, minutes: 7, seconds: 9, isExpired: false }

test('buildMissionCardCountdownFields：时/分/秒补零，天保留数字', () => {
  const out = buildMissionCardCountdownFields('2099-01-01T00:00:00Z', makeDeps(FUTURE))
  assert.deepEqual(out, { days: 3, hours: '05', minutes: '07', seconds: '09', isExpired: false })
})

test('buildMissionCardCountdownFields：无 launchTime / 无 getCountdown → 过期兜底', () => {
  assert.equal(buildMissionCardCountdownFields('', makeDeps(FUTURE)).isExpired, true)
  assert.equal(buildMissionCardCountdownFields('2099-01-01T00:00:00Z', {}).isExpired, true)
})

test('attachCardCountdownToMissions：仅前 N 张附加，超出部分剥离字段', () => {
  const missions = [
    { id: 1, launchTime: 't1' },
    { id: 2, launchTime: 't2' },
    { id: 3, launchTime: 't3', showRocketCountdown: true, cardCountdown: { days: 9 } }
  ]
  const out = attachCardCountdownToMissions(missions, 2, makeDeps(FUTURE))
  assert.equal(out[0].showRocketCountdown, true)
  assert.equal(out[0].cardCountdown.hours, '05')
  assert.equal(out[1].showRocketCountdown, true)
  // 第 3 张此前被附加过（如置顶排序前在前两位），须剥离残留字段
  assert.equal(out[2].showRocketCountdown, undefined)
  assert.equal(out[2].cardCountdown, undefined)
})

test('attachCardCountdownToMissions：倒计时未变化时复用原对象引用', () => {
  const first = attachCardCountdownToMissions([{ id: 1, launchTime: 't1' }], 2, makeDeps(FUTURE))
  const second = attachCardCountdownToMissions(first, 2, makeDeps(FUTURE))
  assert.equal(second[0], first[0])
})

test('buildMissionCardCountdownTickPatch：仅对变化的行生成 dotted-path 补丁', () => {
  const missions = attachCardCountdownToMissions(
    [{ id: 1, launchTime: 't1' }, { id: 2, launchTime: 't2' }],
    2,
    makeDeps(FUTURE)
  )
  // 值未变 → 空补丁
  assert.deepEqual(buildMissionCardCountdownTickPatch(missions, 2, makeDeps(FUTURE)), {})
  // 秒推进 → 每行一条 dotted-path
  const next = { ...FUTURE, seconds: 10 }
  const patch = buildMissionCardCountdownTickPatch(missions, 2, makeDeps(next))
  assert.deepEqual(Object.keys(patch), [
    'displayedUpcomingMissions[0].cardCountdown',
    'displayedUpcomingMissions[1].cardCountdown'
  ])
  assert.equal(patch['displayedUpcomingMissions[0].cardCountdown'].seconds, '10')
})

test('buildMissionCardCountdownTickPatch：limit 为 0 或列表为空时返回空对象', () => {
  assert.deepEqual(buildMissionCardCountdownTickPatch([], 2, makeDeps(FUTURE)), {})
  assert.deepEqual(buildMissionCardCountdownTickPatch([{ id: 1, launchTime: 't1' }], 0, makeDeps(FUTURE)), {})
})

test('pickCountdownDisplayMission：头条 NET 已过、windowEnd 未过、后面有未来任务 → 仍选头条', () => {
  const now = Date.parse('2026-07-22T03:05:00Z')
  const head = {
    id: 'gravity-1',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  const next = {
    id: 'cz3b',
    launchTime: '2026-07-22T06:00:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  assert.equal(shouldHoldPastNetCountdownMission(head, now), true)
  const picked = pickCountdownDisplayMission([head, next], now)
  assert.equal(picked && picked.id, 'gravity-1')
})

test('pickCountdownDisplayMission：windowEnd+宽限内仍挂住头条', () => {
  // windowEnd 03:09 + 10m 探针宽限 = 03:19，03:15 仍在窗口挂住期
  const now = Date.parse('2026-07-22T03:15:00Z')
  const head = {
    id: 'gravity-1',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  const next = {
    id: 'cz3b',
    launchTime: '2026-07-22T06:00:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  assert.equal(shouldHoldPastNetCountdownMission(head, now), true)
  const picked = pickCountdownDisplayMission([head, next], now)
  assert.equal(picked && picked.id, 'gravity-1')
})

test('pickCountdownDisplayMission：windowEnd+宽限已过则让位给下一条未来 NET', () => {
  const now = Date.parse('2026-07-22T03:25:00Z')
  const head = {
    id: 'gravity-1',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  const next = {
    id: 'cz3b',
    launchTime: '2026-07-22T06:00:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  assert.equal(shouldHoldPastNetCountdownMission(head, now), false)
  const picked = pickCountdownDisplayMission([head, next], now)
  assert.equal(picked && picked.id, 'cz3b')
})

test('pickCountdownDisplayMission：权威记录终态覆盖列表残留 Go，不再挂住', () => {
  const now = Date.parse('2026-07-22T03:05:00Z')
  const head = {
    id: 'gravity-1',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1,
    statusCategory: 'go'
  }
  const next = { id: 'cz3b', launchTime: '2026-07-22T06:00:00Z', statusId: 1 }
  const recordsById = new Map([
    ['gravity-1', { id: 'gravity-1', status: { id: 3, name: 'Launch Successful' } }]
  ])
  assert.equal(shouldHoldPastNetCountdownMission(head, now, recordsById.get('gravity-1')), false)
  const picked = pickCountdownDisplayMission([head, next], now, { recordsById })
  assert.equal(picked && picked.id, 'cz3b')
})

test('pickCountdownDisplayMission：无未来任务时头条过窗未决继续展示，不空面板', () => {
  const now = Date.parse('2026-07-22T05:00:00Z')
  const head = {
    id: 'gravity-1',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1
  }
  const picked = pickCountdownDisplayMission([head], now)
  assert.equal(picked && picked.id, 'gravity-1')
})

test('pickCountdownDisplayMission：holdMissionId 在窗口内优先于列表头', () => {
  const now = Date.parse('2026-07-22T03:05:00Z')
  const a = {
    id: 'a',
    launchTime: '2026-07-22T06:00:00Z',
    statusId: 1
  }
  const b = {
    id: 'b',
    launchTime: '2026-07-22T02:50:00Z',
    windowEnd: '2026-07-22T03:09:00Z',
    statusId: 1
  }
  const picked = pickCountdownDisplayMission([a, b], now, { holdMissionId: 'b' })
  assert.equal(picked && picked.id, 'b')
})

test('sortUpcomingMissionsByNetAsc：近窗 TBD 沉到就绪任务之后', () => {
  const rows = [
    { id: 'michibiki', launchTime: '2026-08-10T19:15:00Z', statusId: 2, statusAbbrev: 'TBD' },
    { id: 'zhuque', launchTime: '2026-08-10T23:45:00Z', statusId: 1, statusAbbrev: 'Go' },
    { id: 'starlink', launchTime: '2026-08-11T14:26:00Z', statusId: 1, statusAbbrev: 'Go' }
  ]
  sortUpcomingMissionsByNetAsc(rows)
  assert.equal(rows[0].id, 'zhuque')
  assert.equal(rows[1].id, 'starlink')
  assert.equal(rows[2].id, 'michibiki')
})

test('pickCountdownDisplayMission：scrub 到远窗后不传 hold → 选更近未来任务', () => {
  const now = Date.parse('2026-08-10T15:00:00Z')
  const michibiki = {
    id: 'michibiki',
    launchTime: '2026-08-31T00:00:00Z',
    statusId: 2
  }
  const zhuque = {
    id: 'zhuque',
    launchTime: '2026-08-10T23:45:00Z',
    statusId: 1
  }
  const picked = pickCountdownDisplayMission([zhuque, michibiki], now, {
    holdMissionId: '' // scrub 后 PRE_WINDOW 不保留 hold
  })
  assert.equal(picked && picked.id, 'zhuque')
})

test('attachCardCountdownToMissions：窗口挂住的面板任务显示 00:00 且未过期', () => {
  const now = Date.parse('2026-07-22T03:05:00Z')
  const missions = [
    {
      id: 'gravity-1',
      launchTime: '2026-07-22T02:50:00Z',
      windowEnd: '2026-07-22T03:09:00Z',
      statusId: 1
    },
    { id: 'cz3b', launchTime: '2026-07-22T06:00:00Z', statusId: 1 }
  ]
  const deps = {
    ...makeDeps({ days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true }),
    now,
    holdMissionId: 'gravity-1'
  }
  const out = attachCardCountdownToMissions(missions, 2, deps)
  assert.equal(out[0].cardCountdown.isExpired, false)
  assert.equal(out[0].cardCountdown.holdConfirming, true)
  assert.equal(out[0].cardCountdown.minutes, '00')
  assert.equal(out[1].cardCountdown.isExpired, true)
})

test('resolveCountdownPrecision：Second/Minute/Hour 可走时钟倒计时', () => {
  ;['Second', 'Minute', 'Hour', 'second', 'HOUR'].forEach((p) => {
    assert.equal(resolveCountdownPrecision({ netPrecision: p }).clockCapable, true, p)
  })
})

test('resolveCountdownPrecision：Day 及更粗档位降级（net 只是占位时刻）', () => {
  ;['Day', 'Week', 'Month', 'Quarter', 'Year'].forEach((p) => {
    assert.equal(resolveCountdownPrecision({ netPrecision: p }).clockCapable, false, p)
  })
})

test('resolveCountdownPrecision：字段缺失按可倒计时处理（老缓存不能被降级）', () => {
  assert.equal(resolveCountdownPrecision({}).clockCapable, true)
  assert.equal(resolveCountdownPrecision(null).clockCapable, true)
  assert.equal(resolveCountdownPrecision({ netPrecision: '' }).clockCapable, true)
  // LL2 详情接口的原始字段名也认
  assert.equal(resolveCountdownPrecision({ net_precision: 'Month' }).clockCapable, false)
})

test('buildOverlapSideCardView：过点副卡状态强制「状态确认中」，不留列表残留的就绪', () => {
  const view = buildOverlapSideCardView(
    { id: 'x', missionName: 'M', statusBadgeText: '就绪', statusCategory: 'go', launchTime: 't' },
    { getCountdown: () => ({ days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true }) }
  )
  assert.equal(view.statusTextZh, '状态确认中')
  assert.equal(view.statusCategory, 'pending')
  assert.equal(view.countdownText, '确认中')
})

test('buildCountdownTickState：秒未变 → 不产生任何 setData', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 1, hours: 2, minutes: 3, seconds: 9 },
    prevCountdown: { days: 1, hours: 2, minutes: 3, seconds: 9 },
    currentSecondsText: '09',
    nextSecondsText: '09',
    nextSecondsReel: ['09', '09', '08']
  })
  assert.equal(tick.didSecondsChange, false)
  assert.equal(tick.immediateState, null)
  assert.equal(tick.settleState, null)
})

test('buildCountdownTickState：秒未变但时/分变了 → 仍下发（切任务撞同一秒位）', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 0, hours: 5, minutes: 0, seconds: 0 },
    prevCountdown: { days: 0, hours: 1, minutes: 11, seconds: 0 },
    currentSecondsText: '00',
    nextSecondsText: '00',
    nextSecondsReel: ['00', '59', '58']
  })
  assert.equal(tick.didSecondsChange, false)
  assert.equal(tick.immediateState['countdown.hours'], 5)
  assert.equal(tick.immediateState['countdown.minutes'], 0)
  // 秒位没动就不该碰滚轮字段
  assert.equal('countdownSecondsRolling' in tick.immediateState, false)
  assert.equal('countdown.seconds' in tick.immediateState, false)
  assert.equal(tick.settleState, null)
})

test('buildCountdownTickState：正常走一秒 → 播滚轮动画并给出 settle', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 1, hours: 2, minutes: 3, seconds: 9 },
    prevCountdown: { days: 1, hours: 2, minutes: 3, seconds: 10 },
    currentSecondsText: '10',
    nextSecondsText: '09',
    nextSecondsReel: ['09', '08', '07']
  })
  assert.equal(tick.immediateState.countdownSecondsRolling, true)
  assert.deepEqual(tick.immediateState.countdownSecondsReel, ['10', '09', '07'])
  assert.ok(tick.settleState)
  assert.equal(tick.settleState.countdownSecondsRolling, false)
  // 只有变化的字段进补丁：分/时/天未变则不下发
  assert.equal('countdown.minutes' in tick.immediateState, false)
})

test('buildCountdownTickState：跨分钟 00→59 仍视为走一秒', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 0, hours: 1, minutes: 2, seconds: 59 },
    prevCountdown: { days: 0, hours: 1, minutes: 3, seconds: 0 },
    currentSecondsText: '00',
    nextSecondsText: '59',
    nextSecondsReel: ['59', '58', '57']
  })
  assert.equal(tick.immediateState.countdownSecondsRolling, true)
  assert.equal(tick.immediateState['countdown.minutes'], 2)
  assert.ok(tick.settleState)
})

test('buildCountdownTickState：跳秒（节流/后台恢复）直接落位，不播错帧动画', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 0, hours: 1, minutes: 2, seconds: 5 },
    prevCountdown: { days: 0, hours: 1, minutes: 2, seconds: 10 },
    currentSecondsText: '10',
    nextSecondsText: '05',
    nextSecondsReel: ['05', '04', '03']
  })
  assert.equal(tick.immediateState.countdownSecondsRolling, false)
  assert.deepEqual(tick.immediateState.countdownSecondsReel, ['05', '04', '03'])
  assert.equal(tick.immediateState.countdownSecondsCurrent, '05')
  assert.equal(tick.immediateState.countdownSecondsPrev, '05')
  // 无动画就无需复位，省一次 setData
  assert.equal(tick.settleState, null)
})

test('buildCountdownTickState：首帧（无旧秒值）直接落位', () => {
  const tick = buildCountdownTickState({
    countdown: { days: 0, hours: 0, minutes: 0, seconds: 42 },
    prevCountdown: {},
    currentSecondsText: '',
    nextSecondsText: '42',
    nextSecondsReel: ['42', '41', '40']
  })
  assert.equal(tick.immediateState.countdownSecondsRolling, false)
  assert.equal(tick.settleState, null)
})

test('buildOverlapSideCardView：未过点仍展示原始状态文案', () => {
  const view = buildOverlapSideCardView(
    { id: 'x', missionName: 'M', statusBadgeText: '就绪', statusCategory: 'go', launchTime: 't' },
    { getCountdown: () => ({ days: 0, hours: 1, minutes: 2, seconds: 3, isExpired: false }) }
  )
  assert.equal(view.statusTextZh, '就绪')
  assert.equal(view.statusCategory, 'go')
  assert.equal(view.countdownText, '01:02:03')
})
