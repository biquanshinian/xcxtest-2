/**
 * 从 LL2 launch updates 重建竞猜多轮 rounds（纯函数，无云依赖）
 *
 * Flight 12 launchId: ed83366c-872c-4484-97c1-bc74832304fc
 */
const VOTE_FLIGHT12_LAUNCH_ID = 'ed83366c-872c-4484-97c1-bc74832304fc'
const VOTE_THIRTY_MIN = 30 * 60 * 1000

const VOTE_MONTH_MAP = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
}

function parseTimeMs(t) {
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function timesDiffer(a, b, toleranceMs) {
  const am = parseTimeMs(a)
  const bm = parseTimeMs(b)
  if (!am || !bm) return false
  return Math.abs(am - bm) > toleranceMs
}

function sameUtcDay(a, b) {
  const am = parseTimeMs(a)
  const bm = parseTimeMs(b)
  if (!am || !bm) return false
  const da = new Date(am)
  const db = new Date(bm)
  return da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
}

function isoFromMonthDay(monthName, day, hour, minute, refIso) {
  const mk = VOTE_MONTH_MAP[String(monthName || '').toLowerCase()]
  if (mk == null || !day) return ''
  let year = new Date().getUTCFullYear()
  if (refIso) {
    const rm = parseTimeMs(refIso)
    if (rm) year = new Date(rm).getUTCFullYear()
  }
  const d = new Date(Date.UTC(year, mk, day, hour, minute, 0))
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

function parseNetFromUpdateComment(comment, refIso) {
  if (!comment || typeof comment !== 'string') return ''
  const c = comment.trim()
  if (/^NET\s+[A-Za-z]+\.?\s*$/i.test(c)) return ''
  if (/^Targeting\s+[A-Za-z]+\.?\s*$/i.test(c)) return ''
  if (/NET\s+Q\d/i.test(c)) return ''

  let m = c.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)\b/)
  if (m) {
    let iso = m[1]
    if (iso.length === 17) iso = iso.replace('Z', ':00Z')
    return iso
  }

  m = c.match(/(?:now targeting|targeting)\s+([A-Za-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*UTC/i)
  if (m) {
    return isoFromMonthDay(m[1], Number(m[2]), Number(m[3]), Number(m[4]), refIso)
  }

  m = c.match(/(?:next attempt\s+)?NET\s+([A-Za-z]+)\.?\s*(\d{1,2})?(?:\s*,|\s|TBC|$)/i)
  if (m && m[2]) {
    return isoFromMonthDay(m[1], Number(m[2]), 22, 30, refIso)
  }

  return ''
}

function isScrubOrPostponeComment(comment) {
  const c = String(comment || '')
  // 「Next attempt NET May 22」是新一轮 NET 公告，不是 scrub 本身
  if (/next attempt\s+NET/i.test(c) && parseNetFromUpdateComment(c, '')) return false
  return /scrub|rescheduled|confirmed reschedule|next attempt|postpon|delay|hold at T-/i.test(c)
}

function shouldCloseAttempt(prevNet, nextNet, nextAnnouncedAt) {
  if (!prevNet || !nextNet) return false
  if (!sameUtcDay(prevNet, nextNet)) return true
  if (timesDiffer(prevNet, nextNet, VOTE_THIRTY_MIN)) return true
  const prevMs = parseTimeMs(prevNet)
  const annMs = parseTimeMs(nextAnnouncedAt)
  return prevMs > 0 && annMs > prevMs + VOTE_THIRTY_MIN
}

function extractAttemptNetsFromUpdates(updates) {
  const sorted = (updates || []).slice().sort(function (a, b) {
    return parseTimeMs(a.createdOn || a.created_on) - parseTimeMs(b.createdOn || b.created_on)
  })
  const closed = []
  let pendingNet = ''

  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]
    const comment = String(u.comment || '')
    const at = u.createdOn || u.created_on || ''
    const parsed = parseNetFromUpdateComment(comment, at)

    if (parsed) {
      if (pendingNet && shouldCloseAttempt(pendingNet, parsed, at)) {
        closed.push(pendingNet)
      }
      pendingNet = parsed
    }

    if (isScrubOrPostponeComment(comment) && pendingNet) {
      closed.push(pendingNet)
      pendingNet = ''
      if (parsed) pendingNet = parsed
    }
  }

  if (pendingNet) closed.push(pendingNet)
  return closed
}

