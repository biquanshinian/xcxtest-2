/**
 * 星问「星舰下一飞出卡」闭环结构审计
 * node scripts/_audit_ai_chat_mission_card.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = 0

function assert(cond, msg) {
  if (cond) {
    console.log('OK', msg)
  } else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function main() {
  const json = JSON.parse(read('subpackages/shared/components/ai-chat/index.json'))
  assert(json.styleIsolation === 'apply-shared', 'ai-chat styleIsolation=apply-shared（glass-card）')

  const pageJson = JSON.parse(read('subpackages/shared/ai-chat.json'))
  assert(pageJson.navigationStyle === 'custom', '星问详情页 custom 导航')
  assert(!!pageJson.usingComponents && !!pageJson.usingComponents['ai-chat'], '详情页挂载 ai-chat')
  const pageJs = read('subpackages/shared/ai-chat.js')
  assert(pageJs.includes('onShareAppMessage') && pageJs.includes('onShareTimeline'), '详情页双端分享')
  assert(pageJs.includes('ROUTES.AI_CHAT') || pageJs.includes("AI_CHAT"), '分享 path 用 AI_CHAT')
  assert(pageJs.includes('enableAIChat') && pageJs.includes('failClosed'), '详情页门控 enableAIChat failClosed')
  assert(pageJs.includes('pageAllowed') || pageJs.includes('_guardAiChatPage'), '详情页未放行不挂载对话')
  const pageWxml = read('subpackages/shared/ai-chat.wxml')
  assert(pageWxml.includes('pageAllowed'), '详情页 wxml 受 pageAllowed 控制')
  const floatJsGate = read('subpackages/shared/components/nasa-float/index.js')
  assert(floatJsGate.includes("isFeatureEnabled('enableAIChat'") || floatJsGate.includes('isFeatureEnabled("enableAIChat"'), '圆盘入口也走 enableAIChat')
  const routes = read('utils/routes.js')
  assert(routes.includes("AI_CHAT: '/subpackages/shared/ai-chat'"), 'ROUTES.AI_CHAT')
  const floatJs = read('subpackages/shared/components/nasa-float/index.js')
  assert(floatJs.includes('ROUTES.AI_CHAT') || floatJs.includes("navigateTo(ROUTES.AI_CHAT)"), '圆盘改 navigateTo 详情页')
  assert(!floatJs.includes("selectComponent('#ai-chat')"), '圆盘不再依赖页内半屏组件')
  const chatCompJs = read('subpackages/shared/components/ai-chat/index.js')
  assert(chatCompJs.includes("mode: { type: String") || chatCompJs.includes("mode: {type: String"), 'ai-chat 支持 mode')
  assert(chatCompJs.includes('isPageMode') || chatCompJs.includes("_isPageMode"), 'ai-chat page 模式')

  const wxss = read('subpackages/shared/components/ai-chat/index.wxss')
  assert(wxss.includes('mission-card.wxss'), 'wxss 导入 styles/mission-card.wxss')
  assert(!/rgba\(120,\s*100,\s*255/.test(wxss) || !wxss.includes('ai-mission-card {'), '不再使用紫色自定义卡底')

  const wxml = read('subpackages/shared/components/ai-chat/index.wxml')
  assert(wxml.includes('glass-card'), 'wxml 使用 glass-card')
  assert(wxml.includes('mission-card'), 'wxml 使用 mission-card')
  assert(wxml.includes('mission-rocket-image'), 'wxml 使用 mission-rocket-image')
  assert(wxml.includes('data-id=') && wxml.includes('data-type='), '跳转用 data-id + data-type')
  assert(!wxml.includes('data-url='), '禁用 data-url（防 & 截断）')
  assert(wxml.includes('themeClass'), '面板挂 themeClass')
  assert(wxml.includes('onMissionCardRocketError'), '配置图 binderror 重试')
  assert(wxml.includes("card.cardType === 'launch_list'"), 'wxml 列表卡分支')
  assert(wxml.includes("card.cardType === 'starship_status'"), 'wxml 状态卡分支')
  assert(wxml.includes("card.cardType === 'launch_stats'"), 'wxml 统计卡分支')
  assert(wxml.includes("card.cardType === 'agency'"), 'wxml 发射商卡分支')
  assert(wxml.includes("card.cardType === 'entry'"), 'wxml 入口卡分支')
  assert(wxml.includes("card.cardType === 'mission_replay'"), 'wxml 回放卡分支')
  assert(wxml.includes('onEntryCardTap'), '入口卡点击')
  assert(wxml.includes('onMissionReplayCardTap'), '回放卡点击')
  assert(wxml.includes('onLaunchStatsCardTap'), '统计卡点击')
  assert(wxml.includes('onAgencyCardTap'), '发射商卡点击')

  const js = read('subpackages/shared/components/ai-chat/index.js')
  assert(js.includes('resolveRichChatPayload'), '统一富消息解析')
  assert(js.includes('onStarshipStatusTap'), '状态卡跳转')
  assert(js.includes('onLaunchListMoreTap'), '列表卡看更多')
  assert(js.includes('onEntryCardTap'), '入口卡门控跳转')
  assert(js.includes('gateCheck'), '入口卡门控')
  assert(js.includes('_skipTabBarRestore'), '跳转不闪 TabBar')
  assert(js.includes('_sendLock'), '发送防重入')
  assert(js.includes('buildMissionDetailUrl'), '详情 URL 构建')
  assert(js.includes('loadCloudMediaMap'), '预热 media map')
  assert(js.includes('_trackedStarshipLaunchId'), '对齐 tracked launch id')

  const rich = read('subpackages/shared/utils/ai-chat-rich.js')
  assert(rich.includes('resolveLaunchListCard'), '发射列表 resolve')
  assert(rich.includes('resolveStarshipStatusCard'), '星舰状态 resolve')
  assert(rich.includes('resolveFlightDemoEntryCard'), '飞行演示入口 resolve')
  assert(rich.includes('resolveVehicleTrackerEntryCard'), '在轨追踪入口 resolve')
  assert(rich.includes('resolveMissionSimEntryCard'), '指挥室入口 resolve')
  assert(rich.includes('resolveRoadClosureEntryCard'), '封路入口 resolve')
  assert(rich.includes('resolveStationEntryCard'), '空间站入口 resolve')
  assert(rich.includes('resolveMissionLookupCard'), '通用任务检索 resolve')
  assert(rich.includes('resolveMissionReplayCard'), '发射集锦回放 resolve')
  assert(rich.includes('resolveLaunchStatsCard'), '发射统计 resolve')
  assert(rich.includes('resolveAgencyLookupCard'), '发射商 resolve')
  assert(rich.includes('searchLaunchesByKeyword'), '云端 search 回退')
  assert(rich.includes('buildLaunchSearchQueries'), '云端查询词构建')
  assert(rich.includes('resolveStarshipProgressEntryCard'), '进展空数据回退入口')
  assert(rich.includes('resolveRichChatPayload'), '统一 payload')
  assert(rich.includes('ai-chat-rich-core'), '纯逻辑下沉 core')
  assert(rich.includes('resolveMissionRocketImage'), '复用 resolveMissionRocketImage')

  const core = read('subpackages/shared/utils/ai-chat-rich-core.js')
  assert(core.includes('matchLaunchListIntent'), '列表意图')
  assert(core.includes('matchLaunchStatsIntent'), '统计意图')
  assert(core.includes('matchAgencyIntent'), '发射商意图')
  assert(core.includes('matchStarshipStatusIntent'), '状态意图')
  assert(core.includes('matchFlightDemoIntent'), '飞行演示意图')
  assert(core.includes('matchVehicleTrackerIntent'), '在轨追踪意图')
  assert(core.includes('matchMissionSimIntent'), '指挥室意图')
  assert(core.includes('matchRoadClosureIntent'), '封路意图')
  assert(core.includes('matchStationIntent'), '空间站意图')
  assert(core.includes('matchMissionLookupIntent'), '任务检索意图')
  assert(core.includes('matchMissionReplayIntent'), '集锦回放意图')
  assert(core.includes('isBareStarshipProgressAsk'), '裸进展问法')
  assert(core.includes('pickBestMissionMatch'), '任务模糊匹配')
  assert(core.includes('buildLaunchSearchQueries'), '中英查询词')
  assert(core.includes('resolveAiChatRichIntent'), '意图路由')
  assert(core.includes('发射场'), '意图排除发射场')

  const listApi = read('utils/api-launch-list.js')
  assert(listApi.includes('searchLaunchesByKeyword'), 'api-launch-list 导出云端搜索')
  assert(listApi.includes("search: q") || listApi.includes('search: q'), 'LL2 search 参数')

  const svc = read('subpackages/shared/utils/aiService.js')
  assert(svc.includes('星舰下一次试飞是什么时候？'), '快捷：下一飞')
  assert(svc.includes('最新进展如何？') || svc.includes('星舰最新进展如何？'), '快捷：进展')
  assert(svc.includes('接下来有哪些发射？'), '快捷：列表')
  assert(svc.includes('今天中国发射了多少次') || svc.includes('全球发射'), '快捷：发射统计')
  assert(svc.includes('SpaceX') || svc.includes('发射商'), '快捷：发射商')
  assert(svc.includes('朱雀三号') || svc.includes('飞行剖面'), '快捷：任务检索或飞行演示')
  assert(svc.includes('在轨飞行器追踪'), '快捷：在轨追踪')
  assert(svc.includes('封路'), '快捷：封路')
  assert(svc.includes('空间站'), '快捷：空间站')
  assert(svc.includes('focusHint') && svc.includes('focusMission'), 'streamChat 注入聚焦任务')
  assert(svc.includes('QUICK_SHORTCUTS'), '横向快捷入口数据 QUICK_SHORTCUTS')
  assert(svc.includes("id: 'launch_stats'") && svc.includes("id: 'agency'"), '快捷入口含统计/发射商')
  // 星问 SYSTEM_PROMPT 成熟度：出卡协作 + 能力面，且无写死年份天象
  assert(svc.includes('界面已展示卡片') || svc.includes('出卡'), 'system prompt 含出卡协作规则')
  assert(svc.includes('60 天') || svc.includes('60天'), 'system prompt 含发射列表 60 天窗')
  assert(svc.includes('集锦回放') || svc.includes('发射集锦'), 'system prompt 含集锦回放能力')
  assert(!svc.includes('2026天象'), 'system prompt 不再写死 2026 天象')
  assert(svc.includes('勿假称联网') || svc.includes('不要假装'), 'answerQuestion/底座 对齐勿假联网')

  const chatJs = read('subpackages/shared/components/ai-chat/index.js')
  assert(chatJs.includes("kind === 'road_closure'"), '入口跳转含封路')
  assert(chatJs.includes("kind === 'station'"), '入口跳转含空间站')
  assert(chatJs.includes("kind === 'live_watch'"), '入口跳转含看直播')
  assert(chatJs.includes('isLiveEntryAllowed'), '直播卡走 enableLiveWatch 过审开关')
  assert(chatJs.includes("kind === 'starship_progress'"), '入口跳转含进度回退')
  assert(chatJs.includes('onLaunchStatsCardTap'), '统计卡跳转')
  assert(chatJs.includes('onAgencyCardTap'), '发射商卡跳转')
  assert(chatJs.includes('onMissionReplayCardTap'), '回放卡跳转')
  assert(chatJs.includes("gateCheck") && chatJs.includes('mission_replay'), '回放卡门控')
  assert(chatJs.includes('pendingEventVideo') && chatJs.includes('VIDEO_PLAYER'), '回放进播放页')
  assert(chatJs.includes('enableMissionReplay'), '回放过审开关')
  assert(wxss.includes('.ai-replay-card') && wxss.includes('.ai-replay-poster'), '回放卡样式')
  assert(chatJs.includes('GLOBAL_LAUNCH_STATS'), '统计详情路由')
  assert(chatJs.includes('AGENCY_DETAIL'), '发射商详情路由')
  assert(chatJs.includes('completedHint'), '传递已完成列表供检索')
  assert(chatJs.includes('ROAD_CLOSURE_DETAIL'), '封路详情路由')
  assert(chatJs.includes('STATION_DETAIL'), '空间站详情路由')
  assert(chatJs.includes('QUICK_SHORTCUTS') && chatJs.includes('quickShortcuts'), '组件挂载横向快捷')
  assert(chatJs.includes('virtualHost: true'), '详情页 virtualHost 撑满高度')
  assert(chatJs.includes('adjust-position') || wxml.includes('adjust-position'), '输入框关闭系统顶起')
  assert(chatJs.includes('_updateKeyboardLayout') && chatJs.includes('keyboardheight'), '键盘高度同步上收')

  // ── 回答震动反馈 ──
  const streamHapticLive = chatJs.includes('_tickStreamHaptic') && /_tickStreamHaptic[\s\S]*?type:\s*'light'/.test(chatJs)
  const streamHapticOff = /_tickStreamHaptic\(\)\s*\{\s*\}/.test(chatJs) || /流式吐字轻震：已停用/.test(chatJs)
  assert(streamHapticLive || streamHapticOff, '流式吐字轻震（启用或已停用空实现）')
  assert(
    streamHapticOff || /_lastStreamHapticAt[\s\S]*?<\s*220/.test(chatJs),
    '流式轻震约 220ms 节流（停用时可跳过）'
  )
  assert(chatJs.includes('_pulseCardHaptic') && /_pulseCardHaptic[\s\S]*?type:\s*'medium'/.test(chatJs), '抽卡落地中度震')
  assert(
    /streamChat\([\s\S]*?_tickStreamHaptic\(\)/.test(chatJs) &&
    /richCards\.length[\s\S]*?_pulseCardHaptic\(\)/.test(chatJs),
    '吐字/抽卡两条路径都接上震动'
  )

  // ── 键盘收放 + 贴底滚动（回归点：改动这几处会让最新消息看不见）──
  assert(
    wxml.includes('id="msg-bottom"') && wxml.includes('id="msg-bottom-alt"'),
    '双贴底锚点：scroll-into-view 写同一个 id 不会重新滚'
  )
  assert(chatJs.includes('_stickToBottom'), '流式输出与发送都走 _stickToBottom')
  assert(
    !/scrollTarget:\s*'msg-bottom'/.test(chatJs),
    '不再直接写死 scrollTarget: msg-bottom（会因值未变而不滚）'
  )
  assert(
    !/disabled="\{\{sending\}\}"/.test(wxml),
    '发送中不禁用输入框（disabled 会强制收起键盘，下一问要重新点）'
  )
  assert(wxml.includes('hold-keyboard'), 'hold-keyboard 保证点发送键不收键盘')
  const composerBeh = read('subpackages/shared/utils/composer-input-behavior.js')
  assert(
    /composer-input-behavior/.test(chatJs) && /behaviors:\s*\[[^\]]*composerInput/.test(chatJs),
    '键盘协议复用 composer-input-behavior'
  )
  assert(
    /_composerResetOnHide/.test(composerBeh) && /pageLifetimes:[\s\S]*?hide\(\)/.test(composerBeh),
    '离页清零键盘去抖状态'
  )
  assert(
    /_lastKbHeight = -1/.test(composerBeh),
    '离页重置 _lastKbHeight（否则回页首次弹键盘被去抖吞掉）'
  )
  assert(
    !/if\s*\(\s*isPageMode\s*\)\s*\{\s*setTimeout\(\s*\(\)\s*=>\s*this\.setData\(\s*\{\s*inputFocus:\s*true/
      .test(chatJs),
    '详情页不自动聚焦（防悬空）'
  )

  assert(wxml.includes('ai-shortcut-scroll') && wxml.includes('scroll-x'), '横向快捷 scroll-x')
  assert(wxml.includes('ai-shortcut-chip') && wxml.includes('quickShortcuts'), '横向快捷 chip 列表')
  assert(wxml.includes('查发射') && wxml.includes('回放'), '欢迎副文案点出查发射/回放')
  assert(wxml.includes('onInputKeyboardHeightChange'), 'input 键盘高度事件')
  assert(wxss.includes('.ai-shortcut-chip') && wxss.includes('.ai-messages'), '快捷/消息区样式存在')
  assert(/\.ai-messages\s*\{[\s\S]*?height:\s*0/.test(wxss), '消息区 height:0+flex 顶输入栏到底')

  const pageWxss = read('subpackages/shared/ai-chat.wxss')
  assert(pageWxss.includes('ai-chat-detail-body') && pageWxss.includes('ai-chat'), '详情页撑满宿主样式')

  // 磨砂导航要有内容在背后经过才成立：占位块移进 scroll-view，内容从屏顶起算
  assert(
    !/\.ai-chat-detail-page\s+\.top-nav-wrapper\s*\{[^}]*position:\s*(relative|static)/.test(pageWxss),
    '导航保持骨架的 fixed 磨砂条（进 flex 流会失去玻璃质感）'
  )
  assert(
    !/ai-chat-detail-body[^>]*padding-top/.test(pageWxml),
    '对话区不用 padding-top 把内容整体推到导航下方'
  )
  assert(
    /top-inset="\{\{navPlaceholderHeight\}\}"/.test(pageWxml),
    '宿主页把导航占位高传给 ai-chat'
  )
  assert(/topInset:\s*\{\s*type:\s*Number/.test(chatJs), '组件声明 topInset 属性')
  assert(
    /wx:if="\{\{topInset > 0\}\}"[^>]*height:\s*\{\{topInset\}\}px/.test(wxml),
    '导航占位块在消息 scroll-view 内（旧消息可穿过导航）'
  )
  assert(pageJs.includes('onKeyboardHeight') && pageJs.includes('keyboardHeight'), '宿主页键盘上收')

  const api = read('utils/api-launch-list.js')
  assert(/exports[\s\S]*isStarshipListItem|isStarshipListItem,/.test(api), 'isStarshipListItem 已导出')

  assert(fs.existsSync(path.join(root, 'scripts/_audit_ai_chat_rich_runtime.js')), '深度可运行态审计脚本存在')

  if (failed) {
    console.error('\n' + failed + ' failed')
    process.exit(1)
  }
  console.log('\nall green: structural audit passed')
}

main()
