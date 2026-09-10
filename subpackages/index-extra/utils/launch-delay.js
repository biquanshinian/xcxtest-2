/**
 * 首页倒计时卡片「推迟徽标」计算工具（纯函数，无云依赖）。
 *
 * NET 解析逻辑移植自 cloudfunctions/syncSpaceDevsData/vote-rounds-from-updates.js
 * （parseNetFromUpdateComment / isScrubOrPostponeComment / extractAttemptNetsFromUpdates），
 * 输入为 LL2 launch updates 评论流（fetchLl2LaunchUpdates 返回的 list），
 * 输出当前任务的累计推迟次数与时长文案。
 */

/** NET 判定容差：两次 NET 相差超过 30 分钟才视为一次「推迟」 */
const DELAY_TOLERANCE_MS = 30 * 60 * 1000

/** 英文月份名（含缩写）→ 月份索引，用于解析 "NET May 22" 这类评论 */
const MONTH_MAP = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
}

/** 时间字符串 → 毫秒时间戳；非法输入返回 0 */
function parseTimeMs(t) {
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** 两个时间是否相差超过容差（任一非法则视为不超过） */
function timesDiffer(a, b, toleranceMs) {
  const am = parseTimeMs(a)
  const bm = parseTimeMs(b)
  if (!am || !bm) return false
  return Math.abs(am - bm) > toleranceMs
}

/** 两个时间是否为同一 UTC 日 */
function sameUtcDay(a, b) {
  const am = parseTimeMs(a)
  const bm = parseTimeMs(b)
  if (!am || !bm) return false
  const da = new Date(am)
  const db = new Date(bm)
  return da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
}

/** 月份名 + 日 → ISO 时间串；年份取参考时间（评论发布时间）所在年份 */
function isoFromMonthDay(monthName, day, hour, minute, refIso) {
  const mk = MONTH_MAP[String(monthName || '').toLowerCase()]
  if (mk == null || !day) return ''
  let year = new Date().getUTCFullYear()
  if (refIso) {
    const rm = parseTimeMs(refIso)
    if (rm) year = new Date(rm).getUTCFullYear()
  }
  const d = new Date(Date.UTC(year, mk, day, hour, minute, 0))
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

/**
 * 从单条 update 评论中解析 NET 时间（返回 ISO 串，解析不到返回 ''）。
 * 支持：ISO8601、"targeting May 22 at 12:30 UTC"、"NET May 22" 等格式；
 * 只有月份没有日期（如 "NET May"、"NET Q2"）视为无法解析。
 */
function parseNetFromUpdateComment(comment, refIso) {
  if (!comment || typeof comment !== 'string') return ''
  const c = comment.trim()
  if (/^NET\s+[A-Za-z]+\.?\s*$/i.test(c)) return ''
  if (/^Targeting\s+[A-Za-z]+\.?\s*$/i.test(c)) return ''
  if (/NET\s+Q\d/i.test(c)) return ''

  // 评论内直接包含 ISO8601 时间
  let m = c.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)\b/)
  if (m) {
    let iso = m[1]
    if (iso.length === 17) iso = iso.replace('Z', ':00Z')
    return iso
  }

  // "now targeting May 22 at 12:30 UTC" 格式
  m = c.match(/(?:now targeting|targeting)\s+([A-Za-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*UTC/i)
  if (m) {
    return isoFromMonthDay(m[1], Number(m[2]), Number(m[3]), Number(m[4]), refIso)
  }

  // "NET May 22" 格式（无具体时刻，取 22:30 UTC 作占位，与云端口径一致）
  m = c.match(/(?:next attempt\s+)?NET\s+([A-Za-z]+)\.?\s*(\d{1,2})?(?:\s*,|\s|TBC|$)/i)
  if (m && m[2]) {
    return isoFromMonthDay(m[1], Number(m[2]), 22, 30, refIso)
  }

  return ''
}

/** 是否为 scrub / 推迟类评论 */
function isScrubOrPostponeComment(comment) {
  const c = String(comment || '')
  // 「Next attempt NET May 22」是新一轮 NET 公告，不是 scrub 本身
  if (/next attempt\s+NET/i.test(c) && parseNetFromUpdateComment(c, '')) return false
  return /scrub|rescheduled|confirmed reschedule|next attempt|postpon|delay|hold at T-/i.test(c)
}

/** 上一个 NET 是否应被「关闭」（即视为一次已过去的尝试） */
function shouldCloseAttempt(prevNet, nextNet, nextAnnouncedAt) {
  if (!prevNet || !nextNet) return false
  if (!sameUtcDay(prevNet, nextNet)) return true
  if (timesDiffer(prevNet, nextNet, DELAY_TOLERANCE_MS)) return true
  const prevMs = parseTimeMs(prevNet)
  const annMs = parseTimeMs(nextAnnouncedAt)
  return prevMs > 0 && annMs > prevMs + DELAY_TOLERANCE_MS
}

/**
 * 从 updates 列表（自动按 createdOn 升序整理）提取历次 NET（ISO 串数组，时间顺序）。
 * 与云端 extractAttemptNetsFromUpdates 口径一致。
 */
function extractAttemptNetsFromUpdates(updates) {
  const sorted = (updates || []).slice().sort(function (a, b) {
    return parseTimeMs(a.createdOn || a.created_on) - parseTimeMs(b.createdOn || b.created_on)
  })
  const closed = []
  let pendingNet = ''

  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]
    const comment = String(u.comment || '')
    const at = u.createdOn || u.created_on || ''
    const parsed = parseNetFromUpdateComment(comment, at)

    if (parsed) {
      if (pendingNet && shouldCloseAttempt(pendingNet, parsed, at)) {
        closed.push(pendingNet)
      }
      pendingNet = parsed
    }

    if (isScrubOrPostponeComment(comment) && pendingNet) {
      closed.push(pendingNet)
      pendingNet = ''
      if (parsed) pendingNet = parsed
    }
  }

  if (pendingNet) closed.push(pendingNet)
  return closed
}

