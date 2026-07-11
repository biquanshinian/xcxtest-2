/**
 * LL2 / SNAPI 航天术语词典 — 固定枚举与常见短语优先走规则，不走机翻
 */

/** 轨道类型（name / abbrev 均可命中） */
const ORBIT_ZH = {
  'low earth orbit': '近地轨道',
  leo: '近地轨道',
  'geostationary transfer orbit': '地球同步转移轨道',
  gto: '地球同步转移轨道',
  'geosynchronous orbit': '地球同步轨道',
  geo: '地球同步轨道',
  'medium earth orbit': '中地球轨道',
  meo: '中地球轨道',
  'high earth orbit': '高地球轨道',
  heo: '高地球轨道',
  'polar orbit': '极地轨道',
  'sun-synchronous orbit': '太阳同步轨道',
  sso: '太阳同步轨道',
  'sub-orbital': '亚轨道',
  'lunar orbit': '月球轨道',
  'heliocentric orbit': '日心轨道',
  'mars orbit': '火星轨道',
  'interplanetary': '行星际'
}

/** 回收 / 着陆类型 */
const LANDING_ZH = {
  'autonomous spaceport drone ship': '自主海上驳船回收',
  asds: '海上驳船回收',
  'return to launch site': '返回发射场着陆',
  rtls: '返回发射场着陆',
  'expended': '不回收',
  exp: '不回收',
  'atmosphere': '大气层再入',
  atm: '大气层再入',
  'heli landing': '直升机回收',
  hl: '直升机回收',
  'vertical landing': '垂直着陆',
  vl: '垂直着陆'
}

/** 发射状态（含 LL2 status.name 真实全称与 abbrev 两套 key） */
const STATUS_ZH = {
  go: '正常',
  'go for launch': '准备发射',
  hold: '暂停',
  tbd: '待定',
  tbc: '待确认',
  success: '成功',
  failure: '失败',
  'partial failure': '部分失败',
  'in flight': '飞行中',
  'to be confirmed': '待确认',
  'to be determined': '待定',
  'date/time to be confirmed': '日期待确认',
  'date/time to be determined': '日期待定',
  // LL2 /config/launchstatuses 全称
  'launch successful': '发射成功',
  'launch failure': '发射失败',
  'launch was a partial failure': '部分失败',
  'launch in flight': '飞行中',
  'on hold': '已暂停',
  'payload deployed': '载荷已部署'
}

/** 事件类型 */
const EVENT_TYPE_ZH = {
  'spacewalk': '太空行走',
  'docking': '对接',
  'launch': '发射',
  'landing': '着陆',
  'meeting': '会议',
  'presentation': '发布会',
  'test': '测试',
  'award ceremony': '颁奖典礼',
  'mission milestone': '任务里程碑',
  'mission update': '任务更新',
  'press conference': '新闻发布会',
  'media event': '媒体活动',
  'conference': '会议',
  'conjunction': '交会',
  'reentry': '再入',
  'undocking': '分离',
  'deployment': '部署',
  'static fire': '静态点火',
  'rollout': '转运',
  'wet dress rehearsal': '湿彩排'
}

/** 日期精度 */
const DATE_PRECISION_ZH = {
  'second': '精确到秒',
  'minute': '精确到分',
  'hour': '精确到小时',
  'day': '精确到天',
  'month': '精确到月',
  'quarter': '精确到季度',
  'half': '精确到半年',
  'year': '精确到年'
}

/** 常见发射台 / 地点（精确匹配，大小写不敏感） */
const LOCATION_ZH = {
  'kennedy space center lc-39a': '肯尼迪航天中心 39A 发射台',
  'kennedy space center lc-39b': '肯尼迪航天中心 39B 发射台',
  'cape canaveral slc-40': '卡纳维拉尔角 40 号发射工位',
  'cape canaveral slc-41': '卡纳维拉尔角 41 号发射工位',
  'cape canaveral space force station slc-40': '卡纳维拉尔角 40 号发射工位',
  'vandenberg slc-4e': '范登堡 4E 发射工位',
  'vandenberg space force base slc-4e': '范登堡 4E 发射工位',
  'starbase': '星舰基地',
  'boca chica': '博卡奇卡',
  'baikonur cosmodrome': '拜科努尔航天发射场',
  'guiana space centre': '圭亚那航天中心',
  'tanegashima space center': '种子岛宇宙中心',
  'jiuquan satellite launch center': '酒泉卫星发射中心',
  'xichang satellite launch center': '西昌卫星发射中心',
  'taiyuan satellite launch center': '太原卫星发射中心',
  'wenchang space launch site': '文昌航天发射场',
  'wallops flight facility': '瓦勒普斯飞行设施',
  'mahia launch complex 1': '马希亚 1 号发射场'
}

