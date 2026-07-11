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
  buildMissionCardCountdownTickPatch
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
