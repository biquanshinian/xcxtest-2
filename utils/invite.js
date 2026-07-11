/**
 * 邀请得月卡（客户端）
 *
 * - captureInviteFromOptions(options)：onLaunch/onShow 截获 path query 里的 inviter，
 *   写 pending 标记后延迟上报（避开启动关键路径）
 * - getInviteState()：邀请页拉取进度与记录（含自己的 openid，供分享 path 使用）
 *
 * 本机去重：storage 标记 _invite_claimed，已标记则不再上报；
 * 云端 invite_records 以被邀人 openid 为 _id 冲突拒绝，是最终兜底。
 */

const CLAIMED_KEY = '_invite_claimed'
const PENDING_KEY = '_invite_claim_pending'
const CLAIM_DELAY_MS = 3000

let _claimScheduled = false

function _readSync(key) {
  try { return wx.getStorageSync(key) } catch (e) { return '' }
}

function _writeSync(key, value) {
  try { wx.setStorageSync(key, value) } catch (e) {}
}

/** 从启动/切前台 options 中截获 inviter 并调度上报 */
function captureInviteFromOptions(options) {
  try {
    const inviter = String((options && options.query && options.query.inviter) || '').trim()
    if (!inviter) return
    if (_readSync(CLAIMED_KEY)) return
    _writeSync(PENDING_KEY, inviter)
    _scheduleClaim()
  } catch (e) {}
}

function _scheduleClaim() {
  if (_claimScheduled) return
  _claimScheduled = true
  setTimeout(() => {
    _claimScheduled = false
    _claimPending()
  }, CLAIM_DELAY_MS)
}

function _claimPending() {
  const inviter = String(_readSync(PENDING_KEY) || '').trim()
  if (!inviter) return
  if (_readSync(CLAIMED_KEY)) {
    _writeSync(PENDING_KEY, '')
    return
  }
  if (!wx.cloud || !wx.cloud.callFunction) return
  wx.cloud.callFunction({
    name: 'membership',
    data: { action: 'claimInvite', inviter: inviter }
  }).then((res) => {
    const r = (res && res.result) || {}
    // success / duplicated / self_invite / bad_inviter 都算终态，本机不再重复上报
    if (r.success || r.reason === 'duplicated' || r.reason === 'self_invite' || r.reason === 'bad_inviter') {
      _writeSync(CLAIMED_KEY, r.success ? 'claimed' : String(r.reason))
      _writeSync(PENDING_KEY, '')
    }
    // 其他失败（如网络/云函数异常）保留 pending，下次启动重试
  }).catch(() => {})
}

/** 邀请页状态（进度 + 记录 + 自己的 openid） */
function getInviteState() {
  return wx.cloud.callFunction({
    name: 'membership',
    data: { action: 'getInviteState' }
  }).then((res) => {
    const r = (res && res.result) || {}
    if (r.error) throw new Error(r.error)
    return r
  })
}

module.exports = {
  captureInviteFromOptions,
  getInviteState
}
