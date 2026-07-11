/**
 * 本地验证：Flight 12 多轮改期重建
 * 运行：node vote-rounds-rebuild.test.js
 *
 * Flight 12 launchId: ed83366c-872c-4484-97c1-bc74832304fc
 */
const {
  VOTE_FLIGHT12_LAUNCH_ID,
  extractAttemptNetsFromUpdates,
  trimAttemptNetsForTerminal,
  inferFoundFromUpdates,
  updatesSufficientForHistoryRebuild,
  tryBuildRoundsFromNetHistory
} = require('./vote-rounds-from-updates.js')

const FLIGHT12_UPDATES = [
  { comment: 'Added launch', createdOn: '2025-09-10T08:21:00Z' },
  { comment: 'NET January.', createdOn: '2025-11-05T18:10:00Z' },
  { comment: 'Moved to NET Q1 based on vehicle testing progress.', createdOn: '2026-01-07T15:28:00Z' },
  { comment: 'Targeting March', createdOn: '2026-01-29T12:13:00Z' },
  { comment: 'NET April', createdOn: '2026-03-09T12:32:00Z' },
  { comment: 'NET May.', createdOn: '2026-04-04T14:17:00Z' },
  { comment: 'NET May 12, TBC.', createdOn: '2026-05-01T16:51:00Z' },
  { comment: 'NET May 15 per new marine navigation warnings, TBC.', createdOn: '2026-05-05T17:58:00Z' },
  { comment: 'NET May 19, TBC.', createdOn: '2026-05-12T11:19:00Z' },
  { comment: 'GO for launch.', createdOn: '2026-05-12T21:17:00Z' },
  { comment: 'Now targeting May 20 at 22:30 UTC', createdOn: '2026-05-17T14:54:00Z' },
  { comment: 'Now targeting May 21 at 22:30 UTC', createdOn: '2026-05-18T23:39:00Z' },
  { comment: 'Now targeting May 21 at 23:00 UTC', createdOn: '2026-05-21T21:28:00Z' },
  { comment: 'Now targeting May 21 at 23:30 UTC', createdOn: '2026-05-21T21:55:00Z' },
  { comment: 'Scrub for the day after hold at T-40.', createdOn: '2026-05-21T23:41:00Z' },
  { comment: 'Next attempt NET May 22.', createdOn: '2026-05-21T23:45:00Z' },
  { comment: 'Confirmed rescheduled for May 22.', createdOn: '2026-05-22T01:37:00Z' },
  { comment: 'Liftoff.', createdOn: '2026-05-22T22:30:00Z' }
]

const FLIGHT12_FOUND = {
  id: VOTE_FLIGHT12_LAUNCH_ID,
  net: '2026-05-22T22:30:24Z',
  status: { abbrev: 'Success', name: 'Launch Successful' }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

const attempts = extractAttemptNetsFromUpdates(FLIGHT12_UPDATES)
const trimmed = trimAttemptNetsForTerminal(attempts, FLIGHT12_FOUND)
const patch = tryBuildRoundsFromNetHistory({ launchId: VOTE_FLIGHT12_LAUNCH_ID }, FLIGHT12_FOUND, FLIGHT12_UPDATES)

console.log('launchId:', VOTE_FLIGHT12_LAUNCH_ID)
console.log('attempts (raw):', attempts.length, attempts.map((t) => t.slice(0, 10)))
console.log('attempts (trimmed):', trimmed.length, trimmed.map((t) => t.slice(0, 10)))

assert(patch && patch.rounds, 'patch.rounds missing')
assert(patch.rounds.length === 4, 'expected 4 rounds, got ' + patch.rounds.length)

const ge = patch.rounds.filter((r) => r.result === 'ge')
const buge = patch.rounds.filter((r) => r.result === 'buge')
assert(ge.length === 3, 'expected 3 ge rounds, got ' + ge.length)
assert(buge.length === 1, 'expected 1 buge round, got ' + buge.length)
assert(patch.result === 'buge', 'expected top-level result buge')
assert(patch.currentRound === 4, 'expected currentRound 4')

console.log('rounds:', patch.rounds.map((r) => 'R' + r.round + ':' + (r.result === 'ge' ? '鸽' : '没鸽')))
console.log('OK — Flight 12 multiround rebuild')

// launch 不在列表 cache 时，仅靠 updates 推断终态并重建
const inferred = inferFoundFromUpdates(FLIGHT12_UPDATES, VOTE_FLIGHT12_LAUNCH_ID)
assert(inferred && inferred.status && inferred.status.abbrev === 'Success', 'inferFoundFromUpdates failed')

const patchNoLaunch = tryBuildRoundsFromNetHistory(
  { launchId: VOTE_FLIGHT12_LAUNCH_ID, result: 'ge', votingClosed: true, rounds: [{ round: 1, result: 'ge' }] },
  null,
  FLIGHT12_UPDATES
)
assert(patchNoLaunch && patchNoLaunch.rounds.length === 4, 'no-launch patch expected 4 rounds')
assert(patchNoLaunch.result === 'buge', 'no-launch patch expected buge')
console.log('OK — Flight 12 rebuild without launch cache')

// 仅含末段 updates（模拟 launch_timeline_cache 只存最新 15 条、缺早期 NET May 12–19）
const PARTIAL_LATE_UPDATES = [
  { comment: 'Updated launch weather, 55% GO.', createdOn: '2026-05-21T03:07:00Z' },
  { comment: 'Tweaked T-0.', createdOn: '2026-05-21T17:44:00Z' },
  { comment: 'Now targeting May 21 at 23:00 UTC', createdOn: '2026-05-21T21:28:00Z' },
  { comment: 'Tweaked T-0.', createdOn: '2026-05-21T21:46:00Z' },
  { comment: 'Now targeting May 21 at 23:30 UTC', createdOn: '2026-05-21T21:55:00Z' },
  { comment: 'Unofficial Re-stream by SPACE AFFAIRS has started', createdOn: '2026-05-21T22:40:00Z' },
  { comment: 'Scrub for the day after hold at T-40.', createdOn: '2026-05-21T23:41:00Z' },
  { comment: 'Next attempt NET May 22.', createdOn: '2026-05-21T23:45:00Z' },
  { comment: 'Confirmed rescheduled for May 22.', createdOn: '2026-05-22T01:37:00Z' },
  { comment: 'Launch time is to the second.', createdOn: '2026-05-22T14:59:00Z' },
  { comment: 'Updated launch weather, 85% GO.', createdOn: '2026-05-22T15:32:00Z' },
  { comment: 'Unofficial Re-stream by SPACE AFFAIRS has started', createdOn: '2026-05-22T21:53:00Z' },
  { comment: 'Liftoff.', createdOn: '2026-05-22T22:30:00Z' },
  { comment: 'Successful liftoff and ascent of Starship and Super Heavy', createdOn: '2026-05-23T08:40:00Z' }
]
assert(!updatesSufficientForHistoryRebuild(PARTIAL_LATE_UPDATES), 'partial late window should be insufficient')
const patchPartial = tryBuildRoundsFromNetHistory(
  { launchId: VOTE_FLIGHT12_LAUNCH_ID, result: 'ge', votingClosed: true, settledAt: 'x', rounds: [{ round: 1, result: 'ge' }] },
  null,
  PARTIAL_LATE_UPDATES
)
assert(!patchPartial, 'partial updates must not build patch')
console.log('OK — reject partial updates cache window')
