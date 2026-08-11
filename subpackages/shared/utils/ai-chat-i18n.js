/**
 * 星问 AI 出卡 / 欢迎区 / 快捷入口壳文案（随 contentLang zh|en）
 * 与 launchCardUiText（发射列表卡）分工：本模块只管星问 UI 壳。
 */
const { isContentLangEn } = require('../../../utils/locale.js')

function fill(template, vars) {
  if (!vars) return template
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (
    vars[k] != null ? String(vars[k]) : ''
  ))
}

/** @param {string} key @param {Record<string, string|number>} [vars] */
function aiChatUiText(key, vars) {
  const en = isContentLangEn()
  const map = {
    // 欢迎 / 壳
    welcomeTitle: en ? 'Hi, I’m Xingwen' : '你好，我是星问',
    welcomeDesc: en
      ? 'Ask about launches, replays, stats, flight profiles, orbital tracking, and more.'
      : '查发射、看回放与统计，或打开飞行剖面、在轨追踪等互动工具——有航天问题都可以问我。',
    panelTitle: en ? '✦ Xingwen' : '✦ 星问',
    panelSubtitle: en ? 'Space AI assistant' : 'AI太空助手',
    pageNavTitle: en ? 'Xingwen' : '星问',
    pageAiOff: en ? 'Xingwen AI is unavailable' : '星问AI暂未开放',
    shareTitleDefault: en
      ? 'Xingwen — ask me anything about space'
      : '星问 — 有太空问题，问我就对了',
    shareTitlePrefix: en ? 'Xingwen: ' : '星问：',
    disclaimer: en
      ? 'Content is AI-generated for reference only and is not professional advice.'
      : '本服务由人工智能(AI)生成内容，结果仅供参考，不代表专业意见',
    thinkingPlaceholder: en ? 'Xingwen is thinking…' : '星问正在思考...',
    seeMoreOnHome: en ? 'See more on Home ›' : '查看首页更多 ›',
    seeMoreHistory: en ? 'Search more history ›' : '搜索更多历史 ›',
    retry: en ? 'Retry' : '重试',
    tapForDetail: en ? 'Tap for details' : '点击查看详情',
    timesSuffix: en ? '×{n}' : '{n} 次',
    drawing: en ? 'Drawing…' : '抽取中…',
    invitation: en ? 'Invite' : '邀请函',
    watchPartyBrand: en ? 'Rocket Watch Party' : '火箭观礼',
    pendingAnnounce: en ? 'TBD' : '待公布',
    superHeavyBooster: en ? 'Super Heavy' : '超重助推器',
    starshipShip: en ? 'Starship' : '星舰飞船',
    flightChecklist: en
      ? 'Flight readiness: {done}/{total} done'
      : '飞行准备清单：{done}/{total} 项完成',
    enterStarshipProgress: en ? 'Open Starship Progress ›' : '进入星舰进度 ›',
    statsTotal: en ? 'Total' : '总发射',
    statsSuccess: en ? 'Success' : '成功',
    statsFailure: en ? 'Failure' : '失败',
    statusPendingUpdate: en ? 'Status pending' : '状态待更新',
    starshipStackTitle: en ? 'Next Starship stack' : '星舰下一飞组合体',
    viewDetailsCta: en ? 'View details ›' : '查看详情 ›',
    enterDetailCta: en ? 'Open details ›' : '进入详情 ›',
    openMonitorCta: en ? 'Open Monitor ›' : '打开监控中心 ›',

    // toast / errors
    toastAiOff: en ? 'AI is temporarily unavailable' : 'AI功能暂未开放',
    toastReplayOff: en ? 'Mission replay is unavailable' : '发射回放暂未开放',
    toastWatchOff: en ? 'Watch party is unavailable' : '观礼服务暂未开放',
    toastSimOff: en ? 'Mission Control is unavailable' : '任务指挥室暂未开放',
    toastDemoOff: en ? 'Flight demo is unavailable' : '飞行演示暂未开放',
    toastLiveOff: en ? 'Live stream is unavailable' : '直播入口暂未开放',
    toastMerchantOff: en ? 'Merchant onboarding is unavailable' : '商家入驻暂未开放',
    toastOpenFail: en ? 'Failed to open' : '打开失败',
    gateGeneric: en ? 'This feature' : '该功能',
    errAiUnavailable: en ? 'AI is unavailable' : 'AI功能不可用',
    errAiBusy: en ? 'AI is temporarily busy. Please try again later.' : 'AI服务暂时不可用，请稍后再试',
    errDefaultReply: en ? 'Sorry, I can’t answer right now. Please try again later.' : '抱歉，我暂时无法回答，请稍后再试。',

    // 国家（展示用；筛选匹配仍用中文 key）
    countryGlobal: en ? 'Global' : '全球',
    countryChina: en ? 'China' : '中国',
    countryUSA: en ? 'United States' : '美国',
    countryRussia: en ? 'Russia' : '俄罗斯',
    countryIndia: en ? 'India' : '印度',
    countryJapan: en ? 'Japan' : '日本',
    countryKorea: en ? 'South Korea' : '韩国',
    countryFrance: en ? 'France' : '法国',
    countryUK: en ? 'United Kingdom' : '英国',
    countryIsrael: en ? 'Israel' : '以色列',
    countryAustralia: en ? 'Australia' : '澳大利亚',

    // 发射场展示
    site_wenchang: en ? 'Wenchang' : '文昌',
    site_jiuquan: en ? 'Jiuquan' : '酒泉',
    site_xichang: en ? 'Xichang' : '西昌',
    site_taiyuan: en ? 'Taiyuan' : '太原',
    site_starbase: 'Starbase',
    site_lc39a: 'LC-39A',
    site_slc40: 'SLC-40',
    site_slc4e: 'SLC-4E',
    site_kourou: en ? 'Kourou' : '库鲁',
    site_baikonur: en ? 'Baikonur' : '拜科努尔',
    site_mahia: en ? 'Mahia' : '马希亚',

    // 时间范围
    scopeToday: en ? 'Today' : '今日',
    scopeWeek: en ? 'This week' : '本周',
    scopeMonth: en ? 'This month' : '本月',
    scopeThisYear: en ? 'This year' : '本年度',
    scopeYear: en ? '{year}' : '{year} 年',

    // 商家抽卡
    mgachaBackTitle: en ? 'Merchant invite' : '商家入驻邀请',
    mgachaBackEn: 'MERCHANT INVITATION',
    mgachaBackHint: en ? 'Tap to draw' : '点击抽卡',
    mgachaTitle: en ? 'Watch Party partner invite' : '观礼合作商家邀请函',
    mgachaPerk1: en ? 'Free to join · no platform fee' : '免费入驻 · 无平台费用',
    mgachaPerk2: en ? 'Create sessions on your phone' : '手机自建观礼场次',
    mgachaPerk3: en ? 'Launch traffic · direct booking' : '发射客流 · 预约直达',
    mgachaPerk4: en ? 'On-site draws · big-screen play' : '现场抽奖 · 大屏互动',
    mgachaCta: en ? 'Join now — fill the form ›' : '立即入驻，填表即开通 ›',
    mgachaFoot: en ? 'Tap the card to apply' : '点击卡片进入入驻申请',
    mgachaSuggested: en
      ? 'Nice timing — Watch Party partner onboarding is open. Here’s a draw for your invite: tap the card back below, flip it, then tap again to open the application.'
      : '好眼光！观礼合作商家入驻现已开放，送你一次专属抽卡机会——点击下方卡背抽出你的入驻邀请函，翻开后再点一下即可进入申请页，填写资料马上开通。',

    // 回放 suggested
    replaySuggestedReady: en
      ? 'Found the highlight reel for “{name}”. Tap the card below to watch.'
      : '已为你找到「{name}」的发射集锦回放，点击下方卡片即可观看。',
    replaySuggestedPending: en
      ? 'Located “{name}”. The online reel isn’t ready yet — tap the card to open mission details for replay.'
      : '已定位到「{name}」。在线集锦暂未就绪，可点击下方卡片打开任务详情查看回放入口。',

    // 入口卡 / 通用
    flightDemoTitle: en ? 'Flight profile demo' : '飞行剖面演示',
    flightDemoDescLinked: en
      ? 'Linked to “{name}” · LL2 timeline animation'
      : '关联「{name}」· LL2 时间线动画演示',
    flightDemoDesc: en
      ? 'Replay the flight profile along the mission timeline'
      : '按任务时间线回放飞行剖面 · 双级遥测示意',
    flightDemoCta: en ? 'Open demo ›' : '进入演示 ›',
    vehicleTrackerTitle: en ? 'SpaceX vehicle tracker' : 'SpaceX 在轨飞行器追踪',
    vehicleTrackerDesc: en
      ? 'Live telemetry on a draggable 3D globe for Starship & Dragon'
      : '官网同源遥测 · 可拖动 3D 地球实时定位在飞星舰与龙飞船',
    vehicleTrackerCta: en ? 'Open tracker ›' : '进入追踪 ›',
    vehicleTrackerGate: en ? 'Orbital vehicle tracker' : '在轨飞行器追踪',
    missionSimTitle: en ? 'Starship Mission Control' : '星舰任务指挥室',
    missionSimDesc: en
      ? 'Fly as Flight Director: polls, weather tradeoffs, chopstick catch calls'
      : '以飞行总监视角完成一次发射：席位轮询、天气权衡、筷子捕获决策',
    missionSimCta: en ? 'Enter Mission Control ›' : '进入指挥室 ›',
    starshipProgressTitle: en ? 'Starship Progress' : '星舰进度',
    starshipProgressDesc: en
      ? 'Hardware, event updates, and road closures'
      : '星舰硬件设施、事件更新与封路提醒 · 进入进度页查看最新动态',
    starshipProgressCta: en ? 'Open Starship Progress ›' : '打开星舰进度 ›',
    highlightReel: en ? 'Highlights' : '集锦回放',
    replayEntry: en ? 'Replay entry' : '回放入口',
    launchMission: en ? 'Launch' : '发射任务',
    replayTitle: en ? '{name} · Highlights' : '{name} · 集锦回放',
    replayDescPending: en
      ? 'Online reel not ready — open mission details for replay'
      : '在线集锦暂未就绪，点击打开任务详情查看回放',
    watchHighlightsCta: en ? 'Watch highlights ›' : '观看集锦 ›',
    openDetailCta: en ? 'Open details ›' : '打开详情 ›',
    enterCta: en ? 'Open ›' : '进入 ›',
    listCount: en ? '{n}' : '{n} 次',
    missionReplayGate: en ? 'Mission replay' : '发射回放',
    clipHighlight: en ? 'Launch highlights' : '发射集锦',
    clipReplay: en ? 'Launch replay' : '发射回放',

    statsTitleYearCountry: en ? '{year} {country} launch stats' : '{year} 年{country}发射统计',
    statsTitleYearGlobal: en ? '{year} global launch stats' : '{year} 年全球发射统计',
    statsTitleScope: en ? '{scope}{country} launches' : '{scope}{countryLabel}发射',
    statsSubtitlePending: en
      ? 'Stats not ready — open the detail page'
      : '统计数据暂未就绪，可进入详情页查看',
    statsYearTotal: en ? 'YTD total: {n}' : '本年度累计 {n} 次',
    statsCta: en ? 'Open global launch stats ›' : '查看全球发射统计 ›',
    statsGate: en ? 'Global launch stats' : '全球发射统计',
    agencyFallback: en ? 'Agency' : '发射商',
    agencyFounded: en ? 'Founded {year}' : '{year} 年成立',
    agencyHistoryLaunches: en ? '{n} historical launches' : '历史 {n} 次发射',
    agencyCta: en ? 'Open agency details ›' : '进入发射商详情 ›',
    agencyGate: en ? 'Agency encyclopedia' : '全球发射商图鉴',
    agencyTypeGovernment: en ? 'Government' : '政府',
    agencyTypeCommercial: en ? 'Commercial' : '商业',
    agencyTypeMultinational: en ? 'Multinational' : '跨国',
    agencyTypeEducational: en ? 'Educational' : '教育',
    agencyTypePrivate: en ? 'Private' : '私营',

    roadClosureTitle: en ? 'Starbase road closures' : '星舰基地封路通知',
    roadClosureDesc: en
      ? 'Latest road/beach closures — often ahead of tests or flights'
      : '查看最新道路/海滩封闭时段 · 常预示测试或试飞临近',
    roadClosureCta: en ? 'View closures ›' : '查看封路 ›',
    stationDefaultTitle: en ? 'Space station status' : '空间站实时状态',
    stationDescNamed: en
      ? 'Crew, docking, and orbit status for “{name}”'
      : '查看「{name}」乘组、停靠与轨道实时状态',
    stationDescDefault: en
      ? 'ISS / Tiangong · live crew and orbit status'
      : 'ISS / 天宫 · 乘组与轨道实时状态',

    watchTag: en ? 'ON-SITE · Watch Party' : 'ON-SITE · 火箭观礼',
    watchOnSite: en ? 'On-site viewing' : '现场观礼',
    watchSpots: en ? '{n} viewing spots' : '{n}家观礼点',
    watchRocket: en ? 'Rocket' : '火箭',
    watchLaunchTitle: en ? '{rocket} launch viewing' : '{rocket}发射观礼',
    watchMerchants: en ? '{n} vendors' : '{n}家商家',
    watchNear: en ? 'Close-up viewing' : '近距离观礼',
    watchDescSuffix: en
      ? ' · booking · parking & nav · on-site briefings'
      : ' · 预约占位 · 停车导航 · 现场科普',
    watchCtaPick: en ? 'Choose vendor ›' : '选择商家 ›',
    watchCtaEnter: en ? 'Enter Watch Party ›' : '进入观礼 ›',

    reusable: en ? 'Reusable' : '可复用',
    launchVehicle: en ? 'Launch vehicle' : '运载火箭',
    rocketModelCta: en ? 'Open model archive ›' : '查看型号档案 ›',
    rowLength: en ? 'Length' : '全长',
    rowDiameter: en ? 'Diameter' : '直径',
    rowLaunchMass: en ? 'Liftoff mass' : '起飞质量',
    rowLeo: en ? 'LEO capacity' : 'LEO 运力',
    rowThrust: en ? 'Liftoff thrust' : '起飞推力',
    rowRecord: en ? 'Flight record' : '发射战绩',
    rowRecordVal: en ? '{total} flights · {success} success' : '{total} 次 · 成功 {success}',
    launchSite: en ? 'Launch site' : '发射场',
    siteActive: en ? 'Active' : '在用',
    siteInactive: en ? 'Inactive' : '已停用',
    launchSiteCta: en ? 'Open site details ›' : '查看发射场详情 ›',
    launchSiteGate: en ? 'Launch sites' : '全球发射场',
    rowTotalLaunches: en ? 'Total launches' : '累计发射',
    rowTotalLandings: en ? 'Total landings' : '累计回收',
    rowTimezone: en ? 'Timezone' : '时区',
    rowCoords: en ? 'Coordinates' : '坐标',
    nTimes: en ? '{n}' : '{n} 次',
    spacecraft: en ? 'Spacecraft' : '航天器',
    inService: en ? 'In service' : '现役',
    retired: en ? 'Retired' : '退役',
    spacecraftCta: en ? 'Open spacecraft archive ›' : '查看飞船档案 ›',
    spacecraftGate: en ? 'Spacecraft encyclopedia' : '航天器图鉴',
    rowCrew: en ? 'Crew' : '乘员',
    rowCrewVal: en ? '{n} people' : '{n} 人',
    rowHeight: en ? 'Height' : '高度',
    rowUplink: en ? 'Uplink payload' : '上行载荷',
    rowMaiden: en ? 'Maiden flight' : '首飞',
    rowLaunchCount: en ? 'Launches' : '发射次数',
    boosterCta: en ? 'Open booster archive ›' : '查看助推器档案 ›',
    rowFlights: en ? 'Flights' : '飞行次数',
    rowLandingOk: en ? 'Successful landings' : '成功回收',
    rowLastFlight: en ? 'Last flight' : '最近一飞',
    rowLastMission: en ? 'Latest mission' : '最近任务',
    boosterGeneTitle: en ? 'Booster genealogy' : '助推器家谱',
    boosterGeneDesc: en
      ? 'Track reuse and recovery for every first stage · leaderboard included'
      : '按编号追每一枚一级的复用与回收战绩 · 支持复用次数排行',
    boosterGeneDescShort: en
      ? 'Reuse leaderboard, per-booster records, and landings'
      : '复用次数排行、单枚战绩与回收记录',
    boosterGeneCta: en ? 'Open genealogy ›' : '打开家谱 ›',
    mySubsTitle: en ? 'My launch reminders' : '我订阅的发射提醒',
    missionFallbackId: en ? 'Launch #{id}' : '发射任务 #{id}',
    nextLaunch: en ? 'Next launch' : '下一场发射',
    voteTag: en ? 'VOTE · Predict' : 'VOTE · 竞猜',
    voteTitle: en ? 'Guess: {name}' : '猜一下：{name}',
    voteDesc: en
      ? 'Vote on-time/delay or success/fail on the mission page, then check your result'
      : '在任务详情页投票押准时/推迟或成败，发射后可回看自己猜得准不准',
    voteCta: en ? 'Go vote ›' : '去投票 ›',
    yearReviewTitle: en ? 'My space year in review' : '我的航天年度回顾',
    yearReviewDesc: en
      ? 'How many launches you followed and which agencies you watched most'
      : '这一年你追了多少场发射、最常看哪家发射商 · 生成可分享长图',
    yearReviewCta: en ? 'Open year review ›' : '打开年度回顾 ›',
    astroTitle: en ? 'Sky calendar' : '天象日历',
    astroDesc: en
      ? 'Meteor showers, eclipses, oppositions & elongations — with reminders'
      : '流星雨、日月食、行星冲日与大距 · 按时间排好并可设提醒',
    astroCta: en ? 'Open sky calendar ›' : '打开天象日历 ›',
    newsTag: en ? 'NEWS · Events' : 'NEWS · 事件',
    newsTitle: en ? 'Space events & news' : '航天事件与新闻',
    newsDesc: en
      ? 'Launch events, mission updates, and space news'
      : '发射事件、任务动态与航天资讯 · 中文摘要与图集',
    newsCta: en ? 'Open Events ›' : '打开事件页 ›',
    apodTitle: en ? 'Astronomy Picture of the Day' : '每日天文图',
    apodCta: en ? 'Open sky page ›' : '打开天象页看大图 ›',
    rowDate: en ? 'Date' : '日期',
    rowType: en ? 'Type' : '类型',
    typeVideo: en ? 'Video' : '视频',
    typeImage: en ? 'Image' : '图片',
    starlinkPassTag: en ? 'STARLINK · Pass' : 'STARLINK · 过境',
    starlinkPassTitle: en ? 'Starlink pass forecast' : '星链过境预报',
    starlinkPassDesc: en
      ? 'Visible passes for your location · azimuth, elevation, and map'
      : '按你的位置算未来可见过境 · 含方位角、仰角与观测地图',
    liveTag: en ? 'LIVE · Streams' : 'LIVE · 直播观看',
    liveTitle: en ? 'Watch launch livestreams' : '看发射直播',
    liveDesc: en
      ? 'Channels live in Monitor · plus Bilibili and featured streams'
      : '监控中心内嵌视频号直播间 · 另有 B站直播与推荐直播入口',
    liveCta: en ? 'Open livestreams ›' : '打开直播观看 ›',
    starlinkMapTag: en ? 'STARLINK · Constellation' : 'STARLINK · 星座',
    starlinkMapTitle: en ? 'Starlink live map' : '星链实时分布',
    starlinkMapDesc: en
      ? 'Live positions and on-orbit count · draggable 3D view'
      : '全球在轨星链的实时位置与在轨颗数 · 可拖动缩放的 3D 星座视图',
    starlinkMapCta: en ? 'View live map ›' : '查看实时分布 ›',
    starlinkMapGate: en ? 'Starlink Pro tracking' : '星链高级追踪',
    artemisTag: en ? 'ARTEMIS · Lunar' : 'ARTEMIS · 绕月',
    artemisTitle: en ? 'Artemis II mission panel' : 'Artemis II 任务面板',
    artemisDesc: en
      ? 'Phases, lunar path, and telemetry brief · crewed lunar flyby'
      : '任务阶段、绕月轨迹与遥测简报 · 载人绕月飞行进度',
    artemisCta: en ? 'Open mission panel ›' : '进入任务面板 ›',
    artemisGate: en ? 'Artemis telemetry panel' : 'Artemis 遥测面板',
    hardwareTag: en ? 'STARSHIP · Hardware' : 'STARSHIP · 硬件',
    hardwareTitle: en ? 'Starship hardware' : '星舰硬件',
    hardwareListTitle: en ? 'Starship hardware yard' : '星舰硬件设施',
    hardwareListDesc: en
      ? 'Boosters, ships, and ground systems under build or in service'
      : '在建与在役的助推器、飞船与地面设施 · 状态、测试与图片',
    hardwareCta: en ? 'Open hardware details ›' : '查看硬件详情 ›',
    hardwareListCta: en ? 'Open hardware list ›' : '打开硬件列表 ›',
    hardwareGate: en ? 'Starship hardware' : '星舰硬件设施',
    badgesTitle: en ? 'My badges' : '我的徽章',
    badgesDesc: en
      ? 'Check-in, quizzes and milestones · light up achievements'
      : '签到、问答与追发射里程碑 · 点亮你的航天成就',
    badgesCta: en ? 'Open badges ›' : '打开徽章 ›',
    favoritesTitle: en ? 'My favorites' : '我的收藏',
    favoritesDesc: en
      ? 'Missions, agencies, rockets and sites you saved'
      : '收藏的任务、发射商、火箭与发射场 · 分类双列浏览',
    favoritesCta: en ? 'Open favorites ›' : '打开收藏 ›',
    dailyQuizTitle: en ? 'Daily space quiz' : '每日挑战',
    dailyQuizDesc: en
      ? 'A short aerospace quiz · streak and badges await'
      : '每天几道航天题 · 连答可点亮徽章',
    dailyQuizCta: en ? 'Start quiz ›' : '去答题 ›',
    collectTitle: en ? 'Lunar wishes' : '月愿计划',
    collectDesc: en
      ? 'Write a wish bound for the Moon'
      : '写下想送上月球的心愿',
    collectCta: en ? 'Open lunar wishes ›' : '打开月愿 ›',
    exoplanetTitle: en ? 'Exoplanets' : '系外行星',
    exoplanetDesc: en
      ? 'Browse exoplanets and habitable-zone candidates'
      : '浏览系外行星与宜居带候选天体',
    exoplanetCta: en ? 'Explore exoplanets ›' : '打开系外行星 ›',
    nasaDataTitle: en ? 'NASA open data' : 'NASA 开放数据',
    nasaDataDesc: en
      ? 'Earth observation and open datasets inside the mini program'
      : '小程序内的地球观测与 NASA 开放数据入口',
    nasaDataCta: en ? 'Open NASA data ›' : '打开 NASA 数据 ›',
    spacecraftGalleryTitle: en ? 'Spacecraft gallery' : '全球飞船图鉴',
    spacecraftGalleryDesc: en
      ? 'Crew and cargo spacecraft archives worldwide'
      : '全球载人/货运飞船档案 · 可点进单船详情',
    spacecraftGalleryCta: en ? 'Open gallery ›' : '打开飞船图鉴 ›',
    launchSiteGalleryTitle: en ? 'Launch sites map' : '全球发射场分布',
    launchSiteGalleryDesc: en
      ? 'Pads and spaceports on the map · open site details'
      : '全球发射场与工位分布 · 可点进场站详情',
    launchSiteGalleryCta: en ? 'Open map ›' : '打开发射场地图 ›',
    rowStatus: en ? 'Status' : '状态',
    rowType: en ? 'Type' : '类型',
    recoveryOverview: en ? 'Recovery overview' : '回收总览',
    recoveryTag: en ? 'RECOVERY · Overview' : 'RECOVERY · 总览',
    recoveryTitle: en ? 'Booster recovery & reuse' : '助推器回收与复用总览',
    recoverySubtitle: en
      ? '{total} on record · {active} active'
      : '{total} 枚在册 · {active} 枚在役',
    recoveryCta: en ? 'Open booster genealogy ›' : '查看助推器家谱 ›',
    rowTotalFlights: en ? 'Total flights' : '累计飞行',
    rowLandingRate: en ? 'Landing success rate' : '回收成功率',
    rowTopReuse: en ? 'Reuse leader' : '复用榜首',
    rowTopReuseVal: en ? '{serial} · {n} flights' : '{serial} · {n} 飞',

    // 快捷入口 label（q 仍中文，保证意图匹配）
    sc_watch_party: en ? 'Watch Party' : '火箭观礼',
    sc_agency_casc: en ? 'CNSA / CASC' : '中国航天',
    sc_starship_next: en ? 'Starship flight' : '星舰试飞',
    sc_launch_list: en ? 'Upcoming' : '即将发射',
    sc_live_watch: en ? 'Livestream' : '看直播',
    sc_launch_stats: en ? 'Launch stats' : '发射统计',
    sc_agency: 'SpaceX',
    sc_starship_status: en ? 'Starship stack' : '星舰组合体',
    sc_mission_lookup: en ? 'Find mission' : '查任务',
    sc_flight_demo: en ? 'Flight profile' : '飞行剖面',
    sc_vehicle_tracker: en ? 'Orbital track' : '在轨追踪',
    sc_road_closure: en ? 'Road closure' : '基地封路',
    sc_station: en ? 'Station' : '空间站',
    sc_rocket_model: en ? 'Rocket specs' : '火箭参数',
    sc_launch_site: en ? 'Launch site' : '发射场',
    sc_spacecraft: en ? 'Spacecraft' : '飞船',
    sc_booster: en ? 'Booster' : '助推器',
    sc_my_launches: en ? 'My alerts' : '我的提醒',
    sc_apod: en ? 'APOD' : '天文图',
    sc_astro_calendar: en ? 'Sky events' : '天象',
    sc_starlink_pass: en ? 'Starlink pass' : '星链过境',
    sc_starlink_map: en ? 'Starlink map' : '星链分布',
    sc_recovery_stats: en ? 'Recovery' : '回收统计',
    sc_starship_hardware: en ? 'Hardware' : '星舰硬件',
    sc_artemis: 'Artemis',

    // 模型语言指令（拼进 system）
    replyLangRule: en
      ? '【Language】The user’s content language preference is English. Always answer in clear English (proper nouns may stay in their usual form). Keep replies under ~200 words.'
      : '【语言】用户内容语言偏好为中文。请始终用简洁通俗中文回答（专有名词可保留英文）。控制在约 200 字以内。'
  }
  const raw = map[key]
  if (raw == null) return ''
  return fill(raw, vars)
}

