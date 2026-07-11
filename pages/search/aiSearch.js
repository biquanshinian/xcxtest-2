// utils/aiSearch.js
/**
 * 搜索关键词分析与别名扩展
 * 用于提升首页智能搜索的召回率与建议词质量
 */
const {
  toPinyinCompact,
  toPinyinInitialsCompact,
  hasCJK
} = require('./search-pinyin.js')

const SEARCH_ALIAS_GROUPS = [
  {
    canonical: 'spacex',
    aliases: ['spacex', 'space x', '太空探索', '太空探索技术公司', '猎鹰', '猎鹰9', 'falcon', 'falcon 9', 'falcon heavy', '星链', 'starlink']
  },
  {
    canonical: 'starship',
    aliases: ['starship', 'star ship', '星舰', 'super heavy', '超重型', 'ship 31', 'ship 32']
  },
  {
    canonical: 'nasa',
    aliases: ['nasa', '美国宇航局', '美国航天局', '阿耳忒弥斯', 'artemis', 'iss', '国际空间站']
  },
  {
    canonical: 'casc',
    aliases: ['casc', '中国航天', '航天科技', '长征', 'long march', 'cz', '神舟', '天舟']
  },
  {
    canonical: 'landspace',
    aliases: ['landspace', 'land space', '蓝箭', '蓝箭航天', '朱雀', '朱雀二号', 'zhuque', 'lanjian', 'lan jian', 'ls']
  },
  {
    canonical: 'galactic energy',
    aliases: ['galactic energy', '星河动力', '谷神星', '智神星', 'xinghedongli', 'gushenxing', 'zhishenxing', 'ge']
  },
  {
    canonical: 'cas space',
    aliases: ['cas space', '中科宇航', '力箭', '力箭一号', '力箭二号', '中科', 'lijian', 'zhongke', 'zk-1a', 'zk 1a']
  },
  {
    canonical: 'china great wall industry corporation',
    aliases: ['china great wall', 'cgwic', '长城工业', '中国长城工业', 'changcheng']
  },
  {
    canonical: 'china rocket co ltd',
    aliases: ['china rocket', '中国火箭', '科工火箭', '航天科工火箭', 'chnr']
  },
  {
    canonical: 'deep blue aerospace',
    aliases: ['deep blue', '深蓝航天', '星云一号', '雷鸟', 'shenlan']
  },
  {
    canonical: 'expace',
    aliases: ['expace', '快舟', '航天科工火箭', '行云', 'kuaizhou', 'kuai zhou']
  },
  {
    canonical: 'i space',
    aliases: ['i-space', 'i space', '星际荣耀', '双曲线', 'shuangquxian', 'xingjirongyao', 'hyperbola']
  },
  {
    canonical: 'onespace',
    aliases: ['onespace', '零壹空间', 'lingyi', 'os-x', 'os-m']
  },
  {
    canonical: 'orienspace technology',
    aliases: ['orienspace', '东方空间', '引力', '引力一号', 'yinli', 'dongfang']
  },
  {
    canonical: 'space pioneer',
    aliases: ['space pioneer', '天兵科技', '天龙', '天龙三号', 'tianbing', 'tianlong']
  },
  {
    canonical: 'rocket lab',
    aliases: ['rocket lab', '火箭实验室', 'electron', '中子火箭', 'neutron']
  },
  {
    canonical: 'blue origin',
    aliases: ['blue origin', '蓝色起源', 'new shepard', 'new glenn', '新谢泼德', '新格伦']
  },
  {
    canonical: 'ula',
    aliases: ['ula', 'united launch alliance', '联合发射联盟', 'vulcan', 'atlas v', 'delta iv']
  },
  {
    canonical: 'kennedy',
    aliases: ['kennedy', '肯尼迪', 'cape canaveral', '卡纳维拉尔', 'lc 39a', 'slc 40']
  },
  {
    canonical: 'vandenberg',
    aliases: ['vandenberg', '范登堡', 'slc 4e']
  },
  {
    canonical: 'baikonur',
    aliases: ['baikonur', '拜科努尔']
  },
  {
    canonical: 'arianespace',
    aliases: ['arianespace', '阿丽亚娜', 'ariane', 'vega', '欧洲火箭']
  },
  {
    canonical: 'isro',
    aliases: ['isro', '印度空间研究组织', '印度航天', 'indian space']
  },
  {
    canonical: 'jaxa',
    aliases: ['jaxa', '日本宇宙航空研究开发机构', '日本航天', 'h-iia', 'h3']
  },
  {
    canonical: 'roscosmos',
    aliases: ['roscosmos', '俄罗斯航天', '联盟号', 'soyuz', '质子号', 'proton']
  },
  {
    canonical: 'northrop grumman',
    aliases: ['northrop grumman', '诺斯罗普', '天鹅座', 'cygnus', 'antares']
  },
  {
    canonical: 'relativity space',
    aliases: ['relativity space', '相对论太空', 'terran']
  },
  {
    canonical: 'astra',
    aliases: ['astra', '阿斯特拉']
  },
  {
    canonical: 'virgin orbit',
    aliases: ['virgin orbit', '维珍轨道', 'launcherone']
  },
  {
    canonical: 'moon',
    aliases: ['moon', '月球', 'lunar']
  },
  {
    canonical: 'mars',
    aliases: ['mars', '火星']
  },
  {
    canonical: 'satellite',
    aliases: ['satellite', '卫星', '载荷', 'payload']
  }
]

