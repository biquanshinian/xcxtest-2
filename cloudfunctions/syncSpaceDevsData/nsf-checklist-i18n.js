/**
 * Next Spaceflight 星舰飞行检查清单：英文标题 → 中文
 * 1) 载具 + 动作结构化翻译（不按 id 写死编号，避免换机后错译）
 * 2) 短语补洞
 * 3) 仍有英文残留时由 enrichNsfStatusesI18n 走混元/TMT
 * 后台 itemOverrides.titleZh 仍可应急覆盖。
 */
const { isUsableZhText } = require('./space-terms-i18n.js')
const { repairAerospaceZhMistranslations } = require('./mission-title-i18n.js')

const CATEGORY_ZH = {
  booster: '助推器',
  ship: '星舰',
  starship: '星舰',
  stack: '组合体',
  'full stack': '组合体',
  fullstack: '组合体',
  'super heavy': '超重型助推器',
  superheavy: '超重型助推器'
}

/** 去掉载具前缀后的动作；长规则在前 */
const ACTION_RULES = [
  [/^Cryogenic Proof Tests?$/i, '低温加压测试'],
  [/^Proof Campaign$/i, '加压测试流程'],
  [/^Proof Tests?$/i, '加压测试'],
  [/^Full Duration Static Fires?$/i, '全时长静态点火'],
  [/^Wet Dress Rehearsals?$/i, '湿彩排'],
  [/^Static Fires?$/i, '静态点火'],
  [/^Raptor\s+V?3(?:\s+Engines?)?\s+Installed$/i, '安装猛禽3发动机'],
  [/^Raptor Vacuum(?:\s+Engines?)?\s+Installed$/i, '安装猛禽真空发动机'],
  [/^Raptor Vac(?:uum)?(?:\s+Engines?)?\s+Installed$/i, '安装猛禽真空发动机'],
  [/^Raptor\s+V?3(?:\s+Engine)?\s+Installation$/i, '安装猛禽3发动机'],
  [/^Engines Installed$/i, '发动机安装完毕'],
  [/^Engine Installation$/i, '安装发动机'],
  [/^Heat Shield Tiles Installed$/i, '安装隔热瓦'],
  [/^Heat Shield(?:s)?(?:\s+Complete)?$/i, '隔热盾完成'],
  [/^Hot Staging Ring Installed$/i, '安装热分离环'],
  [/^Grid Fins Installed$/i, '安装栅格舵'],
  [/^Catch Fittings Installed$/i, '安装捕获接口'],
  [/^Payload Bay Door(?:s)? Installed$/i, '安装载荷舱门'],
  [/^at(?: the)? Launch Site$/i, '运抵发射场'],
  [/^at Massey(?:s)? Outpost$/i, '运抵梅西前哨'],
  [/^Moved to Launch Site$/i, '运抵发射场'],
  [/^Rollout$/i, '转运'],
  [/^Rolled Out$/i, '已转运'],
  [/^Stacked$/i, '吊装至助推器顶部'],
  [/^Stacking$/i, '正在吊装'],
  [/^Confirmation from SpaceX$/i, 'SpaceX 官方确认'],
  [/^Spin Prime$/i, '旋转预冷'],
  [/^Engine Chill$/i, '发动机预冷']
]

