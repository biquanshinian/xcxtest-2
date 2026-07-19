/**
 * replay-fetcher Agent 入口 — 发射回放/集锦下载 + COS 直传
 *
 * 两类任务（服务端 kind 字段区分）：
 * - kind=clip：指定博主集锦（SciNews，2~3 分钟）。按 clipSearch 线索（频道 + UTC 日期 + 任务关键词）
 *   在频道最新视频里匹配，下载 ≤480p 后直传 COS（约 10~25MB/段）
 * - kind=full：完整回放。依 LL2 源列表（官方直播优先）下载 ≤480p，2 小时直播约 400~600MB
 *
 * 循环：claim 领任务 → yt-dlp 下载 → PUT 预签 URL 直传 COS → complete 回写
 * 失败 → fail 回报；集锦任务服务端按次数退避重试（视频可能几小时后才发布）。
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { getConfig, tmpDir } from './config.js'
import { claimJob, completeJob, failJob } from './api.js'

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

/** 跑 yt-dlp 并捕获 stdout（用于 --print / --flat-playlist 查询类调用） */
function runYtdlpCapture(cfg, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const full = cfg.proxy ? ['--proxy', cfg.proxy, ...args] : args
    const child = spawn(cfg.ytdlpPath, full, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let errOut = ''
    const timer = setTimeout(() => { try { child.kill() } catch (e) {} }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { errOut += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`yt-dlp exit ${code}: ${errOut.slice(-300)}`))
    })
  })
}

function runYtdlp(cfg, sourceUrl, outFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', `bv*[height<=${cfg.maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${cfg.maxHeight}][ext=mp4]/b[height<=${cfg.maxHeight}]`,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', `${cfg.maxFileMB}M`,
      '--socket-timeout', '30',
      '--retries', '3',
      '-o', outFile,
      sourceUrl
    ]
    if (cfg.ffmpegPath) args.unshift('--ffmpeg-location', cfg.ffmpegPath)
    if (cfg.proxy) args.unshift('--proxy', cfg.proxy)
    log('yt-dlp', args.join(' '))
    const child = spawn(cfg.ytdlpPath, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outFile)) resolve()
      else reject(new Error(`yt-dlp exit ${code}`))
    })
  })
}

function probeVideo(cfg, file) {
  // 可选：ffprobe 读时长/分辨率；未安装时返回空对象不阻塞主流程
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file
    ])
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => resolve({}))
    child.on('exit', () => {
      try {
        const j = JSON.parse(out)
        const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}
        resolve({
          durationSec: Math.round(Number(j.format && j.format.duration) || 0),
          width: Number(v.width || 0),
          height: Number(v.height || 0)
        })
      } catch (e) {
        resolve({})
      }
    })
  })
}

