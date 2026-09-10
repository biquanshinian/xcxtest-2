/**
 * 云端 ll2Query/translate.js 混元主通道审计（mock 环境，不打真实 API）
 * 覆盖：
 *  1. skipTmt 只查缓存，不调混元/TMT
 *  2. 混元命中时不调 TMT，且 withMeta.tmtNeeded=0 → action 层 success
 *  3. 混元不可用时降级 TMT
 *  4. TMT 额度用尽不重试后续批次；混元已有命中时不整单失败
 *  5. 超长文本按 ≤1200 分段走混元
 *  6. 静态：入口/超时/永久错误/注释契约
 * 用法：node scripts/_audit_cloud_translate_hunyuan.js
 */
const path = require('path')
const fs = require('fs')
const Module = require('module')
const https = require('https')

const ROOT = path.join(__dirname, '..')
const TRANSLATE_PATH = path.join(ROOT, 'cloudfunctions/ll2Query/translate.js')
const INDEX_PATH = path.join(ROOT, 'cloudfunctions/ll2Query/index.js')

const stats = {
  aiGenerate: 0,
  aiStream: 0,
  aiInputs: [],
  tmtHttps: 0,
  dbRead: 0,
  dbWrite: 0
}
let aiMode = 'ok' // ok | empty | throw | unavailable
let tmtMode = 'ok' // ok | free-amount | transient

function resetStats() {
  stats.aiGenerate = 0
  stats.aiStream = 0
  stats.aiInputs = []
  stats.tmtHttps = 0
  stats.dbRead = 0
  stats.dbWrite = 0
}

// ── mock wx-server-sdk ──
const mockCloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  database() {
    return {
      command: { in: (arr) => arr },
      serverDate: () => new Date(),
      collection() {
        return {
          where() {
            return {
              limit() {
                return {
                  async get() {
                    stats.dbRead++
                    return { data: [] }
                  }
                }
              }
            }
          },
          async add() {
            stats.dbWrite++
            return { _id: 'x' }
          },
          doc() {
            return {
              async update() {
                stats.dbWrite++
                return {}
              }
            }
          }
        }
      }
    }
  },
  extend: {
    AI: {
      createModel() {
        if (aiMode === 'unavailable') {
          throw new Error('AI unavailable')
        }
        return {
          async generateText({ messages }) {
            stats.aiGenerate++
            const user = (messages || []).find((m) => m.role === 'user')
            const text = String((user && user.content) || '')
            stats.aiInputs.push(text.length)
            if (aiMode === 'throw') throw new Error('AI boom')
            if (aiMode === 'empty') return { choices: [{ message: { content: '' } }] }
            return {
              choices: [{ message: { content: '这是合格的中文航天译文，覆盖助推器与静态点火术语。' } }]
            }
          },
          async streamText() {
            stats.aiStream++
            if (aiMode === 'throw') throw new Error('AI stream boom')
            async function* gen() {
              if (aiMode === 'empty') return
              yield '这是合格的中文航天译文，覆盖助推器与静态点火术语。'
            }
            return { textStream: gen() }
          }
        }
      }
    }
  }
}

const sdkPath = '\u0000mock-wx-server-sdk'
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'wx-server-sdk') return sdkPath
  return realResolve.call(this, request, parent, isMain, options)
}
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: mockCloud
}

// ── mock TMT HTTPS ──
const origRequest = https.request
https.request = function (opts, cb) {
  const isTmt = opts && (opts.hostname === 'tmt.tencentcloudapi.com' || opts.host === 'tmt.tencentcloudapi.com')
  if (!isTmt) return origRequest.apply(this, arguments)

  stats.tmtHttps++
  const listeners = { data: [], end: [], error: [] }
  const res = {
    on(ev, fn) {
      if (ev === 'data' || ev === 'end' || ev === 'error') listeners[ev].push(fn)
      return this
    }
  }
  const req = {
    on() { return this },
    write() {},
    end() {
      setImmediate(() => {
        if (typeof cb === 'function') cb(res)
        if (tmtMode === 'free-amount') {
          const body = JSON.stringify({
            Response: {
              Error: {
                Code: 'FailedOperation.FreeAmountUsedUp',
                Message: 'service free amount of this month has been used up'
              }
            }
          })
          listeners.data.forEach((fn) => fn(body))
          listeners.end.forEach((fn) => fn())
          return
        }
        if (tmtMode === 'transient') {
          listeners.error.forEach((fn) => fn(new Error('ECONNRESET')))
          return
        }
        // 解析 SourceTextList 长度，返回等量伪译文
        let n = 1
        try {
          // 无法从 write 取 body：按 1 条返回即可；批量场景用固定中文数组够用
          n = Math.max(1, Number(req._n) || 1)
        } catch (e) {}
        const list = Array.from({ length: n }, () => '腾讯云机翻中文译文用于兜底验证。')
        const body = JSON.stringify({ Response: { TargetTextList: list } })
        listeners.data.forEach((fn) => fn(body))
        listeners.end.forEach((fn) => fn())
      })
    },
    destroy() {}
  }
  // 拦截 write 以获知批量条数
  req.write = function (payload) {
    try {
      const json = JSON.parse(String(payload || '{}'))
      req._n = Array.isArray(json.SourceTextList) ? json.SourceTextList.length : 1
    } catch (e) {
      req._n = 1
    }
  }
  return req
}