function localizeCountryName(zhOrGlobal) {
  const s = String(zhOrGlobal || '').trim()
  if (!s || s === '全球') return aiChatUiText('countryGlobal')
  const keyMap = {
    中国: 'countryChina',
    美国: 'countryUSA',
    俄罗斯: 'countryRussia',
    印度: 'countryIndia',
    日本: 'countryJapan',
    韩国: 'countryKorea',
    法国: 'countryFrance',
    英国: 'countryUK',
    以色列: 'countryIsrael',
    澳大利亚: 'countryAustralia'
  }
  const k = keyMap[s]
  return k ? aiChatUiText(k) : s
}

function localizeSiteLabel(siteKey, fallback) {
  const key = 'site_' + String(siteKey || '').replace(/-/g, '')
  // lc-39a → site_lc39a after replace; handle known keys
  const alias = {
    wenchang: 'site_wenchang',
    jiuquan: 'site_jiuquan',
    xichang: 'site_xichang',
    taiyuan: 'site_taiyuan',
    starbase: 'site_starbase',
    'lc-39a': 'site_lc39a',
    'slc-40': 'site_slc40',
    'slc-4e': 'site_slc4e',
    kourou: 'site_kourou',
    baikonur: 'site_baikonur',
    mahia: 'site_mahia'
  }
  const mapped = alias[String(siteKey || '')] || key
  return aiChatUiText(mapped) || fallback || ''
}