async function uploadToCos(uploadUrl, file) {
  const size = fs.statSync(file).size
  const stream = fs.createReadStream(file)
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: stream,
    duplex: 'half'
  })
  if (!res.ok) throw new Error(`COS PUT ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return size
}

/**
 * kind=clip：在指定频道最新视频里按「UTC 日期 + 任务关键词」匹配集锦
 *
 * SciNews 标题两种形态（实测）：
 * - 星链常规发射：标题带日期，如 "SpaceX Starlink 407 launch and Falcon 9 first stage landing, 14 July 2026"
 * - 专项任务：标题不带日期，如 "SDA T1TL-E launch and Falcon 9 first stage landing"，日期在简介里
 * 所以：标题带日期的直接筛；不带日期但命中任务关键词的，拉简介验证日期。
 * @returns {{ url: string, title: string } | null}
 */
// 尾缀罗马数字 ↔ 阿拉伯数字互转变体（LL2 "Vikram-I" vs 频道标题 "Vikram-1"），
// 一个 token 及其变体算一组，组内任一变体命中即算该 token 命中
const ROMAN_SUFFIX = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }
function tokenVariantGroups(list) {
  return list.map((t) => {
    const group = [t]
    const m = t.match(/^(.*[-\s])(i{1,3}|iv|v|vi{0,3}|ix|x)$/)
    if (m && ROMAN_SUFFIX[m[2]]) group.push(m[1] + ROMAN_SUFFIX[m[2]])
    const n = t.match(/^(.*[-\s])(\d{1,2})$/)
    if (n) {
      const roman = Object.keys(ROMAN_SUFFIX).find((k) => ROMAN_SUFFIX[k] === n[2])
      if (roman) group.push(n[1] + roman)
    }
    return group
  })
}

async function findClipVideo(cfg, clipSearch) {
  const channel = clipSearch.channel
  const dateText = String(clipSearch.dateText || '').toLowerCase()
  const tokens = tokenVariantGroups((clipSearch.tokens || []).map((t) => String(t).toLowerCase()))
  const rocketTokens = tokenVariantGroups((clipSearch.rocketTokens || []).map((t) => String(t).toLowerCase()))
  if (!channel || !dateText) return null

  const out = await runYtdlpCapture(cfg, [
    '--flat-playlist',
    '--playlist-end', '30',
    '--print', '%(id)s\t%(duration)s\t%(title)s',
    channel
  ])
  const rows = out.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split('\t')
    if (parts.length < 3) return null
    return {
      id: parts[0].trim(),
      durationSec: Math.round(Number(parts[1])) || 0,
      title: parts.slice(2).join('\t').trim()
    }
  }).filter(Boolean)

  const maxDurSec = Number(clipSearch.maxDurationSec || 300) + 30
  const hits = (groups, text) => groups.reduce((n, g) => n + (g.some((v) => text.includes(v)) ? 1 : 0), 0)
  // 带数字的特征 token（10-45 / t1tl-e / 火箭型号 10b）：存在时必须命中，是同日多发的硬区分
  const specificTokens = tokens.filter((g) => g.some((v) => /\d/.test(v)))
  const specificRocketTokens = rocketTokens.filter((g) => g.some((v) => /\d/.test(v)))

  // 候选：时长合规，且标题带日期，或标题含 launch 且命中任一任务/火箭关键词
  const pre = rows.filter((r) => (!r.durationSec || r.durationSec <= maxDurSec))
  const dateInTitle = pre.filter((r) => r.title.toLowerCase().includes(dateText))
  const needVerify = pre.filter((r) => {
    const t = r.title.toLowerCase()
    return !t.includes(dateText) && /launch/i.test(r.title) &&
      (hits(tokens, t) > 0 || hits(rocketTokens, t) > 0)
  })
  const candidates = dateInTitle.concat(needVerify.slice(0, 3))
  if (!candidates.length) return null

  // 全发射商场景：同一天可能多家发射，一律拉简介核验，宁缺毋滥
  let best = null
  let bestScore = 0
  for (const r of candidates.slice(0, 5)) {
    const titleLower = r.title.toLowerCase()
    let text = titleLower
    let dateOk = titleLower.includes(dateText)
    try {
      const desc = (await runYtdlpCapture(cfg, [
        '--skip-download', '--no-playlist',
        '--print', '%(description)s',
        `https://www.youtube.com/watch?v=${r.id}`
      ], 60000)).toLowerCase()
      text += ' ' + desc
      if (!dateOk) dateOk = desc.includes(dateText)
    } catch (e) {}
    if (!dateOk) continue                                        // 日期对不上一票否决
    if (tokens.length && hits(tokens, text) === 0) continue      // 任务段关键词必须命中
    if (specificTokens.length && hits(specificTokens, text) === 0) continue // 任务特征编号必须命中
    if (!tokens.length && specificRocketTokens.length && hits(specificRocketTokens, text) === 0) continue // 无任务词时火箭型号必须命中
    const score = hits(tokens, text) * 2 + hits(rocketTokens, text)
    if (score > bestScore) { best = r; bestScore = score }
  }
  if (!best) return null
  return { url: `https://www.youtube.com/watch?v=${best.id}`, title: best.title }
}

