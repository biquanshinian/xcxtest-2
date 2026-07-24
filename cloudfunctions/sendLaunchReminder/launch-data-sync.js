/**
 * 将 space_devs_cache upcoming 同步到 launch_data（sendLaunchReminder 本地副本）。
 * 与 syncSpaceDevsData/launch-data-sync.js 保持逻辑一致。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const LAUNCH_DATA_COLLECTION = 'launch_data'
const SPACE_DEVS_CACHE = 'space_devs_cache'
const UPCOMING_PARAMS = {
  format: 'json',
  hide_recent_previous: true,
  limit: 100,
  mode: 'detailed',
  offset: 0,
  ordering: 'net'
}
const UPCOMING_PATH = '/launches/upcoming/'
// 当前云端写入的是 _slim_v6，放最前确保第 1 次 doc 读即命中；
// 旧后缀仅作历史兜底（此前漏掉 v6 导致每个 tick 白读 6 个 key 后 miss，再兜底全量同步）
const CANDIDATE_SUFFIXES = ['_slim_v6', '_slim_v5', '_slim_v4', '_slim_v3', '_slim_v2', '_slim', '']

function sortedParamsString(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

/** 只读主缓存文档（1 次读），批量分片文档留给 readResultsFromCacheDoc 按需读取 */
async function readMainCacheDoc(urlPath, baseParams) {
  const sortedParams = sortedParamsString(baseParams)
  const cacheCollection = db.collection(SPACE_DEVS_CACHE)

  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = `api_cache_${urlPath}_${sortedParams}${sfx}`
    const d = await cacheCollection.doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      return { cacheKey: key, doc: d }
    }
  }
  return { cacheKey: null, doc: null }
}

/** 主文档的代际签名：缓存内容更新时间戳变化 = 需要重新全量同步 */
function cacheGenerationSignature(cacheKey, doc) {
  const wrap = (doc && doc.data) || {}
  const updatedAtMs =
    Number(wrap.updatedAtMs) ||
    Number(wrap.timestamp) ||
    (wrap.updatedAt instanceof Date ? wrap.updatedAt.getTime() : Number(wrap.updatedAt)) ||
    0
  return `${cacheKey}:${updatedAtMs}`
}

async function readResultsFromCacheDoc(cacheKey, doc) {
  if (!doc || !doc.data || !doc.data.data) return []
  const cacheCollection = db.collection(SPACE_DEVS_CACHE)
  const apiData = doc.data.data
  let allResults = []

  // 分批标记两种历史写法：主文档 isBatched + batchKeys（_legacy 写法）/ isBatch（旧写法）
  const isBatched = !!(apiData.isBatched || apiData.isBatch) ||
    (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)

  if (isBatched) {
    const batchKeys = Array.isArray(apiData.batchKeys) && apiData.batchKeys.length
      ? apiData.batchKeys
      : null
    if (batchKeys) {
      for (const batchKey of batchKeys.slice(0, 20)) {
        const batchDoc = await cacheCollection.doc(String(batchKey)).get().catch(() => null)
        const batchData = batchDoc && batchDoc.data && batchDoc.data.data
        if (batchData && Array.isArray(batchData.results)) {
          allResults = allResults.concat(batchData.results)
        }
      }
    } else {
      let batchIdx = 0
      while (batchIdx < 20) {
        const batchKey = `${cacheKey}_batch_${batchIdx}`
        const batchDoc = await cacheCollection.doc(batchKey).get().catch(() => null)
        if (!batchDoc || !batchDoc.data || !batchDoc.data.data) break
        const batchData = batchDoc.data.data
        if (batchData.results && Array.isArray(batchData.results)) {
          allResults = allResults.concat(batchData.results)
        }
        batchIdx++
      }
    }
  } else if (apiData.results && Array.isArray(apiData.results)) {
    allResults = apiData.results
  }

  return allResults
}

function pickWindowStartIso(launch) {
  if (!launch || typeof launch !== 'object') return ''
  return launch.net || launch.window_start || launch.window_end || ''
}

function missionNameFromLaunch(launch) {
  if (!launch) return ''
  const mn = launch.mission && launch.mission.name
  return String(mn || launch.name || '').substring(0, 20)
}

function rocketNameFromLaunch(launch) {
  if (!launch) return ''
  const cfg = launch.rocket && launch.rocket.configuration
  const name = cfg && (cfg.full_name || cfg.name)
  return String(name || '').substring(0, 20)
}

function padNameFromLaunch(launch) {
  if (!launch || !launch.pad) return ''
  return String(launch.pad.name || '').substring(0, 40)
}

