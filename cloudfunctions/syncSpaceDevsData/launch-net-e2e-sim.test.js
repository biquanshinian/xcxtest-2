/**
 * 端到端可执行模拟：不连云库，按当前生产算法走通
 * 「探针见 Success → attach stub → prune upcoming → 插入 previous → 前端占位」
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  pruneStaleUpcomingResults,
  collectTerminalFromCachedUpcoming,
  stubFromTerminalEntry,
  attachLaunchStubsToTerminalEntries,
  isTerminalStatus
} = require('./launch-net-state.js')

const ID_1739 = 'e1079d3a-c0a6-4b42-bc1d-92e48a5a78fc'

function statusEqual(a, b) {
  const aid = a && a.id != null ? Number(a.id) : null
  const bid = b && b.id != null ? Number(b.id) : null
  if (aid != null && bid != null && aid === bid) return true
  return false
}

/** 与 launch-net-hourly.patchPreviousStatusInPlace 同逻辑 */
function patchPreviousStatusInPlace(results, terminalById) {
  let patched = 0
  if (!Array.isArray(results) || !terminalById || !terminalById.size) return patched
  for (let i = 0; i < results.length; i++) {
    const row = results[i]
    if (!row || row.id == null) continue
    const term = terminalById.get(String(row.id))
    if (!term || !term.status) continue
    const curId = row.status && row.status.id != null ? Number(row.status.id) : 0
    const nextId = Number(term.status.id)
    if (curId === nextId && statusEqual(row.status, term.status)) continue
    if (isTerminalStatus(row.status) && !isTerminalStatus(term.status)) continue
    row.status = {
      id: term.status.id,
      name: term.status.name || '',
      abbrev: term.status.abbrev || ''
    }
    if (term.net) row.net = term.net
    if (term.windowStart) row.window_start = term.windowStart
    if (term.windowEnd) row.window_end = term.windowEnd
    patched++
  }
  return patched
}

function isSettledStatus(status) {
  const id = Number(status && status.id)
  return isTerminalStatus(status) || id === 6
}

/** 与 launch-net-hourly.syncTerminalIntoPreviousCache 分批插入核心同逻辑 */
function syncTerminalIntoPreviousMemory(terminalEntries, previousState) {
  const terminalById = new Map()
  for (let i = 0; i < terminalEntries.length; i++) {
    const e = terminalEntries[i]
    if (e && e.id && isSettledStatus(e.status)) terminalById.set(String(e.id), e)
  }
  if (!terminalById.size) return { patched: 0, inserted: 0, skipped: 'no_terminal' }

  const batch0 = previousState.batch0
  const foundIds = new Set()
  const all = previousState.allResults || []
  for (let i = 0; i < all.length; i++) {
    if (all[i] && all[i].id != null && terminalById.has(String(all[i].id))) {
      foundIds.add(String(all[i].id))
    }
  }

  let patched = patchPreviousStatusInPlace(batch0, terminalById)
  const missing = []
  terminalById.forEach((term, id) => {
    if (!foundIds.has(id)) missing.push(term)
  })
  let inserted = 0
  if (missing.length) {
    const existingIds = new Set(
      batch0.map((r) => (r && r.id != null ? String(r.id) : '')).filter(Boolean)
    )
    const stubs = missing
      .map(stubFromTerminalEntry)
      .filter((s) => s && s.id && !existingIds.has(String(s.id)))
      .sort((a, b) => {
        const am = a.net ? new Date(a.net).getTime() : 0
        const bm = b.net ? new Date(b.net).getTime() : 0
        return bm - am
      })
    if (stubs.length) {
      previousState.batch0 = stubs.concat(batch0)
      previousState.allResults = stubs.concat(all)
      previousState.count = (Number(previousState.count) || all.length) + stubs.length
      inserted = stubs.length
    }
  }
  return { patched, inserted, batch0HeadId: previousState.batch0[0] && previousState.batch0[0].id }
}

