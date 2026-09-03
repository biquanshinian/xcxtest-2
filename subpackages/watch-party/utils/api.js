/**
 * 火箭观礼服务（分包内客户端 API）
 *
 * 完整云端调用集中在分包；任务详情入口探测见 pages/mission-detail/utils/watch-party-entry.js。
 * 现场弱网（发射日人群密集、基站拥塞）应对：
 *   - 幂等的查询/解锁类请求失败后自动重试 1 次
 *   - 抽卡 / 预约 / 分享加抽等有副作用的请求不自动重试，由用户手动再试
 */

const ENTRY_CACHE_KEY = '_watch_party_entry_cache'
const ENTRY_CACHE_TTL = 30 * 60 * 1000
const RETRY_DELAY = 800

function callOnce(path, method, payload) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云能力不可用'))
  }
  const data = { path, method: method || 'GET' }
  if (method === 'GET') {
    data.query = payload || {}
  } else {
    data.body = payload || {}
  }
  return wx.cloud.callFunction({ name: 'adminGateway', data }).then((res) => {
    const r = (res && res.result) || {}
    if (r.code !== 0) {
      const err = new Error(r.message || '请求失败')
      err.code = r.code
      throw err
    }
    return r.data
  })
}

/** 幂等请求：失败（网络层，无业务 code）自动重试 1 次 */
function callIdempotent(path, method, payload) {
  return callOnce(path, method, payload).catch((err) => {
    if (err && err.code) throw err
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        callOnce(path, method, payload).then(resolve, reject)
      }, RETRY_DELAY)
    })
  })
}

/** @deprecated 单场次入口；多商家请用 fetchPublicSessions */
function fetchWatchPartyEntry() {
  try {
    const cached = wx.getStorageSync(ENTRY_CACHE_KEY)
    if (cached && cached.ts && Date.now() - cached.ts < ENTRY_CACHE_TTL) {
      return Promise.resolve(cached.session || null)
    }
  } catch (e) {}
  return callIdempotent('/watch-party/config', 'GET').then((session) => {
    try { wx.setStorageSync(ENTRY_CACHE_KEY, { session: session || null, ts: Date.now() }) } catch (e) {}
    return session || null
  }).catch(() => null)
}

/** 公开场次列表：{ missionId? } → { list, count, missionName, rocketName } */
function fetchPublicSessions(params) {
  return callIdempotent('/watch-party/sessions/public', 'GET', params || {})
}

function invalidateEntryCache() {
  try { wx.removeStorageSync(ENTRY_CACHE_KEY) } catch (e) {}
  try {
    const info = wx.getStorageInfoSync()
    const keys = (info && info.keys) || []
    keys.forEach((k) => {
      const key = String(k)
      if (
        key.indexOf(ENTRY_CACHE_KEY) === 0
        || key.indexOf('_watch_party_mission_entry_') === 0
      ) {
        try { wx.removeStorageSync(key) } catch (e) {}
      }
    })
  } catch (e) {}
}

/** 场次详情：{ sessionId } 或 { code } */
function fetchSession(params) {
  return callIdempotent('/watch-party/session', 'GET', params)
}

function reserve(body) {
  return callOnce('/watch-party/reserve', 'POST', body)
}

function fetchMyReservation(sessionId) {
  return callIdempotent('/watch-party/my-reservation', 'GET', { sessionId })
}

function cancelReservation(sessionId) {
  return callOnce('/watch-party/reserve/cancel', 'POST', { sessionId })
}

/** 扫码/进入抽卡页解锁资格（云端幂等）：{ sessionId | code, channel } → { session, total, used, remaining } */
function scanCheckIn(params) {
  return callIdempotent('/watch-party/scan', 'POST', params)
}

function drawCard(sessionId, source) {
  return callOnce('/watch-party/draw', 'POST', { sessionId, source: source || 'scan' })
}

function fetchMyCards() {
  return callIdempotent('/watch-party/my-cards', 'GET')
}

function shareBonus(sessionId) {
  return callOnce('/watch-party/share-bonus', 'POST', { sessionId })
}

/** 同行商家合作申请（推荐归属自动取当前场次挂靠商家） */
function applyMerchantCooperation(body) {
  return callOnce('/watch-party/merchant-apply', 'POST', body)
}

/** 大屏模式数据（公开）：场次信息 + 预聚合计数，云端零额外查询，可放心轮询 */
function fetchScreenData(params) {
  return callIdempotent('/watch-party/screen', 'GET', params)
}

// ── 商家自助（凭运营发放的商家编号绑定微信后使用） ──

function _syncMerchantGateBypass(res) {
  try {
    require('../../../utils/merchant-staff-bypass.js').syncFromMerchantApi(res || null)
  } catch (e) {}
  return res
}

/** 凭商家编号绑定当前微信（幂等） */
function merchantBind(code) {
  return callOnce('/watch-party/merchant/bind', 'POST', { code }).then(_syncMerchantGateBypass)
}