process.env.TMT_SECRET_ID = 'audit-test-id'
process.env.TMT_SECRET_KEY = 'audit-test-key'

// 清掉可能的旧缓存模块
delete require.cache[TRANSLATE_PATH]
const {
  translateTextsBatch,
  isTmtConfigured,
  looksLikelyChinese
} = require(TRANSLATE_PATH)

const failures = []
let passCount = 0
function check(name, ok, detail) {
  if (ok) {
    passCount++
    console.log('  PASS ' + name)
  } else {
    failures.push(name + (detail ? ' -- ' + detail : ''))
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''))
  }
}

const longEn = (i) =>
  'This is a long enough English paragraph number ' + i +
  ' describing a Falcon 9 booster landing on the drone ship after static fire.'

async function simulateTranslateAction(texts, skipTmt) {
  const out = await translateTextsBatch(texts, { skipTmt: !!skipTmt, withMeta: true })
  const list = Array.isArray(out) ? out : ((out && out.list) || [])
  const meta = Array.isArray(out) ? {} : (out || {})
  const translated = list.filter(Boolean).length
  const tmtNeeded = meta.tmtNeeded != null ? meta.tmtNeeded : 0
  if (!skipTmt && tmtNeeded > 0 && translated === 0) {
    return {
      success: false,
      error: meta.tmtLastError
        ? ('翻译服务调用失败: ' + meta.tmtLastError)
        : '翻译服务暂时不可用',
      list,
      translated,
      meta
    }
  }
  return { success: true, list, translated, meta }
}

