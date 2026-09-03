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
  'interplanetary': '行星际',
  unknown: '未知',
  'n/a': '未知',
  na: '未知'
}

/** LL2 config/missiontype 全量 */
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
  'cape canaveral space force station': '卡纳维拉尔角太空军基地',
  'cape canaveral sfs': '卡纳维拉尔角太空军基地',
  'cape canaveral': '卡纳维拉尔角',
  'kennedy space center': '肯尼迪航天中心',
  'spacex starbase': '星舰基地',
  'mahia peninsula': '马希亚半岛',
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
  'mahia launch complex 1': '马希亚 1 号发射场',
  'international space station': '国际空间站',
  iss: '国际空间站',
  'tiangong space station': '天宫空间站',
  tiangong: '天宫空间站',
  // 用户指定固定译名（文学船名，禁止机翻改写）
  'of course i still love you': '当然我依然爱你号',
  ocisly: '当然我依然爱你号',
  'just read the instructions': '只需阅读说明号',
  jrti: '只需阅读说明号',
  'a shortfall of gravitas': '缺乏庄严号',
  asog: '缺乏庄严号',
  // 其余落点 / 工位：航天专业通行译名
  'landing zone 1': '1 号着陆区',
  'lz-1': '1 号着陆区',
  lz1: '1 号着陆区',
  'landing zone 2': '2 号着陆区',
  'lz-2': '2 号着陆区',
  lz2: '2 号着陆区',
  'landing zone 4': '4 号着陆区',
  'lz-4': '4 号着陆区',
  lz4: '4 号着陆区',
  'atlantic ocean': '大西洋',
  'pacific ocean': '太平洋',
  'gulf of mexico': '墨西哥湾',
  'port of long beach': '长滩港',
  'orbital launch mount': '轨道发射台',
  olm: '轨道发射台',
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
  'landing platform vessel': '着陆平台船',
  'lpv-1': '着陆平台船 1 号',
  lpv1: '着陆平台船 1 号',
  'zq-3 lz': '朱雀三号着陆场',
  'zq3 lz': '朱雀三号着陆场',
  zq3lz: '朱雀三号着陆场',
  'zhuque-3 lz': '朱雀三号着陆场',
  'zhuque 3 lz': '朱雀三号着陆场',
  'zhuque-3 landing zone': '朱雀三号着陆场',
  'zhuque-3 landing pad': '朱雀三号着陆场',
  'zhuque 3 landing zone': '朱雀三号着陆场',
  'people\'s republic of china': '中国'
}

