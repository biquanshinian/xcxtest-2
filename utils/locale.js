/**
 * 本地化取值工具
 * 全局"内容语言"开关已移除：词典/预翻译字段恒定优先中文，
 * 自由长文本默认展示英文原文，由页面级"翻译"按钮按需翻译（utils/text-translate.js）。
 */

/** 有中文值则用中文，否则回退英文 */
function pickLocalized(zhVal, enVal) {
  const zh = zhVal != null ? String(zhVal).trim() : ''
  if (zh) return zh
  return enVal != null ? String(enVal) : ''
}

/**
 * 取对象上的原始中文字段（如 item.nameZh），无则返回空串。
 * 不做英文回退——回退交给 pickLocalized，中间留给调用方接词典兜底：
 *   pickLocalized(zhField(x, 'name') || dict(x.name), x.name)
 */
function zhField(item, enKey, zhKey) {
  if (!item || typeof item !== 'object') return ''
  const zhK = zhKey || (enKey + 'Zh')
  const v = item[zhK]
  return v != null ? String(v).trim() : ''
}

module.exports = {
  pickLocalized,
  zhField
}
