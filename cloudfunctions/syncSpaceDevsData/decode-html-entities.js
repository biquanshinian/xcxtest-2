/** Common named HTML entities (subset) */
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/**
 * Decode HTML entities in plain text (e.g. Mayor order body from starbase.gov).
 * Handles &#x27; &#39; &apos; &amp; &quot; &nbsp; numeric and common named entities.
 */
function decodeHtmlEntities(str) {
  let s = String(str || '')
  if (!s || !/&(?:#(?:x[0-9a-f]+|\d+)|[a-z]+);/i.test(s)) return s

  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const n = parseInt(hex, 16)
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : `&#x${hex};`
  })

  s = s.replace(/&#(\d+);/g, (_, dec) => {
    const n = parseInt(dec, 10)
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : `&#${dec};`
  })

  s = s.replace(/&([a-z]+);/gi, (match, name) => {
    const decoded = NAMED_ENTITIES[name.toLowerCase()]
    return decoded !== undefined ? decoded : match
  })

  return s
}

module.exports = { decodeHtmlEntities }