function siteFromLaunch(launch) {
  if (!launch || !launch.pad || !launch.pad.location) return ''
  return String(launch.pad.location.name || '').substring(0, 40)
}

function recoveryMethodFromLaunch(launch) {
  const stages =
    (launch &&
      launch.rocket &&
      (launch.rocket.launcher_stage ||
        launch.rocket.first_stage ||
        (launch.rocket.rocket && launch.rocket.rocket.launcher_stage))) ||
    []
  const first = Array.isArray(stages) ? stages[0] : stages
  if (!first) return '一次性'

  const landing = first.landing
  if (!landing || landing.attempt === false) return '一次性'

  const typeObj = landing.type
  const abbrev = String(
    (typeObj && (typeObj.abbrev || typeObj.name)) || first.landing_type || ''
  ).toUpperCase()

  if (abbrev.includes('RTLS') || abbrev.includes('LAND')) return '陆地回收 (RTLS)'
  if (abbrev.includes('ASDS') || abbrev.includes('DRON') || abbrev.includes('SHIP')) {
    return '海上回收 (ASDS)'
  }
  if (abbrev.includes('EXPEND') || abbrev === 'EXP') return '一次性'
  if (landing.attempt) return '可回收'
  return '待确认'
}

function isUpcomingLaunch(launch, nowMs) {
  if (!launch || launch.id == null) return false
  const iso = pickWindowStartIso(launch)
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (!(t > 0)) return false
  const abbrev =
    launch.status && launch.status.abbrev
      ? String(launch.status.abbrev).toLowerCase()
      : ''
  if (['success', 'failure', 'partial failure', 'tbd'].includes(abbrev) && t < nowMs - 6 * 60 * 60 * 1000) {
    return false
  }
  return t >= nowMs - 2 * 60 * 60 * 1000
}

function mapLaunchToLaunchDataDoc(launch, nowMs) {
  const iso = pickWindowStartIso(launch)
  const windowDate = iso ? new Date(iso) : null
  return {
    id: String(launch.id),
    missionName: missionNameFromLaunch(launch),
    name: String(launch.name || '').substring(0, 40),
    rocketName: rocketNameFromLaunch(launch),
    windowStart: windowDate,
    launchTime: iso,
    padName: padNameFromLaunch(launch),
    pad: padNameFromLaunch(launch),
    site: siteFromLaunch(launch),
    recoveryMethod: recoveryMethodFromLaunch(launch),
    status: launch.status && launch.status.name ? String(launch.status.name) : '',
    statusId: launch.status && launch.status.id != null ? Number(launch.status.id) : null,
    syncedAt: nowMs,
    updatedAt: nowMs,
    source: 'space_devs_cache'
  }
}

async function upsertLaunchDataDoc(docId, data) {
  // TCB/wx-server-sdk 下 doc(id).update() 对不存在的文档不抛错、静默返回 updated:0、
  // 也不会创建文档，因此不能靠 update 抛错来 fallback set。
  // doc(id).set() 在文档不存在时创建、存在时整文档覆盖，正好契合每次同步重建完整 payload 的逻辑。
  await db.collection(LAUNCH_DATA_COLLECTION).doc(docId).set({ data })
  return 'upserted'
}

async function removeStaleLaunchData(activeIds, nowMs) {
  const _ = db.command
  // 与 sendLaunchReminder 结果通知窗口（48h）对齐：过早清理会导致终态结果扫不到 launch_data
  const staleBefore = new Date(nowMs - 48 * 60 * 60 * 1000)
  let removed = 0
  try {
    const oldRes = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({ windowStart: _.lt(staleBefore) })
      .limit(50)
      .get()
    const list = oldRes.data || []
    for (let i = 0; i < list.length; i++) {
      const row = list[i]
      const id = String(row.id || row._id || '')
      if (activeIds.has(id)) continue
      try {
        await db.collection(LAUNCH_DATA_COLLECTION).doc(row._id).remove()
        removed++
      } catch (e) {}
    }
  } catch (e) {
    console.warn('[launch-data-sync] cleanup fail', e.message || e)
  }
  return removed
}

