/**
 * 星问富消息纯逻辑（无 wx / 无网络，供单测与 ai-chat-rich 共用）
 */

function isStarshipMissionLike(mission) {
  if (!mission || typeof mission !== 'object') return false
  const hay = [mission.rocketName, mission.name, mission.missionName]
    .filter(Boolean)
    .join(' ')
  return /starship|super\s*heavy|星舰|超重/i.test(hay)
}

/** 星舰任务卡：须为星舰体系 */
function isUsableMissionForCard(mission) {
  if (!mission || !mission.id || !isStarshipMissionLike(mission)) return false
  return !!(mission.missionName || mission.name)
}

/** 发射列表 / 通用任务卡：任意即将或已完成任务 */
function isUsableLaunchForCard(mission) {
  if (!mission || !mission.id) return false
  return !!(mission.missionName || mission.name)
}

/** 去掉问句口语噪声，留下实体检索串 */
function extractMissionSearchKey(text) {
  let q = String(text || '').trim()
  if (!q) return ''
  q = q
    .replace(/[？?！!。．.，,、；;：:…]+/g, ' ')
    .replace(/(什么时候|啥时候|何时|几号|哪天|哪个月|哪一周)/g, ' ')
    .replace(/(怎么样|怎样|如何|咋样|咋了|如何了)/g, ' ')
    .replace(/(有没有|能不能|可以吗|会不会)/g, ' ')
    .replace(/(进展|进度|近况|状态|情况)/g, ' ')
    .replace(/(发射|起飞|升空|试飞|飞行|回收|着陆|落地)/g, ' ')
    .replace(/(下次|下一次|下一飞|下一发|最近|最新|即将|接下来)/g, ' ')
    .replace(/(任务|火箭|卫星|飞船|导弹)/g, ' ')
    .replace(/(看看|打开|查询|介绍|告诉我|请问|帮我|想看|想了解|了解一下)/g, ' ')
    .replace(/(一次|一下|相关|的信息|详情|卡片)/g, ' ')
    .replace(/(吗|呢|啊|吧|呀|啦|嘛|哦|哇|哎)/g, ' ')
    .replace(/(是|的|了|在|有|什么|哪些|哪个|怎么|怎样)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return q
}

/** 长征系列：中文数字/甲乙丙与 Long March / CZ 统一成 cz10a 形态，便于中英同源比对 */
const CZ_CN_NUMERALS = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12
}
const CZ_VARIANT_SUFFIX = { 甲: 'a', 乙: 'b', 丙: 'c' }

function czCode(num, suffix) {
  const n = Number(num)
  if (!Number.isFinite(n) || n <= 0) return ''
  const sfx = suffix ? (CZ_VARIANT_SUFFIX[suffix] || String(suffix).toLowerCase()) : ''
  return 'cz' + n + sfx
}

function normalizeCzSeries(s) {
  return String(s)
    // 长征十号甲 / 长征十二乙 / 长征七 → cz10a / cz12b / cz7
    .replace(/长征\s*(十[一二]?|[一二三四五六七八九])\s*号?\s*([甲乙丙])?/g, (m, num, suffix) => {
      return czCode(CZ_CN_NUMERALS[num], suffix) || m
    })
    // 长征10号甲 / 长征12b → cz10a / cz12b
    .replace(/长征\s*(\d{1,2})\s*号?\s*([甲乙丙]|[abc](?![a-z]))?/g, (m, num, suffix) => {
      return czCode(num, suffix) || m
    })
    // long march 10a → cz10a
    .replace(/long\s*march\s*(\d{1,2})(?:\s*([abc])(?![a-z]))?/g, (m, num, suffix) => {
      return czCode(num, suffix) || m
    })
    // cz-10a / cz 10 a → cz10a
    .replace(/cz\s*-?\s*(\d{1,2})(?:\s*([abc])(?![a-z]))?/g, (m, num, suffix) => {
      return czCode(num, suffix) || m
    })
}

function normalizeMatchText(s) {
  return normalizeCzSeries(
    String(s || '')
      .toLowerCase()
      .replace(/星舰/g, 'starship')
      .replace(/超重型?/g, 'superheavy')
      .replace(/猎鹰\s*重型/g, 'falconheavy')
      .replace(/猎鹰\s*(九|9)/g, 'falcon9')
      .replace(/falcon\s*heavy/g, 'falconheavy')
      .replace(/falcon\s*9/g, 'falcon9')
      .replace(/朱雀\s*(三|3)/g, 'zhuque3')
      .replace(/zhuque\s*-?\s*3/g, 'zhuque3')
      .replace(/zq\s*-?\s*3/g, 'zhuque3')
      .replace(/谷神星\s*(一|1)/g, 'ceres1')
      .replace(/引力\s*(一|1)/g, 'gravity1')
      .replace(/gravity\s*-?\s*1/g, 'gravity1')
  )
    .replace(/长征\s*/g, 'cz')
    // 「猎鹰9号」→ falcon9号，尾巴上的「号」会让包含判断失配
    .replace(/(\d)\s*号/g, '$1')
    .replace(/[·・\s_\-]/g, '')
}

/** 非星舰的常见火箭/机构实体（避免「朱雀进展」误进星舰状态） */
function hasNonStarshipRocketEntity(text) {
  const q = String(text || '')
  return /(朱雀|猎鹰|长征|谷神|引力一号|蓝箭|朱诺|电子号|electron|falcon\s*9|falcon\s*heavy|ariane|vulcan|new\s*glenn|neutron|rocket\s*lab|ULA|ULA|SpaceX(?!\s*星舰)|spacex(?!\s*starship)|Atlas|Delta|SLS|安加拉)/i.test(q)
}

function isBareStarshipProgressAsk(text) {
  const q = String(text || '').trim()
  if (!q) return false
  if (hasNonStarshipRocketEntity(q)) return false
  return (
    /^(最新)?(进展|进度)(如何|怎么样|怎样|咋样|怎样了|如何了)?[？?！!。.\s]*$/i.test(q) ||
    /^(造到哪了|近况|近况如何|组合体|组合体进展|准备得怎样了)[？?！!。.\s]*$/i.test(q) ||
    /^(星舰)?(现在|目前)?(咋样|怎么样|如何)了?[？?！!。.\s]*$/i.test(q)
  )
}

const KNOWN_VEHICLE_HINT =
  /(朱雀|猎鹰|长征|谷神|引力|蓝箭|星舰|starship|falcon|zhuque|electron|ariane|vulcan|glenn|neutron|atlas|delta|sls|cz\d|zq|星链|starlink|龙飞船|dragon|crew\s*dragon)/i

/** 知名发射商/机构（中英缩写与常用别名） */
const KNOWN_AGENCY_HINT =
  /(spacex|\bnasa\b|\bcasc\b|\bcnsa\b|\besa\b|\bjaxa\b|\bisro\b|roscosmos|ula|rocket\s*lab|blue\s*origin|arianespace|landspace|northrop|firefly|relativity|axiom|\bboeing\b|太空探索|航天科技|航天科工|蓝箭航天|\b蓝箭\b|星际荣耀|星河动力|天兵科技|中科宇航|东方空间|深蓝航天|快舟|欧空局|俄航天|联合发射联盟|蓝色起源|火箭实验室|阿丽亚娜|美国宇航局|诺格|萤火虫航天)/i

/** 英文名/缩写 → 中文别名（小写 key，供打分与泛化命中） */
const AGENCY_ALIAS_MAP = {
  spacex: ['spacex', 'spx', '太空探索技术公司', '太空探索', '马斯克', '空叉'],
  nasa: ['nasa', '美国国家航空航天局', '美国宇航局'],
  casc: ['casc', '中国航天科技集团', '中国航天科技', '航天科技集团', '中国航天', '航天科技'],
  casic: ['casic', '中国航天科工集团', '航天科工'],
  cnsa: ['cnsa', '中国国家航天局'],
  esa: ['esa', '欧洲航天局', '欧空局'],
  jaxa: ['jaxa', '日本宇宙航空研究开发机构', '日本航天'],
  isro: ['isro', '印度空间研究组织', '印度航天'],
  roscosmos: ['roscosmos', '俄罗斯国家航天集团', '俄罗斯航天', '俄航天'],
  ula: ['ula', '联合发射联盟'],
  'rocket lab': ['rocket lab', 'rocketlab', '火箭实验室'],
  'blue origin': ['blue origin', 'blueorigin', '蓝色起源', '贝索斯'],
  arianespace: ['arianespace', '阿丽亚娜', '阿丽亚娜航天', '阿里安'],
  landspace: ['landspace', '蓝箭航天', '蓝箭'],
  ispace: ['ispace', 'i-space', '星际荣耀'],
  'galactic energy': ['galactic energy', '星河动力'],
  'space pioneer': ['space pioneer', '天兵科技', '天兵'],
  'cas space': ['cas space', '中科宇航'],
  orienspace: ['orienspace', '东方空间'],
  'deep blue aerospace': ['deep blue aerospace', '深蓝航天'],
  expace: ['expace', '快舟', '航天科工火箭'],
  'firefly aerospace': ['firefly', 'firefly aerospace', '萤火虫航天'],
  'northrop grumman': ['northrop', 'northrop grumman', '诺斯罗普·格鲁曼', '诺格'],
  'relativity space': ['relativity', 'relativity space', '相对论空间'],
  boeing: ['boeing', '波音']
}

/**
 * 知名发射商 LL2 硬 ID（命中别名时优先按 ID 锁定，杜绝串台）
 * 来源：项目内已核实的 Launch Library 2 agency id
 */
const AGENCY_CANONICAL_IDS = {
  spacex: [121],
  nasa: [44],
  casc: [88],
  landspace: [259]
}

/** 意图优先级（同分时靠前者胜） */
const INTENT_PRIORITY = [
  'starship_next',
  'flight_demo',
  'mission_sim',
  'vehicle_tracker',
  'road_closure',
  'station',
  'live_watch',
  'starlink_pass',
  'starlink_map',
  'viewing_spot',
  'artemis',
  'my_launches',
  'year_review',
  'launch_vote',
  'starship_hardware',
  'recovery_stats',
  'booster',
  'rocket_model',
  'launch_site',
  'spacecraft',
  'apod',
  'astro_calendar',
  'starship_status',
  'launch_stats',
  'launch_list',
  'agency',
  'news',
  'mission_replay',
  'mission_lookup'
]

const INTENT_SCORE_THRESHOLD = {
  starship_next: 40,
  flight_demo: 34,
  mission_sim: 38,
  vehicle_tracker: 36,
  road_closure: 36,
  station: 36,
  live_watch: 45,
  starlink_pass: 50,
  starlink_map: 50,
  viewing_spot: 50,
  artemis: 50,
  my_launches: 45,
  year_review: 45,
  launch_vote: 45,
  starship_hardware: 50,
  recovery_stats: 55,
  booster: 45,
  rocket_model: 45,
  launch_site: 40,
  spacecraft: 40,
  apod: 45,
  astro_calendar: 45,
  starship_status: 38,
  launch_stats: 40,
  launch_list: 40,
  agency: 40,
  news: 45,
  mission_replay: 40,
  mission_lookup: 34
}

function isPureChitchat(q) {
  const t = String(q || '').trim()
  if (!t) return true
  if (/天气|股票|笑话|吃饭|你好|谢谢|在吗|早上好|晚安/.test(t) &&
    !/(发射|火箭|航天|太空|星舰|空间站|卫星|飞船|轨道|starship|spacex|nasa)/i.test(t)) {
    return true
  }
  return false
}

function hasStarshipEntity(q) {
  return /星舰|starship|超重型|super\s*heavy|助推器|组合体|\bB\d{1,3}\b|\bS\d{1,3}\b/i.test(q)
}

function hasLaunchDomain(q) {
  return /(发射|火箭|升空|起飞|试飞|航天发射|太空发射|打火箭|发火箭|任务|卫星)/.test(q)
}

function hasQuantityAsk(q) {
  return /(多少|几次|几发|几回|数量|次数|频次|一共|总共|战绩|排行|排名|榜单|统计|count|how\s*many|成功率)/i.test(q)
}

function hasTimeScope(q) {
  return /(今天|今日|今晚|今年|本年|本年度|去年|前年|本周|这周|这一周|本月|这个月|当月|近日|近期|年度|全年|20\d{2}\s*年?)/.test(q)
}

function hasGeoScope(q) {
  return /(全球|世界|各国|全国|中国|国内|我国|美国|俄罗斯|印度|日本|韩国|法国|英国|以色列|澳大利亚|澳洲|欧洲)/.test(q)
}

/** 发射列表卡：问法 → 发射场（与地图 inferSiteKey 对齐的常用场站） */
const LAUNCH_LIST_SITE_RULES = [
  { key: 'wenchang', label: '文昌', queryRe: /文昌|wenchang|海南文昌/i, missionRe: /wenchang|文昌/i },
  { key: 'jiuquan', label: '酒泉', queryRe: /酒泉|jiuquan/i, missionRe: /jiuquan|酒泉/i },
  { key: 'xichang', label: '西昌', queryRe: /西昌|xichang/i, missionRe: /xichang|西昌/i },
  { key: 'taiyuan', label: '太原', queryRe: /太原|taiyuan/i, missionRe: /taiyuan|太原/i },
  { key: 'starbase', label: 'Starbase', queryRe: /starbase|boca\s*chica|星舰基地|博卡奇卡/i, missionRe: /starbase|boca\s*chica/i },
  { key: 'lc-39a', label: 'LC-39A', queryRe: /39a|肯尼迪|kennedy/i, missionRe: /39a|kennedy/i },
  { key: 'slc-40', label: 'SLC-40', queryRe: /slc-?40|卡纳维拉尔|cape\s*canaveral/i, missionRe: /slc-?40|cape\s*canaveral/i },
  { key: 'slc-4e', label: 'SLC-4E', queryRe: /slc-?4e|范登堡|vandenberg/i, missionRe: /slc-?4e|vandenberg/i },
  { key: 'kourou', label: '库鲁', queryRe: /库鲁|kourou|圭亚那/i, missionRe: /kourou|guiana/i },
  { key: 'baikonur', label: '拜科努尔', queryRe: /拜科努尔|baikonur/i, missionRe: /baikonur/i },
  { key: 'mahia', label: '马希亚', queryRe: /马希亚|\bmahia\b/i, missionRe: /mahia|rocket\s*lab\s*lc-?1/i }
]

