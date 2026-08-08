/**
 * AI 太空助手服务
 * 基于微信云开发 AI+ 混元大模型
 *
 * 小程序成长计划：provider 使用 hunyuan-v3，模型名 hy3-preview（原 hunyuan-exp 将下线）
 * 参考：https://docs.cloudbase.net/ai/ai-inspire-plan-upgrade
 */


let _remoteAIEnabled = null
let _aiConfigSyncReadAttempted = false
let _aiConfigCacheEntry = undefined // undefined=未读过；null=已读且无有效缓存
let _aiConfigFetchInFlight = null
/** 本地总开关（与云端 global_config.enableAIChat 分工：远端控制入口展示，此为代码级开关） */
const AI_ENABLED = true
const AI_CONFIG_CACHE_KEY = '_ai_chat_enabled_cache'
const AI_CONFIG_CACHE_TTL = 5 * 60 * 1000

/** 同一进程内 _ai_chat_enabled_cache 最多同步读 1 次（fetch 与 sync 路径共享） */
function _readAIConfigCacheOnce() {
  if (_aiConfigCacheEntry !== undefined) return _aiConfigCacheEntry
  _aiConfigSyncReadAttempted = true
  try {
    const cached = wx.getStorageSync(AI_CONFIG_CACHE_KEY)
    _aiConfigCacheEntry = cached || null
  } catch (e) {
    _aiConfigCacheEntry = null
  }
  return _aiConfigCacheEntry
}

async function fetchAIChatEnabled() {
  const cached = _readAIConfigCacheOnce()
  if (cached && Date.now() - cached.ts < AI_CONFIG_CACHE_TTL) {
    _remoteAIEnabled = cached.enabled
    return cached.enabled
  }

  // 并发调用共享同一次云查询
  if (_aiConfigFetchInFlight) return _aiConfigFetchInFlight

  _aiConfigFetchInFlight = (async () => {
    try {
      // 走 feature-flags 的 global_config/main 共享缓存（5 分钟 + inflight 去重），
      // 与其他全局开关共用同一次读库
      const { fetchMainConfig } = require('../../../utils/feature-flags.js')
      const cfg = await fetchMainConfig()
      if (!cfg || !cfg._id) {
        // 读库失败（fetchMainConfig 内部吞错返回 {}）：沿用旧的失败语义，默认放开且不写缓存
        if (_remoteAIEnabled === null) _remoteAIEnabled = true
        return _remoteAIEnabled
      }
      const enabled = cfg.enableAIChat !== false
      _remoteAIEnabled = enabled
      const entry = { enabled, ts: Date.now() }
      _aiConfigCacheEntry = entry
      try {
        wx.setStorage({ key: AI_CONFIG_CACHE_KEY, data: entry, fail: () => {} })
      } catch (e) {}
      return enabled
    } catch (e) {
      if (_remoteAIEnabled === null) _remoteAIEnabled = true
      return _remoteAIEnabled
    } finally {
      _aiConfigFetchInFlight = null
    }
  })()
  return _aiConfigFetchInFlight
}

function isAIChatEnabledSync() {
  if (_remoteAIEnabled !== null) return _remoteAIEnabled !== false
  if (_aiConfigSyncReadAttempted) return true
  const cached = _readAIConfigCacheOnce()
  if (cached && Date.now() - cached.ts < AI_CONFIG_CACHE_TTL) {
    _remoteAIEnabled = cached.enabled
  }
  return _remoteAIEnabled !== false
}

/** 首屏后异步预热 AI 开关缓存 */
function warmAIChatEnabledAsync() {
  if (_remoteAIEnabled !== null || _aiConfigCacheEntry !== undefined) return
  wx.getStorage({
    key: AI_CONFIG_CACHE_KEY,
    success: function (res) {
      const cached = res.data
      if (_aiConfigCacheEntry === undefined) _aiConfigCacheEntry = cached || null
      if (cached && Date.now() - cached.ts < AI_CONFIG_CACHE_TTL) {
        _remoteAIEnabled = cached.enabled
      }
    }
  })
}

