/**
 * 云端 syncSpaceDevsData/translate.js 混元主通道审计（mock 环境，不打真实 API）
 *
 * 同步管线和 ll2Query 的区别在于「离线批量」：一轮可能翻几百条，混元比 TMT 慢一个
 * 量级，所以这里额外校验时间预算的三种边界——没接线（预算 0）、预算耗尽、预算充足。
 * 预算缺省为 0 是刻意设计：忘了在 exports.main 里 beginTranslateRun，
 * 结果只是退回旧的纯 TMT 行为，而不是把 800s 的同步拖到超时。
 *
 * 用法：node scripts/_audit_sync_translate_hunyuan.js
 */
const path = require('path')
const fs = require('fs')
const Module = require('module')
const https = require('https')

const ROOT = path.join(__dirname, '..')
const TRANSLATE_PATH = path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/translate.js')
const INDEX_PATH = path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/index.js')
const PKG_PATH = path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/package.json')

const stats = { aiGenerate: 0, aiStream: 0, tmtHttps: 0, dbWrite: 0 }
let aiMode = 'ok' // ok | empty | throw | unavailable
let tmtMode = 'ok' // ok | free-amount | transient
let aiDelayMs = 0

function resetStats() {
  stats.aiGenerate = 0
  stats.aiStream = 0
  stats.tmtHttps = 0
  stats.dbWrite = 0
}

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
            return { limit() { return { async get() { return { data: [] } } } } }
          },
          async add() { stats.dbWrite++; return { _id: 'x' } },
          doc() { return { async update() { stats.dbWrite++; return {} } } }
        }
      }
    }
  },
  extend: {
    AI: {
      createModel() {
        if (aiMode === 'unavailable') throw new Error('AI unavailable')
        return {
          async generateText() {
            stats.aiGenerate++
            if (aiDelayMs) await new Promise((r) => setTimeout(r, aiDelayMs))
            if (aiMode === 'throw') throw new Error('AI boom')
            if (aiMode === 'empty') return { choices: [{ message: { content: '' } }] }
            return { choices: [{ message: { content: '这是合格的中文航天译文，覆盖助推器与静态点火术语。' } }] }
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

const sdkPath = '\u0000mock-wx-server-sdk-sync'
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'wx-server-sdk') return sdkPath
  return realResolve.call(this, request, parent, isMain, options)
}
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: mockCloud }

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
    write(payload) {
      try {
        const json = JSON.parse(String(payload || '{}'))
        req._n = Array.isArray(json.SourceTextList) ? json.SourceTextList.length : 1
      } catch (e) { req._n = 1 }
    },
    end() {
      setImmediate(() => {
        if (typeof cb === 'function') cb(res)
        if (tmtMode === 'free-amount') {
          listeners.data.forEach((fn) => fn(JSON.stringify({
            Response: {
              Error: {
                Code: 'FailedOperation.FreeAmountUsedUp',
                Message: 'service free amount of this month has been used up'
              }
            }
          })))
          listeners.end.forEach((fn) => fn())
          return
        }
        if (tmtMode === 'transient') {
          listeners.error.forEach((fn) => fn(new Error('ECONNRESET')))
          return
        }
        const list = Array.from({ length: Math.max(1, Number(req._n) || 1) }, () => '腾讯云机翻中文译文用于兜底验证。')
        listeners.data.forEach((fn) => fn(JSON.stringify({ Response: { TargetTextList: list } })))
        listeners.end.forEach((fn) => fn())
      })
    },
    destroy() {}
  }
  return req
}

process.env.TMT_SECRET_ID = 'audit-test-id'
process.env.TMT_SECRET_KEY = 'audit-test-key'

delete require.cache[TRANSLATE_PATH]
const { translateTextsBatch, beginTranslateRun, looksLikelyChinese } = require(TRANSLATE_PATH)

const failures = []
let passCount = 0
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS ' + name) }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')) }
}

const en = (i) => 'The Falcon 9 booster number ' + i + ' completed a static fire and landed on the drone ship.'

