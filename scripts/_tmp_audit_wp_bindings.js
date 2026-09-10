/**
 * 观礼分包 wxml 事件绑定 ↔ JS 处理器一致性审计
 * 运行：node scripts/_tmp_audit_wp_bindings.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'subpackages', 'watch-party')
const PAGES = ['watch-party', 'merchant', 'merchant-edit', 'merchant-list', 'gacha', 'screen', 'album', 'merchant-reservations', 'merchant-apply']

const behaviorSrc = fs.readFileSync(path.join(ROOT, 'utils', 'composer-input-behavior.js'), 'utf8')

function methodsOf(src) {
  const names = new Set()
  // Page/Behavior 方法：`name(` 或 `name: function` 顶层形式（粗匹配足够）
  const re = /^\s{2,4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(|^\s{2,4}([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function/gm
  let m
  while ((m = re.exec(src))) names.add(m[1] || m[2])
  return names
}

const behaviorMethods = methodsOf(behaviorSrc)
// page-base 常用方法（不逐个解析，列入白名单）
const baseAllow = new Set([
  'goBack', 'onRetry', 'noop', 'preventMove', 'initUiShell', 'syncTheme',
  'onShareAppMessage', 'onShareTimeline'
])
try {
  const baseSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'page-base.js'), 'utf8')
  methodsOf(baseSrc).forEach((n) => baseAllow.add(n))
} catch (e) {}

let problems = 0
for (const page of PAGES) {
  const wxmlPath = path.join(ROOT, page + '.wxml')
  const jsPath = path.join(ROOT, page + '.js')
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const js = fs.readFileSync(jsPath, 'utf8')
  const jsMethods = methodsOf(js)

  const handlers = new Set()
  const re = /\b(?:bind|catch)[:]?([a-z]+)="([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) handlers.add(m[2])

  const missing = [...handlers].filter((h) =>
    !jsMethods.has(h) && !behaviorMethods.has(h) && !baseAllow.has(h)
  )
  if (missing.length) {
    problems += missing.length
    console.log(`✗ ${page}.wxml 缺少处理器: ${missing.join(', ')}`)
  } else {
    console.log(`✓ ${page}: ${handlers.size} 个绑定全部有处理器`)
  }
}

console.log(problems ? `\n共 ${problems} 个问题` : '\n绑定审计通过')
process.exit(problems ? 1 : 0)
