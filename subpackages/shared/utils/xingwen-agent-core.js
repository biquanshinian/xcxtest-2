/**
 * 星问 Agent 工具 schema 与参数映射（无 wx，可供单测）
 */
const { mergeEntities, extractFollowupSlots } = require('./xingwen-session.js')

const TOOL_NAMES = [
  'search_launches',
  'get_launch_stats',
  'get_agency',
  'get_starship',
  'get_encyclopedia',
  'get_sky',
  'get_station',
  'get_watch_party',
  'get_replay',
  'get_me',
  'navigate_feature',
  'set_reminder'
]

const TOOL_EVENT_LABELS = {
  search_launches: '正在查发射日程…',
  get_launch_stats: '正在查发射统计…',
  get_agency: '正在查发射商资料…',
  get_starship: '正在查星舰进展…',
  get_encyclopedia: '正在查航天百科…',
  get_sky: '正在查天空与天象…',
  get_station: '正在查空间站状态…',
  get_watch_party: '正在匹配观礼服务…',
  get_replay: '正在找发射集锦…',
  get_me: '正在打开你的航天主页…',
  navigate_feature: '正在打开对应功能…',
  set_reminder: '正在处理发射提醒…'
}

const AGENT_SYSTEM_ADDENDUM = `【工具调用】
你可以调用本小程序提供的工具查询实时数据或打开功能。规则：
1. 发射时间、次数、尺寸、运力、票价、在轨颗数等数字只能来自工具返回的 facts；没有 facts 就直说暂无，禁止凭记忆编造。
2. 需要查发射/统计/百科/星舰/观礼/回放/个人数据时必须先调工具，再根据 facts 用一两句话引导用户点下方卡片。
3. 指代「那/这/呢」时沿用【本轮对话状态】里的筛选，缺的槽位才补问。
4. 闲聊、科普概念、怎么用小程序，可以不调工具。
5. 一次最多调用 3 个工具；不要为同一问题重复调用。`

function strEnum(values) {
  return { type: 'string', enum: values }
}

