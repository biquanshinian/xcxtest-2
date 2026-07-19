/**
 * mission-replay.js — 任务发射回放（小时级扫描，覆盖全部发射商）
 *
 * 扫描源与小程序「已完成任务」列表同源（LL2 previous 全发射商 -net 倒序），
 * 按 launchId 一一对应，保证详情页能点开的近期任务都有回放文档、不会错位。
 *
 * 产出 mission_replays 集合（_id=launchId），任务详情页「观看回放」卡片读取：
 *   - clips：发射集锦（压缩版），两个来源：
 *       a) SpaceX 官方推文短视频（syncSpaceXTweets 已落 COS 的压缩预览，零新增下载；
 *          仅挂给 SpaceX 的发射，别家任务不挂推文集锦）
 *       b) 指定博主 SciNews 的 2~3 分钟发射集锦（YouTube 频道覆盖全球主要发射，
 *          本机 Agent yt-dlp 下载 → COS；无 a 类集锦时自动入队 kind=clip 任务，
 *          global_config.main.replayClipAgentEnabled=false 可关）
 *   - links：完整回放外链（官方直播 > 非官方直播 > 转播），前端点击复制
 *   - videoUrl：完整回放 COS 转存（可选，kind=full Agent 任务产出；
 *     global_config.main.replayAgentEnabled=true 才入队，默认关闭 = 长视频只给链接）
 *
 * 省资源约束：每轮只打 1 次 LL2 previous 探针 + 1 次事件库查询，挂在 syncLaunchNetHourly 顺带执行。
 */

const REPLAY_QUEUE_COL = 'replay_fetch_queue'
const REPLAY_RESULT_COL = 'mission_replays'
const EVENTS_COL = 'starship_event_updates'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

const MIN_AGE_MS = 30 * 60 * 1000            // 发射后 30 分钟开始建档（集锦通常几分钟内就发）
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000   // 超过 7 天的老任务不再刷新
const CLIP_WINDOW_BEFORE_MS = 15 * 60 * 1000 // 集锦归属窗口：净时前 15 分钟（点火瞬间的现场机位帖）
const CLIP_WINDOW_AFTER_MS = 12 * 60 * 60 * 1000 // 到净时后 12 小时（着陆/整流罩/星箭分离集锦）
const CLIP_AGENT_MIN_AGE_MS = 3 * 60 * 60 * 1000 // SciNews 集锦一般发射后几小时内发布，太早入队白跑
const MAX_CLIPS = 4
// 与小程序「已完成任务」列表同源：LL2 previous 全发射商、-net 倒序。
// 扫描条数 ≥ 列表首页条数（10），保证详情页能点开的近期任务都有回放文档
const SCAN_LIMIT = 10

/** 回放源排序：官方直播 > 非官方直播 > 转播；同级按 LL2 priority 降序 */
function sourceRank(typeName) {
  const t = String(typeName || '').toLowerCase()
  if (t.includes('official') && !t.includes('unofficial')) return 0
  if (t.includes('unofficial webcast')) return 1
  if (t.includes('re-stream') || t.includes('restream')) return 2
  return 3
}

/** launch.vid_urls → 外链回放列表（前端点击复制） */
function buildReplayLinks(launch) {
  const raw = Array.isArray(launch && launch.vid_urls) ? launch.vid_urls : []
  return raw
    .filter((v) => v && typeof v.url === 'string' && /^https?:\/\//i.test(v.url))
    .map((v) => ({
      url: v.url,
      title: v.title || '',
      publisher: v.publisher || '',
      type: (v.type && v.type.name) || '',
      priority: v.priority != null ? Number(v.priority) : 0
    }))
    .sort((a, b) => {
      const r = sourceRank(a.type) - sourceRank(b.type)
      if (r !== 0) return r
      return (b.priority || 0) - (a.priority || 0)
    })
    .slice(0, 4)
    .map((v) => ({ url: v.url, title: v.title, publisher: v.publisher, type: v.type }))
}

function isSettledStatus(launch) {
  const abbrev = (launch && launch.status && launch.status.abbrev) || ''
  return abbrev === 'Success' || abbrev === 'Failure' || abbrev === 'Partial Failure'
}

/** 是否 SpaceX 的发射（LL2 lsp id 121）：推文集锦只挂给 SpaceX 任务 */
function isSpaceXLaunch(launch) {
  const lsp = (launch && (launch.launch_service_provider || launch.lsp)) || {}
  if (Number(lsp.id) === 121) return true
  return /spacex/i.test(String(lsp.name || ''))
}

function isCosUrl(url) {
  return typeof url === 'string' && url.startsWith(COS_BASE_URL)
}

/** 集锦只认 SpaceX 官方账号（事件库还同步 NASA/CNSpaceflight/马斯克等无关账号） */
const CLIP_SOURCE_WHITELIST = new Set(['spacex'])

/** 发射动作关键词：官方号也发星链宣传片等无关视频，文案必须带发射相关词才算集锦 */
const CLIP_TEXT_KEYWORDS = [
  'liftoff', 'lift off', 'launch', 'launches', 'launched',
  'landing', 'landed', 'lands', 'touchdown',
  'deploy', 'deployment', 'deployed', 'separation', 'fairing',
  'first stage', 'booster', 'to orbit', 'on orbit', 'ascent', 'entry burn',
  '发射', '升空', '点火', '着陆', '回收', '部署', '入轨', '整流罩'
]

/** 判断事件文案是否为发射相关（原文优先，其次中文标题/正文） */
function isLaunchRelatedText(ev) {
  const text = [ev.originalText, ev.title, ev.content]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!text.trim()) return false
  return CLIP_TEXT_KEYWORDS.some((kw) => text.includes(kw))
}

