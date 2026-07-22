const { getStatusCategory, getStatusBadgeText, isTerminalStatusId } = require('./api-request.js')

function filterExpiredMissions(missions) {
  const now = Date.now()
  return (missions || []).filter((mission) => {
    if (!mission) return false
    const sid = mission.statusId != null ? Number(mission.statusId) : 0
    // 终态不应再出现在即将发射（云缓存可能仍残留旧行）
    if (isTerminalStatusId(sid)) return false
    if (!mission.launchTime) return true
    const launchTs = new Date(mission.launchTime).getTime()
    if (launchTs > now) return true
    const category = mission.statusCategory || ''
    if (category === 'success' || category === 'failure' || category === 'partial' || category === 'deployed') return false
    return true
  })
}

/**
 * 倒计时/列表状态中文：与角标同一套映射。
 * 入参可为 LL2 status 对象 { id, name, abbrev }，或已本地化/英文的字符串。
 */
function getStatusTextZh(status) {
  if (status && typeof status === 'object') {
    return getStatusBadgeText(status, getStatusCategory(status))
  }
  const text = String(status || '').trim()
  if (!text) return '计划中'
  const lower = text.toLowerCase()
  if (lower.includes('payload deployed') || text.includes('载荷已部署') || text.includes('已部署')) return '载荷已部署'
  if (lower.includes('in flight') || lower.includes('inflight') || text.includes('飞行中')) return '飞行中'
  if (lower.includes('partial') || text.includes('部分失败') || text.includes('部分成功')) return '部分失败'
  if (lower.includes('success') || lower.includes('succeeded') || text.includes('成功')) return '已成功'
  if (lower.includes('failure') || lower.includes('failed') || text.includes('失败')) return '失败'
  if (lower.includes('delayed') || lower.includes('hold') || text.includes('推迟') || text.includes('延迟') || text.includes('暂停') || text.includes('保持')) return '推迟'
  if (lower.includes('tbd') || lower.includes('to be determined') || text.includes('待定')) return '待定'
  if (lower.includes('tbc') || lower.includes('to be confirmed') || text.includes('待确认')) return '待确认'
  if (lower.includes('go') || lower.includes('ready') || lower.includes('green') || text.includes('就绪') || text.includes('准备') || text === '正常') return '就绪'
  if (lower.includes('scheduled') || lower.includes('schedule') || lower.includes('pending') || text.includes('计划')) return '计划中'
  return text
}

function formatSecondsText(value) {
  return String(value == null ? 0 : value).padStart(2, '0')
}

function getPreviousSecondText(value) {
  const second = Number(value) || 0
  return formatSecondsText((second + 1) % 60)
}

function getNextSecondText(value) {
  const second = Number(value) || 0
  return formatSecondsText((second + 59) % 60)
}

function getSecondsReel(value) {
  const current = formatSecondsText(value)
  return [getPreviousSecondText(value), current, getNextSecondText(value)]
}

const DEFAULT_ROCKET_IMAGE = '火箭配置图/default.jpg'
// 注意：原值 'images/share/default.jpg' 这个本地文件不存在，会导致分享缩略图加载失败。
// 改用已存在于 COS 的火箭默认图（resolveMediaUrl 会拼成 https COS 链接）。
const DEFAULT_SHARE_IMAGE = '火箭配置图/default.jpg'
const DEFAULT_CAROUSEL_ITEMS = [
  { key: '首页轮播图/轮播图1.jpg' },
  { key: '首页轮播图/轮播图2.jpg' },
  { key: '首页轮播图/轮播图3.jpg' }
]

const CALENDAR_SITE_META = {
  starbase: { label: 'Starbase', launchSiteId: 101 },
  'lc-39a': { label: 'LC-39A', launchSiteId: 102 },
  'slc-40': { label: 'SLC-40', launchSiteId: 103 },
  'slc-4e': { label: 'SLC-4E', launchSiteId: 104 },
  oca: { label: '历史站点', launchSiteId: 105 },
  wenchang: { label: '文昌', launchSiteId: 106 },
  jiuquan: { label: '酒泉', launchSiteId: 107 },
  xichang: { label: '西昌', launchSiteId: 108 },
  taiyuan: { label: '太原', launchSiteId: 109 },
  baikonur: { label: '拜科努尔', launchSiteId: 110 },
  vostochny: { label: '东方', launchSiteId: 111 },
  kourou: { label: '库鲁', launchSiteId: 112 },
  sriharikota: { label: 'SHAR', launchSiteId: 113 },
  tanegashima: { label: '种子岛', launchSiteId: 114 },
  naro: { label: '罗老', launchSiteId: 115 },
  semnan: { label: '塞姆南', launchSiteId: 116 },
  plesetsk: { label: '普列谢茨克', launchSiteId: 117 },
  wallops: { label: 'Wallops', launchSiteId: 118 },
  mahia: { label: 'Mahia', launchSiteId: 119 }
}