const TOOL_SCHEMAS = [
  {
    name: 'search_launches',
    description: '查询即将发射、历史发射或某一具体任务。可按国家、发射场、发射商、关键词筛选。',
    parameters: {
      type: 'object',
      properties: {
        mode: strEnum(['upcoming', 'history', 'lookup']),
        country: { type: 'string', description: '国家中文名，如中国、美国' },
        site: { type: 'string', description: '发射场，如文昌、酒泉、LC-39A' },
        agency: { type: 'string', description: '发射商，如 SpaceX、CASC' },
        keyword: { type: 'string', description: '任务/火箭关键词，如朱雀三号、星链' }
      }
    }
  },
  {
    name: 'get_launch_stats',
    description: '查询今天/本周/本月/某年的中国或全球发射次数统计。',
    parameters: {
      type: 'object',
      properties: {
        country: { type: 'string' },
        scope: strEnum(['today', 'week', 'month', 'year']),
        year: { type: 'number' }
      }
    }
  },
  {
    name: 'get_agency',
    description: '查询发射商介绍与战绩，如 SpaceX、中国航天科技集团、蓝色起源。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '发射商名称或简称' }
      },
      required: ['keyword']
    }
  },
  {
    name: 'get_starship',
    description: '星舰下一飞、组合体状态、在建硬件、Starbase 封路。',
    parameters: {
      type: 'object',
      properties: {
        topic: strEnum(['next', 'status', 'hardware', 'road']),
        query: { type: 'string', description: '硬件编号如 S38、B16' }
      }
    }
  },
  {
    name: 'get_encyclopedia',
    description: '火箭型号、发射场、飞船、助推器战绩、回收复用统计等参数百科。',
    parameters: {
      type: 'object',
      properties: {
        kind: strEnum(['rocket', 'site', 'spacecraft', 'booster', 'recovery']),
        query: { type: 'string', description: '如猎鹰9、文昌、神舟、B1067' }
      },
      required: ['kind']
    }
  },
  {
    name: 'get_sky',
    description: '星链过境预报、星链实时分布、NASA 每日天文图、天象日历。',
    parameters: {
      type: 'object',
      properties: {
        topic: strEnum(['pass', 'map', 'apod', 'calendar'])
      },
      required: ['topic']
    }
  },
  {
    name: 'get_station',
    description: '国际空间站或天宫空间站实时状态、乘组与停靠。',
    parameters: { type: 'object', properties: { query: { type: 'string' } } }
  },
  {
    name: 'get_watch_party',
    description: '火箭观礼服务匹配，或商家入驻邀请。场次时间地点费用以页面为准，不要编造。',
    parameters: {
      type: 'object',
      properties: {
        topic: strEnum(['viewing', 'join']),
        query: { type: 'string', description: '发射场或任务关键词，如文昌' }
      }
    }
  },
  {
    name: 'get_replay',
    description: '查找某次发射的集锦回放。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string' } }
    }
  },
  {
    name: 'get_me',
    description: '用户个人数据与成长入口：订阅提醒、竞猜、徽章、收藏、年度回顾、每日挑战、月愿、NASA 数据、系外行星。',
    parameters: {
      type: 'object',
      properties: {
        topic: strEnum([
          'reminders', 'vote', 'badges', 'favorites', 'year', 'quiz', 'collect', 'nasa', 'exoplanet'
        ])
      },
      required: ['topic']
    }
  },
  {
    name: 'navigate_feature',
    description: '打开小程序互动功能入口：飞行剖面、任务指挥室、在轨追踪、直播、Artemis、飞船图鉴、发射场地图。',
    parameters: {
      type: 'object',
      properties: {
        feature: strEnum([
          'flight_demo', 'mission_sim', 'vehicle_tracker', 'live_watch',
          'artemis', 'spacecraft_gallery', 'launch_site_gallery'
        ])
      },
      required: ['feature']
    }
  },
  {
    name: 'set_reminder',
    description: '为匹配到的发射任务打开提醒。若用户说「提醒我一下」且上下文已有任务，直接调用。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string' } }
    }
  }
]

function mapToolCallToIntent(name, args, session) {
  const a = args && typeof args === 'object' ? args : {}
  const last = session && session.lastIntent ? session.lastIntent : ''
  switch (String(name || '')) {
    case 'search_launches': {
      if (a.mode === 'history') return 'history_list'
      if (a.mode === 'lookup') return 'mission_lookup'
      if (a.mode === 'upcoming') return 'launch_list'
      if (last === 'history_list' || last === 'mission_lookup' || last === 'launch_list') return last
      return a.keyword && !a.country && !a.site ? 'mission_lookup' : 'launch_list'
    }
    case 'get_launch_stats':
      return 'launch_stats'
    case 'get_agency':
      return 'agency'
    case 'get_starship': {
      if (a.topic === 'status') return 'starship_status'
      if (a.topic === 'hardware') return 'starship_hardware'
      if (a.topic === 'road') return 'road_closure'
      return 'starship_next'
    }
    case 'get_encyclopedia': {
      const kind = a.kind
      if (kind === 'site') return 'launch_site'
      if (kind === 'spacecraft') return 'spacecraft'
      if (kind === 'booster') return 'booster'
      if (kind === 'recovery') return 'recovery_stats'
      return 'rocket_model'
    }
    case 'get_sky': {
      if (a.topic === 'map') return 'starlink_map'
      if (a.topic === 'apod') return 'apod'
      if (a.topic === 'calendar') return 'astro_calendar'
      return 'starlink_pass'
    }
    case 'get_station':
      return 'station'
    case 'get_watch_party':
      return a.topic === 'join' ? 'merchant_join' : 'viewing_spot'
    case 'get_replay':
      return 'mission_replay'
    case 'get_me': {
      const t = a.topic
      if (t === 'vote') return 'launch_vote'
      if (t === 'badges') return 'badges'
      if (t === 'favorites') return 'favorites'
      if (t === 'year') return 'year_review'
      if (t === 'quiz') return 'daily_quiz'
      if (t === 'collect') return 'collect'
      if (t === 'nasa') return 'nasa_data'
      if (t === 'exoplanet') return 'exoplanet'
      return 'my_launches'
    }
    case 'navigate_feature':
      return a.feature || 'flight_demo'
    case 'set_reminder':
      return 'set_reminder'
    default:
      return last || null
  }
}

