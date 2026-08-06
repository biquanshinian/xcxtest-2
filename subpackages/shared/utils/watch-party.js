/**
 * 观礼服务（shared 分包轻量入口）
 *
 * - matchWatchPartySession：按问句匹配最合适场次（星问 AI 用）
 * - listWatchPartySessions：按任务列公开商家场次（入口卡 / 跳转列表）
 * 完整业务 API 在 subpackages/watch-party/utils/api.js；
 * 任务详情入口探测在 pages/mission-detail/utils/watch-party-entry.js。
 */

function callWatchParty(path, query) {
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.resolve(null)
  return wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path, method: 'GET', query: query || {} }
  }).then((res) => {
    const r = (res && res.result) || {}
    return (r.code === 0 && r.data) || null
  }).catch(() => null)
}

/**
 * 按用户问句匹配最合适的可对外场次（文昌 → 文昌商家场次；未点名 → 最近发射场次）。
 * 不走长缓存，保证跟问句相关。
 */
function matchWatchPartySession(queryText) {
  const q = String(queryText || '').trim().slice(0, 80)
  return callWatchParty('/watch-party/match', q ? { q } : {})
}

/** 公开场次列表：{ missionId? } → { list, count, ... } */
function listWatchPartySessions(missionId) {
  const mid = String(missionId || '').trim()
  return callWatchParty('/watch-party/sessions/public', mid ? { missionId: mid, limit: 30 } : { limit: 30 })
}

module.exports = {
  matchWatchPartySession,
  listWatchPartySessions
}
