/**
 * 任务 / 发射标题中文显示（列表卡）
 * 优先用云端 nameZh；缺失时走短语规则 + 常见任务词典，避免只译火箭名、任务段仍全英文。
 */

const { translateRocketName, localizeRocketInTitle } = require('./rocket-name-i18n.js')

/** 整段标题精确匹配（小写 key） */
const EXACT_MISSION_ZH = {
  'nancy grace roman space telescope': '南希-格蕾丝-罗曼太空望远镜',
  'nancy-grace-roman space telescope': '南希-格蕾丝-罗曼太空望远镜',
  'nancy-grace-roman': '南希-格蕾丝-罗曼',
  'roman space telescope': '罗曼太空望远镜',
  'james webb space telescope': '詹姆斯·韦伯太空望远镜',
  'hubble space telescope': '哈勃太空望远镜',
  'europa clipper': '欧罗巴快船',
  'psyche': '灵神星探测器',
  'lucy': '露西号',
  'perseverance': '毅力号',
  'ingenuity': '机智号',
  'orion': '猎户座飞船',
  'artemis i': '阿尔忒弥斯 I',
  'artemis ii': '阿尔忒弥斯 II',
  'artemis iii': '阿尔忒弥斯 III',
  'polaris dawn': '极地黎明',
  'inspiration4': '灵感4号',
  'axiom mission 1': '公理任务 1',
  'axiom mission 2': '公理任务 2',
  'axiom mission 3': '公理任务 3',
  'axiom mission 4': '公理任务 4',
  'worldview legion 1': 'WorldView Legion 1',
  'ussf-51': '美国太空军-51',
  'nrol-69': '国家侦察局-69',
  'transporter-15': 'Transporter-15',
  'transporter 15': 'Transporter-15',
  'michibiki 7 (qzs-7)': '导览7号（准天顶卫星7号）',
  'michibiki 7': '导览7号（准天顶卫星7号）',
  'qzs-7': '准天顶卫星7号',
  'chinasat 4b': '中星4B号',
  'chinasat-4b': '中星4B号',
  'zhongxing 4b': '中星4B号',
  'zhongxing-4b': '中星4B号'
}

/**
 * LL2 曾用 Unknown Payload 占位、官方已公布载荷时按 launch.id 覆盖。
 * 例：文昌 CZ-7A / 中星4B（2026-08-10）
 */
const LAUNCH_ID_MISSION_OVERRIDE = {
  'cff704ab-8098-4f65-899e-50adaf908e59': {
    en: 'ChinaSat 4B',
    zh: '中星4B号'
  }
}

function resolveLaunchMissionOverride(launchId) {
  const hit = LAUNCH_ID_MISSION_OVERRIDE[String(launchId || '')]
  if (!hit) return null
  return { missionNameEn: hit.en, missionNameZh: hit.zh }
}

/**
 * 短语替换（顺序敏感：长词优先）
 * 星链组号、飞行序号等结构化名称本地可直译，不必等云端机翻。
 */
