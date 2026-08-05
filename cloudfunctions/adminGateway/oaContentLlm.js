/**
 * 公众号内容创作 LLM：混元优先，OA_CONTENT_AI_* / BILI_TOPIC_AI_* 外部兼容接口兜底
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const http = require('http')
const { URL } = require('url')

try {
  if (typeof cloud.init === 'function') {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  }
} catch (e) {}

function normalizeContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (!c || typeof c !== 'object') return ''
        return c.text || c.content || c.value || ''
      })
      .join('')
      .trim()
  }
  if (typeof content === 'object') {
    if (content.text) return String(content.text).trim()
    if (content.content) return normalizeContent(content.content)
  }
  return String(content).trim()
}

function extractLLMText(res) {
  if (!res) return ''
  if (typeof res === 'string') return res.trim()

  // CloudBase / OpenAI 兼容
  const choice =
    (res.choices && res.choices[0]) ||
    (res.result && res.result.choices && res.result.choices[0]) ||
    (res.data && res.data.choices && res.data.choices[0]) ||
    (res.Response && res.Response.Choices && res.Response.Choices[0])
  if (choice) {
    const msg = choice.message || choice.delta || choice.Message || choice
    const fromMsg = normalizeContent(msg && (msg.content || msg.Content))
    if (fromMsg) return fromMsg
    const fromChoice = normalizeContent(choice.text || choice.content || choice.Content)
    if (fromChoice) return fromChoice
  }

  if (res.content) return normalizeContent(res.content)
  if (res.text) return normalizeContent(res.text)
  if (res.result && typeof res.result === 'string') return res.result.trim()
  if (res.data && typeof res.data === 'string') return res.data.trim()
  if (res.Response && res.Response.Content) return normalizeContent(res.Response.Content)
  return ''
}

async function collectTextStream(textStream) {
  if (!textStream || typeof textStream[Symbol.asyncIterator] !== 'function') return ''
  let out = ''
  for await (const chunk of textStream) {
    if (typeof chunk === 'string') out += chunk
    else if (chunk && typeof chunk === 'object') {
      out += chunk.text || chunk.content || chunk.delta || ''
    } else out += chunk || ''
  }
  return out.trim()
}

function getAIEntry() {
  try {
    if (typeof cloud.ai === 'function') {
      const inst = cloud.ai()
      if (inst && typeof inst.createModel === 'function') return inst
    }
  } catch (e) {}
  try {
    if (cloud.ai && typeof cloud.ai.createModel === 'function') return cloud.ai
  } catch (e) {}
  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    return cloud.extend.AI
  }
  return null
}

function pushErr(bag, msg) {
  if (!bag || !msg) return
  const s = String(msg).slice(0, 180)
  if (!bag.includes(s)) bag.push(s)
}

/**
 * 快速熔断：鉴权/欠费/未开通/模型不存在类错误换 provider 也大概率失败，
 * 不再对同 provider 重试 stream / 变体，省掉整轮 50s×N 的无效等待。
 * 注意：缺 model 参数属于传参形状问题，不熔断（会换 flat / data 再试）。
 */
function isFatalLlmError(msg) {
  return /未开通|not\s*activated|无权限|permission|unauthorized|欠费|arrear|配额|quota|模型不存在|model\s*not\s*(found|exist)|invalid\s*model|InvalidParameter\.Model/i.test(
    String(msg || '')
  )
}

function isMissingModelParamError(msg) {
  return /missing required parameter:\s*model|AI_MODEL_PARAM_REQUIRED/i.test(String(msg || ''))
}

/** 新版 SDK 扁平传参；旧版/小程序用 data 包裹。两种都试，避免「缺 model」假失败。 */
function buildCallShapes(modelName, messages, { temperature, maxTokens }) {
  const flat = {
    model: modelName,
    messages,
    temperature,
    max_tokens: maxTokens
  }
  return [flat, { data: flat }]
}

async function tryGenerateOnce(AI, provider, modelName, messages, { temperature, maxTokens, timeoutMs }) {
  const model = AI.createModel(provider)
  if (typeof model.generateText !== 'function') return ''
  const shapes = buildCallShapes(modelName, messages, { temperature, maxTokens })
  let lastErr = null
  for (let i = 0; i < shapes.length; i++) {
    try {
      const res = await Promise.race([
        model.generateText(shapes[i]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), timeoutMs))
      ])
      return extractLLMText(res)
    } catch (e) {
      lastErr = e
      // 缺 model：换另一种传参形状再试；其它错误直接抛给上层
      if (i === 0 && isMissingModelParamError(e && e.message)) continue
      throw e
    }
  }
  if (lastErr) throw lastErr
  return ''
}

