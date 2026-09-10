/**
 * 3D 展陈里的星问对话：分包薄壳调主包 AI，不拉整页聊天 UI。
 * 只给 rocket-3d 用，不放主包（代码质量会报「主包未使用 JS」）。
 */
const { isAIAvailable, streamChat } = require('../../utils/aiService.js')
const {
  isMembershipEnabled,
  getMembershipState,
  getAiChatRemaining,
  isPro,
  recordAiChatUse
} = require('../../utils/membership.js')
const { fillExhibitCards } = require('./xingwen-exhibit-cards.js')

const DAILY_QUOTA_KEY = '_ai_chat_daily_quota'
const MAX_DAILY_QUESTIONS = 10
const MAX_HISTORY = 8
const STREAM_HAPTIC_MS = 220

function tickStreamHaptic(bucket) {
  const now = Date.now()
  if (bucket && bucket.at && now - bucket.at < STREAM_HAPTIC_MS) return false
  if (bucket) bucket.at = now
  try {
    wx.vibrateShort({ type: 'light' })
  } catch (e) {}
  return true
}

function pulseCardHaptic() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {}
}

function _quotaDate() {
  return new Date().toDateString()
}

function _adBonusDate() {
  const d = new Date()
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

function _localQuotaInfo() {
  try {
    const raw = wx.getStorageSync(DAILY_QUOTA_KEY)
    if (raw && raw.date === _quotaDate()) return raw
  } catch (e) {}
  return { date: _quotaDate(), count: 0 }
}

function _adBonus() {
  try {
    const raw = wx.getStorageSync('_ai_chat_ad_bonus')
    if (raw && typeof raw === 'object' && String(raw.date || '') === _adBonusDate()) {
      return Math.max(0, Number(raw.bonus) || 0)
    }
  } catch (e) {}
  return 0
}

function _localRemaining() {
  const info = _localQuotaInfo()
  return Math.max(0, MAX_DAILY_QUESTIONS + _adBonus() - (Number(info.count) || 0))
}

function _bumpLocalQuota() {
  const info = _localQuotaInfo()
  info.count = (Number(info.count) || 0) + 1
  try {
    wx.setStorageSync(DAILY_QUOTA_KEY, info)
  } catch (e) {}
}

function qualifyExhibitQuery(text, context) {
  const q = String(text || '').trim()
  const name = String((context && (context.rocketName || context.title)) || '').trim()
  if (!q || !name) return q
  if (q.indexOf(name) >= 0) return q
  if (
    /(这[枚个]?火箭|当前火箭|这个型号|这型号|多高|多长|直径|参数|规格|多重|全长)/.test(q)
  ) {
    return name + ' ' + q
  }
  return q
}

function buildLaunchContext(opts) {
  const src = opts && typeof opts === 'object' ? opts : {}
  const name = String(src.rocketName || src.title || '').trim()
  const bits = []
  if (name) bits.push('用户正在 3D 火箭展陈页看「' + name + '」')
  if (src.length) bits.push('全长 ' + String(src.length).trim())
  if (src.diameter) bits.push('直径 ' + String(src.diameter).trim())
  if (src.intro) bits.push(String(src.intro).trim().slice(0, 180))
  return {
    focusMission: name
      ? { name: name, rocketName: name, rocketNameEn: String(src.rocketNameEn || ''), detailType: 'upcoming' }
      : undefined,
    focusHint: bits.join('。') + '。尺寸数字以页面标注为准，不要凭记忆报数。',
    uiCardReady: true
  }
}

function historyToApi(messages) {
  const list = Array.isArray(messages) ? messages : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || !m.content || m.error) continue
    if (m.role !== 'user' && m.role !== 'assistant') continue
    out.push({ role: m.role, content: String(m.content) })
  }
  return out.slice(-(MAX_HISTORY * 2))
}

async function _recoverQuota(offerUpgrade) {
  try {
    const mod = await require.async('/subpackages/shared/utils/ai-chat-ad-quota.js')
    if (mod && typeof mod.offerAiChatQuotaRecover === 'function') {
      return !!(await mod.offerAiChatQuotaRecover({ offerUpgrade: !!offerUpgrade }))
    }
  } catch (e) {}
  try {
    wx.showToast({ title: '今日次数用完了', icon: 'none' })
  } catch (e2) {}
  return false
}

