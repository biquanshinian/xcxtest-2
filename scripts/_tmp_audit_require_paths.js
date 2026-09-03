/**
 * 小程序侧 require 解析审计
 *
 * 小程序 require 只认 .js：写成 require('x.json') 会被补成 x.json.js，
 * 整个模块加载失败 → 引它的页面 Page() 不注册 → 打开就是黑屏。
 * 这里把所有小程序代码（排除云函数 / scripts / node_modules）的 require 目标解析一遍。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set([
  'node_modules',
  'cloudfunctions',
  'scripts',
  '.git',
  '_error_report_extract',
  'miniprogram_npm'
])

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g
const problems = []
let scanned = 0
let checked = 0

walk(ROOT, []).forEach((file) => {
  scanned += 1
  // 注释里的示例 require 不算数（page-base.js 头部用法说明就有一条）
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
  let m
  while ((m = REQUIRE_RE.exec(src))) {
    const spec = m[2]
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue // npm 包不在此审计范围
    checked += 1
    const base = spec.startsWith('/')
      ? path.join(ROOT, spec)
      : path.resolve(path.dirname(file), spec)
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')

    if (/\.json$/i.test(spec)) {
      problems.push(`${rel} → require('${spec}')：小程序不支持 require .json，改成 .js 并 module.exports`)
      continue
    }
    const candidates = /\.js$/i.test(base) ? [base] : [base + '.js', path.join(base, 'index.js')]
    if (!candidates.some((c) => fs.existsSync(c))) {
      problems.push(`${rel} → require('${spec}')：目标文件不存在`)
    }
  }
})

console.log(`扫描 ${scanned} 个小程序 js 文件，检查 ${checked} 条相对 require`)
if (!problems.length) {
  console.log('PASS：所有 require 都能解析到存在的 .js')
  process.exit(0)
}
console.log(`FAIL ${problems.length} 处：`)
problems.forEach((p) => console.log('  - ' + p))
process.exit(1)
