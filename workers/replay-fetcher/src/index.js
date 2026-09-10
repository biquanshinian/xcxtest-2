/**
 * replay-fetcher Agent 入口 — 发射回放/集锦下载 + COS 直传
 *
 * 两类任务（服务端 kind 字段区分）：
 * - kind=clip：指定博主集锦（SciNews，2~3 分钟）。按 clipSearch 线索（频道 + UTC 日期 + 任务关键词）
 *   在频道最新视频里匹配，下载 ≤480p → 兼容转码 → 直传 COS（约 10~25MB/段）
 * - kind=full：完整回放。依 LL2 源列表（官方直播优先）下载 ≤480p，2 小时直播约 400~600MB
 *
 * 循环：claim 领任务 → yt-dlp 下载 → 兼容封装(H.264+AAC+faststart) → PUT 预签 URL 直传 COS → complete 回写
 * 失败 → fail 回报；集锦任务服务端按次数退避重试（视频可能几小时后才发布）。
 */
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { spawn } from 'child_process'
import { getConfig, tmpDir, agentRoot } from './config.js'
import { claimJob, completeJob, failJob, nudgeQueue } from './api.js'
import {
  tokenVariantGroups,
  hits,
  scoreClipText,
  parseUploadDateMs,
  pickBestClipCandidate,
  dateTextCandidates,
  usableMatchTokens
} from './clip-match.js'
import { buildProxyCandidates } from './proxy-discover.js'

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

// 下载硬超时：卡死的 yt-dlp 会挂起整个轮询循环（claim 3 小时后被服务端回收再派给
// 自己也没用，进程还堵着），必须整树查杀后向服务端 fail 归还任务
const FULL_DOWNLOAD_TIMEOUT_MS = 90 * 60 * 1000
const CLIP_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const CLIP_COMPAT_TIMEOUT_MS = 20 * 60 * 1000
const FULL_COMPAT_TIMEOUT_MS = 90 * 60 * 1000
const COS_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/**
 * yt-dlp 格式串：优先 AVC(H.264)+m4a，避免 VP9/AV1 进 mp4 导致手机相册/剪映不认。
 * 仍保留非 AVC 兜底，下载后由 ensureCompatMp4 转码。
 */
function ytdlpFormatSelector(maxHeight) {
  const h = maxHeight
  return [
    `bv*[height<=${h}][ext=mp4][vcodec^=avc]+ba[ext=m4a]`,
    `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]`,
    `b[height<=${h}][ext=mp4][vcodec^=avc]`,
    `b[height<=${h}][ext=mp4]`,
    `b[height<=${h}]`
  ].join('/')
}

/** 403 时用的宽松格式（不强制 AVC，下载后再兼容转码） */
function ytdlpFormatSelectorLoose(maxHeight) {
  const h = maxHeight
  return [
    `bv*[height<=${h}]+ba/b[height<=${h}]`,
    `bv*+ba/b`
  ].join('/')
}

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
// 1) REPLAY_PROXY 配置优先  2) 扫本机常见代理口（7890/10808…）  3) 直连
// 成功出口缓存 5 分钟；全挂不缓存死端口，下轮任务继续自动扫，避免「端口变了就不动」。
const PROXY_PROBE_URL = 'https://www.youtube.com/generate_204'
const PROXY_PROBE_CACHE_MS = 5 * 60 * 1000
let proxyCache = { at: 0, value: null, failed: false }

/** 用系统 curl 探测某出口能否连通 YouTube（'' = 直连）；Win10+/mac/linux 都自带 curl */
function probeExit(proxy) {
  return new Promise((resolve) => {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const args = ['-sS', '-m', '5', '-o', devNull, '-w', '%{http_code}', PROXY_PROBE_URL]
    if (proxy) args.unshift('-x', proxy)
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => { killTree(child); resolve(false) }, 8000)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { clearTimeout(timer); resolve(false) })
    child.on('exit', () => { clearTimeout(timer); resolve(/^[23]\d\d$/.test(out.trim())) })
  })
}

