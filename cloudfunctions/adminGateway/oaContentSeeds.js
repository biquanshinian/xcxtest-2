/**
 * 公众号内容中台：集合名 / 默认品牌 / 默认配置 / 提示词与策略种子
 * 纯数据模块，无副作用；oaContentStudio 及审计脚本共同引用（单一事实来源）。
 */

const COLS = {
  CONFIG_DOC: 'oa_content_config',
  GLOBAL_COL: 'global_config',
  PROMPTS_COL: 'oa_prompts',
  STRATEGIES_COL: 'oa_strategies',
  DRAFTS_COL: 'oa_drafts',
  JOBS_COL: 'oa_content_jobs',
  ACCOUNTS_COL: 'oa_benchmark_accounts',
  VIRAL_COL: 'oa_viral_articles',
  TITLES_COL: 'oa_viral_titles',
  COLLECT_COL: 'oa_collected_articles'
}

/** 旧版人设（命中则在 normalize 时升级为去 AI 味新版） */
const LEGACY_BRAND_PERSONAS = [
  '火星探索日志 · 硬核但不端着，面向航天爱好者的中文发射与星舰日报。事实优先，短句密集，少营销腔与抒情，可读、可分享。禁止堆砌形容词。',
  '火星空间探索 · 叙事科普向。用场景感和口语把航天讲清楚：先画面/故事再事实，允许适度比喻，语气更松弛。句式、段落结构与标题口吻必须明显区别于「硬核日报」风格，避免同质化与雷同表述。'
]

const DEFAULT_BRANDS = [
  {
    key: 'mars_log',
    name: '火星探索日志',
    author: '火星探索日志',
    persona:
      '你给懂行的航天爱好者写短讯，像值班编辑在群里同步进度：先说清楚发生了什么、什么时候、在哪、用什么火箭。语气干脆、有点干，偶尔一句吐槽就够。不端着、不鸡汤、不写「赋能/拉开帷幕/令人振奋」。',
    footer: '—— 火星探索日志\n小程序里能看发射倒计时和星舰进度。',
    defaultStrategyKey: 'launch_brief',
    credentialSlot: '1',
    miniprogramCta: '打开小程序 · 查看发射与星舰',
    defaultCoverUrl: '',
    enabled: true
  },
  {
    key: 'mars_space',
    name: '火星空间探索',
    author: '火星空间探索',
    persona:
      '你像跟朋友晚饭后聊航天：先丢一个具体画面或小细节，再把任务讲明白。口语、长短句混着写，比喻只用一眼能懂的，别抒情升华。跟「硬核日报」错开：更松、更慢，但仍有事实，不水。',
    footer: '—— 火星空间探索\n想追火箭和深空任务，打开小程序就行。',
    defaultStrategyKey: 'space_story',
    credentialSlot: '2',
    miniprogramCta: '打开小程序 · 探索火星空间',
    defaultCoverUrl: '',
    enabled: true
  }
]

/** 全局去 AI 味写作约束（注入 system） */
const ANTI_AI_VOICE = [
  '写成人话，像熟悉航天的编辑随手写的，不要像大模型作文。',
  '严禁套话：总之、综上所述、值得注意的是、在当今、不仅…更…、赋能、助力、拉开帷幕、令人振奋、毋庸置疑、众所周知、随着…的发展、让我们一起、首先/其次/最后（作结构词时）。',
  '禁止假大空升华、排比对仗三段论、鸡汤收尾、标题党夸张。',
  '少用破折号金句；少写「这意味着」「不难发现」；不要「大家好」「感谢阅读」「本文导读」。',
  '段落长短错落，可以一两句一段；小标题用具体信息（任务名/地点/节点），不要「背景/正文/结语」「开篇/看点」。',
  '文末如需提小程序，用一句自然带过，不要硬广口号。'
].join('')

/** 事实硬约束：素材是唯一事实来源，杜绝模型脑补 */
const GROUNDING_RULES = [
  '【事实红线】素材是唯一事实来源。以下内容只能来自素材原文：时间/日期、数字、载荷、火箭与任务名、人名与职务、引语、结果与状态。',
  '素材没写的事一律不写；禁止用你自己的背景知识补充「常识性事实」（哪怕你觉得对）。',
  '禁止编造现场细节、场景、天气、情绪反应；素材没有的画面不要虚构。',
  '禁止虚构任何人说过的话；素材没有引语就不用引语。',
  '不确定的表述写「待确认」或直接略过，不要猜。',
  '如果素材信息太少写不满目标字数，就写短，严禁注水或脑补凑字。'
].join('\n')