const MISSION_PHRASE_RULES = [
  [/Nancy[-–\s]+Grace[-–\s]+Roman[-–\s]+(?:Space\s+)?Telescope/gi, '南希-格蕾丝-罗曼太空望远镜'],
  [/Nancy[-–\s]+Grace[-–\s]+Roman/gi, '南希-格蕾丝-罗曼'],
  [/Roman[-–\s]+Space\s+Telescope/gi, '罗曼太空望远镜'],
  [/James\s+Webb\s+Space\s+Telescope/gi, '詹姆斯·韦伯太空望远镜'],
  [/Hubble\s+Space\s+Telescope/gi, '哈勃太空望远镜'],
  [/Europa\s+Clipper/gi, '欧罗巴快船'],
  [/Polaris\s+Dawn/gi, '极地黎明'],
  [/Inspiration\s*4/gi, '灵感4号'],
  [/Axiom\s+Mission\s+(\d+)/gi, '公理任务 $1'],
  [/Michibiki\s+(\d+)\s*\(\s*QZS-?\d+\s*\)/gi, '导览$1号（准天顶卫星$1号）'],
  [/Michibiki\s+(\d+)/gi, '导览$1号'],
  [/\bQZS-?(\d+)\b/gi, '准天顶卫星$1号'],
  [/ChinaSat\s*-?\s*(\d+[A-Za-z]?)/gi, '中星$1号'],
  [/Zhongxing\s*-?\s*(\d+[A-Za-z]?)/gi, '中星$1号'],
  // Rocket Lab / iQPS：The Grain Goddess Provides (iQPS Launch 7)
  [/The\s+Grain\s+Goddess\s+Provides/gi, '谷物女神提供号'],
  [/Grain\s+Goddess\s+Provides/gi, '谷物女神提供号'],
  [/\(\s*iQPS\s+Launch\s+(\d+)\s*\)/gi, '(iQPS 第$1次发射)'],
  [/\biQPS\s+Launch\s+(\d+)\b/gi, 'iQPS 第$1次发射'],
  // 通用 Launch N（放在 iQPS 规则之后，避免重复替换）
  [/\bLaunch\s+(\d+)\b/gi, '第$1次发射'],
  [/Starlink\s+Group\s+/gi, '星链组 '],
  [/\bStarlink\b/gi, '星链'],
  [/\bCrew\s+Dragon\b/gi, '载人龙飞船'],
  [/\bCargo\s+Dragon\b/gi, '货运龙飞船'],
  [/\bDragon\b/gi, '龙飞船'],
  [/\bUnknown\s+Payload\b/gi, '未知有效载荷'],
  [/\bUnknown\s+Payloads\b/gi, '未知有效载荷'],
  [/\bRideshare\b/gi, '拼车发射'],
  [/\bTransporter[-\s]?(\d+)\b/gi, 'Transporter-$1'],
  [/\bBandwagon[-\s]?(\d+)\b/gi, 'Bandwagon-$1'],
  [/\bUSSF[-\s]?(\d+)\b/gi, '美国太空军-$1'],
  [/\bUSSF\b/g, '美国太空军'],
  [/Globalstar\s*2\s*[-–]?\s*R/gi, '全球星2-R'],
  [/\bNROL[-\s]?(\d+)\b/gi, '国家侦察局-$1'],
  [/\bCRS[-\s]?(\d+)\b/gi, '商业补给$1'],
  // Crew-N = SpaceX 载人任务编号，绝不能落成「人物」（通机翻影视义）
  [/\bCrew[-\s]?(\d+)\b/gi, '载人-$1'],
  // Flight = 飞行（航天术语；绝不能译成民航「航班」）
  // Flight N / Flight-N → 第N次飞行（展示友好，避免「飞行2」）
  [/\bFlight\s+Test\s+(\d+)\b/gi, '第$1次试飞'],
  [/\bFlight\s+Test\b/gi, '试飞'],
  [/\bFlight[-\s]?(\d+)\b/gi, '第$1次飞行'],
  [/\bFlight\b/gi, '飞行']
]

/**
 * 纠偏通机翻/旧缓存的航天术语误译（已是中文也要跑）。
 * 统一用词：Crew* → 载人（任务号）/ 载人龙飞船；Flight → 飞行（禁「航班」）；
 * Zhuque 绝不能落成「麻雀」（通机翻把 vermilion/que 误成 sparrow）。
 */
const ZHUQUE_NUM_ZH = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六',
  7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二'
}