/** 选出口：配置 + 本机自动发现；只缓存成功结果 */
async function pickProxy(cfg) {
  const now = Date.now()
  if (
    !proxyCache.failed &&
    proxyCache.value !== null &&
    now - proxyCache.at < PROXY_PROBE_CACHE_MS
  ) {
    return proxyCache.value
  }

  const { candidates, discoveredPorts } = await buildProxyCandidates(cfg.proxies || [])
  if (discoveredPorts.length) {
    log(`出口扫描: 本机监听 ${discoveredPorts.join(',')}`)
  } else {
    log('出口扫描: 未发现本机常见代理口，将试配置项与直连')
  }

  for (const c of candidates) {
    const proxy = c.toLowerCase() === 'direct' ? '' : c
    if (await probeExit(proxy)) {
      if (proxyCache.value !== proxy || proxyCache.failed) {
        log(`出口探测: 使用 ${proxy || '直连'}`)
      }
      proxyCache = { at: now, value: proxy, failed: false }
      return proxy
    }
    log(`出口探测: ${proxy || '直连'} 不可用`)
  }

  // 全挂：不缓存坏端口，下个 claim 重新扫（VPN 后开/换端口也能跟上）
  proxyCache = { at: now, value: '', failed: true }
  log('出口探测: 全部不可用（已含本机自动扫端口）；下轮任务将重新扫描')
  return ''
}

/**
 * 开机/VPN 后开：在真正领任务前阻塞等待出口就绪，避免空烧 attempts、卡数小时退避。
 * 每 20s 自动扫本机代理口；VPN 一开立即继续。
 */
async function waitForProxyReady(cfg) {
  const intervalMs = 20 * 1000
  let n = 0
  for (;;) {
    invalidateProxyCache()
    const proxy = await pickProxy(cfg)
    if (!proxyCache.failed) {
      if (n > 0) log(`VPN/代理已就绪: ${proxy || '直连'}（等待了 ${n} 轮）`)
      return proxy
    }
    n += 1
    if (n === 1 || n % 3 === 0) {
      log(`等待 VPN/代理…（已轮询 ${n} 次，请保持规则模式开启；将自动搜索本地端口）`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** 任务失败时调用：作废探测缓存，下个任务重新选出口 */
function invalidateProxyCache() {
  proxyCache = { at: 0, value: null, failed: false }
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
    '-f', ytdlpFormatSelector(cfg.maxHeight),
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
        const streams = j.streams || []
        const v = streams.find((s) => s.codec_type === 'video') || {}
        const a = streams.find((s) => s.codec_type === 'audio') || {}
        resolve({
          durationSec: Math.round(Number(j.format && j.format.duration) || 0),
          width: Number(v.width || 0),
          height: Number(v.height || 0),
          videoCodec: String(v.codec_name || '').toLowerCase(),
          audioCodec: String(a.codec_name || '').toLowerCase(),
          pixFmt: String(v.pix_fmt || '').toLowerCase()
        })
      } catch (e) {
        resolve(null)
      }
    })
  })
}

/** ffprobe 缺失时的兜底：解析 `ffmpeg -i` stderr 里的 Duration/分辨率/编码 */
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
      const vm = err.match(/Video:\s*([a-zA-Z0-9_]+)/)
      if (vm) out.videoCodec = String(vm[1]).toLowerCase()
      const am = err.match(/Audio:\s*([a-zA-Z0-9_]+)/)
      if (am) out.audioCodec = String(am[1]).toLowerCase()
      const pm = err.match(/Video:[^\n]*?\b(yuv\w+)\b/i)
      if (pm) out.pixFmt = String(pm[1]).toLowerCase()
      resolve(out)
    })
  })
}

async function probeVideo(cfg, file) {
  // 读时长/分辨率/编码：ffprobe 优先（FFMPEG_PATH 同目录 → PATH），都没有则用 ffmpeg -i 兜底；
  // 全失败返回空对象不阻塞主流程（只影响时长角标展示）
  for (const bin of resolveFfprobeCandidates(cfg)) {
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) continue
    const meta = await runFfprobe(bin, file)
    if (meta) return meta
  }
  return probeWithFfmpeg(cfg, file)
}

/** 手机相册 / 剪映 / 主流短视频平台可认的封装：H.264 + AAC + yuv420p */
function isCompatMp4(meta) {
  const v = String((meta && meta.videoCodec) || '').toLowerCase()
  const a = String((meta && meta.audioCodec) || '').toLowerCase()
  const pix = String((meta && meta.pixFmt) || '').toLowerCase()
  const vOk = v === 'h264' || v === 'avc' || v === 'avc1'
  // 无音轨也视为可接受（少数源无声）；有音轨则必须 aac
  const aOk = !a || a === 'aac'
  const pixOk = !pix || pix === 'yuv420p'
  return vOk && aOk && pixOk
}

