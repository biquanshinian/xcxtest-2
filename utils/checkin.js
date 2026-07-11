/**
 * 每日签到 + 太空知识卡 + 成就徽章系统
 * 数据持久化：localStorage（轻量、离线可用）
 */

const storageCache = require('./storage-sync-cache.js')
const { getCachedIcon } = require('./icon-cache.js')

const STORAGE_KEY = '_checkin_data'
const ACHIEVEMENTS_KEY = '_achievements_data'
const KNOWLEDGE_CARDS_CACHE_KEY = '_knowledge_cards_cache'

let _checkinMem = null
let _checkinMemLoaded = false

function _defaultCheckinData() {
  return {
    totalDays: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastCheckinDate: '',
    collectedFactIds: [],
    checkinHistory: []
  }
}

const SPACE_FACTS = [
  { id: 1, category: '太阳系', fact: '土星的密度比水还低，如果有一个足够大的浴缸，土星能浮在水面上。', source: 'NASA' },
  { id: 2, category: '宇宙', fact: '可观测宇宙的直径约930亿光年，包含至少2万亿个星系。', source: 'Hubble' },
  { id: 3, category: '火星', fact: '火星上的奥林匹斯山是太阳系最高的山，高度约21.9公里，是珠穆朗玛峰的近3倍。', source: 'NASA' },
  { id: 4, category: 'SpaceX', fact: 'SpaceX的猎鹰9号是人类历史上第一款成功实现一级助推器回收复用的轨道级运载火箭。', source: 'SpaceX' },
  { id: 5, category: '太阳系', fact: '金星的一天（自转周期243地球日）比它的一年（公转周期225地球日）还长。', source: 'NASA' },
  { id: 6, category: '宇宙', fact: '中子星的密度极高，一茶匙的中子星物质重约60亿吨，相当于一座山的重量。', source: 'ESA' },
  { id: 7, category: '月球', fact: '月球正在以每年3.8厘米的速度远离地球。在遥远的未来，月球将不再能完全遮挡太阳。', source: 'NASA' },
  { id: 8, category: 'SpaceX', fact: '星舰（Starship）高度约120米，是人类有史以来最高最强大的运载火箭。', source: 'SpaceX' },
  { id: 9, category: '太阳系', fact: '木星的大红斑是一个已经持续了至少400年的超级风暴，大小足以容纳两个地球。', source: 'NASA' },
  { id: 10, category: '宇宙', fact: '宇宙的年龄约138亿年。光从宇宙诞生至今走过的距离，约等于从地球到太阳距离的8.7万亿倍。', source: 'Planck' },
  { id: 11, category: '火星', fact: '火星的日落是蓝色的。由于火星大气中的尘埃粒子散射光线的方式，夕阳呈现冷蓝色调。', source: 'Curiosity' },
  { id: 12, category: '太阳', fact: '太阳每秒钟将约400万吨物质转化为能量，但即使以这个速率燃烧，太阳还能再燃烧约50亿年。', source: 'NASA' },
  { id: 13, category: '空间站', fact: '国际空间站以每小时27,600公里的速度运行，每90分钟绕地球一圈，宇航员每天能看到16次日出。', source: 'NASA' },
  { id: 14, category: 'SpaceX', fact: 'SpaceX的星链计划已发射超过6,000颗卫星，构成人类历史上最大的卫星星座。', source: 'SpaceX' },
  { id: 15, category: '太阳系', fact: '海王星上的风速可达每小时2,100公里，是太阳系中风速最快的行星。', source: 'Voyager' },
  { id: 16, category: '宇宙', fact: '宇宙中存在一个被称为"牧夫座空洞"的区域，直径约3.3亿光年，几乎完全空无一物。', source: 'Astronomy' },
  { id: 17, category: '月球', fact: '阿波罗宇航员在月球上留下的脚印可以保存数百万年，因为月球没有风和水来侵蚀它们。', source: 'NASA' },
  { id: 18, category: '火星', fact: '好奇号火星车每年火星生日时都会为自己唱一首生日快乐歌。它于2012年着陆，至今仍在工作。', source: 'NASA' },
  { id: 19, category: '太阳系', fact: '冥王星的心形区域（汤博区）大小约与得克萨斯州相当，由氮冰覆盖。', source: 'New Horizons' },
  { id: 20, category: '宇宙', fact: '已知最大的恒星盾牌座UY，半径约是太阳的1,700倍。如果把它放在太阳系中心，其表面会延伸到木星轨道附近。', source: 'ESO' },
  { id: 21, category: 'SpaceX', fact: '猎鹰重型火箭的首飞载荷是一辆特斯拉Roadster跑车，车上播放着大卫·鲍伊的《Space Oddity》。', source: 'SpaceX' },
  { id: 22, category: '太阳系', fact: '天王星的自转轴倾斜了98度，几乎是"躺着"绕太阳公转的，一个极点会连续面对太阳42年。', source: 'NASA' },
  { id: 23, category: '宇宙', fact: '黑洞并不是"洞"，而是密度极大的天体。一个太阳质量的黑洞，其史瓦西半径仅约3公里。', source: 'Physics' },
  { id: 24, category: '火星', fact: '火星大气中95%是二氧化碳，气压仅为地球的0.6%。毅力号正在用MOXIE装置尝试将CO₂转化为氧气。', source: 'NASA' },
  { id: 25, category: '空间站', fact: '中国天宫空间站总重约100吨，由天和核心舱、问天实验舱和梦天实验舱组成。', source: 'CMSA' },
  { id: 26, category: '太阳', fact: '太阳的核心温度约1,500万度，每秒进行约3.8×10²⁶焦耳的核聚变反应。', source: 'NASA' },
  { id: 27, category: '宇宙', fact: '旅行者1号于1977年发射，目前距地球超过240亿公里，是离地球最远的人造物体。', source: 'NASA' },
  { id: 28, category: 'SpaceX', fact: 'SpaceX龙飞船是首个由私人公司开发并将宇航员送入国际空间站的载人航天器。', source: 'SpaceX' },
  { id: 29, category: '太阳系', fact: '木星的卫星木卫二（欧罗巴）冰层下可能存在一个巨大的液态水海洋，水量可能是地球海洋的两倍。', source: 'NASA' },
  { id: 30, category: '月球', fact: '月球表面的温度变化极端：白天可达127°C，夜晚可降至-173°C，温差达300度。', source: 'NASA' },
  { id: 31, category: '宇宙', fact: '如果你能以光速旅行，到达最近的恒星比邻星也需要4.24年。', source: 'ESA' },
  { id: 32, category: '火星', fact: '火星的两颗卫星火卫一和火卫二非常小，可能是被火星引力捕获的小行星。', source: 'NASA' },
  { id: 33, category: '太阳系', fact: '土星环主要由冰粒和岩石碎片组成，虽然宽达28万公里，但最薄处仅约10米。', source: 'Cassini' },
  { id: 34, category: 'SpaceX', fact: '马斯克的终极目标是在火星建立百万人口的自给自足城市，使人类成为多行星物种。', source: 'SpaceX' },
  { id: 35, category: '宇宙', fact: '在太空中，宇航员的身高会增加约5厘米，因为脊椎在微重力下不再受到地球引力的压缩。', source: 'NASA' },
  { id: 36, category: '太阳系', fact: '水星虽然离太阳最近，但金星才是太阳系最热的行星（约465°C），因为其浓厚的CO₂大气产生了极端温室效应。', source: 'NASA' },
  { id: 37, category: '空间站', fact: 'ISS上的水循环系统能回收约90%的液体，包括汗液和尿液，净化后供宇航员饮用。', source: 'NASA' },
  { id: 38, category: '宇宙', fact: '宇宙微波背景辐射的温度约为2.7开尔文（-270.4°C），是大爆炸留下的"余温"。', source: 'COBE' },
  { id: 39, category: '火星', fact: '火星上的尘暴可以覆盖整个星球，持续数月之久。2018年的全球尘暴导致机遇号火星车永久失联。', source: 'NASA' },
  { id: 40, category: 'SpaceX', fact: 'Starlink卫星配备了自主避碰系统，能根据太空碎片追踪数据自动调整轨道。', source: 'SpaceX' },
  { id: 41, category: '太阳系', fact: '小行星带位于火星和木星之间，但所有小行星的总质量还不到月球的4%。', source: 'NASA' },
  { id: 42, category: '宇宙', fact: '暗物质和暗能量合计占宇宙总质能的约95%，我们能看到的普通物质仅占约5%。', source: 'Planck' },
  { id: 43, category: '月球', fact: '月球上有水冰存在的证据。NASA的LCROSS任务在月球南极永久阴影坑中发现了水冰。', source: 'NASA' },
  { id: 44, category: '太阳', fact: '一次大型日冕物质抛射（CME）可以释放10²⁵焦耳的能量，相当于数十亿颗原子弹同时爆炸。', source: 'SOHO' },
  { id: 45, category: '宇宙', fact: '脉冲星是高速旋转的中子星，有些脉冲星每秒可旋转716次，比家用搅拌机的转速还快。', source: 'Astronomy' },
  { id: 46, category: 'Artemis', fact: 'NASA的阿耳忒弥斯计划旨在2020年代将首位女性和首位有色人种宇航员送上月球。', source: 'NASA' },
  { id: 47, category: '太阳系', fact: '土卫六（泰坦）是太阳系中唯一拥有浓厚大气层和表面液态湖泊的卫星，不过湖泊里是液态甲烷。', source: 'Cassini' },
  { id: 48, category: '火星', fact: '火星赤道附近曾存在大量河流和湖泊的痕迹，科学家认为约35亿年前火星可能有过温暖湿润的环境。', source: 'ESA' },
  { id: 49, category: '宇宙', fact: '引力波在2015年被LIGO首次直接探测到，验证了爱因斯坦100年前的预言。', source: 'LIGO' },
  { id: 50, category: 'SpaceX', fact: 'SpaceX的猛禽发动机使用液态甲烷和液氧作为推进剂，部分原因是火星上可以就地生产甲烷燃料。', source: 'SpaceX' },
  { id: 51, category: '太阳系', fact: '木星拥有至少95颗已知卫星，其中木卫三是太阳系最大的卫星，比水星还大。', source: 'NASA' },
  { id: 52, category: '宇宙', fact: 'GPS卫星需要考虑相对论效应修正时钟——由于卫星速度和引力差异，每天会产生约38微秒的误差。', source: 'Physics' },
  { id: 53, category: '中国航天', fact: '长征系列运载火箭已完成500多次发射任务，是中国航天的主力运载工具。', source: 'CASC' },
  { id: 54, category: '中国航天', fact: '嫦娥五号于2020年成功带回约1.7公斤月球样本，是人类时隔44年再次获取月壤。', source: 'CNSA' },
  { id: 55, category: '宇宙', fact: '在真空的太空中，两块相同金属的裸露表面接触后会永久粘合在一起，这叫做"冷焊接"。', source: 'NASA' },
  { id: 56, category: '太阳系', fact: '天王星和海王星内部可能在极端高压下产生"钻石雨"——碳原子被压缩成钻石并像雨一样降落。', source: 'Nature' },
  { id: 57, category: '火星', fact: '火星一天（火星日）约24小时37分钟，与地球的一天非常接近，这是它适合人类殖民的原因之一。', source: 'NASA' },
  { id: 58, category: '宇宙', fact: '地球每天约有100吨来自太空的微小陨石尘埃落入大气层，大部分在高空就被烧毁。', source: 'ESA' },
  { id: 59, category: 'SpaceX', fact: '星舰的超重型助推器（Super Heavy）配备33台猛禽发动机，总推力约7,590吨力。', source: 'SpaceX' },
  { id: 60, category: '太阳系', fact: '海王星的卫星海卫一（Triton）是太阳系中唯一一颗逆行运转的大卫星，可能是被海王星捕获的柯伊伯带天体。', source: 'Voyager' }
]

