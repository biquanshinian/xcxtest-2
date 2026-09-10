/**
 * 真切后台 → 回前台的时长与「本页是否该静默对齐」。
 *
 * App.onHide 才会打 hiddenAt（切 Tab 不走 App.onHide）。
 * 页面 onShow 用 foregroundSeq 消费：同一轮回前台每个页面最多对齐一次，
 * 切 Tab 不会重复打云。
 *
 * 首页具体打哪些云，一律走 planIndexForegroundRevalidate（防网络风暴）：
 * - 远窗只 resolve 当前任务，不打 live 列表 / updates
 * - 列表 SWR 不清 15 分钟探云节流（免费用户禁静默周期探云仍生效）
 */

/** 倒计时任务 / 详情日程：短挂后台也要对齐 NET/状态 */
const STATUS_REVALIDATE_MS = 30 * 1000
/** 远窗轻量探针最小间隔，避免反复切微信打爆 ll2Query */
const STATUS_PROBE_MIN_GAP_MS = 60 * 1000
/** 距 T-0 30 分钟内才走完整实况探针（含 live 列表） */
const NEAR_WINDOW_MS = 30 * 60 * 1000
/** 列表 / 资讯 / 进展：超过此时长才静默探云（避免回微信聊两句就打库） */
const LIST_REVALIDATE_MS = 2 * 60 * 1000
/** 竞猜票数、全局开关：与各自 TTL 对齐 */
const VOTE_REVALIDATE_MS = 5 * 60 * 1000
const FEATURE_REVALIDATE_MS = 5 * 60 * 1000

function markAppHidden(app, nowMs) {
  if (!app || typeof app !== 'object') return
  const now = Number(nowMs)
  app._appHiddenAt = Number.isFinite(now) ? now : Date.now()
}

function markAppShown(app, nowMs) {
  if (!app || typeof app !== 'object') return 0
  const now = Number(nowMs)
  const t = Number.isFinite(now) ? now : Date.now()
  const hiddenAt = app._appHiddenAt
  const hiddenNum = Number(hiddenAt)
  const resumeMs =
    hiddenAt == null || hiddenAt === '' || !Number.isFinite(hiddenNum)
      ? 0
      : Math.max(0, t - hiddenNum)
  app._appHiddenAt = undefined
  app._backgroundResumeMs = resumeMs
  app._foregroundSeq = (Number(app._foregroundSeq) || 0) + 1
  return resumeMs
}

/**
 * 页面 onShow 调用：仅当本页尚未消费「这一轮 App 回前台」时带出 resumeMs。
 * 切 Tab 时 seq 不变 → resumeMs = 0。
 */
function consumePageForegroundResume(page, app) {
  const seq = Number(app && app._foregroundSeq) || 0
  const last = Number(page && page._lastForegroundSeq) || 0
  const isNewForeground = seq > 0 && seq !== last
  if (page) page._lastForegroundSeq = seq
  const resumeMs = isNewForeground ? Math.max(0, Number(app && app._backgroundResumeMs) || 0) : 0
  return { resumeMs, isNewForeground, seq }
}

function takeForegroundResume(page) {
  let app = null
  try {
    app = typeof getApp === 'function' ? getApp() : null
  } catch (e) {
    app = null
  }
  return consumePageForegroundResume(page, app)
}

function shouldRevalidate(resumeMs, minMs) {
  return Number(resumeMs) >= Number(minMs)
}

function isNearLaunchWindow(countdown) {
  const cd = countdown && typeof countdown === 'object' ? countdown : null
  if (!cd) return false
  if (cd.isExpired) return true
  const total = Number(cd.total)
  if (Number.isFinite(total) && total >= 0) return total <= NEAR_WINDOW_MS
  const days = Number(cd.days) || 0
  const hours = Number(cd.hours) || 0
  const minutes = Number(cd.minutes) || 0
  return days === 0 && hours === 0 && minutes < 30
}

function emptyIndexPlan() {
  return {
    quietSettle: false,
    liveStatusProbe: false,
    resolveCurrentLite: false,
    listSwr: false,
    forceListCloud: false,
    fetchFeatureFlags: false,
    skipVoteCache: false
  }
}

/**
 * 首页回前台打云计划。forceListCloud 必须恒为 false：
 * 回前台不得调用 forceLaunchListCloudBgCheck，否则每 2 分钟会打穿
 * 15 分钟节流和免费用户禁静默探云。
 */
function planIndexForegroundRevalidate(input) {
  const plan = emptyIndexPlan()
  const resumeMs = Number(input && input.resumeMs) || 0
  if (!shouldRevalidate(resumeMs, STATUS_REVALIDATE_MS)) return plan

  const expired = !!(input && input.countdownExpired)
  const polling = !!(input && input.launchStatusPolling)
  const hasLaunchId = !!(input && input.hasLaunchId)
  const nearWindow = !!(input && input.nearWindow)
  const pastNetHeadCount = Math.max(0, Number(input && input.pastNetHeadCount) || 0)
  const sinceLite = Number(input && input.msSinceLastLiteProbe)
  const liteGapOk = !Number.isFinite(sinceLite) || sinceLite >= STATUS_PROBE_MIN_GAP_MS

  if (pastNetHeadCount > 0) plan.quietSettle = true

  if (hasLaunchId && !polling) {
    if (expired) {
      // startCountdown → _onCountdownExpired 已接管完整探针，避免双打
    } else if (nearWindow) {
      plan.liveStatusProbe = true
    } else if (liteGapOk) {
      plan.resolveCurrentLite = true
    }
  }

  if (shouldRevalidate(resumeMs, LIST_REVALIDATE_MS)) plan.listSwr = true
  if (shouldRevalidate(resumeMs, FEATURE_REVALIDATE_MS)) plan.fetchFeatureFlags = true
  if (shouldRevalidate(resumeMs, VOTE_REVALIDATE_MS)) plan.skipVoteCache = true
  return plan
}

module.exports = {
  STATUS_REVALIDATE_MS,
  STATUS_PROBE_MIN_GAP_MS,
  NEAR_WINDOW_MS,
  LIST_REVALIDATE_MS,
  VOTE_REVALIDATE_MS,
  FEATURE_REVALIDATE_MS,
  markAppHidden,
  markAppShown,
  consumePageForegroundResume,
  takeForegroundResume,
  shouldRevalidate,
  isNearLaunchWindow,
  planIndexForegroundRevalidate
}
