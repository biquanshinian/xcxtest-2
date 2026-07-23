/**
 * 太空知识问答挑战
 * 每日一道题，答对可获得额外成就积分
 */

const storageCache = require('../../../utils/storage-sync-cache.js')

const QUIZ_STORAGE_KEY = '_space_quiz_data'

let _quizMem = null
let _quizMemLoaded = false

function _defaultQuizData() {
  return {
    answeredIds: [],
    correctCount: 0,
    totalAnswered: 0,
    lastQuizDate: '',
    streak: 0
  }
}

function _normalizeQuizData(raw) {
  if (raw && typeof raw === 'object') {
    if (!Array.isArray(raw.answeredIds)) raw.answeredIds = []
    if (typeof raw.correctCount !== 'number') raw.correctCount = 0
    if (typeof raw.totalAnswered !== 'number') raw.totalAnswered = 0
    if (typeof raw.lastQuizDate !== 'string') raw.lastQuizDate = ''
    if (typeof raw.streak !== 'number') raw.streak = 0
    return raw
  }
  return _defaultQuizData()
}

const QUIZ_QUESTIONS = [
  {
    id: 1,
    question: '以下哪个是太阳系中最大的行星？',
    options: ['土星', '木星', '天王星', '海王星'],
    answer: 1,
    explanation: '木星是太阳系中最大的行星，直径约14.3万公里，是地球直径的11倍。'
  },
  {
    id: 2,
    question: 'SpaceX的星舰使用什么燃料？',
    options: ['液氢+液氧', '煤油+液氧', '液态甲烷+液氧', '固体燃料'],
    answer: 2,
    explanation: '星舰的猛禽发动机使用液态甲烷和液氧（Methalox），部分原因是火星上可以就地生产甲烷。'
  },
  {
    id: 3,
    question: '光从太阳到地球大约需要多长时间？',
    options: ['约1分钟', '约8分钟', '约30分钟', '约1小时'],
    answer: 1,
    explanation: '太阳距地球约1.5亿公里，光速约30万公里/秒，因此光从太阳到地球约需8分20秒。'
  },
  {
    id: 4,
    question: '目前（2026年）中国空间站叫什么？',
    options: ['和平号', '天宫', '天舟', '神舟'],
    answer: 1,
    explanation: '中国空间站命名为"天宫"，由天和核心舱、问天实验舱和梦天实验舱组成。'
  },
  {
    id: 5,
    question: '以下哪颗行星的一天比它的一年还长？',
    options: ['火星', '水星', '金星', '木星'],
    answer: 2,
    explanation: '金星自转一圈需要243个地球日，但绕太阳公转一圈只需225个地球日。'
  },
  {
    id: 6,
    question: '人类首次登上月球是在哪一年？',
    options: ['1965年', '1967年', '1969年', '1971年'],
    answer: 2,
    explanation: '1969年7月20日，阿波罗11号的宇航员阿姆斯特朗和奥尔德林首次踏上月球表面。'
  },
  {
    id: 7,
    question: '猎鹰9号火箭的一级助推器可以重复使用多少次以上？',
    options: ['3次', '5次', '10次', '20次以上'],
    answer: 3,
    explanation: 'SpaceX猎鹰9号助推器已多次实现20次以上的复用飞行，大幅降低了发射成本。'
  },
  {
    id: 8,
    question: '火星表面的日落是什么颜色？',
    options: ['红色', '橙色', '蓝色', '紫色'],
    answer: 2,
    explanation: '由于火星大气中细小的尘埃粒子散射蓝光的方式，火星上的日落呈现冷蓝色调。'
  },
  {
    id: 9,
    question: '国际空间站（ISS）绕地球一圈大约需要多长时间？',
    options: ['45分钟', '90分钟', '3小时', '24小时'],
    answer: 1,
    explanation: 'ISS以每小时27,600公里的速度运行，约90分钟绕地球一圈，宇航员每天能看到16次日出。'
  },
  {
    id: 10,
    question: '以下哪个不是SpaceX的产品？',
    options: ['猎鹰9号', '星链', '新谢泼德', '龙飞船'],
    answer: 2,
    explanation: '新谢泼德（New Shepard）是蓝色起源（Blue Origin）公司的亚轨道火箭，不是SpaceX的产品。'
  },
  {
    id: 11,
    question: '太阳系中哪颗行星的卫星最多？',
    options: ['木星', '土星', '天王星', '海王星'],
    answer: 1,
    explanation: '土星目前拥有超过140颗已知卫星，超过了木星的95颗，成为太阳系中卫星最多的行星。'
  },
  {
    id: 12,
    question: '宇宙的年龄大约是多少？',
    options: ['约46亿年', '约100亿年', '约138亿年', '约200亿年'],
    answer: 2,
    explanation: '根据宇宙微波背景辐射的测量，宇宙的年龄约为138亿年（137.87±0.20亿年）。'
  },
  {
    id: 13,
    question: '在太空中，宇航员的身高会发生什么变化？',
    options: ['变矮', '不变', '增高约5厘米', '增高约15厘米'],
    answer: 2,
    explanation: '在微重力环境下，脊椎不再受地球引力压缩，宇航员的身高会增加约5厘米。'
  },
  {
    id: 14,
    question: '火星上最高的山是什么？',
    options: ['乞力马扎罗山', '奥林匹斯山', '麦金利山', '天山'],
    answer: 1,
    explanation: '奥林匹斯山（Olympus Mons）高约21.9公里，是太阳系中已知最高的山，接近珠穆朗玛峰的3倍。'
  },
  {
    id: 15,
    question: '以下哪个天体可能存在液态水海洋？',
    options: ['月球', '水星', '木卫二', '火卫一'],
    answer: 2,
    explanation: '木卫二（欧罗巴）冰层下可能存在巨大的液态水海洋，水量可能是地球海洋的两倍。'
  },
  {
    id: 16,
    question: '哈勃望远镜位于距地球多高的轨道？',
    options: ['约200公里', '约540公里', '约2000公里', '约36000公里'],
    answer: 1,
    explanation: '哈勃太空望远镜运行在距地球约540公里的低地球轨道上。'
  },
  {
    id: 17,
    question: '嫦娥五号从月球带回了多少月壤样本？',
    options: ['约0.5公斤', '约1.7公斤', '约5公斤', '约10公斤'],
    answer: 1,
    explanation: '嫦娥五号于2020年成功带回约1,731克月球样本，是人类时隔44年再次采集月壤。'
  },
  {
    id: 18,
    question: '距太阳系最近的恒星系统是？',
    options: ['天狼星', '比邻星', '织女星', '北极星'],
    answer: 1,
    explanation: '比邻星（Proxima Centauri）距太阳系约4.24光年，是距我们最近的恒星。'
  },
  {
    id: 19,
    question: '星链卫星的轨道高度大约是多少？',
    options: ['约200公里', '约550公里', '约2000公里', '约35000公里'],
    answer: 1,
    explanation: 'SpaceX星链卫星主要运行在约550公里的近地轨道，这个高度有利于降低通信延迟。'
  },
  {
    id: 20,
    question: '以下哪种力量让行星绕太阳公转？',
    options: ['电磁力', '万有引力', '核力', '暗能量'],
    answer: 1,
    explanation: '万有引力使行星保持在围绕太阳的椭圆轨道上运行，这是牛顿在17世纪发现的。'
  }
]