function buildSyntheticQuery(name, args, session) {
  const a = args && typeof args === 'object' ? args : {}
  const prev = session && session.lastEntities ? session.lastEntities : {}
  const merged = mergeEntities(prev, extractFollowupSlots([a.country, a.site, a.agency, a.keyword, a.query].filter(Boolean).join(' ')))
  if (a.country) merged.country = a.country
  if (a.site) merged.site = a.site
  if (a.agency) merged.agency = a.agency
  if (a.keyword) merged.keyword = a.keyword
  if (a.query) merged.keyword = a.query
  if (a.name) merged.keyword = a.name
  if (a.serial) merged.keyword = a.serial

  const parts = []
  if (a.query) parts.push(String(a.query))
  if (a.keyword && a.keyword !== a.query) parts.push(String(a.keyword))
  if (a.name) parts.push(String(a.name))
  if (a.serial) parts.push(String(a.serial))
  if (merged.country) parts.push(merged.country)
  if (merged.site) parts.push(merged.site)
  if (merged.agency) parts.push(merged.agency)

  if (name === 'search_launches') {
    if (a.mode === 'history') parts.push('历史发射')
    else if (a.mode === 'lookup') parts.push('什么时候发射')
    else parts.push('即将发射')
  } else if (name === 'get_launch_stats') {
    if (a.scope === 'today') parts.push('今天')
    else if (a.scope === 'week') parts.push('本周')
    else if (a.scope === 'month') parts.push('本月')
    if (a.year) parts.push(String(a.year) + '年')
    parts.push('发射了多少次')
  } else if (name === 'get_agency') {
    parts.push('是什么公司')
  } else if (name === 'get_starship') {
    if (a.topic === 'status') parts.push('星舰组合体最新进展')
    else if (a.topic === 'hardware') parts.push('星舰硬件')
    else if (a.topic === 'road') parts.push('星舰基地封路了吗')
    else parts.push('星舰下一次试飞是什么时候')
  } else if (name === 'get_encyclopedia') {
    if (a.kind === 'site') parts.push('发射场在哪')
    else if (a.kind === 'spacecraft') parts.push('飞船能坐几人')
    else if (a.kind === 'booster') parts.push('飞了几次')
    else if (a.kind === 'recovery') parts.push('回收成功率多少')
    else parts.push('火箭多高')
  } else if (name === 'get_sky') {
    if (a.topic === 'map') parts.push('看看星链实时分布')
    else if (a.topic === 'apod') parts.push('今天的天文图片')
    else if (a.topic === 'calendar') parts.push('最近有什么流星雨')
    else parts.push('今晚能看到星链吗')
  } else if (name === 'get_station') {
    parts.push('看看空间站实时状态')
  } else if (name === 'get_watch_party') {
    parts.push(a.topic === 'join' ? '商家入驻' : '去哪看火箭发射')
  } else if (name === 'get_replay') {
    parts.push('发射集锦回放')
  } else if (name === 'set_reminder') {
    parts.push('提醒我一下')
    if (session && session.lastMissionName) parts.push(session.lastMissionName)
  } else if (name === 'get_me') {
    const seeds = {
      reminders: '我订阅了哪些发射',
      vote: '发射竞猜',
      badges: '我的徽章',
      favorites: '我的收藏',
      year: '我的航天年度回顾',
      quiz: '每日挑战',
      collect: '月愿计划',
      nasa: 'NASA开放数据',
      exoplanet: '系外行星'
    }
    parts.push(seeds[a.topic] || '我订阅了哪些发射')
  } else if (name === 'navigate_feature') {
    const seeds = {
      flight_demo: '看看飞行剖面演示',
      mission_sim: '打开任务指挥室',
      vehicle_tracker: '打开在轨飞行器追踪',
      live_watch: '在哪看发射直播',
      artemis: '阿尔忒弥斯任务进展',
      spacecraft_gallery: '全球飞船图鉴',
      launch_site_gallery: '全球发射场分布地图'
    }
    parts.push(seeds[a.feature] || '打开功能')
  }

  const seen = {}
  const uniq = []
  parts.forEach((p) => {
    const s = String(p || '').trim()
    if (!s || seen[s]) return
    seen[s] = 1
    uniq.push(s)
  })
  return uniq.join(' ').trim()
}