async function ensureChatReady() {
  if (!isAIAvailable()) return { ok: false, reason: 'unavailable' }
  try {
    const { isFeatureEnabled } = require('../../utils/feature-flags.js')
    const on = await isFeatureEnabled('enableAIChat', { failClosed: true })
    if (!on) return { ok: false, reason: 'disabled' }
  } catch (e) {
    return { ok: false, reason: 'disabled' }
  }
  let membershipOn = false
  try {
    membershipOn = await isMembershipEnabled()
  } catch (e) {}
  if (membershipOn) {
    let state = null
    try {
      state = await getMembershipState()
    } catch (e) {}
    if (state && isPro(state)) return { ok: true, consume: 'member' }
    if (getAiChatRemaining(state) === 0) {
      const recovered = await _recoverQuota(true)
      if (!recovered) return { ok: false, reason: 'quota' }
    }
    return { ok: true, consume: 'member' }
  }
  if (_localRemaining() <= 0) {
    const recovered = await _recoverQuota(false)
    if (!recovered) return { ok: false, reason: 'quota' }
  }
  return { ok: true, consume: 'local' }
}

let _richMod = null
const RICH_PATHS = [
  '/subpackages/shared/utils/ai-chat-rich.js',
  '../../shared/utils/ai-chat-rich.js'
]

async function _loadRich() {
  if (_richMod) return _richMod
  for (let i = 0; i < RICH_PATHS.length; i++) {
    try {
      const rich = await require.async(RICH_PATHS[i])
      if (rich && typeof rich.resolveRichChatPayload === 'function') {
        _richMod = rich
        return rich
      }
    } catch (e) {}
  }
  return null
}

async function _resolveRich(text, launchContext) {
  try {
    const rich = await _loadRich()
    if (rich && typeof rich.resolveRichChatPayload === 'function') {
      return await rich.resolveRichChatPayload(text, {
        launchContext: launchContext,
        queryText: text
      })
    }
  } catch (e) {}
  return { cards: [], launchContext: launchContext, intent: '' }
}

async function sendExhibitChat(opts) {
  const src = opts && typeof opts === 'object' ? opts : {}
  const text = String(src.text || '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  const gate = await ensureChatReady()
  if (!gate.ok) return gate
  const query = qualifyExhibitQuery(text, src.context)
  const baseCtx = src.launchContext || buildLaunchContext(src.context)
  const rich = await _resolveRich(query, baseCtx)
  const cards = fillExhibitCards(query, src.context, rich.cards)
  if (cards.length && typeof src.onCards === 'function') src.onCards(cards)
  const launchContext = Object.assign({}, rich.launchContext || baseCtx, { uiCardReady: !!cards.length })
  const apiHistory = historyToApi(src.messages).concat([{ role: 'user', content: text }])
  let started = false
  const onPartial = typeof src.onPartial === 'function' ? src.onPartial : function () {}
  const onStart = typeof src.onStart === 'function' ? src.onStart : function () {}
  try {
    const suggested =
      launchContext && typeof launchContext.suggestedReply === 'string'
        ? String(launchContext.suggestedReply).trim()
        : ''
    const finalText = suggested
      ? suggested
      : await streamChat(
          apiHistory,
          function (partial) {
            if (!started && partial) {
              started = true
              onStart()
            }
            onPartial(partial)
          },
          launchContext
        )
    if (suggested) onPartial(suggested)
    if (gate.consume === 'member') {
      try {
        await recordAiChatUse()
      } catch (e) {}
    } else if (gate.consume === 'local') {
      _bumpLocalQuota()
    }
    if (typeof src.onDone === 'function') src.onDone(finalText || '', cards)
    return { ok: true, text: finalText || '', cards: cards }
  } catch (err) {
    const msg = String((err && err.message) || '星问这会儿有点忙，稍后再问')
    if (typeof src.onError === 'function') src.onError(msg)
    return { ok: false, reason: 'error', error: msg, cards: [] }
  }
}

module.exports = {
  buildLaunchContext,
  qualifyExhibitQuery,
  historyToApi,
  ensureChatReady,
  sendExhibitChat,
  tickStreamHaptic,
  pulseCardHaptic,
  quotaDate: _quotaDate,
  STREAM_HAPTIC_MS,
  MAX_HISTORY
}
