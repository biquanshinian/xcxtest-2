/**
 * 同步管线翻译：词典 + translation_cache + 混元 AI（主通道）+ TMT（仅兜底）
 * 环境变量: TMT_SECRET_ID, TMT_SECRET_KEY（未配置时跳过 TMT；混元走云开发 AI+，零密钥）
 *
 * 与 ll2Query/translate.js 同源，差异只在这里是离线批量场景：
 * 一轮同步可能翻几百条，混元比 TMT 慢一个量级，所以混元受 beginTranslateRun 的
 * 时间预算约束，超预算的条目留给 TMT / 下一轮（结果进 translation_cache，逐轮补齐）。
 */
const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')

const {
  applyPhraseRules,
  protectTerms,
  restoreTerms,
  shouldMachineTranslate
} = require('./space-terms-i18n.js')

const TMT_HOST = 'tmt.tencentcloudapi.com'
const TMT_SERVICE = 'tmt'
const TMT_VERSION = '2018-03-21'
const TMT_REGION = 'ap-guangzhou'
// TextTranslateBatch 源文本总量上限约 6000 字符，按累计字符数切批留出余量
const BATCH_MAX_CHARS = 4500
const BATCH_MAX_ITEMS = 16
/** 单条超过此长度必须切开，否则整批触发 UnsupportedOperation.TextTooLong */
const ITEM_MAX_CHARS = 4000
const CACHE_COLLECTION = 'translation_cache'

/**
 * 超长文本按段落/句子边界切成 ≤ maxChars 的片段（保序）。
 * 修复「单条超长的独立成批」仍可能超过 TMT 单次上限导致整条失败的问题。
 */
function splitLongText(text, maxChars) {
  const s = String(text || '')
  const limit = Math.max(200, maxChars | 0)
  if (!s) return []
  if (s.length <= limit) return [s]

  const out = []
  let start = 0
  while (start < s.length) {
    if (s.length - start <= limit) {
      out.push(s.slice(start))
      break
    }
    const window = s.slice(start, start + limit)
    let br = -1
    const seps = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' ']
    for (let si = 0; si < seps.length; si++) {
      const sep = seps[si]
      const i = window.lastIndexOf(sep)
      if (i >= Math.floor(limit * 0.35)) {
        br = start + i + sep.length
        break
      }
    }
    if (br <= start) br = start + limit
    out.push(s.slice(start, br))
    start = br
  }
  return out.filter((p) => p && p.length)
}

function sha256(msg) {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex')
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest()
}

function getDb() {
  try {
    return cloud.database()
  } catch (e) {
    return null
  }
}

function hashText(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex')
}

/**
 * 判定文本是否是「像样的中文译文」——防止 TMT 失败降级时把
 * 词典替换过的英文（如 "flight to a 太阳同步轨道 with ..."）当译文写库。
 * URL 与受保护专名不计入英文字符：短句译文里"SpaceX 的 Falcon 9"这类
 * 合法保留的英文不应导致整条译文被误判为非中文而丢弃。
 */
function looksLikelyChinese(text) {
  let s = String(text || '')
  if (!s) return false
  s = s.replace(/https?:\/\/\S+/g, ' ')
  try {
    s = protectTerms(s).text
  } catch (e) {}
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  if (!cjk) return false
  const latin = (s.match(/[A-Za-z]/g) || []).length
  return cjk / (cjk + latin) >= 0.25
}

function isTmtConfigured() {
  const id = String(process.env.TMT_SECRET_ID || '').trim()
  const key = String(process.env.TMT_SECRET_KEY || '').trim()
  // FILL_ME 是 config.json 里的占位符，视为未配置
  return !!(id && key && id !== 'FILL_ME' && key !== 'FILL_ME')
}

let _tmtUnconfiguredLogged = false
function warnTmtUnconfiguredOnce() {
  if (_tmtUnconfiguredLogged) return
  _tmtUnconfiguredLogged = true
  console.warn('[translate] TMT 未配置（TMT_SECRET_ID/TMT_SECRET_KEY 缺失或为占位符），本次同步仅术语词典生效，长文本不写入中文字段')
}