const SYSTEM_PROMPT = `你是「空叉火星探索日志」微信小程序的内置航天助手，名叫「星问」。
你可结合本轮系统注入的实时数据与界面下方卡片回答；你没有独立联网搜索能力，不要假装刚搜到新闻。

【关于本小程序】
全球火箭发射追踪与倒计时、任务详情、中国/全球发射日程与统计、发射商图鉴、星舰进展与封路、发射集锦回放、飞行剖面与任务指挥室、在轨飞行器追踪、空间站状态、星链过境与分布、航天事件、天文日历与 NASA 数据、火箭观礼服务等。

【星问能直接帮你做的事】
用自然语言提问即可（不要向用户解释内部技术名）。常见能力：
- 查具体任务/火箭（如朱雀三号、猎鹰9、星链）
- 星舰下一次试飞、星舰组合体/进展
- 即将发射列表：可按国家（中国/美国等）、发射场（文昌等）、发射商（SpaceX 等）筛选；日程窗口约未来 60 天
- 发射次数统计（今天/今年、中国或全球等）
- 发射商介绍（SpaceX、中国航天科技集团等）
- 火箭型号参数（如「猎鹰9多高」「长征五号运力多少」）、发射场资料（文昌、39A 工位等）、飞船资料（神舟、龙飞船乘员与尺寸）
- 助推器战绩（按编号，如 B1067 飞了几次）、回收与复用总览（成功率、复用排行）
- 星舰在建硬件（如 S38 在哪、B16 什么状态）、Artemis II 任务面板
- 星链：过境预报（需授权位置）与星座实时分布（在轨颗数以页面为准，不要凭记忆报数）
- 火箭观礼服务（如「去哪看发射」「文昌观礼」「现场观礼怎么参加」）：出最匹配的火箭观礼入口卡（按发射场/最近任务匹配商家场次），点卡片进入观礼服务
- 我订阅的发射提醒、发射竞猜、我的航天年度回顾
- NASA 每日天文图、天象日历（流星雨/日月食）、航天事件与新闻
- 发射集锦回放、飞行剖面演示、星舰任务指挥室、在轨飞行器追踪、基地封路、空间站实时状态
若本轮已展示可点击卡片：优先用一两句话引导用户点击下方卡片，再补充关键信息。
参数类问题（尺寸/运力/推力/乘员/复用次数）只能用本轮注入的卡片数据作答，缺失字段直说暂无，绝不凭记忆报数字。
观礼类问题统一引导点击下方「火箭观礼」卡片；场次时间、地点、费用与规则以进入页面后为准，禁止编造其他观礼点坐标、票价或开放时间。

【小程序导航速查 - 问"在哪看/怎么用"时据此指路】
- 首页：发射倒计时与列表；左上角搜索（文本/AI 识图）；点任务卡进详情
- 监控中心：视频号/B站直播、星链过境（含观测地图/AR）、星链实时分布、空间站状态、可回收火箭族谱、在轨追踪入口
- 星舰进度：星舰硬件设施、事件更新、封路通知、发射场/Starbase 地图
- 事件：即将发生与航天事件
- 我的：签到、成就、竞猜、每日挑战、星际通行证（会员）、火箭观礼
- 右侧悬浮菜单(✦)：天文日历（含 NASA 每日天文图与当年天象）、NASA 数据、系外行星、月愿计划等
- 全球发射统计、发射商图鉴：可从星问统计卡/发射商卡进入，或在监控相关入口查找

【专业领域】
SpaceX（猎鹰9、星舰、星链、龙飞船）、中国航天（长征、神舟、天宫、嫦娥及民营火箭）、NASA/国际任务、天文现象、火箭与轨道基础科普。语气中性、全球向，勿只当成 SpaceX 粉圈助手。

【硬性规则】
1. 有系统注入的任务/列表/统计/状态数据时，严格按数据回答；时间若为 UTC 请转为北京时间(UTC+8)。
2. 若本轮标注「界面已展示卡片」或注入了聚焦任务/出卡说明：匹配已成功。禁止说「未匹配到」「找不到」「没有相关数据」「暂时没有」；必须引导点击下方卡片。上方短列表未出现某任务，不代表未匹配。
3. 仅当未注入相关数据且未出卡时，才如实说数据暂无，并指路首页发射列表、对应详情页或上述导航；勿编造发射时间、次数、视频内容、轨道参数、封路时段、火箭尺寸运力、飞船乘员数、助推器复用次数。
4. 不要编造最新突发新闻；会员/广告次数规则不主动推销，被问到再简要说明。
5. 指路时用上面的导航信息，表述通俗。

【回答风格】
简洁通俗中文，控制在 200 字以内；关键数据用具体数字；可点卡时先引导再补充；热情与严谨并重，少空话。`

