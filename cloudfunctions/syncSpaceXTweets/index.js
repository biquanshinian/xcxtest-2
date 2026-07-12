const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')
const https = require('https')
const http = require('http')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 })
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 })

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
const COLLECTION = 'starship_event_updates'
const MAX_NEW_TWEETS = 2
const MAX_TWEET_AGE_DAYS = 7
const MAX_EVENTS = 100
// 回填模式只补 48 小时内的漏抓推文
const BACKFILL_MAX_AGE_HOURS = 48
// Twitter snowflake 纪元（毫秒），用于从推文 ID 反推发布时间，免拉详情预过滤旧推文
const TWITTER_EPOCH_MS = 1288834974657n
// 视频抓取限制：超过时长/大小的"长视频"不下载存储，只保留缩略图+直链（前端点击复制链接）
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024
const LONG_VIDEO_MAX_DURATION_SEC = 120
// 云函数总超时 60s，视频下载必须留出预算，否则整条推文发布失败造成漏抓
const VIDEO_DOWNLOAD_TIMEOUT_MS = 30000
/** 超过此大小才生成事件视频压缩预览 */
const EVENT_PREVIEW_MIN_BYTES = 1.5 * 1024 * 1024
const EVENT_PREVIEW_WIDTH = 720
const EVENT_PREVIEW_BITRATE = 800
const WORKER_PROXY_URL = process.env.SPACEX_PROXY_URL || ''

const ACCOUNTS_COLLECTION = 'tweet_accounts'

// 硬编码兜底（数据库集合为空时使用）
const DEFAULT_ACCOUNTS = [
  { screenName: 'SpaceX', label: 'SpaceX', author: 'SpaceX自动追踪', cosFolder: 'SpaceX推文图片' },
  { screenName: 'Starlink', label: 'Starlink', author: 'Starlink自动追踪', cosFolder: 'Starlink推文图片' },
  { screenName: 'NASASpaceflight', label: 'NSF', author: 'NSF自动追踪', cosFolder: 'NSF推文图片' },
  { screenName: 'StarshipGazer', label: 'StarshipGazer', author: 'StarshipGazer自动追踪', cosFolder: 'StarshipGazer推文图片' },
  { screenName: 'NASA', label: 'NASA', author: 'NASA自动追踪', cosFolder: 'NASA推文图片' },
  { screenName: 'elonmusk', label: 'Elon Musk', author: 'Elon Musk自动追踪', cosFolder: 'ElonMusk推文图片' },
  { screenName: 'JerryPikePhoto', label: 'Jerry Pike', author: 'Jerry Pike自动追踪', cosFolder: 'JerryPike推文图片' },
  { screenName: 'CNSpaceflight', label: 'CNSpaceflight', author: 'CNSpaceflight自动追踪', cosFolder: 'CNSpaceflight推文图片' },
  { screenName: 'InfographicTony', label: 'Tony Bela', author: 'Tony Bela自动追踪', cosFolder: 'InfographicTony推文图片' },
  { screenName: 'LandSpace_Tech', label: '蓝箭航天', author: '蓝箭航天自动追踪', cosFolder: 'LandSpace推文图片' }
]

/**
 * 从数据库读取启用的追踪账号；集合为空时初始化，
 * 默认列表新增账号时自动补录（已被运营手动停用的不会被重新启用）
 */
async function loadAccounts() {
  try {
    const col = db.collection(ACCOUNTS_COLLECTION)
    const now = Date.now()

    // 读全量（含停用），用于判断默认账号是否缺失
    const allRes = await col.limit(100).get()
    const all = allRes.data || []
    const existNames = new Set(all.map(a => a.screenName))

    const missing = DEFAULT_ACCOUNTS.filter(a => !existNames.has(a.screenName))
    for (const account of missing) {
      try {
        await col.add({ data: { ...account, avatarUrl: '', enabled: true, createdAt: now, updatedAt: now } })
        console.log(`[Sync] 自动补录追踪账号: @${account.screenName}`)
      } catch (e) {}
    }

    if (missing.length > 0 || all.length === 0) {
      const retry = await col.where({ enabled: true }).limit(50).get()
      return (retry.data && retry.data.length > 0) ? retry.data : DEFAULT_ACCOUNTS
    }
    const enabled = all.filter(a => a.enabled === true)
    return enabled.length > 0 ? enabled : DEFAULT_ACCOUNTS
  } catch (e) {
    console.warn('[Sync] 读取 tweet_accounts 失败，使用默认列表:', e.message)
    return DEFAULT_ACCOUNTS
  }
}

let _cosClient = null
function createCOSClient() {
  if (_cosClient) return _cosClient
  _cosClient = new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
  return _cosClient
}

function httpGet(url, timeout = 15000) {
  const mod = url.startsWith('https') ? https : http
  const agent = url.startsWith('https') ? keepAliveHttpsAgent : keepAliveHttpAgent
  return new Promise((resolve, reject) => {
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpaceXTrackerBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout,
      agent
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location
        if (loc.startsWith('/')) {
          const parsed = new URL(url)
          loc = `${parsed.protocol}//${parsed.host}${loc}`
        }
        return httpGet(loc, timeout).then(resolve, reject)
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

/** POST JSON（Worker 翻译等，避免 GET query 超长截断） */
function httpPostJson(url, body, timeout = 15000) {
  const mod = url.startsWith('https') ? https : http
  const agent = url.startsWith('https') ? keepAliveHttpsAgent : keepAliveHttpAgent
  const payload = JSON.stringify(body || {})
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Mozilla/5.0 (compatible; SpaceXTrackerBot/1.0)',
        'Accept': 'application/json'
      },
      timeout,
      agent
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.write(payload)
    req.end()
  })
}

/**
 * 下载二进制内容；maxBytes > 0 时通过 Content-Length 预检 + 边下边计数提前中止，
 * 避免大文件全量下载耗尽云函数执行时间（超限时抛出 EXCEEDS_MAX_SIZE 错误）
 */
