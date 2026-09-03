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

  // CloudBase / OpenAI / 腾讯混元
  const choice =
    (res.choices && res.choices[0]) ||
    (res.result && res.result.choices && res.result.choices[0]) ||
    (res.data && res.data.choices && res.data.choices[0]) ||
    (res.Response && res.Response.Choices && res.Response.Choices[0]) ||
    (res.data && res.data.Response && res.data.Response.Choices && res.data.Response.Choices[0])
  if (choice) {
    const msg = choice.message || choice.delta || choice.Message || choice
    const fromMsg = normalizeContent(msg && (msg.content || msg.Content))
    if (fromMsg) return fromMsg
    const fromChoice = normalizeContent(choice.text || choice.content || choice.Content)
    if (fromChoice) return fromChoice
  }

  if (res.message) {
    const fromTop = normalizeContent(res.message.content || res.message.Content)
    if (fromTop) return fromTop
  }
  if (res.content) return normalizeContent(res.content)
  if (res.text) return normalizeContent(res.text)
  if (res.output_text) return normalizeContent(res.output_text)
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

/** 账号级失败：换 Hunyuan provider 也没用，应立刻改走外部兜底。 */
function isAccountFatalLlmError(msg) {
  return /未开通|not\s*activated|无权限|permission|unauthorized|欠费|arrear|配额|quota/i.test(
    String(msg || '')
  )
}

/** 模型名不对：换 hunyuan-v3 / hunyuan-open 仍可能成功，不要整链熔断。 */
function isModelMissingError(msg) {
  return /模型不存在|model\s*not\s*(found|exist)|invalid\s*model|InvalidParameter\.Model/i.test(
    String(msg || '')
  )
}

/**
 * 快速熔断（兼容旧调用）：账号级 + 模型不存在。
 * 调用方应按 isAccountFatalLlmError / isModelMissingError 区分是否换 provider。
 */
function isFatalLlmError(msg) {
  return isAccountFatalLlmError(msg) || isModelMissingError(msg)
}

function hasExternalConfig() {
  const base = String(
    process.env.OA_CONTENT_AI_BASE || process.env.BILI_TOPIC_AI_BASE || ''
  ).replace(/\/$/, '')
  const key = String(process.env.OA_CONTENT_AI_KEY || process.env.BILI_TOPIC_AI_KEY || '').trim()
  return !!(base && key)
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

async function resolveModelText(res) {
  let text = extractLLMText(res)
  if (text) return text
  if (res && res.data && typeof res.data === 'object') {
    text = extractLLMText(res.data)
    if (text) return text
  }
  return collectTextStream(res && res.textStream)
}

async function tryGenerateOnce(AI, provider, modelName, messages, { temperature, maxTokens, timeoutMs }) {
  const model = AI.createModel(provider)
  if (typeof model.generateText !== 'function') return ''
  const shapes = buildCallShapes(modelName, messages, { temperature, maxTokens })
  let lastErr = null
  for (let i = 0; i < shapes.length; i++) {
    try {
      const work = (async () => {
        const res = await model.generateText(shapes[i])
        return resolveModelText(res)
      })()
      return await Promise.race([
        work,
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), timeoutMs))
      ])
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
      const work = (async () => {
        const streamRes = await model.streamText(shapes[i])
        return resolveModelText(streamRes)
      })()
      return await Promise.race([
        work,
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI stream timeout')), timeoutMs))
      ])
    } catch (e) {
      lastErr = e
      if (i === 0 && isMissingModelParamError(e && e.message)) continue
      throw e
    }
  }
  if (lastErr) throw lastErr
  return ''
}

function hunyuanProviderChain(liteFirst) {
  const main = [
    { provider: 'cloudbase', model: 'hy3-preview', timeoutMs: 24000 },
    { provider: 'hunyuan-v3', model: 'hy3-preview', timeoutMs: 24000 },
    { provider: 'hunyuan-open', model: 'hunyuan-lite', timeoutMs: 16000 }
  ]
  if (liteFirst) return [main[2], main[1]]
  return main
}

async function callHunyuan(messages, { temperature = 0.7, maxTokens = 2500, liteFirst, budgetMs } = {}, errors = []) {
  const AI = getAIEntry()
  if (!AI) {
    pushErr(errors, '云开发 AI 不可用（需 wx-server-sdk 支持 cloud.ai / extend.AI）')
    return ''
  }
  // 与推文翻译 / 星问一致：cloudbase → hunyuan-v3 → hunyuan-open。
  // 空响应再试 stream（部分环境 generateText 只回 textStream）。
  const providers = hunyuanProviderChain(liteFirst)
  const cappedTokens = Math.min(2200, Math.max(400, Number(maxTokens) || 2200))
  const roundDeadline = Date.now() + (Number(budgetMs) || (liteFirst ? 28000 : 65000))

  for (const p of providers) {
    const remain = roundDeadline - Date.now()
    if (remain < 4000) {
      pushErr(errors, '混元轮询超总预算，已熔断')
      return ''
    }
    const timeoutMs = Math.max(4000, Math.min(p.timeoutMs, remain - 1500))
    let skipStream = false
    try {
      const text = await tryGenerateOnce(AI, p.provider, p.model, messages, {
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
      if (isAccountFatalLlmError(msg)) return ''
      if (isModelMissingError(msg)) skipStream = true
    }

    if (skipStream || Date.now() + 4000 > roundDeadline) continue
    try {
      const text = await tryStreamOnce(AI, p.provider, p.model, messages, {
        temperature,
        maxTokens: cappedTokens,
        timeoutMs: Math.max(4000, Math.min(timeoutMs, roundDeadline - Date.now() - 500))
      })
      if (text) {
        console.log(`[oaLLM] ok streamText ${p.provider}/${p.model} len=${text.length}`)
        return text
      }
      pushErr(errors, `${p.provider}/${p.model} streamText 空响应`)
    } catch (e) {
      const msg = e.message || String(e)
      pushErr(errors, `${p.provider}/${p.model} streamText: ${msg}`)
      console.warn(`[oaLLM] streamText fail ${p.provider}:`, msg)
      if (isAccountFatalLlmError(msg)) return ''
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
          timeout: 45000
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
async function generateText({ system, user, temperature, maxTokens, preferExternal, liteFirst }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user || '' })
  const errors = []
  let text = ''
  // 未配外部 Key 时 preferExternal 不能跳过混元，否则必然空正文
  const skipHunyuan = !!(preferExternal && hasExternalConfig())
  if (!skipHunyuan) {
    text = await callHunyuan(messages, { temperature, maxTokens, liteFirst }, errors)
  }
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
  isAccountFatalLlmError,
  isModelMissingError,
  isMissingModelParamError,
  hasExternalConfig,
  hunyuanProviderChain,
  buildCallShapes
}
