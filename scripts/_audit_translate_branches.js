/**
 * 回归校验（mock wx 环境）：
 * 1. translateTextsSmart：≤6 条长文本走 AI；>6 条整体降级 TMT；短文本不进 AI
 * 2. runTranslate（_applyTranslation）：瞬时错误重试一次；永久错误（密钥/额度）不重试
 * 用法：node scripts/_audit_translate_branches.js
 */
const path = require('path')
const Module = require('module')

const calls = { cloudLookup: 0, cloudTmt: 0, ai: 0 }
let aiAvailable = true
let tmtBehavior = 'ok' // ok | empty | reject-permanent | reject-transient
let tmtRejectCount = 0

global.wx = {
  cloud: {
    callFunction(opts) {
      const skip = opts.data && opts.data.skipTmt
      const texts = (opts.data && opts.data.texts) || []
      if (skip) {
        calls.cloudLookup++
        setTimeout(() => opts.success({ result: { success: true, list: texts.map(() => '') } }), 0)
        return
      }
      calls.cloudTmt++
      setTimeout(() => {
        if (tmtBehavior === 'ok') {
          opts.success({ result: { success: true, list: texts.map((t) => 'TMT译文:' + t.slice(0, 8)) } })
        } else if (tmtBehavior === 'empty') {
          opts.success({ result: { success: true, list: texts.map(() => '') } })
        } else if (tmtBehavior === 'reject-permanent') {
          tmtRejectCount++
          opts.success({ result: { success: false, error: '翻译服务调用失败: FailedOperation.FreeAmountUsedUp 额度已用完' } })
        } else {
          tmtRejectCount++
          opts.success({ result: { success: false, error: '翻译服务返回为空' } })
        }
      }, 0)
    }
  },
  showToast() {},
  vibrateShort() {}
}

// 拦截依赖：aiService（受控 mock）与 membership（门控直接放行）
const realResolve = Module._resolveFilename
const mockAiPath = '\u0000mock-aiService'
const mockMemberPath = '\u0000mock-membership'
Module._resolveFilename = function (request, ...rest) {
  if (/aiService\.js$/.test(request)) return mockAiPath
  if (/membership\.js$/.test(request)) return mockMemberPath
  return realResolve.call(this, request, ...rest)
}
require.cache[mockAiPath] = {
  id: mockAiPath, filename: mockAiPath, loaded: true,
  exports: {
    isAIAvailable: () => aiAvailable,
    generateTextAdvanced: async (sys, text) => { calls.ai++; return '这是一段合格的中文译文，用于验证混元通道命中。' }
  }
}
require.cache[mockMemberPath] = {
  id: mockMemberPath, filename: mockMemberPath, loaded: true,
  exports: { gateCheck: () => Promise.resolve(true) }
}

const tt = require(path.join(__dirname, '../utils/text-translate.js'))

const failures = []
let passCount = 0
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS ' + name) }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')) }
}
function resetCalls() { calls.cloudLookup = 0; calls.cloudTmt = 0; calls.ai = 0; tmtRejectCount = 0 }
const longText = (i) => 'This is a long enough English paragraph number ' + i + ' describing a Falcon 9 booster landing on the drone ship.'

async function main() {
  // ── 场景 1：3 条长文本 → 全走 AI，不调 TMT
  resetCalls(); tmtBehavior = 'ok'
  let out = await tt.translateTextsSmart([longText(1), longText(2), longText(3)])
  check('S1 三条长文本全部有译文', out.every(Boolean))
  check('S1 AI 调用 3 次', calls.ai === 3, 'ai=' + calls.ai)
  check('S1 未调 TMT', calls.cloudTmt === 0, 'tmt=' + calls.cloudTmt)

  // ── 场景 2：10 条长文本（>6）→ AI 整体跳过，走 TMT
  resetCalls()
  out = await tt.translateTextsSmart(Array.from({ length: 10 }, (_, i) => longText(i)))
  check('S2 十条全部有译文', out.every(Boolean))
  check('S2 AI 未被调用', calls.ai === 0, 'ai=' + calls.ai)
  check('S2 走了 TMT', calls.cloudTmt >= 1, 'tmt=' + calls.cloudTmt)

  // ── 场景 3：短文本（<40 字符）不进 AI，直接 TMT
  resetCalls()
  out = await tt.translateTextsSmart(['Launch scrubbed', 'Static fire done'])
  check('S3 短文本有译文', out.every(Boolean))
  check('S3 AI 未被调用', calls.ai === 0, 'ai=' + calls.ai)

  // ── 场景 4：AI 不可用时长文本降级 TMT
  resetCalls(); aiAvailable = false
  out = await tt.translateTextsSmart([longText(1)])
  check('S4 AI 不可用仍有 TMT 译文', out.every(Boolean))
  check('S4 AI 未被调用', calls.ai === 0)
  aiAvailable = true

  // ── 场景 5：runTranslate 永久错误不重试（额度用尽只调 1 次 TMT）
  resetCalls(); tmtBehavior = 'reject-permanent'; aiAvailable = false
  const page5 = { data: { sw: false, ld: false }, setData(p) { Object.assign(this.data, p) } }
  await tt.togglePageTranslation(page5, {
    switchKey: 'sw', loadingKey: 'ld',
    fields: [{ path: 'ovr', text: 'Short english text' }]
  })
  check('S5 永久错误只调用 1 次（不重试）', tmtRejectCount === 1, 'rejects=' + tmtRejectCount)
  check('S5 loading 已复位', page5.data.ld === false)

  // ── 场景 6：瞬时错误重试一次（共 2 次调用）
  resetCalls(); tmtBehavior = 'reject-transient'
  const page6 = { data: { sw: false, ld: false }, setData(p) { Object.assign(this.data, p) } }
  await tt.togglePageTranslation(page6, {
    switchKey: 'sw', loadingKey: 'ld',
    fields: [{ path: 'ovr', text: 'Short english text' }]
  })
  check('S6 瞬时错误重试一次（共 2 次）', tmtRejectCount === 2, 'rejects=' + tmtRejectCount)
  check('S6 loading 已复位', page6.data.ld === false)

  console.log('\n==== 结果: ' + passCount + ' PASS, ' + failures.length + ' FAIL ====')
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

main().catch((e) => { console.error('脚本失败:', e.stack || e.message); process.exit(1) })