function factsFromCards(cards) {
  const list = Array.isArray(cards) ? cards : []
  const lines = []
  list.forEach((card) => {
    if (!card) return
    if (card.cardType === 'mission' || card.cardType === 'reminder') {
      lines.push(
        ['任务', card.name || card.missionName, card.rocketName, card.formattedTime || card.launchTime, card.padLocation || card.launchSite]
          .filter(Boolean)
          .join(' · ')
      )
      return
    }
    if (card.cardType === 'launch_list' && Array.isArray(card.items)) {
      const names = card.items.slice(0, 6).map((it) => it && (it.name || it.missionName)).filter(Boolean)
      lines.push((card.title || '发射列表') + '：' + names.join('；'))
      return
    }
    if (card.cardType === 'spec' && Array.isArray(card.rows)) {
      const facts = card.rows
        .filter((r) => r && r.label && r.value != null && r.value !== '')
        .map((r) => r.label + '：' + r.value)
      lines.push((card.title || '资料') + '。' + facts.join('；'))
      return
    }
    if (card.cardType === 'launch_stats') {
      lines.push(
        [card.title, card.subtitle, card.total != null ? '总计' + card.total : '', card.success != null ? '成功' + card.success : '']
          .filter(Boolean)
          .join(' · ')
      )
      return
    }
    if (card.cardType === 'agency') {
      lines.push([card.name || card.title, card.typeText, card.desc || card.subtitle].filter(Boolean).join(' · '))
      return
    }
    if (card.cardType === 'starship_status') {
      const b = card.booster && card.booster.id ? 'B ' + card.booster.id + ' ' + (card.booster.status || '') : ''
      const s = card.ship && card.ship.id ? 'S ' + card.ship.id + ' ' + (card.ship.status || '') : ''
      lines.push([card.title, b, s].filter(Boolean).join(' · '))
      return
    }
    if (card.title) lines.push(String(card.title) + (card.desc ? '：' + card.desc : ''))
  })
  return lines.join('\n').slice(0, 1800)
}

function mergeCards(list) {
  const out = []
  const seen = {}
  ;(Array.isArray(list) ? list : []).forEach((c) => {
    if (!c) return
    const key = String(c.cardType || '') + ':' + String(c.id || c.missionId || c.specKind || c.entryKind || c.title || '')
    if (seen[key]) return
    seen[key] = 1
    out.push(c)
  })
  return out.slice(0, 4)
}

function toolEventName(ev) {
  if (!ev) return ''
  if (typeof ev === 'string') return ev
  if (ev.name) return String(ev.name)
  if (ev.toolName) return String(ev.toolName)
  if (ev.tool && ev.tool.name) return String(ev.tool.name)
  if (ev.function && ev.function.name) return String(ev.function.name)
  if (ev.data && ev.data.name) return String(ev.data.name)
  return ''
}

function toolStatusLabel(name) {
  return TOOL_EVENT_LABELS[name] || '正在查询…'
}

module.exports = {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  TOOL_EVENT_LABELS,
  AGENT_SYSTEM_ADDENDUM,
  mapToolCallToIntent,
  buildSyntheticQuery,
  factsFromCards,
  mergeCards,
  toolEventName,
  toolStatusLabel
}
