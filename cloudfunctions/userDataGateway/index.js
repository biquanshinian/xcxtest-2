/**
 * 用户数据网关 —— 签到 / 成就 / 问答 的云端持久化
 *
 * OpenID 由云函数运行时自动注入，无需用户授权。
 * 集合：user_profile（一个用户一条文档，_id = openid）
 *
 * action:
 *   - getProfile        读取用户档案
 *   - checkin           每日签到
 *   - syncQuiz          同步问答结果
 *   - syncAll           客户端本地数据整体上传（首次云同步 / 恢复场景）
 *   - savePreferences   保存用户偏好（提醒/简报）
 *   - getPreferences    读取用户偏好
 *   - recordMilestone   记录时间线里程碑
 *   - getTodayBriefing  获取今日简报
 *   - getNewsManualForApp         公共只读：航天事件手写稿列表（服务端读 news_articles）
 *   - getNewsManualArticleById    公共只读：手写稿详情，参数 docId / id
 *   - getMediaAssetsMap             公共只读：media_assets 整表映射（单次下发，最多 500 条）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'user_profile'
const BRIEFING_COLLECTION = 'daily_briefing'
const ANNUAL_REPORT_CONFIG_COL = 'annual_report_config'
const ANNUAL_REPORT_SNAPSHOTS_COL = 'annual_report_snapshots'
const MEMBERSHIP_COL = 'user_membership'

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

/** 单条动态的 publishedAt → 北京时间日历日 yyyy-MM-dd（与 todayStr 算法一致） */
function publishedAtToBeijingYmd(p) {
  if (p == null || p === '') return ''
  const offset = 8 * 60 * 60 * 1000
  let ms = NaN
  if (typeof p === 'number' && !isNaN(p)) {
    ms = p
  } else if (typeof p === 'string') {
    const s = p.trim()
    if (!s) return ''
    const d = new Date(s)
    if (!isNaN(d.getTime())) ms = d.getTime()
    else if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    else return ''
  } else if (p instanceof Date) {
    ms = p.getTime()
  } else if (typeof p.getTime === 'function') {
    ms = p.getTime()
  } else if (typeof p.seconds === 'number') {
    ms = p.seconds * 1000 + Math.floor((p.nanoseconds || 0) / 1e6)
  }
  if (isNaN(ms)) return ''
  const cn = new Date(ms + offset)
  return cn.toISOString().slice(0, 10)
}

/** 用户网关涉及集合：首轮请求一次性 createCollection */
const USER_DATA_GATEWAY_COLLECTIONS = [
  COLLECTION,
  BRIEFING_COLLECTION,
  MEMBERSHIP_COL,
  ANNUAL_REPORT_CONFIG_COL,
  ANNUAL_REPORT_SNAPSHOTS_COL,
  'space_devs_cache',
  'tweet_accounts',
  'starship_event_updates',
  'news_articles',
  'global_config',
  'media_assets'
]

let _userDataGatewayCollectionsEnsured = false
function ensureUserDataGatewayCollectionsOnce() {
  if (_userDataGatewayCollectionsEnsured) return
  _userDataGatewayCollectionsEnsured = true
  // 后台并行执行，不阻塞用户请求（集合已存在时 createCollection 报错可忽略）
  Promise.all(
    USER_DATA_GATEWAY_COLLECTIONS.map((name) => db.createCollection(name).catch(() => {}))
  ).catch(() => {})
}

async function getOrCreateProfile(openid) {
  try {
    const res = await db.collection(COLLECTION).doc(openid).get()
    return res.data
  } catch (e) {
    const initial = {
      _id: openid,
      openid,
      createdAt: Date.now(),
      checkin: {
        totalDays: 0,
        currentStreak: 0,
        maxStreak: 0,
        lastCheckinDate: '',
        collectedFactIds: [],
        checkinHistory: []
      },
      achievements: {},
      quiz: {
        answeredIds: [],
        correctCount: 0,
        totalAnswered: 0,
        lastQuizDate: '',
        streak: 0
      }
    }
    await db.collection(COLLECTION).add({ data: initial })
    return initial
  }
}

// ── 签到 ──
async function handleCheckin(openid, factId) {
  const profile = await getOrCreateProfile(openid)
  const today = todayStr()
  const checkin = profile.checkin || {}

  if (checkin.lastCheckinDate === today) {
    return { success: false, reason: 'already_checked_in', profile }
  }

  const yesterday = yesterdayStr()
  const isConsecutive = checkin.lastCheckinDate === yesterday
  const newStreak = isConsecutive ? (checkin.currentStreak || 0) + 1 : 1
  const newMaxStreak = Math.max(newStreak, checkin.maxStreak || 0)
  const newTotal = (checkin.totalDays || 0) + 1

  const collectedFactIds = checkin.collectedFactIds || []
  if (factId && !collectedFactIds.includes(factId)) {
    collectedFactIds.push(factId)
  }

  let history = checkin.checkinHistory || []
  history.push(today)
  if (history.length > 90) history = history.slice(-90)

  const updateData = {
    'checkin.totalDays': newTotal,
    'checkin.currentStreak': newStreak,
    'checkin.maxStreak': newMaxStreak,
    'checkin.lastCheckinDate': today,
    'checkin.collectedFactIds': collectedFactIds,
    'checkin.checkinHistory': history
  }

  // 条件更新防并发重复签到：仅当 lastCheckinDate 仍不是今天时才写入（读-改-写竞态防护）
  const updateRes = await db.collection(COLLECTION)
    .where({ _id: openid, 'checkin.lastCheckinDate': _.neq(today) })
    .update({ data: updateData })
  if (!updateRes.stats || updateRes.stats.updated === 0) {
    return { success: false, reason: 'already_checked_in', profile }
  }

  return {
    success: true,
    checkin: {
      totalDays: newTotal,
      currentStreak: newStreak,
      maxStreak: newMaxStreak,
      lastCheckinDate: today,
      collectedFactIds,
      checkinHistory: history
    }
  }
}

