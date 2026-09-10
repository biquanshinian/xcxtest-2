/**
 * 发射竞猜个人记录：准时 / 成败是两道独立题。
 * 历史集合可能有 (launchId, openid) 唯一索引，因此同一文档也可挂两个题型字段。
 */

function normalizeVoteType(t) {
  return String(t || '').trim() === 'outcome' ? 'outcome' : 'ontime'
}

function isOutcomeChoice(choice) {
  const c = String(choice || '').trim()
  return c === 'success' || c === 'failure'
}

function isOntimeChoice(choice) {
  const c = String(choice || '').trim()
  return c === 'ge' || c === 'buge'
}

function isVoteChoiceForType(choice, voteType) {
  return normalizeVoteType(voteType) === 'outcome' ? isOutcomeChoice(choice) : isOntimeChoice(choice)
}

function coerceChoiceForType(choice, voteType) {
  const vt = normalizeVoteType(voteType)
  const c = String(choice || '').trim()
  if (vt === 'outcome') {
    if (c === 'success' || c === 'failure') return c
    if (c === 'buge') return 'success'
    if (c === 'ge') return 'failure'
    return ''
  }
  if (c === 'ge' || c === 'buge') return c
  if (c === 'success') return 'buge'
  if (c === 'failure') return 'ge'
  return ''
}

function inferRecordVoteType(r) {
  if (!r) return 'ontime'
  if (String(r.voteType || '').trim() === 'outcome') return 'outcome'
  if (String(r.voteType || '').trim() === 'ontime') return 'ontime'
  if (isOutcomeChoice(r.choice)) return 'outcome'
  return 'ontime'
}

function recordChoiceForType(r, voteType) {
  const vt = normalizeVoteType(voteType)
  if (!r) return ''
  if (vt === 'outcome') {
    const fromField = coerceChoiceForType(r.outcomeChoice, 'outcome')
    if (fromField) return fromField
    if (inferRecordVoteType(r) === 'outcome') return coerceChoiceForType(r.choice, 'outcome')
    return ''
  }
  const fromField = coerceChoiceForType(r.ontimeChoice, 'ontime')
  if (fromField) return fromField
  if (inferRecordVoteType(r) === 'ontime') return coerceChoiceForType(r.choice, 'ontime')
  return ''
}

function pickUserVoteFromRecords(records, voteType) {
  const rows = Array.isArray(records) ? records : []
  const vt = normalizeVoteType(voteType)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const choice = recordChoiceForType(r, vt)
    if (!choice) continue
    const round = vt === 'outcome'
      ? (Number(r.outcomeRound) || Number(r.round) || 1)
      : (Number(r.ontimeRound) || Number(r.round) || 1)
    return { choice, record: r, round }
  }
  return { choice: '', record: null, round: 0 }
}

function buildUserVoteTypePatch(voteType, choice, round, launchTimeAtVote) {
  const vt = normalizeVoteType(voteType)
  if (vt === 'outcome') {
    return {
      outcomeChoice: choice,
      outcomeRound: round || 1,
      outcomeLaunchTimeAtVote: launchTimeAtVote || ''
    }
  }
  return {
    ontimeChoice: choice,
    ontimeRound: round || 1,
    ontimeLaunchTimeAtVote: launchTimeAtVote || ''
  }
}

/** 一条物理记录可能含两道题，展开成战绩列表项 */
function expandUserVoteRecords(records) {
  const rows = Array.isArray(records) ? records : []
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ontimeChoice = recordChoiceForType(r, 'ontime')
    const outcomeChoice = recordChoiceForType(r, 'outcome')
    if (ontimeChoice) {
      out.push({
        ...r,
        voteType: 'ontime',
        choice: ontimeChoice,
        round: Number(r.ontimeRound) || Number(r.round) || 1,
        launchTimeAtVote: r.ontimeLaunchTimeAtVote || r.launchTimeAtVote || ''
      })
    }
    if (outcomeChoice) {
      out.push({
        ...r,
        voteType: 'outcome',
        choice: outcomeChoice,
        round: Number(r.outcomeRound) || 1,
        launchTimeAtVote: r.outcomeLaunchTimeAtVote ||
          (inferRecordVoteType(r) === 'outcome' ? (r.launchTimeAtVote || '') : '')
      })
    }
  }
  return out
}

module.exports = {
  normalizeVoteType,
  isOutcomeChoice,
  isOntimeChoice,
  isVoteChoiceForType,
  coerceChoiceForType,
  inferRecordVoteType,
  recordChoiceForType,
  pickUserVoteFromRecords,
  buildUserVoteTypePatch,
  expandUserVoteRecords
}