function isAIAvailable() {
  if (!AI_ENABLED) return false
  try {
    return !!(wx.cloud && wx.cloud.extend && wx.cloud.extend.AI && wx.cloud.extend.AI.createModel)
  } catch (e) {
    return false
  }
}

async function streamChat(messages, onChunk, launchContext) {
  if (!isAIAvailable()) {
    throw new Error('AI功能不可用')
  }

  let systemContent = SYSTEM_PROMPT
  if (launchContext && typeof launchContext === 'object') {
    systemContent += '\n\n【本小程序实时数据 - 严格基于以下数据回答，不要编造】\n'

    if (launchContext.countdown) {
      const c = launchContext.countdown
      systemContent += '\n── 当前倒计时任务（最近一次发射） ──'
      systemContent += `\n任务：${c.name}`
      if (c.rocketName) systemContent += `\n火箭：${c.rocketName}`
      if (c.launchTime) systemContent += `\n发射时间(UTC)：${c.launchTime}`
      if (c.launchAgency) systemContent += `\n发射商：${c.launchAgency}`
      if (c.launchSite) systemContent += `\n地点：${c.launchSite}`
      if (c.status) systemContent += `\n状态：${c.status}`
    }

    if (launchContext.upcoming && launchContext.upcoming.length > 0) {
      systemContent += '\n\n── 即将发射的任务 ──'
      launchContext.upcoming.forEach((m, i) => {
        systemContent += `\n${i + 1}. ${m.name || '未知'}`
        if (m.rocketName) systemContent += ` | ${m.rocketName}`
        if (m.launchTime) systemContent += ` | ${m.launchTime}`
        if (m.launchAgency) systemContent += ` | ${m.launchAgency}`
        if (m.status) systemContent += ` | ${m.status}`
      })
    }

    if (launchContext.completed && launchContext.completed.length > 0) {
      systemContent += '\n\n── 最近完成的任务 ──'
      launchContext.completed.forEach((m, i) => {
        systemContent += `\n${i + 1}. ${m.name || '未知'}`
        if (m.rocketName) systemContent += ` | ${m.rocketName}`
        if (m.launchTime) systemContent += ` | ${m.launchTime}`
        if (m.status) systemContent += ` | ${m.status}`
      })
    }

    systemContent += '\n\n注意：以上时间为UTC，回答用户时转换为北京时间(UTC+8)。'
    if (launchContext.uiCardReady) {
      systemContent += '\n\n【界面出卡硬性规则】下方界面已展示可点击卡片（匹配已成功）。禁止说「未匹配到」「找不到」「没有相关数据」「暂时没有」等否定匹配的话；必须引导用户点击下方卡片。上方列表未列出某任务，不代表未匹配。'
    }
    if (launchContext.focusHint) {
      systemContent += '\n\n' + launchContext.focusHint
    }
    if (launchContext.focusMission) {
      const f = launchContext.focusMission
      systemContent += '\n── 用户当前聚焦的任务（优先据此回答）──'
      systemContent += `\n任务：${f.name || '未知'}`
      if (f.detailType === 'completed') systemContent += '\n归属：已完成的历史发射（用过去时描述，不要说成即将发射）'
      else if (f.detailType === 'upcoming') systemContent += '\n归属：尚未发射（用将来时描述）'
      if (f.rocketName) systemContent += `\n火箭：${f.rocketName}`
      if (f.launchTime) systemContent += `\n发射时间：${f.launchTime}`
      if (f.launchAgency) systemContent += `\n发射商：${f.launchAgency}`
      if (f.launchSite) systemContent += `\n地点：${f.launchSite}`
      if (f.status) systemContent += `\n状态：${f.status}`
    }
  }

  const fullMessages = [
    { role: 'system', content: systemContent },
    ...messages
  ]

  // 与 generateTextAdvanced / 云函数侧同一条 provider 兜底链
  for (const entry of buildAiProviderChain('hy3-preview')) {
    let model = null
    try {
      model = wx.cloud.extend.AI.createModel(entry.provider)
    } catch (e) {
      console.warn('[ai-chat] createModel 失败 (' + entry.provider + '):', (e && e.message) || e)
    }
    if (!model) continue

    let fullText = ''
    try {
      const res = await model.streamText({
        data: {
          model: entry.model,
          messages: fullMessages,
          temperature: 0.7,
          max_tokens: 600
        }
      })
      for await (const chunk of res.textStream) {
        fullText += chunk
        if (typeof onChunk === 'function') onChunk(fullText)
      }
      if (fullText) return fullText
    } catch (e) {
      console.warn('[ai-chat] streamText 失败 (' + entry.provider + '/' + entry.model + '):', (e && e.message) || e)
      // 已经吐字后再换一家会把界面上的回答清空重来，不如把已生成的内容交出去
      if (fullText) return fullText
    }
  }
  throw new Error('AI服务暂时不可用，请稍后再试')
}