// ── 同步问答 ──
async function handleSyncQuiz(openid, quizData) {
  await getOrCreateProfile(openid)
  await db.collection(COLLECTION).doc(openid).update({
    data: { quiz: quizData }
  })
  return { success: true }
}

// ── 全量同步（本地 → 云端） ──
async function handleSyncAll(openid, localData) {
  const profile = await getOrCreateProfile(openid)

  // 数值防刷：非首次同步时，签到/答题类「每天最多 +1」的计数，
  // 本地上报的增量不得超过距上次同步经过的天数（+1 容差），防止客户端伪造虚高数据
  let maxDailyDelta = Infinity
  if (profile.lastSyncAt) {
    const elapsedDays = Math.ceil(Math.max(0, Date.now() - profile.lastSyncAt) / 86400000)
    maxDailyDelta = elapsedDays + 1
  }

  const mergedCheckin = mergeCheckin(profile.checkin, localData.checkin, maxDailyDelta)
  const mergedQuiz = mergeQuiz(profile.quiz, localData.quiz, maxDailyDelta)
  const mergedAchievements = mergeAchievements(profile.achievements, localData.achievements)
  const mergedBehaviorStats = mergeBehaviorStats(profile.behaviorStats, localData.behaviorStats)

  const updateData = {
    checkin: mergedCheckin,
    quiz: mergedQuiz,
    achievements: mergedAchievements,
    behaviorStats: mergedBehaviorStats,
    lastSyncAt: Date.now()
  }

  // 合并时间线（去重追加）
  if (localData.timeline && Array.isArray(localData.timeline)) {
    const cloudTimeline = profile.timeline || []
    const existingKeys = new Set(cloudTimeline.map(t => t.type + '_' + t.timestamp))
    const newEntries = localData.timeline.filter(t => !existingKeys.has(t.type + '_' + t.timestamp))
    if (newEntries.length > 0) {
      updateData.timeline = _.push(...newEntries)
    }
  }

  // 合并偏好（取较新的）
  if (localData.preferences && localData.preferences.updatedAt) {
    const cloudPrefs = profile.preferences || {}
    if ((localData.preferences.updatedAt || 0) >= (cloudPrefs.updatedAt || 0)) {
      updateData.preferences = localData.preferences
    }
  }

  await db.collection(COLLECTION).doc(openid).update({ data: updateData })

  return { success: true, checkin: mergedCheckin, quiz: mergedQuiz, achievements: mergedAchievements, behaviorStats: mergedBehaviorStats }
}

/** 每日 +1 型计数的可信上限：本地值最多比云端多 maxDelta（距上次同步的天数） */
function clampGrowth(cloudVal, localVal, maxDelta) {
  const c = Number(cloudVal) || 0
  const l = Number(localVal) || 0
  if (l <= c) return c
  if (!isFinite(maxDelta)) return l
  return Math.min(l, c + Math.max(0, maxDelta))
}

function mergeCheckin(cloud, local, maxDailyDelta) {
  if (!cloud || !local) return local || cloud || {}
  const totalDays = clampGrowth(cloud.totalDays, local.totalDays, maxDailyDelta)
  const currentStreak = Math.min(clampGrowth(cloud.currentStreak, local.currentStreak, maxDailyDelta), totalDays || 0)
  return {
    totalDays,
    currentStreak,
    maxStreak: Math.max(clampGrowth(cloud.maxStreak, local.maxStreak, maxDailyDelta), currentStreak),
    lastCheckinDate: (cloud.lastCheckinDate || '') > (local.lastCheckinDate || '') ? cloud.lastCheckinDate : local.lastCheckinDate,
    collectedFactIds: [...new Set([...(cloud.collectedFactIds || []), ...(local.collectedFactIds || [])])],
    checkinHistory: [...new Set([...(cloud.checkinHistory || []), ...(local.checkinHistory || [])])].sort().slice(-90)
  }
}

function mergeQuiz(cloud, local, maxDailyDelta) {
  if (!cloud || !local) return local || cloud || {}
  const totalAnswered = clampGrowth(cloud.totalAnswered, local.totalAnswered, maxDailyDelta)
  return {
    answeredIds: [...new Set([...(cloud.answeredIds || []), ...(local.answeredIds || [])])],
    correctCount: Math.min(clampGrowth(cloud.correctCount, local.correctCount, maxDailyDelta), totalAnswered || 0),
    totalAnswered,
    lastQuizDate: (cloud.lastQuizDate || '') > (local.lastQuizDate || '') ? cloud.lastQuizDate : local.lastQuizDate,
    streak: Math.min(clampGrowth(cloud.streak, local.streak, maxDailyDelta), totalAnswered || 0)
  }
}