const DEFAULT_VOTE_DATA = {
  geCount: 0,
  buGeCount: 0,
  customQuestion: '',
  enabled: false,
  votingClosed: false,
  result: '',
  voteType: 'ontime',
  geLabel: '鸽',
  bugeLabel: '不鸽'
}

const storageCache = require('./storage-sync-cache.js')

const VOTED_LAUNCHES_KEY = '_voted_launches'

let _votesMem = null
let _votesMemLoaded = false

function _loadVotesStore() {
  if (_votesMemLoaded) return _votesMem || {}
  _votesMem = storageCache.readSync(VOTED_LAUNCHES_KEY, {}) || {}
  _votesMemLoaded = true
  return _votesMem
}

function warmVotesStoreSync() {
  return _loadVotesStore()
}

function normalizeVoteType(t) {
  return String(t || '').trim() === 'outcome' ? 'outcome' : 'ontime'
}

/**
 * 统一竞猜选项：两套系统互不混用。
 * - 成败：success/failure（历史误存的 buge/ge 会纠正）
 * - 准时：ge/buge
 */
function resolveVoteChoiceMeta(choice, voteType) {
  let raw = String(choice || '').trim()
  let vt = normalizeVoteType(voteType)
  if (raw === 'success' || raw === 'failure') vt = 'outcome'
  if (vt === 'outcome') {
    if (raw === 'buge') raw = 'success'
    else if (raw === 'ge') raw = 'failure'
    const choiceLabel = raw === 'success' ? '成功' : raw === 'failure' ? '失败' : (raw || '未知')
    return {
      voteType: 'outcome',
      voteTypeLabel: '成败',
      choice: raw === 'success' || raw === 'failure' ? raw : '',
      choiceLabel
    }
  }
  if (raw === 'success') raw = 'buge'
  else if (raw === 'failure') raw = 'ge'
  const choiceLabel = raw === 'ge' ? '鸽' : raw === 'buge' ? '不鸽' : (raw || '未知')
  return {
    voteType: 'ontime',
    voteTypeLabel: '准时',
    choice: raw === 'ge' || raw === 'buge' ? raw : '',
    choiceLabel
  }
}

/** 成败票数映射到左侧 ge / 右侧 buge，便于复用现有 pill 样式 */
function normalizeVoteStatsForUi(stats, voteType) {
  const vt = normalizeVoteType(voteType || (stats && stats.voteType))
  const safeStats = stats ? { ...DEFAULT_VOTE_DATA, ...stats, voteType: vt } : { ...DEFAULT_VOTE_DATA, voteType: vt }
  if (vt === 'outcome') {
    // 成败票数始终映射到左右 pill / 比例条字段
    const failureCount = Number(
      safeStats.failureCount != null ? safeStats.failureCount : (safeStats.geCount || 0)
    )
    const successCount = Number(
      safeStats.successCount != null ? safeStats.successCount : (safeStats.buGeCount || 0)
    )
    safeStats.failureCount = failureCount
    safeStats.successCount = successCount
    safeStats.geCount = failureCount
    safeStats.buGeCount = successCount
    // 成败文案不得回退到准时默认的「鸽/不鸽」（DEFAULT 里带了这两项）
    const failureLabel = safeStats.failureLabel || ''
    const successLabel = safeStats.successLabel || ''
    const left = failureLabel || ((safeStats.geLabel === '鸽' || !safeStats.geLabel) ? '失败' : safeStats.geLabel)
    const right = successLabel || ((safeStats.bugeLabel === '不鸽' || !safeStats.bugeLabel) ? '成功' : safeStats.bugeLabel)
    safeStats.failureLabel = failureLabel || left
    safeStats.successLabel = successLabel || right
    safeStats.geLabel = left
    safeStats.bugeLabel = right
    // 有服务端文案就原样用；空值 / 准时默认 / 历史长默认 才回退，禁止写死覆盖后台配置
    if (!safeStats.customQuestion ||
      safeStats.customQuestion === '会准时吗？' ||
      safeStats.customQuestion === '本次发射会成功吗？') {
      safeStats.customQuestion = '会成功吗？'
    }
  } else {
    if (!safeStats.geLabel || safeStats.geLabel === '失败') safeStats.geLabel = '鸽'
    if (!safeStats.bugeLabel || safeStats.bugeLabel === '成功') safeStats.bugeLabel = '不鸽'
    if (!safeStats.customQuestion) safeStats.customQuestion = '会准时吗？'
  }
  return safeStats
}

