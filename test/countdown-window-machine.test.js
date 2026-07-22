/**
 * 单测：utils/countdown-window-machine.js 窗口期状态机（纯函数，无 wx 依赖）
 * 运行：npm test   或   node --test test/
 *
 * 覆盖：阶段推导（窗口内/外、无 windowEnd 回退、改期回 PRE_WINDOW、终态直达 SETTLED、
 * 权威记录覆盖列表残留）、面板选型（挂住/让位/兜底/SETTLED 排除）、探针决策。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PHASE,
  WINDOW_HOLD_FALLBACK_MS,
  WINDOW_PROBE_GRACE_MS,
  FIRST_CHECK_DELAY_MS,
  IN_WINDOW_RECHECK_MS,
  POST_WINDOW_RECHECK_MS,
  getHoldUntilMs,
  derivePhase,
  isPanelHoldActive,
  resolvePanelSelection,
  resolvePanelMission,
  nextProbeAction
} = require('../utils/countdown-window-machine.js')

const NET = Date.parse('2026-07-22T02:50:00Z')
const WINDOW_END = Date.parse('2026-07-22T03:09:00Z')

const goMission = (extra) => ({
  id: 'gravity-1',
  launchTime: '2026-07-22T02:50:00Z',
  windowEnd: '2026-07-22T03:09:00Z',
  statusId: 1,
  statusCategory: 'go',
  ...extra
})

// ── 阶段推导 ──────────────────────────────────────────────

test('derivePhase：NET 前 → PRE_WINDOW', () => {
  assert.equal(derivePhase(goMission(), null, NET - 60 * 1000), PHASE.PRE_WINDOW)
})

test('derivePhase：NET 后窗口内 → IN_WINDOW；宽限内仍 IN_WINDOW；宽限过 → POST_WINDOW', () => {
  assert.equal(derivePhase(goMission(), null, NET + 60 * 1000), PHASE.IN_WINDOW)
  assert.equal(derivePhase(goMission(), null, WINDOW_END + WINDOW_PROBE_GRACE_MS - 1000), PHASE.IN_WINDOW)
  assert.equal(derivePhase(goMission(), null, WINDOW_END + WINDOW_PROBE_GRACE_MS + 1000), PHASE.POST_WINDOW)
})

test('derivePhase：无 windowEnd 回退 NET+30m', () => {
  const m = goMission({ windowEnd: '' })
  assert.equal(getHoldUntilMs(m, null), NET + WINDOW_HOLD_FALLBACK_MS)
  assert.equal(derivePhase(m, null, NET + WINDOW_HOLD_FALLBACK_MS - 1000), PHASE.IN_WINDOW)
  assert.equal(
    derivePhase(m, null, NET + WINDOW_HOLD_FALLBACK_MS + WINDOW_PROBE_GRACE_MS + 1000),
    PHASE.POST_WINDOW
  )
})

test('derivePhase：windowEnd 不晚于 NET（非法）时同样回退 NET+30m', () => {
  const m = goMission({ windowEnd: '2026-07-22T02:50:00Z' })
  assert.equal(getHoldUntilMs(m, null), NET + WINDOW_HOLD_FALLBACK_MS)
})

test('derivePhase：终态/飞行中任何阶段直达 SETTLED，窗口不阻挡', () => {
  assert.equal(derivePhase(goMission({ statusId: 3 }), null, NET + 60 * 1000), PHASE.SETTLED)
  assert.equal(derivePhase(goMission({ statusId: 6 }), null, NET - 60 * 1000), PHASE.SETTLED)
  assert.equal(derivePhase(goMission({ statusId: 4 }), null, WINDOW_END + 60 * 1000), PHASE.SETTLED)
  // 无 statusId 时按 statusCategory 兜底
  assert.equal(
    derivePhase(goMission({ statusId: null, statusCategory: 'success' }), null, NET + 1000),
    PHASE.SETTLED
  )
})

test('derivePhase：权威记录终态覆盖列表残留 Go', () => {
  const record = { id: 'gravity-1', status: { id: 3, name: 'Launch Successful' } }
  assert.equal(derivePhase(goMission(), record, NET + 60 * 1000), PHASE.SETTLED)
})

test('derivePhase：NET 改期到未来（记录 net 覆盖）→ 自动回 PRE_WINDOW', () => {
  const record = { id: 'gravity-1', net: '2026-07-23T10:00:00Z', status: { id: 1 } }
  assert.equal(derivePhase(goMission(), record, NET + 60 * 1000), PHASE.PRE_WINDOW)
})

test('isPanelHoldActive：窗口内未决 true；终态 / 窗口+宽限外 false', () => {
  assert.equal(isPanelHoldActive(goMission(), null, NET + 60 * 1000), true)
  assert.equal(isPanelHoldActive(goMission({ statusId: 3 }), null, NET + 60 * 1000), false)
  assert.equal(isPanelHoldActive(goMission(), null, WINDOW_END + WINDOW_PROBE_GRACE_MS + 1000), false)
})

// ── 面板选型 ──────────────────────────────────────────────

const futureMission = { id: 'cz3b', launchTime: '2026-07-22T06:00:00Z', statusId: 1 }

test('resolvePanelSelection：holdMissionId 窗口内优先于列表头', () => {
  const now = NET + 60 * 1000
  const sel = resolvePanelSelection([futureMission, goMission()], { now, holdMissionId: 'gravity-1' })
  assert.equal(sel.mission.id, 'gravity-1')
  assert.equal(sel.reason, 'hold_current')
})

test('resolvePanelSelection：列表头窗口内挂住，不被未来任务顶掉', () => {
  const now = NET + 60 * 1000
  const sel = resolvePanelSelection([goMission(), futureMission], { now })
  assert.equal(sel.mission.id, 'gravity-1')
  assert.equal(sel.reason, 'hold_head')
})

test('resolvePanelSelection：窗口+宽限过后让位给第一条未来 NET', () => {
  const now = WINDOW_END + WINDOW_PROBE_GRACE_MS + 60 * 1000
  const sel = resolvePanelSelection([goMission(), futureMission], { now })
  assert.equal(sel.mission.id, 'cz3b')
  assert.equal(sel.reason, 'next_future')
})

test('resolvePanelSelection：无未来任务时头条过窗未决继续展示（不空面板）', () => {
  const now = WINDOW_END + WINDOW_PROBE_GRACE_MS + 60 * 1000
  const sel = resolvePanelSelection([goMission()], { now })
  assert.equal(sel.mission.id, 'gravity-1')
  assert.equal(sel.reason, 'unresolved_fallback')
  assert.equal(sel.phase, PHASE.POST_WINDOW)
})

test('resolvePanelSelection：头条为 SETTLED 残留行时，生效头条（第二行）窗口内仍挂住', () => {
  const now = NET + 60 * 1000
  const settledHead = { id: 'old-done', launchTime: '2026-07-22T01:00:00Z', statusId: 3 }
  const sel = resolvePanelSelection([settledHead, goMission(), futureMission], { now })
  assert.equal(sel.mission.id, 'gravity-1')
  assert.equal(sel.reason, 'hold_head')
})

test('resolvePanelSelection：SETTLED 任务绝不进面板', () => {
  const now = NET + 60 * 1000
  const recordsById = new Map([['gravity-1', { id: 'gravity-1', status: { id: 3 } }]])
  const sel = resolvePanelSelection([goMission(), futureMission], {
    now,
    holdMissionId: 'gravity-1',
    recordsById
  })
  assert.equal(sel.mission.id, 'cz3b')
  // 全部落库 → null
  const allSettled = resolvePanelSelection([goMission({ statusId: 3 })], { now })
  assert.equal(allSettled.mission, null)
  assert.equal(allSettled.reason, 'empty')
})

test('resolvePanelMission：空列表 / 非数组返回 null', () => {
  assert.equal(resolvePanelMission([], {}), null)
  assert.equal(resolvePanelMission(null, {}), null)
})

// ── 探针决策 ──────────────────────────────────────────────

test('nextProbeAction：PRE_WINDOW 不探针', () => {
  assert.deepEqual(nextProbeAction(goMission(), null, NET - 60 * 1000), { action: 'none', delayMs: 0 })
})

test('nextProbeAction：NET+10m 前 wait（剩余延时），之后窗口内 probeById（3m 间隔）', () => {
  const early = nextProbeAction(goMission(), null, NET + 2 * 60 * 1000)
  assert.equal(early.action, 'wait')
  assert.equal(early.delayMs, FIRST_CHECK_DELAY_MS - 2 * 60 * 1000)

  const mid = nextProbeAction(goMission(), null, NET + FIRST_CHECK_DELAY_MS + 1000)
  assert.equal(mid.action, 'probeById')
  assert.equal(mid.delayMs, IN_WINDOW_RECHECK_MS)
})

test('nextProbeAction：holdUntil 到点（宽限内）→ bestEffort', () => {
  const probe = nextProbeAction(goMission(), null, WINDOW_END + 1000)
  assert.equal(probe.action, 'bestEffort')
})

test('nextProbeAction：POST_WINDOW → 15m 慢探', () => {
  const probe = nextProbeAction(goMission(), null, WINDOW_END + WINDOW_PROBE_GRACE_MS + 1000)
  assert.equal(probe.action, 'slowProbe')
  assert.equal(probe.delayMs, POST_WINDOW_RECHECK_MS)
})

test('nextProbeAction：终态（含权威记录覆盖缓存 Go）→ settle', () => {
  assert.equal(nextProbeAction(goMission({ statusId: 6 }), null, NET + 1000).action, 'settle')
  const record = { id: 'gravity-1', status: { id: 3 } }
  assert.equal(nextProbeAction(goMission(), record, NET + 1000).action, 'settle')
})

test('nextProbeAction：记录改期 NET 到未来 → none（倒计时自然恢复）', () => {
  const record = { id: 'gravity-1', net: '2026-07-23T10:00:00Z', status: { id: 1 } }
  assert.deepEqual(nextProbeAction(goMission(), record, NET + 1000), { action: 'none', delayMs: 0 })
})