// ── 成就定义 ──
const { getAllStats } = require('./behavior-stats.js')
const { recordMilestone } = require('./user-growth.js')

const BADGE_ICON_BASE = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%AD%BE%E5%88%B0%E5%9B%BE%E6%A0%87/'

const ACHIEVEMENT_DEFS = [
  { id: 'first_checkin', name: '初入星途', desc: '完成首次签到', iconIdx: 1, condition: (s) => s.totalDays >= 1 },
  { id: 'streak_3', name: '三日连星', desc: '连续签到3天', iconIdx: 2, condition: (s) => s.maxStreak >= 3 },
  { id: 'streak_7', name: '一周轨道', desc: '连续签到7天', iconIdx: 3, condition: (s) => s.maxStreak >= 7 },
  { id: 'streak_14', name: '双周巡航', desc: '连续签到14天', iconIdx: 4, condition: (s) => s.maxStreak >= 14 },
  { id: 'streak_30', name: '月球常驻', desc: '连续签到30天', iconIdx: 5, condition: (s) => s.maxStreak >= 30 },
  { id: 'total_7', name: '太空新手', desc: '累计签到7天', iconIdx: 6, condition: (s) => s.totalDays >= 7 },
  { id: 'total_30', name: '轨道旅者', desc: '累计签到30天', iconIdx: 7, condition: (s) => s.totalDays >= 30 },
  { id: 'total_100', name: '星际探索者', desc: '累计签到100天', iconIdx: 8, condition: (s) => s.totalDays >= 100 },
  { id: 'total_365', name: '光年先锋', desc: '累计签到365天', iconIdx: 9, condition: (s) => s.totalDays >= 365 },
  { id: 'facts_10', name: '知识收集者', desc: '收集10张太空知识卡', iconIdx: 10, condition: (s) => s.factsCollected >= 10 },
  { id: 'facts_30', name: '太空百科', desc: '收集30张太空知识卡', iconIdx: 11, condition: (s) => s.factsCollected >= 30 },
  { id: 'facts_all', name: '全知全能', desc: '收集全部太空知识卡', iconIdx: 12, condition: (s) => s.factsCollected >= s.totalCards },
  { id: 'quiz_5', name: '好奇宝宝', desc: '答对5道太空问答', iconIdx: 13, condition: (s) => s.quizCorrect >= 5 },
  { id: 'quiz_15', name: '学识渊博', desc: '答对15道太空问答', iconIdx: 14, condition: (s) => s.quizCorrect >= 15 },
  { id: 'quiz_all', name: '太空学霸', desc: '答对全部太空问答', iconIdx: 15, condition: (s) => s.quizCorrect >= 20 },
  // ── 太空探索成就（对应 COS 图标 16_1.png ~ 21_1.png） ──
  { id: 'night_owl', name: '夜猫子', desc: '凌晨观看发射直播', iconIdx: 16, hint: '在凌晨0-5点打开直播观看', condition: (s) => s.nightOwlCount >= 1 },
  { id: 'full_attendance', name: '全勤观察员', desc: '连续7天打开小程序', iconIdx: 17, hint: '连续7天每天打开小程序', condition: (s) => s.maxConsecutiveOpenDays >= 7 },
  { id: 'mars_expert', name: '火星通', desc: '浏览100张火星车照片', iconIdx: 18, hint: '在火星探索中浏览100张火星车照片', condition: (s) => s.marsPhotoCount >= 100 },
  { id: 'satellite_hunter', name: '星链猎人', desc: '使用卫星追踪功能', iconIdx: 19, hint: '使用卫星过境追踪功能观测卫星', condition: (s) => s.satelliteARCount >= 1 },
  { id: 'news_master', name: '百科全书', desc: '阅读50篇事件新闻', iconIdx: 20, hint: '浏览50篇不同的航天新闻', condition: (s) => s.newsReadCount >= 50 },
  { id: 'prophet', name: '先知', desc: '提前订阅提醒且发射成功', iconIdx: 21, hint: '发射前24小时订阅提醒，且该任务成功发射', condition: (s) => s.prophetCount >= 1 }
]

