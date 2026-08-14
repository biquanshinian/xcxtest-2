/**
 * SPACE_NOTICES_FEATURE — 客户端读发射通告（放分包，避免主包「未使用 JS」）
 */

function callSpaceNotices(action, data) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云能力不可用'))
  }
  return wx.cloud
    .callFunction({
      name: 'spaceNotices',
      data: Object.assign({ action }, data || {})
    })
    .then((res) => (res && res.result) || {})
    .catch((e) => {
      const msg = (e && (e.errMsg || e.message)) || String(e || '')
      if (/FUNCTION_NOT_FOUND|FunctionName|not found|找不到/i.test(msg)) {
        return {
          success: false,
          error: '云函数 spaceNotices 未部署，请在开发者工具上传并部署后再试'
        }
      }
      if (/-504003|timed?\s*out|timeout|超时/i.test(msg)) {
        return {
          success: false,
          error: '云函数超时：请重新上传部署 spaceNotices（含配置），再点同步'
        }
      }
      const short = msg.length > 80 ? msg.slice(0, 80) + '…' : msg
      return { success: false, error: short || '请求失败' }
    })
}

function listSpaceNoticeEntries(limit) {
  return callSpaceNotices('listEntries', { limit: limit || 40 })
}

/**
 * @param {string|object} keyOrOpts entryKey 字符串，或 { entryKey, ll2Id }
 * 主键是站点 slug；ll2Id 仅作旧分享链接兼容
 */
function getSpaceNoticeEntry(keyOrOpts) {
  if (keyOrOpts && typeof keyOrOpts === 'object') {
    return callSpaceNotices('getEntry', {
      entryKey: keyOrOpts.entryKey || '',
      ll2Id: keyOrOpts.ll2Id || ''
    })
  }
  const key = String(keyOrOpts || '').trim()
  // UUID 形态走 ll2Id；其余当 entryKey（launch-xxx）
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key)) {
    return callSpaceNotices('getEntry', { ll2Id: key })
  }
  return callSpaceNotices('getEntry', { entryKey: key })
}

function syncSpaceNotices() {
  return callSpaceNotices('sync', { force: true })
}

/** 只读：任务是否已有通告条目（不触发同步） */
function lookupSpaceNoticeEntry(opts) {
  return callSpaceNotices('lookupEntry', {
    entryKey: (opts && opts.entryKey) || '',
    ll2Id: (opts && opts.ll2Id) || ''
  })
}

function lookupStarshipSpaceNoticeEntry() {
  return callSpaceNotices('lookupStarshipEntry', {})
}

function lookupChinaBulletin() {
  return callSpaceNotices('lookupChinaBulletin', {})
}

module.exports = {
  listSpaceNoticeEntries,
  getSpaceNoticeEntry,
  lookupSpaceNoticeEntry,
  lookupStarshipSpaceNoticeEntry,
  lookupChinaBulletin,
  syncSpaceNotices,
  callSpaceNotices
}
