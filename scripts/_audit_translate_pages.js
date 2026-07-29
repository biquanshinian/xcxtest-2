/**
 * 「翻译/原文」胶囊按钮的全页面 + 全链路审计。
 *
 * 覆盖两类此前静默失效的根因：
 * 1. 云函数 wx-server-sdk 版本低于 3.0.5-beta.1 → cloud.ai() / cloud.extend.AI 都不存在，
 *    混元主通道被整段跳过，只剩 TMT 兜底；额度用尽后所有无预翻译的详情页都会报错。
 * 2. 客户端 aiService 只挂 hunyuan-v3，缺 cloudbase provider 兜底 → 客户端混元也拿不到译文。
 *
 * 另外校验每个带按钮的页面：handler 存在、catchtap 绑定、翻译中重入保护。
 * 用法：node scripts/_audit_translate_pages.js
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const failures = []
let passCount = 0
function check(name, ok, detail) {
  if (ok) {
    passCount++
    console.log('  PASS ' + name)
  } else {
    failures.push(name)
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''))
  }
}

// ── 1. 四份 text-translate 副本必须逐字节一致 ────────────────────
console.log('\n== 副本一致性 ==')
const TT_COPIES = [
  'pages/mission-detail/utils/text-translate.js',
  'subpackages/news-extra/utils/text-translate.js',
  'subpackages/monitor-pages/utils/text-translate.js',
  'subpackages/progress-extra/utils/text-translate.js'
]
const canonical = read(TT_COPIES[0])
for (let i = 1; i < TT_COPIES.length; i++) {
  check('副本一致 ' + TT_COPIES[i], read(TT_COPIES[i]) === canonical)
}
// 四份副本都在 <root>/<pkg>/utils/ 这一层，membership / aiService 的相对路径才成立
for (const rel of TT_COPIES) {
  check('副本层级正确 ' + rel, rel.split('/').length === 4)
}

// ── 2. 用到 AI 的云函数必须声明支持 cloud.ai() 的 SDK ───────────
console.log('\n== 云函数 wx-server-sdk 版本 ==')
/** cloud.ai() 需要 wx-server-sdk >= 3.0.5-beta.1 */
const MIN_SDK = [3, 0, 5]
function parseVersion(spec) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(spec || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}
const cfDir = path.join(ROOT, 'cloudfunctions')
for (const name of fs.readdirSync(cfDir)) {
  const dir = path.join(cfDir, name)
  if (!fs.statSync(dir).isDirectory()) continue
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) continue

  const usesAI = fs.readdirSync(dir).some((f) => {
    if (!f.endsWith('.js')) return false
    return /cloud\.ai\(|cloud\.extend\s*&&\s*cloud\.extend\.AI|cloud\.extend\.AI/.test(
      fs.readFileSync(path.join(dir, f), 'utf8')
    )
  })
  if (!usesAI) continue

  let spec = ''
  try {
    spec = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies || {})['wx-server-sdk'] || ''
  } catch (e) {}
  if (spec === 'latest') {
    check(name + ' SDK 版本', true)
    continue
  }
  const v = parseVersion(spec)
  check(name + ' SDK >= 3.0.5（cloud.ai 可用）', !!v && gte(v, MIN_SDK), 'wx-server-sdk=' + spec)
}

// ── 3. 客户端 AI provider 兜底链 ────────────────────────────────
console.log('\n== 客户端 AI provider ==')
const aiSrc = read('subpackages/shared/utils/aiService.js')
check('generateTextAdvanced 有 provider 兜底链', /buildAiProviderChain/.test(aiSrc))
check('兜底链含 cloudbase', /provider:\s*'cloudbase'/.test(aiSrc))
const chainOrder = /provider:\s*'cloudbase'[\s\S]*?provider:\s*'hunyuan-v3'[\s\S]*?provider:\s*'hunyuan-open'/.test(aiSrc)
check('兜底链顺序 cloudbase → hunyuan-v3 → hunyuan-open', chainOrder)
check('超时不再换 provider 重试（避免等待翻倍）', /AI_TIMEOUT_MESSAGE/.test(aiSrc))
check('薄壳 isAIAvailable 查 createModel', /extend\.AI\.createModel/.test(read('utils/aiService.js')))
// streamChat 曾硬编码 hunyuan-v3，该 provider 在部分环境已不解析
check('streamChat 也走兜底链', /for \(const entry of buildAiProviderChain\('hy3-preview'\)\)/.test(aiSrc))
check('全文无硬编码单 provider 调用', !/createModel\('hunyuan-(v3|open)'\)/.test(aiSrc))

console.log('\n== 云端诊断口径 ==')
const cloudTranslateSrc = read('cloudfunctions/ll2Query/translate.js')
check('translateDiag 报告 AI 入口', /aiEntry/.test(cloudTranslateSrc))
check('translateDiag 报告 SDK 版本', /sdkVersion/.test(cloudTranslateSrc))
check('translateDiag 实测混元', /out\.aiResult = await translateViaAI/.test(cloudTranslateSrc))

