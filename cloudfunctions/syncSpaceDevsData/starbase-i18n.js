/**
 * Starbase.gov 封路/海滩英文文案 → 中文
 * 与 utils/starbase-i18n.js 规则对齐（同步写入 DB + 前端展示旧缓存）
 */

const { decodeHtmlEntities } = require('./decode-html-entities.js')

/** 整句精确匹配（小写键） */
const EXACT_ZH = {
  'production to pad': '产线至发射台',
  'pad to production': '发射台至产线',
  'road delay': '道路延迟',
  'road delays': '道路延迟',
  'no road delays.': '当前无道路延迟',
  'no road delays': '当前无道路延迟',
  'road closure': '道路管制中',
  'road updates': '道路更新',
  'beach closure': '海滩封闭',
  'beach closures': '海滩封闭',
  'primary': '主要时段',
  'backup': '备用时段',
  'boca chica beach': '博卡奇卡海滩',
  'mayor order': '市长令',
  'public notice': '公共公告',
  'beach is currently closed': '海滩当前关闭',
  'beach is currently open': '海滩当前开放',
  '道路延迟 / 管制': '道路延迟',
  '当前无道路延迟': '当前无道路延迟'
}

/** 按长度降序，避免短词抢先替换 */
const PHRASE_RULES = [
  [/Production to Pad/gi, '产线至发射台'],
  [/Pad to Production/gi, '发射台至产线'],
  [/Primary Closure Period/gi, '主要封闭期'],
  [/Alternate Dates?/gi, '备选日期'],
  [/Revocation of Closure/gi, '解除封闭'],
  [/BEACH Access Status/gi, '海滩通行状态'],
  [/Boca Chica Beach/gi, '博卡奇卡海滩'],
  [/No road delays\.?/gi, '当前无道路延迟'],
  [/Road Updates/gi, '道路更新'],
  [/Road Delay/gi, '道路延迟'],
  [/Road closure/gi, '道路管制中'],
  [/Beach Closure/gi, '海滩封闭'],
  [/Beach closures?/gi, '海滩封闭'],
  [/Highway 4/gi, '4号公路'],
  [/Orbital Launch Pad/gi, '轨道发射台'],
  [/Massey'?s? Testing Site/gi, '梅西测试场'],
  [/Massey Outpost/gi, '梅西前哨'],
  [/Launch Site/gi, '发射场'],
  [/Cameron County/gi, '卡梅伦县'],
  [/Senda Road/gi, '森达路'],
  [/Public Notice/gi, '公共公告'],
  [/OTHER BEACHES/gi, '其他海滩'],
  [/Surf Report/gi, '冲浪报告'],
  [/Previous Orders/gi, '历史令号'],
  [/Order No\.?/gi, '令号'],
  [/Mayor Order/gi, '市长令'],
  [/Description\s*:/gi, '说明：'],
  [/Date\s*:/gi, '日期：'],
  [/Primary\s*:/gi, '主要时段：'],
  [/Backup\s*:/gi, '备用时段：'],
  [/\bPrimary\b/gi, '主要时段'],
  [/\bBackup\b/gi, '备用时段'],
  [/beach is currently closed/gi, '海滩当前关闭'],
  [/beach is currently open/gi, '海滩当前开放'],
  [/Starbase/gi, '星舰基地']
]

/** 市长令正文短语（按英文长度降序，避免短词抢先替换） */
const MAYOR_ORDER_PHRASES = [
  ['Pursuant to Mayor\'s Order No.', '依据市长令第'],
  ['under authority granted by', '根据以下授权'],
  ['Texas Space Commission Order No.', '德州太空委员会令第'],
  ['the City of Starbase is temporarily closing', '星舰基地市临时关闭'],
  ['from FM 1419/Oklahoma Ave. to the beach entrance', '从 FM 1419/俄克拉荷马大道至海滩入口'],
  ['associated FAA hazard areas/Clear Zone', '相关 FAA 危险区/净空区'],
  ['to protect public health and safety during', '以保护公众健康与安全，期间进行'],
  ['protect public health and safety', '保护公众健康与安全'],
  ['SpaceX spaceflight activities', 'SpaceX 太空飞行活动'],
  ['Pursuant to Mayor\'s Order', '依据市长令'],
  ['Texas Space Commission', '德州太空委员会'],
  ['Emergency Management Plan', '应急管理计划'],
  ['Texas State Highway 4', '德州4号州际公路'],
  ['temporarily closing', '临时关闭'],
  ['attested by City Clerk', '由市书记员核证'],
  ['Boca Chica Beach', '博卡奇卡海滩'],
  ['FAA hazard areas', 'FAA 危险区'],
  ['issued by Mayor', '由市长签发'],
  ['and the City\'s', '以及该市'],
  ['City of Starbase', '星舰基地市'],
  ['Clear Zone', '净空区'],
  ['Ordinance No.', '条例第'],
  ['Mayor\'s Order', '市长令']
]

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function translateMayorOrderBody(text) {
  const raw = decodeHtmlEntities(String(text || '').trim())
  if (!raw) return ''

  let s = raw
  for (const [en, zh] of MAYOR_ORDER_PHRASES) {
    s = s.replace(new RegExp(escapeRegExp(en), 'gi'), zh)
  }
  return applyStarbaseI18n(s).trim()
}

function applyStarbaseI18n(text) {
  const raw = decodeHtmlEntities(String(text || '').trim())
  if (!raw) return ''

  const exactKey = raw.toLowerCase()
  if (EXACT_ZH[exactKey]) return EXACT_ZH[exactKey]

  let s = raw
  for (const rule of PHRASE_RULES) {
    const [re, rep] = rule
    s = s.replace(re, rep)
  }
  return s.trim()
}

function translateStringList(list) {
  if (!Array.isArray(list)) return []
  return list.map((item) => applyStarbaseI18n(item)).filter(Boolean)
}

/**
 * 展示层兜底：roadStatusLabel 与 roadUpdates 矛盾时以明细为准
 */
function resolveRoadStatusDisplay(record) {
  const roadUpdates = record?.roadUpdates || []
  const roadDelays = record?.roadDelays || []
  const bannerAlerts = record?.bannerAlerts || []
  const rawLabel = String(record?.roadStatusLabel || '').trim()

  const hasDelayEvidence =
    roadUpdates.length > 0 ||
    roadDelays.length > 0 ||
    bannerAlerts.some((a) => /road\s+delay/i.test(String(a || ''))) ||
    record?.roadOpen === false

  if (hasDelayEvidence) {
    if (rawLabel && !/无道路延迟|no road delays/i.test(rawLabel)) {
      return applyStarbaseI18n(rawLabel) || '道路延迟'
    }
    return '道路延迟'
  }

  if (rawLabel) return applyStarbaseI18n(rawLabel)
  if (record?.roadOpen === true) return '当前无道路延迟'
  return ''
}

function enrichStarbaseParsedForStorage(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed

  if (parsed.beachStatus) parsed.beachStatus = applyStarbaseI18n(parsed.beachStatus)
  if (parsed.roadStatusLabel) parsed.roadStatusLabel = applyStarbaseI18n(parsed.roadStatusLabel)
  if (parsed.message) parsed.message = applyStarbaseI18n(parsed.message)
  if (parsed.publicNotice) parsed.publicNotice = applyStarbaseI18n(parsed.publicNotice)

  if (Array.isArray(parsed.beachClosureSchedule)) {
    parsed.beachClosureSchedule = parsed.beachClosureSchedule.map((line) => applyStarbaseI18n(line))
  }
  if (Array.isArray(parsed.roadDelays)) {
    parsed.roadDelays = translateStringList(parsed.roadDelays)
  }
  if (Array.isArray(parsed.bannerAlerts)) {
    parsed.bannerAlerts = translateStringList(parsed.bannerAlerts)
  }
  if (Array.isArray(parsed.roadUpdates)) {
    parsed.roadUpdates = parsed.roadUpdates.map((item) => {
      if (!item || typeof item !== 'object') return item
      return {
        ...item,
        description: applyStarbaseI18n(item.description || ''),
        date: item.date || ''
      }
    })
  }
  if (Array.isArray(parsed.publicOrders)) {
    parsed.publicOrders = parsed.publicOrders.map((order) => {
      if (!order || typeof order !== 'object') return order
      return {
        ...order,
        orderNo: applyStarbaseI18n(order.orderNo || ''),
        bodyText: order.bodyText || '',
        bodyTextZh: translateMayorOrderBody(order.bodyText || ''),
        primaryPeriod: applyStarbaseI18n(order.primaryPeriod || ''),
        alternateDates: applyStarbaseI18n(order.alternateDates || ''),
        revocation: applyStarbaseI18n(order.revocation || '')
      }
    })
  }

  return parsed
}

module.exports = {
  applyStarbaseI18n,
  translateMayorOrderBody,
  resolveRoadStatusDisplay,
  enrichStarbaseParsedForStorage
}
