/**
 * 薄壳：正本在 subpackages/shared/utils/text-translate.js（placeholder 同步锚点）。
 * 翻译管线走 require.async；isMostlyChinese 保持同步可用。
 */
function loadTextTranslate() {
  if (!loadTextTranslate._p) {
    loadTextTranslate._p = require.async('../../shared/utils/text-translate.js').then((m) => {
      loadTextTranslate._m = m
      return m
    })
  }
  return loadTextTranslate._p
}
loadTextTranslate()

/** 整句可用中文才跳过送翻。中英混排、雀雀/麻雀误译必须走混元。URL 不计入英文占比。 */
function isMostlyChinese(text) {
  if (loadTextTranslate._m) return loadTextTranslate._m.isMostlyChinese(text)
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ').trim()
  if (!raw) return true
  if (/雀雀|麻雀|孔雀/.test(raw)) return false
  if (!/[\u4e00-\u9fff]/.test(raw)) return false
  const rest = raw
    .replace(/\b(SpaceX|NASA|ESA|JAXA|Roscosmos|ULA|ISS|NROL|NRO|LEO|GTO|GEO|MEO|SSO|HEO|ASDS|RTLS|SLS|CRS|Artemis|Orion|Starlink|Transporter|Bandwagon|iQPS|QZS|NET|TBD|TBC)\b/gi, ' ')
    .replace(/\b(?:[A-Z]{1,4}-?\d+[A-Za-z]?|B\d{3,5})\b/g, ' ')
    .replace(/\b[A-Za-z]{1,2}\b/g, ' ')
  const leftoverWords = rest.match(/[A-Za-z]{3,}/g) || []
  if (leftoverWords.length >= 2) return false
  if (leftoverWords.length === 1 && leftoverWords[0].length >= 4) return false
  const latinLeft = (rest.match(/[A-Za-z]/g) || []).length
  return latinLeft < 8
}

function looksLikeTranslation(src, out) {
  if (loadTextTranslate._m) return loadTextTranslate._m.looksLikeTranslation(src, out)
  const s = String(src || '')
  const t = String(out || '').trim()
  return !!(t && t !== s && /[\u4e00-\u9fff]/.test(t))
}

function friendlyTranslateError(msg) {
  if (loadTextTranslate._m) return loadTextTranslate._m.friendlyTranslateError(msg)
  return String(msg || '翻译失败')
}

function vibrateMedium() {
  if (loadTextTranslate._m) return loadTextTranslate._m.vibrateMedium()
  try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
}

function translateTexts(texts) {
  return loadTextTranslate().then((m) => m.translateTexts(texts))
}

function translateTextsSmart(texts) {
  return loadTextTranslate().then((m) => m.translateTextsSmart(texts))
}

function translateGateCheck() {
  return loadTextTranslate().then((m) => m.translateGateCheck())
}

function togglePageTranslation(page, opts) {
  return loadTextTranslate().then((m) => m.togglePageTranslation(page, opts))
}

module.exports = {
  loadTextTranslate,
  translateTexts,
  translateTextsSmart,
  togglePageTranslation,
  translateGateCheck,
  isMostlyChinese,
  looksLikeTranslation,
  friendlyTranslateError,
  vibrateMedium
}