/** 与前端 merge 无 base 占位规则一致 */
function canInsertThinPlaceholder(entry, base, nowMs) {
  const sid = Number(entry.status && entry.status.id)
  const terminal = [3, 4, 7, 9].includes(sid)
  const inflight = sid === 6
  if (!terminal && !inflight) return false
  const netMs = entry.net ? new Date(entry.net).getTime() : NaN
  if (Number.isFinite(netMs) && netMs > nowMs) return false
  if (!base) {
    // 终态与飞行中均可近窗瘦卡占位，堵住 hide_recent 后 previous 尚未写上的空窗
    if (!Number.isFinite(netMs) || netMs < nowMs - 48 * 60 * 60 * 1000) return false
  }
  return true
}

function collectTerminalFromLive(liveRows) {
  const out = []
  const now = Date.now()
  for (let i = 0; i < liveRows.length; i++) {
    const r = liveRows[i]
    if (!r || r.id == null || !isTerminalStatus(r.status)) continue
    out.push({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : '',
      status: {
        id: r.status.id,
        name: r.status.name || '',
        abbrev: r.status.abbrev || ''
      },
      net: r.net || '',
      windowStart: r.window_start || '',
      windowEnd: r.window_end || '',
      settledAtMs: now,
      source: 'launch_net_hourly'
    })
  }
  return out
}

test('E2E 17-39: Success 探针 → previous 头部插入完整 stub，二次运行不重复', () => {
  const upcomingRow = {
    id: ID_1739,
    name: 'Falcon 9 Block 5 | Starlink Group 17-39',
    net: '2026-07-21T14:49:34Z',
    window_start: '2026-07-21T14:00:00Z',
    window_end: '2026-07-21T17:47:00Z',
    status: { id: 1, name: 'Go for Launch', abbrev: 'Go' },
    rocket: { configuration: { name: 'Falcon 9 Block 5' } },
    pad: { name: 'SLC-4E', location: { country_code: 'USA' } },
    launch_service_provider: { name: 'SpaceX', abbrev: 'SpX' }
  }
  const live = {
    ...upcomingRow,
    status: { id: 3, name: 'Launch Successful', abbrev: 'Success' }
  }
  const liveById = new Map([[ID_1739, live]])

  // 1) 就地 patch upcoming（模拟 applyNetPatch）
  upcomingRow.status = { ...live.status }
  upcomingRow.net = live.net

  // 2) 采集终态
  let terminalEntries = collectTerminalFromLive([live])
  const fromCache = collectTerminalFromCachedUpcoming([upcomingRow], liveById, new Set(terminalEntries.map((e) => e.id)))
  terminalEntries = terminalEntries.concat(fromCache)
  assert.equal(terminalEntries.length, 1)

  // 3) prune 前挂 stub
  const attached = attachLaunchStubsToTerminalEntries(terminalEntries, [upcomingRow], liveById)
  assert.equal(attached, 1)
  assert.equal(terminalEntries[0].launchStub.pad.name, 'SLC-4E')
  assert.equal(terminalEntries[0].launchStub.status.id, 3)

  // 4) prune upcoming
  const pruned = pruneStaleUpcomingResults([upcomingRow], liveById)
  assert.equal(pruned.results.length, 0)
  assert.equal(pruned.pruned[0].reason, 'live_terminal')

  // 5) 插入 previous（batch0 已有别的任务）
  const previousState = {
    count: 1,
    batch0: [
      {
        id: 'older-id',
        name: 'Older Mission',
        net: '2026-07-18T06:35:30Z',
        status: { id: 3, abbrev: 'Success' }
      }
    ],
    allResults: null
  }
  previousState.allResults = previousState.batch0.slice()

  const first = syncTerminalIntoPreviousMemory(terminalEntries, previousState)
  assert.equal(first.inserted, 1, '首次应插入')
  assert.equal(first.batch0HeadId, ID_1739, '应插到 previous 头部')
  assert.equal(previousState.batch0[0].pad.name, 'SLC-4E', '应带完整 upcoming stub')
  assert.equal(previousState.batch0[0].status.id, 3)
  assert.equal(previousState.batch0[1].id, 'older-id')
  assert.equal(previousState.count, 2)

  // 6) 二次探针：已在 previous → 只 patch，不重复插
  const second = syncTerminalIntoPreviousMemory(terminalEntries, previousState)
  assert.equal(second.inserted, 0, '二次不得重复插入')
  assert.equal(previousState.batch0.filter((r) => String(r.id) === ID_1739).length, 1)
})