/** 按长度降序的短语替换（长文本机翻前预处理）；专有名词保留由 TERM_PROTECT 负责 */
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
  [/\bJiuquan\b/gi, '酒泉'],
  [/\bXichang\b/gi, '西昌'],
  [/\bTaiyuan\b/gi, '太原'],
  [/\bWenchang\b/gi, '文昌'],
  [/Nancy[-–\s]+Grace[-–\s]+Roman[-–\s]+(?:Space\s+)?Telescope/gi, '南希-格蕾丝-罗曼太空望远镜'],
  [/Nancy[-–\s]+Grace[-–\s]+Roman/gi, '南希-格蕾丝-罗曼'],
  [/Roman[-–\s]+Space\s+Telescope/gi, '罗曼太空望远镜'],
  [/James\s+Webb\s+Space\s+Telescope/gi, '詹姆斯·韦伯太空望远镜'],
  // 用户指定固定译名：三艘回收无人船，禁止通译改写
  [/Of\s+Course\s+I\s+Still\s+Love\s+You/gi, '当然我依然爱你号'],
  [/\bOCISLY\b/gi, '当然我依然爱你号'],
  [/Just\s+Read\s+The\s+Instructions/gi, '只需阅读说明号'],
  [/\bJRTI\b/gi, '只需阅读说明号'],
  [/A\s+Shortfall\s+Of\s+Gravitas/gi, '缺乏庄严号'],
  [/\bASOG\b/gi, '缺乏庄严号'],
  [/Low Earth Orbit/gi, '近地轨道'],
  [/Geostationary Transfer Orbit/gi, '地球同步转移轨道'],
  [/Geosynchronous Orbit/gi, '地球同步轨道'],
  [/Geostationary Orbit/gi, '地球静止轨道'],
  [/Medium Earth Orbit/gi, '中地球轨道'],
  [/High Earth Orbit/gi, '高地球轨道'],
  [/Sun-Synchronous Orbit/gi, '太阳同步轨道'],
  [/Polar Orbit/gi, '极地轨道'],
  [/Sub-?orbital/gi, '亚轨道'],
  [/Autonomous Spaceport Drone Ship/gi, '自主海上驳船回收'],
  [/Landing Platform Vessel/gi, '着陆平台船'],
  [/Return to Launch Site/gi, '返回发射场着陆'],
  [/Space Launch Complex\s+(\d+[A-Za-z]?)/gi, '$1 号航天发射工位'],
  [/Launch Complex\s+(\d+[A-Za-z]?)/gi, '$1 号发射台'],
  [/\bSLC[-\s]?(\d+[A-Za-z]?)\b/gi, '$1 号航天发射工位'],
  [/\bLC[-\s]?(\d+[A-Za-z]?)\b/gi, '$1 号发射台'],
  [/Launch Pad\s+(\d+[A-Za-z]?)/gi, '$1 号发射台'],
  [/Landing Zone\s+(\d+)/gi, '$1 号着陆区'],
  [/\bLZ[-\s]?(\d+)\b/gi, '$1 号着陆区'],
  [/Satellite Launch Center/gi, '卫星发射中心'],
  [/Space Launch Site/gi, '航天发射场'],
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
  [/\bFlorida\b/gi, '佛罗里达'],
  [/\bTexas\b/gi, '得克萨斯'],
  [/\bCalifornia\b/gi, '加利福尼亚'],
  [/\bVirginia\b/gi, '弗吉尼亚'],
  [/\bAlaska\b/gi, '阿拉斯加'],
  [/\bJapan\b/gi, '日本'],
  [/\bIndia\b/gi, '印度'],
  [/,\s*(?:CA|FL|TX|VA|AK|NM|HI|GA),\s*USA\b/gi, ', 美国'],
  [/,\s*USA\b/gi, ', 美国'],
  [/Atlantic Ocean/gi, '大西洋'],
  [/Pacific Ocean/gi, '太平洋'],
  [/Gulf of Mexico/gi, '墨西哥湾'],
  [/Port of Long Beach/gi, '长滩港'],
  [/drone\s+ships?/gi, '无人船'],
  [/first\s+stage/gi, '一级'],
  [/second\s+stage/gi, '二级'],
  [/upper\s+stage/gi, '上面级'],
  [/core\s+stage/gi, '芯级'],
  [/solid\s+rocket\s+booster/gi, '固体助推器'],
  [/launch\s+vehicle/gi, '运载火箭'],
  [/launch\s+window/gi, '发射窗口'],
  [/launch\s+site/gi, '发射场'],
  [/orbit insertion/gi, '入轨'],
  [/trans-?lunar injection/gi, '地月转移入轨'],
  [/specific impulse/gi, '比冲'],
  [/liquid oxygen|\bLOX\b/gi, '液氧'],
  [/range safety/gi, '航区安全'],
  [/max[-\s]?Q/gi, '最大动压'],
  [/grid fins?/gi, '栅格舵'],
  [/landing legs?/gi, '着陆支架'],
  [/hot staging/gi, '热分离'],
  [/Wet Dress Rehearsal/gi, '湿彩排'],
  [/Static Fire/gi, '静态点火'],
  [/\bsplashdown\b/gi, '溅落'],
  [/\bre-?entry\b/gi, '再入'],
  [/\bfairing\b/gi, '整流罩'],
  [/Starlink\s+Group\s+/gi, '星链组 '],
  [/\bUnknown\s+Payloads?\b/gi, '未知有效载荷'],
  [/\bpayloads?\b/gi, '有效载荷'],
  [/\bbooster\b/gi, '助推器'],
  [/\bFlight\s+Test\s+(\d+)\b/gi, '第$1次试飞'],
  [/\bFlight\s+Test\b/gi, '试飞'],
  [/\bFlight[-\s]?(\d+)\b/gi, '第$1次飞行'],
  [/\bFlight\b/gi, '飞行'],
  [/\bCRS[-\s]?(\d+)\b/gi, '商业补给$1'],
  [/\bCrew[-\s]?(\d+)\b/gi, '载人-$1'],
  [/\bISS\b/g, '国际空间站'],
  [/\bNo Earlier Than\b/gi, '最早不早于'],
  [/\bNET\b/g, '最早不早于'],
  [/\bTBC\b/g, '待确认'],
  [/\bTBD\b/g, '待定']
]

