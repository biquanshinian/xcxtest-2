/**
 * Cloudflare Worker：在边缘侧请求 www.starbase.texas.gov，供腾讯云函数 DNS 失败时中转。
 *
 * 部署：
 *   npm create cloudflare@latest -- starbase-proxy
 *   将本文件内容复制到 src/index.js（或按 Wrangler 模板调整）
 *   wrangler secret put STARBASE_PROXY_SECRET
 *   wrangler deploy
 *
 * 环境变量（Worker 后台 / wrangler.toml [vars]）：
 *   STARBASE_PROXY_SECRET 与云函数 STARBASE_FETCH_PROXY_SECRET 一致
 */

const UPSTREAM = 'https://www.starbase.texas.gov/beach-road-access'

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const secret = env.STARBASE_PROXY_SECRET || ''
    if (!secret) {
      return new Response('Worker misconfigured: missing STARBASE_PROXY_SECRET', { status: 500 })
    }

    const auth =
      request.headers.get('Authorization') || request.headers.get('X-Starbase-Proxy-Secret') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim()
    if (bearer !== secret) {
      return new Response('Unauthorized', { status: 401 })
    }

    if (request.method === 'HEAD') {
      return new Response(null, { status: 204 })
    }

    const upstreamRes = await fetch(UPSTREAM, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      redirect: 'follow'
    })

    const html = await upstreamRes.text()
    return new Response(html, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    })
  }
}
