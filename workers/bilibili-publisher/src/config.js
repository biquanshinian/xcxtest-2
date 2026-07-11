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

export function authDir() {
  return path.join(root, '.auth')
}

export function storageStatePath() {
  return path.join(authDir(), 'storageState.json')
}

export function getConfig() {
  loadEnv()
  return {
    apiBase: String(process.env.BILI_ADMIN_API_BASE || '').replace(/\/$/, ''),
    token: String(process.env.BILI_AGENT_TOKEN || '').trim(),
    pollMs: Math.max(15000, Number(process.env.BILI_POLL_MS || 60000)),
    headed: String(process.env.BILI_HEADED || 'true').toLowerCase() !== 'false'
  }
}
