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
  '火星空间探索 · 叙事科普向。用场景感和口语把航天讲清楚：先画面/故事再事实，允许适度比喻，语气更松弛。句式、段落结构与标题口吻必须明显区别于「硬核日报」风格，避免同质化与雷同表述。',
  '你像跟朋友晚饭后聊航天：先丢一个具体画面或小细节，再把任务讲明白。口语、长短句混着写，比喻只用一眼能懂的，别抒情升华。不要自问自答腔（「可能有人会问」一类）。跟「硬核日报」错开：更松、更慢，但仍有事实，不水。'
]

/** 旧版文末硬广 / 文首提示（命中则升级为「仅配图跳转、文末不引流」） */
const LEGACY_BRAND_FOOTERS = [
  '—— 火星探索日志\n小程序里能看发射倒计时和星舰进度。',
  '—— 火星空间探索\n想追火箭和深空任务，打开小程序就行。',
  // 兼容 CRLF / 无换行粘贴
  '—— 火星探索日志\r\n小程序里能看发射倒计时和星舰进度。',
  '—— 火星空间探索\r\n想追火箭和深空任务，打开小程序就行。',
  '—— 火星探索日志 小程序里能看发射倒计时和星舰进度。',
  '—— 火星空间探索 想追火箭和深空任务，打开小程序就行。'
]
const LEGACY_MINIPROGRAM_CTAS = [
  '打开小程序 · 查看发射与星舰',
  '打开小程序 · 探索火星空间'
]
const LEGACY_LEAD_DISCLAIMER_TEXTS = [
  '发射时间为预测，不代表官方！请以发布的航警海警为准！本文仅供参考，小程序【火星探索日志】可以查看火箭发射信息及相关新闻，大家认真观看，给小编点赞支持'
]

