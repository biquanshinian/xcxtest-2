/**
 * 压缩 landing-icons.js 中体积过大的 BO_LZ / NET_CATCH SVG 模板
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../utils/landing-icons.js')
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const before = s.length

const NET_CATCH = `  // 网系回收（拦阻网驳船）—— 几何精简版；长征十号乙等
  NET_CATCH:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="\${C}" d="M2 4h20v2H2V4zm0 5h20v2H2V9zm0 5h20v2H2v-2zm0 5h20v2H2v-2zM6 2v20h2V2H6zm5 0v20h2V2h-2zm5 0v20h2V2h-2z"/>'
    + '</svg>',`

const BO_LZ = `  // 蓝色起源新格伦 LPV1 / Jacklyn 海上回收 —— 几何精简版（驳船 + RTLS 角标）
  BO_LZ:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<path fill="\${C}" d="M32 6C16 10 7 26 4 42h11c3-11 12-21 24-24V6zm36 0c16 4 25 20 28 36H85c-3-13-13-23-25-25V6zM68 94c16-4 25-20 28-36H85c-3 13-13 23-25 25v11zM32 94C16 90 7 74 4 58h11c3 11 12 21 24 24V94z"/>'
    + '<path fill="\${C}" d="M18 56h64v9H18zm6-11h52v13H24z"/>'
    + '<path fill="\${C}" d="M14 72c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0 8-3 12 0v5c-4 3-8 3-12 0s-8-3-12 0-8 3-12 0-8-3-12 0-8 3-12 0v-5z"/>'
    + '</svg>',`

function replaceBlock(src, key, replacement) {
  const re = new RegExp(
    `  //[^\\n]*\\n  ${key}:\\n(?:    '[^']*'\\n    \\+ '[^']*'\\n)*    \\+ '[^']*',`,
    'm'
  )
  // More robust: from KEY: to next top-level key or closing
  const startRe = new RegExp(`(\\n  //[^\\n]*\\n)?  ${key}:\\n`)
  const start = src.search(startRe)
  if (start < 0) throw new Error('start not found: ' + key)
  // find comment start for this key
  let cutStart = start
  const commentLook = src.lastIndexOf('\n  //', start)
  if (commentLook >= 0 && commentLook > start - 200) {
    // include preceding comment lines for this block
    const between = src.slice(commentLook, start)
    if (!between.includes('\n  [A-Z]') && between.split('\n').every((l) => !l.trim() || l.trim().startsWith('//') || l === '')) {
      cutStart = commentLook + 1
    }
  }
  // find end: next `  KEY:` or `}`
  const after = src.slice(start + 1)
  const nextKey = after.search(/\n  [A-Z_]+:\n/)
  const nextClose = after.search(/\n\}/)
  let endRel = nextKey >= 0 ? nextKey : nextClose
  if (endRel < 0) throw new Error('end not found: ' + key)
  // include trailing comma line fully
  const cutEnd = start + 1 + endRel
  // Prefer including comment before key
  let blockStart = start
  // walk back for consecutive comment lines
  const lines = src.slice(0, start).split('\n')
  let i = lines.length - 1
  while (i >= 0 && (/^\s*$/.test(lines[i]) || /^\s*\/\//.test(lines[i]))) {
    i--
  }
  blockStart = lines.slice(0, i + 1).join('\n').length
  if (blockStart > 0) blockStart += 1 // after newline

  return src.slice(0, blockStart) + replacement + '\n' + src.slice(cutEnd)
}

// Simpler approach: regex match from comment through template end
function replaceTemplate(src, key, replacement) {
  const re = new RegExp(
    `(?:  //[^\\n]*\\n)+  ${key}:\\n(?:    \\+? ?'[^']*'\\n)+`,
    'm'
  )
  if (!re.test(src)) {
    // try without requiring comment
    const re2 = new RegExp(`  ${key}:\\n(?:    \\+? ?'[^']*'\\n)+`, 'm')
    if (!re2.test(src)) throw new Error('template not matched: ' + key)
    return src.replace(re2, replacement + '\n')
  }
  return src.replace(re, replacement + '\n')
}

s = replaceTemplate(s, 'NET_CATCH', NET_CATCH)
s = replaceTemplate(s, 'BO_LZ', BO_LZ)

// Update isBoLzIconSrc detector for new viewBox
s = s.replace(
  /function isBoLzIconSrc\(src\) \{[\s\S]*?\n\}/,
  `function isBoLzIconSrc(src) {
  if (typeof src !== 'string' || !src) return false
  if (src.indexOf('/images/BO_LZ.svg') !== -1) return true
  // 新旧模板：旧 viewBox 48.72 / 新几何版 100 100 + 驳船路径特征
  return (
    src.indexOf('viewBox=%220%200%2048.72') !== -1 ||
    src.indexOf('viewBox="0 0 48.72') !== -1 ||
    src.indexOf('viewBox=%220%200%20100%20100') !== -1 && src.indexOf('M18 56h64v9H18') !== -1 ||
    src.indexOf('viewBox="0 0 100 100') !== -1 && src.indexOf('M18 56h64v9H18') !== -1
  )
}`
)

fs.writeFileSync(file, s)
console.log('before', (before / 1024).toFixed(1) + 'KB', 'after', (s.length / 1024).toFixed(1) + 'KB', 'saved', ((before - s.length) / 1024).toFixed(1) + 'KB')

// verify templates parse
const m = s.match(/const TEMPLATES = \{([\s\S]*?)\n\}/)
if (!m) throw new Error('TEMPLATES missing')
console.log('NET_CATCH ok', s.includes("NET_CATCH:\n    '<svg") && s.includes('M2 4h20v2'))
console.log('BO_LZ ok', s.includes("BO_LZ:\n    '<svg") && s.includes('M18 56h64v9H18'))
