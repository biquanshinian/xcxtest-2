/**
 * 任务卡 / 详情 / 航警 / 图鉴共用的场址与任务类型展示回退。
 * 优先云端 *Zh；未写入时用与云端 space-terms-i18n 同一套词典，禁止各页各写一套。
 */
const { isUsableZhText } = require('./locale.js')

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

const LOCATION_ZH = {
  'kennedy space center lc-39a': '肯尼迪航天中心 39A 发射台',
  'kennedy space center lc-39b': '肯尼迪航天中心 39B 发射台',
  'kennedy space center': '肯尼迪航天中心',
  'cape canaveral slc-40': '卡纳维拉尔角 40 号发射工位',
  'cape canaveral slc-41': '卡纳维拉尔角 41 号发射工位',
  'cape canaveral space force station slc-40': '卡纳维拉尔角 40 号发射工位',
  'cape canaveral space force station': '卡纳维拉尔角太空军基地',
  'cape canaveral sfs': '卡纳维拉尔角太空军基地',
  'cape canaveral': '卡纳维拉尔角',
  'vandenberg slc-4e': '范登堡 4E 发射工位',
  'vandenberg space force base slc-4e': '范登堡 4E 发射工位',
  'vandenberg space force base': '范登堡太空军基地',
  starbase: '星舰基地',
  'spacex starbase': '星舰基地',
  'boca chica': '博卡奇卡',
  'baikonur cosmodrome': '拜科努尔航天发射场',
  'guiana space centre': '圭亚那航天中心',
  'tanegashima space center': '种子岛宇宙中心',
  'jiuquan satellite launch center': '酒泉卫星发射中心',
  'xichang satellite launch center': '西昌卫星发射中心',
  'taiyuan satellite launch center': '太原卫星发射中心',
  'wenchang space launch site': '文昌航天发射场',
  'wallops flight facility': '瓦勒普斯飞行设施',
  'mahia peninsula': '马希亚半岛',
  'mahia launch complex 1': '马希亚 1 号发射场',
  'space launch complex 40': '40 号航天发射工位',
  'slc-40': '40 号航天发射工位',
  'space launch complex 41': '41 号航天发射工位',
  'slc-41': '41 号航天发射工位',
  'space launch complex 4e': '4E 航天发射工位',
  'slc-4e': '4E 航天发射工位',
  'launch complex 39a': '39A 发射台',
  'lc-39a': '39A 发射台',
  'launch complex 39b': '39B 发射台',
  'lc-39b': '39B 发射台',
  'orbital launch mount': '轨道发射台',
  olm: '轨道发射台',
  'international space station': '国际空间站',
  iss: '国际空间站',
  'tiangong space station': '天宫空间站',
  tiangong: '天宫空间站',
  'zq-3 lz': '朱雀三号着陆场',
  'zq3 lz': '朱雀三号着陆场',
  'zhuque-3 lz': '朱雀三号着陆场',
  'zhuque-3 landing zone': '朱雀三号着陆场',
  'people\'s republic of china': '中国',
  'of course i still love you': '当然我依然爱你号',
  ocisly: '当然我依然爱你号',
  'just read the instructions': '只需阅读说明号',
  jrti: '只需阅读说明号',
  'a shortfall of gravitas': '缺乏庄严号',
  asog: '缺乏庄严号',
  asds: '无人船',
  'autonomous spaceport drone ship': '自主海上驳船回收',
  'vandenberg sfb': '范登堡太空军基地',
  'vandenberg space force base': '范登堡太空军基地',
  vandenberg: '范登堡',
  'harmony zenith': '和谐号天顶',
  'harmony forward': '和谐号前方',
  'harmony nadir': '和谐号天底',
  'unity nadir': '团结号天底',
  'unity forward': '团结号前方',
  'destiny forward': '命运号前方',
  'zvezda aft': '星辰号尾部',
  'poisk zenith': '探索号天顶',
  'prichal nadir': '码头号天底',
  'nauka nadir': '科学号天底',
  'rassvet nadir': '黎明号天底'
}

