/**
 * 公众号「阅读原文」中转页：微信打不开 X/Twitter，这里播自有 COS 视频。
 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isOwnCosVideo(u) {
  const s = String(u || '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  if (!/1397421562[^/]*\.myqcloud\.com/i.test(s)) return false
  return /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(s)
}

function pickEventVideo(event, index) {
  const list = Array.isArray(event && event.mediaList) ? event.mediaList : []
  const videos = list.filter((m) => {
    const t = String((m && m.type) || '').toLowerCase()
    return t === 'video' || isOwnCosVideo(m && (m.previewUrl || m.url))
  })
  const i = Math.max(0, Number(index) || 0)
  return videos[i] || videos[0] || null
}

function playUrlOf(media) {
  if (!media) return ''
  const preview = String(media.previewUrl || '').trim()
  const url = String(media.url || media.videoUrl || '').trim()
  if (isOwnCosVideo(preview)) return preview
  if (isOwnCosVideo(url)) return url
  return ''
}

function oaWatchMissCopy(parsed) {
  const code = parsed && parsed.code
  if (code === 4040) {
    return {
      title: '这条动态已过期',
      hint: '事件更新大约保留 3 天，过期后会自动下架。请打开微信小程序「火星探索日志」查看最新动态。'
    }
  }
  return {
    title: '火星探索日志',
    hint: '内容暂不可用，请打开小程序「火星探索日志」观看。'
  }
}

function htmlPage({ title, poster, videoSrc, hint }) {
  const safeTitle = escapeHtml(title || '火星探索日志')
  const videoBlock = videoSrc
    ? `<video controls playsinline webkit-playsinline poster="${escapeHtml(poster || '')}" src="${escapeHtml(videoSrc)}" style="width:100%;max-height:80vh;background:#000;border-radius:8px;"></video>`
    : poster
      ? `<img src="${escapeHtml(poster)}" alt="" style="width:100%;border-radius:8px;" />`
      : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>${safeTitle}</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#111;color:#eee;}
    .wrap{max-width:720px;margin:0 auto;padding:20px 16px 40px;}
    h1{font-size:18px;line-height:1.4;margin:0 0 12px;}
    p{font-size:14px;line-height:1.6;color:#bbb;}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${safeTitle}</h1>
    ${videoBlock}
    <p>${escapeHtml(hint || '')}</p>
  </div>
</body>
</html>`
}

export async function handleOaWatchRequest(request, env, corsHeaders) {
  void corsHeaders
  const html = (body) =>
    new Response(body, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=60'
      }
    })

  const url = new URL(request.url)
  const eventId = String(url.searchParams.get('e') || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const index = url.searchParams.get('i')
  if (!eventId) {
    return html(
      htmlPage({
        title: '火星探索日志',
        hint: '请从小程序或公众号文章封面进入观看。'
      })
    )
  }

  try {
    const gatewayBase = String(
      env.PUBLIC_GATEWAY_URL ||
        'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/public'
    ).replace(/\/$/, '')
    const upstream = await fetch(gatewayBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MarsXOaWatch/1.0' },
      body: JSON.stringify({
        path: '/starship/events',
        method: 'GET',
        query: { id: eventId }
      }),
      signal: AbortSignal.timeout(12000)
    })
    let payloadText = await upstream.text()
    try {
      const outer = JSON.parse(payloadText)
      if (outer && typeof outer.body === 'string' && outer.statusCode != null) {
        payloadText = outer.body
      }
    } catch (e) {}
    const parsed = JSON.parse(payloadText)
    const event = parsed && (parsed.data || parsed)
    if (!event || parsed.code) {
      const miss = oaWatchMissCopy(parsed)
      return html(htmlPage(miss))
    }
    const media = pickEventVideo(event, index)
    const videoSrc = playUrlOf(media)
    const poster = String((media && media.thumbnailUrl) || '').trim()
    const hint = videoSrc
      ? '如无法播放，请打开微信小程序「火星探索日志」。'
      : '完整视频请打开微信小程序「火星探索日志」观看（点文章封面也可进入）。'
    return html(
      htmlPage({
        title: event.title || '火星探索日志',
        poster,
        videoSrc,
        hint
      })
    )
  } catch (e) {
    return html(
      htmlPage({
        title: '火星探索日志',
        hint: '暂时无法加载视频，请打开微信小程序「火星探索日志」观看。'
      })
    )
  }
}
