/**
 * Next Spaceflight 清单英文 → 中文（与 cloudfunctions/syncSpaceDevsData/nsf-checklist-i18n.js 规则对齐）
 * 旧版云库仅有 title/titleEn 无 titleZh 时，前端合并仍会显示中文。
 */

const TITLE_ZH_BY_ID = {
  10: '助推器19加压测试流程',
  12: '星舰39加压测试流程',
  17: '助推器19安装猛禽3发动机',
  18: '星舰安装猛禽真空发动机',
  19: '助推器运送至发射台',
  20: '星舰吊装至助推器顶部'
}

const TITLE_ZH_EXACT = {}

const PHRASE_RULES = [
  [/Cryogenic Proof Test/gi, '低温加压测试'],
  [/Wet Dress Rehearsal/gi, '湿彩排'],
  [/Full Duration Static Fire/gi, '全时长静态点火'],
  [/Static Fire/gi, '静态点火'],
  [/Proof Campaign/gi, '加压测试流程'],
  [/Engines Installed/gi, '发动机安装完毕'],
  [/Installed/gi, '已安装'],
  [/Confirmation from SpaceX/gi, 'SpaceX 官方确认'],
  [/Rollout/gi, '转运'],
  [/Stack(?:ed|ing)?/gi, '吊装'],
  [/\bBooster\s+(\d+)/gi, '助推器$1'],
  [/\bShip\s+(\d+)/gi, '星舰$1'],
  [/\bStarship\b/gi, '星舰'],
  [/Raptor\s*3/gi, '猛禽3'],
  [/Raptor Vacuum/gi, '猛禽真空版'],
  [/Raptor/gi, '猛禽'],
  [/Shipyard/gi, '造船厂'],
  [/Massey Outpost/gi, '梅西前哨'],
  [/Orbital Launch Pad/gi, '轨道发射台'],
  [/Launch Tower/gi, '发射塔'],
  [/Launch Site/gi, '发射场'],
  [/at Launch Site/gi, '抵达发射场'],
  [/'s\b/g, '的']
]

function translateByPhrases(en) {
  let s = String(en || '').trim()
  if (!s) return ''
  for (const rule of PHRASE_RULES) {
    const [re, rep] = rule
    s = s.replace(re, rep)
  }
  return s.trim()
}

function translateNsfChecklistTitle(titleEn, id) {
  const raw = String(titleEn || '').trim()
  if (!raw) return ''

  const nid = Number(id)
  if (Number.isFinite(nid) && TITLE_ZH_BY_ID[nid]) return TITLE_ZH_BY_ID[nid]

  const exactKey = raw.toLowerCase()
  if (TITLE_ZH_EXACT[exactKey]) return TITLE_ZH_EXACT[exactKey]

  const zh = translateByPhrases(raw)
  if (zh && zh !== raw) return zh
  return raw
}

module.exports = {
  translateNsfChecklistTitle
}