const PHRASE_RULES = [
  [/\bZQ-?3\s+LZ\b/gi, '朱雀三号着陆场'],
  [/Zhuque-?3\s+(?:LZ|Landing\s+Zone|Landing\s+Pad)/gi, '朱雀三号着陆场'],
  [/\bUSSF[-\s]?(\d+)\b/gi, '美国太空军-$1'],
  [/\bUSSF\b/g, '美国太空军'],
  [/People'?s\s+Republic\s+of\s+China/gi, '中国'],
  [/Jiuquan\s+Satellite\s+Launch\s+Center/gi, '酒泉卫星发射中心'],
  [/Xichang\s+Satellite\s+Launch\s+Center/gi, '西昌卫星发射中心'],
  [/Taiyuan\s+Satellite\s+Launch\s+Center/gi, '太原卫星发射中心'],
  [/Wenchang\s+Space\s+Launch\s+Site/gi, '文昌航天发射场'],
  [/Launch\s+Area\s+(\d+)\s*([A-Za-z])\b/gi, '发射区 $1$2'],
  [/Launch\s+Area\s+(\d+)\b/gi, '发射区 $1'],
  [/Cape\s+Canaveral\s+Space\s+Force\s+Station/gi, '卡纳维拉尔角太空军基地'],
  [/\bCape\s+Canaveral\s+SFS\b/gi, '卡纳维拉尔角太空军基地'],
  [/\bCCSFS\b/g, '卡纳维拉尔角太空军基地'],
  [/\bCCAFS\b/g, '卡纳维拉尔角太空军基地'],
  [/Cape\s+Canaveral/gi, '卡纳维拉尔角'],
  [/Kennedy\s+Space\s+Center/gi, '肯尼迪航天中心'],
  [/\bKSC\b/g, '肯尼迪航天中心'],
  [/SpaceX\s+Starbase/gi, '星舰基地'],
  [/\bStarbase\b/gi, '星舰基地'],
  [/Boca\s+Chica/gi, '博卡奇卡'],
  [/Baikonur\s+Cosmodrome/gi, '拜科努尔航天发射场'],
  [/Guiana\s+Space\s+Centre/gi, '圭亚那航天中心'],
  [/Tanegashima\s+Space\s+Center/gi, '种子岛宇宙中心'],
  [/Wallops\s+Flight\s+Facility/gi, '瓦勒普斯飞行设施'],
  [/Wallops\s+Island/gi, '瓦勒普斯岛'],
  [/Mahia\s+Peninsula/gi, '马希亚半岛'],
  [/Rocket\s+Lab\s+Launch\s+Complex\s+(\d+)/gi, '火箭实验室 $1 号发射场'],
  [/Plesetsk\s+Cosmodrome/gi, '普列谢茨克航天发射场'],
  [/Vostochny\s+Cosmodrome/gi, '东方航天发射场'],
  [/Satish\s+Dhawan\s+Space\s+Centre/gi, '萨蒂什·达万航天中心'],
  [/Naro\s+Space\s+Center/gi, '罗老航天中心'],
  [/Semnan\s+Space\s+Center/gi, '塞姆南航天中心'],
  [/Pacific\s+Spaceport\s+Complex/gi, '太平洋航天港'],
  [/Space Launch Complex\s+(\d+[A-Za-z]?)/gi, '$1 号航天发射工位'],
  [/Launch Complex\s+(\d+[A-Za-z]?)/gi, '$1 号发射台'],
  [/Launch Pad\s+(\d+[A-Za-z]?)/gi, '$1 号发射台'],
  [/\bSLC[-\s]?(\d+[A-Za-z]?)\b/gi, '$1 号航天发射工位'],
  [/\bLC[-\s]?(\d+[A-Za-z]?)\b/gi, '$1 号发射台'],
  [/Landing Zone\s+(\d+)/gi, '$1 号着陆区'],
  [/Orbital Launch Mount(?:\s+([A-Za-z0-9]+))?/gi, '轨道发射台$1'],
  [/Satellite Launch Center/gi, '卫星发射中心'],
  [/Space Launch Site/gi, '航天发射场'],
  [/\bJiuquan\b/gi, '酒泉'],
  [/\bXichang\b/gi, '西昌'],
  [/\bTaiyuan\b/gi, '太原'],
  [/\bWenchang\b/gi, '文昌'],
  [/International Space Station/gi, '国际空间站'],
  [/\bISS\b/g, '国际空间站'],
  [/Tiangong Space Station/gi, '天宫空间站'],
  [/\bExpedition\s+(\d+)\b/gi, '远征 $1'],
  [/Of\s+Course\s+I\s+Still\s+Love\s+You/gi, '当然我依然爱你号'],
  [/\bOCISLY\b/gi, '当然我依然爱你号'],
  [/Just\s+Read\s+The\s+Instructions/gi, '只需阅读说明号'],
  [/\bJRTI\b/gi, '只需阅读说明号'],
  [/A\s+Shortfall\s+Of\s+Gravitas/gi, '缺乏庄严号'],
  [/\bASOG\b/gi, '缺乏庄严号'],
  [/Autonomous Spaceport Drone Ship/gi, '自主海上驳船回收'],
  [/\bASDS\b/g, '无人船'],
  [/Vandenberg\s+Space\s+Force\s+Base/gi, '范登堡太空军基地'],
  [/\bVandenberg\s+SFB\b/gi, '范登堡太空军基地'],
  [/\bVSFB\b/g, '范登堡太空军基地'],
  [/\bVAFB\b/g, '范登堡太空军基地'],
  [/\bVandenberg\b/gi, '范登堡'],
  [/Space Force Station/gi, '太空军基地'],
  [/Space Force Base/gi, '太空军基地'],
  [/\bSFB\b/g, '太空军基地'],
  [/\bSFS\b/g, '太空军基地'],
  [/United\s+States(?:\s+of\s+America)?/gi, '美国'],
  [/Republic\s+of\s+Kazakhstan/gi, '哈萨克斯坦'],
  [/\bKazakhstan\b/gi, '哈萨克斯坦'],
  [/French\s+Guiana/gi, '法属圭亚那'],
  [/New\s+Zealand/gi, '新西兰'],
  [/Republic\s+of\s+Korea|South\s+Korea/gi, '韩国'],
  [/\bFlorida\b/gi, '佛罗里达'],
  [/\bTexas\b/gi, '得克萨斯'],
  [/\bCalifornia\b/gi, '加利福尼亚'],
  [/\bVirginia\b/gi, '弗吉尼亚'],
  [/\bAlaska\b/gi, '阿拉斯加'],
  [/\bJapan\b/gi, '日本'],
  [/\bIndia\b/gi, '印度'],
  [/,\s*(?:CA|FL|TX|VA|AK|NM|HI|GA),\s*USA\b/gi, ', 美国'],
  [/,\s*USA\b/gi, ', 美国'],
  [/Harmony\s+zenith/gi, '和谐号天顶'],
  [/Harmony\s+forward/gi, '和谐号前方'],
  [/Harmony\s+nadir/gi, '和谐号天底'],
  [/Unity\s+nadir/gi, '团结号天底'],
  [/Zvezda\s+aft/gi, '星辰号尾部'],
  [/Poisk\s+zenith/gi, '探索号天顶'],
  [/Prichal\s+nadir/gi, '码头号天底']
]

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
  'mars orbit': '火星轨道'
}

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

