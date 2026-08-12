/**
 * 客户端术语词典兜底 — 云端 xxxZh 缺失时使用（与云函数 space-terms-i18n.js 保持同步）
 */

const ORBIT_ZH = {
  'low earth orbit': '近地轨道', leo: '近地轨道',
  'geostationary transfer orbit': '地球同步转移轨道', gto: '地球同步转移轨道',
  'geosynchronous orbit': '地球同步轨道', geo: '地球同步轨道',
  'medium earth orbit': '中地球轨道', meo: '中地球轨道',
  'high earth orbit': '高地球轨道', heo: '高地球轨道',
  'polar orbit': '极地轨道',
  'sun-synchronous orbit': '太阳同步轨道', sso: '太阳同步轨道',
  'sub-orbital': '亚轨道', suborbital: '亚轨道',
  'lunar orbit': '月球轨道',
  'heliocentric orbit': '日心轨道',
  'mars orbit': '火星轨道',
  interplanetary: '行星际',
  unknown: '未知',
  'n/a': '未知',
  na: '未知'
}

/** LL2 config/missiontype 全量（+ 常见别名） */
const MISSION_TYPE_ZH = {
  'earth science': '地球科学',
  'planetary science': '行星科学',
  astrophysics: '天体物理',
  heliophysics: '日地物理',
  'human exploration': '载人探索',
  'robotic exploration': '机器人探索',
  'government/top secret': '政府/机密',
  tourism: '太空旅游',
  unknown: '未知',
  communications: '通信',
  resupply: '补给',
  suborbital: '亚轨道',
  'test flight': '试飞',
  'dedicated rideshare': '专属拼车发射',
  navigation: '导航',
  'test target': '试验靶标',
  'lunar exploration': '月球探索',
  'materials science': '材料科学',
  biology: '生物学',
  'space situational awareness': '空间态势感知',
  technology: '技术验证',
  'mission extension': '任务延寿'
}

const STATUS_ZH = {
  go: '正常', 'go for launch': '准备发射', hold: '暂停', tbd: '待定', tbc: '待确认',
  success: '成功', failure: '失败', 'partial failure': '部分失败', 'in flight': '飞行中',
  'to be confirmed': '待确认', 'to be determined': '待定',
  'launch successful': '发射成功', 'launch failure': '发射失败',
  'launch was a partial failure': '部分失败', 'launch in flight': '飞行中',
  'on hold': '已暂停', 'payload deployed': '载荷已部署'
}

const EVENT_TYPE_ZH = {
  spacewalk: '太空行走',
  eva: '出舱活动',
  docking: '对接',
  'spacecraft undocking': '飞船撤离',
  undocking: '撤离',
  'spacecraft berthing': '飞船停靠',
  berthing: '停靠',
  'spacecraft landing': '飞船着陆',
  'spacecraft release': '飞船释放',
  'spacecraft event': '飞船事件',
  'orbital insertion': '入轨',
  reboost: '轨道抬升',
  'crew handover': '乘组交接',
  'change of command': '指挥权交接',
  splashdown: '溅落',
  'crew departure': '乘组撤离',
  launch: '发射',
  landing: '着陆',
  'static fire': '静态点火',
  rollout: '转运',
  'wet dress rehearsal': '湿彩排',
  'press conference': '新闻发布会',
  deployment: '部署',
  reentry: '再入'
}

const DATE_PRECISION_ZH = {
  second: '精确到秒', minute: '精确到分', hour: '精确到小时', day: '精确到天',
  month: '精确到月', quarter: '精确到季度', year: '精确到年'
}

