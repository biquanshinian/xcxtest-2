/**
 * B 站直播状态：经 apiProxy 云函数查询（服务端 60s 缓存），避免小程序端 wx.request 直连 Worker
 */

function extractRoomId(raw) {
  if (!raw) return ''
  const m = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
  return m ? m[1] : String(raw).replace(/\D/g, '')
}

/**
 * @param {string[]} roomIds
 * @returns {Promise<Record<string, object>>} roomId -> { code, liveStatus, cover, title, ... }
 */
async function fetchLiveStatusBatch(roomIds) {
  const ids = [...new Set((roomIds || []).map(extractRoomId).filter(Boolean))]
  if (!ids.length) return {}
  if (!wx.cloud || !wx.cloud.callFunction) return {}

  // 批量失败后整体退避重试一次；不再退化为按房间逐个调用（N+1 调用风暴）
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1500))
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'liveStatusBatch', roomIds: ids },
        timeout: 12000
      })
      const r = res && res.result
      if (r && r.code === 0 && r.results && typeof r.results === 'object') {
        return r.results
      }
    } catch (e) {
      console.warn('[live-status] batch failed (attempt ' + (attempt + 1) + '):', e.message || e)
    }
  }
  return {}
}

function parseLiveStatus(statusRes) {
  if (!statusRes || statusRes.code !== 0) {
    return { liveStatus: 0, cover: '', liveTitle: '' }
  }
  return {
    liveStatus: statusRes.liveStatus === 1 ? 1 : 0,
    cover: statusRes.cover || '',
    liveTitle: statusRes.title || ''
  }
}

module.exports = {
  extractRoomId,
  fetchLiveStatusBatch,
  parseLiveStatus
}
