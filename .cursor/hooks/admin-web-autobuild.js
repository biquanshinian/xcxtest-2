/**
 * Cursor hook：admin-web 变更后自动构建 dist
 * - afterFileEdit / afterTabFileEdit：若路径含 admin-web → 打 dirty 标记
 * - stop：本轮 Agent 结束若有 dirty → npm run build（只构建一次）
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const HOOKS_DIR = __dirname
const ROOT = path.resolve(HOOKS_DIR, '../..')
const FLAG = path.join(HOOKS_DIR, '.admin-web-dirty')
const LOG = path.join(HOOKS_DIR, 'admin-web-autobuild.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    fs.appendFileSync(LOG, line)
  } catch (_) {}
  // afterFileEdit/stop 为通知型钩子，stderr 会出现在 Hooks 输出通道
  process.stderr.write(line)
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      data += c
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch (_) {
        resolve({})
      }
    })
    // 空 stdin 兜底（少数环境）
    setTimeout(() => {
      if (!data) resolve({})
    }, 50)
  })
}

function isAdminWebPath(filePath) {
  const n = String(filePath || '').replace(/\\/g, '/')
  return /(^|\/)admin-web\//.test(n) || /(^|\/)admin-web$/.test(n)
}

function markDirty() {
  fs.writeFileSync(FLAG, String(Date.now()), 'utf8')
}

function consumeDirty() {
  if (!fs.existsSync(FLAG)) return false
  try {
    fs.unlinkSync(FLAG)
  } catch (_) {}
  return true
}

function runBuild() {
  log('building admin-web…')
  // Windows 上直接 spawn npm.cmd 可能 EINVAL，需 shell:true
  const r = spawnSync('npm run build', {
    cwd: path.join(ROOT, 'admin-web'),
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
    shell: true
  })
  if (r.error) {
    log(`build FAILED: ${r.error.message}`)
    return 1
  }
  if (r.status !== 0) {
    log(`build FAILED: ${(r.stderr || r.stdout || '').slice(0, 800)}`)
    return 1
  }
  log('build OK → admin-web/dist')
  return 0
}

async function main() {
  const mode = process.argv[2] || 'auto'
  const input = await readStdin()
  const event = String(input.hook_event_name || '')
  const filePath = input.file_path || input.filePath || ''

  if (mode === 'mark' || event === 'afterFileEdit' || event === 'afterTabFileEdit') {
    if (isAdminWebPath(filePath)) {
      markDirty()
      log(`dirty ← ${filePath}`)
    }
    process.exit(0)
  }

  // stop：仅 dirty 时构建；force：无条件构建
  if (mode === 'stop' || mode === 'force' || event === 'stop') {
    const force = mode === 'force'
    if (!force && !consumeDirty()) {
      process.exit(0)
    }
    if (force) consumeDirty()
    process.exit(runBuild())
  }

  // 兼容旧调用：argv build = stop（按 dirty）
  if (mode === 'build') {
    if (!consumeDirty()) process.exit(0)
    process.exit(runBuild())
  }

  // 未知事件但带 admin-web 路径 → 标记
  if (isAdminWebPath(filePath)) {
    markDirty()
    log(`dirty ← ${filePath} (fallback)`)
  }
  process.exit(0)
}

main().catch((e) => {
  log(`hook error: ${e && e.message ? e.message : e}`)
  process.exit(0) // fail-open
})