function hasUpcomingSense(q) {
  return /(即将|接下来|近期|最近|未来|本周|这周|下周|这几天|这两天|马上|有啥|有什么|哪些|安排|日程|计划|排期|预报|日历|要打|要发|快打了|快发了)/.test(q)
}

function hasOrgAsk(q) {
  return /(公司|机构|组织|厂商|发射商|哪家|谁家|背景|简介|是谁|干什么|做什么|干嘛|靠谱|实力|图鉴|百科|档案|介绍|讲讲|聊聊|说说|了解)/.test(q)
}

function hasVehicleModelAsk(q) {
  return /[一二三四五六七八九十\d]+号/.test(q) ||
    /falcon\s*\d|zhuque-?\d|electron|starlink|starship|超重|flight\s*\d+|ift-?\d+/i.test(q)
}

/** 别名表软命中（不必整句等于关键词） */
function detectAgencyAliasHit(text) {
  const q = String(text || '')
  const lower = q.toLowerCase()
  if (KNOWN_AGENCY_HINT.test(q)) return true
  const keys = Object.keys(AGENCY_ALIAS_MAP)
  for (let i = 0; i < keys.length; i += 1) {
    const aliases = AGENCY_ALIAS_MAP[keys[i]]
    for (let j = 0; j < aliases.length; j += 1) {
      const al = String(aliases[j] || '').trim()
      if (al.length < 2) continue
      if (/[a-z]/i.test(al)) {
        if (lower.indexOf(al.toLowerCase()) >= 0) return true
      } else if (q.indexOf(al) >= 0) {
        return true
      }
    }
  }
  return false
}

/** 去掉发射商问法口语噪声 */
function extractAgencySearchKey(text) {
  let q = String(text || '').trim()
  if (!q) return ''
  q = q
    .replace(/[？?！!。．.，,、；;：:…]+/g, ' ')
    .replace(/(是什么公司|哪家公司|那家公司|什么机构|什么公司|靠谱吗|实力如何|干嘛的|干什么的|做什么的|发射商图鉴|全球发射商|发射商信息|发射商简介|机构简介|公司简介|航天机构|航天公司|发射商|介绍一下|介绍下|介绍|讲讲|聊聊|说说|告诉我|查一下|看看|怎么样|怎样|如何|咋样|的信息|详情|图鉴|百科|档案)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return q
}

function scoreStarshipNextFlight(q) {
  if (!hasStarshipEntity(q) && !/星舰|starship/i.test(q)) return 0
  if (!/星舰|starship|超重型|super\s*heavy/i.test(q)) return 0
  let s = 20
  if (/(下次|下一次|下一飞|下一发|下一趟|最近一次|最新一次|next\s*(?:\S+\s*){0,3}(flight|launch)|flight\s*\d+|ift-?\d+)/i.test(q)) s += 45
  if (/(什么时候|啥时候|何时|几号|哪天|多久|还要等多久)/.test(q)) s += 30
  if (/(发射|起飞|升空|试飞|飞)/.test(q)) s += 15
  if (/(马上飞|快飞了|啥时候飞|何时飞|什么时候飞)/.test(q)) s += 35
  if (/进展|进度|组合体|封路|塔架/.test(q) && !/(下次|下一次|下一飞|什么时候|何时|试飞)/.test(q)) s -= 25
  return s
}

function scoreStarshipStatus(q) {
  if (isBareStarshipProgressAsk(q)) return 90
  if (hasNonStarshipRocketEntity(q) && !/星舰|starship|超重/i.test(q)) return 0
  if (/(飞行演示|飞行剖面|在轨飞行器|飞行器追踪|指挥室|GO\s*\/?\s*NO-?GO|发射决策|封路|道路封闭)/i.test(q)) return 0
  if (/(空间站|\bISS\b|天宫)/i.test(q) && !hasStarshipEntity(q)) return 0
  if (!hasStarshipEntity(q)) return 0
  let s = 15
  if (/(进展|进度|造到|建造|近况|状态|准备清单|checklist|堆栈|stack)/i.test(q)) s += 40
  if (/(咋样|怎么样|如何|现在|目前|哪了|到哪)/.test(q)) s += 25
  if (/(助推器|组合体|飞船|\bB\d{1,3}\b|\bS\d{1,3}\b|booster|ship\s*\d+)/i.test(q)) s += 20
  if (/(下次|下一次|下一飞|什么时候发射)/.test(q)) s -= 30
  return s
}

function scoreLaunchStats(q) {
  // 回收/复用口径（成功率、复用排行）不是发射次数统计，交给 recovery_stats
  if (scoreRecoveryStats(q) >= INTENT_SCORE_THRESHOLD.recovery_stats) return 0
  // 「星链有多少颗」问的是星座规模，不是发射次数
  if (scoreStarlinkMap(q) >= INTENT_SCORE_THRESHOLD.starlink_map) return 0
  if (/(发射统计|全球发射统计|全球统计|打开发射统计|查看发射统计|发射排行|发射榜)/.test(q)) return 95
  // 必须有「数量/排行/统计」语义，避免「本周发射计划」误入
  const statsSense = hasQuantityAsk(q) || /(统计|排行|排名|榜|战绩|谁最多|哪国最多|哪家最多)/.test(q)
  if (!statsSense) return 0
  // 日程/列表感强时压分
  if (/(有哪些|有什么|哪些发射|发射计划|发射日程|发射排期|即将发射)/.test(q) && !hasQuantityAsk(q)) return 0
  let s = 10
  if (hasQuantityAsk(q)) s += 35
  if (hasLaunchDomain(q) || /(航天|太空)/.test(q)) s += 25
  if (hasTimeScope(q)) s += 18
  if (hasGeoScope(q)) s += 18
  if (/(战绩|排行|排名|榜|对比|谁最多|哪国最多|哪家最多)/.test(q)) s += 20
  if (/(发了几|打了几|一共发|总共发|发射数量|发射频次)/.test(q)) s += 25
  // 具体型号历史次数 → 留给任务检索
  if (hasVehicleModelAsk(q) && !hasGeoScope(q) && !/全球|各国|全国/.test(q)) s -= 45
  if (detectAgencyAliasHit(q) && hasQuantityAsk(q) && !hasGeoScope(q) && !hasTimeScope(q)) s -= 15
  return s
}

/** 发射列表卡 / 探云：只看未来多少天内（默认 60） */
const LAUNCH_LIST_WITHIN_DAYS = 60

function scoreLaunchList(q) {
  if (scoreLaunchStats(q) >= INTENT_SCORE_THRESHOLD.launch_stats) return 0
  if (scoreStarshipNextFlight(q) >= INTENT_SCORE_THRESHOLD.starship_next) return 0
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo || scoreMissionSim(q) >= 38 ||
    scoreVehicleTracker(q) >= INTENT_SCORE_THRESHOLD.vehicle_tracker) return 0
  if (scoreRoadClosure(q) >= 36 || scoreStation(q) >= 36) return 0
  let s = 0
  if (/(发射列表|发射日程|发射计划|发射排期|发射预报|发射日历)/.test(q)) s += 55
  if (hasUpcomingSense(q)) s += 30
  if (hasLaunchDomain(q)) s += 25
  if (/(有火箭|有发射|要发射|要打吗|打吗|发什么|飞什么)/.test(q)) s += 25
  if (detectAgencyAliasHit(q) && hasUpcomingSense(q)) s += 15
  if (parseLaunchListSiteFilter(q)) s += 20
  if (parseLaunchListCountryFilter(q) && hasUpcomingSense(q)) s += 20
  if (hasQuantityAsk(q) && (hasTimeScope(q) || hasGeoScope(q))) s -= 40
  return s
}

/**
 * 发射列表问法中的发射场筛选（文昌 / 酒泉…）
 * @returns {{ key: string, label: string }|null}
 */
function parseLaunchListSiteFilter(text) {
  const q = String(text || '').trim()
  if (!q) return null
  for (let i = 0; i < LAUNCH_LIST_SITE_RULES.length; i += 1) {
    const rule = LAUNCH_LIST_SITE_RULES[i]
    if (rule.queryRe.test(q)) return { key: rule.key, label: rule.label }
  }
  return null
}

/** 发射列表问法中的国家筛选（中国 / 美国…）；全球/各国不算国家筛 */
function parseLaunchListCountryFilter(text) {
  const q = String(text || '').trim()
  if (!q || /全球|世界|各国|全世界/.test(q)) return null
  const countryRules = [
    [/中国|国内|我国/, '中国'],
    [/美国|USA|\bUS\b/i, '美国'],
    [/俄罗斯|俄国/, '俄罗斯'],
    [/印度/, '印度'],
    [/日本/, '日本'],
    [/韩国|南韩/, '韩国'],
    [/法国/, '法国'],
    [/英国/, '英国'],
    [/以色列/, '以色列'],
    [/澳大利亚|澳洲/, '澳大利亚']
  ]
  for (let i = 0; i < countryRules.length; i += 1) {
    if (countryRules[i][0].test(q)) return countryRules[i][1]
  }
  return null
}

/**
 * 发射列表问法筛选：发射场 > 国家（需即将语义）> 发射商（需即将语义）
 * @returns {{ siteKey?: string, siteLabel?: string, country?: string, countryLabel?: string, agencyKey?: string, agencyLabel?: string, withinDays?: number }|null}
 */
function parseLaunchListFilter(text) {
  const q = String(text || '').trim()
  if (!q) return null
  const site = parseLaunchListSiteFilter(q)
  if (site) {
    return { siteKey: site.key, siteLabel: site.label, withinDays: LAUNCH_LIST_WITHIN_DAYS }
  }
  const country = parseLaunchListCountryFilter(q)
  if (country && hasUpcomingSense(q) && !hasOrgAsk(q)) {
    return { country, countryLabel: country, withinDays: LAUNCH_LIST_WITHIN_DAYS }
  }
  if (!hasUpcomingSense(q) || hasOrgAsk(q)) return null
  const agencyKey = detectKnownAgencyCanonical(q)
  if (!agencyKey) return null
  const aliases = AGENCY_ALIAS_MAP[agencyKey] || []
  const agencyLabel = aliases.find((a) => /[\u4e00-\u9fff]/.test(a)) || aliases[0] || agencyKey
  return { agencyKey, agencyLabel, withinDays: LAUNCH_LIST_WITHIN_DAYS }
}

function missionPadHaystack(mission) {
  return [
    mission && mission.launchSite,
    mission && mission.padLocation,
    mission && mission.padName,
    mission && mission.locationName
  ].filter(Boolean).join(' ')
}

function missionMatchesCountry(mission, country) {
  if (!country) return true
  const display = String(mission && mission.countryDisplay || '').trim()
  if (display === country) return true
  const hay = [
    display,
    mission && mission.padLocation,
    mission && mission.launchSite,
    mission && mission.locationName
  ].filter(Boolean).join(' ')
  if (country === '中国') return /中国|china|\bprc\b/i.test(hay)
  if (country === '美国') return /美国|united\s*states|\bUSA\b|\bUS\b/i.test(hay)
  if (country === '俄罗斯') return /俄罗斯|俄国|russia/i.test(hay)
  if (country === '印度') return /印度|india/i.test(hay)
  if (country === '日本') return /日本|japan/i.test(hay)
  if (country === '韩国') return /韩国|south\s*korea|\bkorea\b/i.test(hay)
  if (country === '法国') return /法国|france/i.test(hay)
  if (country === '英国') return /英国|united\s*kingdom|\buk\b/i.test(hay)
  if (country === '以色列') return /以色列|israel/i.test(hay)
  if (country === '澳大利亚') return /澳大利亚|澳洲|australia/i.test(hay)
  return display.indexOf(country) >= 0
}

/** 任务 NET 是否落在「现在 → now+days」窗口内（发射列表 / 探云共用） */
function missionWithinUpcomingDays(mission, days, nowMs) {
  const n = Number(days)
  if (!Number.isFinite(n) || n <= 0) return true
  if (!mission || !mission.launchTime) return false
  const t = new Date(mission.launchTime).getTime()
  if (!Number.isFinite(t)) return false
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const end = now + n * 24 * 3600 * 1000
  return t >= now - 60 * 60 * 1000 && t <= end
}

