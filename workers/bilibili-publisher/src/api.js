import { getConfig } from './config.js'

async function request(path, { method = 'POST', body = {} } = {}) {
  const cfg = getConfig()
  if (!cfg.apiBase) throw new Error('BILI_ADMIN_API_BASE 未配置')
  if (!cfg.token || cfg.token.length < 16) throw new Error('BILI_AGENT_TOKEN 未配置或过短')

  const timeoutMs = Math.max(5000, Number(process.env.BILI_HTTP_TIMEOUT_MS || 30000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  console.log(`[api] ${method} ${path} → ${cfg.apiBase}`)
  let res
  try {
    res = await fetch(cfg.apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`
      },
      body: JSON.stringify({
        path,
        method,
        body,
        query: {},
        headers: { Authorization: `Bearer ${cfg.token}` }
      }),
      signal: controller.signal
    })
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`请求超时(${timeoutMs}ms)：请确认 adminGateway 已部署，且网络可访问 ${cfg.apiBase}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  if (data.code !== 0) {
    const err = new Error(data.message || '请求失败')
    err.code = data.code
    err.data = data.data
    throw err
  }
  return data.data
}

export function claimJob(force = false) {
  return request('/bilibili-agent/claim', { method: 'POST', body: { force: !!force } })
}

export function completeJob(payload) {
  return request('/bilibili-agent/complete', { method: 'POST', body: payload })
}

export function failJob(payload) {
  return request('/bilibili-agent/fail', { method: 'POST', body: payload })
}