function getInitialVoteState() {
  return {
    voteData: { ...DEFAULT_VOTE_DATA },
    myVote: '',
    voteTotal: 0,
    voteGePct: 50,
    voteBugePct: 50,
    activeVoteType: 'ontime',
    voteSlotVisible: false,
    voteOntimeEnabled: false,
    voteOutcomeEnabled: false
  }
}

function buildVoteState(stats, myVote, voteType) {
  const safeStats = normalizeVoteStatsForUi(stats, voteType)
  const total = Number(safeStats.geCount || 0) + Number(safeStats.buGeCount || 0)
  return {
    voteData: safeStats,
    myVote: myVote || '',
    voteTotal: total,
    voteGePct: total > 0 ? Math.round((safeStats.geCount || 0) / total * 100) : 50,
    voteBugePct: total > 0 ? Math.round((safeStats.buGeCount || 0) / total * 100) : 50,
    activeVoteType: safeStats.voteType || 'ontime'
  }
}

/** 根据双题型缓存拼出页面 setData 补丁 */
function buildDualVoteUiPatch(bundle, activeVoteType, launchId) {
  const ontime = (bundle && bundle.ontime) || null
  const outcome = (bundle && bundle.outcome) || null
  const ontimeEnabled = !!(ontime && ontime.enabled)
  const outcomeEnabled = !!(outcome && outcome.enabled)
  let vt = normalizeVoteType(activeVoteType)
  if (vt === 'ontime' && !ontimeEnabled && outcomeEnabled) vt = 'outcome'
  if (vt === 'outcome' && !outcomeEnabled && ontimeEnabled) vt = 'ontime'
  const stats = vt === 'outcome' ? outcome : ontime
  const myVote = (stats && stats.myVote) || (launchId ? getLocalVote(launchId, vt) : '')
  const base = buildVoteState(stats, myVote, vt)
  return {
    ...base,
    activeVoteType: vt,
    voteSlotVisible: ontimeEnabled || outcomeEnabled,
    voteOntimeEnabled: ontimeEnabled,
    voteOutcomeEnabled: outcomeEnabled
  }
}

/**
 * 合并单题型竞猜统计：防止已投票后被「0 票 / 无 myVote」的旧缓存或竞态响应降级。
 */
function mergeVoteTypeStats(prev, next, launchId, voteType) {
  const vt = normalizeVoteType(voteType)
  if (!next && prev) return prev
  if (!next) return null
  const merged = { ...next }
  const prevSafe = prev || null
  if (!merged.myVote) {
    merged.myVote = (prevSafe && prevSafe.myVote) || (launchId ? getLocalVote(launchId, vt) : '') || ''
  }

  if (vt === 'outcome') {
    let fail = Number(merged.failureCount != null ? merged.failureCount : (merged.geCount || 0))
    let succ = Number(merged.successCount != null ? merged.successCount : (merged.buGeCount || 0))
    if (prevSafe) {
      const prevFail = Number(prevSafe.failureCount != null ? prevSafe.failureCount : (prevSafe.geCount || 0))
      const prevSucc = Number(prevSafe.successCount != null ? prevSafe.successCount : (prevSafe.buGeCount || 0))
      if (merged.myVote && fail + succ < prevFail + prevSucc) {
        fail = Math.max(fail, prevFail)
        succ = Math.max(succ, prevSucc)
      }
    }
    if (merged.myVote && fail + succ === 0) {
      if (merged.myVote === 'failure') fail = 1
      else if (merged.myVote === 'success') succ = 1
    }
    merged.failureCount = fail
    merged.successCount = succ
    merged.geCount = fail
    merged.buGeCount = succ
  } else {
    let ge = Number(merged.geCount || 0)
    let buge = Number(merged.buGeCount || 0)
    if (prevSafe) {
      const prevGe = Number(prevSafe.geCount || 0)
      const prevBuge = Number(prevSafe.buGeCount || 0)
      if (merged.myVote && ge + buge < prevGe + prevBuge) {
        ge = Math.max(ge, prevGe)
        buge = Math.max(buge, prevBuge)
      }
    }
    if (merged.myVote && ge + buge === 0) {
      if (merged.myVote === 'ge') ge = 1
      else if (merged.myVote === 'buge') buge = 1
    }
    merged.geCount = ge
    merged.buGeCount = buge
  }

  if (merged.myVote && merged.enabled === false && prevSafe && prevSafe.enabled !== false) {
    merged.enabled = true
  }
  return merged
}

