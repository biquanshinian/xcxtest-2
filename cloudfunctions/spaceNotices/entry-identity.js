/**
 * SPACE_NOTICES_FEATURE — 同步时保留已绑 LL2 身份（纯函数，可本地测）
 *
 * 匹配落空或写出空串时，禁止把库里的 ll2Id / NET / 发射台盖掉。
 * 更弱的新匹配也不能改绑更强的旧身份。
 */

function isBlank(value) {
  return value == null || String(value).trim() === ''
}

function stickyLaunchFromPrev(prev) {
  if (!prev || isBlank(prev.ll2Id)) return null
  return {
    launch: {
      ll2Id: prev.ll2Id,
      net: prev.net,
      pad: prev.pad,
      statusName: prev.statusName,
      statusAbbrev: prev.statusAbbrev,
      statusId: prev.statusId,
      agency: prev.agency,
      orbitName: prev.orbitName,
      subtitle: prev.rocketName,
      description: prev.description,
      windowStart: prev.windowStart,
      windowEnd: prev.windowEnd,
      isStarship: prev.isStarship
    },
    score: Number(prev.ll2Score) || 0
  }
}

function preferLaunchMatch(matched, prev) {
  if (!prev || isBlank(prev.ll2Id)) return matched || null
  if (!matched || !matched.launch) return stickyLaunchFromPrev(prev)
  if (String(matched.launch.ll2Id || '') === String(prev.ll2Id)) return matched
  const prevScore = Number(prev.ll2Score) || 0
  if (Number(matched.score) < prevScore) return stickyLaunchFromPrev(prev)
  return matched
}

function mergeEntryIdentity(prev, next) {
  if (!next) return next
  if (!prev) return next
  const out = Object.assign({}, next)
  if (isBlank(out.ll2Id) && !isBlank(prev.ll2Id)) {
    out.ll2Id = prev.ll2Id
    if (!out.ll2Score && prev.ll2Score) out.ll2Score = prev.ll2Score
  }
  if (isBlank(out.net) && !isBlank(prev.net)) out.net = prev.net
  if (!out.pad && prev.pad) out.pad = prev.pad
  if (!out.statusId && prev.statusId) out.statusId = prev.statusId
  if (isBlank(out.statusName) && !isBlank(prev.statusName)) out.statusName = prev.statusName
  if (isBlank(out.statusAbbrev) && !isBlank(prev.statusAbbrev)) out.statusAbbrev = prev.statusAbbrev
  if (isBlank(out.agency) && !isBlank(prev.agency)) out.agency = prev.agency
  if (isBlank(out.orbitName) && !isBlank(prev.orbitName)) out.orbitName = prev.orbitName
  if (String(out.ll2Id || '') === String(prev.ll2Id || '') && isBlank(out.windowStart) && !isBlank(prev.windowStart)) {
    out.windowStart = prev.windowStart
    out.windowEnd = prev.windowEnd || ''
    out.windowStartMs = prev.windowStartMs || 0
    out.windowEndMs = prev.windowEndMs || 0
  }
  return out
}

module.exports = {
  isBlank,
  stickyLaunchFromPrev,
  preferLaunchMatch,
  mergeEntryIdentity
}