const PHRASE_RULES = [
  [/Cryogenic Proof Tests?/gi, '低温加压测试'],
  [/Wet Dress Rehearsals?/gi, '湿彩排'],
  [/Full Duration Static Fires?/gi, '全时长静态点火'],
  [/Static Fires?/gi, '静态点火'],
  [/Proof Campaign/gi, '加压测试流程'],
  [/Proof Tests?/gi, '加压测试'],
  [/Raptor Vacuum Engines?/gi, '猛禽真空发动机'],
  [/Raptor Vac(?:uum)?/gi, '猛禽真空版'],
  [/Raptor\s*V?3/gi, '猛禽3'],
  [/Engines Installed/gi, '发动机安装完毕'],
  [/Engine Installation/gi, '安装发动机'],
  [/Heat Shield Tiles Installed/gi, '安装隔热瓦'],
  [/Hot Staging Ring Installed/gi, '安装热分离环'],
  [/Grid Fins Installed/gi, '安装栅格舵'],
  [/Catch Fittings Installed/gi, '安装捕获接口'],
  [/Confirmation from SpaceX/gi, 'SpaceX 官方确认'],
  [/at(?: the)? Launch Site/gi, '运抵发射场'],
  [/Moved to Launch Site/gi, '运抵发射场'],
  [/Orbital Launch (?:Mount|Pad|Mount)/gi, '轨道发射台'],
  [/Launch Tower/gi, '发射塔'],
  [/Launch Site/gi, '发射场'],
  [/Massey(?:s)? Outpost/gi, '梅西前哨'],
  [/Mega\s*Bay/gi, '巨型厂房'],
  [/High Bay/gi, '高厂房'],
  [/Starfactory/gi, '星际工厂'],
  [/Shipyard/gi, '造船厂'],
  [/\bSuper\s*Heavy\s+(\d+(?:\.\d+)?)/gi, '超重型助推器$1'],
  [/\bBooster\s+(\d+(?:\.\d+)?)/gi, '助推器$1'],
  [/\bShip\s+(\d+(?:\.\d+)?)/gi, '星舰$1'],
  [/Starship\s+SN(\d+)/gi, '星舰SN$1'],
  [/\bStarship\b/gi, '星舰'],
  [/\bRaptor\b/gi, '猛禽'],
  [/Rollout/gi, '转运'],
  [/Stacked/gi, '吊装至助推器顶部'],
  [/Stacking/gi, '正在吊装'],
  [/Installed/gi, '已安装']
]

function translateCategory(category) {
  const raw = String(category || '').trim()
  if (!raw) return ''
  const mapped = CATEGORY_ZH[raw.toLowerCase()]
  if (mapped) return mapped
  if (/^booster\s+\d+/i.test(raw)) return raw.replace(/^booster\s+/i, '助推器')
  if (/^ship\s+\d+/i.test(raw)) return raw.replace(/^ship\s+/i, '星舰')
  return raw
}

function translateAction(actionEn) {
  const raw = String(actionEn || '').trim()
  if (!raw) return ''
  for (let i = 0; i < ACTION_RULES.length; i++) {
    if (ACTION_RULES[i][0].test(raw)) {
      ACTION_RULES[i][0].lastIndex = 0
      return ACTION_RULES[i][1]
    }
    ACTION_RULES[i][0].lastIndex = 0
  }
  return ''
}

function translateVehiclePrefix(kind, num) {
  const k = String(kind || '').toLowerCase().replace(/\s+/g, '')
  const n = String(num || '').trim()
  if (k === 'booster' || k === 'superheavy') return (k === 'superheavy' ? '超重型助推器' : '助推器') + n
  if (k === 'ship' || k === 'starship') return '星舰' + n
  return ''
}

function applyPhraseRules(en) {
  let s = String(en || '').trim()
  if (!s) return ''
  for (let i = 0; i < PHRASE_RULES.length; i++) {
    s = s.replace(PHRASE_RULES[i][0], PHRASE_RULES[i][1])
  }
  return s.replace(/\s{2,}/g, ' ').trim()
}

function translateNsfChecklistTitle(titleEn) {
  const raw = String(titleEn || '').trim()
  if (!raw) return ''
  if (isUsableZhText(raw)) return raw

  const exactAction = translateAction(raw)
  if (exactAction) return exactAction

  const sn = raw.match(/^Starship\s+SN(\d+)\s+(.+)$/i)
  if (sn) {
    const act = translateAction(sn[2]) || applyPhraseRules(sn[2])
    if (act && act !== sn[2]) return '星舰SN' + sn[1] + act
  }

  const veh = raw.match(/^(Booster|Ship|Starship|Super\s*Heavy)\s+(\d+(?:\.\d+)?)\s+(.+)$/i)
  if (veh) {
    const prefix = translateVehiclePrefix(veh[1], veh[2])
    const act = translateAction(veh[3])
    if (prefix && act) return prefix + act
    const phrasedAct = applyPhraseRules(veh[3])
    if (prefix && phrasedAct && phrasedAct !== veh[3]) return prefix + phrasedAct
  }

  const zh = applyPhraseRules(raw)
  if (zh && zh !== raw) return zh
  return raw
}

