// 第二遍：按显式类名清单移除卡片容器的边框/阴影（这些容器不以 -card 命名）。
// 用法：node scripts/_tmp_strip_card_borders2.js [--apply]
const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'miniprogram_npm', 'admin-web', 'cloudfunctions', 'terminals'])

// 全局卡片类名（任意文件生效）
const GLOBAL_CLASSES = [
  'detail-section', 'detail-block', 'mission-sim-entry',
  'landing-stats', 'landing-breakdown', 'timeline-section',
  'stats-bar', 'benefit-cell', 'product-item', 'od-summary',
  'iv-record-item', 'checklist-item', 'search-result-item', 'compact-cd',
]
// 限定文件的类名（避免过于通用的类名误伤其他页面）
const FILE_CLASSES = {
  'subpackages/profile-extra/preferences/preferences.wxss': ['section'],
}

const PROP_RE = /^border(?!-radius)(-(top|right|bottom|left|color|width|style|image)(-[a-z]+)?)?$|^box-shadow$/

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

function makeMatcher(classes) {
  const res = classes.map((c) => new RegExp('\\.' + c + '(--[\\w-]+)?$'))
  return (selector) => selector.split(',').some((sel) => {
    sel = sel.trim()
    if (!sel || sel.startsWith('@')) return false
    const parts = sel.split(/[\s>+~]+/).filter(Boolean)
    let last = parts[parts.length - 1] || ''
    last = last.replace(/::?[a-z-]+(\([^)]*\))?/gi, '')
    return res.some((re) => re.test(last))
  })
}

function findRemovals(src, isCardSel) {
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
    let selStart = i
    while (i < n) {
      if (skipComment()) continue
      const c = src[i]
      if (c === '}') { i++; return }
      if (c === '{') {
        const selector = src.slice(selStart, i).trim()
        i++
        if (selector.startsWith('@keyframes') || selector.startsWith('@-')) skipBalanced()
        else if (selector.startsWith('@')) parseBlock()
        else parseRuleBody(selector)
        selStart = i
      } else i++
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
    const isCard = isCardSel(selector)
    let declStart = i
    while (i < n) {
      if (skipComment()) continue
      const c = src[i]
      if (c === '}') { maybeRemove(declStart, i, isCard, selector); i++; return }
      if (c === ';') { maybeRemove(declStart, i + 1, isCard, selector); i++; declStart = i }
      else if (c === '{') { i++; skipBalanced(); declStart = i }
      else i++
    }
  }
  function maybeRemove(from, to, isCard, selector) {
    if (!isCard) return
    const text = src.slice(from, to)
    const m = text.match(/^\s*([a-zA-Z-]+)\s*:/)
    if (!m) return
    if (PROP_RE.test(m[1].toLowerCase())) removals.push([from, to, selector.replace(/\s+/g, ' '), m[1]])
  }
  parseBlock()
  return removals
}

let total = 0
for (const f of walk(ROOT, [])) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const classes = GLOBAL_CLASSES.concat(FILE_CLASSES[rel] || [])
  const src = fs.readFileSync(f, 'utf8')
  const removals = findRemovals(src, makeMatcher(classes))
  if (!removals.length) continue
  total += removals.length
  for (const [, , sel, prop] of removals) console.log(rel + '  [' + sel.slice(0, 60) + ']  ' + prop)
  if (APPLY) {
    let out = ''
    let pos = 0
    for (const [a, b] of removals) { out += src.slice(pos, a); pos = b }
    out += src.slice(pos)
    out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    fs.writeFileSync(f, out)
  }
}
console.log((APPLY ? 'APPLIED' : 'DRY-RUN') + ' — declarations: ' + total)
