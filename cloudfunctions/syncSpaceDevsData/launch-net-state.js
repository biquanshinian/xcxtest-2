const TERMINAL_STATUS_IDS = new Set([3, 4, 7, 9])

function isTerminalStatus(status) {
  const id = Number(status && status.id)
  return TERMINAL_STATUS_IDS.has(id)
}

function pruneStaleUpcomingResults(results, liveById) {
  const kept = []
  const pruned = []
  const rows = Array.isArray(results) ? results : []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.id == null) {
      kept.push(row)
      continue
    }
    const id = String(row.id)
    const live = liveById && liveById.get(id)
    if (live && isTerminalStatus(live.status)) {
      pruned.push({ id, reason: 'live_terminal' })
    } else if (isTerminalStatus(row.status)) {
      pruned.push({ id, reason: 'cache_terminal' })
    } else {
      kept.push(row)
    }
  }
  return { results: kept, pruned }
}

function collectTerminalFromCachedUpcoming(cachedResults, liveById, alreadyIds, nowMs) {
  const out = []
  const rows = Array.isArray(cachedResults) ? cachedResults : []
  const seen = alreadyIds instanceof Set ? alreadyIds : new Set()
  const now = Number(nowMs) || Date.now()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.id == null || !isTerminalStatus(row.status)) continue
    const id = String(row.id)
    if (seen.has(id)) continue
    const live = liveById && liveById.get(id)
    if (live && !isTerminalStatus(live.status)) continue
    out.push({
      id,
      name: typeof row.name === 'string' ? row.name : '',
      status: { id: row.status.id, name: row.status.name || '', abbrev: row.status.abbrev || '' },
      net: row.net || '',
      windowStart: row.window_start || '',
      windowEnd: row.window_end || '',
      settledAtMs: now,
      source: 'launch_net_hourly_cache'
    })
  }
  return out
}

module.exports = { isTerminalStatus, pruneStaleUpcomingResults, collectTerminalFromCachedUpcoming }