const LOCATION_ZH = {
  'international space station': '国际空间站',
  iss: '国际空间站',
  'tiangong space station': '天宫空间站',
  tiangong: '天宫空间站',
  'kennedy space center lc-39a': '肯尼迪航天中心 39A 发射台',
  'kennedy space center lc-39b': '肯尼迪航天中心 39B 发射台',
  'kennedy space center': '肯尼迪航天中心',
  'cape canaveral slc-40': '卡纳维拉尔角 40 号发射工位',
  'cape canaveral slc-41': '卡纳维拉尔角 41 号发射工位',
  'cape canaveral space force station slc-40': '卡纳维拉尔角 40 号发射工位',
  'cape canaveral space force station': '卡纳维拉尔角太空军基地',
  'cape canaveral': '卡纳维拉尔角',
  'vandenberg slc-4e': '范登堡 4E 发射工位',
  'vandenberg space force base slc-4e': '范登堡 4E 发射工位',
  'vandenberg space force base': '范登堡太空军基地',
  vandenberg: '范登堡',
  starbase: '星舰基地',
  'boca chica': '博卡奇卡',
  'baikonur cosmodrome': '拜科努尔航天发射场',
  baikonur: '拜科努尔',
  'guiana space centre': '圭亚那航天中心',
  'tanegashima space center': '种子岛宇宙中心',
  'jiuquan satellite launch center': '酒泉卫星发射中心',
  jiuquan: '酒泉卫星发射中心',
  'xichang satellite launch center': '西昌卫星发射中心',
  xichang: '西昌卫星发射中心',
  'taiyuan satellite launch center': '太原卫星发射中心',
  taiyuan: '太原卫星发射中心',
  'wenchang space launch site': '文昌航天发射场',
  wenchang: '文昌航天发射场',
  'kennedy space center': '肯尼迪航天中心',
  'cape canaveral sfs': '卡纳维拉尔角太空军基地',
  'vandenberg sfb': '范登堡太空军基地',
  'spacex starbase': '星舰基地（博卡奇卡）',
  'wallops flight facility': '瓦勒普斯飞行设施',
  'mahia launch complex 1': '马希亚 1 号发射场',
  'rocket lab launch complex 1': '火箭实验室 1 号发射场',
  'lop nur airbase': '罗布泊空军实验基地',
  lna: '罗布泊空军实验基地',
  'plesetsk cosmodrome': '普列谢茨克航天发射场',
  'vostochny cosmodrome': '东方航天发射场',
  'satish dhawan space centre': '萨蒂什·达万航天中心',
  sriharikota: '斯里哈里科塔',
  'uchinoura space center': '内之浦宇宙空间观测所',
  'naro space center': '罗老宇航中心',
  'kodiak launch complex': '科迪亚克发射场'
}