function getTodayStr() {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function getYesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function loadCheckinData() {
  if (_checkinMemLoaded) return _checkinMem
  const raw = storageCache.readSync(STORAGE_KEY, null)
  _checkinMem = (raw && typeof raw === 'object') ? raw : _defaultCheckinData()
  _checkinMemLoaded = true
  return _checkinMem
}

function warmCheckinStoreSync() {
  return loadCheckinData()
}

function saveCheckinData(data) {
  _checkinMem = data
  _checkinMemLoaded = true
  storageCache.persistAsync(STORAGE_KEY, data)
}

function isCheckedInToday() {
  const data = loadCheckinData()
  return data.lastCheckinDate === getTodayStr()
}

var _cloudCards = null
var _cloudCardsLoading = false

function loadKnowledgeCards(callback) {
  if (_cloudCards) { if (callback) callback(_cloudCards); return }

  try {
    var cached = storageCache.readSync(KNOWLEDGE_CARDS_CACHE_KEY, null)
    if (cached && Array.isArray(cached) && cached.length > 0) {
      _cloudCards = cached
      if (callback) callback(_cloudCards)
      return
    }
  } catch (e) {}

  if (_cloudCardsLoading) { if (callback) callback(null); return }
  if (!wx.cloud || !wx.cloud.callFunction) { if (callback) callback(null); return }

  _cloudCardsLoading = true
  wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: '/knowledge-cards/public', method: 'GET' }
  }).then(function (res) {
    var list = (res.result && res.result.data) || []
    if (list.length > 0) {
      var cards = list.map(function (c) {
        return { id: c.cardId || c._id, category: c.category, fact: c.fact, source: c.source }
      })
      _cloudCards = cards
      storageCache.persistAsync(KNOWLEDGE_CARDS_CACHE_KEY, cards)
    }
    _cloudCardsLoading = false
  }).catch(function () {
    _cloudCardsLoading = false
  })

  if (callback) callback(null)
}