/**
 * 从事件更新库匹配各发射的集锦短视频（只取已有压缩预览的 COS 视频，零新增下载）。
 * 归属规则（四重过滤，宁缺毋滥）：
 *   1. 任务：只挂给 SpaceX 的发射（推文源是 SpaceX 官方号，别家发射不能张冠李戴）
 *   2. 账号：仅 SpaceX 官方账号的推文
 *   3. 文案：必须含发射动作关键词（liftoff/landing/deploy…），排除官方号的宣传片
 *   4. 时间：发布时间落在某次发射 [net-15min, net+12h] 窗口内；
 *      多个候选发射（双首发）时归 net 距离最近的那次
 * @returns {Map<launchId, clips[]>}
 */
async function matchHighlightClips(db, launches) {
  const _ = db.command
  const windows = launches
    .filter((l) => isSpaceXLaunch(l))
    .map((l) => ({ launchId: String(l.id), netMs: Date.parse(l.net || '') || 0 }))
    .filter((w) => w.netMs > 0)
  if (!windows.length) return new Map()

  const minStart = Math.min(...windows.map((w) => w.netMs)) - CLIP_WINDOW_BEFORE_MS
  let events = []
  try {
    const res = await db.collection(EVENTS_COL)
      .where({ publishedAt: _.gte(minStart), status: 'published' })
      .orderBy('publishedAt', 'asc')
      .limit(100)
      .get()
    events = res.data || []
  } catch (e) {
    return new Map()
  }

  const byLaunch = new Map()
  for (const ev of events) {
    const ts = Number(ev.publishedAt || 0)
    if (!ts) continue
    if (!CLIP_SOURCE_WHITELIST.has(String(ev.source || '').toLowerCase())) continue
    if (!isLaunchRelatedText(ev)) continue
    // 候选窗口内取 net 最近的发射
    let best = null
    for (const w of windows) {
      const delta = ts - w.netMs
      if (delta < -CLIP_WINDOW_BEFORE_MS || delta > CLIP_WINDOW_AFTER_MS) continue
      if (!best || Math.abs(delta) < Math.abs(ts - best.netMs)) best = w
    }
    if (!best) continue

    for (const media of ev.mediaList || []) {
      if (!media || media.type !== 'video') continue
      // 「只要压缩版」：必须有 COS 压缩预览；长视频/未落 COS 的跳过（外链已覆盖）
      const preview = media.previewUrl || ''
      if (!isCosUrl(preview) || media.isLongVideo) continue
      const list = byLaunch.get(best.launchId) || []
      if (list.length >= MAX_CLIPS) continue
      list.push({
        videoUrl: preview,
        // 只回 COS 缩略图（twimg 外链不在小程序域名白名单）；缺失时前端用万象截帧兜底
        thumbnailUrl: isCosUrl(media.thumbnailUrl) ? media.thumbnailUrl : '',
        sourceUrl: media.sourceUrl || ev.tweetUrl || '',
        title: ev.title || '',
        publisher: ev.author || ev.source || 'SpaceX',
        publishedAt: ts
      })
      byLaunch.set(best.launchId, list)
    }
  }
  return byLaunch
}