async function tryStreamOnce(AI, provider, modelName, messages, { temperature, maxTokens, timeoutMs }) {
  const model = AI.createModel(provider)
  if (typeof model.streamText !== 'function') return ''
  const shapes = buildCallShapes(modelName, messages, { temperature, maxTokens })
  let lastErr = null
  for (let i = 0; i < shapes.length; i++) {
    try {
      const streamRes = await Promise.race([
        model.streamText(shapes[i]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI stream timeout')), timeoutMs))
      ])
      return collectTextStream(streamRes && streamRes.textStream)
    } catch (e) {
      lastErr = e
      if (i === 0 && isMissingModelParamError(e && e.message)) continue
      throw e
    }
  }
  if (lastErr) throw lastErr
  return ''
}

async function callHunyuan(messages, { temperature = 0.7, maxTokens = 2500 } = {}, errors = []) {
  const AI = getAIEntry()
  if (!AI) {
    pushErr(errors, '云开发 AI 不可用（需 wx-server-sdk 支持 cloud.ai / extend.AI）')
    return ''
  }
  // cloudbase 为当前官方主通道；hy3 / hy3-preview 均试（控制台启用名可能不同）
  const providers = [
    { provider: 'cloudbase', model: 'hy3-preview' },
    { provider: 'cloudbase', model: 'hy3' },
    { provider: 'hunyuan-v3', model: 'hy3-preview' },
    { provider: 'hunyuan-open', model: 'hunyuan-lite' }
  ]
  const cappedTokens = Math.min(2500, Math.max(400, Number(maxTokens) || 2500))
  const timeoutMs = 50000
  // 部分模型对 system 角色不稳定：先完整 messages，再合并为单条 user
  const userOnly = [
    {
      role: 'user',
      content: messages
        .map((m) => `${m.role === 'system' ? '【系统要求】' : ''}${m.content || ''}`)
        .join('\n\n')
    }
  ]
  const variants = [messages, userOnly]
  // 总预算：超过后不再尝试剩余 provider×变体，尽快落到外部兜底/失败返回
  const roundDeadline = Date.now() + 100000

  for (const p of providers) {
    for (const msgs of variants) {
      if (Date.now() > roundDeadline) {
        pushErr(errors, '混元轮询超总预算(100s)，已熔断')
        return ''
      }
      let genFatal = false
      try {
        const text = await tryGenerateOnce(AI, p.provider, p.model, msgs, {
          temperature,
          maxTokens: cappedTokens,
          timeoutMs
        })
        if (text) {
          console.log(`[oaLLM] ok generateText ${p.provider}/${p.model} len=${text.length}`)
          return text
        }
        pushErr(errors, `${p.provider}/${p.model} generateText 空响应`)
      } catch (e) {
        const msg = e.message || String(e)
        pushErr(errors, `${p.provider}/${p.model} generateText: ${msg}`)
        console.warn(`[oaLLM] generateText fail ${p.provider}:`, msg)
        genFatal = isFatalLlmError(msg)
      }
      if (genFatal) {
        // 鉴权/欠费类错误：跳过本 provider 的 stream 与变体
        break
      }
      try {
        const text = await tryStreamOnce(AI, p.provider, p.model, msgs, {
          temperature,
          maxTokens: cappedTokens,
          timeoutMs
        })
        if (text) {
          console.log(`[oaLLM] ok streamText ${p.provider}/${p.model} len=${text.length}`)
          return text
        }
      } catch (e) {
        const msg = e.message || String(e)
        pushErr(errors, `${p.provider}/${p.model} streamText: ${msg}`)
        console.warn(`[oaLLM] streamText fail ${p.provider}:`, msg)
        if (isFatalLlmError(msg)) break
      }
    }
  }
  return ''
}

async function callExternal(messages, { temperature = 0.7, maxTokens = 2500 } = {}, errors = []) {
  const base = String(
    process.env.OA_CONTENT_AI_BASE || process.env.BILI_TOPIC_AI_BASE || ''
  ).replace(/\/$/, '')
  const key = String(
    process.env.OA_CONTENT_AI_KEY || process.env.BILI_TOPIC_AI_KEY || ''
  ).trim()
  if (!base || !key) {
    pushErr(errors, '未配置 OA_CONTENT_AI_BASE/KEY（或 BILI_TOPIC_AI_*）外部兜底')
    return ''
  }
  const model =
    process.env.OA_CONTENT_AI_MODEL || process.env.BILI_TOPIC_AI_MODEL || 'deepseek-chat'
  const url = new URL(base.includes('/chat/completions') ? base : `${base}/chat/completions`)
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: Math.min(2500, Number(maxTokens) || 2500)
  })
  const lib = url.protocol === 'https:' ? https : http
  try {
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
          timeout: 60000
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
        reject(new Error('external AI timeout'))
      })
      req.write(body)
      req.end()
    })
    const parsed = JSON.parse(raw)
    if (parsed && parsed.error) {
      pushErr(errors, `external AI: ${parsed.error.message || JSON.stringify(parsed.error)}`)
      return ''
    }
    const text = extractLLMText(parsed)
    if (!text) pushErr(errors, 'external AI 空响应')
    return text
  } catch (e) {
    pushErr(errors, `external AI: ${e.message || e}`)
    return ''
  }
}

function renderTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = vars[k]
    return v == null ? '' : String(v)
  })
}

/**
 * @returns {Promise<{ text: string, error: string }>}
 * 返回对象避免模块级 lastError 在并发下串台
 */
async function generateText({ system, user, temperature, maxTokens }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user || '' })
  const errors = []
  let text = await callHunyuan(messages, { temperature, maxTokens }, errors)
  if (!text) text = await callExternal(messages, { temperature, maxTokens }, errors)
  if (!text) {
    const detail = errors.slice(-4).join('；') || '未知原因'
    const error = `LLM 不可用：${detail}`
    console.error('[oaLLM]', error)
    return { text: '', error }
  }
  return { text, error: '' }
}

module.exports = {
  generateText,
  renderTemplate,
  extractLLMText,
  getAIEntry,
  isFatalLlmError,
  isMissingModelParamError,
  buildCallShapes
}
