/**
 * 微信图床 mmbiz.qpic.cn 防盗链：浏览器直链会显示「未经允许不可引用」。
 * NSF 等 Cloudflare 拦图：改写到 WordPress Photon (i0.wp.com) 再展示。
 * 经 adminGateway 带 Referer 拉取后缓存为 data URL 供预览。
 */
import { api } from '../api/client'

const cache = Object.create(null)
const inflight = Object.create(null)

/** Cloudflare 拦原站图床时，浏览器侧改写到 Photon CDN */
export function hotlinkSafeImageUrl(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  try {
    const parsed = new URL(u)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'nasaspaceflight.com' || host.endsWith('.nasaspaceflight.com')) {
      return `https://i0.wp.com/${parsed.hostname}${parsed.pathname}?ssl=1&format=jpg`
    }
  } catch (e) {}
  return u
}

export function needsOaImageProxy(url) {
  return /qpic\.cn|qlogo\.cn|mp\.weixin\.qq\.com/i.test(String(url || ''))
}

export function displayOaImage(url, proxyMap) {
  const u = hotlinkSafeImageUrl(String(url || '').trim())
  if (!u) return ''
  if (proxyMap && proxyMap[u]) return proxyMap[u]
  if (cache[u]) return cache[u]
  // 原始 URL 也可能已在 proxyMap（旧缓存键）
  const raw = String(url || '').trim()
  if (raw && proxyMap && proxyMap[raw]) return proxyMap[raw]
  if (raw && cache[raw]) return cache[raw]
  return u
}

export async function ensureOaImageProxied(url, proxyMap) {
  const raw = String(url || '').trim()
  const u = hotlinkSafeImageUrl(raw)
  if (!u) return ''
  if (!needsOaImageProxy(u) && u !== raw) {
    // Photon 改写后浏览器可直链，无需服务端代理
    if (proxyMap) proxyMap[raw] = u
    return u
  }
  if (!needsOaImageProxy(u)) return u
  if (proxyMap && proxyMap[u]) return proxyMap[u]
  if (cache[u]) {
    if (proxyMap) proxyMap[u] = cache[u]
    return cache[u]
  }
  if (!inflight[u]) {
    inflight[u] = api
      .proxyOaImage(u)
      .then((res) => {
        const dataUrl = (res && res.dataUrl) || u
        cache[u] = dataUrl
        return dataUrl
      })
      .catch(() => u)
      .finally(() => {
        delete inflight[u]
      })
  }
  const dataUrl = await inflight[u]
  if (proxyMap) proxyMap[u] = dataUrl
  return dataUrl
}

export async function warmOaImageList(urls, proxyMap) {
  const list = (urls || []).map((u) => String(u || '').trim()).filter(Boolean)
  await Promise.all(list.map((u) => ensureOaImageProxied(u, proxyMap)))
}