// ── 4. 页面接线：handler / catchtap / 重入保护 ──────────────────
console.log('\n== 页面接线 ==')
const PAGES = [
  ['pages/mission-detail/mission-detail', ['onToggleDescTranslate', 'onToggleTimelineTranslate']],
  ['pages/mission-detail/launch-updates', ['onToggleTranslate']],
  ['subpackages/news-extra/detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/agency-detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/booster-detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/launch-site-detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/rocket-model-detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/spacecraft-detail', ['onToggleDescTranslate']],
  ['subpackages/monitor-pages/station-detail', ['onToggleDescTranslate']],
  ['subpackages/progress-extra/event-detail', [
    'onToggleEventDescTranslate',
    'onToggleUpdatesTranslate',
    'onToggleLaunchUpdatesTranslate'
  ]],
  ['subpackages/progress-extra/hardware-detail', ['onToggleTestsTranslate']]
]

for (const [base, handlers] of PAGES) {
  check('页面存在 ' + base, exists(base + '.js') && exists(base + '.wxml'))
  if (!exists(base + '.js')) continue
  const js = read(base + '.js')
  const wxml = read(base + '.wxml')

  check(base + ' 引入 text-translate', /require\(['"][^'"]*text-translate\.js['"]\)/.test(js))

  for (const h of handlers) {
    check(base + ' 定义 ' + h, new RegExp('\\b' + h + '\\s*\\(').test(js))
    check(base + ' WXML catchtap 绑定 ' + h, new RegExp('catchtap="' + h + '"').test(wxml))
    // 重入保护：handler 体内先判 xxxTranslating 再往下走
    const body = js.slice(js.indexOf(h + '('))
    check(base + ' ' + h + ' 有重入保护', /^[\s\S]{0,220}?if\s*\(this\.data\.\w*[Tt]ranslating\)\s*return/.test(body))
  }

  // WXML 里出现的每个 translate-toggle 都必须绑到已定义的 handler
  const bound = [...wxml.matchAll(/catchtap="(onToggle\w*Translate\w*)"/g)].map((m) => m[1])
  const unknown = bound.filter((h) => !new RegExp('\\b' + h + '\\s*\\(').test(js))
  check(base + ' 无悬空 handler', unknown.length === 0, unknown.join(','))
}

// ── 5. 运行时：译文校验 / 分段补跑 / 错误文案 ───────────────────
console.log('\n== 运行时 ==')
let aiCalls = 0
let aiFailFirstN = 0
global.wx = {
  cloud: {
    callFunction(opts) {
      const texts = (opts.data && opts.data.texts) || []
      setTimeout(() => opts.success({ result: { success: true, list: texts.map(() => '') } }), 0)
    }
  },
  showToast() {},
  vibrateShort() {}
}
const mockAiPath = '\u0000mock-aiService-pages'
const mockMemberPath = '\u0000mock-membership-pages'
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (/aiService\.js$/.test(request)) return mockAiPath
  if (/membership\.js$/.test(request)) return mockMemberPath
  return realResolve.call(this, request, ...rest)
}
require.cache[mockAiPath] = {
  id: mockAiPath, filename: mockAiPath, loaded: true,
  exports: {
    isAIAvailable: () => true,
    generateTextAdvanced: async () => {
      aiCalls++
      if (aiCalls <= aiFailFirstN) throw new Error('provider 抖动')
      return '猎鹰九号助推器在无人船上完成回收着陆，任务圆满成功。'
    }
  }
}
require.cache[mockMemberPath] = {
  id: mockMemberPath, filename: mockMemberPath, loaded: true,
  exports: { gateCheck: () => Promise.resolve(true) }
}

const tt = require(path.join(ROOT, TT_COPIES[0]))

async function runtime() {
  // 专名密集的新闻标题：译文保留 SpaceX / Falcon 9 不该被判成「没翻译」
  const src = 'SpaceX Falcon 9 launches Starlink Group 10-12 from SLC-40'
  const zh = 'SpaceX Falcon 9 从 SLC-40 发射星链 Group 10-12'
  check('专名保留的译文判定为有效', tt.looksLikeTranslation(src, zh))
  check('英文原样复述判定为无效', !tt.looksLikeTranslation(src, src))
  check('空译文判定为无效', !tt.looksLikeTranslation(src, ''))
  check('纯英文解释判定为无效', !tt.looksLikeTranslation(src, 'This article describes a launch.'))

  // 分段补跑：长文首段失败一次后仍应产出完整译文
  aiCalls = 0
  aiFailFirstN = 1
  const longText = ('The Falcon 9 booster returned to the drone ship after stage separation. ').repeat(60)
  const out = await tt.translateTextsSmart([longText])
  check('长文单段抖动后仍有完整译文', !!out[0], 'len=' + String(out[0] || '').length)
  check('失败段被补跑', aiCalls > 2, 'aiCalls=' + aiCalls)
  aiFailFirstN = 0

  check('额度用尽错误转中文文案', tt.friendlyTranslateError('service free amount of this month has been used up') === '翻译额度已用完，请稍后再试')
  check('未配置密钥错误转中文文案', tt.friendlyTranslateError('云端翻译服务未配置密钥') === '翻译服务未配置，请联系管理员')
  check('超时错误转中文文案', tt.friendlyTranslateError('AI请求超时') === '翻译超时，请稍后再试')

  console.log('\n==== 结果: ' + passCount + ' PASS, ' + failures.length + ' FAIL ====')
  if (failures.length) {
    console.log(failures.join('\n'))
    process.exit(1)
  }
}

runtime().catch((e) => {
  console.error('脚本失败:', e.stack || e.message)
  process.exit(1)
})