function merchantUnbind() {
  return callOnce('/watch-party/merchant/unbind', 'POST', {}).then((res) => {
    try { require('../../../utils/merchant-staff-bypass.js').clear() } catch (e) {}
    return res
  })
}

/** 商家中心首屏：商家信息 + 名下场次；未绑定时抛 code=4011 */
function fetchMerchantMe() {
  return callIdempotent('/watch-party/merchant/me', 'GET').then(_syncMerchantGateBypass)
}

/** 商家自助更新入驻资料（名称/联系人/联系电话/地址）；改名云端同步名下场次 */
function merchantUpdateProfile(body) {
  return callOnce('/watch-party/merchant/profile', 'PUT', body)
}

/** 商家头像：端上先传云存储再存 fileID；传空串 = 移除头像 */
function merchantUpdateAvatar(avatar) {
  return callOnce('/watch-party/merchant/avatar', 'POST', { avatar: avatar || '' })
}

/** 商家奖品库：保存常用奖品模板（整份覆盖），多场次编辑时一键导入 */
function merchantSavePrizePresets(prizes) {
  return callOnce('/watch-party/merchant/prize-presets', 'PUT', { prizes: prizes || [] })
}

/** 商家自建场次：短码与大屏抽卡码由云端自动生成 */
function merchantCreateSession(body) {
  return callOnce('/watch-party/merchant/sessions', 'POST', body)
}

function merchantUpdateSession(sessionId, body) {
  return callOnce('/watch-party/merchant/sessions/' + encodeURIComponent(sessionId), 'PUT', body)
}

/** 任务显示名（商家自定义中文名）：查当前值与是否有命名权 */
function fetchMerchantMissionName(missionId) {
  return callIdempotent('/watch-party/merchant/mission-name', 'GET', {
    missionId: String(missionId || '').trim()
  })
}

/** 设置任务显示名（仅该任务下最早入驻的商家可改；空值 = 清除） */
function merchantSetMissionName(missionId, displayName) {
  return callOnce('/watch-party/merchant/mission-name', 'POST', {
    missionId: String(missionId || '').trim(),
    displayName: String(displayName || '').trim()
  })
}

function merchantDeleteSession(sessionId) {
  return callOnce('/watch-party/merchant/sessions/' + encodeURIComponent(sessionId), 'DELETE', {})
}

/** 商家确认发射成功：开放本场现场奖品抽奖（不可撤销；用户仍须扫物料码） */
function merchantUnlockSessionSuccess(sessionId) {
  return callOnce(
    '/watch-party/merchant/sessions/' + encodeURIComponent(sessionId) + '/unlock-success',
    'POST',
    {}
  )
}

/** 开启下一场发射：归档当前任务账本，物料码不变；用户须再扫码 */
function merchantStartNextCycle(sessionId) {
  return callOnce(
    '/watch-party/merchant/sessions/' + encodeURIComponent(sessionId) + '/next-cycle',
    'POST',
    {}
  )
}

/** 线下打印物料：抽卡小程序码临时 URL + 商家名/用途文案（供合成标注海报） */
function fetchMerchantSessionMaterial(sessionId) {
  return callIdempotent('/watch-party/merchant/material', 'GET', {
    sessionId: String(sessionId || '').trim()
  })
}

/** 商家本场预约名单 */
function fetchMerchantReservations(sessionId, query) {
  const sid = String(sessionId || '').trim()
  const q = Object.assign({}, query || {})
  return callIdempotent(
    '/watch-party/merchant/sessions/' + encodeURIComponent(sid) + '/reservations',
    'GET',
    q
  )
}

/** 商家核销预约到场 */
function merchantCheckInReservation(reservationId) {
  return callOnce(
    '/watch-party/merchant/reservations/' + encodeURIComponent(reservationId) + '/check-in',
    'POST',
    {}
  )
}

/** 现场竞猜票数（复用发射竞猜公开接口） */
function fetchVoteStats(missionId) {
  return callIdempotent('/vote/' + encodeURIComponent(missionId), 'GET')
}

module.exports = {
  fetchWatchPartyEntry,
  fetchPublicSessions,
  invalidateEntryCache,
  fetchSession,
  reserve,
  fetchMyReservation,
  cancelReservation,
  scanCheckIn,
  drawCard,
  fetchMyCards,
  shareBonus,
  applyMerchantCooperation,
  fetchScreenData,
  fetchVoteStats,
  merchantBind,
  merchantUnbind,
  fetchMerchantMe,
  merchantUpdateProfile,
  merchantUpdateAvatar,
  merchantSavePrizePresets,
  merchantCreateSession,
  merchantUpdateSession,
  fetchMerchantMissionName,
  merchantSetMissionName,
  merchantUnlockSessionSuccess,
  merchantStartNextCycle,
  merchantDeleteSession,
  fetchMerchantSessionMaterial,
  fetchMerchantReservations,
  merchantCheckInReservation
}
