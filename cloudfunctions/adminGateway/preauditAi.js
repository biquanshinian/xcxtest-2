/**
 * 一键预审 AI 审计：只收结构化事实 + 成交通知 OCR 摘录，不收图、不落库。
 * 公开接口，按 IP 限流。混元不可用时返回空文本，由前端用本地核验说明兜底。
 */
const { getAIEntry, extractLLMText, buildCallShapes } = require('./oaContentLlm')

const HOUR_LIMIT = 8
const DAY_LIMIT = 20
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const RATE_COLLECTION = 'security_rate_limits'
const MAX_EXCERPT = 800
const MAX_ISSUES = 24

const SYSTEM = [
  '你是村级报账资料预审助手。',
  '只根据给定事实和规则核验结果写说明，不要编造没给出的数字、日期或材料。',
  '用 2 到 5 句简体中文。先说能不能报，再说最该补或最该核对哪几项。',
  '合同或发票金额空着时，按中标/成交通知核对，不要把空着当成不符。',
  '不要客套，不要列表符号，不要提模型名称。'
].join('')

function clip(v, n) {
  return String(v == null ? '' : v).trim().slice(0, n)
}

function sanitizeAdvice(raw) {
  let s = String(raw || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (s.length > 600) s = s.slice(0, 600)
  return s
}

async function assertRateLimit(db, crypto, clientIp, now) {
  const ip = String(clientIp || 'unknown').slice(0, 64)
  const id = 'preaudit_ai_' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)
  const ts = now()
  let data = null
  try {
    const snap = await db.collection(RATE_COLLECTION).doc(id).get()
    data = snap && snap.data
  } catch (e) {
    data = null
  }
  let hourStart = Number(data && data.hourStart) || ts
  let dayStart = Number(data && data.dayStart) || ts
  let hourCount = Number(data && data.hourCount) || 0
  let dayCount = Number(data && data.dayCount) || 0
  if (ts - hourStart > HOUR_MS) {
    hourStart = ts
    hourCount = 0
  }
  if (ts - dayStart > DAY_MS) {
    dayStart = ts
    dayCount = 0
  }
  if (hourCount >= HOUR_LIMIT) return { ok: false, message: 'AI 审计太勤了，过一会儿再试' }
  if (dayCount >= DAY_LIMIT) return { ok: false, message: '今天 AI 审计次数用完了' }
  try {
    await db.collection(RATE_COLLECTION).doc(id).set({
      data: {
        kind: 'preaudit_ai',
        hourStart,
        hourCount: hourCount + 1,
        dayStart,
        dayCount: dayCount + 1,
        updatedAt: ts
      }
    })
  } catch (e) {
    // 限流表写失败不挡，避免集合未建时整页不可用
  }
  return { ok: true }
}

function compactFacts(body) {
  const summary = (body && body.summary) || {}
  const dates = (body && body.dates) || {}
  const issues = Array.isArray(body && body.issues) ? body.issues.slice(0, MAX_ISSUES) : []
  const issueLines = issues.map((row) => {
    const cat = clip(row && row.category, 12)
    const title = clip(row && row.title, 40)
    const message = clip(row && row.message, 80)
    return [cat, title, message].filter(Boolean).join('｜')
  }).filter(Boolean)
  return [
    '报账类型：' + clip(body && body.orgType, 16),
    '项目：' + clip(body && body.name, 40),
    '村/单位：' + clip(body && body.village, 20),
    '中标单位：' + clip(body && body.contractor, 40),
    '规则核验：' + clip(summary.label, 20) + '。' + clip(summary.text, 80),
    '中标日：' + clip(dates.bidDate, 16),
    '中标/成交金额：' + clip(dates.awardAmount, 16),
    '合同日：' + clip(dates.contractDate, 16),
    '最低价：' + clip(dates.lowestAmount, 16),
    '预算报价：' + clip(dates.budgetQuote, 16),
    '决议公示：' + clip(dates.noticeResStart, 16) + ' 至 ' + clip(dates.noticeResEnd, 16),
    issueLines.length ? '问题：\n' + issueLines.join('\n') : '问题：无',
    '成交通知摘录：\n' + clip(body && body.awardExcerpt, MAX_EXCERPT)
  ].join('\n')
}

async function quickHunyuan(userText) {
  const AI = getAIEntry()
  if (!AI) return ''
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userText }
  ]
  const attempts = [
    { provider: 'hunyuan-open', model: 'hunyuan-lite' },
    { provider: 'cloudbase', model: 'hy3-preview' }
  ]
  const timeoutMs = 18000
  for (const p of attempts) {
    try {
      const model = AI.createModel(p.provider)
      if (!model || typeof model.generateText !== 'function') continue
      const shapes = buildCallShapes(p.model, messages, { temperature: 0.2, maxTokens: 400 })
      const res = await Promise.race([
        model.generateText(shapes[0]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ])
      const text = sanitizeAdvice(extractLLMText(res))
      if (text) return text
    } catch (e) {
      // 换下一个入口，失败由前端本地说明兜底
    }
  }
  return ''
}

function createPreauditAiApi({ db, ok, fail, now, crypto }) {
  async function advise(body, ctx) {
    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now)
    if (!limited.ok) return fail(4290, limited.message)
    try {
      const text = await quickHunyuan(compactFacts(body || {}))
      return ok({
        text,
        engine: text ? 'hunyuan' : 'none'
      })
    } catch (e) {
      return ok({ text: '', engine: 'none' })
    }
  }

  return { advise }
}

module.exports = { createPreauditAiApi }