function mergeAchievements(cloud, local) {
  const merged = { ...(cloud || {}), ...(local || {}) }
  Object.keys(merged).forEach(k => {
    const c = cloud && cloud[k]
    const l = local && local[k]
    if (c && l) {
      merged[k] = { unlockedAt: Math.min(c.unlockedAt || Infinity, l.unlockedAt || Infinity) }
    }
  })
  return merged
}

function mergeBehaviorStats(cloud, local) {
  if (!cloud || !local) return local || cloud || {}
  const merged = { ...cloud }
  Object.keys(local).forEach(k => {
    if (k === 'readNewsIds') {
      merged.readNewsIds = [...new Set([...(cloud.readNewsIds || []), ...(local.readNewsIds || [])])]
      merged.newsReadCount = merged.readNewsIds.length
    } else if (k === 'earlySubscribes') {
      merged.earlySubscribes = { ...(cloud.earlySubscribes || {}), ...(local.earlySubscribes || {}) }
    } else if (k === 'lastOpenDate') {
      merged.lastOpenDate = (cloud.lastOpenDate || '') > (local.lastOpenDate || '') ? cloud.lastOpenDate : local.lastOpenDate
    } else if (typeof local[k] === 'number') {
      merged[k] = Math.max(merged[k] || 0, local[k])
    }
  })
  return merged
}

// ── 保存偏好 ──
async function handleSavePreferences(openid, preferences) {
  await getOrCreateProfile(openid)
  await db.collection(COLLECTION).doc(openid).update({
    data: { preferences: { ...preferences, updatedAt: Date.now() } }
  })
  return { success: true }
}

// ── 读取偏好 ──
async function handleGetPreferences(openid) {
  const profile = await getOrCreateProfile(openid)
  return { success: true, preferences: profile.preferences || null }
}

// ── 记录时间线里程碑 ──
async function handleRecordMilestone(openid, milestone) {
  await getOrCreateProfile(openid)
  await db.collection(COLLECTION).doc(openid).update({
    data: { timeline: _.push(milestone) }
  })
  return { success: true }
}