const QUICK_QUESTIONS = [
  '星舰下一次试飞是什么时候？',
  '星舰组合体最新进展如何？',
  '接下来有哪些发射？',
  '今天中国发射了多少次？',
  'SpaceX是什么公司？',
  '朱雀三号什么时候发射？',
  '看看飞行剖面演示',
  '打开在轨飞行器追踪',
  '星舰基地封路了吗',
  '看看空间站实时状态',
  '在哪看发射直播？',
  '猎鹰9号火箭多高？',
  '文昌发射场在哪？',
  '神舟飞船能坐几人？',
  'B1067飞了几次？',
  '我订阅了哪些发射？',
  '今天的天文图片',
  '最近有什么流星雨？',
  '今晚能看到星链吗？',
  '去哪看火箭发射？',
  '猎鹰9回收成功率多少？',
  'S38在哪？',
  '阿尔忒弥斯任务进展'
]

/**
 * 输入栏上方横向快捷入口（对应富消息跳转卡意图，文案精简）
 * requireWatchParty：火箭观礼受过审开关 enableWatchParty 控制，
 * ai-chat 组件默认过滤该项、开关确认开启后才渲染（与我的页/详情页入口同显隐）。
 * icon：观礼入口统一图标（与我的页/详情页入口同图），组件渲染时经 icon-cache 解析。
 */
