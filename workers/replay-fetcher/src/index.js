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
import { tokenVariantGroups, hits, scoreClipText } from './clip-match.js'

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

// 下载硬超时：卡死的 yt-dlp 会挂起整个轮询循环（claim 3 小时后被服务端回收再派给
// 自己也没用，进程还堵着），必须整树查杀后向服务端 fail 归还任务
const FULL_DOWNLOAD_TIMEOUT_MS = 90 * 60 * 1000
const CLIP_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const COS_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/** Windows 上 child.kill 杀不掉 yt-dlp 拉起的 ffmpeg 子进程，必须整树查杀 */
function killTree(child) {
  if (!child || !child.pid) return
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }) } catch (e) {}
  } else {
    try { child.kill('SIGKILL') } catch (e) {}
  }
}

// ---- 出口（代理/直连）自动选择 ----------------------------------------------
// REPLAY_PROXY 支持逗号分隔的候选列表（代理 URL 或 'direct'），领到任务时逐个
// 探测能否连通 YouTube，用第一个可用的。主代理挂了自动切备用/直连，不再卡死任务。
const PROXY_PROBE_URL = 'https://www.youtube.com/generate_204'
const PROXY_PROBE_CACHE_MS = 5 * 60 * 1000
let proxyCache = { at: 0, value: null }

/** 用系统 curl 探测某出口能否连通 YouTube（'' = 直连）；Win10+/mac/linux 都自带 curl */
function probeExit(proxy) {
  return new Promise((resolve) => {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const args = ['-sS', '-m', '10', '-o', devNull, '-w', '%{http_code}', PROXY_PROBE_URL]
    if (proxy) args.unshift('-x', proxy)
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => { killTree(child); resolve(false) }, 15000)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { clearTimeout(timer); resolve(false) })
    child.on('exit', () => { clearTimeout(timer); resolve(/^[23]\d\d$/.test(out.trim())) })
  })
}

/** 选出口：探测结果缓存 5 分钟；全挂时回落第一候选，交给服务端退避重试 */
async function pickProxy(cfg) {
  const cands = (cfg.proxies && cfg.proxies.length) ? cfg.proxies : ['direct']
  const now = Date.now()
  if (proxyCache.value !== null && now - proxyCache.at < PROXY_PROBE_CACHE_MS) return proxyCache.value
  for (const c of cands) {
    const proxy = c.toLowerCase() === 'direct' ? '' : c
    if (await probeExit(proxy)) {
      if (proxyCache.value !== proxy) log(`出口探测: 使用 ${proxy || '直连'}`)
      proxyCache = { at: now, value: proxy }
      return proxy
    }
    log(`出口探测: ${proxy || '直连'} 不可用`)
  }
  const first = cands[0].toLowerCase() === 'direct' ? '' : cands[0]
  proxyCache = { at: now, value: first }
  log(`出口探测: 全部不可用，暂用 ${first || '直连'}（等服务端退避重试）`)
  return first
}

/** 任务失败时调用：作废探测缓存，下个任务重新选出口 */
function invalidateProxyCache() {
  proxyCache = { at: 0, value: null }
}

/** 跑 yt-dlp 并捕获 stdout（用于 --print / --flat-playlist 查询类调用） */
function runYtdlpCapture(cfg, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const full = cfg.proxy ? ['--proxy', cfg.proxy, ...args] : args
    const child = spawn(cfg.ytdlpPath, full, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let errOut = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { errOut += d })
    child.on('error', (e) => { clearTimeout(timer); invalidateProxyCache(); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (timedOut) { invalidateProxyCache(); return reject(new Error(`yt-dlp timeout ${Math.round(timeoutMs / 1000)}s`)) }
      if (code === 0) resolve(out)
      else { invalidateProxyCache(); reject(new Error(`yt-dlp exit ${code}: ${errOut.slice(-300)}`)) }
    })
  })
}

/** 跑 yt-dlp 下载（stdout 直通日志），带整树查杀的硬超时 */
function runYtdlpDownload(cfg, args, outFile, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (cfg.ffmpegPath) args = ['--ffmpeg-location', cfg.ffmpegPath, ...args]
    if (cfg.proxy) args = ['--proxy', cfg.proxy, ...args]
    log('yt-dlp', args.join(' '))
    const child = spawn(cfg.ytdlpPath, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); invalidateProxyCache(); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (timedOut) { invalidateProxyCache(); return reject(new Error(`yt-dlp 下载超时（${Math.round(timeoutMs / 60000)} 分钟），已终止`)) }
      if (code === 0 && fs.existsSync(outFile)) resolve()
      else { invalidateProxyCache(); reject(new Error(`yt-dlp exit ${code}`)) }
    })
  })
}