function missionMatchesLaunchListFilter(mission, filter) {
  if (!mission || !filter) return true
  const within = filter.withinDays != null ? filter.withinDays : LAUNCH_LIST_WITHIN_DAYS
  if (!missionWithinUpcomingDays(mission, within)) return false
  if (filter.siteKey) {
    const rule = LAUNCH_LIST_SITE_RULES.find((r) => r.key === filter.siteKey)
    if (!rule) return false
    return rule.missionRe.test(missionPadHaystack(mission))
  }
  if (filter.country) {
    return missionMatchesCountry(mission, filter.country)
  }
  if (filter.agencyKey) {
    return agencyMatchesCanonical({
      id: mission.launchAgencyId,
      name: mission.launchAgency || mission.agency || '',
      abbrev: mission.launchAgencyAbbrev || ''
    }, filter.agencyKey)
  }
  return true
}

function launchListFilterLabel(filter) {
  if (!filter) return ''
  return filter.siteLabel || filter.countryLabel || filter.agencyLabel || ''
}

function scoreFlightDemo(q) {
  let s = 0
  if (/(飞行演示|飞行剖面|剖面演示|发射剖面|剖面动画|飞行轨迹|轨迹演示)/.test(q)) s += 55
  if (/(怎么飞|如何飞|咋飞|怎么个飞法|飞行过程|飞行路径|剖面)/.test(q)) s += 40
  if (/(演示|动画|可视化)/.test(q) && /(飞|发射|轨道|剖面)/.test(q)) s += 25
  return s
}

function scoreMissionSim(q) {
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo) return 0
  let s = 0
  if (/(任务指挥室|指挥室|飞行总监)/.test(q)) s += 55
  if (/(GO\s*\/?\s*NO-?GO|发射决策|决策模拟|任务模拟)/i.test(q)) s += 50
  if (/(模拟).{0,8}(发射|决策|指挥)|(发射|决策|指挥).{0,8}(模拟)/.test(q)) s += 35
  return s
}

function scoreVehicleTracker(q) {
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo || scoreMissionSim(q) >= 38) return 0
  if (scoreStation(q) >= 50 && !/(飞行器|追踪|定位|tracker|飞到哪|在哪)/i.test(q)) return 0
  let s = 0
  if (/(在轨飞行器|飞行器追踪|vehicle\s*tracker)/i.test(q)) s += 60
  if (/(追踪|定位|实时位置|在哪飞|飞到哪|到哪儿|在哪里).{0,16}(星舰|龙飞船|dragon|飞船)/i.test(q)) s += 45
  if (/(星舰|龙飞船|dragon|飞船).{0,16}(追踪|定位|实时|在哪|飞到哪|到哪儿|在哪里|哪儿了)/i.test(q)) s += 45
  if (/(3D\s*地球|地球仪).{0,10}(追踪|定位|飞行器)/i.test(q)) s += 40
  if (/(在轨).{0,6}(追踪|定位|飞行器)/.test(q)) s += 35
  return s
}

function scoreRoadClosure(q) {
  let s = 0
  if (/(封路|道路封闭|道路关闭|beach\s*closure|road\s*closure)/i.test(q)) s += 55
  if (/(海滩封闭|海滩关闭|路封了|封道)/.test(q)) s += 45
  if (/(starbase|boca\s*chica|星舰基地|星基|发射场).{0,10}(路|封|关闭|封闭)/i.test(q)) s += 40
  if (/(路|道路|海滩).{0,8}(封|关|闭)/.test(q) && /(星舰|starbase|基地)/i.test(q)) s += 30
  return s
}

function scoreStation(q) {
  if (/(在轨飞行器|飞行器追踪|vehicle\s*tracker)/i.test(q) && !/(空间站|天宫|\bISS\b)/i.test(q)) return 0
  let s = 0
  if (/(空间站|国际空间站|\bISS\b|天宫|tiangong|中国空间站|\bCSS\b)/i.test(q)) s += 50
  if (/(乘组|宇航员|航天员|舱段|对接|停靠)/.test(q) && /(站|ISS|天宫)/i.test(q)) s += 25
  if (/(上面有谁|有哪些人|有几个人|现在有人吗)/.test(q) && /(站|天宫|ISS)/i.test(q)) s += 30
  return s
}

function scoreAgency(q) {
  if (scoreLaunchStats(q) >= INTENT_SCORE_THRESHOLD.launch_stats) return 0
  if (scoreLaunchList(q) >= INTENT_SCORE_THRESHOLD.launch_list) return 0
  if (scoreStarshipNextFlight(q) >= INTENT_SCORE_THRESHOLD.starship_next) return 0
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo || scoreMissionSim(q) >= 38 ||
    scoreVehicleTracker(q) >= INTENT_SCORE_THRESHOLD.vehicle_tracker) return 0
  if (scoreRoadClosure(q) >= 36 || scoreStation(q) >= 36) return 0
  // 日程 / 具体型号不抢
  if (/(什么时候|啥时候|何时|下次|下一次|即将|接下来|有哪些发射|发射计划|发射排期)/.test(q)) return 0
  if (hasVehicleModelAsk(q)) return 0

  let s = 0
  if (/(发射商图鉴|全球发射商|航天机构|航天公司)/.test(q)) s += 50
  if (hasOrgAsk(q)) s += 28
  if (detectAgencyAliasHit(q)) s += 45
  if (/(是什么|哪家|谁家|靠谱吗|实力|干嘛的|干什么的)/.test(q) && detectAgencyAliasHit(q)) s += 15
  const key = extractAgencySearchKey(q)
  if (key && key.length >= 2 && (KNOWN_AGENCY_HINT.test(key) || detectAgencyAliasHit(key))) s += 10
  // 裸机构名短问
  if (detectAgencyAliasHit(q) && String(q).trim().length <= 24) s += 10
  return s
}

function hasMissionReplayAsk(q) {
  return /(回放|集锦|\breplay\b|\bhighlights?\b|发射视频|看回放|看集锦)/i.test(q)
}

/** 去掉回放问法噪声，便于任务名匹配（引力一号的回放视频 → 引力一号） */
function stripReplayAskNoise(text) {
  return String(text || '')
    .replace(/(发射)?(回放|集锦)(视频|短片|片子)?/g, ' ')
    .replace(/\b(replay|highlights?)\b/gi, ' ')
    .replace(/(视频|短片|片子|看看|打开|播放|有没有|在哪|怎么看|哪里看)/g, ' ')
    .replace(/[的了吗呢啊呀]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreMissionReplay(q) {
  if (!hasMissionReplayAsk(q)) return 0
  // 飞行剖面「回放」留给 flight_demo
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo) return 0
  if (/(飞行剖面|剖面演示|剖面动画|飞行演示)/.test(q)) return 0
  let s = 45
  const cleaned = stripReplayAskNoise(q)
  const key = extractMissionSearchKey(cleaned) || cleaned
  if (KNOWN_VEHICLE_HINT.test(q) || KNOWN_VEHICLE_HINT.test(key)) s += 35
  else if (key && key.length >= 2) s += 25
  if (/(视频|短片|片子|集锦)/.test(q)) s += 10
  if (!key || key.length < 2) s -= 25
  return s
}

function scoreMissionLookup(q) {
  if (isPureChitchat(q)) return 0
  if (isBareStarshipProgressAsk(q)) return 0
  // 更高优先级意图已够分则不再抢
  if (scoreStarshipNextFlight(q) >= INTENT_SCORE_THRESHOLD.starship_next) return 0
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo || scoreMissionSim(q) >= 38 ||
    scoreVehicleTracker(q) >= INTENT_SCORE_THRESHOLD.vehicle_tracker) return 0
  if (scoreRoadClosure(q) >= 36 || scoreStation(q) >= 36) return 0
  // 「星舰试飞直播」带任务名也该出直播卡，不去查任务详情
  if (scoreLiveWatch(q) >= INTENT_SCORE_THRESHOLD.live_watch) return 0
  if (scoreStarshipStatus(q) >= INTENT_SCORE_THRESHOLD.starship_status && !hasNonStarshipRocketEntity(q)) return 0
  if (scoreLaunchStats(q) >= INTENT_SCORE_THRESHOLD.launch_stats) return 0
  if (scoreLaunchList(q) >= INTENT_SCORE_THRESHOLD.launch_list) return 0
  if (scoreAgency(q) >= INTENT_SCORE_THRESHOLD.agency) return 0
  if (scoreMissionReplay(q) >= INTENT_SCORE_THRESHOLD.mission_replay) return 0
  // 百科 / 个人化 / 内容意图已够分时不抢（「猎鹰9多高」不该出任务卡）
  if (scoreBooster(q) >= INTENT_SCORE_THRESHOLD.booster) return 0
  if (scoreRocketModel(q) >= INTENT_SCORE_THRESHOLD.rocket_model) return 0
  if (scoreLaunchSite(q) >= INTENT_SCORE_THRESHOLD.launch_site) return 0
  if (scoreSpacecraft(q) >= INTENT_SCORE_THRESHOLD.spacecraft) return 0
  if (scoreMyLaunches(q) >= INTENT_SCORE_THRESHOLD.my_launches) return 0
  if (scoreLaunchVote(q) >= INTENT_SCORE_THRESHOLD.launch_vote) return 0
  if (scoreAstroCalendar(q) >= INTENT_SCORE_THRESHOLD.astro_calendar) return 0
  if (scoreApod(q) >= INTENT_SCORE_THRESHOLD.apod) return 0
  if (scoreStarlinkPass(q) >= INTENT_SCORE_THRESHOLD.starlink_pass) return 0
  if (scoreStarlinkMap(q) >= INTENT_SCORE_THRESHOLD.starlink_map) return 0
  if (scoreViewingSpot(q) >= INTENT_SCORE_THRESHOLD.viewing_spot) return 0
  if (scoreArtemis(q) >= INTENT_SCORE_THRESHOLD.artemis) return 0
  if (scoreStarshipHardware(q) >= INTENT_SCORE_THRESHOLD.starship_hardware) return 0
  if (scoreRecoveryStats(q) >= INTENT_SCORE_THRESHOLD.recovery_stats) return 0

  const key = extractMissionSearchKey(q)
  if (!key || key.length < 2) return 0
  if (/^(发射|火箭|任务|航天|太空|空间|卫星|飞船)$/i.test(key)) return 0

  let s = 10
  if (KNOWN_VEHICLE_HINT.test(q) || KNOWN_VEHICLE_HINT.test(key)) s += 40
  if (/flight\s*\d+|ift-?\d+|第?\d+\s*次/i.test(q)) s += 35
  if (/[一二三四五六七八九十\d]+号/.test(key)) s += 40
  if (/(什么时候|啥时候|何时|几号|哪天|升空|起飞|发射)/.test(q) && key.length >= 2) s += 25
  if (/(介绍|详情|怎么样|咋样)/.test(q) && key.length >= 2) s += 18
  if (key.length >= 2 && key.length <= 28) {
    if (/[\u4e00-\u9fff]{2,}/.test(key) || /[A-Za-z]{3,}/.test(key) || /\d/.test(key)) s += 20
  }
  return s
}

// ══════════ 扩展意图：百科（火箭/发射场/飞船/助推器）· 个人化 · 内容 ══════════

/** 火箭家族（只认运载火箭，飞船交给 spacecraft 意图） */
const ROCKET_FAMILY_HINT =
  /(猎鹰|falcon|星舰|starship|超重|长征|cz\s*-?\s*\d|朱雀|zhuque|谷神|ceres|引力一?号|gravity-?1|快舟|捷龙|力箭|双曲线|谷神星|电子号|electron|中子号|neutron|新格伦|new\s*glenn|vulcan|atlas\s*v|delta\s*iv|ariane|阿丽亚娜|h3火箭|pslv|gslv|\bsls\b|安加拉|angara|质子号|proton|重型猎鹰)/i

/** 飞船 / 载人航天器 */
const SPACECRAFT_HINT =
  /(飞船|载人舱|返回舱|乘员舱|神舟|shenzhou|天舟|tianzhou|龙飞船|crew\s*dragon|cargo\s*dragon|\bdragon\b|starliner|星际客机|联盟号|soyuz|进步号|猎户座|orion|新谢泼德|new\s*shepard)/i

/** 发射场 / 工位 */
const LAUNCH_SITE_HINT =
  /(发射场|发射中心|发射基地|航天中心|发射工位|工位|发射台|发射阵地|\bpad\b|\bLC-?\d|\bSLC-?\d|39a|39b|文昌|酒泉|太原|西昌|东风航天|海阳|卡纳维拉尔|卡角|肯尼迪航天|范登堡|瓦勒普斯|库鲁|圭亚那航天|拜科努尔|东方港|种子岛|内之浦|斯里赫里戈达|starbase|boca\s*chica)/i

/** 中文地名 → LL2 英文场站名关键词 */
const LAUNCH_SITE_ALIAS = {
  wenchang: ['文昌'],
  jiuquan: ['酒泉', '东风航天'],
  taiyuan: ['太原'],
  xichang: ['西昌'],
  'cape canaveral': ['卡纳维拉尔', '卡角'],
  'kennedy': ['肯尼迪', '39a', '39b'],
  vandenberg: ['范登堡'],
  wallops: ['瓦勒普斯'],
  kourou: ['库鲁', '圭亚那航天'],
  baikonur: ['拜科努尔'],
  vostochny: ['东方港'],
  tanegashima: ['种子岛'],
  uchinoura: ['内之浦'],
  satish: ['斯里赫里戈达'],
  starbase: ['星舰基地', '博卡奇卡', 'boca chica'],
  'yellow sea': ['黄海', '海阳']
}

/** 中文飞船名 → LL2 英文构型名关键词 */
const SPACECRAFT_ALIAS = {
  shenzhou: ['神舟'],
  tianzhou: ['天舟'],
  'crew dragon': ['载人龙', '载人龙飞船'],
  'cargo dragon': ['货运龙'],
  dragon: ['龙飞船'],
  starliner: ['星际客机'],
  soyuz: ['联盟号'],
  progress: ['进步号'],
  orion: ['猎户座'],
  'new shepard': ['新谢泼德']
}