const AEROSPACE_ZH_REPAIR_RULES = [
  // 机翻常把 Roman 译成「罗斯」(Ross) 或「罗丝」(Rose)；通行译名是「罗曼」
  [/南希.{0,3}格蕾丝.{0,3}(罗斯|罗丝)/g, '南希-格蕾丝-罗曼'],
  [/(罗斯|罗丝)太空望远镜/g, '罗曼太空望远镜'],
  [/人物龙飞船/g, '载人龙飞船'],
  [/人物\s*Dragon/gi, '载人龙飞船'],
  [/人物[-\s]?(\d+)/g, '载人-$1'],
  [/船员[-\s]?(\d+)/g, '载人-$1'],
  [/剧组[-\s]?(\d+)/g, '载人-$1'],
  [/全体人员[-\s]?(\d+)/g, '载人-$1'],
  [/航班[-\s]?(\d+)/g, '第$1次飞行'],
  [/航班/g, '飞行'],
  // 旧式「飞行2 / 飞行 2」→「第2次飞行」
  [/飞行\s*(\d+)/g, '第$1次飞行'],
  [/试飞\s*(\d+)/g, '第$1次试飞'],
  // 英文残留
  [/\bCrew\s+Dragon\b/gi, '载人龙飞船'],
  [/\bCrew[-\s]?(\d+)\b/gi, '载人-$1'],
  [/\bFlight\s+Test\s+(\d+)\b/gi, '第$1次试飞'],
  [/\bFlight\s+Test\b/gi, '试飞'],
  [/\bFlight[-\s]?(\d+)\b/gi, '第$1次飞行'],
  [/\bFlight\b/gi, '飞行'],
  // 朱雀误译「麻雀」：先处理带「改/E」与中文数字号
  [/麻雀\s*二\s*号?\s*[改eE]/g, '朱雀二号改'],
  [/麻雀\s*([一二三四五六七八九十]+)\s*号/g, '朱雀$1号'],
  [/雀雀/g, '朱雀'],
  [/孔雀/g, '朱雀'],
  [/第一一级/g, '一级'],
  [/第一赛段/g, '一级'],
  [/第二赛段/g, '二级'],
  [/短程着陆台/g, '航区着陆场'],
  [/\bASDS\b/g, '无人船'],
  [/猎鹰9号\s*Block\s*(\d+)/gi, '猎鹰9号第$1型'],
  [/\bUSSF[-\s]?(\d+)\b/gi, '美国太空军-$1'],
  [/\bUSSF\b/g, '美国太空军']
]

/** 麻雀/雀雀-3 → 朱雀三号（机翻 Zhuque→麻雀/雀雀） */
function repairZhuqueSparrowMistranslation(text) {
  let s = String(text || '')
  if (!s) return s
  if (s.indexOf('麻雀') < 0 && s.indexOf('雀雀') < 0 && s.indexOf('孔雀') < 0 && !/朱雀[-\s]?\d/.test(s)) return s
  s = s.replace(/雀雀|孔雀/g, '朱雀')
  s = s.replace(/朱雀[-\s]*(\d+)\s*号?/g, (_, n) => '朱雀' + (ZHUQUE_NUM_ZH[Number(n)] || n) + '号')
  if (s.indexOf('麻雀') < 0) return s
  s = s.replace(/麻雀\s*[-–]?\s*(\d+)\s*([eE])\b/g, (_, n, e) => {
    const num = ZHUQUE_NUM_ZH[Number(n)] || n
    return '朱雀' + num + '号' + (String(e).toLowerCase() === 'e' ? '改' : '')
  })
  // 注意：数字后不要写 \s*号?，否则会吞掉「麻雀-3 | …」里的空格
  s = s.replace(/麻雀\s*[-–]?\s*(\d+)号?(?=\s|[|｜]|$|[^\d号])/g, (_, n) => {
    return '朱雀' + (ZHUQUE_NUM_ZH[Number(n)] || n) + '号'
  })
  return s
}

/**
 * 星链组号统一为「星链组 10-19」：组与号一个空格，连字符两侧无空格。
 * 对齐 LL2「Starlink Group 10-19」；机翻常写成「星链组 10 - 19」。
 */
function normalizeStarlinkGroupFormat(text) {
  let s = String(text || '')
  if (!s) return s
  s = s.replace(/Starlink\s+Group\s+(\d+)\s*[-–—－~～]\s*(\d+)/gi, 'Starlink Group $1-$2')
  s = s
    .replace(/Starlink\s+Group/gi, '星链组')
    .replace(/星链\s*集团/g, '星链组')
    .replace(/星链\s+组/g, '星链组')
  s = s.replace(/星链组\s*(\d+)\s*[-–—－~～]\s*(\d+)/g, '星链组 $1-$2')
  s = s.replace(/星链组(\d)/g, '星链组 $1')
  s = s.replace(/(美国太空军|国家侦察局|载人)\s*[-–—－]\s*(\d+)/g, '$1-$2')
  return s
}