function loadQuizData() {
  if (_quizMemLoaded) return _quizMem
  var raw = storageCache.readSync(QUIZ_STORAGE_KEY, null)
  _quizMem = _normalizeQuizData(raw)
  _quizMemLoaded = true
  return _quizMem
}

function warmQuizStoreSync() {
  return loadQuizData()
}

function saveQuizData(data) {
  var plain = JSON.parse(JSON.stringify(data))
  _quizMem = plain
  _quizMemLoaded = true
  storageCache.persistAsync(QUIZ_STORAGE_KEY, plain)
}

function verifyQuizSave() {
  if (_quizMemLoaded && _quizMem && typeof _quizMem === 'object') return true
  var raw = storageCache.readSync(QUIZ_STORAGE_KEY, null)
  return !!(raw && typeof raw === 'object')
}

function getLocalDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function getTodayStr() {
  return getLocalDateStr(new Date())
}

function getDailyQuestion() {
  const data = loadQuizData()
  const today = getTodayStr()
  const answeredToday = data.lastQuizDate === today

  // 今天已答题且存有题目ID → 直接还原
  if (answeredToday && data._todayQuestionId) {
    const q = QUIZ_QUESTIONS.find(q => q.id === data._todayQuestionId)
    if (q) return {
      question: q,
      alreadyAnswered: true,
      wasCorrect: !!data._todayCorrect,
      selectedIndex: data._todaySelectedIndex !== undefined ? data._todaySelectedIndex : -1
    }
  }

  // 选今天的题目
  const unanswered = QUIZ_QUESTIONS.filter(q => !data.answeredIds.includes(q.id))
  const pool = unanswered.length > 0 ? unanswered : QUIZ_QUESTIONS
  const dayHash = today.split('-').reduce((acc, n) => acc + Number(n), 0)
  const question = pool[dayHash % pool.length]

  // 今天已答但 _todayQuestionId 丢失（旧数据兼容）→ 尝试用当前题目匹配
  if (answeredToday) {
    return {
      question,
      alreadyAnswered: true,
      wasCorrect: !!data._todayCorrect,
      selectedIndex: data._todaySelectedIndex !== undefined ? data._todaySelectedIndex : -1
    }
  }

  return {
    question,
    alreadyAnswered: false,
    wasCorrect: false,
    selectedIndex: -1
  }
}