/**
 * 机翻后纠偏：通译常落成民航/日常义。固定船名先锁死，其余改回航天专业用词。
 */
function repairMachineTranslationZh(zh, srcEn) {
  let s = String(zh || '')
  if (!s) return ''
  const en = String(srcEn || '')

  if (/of course i still love you|\bocisly\b/i.test(en) || /当然我(还|仍然|依然)爱你/.test(s)) {
    s = s.replace(/当然我(?:还|仍然|依然)爱你号?/g, '当然我依然爱你号')
  }
  if (/just read the instructions|\bjrti\b/i.test(en) || /且读须知|只需阅读说明/.test(s)) {
    s = s.replace(/且读须知号?|只需阅读说明号?/g, '只需阅读说明号')
  }
  if (/a shortfall of gravitas|\basog\b/i.test(en) || /风度有缺|缺乏庄严/.test(s)) {
    s = s.replace(/风度有缺号?|缺乏庄严号?/g, '缺乏庄严号')
  }

  s = s
    .replace(/降落区/g, '着陆区')
    .replace(/降落地带/g, '着陆区')
    .replace(/着陆地带/g, '着陆区')
    .replace(/无人机(?:船|舰)/g, '无人船')
    .replace(/无人驾驶船/g, '无人船')
    .replace(/有效负荷/g, '有效载荷')
    .replace(/发射垫/g, '发射台')
    .replace(/太空发射综合体/g, '航天发射工位')
    .replace(/发射综合体/g, '发射工位')
    .replace(/重返大气层/g, '再入')
    .replace(/再入大气层/g, '再入')
    .replace(/静态开火/g, '静态点火')
    .replace(/静态燃烧/g, '静态点火')
    .replace(/湿(?:式|装)彩排/g, '湿彩排')
    .replace(/航天飞机(?=回收|着陆|助推)/g, '航天器')
    .replace(/第一赛段/g, '一级')
    .replace(/第二赛段/g, '二级')
    .replace(/\bASDS\b/g, '无人船')
  return s
}

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

