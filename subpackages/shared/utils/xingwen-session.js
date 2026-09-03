/**
 * 星问会话状态：指代消解、槽位继承、混合路由、记忆快照、追问芯片
 * 无 wx / 无网络，可供单测。
 */
const {
  resolveAiChatRichIntent,
  scoreAllRichIntents,
  isPureChitchat,
  INTENT_SCORE_THRESHOLD,
  parseLaunchListCountryFilter,
  parseLaunchListSiteFilter,
  parseLaunchStatsFocus,
  detectKnownAgencyCanonical
} = require('./ai-chat-rich-core.js')

const FAST_PATH_SCORE_MARGIN = 10

const DEIXIS_RE = /(这|那|刚才|上次|上一条|同样|也给我|也看|换成|改成|那么|还有呢|的呢\s*$|呢\s*$)/

const INTENT_QUERY_SEED = {
  launch_list: '即将发射',
  history_list: '历史发射',
  mission_lookup: '什么时候发射',
  launch_stats: '发射了多少次',
  agency: '是什么公司',
  starship_next: '星舰下一次试飞',
  starship_status: '星舰组合体进展',
  starship_hardware: '星舰硬件',
  road_closure: '星舰基地封路',
  rocket_model: '火箭参数',
  launch_site: '发射场',
  spacecraft: '飞船资料',
  booster: '助推器战绩',
  recovery_stats: '回收成功率',
  mission_replay: '发射集锦回放',
  set_reminder: '提醒我一下',
  station: '空间站状态',
  starlink_pass: '星链过境',
  starlink_map: '星链分布',
  apod: '今天的天文图片',
  astro_calendar: '最近有什么流星雨',
  viewing_spot: '去哪看火箭发射',
  my_launches: '我订阅了哪些发射',
  launch_vote: '发射竞猜',
  year_review: '我的航天年度回顾'
}

function createEmptySession() {
  return {
    lastIntent: '',
    lastEntities: {},
    lastCardTypes: [],
    lastMissionId: '',
    lastMissionName: '',
    summary: ''
  }
}

function hasDeixis(text) {
  const q = String(text || '').trim()
  if (!q) return false
  return DEIXIS_RE.test(q)
}