function answerQuestion(questionId, selectedIndex) {
  const question = QUIZ_QUESTIONS.find(q => q.id === questionId)
  if (!question) return { correct: false, explanation: '' }

  const correct = selectedIndex === question.answer
  const data = loadQuizData()
  const today = getTodayStr()

  if (!data.answeredIds.includes(questionId)) {
    data.answeredIds.push(questionId)
  }
  data.totalAnswered += 1
  if (correct) data.correctCount += 1

  // 用本地日期算「昨天」，避免 UTC+8 凌晨 0-8 点误判断档
  const yesterday = getLocalDateStr(new Date(Date.now() - 86400000))
  data.streak = data.lastQuizDate === yesterday ? data.streak + 1 : 1
  data.lastQuizDate = today
  data._todayQuestionId = questionId
  data._todayCorrect = correct
  data._todaySelectedIndex = selectedIndex

  saveQuizData(data)

  var _rm = require('../../../utils/user-growth.js').recordMilestone
  _rm('FIRST_QUIZ')
  if (data.streak >= 5) _rm('QUIZ_STREAK_5')

  return {
    correct,
    explanation: question.explanation,
    stats: {
      correctCount: data.correctCount,
      totalAnswered: data.totalAnswered,
      accuracy: data.totalAnswered > 0 ? Math.round(data.correctCount / data.totalAnswered * 100) : 0,
      streak: data.streak
    }
  }
}

function getQuizStats() {
  const data = loadQuizData()
  return {
    correctCount: data.correctCount || 0,
    totalAnswered: data.totalAnswered || 0,
    accuracy: data.totalAnswered > 0 ? Math.round((data.correctCount || 0) / data.totalAnswered * 100) : 0,
    streak: data.streak || 0,
    isAnsweredToday: data.lastQuizDate === getTodayStr()
  }
}

module.exports = {
  getDailyQuestion,
  answerQuestion,
  getQuizStats,
  verifyQuizSave,
  warmQuizStoreSync,
  QUIZ_QUESTIONS
}