// ── 获取今日简报 ──
async function handleGetTodayBriefing(date) {
  const today = date || new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const yest = (function () {
    const d = new Date(today + 'T12:00:00+08:00')
    d.setDate(d.getDate() - 1)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  })()

  // 从 space_devs_cache 读取（按 _id 子串匹配，因为最新缓存的 _id 含 /launches/upcoming/ 路径）
  async function readLaunches(idSubstring) {
    try {
      // 拉最近的 100 条 cache 文档（按 updatedAt 倒序），内存中过滤
      const res = await db.collection('space_devs_cache')
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get()

      if (!res.data || res.data.length === 0) {
        console.log('[Briefing] space_devs_cache 集合为空')
        return []
      }

      // 优先匹配 _id 含路径子串（新格式 api_cache_/launches/upcoming/...）
      // 同时也匹配 cacheKey 字段（兼容旧格式 launches_upcoming_）
      const idMatched = res.data.filter(function (doc) {
        return doc._id && doc._id.indexOf(idSubstring) !== -1
      })

      console.log('[Briefing] 集合总数:', res.data.length, '_id 匹配', idSubstring, ':', idMatched.length)
      if (idMatched.length === 0) {
        console.log('[Briefing] _id 样例:', res.data.slice(0, 3).map(function (d) { return d._id }).join(' | '))
      }

      const idMap = {}
      const allResults = []

      for (const doc of idMatched) {
        const list = (doc.data && Array.isArray(doc.data.results)) ? doc.data.results : []
        list.forEach((l) => {
          const id = l.id || l.slug || ''
          if (id && !idMap[id]) {
            idMap[id] = true
            allResults.push(l)
          }
        })
      }

      console.log('[Briefing]', idSubstring, '合并后总条数:', allResults.length)
      return allResults
    } catch (e) {
      console.error('[Briefing] readLaunches error:', idSubstring, e.message)
      return []
    }
  }

  function utcToBeijingDate(t) {
    if (!t) return ''
    if (typeof t !== 'string') return ''
    // t 是 ISO UTC 字符串如 2026-05-13T16:00:00Z，加 8 小时得到北京时间
    const d = new Date(t)
    if (isNaN(d.getTime())) return ''
    const beijing = new Date(d.getTime() + 8 * 3600 * 1000)
    const y = beijing.getUTCFullYear()
    const m = String(beijing.getUTCMonth() + 1).padStart(2, '0')
    const day = String(beijing.getUTCDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  }

  function matchByDate(list, dateStr) {
    return list.filter(function (l) {
      const t = l.net || l.window_start || ''
      return utcToBeijingDate(t) === dateStr
    })
  }

  function mapLaunch(l, statusOverride) {
    const abbrev = (l.status && l.status.abbrev) || ''
    let normalizedStatus = statusOverride || ''
    if (!normalizedStatus) {
      if (abbrev === 'Success') normalizedStatus = 'success'
      else if (abbrev === 'Failure') normalizedStatus = 'failure'
      else if (abbrev === 'Partial Failure') normalizedStatus = 'partial_failure'
      else normalizedStatus = abbrev.toLowerCase() || 'upcoming'
    }
    return {
      id: l.id || l.slug || '',
      name: l.name || (l.mission && l.mission.name) || '',
      rocket: (l.rocket && l.rocket.configuration && (l.rocket.configuration.full_name || l.rocket.configuration.name)) || '',
      time: l.net || '',
      pad: (l.pad && l.pad.name) || '',
      status: normalizedStatus
    }
  }

  const [upcoming, previous] = await Promise.all([
    readLaunches('/launches/upcoming/'),
    readLaunches('/launches/previous/')
  ])

  // 按北京时间日期匹配，按 net 时间正序（早的在前）
  function sortByNet(arr) {
    return arr.slice().sort(function (a, b) {
      const ta = new Date(a.net || a.window_start || 0).getTime()
      const tb = new Date(b.net || b.window_start || 0).getTime()
      return ta - tb
    })
  }

  const todayLaunches = sortByNet(matchByDate(upcoming, today)).map(function (l) { return mapLaunch(l, 'upcoming') })
  const yesterdayResults = sortByNet(matchByDate(previous, yest)).map(function (l) { return mapLaunch(l) })

  // 今日已发射的（在 previous 里）合并进 todayLaunches，按真实状态显示
  sortByNet(matchByDate(previous, today)).forEach(function (l) {
    const mapped = mapLaunch(l)
    if (!todayLaunches.find(function (x) { return x.id === mapped.id })) {
      todayLaunches.push(mapped)
    }
  })

  const briefing = {
    _id: today,
    date: today,
    todayLaunches,
    yesterdayResults,
    spaceFact: null,
    astroEvent: null
  }
  return { success: true, briefing }
}

// ── 从 space_devs_cache 合并「已完成发射」results（兼容整包 / 分批 meta + _batch_N）──
function collectPreviousLaunchesFromCacheDocs(docs) {
  if (!docs || !docs.length) return []

  function isPreviousRelated(doc) {
    if (!doc) return false
    if (doc._id && String(doc._id).indexOf('/launches/previous/') !== -1) return true
    if (doc.cacheKey && String(doc.cacheKey).indexOf('launches_previous') !== -1) return true
    return false
  }

  function dedupeAppend(merged, seen, arr) {
    if (!Array.isArray(arr)) return
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i]
      const id = l.id || l.slug || ''
      const key = id || ('idx_' + merged.length)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(l)
    }
  }

  const related = docs.filter(isPreviousRelated)
  if (!related.length) return []

  const meta = related.find(function (d) {
    return d.isBatched === true && d.cacheKey && String(d.cacheKey).indexOf('_batch_') === -1
  })
  if (meta && meta.cacheKey && meta.totalBatches > 0) {
    const merged = []
    const seen = new Set()
    const base = meta.cacheKey
    for (let bi = 0; bi < meta.totalBatches; bi++) {
      const batchKey = base + '_batch_' + bi
      const batchDoc = docs.find(function (x) { return x.cacheKey === batchKey })
      if (batchDoc && batchDoc.data && Array.isArray(batchDoc.data.results)) {
        dedupeAppend(merged, seen, batchDoc.data.results)
      }
    }
    if (merged.length > 0) return merged
  }

  const whole = related.find(function (d) {
    return d.isBatched !== true && d.data && Array.isArray(d.data.results) && d.data.results.length > 0
  })
  if (whole) return whole.data.results.slice()

  const fragments = related.filter(function (d) {
    return d.data && Array.isArray(d.data.results) && d.data.results.length > 0 &&
      d.cacheKey && String(d.cacheKey).indexOf('_batch_') !== -1
  })
  if (fragments.length > 0) {
    fragments.sort(function (a, b) {
      const ia = parseInt(String(a.cacheKey).split('_batch_').pop() || '0', 10)
      const ib = parseInt(String(b.cacheKey).split('_batch_').pop() || '0', 10)
      return ia - ib
    })
    const merged = []
    const seen = new Set()
    for (let fi = 0; fi < fragments.length; fi++) {
      dedupeAppend(merged, seen, fragments[fi].data.results)
    }
    if (merged.length > 0) return merged
  }

  return []
}

// ── 获取今日各推文账号更新统计 ──
async function handleGetRecentCompleted(limit) {
  try {
    const res = await db.collection('space_devs_cache')
      .orderBy('updatedAt', 'desc')
      .limit(120)
      .get()

    if (!res.data || res.data.length === 0) return { success: true, missions: [] }

    const allResults = collectPreviousLaunchesFromCacheDocs(res.data)
    if (!allResults.length) return { success: true, missions: [] }

    // API 为 -net 倒序，取前 N 条即最近完成的发射
    const n = Math.min(Math.max(limit || 5, 1), 30)
    const recent = allResults.slice(0, n).map(function (l) {
      return {
        id: l.id || '',
        name: l.name || (l.mission && l.mission.name) || '',
        rocket: (l.rocket && l.rocket.configuration && (l.rocket.configuration.full_name || l.rocket.configuration.name)) || '',
        rocketName: (l.rocket && l.rocket.configuration && (l.rocket.configuration.full_name || l.rocket.configuration.name)) || '',
        launchTime: l.net || '',
        status: (l.status && l.status.abbrev) || 'Success'
      }
    })

    return { success: true, missions: recent }
  } catch (e) {
    return { success: false, missions: [] }
  }
}