function httpsGetBuffer(url, timeout = 20000, maxBytes = 0) {
  const mod = url.startsWith('https') ? https : http
  const agent = url.startsWith('https') ? keepAliveHttpsAgent : keepAliveHttpAgent
  return new Promise((resolve, reject) => {
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXTrackerBot/1.0)' },
      timeout,
      agent
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetBuffer(res.headers.location, timeout, maxBytes).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const contentLength = parseInt(res.headers['content-length'] || '0', 10)
      if (maxBytes > 0 && contentLength > maxBytes) {
        req.destroy()
        return reject(new Error(`EXCEEDS_MAX_SIZE:${contentLength}`))
      }
      const chunks = []
      let total = 0
      res.on('data', chunk => {
        total += chunk.length
        if (maxBytes > 0 && total > maxBytes) {
          req.destroy()
          return reject(new Error(`EXCEEDS_MAX_SIZE:${total}`))
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

async function fetchTimelineTweetIds(screenName) {
  if (!WORKER_PROXY_URL) {
    throw new Error('SPACEX_PROXY_URL 未配置')
  }
  const url = `${WORKER_PROXY_URL}/timeline?user=${screenName}`
  console.log(`[Sync] 获取 ${screenName} 时间线: ${url}`)
  const res = await httpGet(url, 10000)
  if (res.status !== 200) throw new Error(`Worker 返回 HTTP ${res.status}`)
  const json = JSON.parse(res.body)
  return json.ids || []
}

/**
 * 付费批量兜底（twitterapi.io 高级搜索，经 Worker 代理）：
 * 一次请求覆盖全部启用账号，返回 { 账号名小写: [推文ID] }。
 * Worker 侧有小时级 KV 节流 + 美东 6–24 点窗口，本函数每 5 分钟调用也只在整点刷新时真正付费。
 * 失败或未配置 Key 时返回空映射，管线退化为纯 syndication。
 */
async function fetchBatchNewTweetIds(accounts) {
  if (!WORKER_PROXY_URL || !accounts || !accounts.length) return {}
  try {
    const users = accounts.map(a => a.screenName).filter(Boolean).join(',')
    const res = await httpGet(`${WORKER_PROXY_URL}/timeline-batch?users=${encodeURIComponent(users)}`, 20000)
    if (res.status !== 200) return {}
    const json = JSON.parse(res.body)
    const byUser = (json && json.byUser) || {}
    const total = Object.values(byUser).reduce((s, arr) => s + (arr ? arr.length : 0), 0)
    if (total > 0) console.log(`[Sync] 批量兜底命中 ${total} 条新推文 ID（${json.fb || ''}）`)
    return byUser
  } catch (e) {
    console.warn(`[Sync] 批量兜底查询失败: ${e.message}`)
    return {}
  }
}

function containsChinese(s) {
  return /[\u4e00-\u9fff]/.test(s || '')
}

const LLM_TRANSLATE_SYSTEM_PROMPT = '你是专业的航天领域翻译。把用户给的英文推文翻译成简体中文，要求：\n1. 航天术语准确（static fire=静态点火、booster=助推器、catch=捕获、splashdown=溅落、payload=载荷、pad=发射台、scrub=推迟发射）\n2. 保留专有名词原文（如 Starship、Falcon 9、B1067、Starbase、ASDS 船名等）\n3. 保留原文中的链接、@提及、#话题标签不翻译\n4. 语气自然简洁，符合中文新闻快讯风格\n5. 只输出译文，不要任何解释或前缀'

function extractLLMText(res) {
  if (!res) return ''
  if (typeof res === 'string') return res.trim()
  if (res.choices && res.choices[0]) {
    const msg = res.choices[0].message || res.choices[0].delta
    if (msg && msg.content) return String(msg.content).trim()
  }
  if (res.result && res.result.choices && res.result.choices[0]) {
    const msg = res.result.choices[0].message
    if (msg && msg.content) return String(msg.content).trim()
  }
  if (res.content) return String(res.content).trim()
  if (res.text) return String(res.text).trim()
  return ''
}

async function collectTextStream(textStream) {
  if (!textStream || typeof textStream[Symbol.asyncIterator] !== 'function') return ''
  let out = ''
  for await (const chunk of textStream) {
    out += chunk || ''
  }
  return out.trim()
}

function splitForTranslation(text, maxLen = 1200) {
  const src = String(text || '')
  if (src.length <= maxLen) return [src]
  const parts = []
  const paras = src.split(/\n{2,}/)
  let buf = ''
  const flush = () => {
    if (buf) {
      parts.push(buf)
      buf = ''
    }
  }
  for (const para of paras) {
    const next = buf ? `${buf}\n\n${para}` : para
    if (next.length <= maxLen) {
      buf = next
      continue
    }
    flush()
    if (para.length <= maxLen) {
      buf = para
      continue
    }
    const sentences = para.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [para]
    for (const sentence of sentences) {
      const piece = sentence.trim()
      if (!piece) continue
      if ((buf + piece).length <= maxLen) {
        buf += piece
      } else {
        flush()
        if (piece.length <= maxLen) {
          buf = piece
        } else {
          for (let i = 0; i < piece.length; i += maxLen) {
            parts.push(piece.slice(i, i + maxLen))
          }
        }
      }
    }
  }
  flush()
  return parts.length ? parts : [src.slice(0, maxLen)]
}

/**
 * 大模型翻译（混元/cloudbase，主通道）：术语质量高；不可用时返回 ''
 */
async function translateWithLLM(text) {
  if (!text) return ''
  if (!(cloud.extend && cloud.extend.AI && cloud.extend.AI.createModel)) return ''

  const providers = [
    { provider: 'cloudbase', model: 'hy3-preview' },
    { provider: 'hunyuan-v3', model: 'hy3-preview' },
    { provider: 'hunyuan-open', model: 'hunyuan-lite' }
  ]
  const messages = [
    { role: 'system', content: LLM_TRANSLATE_SYSTEM_PROMPT },
    { role: 'user', content: text }
  ]

  for (const p of providers) {
    try {
      const model = cloud.extend.AI.createModel(p.provider)

      const res = await Promise.race([
        model.generateText({
          model: p.model,
          messages,
          temperature: 0.2,
          max_tokens: 800
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM 翻译超时')), 12000))
      ])
      const out = extractLLMText(res)
      if (out && containsChinese(out)) {
        console.log(`[Sync] LLM 翻译成功 (${p.provider}/${p.model})`)
        return out
      }
    } catch (e) {
      console.warn(`[Sync] LLM generateText 失败 (${p.provider}/${p.model}): ${e.message}`)
    }

    // 部分环境下 generateText 不可用，回退 streamText
    try {
      const model = cloud.extend.AI.createModel(p.provider)
      if (typeof model.streamText !== 'function') continue
      const streamRes = await Promise.race([
        model.streamText({
          data: {
            model: p.model,
            messages,
            temperature: 0.2,
            max_tokens: 800
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM stream 超时')), 12000))
      ])
      const out = await collectTextStream(streamRes && streamRes.textStream)
      if (out && containsChinese(out)) {
        console.log(`[Sync] LLM stream 翻译成功 (${p.provider}/${p.model})`)
        return out
      }
    } catch (e) {
      console.warn(`[Sync] LLM streamText 失败 (${p.provider}/${p.model}): ${e.message}`)
    }
  }
  return ''
}

function parseWorkerTranslateBody(body) {
  if (!body) return ''
  try {
    const trJson = JSON.parse(body)
    return (trJson && trJson.translated) ? String(trJson.translated).trim() : ''
  } catch (e) {
    return ''
  }
}

/**
 * Worker 机翻（兜底通道，POST 优先避免 URL 超长；带重试 + 中文校验）
 */
async function translateWithWorker(text) {
  if (!text || !WORKER_PROXY_URL) return ''
  const base = `${WORKER_PROXY_URL.replace(/\/$/, '')}/translate`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const trRes = await httpPostJson(base, { text }, 15000)
      if (trRes.status === 200) {
        const translated = parseWorkerTranslateBody(trRes.body)
        if (translated && containsChinese(translated)) return translated
      }
    } catch (e) {
      console.warn(`[Sync] Worker POST 翻译第 ${attempt + 1} 次失败: ${e.message}`)
    }

    // 短文兼容旧 Worker（仅 GET）
    if (text.length < 900) {
      try {
        const trUrl = `${base}?text=${encodeURIComponent(text)}`
        const trRes = await httpGet(trUrl, 12000)
        if (trRes.status === 200) {
          const translated = parseWorkerTranslateBody(trRes.body)
          if (translated && containsChinese(translated)) return translated
        }
      } catch (e) {
        console.warn(`[Sync] Worker GET 翻译第 ${attempt + 1} 次失败: ${e.message}`)
      }
    }
  }
  return ''
}

/**
 * 单段文本翻译：LLM → Worker
 */
async function translateTextOnce(text) {
  if (!text) return ''
  const llmResult = await translateWithLLM(text)
  if (llmResult) return llmResult
  return await translateWithWorker(text)
}

/**
 * 统一翻译入口：大模型优先，不可用自动回退 Worker；长文分段翻译
 */
async function translateText(text) {
  if (!text) return ''
  if (containsChinese(text)) return text
  if (text.length <= 1800) {
    const once = await translateTextOnce(text)
    if (once) return once
    console.log('[Sync] LLM/Worker 均失败，单段翻译未成功')
    return ''
  }

  const chunks = splitForTranslation(text)
  const parts = []
  for (const chunk of chunks) {
    const part = await translateTextOnce(chunk)
    if (!part) {
      console.warn('[Sync] 长文分段翻译失败')
      return ''
    }
    parts.push(part)
  }
  return parts.join('\n\n')
}

/**
 * 为推文应用中文译文（抓取详情 / 发布前均可调用）
 */
async function applyTranslationToTweet(tweet, screenName, label) {
  if (!tweet || !tweet.text) return tweet
  if (containsChinese(tweet.text)) return tweet
  if (isContentTranslated(tweet)) return tweet

  const fxTranslated = tweet.translation && tweet.translation.text
  const fxValid = fxTranslated && containsChinese(fxTranslated)

  for (let attempt = 0; attempt < 2; attempt++) {
    const translated = await translateText(tweet.text)
    if (translated) {
      tweet.translation = { text: translated, source_lang: 'en', target_lang: 'zh' }
      return tweet
    }
  }

  if (fxValid) {
    console.log(`[Sync] ${screenName || label || 'tweet'} 使用 fxtwitter 自带翻译兜底`)
    return tweet
  }

  tweet.translation = null
  return tweet
}

async function fetchTweetDetail(screenName, tweetId) {
  if (!WORKER_PROXY_URL) return null
  const url = `${WORKER_PROXY_URL}/tweet/${tweetId}?user=${screenName}&lang=zh`
  const res = await httpGet(url, 15000)
  if (res.status !== 200) return null
  try {
    const json = JSON.parse(res.body)
    if (json.code !== 200 || !json.tweet) return null
    const tweet = json.tweet
    await applyTranslationToTweet(tweet, screenName, '')
    return tweet
  } catch { return null }
}

/**
 * 从 fxtwitter tweet 对象中提取作者头像原始 URL
 */
function extractAvatarRawUrl(tweet) {
  if (!tweet) return ''
  if (tweet.author && tweet.author.avatar_url) return tweet.author.avatar_url
  if (tweet.user && tweet.user.profile_image_url_https) return tweet.user.profile_image_url_https
  return ''
}

const AVATAR_CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天

/**
 * 下载头像并上传到 COS，返回 COS URL
 * COS key 固定为 avatars/{screenName}.jpg，每个账号只保留一张
 */
async function uploadAvatarToCOS(rawAvatarUrl, screenName) {
  const cos = createCOSClient()
  // 用 _200x200 尺寸，够用且省空间
  let imgUrl = rawAvatarUrl.replace(/_normal\./, '_200x200.')
  if (!imgUrl.includes('_200x200')) imgUrl = rawAvatarUrl

  const downloadUrl = WORKER_PROXY_URL
    ? `${WORKER_PROXY_URL}/image?url=${encodeURIComponent(imgUrl)}`
    : imgUrl

  const buffer = await httpsGetBuffer(downloadUrl, 15000)
  if (!buffer || buffer.length < 100) return ''

  const key = `avatars/${screenName}.jpg`
  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg'
    }, (err, data) => err ? reject(err) : resolve(data))
  })

  return `${COS_BASE_URL}${encodeURI(key)}`
}

/**
 * 检查并更新账号头像（上传 COS + 30 天周期检测）
 * 返回 COS URL
 */
async function ensureAvatarCOS(account, rawAvatarUrl) {
  if (!rawAvatarUrl) return account.avatarCosUrl || ''

  const now = Date.now()
  const hasExisting = !!(account.avatarCosUrl && account.avatarCosUrl.startsWith(COS_BASE_URL))
  const sameRaw = account.avatarRawUrl === rawAvatarUrl
  const recentlyChecked = account.avatarCheckedAt && (now - account.avatarCheckedAt < AVATAR_CHECK_INTERVAL_MS)

  // 已有 COS 头像 + 原始 URL 没变 + 30 天内检测过 → 跳过
  if (hasExisting && sameRaw && recentlyChecked) return account.avatarCosUrl
  // 手动锁定的头像不自动覆盖
  if (account.avatarLocked) return account.avatarCosUrl

  try {
    const cosUrl = await uploadAvatarToCOS(rawAvatarUrl, account.screenName)
    if (cosUrl && account._id) {
      await db.collection(ACCOUNTS_COLLECTION).doc(account._id).update({
        data: { avatarCosUrl: cosUrl, avatarRawUrl: rawAvatarUrl, avatarCheckedAt: now, updatedAt: now }
      })
      account.avatarCosUrl = cosUrl
      account.avatarRawUrl = rawAvatarUrl
      account.avatarCheckedAt = now
      console.log(`[Sync] ${account.screenName} 头像已上传 COS: ${cosUrl}`)
    }
    return cosUrl || account.avatarCosUrl || ''
  } catch (e) {
    console.warn(`[Sync] ${account.screenName} 头像上传失败: ${e.message}`)
    return account.avatarCosUrl || ''
  }
}

function generateTitle(tweet, label) {
  const translated = tweet.translation?.text || ''
  const original = tweet.text || ''
  const source = translated || original
  let title = source.split(/[。！？\n]/)[0].trim()
  if (title.length > 30) title = title.substring(0, 28) + '…'
  if (!title) title = `${label} 动态更新`
  return title
}

function generateContent(tweet) {
  const translated = tweet.translation?.text || ''
  const original = tweet.text || ''
  return translated || original
}

/**
 * 判断事件内容是否已是中文（用于翻译状态标记）
 */
function isContentTranslated(tweet) {
  const translated = tweet.translation?.text || ''
  if (translated && containsChinese(translated)) return true
  // 原文本身是中文也算已翻译
  return containsChinese(tweet.text || '')
}

async function uploadImageToCOS(imageUrl, tweetId, index, cosFolder) {
  const cos = createCOSClient()
  let imgUrl = imageUrl
  if (imgUrl.includes('name=orig')) imgUrl = imgUrl.replace('name=orig', 'name=medium')
  else if (!imgUrl.includes('name=')) imgUrl += (imgUrl.includes('?') ? '&' : '?') + 'name=medium'

  const downloadUrl = WORKER_PROXY_URL
    ? `${WORKER_PROXY_URL}/image?url=${encodeURIComponent(imgUrl)}`
    : imgUrl

  const buffer = await httpsGetBuffer(downloadUrl, 25000)
  if (buffer.length > 6 * 1024 * 1024) return null

  const ext = imgUrl.includes('format=png') ? '.png' : '.jpg'
  const key = `${cosFolder}/${tweetId}_${index}${ext}`

  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: buffer,
      ContentType: ext === '.png' ? 'image/png' : 'image/jpeg'
    }, (err, data) => err ? reject(err) : resolve(data))
  })

  return `${COS_BASE_URL}${encodeURI(key)}`
}