function getActiveCards() {
  return _cloudCards && _cloudCards.length > 0 ? _cloudCards : SPACE_FACTS
}

function getRandomFact(collectedIds) {
  var cards = getActiveCards()
  var uncollected = cards.filter(function (f) { return !(collectedIds || []).includes(f.id) })
  var pool = uncollected.length > 0 ? uncollected : cards
  return pool[Math.floor(Math.random() * pool.length)]
}

function doCheckIn() {
  const data = loadCheckinData()
  const today = getTodayStr()

  if (data.lastCheckinDate === today) {
    return { success: false, alreadyCheckedIn: true, data, fact: null }
  }

  const yesterday = getYesterdayStr()
  const isConsecutive = data.lastCheckinDate === yesterday

  data.totalDays += 1
  data.currentStreak = isConsecutive ? data.currentStreak + 1 : 1
  if (data.currentStreak > data.maxStreak) {
    data.maxStreak = data.currentStreak
  }
  data.lastCheckinDate = today

  const fact = getRandomFact(data.collectedFactIds)
  if (!data.collectedFactIds.includes(fact.id)) {
    data.collectedFactIds.push(fact.id)
  }

  if (!Array.isArray(data.checkinHistory)) data.checkinHistory = []
  data.checkinHistory.push(today)
  if (data.checkinHistory.length > 90) {
    data.checkinHistory = data.checkinHistory.slice(-90)
  }

  saveCheckinData(data)

  recordMilestone('FIRST_CHECKIN')
  if (data.currentStreak >= 7) recordMilestone('STREAK_7')
  if (data.currentStreak >= 30) recordMilestone('STREAK_30')
  if (data.collectedFactIds.length >= 10) recordMilestone('FACTS_10')

  return { success: true, data, fact }
}