/** kind=clip：匹配 → 下载 ≤480p 短片 → 直传 COS → complete 回写 agentClips */
async function processClipJob(cfg, data) {
  const { job, upload } = data
  const clipSearch = job.clipSearch || {}
  const outFile = path.join(tmpDir(), `clip_${job.launchId}.mp4`)
  try { fs.rmSync(outFile, { force: true }) } catch (e) {}

  let video = null
  try {
    video = await findClipVideo(cfg, clipSearch)
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_search_failed: ${e.message}` })
    return
  }
  if (!video) {
    // 视频可能还没发布：非终态失败，服务端退避后重试
    await failJob({ id: job.id, claimToken: job.claimToken, error: 'clip_not_found_yet' })
    return
  }

  const maxDur = Number(clipSearch.maxDurationSec || 300) + 30
  try {
    log(`集锦下载 [${clipSearch.publisher || 'clip'}] ${video.title}`)
    await new Promise((resolve, reject) => {
      const args = [
        '-f', `bv*[height<=${cfg.maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${cfg.maxHeight}][ext=mp4]/b[height<=${cfg.maxHeight}]`,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--match-filter', `duration <= ${maxDur}`,
        '--max-filesize', '200M',
        '--socket-timeout', '30',
        '--retries', '3',
        '-o', outFile,
        video.url
      ]
      if (cfg.ffmpegPath) args.unshift('--ffmpeg-location', cfg.ffmpegPath)
      if (cfg.proxy) args.unshift('--proxy', cfg.proxy)
      const child = spawn(cfg.ytdlpPath, args, { stdio: ['ignore', 'inherit', 'inherit'] })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0 && fs.existsSync(outFile)) resolve()
        else reject(new Error(`yt-dlp exit ${code}${code === 0 ? ' (被 duration 过滤拦下?)' : ''}`))
      })
    })
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_download_failed: ${e.message}` })
    return
  }

  const meta = await probeVideo(cfg, outFile)
  log(`集锦上传 COS: ${upload.cosKey} (${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB)`)
  let sizeBytes = 0
  try {
    sizeBytes = await uploadToCos(upload.uploadUrl, outFile)
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `cos_upload_failed: ${e.message}` })
    return
  } finally {
    try { fs.rmSync(outFile, { force: true }) } catch (e) {}
  }

  await completeJob({
    id: job.id,
    claimToken: job.claimToken,
    cosUrl: upload.cosUrl,
    sizeBytes,
    durationSec: meta.durationSec || 0,
    sourceTitle: video.title,
    sourcePageUrl: video.url,
    sourceUsed: { url: video.url, type: 'clip', publisher: clipSearch.publisher || 'SciNews' }
  })
  log(`集锦完成: ${job.missionName} → ${upload.cosUrl}`)
}

async function processJob(cfg, data) {
  const { job, upload } = data
  if (job.kind === 'clip') return processClipJob(cfg, data)
  const outFile = path.join(tmpDir(), `${job.launchId}.mp4`)
  try { fs.rmSync(outFile, { force: true }) } catch (e) {}

  let sourceUsed = null
  let lastErr = null
  for (const src of job.sources || []) {
    try {
      log(`下载 [${src.type}] ${src.publisher}: ${src.url}`)
      await runYtdlp(cfg, src.url, outFile)
      sourceUsed = src
      break
    } catch (e) {
      lastErr = e
      log(`源失败: ${e.message}`)
      try { fs.rmSync(outFile, { force: true }) } catch (e2) {}
    }
  }
  if (!sourceUsed) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `all_sources_failed: ${lastErr ? lastErr.message : 'no source'}` })
    return
  }

  const meta = await probeVideo(cfg, outFile)
  log(`上传 COS: ${upload.cosKey} (${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB)`)
  let sizeBytes = 0
  try {
    sizeBytes = await uploadToCos(upload.uploadUrl, outFile)
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `cos_upload_failed: ${e.message}` })
    return
  } finally {
    try { fs.rmSync(outFile, { force: true }) } catch (e) {}
  }

  await completeJob({
    id: job.id,
    claimToken: job.claimToken,
    cosUrl: upload.cosUrl,
    sizeBytes,
    durationSec: meta.durationSec || 0,
    width: meta.width || 0,
    height: meta.height || 0,
    sourceUsed: { url: sourceUsed.url, type: sourceUsed.type, publisher: sourceUsed.publisher }
  })
  log(`完成: ${job.missionName} → ${upload.cosUrl}`)
}

async function loop() {
  const cfg = getConfig()
  log(`replay-fetcher 启动 poll=${cfg.pollMs}ms maxHeight=${cfg.maxHeight}p`)
  for (;;) {
    try {
      const data = await claimJob()
      if (data && data.job) {
        await processJob(cfg, data)
        continue // 有任务时不等轮询间隔，立即领下一条
      }
    } catch (e) {
      log('轮询/处理异常:', e.message)
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs))
  }
}

// 直接运行时才进主循环；被 import 时只导出（便于单测匹配逻辑）
const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href
if (isMain) loop()

export { findClipVideo }
