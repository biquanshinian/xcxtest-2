/**
 * 每日太空简报生成云函数
 * 定时触发：每天 07:00 CST
 *
 * 逻辑：
 * 1. 查询今日发射任务
 * 2. 查询昨日已完成发射
 * 3. 随机抽取一条太空冷知识
 * 4. 匹配今日天文事件
 * 5. 写入 daily_briefing 集合
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const BRIEFING_COLLECTION = 'daily_briefing'
const LAUNCH_COLLECTION = 'launch_data'
const KNOWLEDGE_COLLECTION = 'knowledge_cards'

const ASTRO_EVENTS_2026 = [
  { date: '2026-01-03', title: '象限仪座流星雨极大', icon: 'meteor', desc: 'ZHR~120，月光干扰较小', category: 'meteor' },
  { date: '2026-01-21', title: '满月', icon: 'moon', desc: '狼月 Wolf Moon', category: 'solstice' },
  { date: '2026-02-01', title: '金星东大距', icon: 'planet', desc: '日落后西方低空可见', category: 'planet' },
  { date: '2026-02-17', title: '水星西大距', icon: 'planet', desc: '日出前东方低空可见', category: 'planet' },
  { date: '2026-03-29', title: '日偏食', icon: 'eclipse', desc: '亚洲部分地区可见', category: 'eclipse' },
  { date: '2026-04-22', title: '天琴座流星雨极大', icon: 'meteor', desc: 'ZHR~18', category: 'meteor' },
  { date: '2026-05-06', title: '宝瓶座η流星雨极大', icon: 'meteor', desc: 'ZHR~50，哈雷彗星碎片', category: 'meteor' },
  { date: '2026-05-31', title: '火星冲日', icon: 'planet', desc: '火星距地球最近，整夜可见', category: 'planet' },
  { date: '2026-06-21', title: '夏至', icon: 'solstice', desc: '北半球白昼最长', category: 'solstice' },
  { date: '2026-07-28', title: '宝瓶座δ南流星雨极大', icon: 'meteor', desc: 'ZHR~25', category: 'meteor' },
  { date: '2026-08-12', title: '英仙座流星雨极大', icon: 'meteor', desc: 'ZHR~100，年度最佳流星雨之一', category: 'meteor' },
  { date: '2026-08-12', title: '日全食', icon: 'eclipse', desc: '西伯利亚、格陵兰和大西洋可见全食', category: 'eclipse' },
  { date: '2026-09-22', title: '秋分', icon: 'solstice', desc: '昼夜等长', category: 'solstice' },
  { date: '2026-10-21', title: '猎户座流星雨极大', icon: 'meteor', desc: 'ZHR~20', category: 'meteor' },
  { date: '2026-11-04', title: '金牛座南流星雨极大', icon: 'meteor', desc: 'ZHR~5，偶有明亮火流星', category: 'meteor' },
  { date: '2026-11-17', title: '狮子座流星雨极大', icon: 'meteor', desc: 'ZHR~15', category: 'meteor' },
  { date: '2026-12-14', title: '双子座流星雨极大', icon: 'meteor', desc: 'ZHR~150，年度最佳', category: 'meteor' },
  { date: '2026-12-21', title: '冬至', icon: 'solstice', desc: '北半球白昼最短', category: 'solstice' }
]

function todayStr() {
  const d = new Date()
  const offset = 8 * 60 * 60 * 1000
  const cn = new Date(d.getTime() + offset)
  return cn.toISOString().slice(0, 10)
}

function yesterdayStr() {
  const d = new Date()
  const offset = 8 * 60 * 60 * 1000
  const cn = new Date(d.getTime() + offset - 86400000)
  return cn.toISOString().slice(0, 10)
}

async function ensureBriefingCollections() {
  const names = [BRIEFING_COLLECTION, 'space_devs_cache', KNOWLEDGE_COLLECTION]
  for (const n of names) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
}

// 读单个缓存文档：优先按 _id 直取（syncSpaceDevsData 现以 _id === cacheKey 写入，永远是最新），
// 兜底 where 查询（兼容历史上 add() 写入的随机 _id 旧文档）
async function readCacheDoc(col, cacheKey) {
  try {
    const res = await col.doc(cacheKey).get()
    if (res && res.data) return res.data
  } catch (e) { /* 文档不存在，走兜底 */ }
  try {
    const res = await col.where({ cacheKey }).limit(1).get()
    if (res.data && res.data.length > 0) return res.data[0]
  } catch (e) {}
  return null
}