/** 按长度降序的短语替换（长文本机翻前预处理）；专有名词保留由 TERM_PROTECT 负责 */
const PHRASE_RULES = [
  [/Low Earth Orbit/gi, '近地轨道'],
  [/Geostationary Transfer Orbit/gi, '地球同步转移轨道'],
  [/Geosynchronous Orbit/gi, '地球同步轨道'],
  [/Medium Earth Orbit/gi, '中地球轨道'],
  [/Sun-Synchronous Orbit/gi, '太阳同步轨道'],
  [/Autonomous Spaceport Drone Ship/gi, '自主海上驳船回收'],
  [/Return to Launch Site/gi, '返回发射场着陆'],
  [/Wet Dress Rehearsal/gi, '湿彩排'],
  [/Static Fire/gi, '静态点火'],
  [/\bISS\b/g, '国际空间站']
]

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

function lookupDict(dict, raw) {
  const key = normKey(raw)
  if (!key) return ''
  return dict[key] || ''
}

function translateOrbit(orbit) {
  if (!orbit || typeof orbit !== 'object') return ''
  const name = orbit.name || ''
  const abbrev = orbit.abbrev || ''
  return lookupDict(ORBIT_ZH, name) || lookupDict(ORBIT_ZH, abbrev) || ''
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

function translateLandingType(landingType) {
  if (!landingType) return ''
  if (typeof landingType === 'string') return lookupDict(LANDING_ZH, landingType) || ''
  if (typeof landingType === 'object') {
    return lookupDict(LANDING_ZH, landingType.name) || lookupDict(LANDING_ZH, landingType.abbrev) || ''
  }
  return ''
}

function translateLocation(name) {
  return lookupDict(LOCATION_ZH, name) || ''
}

function applyPhraseRules(text) {
  let s = String(text || '').trim()
  if (!s) return ''
  for (const [re, rep] of PHRASE_RULES) {
    s = s.replace(re, rep)
  }
  return s.trim()
}

/** 机翻前保护专有名词，避免被误译 */
const TERM_PROTECT = [
  'Falcon 9', 'Falcon Heavy', 'Starship', 'Super Heavy', 'Starlink', 'Crew Dragon',
  'Dragon', 'SpaceX', 'NASA', 'ESA', 'JAXA', 'Roscosmos', 'Blue Origin', 'ULA',
  'Boeing', 'Lockheed Martin', 'Northrop Grumman', 'Rocket Lab', 'Firefly',
  'Cape Canaveral', 'Kennedy Space Center', 'Vandenberg', 'Starbase', 'Boca Chica',
  'ISS', 'Tiangong', 'Artemis', 'Gateway', 'Orion', 'SLS', 'New Glenn', 'Electron',
  'Raptor', 'Merlin', 'Draco', 'SuperDraco', 'KSC', 'LC-39A', 'LC-39B', 'SLC-40',
  'SLC-4E', 'ASDS', 'RTLS', 'LEO', 'GTO', 'GEO', 'MEO', 'SSO'
]

// 占位符用 {0} 数字格式：机翻引擎对本地化占位符保留最稳；还原时兼容全角括号/空格等被改写的变体
function protectTerms(text) {
  let s = String(text || '')
  const placeholders = []
  for (let i = 0; i < TERM_PROTECT.length; i++) {
    const term = TERM_PROTECT[i]
    // \b 词边界必不可少：否则 ISS 会命中 "mission" 中间的 iss，导致机翻残句
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')
    s = s.replace(re, (match) => {
      const idx = placeholders.length
      placeholders.push(match)
      return `{${idx}}`
    })
  }
  return { text: s, placeholders }
}

function restoreTerms(text, placeholders) {
  let s = String(text || '')
  s = s.replace(/[{｛]\s*(\d+)\s*[}｝]/g, (full, num) => {
    const idx = Number(num)
    return placeholders[idx] != null ? placeholders[idx] : full
  })
  return s
}

function shouldMachineTranslate(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (s.length < 4) return false
  // 纯数字/编号/缩写
  if (/^[A-Z0-9\s\-/.]+$/.test(s) && s.length < 30) return false
  // 已含大量中文则跳过
  if (/[\u4e00-\u9fff]/.test(s)) return false
  return true
}

module.exports = {
  ORBIT_ZH,
  LANDING_ZH,
  STATUS_ZH,
  EVENT_TYPE_ZH,
  DATE_PRECISION_ZH,
  LOCATION_ZH,
  lookupDict,
  translateOrbit,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLandingType,
  translateLocation,
  applyPhraseRules,
  protectTerms,
  restoreTerms,
  shouldMachineTranslate
}
