/**
 * 星问 Agent 运行时工具：把领域工具接到现有 resolveRichChatPayload
 */
const {
  TOOL_SCHEMAS,
  mapToolCallToIntent,
  buildSyntheticQuery,
  factsFromCards,
  mergeCards,
  toolEventName,
  toolStatusLabel
} = require('./xingwen-agent-core.js')

function stringifyToolResult(payload) {
  try {
    return JSON.stringify(payload)
  } catch (e) {
    return '{"ok":false,"facts":"工具结果序列化失败"}'
  }
}

/**
 * @param {{
 *   resolveOpts: object,
 *   session: object,
 *   collector: { cards: any[], subscribeMission: any, launchContext: any, intent: string },
 *   onStatus?: (label: string) => void
 * }} ctx
 */
function buildXingwenToolList(ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : {}
  const collector = context.collector || { cards: [], subscribeMission: null, launchContext: null }

  async function runResolverTool(name, args) {
    if (typeof context.onStatus === 'function') {
      try { context.onStatus(toolStatusLabel(name)) } catch (e) {}
    }

    const { resolveRichChatPayload } = require('./ai-chat-rich.js')
    const intent = mapToolCallToIntent(name, args, context.session)
    const queryText = buildSyntheticQuery(name, args, context.session)
    const rich = await resolveRichChatPayload(queryText, Object.assign({}, context.resolveOpts || {}, {
      forcedIntent: intent || undefined,
      queryText: queryText
    }))
    collector.cards = mergeCards((collector.cards || []).concat(rich.cards || []))
    if (rich.subscribeMission) collector.subscribeMission = rich.subscribeMission
    collector.launchContext = rich.launchContext
    collector.intent = rich.intent || intent
    const hint = rich.launchContext && rich.launchContext.focusHint
    return stringifyToolResult({
      ok: !!(rich.cards && rich.cards.length),
      intent: rich.intent || intent,
      facts: factsFromCards(rich.cards) || hint || '暂无匹配数据，请如实告知用户并指路对应页面。',
      cardCount: (rich.cards || []).length
    })
  }

  return TOOL_SCHEMAS.map((schema) => ({
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
    fn: async function (args) {
      try {
        return await runResolverTool(schema.name, args || {})
      } catch (err) {
        return stringifyToolResult({
          ok: false,
          facts: '工具执行失败：' + ((err && err.message) || '未知错误')
        })
      }
    }
  }))
}

function onXingwenToolEvent(ev, onStatus) {
  const name = toolEventName(ev)
  if (!name || typeof onStatus !== 'function') return
  try { onStatus(toolStatusLabel(name)) } catch (e) {}
}

module.exports = {
  buildXingwenToolList,
  onXingwenToolEvent
}