function launchTerminal(found) {
  const abbrev = (found && found.status && found.status.abbrev) || ''
  const name = (found && found.status && found.status.name) || ''
  return /success|failure|partial failure|partial|cancel|scrub|abort|hold/i.test(abbrev) ||
    /cancel|scrub|abort/i.test(name)
}

/** launch 不在列表缓存时，从 updates 推断终态（如 Liftoff / scrub） */
function inferFoundFromUpdates(updates, launchId) {
  if (!updates || !updates.length) return null
  const sorted = updates.slice().sort(function (a, b) {
    return parseTimeMs(a.createdOn || a.created_on) - parseTimeMs(b.createdOn || b.created_on)
  })
  let liftoff = false
  for (let i = 0; i < sorted.length; i++) {
    if (/liftoff/i.test(String(sorted[i].comment || ''))) liftoff = true
  }
  if (liftoff) {
    const attempts = extractAttemptNetsFromUpdates(updates)
    const net = attempts.length ? attempts[attempts.length - 1] : ''
    return {
      id: launchId || '',
      net: net,
      status: { abbrev: 'Success', name: 'Launch Successful' }
    }
  }
  const last = sorted[sorted.length - 1]
  const lc = String(last.comment || '')
  if (/scrub|cancel|abort|hold at T-/i.test(lc) && !/next attempt\s+NET/i.test(lc)) {
    const attempts = extractAttemptNetsFromUpdates(updates)
    const net = attempts.length ? attempts[attempts.length - 1] : ''
    return {
      id: launchId || '',
      net: net,
      status: { abbrev: 'TBD', name: 'Scrubbed' }
    }
  }
  return null
}

function trimAttemptNetsForTerminal(attempts, found) {
  if (!attempts.length || !found || !launchTerminal(found)) return attempts
  const finalNet = (found && found.net) || ''
  if (attempts.length <= 4) {
    if (finalNet && attempts.length) {
      const last = attempts[attempts.length - 1]
      if (timesDiffer(last, finalNet, 1000)) {
        const copy = attempts.slice()
        copy[copy.length - 1] = finalNet
        return copy
      }
    }
    return attempts
  }

  const seenDays = new Set()
  const trimmed = []
  for (let i = attempts.length - 1; i >= 0 && trimmed.length < 4; i--) {
    const t = attempts[i]
    const dayKey = new Date(parseTimeMs(t)).toISOString().slice(0, 10)
    if (seenDays.has(dayKey)) continue
    seenDays.add(dayKey)
    trimmed.unshift(t)
  }

  if (finalNet && trimmed.length) {
    const last = trimmed[trimmed.length - 1]
    if (sameUtcDay(last, finalNet)) {
      trimmed[trimmed.length - 1] = finalNet
    } else if (parseTimeMs(finalNet) > parseTimeMs(last)) {
      trimmed.push(finalNet)
      if (trimmed.length > 4) trimmed.shift()
    }
  } else if (finalNet && !trimmed.length) {
    trimmed.push(finalNet)
  }

  return trimmed
}

function computeVoteResult(baselineTime, actualTime, statusAbbrev, statusName, toleranceMs) {
  if (/cancel|scrub|abort/i.test(statusAbbrev) || /cancel|scrub|abort/i.test(statusName)) {
    return 'ge'
  }
  if (actualTime) {
    const diffMs = Math.abs(parseTimeMs(actualTime) - parseTimeMs(baselineTime))
    return diffMs > toleranceMs ? 'ge' : 'buge'
  }
  return 'buge'
}

