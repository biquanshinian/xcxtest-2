/** 探测 space-notices.com entry 页里的 entry 对象结构：能否直接拿到 LL2 id */
const { httpGet } = require('../cloudfunctions/spaceNotices/fetch-external.js')

/** 复用 fetch-external 的平衡括号切法，但可指定 marker */
function extractObject(html, keyName) {
  const markers = [`\\"${keyName}\\":{`, `"${keyName}":{`]
  let idx = -1
  let escaped = false
  for (const mk of markers) {
    idx = html.indexOf(mk)
    if (idx >= 0) {
      escaped = mk.charAt(0) === '\\'
      break
    }
  }
  if (idx < 0) return null
  const start = html.indexOf('{', idx)
  let i = start
  let depth = 0
  let inStr = false
  while (i < html.length && i < start + 400000) {
    if (escaped) {
      if (!inStr) {
        if (html.startsWith('\\"', i)) { inStr = true; i += 2; continue }
        const ch = html[i]
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
        i++
        continue
      }
      if (html.startsWith('\\\\', i)) { i += 2; continue }
      if (html.startsWith('\\"', i)) { inStr = false; i += 2; continue }
      i++
      continue
    }
    const ch = html[i]
    if (inStr) {
      if (ch === '\\') { i += 2; continue }
      if (ch === '"') inStr = false
      i++
      continue
    }
    if (ch === '"') { inStr = true; i++; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
    i++
  }
  if (depth !== 0) return null
  let raw = html.slice(start, i)
  if (escaped) raw = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  try {
    return JSON.parse(raw)
  } catch (e) {
    return { __parseError: (e && e.message) || String(e), __rawHead: raw.slice(0, 600) }
  }
}

function summarize(obj, depth) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `Array(${obj.length})` + (obj.length ? ' e0=' + summarize(obj[0], (depth || 0) + 1).slice(0, 160) : '')
  if ((depth || 0) > 2) return '{' + Object.keys(obj).join(',') + '}'
  return (
    '{\n' +
    Object.keys(obj)
      .map((k) => '  '.repeat((depth || 0) + 1) + k + ': ' + summarize(obj[k], (depth || 0) + 1))
      .join('\n') +
    '\n' + '  '.repeat(depth || 0) + '}'
  )
}

async function main() {
  const slugs = ['launch-f9-starlink-17-51', 'launch-long-march-3be-tianlian-2-06', 'launch-starship-flight-13']
  for (const slug of slugs) {
    const url = `https://space-notices.com/entry/${slug}`
    let html = ''
    try {
      html = await httpGet(url)
    } catch (e) {
      console.log(`\n##### ${slug} ERROR ${(e && e.message) || e}`)
      continue
    }
    console.log(`\n##### ${slug} (${html.length} chars)`)
    for (const key of ['entry', 'launch']) {
      const obj = extractObject(html, key)
      if (!obj) {
        console.log(`  [${key}] not found`)
        continue
      }
      console.log(`  [${key}] ` + summarize(obj, 1))
    }
    // 直接搜 UUID：LL2 id 是 uuid v4
    const uuids = [...new Set(html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])]
    console.log('  uuids found:', uuids.slice(0, 8))
  }
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