async function readSpaceDevsCache(cacheKey) {
  try {
    const col = db.collection('space_devs_cache')
    const doc = await readCacheDoc(col, cacheKey)
    if (!doc) return []

    // 主文档已有 results 直接返回
    if (doc.data && Array.isArray(doc.data.results) && doc.data.results.length > 0) {
      return doc.data.results
    }

    // 分批存储情况
    if (doc.isBatched && doc.totalBatches > 0) {
      const batchPromises = []
      const maxBatches = Math.min(doc.totalBatches, 5)
      for (let i = 0; i < maxBatches; i++) {
        const batchKey = cacheKey + '_batch_' + i
        batchPromises.push(readCacheDoc(col, batchKey).catch(() => null))
      }
      const batchResults = await Promise.all(batchPromises)
      const allResults = []
      batchResults.forEach((batchDoc) => {
        const batchData = batchDoc && batchDoc.data
        if (batchData && Array.isArray(batchData.results)) {
          allResults.push(...batchData.results)
        }
      })
      return allResults
    }

    return []
  } catch (e) {
    return []
  }
}

function matchByBeijingDate(list, dateStr) {
  return list.filter(function (l) {
    const t = l.net || l.window_start || ''
    if (!t) return false
    const d = new Date(t)
    if (isNaN(d.getTime())) return false
    try {
      const fmt = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
      return fmt === dateStr
    } catch (e) {
      const beijing = new Date(d.getTime() + 8 * 3600 * 1000)
      const y = beijing.getUTCFullYear()
      const m = String(beijing.getUTCMonth() + 1).padStart(2, '0')
      const day = String(beijing.getUTCDate()).padStart(2, '0')
      return (y + '-' + m + '-' + day) === dateStr
    }
  })
}

async function getTodayLaunches(today) {
  const results = await readSpaceDevsCache('launches_upcoming_')
  const matched = matchByBeijingDate(results, today)
  return matched.slice(0, 10).map((l) => ({
    id: l.id || l.slug || '',
    name: l.name || (l.mission && l.mission.name) || '',
    rocket: (l.rocket && l.rocket.configuration && (l.rocket.configuration.full_name || l.rocket.configuration.name)) || '',
    time: l.net || '',
    pad: (l.pad && l.pad.name) || '',
    status: 'upcoming'
  }))
}

async function getYesterdayResults(yesterday) {
  const results = await readSpaceDevsCache('launches_previous_')
  const matched = matchByBeijingDate(results, yesterday)
  return matched.slice(0, 10).map((l) => {
    const abbrev = (l.status && l.status.abbrev) || ''
    let normalizedStatus = ''
    if (abbrev === 'Success') normalizedStatus = 'success'
    else if (abbrev === 'Failure') normalizedStatus = 'failure'
    else if (abbrev === 'Partial Failure') normalizedStatus = 'partial_failure'
    else normalizedStatus = abbrev.toLowerCase()
    return {
      id: l.id || l.slug || '',
      name: l.name || (l.mission && l.mission.name) || '',
      rocket: (l.rocket && l.rocket.configuration && (l.rocket.configuration.full_name || l.rocket.configuration.name)) || '',
      status: normalizedStatus
    }
  })
}