function runFfmpeg(cfg, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpegBin(cfg)
    log('ffmpeg', args.join(' '))
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'inherit'] })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`ffmpeg 启动失败: ${e.message}（请配置 FFMPEG_PATH 或加入 PATH）`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`ffmpeg 超时（${Math.round(timeoutMs / 60000)} 分钟）`))
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}`))
    })
  })
}

/** 启动时校验：兼容开关打开则必须能跑 ffmpeg + libx264（否则宁可不抓，也不产出相册打不开的片） */
async function assertFfmpegReady(cfg) {
  if (!cfg.compatTranscode) {
    log('警告: REPLAY_COMPAT_TRANSCODE=0，上传文件可能无法被手机相册/剪映/短视频平台打开')
    return
  }
  const bin = resolveFfmpegBin(cfg)
  if (path.isAbsolute(bin) && !fs.existsSync(bin)) {
    throw new Error(`ffmpeg 不存在: ${bin}（请修正 FFMPEG_PATH）`)
  }
  await new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { killTree(child); reject(new Error('ffmpeg -encoders 超时')) }, 15000)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`ffmpeg 启动失败: ${e.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`ffmpeg -encoders exit ${code}`))
      if (!/libx264/i.test(out)) return reject(new Error('ffmpeg 缺少 libx264 编码器'))
      if (!/\baac\b/i.test(out)) return reject(new Error('ffmpeg 缺少 aac 编码器'))
      resolve()
    })
  })
  log(`ffmpeg 就绪: ${bin}（libx264+aac，相册/短视频兼容转码已启用）`)
}

/**
 * 上传前保证兼容 mp4：已是 H.264+AAC 则 copy +faststart；否则 libx264/aac 转码。
 * 原地替换 inFile。兼容处理失败时抛错（避免把剪映打不开的文件推上 COS）。
 */
async function ensureCompatMp4(cfg, inFile, timeoutMs) {
  if (!cfg.compatTranscode) return
  if (!fs.existsSync(inFile)) throw new Error('compat_input_missing')

  const meta = await probeVideo(cfg, inFile)
  const outFile = inFile.replace(/\.mp4$/i, '') + '_compat.mp4'
  try { fs.rmSync(outFile, { force: true }) } catch (e) {}

  const alreadyOk = isCompatMp4(meta)
  if (alreadyOk) {
    log(`兼容封装: 已是 ${meta.videoCodec || '?'}/${meta.audioCodec || 'noaudio'}，重封装 +faststart`)
    await runFfmpeg(cfg, [
      '-y', '-i', inFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      outFile
    ], timeoutMs)
  } else {
    log(`兼容转码: ${meta.videoCodec || '?'}/${meta.audioCodec || '?'} → h264/aac`)
    // 0:a:0? = 无音轨时不失败；有音轨则统一转 aac
    await runFfmpeg(cfg, [
      '-y', '-i', inFile,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-profile:v', 'main',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      outFile
    ], timeoutMs)
  }

  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
    try { fs.rmSync(outFile, { force: true }) } catch (e) {}
    throw new Error('compat_output_invalid')
  }
  fs.rmSync(inFile, { force: true })
  fs.renameSync(outFile, inFile)

  // 二次校验：转完仍不兼容则拒绝上传，绝不把坏片推给用户
  const after = await probeVideo(cfg, inFile)
  if (!isCompatMp4(after)) {
    throw new Error(`compat_verify_failed: ${after.videoCodec || '?'}/${after.audioCodec || '?'}/${after.pixFmt || '?'}`)
  }
  log(`兼容校验通过: ${after.videoCodec}/${after.audioCodec || 'noaudio'} ${after.width || '?'}x${after.height || '?'}`)
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
  const dateOpts = dateTextCandidates(dateText)
  const tokens = tokenVariantGroups(usableMatchTokens(clipSearch.tokens || []).map((t) => String(t).toLowerCase()))
  const rocketTokens = tokenVariantGroups((clipSearch.rocketTokens || []).map((t) => String(t).toLowerCase()))
  if (!channel || !dateText) return null
  const netMs = Number(clipSearch.netMs) || 0
  const titleHasDate = (title) => {
    const t = String(title || '').toLowerCase()
    return dateOpts.some((d) => t.includes(d))
  }

  const out = await runYtdlpCapture(cfg, [
    '--flat-playlist',
    '--playlist-end', '30',
    // upload_date：模糊匹配同日多候选时按接近发射时间挑
    '--print', '%(id)s\t%(duration)s\t%(upload_date)s\t%(title)s',
    channel
  ])
  const rows = out.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split('\t')
    if (parts.length < 4) return null
    return {
      id: parts[0].trim(),
      durationSec: Math.round(Number(parts[1])) || 0,
      uploadDate: parts[2].trim(),
      title: parts.slice(3).join('\t').trim()
    }
  }).filter(Boolean)

  const maxDurSec = Number(clipSearch.maxDurationSec || 300) + 30

  // 候选：时长合规，且标题带日期（含近邻日），或标题含 launch 且命中任一任务/火箭关键词
  const pre = rows.filter((r) => (!r.durationSec || r.durationSec <= maxDurSec))
  const dateInTitle = pre.filter((r) => titleHasDate(r.title))
  const needVerify = pre.filter((r) => {
    const t = r.title.toLowerCase()
    return !titleHasDate(r.title) && /launch/i.test(r.title) &&
      (hits(tokens, t) > 0 || hits(rocketTokens, t) > 0)
  })
  const candidates = dateInTitle.concat(needVerify.slice(0, 3))
  if (!candidates.length) return null

  // 全发射商场景：同一天可能多家发射，一律拉简介核验；细则见 clip-match.scoreClipText
  // 精细失败时走 fuzzy（家族词+火箭+日期），再按 upload≈net 挑最近
  const scoredItems = []
  for (const r of candidates.slice(0, 8)) {
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
    scoredItems.push({
      r,
      scored,
      uploadMs: parseUploadDateMs(r.uploadDate)
    })
  }
  const bestItem = pickBestClipCandidate(scoredItems, netMs)
  if (!bestItem) return null
  const best = bestItem.r
  if (bestItem.scored.fuzzy && !bestItem.scored.strict) {
    log(`集锦模糊匹配 [${clipSearch.publisher || 'clip'}] ${best.title}`)
  }
  return { url: `https://www.youtube.com/watch?v=${best.id}`, title: best.title }
}