const TYPO_MAP = {
  sapcex: 'spacex',
  spacex: 'spacex',
  flacon: 'falcon',
  falcn: 'falcon',
  'star ship': 'starship',
  starlinks: 'starlink',
  longmarch: 'long march',
  longmarch9: 'long march 9'
}

const DEFAULT_SEARCH_SUGGESTIONS = [
  'SpaceX',
  '星舰',
  '猎鹰9',
  '长征',
  'NASA',
  '国际空间站',
  '范登堡',
  '肯尼迪',
  'Starlink',
  'Blue Origin'
]

function toHalfWidthBasic(str) {
  return String(str || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
}

function normalizeSearchText(input) {
  return toHalfWidthBasic(input)
    .toLowerCase()
    .replace(/[（）()【】\[\]{}]/g, ' ')
    .replace(/[·•]/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/[，,。.!！？?、:：;；'"`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSearchText(input) {
  const normalized = normalizeSearchText(input)
  if (!normalized) return []

  const tokens = normalized.split(' ').filter(Boolean)
  const results = new Set(tokens)
  results.add(normalized)

  if (tokens.length > 1) {
    results.add(tokens.join(''))
  }

  return Array.from(results)
}

function expandAliasTerms(seedTerms = []) {
  const expanded = new Set()
  const terms = Array.isArray(seedTerms) ? seedTerms : []

  terms.forEach((term) => {
    const normalizedTerm = normalizeSearchText(term)
    if (!normalizedTerm) return
    expanded.add(normalizedTerm)

    SEARCH_ALIAS_GROUPS.forEach((group) => {
      const canonical = normalizeSearchText(group.canonical)
      const aliases = group.aliases.map((alias) => normalizeSearchText(alias)).filter(Boolean)
      const exactMatch = aliases.some((alias) => alias === normalizedTerm)
      const canonicalMatch = canonical === normalizedTerm
      const strictTokenMatch = normalizedTerm.length >= 4 && aliases.some((alias) => alias.length >= 4 && (alias.startsWith(normalizedTerm) || normalizedTerm.startsWith(alias)))
      const isMatched = exactMatch || canonicalMatch || strictTokenMatch
      if (!isMatched) return

      expanded.add(canonical)
      aliases.forEach((alias) => {
        if (alias === normalizedTerm || alias === canonical || alias.length >= 4) {
          expanded.add(alias)
        }
      })
    })
  })

  return Array.from(expanded).sort((a, b) => a.length - b.length)
}

function getSuggestedQueries(input) {
  const normalized = normalizeSearchText(input)
  const suggestions = []
  const seen = new Set()

  const pushSuggestion = (text) => {
    const cleanText = String(text || '').trim()
    const normalizedText = normalizeSearchText(cleanText)
    if (!cleanText || !normalizedText || seen.has(normalizedText)) return
    seen.add(normalizedText)
    suggestions.push(cleanText)
  }

  DEFAULT_SEARCH_SUGGESTIONS.forEach(pushSuggestion)
  SEARCH_ALIAS_GROUPS.forEach((group) => {
    group.aliases.slice(0, 3).forEach(pushSuggestion)
  })

  if (!normalized) {
    return suggestions.slice(0, 8)
  }

  return suggestions
    .filter((item) => {
      const current = normalizeSearchText(item)
      return current.includes(normalized) || normalized.includes(current)
    })
    .slice(0, 6)
}

/**
 * 判断用户输入是否为自然语言提问（而非关键词检索）
 * 例如："阿尔忒弥斯执行的什么任务？" → true
 *       "SpaceX" → false
 */
function isNaturalLanguageQuestion(text) {
  if (!text) return false
  var s = String(text).trim()
  // 以问号结尾
  if (/[？?]\s*$/.test(s)) return true
  // 包含典型疑问句式
  if (/(?:^|.+)(是什么|干什么|做什么|怎么样|什么时候|在哪|有哪些|是谁|多久|多远|多高|多重|为什么|怎么|能不能|是不是|有没有|几次|几号|哪个|哪些|什么任务|什么意思|啥意思|干嘛|干啥|咋回事|咋样|多少)/.test(s)) return true
  // 以疑问词开头
  if (/^(什么|为什么|怎么|哪个|谁|几|多少|为啥|咋|啥)/.test(s)) return true
  // 英文疑问句
  if (/^(what|why|how|when|where|who|which|is |are |do |does |did |can |will |could )/i.test(s)) return true
  return false
}

function analyzeSearchQuery(query) {
  const normalizedInput = normalizeSearchText(query)
  if (!normalizedInput) {
    return {
      rawQuery: query,
      normalizedQuery: '',
      tokens: [],
      expandedTerms: [],
      suggestions: getDefaultSearchSuggestions(),
      intent: {
        isNaturalQuestion: false,
        wantsUpcoming: false,
        wantsCompleted: false
      }
    }
  }

  const corrected = TYPO_MAP[normalizedInput] || normalizedInput
  const tokens = tokenizeSearchText(corrected)
  let expandedTerms = expandAliasTerms([corrected, ...tokens])

  const pinyinExtras = new Set()
  const rawTrim = String(query || '').trim()
  if (rawTrim) {
    const pfAll = toPinyinCompact(rawTrim)
    if (pfAll && pfAll.length >= 2) pinyinExtras.add(pfAll)
    const piAll = toPinyinInitialsCompact(rawTrim)
    if (piAll && piAll.length >= 2) pinyinExtras.add(piAll)

    if (hasCJK(rawTrim)) {
      const zhOnly = rawTrim.replace(/[^\u3400-\u9FFF\uF900-\uFAFF]/g, '')
      if (zhOnly.length >= 1 && zhOnly !== rawTrim) {
        const pfZh = toPinyinCompact(zhOnly)
        const piZh = toPinyinInitialsCompact(zhOnly)
        if (pfZh && pfZh.length >= 2) pinyinExtras.add(pfZh)
        if (piZh && piZh.length >= 2) pinyinExtras.add(piZh)
      }
    }
  }

  expandedTerms = Array.from(new Set(expandedTerms.concat(Array.from(pinyinExtras))))
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)

  return {
    rawQuery: query,
    normalizedQuery: corrected,
    tokens,
    expandedTerms,
    suggestions: getSuggestedQueries(corrected),
    intent: {
      isNaturalQuestion: isNaturalLanguageQuestion(query),
      wantsUpcoming: /(即将|下一次|下个|upcoming|next)/.test(corrected),
      wantsCompleted: /(历史|最近发射|已发射|已完成|completed|previous|past)/.test(corrected)
    }
  }
}

function getDefaultSearchSuggestions() {
  return DEFAULT_SEARCH_SUGGESTIONS.slice()
}

module.exports = {
  analyzeSearchQuery,
  normalizeSearchText,
  tokenizeSearchText,
  getDefaultSearchSuggestions,
  toHalfWidthBasic
}