/** 业务字段是否与现有文档一致（忽略 syncedAt/updatedAt 等每次都变的时间戳） */
function isLaunchDataDocUnchanged(existing, payload) {
  if (!existing) return false
  const COMPARE_FIELDS = [
    'id', 'missionName', 'name', 'rocketName', 'launchTime',
    'padName', 'pad', 'site', 'recoveryMethod', 'status', 'statusId', 'source'
  ]
  for (const f of COMPARE_FIELDS) {
    const a = existing[f] == null ? null : existing[f]
    const b = payload[f] == null ? null : payload[f]
    if (a !== b) return false
  }
  const aMs = existing.windowStart instanceof Date ? existing.windowStart.getTime() : 0
  const bMs = payload.windowStart instanceof Date ? payload.windowStart.getTime() : 0
  return aMs === bMs
}

/** 一次性读出 launch_data 现有文档（1 次查询），供 diff 用；失败返回 null 走全量写 */
async function readExistingLaunchDataMap() {
  try {
    const res = await db.collection(LAUNCH_DATA_COLLECTION).limit(1000).get()
    const map = {}
    for (const row of res.data || []) {
      map[String(row._id)] = row
    }
    return map
  } catch (e) {
    return null
  }
}

// 代际标记文档：记录上次同步时源缓存的签名，源缓存没更新就跳过全量同步。
// 源缓存最多每小时被 syncSpaceDevsData 刷新一次，而本函数每 10 分钟触发，
// 大多数 tick 只需 2 次读（主缓存文档 + 标记文档）即可确认无事可做。
const SYNC_META_DOC_ID = '_sync_meta'
// 签名未变时也强制重同步的最大间隔：兜底清理已过期任务 / 标记文档异常
const FORCE_RESYNC_INTERVAL_MS = 3 * 60 * 60 * 1000

async function readSyncMeta() {
  try {
    const res = await db.collection(LAUNCH_DATA_COLLECTION).doc(SYNC_META_DOC_ID).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function writeSyncMeta(meta) {
  try {
    await db.collection(LAUNCH_DATA_COLLECTION).doc(SYNC_META_DOC_ID).set({ data: meta })
  } catch (e) {}
}

async function syncLaunchDataFromCache() {
  const nowMs = Date.now()
  const stats = { upserted: 0, unchanged: 0, skipped: 0, removed: 0, total: 0 }

  const { cacheKey, doc } = await readMainCacheDoc(UPCOMING_PATH, UPCOMING_PARAMS)
  if (!doc) {
    return { success: true, message: 'no upcoming cache doc', ...stats }
  }

  // 代际比对：源缓存签名与上次同步一致且未超强制间隔 → 跳过批量读取与写库
  const signature = cacheGenerationSignature(cacheKey, doc)
  const meta = await readSyncMeta()
  if (
    meta &&
    meta.signature === signature &&
    Number(meta.lastSyncAtMs) > 0 &&
    nowMs - Number(meta.lastSyncAtMs) < FORCE_RESYNC_INTERVAL_MS
  ) {
    return {
      success: true,
      message: 'cache generation unchanged, sync skipped',
      skippedByGeneration: true,
      ...stats,
      total: Number(meta.total) || 0
    }
  }

  const raw = await readResultsFromCacheDoc(cacheKey, doc)
  const upcoming = (raw || []).filter(function (l) {
    return isUpcomingLaunch(l, nowMs)
  })
  stats.total = upcoming.length

  if (upcoming.length === 0) {
    await writeSyncMeta({ signature, lastSyncAtMs: nowMs, total: 0 })
    return { success: true, message: 'no upcoming launches in cache', ...stats }
  }

  // 绝大多数任务数据没有变化：先用 1 次查询读出现状，
  // 只对有实际变化的文档写库，避免每轮 ~100 次盲写
  const existingMap = await readExistingLaunchDataMap()
  const activeIds = new Set()

  for (let i = 0; i < upcoming.length; i++) {
    const launch = upcoming[i]
    const docId = String(launch.id)
    if (!docId) {
      stats.skipped++
      continue
    }
    activeIds.add(docId)

    try {
      const payload = mapLaunchToLaunchDataDoc(launch, nowMs)
      if (existingMap && isLaunchDataDocUnchanged(existingMap[docId], payload)) {
        stats.unchanged++
        continue
      }
      await upsertLaunchDataDoc(docId, payload)
      stats.upserted++
    } catch (e) {
      stats.skipped++
      console.warn('[launch-data-sync] upsert fail', docId, e.message || e)
    }
  }

  stats.removed = await removeStaleLaunchData(activeIds, nowMs)

  await writeSyncMeta({ signature, lastSyncAtMs: nowMs, total: stats.total })

  return {
    success: true,
    message: 'launch_data synced from space_devs_cache',
    ...stats
  }
}

module.exports = { syncLaunchDataFromCache }
