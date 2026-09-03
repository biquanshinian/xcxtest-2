/**
 * 公众号内容日更：定时生成草稿到后台草稿箱（不直接群发）
 * 必须配置与 adminGateway 相同的 OA_CONTENT_INTERNAL_TOKEN（禁止回退到 JWT 签名密钥）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event = {}) => {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return {
      code: 5000,
      message: '未配置 OA_CONTENT_INTERNAL_TOKEN，无法触发日更'
    }
  }
  try {
    const res = await cloud.callFunction({
      name: 'adminGateway',
      data: {
        path: '/oa-content/internal/run-daily',
        method: 'POST',
        body: { from: 'oaContentDaily', trigger: event.TriggerName || event.triggerName || '' },
        headers: {
          'x-oa-internal-token': token
        }
      },
      config: { timeout: 90000 }
    })
    return res.result || { code: 0, data: res }
  } catch (e) {
    console.error('[oaContentDaily]', e)
    return { code: 5000, message: e.message || String(e) }
  }
}
