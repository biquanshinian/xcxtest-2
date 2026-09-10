function decodeNoticeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function parseSplashNoticeInlineSegs(fragment) {
  const segs = []
  const src = String(fragment || '')
  if (!src) return segs

  function walk(html, base) {
    const re = /<span\b([^>]*)>([\s\S]*?)<\/span>|([^<]+)/gi
    let m
    const str = String(html || '')
    let matched = false
    while ((m = re.exec(str))) {
      matched = true
      if (m[3] != null) {
        const t = decodeNoticeEntities(m[3])
        if (t) segs.push({ text: t, bold: !!base.bold, fontSize: base.fontSize })
        continue
      }
      const attrs = m[1] || ''
      const inner = m[2] || ''
      const next = {
        bold: base.bold || /font-weight\s*:\s*(bold|700)/i.test(attrs),
        fontSize: base.fontSize
      }
      const sizeM = attrs.match(/font-size\s*:\s*(\d+)\s*px/i)
      if (sizeM) {
        const px = Number(sizeM[1])
        if (px === 12 || px === 14 || px === 16 || px === 18) next.fontSize = px * 2
      }
      if (/<span\b/i.test(inner)) walk(inner, next)
      else {
        const t = decodeNoticeEntities(inner.replace(/<[^>]+>/g, ''))
        if (t) segs.push({ text: t, bold: !!next.bold, fontSize: next.fontSize })
      }
    }
    if (!matched) {
      const t = decodeNoticeEntities(str.replace(/<[^>]+>/g, ''))
      if (t) segs.push({ text: t, bold: !!base.bold, fontSize: base.fontSize })
    }
  }

  walk(src, { bold: false, fontSize: 28 })
  return segs
}

function buildSplashNoticeLines(html) {
  let src = String(html || '')
  src = src.replace(/<\/div>\s*<div\b[^>]*>/gi, '\n')
  src = src.replace(/<br\s*\/?>/gi, '\n')
  src = src.replace(/<\/?div\b[^>]*>/gi, '')
  const rawLines = src.split('\n')
  const lines = []
  for (let i = 0; i < rawLines.length; i++) {
    const segs = parseSplashNoticeInlineSegs(rawLines[i])
    if (!segs.length) {
      if (lines.length && i < rawLines.length - 1) lines.push({ empty: true, segs: [] })
      continue
    }
    lines.push({ empty: false, segs })
  }
  while (lines.length && lines[lines.length - 1].empty) lines.pop()
  return lines.slice(0, 6)
}

const html = '<div style="text-align:center">第一行<br/>第二行<span style="font-weight:700">加粗</span></div>'
const lines = buildSplashNoticeLines(html)
if (lines.length !== 2) throw new Error('expect 2 lines got ' + lines.length)
if (!lines[1].segs.some((s) => s.text.includes('加粗') && s.bold)) throw new Error('bold seg missing')

const html2 = '<div style="text-align:left">A</div><div style="text-align:left">B</div>'
const lines2 = buildSplashNoticeLines(html2)
if (lines2.length !== 2 || lines2[0].segs[0].text !== 'A' || lines2[1].segs[0].text !== 'B') {
  throw new Error('div block lines fail ' + JSON.stringify(lines2))
}

console.log('LINE_BREAK_PARSE_OK')
