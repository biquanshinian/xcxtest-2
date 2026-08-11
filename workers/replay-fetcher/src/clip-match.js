/**
 * SciNews 集锦标题/简介模糊匹配。
 *
 * LL2 与 SciNews 常见写法差一截：
 * - Tianlian-2-06 vs TianLian-2 06（连字符/空格）
 * - Long March 3B/E vs Long March-3B（斜杠变体）
 * - Vikram-I vs Vikram-1（罗马数字）
 * - Starlink Group 17-38 vs Starlink 412（编号体系不同：组号 vs 任务序号）
 *
 * 策略（适用于全部历史发射集锦匹配，非某一发射商特例）：
 * 1) 精细：token 展开变体后去分隔符子串匹配；任务段至少命中 1 个，
 *    带数字的特征 token 必须命中（防同日张冠李戴）。
 * 2) 降级（默认兜底，不可关掉）：精细失败时，若 UTC 日期命中
 *    + 家族词命中（含从编号 token 抽取的词干，如 tianlian-2-06→tianlian）
 *    + 火箭词命中（有则必须；无家族词可抽时退化为日期+火箭+近时），
 *    则 fuzzyOk；由调用方再用 upload≈net 接近时间挑最近一条。
 */

const ROMAN_SUFFIX = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5',
  vi: '6', vii: '7', viii: '8', ix: '9', x: '10'
}

/** 小写 + 去掉分隔符（- _ / . 空白等），保留字母数字与中文 */
function normalizeMatchText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

/**
 * 一个业务 token → 变体组（组内任一命中即算该 token 命中）
 * @returns {string[]}
 */