function localizeAgencyType(enType) {
  const t = String(enType || '')
  const map = {
    Government: 'agencyTypeGovernment',
    Commercial: 'agencyTypeCommercial',
    Multinational: 'agencyTypeMultinational',
    Educational: 'agencyTypeEducational',
    Private: 'agencyTypePrivate'
  }
  return map[t] ? aiChatUiText(map[t]) : t
}

/** 快捷入口：仅本地化 label，保留中文 q 以兼容意图匹配 */
function localizeQuickShortcuts(list) {
  const arr = Array.isArray(list) ? list : []
  return arr.map((item) => {
    if (!item || !item.id) return item
    const label = aiChatUiText('sc_' + item.id)
    return label ? Object.assign({}, item, { label }) : item
  })
}

function getAiChatShellTexts() {
  return {
    welcomeTitle: aiChatUiText('welcomeTitle'),
    welcomeDesc: aiChatUiText('welcomeDesc'),
    panelTitle: aiChatUiText('panelTitle'),
    panelSubtitle: aiChatUiText('panelSubtitle'),
    disclaimer: aiChatUiText('disclaimer'),
    thinkingPlaceholder: aiChatUiText('thinkingPlaceholder'),
    seeMoreOnHome: aiChatUiText('seeMoreOnHome'),
    seeMoreHistory: aiChatUiText('seeMoreHistory'),
    pendingAnnounce: aiChatUiText('pendingAnnounce'),
    superHeavyBooster: aiChatUiText('superHeavyBooster'),
    starshipShip: aiChatUiText('starshipShip'),
    enterStarshipProgress: aiChatUiText('enterStarshipProgress'),
    statsTotal: aiChatUiText('statsTotal'),
    statsSuccess: aiChatUiText('statsSuccess'),
    statsFailure: aiChatUiText('statsFailure'),
    drawing: aiChatUiText('drawing'),
    invitation: aiChatUiText('invitation'),
    watchPartyBrand: aiChatUiText('watchPartyBrand'),
    tapForDetail: aiChatUiText('tapForDetail'),
    retry: aiChatUiText('retry'),
    viewDetailsCta: aiChatUiText('viewDetailsCta'),
    agencyCta: aiChatUiText('agencyCta'),
    statsCta: aiChatUiText('statsCta'),
    watchHighlightsCta: aiChatUiText('watchHighlightsCta'),
    openDetailCta: aiChatUiText('openDetailCta'),
    enterCta: aiChatUiText('enterCta'),
    listCountSuffix: isContentLangEn() ? '' : ' 次'
  }
}

module.exports = {
  aiChatUiText,
  localizeCountryName,
  localizeSiteLabel,
  localizeAgencyType,
  localizeQuickShortcuts,
  getAiChatShellTexts
}