test('E2E：hide_recent 后无 upcoming 卡，前端 48h 终态仍可瘦卡占位', () => {
  const now = Date.parse('2026-07-21T16:57:00Z')
  const settled = {
    id: ID_1739,
    name: 'Falcon 9 Block 5 | Starlink Group 17-39',
    net: '2026-07-21T14:49:34Z',
    status: { id: 3, abbrev: 'Success' }
  }
  // upcoming API 已 hide_recent，列表无此 id；previous 尚未刷到
  assert.equal(canInsertThinPlaceholder(settled, null, now), true)
  assert.equal(
    canInsertThinPlaceholder({ ...settled, status: { id: 6, abbrev: 'In Flight' } }, null, now),
    true,
    '无 base 时近窗飞行中也可瘦卡占位'
  )
  assert.equal(
    canInsertThinPlaceholder({ ...settled, net: '2026-07-18T14:49:34Z' }, null, now),
    false,
    '超 48h 不占位'
  )
})

test('E2E：仅 live list 无 upcoming 缓存时，仍能用 list 行插入 previous', () => {
  const live = {
    id: ID_1739,
    name: 'Falcon 9 Block 5 | Starlink Group 17-39',
    net: '2026-07-21T14:49:34Z',
    status: { id: 3, name: 'Launch Successful', abbrev: 'Success' }
  }
  const entries = collectTerminalFromLive([live])
  attachLaunchStubsToTerminalEntries(entries, null, new Map([[ID_1739, live]]))
  const previousState = { count: 0, batch0: [], allResults: [] }
  const res = syncTerminalIntoPreviousMemory(entries, previousState)
  assert.equal(res.inserted, 1)
  assert.equal(previousState.batch0[0].id, ID_1739)
  assert.equal(previousState.batch0[0].status.id, 3)
})

test('E2E：previous 已有同 id 时只改 status 不插第二份', () => {
  const entries = [
    {
      id: ID_1739,
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      status: { id: 9, name: 'Payload Deployed', abbrev: 'Deployed' },
      launchStub: {
        id: ID_1739,
        name: 'Falcon 9 Block 5 | Starlink Group 17-39',
        net: '2026-07-21T14:49:34Z',
        status: { id: 3, abbrev: 'Success' }
      }
    }
  ]
  const previousState = {
    count: 1,
    batch0: [
      {
        id: ID_1739,
        name: 'Falcon 9 Block 5 | Starlink Group 17-39',
        net: '2026-07-21T14:49:34Z',
        status: { id: 3, abbrev: 'Success' }
      }
    ],
    allResults: null
  }
  previousState.allResults = previousState.batch0.slice()
  const res = syncTerminalIntoPreviousMemory(entries, previousState)
  assert.equal(res.inserted, 0)
  assert.equal(res.patched, 1)
  assert.equal(previousState.batch0[0].status.id, 9)
  assert.equal(previousState.batch0.length, 1)
})