function getCheckinSummary() {
  const data = loadCheckinData()
  const today = getTodayStr()
  const yesterday = getYesterdayStr()

  // 断签展示为 0，但不 mutate 共享内存对象（避免内存与 storage 不一致；
  // 实际连击归零由 doCheckIn 的 isConsecutive 判定完成）
  const streakBroken = data.lastCheckinDate !== today && data.lastCheckinDate !== yesterday

  return {
    totalDays: data.totalDays || 0,
    currentStreak: streakBroken ? 0 : (data.currentStreak || 0),
    maxStreak: data.maxStreak || 0,
    isCheckedInToday: data.lastCheckinDate === today,
    factsCollected: (data.collectedFactIds || []).length,
    totalFacts: getActiveCards().length,
    recentHistory: (data.checkinHistory || []).slice(-7)
  }
}

function getWeekCheckinDots() {
  const data = loadCheckinData()
  const history = data.checkinHistory || []
  const dots = []
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']

  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')
    dots.push({
      date: dateStr,
      day: weekDays[d.getDay()],
      dayNum: d.getDate(),
      checked: history.includes(dateStr),
      isToday: i === 0
    })
  }
  return dots
}

// ── 成就系统 ──

function checkAchievements() {
  const data = loadCheckinData()

  let quizCorrect = 0
  try {
    const quizData = storageCache.readMemOrSync('_space_quiz_data', null)
    if (quizData) quizCorrect = quizData.correctCount || 0
  } catch (e) {}

  const behaviorStats = getAllStats()

  const stats = {
    totalDays: data.totalDays || 0,
    maxStreak: data.maxStreak || 0,
    currentStreak: data.currentStreak || 0,
    factsCollected: (data.collectedFactIds || []).length,
    totalCards: getActiveCards().length,
    quizCorrect,
    nightOwlCount: behaviorStats.nightOwlCount,
    maxConsecutiveOpenDays: behaviorStats.maxConsecutiveOpenDays,
    newsReadCount: behaviorStats.newsReadCount,
    satelliteARCount: behaviorStats.satelliteARCount,
    marsPhotoCount: behaviorStats.marsPhotoCount || 0,
    prophetCount: behaviorStats.prophetCount
  }

  let savedAchievements = storageCache.readMemOrSync(ACHIEVEMENTS_KEY, {}) || {}

  const results = []
  const newlyUnlocked = []

  ACHIEVEMENT_DEFS.forEach(def => {
    const unlocked = def.condition(stats)
    const wasUnlocked = !!savedAchievements[def.id]
    const fullDef = { ...def, iconUrl: getCachedIcon(BADGE_ICON_BASE + def.iconIdx + '_1.png') }
    if (unlocked && !wasUnlocked) {
      savedAchievements[def.id] = { unlockedAt: Date.now() }
      newlyUnlocked.push(fullDef)
    }
    results.push({
      ...fullDef,
      unlocked,
      unlockedAt: savedAchievements[def.id] ? savedAchievements[def.id].unlockedAt : null
    })
  })

  storageCache.persistAsync(ACHIEVEMENTS_KEY, savedAchievements)

  // 有新解锁时主动推送到云端，确保删除小程序后能恢复
  if (newlyUnlocked.length > 0) {
    try {
      pushAllToCloud(true)
    } catch (e) {}
  }

  return {
    achievements: results,
    newlyUnlocked,
    unlockedCount: results.filter(a => a.unlocked).length,
    totalCount: results.length
  }
}