// ── 年度报告（Year in Review）────────────────────────────────────
function beijingYearRangeMs(year) {
  const y = Number(year)
  const start = new Date(`${y}-01-01T00:00:00+08:00`).getTime()
  const end = new Date(`${y}-12-31T23:59:59.999+08:00`).getTime()
  return { start, end }
}

function parseYmdToStartMsBeijing(ymd) {
  if (!ymd || typeof ymd !== 'string') return 0
  const t = new Date(`${ymd.trim()}T00:00:00+08:00`).getTime()
  return isNaN(t) ? 0 : t
}

function parseYmdToEndMsBeijing(ymd) {
  if (!ymd || typeof ymd !== 'string') return 0
  const t = new Date(`${ymd.trim()}T23:59:59.999+08:00`).getTime()
  return isNaN(t) ? 0 : t
}

function defaultYearReviewConfig() {
  const y = new Date().getFullYear()
  return {
    enabled: false,
    year: y,
    visibleFromYmd: `${y}-12-15`,
    visibleToYmd: `${y + 1}-01-20`,
    title: '我的太空年鉴',
    subtitle: '回顾与你同行的发射与探索',
    introTemplate:
      '在 {{year}} 年，你累计签到 {{checkinDaysInYear}} 天（按云端当前保留的签到日期计算），在时间线留下 {{timelineEventCount}} 条探索印记。',
    outroTemplate: '新的一年，我们继续一起仰望同一片星空。',
    showPlatformStats: false
  }
}

async function loadYearReviewConfigDoc() {
  try {
    const res = await db.collection(ANNUAL_REPORT_CONFIG_COL).doc('current').get()
    return { ...defaultYearReviewConfig(), ...(res.data || {}) }
  } catch (e) {
    return defaultYearReviewConfig()
  }
}

function isYearReviewWindowOpen(cfg) {
  const c = { ...defaultYearReviewConfig(), ...(cfg || {}) }
  if (!c.enabled) return false
  const from = parseYmdToStartMsBeijing(c.visibleFromYmd) || 0
  const to = parseYmdToEndMsBeijing(c.visibleToYmd) || Number.MAX_SAFE_INTEGER
  const t = Date.now()
  return t >= from && t <= to
}

function countCheckinDatesInYear(history, year) {
  const prefix = String(year) + '-'
  return (history || []).filter(function (d) {
    return typeof d === 'string' && d.indexOf(prefix) === 0
  }).length
}

function filterTimelineInYear(timeline, year) {
  const range = beijingYearRangeMs(year)
  return (timeline || []).filter(function (t) {
    const ts = t && t.timestamp
    return typeof ts === 'number' && ts >= range.start && ts <= range.end
  })
}

function sumAiUsageYear(usedObj, year) {
  if (!usedObj || typeof usedObj !== 'object') return 0
  const prefix = String(year) + '-'
  var s = 0
  Object.keys(usedObj).forEach(function (k) {
    if (k.indexOf(prefix) === 0) s += Number(usedObj[k]) || 0
  })
  return s
}

function countAchievementsUnlockedInYear(achievements, year) {
  const range = beijingYearRangeMs(year)
  if (!achievements || typeof achievements !== 'object') return 0
  var n = 0
  Object.keys(achievements).forEach(function (k) {
    const a = achievements[k]
    const u = a && a.unlockedAt
    if (typeof u === 'number' && u >= range.start && u <= range.end) n++
  })
  return n
}

function applyTemplate(tpl, vars) {
  if (!tpl || typeof tpl !== 'string') return ''
  var out = tpl
  Object.keys(vars).forEach(function (k) {
    const re = new RegExp('\\{\\{\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}', 'g')
    out = out.replace(re, String(vars[k] != null ? vars[k] : ''))
  })
  return out
}

const MILESTONE_LABELS = {
  FIRST_OPEN: '初次启程',
  FIRST_CHECKIN: '首次签到',
  FIRST_QUIZ: '知识启蒙',
  FIRST_SUBSCRIBE: '追踪者',
  FIRST_SHARE: '传播者',
  WITNESS_LAUNCH: '见证历史',
  STREAK_7: '一周轨道',
  STREAK_30: '月球常驻',
  QUIZ_STREAK_5: '五连胜',
  NIGHT_OWL: '夜猫子',
  STARLINK_HUNTER: '星链猎人',
  FACTS_10: '知识收集者',
  MEMBERSHIP: '星际通行证',
  BRIEFING_7: '简报达人'
}

async function handleGetYearInReviewConfig() {
  const cfg = await loadYearReviewConfigDoc()
  const showEntry = isYearReviewWindowOpen(cfg)
  return {
    success: true,
    config: {
      enabled: !!cfg.enabled,
      year: Number(cfg.year) || new Date().getFullYear(),
      title: cfg.title || '',
      subtitle: cfg.subtitle || '',
      visibleFromYmd: cfg.visibleFromYmd || '',
      visibleToYmd: cfg.visibleToYmd || '',
      showEntry
    }
  }
}

