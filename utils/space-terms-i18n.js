/**
 * 客户端术语词典兜底 — 云端 xxxZh 缺失时使用（与云函数 space-terms-i18n.js 保持同步）
 */

const ORBIT_ZH = {
  'low earth orbit': '近地轨道', leo: '近地轨道',
  'geostationary transfer orbit': '地球同步转移轨道', gto: '地球同步转移轨道',
  'geosynchronous orbit': '地球同步轨道', geo: '地球同步轨道',
  'medium earth orbit': '中地球轨道', meo: '中地球轨道',
  'sun-synchronous orbit': '太阳同步轨道', sso: '太阳同步轨道'
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
  spacewalk: '太空行走', docking: '对接', launch: '发射', landing: '着陆',
  'static fire': '静态点火', rollout: '转运', 'wet dress rehearsal': '湿彩排',
  'press conference': '新闻发布会', deployment: '部署', reentry: '再入'
}

const DATE_PRECISION_ZH = {
  second: '精确到秒', minute: '精确到分', hour: '精确到小时', day: '精确到天',
  month: '精确到月', quarter: '精确到季度', year: '精确到年'
}

const LOCATION_ZH = {
  'kennedy space center lc-39a': '肯尼迪航天中心 39A 发射台',
  'cape canaveral slc-40': '卡纳维拉尔角 40 号发射工位',
  'vandenberg slc-4e': '范登堡 4E 发射工位',
  starbase: '星舰基地', 'boca chica': '博卡奇卡',
  'lop nur airbase': '罗布泊空军实验基地',
  lna: '罗布泊空军实验基地'
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
  'shanghai academy of spaceflight technology': '上海航天技术研究院',
  sast: '上海航天技术研究院',
  'shanghai spacesail technologies': '上海垣信卫星科技',
  spacesail: '上海垣信卫星科技',
  'china manned space agency': '中国载人航天工程办公室',
  cmsa: '中国载人航天工程办公室',
  'space pioneer (tianbing aerospace)': '天兵科技',
  'beijing tianbing technology co., ltd.': '天兵科技',
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
  return lookupDict(LOCATION_ZH, name) || ''
}

/** 发射商名 → 中文（name 与 abbrev 均可命中；未收录返回空串） */
function translateAgencyName(name, abbrev) {
  return lookupDict(AGENCY_ZH, name) || lookupDict(AGENCY_ZH, abbrev) || ''
}

module.exports = {
  translateOrbit,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLocation,
  translateAgencyName
}