/**
 * 从 fxtwitter 视频列表中选择 ≤720p 的最佳视频 URL
 * fxtwitter 只返回一个视频对象（已是最佳质量），通过 width/height 判断是否超过 720p
 */
function pickBestVideoUrl(video) {
  if (!video || !video.url) return null
  // fxtwitter 返回的单个视频对象包含 url, width, height
  return video.url
}

/**
 * 判断是否为长视频（fxtwitter 视频对象带 duration，单位秒）。
 * 长视频不下载存储，只保留缩略图 + 视频直链，前端点击复制链接。
 */
function isLongVideo(video) {
  const duration = Number(video && video.duration) || 0
  return duration > LONG_VIDEO_MAX_DURATION_SEC
}

/**
 * 下载视频并上传到 COS（限制 50MB，超过则提前中止下载并跳过）
 * @returns {Promise<{url:string,key:string,size:number}|null>}
 */
async function uploadVideoToCOS(videoUrl, tweetId, index, cosFolder) {
  const cos = createCOSClient()

  const downloadUrl = WORKER_PROXY_URL
    ? `${WORKER_PROXY_URL}/image?url=${encodeURIComponent(videoUrl)}`
    : videoUrl

  let buffer
  try {
    buffer = await httpsGetBuffer(downloadUrl, VIDEO_DOWNLOAD_TIMEOUT_MS, MAX_VIDEO_SIZE_BYTES)
  } catch (err) {
    if (String(err.message).startsWith('EXCEEDS_MAX_SIZE')) {
      console.warn(`[Sync] 视频超过 ${(MAX_VIDEO_SIZE_BYTES / 1024 / 1024)}MB，跳过存储（保留缩略图+链接）`)
      return null
    }
    throw err
  }

  const key = `${cosFolder}/${tweetId}_video${index}.mp4`

  await new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key,
      Body: buffer,
      ContentType: 'video/mp4'
    }, (err, data) => err ? reject(err) : resolve(data))
  })

  console.log(`[Sync] 视频上传成功: ${key} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`)
  return {
    url: `${COS_BASE_URL}${encodeURI(key)}`,
    key,
    size: buffer.length
  }
}