// ── 云端同步（本地优先 + 后台写云） ──

const CLOUD_FUNCTION_NAME = 'userDataGateway'
const SYNC_FLAG_KEY = '_checkin_cloud_synced'

/**
 * 签到后异步同步到云端（不阻塞 UI）
 * @param {number} factId 本次签到获得的知识卡 ID
 */
function syncCheckinToCloud(factId) {
  if (!wx.cloud || !wx.cloud.callFunction) return
  wx.cloud.callFunction({
    name: CLOUD_FUNCTION_NAME,
    data: { action: 'checkin', factId }
  }).catch(() => {})
}

/**
 * 从云端拉取用户档案并合并到本地
 * 适合在 onLaunch / profile onLoad 时调用一次
 */
async function pullProfileFromCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) return null
  try {
    const res = await wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: { action: 'getProfile' }
    })
    const result = res && res.result
    if (!result || !result.success) return null

    const cloud = result.profile
    const local = loadCheckinData()

    const merged = {
      totalDays: Math.max(cloud.checkin.totalDays || 0, local.totalDays || 0),
      currentStreak: Math.max(cloud.checkin.currentStreak || 0, local.currentStreak || 0),
      maxStreak: Math.max(cloud.checkin.maxStreak || 0, local.maxStreak || 0),
      lastCheckinDate: (cloud.checkin.lastCheckinDate || '') > (local.lastCheckinDate || '')
        ? cloud.checkin.lastCheckinDate : local.lastCheckinDate,
      collectedFactIds: [...new Set([
        ...(cloud.checkin.collectedFactIds || []),
        ...(local.collectedFactIds || [])
      ])],
      checkinHistory: [...new Set([
        ...(cloud.checkin.checkinHistory || []),
        ...(local.checkinHistory || [])
      ])].sort().slice(-90)
    }

    saveCheckinData(merged)

    if (cloud.achievements && typeof cloud.achievements === 'object') {
      const localAch = storageCache.readSync(ACHIEVEMENTS_KEY, {}) || {}
      const mergedAch = { ...cloud.achievements, ...localAch }
      storageCache.persistAsync(ACHIEVEMENTS_KEY, mergedAch)
    }

    // 合并云端 quiz 数据到本地（之前缺失！导致答题记录无法恢复）
    if (cloud.quiz && typeof cloud.quiz === 'object') {
      try {
        const localQuiz = storageCache.readSync('_space_quiz_data', {}) || {}
        const isLocalValid = localQuiz && typeof localQuiz === 'object' && localQuiz.lastQuizDate
        const isCloudValid = cloud.quiz.lastQuizDate

        if (isCloudValid) {
          const mergedQuiz = {
            answeredIds: [...new Set([...(cloud.quiz.answeredIds || []), ...(isLocalValid ? localQuiz.answeredIds || [] : [])])],
            correctCount: Math.max(cloud.quiz.correctCount || 0, isLocalValid ? localQuiz.correctCount || 0 : 0),
            totalAnswered: Math.max(cloud.quiz.totalAnswered || 0, isLocalValid ? localQuiz.totalAnswered || 0 : 0),
            lastQuizDate: (cloud.quiz.lastQuizDate || '') > (isLocalValid ? localQuiz.lastQuizDate || '' : '')
              ? cloud.quiz.lastQuizDate : (localQuiz.lastQuizDate || ''),
            streak: Math.max(cloud.quiz.streak || 0, isLocalValid ? localQuiz.streak || 0 : 0),
            _todayQuestionId: isLocalValid && localQuiz._todayQuestionId ? localQuiz._todayQuestionId : cloud.quiz._todayQuestionId,
            _todayCorrect: isLocalValid && localQuiz._todayQuestionId ? localQuiz._todayCorrect : cloud.quiz._todayCorrect,
            _todaySelectedIndex: isLocalValid && localQuiz._todayQuestionId ? localQuiz._todaySelectedIndex : cloud.quiz._todaySelectedIndex
          }
          storageCache.persistAsync('_space_quiz_data', mergedQuiz)
        }
      } catch (e) {}
    }

    // 恢复行为统计数据
    if (cloud.behaviorStats && typeof cloud.behaviorStats === 'object') {
      try {
        const localStats = storageCache.readSync('_user_behavior_stats', {}) || {}
        const merged = { ...cloud.behaviorStats }
        Object.keys(localStats).forEach(k => {
          if (k === 'readNewsIds') {
            merged.readNewsIds = [...new Set([...(cloud.behaviorStats.readNewsIds || []), ...(localStats.readNewsIds || [])])]
            merged.newsReadCount = merged.readNewsIds.length
          } else if (k === 'earlySubscribes') {
            merged.earlySubscribes = { ...(cloud.behaviorStats.earlySubscribes || {}), ...(localStats.earlySubscribes || {}) }
          } else if (typeof localStats[k] === 'number') {
            merged[k] = Math.max(merged[k] || 0, localStats[k])
          }
        })
        storageCache.persistAsync('_user_behavior_stats', merged)
      } catch (e) {}
    }

    // 恢复时间线数据
    if (cloud.timeline && Array.isArray(cloud.timeline) && cloud.timeline.length > 0) {
      try {
        var localTimeline = storageCache.readSync('_user_timeline', []) || []
        var existingTypes = new Set(localTimeline.map(function (t) { return t.type + '_' + t.timestamp }))
        cloud.timeline.forEach(function (item) {
          var key = item.type + '_' + item.timestamp
          if (!existingTypes.has(key)) {
            localTimeline.push(item)
          }
        })
        storageCache.persistAsync('_user_timeline', localTimeline)
      } catch (e) {}
    }

    // 恢复偏好设置
    if (cloud.preferences && typeof cloud.preferences === 'object' && cloud.preferences.updatedAt) {
      try {
        var localPrefs = require('./user-growth.js').loadPreferences()
        if ((cloud.preferences.updatedAt || 0) > (localPrefs.updatedAt || 0)) {
          require('./user-growth.js').savePreferences(cloud.preferences)
        }
      } catch (e) {}
    }

    return { profile: result.profile, openid: result.openid }
  } catch (e) {
    return null
  }
}

