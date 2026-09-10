/**
 * 星问 Agent 2.0：路由 / 槽位 / 工具 schema 单测
 * node test/xingwen-agent.test.js
 */
const assert = require('assert')
const {
  hasDeixis,
  extractFollowupSlots,
  applyFollowupToQuery,
  resolveFollowupIntent,
  decideXingwenRoute,
  createEmptySession,
  mergeSessionFromPayload,
  formatMemorySnapshot,
  buildFollowupChips,
  buildPersonalizedShortcuts,
  pickNextSubscribed,
  peekBestIntent,
  FAST_PATH_SCORE_MARGIN
} = require('../subpackages/shared/utils/xingwen-session.js')
const {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  mapToolCallToIntent,
  buildSyntheticQuery,
  factsFromCards,
  mergeCards,
  toolEventName,
  toolStatusLabel
} = require('../subpackages/shared/utils/xingwen-agent-core.js')

let failed = 0
function ok(cond, msg) {
  if (cond) console.log('OK', msg)
  else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function sessionWith(intent, entities) {
  const s = createEmptySession()
  s.lastIntent = intent
  s.lastEntities = entities || {}
  return s
}

ok(hasDeixis('那中国的呢'), '指代：那中国的呢')
ok(hasDeixis('这个呢'), '指代：这个呢')
ok(!hasDeixis('接下来有哪些发射？'), '标准问法不是指代')

const slots = extractFollowupSlots('那中国的呢')
ok(slots.country === '中国' && !slots.agency, '槽位抽出国家=中国且不误伤发射商')
ok(extractFollowupSlots('那历史的呢').mode === 'history', '槽位抽出历史 mode')

const prev = sessionWith('launch_list', { country: '美国' })
ok(resolveFollowupIntent('那中国的呢', prev) === 'launch_list', '追问沿用 launch_list')
ok(resolveFollowupIntent('那历史的呢', prev) === 'history_list', '历史追问切 history_list')

const rewritten = applyFollowupToQuery('那中国的呢', prev)
ok(/中国/.test(rewritten) && /即将发射/.test(rewritten), '追问改写含中国+即将发射: ' + rewritten)

const fast = decideXingwenRoute({
  text: '接下来有哪些发射？',
  agentEnabled: true,
  session: createEmptySession()
})
ok(fast.mode === 'fast', '高分标准问法走快路径 mode=' + fast.mode)
ok(fast.forcedIntent === 'launch_list' || peekBestIntent('接下来有哪些发射？').intent === 'launch_list', '快路径意图 launch_list')

const agentRoute = decideXingwenRoute({
  text: '帮我看看最近大家在追的那发大概啥时候',
  agentEnabled: true,
  session: createEmptySession()
})
ok(agentRoute.mode === 'agent' || agentRoute.mode === 'fast', '口语问法可走 agent 或仍命中快路径')

const slotRoute = decideXingwenRoute({
  text: '那中国的呢',
  agentEnabled: true,
  session: prev
})
ok(slotRoute.mode === 'slot', '有上一轮意图的指代走槽位路径')
ok(slotRoute.forcedIntent === 'launch_list', '槽位路径 forcedIntent=launch_list')

const off = decideXingwenRoute({
  text: '帮我看看最近大家在追的那发大概啥时候',
  agentEnabled: false,
  session: createEmptySession()
})
ok(off.mode === 'fast', '开关关闭回滚纯正则快路径')

const shortcut = decideXingwenRoute({
  text: '接下来有哪些发射？',
  fromShortcut: true,
  agentEnabled: true,
  session: createEmptySession()
})
ok(shortcut.mode === 'fast' && !shortcut.forcedIntent, '快捷入口不强制意图')

const follow = decideXingwenRoute({
  text: '看中国的？',
  fromFollowup: true,
  agentEnabled: true,
  session: prev
})
ok(follow.mode === 'slot', '追问芯片走槽位路径')

ok(FAST_PATH_SCORE_MARGIN >= 8, '快路径分差阈值存在')

ok(TOOL_NAMES.length >= 12, '领域工具不少于 12 个')
ok(TOOL_SCHEMAS.length === TOOL_NAMES.length, 'schema 与名称表对齐')
TOOL_NAMES.forEach((n) => {
  const schema = TOOL_SCHEMAS.find((s) => s.name === n)
  ok(!!schema && schema.parameters && schema.parameters.type === 'object', 'schema 完整: ' + n)
  ok(typeof schema.description === 'string' && schema.description.length > 8, 'description: ' + n)
})

ok(mapToolCallToIntent('search_launches', { mode: 'history' }) === 'history_list', 'search_launches history')
ok(mapToolCallToIntent('search_launches', { mode: 'upcoming' }) === 'launch_list', 'search_launches upcoming')
ok(mapToolCallToIntent('get_encyclopedia', { kind: 'rocket' }) === 'rocket_model', 'encyclopedia rocket')
ok(mapToolCallToIntent('get_starship', { topic: 'road' }) === 'road_closure', 'starship road')
ok(mapToolCallToIntent('get_me', { topic: 'badges' }) === 'badges', 'get_me badges')
ok(mapToolCallToIntent('navigate_feature', { feature: 'flight_demo' }) === 'flight_demo', 'navigate flight_demo')

const syn = buildSyntheticQuery('search_launches', { country: '中国', mode: 'upcoming' }, createEmptySession())
ok(/中国/.test(syn) && /即将发射/.test(syn) && !/casc/i.test(syn), '合成问句: ' + syn)

const facts = factsFromCards([
  { cardType: 'mission', name: 'Starlink 10-12', rocketName: 'Falcon 9', formattedTime: '明天' }
])
ok(/Starlink/.test(facts) && /Falcon 9/.test(facts), 'factsFromCards 含任务字段')

const merged = mergeCards([
  { cardType: 'mission', id: '1', name: 'A' },
  { cardType: 'mission', id: '1', name: 'A-dup' },
  { cardType: 'entry', id: 'x', title: 'B' }
])
ok(merged.length === 2, '卡片去重')

ok(toolEventName({ name: 'search_launches' }) === 'search_launches', 'toolEventName')
ok(/发射/.test(toolStatusLabel('search_launches')), '工具状态文案')

const mem = formatMemorySnapshot({
  rocketTypes: ['Falcon 9'],
  nextSubscribedName: 'Starlink 10-12',
  subscribedCount: 2
})
ok(/Falcon 9/.test(mem) && /Starlink/.test(mem), '记忆快照含偏好与订阅')
ok(/不要当发射时刻/.test(mem), '记忆快照含过期红线')

const chips = buildFollowupChips(sessionWith('launch_list', {}), [
  { cardType: 'launch_list', items: [] }
])
ok(chips.some((c) => /中国/.test(c.label) || /中国/.test(c.q)), '列表后追问含中国')

const missionChips = buildFollowupChips(sessionWith('mission_lookup', { keyword: '朱雀三号' }), [
  { cardType: 'mission', id: '1', name: '朱雀三号' }
])
ok(missionChips.some((c) => /提醒/.test(c.label) || /提醒/.test(c.q)), '任务卡后追问设提醒')

const next = pickNextSubscribed([
  { name: '过去', launchTime: '2020-01-01T00:00:00Z' },
  { name: '未来', launchTime: new Date(Date.now() + 86400000).toISOString() }
])
ok(next && next.name === '未来', '下一发订阅取未来场次')

const personal = buildPersonalizedShortcuts({
  nextSubscribedName: 'Starlink 10-12',
  rocketTypes: ['Falcon 9']
})
ok(personal.length >= 1 && personal[0].q.indexOf('Starlink') >= 0, '个性化欢迎芯片')

const mergedSession = mergeSessionFromPayload(createEmptySession(), {
  intent: 'launch_list',
  cards: [{ cardType: 'launch_list', listFilter: { country: '中国' }, items: [] }]
}, '接下来中国有哪些发射')
ok(mergedSession.lastIntent === 'launch_list', '会话写入 lastIntent')
ok(mergedSession.lastEntities.country === '中国', '会话写入国家槽')

if (failed) {
  console.error('\n' + failed + ' failed')
  process.exit(1)
}
console.log('\nall passed')