function eventPreviewKey(sourceKey) {
  const parts = String(sourceKey || '').split('/')
  const file = parts.pop() || `video_${Date.now()}.mp4`
  const folder = parts.join('/')
  const name = file.replace(/\.(mp4|mov|webm)$/i, '') + '_fast.mp4'
  return folder ? `${folder}/preview/${name}` : `preview/${name}`
}

function escapeXmlEvent(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function eventHeadExists(cos, key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) => resolve(!err))
  })
}

function submitEventPreviewJob(cos, inputKey, outputKey) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Tag>Transcode</Tag>
  <Input><Object>${escapeXmlEvent(inputKey)}</Object></Input>
  <Operation>
    <Transcode>
      <Container><Format>mp4</Format></Container>
      <Video>
        <Codec>H.264</Codec>
        <Profile>main</Profile>
        <Bitrate>${EVENT_PREVIEW_BITRATE}</Bitrate>
        <Width>${EVENT_PREVIEW_WIDTH}</Width>
        <Fps>24</Fps>
        <Preset>medium</Preset>
      </Video>
      <Audio>
        <Codec>aac</Codec>
        <Bitrate>64</Bitrate>
        <Channels>2</Channels>
        <Samplerate>44100</Samplerate>
      </Audio>
      <TransConfig>
        <AdjDarMethod>scale</AdjDarMethod>
        <IsCheckReso>false</IsCheckReso>
        <ResoAdjMethod>1</ResoAdjMethod>
      </TransConfig>
    </Transcode>
    <Output>
      <Region>${COS_REGION}</Region>
      <Bucket>${COS_BUCKET}</Bucket>
      <Object>${escapeXmlEvent(outputKey)}</Object>
    </Output>
  </Operation>
  <CallBackFormat>JSON</CallBackFormat>
</Request>`

  return new Promise((resolve, reject) => {
    cos.request({
      Method: 'POST',
      Url: `https://${COS_BUCKET}.ci.${COS_REGION}.myqcloud.com/jobs`,
      Headers: { 'Content-Type': 'application/xml' },
      Body: body
    }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

/**
 * 为 COS 原片生成/解析压缩预览 URL（播放用）；小文件直接返回原片
 */
async function resolveEventPreviewUrl(cos, sourceKey, sizeBytes) {
  if (!sourceKey) return ''
  const originalUrl = `${COS_BASE_URL}${encodeURI(sourceKey)}`
  if (sizeBytes > 0 && sizeBytes < EVENT_PREVIEW_MIN_BYTES) return originalUrl

  const previewKey = eventPreviewKey(sourceKey)
  const previewUrl = `${COS_BASE_URL}${encodeURI(previewKey)}`
  try {
    if (await eventHeadExists(cos, previewKey)) return previewUrl
    await submitEventPreviewJob(cos, sourceKey, previewKey)
    console.log(`[Sync] 已提交事件视频预览转码: ${sourceKey} -> ${previewKey}`)
    return previewUrl
  } catch (e) {
    console.warn(`[Sync] 事件视频预览失败 ${sourceKey}:`, e.message || e)
    return ''
  }
}

function cosKeyFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (!url.startsWith(COS_BASE_URL)) return ''
  try {
    return decodeURI(url.slice(COS_BASE_URL.length).split('?')[0])
  } catch (e) {
    return ''
  }
}

/**
 * 回填近期事件中缺少 previewUrl 的 COS 视频（每轮限量，避免拖垮同步）
 */
async function backfillEventVideoPreviews(limit = 8) {
  const cos = createCOSClient()
  let scanned = 0
  let patched = 0
  let jobs = 0
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: 'published' })
      .orderBy('publishedAt', 'desc')
      .limit(40)
      .field({ _id: true, mediaList: true })
      .get()
    const rows = res.data || []
    for (const doc of rows) {
      if (patched + jobs >= limit) break
      const list = Array.isArray(doc.mediaList) ? doc.mediaList : []
      let changed = false
      const nextList = []
      for (const m of list) {
        if (!m || m.type !== 'video' || !isVideoUrlLike(m.url) || m.isLongVideo) {
          nextList.push(m)
          continue
        }
        scanned++
        if (m.previewUrl && String(m.previewUrl).trim()) {
          nextList.push(m)
          continue
        }
        const key = cosKeyFromPublicUrl(m.url)
        if (!key) {
          nextList.push(m)
          continue
        }
        const previewUrl = await resolveEventPreviewUrl(cos, key, EVENT_PREVIEW_MIN_BYTES + 1)
        if (previewUrl) {
          nextList.push({ ...m, previewUrl })
          changed = true
          if (previewUrl !== m.url) jobs++
          else patched++
        } else {
          nextList.push(m)
        }
      }
      if (changed) {
        try {
          await db.collection(COLLECTION).doc(doc._id).update({
            data: { mediaList: nextList, updatedAt: Date.now() }
          })
          patched++
        } catch (e) {
          console.warn(`[Sync] 回填 previewUrl 失败 ${doc._id}:`, e.message)
        }
      }
    }
  } catch (e) {
    console.warn('[Sync] backfillEventVideoPreviews failed:', e.message || e)
  }
  return { scanned, patched, jobs }
}

