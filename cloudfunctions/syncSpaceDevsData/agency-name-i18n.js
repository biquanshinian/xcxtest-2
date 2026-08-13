/**
 * 发射商名 → 展示文案（与 utils/space-terms-i18n 中国条目对齐）。
 * 服务号：运维巡检公司 / 单位名称。
 */
const AGENCY_ZH = {
  // 中国
  'china aerospace science and technology corporation': '中国航天科技集团',
  casc: '中国航天科技集团',
  'china aerospace science and industry corporation': '中国航天科工集团',
  casic: '中国航天科工集团',
  expace: '航天科工火箭（快舟）',
  'galactic energy': '星河动力',
  landspace: '蓝箭航天',
  ispace: '星际荣耀',
  'i-space': '星际荣耀',
  'space pioneer': '天兵科技',
  'space pioneer (tianbing aerospace)': '天兵科技',
  'beijing tianbing technology co., ltd.': '天兵科技',
  orienspace: '东方空间',
  'cas space': '中科宇航',
  'deep blue aerospace': '深蓝航天',
  'china national space administration': '国家航天局',
  cnsa: '国家航天局',
  'chinese academy of sciences': '中国科学院',
  'china great wall industry corporation': '中国长城工业集团',
  cgwic: '中国长城工业集团',
  'china academy of launch vehicle technology': '中国运载火箭技术研究院',
  calt: '中国运载火箭技术研究院',
  'shanghai academy of spaceflight technology': '上海航天技术研究院',
  sast: '上海航天技术研究院',
  'shanghai spacesail technologies': '上海垣信卫星科技',
  spacesail: '上海垣信卫星科技',
  'china manned space agency': '中国载人航天工程办公室',
  cmsa: '中国载人航天工程办公室',
  // 国际（卡片同源）
  'united launch alliance': '联合发射联盟',
  ula: '联合发射联盟',
  'rocket lab': '火箭实验室',
  'rocket lab ltd': '火箭实验室',
  arianespace: '阿丽亚娜航天',
  'russian federal space agency (roscosmos)': '俄罗斯国家航天集团',
  roscosmos: '俄罗斯国家航天集团',
  'national aeronautics and space administration': '美国国家航空航天局',
  nasa: '美国国家航空航天局',
  'european space agency': '欧洲航天局',
  esa: '欧洲航天局',
  'indian space research organization': '印度空间研究组织',
  isro: '印度空间研究组织',
  'japan aerospace exploration agency': '日本宇宙航空研究开发机构',
  jaxa: '日本宇宙航空研究开发机构',
  'mitsubishi heavy industries': '三菱重工',
  'mitsubishi heavy industries, ltd.': '三菱重工',
  mhi: '三菱重工',
  'blue origin': '蓝色起源',
  'northrop grumman innovation systems': '诺斯罗普·格鲁曼创新系统',
  'northrop grumman space systems': '诺斯罗普·格鲁曼航天系统',
  'firefly aerospace': '萤火虫航天',
  'relativity space': '相对论航天',
  'virgin galactic': '维珍银河',
  'virgin orbit': '维珍轨道',
  'astra space': '阿斯特拉',
  'sierra nevada corporation': '内华达山脉公司',
  'korea aerospace research institute': '韩国航空宇宙研究院',
  kari: '韩国航空宇宙研究院',
  'israel aerospace industries': '以色列航空航天工业',
  'iranian space agency': '伊朗航天局',
  'international launch services': '国际发射服务公司',
  'khrunichev state research and production space center': '赫鲁尼切夫国家航天中心',
  'united states space force': '美国太空军',
  ussf: '美国太空军',
  'united states air force': '美国空军',
  'national reconnaissance office': '美国国家侦察局',
  nro: '美国国家侦察局',
  'russian space forces': '俄罗斯航天军',
  'soviet space program': '苏联航天计划',
  'axiom space': '公理航天',
  'sierra space': '内华达山脉航天',
  boeing: '波音',
  'north american aviation': '北美航空',
  'hindustan aeronautics limited': '印度斯坦航空',
  hal: '印度斯坦航空',
  grumman: '格鲁曼',
  'gilmour space technologies': '吉尔莫航天',
  'firefly black': '萤火虫航天',
  'agnikul cosmos': '阿格尼库尔宇航',
  skyroot: '天根航天',
  'skyroot aerospace': '天根航天'
}

/** 国际品牌保持常用写法 */
const AGENCY_KEEP = {
  spacex: 'SpaceX',
  'space exploration technologies': 'SpaceX',
  'space exploration technologies corp': 'SpaceX',
  'space exploration technologies corporation': 'SpaceX'
}

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function translateAgencyName(name, abbrev) {
  const n = normKey(name)
  const a = normKey(abbrev)
  if (AGENCY_KEEP[n]) return AGENCY_KEEP[n]
  if (AGENCY_KEEP[a]) return AGENCY_KEEP[a]
  if (n && AGENCY_ZH[n]) return AGENCY_ZH[n]
  if (a && AGENCY_ZH[a]) return AGENCY_ZH[a]
  const raw = String(name || abbrev || '').trim()
  return raw
}

/**
 * 发射商缺失时，按火箭型号做弱推断（仅中国商发/国发常见箭）。
 * 有明确 LSP 时不要调用。
 */
function inferAgencyFromRocket(rocketEn, rocketZh) {
  const h = (String(rocketEn || '') + ' ' + String(rocketZh || '')).toLowerCase()
  if (!h.trim()) return ''
  if (/kuaizhou|快舟/.test(h)) return '航天科工火箭（快舟）'
  if (/ceres|谷神星/.test(h)) return '星河动力'
  if (/zhuque|朱雀|landspace|朱雀/.test(h)) return '蓝箭航天'
  if (/hyperbola|双曲线|i-?space|星际荣耀/.test(h)) return '星际荣耀'
  if (/tianlong|天龙|space pioneer|天兵/.test(h)) return '天兵科技'
  if (/gravity|引力/.test(h)) return '东方空间'
  if (/kinetica|力箭|lijian|cas space|中科/.test(h)) return '中科宇航'
  if (/jielong|捷龙|smart dragon/.test(h)) return '中国航天科技集团'
  if (/long march|长征|\bcz[- ]?\d|长征/.test(h)) return '中国航天科技集团'
  if (/\bh3\b|h-ii|h-2|h2a|h2b/.test(h)) return '三菱重工'
  return ''
}

module.exports = { translateAgencyName, inferAgencyFromRocket }
