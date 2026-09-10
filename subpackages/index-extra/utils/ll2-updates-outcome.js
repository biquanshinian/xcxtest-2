/**
 * 从 LL2 /updates/ 动态流推断可 settle 状态。
 * 典型成功记录：comment = "Launch success." + info_url 指向 X/官网。
 * 不替代 launch.status；仅作 status 滞后时的旁路证据。
 */

const TERMINAL = {
  success: { id: 3, name: 'Launch Successful', abbrev: 'Success' },
  failure: { id: 4, name: 'Launch Failure', abbrev: 'Failure' },
  partial: { id: 7, name: 'Partial Failure', abbrev: 'Partial Failure' },
  inflight: { id: 6, name: 'Launch in Flight', abbrev: 'In Flight' }
}

function normalizeComment(comment) {
  return String(comment || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * 白名单：明确 liftoff / in flight，避免弱相关文案误报。
 * @param {string} c normalizeComment 后的文本
 */
function isLiftoffComment(c) {
  if (!c) return false
  if (/^in flight\.?$/.test(c)) return true
  if (/\bconfirmed liftoff\b/.test(c)) return true
  if (/\blaunch vehicle has lifted off\b/.test(c)) return true
  if (/\bliftoff (confirmed|successful)\b/.test(c)) return true
  // 单独 liftoff / lift-off（排除 "liftoff scrubbed" 等）
  if (/\blift[\s-]?off\b/.test(c) && !/\b(scrub|delay|hold|abort|cancel)\b/.test(c)) return true
  return false
}

/**
 * @param {Array<{ comment?: string, infoUrl?: string, info_url?: string, createdOn?: string, created_on?: string }>} list
 * @returns {{ status: { id: number, name: string, abbrev: string }, comment: string, infoUrl: string, createdOn: string, kind: 'success'|'failure'|'partial'|'inflight' }|null}
 */
function inferTerminalStatusFromUpdates(list) {
  if (!Array.isArray(list) || !list.length) return null

  // 已按 -created_on 倒序时，从新到旧找第一条可 settle 文案（终态优先于飞行中）
  for (let i = 0; i < list.length; i++) {
    const u = list[i]
    if (!u) continue
    const c = normalizeComment(u.comment)
    if (!c) continue

    let kind = null
    // 成功：Launch success. / All payloads deployed, launch success. / Mission success
    if (
      /\blaunch success\b/.test(c) ||
      /\bmission success\b/.test(c) ||
      /\ball payloads? deployed\b/.test(c) ||
      /^success\.?$/.test(c)
    ) {
      // 排除「not a success」类否定（极少见）
      if (/\b(not|no|failed)\b.*\bsuccess\b/.test(c) || /\bsuccess\b.*\b(not|no|failed)\b/.test(c)) {
        // fall through
      } else {
        kind = 'success'
      }
    }
    // 部分失败
    if (!kind && (/\bpartial (launch )?failure\b/.test(c) || /\bpartial success\b/.test(c))) {
      kind = 'partial'
    }
    // 失败只接受直接结论。不能把 "delayed due to previous H3 launch failure"
    // 这类描述另一发任务的历史原因，误判成当前任务失败。
    if (
      !kind &&
      (/^(launch|mission) failure\.?$/.test(c) ||
        /^(the )?(launch|mission) (has )?failed\.?$/.test(c) ||
        /^failure\.?$/.test(c))
    ) {
      kind = 'failure'
    }
    // 飞行中：liftoff 白名单（终态未命中时才认）
    if (!kind && isLiftoffComment(c)) {
      kind = 'inflight'
    }

    if (!kind) continue

    const infoUrl = String(u.infoUrl || u.info_url || '').trim()
    const createdOn = u.createdOn || u.created_on || ''
    return {
      status: TERMINAL[kind],
      comment: String(u.comment || '').trim(),
      infoUrl,
      createdOn,
      kind
    }
  }
  return null
}

/**
 * 组装与 fetchLaunchStatuses row 同形的对象，供 _settleExpiredLaunch 使用。
 */
function buildSettledRowFromUpdates(launchId, launchName, net, outcome) {
  if (!outcome || !outcome.status || !launchId) return null
  return {
    id: String(launchId),
    name: launchName || '',
    status: outcome.status,
    net: net || '',
    source: 'll2_updates',
    updateComment: outcome.comment || '',
    updateInfoUrl: outcome.infoUrl || ''
  }
}

module.exports = {
  TERMINAL,
  inferTerminalStatusFromUpdates,
  buildSettledRowFromUpdates,
  isLiftoffComment
}
