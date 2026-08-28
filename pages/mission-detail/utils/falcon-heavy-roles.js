/**
 * 猎鹰重型芯级角色名。
 * LL2 常见顺序是两枚 Strap-On Booster + 最后一根 Core；旧逻辑把 idx===0
 * 标成「中央芯」，会把 #1/#2 侧助推和 #3 中央芯级写反。
 */

function falconHeavyStageTypeText(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item.type || item.position || item.role || '').toLowerCase()
}

function isFalconHeavySideType(typeText) {
  return /strap|side|侧助/.test(typeText || '')
}

function isFalconHeavyCenterType(typeText) {
  const t = typeText || ''
  if (isFalconHeavySideType(t)) return false
  return /center|central|中央/.test(t) || /\bcore\b/.test(t)
}

function resolveFalconHeavyRoleLabel(stages, idx) {
  const list = Array.isArray(stages) ? stages : []
  const n = list.length
  if (n <= 0 || idx < 0 || idx >= n) return '一级助推器'
  const types = list.map(falconHeavyStageTypeText)
  const distinguished = types.some(isFalconHeavySideType) && types.some(isFalconHeavyCenterType)
  if (distinguished) {
    if (isFalconHeavyCenterType(types[idx])) return '中央芯级'
    let sideNo = 0
    for (let i = 0; i <= idx; i++) {
      if (!isFalconHeavyCenterType(types[i])) sideNo++
    }
    return '侧助推器' + sideNo
  }
  // 类型未区分时按 LL2 常见顺序：前两根侧助推，最后一根中央芯级
  if (n >= 2 && idx === n - 1) return '中央芯级'
  return '侧助推器' + (idx + 1)
}

/** 展示顺序固定为侧助推器 1/2，中央芯级在最后，与页面 #1/#2/#3 对齐 */
function sortFalconHeavyStagesForDisplay(stages) {
  if (!Array.isArray(stages) || stages.length < 2) return stages
  const sides = []
  const centers = []
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    if (stage && stage.role === '中央芯级') centers.push(stage)
    else sides.push(stage)
  }
  if (!centers.length) return stages
  return sides.concat(centers)
}

module.exports = {
  resolveFalconHeavyRoleLabel,
  sortFalconHeavyStagesForDisplay
}