/** 可选：完整回放 Agent 入队（默认关闭；长视频只给链接） */
async function maybeEnqueueAgentJob(db, launch, cfg) {
  if (!cfg || cfg.replayAgentEnabled !== true) return false
  const launchId = String(launch.id)
  try {
    const done = await db.collection(REPLAY_RESULT_COL).doc(launchId).get().catch(() => null)
    if (done && done.data && done.data.videoUrl) return false
  } catch (e) {}
  try {
    const q = await db.collection(REPLAY_QUEUE_COL).where({ launchId, kind: 'full' }).limit(1).get()
    if (q.data && q.data.length) return false
  } catch (e) {}
  const nowMs = Date.now()
  const sources = (Array.isArray(launch.vid_urls) ? launch.vid_urls : [])
    .filter((v) => v && typeof v.url === 'string' && /^https?:\/\//i.test(v.url))
    .map((v) => ({
      url: v.url,
      title: v.title || '',
      publisher: v.publisher || '',
      type: (v.type && v.type.name) || '',
      priority: v.priority != null ? Number(v.priority) : 0
    }))
    .sort((a, b) => sourceRank(a.type) - sourceRank(b.type))
  if (!sources.length) return false
  await db.collection(REPLAY_QUEUE_COL).add({
    data: {
      kind: 'full',
      launchId,
      missionName: launch.name || '',
      net: launch.net || '',
      sources,
      status: 'pending',
      attempts: 0,
      claimToken: '',
      claimedAt: 0,
      nextRetryAt: 0,
      lastError: '',
      createdAt: nowMs,
      updatedAt: nowMs
    }
  })
  return true
}

// —— 指定博主集锦（SciNews）Agent 入队 ——
// SciNews 每次发射后几小时内发 2~3 分钟「launch and landing」集锦，
// 标题固定含 UTC 日期（如 "…, 14 July 2026"），据此 + 任务关键词精确匹配。

// SciNews 频道（handle 是 @SciNewsRo，用 channel_id 形式更稳，不受改名影响）
const CLIP_CHANNEL_URL = 'https://www.youtube.com/channel/UCjU6ZwoTQtKWfz1urL7XcbA/videos'
const CLIP_PUBLISHER = 'SciNews'
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** net → SciNews 标题里的 UTC 日期串，如 "14 July 2026" */
function clipDateText(netMs) {
  const d = new Date(netMs)
  return `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** 文本 → 匹配 token（过滤停用词/纯数字/单字符，"Tranche 1" 的 "1" 会误命中任何含 1 的标题） */
function textToTokens(text) {
  const stop = new Set(['group', 'mission', 'the', 'of', 'and', 'to', 'a', 'block', 'flight', 'maiden', 'demo'])
  return String(text || '')
    .split(/[\s()|,]+/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
    .filter((t) => t.length >= 2 && !stop.has(t) && !/^\d+$/.test(t))
    .slice(0, 5)
}

/**
 * LL2 任务名 → 集锦匹配线索。
 * "Falcon 9 Block 5 | Starlink Group 10-45" →
 *   tokens（任务段，必须命中至少 1 个）: ["starlink","10-45"]
 *   rocketTokens（火箭段，只加分不作准入）: ["falcon"]
 * 全发射商场景下任务段 token 是防「同日不同商发射」张冠李戴的关键
 */
function clipMatchTokens(missionName) {
  const raw = String(missionName || '')
  const sep = raw.indexOf('|')
  const rocketPart = sep >= 0 ? raw.slice(0, sep) : ''
  const missionPart = sep >= 0 ? raw.slice(sep + 1) : raw
  return {
    tokens: textToTokens(missionPart),
    rocketTokens: textToTokens(rocketPart)
  }
}

/**
 * 无推文集锦时入队 kind=clip 任务，由本机 Agent 去 SciNews 频道搜下载（≤480p ≈ 2 分钟 10~20MB）。
 * 开关：global_config.main.replayClipAgentEnabled = false 可停（默认开）。
 */
async function maybeEnqueueClipJob(db, launch, cfg, existingDoc, tweetClipCount, nowMs) {
  if (cfg && cfg.replayClipAgentEnabled === false) return false
  if (tweetClipCount > 0) return false
  // Agent 已抓到过 SciNews 集锦则不再入队
  if (existingDoc && Array.isArray(existingDoc.agentClips) && existingDoc.agentClips.length) return false
  const netMs = Date.parse(launch.net || '') || 0
  if (!netMs || nowMs - netMs < CLIP_AGENT_MIN_AGE_MS) return false
  const launchId = String(launch.id)
  try {
    const q = await db.collection(REPLAY_QUEUE_COL).where({ launchId, kind: 'clip' }).limit(1).get()
    if (q.data && q.data.length) return false
  } catch (e) {}
  const { tokens, rocketTokens } = clipMatchTokens(launch.name)
  await db.collection(REPLAY_QUEUE_COL).add({
    data: {
      kind: 'clip',
      launchId,
      missionName: launch.name || '',
      net: launch.net || '',
      clipSearch: {
        channel: CLIP_CHANNEL_URL,
        publisher: CLIP_PUBLISHER,
        dateText: clipDateText(netMs),
        tokens,
        rocketTokens,
        maxDurationSec: 300
      },
      status: 'pending',
      attempts: 0,
      claimToken: '',
      claimedAt: 0,
      nextRetryAt: 0,
      lastError: '',
      createdAt: nowMs,
      updatedAt: nowMs
    }
  })
  return true
}

/**
 * 扫描最近已完成发射 → 生成/刷新 mission_replays 文档（集锦 + 外链）
 */
async function runSyncMissionReplayQueue(db, fetchAPI, apiBase) {
  let cfg = {}
  try {
    const r = await db.collection('global_config').doc('main').get()
    cfg = (r && r.data) || {}
  } catch (e) {}
  if (cfg.replayFetchEnabled === false) {
    return { success: true, skipped: 'replayFetchEnabled=false' }
  }

  const url = `${apiBase}/launches/previous/?mode=detailed&format=json&limit=${SCAN_LIMIT}&ordering=-net`
  let data
  try {
    data = await fetchAPI(url)
  } catch (e) {
    return { success: false, error: 'll2_fetch_failed: ' + (e.message || e) }
  }
  const launches = (data && Array.isArray(data.results)) ? data.results : []
  const nowMs = Date.now()

  // 只处理窗口内、状态已定的发射
  const targets = launches.filter((l) => {
    if (!l || !l.id) return false
    const netMs = Date.parse(l.net || '') || 0
    const age = nowMs - netMs
    return age >= MIN_AGE_MS && age <= MAX_AGE_MS && isSettledStatus(l)
  })
  if (!targets.length) return { success: true, scanned: launches.length, updated: 0 }

  const clipsMap = await matchHighlightClips(db, targets)

  let updated = 0
  let enqueued = 0
  let clipJobs = 0
  const detail = []
  for (const launch of targets) {
    const launchId = String(launch.id)
    const clips = clipsMap.get(launchId) || []
    const links = buildReplayLinks(launch)

    let existing = null
    try {
      const r = await db.collection(REPLAY_RESULT_COL).doc(launchId).get().catch(() => null)
      existing = r && r.data
    } catch (e) {}

    const row = {
      launchId,
      name: launch.name || '',
      clips: clips.length,
      agentClips: (existing && Array.isArray(existing.agentClips)) ? existing.agentClips.length : 0,
      links: links.length,
      rawVidUrls: Array.isArray(launch.vid_urls) ? launch.vid_urls.length : 0
    }
    detail.push(row)

    if (!clips.length && !links.length) {
      row.result = 'skip:empty'
    } else {
      // 已有文档且集锦/外链内容没变则不重写（update 合并写，保留 agentClips/videoUrl 字段）；
      // 按 URL 序列而非数量比较，匹配规则收紧后旧的错误集锦会被自动纠正
      const urlSig = (list, field) => (list || []).map((x) => x && x[field]).join('|')
      const changed = !existing ||
        urlSig(existing.clips, 'videoUrl') !== urlSig(clips, 'videoUrl') ||
        urlSig(existing.links, 'url') !== urlSig(links, 'url')
      if (changed) {
        const patch = {
          launchId,
          missionName: launch.name || '',
          net: launch.net || '',
          status: 'ready',
          clips,
          links,
          updatedAt: nowMs
        }
        try {
          if (existing) {
            await db.collection(REPLAY_RESULT_COL).doc(launchId).update({ data: patch })
          } else {
            await db.collection(REPLAY_RESULT_COL).doc(launchId).set({
              data: { ...patch, agentClips: [], videoUrl: '', createdAt: nowMs }
            })
          }
          updated += 1
          row.result = existing ? 'updated' : 'created'
        } catch (e) {
          row.result = 'write_failed: ' + (e.message || e)
        }
      } else {
        row.result = 'skip:unchanged'
      }
    }

    // 无推文集锦 → 入队 SciNews 集锦抓取（本机 Agent）
    try {
      if (await maybeEnqueueClipJob(db, launch, cfg, existing, clips.length, nowMs)) {
        clipJobs += 1
        row.clipJob = 'enqueued'
      }
    } catch (e) {}

    try {
      if (await maybeEnqueueAgentJob(db, launch, cfg)) enqueued += 1
    } catch (e) {}
  }

  return { success: true, scanned: launches.length, targets: targets.length, updated, enqueued, clipJobs, detail }
}

module.exports = { runSyncMissionReplayQueue }