function repairAerospaceZhMistranslations(text) {
  let s = String(text || '')
  if (!s) return ''
  s = repairZhuqueSparrowMistranslation(s)
  for (let i = 0; i < AEROSPACE_ZH_REPAIR_RULES.length; i++) {
    const pair = AEROSPACE_ZH_REPAIR_RULES[i]
    s = s.replace(pair[0], pair[1])
  }
  return normalizeStarlinkGroupFormat(s)
}

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function applyMissionPhraseRules(text) {
  let s = String(text || '').trim()
  if (!s) return ''
  for (let i = 0; i < MISSION_PHRASE_RULES.length; i++) {
    const pair = MISSION_PHRASE_RULES[i]
    s = s.replace(pair[0], pair[1])
  }
  return repairAerospaceZhMistranslations(s).trim()
}

/**
 * 单段任务名 → 中文（不含火箭前缀时也可单独调用）
 */
function translateMissionSegment(segment) {
  const raw = String(segment || '').trim()
  if (!raw) return ''
  // 已是中文：仍纠偏「人物-13」等误译，再返回
  if (/[\u4e00-\u9fff]/.test(raw) && !/\bCrew\b/i.test(raw)) {
    return repairAerospaceZhMistranslations(raw)
  }

  const exact = EXACT_MISSION_ZH[normKey(raw)]
  if (exact) return exact

  const phrased = applyMissionPhraseRules(raw)
  if (phrased && phrased !== raw && /[\u4e00-\u9fff]/.test(phrased)) {
    return repairAerospaceZhMistranslations(phrased)
  }
  return repairAerospaceZhMistranslations(phrased || raw)
}

/**
 * 完整发射标题本地化：火箭名转写 + 任务段短语/词典。
 * @param {string} title launch.name 或 mission.name
 * @param {string} [rocketNameEn]
 * @param {string} [rocketNameZh]
 */
function localizeMissionTitle(title, rocketNameEn, rocketNameZh) {
  const raw = String(title || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw) && !/[A-Za-z]{3,}/.test(raw)) {
    return repairAerospaceZhMistranslations(raw)
  }

  let rocketEn = String(rocketNameEn || '').trim()
  let rocketZh = String(rocketNameZh || '').trim()
  if (!rocketZh && rocketEn) rocketZh = translateRocketName(rocketEn) || rocketEn

  // 「火箭 | 任务」拆开分别处理，避免短语规则误伤火箭段
  const pipe = raw.indexOf('|')
  if (pipe >= 0) {
    const left = raw.slice(0, pipe).trim()
    const right = raw.slice(pipe + 1).trim()
    // 左侧优先整段火箭词典（Falcon 9 Block 5 → 猎鹰9号），再回退前缀替换
    const leftZh = translateRocketName(left)
      || (rocketZh && rocketEn && localizeRocketInTitle(left, rocketEn, rocketZh))
      || left
    const rightZh = translateMissionSegment(right)
    if (leftZh || rightZh) {
      return repairAerospaceZhMistranslations([leftZh, rightZh].filter(Boolean).join(' | '))
    }
  }

  let out = localizeRocketInTitle(raw, rocketEn, rocketZh) || raw
  // 去掉火箭前缀后再译任务段，再拼回
  if (rocketEn && rocketZh && rocketEn !== rocketZh && out.indexOf(rocketZh) === 0) {
    const rest = out.slice(rocketZh.length).replace(/^\s*[|·•\-—]\s*/, '').trim()
    if (rest) {
      const restZh = translateMissionSegment(rest)
      const sep = out.indexOf('|') >= 0 ? ' | ' : ' '
      out = rocketZh + (restZh ? sep + restZh : '')
      return repairAerospaceZhMistranslations(out.trim())
    }
  }

  return translateMissionSegment(out)
}

module.exports = {
  translateMissionSegment,
  localizeMissionTitle,
  applyMissionPhraseRules,
  repairAerospaceZhMistranslations,
  resolveLaunchMissionOverride
}