/** 参数类问法（多高/运力/推力…） */
function hasSpecAsk(q) {
  return /(多高|多长|多重|多大|多粗|直径|高度|全长|起飞质量|运力|运载能力|载荷|推力|几级|级数|参数|规格|指标|多少吨|多少米|多少公斤|能带多少|型号|构型)/.test(q)
}

/** 明确的排期问法（该给任务卡，不给百科卡） */
function hasScheduleAsk(q) {
  return /(什么时候|啥时候|何时|几号|哪天|下次|下一次|即将|接下来|发射时间|发射日期|排期|倒计时)/.test(q)
}

/** 已有导航型意图是否已够分（新意图统一让位，避免抢卡） */
function navIntentFires(q) {
  if (scoreStarshipNextFlight(q) >= INTENT_SCORE_THRESHOLD.starship_next) return true
  if (scoreFlightDemo(q) >= INTENT_SCORE_THRESHOLD.flight_demo) return true
  if (scoreMissionSim(q) >= INTENT_SCORE_THRESHOLD.mission_sim) return true
  if (scoreVehicleTracker(q) >= INTENT_SCORE_THRESHOLD.vehicle_tracker) return true
  if (scoreRoadClosure(q) >= INTENT_SCORE_THRESHOLD.road_closure) return true
  if (scoreStation(q) >= INTENT_SCORE_THRESHOLD.station) return true
  return false
}

/** 猎鹰系助推器编号（B1067）；星舰 B15 是两位数，不在此列 */
function extractBoosterSerial(text) {
  const m = String(text || '').match(/\bB\s*-?\s*(1\d{3})\b/i)
  return m ? 'B' + m[1] : ''
}

