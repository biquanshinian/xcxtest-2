/**
 * syncSpaceDevsData 模块化入口
 *
 * 原 index.js (3781 行) 保留为 _legacy.js，本文件作为新入口
 * 通过 event.action 按需触发单个同步模块，减少每次调用的执行时间和内存消耗
 *
 * 支持的 action:
 *   (空/default)              — 全量同步（与原逻辑一致）
 *   'syncLaunches'            — 仅同步 launches/upcoming + launches/previous，并刷新 launch_data
 *   'syncLaunchData'          — 仅从 space_devs_cache 刷新 launch_data（供提醒扫窗）
 *   'syncEvents'              — 仅同步 events/upcoming + updates + articles
 *   'syncStations'            — 仅同步空间站 + expedition + docking
 *   'syncStats'               — 仅同步统计数据
 *   'syncRoadClosure'         — 仅同步封路通知
 *   'syncBoosters'            — 仅同步助推器族谱
 *   'syncAgencies'            — 仅同步发射机构
 *   'syncFeaturedAgencyDetails' — featured 机构详情自愈同步（6h 全量同步自动附带执行；
 *                               26h TTL 判断，单轮限额 maxSync/budgetMs 可通过 event 覆盖）
 *   'rebuildVoteSettle'       — 批量重算历史错误竞猜结算（支持 cursor 分批 / all 一次跑完）
 *   'syncStarshipHardware'    — 仅同步 NSF 星舰硬件设施（vehicles+tests+图片镜像）；
 *                               小时级 syncNextSpaceflightStarship 触发时会自动附带执行
 *   'syncImageMirror'         — LL2 外网图片镜像到 COS（机构 Logo/飞船/发射场/轨道事件/空间站），
 *                               6h 全量同步自动附带执行；手动触发可传 maxUploads/budgetMs 预热存量
 *   'syncLaunchNetHourly'     — 小时级 NET 时间基准：1 次 mode=list 探针，patch slim 缓存 net/status；
 *                               与 6h 全量错开（:30 触发，UTC 0/6/12/18 整点小时自动跳过）
 * 定时触发：云开发定时器**不能**在控制台 JSON 里写 `{"action":"..."}` 作为函数入参；
 * 小时级 NSF 请在「触发器配置」增加 `syncNextSpaceflightStarshipHourly`（Cron 见 config.json），
 * NET 探针请增加 `syncLaunchNetHourly`（Cron 见 config.json），
 * 或在测试里手动传 `event.action`。
 * 云函数超时见 config.json（当前 300s，全量同步实测约 136s，留足缓冲）。
 */
const { db, cloud, syncAPIEndpoint, LAUNCH_LIBRARY_API, fetchAPI } = require('./shared.js')
const { syncLaunchDataFromCache } = require('./launch-data-sync.js')
const { runSyncNextSpaceflightStarship } = require('./nextspaceflight-starship.js')
const { runSyncStarshipHardware } = require('./nextspaceflight-hardware.js')
const { runLaunchNetHourly } = require('./launch-net-hourly.js')

// 延迟加载 legacy 模块（仅在需要时加载 3781 行代码）
let _legacy = null
function getLegacy() {
  if (!_legacy) _legacy = require('./_legacy.js')
  return _legacy
}

// ── 模块化同步函数 ──

async function syncLaunches() {
  // 必须用 legacy.syncAPIEndpoint：与小程序共用 api_cache_…_slim_v4 规则，并对列表做 slim；勿用 shared.syncAPIEndpoint（写入 key 不一致且无 slim）
  const results = await getLegacy().runModularSyncLaunches()
  return { success: true, module: 'launches', results }
}

async function syncEvents() {
  // 必须用 legacy.syncAPIEndpoint：与小程序共用 api_cache_… key 规则；勿用 shared.syncAPIEndpoint（写入 key 不一致，客户端读不到）
  const results = await getLegacy().runModularSyncEvents()
  return { success: true, module: 'events', results }
}

