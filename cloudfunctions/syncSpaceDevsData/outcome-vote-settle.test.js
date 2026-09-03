/**
 * 成败竞猜封盘 / 推迟 / 终态结算
 * 运行：node --test outcome-vote-settle.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  VOTE_TIME_TOLERANCE_MS,
  computeOutcomeResult,
  computeOutcomeResultFromFound,
  resolveOutcomeVotingClosed,
  shouldClearErroneousOutcomeSettle,
  applySettleOutcomeVotePass
} = require('./outcome-vote-settle.js')

const HOUR = 60 * 60 * 1000

test('终态才结算；Hold/scrub/推迟不算失败', () => {
  assert.equal(computeOutcomeResult('success', '', ''), 'success')
  assert.equal(computeOutcomeResult('deployed', '', ''), 'success')
  assert.equal(computeOutcomeResult('failure', '', ''), 'failure')
  assert.equal(computeOutcomeResult('partial', '', ''), 'failure')
  assert.equal(computeOutcomeResult('cancelled', '', ''), 'failure')

  assert.equal(computeOutcomeResult('delayed', 'Hold', 'On Hold'), '')
  assert.equal(computeOutcomeResult('pending', 'TBD', 'To Be Determined'), '')
  assert.equal(computeOutcomeResult('inflight', 'In Flight', 'In Flight'), '')
  assert.equal(computeOutcomeResult('', 'Scrub', 'Launch Scrubbed'), '')
  assert.equal(computeOutcomeResult('', 'Abort', 'Abort'), '')

  assert.equal(computeOutcomeResultFromFound({ status: { id: 3, abbrev: 'Success' } }), 'success')
  assert.equal(computeOutcomeResultFromFound({ status: { id: 4, abbrev: 'Failure' } }), 'failure')
  assert.equal(computeOutcomeResultFromFound({ status: { id: 5, abbrev: 'Hold', name: 'On Hold' } }), '')
  assert.equal(computeOutcomeResultFromFound({ status: { id: 2, abbrev: 'TBD' } }), '')
})

test('改期后动态解封，不再假显示距发射不足30分钟', () => {
  const nowMs = Date.parse('2026-07-23T12:00:00Z')
  const farNet = new Date(nowMs + 6 * HOUR).toISOString()
  const nearNet = new Date(nowMs + 10 * 60 * 1000).toISOString()

  const reopened = resolveOutcomeVotingClosed(
    { votingClosed: true, result: '' },
    farNet,
    nowMs,
    VOTE_TIME_TOLERANCE_MS
  )
  assert.equal(reopened.votingClosed, false)
  assert.ok(reopened.dbPatch && reopened.dbPatch.votingClosed === false)

  const locked = resolveOutcomeVotingClosed(
    { votingClosed: false, result: '' },
    nearNet,
    nowMs,
    VOTE_TIME_TOLERANCE_MS
  )
  assert.equal(locked.votingClosed, true)
  assert.equal(locked.votingClosedReason, 'time')
})

test('误结算（scrub→failure）即使 NET 未后移也应清空', () => {
  const nowMs = Date.parse('2026-07-23T12:00:00Z')
  const farNet = new Date(nowMs + 24 * HOUR).toISOString()
  const pastNet = new Date(nowMs - HOUR).toISOString()

  assert.equal(
    shouldClearErroneousOutcomeSettle(
      { result: 'failure', votingClosed: true },
      'delayed',
      'Hold',
      'On Hold',
      5,
      farNet,
      nowMs,
      VOTE_TIME_TOLERANCE_MS
    ),
    true
  )
  // scrub 后 NET 仍停在过去：强信号仍清空
  assert.equal(
    shouldClearErroneousOutcomeSettle(
      { result: 'failure', votingClosed: true },
      'failure', // 陈旧 category 也不能挡住
      'Hold',
      'On Hold',
      5,
      pastNet,
      nowMs,
      VOTE_TIME_TOLERANCE_MS
    ),
    true
  )
  assert.equal(
    shouldClearErroneousOutcomeSettle(
      { result: 'failure', votingClosed: true },
      '',
      'Scrub',
      'Launch Scrubbed',
      '',
      pastNet,
      nowMs,
      VOTE_TIME_TOLERANCE_MS
    ),
    true
  )
  // 真实 Failure 不清空
  assert.equal(
    shouldClearErroneousOutcomeSettle(
      { result: 'failure', votingClosed: true },
      'failure',
      'Failure',
      'Launch Failure',
      4,
      farNet,
      nowMs,
      VOTE_TIME_TOLERANCE_MS
    ),
    false
  )
})

test('settle pass: NET 已过不 lock；封盘后推迟 reopen；终态 settle', () => {
  const nowMs = Date.parse('2026-07-23T12:00:00Z')
  const pastNet = new Date(nowMs - HOUR).toISOString()
  const farNet = new Date(nowMs + 8 * HOUR).toISOString()
  const nearNet = new Date(nowMs + 15 * 60 * 1000).toISOString()

  const noLockPast = applySettleOutcomeVotePass(
    { launchId: 'a', votingClosed: false, launchTime: pastNet },
    { net: pastNet, status: { id: 5, abbrev: 'Hold' } },
    { nowMs, THIRTY_MIN: VOTE_TIME_TOLERANCE_MS }
  )
  assert.equal(noLockPast.kind, 'none')

  const reopenAfterPostpone = applySettleOutcomeVotePass(
    { launchId: 'b', votingClosed: true, launchTime: pastNet, result: '' },
    { net: farNet, status: { id: 5, abbrev: 'Hold', name: 'On Hold' } },
    { nowMs, THIRTY_MIN: VOTE_TIME_TOLERANCE_MS }
  )
  assert.equal(reopenAfterPostpone.kind, 'reopen')
  assert.equal(reopenAfterPostpone.patch.votingClosed, false)

  const lockNear = applySettleOutcomeVotePass(
    { launchId: 'c', votingClosed: false, launchTime: nearNet },
    { net: nearNet, status: { id: 1, abbrev: 'Go' } },
    { nowMs, THIRTY_MIN: VOTE_TIME_TOLERANCE_MS }
  )
  assert.equal(lockNear.kind, 'lock')

  const settleSuccess = applySettleOutcomeVotePass(
    { launchId: 'd', votingClosed: true, launchTime: pastNet },
    { net: pastNet, status: { id: 3, abbrev: 'Success' } },
    { nowMs, THIRTY_MIN: VOTE_TIME_TOLERANCE_MS }
  )
  assert.equal(settleSuccess.kind, 'settle')
  assert.equal(settleSuccess.patch.result, 'success')

  const clearWrongFailure = applySettleOutcomeVotePass(
    {
      launchId: 'e',
      votingClosed: true,
      result: 'failure',
      launchTime: pastNet,
      resultNote: '系统按发射状态自动结算'
    },
    { net: farNet, status: { id: 5, abbrev: 'Hold', name: 'On Hold' } },
    { nowMs, THIRTY_MIN: VOTE_TIME_TOLERANCE_MS }
  )
  assert.equal(clearWrongFailure.kind, 'reopen')
  assert.equal(clearWrongFailure.patch.result, '')
})
