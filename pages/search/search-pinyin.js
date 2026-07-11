/**
 * 中文转拼音 / 拼音匹配（依赖 pinyin-pro，失败时降级为空操作）
 */
let pinyinFn = null
let matchFn = null

try {
  const mod = require('pinyin-pro')
  pinyinFn = typeof mod.pinyin === 'function' ? mod.pinyin : null
  matchFn = typeof mod.match === 'function' ? mod.match : null
} catch (e) {
  pinyinFn = null
  matchFn = null
}

const CACHE = new Map()
const CACHE_MAX = 1000

function cacheCompute(key, fn) {
  if (CACHE.has(key)) return CACHE.get(key)
  const val = fn()
  if (CACHE.size >= CACHE_MAX) {
    const first = CACHE.keys().next().value
    CACHE.delete(first)
  }
  CACHE.set(key, val)
  return val
}

function hasCJK(str) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(str || ''))
}

/**
 * 整句紧凑拼音（无声调、ü→v、去空格），用于索引与包含匹配
 */
function toPinyinCompact(raw) {
  if (!raw || !pinyinFn) return ''
  const s = String(raw)
  return cacheCompute('p:' + s, () => {
    try {
      const out = pinyinFn(s, {
        toneType: 'none',
        type: 'string',
        separator: '',
        v: true,
        nonZh: 'consecutive'
      })
      return String(out || '').toLowerCase().replace(/\s+/g, '')
    } catch (e) {
      return ''
    }
  })
}

/**
 * 汉字首字母串（非汉字按 removeNonZh 去掉），用于简拼
 */
function toPinyinInitialsCompact(raw) {
  if (!raw || !pinyinFn) return ''
  const s = String(raw)
  return cacheCompute('i:' + s, () => {
    try {
      const out = pinyinFn(s, {
        pattern: 'first',
        toneType: 'none',
        type: 'string',
        separator: '',
        v: true,
        nonZh: 'removed'
      })
      return String(out || '').toLowerCase().replace(/\s+/g, '')
    } catch (e) {
      return ''
    }
  })
}

/**
 * 汉语字段是否可被用户输入的拼音串匹配（简拼 / 全拼混输）
 */
function matchChineseWithPinyin(chineseText, pinyinQuery) {
  if (!matchFn || !chineseText || !pinyinQuery) return false
  const q = String(pinyinQuery).trim().toLowerCase()
  if (!q) return false
  try {
    const hit = matchFn(String(chineseText), q, {
      precision: 'start',
      insensitive: true,
      continuous: false,
      space: 'ignore',
      v: true,
      lastPrecision: 'start'
    })
    return hit != null && hit.length > 0
  } catch (e) {
    return false
  }
}

function isLikelyPinyinQuery(normalizedLatin) {
  const s = String(normalizedLatin || '').trim().toLowerCase()
  if (s.length < 2) return false
  return /^[a-z0-9\s]+$/.test(s)
}

module.exports = {
  pinyinAvailable: () => !!pinyinFn,
  hasCJK,
  toPinyinCompact,
  toPinyinInitialsCompact,
  matchChineseWithPinyin,
  isLikelyPinyinQuery
}
