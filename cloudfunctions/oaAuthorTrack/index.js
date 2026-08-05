/**
 * 外站作者 RSS 追踪：定时拉取 Proxima 等源入库（可配置 autoWash）
 * 必须配置与 adminGateway 相同的 OA_CONTENT_INTERNAL_TOKEN
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event = {}) => {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return {
      code: 5000,
      message: '未配置 OA_CONTENT_INTERNAL_TOKEN，无法触发作者追踪'
    }
  }
  try {
    const res = await cloud.callFunction({
      name: 'adminGateway',
      data: {
        path: '/oa-content/internal/track-sources',
        method: 'POST',
        body: {
          from: 'oaAuthorTrack',
          trigger: event.TriggerName || event.triggerName || '',
          key: event.key || ''
        },
        headers: {
          'x-oa-internal-token': token
        }
      },
      config: { timeout: 90000 }
    })
    return res.result || { code: 0, data: res }
  } catch (e) {
    console.error('[oaAuthorTrack]', e)
    return { code: 5000, message: e.message || String(e) }
  }
}