function runYtdlp(cfg, sourceUrl, outFile) {
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
  return runYtdlpDownload(cfg, args, outFile, FULL_DOWNLOAD_TIMEOUT_MS)
}

/** FFMPEG_PATH 可配成目录或 ffmpeg 本体，从中推导同目录的 ffprobe */
function resolveFfprobeCandidates(cfg) {
  const cands = []
  const base = String(cfg.ffmpegPath || '').trim()
  if (base) {
    if (/ffmpeg(\.exe)?$/i.test(base)) {
      cands.push(base.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe')))
    } else {
      cands.push(path.join(base, 'ffprobe.exe'))
      cands.push(path.join(base, 'ffprobe'))
    }
  }
  cands.push('ffprobe')
  return cands
}

function resolveFfmpegBin(cfg) {
  const base = String(cfg.ffmpegPath || '').trim()
  if (!base) return 'ffmpeg'
  if (/ffmpeg(\.exe)?$/i.test(base)) return base
  const exe = path.join(base, 'ffmpeg.exe')
  if (fs.existsSync(exe)) return exe
  return path.join(base, 'ffmpeg')
}

function runFfprobe(bin, file) {
  return new Promise((resolve) => {
    const child = spawn(bin, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file
    ])
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => resolve(null))
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
        resolve(null)
      }
    })
  })
}

/** ffprobe 缺失时的兜底：解析 `ffmpeg -i` stderr 里的 Duration/分辨率 */
function probeWithFfmpeg(cfg, file) {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegBin(cfg), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('error', () => resolve({}))
    child.on('exit', () => {
      const out = {}
      const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (dm) out.durationSec = Math.round(Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]))
      const rm = err.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/)
      if (rm) { out.width = Number(rm[1]); out.height = Number(rm[2]) }
      resolve(out)
    })
  })
}

async function probeVideo(cfg, file) {
  // 读时长/分辨率：ffprobe 优先（FFMPEG_PATH 同目录 → PATH），都没有则用 ffmpeg -i 兜底；
  // 全失败返回空对象不阻塞主流程（只影响时长角标展示）
  for (const bin of resolveFfprobeCandidates(cfg)) {
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) continue
    const meta = await runFfprobe(bin, file)
    if (meta) return meta
  }
  return probeWithFfmpeg(cfg, file)
}

async function uploadToCos(uploadUrl, file) {
  const size = fs.statSync(file).size
  const stream = fs.createReadStream(file)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COS_UPLOAD_TIMEOUT_MS)
  let res
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
      body: stream,
      duplex: 'half',
      signal: controller.signal
    })
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`COS 上传超时（${Math.round(COS_UPLOAD_TIMEOUT_MS / 60000)} 分钟）`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
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
 * 分隔符模糊匹配见 ./clip-match.js（Tianlian-2-06 ↔ TianLian-2 06 等）。
 * @returns {{ url: string, title: string } | null}
 */
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

  // 全发射商场景：同一天可能多家发射，一律拉简介核验；细则见 clip-match.scoreClipText
  let best = null
  let bestScore = 0
  for (const r of candidates.slice(0, 5)) {
    let description = ''
    try {
      description = await runYtdlpCapture(cfg, [
        '--skip-download', '--no-playlist',
        '--print', '%(description)s',
        `https://www.youtube.com/watch?v=${r.id}`
      ], 60000)
    } catch (e) {}
    const scored = scoreClipText(r.title, description, clipSearch)
    if (!scored.ok) continue
    // score 可能为 0（极端空线索）；首次命中也要收下，不能只写 > bestScore
    if (!best || scored.score > bestScore) {
      best = r
      bestScore = scored.score
    }
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
    await runYtdlpDownload(cfg, args, outFile, CLIP_DOWNLOAD_TIMEOUT_MS)
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

/** 清理下载失败残留的临时文件（超过 2 天的 .mp4/.part），防磁盘慢性泄漏 */
function cleanupTmpDir() {
  try {
    const d = tmpDir()
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(d)) {
      const f = path.join(d, name)
      try {
        if (fs.statSync(f).mtimeMs < cutoff) fs.rmSync(f, { force: true })
      } catch (e) {}
    }
  } catch (e) {}
}

async function loop() {
  const cfg = getConfig()
  log(`replay-fetcher 启动 poll=${cfg.pollMs}ms maxHeight=${cfg.maxHeight}p`)
  cleanupTmpDir()
  for (;;) {
    try {
      const data = await claimJob()
      if (data && data.job) {
        cfg.proxy = await pickProxy(cfg)
        try {
          await processJob(cfg, data)
        } catch (e) {
          invalidateProxyCache() // 失败可能是出口问题，下个任务重新探测
          throw e
        }
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

export { findClipVideo, pickProxy, scoreClipText }