test('E2E：previous 写失败后，launch_status 近窗终态仍应作为补写候选', () => {
  const now = Date.parse('2026-07-21T16:57:00Z')
  const behind = 48 * 60 * 60 * 1000
  const rows = [
    {
      id: ID_1739,
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      status: { id: 3, abbrev: 'Success' },
      observedAtMs: now - 60 * 1000
    },
    {
      id: 'too-old',
      name: 'Old',
      net: '2026-07-01T00:00:00Z',
      status: { id: 3, abbrev: 'Success' },
      observedAtMs: now // 观测新也不能捞旧 NET
    },
    {
      id: 'inflight',
      name: 'Flying',
      net: '2026-07-21T15:00:00Z',
      status: { id: 6, abbrev: 'In Flight' },
      observedAtMs: now
    }
  ]
  const entries = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.id == null) continue
    const sid = Number(row.status && row.status.id)
    if (![3, 4, 6, 7, 9].includes(sid)) continue
    const netMs = row.net ? new Date(row.net).getTime() : NaN
    const obsMs = Number(row.observedAtMs || row.settledAtMs) || 0
    if (Number.isFinite(netMs)) {
      if (netMs < now - behind || netMs > now + 60 * 60 * 1000) continue
    } else if (!(obsMs >= now - behind)) {
      continue
    }
    entries.push(row)
  }
  assert.equal(entries.length, 2)
  assert.equal(entries[0].id, ID_1739)
  assert.equal(entries[1].id, 'inflight')

  const skipOk = new Set([ID_1739])
  const afterSkip = entries.filter((row) => !skipOk.has(String(row.id)))
  assert.equal(afterSkip.length, 1)
  assert.equal(afterSkip[0].id, 'inflight')
  const afterFail = entries.filter((row) => !(new Set()).has(String(row.id)))
  assert.equal(afterFail.length, 2)
})

test('E2E：飞行中探针 → previous 头部插入 stub，终态可升级覆盖', () => {
  const live = {
    id: 'cz3b-inflight',
    name: 'Long March 3B/E | Unknown Payload',
    net: '2026-07-23T12:00:00Z',
    window_start: '2026-07-23T11:52:00Z',
    window_end: '2026-07-23T12:54:00Z',
    status: { id: 6, name: 'Launch in Flight', abbrev: 'In Flight' },
    rocket: { configuration: { name: 'Long March 3B/E' } },
    pad: { name: 'Launch Complex 2 (LC-2)', location: { country_code: 'CHN' } },
    launch_service_provider: { name: 'CASC', abbrev: 'CASC' }
  }
  const entries = [
    {
      id: String(live.id),
      name: live.name,
      status: live.status,
      net: live.net,
      windowStart: live.window_start,
      windowEnd: live.window_end,
      settledAtMs: Date.parse('2026-07-23T12:07:00Z'),
      source: 'launch_net_hourly_inflight'
    }
  ]
  attachLaunchStubsToTerminalEntries(entries, null, new Map([[String(live.id), live]]))
  const previousState = { count: 0, batch0: [], allResults: [] }
  const first = syncTerminalIntoPreviousMemory(entries, previousState)
  assert.equal(first.inserted, 1)
  assert.equal(previousState.batch0[0].status.id, 6)
  assert.equal(previousState.batch0[0].pad.name, 'Launch Complex 2 (LC-2)')

  const terminalEntries = [
    {
      id: String(live.id),
      name: live.name,
      status: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
      net: live.net,
      settledAtMs: Date.parse('2026-07-23T13:00:00Z'),
      source: 'launch_net_hourly'
    }
  ]
  const second = syncTerminalIntoPreviousMemory(terminalEntries, previousState)
  assert.equal(second.inserted, 0)
  assert.equal(second.patched, 1)
  assert.equal(previousState.batch0[0].status.id, 3)
  assert.equal(previousState.batch0.length, 1)
})

test('E2E：空 previous results[] 仍可插入头部', () => {
  const entries = [
    {
      id: ID_1739,
      name: 'Falcon 9 Block 5 | Starlink Group 17-39',
      net: '2026-07-21T14:49:34Z',
      status: { id: 3, abbrev: 'Success' }
    }
  ]
  const previousState = { count: 0, batch0: [], allResults: [] }
  const res = syncTerminalIntoPreviousMemory(entries, previousState)
  assert.equal(res.inserted, 1)
  assert.equal(previousState.batch0[0].id, ID_1739)
})