/** 去掉百科问法噪声，留下实体名 */
function stripSpecAskNoise(text) {
  return String(text || '')
    .replace(/[？?！!。．.，,、；;：:…]+/g, ' ')
    .replace(/(有多高|有多长|有多重|多高|多长|多重|多大|多粗|直径|高度|全长|起飞质量|运载能力|运力|载荷|推力|几级|级数|参数|规格|指标|多少吨|多少米|多少公斤|能带多少)/g, ' ')
    .replace(/(能坐几人|坐几人|几个人|几人|多少人|乘员|容量|在役|现役|退役)/g, ' ')
    .replace(/(在哪里|在哪|哪里|位置|坐标|地图|怎么走|几个工位|多少次发射|发射过多少)/g, ' ')
    .replace(/(飞了几次|复用|重复使用|回收|战绩|家谱|谱系|记录|排行|榜)/g, ' ')
    .replace(/(介绍一下|介绍下|介绍|讲讲|说说|资料|百科|详情|图鉴|档案|是什么|怎么样|如何|看看|打开|查一下|查询|帮我|我想|想看|了解一下|了解)/g, ' ')
    .replace(/(是多少|多少|几个|火箭型号)/g, ' ')
    .replace(/(的|了|吗|呢|啊|吧|呀|嘛|是|有|和|与)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractRocketModelKey(text) {
  return stripSpecAskNoise(text).replace(/(运载火箭|火箭)/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractLaunchSiteKey(text) {
  return stripSpecAskNoise(text)
    .replace(/(发射场|发射中心|发射基地|航天中心|发射工位|工位|发射台|发射阵地)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSpacecraftKey(text) {
  return stripSpecAskNoise(text)
    .replace(/(载人飞船|货运飞船|飞船)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreRocketModel(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (hasScheduleAsk(q) || /首飞时间/.test(q)) return 0
  if (!ROCKET_FAMILY_HINT.test(q)) return 0
  if (LAUNCH_SITE_HINT.test(q)) return 0
  if (extractBoosterSerial(q)) return 0
  // 「龙飞船多大」交给 spacecraft
  if (SPACECRAFT_HINT.test(q) && !/(火箭|运载)/.test(q)) return 0
  if (!hasSpecAsk(q)) return 0
  let s = 45
  if (/(火箭|运载)/.test(q)) s += 12
  if (/(型号|构型|参数|规格)/.test(q)) s += 12
  if (/(多高|多长|多重|直径|运力|推力|级数|几级|起飞质量)/.test(q)) s += 15
  return s
}

/** 已知观礼点名（用户直接问「淇水湾怎么去」时也走观礼卡） */
const VIEWING_SPOT_HINT = /(淇水湾|铜鼓岭|石头公园|龙楼|playalinda|普拉亚琳达|space\s*view\s*park|太空观景公园|isla\s*blanca|伊斯拉布兰卡|jetty\s*park|防波堤公园|jalama|哈拉马|surf\s*beach|南帕德里|伊莎贝尔港|马克斯布鲁尔)/i

/** 直播关键词（视频号 / B站 / 通用「直播」；「转播」「开播」同义） */
const LIVE_WATCH_HINT = /(直播|转播|开播|直播间|live\s*stream|livestream|watch\s*live)/i

/**
 * 观看发射直播（「在哪看直播」「有直播吗」「直播间」）
 * 与 viewing_spot 的分界：问「人去哪站着看」是观礼点，问「哪儿能看到画面」是直播；
 * 与 mission_replay 的分界：带「回放/集锦」的要的是录播视频，让回放卡接走。
 */
function scoreLiveWatch(q) {
  if (isPureChitchat(q)) return 0
  if (!LIVE_WATCH_HINT.test(q)) return 0
  if (scoreMissionReplay(q) >= INTENT_SCORE_THRESHOLD.mission_replay) return 0
  let s = 50
  if (/(在哪|哪里|哪儿|怎么看|哪能看|去哪|有没有|有吗|怎么找|入口|链接|地址|哪个平台|什么平台)/.test(q)) s += 20
  if (/(视频号|b\s*站|bilibili|哔哩)/i.test(q)) s += 20
  if (hasLaunchDomain(q) || hasStarshipEntity(q)) s += 15
  return s
}

/**
 * 现场观礼点导航（「去哪看发射」「文昌观礼点」）
 * 与 launch_site 的分界：问发射场本身参数走百科，问「人站哪儿看」走这里
 */
function scoreViewingSpot(q) {
  if (isPureChitchat(q)) return 0
  // 「今晚哪里能看到星链」是过境预报，不是发射观礼
  if (scoreStarlinkPass(q) >= INTENT_SCORE_THRESHOLD.starlink_pass) return 0
  if (scoreStarlinkMap(q) >= INTENT_SCORE_THRESHOLD.starlink_map) return 0
  // 「在哪看直播」问的是画面来源，不是现场站位
  if (scoreLiveWatch(q) >= INTENT_SCORE_THRESHOLD.live_watch) return 0
  const spotNamed = VIEWING_SPOT_HINT.test(q)
  if (!spotNamed && !/(发射|火箭|升空|起飞|试飞|星舰|starship|猎鹰|长征|观礼)/i.test(q)) return 0
  let s = 0
  if (/(观礼|观景点|观看点|观测点|观赏点|打卡点|机位|蹲点)/.test(q)) s += 60
  else if (/(现场看|去现场|亲眼看|去哪看|哪里看|在哪看|哪儿看|哪能看|哪里能看|在哪能看|哪里可以看|哪儿能看|最佳位置|最佳地点|最佳观|推荐位置|去哪儿看)/.test(q)) s += 50
  else if (/(看|观看|围观)/.test(q) && /(去哪|哪里|在哪|哪儿|什么位置|什么地方|哪个位置|哪个地方)/.test(q)) s += 50
  else if (spotNamed && /(怎么去|怎么走|导航|路线|停车|门票|多远|远不远|在哪|位置)/.test(q)) s += 55
  if (!s) return 0
  if (/(导航|怎么去|怎么走|路线|自驾|停车|门票)/.test(q)) s += 15
  return s
}

function scoreLaunchSite(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  // 「文昌哪里看发射」问的是观礼站位，不是发射场百科
  if (scoreViewingSpot(q) >= INTENT_SCORE_THRESHOLD.viewing_spot) return 0
  if (!LAUNCH_SITE_HINT.test(q)) return 0
  if (hasScheduleAsk(q) && !/(发射场|发射中心|工位|发射台)/.test(q)) return 0
  let s = 40
  if (/(在哪|哪里|位置|坐标|地图|怎么走|介绍|资料|百科|详情|工位|发射台|多少次发射|发射过多少)/.test(q)) s += 20
  if (/(发射场|发射中心|航天中心|发射基地)/.test(q)) s += 15
  return s
}

function scoreSpacecraft(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (hasScheduleAsk(q)) return 0
  // 「阿尔忒弥斯的猎户座」交给 artemis
  if (scoreArtemis(q) >= INTENT_SCORE_THRESHOLD.artemis) return 0
  if (!SPACECRAFT_HINT.test(q)) return 0
  let s = 40
  if (/(几人|多少人|乘员|坐几|容量|参数|规格|介绍|资料|百科|是什么|多重|多大|直径|长度|在役|现役|退役|执行过|多少次任务)/.test(q)) s += 22
  if (/(飞船|返回舱|载人舱|乘员舱)/.test(q)) s += 10
  return s
}

function scoreBooster(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  const serial = extractBoosterSerial(q)
  const boosterWord = /(助推器|\bbooster\b|一级火箭|芯级)/i.test(q)
  const reuseWord = /(复用|重复使用|回收|飞了几次|战绩|家谱|谱系|复飞|第几次飞|最多|排行)/i.test(q)
  if (!serial && !boosterWord && !reuseWord) return 0
  // 聚合口径（成功率/排行/一共）交给 recovery_stats；星舰硬件编号交给 starship_hardware
  if (!serial && scoreRecoveryStats(q) >= INTENT_SCORE_THRESHOLD.recovery_stats) return 0
  if (!serial && scoreStarshipHardware(q) >= INTENT_SCORE_THRESHOLD.starship_hardware) return 0
  // 星舰 B/S 进展交给 starship_status
  if (!serial && /星舰|starship|超重/i.test(q) && !/(家谱|谱系|复用排行)/.test(q)) return 0
  let s = 0
  if (serial) s += 55
  if (boosterWord) s += 25
  if (reuseWord) s += 25
  // 「助推器复用排行」这类问法会被发射统计误吸走，双信号命中时压过去
  if (boosterWord && reuseWord) s += 20
  return s
}

/** 星链过境观测（需定位，卡片只做入口） */
function scoreStarlinkPass(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (!/(星链|starlink)/i.test(q)) return 0
  if (!/(过境|经过|飞过|能看到|看得到|观测|抬头|肉眼|几点看|什么时候看|预报|列车)/.test(q)) return 0
  let s = 50
  if (/(今晚|今天|明天|几点|什么时候)/.test(q)) s += 15
  return s
}

/** 星链星座实时分布（在轨颗数 / 分布图 / 「星链在哪」） */
function scoreStarlinkMap(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (!/(星链|starlink)/i.test(q)) return 0
  if (hasScheduleAsk(q)) return 0
  if (scoreStarlinkPass(q) >= INTENT_SCORE_THRESHOLD.starlink_pass) return 0
  if (scoreMissionReplay(q) >= INTENT_SCORE_THRESHOLD.mission_replay) return 0
  let s = 0
  if (/(实时分布|分布图|分布|星座|在轨|轨道图|地图|3d|三维)/i.test(q)) s += 50
  if (/(多少颗|几颗|数量|总数|有多少)/.test(q)) s += 55
  if (/(在哪|在哪儿|哪里)/.test(q)) s += 55
  if (!s) return 0
  if (/(看看|打开|查看|瞅瞅|给我看)/.test(q)) s += 20
  return s
}

/** 阿尔忒弥斯任务（猎户座在此优先于通用飞船百科） */
function scoreArtemis(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (!/(阿尔忒弥斯|阿耳忒弥斯|artemis)/i.test(q)) return 0
  let s = 55
  if (/(什么时候|进展|遥测|轨道|绕月|载人|乘组|状态)/.test(q)) s += 15
  return s
}

/**
 * 星舰硬件编号（B15 / S38 / 助推器15 / 飞船38）
 * 猎鹰助推器是四位数（B1067），这里只认 1-2 位，避免互抢
 * @returns {{ kind: string, num: number }|null}
 */
function extractStarshipHardwareRef(text) {
  const q = String(text || '')
  let m = q.match(/\bB\s*-?\s*(\d{1,2})\b/i)
  if (m) return { kind: 'booster', num: Number(m[1]) }
  m = q.match(/\bS\s*-?\s*(\d{1,2})\b/i)
  if (m) return { kind: 'ship', num: Number(m[1]) }
  m = q.match(/(?:超重)?助推器\s*(\d{1,2})(?!\d)/)
  if (m) return { kind: 'booster', num: Number(m[1]) }
  m = q.match(/(?:星舰)?飞船\s*(\d{1,2})(?!\d)/)
  if (m) return { kind: 'ship', num: Number(m[1]) }
  return null
}

function scoreStarshipHardware(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  const ref = extractStarshipHardwareRef(q)
  const listAsk = /(星舰硬件|硬件设施|硬件列表|在建硬件|硬件进度)/.test(q)
  if (!ref && !listAsk) return 0
  // 猎鹰助推器编号（B1067）走 booster 意图
  if (extractBoosterSerial(q)) return 0
  let s = 0
  if (ref) s += 50
  if (listAsk) s += 50
  if (/(在哪|哪里|状态|什么情况|怎么样|进展|测试|静态点火|下线|运到|报废|拆解)/.test(q)) s += 20
  return s
}

/** 回收/复用总览（聚合口径，单枚编号仍走 booster） */
function scoreRecoveryStats(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (extractBoosterSerial(q)) return 0
  if (!/(回收|复用|重复使用|着陆|海上平台)/.test(q)) return 0
  if (!/(成功率|统计|总共|一共|多少枚|多少次|排行|榜|最多|平均|概况|总览)/.test(q)) return 0
  return 60
}

function scoreMyLaunches(q) {
  if (isPureChitchat(q)) return 0
  if (!/我/.test(q)) return 0
  let s = 0
  if (/我(的)?(订阅|提醒|关注|收藏|日程|发射日程)/.test(q)) s += 55
  if (/(订阅|提醒|关注|收藏)(了)?(哪些|什么|列表|清单)/.test(q)) s += 30
  if (/我(设置|加)了/.test(q)) s += 25
  if (!s) return 0
  return s
}

function scoreYearReview(q) {
  if (!/(年度回顾|年终总结|年度报告|年度总结|年度数据|我的\d{4}年?|今年我(看|追)了)/.test(q)) return 0
  return 60
}

function scoreLaunchVote(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  let s = 0
  if (/(竞猜|投票|押注|下注|猜一下|猜猜|我猜|赌)/.test(q)) s += 50
  if (/(能成功吗|会成功吗|会不会成功|能不能成功|会准时吗|会推迟吗|会不会推迟|能按时吗|准时吗)/.test(q)) s += 45
  if (!s) return 0
  if (/(发射|任务|这次|下次)/.test(q)) s += 10
  return s
}

function scoreApod(q) {
  if (!/(每日天文图|每日一图|天文图片|天文美图|今日天文|\bapod\b|nasa\s*图)/i.test(q)) return 0
  return 60
}

function scoreAstroCalendar(q) {
  if (isPureChitchat(q)) return 0
  if (!/(天象|流星雨|日食|月食|超级月亮|血月|观星|星空|英仙座|双子座|狮子座|象限仪|冲日|东大距|凌日|合月|极光|天文日历|天象日历)/.test(q)) {
    return 0
  }
  let s = 45
  if (/(什么时候|最近|近期|几号|哪天|有哪些|时间|预报|日历)/.test(q)) s += 20
  return s
}

function scoreNews(q) {
  if (isPureChitchat(q) || navIntentFires(q)) return 0
  if (scoreStarshipStatus(q) >= INTENT_SCORE_THRESHOLD.starship_status) return 0
  if (scoreLaunchList(q) >= INTENT_SCORE_THRESHOLD.launch_list) return 0
  if (scoreLaunchStats(q) >= INTENT_SCORE_THRESHOLD.launch_stats) return 0
  // 有具体火箭/机构实体时交给任务或发射商意图
  if (KNOWN_VEHICLE_HINT.test(q) || detectAgencyAliasHit(q)) return 0
  if (!/(航天新闻|太空新闻|新闻|资讯|头条|最新消息|有什么大事|有什么新鲜事)/.test(q)) return 0
  let s = 45
  if (/(航天|太空|发射)/.test(q)) s += 15
  return s
}

/**
 * 火箭构型匹配（_config_meta 的 configs map）
 * @param {object} configs { [configId]: cfg }
 * @param {string} queryKey
 * @returns {{ id: string, config: object, score: number }|null}
 */
function pickRocketConfig(configs, queryKey) {
  const key = normalizeMatchText(queryKey)
  if (!key || key.length < 2) return null
  const map = configs && typeof configs === 'object' ? configs : {}
  let best = null
  Object.keys(map).forEach((id) => {
    const cfg = map[id]
    if (!cfg) return
    const hay = normalizeMatchText([cfg.name, cfg.full_name, cfg.alias, cfg.variant].filter(Boolean).join(' '))
    if (!hay) return
    let score = 0
    if (hay === key) score += 140
    else if (hay.indexOf(key) >= 0) score += 90
    else if (key.indexOf(hay) >= 0 && hay.length >= 3) score += 60
    if (!score) return
    // 同系列多构型：取实际飞得最多的主力型号
    score += Math.min(Number(cfg.total_launch_count) || 0, 400) / 100
    if (!best || score > best.score) {
      best = { id: String(cfg.id != null ? cfg.id : id), config: cfg, score }
    }
  })
  return best
}

/** NSF 硬件名（Booster 15 / Ship 38 / Super Heavy Booster 15）→ 编号引用 */
function parseHardwareVehicleRef(name) {
  const n = String(name || '').toLowerCase()
  let m = n.match(/(?:booster|super\s*heavy)\s*-?\s*(\d{1,3})/)
  if (m) return { kind: 'booster', num: Number(m[1]) }
  m = n.match(/(?:starship|ship)\s*-?\s*(\d{1,3})/)
  if (m) return { kind: 'ship', num: Number(m[1]) }
  m = n.match(/^\s*b\s*-?\s*(\d{1,3})\b/)
  if (m) return { kind: 'booster', num: Number(m[1]) }
  m = n.match(/^\s*s\s*-?\s*(\d{1,3})\b/)
  if (m) return { kind: 'ship', num: Number(m[1]) }
  return null
}

/**
 * 星舰硬件匹配（B15 / S38 → NSF vehicles 条目）
 * @param {object[]} vehicles
 * @param {string} queryText
 */
function pickStarshipHardware(vehicles, queryText) {
  const ref = extractStarshipHardwareRef(queryText)
  if (!ref) return null
  const rows = Array.isArray(vehicles) ? vehicles : []
  for (let i = 0; i < rows.length; i += 1) {
    const v = rows[i]
    if (!v || !v.name) continue
    const parsed = parseHardwareVehicleRef(v.name)
    if (parsed && parsed.kind === ref.kind && parsed.num === ref.num) return v
  }
  return null
}

/** 把中文实体名换成别名表里的英文关键词（命不中返回原串） */
function expandAliasKeys(queryText, aliasMap) {
  const q = String(queryText || '').toLowerCase()
  const out = []
  Object.keys(aliasMap || {}).forEach((en) => {
    const aliases = aliasMap[en] || []
    const hit = en && q.indexOf(en) >= 0
      ? true
      : aliases.some((al) => al && q.indexOf(String(al).toLowerCase()) >= 0)
    if (hit) out.push(en)
  })
  return out
}

/**
 * 发射场匹配：先用中文别名换英文关键词，再退回原串包含匹配
 * @param {object[]} list LL2 location 列表（{ id, name, ... }）
 * @param {string} queryText 原始问法
 */
function pickLaunchSite(list, queryText) {
  const rows = Array.isArray(list) ? list.filter((s) => s && s.id != null) : []
  if (!rows.length) return null
  const keys = expandAliasKeys(queryText, LAUNCH_SITE_ALIAS)
  const rawKey = normalizeMatchText(extractLaunchSiteKey(queryText))
  let best = null
  rows.forEach((site) => {
    const nameLower = String(site.name || site.nameZh || '').toLowerCase()
    const nName = normalizeMatchText(site.name || site.nameZh)
    let score = 0
    keys.forEach((k) => {
      if (nameLower.indexOf(k) >= 0) score += 100
    })
    if (!score && rawKey && rawKey.length >= 2 && nName.indexOf(rawKey) >= 0) score += 60
    if (!score) return
    const launches = Number(site.totalLaunchCount != null ? site.totalLaunchCount : site.total_launch_count) || 0
    score += Math.min(launches, 500) / 100
    if (!best || score > best.score) best = { site, score }
  })
  return best
}

/**
 * 飞船构型匹配
 * @param {object[]} list LL2 spacecraft configuration 列表
 * @param {string} queryText
 */
function pickSpacecraftConfig(list, queryText) {
  const rows = Array.isArray(list) ? list.filter((s) => s && s.id != null) : []
  if (!rows.length) return null
  const keys = expandAliasKeys(queryText, SPACECRAFT_ALIAS)
  const rawKey = normalizeMatchText(extractSpacecraftKey(queryText))
  let best = null
  rows.forEach((sc) => {
    const nameLower = String(sc.name || '').toLowerCase()
    const nName = normalizeMatchText(sc.name)
    let score = 0
    keys.forEach((k) => {
      if (nameLower.indexOf(k) >= 0) score += 100
    })
    if (!score && rawKey && rawKey.length >= 2 && nName.indexOf(rawKey) >= 0) score += 60
    if (!score) return
    if (sc.inUse === true || sc.in_use === true) score += 8
    if (sc.humanRated === true || sc.human_rated === true) score += 4
    if (!best || score > best.score) best = { config: sc, score }
  })
  return best
}

function scoreAllRichIntents(text) {
  const q = String(text || '').trim()
  if (!q || isPureChitchat(q)) {
    return {
      starship_next: 0,
      flight_demo: 0,
      mission_sim: 0,
      vehicle_tracker: 0,
      road_closure: 0,
      station: 0,
      live_watch: 0,
      starlink_pass: 0,
      starlink_map: 0,
      viewing_spot: 0,
      artemis: 0,
      my_launches: 0,
      year_review: 0,
      launch_vote: 0,
      starship_hardware: 0,
      recovery_stats: 0,
      booster: 0,
      rocket_model: 0,
      launch_site: 0,
      spacecraft: 0,
      apod: 0,
      astro_calendar: 0,
      starship_status: 0,
      launch_stats: 0,
      launch_list: 0,
      agency: 0,
      news: 0,
      mission_replay: 0,
      mission_lookup: 0
    }
  }
  return {
    starship_next: scoreStarshipNextFlight(q),
    flight_demo: scoreFlightDemo(q),
    mission_sim: scoreMissionSim(q),
    vehicle_tracker: scoreVehicleTracker(q),
    road_closure: scoreRoadClosure(q),
    station: scoreStation(q),
    live_watch: scoreLiveWatch(q),
    starlink_pass: scoreStarlinkPass(q),
    starlink_map: scoreStarlinkMap(q),
    viewing_spot: scoreViewingSpot(q),
    artemis: scoreArtemis(q),
    my_launches: scoreMyLaunches(q),
    year_review: scoreYearReview(q),
    launch_vote: scoreLaunchVote(q),
    starship_hardware: scoreStarshipHardware(q),
    recovery_stats: scoreRecoveryStats(q),
    booster: scoreBooster(q),
    rocket_model: scoreRocketModel(q),
    launch_site: scoreLaunchSite(q),
    spacecraft: scoreSpacecraft(q),
    apod: scoreApod(q),
    astro_calendar: scoreAstroCalendar(q),
    starship_status: scoreStarshipStatus(q),
    launch_stats: scoreLaunchStats(q),
    launch_list: scoreLaunchList(q),
    agency: scoreAgency(q),
    news: scoreNews(q),
    mission_replay: scoreMissionReplay(q),
    mission_lookup: scoreMissionLookup(q)
  }
}

function matchStarshipNextFlightIntent(text) {
  return scoreStarshipNextFlight(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.starship_next
}

function matchStarshipStatusIntent(text) {
  return scoreStarshipStatus(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.starship_status
}

function matchLaunchStatsIntent(text) {
  return scoreLaunchStats(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.launch_stats
}

function matchLaunchListIntent(text) {
  return scoreLaunchList(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.launch_list
}

function matchFlightDemoIntent(text) {
  return scoreFlightDemo(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.flight_demo
}

function matchMissionSimIntent(text) {
  return scoreMissionSim(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.mission_sim
}

function matchVehicleTrackerIntent(text) {
  return scoreVehicleTracker(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.vehicle_tracker
}

function matchRoadClosureIntent(text) {
  return scoreRoadClosure(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.road_closure
}

function matchStationIntent(text) {
  return scoreStation(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.station
}

function matchAgencyIntent(text) {
  return scoreAgency(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.agency
}

function matchMissionLookupIntent(text) {
  return scoreMissionLookup(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.mission_lookup
}

function matchMissionReplayIntent(text) {
  return scoreMissionReplay(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.mission_replay
}

function matchRocketModelIntent(text) {
  return scoreRocketModel(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.rocket_model
}

function matchLaunchSiteIntent(text) {
  return scoreLaunchSite(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.launch_site
}

function matchSpacecraftIntent(text) {
  return scoreSpacecraft(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.spacecraft
}

function matchBoosterIntent(text) {
  return scoreBooster(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.booster
}

function matchMyLaunchesIntent(text) {
  return scoreMyLaunches(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.my_launches
}

function matchYearReviewIntent(text) {
  return scoreYearReview(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.year_review
}

function matchLaunchVoteIntent(text) {
  return scoreLaunchVote(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.launch_vote
}

function matchApodIntent(text) {
  return scoreApod(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.apod
}

function matchAstroCalendarIntent(text) {
  return scoreAstroCalendar(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.astro_calendar
}

function matchNewsIntent(text) {
  return scoreNews(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.news
}

function matchStarlinkPassIntent(text) {
  return scoreStarlinkPass(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.starlink_pass
}

function matchLiveWatchIntent(text) {
  return scoreLiveWatch(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.live_watch
}

function matchStarlinkMapIntent(text) {
  return scoreStarlinkMap(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.starlink_map
}

function matchViewingSpotIntent(text) {
  return scoreViewingSpot(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.viewing_spot
}

function matchArtemisIntent(text) {
  return scoreArtemis(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.artemis
}

function matchStarshipHardwareIntent(text) {
  return scoreStarshipHardware(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.starship_hardware
}

function matchRecoveryStatsIntent(text) {
  return scoreRecoveryStats(String(text || '').trim()) >= INTENT_SCORE_THRESHOLD.recovery_stats
}

/**
 * 多信号打分选最优意图（同分按 INTENT_PRIORITY）
 * @returns {string|null}
 */
function resolveAiChatRichIntent(text) {
  const q = String(text || '').trim()
  if (!q || isPureChitchat(q)) return null
  const scores = scoreAllRichIntents(q)
  let best = null
  let bestScore = -1
  for (let i = 0; i < INTENT_PRIORITY.length; i += 1) {
    const intent = INTENT_PRIORITY[i]
    const s = scores[intent] || 0
    const th = INTENT_SCORE_THRESHOLD[intent] || 40
    if (s < th) continue
    if (s > bestScore) {
      bestScore = s
      best = intent
    }
  }
  return best
}

function normalizeAgencyToken(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function compactAgencyToken(s) {
  return normalizeAgencyToken(s).replace(/\s+/g, '')
}

/** 查询是否命中某别名条目（拉丁串≥3、中文≥2，避免 as/ca 一类短串误伤） */
function queryHitsAgencyAlias(key, alias) {
  const k = normalizeAgencyToken(key)
  const a = normalizeAgencyToken(alias)
  if (!k || !a) return false
  if (k === a) return true
  const isLatin = /^[a-z0-9][a-z0-9 .'-]*$/i.test(a)
  const minLen = isLatin ? 3 : 2
  if (a.length < minLen) return false
  if (k.includes(a)) return true
  if (k.length >= minLen && a.includes(k)) return true
  return false
}

/** 机构是否就是别名表里的 canonical（禁止 enKey.includes(abbrev) 这类反向短串误伤） */
function agencyMatchesCanonical(agency, enKey) {
  if (!agency || !enKey) return false
  const name = normalizeAgencyToken(agency.name)
  const abbrev = normalizeAgencyToken(agency.abbrev)
  const canon = normalizeAgencyToken(enKey)
  if (!canon) return false

  // 硬 ID 优先
  const hardIds = AGENCY_CANONICAL_IDS[canon] || AGENCY_CANONICAL_IDS[enKey] || []
  if (agency.id != null && hardIds.some((id) => String(id) === String(agency.id))) return true

  if (abbrev === canon || compactAgencyToken(abbrev) === compactAgencyToken(canon)) return true
  if (name === canon || compactAgencyToken(name) === compactAgencyToken(canon)) return true
  if (canon.length >= 4 && (name.includes(canon) || compactAgencyToken(name).includes(compactAgencyToken(canon)))) {
    return true
  }

  // 英文缩写别名（如 SpX ↔ spacex）；中文别名不拿来比对英文 name
  const aliases = AGENCY_ALIAS_MAP[enKey] || AGENCY_ALIAS_MAP[canon] || []
  for (let i = 0; i < aliases.length; i += 1) {
    const a = normalizeAgencyToken(aliases[i])
    if (!a || a.length < 2) continue
    if (!/^[a-z0-9][a-z0-9 .'-]*$/i.test(a)) continue
    if (abbrev === a || compactAgencyToken(abbrev) === compactAgencyToken(a)) return true
    if (name === a || compactAgencyToken(name) === compactAgencyToken(a)) return true
  }
  return false
}

/**
 * 问法是否命中「知名发射商」别名；命中则返回 canonical key（casc / spacex…）
 * 未命中返回空串（与 resolveAgencyCanonicalSearchKey 不同：后者会回落原 key）
 */
function detectKnownAgencyCanonical(queryText) {
  const key = normalizeAgencyToken(extractAgencySearchKey(queryText) || queryText)
  if (!key) return ''
  const aliasKeys = Object.keys(AGENCY_ALIAS_MAP)
  let bestEn = ''
  let bestRank = -1
  for (let i = 0; i < aliasKeys.length; i += 1) {
    const enKey = aliasKeys[i]
    const aliases = AGENCY_ALIAS_MAP[enKey] || []
    for (let j = 0; j < aliases.length; j += 1) {
      const a = normalizeAgencyToken(aliases[j])
      if (!queryHitsAgencyAlias(key, a)) continue
      // 精确 > 问法包含别名 > 别名包含问法（避免「中国航天」被「中国航天科工集团」反向抢走）
      let rank = 0
      if (a === key) rank = 1000 + a.length
      else if (key.includes(a)) rank = 500 + a.length
      else rank = 100 + key.length - Math.max(0, a.length - key.length)
      if (rank > bestRank) {
        bestRank = rank
        bestEn = enKey
      }
    }
  }
  return bestEn
}

/**
 * 问法命中别名时返回英文 canonical（中国航天科技集团 → casc）；否则返回清洗后的原 key
 */
function resolveAgencyCanonicalSearchKey(queryText) {
  const known = detectKnownAgencyCanonical(queryText)
  if (known) return known
  return normalizeAgencyToken(extractAgencySearchKey(queryText) || queryText)
}

function scoreAgencyAgainstQuery(agency, queryText) {
  if (!agency || agency.id == null) return 0
  const key = normalizeAgencyToken(extractAgencySearchKey(queryText) || queryText)
  if (!key) return 0
  const name = normalizeAgencyToken(agency.name)
  const abbrev = normalizeAgencyToken(agency.abbrev)
  const knownCanon = detectKnownAgencyCanonical(queryText)

  // 知名发射商：非本尊直接 0 分，杜绝 Aérospatiale 之类串台
  if (knownCanon && !agencyMatchesCanonical(agency, knownCanon)) return 0

  let score = 0
  if (agency.id != null && knownCanon) {
    const hardIds = AGENCY_CANONICAL_IDS[knownCanon] || []
    if (hardIds.some((id) => String(id) === String(agency.id))) score = 100
  }

  if (abbrev === key || name === key || compactAgencyToken(abbrev) === compactAgencyToken(key)) {
    score = Math.max(score, 100)
  } else if (key.length >= 3 && (name.startsWith(key) || abbrev.startsWith(key))) {
    score = Math.max(score, 85)
  } else if (key.length >= 4 && (name.includes(key) || (abbrev.length >= 4 && abbrev.includes(key)))) {
    score = Math.max(score, 60)
  }

  if (knownCanon && agencyMatchesCanonical(agency, knownCanon)) {
    score = Math.max(score, 95)
  }
  return score
}

function pickBestAgencyMatch(list, queryText) {
  const rows = Array.isArray(list) ? list : []
  const knownCanon = detectKnownAgencyCanonical(queryText)

  // 知名发射商：硬 ID → 仅本尊池；找不到宁可不配卡，绝不串台
  if (knownCanon) {
    const hardIds = AGENCY_CANONICAL_IDS[knownCanon] || []
    for (let i = 0; i < hardIds.length; i += 1) {
      const id = hardIds[i]
      const byId = rows.find((a) => a && a.id != null && String(a.id) === String(id))
      if (byId) return { agency: byId, score: 100 }
    }
    let best = null
    let bestScore = 0
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i]
      if (!agencyMatchesCanonical(a, knownCanon)) continue
      const s = scoreAgencyAgainstQuery(a, queryText)
      if (s <= bestScore) continue
      bestScore = s
      best = a
    }
    if (!best) return null
    return { agency: best, score: Math.max(bestScore, 95) }
  }

  let best = null
  let bestScore = 0
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i]
    const s = scoreAgencyAgainstQuery(a, queryText)
    if (s <= bestScore) continue
    bestScore = s
    best = a
  }
  if (!best || bestScore < 50) return null
  return { agency: best, score: bestScore }
}

/** 从统计问法解析年份 / 国家 / 时段 */
function parseLaunchStatsFocus(text) {
  const q = String(text || '')
  const nowYear = new Date().getUTCFullYear()
  let year = nowYear
  const ym = q.match(/(20\d{2})\s*年?/)
  if (ym) year = Number(ym[1])
  else if (/去年/.test(q)) year = nowYear - 1

  let country = null
  const countryRules = [
    [/中国|国内|我国/, '中国'],
    [/美国|USA|\bUS\b/i, '美国'],
    [/俄罗斯|俄国/, '俄罗斯'],
    [/印度/, '印度'],
    [/日本/, '日本'],
    [/韩国|南韩/, '韩国'],
    [/法国/, '法国'],
    [/英国/, '英国'],
    [/以色列/, '以色列'],
    [/澳大利亚|澳洲/, '澳大利亚']
  ]
  for (let i = 0; i < countryRules.length; i += 1) {
    if (countryRules[i][0].test(q)) {
      country = countryRules[i][1]
      break
    }
  }

  let scope = 'year'
  if (/今天|今日/.test(q)) scope = 'today'
  else if (/本周|这周|这一周/.test(q)) scope = 'week'
  else if (/本月|这个月|当月/.test(q)) scope = 'month'

  return { year, country, scope }
}

/** 北京时间时段边界（供今日/本周/本月计数） */
function getBeijingPeriodBounds(scope, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const offset = 8 * 3600 * 1000
  const local = new Date(now + offset)
  const y = local.getUTCFullYear()
  const m = local.getUTCMonth()
  const d = local.getUTCDate()
  const dayStart = Date.UTC(y, m, d) - offset
  const dayEnd = dayStart + 24 * 3600 * 1000
  if (scope === 'today') return { start: dayStart, end: dayEnd }
  if (scope === 'week') {
    const dow = local.getUTCDay()
    const mondayOffset = dow === 0 ? 6 : dow - 1
    return { start: dayStart - mondayOffset * 24 * 3600 * 1000, end: dayEnd }
  }
  if (scope === 'month') {
    return { start: Date.UTC(y, m, 1) - offset, end: dayEnd }
  }
  return null
}

function classifyLaunchOutcomeForStats(mission) {
  if (!mission) return { success: false, failure: false }
  if (mission.success === true) return { success: true, failure: false }
  if (mission.isFailure === true || mission.isPartialFailure === true) {
    return { success: false, failure: true }
  }
  const cat = String(mission.statusCategory || '').toLowerCase()
  if (cat === 'success') return { success: true, failure: false }
  if (cat === 'failure' || cat === 'partial') return { success: false, failure: true }
  return { success: false, failure: false }
}

/** 在时间窗内按国家统计发射次数（纯函数，可单测） */
function countLaunchesInBounds(list, bounds, country) {
  const rows = Array.isArray(list) ? list : []
  const start = bounds && Number(bounds.start)
  const end = bounds && Number(bounds.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { total: 0, success: 0, failure: 0 }
  }
  let total = 0
  let success = 0
  let failure = 0
  for (let i = 0; i < rows.length; i += 1) {
    const m = rows[i]
    if (!m || !m.launchTime) continue
    const t = new Date(m.launchTime).getTime()
    if (!Number.isFinite(t) || t < start || t >= end) continue
    if (country) {
      const display = String(m.countryDisplay || '').trim()
      if (display !== country) continue
    }
    total += 1
    const outcome = classifyLaunchOutcomeForStats(m)
    if (outcome.success) success += 1
    if (outcome.failure) failure += 1
  }
  return { total, success, failure }
}

/** 按问法挑选空间站（天宫 / ISS），默认取列表第一项 */
function pickStation(list, text) {
  const rows = Array.isArray(list) ? list.filter((s) => s && s.id != null) : []
  if (!rows.length) return null
  const q = String(text || '')
  const byName = (re) => rows.find((s) => re.test(String(s.name || s.stationName || '')))
  if (/天宫|tiangong|中国空间站|\bCSS\b/i.test(q)) {
    return byName(/天宫|tiangong/i) || rows.find((s) => String(s.id) === '18') || null
  }
  if (/\bISS\b|国际空间站/i.test(q)) {
    return byName(/ISS|国际/i) || rows.find((s) => String(s.id) === '4') || null
  }
  return rows[0]
}

function pickStarshipMission(list, trackedId) {
  const rows = Array.isArray(list) ? list.filter(isUsableMissionForCard) : []
  if (!rows.length) return null
  const tid = trackedId != null ? String(trackedId).trim() : ''
  if (tid) {
    const hit = rows.find((m) => String(m.id) === tid)
    if (hit) return hit
  }
  return rows[0]
}

function pickLaunchList(list, limit, filter) {
  const n = Math.max(1, Math.min(Number(limit) || 5, 8))
  let rows = Array.isArray(list) ? list.filter(isUsableLaunchForCard) : []
  // 发射列表默认只出未来 60 天内；有国家/场站/机构筛时一并套用
  const effectiveFilter = filter && typeof filter === 'object'
    ? Object.assign({ withinDays: LAUNCH_LIST_WITHIN_DAYS }, filter)
    : { withinDays: LAUNCH_LIST_WITHIN_DAYS }
  rows = rows.filter((m) => missionMatchesLaunchListFilter(m, effectiveFilter))
  return rows.slice(0, n)
}

/**
 * 任务检索的时间倾向：「什么时候发射」要给即将发射，「回放/上次」才给历史
 * @returns {'upcoming'|'completed'|''}
 */
function missionLookupTimePreference(text) {
  const q = String(text || '').trim()
  if (!q) return ''
  if (/(回放|集锦|上次|上一次|上回|前一次|已经?发射|发射了吗|发射结果|成功了吗|失败了吗|首飞成功|历史)/.test(q)) {
    return 'completed'
  }
  if (/(什么时候|啥时候|何时|几号|哪天|哪一天|多久|还有多久|下次|下一次|下一发|接下来|即将|将于|要发|要打|发射时间|发射日期|发射窗口|倒计时|计划|排期|安排|首飞|首次发射|时间表|定档)/.test(q)) {
    return 'upcoming'
  }
  return ''
}

/** 任务归属：优先 _detailType，其次结果字段，最后按 NET 是否已过 */
function resolveMissionDetailType(mission) {
  if (!mission) return 'upcoming'
  if (mission._detailType === 'completed' || mission._detailType === 'upcoming') {
    return mission._detailType
  }
  if (mission.success != null || mission.isFailure != null) return 'completed'
  if (mission.launchTime) {
    const t = new Date(mission.launchTime).getTime()
    if (Number.isFinite(t) && t < Date.now()) return 'completed'
  }
  return 'upcoming'
}

/**
 * 任务检索打分：问谁就尽量命中谁
 * @returns {{ mission: object, score: number, detailType: string }|null}
 */
function scoreMissionAgainstQuery(mission, queryText) {
  if (!isUsableLaunchForCard(mission)) return null
  const raw = String(queryText || '').trim()
  const key = extractMissionSearchKey(raw) || raw
  if (!key) return null

  const nKey = normalizeMatchText(key)
  const nRaw = normalizeMatchText(raw)
  const name = String(mission.name || mission.missionName || '')
  const rocket = String(mission.rocketName || '')
  const agency = String(mission.launchAgency || '')
  const hay = normalizeMatchText([name, mission.missionName, rocket, agency].filter(Boolean).join(' '))
  if (!hay) return null

  let score = 0
  if (nKey && hay.indexOf(nKey) >= 0) score += 120
  if (nRaw && hay.indexOf(nRaw) >= 0) score += 40

  // 分词：中文 2-gram + 空白英文段
  const tokens = []
  String(key).split(/[\s/|]+/).forEach((t) => {
    const s = String(t || '').trim()
    if (s.length >= 2) tokens.push(s)
  })
  const compact = key.replace(/\s+/g, '')
  if (/[\u4e00-\u9fff]/.test(compact)) {
    for (let i = 0; i < compact.length - 1; i++) {
      tokens.push(compact.slice(i, i + 2))
    }
  }
  const seen = {}
  tokens.forEach((t) => {
    const nt = normalizeMatchText(t)
    if (!nt || nt.length < 2 || seen[nt]) return
    seen[nt] = true
    if (hay.indexOf(nt) >= 0) score += nt.length >= 4 ? 36 : 22
  })

  // 火箭名强匹配加权
  const nRocket = normalizeMatchText(rocket)
  if (nRocket && nKey && (nRocket.indexOf(nKey) >= 0 || nKey.indexOf(nRocket) >= 0)) score += 50

  if (score < 36) return null
  return { mission, score, detailType: resolveMissionDetailType(mission) }
}

/**
 * 取最佳匹配任务。带时间倾向时先在该侧挑（如「长征十号甲什么时候发射」只看即将发射），
 * 该侧无命中才回落全池，避免有排期却抽出历史任务。
 * @param {object[]} list
 * @param {string} queryText
 * @param {{ prefer?: 'upcoming'|'completed'|'' }} [options]
 */
function pickBestMissionMatch(list, queryText, options) {
  const rows = Array.isArray(list) ? list : []
  const prefer = options && options.prefer !== undefined
    ? options.prefer
    : missionLookupTimePreference(queryText)

  const bestOf = (side) => {
    let best = null
    for (let i = 0; i < rows.length; i++) {
      const scored = scoreMissionAgainstQuery(rows[i], queryText)
      if (!scored) continue
      if (side && scored.detailType !== side) continue
      // 同侧同分：即将发射取 NET 最近的一条
      if (!best || scored.score > best.score) best = scored
      else if (scored.score === best.score && side === 'upcoming') {
        const a = new Date(scored.mission.launchTime || 0).getTime()
        const b = new Date(best.mission.launchTime || 0).getTime()
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && (b <= 0 || a < b)) best = scored
      }
    }
    return best
  }

  if (prefer) {
    const preferred = bestOf(prefer)
    if (preferred) return preferred
  }
  return bestOf('')
}

/**
 * 生成 LL2 云端 search 查询词（中文实体 → 英文/代号）。
 * @returns {string[]}
 */
function buildLaunchSearchQueries(text) {
  const raw = String(text || '').trim()
  const key = extractMissionSearchKey(raw) || raw
  const out = []
  const push = (s) => {
    const t = String(s || '').trim()
    if (!t) return
    if (out.indexOf(t) >= 0) return
    out.push(t)
  }
  if (key) push(key)

  const hay = (key + ' ' + raw).toLowerCase()
  const rules = [
    { re: /朱雀|zhuque|zq[\s-]?3/, q: ['Zhuque', 'ZQ-3', 'LandSpace'] },
    { re: /猎鹰\s*重型|falcon\s*heavy/, q: ['Falcon Heavy'] },
    { re: /猎鹰|falcon\s*9|\bf9\b/, q: ['Falcon 9'] },
    { re: /星舰|starship|超重/, q: ['Starship'] },
    { re: /星链|starlink/, q: ['Starlink'] },
    { re: /谷神|ceres/, q: ['Ceres-1'] },
    { re: /引力|gravity/, q: ['Gravity-1'] },
    { re: /电子号|electron/, q: ['Electron'] },
    { re: /新格伦|new\s*glenn/, q: ['New Glenn'] },
    { re: /vulcan/, q: ['Vulcan'] },
    { re: /ariane/, q: ['Ariane'] },
    { re: /龙飞船|crew\s*dragon|\bdragon\b/, q: ['Dragon', 'Crew Dragon'] },
    { re: /神舟|shenzhou/, q: ['Shenzhou'] },
    { re: /天舟|tianzhou/, q: ['Tianzhou'] }
  ]
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].re.test(hay) || rules[i].re.test(key)) {
      rules[i].q.forEach(push)
    }
  }

  // 长征系列：normalizeMatchText 已把中英写法统一成 cz10a，反查出 LL2 英文名
  const cz = normalizeMatchText(key + ' ' + raw).match(/cz(\d{1,2})([abc])?/)
  if (cz) {
    const variant = cz[2] ? cz[2].toUpperCase() : ''
    push('Long March ' + cz[1] + variant)
    if (variant) push('Long March ' + cz[1])
  }

  // Flight / IFT 编号
  const flight = raw.match(/flight\s*(\d+)/i) || raw.match(/ift[\s-]*(\d+)/i)
  if (flight && flight[1]) {
    push('Flight ' + flight[1])
    push('IFT-' + flight[1])
  }

  return out.slice(0, 4)
}

function enrichLaunchContextWithCard(launchContext, card) {
  if (!card || !card.id) return launchContext
  const isCompleted = String(card.detailType || '') === 'completed'
  const focus = {
    name: card.name,
    rocketName: card.rocketName,
    launchTime: card.launchTime || card.formattedTime,
    launchAgency: card.launchAgency || '',
    launchSite: card.padLocation,
    status: card.statusText,
    detailType: isCompleted ? 'completed' : 'upcoming'
  }
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const focusKey = String(focus.name || '')
  const sameName = (m) => String((m && m.name) || '') === focusKey
  // 历史任务不能混进「即将发射」，否则模型会用将来时描述已发射的任务
  if (isCompleted) {
    const completed = Array.isArray(base.completed) ? base.completed.slice() : []
    base.completed = [focus].concat(completed.filter((m) => !sameName(m)))
    if (Array.isArray(base.upcoming)) {
      base.upcoming = base.upcoming.filter((m) => !sameName(m))
    }
  } else {
    const upcoming = Array.isArray(base.upcoming) ? base.upcoming.slice() : []
    base.upcoming = [focus].concat(upcoming.filter((m) => !sameName(m)))
  }
  base.focusMission = focus
  const label = focus.rocketName || focus.name || '该任务'
  base.uiCardReady = true
  base.focusHint = isCompleted
    ? '用户正在询问「' + label + '」相关发射；界面已展示可点击任务卡片，但这是一次「已完成」的历史发射。请用过去时说明发射时间与结果（时间字段若为 ISO 则按 UTC 转北京时间）；若用户问的是「什么时候发射/下次发射」，要说明目前没有查到新的排期，建议关注小程序发射日程。禁止说未匹配/找不到/没有数据，也不要把历史发射说成即将发射。'
    : '用户正在询问「' + label + '」相关发射；界面已展示可点击任务卡片，该任务尚未发射。请基于「聚焦任务」真实数据简要回答发射时间与状态（时间字段若为 ISO 则按 UTC 转北京时间），并提醒点击下方卡片查看详情。禁止说未匹配/找不到/没有数据。不要编造发射时间。'
  return base
}

function enrichLaunchContextNoStarshipSchedule(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.focusHint = '用户在询问星舰下一次试飞，但当前发射日程中暂无已排期的星舰试飞任务。请如实告知尚未公布或数据暂无，建议去小程序「星舰进度」页关注最新动态；不要编造试飞日期或航班号。'
  base.focusMission = null
  return base
}

function enrichLaunchContextNoMissionLookup(launchContext, queryText) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const key = extractMissionSearchKey(queryText) || String(queryText || '').trim()
  base.focusHint = '用户在询问「' + (key || '某任务') + '」，本地日程与云端搜索均未匹配到对应发射任务。请如实说明未找到，建议换火箭全称/英文名（如 Zhuque、Falcon 9）或去小程序搜索页；不要编造发射时间或任务名。'
  base.focusMission = null
  return base
}

/** 通用参数卡（火箭/发射场/飞船/助推器/天文图）：把卡上真实数据喂给模型，禁止编数字 */
function enrichLaunchContextWithSpec(launchContext, card) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const rows = Array.isArray(card && card.rows) ? card.rows : []
  const facts = rows
    .filter((r) => r && r.label && r.value !== '' && r.value != null)
    .map((r) => r.label + '：' + r.value)
    .join('；')
  const title = (card && card.title) || '该条目'
  base.uiCardReady = true
  base.focusMission = null
  base.specFacts = facts
  base.focusHint = '用户在询问「' + title + '」的资料，界面已展示可点击的参数卡。卡片上的真实数据：' +
    (facts || '（暂无结构化参数）') +
    '。只能基于这些数据作答，缺失字段直说暂无，禁止编造任何数字或日期；并提醒点击卡片查看完整档案。禁止说未匹配/找不到/没有数据。'
  return base
}

function enrichLaunchContextNoSpec(launchContext, kindLabel, queryText) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const key = stripSpecAskNoise(queryText) || String(queryText || '').trim()
  base.focusMission = null
  base.focusHint = '用户在询问' + (kindLabel || '条目') + '「' + (key || '未知') +
    '」，但资料库未匹配到。请如实说明没查到，建议换官方全称或英文名；不要编造参数、日期或运力数字。'
  return base
}

/**
 * 观礼点导航
 * @param {object} launchContext
 * @param {{ siteName: string, spots: Array, restricted: boolean, restrictedNote: string, matched: boolean }} info
 */
function enrichLaunchContextWithViewingSpots(launchContext, info) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const siteName = (info && info.siteName) || '该发射场'
  base.uiCardReady = true
  base.focusMission = null
  if (info && info.restricted) {
    base.focusHint = '用户想去现场看「' + siteName + '」的发射，但该发射场周边没有公共观礼点。' +
      '请如实说明：' + ((info.restrictedNote || '需通过官方渠道组织，个人不能自行抵达')) +
      '。禁止推荐任何具体坐标或让用户自驾靠近发射场，也不要编造观礼台名称与票务信息。'
    return base
  }
  const spots = Array.isArray(info && info.spots) ? info.spots : []
  const facts = spots
    .map((s) => s.name + '（' + [s.distanceText, s.costText, s.viewText].filter(Boolean).join('、') + '）')
    .join('；')
  base.viewingFacts = facts
  base.focusHint = '用户在问去哪看「' + siteName + '」的发射，界面已展示 ' + spots.length +
    ' 张观礼点卡片，点卡片即可调起地图导航。卡片上的真实点位：' + (facts || '（暂无）') +
    '。只能用这些点位与距离作答，禁止编造其他观礼点、票价、开放时间或坐标；' +
    '需提醒发射日常有交通管制与临时封控，出行前以官方公告为准。禁止说未匹配/找不到。' +
    (info && info.matched ? '' : '用户没指定发射场，已按国内文昌给点位，可提示还能问卡纳维拉尔角、星舰基地、范登堡等。')
  return base
}

/** 我的发射提醒（本地订阅） */
function enrichLaunchContextWithMyLaunches(launchContext, card) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const items = Array.isArray(card && card.items) ? card.items : []
  base.uiCardReady = true
  base.focusMission = null
  base.focusHint = '用户在查看自己订阅的发射提醒，界面已展示他订阅的 ' + items.length +
    ' 个任务卡片。请简要复述这些任务（只用卡片上的名称与时间），并说明可以点任一条看详情或取消提醒；禁止编造用户没订阅的任务。'
  return base
}

function enrichLaunchContextNoMyLaunches(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.focusMission = null
  base.focusHint = '用户在查看自己订阅的发射提醒，但当前没有任何订阅记录。请如实说明还没有订阅，并告诉他在任务详情页点「提醒我」即可订阅；不要编造订阅列表。'
  return base
}

/**
 * 纯导航入口卡的通用上下文（年度回顾 / 天象 / 新闻 / 竞猜）
 * @param {object} launchContext
 * @param {{ label: string, action: string }} info
 */
function enrichLaunchContextWithSimpleEntry(launchContext, info) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const label = (info && info.label) || '该功能'
  const action = (info && info.action) || '查看详情'
  base.uiCardReady = true
  base.focusMission = null
  base.focusHint = '用户想用「' + label + '」，界面已展示可点击的入口卡。请用一两句说明这个功能能看到什么，并提醒点击下方卡片' +
    action + '。不要编造具体内容或数据，也不要说未匹配/找不到。'
  return base
}

function enrichLaunchContextWithMissionReplay(launchContext, replayCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const name = (replayCard && (replayCard.missionName || replayCard.title)) || '该任务'
  // 出卡成功时用固定文案，避免大模型对照首页列表误说「没匹配到」
  base.uiCardReady = true
  if (replayCard && replayCard.playable && replayCard.videoUrl) {
    base.focusHint = '用户在询问「' + name + '」的发射回放；界面已展示集锦回放卡片。必须引导点击下方卡片观看；禁止说未匹配/找不到。不要编造视频内容。'
    base.suggestedReply = '已为你找到「' + name + '」的发射集锦回放，点击下方卡片即可观看。'
  } else {
    base.focusHint = '用户在询问「' + name + '」的发射回放；已定位任务但在线集锦暂未就绪，界面已展示入口卡。引导点击下方卡片打开详情；禁止说未匹配到任务。不要编造视频已可播。'
    base.suggestedReply = '已定位到「' + name + '」。在线集锦暂未就绪，可点击下方卡片打开任务详情查看回放入口。'
  }
  if (replayCard && replayCard.launchId) {
    base.focusMission = {
      id: replayCard.launchId,
      name: replayCard.missionName || '',
      detailType: replayCard.detailType || 'completed'
    }
  }
  return base
}

function enrichLaunchContextNoMissionReplay(launchContext, queryText) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const key = stripReplayAskNoise(queryText) || extractMissionSearchKey(queryText) || String(queryText || '').trim()
  base.focusHint = '用户在询问「' + (key || '某任务') + '」的发射回放/集锦，但未匹配到任务或回放暂不可用。请如实说明，建议换任务全称或去对应任务详情页的「观看回放」；不要编造视频链接。'
  base.focusMission = null
  base.uiCardReady = false
  delete base.suggestedReply
  return base
}

function enrichLaunchContextWithLaunchList(launchContext, listCard, filter) {
  const items = listCard && Array.isArray(listCard.items) ? listCard.items : []
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  if (items.length) {
    base.upcoming = items.map((it) => ({
      name: it.name,
      rocketName: it.rocketName,
      launchTime: it.launchTime || it.formattedTime,
      launchAgency: it.launchAgency || '',
      launchSite: it.padLocation || '',
      status: it.statusText || ''
    }))
  }
  base.uiCardReady = true
  const label = launchListFilterLabel(filter) || launchListFilterLabel(listCard && listCard.listFilter)
  if (label) {
    base.focusHint = '用户在询问「' + label + '」相关的即将发射任务；界面列表已按该范围筛选。请只基于卡片内真实任务做简要概括（时间转北京时间），提醒可点击进入详情；不要编造未列出的任务，也不要混入其他发射场/机构的任务。禁止说未匹配到。'
  } else {
    base.focusHint = '用户在询问即将发射列表；界面会展示可点击的发射任务列表卡片。请基于列表真实数据做简要概括（时间转北京时间），提醒用户可点击卡片进入详情；不要编造未列出的任务。禁止说未匹配到。'
  }
  return base
}

function enrichLaunchContextNoLaunchList(launchContext, queryText) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const filter = parseLaunchListFilter(queryText)
  const label = launchListFilterLabel(filter)
  if (label) {
    base.focusHint = '用户在询问「' + label + '」相关的即将发射任务，但当前日程中没有匹配到该范围的任务。请如实说明暂无排期或数据未覆盖，建议打开小程序首页/发射日历查看；不要编造发射任务。'
  } else {
    base.focusHint = '用户在询问即将发射列表，但当前没有可用的发射日程数据。请如实说明数据暂未就绪，建议打开小程序首页查看；不要编造发射任务。'
  }
  return base
}

function enrichLaunchContextWithStarshipStatus(launchContext, statusCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const b = statusCard && statusCard.booster
  const s = statusCard && statusCard.ship
  const lines = []
  if (b) lines.push(`助推器 ${b.id || '待公布'}：${b.status || ''}，进度 ${b.progress != null ? b.progress + '%' : '未知'}`)
  if (s) lines.push(`飞船 ${s.id || '待公布'}：${s.status || ''}，进度 ${s.progress != null ? s.progress + '%' : '未知'}`)
  if (statusCard && statusCard.checklist) {
    lines.push(`飞行准备清单 ${statusCard.checklist.done}/${statusCard.checklist.total} 完成`)
  }
  base.uiCardReady = true
  base.focusHint = '用户在询问星舰建造/组合体进展；界面会展示 B/S 状态卡片。请基于以下真实状态简要回答，并提醒可点击卡片进入星舰进度页：\n' +
    (lines.length ? lines.join('\n') : '状态数据暂缺') +
    '\n不要编造硬件编号或进度百分比。禁止说未匹配到。'
  return base
}

function enrichLaunchContextNoStarshipStatus(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.focusHint = '用户在询问星舰进展，但状态数据暂不可用。请如实说明，建议打开「星舰进度」页；不要编造 B/S 编号或进度。'
  return base
}

function enrichLaunchContextWithFlightDemo(launchContext, entryCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const name = entryCard && entryCard.missionName ? entryCard.missionName : ''
  base.uiCardReady = true
  base.focusHint = '用户想看飞行剖面演示；界面会展示入口卡片。请简要说明可点击卡片进入演示页查看时间线动画' +
    (name ? `（关联任务：${name}）` : '') +
    '；不要编造飞行节点时间。禁止说未匹配到。'
  return base
}

function enrichLaunchContextWithVehicleTracker(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.uiCardReady = true
  base.focusHint = '用户想看 SpaceX 在轨飞行器追踪；界面会展示入口卡片。请简要介绍可点击进入 3D 地球实时定位页（星舰/龙飞船遥测），不要编造当前轨道参数。禁止说未匹配到。'
  return base
}

function enrichLaunchContextWithMissionSim(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.uiCardReady = true
  base.focusHint = '用户想进入星舰任务指挥室模拟；界面会展示入口卡片。请简要说明这是本地互动科普（飞行总监视角、GO/NO-GO 决策），可点击卡片进入；不要编造模拟结果。禁止说未匹配到。'
  return base
}

function enrichLaunchContextWithRoadClosure(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.uiCardReady = true
  base.focusHint = '用户在询问星舰基地封路/道路封闭；界面会展示入口卡片。请简要说明可点击进入封路详情查看最新通知；不要编造具体封路时段，若不确定请如实说明以小程序页面为准。禁止说未匹配到。'
  return base
}

function enrichLaunchContextWithStation(launchContext, entryCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const name = entryCard && entryCard.stationName ? entryCard.stationName : '空间站'
  base.uiCardReady = true
  base.focusHint = '用户想查看空间站实时状态；界面会展示入口卡片（' + name + '）。请简要介绍可点击进入详情看乘组/轨道，不要编造当前高度、速度或乘组名单。禁止说未匹配到。'
  return base
}

function enrichLaunchContextWithLaunchStats(launchContext, statsCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const card = statsCard && typeof statsCard === 'object' ? statsCard : {}
  const scope = card.scopeLabel || ''
  const region = card.countryLabel || '全球'
  const total = card.total != null ? card.total : '—'
  const success = card.success != null ? card.success : '—'
  const failure = card.failure != null ? card.failure : '—'
  const yearHint = card.yearTotal != null
    ? ('；同年累计 ' + card.yearTotal + ' 次')
    : ''
  base.uiCardReady = true
  base.focusHint = '用户在询问发射统计（' + scope + region + '）；界面会展示可点击的统计卡片。请基于真实数字简要回答：总计 ' +
    total + ' 次，成功 ' + success + '，失败 ' + failure + yearHint +
    '。提醒可点击卡片进入「全球发射统计」详情页；不要编造未给出的排行或次数。禁止说未匹配到。'
  return base
}

function enrichLaunchContextNoLaunchStats(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.focusHint = '用户在询问发射统计，但汇总数据暂未就绪。请如实说明，建议点击卡片或打开小程序「全球发射统计」页稍后查看；不要编造发射次数。'
  return base
}

function enrichLaunchContextWithAgency(launchContext, agencyCard) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const card = agencyCard && typeof agencyCard === 'object' ? agencyCard : {}
  const name = card.displayName || card.name || '该发射商'
  const lines = []
  if (card.countryLabel) lines.push('国家/地区：' + card.countryLabel)
  if (card.foundingYear) lines.push('成立：' + card.foundingYear + ' 年')
  if (card.totalLaunchCount != null) lines.push('历史总发射：' + card.totalLaunchCount + ' 次')
  if (card.successRateText) lines.push('成功率：' + card.successRateText)
  if (card.typeZh) lines.push('类型：' + card.typeZh)
  base.uiCardReady = true
  base.focusHint = '用户在询问发射商「' + name + '」；界面会展示可点击的发射商卡片。请基于以下真实信息简要介绍，并提醒可点击进入发射商详情页：\n' +
    (lines.length ? lines.join('\n') : '详情见卡片') +
    '\n不要编造未给出的发射次数、火箭名单或财务数据。禁止说未匹配到。'
  return base
}

function enrichLaunchContextNoAgency(launchContext, queryText) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const key = extractAgencySearchKey(queryText) || String(queryText || '').trim()
  base.focusHint = '用户在询问发射商「' + (key || '某机构') + '」，本地图鉴未匹配到对应机构。请如实说明未找到，建议改用英文名或缩写（如 SpaceX、CASC、Rocket Lab）或打开「全球发射商图鉴」；不要编造机构信息。'
  return base
}

module.exports = {
  isStarshipMissionLike,
  isUsableMissionForCard,
  isUsableLaunchForCard,
  extractMissionSearchKey,
  extractAgencySearchKey,
  normalizeMatchText,
  matchStarshipNextFlightIntent,
  matchStarshipStatusIntent,
  matchLaunchStatsIntent,
  matchLaunchListIntent,
  matchFlightDemoIntent,
  matchMissionSimIntent,
  matchVehicleTrackerIntent,
  matchRoadClosureIntent,
  matchStationIntent,
  matchAgencyIntent,
  matchMissionLookupIntent,
  matchMissionReplayIntent,
  matchRocketModelIntent,
  matchLaunchSiteIntent,
  matchSpacecraftIntent,
  matchBoosterIntent,
  matchMyLaunchesIntent,
  matchYearReviewIntent,
  matchLaunchVoteIntent,
  matchApodIntent,
  matchAstroCalendarIntent,
  matchNewsIntent,
  matchStarlinkPassIntent,
  matchLiveWatchIntent,
  matchStarlinkMapIntent,
  matchViewingSpotIntent,
  matchArtemisIntent,
  matchStarshipHardwareIntent,
  matchRecoveryStatsIntent,
  resolveAiChatRichIntent,
  stripReplayAskNoise,
  stripSpecAskNoise,
  extractRocketModelKey,
  extractLaunchSiteKey,
  extractSpacecraftKey,
  extractBoosterSerial,
  extractStarshipHardwareRef,
  pickRocketConfig,
  pickLaunchSite,
  pickSpacecraftConfig,
  pickStarshipHardware,
  parseHardwareVehicleRef,
  expandAliasKeys,
  hasMissionReplayAsk,
  scoreAllRichIntents,
  parseLaunchStatsFocus,
  parseLaunchListFilter,
  parseLaunchListSiteFilter,
  parseLaunchListCountryFilter,
  missionMatchesLaunchListFilter,
  missionWithinUpcomingDays,
  missionMatchesCountry,
  launchListFilterLabel,
  LAUNCH_LIST_WITHIN_DAYS,
  getBeijingPeriodBounds,
  countLaunchesInBounds,
  pickStarshipMission,
  pickLaunchList,
  pickStation,
  scoreMissionAgainstQuery,
  pickBestMissionMatch,
  missionLookupTimePreference,
  resolveMissionDetailType,
  scoreAgencyAgainstQuery,
  pickBestAgencyMatch,
  resolveAgencyCanonicalSearchKey,
  detectKnownAgencyCanonical,
  agencyMatchesCanonical,
  AGENCY_CANONICAL_IDS,
  AGENCY_ALIAS_MAP,
  buildLaunchSearchQueries,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule,
  enrichLaunchContextNoMissionLookup,
  enrichLaunchContextWithLaunchList,
  enrichLaunchContextNoLaunchList,
  enrichLaunchContextWithStarshipStatus,
  enrichLaunchContextNoStarshipStatus,
  enrichLaunchContextWithFlightDemo,
  enrichLaunchContextWithVehicleTracker,
  enrichLaunchContextWithMissionSim,
  enrichLaunchContextWithRoadClosure,
  enrichLaunchContextWithStation,
  enrichLaunchContextWithLaunchStats,
  enrichLaunchContextNoLaunchStats,
  enrichLaunchContextWithAgency,
  enrichLaunchContextNoAgency,
  enrichLaunchContextWithMissionReplay,
  enrichLaunchContextNoMissionReplay,
  enrichLaunchContextWithSpec,
  enrichLaunchContextNoSpec,
  enrichLaunchContextWithViewingSpots,
  enrichLaunchContextWithMyLaunches,
  enrichLaunchContextNoMyLaunches,
  enrichLaunchContextWithSimpleEntry
}
