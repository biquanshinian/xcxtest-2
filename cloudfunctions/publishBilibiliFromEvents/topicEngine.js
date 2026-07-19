/**
 * B 站话题：词库命中 + AI 补全 + 自动晋升
 */
const cloud = require('wx-server-sdk')

const TOPICS_COL = 'bilibili_topic_keywords'
const BLACKLIST_COL = 'bilibili_topic_blacklist'

function now() {
  return Date.now()
}

function normalizeTopic(raw) {
  return String(raw || '')
    .replace(/[#＃\s]/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .slice(0, 12)
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadBlacklist(db) {
  try {
    const res = await db.collection(BLACKLIST_COL).limit(200).get()
    return new Set(
      (res.data || [])
        .map((r) => normalizeTopic(r.word || r.topic || r._id))
        .filter(Boolean)
        .map((w) => w.toLowerCase())
    )
  } catch (e) {
    return new Set()
  }
}

async function loadActiveTopics(db) {
  try {
    const res = await db
      .collection(TOPICS_COL)
      .where({ enabled: true, status: 'active' })
      .limit(200)
      .get()
    return res.data || []
  } catch (e) {
    return []
  }
}

function matchTopics(text, rows) {
  const hay = String(text || '')
  const hits = []
  for (const row of rows) {
    const needles = [row.keyword, ...(Array.isArray(row.aliases) ? row.aliases : [])]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
    let matched = false
    if (row.pattern) {
      try {
        if (new RegExp(row.pattern, 'i').test(hay)) matched = true
      } catch (e) {}
    }
    if (!matched) {
      for (const n of needles) {
        if (hay.toLowerCase().includes(n.toLowerCase())) {
          matched = true
          break
        }
        try {
          if (new RegExp(escapeRegExp(n), 'i').test(hay)) {
            matched = true
            break
          }
        } catch (e) {}
      }
    }
    if (matched) hits.push(row)
  }
  hits.sort((a, b) => {
    const p = Number(b.priority || 0) - Number(a.priority || 0)
    if (p) return p
    return Number(b.hitCount || 0) - Number(a.hitCount || 0)
  })
  return hits
}

async function bumpHit(db, row) {
  if (!row || !row._id) return
  try {
    await db.collection(TOPICS_COL).doc(row._id).update({
      data: {
        hitCount: (Number(row.hitCount) || 0) + 1,
        lastHitAt: now(),
        updatedAt: now()
      }
    })
  } catch (e) {}
}

function buildTopicPrompt(text) {
  return (
    '你是航天资讯话题助手。根据下面文本提取 3 到 5 个适合 B 站动态的短话题（2-6 个汉字或英文专有名词），' +
    '只返回 JSON 数组字符串，例如 ["星舰","SpaceX"]，不要其它说明。\n\n' +
    String(text || '').slice(0, 1200)
  )
}

function parseTopicArray(content) {
  const m = String(content || '').match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr.map(normalizeTopic).filter((t) => t.length >= 2)
  } catch (e) {
    return []
  }
}

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

/**
 * 云函数端 AI 入口：wx-server-sdk >= 3.0.5 用 cloud.ai()，旧版用 cloud.extend.AI
 */
function getAIEntry() {
  try {
    if (typeof cloud.ai === 'function') {
      const inst = cloud.ai()
      if (inst && typeof inst.createModel === 'function') return inst
    }
  } catch (e) {
    console.warn('[topicAI] cloud.ai() 初始化失败:', e.message || e)
  }
  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    return cloud.extend.AI
  }
  return null
}

/**
 * 主通道：云开发 AI+ 混元（与小程序「星问AI」、推文翻译同一套能力），零配置可用
 */
async function callTopicAIHunyuan(prompt) {
  const AI = getAIEntry()
  if (!AI) {
    console.warn('[topicAI] 云开发 AI 能力不可用：wx-server-sdk 缺少 cloud.ai()/extend.AI（需 >= 3.0.5-beta.1，请重新部署并安装依赖）')
    return []
  }

  const providers = [
    { provider: 'cloudbase', model: 'hy3-preview' },
    { provider: 'hunyuan-v3', model: 'hy3-preview' },
    { provider: 'hunyuan-open', model: 'hunyuan-lite' }
  ]
  const messages = [
    { role: 'system', content: '只输出 JSON 数组' },
    { role: 'user', content: prompt }
  ]

  for (const p of providers) {
    try {
      const model = AI.createModel(p.provider)
      const res = await Promise.race([
        model.generateText({ model: p.model, messages, temperature: 0.3, max_tokens: 200 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 12000))
      ])
      const topics = parseTopicArray(extractLLMText(res))
      if (topics.length) {
        console.log(`[topicAI] hunyuan ok (${p.provider}/${p.model})`, JSON.stringify(topics))
        return topics
      }
    } catch (e) {
      console.warn(`[topicAI] generateText 失败 (${p.provider}/${p.model}):`, e.message || e)
    }

    // 部分环境 generateText 不可用，回退 streamText（与 syncSpaceXTweets 翻译一致）
    try {
      const model = AI.createModel(p.provider)
      if (typeof model.streamText !== 'function') continue
      const streamRes = await Promise.race([
        model.streamText({ data: { model: p.model, messages, temperature: 0.3, max_tokens: 200 } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI stream timeout')), 12000))
      ])
      const topics = parseTopicArray(await collectTextStream(streamRes && streamRes.textStream))
      if (topics.length) {
        console.log(`[topicAI] hunyuan stream ok (${p.provider}/${p.model})`, JSON.stringify(topics))
        return topics
      }
    } catch (e) {
      console.warn(`[topicAI] streamText 失败 (${p.provider}/${p.model}):`, e.message || e)
    }
  }
  return []
}

/**
 * 备用通道：外部 OpenAI 兼容接口（BILI_TOPIC_AI_BASE/KEY），不配则跳过
 */
async function callTopicAIExternal(prompt) {
  const base = String(process.env.BILI_TOPIC_AI_BASE || '').replace(/\/$/, '')
  const key = String(process.env.BILI_TOPIC_AI_KEY || '').trim()
  if (!base || !key) return []

  try {
    const https = require('https')
    const http = require('http')
    const url = new URL(base.includes('/chat/completions') ? base : `${base}/chat/completions`)
    const body = JSON.stringify({
      model: process.env.BILI_TOPIC_AI_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: '只输出 JSON 数组' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    })
    const lib = url.protocol === 'https:' ? https : http
    const raw = await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 12000
        },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('AI timeout'))
      })
      req.write(body)
      req.end()
    })
    const parsed = JSON.parse(raw)
    return parseTopicArray(parsed?.choices?.[0]?.message?.content || '')
  } catch (e) {
    console.warn('[topicAI] external', e.message || e)
    return []
  }
}