async function getRandomFact() {
  try {
    const countRes = await db.collection(KNOWLEDGE_COLLECTION).count()
    const total = countRes.total || 0
    if (total === 0) return getFallbackFact()
    const skip = Math.floor(Math.random() * total)
    const res = await db.collection(KNOWLEDGE_COLLECTION).skip(skip).limit(1).get()
    if (res.data && res.data.length > 0) {
      const c = res.data[0]
      return { id: c.cardId || c._id, category: c.category, fact: c.fact, source: c.source }
    }
    return getFallbackFact()
  } catch (e) {
    return getFallbackFact()
  }
}

function getFallbackFact() {
  const facts = [
    { id: 'f1', category: '太阳系', fact: '土星的密度比水还低，如果有一个足够大的浴缸，土星能浮在水面上。', source: 'NASA' },
    { id: 'f2', category: '宇宙', fact: '可观测宇宙的直径约930亿光年，包含至少2万亿个星系。', source: 'Hubble' },
    { id: 'f3', category: 'SpaceX', fact: '星舰的超重型助推器配备33台猛禽发动机，总推力约7,590吨力。', source: 'SpaceX' }
  ]
  return facts[Math.floor(Math.random() * facts.length)]
}

function getTodayAstroEvent(today) {
  const matches = ASTRO_EVENTS_2026.filter(function (e) { return e.date === today })
  if (matches.length > 0) return matches[0]
  // 2027 起硬编码表不再命中：流星雨极大/二分二至每年日期基本固定（±1天），
  // 按月-日回退匹配，仅限每年重复的类别；日食等一次性事件不复用
  const monthDay = String(today || '').slice(5)
  if (!monthDay) return null
  const RECURRING_CATEGORIES = { meteor: true, solstice: true }
  const recurring = ASTRO_EVENTS_2026.filter(function (e) {
    return RECURRING_CATEGORIES[e.category] && e.date.slice(5) === monthDay
  })
  return recurring.length > 0 ? recurring[0] : null
}

exports.main = async (event) => {
  await ensureBriefingCollections()
  const startTime = Date.now()

  // 检查后台管理开关
  try {
    const configRes = await db.collection('global_config').doc('briefing_config').get()
    if (configRes.data && configRes.data.briefingEnabled === false) {
      return { success: false, message: 'briefing disabled by admin' }
    }
  } catch (e) {
    // 文档不存在时默认开启
  }

  const today = todayStr()
  const yesterday = yesterdayStr()

  // 检查是否已生成（force=true 时跳过）
  if (!event.force) {
    try {
      const existing = await db.collection(BRIEFING_COLLECTION).doc(today).get()
      if (existing.data) {
        const hasContent = (existing.data.todayLaunches && existing.data.todayLaunches.length > 0) ||
                          (existing.data.yesterdayResults && existing.data.yesterdayResults.length > 0)
        if (hasContent) {
          return { success: true, message: 'already generated', date: today }
        }
        // 旧文档无实质内容，删除后重新生成
        try { await db.collection(BRIEFING_COLLECTION).doc(today).remove() } catch (e) {}
      }
    } catch (e) {}
  } else {
    try { await db.collection(BRIEFING_COLLECTION).doc(today).remove() } catch (e) {}
  }

  const [todayLaunches, yesterdayResults, spaceFact] = await Promise.all([
    getTodayLaunches(today),
    getYesterdayResults(yesterday),
    getRandomFact()
  ])

  const astroEvent = getTodayAstroEvent(today)

  const briefing = {
    _id: today,
    todayLaunches: todayLaunches,
    yesterdayResults: yesterdayResults,
    spaceFact: spaceFact,
    astroEvent: astroEvent,
    generatedAt: Date.now()
  }

  try {
    // 删除 briefing 里的 _id 字段，避免 doc.set 冲突
    const briefingClone = Object.assign({}, briefing)
    delete briefingClone._id
    await db.collection(BRIEFING_COLLECTION).doc(today).set({ data: briefingClone })
  } catch (e) {
    console.error('[MorningBriefing] write error:', e)
  }

  console.log('[MorningBriefing] done date:', today, 'today:', todayLaunches.length, 'yesterday:', yesterdayResults.length, (Date.now() - startTime) + 'ms')
  return { success: true, date: today, briefing }
}