function expandTokenVariants(token) {
  const t = String(token || '').toLowerCase().trim()
  if (!t) return []
  const group = new Set([t])

  // 罗马 ↔ 阿拉伯尾缀（Vikram-I ↔ Vikram-1）
  const m = t.match(/^(.*[-\s])(i{1,3}|iv|v|vi{0,3}|ix|x)$/)
  if (m && ROMAN_SUFFIX[m[2]]) group.add(m[1] + ROMAN_SUFFIX[m[2]])
  const n = t.match(/^(.*[-\s])(\d{1,2})$/)
  if (n) {
    const roman = Object.keys(ROMAN_SUFFIX).find((k) => ROMAN_SUFFIX[k] === n[2])
    if (roman) group.add(n[1] + roman)
  }

  // 斜杠型号：3b/e → 3b、3be（SciNews 常写 Long March-3B）
  if (t.includes('/')) {
    group.add(t.replace(/\//g, ''))
    const head = t.split('/')[0]
    if (head) group.add(head)
  }

  return [...group]
}

/** @param {string[]} list */
function tokenVariantGroups(list) {
  return (list || [])
    .map((t) => expandTokenVariants(t))
    .filter((g) => g.length > 0)
}

/**
 * 变体组在原文中的命中数（归一化后子串；变体归一化后长度 < 2 的忽略）
 * @param {string[][]} groups
 * @param {string} text
 */
function hits(groups, text) {
  const normText = normalizeMatchText(text)
  if (!normText) return 0
  return groups.reduce((n, g) => {
    const ok = (g || []).some((v) => {
      const nv = normalizeMatchText(v)
      // 过短纯数字（如 06）会误撞年份 2026；编号类 10-45→1045 长度够，仍放行
      if (nv.length < 2 || (/^\d+$/.test(nv) && nv.length <= 2)) return false
      return normText.includes(nv)
    })
    return n + (ok ? 1 : 0)
  }, 0)
}

/**
 * 从带数字 token 抽家族词干：tianlian-2-06 → tianlian；纯组号 17-38 → 空。
 * @param {string} token
 * @returns {string}
 */
function extractFamilyStem(token) {
  const raw = String(token || '').toLowerCase().trim()
  if (!raw || !/\d/.test(raw)) return ''
  const m = raw.match(/^([a-z\u4e00-\u9fff]{3,})/)
  if (m) return m[1]
  const letters = raw.replace(/[^a-z\u4e00-\u9fff]+/g, '')
  return letters.length >= 3 ? letters : ''
}

/**
 * 模糊匹配用的家族词组：无数字 token + 编号 token 词干。
 * @param {string[][]} tokenGroups
 * @returns {string[][]}
 */
function softFamilyGroups(tokenGroups) {
  const out = []
  const seen = new Set()
  for (const g of tokenGroups || []) {
    const hasDigit = (g || []).some((v) => /\d/.test(String(v)))
    if (!hasDigit) {
      const key = (g || []).map((v) => normalizeMatchText(v)).filter(Boolean).sort().join('|')
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(g)
      }
      continue
    }
    for (const v of g || []) {
      const stem = extractFamilyStem(v)
      if (!stem) continue
      const key = normalizeMatchText(stem)
      if (key.length < 3 || seen.has(key)) continue
      seen.add(key)
      out.push([stem])
    }
  }
  return out
}

/**
 * 判断候选标题(+简介)是否匹配 clipSearch 线索，并给出分数。
 * @returns {{
 *   ok: boolean, strict: boolean, fuzzy: boolean, score: number,
 *   dateOk: boolean, tokenHits: number, rocketHits: number, softHits: number
 * }}
 */
function scoreClipText(title, description, clipSearch) {
  const dateText = String((clipSearch && clipSearch.dateText) || '').toLowerCase()
  const tokens = tokenVariantGroups(((clipSearch && clipSearch.tokens) || []).map((t) => String(t).toLowerCase()))
  const rocketTokens = tokenVariantGroups(((clipSearch && clipSearch.rocketTokens) || []).map((t) => String(t).toLowerCase()))
  const titleLower = String(title || '').toLowerCase()
  const descLower = String(description || '').toLowerCase()
  const text = `${titleLower} ${descLower}`.trim()

  // 日期：精确串优先；近邻日兜底（NET 跨 UTC 日界 / SciNews 用发射当地日）
  const dateCandidates = dateTextCandidates(dateText)
  let dateOk = dateCandidates.some((d) => titleLower.includes(d) || descLower.includes(d))

  const tokenHitCount = hits(tokens, text)
  const rocketHitCount = hits(rocketTokens, text)
  const specificTokens = tokens.filter((g) => g.some((v) => /\d/.test(v)))
  const specificRocketTokens = rocketTokens.filter((g) => g.some((v) => /\d/.test(v)))
  // 家族词：starlink 等无数字词 + tianlian-2-06→tianlian 词干（全历史发射统一兜底）
  const softTokens = softFamilyGroups(tokens)
  const softHitCount = hits(softTokens, text)

  // —— 精细匹配（原逻辑）——
  let strictOk = dateOk
  if (strictOk && tokens.length && tokenHitCount === 0) strictOk = false
  if (strictOk && specificTokens.length && hits(specificTokens, text) === 0) strictOk = false
  // 无任务词时：有火箭词则必须命中（含非数字，如 falcon）；仅数字型号仍走下一道
  if (strictOk && !tokens.length && rocketTokens.length && rocketHitCount === 0) strictOk = false
  if (strictOk && !tokens.length && specificRocketTokens.length && hits(specificRocketTokens, text) === 0) {
    strictOk = false
  }

  // —— 降级：日期 + 家族词（或无家族词时的火箭）+ 火箭（有则必须）——
  // 例：LL2「Starlink Group 17-38」↔ SciNews「Starlink 412 …, 8 August 2026」
  let fuzzyOk = false
  if (!strictOk && dateOk) {
    const rocketOk = !rocketTokens.length || rocketHitCount > 0
    if (rocketOk) {
      if (softTokens.length > 0) fuzzyOk = softHitCount > 0
      else fuzzyOk = rocketHitCount > 0 // 纯编号无线索：日期+火箭+近时
    }
    // 标题若已写成 LL2 组号样式（starlink 10 45 / 10-45）却对不上本任务编号，拒绝降级，防同日串台
    if (fuzzyOk && specificTokens.length && looksLikeConflictingGroupId(text, specificTokens)) {
      fuzzyOk = false
    }
  }

  const ok = strictOk || fuzzyOk
  // 精细分远高于模糊，调用方排序时严格优先
  let score = 0
  if (strictOk) score = 100 + tokenHitCount * 2 + rocketHitCount
  else if (fuzzyOk) score = softHitCount * 2 + rocketHitCount

  return {
    ok,
    strict: strictOk,
    fuzzy: fuzzyOk,
    score,
    dateOk,
    tokenHits: tokenHitCount,
    rocketHits: rocketHitCount,
    softHits: softHitCount
  }
}

/**
 * 标题/简介里出现「另一组」星链式两段组号（10-45 / 10 45 / group 17-38），
 * 且对不上本任务 specific token → 冲突。
 * SciNews 单序号（Starlink 412）不是两段式，放行给 fuzzy。
 */
function looksLikeConflictingGroupId(text, specificTokenGroups) {
  const lower = String(text || '').toLowerCase()
  if (!lower.includes('starlink')) return false
  const re = /starlink(?:\s+group)?\s+(\d{1,2})\s*[-–—\s]\s*(\d{1,2})\b/g
  let m
  while ((m = re.exec(lower))) {
    const foundNorm = normalizeMatchText(`${m[1]}-${m[2]}`)
    if (foundNorm.length < 3) continue
    const matched = (specificTokenGroups || []).some((g) =>
      (g || []).some((v) => normalizeMatchText(v) === foundNorm)
    )
    if (!matched) return true
  }
  return false
}

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december']

/** "8 August 2026" → 含前后各一天，防 UTC/当地日差一天匹配失败 */
function dateTextCandidates(dateText) {
  const raw = String(dateText || '').trim().toLowerCase()
  if (!raw) return []
  const out = [raw]
  const m = raw.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)
  if (!m) return out
  const day = Number(m[1])
  const mon = MONTHS_EN.indexOf(m[2])
  const year = Number(m[3])
  if (mon < 0 || !day || !year) return out
  const base = Date.UTC(year, mon, day)
  for (const delta of [-1, 1]) {
    const d = new Date(base + delta * 86400000)
    out.push(`${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`)
  }
  return [...new Set(out)]
}

