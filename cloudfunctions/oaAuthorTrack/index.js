/**
 * 外站作者 RSS 追踪：定时拉取 Proxima 等源入库（可配置 autoWash）
 * washOnly / oaAuthorWashTimer：只消化洗稿队列（避免和拉取挤在同一次 HTTP 里超时）
 * 必须配置与 adminGateway 相同的 OA_CONTENT_INTERNAL_TOKEN
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function callGateway(path, body) {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return {
      code: 5000,
      message: '未配置 OA_CONTENT_INTERNAL_TOKEN，无法触发作者追踪'
    }
  }
  const res = await cloud.callFunction({
    name: 'adminGateway',
    data: {
      path,
      method: 'POST',
      body: body || {},
      headers: {
        'x-oa-internal-token': token
      }
    },
    config: { timeout: 90000 }
  })
  return res.result || { code: 0, data: res }
}

exports.main = async (event = {}) => {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return {
      code: 5000,
      message: '未配置 OA_CONTENT_INTERNAL_TOKEN，无法触发作者追踪'
    }
  }
  const trigger = event.TriggerName || event.triggerName || ''
  const washOnly = !!event.washOnly || trigger === 'oaAuthorWashTimer'
  try {
    if (washOnly) {
      return await callGateway('/oa-content/internal/wash-collected', {
        from: 'oaAuthorTrack',
        trigger,
        limit: 1
      })
    }
    const track = await callGateway('/oa-content/internal/track-sources', {
      from: 'oaAuthorTrack',
      trigger,
      key: event.key || ''
    })
    if (track && track.data && Number(track.data.washQueued || 0) > 0) {
      const wash = await callGateway('/oa-content/internal/wash-collected', {
        from: 'oaAuthorTrack',
        trigger,
        limit: 1
      })
      return {
        code: 0,
        data: { track: track.data || track, wash: wash.data || wash }
      }
    }
    return track
  } catch (e) {
    console.error('[oaAuthorTrack]', e)
    return { code: 5000, message: e.message || String(e) }
  }
}