function mergeVoteBundle(prevBundle, nextBundle, launchId) {
  const prev = prevBundle || {}
  const next = nextBundle || {}
  return {
    ontime: mergeVoteTypeStats(prev.ontime, next.ontime, launchId, 'ontime'),
    outcome: mergeVoteTypeStats(prev.outcome, next.outcome, launchId, 'outcome')
  }
}

function getLocalVote(launchId, voteType) {
  try {
    const votes = _loadVotesStore()
    const vt = voteType === 'outcome' ? 'outcome' : 'ontime'
    const key = `${launchId}::${vt}`
    if (votes[key]) return votes[key]
    // 兼容旧 key（仅准时竞猜）
    if (vt === 'ontime' && votes[launchId]) return votes[launchId]
    return ''
  } catch (e) {
    return ''
  }
}

function saveLocalVote(launchId, choice, voteType) {
  try {
    const votes = { ..._loadVotesStore() }
    const vt = voteType === 'outcome' ? 'outcome' : 'ontime'
    votes[`${launchId}::${vt}`] = choice
    _votesMem = votes
    _votesMemLoaded = true
    storageCache.persistAsync(VOTED_LAUNCHES_KEY, votes)
  } catch (e) {}
}

/** 投票提交失败时回滚本地乐观记录 */
function removeLocalVote(launchId, voteType) {
  try {
    const votes = { ..._loadVotesStore() }
    const vt = voteType === 'outcome' ? 'outcome' : 'ontime'
    delete votes[`${launchId}::${vt}`]
    if (vt === 'ontime') delete votes[launchId]
    _votesMem = votes
    _votesMemLoaded = true
    storageCache.persistAsync(VOTED_LAUNCHES_KEY, votes)
  } catch (e) {}
}

/** 清空全部本地竞猜记录（配合云端清除竞猜记录使用） */
function clearLocalVotes() {
  try {
    _votesMem = {}
    _votesMemLoaded = true
    storageCache.persistAsync(VOTED_LAUNCHES_KEY, {})
  } catch (e) {}
}

function isRecentTimestamp(lastLoadedAt, ttlMs, now = Date.now()) {
  const ts = Number(lastLoadedAt) || 0
  const ttl = Number(ttlMs) || 0
  if (!ts || ttl <= 0) return false
  return now - ts < ttl
}

function shouldSkipVoteRefresh(options = {}) {
  const {
    launchId,
    lastLoadedAt = 0,
    ttlMs = 0,
    skipCache = false,
    now = Date.now()
  } = options

  if (!launchId || !skipCache) return false
  return isRecentTimestamp(lastLoadedAt, ttlMs, now)
}

function getLaunchStatsYear(now) {
  const d = now == null
    ? new Date()
    : (now instanceof Date ? now : new Date(now))
  return Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear()
}

function isLaunchStatsFreshForCurrentYear(stats) {
  if (!stats || typeof stats !== 'object') return false
  if (stats.year == null) return false
  return Number(stats.year) === getLaunchStatsYear()
}

function shouldSkipLaunchStatsRefresh(options = {}) {
  const {
    stats,
    lastLoadedAt = 0,
    ttlMs = 0,
    errorMessage = '',
    now = Date.now()
  } = options

  const hasStats = !!(stats && typeof stats === 'object' && Object.keys(stats).length)
  if (!hasStats || errorMessage) return false
  if (!isLaunchStatsFreshForCurrentYear(stats)) return false
  return isRecentTimestamp(lastLoadedAt, ttlMs, now)
}

function shouldSkipSimpleRefresh(options = {}) {
  const {
    hasData = false,
    lastLoadedAt = 0,
    ttlMs = 0,
    now = Date.now()
  } = options

  if (!hasData) return false
  return isRecentTimestamp(lastLoadedAt, ttlMs, now)
}

function getMissionDetailCacheKey(id, detailType) {
  const type = detailType === 'completed' ? 'completed' : 'upcoming'
  return `${id}_${type}`
}