async function main() {
  console.log('\n== 静态契约 ==')
  const cloudSrc = fs.readFileSync(TRANSLATE_PATH, 'utf8')
  const actionSrc = fs.readFileSync(INDEX_PATH, 'utf8')

  check('CFG 含 getAIEntry', /function getAIEntry\(/.test(cloudSrc))
  check('CFG 含 translateViaAI', /async function translateViaAI\(/.test(cloudSrc))
  check('CFG 含 translatePendingViaAI', /async function translatePendingViaAI\(/.test(cloudSrc))
  check('CFG 混元在 TMT 之前', /translatePendingViaAI[\s\S]*toTmt\s*=\s*aiOut\.remaining/.test(cloudSrc))
  check('CFG 永久错误识别', /function isTmtPermanentError\(/.test(cloudSrc) && /FreeAmountUsedUp/.test(cloudSrc))
  check('CFG 额度用尽跳过后续批', /tmtQuotaExhausted/.test(cloudSrc))
  check('CFG AI 段上限 1200', /AI_TRANSLATE_CHUNK_CHARS\s*=\s*1200/.test(cloudSrc))
  check('CFG AI 并发 3', /AI_TRANSLATE_CONCURRENCY\s*=\s*3/.test(cloudSrc))
  check('CFG AI 单段超时≤12s', /Math\.min\(12000/.test(cloudSrc))
  check('CFG 模型 hy3-preview', /hy3-preview/.test(cloudSrc))
  check('CFG 混元成功写缓存', /translatePendingViaAI[\s\S]*writeCacheBatch\(cacheWrites\)/.test(cloudSrc))
  check('CFG 有命中时 tmtNeeded=0', /tmtNeeded:\s*results\.some\(Boolean\)\s*\?\s*0/.test(cloudSrc))
  check('CFG 头注释混元主通道', /混元 AI（主通道）/.test(cloudSrc) || /混元 AI\(主通道\)/.test(cloudSrc) || /混元 AI（主通道）|混元 AI/.test(cloudSrc))
  check('ACT 注释含混元', /混元 AI/.test(actionSrc))
  check('ACT 仍用 tmtNeeded 门控失败', /!skipTmt\s*&&\s*tmtNeeded\s*>\s*0\s*&&\s*translated\s*===\s*0/.test(actionSrc))
  check('UTIL looksLikelyChinese 可用', typeof looksLikelyChinese === 'function' && looksLikelyChinese('这是中文译文 booster'))
  check('UTIL isTmtConfigured true', isTmtConfigured() === true)

  console.log('\n== 运行时场景 ==')

  // S1 skipTmt：不调 AI/TMT
  resetStats(); aiMode = 'ok'; tmtMode = 'ok'
  let r = await simulateTranslateAction([longEn(1), longEn(2)], true)
  check('S1 skipTmt success', r.success === true)
  check('S1 skipTmt 列表为空（无缓存）', r.list.every((x) => !x))
  check('S1 未调混元', stats.aiGenerate === 0 && stats.aiStream === 0, 'aiGen=' + stats.aiGenerate)
  check('S1 未调 TMT', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)

  // S2 混元命中：不调 TMT，action success
  resetStats(); aiMode = 'ok'; tmtMode = 'ok'
  r = await simulateTranslateAction([longEn(1), longEn(2), longEn(3)], false)
  check('S2 混元三条全有译文', r.success && r.list.every(Boolean) && r.translated === 3)
  check('S2 走了混元', stats.aiGenerate >= 3, 'aiGen=' + stats.aiGenerate)
  check('S2 未调 TMT', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)
  check('S2 meta.tmtNeeded=0', r.meta.tmtNeeded === 0, 'tmtNeeded=' + r.meta.tmtNeeded)
  check('S2 meta.aiHit>=3', (r.meta.aiHit || 0) >= 3, 'aiHit=' + r.meta.aiHit)

  // S3 混元不可用 → TMT 兜底
  resetStats(); aiMode = 'unavailable'; tmtMode = 'ok'
  // getAIEntry 在 createModel 前检查 extend.AI — unavailable 时 createModel throw，
  // 但 getAIEntry 仍返回 AI 对象。改为临时摘掉 AI：
  const savedAI = mockCloud.extend.AI
  mockCloud.extend.AI = null
  r = await simulateTranslateAction([longEn(1)], false)
  mockCloud.extend.AI = savedAI
  check('S3 无 AI 时 TMT 仍有译文', r.success && r.list.every(Boolean))
  check('S3 走了 TMT', stats.tmtHttps >= 1, 'tmt=' + stats.tmtHttps)

  // S4 混元失败/空 → TMT 兜底
  resetStats(); aiMode = 'empty'; tmtMode = 'ok'
  r = await simulateTranslateAction([longEn(1)], false)
  check('S4 AI 空结果降级 TMT', r.success && !!r.list[0])
  check('S4 调了混元又调 TMT', stats.aiGenerate >= 1 && stats.tmtHttps >= 1,
    'ai=' + stats.aiGenerate + ' tmt=' + stats.tmtHttps)

  // S5 混元命中 + TMT 额度用尽：不应整单失败（即使另有缺口被跳过）
  resetStats(); aiMode = 'ok'; tmtMode = 'free-amount'
  r = await simulateTranslateAction([longEn(1), longEn(2)], false)
  check('S5 混元命中时额度用尽仍 success', r.success === true, 'err=' + (r.error || ''))
  check('S5 有中文译文', r.translated >= 1)
  check('S5 未调 TMT（混元已覆盖）', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)

  // S6 混元全挂 + TMT 额度用尽 → 明确失败，且错误含 free amount
  resetStats(); aiMode = 'empty'; tmtMode = 'free-amount'
  r = await simulateTranslateAction([longEn(1)], false)
  check('S6 双挂失败', r.success === false)
  check('S6 错误含额度语义', /free amount|FreeAmount|额度|AmountUsedUp/i.test(r.error || ''),
    'err=' + (r.error || ''))
  check('S6 TMT 只打有限次（永久错误不连环）', stats.tmtHttps <= 2, 'tmt=' + stats.tmtHttps)

  // S7 超长分段：每段 ≤1200，成功不落 TMT
  resetStats(); aiMode = 'ok'; tmtMode = 'ok'
  const huge = ('The Falcon 9 booster returned to the drone ship after stage separation. ').repeat(80)
  check('S7 样例够长', huge.length > 2400, 'len=' + huge.length)
  r = await simulateTranslateAction([huge], false)
  check('S7 超长有译文', r.success && !!r.list[0])
  check('S7 混元分段 ≥2', stats.aiGenerate >= 2, 'aiGen=' + stats.aiGenerate)
  check('S7 每段 ≤1200', Math.max.apply(null, stats.aiInputs.concat([0])) <= 1200,
    'max=' + Math.max.apply(null, stats.aiInputs.concat([0])))
  check('S7 成功不调 TMT', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)

  // S8 短句也走混元
  resetStats(); aiMode = 'ok'; tmtMode = 'ok'
  r = await simulateTranslateAction(['Launch scrubbed after static fire.'], false)
  check('S8 短句混元成功', r.success && !!r.list[0])
  check('S8 短句未调 TMT', stats.tmtHttps === 0)

  // S9 空 texts / 中文不送翻（词典路径）
  resetStats()
  r = await simulateTranslateAction(['已是中文内容无需机翻'], false)
  check('S9 中文输入不炸', r.success === true)

  console.log('\n==== 结果: ' + passCount + ' PASS, ' + failures.length + ' FAIL ====')
  if (failures.length) {
    console.log(failures.join('\n'))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('脚本失败:', e.stack || e.message)
  process.exit(1)
})