function translateMissionType(type) {
  if (type == null) return ''
  if (typeof type === 'string') return lookupDict(MISSION_TYPE_ZH, type) || ''
  if (typeof type === 'object') return lookupDict(MISSION_TYPE_ZH, type.name) || ''
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

function translateLandingType(landingType) {
  if (!landingType) return ''
  if (typeof landingType === 'string') return lookupDict(LANDING_ZH, landingType) || ''
  if (typeof landingType === 'object') {
    return lookupDict(LANDING_ZH, landingType.name) || lookupDict(LANDING_ZH, landingType.abbrev) || ''
  }
  return ''
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

function applyPhraseRules(text) {
  let s = String(text || '').trim()
  if (!s) return ''
  for (const [re, rep] of PHRASE_RULES) {
    s = s.replace(re, rep)
  }
  return s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
}

/** 机翻前保护专有名词（机构/地点/缩写）；火箭型号名不再保护，需译成中文 */
const TERM_PROTECT = [
  'SpaceX', 'NASA', 'ESA', 'JAXA', 'Roscosmos', 'Blue Origin', 'ULA',
  'Boeing', 'Lockheed Martin', 'Northrop Grumman', 'Rocket Lab', 'Firefly',
  'Cape Canaveral', 'Kennedy Space Center', 'Vandenberg', 'Starbase', 'Boca Chica',
  'ISS', 'Tiangong', 'Artemis', 'Gateway', 'Orion', 'SLS',
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

/**
 * 整句可用中文才算已译。短语规则半译（中英混排）或朱雀误译「雀雀/麻雀」视为不可用，必须重翻或纠偏。
 * 允许残留 SpaceX / NASA / ISS / 工位代号等通行拉丁专名。
 */
function isUsableZhText(text) {
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ').trim()
  if (!raw) return false
  if (/雀雀|麻雀|孔雀/.test(raw)) return false
  if (!/[\u4e00-\u9fff]/.test(raw)) return false
  const rest = raw
    .replace(/\b(SpaceX|NASA|ESA|JAXA|Roscosmos|ULA|ISS|NROL|NRO|LEO|GTO|GEO|MEO|SSO|HEO|ASDS|RTLS|SLS|CRS|Artemis|Orion|Starlink|Transporter|Bandwagon|iQPS|QZS|NET|TBD|TBC|OCISLY|JRTI|ASOG)\b/gi, ' ')
    .replace(/\b(?:[A-Z]{1,4}-?\d+[A-Za-z]?|B\d{3,5})\b/g, ' ')
    .replace(/\b[A-Za-z]{1,2}\b/g, ' ')
  const leftoverWords = rest.match(/[A-Za-z]{3,}/g) || []
  if (leftoverWords.length >= 2) return false
  if (leftoverWords.length === 1 && leftoverWords[0].length >= 4) return false
  const latinLeft = (rest.match(/[A-Za-z]/g) || []).length
  return latinLeft < 8
}

function shouldMachineTranslate(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (s.length < 2) return false
  // 整句已是可用中文才跳过；中英混排仍要送翻
  if (isUsableZhText(s)) return false
  // 纯数字
  if (/^\d+(\.\d+)?$/.test(s)) return false
  // 极短全大写机构/轨道缩写（ISS、LEO、GTO）跳过；含数字的型号（H3-22、KZ-1A）仍可机翻
  if (/^[A-Z]{2,6}$/.test(s) && !/[\u4e00-\u9fff]/.test(s)) return false
  return true
}

function softenKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SPACECRAFT_TYPE_ZH = {
  capsule: '太空舱',
  cargo: '货运飞船',
  'cargo resupply': '货运补给',
  spaceplane: '航天飞机',
  'space station': '空间站',
  station: '空间站',
  tug: '太空拖船',
  lander: '着陆器',
  'reuseable upper stage': '可复用上级',
  'reusable upper stage': '可复用上级',
  'mass simulator': '质量模拟器',
  unknown: '未知'
}

function translateSpacecraftType(name) {
  return lookupDict(SPACECRAFT_TYPE_ZH, name) || ''
}

const SPACECRAFT_ZH = {
  shenzhou: '神舟',
  tianzhou: '天舟',
  'chinese reusable space vehicle': '中国可重复使用航天器',
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
  'cst-100 starliner': 'CST-100 星际客机',
  starliner: '星际客机',
  'dream chaser': '追梦者',
  'crew capsule 1': '新谢泼德乘员舱 1',
  'crew capsule 2.0': '新谢泼德乘员舱 2.0',
  'crew capsule 2': '新谢泼德乘员舱 2',
  orion: '猎户座',
  'apollo command/service module': '阿波罗指令/服务舱',
  'apollo command service module': '阿波罗指令/服务舱',
  'apollo lunar module': '阿波罗登月舱',
  gemini: '双子座',
  mercury: '水星号',
  'space shuttle': '航天飞机',
  'north american x-15': '北美 X-15',
  'x-37b': 'X-37B',
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

function translateSpacecraftName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw) && !/[A-Za-z]{3,}/.test(raw)) return raw
  const direct = lookupDict(SPACECRAFT_ZH, raw)
  if (direct) return direct
  const soft = softenKey(raw)
  const softHit = lookupDict(SPACECRAFT_ZH, soft)
  if (softHit) return softHit
  const keys = Object.keys(SPACECRAFT_ZH).sort((a, b) => b.length - a.length)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.length < 3) continue
    if (soft === k) return SPACECRAFT_ZH[k]
    if (soft.indexOf(k + ' ') !== 0 && soft.indexOf(k + '-') !== 0) continue
    const restSoft = soft.slice(k.length).replace(/^[\s-]+/, '').trim()
    if (!restSoft) return SPACECRAFT_ZH[k]
    const base = SPACECRAFT_ZH[k]
    if ((base === '神舟' || base === '天舟') && /^\d+$/.test(restSoft)) return base + restSoft + '号'
    if (base === '联盟号 MS' && /^\d+$/.test(restSoft)) return '联盟号 MS-' + restSoft
    if (base === '进步号-MS' && /^\d+$/.test(restSoft)) return '进步号-MS-' + restSoft
    if (base === '进步号') {
      const ms = restSoft.match(/^ms[-\s]*(\d+)/i)
      if (ms) return '进步号-MS-' + ms[1]
    }
    if (base === '载人龙飞船' || base === '货运龙飞船' || base === '龙飞船') {
      const shipMap = { freedom: '自由号', endurance: '耐力号', resilience: '韧性号', endeavour: '奋进号', endeavor: '奋进号' }
      const shipKey = restSoft.split(/\s+/)[0]
      const ship = shipMap[shipKey] || restSoft
      return ship ? base + ' ' + ship : base
    }
    if (base === '天鹅座') {
      const crs = raw.match(/CRS\s*NG[-\s]?(\d+)/i) || raw.match(/\bNG[-\s]?(\d+)/i)
      const memorial = raw.match(/\((.+)\)/)
      let out = '天鹅座'
      if (crs) out += ' CRS NG-' + crs[1]
      if (memorial) out += '（' + memorial[1].trim() + '）'
      return out
    }
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

const AGENCY_TYPE_ZH = {
  government: '政府',
  commercial: '商业',
  multinational: '跨国',
  educational: '教育',
  private: '私营',
  'non-profit': '非营利',
  nonprofit: '非营利',
  military: '军方',
  'space agency': '航天机构'
}

const COUNTRY_NAME_ZH = {
  china: '中国',
  'people\'s republic of china': '中国',
  prc: '中国',
  'united states of america': '美国',
  'united states': '美国',
  russia: '俄罗斯',
  japan: '日本',
  india: '印度',
  france: '法国',
  germany: '德国',
  italy: '意大利',
  'united kingdom': '英国',
  'south korea': '韩国',
  'north korea': '朝鲜',
  iran: '伊朗',
  israel: '以色列',
  ukraine: '乌克兰',
  kazakhstan: '哈萨克斯坦',
  'new zealand': '新西兰',
  australia: '澳大利亚',
  canada: '加拿大',
  brazil: '巴西',
  spain: '西班牙',
  argentina: '阿根廷',
  netherlands: '荷兰',
  sweden: '瑞典',
  switzerland: '瑞士',
  norway: '挪威',
  denmark: '丹麦',
  austria: '奥地利',
  belgium: '比利时',
  poland: '波兰',
  turkey: '土耳其',
  singapore: '新加坡',
  indonesia: '印度尼西亚',
  malaysia: '马来西亚',
  thailand: '泰国',
  vietnam: '越南',
  mexico: '墨西哥',
  'south africa': '南非',
  egypt: '埃及',
  'united arab emirates': '阿联酋',
  'saudi arabia': '沙特阿拉伯',
  luxembourg: '卢森堡',
  portugal: '葡萄牙',
  scotland: '苏格兰',
  taiwan: '中国台湾'
}

function translateAgencyType(name) {
  return lookupDict(AGENCY_TYPE_ZH, name) || ''
}

function translateCountryName(name) {
  return lookupDict(COUNTRY_NAME_ZH, name) || ''
}

module.exports = {
  ORBIT_ZH,
  MISSION_TYPE_ZH,
  LANDING_ZH,
  STATUS_ZH,
  EVENT_TYPE_ZH,
  DATE_PRECISION_ZH,
  LOCATION_ZH,
  lookupDict,
  translateOrbit,
  translateMissionType,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLandingType,
  translateLocation,
  translateSpacecraftName,
  translateSpacecraftType,
  translateAgencyType,
  translateCountryName,
  applyPhraseRules,
  repairMachineTranslationZh,
  protectTerms,
  restoreTerms,
  shouldMachineTranslate,
  isUsableZhText
}
