/**
 * 任务详情页：观礼入口显隐探测（按 missionId 列商家场次）
 * 完整业务 API 在 subpackages/watch-party/utils/api.js。
 */

const ENTRY_CACHE_PREFIX = '_watch_party_mission_entry_'
/** 入口卡红角标要按实显示场次数，缓存收紧到 5 分钟（云端另有 30s 列表缓存兜底） */
const ENTRY_CACHE_TTL = 5 * 60 * 1000

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
 * 按任务拉取可对外观礼场次摘要。
 * @returns {Promise<null|{ missionId, count, title, rocketName, missionName }>}
 */
function fetchWatchPartyEntryForMission(missionId) {
  const mid = String(missionId || '').trim()
  if (!mid) return Promise.resolve(null)
  // 过审开关优先：关闭时不读缓存、不打公开接口，入口保持隐藏
  let featureMod = null
  try {
    featureMod = require('../../../utils/watch-party-feature.js')
  } catch (e) {
    return Promise.resolve(null)
  }
  return featureMod.isWatchPartyEnabled(true).then((on) => {
    if (!on) return null
    return _fetchWatchPartyEntryForMissionInner(mid)
  }).catch(() => null)
}

function _fetchWatchPartyEntryForMissionInner(mid) {
  const cacheKey = ENTRY_CACHE_PREFIX + mid
  try {
    const cached = wx.getStorageSync(cacheKey)
    if (cached && cached.ts && Date.now() - cached.ts < ENTRY_CACHE_TTL) {
      return Promise.resolve(cached.entry || null)
    }
  } catch (e) {}

  // summary+小 limit：入口显隐只需 count/标题，省传输与奖品字段计算
  return callWatchParty('/watch-party/sessions/public', {
    missionId: mid,
    limit: 10,
    summary: 1
  }).then((data) => {
    const list = (data && Array.isArray(data.list)) ? data.list : []
    const count = list.length
    let entry = null
    if (count > 0) {
      const rocket = (data && data.rocketName) || list[0].rocketName || ''
      // 优先商家自定义中文任务名
      const mission = (data && data.missionDisplayName) || list[0].missionDisplayName
        || (data && data.missionName) || list[0].missionName || ''
      entry = {
        missionId: mid,
        count,
        rocketName: rocket,
        missionName: mission,
        title: count > 1
          ? ((rocket || mission || '现场观礼') + ' · ' + count + '家观礼点')
          : (list[0].title || ((rocket || '火箭') + '发射观礼'))
      }
    }
    try { wx.setStorageSync(cacheKey, { entry, ts: Date.now() }) } catch (e) {}
    return entry
  })
}

/** @deprecated 单场次探测；请用 fetchWatchPartyEntryForMission */
function fetchWatchPartyEntry() {
  try {
    return require('../../../utils/watch-party-feature.js').isWatchPartyEnabled(true).then((on) => {
      if (!on) return null
      return callWatchParty('/watch-party/config', {}).then((session) => session || null)
    }).catch(() => null)
  } catch (e) {
    return Promise.resolve(null)
  }
}

module.exports = {
  fetchWatchPartyEntryForMission,
  fetchWatchPartyEntry
}