const DEFAULT_CONFIG = {
  enabled: false,
  dailyMax: 3,
  /** @deprecated 兼容旧字段：同步自 defaultBrand */
  author: DEFAULT_BRANDS[0].author,
  footer: DEFAULT_BRANDS[0].footer,
  miniprogramPath: 'pages/index/index',
  miniprogramCta: DEFAULT_BRANDS[0].miniprogramCta,
  /** link=文字链；image=图片跳转（推荐）；card=官方卡片（易 45166） */
  miniprogramCtaMode: 'image',
  /** 推送时正文所有配图点击跳转小程序 */
  linkAllImagesToMiniprogram: true,
  /** 文首提示语：发射/新闻/洗稿稿件统一注入；文案里第一个【…】自动挂小程序跳转（蓝色字） */
  leadDisclaimerEnabled: true,
  leadDisclaimerText:
    '发射时间为预测，不代表官方！请以发布的航警海警为准！本文仅供参考，小程序【火星探索日志】可以查看火箭发射信息及相关新闻，大家认真观看，给小编点赞支持',
  /** 推送微信草稿时是否开启留言：1 开，0 关 */
  openComment: true,
  /** 仅粉丝可留言 */
  onlyFansCanComment: false,
  defaultStrategyKey: DEFAULT_BRANDS[0].defaultStrategyKey,
  defaultCoverUrl: '',
  autoPushToWechatDraft: false,
  autoFreepublish: false,
  /** 草稿保留天数：日更时清理更早的已发布/已拒绝稿；0=不自动清 */
  draftRetainDays: 14,
  /** 任务日志保留天数 */
  jobRetainDays: 30,
  persona: DEFAULT_BRANDS[0].persona,
  /** 发稿号列表 */
  brands: DEFAULT_BRANDS,
  /** 日更 / 未指定时的默认发稿号 */
  defaultBrandKey: 'mars_log',
  lowFollowerMaxFans: 50000,
  lowFollowerMinReads: 10000,
  collectorTokenHint: '配置环境变量 OA_COLLECTOR_TOKEN',
  /** 外站 RSS 追踪：作者（authorMatch 过滤）或整个栏目（authorMatch 留空=全量） */
  trackSources: [
    {
      key: 'proxima_jack',
      name: 'Proxima · Jack C.',
      site: 'proxima',
      authorPage: 'https://proximareport.com/author/jack/',
      rssUrl: 'https://proximareport.com/rss/',
      authorMatch: 'Jack C.',
      enabled: true,
      autoWash: false,
      brandKey: 'mars_log',
      strategyKey: 'deep_recap',
      maxPerRun: 3
    },
    {
      key: 'nsf_spacex',
      name: 'NSF · SpaceX',
      site: 'nasaspaceflight',
      authorPage: 'https://www.nasaspaceflight.com/news/spacex/',
      rssUrl: 'https://www.nasaspaceflight.com/news/spacex/feed/',
      authorMatch: '',
      enabled: true,
      autoWash: true,
      brandKey: 'mars_log',
      strategyKey: 'deep_recap',
      maxPerRun: 2
    },
    {
      key: 'nsf_chinese',
      name: 'NSF · 中国航天',
      site: 'nasaspaceflight',
      authorPage: 'https://www.nasaspaceflight.com/news/international/chinese/',
      rssUrl: 'https://www.nasaspaceflight.com/news/international/chinese/feed/',
      authorMatch: '',
      enabled: true,
      autoWash: true,
      brandKey: 'mars_space',
      strategyKey: 'space_story',
      maxPerRun: 2
    }
  ],
  lastDailyAt: 0,
  lastDailyResult: '',
  lastTrackAt: 0,
  lastTrackResult: '',
  updatedAt: 0
}

