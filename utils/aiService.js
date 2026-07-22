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
      const { fetchMainConfig } = require('./feature-flags.js')
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

const SYSTEM_PROMPT = `你是"空叉火星探索日志"微信小程序的AI太空助手，名叫「星问」。

【关于本小程序】
名称：空叉火星探索日志（SpaceX马斯克航天太空发射追踪）
功能：全球火箭发射实时追踪、倒计时、任务详情、航天新闻、直播、星链过境预报、天文日历、NASA数据等

【小程序功能导航 - 用户问"在哪里看/怎么用"时请据此引导】
1. 看直播：底部Tab「监控中心」→ 页面底部有"视频号直播"和"B站直播"入口
2. 星链过境：底部Tab「监控中心」→「星链过境预报」区块（需授权位置），可查看未来过境时间，还有"观测地图"和"AR观测"
3. 星链实时分布：底部Tab「监控中心」→「星链卫星实时分布」区块，可全屏查看
4. NASA每日天文图：通过页面右侧悬浮菜单(✦)→「天文日历」进入，顶部即为NASA APOD
5. 天文日历/天象：同上路径，页面下方有2026天象日历（流星雨、日食等），可设置提醒
6. 航天新闻/事件：底部Tab「事件」→ 有"即将发生"和"航天事件"两个栏目
7. 发射场地图：底部Tab「星舰进度」→ 顶部「发射场」按钮
8. 任务详情：首页点击任何任务卡片即可进入
9. 搜索：首页左上角搜索图标(⌕)，支持文本搜索和AI识图
10. 星舰进度：底部Tab「星舰进度」→ 星舰组合体进展、事件更新、封路信息
11. 空间站状态：底部Tab「监控中心」→「空间站实时状态」（ISS/天宫）
12. 火箭族谱：底部Tab「监控中心」→「全球可回收火箭族谱」，可查看每个助推器详情
13. 月愿计划：通过页面右侧悬浮菜单(✦)→「月愿计划」，可写心愿生成月球登机牌
14. 签到/成就：底部Tab「我的」→ 每日签到、成就徽章、竞猜战绩、每日挑战
15. NASA数据中心：通过页面右侧悬浮菜单(✦)→「NASA数据」，有火星车照片、地球事件、近地天体
16. 系外行星：通过页面右侧悬浮菜单(✦)→「系外行星」

【你的专业领域】
- SpaceX（猎鹰9、星舰Starship、星链Starlink、龙飞船Dragon）
- NASA（阿耳忒弥斯Artemis计划、火星探测、韦伯望远镜）
- 中国航天（天宫空间站、嫦娥计划、长征火箭、神舟飞船）
- 天文现象（流星雨、日食、行星冲日、超级月亮）
- 火箭技术、轨道力学、回收技术

【重要规则】
- 你没有联网能力，不要假装搜索或编造最新新闻
- 如果系统提供了发射任务数据，请严格基于这些数据回答发射时间等问题
- 如果没有相关数据且不确定，请诚实说"我暂时没有这个信息的最新数据，你可以在小程序首页查看最新发射列表"
- 不要编造具体日期、时间或事件细节
- 引导用户使用小程序功能时，用上面的导航信息

【回答要求】
1. 用简洁通俗的中文回答，避免过多术语
2. 关键数据用具体数字说明
3. 回答控制在200字以内
4. 必要时用类比帮助理解
5. 保持热情和科学严谨的平衡`

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

  const model = wx.cloud.extend.AI.createModel('hunyuan-v3')

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
  }

  const fullMessages = [
    { role: 'system', content: systemContent },
    ...messages
  ]

  try {
    const res = await model.streamText({
      data: {
        model: 'hy3-preview',
        messages: fullMessages,
        temperature: 0.7,
        max_tokens: 600
      }
    })

    let fullText = ''
    for await (const chunk of res.textStream) {
      fullText += chunk
      if (typeof onChunk === 'function') onChunk(fullText)
    }
    return fullText
  } catch (e) {
    try {
      const modelOpen = wx.cloud.extend.AI.createModel('hunyuan-open')
      const res = await modelOpen.streamText({
        data: {
          model: 'hunyuan-lite',
          messages: fullMessages,
          temperature: 0.7,
          max_tokens: 600
        }
      })

      let fullText = ''
      for await (const chunk of res.textStream) {
        fullText += chunk
        if (typeof onChunk === 'function') onChunk(fullText)
      }
      return fullText
    } catch (e2) {
      throw new Error('AI服务暂时不可用，请稍后再试')
    }
  }
}


const QUICK_QUESTIONS = [
  '星舰最新进展如何？',
  '今年有哪些流星雨值得看？',
  '猎鹰9号是怎么回收的？',
  '天宫空间站有多大？',
  '火星上能种菜吗？',
  '星链卫星为什么能看到？'
]

async function generateTextAdvanced(systemPrompt, userPrompt, options) {
  if (!options) options = {}
  var model = options.model || 'hy3-preview'
  var temperature = options.temperature != null ? options.temperature : 0.7
  var maxTokens = options.maxTokens || 1000
  var timeout = options.timeout || 60000
  var onProgress = options.onProgress || null

  if (!isAIAvailable()) throw new Error('AI功能不可用')

  var aiModel = null
  var useOpenProvider = false
  try { aiModel = wx.cloud.extend.AI.createModel('hunyuan-v3') } catch (e) {}
  if (!aiModel) try {
    aiModel = wx.cloud.extend.AI.createModel('hunyuan-open')
    useOpenProvider = true
  } catch (e) {}
  if (!aiModel) throw new Error('无法创建AI模型')

  var apiModel = useOpenProvider ? 'hunyuan-lite' : model

  var contentText = ''
  var reasoningText = ''
  var timeoutId
  var timedOut = false
  var streamRes = null

  try {
    var result = await Promise.race([
      (async function () {
        var res = await aiModel.streamText({
          data: {
            model: apiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: temperature,
            max_tokens: maxTokens
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
          // 尝试主动中断底层流（SDK 支持时）
          try {
            if (streamRes && typeof streamRes.abort === 'function') streamRes.abort()
          } catch (e) {}
          reject(new Error('AI请求超时'))
        }, timeout)
      })
    ])
    clearTimeout(timeoutId)
    return result
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

async function answerQuestion(question, contextData) {
  var systemPrompt = '你是一个专业的航天知识助手，专门回答关于火箭发射、航天任务、太空探索等相关问题。\n\n回答要求：\n1. 准确、专业但通俗易懂\n2. 如果涉及具体任务，优先使用提供的上下文信息\n3. 如果不知道答案，诚实说明\n4. 回答要简洁明了，控制在200字以内\n\n如果用户问的是关于具体任务的问题，请结合上下文信息回答。'
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
  answerQuestion,
  generateTextAdvanced,
  fetchAIChatEnabled,
  isAIChatEnabledSync,
  warmAIChatEnabledAsync
}