const QUICK_SHORTCUTS = [
  {
    id: 'watch_party',
    label: '火箭观礼',
    q: '怎么预约火箭观礼？',
    requireWatchParty: true,
    icon: require('../../../utils/watch-party-feature.js').WATCH_PARTY_ICON
  },
  { id: 'agency_casc', label: '中国航天', q: '中国航天科技集团' },
  { id: 'starship_next', label: '星舰试飞', q: '星舰下一次试飞是什么时候？' },
  { id: 'launch_list', label: '即将发射', q: '接下来有哪些发射？' },
  { id: 'live_watch', label: '看直播', q: '在哪看发射直播？' },
  { id: 'launch_stats', label: '发射统计', q: '今天中国发射了多少次？' },
  { id: 'agency', label: 'SpaceX', q: 'SpaceX是什么公司？' },
  { id: 'starship_status', label: '星舰组合体', q: '星舰组合体最新进展如何？' },
  { id: 'mission_lookup', label: '查任务', q: '朱雀三号什么时候发射？' },
  { id: 'flight_demo', label: '飞行剖面', q: '看看飞行剖面演示' },
  { id: 'vehicle_tracker', label: '在轨追踪', q: '打开在轨飞行器追踪' },
  { id: 'road_closure', label: '基地封路', q: '星舰基地封路了吗' },
  { id: 'station', label: '空间站', q: '看看空间站实时状态' },
  { id: 'rocket_model', label: '火箭参数', q: '猎鹰9号火箭多高？' },
  { id: 'launch_site', label: '发射场', q: '文昌发射场在哪？' },
  { id: 'spacecraft', label: '飞船', q: '神舟飞船能坐几人？' },
  { id: 'booster', label: '助推器', q: 'B1067飞了几次？' },
  { id: 'my_launches', label: '我的提醒', q: '我订阅了哪些发射？' },
  { id: 'apod', label: '天文图', q: '今天的天文图片' },
  { id: 'astro_calendar', label: '天象', q: '最近有什么流星雨？' },
  { id: 'starlink_pass', label: '星链过境', q: '今晚能看到星链吗？' },
  { id: 'starlink_map', label: '星链分布', q: '看看星链实时分布' },
  { id: 'recovery_stats', label: '回收统计', q: '猎鹰9回收成功率多少？' },
  { id: 'starship_hardware', label: '星舰硬件', q: 'S38在哪？' },
  { id: 'artemis', label: 'Artemis', q: '阿尔忒弥斯任务进展' }
]

/**
 * provider 兜底链：cloudbase 是云开发 AI+ 的官方入口，hunyuan-v3 是成长计划旧入口
 * （部分环境已不再解析），hunyuan-open + hunyuan-lite 保底。
 * 与云函数侧 ll2Query/translate.js、syncSpaceXTweets 的顺序保持一致。
 */
function buildAiProviderChain(preferredModel) {
  return [
    { provider: 'cloudbase', model: preferredModel },
    { provider: 'hunyuan-v3', model: preferredModel },
    { provider: 'hunyuan-open', model: 'hunyuan-lite' }
  ]
}

const AI_TIMEOUT_MESSAGE = 'AI请求超时'

/** 单个 provider 的一次流式请求；超时会主动中断底层流 */
function streamTextOnce(aiModel, apiModel, payload, timeout, onProgress) {
  var contentText = ''
  var reasoningText = ''
  var timeoutId
  var timedOut = false
  var streamRes = null

  var race = Promise.race([
    (async function () {
      var res = await aiModel.streamText({
        data: {
          model: apiModel,
          messages: payload.messages,
          temperature: payload.temperature,
          max_tokens: payload.maxTokens
        }
      })
      streamRes = res

      for await (var event of res.eventStream) {
        // 超时后终止消费：否则 Promise.race 已 reject，流仍在后台拉数据耗流量
        if (timedOut) break
        if (event.data === '[DONE]') break
        if (!event.data || typeof event.data !== 'string') continue
        try {
          var parsed = JSON.parse(event.data)
          var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
          if (!delta) continue
          if (typeof delta.content === 'string' && delta.content) {
            contentText += delta.content
            if (onProgress && !timedOut) onProgress(contentText)
          }
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            reasoningText += delta.reasoning_content
          }
        } catch (e) {}
      }

      var finalText = contentText.trim() || reasoningText.trim()
      if (!finalText) throw new Error('AI返回格式异常：未获取到有效文本')
      return finalText
    })(),
    new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        timedOut = true
        try {
          if (streamRes && typeof streamRes.abort === 'function') streamRes.abort()
        } catch (e) {}
        reject(new Error(AI_TIMEOUT_MESSAGE))
      }, timeout)
    })
  ])

  return race.then(
    function (text) { clearTimeout(timeoutId); return text },
    function (error) { clearTimeout(timeoutId); throw error }
  )
}