function callTmtHttps(payloadObj) {
  const secretId = String(process.env.TMT_SECRET_ID || '').trim()
  const secretKey = String(process.env.TMT_SECRET_KEY || '').trim()
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(payloadObj)

  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    `host:${TMT_HOST}`,
    '',
    'content-type;host',
    sha256(payload)
  ].join('\n')

  const credentialScope = `${date}/${TMT_SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n')

  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, TMT_SERVICE)
  const secretSigning = hmacSha256(secretService, 'tc3_request')
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex')

  // 格式：算法名后是空格（不是逗号），其余字段逗号分隔
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: TMT_HOST,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Host: TMT_HOST,
        'X-TC-Action': 'TextTranslateBatch',
        'X-TC-Version': TMT_VERSION,
        'X-TC-Region': TMT_REGION,
        'X-TC-Timestamp': String(timestamp),
        Authorization: authorization
      },
      timeout: 20000
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.Response && json.Response.Error) {
            reject(new Error(json.Response.Error.Message || 'TMT error'))
            return
          }
          resolve(json)
        } catch (e) {
          reject(new Error('TMT JSON parse error: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('TMT timeout')) })
    req.write(payload)
    req.end()
  })
}

async function readCacheBatch(hashes) {
  const db = getDb()
  const out = {}
  if (!db || !hashes.length) return out

  const uniq = [...new Set(hashes.filter(Boolean))]
  const chunkSize = 20
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    try {
      const res = await db.collection(CACHE_COLLECTION)
        .where({ hash: db.command.in(chunk) })
        .limit(100)
        .get()
      for (const doc of (res.data || [])) {
        // 跳过历史污染条目（中英夹杂的伪译文），等 cleanTranslationCache 清洗
        if (doc.hash && doc.zh && looksLikelyChinese(doc.zh)) out[doc.hash] = doc.zh
      }
    } catch (e) {
      // 集合不存在时静默跳过
    }
  }
  return out
}

async function writeCacheBatch(entries) {
  const db = getDb()
  if (!db || !entries.length) return
  for (const entry of entries) {
    if (!entry.hash || !entry.zh) continue
    try {
      const res = await db.collection(CACHE_COLLECTION).where({ hash: entry.hash }).limit(1).get()
      const record = {
        hash: entry.hash,
        zh: entry.zh,
        sourceLen: entry.sourceLen || 0,
        updatedAt: db.serverDate(),
        updatedAtMs: Date.now()
      }
      if (res.data && res.data.length > 0) {
        await db.collection(CACHE_COLLECTION).doc(res.data[0]._id).update({ data: record })
      } else {
        await db.collection(CACHE_COLLECTION).add({ data: record })
      }
    } catch (e) {
      // 写入失败不影响主流程
    }
  }
}

async function tmtTranslateBatch(sourceTexts) {
  if (!sourceTexts.length) return []
  if (!isTmtConfigured()) {
    warnTmtUnconfiguredOnce()
    return sourceTexts.map(() => '')
  }

  const payload = {
    Source: 'en',
    Target: 'zh',
    ProjectId: 0,
    SourceTextList: sourceTexts
  }
  const json = await callTmtHttps(payload)
  const list = (json.Response && json.Response.TargetTextList) || []
  return list.map((s) => String(s || '').trim())
}

// ── 混元大模型翻译（主通道；与 ll2Query / syncSpaceXTweets 同一套 AI+） ──

const AI_TRANSLATE_CHUNK_CHARS = 1200
const AI_TRANSLATE_CONCURRENCY = 3
/**
 * 一次云函数调用内混元的总时间预算。函数 timeout 是 800s，留足抓取与写库的时间；
 * 超预算的条目落 TMT 或留到下一轮（6 小时一次，命中缓存后逐轮补齐）。
 */
const AI_RUN_BUDGET_MS = 300000
/** 剩余预算低于这个值就不再开新条目，避免最后一条卡在半路白等 */
const AI_MIN_SLICE_MS = 15000

const AI_TRANSLATE_SYSTEM_PROMPT = `你是航天领域的专业中英翻译。把用户消息中的英文原文翻译成简体中文，要求：
1. 只输出译文本身，不要任何解释、注释、前缀或引号
2. 保留 SpaceX、Falcon 9、Starship、Starlink、NASA、ISS 等专有名词、机构缩写与火箭/飞船型号原文
3. 术语准确：booster=助推器，static fire=静态点火，splashdown=溅落，payload=载荷，flyback=返场
4. 语气自然流畅，符合中文航天报道习惯`

let _aiDeadline = 0

/**
 * 每次云函数调用开始时重置混元预算，须在 exports.main 里调用。
 * 没调用时预算为 0 → 混元整段跳过、退回纯 TMT 行为，
 * 也就是说漏接线只会退化成旧逻辑，不会把同步拖到超时。
 */
function beginTranslateRun(budgetMs) {
  _aiDeadline = Date.now() + (budgetMs > 0 ? budgetMs : AI_RUN_BUDGET_MS)
}

function aiBudgetLeftMs() {
  return _aiDeadline ? Math.max(0, _aiDeadline - Date.now()) : 0
}

/** 云函数端 AI 入口：新版 cloud.ai()，旧版 cloud.extend.AI（需 wx-server-sdk >= 3.0.5-beta.1） */
function getAIEntry() {
  try {
    if (typeof cloud.ai === 'function') {
      const inst = cloud.ai()
      if (inst && typeof inst.createModel === 'function') return inst
    }
  } catch (e) {}
  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    return cloud.extend.AI
  }
  return null
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

function cleanAITranslation(s) {
  let out = String(s || '').trim()
  out = out.replace(/^(译文|翻译|中文译文)[:：]\s*/, '')
  const wrapped =
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith('\u201c') && out.endsWith('\u201d')) ||
    (out.startsWith('「') && out.endsWith('」'))
  if (wrapped) out = out.slice(1, -1).trim()
  return out
}

function isTmtPermanentError(err) {
  const msg = String((err && err.message) || err || '')
  return /FreeAmountUsedUp|AmountUsedUp|free amount|额度|配额|Unauthorized|AuthFailure|InvalidParameterValue|UnsupportedOperation/i.test(msg)
}

async function mapPool(items, concurrency, mapper) {
  const out = new Array(items.length)
  let next = 0
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const workers = []
  for (let w = 0; w < limit; w++) {
    workers.push((async function () {
      while (next < items.length) {
        const i = next++
        out[i] = await mapper(items[i], i)
      }
    })())
  }
  await Promise.all(workers)
  return out
}

/** 混元翻译单个片段；失败返回空串 */
async function translateViaAIChunk(text) {
  const src = String(text || '')
  if (!src.trim()) return ''
  const AI = getAIEntry()
  if (!AI) return ''

  const providers = [
    { provider: 'cloudbase', model: 'hy3-preview' },
    { provider: 'hunyuan-v3', model: 'hy3-preview' },
    { provider: 'hunyuan-open', model: 'hunyuan-lite' }
  ]
  const maxTokens = Math.min(2048, Math.max(400, Math.ceil(src.length * 1.2)))
  const timeoutMs = Math.min(12000, 8000 + Math.ceil(src.length * 4))
  const messages = [
    { role: 'system', content: AI_TRANSLATE_SYSTEM_PROMPT },
    { role: 'user', content: src }
  ]

  for (const p of providers) {
    try {
      const model = AI.createModel(p.provider)
      const res = await Promise.race([
        model.generateText({
          model: p.model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI 翻译超时')), timeoutMs))
      ])
      const cleaned = cleanAITranslation(extractLLMText(res))
      if (cleaned && looksLikelyChinese(cleaned)) return cleaned
    } catch (e) {
      console.warn(`[translate] generateText 失败 (${p.provider}/${p.model}):`, e.message || e)
    }

    try {
      const model = AI.createModel(p.provider)
      if (typeof model.streamText !== 'function') continue
      const streamRes = await Promise.race([
        model.streamText({
          data: {
            model: p.model,
            messages,
            temperature: 0.2,
            max_tokens: maxTokens
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI stream 超时')), timeoutMs))
      ])
      const cleaned = cleanAITranslation(await collectTextStream(streamRes && streamRes.textStream))
      if (cleaned && looksLikelyChinese(cleaned)) return cleaned
    } catch (e) {
      console.warn(`[translate] streamText 失败 (${p.provider}/${p.model}):`, e.message || e)
    }
  }
  return ''
}

/** 混元翻译单条（超长按句段切开后合并；任一段失败则整条空） */
async function translateViaAI(text) {
  const src = String(text || '')
  if (!src.trim()) return ''
  const parts = splitLongText(src, AI_TRANSLATE_CHUNK_CHARS)
  if (!parts.length) return ''
  if (parts.length === 1) return translateViaAIChunk(parts[0])

  const zhParts = await mapPool(parts, AI_TRANSLATE_CONCURRENCY, async (part) => translateViaAIChunk(part))
  if (!zhParts.every(Boolean)) return ''
  return zhParts.join('')
}

/**
 * 对未命中缓存的条目走混元；成功则写入 results / cache，返回仍需 TMT 的项。
 * 预算耗尽后剩余条目原样退回，由 TMT 或下一轮同步接手。
 */
async function translatePendingViaAI(toMachine, hashToIndices, results) {
  if (!toMachine.length) return { remaining: [], aiHit: 0, aiBudgetOut: false }
  if (!getAIEntry()) {
    console.warn('[translate] 云开发 AI 不可用，跳过混元主通道（确认 wx-server-sdk >= 3.0.5-beta.1）')
    return { remaining: toMachine, aiHit: 0, aiBudgetOut: false }
  }
  if (aiBudgetLeftMs() <= 0) {
    return { remaining: toMachine, aiHit: 0, aiBudgetOut: true }
  }

  const cacheWrites = []
  const remaining = []
  let aiHit = 0
  let aiBudgetOut = false

  await mapPool(toMachine, AI_TRANSLATE_CONCURRENCY, async (item) => {
    if (aiBudgetLeftMs() < AI_MIN_SLICE_MS) {
      aiBudgetOut = true
      remaining.push(item)
      return
    }
    const zh = await translateViaAI(item.raw)
    if (zh && looksLikelyChinese(zh)) {
      aiHit++
      for (const idx of hashToIndices[item.hash]) {
        results[idx] = zh
      }
      if (zh !== item.raw) {
        cacheWrites.push({ hash: item.hash, zh, sourceLen: item.raw.length })
      }
    } else {
      remaining.push(item)
    }
  })

  await writeCacheBatch(cacheWrites)
  if (aiBudgetOut) {
    console.warn(`[translate] 混元预算用尽，${remaining.length} 条留给 TMT / 下一轮同步`)
  }
  console.log(`[translate] 混元命中 ${aiHit}/${toMachine.length}`)
  return { remaining, aiHit, aiBudgetOut }
}

/**
 * 批量翻译英文文本 → 中文（词典预处理 + 缓存 + 混元 + TMT 兜底）
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
async function translateTextsBatch(texts) {
  const inputs = (texts || []).map((t) => String(t || '').trim())
  const results = new Array(inputs.length).fill('')
  const pending = []

  for (let i = 0; i < inputs.length; i++) {
    const raw = inputs[i]
    if (!raw) continue
    if (!shouldMachineTranslate(raw)) {
      results[i] = applyPhraseRules(raw) || raw
      continue
    }
    const hash = hashText(raw)
    pending.push({ index: i, raw, hash })
  }

  if (!pending.length) return results

  const cacheMap = await readCacheBatch(pending.map((p) => p.hash))
  // 同一文本（如发射台名）在一次同步里出现几十次：按 hash 去重，只机翻一次
  const hashToIndices = {}
  const toMachine = []

  for (const item of pending) {
    if (cacheMap[item.hash]) {
      results[item.index] = cacheMap[item.hash]
      continue
    }
    if (hashToIndices[item.hash]) {
      hashToIndices[item.hash].push(item.index)
    } else {
      hashToIndices[item.hash] = [item.index]
      toMachine.push(item)
    }
  }

  // 主通道：混元 AI（不依赖 TMT 额度）；未覆盖的才落 TMT
  const aiOut = await translatePendingViaAI(toMachine, hashToIndices, results)
  const toTmt = aiOut.remaining
  if (!toTmt.length) return results

  if (!isTmtConfigured()) {
    warnTmtUnconfiguredOnce()
    return results
  }

  // 按累计字符数切批（TMT 批量接口有总量上限）；单条超长先按句段切开再入批
  const units = []
  for (const item of toTmt) {
    const parts = splitLongText(item.raw, ITEM_MAX_CHARS)
    if (!parts.length) continue
    if (parts.length === 1) {
      units.push({ hash: item.hash, raw: parts[0], groupKey: item.hash, partIndex: 0, partCount: 1 })
    } else {
      for (let pi = 0; pi < parts.length; pi++) {
        units.push({
          hash: item.hash,
          raw: parts[pi],
          groupKey: item.hash,
          partIndex: pi,
          partCount: parts.length
        })
      }
    }
  }

  const batches = []
  let current = []
  let currentChars = 0
  for (const unit of units) {
    const len = unit.raw.length
    if (current.length > 0 && (currentChars + len > BATCH_MAX_CHARS || current.length >= BATCH_MAX_ITEMS)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(unit)
    currentChars += len
  }
  if (current.length > 0) batches.push(current)

  const segmentParts = {}

  let batchIndex = 0
  let tmtQuotaExhausted = false
  for (const batch of batches) {
    // 额度已用尽：剩余批次直接留空，否则几百批每批还要重试 + sleep，白烧同步时间
    if (tmtQuotaExhausted) {
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]
        if (!segmentParts[item.groupKey]) {
          segmentParts[item.groupKey] = new Array(item.partCount).fill('')
        }
        segmentParts[item.groupKey][item.partIndex] = ''
      }
      continue
    }

    // TMT 免费档限频 5 QPS：多批之间加间隔，避免连环触发 RequestLimitExceeded
    if (batchIndex > 0) await new Promise((r) => setTimeout(r, 250))
    batchIndex++

    const protectedList = batch.map((item) => protectTerms(applyPhraseRules(item.raw)))
    const sourceList = protectedList.map((p) => p.text)

    let translated = []
    let lastErr = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        translated = await tmtTranslateBatch(sourceList)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        translated = sourceList.map(() => '')
        // 额度用尽等永久错误：不重试、后续批次直接跳过
        if (isTmtPermanentError(e)) {
          tmtQuotaExhausted = /FreeAmountUsedUp|AmountUsedUp|free amount|额度|配额/i.test(String(e.message || e))
          break
        }
        // 限频/瞬时网络错误等 500ms 重试一次
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    if (lastErr) {
      console.error('[translate] TMT batch failed after retry:', lastErr.message || lastErr)
    }

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]
      const prot = protectedList[j]
      let zh = translated[j] || ''
      if (zh) zh = restoreTerms(zh, prot.placeholders)
      // TMT 失败/未配置时不降级伪造译文：宁可留空（展示原文），也不写中英夹杂
      if (zh && !looksLikelyChinese(zh)) zh = ''
      if (!segmentParts[item.groupKey]) {
        segmentParts[item.groupKey] = new Array(item.partCount).fill('')
      }
      segmentParts[item.groupKey][item.partIndex] = zh || ''
    }
  }

  const cacheWrites = []
  for (const item of toTmt) {
    const parts = segmentParts[item.hash]
    if (!parts || !parts.length || !parts.every(Boolean)) continue
    const zh = parts.join('')
    if (!zh || !looksLikelyChinese(zh)) continue
    for (const idx of hashToIndices[item.hash]) {
      results[idx] = zh
    }
    if (isTmtConfigured() && zh !== item.raw) {
      cacheWrites.push({ hash: item.hash, zh, sourceLen: item.raw.length })
    }
  }
  await writeCacheBatch(cacheWrites)

  return results
}

/**
 * 诊断：混元主通道 + TMT 兜底 + 缓存。
 * aiEntry 为空 = wx-server-sdk 太旧（cloud.ai 需要 >= 3.0.5-beta.1），
 * 同步就只剩 TMT，额度用尽后新数据不再产出 xxxZh 预翻译。
 */
async function runTranslateDiag() {
  const out = {
    sdkVersion: '',
    aiEntry: '',
    aiResult: '',
    aiError: '',
    tmtConfigured: isTmtConfigured(),
    testSource: 'The rocket lifted off from the launch pad.',
    testResult: '',
    tmtError: '',
    cacheCount: -1
  }

  try {
    out.sdkVersion = require('wx-server-sdk/package.json').version || ''
  } catch (e) {}

  if (typeof cloud.ai === 'function') {
    try {
      const inst = cloud.ai()
      if (inst && typeof inst.createModel === 'function') out.aiEntry = 'cloud.ai'
    } catch (e) {}
  }
  if (!out.aiEntry && cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    out.aiEntry = 'cloud.extend.AI'
  }
  if (out.aiEntry) {
    try {
      out.aiResult = await translateViaAI(out.testSource)
      if (!out.aiResult) out.aiError = '混元入口可用但未产出译文'
    } catch (e) {
      out.aiError = e.message || String(e)
    }
  } else {
    out.aiError = '云开发 AI 入口不存在，请确认 wx-server-sdk >= 3.0.5-beta.1 且已云端安装依赖'
  }

  if (out.tmtConfigured) {
    try {
      const list = await tmtTranslateBatch([out.testSource])
      out.testResult = (list && list[0]) || ''
    } catch (e) {
      out.tmtError = e.message || String(e)
    }
  }

  const db = getDb()
  if (db) {
    try {
      const res = await db.collection(CACHE_COLLECTION).count()
      out.cacheCount = (res && res.total) != null ? res.total : -1
    } catch (e) {
      out.cacheCount = -1
      if (!out.tmtError) out.tmtError = 'translation_cache 计数失败: ' + (e.message || String(e))
    }
  }

  return out
}

/** 清洗 translation_cache 中的伪中文条目（TMT 降级 bug 的历史遗留） */
async function cleanTranslationCache() {
  const db = getDb()
  if (!db) return { success: false, error: 'no db' }

  const badIds = []
  let scanned = 0
  const PAGE = 100
  for (let skip = 0; skip < 10000; skip += PAGE) {
    let rows = []
    try {
      const res = await db.collection(CACHE_COLLECTION).skip(skip).limit(PAGE).get()
      rows = res.data || []
    } catch (e) {
      break
    }
    if (!rows.length) break
    scanned += rows.length
    for (const doc of rows) {
      if (!doc.zh || !looksLikelyChinese(doc.zh)) badIds.push(doc._id)
    }
    if (rows.length < PAGE) break
  }

  let removed = 0
  for (const id of badIds) {
    try {
      await db.collection(CACHE_COLLECTION).doc(id).remove()
      removed++
    } catch (e) {}
  }
  return { success: true, scanned, removed }
}

module.exports = {
  translateTextsBatch,
  beginTranslateRun,
  hashText,
  isTmtConfigured,
  looksLikelyChinese,
  runTranslateDiag,
  cleanTranslationCache
}