const SEED_PROMPTS = [
  {
    key: 'rewrite_deep',
    name: '深度洗稿',
    kind: 'rewrite',
    system:
      '人设：{{persona}}\n\n任务：把素材改成原创公众号中文稿。保留事实与数字，禁止整句照抄。输出 Markdown，第一行 # 标题，正文可用 ##。不要免责声明、不要自我介绍。\n\n' +
      GROUNDING_RULES +
      '\n\n配图：素材里的 [[IMG:1]] [[IMG:2]] … 是原图位置占位。成稿必须原样保留全部占位符（单独成行），且相对顺序、所在叙述位置与素材一致：占位符前后讲什么，成稿对应段落就放哪。不要删光、不要改编号、不要改成假链接、不要把占位符集中堆到文首或文末。\n\n文风硬约束：' +
      ANTI_AI_VOICE +
      '\n严格按人设与用户给出的结构要求写，避免账号间同质化。',
    user:
      '策略：{{strategyName}}\n怎么写：{{structureHint}}\n标题怎么起：{{titleHint}}\n\n素材标题：{{sourceTitle}}\n来源：{{sourceLabel}}\n素材（含配图占位 [[IMG:n]]）：\n{{sourceBody}}\n\n直接输出成稿 Markdown（第一行 # 标题）。[[IMG:n]] 全部保留且贴着对应内容。只写素材里有的事实；写短一点也可以，宁可干货密度高，也不要注水或脑补。'
  },
  {
    key: 'create_from_data',
    name: '数据创作',
    kind: 'create',
    system:
      '人设：{{persona}}\n\n任务：根据结构化数据写公众号中文稿。只写数据里有的事，缺信息就少写，别脑补。输出 Markdown，第一行 # 标题。\n\n' +
      GROUNDING_RULES +
      '\n\n文风硬约束：' +
      ANTI_AI_VOICE,
    user:
      '策略：{{strategyName}}\n怎么写：{{structureHint}}\n标题怎么起：{{titleHint}}\n\n数据：\n{{sourceBody}}\n\n直接输出成稿。列表可以有，但别写成「1.2.3. 标准答卷」。'
  },
  {
    key: 'title_breakdown',
    name: '爆款标题拆解',
    kind: 'title_analyze',
    system: '你拆中文公众号标题。只输出 JSON，不要解释。候选标题也要去 AI 味、短、有信息。',
    user:
      '拆解标题，返回 JSON：{"hooks":[],"emotion":"","structure":"","keywords":[],"rewriteSuggestions":["候选1","候选2","候选3"]}。\n标题：{{sourceTitle}}'
  },
  {
    key: 'batch_titles',
    name: '批量标题',
    kind: 'title_gen',
    system:
      '你写航天公众号标题。只输出 JSON 字符串数组。标题要像编辑起的：短、有主体和动作，禁止「震惊/必看/一文读懂/深度解析」等模板腔。',
    user:
      '围绕「{{sourceTitle}}」给 8 个标题，返回 JSON 字符串数组。素材：{{sourceBody}}'
  }
]

const SEED_STRATEGIES = [
  {
    key: 'launch_brief',
    name: '发射前瞻短讯',
    promptKey: 'create_from_data',
    themeId: 'brief',
    structureHint:
      '300–600 字。第一句直接甩任务+窗口（或「窗口待定」）。接着火箭、发射场、载荷各写清楚。看点最多 3 条，用短句或破折号，别写成励志清单。结尾可提一句小程序看倒计时。',
    titleHint: '像新闻标题：任务名/火箭/日期里挑最硬的信息，10–22 字，别用感叹号堆情绪',
    enabled: true,
    priority: 100
  },
  {
    key: 'starship_diary',
    name: '星舰日记',
    promptKey: 'rewrite_deep',
    themeId: 'diary',
    structureHint:
      '400–800 字。开头从素材里挑一个具体现场细节（静火、吊装、路测、时间戳，必须是素材写到的），不要「今天我们来聊聊」；素材没有现场细节就直接从事件本身写起。中间按时间线把事说完，技术点用大白话，一句人话解释即可。结尾写「接下来盯什么」（只基于素材已披露的计划），别升华到人类命运。',
    titleHint: '日记口吻或画面感，可带 Ship/Booster 编号；禁止「史诗/传奇/里程碑」',
    enabled: true,
    priority: 90
  },
  {
    key: 'deep_recap',
    name: '深度复盘',
    promptKey: 'rewrite_deep',
    themeId: 'clean',
    structureHint:
      '600–1000 字。先交代背景一句就够，重点放在素材里的关键节点和数字（不得补充素材之外的「背景知识」）。判断要克制：区分「已知事实」和「个人判断」，个人判断要明说是推测。小结一句话收住，不要「给我们的启示」。',
    titleHint: '复盘感，可带「复盘/回看/这一次」；信息优先，别用「深度好文」',
    enabled: true,
    priority: 80
  },
  {
    key: 'news_digest',
    name: '航天资讯速读',
    promptKey: 'rewrite_deep',
    themeId: 'brief',
    structureHint:
      '200–400 字。开头一句结论（谁、做了什么）。中间 3–5 条要点，每条一行说完。最后一句点评要短、可有可无，别鸡汤。',
    titleHint: '资讯感：主体+动作，可带结果词（推迟/入轨/回收）；忌「盘点/合集」空泛词',
    enabled: true,
    priority: 70
  },
  {
    key: 'space_story',
    name: '空间叙事科普',
    promptKey: 'rewrite_deep',
    themeId: 'diary',
    structureHint:
      '500–900 字。开场用素材里出现过的具体画面或物件（素材没写就别造，直接从任务本身讲起），再用口语把任务讲明白。最多夹 1 个读者会问的问题并随口答掉——答案必须能在素材里找到。少列表、少小标题；段落可以稍长。收尾落到「下一步看啥」（只写素材提过的安排），不要抒情散文。',
    titleHint: '口语疑问或画面感短句；避免纯「XX将发射」电报题，也避免「诗意长句」',
    enabled: true,
    priority: 85
  }
]

module.exports = {
  COLS,
  LEGACY_BRAND_PERSONAS,
  DEFAULT_BRANDS,
  ANTI_AI_VOICE,
  GROUNDING_RULES,
  DEFAULT_CONFIG,
  SEED_PROMPTS,
  SEED_STRATEGIES
}
