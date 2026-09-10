/**
 * list/探针写回 upcoming 时的 NET 迟滞与排序。
 *
 * 背景：LL2 mode=list / detailed 都可能把 TBD 拨到近窗或预备期末日占位；
 * 小时探针、ll2Query resolve、syncLaunches 整表覆写均须同一套迟滞（见 upcoming-net-merge）。
 *
 * 策略：
 * 1) live 仍为 TBD/Hold/TBC 时，拒绝大幅前移（假近窗）
 * 2) live 已是 Go（确认 T-0）：允许从远窗占位收回近窗——勿因 cached 曾是 TBD/8-31 钉死
 * 3) 近窗被一把拨到远窗「预备期末日占位」（00:00Z + 月初/月末，或变待定）：整包拒绝
 * 4) 近窗 Go → 更远但仍是具体钟点的真实改期（仍 Go）：放行
 * 5) 列表排序严格按 NET 升序，无视就绪/待定等状态（倒计时面板另按最近 NET 选型）
 *
 * 拒写时：整包保留 cached 的 net/window/status（禁止「近窗 + 待定」半更新）。
 */

/** LL2: 2 TBD / 5 Hold / 8 To Be Confirmed */
const UNCERTAIN_STATUS_IDS = { 2: true, 5: true, 8: true }
/** LL2: 1 Go for Launch */
const GO_STATUS_ID = 1

/** 允许的小幅前移修正（时区/分钟级） */
const MAX_BENIGN_FORWARD_MS = 12 * 60 * 60 * 1000
/** 缓存原 NET 距今超过该值视为「远窗」 */
const FAR_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
/** live 落入该近窗视为「突然临近」 */
const NEAR_WINDOW_MS = 48 * 60 * 60 * 1000
/** @deprecated 列表已改为纯 NET 排序；保留导出以免旧脚本引用报错 */
const UNCERTAIN_SORT_PENALTY_MS = 0
/** 超过该跨度的大幅后移才进入「占位 scrub vs 真实改期」判别 */
const PLACEHOLDER_SCRUB_MS = 7 * 24 * 60 * 60 * 1000

function statusIdOf(status) {
  const id = status && status.id != null ? Number(status.id) : 0
  return Number.isFinite(id) ? id : 0
}

function isUncertainStatus(status) {
  return !!UNCERTAIN_STATUS_IDS[statusIdOf(status)]
}

function isGoStatus(status) {
  return statusIdOf(status) === GO_STATUS_ID
}

function netMsOf(row) {
  if (!row) return NaN
  const raw = row.net || row.window_start || row.windowStart || ''
  if (!raw) return NaN
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : NaN
}

/**
 * LL2 预备期占位常见形态：UTC 00:00:00 且落在月初/月末。
 * 真实改期通常带具体钟点（如 15:30），即使后移超过 7 天也应放行。
 */
function isLikelyPlaceholderNet(netMs) {
  if (!Number.isFinite(netMs)) return false
  const d = new Date(netMs)
  if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) {
    return false
  }
  if (d.getUTCMilliseconds() !== 0) return false
  const day = d.getUTCDate()
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return day === 1 || day === lastDay
}

/**
 * 是否应拒绝把 live 的 NET/window 覆盖到 cached。
 * @returns {{ reject: boolean, reason?: string }}
 */
