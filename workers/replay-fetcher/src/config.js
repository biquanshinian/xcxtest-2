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
      if (!(k in process.env)) process.env[k] = v
    }
  }
}

export function tmpDir() {
  const d = path.join(root, 'tmp')
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  return d
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
    proxy: String(process.env.REPLAY_PROXY || '').trim()
  }
}