function isVideoUrlLike(url) {
  if (!url || typeof url !== 'string') return false
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url.split('#')[0])
}

async function getExistingTweetIds(source) {
  const where = { tweetId: db.command.exists(true) }
  if (source) where.source = source
  const res = await db.collection(COLLECTION)
    .where(where)
    .field({ tweetId: true })
    .limit(100)
    .orderBy('createdAt', 'desc')
    .get()
  return new Set((res.data || []).map(d => d.tweetId).filter(Boolean))
}

async function getLatestSyncedId(source) {
  // 先查事件集合里的最新推文 ID
  const where = { tweetId: db.command.exists(true) }
  if (source) where.source = source
  const res = await db.collection(COLLECTION)
    .where(where)
    .orderBy('publishedAt', 'desc')
    .limit(1)
    .field({ tweetId: true })
    .get()
  const fromEvents = (res.data && res.data.length > 0) ? res.data[0].tweetId : null

  // 再查账号文档里记录的 latestSyncedId
  let fromAccount = null
  if (source) {
    try {
      const accRes = await db.collection(ACCOUNTS_COLLECTION).where({ screenName: source, latestSyncedId: db.command.exists(true) }).limit(1).get()
      if (accRes.data && accRes.data.length > 0) fromAccount = accRes.data[0].latestSyncedId
    } catch (e) {}
  }

  // 取较大的那个
  if (fromEvents && fromAccount) {
    return BigInt(fromEvents) > BigInt(fromAccount) ? fromEvents : fromAccount
  }
  return fromEvents || fromAccount || null
}

async function createEvent(data) {
  const now = Date.now()
  // 回填的旧推文用实际发布时间排序，避免插到信息流顶部
  const publishedAt = data.publishedAt || now
    const payload = {
      title: data.title,
      content: data.content,
      originalText: data.originalText || '',
      translated: !!data.translated,
      mediaList: data.mediaList || [],
      status: 'published',
      author: data.author,
      authorAvatar: data.authorAvatar || '',
      source: data.source,
      tweetId: data.tweetId,
      tweetUrl: data.tweetUrl,
      publishedAt,
      createdAt: now,
      updatedAt: now,
      bilibiliSyncStatus: 'idle'
    }
  const res = await db.collection(COLLECTION).add({ data: payload })
  return res._id
}

/**
 * 同步单个账号。options.backfill = true 时为回填模式：
 * 忽略 latestSyncedId 只按库中已有 tweetId 去重，用于补发之前漏抓的推文（限 48 小时内）
 */