/**
 * 话题 AI：混元（星问AI 同款，零配置）优先，外部接口兜底
 */
async function callTopicAI(text, cfg) {
  if (!cfg.aiTopicEnabled) return []
  const prompt = buildTopicPrompt(text)

  const fromHunyuan = await callTopicAIHunyuan(prompt)
  if (fromHunyuan.length) return fromHunyuan

  return callTopicAIExternal(prompt)
}

async function upsertAiTopic(db, topic, blacklist, cfg) {
  const t = normalizeTopic(topic)
  if (!t || blacklist.has(t.toLowerCase())) return null

  try {
    const exist = await db.collection(TOPICS_COL).where({ topic: t }).limit(1).get()
    const row = (exist.data || [])[0]
    if (row) {
      const nextSuggest = (Number(row.suggestCount) || 0) + 1
      const patch = {
        suggestCount: nextSuggest,
        updatedAt: now()
      }
      if (
        cfg.aiTopicAutopromote &&
        row.status === 'pending' &&
        nextSuggest >= Number(cfg.aiPromoteMinSuggests || 2)
      ) {
        patch.status = 'active'
        patch.enabled = true
        patch.source = 'auto_promote'
      }
      await db.collection(TOPICS_COL).doc(row._id).update({ data: patch })
      return { ...row, ...patch, topic: t }
    }

    const payload = {
      keyword: t,
      topic: t,
      aliases: [],
      pattern: '',
      enabled: false,
      priority: 50,
      source: 'ai',
      status: 'pending',
      hitCount: 0,
      suggestCount: 1,
      lastHitAt: 0,
      createdAt: now(),
      updatedAt: now()
    }
    if (cfg.aiTopicAutopromote && Number(cfg.aiPromoteMinSuggests || 2) <= 1) {
      payload.enabled = true
      payload.status = 'active'
      payload.source = 'auto_promote'
    }
    const res = await db.collection(TOPICS_COL).add({ data: payload })
    return { ...payload, _id: res._id }
  } catch (e) {
    console.warn('[upsertAiTopic]', e.message || e)
    return null
  }
}

/**
 * @returns {{ topics: string[], matched: object[] }}
 */
async function resolveTopics(db, text, cfg) {
  const always = Array.isArray(cfg.alwaysTopics) ? cfg.alwaysTopics.map(normalizeTopic).filter(Boolean) : ['火星探索日志']
  const topicMax = Math.max(1, Math.min(8, Number(cfg.topicMax) || 5))
  const blacklist = await loadBlacklist(db)
  const active = await loadActiveTopics(db)
  const hits = matchTopics(text, active)

  for (const h of hits.slice(0, 8)) {
    await bumpHit(db, h)
  }

  let topics = []
  const seen = new Set()
  const push = (t) => {
    const n = normalizeTopic(t)
    if (!n || seen.has(n.toLowerCase()) || blacklist.has(n.toLowerCase())) return
    seen.add(n.toLowerCase())
    topics.push(n)
  }

  for (const h of hits) push(h.topic || h.keyword)
  for (const a of always) push(a)

  const nonAlwaysHits = hits.filter((h) => !always.map((x) => x.toLowerCase()).includes(normalizeTopic(h.topic || h.keyword).toLowerCase()))
  if (nonAlwaysHits.length < 2 && cfg.aiTopicEnabled !== false) {
    const aiList = await callTopicAI(text, cfg)
    for (const t of aiList) {
      const row = await upsertAiTopic(db, t, blacklist, cfg)
      if (row && (row.status === 'active' || row.enabled === true)) {
        push(row.topic)
      }
    }
  }

  topics = topics.slice(0, topicMax)
  return { topics, matched: hits }
}

function formatTopicsLine(topics) {
  return (topics || []).map((t) => `#${normalizeTopic(t)}#`).filter((x) => x.length > 3).join(' ')
}

module.exports = {
  normalizeTopic,
  resolveTopics,
  formatTopicsLine,
  TOPICS_COL,
  BLACKLIST_COL
}
