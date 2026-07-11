/**
 * 将 space_devs_cache 中的 upcoming 发射任务同步到 launch_data，
 * 供 sendLaunchReminder（B 通道服务号 + 偏好匹配）扫窗使用。
 *
 * 数据源：syncLaunches 写入的 api_cache_/launches/upcoming/_…_slim_v6
 * （小时级 syncLaunchNetHourly 会就地 patch 同文档的 net/window/status）
 * 目标字段：id、missionName、rocketName、windowStart、padName、recoveryMethod、site
 */
const { db } = require('./shared.js')

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

async function readLaunchResultsFromCache(urlPath, baseParams) {
  const sortedParams = sortedParamsString(baseParams)
  const cacheCollection = db.collection(SPACE_DEVS_CACHE)
  let cacheKey = null
  let doc = null

  for (const sfx of CANDIDATE_SUFFIXES) {
    const key = `api_cache_${urlPath}_${sortedParams}${sfx}`
    const d = await cacheCollection.doc(key).get().catch(() => null)
    if (d && d.data && d.data.data) {
      cacheKey = key
      doc = d
      break
    }
  }
  if (!doc || !doc.data || !doc.data.data) return []

  const apiData = doc.data.data
  let allResults = []
  // 分批写入主文档标记为 isBatched（shared.js / _legacy.js saveToCloudDB），
  // 历史上也可能出现 isBatch；再兜底「results 为空但 count>0」的分批情形。
  // 三者都要识别，否则只读到空的 results，扫窗会漏掉全部发射任务。
  const isBatched = !!(apiData.isBatched || apiData.isBatch)
    || (Array.isArray(apiData.results) && apiData.results.length === 0 && Number(apiData.count) > 0)

  if (isBatched) {
    let batchIdx = 0
    while (batchIdx < 40) {
      const batchKey = `${cacheKey}_batch_${batchIdx}`
      const batchDoc = await cacheCollection.doc(batchKey).get().catch(() => null)
      const batchData = batchDoc && batchDoc.data && batchDoc.data.data
      if (!batchData || !Array.isArray(batchData.results)) break
      allResults = allResults.concat(batchData.results)
      batchIdx++
    }
  }
  if (!allResults.length && apiData.results && Array.isArray(apiData.results)) {
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

/** 与小程序 subscribe.js 回收文案尽量一致 */
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
  const cfg = (launch.rocket && launch.rocket.configuration) || null
  const lsp = launch.launch_service_provider || launch.lsp || null
  return {
    id: String(launch.id),
    missionName: missionNameFromLaunch(launch),
    name: String(launch.name || '').substring(0, 40),
    rocketName: rocketNameFromLaunch(launch),
    // 供 getLaunchStats 定时预热型号/发射商统计使用：
    // rocketConfigName 必须是 LL2 configuration.name 原值（统计过滤参数 rocket__configuration__name）
    rocketConfigName: String((cfg && cfg.name) || ''),
    launchAgency: String((lsp && lsp.name) || ''),
    launchAgencyId: lsp && lsp.id != null ? lsp.id : null,
    windowStart: windowDate,
    launchTime: iso,
    padName: padNameFromLaunch(launch),
    pad: padNameFromLaunch(launch),
    site: siteFromLaunch(launch),
    recoveryMethod: recoveryMethodFromLaunch(launch),
    status: launch.status && launch.status.name ? String(launch.status.name) : '',
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
  const staleBefore = new Date(nowMs - 24 * 60 * 60 * 1000)
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

/**
 * @returns {Promise<{success:boolean, upserted:number, skipped:number, removed:number, total:number, message?:string}>}
 */
async function syncLaunchDataFromCache() {
  const nowMs = Date.now()
  const stats = { upserted: 0, skipped: 0, removed: 0, total: 0 }

  try {
    await db.createCollection(LAUNCH_DATA_COLLECTION)
  } catch (e) {}

  const raw = await readLaunchResultsFromCache(UPCOMING_PATH, UPCOMING_PARAMS)
  const upcoming = (raw || []).filter(function (l) {
    return isUpcomingLaunch(l, nowMs)
  })
  stats.total = upcoming.length

  if (upcoming.length === 0) {
    return {
      success: true,
      message: 'no upcoming launches in cache',
      ...stats
    }
  }

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
      await upsertLaunchDataDoc(docId, payload)
      stats.upserted++
    } catch (e) {
      stats.skipped++
      console.warn('[launch-data-sync] upsert fail', docId, e.message || e)
    }
  }

  stats.removed = await removeStaleLaunchData(activeIds, nowMs)

  return {
    success: true,
    message: 'launch_data synced from space_devs_cache',
    ...stats
  }
}

module.exports = {
  syncLaunchDataFromCache,
  readLaunchResultsFromCache
}