async function syncAccount(account, options = {}) {
  const { screenName, label, author, cosFolder } = account
  const backfill = !!options.backfill
  const maxPublish = options.maxPublish || MAX_NEW_TWEETS
  const result = { account: screenName, published: 0, failed: 0, skipped: 0, details: [] }

  try {
    let tweetIds = await fetchTimelineTweetIds(screenName)
    console.log(`[Sync][${label}] 获取到 ${tweetIds.length} 条推文 ID`)

    // 合并付费批量兜底的新推文 ID（syndication 对部分小账号漏最新推文时由此补齐）
    const extraIds = options.extraIds || []
    if (extraIds.length) {
      tweetIds = [...new Set([...tweetIds, ...extraIds])]
      console.log(`[Sync][${label}] 合并批量兜底 ${extraIds.length} 条 ID，共 ${tweetIds.length} 条`)
    }

    if (tweetIds.length === 0) {
      result.details.push({ status: 'info', message: '未获取到推文' })
      return result
    }

    const existingIds = await getExistingTweetIds(screenName)
    const latestSyncedId = backfill ? null : await getLatestSyncedId(screenName)

    if (latestSyncedId) {
      console.log(`[Sync][${label}] 数据库最新推文 ID: ${latestSyncedId}`)
    }

    const now = Date.now()
    const maxAge = backfill
      ? BACKFILL_MAX_AGE_HOURS * 60 * 60 * 1000
      : MAX_TWEET_AGE_DAYS * 24 * 60 * 60 * 1000
    // snowflake ID 反推时间：早于时效窗口的推文 ID 一定小于 minTweetId，无需拉详情即可跳过
    const minTweetId = (BigInt(now - maxAge) - TWITTER_EPOCH_MS) << 22n
    const candidates = []

    // 按 ID 数值降序（新推文在前）再取前若干条：
    // 上游若返回热度排序列表（如未登录 syndication 的 Top100），按原顺序取会漏掉最新推文
    const sortedIds = [...tweetIds].sort((a, b) => {
      const x = BigInt(a), y = BigInt(b)
      return x > y ? -1 : (x < y ? 1 : 0)
    })

    const scanLimit = backfill ? 20 : 8
    for (const tweetId of sortedIds.slice(0, scanLimit)) {
      if (existingIds.has(tweetId)) continue

      if (latestSyncedId && BigInt(tweetId) <= BigInt(latestSyncedId)) {
        console.log(`[Sync][${label}] 推文 ${tweetId} 早于最新记录，跳过`)
        continue
      }

      // 超出时效窗口（回填 48h / 常规 7 天）的直接跳过，省掉详情请求
      if (BigInt(tweetId) < minTweetId) continue

      // 回填模式或没有 latestSyncedId 时，凑够发布上限就停止拉详情，避免逐条请求超时
      if ((backfill || !latestSyncedId) && candidates.length >= maxPublish) break

      try {
        const tweet = await fetchTweetDetail(screenName, tweetId)
        if (!tweet || !tweet.text) continue

        const tweetTime = (tweet.created_timestamp || 0) * 1000
        if (tweetTime > 0 && (now - tweetTime) > maxAge) {
          console.log(`[Sync][${label}] 跳过旧推文/置顶 ${tweetId}`)
          continue
        }

        candidates.push({ tweetId, tweet, tweetTime })
      } catch (e) {
        console.warn(`[Sync][${label}] 获取 ${tweetId} 详情失败: ${e.message}`)
      }
    }

    candidates.sort((a, b) => b.tweetTime - a.tweetTime)
    console.log(`[Sync][${label}] ${backfill ? '待回填' : '真正的新'}推文: ${candidates.length} 条`)

    // 即使没有新推文，也记录 timeline 最大 ID 到账号文档，下次可以快速跳过（回填模式不产生副作用）
    if (candidates.length === 0) {
      if (!backfill && !latestSyncedId && tweetIds.length > 0 && account._id) {
        const maxId = tweetIds.reduce((a, b) => BigInt(a) > BigInt(b) ? a : b)
        try {
          await db.collection(ACCOUNTS_COLLECTION).doc(account._id).update({
            data: { latestSyncedId: maxId, updatedAt: Date.now() }
          })
          console.log(`[Sync][${label}] 记录最新 ID ${maxId} 到账号文档`)
        } catch (e) {}
      }
      return result
    }

    for (const { tweetId, tweet, tweetTime } of candidates.slice(0, maxPublish)) {
      try {
        const existCheck = await db.collection(COLLECTION).where({ tweetId }).count()
        if (existCheck.total > 0) { result.skipped++; continue }

        // 发布前再次确保译文（媒体上传耗时较长，此处二次翻译 + 未译成功则跳过，避免英文直接入库）
        await applyTranslationToTweet(tweet, screenName, label)
        if (!isContentTranslated(tweet)) {
          console.warn(`[Sync][${label}] 推文 ${tweetId} 翻译未完成，跳过发布（下轮重试）`)
          result.failed++
          result.details.push({ tweetId, status: 'skipped_untranslated', error: '翻译未完成' })
          continue
        }

        const title = generateTitle(tweet, label)
        const content = generateContent(tweet)

        const mediaList = []
        const photos = tweet.media?.photos || []
        for (let i = 0; i < photos.length; i++) {
          try {
            const cosUrl = await uploadImageToCOS(photos[i].url, tweetId, i, cosFolder)
            if (cosUrl) mediaList.push({ type: 'image', url: cosUrl, thumbnailUrl: '' })
          } catch (imgErr) {
            console.warn(`[Sync][${label}] 图片上传失败: ${imgErr.message}`)
          }
        }

        const tweetUrl = tweet.url || `https://x.com/${screenName}/status/${tweetId}`
        const videos = tweet.media?.videos || []
        for (let vi = 0; vi < videos.length; vi++) {
          const video = videos[vi]
          const videoDirectUrl = pickBestVideoUrl(video)
          const longVideo = isLongVideo(video)
          let videoCosUrl = null
          let videoPreviewUrl = ''

          // 长视频不下载存储（避免耗尽云函数预算导致整条推文漏抓），短视频才尝试下载到 COS
          if (videoDirectUrl && !longVideo) {
            try {
              const uploaded = await uploadVideoToCOS(videoDirectUrl, tweetId, vi, cosFolder)
              if (uploaded && uploaded.url) {
                videoCosUrl = uploaded.url
                try {
                  videoPreviewUrl = await resolveEventPreviewUrl(createCOSClient(), uploaded.key, uploaded.size)
                } catch (e) {
                  console.warn(`[Sync][${label}] 预览生成失败: ${e.message}`)
                }
                if (!videoPreviewUrl) videoPreviewUrl = uploaded.url
              }
            } catch (vidErr) {
              console.warn(`[Sync][${label}] 视频上传失败: ${vidErr.message}`)
            }
          } else if (longVideo) {
            console.log(`[Sync][${label}] 长视频 (${Math.round(Number(video.duration) || 0)}s) 跳过存储，仅保留缩略图+链接: ${tweetId}`)
          }

          // 上传缩略图
          let thumbCosUrl = ''
          if (video.thumbnail_url) {
            try {
              thumbCosUrl = await uploadImageToCOS(video.thumbnail_url, tweetId, `v${vi}`, cosFolder)
            } catch (e) {
              thumbCosUrl = video.thumbnail_url
            }
          }

          const mediaEntry = {
            type: 'video',
            url: videoCosUrl || tweetUrl,           // 原片：下载用
            previewUrl: videoCosUrl ? (videoPreviewUrl || videoCosUrl) : '', // 压缩预览：播放用
            thumbnailUrl: thumbCosUrl || video.thumbnail_url || '',
            sourceUrl: tweetUrl                      // 保留原始推文链接作为备用
          }
          // 未存储到 COS 的视频：保留直链供前端复制，长视频额外打标（前端显示"长视频"角标）
          if (!videoCosUrl) {
            mediaEntry.videoUrl = videoDirectUrl || ''
            if (longVideo) mediaEntry.isLongVideo = true
          }
          mediaList.push(mediaEntry)
        }

        const rawAvatarUrl = extractAvatarRawUrl(tweet)
        const avatarCosUrl = await ensureAvatarCOS(account, rawAvatarUrl)

        const eventId = await createEvent({
          title, content, mediaList, author,
          originalText: tweet.text || '',
          translated: isContentTranslated(tweet),
          authorAvatar: avatarCosUrl,
          source: screenName,
          tweetId,
          tweetUrl,
          // 回填的旧推文按实际发布时间入库，保持信息流时间顺序
          publishedAt: backfill && tweetTime > 0 ? tweetTime : undefined
        })

        // 首次获取到头像时，回写 tweet_accounts 集合（兼容旧字段）
        if (avatarCosUrl && !account.avatarUrl && account._id) {
          try {
            await db.collection(ACCOUNTS_COLLECTION).doc(account._id).update({
              data: { avatarUrl: avatarCosUrl, updatedAt: Date.now() }
            })
            account.avatarUrl = avatarCosUrl
          } catch (e) {}
        }

        result.published++
        result.details.push({ tweetId, eventId, title, status: 'published', mediaCount: mediaList.length })
        console.log(`[Sync][${label}] ✅ 发布: ${title}`)

      } catch (err) {
        result.failed++
        result.details.push({ tweetId, status: 'failed', error: err.message })
        console.error(`[Sync][${label}] ❌ 失败: ${err.message}`)
      }
    }
  } catch (err) {
    result.details.push({ status: 'error', message: err.message })
    console.error(`[Sync][${label}] 同步出错: ${err.message}`)
  }

  return result
}

function extractCOSKeys(mediaList) {
  const keys = []
  for (const media of (mediaList || [])) {
    for (const field of ['url', 'thumbnailUrl', 'previewUrl']) {
      const val = media[field] || ''
      if (val.startsWith(COS_BASE_URL)) {
        keys.push(decodeURI(val.slice(COS_BASE_URL.length).split('?')[0]))
      }
    }
  }
  return keys
}

async function deleteCOSFiles(keys) {
  if (!keys.length) return 0
  const cos = createCOSClient()
  let removed = 0
  for (const key of keys) {
    try {
      await new Promise((resolve, reject) => {
        cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err, data) => err ? reject(err) : resolve(data))
      })
      removed++
    } catch (e) {
      console.warn(`[Sync] COS 删除失败 ${key}: ${e.message}`)
    }
  }
  return removed
}

async function cleanOldEvents() {
  const countRes = await db.collection(COLLECTION).count()
  const total = countRes.total
  if (total <= MAX_EVENTS) return 0

  const toDelete = total - MAX_EVENTS
  const oldEvents = await db.collection(COLLECTION)
    .orderBy('publishedAt', 'asc')
    .limit(toDelete)
    .get()

  let deleted = 0
  let cosRemoved = 0
  for (const item of oldEvents.data) {
    const keys = extractCOSKeys(item.mediaList)
    cosRemoved += await deleteCOSFiles(keys)
    await db.collection(COLLECTION).doc(item._id).remove()
    deleted++
  }
  console.log(`[Sync] 清理旧事件: 删除 ${deleted} 条记录 + ${cosRemoved} 个COS文件，剩余 ${MAX_EVENTS} 条`)
  return deleted
}

/**
 * 补翻译专用：Worker 机翻优先（快且稳），失败再试 LLM
 */
async function translateTextForRetranslate(text) {
  if (!text) return ''
  if (containsChinese(text)) return text
  const worker = await translateWithWorker(text)
  if (worker) return worker
  return await translateWithLLM(text)
}

/**
 * 判断事件是否需要补翻译
 */
function isEventNeedsTranslation(evt) {
  if (!evt) return false
  const content = String(evt.content || '').trim()
  const original = String(evt.originalText || '').trim()
  const source = original || content
  if (!source) return false
  if (containsChinese(content)) return false
  return !containsChinese(source)
}

/**
 * 自愈式补翻译：扫描库里未翻译成功的事件，重新翻译并更新
 */