function buildRoundsFromAttemptNets(attemptNets, found) {
  if (!attemptNets.length) return null
  const nets = attemptNets.slice()
  const finalNet = (found && found.net) || nets[nets.length - 1]
  if (finalNet && nets.length && !sameUtcDay(nets[nets.length - 1], finalNet)) {
    nets.push(finalNet)
  } else if (finalNet && nets.length) {
    nets[nets.length - 1] = finalNet
  }
  if (nets.length < 2 && found && launchTerminal(found)) {
    return null
  }

  const abbrev = (found && found.status && found.status.abbrev) || ''
  const name = (found && found.status && found.status.name) || ''
  const settledAt = new Date().toISOString()
  const rounds = []

  for (let i = 0; i < nets.length; i++) {
    const isLast = i === nets.length - 1
    const launchTime = nets[i]
    let result = 'ge'
    if (isLast) {
      result = computeVoteResult(launchTime, finalNet, abbrev, name, VOTE_THIRTY_MIN) || 'buge'
    }
    rounds.push({
      round: i + 1,
      launchTime: launchTime,
      result: result,
      settledAt: settledAt
    })
  }

  const lastRound = rounds[rounds.length - 1]
  return {
    rounds: rounds,
    currentRound: lastRound.round,
    result: lastRound.result,
    launchTime: lastRound.launchTime,
    lockedLaunchTime: lastRound.launchTime,
    currentLaunchTime: finalNet || lastRound.launchTime,
    votingClosed: true,
    settledAt: settledAt,
    updatedAt: settledAt
  }
}

/** 是否具备从 updates 重建多轮 NET 历史的最低条件（用于拒绝仅含最新 N 条的残缺 cache） */
function updatesSufficientForHistoryRebuild(updates) {
  if (!updates || !updates.length) return false
  const attempts = extractAttemptNetsFromUpdates(updates)
  if (attempts.length >= 2) return true
  // 条数多但可解析 NET 过少：常见于只缓存了 fetchLaunchUpdates 的「最新 15 条」
  if (updates.length >= 8 && attempts.length < 2) return false
  return false
}

function voteTerminalFromRecord(vote, found) {
  if (found && launchTerminal(found)) return found
  if (!vote) return null
  const hasResult = vote.result === 'ge' || vote.result === 'buge'
  if (hasResult && vote.votingClosed && vote.settledAt) {
    const net = (found && found.net) || vote.currentLaunchTime || vote.launchTime || ''
    const abbrev = (found && found.status && found.status.abbrev) || ''
    const name = (found && found.status && found.status.name) || ''
    const terminalAbbrev = abbrev || (vote.result === 'buge' ? 'Success' : 'Success')
    const terminalName = name || (vote.result === 'buge' ? 'Launch Successful' : 'Launch Successful')
    return {
      id: vote.launchId || (found && found.id) || '',
      net: net,
      status: { abbrev: terminalAbbrev, name: terminalName }
    }
  }
  return found || null
}

function tryBuildRoundsFromNetHistory(vote, found, updates) {
  if (!updates || !updates.length) return null
  if (!updatesSufficientForHistoryRebuild(updates)) return null

  let launch = voteTerminalFromRecord(vote, found)
  if (!launch || !launchTerminal(launch)) {
    const inferred = inferFoundFromUpdates(updates, vote && vote.launchId)
    if (inferred) launch = inferred
  }
  if (!launch || !launchTerminal(launch)) return null

  let attempts = extractAttemptNetsFromUpdates(updates)
  attempts = trimAttemptNetsForTerminal(attempts, launch)
  if (attempts.length < 2) return null

  const initialTime =
    (vote && vote.launchTime) ||
    (vote && vote.rounds && vote.rounds[0] && vote.rounds[0].launchTime) ||
    attempts[0]
  if (initialTime && attempts.length && parseTimeMs(initialTime) < parseTimeMs(attempts[0])) {
    attempts.unshift(initialTime)
    attempts = trimAttemptNetsForTerminal(attempts, launch)
  }

  return buildRoundsFromAttemptNets(attempts, launch)
}

module.exports = {
  VOTE_FLIGHT12_LAUNCH_ID,
  VOTE_THIRTY_MIN,
  parseNetFromUpdateComment,
  extractAttemptNetsFromUpdates,
  trimAttemptNetsForTerminal,
  buildRoundsFromAttemptNets,
  inferFoundFromUpdates,
  updatesSufficientForHistoryRebuild,
  voteTerminalFromRecord,
  tryBuildRoundsFromNetHistory
}
