import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

export function loadEnv() {
  const envPath = path.join(root, '.env')
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const i = s.indexOf('=')
      if (i < 0) continue
      const k = s.slice(0, i).trim()
      const v = s.slice(i + 1).trim()
      // 代理列表允许热更新：每次 loadEnv 覆盖 REPLAY_PROXY（端口常随 VPN 客户端变化）
      if (k === 'REPLAY_PROXY' || !(k in process.env)) process.env[k] = v
    }
  }
}

export function tmpDir() {
  const d = path.join(root, 'tmp')
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  return d
}

export function agentRoot() {
  return root
}

export function getConfig() {
  loadEnv()
  return {
    apiBase: String(process.env.REPLAY_ADMIN_API_BASE || process.env.BILI_ADMIN_API_BASE || '').replace(/\/$/, ''),
    token: String(process.env.REPLAY_AGENT_TOKEN || process.env.BILI_AGENT_TOKEN || '').trim(),
    pollMs: Math.max(60000, Number(process.env.REPLAY_POLL_MS || 10 * 60 * 1000)),
    ytdlpPath: String(process.env.YTDLP_PATH || 'yt-dlp').trim(),
    ffmpegPath: String(process.env.FFMPEG_PATH || '').trim(),
    maxHeight: Math.max(240, Number(process.env.REPLAY_MAX_HEIGHT || 480)),
    maxFileMB: Math.max(50, Number(process.env.REPLAY_MAX_FILE_MB || 1024)),
    // 上传前确保 H.264+AAC+faststart（手机相册/剪映/短视频平台兼容）；false 可关以省 CPU
    compatTranscode: String(process.env.REPLAY_COMPAT_TRANSCODE || '1').trim() !== '0',
    // 出口候选列表（逗号分隔，按优先级排列）：代理 URL 或 'direct'（直连）。
    // 每次领到任务时逐个探测连通性，用第一个能通 YouTube 的出口
    proxies: String(process.env.REPLAY_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean),
    // 运行时由 pickProxy 填充的当前出口（'' = 直连）
    proxy: ''
  }
}