async function retranslateUntranslatedEvents(budgetMs) {
  const stats = { scanned: 0, candidates: 0, fixed: 0, failed: 0, skippedNoSource: 0 }
  try {
    const deadline = Date.now() + (budgetMs || 30000)
    const res = await db.collection(COLLECTION)
      .orderBy('publishedAt', 'desc')
      .limit(MAX_EVENTS)
      .get()
    stats.scanned = (res.data || []).length
    const events = (res.data || []).filter(isEventNeedsTranslation)
    stats.candidates = events.length

    if (events.length === 0) return stats
    console.log(`[Sync] 发现 ${events.length} 条未翻译事件，开始补翻译...`)

    for (const evt of events) {
      if (Date.now() > deadline) break
      const sourceText = (evt.originalText || evt.content || '').trim()
      if (!sourceText) {
        stats.skippedNoSource++
        continue
      }

      const translated = await translateTextForRetranslate(sourceText)
      if (!translated) {
        stats.failed++
        continue
      }

      // 重新生成标题（与 generateTitle 同口径）
      let newTitle = translated.split(/[。！？\n]/)[0].trim()
      if (newTitle.length > 30) newTitle = newTitle.substring(0, 28) + '…'

      try {
        await db.collection(COLLECTION).doc(evt._id).update({
          data: {
            content: translated,
            title: newTitle || evt.title,
            originalText: sourceText,
            translated: true,
            updatedAt: Date.now()
          }
        })
        stats.fixed++
        console.log(`[Sync] ✅ 补翻译成功: ${newTitle}`)
      } catch (e) {}
    }
  } catch (e) {
    console.warn('[Sync] 补翻译扫描失败:', e.message)
  }
  return stats
}

let _syncSpaceXTweetsCollectionsEnsured = false
async function ensureSyncSpaceXTweetsCollectionsOnce() {
  if (_syncSpaceXTweetsCollectionsEnsured) return
  _syncSpaceXTweetsCollectionsEnsured = true
  for (const n of [COLLECTION, ACCOUNTS_COLLECTION]) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
}

