/**
 * SciNews 集锦标题/简介模糊匹配。
 *
 * LL2 与 SciNews 常见写法差一截：
 * - Tianlian-2-06 vs TianLian-2 06（连字符/空格）
 * - Long March 3B/E vs Long March-3B（斜杠变体）
 * - Vikram-I vs Vikram-1（罗马数字）
 *
 * 策略：token 展开变体后，两侧都做「去分隔符」归一化再子串匹配；
 * 仍要求任务段至少命中 1 个、带数字的特征 token 必须命中（防同日张冠李戴）。
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
 * 判断候选标题(+简介)是否匹配 clipSearch 线索，并给出分数。
 * @returns {{ ok: boolean, score: number, dateOk: boolean, tokenHits: number, rocketHits: number }}
 */
function scoreClipText(title, description, clipSearch) {
  const dateText = String((clipSearch && clipSearch.dateText) || '').toLowerCase()
  const tokens = tokenVariantGroups(((clipSearch && clipSearch.tokens) || []).map((t) => String(t).toLowerCase()))
  const rocketTokens = tokenVariantGroups(((clipSearch && clipSearch.rocketTokens) || []).map((t) => String(t).toLowerCase()))
  const titleLower = String(title || '').toLowerCase()
  const descLower = String(description || '').toLowerCase()
  const text = `${titleLower} ${descLower}`.trim()

  let dateOk = !!(dateText && titleLower.includes(dateText))
  if (!dateOk && dateText) dateOk = descLower.includes(dateText)

  const tokenHitCount = hits(tokens, text)
  const rocketHitCount = hits(rocketTokens, text)
  const specificTokens = tokens.filter((g) => g.some((v) => /\d/.test(v)))
  const specificRocketTokens = rocketTokens.filter((g) => g.some((v) => /\d/.test(v)))

  let ok = dateOk
  if (ok && tokens.length && tokenHitCount === 0) ok = false
  if (ok && specificTokens.length && hits(specificTokens, text) === 0) ok = false
  // 无任务词时：有火箭词则必须命中（含非数字，如 falcon）；仅数字型号仍走下一道
  if (ok && !tokens.length && rocketTokens.length && rocketHitCount === 0) ok = false
  if (ok && !tokens.length && specificRocketTokens.length && hits(specificRocketTokens, text) === 0) ok = false

  return {
    ok,
    score: ok ? tokenHitCount * 2 + rocketHitCount : 0,
    dateOk,
    tokenHits: tokenHitCount,
    rocketHits: rocketHitCount
  }
}

export {
  normalizeMatchText,
  expandTokenVariants,
  tokenVariantGroups,
  hits,
  scoreClipText
}
