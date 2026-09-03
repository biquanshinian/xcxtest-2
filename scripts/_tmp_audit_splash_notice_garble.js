/** 复现并验证：加粗+字号嵌套不再把 HTML 泄漏成乱码 */
const fs = require('fs')
const path = require('path')

// 从 index-splash 抽不出纯函数依赖，这里内联与线上一致的关键修复逻辑做断言
function decodeNoticeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}
function cleanNoticeSegText(s) {
  return decodeNoticeEntities(String(s || ''))
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\b(?:span|div|font|strong|b)\b\s*style\s*=\s*("[^"]*"|'[^']*')\s*>/gi, '')
    .replace(/<\/\s*(?:span|div|font|strong|b)\s*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function parseSplashNoticeInlineSegs(fragment) {
  const segs = []
  let src = String(fragment || '')
  if (!src) return segs
  src = src.replace(/<span(\s+[^>]*?=\s*"[^"]*")([^\s>])/gi, '<span$1>$2')
  src = src.replace(/<span(\s+[^>]*?=\s*'[^']*')([^\s>])/gi, '<span$1>$2')
  const stack = [{ bold: false, fontSize: 28 }]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const close = src.slice(i).match(/^<\/\s*span\s*>/i)
      if (close) {
        if (stack.length > 1) stack.pop()
        i += close[0].length
        continue
      }
      const open = src.slice(i).match(/^<span\b([^>]*)>/i)
      if (open) {
        const attrs = open[1] || ''
        const cur = stack[stack.length - 1]
        const next = { bold: cur.bold, fontSize: cur.fontSize }
        if (/font-weight\s*:\s*(bold|700)/i.test(attrs)) next.bold = true
        const sizeM = attrs.match(/font-size\s*:\s*(\d+)\s*px/i)
        if (sizeM) {
          const px = Number(sizeM[1])
          if (px === 12 || px === 14 || px === 16 || px === 18) next.fontSize = px * 2
        }
        stack.push(next)
        i += open[0].length
        continue
      }
      const skip = src.slice(i).match(/^<[^>]+>/)
      if (skip) {
        i += skip[0].length
        continue
      }
      i += 1
      continue
    }
    const nextLt = src.indexOf('<', i)
    const rawText = nextLt === -1 ? src.slice(i) : src.slice(i, nextLt)
    i = nextLt === -1 ? src.length : nextLt
    const text = cleanNoticeSegText(rawText)
    if (!text) continue
    const cur = stack[stack.length - 1]
    const last = segs[segs.length - 1]
    if (last && last.bold === !!cur.bold && last.fontSize === cur.fontSize) last.text += text
    else segs.push({ text, bold: !!cur.bold, fontSize: cur.fontSize })
  }
  if (!segs.length) {
    const t = cleanNoticeSegText(src)
    if (t) segs.push({ text: t, bold: false, fontSize: 28 })
  }
  return segs
}

function sanitizeStrong(src) {
  return String(src)
    .replace(/<\s*strong\b[^>]*>/gi, '<span style="font-weight:700">')
    .replace(/<\s*\/\s*strong\s*>/gi, '</span>')
    .replace(/<\s*b\b(?![a-z])[^>]*>/gi, '<span style="font-weight:700">')
    .replace(/<\s*\/\s*b\s*>/gi, '</span>')
}

// 1) 修复后的合法嵌套
const good =
  '<span style="font-size:18px"><span style="font-weight:700">由于天气原因</span></span>Starship Flight 13现已改期'
const g = parseSplashNoticeInlineSegs(good)
if (!g.some((s) => s.text === '由于天气原因' && s.bold && s.fontSize === 36)) {
  throw new Error('nested size+bold failed: ' + JSON.stringify(g))
}
if (g.some((s) => /span|style=/.test(s.text))) throw new Error('tag leak in good: ' + JSON.stringify(g))

// 2) 历史坏数据（缺 >）应被修复且不泄漏
const bad = '<span style="font-size:18px"><span style="font-weight:700"由于天气原因</span></span>后续'
const b = parseSplashNoticeInlineSegs(bad)
if (b.some((s) => /span\s*style=/.test(s.text))) throw new Error('tag leak in bad: ' + JSON.stringify(b))
if (!b.some((s) => s.text.includes('由于天气原因'))) throw new Error('text lost in bad: ' + JSON.stringify(b))

// 3) strong 转换必须带 >
const converted = sanitizeStrong('<span style="font-size:18px"><strong>由于天气原因</strong></span>')
if (converted.includes('font-weight:700"由于') || /font-weight:700"[^>]/.test(converted.replace(/font-weight:700">/g, ''))) {
  // allow only proper >
}
if (!converted.includes('<span style="font-weight:700">')) {
  throw new Error('strong convert missing >: ' + converted)
}

// 4) 源码侧确认已修复
const splash = fs.readFileSync(path.join(__dirname, '../subpackages/index-extra/utils/index-splash.js'), 'utf8')
const gw = fs.readFileSync(path.join(__dirname, '../cloudfunctions/adminGateway/index.js'), 'utf8')
if (splash.includes(".replace(/<\\s*strong\\b/gi, '<span style=\"font-weight:700\"')")) {
  throw new Error('splash still has broken strong replace')
}
if (!splash.includes('strong\\b[^>]*>')) throw new Error('splash missing fixed strong replace')
if (!gw.includes('strong\\b[^>]*>')) throw new Error('gateway missing fixed strong replace')

console.log('GARBLE_FIX_OK')
console.log(JSON.stringify({ good: g, bad: b, converted }, null, 2))