async function syncStations() {
  // 必须用 legacy 路径：动态站点清单（LL2 新增站自动纳入）+ 与小程序共用 api_cache_… key 规则
  const results = await getLegacy().runModularSyncStations()
  return { success: true, module: 'stations', results }
}

let _syncSpaceDevsCollectionsEnsured = false
async function ensureSyncSpaceDevsCollectionsOnce() {
  if (_syncSpaceDevsCollectionsEnsured) return
  _syncSpaceDevsCollectionsEnsured = true
  const names = [
    'space_devs_cache',
    'launch_data',
    'booster_genealogy',
    'launch_stats',
    'spacex_launch_stats',
    'road_closure_notice',
    'nextspaceflight_starship_cache',
    'nextspaceflight_hardware_cache',
    'launch_timeline_cache',
    'translation_cache',
    'replay_fetch_queue',
    'mission_replays'
  ]
  for (const n of names) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
}

/** 定时触发器无法在 config 里传 event.action，按 TriggerName 分流到对应 action */
function resolveActionFromEvent(event) {
  const fromField = event && event.action != null ? String(event.action).trim() : ''
  if (fromField) return fromField
  const tn = String((event && (event.TriggerName || event.triggerName)) || '').trim()
  if (tn === 'syncNextSpaceflightStarshipHourly') return 'syncNextSpaceflightStarship'
  if (tn === 'syncLaunchNetHourly') return 'syncLaunchNetHourly'
  return ''
}

// 小程序端允许直接调用的 action 白名单；其余（全量同步 / 结算 / 导入等重维护任务）
// 仅限定时触发器或云函数间调用（adminGateway / sendLaunchReminder），防止客户端滥用耗尽 LL2 配额。
// fetchLaunch* 已全部直调 ll2Query；syncAgencies / syncNextSpaceflightStarship 改为仅服务端定时触发
const CLIENT_ALLOWED_ACTIONS = new Set([
  'syncAgencyDetail',
  'syncRoadClosure',
  'verifyRoadClosurePassword',
  'translateDiag',
  'version'
])

// 开发者工具「云端测试」(SOURCE=wx_devtools) 可手动跑的运维探针；正式小程序端 (wx_client) 仍拦截
const DEVTOOLS_TESTABLE_ACTIONS = new Set(['syncLaunchNetHourly', 'syncMissionReplayQueue', 'fillFlightHistory'])