exports.main = async (event = {}) => {
  // 全部 action 均为维护任务（同步/回填/补翻译/改头像），仅限定时触发器与云函数间调用；
  // 小程序端无合法调用场景，直接拒绝，防止恶意触发同步或篡改推文头像
  const isServerSide = (() => {
    if (event.TriggerName || event.triggerName) return true
    try {
      const ctx = cloud.getWXContext() || {}
      const chain = String(ctx.SOURCE || '').split(',').map(s => s.trim()).filter(Boolean)
      // 调用链为空 = 云开发控制台手动调用/服务端 API 触发（小程序客户端调用一定带 wx_client），放行
      if (!chain.length) return true
      const last = chain[chain.length - 1]
      return last !== 'wx_client' && last !== 'wx_devtools'
    } catch (e) {
      return false
    }
  })()
  if (!isServerSide) {
    console.warn('[syncSpaceXTweets] 拦截客户端调用, action:', event.action || 'sync')
    return { code: 403, message: 'forbidden' }
  }

  await ensureSyncSpaceXTweetsCollectionsOnce()
  const action = event.action || 'sync'
  if (action === 'clean') return { code: 0, message: 'No cache to clean' }

  // 仅补翻译历史英文推文（可在控制台手动触发）
  if (action === 'retranslate') {
    const stats = await retranslateUntranslatedEvents(event.budgetMs || 55000)
    return {
      code: 0,
      message: `补翻译完成 ${stats.fixed} 条（扫描 ${stats.scanned}，待译 ${stats.candidates}，失败 ${stats.failed}）`,
      retranslated: stats.fixed,
      ...stats
    }
  }

  // 为存量事件视频补压缩预览：{ action: 'backfillVideoPreviews', limit?: 15 }
  if (action === 'backfillVideoPreviews') {
    const stats = await backfillEventVideoPreviews(Math.min(Math.max(parseInt(event.limit, 10) || 15, 1), 30))
    return {
      code: 0,
      message: `视频预览回填：扫描 ${stats.scanned}，更新 ${stats.patched}，提交转码 ${stats.jobs}`,
      ...stats
    }
  }

  // 一次性回填漏抓推文（可在控制台手动触发）：{ action: 'backfill', account?: 'SpaceX', limit?: 3 }
  // 忽略 latestSyncedId，仅按库中已有 tweetId 去重，只补 48 小时内的推文；可重复执行
  if (action === 'backfill') {
    const startTime = Date.now()
    const accountFilter = event.account || ''
    const maxPublish = Math.min(Math.max(parseInt(event.limit, 10) || 3, 1), 5)

    const allAccounts = await loadAccounts()
    const toBackfill = accountFilter
      ? allAccounts.filter(a => a.screenName.toLowerCase() === accountFilter.toLowerCase())
      : allAccounts

    console.log(`[Backfill] 开始回填 ${toBackfill.map(a => a.label).join(', ')}（48h 内，每账号最多 ${maxPublish} 条）...`)

    const accountResults = []
    for (const account of toBackfill) {
      // 云函数总超时 60s，预算不足时停止，剩余账号可再跑一次
      if (Date.now() - startTime > 45000) {
        console.warn(`[Backfill] 时间预算不足，跳过剩余账号: ${account.screenName} 及之后`)
        break
      }
      const result = await syncAccount(account, { backfill: true, maxPublish })
      accountResults.push(result)
    }

    const totalPublished = accountResults.reduce((s, r) => s + r.published, 0)
    const totalFailed = accountResults.reduce((s, r) => s + r.failed, 0)
    const elapsed = Date.now() - startTime
    console.log(`[Backfill] 完成: 补发 ${totalPublished} 条, 失败 ${totalFailed} 条, 耗时 ${elapsed}ms`)

    return {
      code: 0,
      message: totalPublished > 0 ? `回填完成，补发 ${totalPublished} 条` : '没有需要回填的推文',
      accounts: accountResults,
      published: totalPublished,
      failed: totalFailed,
      elapsed
    }
  }

  // 强制更新指定账号头像：{ action: 'updateAvatar', screenName: 'NASA', avatarUrl: 'https://...' }
  if (action === 'updateAvatar') {
    const { screenName, avatarUrl } = event
    if (!screenName || !avatarUrl) return { code: 400, message: '需要 screenName 和 avatarUrl' }
    try {
      const cosUrl = await uploadAvatarToCOS(avatarUrl, screenName)
      // 更新 tweet_accounts，标记为手动锁定
      const accRes = await db.collection(ACCOUNTS_COLLECTION).where({ screenName }).limit(1).get()
      if (accRes.data && accRes.data.length > 0) {
        await db.collection(ACCOUNTS_COLLECTION).doc(accRes.data[0]._id).update({
          data: { avatarCosUrl: cosUrl, avatarRawUrl: avatarUrl, avatarUrl: cosUrl, avatarCheckedAt: Date.now(), avatarLocked: true, updatedAt: Date.now() }
        })
      }
      // 更新所有该账号的事件头像
      const events = await db.collection(COLLECTION).where({ source: screenName }).limit(100).get()
      for (const evt of (events.data || [])) {
        try { await db.collection(COLLECTION).doc(evt._id).update({ data: { authorAvatar: cosUrl } }) } catch (e) {}
      }
      return { code: 0, message: `${screenName} 头像已更新`, cosUrl }
    } catch (e) {
      return { code: 500, message: e.message }
    }
  }

  const startTime = Date.now()
  const accountFilter = event.account || ''

  // 优先修复库里已有英文推文（预算充足时先跑，避免同步耗尽时间后补翻译跑不完）
  const preRetranslatedStats = await retranslateUntranslatedEvents(Math.min(15000, event.preRetranslateBudgetMs || 15000))
  const preRetranslated = preRetranslatedStats.fixed || 0

  const allAccounts = await loadAccounts()
  const toSync = accountFilter
    ? allAccounts.filter(a => a.screenName.toLowerCase() === accountFilter.toLowerCase())
    : allAccounts

  // 账号轮转错峰：每轮定时同步从不同账号开始处理（按 5 分钟轮次滚动起点），
  // 配合时间预算，某轮因视频转存等耗尽预算时被顺延的账号，会在后续轮次轮到队首，
  // 保证账号数量增加（如 20+）后没有账号被持续饿死
  const SYNC_TIME_BUDGET_MS = 45000
  const roundIndex = Math.floor(Date.now() / (5 * 60 * 1000))
  const offset = toSync.length > 1 ? roundIndex % toSync.length : 0
  const rotated = [...toSync.slice(offset), ...toSync.slice(0, offset)]

  console.log(`[Sync] 开始同步（本轮起点 #${offset}）: ${rotated.map(a => a.label).join(', ')}...`)

  // 付费批量兜底：一次请求拿全部账号的新推文 ID（Worker 侧小时级节流，多数轮次直接读缓存）
  const batchIdMap = await fetchBatchNewTweetIds(toSync)

  const accountResults = []
  let deferred = 0
  for (const account of rotated) {
    // 云函数总超时 60s：同步阶段最多用 45s，预算耗尽时顺延剩余账号到下一轮
    if (Date.now() - startTime > SYNC_TIME_BUDGET_MS) {
      deferred++
      accountResults.push({
        account: account.screenName, published: 0, failed: 0, skipped: 0,
        details: [{ status: 'deferred', message: '本轮时间预算不足，顺延到后续轮次' }]
      })
      continue
    }
    const extraIds = batchIdMap[String(account.screenName || '').toLowerCase()] || []
    const result = await syncAccount(account, { extraIds })
    accountResults.push(result)
  }
  if (deferred > 0) {
    console.warn(`[Sync] 时间预算不足，本轮顺延 ${deferred} 个账号（轮转机制会让它们在后续轮次优先处理）`)
  }

  const totalPublished = accountResults.reduce((s, r) => s + r.published, 0)
  const totalFailed = accountResults.reduce((s, r) => s + r.failed, 0)

  const cleaned = await cleanOldEvents()

  // 自愈式补翻译：把库里仍是英文的事件重新翻译（预算 25s）
  const retranslateBudget = Math.max(0, 50000 - (Date.now() - startTime))
  const retranslatedStats = retranslateBudget > 5000
    ? await retranslateUntranslatedEvents(Math.min(retranslateBudget, 25000))
    : { fixed: 0, scanned: 0, candidates: 0, failed: 0 }
  const retranslated = retranslatedStats.fixed || 0

  // 主动补全/刷新头像（缺少 COS 头像 或 需要定期刷新的账号）
  const avatarBudgetMs = Math.max(0, 55000 - (Date.now() - startTime))
  if (avatarBudgetMs > 10000) {
    const nowMs = Date.now()
    const needAvatar = allAccounts.filter(a => {
      if (!a.avatarCosUrl || !a.avatarCosUrl.startsWith(COS_BASE_URL)) return true
      if (!a.avatarCheckedAt || (nowMs - a.avatarCheckedAt > AVATAR_CHECK_INTERVAL_MS)) return true
      return false
    })
    for (const acc of needAvatar.slice(0, 2)) {
      if (Date.now() - startTime > 50000) break
      try {
        const tweetIds = await fetchTimelineTweetIds(acc.screenName)
        if (!tweetIds || !tweetIds.length) continue
        const tweet = await fetchTweetDetail(acc.screenName, tweetIds[0])
        if (!tweet) continue
        const rawUrl = extractAvatarRawUrl(tweet)
        if (rawUrl) {
          console.log(`[Sync] ${acc.screenName} 原始头像 URL: ${rawUrl}`)
          await ensureAvatarCOS(acc, rawUrl)
          console.log(`[Sync] 主动补全/刷新 ${acc.screenName} 头像`)
        }
      } catch (e) {
        console.warn(`[Sync] 补全 ${acc.screenName} 头像失败: ${e.message}`)
      }
    }
  }

  // 批量给缺少头像的已有事件补上 COS 头像
  try {
    const avatarMap = {}
    for (const acc of allAccounts) {
      if (acc.avatarCosUrl && acc.avatarCosUrl.startsWith(COS_BASE_URL)) {
        avatarMap[acc.screenName] = acc.avatarCosUrl
      }
    }
    if (Object.keys(avatarMap).length > 0) {
      const allEvents = await db.collection(COLLECTION).where(db.command.or(
        { authorAvatar: db.command.eq('') },
        { authorAvatar: db.command.exists(false) },
        // 也替换旧的代理 URL 为 COS URL
        { authorAvatar: db.RegExp({ regexp: '^https://api\\.marsx', options: '' }) }
      )).limit(MAX_EVENTS).get()
      for (const evt of (allEvents.data || [])) {
        const avatar = avatarMap[evt.source]
        if (avatar) {
          try {
            await db.collection(COLLECTION).doc(evt._id).update({ data: { authorAvatar: avatar } })
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.warn('[Sync] 补充头像失败:', e.message)
  }

  // 存量事件视频压缩预览回填（时间够才跑）
  let videoPreviewBackfill = { scanned: 0, patched: 0, jobs: 0 }
  if (Date.now() - startTime < 50000) {
    try {
      videoPreviewBackfill = await backfillEventVideoPreviews(6)
    } catch (e) {
      console.warn('[Sync] 视频预览回填失败:', e.message || e)
    }
  }

  const elapsed = Date.now() - startTime
  console.log(`[Sync] 全部完成: ${totalPublished} 条发布, ${totalFailed} 条失败, 补翻译 ${retranslated} 条, 清理 ${cleaned} 条, 预览回填 ${JSON.stringify(videoPreviewBackfill)}, 耗时 ${elapsed}ms`)

  // 有新事件时立刻触发 B 站入队（不等 publishBilibiliFromEvents 定时器）
  let bilibiliEnqueue = null
  if (totalPublished > 0) {
    try {
      const biliRes = await cloud.callFunction({
        name: 'publishBilibiliFromEvents',
        data: { from: 'tweet_sync', published: totalPublished }
      })
      bilibiliEnqueue = biliRes && biliRes.result ? biliRes.result : biliRes
      console.log('[Sync] 已触发 B 站入队', JSON.stringify(bilibiliEnqueue))
    } catch (e) {
      console.warn('[Sync] 触发 B 站入队失败（请确认已部署 publishBilibiliFromEvents 及定时触发器）:', e.message || e)
    }
  }

  return {
    code: 0,
    message: totalPublished > 0 ? 'ok' : '没有新推文',
    accounts: accountResults,
    preRetranslated,
    retranslated,
    cleaned,
    videoPreviewBackfill,
    bilibiliEnqueue,
    elapsed
  }
}