/**
 * 将本地全部数据推送到云端（首次同步 / 手动触发）
 */
const PUSH_ALL_MIN_INTERVAL = 10 * 60 * 1000

function pushAllToCloud(force) {
  if (!wx.cloud || !wx.cloud.callFunction) return
  // 降频：每次进「我的」页都全量推送太浪费，10 分钟内只推一次；
  // 关键事件（新徽章解锁等）传 force 立即推送
  if (!force) {
    const last = Number(storageCache.readSync(SYNC_FLAG_KEY, 0)) || 0
    if (last && Date.now() - last < PUSH_ALL_MIN_INTERVAL) return
  }
  const checkin = loadCheckinData()
  const achievements = storageCache.readSync(ACHIEVEMENTS_KEY, {}) || {}
  const quiz = storageCache.readSync('_space_quiz_data', {}) || {}
  const behaviorStats = storageCache.readSync('_user_behavior_stats', {}) || {}
  const timeline = storageCache.readSync('_user_timeline', []) || []
  let preferences = {}
  try { preferences = require('./user-growth.js').loadPreferences() } catch (e) {}

  wx.cloud.callFunction({
    name: CLOUD_FUNCTION_NAME,
    data: {
      action: 'syncAll',
      localData: { checkin, achievements, quiz, behaviorStats, timeline, preferences }
    }
  }).then(() => {
    storageCache.persistAsync(SYNC_FLAG_KEY, Date.now())
  }).catch(() => {})
}

/**
 * 答题后立即将 quiz 数据同步到云端
 */
function syncQuizToCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) return
  try {
    var quiz = storageCache.readSync('_space_quiz_data', {}) || {}
    if (!quiz.lastQuizDate) return
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: { action: 'syncQuiz', quizData: quiz }
    }).catch(function () {})
  } catch (e) {}
}

/**
 * 是否已完成过一次云同步
 */
function hasCloudSynced() {
  return !!storageCache.readSync(SYNC_FLAG_KEY, 0)
}

module.exports = {
  isCheckedInToday,
  doCheckIn,
  getCheckinSummary,
  getWeekCheckinDots,
  checkAchievements,
  syncCheckinToCloud,
  syncQuizToCloud,
  pullProfileFromCloud,
  pushAllToCloud,
  hasCloudSynced,
  loadKnowledgeCards,
  warmCheckinStoreSync,
  SPACE_FACTS,
  ACHIEVEMENT_DEFS
}
