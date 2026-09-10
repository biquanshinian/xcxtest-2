/**
 * 本机代理端口自动发现：配置失效时扫描常见 Clash/V2Ray/VPN 本地口，
 * 用能通 YouTube 的出口，避免写死 7897 之类端口后「找不到就卡死」。
 */
import net from 'net'

/** 常见本地代理口（Clash / V2RayN / VPNCheap / Surge 等） */
const COMMON_LOCAL_PORTS = [
  7890, 7891, 7892, 7893, 7897, 7898,
  10808, 10809, 1080, 1087,
  6152, 6153, 2080, 8080, 8888,
  20171, 20172, 2801, 7899
]

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host })
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch (e) {}
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/** 从代理 URL 抽端口，抽不出返回 0 */
function proxyPort(url) {
  const m = String(url || '').match(/:(\d+)\s*$/)
  return m ? Number(m[1]) : 0
}

/**
 * 扫描本机监听中的常见代理口 → http + socks5 候选 URL
 * @returns {Promise<string[]>}
 */
async function discoverLocalProxyUrls(ports = COMMON_LOCAL_PORTS) {
  const open = []
  for (const port of ports) {
    if (await isPortOpen(port)) open.push(port)
  }
  const urls = []
  for (const port of open) {
    urls.push(`http://127.0.0.1:${port}`)
    urls.push(`socks5://127.0.0.1:${port}`)
  }
  return urls
}

/**
 * 合并「.env 配置 + 本机自动发现 + direct」。
 * 配置优先；自动发现补上未写明的监听口；direct 始终最后。
 * @param {string[]} configured
 * @param {string[]} [discovered]
 */
function mergeProxyCandidates(configured, discovered) {
  const out = []
  const seen = new Set()
  const push = (raw) => {
    const s = String(raw || '').trim()
    if (!s) return
    const key = s.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(s)
  }
  for (const c of configured || []) {
    if (String(c).toLowerCase() === 'direct') continue
    push(c)
  }
  for (const c of discovered || []) push(c)
  push('direct')
  return out
}

/**
 * 构建本轮探测列表（异步扫端口）。
 * @param {string[]} configuredFromEnv
 */
async function buildProxyCandidates(configuredFromEnv) {
  let discovered = []
  try {
    discovered = await discoverLocalProxyUrls()
  } catch (e) {
    discovered = []
  }
  return {
    candidates: mergeProxyCandidates(configuredFromEnv || [], discovered),
    discoveredPorts: [...new Set(discovered.map(proxyPort).filter(Boolean))]
  }
}

export {
  COMMON_LOCAL_PORTS,
  isPortOpen,
  proxyPort,
  discoverLocalProxyUrls,
  mergeProxyCandidates,
  buildProxyCandidates
}
