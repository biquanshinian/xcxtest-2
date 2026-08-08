// 一次性代码化：移除所有“卡片”选择器上的边框与阴影（保留 border-radius）。
// 卡片判定：选择器最后一个复合段的类名以 card 结尾（含 --modifier / 伪类伪元素），或为 .monitor-block。
// 排除 custom-tab-bar（tab 栏保留）。用法：node scripts/_tmp_strip_card_borders.js [--apply]
const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'miniprogram_npm', 'admin-web', 'cloudfunctions', 'terminals'])
const SKIP_FILES = [/custom-tab-bar[\\/]/]

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (SKIP_DIRS.has(f)) continue
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (f.endsWith('.wxss')) out.push(p)
  }
  return out
}

// 属性黑名单：border 及其方向/分量（不含 border-radius / box-sizing），以及 box-shadow
const PROP_RE = /^border(?!-radius)(-(top|right|bottom|left|color|width|style|image)(-[a-z]+)?)?$|^box-shadow$/

function selectorIsCard(selector) {
  return selector.split(',').some((sel) => {
    sel = sel.trim()
    if (!sel || sel.startsWith('@')) return false
    // 取最后一个复合段
    const parts = sel.split(/[\s>+~]+/).filter(Boolean)
    let last = parts[parts.length - 1] || ''
    // 去伪元素/伪类（含带括号的）
    last = last.replace(/::?[a-z-]+(\([^)]*\))?/gi, '')
    if (/\.monitor-block(--[\w-]+)?$/.test(last)) return true
    // 类名以 card 结尾（如 .glass-card / .mission-card / .al-card--pressed）
    return /\.[\w-]*card(--[\w-]+)?$/i.test(last) || /\.[\w-]*card(--[\w-]+)?\.[\w-]+$/i.test(last)
  })
}

// 解析：返回待删除的 [start, end) 区间列表（相对整个文件）
function findRemovals(src) {
  const removals = []
  let i = 0
  const n = src.length

  function skipComment() {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      return true
    }
    return false
  }

  function parseBlock() {
    // 处于 { 之后，收集声明或嵌套规则，直到匹配的 }
    let selStart = i
    while (i < n) {
      if (skipComment()) continue
      const c = src[i]
      if (c === '}') { i++; return }
      if (c === '{') {
        const selector = src.slice(selStart, i).trim()
        i++
        if (selector.startsWith('@keyframes') || selector.startsWith('@-')) {
          skipBalanced()
        } else if (selector.startsWith('@')) {
          parseBlock() // @media 等，递归
        } else {
          parseRuleBody(selector)
        }
        selStart = i
      } else {
        i++
      }
    }
  }

  function skipBalanced() {
    let depth = 1
    while (i < n && depth > 0) {
      if (skipComment()) continue
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
  }

  function parseRuleBody(selector) {
    const isCard = selectorIsCard(selector)
    let declStart = i
    while (i < n) {
      if (skipComment()) continue
      const c = src[i]
      if (c === '}') {
        maybeRemove(declStart, i, isCard)
        i++
        return
      }
      if (c === ';') {
        maybeRemove(declStart, i + 1, isCard)
        i++
        declStart = i
      } else if (c === '{') {
        // 意外嵌套（理论不出现），跳过
        i++
        skipBalanced()
        declStart = i
      } else {
        i++
      }
    }
  }

  function maybeRemove(from, to, isCard) {
    if (!isCard) return
    const text = src.slice(from, to)
    const m = text.match(/^\s*([a-zA-Z-]+)\s*:/)
    if (!m) return
    if (PROP_RE.test(m[1].toLowerCase())) {
      // 连同前导空白一起删
      removals.push([from, to])
    }
  }

  parseBlock()
  return removals
}

const files = walk(ROOT, []).filter((f) => !SKIP_FILES.some((re) => re.test(f)))
let totalDecl = 0
const report = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const removals = findRemovals(src)
  if (!removals.length) continue
  totalDecl += removals.length
  report.push(path.relative(ROOT, f) + ': ' + removals.length)
  if (APPLY) {
    let out = ''
    let pos = 0
    for (const [a, b] of removals) {
      out += src.slice(pos, a)
      pos = b
    }
    out += src.slice(pos)
    // 清理成片的空行（3+ 连续换行压成 2）
    out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    fs.writeFileSync(f, out)
  }
}
console.log(report.join('\n'))
console.log((APPLY ? 'APPLIED' : 'DRY-RUN') + ' — files: ' + report.length + ', declarations: ' + totalDecl)