async function main() {
  console.log('\n== 静态契约 ==')
  const src = fs.readFileSync(TRANSLATE_PATH, 'utf8')
  const indexSrc = fs.readFileSync(INDEX_PATH, 'utf8')
  check('含 getAIEntry', /function getAIEntry\(/.test(src))
  check('含 translatePendingViaAI', /translatePendingViaAI/.test(src))
  check('混元在 TMT 之前', src.indexOf('translatePendingViaAI(toMachine') < src.indexOf('const batches = []'))
  check('含时间预算 beginTranslateRun', /function beginTranslateRun\(/.test(src))
  check('预算缺省为 0（未接线则退回纯 TMT）', /let _aiDeadline = 0/.test(src))
  check('index.js 已接线 beginTranslateRun', /beginTranslateRun\(\)/.test(indexSrc))
  check('额度用尽熔断', /tmtQuotaExhausted/.test(src) && /isTmtPermanentError/.test(src))
  check('AI 段上限 1200', /AI_TRANSLATE_CHUNK_CHARS = 1200/.test(src))
  check('模型 hy3-preview', /hy3-preview/.test(src))
  check('looksLikelyChinese 已剥离专名', /protectTerms\(s\)\.text/.test(src))
  let pkgVer = ''
  try { pkgVer = (JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).dependencies || {})['wx-server-sdk'] || '' } catch (e) {}
  check('wx-server-sdk >= 3.0.5', /(\d+)\.(\d+)\.(\d+)/.test(pkgVer) && Number(RegExp.$1) >= 3, 'ver=' + pkgVer)

  console.log('\n== 运行时：时间预算三种边界 ==')
  // S1 必须最先跑：模块级 _aiDeadline 初始为 0，模拟「忘了接线」
  resetStats(); aiMode = 'ok'; tmtMode = 'ok'
  let out = await translateTextsBatch([en(1), en(2)])
  check('S1 未接线时不调混元', stats.aiGenerate === 0 && stats.aiStream === 0, 'ai=' + stats.aiGenerate)
  check('S1 退回 TMT 且有译文', stats.tmtHttps >= 1 && out.every(Boolean), 'tmt=' + stats.tmtHttps)

  resetStats()
  beginTranslateRun(1) // 1ms 预算，进入 translatePendingViaAI 时已耗尽
  await new Promise((r) => setTimeout(r, 10))
  out = await translateTextsBatch([en(3), en(4)])
  check('S2 预算耗尽不调混元', stats.aiGenerate === 0, 'ai=' + stats.aiGenerate)
  check('S2 预算耗尽仍走 TMT 出译文', out.every(Boolean))

  resetStats()
  beginTranslateRun()
  out = await translateTextsBatch([en(5), en(6), en(7)])
  check('S3 预算充足走混元', stats.aiGenerate >= 3, 'ai=' + stats.aiGenerate)
  check('S3 混元命中后不调 TMT', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)
  check('S3 三条都有中文译文', out.length === 3 && out.every((s) => looksLikelyChinese(s)))
  check('S3 译文写入缓存', stats.dbWrite >= 3, 'dbWrite=' + stats.dbWrite)

  console.log('\n== 运行时：降级链路 ==')
  resetStats(); aiMode = 'unavailable'; beginTranslateRun()
  out = await translateTextsBatch([en(8)])
  check('S4 混元不可用降级 TMT', stats.tmtHttps >= 1 && out.every(Boolean))

  resetStats(); aiMode = 'empty'; beginTranslateRun()
  out = await translateTextsBatch([en(9)])
  check('S5 混元空结果降级 TMT', stats.aiGenerate >= 1 && stats.tmtHttps >= 1 && out.every(Boolean))

  // 混元可用 + TMT 额度用尽：这正是当前线上状态，必须仍能产出预翻译
  resetStats(); aiMode = 'ok'; tmtMode = 'free-amount'; beginTranslateRun()
  out = await translateTextsBatch([en(10), en(11)])
  check('S6 额度用尽但混元覆盖，仍有译文', out.every((s) => looksLikelyChinese(s)))
  check('S6 完全不碰 TMT', stats.tmtHttps === 0, 'tmt=' + stats.tmtHttps)

  // 双挂：混元空 + TMT 额度用尽 → 留空展示原文，且 TMT 不连环重试
  resetStats(); aiMode = 'empty'; tmtMode = 'free-amount'; beginTranslateRun()
  const many = Array.from({ length: 40 }, (_, i) => en(100 + i))
  out = await translateTextsBatch(many)
  check('S7 双挂时留空不伪造译文', out.every((s) => !s))
  check('S7 额度用尽后不再连环打 TMT', stats.tmtHttps <= 2, 'tmt=' + stats.tmtHttps)

  console.log('\n== 译文校验 ==')
  aiMode = 'ok'; tmtMode = 'ok'
  check('保留专名的译文判定为中文', looksLikelyChinese('SpaceX 的 Falcon 9 从 SLC-40 发射'))
  check('纯英文判定为非中文', !looksLikelyChinese('The rocket lifted off from the launch pad.'))

  console.log('\n==== 结果: ' + passCount + ' PASS, ' + failures.length + ' FAIL ====')
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

main().catch((e) => {
  console.error('脚本失败:', e.stack || e.message)
  process.exit(1)
})