function lookupDict(dict, raw) {
  const key = normKey(raw)
  if (!key) return ''
  return dict[key] || ''
}

function applyPhraseRules(text) {
  let s = String(text || '').trim()
  if (!s) return ''
  for (let i = 0; i < PHRASE_RULES.length; i++) {
    s = s.replace(PHRASE_RULES[i][0], PHRASE_RULES[i][1])
  }
  return s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
}

function translateLocationSegment(part) {
  const raw = String(part || '').trim()
  if (!raw) return ''
  const exact = lookupDict(LOCATION_ZH, raw)
  if (exact) return exact
  const prepared = applyPhraseRules(raw)
  if (prepared && isUsableZhText(prepared)) return prepared
  return ''
}

function translateLocation(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const whole = translateLocationSegment(raw)
  if (whole) return whole
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return ''
  const zhParts = parts.map((p) => translateLocationSegment(p) || applyPhraseRules(p) || p)
  const joined = zhParts.join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return isUsableZhText(joined) ? joined : ''
}

function translateMissionType(type) {
  if (type == null) return ''
  if (typeof type === 'string') return lookupDict(MISSION_TYPE_ZH, type) || ''
  if (typeof type === 'object') return lookupDict(MISSION_TYPE_ZH, type.name) || ''
  return ''
}

function translateOrbit(orbit) {
  if (orbit == null) return ''
  if (typeof orbit === 'string') {
    return lookupDict(ORBIT_ZH, orbit) || ''
  }
  if (typeof orbit === 'object') {
    return lookupDict(ORBIT_ZH, orbit.name) || lookupDict(ORBIT_ZH, orbit.abbrev) || ''
  }
  return ''
}

module.exports = {
  translateLocation,
  translateMissionType,
  translateOrbit,
  applyPhraseRules
}
