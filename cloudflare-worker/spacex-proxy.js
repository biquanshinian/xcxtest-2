export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8'
    }
    // KV 绑定：env.TLE_KV（需在 wrangler.toml 中配置）
    const KV = env.TLE_KV

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      if (url.pathname === '/timeline') {
        const user = url.searchParams.get('user') || 'SpaceX'
        // 未登录时 syndication 对大部分账号只返回"历史热门 Top100"而非最新时间线，
        // 附带已登录账号的 auth_token Cookie 可恢复所有账号的最新推文
        const timelineHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0)' }
        const twitterAuthToken = (env.TWITTER_AUTH_TOKEN || '').trim()
        if (twitterAuthToken) {
          timelineHeaders['Cookie'] = `auth_token=${twitterAuthToken}`
        }
        const resp = await fetch(
          `https://syndication.twitter.com/srv/timeline-profile/screen-name/${user}`,
          { headers: timelineHeaders }
        )
        const html = await resp.text()

        // 优先解析 __NEXT_DATA__ JSON（含 id_str/created_at，可靠且能按 ID 排序）
        let ids = []
        try {
          const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
          if (m) {
            const nextData = JSON.parse(m[1])
            const entries = nextData?.props?.pageProps?.timeline?.entries || []
            ids = entries
              .map(e => e?.content?.tweet?.id_str || '')
              .filter(id => /^\d+$/.test(id))
          }
        } catch (e) {}

        // JSON 解析失败时回退到正则扒 HTML
        if (ids.length === 0) {
          const regex = new RegExp(`/${user}/status/(\\d+)`, 'gi')
          ids = [...html.matchAll(regex)].map(m => m[1])
        }

        // 去重并按 ID 数值降序（新推文在前），云函数只看前几条
        const unique = [...new Set(ids)].sort((a, b) => {
          const x = BigInt(a), y = BigInt(b)
          return x > y ? -1 : (x < y ? 1 : 0)
        })
        return new Response(JSON.stringify({ code: 0, user, ids: unique }), { headers: corsHeaders })
      }

      /**
       * 付费批量兜底（twitterapi.io 高级搜索）：一次查询覆盖全部监控账号、只拉新推文。
       * 入参 users=逗号分隔的账号名（云函数每轮传入全量启用账号）。
       * 成本控制：
       *   - 仅美国东部时间 6:00–24:00（含夏令时）窗口内调用付费 API；
       *   - KV 全局节流，每小时最多刷新一次，窗口外/未到刷新点直接返回上次结果；
       *   - 查询带 since 时间过滤（上次刷新时间-10分钟重叠），只为真正的新推文付费；
       *   - 每 10 个账号合并为一条 from:A OR from:B 查询，每条查询最多翻 2 页。
       * 未配置 TWITTERAPI_IO_KEY 时返回空结果，管线退化为纯 syndication，不影响主流程。
       */
      if (url.pathname === '/timeline-batch') {
        const usersRaw = url.searchParams.get('users') || ''
        const users = [...new Set(usersRaw.split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_]{1,20}$/.test(s)))]
        const twitterApiIoKey = (env.TWITTERAPI_IO_KEY || '').trim()
        if (!users.length || !twitterApiIoKey) {
          return new Response(JSON.stringify({ code: 0, byUser: {}, fb: users.length ? 'no-key' : 'no-users' }), { headers: corsHeaders })
        }

        const kvKey = 'tweetfb:batch'
        let entry = null
        if (KV) {
          try { entry = await KV.get(kvKey, 'json') } catch (e) {}
        }

        // 美国东部时间（含夏令时）当前小时：6–23 点为付费调用窗口
        let usHour = -1
        try {
          usHour = parseInt(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'
          }).format(new Date()), 10)
        } catch (e) {}
        const inWindow = usHour >= 6
        const isFresh = !!entry && Date.now() - entry.ts < 3600 * 1000
        let fbDebug = 'usHour=' + usHour + ',kv=' + (entry ? (isFresh ? 'fresh' : 'stale') : 'none')

        if (inWindow && !isFresh) {
          try {
            // since 取上次刷新时间再留 10 分钟重叠（首次为 2 小时前），只为新推文付费
            const sinceMs = entry && entry.ts ? entry.ts - 10 * 60 * 1000 : Date.now() - 2 * 3600 * 1000
            const d = new Date(sinceMs)
            const pad = n => String(n).padStart(2, '0')
            const since = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}_UTC`

            const byUser = {}
            let fetched = 0
            // 每 10 个账号一条查询，避免 query 超长
            for (let i = 0; i < users.length; i += 10) {
              const group = users.slice(i, i + 10)
              const query = '(' + group.map(u => 'from:' + u).join(' OR ') + ') since:' + since
              let cursor = ''
              for (let page = 0; page < 2; page++) {
                const qs = 'query=' + encodeURIComponent(query) + '&queryType=Latest' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
                const r = await fetch('https://api.twitterapi.io/twitter/tweet/advanced_search?' + qs, {
                  headers: {
                    'X-API-Key': twitterApiIoKey,
                    'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0)'
                  },
                  signal: AbortSignal.timeout(15000)
                })
                if (!r.ok) { fbDebug += ',http=' + r.status; break }
                const j = await r.json()
                const tweets = (j && (j.tweets || (j.data && j.data.tweets))) || []
                fetched += tweets.length
                for (const t of tweets) {
                  if (!t || !t.id || t.retweeted_tweet) continue // 转推 wrapper 无法经 fxtwitter 取详情
                  const uname = String((t.author && t.author.userName) || '').toLowerCase()
                  if (!uname) continue
                  if (!byUser[uname]) byUser[uname] = []
                  if (/^\d+$/.test(String(t.id))) byUser[uname].push(String(t.id))
                }
                if (!j || !j.has_next_page || !j.next_cursor || tweets.length === 0) break
                cursor = j.next_cursor
              }
            }
            fbDebug += ',fetched=' + fetched

            // 与上次结果合并并保留 48 小时内的 ID（snowflake 反推时间），
            // 防止云函数某小时未消费完就被新一轮结果覆盖导致漏抓
            const TWITTER_EPOCH_MS = 1288834974657n
            const minKeepId = (BigInt(Date.now() - 48 * 3600 * 1000) - TWITTER_EPOCH_MS) << 22n
            const prevByUser = (entry && entry.byUser) || {}
            for (const uname of Object.keys(prevByUser)) {
              const kept = (prevByUser[uname] || []).filter(id => {
                try { return BigInt(id) > minKeepId } catch (e) { return false }
              })
              if (!kept.length) continue
              byUser[uname] = [...new Set([...(byUser[uname] || []), ...kept])]
            }

            entry = { ts: Date.now(), byUser }
            if (KV) {
              try { await KV.put(kvKey, JSON.stringify(entry), { expirationTtl: 7 * 24 * 3600 }) } catch (e) {}
            }
          } catch (e) {
            fbDebug += ',err=' + (e && e.message)
          }
        }

        return new Response(JSON.stringify({
          code: 0,
          ts: (entry && entry.ts) || 0,
          byUser: (entry && entry.byUser) || {},
          fb: fbDebug
        }), { headers: corsHeaders })
      }

      const tweetMatch = url.pathname.match(/^\/tweet\/(\d+)$/)
      if (tweetMatch) {
        const id = tweetMatch[1]
        const user = url.searchParams.get('user') || 'SpaceX'
        const lang = url.searchParams.get('lang') || 'zh'
        const resp = await fetch(
          `https://api.fxtwitter.com/${user}/status/${id}/${lang}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0)' } }
        )
        const data = await resp.text()
        return new Response(data, { headers: corsHeaders })
      }

      if (url.pathname === '/image') {
        const imgUrl = url.searchParams.get('url')
        if (!imgUrl) {
          return new Response(JSON.stringify({ code: 400, message: 'Missing url param' }), { status: 400, headers: corsHeaders })
        }
        const resp = await fetch(imgUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0)' }
        })
        if (!resp.ok) {
          return new Response(JSON.stringify({ code: resp.status, message: 'Upstream error' }), { status: 502, headers: corsHeaders })
        }
        const imgHeaders = new Headers()
        imgHeaders.set('Content-Type', resp.headers.get('Content-Type') || 'image/jpeg')
        imgHeaders.set('Access-Control-Allow-Origin', '*')
        imgHeaders.set('Cache-Control', 'public, max-age=86400')
        return new Response(resp.body, { headers: imgHeaders })
      }

      if (url.pathname === '/translate') {
        let text = url.searchParams.get('text') || ''
        if (request.method === 'POST') {
          try {
            const body = await request.json()
            if (body && body.text) text = String(body.text)
          } catch (e) {}
        }
        if (!text) {
          return new Response(JSON.stringify({ code: 400, translated: '' }), { headers: corsHeaders })
        }

        // 翻译结果边缘缓存 24 小时（同一文本不会变化）
        const cache = caches.default
        // 勿复用已读 body 的 request 构造 cacheKey（POST 会触发 ReadableStream disturbed）
        const cacheKey = new Request(url.origin + url.pathname + '?text=' + encodeURIComponent(text))
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`
        const resp = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        const data = await resp.json()
        let translated = ''
        if (Array.isArray(data) && Array.isArray(data[0])) {
          translated = data[0].map(s => (s && s[0]) || '').join('')
        }
        const result = new Response(JSON.stringify({ code: 0, translated }), {
          headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400' }
        })
        await cache.put(cacheKey, result.clone())
        return result
      }

      if (url.pathname === '/live') {
        let roomId = url.searchParams.get('room_id') || ''
        const m = roomId.match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
        if (m) roomId = m[1]
        if (!roomId || !/^\d+$/.test(roomId)) {
          return new Response(JSON.stringify({ code: 400, message: 'Missing or invalid room_id' }), { status: 400, headers: corsHeaders })
        }

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        const infoResp = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, {
          headers: { 'User-Agent': ua }
        })
        const infoData = await infoResp.json()
        const info = (infoData && infoData.data) || {}

        return new Response(JSON.stringify({
          code: 0,
          roomId,
          liveStatus: info.live_status || 0,
          title: info.title || '',
          cover: info.user_cover || info.keyframe || ''
        }), { headers: corsHeaders })
      }

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), { headers: corsHeaders })
      }

      /**
       * Starbase Texas海滩/道路页面中转（腾讯云函数侧 DNS 解析失败时使用）
       * 云函数环境变量：STARBASE_FETCH_PROXY_URL = https://api.marsx.com.cn/starbase/beach-road-access（或 workers.dev 同源路径）
       * Cloudflare Worker机密变量：STARBASE_PROXY_SECRET（与云函数 STARBASE_FETCH_PROXY_SECRET 相同）
       * 请求头：Authorization: Bearer <secret>
       */
      if (url.pathname === '/starbase/beach-road-access' || url.pathname === '/starbase/beach-road-access/') {
        const starbaseSecret = env.STARBASE_PROXY_SECRET || ''
        if (!starbaseSecret) {
          return new Response(
            JSON.stringify({ code: 500, message: 'STARBASE_PROXY_SECRET not configured on Worker' }),
            { status: 500, headers: corsHeaders }
          )
        }
        const auth = request.headers.get('Authorization') || request.headers.get('X-Starbase-Proxy-Secret') || ''
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim()
        if (bearer !== starbaseSecret) {
          return new Response(JSON.stringify({ code: 401, message: 'Unauthorized' }), { status: 401, headers: corsHeaders })
        }
        if (request.method === 'HEAD') {
          return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })
        }
        if (request.method !== 'GET') {
          return new Response(JSON.stringify({ code: 405, message: 'Method Not Allowed' }), { status: 405, headers: corsHeaders })
        }
        const upstream = await fetch('https://www.starbase.texas.gov/beach-road-access', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
          },
          redirect: 'follow'
        })
        const html = await upstream.text()
        return new Response(html, {
          status: upstream.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      /**
       * NASA AROW 实时遥测代理 — 从 Google Cloud Storage 拉取猎户座遥测数据
       * GCS bucket: p-2-cen1，对象: October/1/October_105_1.txt（Orion）
       * 两步：先拿 metadata 获取 generation，再拿实际内容
       * 缓存 10 秒（与 AROW 官网刷新频率一致）
       */
      if (url.pathname === '/artemis-telemetry' || url.pathname === '/artemis-telemetry/') {
        const cache = caches.default
        const cacheKey = new Request(url.origin + '/artemis-telemetry', { method: 'GET' })
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const GCS_BASE = 'https://storage.googleapis.com/storage/v1/b/p-2-cen1/o'
        const ORION_OBJ = 'October/1/October_105_1.txt'
        const encoded = encodeURIComponent(ORION_OBJ)

        try {
          // 1) 获取 metadata（含 generation）
          const metaResp = await fetch(`${GCS_BASE}/${encoded}`, { signal: AbortSignal.timeout(15000) })
          if (!metaResp.ok) throw new Error('GCS metadata: ' + metaResp.status)
          const meta = await metaResp.json()
          const gen = meta.generation

          // 2) 获取实际遥测数据
          const dataResp = await fetch(`${GCS_BASE}/${encoded}?alt=media&generation=${gen}`, { signal: AbortSignal.timeout(15000) })
          if (!dataResp.ok) throw new Error('GCS data: ' + dataResp.status)
          const raw = await dataResp.json()

          // 3) 服务端解析：提取关键参数，返回精简 JSON 给小程序
          const p = (num) => {
            const param = raw[`Parameter_${num}`]
            return param ? parseFloat(param.Value) : null
          }
          const FT_TO_KM = 0.0003048
          const FT_S_TO_KMH = 1.09728 // ft/s → km/h
          const EARTH_RADIUS_KM = 6371 // 地球平均半径
          const x = p(2003), y = p(2004), z = p(2005)
          const vx = p(2009), vy = p(2010), vz = p(2011)

          let timestamp = null
          try {
            const timeStr = raw.Parameter_2003 && raw.Parameter_2003.Time
            if (timeStr) {
              const m = timeStr.match(/(\d{4}):(\d{3}):(\d{2}):(\d{2}):(\d{2})/)
              if (m) {
                const jan1 = new Date(Date.UTC(+m[1], 0, 1))
                timestamp = new Date(jan1.getTime() + (+m[2] - 1) * 86400000 + +m[3] * 3600000 + +m[4] * 60000 + +m[5] * 1000).toISOString()
              }
            }
          } catch (_) {}

          // 飞船位置（km，地心坐标系）
          const xKm = x != null ? x * FT_TO_KM : null
          const yKm = y != null ? y * FT_TO_KM : null
          const zKm = z != null ? z * FT_TO_KM : null

          const distEarthCenterKm = (xKm != null && yKm != null && zKm != null) ? Math.sqrt(xKm * xKm + yKm * yKm + zKm * zKm) : null
          const distEarthSurfaceKm = distEarthCenterKm != null ? Math.max(0, distEarthCenterKm - EARTH_RADIUS_KM) : null
          const speedFtS = (vx != null && vy != null && vz != null) ? Math.sqrt(vx * vx + vy * vy + vz * vz) : null

          // ---- 月球位置（低精度天文算法，精度 ~1%） ----
          // 基于 Meeus "Astronomical Algorithms" 简化公式
          // 注意：GCS 遥测的飞船 XYZ 是 J2000 赤道坐标系
          // 月球算法先算黄道坐标，再转赤道坐标
          let distToMoonKm = null
          try {
            const nowMs = timestamp ? new Date(timestamp).getTime() : Date.now()
            const JD = nowMs / 86400000 + 2440587.5
            const T = (JD - 2451545.0) / 36525 // J2000 世纪数
            const deg2rad = Math.PI / 180

            // 月球平经度 L'
            const Lp = (218.3165 + 481267.8813 * T) % 360
            // 月球平距角 D
            const D = (297.8502 + 445267.1115 * T) % 360
            // 太阳平近点角 M
            const M = (357.5291 + 35999.0503 * T) % 360
            // 月球平近点角 M'
            const Mp = (134.9634 + 477198.8676 * T) % 360
            // 月球升交点经度 F
            const F = (93.2720 + 483202.0175 * T) % 360

            // 经度修正（主要项）
            const dL = 6.289 * Math.sin(Mp * deg2rad)
              - 1.274 * Math.sin((2 * D - Mp) * deg2rad)
              + 0.658 * Math.sin(2 * D * deg2rad)
              + 0.214 * Math.sin(2 * Mp * deg2rad)
              - 0.186 * Math.sin(M * deg2rad)
              - 0.114 * Math.sin(2 * F * deg2rad)

            // 纬度修正
            const dB = 5.128 * Math.sin(F * deg2rad)
              + 0.281 * Math.sin((Mp + F) * deg2rad)
              - 0.278 * Math.sin((F - Mp) * deg2rad)

            // 地月距离（km）
            const dR = -20.905 * Math.cos(Mp * deg2rad)
              - 3.699 * Math.cos((2 * D - Mp) * deg2rad)
              - 2.956 * Math.cos(2 * D * deg2rad)
              + 1.015 * Math.cos(2 * Mp * deg2rad)
            const moonDist = 385001 + dR * 1000

            // 黄道经纬度（弧度）
            const eclLon = (Lp + dL) * deg2rad
            const eclLat = dB * deg2rad

            // 黄道 → 赤道坐标转换（黄赤交角 ε ≈ 23.4393°）
            const eps = (23.4393 - 0.0130 * T) * deg2rad
            const cosEps = Math.cos(eps)
            const sinEps = Math.sin(eps)

            // 先算黄道直角坐标
            const eclX = moonDist * Math.cos(eclLat) * Math.cos(eclLon)
            const eclY = moonDist * Math.cos(eclLat) * Math.sin(eclLon)
            const eclZ = moonDist * Math.sin(eclLat)

            // 旋转到赤道坐标系 (J2000)
            const moonXKm = eclX
            const moonYKm = eclY * cosEps - eclZ * sinEps
            const moonZKm = eclY * sinEps + eclZ * cosEps

            // 飞船到月球的三维距离
            if (xKm != null) {
              const dx = xKm - moonXKm
              const dy = yKm - moonYKm
              const dz = zKm - moonZKm
              distToMoonKm = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz))
            }
          } catch (_) {}

          const snapshot = {
            ok: true,
            source: 'arow-gcs',
            timestamp,
            distanceFromEarthKm: distEarthSurfaceKm != null ? Math.round(distEarthSurfaceKm) : null,
            distanceToMoonKm: distToMoonKm,
            velocityKmh: speedFtS != null ? Math.round(speedFtS * FT_S_TO_KMH) : null,
            altitudeKm: p(5001),
            posKm: xKm != null ? { x: xKm, y: yKm, z: zKm } : null,
            velKmS: vx != null ? { x: vx * FT_TO_KM, y: vy * FT_TO_KM, z: vz * FT_TO_KM } : null,
            // 姿态四元数
            attitude: { qw: p(2012), qx: p(2013), qy: p(2014), qz: p(2015) },
            // 姿态角速率 (°/s)
            rates: { roll: p(2101), pitch: p(2102), yaw: p(2103) },
            // 轨道参数 (5002-5009)
            orbit: {
              latitude: p(5002),     // 星下点纬度 (°)
              longitude: p(5003),    // 星下点经度 (°)
              heading: p(5004),      // 航向角 (°)
              flightPathAngle: p(5005), // 飞行路径角 (°)
              azimuth: p(5006),      // 方位角 (°)
              rightAscension: p(5007), // 升交点赤经 (°)
              declination: p(5008),  // 赤纬 (°)
              trueAnomaly: p(5009)   // 真近点角 (°)
            },
            // 推进器 (主发动机)
            thrusters: { t1: p(2040), t2: p(2041), t3: p(2042) },
            // RCS 姿控推力器
            rcs: {
              r1: p(2091), r2: p(2092), r3: p(2093), r4: p(2094), r5: p(2095)
            },
            // 太阳能板 (2048-2065: 两翼各6通道电流+角度)
            solar: {
              wing1: [p(2048), p(2049), p(2050), p(2051), p(2052), p(2053)],
              wing2: [p(2054), p(2055), p(2056), p(2057), p(2058), p(2059)],
              wing3: [p(2060), p(2061), p(2062), p(2063), p(2064), p(2065)]
            },
            // 电力系统 (2096-2099)
            power: {
              busVoltage1: p(2096),
              busVoltage2: p(2097),
              busVoltage3: p(2098),
              powerStatus: (() => { const pp = raw['Parameter_2099']; return pp ? pp.Value : null })()
            },
            // ESM (欧洲服务舱) 参数 (2066-2089)
            esm: {
              thermal: [p(2066), p(2067), p(2068), p(2069), p(2070), p(2071)],
              propulsion: [p(2072), p(2073), p(2074), p(2075), p(2076), p(2077)],
              misc: [p(2078), p(2079), p(2080), p(2081), p(2082), p(2083), p(2084), p(2085), p(2086), p(2087), p(2088), p(2089)]
            },
            // 通信链路
            commMode: p(2026),
            // 状态标志
            statusFlag: (() => { const pp = raw['Parameter_2016']; return pp ? pp.Value : null })(),
            esmStatus: (() => { const pp = raw['Parameter_2090']; return pp ? pp.Value : null })(),
            // 时间戳 (Unix epoch ms)
            epochs: { e1: p(5010), e2: p(5011), e3: p(5012), e4: p(5013) },
            altitudeRedundant: { a1: p(5016), a2: p(5017) },
            generation: gen
          }

          const resp = new Response(JSON.stringify(snapshot), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 's-maxage=10, max-age=10'
            }
          })
          // KV 兜底
          if (KV) await KV.put('artemis-telemetry-last', JSON.stringify(snapshot), { expirationTtl: 300 }).catch(() => {})
          await cache.put(cacheKey, resp.clone())
          return resp
        } catch (e) {
          // KV 兜底
          if (KV) {
            const stale = await KV.get('artemis-telemetry-last')
            if (stale) {
              return new Response(stale, {
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'X-Artemis-Stale': 'true'
                }
              })
            }
          }
          return new Response(JSON.stringify({ ok: false, error: 'AROW 遥测暂不可达：' + e.message }), {
            status: 502, headers: corsHeaders
          })
        }
      }

      /**
       * NASA/JPL Horizons 代理（备用，保留）
       */
      if (url.pathname === '/artemis-horizons' || url.pathname === '/artemis-horizons/') {
        // ---- 边缘缓存：60 秒内相同 query 直接返回，不打 JPL ----
        const cache = caches.default
        const cacheKey = new Request(url.toString(), { method: 'GET' })
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const target = new URL('https://ssd.jpl.nasa.gov/api/horizons.api')
        target.search = url.search
        try {
          const res = await fetch(target.toString(), {
            headers: {
              Accept: 'application/json,text/plain,*/*',
              'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0; ArtemisHorizons)'
            },
            signal: AbortSignal.timeout(55000)
          })
          const body = await res.text()
          const outHeaders = new Headers()
          outHeaders.set('Content-Type', 'application/json; charset=utf-8')
          outHeaders.set('Access-Control-Allow-Origin', '*')
          outHeaders.set('Cache-Control', 'public, max-age=60')
          const resp = new Response(body, { status: res.status, headers: outHeaders })
          // 写入 KV 兜底（保留 10 分钟）
          if (KV) await KV.put('artemis-horizons-last', body, { expirationTtl: 600 }).catch(() => {})
          // 写入边缘缓存
          await cache.put(cacheKey, resp.clone())
          return resp
        } catch (e) {
          // JPL 超时/失败：尝试 KV 兜底返回上一次成功的数据
          if (KV) {
            const stale = await KV.get('artemis-horizons-last')
            if (stale) {
              return new Response(stale, {
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'public, max-age=30',
                  'X-Artemis-Stale': 'true'
                }
              })
            }
          }
          return new Response(JSON.stringify({ error: 'JPL Horizons 暂时不可达：' + e.message }), {
            status: 502, headers: corsHeaders
          })
        }
      }

      // Starlink TLE 代理（供云函数拉取，6 小时边缘缓存 + KV 兜底）
      if (url.pathname === '/starlink-tle') {
        const cache = caches.default
        const cacheKey = new Request(url.toString(), request)
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        try {
          const r = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', {
            headers: { 'User-Agent': ua, 'Accept': '*/*' },
            signal: AbortSignal.timeout(30000)
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const body = await r.text()
          // 成功：写入 KV 兜底缓存（保留 7 天）
          if (KV) await KV.put('starlink-tle-raw', body, { expirationTtl: 604800, metadata: { ts: Date.now() } }).catch(() => {})
          const resp = new Response(body, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=21600' }
          })
          await cache.put(cacheKey, resp.clone())
          return resp
        } catch (e) {
          // 上游失败：尝试 KV 兜底
          if (KV) {
            const { value, metadata } = await KV.getWithMetadata('starlink-tle-raw')
            if (value) {
              const age = metadata?.ts ? ((Date.now() - metadata.ts) / 3600000).toFixed(1) : '?'
              return new Response(value, {
                headers: {
                  'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'public, max-age=3600',
                  'X-TLE-Stale': 'true', 'X-TLE-Age-Hours': age
                }
              })
            }
          }
          return new Response(JSON.stringify({ code: 502, message: 'CelesTrak error', detail: e.message }), { status: 502, headers: corsHeaders })
        }
      }

      // Starlink TLE 精简版（返回全部卫星 TLE，JSON 格式，供云函数拉取 + KV 兜底）
      if (url.pathname === '/starlink-tle-mini') {
        const cache = caches.default
        // 云函数带 nocache 参数时跳过边缘缓存，确保拿到最新数据
        const skipCache = url.searchParams.has('nocache')
        if (!skipCache) {
          const cacheKey = new Request(url.origin + url.pathname, request)
          const cached = await cache.match(cacheKey)
          if (cached) return cached
        }

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        try {
          const r = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', {
            headers: { 'User-Agent': ua, 'Accept': '*/*' },
            signal: AbortSignal.timeout(30000)
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const raw = await r.text()
          const lines = raw.trim().split('\n').map(l => l.trim())

          // 解析所有卫星
          const sats = []
          for (let i = 0; i + 2 < lines.length; i += 3) {
            if (lines[i + 1] && lines[i + 1].startsWith('1 ') && lines[i + 2] && lines[i + 2].startsWith('2 ')) {
              sats.push(lines[i] + '\n' + lines[i + 1] + '\n' + lines[i + 2])
            }
          }

          // 不采样，返回全部
          const result = JSON.stringify({ total: sats.length, sampled: sats.length, tle: sats.join('\n') })
          // 成功：写入 KV 兜底缓存（保留 7 天）
          if (KV) await KV.put('starlink-tle-mini', result, { expirationTtl: 604800, metadata: { ts: Date.now(), total: sats.length } }).catch(() => {})
          const resp = new Response(result, {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=21600' }
          })
          // 始终更新缓存（用不带参数的 key，这样普通请求也能命中新缓存）
          const cleanCacheKey = new Request(url.origin + url.pathname, request)
          await cache.put(cleanCacheKey, resp.clone())
          return resp
        } catch (e) {
          // 上游失败：尝试 KV 兜底
          if (KV) {
            const { value, metadata } = await KV.getWithMetadata('starlink-tle-mini')
            if (value) {
              const age = metadata?.ts ? ((Date.now() - metadata.ts) / 3600000).toFixed(1) : '?'
              return new Response(value, {
                headers: {
                  'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'public, max-age=3600',
                  'X-TLE-Stale': 'true', 'X-TLE-Age-Hours': age
                }
              })
            }
          }
          return new Response(JSON.stringify({ code: 502, message: 'CelesTrak error', detail: e.message }), { status: 502, headers: corsHeaders })
        }
      }

      // 空间站 TLE 代理（ISS NORAD 25544 / 天宫 NORAD 48274，6 小时边缘缓存 + KV 兜底）
      if (url.pathname === '/station-tle') {
        const cache = caches.default
        const cacheKey = new Request(url.toString(), request)
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        // 同时拉取 ISS 和天宫的 TLE
        const noradIds = [25544, 48274]
        const results = {}
        const fetchTLE = async (id) => {
          const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`, {
            headers: { 'User-Agent': ua, 'Accept': '*/*' },
            signal: AbortSignal.timeout(15000)
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const raw = await r.text()
          const lines = raw.trim().split('\n').map(l => l.trim())
          if (lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ')) {
            return { name: lines[0], line1: lines[1], line2: lines[2] }
          }
          throw new Error('Invalid TLE format')
        }

        try {
          const [iss, tiangong] = await Promise.all(noradIds.map(id => fetchTLE(id).catch(() => null)))
          results['25544'] = iss
          results['48274'] = tiangong
          const body = JSON.stringify({ code: 0, ts: Date.now(), tle: results })
          // 写入 KV 兜底
          if (KV) await KV.put('station-tle', body, { expirationTtl: 604800, metadata: { ts: Date.now() } }).catch(() => {})
          const resp = new Response(body, {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=21600' }
          })
          await cache.put(cacheKey, resp.clone())
          return resp
        } catch (e) {
          // KV 兜底
          if (KV) {
            const { value, metadata } = await KV.getWithMetadata('station-tle')
            if (value) {
              const age = metadata?.ts ? ((Date.now() - metadata.ts) / 3600000).toFixed(1) : '?'
              return new Response(value, {
                headers: {
                  'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'public, max-age=3600',
                  'X-TLE-Stale': 'true', 'X-TLE-Age-Hours': age
                }
              })
            }
          }
          return new Response(JSON.stringify({ code: 502, message: 'CelesTrak station TLE error', detail: e.message }), { status: 502, headers: corsHeaders })
        }
      }

      // SpaceX 官网 API 代理（content.spacex.com 直连被部分云服务商拦截）
      if (url.pathname.startsWith('/spacex-api/')) {
        // 边缘缓存 5 分钟（SpaceX 数据更新不频繁）
        const cache = caches.default
        const cacheKey = new Request(url.toString(), request)
        const cached = await cache.match(cacheKey)
        if (cached) return cached

        const apiPath = url.pathname.replace('/spacex-api/', '')
        const targetUrl = `https://content.spacex.com/api/spacex-website/${apiPath}`
        const resp = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'Referer': 'https://www.spacex.com/',
            'Origin': 'https://www.spacex.com'
          }
        })
        const body = await resp.text()
        const result = new Response(body, {
          status: resp.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300'
          }
        })
        if (resp.ok) {
          await cache.put(cacheKey, result.clone())
        }
        return result
      }

      if (url.pathname === '/nasa-apod') {
        const date = url.searchParams.get('date') || ''
        const apiKey = url.searchParams.get('api_key') || 'DEMO_KEY'
        let target = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}`
        if (date) target += '&date=' + date
        const resp = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0)' }
        })
        const body = await resp.text()
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' }
        })
      }

      return new Response(JSON.stringify({ code: 404, message: 'Not Found' }), { status: 404, headers: corsHeaders })

    } catch (err) {
      return new Response(
        JSON.stringify({ code: 500, message: err.message }),
        { status: 500, headers: corsHeaders }
      )
    }
  }
}