async function handleGetYearInReview(openid, event) {
  if (!openid) return { success: false, code: 'no_openid' }
  const cfg = await loadYearReviewConfigDoc()
  if (!isYearReviewWindowOpen(cfg)) {
    return { success: false, code: 'year_review_closed' }
  }
  const year = Math.max(2000, Math.min(2100, Number(event.year || cfg.year) || new Date().getFullYear()))

  const [profileRes, membershipRes] = await Promise.all([
    db.collection(COLLECTION).doc(openid).get().catch(() => null),
    db.collection(MEMBERSHIP_COL).doc(openid).get().catch(() => null)
  ])
  var profile = (profileRes && profileRes.data) || {}

  const checkin = profile.checkin || {}
  const history = checkin.checkinHistory || []
  const checkinDaysInYear = countCheckinDatesInYear(history, year)

  const timelineYear = filterTimelineInYear(profile.timeline, year)
  const timelineEventCount = timelineYear.length
  const milestoneTypeCounts = {}
  timelineYear.forEach(function (t) {
    const ty = (t && t.type) || 'UNKNOWN'
    milestoneTypeCounts[ty] = (milestoneTypeCounts[ty] || 0) + 1
  })
  var milestoneSummaryParts = []
  Object.keys(milestoneTypeCounts).forEach(function (ty) {
    const label = MILESTONE_LABELS[ty] || ty
    milestoneSummaryParts.push(label + '×' + milestoneTypeCounts[ty])
  })
  var milestoneSummary = milestoneSummaryParts.length ? milestoneSummaryParts.join('，') : '暂无'

  const quiz = profile.quiz || {}
  const quizTotalAnswered = quiz.totalAnswered || 0
  const quizCorrect = quiz.correctCount || 0

  var membership = (membershipRes && membershipRes.data) || {}
  const aiChatYear = sumAiUsageYear(membership.aiChatUsed || {}, year)
  const aiImageYear = sumAiUsageYear(membership.aiImageUsed || {}, year)

  const achievementsUnlockedInYear = countAchievementsUnlockedInYear(profile.achievements, year)

  var platformBlock = null
  if (cfg.showPlatformStats) {
    try {
      const snapRes = await db.collection(ANNUAL_REPORT_SNAPSHOTS_COL).doc(String(year)).get()
      if (snapRes.data) {
        const s = snapRes.data
        platformBlock = s.data && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : s
      }
    } catch (e) {}
  }

  function platVal(key) {
    if (!platformBlock) return '—'
    const v = platformBlock[key]
    if (v === null || v === undefined || v === '') return '—'
    return String(v)
  }

  const vars = {
    year: year,
    checkinDaysInYear: checkinDaysInYear,
    timelineEventCount: timelineEventCount,
    milestoneSummary: milestoneSummary,
    quizAnswered: quizTotalAnswered,
    quizCorrect: quizCorrect,
    aiChatYear: aiChatYear,
    aiImageYear: aiImageYear,
    achievementsUnlockedInYear: achievementsUnlockedInYear,
    platformTotalUsers: platVal('totalUserProfiles'),
    platformGlobalLaunches: platVal('globalLaunchesInYear'),
    platformSpacexLaunches: platVal('spacexLaunchesInYear'),
    platformStarshipMissions: platVal('spacexStarshipMissionsInYear'),
    platformNewsArticles: platVal('newsArticlesInYear'),
    platformNewsEvents: platVal('newsEventsInYear'),
    platformTweetPosts: platVal('tweetPostsInYear'),
    platformMaxBoosterFlights: platVal('maxBoosterReuseCount'),
    platformMaxBoosterSerial: platformBlock && platformBlock.maxBoosterSerial ? String(platformBlock.maxBoosterSerial) : '—',
    platformMaxBoosterRocketModel: platformBlock && platformBlock.maxBoosterRocketModel ? String(platformBlock.maxBoosterRocketModel) : '—'
  }

  const intro = applyTemplate(cfg.introTemplate || defaultYearReviewConfig().introTemplate, vars)
  const outro = applyTemplate(cfg.outroTemplate || defaultYearReviewConfig().outroTemplate, vars)

  return {
    success: true,
    meta: {
      year: year,
      timezone: 'Asia/Shanghai',
      anchor: 'calendar_year',
      generatedAt: Date.now(),
      /** 与 user_profile 文档 _id 一致，便于核对 / 工单；即当前用户 OPENID */
      profileId: openid,
      platformStats: {
        peerDataEnabled: !!cfg.showPlatformStats,
        peerDataReady: !!platformBlock
      }
    },
    metrics: {
      checkinDaysInYear: checkinDaysInYear,
      timelineEventCount: timelineEventCount,
      milestoneTypeCounts: milestoneTypeCounts,
      quizTotalAnswered: quizTotalAnswered,
      quizCorrect: quizCorrect,
      aiChatYear: aiChatYear,
      aiImageYear: aiImageYear,
      achievementsUnlockedInYear: achievementsUnlockedInYear
    },
    summaryText: {
      intro: intro,
      outro: outro
    },
    platform: platformBlock,
    displayTitle: cfg.title || '我的太空年鉴',
    displaySubtitle: cfg.subtitle || ''
  }
}