/** yt-dlp upload_date（YYYYMMDD）→ UTC 日初毫秒；无效则 0 */
function parseUploadDateMs(uploadDate) {
  const s = String(uploadDate || '').trim()
  if (!/^\d{8}$/.test(s)) return 0
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(4, 6)) - 1
  const d = Number(s.slice(6, 8))
  const ms = Date.UTC(y, m, d)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * 在已 score 通过的候选里挑最佳：精细分优先；同为模糊时按 |upload - net| 最近。
 * @param {Array<{ scored: object, uploadMs?: number }>} items
 * @param {number} netMs
 */
function pickBestClipCandidate(items, netMs) {
  const list = (items || []).filter((x) => x && x.scored && x.scored.ok)
  if (!list.length) return null
  const net = Number(netMs) || 0
  list.sort((a, b) => {
    if (!!a.scored.strict !== !!b.scored.strict) return a.scored.strict ? -1 : 1
    if (a.scored.strict && b.scored.strict) return (b.scored.score || 0) - (a.scored.score || 0)
    // fuzzy：接近发射时间优先
    if (net && a.uploadMs && b.uploadMs) {
      const da = Math.abs(a.uploadMs - net)
      const db = Math.abs(b.uploadMs - net)
      if (da !== db) return da - db
    }
    return (b.scored.score || 0) - (a.scored.score || 0)
  })
  return list[0]
}

export {
  normalizeMatchText,
  expandTokenVariants,
  tokenVariantGroups,
  hits,
  extractFamilyStem,
  softFamilyGroups,
  scoreClipText,
  looksLikeConflictingGroupId,
  dateTextCandidates,
  parseUploadDateMs,
  pickBestClipCandidate
}