function stripCountryWords(text) {
  return String(text || '')
    .replace(/中国|国内|我国|美国|USA|\bUS\b|俄罗斯|俄国|印度|日本|韩国|南韩|法国|英国|以色列|澳大利亚|澳洲/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFollowupSlots(text) {
  const q = String(text || '').trim()
  const slots = {}
  if (!q) return slots

  const country = parseLaunchListCountryFilter(q)
  if (country) slots.country = country

  const site = parseLaunchListSiteFilter(q)
  if (site) {
    slots.site = site.label || site.key
    slots.siteKey = site.key
  }

  const rest = stripCountryWords(q)
  if (rest.length >= 2) {
    const agencyKey = detectKnownAgencyCanonical(rest)
    if (agencyKey) slots.agency = agencyKey
  }

  const stats = parseLaunchStatsFocus(q)
  if (stats && stats.scope && stats.scope !== 'year') slots.scope = stats.scope
  if (stats && stats.year) slots.year = stats.year

  if (/(历史|过往|上次|已经?发射|发过)/.test(q)) slots.mode = 'history'
  else if (/(即将|接下来|下次|未来)/.test(q)) slots.mode = 'upcoming'

  return slots
}

function mergeEntities(base, extra) {
  const out = Object.assign({}, base && typeof base === 'object' ? base : {})
  const add = extra && typeof extra === 'object' ? extra : {}
  Object.keys(add).forEach((k) => {
    if (add[k] != null && add[k] !== '') out[k] = add[k]
  })
  return out
}

function resolveFollowupIntent(text, session) {
  const prev = session && session.lastIntent ? String(session.lastIntent) : ''
  const slots = extractFollowupSlots(text)
  if (slots.mode === 'history' && (prev === 'launch_list' || prev === 'mission_lookup')) {
    return 'history_list'
  }
  if (slots.mode === 'upcoming' && prev === 'history_list') return 'launch_list'
  return prev || null
}

function applyFollowupToQuery(text, session) {
  const q = String(text || '').trim()
  const prev = session && session.lastEntities ? session.lastEntities : {}
  const merged = mergeEntities(prev, extractFollowupSlots(q))
  const intent = resolveFollowupIntent(q, session) || (session && session.lastIntent) || ''
  const parts = []
  if (merged.country) parts.push(merged.country)
  if (merged.site) parts.push(merged.site)
  if (merged.agency) parts.push(merged.agency)
  if (merged.keyword) parts.push(merged.keyword)
  if (session && session.lastMissionName && /提醒|这个|那个|这场/.test(q)) {
    parts.push(session.lastMissionName)
  }
  const seed = INTENT_QUERY_SEED[intent] || ''
  if (seed) parts.push(seed)
  if (q) parts.push(q)
  return parts.filter(Boolean).join(' ').trim() || q
}

function peekBestIntent(text) {
  const q = String(text || '').trim()
  const intent = resolveAiChatRichIntent(q)
  if (!intent) return { intent: null, score: 0, threshold: 40 }
  const scores = scoreAllRichIntents(q)
  const threshold = INTENT_SCORE_THRESHOLD[intent] || 40
  return { intent, score: scores[intent] || 0, threshold }
}

/**
 * @returns {{ mode: 'fast'|'slot'|'agent', queryText: string, forcedIntent: string|null }}
 */
function decideXingwenRoute(opts) {
  const text = String((opts && opts.text) || '').trim()
  const session = (opts && opts.session) || createEmptySession()
  const agentEnabled = !opts || opts.agentEnabled !== false
  const fromShortcut = !!(opts && opts.fromShortcut)
  const fromFollowup = !!(opts && opts.fromFollowup)

  if (!text) return { mode: 'fast', queryText: text, forcedIntent: null }

  if (!agentEnabled || fromShortcut) {
    return { mode: 'fast', queryText: text, forcedIntent: null }
  }

  if (fromFollowup && session.lastIntent) {
    return {
      mode: 'slot',
      queryText: applyFollowupToQuery(text, session),
      forcedIntent: resolveFollowupIntent(text, session)
    }
  }

  if (hasDeixis(text) && session.lastIntent) {
    return {
      mode: 'slot',
      queryText: applyFollowupToQuery(text, session),
      forcedIntent: resolveFollowupIntent(text, session)
    }
  }

  if (isPureChitchat(text) && !hasDeixis(text)) {
    return { mode: 'fast', queryText: text, forcedIntent: null }
  }

  const peeked = peekBestIntent(text)
  if (
    peeked.intent &&
    peeked.score >= peeked.threshold + FAST_PATH_SCORE_MARGIN &&
    !hasDeixis(text)
  ) {
    return { mode: 'fast', queryText: text, forcedIntent: peeked.intent }
  }

  return { mode: 'agent', queryText: text, forcedIntent: null }
}

function mergeSessionFromPayload(session, payload, text) {
  const next = session && typeof session === 'object' ? Object.assign({}, session) : createEmptySession()
  const intent = payload && payload.intent ? String(payload.intent) : ''
  const cards = payload && Array.isArray(payload.cards) ? payload.cards : []
  if (intent) next.lastIntent = intent
  next.lastEntities = mergeEntities(next.lastEntities, extractFollowupSlots(text))
  next.lastCardTypes = cards.map((c) => c && c.cardType).filter(Boolean)
  const mission = cards.find((c) => c && (c.cardType === 'mission' || c.cardType === 'reminder'))
  if (mission) {
    next.lastMissionId = String(mission.id || mission.missionId || '')
    next.lastMissionName = String(mission.name || mission.missionName || '')
    if (next.lastMissionName) next.lastEntities.keyword = next.lastMissionName
  }
  const list = cards.find((c) => c && c.cardType === 'launch_list')
  if (list && list.listFilter) {
    const f = list.listFilter
    if (f.country) next.lastEntities.country = f.country
    if (f.siteLabel || f.siteKey) next.lastEntities.site = f.siteLabel || f.siteKey
    if (f.agencyKey || f.agencyLabel) next.lastEntities.agency = f.agencyLabel || f.agencyKey
  }
  return next
}

function formatSessionHint(session) {
  if (!session || !session.lastIntent) return ''
  const e = session.lastEntities || {}
  const bits = ['上一轮意图：' + session.lastIntent]
  if (e.country) bits.push('国家=' + e.country)
  if (e.site) bits.push('发射场=' + e.site)
  if (e.agency) bits.push('发射商=' + e.agency)
  if (session.lastMissionName) bits.push('任务=' + session.lastMissionName)
  bits.push('用户若用「那/这/呢」追问，沿用以上筛选，缺的槽位才向用户确认。')
  return bits.join('；')
}

function formatMemorySnapshot(memory) {
  const m = memory && typeof memory === 'object' ? memory : {}
  const lines = []
  if (m.rocketTypes && m.rocketTypes.length) lines.push('关注火箭：' + m.rocketTypes.slice(0, 4).join('、'))
  if (m.launchSites && m.launchSites.length) lines.push('关注发射场：' + m.launchSites.slice(0, 4).join('、'))
  if (m.nextSubscribedName) {
    lines.push('已订阅下一发：' + m.nextSubscribedName + (m.nextSubscribedTime ? '（' + m.nextSubscribedTime + '）' : ''))
  }
  if (m.subscribedCount > 0) lines.push('当前订阅发射 ' + m.subscribedCount + ' 场')
  if (m.briefingHeadline) lines.push('今日简报要点：' + String(m.briefingHeadline).slice(0, 80))
  if (m.city) lines.push('观测城市：' + m.city)
  if (!lines.length) return ''
  return lines.join('\n') + '\n（记忆里不要当发射时刻的权威来源；时刻以本轮工具/卡片为准。）'
}

function pickNextSubscribed(list) {
  const now = Date.now()
  const rows = Array.isArray(list) ? list.slice() : []
  rows.sort((a, b) => {
    const ta = Date.parse(a && a.launchTime) || 0
    const tb = Date.parse(b && b.launchTime) || 0
    return ta - tb
  })
  for (let i = 0; i < rows.length; i += 1) {
    const t = Date.parse(rows[i] && rows[i].launchTime) || 0
    if (t >= now - 6 * 3600 * 1000) return rows[i]
  }
  return rows[0] || null
}

function buildPersonalizedShortcuts(memory) {
  const m = memory && typeof memory === 'object' ? memory : {}
  const chips = []
  if (m.nextSubscribedName) {
    chips.push({
      id: 'mem_next_sub',
      label: '你的下一发',
      q: String(m.nextSubscribedName) + ' 什么时候发射？'
    })
  }
  if (m.rocketTypes && m.rocketTypes[0]) {
    chips.push({
      id: 'mem_rocket',
      label: String(m.rocketTypes[0]),
      q: String(m.rocketTypes[0]) + ' 接下来有哪些发射？'
    })
  }
  if (m.launchSites && m.launchSites[0]) {
    chips.push({
      id: 'mem_site',
      label: String(m.launchSites[0]),
      q: String(m.launchSites[0]) + ' 接下来有哪些发射？'
    })
  }
  if (m.briefingHeadline) {
    chips.push({
      id: 'mem_briefing',
      label: '今日简报',
      q: '今天有什么航天看点？'
    })
  }
  return chips.slice(0, 3)
}

function buildFollowupChips(session, cards) {
  const s = session || createEmptySession()
  const list = Array.isArray(cards) ? cards : []
  const chips = []
  const types = list.map((c) => c && c.cardType)
  const hasMission = types.indexOf('mission') >= 0 || types.indexOf('reminder') >= 0
  const hasList = types.indexOf('launch_list') >= 0
  const hasStats = types.indexOf('launch_stats') >= 0
  const country = s.lastEntities && s.lastEntities.country

  if (hasMission && s.lastIntent !== 'set_reminder') {
    chips.push({ id: 'fu_remind', label: '要不要设提醒？', q: '提醒我一下' })
  }
  if ((hasList || hasStats || s.lastIntent === 'launch_list' || s.lastIntent === 'launch_stats') && country !== '中国') {
    chips.push({ id: 'fu_cn', label: '看中国的？', q: '那中国的呢' })
  }
  if ((hasList || hasStats) && country !== '美国') {
    chips.push({ id: 'fu_us', label: '看美国的？', q: '那美国的呢' })
  }
  if (s.lastIntent === 'launch_list') {
    chips.push({ id: 'fu_hist', label: '看历史发射', q: '那历史的呢' })
  }
  if (hasMission && s.lastIntent !== 'mission_replay') {
    chips.push({ id: 'fu_replay', label: '有集锦回放吗？', q: '有发射集锦回放吗' })
  }
  return chips.slice(0, 3)
}

function extractiveSummary(messages) {
  const rows = Array.isArray(messages) ? messages : []
  return rows
    .filter((m) => m && m.content)
    .slice(-12)
    .map((m) => {
      const role = m.role === 'user' ? '用户' : '星问'
      return role + '：' + String(m.content).replace(/\s+/g, ' ').slice(0, 80)
    })
    .join('\n')
    .slice(0, 600)
}

function mergeExtractiveSummary(prev, droppedMessages) {
  const extra = extractiveSummary(droppedMessages)
  if (!extra) return String(prev || '')
  const head = String(prev || '').trim()
  if (!head) return extra
  return (head + '\n' + extra).slice(-600)
}

module.exports = {
  FAST_PATH_SCORE_MARGIN,
  createEmptySession,
  hasDeixis,
  extractFollowupSlots,
  mergeEntities,
  resolveFollowupIntent,
  applyFollowupToQuery,
  peekBestIntent,
  decideXingwenRoute,
  mergeSessionFromPayload,
  formatSessionHint,
  formatMemorySnapshot,
  pickNextSubscribed,
  buildPersonalizedShortcuts,
  buildFollowupChips,
  extractiveSummary,
  mergeExtractiveSummary
}