async function handleGetTodayTweetStats() {
  const today = todayStr()  // 北京时间今日 yyyy-MM-dd

  try {
    // 账号列表与推文列表并行查询，减少串行等待
    const [accountsRes, tweetsRes] = await Promise.all([
      db.collection('tweet_accounts').where({ enabled: true }).limit(50).get(),
      db.collection('starship_event_updates')
        .where({ status: 'published' })
        .orderBy('publishedAt', 'desc')
        .field({ source: true, _id: true, publishedAt: true })
        .limit(200)
        .get()
    ])
    const accounts = accountsRes.data || []
    const allTweets = tweetsRes.data || []

    // 按北京时间日历日统计「今日」（修正：UTC ISO 字符串不能再用前缀匹配）
    const tweets = allTweets.filter(function (t) {
      return publishedAtToBeijingYmd(t.publishedAt) === today
    })

    // 按 source 分组统计
    var countMap = {}
    tweets.forEach(function (t) {
      var src = t.source || ''
      if (!countMap[src]) countMap[src] = 0
      countMap[src]++
    })

    // 组装结果
    var result = accounts.map(function (acc) {
      return {
        screenName: acc.screenName || '',
        label: acc.label || acc.screenName || '',
        avatarUrl: acc.avatarUrl || '',
        todayCount: countMap[acc.screenName] || 0
      }
    }).filter(function (item) {
      return item.todayCount > 0
    })

    console.log('[TweetStats] today:', today, 'total:', tweets.length, 'accounts:', result.length)
    return { success: true, tweetStats: result, total: tweets.length }
  } catch (e) {
    console.error('[TweetStats] error:', e.message)
    return { success: false, tweetStats: [], total: 0 }
  }
}

/**
 * 推文账号列表（首页轮播图账号胶囊用）：
 * 返回启用账号的精简字段，客户端按 cosFolder 匹配轮播视频来源
 */
async function handleGetTweetAccounts() {
  try {
    const res = await db.collection('tweet_accounts').where({ enabled: true }).limit(50).get()
    const accounts = (res.data || []).map(function (acc) {
      return {
        screenName: acc.screenName || '',
        label: acc.label || acc.screenName || '',
        avatarUrl: acc.avatarUrl || '',
        cosFolder: acc.cosFolder || ''
      }
    })
    return { success: true, accounts }
  } catch (e) {
    console.error('[TweetAccounts] error:', e.message)
    return { success: false, accounts: [] }
  }
}

/** 服务端读取「手写航天事件」开关（不受小程序端数据库读权限限制） */
async function newsManualEnabledOnServer() {
  try {
    const cfg = await db.collection('global_config').doc('news_manual_config').get()
    if (cfg.data && cfg.data.enabled === true) return true
  } catch (e) {}

  try {
    const main = await db.collection('global_config').doc('main').get()
    const md = main.data || {}
    if (Object.prototype.hasOwnProperty.call(md, 'newsManualArticlesEnabled')) {
      return md.newsManualArticlesEnabled === true
    }
  } catch (e) {}

  return false
}

function pickNewsArticleForClient(doc) {
  if (!doc || !doc._id) return null
  var imagesRaw = Array.isArray(doc.images) ? doc.images : []
  var images = imagesRaw
    .map(function (u) { return String(u || '').trim() })
    .filter(Boolean)
    .slice(0, 5)
  if (!images.length && doc.image) {
    var one = String(doc.image || '').trim()
    if (one) images = [one]
  }
  return {
    _id: doc._id,
    title: doc.title,
    summary: doc.summary,
    content: doc.content,
    author: doc.author,
    newsSite: doc.newsSite,
    publishedAt: doc.publishedAt || doc.date || '',
    date: doc.date || '',
    image: doc.image,
    images,
    url: doc.url,
    published: !!doc.published,
    weight: doc.weight,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

function manualNewsTimeMs(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number' && !isNaN(val)) {
    if (val === 0) return 0
    return val < 1e11 ? Math.round(val * 1000) : Math.round(val)
  }
  if (typeof val === 'string') {
    var s = val.trim()
    if (!s) return 0
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      var tYmd = new Date(s + 'T23:59:59.999+08:00').getTime()
      return isNaN(tYmd) ? 0 : tYmd
    }
  }
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6)
  }
  if (typeof val === 'object' && typeof val._seconds === 'number') {
    return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1e6)
  }
  if (typeof val === 'object' && typeof val.getTime === 'function') {
    var tObj = val.getTime()
    return isNaN(tObj) ? 0 : tObj
  }
  var d = new Date(val)
  var ts = d.getTime()
  return isNaN(ts) ? 0 : ts
}

function manualNewsPublishedMs(doc) {
  if (!doc) return 0
  var ts = manualNewsTimeMs(doc.publishedAt)
  if (!ts) ts = manualNewsTimeMs(doc.date)
  if (!ts) ts = manualNewsTimeMs(doc.createdAt)
  if (!ts) ts = manualNewsTimeMs(doc.updatedAt)
  return ts
}