function getInvocationSourceTail() {
  try {
    const ctx = cloud.getWXContext() || {}
    const chain = String(ctx.SOURCE || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return chain.length ? chain[chain.length - 1] : ''
  } catch (e) {
    return ''
  }
}

function isServerSideInvocation(event) {
  if (event && (event.TriggerName || event.triggerName)) return true
  try {
    const ctx = cloud.getWXContext() || {}
    const chain = String(ctx.SOURCE || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // 无 SOURCE：云开发 Web 控制台测试 / 部分 SCF 触发，不是小程序 callFunction
    if (!chain.length) return true
    const last = chain[chain.length - 1]
    // 新版 CloudBase 网页控制台的“运行测试”也会标成 wx_client，
    // 但它没有小程序用户 OPENID；真实 wx.cloud.callFunction 始终带 OPENID。
    if (last === 'wx_client' && !String(ctx.OPENID || '').trim()) return true
    return last !== 'wx_client' && last !== 'wx_devtools'
  } catch (e) {
    return false
  }
}

function isDevtoolsInvocation() {
  return getInvocationSourceTail() === 'wx_devtools'
}

function canInvokeRestrictedAction(action, event) {
  if (CLIENT_ALLOWED_ACTIONS.has(action)) return true
  if (isServerSideInvocation(event)) return true
  if (DEVTOOLS_TESTABLE_ACTIONS.has(action) && isDevtoolsInvocation()) return true
  return false
}

exports.main = async (event) => {
  await ensureSyncSpaceDevsCollectionsOnce()
  const action = resolveActionFromEvent(event || {})
  const startTime = Date.now()
  const sourceTail = getInvocationSourceTail()
  console.log(
    '[syncSpaceDevsData] action:',
    action || 'default',
    event && event.TriggerName ? `(TriggerName:${event.TriggerName})` : '',
    sourceTail ? `(SOURCE:${sourceTail})` : '(SOURCE:empty)'
  )

  if (!canInvokeRestrictedAction(action, event)) {
    console.warn(
      '[syncSpaceDevsData] 拦截客户端调用受限 action:',
      action || '(default full sync)',
      sourceTail || 'empty'
    )
    return { success: false, error: 'forbidden: action not allowed from client', timestamp: Date.now() }
  }

  try {
    switch (action) {
      case 'syncLaunches': {
        const slRes = {
          success: true,
          ...(await syncLaunches()),
          timestamp: Date.now(),
          elapsed: Date.now() - startTime
        }
        try {
          slRes.launchDataSync = await syncLaunchDataFromCache()
        } catch (e) {
          slRes.launchDataSync = { success: false, error: e.message || String(e) }
        }
        try {
          const vs = await getLegacy().main({ action: 'settleVotes' })
          slRes.voteSettle = vs && vs.voteSettle != null ? vs.voteSettle : vs
        } catch (e) {
          slRes._voteSettleError = e.message || String(e)
        }
        return slRes
      }

      case 'syncLaunchData':
        return {
          ...(await syncLaunchDataFromCache()),
          timestamp: Date.now(),
          elapsed: Date.now() - startTime
        }

      case 'syncLaunchNetHourly': {
        // 小时 NET 探针：仅服务端/定时器；force:true 可在全量同窗小时强制跑（测试用）
        const netRes = await runLaunchNetHourly({ force: !!(event && event.force) })
        // 附带小时级封路刷新（非 force，靠 syncRoadClosure 内 50 分钟缓存节流）；
        // 官网封路/延迟窗口常只有数小时，仅靠 6h 全量同步会整窗错过
        try {
          const roadRes = await getLegacy().main({ action: 'syncRoadClosureThrottled' })
          netRes.roadClosure = roadRes && roadRes.roadClosure != null ? roadRes.roadClosure : roadRes
        } catch (e) {
          netRes.roadClosure = { success: false, error: e.message || String(e) }
        }
        // 附带回放文档扫描（1 次 LL2 previous 探针 + 1 次事件库查询：集锦压缩版 + 完整回放外链）
        try {
          netRes.replayQueue = await require('./mission-replay.js')
            .runSyncMissionReplayQueue(db, fetchAPI, LAUNCH_LIBRARY_API)
        } catch (e) {
          netRes.replayQueue = { success: false, error: e.message || String(e) }
        }
        return { ...netRes, module: 'launch_net_hourly', elapsed: Date.now() - startTime }
      }

      case 'syncMissionReplayQueue': {
        // 手动触发回放文档扫描（仅服务端/云开发控制台）
        const r = await require('./mission-replay.js').runSyncMissionReplayQueue(db, fetchAPI, LAUNCH_LIBRARY_API)
        return { ...r, module: 'mission_replay_queue', timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'syncEvents':
        return { success: true, ...(await syncEvents()), timestamp: Date.now(), elapsed: Date.now() - startTime }

      case 'translateDiag': {
        // 只读诊断：确认 TMT 配置 / 实测翻译 / translation_cache 文档数
        const diag = await require('./translate.js').runTranslateDiag()
        return { success: true, ...diag, timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'cleanTranslationCache': {
        // 清洗历史伪中文缓存条目（仅限服务端/手动触发）
        const cleanRes = await require('./translate.js').cleanTranslationCache()
        return { ...cleanRes, timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'syncStations':
        return { success: true, ...(await syncStations()), timestamp: Date.now(), elapsed: Date.now() - startTime }

      case 'syncNextSpaceflightStarship': {
        const r = await runSyncNextSpaceflightStarship(db)
        // 小时级触发器顺带同步硬件设施；模块内置 6 小时节流，间隔未到直接跳过（不发外部请求）
        let hardware
        try {
          hardware = await runSyncStarshipHardware(db, cloud, {})
        } catch (e) {
          hardware = { success: false, error: e.message || String(e) }
        }
        return { ...r, hardware, timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'syncStarshipHardware': {
        // 手动触发默认 force 跳过节流；显式传 force:false 可测试节流行为
        const force = !(event && event.force === false)
        const r = await runSyncStarshipHardware(db, cloud, {
          force,
          skipImages: !!(event && event.skipImages),
          imageBudgetMs: event && typeof event.imageBudgetMs === 'number' ? event.imageBudgetMs : undefined
        })
        return { ...r, timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'syncImageMirror': {
        // LL2 外网图镜像到 COS（机构 Logo / 飞船 / 发射场 / 轨道事件 / 空间站）
        // 仅服务端可调（不在 CLIENT_ALLOWED_ACTIONS）；手动触发可传更大预算预热存量
        const r = await require('./image-mirror.js').runImageMirrorSync({
          maxUploads: event && typeof event.maxUploads === 'number' ? event.maxUploads : 40,
          budgetMs: event && typeof event.budgetMs === 'number' ? event.budgetMs : 120000
        })
        return { ...r, timestamp: Date.now(), elapsed: Date.now() - startTime }
      }

      case 'syncStats':
      case 'syncRoadClosure':
      case 'syncRoadClosureThrottled':
      case 'syncBoosters':
      case 'syncAgencies':
      case 'syncAgencyDetail':
      case 'syncFeaturedAgencyDetails':
      case 'verifyRoadClosurePassword':
      case 'initCollections':
      case 'autoCleanVotes':
      case 'settleVotes':
      case 'rebuildVoteSettle':
      case 'batchRecalculateVotes':
      case 'version':
        // 透传给 legacy 处理
        return getLegacy().main(event)

      case 'fillFlightHistory':
        return await fillFlightHistoryAction(event)

      default: {
        // 全量同步 — 透传给 legacy（默认分支不含竞猜结算，需显式追加）
        const result = await getLegacy().main(event)
        try {
          const voteSettle = await getLegacy().main({ action: 'settleVotes' })
          result.voteSettle = voteSettle && voteSettle.voteSettle != null ? voteSettle.voteSettle : voteSettle
          const voteClean = await getLegacy().main({ action: 'autoCleanVotes' })
          result.voteClean = voteClean && voteClean.voteClean != null ? voteClean.voteClean : voteClean
        } catch (e) {
          result._voteMaintainError = e.message || String(e)
          console.error('[syncSpaceDevsData] vote settle/clean failed:', e)
        }
        // agencies 自愈式低频同步：每 6h 轮检查聚合缓存，缺失或超过 26h 才真正同步。
        // 旧逻辑只在 UTC 0 点那一轮同步，一旦该轮失败/超时，「全球发射商图鉴」
        // 要再等 24h 才有机会恢复；现在最多 6h 内自动补上。
        try {
          const AGENCIES_AGGREGATE_KEY = `api_cache_/agencies/_${JSON.stringify({ format: 'json', limit: 400, offset: 0 })}`
          const AGENCIES_MAX_AGE_MS = 26 * 60 * 60 * 1000
          let needAgencySync = true
          try {
            // 文档内容 = { data: payload, timestamp, expireAt }（saveToCloudDB 写入结构）
            const aggDoc = await db.collection('space_devs_cache').doc(AGENCIES_AGGREGATE_KEY).get()
            const cacheData = aggDoc && aggDoc.data
            const ts = cacheData && cacheData.timestamp
            const payload = cacheData && cacheData.data
            const hasData = !!(payload && ((Array.isArray(payload.results) && payload.results.length > 0) || Number(payload.count) > 0))
            if (hasData && ts && Date.now() - ts < AGENCIES_MAX_AGE_MS) needAgencySync = false
          } catch (e) { /* 文档不存在：需要同步 */ }
          if (needAgencySync) {
            console.log('[syncSpaceDevsData] agencies 缓存缺失或超 26h，自动同步...')
            const agencyResult = await getLegacy().main({ action: 'syncAgencies' })
            const agencies = agencyResult && agencyResult.agencies
            result._dailyAgencies = {
              success: !!(agencies && agencies.success !== false),
              total: (agencies && agencies.total) || 0,
              skippedWrite: !!(agencies && agencies.skippedWrite)
            }
          } else {
            result._dailyAgencies = { success: true, skipped: true, reason: 'cache_fresh' }
          }
        } catch (e) {
          result._dailyAgencies = { success: false, error: e.message }
        }
        // featured 机构详情自愈同步：详情页依赖单机构详情文档（api_cache_/agencies/{id}/），
        // 前端已不再触发 syncAgencyDetail，若服务端不补位，详情缓存永远为空，
        // 详情页会永远显示「部分数据待补全」。函数内置 26h TTL 判断，缓存新鲜时零外部请求。
        try {
          result._agencyDetails = await getLegacy().syncFeaturedAgencyDetails({
            maxSync: 12,
            budgetMs: 120 * 1000
          })
        } catch (e) {
          result._agencyDetails = { success: false, error: e.message || String(e) }
        }
        // 复用本 6 小时定时器刷新「当前年全球发射统计」缓存（getLaunchStats 侧落库），
        // 客户端只读云端缓存即可秒回；往年已是 final 永久缓存，这里只动当前年。
        try {
          const statsRefresh = await cloud.callFunction({
            name: 'getLaunchStats',
            data: { action: 'refreshCurrentYear' }
          })
          result._currentYearStats = statsRefresh.result || { success: false, error: 'empty' }
          console.log('[stats] 定时预热 refreshCurrentYear 完成:', JSON.stringify(result._currentYearStats))
        } catch (e) {
          result._currentYearStats = { success: false, error: e.message || String(e) }
          console.error('[stats] 定时预热转发 getLaunchStats 失败:', e && (e.message || e))
        }
        // 定时维护助推器飞行历史：已全量完成后每轮只刷第 1 页捕获新发射（预算 120s 防撞函数超时）
        try {
          result._flightHistory = await fillFlightHistoryAction({ useProd: true, budgetMs: 120 * 1000 })
          console.log('[flightHistory] 定时刷新:', JSON.stringify(result._flightHistory))
        } catch (e) {
          result._flightHistory = { success: false, error: e.message || String(e) }
        }
        // LL2 外网图镜像到 COS：与 agencies/events/stations 同步同轮执行，
        // 存量预热完成后每轮只有零星增量（预算 120s，跑不完下轮续）
        try {
          result._imageMirror = await require('./image-mirror.js').runImageMirrorSync({
            maxUploads: 40,
            budgetMs: 120 * 1000
          })
        } catch (e) {
          result._imageMirror = { success: false, error: e.message || String(e) }
        }
        return result
      }
    }
  } catch (error) {
    return { success: false, error: error.message, timestamp: Date.now() }
  }
}

/**
 * 独立 action：从 LL2 拉取 SpaceX 历史发射数据，直接写入 booster_genealogy 的 flightHistory
 *
 * 设计原则：
 * 1. 单次调用内循环拉取所有页（云函数后台超时 800s，预算 650s，完全够用）
 * 2. 每拉完一页立即落库（merge 只增不减）+ 保存进度，中途挂掉下次从断点继续
 * 3. 前端只负责触发（fire-and-forget），不等待结果；进度可查 _flight_history_progress 文档
 * 4. 全部拉完后标记 completed；之后再触发只刷新第 1 页（捕获新发射），不再全量翻页
 * 5. event.useProd=true 时用生产 API（带 LL2_API_TOKEN），默认用开发版 API（无限速）测试
 */
async function fillFlightHistoryAction(event) {
  const collection = db.collection('booster_genealogy')
  const forceRefresh = !!(event && event.forceRefresh)
  // backfillOnly：跳过 SpaceX 全量翻页，只跑非 SpaceX 箭补齐（控制台同步测试 20s 内能返回）
  const backfillOnly = !!(event && event.backfillOnly)
  // 默认生产版 API；传 useDev: true 才用开发版（无限速、旧数据，仅测试用）
  const useProd = !(event && event.useDev)
  const startTime = Date.now()
  const TIME_BUDGET_MS = (event && event.budgetMs) || 650 * 1000

  const apiHost = useProd ? 'll.thespacedevs.com' : 'lldev.thespacedevs.com'
  const baseUrl = `https://${apiHost}/2.3.0/launches/previous/?search=SpaceX&mode=detailed&format=json&limit=100&ordering=-net`

  // ── 读进度 ──
  let progress = { page: 0, nextUrl: null, lastRunAt: 0, completed: false }
  try {
    const pDoc = await collection.doc('_flight_history_progress').get()
    if (pDoc && pDoc.data) progress = pDoc.data
  } catch (_) {}

  if (forceRefresh) {
    progress = { page: 0, nextUrl: null, lastRunAt: 0, completed: false }
  }

  // 已完成的情况：只刷新第 1 页捕获新发射，不再全量翻页
  const refreshOnly = progress.completed && !forceRefresh
  console.log(
    '[flightHistory] mode:',
    backfillOnly ? 'backfill-only' : refreshOnly ? 'refresh-first-page' : 'full-sync',
    'budgetMs:', TIME_BUDGET_MS,
    'progress:', JSON.stringify({ page: progress.page, completed: progress.completed })
  )

  let url = refreshOnly ? baseUrl : progress.nextUrl || baseUrl
  let page = refreshOnly ? 0 : progress.page || 0
  let totalLaunches = 0
  let totalUpdated = 0
  const errors = []

  // 单箭飞行记录合并落库（merge：新增记录 + 修正待定状态，不减少）；返回是否发生写入
  const mergeHistoryForSerial = async (sn, records) => {
    const docId = sn.replace(/[^a-zA-Z0-9_-]/g, '_')
    const existDoc = await collection
      .doc(docId)
      .get()
      .catch(() => null)
    const existingHistory =
      existDoc && existDoc.data && Array.isArray(existDoc.data.flightHistory) ? existDoc.data.flightHistory : []

    const keyOf = (h) => (h.date || '').split('T')[0] + '|' + (h.mission || '')
    const byKey = {}
    for (const h of existingHistory) byKey[keyOf(h)] = h

    const merged = [...existingHistory]
    let changed = false
    for (const r of records) {
      const key = keyOf(r)
      const exist = byKey[key]
      if (!exist) {
        merged.push(r)
        byKey[key] = r
        changed = true
      } else {
        // 已有记录：修正待定状态（首次同步时发射还在进行中，success 为 null）
        if (
          (exist.success === null || exist.success === undefined) &&
          (r.success === true || r.success === false)
        ) {
          exist.success = r.success
          changed = true
        }
        // 补充缺失的 launchId（旧数据没有此字段）
        if (!exist.launchId && r.launchId) {
          exist.launchId = r.launchId
          changed = true
        }
      }
    }
    merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    if (!changed) return false
    if (existDoc && existDoc.data) {
      await collection.doc(docId).update({ data: { flightHistory: merged } })
    } else {
      await collection.doc(docId).set({ data: { serialNumber: sn, flightHistory: merged } })
    }
    return true
  }

  // ── 循环拉取，直到拉完 / 时间预算用尽 ──
  while (!backfillOnly && url && Date.now() - startTime < TIME_BUDGET_MS) {
    let data = null
    // 每页最多重试 2 次
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        data = await _httpGetJson(url, 60000)
      } catch (e) {
        if (attempt === 1) {
          errors.push(`page ${page}: ${e.message}`)
        }
      }
    }
    if (!data || !Array.isArray(data.results)) break

    const launches = data.results
    totalLaunches += launches.length

    // ── 提取助推器飞行记录（Falcon B1xxx + Starship Booster N） ──
    const boosterFlights = {}
    for (const launch of launches) {
      const stages = (launch.rocket && launch.rocket.launcher_stage) || []
      if (!Array.isArray(stages)) continue
      for (const stage of stages) {
        if (!stage) continue
        const sn = stage.serial_number || (stage.launcher && stage.launcher.serial_number) || ''
        if (!sn) continue
        if (!/^B\d{4}$/i.test(sn) && !/^Booster\s*\d+$/i.test(sn)) continue

        if (!boosterFlights[sn]) boosterFlights[sn] = []
        const statusAbbrev = (launch.status && launch.status.abbrev) || ''
        const isSuccess = statusAbbrev === 'Success' || statusAbbrev === 'Partial Failure'
        const isFailed = statusAbbrev === 'Failure'
        boosterFlights[sn].push({
          mission: launch.name || '',
          date: launch.net || '',
          success: isSuccess ? true : isFailed ? false : null,
          launchId: launch.id ? String(launch.id) : ''
        })
      }
    }

    // ── 立即落库；按 8 并发分批，替代逐条串行 DB 往返 ──
    const mergeOneBooster = async (sn) => {
      try {
        if (await mergeHistoryForSerial(sn, boosterFlights[sn])) totalUpdated++
      } catch (e) {
        errors.push(`write ${sn}: ${e.message}`)
      }
    }

    const serials = Object.keys(boosterFlights)
    const WRITE_CONCURRENCY = 8
    for (let bi = 0; bi < serials.length; bi += WRITE_CONCURRENCY) {
      await Promise.all(serials.slice(bi, bi + WRITE_CONCURRENCY).map(mergeOneBooster))
    }

    page++
    url = data.next || null

    // refreshOnly 模式只拉第 1 页
    if (refreshOnly) break

    // ── 每页保存断点 ──
    try {
      await collection.doc('_flight_history_progress').set({
        data: { page: page, nextUrl: url, lastRunAt: Date.now(), completed: !url }
      })
    } catch (_) {}
  }

  // ── 收尾：保存最终进度（backfillOnly 未翻页，不动进度文档） ──
  const isCompleted = backfillOnly ? !!progress.completed : (refreshOnly ? true : !url)
  if (!backfillOnly) {
    try {
      await collection.doc('_flight_history_progress').set({
        data: { page: page, nextUrl: url, lastRunAt: Date.now(), completed: isCompleted }
      })
    } catch (_) {}
  }

  // ── 非 SpaceX 箭实体飞行历史补齐 ──
  // 上面的翻页只覆盖 search=SpaceX + B/Booster 序列号，其它厂商（Electron / New Glenn /
  // 长十乙 / 朱雀三号…）的 flightHistory 永远为空 → 箭实体详情页"历史任务"空白。
  // 这里用 LL2 launches 的 ?serial_number= 精确过滤逐箭补齐（每箭 1 次请求，
  // 只处理 flightHistory 条数 < flights 的箭，补齐后不再重复请求）。
  let backfillChecked = 0
  let backfillUpdated = 0
  try {
    const isSpaceXSerial = (s) =>
      /^B\d{4}$/i.test(s) || /^Booster\s*\d+$/i.test(s) || /^SN\d+$/i.test(s) || /^Ship\s*\d+$/i.test(s) || s === 'Starhopper'
    const _ = db.command
    // 云函数端 100/批，最多 2 批覆盖全部箭实体
    let boosterDocs = []
    for (let i = 0; i < 2; i++) {
      const res = await collection
        .where({ serialNumber: _.exists(true) })
        .field({ serialNumber: true, flights: true, flightHistory: true })
        .skip(i * 100)
        .limit(100)
        .get()
      const batch = res.data || []
      boosterDocs = boosterDocs.concat(batch)
      if (batch.length < 100) break
    }
    const needFill = boosterDocs.filter((b) => {
      const sn = b.serialNumber || ''
      if (!sn || isSpaceXSerial(sn)) return false
      const historyLen = Array.isArray(b.flightHistory) ? b.flightHistory.length : 0
      return historyLen < (b.flights || 0)
    })

    const MAX_BACKFILL_PER_RUN = (event && event.backfillLimit) || 15
    console.log('[flightHistory] backfill 待补齐:', needFill.length, '本轮上限:', MAX_BACKFILL_PER_RUN)
    // 补齐有独立的 90s 时间窗（不与 SpaceX 翻页抢预算），但整体不超过函数 800s 超时的安全线
    const backfillDeadline = Math.min(Date.now() + 90 * 1000, startTime + 740 * 1000)
    for (const b of needFill.slice(0, MAX_BACKFILL_PER_RUN)) {
      if (Date.now() > backfillDeadline) break
      backfillChecked++
      try {
        const q = `https://${apiHost}/2.3.0/launches/previous/?serial_number=${encodeURIComponent(b.serialNumber)}&mode=list&limit=20&format=json&ordering=net`
        const data = await _httpGetJson(q, 15000)
        const rows = (data && Array.isArray(data.results)) ? data.results : []
        console.log('[flightHistory] backfill', b.serialNumber, '→', rows.length, '条任务')
        if (!rows.length) continue
        const records = rows.map((launch) => {
          const statusAbbrev = (launch.status && launch.status.abbrev) || ''
          const isSuccess = statusAbbrev === 'Success' || statusAbbrev === 'Partial Failure'
          const isFailed = statusAbbrev === 'Failure'
          return {
            mission: launch.name || '',
            date: launch.net || '',
            success: isSuccess ? true : isFailed ? false : null,
            launchId: launch.id ? String(launch.id) : ''
          }
        })
        if (await mergeHistoryForSerial(b.serialNumber, records)) backfillUpdated++
      } catch (e) {
        errors.push(`backfill ${b.serialNumber}: ${e.message}`)
      }
    }
  } catch (e) {
    errors.push(`backfill scan: ${e.message}`)
  }
  console.log('[flightHistory] backfill 完成: checked=' + backfillChecked + ' updated=' + backfillUpdated)

  return {
    success: true,
    mode: backfillOnly ? 'backfill-only' : (refreshOnly ? 'refresh-first-page' : 'full-sync'),
    api: apiHost,
    pagesDone: page,
    launchesProcessed: totalLaunches,
    boostersUpdated: totalUpdated,
    backfillChecked,
    backfillUpdated,
    completed: isCompleted,
    elapsed: Date.now() - startTime,
    errors: errors.length > 0 ? errors : undefined
  }
}

function _httpGetJson(url, timeout) {
  const https = require('https')
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const token = typeof process.env.LL2_API_TOKEN === 'string' ? process.env.LL2_API_TOKEN.trim() : ''
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'SpaceDevs-Sync-CloudFunction/1.0'
    }
    if (token && token !== 'FILL_ME' && urlObj.hostname === 'll.thespacedevs.com')
      headers['Authorization'] = `Token ${token}`

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers,
        timeout: timeout || 30000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`))
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            reject(new Error('JSON parse error'))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.on('error', (e) => reject(e))
    req.end()
  })
}
