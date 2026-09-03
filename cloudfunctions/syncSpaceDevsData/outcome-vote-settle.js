/**
 * 成败竞猜：封盘 / 解封 / 终态结算（纯函数，供 settleVotes 与单测共用）
 *
 * 规则：
 * - 仅真实发射终态才揭晓（Success / Failure / Partial / Payload Deployed）
 * - Hold / TBD / Go / In Flight / scrub / abort 等推迟场景不结算、不算猜错
 * - 封盘仅在距 NET 0～30 分钟内；NET 后移或已过后未终态则解封
 */

const VOTE_TIME_TOLERANCE_MS = 30 * 60 * 1000

function parseVoteTimeMs(t) {
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function isNonTerminalStatusId(id) {
  const n = Number(id) || 0
  // 1 Go, 2 TBD, 5 Hold, 6 In Flight, 8 TBC
  return n === 1 || n === 2 || n === 5 || n === 6 || n === 8
}

/**
 * @param {string} statusCategory
 * @param {string} statusAbbrev
 * @param {string} statusName
 * @param {number|string} [statusId]
 * @returns {'success'|'failure'|''}
 */
function computeOutcomeResult(statusCategory, statusAbbrev, statusName, statusId) {
  const id = Number(statusId) || 0
  // LL2: 3 success, 4 failure, 7 partial failure, 9 payload deployed
  if (id === 3 || id === 9) return 'success'
  if (id === 4 || id === 7) return 'failure'
  if (isNonTerminalStatusId(id)) return ''

  const cat = String(statusCategory || '').toLowerCase().trim()
  if (cat === 'success' || cat === 'deployed') return 'success'
  if (cat === 'failure' || cat === 'partial') return 'failure'
  // 永久取消可判失败；临时 scrub/Hold 不会进 cancelled
  if (cat === 'cancelled') return 'failure'
  if (cat === 'delayed' || cat === 'pending' || cat === 'inflight') return ''

  const text = `${statusAbbrev || ''} ${statusName || ''}`.toLowerCase()
  // 禁止用 scrub/abort/hold/cancel 文本判失败（多为推迟）
  if (/payload\s*deployed/.test(text)) return 'success'
  if (/\bpartial\s*failure\b/.test(text)) return 'failure'
  if (/\bfailure\b/.test(text)) return 'failure'
  if (/\bsuccess\b/.test(text) && !/partial|failure|fail/.test(text)) return 'success'
  return ''
}

function computeOutcomeResultFromFound(found) {
  if (!found || !found.status) return ''
  return computeOutcomeResult(
    '',
    found.status.abbrev,
    found.status.name,
    found.status.id
  )
}

function latestLaunchTime(found, vote) {
  return (found && found.net) || (found && found.window_start) || (vote && vote.launchTime) || ''
}

/**
 * 查询侧动态封盘（对齐准时竞猜）：>30min 或 NET 已过未揭晓 → 开盘
 * @returns {{ votingClosed: boolean, votingClosedReason: string, dbPatch: object|null }}
 */
function resolveOutcomeVotingClosed(record, effectiveLaunchTime, nowMs, toleranceMs) {
  const tol = toleranceMs || VOTE_TIME_TOLERANCE_MS
  const now = nowMs || Date.now()
  if (record && (record.result === 'success' || record.result === 'failure')) {
    return { votingClosed: true, votingClosedReason: 'settled', dbPatch: null }
  }

  let votingClosed = !!(record && record.votingClosed)
  let votingClosedReason = ''
  const lt = parseVoteTimeMs(effectiveLaunchTime)
  if (lt > 0) {
    const timeToLaunch = lt - now
    if (timeToLaunch > tol) {
      votingClosed = false
    } else if (timeToLaunch < 0) {
      votingClosed = false
    } else {
      votingClosed = true
      votingClosedReason = 'time'
    }
  }

  let dbPatch = null
  if (record && record.votingClosed && !votingClosed) {
    dbPatch = {
      votingClosed: false,
      lockedLaunchTime: '',
      updatedAt: new Date(now).toISOString()
    }
  } else if (record && !record.votingClosed && votingClosed && votingClosedReason === 'time') {
    dbPatch = {
      votingClosed: true,
      lockedLaunchTime: effectiveLaunchTime || record.launchTime || '',
      updatedAt: new Date(now).toISOString()
    }
  }
  return { votingClosed, votingClosedReason, dbPatch }
}

/**
 * 已误结算但任务仍明显未终态 → 清空 result 重开。
 * 强信号（Hold/TBD/scrub 等）不依赖 NET 是否已后移；弱信号才要求 NET 已过或距发射 >30min。
 */
function shouldClearErroneousOutcomeSettle(record, statusCategory, statusAbbrev, statusName, statusId, effectiveLaunchTime, nowMs, toleranceMs) {
  if (!record || (record.result !== 'success' && record.result !== 'failure')) return false

  const id = Number(statusId) || 0
  if (isNonTerminalStatusId(id)) return true

  const text = `${statusAbbrev || ''} ${statusName || ''}`.toLowerCase()
  // 先认推迟文本，避免客户端陈旧 statusCategory=failure 挡住清空
  if (/hold|tbd|tbc|scrub|abort|推迟|待定|待确认/.test(text)) return true

  const cat = String(statusCategory || '').toLowerCase().trim()
  if (cat === 'delayed' || cat === 'pending' || cat === 'inflight') return true

  // 已是真实终态 → 绝不清空
  const live = computeOutcomeResult(statusCategory, statusAbbrev, statusName, statusId)
  if (live) return false

  // 弱信号：无明确终态、且 NET 不在「即将发射」窗口内（已过或 >30min）
  const tol = toleranceMs || VOTE_TIME_TOLERANCE_MS
  const now = nowMs || Date.now()
  const lt = parseVoteTimeMs(effectiveLaunchTime)
  if (!(lt > 0)) return false
  const timeToLaunch = lt - now
  return timeToLaunch > tol || timeToLaunch < 0
}

/**
 * 定时结算一轮：reopen / lock / settle
 * @returns {{ kind: 'none'|'reopen'|'lock'|'settle', patch?: object }}
 */
function applySettleOutcomeVotePass(vote, found, opts) {
  const nowMs = (opts && opts.nowMs) || Date.now()
  const THIRTY_MIN = (opts && opts.THIRTY_MIN) || VOTE_TIME_TOLERANCE_MS
  const iso = () => new Date(nowMs).toISOString()

  if (!vote || !vote.launchId) return { kind: 'none' }

  const latestTime = latestLaunchTime(found, vote)
  const status = (found && found.status) || {}

  if (vote.result === 'success' || vote.result === 'failure') {
    if (shouldClearErroneousOutcomeSettle(
      vote, '', status.abbrev, status.name, status.id, latestTime, nowMs, THIRTY_MIN
    )) {
      return {
        kind: 'reopen',
        patch: {
          result: '',
          resultNote: '',
          settledAt: '',
          votingClosed: false,
          lockedLaunchTime: '',
          launchTime: latestTime || vote.launchTime || '',
          updatedAt: iso()
        }
      }
    }
    return { kind: 'none' }
  }

  // 先揭晓终态，避免「NET 已过 → reopen」挡住 Success/Failure 结算
  const outcome = computeOutcomeResultFromFound(found)
  if (outcome) {
    return {
      kind: 'settle',
      patch: {
        result: outcome,
        resultNote: '系统按发射状态自动结算',
        votingClosed: true,
        settledAt: iso(),
        updatedAt: iso()
      }
    }
  }

  if (vote.votingClosed && latestTime) {
    const lt = parseVoteTimeMs(latestTime)
    if (lt > 0) {
      const timeToLaunch = lt - nowMs
      if (timeToLaunch > THIRTY_MIN || timeToLaunch < 0) {
        return {
          kind: 'reopen',
          patch: {
            votingClosed: false,
            lockedLaunchTime: '',
            launchTime: latestTime || vote.launchTime,
            updatedAt: iso()
          }
        }
      }
    }
  }

  if (!vote.votingClosed && (latestTime || vote.launchTime)) {
    const lt = parseVoteTimeMs(latestTime || vote.launchTime)
    const timeToLaunch = lt - nowMs
    // 仅 [0, 30min) 封盘；NET 已过（负数）不 lock
    if (lt > 0 && timeToLaunch >= 0 && timeToLaunch < THIRTY_MIN) {
      return {
        kind: 'lock',
        patch: {
          votingClosed: true,
          lockedLaunchTime: latestTime || vote.launchTime,
          updatedAt: iso()
        }
      }
    }
  }

  return { kind: 'none' }
}

module.exports = {
  VOTE_TIME_TOLERANCE_MS,
  parseVoteTimeMs,
  isNonTerminalStatusId,
  computeOutcomeResult,
  computeOutcomeResultFromFound,
  resolveOutcomeVotingClosed,
  shouldClearErroneousOutcomeSettle,
  applySettleOutcomeVotePass
}
