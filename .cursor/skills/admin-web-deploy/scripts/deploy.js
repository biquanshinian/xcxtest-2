#!/usr/bin/env node
/**
 * 后台构建 + CloudBase 静态托管；按需更新 adminGateway（不含 node_modules）。
 * 用法：node .cursor/skills/admin-web-deploy/scripts/deploy.js [--audit] [--fn|--no-fn] [--skip-build]
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '../../../..')
const ADMIN = path.join(ROOT, 'admin-web')
const FN_SRC = path.join(ROOT, 'cloudfunctions', 'adminGateway')
const ENV = 'cloud1-9gdqgdt5bfaa20fb'
const HOST = `https://${ENV}-1397421562.tcloudbaseapp.com`
const TCB = process.platform === 'win32' ? 'tcb.cmd' : 'tcb'
const KNOWN = new Set(['--audit', '--fn', '--no-fn', '--skip-build', '--help', '-h'])

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`后台构建推送（静态托管 + 可选 adminGateway）

用法（仓库根目录）：
  node .cursor/skills/admin-web-deploy/scripts/deploy.js [选项]

选项：
  --audit       先跑 test/tuwen-yewu.test.js 与 scripts/_tmp_audit_tuwen_yewu.js
  --fn          强制更新 adminGateway（本轮改过网关就加）
  --no-fn       只推托管，不更新云函数
  --skip-build  已有 admin-web/dist，只推送
  --help        显示本说明

环境：${ENV}
托管：${HOST}
禁止：git push、上传 node_modules、交互式 tcb fn、并行两个 tcb、仓库里留 cloudbaserc.json`)
  process.exit(0)
}

const unknown = argv.filter((a) => !KNOWN.has(a))
if (unknown.length) {
  console.error(`[admin-web-deploy] 未知参数：${unknown.join(' ')}`)
  process.exit(1)
}

const args = new Set(argv)
const wantAudit = args.has('--audit')
const skipBuild = args.has('--skip-build')
const forceFn = args.has('--fn')
const noFn = args.has('--no-fn')
if (forceFn && noFn) {
  console.error('[admin-web-deploy] --fn 与 --no-fn 不能同时用')
  process.exit(1)
}

function fail(msg) {
  console.error(`[admin-web-deploy] ${msg}`)
  process.exit(1)
}

function run(cmd, cmdArgs, cwd, timeoutMs) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, {
    cwd, stdio: 'inherit', shell: true, env: process.env, timeout: timeoutMs || 0
  })
  if (r.error && r.error.code === 'ETIMEDOUT') fail(`${cmd} 超时（可能卡在 tcb 登录/交互，不要并行再开一个）`)
  if (r.status !== 0) fail(`${cmd} 退出码 ${r.status}`)
}

function runCapture(cmd, cmdArgs, cwd, timeoutMs) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd, encoding: 'utf8', shell: true, env: process.env, timeout: timeoutMs || 0, windowsHide: true
  })
  if (r.error && r.error.code === 'ETIMEDOUT') {
    return { status: 1, out: '命令超时（可能卡在 tcb 登录/交互）。不要并行再开一个 tcb。' }
  }
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function copySlim(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'package-lock.json') continue
    const from = path.join(src, ent.name)
    const to = path.join(dst, ent.name)
    if (ent.isDirectory()) fs.cpSync(from, to, { recursive: true })
    else fs.copyFileSync(from, to)
  }
}

function gatewayChanged() {
  const r = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'cloudfunctions/adminGateway'], {
    cwd: ROOT, encoding: 'utf8', shell: true
  })
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'cloudfunctions/adminGateway'], {
    cwd: ROOT, encoding: 'utf8', shell: true
  })
  const names = `${r.stdout || ''}\n${untracked.stdout || ''}`
  return names.split(/\r?\n/).some((l) => l.trim() && !l.includes('node_modules'))
}

function localEntry() {
  const html = fs.readFileSync(path.join(ADMIN, 'dist', 'index.html'), 'utf8')
  const js = html.match(/\/assets\/index-[^"']+\.js/)
  const css = html.match(/\/assets\/index-[^"']+\.css/)
  if (!js) fail('dist/index.html 没有入口 JS，构建可能失败')
  return { js: js[0], css: css && css[0] }
}

async function verifyHost(entry) {
  const url = `${HOST}/index.html?t=${Date.now()}`
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } })
    const text = await res.text()
    if (!text.includes(entry.js)) {
      console.warn(`[admin-web-deploy] 托管页尚未看到 ${entry.js}（CDN 可能未刷新）`)
      console.warn(`  打开无痕或：curl -H "Cache-Control: no-cache" ${HOST}/`)
      return false
    }
    console.log(`[admin-web-deploy] 托管已指向 ${entry.js}`)
    return true
  } catch (e) {
    console.warn(`[admin-web-deploy] 未能核对托管页：${e.message}`)
    return false
  }
}

if (!fs.existsSync(path.join(ADMIN, 'package.json'))) fail(`找不到 ${ADMIN}`)
if (wantAudit) {
  run('node', ['test/tuwen-yewu.test.js'], ROOT)
  run('node', ['scripts/_tmp_audit_tuwen_yewu.js'], ROOT)
}

if (!skipBuild) run('npm', ['run', 'build'], ADMIN)
if (!fs.existsSync(path.join(ADMIN, 'dist', 'index.html'))) fail('缺少 admin-web/dist/index.html')

const login = runCapture(TCB, ['fn', 'list', '-e', ENV, '--json'], ROOT, 45000)
if (login.status !== 0 || /No valid identity|授权|cli-auth/i.test(login.out)) {
  console.error(login.out)
  fail('CloudBase 未登录。在浏览器完成 tcb 授权后，再执行同一条 deploy.js，不要另开流程。')
}

run(TCB, ['hosting', 'deploy', './dist', '-e', ENV], ADMIN, 10 * 60 * 1000)

const needFn = !noFn && (forceFn || gatewayChanged())
if (needFn) {
  const slim = path.join(os.tmpdir(), 'adminGateway-deploy')
  copySlim(FN_SRC, slim)
  const files = fs.readdirSync(slim)
  if (!files.includes('index.js') || !files.includes('package.json')) fail('精简目录缺 index.js / package.json')
  if (files.includes('node_modules')) fail('精简目录里出现了 node_modules，已中止')
  const fnArgs = ['fn', 'code', 'update', 'adminGateway', '-e', ENV, '--dir', slim, '--json', '--deployMode', 'zip']
  const zip = runCapture(TCB, fnArgs, ROOT, 5 * 60 * 1000)
  process.stdout.write(zip.out)
  if (zip.status !== 0) {
    if (/1\.5MB|ZipFile/i.test(zip.out)) {
      console.log('[admin-web-deploy] ZIP 超限，改 COS 上传')
      run(TCB, ['fn', 'code', 'update', 'adminGateway', '-e', ENV, '--dir', slim, '--json', '--deployMode', 'cos'], ROOT, 5 * 60 * 1000)
    } else {
      fail('adminGateway 更新失败')
    }
  } else {
    console.log('[admin-web-deploy] adminGateway 已更新（仅源码，云端沿用已有依赖）')
  }
} else {
  console.log('[admin-web-deploy] 跳过云函数（无 adminGateway 改动；需要时加 --fn）')
}

const entry = localEntry()
verifyHost(entry).then((ok) => {
  console.log(`\n[admin-web-deploy] 托管：${HOST}`)
  console.log(`[admin-web-deploy] 入口：${entry.js}`)
  process.exit(ok ? 0 : 0)
})
