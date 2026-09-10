/**
 * 观礼分包 iOS 兼容专项扫描
 * 崩溃级：
 *   A. new Date('YYYY-MM-DD ...') 连字符日期串 → iOS JSCore Invalid Date
 *   B. 正则后行断言 (?<= / (?<! → iOS JSCore 语法错误直接崩页面
 *   C. 无参 catch { → 旧转译环境语法错误
 *   D. 新 API：replaceAll / Object.hasOwn / structuredClone / Array.at（基础库不转译）
 * 显示级：
 *   E. wxss position: sticky（scroll-view 内 iOS 表现异常）
 *   F. wxss 100vh 以外的 vh 用法（键盘顶起时 vh 重算跳动）
 *   G. 原生/同层组件（textarea/input/canvas/video）出现在 position:fixed 弹层类下（需人工确认）
 *   H. wxml 里 toLocale* 依赖（iOS 参数支持不全）
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'subpackages', 'watch-party')
let problems = 0
let warns = 0
const bad = (msg) => { problems++; console.log('  ✗ ' + msg) }
const warn = (msg) => { warns++; console.log('  ⚠ ' + msg) }
const ok = (msg) => console.log('  ✓ ' + msg)

const walk = (dir) => {
  let out = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) out = out.concat(walk(p))
    else out.push(p)
  }
  return out
}
const files = walk(DIR)
const jsFiles = files.filter((f) => f.endsWith('.js'))
const wxssFiles = files.filter((f) => f.endsWith('.wxss'))
const wxmlFiles = files.filter((f) => f.endsWith('.wxml'))
const rel = (f) => path.relative(DIR, f)

console.log('── A. iOS 日期解析（连字符串 → Invalid Date）──')
{
  let hit = 0
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/new Date\(\s*['"`][^'"`]*-/.test(line)) { hit++; bad(`${rel(f)}:${i + 1} 日期串含连字符: ${line.trim().slice(0, 90)}`) }
      // new Date(变量) 且变量疑似字符串拼接日期
      if (/new Date\(\s*\w+\.(date|time|launchTime|window|net)\b/i.test(line) && !/Number\(|parseInt|\* 1|getTime/.test(line)) {
        hit++
        warn(`${rel(f)}:${i + 1} new Date(字段) 需确认是时间戳而非字符串: ${line.trim().slice(0, 90)}`)
      }
      if (/Date\.parse\(/.test(line)) { hit++; warn(`${rel(f)}:${i + 1} Date.parse 需确认入参格式: ${line.trim().slice(0, 90)}`) }
    })
  }
  if (!hit) ok('无连字符日期串 / Date.parse 风险')
}

console.log('── B. 正则后行断言（iOS 崩溃）──')
{
  let hit = 0
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/\(\?<[=!]/.test(line)) { hit++; bad(`${rel(f)}:${i + 1} 正则后行断言: ${line.trim().slice(0, 90)}`) }
    })
  }
  if (!hit) ok('无正则后行断言')
}

console.log('── C. 无参 catch（转译兼容）──')
{
  let hit = 0
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/catch\s*\{/.test(line)) { hit++; bad(`${rel(f)}:${i + 1} 无参 catch: ${line.trim().slice(0, 90)}`) }
    })
  }
  if (!hit) ok('无无参 catch')
}

console.log('── D. 新 ES API ──')
{
  let hit = 0
  const apis = [/\.replaceAll\(/, /Object\.hasOwn\(/, /structuredClone\(/, /\.flatMap\(/, /\bglobalThis\b/]
  const names = ['replaceAll', 'Object.hasOwn', 'structuredClone', 'flatMap', 'globalThis']
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      apis.forEach((re, k) => {
        if (re.test(line)) { hit++; warn(`${rel(f)}:${i + 1} ${names[k]}: ${line.trim().slice(0, 90)}`) }
      })
      if (/\.at\(\s*-?\d/.test(line)) { hit++; warn(`${rel(f)}:${i + 1} Array.at: ${line.trim().slice(0, 90)}`) }
    })
  }
  if (!hit) ok('无风险新 API')
}

console.log('── E/F. wxss sticky / vh ──')
{
  let hit = 0
  for (const f of wxssFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/position:\s*sticky/.test(line)) { hit++; warn(`${rel(f)}:${i + 1} sticky（scroll-view 内 iOS 需实测）: ${line.trim().slice(0, 80)}`) }
      const vh = line.match(/([\d.]+)vh/)
      if (vh && vh[1] !== '100') { hit++; warn(`${rel(f)}:${i + 1} 非 100vh 高度（键盘顶起重算跳动）: ${line.trim().slice(0, 80)}`) }
    })
  }
  if (!hit) ok('无 sticky / 非 100vh 用法')
}

console.log('── G. 原生组件 × fixed 弹层 ──')
{
  // 找 fixed 类名，然后在 wxml 中检查这些类的子树里是否有原生组件（粗粒度：同文件同时出现即提示人工确认）
  const fixedClasses = {}
  for (const f of wxssFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const re = /\.([\w-]+)\s*\{[^}]*position:\s*fixed/g
    let m
    while ((m = re.exec(src))) {
      fixedClasses[m[1]] = rel(f)
    }
  }
  let hit = 0
  for (const f of wxmlFiles) {
    const src = fs.readFileSync(f, 'utf8')
    for (const cls of Object.keys(fixedClasses)) {
      if (src.indexOf('class="' + cls) < 0 && src.indexOf(cls + ' ') < 0 && src.indexOf(' ' + cls) < 0) continue
      // 粗略取该类出现位置之后 3000 字符内的原生组件
      const idx = src.indexOf(cls)
      const seg = src.slice(idx, idx + 3000)
      for (const tag of ['<textarea', '<input']) {
        if (seg.indexOf(tag) >= 0) {
          hit++
          warn(`${rel(f)}: fixed 弹层 .${cls} 附近发现 ${tag}（textarea 需 fixed 属性，需人工确认层级）`)
        }
      }
    }
  }
  if (!hit) ok('fixed 弹层内无 textarea/input（canvas 物料码为已知同层 2d，正常）')
}

console.log('── H. toLocale* 用法 ──')
{
  let hit = 0
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/toLocale(Date|Time)?String\(\s*['"[]/.test(line)) { hit++; warn(`${rel(f)}:${i + 1} toLocale* 带参（iOS 支持不全）: ${line.trim().slice(0, 90)}`) }
    })
  }
  if (!hit) ok('无带参 toLocale* 用法')
}

console.log(problems ? `\n结果：${problems} 个问题 / ${warns} 个待确认` : `\n扫描通过：0 崩溃级问题 / ${warns} 个待确认`)
process.exit(problems ? 1 : 0)
