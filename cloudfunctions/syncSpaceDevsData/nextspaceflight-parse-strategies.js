/**
 * Next Spaceflight 页面内联 statuses 多策略解析（网页改版时自动择优）
 * 策略按顺序尝试，首个「可 JSON.parse + 结构合法」的结果胜出。
 */

function sliceNeedsUnescape(marker) {
  return marker.includes('\\"')
}

/** 在 html[from:] 内尝试 markers × endTags 的字切片解析 */
function tryAnchoredSlices(html, from, strategyPrefix, markers, endTags) {
  for (const marker of markers) {
    const pos = html.indexOf(marker, from)
    if (pos < 0) continue
    const arrStart = pos + marker.length - 1 // '['
    if (html[arrStart] !== '[') continue

    const needUnescape = sliceNeedsUnescape(marker)

    for (const endTag of endTags) {
      const endIdx = html.indexOf(endTag, arrStart)
      if (endIdx < 0) continue
      const rawArr = html.slice(arrStart, endIdx + 1)
      const jsonStr = needUnescape ? rawArr.replace(/\\"/g, '"') : rawArr
      try {
        const arr = JSON.parse(jsonStr)
        if (!Array.isArray(arr)) continue
        return {
          arr,
          endIdx,
          strategy: `${strategyPrefix}:${marker.slice(0, 24)}→${endTag.slice(0, 28)}`
        }
      } catch (e) {
        continue
      }
    }
  }
  return null
}

/**
 * 从 '[' 起扫描：字符串分隔符为 \"（HTML 内嵌转义 JSON）
 */
function parseBracketArrayEscapedQuotes(html, openBracketIdx) {
  let depth = 0
  let i = openBracketIdx
  let inStr = false

  while (i < html.length) {
    if (!inStr) {
      if (html[i] === '\\' && html[i + 1] === '"') {
        inStr = true
        i += 2
        continue
      }
      const c = html[i]
      if (c === '[') depth++
      else if (c === ']') {
        depth--
        if (depth === 0) {
          const slice = html.slice(openBracketIdx, i + 1)
          try {
            const arr = JSON.parse(slice.replace(/\\"/g, '"'))
            return Array.isArray(arr) ? { arr, endIdx: i } : null
          } catch (e) {
            return null
          }
        }
      }
      i++
      continue
    }
    // inStr：闭合 \"
    if (html[i] === '\\' && html[i + 1] === '"') {
      inStr = false
      i += 2
      continue
    }
    i++
  }
  return null
}

/** 标准 JSON 括号扫描（字符串内仅 \" 不计——用于未转义切片） */
function parseBracketArrayStandard(html, openBracketIdx) {
  let depth = 0
  let inStr = false
  let escape = false

  for (let i = openBracketIdx; i < html.length; i++) {
    const c = html[i]
    if (escape) {
      escape = false
      continue
    }
    if (inStr) {
      if (c === '\\') escape = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        try {
          const arr = JSON.parse(html.slice(openBracketIdx, i + 1))
          return Array.isArray(arr) ? { arr, endIdx: i } : null
        } catch (e) {
          return null
        }
      }
    }
  }
  return null
}

const MARKERS_ESCAPED = ['\\"statuses\\":[', '\\"statuses\\" : [', '\\"statuses\\"\t:[']

const MARKERS_BARE = ['"statuses":[', '"statuses" : [', '"statuses"\t:[']

const END_TAGS_ESCAPED_LAST = [
  '],\\"lastFetch\\"',
  '],\\"closures\\"',
  '],\\"tests\\"'
]

const END_TAGS_BARE_LAST = ['],\"lastFetch\"', '],"closures"', '],"tests"']

function isLikelyStatusesArray(arr) {
  if (!Array.isArray(arr)) return false
  if (arr.length === 0) return true
  return arr.every((row) => {
    if (!row || typeof row !== 'object') return false
    return row.title != null || row.confirmed !== undefined || row.id != null || row.url != null
  })
}

function extractLastFetchFlexible(html, endIdx, anchorFrom) {
  const near = html.slice(Math.max(0, endIdx - 80), endIdx + 420)
  let m = near.match(/\\\"lastFetch\\\":\\\"([^\\\"]*)\\\"/)
  if (m) return m[1]
  m = near.match(/"lastFetch"\s*:\s*"([^"]*)"/)
  if (m) return m[1]

  const chunk = html.slice(anchorFrom, anchorFrom + 900000)
  m = chunk.match(/\\\"lastFetch\\\":\\\"([^\\\"]*)\\\"/)
  if (m) return m[1]
  m = chunk.match(/"lastFetch"\s*:\s*"([^"]*)"/)
  return m ? m[1] : ''
}

/**
 * @returns {{ arr: any[], endIdx: number, strategy: string } | null }
 */
function tryBalancedAfterMarkers(html, from, strategyLabel, markers, useEscapedScanner) {
  for (const marker of markers) {
    const pos = html.indexOf(marker, from)
    if (pos < 0) continue
    const openBracket = pos + marker.length - 1
    if (html[openBracket] !== '[') continue

    const parsed = useEscapedScanner
      ? parseBracketArrayEscapedQuotes(html, openBracket)
      : parseBracketArrayStandard(html, openBracket)

    if (parsed && isLikelyStatusesArray(parsed.arr)) {
      return {
        arr: parsed.arr,
        endIdx: parsed.endIdx,
        strategy: `${strategyLabel}:${marker.trim()}`
      }
    }
  }
  return null
}

/**
 * 多策略解析网页中的 statuses 数组
 * @param {string} htmlText
 * @param {{ tried?: string[] }} dbg
 */
function parseStatusesMultiStrategy(htmlText, dbg) {
  const html = typeof htmlText === 'string' ? htmlText : String(htmlText || '')
  const tried = dbg && Array.isArray(dbg.tried) ? dbg.tried : null

  const anchorSd = html.indexOf('starshipData')
  const regions = anchorSd >= 0 ? [anchorSd, 0] : [0]

  const attempts = []

  for (const from of regions) {
    attempts.push([
      'slice_esc_last',
      () =>
        tryAnchoredSlices(html, from, 'slice_esc', MARKERS_ESCAPED, END_TAGS_ESCAPED_LAST)
    ])
    attempts.push([
      'slice_bare_last',
      () =>
        tryAnchoredSlices(html, from, 'slice_bare', MARKERS_BARE, END_TAGS_BARE_LAST)
    ])
    attempts.push([
      'balanced_esc',
      () => tryBalancedAfterMarkers(html, from, 'balanced_esc', MARKERS_ESCAPED, true)
    ])
    attempts.push([
      'balanced_bare',
      () => tryBalancedAfterMarkers(html, from, 'balanced_bare', MARKERS_BARE, false)
    ])
  }

  for (const [name, fn] of attempts) {
    if (tried) tried.push(name)
    let r
    try {
      r = fn()
    } catch (e) {
      r = null
    }
    if (!r || !Array.isArray(r.arr)) continue
    if (!isLikelyStatusesArray(r.arr)) continue
    const strategy = typeof r.strategy === 'string' ? r.strategy : name
    return {
      arr: r.arr,
      endIdx: typeof r.endIdx === 'number' ? r.endIdx : -1,
      strategy
    }
  }

  return null
}

module.exports = {
  parseStatusesMultiStrategy,
  extractLastFetchFlexible,
  isLikelyStatusesArray
}
