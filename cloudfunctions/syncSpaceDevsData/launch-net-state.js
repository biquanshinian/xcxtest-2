const TERMINAL_STATUS_IDS = new Set([3, 4, 7, 9])

function isTerminalStatus(status) {
  const id = Number(status && status.id)
  return TERMINAL_STATUS_IDS.has(id)
}

function pruneStaleUpcomingResults(results, liveById, extraTerminalIds) {
  const kept = []
  const pruned = []
  const rows = Array.isArray(results) ? results : []
  const extra = extraTerminalIds instanceof Set ? extraTerminalIds : null
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
    } else if (extra && extra.has(id)) {
      // hide_recent 后探针看不到该 id，但 launch_status 已终态 → 必须剔除，否则残留旧 Go
      pruned.push({ id, reason: 'status_store_terminal' })
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

/**
 * previous 插入用列表 stub：显式挑字段，禁止 ...spread 整包 upcoming
 *（避免把 updates 等冷路径大字段打进 previous 批次）。
 */
function buildPreviousListStub(src, statusOverride, fallbacks) {
  if (!src || src.id == null) return null
  const fb = fallbacks || {}
  const status = statusOverride || src.status || null
  const cfg =
    (src.rocket && src.rocket.configuration) ||
    (src.rocket && src.rocket.rocket && src.rocket.rocket.configuration) ||
    null
  const rocketInner = src.rocket && src.rocket.rocket ? src.rocket.rocket : null
  const launcherStage =
    (src.rocket && src.rocket.launcher_stage) ||
    (rocketInner && rocketInner.launcher_stage) ||
    undefined
  const spacecraftStage =
    (src.rocket && src.rocket.spacecraft_stage) ||
    (rocketInner && rocketInner.spacecraft_stage) ||
    undefined
  const lsp = src.launch_service_provider || src.lsp || null
  const pad = src.pad || null
  const mission = src.mission || null
  const net = src.net || fb.net || ''
  return {
    id: src.id,
    name: (typeof src.name === 'string' && src.name) || fb.name || '',
    net,
    window_start: src.window_start || fb.windowStart || net,
    window_end: src.window_end || fb.windowEnd || '',
    status: status
      ? { id: status.id, name: status.name || '', abbrev: status.abbrev || '' }
      : null,
    mission: mission
      ? {
          name: mission.name || '',
          description: mission.description || '',
          orbit: mission.orbit || undefined
        }
      : null,
    rocket: {
      configuration: cfg
        ? {
            id: cfg.id,
            name: cfg.name || '',
            full_name: cfg.full_name || '',
            family: cfg.family,
            variant: cfg.variant,
            reusable: cfg.reusable === true || undefined
          }
        : undefined,
      launcher_stage: launcherStage,
      spacecraft_stage: spacecraftStage
    },
    launch_service_provider: lsp
      ? {
          id: lsp.id,
          name: lsp.name || '',
          abbrev: lsp.abbrev || '',
          country_code: lsp.country_code || null
        }
      : undefined,
    pad: pad
      ? {
          id: pad.id,
          name: pad.name || '',
          country_code: pad.country_code || undefined,
          location: pad.location
            ? {
                name: pad.location.name || '',
                country_code: pad.location.country_code || ''
              }
            : undefined
        }
      : undefined,
    image: src.image || undefined,
    infographic: src.infographic || undefined
  }
}

/**
 * 终态插入 previous 时优先复用列表 stub（pad/火箭/回收级），
 * 避免只剩 name+status 的瘦卡。
 */
function stubFromTerminalEntry(term) {
  if (!term || term.id == null) return null
  const fallbacks = {
    name: term.name || '',
    net: term.net || '',
    windowStart: term.windowStart || '',
    windowEnd: term.windowEnd || ''
  }
  if (term.launchStub && term.launchStub.id) {
    return buildPreviousListStub(term.launchStub, term.status, fallbacks)
  }
  return buildPreviousListStub(
    { id: term.id, name: term.name, net: term.net, status: term.status },
    term.status,
    fallbacks
  )
}

/**
 * 给终态条目挂上可写入 previous 的 launchStub。
 * 优先 upcoming 缓存行（prune 前），其次探针 list 行。
 */
function attachLaunchStubsToTerminalEntries(terminalEntries, upcomingRows, liveById) {
  if (!Array.isArray(terminalEntries) || !terminalEntries.length) return 0
  const upcomingById = new Map()
  if (Array.isArray(upcomingRows)) {
    for (let i = 0; i < upcomingRows.length; i++) {
      const row = upcomingRows[i]
      if (row && row.id != null) upcomingById.set(String(row.id), row)
    }
  }
  let attached = 0
  for (let i = 0; i < terminalEntries.length; i++) {
    const entry = terminalEntries[i]
    if (!entry || !entry.id || entry.launchStub) continue
    const id = String(entry.id)
    const cached = upcomingById.get(id)
    const live = liveById && liveById.get ? liveById.get(id) : null
    const src = cached || live
    if (!src) continue
    entry.launchStub = buildPreviousListStub(src, entry.status, {
      name: entry.name || '',
      net: entry.net || '',
      windowStart: entry.windowStart || '',
      windowEnd: entry.windowEnd || ''
    })
    if (entry.launchStub) attached++
  }
  return attached
}

module.exports = {
  isTerminalStatus,
  pruneStaleUpcomingResults,
  collectTerminalFromCachedUpcoming,
  buildPreviousListStub,
  stubFromTerminalEntry,
  attachLaunchStubsToTerminalEntries
}