function sortManualNewsRowsOnServer(rows, max) {
  var sorted = [].concat(rows || []).sort(function (a, b) {
    var pa = manualNewsPublishedMs(a)
    var pb = manualNewsPublishedMs(b)
    if (pb !== pa) return pb - pa
    var ua = manualNewsTimeMs(b.updatedAt) - manualNewsTimeMs(a.updatedAt)
    if (ua !== 0) return ua
    return String(b._id || b.id || '').localeCompare(String(a._id || a.id || ''))
  })
  return sorted.slice(0, max)
}

/** 小程序媒体映射：一次下发 enabled 的 key→url（避免客户端 N 次分页读 media_assets） */
async function handleGetMediaAssetsMap() {
  const MAX_ROWS = 500
  const PAGE = 100
  const map = {}
  let skip = 0
  let fetched = 0

  while (fetched < MAX_ROWS) {
    const limit = Math.min(PAGE, MAX_ROWS - fetched)
    const res = await db.collection('media_assets')
      .where({ enabled: true })
      .field({ key: true, url: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(limit)
      .get()

    const rows = res.data || []
    rows.forEach((item) => {
      const key = item && item.key != null ? String(item.key).trim() : ''
      const url = item && typeof item.url === 'string' ? item.url.trim() : (item && item.url)
      if (key && url) map[key] = url
    })

    fetched += rows.length
    skip += rows.length
    if (rows.length < limit) break
  }

  return {
    success: true,
    map,
    count: Object.keys(map).length,
    version: Date.now()
  }
}

/** 小程序「航天事件」合并用手写稿列表（公共只读） */
async function handleGetNewsManualForApp() {
  var enabled = await newsManualEnabledOnServer()
  if (!enabled) {
    return { success: true, enabled: false, items: [] }
  }

  var max = 30
  try {
    // 按更新时间倒序取 top N：无 orderBy 时 DB 返回任意 30 条，
    // 已发布文章超过 30 篇后最新稿可能不在结果集
    var res = await db.collection('news_articles')
      .where({ published: true })
      .orderBy('updatedAt', 'desc')
      .limit(max)
      .get()
    var rows = sortManualNewsRowsOnServer(res.data || [], max)

    var items = (rows || []).map(pickNewsArticleForClient).filter(Boolean)
    return { success: true, enabled: true, items }
  } catch (e) {
    console.error('[getNewsManualForApp]', e && e.message)
    return { success: true, enabled: true, items: [] }
  }
}

/** 手写稿详情（公共只读，docId 为云库 news_articles 文档 _id） */
async function handleGetNewsManualArticleById(event) {
  var raw = (event && (event.docId || event.id)) ? String(event.docId || event.id) : ''
  var id = raw.replace(/^manual_/, '').trim()
  if (!id) return { success: false, code: 'bad_id' }

  var enabled = await newsManualEnabledOnServer()
  if (!enabled) return { success: false, code: 'disabled' }

  try {
    var docRes = await db.collection('news_articles').doc(id).get()
    var doc = docRes.data
    if (!doc || !doc.published) return { success: false, code: 'not_found' }
    return { success: true, item: pickNewsArticleForClient(doc) }
  } catch (e) {
    return { success: false, code: 'not_found' }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  // 公共只读 action，不需要 openid
  const PUBLIC_ACTIONS = [
    'getTodayBriefing',
    'getTodayTweetStats',
    'getTweetAccounts',
    'getRecentCompleted',
    'getYearInReviewConfig',
    'getNewsManualForApp',
    'getNewsManualArticleById',
    'getMediaAssetsMap'
  ]
  if (!OPENID && PUBLIC_ACTIONS.indexOf(action) === -1) {
    return { success: false, code: 'no_openid' }
  }

  await ensureUserDataGatewayCollectionsOnce()

  switch (action) {
    case 'getProfile': {
      const profile = await getOrCreateProfile(OPENID)
      return { success: true, profile, openid: OPENID }
    }

    case 'checkin': {
      return handleCheckin(OPENID, event.factId)
    }

    case 'syncQuiz': {
      return handleSyncQuiz(OPENID, event.quizData)
    }

    case 'syncAll': {
      return handleSyncAll(OPENID, event.localData || {})
    }

    case 'savePreferences': {
      return handleSavePreferences(OPENID, event.preferences || {})
    }

    case 'getPreferences': {
      return handleGetPreferences(OPENID)
    }

    case 'recordMilestone': {
      return handleRecordMilestone(OPENID, event.milestone || {})
    }

    case 'getTodayBriefing': {
      return handleGetTodayBriefing(event.date || todayStr())
    }

    case 'getTodayTweetStats': {
      return handleGetTodayTweetStats()
    }

    case 'getTweetAccounts': {
      return handleGetTweetAccounts()
    }

    case 'getRecentCompleted': {
      return handleGetRecentCompleted(event.limit || 5)
    }

    case 'getYearInReviewConfig': {
      return handleGetYearInReviewConfig()
    }

    case 'getNewsManualForApp': {
      return handleGetNewsManualForApp()
    }

    case 'getNewsManualArticleById': {
      return handleGetNewsManualArticleById(event)
    }

    case 'getMediaAssetsMap': {
      return handleGetMediaAssetsMap()
    }

    case 'getYearInReview': {
      return handleGetYearInReview(OPENID, event)
    }

    default:
      return { success: false, code: 'unknown_action' }
  }
}