function getMissionDetailCacheEntry(cache, id, detailType) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return null
  const entry = cache[getMissionDetailCacheKey(id, detailType)]
  if (!entry || typeof entry !== 'object') return null
  return { ...entry }
}

// 缓存 schema 版本：每次 mission 数据结构有破坏性变化时 bump 一下，
// shouldReuseMissionDetailCache 会校验，旧版本缓存自动失效。
const MISSION_DETAIL_CACHE_SCHEMA = 'v2-multicore'

function setMissionDetailCacheEntry(cache, id, detailType, mission, options = {}) {
  if (!mission || typeof mission !== 'object') return cache && typeof cache === 'object' && !Array.isArray(cache) ? { ...cache } : {}
  const safeCache = cache && typeof cache === 'object' && !Array.isArray(cache) ? { ...cache } : {}
  const safeOptions = options || {}
  safeCache[getMissionDetailCacheKey(id, detailType)] = {
    ...mission,
    _cachedAt: safeOptions.cachedAt || Date.now(),
    _cacheSource: safeOptions.source || mission._cacheSource || 'detail',
    _schemaVersion: MISSION_DETAIL_CACHE_SCHEMA
  }
  return safeCache
}

function shouldReuseMissionDetailCache(options = {}) {
  const {
    mission,
    ttlMs = 0,
    lastLoadedAt = mission && mission._cachedAt,
    now = Date.now()
  } = options

  const safeMission = mission && typeof mission === 'object' ? mission : null
  if (!safeMission || !Object.keys(safeMission).length) return false
  if (safeMission._cacheSource === 'fallback') return false
  // schema 版本不匹配的旧缓存（升级前写入的）一律忽略
  if (safeMission._schemaVersion !== MISSION_DETAIL_CACHE_SCHEMA) return false
  return isRecentTimestamp(lastLoadedAt, ttlMs, now)
}

function shouldReuseMissionListSnapshot(options = {}) {
  const {
    mission,
    ttlMs = 0,
    now = Date.now()
  } = options

  const safeMission = mission && typeof mission === 'object' ? mission : null
  if (!safeMission || !Object.keys(safeMission).length) return false
  if (safeMission._cacheSource !== 'list') return false
  return isRecentTimestamp(safeMission._cachedAt, ttlMs, now)
}

function buildDetailPrefetchQueue(options = {}) {
  const {
    upcomingMissions = [],
    completedMissions = [],
    maxPreload = 20,
    cache = {},
    pendingMap = {}
  } = options

  const tasks = []
  const upcomingList = Array.isArray(upcomingMissions) ? upcomingMissions.slice(0, maxPreload) : []
  const completedList = Array.isArray(completedMissions) ? completedMissions.slice(0, maxPreload) : []

  upcomingList.forEach((mission) => {
    if (!mission || mission.id == null) return
    const cacheKey = getMissionDetailCacheKey(mission.id, 'upcoming')
    if (cache[cacheKey] || pendingMap[cacheKey]) return
    tasks.push({ mission, type: 'upcoming', cacheKey })
  })

  completedList.forEach((mission) => {
    if (!mission || mission.id == null) return
    const cacheKey = getMissionDetailCacheKey(mission.id, 'completed')
    if (cache[cacheKey] || pendingMap[cacheKey]) return
    tasks.push({ mission, type: 'completed', cacheKey })
  })

  return tasks
}

module.exports = {
  filterExpiredMissions,
  getStatusTextZh,
  formatSecondsText,
  getSecondsReel,
  DEFAULT_ROCKET_IMAGE,
  DEFAULT_SHARE_IMAGE,
  DEFAULT_CAROUSEL_ITEMS,
  CALENDAR_SITE_META,
  getInitialVoteState,
  buildVoteState,
  buildDualVoteUiPatch,
  mergeVoteTypeStats,
  mergeVoteBundle,
  resolveVoteChoiceMeta,
  normalizeVoteType,
  getLocalVote,
  saveLocalVote,
  removeLocalVote,
  clearLocalVotes,
  warmVotesStoreSync,
  isRecentTimestamp,
  shouldSkipVoteRefresh,
  getLaunchStatsYear,
  isLaunchStatsFreshForCurrentYear,
  shouldSkipLaunchStatsRefresh,
  shouldSkipSimpleRefresh,
  getMissionDetailCacheKey,
  getMissionDetailCacheEntry,
  setMissionDetailCacheEntry,
  shouldReuseMissionDetailCache,
  shouldReuseMissionListSnapshot,
  buildDetailPrefetchQueue
}