function vehicleNumbersAlign(en, zh) {
  const enNums = String(en || '').match(/\d+/g) || []
  if (!enNums.length) return true
  const zhNums = String(zh || '').match(/\d+/g) || []
  return enNums.every((n) => zhNums.includes(n))
}

function needsMachineTitle(zh, en) {
  const titleEn = String(en || '').trim()
  const titleZh = String(zh || '').trim()
  if (!titleEn) return false
  if (!titleZh || titleZh === titleEn) return true
  if (!vehicleNumbersAlign(titleEn, titleZh)) return true
  return !isUsableZhText(titleZh)
}

function enrichNsfStatusesForStorage(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const id = row.id != null ? String(row.id) : ''
      const titleEn = String(row.titleEn || row.title || '').trim()
      if (!titleEn) return null
      const titleZh = translateNsfChecklistTitle(titleEn)
      const doneWeb = row.doneWeb !== undefined ? !!row.doneWeb : !!row.done
      const detailUrl = typeof row.detailUrl === 'string' ? row.detailUrl.trim() : ''
      const categoryEn = String(row.categoryEn || row.category || '').trim()
      const category = translateCategory(categoryEn) || categoryEn
      return {
        id,
        titleEn,
        titleZh,
        doneWeb,
        detailUrl,
        category,
        categoryEn
      }
    })
    .filter(Boolean)
}

/**
 * 短语未覆盖的英文标题走混元/TMT；英文未变时复用上一轮可用译文。
 */
async function enrichNsfStatusesI18n(statuses, prevStatuses) {
  const list = Array.isArray(statuses) ? statuses : []
  const prevById = {}
  const prevByEn = {}
  ;(prevStatuses || []).forEach((row) => {
    if (!row || typeof row !== 'object') return
    if (row.id != null) prevById[String(row.id)] = row
    const en = String(row.titleEn || '').trim()
    if (en) prevByEn[en] = row
  })

  const slots = []
  const texts = []
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    if (!row) continue
    const prev = prevById[String(row.id)] || prevByEn[String(row.titleEn || '').trim()]
    if (
      prev &&
      String(prev.titleEn || '') === String(row.titleEn || '') &&
      isUsableZhText(prev.titleZh) &&
      vehicleNumbersAlign(row.titleEn, prev.titleZh)
    ) {
      row.titleZh = prev.titleZh
      continue
    }
    if (!needsMachineTitle(row.titleZh, row.titleEn)) continue
    slots.push(i)
    texts.push(row.titleEn)
  }

  if (!texts.length) {
    return { statuses: list, machineTranslated: 0, queued: 0 }
  }

  let zhList = []
  try {
    const { translateTextsBatch } = require('./translate.js')
    zhList = await translateTextsBatch(texts, {
      forceAt: texts.map(() => true)
    })
  } catch (e) {
    console.warn('[nsf-checklist] enrich i18n failed:', (e && e.message) || e)
    return { statuses: list, machineTranslated: 0, queued: texts.length, error: (e && e.message) || String(e) }
  }

  let machineTranslated = 0
  for (let j = 0; j < slots.length; j++) {
    const zh = repairAerospaceZhMistranslations(String((zhList && zhList[j]) || '').trim())
    if (!zh || !isUsableZhText(zh)) continue
    list[slots[j]].titleZh = zh
    machineTranslated++
  }
  return { statuses: list, machineTranslated, queued: texts.length }
}

module.exports = {
  translateNsfChecklistTitle,
  translateCategory,
  needsMachineTitle,
  enrichNsfStatusesForStorage,
  enrichNsfStatusesI18n
}
