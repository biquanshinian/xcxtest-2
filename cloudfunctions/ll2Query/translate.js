/**
 * 腾讯云机器翻译 TMT + translation_cache 缓存
 * 环境变量: TMT_SECRET_ID, TMT_SECRET_KEY (未配置时跳过机翻，仅走术语词典)
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
// TextTranslateBatch 源文本总量上限约 6000 字节，按累计字符数切批留出余量
const BATCH_MAX_CHARS = 4500
const BATCH_MAX_ITEMS = 16
const CACHE_COLLECTION = 'translation_cache'

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

/**
 * 批量翻译英文文本 → 中文（词典预处理 + 缓存 + TMT）
 * @param {string[]} texts
 * @param {Object} [options]
 *   - skipTmt: 只走词典 + translation_cache，未命中项留空不调 TMT
 *     （客户端"混元优先"链路用：先免费查缓存，miss 再走大模型，失败才回 TMT）
 * @returns {Promise<string[]>}
 */
async function translateTextsBatch(texts, options) {
  const skipTmt = !!(options && options.skipTmt)
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

  if (!pending.length) {
    if (options && options.withMeta) {
      return {
        list: results,
        tmtConfigured: isTmtConfigured(),
        tmtNeeded: 0,
        tmtLastError: '',
        tmtBatchesFailed: 0
      }
    }
    return results
  }

  const cacheMap = await readCacheBatch(pending.map((p) => p.hash))
  // 同一文本（如发射台名）在一次同步里出现几十次：按 hash 去重，只机翻一次
  const hashToIndices = {}
  const toTmt = []

  for (const item of pending) {
    if (cacheMap[item.hash]) {
      results[item.index] = cacheMap[item.hash]
      continue
    }
    if (hashToIndices[item.hash]) {
      hashToIndices[item.hash].push(item.index)
    } else {
      hashToIndices[item.hash] = [item.index]
      toTmt.push(item)
    }
  }

  if (skipTmt) {
    if (options && options.withMeta) {
      return {
        list: results,
        tmtConfigured: isTmtConfigured(),
        tmtNeeded: 0,
        tmtLastError: '',
        tmtBatchesFailed: 0
      }
    }
    return results
  }

  if (!isTmtConfigured() && toTmt.length > 0) {
    warnTmtUnconfiguredOnce()
    if (options && options.withMeta) {
      return {
        list: results,
        tmtConfigured: false,
        tmtNeeded: toTmt.length,
        tmtLastError: 'TMT_SECRET_ID/KEY 未配置',
        tmtBatchesFailed: 0
      }
    }
    return results
  }

  // 按累计字符数切批（TMT 批量接口有总量上限）；单条超长的独立成批
  const batches = []
  let current = []
  let currentChars = 0
  for (const item of toTmt) {
    const len = item.raw.length
    if (current.length > 0 && (currentChars + len > BATCH_MAX_CHARS || current.length >= BATCH_MAX_ITEMS)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += len
  }
  if (current.length > 0) batches.push(current)

  let batchIndex = 0
  let tmtLastError = null
  let tmtBatchesFailed = 0
  for (const batch of batches) {
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
        // 限频/瞬时网络错误等 500ms 重试一次
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    if (lastErr) {
      tmtBatchesFailed++
      tmtLastError = lastErr
      console.error('[translate] TMT batch failed after retry:', lastErr.message || lastErr)
    }

    const cacheWrites = []
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]
      const prot = protectedList[j]
      let zh = translated[j] || ''
      if (zh) zh = restoreTerms(zh, prot.placeholders)
      // TMT 失败/未配置时不降级伪造译文：宁可留空（展示原文），也不写中英夹杂
      if (zh && !looksLikelyChinese(zh)) zh = ''
      if (!zh) continue
      for (const idx of hashToIndices[item.hash]) {
        results[idx] = zh
      }
      if (isTmtConfigured() && zh !== item.raw) {
        cacheWrites.push({ hash: item.hash, zh, sourceLen: item.raw.length })
      }
    }
    await writeCacheBatch(cacheWrites)
  }

  if (options && options.withMeta) {
    return {
      list: results,
      tmtConfigured: isTmtConfigured(),
      tmtNeeded: toTmt.length,
      tmtLastError: tmtLastError ? String(tmtLastError.message || tmtLastError) : '',
      tmtBatchesFailed
    }
  }
  return results
}

/** 诊断：TMT 配置状态 + 实测一句翻译 + 翻译缓存文档数 */
async function runTranslateDiag() {
  const out = {
    tmtConfigured: isTmtConfigured(),
    testSource: 'The rocket lifted off from the launch pad.',
    testResult: '',
    tmtError: '',
    cacheCount: -1
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
  hashText,
  isTmtConfigured,
  looksLikelyChinese,
  runTranslateDiag,
  cleanTranslationCache
}