function evaluateNetAdvance(cached, live, nowMs) {
  const now = Number(nowMs) || Date.now()
  const cachedNet = netMsOf(cached)
  const liveNet = netMsOf(live)
  if (!Number.isFinite(cachedNet) || !Number.isFinite(liveNet)) {
    return { reject: false }
  }
  const deltaMs = liveNet - cachedNet // >0 后移；<0 前移

  // 大幅后移：仅拒绝「远窗预备期占位」，真实改期（具体钟点 / 仍 Go）放行
  if (deltaMs > PLACEHOLDER_SCRUB_MS) {
    const cachedWasNear =
      cachedNet > now - 2 * 60 * 60 * 1000 && cachedNet - now < FAR_HORIZON_MS
    const liveIsFar = liveNet - now > FAR_HORIZON_MS
    const livePlaceholder = isLikelyPlaceholderNet(liveNet)
    const liveUncertain = isUncertainStatus(live && live.status)

    // 近窗 → 远窗待定占位（含已污染的近窗 TBD）
    if (cachedWasNear && liveIsFar && liveUncertain && livePlaceholder) {
      return { reject: true, reason: 'uncertain_placeholder_scrub' }
    }
    // 近窗 → 远窗待定但非典型占位时刻：仍拒（待定大幅后移不可信）
    if (cachedWasNear && liveIsFar && liveUncertain) {
      return { reject: true, reason: 'uncertain_placeholder_scrub' }
    }
    // 近窗 Go → 远窗仍标 Go，但时间是月末 00:00Z 占位
    if (
      cachedWasNear &&
      isGoStatus(cached && cached.status) &&
      liveIsFar &&
      livePlaceholder
    ) {
      return { reject: true, reason: 'far_placeholder_from_near_go' }
    }
    // 近窗 Go → 更远但仍是具体钟点的真实改期（Go/非占位）→ 放行
    return { reject: false }
  }

  if (deltaMs >= 0) return { reject: false } // 小幅后移或不变
  const forwardMs = -deltaMs
  if (forwardMs <= MAX_BENIGN_FORWARD_MS) return { reject: false }

  // live 已确认 Go：允许从 8/31 等远窗占位收回官方 T-0（勿看 cached 是否曾 TBD）
  if (isGoStatus(live && live.status)) {
    return { reject: false }
  }

  // live 仍待定：拒绝假近窗大幅前移
  if (isUncertainStatus(live && live.status)) {
    return { reject: true, reason: 'uncertain_net_forward' }
  }

  // 其它非待定：拒绝「远窗突然跳进 48h」的临时拨表（live 非 Go）
  const cachedWasFar = cachedNet - now > FAR_HORIZON_MS
  const liveIsNear = liveNet - now < NEAR_WINDOW_MS && liveNet > now - 2 * 60 * 60 * 1000
  if (cachedWasFar && liveIsNear && forwardMs > 24 * 60 * 60 * 1000) {
    return { reject: true, reason: 'far_to_near_jump' }
  }

  return { reject: false }
}

function shouldRejectNetAdvance(cached, live, nowMs) {
  return evaluateNetAdvance(cached, live, nowMs).reject
}

/** LL2 终态：终态不被非终态降级 */
const TERMINAL_STATUS_IDS = { 3: true, 4: true, 7: true, 9: true }

function isTerminalStatus(status) {
  return !!TERMINAL_STATUS_IDS[statusIdOf(status)]
}

/**
 * 单行 NET 迟滞合并（不修改入参）。
 * 拒写时整包保留 cached 的 net/window_* 与 status（禁止「近窗 + 待定」半更新）；
 * 放行时 status 跟 live，终态仍不被非终态降级。
 */
function mergeLiveRowNetHysteresis(cached, live, nowMs) {
  if (!live) return live
  if (!cached) return { ...live }

  const row = { ...live }
  if (shouldRejectNetAdvance(cached, live, nowMs)) {
    if (cached.net != null && cached.net !== '') row.net = cached.net
    if (cached.window_start != null && cached.window_start !== '') {
      row.window_start = cached.window_start
    } else if (cached.windowStart != null && cached.windowStart !== '') {
      row.window_start = cached.windowStart
    }
    if (cached.window_end != null && cached.window_end !== '') {
      row.window_end = cached.window_end
    } else if (cached.windowEnd != null && cached.windowEnd !== '') {
      row.window_end = cached.windowEnd
    }
    if (cached.status) row.status = cached.status
    return row
  }

  if (isTerminalStatus(cached.status) && !isTerminalStatus(live.status)) {
    row.status = cached.status
  }
  return row
}

/** 排序键：严格按 NET 升序（缺失/非法沉底） */
function sortNetKeyMs(row, nowMs) {
  const t = netMsOf(row)
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER
}

function sortResultsByNetAsc(results, nowMs) {
  if (!Array.isArray(results)) return results
  const now = Number(nowMs) || Date.now()
  return results.sort((a, b) => sortNetKeyMs(a, now) - sortNetKeyMs(b, now))
}

module.exports = {
  UNCERTAIN_STATUS_IDS,
  GO_STATUS_ID,
  MAX_BENIGN_FORWARD_MS,
  FAR_HORIZON_MS,
  NEAR_WINDOW_MS,
  UNCERTAIN_SORT_PENALTY_MS,
  PLACEHOLDER_SCRUB_MS,
  TERMINAL_STATUS_IDS,
  isUncertainStatus,
  isGoStatus,
  isTerminalStatus,
  isLikelyPlaceholderNet,
  netMsOf,
  evaluateNetAdvance,
  shouldRejectNetAdvance,
  mergeLiveRowNetHysteresis,
  sortNetKeyMs,
  sortResultsByNetAsc
}