/** 规范化比较用：统一换行与空白 */
function normalizeFooterKey(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** 是否引流向文末（含旧硬广或「打开小程序」类口号） */
function isPromoBrandFooter(text) {
  const raw = String(text || '')
  const key = normalizeFooterKey(raw)
  if (!key) return false
  if (LEGACY_BRAND_FOOTERS.some((f) => normalizeFooterKey(f) === key)) return true
  // 署名 + 小程序导流
  if (/小程序/.test(key) && /——\s*火星/.test(key)) return true
  if (/打开小程序|想追火箭和深空|小程序里能看发射/.test(key)) return true
  return false
}

/**
 * 剥掉成稿末尾硬广结语（含 --- 分隔）。
 * 例：\n---\n—— 火星空间探索\n想追火箭和深空任务，打开小程序就行。
 */
function stripPromoBrandFooterMarkdown(md) {
  let s = String(md || '')
  // 反复剥，避免多层 --- footer
  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(
        /\n*(?:---|\*\*\*|___)\s*\n+(?:——\s*)?火星(?:探索日志|空间探索)[^\n]*(?:\n+[^\n]*){0,3}\s*$/u,
        ''
      )
      .replace(/\n*(?:——\s*)?火星(?:探索日志|空间探索)\s*\n+[^#\n]*(?:小程序|打开小程序)[^\n]*\s*$/u, '')
      .replace(/\n+想追火箭和深空任务[^\n]*\s*$/u, '')
      .replace(/\n+小程序里能看发射[^\n]*\s*$/u, '')
    if (next === s) break
    s = next
  }
  return s.replace(/\n{3,}$/g, '\n\n').replace(/\s+$/u, '')
}

/** 现行文首提示：信息向免责，不挂文字小程序链（避营销推广/导流限流） */
const DEFAULT_LEAD_DISCLAIMER_TEXT =
  '本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看火箭发射信息及相关资讯，感谢阅读，记得点赞支持'

const DEFAULT_BRANDS = [
  {
    key: 'mars_log',
    name: '火星探索日志',
    author: '火星探索日志',
    persona:
      '你给懂行的航天爱好者写短讯，像值班编辑在群里同步进度：先说清楚发生了什么、什么时候、在哪、用什么火箭。语气干脆、有点干，偶尔一句吐槽就够。不端着、不鸡汤、不写「赋能/拉开帷幕/令人振奋」。',
    footer: '',
    defaultStrategyKey: 'launch_brief',
    credentialSlot: '1',
    miniprogramCta: '',
    defaultCoverUrl: '',
    enabled: true
  },
  {
    key: 'mars_space',
    name: '火星空间探索',
    author: '火星空间探索',
    persona:
      '用中性说明文写航天任务：只陈述素材里的事实、节点与结果。语气平直、无口语、无情绪、无比喻。禁止自问自答与「接下来就看/接下来盯」类收尾。与「硬核短讯」错开处在于篇幅可稍长、可按素材把过程写全，但仍不抒情、不鸡汤、不注水。',
    footer: '',
    defaultStrategyKey: 'space_story',
    credentialSlot: '2',
    miniprogramCta: '',
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
  '禁止自问自答腔：有人可能会问、可能有人会问、你可能想问、很多人会好奇、有人要问、你是不是也想知道、不妨先问一句。需要解释就直接说，别先摆问句铺垫。',
  '禁止预告式收尾：接下来就看、接下来盯、接下来看、拭目以待、让我们一起期待、值得持续关注。素材未写后续安排就不要写「接下来」；事实写完即止。',
  '段落长短错落，可以一两句一段；小标题用具体信息（任务名/地点/节点），不要「背景/正文/结语」「开篇/看点」。',
  '禁止文末广告、小程序口号、关注引导、优惠促销；正文事实写完即止，不要硬广收尾。'
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
  /**
   * 文末引流样式（易触营销推广/导流限流，默认关闭）：
   * none=不附加文末；image=文末图跳；link=文字链；card=官方卡片（易 45166）
   * 小程序跳转默认只走「配图全跳」
   */
  miniprogramCtaMode: 'none',
  /** 推送时正文所有配图点击跳转小程序（唯一推荐跳转方式） */
  linkAllImagesToMiniprogram: true,
  /** 文首提示语：发射/新闻/洗稿稿件统一注入；纯文展示，不挂文字小程序链 */
  leadDisclaimerEnabled: true,
  leadDisclaimerText: DEFAULT_LEAD_DISCLAIMER_TEXT,
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
      strategyKey: 'auto',
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
      strategyKey: 'auto',
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
      strategyKey: 'auto',
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
      '300–600 字。第一句直接甩任务+窗口（或「窗口待定」）。接着火箭、发射场、载荷各写清楚。看点最多 3 条，用短句或破折号，别写成励志清单。事实写完即止，不要文末广告或小程序口号。',
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
      '400–800 字。开头从素材里挑一个具体现场细节（静火、吊装、路测、时间戳，必须是素材写到的），不要「今天我们来聊聊」；素材没有现场细节就直接从事件本身写起。中间按时间线把事说完，技术点用大白话，一句人话解释即可。若素材写明后续计划，用一句陈述收尾；否则事实写完即止。别升华到人类命运，不要「接下来就看/接下来盯」腔。',
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
    name: '平实解说',
    promptKey: 'rewrite_deep',
    themeId: 'clean',
    structureHint:
      '500–900 字。中性说明文：第一段直接写任务主体、时间/地点、载体（必须是素材写到的；素材没写就别造，缺什么就略过）。其后按事实顺序交代过程、关键节点与结果；术语需要解释时用一句定义式陈述，禁止「有人可能会问 / 你可能想问 / 很多人好奇」等问句铺垫。不用口语、不用比喻、不加情绪词，也不写「这意味着」「不难发现」。素材未披露后续安排则不要写「接下来就看 / 接下来盯」类收尾；事实写完即止。少列表；小标题仅用任务名或节点名。',
    titleHint: '信息标题：主体+动作或结果，10–22 字；不用疑问句、不用感叹号、不用口语词',
    enabled: true,
    priority: 85
  }
]

/** 旧版 space_story（口语讲任务）结构提示：命中则强制升级为平实解说 */
const LEGACY_SPACE_STORY_HINT_MARKERS = [
  '口语讲任务',
  '晚饭后',
  '接下来盯啥',
  '接下来盯什么',
  '跟朋友',
  '可能有人会问'
]

function isLegacySpaceStory(row) {
  if (!row || String(row.key || '') !== 'space_story') return false
  if (String(row.name || '') === '口语讲任务') return true
  const hint = String(row.structureHint || '')
  return LEGACY_SPACE_STORY_HINT_MARKERS.some((m) => hint.includes(m))
}

/**
 * 按正文/标题/来源自动匹配洗稿策略。
 * 返回策略 key；无强信号时按发稿号兜底（火星空间→space_story 平实解说，其余→deep_recap）。
 */
function matchStrategyFromContent(opts = {}) {
  const title = String(opts.title || '')
  const body = String(opts.body || opts.content || '')
  const brandKey = String(opts.brandKey || '')
  const sourceType = String(opts.sourceType || '')
  const text = `${title}\n${body}`.slice(0, 6000)
  const compactLen = text.replace(/\s+/g, '').length

  // 结构化来源优先
  if (sourceType === 'starship_event') {
    return brandKey === 'mars_space' ? 'space_story' : 'starship_diary'
  }
  if (sourceType === 'launch') {
    return brandKey === 'mars_space' ? 'space_story' : 'launch_brief'
  }

  const scores = {
    starship_diary: 0,
    launch_brief: 0,
    deep_recap: 0,
    news_digest: 0,
    space_story: 0
  }

  if (/星舰|starship|starbase|静火|热分离|梅萨|boca\s*chica|ship\s*#?\d+|booster\s*#?\d+|超重助推/i.test(text)) {
    scores.starship_diary += 6
  }
  if (/即将发射|发射窗口|发射前瞻|预定发射|计划.*发射|倒计时|NET\b|T-0|liftoff|launch\s*window|窗口待定/i.test(text)) {
    scores.launch_brief += 5
  }
  if (/Falcon\s*9|Falcon\s*Heavy|长征[一二三四五六七八九十\d]|朱雀|谷神星|Electron|Rocket\s*Lab|发射场|酒泉|文昌|西昌|太原|肯尼迪|卡纳维拉尔|LC-\d|Vandenberg/i.test(text)) {
    scores.launch_brief += 2
  }
  if (/复盘|回看|回顾|事后|调查报告|失败原因|爆炸|解体|异常|拆解|这一次/i.test(text)) {
    scores.deep_recap += 5
  }
  if (compactLen >= 1200) scores.deep_recap += 1
  if (compactLen > 0 && compactLen < 700) scores.news_digest += 3
  if (/速览|简讯|要闻|一句话|几点看|快讯|合集/i.test(text)) scores.news_digest += 4
  if ((text.match(/(?:^|\n)\s*(?:[-*•]|\d+[、.．)]\s)/g) || []).length >= 3) {
    scores.news_digest += 2
  }
  if (/宇航员|航天员|空间站|天宫|ISS|换座|载人|联盟号|Crew\s*Dragon|科普|探测器|火星车|探月|深空|月球|金星|木星/i.test(text)) {
    scores.space_story += 5
  }
  if (/为什么|怎么|什么样|故事|现场/i.test(title)) scores.space_story += 1

  if (brandKey === 'mars_space') {
    scores.space_story += 1.5
  } else if (brandKey === 'mars_log') {
    scores.deep_recap += 0.5
    scores.launch_brief += 0.5
  }

  let bestKey = ''
  let bestScore = 0
  for (const [k, v] of Object.entries(scores)) {
    if (v > bestScore) {
      bestScore = v
      bestKey = k
    }
  }
  if (!bestKey || bestScore <= 0) {
    return brandKey === 'mars_space' ? 'space_story' : 'deep_recap'
  }
  return bestKey
}

module.exports = {
  COLS,
  LEGACY_BRAND_PERSONAS,
  LEGACY_BRAND_FOOTERS,
  LEGACY_MINIPROGRAM_CTAS,
  LEGACY_LEAD_DISCLAIMER_TEXTS,
  DEFAULT_LEAD_DISCLAIMER_TEXT,
  DEFAULT_BRANDS,
  ANTI_AI_VOICE,
  GROUNDING_RULES,
  DEFAULT_CONFIG,
  SEED_PROMPTS,
  SEED_STRATEGIES,
  normalizeFooterKey,
  isPromoBrandFooter,
  stripPromoBrandFooterMarkdown,
  isLegacySpaceStory,
  matchStrategyFromContent
}