/** kind=clip：匹配 → 下载 ≤480p 短片 → 直传 COS → complete 回写 agentClips */
async function processClipJob(cfg, data) {
  const { job, upload } = data
  const clipSearch = { ...(job.clipSearch || {}) }
  // 接近时间匹配：优先 clipSearch.netMs，否则用任务 net
  if (!Number(clipSearch.netMs)) {
    const fromJob = Date.parse(job.net || '') || 0
    if (fromJob) clipSearch.netMs = fromJob
  }
  const outFile = path.join(tmpDir(), `clip_${job.launchId}.mp4`)
  try { fs.rmSync(outFile, { force: true }) } catch (e) {}

  log(`集锦匹配开始: ${job.missionName || job.launchId} date=${clipSearch.dateText || '?'} tokens=${(clipSearch.tokens || []).join(',')}`)
  let video = null
  try {
    video = await findClipVideo(cfg, clipSearch)
  } catch (e) {
    log(`集锦匹配异常: ${e.message}`)
    await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_search_failed: ${e.message}` })
    return
  }
  if (!video) {
    // 视频可能还没发布：非终态失败，服务端退避后重试
    log(`集锦未匹配: ${job.missionName || job.launchId}（clip_not_found_yet）`)
    await failJob({ id: job.id, claimToken: job.claimToken, error: 'clip_not_found_yet' })
    return
  }

  const maxDur = Number(clipSearch.maxDurationSec || 300) + 30
  const buildDlArgs = (fmt) => [
    '-f', fmt,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--match-filter', `duration <= ${maxDur}`,
    '--max-filesize', '200M',
    '--socket-timeout', '30',
    '--retries', '3',
    '-o', outFile,
    video.url
  ]
  try {
    log(`集锦下载 [${clipSearch.publisher || 'clip'}] ${video.title}`)
    await runYtdlpDownload(cfg, buildDlArgs(ytdlpFormatSelector(cfg.maxHeight)), outFile, CLIP_DOWNLOAD_TIMEOUT_MS)
  } catch (e) {
    const msg = String(e.message || e)
    // YouTube 偶发 403：换宽松格式 + 重选出口再试一次，减少人工介入
    if (/403|forbidden/i.test(msg)) {
      log(`集锦下载 403，自动换格式/出口重试: ${video.title}`)
      try { fs.rmSync(outFile, { force: true }) } catch (e2) {}
      invalidateProxyCache()
      cfg.proxy = await pickProxy(cfg)
      try {
        await runYtdlpDownload(cfg, buildDlArgs(ytdlpFormatSelectorLoose(cfg.maxHeight)), outFile, CLIP_DOWNLOAD_TIMEOUT_MS)
      } catch (e2) {
        await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_download_failed: 403/forbidden ${e2.message}` })
        return
      }
    } else {
      await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_download_failed: ${msg}` })
      return
    }
  }

  try {
    await ensureCompatMp4(cfg, outFile, CLIP_COMPAT_TIMEOUT_MS)
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `clip_compat_failed: ${e.message}` })
    try { fs.rmSync(outFile, { force: true }) } catch (e2) {}
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

  try {
    await ensureCompatMp4(cfg, outFile, FULL_COMPAT_TIMEOUT_MS)
  } catch (e) {
    await failJob({ id: job.id, claimToken: job.claimToken, error: `compat_failed: ${e.message}` })
    try { fs.rmSync(outFile, { force: true }) } catch (e2) {}
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

function writeAgentPid() {
  try {
    const dir = path.join(agentRoot(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const pidFile = path.join(dir, 'agent.pid')
    fs.writeFileSync(pidFile, String(process.pid))
    const clear = () => { try { fs.rmSync(pidFile, { force: true }) } catch (e) {} }
    process.on('exit', clear)
    process.on('SIGINT', () => { clear(); process.exit(0) })
    process.on('SIGTERM', () => { clear(); process.exit(0) })
  } catch (e) {}
}

/** 给 watchdog 看的心跳：事件循环还在转就持续刷新，卡死/进程没了会被拉起 */
function writeHeartbeat() {
  try {
    const dir = path.join(agentRoot(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'agent.heartbeat'), `${Date.now()}\n${process.pid}\n`)
  } catch (e) {}
}

function startHeartbeat() {
  writeHeartbeat()
  const timer = setInterval(writeHeartbeat, 15 * 1000)
  if (timer && typeof timer.unref === 'function') timer.unref()
}

async function loop() {
  writeAgentPid()
  startHeartbeat()
  const cfg = getConfig()
  log(`replay-fetcher 启动 poll=${cfg.pollMs}ms maxHeight=${cfg.maxHeight}p compat=${cfg.compatTranscode ? 'on' : 'off'}`)
  log('自愈策略: 心跳+watchdog 保活 → 自动扫代理口 → VPN 未开则等待不领任务 → 空队列 nudge → 下载 403 自动重试')
  await assertFfmpegReady(cfg)
  cleanupTmpDir()
  let lastNudgeAt = 0
  for (;;) {
    try {
      // 先等出口：开机后 VPN 晚开也不烧 attempts
      cfg.proxy = await waitForProxyReady(cfg)

      let data = await claimJob()
      // 空领：清退避 / 复活 failed（adminGateway nudge-queue）
      if ((!data || !data.job) && Date.now() - lastNudgeAt > 10 * 60 * 1000) {
        try {
          const nudged = await nudgeQueue({ resetAttempts: true })
          lastNudgeAt = Date.now()
          log(`队列 nudge: nudged=${nudged && nudged.nudged} revived=${nudged && nudged.revived}`)
          data = await claimJob()
        } catch (e) {
          lastNudgeAt = Date.now()
          if (!/未知 Agent 路由|4040/.test(String(e.message || ''))) {
            log('队列 nudge 失败:', e.message)
          }
        }
      }
      if (data && data.job) {
        // 领到任务后再确认一次出口（长等待后 VPN 可能已换端口）
        invalidateProxyCache()
        cfg.proxy = await pickProxy(cfg)
        if (proxyCache.failed) {
          log('领到任务但出口又不可用，短退避归还并等待 VPN')
          try {
            await failJob({
              id: data.job.id,
              claimToken: data.job.claimToken,
              error: 'proxy_unavailable_retry'
            })
          } catch (e) {}
          continue
        }
        try {
          await processJob(cfg, data)
        } catch (e) {
          invalidateProxyCache()
          throw e
        }
        continue
      }
    } catch (e) {
      log('轮询/处理异常:', e.message)
      invalidateProxyCache()
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs))
  }
}


// 直接运行时才进主循环；被 import 时只导出（便于单测匹配逻辑）
const isMain = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  } catch (e) {
    return false
  }
})()

async function main() {
  process.on('uncaughtException', (e) => {
    log('uncaughtException:', (e && e.stack) || e)
  })
  process.on('unhandledRejection', (e) => {
    log('unhandledRejection:', (e && e.stack) || e)
  })
  for (;;) {
    try {
      await loop()
      log('主循环意外返回，15s 后重启')
    } catch (e) {
      log('主循环崩溃，15s 后重启:', (e && e.stack) || e)
    }
    await new Promise((r) => setTimeout(r, 15000))
  }
}

if (isMain) main()

export { findClipVideo, pickProxy, scoreClipText, isCompatMp4, ytdlpFormatSelector, waitForProxyReady }