/** 发射商 / 机构名（key 为 LL2 name 或 abbrev 的小写；SpaceX 等品牌名不译） */
const AGENCY_ZH = {
  // 中国
  'china aerospace science and technology corporation': '中国航天科技集团',
  casc: '中国航天科技集团',
  'china aerospace science and industry corporation': '中国航天科工集团',
  casic: '中国航天科工集团',
  expace: '航天科工火箭（快舟）',
  'galactic energy': '星河动力',
  landspace: '蓝箭航天',
  'ispace': '星际荣耀',
  'i-space': '星际荣耀',
  'space pioneer': '天兵科技',
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
  // 捷龙系列运营商（LL2: China Rocket Co. Ltd. / abbrev CHNR）
  'china rocket co. ltd.': '中国火箭公司',
  'china rocket co., ltd.': '中国火箭公司',
  'china rocket co ltd': '中国火箭公司',
  'china rocket co ltd.': '中国火箭公司',
  'china rocket company': '中国火箭公司',
  'china rocket': '中国火箭公司',
  chnr: '中国火箭公司',
  'china long march rocket co. ltd.': '中国长征火箭有限公司',
  'china long march rocket co., ltd.': '中国长征火箭有限公司',
  'china long march rocket': '中国长征火箭有限公司',
  'shanghai academy of spaceflight technology': '上海航天技术研究院',
  sast: '上海航天技术研究院',
  'shanghai spacesail technologies': '上海垣信卫星科技',
  spacesail: '上海垣信卫星科技',
  'china manned space agency': '中国载人航天工程办公室',
  cmsa: '中国载人航天工程办公室',
  'space pioneer (tianbing aerospace)': '天兵科技',
  'beijing tianbing technology co., ltd.': '天兵科技',
  // 图鉴常见英文缩写 / 全称（截图未汉化项）
  'ap-mcsta': '亚太空间技术与应用多边合作组织',
  apmcsta: '亚太空间技术与应用多边合作组织',
  'asia pacific multilateral cooperation in space technology and applications': '亚太空间技术与应用多边合作组织',
  pla: '中国人民解放军',
  'people\'s liberation army': '中国人民解放军',
  'peoples liberation army': '中国人民解放军',
  tispace: '台湾创新太空',
  'ti space': '台湾创新太空',
  'taiwan innovative space': '台湾创新太空',
  'taiwan innovative space inc': '台湾创新太空',
  'taiwan innovative space inc.': '台湾创新太空',
  tasa: '台湾太空中心',
  'taiwan space agency': '台湾太空中心',
  nspo: '国家太空中心',
  'national space organization': '国家太空中心',
  'national space organization (nspo)': '国家太空中心',
  onespace: '零壹空间',
  'one space': '零壹空间',
  'linkspace': '翎客航天',
  'link space': '翎客航天',
  'galactic energy (beijing)': '星河动力',
  'beijing galactic energy': '星河动力',
  'cas space (zhongke aerospace)': '中科宇航',
  zhongke: '中科宇航',
  'people\'s liberation army strategic support force': '解放军战略支援部队',
  'pla strategic support force': '解放军战略支援部队',
  'pla aerospace force': '解放军军事航天部队',
  // 国际
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

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

function lookupDict(dict, raw) {
  const key = normKey(raw)
  return key ? (dict[key] || '') : ''
}

function translateOrbit(orbit) {
  if (!orbit || typeof orbit !== 'object') return ''
  return lookupDict(ORBIT_ZH, orbit.name) || lookupDict(ORBIT_ZH, orbit.abbrev) || ''
}

/** 轨道展示名字符串（含 Unknown / N/A）→ 中文 */
function translateOrbitLabel(nameOrAbbrev) {
  return lookupDict(ORBIT_ZH, nameOrAbbrev) || ''
}

/** LL2 mission.type（字符串或 { name }）→ 中文 */
function translateMissionType(type) {
  if (type == null) return ''
  if (typeof type === 'string') return lookupDict(MISSION_TYPE_ZH, type) || ''
  if (typeof type === 'object') {
    return lookupDict(MISSION_TYPE_ZH, type.name) || ''
  }
  return ''
}

function translateStatusName(name) {
  return lookupDict(STATUS_ZH, name) || ''
}

function translateEventType(name) {
  return lookupDict(EVENT_TYPE_ZH, name) || ''
}

function translateDatePrecision(name) {
  return lookupDict(DATE_PRECISION_ZH, name) || ''
}

function translateLocation(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  let hit = lookupDict(LOCATION_ZH, raw) || lookupDict(LOCATION_ZH, softenKey(raw))
  if (hit) return hit
  // "Wenchang Space Launch Site, People's Republic of China" → 先取逗号前主体
  const main = raw.split(',')[0].trim()
  if (main && main !== raw) {
    hit = lookupDict(LOCATION_ZH, main) || lookupDict(LOCATION_ZH, softenKey(main))
    if (hit) return hit
  }
  return ''
}

function softenKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 发射商名 → 中文（name 与 abbrev 均可命中；未收录返回空串） */
function translateAgencyName(name, abbrev) {
  const direct = lookupDict(AGENCY_ZH, name) || lookupDict(AGENCY_ZH, abbrev)
  if (direct) return direct
  // Co. / Ltd. 标点差异兜底：China Rocket Co. Ltd. ↔ china rocket co ltd
  return lookupDict(AGENCY_ZH, softenKey(name)) || lookupDict(AGENCY_ZH, softenKey(abbrev)) || ''
}

/**
 * LL2 spacecraft_configurations.name → 中文（未收录返回空串）
 * 键同时收录原文与 soften 形态，兼容括号/连字符差异
 */
const SPACECRAFT_ZH = {
  // 中国
  shenzhou: '神舟',
  tianzhou: '天舟',
  'chinese reusable space vehicle': '中国可重复使用航天器',
  // SpaceX
  'crew dragon 2': '载人龙飞船 2',
  'crew dragon': '载人龙飞船',
  'cargo dragon 2': '货运龙飞船 2',
  'cargo dragon': '货运龙飞船',
  'dragon 1': '龙飞船 1',
  dragon: '龙飞船',
  'starship v1': '星舰 V1',
  'starship v2': '星舰 V2',
  'starship v3': '星舰 V3',
  starship: '星舰',
  'tesla roadster': '特斯拉 Roadster',
  // 波音 / Sierra / Blue Origin
  'cst-100 starliner': 'CST-100 星际客机',
  starliner: '星际客机',
  'dream chaser': '追梦者',
  'crew capsule 1': '新谢泼德乘员舱 1',
  'crew capsule 2.0': '新谢泼德乘员舱 2.0',
  'crew capsule 2': '新谢泼德乘员舱 2',
  // NASA / 阿波罗时代
  orion: '猎户座',
  'apollo command/service module': '阿波罗指令/服务舱',
  'apollo command service module': '阿波罗指令/服务舱',
  'apollo lunar module': '阿波罗登月舱',
  gemini: '双子座',
  mercury: '水星号',
  'space shuttle': '航天飞机',
  'north american x-15': '北美 X-15',
  'x-37b': 'X-37B',
  // 俄系
  soyuz: '联盟号',
  'soyuz ms': '联盟号 MS',
  'soyuz t': '联盟号 T',
  'soyuz tm': '联盟号 TM',
  'soyuz tma': '联盟号 TMA',
  'soyuz tma-m': '联盟号 TMA-M',
  'progress 7k-tg': '进步号 7K-TG',
  'progress-m': '进步号-M',
  'progress-m1': '进步号-M1',
  'progress-m (modified)': '进步号-M（改进型）',
  'progress-m modified': '进步号-M（改进型）',
  'progress-ms': '进步号-MS',
  'progress m-um': '进步号 M-UM',
  progress: '进步号',
  vostok: '东方号',
  voskhod: '上升号',
  buran: '暴风雪号',
  // 欧日印货船 / 其它
  'automated transfer vehicle (atv)': '自动转移飞行器（ATV）',
  'automated transfer vehicle atv': '自动转移飞行器（ATV）',
  'automated transfer vehicle': '自动转移飞行器（ATV）',
  atv: '自动转移飞行器（ATV）',
  'h-ii transfer vehicle (htv)': 'H-II 转移飞行器（白鹳）',
  'h-ii transfer vehicle htv': 'H-II 转移飞行器（白鹳）',
  'h-ii transfer vehicle': 'H-II 转移飞行器（白鹳）',
  htv: 'H-II 转移飞行器（白鹳）',
  'htv-x': 'HTV-X（白鹳 X）',
  'cygnus enhanced': '增强型天鹅座',
  'cygnus standard': '标准型天鹅座',
  'cygnus upgraded': '升级型天鹅座',
  cygnus: '天鹅座',
  gaganyaan: '加甘扬号',
  'space rider': '太空骑士',
  spaceshiptwo: '太空船二号',
  'space ship two': '太空船二号'
}

/**
 * 飞船构型/实例名 → 中文（未收录返回空串）
 * 支持实例后缀：Soyuz MS-25 → 联盟号 MS-25；Crew Dragon Endeavour → 载人龙飞船 2 Endeavour（若仅命中 crew dragon 2）
 */
function translateSpacecraftName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw) && !/[A-Za-z]{3,}/.test(raw)) return raw

  const direct = lookupDict(SPACECRAFT_ZH, raw)
  if (direct) return direct
  const soft = softenKey(raw)
  const softHit = lookupDict(SPACECRAFT_ZH, soft)
  if (softHit) return softHit

  // 最长前缀匹配：构型词典 + 飞行器编号/呼号后缀
  const keys = Object.keys(SPACECRAFT_ZH).sort((a, b) => b.length - a.length)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.length < 3) continue
    if (soft === k) return SPACECRAFT_ZH[k]
    if (soft.indexOf(k + ' ') !== 0 && soft.indexOf(k + '-') !== 0) continue
    const restSoft = soft.slice(k.length).replace(/^[\s-]+/, '').trim()
    if (!restSoft) return SPACECRAFT_ZH[k]
    const base = SPACECRAFT_ZH[k]
    // 神舟/天舟：Shenzhou 20 → 神舟20号
    if ((base === '神舟' || base === '天舟') && /^\d+$/.test(restSoft)) {
      return base + restSoft + '号'
    }
    // 联盟号 MS / 进步号-MS：保留 MS-编号
    if (base === '联盟号 MS' && /^\d+$/.test(restSoft)) return '联盟号 MS-' + restSoft
    if (base === '进步号-MS' && /^\d+$/.test(restSoft)) return '进步号-MS-' + restSoft
    const re = new RegExp(
      '^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\-]+') + '[\\s\\-]+(.+)$',
      'i'
    )
    const m = raw.match(re)
    const suffix = (m && m[1] ? String(m[1]).trim() : restSoft)
    return suffix ? base + ' ' + suffix : base
  }
  return ''
}

module.exports = {
  translateOrbit,
  translateOrbitLabel,
  translateMissionType,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLocation,
  translateAgencyName,
  translateSpacecraftName
}
