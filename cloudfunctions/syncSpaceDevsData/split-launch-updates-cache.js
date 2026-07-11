/**
 * 将 LL2 launch.updates 拆分写入 launch_timeline_cache/updates_{uuid}
 * 供历史详情「发射动态」与倒计时终态旁路复用（0 额外 LL2）。
 *
 * 全局 GET /updates/ 列表不含 launch 关联，冷路径只能靠
 * upcoming/previous detailed 嵌套的 updates（6h syncLaunches）。
 */
const UPDATES_PER_LAUNCH_MAX = 40
const SPLIT_CACHE_TTL_MS = 48 * 60 * 60 * 1000

function normalizeUpdateRow(u) {
  if (!u || typeof u !== 'object') return null
  const comment = String(u.comment || '').trim()
  if (!comment) return null
  return {
    id: u.id != null ? u.id : null,
    comment,
    infoUrl: typeof u.info_url === 'string' ? u.info_url.trim()
      : (typeof u.infoUrl === 'string' ? u.infoUrl.trim() : ''),
    createdOn: u.created_on || u.createdOn || '',
    createdBy: String(u.created_by || u.createdBy || '')
  }
}

function slimLaunchUpdates(raw) {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out = []
  for (let i = 0; i < raw.length && out.length < 15; i++) {
    const row = normalizeUpdateRow(raw[i])
    if (!row) continue
    // slim 缓存里仍用 LL2 原始字段名，兼容 buildLaunchUpdates
    out.push({
      id: row.id,
      comment: row.comment,
      info_url: row.infoUrl,
      created_by: row.createdBy,
      created_on: row.createdOn
    })
  }
  return out.length ? out : undefined
}

function mergeUpdateLists(primary, secondary) {
  const byKey = new Map()
  const push = (list) => {
    if (!Array.isArray(list)) return
    for (let i = 0; i < list.length; i++) {
      const n = normalizeUpdateRow(list[i])
      if (!n) continue
      const key = n.id != null ? `id:${n.id}` : `c:${n.createdOn}|${n.comment}`
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, n)
        continue
      }
      // 保留信息更全的一条
      if (!prev.infoUrl && n.infoUrl) byKey.set(key, n)
    }
  }
  push(primary)
  push(secondary)
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.createdOn || 0).getTime() - new Date(a.createdOn || 0).getTime())
    .slice(0, UPDATES_PER_LAUNCH_MAX)
}

/**
 * @param {object} db cloud.database()
 * @param {Array} launches slim/detailed launch 数组
 * @param {{ source?: string, onTerminal?: function }} [options]
 */
async function splitLaunchUpdatesIntoTimelineCache(db, launches, options) {
  if (!db || !Array.isArray(launches) || !launches.length) {
    return { launches: 0, docsWritten: 0, terminal: 0 }
  }
  const source = (options && options.source) || 'sync_launches_split'
  const onTerminal = options && typeof options.onTerminal === 'function' ? options.onTerminal : null
  const col = db.collection('launch_timeline_cache')
  const now = Date.now()
  let docsWritten = 0
  let withUpdates = 0
  let terminal = 0

  for (let i = 0; i < launches.length; i++) {
    const launch = launches[i]
    if (!launch || launch.id == null) continue
    const launchId = String(launch.id)
    const incoming = Array.isArray(launch.updates) ? launch.updates : []
    if (!incoming.length) continue
    withUpdates++

    let existing = []
    try {
      const doc = await col.doc('updates_' + launchId).get()
      const data = doc && doc.data
      if (data && Array.isArray(data.data)) existing = data.data
    } catch (e) {}

    const merged = mergeUpdateLists(incoming, existing)
    if (!merged.length) continue

    try {
      await col.doc('updates_' + launchId).set({
        data: {
          data: merged,
          totalCount: merged.length,
          updatedAtMs: now,
          expireAtMs: now + SPLIT_CACHE_TTL_MS,
          source,
          launchName: typeof launch.name === 'string' ? launch.name : ''
        }
      })
      docsWritten++
    } catch (e) {
      continue
    }

    if (onTerminal) {
      try {
        const n = await onTerminal(launchId, launch, merged)
        if (n) terminal += n
      } catch (e) {}
    }
  }

  return { launches: withUpdates, docsWritten, terminal }
}

module.exports = {
  UPDATES_PER_LAUNCH_MAX,
  SPLIT_CACHE_TTL_MS,
  slimLaunchUpdates,
  normalizeUpdateRow,
  mergeUpdateLists,
  splitLaunchUpdatesIntoTimelineCache
}