/** 推迟时长 → 紧凑中文文案（不足 1 天用小时，不足 1 小时用分钟，四舍五入到整数） */
function formatDelayDuration(ms) {
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  if (ms >= DAY) return Math.round(ms / DAY) + '天'
  if (ms >= HOUR) return Math.round(ms / HOUR) + '小时'
  return Math.max(1, Math.round(ms / MINUTE)) + '分钟'
}

/**
 * 计算当前任务的累计推迟数据。
 *
 * 口径说明：
 * - 从 updates 评论流中按时间顺序提取历次 NET；
 * - 累计推迟时长 = 当前 NET - 最早解析到的 NET（差值 <= 0 或解析不到则视为无推迟）；
 * - 推迟次数 = NET 序列（历次 NET + 当前 NET）中相邻两次向后推且超过 30 分钟容差的次数，
 *   若时长为正但按容差数不出次数，则按 1 次计。
 *
 * @param {Array<{comment:string, createdOn:string}>} updates LL2 updates 列表（顺序不限）
 * @param {string} currentNet 当前 NET（launchData.launchTime）
 * @returns {{delayCount:number, delayMs:number, firstNet:string, text:string}}
 *   无推迟时 delayCount = 0、text = ''
 */
function computeLaunchDelayInfo(updates, currentNet) {
  const empty = { delayCount: 0, delayMs: 0, firstNet: '', text: '' }
  const currentMs = parseTimeMs(currentNet)
  if (!currentMs) return empty

  const attempts = extractAttemptNetsFromUpdates(updates)
  if (!attempts.length) return empty

  const firstNet = attempts[0]
  const delayMs = currentMs - parseTimeMs(firstNet)
  // 差值 <= 0（或不足 1 分钟的抖动）视为无推迟
  if (delayMs < 60 * 1000) return empty

  // 推迟次数：历次 NET + 当前 NET 组成的序列中，向后推超过容差的相邻变化次数
  const seq = attempts.concat([currentNet])
  let delayCount = 0
  for (let i = 0; i < seq.length - 1; i++) {
    const prevMs = parseTimeMs(seq[i])
    const nextMs = parseTimeMs(seq[i + 1])
    if (prevMs && nextMs && nextMs - prevMs > DELAY_TOLERANCE_MS) delayCount++
  }
  if (delayCount === 0) delayCount = 1

  return {
    delayCount: delayCount,
    delayMs: delayMs,
    firstNet: firstNet,
    text: '已推迟' + delayCount + '次·累计' + formatDelayDuration(delayMs)
  }
}

module.exports = {
  parseNetFromUpdateComment,
  isScrubOrPostponeComment,
  extractAttemptNetsFromUpdates,
  computeLaunchDelayInfo
}