async function generateTextAdvanced(systemPrompt, userPrompt, options) {
  if (!options) options = {}
  var preferredModel = options.model || 'hy3-preview'
  var timeout = options.timeout || 60000
  var onProgress = options.onProgress || null
  var payload = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: options.temperature != null ? options.temperature : 0.7,
    maxTokens: options.maxTokens || 1000
  }

  if (!isAIAvailable()) throw new Error('AI功能不可用')

  var chain = buildAiProviderChain(preferredModel)
  var lastError = null
  for (var i = 0; i < chain.length; i++) {
    var entry = chain[i]
    var aiModel = null
    try {
      aiModel = wx.cloud.extend.AI.createModel(entry.provider)
    } catch (e) {
      lastError = e
    }
    if (!aiModel) continue
    try {
      return await streamTextOnce(aiModel, entry.model, payload, timeout, onProgress)
    } catch (error) {
      lastError = error
      // 超时说明这次请求本身慢，不是这家 provider 不可用；再换一家只会把等待翻倍
      if (error && error.message === AI_TIMEOUT_MESSAGE) throw error
    }
  }
  throw lastError || new Error('无法创建AI模型')
}

async function answerQuestion(question, contextData) {
  var systemPrompt = '你是「空叉火星探索日志」小程序助手「星问」的简答模式。\n规则：\n1. 严格优先使用提供的任务上下文，勿假称联网搜索\n2. 有明确任务信息时据此回答；不确定则诚实说明，勿编造发射时间或细节\n3. 若语境提到界面有卡片/入口，引导用户点击查看，勿说未匹配\n4. 简洁通俗中文，控制在200字以内'
  var userPrompt = '用户问题：' + question
  if (contextData) {
    userPrompt += '\n\n当前任务上下文信息：\n'
    if (contextData.missionName) userPrompt += '任务名称：' + contextData.missionName + '\n'
    if (contextData.rocketName) userPrompt += '火箭型号：' + contextData.rocketName + '\n'
    if (contextData.launchAgency) userPrompt += '发射商：' + contextData.launchAgency + '\n'
    if (contextData.launchSite) userPrompt += '发射地点：' + contextData.launchSite + '\n'
    if (contextData.launchTime) userPrompt += '发射时间：' + contextData.launchTime + '\n'
    if (contextData._sxReturnSite) userPrompt += '回收方式（SpaceX官方）：' + contextData._sxReturnSite + '\n'
    if (contextData._sxMissionType) userPrompt += '任务类型（SpaceX官方）：' + contextData._sxMissionType + '\n'
    if (contextData._sxDirectToCell) userPrompt += '该任务携带手机直连(Direct-to-Cell)星链卫星\n'
    if (contextData._sxEndDate) userPrompt += '任务预计结束日期：' + contextData._sxEndDate + '\n'
    if (contextData._sxIsLive) userPrompt += '当前SpaceX官方正在直播此任务\n'
    if (contextData._extraContext) userPrompt += '\n参考数据：\n' + contextData._extraContext + '\n'
  }
  return await generateTextAdvanced(systemPrompt, userPrompt, {
    model: 'hy3-preview',
    temperature: 0.6,
    maxTokens: 500
  })
}

module.exports = {
  isAIAvailable,
  streamChat,
  QUICK_QUESTIONS,
  QUICK_SHORTCUTS,
  answerQuestion,
  generateTextAdvanced,
  fetchAIChatEnabled,
  isAIChatEnabledSync,
  warmAIChatEnabledAsync
}
